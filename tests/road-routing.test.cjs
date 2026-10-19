'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of [
  'data/buildings.js', 'data/roads.js', 'simulation/roadNetwork.js',
  'simulation/roadCostField.js', 'simulation/roadPathfinder.js',
  'simulation/roadGeometry.js', 'gameplay/roadPlacement.js'
]) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);
}

function terrainWith(width, height, elevation, seaLevel = 100) {
  return { width, height, elevation, seaLevel };
}

function makeEndpoints(fromX, toX, y) {
  return {
    from: { kind: 'building', buildingId: 'a', point: { x: fromX, y } },
    to: { kind: 'building', buildingId: 'b', point: { x: toX, y } },
    buildings: []
  };
}

function pathLength(points) {
  return points.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
}

test('land roads cross a shallow inlet with a short straight bridge instead of circling it', () => {
  const width = 61, height = 31, elevation = new Uint8Array(width * height).fill(125);
  // A shallow bay cuts into the land route but leaves land around its head.
  for (let y = 7; y <= 23; y++) for (let x = 26; x <= 34; x++) elevation[y * width + x] = 96;
  const terrain = terrainWith(width, height, elevation), textureScale = 3;
  const endpoints = makeEndpoints(20 * textureScale, 40 * textureScale, 15 * textureScale);
  const network = context.OrbitRoadNetwork.create('test-planet');
  const baseField = context.OrbitRoadCostField.createBase(terrain, textureScale);
  const preview = context.OrbitRoadPlacement.previewBetween({ network, terrain, baseField, ...endpoints });

  assert.equal(preview.connected, true, preview.reason);
  assert.ok(pathLength(preview.points) < 1.25 * 60,
    `bridge route should stay near the 60 km direct path, got ${pathLength(preview.points).toFixed(1)} km`);
  assert.ok(preview.surfaceTypes.some(Boolean), 'the route marks its shallow-water span as a bridge');

  const bridgePoints = [];
  for (let index = 0; index < preview.surfaceTypes.length; index++) {
    if (!preview.surfaceTypes[index]) continue;
    bridgePoints.push(preview.points[index], preview.points[index + 1]);
  }
  const bridgeY = bridgePoints.reduce((sum, point) => sum + point.y, 0) / bridgePoints.length;
  assert.ok(Math.max(...bridgePoints.map(point => Math.abs(point.y - bridgeY))) < 5,
    'the shallow-water span should stay nearly straight instead of meandering through the bay');
});

test('deep water remains blocked for a land road', () => {
  const width = 61, height = 31, elevation = new Uint8Array(width * height).fill(125);
  for (let y = 2; y <= 28; y++) for (let x = 26; x <= 27; x++) elevation[y * width + x] = 75;
  const terrain = terrainWith(width, height, elevation), textureScale = 3;
  const endpoints = makeEndpoints(24 * textureScale, 30 * textureScale, 15 * textureScale);
  const baseField = context.OrbitRoadCostField.createBase(terrain, textureScale);
  assert.equal(baseField.blocked[8 * baseField.width + 13], 1, 'deep-water cells stay impassable');
  const preview = context.OrbitRoadPlacement.previewBetween({
    network: context.OrbitRoadNetwork.create('deep-water-test'), terrain, baseField, ...endpoints
  });
  assert.equal(preview.connected, false, 'a land road must not bridge water deeper than the configured limit');
  assert.match(preview.reason, /détour trop long/, 'it should refuse the tempting polar detour instead of circling the planet');
});

test('roads between nearby buildings across the longitude seam stay local and build as two short pieces', () => {
  const width = 61, height = 31, terrain = terrainWith(width, height,
    new Uint8Array(width * height).fill(125), 100), textureScale = 3;
  const baseField = context.OrbitRoadCostField.createBase(terrain, textureScale);
  for (const [fromX, toX] of [[2, 58], [58, 2]]) {
    const endpoints = makeEndpoints(fromX * textureScale, toX * textureScale, 15 * textureScale);
    const network = context.OrbitRoadNetwork.create(`seam-test-${fromX}`);
    const preview = context.OrbitRoadPlacement.previewBetween({ network, terrain, baseField, ...endpoints });

    assert.equal(preview.connected, true, preview.reason);
    assert.ok(pathLength(preview.points) < 1.5 * 12,
      `seam-adjacent route should be local, got ${pathLength(preview.points).toFixed(1)} km`);

    const created = context.OrbitRoadPlacement.createBetween({
      network, terrain, baseField, ...endpoints, preview
    });
    assert.equal(created.connected, true, created.reason);
    assert.equal(created.segments.length, 2, 'the route should split cleanly where longitude wraps');
    assert.ok(created.segments.every(segment => segment.length < 15),
      'neither stored segment should contain a world-spanning seam jump');
  }
  for (const edge of [
    [{ x: 174, y: 45 }, { x: 180, y: 45 }],
    [{ x: 6, y: 45 }, { x: 0, y: 45 }]
  ]) {
    const pieces = context.OrbitRoadGeometry.splitAtLongitudeSeam(edge, [false], 180);
    assert.equal(pieces.length, 1, 'ending exactly at the seam must not create a zero-length segment');
    assert.equal(pieces[0].points.length, 2);
  }
});
