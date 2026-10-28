(function (root) {
  'use strict';

  const solid = (id, label, tags, composition = {}, quality = 'standard', particleSize = 'fragment') =>
    ({ id, label, phase: 'solid', family: tags.includes('waste') ? 'waste' : tags.includes('metal') ? 'metal' : 'mineral',
      tags, composition, quality, particleSize, transportable: true });
  const definitions = [
    // Legacy construction identifiers remain valid at the boundary.
    { id: 'iron', label: 'Fer', canonicalId: 'standard_iron' },
    { id: 'copper', label: 'Cuivre', canonicalId: 'standard_copper' },
    { id: 'silicon', label: 'Silice', canonicalId: 'standard_silicon' },
    // Rock is one resource whatever it holds; each stock of it carries its
    // average composition (src/simulation/composition.js).
    solid('raw_rock', 'Roche brute', ['ore', 'rock'], {}, 'impure', 'raw'),
    solid('crushed_rock', 'Roche concassée', ['ore', 'rock'], {}, 'impure', 'fragment'),
    solid('ground_rock', 'Roche broyée', ['ore', 'rock'], {}, 'impure', 'powder'),
    solid('tailings', 'Résidus', ['waste', 'rock'], {}, 'impure', 'powder'),
    solid('iron_concentrate', 'Concentré de fer', ['ore', 'ferrous'], { iron: 1 }, 'impure', 'powder'),
    solid('raw_iron', 'Fer brut', ['metal', 'ferrous'], { iron: 1 }, 'impure'),
    solid('iron_slag', 'Laitier', ['waste'], { iron: .1 }, 'impure', 'powder'),
    solid('copper_concentrate', 'Concentré de cuivre', ['ore', 'nonFerrous'], { copper: 1 }, 'impure', 'powder'),
    solid('raw_copper', 'Cuivre brut', ['metal', 'nonFerrous'], { copper: 1 }, 'impure'),
    solid('copper_slag', 'Laitier de cuivre', ['waste'], { copper: .1 }, 'impure', 'powder'),
    solid('impure_silicon_wet', 'Silicium impur humide', ['silicate', 'wet'], { silicon: 1 }, 'impure', 'powder'),
    solid('impure_silicon_dry', 'Silicium impur sec', ['silicate', 'dry'], { silicon: 1 }, 'impure', 'powder'),
    solid('raw_silicon', 'Silicium brut', ['silicate'], { silicon: 1 }, 'impure', 'powder'),
    solid('silicon_sludge', 'Boues siliceuses', ['waste', 'silicate', 'wet'], { silicon: .1 }, 'impure', 'powder'),
    solid('silicon_slag', 'Laitier de silicium', ['waste'], { silicon: .1 }, 'impure', 'powder'),
    solid('carbon_sludge', 'Boues carbonées', ['waste', 'carbonaceous', 'wet'], { carbon: .1 }, 'impure', 'powder'),
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
    // Colony goods: tar from crushed rock and coal, plates rolled from raw iron.
    solid('tar', 'Goudron', ['building'], { carbon: .2 }),
    solid('metal_plate', 'Plaque de métal', ['metal', 'building', 'ferrous'], { iron: 1 }),
    solid('residual_waste', 'Déchets appauvris', ['waste'], {}, 'impure'),
    solid('sludge', 'Boues', ['waste'], {}, 'impure', 'powder'),
    { id: 'water', label: 'Eau douce', phase: 'liquid', family: 'liquid', tags: ['water'], composition: { water: 1 }, transportable: true },
    { id: 'salt_water', label: 'Eau salée', phase: 'liquid', family: 'liquid', tags: ['water', 'saline'],
      composition: { water: .965, salt: .035 }, quality: 'impure', transportable: true },
    { id: 'brine', label: 'Saumure', phase: 'liquid', family: 'waste', tags: ['waste', 'saline'],
      composition: { salt: .2, water: .8 }, quality: 'impure', transportable: true },
    { id: 'raw_oil', label: 'Pétrole brut', phase: 'liquid', family: 'liquid', tags: ['hydrocarbon'],
      composition: { oil: .8, gas: .15, sterile: .05 }, quality: 'impure', transportable: true },
    { id: 'oil', label: 'Pétrole', phase: 'liquid', family: 'liquid', tags: ['hydrocarbon'], composition: { oil: 1 }, transportable: true },
    { id: 'gas', label: 'Gaz', phase: 'gas', family: 'gas', tags: ['hydrocarbon'], composition: { gas: 1 }, transportable: true }
  ].map(definition => Object.freeze({ ...definition, tags: Object.freeze(definition.tags || []),
    composition: Object.freeze(definition.composition || {}) }));
  const byId = Object.freeze(Object.fromEntries(definitions.map(definition => [definition.id, definition])));

  // Prototype starting stock. Values and building costs stay in data tables so
  // the first economic loop can be balanced without changing simulation code.
  // Landing cargo: a turbine, an iron and a copper line inside their
  // extractors. Growth then comes from what the landing base receives; the
  // launch platform to the Ark is a ~30 minute goal (see PROCESS_SYSTEM.md).
  const startingInventory = Object.freeze({
    iron: 120,
    copper: 60,
    silicon: 0,
    carbon: 6
  });

  root.OrbitResourceData = Object.freeze({
    catalog() { return definitions.slice(); },
    get(id) { return Object.hasOwn(byId, id) ? byId[id] : null; },
    canonicalId(id) { return Object.hasOwn(byId, id) ? byId[id].canonicalId || id : id; },
    startingInventory
  });
})(globalThis);
