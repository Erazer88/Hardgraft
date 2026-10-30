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
  'data/config.js', 'simulation/inventory.js', 'simulation/construction.js', 'gameplay/colonyZone.js', 'gameplay/progression.js', 'gameplay/alerts.js']) {
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
  assert.deepEqual(plain(Data.launch), { capacityUPerSecond: 4, batchIntervalSeconds: 10, energyMW: 5 });
  assert.equal(Data.transit.cargoSpeedMultiplier, .7);
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

test('platform launches every dock-routed resource in whole-unit packets averaging four units per second', () => {
  const { platform, state } = fixture();
  Logistics.advance(state, 0, systems);
  platform.launchStock.raw_iron = 40;
  platform.launchStock.water = 40;
  Logistics.advance(state, 9, systems);
  assert.equal(platform.launchStock.raw_iron, 40, 'no packet departs before its ten-second accumulation interval');
  assert.equal(state.orbitalLogistics.transit.length, 0);
  Logistics.advance(state, 10, systems);
  assert.deepEqual(plain(platform.launchStock), { raw_iron: 20, water: 20 });
  assert.equal(state.orbitalLogistics.transit.length, 2, 'one cargo per resource represents the shared packet');
  assert.deepEqual(plain(Object.fromEntries(state.orbitalLogistics.transit.map(lot => [lot.resourceId, lot.amount]))),
    { raw_iron: 20, water: 20 });
  assert.ok(state.orbitalLogistics.transit.every(lot => Number.isInteger(lot.amount)));
  assert.equal(state.orbitalLogistics.transit[0].departureTime, 10);
  assert.equal(state.orbitalLogistics.transit[0].arrivalTime, 10 + Transit.travelTime(system, system.planets[0], 10));
  Logistics.advance(state, 10, systems);
  assert.equal(state.orbitalLogistics.transit.reduce((sum, lot) => sum + lot.amount, 0), 40,
    'repeated frames at the same simulation time do not dispatch twice');
  Logistics.advance(state, 20, systems);
  assert.deepEqual(plain(platform.launchStock), { raw_iron: 0, water: 0 });
  assert.equal(state.orbitalLogistics.transit.reduce((sum, lot) => sum + lot.amount, 0), 80);
  assert.equal(Transit.currentPlatformMetrics(state, platform.id, 20).throughput, 4,
    'two 40-unit packets over twenty seconds represent four units per second');
  assert.deepEqual(plain(Transit.currentHubMetrics(state, 'home', 20).rates), { raw_iron: 2, water: 2 });
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
  assert.equal(state.orbitalLogistics.nextDispatchTime, 10);
  assert.equal(platform.launchStock.raw_iron, 8);
  assert.equal(state.orbitalLogistics.hubs.home.stock.raw_iron, 320);
  assert.equal(state.orbitalLogistics.transit[0].amount, 3);
  Transit.advance(state, 9.9, systems);
  assert.equal(platform.launchStock.raw_iron, 8);
  Transit.advance(state, 10, systems);
  const shipment = state.orbitalLogistics.transit.find(lot => lot.resourceId === 'raw_iron');
  assert.equal(shipment.amount, 8);
  assert.equal(shipment.departureTime, 10);
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
  Logistics.advance(state, 10, systems);
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
  Transit.advance(state, 10, systems);
  const lots = state.orbitalLogistics.transit;
  assert.equal(new Set(lots.map(lot => lot.corridorId)).size, 1);
  assert.deepEqual(plain(Object.fromEntries(lots.map(lot => [lot.resourceId, lot.amount]))),
    { gas: 8, iron_tailings: 8, raw_iron: 8 });
  assert.ok(lots.every(lot => Number.isInteger(lot.amount) && lot.amount > 0));
});

test('new cargo follows a fixed prograde polar transfer to the predicted Ark position', () => {
  const { platform, state } = fixture({ dockStock: {} });
  platform.launchStock.raw_iron = 1;
  Transit.advance(state, 10, systems);
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
  const expected = Math.max(5, Math.min(45, 30 * length / (Math.PI * planet.orbit))) / .7;
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
      const expected = Math.max(5, Math.min(45, 30 * length / (Math.PI * median))) / .7;
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
