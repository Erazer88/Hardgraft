'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/resources.js', 'data/buildings.js', 'data/recipes.js', 'data/blocks.js', 'data/logistics.js',
  'simulation/simulation.js', 'simulation/construction.js', 'simulation/factory.js']) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);
}
const { OrbitSimulation: Simulation, OrbitConstruction: Construction,
  OrbitFactorySimulation: FactorySimulation } = context;
const plain = value => JSON.parse(JSON.stringify(value));

function colony() {
  const simulation = Simulation.create();
  Construction.initializePlanet(simulation, 'home:p-1', true);
  simulation.buildings['building-1'] = { id: 'building-1', type: 'factory', planetId: 'home:p-1', status: 'complete', x: 180, y: 180, cost: {} };
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
  assert.equal(factory.trucks.length, 6);
});

test('logistics fleet size, cargo capacity and speed follow the selected data level', () => {
  const { simulation, factory } = colony();
  const upgraded = FactorySimulation.setLogisticsLevel(simulation, factory.id, 2);
  assert.equal(upgraded.ok, true);
  assert.equal(factory.trucks.length, 8);
  assert.equal(upgraded.profile.cargoCapacity, 32);
  assert.ok(upgraded.profile.speed > 42);
  assert.equal(FactorySimulation.setLogisticsLevel(simulation, factory.id, 99).ok, false);
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

test('infinite-material mode feeds the factory without draining planetary iron', () => {
  const { simulation } = colony();
  const stock = simulation.resources['home:p-1'], initialIron = stock.iron;
  simulation.infiniteMaterials = true;
  for (let i = 0; i < 500; i++) {
    Simulation.advance(simulation, .05);
    FactorySimulation.advance(simulation, .05);
  }
  assert.equal(stock.iron, initialIron);
  assert.ok(stock.iron_plate > 0);
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
  const added = FactorySimulation.addBlock(simulation, factory.id, 'splitter', 380, 1050);
  assert.equal(added.ok, true);
  const merger = FactorySimulation.addBlock(simulation, factory.id, 'merger', 630, 1050);
  assert.equal(merger.ok, true);
  const linked = FactorySimulation.connect(simulation, factory.id, added.block.id, merger.block.id);
  assert.equal(linked.ok, true);
  assert.equal(FactorySimulation.moveBlock(simulation, factory.id, added.block.id, 390, 1080).ok, true);
  assert.equal(FactorySimulation.removeBlock(simulation, factory.id, added.block.id).ok, true);
  assert.equal(factory.connections.some(edge => edge.from === added.block.id || edge.to === added.block.id), false);
  const elapsed = factory.elapsed;
  FactorySimulation.advance(simulation, 10, false);
  assert.equal(factory.elapsed, elapsed);
});

test('freight trucks batch products, deliver them and make return trips to a selected depot', () => {
  const { simulation, factory } = colony();
  const depot = { id: 'depot-1', type: 'depot', planetId: factory.planetId, status: 'complete', x: 440, y: 340, logisticsStock: {} };
  simulation.buildings[depot.id] = depot;
  const result = FactorySimulation.setOutputDestination(simulation, factory.id, depot.id);
  assert.equal(result.ok, true);
  assert.ok(result.route.length > 0);
  let sawReturningTruck = false;
  for (let i = 0; i < 4000; i++) {
    Simulation.advance(simulation, .05);
    FactorySimulation.advance(simulation, .05);
    if (factory.trucks.some(truck => truck.status === 'returning')) sawReturningTruck = true;
  }
  assert.ok(depot.logisticsStock.iron_plate > 0);
  assert.equal(simulation.resources[factory.planetId].iron_plate, depot.logisticsStock.iron_plate);
  assert.ok(factory.trucks.some(truck => truck.tripsCompleted > 0));
  assert.ok(factory.trucks.some(truck => truck.lastCargoSize > 1));
  assert.equal(sawReturningTruck, true);
  assert.equal(factory.shipments.length, 0);
});

test('the shipping port receives cargo without returning it to colony inventory', () => {
  const { simulation, factory } = colony();
  const port = { id: 'port-1', type: 'port', planetId: factory.planetId, status: 'complete', x: 470, y: 370, logisticsStock: {} };
  simulation.buildings[port.id] = port;
  assert.equal(FactorySimulation.setOutputDestination(simulation, factory.id, port.id).ok, true);
  for (let i = 0; i < 4000; i++) {
    Simulation.advance(simulation, .05);
    FactorySimulation.advance(simulation, .05);
  }
  assert.ok(port.logisticsStock.iron_plate > 0);
  assert.equal(simulation.resources[factory.planetId].iron_plate, 0);
});

test('demolishing a factory returns cargo currently carried by its trucks', () => {
  const { simulation, factory } = colony();
  const stock = simulation.resources[factory.planetId];
  const truck = factory.trucks[0];
  truck.status = 'outbound'; truck.destinationId = 'depot-1'; truck.cargo = { iron_plate: 7 };
  Construction.demolish(simulation, factory.buildingId);
  assert.equal(stock.iron_plate, 7);
});

test('surface freight routes bend around steep terrain and use the fleet speed data', () => {
  const { simulation, factory } = colony();
  const depot = { id: 'depot-ridge', type: 'depot', planetId: factory.planetId, status: 'complete', x: 440, y: 340, logisticsStock: {} };
  simulation.buildings[depot.id] = depot;
  const width = 160, height = 120, elevation = new Uint8Array(width * height).fill(140);
  for (let y = 50; y < height; y++) for (let x = 96; x <= 110; x++) elevation[y * width + x] = 240;
  FactorySimulation.setTerrain(simulation, factory.planetId, { width, height, elevation, seaLevel: 102 }, 3);
  const result = FactorySimulation.setOutputDestination(simulation, factory.id, depot.id);
  assert.equal(result.ok, true);
  assert.ok(result.route.points.length > 3);
  assert.ok(result.route.distance > Math.hypot(result.route.end.x - result.route.start.x, result.route.end.y - result.route.start.y) * 1.1);
  assert.ok(result.route.length / 42 < result.route.length / 2.5);
});
