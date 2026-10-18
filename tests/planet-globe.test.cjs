'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadGlobeContext() {
  const context = vm.createContext({ console, performance: { now: () => 1000 }, setTimeout, clearTimeout });
  for (const file of [
    '../src/data/worldgen.js', '../src/world.js', '../src/data/planetGlobeStyle.js',
    '../src/rendering/planetGlobeProjection.js', '../src/rendering/planetGlobeMesh.js',
    '../src/rendering/planetSurfaceTexture.js',
    '../src/navigation/planetGlobeCamera.js'
  ]) vm.runInContext(readFileSync(resolve(__dirname, file), 'utf8'), context, { filename: file });
  return context;
}

function makeTerrain(width = 32, height = 16) {
  const elevation = new Uint8Array(width * height), moisture = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    elevation[index] = Math.max(72, Math.min(218, 120 + Math.round(74 * Math.sin(x * .24) * Math.cos(y * .32))));
    moisture[index] = (x * 19 + y * 31) & 255;
  }
  return { width, height, elevation, moisture, seaLevel: 100, resources: [] };
}

test('terrain coordinates map to and from the sphere without NaNs or lost precision', () => {
  const { OrbitPlanetGlobeProjection: projection } = loadGlobeContext();
  const terrain = makeTerrain(101, 51);
  for (const point of [{ x: 4.25, y: 8.5 }, { x: 50, y: 25 }, { x: 96.75, y: 43.2 }]) {
    const direction = projection.terrainToSphere(point.x, point.y, terrain);
    const roundTrip = projection.sphereToTerrain(direction, terrain);
    assert.ok(Math.abs(roundTrip.x - point.x) < 1e-9);
    assert.ok(Math.abs(roundTrip.y - point.y) < 1e-9);
    assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-12);
  }
  for (const y of [0, terrain.height - 1]) {
    const point = projection.terrainToSphere(terrain.width / 2, y, terrain);
    assert.ok(Object.values(point).every(Number.isFinite));
  }
  const west = projection.terrainToSphere(0, 25, terrain), east = projection.terrainToSphere(100, 25, terrain);
  assert.ok(Math.hypot(west.x - east.x, west.y - east.y, west.z - east.z) < 1e-12,
    'the longitude seam closes on the sphere');
  assert.equal(projection.sampleElevation(0, 25, terrain), projection.sampleElevation(100, 25, terrain),
    'the rendered height also closes smoothly at the map seam');
});

test('elevation sampling is bilinear and stylized relief stays within its declared range', () => {
  const { OrbitPlanetGlobeProjection: projection, OrbitPlanetGlobeStyle: style } = loadGlobeContext();
  const terrain = { width: 2, height: 2, elevation: Uint8Array.from([100, 120, 140, 160]),
    moisture: new Uint8Array(4), seaLevel: 110 };
  assert.equal(projection.sampleElevation(.5, .5, terrain), 130);
  assert.equal(projection.sampleElevation(0, 0, terrain), 110,
    'longitudes collapse to their shared mean at the north pole');
  assert.equal(projection.surfaceRadius(0, 0, terrain, style.relief), 1);
  const max = projection.surfaceRadius(1, 1, { ...terrain, seaLevel: 0 }, style.relief);
  assert.ok(max >= 1 && max <= 1 + style.relief.scale + 1e-12);
  assert.ok(style.camera.maxZoom >= 1.56, 'the globe allows the requested 20% zoom increase');
});

