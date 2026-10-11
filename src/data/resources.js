(function (root) {
  'use strict';

  const definitions = [
    { id: 'iron', label: 'Fer' },
    { id: 'copper', label: 'Cuivre' },
    { id: 'silicon', label: 'Silice' },
    { id: 'carbon', label: 'Carbone' },
    { id: 'water', label: 'Eau' },
    { id: 'oil', label: 'Hydrocarbures' }
  ].map(definition => Object.freeze(definition));
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
    get(id) { return byId[id] || null; },
    startingInventory
  });
})(globalThis);
