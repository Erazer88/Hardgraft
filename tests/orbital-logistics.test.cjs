'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/resources.js', 'data/processes.js', 'simulation/resourceStack.js',
  'simulation/composition.js', 'data/colony.js', 'data/progression.js', 'simulation/colony.js', 'simulation/processGraph.js', 'simulation/processSimulation.js', 'simulation/depotRouting.js', 'gameplay/industry.js',
  'data/orbitalLogistics.js', 'data/worldgen.js', 'data/buildings.js',
  'world.js', 'world/system.js', 'simulation/buildings.js', 'simulation/roadNetwork.js',
  'simulation/logisticsNetwork.js', 'simulation/orbitalTransit.js', 'gameplay/logistics.js',
  'data/config.js', 'simulation/inventory.js', 'simulation/construction.js', 'gameplay/colonyZone.js', 'gameplay/progression.js', 'gameplay/alerts.js', 'data/skills.js', 'gameplay/skills.js', 'data/dataNetwork.js', 'simulation/lineOfSight.js', 'simulation/windPower.js', 'simulation/dataNetwork.js', 'simulation/dataTransit.js']) {
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

function fixture({ builtLength = 100, dockStock = { raw_iron: 8 }, inventory = { raw_iron: 90 },
  dockDestinations = { raw_iron: 'platform-1' } } = {}) {
  const factory = Building.create({ id: 'factory-1', type: 'factory', planetId, x: 10, y: 10,
    constructionState: 'complete', dockStock, inventory, dockDestinations });
  const platform = Building.create({ id: 'platform-1', type: 'launch_platform', planetId, x: 80, y: 10,
    constructionState: 'complete' });
  const network = Road.create(planetId);
  const from = Road.addNode(network, { x: 10, y: 10, buildingId: factory.id });
  const to = Road.addNode(network, { x: 80, y: 10, buildingId: platform.id });
  Road.addSegment(network, { from: from.id, to: to.id, points: [{ x: 10, y: 10 }, { x: 110, y: 10 }], builtLength });
  return { factory, platform, state: { surfaceBuildings: [factory, platform], roadNetworks: { [planetId]: network },
    inventory: { iron: 50 }, orbitalLogistics: Transit.createState() } };
}

function orbitalCase({ planetOrbit, planetRadius = 5, planetPhase = 0, planetSpeed,
  arkOrbit, arkPhase, arkSpeed, departureTime = 0, arrivalTime = 40, starRadius = 8 }) {
  const planet = { id: 'case:p-0', orbit: planetOrbit, radius: planetRadius, phase: planetPhase, speed: planetSpeed };
  const system = { id: 'case', star: { mass: 1, radius: starRadius }, extent: Math.max(planetOrbit, arkOrbit) * 1.8,
    planets: [planet], ark: { id: 'case:ark', orbit: arkOrbit, phase: arkPhase, speed: arkSpeed } };
  const lot = { corridorId: 'platform->case:ark', resourceId: 'raw_iron', amount: 1,
    systemId: system.id, originPlanetId: planet.id, departureTime, arrivalTime, trajectoryVersion: 2 };
  return { system, planet, lot, curve: Transit.trajectoryFor(lot, system) };
}

function assertPrograde(trajectory) {
  const points = Transit.trajectorySamples(trajectory, 128);
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1], current = points[index];
    const angularCross = previous.x * current.y - previous.y * current.x;
    assert.ok(angularCross > 0, `angular motion must stay prograde at sample ${index}`);
  }
}

test('orbital launch values remain declarative and every transportable resource can be routed', () => {
  assert.deepEqual(plain(Data.launch), { batchIntervalSeconds: 60, energyMW: 5 });
  assert.equal(Data.transit.cargoSpeedMultiplier, .35);
  assert.equal(Data.transfer.alignmentLaunchIntervalFactor, 1.5);
  assert.deepEqual([Data.transfer.alignmentMinimumRadians, Data.transfer.alignmentMaximumRadians], [.12, .7]);
  const resources = plain(Data.exportResources.map(item => item.id));
  assert.ok(resources.includes('raw_iron'));
  assert.ok(resources.includes('water'));
  assert.ok(resources.includes('gas'));
});

test('only completed, fully built land routes connect source docks to a launch platform', () => {
  const partial = fixture({ builtLength: 50 });
  assert.equal(Network.hasBuiltLandPath(partial.state.roadNetworks[planetId], 'factory-1', 'platform-1'), false);
  Network.transferDockStockToBuildings(partial.state);
  assert.equal(partial.factory.dockStock.raw_iron, 8);
  assert.deepEqual(plain(partial.platform.launchStock), {});

  const complete = fixture();
  assert.equal(Network.hasBuiltLandPath(complete.state.roadNetworks[planetId], 'factory-1', 'platform-1'), true);
});

test('ground transfer drains only dock-exposed integer stock and leaves other inventories untouched', () => {
  const { factory, platform, state } = fixture();
  const result = Network.transferDockStockToBuildings(state);
  assert.equal(result.transferred.get('platform-1:raw_iron'), 8);
  assert.deepEqual(plain(factory.dockStock), {});
  assert.deepEqual(plain(platform.launchStock), { raw_iron: 8 });
  assert.deepEqual(plain(factory.inventory), { raw_iron: 90 });
  assert.deepEqual(plain(state.inventory), { iron: 50 });
});

test('each ground transfer is reported as a flow and marks its road link active', () => {
  const { state } = fixture();
  Logistics.advance(state, 4, systems);
  assert.equal(state.transportActivity['factory-1>platform-1'], 4, 'the link carried a transfer at time 4');
  Logistics.advance(state, 6, systems);
  assert.equal(state.transportActivity['factory-1>platform-1'], 4, 'nothing left to send: the link keeps its last time');
  const again = fixture();
  assert.deepEqual(plain(Network.transferDockStockToBuildings(again.state).flows),
    [{ sourceId: 'factory-1', destinationId: 'platform-1', resourceId: 'raw_iron', amount: 8 }]);
});

test('the hub launches one freight a minute, carrying its whole stock', () => {
  const { platform, state } = fixture();
  Logistics.advance(state, 0, systems);
  platform.launchStock.raw_iron = 140;
  platform.launchStock.water = 60;
  Logistics.advance(state, 59, systems);
  assert.equal(platform.launchStock.raw_iron, 140, 'nothing leaves before the minute');
  assert.equal(state.orbitalLogistics.transit.length, 0);
  const loading = Transit.currentPlatformMetrics(state, platform.id, 30);
  assert.equal(loading.nextLaunchTime, 60);
  assert.equal(loading.loading, .5, 'half a minute loaded');
  Logistics.advance(state, 60, systems);
  assert.deepEqual(plain(platform.launchStock), { raw_iron: 0, water: 0 });
  assert.equal(state.orbitalLogistics.transit.length, 2, 'one lot per resource, all in the same freight');
  assert.deepEqual(plain(Object.fromEntries(state.orbitalLogistics.transit.map(lot => [lot.resourceId, lot.amount]))),
    { raw_iron: 140, water: 60 });
  assert.ok(state.orbitalLogistics.transit.every(lot => lot.departureTime === 60 &&
    lot.arrivalTime === 60 + Transit.travelTime(system, system.planets[0], 60)));
  Logistics.advance(state, 60, systems);
  assert.equal(state.orbitalLogistics.transit.reduce((sum, lot) => sum + lot.amount, 0), 200,
    'repeated frames at the same simulation time do not dispatch twice');
  const metrics = Transit.currentPlatformMetrics(state, platform.id, 75);
  assert.deepEqual(plain(metrics.last), { time: 60, amount: 200 });
  assert.equal(metrics.nextLaunchTime, 120);
  assert.equal(metrics.loading, .25);
  assert.equal(Transit.currentPlatformMetrics(state, platform.id, 60).throughput * 60, 200,
    'one 200-unit freight in a minute');
});

test('an unassigned dock keeps its stock; a destination without a built route never receives it', () => {
  const unassigned = fixture({ dockDestinations: {} });
  Logistics.advance(unassigned.state, 2, systems);
  assert.equal(unassigned.factory.dockStock.raw_iron, 8);
  assert.equal(Logistics.platformStatus(unassigned.state, unassigned.platform, system, 2), 'AUCUN FLUX ASSIGNÉ');
  assert.equal(unassigned.state.orbitalLogistics.transit.length, 0);

  const disconnected = fixture({ builtLength: 0 });
  Logistics.advance(disconnected.state, 2, systems);
  assert.equal(disconnected.factory.dockStock.raw_iron, 8);
  assert.deepEqual(plain(disconnected.platform.launchStock), {});
  assert.equal(disconnected.state.orbitalLogistics.transit.length, 0);
});

