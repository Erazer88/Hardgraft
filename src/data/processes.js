(function (root) {
  'use strict';

  const config = {
    version: 5,
    fixedStepSeconds: .1,
    maxTicksPerAdvance: 100,
    inputCapacity: 20,
    outputCapacity: 20,
    // Construction materials are counted for real; the developer setting
    // "Minerais infinis" still lifts mineral costs for testing.
    colonyReserveInfinite: false,
    // One wind turbine powers about one full ore line (≈ 23,5 MW).
    windPowerUnlimited: false,
    windPowerMW: 32,
    geothermalPowerMW: 80,
    // Water pumps: salt water flows faster than fresh water (first drafts).
    waterPump: { salt: { throughput: 4, energyMW: 3 }, fresh: { throughput: 1.5, energyMW: 2 } },
    // Depot routing cards: gate rate, per-card holding and buffer capacity.
    depot: { gateThroughput: 4, cardCapacity: 20, bufferCapacity: 200, splitRatios: [10, 20, 30, 40, 50, 60, 70, 80, 90] },
    // Ground under an extractor: rock hardness, and the share of the extracted
    // material assumed when a building has none recorded.
    geology: { hardnessRange: [.8, 1.8], defaultShare: .1 },
    // Separators recover this share of the material a rock holds; what is
    // left leaves as tailings depleted of it.
    separation: { recovery: .9 }
  };

  const input = (id, label, resourceId, extras = {}) => ({ id, label, resourceId, ...extras });
  const output = (id, label, resourceId, extras = {}) => ({ id, label, resourceId, ...extras });
  // The metal and mineral lines that rock feeds: what each separator
  // recovers and what its furnace makes of it.
  const materials = {
    iron: { label: 'FER', separator: 'magnetic_separator', concentrate: 'iron_concentrate', concentrateLabel: 'Concentré de fer',
      product: 'raw_iron', productLabel: 'Fer brut', slag: 'iron_slag', slagLabel: 'Laitier' },
    copper: { label: 'CUIVRE', separator: 'gravity_separator', concentrate: 'copper_concentrate', concentrateLabel: 'Concentré de cuivre',
      product: 'raw_copper', productLabel: 'Cuivre brut', slag: 'copper_slag', slagLabel: 'Laitier de cuivre' },
    silicon: { label: 'SILICE', concentrate: 'impure_silicon_dry', concentrateLabel: 'Silicium impur sec',
      product: 'raw_silicon', productLabel: 'Silicium brut', slag: 'silicon_slag', slagLabel: 'Laitier de silicium' },
    carbon: { label: 'CARBONE', separator: 'carbon_separator', concentrate: 'coal', concentrateLabel: 'Charbon' }
  };
  const rockInput = (id = 'rock', amount = 1) => ({ inputId: id, amount });
  // A separator: `batch` units of ground rock give concentrate in proportion
  // to the rock's grade (yieldOf), the rest leaves as tailings (remainder).
  const separator = (material, batch = 5) => ({
    inputPorts: [input('rock', 'Roche broyée', 'ground_rock')],
    outputPorts: [output('concentrate', materials[material].concentrateLabel, materials[material].concentrate),
      output('residue', 'Résidus', 'tailings')],
    recipe: { inputs: [rockInput('rock', batch)], outputs: [
      { outputId: 'concentrate', resourceId: materials[material].concentrate, amount: batch, yieldOf: material },
      { outputId: 'residue', resourceId: 'tailings', amount: batch, remainder: true }] } });

  const templates = {
    drill: { id: 'drill', label: 'FOREUSE', mark: 'FO', description: 'Extrait la roche du sol ; elle garde la composition du terrain.', source: true, usesGround: true,
      // One drill per extractor (maxPerBuilding); extractors may stand side by side.
      inputPorts: [], outputPorts: [output('rock', 'Roche brute', 'raw_rock')], recipe: null, throughput: 6, energyMW: 2.5,
      maxPerBuilding: 1 },
    oil_pump: { id: 'oil_pump', label: 'POMPE PÉTROLIÈRE', mark: 'PP', description: 'Pompe le pétrole brut des fonds marins.', source: true, usesGround: true,
      inputPorts: [], outputPorts: [output('raw_oil', 'Pétrole brut', 'raw_oil')], recipe: null,
      throughput: 2, energyMW: 2.5 },
    water_supply: { id: 'water_supply', label: 'RÉSERVE D’EAU', mark: 'EA', description: 'Fournit l’eau nécessaire aux procédés de lavage.', source: true,
      inputPorts: [], outputPorts: [output('water', 'Eau', 'water')], recipe: null,
      throughput: null, energyMW: 0 },
    crusher: { id: 'crusher', label: 'CONCASSEUR', mark: 'CO', description: 'Brise la roche brute en roche concassée, sans séparer les matières.',
      inputPorts: [input('rock', 'Roche brute', 'raw_rock')], outputPorts: [output('rock', 'Roche concassée', 'crushed_rock')],
      recipe: { inputs: [rockInput()], outputs: [{ outputId: 'rock', resourceId: 'crushed_rock', amount: 1 }] },
      // Matched to the drill it sits next to.
      throughput: 6, energyMW: 2 },
    grinder: { id: 'grinder', label: 'BROYEUR', mark: 'BR', description: 'Réduit la roche concassée en poudre fine, prête à séparer.',
      inputPorts: [input('rock', 'Roche concassée', 'crushed_rock')], outputPorts: [output('rock', 'Roche broyée', 'ground_rock')],
      recipe: { inputs: [rockInput()], outputs: [{ outputId: 'rock', resourceId: 'ground_rock', amount: 1 }] },
      throughput: 6, energyMW: 6 },
    magnetic_separator: { id: 'magnetic_separator', label: 'SÉPARATEUR MAGNÉTIQUE', mark: 'SM',
      description: 'Attire le fer hors de la roche broyée, selon sa teneur ; le reste part en résidus.',
      ...separator('iron'), throughput: 2, energyMW: 3 },
    gravity_separator: { id: 'gravity_separator', label: 'SÉPARATEUR GRAVITAIRE', mark: 'SG',
      description: 'Concentre le cuivre de la roche broyée, selon sa teneur ; le reste part en résidus.',
      ...separator('copper'), throughput: 2, energyMW: 3 },
    carbon_separator: { id: 'carbon_separator', label: 'TRIEUSE DE CARBONE', mark: 'TC',
      description: 'Trie le charbon de la roche broyée, selon sa teneur ; le reste part en résidus.',
      ...separator('carbon'), throughput: 2, energyMW: 3 },
    silicon_washer: { id: 'silicon_washer', label: 'LAVEUSE DE SILICE', mark: 'LS',
      description: 'Lave la roche broyée à l’eau et en retire la silice, selon sa teneur.',
      inputPorts: [input('rock', 'Roche broyée', 'ground_rock'), input('water', 'Eau', 'water')],
      outputPorts: [output('wet_silicon', 'Silicium impur humide', 'impure_silicon_wet'), output('residue', 'Résidus', 'tailings')],
      recipe: { inputs: [rockInput('rock', 20), { inputId: 'water', amount: 5 }], outputs: [
        { outputId: 'wet_silicon', resourceId: 'impure_silicon_wet', amount: 20, yieldOf: 'silicon' },
        { outputId: 'residue', resourceId: 'tailings', amount: 20, remainder: true }] },
      throughput: 2, energyMW: 3 },
    silicon_dryer: { id: 'silicon_dryer', label: 'SÉCHEUR DE SILICE', mark: 'SS',
      description: 'Retire l’humidité du silicium lavé avant réduction.',
      inputPorts: [input('wet_silicon', 'Silicium impur humide', 'impure_silicon_wet')],
      outputPorts: [output('dry_silicon', 'Silicium impur sec', 'impure_silicon_dry')],
      recipe: { inputs: [{ inputId: 'wet_silicon', amount: 1 }], outputs: [
        { outputId: 'dry_silicon', resourceId: 'impure_silicon_dry', amount: 1 }] },
      throughput: 2, energyMW: 4 },
    carbon_washer: { id: 'carbon_washer', label: 'LAVAGE DU CHARBON', mark: 'LC',
      description: 'Lave le charbon à l’eau pour obtenir du carbone.',
      inputPorts: [input('coal', 'Charbon', 'coal'), input('water', 'Eau', 'water')],
      outputPorts: [output('carbon', 'Carbone', 'carbon'), output('sludge', 'Boues carbonées', 'carbon_sludge')],
      recipe: { inputs: [{ inputId: 'coal', amount: 20 }, { inputId: 'water', amount: 5 }], outputs: [
        { outputId: 'carbon', resourceId: 'carbon', amount: 8 }, { outputId: 'sludge', resourceId: 'carbon_sludge', amount: 12 }] },
      throughput: 2, energyMW: 3 },
    reduction_furnace: { id: 'reduction_furnace', label: 'FOUR DE RÉDUCTION', mark: 'FR',
      description: 'Transforme un concentré en métal brut et en laitier.', throughput: 2, energyMW: 10 },
    // Colony goods.
    tar_furnace: { id: 'tar_furnace', label: 'FOUR À GOUDRON', mark: 'FG',
      description: 'Cuit la roche concassée avec du charbon : goudron pour la colonie, et des déchets.',
      inputPorts: [input('rock', 'Roche concassée', 'crushed_rock'), input('coal', 'Charbon', 'coal')],
      outputPorts: [output('tar', 'Goudron', 'tar'), output('waste', 'Déchets', 'waste')],
      recipe: { inputs: [rockInput('rock', 4), { inputId: 'coal', amount: 1 }], outputs: [
        { outputId: 'tar', resourceId: 'tar', amount: 1 }, { outputId: 'waste', resourceId: 'waste', amount: 3 }] },
      throughput: 2, energyMW: 6 },
    rolling_mill: { id: 'rolling_mill', label: 'LAMINOIR', mark: 'LA',
      description: 'Lamine le fer brut en plaques de métal (10 pour 1).',
      inputPorts: [input('iron', 'Fer brut', 'raw_iron')], outputPorts: [output('plate', 'Plaque de métal', 'metal_plate')],
      recipe: { inputs: [{ inputId: 'iron', amount: 10 }], outputs: [{ outputId: 'plate', resourceId: 'metal_plate', amount: 1 }] },
      throughput: 2, energyMW: 8 },
    triphasic_separator: { id: 'triphasic_separator', label: 'SÉPARATEUR TRIPHASÉ', mark: 'ST',
      description: 'Sépare le pétrole brut en pétrole, gaz et déchets.', throughput: 2, energyMW: 4 },
    // Waste heap: the reprocessor recovers a little ground rock from tailings.
    reprocessor: { id: 'reprocessor', label: 'RETRAITEMENT', mark: 'RT',
      description: 'Récupère un peu de roche broyée dans les résidus (10 pour 1), avec ce qu’ils contiennent encore.',
      inputPorts: [input('waste', 'Résidus', 'tailings')], outputPorts: [output('rock', 'Roche broyée', 'ground_rock')],
      recipe: { inputs: [{ inputId: 'waste', amount: 10 }], outputs: [{ outputId: 'rock', resourceId: 'ground_rock', amount: 1 }] },
      throughput: 2, energyMW: 4 },
    // Water station: one pump for every water; the shore decides which.
    water_pump: { id: 'water_pump', label: 'POMPE', mark: 'PO', description: 'Pompe l’eau de la rive : salée en mer, douce dans un lac ou une rivière.',
      source: true, usesGround: true, inputPorts: [], recipe: null },
    desalinator: { id: 'desalinator', label: 'DESSALINISATEUR', mark: 'DE', description: 'Rend l’eau salée potable et rejette une saumure.',
      inputPorts: [input('salt_water', 'Eau salée', 'salt_water')],
      outputPorts: [output('water', 'Eau douce', 'water'), output('brine', 'Saumure', 'brine')],
      recipe: { inputs: [{ inputId: 'salt_water', amount: 4 }], outputs: [
        { outputId: 'water', resourceId: 'water', amount: 3 }, { outputId: 'brine', resourceId: 'brine', amount: 1 }] },
      throughput: 4, energyMW: 6 },
    // Waste heap: burning waste yields energy instead of consuming it.
    incinerator: { id: 'incinerator', label: 'INCINÉRATEUR', mark: 'IN', description: 'Brûle les déchets reçus et produit de l’énergie.',
      inputPorts: [input('waste', 'Déchets', null, { acceptsAnyResource: true, accepts: { tag: 'waste' } })],
      outputPorts: [], recipe: { inputs: [{ inputId: 'waste', amount: 2 }], outputs: [] },
      throughput: 2, energyMW: 0, generatesMW: 8 }
  };

  const utilities = {
    input_dock: {
      id: 'input_dock', label: 'QUAI D’ENTRÉE', mark: 'QE', description: 'Reçoit les ressources du réseau routier et alimente les machines.', externalInput: true,
      // Docks are logical connectors: no throughput limit.
      inputPorts: [], outputPorts: [output('material', 'Ressource reçue', null)], recipe: null, throughput: null, energyMW: 0
    },
    terril: {
      id: 'terril', label: 'TERRIL', mark: 'TE', description: 'Stocke sans limite les matières et résidus.', sink: true, storesResources: true,
      inputPorts: [input('material', 'Toutes ressources', null, { acceptsAnyResource: true })],
      outputPorts: [], recipe: null, throughput: null, energyMW: 0
    },
    output_dock: {
      id: 'output_dock', label: 'DOCK DE SORTIE', mark: 'DS', description: 'Envoie sa ressource vers un bâtiment relié par route.', sink: true, externalOutput: true,
      inputPorts: [input('material', 'Sortie planétaire', null, { acceptsAnyResource: true })],
      outputPorts: [], recipe: null, throughput: null, energyMW: 0
    }
  };

  // Depot routing cards carry mixed flows: every port holds any resource.
  const mixed = (id, label) => ({ id, label, resourceId: null, mixed: true });
  const depotCards = {
    depot_input: { id: 'depot_input', label: 'PORTE D’ENTRÉE', mark: 'PE', routing: true, gate: 'input', throughput: config.depot.gateThroughput,
      description: 'Fait entrer dans le circuit tout ce que le dépôt reçoit par route.',
      inputPorts: [], outputPorts: [mixed('out', 'Flux entrant')], recipe: null, energyMW: 0 },
    depot_output: { id: 'depot_output', label: 'PORTE DE SORTIE', mark: 'PS', routing: true, gate: 'output', throughput: config.depot.gateThroughput,
      description: 'Envoie tout ce qui lui parvient vers un bâtiment relié par route.',
      inputPorts: [mixed('in', 'Flux sortant')], outputPorts: [], recipe: null, energyMW: 0 },
    depot_buffer: { id: 'depot_buffer', label: 'TAMPON', mark: 'TA', routing: true,
      description: 'Stocke jusqu’à 200 unités par ressource et amortit les à-coups.',
      inputPorts: [mixed('in', 'Entrée')], outputPorts: [mixed('out', 'Sortie')], recipe: null, energyMW: 0 },
    depot_filter: { id: 'depot_filter', label: 'FILTRE', mark: 'FI', routing: true,
      description: 'Laisse passer la ressource choisie ; le reste part sur la seconde sortie.',
      inputPorts: [mixed('in', 'Entrée')], outputPorts: [mixed('match', 'Ressource choisie'), mixed('other', 'Le reste')],
      recipe: null, energyMW: 0 },
    depot_splitter: { id: 'depot_splitter', label: 'RÉPARTITEUR', mark: 'RE', routing: true,
      description: 'Partage le flux entre deux sorties selon un pourcentage.',
      inputPorts: [mixed('in', 'Entrée')], outputPorts: [mixed('a', 'Sortie A'), mixed('b', 'Sortie B')],
      recipe: null, energyMW: 0 },
    depot_priority: { id: 'depot_priority', label: 'PRIORITÉ', mark: 'PR', routing: true,
      description: 'Remplit la sortie prioritaire, puis déborde vers la seconde.',
      inputPorts: [mixed('in', 'Entrée')], outputPorts: [mixed('primary', 'Prioritaire'), mixed('overflow', 'Débordement')],
      recipe: null, energyMW: 0 }
  };
  const depotCatalog = ['depot_input', 'depot_buffer', 'depot_filter', 'depot_splitter', 'depot_priority', 'depot_output'];

  // Price of each card, paid from the colony stock when it is added to a
  // plan and refunded when it is removed or its building is demolished.
  const cardCosts = {
    drill: { iron: 6, copper: 2 }, oil_pump: { iron: 8, copper: 3 }, water_supply: { iron: 2 },
    crusher: { iron: 4, copper: 1 }, grinder: { iron: 5, copper: 2 },
    magnetic_separator: { iron: 4, copper: 3 }, gravity_separator: { iron: 5, copper: 2 },
    silicon_washer: { iron: 4, copper: 2 }, silicon_dryer: { iron: 4, copper: 2 },
    carbon_separator: { iron: 4, copper: 2 }, carbon_washer: { iron: 4, copper: 2 },
    reduction_furnace: { iron: 8, copper: 4 }, tar_furnace: { iron: 6, copper: 2 }, rolling_mill: { iron: 10, copper: 4 },
    triphasic_separator: { iron: 8, copper: 4, silicon: 2 },
    reprocessor: { iron: 4, copper: 2 }, incinerator: { iron: 6, copper: 2 },
    water_pump: { iron: 3, copper: 1 }, desalinator: { iron: 6, copper: 4, silicon: 2 },
    input_dock: { iron: 2 }, output_dock: { iron: 2 }, terril: { iron: 2 },
    depot_input: { iron: 2 }, depot_output: { iron: 2 }, depot_buffer: { iron: 3 },
    depot_filter: { iron: 2, copper: 1 }, depot_splitter: { iron: 2, copper: 1 }, depot_priority: { iron: 2, copper: 1 }
  };

  // Each card belongs to one kind of building: the extractor drills, crushes
  // and grinds on site, the factory sorts, washes and smelts. Only the docks
  // appear in both. Furnaces are listed once per metal.
  const extractorCatalog = ['drill', 'crusher', 'grinder', 'output_dock'];
  const factoryCatalog = ['input_dock', 'magnetic_separator', 'gravity_separator', 'carbon_separator',
    'water_supply', 'silicon_washer', 'silicon_dryer', 'carbon_washer', ['reduction_furnace', 'iron'],
    ['reduction_furnace', 'copper'], ['reduction_furnace', 'silicon'], 'tar_furnace', 'rolling_mill', 'output_dock'];
  const oilCatalog = ['oil_pump', 'triphasic_separator', 'output_dock'];
  // The terril card left the factories: waste now goes by road to the Terril building.
  const waterCatalog = { salt_water: ['water_pump', 'desalinator', 'output_dock'], water: ['water_pump', 'output_dock'] };

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }

  // A furnace works one concentrate: iron, copper or silicon.
  function furnaceDefinition(resourceId) {
    const id = Object.hasOwn(materials, resourceId) && materials[resourceId].product ? resourceId : 'iron';
    const material = materials[id], base = templates.reduction_furnace;
    const inputId = id === 'silicon' ? 'dry_silicon' : 'concentrate';
    return { ...base, contextResourceId: id, label: `${base.label} · ${material.label}`,
      inputPorts: [input(inputId, material.concentrateLabel, material.concentrate)],
      outputPorts: [output('product', material.productLabel, material.product), output('slag', material.slagLabel, material.slag)],
      recipe: { inputs: [{ inputId, amount: 2 }], outputs: [
        { outputId: 'product', resourceId: material.product, amount: 1 },
        { outputId: 'slag', resourceId: material.slag, amount: 1 }] } };
  }

  const cache = new Map();
  function get(type, resourceId = 'iron') {
    const key = `${type}:${resourceId || ''}`;
    if (cache.has(key)) return cache.get(key);
    if (type === 'water_pump') {
      const kind = resourceId === 'salt_water' ? 'salt' : resourceId === 'water' ? 'fresh' : null;
      const pump = kind && config.waterPump[kind];
      const definition = pump ? freeze({ ...templates.water_pump, ...pump, cost: cardCosts.water_pump,
        outputPorts: [output('water', kind === 'salt' ? 'Eau salée' : 'Eau douce', resourceId)] }) : null;
      cache.set(key, definition);
      return definition;
    }
    if ((type === 'oil_pump' || type === 'triphasic_separator') && resourceId !== 'oil') {
      cache.set(key, null);
      return null;
    }
    let definition = null;
    if (type === 'reduction_furnace') definition = furnaceDefinition(resourceId);
    else if (type === 'triphasic_separator' && resourceId === 'oil') {
      const base = templates.triphasic_separator;
      definition = { ...base,
        inputPorts: [input('raw_oil', 'Pétrole brut', 'raw_oil')],
        outputPorts: [output('oil', 'Pétrole', 'oil'), output('gas', 'Gaz', 'gas'), output('waste', 'Déchets', 'waste')],
        recipe: { inputs: [{ inputId: 'raw_oil', amount: 20 }], outputs: [
          { outputId: 'oil', resourceId: 'oil', amount: 16 },
          { outputId: 'gas', resourceId: 'gas', amount: 3 },
          { outputId: 'waste', resourceId: 'waste', amount: 1 }
        ] } };
    } else if (type === 'oil_pump' && resourceId === 'oil') definition = templates.oil_pump;
    else definition = templates[type] || utilities[type] || depotCards[type] || null;
    cache.set(key, definition ? freeze({ ...definition, cost: cardCosts[type] || {} }) : null);
    return cache.get(key);
  }

  const definitionContexts = {
    drill: 'rock', oil_pump: 'oil', water_supply: 'rock', crusher: 'rock', grinder: 'rock',
    magnetic_separator: 'rock', gravity_separator: 'rock', silicon_washer: 'rock', silicon_dryer: 'rock',
    carbon_separator: 'rock', carbon_washer: 'rock', reduction_furnace: 'iron', tar_furnace: 'rock', rolling_mill: 'rock',
    triphasic_separator: 'oil', water_pump: 'salt_water', desalinator: 'salt_water', reprocessor: 'rock', incinerator: 'rock'
  };
  const definitions = Object.freeze(Object.fromEntries(Object.entries(definitionContexts)
    .map(([type, resourceId]) => [type, get(type, resourceId)])
    .filter(([, definition]) => definition)));
  const frozenUtilities = freeze(utilities);
  function contextForResource(resourceId) {
    if (['raw_oil', 'oil', 'gas'].includes(resourceId)) return 'oil';
    if (resourceId === 'salt_water' || resourceId === 'brine') return 'salt_water';
    return resourceId ? 'rock' : null;
  }
  const statuses = freeze({ active: 'ACTIF', waiting_input: 'ATTENTE ENTRÉE', output_full: 'SORTIE PLEINE', no_energy: 'SANS ÉNERGIE' });
  freeze(config); freeze(materials); freeze(extractorCatalog); freeze(factoryCatalog); freeze(oilCatalog); freeze(templates); freeze(depotCards); freeze(waterCatalog); freeze(cardCosts);

  root.OrbitProcessData = Object.freeze({
    config, definitions, utilities: frozenUtilities, statuses, materials,
    get, contextForResource,
    catalog(buildingType, resourceId) {
      if (buildingType === 'water_station') {
        return (waterCatalog[resourceId] || waterCatalog.water).map(type => get(type, resourceId || 'water')).filter(Boolean);
      }
      if (buildingType === 'storage') return depotCatalog.map(type => get(type));
      if (buildingType === 'waste_heap') {
        return ['input_dock', 'reprocessor', 'incinerator', 'output_dock'].map(type => get(type, 'rock')).filter(Boolean);
      }
      const entry = item => Array.isArray(item) ? get(item[0], item[1]) : get(item, 'rock');
      if (buildingType === 'oil_platform') return oilCatalog.map(type => get(type, 'oil')).filter(Boolean);
      if (buildingType === 'extractor') return extractorCatalog.map(entry).filter(Boolean);
      if (buildingType === 'factory') return factoryCatalog.map(entry).filter(Boolean);
      return [];
    }
  });
})(globalThis);
