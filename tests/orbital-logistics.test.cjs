'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/resources.js', 'data/orbitalLogistics.js', 'data/worldgen.js', 'data/buildings.js',
  'world.js', 'world/system.js', 'simulation/buildings.js', 'simulation/roadNetwork.js',
  'simulation/logisticsNetwork.js', 'simulation/orbitalTransit.js', 'gameplay/logistics.js']) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);
}
const Data = context.OrbitOrbitalLogisticsData;
const Building = context.OrbitSurfaceBuilding;
const Road = context.OrbitRoadNetwork;
const Network = context.OrbitLogisticsNetwork;
const Transit = context.OrbitOrbitalTransit;
const Logistics = context.OrbitLogistics;
const World = context.OrbitWorld;
const plain = value => JSON.parse(JSON.stringify(value));

const planetId = 'home:p-0';
const system = {
  id: 'home', star: { mass: 1 },
  planets: [{ id: planetId, orbit: 100, radius: 5, phase: 0, speed: .03 }],
  ark: { id: 'home:ark', systemId: 'home', orbit: 70, phase: Math.PI, speed: .02 }
};
const systems = { home: system };

function fixture({ builtLength = 100, dockStock = { raw_iron: 8 }, inventory = { raw_iron: 90 } } = {}) {
  const factory = Building.create({ id: 'factory-1', type: 'factory', planetId, x: 10, y: 10,
    constructionState: 'complete', dockStock, inventory });
  const platform = Building.create({ id: 'platform-1', type: 'launch_platform', planetId, x: 80, y: 10,
    constructionState: 'complete' });
  const network = Road.create(planetId);
  const from = Road.addNode(network, { x: 10, y: 10, buildingId: factory.id });
  const to = Road.addNode(network, { x: 80, y: 10, buildingId: platform.id });
  Road.addSegment(network, { from: from.id, to: to.id, points: [{ x: 10, y: 10 }, { x: 110, y: 10 }], builtLength });
  return { factory, platform, state: { surfaceBuildings: [factory, platform], roadNetworks: { [planetId]: network },
    inventory: { iron: 50 }, orbitalLogistics: Transit.createState() } };
}

test('orbital launch values and export resources remain declarative', () => {
  assert.deepEqual(plain(Data.launch), { capacityUPerSecond: 4, batchIntervalSeconds: 5, energyMW: 5 });
  assert.equal(Data.transit.cargoSpeedMultiplier, .7);
  assert.deepEqual(plain(Data.exportResources.map(item => item.id)), ['raw_iron', 'iron_tailings', 'iron_slag']);
});

test('only completed, fully built land routes connect source docks to a launch platform', () => {
  const partial = fixture({ builtLength: 50 });
  assert.equal(Network.hasBuiltLandPath(partial.state.roadNetworks[planetId], 'factory-1', 'platform-1'), false);
  Network.transferDockStockToPlatforms(partial.state);
  assert.equal(partial.factory.dockStock.raw_iron, 8);
  assert.deepEqual(plain(partial.platform.launchStock), {});

  const complete = fixture();
  assert.equal(Network.hasBuiltLandPath(complete.state.roadNetworks[planetId], 'factory-1', 'platform-1'), true);
});

test('ground transfer drains only dock-exposed integer stock and leaves other inventories untouched', () => {
  const { factory, platform, state } = fixture();
  const result = Network.transferDockStockToPlatforms(state);
  assert.equal(result.transferred.get('platform-1:raw_iron'), 8);
  assert.deepEqual(plain(factory.dockStock), {});
  assert.deepEqual(plain(platform.launchStock), { raw_iron: 8 });
  assert.deepEqual(plain(factory.inventory), { raw_iron: 90 });
  assert.deepEqual(plain(state.inventory), { iron: 50 });
});

test('platform exports default OFF and launch whole-unit packets average four units per second', () => {
  const { platform, state } = fixture();
  Logistics.advance(state, 0, systems);
  assert.equal(platform.exportEnabled.raw_iron, false);
  assert.equal(Logistics.setExportEnabled(platform, 'raw_iron', true), true);
  platform.launchStock.raw_iron = 40;
  Logistics.advance(state, 4, systems);
  assert.equal(platform.launchStock.raw_iron, 40, 'no packet departs before its five-second accumulation interval');
  assert.equal(state.orbitalLogistics.transit.length, 0);
  Logistics.advance(state, 5, systems);
  assert.equal(platform.launchStock.raw_iron, 20);
  assert.equal(state.orbitalLogistics.transit.length, 1, 'one visual cargo represents the full packet');
  assert.equal(state.orbitalLogistics.transit[0].amount, 20);
  assert.ok(state.orbitalLogistics.transit.every(lot => Number.isInteger(lot.amount)));
  assert.equal(state.orbitalLogistics.transit[0].departureTime, 5);
  assert.equal(state.orbitalLogistics.transit[0].arrivalTime, 5 + Transit.travelTime(system, system.planets[0], 5));
  Logistics.advance(state, 5, systems);
  assert.equal(state.orbitalLogistics.transit.reduce((sum, lot) => sum + lot.amount, 0), 20,
    'repeated frames at the same simulation time do not dispatch twice');
  Logistics.advance(state, 10, systems);
  assert.equal(platform.launchStock.raw_iron, 0);
  assert.equal(state.orbitalLogistics.transit.reduce((sum, lot) => sum + lot.amount, 0), 40);
  assert.equal(Transit.currentPlatformMetrics(state, platform.id, 10).throughput, 4,
    'two 20-unit packets over ten seconds represent four units per second');
  assert.deepEqual(plain(Transit.currentHubMetrics(state, 'home', 10).rates), { raw_iron: 4 });
});

