'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const context = vm.createContext({});
for (const file of ['/data/worldgen.js', '/world.js', '/world/system.js']) {
  vm.runInContext(fs.readFileSync(__dirname + file, 'utf8'), context);
}
const world = context.OrbitWorld;
const serialize = value => JSON.stringify(value);
const materialPeak = (terrain, id) => {
  const { ids, shares } = terrain.materials, kind = ids.indexOf(id);
  let peak = 0;
  for (let cell = 0; cell < terrain.elevation.length; cell += 1) peak = Math.max(peak, shares[cell * ids.length + kind] / 255);
  return peak;
};

test('the galaxy is deterministic, seeded, and dense in four connected arms', () => {
  const galaxy = world.createGalaxy('NEREIDE-01');
  assert.equal(serialize(galaxy), serialize(world.createGalaxy('NEREIDE-01')));
  assert.notEqual(serialize(galaxy), serialize(world.createGalaxy('other-universe')));
  assert.ok(galaxy.systems.length >= 1800);
  assert.equal(new Set(galaxy.systems.map(system => system.id)).size, galaxy.systems.length);
  assert.equal(galaxy.systems.find(system => system.id === galaxy.homeId).name, 'Néréide');
  for (let arm = 0; arm < 4; arm += 1) {
    const members = galaxy.systems.filter(system => system.arm === arm);
    assert.ok(members.length >= 400);
    assert.ok(members.some(system => Math.hypot(system.x, system.y) < 850));
    assert.ok(members.some(system => Math.hypot(system.x, system.y) > 4400));
  }
  assert.ok(galaxy.systems.every(system => Math.hypot(system.x, system.y) <= galaxy.radius));
  assert.ok(galaxy.systems.filter(system => system.discovered).length > 8);
  assert.ok(galaxy.systems.filter(system => system.discovered).length < galaxy.systems.length / 5);
});

test('planet positions stay on ordered orbits and obey relative Kepler periods', () => {
  const galaxy = world.createGalaxy('NEREIDE-01');
  const system = world.createSystem(galaxy.seed, galaxy.homeId);
  assert.equal(serialize(system), serialize(world.createSystem(galaxy.seed, galaxy.homeId)));
  assert.ok(system.planets.length >= 4 && system.planets.length <= 6);
  assert.equal(system.name, 'Néréide');
  let previous = 0;
  const keplerConstant = system.planets[0].speed * Math.pow(system.planets[0].orbit, 1.5);
  for (const planet of system.planets) {
    assert.ok(planet.orbit > previous && planet.orbit > system.star.radius + planet.radius);
    previous = planet.orbit;
    assert.ok(Math.abs(planet.speed * Math.pow(planet.orbit, 1.5) - keplerConstant) < 1e-8);
    for (const time of [0, 60, 100000]) {
      const position = world.planetPosition(planet, time);
      assert.ok(Math.abs(Math.hypot(position.x, position.y) - planet.orbit) < 1e-8);
    }
  }
  assert.notEqual(serialize(system.planets), serialize(world.createSystem(galaxy.seed, 's-1').planets));
});

