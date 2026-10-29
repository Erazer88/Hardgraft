'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/developerSettings.js', 'data/config.js', 'data/resources.js', 'data/orbitalLogistics.js',
  'data/worldgen.js', 'data/buildings.js', 'world.js',
  'data/roads.js', 'data/colony.js', 'data/progression.js', 'simulation/simulation.js', 'simulation/inventory.js',
  'simulation/composition.js', 'simulation/colony.js',
  'simulation/buildings.js', 'simulation/construction.js', 'simulation/roadNetwork.js',
  'simulation/logisticsNetwork.js', 'simulation/orbitalTransit.js',
  'gameplay/exploration.js', 'gameplay/progression.js', 'state.js', 'storage/save.js',
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

test('saves keep the colony, context and unlocks; saves from before the colony start a new game', () => {
  const state = State.create(), world = galaxy();
  const colony = context.OrbitSurfaceBuilding.create({ id: 'colony-1', type: 'colony', planetId: 'planet-1',
    x: 20, y: 30, constructionState: 'complete' });
  colony.colony.population = 200; colony.colony.tier = 1; colony.colony.cells = [5, 6, 7];
  colony.inventory = { tar: 4 };
  state.surfaceBuildings = [colony];
  state.contextPoints = 12.5;
  state.unlocks = { steps: ['landing', 'rock'], buildings: ['colony', 'extractor'], cards: ['drill'] };
  let stored;
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  assert.equal(Save.save(storage, state, world), true);
  const saved = Save.load(storage);
  assert.equal(saved.version, Config.saveVersion);
  const restored = State.create();
  assert.equal(Save.restore(restored, galaxy(), saved), true);
  assert.deepEqual(plain(restored.surfaceBuildings[0].colony), plain(colony.colony));
  assert.equal(restored.contextPoints, 12.5);
  assert.deepEqual(plain(restored.unlocks), plain(state.unlocks));
  assert.equal(restored.context, null, 'the navigation context is untouched');

  stored = JSON.stringify({ ...saved, version: 9 });
  assert.equal(Save.load(storage), null, 'a save from before the colony starts a new game');
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

test('a pumping station needs a shore and pumps salt water by the sea, fresh water by a lake', () => {
  const placementContext = vm.createContext({});
  for (const relative of ['data/resources.js', 'data/buildings.js', 'data/roads.js', 'simulation/buildings.js',
    'simulation/roadGeometry.js', 'gameplay/buildingPlacement.js']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), placementContext);
  }
  const { OrbitBuildingPlacement: Placement, OrbitBuildingData: Buildings } = placementContext;
  // Land on the left half with a lake in its middle; the sea on the right.
  const width = 80, height = 60, elevation = new Uint8Array(width * height), features = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const cell = y * width + x, lake = Math.hypot(x - 15, y - 30) < 5;
    elevation[cell] = x < 40 && !lake ? 130 : 90;
    if (lake) features[cell] = 1;
  }
  const terrain = { width, height, elevation, features, seaLevel: 102 };
  const validate = (x, y) => Placement.validate({ terrain, textureScale: 3, definition: Buildings.get('water_station'),
    position: { x, y }, planetId: 'p', buildings: [] });
  const sea = validate(105, 120);
  assert.equal(sea.valid, true, sea.reason);
  assert.equal(sea.resourceId, 'salt_water');
  const lake = validate(45, 120);
  assert.equal(lake.valid, true, lake.reason);
  assert.equal(lake.resourceId, 'water');
  const inland = validate(75, 30);
  assert.equal(inland.valid, false, 'no water within reach');
  assert.match(inland.reason, /mer, un lac ou une rivière/);
});

