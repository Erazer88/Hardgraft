(function (root) {
  'use strict';

  // Depot routing: cards pass mixed flows (any resource) between each other.
  // Input gates draw everything the depot received; buffers, filters,
  // splitters and priority cards route it; output gates queue it per
  // destination in building.gateStock, which the road network then delivers.
  // Every card holds its units in machine.storedResources.
  const Data = root.OrbitProcessData;
  const Graph = root.OrbitProcessGraph;
  const definition = machine => Graph.definitionOf(machine);
  const total = held => Object.values(held).reduce((sum, amount) => sum + amount, 0);

  function room(machine, resourceId) {
    const settings = Data.config.depot, held = machine.storedResources;
    if (machine.type === 'depot_buffer') return Math.max(0, settings.bufferCapacity - (held[resourceId] || 0));
    return Math.max(0, settings.cardCapacity - total(held));
  }

  function take(machine, resourceId, amount) {
    machine.storedResources[resourceId] -= amount;
    if (machine.storedResources[resourceId] <= 0) delete machine.storedResources[resourceId];
  }

  function give(machine, resourceId, amount) {
    machine.storedResources[resourceId] = (machine.storedResources[resourceId] || 0) + amount;
  }

  // Output ports a card would send this unit to, in order of preference.
  function routes(machine, resourceId) {
    const config = machine.config || {};
    if (machine.type === 'depot_filter') return [resourceId === config.filterResourceId ? 'match' : 'other'];
    if (machine.type === 'depot_priority') return ['primary', 'overflow'];
    if (machine.type === 'depot_splitter') {
      // Keep the sent counts near the chosen share, falling back to the other output.
      const share = (config.splitPercent ?? 50) / 100, sent = machine.splitSent ||= { a: 0, b: 0 };
      const all = sent.a + sent.b, preferA = all === 0 ? share >= .5 : sent.a / all < share;
      return preferA ? ['a', 'b'] : ['b', 'a'];
    }
    return ['out'];
  }

  function advance(graph, seconds, building) {
    const step = Data.config.fixedStepSeconds, settings = Data.config.depot;
    graph.accumulator = (graph.accumulator || 0) + seconds;
    const order = Graph.topologicalOrder(graph);
    const targets = new Map();
    for (const connection of graph.connections) {
      const list = targets.get(`${connection.fromMachineId}:${connection.fromOutputId}`) || [];
      list.push(graph.machines.find(machine => machine.id === connection.toMachineId));
      targets.set(`${connection.fromMachineId}:${connection.fromOutputId}`, list.filter(Boolean));
    }
    for (const machine of graph.machines) machine.movedUnits = 0;
    let ticks = 0;
    while (graph.accumulator + 1e-9 >= step && ticks < Data.config.maxTicksPerAdvance) {
      graph.accumulator = Math.max(0, graph.accumulator - step);
      ticks++;
      for (const machine of order) {
        const gate = definition(machine).gate;
        if (gate === 'input') {
          // Draw received stock, one unit at a time across resources.
          machine.gateCredit = Math.min(settings.gateThroughput, (machine.gateCredit || 0) + settings.gateThroughput * step);
          const stock = building.inventory ||= {};
          let moved = true;
          while (moved && machine.gateCredit >= 1) {
            moved = false;
            for (const resourceId of Object.keys(stock).sort()) {
              if (machine.gateCredit < 1) break;
              if (!(stock[resourceId] >= 1) || room(machine, resourceId) < 1) continue;
              stock[resourceId] -= 1;
              if (stock[resourceId] <= 0) delete stock[resourceId];
              give(machine, resourceId, 1);
              machine.gateCredit -= 1; machine.movedUnits++; moved = true;
            }
          }
        }
        if (gate === 'output') {
          // Queue held units for the chosen destination.
          machine.gateCredit = Math.min(settings.gateThroughput, (machine.gateCredit || 0) + settings.gateThroughput * step);
          const destinationId = machine.config?.destinationId;
          if (!destinationId) continue;
          building.gateStock ||= {};
          const queue = building.gateStock[destinationId] ||= {};
          for (const resourceId of Object.keys(machine.storedResources).sort()) {
            const amount = Math.min(machine.storedResources[resourceId], Math.floor(machine.gateCredit));
            if (amount <= 0) continue;
            take(machine, resourceId, amount);
            queue[resourceId] = (queue[resourceId] || 0) + amount;
            machine.gateCredit -= amount; machine.movedUnits += amount;
          }
          continue;
        }
        // Push every held unit down its preferred route while there is room.
        for (const resourceId of Object.keys(machine.storedResources).sort()) {
          while (machine.storedResources[resourceId] > 0) {
            let target = null;
            for (const port of routes(machine, resourceId)) {
              target = (targets.get(`${machine.id}:${port}`) || []).find(candidate => room(candidate, resourceId) >= 1);
              if (target) { if (machine.splitSent) machine.splitSent[port] = (machine.splitSent[port] || 0) + 1; break; }
            }
            if (!target) break;
            take(machine, resourceId, 1); give(target, resourceId, 1);
            machine.movedUnits++;
          }
        }
      }
    }
    for (const machine of graph.machines) {
      const held = total(machine.storedResources), elapsed = Math.max(step, ticks * step);
      machine.currentRate = machine.movedUnits / elapsed;
      machine.state = machine.movedUnits > 0 ? 'active' : held > 0 ? 'output_full' : 'waiting_input';
      machine.energyMW = 0;
      if (machine.splitSent && machine.splitSent.a + machine.splitSent.b > 1000) {
        machine.splitSent.a /= 2; machine.splitSent.b /= 2;
      }
    }
    graph.energyUsedMW = 0;
    graph.energyDemandMW = 0;
    return graph;
  }

  root.OrbitDepotRouting = Object.freeze({ advance });
})(globalThis);
