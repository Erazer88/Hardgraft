(function (root) {
  'use strict';

  // Existing prototype parameters. Gameplay balancing belongs in later missions.
  root.OrbitConfig = Object.freeze({
    defaultSeed: 'NEREIDE-01',
    storageKey: 'nereide-atlas-v1',
    saveVersion: 9,
    camera: Object.freeze({ minZoom: .025, maxZoom: 2000000, easingRate: 9 }),
    simulation: Object.freeze({ maxFrameSeconds: .05 }),
    exploration: Object.freeze({ initialRadius: 590, scanRadius: 680, durationMs: 1900, detectionRatio: .84 }),
    terrain: Object.freeze({ width: 960, height: 360, textureScale: 3, renderDetailFactor: 4,
      renderTexturePixelRatio: 2, materialTexturePixelsPerKm: 3.4,
      materialTextureMaxDetailMultiplier: 2, materialTextureTileScale: 1.45,
      materialTextureResolutionScale: .5,
      materialTextureDetailBlendStartZoom: .55, materialTextureDetailBlendEndZoom: 1.45,
      materialTextureMaxBlend: .72, materialPreviewReleaseRadiusPx: 18, maxLocalZoom: 4 })
  });
})(globalThis);