test('a dock can route a resource to another built factory inventory instead of the platform', () => {
  const { factory, platform, state } = fixture({ dockStock: { water: 7 }, dockDestinations: { water: 'factory-2' } });
  const receiver = Building.create({ id: 'factory-2', type: 'factory', planetId, x: 120, y: 10,
    constructionState: 'complete' });
  state.surfaceBuildings.push(receiver);
  state.factoryPlans = { [receiver.id]: { machines: [{ type: 'input_dock' }] } };
  const network = Road.create(planetId);
  state.roadNetworks[planetId] = network;
  const sourceNode = Road.addNode(network, { x: factory.x, y: factory.y, buildingId: factory.id });
  const receiverNode = Road.addNode(network, { x: receiver.x, y: receiver.y, buildingId: receiver.id });
  Road.addSegment(network, { from: sourceNode.id, to: receiverNode.id,
    points: [{ x: factory.x, y: factory.y }, { x: receiver.x, y: receiver.y }], builtLength: 110 });
  const result = Network.transferDockStockToBuildings(state);
  assert.equal(result.transferred.get('factory-2:water'), 7);
  assert.deepEqual(plain(receiver.inventory), { water: 7 });
  assert.deepEqual(plain(factory.dockStock), {});
  assert.deepEqual(plain(platform.launchStock), {});
});

test('a factory receives at most 100 units of each resource; the rest waits at the source dock', () => {
  const { factory, state } = fixture({ dockStock: { raw_iron: 250, water: 30 }, dockDestinations: { raw_iron: 'factory-2', water: 'factory-2' } });
  const receiver = Building.create({ id: 'factory-2', type: 'factory', planetId, x: 120, y: 10,
    constructionState: 'complete', inventory: { water: 90 } });
  state.surfaceBuildings.push(receiver);
  state.factoryPlans = { [receiver.id]: { machines: [{ type: 'input_dock' }] } };
  const network = Road.create(planetId);
  state.roadNetworks[planetId] = network;
  const sourceNode = Road.addNode(network, { x: factory.x, y: factory.y, buildingId: factory.id });
  const receiverNode = Road.addNode(network, { x: receiver.x, y: receiver.y, buildingId: receiver.id });
  Road.addSegment(network, { from: sourceNode.id, to: receiverNode.id,
    points: [{ x: factory.x, y: factory.y }, { x: receiver.x, y: receiver.y }], builtLength: 110 });
  Network.transferDockStockToBuildings(state);
  assert.deepEqual(plain(receiver.inventory), { water: 100, raw_iron: 100 });
  assert.deepEqual(plain(factory.dockStock), { raw_iron: 150, water: 20 });
  receiver.inventory.raw_iron = 40;
  Network.transferDockStockToBuildings(state);
  assert.equal(receiver.inventory.raw_iron, 100);
  assert.equal(factory.dockStock.raw_iron, 90);
});

test('a factory without an input dock keeps routed stock until it adds one', () => {
  const { factory, state } = fixture({ dockStock: { raw_iron: 9 }, dockDestinations: { raw_iron: 'factory-2' } });
  const receiver = Building.create({ id: 'factory-2', type: 'factory', planetId, x: 120, y: 10,
    constructionState: 'complete' });
  state.surfaceBuildings.push(receiver);
  const network = Road.create(planetId);
  state.roadNetworks[planetId] = network;
  const sourceNode = Road.addNode(network, { x: factory.x, y: factory.y, buildingId: factory.id });
  const receiverNode = Road.addNode(network, { x: receiver.x, y: receiver.y, buildingId: receiver.id });
  Road.addSegment(network, { from: sourceNode.id, to: receiverNode.id,
    points: [{ x: factory.x, y: factory.y }, { x: receiver.x, y: receiver.y }], builtLength: 110 });
  assert.equal(Network.hasReceivingDock(state, receiver), false);
  assert.equal(Network.transferDockStockToBuildings(state).transferred.size, 0);
  assert.equal(factory.dockStock.raw_iron, 9);

  state.factoryPlans = { [receiver.id]: { machines: [{ type: 'input_dock' }] } };
  assert.equal(Network.hasReceivingDock(state, receiver), true);
  assert.equal(Network.transferDockStockToBuildings(state).transferred.get('factory-2:raw_iron'), 9);
});

test('a dock destination can be changed per resource and cleared', () => {
  const { factory } = fixture({ dockStock: {} });
  assert.equal(Logistics.setDockDestination(factory, 'gas', 'platform-1'), true);
  assert.equal(factory.dockDestinations.gas, 'platform-1');
  assert.equal(Logistics.setDockDestination(factory, 'gas', null), true);
  assert.equal(Object.hasOwn(factory.dockDestinations, 'gas'), false);
  assert.equal(Logistics.setDockDestination(factory, 'unknown-resource', 'platform-1'), false);
});

test('a stale dispatch clock is repaired without resetting stock or existing transit', () => {
  const { state, platform } = fixture({ dockStock: {} });
  platform.launchStock = { raw_iron: 8 };
  state.orbitalLogistics.nextDispatchTime = 3610;
  state.orbitalLogistics.hubs.home = { id: system.ark.id, stock: { raw_iron: 320 } };
  state.orbitalLogistics.transit.push({ corridorId: 'old-corridor', systemId: 'home',
    originPlanetId: planetId, resourceId: 'iron_slag', amount: 3, departureTime: 0, arrivalTime: 25 });
  Transit.advance(state, 0, systems, false);
  assert.equal(state.orbitalLogistics.nextDispatchTime, 60);
  assert.equal(platform.launchStock.raw_iron, 8);
  assert.equal(state.orbitalLogistics.hubs.home.stock.raw_iron, 320);
  assert.equal(state.orbitalLogistics.transit[0].amount, 3);
  Transit.advance(state, 59.9, systems);
  assert.equal(platform.launchStock.raw_iron, 8);
  Transit.advance(state, 60, systems);
  const shipment = state.orbitalLogistics.transit.find(lot => lot.resourceId === 'raw_iron');
  assert.equal(shipment.amount, 8);
  assert.equal(shipment.departureTime, 60);
  assert.equal(platform.launchStock.raw_iron, 0);
  Transit.advance(state, Math.max(25, shipment.arrivalTime), systems);
  assert.equal(state.orbitalLogistics.hubs.home.stock.raw_iron, 328);
  assert.equal(state.orbitalLogistics.hubs.home.stock.iron_slag, 3);
});

test('road delivery feeds a receiving factory processor through its input dock, composition included', () => {
  const { factory, state } = fixture({ dockStock: { raw_rock: 8 }, dockDestinations: { raw_rock: 'receiver' } });
  factory.dockMix = { raw_rock: { copper: .3, rock: .7 } };
  const receiver = Building.create({ id: 'receiver', type: 'factory', planetId, x: 120, y: 10,
    constructionState: 'complete' });
  state.surfaceBuildings.push(receiver, { id: 'wind', type: 'wind_turbine', planetId, constructionState: 'complete' });
  state.seed = 'received-rock'; state.factoryPlans = {};
  const Graph = context.OrbitProcessGraph, Industry = context.OrbitIndustry;
  const graph = Industry.ensureGraph(state, receiver);
  Graph.addMachine(graph, { id: 'input', type: 'input_dock' });
  Graph.addMachine(graph, { id: 'crusher', type: 'crusher' });
  const network = state.roadNetworks[planetId];
  const sourceNode = network.nodes.find(node => node.buildingId === factory.id);
  const receiverNode = Road.addNode(network, { x: receiver.x, y: receiver.y, buildingId: receiver.id });
  Road.addSegment(network, { from: sourceNode.id, to: receiverNode.id,
    points: [{ x: factory.x, y: factory.y }, { x: receiver.x, y: receiver.y }], builtLength: 110 });
  Network.transferDockStockToBuildings(state);
  assert.equal(receiver.inventory.raw_rock, 8);
  assert.deepEqual(plain(receiver.inventoryMix.raw_rock), { copper: .3, rock: .7 });
  Industry.ensureGraph(state, receiver);
  assert.equal(Graph.connect(graph, { id: 'import', fromMachineId: 'input', fromOutputId: 'material',
    toMachineId: 'crusher', toInputId: 'rock' }).ok, true);
  for (let i = 0; i < 7; i++) Industry.advance(state, 1);
  assert.equal(receiver.inventory.raw_rock || 0, 0);
  assert.equal(graph.machines[1].outputBuffer.rock, 8);
  assert.deepEqual(plain(graph.machines[1].outputMix.rock), { copper: .3, rock: .7 });
  assert.equal(factory.dockStock.raw_rock, undefined);
});

test('each whole-unit transit lot arrives at its exact simulation time and is saved without render state', () => {
  const { platform, state } = fixture({ dockStock: {} });
  platform.launchStock.raw_iron = 4;
  Logistics.advance(state, Data.launch.batchIntervalSeconds, systems);
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
  assert.ok(saved.transit.every(item => item.trajectoryVersion === 3), 'new lots retain their trajectory model on reload');
});

