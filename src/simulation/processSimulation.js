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
    return packet.outputs.every(item => {
      if (item.port < 0 || !node.outputPorts[item.port]) return false;
      const remainder = node.internalBuffer.yieldRemainders.find(entry => entry.port === item.port &&
        entry.stack.resourceId === item.stack.resourceId);
      const wholeUnits = Math.floor((remainder?.stack.amount || 0) + item.stack.amount + EPS);
      return Graph.outputRoom(node, item.port, item.stack) + EPS >= wholeUnits;
    });
  }
  function demand(graph) {
    return graph.nodes.reduce((sum, node) => {
      if (node.job) return sum + node.job.energyUse;
      const packet = Resolver.resolve(node, graph);
      return sum + (packet.ready && outputsFit(node, graph, packet) ? packet.energyUse : 0);
    }, 0);
  }

  function rateProfile(node, packet) {
    if (!packet || !Number.isFinite(packet.rate) || packet.rate <= EPS) return null;
    const definition = Graph.definitionOf(node), generated = ['source', 'import'].includes(definition.operation);
    const unit = Config.resourceUnit || 1;
    const rate = Math.min(packet.rate, unit / Config.fixedStepSeconds);
    const mainPorts = definition.operation === 'merge'
      ? definition.inputPorts.map((_, index) => index) : (definition.mainInputPorts || [0]);
    const inputAmounts = new Map(); let externalAmount = 0;
    for (const input of packet.inputs || []) {
      if (input.external) externalAmount += input.amount;
      else if (Number.isInteger(input.port)) inputAmounts.set(input.port,
        (inputAmounts.get(input.port) || 0) + input.amount);
    }
    const mainAmount = generated ? externalAmount : mainPorts.reduce((sum, port) => sum + (inputAmounts.get(port) || 0), 0);
    const denominator = definition.operation === 'import' ? externalAmount :
      (generated ? rate * (packet.duration || 1) : mainAmount);
    if (denominator <= EPS) return null;
    const outputRatios = {};
    for (const item of packet.outputs || []) {
      outputRatios[item.port] = (outputRatios[item.port] || 0) + item.stack.amount / denominator;
    }
    const secondaryRatios = {};
    if (!generated) for (const [port, amount] of inputAmounts) {
      if (!mainPorts.includes(port) && amount > EPS) secondaryRatios[port] = amount / mainAmount;
    }
    return { rate, generated, mainPorts, outputRatios, secondaryRatios };
  }

  function estimateDisplayRates(graph) {
    const byId = new Map(graph.nodes.map(node => [node.id, node]));
    const profiles = new Map(graph.nodes.map(node => [node.id, node.state === 'no_energy' ? null :
      (node.job?.rateProfile || rateProfile(node, node.preview?.ready ? node.preview : null))]));
    const incomingLinks = new Map(graph.nodes.map(node => [node.id, []]));
    for (const link of graph.connections) incomingLinks.get(link.toNodeId)?.push(link);
    let previous = new Map(graph.nodes.map(node => [node.id, {}]));
    for (let iteration = 0; iteration < 64; iteration++) {
      const estimates = new Map(), visiting = new Set();
      function calculate(node) {
        if (estimates.has(node.id)) return estimates.get(node.id);
        if (visiting.has(node.id)) return previous.get(node.id) || {};
        visiting.add(node.id);
        const profile = profiles.get(node.id);
        if (!profile) { estimates.set(node.id, {}); visiting.delete(node.id); return {}; }
        const incoming = new Map();
        for (const link of incomingLinks.get(node.id) || []) {
          const source = byId.get(link.fromNodeId);
          if (!source) continue;
          const sourceRates = calculate(source), sourceRate = sourceRates[link.fromPort] || 0;
          const maxLinkRate = Math.min(Number.isFinite(link.maxThroughput) ? link.maxThroughput : Infinity,
            source.outputPorts[link.fromPort]?.maxThroughput ?? Infinity,
            node.inputPorts[link.toPort]?.maxThroughput ?? Infinity);
          incoming.set(link.toPort, (incoming.get(link.toPort) || 0) + Math.min(sourceRate, maxLinkRate));
        }
        for (const [port, amount] of incoming) incoming.set(port,
          Math.min(amount, node.inputPorts[port]?.maxThroughput ?? amount));
        let workRate = profile.rate * (node.job ? node.job.powerFactor : 1);
        if (!profile.generated) {
          const primaryRate = profile.mainPorts.reduce((sum, port) => sum + (incoming.get(port) || 0), 0);
          workRate = Math.min(workRate, primaryRate);
          for (const [port, ratio] of Object.entries(profile.secondaryRatios)) {
            if (ratio > EPS) workRate = Math.min(workRate, (incoming.get(Number(port)) || 0) / ratio);
          }
        }
        const rates = {};
        for (const [portText, ratio] of Object.entries(profile.outputRatios)) {
          const port = Number(portText), cap = port >= 0
            ? (node.outputPorts[port]?.maxThroughput ?? Infinity) : Infinity;
          rates[port] = Math.min(workRate * ratio, cap);
        }
        estimates.set(node.id, rates); visiting.delete(node.id); return rates;
      }
      for (const node of graph.nodes) calculate(node);
      let settled = true;
      for (const node of graph.nodes) {
        const current = estimates.get(node.id) || {}, prior = previous.get(node.id) || {};
        const ports = new Set([...Object.keys(current), ...Object.keys(prior)]);
        if ([...ports].some(port => Math.abs((current[port] || 0) - (prior[port] || 0)) > EPS)) {
          settled = false; break;
        }
      }
      previous = estimates;
      if (settled) break;
    }
    for (const node of graph.nodes) node.telemetry.displayRate = Object.values(previous.get(node.id) || {})
      .reduce((sum, rate) => sum + rate, 0);
  }

  function startJob(node, graph, packet, powerFactor = 1) {
    const consumed = [], creditUpdates = new Map();
    for (const input of packet.inputs) {
      const source = input.external ? graph.externalStock.find(stack => stack.resourceId === input.resourceId) : node.internalBuffer.inputs[input.port];
      const debitAmount = input.reserveAmount ?? input.amount;
      if (input.ingredientCredit) {
        const currentCredit = node.internalBuffer.ingredientCredits[input.port];
        const sourceAmount = source?.resourceId === input.resourceId ? source.amount : 0;
        if (sourceAmount + EPS < debitAmount || (currentCredit?.amount || 0) + debitAmount + EPS < input.amount) return false;
        const reserved = debitAmount > EPS ? Stack.portion(source, debitAmount) : null;
        const pool = Stack.merge(currentCredit, reserved), used = Stack.portion(pool, input.amount);
        const remaining = pool.amount - input.amount;
        consumed.push(used);
        creditUpdates.set(input.port, remaining > EPS ? Stack.portion(pool, remaining) : null);
      } else {
        if (!source || source.amount + EPS < debitAmount) return false;
        consumed.push(Stack.portion(source, input.amount));
      }
    }
    const inputMass = Stack.total(consumed), outputMass = Stack.total(packet.outputs.map(item => item.stack));
    if (!packet.geologicalSource && Math.abs(inputMass - outputMass) > EPS * Math.max(1, inputMass)) {
      node.state = 'incompatible'; node.message = 'Recette non conservative : traitement refusé sans consommation.';
      return false;
    }
    for (const input of packet.inputs) {
      const debitAmount = input.reserveAmount ?? input.amount;
      if (debitAmount <= EPS) continue;
      if (input.external) {
        Stack.takeFromStock(graph.externalStock, input.resourceId, debitAmount);
      } else {
        const source = node.internalBuffer.inputs[input.port]; source.amount -= debitAmount;
        if (source.amount <= EPS) node.internalBuffer.inputs[input.port] = null;
      }
    }
    for (const [port, stack] of creditUpdates) node.internalBuffer.ingredientCredits[port] = stack;
    for (const update of packet.creditUpdates || []) node.internalBuffer.ingredientCredits[update.port] = update.stack;
    const definition = Graph.definitionOf(node), primaryInputPorts = definition.mainInputPorts;
    if (primaryInputPorts?.length > 1 && Number.isInteger(packet.inputs[0]?.port)) {
      const index = primaryInputPorts.indexOf(packet.inputs[0].port);
      if (index >= 0) node.settings.nextMainPort = primaryInputPorts[(index + 1) % primaryInputPorts.length];
    } else if (definition.operation === 'merge' && Number.isInteger(packet.inputs[0]?.port)) {
      node.settings.nextMainPort = (packet.inputs[0].port + 1) % Math.max(1, node.inputPorts.length);
    }
    node.job = { recipeId: packet.recipeId, mode: packet.mode, message: packet.message,
      remainingSeconds: packet.duration, duration: packet.duration, energyUse: packet.energyUse,
      inputs: consumed, outputs: packet.outputs, destination: packet.destination || null,
      powerFactor, geologicalSource: packet.geologicalSource === true, rateProfile: rateProfile(node, packet) };
    return true;
  }

  function flushYieldRemainders(node) {
    for (const entry of node.internalBuffer.yieldRemainders) {
      if (!entry.stack) continue;
      const room = Graph.outputRoom(node, entry.port, entry.stack);
      const whole = Math.floor(Math.min(entry.stack.amount, room) + EPS);
      if (whole < 1) continue;
      const portion = Stack.portion(entry.stack, whole);
      node.internalBuffer.outputs[entry.port] = Stack.merge(node.internalBuffer.outputs[entry.port], portion);
      entry.stack.amount = Math.max(0, entry.stack.amount - whole);
      if (entry.stack.amount <= EPS) entry.stack = null;
    }
    node.internalBuffer.yieldRemainders = node.internalBuffer.yieldRemainders.filter(entry => entry.stack);
  }

  function finishJob(node, graph) {
    if (node.job.geologicalSource) graph.totalExtracted += Stack.total(node.job.outputs.map(item => item.stack));
    for (const item of node.job.outputs) {
      if (node.job.destination === 'exportStock') Stack.addToStock(graph.exportStock, item.stack);
      else if (node.job.destination === 'history') node.internalBuffer.history = Stack.merge(node.internalBuffer.history, item.stack);
      else {
        let entry = node.internalBuffer.yieldRemainders.find(value => value.port === item.port &&
          value.stack.resourceId === item.stack.resourceId);
        if (!entry) { entry = { port: item.port, stack: null }; node.internalBuffer.yieldRemainders.push(entry); }
        entry.stack = Stack.merge(entry.stack, item.stack);
      }
    }
    node.job = null;
    flushYieldRemainders(node);
  }

  // One transfer pass uses a snapshot of available outputs. New input cannot
  // hop through a second block in this pass, including in cyclic graphs.
  function transfer(graph, seconds) {
    const byId = new Map(graph.nodes.map(node => [node.id, node]));
    const available = new Map(graph.nodes.flatMap(node => node.internalBuffer.outputs.map((stack, port) =>
      [`${node.id}:${port}`, stack?.amount || 0])));
    const links = graph.connections.slice().sort((a, b) => a.id.localeCompare(b.id));
    const start = links.length ? graph.tick % links.length : 0;
    const unit = Config.resourceUnit || 1, inputPortsWithLinks = new Map();
    const creditCapacity = rate => Math.max(unit, unit + rate * Config.fixedStepSeconds);
    for (const link of links) {
      const source = byId.get(link.fromNodeId), destination = byId.get(link.toNodeId);
      if (!source || !destination) continue;
      link.maxThroughput = Math.min(source.outputPorts[link.fromPort].maxThroughput,
        destination.inputPorts[link.toPort].maxThroughput);
      const credit = Number.isFinite(link.transferCredit) ? link.transferCredit : 0;
      link.transferCredit = Math.min(creditCapacity(link.maxThroughput), credit + link.maxThroughput * seconds);
      inputPortsWithLinks.set(`${destination.id}:${link.toPort}`, { node: destination, port: link.toPort });
    }
    for (const { node, port } of inputPortsWithLinks.values()) {
      const rate = node.inputPorts[port].maxThroughput, credit = node.transferCredits[port] || 0;
      node.transferCredits[port] = Math.min(creditCapacity(rate), credit + rate * seconds);
    }
    let transferCount = 0;
    for (let offset = 0; offset < links.length && offset < Config.maxTransfersPerTick; offset++) {
      const link = links[(start + offset) % links.length], source = byId.get(link.fromNodeId), destination = byId.get(link.toNodeId);
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
      let moved = 0;
      while (transferCount < Config.maxTransfersPerTick && link.transferCredit + EPS >= unit &&
          destination.transferCredits[link.toPort] + EPS >= unit && (available.get(key) || 0) + EPS >= unit &&
          stack.amount + EPS >= unit) {
        const currentAcceptance = Graph.acceptance(destination, link.toPort, stack);
        if (!currentAcceptance.ok || currentAcceptance.capacity + EPS < unit) {
          link.state = currentAcceptance.state || 'saturated';
          link.message = currentAcceptance.reason || 'Le buffer doit pouvoir recevoir 1 u.';
          break;
        }
        const piece = Stack.portion(stack, unit);
        if (!piece || piece.amount + EPS < unit) break;
        // Prepare the destination before debiting the source: each transfer is atomic and exactly 1 u.
        destination.internalBuffer.inputs[link.toPort] = Stack.merge(destination.internalBuffer.inputs[link.toPort], piece);
        stack.amount = Math.max(0, stack.amount - unit);
        available.set(key, Math.max(0, (available.get(key) || 0) - unit));
        link.transferCredit = Math.max(0, link.transferCredit - unit);
        destination.transferCredits[link.toPort] = Math.max(0, destination.transferCredits[link.toPort] - unit);
        link._transferred = (link._transferred || 0) + piece.amount; moved++; transferCount++;
        if (stack.amount <= EPS) source.internalBuffer.outputs[link.fromPort] = null;
      }
      if (moved > 0) link.state = 'active';
    }
    for (const node of graph.nodes) flushYieldRemainders(node);
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
    estimateDisplayRates(graph);
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
