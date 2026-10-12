'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/config.js', 'data/resources.js', 'data/buildings.js', 'data/roads.js', 'data/settlements.js',
  'simulation/simulation.js', 'simulation/inventory.js', 'simulation/buildings.js', 'simulation/roadNetwork.js',
  'simulation/settlements.js', 'gameplay/exploration.js', 'state.js', 'storage/save.js',
  'navigation/camera.js']) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);
}
const { OrbitConfig: Config, OrbitSimulation: Simulation, OrbitExploration: Exploration,
  OrbitState: State, OrbitSave: Save, OrbitCamera: Camera } = context;
const plain = value => JSON.parse(JSON.stringify(value));
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
const galaxy = () => ({ systems: [
  { id: 'home', x: 0, y: 0, discovered: true },
  { id: 'near', x: 100, y: 20, discovered: false },
  { id: 'far', x: 3000, y: 0, discovered: false }
] });

test('sessions keep their navigation and orbital state separate', () => {
  const first = State.create(), second = State.create();
  assert.deepEqual(plain(first.simulation), { time: 0 });
  first.simulation.time = 10;
  first.exploration.visited.add('home');
  assert.equal(second.simulation.time, 0);
  assert.equal(second.exploration.visited.size, 0);
});

test('simulation clock advances explicitly and pauses cleanly', () => {
  const simulation = Simulation.create();
  Simulation.advance(simulation, .5); Simulation.advance(simulation, 2, false);
  close(simulation.time, .5);
  for (const invalid of [-1, NaN, Infinity]) assert.throws(() => Simulation.advance(simulation, invalid));
  close(simulation.time, .5);
});

test('seed normalization preserves existing numeric and textual behaviour', () => {
  assert.equal(State.normalizedSeed(' 0042 '), 42);
  assert.equal(State.normalizedSeed('0'), 0);
  assert.equal(State.normalizedSeed(''), Config.defaultSeed);
  assert.equal(State.normalizedSeed('  Nouvelle galaxie  '), 'Nouvelle galaxie');
  assert.equal(State.normalizedSeed('a'.repeat(100)).length, 64);
});

test('camera projections and nested frames agree at every zoom scale', () => {
  const viewport = { width: 390, height: 844 };
  const frame = { x: 2800, y: -900, scale: .004 };
  const point = { x: 400, y: -260 };
  for (const zoom of [.025, .1, 50, 12000]) {
    const camera = { x: 2801, y: -899, zoom };
    const worldPoint = Camera.worldPoint(frame, point);
    const global = Camera.project(worldPoint, camera, viewport);
    const local = Camera.project(point, Camera.toLocal(frame, camera), viewport);
    close(global.x, local.x, .000001); close(global.y, local.y, .000001);
    const unprojected = Camera.unproject(global, camera, viewport);
    close(unprojected.x, worldPoint.x); close(unprojected.y, worldPoint.y);
    const returned = Camera.toWorld(frame, Camera.toLocal(frame, camera));
    close(returned.x, camera.x); close(returned.y, camera.y); close(returned.zoom, zoom);
  }
});

test('manual zoom keeps a non-central focal point fixed and reverses exactly', () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const camera = { x: 3100, y: -1700, zoom: 12 };
    const anchor = { x: viewport.width * .31, y: viewport.height * .64 };
    const worldPoint = Camera.unproject(anchor, camera, viewport);
    const zoomed = Camera.anchoredZoom(camera, viewport, camera.zoom * 1.03, anchor);
    const projected = Camera.project(worldPoint, zoomed, viewport);
    close(projected.x, anchor.x); close(projected.y, anchor.y);
    const returned = Camera.anchoredZoom(zoomed, viewport, camera.zoom, anchor);
    close(returned.x, camera.x); close(returned.y, camera.y); close(returned.zoom, camera.zoom);
  }
});

test('a pinch with a moving midpoint keeps its original world point under the new midpoint', () => {
  const viewport = { width: 390, height: 844 }, camera = { x: 2800, y: 1400, zoom: 200 };
  const oldMidpoint = { x: 120, y: 400 }, nextMidpoint = { x: 170, y: 430 };
  const worldPoint = Camera.unproject(oldMidpoint, camera, viewport);
  const next = Camera.anchoredZoom(camera, viewport, 260, nextMidpoint, oldMidpoint);
  const projected = Camera.project(worldPoint, next, viewport);
  close(projected.x, nextMidpoint.x); close(projected.y, nextMidpoint.y);
});