test('several materials share one corridor in integer packets', () => {
  const { platform, state } = fixture({ dockStock: {} });
  platform.launchStock = { raw_iron: 8, iron_tailings: 8, gas: 8 };
  Transit.advance(state, Data.launch.batchIntervalSeconds, systems);
  const lots = state.orbitalLogistics.transit;
  assert.equal(new Set(lots.map(lot => lot.corridorId)).size, 1);
  assert.deepEqual(plain(Object.fromEntries(lots.map(lot => [lot.resourceId, lot.amount]))),
    { gas: 8, iron_tailings: 8, raw_iron: 8 });
  assert.ok(lots.every(lot => Number.isInteger(lot.amount) && lot.amount > 0));
});

test('new cargo follows a fixed prograde polar transfer to the predicted Ark position', () => {
  const { platform, state } = fixture({ dockStock: {} });
  platform.launchStock.raw_iron = 1;
  Transit.advance(state, Data.launch.batchIntervalSeconds, systems);
  const lot = state.orbitalLogistics.transit[0];
  const curve = Transit.trajectoryFor(lot, system);
  assert.deepEqual(plain(curve), plain(Transit.trajectoryFor(lot, system)));
  assert.equal(curve.kind, 'orbital');
  assert.equal(curve.version, 3);
  assert.deepEqual(plain(Transit.cargoPosition(lot, system, lot.departureTime)),
    plain(curve.p0));
  assert.deepEqual(plain(Transit.cargoPosition(lot, system, lot.arrivalTime)),
    plain(Transit.arkPosition(system.ark, system.star, lot.arrivalTime)));
  const planetCenter = World.planetPosition(system.planets[0], lot.departureTime);
  assert.ok(Math.abs(Math.hypot(curve.p0.x - planetCenter.x, curve.p0.y - planetCenter.y) - system.planets[0].radius) < 1e-8,
    'the visual departure begins at the planet surface rather than its center');
  assertPrograde(curve);
  assert.equal(curve.sourceAngle, system.planets[0].phase + system.planets[0].speed * lot.departureTime);
  assert.equal(curve.targetAngle, system.ark.phase + system.ark.speed * lot.arrivalTime);
});

test('live dotted-guide trajectory ends at the Ark current position', () => {
  const time = 37, planet = system.planets[0];
  const curve = Transit.previewTrajectory(system, planet, time);
  assert.ok(curve);
  assert.deepEqual(plain(curve.p3), plain(Transit.arkPosition(system.ark, system.star, time)));
  const planetCenter = World.planetPosition(planet, time);
  assert.ok(Math.abs(Math.hypot(curve.p0.x - planetCenter.x, curve.p0.y - planetCenter.y) - planet.radius) < 1e-8,
    'the live guide begins at the current planet surface');
});

test('route selection stays on one prograde wrap while the Ark passes the source', () => {
  const planet = { id: 'crossing:p-0', orbit: 100, radius: 5, phase: 0, speed: .04 };
  const crossingSystem = { id: 'crossing', star: { mass: 1, radius: 8 }, extent: 800,
    planets: [planet], ark: { id: 'crossing:ark', orbit: 400, phase: 3.5, speed: .005 } };
  const sweeps = [90, 100, 110].map(departureTime => {
    const duration = Transit.travelTime(crossingSystem, planet, departureTime);
    const lot = { corridorId: 'crossing', resourceId: 'raw_iron', amount: 1,
      systemId: crossingSystem.id, originPlanetId: planet.id, departureTime,
      arrivalTime: departureTime + duration, trajectoryVersion: 3 };
    const curve = Transit.trajectoryFor(lot, crossingSystem);
    assert.ok(curve.angularSweep > Math.PI, `t=${departureTime} should keep the prograde wrap through alignment`);
    assertPrograde(curve);
    return curve.angularSweep;
  });
  assert.ok(Math.max(...sweeps) - Math.min(...sweeps) < Math.PI,
    'adjacent dispatches around the crossing do not alternate between a short arc and a full-system route');
});

test('transfer mode accounts for radial difference and natural angular advance at interception', () => {
  const aheadButSlowerAtMeanRadius = orbitalCase({ planetOrbit: 100, planetSpeed: .04,
    arkOrbit: 400, arkPhase: .04, arkSpeed: .005, arrivalTime: 40 });
  assert.ok(aheadButSlowerAtMeanRadius.curve.correction < -.12,
    'a slightly-ahead Ark at a much larger orbit falls behind the neutral intercept angle');
  assert.equal(aheadButSlowerAtMeanRadius.curve.mode, 'outer');
  assert.ok(aheadButSlowerAtMeanRadius.curve.radialExcursion > 0);
  assertPrograde(aheadButSlowerAtMeanRadius.curve);

  const behindButFasterAtMeanRadius = orbitalCase({ planetOrbit: 400, planetSpeed: .005,
    arkOrbit: 100, arkPhase: -.04, arkSpeed: .04, arrivalTime: 40 });
  assert.ok(behindButFasterAtMeanRadius.curve.correction > .12,
    'a slightly-behind Ark at a much smaller orbit advances beyond the neutral intercept angle');
  assert.equal(behindButFasterAtMeanRadius.curve.mode, 'inner');
  assert.ok(behindButFasterAtMeanRadius.curve.radialExcursion < 0);
  assertPrograde(behindButFasterAtMeanRadius.curve);
});

test('inner and outer transfer profiles accelerate and retard angular progress', () => {
  const planetOrbit = 200, arkOrbit = 205, planetSpeed = .02;
  const neutralSpeed = planetSpeed * Math.pow(planetOrbit / ((planetOrbit + arkOrbit) / 2), 1.5);
  const inner = orbitalCase({ planetOrbit, planetSpeed, arkOrbit, arkSpeed: neutralSpeed,
    arkPhase: .4, arrivalTime: 40 });
  const outer = orbitalCase({ planetOrbit, planetSpeed, arkOrbit, arkSpeed: neutralSpeed,
    arkPhase: -.4, arrivalTime: 40 });
  const middle = Math.floor(inner.curve.angularSegments / 2);
  assert.equal(inner.curve.mode, 'inner');
  assert.equal(outer.curve.mode, 'outer');
  assert.ok(inner.curve.angularProfile[middle] > .5,
    'the cargo gains more than half its angle by the inner turning point');
  assert.ok(outer.curve.angularProfile[middle] < .5,
    'the cargo gains less than half its angle by the outer turning point');
});

test('flight duration converges on the length of its final predicted transfer curve', () => {
  const { system, planet } = orbitalCase({ planetOrbit: 150, planetSpeed: .025,
    arkOrbit: 360, arkPhase: 1.1, arkSpeed: .006 });
  const departureTime = 12, duration = Transit.travelTime(system, planet, departureTime);
  const lot = { corridorId: 'duration', resourceId: 'raw_iron', amount: 1, systemId: system.id,
    originPlanetId: planet.id, departureTime, arrivalTime: departureTime + duration, trajectoryVersion: 3 };
  const points = Transit.trajectorySamples(Transit.trajectoryFor(lot, system), 48);
  const length = points.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
  const expected = Math.max(5, Math.min(45, 30 * length / (Math.PI * planet.orbit))) / Data.transit.cargoSpeedMultiplier;
  assert.ok(Math.abs(duration - expected) < .02,
    'arrival time is calculated from the route that reaches the Ark’s future position');
});

