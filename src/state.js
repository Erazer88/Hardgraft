(function (root) {
  'use strict';

  function normalizedSeed(value) {
    const text = String(value).trim() || root.OrbitConfig.defaultSeed;
    return /^\d{1,9}$/.test(text) ? Number(text) : text.slice(0, 64);
  }

  function create() {
    return { seed: root.OrbitConfig.defaultSeed, simulation: root.OrbitSimulation.create(),
      exploration: root.OrbitExploration.create(), level: 'galaxy', selected: null,
      system: null, planet: null, camera: { x: 0, y: 0, zoom: .1 }, target: { x: 0, y: 0, zoom: .1 },
      paused: false, reveal: false, tool: 'pan', context: null,
      tracking: null, focusPlanet: null, surfaceBuildings: [], roadNetworks: {}, placement: null, buildMenuOpen: false };
  }

  root.OrbitState = Object.freeze({ create, normalizedSeed });
})(globalThis);
