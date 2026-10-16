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
    return definition(machine).recipe.inputs.find(item => item.inputId === inputId)?.amount || 0;
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
        machine.currentRate = Math.min(def.throughput,
          incomingRate > 0 || hasBufferedUnits ? Math.max(incomingRate, hasBufferedUnits ? def.throughput : 0) : 0);
      } else if (def.source) {
        const outgoing = graph.connections.find(connection => connection.fromMachineId === machine.id);
        const target = outgoing && byId.get(outgoing.toMachineId);
        const validDeposit = graph.geology?.resourceId === 'iron';
        const targetDefinition = target && definition(target);
        const targetBlocked = target && !targetDefinition.sink && !outputsReady(target);
        rates[def.outputPorts[0].id] = validDeposit && target && !targetBlocked
          ? (targetDefinition.throughput || 0) * powerRatio : 0;
      } else {
        const recipe = def.recipe;
        const feedRates = recipe.inputs.map(item => {
          const connection = graph.connections.find(link => link.toMachineId === machine.id && link.toInputId === item.inputId);
          const supplied = connection ? outputRates.get(connection.fromMachineId)?.[connection.fromOutputId] || 0 : 0;
          return supplied > 0 ? supplied : machine.inputBuffer[item.inputId] >= item.amount ? def.throughput * powerRatio : 0;
        });
        let rate = Math.min(def.throughput * powerRatio, ...(feedRates.length ? feedRates : [0]));
        if (!outputsReady(machine)) rate = 0;
        machine.currentRate = rate;
        const consumed = recipe.inputs.reduce((sum, item) => sum + item.amount, 0);
        for (const item of recipe.outputs) rates[item.outputId] = consumed > 0 ? rate * item.amount / consumed : 0;
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
      if (definition(from).source && !definition(to).sink) {
        if (powerRatio <= 0 || graph.geology?.resourceId !== 'iron' || !outputsReady(to)) continue;
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
      const inputId = def.inputPorts[0]?.id;
      const batchRate = def.throughput;
      if (!inputId || machine.inputBuffer[inputId] < 1) {
        machine.state = 'waiting_input';
        return;
      }
      machine.state = 'active';
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
      const validDeposit = graph.geology?.resourceId === 'iron';
      if (validDeposit && target && definition(target).sink) {
        const outputId = def.outputPorts[0].id;
        if (powerRatio <= 0) { machine.state = 'no_energy'; return; }
        if (machine.outputBuffer[outputId] >= Data.config.outputCapacity) {
          machine.state = 'output_full';
          return;
        }
        machine.state = 'active';
        machine.energyMW = def.energyMW * powerRatio;
        machine.cycleProgress += Data.config.fixedStepSeconds * machine.currentRate;
        while (machine.cycleProgress + CYCLE_EPSILON >= 1 &&
          machine.outputBuffer[outputId] < Data.config.outputCapacity) {
          machine.outputBuffer[outputId] += 1;
          machine.cycleProgress = Math.max(0, machine.cycleProgress - 1);
        }
        return;
      }
      machine.state = !validDeposit || !target ? 'waiting_input'
        : powerRatio <= 0 ? 'no_energy'
          : !definition(target).sink && !outputsReady(target) ? 'output_full' : 'active';
      machine.energyMW = machine.state === 'active' ? def.energyMW * powerRatio : 0;
      return;
    }
    if (!outputsReady(machine)) { machine.state = 'output_full'; return; }
    if (!inputsReady(machine)) { machine.state = 'waiting_input'; return; }
    if (powerRatio <= 0) { machine.state = 'no_energy'; return; }
    machine.state = 'active';
    machine.energyMW = def.energyMW * powerRatio;
    const batch = def.recipe.inputs.reduce((sum, item) => sum + item.amount, 0);
    const rate = machine.currentRate > 0 ? machine.currentRate : def.throughput * powerRatio;
    machine.cycleProgress += Data.config.fixedStepSeconds * rate / batch;
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