test('disabled export keeps resources at the platform; missing routes never export them', () => {
  const disabled = fixture();
  Logistics.advance(disabled.state, 2, systems);
  assert.equal(disabled.platform.launchStock.raw_iron, 8);
  assert.equal(Logistics.platformStatus(disabled.state, disabled.platform, system, 2), 'EXPORT DÉSACTIVÉ');
  assert.equal(disabled.state.orbitalLogistics.transit.length, 0);

  const disconnected = fixture({ builtLength: 0 });
  disconnected.platform.exportEnabled.raw_iron = true;
  Logistics.advance(disconnected.state, 2, systems);
  assert.equal(disconnected.factory.dockStock.raw_iron, 8);
  assert.deepEqual(plain(disconnected.platform.launchStock), {});
  assert.equal(disconnected.state.orbitalLogistics.transit.length, 0);
});

test('each whole-unit transit lot arrives at its exact simulation time and is saved without render state', () => {
  const { platform, state } = fixture({ dockStock: {} });
  platform.launchStock.raw_iron = 4;
  platform.exportEnabled.raw_iron = true;
  Logistics.advance(state, 5, systems);
  const lot = state.orbitalLogistics.transit[0], arrival = lot.arrivalTime;
  assert.equal(Number.isInteger(lot.amount), true);
  assert.equal(state.orbitalLogistics.hubs.home.stock.raw_iron, undefined);

  const saved = Transit.snapshot(state.orbitalLogistics);
  const resumed = { surfaceBuildings: [platform], orbitalLogistics: Transit.normalize(plain(saved)) };
  Transit.advance(resumed, arrival - .001, systems, false);
  assert.equal(resumed.orbitalLogistics.transit[0].amount, 4);
  assert.equal(resumed.orbitalLogistics.hubs.home.stock.raw_iron, undefined);
  Transit.advance(resumed, arrival, systems, false);
  assert.deepEqual(plain(resumed.orbitalLogistics.hubs.home.stock), { raw_iron: 4 });
  assert.equal(resumed.orbitalLogistics.transit.length, 0);
  assert.deepEqual(Object.keys(saved), ['version', 'corridors', 'transit', 'hubs', 'nextDispatchTime']);
  assert.ok(saved.transit.every(item => Number.isInteger(item.amount)));
});

test('several materials share one corridor in integer packets', () => {
  const { platform, state } = fixture({ dockStock: {} });
  platform.launchStock = { raw_iron: 8, iron_tailings: 8 };
  platform.exportEnabled.raw_iron = true;
  platform.exportEnabled.iron_tailings = true;
  Transit.advance(state, 5, systems);
  const lots = state.orbitalLogistics.transit;
  assert.equal(new Set(lots.map(lot => lot.corridorId)).size, 1);
  assert.deepEqual(plain(Object.fromEntries(lots.map(lot => [lot.resourceId, lot.amount]))),
    { raw_iron: 8, iron_tailings: 8 });
  assert.ok(lots.every(lot => Number.isInteger(lot.amount) && lot.amount > 0));
});

test('cargo positions use fixed departure and predicted arrival endpoints', () => {
  const { platform, state } = fixture({ dockStock: {} });
  platform.launchStock.raw_iron = 1; platform.exportEnabled.raw_iron = true;
  Transit.advance(state, 5, systems);
  const lot = state.orbitalLogistics.transit[0];
  const curve = Transit.trajectoryFor(lot, system);
  assert.deepEqual(plain(curve), plain(Transit.trajectoryFor(lot, system)));
  assert.deepEqual(plain(Transit.cargoPosition(lot, system, lot.departureTime)),
    plain(curve.p0));
  assert.deepEqual(plain(Transit.cargoPosition(lot, system, lot.arrivalTime)),
    plain(Transit.arkPosition(system.ark, system.star, lot.arrivalTime)));
  const planetCenter = World.planetPosition(system.planets[0], lot.departureTime);
  assert.ok(Math.abs(Math.hypot(curve.p0.x - planetCenter.x, curve.p0.y - planetCenter.y) - system.planets[0].radius) < 1e-8,
    'the visual departure begins at the planet surface rather than its center');
  const sourceAngle = system.planets[0].phase + system.planets[0].speed * lot.departureTime;
  const sourceTangent = { x: -Math.sin(sourceAngle), y: Math.cos(sourceAngle) };
  assert.ok((curve.p1.x - curve.p0.x) * sourceTangent.x + (curve.p1.y - curve.p0.y) * sourceTangent.y > 0,
    'the departure curve follows the planet’s prograde orbital direction');
  const arrivalAngle = system.ark.phase + system.ark.speed * lot.arrivalTime;
  const arrivalTangent = { x: -Math.sin(arrivalAngle), y: Math.cos(arrivalAngle) };
  assert.ok((curve.p3.x - curve.p2.x) * arrivalTangent.x + (curve.p3.y - curve.p2.y) * arrivalTangent.y > 0,
    'the arrival curve approaches along the Ark’s prograde orbital direction');
});

test('the primary Ark is deterministic and remains independent from the system wreck', () => {
  const galaxy = World.createGalaxy('orbital-logistics-test');
  const first = World.createSystem('orbital-logistics-test', galaxy.homeId, galaxy);
  const second = World.createSystem('orbital-logistics-test', galaxy.homeId, galaxy);
  assert.equal(first.ark.id, `${galaxy.homeId}:ark`);
  assert.ok(first.wreck, 'the original primary-system wreck remains generated');
  assert.notEqual(first.ark.id, first.wreck.id);
  assert.deepEqual(plain(first.ark), plain(second.ark));
  assert.deepEqual(plain(first.wreck), plain(second.wreck));
});