test('system population is deterministic, configurable, and mostly ordinary', () => {
  const galaxy = world.createGalaxy('distribution-v2');
  const counts = new Map(), beltCounts = new Set(), layouts = new Set(), kinds = new Set();
  let ordinary = 0, wrecks = 0;
  for (const star of galaxy.systems) {
    const model = world.createSystem(galaxy.seed, star.id, galaxy);
    assert.equal(serialize(model), serialize(world.createSystem(galaxy.seed, star.id, galaxy)));
    counts.set(model.planets.length, (counts.get(model.planets.length) || 0) + 1);
    beltCounts.add(model.debris.length); layouts.add(model.layout);
    model.planets.forEach(planet => kinds.add(planet.kind));
    if (model.planets.length >= 3 && model.planets.length <= 6) ordinary++;
    if (model.wreck) wrecks++;
    assert.ok(Number.isFinite(model.extent) && model.extent > model.star.radius);
    for (let i = 0; i < model.planets.length; i++) {
      const planet = model.planets[i];
      assert.ok(planet.name && !planet.name.includes('undefined'));
      assert.ok(planet.orbit - planet.radius > model.star.radius);
      assert.ok(planet.orbit + planet.radius < model.extent);
      for (const key of ['temperature', 'pressure', 'gravity', 'geology', 'water', 'surfaceWater', 'terrainWater', 'habitability', 'distanceAU']) {
        assert.ok(Number.isFinite(planet[key]), key + ' is finite');
      }
      assert.ok(planet.water >= 0 && planet.water <= 1 && planet.surfaceWater <= planet.water);
      assert.ok(planet.habitability >= 0 && planet.habitability <= 1);
      for (const id of ['iron', 'copper', 'silicon', 'carbon', 'oil']) {
        assert.ok(planet.resources[id] > 0 && planet.resources[id] <= 1, id + ' richness index');
      }
      if (planet.kind === 'gazeuse') {
        assert.equal(planet.surfaceWater, 0); assert.equal(planet.terrainWater, 0); assert.equal(planet.habitability, 0);
      }
      if (i) {
        const previous = model.planets[i - 1];
        assert.ok(planet.orbit - previous.orbit > planet.radius + previous.radius);
        assert.ok(planet.distanceAU > previous.distanceAU);
        assert.ok(Math.abs(planet.speed / previous.speed - Math.pow(previous.distanceAU / planet.distanceAU, 1.5)) < 1e-8);
      }
    }
    for (const belt of model.debris) {
      assert.ok(belt.orbit - belt.width > model.star.radius);
      assert.ok(belt.orbit + belt.width < model.extent);
      for (const planet of model.planets) assert.ok(Math.abs(planet.orbit - belt.orbit) > planet.radius + belt.width);
    }
  }
  assert.deepEqual([...counts.keys()].sort((a, b) => a - b), Array.from({ length: 11 }, (_, i) => i));
  assert.deepEqual([...beltCounts].sort(), [0, 1, 2, 3]);
  assert.equal(layouts.size, 3);
  for (const kind of ['gazeuse', 'tellurique', 'glacée', 'aride', 'océanique']) assert.ok(kinds.has(kind), kind);
  assert.ok(ordinary / galaxy.systems.length > .5 && ordinary / galaxy.systems.length < .75);
  assert.ok(wrecks > 0 && wrecks < galaxy.systems.length * .25);

  const settings = JSON.parse(serialize(context.OrbitWorldgenData));
  settings.planetCounts = [1]; settings.beltCounts = [1]; settings.wreckChance = 0;
  const target = galaxy.systems.find(star => star.id !== galaxy.homeId);
  const empty = world.createSystem(galaxy.seed, target.id, galaxy, settings);
  assert.equal(empty.planets.length, 0); assert.equal(empty.debris.length, 0); assert.equal(empty.wreck, null);
  settings.planetCounts = Array(13).fill(0); settings.planetCounts[12] = 1;
  const rich = world.createSystem(galaxy.seed, target.id, galaxy, settings);
  assert.equal(rich.planets.length, 12); assert.ok(rich.planets.at(-1).name.endsWith('XII'));
  assert.notEqual(serialize(rich), serialize(empty));
  assert.ok(world.createSystem(galaxy.seed, galaxy.homeId, galaxy, settings).startingPlanetId);
});

test('planetary climate changes continuously with luminosity, distance and atmosphere', () => {
  const traits = { pressure: 1, water: .5, gravity: 1, geology: .5 };
  const environment = context.OrbitSystemGeneration.environment;
  const sun = context.OrbitWorldgenData.stars.find(star => star.type === 'G');
  const temperate = environment(sun, 1, traits);
  assert.ok(temperate.temperature > 0 && temperate.temperature < 30);
  assert.ok(temperate.habitability > .8);
  assert.ok(environment(sun, .5, traits).temperature > temperate.temperature);
  assert.ok(environment(sun, 2, traits).temperature < temperate.temperature);
  assert.ok(Math.abs(environment(sun, 1.001, traits).temperature - temperate.temperature) < 1);
  assert.ok(environment({ luminosity: .25 }, 1, traits).temperature < temperate.temperature);
  assert.ok(environment({ luminosity: 2.8 }, 1, traits).temperature > temperate.temperature);
  assert.ok(environment(sun, 1, { ...traits, pressure: 3 }).temperature > temperate.temperature);
  assert.equal(environment(sun, 8, traits).surfaceWater, 0);
});

