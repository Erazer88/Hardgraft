'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadGlobeContext() {
  const context = vm.createContext({ console, performance: { now: () => 1000 }, setTimeout, clearTimeout });
  for (const file of [
    '../src/data/worldgen.js', '../src/world.js', '../src/world/tectonics.js', '../src/world/terrainElevation.js', '../src/world/thermalErosion.js', '../src/world/terrainStructure.js', '../src/data/planetGlobeStyle.js',
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
  assert.equal(projection.sampleElevation(0, 25, terrain), terrain.elevation[25 * terrain.width],
    'the projection reads the first generated longitude without a seam filter');
  assert.equal(projection.sampleElevation(100, 25, terrain), terrain.elevation[25 * terrain.width + 100],
    'the projection reads the last generated longitude without a seam filter');
});

test('elevation sampling is bilinear and stylized relief stays within its declared range', () => {
  const { OrbitPlanetGlobeProjection: projection, OrbitPlanetGlobeStyle: style } = loadGlobeContext();
  const terrain = { width: 2, height: 2, elevation: Uint8Array.from([100, 120, 140, 160]),
    moisture: new Uint8Array(4), seaLevel: 110 };
  assert.equal(projection.sampleElevation(.5, .5, terrain), 130);
  assert.equal(projection.sampleElevation(0, 0, terrain), 100,
    'projection samples the generated terrain directly without display averaging');
  assert.equal(projection.surfaceRadius(0, 0, terrain, style.relief), 1);
  const max = projection.surfaceRadius(1, 1, { ...terrain, seaLevel: 0 }, style.relief);
  assert.ok(max >= 1 && max <= 1 + style.relief.scale + 1e-12);
  let previousShape = projection.shapeReliefHeight(0, style.relief);
  for (let step = 1; step <= 100; step += 1) {
    const shape = projection.shapeReliefHeight(step / 100, style.relief);
    assert.ok(shape > previousShape, 'relief height increases strictly without summit saturation');
    previousShape = shape;
  }
  assert.ok(Math.abs(previousShape - 1) < 1e-12);
  assert.ok(style.camera.maxZoom >= 1.56, 'the globe allows the requested 20% zoom increase');
});

