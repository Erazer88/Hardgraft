(function (root) {
  'use strict';

  const Data = root.OrbitProcessData;
  const Graph = root.OrbitProcessGraph;
  const Mix = root.OrbitComposition;
  const integer = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const CYCLE_EPSILON = 1e-9;

  function definition(machine) { return Graph.definitionOf(machine); }
  function port(machine, direction, id) {
    const ports = direction === 'input' ? definition(machine).inputPorts : definition(machine).outputPorts;
    return ports.find(item => item.id === id) || null;
  }
  function inputBatch(machine, inputId) {
    return definition(machine).recipe?.inputs.find(item => item.inputId === inputId)?.amount || 1;
  }
  function primaryInput(machine) { return definition(machine).recipe?.inputs[0] || null; }
  // Rock extracted here has the composition of the ground below the building.
  function groundMix(graph) { return graph.geology?.composition ? Mix.normalize(graph.geology.composition) : Mix.plainRock; }
  function addMix(mixes, key, resourceId, held, amount, composition) {
    if (Mix) Mix.add(mixes, key, resourceId, held, amount, composition);
  }
  // Expected units of a grade-dependent output per unit of input.
  function yieldShare(machine, item) {
    const primary = primaryInput(machine);
    const composition = Mix ? Mix.of(machine.inputMix, primary?.inputId) : {};
    return Math.min(1, (composition[item.yieldOf] || 0) * Data.config.separation.recovery);
  }
  function expectedAmount(machine, item, batch) {
    if (item.yieldOf) return batch * yieldShare(machine, item);
    if (item.remainder) {
      const taken = definition(machine).recipe.outputs.filter(other => other.yieldOf)
        .reduce((sum, other) => sum + batch * yieldShare(machine, other), 0);
      return Math.max(0, batch - taken);
    }
    return item.amount;
  }
  function sourceAvailable(graph, machine) {
    const def = definition(machine);
    return !def.usesGround || graph.geology?.resourceId === machine.resourceId;
  }
  // An output dock with no destination for its resource takes nothing.
  function dockClosed(graph, dock) {
    if (!definition(dock).externalOutput || typeof graph.dockOpen !== 'function') return false;
    const link = graph.connections.find(connection => connection.toMachineId === dock.id);
    const source = link && graph.machines.find(machine => machine.id === link.fromMachineId);
    const resourceId = source && definition(source).outputPorts.find(port => port.id === link.fromOutputId)?.resourceId;
    return !resourceId || !graph.dockOpen(resourceId);
  }

  function sourceRateForTarget(graph, source, target, connection, powerRatio) {
    const sourceDef = definition(source), targetDef = definition(target);
    if (!sourceAvailable(graph, source) || (!targetDef.sink && !outputsReady(target)) || dockClosed(graph, target)) return 0;
    if (targetDef.storesResources) return (sourceDef.throughput || 1 / Data.config.fixedStepSeconds) *
      (sourceDef.energyMW > 0 ? powerRatio : 1);
    const targetInputAmount = inputBatch(target, connection.toInputId);
    if (targetDef.sink) return Math.min(targetDef.throughput || Infinity,
      (sourceDef.throughput || Infinity) * (sourceDef.energyMW > 0 ? powerRatio : 1));
    const primary = primaryInput(target);
    if (!primary) return 0;
    const targetCycleRate = targetDef.throughput * (targetDef.energyMW > 0 ? powerRatio : 1) / primary.amount;
    const targetRate = targetCycleRate * targetInputAmount;
    return Math.min(sourceDef.throughput ? sourceDef.throughput * (sourceDef.energyMW > 0 ? powerRatio : 1) : Infinity,
      targetRate);
  }
  function outputsReady(machine) {
    const config = Data.config;
    return definition(machine).recipe.outputs.every(item =>
      machine.outputBuffer[item.outputId] + item.amount <= config.outputCapacity);
  }
  function inputsReady(machine) {
    return definition(machine).recipe.inputs.every(item => machine.inputBuffer[item.inputId] >= item.amount);
  }

  function estimateRates(graph, powerRatio = 1, externalStock = {}) {
    const byId = new Map(graph.machines.map(machine => [machine.id, machine]));
    const outputRates = new Map();
    for (const machine of Graph.topologicalOrder(graph)) {
      const def = definition(machine), rates = {};
      if (def.externalInput) {
        const link = graph.connections.find(connection => connection.fromMachineId === machine.id);
        const target = link && byId.get(link.toMachineId);
        const available = integer(externalStock[machine.importResourceId]) + integer(machine.outputBuffer.material);
        const ready = target && (definition(target).sink || outputsReady(target));
        // Docks are logical connectors: without a throughput they pass whatever fits.
        machine.currentRate = available && ready && machine.outputBuffer.material < Data.config.outputCapacity ? def.throughput ?? Infinity : 0;
        rates.material = machine.currentRate;
      } else if (def.sink) {
        const incomingRate = graph.connections.reduce((sum, connection) => {
          if (connection.toMachineId !== machine.id) return sum;
          return sum + (outputRates.get(connection.fromMachineId)?.[connection.fromOutputId] || 0);
        }, 0);
        const inputId = def.inputPorts[0]?.id;
        const hasBufferedUnits = inputId && machine.inputBuffer[inputId] > 0;
        machine.currentRate = dockClosed(graph, machine) ? 0 : def.storesResources || def.throughput == null ? incomingRate : Math.min(def.throughput,
          incomingRate > 0 || hasBufferedUnits ? Math.max(incomingRate, hasBufferedUnits ? def.throughput : 0) : 0);
      } else if (def.source) {
        const outgoing = graph.connections.find(connection => connection.fromMachineId === machine.id);
        const target = outgoing && byId.get(outgoing.toMachineId);
        rates[def.outputPorts[0].id] = target
          ? sourceRateForTarget(graph, machine, target, outgoing, powerRatio) : 0;
      } else {
        const recipe = def.recipe, primary = primaryInput(machine);
        const nominalCycleRate = primary ? def.throughput *
          (def.energyMW > 0 ? powerRatio : 1) / primary.amount : 0;
        const feedCycleRates = recipe.inputs.map(item => {
          const connection = graph.connections.find(link => link.toMachineId === machine.id && link.toInputId === item.inputId);
          const supplied = connection ? outputRates.get(connection.fromMachineId)?.[connection.fromOutputId] || 0 : 0;
          return supplied > 0 ? supplied / item.amount
            : machine.inputBuffer[item.inputId] >= item.amount ? nominalCycleRate : 0;
        });
        let cycleRate = Math.min(nominalCycleRate, ...(feedCycleRates.length ? feedCycleRates : [0]));
        if (!outputsReady(machine)) cycleRate = 0;
        machine.currentRate = primary ? primary.amount * cycleRate : 0;
        for (const item of recipe.outputs) rates[item.outputId] = cycleRate * expectedAmount(machine, item, primary?.amount || 0);
      }
      outputRates.set(machine.id, rates);
      if (def.source) machine.currentRate = Object.values(rates).reduce((sum, value) => sum + value, 0);
    }
    return outputRates;
  }

  function demand(graph, externalStock = {}) {
    estimateRates(graph, 1, externalStock);
    return graph.machines.reduce((sum, machine) => {
      const def = definition(machine);
      return machine.currentRate > 0 ? sum + def.energyMW : sum;
    }, 0);
  }

  function transfer(graph, powerRatio) {
    for (const connection of graph.connections) {
      const from = graph.machines.find(machine => machine.id === connection.fromMachineId);
      const to = graph.machines.find(machine => machine.id === connection.toMachineId);
      const out = port(from, 'output', connection.fromOutputId), input = port(to, 'input', connection.toInputId);
      if (!out || !input || dockClosed(graph, to)) continue;
      if (definition(to).storesResources) {
        const amount = integer(from.outputBuffer[out.id]);
        if (!amount) continue;
        to.storedResources[out.resourceId] = (to.storedResources[out.resourceId] || 0) + amount;
        from.outputBuffer[out.id] = 0;
        continue;
      }
      if (definition(from).source && !definition(to).sink) {
        const sourceDef = definition(from);
        if ((powerRatio <= 0 && sourceDef.energyMW > 0) || !sourceAvailable(graph, from) || !outputsReady(to)) continue;
        const needed = inputBatch(to, input.id);
        const room = Math.max(0, Data.config.inputCapacity - to.inputBuffer[input.id]);
        const amount = integer(Math.min(room, Math.max(0, needed - to.inputBuffer[input.id])));
        addMix(to.inputMix ||= {}, input.id, out.resourceId, to.inputBuffer[input.id], amount, groundMix(graph));
        to.inputBuffer[input.id] += amount;
        continue;
      }
      const amount = integer(Math.min(from.outputBuffer[out.id],
        Data.config.inputCapacity - to.inputBuffer[input.id]));
      if (!amount) continue;
      // The rock keeps its composition from one card to the next.
      addMix(to.inputMix ||= {}, input.id, out.resourceId, to.inputBuffer[input.id], amount, Mix?.of(from.outputMix, out.id));
      from.outputBuffer[out.id] -= amount;
      to.inputBuffer[input.id] += amount;
      Mix?.prune(from.outputMix, out.id, from.outputBuffer[out.id]);
    }
  }

  function runMachine(graph, machine, powerRatio, externalStock, externalMix = {}) {
    const def = definition(machine);
    machine.energyMW = 0;
    if (def.externalInput) {
      const resourceId = machine.importResourceId;
      if (machine.outputBuffer.material >= Data.config.outputCapacity) { machine.state = 'output_full'; return; }
      if (integer(externalStock[resourceId]) && !machine.currentRate &&
          graph.connections.some(link => link.fromMachineId === machine.id)) { machine.state = 'output_full'; return; }
      if (!integer(externalStock[resourceId]) || !machine.currentRate) { machine.state = 'waiting_input'; return; }
      machine.state = 'active';
      // Without a throughput, the dock fills its buffer at once.
      machine.cycleProgress = def.throughput == null ? Infinity : machine.cycleProgress + Data.config.fixedStepSeconds * def.throughput;
      while (machine.cycleProgress + CYCLE_EPSILON >= 1 && integer(externalStock[resourceId]) > 0 &&
          machine.outputBuffer.material < Data.config.outputCapacity) {
        addMix(machine.outputMix ||= {}, 'material', resourceId, machine.outputBuffer.material, 1, Mix?.of(externalMix, resourceId));
        externalStock[resourceId] -= 1;
        Mix?.prune(externalMix, resourceId, externalStock[resourceId]);
        machine.outputBuffer.material += 1;
        machine.cycleProgress = Math.max(0, machine.cycleProgress - 1);
      }
      if (def.throughput == null) machine.cycleProgress = 0;
      return;
    }
    if (def.sink) {
      if (dockClosed(graph, machine)) { machine.state = 'no_destination'; return; }
      if (def.storesResources) {
        machine.state = machine.currentRate > 0 ? 'active' : 'waiting_input';
        return;
      }
      const inputId = def.inputPorts[0]?.id;
      const batchRate = def.throughput;
      if (!inputId || machine.inputBuffer[inputId] < 1) {
        machine.state = 'waiting_input';
        return;
      }
      machine.state = 'active';
      if (def.externalOutput) return;
      machine.cycleProgress += Data.config.fixedStepSeconds * batchRate;
      while (machine.cycleProgress + CYCLE_EPSILON >= 1 && machine.inputBuffer[inputId] >= 1) {
        machine.inputBuffer[inputId] -= 1;
        machine.cycleProgress = Math.max(0, machine.cycleProgress - 1);
      }
      return;
    }
    if (def.source) {
      const link = graph.connections.find(connection => connection.fromMachineId === machine.id);
      const target = link && graph.machines.find(item => item.id === link.toMachineId);
      const validDeposit = sourceAvailable(graph, machine);
      if (validDeposit && target && definition(target).sink) {
        const outputId = def.outputPorts[0].id;
        if (powerRatio <= 0 && def.energyMW > 0) { machine.state = 'no_energy'; return; }
        if (machine.outputBuffer[outputId] >= Data.config.outputCapacity || dockClosed(graph, target)) {
          machine.state = 'output_full';
          return;
        }
        machine.state = 'active';
        machine.energyMW = def.energyMW > 0 ? def.energyMW * powerRatio : 0;
        machine.cycleProgress += Data.config.fixedStepSeconds * machine.currentRate;
        while (machine.cycleProgress + CYCLE_EPSILON >= 1 &&
          machine.outputBuffer[outputId] < Data.config.outputCapacity) {
          addMix(machine.outputMix ||= {}, outputId, def.outputPorts[0].resourceId, machine.outputBuffer[outputId], 1, groundMix(graph));
          machine.outputBuffer[outputId] += 1;
          machine.cycleProgress = Math.max(0, machine.cycleProgress - 1);
        }
        return;
      }
      machine.state = !validDeposit || !target ? 'waiting_input'
        : powerRatio <= 0 && def.energyMW > 0 ? 'no_energy'
          : !definition(target).sink && !outputsReady(target) ? 'output_full' : 'active';
      machine.energyMW = machine.state === 'active' && def.energyMW > 0 ? def.energyMW * powerRatio : 0;
      return;
    }
    if (!outputsReady(machine)) { machine.state = 'output_full'; return; }
    if (!inputsReady(machine)) { machine.state = 'waiting_input'; return; }
    if (powerRatio <= 0 && def.energyMW > 0) { machine.state = 'no_energy'; return; }
    machine.state = 'active';
    machine.energyMW = def.energyMW * powerRatio;
    const primary = primaryInput(machine);
    const cycleRate = primary ? (machine.currentRate > 0 ? machine.currentRate :
      def.throughput * (def.energyMW > 0 ? powerRatio : 1)) / primary.amount : 0;
    machine.cycleProgress += Data.config.fixedStepSeconds * cycleRate;
    while (machine.cycleProgress + CYCLE_EPSILON >= 1 && inputsReady(machine) && outputsReady(machine)) {
      runCycle(machine, def);
      machine.cycleProgress = Math.max(0, machine.cycleProgress - 1);
    }
  }

  // One recipe cycle. Rock outputs keep the composition of the rock consumed;
  // a separator emits whole units of concentrate as the grade allows (the
  // fraction carries over to the next cycle) and the rest as tailings,
  // depleted of what was taken.
  function runCycle(machine, def) {
    const primary = primaryInput(machine), batch = primary?.amount || 0;
    const rock = Mix ? Mix.of(machine.inputMix, primary?.inputId) : null;
    machine.yieldCredit ||= {};
    const produced = {}, taken = {};
    for (const item of def.recipe.outputs) {
      if (!item.yieldOf) continue;
      const credit = (machine.yieldCredit[item.outputId] || 0) + batch * Math.min(1, (rock?.[item.yieldOf] || 0) * Data.config.separation.recovery);
      produced[item.outputId] = Math.min(batch, Math.floor(credit + 1e-9));
      machine.yieldCredit[item.outputId] = Math.max(0, credit - produced[item.outputId]);
      taken[item.yieldOf] = (taken[item.yieldOf] || 0) + produced[item.outputId];
    }
    const extracted = Object.values(produced).reduce((sum, amount) => sum + amount, 0);
    for (const item of def.recipe.outputs) {
      if (item.remainder) produced[item.outputId] = Math.max(0, batch - extracted);
      else if (!item.yieldOf) produced[item.outputId] = item.amount;
    }
    for (const item of def.recipe.inputs) {
      machine.inputBuffer[item.inputId] -= item.amount;
      Mix?.prune(machine.inputMix, item.inputId, machine.inputBuffer[item.inputId]);
    }
    for (const item of def.recipe.outputs) {
      const amount = produced[item.outputId];
      if (!amount) continue;
      let composition = rock;
      if (item.remainder && rock) {
        // Taking E units of a material out of N leaves (N·share − E) of it in N − E units.
        for (const [material, units] of Object.entries(taken)) composition = Mix.deplete(composition, material, units / Math.max(1, batch));
      }
      addMix(machine.outputMix ||= {}, item.outputId, item.resourceId, machine.outputBuffer[item.outputId], amount, composition);
      machine.outputBuffer[item.outputId] += amount;
    }
  }

  function tick(graph, externalStock, externalMix) {
    graph.tick++;
    estimateRates(graph, 1, externalStock);
    graph.energyDemandMW = demand(graph, externalStock);
    const ratio = graph.energyUnlimited || graph.energyDemandMW <= 0 ? 1
      : Math.min(1, graph.energyAvailableMW / graph.energyDemandMW);
    estimateRates(graph, ratio, externalStock);
    transfer(graph, ratio);
    graph.energyUsedMW = 0;
    for (const machine of Graph.topologicalOrder(graph)) {
      estimateRates(graph, ratio, externalStock);
      runMachine(graph, machine, ratio, externalStock, externalMix);
      graph.energyUsedMW += machine.energyMW;
    }
    graph.energyDemandMW = demand(graph, externalStock);
    estimateRates(graph, ratio, externalStock);
  }

  function advance(graph, seconds, context = {}) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Process duration must be finite and non-negative');
    graph.energyUnlimited = context.energyUnlimited === true;
    graph.energyAvailableMW = Number.isFinite(context.energyAvailableMW) ? Math.max(0, context.energyAvailableMW) : 0;
    // Which resources the building's output docks may send (runtime only).
    Object.defineProperty(graph, 'dockOpen', { value: context.isDockOpen || null, configurable: true, writable: true, enumerable: false });
    graph.accumulator += seconds;
    let count = 0;
    while (graph.accumulator + 1e-9 >= Data.config.fixedStepSeconds && count < Data.config.maxTicksPerAdvance) {
      tick(graph, context.externalStock || {}, context.externalMix || {});
      graph.accumulator = Math.max(0, graph.accumulator - Data.config.fixedStepSeconds);
      count++;
    }
    return graph;
  }

  root.OrbitProcessSimulation = Object.freeze({ advance, demand, estimateRates });
})(globalThis);
