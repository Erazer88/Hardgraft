(function (root) {
  'use strict';

  // Existing prototype parameters. Gameplay balancing belongs in later missions.
  root.OrbitConfig = Object.freeze({
    defaultSeed: 'NEREIDE-01',
    storageKey: 'nereide-atlas-v1',
    saveVersion: 6,
    camera: Object.freeze({ minZoom: .025, maxZoom: 2000000, easingRate: 9 }),
    simulation: Object.freeze({ maxFrameSeconds: .05 }),
    exploration: Object.freeze({ initialRadius: 590, scanRadius: 680, durationMs: 1900, detectionRatio: .84 }),
    terrain: Object.freeze({ width: 480, height: 360, textureScale: 3, maxLocalZoom: 4 })
  });
})(globalThis);