test('polar caps converge smoothly to a shared display-only elevation', () => {
  const { OrbitPlanetGlobeProjection: projection, OrbitPlanetGlobeStyle: style } = loadGlobeContext();
  const width = 64, height = 181, elevation = new Uint8Array(width * height), moisture = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    elevation[y * width + x] = (x * 37 + y * 11) & 255;
    moisture[y * width + x] = (x * 71 + y * 17) & 255;
  }
  const terrain = { width, height, elevation, moisture, seaLevel: 110 };
  const northValues = Array.from({ length: width }, (_, x) => projection.sampleElevation(x, 0, terrain));
  const broadHighLatitudeValues = Array.from({ length: width }, (_, x) => projection.sampleElevation(x, 15, terrain));
  const nearPoleValues = Array.from({ length: width }, (_, x) => projection.sampleElevation(x, .5, terrain));
  assert.ok(Math.max(...northValues) - Math.min(...northValues) < 1e-4);
  assert.ok(Math.max(...broadHighLatitudeValues) - Math.min(...broadHighLatitudeValues) > 100,
    'the polar correction does not pull broad continents inward before the final polar band');
  assert.ok(Math.max(...nearPoleValues) - Math.min(...nearPoleValues) < 1e-3);
  assert.ok(Number.isFinite(projection.surfaceRadius(0, 0, terrain, style.relief)));
});

test('screen ray intersects the relief surface and returns terrain coordinates', () => {
  const { OrbitPlanetGlobeProjection: projection, OrbitPlanetGlobeStyle: style } = loadGlobeContext();
  const terrain = makeTerrain(81, 41);
  const view = { width: 400, height: 300, centerX: 200, centerY: 150, radiusPx: 95,
    yaw: -Math.PI / 2, pitch: 0, zoom: 1 };
  const hit = projection.raycastTerrain(200, 150, terrain, view, style.relief);
  assert.ok(hit);
  assert.ok(Math.abs(hit.x - 40) < 1.5);
  assert.ok(Math.abs(hit.y - 20) < 1.5);
  const projected = projection.projectSurfacePoint(hit.x, hit.y, terrain, view, style.relief);
  assert.ok(projected.visible);
  assert.ok(Math.hypot(projected.x - 200, projected.y - 150) < 2);
});

