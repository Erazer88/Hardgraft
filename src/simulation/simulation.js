(function (root) {
  'use strict';

  // Plain, serializable data. No Canvas, browser clock, or gameplay recipes.
  function create() {
    return { time: 0, resources: {}, deposits: {}, buildings: {}, factories: {}, nextBuildingId: 1, infiniteMaterials: false };
  }

  function advance(simulation, seconds, running = true) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Simulation duration must be finite and non-negative.');
    if (running) simulation.time += seconds;
    return simulation;
  }

  root.OrbitSimulation = Object.freeze({ create, advance });
})(globalThis);