test('generated planetary transfers remain deterministic through radial and phase edge cases', () => {
  const galaxy = World.createGalaxy('prograde-transfer-cases');
  const generated = World.createSystem('prograde-transfer-cases', galaxy.homeId, galaxy);
  for (const planet of generated.planets.filter(item => item.kind !== 'gazeuse')) {
    for (const departureTime of [0, 10, 30]) {
      const duration = Transit.travelTime(generated, planet, departureTime);
      const lot = { corridorId: 'generated', resourceId: 'raw_iron', amount: 1,
        systemId: generated.id, originPlanetId: planet.id, departureTime,
        arrivalTime: departureTime + duration, trajectoryVersion: 3 };
      const curve = Transit.trajectoryFor(lot, generated);
      const points = Transit.trajectorySamples(curve, 48);
      const length = points.slice(1).reduce((sum, point, index) =>
        sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
      const median = [...generated.planets].sort((a, b) => a.orbit - b.orbit)[Math.floor(generated.planets.length / 2)].orbit;
      const expected = Math.max(5, Math.min(45, 30 * length / (Math.PI * median))) / Data.transit.cargoSpeedMultiplier;
      assert.ok(Math.abs(duration - expected) < .03,
        `${planet.id} at t=${departureTime} uses its final route length for transit time`);
      assertPrograde(curve);
    }
  }
});

test('near-alignment selects direct transfer and phase wrapping never reverses angular motion', () => {
  const aligned = orbitalCase({ planetOrbit: 200, planetSpeed: .02,
    arkOrbit: 200, arkPhase: .01, arkSpeed: .02, arrivalTime: 30 });
  assert.ok(Math.abs(aligned.curve.correction) < .12);
  assert.equal(aligned.curve.mode, 'direct');
  assert.equal(aligned.curve.radialExcursion, 0);
  assertPrograde(aligned.curve);

  const acrossZero = orbitalCase({ planetOrbit: 200, planetPhase: Math.PI * 2 - .01, planetSpeed: .02,
    arkOrbit: 200, arkPhase: 0, arkSpeed: .02, arrivalTime: 30 });
  assert.equal(acrossZero.curve.mode, 'direct');
  assert.ok(acrossZero.curve.angularSweep > 0 && acrossZero.curve.angularSweep < Math.PI);
  assertPrograde(acrossZero.curve);
});

test('a prograde path behind the source takes the long route and pending cargo upgrades visually without rescheduling', () => {
  const source = { id: 'case:p-0', orbit: 200, radius: 5, phase: 0, speed: .02 };
  const behind = { id: 'case:ark', orbit: 200, phase: -.05, speed: 0 };
  const systemCase = { id: 'case', star: { mass: 1, radius: 8 }, extent: 500, planets: [source], ark: behind };
  const longRouteTime = Transit.travelTime(systemCase, source, 0);
  assert.ok(longRouteTime > 50, 'the prograde almost-full orbit must not use the short retrograde gap');
  assert.equal(longRouteTime, Transit.travelTime(systemCase, source, 0), 'route duration is deterministic');

  const oldLot = { corridorId: 'old', resourceId: 'raw_iron', amount: 1, systemId: 'case',
    originPlanetId: source.id, departureTime: 0, arrivalTime: 20 };
  const oldVersion2Lot = { ...oldLot, corridorId: 'old-v2', trajectoryVersion: 2 };
  const pending = Transit.normalize({ transit: [oldLot, oldVersion2Lot] }).transit;
  assert.ok(pending.every(lot => lot.trajectoryVersion === 3), 'legacy and V2 routes migrate to the current prograde renderer');
  for (const lot of pending) {
    const curve = Transit.trajectoryFor(lot, systemCase);
    assert.equal(curve.version, 3);
    assertPrograde(curve);
    assert.equal(lot.arrivalTime, oldLot.arrivalTime, 'migration leaves the scheduled arrival unchanged');
    assert.equal(lot.amount, oldLot.amount, 'migration leaves the resource amount unchanged');
  }
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

test('a depot receives by road through its input gate and its output gates deliver further', () => {
  const { factory, state } = fixture({ dockStock: { raw_iron: 6 }, dockDestinations: { raw_iron: 'depot-1' } });
  const depot = Building.create({ id: 'depot-1', type: 'storage', planetId, x: 120, y: 10, constructionState: 'complete' });
  const receiver = Building.create({ id: 'factory-2', type: 'factory', planetId, x: 200, y: 10, constructionState: 'complete' });
  state.surfaceBuildings.push(depot, receiver);
  const network = Road.create(planetId);
  state.roadNetworks[planetId] = network;
  const nodes = [factory, depot, receiver].map(building => Road.addNode(network, { x: building.x, y: building.y, buildingId: building.id }));
  for (let index = 1; index < nodes.length; index++) Road.addSegment(network, { from: nodes[index - 1].id, to: nodes[index].id,
    points: [{ x: nodes[index - 1].x, y: 10 }, { x: nodes[index].x, y: 10 }], builtLength: 200 });
  assert.equal(Network.hasReceivingDock(state, depot), false, 'a depot without an input gate receives nothing');
  state.factoryPlans = { [depot.id]: { machines: [{ type: 'depot_input' }] }, [receiver.id]: { machines: [{ type: 'input_dock' }] } };
  assert.equal(Network.hasReceivingDock(state, depot), true);
  Network.transferDockStockToBuildings(state);
  assert.equal(depot.inventory.raw_iron, 6);
  depot.gateStock = { 'factory-2': { raw_iron: 4 } };
  const result = Network.transferDockStockToBuildings(state);
  assert.equal(receiver.inventory.raw_iron, 4);
  assert.deepEqual(plain(depot.gateStock['factory-2']), {});
  assert.ok(result.flows.some(flow => flow.sourceId === 'depot-1' && flow.destinationId === 'factory-2'));
  const saved = Building.create(plain({ ...depot, gateStock: { 'factory-2': { water: 3, bad: 1.5 } } }));
  assert.deepEqual(plain(saved.gateStock), { 'factory-2': { water: 3 } });
});

// ---- Early game balance ----
const Inventory = context.OrbitInventory, Construction = context.OrbitConstruction;
const Processes = context.OrbitProcessData, Graph = context.OrbitProcessGraph, Industry = context.OrbitIndustry;
const Resources = context.OrbitResourceData, BuildingData = context.OrbitBuildingData;

test('construction crews build two sites at a time; the others wait their turn', () => {
  const sites = ['a', 'b', 'c'].map(id => Building.create({ id, type: 'storage', planetId, x: 0, y: 0 }));
  const inventory = { iron: 100, copper: 100 };
  for (const site of sites) assert.equal(Construction.start(site, inventory).started, true);
  Construction.advance(sites, 1);
  assert.deepEqual(sites.map(site => site.status), ['building', 'building', 'queued']);
  assert.equal(sites[2].constructionProgress, 0);
  Construction.advance(sites, 1);
  assert.deepEqual(sites.map(site => site.constructionState), ['complete', 'complete', 'constructing']);
  Construction.advance(sites, 2);
  assert.equal(sites[2].constructionState, 'complete');
});

test('cards are paid from the colony stock, refunded on removal and with their building', () => {
  const inventory = { iron: 30, copper: 10 };
  const extractor = Building.create({ id: 'ext', type: 'extractor', planetId, x: 0, y: 0 });
  assert.equal(Construction.start(extractor, inventory).started, true);
  const furnace = Processes.get('reduction_furnace', 'iron');
  assert.deepEqual(plain(furnace.cost), { iron: 8, copper: 4 });
  assert.equal(Construction.payCard(extractor, inventory, furnace.cost).paid, false, 'not enough copper left');
  inventory.copper += 10;
  assert.equal(Construction.payCard(extractor, inventory, furnace.cost).paid, true);
  assert.deepEqual(plain(inventory), { iron: 4, copper: 8 });
  assert.deepEqual(plain(Construction.refundCard(extractor, inventory, furnace.cost)), { iron: 8, copper: 4 });
  assert.deepEqual(plain(Construction.refundCard(extractor, inventory, furnace.cost)), {}, 'never refunded twice');
  Construction.payCard(extractor, inventory, furnace.cost);
  assert.deepEqual(plain(Construction.demolish(extractor, inventory)), { iron: 26, copper: 12 });
  const saved = Building.create(plain({ ...extractor, cardCostPaid: { iron: 4, bad: -1 } }));
  assert.deepEqual(plain(saved.cardCostPaid), { iron: 4 });
});

test('building and card prices are masked for now, their reference values kept in the data', () => {
  assert.equal(Construction.pricesEnabled(), false);
  assert.deepEqual(plain(Construction.costFor('launch_platform')), {});
  assert.deepEqual(plain(Construction.cardCost(Processes.get('reduction_furnace', 'iron'))), {});
  assert.deepEqual(plain(BuildingData.get('launch_platform').cost), { iron: 350, copper: 250, silicon: 150, carbon: 80 });
  assert.deepEqual(plain(Processes.get('reduction_furnace', 'iron').cost), { iron: 8, copper: 4 });
  const site = Building.create({ id: 'free', type: 'factory', planetId, x: 0, y: 0 });
  const inventory = { iron: 1 };
  assert.equal(Construction.start(site, inventory, Construction.costFor('factory')).started, true);
  assert.deepEqual(plain(inventory), { iron: 1 }, 'nothing is charged');
});

// ---- Colony and progression ----
const Colony = context.OrbitColony, ColonyData = context.OrbitColonyData, Progression = context.OrbitProgression;
const ColonyZone = context.OrbitColonyZone;

test('the colony consumes what it receives tier by tier and produces context', () => {
  const colony = Building.create({ id: 'colony', type: 'colony', planetId, x: 0, y: 0, constructionState: 'complete' });
  assert.deepEqual(plain(colony.colony), { population: 100, tier: 0, progress: {}, consumed: 0, cells: [], owed: {} });
  const state = { surfaceBuildings: [colony], contextPoints: 0 };
  Colony.advance(state, 60);
  assert.ok(Math.abs(state.contextPoints - 1) < 1e-9, 'one context point per minute');
  colony.inventory = { raw_rock: 300, tar: 10 };
  assert.deepEqual(plain(Colony.advance(state, 1)), []);
  assert.equal(colony.colony.progress.raw_rock, 300);
  assert.equal(colony.inventory.raw_rock, undefined, 'consumed rock disappears');
  assert.equal(colony.inventory.tar, 10, 'what the tier does not ask for waits in reserve');
  colony.inventory.raw_rock = ColonyData.tiers[0].needs.raw_rock - 300 + 50;
  const events = Colony.advance(state, 1);
  assert.equal(events.length, 1);
  assert.equal(colony.colony.population, ColonyData.tiers[0].population);
  assert.equal(colony.colony.tier, 1);
  assert.equal(colony.inventory.raw_rock, 50);
  Colony.advance(state, 1);
  assert.equal(colony.colony.progress.tar, 10, 'the next tier takes the tar already in reserve');
  assert.deepEqual(plain(Colony.flows(1)), { raw_rock: ColonyData.flowPerMinute.raw_rock }, 'rock is now a flow');
  assert.deepEqual(plain(Colony.flows(2)), { raw_rock: ColonyData.flowPerMinute.raw_rock, tar: ColonyData.flowPerMinute.tar });
  colony.inventory = { tar: 5 };
  Colony.advance(state, 120);
  assert.equal(Colony.flowsMet(colony.colony), false, 'two minutes without rock: the flow is behind');
  assert.equal(colony.colony.progress.tar, 10, 'needs wait while a flow is behind');
  colony.inventory = { raw_rock: 3 * ColonyData.flowPerMinute.raw_rock, tar: 5 };
  Colony.advance(state, 1);
  assert.equal(Colony.flowsMet(colony.colony), true);
  assert.equal(colony.colony.progress.tar, 15, 'the tier progresses again once rock flows');
  assert.equal(Colony.totalPopulation(state), 200);
  const saved = Building.create(plain(colony));
  assert.deepEqual(plain(saved.colony), plain(colony.colony));
});

test('the colony zone grows over land around its spot, avoiding water and other buildings', () => {
  const width = 60, height = 50, elevation = new Uint8Array(width * height).fill(140);
  for (let y = 0; y < height; y++) for (let x = 40; x < width; x++) elevation[y * width + x] = 90;
  const terrain = { width, height, elevation, seaLevel: 102 };
  const colony = Building.create({ id: 'colony', type: 'colony', planetId, x: 90, y: 75, constructionState: 'complete' });
  const factory = Building.create({ id: 'factory', type: 'factory', planetId, x: 30, y: 75, constructionState: 'complete' });
  const target = Colony.targetCells(colony.colony, 9);
  assert.equal(target, Math.round(ColonyData.zone.baseKm2 / 9));
  const cells = ColonyZone.grow(terrain, 3, colony, [colony, factory], target);
  assert.equal(cells.length, target);
  const blocked = ColonyZone.blockedCells(terrain, 3, colony, [colony, factory]);
  assert.ok(cells.every(cell => elevation[cell] > 102 && !blocked.has(cell)), 'no water, no building');
  colony.colony.cells = cells;
  const bigger = ColonyZone.grow(terrain, 3, colony, [colony, factory], target + 20);
  assert.ok(cells.every(cell => bigger.includes(cell)), 'the zone only gains cells');
  assert.equal(bigger.length, target + 20);
});

test('buildings and cards appear as the colony needs them', () => {
  const state = { surfaceBuildings: [], unlocks: null, powerStatus: {} };
  Progression.advance(state);
  assert.deepEqual(plain(state.unlocks.buildings), ['colony'], 'the colony comes first');
  assert.equal(Progression.buildingUnlocked(state, 'extractor'), false);
  const colony = Building.create({ id: 'colony', type: 'colony', planetId, x: 0, y: 0 });
  state.surfaceBuildings.push(colony);
  const opened = Progression.advance(state);
  assert.deepEqual(plain(opened), { buildings: ['extractor'], cards: ['drill', 'output_dock'] });
  assert.equal(Progression.cardUnlocked(state, Processes.get('crusher')), false);
  state.powerStatus = { [planetId]: { supplyMW: 12, demandMW: 20 } };
  assert.deepEqual(plain(Progression.advance(state).buildings), ['wind_turbine']);
  colony.colony.tier = 1;
  const tar = Progression.advance(state);
  assert.ok(tar.buildings.includes('factory') && tar.cards.includes('tar_furnace') && tar.cards.includes('carbon_separator'));
  colony.colony.tier = 2;
  Progression.advance(state);
  assert.equal(Progression.cardUnlocked(state, Processes.get('reduction_furnace', 'iron')), true);
  assert.equal(Progression.cardUnlocked(state, Processes.get('reduction_furnace', 'copper')), false, 'only the iron furnace');
  assert.equal(Progression.buildingUnlocked(state, 'launch_platform'), false, 'the Ark comes later');
  assert.deepEqual(plain(Progression.restoreUnlocks(plain(state.unlocks))), plain(state.unlocks));
});

test('the first tier: rock drilled and sent by road reaches the colony and raises its population', () => {
  const state = { seed: 'early', inventory: {}, surfaceBuildings: [], factoryPlans: {}, roadNetworks: {},
    orbitalLogistics: Transit.createState(), contextPoints: 0 };
  const colony = Building.create({ id: 'colony', type: 'colony', planetId, x: 200, y: 620, constructionState: 'complete' });
  const extractor = Building.create({ id: 'extractor', type: 'extractor', planetId, x: 100, y: 620,
    constructionState: 'complete', composition: { iron: .1, rock: .9 } });
  state.surfaceBuildings.push(colony, extractor);
  const network = Road.create(planetId);
  state.roadNetworks[planetId] = network;
  const from = Road.addNode(network, { x: 100, y: 620, buildingId: extractor.id });
  const to = Road.addNode(network, { x: 200, y: 620, buildingId: colony.id });
  Road.addSegment(network, { from: from.id, to: to.id, points: [{ x: 100, y: 620 }, { x: 200, y: 620 }], builtLength: 100 });
  const graph = Industry.ensureGraph(state, extractor);
  Graph.addMachine(graph, { id: 'drill', type: 'drill', x: 0, y: 0 });
  Graph.addMachine(graph, { id: 'dock', type: 'output_dock', x: 0, y: 0 });
  assert.equal(Graph.connect(graph, { id: 'l', fromMachineId: 'drill', fromOutputId: 'rock', toMachineId: 'dock', toInputId: 'material' }).ok, true);
  extractor.dockDestinations = { raw_rock: colony.id };
  let time = 0;
  while (colony.colony.tier === 0 && time < 600) {
    time += 1;
    Industry.advance(state, 1);
    Logistics.advance(state, time, systems, true);
    Colony.advance(state, 1);
  }
  assert.equal(colony.colony.tier, 1, 'the colony reached its first tier');
  assert.ok(time >= 150 && time <= 240, `1 000 raw rock take about three minutes with one drill at 6/s (${time} s)`);
  assert.ok(state.powerStatus[planetId].supplyMW >= 12, 'the colony generator powers the drill');
  assert.equal(colony.colony.population, 200);
});

test('goods cross the sea between two ports: trucks, ship, trucks', () => {
  const at = (id, type, x) => Building.create({ id, type, planetId, x, y: 10, constructionState: 'complete' });
  const mine = at('mine', 'extractor', 0), portA = at('port-a', 'surface_port', 100);
  const portB = at('port-b', 'surface_port', 300), factory = at('factory-2', 'factory', 400);
  mine.dockStock = { coal: 6 }; mine.dockDestinations = { coal: factory.id };
  const network = Road.create(planetId);
  const node = (building, mode = 'land') => Road.addNode(network, { x: building.x, y: 10, buildingId: building.id, connectionMode: mode });
  const road = (a, b, built, type = 'land') => Road.addSegment(network, { from: a.id, to: b.id, routeType: type,
    points: [{ x: a.x, y: 10 }, { x: b.x, y: 10 }], builtLength: built });
  road(node(mine), node(portA), 100);
  road(node(portA, 'marine'), node(portB, 'marine'), 200, 'marine');
  road(node(portB), node(factory), 100);
  const state = { surfaceBuildings: [mine, portA, portB, factory], roadNetworks: { [planetId]: network },
    factoryPlans: { [factory.id]: { machines: [{ type: 'input_dock' }] } } };
  assert.equal(Network.hasBuiltLandPath(network, mine.id, factory.id), true);
  const pulse = vm.createContext({});
  vm.runInContext(readFileSync(resolve(__dirname, '../src/rendering/vehicleRenderer.js'), 'utf8'), pulse);
  const route = pulse.OrbitVehicleRenderer.routeBetween(network, mine.id, factory.id);
  assert.ok(route && route.length >= 4, 'transfer pulses follow the road, the sea lane and the road again');
  assert.deepEqual(plain(route[0]), { x: 0, y: 10, sea: false });
  assert.deepEqual(plain(route.at(-1)), { x: 400, y: 10, sea: false });
  assert.ok(route.some(point => point.sea) && route.some(point => !point.sea), 'the sea stretch is marked');
  const style = { cruiseMsPerKm: 8, startSpeedFraction: .2, accelerationMs: 800 };
  const travel = pulse.OrbitVehicleRenderer.travelTime;
  assert.ok(Math.abs(travel(style, 1000) - travel(style, 500) - 500 * 8) < 1e-6, 'past the ramp, speed holds at its cap');
  assert.ok(travel(style, 10) > 10 * 8, 'the start is slower than the cruise');
  Network.transferDockStockToBuildings(state);
  assert.equal(factory.inventory.coal, 6);
});

test('demolishing a building removes its own roads, up to the first junction', () => {
  const network = Road.create(planetId);
  const a = Road.addNode(network, { x: 0, y: 0, buildingId: 'a' });
  const p = Road.addNode(network, { x: 50, y: 0, type: 'intersection' });
  const j = Road.addNode(network, { x: 100, y: 0, type: 'intersection' });
  const b = Road.addNode(network, { x: 200, y: 0, buildingId: 'b' });
  const c = Road.addNode(network, { x: 100, y: 100, buildingId: 'c' });
  const road = (from, to) => Road.addSegment(network, { from: from.id, to: to.id,
    points: [{ x: from.x, y: from.y }, { x: to.x, y: to.y }], builtLength: Math.hypot(to.x - from.x, to.y - from.y) });
  road(a, p); road(p, j); road(j, b); road(j, c);
  assert.equal(Road.removeBuildingRoads(network, 'a'), 2, 'a → p → junction');
  assert.equal(network.segments.length, 2, 'the junction still joins b and c');
  assert.equal(network.nodes.some(node => node.id === p.id || node.id === a.id), false);
  assert.equal(Network.hasBuiltLandPath(network, 'b', 'c'), true);
  assert.equal(Road.removeBuildingRoads(network, 'b'), 1);
  assert.equal(Road.removeBuildingRoads(network, 'c'), 1, 'the last road goes with the last building');
  assert.equal(network.segments.length, 0);
});

test('alerts list a planet short of power, a dock without destination and a late colony flow', () => {
  const Graph = context.OrbitProcessGraph;
  const graph = Graph.create({ version: context.OrbitProcessData.config.version, geology: { resourceId: 'rock' }, machines: [
    { id: 'crusher', type: 'crusher', x: 0, y: 0 }, { id: 'dock', type: 'output_dock', x: 300, y: 0 }], connections: [] });
  Graph.connect(graph, { id: 'link', fromMachineId: 'crusher', fromOutputId: 'rock', toMachineId: 'dock', toInputId: 'material' });
  graph.machines.find(machine => machine.id === 'dock').state = 'no_destination';
  const state = {
    powerStatus: { [planetId]: { demandMW: 30, supplyMW: 12 }, other: { demandMW: 5, supplyMW: 12 } },
    factoryPlans: { 'extractor-1': graph },
    surfaceBuildings: [
      { id: 'extractor-1', type: 'extractor', planetId, constructionState: 'complete' },
      { id: 'colony-1', type: 'colony', planetId, constructionState: 'complete', colony: { tier: 1, owed: { raw_rock: 600 } } }
    ]
  };
  const alerts = plain(context.OrbitAlerts.list(state));
  assert.deepEqual(alerts.map(alert => alert.id), [`power:${planetId}`, 'dock:extractor-1', 'flow:colony-1']);
  assert.deepEqual(alerts[1].resourceIds, ['crushed_rock']);
  assert.deepEqual(alerts[2].resourceIds, ['raw_rock']);
  state.powerStatus[planetId].supplyMW = 44;
  assert.equal(context.OrbitAlerts.list(state).some(alert => alert.kind === 'power'), false);
});

test('the hub site takes its deliveries by road, then is assembled and lets the colony reach tier 4', () => {
  const needs = plain(BuildingData.get('launch_platform').constructionNeeds);
  const { factory, platform, state } = fixture({ dockStock: { ...needs, metal_plate: needs.metal_plate + 5 }, inventory: {},
    dockDestinations: Object.fromEntries(Object.keys(needs).map(id => [id, 'platform-1'])) });
  platform.constructionState = 'planned';
  assert.equal(Construction.start(platform, {}, Construction.costFor('launch_platform')).started, true);
  assert.equal(platform.constructionState, 'supplying');
  const colony = Building.create({ id: 'colony-1', type: 'colony', planetId, x: 0, y: 0, constructionState: 'complete',
    colony: { tier: 3, population: 800 } });
  state.surfaceBuildings.push(colony);
  assert.equal(Colony.advance(state, 1).length, 0, 'no hub yet: the tier waits');
  Network.transferDockStockToBuildings(state);
  assert.deepEqual(plain(factory.dockStock), { metal_plate: 5 }, 'the site takes only what it still needs');
  Construction.advance(state.surfaceBuildings, .1);
  assert.equal(platform.constructionState, 'constructing');
  assert.equal(Construction.supplyFraction(platform), 1);
  Construction.advance(state.surfaceBuildings, 3);
  assert.equal(platform.constructionState, 'complete');
  const events = Colony.advance(state, 1);
  assert.equal(events[0]?.tier, 4);
  assert.equal(colony.colony.population, 1600);
});

test('tier 3 opens copper, silicon, water and the hub', () => {
  const state = { surfaceBuildings: [{ type: 'colony', colony: { tier: 3 } }], unlocks: null };
  Progression.advance(state);
  for (const type of ['water_station', 'launch_platform']) assert.ok(Progression.buildingUnlocked(state, type), type);
  for (const card of ['gravity_separator', 'silicon_washer', 'silicon_dryer', 'water_pump', 'desalinator'])
    assert.ok(state.unlocks.cards.includes(card), card);
  assert.ok(Progression.cardUnlocked(state, { id: 'reduction_furnace', contextResourceId: 'copper' }));
  assert.ok(Progression.cardUnlocked(state, { id: 'reduction_furnace', contextResourceId: 'silicon' }));
});

test('the skill tree opens when goods first reach the Ark; its first skill is acquired at once', () => {
  const Skills = context.OrbitSkills;
  const state = { skills: Skills.restore(null), orbitalLogistics: Transit.createState() };
  assert.equal(Skills.available(state), false);
  assert.equal(Skills.canUnlock(state, 'archive_awakening'), false, 'nothing before the Ark');
  assert.equal(Skills.advance(state), false);
  state.orbitalLogistics.hubs.home = { id: 'home:ark', stock: { raw_iron: 4 } };
  assert.equal(Skills.advance(state), true, 'revealed at the first arrival');
  assert.equal(Skills.advance(state), false, 'only once');
  assert.equal(Skills.unlock(state, 'archive_awakening'), true);
  assert.equal(Skills.unlock(state, 'archive_awakening'), false, 'acquired once');
  assert.deepEqual(plain(Skills.restore({ revealed: true, unlocked: ['archive_awakening', 'unknown', 'archive_awakening'] })),
    { revealed: true, unlocked: ['archive_awakening'] });
});

test('relay antennas pass data down a chain to the datacenter; the end of the chain is the bottleneck', () => {
  const DataNetwork = context.OrbitDataNetwork, Spec = context.OrbitDataNetworkData;
  const at = (id, type, x, extras = {}) => ({ id, type, planetId, x, y: 0, constructionState: 'complete', status: 'active', ...extras });
  const dc = at('dc', 'datacenter', 900, { inventory: {} });
  const state = { surfaceBuildings: [
    at('x1', 'extractor', 10), at('x2', 'extractor', 20), at('f1', 'factory', 40), at('far', 'extractor', 5000),
    at('idle', 'factory', 60, { status: 'waiting' }), at('dish', 'antenna', 0), dc,
    at('x3', 'extractor', 620), at('f2', 'factory', 640)], roadNetworks: {} };
  let links = DataNetwork.advance(state, 10);
  assert.equal(links.dish.hops, null, 'the datacenter is out of reach: no chain yet');
  state.surfaceBuildings.push(at('mid', 'antenna', 300), at('last', 'antenna', 600));
  links = DataNetwork.advance(state, 10);
  assert.deepEqual([links.dish.nextId, links.mid.nextId, links.last.nextId], ['mid', 'last', 'dc']);
  assert.deepEqual([links.dish.hops, links.mid.hops, links.last.hops], [2, 1, 0]);
  assert.deepEqual(plain(links.dish.sources), ['x1', 'x2', 'f1'], 'working buildings in range only');
  assert.equal(links.dish.carried, 3);
  assert.equal(links.last.relayed, 3, 'the last relay carries what the chain brings');
  assert.equal(links.last.carried, Spec.antenna.bandwidthMbPerSecond, 'and is the bottleneck (3 + 2 offered)');
  assert.equal((dc.inventory.geo_data || 0) + (dc.inventory.industrial_data || 0), 40);
});

// Two buildings joined by a built road on a planet.
function joinByRoad(state, planet, a, b) {
  const network = state.roadNetworks[planet] ||= Road.create(planet);
  const from = Road.addNode(network, { x: a.x, y: a.y, buildingId: a.id }), to = Road.addNode(network, { x: b.x, y: b.y, buildingId: b.id });
  Road.addSegment(network, { from: from.id, to: to.id, points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }],
    builtLength: Math.hypot(b.x - a.x, b.y - a.y) });
}

// A strip of flat land 350 m above the sea, with a ridge across it at
// column 30 (cells of textureScale km).
function ridgeTerrain(ridgeLevel) {
  const width = 60, height = 5, seaLevel = 100, elevation = new Uint8Array(width * height).fill(110);
  for (let y = 0; y < height; y++) elevation[y * width + 30] = ridgeLevel;
  return { width, height, seaLevel, elevation };
}
const cellX = cell => (cell + .5) * context.OrbitConfig.terrain.textureScale;

test('a relay mast sees over the relief: small bumps let the signal through, a hill blocks it', () => {
  const Sight = context.OrbitLineOfSight, Spec = context.OrbitDataNetworkData;
  const mast = { x: cellX(10), y: cellX(2) }, target = { x: cellX(50), y: cellX(2) };
  const [mastM, buildingM] = [Spec.antenna.mastHeightM, Spec.antenna.buildingHeightM];
  assert.deepEqual([mastM, buildingM, Spec.relief.obstructionToleranceM], [120, 20, 70]);
  // Tops: 350 + 120 m at the mast, 350 + 20 m at the building; mid-way the
  // line passes at 420 m, and the ground blocks above 490 m.
  assert.equal(Sight.clear(ridgeTerrain(110), mast, mastM, target, buildingM), true, 'flat ground');
  assert.equal(Sight.clear(ridgeTerrain(113), mast, mastM, target, buildingM), true, 'a 105 m bump does not block');
  assert.equal(Sight.clear(ridgeTerrain(114), mast, mastM, target, buildingM), true, 'nor ground right at the limit');
  assert.equal(Sight.clear(ridgeTerrain(115), mast, mastM, target, buildingM), false, 'a 175 m hill hides the building');
  assert.equal(Sight.clear(ridgeTerrain(115), mast, mastM, { x: cellX(20), y: cellX(2) }, buildingM), true, 'on this side of the hill');
  // The relief view agrees: in sight before the hill, hidden behind it, nothing out of range.
  const view = Sight.viewshed(ridgeTerrain(115), mast, mastM, 300, buildingM);
  const at = cell => view.cells[(2 - view.originCellY) * view.size + (cell - view.originCellX)];
  assert.deepEqual([at(20), at(29), at(45), at(55)], [2, 2, 1, 1]);
  assert.equal(at(50), Sight.clear(ridgeTerrain(115), mast, mastM, target, buildingM) ? 2 : 1, 'same answer as the line test');
  assert.equal(view.cells[0], 0, 'corners of the square are out of range');
});

test('relay antennas only gather and pass on what their mast sees', () => {
  const DataNetwork = context.OrbitDataNetwork;
  const at = (id, type, cell, extras = {}) => ({ id, type, planetId, x: cellX(cell), y: cellX(2), constructionState: 'complete', status: 'active', ...extras });
  const state = { surfaceBuildings: [at('dish', 'antenna', 10), at('near', 'extractor', 20), at('behind', 'extractor', 50),
    at('dc', 'datacenter', 25, { inventory: {} })], roadNetworks: {} };
  let links = DataNetwork.advance(state, 1, () => ridgeTerrain(115));
  assert.deepEqual(plain(links.dish.sources), ['near'], 'the extractor behind the hill is out of sight');
  assert.equal(links.dish.datacenterId, 'dc');
  links = DataNetwork.advance(state, 1, () => ridgeTerrain(110));
  assert.deepEqual(plain(links.dish.sources), ['near', 'behind'], 'flat ground: both in sight');
  // A datacenter behind the ridge cannot be reached either.
  state.surfaceBuildings.find(building => building.id === 'dc').x = cellX(45);
  links = DataNetwork.advance(state, 1, () => ridgeTerrain(115));
  assert.equal(links.dish.datacenterId, null);
  assert.equal(links.dish.hops, null);
  // Unknown terrain (a planet not generated yet) is open ground.
  links = DataNetwork.advance(state, 1);
  assert.deepEqual(plain(links.dish.sources), ['near', 'behind']);
});

test('analyses go by road to a high-frequency antenna, then to the Ark, where they become technology points; the star can cut the link', () => {
  const DataNetwork = context.OrbitDataNetwork, DataTransit = context.OrbitDataTransit;
  const planet = { id: planetId, orbit: 100, radius: 5, phase: 0, speed: .03 };
  const make = arkPhase => ({ id: 'home', star: { mass: 1, radius: 8 }, planets: [planet],
    ark: { id: 'home:ark', systemId: 'home', orbit: 70, phase: arkPhase, speed: .02 } });
  const dc = Building.create({ id: 'dc', type: 'datacenter', planetId, x: 0, y: 0, constructionState: 'complete', dockStock: { analysis: 10 } });
  const hf = Building.create({ id: 'hf', type: 'hf_antenna', planetId, x: 50, y: 0, constructionState: 'complete' });
  const state = { surfaceBuildings: [dc, hf], roadNetworks: {}, techPoints: 0 };
  joinByRoad(state, planetId, dc, hf);
  DataNetwork.advance(state, 1);
  assert.deepEqual(plain(hf.dataQueue), { analysis: 10 });
  // The Ark behind the star: nothing leaves.
  DataTransit.advance(state, 0, new Map([['home', make(Math.PI)]]));
  assert.equal(state.dataTransit.packets.length, 0);
  assert.equal(hf.dataLink.reason, 'conjunction');
  // In view: one packet every five seconds, up to five seconds of the
  // antenna's bandwidth, 3× faster than freight.
  const system = make(.6), spec = context.OrbitDataNetworkData.highFrequency;
  DataTransit.advance(state, spec.dispatchIntervalSeconds - .5, new Map([['home', system]]));
  assert.equal(state.dataTransit.packets.length, 0, 'nothing leaves between two sendings');
  DataTransit.advance(state, spec.dispatchIntervalSeconds, new Map([['home', system]]));
  const [packet] = state.dataTransit.packets;
  assert.equal(packet.amount, Math.min(10, spec.bandwidthMbPerSecond * spec.dispatchIntervalSeconds));
  const freight = Transit.travelTime(system, planet, spec.dispatchIntervalSeconds);
  assert.ok(Math.abs((packet.arrivalTime - packet.departureTime) - freight / 3) < 1e-6);
  DataTransit.advance(state, packet.arrivalTime, new Map([['home', system]]), false);
  assert.equal(state.techPoints, 10, 'each analysis reaching the Ark is a point');
});

test('raw data of a planet without datacenter crosses to the datacenter of another planet', () => {
  const DataNetwork = context.OrbitDataNetwork, DataTransit = context.OrbitDataTransit;
  const home = { id: 'home:p-0', orbit: 100, radius: 5, phase: 0, speed: .03 }, far = { id: 'home:p-1', orbit: 160, radius: 5, phase: .5, speed: .02 };
  const system = { id: 'home', star: { mass: 1, radius: 8 }, planets: [home, far], ark: { id: 'home:ark', systemId: 'home', orbit: 70, phase: 2, speed: .02 } };
  const on = (id, type, planet, x, extras = {}) => Building.create({ id, type, planetId: planet.id, x, y: 0, constructionState: 'complete', ...extras });
  const drill = on('x-far', 'extractor', far, 0, { status: 'active' }), relay = on('relay-far', 'antenna', far, 20);
  const sender = on('hf-far', 'hf_antenna', far, 60), receiver = on('hf-home', 'hf_antenna', home, 0), dc = on('dc-home', 'datacenter', home, 40);
  drill.status = 'active';
  const state = { surfaceBuildings: [drill, relay, sender, receiver, dc], roadNetworks: {}, techPoints: 0 };
  joinByRoad(state, far.id, relay, sender);
  joinByRoad(state, home.id, receiver, dc);
  DataNetwork.advance(state, 10);
  assert.equal(state.dataLinks['relay-far'].hfAntennaId, 'hf-far');
  assert.deepEqual(plain(sender.dataQueue), { geo_data: 10 });
  const systems = new Map([['home', system]]);
  DataTransit.advance(state, 0, systems);
  const [packet] = state.dataTransit.packets;
  assert.equal(packet.toId, 'hf-home');
  DataTransit.advance(state, packet.arrivalTime, systems, false);
  assert.equal(dc.inventory.geo_data, packet.amount, 'taken in by the datacenter joined to the receiving antenna');
});

test('worlds without colony take only a colony (rocky worlds) or a lab, once the lander is acquired', () => {
  const rocky = { id: 'home:p-1', kind: 'aride' }, gas = { id: 'home:p-2', kind: 'gazeuse' }, home = { id: planetId, kind: 'tellurique' };
  const state = { surfaceBuildings: [], skills: { unlocked: [] } };
  assert.equal(Progression.buildBlockedHere(state, 'colony', rocky), null, 'the first colony goes anywhere');
  assert.ok(Progression.buildBlockedHere(state, 'factory', home));
  state.surfaceBuildings.push({ type: 'colony', planetId });
  assert.equal(Progression.buildBlockedHere(state, 'factory', home), null);
  assert.ok(Progression.buildBlockedHere(state, 'lab', rocky), 'needs the lander');
  state.skills.unlocked.push('lander');
  assert.equal(Progression.buildBlockedHere(state, 'lab', rocky), null);
  assert.equal(Progression.buildBlockedHere(state, 'colony', rocky), null);
  assert.equal(Progression.buildBlockedHere(state, 'lab', gas), null);
  assert.ok(Progression.buildBlockedHere(state, 'colony', gas));
  assert.ok(Progression.buildBlockedHere(state, 'factory', rocky));
});

test('a datacenter sends only to a high-frequency antenna joined by road: the one chosen, else the nearest', () => {
  const DataNetwork = context.OrbitDataNetwork;
  const on = (id, type, x) => Building.create({ id, type, planetId, x, y: 0, constructionState: 'complete' });
  const dc = on('dc', 'datacenter', 0), near = on('hf-near', 'hf_antenna', 40), far = on('hf-far', 'hf_antenna', 200);
  const loose = on('hf-loose', 'hf_antenna', 10), factory = on('factory', 'factory', 20);
  const state = { surfaceBuildings: [dc, near, far, loose, factory], roadNetworks: {} };
  joinByRoad(state, planetId, dc, near); joinByRoad(state, planetId, dc, far); joinByRoad(state, planetId, dc, factory);
  assert.deepEqual(plain(DataNetwork.uplinkCandidates(state, dc).map(item => item.id)), ['hf-near', 'hf-far'], 'antennas by road only');
  assert.equal(DataNetwork.uplinkAntenna(state, dc).id, 'hf-near');
  dc.dockDestinations.analysis = 'hf-far';
  assert.equal(DataNetwork.uplinkAntenna(state, dc).id, 'hf-far');
  dc.dockDestinations.analysis = 'factory';
  assert.equal(DataNetwork.uplinkAntenna(state, dc).id, 'hf-near', 'anything else falls back to the nearest antenna');
});

test('a high-frequency antenna pointed at another one relays through it toward the Ark', () => {
  const DataTransit = context.OrbitDataTransit;
  const a = { id: 'home:p-0', orbit: 100, radius: 5, phase: 0, speed: 0 }, b = { id: 'home:p-1', orbit: 130, radius: 5, phase: .4, speed: 0 };
  const system = { id: 'home', star: { mass: 1, radius: 8 }, planets: [a, b], ark: { id: 'home:ark', systemId: 'home', orbit: 70, phase: .2, speed: 0 } };
  const on = (id, planet, extras = {}) => Building.create({ id, type: 'hf_antenna', planetId: planet.id, x: 0, y: 0, constructionState: 'complete', ...extras });
  const sender = on('hf-a', a, { dataQueue: { analysis: 4 }, hfTarget: 'hf-b' }), relay = on('hf-b', b);
  const state = { surfaceBuildings: [sender, relay], roadNetworks: {}, techPoints: 0 };
  assert.deepEqual(plain(DataTransit.destinationChoices(state, sender).map(item => item.id)), ['hf-b']);
  const systems = new Map([['home', system]]);
  DataTransit.advance(state, 0, systems);
  let [packet] = state.dataTransit.packets;
  assert.equal(packet.toId, 'hf-b', 'sent to the chosen antenna, not to the Ark');
  DataTransit.advance(state, packet.arrivalTime, systems, false);
  assert.deepEqual(plain(relay.dataQueue), { analysis: 4 }, 'no datacenter there: it waits to go on');
  DataTransit.advance(state, Math.ceil(packet.arrivalTime) + 1, systems);
  [packet] = state.dataTransit.packets;
  assert.equal(packet.toKind, 'ark');
  DataTransit.advance(state, packet.arrivalTime, systems, false);
  assert.equal(state.techPoints, 4);
  relay.hfTarget = 'hf-a';
  assert.equal(DataTransit.destinationAntenna(state, 'home', sender), null, 'two antennas pointed at each other do not loop');
});

// Wind: a square of land at one height, optionally broken ground or water.
function windTerrain(level, { rough = false, water = false } = {}) {
  const width = 40, height = 40, seaLevel = 100, elevation = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    elevation[y * width + x] = water ? 90 : rough ? ((x + y) % 2 ? level + 25 : level) : level;
  }
  return { width, height, seaLevel, elevation };
}

