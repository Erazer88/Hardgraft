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