test('same seed produces identical terrain globe mesh, UVs, and unit normals', () => {
  const { OrbitWorld: world, OrbitPlanetGlobeMesh: meshBuilder, OrbitPlanetGlobeStyle: style } = loadGlobeContext();
  const planet = { id: 'n-1', seed: 'globe-test-seed', kind: 'tellurique', temperature: 16,
    resources: { iron: .55, copper: .3 } };
  const firstTerrain = world.createTerrain(planet.seed, 128, 48, planet);
  const secondTerrain = world.createTerrain(planet.seed, 128, 48, planet);
  assert.deepEqual(Array.from(firstTerrain.elevation), Array.from(secondTerrain.elevation));
  const settings = { longitudeSegments: 64, latitudeSegments: 32 };
  const first = meshBuilder.create(firstTerrain, planet, settings);
  const second = meshBuilder.create(secondTerrain, planet, settings);
  assert.deepEqual(Array.from(first.positions), Array.from(second.positions));
  assert.deepEqual(Array.from(first.uvs), Array.from(second.uvs));
  assert.deepEqual(Array.from(first.indices), Array.from(second.indices));
  assert.equal(first.vertexCount, 65 * 33);
  assert.equal(first.uvs.length, first.vertexCount * 2);
  assert.deepEqual(Array.from(first.uvs.slice(0, 8)), [0, 0, 1 / 64, 0, 2 / 64, 0, 3 / 64, 0]);
  for (let i = 0; i < first.normals.length; i += 3) {
    const length = Math.hypot(first.normals[i], first.normals[i + 1], first.normals[i + 2]);
    assert.ok(Number.isFinite(length) && Math.abs(length - 1) < 1e-5);
  }
  assert.ok(first.uvs.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.equal(style.relief.scale, .024);
  assert.equal(style.relief.exponent, 1.9);
  assert.equal(style.graticule.opacity, .05);
  assert.equal(style.graticule.widthPx, .55);
});

test('procedural planet textures are deterministic, seed-unique, and climate-specific', () => {
  const { OrbitPlanetSurfaceTexture: textures } = loadGlobeContext();
  const width = 64, height = 32, seaLevel = 100;
  const elevation = new Uint8Array(width * height), moisture = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    elevation[index] = x < width / 2 ? 82 + (y % 13) : 130 + ((x * 11 + y * 7) % 105);
    moisture[index] = (x * 17 + y * 29) & 255;
  }
  const terrain = { width, height, elevation, moisture, seaLevel };
  const basePlanet = { id: 'texture-test', seed: 'same-world-seed', temperature: 16, kind: 'tellurique' };
  const first = textures.create(terrain, basePlanet, { width, height, cache: false });
  const repeated = textures.create(terrain, basePlanet, { width, height, cache: false });
  assert.deepEqual(Array.from(first.pixels), Array.from(repeated.pixels));
  assert.deepEqual(Array.from(first.detailPixels), Array.from(repeated.detailPixels));
  assert.equal(first.detailPixels.length, width * height);
  const differentSeed = textures.create(terrain, { ...basePlanet, seed: 'another-world-seed' }, { width, height, cache: false });
  assert.notDeepEqual(Array.from(first.pixels), Array.from(differentSeed.pixels));
  assert.notDeepEqual(Array.from(first.detailPixels), Array.from(differentSeed.detailPixels));

  const frozen = textures.create(terrain, { ...basePlanet, kind: 'glacée' }, { width, height, cache: false });
  const arid = textures.create(terrain, { ...basePlanet, kind: 'aride' }, { width, height, cache: false });
  const volcanic = textures.create(terrain, { ...basePlanet, kind: 'volcanique' }, { width, height, cache: false });
  const pixel = (texture, x, y) => Array.from(texture.pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
  const temperateOcean = pixel(first, 8, 15), iceSea = pixel(frozen, 8, 15);
  const aridBasin = pixel(arid, 8, 15), lavaBasin = pixel(volcanic, 8, 15);
  assert.ok(temperateOcean[2] > temperateOcean[0], 'temperate basins remain blue oceans');
  assert.ok(iceSea[0] > 130 && Math.abs(iceSea[2] - iceSea[1]) < 60,
    'frozen basins are pale blue-gray ice rather than liquid ocean');
  assert.ok(aridBasin[0] > aridBasin[2], 'arid basins use a dry warm palette');
  assert.ok(lavaBasin[0] > lavaBasin[1] && volcanic.pixels.some((value, index) => index % 4 === 3 && value > 0),
    'volcanic basins show orange lava with a restrained emission mask');
  assert.ok(first.pixels.every((value, index) => index % 4 !== 3 || value === 0),
    'non-volcanic alpha is reserved for no emission');
  assert.ok(first.pixels.every((value, index) => index % 4 === 3 || value <= 245),
    'the procedural terrain texture stays below white before lighting');
  for (const texture of [first, frozen, arid, volcanic]) {
    for (const row of [0, height - 1]) {
      const polarPixels = Array.from({ length: width }, (_, x) => pixel(texture, x, row));
      for (let channel = 0; channel < 3; channel += 1) {
        const values = polarPixels.map(entry => entry[channel]);
        assert.ok(Math.max(...values) - Math.min(...values) <= 1,
          `${texture.climate} texture converges to a clean shared polar point`);
      }
    }
  }
});

test('globe shader clamps light, shades from a seeded detail texture, and fades polar detail', () => {
  const source = readFileSync(resolve(__dirname, '../src/rendering/planetGlobeRenderer.js'), 'utf8');
  assert.match(source, /float lighting = 0\.82 \+ diffuse \* 0\.22;/);
  assert.match(source, /lighting = clamp\(lighting, 0\.78, 1\.04\);/);
  assert.match(source, /uniform sampler2D uDetailTexture;/);
  assert.match(source, /uNormalDetailStrength \* 8\.0 \* polarDetailFade/);
  assert.match(source, /smoothstep\(uSeaLevel - 1\.5, uSeaLevel \+ 1\.5, vElevation\)/);
  assert.match(source, /gl\.R8/);
  assert.match(source, /normalDetailStrength, \.15/);
});

test('globe camera clamps tilt and zoom and evaluates transitions from simulation time', () => {
  const { OrbitPlanetGlobeCamera: cameraApi, OrbitPlanetGlobeStyle: style } = loadGlobeContext();
  const camera = cameraApi.create(style.camera);
  camera.rotateBy(50, 10000);
  assert.ok(Math.abs(camera.snapshot().pitch) <= style.camera.maxPitch);
  const zoomIn = camera.zoomBy(20);
  assert.equal(zoomIn.zoom, style.camera.maxZoom);
  assert.equal(camera.zoomBy(.001).crossedMinimum, true);
  assert.equal(camera.snapshot().zoom, style.camera.minZoom);
  camera.setView({ zoom: 1 });
  camera.beginEnter({ x: 30, y: 40 }, 12, 400, 300, 1000);
  const middle = camera.transitionFrame(1160, 400, 300);
  assert.equal(middle.mode, 'enter');
  assert.ok(middle.radiusPx > 12);
  const end = camera.transitionFrame(1320, 400, 300);
  assert.equal(end.active, false);
  assert.equal(camera.transitionMode(), null);
  camera.beginExit(400, 300, 2000);
  const exit = camera.transitionFrame(2160, 400, 300, { x: 80, y: 70, radiusPx: 22 });
  assert.equal(exit.mode, 'exit');
  assert.ok(exit.centerX < 200 && exit.centerY < 150);
});

test('projected building markers and graticule follow front-side visibility', () => {
  const context = vm.createContext({ console });
  for (const file of ['../src/data/planetGlobeStyle.js', '../src/rendering/planetGlobeProjection.js']) {
    vm.runInContext(readFileSync(resolve(__dirname, file), 'utf8'), context, { filename: file });
  }
  context.OrbitConfig = { terrain: { textureScale: 1 } };
  context.OrbitBuildingData = { get: () => ({ id: 'factory', icon: 'factory', label: 'Usine',
    shortLabel: 'US', category: 'industry' }) };
  vm.runInContext(readFileSync(resolve(__dirname, '../src/rendering/planetGlobeOverlayRenderer.js'), 'utf8'), context);
  const counts = { strokes: 0 };
  const ctx = new Proxy({}, { get(target, property) {
    if (property in target) return target[property];
    if (property === 'measureText') return () => ({ width: 1 });
    return () => { if (property === 'stroke') counts.strokes += 1; };
  }, set(target, property, value) { target[property] = value; return true; } });
  const canvas = { style: {}, getContext: () => ctx };
  const overlay = context.OrbitPlanetGlobeOverlayRenderer.create(canvas);
  overlay.resize(400, 300, 1);
  const terrain = makeTerrain(41, 21);
  const building = { id: 'factory-1', type: 'factory', planetId: 'planet-1', x: 20, y: 10 };
  const state = { planet: { id: 'planet-1' }, surfaceBuildings: [building], roadNetworks: {},
    surfaceSettlements: {}, selected: null, tool: 'pan' };
  const view = { width: 400, height: 300, centerX: 200, centerY: 150, radiusPx: 90,
    yaw: -Math.PI / 2, pitch: 0, zoom: 1 };
  overlay.render({ terrain, state, view });
  assert.equal(canvas.style.display, 'block');
  assert.ok(counts.strokes >= 10, 'latitude and longitude lines are drawn');
  const point = context.OrbitPlanetGlobeProjection.projectSurfacePoint(20, 10, terrain, view,
    context.OrbitPlanetGlobeStyle.relief);
  assert.equal(overlay.hitTest([building], 'planet-1', terrain, view, point.x, point.y)?.id, building.id);
  const hiddenView = { ...view, yaw: view.yaw + Math.PI };
  assert.equal(overlay.hitTest([building], 'planet-1', terrain, hiddenView, point.x, point.y), null,
    'a marker on the rear hemisphere cannot be selected');
});
