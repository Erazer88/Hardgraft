'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/random.js'); require('../src/world.js');
const A = globalThis.NereideAtlas;
const signature = world => JSON.stringify(world);

test('a seed and its settings reproduce all placements, coast samples and rivers', () => {
  for (const seed of [0, 1, 0x4E455245, 0xFFFFFFFF]) {
    const a = A.createWorld(seed), b = A.createWorld(A.formatSeed(seed));
    assert.equal(signature(a), signature(b));
    for (let i = 0; i < 20; i++) assert.equal(a.landDistance(i / 20 - .5, i / 10 - 1), b.landDistance(i / 20 - .5, i / 10 - 1));
  }
  assert.notEqual(signature(A.createWorld(0)), signature(A.createWorld(1)));
});
test('seed zero, hexadecimal and named seeds are accepted without time dependence', () => {
  assert.equal(A.parseSeed('00000000'), 0);
  assert.equal(A.parseSeed('0x4e455245'), 0x4E455245);
  assert.equal(A.parseSeed('Arche / Néréide'), A.parseSeed('Arche / Néréide'));
  assert.throws(() => A.parseSeed('  '));
});
test('islands are separated from the main continent; lakes and peaks stay inland', () => {
  for (let seed = 0; seed < 12; seed++) {
    const world = A.createWorld(seed);
    assert.ok(world.islands.length >= 5);
    assert.ok(world.lakes.length >= 2);
    for (const p of world.islands) assert.ok(world.mainland(p.x, p.y) > p.rx);
    for (const p of world.lakes) assert.ok(world.mainland(p.x, p.y) < -.045);
    for (const p of world.peaks) assert.ok(world.mainland(p.x, p.y) < -p.size * .8);
    assert.ok(world.landDistance(-1, 0) > 0 && world.landDistance(1, 0) > 0);
  }
});
test('every river starts on land and terminates at an actual sea or lake boundary', () => {
  const endings = new Set();
  for (let seed = 0; seed < 12; seed++) {
    const world = A.createWorld(seed);
    assert.ok(world.rivers.length >= 2, 'springs exist with and without mountain chains');
    for (const river of world.rivers) {
      assert.ok(river.points.length > 2);
      const first = river.points[0], last = river.points.at(-1);
      assert.equal(world.water(first.x, first.y), false);
      assert.equal(world.water(last.x, last.y), true);
      for (const p of river.points.slice(0, -1)) assert.equal(world.water(p.x, p.y), false);
      endings.add(river.destination);
    }
  }
  assert.deepEqual([...endings].sort(), ['lake', 'ocean']);
});
test('zero sliders remove mountains and forests; each control changes its intended layer', () => {
  const empty = A.createWorld(0, {mountains: 0, forests: 0});
  assert.equal(empty.peaks.length, 0); assert.equal(empty.chains.length, 0); assert.equal(empty.trees.length, 0);
  assert.equal(empty.forestZones.length, 0); assert.ok(empty.rivers.length > 0);
  const world = A.createWorld(0);
  assert.ok(world.peaks.length > 10 && world.trees.length > 20);
  const forestChange = A.createWorld(0, {forests: 10});
  assert.deepEqual(world.peaks, forestChange.peaks);
  assert.deepEqual(world.islands, forestChange.islands);
  assert.notDeepEqual(world.trees, forestChange.trees);
  assert.notEqual(world.mainland(.2, 0), A.createWorld(0, {roughness: 0}).mainland(.2, 0));
});
test('all terrain classes are explicit and queryable without Canvas or DOM', () => {
  const world = A.createWorld(0);
  assert.equal(A.classify(world, .95, .9), A.Terrain.ocean);
  const lake = world.lakes[0]; assert.equal(A.classify(world, lake.x, lake.y), A.Terrain.lake);
  assert.equal(Object.keys(A.Terrain).length, 11);
  assert.equal(A.classify(world, -1, 0), A.classify(world, 1, 0));
});