test('the natal system always provides a temperate candidate, water and every basic material', () => {
  for (let i = 0; i < 64; i++) {
    const seed = 'natal-' + i, galaxy = world.createGalaxy(seed);
    const model = world.createSystem(seed, galaxy.homeId, galaxy);
    const planet = model.planets.find(item => item.id === model.startingPlanetId);
    assert.ok(planet && planet.kind === 'tellurique' && planet.startingCandidate);
    assert.ok(planet.temperature > 5 && planet.temperature < 30);
    assert.ok(planet.pressure >= .9 && planet.pressure <= 1.1);
    assert.ok(planet.gravity >= .85 && planet.gravity <= 1.15);
    assert.ok(planet.surfaceWater > .3 && planet.surfaceWater < .65);
    assert.ok(planet.habitability > .65);
    for (const id of ['iron', 'copper', 'silicon', 'carbon']) assert.ok(planet.resources[id] >= .45);
    assert.ok(planet.resources.water > .3);
    if (i < 6) {
      const terrain = world.createTerrain(planet.seed, 96, 72, planet);
      const minimum = context.OrbitWorldgenData.terrain.materials.natalMinimumPeak;
      for (const id of ['iron', 'copper', 'silicon', 'carbon']) {
        assert.ok(materialPeak(terrain, id) >= minimum * .95, `the natal world offers a rich ${id} pocket`);
      }
      const water = terrain.elevation.filter(value => value <= terrain.seaLevel).length / terrain.elevation.length;
      const expectedWater = Math.max(planet.surfaceWater, context.OrbitWorldgenData.terrain.oceanBorder.minimumWater);
      assert.ok(Math.abs(water - expectedWater) < .04);
    }
  }
});

test('surface water follows the planet profile while identical profiles reproduce the map', () => {
  const dry = world.createTerrain('climate-test', 96, 72, { surfaceWater: 0 });
  const wet = world.createTerrain('climate-test', 96, 72, { surfaceWater: .75 });
  const repeated = world.createTerrain('climate-test', 96, 72, { surfaceWater: .75 });
  assert.equal(dry.elevation.filter(value => value <= dry.seaLevel).length, 0);
  const water = wet.elevation.filter(value => value <= wet.seaLevel).length / wet.elevation.length;
  assert.ok(water > .70 && water < .80);
  assert.deepEqual(Array.from(wet.elevation), Array.from(repeated.elevation));
  assert.deepEqual(Array.from(wet.materials.shares), Array.from(repeated.materials.shares));
});

test('terrain contains coherent water, land, and reachable resources for different seeds', () => {
  for (const seed of [0, 1, 'ocean', 'crater', 'Néréide II']) {
    const terrain = world.createTerrain(seed, 160, 120);
    const repeated = world.createTerrain(seed, 160, 120);
    assert.deepEqual(Array.from(terrain.elevation), Array.from(repeated.elevation));
    assert.equal(terrain.elevation.length, terrain.width * terrain.height);
    assert.equal(terrain.moisture.length, terrain.elevation.length);
    const water = terrain.elevation.filter(value => value <= terrain.seaLevel).length;
    assert.ok(water > terrain.elevation.length * 0.2 && water < terrain.elevation.length * 0.6);
    let totalDifference = 0;
    for (let y = 0; y < terrain.height; y += 1) {
      for (let x = 1; x < terrain.width; x += 1) {
        const index = y * terrain.width + x;
        totalDifference += Math.abs(terrain.elevation[index] - terrain.elevation[index - 1]);
      }
    }
    assert.ok(totalDifference / terrain.elevation.length < 9, 'terrain should vary smoothly across neighboring cells');
    const { ids, shares } = terrain.materials;
    assert.deepEqual(Array.from(shares), Array.from(repeated.materials.shares));
    assert.equal(shares.length, terrain.elevation.length * ids.length);
    for (let cell = 0; cell < terrain.elevation.length; cell += 1) {
      const composition = world.materialsAt(terrain, cell);
      assert.ok(composition.rock >= 0 && composition.rock <= 1, 'rock fills what materials leave');
      if (terrain.elevation[cell] > terrain.seaLevel) assert.equal(composition.oil, 0, 'oil lies under the sea');
      else assert.equal(composition.iron + composition.copper + composition.silicon + composition.carbon, 0,
        'land materials stay on land');
    }
  }
  assert.notDeepEqual(Array.from(world.createTerrain('one', 80, 60).elevation),
    Array.from(world.createTerrain('two', 80, 60).elevation));
});

