(function (root) {
  'use strict';

  const Data = root.OrbitProcessData;
  const Graph = root.OrbitProcessGraph;
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
  function sourceAvailable(graph, machine) {
    const def = definition(machine);
    return !def.requiresDeposit || graph.geology?.resourceId === machine.resourceId;
  }
  function sourceRateForTarget(graph, source, target, connection, powerRatio) {
    const sourceDef = definition(source), targetDef = definition(target);
    if (!sourceAvailable(graph, source) || (!targetDef.sink && !outputsReady(target))) return 0;
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

  function estimateRates(graph, powerRatio = 1) {
    const byId = new Map(graph.machines.map(machine => [machine.id, machine]));
    const outputRates = new Map();
    for (const machine of Graph.topologicalOrder(graph)) {
      const def = definition(machine), rates = {};
      if (def.sink) {
        const incomingRate = graph.connections.reduce((sum, connection) => {
          if (connection.toMachineId !== machine.id) return sum;
          return sum + (outputRates.get(connection.fromMachineId)?.[connection.fromOutputId] || 0);
        }, 0);
        const inputId = def.inputPorts[0]?.id;
        const hasBufferedUnits = inputId && machine.inputBuffer[inputId] > 0;
        machine.currentRate = def.storesResources ? incomingRate : Math.min(def.throughput,
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
        for (const item of recipe.outputs) rates[item.outputId] = cycleRate * item.amount;
      }
      outputRates.set(machine.id, rates);
      if (def.source) machine.currentRate = Object.values(rates).reduce((sum, value) => sum + value, 0);
    }
    return outputRates;
  }

  function demand(graph) {
    estimateRates(graph);
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
      if (!out || !input) continue;
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
        to.inputBuffer[input.id] += amount;
        continue;
      }
      const amount = integer(Math.min(from.outputBuffer[out.id],
        Data.config.inputCapacity - to.inputBuffer[input.id]));
      if (!amount) continue;
      from.outputBuffer[out.id] -= amount;
      to.inputBuffer[input.id] += amount;
    }
  }

  function runMachine(graph, machine, powerRatio) {
    const def = definition(machine);
    machine.energyMW = 0;
    if (def.sink) {
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
        if (machine.outputBuffer[outputId] >= Data.config.outputCapacity) {
          machine.state = 'output_full';
          return;
        }
        machine.state = 'active';
        machine.energyMW = def.energyMW > 0 ? def.energyMW * powerRatio : 0;
        machine.cycleProgress += Data.config.fixedStepSeconds * machine.currentRate;
        while (machine.cycleProgress + CYCLE_EPSILON >= 1 &&
          machine.outputBuffer[outputId] < Data.config.outputCapacity) {
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
    if (powerRatio <= 0) { machine.state = 'no_energy'; return; }
    machine.state = 'active';
    machine.energyMW = def.energyMW * powerRatio;
    const primary = primaryInput(machine);
    const cycleRate = primary ? (machine.currentRate > 0 ? machine.currentRate :
      def.throughput * (def.energyMW > 0 ? powerRatio : 1)) / primary.amount : 0;
    machine.cycleProgress += Data.config.fixedStepSeconds * cycleRate;
    while (machine.cycleProgress + CYCLE_EPSILON >= 1 && inputsReady(machine) && outputsReady(machine)) {
      for (const item of def.recipe.inputs) machine.inputBuffer[item.inputId] -= item.amount;
      for (const item of def.recipe.outputs) machine.outputBuffer[item.outputId] += item.amount;
      machine.cycleProgress = Math.max(0, machine.cycleProgress - 1);
    }
  }

  function tick(graph) {
    graph.tick++;
    estimateRates(graph);
    graph.energyDemandMW = demand(graph);
    const ratio = graph.energyUnlimited || graph.energyDemandMW <= 0 ? 1
      : Math.min(1, graph.energyAvailableMW / graph.energyDemandMW);
    estimateRates(graph, ratio);
    transfer(graph, ratio);
    graph.energyUsedMW = 0;
    for (const machine of Graph.topologicalOrder(graph)) {
      estimateRates(graph, ratio);
      runMachine(graph, machine, ratio);
      graph.energyUsedMW += machine.energyMW;
    }
    graph.energyDemandMW = demand(graph);
    estimateRates(graph, ratio);
  }

  function advance(graph, seconds, context = {}) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Process duration must be finite and non-negative');
    graph.energyUnlimited = context.energyUnlimited === true;
    graph.energyAvailableMW = Number.isFinite(context.energyAvailableMW) ? Math.max(0, context.energyAvailableMW) : 0;
    graph.accumulator += seconds;
    let count = 0;
    while (graph.accumulator + 1e-9 >= Data.config.fixedStepSeconds && count < Data.config.maxTicksPerAdvance) {
      tick(graph);
      graph.accumulator = Math.max(0, graph.accumulator - Data.config.fixedStepSeconds);
      count++;
    }
    return graph;
  }

  root.OrbitProcessSimulation = Object.freeze({ advance, demand, estimateRates });
})(globalThis);
