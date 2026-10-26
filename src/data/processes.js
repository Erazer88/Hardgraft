(function (root) {
  'use strict';

  const config = {
    version: 5,
    fixedStepSeconds: .1,
    maxTicksPerAdvance: 100,
    inputCapacity: 20,
    outputCapacity: 20,
    colonyReserveInfinite: true,
    windPowerUnlimited: true,
    windPowerMW: 32,
    geothermalPowerMW: 80,
    // Ground under an extractor: rock hardness, and the share of the extracted
    // material assumed when a building has none recorded.
    geology: { hardnessRange: [.8, 1.8], defaultShare: .1 }
  };

  const input = (id, label, resourceId, extras = {}) => ({ id, label, resourceId, ...extras });
  const output = (id, label, resourceId, extras = {}) => ({ id, label, resourceId, ...extras });
  const materials = {
    iron: { raw: 'iron_ore_raw', crushed: 'iron_ore_crushed', ground: 'iron_ore_ground',
      rawLabel: 'Roche ferrifère brute', crushedLabel: 'Minerai concassé', groundLabel: 'Minerai broyé',
      separator: 'magnetic_separator', concentrate: 'iron_concentrate', concentrateLabel: 'Concentré de fer',
      residue: 'iron_tailings', residueLabel: 'Résidus', product: 'raw_iron', productLabel: 'Fer brut', slag: 'iron_slag' },
    copper: { raw: 'copper_ore_raw', crushed: 'copper_ore_crushed', ground: 'copper_ore_ground',
      rawLabel: 'Roche cuprifère brute', crushedLabel: 'Minerai concassé', groundLabel: 'Minerai broyé',
      separator: 'gravity_separator', concentrate: 'copper_concentrate', concentrateLabel: 'Concentré de cuivre',
      residue: 'copper_tailings', residueLabel: 'Résidus', product: 'raw_copper', productLabel: 'Cuivre brut', slag: 'copper_slag' },
    silicon: { raw: 'silicon_ore_raw', crushed: 'silicon_ore_crushed', ground: 'silicon_ore_ground',
      rawLabel: 'Roche siliceuse brute', crushedLabel: 'Minerai concassé', groundLabel: 'Minerai broyé',
      product: 'raw_silicon', productLabel: 'Silicium brut', slag: 'silicon_slag' },
    carbon: { raw: 'carbon_ore_raw', crushed: 'carbon_ore_crushed', ground: 'carbon_ore_ground',
      rawLabel: 'Roche carbonée brute', crushedLabel: 'Minerai concassé', groundLabel: 'Minerai broyé',
      separator: 'carbon_separator', concentrate: 'coal', concentrateLabel: 'Charbon',
      residue: 'carbon_tailings', residueLabel: 'Résidus carbonés' }
  };

  const templates = {
    drill: { id: 'drill', label: 'FOREUSE', mark: 'FO', description: 'Extrait la matière dominante du sol sous le bâtiment.', source: true, usesGround: true,
      inputPorts: [], recipe: null, throughput: null, energyMW: 2.5 },
    oil_pump: { id: 'oil_pump', label: 'POMPE PÉTROLIÈRE', mark: 'PP', description: 'Pompe le pétrole brut des fonds marins.', source: true, usesGround: true,
      inputPorts: [], outputPorts: [output('raw_oil', 'Pétrole brut', 'raw_oil')], recipe: null,
      throughput: 2, energyMW: 2.5 },
    water_supply: { id: 'water_supply', label: 'RÉSERVE D’EAU', mark: 'EA', description: 'Fournit l’eau nécessaire aux procédés de lavage.', source: true,
      inputPorts: [], outputPorts: [output('water', 'Eau', 'water')], recipe: null,
      throughput: null, energyMW: 0 },
    crusher: { id: 'crusher', label: 'CONCASSEUR', mark: 'CO', description: 'Brise la roche brute en minerai concassé, sans séparer les matières.', throughput: 2, energyMW: 2 },
    grinder: { id: 'grinder', label: 'BROYEUR', mark: 'BR', description: 'Réduit le minerai concassé en grains plus fins.', throughput: 2, energyMW: 6 },
    magnetic_separator: { id: 'magnetic_separator', label: 'SÉPARATEUR MAGNÉTIQUE', mark: 'SM',
      description: 'Attire le fer hors du minerai et rejette les résidus.', throughput: 2, energyMW: 3 },
    gravity_separator: { id: 'gravity_separator', label: 'SÉPARATEUR GRAVITAIRE', mark: 'SG',
      description: 'Concentre le cuivre et sépare les résidus plus légers.', throughput: 2, energyMW: 3 },
    silicon_washer: { id: 'silicon_washer', label: 'LAVEUSE DE SILICE', mark: 'LS',
      description: 'Lave la silice avec de l’eau et produit des boues.', throughput: 2, energyMW: 3 },
    silicon_dryer: { id: 'silicon_dryer', label: 'SÉCHEUR DE SILICE', mark: 'SS',
      description: 'Retire l’humidité du silicium lavé avant réduction.', throughput: 2, energyMW: 4 },
    carbon_separator: { id: 'carbon_separator', label: 'TRIEUSE DE CARBONE', mark: 'TC',
      description: 'Sépare le charbon de la roche carbonée.', throughput: 2, energyMW: 3 },
    carbon_washer: { id: 'carbon_washer', label: 'LAVAGE DU CHARBON', mark: 'LC',
      description: 'Lave le charbon à l’eau pour obtenir du carbone.', throughput: 2, energyMW: 3 },
    reduction_furnace: { id: 'reduction_furnace', label: 'FOUR DE RÉDUCTION', mark: 'FR',
      description: 'Transforme le concentré en métal brut et en laitier.', throughput: 2, energyMW: 10 },
    triphasic_separator: { id: 'triphasic_separator', label: 'SÉPARATEUR TRIPHASÉ', mark: 'ST',
      description: 'Sépare le pétrole brut en pétrole, gaz et déchets.', throughput: 2, energyMW: 4 }
  };

  const utilities = {
    input_dock: {
      id: 'input_dock', label: 'QUAI D’ENTRÉE', mark: 'QE', description: 'Reçoit les ressources du réseau routier et alimente les machines.', externalInput: true,
      inputPorts: [], outputPorts: [output('material', 'Ressource reçue', null)], recipe: null, throughput: 2, energyMW: 0
    },
    terril: {
      id: 'terril', label: 'TERRIL', mark: 'TE', description: 'Stocke sans limite les matières et résidus.', sink: true, storesResources: true,
      inputPorts: [input('material', 'Toutes ressources', null, { acceptsAnyResource: true })],
      outputPorts: [], recipe: null, throughput: null, energyMW: 0
    },
    output_dock: {
      id: 'output_dock', label: 'DOCK DE SORTIE', mark: 'DS', description: 'Envoie sa ressource vers un bâtiment relié par route.', sink: true, externalOutput: true,
      inputPorts: [input('material', 'Sortie planétaire', null, { acceptsAnyResource: true })],
      outputPorts: [], recipe: null, throughput: 2, energyMW: 0
    }
  };

  const catalogByResource = {
    iron: ['drill', 'crusher', 'grinder', 'magnetic_separator', 'reduction_furnace', 'terril', 'output_dock'],
    copper: ['drill', 'crusher', 'grinder', 'gravity_separator', 'reduction_furnace', 'terril', 'output_dock'],
    silicon: ['drill', 'crusher', 'grinder', 'water_supply', 'silicon_washer', 'silicon_dryer',
      'reduction_furnace', 'terril', 'output_dock'],
    carbon: ['drill', 'crusher', 'grinder', 'carbon_separator', 'water_supply', 'carbon_washer',
      'terril', 'output_dock'],
    oil: ['oil_pump', 'triphasic_separator', 'terril', 'output_dock']
  };

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }

  function solidDefinition(type, resourceId) {
    const material = materials[resourceId];
    if (!material) return null;
    const base = templates[type];
    if (type === 'drill') return { ...base,
      outputPorts: [output('raw_ore', material.rawLabel, material.raw)] };
    if (type === 'crusher') return { ...base,
      inputPorts: [input('raw_ore', material.rawLabel, material.raw)],
      outputPorts: [output('crushed_ore', material.crushedLabel, material.crushed)],
      recipe: { inputs: [{ inputId: 'raw_ore', amount: 1 }],
        outputs: [{ outputId: 'crushed_ore', resourceId: material.crushed, amount: 1 }] } };
    if (type === 'grinder') return { ...base,
      inputPorts: [input('crushed_ore', material.crushedLabel, material.crushed)],
      outputPorts: [output('ground_ore', material.groundLabel, material.ground)],
      recipe: { inputs: [{ inputId: 'crushed_ore', amount: 1 }],
        outputs: [{ outputId: 'ground_ore', resourceId: material.ground, amount: 1 }] } };
    if (type === material.separator) {
      if (type === 'silicon_washer' || type === 'carbon_washer') return null;
      return { ...base,
        inputPorts: [input('ground_ore', material.groundLabel, material.ground)],
        outputPorts: [output('concentrate', material.concentrateLabel, material.concentrate),
          output('residue', material.residueLabel, material.residue)],
        recipe: { inputs: [{ inputId: 'ground_ore', amount: 5 }], outputs: [
          { outputId: 'concentrate', resourceId: material.concentrate, amount: 2 },
          { outputId: 'residue', resourceId: material.residue, amount: 3 }
        ] } };
    }
    if (type === 'silicon_washer' && resourceId === 'silicon') return { ...base,
      inputPorts: [input('ground_ore', material.groundLabel, material.ground), input('water', 'Eau', 'water')],
      outputPorts: [output('wet_silicon', 'Silicium impur humide', 'impure_silicon_wet'),
        output('sludge', 'Boues siliceuses', 'silicon_sludge')],
      recipe: { inputs: [{ inputId: 'ground_ore', amount: 20 }, { inputId: 'water', amount: 5 }], outputs: [
        { outputId: 'wet_silicon', resourceId: 'impure_silicon_wet', amount: 8 },
        { outputId: 'sludge', resourceId: 'silicon_sludge', amount: 12 }
      ] } };
    if (type === 'silicon_dryer' && resourceId === 'silicon') return { ...base,
      inputPorts: [input('wet_silicon', 'Silicium impur humide', 'impure_silicon_wet')],
      outputPorts: [output('dry_silicon', 'Silicium impur sec', 'impure_silicon_dry')],
      recipe: { inputs: [{ inputId: 'wet_silicon', amount: 1 }], outputs: [
        { outputId: 'dry_silicon', resourceId: 'impure_silicon_dry', amount: 1 }
      ] } };
    if (type === 'carbon_washer' && resourceId === 'carbon') return { ...base,
      inputPorts: [input('coal', 'Charbon', 'coal'), input('water', 'Eau', 'water')],
      outputPorts: [output('carbon', 'Carbone', 'carbon'), output('sludge', 'Boues carbonées', 'carbon_sludge')],
      recipe: { inputs: [{ inputId: 'coal', amount: 20 }, { inputId: 'water', amount: 5 }], outputs: [
        { outputId: 'carbon', resourceId: 'carbon', amount: 8 },
        { outputId: 'sludge', resourceId: 'carbon_sludge', amount: 12 }
      ] } };
    if (type === 'reduction_furnace' && material.product) {
      const inputId = resourceId === 'silicon' ? 'dry_silicon' : 'concentrate';
      const inputResource = resourceId === 'silicon' ? 'impure_silicon_dry' : material.concentrate;
      const inputLabel = resourceId === 'silicon' ? 'Silicium impur sec' : material.concentrateLabel;
      return { ...base,
        inputPorts: [input(inputId, inputLabel, inputResource)],
        outputPorts: [output('product', material.productLabel, material.product),
          output('slag', resourceId === 'silicon' ? 'Laitier de silicium' : 'Laitier', material.slag)],
        recipe: { inputs: [{ inputId, amount: 2 }], outputs: [
          { outputId: 'product', resourceId: material.product, amount: 1 },
          { outputId: 'slag', resourceId: material.slag, amount: 1 }
        ] } };
    }
    return null;
  }

  const cache = new Map();
  function get(type, resourceId = 'iron') {
    const key = `${type}:${resourceId || ''}`;
    if (cache.has(key)) return cache.get(key);
    if ((type === 'oil_pump' || type === 'triphasic_separator') && resourceId !== 'oil') {
      cache.set(key, null);
      return null;
    }
    let definition = null;
    if (type === 'drill' || type === 'crusher' || type === 'grinder' || type === 'magnetic_separator' ||
        type === 'gravity_separator' || type === 'silicon_washer' || type === 'silicon_dryer' ||
        type === 'carbon_separator' || type === 'carbon_washer' || type === 'reduction_furnace') {
      definition = solidDefinition(type, resourceId || 'iron');
    } else if (type === 'triphasic_separator' && resourceId === 'oil') {
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
    else definition = templates[type] || utilities[type] || null;
    cache.set(key, definition ? freeze(definition) : null);
    return cache.get(key);
  }

  const definitionContexts = {
    drill: 'iron', oil_pump: 'oil', water_supply: 'silicon', crusher: 'iron', grinder: 'iron',
    magnetic_separator: 'iron', gravity_separator: 'copper', silicon_washer: 'silicon',
    silicon_dryer: 'silicon', carbon_separator: 'carbon', carbon_washer: 'carbon',
    reduction_furnace: 'iron', triphasic_separator: 'oil'
  };
  const definitions = Object.freeze(Object.fromEntries(Object.entries(definitionContexts)
    .map(([type, resourceId]) => [type, get(type, resourceId)])
    .filter(([, definition]) => definition)));
  const frozenUtilities = freeze(utilities);
  function contextForResource(resourceId) {
    if (Object.hasOwn(materials, resourceId)) return resourceId;
    for (const [context, material] of Object.entries(materials)) {
      if (Object.values(material).includes(resourceId)) return context;
    }
    if (['impure_silicon_wet', 'impure_silicon_dry', 'silicon_sludge'].includes(resourceId)) return 'silicon';
    if (['coal', 'carbon', 'carbon_sludge'].includes(resourceId)) return 'carbon';
    if (['raw_oil', 'oil', 'gas'].includes(resourceId)) return 'oil';
    return null;
  }
  const statuses = freeze({ active: 'ACTIF', waiting_input: 'ATTENTE ENTRÉE', output_full: 'SORTIE PLEINE', no_energy: 'SANS ÉNERGIE' });
  freeze(config); freeze(materials); freeze(catalogByResource); freeze(templates);

  root.OrbitProcessData = Object.freeze({
    config, definitions, utilities: frozenUtilities, statuses, materials,
    get, contextForResource,
    catalog(buildingType, resourceId) {
      if (!['factory', 'extractor', 'oil_platform'].includes(buildingType)) return [];
      const selected = resourceId || (buildingType === 'oil_platform' ? 'oil' : 'iron');
      if (buildingType === 'oil_platform' && selected !== 'oil' || buildingType === 'extractor' && selected === 'oil') return [];
      const types = catalogByResource[selected] || [];
      return [...(buildingType === 'factory' ? [get('input_dock', selected)] : []),
        ...types.map(type => get(type, selected))].filter(Boolean);
    }
  });
})(globalThis);
