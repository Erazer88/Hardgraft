(function (root) {
  'use strict';

  const World = root.OrbitWorld;
  const Projection = root.OrbitPlanetGlobeProjection;
  const DEFAULT_WIDTH = 1024;
  const DEFAULT_HEIGHT = 512;
  const MAX_CACHE_ENTRIES = 4;
  const textureCache = new Map();
  const noiseKernels = new Map();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smoothstep = (a, b, value) => {
    const t = clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  const PALETTES = Object.freeze({
    temperate: Object.freeze({ deepOcean: '#1b4f6c', ocean: '#276b89', shallow: '#276b89',
      coast: '#aaa779', wetLowland: '#5f824f', lowland: '#6b9049', dryLowland: '#858258',
      upland: '#77755e', rock: '#8f8272', highRock: '#8f8272', snow: '#d6dbd6',
      seaIce: '#a8c3cb', polarIce: '#b9cdd2' }),
    frozen: Object.freeze({ seaIce: '#a8c3cb', brightIce: '#b9cdd2', fracture: '#8d9290',
      lowland: '#d9dfdc', rock: '#8d9290', highRock: '#9da8a8', snow: '#d9dfdc' }),
    arid: Object.freeze({ basin: '#79462f', lowland: '#a95f37', sand: '#bd7547',
      upland: '#995331', rock: '#713f31', highRock: '#8a6657', polarIce: '#b9cdd2' }),
    volcanic: Object.freeze({ deepLava: '#8c250f', lava: '#e54a13', hotLava: '#ff8b28',
      lowBasalt: '#382f2c', basalt: '#443631', upland: '#554039', highland: '#675047' })
  });
  const COLOR_PALETTES = Object.freeze(Object.fromEntries(Object.entries(PALETTES).map(([climate, palette]) =>
    [climate, Object.freeze(Object.fromEntries(Object.entries(palette).map(([name, value]) => [name, hexColor(value)])))])));

  function hexColor(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function noiseKernel(seed) {
    const key = seed >>> 0;
    if (noiseKernels.has(key)) return noiseKernels.get(key);
    const random = World.rng(key), wave = new Float32Array(20);
    for (let i = 0; i < 4; i += 1) {
      const y = random() * 2 - 1, angle = random() * Math.PI * 2;
      const horizontal = Math.sqrt(1 - y * y), frequency = .72 + random() * .72;
      const offset = i * 5;
      wave[offset] = Math.cos(angle) * horizontal * frequency;
      wave[offset + 1] = y * frequency;
      wave[offset + 2] = Math.sin(angle) * horizontal * frequency;
      wave[offset + 3] = random() * Math.PI * 2;
      wave[offset + 4] = .72 + random() * .56;
    }
    const kernel = Object.freeze({ wave, normalization: 1 / 4.96 });
    noiseKernels.set(key, kernel);
    if (noiseKernels.size > 20) noiseKernels.delete(noiseKernels.keys().next().value);
    return kernel;
  }

  // A small, seeded set of 3D waves gives continuous spherical noise
  // without a costly two-dimensional UV seam or a large per-pixel lattice.
  function noise3(x, y, z, seed) {
    const { wave, normalization } = noiseKernel(seed);
    let value = 0;
    for (let i = 0; i < 20; i += 5) {
      value += Math.sin(x * wave[i] + y * wave[i + 1] + z * wave[i + 2] + wave[i + 3]) * wave[i + 4];
    }
    return value * normalization;
  }

  function fbm3(x, y, z, seed, octaves) {
    let value = 0, amplitude = 1, total = 0, currentSeed = seed >>> 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      value += noise3(x, y, z, currentSeed) * amplitude;
      total += amplitude;
      x *= 2.03; y *= 2.03; z *= 2.03;
      amplitude *= .5;
      currentSeed = (currentSeed + 0x6d2b79f5) >>> 0;
    }
    return value / total;
  }

  function createFieldSampler(values, terrain) {
    const width = terrain.width, height = terrain.height;
    const edges = new Float32Array(height);
    for (let y = 0; y < height; y += 1) {
      const offset = y * width;
      edges[y] = (values[offset] + values[offset + width - 1]) * .5;
    }
    const capRows = Math.max(0, Math.min(height - 2, Math.ceil((height - 1) * 12 / 180)));
    function capAverage(north) {
      const first = north ? 0 : height - 1 - capRows, last = north ? capRows : height - 1;
      let sum = 0, weightSum = 0;
      for (let row = first; row <= last; row += 1) {
        const latitude = (.5 - row / Math.max(1, height - 1)) * Math.PI;
        const weight = Math.max(.02, Math.cos(latitude)), offset = row * width;
        for (let column = 0; column < width; column += 1) {
          sum += values[offset + column] * weight;
          weightSum += weight;
        }
      }
      return sum / (weightSum || 1);
    }
    const northCap = capAverage(true), southCap = capAverage(false);
    return function sample(x, y) {
      const px = clamp(x, 0, width - 1), py = clamp(y, 0, height - 1);
      const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
      const tx = px - x0, ty = py - y0, row0 = y0 * width, row1 = y1 * width;
      const a = values[row0 + x0] * (1 - tx) + values[row0 + x1] * tx;
      const b = values[row1 + x0] * (1 - tx) + values[row1 + x1] * tx;
      let result = a * (1 - ty) + b * ty;
      const edgeFraction = Math.min(px, width - 1 - px) / Math.max(1, width - 1);
      const edgeT = clamp(edgeFraction / .035, 0, 1), edgeSmooth = edgeT * edgeT * (3 - 2 * edgeT);
      const seamBlend = 1 - edgeSmooth;
      if (seamBlend > 0) {
        const edge = edges[y0] * (1 - ty) + edges[y1] * ty;
        result += (edge - result) * seamBlend;
      }
      // Collapse longitude only in the last polar band, where the equirectangular
      // map truly becomes singular. Keep the continents broad up to that point.
      const latitude = Math.abs((.5 - py / Math.max(1, height - 1)) * Math.PI);
      const polarBlend = smoothstep(82 * Math.PI / 180, 89.5 * Math.PI / 180, latitude);
      const cap = py < height * .5 ? northCap : southCap;
      result += (cap - result) * polarBlend;
      return result;
    };
  }

  function climateOf(planet) {
    if (planet?.kind === 'glacée') return 'frozen';
    if (planet?.kind === 'aride') return 'arid';
    if (planet?.kind === 'volcanique') return 'volcanic';
    return 'temperate';
  }

  function createCraters(seed) {
    const random = World.rng(seed >>> 0);
    const count = 8 + Math.floor(random() * 11);
    const smallCount = 20 + Math.floor(random() * 31);
    const craters = [];
    for (let i = 0; i < count + smallCount; i += 1) {
      const y = random() * 2 - 1;
      const longitude = random() * Math.PI * 2 - Math.PI;
      const latitude = Math.asin(y);
      const medium = i < count;
      const radius = medium ? .055 + random() * .055 : .022 + random() * .024;
      craters.push({ longitude, latitude,
        radius, rimWidth: radius * (medium ? .25 : .32), depth: medium ? .35 : .22,
        rim: medium ? .24 : .15 });
    }
    return craters;
  }

  function craterField(width, height, craters) {
    const field = new Float32Array(width * height);
    for (const crater of craters) {
      const firstRow = Math.max(0, Math.floor((.5 - (crater.latitude + crater.radius)) * height));
      const lastRow = Math.min(height - 1, Math.ceil((.5 - (crater.latitude - crater.radius)) * height));
      for (let row = firstRow; row <= lastRow; row += 1) {
        const v = row / (height - 1), latitude = (.5 - v) * Math.PI;
        const latDelta = latitude - crater.latitude;
        const cosLatitude = Math.max(.08, Math.cos((latitude + crater.latitude) * .5));
        const longitudeRadius = Math.min(Math.PI, crater.radius / cosLatitude);
        const centerX = ((crater.longitude / (Math.PI * 2) + .5) * width + width) % width;
        const columnRadius = Math.ceil(longitudeRadius * width / (Math.PI * 2)) + 1;
        const rowWeight = Math.cos(latitude);
        for (let offset = -columnRadius; offset <= columnRadius; offset += 1) {
          let column = Math.round(centerX + offset);
          column %= width; if (column < 0) column += width;
          const u = column / width, longitude = (u - .5) * Math.PI * 2;
          let lonDelta = longitude - crater.longitude;
          if (lonDelta > Math.PI) lonDelta -= Math.PI * 2;
          else if (lonDelta < -Math.PI) lonDelta += Math.PI * 2;
          const distance = Math.hypot(latDelta, lonDelta * cosLatitude);
          const ratio = distance / crater.radius;
          if (ratio >= 1.18) continue;
          const bowl = smoothstep(1.03, .18, ratio);
          const rim = Math.exp(-Math.pow((ratio - 1) / crater.rimWidth, 2));
          const outside = Math.exp(-Math.pow((ratio - 1.11) / .08, 2));
          const value = -crater.depth * bowl + crater.rim * rim - crater.depth * .22 * outside;
          const index = row * width + column;
          if (Math.abs(value) > Math.abs(field[index])) field[index] = value * rowWeight;
        }
      }
    }
    return field;
  }

  function mixInto(output, a, b, amount) {
    const t = clamp(amount, 0, 1);
    output[0] = a[0] + (b[0] - a[0]) * t;
    output[1] = a[1] + (b[1] - a[1]) * t;
    output[2] = a[2] + (b[2] - a[2]) * t;
  }

  function copyInto(output, input) {
    output[0] = input[0]; output[1] = input[1]; output[2] = input[2];
  }

  function colorFor(climate, elevation, seaLevel, basinLevel, moisture, latitude, detail, temperature, crater, output, work) {
    const palette = COLOR_PALETTES[climate];
    const h = clamp((elevation - seaLevel) / Math.max(1, 255 - seaLevel), 0, 1);
    const depth = clamp((seaLevel - elevation) / 58, 0, 1);
    const humidity = clamp(moisture, 0, 1), absoluteLatitude = Math.abs(latitude);
    const localTemperature = temperature - Math.pow(Math.abs(Math.sin(latitude)), 1.55) * 38 - h * 32;
    const base = work.a, land = work.b, temporary = work.c;
    const polarMask = smoothstep(1.36, 1.50, absoluteLatitude);
    let emission = 0;

    if (climate === 'temperate') {
      if (depth > .56) mixInto(base, palette.ocean, palette.deepOcean, smoothstep(.56, 1, depth));
      else mixInto(base, palette.shallow, palette.ocean, smoothstep(.04, .56, depth));
      if (h < .30) mixInto(land, palette.dryLowland, palette.wetLowland, humidity);
      else if (h < .58) mixInto(land, palette.upland, palette.rock, smoothstep(.30, .58, h) * .38);
      else mixInto(land, palette.rock, palette.highRock, smoothstep(.58, .92, h));
      const snow = 1 - smoothstep(-4, 5, localTemperature);
      const summitCoverage = smoothstep(.70, .96, h) * .42;
      mixInto(temporary, land, palette.snow, clamp(snow * summitCoverage, 0, .48));
      const coast = smoothstep(seaLevel - 1.5, seaLevel + 1.5, elevation);
      mixInto(land, base, temporary, coast);
      copyInto(base, land);
    } else if (climate === 'frozen') {
      if (elevation <= seaLevel) {
        const iceVariation = clamp(.5 + detail.medium * .08 + detail.fine * .04, 0, 1);
        mixInto(base, palette.seaIce, palette.brightIce, iceVariation);
        const crack = smoothstep(.966, .994, 1 - Math.abs(detail.crack));
        mixInto(temporary, base, palette.fracture, crack * .18);
        copyInto(base, temporary);
      } else {
        mixInto(base, palette.lowland, palette.rock, smoothstep(.20, .64, h) * .62);
        mixInto(temporary, base, palette.highRock, smoothstep(.52, .86, h) * .55);
        copyInto(base, temporary);
        const summitSnow = smoothstep(.42, .82, h) * .36;
        mixInto(temporary, base, palette.snow, Math.max(.18, summitSnow));
        copyInto(base, temporary);
      }
    } else if (climate === 'arid') {
      if (h < .12) mixInto(base, palette.lowland, palette.sand, humidity * .20 + smoothstep(0, .12, h) * .16);
      else if (h < .52) mixInto(base, palette.sand, palette.upland, smoothstep(.12, .52, h) * .7);
      else mixInto(base, palette.rock, palette.highRock, smoothstep(.52, .94, h));
      const basinCoast = smoothstep(basinLevel - 1.5, basinLevel + 1.5, elevation);
      mixInto(temporary, palette.basin, base, basinCoast);
      copyInto(base, temporary);
      const craterBowl = smoothstep(.04, .34, -crater), craterRim = smoothstep(.06, .22, crater);
      mixInto(temporary, base, palette.basin, craterBowl * .52);
      mixInto(land, temporary, palette.sand, craterRim * .5);
      copyInto(base, land);
      const bands = Math.sin(elevation * .22 + detail.geology * 3.2) * .018 + detail.medium * .012;
      const geologicalBrightness = 1 + bands + crater;
      base[0] *= geologicalBrightness; base[1] *= geologicalBrightness; base[2] *= geologicalBrightness;
    } else {
      if (h < .18) mixInto(base, palette.lowBasalt, palette.basalt, smoothstep(0, .18, h));
      else if (h < .60) mixInto(base, palette.basalt, palette.upland, smoothstep(.18, .60, h));
      else mixInto(base, palette.upland, palette.highland, smoothstep(.60, .96, h));
      const fissure = smoothstep(.975, .995, 1 - Math.abs(detail.crack));
      mixInto(temporary, base, palette.deepLava, fissure * .16);
      copyInto(base, temporary);
      emission = fissure * .03;
      const flow = clamp(.5 + detail.lava * .45 + detail.ridge * .34, 0, 1);
      const hot = smoothstep(.72, .98, detail.ridge + detail.lava * .35);
      const lavaStrength = 1 - smoothstep(basinLevel - 1.5, basinLevel + 1.5, elevation);
      mixInto(land, palette.deepLava, palette.lava, smoothstep(.25, .78, flow));
      mixInto(temporary, land, palette.hotLava, hot * .34);
      copyInto(land, temporary);
      mixInto(temporary, base, land, lavaStrength);
      copyInto(base, temporary);
      emission = (emission * (1 - lavaStrength) +
        clamp(hot * .10 + smoothstep(.86, .99, flow) * .06, 0, .12) * lavaStrength) * (1 - polarMask);
    }

    // Equirectangular map rows collapse to a single point at each pole. Fill
    // that singular area with a quiet climate material instead of letting
    // unrelated map longitudes converge into a bright, pinched patch.
    const polarCap = work.d;
    if (climate === 'temperate') {
      const ice = 1 - smoothstep(-2, 8, localTemperature);
      const iceMaterial = elevation <= seaLevel ? palette.seaIce : palette.polarIce;
      mixInto(polarCap, palette.upland, iceMaterial, ice);
    } else if (climate === 'frozen') {
      copyInto(polarCap, elevation <= seaLevel ? palette.seaIce : palette.brightIce);
    } else if (climate === 'arid') {
      const ice = 1 - smoothstep(-2, 8, localTemperature);
      mixInto(polarCap, palette.highRock, palette.polarIce, ice);
    } else copyInto(polarCap, palette.basalt);
    mixInto(temporary, base, polarCap, polarMask);
    copyInto(base, temporary);

    const polarDetailFade = 1 - smoothstep(1.36, 1.50, absoluteLatitude);
    const brightness = 1 + detail.macro * .02 + detail.medium * .015 + detail.fine * .008;
    output[0] = clamp(base[0] * brightness, 0, 245);
    output[1] = clamp(base[1] * brightness, 0, 245);
    output[2] = clamp(base[2] * brightness, 0, 245);
    output[3] = emission * polarDetailFade;
  }

  function create(terrain, planet, options = {}) {
    const width = Math.max(1, Math.floor(options.width || DEFAULT_WIDTH));
    const height = Math.max(1, Math.floor(options.height || DEFAULT_HEIGHT));
    const id = String(planet?.id ?? 'planet');
    const planetSeed = String(planet?.seed ?? '0');
    const key = `${id}:${planetSeed}`;
    const cached = options.cache === false || width !== DEFAULT_WIDTH || height !== DEFAULT_HEIGHT ? null : textureCache.get(key);
    if (cached) {
      textureCache.delete(key); textureCache.set(key, cached);
      return cached;
    }

    const surfaceSeed = World.hashSeed(`${planetSeed}:surface-v2`);
    const colorSeed = surfaceSeed ^ 0x014aa291;
    const detailSeed = surfaceSeed ^ 0x073e291b;
    const geologySeed = surfaceSeed ^ 0x0b592bf1;
    const craterSeed = surfaceSeed ^ 0x031f89cd;
    const iceSeed = surfaceSeed ^ 0x084ca187;
    const climate = climateOf(planet), temperature = Number.isFinite(planet?.temperature) ? planet.temperature : 16;
    const craters = climate === 'arid' ? craterField(width, height, createCraters(craterSeed)) : null;
    const pixels = new Uint8Array(width * height * 4);
    const colorOutput = new Float32Array(4), colorWork = { a: new Float32Array(3),
      b: new Float32Array(3), c: new Float32Array(3), d: new Float32Array(3) };
    const detailPixels = new Uint8Array(width * height);
    const detail = { macro: 0, medium: 0, fine: 0, crack: 0, ridge: 0, lava: 0, geology: 0 };
    const rowDirections = new Array(height), longitudeDirections = new Array(width);
    for (let px = 0; px < width; px += 1) {
      const longitude = (px / width - .5) * Math.PI * 2;
      longitudeDirections[px] = { cos: Math.cos(longitude), sin: Math.sin(longitude) };
    }
    for (let py = 0; py < height; py += 1) {
      const v = py / (height - 1 || 1), latitude = (.5 - v) * Math.PI;
      rowDirections[py] = { latitude, cos: Math.cos(latitude), sin: Math.sin(latitude),
        y: Math.sin(latitude), mapY: v * (terrain.height - 1) };
    }
    const seaLevel = Number.isFinite(terrain?.seaLevel) ? terrain.seaLevel : 0;
    let basinLevel = seaLevel;
    if (climate === 'arid' || climate === 'volcanic') {
      const histogram = new Uint32Array(256);
      for (let i = 0; i < terrain.elevation.length; i += 1) histogram[terrain.elevation[i]] += 1;
      const target = Math.floor(terrain.elevation.length * (climate === 'arid' ? .16 : .20));
      let count = 0;
      for (let level = 0; level < histogram.length; level += 1) {
        count += histogram[level];
        if (count >= target) { basinLevel = Math.max(seaLevel, level); break; }
      }
    }
    const sampleElevation = createFieldSampler(terrain.elevation, terrain);
    const sampleMoisture = climate === 'temperate' || climate === 'arid'
      ? createFieldSampler(terrain.moisture, terrain) : null;
    for (let py = 0; py < height; py += 1) {
      const row = rowDirections[py], mapY = row.mapY, offset = py * width;
      for (let px = 0; px < width; px += 1) {
        const u = px / width, longitude = longitudeDirections[px];
        const nx = row.cos * longitude.cos, ny = row.y, nz = row.cos * longitude.sin;
        const mapX = u * (terrain.width - 1);
        const elevation = sampleElevation(mapX, mapY, row.latitude);
        const moisture = sampleMoisture ? sampleMoisture(mapX, mapY, row.latitude) / 255 : .5;
        const macro = fbm3(nx * 2.2, ny * 2.2, nz * 2.2, colorSeed, 2);
        const medium = noise3(nx * 7, ny * 7, nz * 7, geologySeed);
        const fine = noise3(nx * 24, ny * 24, nz * 24, climate === 'frozen' ? iceSeed : detailSeed);
        const crater = craters ? craters[offset + px] : 0;
        detail.macro = macro; detail.medium = medium; detail.fine = fine; detail.crack = fine;
        detail.ridge = 1 - Math.abs(medium); detail.lava = .62 * macro + .38 * medium; detail.geology = medium;
        const index = (offset + px) * 4;
        colorFor(climate, elevation, seaLevel, basinLevel, moisture, row.latitude, detail,
          temperature, crater, colorOutput, colorWork);
        pixels[index] = Math.round(colorOutput[0]);
        pixels[index + 1] = Math.round(colorOutput[1]);
        pixels[index + 2] = Math.round(colorOutput[2]);
        pixels[index + 3] = Math.round(colorOutput[3] * 255);
        const heightDetail = clamp(.5 + medium * .23 + fine * .19, 0, 1);
        detailPixels[offset + px] = Math.round(heightDetail * 255);
      }
    }
    const texture = Object.freeze({ width, height, pixels, detailPixels, key, climate });
    if (options.cache !== false && width === DEFAULT_WIDTH && height === DEFAULT_HEIGHT) {
      textureCache.set(key, texture);
      while (textureCache.size > MAX_CACHE_ENTRIES) textureCache.delete(textureCache.keys().next().value);
    }
    return texture;
  }

  root.OrbitPlanetSurfaceTexture = Object.freeze({ create, cacheKey: planet => `${planet?.id ?? 'planet'}:${planet?.seed ?? '0'}`,
    defaults: Object.freeze({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }), palettes: PALETTES,
    clearCache: () => textureCache.clear() });
})(globalThis);
