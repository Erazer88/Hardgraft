(function (root) {
  'use strict';
  const config = root.OrbitConfig;
  const copy = value => JSON.parse(JSON.stringify(value));

  function load(storage) {
    try {
      const saved = JSON.parse(storage.getItem(config.storageKey) || 'null');
      if (!saved || typeof saved !== 'object' || !['string', 'number'].includes(typeof saved.seed)) return null;
      if (saved.version !== undefined && ![2, config.saveVersion].includes(saved.version)) return null;
      return saved;
    } catch (_) { return null; }
  }

  function snapshot(state, galaxy) {
    return { version: config.saveVersion, seed: state.seed,
      discovered: galaxy.systems.filter(system => system.discovered).map(system => system.id),
      scans: copy(state.exploration.scans), visited: [...state.exploration.visited],
      time: state.simulation.time };
  }

  function save(storage, state, galaxy) {
    try { storage.setItem(config.storageKey, JSON.stringify(snapshot(state, galaxy))); return true; }
    catch (_) { return false; }
  }

  function restore(state, galaxy, saved) {
    if (!saved || saved.seed !== state.seed || (saved.version !== undefined && ![2, config.saveVersion].includes(saved.version))) return false;
    const discovered = new Set(Array.isArray(saved.discovered) ? saved.discovered : []);
    galaxy.systems.forEach(system => { system.discovered = system.discovered || discovered.has(system.id); });
    if (Array.isArray(saved.scans) && saved.scans.length) state.exploration.scans = copy(saved.scans);
    state.exploration.visited = new Set(Array.isArray(saved.visited) ? saved.visited : []);
    const simulation = root.OrbitSimulation.create();
    const time = saved.simulation?.time ?? saved.time;
    if (Number.isFinite(time) && time >= 0) simulation.time = time;
    state.simulation = simulation;
    return true;
  }

  root.OrbitSave = Object.freeze({ load, save, snapshot, restore });
})(globalThis);
