(function (scope) {
  'use strict';

  if (!scope.OrbitWorld) {
    scope.importScripts('../data/worldgen.js', '../world.js', '../world/tectonics.js',
      '../world/terrainElevation.js', '../world/thermalErosion.js', '../world/terrainStructure.js',
      '../data/planetGlobeStyle.js', '../rendering/planetGlobeProjection.js',
      '../rendering/planetSurfaceTexture.js', '../rendering/planetTerrainVisuals.js');
  }

  function transferables(value, found = [], buffers = new Set(), visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return found;
    visited.add(value);
    if (ArrayBuffer.isView(value)) {
      if ((typeof SharedArrayBuffer === 'undefined' || !(value.buffer instanceof SharedArrayBuffer)) &&
          !buffers.has(value.buffer)) {
        buffers.add(value.buffer); found.push(value.buffer);
      }
      return found;
    }
    if (value instanceof ArrayBuffer) {
      if (!buffers.has(value)) { buffers.add(value); found.push(value); }
      return found;
    }
    for (const key of Object.keys(value)) transferables(value[key], found, buffers, visited);
    return found;
  }

  scope.onmessage = event => {
    const { id, planet, width, height, textureWidth, style } = event.data || {};
    try {
      const terrain = scope.OrbitWorld.createTerrain(planet.seed, width, height, planet);
      const surface = scope.OrbitPlanetSurfaceTexture.create(terrain, planet, {
        width: textureWidth, height: textureWidth / 2,
        polarCaps: style.polarCaps,
        coastSmoothing: style.stylizedTerrain.coastSmoothing,
        coastFieldBlur: style.stylizedTerrain.coastFieldBlur,
        cache: false
      });
      const visual = scope.OrbitPlanetTerrainVisuals.create(terrain, planet, style);
      const assets = { surface, visual, visualStyleKey: scope.OrbitPlanetTerrainVisuals.styleKey(style) };
      const transfer = transferables({ terrain, assets });
      scope.postMessage({ id, terrain, assets }, transfer);
    } catch (error) {
      scope.postMessage({ id, error: error?.stack || String(error) });
    }
  };
})(self);
