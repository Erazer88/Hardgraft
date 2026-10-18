'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
context.OrbitWorld = {
  hashSeed(value) {
    let hash = 2166136261;
    for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return hash >>> 0;
  },
  rng(seed) {
    let value = seed >>> 0;
    return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
  }
};
for (const relative of ['data/buildings.js', 'data/roads.js', 'data/settlements.js',
  'simulation/roadCostField.js', 'simulation/roadPathfinder.js', 'simulation/roadGeometry.js',
  'simulation/settlements.js']) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);
}

function makeNetwork(withFactory) {
  const start = { id: 'start', x: 50, y: 150, ...(withFactory ? { buildingId: 'factory-1' } : {}) };
  return { nodes: [start, { id: 'end', x: 650, y: 150 }], segments: [{
    id: 'main-1', routeId: 'main-1', from: start.id, to: 'end', routeType: 'land', roadClass: 'main',
    points: [{ x: 50, y: 150 }, { x: 650, y: 150 }], length: 600, builtLength: 600
  }] };
}

function options(withFactory) {
  const terrain = { width: 250, height: 100, seaLevel: 0, elevation: new Uint8Array(25000).fill(100) };
  const buildings = withFactory ? [{ id: 'factory-1', type: 'factory', x: 50, y: 150,
    constructionState: 'complete', rotation: 0 }] : [];
  return { planetId: 'planet-1', seed: 42, network: makeNetwork(withFactory), buildings,
    terrain, baseField: context.OrbitRoadCostField.createBase(terrain, 3) };
}

test('secondary roads require a connected land producer instead of growing into empty terrain', () => {
  const setup = options(false), settlement = context.OrbitSettlementSimulation.create(setup.planetId);
  settlement.generatedStage = 3;
  settlement.roads.push({ id: 'old-remote-road', length: 250, builtLength: 250,
    points: [{ x: 300, y: 150 }, { x: 550, y: 150 }] });
  settlement.houses.push({ id: 'old-house', roadId: 'old-remote-road' });
  const result = context.OrbitSettlementSimulation.grow(settlement, setup);
  assert.equal(result.settlement.roads.length, 0);
  assert.equal(result.settlement.houses.length, 0);
  assert.equal(result.settlement.generatedStage, 0);
  assert.equal(context.OrbitSettlementSimulation.growthMetrics(setup.network, setup.buildings, settlement)
    .secondaryTargetLength, 0);
});

test('secondary road budget and geometry stay local to the production building', () => {
  const setup = options(true), settlement = context.OrbitSettlementSimulation.create(setup.planetId);
  const metrics = context.OrbitSettlementSimulation.growthMetrics(setup.network, setup.buildings, settlement);
  assert.equal(metrics.secondaryTargetLength,
    context.OrbitSettlementConfig.growth.secondaryRoadLengthPerProductionBuilding);

  let result = context.OrbitSettlementSimulation.grow(settlement, setup);
  for (let attempt = 0; attempt < 8; attempt++) {
    for (const road of result.settlement.roads) road.builtLength = road.length;
    const previousCount = result.settlement.roads.length;
    result = context.OrbitSettlementSimulation.grow(result.settlement, setup);
    if (result.settlement.roads.length === previousCount) break;
  }

  assert.ok(result.settlement.roads.length >= 3, 'one connected producer should generate several feeder routes');
  assert.ok(result.settlement.neighborhoods.length >= 1);
  assert.ok(result.settlement.roads.reduce((sum, road) => sum + road.length, 0) <=
    metrics.secondaryTargetLength + 1e-6);
  assert.ok(result.settlement.roads.every(road => road.neighborhoodId && road.fromNode && road.toNode));
  assert.ok(result.settlement.roads.some(road => road.roadClass === 'collector'));
  assert.ok(result.settlement.roads.some(road => road.roadClass === 'local'));
  const connector = result.settlement.roads.find(road => road.type === 'connector');
  assert.ok(connector,
    'a neighborhood should form a connected local loop when a suitable tie exists');
  assert.equal(connector.fromNode.kind, 'street');
  assert.equal(connector.toNode.kind, 'street');
  const factory = setup.buildings[0];
  for (const road of result.settlement.roads) {
    assert.ok(road.length <= context.OrbitSettlementConfig.growth.secondaryRoadMaxLength);
    assert.ok(road.points.every(point => Math.hypot(point.x - factory.x, point.y - factory.y) <=
      context.OrbitSettlementConfig.growth.productionRoadInfluenceRadius + 1e-6));
  }
  assert.deepEqual([...new Set(result.settlement.houses.map(house => house.asset))].sort(), [
    'assets/settlements/maison_01.webp', 'assets/settlements/maison_02.webp', 'assets/settlements/maison_03.webp'
  ]);
  assert.ok(result.settlement.houses.every(house => house.neighborhoodId));
  assert.ok(result.settlement.districts.some(district => district.asset.endsWith('carrefour_T.webp')));
});

