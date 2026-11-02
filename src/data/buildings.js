(function (root) {
  'use strict';

  // Footprints, points of connection, and offsets use planetary world units.
  // Simulation behavior is declared here but implemented in later blocks.
  const definitions = {
    // The colony: always the first building, one per game, indestructible.
    // It houses the population, produces context and grows with what it
    // receives by road (see src/data/colony.js). Its generator powers one or
    // two buildings.
    colony: {
      id: 'colony', label: 'COLONIE', shortLabel: 'CO', category: 'colony', icon: 'colony',
      description: 'Abrite la population et produit du contexte. Elle grandit avec les ressources qu’on lui livre par route.',
      details: 'Premier bâtiment, un seul par planète, indestructible. Elle abrite la population, qui grandit par paliers quand on lui livre par route les ressources demandées, puis en flux réguliers. Son générateur fournit 12 MW à la planète. On ne construit rien dans sa zone.',
      functions: { housesPopulation: true }, indestructible: true, generatorMW: 12,
      cost: {}, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 30, height: 26 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 13 },
      // One per planet: the first anywhere, then on other rocky worlds after
      // the skill "Atterrisseur".
      placementRules: { landOnly: true, uniquePerPlanet: true }, preferredTerrain: ['flat']
    },
    factory: {
      id: 'factory', label: 'USINE', shortLabel: 'US', category: 'industry', icon: 'factory',
      description: 'Transforme les minerais en matériaux.',
      details: 'Reçoit des matières par route grâce à sa carte Quai d’entrée et les transforme avec ses cartes : séparateurs, fours, four à goudron, laminoir… Ses Docks de sortie envoient chaque produit vers le bâtiment choisi, relié par route.',
      functions: { transformsMinerals: true },
      cost: { iron: 35, copper: 16, silicon: 8 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 34, height: 28 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 14 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat']
    },
    extractor: {
      id: 'extractor', label: 'EXTRACTEUR', shortLabel: 'EX', category: 'resource', icon: 'extractor',
      description: 'Fore le sol où il est posé et en extrait la matière la plus présente.',
      details: 'Fore le sol sous lui avec une Foreuse : de la roche brute qui garde la composition moyenne du terrain sur 24 km. Il peut la concasser et la broyer sur place, puis l’expédier par son Dock de sortie. Pour forer plus, posez plusieurs extracteurs côte à côte.',
      functions: { extractsResources: true }, extracts: ['iron', 'copper', 'silicon', 'carbon'],
      // Drains the ground around it: a weighted average over this radius (km).
      catchmentRadius: 24,
      cost: { iron: 18, copper: 8 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 28, height: 24 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 12 },
      placementRules: { landOnly: true },
      preferredTerrain: ['flat']
    },
    surface_port: {
      id: 'surface_port', label: 'PORT', shortLabel: 'PO', category: 'logistics', icon: 'surface-port',
      description: 'Relie les quais maritimes au réseau de camions.',
      details: 'Se pose au bord de l’eau, tourné vers la mer. Les voies maritimes relient deux ports, ou un port et une plateforme pétrolière, et prolongent le réseau routier pour les livraisons.',
      functions: { transfersShipTruck: true },
      cost: { iron: 24, copper: 12 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 36, height: 28 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 16 }, seaFacingOffset: { x: 0, y: -24 },
      placementRules: { landOnly: true, coastRequired: true },
      preferredTerrain: ['coast', 'flat']
    },
    oil_platform: {
      id: 'oil_platform', label: 'PLATEFORME PÉTROLIÈRE', shortLabel: 'PP', category: 'resource', icon: 'oil-platform',
      description: 'Pompe le pétrole des fonds marins sous la plateforme.',
      details: 'Se pose en mer profonde et pompe le pétrole des fonds marins, qu’un séparateur partage en pétrole, gaz et déchets. Elle se relie à un port par une voie maritime.',
      functions: { extractsOffshoreResources: true }, extracts: ['oil'],
      catchmentRadius: 30,
      cost: { iron: 40, copper: 20, silicon: 10 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 46, height: 38 }, roadRequired: false,
      marinePortOffset: { x: 0, y: -24 },
      placementRules: { deepWaterOnly: true, deepWaterMargin: 10 },
      preferredTerrain: ['deep-water']
    },
    storage: {
      id: 'storage', label: 'DÉPÔT', shortLabel: 'DÉ', category: 'logistics', icon: 'storage',
      description: 'Reçoit tout ce qu’on lui envoie et le répartit vers d’autres bâtiments.',
      details: 'Reçoit tout ce qu’on lui envoie par sa Porte d’entrée et le répartit avec ses cartes : stockage (1 000 u, 15 MW), filtre, répartiteur, priorité, puis portes de sortie vers d’autres bâtiments.',
      functions: { storesAllMaterials: true, routesMaterials: true },
      cost: { iron: 12, copper: 4 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 28, height: 24 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 12 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat']
    },
    launch_platform: {
      id: 'launch_platform', label: 'PLATEFORME DE LANCEMENT', shortLabel: 'PL', category: 'logistics', icon: 'hub',
      description: 'Le hub : se bâtit avec des ressources livrées par route, puis exporte vers l’Arche ce qu’il reçoit.',
      details: 'Le hub. Posé, c’est un chantier qui attend par route plaques, goudron, cuivre, silicium et eau douce ; une fois assemblé, il lance vers l’Arche tout ce qu’on lui envoie. Les lancements coûtent moins d’énergie près de l’équateur.',
      functions: { exportsToOrbit: true },
      // Its site waits for these deliveries (by road, like any destination)
      // before the robots assemble it. First draft.
      constructionNeeds: { metal_plate: 25, tar: 50, raw_copper: 15, raw_silicon: 15, water: 100 },
      cost: { iron: 350, copper: 250, silicon: 150, carbon: 80 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 42, height: 36 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 18 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat']
    },
    wind_turbine: {
      id: 'wind_turbine', label: 'ÉOLIENNE', shortLabel: 'ÉO', category: 'energy', icon: 'wind-turbine',
      description: 'Produit de l’énergie sur la terre ferme.',
      details: 'Produit environ 32 MW pour toute la planète, sans carburant. Le vent dépend du site : presque rien sur un relief accidenté (zones rouges), beaucoup sur les grandes plaines dégagées et les hauts plateaux (zones vertes). Une éolienne trop proche d’une autre perd du vent (sillage) : espacez-les. Une puissance insuffisante ralentit toutes les cartes de la planète.',
      functions: { generatesEnergy: true },
      cost: { iron: 12, copper: 8, carbon: 2 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 22, height: 30 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 15 },
      placementRules: { landOnly: true }, preferredTerrain: ['elevated', 'flat']
    },
    water_station: {
      id: 'water_station', label: 'STATION DE POMPAGE', shortLabel: 'SP', category: 'resource', icon: 'water-pump',
      description: 'Pompe l’eau de la rive voisine : salée en mer, douce dans un lac ou une rivière.',
      details: 'Se pose à moins de 30 km d’une eau. Elle pompe de l’eau salée en mer, de l’eau douce dans un lac ou une rivière ; le dessalinisateur rend l’eau de mer douce en rejetant de la saumure.',
      functions: { pumpsWater: true },
      cost: { iron: 14, copper: 6 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 26, height: 24 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 12 },
      // Water must lie within shoreReach (km) of the station's center.
      placementRules: { landOnly: true, shoreRequired: true, shoreReach: 30 }, preferredTerrain: ['shore']
    },
    // The data network (skill "Réseau informatique"): relay antennas gather the
    // data of working buildings in range and pass it by road (cables follow
    // the roads) to a datacenter, which analyses it; a high-frequency antenna
    // sends the analyses to the Ark, where they become technology points, and
    // carries raw data between planets. See src/data/dataNetwork.js.
    datacenter: {
      id: 'datacenter', label: 'DATACENTER', shortLabel: 'DC', category: 'data', icon: 'datacenter',
      description: 'Analyse les données reçues des antennes ; les analyses partent vers l’Arche. Très gourmand en énergie : mieux vaut un site froid.',
      details: 'Traite les données reçues des antennes relais : récepteur, compresseur, processeur, stockage, puis liaison montante vers l’antenne haute fréquence reliée par la route. À l’Arche, chaque analyse devient un point de technologie. Très gourmand en énergie : un site froid (pôles, montagne) consomme moins.',
      functions: { processesData: true },
      cost: { iron: 30, copper: 30, silicon: 20 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 30, height: 26 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 13 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat', 'elevated']
    },
    antenna: {
      id: 'antenna', label: 'ANTENNE RELAIS', shortLabel: 'AR', category: 'data', icon: 'antenna',
      description: 'Recueille les données des foreuses et usines alentour et les transmet au datacenter relié par la route.',
      details: 'Rassemble les données des extracteurs, usines et laboratoires en activité dans un rayon de 300 km. Les antennes relais se relaient en chaîne, à moins de 300 km l’une de l’autre, jusqu’au datacenter ; chacune porte 4 Mo/s au plus.',
      functions: { relaysData: true },
      cost: { iron: 10, copper: 8, silicon: 2 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 18, height: 18 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 9 },
      placementRules: { landOnly: true }, preferredTerrain: ['elevated', 'flat']
    },
    hf_antenna: {
      id: 'hf_antenna', label: 'ANTENNE HAUTE FRÉQUENCE', shortLabel: 'HF', category: 'data', icon: 'hf-antenna',
      description: 'Envoie à l’Arche les analyses du datacenter relié par la route, et les données brutes d’une planète vers le datacenter d’une autre.',
      details: 'Reliée au datacenter par la route, elle envoie les analyses vers l’Arche, ou les données d’une planète vers le datacenter d’une autre. Débit stable de 4 Mo/s ; l’étoile coupe la liaison quand elle passe entre les deux bouts.',
      functions: { sendsDataToSpace: true },
      cost: { iron: 20, copper: 16, silicon: 8 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 22, height: 22 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 11 },
      placementRules: { landOnly: true }, preferredTerrain: ['elevated', 'flat']
    },
    // Put down on other worlds once the skill "Atterrisseur" is acquired: it
    // studies its planet and sends planetary data (more on exotic worlds). It
    // carries its own power; on a gas giant it orbits and beams its data itself.
    lab: {
      id: 'lab', label: 'LABORATOIRE D’ANALYSE', shortLabel: 'LA', category: 'data', icon: 'lab',
      description: 'Étudie sa planète et produit des données planétaires, plus riches sur les mondes extrêmes.',
      details: 'Posé sur un autre monde grâce à la compétence Atterrisseur (en orbite d’une géante gazeuse, avec la compétence Laboratoire orbital), il étudie sa planète et produit des données planétaires, plus riches sur les mondes extrêmes. Autonome en énergie, il émet lui-même ses données s’il n’a pas d’antenne relais à portée.',
      functions: { studiesPlanet: true },
      cost: { iron: 12, copper: 10, silicon: 6 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 22, height: 20 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 10 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat']
    },
    waste_heap: {
      id: 'waste_heap', label: 'TERRIL', shortLabel: 'TE', category: 'waste', icon: 'terril',
      description: 'Reçoit les déchets par route ; on en récupère des matières à faible rendement ou de l’énergie.',
      details: 'Reçoit les déchets par route et les traite aussitôt arrivés. Le retraitement rend une roche broyée à faible rendement ; l’incinérateur brûle les déchets et rend 4 MW par déchet brûlé chaque seconde, jusqu’à 8 MW par incinérateur.',
      functions: { storesWaste: true },
      cost: { iron: 8 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 32, height: 26 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 13 },
      placementRules: { landOnly: true }, preferredTerrain: ['flat']
    },
    // Retained for existing building data; it is not part of the current build menu.
    geothermal: {
      id: 'geothermal', label: 'GÉOTHERMIE', shortLabel: 'GT', category: 'energy', icon: 'geothermal',
      description: 'Centrale géothermique.', functions: { generatesEnergy: true },
      cost: { iron: 22, copper: 12, silicon: 4 }, constructionDurationSeconds: 2, demolitionRefundRate: 1,
      footprint: { width: 30, height: 28 }, roadRequired: true,
      roadPortOffset: { x: 0, y: 14 },
      placementRules: { landOnly: true, prefersElevatedTerrain: true },
      preferredTerrain: ['geothermal', 'elevated']
    }
  };
  // Groups of the build menu's filter, by building category; the colony
  // shows under "Tout" only.
  const menuGroups = Object.freeze([
    Object.freeze({ id: 'production', label: 'PRODUCTION', categories: Object.freeze(['resource']) }),
    Object.freeze({ id: 'industry', label: 'INDUSTRIE', categories: Object.freeze(['industry', 'waste']) }),
    Object.freeze({ id: 'energy', label: 'ÉNERGIE', categories: Object.freeze(['energy']) }),
    Object.freeze({ id: 'transport', label: 'TRANSPORT', categories: Object.freeze(['logistics']) }),
    Object.freeze({ id: 'data', label: 'DONNÉES', categories: Object.freeze(['data']) })
  ]);
  const catalogOrder = Object.freeze([
    'colony', 'factory', 'extractor', 'water_station', 'launch_platform', 'surface_port', 'oil_platform', 'storage', 'waste_heap',
    'wind_turbine', 'datacenter', 'antenna', 'hf_antenna', 'lab'
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

  // Construction crews: robots landed with the Ark. Only this many sites
  // progress at once; the others wait their turn. Building and card prices
  // stay in the data but are masked for now: nothing is charged or shown
  // while pricesEnabled is false.
  const construction = Object.freeze({ crews: 2, pricesEnabled: false });

  // Placed with a finger, every building's preview stands this far above it,
  // so the finger does not hide it (a definition may set its own touchLiftPx).
  const placement = Object.freeze({ touchLiftPx: 72 });

  // Buildings whose inside is a card plan, and those of them whose output
  // docks send resources by road (the depot uses its own gates).
  const processTypes = Object.freeze(['factory', 'extractor', 'oil_platform', 'water_station', 'storage', 'waste_heap', 'datacenter']);
  const dockSourceTypes = Object.freeze(['factory', 'extractor', 'oil_platform', 'water_station', 'waste_heap']);

  root.OrbitBuildingData = Object.freeze({
    definitions,
    catalogOrder,
    menuGroups,
    processTypes,
    dockSourceTypes,
    construction,
    placement,
    catalog() { return catalogOrder.map(type => definitions[type]); },
    get(type) { return Object.prototype.hasOwnProperty.call(definitions, type) ? definitions[type] : null; }
  });
})(globalThis);
