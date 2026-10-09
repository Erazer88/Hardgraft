(function (root) {
  'use strict';

  const order = Object.freeze(['input', 'transform', 'storage', 'output', 'splitter', 'merger']);
  const definitions = Object.freeze({
    input: Object.freeze({ id: 'input', name: 'Entrée', code: 'IN', color: '#86c99a', inputPorts: 0, outputPorts: 1, capacity: 16, cycle: 1.2, energy: 0 }),
    output: Object.freeze({ id: 'output', name: 'Sortie', code: 'OUT', color: '#87b8d8', inputPorts: 1, outputPorts: 0, capacity: 40, cycle: 0, energy: 0 }),
    transform: Object.freeze({ id: 'transform', name: 'Transformation', code: 'TR', color: '#e3ae70', inputPorts: 1, outputPorts: 1, capacity: 48, cycle: 0, energy: .4, recipeId: 'iron_plate' }),
    storage: Object.freeze({ id: 'storage', name: 'Stockage', code: 'ST', color: '#b2a7dc', inputPorts: 1, outputPorts: 1, capacity: 120, cycle: 0, energy: 0 }),
    splitter: Object.freeze({ id: 'splitter', name: 'Division', code: 'DIV', color: '#d699b4', inputPorts: 1, outputPorts: 2, capacity: 40, cycle: 0, energy: 0 }),
    merger: Object.freeze({ id: 'merger', name: 'Fusion', code: 'FUS', color: '#70c5c2', inputPorts: 2, outputPorts: 1, capacity: 40, cycle: 0, energy: 0 })
  });

  root.OrbitBlockData = Object.freeze({ order, definitions, node: Object.freeze({ width: 205, height: 142 }) });
})(globalThis);
