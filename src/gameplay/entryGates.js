(function (root) {
  'use strict';

  // Entry cards follow what is sent to a building. A factory or a waste heap
  // takes each resource through an input dock set to it (importResourceId);
  // a depot takes everything through one entry gate. When a building is
  // chosen as the destination of an output dock (or of a depot's output
  // gate), each resource sent to a factory gets its input dock: one already
  // set to it, else a free one the player laid (it is linked to the
  // resource), else a new one laid by the game (autoEntry); a depot gets its
  // entry gate (the player's, else one laid by the game). Cards laid by the game go once nothing is
  // sent to them any more; the player's own cards stay. Removing an entry
  // card by hand keeps the output docks that fed it and only clears their
  // destination. No DOM.
  const Graph = () => root.OrbitProcessGraph;
  const ENTRY = Object.freeze({ factory: 'input_dock', waste_heap: 'input_dock', storage: 'depot_input' });

  const entryType = building => ENTRY[building?.type] || null;

  // Depot output gates sending to `target`.
  const gatesTo = (state, source, target) => (state.factoryPlans?.[source.id]?.machines || []).some(machine =>
    machine.type === 'depot_output' && machine.config?.destinationId === target.id);

  // Resource ids sent to `target`: by output docks, and by depot gates
  // (those waiting in the gate's queue, and those it already delivered).
  function incoming(state, target) {
    const wanted = new Set();
    for (const source of state.surfaceBuildings || []) {
      if (source.id === target.id || source.planetId !== target.planetId) continue;
      for (const [resourceId, destination] of Object.entries(source.dockDestinations || {})) {
        if (destination === target.id) wanted.add(resourceId);
      }
      if (!gatesTo(state, source, target)) continue;
      for (const [resourceId, amount] of Object.entries(source.gateStock?.[target.id] || {})) if (amount > 0) wanted.add(resourceId);
      for (const resourceId of Object.keys(target.receivedFrom?.[source.id] || {})) wanted.add(resourceId);
    }
    return wanted;
  }

  // A free spot on the left of the plan for a new entry card.
  function freeSpot(graph) {
    const width = 258, height = 220, x = 40;
    for (let y = 40; y < 5000; y += 30) {
      const clear = graph.machines.every(machine => machine.x + width + 20 <= x || x + width + 20 <= machine.x ||
        machine.y + height + 20 <= y || y + height + 20 <= machine.y);
      if (clear) return { x, y };
    }
    return { x, y: 40 };
  }

  function addEntry(graph, type, importResourceId) {
    const ids = new Set(graph.machines.map(machine => machine.id));
    let index = graph.machines.length + 1;
    while (ids.has(`entry-${index}`)) index++;
    return Graph().addMachine(graph, { id: `entry-${index}`, type, ...freeSpot(graph),
      ...(type === 'input_dock' ? { importResourceId } : {}), autoEntry: true }).ok;
  }

  // Brings a building's entry cards in line with what is sent to it; returns
  // whether its plan changed.
  function sync(state, target) {
    const type = entryType(target);
    if (!type || target.constructionState !== 'complete' || !root.OrbitIndustry) return false;
    const wanted = incoming(state, target);
    // Anything sent, or a depot gate pointed at it (whatever it carries).
    const fed = wanted.size > 0 || (state.surfaceBuildings || []).some(source => source.id !== target.id &&
      source.planetId === target.planetId && gatesTo(state, source, target));
    if (!fed && !state.factoryPlans?.[target.id]) return false;
    const graph = root.OrbitIndustry.ensureGraph(state, target);
    const entries = graph.machines.filter(machine => machine.type === type);
    let changed = false;
    if (type === 'depot_input') {
      if (fed && !entries.length) changed = addEntry(graph, type, null);
      // The game's gate goes once nothing comes any more.
      if (!fed) for (const entry of entries) if (entry.autoEntry) changed = Graph().removeMachine(graph, entry.id).ok || changed;
      return changed;
    }
    for (const resourceId of [...wanted].sort()) {
      if (entries.some(entry => entry.importResourceId === resourceId)) continue;
      const free = entries.find(entry => !entry.importResourceId);
      if (free) { free.importResourceId = resourceId; changed = true; }
      else changed = addEntry(graph, type, resourceId) || changed;
    }
    for (const entry of entries) {
      if (entry.autoEntry && !wanted.has(entry.importResourceId)) changed = Graph().removeMachine(graph, entry.id).ok || changed;
    }
    return changed;
  }

  // Every building of the game; returns the ids whose plans changed.
  function syncAll(state) {
    return (state.surfaceBuildings || []).filter(building => sync(state, building)).map(building => building.id);
  }

  // An entry card removed by hand: the output docks and gates that fed it
  // keep their card, only their destination is cleared (a gate's, once no
  // other entry card of the building takes what it sends).
  function detach(state, target, entry) {
    if (entry.type === 'depot_input') {
      // A depot's last entry gate: nothing is sent there any more.
      if ((state.factoryPlans?.[target.id]?.machines || []).some(machine => machine.id !== entry.id && machine.type === 'depot_input')) return;
      for (const source of state.surfaceBuildings || []) {
        if (source.id === target.id) continue;
        for (const [id, destination] of Object.entries(source.dockDestinations || {})) if (destination === target.id) delete source.dockDestinations[id];
        for (const machine of state.factoryPlans?.[source.id]?.machines || []) {
          if (machine.type === 'depot_output' && machine.config?.destinationId === target.id) delete machine.config.destinationId;
        }
      }
      return;
    }
    const resourceId = entry.importResourceId || null;
    if (!resourceId) return;
    const others = new Set((state.factoryPlans?.[target.id]?.machines || [])
      .filter(machine => machine.id !== entry.id && machine.type === entry.type && machine.importResourceId)
      .map(machine => machine.importResourceId));
    if (others.has(resourceId)) return;
    for (const source of state.surfaceBuildings || []) {
      if (source.id === target.id) continue;
      if (source.dockDestinations?.[resourceId] === target.id) delete source.dockDestinations[resourceId];
      if (!gatesTo(state, source, target)) continue;
      // A gate sends a mixed flow: it loses its destination once none of
      // what it sent there has an entry card left.
      const sent = new Set([...Object.keys(source.gateStock?.[target.id] || {}), ...Object.keys(target.receivedFrom?.[source.id] || {})]);
      if ([...sent].some(id => id !== resourceId && others.has(id))) continue;
      for (const machine of state.factoryPlans?.[source.id]?.machines || []) {
        if (machine.type === 'depot_output' && machine.config?.destinationId === target.id) delete machine.config.destinationId;
      }
    }
  }

  root.OrbitEntryGates = Object.freeze({ entryType, incoming, sync, syncAll, detach });
})(globalThis);
