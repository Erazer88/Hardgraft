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
let nextPlanet = 1;

function colony() {
  const simulation = Simulation.create();
  const planetId = `home:p-${nextPlanet++}`;
  Construction.initializePlanet(simulation, planetId, true);
  simulation.buildings['building-1'] = { id: 'building-1', type: 'factory', planetId, status: 'complete', x: 180, y: 180, cost: {} };
  const factory = FactorySimulation.create(simulation, 'building-1');
  return { simulation, factory };
}
function feed(factory, amount = 60) {
  const input = factory.blocks[factory.order[0]];
  input.stock.iron = amount; input.ready.iron = amount; input.status = 'ready';
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

test('an empty factory does not create iron or plates from planetary inventory', () => {
  const { simulation, factory } = colony();
  const stock = simulation.resources[factory.planetId], initialIron = stock.iron;
  for (let i = 0; i < 500; i++) {
    Simulation.advance(simulation, .05);
    FactorySimulation.advance(simulation, .05);
  }
  assert.equal(stock.iron, initialIron);
  assert.equal(stock.iron_plate, 0);
  assert.equal(factory.production.iron_plate || 0, 0);
  const input = factory.blocks[factory.order[0]], transform = factory.blocks[factory.order[1]];
  assert.equal(input.status, 'starved');
  assert.equal(transform.status, 'starved');
});

test('infinite-material mode does not bypass the external factory input', () => {
  const { simulation } = colony();
  const stock = simulation.resources[Object.keys(simulation.resources)[0]], initialIron = stock.iron;
  simulation.infiniteMaterials = true;
  for (let i = 0; i < 500; i++) {
    Simulation.advance(simulation, .05);
    FactorySimulation.advance(simulation, .05);
  }
  assert.equal(stock.iron, initialIron);
  assert.equal(stock.iron_plate, 0);
});

test('a linked extractor mines its finite deposit and supplies the receiving factory', () => {
  const { simulation, factory: first } = colony();
  const planetId = first.planetId;
  const terrain = { width: 240, height: 160, elevation: new Uint8Array(240 * 160).fill(140), seaLevel: 102,
    resources: [{ id: 'iron', type: 'fer', x: 18, y: 18, abundance: .8 }] };
  FactorySimulation.setTerrain(simulation, planetId, terrain, 3);
  simulation.buildings[first.buildingId].status = 'constructing';
  const deposit = simulation.deposits[planetId][0], remaining = deposit.remaining;
  const extractor = { id: 'extractor-1', type: 'extractor', planetId, status: 'complete', x: 120, y: 120,
    depositId: deposit.id, resourceId: 'iron', logisticsStock: {} };
  simulation.buildings[extractor.id] = extractor;
  const receiverBuilding = { id: 'factory-2', type: 'factory', planetId, status: 'complete', x: 560, y: 420, cost: {} };
  simulation.buildings[receiverBuilding.id] = receiverBuilding;
  const receiver = FactorySimulation.create(simulation, receiverBuilding.id);
  const linked = FactorySimulation.connectBuildings(simulation, extractor.id, receiverBuilding.id);
  assert.equal(linked.ok, true);
  assert.ok(linked.route.length > 0);
  for (let i = 0; i < 24000; i++) {
    Simulation.advance(simulation, .05);
    FactorySimulation.advance(simulation, .05);
  }
  assert.ok(deposit.remaining < remaining);
  assert.ok(receiver.production.iron_plate > 0);
  assert.equal(simulation.resources[planetId].iron_plate, receiver.production.iron_plate);
  assert.ok(extractor.extractorTruck.tripsCompleted > 0);
});

test('factory output can be dragged to another factory input and delivered by truck', () => {
  const { simulation, factory: source } = colony();
  const destinationBuilding = { id: 'factory-2', type: 'factory', planetId: source.planetId,
    status: 'complete', x: 560, y: 420, cost: {} };
  simulation.buildings[destinationBuilding.id] = destinationBuilding;
  const destination = FactorySimulation.create(simulation, destinationBuilding.id);
  const output = source.blocks[source.order[3]];
  output.stock.iron_plate = 8; output.ready.iron_plate = 8;
  const link = FactorySimulation.connectBuildings(simulation, source.buildingId, destinationBuilding.id);
  assert.equal(link.ok, true);
  assert.ok(link.route.length > 0);
  for (let i = 0; i < 1600; i++) {
    Simulation.advance(simulation, .05);
    FactorySimulation.advance(simulation, .05);
  }
  const processing = destination.blocks[destination.order[1]];
  assert.equal(processing.stock.iron_plate, 8);
  assert.equal(output.stock.iron_plate, 0);
});

test('a full storage block holds the upstream product instead of losing it', () => {
  const { simulation, factory } = colony();
  feed(factory);
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
  feed(factory);
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
  feed(factory);
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
  const branch = FactorySimulation.routeBetween(simulation, factory.planetId,
    { x: 120, y: 210 }, { x: 420, y: 210 }, factory.buildingId, 'branch-node');
  assert.ok(branch.points.length > 3);
  assert.ok(branch.distance > 300);
});
