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
    temperate: Object.freeze({ deepOcean: '#0F4C6C', ocean: '#1E6A8C', shallow: '#3A8DA8',
      coast: '#B8B07E', wetPlain: '#5F8748', plain: '#749654', dryPlain: '#8C8A58',
      upland: '#7A8158', highland: '#8B8468', rock: '#8A7C6B', highRock: '#A19482',
      snow: '#D9DDD8', coldSnow: '#C8D6D9', polarIce: '#BFD2D7',
      seaIce: '#83AEB9', packedSeaIce: '#B5CCD0', iceCrack: '#688D98' }),
    frozen: Object.freeze({ seaIce: '#6D94A2', packedIce: '#9BBBC6', brightIce: '#CBDDE2',
      coldRock: '#68777D', darkColdRock: '#4B5D64', ridgeShadow: '#35464D',
      snow: '#D8E2E4', blueSnow: '#B4CED6', crackTint: '#567F8E', polarCore: '#527C8B' }),
    arid: Object.freeze({ basin: '#7C4731', lowland: '#A95F3C', plain: '#C57848', sand: '#D28A57',
      plateau: '#A15C3B', upland: '#8D4F37', rock: '#6F4032', darkRock: '#5B342B',
      dust: '#E0B289', polarFrost: '#DDD6CA', coldFrost: '#CFC8BD' }),
    volcanic: Object.freeze({ deepLava: '#7A1F12', lava: '#D94A17', hotLava: '#FF8A2A',
      coreLava: '#FFD06A', basaltDark: '#2E2524', basalt: '#423230', warmBasalt: '#58423B',
      ashRock: '#6A5048', emberCrack: '#A92F1E', cooledCrust: '#231C1C' })
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
    return function sample(x, y) {
      const px = clamp(x, 0, width - 1), py = clamp(y, 0, height - 1);
      const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
      const tx = px - x0, ty = py - y0, row0 = y0 * width, row1 = y1 * width;
      const a = values[row0 + x0] * (1 - tx) + values[row0 + x1] * tx;
      const b = values[row1 + x0] * (1 - tx) + values[row1 + x1] * tx;
      return a * (1 - ty) + b * ty;
    };
  }

  function climateOf(planet) {
    if (planet?.kind === 'glacée') return 'frozen';
    if (planet?.kind === 'aride') return 'arid';
    if (planet?.kind === 'volcanique') return 'volcanic';
    return 'temperate';
  }

  function polarIceThreshold(temperature) {
    // Warmer planets keep ice close to the poles; a colder global climate
    // moves the mean cap edge toward the equator.
    return clamp(.88 + ((Number.isFinite(temperature) ? temperature : 16) - 16) * .0035, .50, .975);
  }

  function polarIceCoverage(nx, ny, nz, temperature, seed) {
    const threshold = polarIceThreshold(temperature);
    const absoluteLatitude = Math.abs(ny);
    if (absoluteLatitude < threshold - .18) return 0;
    const broadBoundary = fbm3(nx * 3.25, ny * 3.25, nz * 3.25, seed ^ 0x2b79a4d1, 3);
    const coastBreakup = noise3(nx * 9.2, ny * 9.2, nz * 9.2, seed ^ 0x6c8e9cf5);
    // Keep the contour away from the singular point so every pole converges
    // to a clean, fully covered cap regardless of seed.
    const irregularThreshold = clamp(threshold + broadBoundary * .40 + coastBreakup * .11, .46, .965);
    return smoothstep(irregularThreshold - .018, irregularThreshold + .018, absoluteLatitude);
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

  function rgbToHsl(red, green, blue, output) {
    const r = red / 255, g = green / 255, b = blue / 255;
    const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
    const delta = maximum - minimum;
    let hue = 0, saturation = 0;
    const lightness = (maximum + minimum) * .5;
    if (delta > 1e-8) {
      saturation = delta / (1 - Math.abs(2 * lightness - 1));
      if (maximum === r) hue = ((g - b) / delta) % 6;
      else if (maximum === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue = (hue * 60 + 360) % 360;
    }
    output[0] = hue; output[1] = saturation; output[2] = lightness;
    return output;
  }

  function hslToRgb(hue, saturation, lightness, output) {
    const h = ((hue % 360) + 360) % 360 / 60;
    const s = clamp(saturation, 0, 1), l = clamp(lightness, 0, 1);
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const secondary = chroma * (1 - Math.abs(h % 2 - 1));
    let r = 0, g = 0, b = 0;
    if (h < 1) { r = chroma; g = secondary; }
    else if (h < 2) { r = secondary; g = chroma; }
    else if (h < 3) { g = chroma; b = secondary; }
    else if (h < 4) { g = secondary; b = chroma; }
    else if (h < 5) { r = secondary; b = chroma; }
    else { r = chroma; b = secondary; }
    const match = l - chroma * .5;
    output[0] = (r + match) * 255;
    output[1] = (g + match) * 255;
    output[2] = (b + match) * 255;
    return output;
  }

  function tintHsl(color, { hueShift = 0, satMul = 1, lightMul = 1 } = {}, output = new Float32Array(3), work = new Float32Array(3)) {
    rgbToHsl(color[0], color[1], color[2], work);
    return hslToRgb(work[0] + hueShift, work[1] * satMul, work[2] * lightMul, output);
  }

  function climateSaturationFloor(climate) {
    return climate === 'temperate' ? .18 : climate === 'frozen' ? .08 : climate === 'arid' ? .24 : .22;
  }

  function finishMaterialColor(climate, base, detail, output, work) {
    work.tint.hueShift = detail.geology * 6;
    work.tint.satMul = 1 + detail.fine * .1;
    work.tint.lightMul = 1 + detail.macro * .08;
    tintHsl(base, work.tint, work.tinted, work.hsl);
    rgbToHsl(work.tinted[0], work.tinted[1], work.tinted[2], work.hsl);
    const hsl = work.hsl;
    const saturationFloor = hsl[2] > .82 ? Math.min(.08, climateSaturationFloor(climate)) : climateSaturationFloor(climate);
    const midToneWeight = 1 - smoothstep(.74, .94, hsl[2]);
    hsl[1] = clamp(Math.max(hsl[1], saturationFloor) * (1 + midToneWeight * .08), saturationFloor, .94);
    // Separate adjacent materials at the source while preserving the
    // deliberately restrained hues and preventing ice from clipping white.
    hsl[2] = clamp(.5 + (hsl[2] - .5) * 1.13, 0, .94);
    hslToRgb(hsl[0], hsl[1], hsl[2], output);
    output[0] = clamp(output[0], 0, 245);
    output[1] = clamp(output[1], 0, 245);
    output[2] = clamp(output[2], 0, 245);
  }

  function colorFor(climate, elevation, seaLevel, basinLevel, moisture, latitude, detail, temperature,
    crater, polarCoverage, output, work) {
    const palette = COLOR_PALETTES[climate];
    const h = clamp((elevation - seaLevel) / Math.max(1, 255 - seaLevel), 0, 1);
    const depth = clamp((seaLevel - elevation) / 42, 0, 1);
    const humidity = clamp(moisture, 0, 1), absoluteLatitude = Math.abs(latitude);
    const localTemperature = temperature - Math.pow(Math.abs(Math.sin(latitude)), 1.55) * 38 - h * 32;
    const base = work.a, land = work.b, temporary = work.c;

    if (climate === 'temperate') {
      if (elevation <= seaLevel) {
        if (depth > .62) mixInto(base, palette.ocean, palette.deepOcean, smoothstep(.62, 1, depth));
        else if (depth > .14) mixInto(base, palette.shallow, palette.ocean, smoothstep(.14, .62, depth));
        else copyInto(base, palette.shallow);
        if (polarCoverage > 0) {
          mixInto(temporary, palette.seaIce, palette.packedSeaIce,
            clamp(.48 + detail.medium * .24 + detail.fine * .12, 0, 1));
          const seaCrack = smoothstep(.965, .995, 1 - Math.abs(detail.crack));
          mixInto(land, temporary, palette.iceCrack, seaCrack * .14);
          mixInto(temporary, base, land, polarCoverage * .96);
          copyInto(base, temporary);
        }
      } else if (h < .04) copyInto(base, palette.coast);
      else if (h < .28) {
        mixInto(base, palette.dryPlain, palette.plain, .32 + humidity * .36);
        mixInto(temporary, base, palette.wetPlain, smoothstep(.48, .9, humidity) * .62);
        copyInto(base, temporary);
      }
      else if (h < .50) mixInto(base, palette.plain, palette.upland, smoothstep(.28, .50, h));
      else if (h < .72) mixInto(base, palette.upland, palette.highland, smoothstep(.50, .72, h));
      else if (h < .88) mixInto(base, palette.rock, palette.highRock, smoothstep(.72, .88, h));
      else copyInto(base, palette.highRock);
      const snow = 1 - smoothstep(-4, 5, localTemperature);
      const summitSnow = smoothstep(.78, .96, h) * .46;
      // Local temperature still dusts cold highlands, while the actual polar
      // cap outline comes from the irregular spherical coverage field above.
      const snowCoverage = Math.max(snow * .10, summitSnow, polarCoverage * .94);
      if (elevation > seaLevel) {
        mixInto(temporary, palette.snow, palette.coldSnow,
          clamp(smoothstep(.42, .96, absoluteLatitude) * .52 + polarCoverage * .42, 0, .92));
        mixInto(land, base, temporary, clamp(snowCoverage, 0, .88));
        copyInto(base, land);
      }
    } else if (climate === 'frozen') {
      if (elevation <= seaLevel) {
        // Ice thickness varies in broad spherical plates; the polar core is
        // colder and denser, with fractures kept visible over both regions.
        const iceThickness = clamp(.50 + depth * .12 + detail.macro * 1.5 +
          detail.medium * .45 + detail.fine * .18, 0, 1);
        mixInto(base, palette.seaIce, palette.packedIce, iceThickness);
        mixInto(temporary, base, palette.polarCore, polarCoverage * .60);
        copyInto(base, temporary);
      } else {
        if (h < .24) mixInto(base, palette.seaIce, palette.packedIce, .28 + smoothstep(0, .24, h) * .40);
        else if (h < .58) mixInto(base, palette.packedIce, palette.coldRock, smoothstep(.24, .58, h) * .48);
        else mixInto(base, palette.coldRock, palette.brightIce, smoothstep(.58, .9, h) * .24);
        const broadRockExposure = smoothstep(.10, .42, h) * clamp(.44 + detail.ridge * .45, .30, .82);
        mixInto(temporary, base, palette.coldRock, broadRockExposure * .58);
        copyInto(base, temporary);
        const exposedRidge = smoothstep(.20, .55, h) * smoothstep(.58, .86, detail.ridge);
        mixInto(temporary, base, palette.darkColdRock, exposedRidge * .68);
        copyInto(base, temporary);
        const ridgeShadow = smoothstep(.82, .96, detail.ridge) * smoothstep(.18, .48, h) * .28;
        mixInto(temporary, base, palette.ridgeShadow, ridgeShadow);
        copyInto(base, temporary);
        const compactLowlandIce = polarCoverage * (1 - smoothstep(.16, .52, h)) * .42;
        mixInto(temporary, base, palette.polarCore, compactLowlandIce);
        copyInto(base, temporary);
        const snowCoverage = Math.max(smoothstep(.78, .96, h) * .18,
          polarCoverage * .22, (1 - smoothstep(-30, -8, localTemperature)) * .10);
        mixInto(temporary, base, palette.blueSnow, clamp(snowCoverage, 0, .26));
        copyInto(base, temporary);
        mixInto(temporary, base, palette.snow, smoothstep(.92, .995, h) * .12);
        copyInto(base, temporary);
      }
      const crack = smoothstep(.935, .99, 1 - Math.abs(detail.crack));
      mixInto(temporary, base, palette.crackTint, crack * (elevation <= seaLevel ? .42 : .26));
      copyInto(base, temporary);
    } else if (climate === 'arid') {
      if (elevation <= basinLevel) {
        const basinDepth = clamp((basinLevel - elevation) / 24, 0, 1);
        mixInto(base, palette.lowland, palette.basin, .28 + basinDepth * .58);
      } else if (h < .16) mixInto(base, palette.lowland, palette.plain, smoothstep(.02, .16, h) * .46);
      else if (h < .42) mixInto(base, palette.plain, palette.sand, smoothstep(.16, .42, h) * .52 + humidity * .08);
      else if (h < .65) mixInto(base, palette.plateau, palette.upland, smoothstep(.42, .65, h));
      else if (h < .88) mixInto(base, palette.upland, palette.rock, smoothstep(.65, .88, h));
      else mixInto(base, palette.rock, palette.darkRock, smoothstep(.88, 1, h));
      const craterBowl = smoothstep(.04, .34, -crater), craterRim = smoothstep(.06, .22, crater);
      mixInto(temporary, base, palette.darkRock, craterBowl * .58);
      mixInto(land, temporary, palette.dust, craterRim * .22);
      copyInto(base, land);
      const frost = Math.max(1 - smoothstep(-3, 7, localTemperature), polarCoverage);
      mixInto(temporary, base, palette.coldFrost, clamp(frost * .34, 0, .34));
      mixInto(land, temporary, palette.polarFrost, polarCoverage * .18);
      copyInto(base, land);
    } else {
      if (h < .32) mixInto(base, palette.basaltDark, palette.basalt, smoothstep(0, .32, h));
      else if (h < .70) mixInto(base, palette.basalt, palette.warmBasalt, smoothstep(.32, .70, h));
      else mixInto(base, palette.warmBasalt, palette.ashRock, smoothstep(.70, .94, h));
      const fissure = smoothstep(.978, .997, 1 - Math.abs(detail.crack));
      mixInto(temporary, base, palette.emberCrack, fissure * .34);
      copyInto(base, temporary);
      const flow = clamp(.5 + detail.lava * .45 + detail.ridge * .34, 0, 1);
      const hot = smoothstep(.74, .985, detail.ridge + detail.lava * .28);
      const core = smoothstep(.97, .999, detail.ridge + detail.lava * .18);
      const lavaStrength = 1 - smoothstep(basinLevel - 1.5, basinLevel + 1.5, elevation);
      mixInto(land, palette.deepLava, palette.lava, smoothstep(.16, .80, flow));
      const lavaShore = smoothstep(.12, .48, lavaStrength) * (1 - smoothstep(.72, .98, lavaStrength));
      mixInto(temporary, land, palette.hotLava, clamp(hot * .22 + lavaShore * .14, 0, .34));
      mixInto(land, temporary, palette.coreLava, core * .12);
      mixInto(temporary, base, land, lavaStrength);
      copyInto(base, temporary);
    }

    finishMaterialColor(climate, base, detail, output, work);
    output[3] = 0;
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
    const polarSeed = surfaceSeed ^ 0x5b1ce8a3;
    const climate = climateOf(planet), temperature = Number.isFinite(planet?.temperature) ? planet.temperature : 16;
    const polarThreshold = polarIceThreshold(temperature);
    const craters = climate === 'arid' ? craterField(width, height, createCraters(craterSeed)) : null;
    const pixels = new Uint8Array(width * height * 4);
    const colorOutput = new Float32Array(4), colorWork = { a: new Float32Array(3),
      b: new Float32Array(3), c: new Float32Array(3),
      hsl: new Float32Array(3), tinted: new Float32Array(3), tint: { hueShift: 0, satMul: 1, lightMul: 1 } };
    const detailPixels = new Uint8Array(width * height);
    const detail = { macro: 0, medium: 0, fine: 0, crack: 0, ridge: 0, lava: 0, geology: 0 };
    const rowDirections = new Array(height), longitudeDirections = new Array(width);
    for (let px = 0; px < width; px += 1) {
      const longitude = (px / width - .5) * Math.PI * 2;
      longitudeDirections[px] = { cos: Math.cos(longitude), sin: Math.sin(longitude) };
    }
    for (let py = 0; py < height; py += 1) {
      const v = py / (height - 1 || 1), latitude = (.5 - v) * Math.PI;
      const northPole = py === 0, southPole = py === height - 1 && !northPole;
      const cos = northPole || southPole ? 0 : Math.cos(latitude);
      const y = northPole ? 1 : southPole ? -1 : Math.sin(latitude);
      rowDirections[py] = { latitude, cos, sin: y, y, mapY: v * (terrain.height - 1) };
    }
    const seaLevel = Number.isFinite(terrain?.seaLevel) ? terrain.seaLevel : 0;
    let basinLevel = seaLevel;
    if (climate === 'arid' || climate === 'volcanic') {
      const histogram = new Uint32Array(256);
      for (let i = 0; i < terrain.elevation.length; i += 1) histogram[terrain.elevation[i]] += 1;
      const target = Math.floor(terrain.elevation.length * (climate === 'arid' ? .16 : .34));
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
        const polarCoverage = (climate === 'temperate' || climate === 'frozen' || climate === 'arid') &&
          Math.abs(ny) >= polarThreshold - .18
          ? polarIceCoverage(nx, ny, nz, temperature, polarSeed) : 0;
        const crater = craters ? craters[offset + px] : 0;
        detail.macro = macro; detail.medium = medium; detail.fine = fine; detail.crack = fine;
        detail.ridge = 1 - Math.abs(medium); detail.lava = .62 * macro + .38 * medium; detail.geology = medium;
        const index = (offset + px) * 4;
        colorFor(climate, elevation, seaLevel, basinLevel, moisture, row.latitude, detail,
          temperature, crater, polarCoverage, colorOutput, colorWork);
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

  root.OrbitPlanetSurfaceTexture = Object.freeze({ create, tintHsl, rgbToHsl, hslToRgb,
    polarIceThreshold, polarIceCoverage,
    cacheKey: planet => `${planet?.id ?? 'planet'}:${planet?.seed ?? '0'}`,
    defaults: Object.freeze({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }), palettes: PALETTES,
    clearCache: () => textureCache.clear() });
})(globalThis);
