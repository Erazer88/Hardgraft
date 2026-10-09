'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/resources.js', 'data/buildings.js', 'simulation/simulation.js', 'simulation/construction.js']) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);
}
const { OrbitResourceData: Resources, OrbitBuildingData: Buildings,
  OrbitSimulation: Simulation, OrbitConstruction: Construction } = context;
const plain = value => JSON.parse(JSON.stringify(value));

test('planet inventories use stable resources and grant the natal stock once', () => {
  const simulation = Simulation.create();
  const stock = Construction.initializePlanet(simulation, 'home:p-1', true);
  assert.deepEqual(Object.keys(plain(stock)), plain(Resources.order));
  assert.deepEqual(plain(stock), plain(Resources.startingStock));
  stock.iron -= 7;
  assert.equal(Construction.initializePlanet(simulation, 'home:p-1', true).iron, Resources.startingStock.iron - 7);
  assert.deepEqual(plain(Construction.initializePlanet(simulation, 'away:p-0')), {
    iron: 0, copper: 0, silicon: 0, carbon: 0, water: 0, iron_plate: 0
  });
});

test('construction consumes declared costs, respects spacing and completes on simulation time', () => {
  const simulation = Simulation.create();
  const stock = Construction.initializePlanet(simulation, 'home:p-1', true);
  const before = plain(stock), definition = Buildings.definitions.extractor;
  const placed = Construction.place(simulation, { planetId: 'home:p-1', type: 'extractor', x: 120, y: 90 });
  assert.equal(placed.ok, true); assert.equal(placed.building.status, 'constructing');
  for (const [id, amount] of Object.entries(definition.cost)) assert.equal(stock[id], before[id] - amount);
  const afterPayment = plain(stock);
  const occupied = Construction.place(simulation, { planetId: 'home:p-1', type: 'depot', x: 124, y: 92 });
  assert.equal(occupied.ok, false); assert.equal(occupied.reason, 'occupied');
  assert.deepEqual(plain(stock), afterPayment);
  Simulation.advance(simulation, definition.duration, false);
  assert.equal(Construction.advance(simulation).length, 0);
  Simulation.advance(simulation, definition.duration - .01);
  assert.equal(Construction.advance(simulation).length, 0);
  Simulation.advance(simulation, .01);
  assert.deepEqual(plain(Construction.advance(simulation).map(building => building.id)), ['building-1']);
  assert.equal(placed.building.status, 'complete');
});

test('failed purchases are atomic and demolition refunds the configured amount', () => {
  const simulation = Simulation.create();
  Construction.initializePlanet(simulation, 'empty:p-0');
  const failed = Construction.place(simulation, { planetId: 'empty:p-0', type: 'outpost', x: 20, y: 20 });
  assert.equal(failed.ok, false); assert.equal(failed.reason, 'insufficient');
  assert.deepEqual(plain(Construction.inventory(simulation, 'empty:p-0')), {
    iron: 0, copper: 0, silicon: 0, carbon: 0, water: 0, iron_plate: 0
  });

  const stock = Construction.initializePlanet(simulation, 'home:p-1', true), before = plain(stock);
  const placed = Construction.place(simulation, { planetId: 'home:p-1', type: 'depot', x: 300, y: 300 });
  assert.equal(placed.building.id, 'building-1');
  const removed = Construction.demolish(simulation, placed.building.id);
  assert.equal(removed.ok, true); assert.deepEqual(plain(stock), before);
  assert.equal(simulation.buildings[placed.building.id], undefined);
  const replacement = Construction.place(simulation, { planetId: 'home:p-1', type: 'depot', x: 300, y: 300 });
  assert.equal(replacement.building.id, 'building-2');
});
