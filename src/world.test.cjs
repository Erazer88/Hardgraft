'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(__dirname + '/world.js', 'utf8'), context);
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
  assert.ok(system.planets.length >= 4 && system.planets.length <= 7);
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
    assert.ok(terrain.resources.length >= 4);
    for (const resource of terrain.resources) {
      assert.ok(resource.x >= 0 && resource.x < terrain.width && resource.y >= 0 && resource.y < terrain.height);
      assert.ok(terrain.elevation[resource.y * terrain.width + resource.x] > terrain.seaLevel);
    }
  }
  assert.notDeepEqual(Array.from(world.createTerrain('one', 80, 60).elevation),
    Array.from(world.createTerrain('two', 80, 60).elevation));
});
