(function (root) {
  'use strict';

  // Depot routing: cards pass mixed flows (any resource) between each other.
  // Input gates draw everything the depot received (noting the resources
  // that went through, machine.transited, saved); storage cards hold up to
  // bufferCapacity units while powered; filters, splitters and priority
  // cards route it; output gates queue it per
  // destination in building.gateStock, which the road network then delivers.
  // Every card holds its units in machine.storedResources.
  const Data = root.OrbitProcessData;
  const Graph = root.OrbitProcessGraph;
  const Mix = root.OrbitComposition;
  const definition = machine => Graph.definitionOf(machine);
  const total = held => Object.values(held).reduce((sum, amount) => sum + amount, 0);

  function room(machine, resourceId) {
    const settings = Data.config.depot, held = machine.storedResources;
    if (machine.type === 'depot_buffer') return machine.unpowered ? 0 : Math.max(0, settings.bufferCapacity - total(held));
    return Math.max(0, settings.cardCapacity - total(held));
  }

  // Units leave with the composition of the card's stock (rock only).
  function take(machine, resourceId, amount) {
    const composition = Mix?.of(machine.storedMix, resourceId);
    machine.storedResources[resourceId] -= amount;
    if (machine.storedResources[resourceId] <= 0) {
      delete machine.storedResources[resourceId];
      Mix?.prune(machine.storedMix, resourceId, 0);
    }
    return composition;
  }

  function give(machine, resourceId, amount, composition = null) {
    // A filter gets an output for each resource that reaches it.
    if (definition(machine)?.sortsByResource) Graph.addSortResource(machine, resourceId);
    Mix?.add(machine.storedMix ||= {}, resourceId, resourceId, machine.storedResources[resourceId] || 0, amount, composition);
    machine.storedResources[resourceId] = (machine.storedResources[resourceId] || 0) + amount;
  }

  // Output ports a card would send this unit to, in order of preference. A
  // filter sends each resource to its own output, or to 'other' while that
  // output is not linked.
  function routes(machine, resourceId, linked) {
    const config = machine.config || {};
    if (machine.type === 'depot_filter') {
      const port = Graph.sortPort(resourceId);
      return [linked(machine, port) ? port : 'other'];
    }
    if (machine.type === 'depot_priority') return ['primary', 'overflow'];
    if (machine.type === 'depot_splitter') {
      // Keep the sent counts near the chosen share, falling back to the other output.
      const share = (config.splitPercent ?? 50) / 100, sent = machine.splitSent ||= { a: 0, b: 0 };
      const all = sent.a + sent.b, preferA = all === 0 ? share >= .5 : sent.a / all < share;
      return preferA ? ['a', 'b'] : ['b', 'a'];
    }
    return ['out'];
  }

  // Units a gate may move this step; logical gates (no throughput) move all.
  function gateCredit(machine, settings, step) {
    if (settings.gateThroughput == null) return Infinity;
    return Math.min(settings.gateThroughput, (machine.gateCredit || 0) + settings.gateThroughput * step);
  }

  // Resources that reach a card: what the cards before it hold, and what the
  // entry gates before them let in.
  function upstreamResources(graph, machine, seen = new Set()) {
    const found = new Set();
    for (const connection of graph.connections) {
      if (connection.toMachineId !== machine.id) continue;
      const from = graph.machines.find(item => item.id === connection.fromMachineId);
      if (!from || seen.has(from.id)) continue;
      seen.add(from.id);
      for (const id of Object.keys(from.storedResources || {})) found.add(id);
      for (const id of Object.keys(from.transited || {})) found.add(id);
      for (const id of upstreamResources(graph, from, seen)) found.add(id);
    }
    return found;
  }

  // Power the depot's cards ask for: storage cards draw theirs all the time.
  function demand(graph) {
    return graph.machines.reduce((sum, machine) => definition(machine)?.constantEnergy ? sum + definition(machine).energyMW : sum, 0);
  }

  // powerRatio: the share of its demand the planet can give (1 = all).
  function advance(graph, seconds, building, powerRatio = 1) {
    const step = Data.config.fixedStepSeconds, settings = Data.config.depot;
    // Without power, a storage card takes nothing in and lets nothing out.
    for (const machine of graph.machines) machine.unpowered = Boolean(definition(machine)?.constantEnergy) && !(powerRatio > 0);
    graph.accumulator = (graph.accumulator || 0) + seconds;
    const order = Graph.topologicalOrder(graph);
    const targets = new Map();
    for (const connection of graph.connections) {
      const list = targets.get(`${connection.fromMachineId}:${connection.fromOutputId}`) || [];
      list.push(graph.machines.find(machine => machine.id === connection.toMachineId));
      targets.set(`${connection.fromMachineId}:${connection.fromOutputId}`, list.filter(Boolean));
    }
    const linked = (machine, port) => (targets.get(`${machine.id}:${port}`) || []).length > 0;
    // A filter lists what its upstream cards hold or let in, before any of it arrives.
    for (const machine of graph.machines) {
      if (definition(machine)?.sortsByResource) for (const resourceId of upstreamResources(graph, machine)) Graph.addSortResource(machine, resourceId);
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
          machine.gateCredit = gateCredit(machine, settings, step);
          const stock = building.inventory ||= {};
          let moved = true;
          while (moved && machine.gateCredit >= 1) {
            moved = false;
            for (const resourceId of Object.keys(stock).sort()) {
              if (machine.gateCredit < 1) break;
              if (!(stock[resourceId] >= 1) || room(machine, resourceId) < 1) continue;
              const composition = Mix?.of(building.inventoryMix, resourceId);
              stock[resourceId] -= 1;
              if (stock[resourceId] <= 0) { delete stock[resourceId]; Mix?.prune(building.inventoryMix, resourceId, 0); }
              give(machine, resourceId, 1, composition);
              (machine.transited ||= {})[resourceId] = true;
              machine.gateCredit -= 1; machine.movedUnits++; moved = true;
            }
          }
        }
        if (gate === 'output') {
          // Queue held units for the chosen destination.
          machine.gateCredit = gateCredit(machine, settings, step);
          const destinationId = machine.config?.destinationId;
          if (!destinationId) continue;
          building.gateStock ||= {};
          const queue = building.gateStock[destinationId] ||= {};
          for (const resourceId of Object.keys(machine.storedResources).sort()) {
            const amount = Math.min(machine.storedResources[resourceId], Math.floor(machine.gateCredit));
            if (amount <= 0) continue;
            const composition = take(machine, resourceId, amount);
            Mix?.add((building.gateMix ||= {})[destinationId] ||= {}, resourceId, resourceId, queue[resourceId] || 0, amount, composition);
            queue[resourceId] = (queue[resourceId] || 0) + amount;
            machine.gateCredit -= amount; machine.movedUnits += amount;
          }
          continue;
        }
        // Push every held unit down its preferred route while there is room.
        if (machine.unpowered) continue;
        for (const resourceId of Object.keys(machine.storedResources).sort()) {
          while (machine.storedResources[resourceId] > 0) {
            let target = null;
            for (const port of routes(machine, resourceId, linked)) {
              target = (targets.get(`${machine.id}:${port}`) || []).find(candidate => room(candidate, resourceId) >= 1);
              if (target) { if (machine.splitSent) machine.splitSent[port] = (machine.splitSent[port] || 0) + 1; break; }
            }
            if (!target) break;
            give(target, resourceId, 1, take(machine, resourceId, 1));
            machine.movedUnits++;
          }
        }
      }
    }
    for (const machine of graph.machines) {
      const held = total(machine.storedResources), elapsed = Math.max(step, ticks * step);
      machine.currentRate = machine.movedUnits / elapsed;
      // Units moved since the game started (runtime only), for the editor's rate.
      machine.movedTotal = (machine.movedTotal || 0) + machine.movedUnits;
      machine.state = machine.unpowered ? 'no_energy' : machine.movedUnits > 0 ? 'active' : held > 0 ? 'output_full' : 'waiting_input';
      machine.energyMW = definition(machine)?.constantEnergy ? definition(machine).energyMW * Math.max(0, Math.min(1, powerRatio)) : 0;
      if (machine.splitSent && machine.splitSent.a + machine.splitSent.b > 1000) {
        machine.splitSent.a /= 2; machine.splitSent.b /= 2;
      }
    }
    graph.energyDemandMW = demand(graph);
    graph.energyUsedMW = graph.machines.reduce((sum, machine) => sum + (machine.energyMW || 0), 0);
    return graph;
  }

  root.OrbitDepotRouting = Object.freeze({ advance, demand });
})(globalThis);