test('globe projection consumes naturally consistent spherical pole samples', () => {
  const { OrbitWorld: world, OrbitPlanetGlobeProjection: projection, OrbitPlanetGlobeStyle: style } = loadGlobeContext();
  const width = 128, height = 64;
  const terrain = world.createTerrain('projection-pole-test', width, height, { surfaceWater: .4 });
  for (const y of [0, height - 1]) {
    const samples = Array.from({ length: width }, (_, x) => projection.sampleElevation(x, y, terrain));
    assert.ok(samples.every(value => value === samples[0]), 'the generator supplies one elevation at each pole');
  }
  for (let y = 0; y < height; y += 1) {
    assert.equal(projection.sampleElevation(0, y, terrain),
      projection.sampleElevation(width - 1, y, terrain), 'projection keeps the generated longitude seam exact');
  }
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
  assert.equal(style.relief.scale, .045);
  assert.equal(style.relief.exponent, 1.10);
  assert.equal(style.relief.linearFraction, .34);
  assert.equal(style.relief.compressionStart, .24);
  assert.equal(style.relief.landQuantile, .98);
  assert.equal(style.relief.minLandRange, 28);
  assert.equal(style.relief.maxLandRange, 70);
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
  assert.deepEqual(Array.from(first.heightPixels), Array.from(repeated.heightPixels));
  assert.deepEqual(Array.from(first.landMaskPixels), Array.from(repeated.landMaskPixels));
  assert.deepEqual(Array.from(first.coastSdfPixels), Array.from(repeated.coastSdfPixels));
  assert.deepEqual(Array.from(first.detailPixels), Array.from(repeated.detailPixels));
  assert.equal(first.albedoPixels, first.pixels, 'pixels remains a compatibility alias for clean albedo');
  assert.equal(first.heightPixels.length, width * height * 2,
    'height uses two channels to retain 16-bit precision');
  assert.equal(first.landMaskPixels.length, width * height);
  assert.equal(first.coastSdfPixels.length, width * height);
  assert.equal(first.detailPixels.length, width * height, 'micro detail stays a single low-amplitude channel');
  const differentSeed = textures.create(terrain, { ...basePlanet, seed: 'another-world-seed' }, { width, height, cache: false });
  assert.notDeepEqual(Array.from(first.pixels), Array.from(differentSeed.pixels));
  assert.notDeepEqual(Array.from(first.detailPixels), Array.from(differentSeed.detailPixels));
  const flatTerrain = { width, height, elevation: new Uint8Array(width * height).fill(180),
    moisture: new Uint8Array(width * height).fill(128), seaLevel };
  const flatAlbedo = textures.create(flatTerrain, basePlanet, { width, height, cache: false }).albedoPixels;
  let largestFlatColorStep = 0;
  for (let x = 1; x < width - 1; x += 1) for (let channel = 0; channel < 3; channel += 1) {
    const index = (16 * width + x) * 4 + channel;
    largestFlatColorStep = Math.max(largestFlatColorStep, Math.abs(flatAlbedo[index] - flatAlbedo[index - 4]));
  }
  assert.ok(largestFlatColorStep < 8, 'flat terrain albedo excludes high-frequency color noise');

  const frozen = textures.create(terrain, { ...basePlanet, kind: 'glacée' }, { width, height, cache: false });
  const arid = textures.create(terrain, { ...basePlanet, kind: 'aride' }, { width, height, cache: false });
  const volcanic = textures.create(terrain, { ...basePlanet, kind: 'volcanique' }, { width, height, cache: false });
  const pixel = (texture, x, y) => Array.from(texture.pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
  const temperateOcean = pixel(first, 8, 15), iceSea = pixel(frozen, 8, 15);
  const aridBasin = pixel(arid, 8, 15), lavaBasin = pixel(volcanic, 8, 15);
  assert.ok(temperateOcean[2] > temperateOcean[0], 'temperate basins remain blue oceans');
  assert.ok(iceSea[0] > 80 && iceSea[2] > iceSea[0] + 25,
    'frozen basins are blue-gray ice rather than liquid ocean or washed-out white');
  assert.ok(aridBasin[0] > aridBasin[2], 'arid basins use a dry warm palette');
  assert.ok(lavaBasin[0] > lavaBasin[1], 'volcanic basins show orange-red lava as a surface material');
  for (const texture of [first, frozen, arid, volcanic])
    assert.ok(texture.albedoPixels.every((value, index) => index % 4 !== 3 || value === 255),
      'albedo remains opaque and carries no emission channel');
  assert.ok(first.pixels.every((value, index) => index % 4 === 3 || value <= 255),
    'the procedural terrain texture stays in the displayable RGB range');
  assert.ok(Array.from(first.pixels).some((value, index) => index % 4 === 0 && value > 190),
    'the palette retains bright snow and warm coasts rather than clipping all materials dark');
  assert.ok(first.coastRange > 0, 'the signed shoreline distance declares its encoded range');
  assert.ok(first.landMaskPixels.some(value => value > 0 && value < 255),
    'four subpixel samples preserve fractional shoreline coverage');
  const coastTest = textures.create({ ...terrain, elevation: Uint8Array.from({ length: width * height }, (_, index) =>
    index % width < width / 2 ? 70 : 180) }, basePlanet, { width, height, cache: false });
  assert.ok(coastTest.coastSdfPixels[16 * width + 8] < 128, 'signed coast distance is negative over ocean');
  assert.ok(coastTest.coastSdfPixels[16 * width + 56] > 128, 'signed coast distance is positive over land');
  const { OrbitWorld: world } = loadGlobeContext();
  const sphericalTerrain = world.createTerrain('texture-spherical-poles', width, height,
    { ...basePlanet, surfaceWater: .42 });
  for (const planet of [basePlanet, { ...basePlanet, kind: 'glacée' },
    { ...basePlanet, kind: 'aride' }, { ...basePlanet, kind: 'volcanique' }]) {
    const texture = textures.create(sphericalTerrain, planet, { width, height, cache: false });
    for (const row of [0, height - 1]) {
      const polarPixels = Array.from({ length: width }, (_, x) => pixel(texture, x, row));
      for (let channel = 0; channel < 3; channel += 1) {
        const values = polarPixels.map(entry => entry[channel]);
        assert.ok(Math.max(...values) - Math.min(...values) <= 1,
          `${texture.climate} pole color comes from consistent terrain directions`);
      }
    }
  }
});

test('surface texture samples mountain, ridge, valley, and ruggedness fields into RGBA', () => {
  const { OrbitPlanetSurfaceTexture: textures, OrbitWorld: world } = loadGlobeContext();
  const width = 24, height = 12;
  const terrain = world.createTerrain('structure-texture-test', width, height,
    { surfaceWater: .38, geology: .8 });
  const textureWidth = 32, textureHeight = 16;
  const texture = textures.create(terrain, { id: 'structure-texture-test', seed: 'structure-texture-test',
    kind: 'tellurique', temperature: 16 }, { width: textureWidth, height: textureHeight, cache: false });
  assert.equal(texture.terrainStructurePixels.length, textureWidth * textureHeight * 4);
  const fields = [terrain.mountainMask, terrain.ridgeField, terrain.valleyField, terrain.ruggednessField];
  const profileX = value => {
    const period = Math.max(1, terrain.width - 1), wrapped = ((value % period) + period) % period;
    const x0 = Math.floor(wrapped);
    return { x0, x1: (x0 + 1) % period, t: wrapped - x0 };
  };
  const profileY = value => {
    const bounded = Math.max(0, Math.min(terrain.height - 1, value)), y0 = Math.floor(bounded);
    return { y0, y1: Math.min(terrain.height - 1, y0 + 1), t: bounded - y0 };
  };
  const lerp = (a, b, t) => a * (1 - t) + b * t;
  for (const py of [0, 3, 8, textureHeight - 1]) for (const px of [0, 5, 17, textureWidth - 1]) {
    const x = profileX(px / textureWidth * (terrain.width - 1));
    const y = profileY(py / (textureHeight - 1) * (terrain.height - 1));
    const offset = (py * textureWidth + px) * 4;
    for (let channel = 0; channel < fields.length; channel += 1) {
      const top = lerp(fields[channel][y.y0 * terrain.width + x.x0],
        fields[channel][y.y0 * terrain.width + x.x1], x.t);
      const bottom = lerp(fields[channel][y.y1 * terrain.width + x.x0],
        fields[channel][y.y1 * terrain.width + x.x1], x.t);
      assert.equal(texture.terrainStructurePixels[offset + channel], Math.round(lerp(top, bottom, y.t)),
        `RGBA channel ${channel} samples its terrain field at (${px}, ${py})`);
    }
  }
});

test('polar ice boundaries are seeded, irregular on both hemispheres, and climate sized', () => {
  const { OrbitPlanetSurfaceTexture: textures } = loadGlobeContext();
  const warmThreshold = textures.polarIceThreshold(24);
  const coldThreshold = textures.polarIceThreshold(-42);
  assert.ok(coldThreshold < warmThreshold,
    'a colder global temperature expands the mean polar ice coverage');

  const seedSummaries = [];
  for (const seedText of ['cap-seed-a', 'cap-seed-b', 'cap-seed-c', 'cap-seed-d']) {
    const { OrbitWorld: world } = loadGlobeContext();
    const seed = world.hashSeed(seedText);
    const summaries = [];
    for (const sign of [1, -1]) {
      let hasAdvancingAndRetreatingEdge = false;
      const hemisphere = [];
      const edgeLatitudes = [];
      for (let index = 0; index < 96; index += 1) {
        const longitude = index / 96 * Math.PI * 2;
        let edge = 90;
        for (let degrees = 60; degrees <= 89; degrees += .2) {
          const latitude = degrees * Math.PI / 180;
          const radius = Math.cos(latitude);
          const coverage = textures.polarIceCoverage(radius * Math.cos(longitude),
            sign * Math.sin(latitude), radius * Math.sin(longitude), 24, seed);
          if (coverage >= .5) { edge = degrees; break; }
        }
        edgeLatitudes.push(edge);
      }
      const edgeSpread = Math.max(...edgeLatitudes) - Math.min(...edgeLatitudes);
      assert.ok(edgeSpread >= 1.5 && edgeSpread <= 14,
        `${seedText} keeps an organic but compact edge displacement (${edgeSpread.toFixed(1)}°)`);
      for (let step = -12; step <= 12; step += 1) {
        const latitudeDegrees = warmThreshold + step * .55;
        if (latitudeDegrees >= 90) continue;
        const y = sign * Math.sin(latitudeDegrees * Math.PI / 180);
        const coverage = [];
        for (let index = 0; index < 256; index += 1) {
          const longitude = index / 256 * Math.PI * 2;
          const radius = Math.sqrt(1 - y * y);
          coverage.push(textures.polarIceCoverage(radius * Math.cos(longitude), y,
            radius * Math.sin(longitude), 24, seed));
        }
        const minimum = Math.min(...coverage), maximum = Math.max(...coverage);
        if (minimum < .25 && maximum > .75) hasAdvancingAndRetreatingEdge = true;
        hemisphere.push(...coverage);
      }
      assert.ok(hasAdvancingAndRetreatingEdge,
        `${seedText} has an irregular advancing/retreating edge on ${sign > 0 ? 'north' : 'south'} cap`);
      summaries.push(hemisphere);
    }
    seedSummaries.push(summaries);
    for (const sign of [1, -1]) {
      assert.equal(textures.polarIceCoverage(0, sign, 0, 24, seed), 1,
        'the pole itself remains fully covered and independent of longitude');
    }
  }
  assert.notDeepEqual(seedSummaries[0], seedSummaries[1], 'cap outlines change with the planet seed');

  const width = 128, height = 64, seaLevel = 100;
  const ocean = { width, height, elevation: new Uint8Array(width * height).fill(80),
    moisture: new Uint8Array(width * height), seaLevel };
  const planet = { id: 'polar-ocean', seed: 'temperate-cap-seed', kind: 'tellurique', temperature: 18 };
  const texture = textures.create(ocean, planet, { width, height, cache: false });
  const pixel = (x, y) => Array.from(texture.pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
  const capOcean = pixel(0, 0), equatorialOcean = pixel(width / 2, height / 2);
  assert.ok(capOcean[0] > equatorialOcean[0] + 35,
    'temperate polar ocean renders as sea ice, separate from open water');
  const edgeRow = 6;
  const edgeColors = Array.from({ length: width }, (_, x) => pixel(x, edgeRow));
  const redSpread = Math.max(...edgeColors.map(color => color[0])) - Math.min(...edgeColors.map(color => color[0]));
  assert.ok(redSpread > 20, 'the ice front moves irregularly with longitude instead of forming a latitude ring');

  const continent = { ...ocean, elevation: new Uint8Array(width * height).fill(170) };
  const landTexture = textures.create(continent, planet, { width, height, cache: false });
  const polarLand = Array.from(landTexture.pixels.slice(0, 3));
  const equatorialLand = Array.from(landTexture.pixels.slice((height / 2 * width + width / 2) * 4,
    (height / 2 * width + width / 2) * 4 + 3));
  assert.ok(polarLand[2] > equatorialLand[2] + 20,
    'continental snow remains distinct from temperate sea ice and land');

  const frozenPlanet = { ...planet, kind: 'glacée', temperature: -66 };
  const frozenOcean = textures.create(ocean, frozenPlanet, { width, height, cache: false });
  const frozenPixel = (x, y) => Array.from(frozenOcean.pixels.slice((y * width + x) * 4,
    (y * width + x) * 4 + 3));
  const polarSeaIce = frozenPixel(0, 0), polarReference = frozenPixel(width / 2, height / 2);
  assert.ok(Math.hypot(polarSeaIce[0] - polarReference[0], polarSeaIce[1] - polarReference[1],
    polarSeaIce[2] - polarReference[2]) > 8,
  'the compact polar ice has a distinct cold material from mid-latitude ice');
  assert.ok(Math.max(...polarSeaIce) < 245,
    'frozen polar ice retains a blue-gray material and does not clip to white');
  const frozenLand = textures.create(continent, frozenPlanet, { width, height, cache: false });
  const frozenLandRow = Array.from({ length: width }, (_, x) => frozenLand.pixels[(16 * width + x) * 4]);
  assert.ok(Math.max(...frozenLandRow) - Math.min(...frozenLandRow) > 20,
    'an icy continent keeps exposed rock and ice material variation');
});

test('height texture preserves terrain gradients while the micro-detail map stays subtle', () => {
  const { OrbitPlanetSurfaceTexture: textures } = loadGlobeContext();
  const width = 64, height = 32;
  const elevation = new Uint8Array(width * height), moisture = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    elevation[y * width + x] = Math.min(230, 72 + x * 2);
  }
  const terrain = { width, height, elevation, moisture, seaLevel: 80 };
  const texture = textures.create(terrain,
    { id: 'gradient-test', seed: 'gradient-test', temperature: 16, kind: 'tellurique' },
    { width, height, cache: false });
  const heightAt = (x, y) => {
    const offset = (y * width + x) * 2;
    return (texture.heightPixels[offset] * 256 + texture.heightPixels[offset + 1]) / 65535;
  };
  assert.ok(heightAt(36, 16) > heightAt(24, 16), 'the normalized height map follows rising elevation');
  const sampledElevation = 72 + 2 * (36 / width * (width - 1));
  assert.ok(Math.abs(heightAt(36, 16) - sampledElevation / 255) < 1 / 65535,
    'the packed height retains bilinear elevation and bathymetry precision beyond 8 bits');
  assert.ok(texture.detailPixels.every(value => value >= 117 && value <= 139),
    'fine noise remains a restrained shader-only micro detail');
  const descending = new Uint8Array(elevation.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    descending[y * width + x] = Math.max(20, 230 - x * 2);
  }
  const reverse = textures.create({ ...terrain, elevation: descending },
    { id: 'gradient-test-reverse', seed: 'gradient-test', temperature: 16, kind: 'tellurique' },
    { width, height, cache: false });
  const reverseHeightAt = (x, y) => {
    const offset = (y * width + x) * 2;
    return (reverse.heightPixels[offset] * 256 + reverse.heightPixels[offset + 1]) / 65535;
  };
  assert.ok(reverseHeightAt(36, 16) < reverseHeightAt(24, 16),
    'reversing the elevation slope reverses the height gradient');
});

test('surface palettes keep climate materials separated and HSL tints bounded', () => {
  const { OrbitPlanetSurfaceTexture: textures } = loadGlobeContext();
  assert.equal(textures.palettes.temperate.deepOcean, '#052F54');
  assert.equal(textures.palettes.temperate.wetPlain, '#3F8738');
  assert.equal(textures.palettes.temperate.coast, '#DFC67D');
  assert.equal(textures.palettes.frozen.seaIce, '#78B7C9');
  assert.equal(textures.palettes.frozen.polarCore, '#699CAB');
  assert.equal(textures.palettes.arid.darkRock, '#432820');
  assert.equal(textures.palettes.volcanic.basaltDark, '#211817');
  assert.equal(textures.palettes.volcanic.coreLava, '#FFD06A');

  const source = [116, 150, 84];
  const hsl = textures.rgbToHsl(...source, new Float32Array(3));
  const roundTrip = textures.hslToRgb(...hsl, new Float32Array(3));
  assert.ok(roundTrip.every((value, index) => Math.abs(value - source[index]) < 1e-4));
  const tinted = textures.tintHsl(source, { hueShift: 3, satMul: 1.05, lightMul: 1.04 });
  const tintedHsl = textures.rgbToHsl(...tinted, new Float32Array(3));
  assert.ok(tintedHsl[0] - hsl[0] <= 3.001);
  assert.ok(tintedHsl[1] <= hsl[1] * 1.051);
  assert.ok(tintedHsl[2] <= hsl[2] * 1.041);
});

test('globe shader smooths high-precision terrain and limits detail to mountains', () => {
  const source = readFileSync(resolve(__dirname, '../src/rendering/planetGlobeRenderer.js'), 'utf8');
  assert.match(source, /float lightTerm = 0\.58 \+ diffuse \* 0\.60;/);
  assert.doesNotMatch(source, /color \+= vec3\(1\.0, 0\.14, 0\.025\)/,
    'the fragment shader does not add white/orange emission to terrain');
  assert.match(source, /uniform sampler2D uAlbedoTexture;/);
  assert.match(source, /uniform sampler2D uHeightTexture;/);
  assert.match(source, /uniform sampler2D uLandMaskTexture;/);
  assert.match(source, /uniform sampler2D uCoastSdfTexture;/);
  assert.match(source, /uniform sampler2D uTerrainStructureTexture;/);
  assert.match(source, /float decodeHeight\(vec2 rg\)/);
  assert.match(source, /float sampleLandHeight\(vec2 uv, float lod\)/,
    'the shader samples full-precision elevation before applying the visual land range');
  assert.match(source, /\(elevation - uReliefLow\) \/ max\(1\.0, uReliefHigh - uReliefLow\)/,
    'fragment normals use the same quantile-derived visual height interval as the mesh');
  assert.match(source, /vVisualHeight = clamp\(\(aElevation - uReliefLow\) \/ max\(1\.0, uReliefHigh - uReliefLow\)/,
    'the vertex shader uses the same visual elevation normalization');
  assert.match(source, /float shapeReliefHeight\(float h\)/,
    'shader slope and mesh displacement use the same monotone relief shape');
  assert.match(source, /float midLeft = sampleShapedLandHeight\([^;]+, 0\.0\)/,
    'mid-relief normals follow the mesh shaped from the unsaturated terrain');
  assert.match(source, /float facetLeft = sampleShapedLandHeight\([^;]+, 1\.0\)/,
    'mountain facets use a broader low-pass height signal');
  assert.match(source, /vec3 midReliefNormal = normalize/);
  assert.match(source, /vec2 facetStep = max\(uHeightTexelSize \* 2\.0, 1\.0 \/ uFacetGrid\)/);
  assert.doesNotMatch(source, /floor\(vUv \* uFacetGrid\)/,
    'mountain facet sampling stays continuous instead of creating square grid patches');
  assert.match(source, /vec4 terrainStructure = texture\(uTerrainStructureTexture, vUv\)/);
  assert.match(source, /float mountainMask = terrainStructure\.r \* landCoverage/);
  assert.match(source, /float ridgeStrength = terrainStructure\.g/);
  assert.match(source, /float valleyStrength = terrainStructure\.b/);
  assert.match(source, /float ruggedness = terrainStructure\.a/);
  assert.match(source, /mix\(baseNormal, midReliefNormal, landCoverage \* reliefStrength\)/,
    'heightmap normals are applied across land, including outside tectonic mountain masks');
  assert.match(source, /float reliefStrength = mix\(0\.14, 0\.82, mountainInfluence\)/,
    'heightmap shading stays faint on plains and strengthens with mountain influence');
  assert.match(source, /float facetMask = mountainMask \* ruggedness \* mountainSlope \* smoothstep\(0\.12, 0\.42, height\)/);
  assert.doesNotMatch(source, /ridgeSignal|float ridgeStrength = smoothstep/,
    'worldgen fields, not a height Laplacian, define geological ridges and valleys');
  assert.match(source, /mix\(terrainNormal, facetNormal, facetMask \* uFacetMix\)/);
  assert.match(source, /float detailMask = smoothstep\(0\.12, 0\.30, slope\) \* mountainMask \* ruggedness/);
  assert.match(source, /detailMask \* uDetailNormalStrength/);
  assert.doesNotMatch(source, /floor\(diffuse \* 4\.0\)/,
    'terrain lighting is continuous rather than posterized to disguise topography');
  assert.match(source, /texture\(uCoastSdfTexture, vUv\)\.r \* 2\.0 - 1\.0/);
  assert.match(source, /float bathymetry = decodeHeight\(textureLod\(uHeightTexture, vUv, 2\.0\)\.rg\) \* 255\.0/,
    'ocean depth samples a smoothed bathymetry field');
  assert.match(source, /float waterDepth = clamp\(\(uSeaLevel - bathymetry\)/);
  assert.match(source, /float coastDistance = max\(0\.0, -coastSdf\) \* uCoastRange/);
  assert.match(source, /uWaterShallowColor, uWaterMidColor, smoothstep/);
  assert.match(source, /mix\(waterColor, uWaterDeepColor, smoothstep/);
  assert.match(source, /float depth01 = mix\(coastalDepth, waterDepth, uWaterBathymetryInfluence\)/,
    'coast distance defines the broad water gradient and bathymetry is only a subtle correction');
  assert.match(source, /float oceanSpecular = pow\(max\(dot\(waterNormal, halfVector\), 0\.0\), 48\.0\)/);
  assert.match(source, /float oceanFresnel = pow\(1\.0 - max\(dot\(viewDirection, waterNormal\), 0\.0\), 3\.0\)/);
  assert.match(source, /mix\(landColor, waterColor, oceanCoverage\)/,
    'liquid water skips the land relief shading path');
  assert.match(source, /rockExposure = mountainInfluence \* smoothstep\(0\.06, 0\.20, slope\)/);
  assert.match(source, /mix\(base, uRockColor, rockExposure \* 0\.66\)/);
  assert.match(source, /mix\(landMaterial, uRidgeColor, ridgeStrength \* 0\.12\)/);
  assert.match(source, /mix\(landMaterial, uCreviceColor, valleyStrength \* 0\.08\)/);
  assert.match(source, /uniform float uAoStrength;/);
  assert.match(source, /float ao = 1\.0 - slope \* uAoStrength \* land \* mountainMask/);
  assert.match(source, /uniform sampler2D uDetailTexture;/);
  assert.match(source, /oceanSpecular/);
  assert.match(source, /uAtmospherePass/);
  assert.match(source, /fresnel \* uAtmosphereAlpha \* uOpacity/);
  assert.match(source, /smoothstep\(1\.53589, 1\.5707963, abs\(latitude\)\)/,
    'geometric normal smoothing is limited to the final two degrees');
  assert.match(source, /smoothstep\(1\.55334, 1\.5707963, abs\(latitude\)\)/,
    'normal detail is faded only in the final degree at the singularity');
  assert.match(source, /smoothstep\(uSeaLevel \+ 1\.0, uSeaLevel \+ 3\.0, vElevation\)/);
  assert.match(source, /gl\.RG8, gl\.RG, surfaceData\.heightPixels/);
  assert.match(source, /gl\.RGBA8, gl\.RGBA, surfaceData\.terrainStructurePixels/);
  assert.match(source, /gl\.R8, gl\.RED, surfaceData\.coastSdfPixels/);
  assert.match(source, /gl\.uniform1f\(program\.uniforms\.midReliefStrength, Style\.terrainShading\.midReliefStrength\)/);
  assert.match(source, /gl\.uniform1f\(program\.uniforms\.facetMix, Style\.terrainShading\.mountainFacetMix\)/);
  assert.match(source, /gl\.uniform1f\(program\.uniforms\.detailNormalStrength, Style\.terrainShading\.microDetailStrength\)/);
  assert.match(source, /gl\.uniform1f\(program\.uniforms\.reliefCompressionStart, Style\.relief\.compressionStart\)/);
  assert.match(source, /gl\.uniform1f\(program\.uniforms\.waterNoiseAmplitude, water\.noiseAmplitude\)/);
  assert.match(source, /gl\.uniform1f\(program\.uniforms\.waterSpecularStrength, water\.specularStrength\)/);
  assert.match(source, /gl\.uniform1f\(program\.uniforms\.waterFresnelStrength, water\.fresnelStrength\)/);
  assert.match(source, /gl\.uniform1f\(program\.uniforms\.waterBathymetryInfluence, water\.bathymetryInfluence\)/);
  assert.match(source, /const requested = SurfaceTexture\.defaults\.width/);
  assert.match(source, /dpr = Math\.min\(3, ratio \|\| 1\)/);
  assert.equal(loadGlobeContext().OrbitPlanetSurfaceTexture.defaults.width, 2048);
  assert.equal(loadGlobeContext().OrbitPlanetSurfaceTexture.defaults.height, 1024);
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.topography.contourOpacity, 0,
    'regular elevation contour bands are disabled to prevent false shadow waves');
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.topography.majorOpacity, 0);
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.water.noiseAmplitude, .03);
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.water.normalStrength, .02);
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.water.specularStrength, .10);
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.water.fresnelStrength, .05);
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.water.shallow, '#42A4AE');
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.water.mid, '#176F91');
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.water.deep, '#073B5C');
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.water.bathymetryInfluence, .16);
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.terrainShading.midReliefStrength, 1.25);
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.terrainShading.mountainFacetMix, .24);
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.terrainShading.microDetailStrength, 0);
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.terrainShading.mountainAoStrength, .055);
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.terrainShading.ridgeAccentStrength, .10);
  assert.equal(loadGlobeContext().OrbitPlanetGlobeStyle.terrainShading.mountainMaterials.temperate.ridge, '#DCC59D');
  assert.match(readFileSync(resolve(__dirname, '../src/rendering/planetSurfaceTexture.js'), 'utf8'),
    /const albedoWidth = Math\.min\(width, 1024\)/,
  'color albedo generation stays bounded for mobile while height and coast maps keep full resolution');
});

test('globe atmosphere has climate materials and the vignette stays behind the globe', () => {
  const { OrbitPlanetGlobeStyle: style } = loadGlobeContext();
  assert.equal(style.atmosphere.colors.tellurique, '#64C9E8');
  assert.equal(style.atmosphere.colors.océanique, '#35D2F2');
  assert.equal(style.atmosphere.colors.glacée, '#C4E9F5');
  assert.equal(style.atmosphere.colors.aride, '#F0B76C');
  assert.equal(style.atmosphere.colors.volcanique, '#FF6336');
  assert.ok(style.atmosphere.haloScale > 1 && style.atmosphere.shellScale > 1);
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
  assert.match(css, /#planet-globe\{[^}]*z-index:1/);
  assert.match(css, /\.vignette\{z-index:0\}/);
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
  for (const file of ['../src/data/worldgen.js', '../src/world.js', '../src/world/tectonics.js', '../src/world/terrainElevation.js', '../src/world/thermalErosion.js', '../src/world/terrainStructure.js', '../src/data/planetGlobeStyle.js',
    '../src/rendering/planetGlobeProjection.js']) {
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
