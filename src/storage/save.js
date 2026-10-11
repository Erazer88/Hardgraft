(function (root) {
  'use strict';
  const config = root.OrbitConfig;
  const copy = value => JSON.parse(JSON.stringify(value));
  const supportedSaveVersions = [2, 3, 4, 5, 6, config.saveVersion];

  // Houses are kept both in the settlement-wide list and on each road for
  // rendering. The settlement-wide list is authoritative when restoring, so
  // omit the per-road copies from saves to keep localStorage usage bounded.
  function snapshotSettlements(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const compactAsset = asset => root.OrbitSettlementSimulation?.assetKey(asset) ?? asset;
    return Object.fromEntries(Object.entries(value).map(([planetId, settlement]) => {
      if (!settlement || typeof settlement !== 'object') return [planetId, settlement];
      return [planetId, {
        version: settlement.version,
        planetId: settlement.planetId,
        generatedStage: settlement.generatedStage,
        roads: (settlement.roads || []).map(road => ({
          id: road.id, type: road.type, stage: road.stage, routeId: road.routeId,
          anchor: road.anchor, endpoint: road.endpoint, parentRoadId: road.parentRoadId,
          connectsToRoadId: road.connectsToRoadId, points: road.points, length: road.length,
          builtLength: road.builtLength
        })),
        houses: (settlement.houses || []).map(house => ({
          id: house.id, roadId: house.roadId, roadDistance: house.roadDistance,
          x: house.x, y: house.y, rotation: house.rotation, asset: compactAsset(house.asset)
        })),
        districts: (settlement.districts || []).map(district => ({
          id: district.id, roadId: district.roadId, routeId: district.routeId,
          mainRoadAsset: district.mainRoadAsset, roadDistance: district.roadDistance,
          x: district.x, y: district.y, rotation: district.rotation,
          variant: district.variant, asset: compactAsset(district.asset)
        }))
      }];
    }));
  }

  function load(storage) {
    try {
      const saved = JSON.parse(storage.getItem(config.storageKey) || 'null');
      if (!saved || typeof saved !== 'object' || !['string', 'number'].includes(typeof saved.seed)) return null;
      if (saved.version !== undefined && !supportedSaveVersions.includes(saved.version)) return null;
      return saved;
    } catch (_) { return null; }
  }

  function snapshot(state, galaxy, now = 0) {
    const context = state.context, planets = context?.model?.planets || [];
    const planetId = planets.find(planet => planet.id === state.focusPlanet?.id)?.id ||
      planets.find(planet => planet.id === state.planet?.id)?.id || null;
    const trackingPlanetId = state.tracking?.context === context
      ? planets.find(planet => planet.id === state.tracking.planet.id)?.id || null : null;
    return { version: config.saveVersion, seed: state.seed,
      discovered: galaxy.systems.filter(system => system.discovered).map(system => system.id),
      scans: copy(state.exploration.scans), visited: [...state.exploration.visited],
      missions: (state.exploration.missions || []).map(mission => ({
        x: mission.x, y: mission.y, from: copy(mission.from), radius: mission.radius, duration: mission.duration,
        elapsedMs: Math.max(0, Math.min(mission.duration, now - mission.start))
      })),
      time: state.simulation.time, reveal: Boolean(state.reveal),
      surfaceBuildings: copy(state.surfaceBuildings || []), roadNetworks: copy(state.roadNetworks || {}),
      surfaceSettlements: snapshotSettlements(state.surfaceSettlements),
      view: {
        camera: copy(state.camera), target: copy(state.target),
        contextStarId: context?.star?.id || null, planetId, trackingPlanetId
      } };
  }

  function save(storage, state, galaxy, now = 0) {
    try { storage.setItem(config.storageKey, JSON.stringify(snapshot(state, galaxy, now))); return true; }
    catch (_) { return false; }
  }

  function restore(state, galaxy, saved, now = 0) {
    if (!saved || saved.seed !== state.seed || (saved.version !== undefined && !supportedSaveVersions.includes(saved.version))) return false;
    const discovered = new Set(Array.isArray(saved.discovered) ? saved.discovered : []);
    galaxy.systems.forEach(system => { system.discovered = system.discovered || discovered.has(system.id); });
    if (Array.isArray(saved.scans) && saved.scans.length) state.exploration.scans = copy(saved.scans);
    state.exploration.missions = restoreMissions(saved.missions, now);
    state.exploration.visited = new Set(Array.isArray(saved.visited) ? saved.visited : []);
    state.reveal = Boolean(saved.reveal);
    state.surfaceBuildings = restoreBuildings(saved.surfaceBuildings);
    state.roadNetworks = restoreRoadNetworks(saved.roadNetworks, state.surfaceBuildings);
    state.surfaceSettlements = restoreSettlements(saved.surfaceSettlements);
    const simulation = root.OrbitSimulation.create();
    const time = saved.simulation?.time ?? saved.time;
    if (Number.isFinite(time) && time >= 0) simulation.time = time;
    state.simulation = simulation;
    return true;
  }

  function restoreMissions(value, now) {
    if (!Array.isArray(value)) return [];
    return value.flatMap(saved => {
      if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y) ||
          !saved.from || !Number.isFinite(saved.from.x) || !Number.isFinite(saved.from.y) ||
          !Number.isFinite(saved.radius) || !Number.isFinite(saved.duration) || saved.duration <= 0 ||
          !Number.isFinite(saved.elapsedMs)) return [];
      const elapsed = Math.max(0, Math.min(saved.duration, saved.elapsedMs));
      return [{ x: saved.x, y: saved.y, from: saved.from, radius: saved.radius,
        duration: saved.duration, start: now - elapsed }];
    });
  }

  function restoreBuildings(value) {
    if (!Array.isArray(value)) return [];
    const definitions = root.OrbitBuildingData, Building = root.OrbitSurfaceBuilding;
    return value.flatMap(saved => {
      if (!saved || typeof saved.id !== 'string' || typeof saved.type !== 'string' ||
          typeof saved.planetId !== 'string' || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return [];
      if (definitions && !definitions.get(saved.type)) return [];
      try { return [Building ? Building.create(saved) : copy(saved)]; }
      catch (_) { return []; }
    });
  }

  function restoreRoadNetworks(value, buildings) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !root.OrbitRoadNetwork) return {};
    const result = {};
    for (const [planetId, saved] of Object.entries(value)) {
      const network = root.OrbitRoadNetwork.restore(saved, planetId, buildings);
      if (network) result[planetId] = network;
    }
    return result;
  }

  function restoreSettlements(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !root.OrbitSettlementSimulation) return {};
    const result = {};
    for (const [planetId, saved] of Object.entries(value)) {
      if (typeof planetId === 'string' && planetId) {
        result[planetId] = root.OrbitSettlementSimulation.restore(saved, planetId);
      }
    }
    return result;
  }

  root.OrbitSave = Object.freeze({ load, save, snapshot, restore });
})(globalThis);
