'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/random.js'); require('../src/geography.js'); require('../src/world.js');
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
    assert.ok(world.lakes.length >= 1);
    for (const p of world.islands) assert.ok(world.mainland(p.x, p.y) > p.rx);
    for (const p of world.lakes) assert.ok(world.mainland(p.x, p.y) < -.045);
    for (const p of world.peaks) assert.ok(world.mainland(p.x, p.y) < -p.size * .8);
    assert.ok(world.landDistance(-1, 0) > 0 && world.landDistance(1, 0) > 0);
  }
});
test('rivers terminate at water; tributaries join their own main river', () => {
  const endings = new Set();
  for (let seed = 0; seed < 12; seed++) {
    const world = A.createWorld(seed);
    assert.ok(world.rivers.length >= 2, 'springs exist with and without mountain chains');
    for (const river of world.rivers) {
      assert.ok(river.points.length > 2);
      const first = river.points[0], last = river.points.at(-1);
      assert.equal(world.water(first.x, first.y), false);
      if (river.order === 'tributary') {
        assert.equal(river.destination, 'junction');
        const main = world.rivers.find(r => r.order === 'main' && r.basin === river.basin);
        assert.ok(main.points.some(p => Math.hypot(p.x - last.x, p.y - last.y) < 1e-9));
      } else assert.equal(world.water(last.x, last.y), true);
      for (const p of river.points.slice(0, -1)) assert.equal(world.water(p.x, p.y), false);
      endings.add(river.destination);
    }
  }
  assert.ok(endings.has('ocean') && endings.has('junction'));
  for (const ending of endings) assert.ok(['ocean', 'lake', 'junction'].includes(ending));
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
  assert.equal(A.classify(world, .95, 0), A.Terrain.ocean);
  const lake = world.lakes[0]; assert.equal(A.classify(world, lake.x, lake.y), A.Terrain.lake);
  assert.equal(Object.keys(A.Terrain).length, 12);
  assert.equal(A.classify(world, -1, 0), A.classify(world, 1, 0));
});

// Measure the visible topology instead of trusting descriptor counts. Sampling
// can split a one-pixel cape, so only bodies of continental area count here.
function coastlineStats(world, width = 384) {
  const height = width / 2, mask = new Uint8Array(width * height), visited = new Uint8Array(mask.length);
  let area = 0, perimeter = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    mask[i] = world.mainland(x / (width - 1) * 2 - 1, y / (height - 1) * 2 - 1) < 0;
    area += mask[i];
    if (x && mask[i] !== mask[i - 1]) perimeter++;
    if (y && mask[i] !== mask[i - width]) perimeter++;
  }
  const components = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || visited[i]) continue;
    const queue = [i]; visited[i] = 1;
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      for (const next of [at - 1, at + 1, at - width, at + width]) {
        if (next >= 0 && next < mask.length && mask[next] && !visited[next]) {
          visited[next] = 1; queue.push(next);
        }
      }
    }
    components.push(queue.length);
  }
  return {area, perimeter, continents: components.filter(size => size > width * height * .004).length};
}
test('2–3 separate continents survive low, default and extreme coastal settings', () => {
  const counts = new Set();
  for (let seed = 0; seed < 16; seed++) {
    for (const settings of [{}, {continentSize: 0, roughness: 0}, {continentSize: 100, roughness: 100}]) {
      const world = A.createGeography(seed, A.optionsFrom(settings));
      counts.add(world.continents.length);
      assert.equal(coastlineStats(world).continents, world.continents.length, `seed ${seed}: ${JSON.stringify(settings)}`);
      for (let y = -1; y <= 1; y += .05) {
        assert.ok(world.mainland(-1, y) > 0 && world.mainland(1, y) > 0, 'open longitude seam');
      }
    }
  }
  assert.deepEqual([...counts].sort(), [2, 3]);
});
test('the center of every generated continent stays on the visible front hemisphere', () => {
  for (let seed = 0; seed < 48; seed++) {
    for (const continentSize of [0, 50, 100]) {
      const {continents} = A.createGeography(seed, A.optionsFrom({continentSize}));
      assert.ok(continents.every(c => c.core && Math.abs(c.core.x) < .5), `seed ${seed}`);
    }
  }
});
test('extent grows land area; coastal detail increases the average shoreline length', () => {
  let smoothLength = 0, detailedLength = 0;
  for (let seed = 0; seed < 6; seed++) {
    const small = A.createGeography(seed, A.optionsFrom({continentSize: 0}));
    const large = A.createGeography(seed, A.optionsFrom({continentSize: 100}));
    assert.ok(coastlineStats(large).area > coastlineStats(small).area * 1.5);
    smoothLength += coastlineStats(A.createGeography(seed, A.optionsFrom({roughness: 0})), 512).perimeter;
    detailedLength += coastlineStats(A.createGeography(seed, A.optionsFrom({roughness: 100})), 512).perimeter;
  }
  assert.ok(detailedLength > smoothLength * 1.08);
});
test('nearby archipelagos have varying sizes and no overlap with the mainland', () => {
  for (let seed = 0; seed < 8; seed++) {
    const world = A.createWorld(seed), radii = world.islands.map(p => p.rx);
    assert.ok(Math.max(...radii) > Math.min(...radii) * 2);
    assert.ok(world.islands.some(a => world.islands.some(b => a !== b && a.group === b.group)));
    for (const island of world.islands) {
      assert.ok(world.mainland(island.x, island.y) < .115);
      assert.ok(world.landDistance(island.x, island.y) < 0);
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2;
        assert.ok(world.mainland(island.x + Math.cos(a) * island.bound, island.y + Math.sin(a) * island.bound * 2) > 0);
      }
    }
  }
});

test('painted mountain massifs keep a consistent footprint within twenty percent', () => {
  for (let seed = 0; seed < 32; seed++) {
    const world = A.createWorld(seed);
    assert.ok(world.chains.length >= 1, `seed ${seed} should place a massif`);
    const sizes = world.chains.map(chain => chain.size);
    assert.ok(Math.min(...sizes) >= .092 && Math.max(...sizes) <= .108);
    assert.ok(Math.max(...sizes) / Math.min(...sizes) < 1.2, `seed ${seed}: ${sizes}`);
  }
});