test('neighborhood road growth stays deterministic and land-bound across relief profiles and seeds', () => {
  const profiles = [
    { seed: 41, elevationAt: () => 110, seaLevel: 0 },
    { seed: 'rolling-reef', elevationAt: (x, y) => 105 + Math.round(32 *
      (1 + Math.sin(x * .19) * Math.cos(y * .13))), seaLevel: 0 },
    { seed: 912, elevationAt: (x, y) => x > 60 && y > 28 && y < 70
      ? 70 : 105 + Math.round(48 * Math.abs(Math.sin((x + y) * .11))), seaLevel: 90 }
  ];

  for (const profile of profiles) {
    const setup = options(true);
    setup.seed = profile.seed;
    setup.terrain.seaLevel = profile.seaLevel;
    for (let y = 0; y < setup.terrain.height; y++) for (let x = 0; x < setup.terrain.width; x++) {
      setup.terrain.elevation[y * setup.terrain.width + x] = profile.elevationAt(x, y);
    }
    setup.baseField = context.OrbitRoadCostField.createBase(setup.terrain, 3);

    const generate = () => {
      let settlement = context.OrbitSettlementSimulation.create(setup.planetId);
      for (let attempt = 0; attempt < 8; attempt++) {
        const previousCount = settlement.roads.length;
        settlement = context.OrbitSettlementSimulation.grow(settlement, setup).settlement;
        if (settlement.roads.length === previousCount) break;
        for (const road of settlement.roads) road.builtLength = road.length;
      }
      return settlement;
    };
    const first = generate(), repeated = generate();
    const signature = settlement => JSON.stringify({
      roads: settlement.roads.map(road => ({ type: road.type, roadClass: road.roadClass,
        points: road.points, fromNode: road.fromNode, toNode: road.toNode })),
      houses: settlement.houses.map(house => ({ x: house.x, y: house.y, asset: house.asset }))
    });

    assert.ok(first.roads.length > 0, `seed ${profile.seed} creates local roads`);
    assert.equal(signature(first), signature(repeated), `seed ${profile.seed} reproduces the same neighborhood`);
    const producer = setup.buildings[0];
    for (const road of first.roads) {
      assert.ok(road.points.every(point => Math.hypot(point.x - producer.x, point.y - producer.y) <=
        context.OrbitSettlementConfig.growth.productionRoadInfluenceRadius + 1e-6),
      `seed ${profile.seed} keeps roads inside the production area`);
      assert.ok(road.points.every(point => context.OrbitRoadGeometry.elevationAt(
        setup.terrain, 3, point.x, point.y) > setup.terrain.seaLevel),
      `seed ${profile.seed} does not route local streets through water`);
    }
  }
});

test('district topology retains stable identifiers for village and city road models', () => {
  const simulation = context.OrbitSettlementSimulation;
  const expected = [];
  assert.equal(simulation.modelAssets.houses.length, 3);
  assert.equal(simulation.modelAssets.districts.length, 6);
  for (const urban of [false, true]) for (const degree of [2, 3, 4]) {
    const asset = simulation.districtAssetForTopology(degree, urban);
    expected.push(asset);
    assert.ok(simulation.modelAssets.districts.includes(asset));
  }
  assert.equal(new Set(expected).size, 6);
  assert.ok(expected.every(asset => asset.startsWith('assets/settlements/')),
    'legacy asset identifiers remain available to saved settlement records');
});

test('four-way road junctions use the city crossing model', () => {
  const setup = options(false), center = { id: 'junction-0', x: 375, y: 150 };
  const ends = [{ id: 'junction-n', x: 375, y: 50 }, { id: 'junction-e', x: 475, y: 150 },
    { id: 'junction-s', x: 375, y: 250 }, { id: 'junction-w', x: 275, y: 150 }];
  setup.network = { nodes: [center, ...ends], segments: ends.map((end, index) => ({
    id: `spoke-${index}`, routeId: `spoke-${index}`, from: center.id, to: end.id,
    routeType: 'land', roadClass: 'main', points: [center, end], length: 100, builtLength: 100
  })) };
  const settlement = context.OrbitSettlementSimulation.grow(
    context.OrbitSettlementSimulation.create(setup.planetId), setup).settlement;
  const crossing = settlement.districts.find(district => district.id === 'main-junction:junction-0');
  assert.ok(crossing);
  assert.equal(crossing.degree, 4);
  assert.ok(crossing.asset.endsWith('ville_carrefour_croix.webp'));
});

test('older settlement saves migrate their roads into neighborhood nodes without losing construction', () => {
  const setup = options(true), settlement = context.OrbitSettlementSimulation.create(setup.planetId);
  settlement.version = 7;
  settlement.generatedStage = 1;
  settlement.roads.push({ id: 'planet-1:settlement-road:1', type: 'branch', routeId: 'main-1',
    points: [{ x: 100, y: 150 }, { x: 110, y: 205 }],
    anchor: { x: 100, y: 150 }, endpoint: { x: 110, y: 205 }, length: 56, builtLength: 20 });

  const result = context.OrbitSettlementSimulation.grow(settlement, setup).settlement;
  assert.equal(result.roads.length, 1);
  assert.ok(result.roads[0].neighborhoodId);
  assert.equal(result.roads[0].builtLength, 20);
  assert.ok(result.neighborhoods.some(neighborhood => neighborhood.roadIds.includes(result.roads[0].id)));
  assert.ok(result.houses.every(house => house.neighborhoodId === result.roads[0].neighborhoodId));
});

test('secondary road construction speed is five times the former 4.2 km/s rate', () => {
  const settlement = context.OrbitSettlementSimulation.create('planet-1');
  settlement.roads.push({ id: 'test-road', length: 100, builtLength: 0 });
  assert.equal(context.OrbitSettlementConfig.construction.secondarySpeed, 21);
  context.OrbitSettlementSimulation.advance({ 'planet-1': settlement }, 1);
  assert.equal(settlement.roads[0].builtLength, 21);
});
