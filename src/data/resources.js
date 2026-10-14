(function (root) {
  'use strict';

  const solid = (id, label, tags, composition = {}, quality = 'standard', particleSize = 'fragment') =>
    ({ id, label, phase: 'solid', family: tags.includes('waste') ? 'waste' : tags.includes('metal') ? 'metal' : 'mineral',
      tags, composition, quality, particleSize, transportable: true });
  const definitions = [
    // Legacy construction/deposit identifiers remain valid at the boundary.
    { id: 'iron', label: 'Fer', canonicalId: 'standard_iron' },
    { id: 'copper', label: 'Cuivre', canonicalId: 'standard_copper' },
    { id: 'silicon', label: 'Silice', canonicalId: 'standard_silicon' },
    solid('raw_rock', 'Roche brute', ['ore'], {}, 'impure', 'raw'),
    solid('rock_fragments', 'Fragments de roche', ['ore'], {}, 'impure'),
    solid('rock_powder', 'Poudre de roche', ['ore'], {}, 'impure', 'powder'),
    solid('residual_ore', 'Minerai résiduel', ['ore'], {}, 'impure', 'raw'),
    solid('residual_ore_fragment', 'Minerai résiduel fragmenté', ['ore'], {}, 'impure'),
    solid('residual_ore_powder', 'Minerai résiduel en poudre', ['ore'], {}, 'impure', 'powder'),
    solid('impure_iron', 'Fer impur', ['metal', 'ferrous'], { iron: 1 }, 'impure'),
    solid('standard_iron', 'Fer standard', ['metal', 'ferrous'], { iron: 1 }),
    solid('steel', 'Acier', ['metal', 'ferrous'], { iron: .98, carbon: .02 }),
    solid('impure_copper', 'Cuivre impur', ['metal', 'nonFerrous'], { copper: 1 }, 'impure'),
    solid('standard_copper', 'Cuivre standard', ['metal', 'nonFerrous'], { copper: 1 }),
    solid('pure_copper', 'Cuivre pur', ['metal', 'nonFerrous'], { copper: 1 }, 'superior'),
    solid('impure_silicon', 'Silicium impur', ['silicate'], { silicon: 1 }, 'impure'),
    solid('standard_silicon', 'Silicium standard', ['silicate'], { silicon: 1 }),
    solid('pure_silicon', 'Silicium pur', ['silicate'], { silicon: 1 }, 'superior'),
    solid('coal', 'Charbon', ['carbonaceous'], { carbon: 1 }, 'impure'),
    solid('carbon', 'Carbone', ['carbonaceous'], { carbon: 1 }),
    solid('waste', 'Déchets minéraux', ['waste'], {}, 'impure'),
    solid('residual_waste', 'Déchets appauvris', ['waste'], {}, 'impure'),
    solid('sludge', 'Boues', ['waste'], {}, 'impure', 'powder'),
    { id: 'water', label: 'Eau', phase: 'liquid', family: 'liquid', tags: ['water'], composition: { water: 1 }, transportable: true },
    { id: 'raw_oil', label: 'Pétrole brut', phase: 'liquid', family: 'liquid', tags: ['hydrocarbon'],
      composition: { oil: .8, gas: .15, sterile: .05 }, quality: 'impure', transportable: true },
    { id: 'oil', label: 'Pétrole', phase: 'liquid', family: 'liquid', tags: ['hydrocarbon'], composition: { oil: 1 }, transportable: true },
    { id: 'gas', label: 'Gaz', phase: 'gas', family: 'gas', tags: ['hydrocarbon'], composition: { gas: 1 }, transportable: true }
  ].map(definition => Object.freeze({ ...definition, tags: Object.freeze(definition.tags || []),
    composition: Object.freeze(definition.composition || {}) }));
  const byId = Object.freeze(Object.fromEntries(definitions.map(definition => [definition.id, definition])));

  // Prototype starting stock. Values and building costs stay in data tables so
  // the first economic loop can be balanced without changing simulation code.
  const startingInventory = Object.freeze({
    iron: 160,
    copper: 100,
    silicon: 40,
    carbon: 40,
    water: 60
  });

  root.OrbitResourceData = Object.freeze({
    catalog() { return definitions.slice(); },
    get(id) { return Object.hasOwn(byId, id) ? byId[id] : null; },
    canonicalId(id) { return Object.hasOwn(byId, id) ? byId[id].canonicalId || id : id; },
    startingInventory
  });
})(globalThis);