test('materials gather where the ground favors them, richer in hard places and on islands', () => {
  const totals = {};
  const add = (key, value) => { totals[key] ||= { sum: 0, count: 0 }; totals[key].sum += value; totals[key].count += 1; };
  for (let index = 0; index < 5; index += 1) {
    const planet = { kind: 'tellurique', surfaceWater: .4, temperature: 18, seed: 300 + index,
      resources: { iron: .5, copper: .5, silicon: .5, carbon: .5, oil: .5 } };
    const terrain = world.createTerrain('materials-' + index, 320, 240, planet);
    const { width, height, seaLevel, relief, elevation } = terrain;
    const water = cell => elevation[cell] <= seaLevel;
    for (let y = 2; y < height - 2; y += 1) for (let x = 2; x < width - 2; x += 1) {
      const cell = y * width + x, composition = world.materialsAt(terrain, cell);
      if (water(cell)) {
        add(seaLevel - elevation[cell] < 12 ? 'oilShelf' : 'oilDeep', composition.oil);
        continue;
      }
      const above = relief[cell] - seaLevel;
      let nearSea = false;
      for (let dy = -2; dy <= 2 && !nearSea; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        if (water((y + dy) * width + x + dx) && terrain.features[(y + dy) * width + x + dx] !== world.TERRAIN_FEATURES.lake) nearSea = true;
      }
      if (above > 80) { add('ironMountain', composition.iron); add('carbonMountain', composition.carbon); }
      if (above < 8) { add('ironPlain', composition.iron); add('carbonPlain', composition.carbon); }
      add(nearSea ? 'siliconCoast' : 'siliconInland', composition.silicon);
    }
  }
  const mean = key => totals[key].sum / totals[key].count;
  assert.ok(mean('ironMountain') > mean('ironPlain') * 2, 'iron favors mountains');
  assert.ok(mean('carbonPlain') > mean('carbonMountain') * 2, 'carbon favors plains');
  assert.ok(mean('siliconCoast') > mean('siliconInland') * 1.5, 'silica favors coasts');
  assert.ok(mean('oilShelf') > mean('oilDeep'), 'oil gathers on continental shelves');

  // Islands: the same ground is richer on a small island than on a continent.
  const islandWorld = world.createTerrain('materials-islands', 320, 240,
    { kind: 'océanique', surfaceWater: .82, temperature: 18, seed: 41 });
  const continentWorld = world.createTerrain('materials-continents', 320, 240,
    { kind: 'tellurique', surfaceWater: .3, temperature: 18, seed: 41 });
  const landOre = terrain => {
    let ore = 0, cells = 0;
    for (let cell = 0; cell < terrain.elevation.length; cell += 1) {
      if (terrain.elevation[cell] <= terrain.seaLevel) continue;
      const composition = world.materialsAt(terrain, cell);
      ore += 1 - composition.rock; cells += 1;
    }
    return ore / cells;
  };
  assert.ok(landOre(islandWorld) > landOre(continentWorld), 'island worlds hold richer ground');
});

test('ore veins branch from rich nodes over land and enrich the ground they cross', () => {
  const planet = { kind: 'tellurique', surfaceWater: .4, temperature: 18, seed: 77,
    resources: { iron: .7, copper: .5, silicon: .5, carbon: .5, oil: .5 } };
  const terrain = world.createTerrain('veins', 320, 240, planet);
  const again = world.createTerrain('veins', 320, 240, planet);
  const { veins, nodes, ids, shares } = terrain.materials, { width, height, seaLevel, elevation } = terrain;
  assert.equal(serialize(again.materials.veins), serialize(veins), 'veins are deterministic');
  assert.ok(nodes.length >= 3 && veins.length >= nodes.length * 2, 'several nodes each send out branches');
  assert.ok(veins.every(vein => !terrain.materials.ids[vein.kind].startsWith('oil')), 'no vein carries a marine material');
  let onVein = 0, onVeinCount = 0, branched = 0;
  for (const vein of veins) {
    for (let index = 0; index < vein.points.length; index += 2) {
      const x = Math.round(vein.points[index]), y = Math.round(vein.points[index + 1]);
      assert.ok(x >= 0 && y >= 0 && x < width && y < height && elevation[y * width + x] > seaLevel, 'veins stay on land');
      onVein += shares[(y * width + x) * ids.length + vein.kind] / 255; onVeinCount += 1;
    }
    if (!nodes.some(node => node.x === vein.points[0] && node.y === vein.points[1])) branched += 1;
  }
  assert.ok(branched > 0, 'veins split into side branches');
  let ground = 0, groundCount = 0;
  for (let cell = 0; cell < elevation.length; cell += 1) {
    if (elevation[cell] <= seaLevel) continue;
    for (let kind = 0; kind < ids.length; kind += 1) if (ids[kind] !== 'oil') { ground += shares[cell * ids.length + kind] / 255; groundCount += 1; }
  }
  assert.ok(onVein / onVeinCount > ground / groundCount * 3, 'ground along a vein is far richer in its material');
});