test('a wind site catches much on open plains and high plateaus, almost nothing on broken ground, nothing on water', () => {
  const Wind = context.OrbitWindPower, wind = context.OrbitProcessData.config.wind;
  const middle = { x: cellX(20), y: cellX(20) };
  const factor = quality => Math.max(wind.minSite, wind.maxSite *
    Math.max(0, Math.min(1, (quality - wind.calmBelow) / (wind.fullAt - wind.calmBelow))) ** wind.curve);
  const plain = Wind.siteFactor(windTerrain(110), middle);
  const plateau = Wind.siteFactor(windTerrain(157), middle);
  const broken = Wind.siteFactor(windTerrain(110, { rough: true }), middle);
  // Flat ground at 350 m: fully open, a little raised by altitude.
  assert.ok(Math.abs(plain - factor(1 + wind.altitudeBoost * 350 / wind.altitudeFullM)) < 1e-3, `${plain}`);
  assert.ok(plain > 1.2, `an open plain gives much (${plain})`);
  assert.ok(Math.abs(plateau - wind.maxSite) < 1e-6, 'an open high plateau gives the most');
  assert.ok(Math.abs(broken - wind.minSite) < 1e-6, `broken ground gives almost nothing (${broken})`);
  // The output grows slowly until the ground is really open.
  assert.ok(factor(.6) < .15 && factor(.8) < .6 && factor(.95) > 1, 'slow at first, strong once open');
  assert.equal(Wind.siteGrid(windTerrain(110, { water: true }))[20 * 40 + 20], 0, 'no wind site on water');
  assert.equal(Wind.siteFactor(null, middle), 1, 'unknown terrain: an average site');
});

