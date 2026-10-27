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
    solid('raw_rock', 'Roche brute', ['ore'], {}, 'impure', 'raw'),
    solid('iron_ore_raw', 'Roche ferrifère brute', ['ore', 'ferrous'], { iron: .52 }, 'impure', 'raw'),
    solid('iron_ore_crushed', 'Minerai concassé', ['ore', 'ferrous'], { iron: .52 }, 'impure', 'fragment'),
    solid('iron_ore_ground', 'Minerai broyé', ['ore', 'ferrous'], { iron: .52 }, 'impure', 'powder'),
    solid('copper_ore_raw', 'Roche cuprifère brute', ['ore', 'nonFerrous'], { copper: .52 }, 'impure', 'raw'),
    solid('copper_ore_crushed', 'Minerai de cuivre concassé', ['ore', 'nonFerrous'], { copper: .52 }, 'impure', 'fragment'),
    solid('copper_ore_ground', 'Minerai de cuivre broyé', ['ore', 'nonFerrous'], { copper: .52 }, 'impure', 'powder'),
    solid('silicon_ore_raw', 'Roche siliceuse brute', ['ore', 'silicate'], { silicon: .52 }, 'impure', 'raw'),
    solid('silicon_ore_crushed', 'Minerai siliceux concassé', ['ore', 'silicate'], { silicon: .52 }, 'impure', 'fragment'),
    solid('silicon_ore_ground', 'Minerai siliceux broyé', ['ore', 'silicate'], { silicon: .52 }, 'impure', 'powder'),
    solid('carbon_ore_raw', 'Roche carbonée brute', ['ore', 'carbonaceous'], { carbon: .52 }, 'impure', 'raw'),
    solid('carbon_ore_crushed', 'Minerai carboné concassé', ['ore', 'carbonaceous'], { carbon: .52 }, 'impure', 'fragment'),
    solid('carbon_ore_ground', 'Minerai carboné broyé', ['ore', 'carbonaceous'], { carbon: .52 }, 'impure', 'powder'),
    solid('iron_concentrate', 'Concentré de fer', ['ore', 'ferrous'], { iron: 1 }, 'impure', 'powder'),
    solid('iron_tailings', 'Résidus de séparation', ['waste', 'ferrous'], { iron: .1 }, 'impure', 'powder'),
    solid('raw_iron', 'Fer brut', ['metal', 'ferrous'], { iron: 1 }, 'impure'),
    solid('iron_slag', 'Laitier', ['waste'], { iron: .1 }, 'impure', 'powder'),
    solid('copper_concentrate', 'Concentré de cuivre', ['ore', 'nonFerrous'], { copper: 1 }, 'impure', 'powder'),
    solid('copper_tailings', 'Résidus de cuivre', ['waste', 'nonFerrous'], { copper: .1 }, 'impure', 'powder'),
    solid('raw_copper', 'Cuivre brut', ['metal', 'nonFerrous'], { copper: 1 }, 'impure'),
    solid('copper_slag', 'Laitier de cuivre', ['waste'], { copper: .1 }, 'impure', 'powder'),
    solid('impure_silicon_wet', 'Silicium impur humide', ['silicate', 'wet'], { silicon: 1 }, 'impure', 'powder'),
    solid('impure_silicon_dry', 'Silicium impur sec', ['silicate', 'dry'], { silicon: 1 }, 'impure', 'powder'),
    solid('raw_silicon', 'Silicium brut', ['silicate'], { silicon: 1 }, 'impure', 'powder'),
    solid('silicon_sludge', 'Boues siliceuses', ['waste', 'silicate', 'wet'], { silicon: .1 }, 'impure', 'powder'),
    solid('silicon_slag', 'Laitier de silicium', ['waste'], { silicon: .1 }, 'impure', 'powder'),
    solid('carbon_tailings', 'Résidus carbonés', ['waste', 'carbonaceous'], { carbon: .1 }, 'impure', 'powder'),
    solid('carbon_sludge', 'Boues carbonées', ['waste', 'carbonaceous', 'wet'], { carbon: .1 }, 'impure', 'powder'),
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
