'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/worldgen.js', 'world.js', 'data/resources.js', 'data/buildings.js', 'data/recipes.js',
  'data/blocks.js', 'data/logistics.js', 'simulation/simulation.js', 'simulation/construction.js', 'simulation/factory.js']) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);
}

const { OrbitWorld: World, OrbitSimulation: Simulation, OrbitConstruction: Construction,
  OrbitFactorySimulation: FactorySimulation } = context;
let nextPlanet = 1;

function colony() {
  const simulation = Simulation.create(), planetId = `route-test-${nextPlanet++}`;
  Construction.initializePlanet(simulation, planetId, true);
  const building = { id: `factory-building-${planetId}`, type: 'factory', planetId,
    status: 'complete', x: 180, y: 180, cost: {} };
  simulation.buildings[building.id] = building;
  return { simulation, planetId, building, factory: FactorySimulation.create(simulation, building.id) };
}

function flatTerrain(width, height, value = 140) {
  return { width, height, elevation: new Uint8Array(width * height).fill(value), seaLevel: 102 };
}

test('planet routes do not cross a sea barrier or cut a blocked diagonal corner', () => {
  const { simulation, planetId } = colony();
  const waterWall = flatTerrain(26, 18);
  for (let y = 0; y < waterWall.height; y++) waterWall.elevation[y * waterWall.width + 13] = waterWall.seaLevel;
  FactorySimulation.setTerrain(simulation, planetId, waterWall, 3);
  assert.equal(FactorySimulation.routeBetween(simulation, planetId,
    { x: 4.5, y: 25.5 }, { x: 73.5, y: 25.5 }), null);

  const other = colony(), corner = flatTerrain(2, 2);
  corner.elevation[1] = corner.seaLevel;
  corner.elevation[2] = corner.seaLevel;
  FactorySimulation.setTerrain(other.simulation, other.planetId, corner, 3);
  assert.equal(FactorySimulation.routeBetween(other.simulation, other.planetId,
    { x: 1.5, y: 1.5 }, { x: 4.5, y: 4.5 }), null);
});

test('a route on a procedurally generated planet stays on traversable terrain', () => {
  const width = 96, height = 72, textureScale = 3;
  const terrain = World.createTerrain('route-procedural-planet', width, height, { surfaceWater: .38 });
  const total = width * height, visited = new Uint8Array(total), directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const isLand = id => terrain.elevation[id] > terrain.seaLevel + 4;
  let largest = [];
  for (let seed = 0; seed < total; seed++) {
    if (!isLand(seed) || visited[seed]) continue;
    const component = [], queue = [seed]; visited[seed] = 1;
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head], x = id % width, y = Math.floor(id / width);
      component.push(id);
      for (const [dx, dy] of directions) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (isLand(next) && !visited[next]) { visited[next] = 1; queue.push(next); }
      }
    }
    if (component.length > largest.length) largest = component;
  }
  assert.ok(largest.length > total * .2, 'the generated planet has a usable landmass');

  function farthest(start) {
    const distances = new Int32Array(total); distances.fill(-1); distances[start] = 0;
    const queue = [start]; let best = start;
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head], x = id % width, y = Math.floor(id / width);
      if (distances[id] > distances[best]) best = id;
      for (const [dx, dy] of directions) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (isLand(next) && distances[next] < 0) { distances[next] = distances[id] + 1; queue.push(next); }
      }
    }
    return best;
  }

  const first = farthest(largest[0]), last = farthest(first);
  const cellCenter = id => ({ x: (id % width + .5) * textureScale, y: (Math.floor(id / width) + .5) * textureScale });
  const { simulation, planetId } = colony();
  FactorySimulation.setTerrain(simulation, planetId, terrain, textureScale);
  const start = cellCenter(first), end = cellCenter(last);
  const route = FactorySimulation.routeBetween(simulation, planetId, start, end);
  assert.ok(route && route.points.length >= 2);
  assert.ok(route.distance + .001 >= Math.hypot(end.x - start.x, end.y - start.y));
  for (let index = 1; index < route.points.length; index++) {
    const a = route.points[index - 1], b = route.points[index];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (textureScale / 4));
    for (let sample = 0; sample <= steps; sample++) {
      const t = sample / steps, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      const gx = Math.floor(x / textureScale), gy = Math.floor(y / textureScale);
      assert.ok(gx >= 0 && gy >= 0 && gx < width && gy < height);
      assert.ok(isLand(gy * width + gx), 'the whole route remains on traversable generated terrain');
    }
  }
});