test('a turbine in the wake of another loses 50 % of its wind at the edge, up to 95 % beside it', () => {
  const Wind = context.OrbitWindPower, wind = context.OrbitProcessData.config.wind;
  const at = (id, x) => ({ id, type: 'wind_turbine', planetId, x, y: 0, constructionState: 'complete', windSite: 1 });
  const alone = at('a', 0);
  assert.equal(Wind.wakeEfficiency(alone, [alone]), 1);
  assert.equal(Wind.wakeEfficiency(alone, [alone, at('far', wind.wakeRadiusKm + 1)]), 1, 'beyond the wake radius: no loss');
  const edge = Wind.wakeEfficiency(alone, [alone, at('e', wind.wakeRadiusKm - 1e-6)]);
  assert.ok(Math.abs(edge - .5) < 1e-6, `entering a wake: −50 % (${edge})`);
  const beside = Wind.wakeEfficiency(alone, [alone, at('n', 0)]);
  assert.ok(Math.abs(beside - .05) < 1e-9, `right beside another: −95 % (${beside})`);
  const half = Wind.wakeEfficiency(alone, [alone, at('b', wind.wakeRadiusKm / 2)]);
  assert.ok(Math.abs(half - (1 - .725)) < 1e-9, `half way: −72,5 % (${half})`);
  const two = Wind.wakeEfficiency(alone, [alone, at('c', wind.wakeRadiusKm / 2), at('d', -wind.wakeRadiusKm / 2)]);
  assert.ok(Math.abs(two - half * half) < 1e-9, 'two wakes: each takes its share of what is left');
  const stack = Array.from({ length: 10 }, (_, index) => at(`s${index}`, index));
  const total = stack.reduce((sum, turbine) => sum + Wind.outputMW(turbine, stack), 0);
  const single = context.OrbitProcessData.config.windPowerMW;
  assert.ok(total < single, `ten stacked turbines give ${total} MW, less than one alone`);
  const pair = [at('q1', 0), at('q2', 1)];
  assert.ok(pair.reduce((sum, turbine) => sum + Wind.outputMW(turbine, pair), 0) < single, 'two side by side: less than one');
  const apart = [at('r1', 0), at('r2', wind.wakeRadiusKm * .75)];
  const apartTotal = apart.reduce((sum, turbine) => sum + Wind.outputMW(turbine, apart), 0);
  assert.ok(apartTotal < single, `even three quarters of the wake apart, two give ${apartTotal} MW, less than one alone`);
  const spread = Array.from({ length: 3 }, (_, index) => at(`p${index}`, index * (wind.wakeRadiusKm + 5)));
  assert.equal(spread.reduce((sum, turbine) => sum + Wind.outputMW(turbine, spread), 0), single * 3, 'spaced out: full power each');
  // The planet's supply follows: site factor × wake efficiency per turbine.
  const state = { surfaceBuildings: [at('w1', 0), at('w2', wind.wakeRadiusKm / 2), { ...at('w3', 2000), windSite: 1.4 }],
    factoryPlans: {}, seed: 'wind' };
  context.OrbitIndustry.advance(state, 1);
  const expected = state.surfaceBuildings.reduce((sum, turbine) => sum + Wind.outputMW(turbine, state.surfaceBuildings), 0);
  assert.ok(Math.abs(state.powerStatus[planetId].supplyMW - expected) < 1e-9);
  assert.ok(Math.abs(state.surfaceBuildings[2].energyOutputWatts - single * 1.4 * 1e6) < 1e-3, 'a rich site gives more');
  assert.ok(state.surfaceBuildings[0].windWake < 1, 'the wake is kept for the sheet');
});
