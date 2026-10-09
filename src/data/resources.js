(function (root) {
  'use strict';

  const order = Object.freeze(['iron', 'copper', 'silicon', 'carbon', 'water']);
  const definitions = Object.freeze({
    iron: Object.freeze({ id: 'iron', name: 'Fer', short: 'Fe', color: '#c2a88f' }),
    copper: Object.freeze({ id: 'copper', name: 'Cuivre', short: 'Cu', color: '#d18b62' }),
    silicon: Object.freeze({ id: 'silicon', name: 'Silicium', short: 'Si', color: '#9db8bd' }),
    carbon: Object.freeze({ id: 'carbon', name: 'Carbone', short: 'C', color: '#8997a0' }),
    water: Object.freeze({ id: 'water', name: 'Eau', short: 'H₂O', color: '#79abc5' })
  });
  const startingStock = Object.freeze({ iron: 220, copper: 150, silicon: 130, carbon: 100, water: 240 });

  function emptyInventory() {
    return Object.fromEntries(order.map(id => [id, 0]));
  }

  root.OrbitResourceData = Object.freeze({ order, definitions, startingStock, emptyInventory });
})(globalThis);
