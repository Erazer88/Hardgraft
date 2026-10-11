'use strict';

// In the source tree these files load relative to this worker. build.py embeds
// their contents in the standalone worker source so the exported HTML remains
// independent of extra network assets.
importScripts('../data/worldgen.js', '../data/surfaceStyle.js', '../world.js',
  '../rendering/surfaceMaterialMasks.js');

self.postMessage({ type: 'ready' });
self.onmessage = event => {
  const { id, seed, width, height, planet } = event.data;
  try {
    const generated = self.OrbitWorld.createTerrain(seed, width, height, planet);
    const terrain = {
      width: generated.width,
      height: generated.height,
      elevation: generated.elevation,
      moisture: generated.moisture,
      seaLevel: generated.seaLevel
    };
    const masks = self.OrbitSurfaceMaterialMasks.createPackedMasks(planet, terrain);
    self.postMessage({ id, terrain, masks }, [
      terrain.elevation.buffer,
      terrain.moisture.buffer,
      ...masks.map(mask => mask.buffer)
    ]);
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
