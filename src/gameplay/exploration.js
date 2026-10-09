(function (root) {
  'use strict';
  const config = root.OrbitConfig.exploration;

  function create(home) {
    return { scans: home ? [{ x: home.x, y: home.y, radius: config.initialRadius }] : [],
      missions: [], visited: new Set() };
  }

  function launch(exploration, from, destination, now) {
    const mission = { x: destination.x, y: destination.y, from: { x: from.x, y: from.y },
      radius: config.scanRadius, start: now, duration: config.durationMs };
    exploration.missions.push(mission);
    return mission;
  }

  // Milliseconds are supplied by the controller. Existing probes keep their
  // real-time behaviour even when the orbital animation is paused.
  function advance(exploration, galaxy, now) {
    const completed = [], pending = [];
    for (const mission of exploration.missions) {
      if (now - mission.start < mission.duration) { pending.push(mission); continue; }
      let discoveredCount = 0;
      exploration.scans.push({ x: mission.x, y: mission.y, radius: mission.radius });
      for (const system of galaxy.systems) {
        if (!system.discovered && Math.hypot(system.x - mission.x, system.y - mission.y) < mission.radius * config.detectionRatio) {
          system.discovered = true; discoveredCount++;
        }
      }
      completed.push({ mission, discoveredCount });
    }
    exploration.missions = pending;
    return completed;
  }

  root.OrbitExploration = Object.freeze({ create, launch, advance });
})(globalThis);