test('telluric maps keep their continents inside an open-sea border', () => {
  const border = context.OrbitWorldgenData.terrain.oceanBorder;
  for (const [index, surfaceWater] of [.08, .2, .35, .7].entries()) {
    const planet = { kind: 'tellurique', surfaceWater, temperature: 18, seed: 900 + index };
    const terrain = world.createTerrain('border-' + index, 160, 120, planet);
    const margin = Math.ceil(border.minimumOcean * Math.min(terrain.width, terrain.height));
    let land = 0;
    for (let y = 0; y < terrain.height; y += 1) for (let x = 0; x < terrain.width; x += 1) {
      if (terrain.elevation[y * terrain.width + x] <= terrain.seaLevel) continue;
      land += 1;
      assert.ok(Math.min(x, y, terrain.width - 1 - x, terrain.height - 1 - y) >= margin,
        `land stays off the map edge (${surfaceWater})`);
    }
    assert.ok(land > 0, `the map still has continents (${surfaceWater})`);
    assert.ok(1 - land / terrain.elevation.length >= Math.max(surfaceWater, border.minimumWater) - .03);
  }
  const arid = world.createTerrain('border-arid', 160, 120, { kind: 'aride', surfaceWater: .04, temperature: 90, seed: 77 });
  assert.ok(arid.elevation.filter(value => value > arid.seaLevel).length / arid.elevation.length > .9,
    'other planet kinds keep their own water coverage');
});

test('rivers run downhill to the sea, a lake or another river, and lakes keep a surface height', () => {
  const features = world.TERRAIN_FEATURES;
  for (const [index, surfaceWater] of [.3, .55].entries()) {
    const planet = { kind: 'tellurique', surfaceWater, temperature: 16, seed: 700 + index };
    const terrain = world.createTerrain('hydrology-' + index, 320, 240, planet);
    const repeated = world.createTerrain('hydrology-' + index, 320, 240, planet);
    assert.equal(serialize(terrain.rivers), serialize(repeated.rivers));
    assert.deepEqual(Array.from(terrain.features), Array.from(repeated.features));
    assert.ok(terrain.rivers.length > 3, 'wet worlds have rivers');
    const riverCells = new Set();
    for (const river of terrain.rivers) for (let i = 0; i < river.points.length; i += 2) {
      riverCells.add(river.points[i + 1] * terrain.width + river.points[i]);
    }
    for (const river of terrain.rivers) {
      const cells = [];
      for (let i = 0; i < river.points.length; i += 2) cells.push(river.points[i + 1] * terrain.width + river.points[i]);
      const land = cells.filter(cell => terrain.elevation[cell] > terrain.seaLevel);
      for (let i = 1; i < land.length; i += 1) {
        assert.ok(terrain.elevation[land[i]] <= terrain.elevation[land[i - 1]], 'river beds never rise downstream');
      }
      const mouth = cells.at(-1);
      assert.ok(terrain.elevation[mouth] <= terrain.seaLevel || riverCells.has(mouth), 'rivers end in water or at a confluence');
    }
    let lakes = 0;
    for (let cell = 0; cell < terrain.features.length; cell += 1) {
      if (terrain.features[cell] !== features.lake) continue;
      lakes += 1;
      assert.ok(terrain.elevation[cell] <= terrain.seaLevel, 'lakes are water for building and road rules');
      assert.ok(terrain.relief[cell] > terrain.seaLevel, 'lakes keep their surface above the sea');
    }
    assert.ok(lakes > 0, 'wet worlds have lakes');
  }
  const dry = world.createTerrain('hydrology-dry', 320, 240, { kind: 'aride', surfaceWater: 0, temperature: 90, seed: 9 });
  assert.equal(dry.rivers.length, 0, 'dry worlds have no rivers');
  assert.ok(!dry.features.includes(features.lake) && !dry.features.includes(features.marsh));
  assert.ok(dry.features.includes(features.canyon), 'dry riverbeds remain as canyons');
});

test('non-natal planets are biased toward island and ocean coverage without changing the natal world', () => {
  const galaxy = world.createGalaxy('ocean-world-distribution'), oceanCoverage = [];
  for (const star of galaxy.systems.slice(0, 80)) {
    const system = world.createSystem(galaxy.seed, star.id, galaxy);
    for (const planet of system.planets) if (!planet.startingCandidate && planet.kind !== 'gazeuse') {
      oceanCoverage.push(planet.terrainWater);
    }
  }
  assert.ok(oceanCoverage.filter(water => water > .56).length / oceanCoverage.length > .2);
  const natal = world.createSystem(galaxy.seed, galaxy.homeId, galaxy).planets.find(planet => planet.startingCandidate);
  assert.ok(natal.surfaceWater > .3 && natal.surfaceWater < .65);
});
