'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/resources.js', 'data/buildings.js', 'data/recipes.js', 'data/blocks.js',
  'simulation/simulation.js', 'simulation/construction.js', 'simulation/factory.js']) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);
}
const { OrbitSimulation: Simulation, OrbitConstruction: Construction,
  OrbitFactorySimulation: FactorySimulation } = context;
const plain = value => JSON.parse(JSON.stringify(value));

function colony() {
  const simulation = Simulation.create();
  Construction.initializePlanet(simulation, 'home:p-1', true);
  simulation.buildings['building-1'] = { id: 'building-1', type: 'factory', planetId: 'home:p-1', status: 'complete', cost: {} };
  const factory = FactorySimulation.create(simulation, 'building-1');
  return { simulation, factory };
}

test('factory starts with a data-driven input, transform, storage and output chain', () => {
  const { factory } = colony();
  assert.deepEqual(plain(factory.order.map(id => factory.blocks[id].type)), ['input', 'transform', 'storage', 'output']);
  assert.equal(factory.connections.length, 3);
  assert.equal(factory.rank, 1);
  assert.ok(factory.width * factory.height > 0);
  assert.ok(factory.energyDemand > 0);
});

test('the starter line consumes iron and produces plates in the planetary inventory', () => {
  const { simulation, factory } = colony();
  const stock = simulation.resources['home:p-1'], initialIron = stock.iron;
  for (let i = 0; i < 500; i++) {
    Simulation.advance(simulation, .05);
    FactorySimulation.advance(simulation, .05);
  }
  assert.ok(stock.iron < initialIron);
  assert.ok(stock.iron_plate > 0);
  assert.equal(factory.production.iron_plate, stock.iron_plate);
  const input = factory.blocks[factory.order[0]], transform = factory.blocks[factory.order[1]];
  assert.ok(input.status === 'running' || input.status === 'waiting');
  assert.ok(['running', 'waiting', 'starved', 'blocked'].includes(transform.status));
});

test('a full storage block holds the upstream product instead of losing it', () => {
  const { simulation, factory } = colony();
  const storage = factory.blocks[factory.order[2]], transform = factory.blocks[factory.order[1]];
  storage.capacity = 3;
  const edge = factory.connections.find(connection => connection.from === storage.id);
  FactorySimulation.disconnect(simulation, factory.id, edge.id);
  for (let i = 0; i < 2000; i++) {
    Simulation.advance(simulation, .05);
    FactorySimulation.advance(simulation, .05);
  }
  assert.equal(Object.values(storage.stock).reduce((sum, amount) => sum + amount, 0), 3);
  assert.ok(Object.values(transform.ready).reduce((sum, amount) => sum + amount, 0) > 0);
  assert.ok(['blocked', 'waiting'].includes(storage.status));
});

test('block placement, linking, movement, deletion and paused factory time are deterministic', () => {
  const { simulation, factory } = colony();
  const added = FactorySimulation.addBlock(simulation, factory.id, 'splitter', 380, 760);
  assert.equal(added.ok, true);
  const merger = FactorySimulation.addBlock(simulation, factory.id, 'merger', 630, 760);
  assert.equal(merger.ok, true);
  const linked = FactorySimulation.connect(simulation, factory.id, added.block.id, merger.block.id);
  assert.equal(linked.ok, true);
  assert.equal(FactorySimulation.moveBlock(simulation, factory.id, added.block.id, 390, 790).ok, true);
  assert.equal(FactorySimulation.removeBlock(simulation, factory.id, added.block.id).ok, true);
  assert.equal(factory.connections.some(edge => edge.from === added.block.id || edge.to === added.block.id), false);
  const elapsed = factory.elapsed;
  FactorySimulation.advance(simulation, 10, false);
  assert.equal(factory.elapsed, elapsed);
});
