(function (root) {
  'use strict';

  // Undo of the last actions taken in the planet and galaxy views: a
  // building placed or demolished, a road drawn, a probe sent. Each record
  // keeps what puts the game back as it was before the action; the newest
  // is undone first. Runtime only (not saved), at most LIMIT records. No DOM.
  const LIMIT = 30;
  const copy = value => JSON.parse(JSON.stringify(value));

  function create() { return { records: [] }; }
  function clear(history) { history.records.length = 0; }
  const canUndo = history => history.records.length > 0;
  function push(history, record) {
    history.records.push(record);
    if (history.records.length > LIMIT) history.records.shift();
  }

  const networkCopy = (state, planetId) => state.roadNetworks?.[planetId] ? copy(state.roadNetworks[planetId]) : null;
  const label = type => root.OrbitBuildingData?.get(type)?.label || 'Bâtiment';

  // A planet's roads as they were, keeping the building progress of the
  // segments that are still there.
  function restoreRoads(state, planetId, saved) {
    const current = state.roadNetworks?.[planetId];
    if (!saved) { delete state.roadNetworks[planetId]; return; }
    const restored = root.OrbitRoadNetwork.restore(copy(saved), planetId, state.surfaceBuildings);
    if (!restored) return;
    for (const segment of restored.segments) {
      const now = current?.segments.find(item => item.id === segment.id);
      if (now && Number.isFinite(now.builtLength)) segment.builtLength = Math.min(segment.length, Math.max(segment.builtLength, now.builtLength));
    }
    state.roadNetworks[planetId] = restored;
  }

  // Takes a building off the planet with its roads and its plan.
  function takeOff(state, building) {
    for (const network of Object.values(state.roadNetworks || {})) {
      root.OrbitRoadNetwork.removeBuildingRoads(network, building.id);
      root.OrbitRoadNetwork.detachBuilding(network, building.id);
    }
    state.surfaceBuildings = state.surfaceBuildings.filter(candidate => candidate.id !== building.id);
    delete state.factoryPlans?.[building.id];
  }

  function recordPlacement(history, building) {
    push(history, { kind: 'place', buildingId: building.id, type: building.type, planetId: building.planetId });
  }

  // Before a demolition: the building, its plan and its planet's roads.
  function beforeDemolition(state, building) {
    const plan = state.factoryPlans?.[building.id];
    return { kind: 'demolish', building: copy(building), type: building.type, planetId: building.planetId,
      plan: plan && root.OrbitProcessGraph ? copy(root.OrbitProcessGraph.snapshot(plan)) : null,
      roads: networkCopy(state, building.planetId) };
  }
  function recordDemolition(history, before, refund) { push(history, { ...before, refund: copy(refund || {}) }); }

  function beforeRoad(state, planetId) { return { kind: 'road', planetId, roads: networkCopy(state, planetId) }; }
  function recordRoad(history, before) { push(history, before); }

  function recordProbe(history, mission) { push(history, { kind: 'probe', mission }); }

  // Undoes the newest action; returns { ok, message, planetId? }.
  function undo(history, state) {
    const record = history.records.pop();
    if (!record) return { ok: false, message: 'Rien à annuler.' };
    if (record.kind === 'place') {
      const building = state.surfaceBuildings.find(item => item.id === record.buildingId);
      if (!building) return { ok: false, message: `${label(record.type)} déjà retiré.` };
      root.OrbitConstruction?.demolish(building, state.inventory);
      takeOff(state, building);
      return { ok: true, message: `Pose annulée : ${label(record.type)}.`, planetId: record.planetId };
    }
    if (record.kind === 'demolish') {
      if (state.surfaceBuildings.some(item => item.id === record.building.id)) return { ok: false, message: 'Ce bâtiment est déjà là.' };
      const Building = root.OrbitSurfaceBuilding;
      state.surfaceBuildings.push(Building ? Building.create(copy(record.building)) : copy(record.building));
      if (record.plan && root.OrbitProcessGraph) (state.factoryPlans ||= {})[record.building.id] = root.OrbitProcessGraph.create(copy(record.plan));
      restoreRoads(state, record.planetId, record.roads);
      // What the demolition gave back is taken again, as far as it is left.
      for (const [id, amount] of Object.entries(record.refund || {})) {
        if (!(amount > 0) || !(state.inventory?.[id] > 0)) continue;
        state.inventory[id] -= Math.min(state.inventory[id], amount);
        if (state.inventory[id] <= 1e-9) delete state.inventory[id];
      }
      state.colonyMaterials = (state.colonyMaterials || []).filter(stack => stack?.origin?.id !== record.building.id);
      return { ok: true, message: `Démolition annulée : ${label(record.type)}.`, planetId: record.planetId };
    }
    if (record.kind === 'road') {
      restoreRoads(state, record.planetId, record.roads);
      return { ok: true, message: 'Route annulée.', planetId: record.planetId };
    }
    if (record.kind === 'probe') {
      const missions = state.exploration?.missions || [];
      const index = missions.indexOf(record.mission);
      if (index < 0) return { ok: false, message: 'La sonde a déjà fini son relevé.' };
      missions.splice(index, 1);
      return { ok: true, message: 'Sonde rappelée.' };
    }
    return { ok: false, message: 'Rien à annuler.' };
  }

  root.OrbitUndo = Object.freeze({ create, clear, canUndo, recordPlacement, beforeDemolition, recordDemolition,
    beforeRoad, recordRoad, recordProbe, undo, LIMIT });
})(globalThis);