test('there is only one colony, and nothing is built inside its zone', () => {
  const placementContext = vm.createContext({});
  for (const relative of ['data/resources.js', 'data/buildings.js', 'data/roads.js', 'simulation/buildings.js',
    'simulation/roadGeometry.js', 'gameplay/buildingPlacement.js']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), placementContext);
  }
  const { OrbitBuildingPlacement: Placement, OrbitBuildingData: Buildings } = placementContext;
  const width = 60, height = 40, terrain = { width, height, elevation: new Uint8Array(width * height).fill(140), seaLevel: 102 };
  const validate = (type, x, buildings) => Placement.validate({ terrain, textureScale: 3, definition: Buildings.get(type),
    position: { x, y: 60 }, planetId: 'p', buildings });
  assert.equal(validate('colony', 90, []).valid, true);
  const elsewhere = validate('colony', 90, [{ type: 'colony', planetId: 'other', x: 0, y: 0 }]);
  assert.equal(elsewhere.valid, false, 'one colony in the whole game');
  const cells = [];
  for (let y = 15; y <= 25; y++) for (let x = 25; x <= 35; x++) cells.push(y * width + x);
  const colony = { type: 'colony', planetId: 'p', x: 90, y: 60, colony: { cells } };
  const inside = validate('extractor', 95, [colony]);
  assert.equal(inside.valid, false);
  assert.match(inside.reason, /dans la colonie/);
  assert.equal(validate('extractor', 150, [colony]).valid, true);
});
test('launch platforms spend less energy near the equator', () => {
  const logisticsContext = vm.createContext({});
  for (const relative of ['data/config.js', 'data/resources.js', 'data/orbitalLogistics.js']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), logisticsContext);
  }
  const { OrbitOrbitalLogisticsData: Logistics, OrbitConfig: Settings } = logisticsContext;
  const mapHeight = Settings.terrain.height * Settings.terrain.textureScale;
  assert.equal(Logistics.latitudeAt(mapHeight / 2, mapHeight), 0);
  assert.equal(Logistics.latitudeAt(0, mapHeight), Logistics.launchSite.latitudeExtentDegrees);
  assert.equal(Logistics.latitudeAt(mapHeight, mapHeight), -Logistics.launchSite.latitudeExtentDegrees);
  const equator = Logistics.launchEnergyMW(0), tropic = Logistics.launchEnergyMW(-20), pole = Logistics.launchEnergyMW(75);
  assert.equal(equator, Logistics.launchSite.equatorEnergyMW);
  assert.ok(equator < tropic && tropic < pole, 'launch energy grows with latitude, north or south');
  assert.equal(Logistics.launchEnergyMW(20), tropic);
});

test('a land road bridges a narrow strait between two shores, but not a wide sea', () => {
  const roadContext = vm.createContext({});
  for (const relative of ['data/config.js', 'data/resources.js', 'data/buildings.js', 'data/roads.js',
    'simulation/roadCostField.js', 'simulation/roadPathfinder.js', 'simulation/roadGeometry.js']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), roadContext);
  }
  const { OrbitRoadCostField: Field, OrbitRoadPathfinder: Pathfinder, OrbitRoadGeometry: Geometry } = roadContext;
  const scale = 3, width = 120, height = 60;
  const strait = gap => {
    const elevation = new Uint8Array(width * height).fill(130);
    for (let y = 0; y < height; y++) for (let x = 60 - gap / 2; x < 60 + gap / 2; x++) elevation[y * width + x] = 60;
    const terrain = { width, height, seaLevel: 102, elevation, relief: elevation, rivers: [] };
    const base = Field.createBase(terrain, scale), from = { x: 60, y: 90 }, to = { x: 300, y: 90 };
    const field = Field.withNetwork(base, null, [], [from, to], null, {});
    return Geometry.create(Pathfinder.findPath(field, terrain, from, to), terrain, scale, [], { bridgeField: base });
  };
  assert.ok(strait(10), 'a 30 km strait is bridged');
  assert.equal(strait(40), null, 'a 120 km sea is not');
});

