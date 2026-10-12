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
  assert.equal(metrics.secondaryTargetLength, Math.min(
    metrics.primaryLength * context.OrbitSettlementConfig.growth.maxSecondaryToPrimaryRatio,
    context.OrbitSettlementConfig.growth.secondaryRoadLengthPerProductionBuilding));

  const result = context.OrbitSettlementSimulation.grow(settlement, setup);
  assert.equal(result.settlement.roads.length, 1);
  const road = result.settlement.roads[0], factory = setup.buildings[0];
  assert.ok(road.length <= context.OrbitSettlementConfig.growth.secondaryRoadMaxLength);
  assert.ok(road.points.every(point => Math.hypot(point.x - factory.x, point.y - factory.y) <=
    context.OrbitSettlementConfig.growth.productionRoadInfluenceRadius + 1e-6));
});
