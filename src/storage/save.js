(function (root) {
  'use strict';
  const config = root.OrbitConfig;
  const copy = value => JSON.parse(JSON.stringify(value));
  const supportedSaveVersions = [2, 3, config.saveVersion];

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
      surfaceBuildings: copy(state.surfaceBuildings || []),
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

  root.OrbitSave = Object.freeze({ load, save, snapshot, restore });
})(globalThis);
