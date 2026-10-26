'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/developerSettings.js', 'data/config.js', 'data/resources.js', 'data/orbitalLogistics.js',
  'data/worldgen.js', 'data/buildings.js', 'world.js',
  'data/roads.js', 'data/settlements.js', 'simulation/simulation.js', 'simulation/inventory.js',
  'simulation/buildings.js', 'simulation/construction.js', 'simulation/roadNetwork.js',
  'simulation/logisticsNetwork.js', 'simulation/orbitalTransit.js',
  'simulation/settlements.js', 'gameplay/exploration.js', 'state.js', 'storage/save.js',
  'navigation/camera.js']) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);
}
const processContext = vm.createContext({});
for (const relative of ['data/resources.js', 'data/processes.js', 'simulation/processGraph.js']) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), processContext);
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

test('launch stocks, orbital hub inventory and an in-flight whole-unit lot survive saving', () => {
  const state = State.create(), world = galaxy();
  state.seed = 'orbital-save';
  state.surfaceBuildings = [context.OrbitSurfaceBuilding.create({ id: 'platform-1', type: 'launch_platform',
    planetId: 'home:p-0', x: 10, y: 20, constructionState: 'complete',
    inventory: { iron: 77 }, launchStock: { raw_iron: 3 }, launchReceivedTotal: { raw_iron: 8 },
    exportEnabled: { raw_iron: true }, dockDestinations: { raw_iron: 'factory-2' } })];
  state.orbitalLogistics = { version: 1,
    corridors: [{ id: 'platform-1->home:ark', fromEntityId: 'platform-1', toEntityId: 'home:ark' }],
    transit: [{ corridorId: 'platform-1->home:ark', resourceId: 'raw_iron', amount: 2,
      departureTime: 115, arrivalTime: 120, systemId: 'home', originPlanetId: 'home:p-0' }],
    hubs: { home: { id: 'home:ark', stock: { raw_iron: 320, iron_slag: 41 } } }, nextDispatchTime: 121 };
  state.simulation.time = 117;
  let stored;
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  assert.equal(Save.save(storage, state, world), true);
  const restored = State.create(); restored.seed = state.seed;
  assert.equal(Save.restore(restored, world, Save.load(storage)), true);
  assert.deepEqual(plain(restored.orbitalLogistics.hubs.home.stock), { raw_iron: 320, iron_slag: 41 });
  assert.equal(restored.orbitalLogistics.transit[0].amount, 2);
  assert.equal(restored.orbitalLogistics.transit[0].arrivalTime, 120);
  assert.equal(restored.surfaceBuildings[0].launchStock.raw_iron, 3);
  assert.equal(restored.surfaceBuildings[0].exportEnabled.raw_iron, true);
  assert.equal(restored.surfaceBuildings[0].dockDestinations.raw_iron, 'factory-2');
  assert.equal(restored.surfaceBuildings[0].inventory.iron, 77, 'the building inventory remains separate');
});

test('simulation clock advances explicitly and pauses cleanly', () => {
  const simulation = Simulation.create();
  Simulation.advance(simulation, .5); Simulation.advance(simulation, 2, false);
  close(simulation.time, .5);
  for (const invalid of [-1, NaN, Infinity]) assert.throws(() => Simulation.advance(simulation, invalid));
  close(simulation.time, .5);
});

