(function (root) {
  'use strict';

  // Footprints, points of connection, and offsets use planetary world units.
  // Simulation behavior is declared here but implemented in later blocks.
  const definitions = {
    factory: {
      id: 'factory', label: 'USINE', shortLabel: 'US', category: 'industry', icon: 'factory',
      sprite: 'assets/buildings/factory.webp', spriteAspectRatio: 4 / 3,
      description: 'Transforme les minerais en matériaux.',
      functions: { transformsMinerals: true },
      footprint: { width: 34, height: 28 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 14 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat']
    },
    extractor: {
      id: 'extractor', label: 'EXTRACTEUR', shortLabel: 'EX', category: 'resource', icon: 'extractor',
      sprite: 'assets/buildings/extractor.webp',
      description: 'Extrait les minerais des gisements compatibles.',
      functions: { extractsResources: true }, extracts: ['iron', 'copper', 'silicon', 'carbon'],
      footprint: { width: 28, height: 24 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 12 },
      placementRules: { landOnly: true, requiresDeposit: true, depositMargin: 12 },
      preferredTerrain: ['deposit', 'flat']
    },
    surface_port: {
      id: 'surface_port', label: 'PORT', shortLabel: 'PO', category: 'logistics', icon: 'surface-port',
      sprite: 'assets/buildings/surface-port.webp', spriteRotationOffset: Math.PI / 2,
      description: 'Relie les quais maritimes au réseau de camions.',
      functions: { transfersShipTruck: true },
      footprint: { width: 36, height: 28 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 16 }, seaFacingOffset: { x: 0, y: -24 },
      placementRules: { landOnly: true, coastRequired: true },
      preferredTerrain: ['coast', 'flat']
    },
    oil_platform: {
      id: 'oil_platform', label: 'PLATEFORME PÉTROLIÈRE', shortLabel: 'PP', category: 'resource', icon: 'oil-platform',
      sprite: 'assets/buildings/oil-platform.webp',
      description: 'Extrait les ressources des grands fonds marins.',
      functions: { extractsOffshoreResources: true },
      footprint: { width: 46, height: 38 }, roadRequired: false,
      marinePortOffset: { x: 0, y: -24 },
      placementRules: { deepWaterOnly: true, deepWaterMargin: 10 },
      preferredTerrain: ['deep-water']
    },
    storage: {
      id: 'storage', label: 'DÉPÔT', shortLabel: 'DÉ', category: 'logistics', icon: 'storage',
      sprite: 'assets/buildings/depot.webp',
      description: 'Stocke tous types de matériaux acheminés vers le site.',
      functions: { storesAllMaterials: true },
      footprint: { width: 28, height: 24 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 12 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat']
    },
    hub: {
      id: 'hub', label: 'HUB ORBITAL', shortLabel: 'HO', category: 'logistics', icon: 'hub',
      sprite: 'assets/buildings/orbital-hub.webp',
      description: 'Prépare les matériaux pour leur lancement en orbite.',
      functions: { exportsToOrbit: true },
      footprint: { width: 42, height: 36 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 18 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat']
    },
    wind_turbine: {
      id: 'wind_turbine', label: 'ÉOLIENNE', shortLabel: 'ÉO', category: 'energy', icon: 'wind-turbine',
      sprite: 'assets/buildings/wind-turbine.webp',
      description: 'Produit de l’énergie sur la terre ferme.',
      functions: { generatesEnergy: true },
      footprint: { width: 22, height: 30 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 15 },
      placementRules: { landOnly: true }, preferredTerrain: ['elevated', 'flat']
    },
    // Retained for existing building data; it is not part of the current build menu.
    geothermal: {
      id: 'geothermal', label: 'GÉOTHERMIE', shortLabel: 'GT', category: 'energy', icon: 'geothermal',
      description: 'Centrale géothermique.', functions: { generatesEnergy: true },
      footprint: { width: 30, height: 28 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 14 },
      placementRules: { landOnly: true, prefersElevatedTerrain: true },
      preferredTerrain: ['geothermal', 'elevated']
    }
  };
  const catalogOrder = Object.freeze([
    'factory', 'extractor', 'surface_port', 'oil_platform', 'storage', 'hub', 'wind_turbine'
  ]);

  for (const definition of Object.values(definitions)) {
    Object.freeze(definition.footprint);
    if (definition.roadPortOffset) Object.freeze(definition.roadPortOffset);
    if (definition.seaFacingOffset) Object.freeze(definition.seaFacingOffset);
    if (definition.marinePortOffset) Object.freeze(definition.marinePortOffset);
    Object.freeze(definition.placementRules);
    Object.freeze(definition.preferredTerrain);
    Object.freeze(definition.functions);
    if (definition.extracts) Object.freeze(definition.extracts);
    Object.freeze(definition);
  }
  Object.freeze(definitions);

  root.OrbitBuildingData = Object.freeze({
    definitions,
    catalogOrder,
    catalog() { return catalogOrder.map(type => definitions[type]); },
    get(type) { return Object.prototype.hasOwnProperty.call(definitions, type) ? definitions[type] : null; }
  });
})(globalThis);
