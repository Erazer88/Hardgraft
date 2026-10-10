(function (root) {
  'use strict';

  function create() {
    return { time: 0 };
  }

  function advance(simulation, seconds, running = true) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Simulation duration must be finite and non-negative.');
    if (running) simulation.time += seconds;
    return simulation;
  }

  root.OrbitSimulation = Object.freeze({ create, advance });
})(globalThis);