test('infinite mineral setting bypasses construction costs without spending or refunding minerals', () => {
  const settings = context.OrbitDeveloperSettings, Inventory = context.OrbitInventory;
  const inventory = Inventory.create();
  const mineralCost = { iron: 35, copper: 16, silicon: 8, carbon: 2 };
  try {
    assert.equal(Inventory.canAfford(inventory, mineralCost), false);
    assert.deepEqual(plain(Inventory.missing(inventory, mineralCost)), [
      { id: 'iron', amount: 35 }, { id: 'copper', amount: 16 },
      { id: 'silicon', amount: 8 }, { id: 'carbon', amount: 2 }
    ]);

    settings.set('infiniteMinerals', true);
    assert.equal(Inventory.canAfford(inventory, mineralCost), true);
    assert.deepEqual(plain(Inventory.missing(inventory, mineralCost)), []);
    assert.deepEqual(plain(Inventory.chargeableCost(mineralCost)), {});
    assert.equal(Inventory.isInfinite('iron'), true);
    assert.equal(Inventory.isInfinite('water'), false);
    assert.deepEqual(plain(Inventory.missing(inventory, { iron: 1, water: 2 })), [
      { id: 'water', amount: 2 }
    ]);

    const building = { type: 'factory', constructionState: 'planned' };
    assert.equal(context.OrbitConstruction.start(building, inventory).started, true);
    assert.deepEqual(plain(building.costPaid), {});
    assert.deepEqual(plain(inventory), {});
    assert.deepEqual(plain(context.OrbitConstruction.demolish(building, inventory)), {});
    assert.deepEqual(plain(inventory), {});

    settings.set('infiniteMinerals', false);
    assert.equal(Inventory.canAfford(inventory, mineralCost), false);
  } finally {
    settings.reset();
  }
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

test('general saves preserve buildings while legacy industrial graphs reset to the current schema', () => {
  context.OrbitProcessData = { config: { version: processContext.OrbitProcessData.config.version } };
  context.OrbitProcessGraph = processContext.OrbitProcessGraph;
  const state = State.create(), world = galaxy();
  state.surfaceBuildings = [context.OrbitSurfaceBuilding.create({ id: 'factory-1', type: 'factory',
    planetId: 'planet-1', x: 20, y: 30, constructionState: 'complete' })];
  state.factoryPlans = {
    'factory-1': { version: 3, nodes: [{ id: 'node-1', type: 'smelter', x: 140, y: 90 }], connections: [] },
    'missing-building': { nodes: [], connections: [] }
  };
  let stored;
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  assert.equal(Save.save(storage, state, world), true);
  const saved = Save.load(storage), restored = State.create();
  assert.deepEqual(plain(saved.factoryPlans['factory-1']), {
    version: processContext.OrbitProcessData.config.version, accumulator: 0, tick: 0, geology: null,
    machines: [], connections: []
  });
  assert.deepEqual(Object.keys(saved.factoryPlans), ['factory-1']);
  assert.equal(Save.restore(restored, galaxy(), saved), true);
  assert.equal(restored.surfaceBuildings[0].id, 'factory-1');
  assert.deepEqual(plain(restored.factoryPlans['factory-1'].machines), []);

  const graph = processContext.OrbitProcessGraph.create({ version: processContext.OrbitProcessData.config.version,
    machines: [{ id: 'crusher-1', type: 'crusher', x: 140, y: 90 }] });
  restored.factoryPlans['factory-1'] = graph;
  assert.equal(Save.save(storage, restored, galaxy()), true);
  const latest = Save.load(storage), next = State.create();
  assert.equal(Save.restore(next, galaxy(), latest), true);
  assert.deepEqual(plain(next.factoryPlans['factory-1'].machines.map(machine => ({ id: machine.id, type: machine.type,
    resourceId: machine.resourceId }))), [{ id: 'crusher-1', type: 'crusher', resourceId: 'iron' }]);
});

test('settlement saves use compact asset keys and restore buildings, routes and houses', () => {
  const state = State.create(), world = galaxy();
  state.surfaceBuildings = [context.OrbitSurfaceBuilding.create({ id: 'launch-platform-1', type: 'launch_platform',
    planetId: 'planet-1', x: 20, y: 30, constructionState: 'complete' })];
  const network = context.OrbitRoadNetwork.create('planet-1');
  const from = context.OrbitRoadNetwork.addNode(network, { x: 20, y: 30, buildingId: 'launch-platform-1' });
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
  assert.equal(Save.load({ getItem: () => '{"seed":"future","version":999}' }).version, 999,
    'an app update must not discard a save just because its schema version is newer');
  const state = State.create();
  assert.equal(Save.save({ setItem() { throw new Error('Read only'); } }, state, galaxy()), false);
  assert.equal(Save.restore(state, galaxy(), { seed: 'different', time: 200 }), false);
  assert.equal(state.simulation.time, 0);
});

test('best-effort save migration preserves buildings from a newer save version', () => {
  const saved = { version: 999, seed: 'NEREIDE-01', surfaceBuildings: [
    { id: 'factory-1', type: 'factory', planetId: 'home:p-0', x: 20, y: 30, constructionState: 'complete' }
  ] };
  let raw = JSON.stringify(saved);
  const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  const loaded = Save.load(storage);
  const restored = State.create();
  assert.equal(Save.restore(restored, galaxy(), loaded), true);
  assert.deepEqual(plain(restored.surfaceBuildings.map(building => building.id)), ['factory-1']);
  assert.equal(Save.save(storage, restored, galaxy()), true);
  const restoredAgain = State.create();
  assert.equal(Save.restore(restoredAgain, galaxy(), Save.load(storage)), true);
  assert.deepEqual(plain(restoredAgain.surfaceBuildings.map(building => building.id)), ['factory-1'],
    'the next autosave retains buildings after migration');
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

test('extractors stand anywhere on land and record the richest material of the ground they drain', () => {
  const placementContext = vm.createContext({});
  for (const relative of ['data/resources.js', 'data/buildings.js', 'data/roads.js', 'simulation/buildings.js',
    'simulation/roadGeometry.js', 'gameplay/buildingPlacement.js']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), placementContext);
  }
  const { OrbitBuildingPlacement: Placement, OrbitBuildingData: Buildings } = placementContext;
  // An 80 × 60 map: land on the left quarter, deep sea beyond. The ground is
  // copper-rich in its top half and iron-rich below; oil lies offshore.
  const width = 80, height = 60, ids = ['iron', 'copper', 'silicon', 'carbon', 'oil'];
  const elevation = new Uint8Array(width * height), shares = new Uint8Array(width * height * ids.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const cell = y * width + x, land = x < 20;
    elevation[cell] = land ? 130 : 60;
    if (!land) shares[cell * 5 + 4] = 51;
    else if (y < 30) { shares[cell * 5 + 1] = 38; shares[cell * 5] = 13; } else shares[cell * 5] = 64;
  }
  const terrain = { width, height, elevation, seaLevel: 102, materials: { ids, shares } };
  const validate = (type, x, y) => Placement.validate({ terrain, textureScale: 3, definition: Buildings.get(type),
    position: { x, y }, planetId: 'p', buildings: [] });

  const copperGround = validate('extractor', 24, 12);
  assert.equal(copperGround.valid, true);
  assert.equal(copperGround.resourceId, 'copper');
  assert.ok(Math.abs(copperGround.resourceShare - .15) < .01);
  assert.ok(copperGround.composition.rock > .7 && copperGround.composition.iron > 0);
  const ironGround = validate('extractor', 24, 150);
  assert.equal(ironGround.valid, true);
  assert.equal(ironGround.resourceId, 'iron');
  // A drill averages its catchment: even across this sharp copper/iron limit
  // (20 % of iron apart), moving it by one cell (3 km) barely changes what it drains.
  for (let y = 75; y <= 105; y += 3) {
    const here = validate('extractor', 24, y).composition, next = validate('extractor', 24, y + 3).composition;
    assert.ok(Math.abs(here.copper - next.copper) < .03 && Math.abs(here.iron - next.iron) < .03, 'drill yield varies smoothly');
  }
  assert.equal(validate('extractor', 90, 30).valid, false, 'extractors still need dry land');
  const platform = validate('oil_platform', 180, 40);
  assert.equal(platform.valid, true);
  assert.equal(platform.resourceId, 'oil');
  assert.ok(Math.abs(platform.resourceShare - .2) < .01);
});
