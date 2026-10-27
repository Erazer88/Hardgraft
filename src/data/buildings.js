(function (root) {
  'use strict';

  // Footprints, points of connection, and offsets use planetary world units.
  // Simulation behavior is declared here but implemented in later blocks.
  const definitions = {
    factory: {
      id: 'factory', label: 'USINE', shortLabel: 'US', category: 'industry', icon: 'factory',
      description: 'Transforme les minerais en matériaux.',
      functions: { transformsMinerals: true },
      cost: { iron: 35, copper: 16, silicon: 8 }, constructionDurationSeconds: 3.5, demolitionRefundRate: 1,
      footprint: { width: 34, height: 28 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 14 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat']
    },
    extractor: {
      id: 'extractor', label: 'EXTRACTEUR', shortLabel: 'EX', category: 'resource', icon: 'extractor',
      description: 'Fore le sol où il est posé et en extrait la matière la plus présente.',
      functions: { extractsResources: true }, extracts: ['iron', 'copper', 'silicon', 'carbon'],
      // Drains the ground around it: a weighted average over this radius (km).
      catchmentRadius: 24,
      cost: { iron: 18, copper: 8 }, constructionDurationSeconds: 3.5, demolitionRefundRate: 1,
      footprint: { width: 28, height: 24 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 12 },
      placementRules: { landOnly: true },
      preferredTerrain: ['flat']
    },
    surface_port: {
      id: 'surface_port', label: 'PORT', shortLabel: 'PO', category: 'logistics', icon: 'surface-port',
      description: 'Relie les quais maritimes au réseau de camions.',
      functions: { transfersShipTruck: true },
      cost: { iron: 24, copper: 12 }, constructionDurationSeconds: 3.5, demolitionRefundRate: 1,
      footprint: { width: 36, height: 28 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 16 }, seaFacingOffset: { x: 0, y: -24 },
      placementRules: { landOnly: true, coastRequired: true },
      preferredTerrain: ['coast', 'flat']
    },
    oil_platform: {
      id: 'oil_platform', label: 'PLATEFORME PÉTROLIÈRE', shortLabel: 'PP', category: 'resource', icon: 'oil-platform',
      description: 'Pompe le pétrole des fonds marins sous la plateforme.',
      functions: { extractsOffshoreResources: true }, extracts: ['oil'],
      catchmentRadius: 30,
      cost: { iron: 40, copper: 20, silicon: 10 }, constructionDurationSeconds: 3.5, demolitionRefundRate: 1,
      footprint: { width: 46, height: 38 }, roadRequired: false,
      marinePortOffset: { x: 0, y: -24 },
      placementRules: { deepWaterOnly: true, deepWaterMargin: 10 },
      preferredTerrain: ['deep-water']
    },
    storage: {
      id: 'storage', label: 'DÉPÔT', shortLabel: 'DÉ', category: 'logistics', icon: 'storage',
      description: 'Reçoit tout ce qu’on lui envoie et le répartit vers d’autres bâtiments.',
      functions: { storesAllMaterials: true, routesMaterials: true },
      cost: { iron: 12, copper: 4 }, constructionDurationSeconds: 3.5, demolitionRefundRate: 1,
      footprint: { width: 28, height: 24 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 12 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat']
    },
    launch_platform: {
      id: 'launch_platform', label: 'PLATEFORME DE LANCEMENT', shortLabel: 'PL', category: 'logistics', icon: 'hub',
      description: 'Reçoit les stocks des Docks reliés par route et les exporte vers l’Arche.',
      functions: { exportsToOrbit: true },
      cost: { iron: 25, copper: 10 }, constructionDurationSeconds: 3.5, demolitionRefundRate: 1,
      footprint: { width: 42, height: 36 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 18 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat']
    },
    wind_turbine: {
      id: 'wind_turbine', label: 'ÉOLIENNE', shortLabel: 'ÉO', category: 'energy', icon: 'wind-turbine',
      description: 'Produit de l’énergie sur la terre ferme.',
      functions: { generatesEnergy: true },
      cost: { iron: 15, copper: 10, carbon: 2 }, constructionDurationSeconds: 3.5, demolitionRefundRate: 1,
      footprint: { width: 22, height: 30 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 15 },
      placementRules: { landOnly: true }, preferredTerrain: ['elevated', 'flat']
    },
    water_station: {
      id: 'water_station', label: 'STATION DE POMPAGE', shortLabel: 'SP', category: 'resource', icon: 'water-pump',
      description: 'Pompe l’eau de la rive voisine : salée en mer, douce dans un lac ou une rivière.',
      functions: { pumpsWater: true },
      cost: { iron: 14, copper: 6 }, constructionDurationSeconds: 3.5, demolitionRefundRate: 1,
      footprint: { width: 26, height: 24 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 12 },
      // Water must lie within shoreReach (km) of the station's center.
      placementRules: { landOnly: true, shoreRequired: true, shoreReach: 30 }, preferredTerrain: ['shore']
    },
    waste_heap: {
      id: 'waste_heap', label: 'TERRIL', shortLabel: 'TE', category: 'waste', icon: 'terril',
      description: 'Reçoit les déchets par route ; on en récupère des matières à faible rendement ou de l’énergie.',
      functions: { storesWaste: true },
      cost: { iron: 8 }, constructionDurationSeconds: 3.5, demolitionRefundRate: 1,
      footprint: { width: 32, height: 26 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 13 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat']
    },
    // Retained for existing building data; it is not part of the current build menu.
    geothermal: {
      id: 'geothermal', label: 'GÉOTHERMIE', shortLabel: 'GT', category: 'energy', icon: 'geothermal',
      description: 'Centrale géothermique.', functions: { generatesEnergy: true },
      cost: { iron: 22, copper: 12, silicon: 4 }, constructionDurationSeconds: 3.5, demolitionRefundRate: 1,
      footprint: { width: 30, height: 28 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 14 },
      placementRules: { landOnly: true, prefersElevatedTerrain: true },
      preferredTerrain: ['geothermal', 'elevated']
    }
  };
  const catalogOrder = Object.freeze([
    'factory', 'extractor', 'water_station', 'launch_platform', 'surface_port', 'oil_platform', 'storage', 'waste_heap',
    'wind_turbine'
  ]);

  for (const definition of Object.values(definitions)) {
    Object.freeze(definition.footprint);
    if (definition.roadPortOffset) Object.freeze(definition.roadPortOffset);
    if (definition.seaFacingOffset) Object.freeze(definition.seaFacingOffset);
    if (definition.marinePortOffset) Object.freeze(definition.marinePortOffset);
    Object.freeze(definition.placementRules);
    Object.freeze(definition.preferredTerrain);
    Object.freeze(definition.functions);
    Object.freeze(definition.cost);
    if (definition.extracts) Object.freeze(definition.extracts);
    Object.freeze(definition);
  }
  Object.freeze(definitions);

  // Buildings whose inside is a card plan, and those of them whose output
  // docks send resources by road (the depot uses its own gates).
  const processTypes = Object.freeze(['factory', 'extractor', 'oil_platform', 'water_station', 'storage', 'waste_heap']);
  const dockSourceTypes = Object.freeze(['factory', 'extractor', 'oil_platform', 'water_station', 'waste_heap']);

  root.OrbitBuildingData = Object.freeze({
    definitions,
    catalogOrder,
    processTypes,
    dockSourceTypes,
    catalog() { return catalogOrder.map(type => definitions[type]); },
    get(type) { return Object.prototype.hasOwnProperty.call(definitions, type) ? definitions[type] : null; }
  });
})(globalThis);