test('surface center remains exactly on the planetary center at every scale', () => {
  const center = { x: 3300.125, y: -1400.4 }, size = { width: 1440, height: 1080 };
  const frame = Camera.surfaceFrame(center, .04, size);
  const mapCenter = Camera.worldPoint(frame, { x: size.width / 2, y: size.height / 2 });
  close(mapCenter.x, center.x); close(mapCenter.y, center.y);
  close(frame.scale * size.height, .08);
});

test('automatic recadrage converges continuously and marks only its exact endpoint as settled', () => {
  let camera = { x: 0, y: 0, zoom: .05 };
  const target = { x: 3300, y: -1400, zoom: 14000 };
  for (let step = 0; step < 300; step++) {
    const next = Camera.smooth(camera, target, 1 / 60, Config.camera.easingRate);
    assert.ok(next.zoom >= camera.zoom && next.zoom <= target.zoom);
    camera = next;
  }
  assert.deepEqual(plain(camera), target);
  assert.equal(Camera.moving(camera, target), false);
});

test('legacy saves restore exploration and orbital time without losing initial discoveries', () => {
  const state = State.create(), world = galaxy();
  const saved = { seed: state.seed, time: 42, discovered: ['near'], scans: [{ x: 12, y: 5, radius: 99 }], visited: ['home'] };
  assert.equal(Save.restore(state, world, saved), true);
  assert.equal(world.systems[0].discovered, true); assert.equal(world.systems[1].discovered, true);
  assert.equal(world.systems[2].discovered, false); assert.equal(state.simulation.time, 42);
  assert.deepEqual(plain(state.exploration.scans), saved.scans);
  assert.deepEqual([...state.exploration.visited], ['home']);
});

test('versioned saves round-trip exploration and clock state without serializing view caches', () => {
  const state = State.create(), world = galaxy();
  state.exploration = Exploration.create(world.systems[0]);
  state.simulation.time = 15;
  state.context = { deliberatelyCircularView: state };
  let stored;
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  assert.equal(Save.save(storage, state, world), true);
  const saved = Save.load(storage), restored = State.create();
  assert.equal(Save.restore(restored, galaxy(), saved), true);
  assert.deepEqual(plain(restored.simulation), plain(state.simulation));
  state.simulation.time = 2;
  assert.equal(restored.simulation.time, 15);
  assert.equal('simulation' in saved, false);
  assert.equal('buildings' in saved, false);
  assert.equal('context' in saved, false); assert.equal('camera' in saved, false);
});