test('roads wind up steep slopes and cross drawn rivers once, on a bridge', () => {
  const roadContext = vm.createContext({});
  for (const relative of ['data/config.js', 'data/resources.js', 'data/buildings.js', 'data/roads.js',
    'simulation/roadCostField.js', 'simulation/roadPathfinder.js', 'simulation/roadGeometry.js']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), roadContext);
  }
  const { OrbitRoadCostField: Field, OrbitRoadPathfinder: Pathfinder, OrbitRoadGeometry: Geometry } = roadContext;
  const scale = 3, width = 120, height = 90;
  const route = (terrain, from, to) => {
    const base = Field.createBase(terrain, scale);
    const field = Field.withNetwork(base, null, [], [from, to], null, {});
    return Geometry.create(Pathfinder.findPath(field, terrain, from, to), terrain, scale, [], {});
  };
  const heightAt = (terrain, point) => terrain.relief[Math.round(point.y / scale) * width + Math.round(point.x / scale)];

  // A steep ramp, 4 height units per cell northward: the road climbs at a
  // gentler grade than the slope by running across it.
  const ramp = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) ramp[y * width + x] = Math.min(250, 110 + (height - 1 - y) * 1.6);
  const rampTerrain = { width, height, seaLevel: 102, elevation: ramp, relief: ramp, rivers: [] };
  const climb = route(rampTerrain, { x: 180, y: 240 }, { x: 180, y: 30 });
  assert.ok(climb, 'a route climbs the ramp');
  let length = 0;
  for (let i = 1; i < climb.points.length; i++) length += Math.hypot(climb.points[i].x - climb.points[i - 1].x, climb.points[i].y - climb.points[i - 1].y);
  const rise = Math.abs(heightAt(rampTerrain, climb.points[climb.points.length - 1]) - heightAt(rampTerrain, climb.points[0]));
  assert.ok(length > 210 * 1.3, 'the road is longer than the straight climb');
  assert.ok(rise / (length / scale) < 1.6 * .8, 'its mean grade is gentler than the slope');

  // Flat land split by a drawn river along x = 60: one crossing only.
  const flat = new Uint8Array(width * height).fill(120), points = [], flows = [];
  for (let y = 0; y < height; y++) { points.push(60, y); flows.push(8); }
  const riverTerrain = { width, height, seaLevel: 102, elevation: flat, relief: flat, rivers: [{ points, flows }] };
  const crossing = route(riverTerrain, { x: 90, y: 60 }, { x: 270, y: 210 });
  assert.ok(crossing, 'a route crosses the river');
  let entries = 0, wasRiver = false;
  for (const point of crossing.points) {
    const river = Math.round(point.x / scale) === 60;
    if (river && !wasRiver) entries++;
    wasRiver = river;
  }
  assert.equal(entries, 1, 'the river is crossed once');
});

test('sea lanes round a continent offshore and stop at enclosed lakes', () => {
  const seaContext = vm.createContext({});
  for (const relative of ['data/config.js', 'data/resources.js', 'data/buildings.js', 'data/roads.js',
    'simulation/roadCostField.js', 'simulation/roadPathfinder.js']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), seaContext);
  }
  const { OrbitRoadCostField: Field, OrbitRoadPathfinder: Pathfinder } = seaContext;
  // Open sea with a long continent across the middle, holding a lake.
  const width = 160, height = 120, elevation = new Uint8Array(width * height).fill(80);
  for (let y = 20; y < 100; y++) for (let x = 60; x < 100; x++) elevation[y * width + x] = 140;
  for (let y = 50; y < 60; y++) for (let x = 75; x < 85; x++) elevation[y * width + x] = 90;
  const terrain = { width, height, seaLevel: 102, elevation, relief: elevation, rivers: [] };
  const field = Field.createMarine(Field.createBase(terrain, 3));
  const west = { x: 40 * 3, y: 60 * 3 }, east = { x: 120 * 3, y: 60 * 3 };
  const lane = Pathfinder.findPath(field, terrain, west, east);
  assert.ok(lane, 'a lane rounds the continent');
  let length = 0, nearShore = 0;
  for (let i = 1; i < lane.length; i++) length += Math.hypot(lane[i].x - lane[i - 1].x, lane[i].y - lane[i - 1].y);
  for (const point of lane) {
    const x = Math.round(point.x / 3), y = Math.round(point.y / 3);
    assert.ok(elevation[y * width + x] <= 102, 'the lane stays at sea');
    if (x >= 57 && x <= 102 && y >= 17 && y <= 102) nearShore++;
  }
  assert.ok(length > 240 * 1.5, 'the lane goes around rather than across');
  assert.ok(nearShore / lane.length < .2, 'the lane keeps off the shore');
  assert.equal(Pathfinder.findPath(field, terrain, west, { x: 80 * 3, y: 55 * 3 }), null, 'an enclosed lake is not reachable');
});

test('buildings are named per type across the whole game, and older buildings get a name', () => {
  const namesContext = vm.createContext({});
  for (const relative of ['data/resources.js', 'data/buildings.js', 'gameplay/buildingNames.js']) {
    vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), namesContext);
  }
  const Names = namesContext.OrbitBuildingNames;
  const state = { surfaceBuildings: [
    { type: 'factory', planetId: 'a', customName: 'Usine 4' },
    { type: 'factory', planetId: 'b', customName: null },
    { type: 'launch_platform', planetId: 'b', customName: 'Mon port spatial' }] };
  Names.ensureNames(state);
  assert.equal(state.surfaceBuildings[1].customName, 'Usine 5', 'counts go on from the highest default name');
  assert.equal(Names.nextName(state, 'factory'), 'Usine 6');
  assert.equal(Names.nextName(state, 'launch_platform'), 'Plateforme de lancement 1');
  assert.equal(Names.clean('   '), null);
  assert.equal(Names.clean('  Forge   du   nord '), 'Forge du nord');
});
