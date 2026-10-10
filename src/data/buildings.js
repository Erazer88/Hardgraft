(function (root) {
  'use strict';

  // Footprints and port offsets use the planet surface's world coordinates:
  // the same map space as terrainTexture.width/height, never screen pixels.
  const definitions = {
    extractor: {
      id: 'extractor', label: 'EXTRACTEUR', category: 'resource', icon: 'extractor',
      footprint: { width: 28, height: 24 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 12 },
      placementRules: { landOnly: true, requiresDeposit: true },
      preferredTerrain: ['deposit', 'flat']
    },
    geothermal: {
      id: 'geothermal', label: 'GÉOTHERMIE', category: 'energy', icon: 'geothermal',
      footprint: { width: 30, height: 28 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 14 },
      placementRules: { landOnly: true, prefersElevatedTerrain: true },
      preferredTerrain: ['geothermal', 'elevated']
    },
    factory: {
      id: 'factory', label: 'USINE', category: 'industry', icon: 'factory',
      footprint: { width: 34, height: 28 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 14 },
      placementRules: { landOnly: true },
      preferredTerrain: ['flat']
    },
    storage: {
      id: 'storage', label: 'STOCKAGE', category: 'logistics', icon: 'storage',
      footprint: { width: 28, height: 24 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 12 },
      placementRules: { landOnly: true },
      preferredTerrain: ['flat']
    },
    hub: {
      id: 'hub', label: 'HUB', category: 'logistics', icon: 'hub',
      footprint: { width: 42, height: 36 }, roadRequired: false,
      roadPortOffset: { x: 0, y: 18 },
      placementRules: { landOnly: true },
      preferredTerrain: ['flat']
    },
    surface_port: {
      id: 'surface_port', label: 'PORT DE SURFACE', category: 'logistics', icon: 'surface-port',
      footprint: { width: 36, height: 28 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 14 },
      placementRules: { coastRequired: true },
      preferredTerrain: ['coast', 'flat']
    }
  };

  for (const definition of Object.values(definitions)) {
    Object.freeze(definition.footprint);
    if (definition.roadPortOffset) Object.freeze(definition.roadPortOffset);
    Object.freeze(definition.placementRules);
    Object.freeze(definition.preferredTerrain);
    Object.freeze(definition);
  }
  Object.freeze(definitions);

  root.OrbitBuildingData = Object.freeze({
    definitions,
    get(type) { return Object.prototype.hasOwnProperty.call(definitions, type) ? definitions[type] : null; }
  });
})(globalThis);
