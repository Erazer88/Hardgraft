(function (root) {
  'use strict';

  const config = {
    version: 4,
    fixedStepSeconds: .1,
    maxTicksPerAdvance: 100,
    inputCapacity: 20,
    outputCapacity: 20,
    colonyReserveInfinite: true,
    windPowerUnlimited: true,
    windPowerMW: 32,
    geothermalPowerMW: 80,
    geology: {
      hardnessRange: [.8, 1.8],
      ironAbundance: .52
    }
  };

  const input = (id, label, resourceId) => ({ id, label, resourceId });
  const output = (id, label, resourceId) => ({ id, label, resourceId });
  const definitions = {
    drill: {
      id: 'drill', label: 'FOREUSE', mark: 'FO', source: true,
      inputPorts: [],
      outputPorts: [output('raw_ore', 'Roche ferrifère brute', 'iron_ore_raw')],
      recipe: null, throughput: null, energyMW: 2.5
    },
    crusher: {
      id: 'crusher', label: 'CONCASSEUR', mark: 'CO',
      inputPorts: [input('raw_ore', 'Roche ferrifère brute', 'iron_ore_raw')],
      outputPorts: [output('crushed_ore', 'Minerai concassé', 'iron_ore_crushed')],
      recipe: { inputs: [{ inputId: 'raw_ore', amount: 1 }],
        outputs: [{ outputId: 'crushed_ore', resourceId: 'iron_ore_crushed', amount: 1 }] },
      throughput: 2, energyMW: 2
    },
    grinder: {
      id: 'grinder', label: 'BROYEUR', mark: 'BR',
      inputPorts: [input('crushed_ore', 'Minerai concassé', 'iron_ore_crushed')],
      outputPorts: [output('ground_ore', 'Minerai broyé', 'iron_ore_ground')],
      recipe: { inputs: [{ inputId: 'crushed_ore', amount: 1 }],
        outputs: [{ outputId: 'ground_ore', resourceId: 'iron_ore_ground', amount: 1 }] },
      throughput: 8, energyMW: 6
    },
    magnetic_separator: {
      id: 'magnetic_separator', label: 'SÉPARATEUR MAGNÉTIQUE', mark: 'SM',
      inputPorts: [input('ground_ore', 'Minerai broyé', 'iron_ore_ground')],
      outputPorts: [output('concentrate', 'Concentré de fer', 'iron_concentrate'),
        output('tailings', 'Résidus', 'iron_tailings')],
      recipe: { inputs: [{ inputId: 'ground_ore', amount: 5 }], outputs: [
        { outputId: 'concentrate', resourceId: 'iron_concentrate', amount: 2 },
        { outputId: 'tailings', resourceId: 'iron_tailings', amount: 3 }
      ] },
      throughput: 10, energyMW: 3
    },
    reduction_furnace: {
      id: 'reduction_furnace', label: 'FOUR DE RÉDUCTION', mark: 'FR',
      inputPorts: [input('concentrate', 'Concentré de fer', 'iron_concentrate')],
      outputPorts: [output('raw_iron', 'Fer brut', 'raw_iron'),
        output('slag', 'Laitier', 'iron_slag')],
      recipe: { inputs: [{ inputId: 'concentrate', amount: 2 }], outputs: [
        { outputId: 'raw_iron', resourceId: 'raw_iron', amount: 1 },
        { outputId: 'slag', resourceId: 'iron_slag', amount: 1 }
      ] },
      throughput: 8, energyMW: 10
    }
  };
  const utilities = {
    trash: {
      id: 'trash', label: 'POUBELLE', mark: 'PO', sink: true,
      inputPorts: [{ id: 'material', label: 'Toutes ressources', resourceId: null, acceptsAnyResource: true }],
      outputPorts: [], recipe: null, throughput: null, energyMW: 0
    }
  };

  const statuses = Object.freeze({
    active: 'ACTIF',
    waiting_input: 'ATTENTE ENTRÉE',
    output_full: 'SORTIE PLEINE',
    no_energy: 'SANS ÉNERGIE'
  });

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }

  freeze(config);
  freeze(definitions);
  freeze(utilities);
  root.OrbitProcessData = Object.freeze({
    config,
    definitions,
    utilities,
    statuses,
    get(type) { return definitions[type] || utilities[type] || null; },
    catalog(buildingType) {
      return ['factory', 'extractor'].includes(buildingType)
        ? [...Object.values(definitions), ...Object.values(utilities)] : [];
    }
  });
})(globalThis);