test('a route to a target behind a factory clears the factory instead of crossing its footprint', () => {
  const { simulation, planetId, building, factory } = colony();
  const terrain = flatTerrain(200, 140);
  const depot = { id: 'depot-behind-source', type: 'depot', planetId, status: 'complete', x: 80, y: 180, logisticsStock: {} };
  simulation.buildings[depot.id] = depot;
  FactorySimulation.setTerrain(simulation, planetId, terrain, 3);
  const result = FactorySimulation.setOutputDestination(simulation, factory.id, depot.id);
  assert.equal(result.ok, true);
  assert.ok(result.route.distance > Math.hypot(result.route.end.x - result.route.start.x, result.route.end.y - result.route.start.y));
  const clearance = building.type === 'factory' ? 140 * .34 : 0;
  for (const point of result.route.points) {
    assert.ok(Math.hypot(point.x - building.x, point.y - building.y) >= clearance - 1,
      'the road leaves through the output side and remains outside the factory');
  }
});

test('routes refresh when buildings finish and leave other planets cached', () => {
  const { simulation, planetId, factory } = colony(), terrain = flatTerrain(200, 140);
  const depot = { id: 'route-depot', type: 'depot', planetId, status: 'complete', x: 480, y: 180, logisticsStock: {} };
  simulation.buildings[depot.id] = depot;
  FactorySimulation.setTerrain(simulation, planetId, terrain, 3);
  assert.equal(FactorySimulation.setOutputDestination(simulation, factory.id, depot.id).ok, true);
  const clearRoute = factory.outputRoute;

  const second = colony(), secondDepot = { id: 'second-route-depot', type: 'depot', planetId: second.planetId,
    status: 'complete', x: 480, y: 180, logisticsStock: {} };
  simulation.buildings[second.building.id] = second.building;
  Construction.initializePlanet(simulation, second.planetId, false);
  second.factory = FactorySimulation.create(simulation, second.building.id);
  simulation.buildings[secondDepot.id] = secondDepot;
  FactorySimulation.setTerrain(simulation, second.planetId, terrain, 3);
  assert.equal(FactorySimulation.setOutputDestination(simulation, second.factory.id, secondDepot.id).ok, true);
  const otherRoute = second.factory.outputRoute;

  const obstruction = { id: 'route-obstruction', type: 'outpost', planetId, status: 'constructing', x: 340, y: 180, cost: {} };
  simulation.buildings[obstruction.id] = obstruction;
  FactorySimulation.refreshRoutes(simulation, planetId);
  assert.equal(factory.outputRoute.points.length, clearRoute.points.length);
  obstruction.status = 'complete';
  FactorySimulation.refreshRoutes(simulation, planetId);
  assert.notEqual(factory.outputRoute, clearRoute);
  assert.ok(factory.outputRoute.distance > clearRoute.distance);
  assert.equal(FactorySimulation.routeGeometry(simulation, second.factory.id), otherRoute);

  const output = factory.blocks[factory.order.at(-1)], truck = factory.trucks[0];
  truck.status = 'outbound'; truck.destinationId = depot.id; truck.route = factory.outputRoute;
  truck.duration = 20; truck.elapsed = 8; truck.cargo = { iron_plate: 9 };
  const blocked = flatTerrain(200, 140);
  for (let y = 0; y < blocked.height; y++) blocked.elevation[y * blocked.width + 120] = blocked.seaLevel;
  FactorySimulation.setTerrain(simulation, planetId, blocked, 3);
  assert.equal(factory.outputRoute, null, 'a blocked route does not fall back to a straight-line curve');
  assert.equal(truck.status, 'idle');
  assert.equal(output.stock.iron_plate, 9, 'cargo from a cancelled route returns to the source output');
});
