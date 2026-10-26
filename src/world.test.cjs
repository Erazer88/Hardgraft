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
  let ordinary = 0, wrecks = 0, oilEligible = 0, oilBearing = 0;
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
      const oilRange = context.OrbitWorldgenData.terrain.offshoreOil.temperatureRange;
      const moderateTelluric = planet.kind === 'tellurique' && planet.temperature >= oilRange[0] &&
        planet.temperature <= oilRange[1];
      assert.equal(typeof planet.hasOilDeposit, 'boolean');
      if (moderateTelluric) oilEligible += 1;
      if (planet.hasOilDeposit) {
        assert.ok(moderateTelluric, 'oil appears only on temperate telluric planets');
        oilBearing += 1;
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
  assert.ok(oilEligible > 200);
  assert.ok(oilBearing / oilEligible > .29 && oilBearing / oilEligible < .38,
    'about one third of temperate telluric planets carry an offshore oil field');

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

test('the natal system always provides a temperate candidate, water and basic deposits', () => {
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
      const landResources = terrain.resources.filter(item => !item.marine);
      const oilFields = terrain.resources.filter(item => item.marine);
      assert.deepEqual([...new Set(landResources.map(item => item.id))].sort(), ['carbon', 'copper', 'iron', 'silicon']);
      assert.equal(oilFields.length, planet.hasOilDeposit ? 1 : 0);
      assert.ok(terrain.resources.length <= 5);
      const water = terrain.elevation.filter(value => value <= terrain.seaLevel).length / terrain.elevation.length;
      const expectedWater = Math.max(planet.surfaceWater, context.OrbitWorldgenData.terrain.oceanBorder.minimumWater);
      assert.ok(Math.abs(water - expectedWater) < .04);
      assert.ok(landResources.every(item => terrain.elevation[item.y * terrain.width + item.x] > terrain.seaLevel + 10));
      assert.ok(oilFields.every(item => terrain.elevation[item.y * terrain.width + item.x] <= terrain.seaLevel - 12));
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
  assert.equal(serialize(wet.resources), serialize(repeated.resources));
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
    assert.ok(terrain.resources.length <= 5, 'each generated terrain has at most five deposits');
    assert.deepEqual(serialize(terrain.resources), serialize(repeated.resources));
    for (const resource of terrain.resources) {
      assert.ok(resource.x >= 0 && resource.x < terrain.width && resource.y >= 0 && resource.y < terrain.height);
      assert.ok(resource.radius > 0);
      const altitude = terrain.elevation[resource.y * terrain.width + resource.x];
      if (resource.marine) assert.ok(altitude <= terrain.seaLevel - 12);
      else assert.ok(altitude > terrain.seaLevel);
    }
  }
  assert.notDeepEqual(Array.from(world.createTerrain('one', 80, 60).elevation),
    Array.from(world.createTerrain('two', 80, 60).elevation));
});

test('most planets have two or three large deposits, with some worlds empty or especially rich', () => {
  const counts = Array(6).fill(0);
  for (let i = 0; i < 72; i += 1) {
    const terrain = world.createTerrain('deposit-distribution-' + i, 48, 36,
      { kind: 'tellurique', temperature: 18, surfaceWater: .34, hasOilDeposit: false });
    const count = terrain.resources.length;
    assert.ok(count >= 0 && count <= 5);
    counts[count] += 1;
    assert.ok(terrain.resources.every(resource => !resource.marine));
    assert.ok(terrain.resources.every(resource => resource.radius >= 5));
  }
  assert.ok((counts[2] + counts[3]) / 72 > .5, 'two and three deposits make up most planets');
  assert.ok(counts[0] > 0 && counts[5] > 0, 'some planets have none and a few have five');
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

test('eligible planets can carry one broad offshore oil field', () => {
  const planet = { kind: 'tellurique', hasOilDeposit: true, surfaceWater: .74, temperature: 18,
    seed: 412, resources: { iron: .7 } };
  const terrain = world.createTerrain('oceanic-world', 640, 480, planet);
  const repeated = world.createTerrain('oceanic-world', 640, 480, planet);
  const minerals = terrain.resources.filter(resource => !resource.marine);
  const oil = terrain.resources.filter(resource => resource.marine);
  assert.deepEqual(serialize(terrain.resources), serialize(repeated.resources));
  assert.ok(minerals.length <= 4);
  assert.ok(minerals.every(resource => resource.radius >= 21));
  assert.equal(oil.length, 1);
  assert.ok(oil.every(resource => resource.id === 'oil' && resource.radius > 25));
  assert.ok(terrain.resources.length <= 5);
  const water = terrain.elevation.filter(value => value <= terrain.seaLevel).length / terrain.elevation.length;
  assert.ok(water > .70 && water < .78);
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