test('settlement saves use compact asset keys and restore buildings, routes and houses', () => {
  const state = State.create(), world = galaxy();
  state.surfaceBuildings = [context.OrbitSurfaceBuilding.create({ id: 'hub-1', type: 'hub',
    planetId: 'planet-1', x: 20, y: 30, constructionState: 'complete' })];
  const network = context.OrbitRoadNetwork.create('planet-1');
  const from = context.OrbitRoadNetwork.addNode(network, { x: 20, y: 30, buildingId: 'hub-1' });
  const to = context.OrbitRoadNetwork.addNode(network, { x: 120, y: 60, type: 'intersection' });
  context.OrbitRoadNetwork.addSegment(network, { from: from.id, to: to.id,
    points: [{ x: 20, y: 30 }, { x: 120, y: 60 }], builtLength: 35 });
  state.roadNetworks['planet-1'] = network;
  const settlement = context.OrbitSettlementSimulation.create('planet-1');
  const roadId = 'planet-1:settlement-road:1';
  settlement.roads.push({ id: roadId, type: 'branch', stage: 1, routeId: 'road-1',
    anchor: { x: 40, y: 35 }, endpoint: { x: 80, y: 50 }, parentRoadId: null,
    connectsToRoadId: null, roadClass: 'collector', neighborhoodId: 'neighborhood-1',
    startHostId: 'main-1', startHostKind: 'main', startHostRouteId: 'road-1', startHostMeasure: 20,
    fromNode: { kind: 'main', hostId: 'main-1', measure: 20, x: 40, y: 35 },
    toNode: { kind: 'neighborhood', neighborhoodId: 'neighborhood-1', x: 80, y: 50 },
    tangent: { x: .9, y: .4 }, points: [{ x: 40, y: 35 }, { x: 80, y: 50 }], length: 42.72, builtLength: 12 });
  const houseAsset = context.OrbitSettlementSimulation.assetKey('assets/settlements/maison_01.webp');
  const districtAsset = context.OrbitSettlementSimulation.assetKey('assets/settlements/village_ligne_droite.webp');
  settlement.houses = Array.from({ length: 100 }, (_, index) => ({ id: `house-${index + 1}`, roadId,
    neighborhoodId: 'neighborhood-1',
    roadDistance: index + 1, x: 50 + index, y: 39, rotation: .2, asset: houseAsset }));
  settlement.districts.push({ id: 'district-1', roadId, routeId: 'road-1', mainRoadAsset: false,
    kind: 'center', neighborhoodId: 'neighborhood-1', roadDistance: 20,
    x: 60, y: 42, rotation: .3, variant: 1, asset: districtAsset });
  settlement.neighborhoods.push({ id: 'neighborhood-1', productionBuildingId: 'factory-1',
    x: 80, y: 50, routeId: 'road-1', collectorRoadId: roadId, roadIds: [roadId] });
  state.surfaceSettlements['planet-1'] = settlement;

  let stored;
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  assert.equal(Save.save(storage, state, world), true);
  const saved = Save.load(storage);
  assert.equal(saved.surfaceSettlements['planet-1'].houses[0].asset, 'house:maison_01');
  assert.equal(saved.surfaceSettlements['planet-1'].districts[0].asset, 'district:village_ligne_droite');
  assert.ok(stored.length < 25000, `100-house compact save is ${stored.length} characters`);

  const restored = State.create();
  assert.equal(Save.restore(restored, galaxy(), saved), true);
  assert.equal(restored.surfaceBuildings.length, 1);
  assert.equal(restored.roadNetworks['planet-1'].segments.length, 1);
  assert.equal(restored.surfaceSettlements['planet-1'].roads.length, 1);
  assert.equal(restored.surfaceSettlements['planet-1'].houses.length, 100);
  assert.equal(restored.surfaceSettlements['planet-1'].houses[0].asset, 'assets/settlements/maison_01.webp');
  assert.equal(restored.surfaceSettlements['planet-1'].districts.length, 1);
  assert.equal(restored.surfaceSettlements['planet-1'].roads[0].roadClass, 'collector');
  assert.equal(restored.surfaceSettlements['planet-1'].roads[0].toNode.neighborhoodId, 'neighborhood-1');
  assert.equal(restored.surfaceSettlements['planet-1'].neighborhoods[0].collectorRoadId, roadId);

  const legacy = plain(saved);
  legacy.version = 6;
  legacy.surfaceSettlements['planet-1'].houses[0].asset = 'assets/settlements/maison_01.webp';
  const restoredLegacy = State.create();
  assert.equal(Save.restore(restoredLegacy, galaxy(), legacy), true);
  assert.equal(restoredLegacy.surfaceSettlements['planet-1'].houses.length, 100);
  assert.equal(restoredLegacy.surfaceSettlements['planet-1'].houses[0].asset, 'assets/settlements/maison_01.webp');
});

test('unavailable storage, invalid saves and different seeds do not break a new session', () => {
  assert.equal(Save.load({ getItem() { throw new Error('Storage unavailable'); } }), null);
  assert.equal(Save.load({ getItem: () => '{broken' }), null);
  assert.equal(Save.load({ getItem: () => '{"seed":"future","version":999}' }), null);
  const state = State.create();
  assert.equal(Save.save({ setItem() { throw new Error('Read only'); } }, state, galaxy()), false);
  assert.equal(Save.restore(state, galaxy(), { seed: 'different', time: 200 }), false);
  assert.equal(state.simulation.time, 0);
});

test('probes discover only when their existing travel timer completes', () => {
  const world = galaxy(), exploration = Exploration.create(world.systems[0]);
  Exploration.launch(exploration, world.systems[0], { x: 100, y: 0 }, 1000);
  assert.equal(Exploration.advance(exploration, world, 1000 + Config.exploration.durationMs - 1).length, 0);
  assert.equal(world.systems[1].discovered, false);
  const completed = Exploration.advance(exploration, world, 1000 + Config.exploration.durationMs);
  assert.equal(completed.length, 1); assert.equal(completed[0].discoveredCount, 1);
  assert.equal(world.systems[1].discovered, true); assert.equal(world.systems[2].discovered, false);
  assert.equal(exploration.missions.length, 0); assert.equal(exploration.scans.length, 2);
});

test('overlapping probe completions do not double count discoveries or repeat rewards', () => {
  const world = galaxy(), exploration = Exploration.create(world.systems[0]);
  const destination = { x: 100, y: 0 };
  Exploration.launch(exploration, world.systems[0], destination, 0);
  Exploration.launch(exploration, world.systems[0], destination, 20);
  destination.x = 9000;
  const results = Exploration.advance(exploration, world, 3000);
  assert.deepEqual(Array.from(results, result => result.discoveredCount), [1, 0]);
  assert.equal(Exploration.advance(exploration, world, 5000).length, 0);
  assert.equal(exploration.scans.length, 3);
});
