(function (root) {
  'use strict';
  const config = {
    version: 2, fixedStepSeconds: .1, maxTicksPerAdvance: 100, maxTransfersPerTick: 512,
    maxNodes: 256, maxConnections: 512, world: { width: 2600, height: 1800 },
    inputCapacity: 20, outputCapacity: 20, buildingInputCapacity: 1000, buildingExportCapacity: 500,
    colonyReserveInfinite: true, windPowerUnlimited: true, windPowerMW: 32, geothermalPowerMW: 80,
    throughputPerLevel: .15, recoveryBonusByLevel: [0, .03, .06, .08], maxRecovery: .95,
    geology: { baseThroughput: 10, hardnessRange: [.8, 1.8], moistureRange: [.05, .45],
      signatures: {
        iron: { iron: .52, copper: .08, silicon: .14, carbon: .03, sterile: .23 },
        copper: { iron: .12, copper: .48, silicon: .15, carbon: .04, sterile: .21 },
        silicon: { iron: .08, copper: .04, silicon: .58, carbon: .03, sterile: .27 },
        carbon: { iron: .06, copper: .03, silicon: .12, carbon: .52, sterile: .27 },
        oil: { oil: .8, gas: .15, sterile: .05 }
      } }
  };
  function port(id, direction, phases = ['solid'], options = {}) {
    const names = { material: 'Matière', product: 'Produit', carbon: 'Carbone', water: 'Eau', raw_rock: 'Roche brute',
      oversized: 'Trop gros', calibrated: 'Calibrés', conforming: 'Conforme', rejected: 'Rejeté', rework: 'Retour concasseur',
      correct: 'Taille correcte', iron: 'Fer impur', copper: 'Cuivre impur', silicon: 'Silicium impur',
      coal: 'Charbon', rejects: 'Rejets', sludge: 'Boues', metal: 'Métal', waste: 'Déchets', refined: 'Matériau affiné',
      branch_a: 'Branche A', branch_b: 'Branche B', residual_ore: 'Minerai résiduel', depleted_waste: 'Déchets appauvris',
      crude: 'Pétrole brut', gas: 'Gaz', oil: 'Pétrole', standard: 'Standard', superior: 'Supérieur' };
    return { id, label: names[id] || id, direction, phases, acceptedTags: [], acceptedResources: [], maxThroughput: 12,
      allowMultipleResources: false, compatibilityMode: 'permissive', ...options };
  }
  const inlet = (id = 'material', options = {}) => port(id, 'input', ['solid'], options);
  const outlet = (id = 'product', options = {}) => port(id, 'output', ['solid'], options);
  const anyIn = (id = 'material') => port(id, 'input', ['solid', 'liquid', 'gas']);
  const anyOut = (id = 'product') => port(id, 'output', ['solid', 'liquid', 'gas']);
  const carbonPort = () => inlet('carbon', { acceptedResources: ['carbon'], compatibilityMode: 'strict', maxThroughput: 4 });
  const waterPort = () => port('water', 'input', ['liquid'], { acceptedResources: ['water'], compatibilityMode: 'strict', maxThroughput: 6 });
  const definitions = {};
  function block(id, label, mark, operation, inputPorts, outputPorts, options = {}) {
    definitions[id] = { id, type: id, label, mark, operation, inputPorts, outputPorts,
      inputs: inputPorts.length, outputs: outputPorts.length, category: 'TRAITEMENT',
      detail: '', baseThroughput: 8, processingTime: 1, energyUse: 2,
      inputCapacity: config.inputCapacity, outputCapacity: config.outputCapacity,
      compatibilityMode: 'pass', invalidInputBehavior: 'pass_through', recipes: [], enabled: true, ...options };
  }
  block('input', 'ENTRÉE DU BÂTIMENT', 'IN', 'import', [], [anyOut()],
    { category: 'FLUX', detail: 'Stock extérieur vers processus', baseThroughput: 12, energyUse: 0 });
  block('drill', 'FOREUSE', 'FO', 'source', [], [outlet('raw_rock')],
    { category: 'EXTRACTION', detail: 'Roche du gisement associé', baseThroughput: 10, energyUse: 2.5, sourceResource: 'raw_rock' });
  block('crusher', 'CONCASSEUR', 'CO', 'recipe', [inlet(), inlet('rework', {
    acceptedTags: ['ore', 'waste'], compatibilityMode: 'strict' })], [outlet()],
    { detail: 'Roche brute / trop gros → fragments', baseThroughput: 10, energyUse: 2,
      mainInputPorts: [0, 1],
      recipes: [{ id: 'crush', operation: 'resize', particleSizes: ['raw', 'oversized'], resources: ['raw_rock', 'rock_fragments',
        'residual_ore', 'residual_ore_fragment', 'waste', 'residual_waste'],
        particleSize: 'fragment', outputMap: { raw_rock: 'rock_fragments', residual_ore: 'residual_ore_fragment' } }] });
  block('grinder', 'BROYEUR', 'BR', 'recipe', [inlet()], [outlet()],
    { detail: 'Fragments → poudre', baseThroughput: 9, energyUse: 6,
      recipes: [
        { id: 'grind', operation: 'resize', particleSizes: ['fragment', 'calibrated'], resources: ['rock_fragments', 'residual_ore_fragment', 'waste', 'residual_waste'],
          particleSize: 'powder', outputMap: { rock_fragments: 'rock_powder', residual_ore_fragment: 'residual_ore_powder' } },
        { id: 'grind_raw', operation: 'resize', particleSizes: ['raw'], resources: ['raw_rock', 'residual_ore', 'waste', 'residual_waste'],
          particleSize: 'powder', outputMap: { raw_rock: 'rock_powder', residual_ore: 'residual_ore_powder' },
          mode: 'degraded', rateMultiplier: 2 / 9, energyMultiplier: 3,
          message: 'Roche non concassée : débit très faible et forte consommation.' }
      ] });
  block('screen', 'CRIBLE', 'CR', 'screen', [inlet()], [outlet('oversized'), outlet('calibrated')],
    { detail: 'Trop gros / taille correcte', baseThroughput: 12, energyUse: 1, category: 'TRI' });
  const recover = (id, element, outputResource, recovery, extra = {}) => ({ id, operation: 'recover', element,
    outputResource, recovery, rawRateMultiplier: .36, fragmentRateMultiplier: .8,
    calibratedRateMultiplier: .9, powderRateMultiplier: 1, ...extra });
  block('magnetic_sorter', 'TRIEUSE MAGNÉTIQUE', 'TM', 'recipe', [inlet()], [outlet('iron'), outlet('rejects')],
    { category: 'TRI', detail: 'Fraction ferreuse → fer impur', baseThroughput: 10, energyUse: 3,
      passResources: ['impure_iron', 'standard_iron', 'steel'],
      recipes: [recover('iron_recovery', 'iron', 'impure_iron', { raw: .25, fragment: .86, calibrated: .89, powder: .92 })] });
  block('gravity_sorter', 'TRIEUSE GRAVITAIRE', 'TG', 'recipe', [inlet()], [outlet('copper'), outlet('rejects')],
    { category: 'TRI', detail: 'Fraction cuivre → cuivre impur', baseThroughput: 10, energyUse: 3.5,
      passResources: ['impure_copper', 'standard_copper', 'pure_copper'],
      recipes: [recover('copper_recovery', 'copper', 'impure_copper', { raw: .2, fragment: .82, calibrated: .86, powder: .91 })] });
  block('silicon_washer', 'LAVEUSE SILICIUM', 'LS', 'recipe', [inlet(), waterPort()], [outlet('silicon'), outlet('sludge')],
    { detail: 'Silicium + eau → silicium humide', baseThroughput: 10, energyUse: 3,
      passResources: ['impure_silicon', 'standard_silicon', 'pure_silicon'],
      recipes: [recover('silicon_recovery', 'silicon', 'impure_silicon', { raw: .28, fragment: .84, calibrated: .87, powder: .9 },
        { secondary: { port: 1, resourceId: 'water', ratio: .25 }, outputMoisture: .8, wasteResource: 'sludge' })] });
  block('silicon_dryer', 'SÉCHEUR SILICIUM', 'SE', 'recipe', [inlet()], [outlet()],
    { detail: 'Silicium humide → sec', baseThroughput: 6, energyUse: 4,
      recipes: [{ id: 'dry_silicon', operation: 'dry', resources: ['impure_silicon'], minMoisture: .05 }] });
  block('coal_sorter', 'TRIEUSE CHARBON', 'TC', 'recipe', [inlet()], [outlet('coal'), outlet('rejects')],
    { category: 'TRI', detail: 'Fraction carbonée → charbon', baseThroughput: 10, energyUse: 2,
      passResources: ['coal', 'carbon'],
      recipes: [recover('coal_recovery', 'carbon', 'coal', { raw: .3, fragment: .85, calibrated: .87, powder: .88 })] });
  block('coal_washer', 'LAVAGE CHARBON', 'LC', 'recipe', [inlet(), waterPort()], [outlet('carbon'), outlet('sludge')],
    { detail: 'Charbon + eau → carbone', baseThroughput: 6, energyUse: 2.5,
      recipes: [{ id: 'wash_coal', operation: 'purify', resources: ['coal'], outputResource: 'carbon', element: 'carbon', yield: .85,
        secondary: { port: 1, resourceId: 'water', ratio: .25 }, wasteResource: 'sludge' }] });
  const smelt = (material, element) => ({ id: 'smelt_' + element, operation: 'purify', resources: [material],
    outputResource: 'standard_' + element, element, yield: .92,
    secondary: { port: 1, resourceId: 'carbon', ratio: .1 },
    wet: { threshold: .25, yieldMultiplier: .8, rateMultiplier: .65, energyMultiplier: 1.6 } });
  block('smelter', 'FONDERIE', 'FN', 'recipe', [inlet(), carbonPort()], [outlet('metal'), outlet('waste')],
    { detail: 'Matière préparée + carbone', baseThroughput: 4, energyUse: 8.2,
      invalidInputBehavior: 'waste', destructiveTags: ['ore', 'waste'], invalidInputRate: 2, invalidInputEnergyMultiplier: 3,
      passResources: ['standard_iron', 'steel', 'pure_copper', 'standard_copper', 'standard_silicon', 'pure_silicon', 'carbon', 'coal'],
      recipes: [smelt('impure_iron', 'iron'), smelt('impure_copper', 'copper'), smelt('impure_silicon', 'silicon')] });
  const refine = (input, output, element, options = {}) => ({ id: 'refine_' + input, operation: 'purify',
    resources: [input], outputResource: output, element, yield: .95, ...options });
  block('refiner', 'AFFINEUR', 'AF', 'recipe', [inlet(), carbonPort()], [outlet('refined'), outlet('waste')],
    { detail: 'Acier / cuivre pur / silicium pur', baseThroughput: 3, energyUse: 10,
      invalidInputBehavior: 'waste', destructiveTags: ['ore', 'waste'], recipes: [
        refine('standard_iron', 'steel', 'iron', { secondary: { port: 1, resourceId: 'carbon', ratio: .1 }, yield: .96 }),
        refine('standard_copper', 'pure_copper', 'copper'), refine('standard_silicon', 'pure_silicon', 'silicon'),
        ...['iron', 'copper', 'silicon'].map(element => refine('impure_' + element, 'standard_' + element, element,
          { mode: 'degraded', yield: .25, rateMultiplier: 1 / 3, energyMultiplier: 1.6,
            message: 'Matière insuffisamment préparée : faible récupération et beaucoup de déchets.' }))
      ] });
  block('storage', 'STOCK TAMPON', 'ST', 'pass', [anyIn()], [anyOut()],
    { category: 'FLUX', detail: 'Une seule matière à la fois', inputCapacity: 500, outputCapacity: 500,
      baseThroughput: 12, energyUse: 0, storagePhase: 'solid' });
  block('splitter', 'DIVISION', 'DI', 'split', [anyIn()], [anyOut('branch_a'), anyOut('branch_b')],
    { category: 'FLUX', detail: 'Répartition avec redistribution', baseThroughput: 12, energyUse: 0 });
  block('merger', 'FUSION', 'FU', 'merge', [anyIn('branch_a'), anyIn('branch_b')], [anyOut()],
    { category: 'FLUX', detail: 'Même resourceId uniquement', baseThroughput: 12, energyUse: 0 });
  block('dock', 'QUAI DE CHARGEMENT', 'QU', 'export', [anyIn()], [],
    { category: 'FLUX', detail: 'Stock extérieur, filtre facultatif', baseThroughput: 12, energyUse: 0 });
  block('dump', 'TERRIL', 'TE', 'dump', [inlet()], [],
    { category: 'DÉCHETS', detail: 'Dépôt permanent, composition conservée', baseThroughput: 12, energyUse: 0 });
  block('waste_analyzer', 'ANALYSEUR DE DÉCHETS', 'AD', 'recipe', [inlet('waste', { acceptedTags: ['waste'], compatibilityMode: 'strict' })],
    [outlet('residual_ore'), outlet('depleted_waste')], { category: 'DÉCHETS', detail: 'Résidu minéral récupérable', baseThroughput: 5, energyUse: 4,
      recipes: [{ id: 'waste_recovery', operation: 'recycle', recovery: .65, remainingRecoverability: .35 }] });
  block('oil_pump', 'POMPE PÉTROLIÈRE', 'PP', 'source', [], [port('crude', 'output', ['liquid'])],
    { category: 'EXTRACTION', detail: 'Pétrole brut du gisement', baseThroughput: 8, energyUse: 3, sourceResource: 'raw_oil' });
  block('triphasic_separator', 'SÉPARATEUR TRIPHASÉ', 'SP', 'recipe',
    [port('crude', 'input', ['liquid'], { acceptedResources: ['raw_oil'], compatibilityMode: 'strict' })],
    [port('gas', 'output', ['gas']), port('oil', 'output', ['liquid']), outlet('waste')],
    { detail: 'Gaz / pétrole / déchets', baseThroughput: 8, energyUse: 3,
      recipes: [{ id: 'oil_separation', operation: 'triphasic', resources: ['raw_oil'] }] });
  block('quality_analyzer', 'ANALYSE QUALITÉ', 'AQ', 'quality', [inlet()], [outlet('standard'), outlet('superior')],
    { category: 'QUALITÉ', detail: 'Prévu pour une version ultérieure', enabled: false });
  block('filter', 'FILTRE', 'FL', 'filter', [anyIn()], [anyOut('conforming'), anyOut('rejected')],
    { category: 'FLUX', detail: 'Flux conforme / rejeté, matière inchangée', baseThroughput: 12, energyUse: 0 });

  const mineralCatalog = ['input', 'drill', 'crusher', 'grinder', 'screen', 'magnetic_sorter', 'gravity_sorter',
    'silicon_washer', 'silicon_dryer', 'coal_sorter', 'coal_washer', 'smelter', 'refiner', 'storage', 'splitter',
    'merger', 'dock', 'dump', 'waste_analyzer', 'filter', 'quality_analyzer'];
  const oilCatalog = ['input', 'oil_pump', 'triphasic_separator', 'storage', 'splitter', 'merger', 'dock', 'dump', 'filter'];
  const transportCatalog = ['input', 'storage', 'splitter', 'merger', 'dock', 'dump', 'filter'];
  const legacyTypes = { transform: 'smelter', assembly: 'refiner', separator: 'splitter', output: 'dock' };
  const statuses = {
    active: 'ACTIF', waiting: 'EN ATTENTE', missing_input: 'ENTRÉE MANQUANTE', output_blocked: 'SORTIE BLOQUÉE',
    incompatible: 'RESSOURCE INCOMPATIBLE', useless: 'TRAITEMENT INUTILE', degraded: 'TRAITEMENT DÉGRADÉ',
    saturated: 'SATURÉ', no_energy: 'SANS ÉNERGIE', destructive: 'PROCÉDÉ INADAPTÉ'
  };
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  }
  freeze(config); freeze(definitions); freeze(statuses); freeze(legacyTypes);
  root.OrbitProcessData = Object.freeze({ config, definitions, statuses, legacyTypes,
    get(type) { return definitions[legacyTypes[type] || type] || null; },
    catalog(buildingType) {
      const ids = buildingType === 'oil_platform' ? oilCatalog :
        ['factory', 'extractor'].includes(buildingType) ? mineralCatalog : transportCatalog;
      return ids.filter(id => id !== 'drill' || buildingType === 'extractor').map(id => definitions[id]);
    } });
})(globalThis);
