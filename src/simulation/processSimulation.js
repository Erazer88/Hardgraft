(function (root) {
  'use strict';
  const Stack = root.OrbitResourceStack, Graph = root.OrbitProcessGraph;
  const Resolver = root.OrbitRecipeResolver, Config = root.OrbitProcessData.config;
  const EPS = Stack.EPSILON;

  function reservedExport(graph) {
    return graph.nodes.reduce((sum, node) => sum + (node.job?.destination === 'exportStock'
      ? Stack.total(node.job.outputs.map(item => item.stack)) : 0), 0);
  }
  function outputsFit(node, graph, packet) {
    if (packet.destination === 'history') return true;
    if (packet.destination === 'exportStock') return Stack.total(graph.exportStock) + reservedExport(graph) +
      Stack.total(packet.outputs.map(item => item.stack)) <= graph.exportCapacity + EPS;
    return packet.outputs.every(item => item.port >= 0 && node.outputPorts[item.port] &&
      Graph.outputRoom(node, item.port, item.stack) + EPS >= item.stack.amount);
  }
  function demand(graph) {
    return graph.nodes.reduce((sum, node) => {
      if (node.job) return sum + node.job.energyUse;
      const packet = Resolver.resolve(node, graph);
      return sum + (packet.ready && outputsFit(node, graph, packet) ? packet.energyUse : 0);
    }, 0);
  }
  function startJob(node, graph, packet, powerFactor = 1) {
    const consumed = [];
    for (const input of packet.inputs) {
      const source = input.external ? graph.externalStock.find(stack => stack.resourceId === input.resourceId) : node.internalBuffer.inputs[input.port];
      if (!source || source.amount + EPS < input.amount) return false;
      consumed.push(Stack.portion(source, input.amount));
    }
    const inputMass = Stack.total(consumed), outputMass = Stack.total(packet.outputs.map(item => item.stack));
    if (!packet.geologicalSource && Math.abs(inputMass - outputMass) > EPS * Math.max(1, inputMass)) {
      node.state = 'incompatible'; node.message = 'Recette non conservative : traitement refusé sans consommation.';
      return false;
    }
    for (const input of packet.inputs) {
      if (input.external) {
        Stack.takeFromStock(graph.externalStock, input.resourceId, input.amount);
      } else {
        const source = node.internalBuffer.inputs[input.port]; source.amount -= input.amount;
        if (source.amount <= EPS) node.internalBuffer.inputs[input.port] = null;
      }
    }
    const primaryInputPorts = Graph.definitionOf(node).mainInputPorts;
    if (primaryInputPorts?.length > 1 && Number.isInteger(packet.inputs[0]?.port)) {
      const index = primaryInputPorts.indexOf(packet.inputs[0].port);
      if (index >= 0) node.settings.nextMainPort = primaryInputPorts[(index + 1) % primaryInputPorts.length];
    }
    node.job = { recipeId: packet.recipeId, mode: packet.mode, message: packet.message,
      remainingSeconds: packet.duration, duration: packet.duration, energyUse: packet.energyUse,
      inputs: consumed, outputs: packet.outputs, destination: packet.destination || null,
      powerFactor, geologicalSource: packet.geologicalSource === true };
    return true;
  }

  function finishJob(node, graph) {
    if (node.job.geologicalSource) graph.totalExtracted += Stack.total(node.job.outputs.map(item => item.stack));
    for (const item of node.job.outputs) {
      if (node.job.destination === 'exportStock') Stack.addToStock(graph.exportStock, item.stack);
      else if (node.job.destination === 'history') node.internalBuffer.history = Stack.merge(node.internalBuffer.history, item.stack);
      else node.internalBuffer.outputs[item.port] = Stack.merge(node.internalBuffer.outputs[item.port], item.stack);
    }
    node.job = null;
  }

  // One transfer pass uses a snapshot of available outputs. New input cannot
  // hop through a second block in this pass, including in cyclic graphs.
  function transfer(graph, seconds) {
    const byId = new Map(graph.nodes.map(node => [node.id, node]));
    const available = new Map(graph.nodes.flatMap(node => node.internalBuffer.outputs.map((stack, port) =>
      [`${node.id}:${port}`, stack?.amount || 0])));
    const links = graph.connections.slice().sort((a, b) => a.id.localeCompare(b.id));
    const start = links.length ? graph.tick % links.length : 0;
    const incomingUsed = new Map();
    for (let offset = 0; offset < Math.min(links.length, Config.maxTransfersPerTick); offset++) {
      const link = links[(start + offset) % links.length], source = byId.get(link.fromNodeId), destination = byId.get(link.toNodeId);
      if (source && destination) link.maxThroughput = Math.min(source.outputPorts[link.fromPort].maxThroughput,
        destination.inputPorts[link.toPort].maxThroughput);
      const stack = source?.internalBuffer.outputs[link.fromPort];
      link.state = 'waiting'; link.message = '';
      if (!source || !destination || !stack) continue;
      link.resourceId = stack.resourceId;
      const acceptance = Graph.acceptance(destination, link.toPort, stack);
      if (!acceptance.ok) {
        link.state = acceptance.state; link.message = acceptance.reason;
        if (!source.job) { source.state = 'output_blocked'; source.message = acceptance.reason; }
        if (!destination.job && !destination.internalBuffer.inputs.some(Boolean)) {
          destination.state = acceptance.state; destination.message = acceptance.reason;
        }
        continue;
      }
      const key = `${source.id}:${link.fromPort}`;
      const targetKey = `${destination.id}:${link.toPort}`;
      const portBudget = destination.inputPorts[link.toPort].maxThroughput * seconds;
      const remainingPortBudget = Math.max(0, portBudget - (incomingUsed.get(targetKey) || 0));
      const amount = Math.min(available.get(key) || 0, stack.amount, acceptance.capacity,
        link.maxThroughput * seconds, remainingPortBudget);
      if (amount <= EPS) continue;
      const piece = Stack.portion(stack, amount);
      // Prepare the destination before debiting the source: the operation is atomic.
      const merged = Stack.merge(destination.internalBuffer.inputs[link.toPort], piece);
      destination.internalBuffer.inputs[link.toPort] = merged;
      stack.amount -= amount;
      if (stack.amount <= EPS) source.internalBuffer.outputs[link.fromPort] = null;
      available.set(key, (available.get(key) || 0) - amount);
      incomingUsed.set(targetKey, (incomingUsed.get(targetKey) || 0) + amount);
      link._transferred = (link._transferred || 0) + amount; link.state = 'active';
    }
  }

  function flowRates(items, unwrap, duration, factor) {
    const amounts = {};
    if (duration > EPS && factor > EPS) for (const item of items) {
      const stack = unwrap(item);
      if (stack) amounts[stack.resourceId] = (amounts[stack.resourceId] || 0) + stack.amount * factor / duration;
    }
    return amounts;
  }

  function updateTelemetry(graph, seconds) {
    for (const node of graph.nodes) {
      const sample = node.telemetry, job = node.job;
      const duration = job?.duration || 0, factor = job?.powerFactor ?? 0;
      sample.inputAmounts = job ? flowRates(job.inputs, stack => stack, duration, factor) : {};
      sample.outputAmounts = job ? flowRates(job.outputs, item => item.stack, duration, factor) : {};
      sample.inputRate = Object.values(sample.inputAmounts).reduce((sum, value) => sum + value, 0);
      sample.outputRate = Object.values(sample.outputAmounts).reduce((sum, value) => sum + value, 0);
      sample.energyMW = job ? job.energyUse * factor : 0;
    }
    for (const link of graph.connections) {
      link._seconds = (link._seconds || 0) + seconds;
      if (link._seconds >= .5 - EPS) {
        link.currentThroughput = (link._transferred || 0) / link._seconds;
        link._seconds = 0; link._transferred = 0;
      }
    }
  }

  function tick(graph, seconds) {
    graph.tick++;
    graph.energyDemandMW = demand(graph); graph.energyUsedMW = 0;
    let ratio = graph.energyUnlimited || graph.energyDemandMW <= EPS ? 1 :
      Math.min(1, graph.energyAvailableMW / graph.energyDemandMW);
    for (const node of graph.nodes) {
      node.telemetry.energyMW = 0;
      if (!node.job) continue;
      const job = node.job, factor = job.energyUse > EPS ? ratio : 1;
      job.powerFactor = factor;
      node.state = factor <= EPS ? 'no_energy' : Resolver.stateOf(job.mode);
      node.message = factor <= EPS ? 'Aucune puissance disponible pour ce bâtiment.' : job.message;
      node.recipeId = job.recipeId; node.mode = job.mode;
      if (factor > EPS && factor < 1) { node.state = 'degraded'; node.message = 'Puissance insuffisante : cycle ralenti.'; }
      node.telemetry.energyMW = job.energyUse * factor; graph.energyUsedMW += node.telemetry.energyMW;
      job.remainingSeconds = Math.max(0, job.remainingSeconds - seconds * factor);
      if (job.remainingSeconds <= EPS) finishJob(node, graph);
    }
    transfer(graph, seconds);
    // Re-evaluate after arrivals, while preserving the per-building power budget.
    const nextDemand = demand(graph);
    ratio = graph.energyUnlimited || nextDemand <= EPS ? 1 : Math.min(1, graph.energyAvailableMW / nextDemand);
    for (const node of graph.nodes) {
      if (node.job) continue;
      const packet = Resolver.resolve(node, graph);
      node.preview = packet; node.recipeId = packet.recipeId || null; node.mode = packet.mode;
      if (!packet.ready) {
        const outgoingError = graph.connections.find(link => link.fromNodeId === node.id && ['incompatible', 'saturated'].includes(link.state));
        const disconnectedOutput = node.internalBuffer.outputs.some((stack, port) => stack &&
          !graph.connections.some(link => link.fromNodeId === node.id && link.fromPort === port));
        if (node.internalBuffer.outputs.some(Boolean) && (outgoingError || disconnectedOutput)) {
          node.state = 'output_blocked'; node.message = outgoingError?.message || 'Sortie non reliée : matière conservée dans le buffer.';
          continue;
        }
        const incomingError = graph.connections.find(link => link.toNodeId === node.id && link.state === 'incompatible');
        node.state = incomingError?.state || packet.state; node.message = incomingError?.message || packet.message;
        continue;
      }
      if (!outputsFit(node, graph, packet)) {
        node.state = node.internalBuffer.inputs.some(stack => stack && stack.amount >= Graph.definitionOf(node).inputCapacity - EPS)
          ? 'saturated' : 'output_blocked';
        node.message = 'Capacité de sortie insuffisante : matière conservée en entrée.'; continue;
      }
      if (packet.energyUse > EPS && ratio <= EPS) {
        node.state = 'no_energy'; node.message = 'Aucune puissance disponible pour ce bâtiment.'; continue;
      }
      node.state = packet.state; node.message = packet.message;
      startJob(node, graph, packet, packet.energyUse > EPS ? ratio : 1);
    }
    graph.energyDemandMW = demand(graph);
    updateTelemetry(graph, seconds);
  }

  function advance(graph, seconds, context = {}) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Process duration must be finite and non-negative');
    graph.energyUnlimited = context.energyUnlimited === true;
    graph.energyAvailableMW = Number.isFinite(context.energyAvailableMW) ? Math.max(0, context.energyAvailableMW) : 0;
    graph.accumulator += seconds;
    let count = 0;
    while (graph.accumulator + EPS >= Config.fixedStepSeconds && count < Config.maxTicksPerAdvance) {
      tick(graph, Config.fixedStepSeconds); graph.accumulator = Math.max(0, graph.accumulator - Config.fixedStepSeconds); count++;
    }
    return graph;
  }
  root.OrbitProcessSimulation = Object.freeze({ advance, demand, outputsFit });
})(globalThis);
