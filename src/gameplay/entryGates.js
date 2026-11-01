(function (root) {
  'use strict';

  // Entry cards follow what is sent to a building: choosing a building as
  // the destination of an output dock (or of a depot's output gate) creates
  // its entry card, clearing the last such choice removes it. Factories and
  // waste heaps take one input dock per resource sent (one more, open to any
  // resource, for a depot's mixed flow); a depot takes one entry gate.
  // Removing an entry card by hand keeps the output docks that fed it and
  // only clears their destination. No DOM.
  const Graph = () => root.OrbitProcessGraph;
  const ENTRY = Object.freeze({ factory: 'input_dock', waste_heap: 'input_dock', storage: 'depot_input' });
  const MIXED = null;

  const entryType = building => ENTRY[building?.type] || null;

  // What reaches `target`: resource ids from docks, MIXED from depot gates.
  function incoming(state, target) {
    const wanted = new Set();
    for (const source of state.surfaceBuildings || []) {
      if (source.id === target.id || source.planetId !== target.planetId) continue;
      for (const [resourceId, destination] of Object.entries(source.dockDestinations || {})) {
        if (destination === target.id) wanted.add(resourceId);
      }
      if ((state.factoryPlans?.[source.id]?.machines || []).some(machine =>
        machine.type === 'depot_output' && machine.config?.destinationId === target.id)) wanted.add(MIXED);
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
    const result = Graph().addMachine(graph, { id: `entry-${index}`, type, ...freeSpot(graph),
      ...(type === 'input_dock' ? { importResourceId } : {}) });
    return result.ok;
  }

  // Brings a building's entry cards in line with what is sent to it; returns
  // whether its plan changed.
  function sync(state, target) {
    const type = entryType(target);
    if (!type || target.constructionState !== 'complete' || !root.OrbitIndustry) return false;
    const wanted = incoming(state, target);
    if (!wanted.size && !state.factoryPlans?.[target.id]) return false;
    const graph = root.OrbitIndustry.ensureGraph(state, target);
    const entries = graph.machines.filter(machine => machine.type === type);
    let changed = false;
    if (type === 'depot_input') {
      if (wanted.size && !entries.length) changed = addEntry(graph, type, null) || changed;
      if (!wanted.size) for (const entry of entries) changed = Graph().removeMachine(graph, entry.id).ok || changed;
      return changed;
    }
    // One input dock per resource sent; the dock of a mixed flow takes any.
    const kept = new Set();
    for (const resourceId of wanted) {
      if (resourceId === MIXED) continue;
      const dock = entries.find(entry => entry.importResourceId === resourceId && !kept.has(entry));
      if (dock) kept.add(dock);
      else changed = addEntry(graph, type, resourceId) || changed;
    }
    if (wanted.has(MIXED)) {
      const open = entries.find(entry => !kept.has(entry));
      if (open) kept.add(open); else changed = addEntry(graph, type, null) || changed;
    }
    for (const entry of entries) if (!kept.has(entry)) changed = Graph().removeMachine(graph, entry.id).ok || changed;
    return changed;
  }

  // Every building of the game; returns the ids whose plans changed.
  function syncAll(state) {
    return (state.surfaceBuildings || []).filter(building => sync(state, building)).map(building => building.id);
  }

  // An entry card removed by hand: the output docks and gates that fed it
  // keep their card, only their destination is cleared.
  function detach(state, target, entry) {
    const resourceId = entry.type === 'input_dock' ? entry.importResourceId || MIXED : MIXED;
    const everything = entry.type === 'depot_input';
    for (const source of state.surfaceBuildings || []) {
      if (source.id === target.id) continue;
      for (const [id, destination] of Object.entries(source.dockDestinations || {})) {
        if (destination === target.id && (everything || id === resourceId)) delete source.dockDestinations[id];
      }
      if (!everything && resourceId !== MIXED) continue;
      for (const machine of state.factoryPlans?.[source.id]?.machines || []) {
        if (machine.type === 'depot_output' && machine.config?.destinationId === target.id) delete machine.config.destinationId;
      }
    }
  }

  root.OrbitEntryGates = Object.freeze({ entryType, incoming, sync, syncAll, detach });
})(globalThis);
