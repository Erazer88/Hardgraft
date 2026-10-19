(function (root) {
  'use strict';

  const World = root.OrbitWorld;
  const Style = root.OrbitPlanetGlobeStyle;
  const DEFAULT_WIDTH = 2048;
  const DEFAULT_HEIGHT = 1024;
  const MAX_CACHE_ENTRIES = 2;
  const textureCache = new Map();
  const noiseKernels = new Map();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smoothstep = (a, b, value) => {
    const t = clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  const PALETTES = Object.freeze({
    temperate: Object.freeze({ deepOcean: '#0A3E7A', ocean: '#147DB6', shallow: '#4CC9D8',
      coast: '#DFC67D', lowland: '#95CF61', plain: '#7FBE53', wetPlain: '#5F9B45',
      dryPlain: '#A7A45F', upland: '#A9B96B', highland: '#B89263', rock: '#936D4E', highRock: '#C1A179',
      snow: '#F1F4F6', coldSnow: '#DDE7ED', polarIce: '#A9D7E6',
      seaIce: '#7FC2D0', packedSeaIce: '#C0E4E8', iceCrack: '#4E8C9B' }),
    frozen: Object.freeze({ seaIce: '#78B7C9', packedIce: '#B2D4DE', brightIce: '#DDEBF1',
      coldRock: '#617985', darkColdRock: '#435A64', ridgeShadow: '#2D444C',
      snow: '#E3EFF3', blueSnow: '#BADCE8', crackTint: '#477D8D', polarCore: '#699CAB' }),
    arid: Object.freeze({ basin: '#733D28', lowland: '#AA542F', plain: '#D1793E', sand: '#E5A55B',
      plateau: '#985038', upland: '#8C4730', rock: '#63372D', darkRock: '#432820',
      dust: '#F0C28B', polarFrost: '#E4DBCD', coldFrost: '#CFC5B6' }),
    volcanic: Object.freeze({ deepLava: '#7A1B0C', lava: '#E44412', hotLava: '#FF7A1C',
      coreLava: '#FFD06A', basaltDark: '#211817', basalt: '#382522', warmBasalt: '#5B382C',
      ashRock: '#79503B', emberCrack: '#B73518', cooledCrust: '#1A1414' })
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

  function wrappedXProfile(value, width) {
    const period = Math.max(1, width - 1), px = ((value % period) + period) % period;
    const x0 = Math.floor(px);
    return { x0, x1: (x0 + 1) % period, t: px - x0 };
  }

  function clampedYProfile(value, height) {
    const py = clamp(value, 0, height - 1), y0 = Math.floor(py);
    return { y0, y1: Math.min(height - 1, y0 + 1), t: py - y0 };
  }

  function sampleRaster(values, width, x, y) {
    const row0 = y.y0 * width, row1 = y.y1 * width;
    const a = values[row0 + x.x0] * (1 - x.t) + values[row0 + x.x1] * x.t;
    const b = values[row1 + x.x0] * (1 - x.t) + values[row1 + x.x1] * x.t;
    return a * (1 - y.t) + b * y.t;
  }

  function createCoastDistance(landMask, width, height, range) {
    const count = width * height, distance = new Float32Array(count);
    const infinity = width + height + 1, diagonal = Math.SQRT2;
    function transform(targetLand) {
      for (let i = 0; i < count; i += 1) {
        const isLand = landMask[i] >= 128;
        distance[i] = isLand === targetLand ? 0 : infinity;
      }
      for (let y = 0; y < height; y += 1) {
        const row = y * width, north = Math.max(0, y - 1) * width;
        for (let x = 0; x < width; x += 1) {
          const index = row + x, left = (x + width - 1) % width, right = (x + 1) % width;
          let best = distance[index];
          best = Math.min(best, distance[row + left] + 1);
          if (y > 0) {
            best = Math.min(best, distance[north + x] + 1,
              distance[north + left] + diagonal, distance[north + right] + diagonal);
          }
          distance[index] = best;
        }
      }
      for (let y = height - 1; y >= 0; y -= 1) {
        const row = y * width, south = Math.min(height - 1, y + 1) * width;
        for (let x = width - 1; x >= 0; x -= 1) {
          const index = row + x, left = (x + width - 1) % width, right = (x + 1) % width;
          let best = distance[index];
          best = Math.min(best, distance[row + right] + 1);
          if (y < height - 1) {
            best = Math.min(best, distance[south + x] + 1,
              distance[south + left] + diagonal, distance[south + right] + diagonal);
          }
          distance[index] = best;
        }
      }
    }

    const sdf = new Uint8Array(count);
    transform(true);
    for (let i = 0; i < count; i += 1) {
      if (landMask[i] < 128) {
        const signed = -Math.min(range, distance[i]);
        sdf[i] = Math.round(clamp(.5 + signed / (2 * range), 0, 1) * 255);
      }
    }
    transform(false);
    for (let i = 0; i < count; i += 1) {
      if (landMask[i] >= 128) {
        const signed = Math.min(range, distance[i]);
        sdf[i] = Math.round(clamp(.5 + signed / (2 * range), 0, 1) * 255);
      }
    }
    return sdf;
  }

  function createSphericalFieldSampler(width, height, evaluate) {
    const fieldWidth = Math.max(8, Math.min(384, width));
    const fieldHeight = Math.max(4, Math.min(192, height));
    const values = new Float32Array(fieldWidth * fieldHeight);
    for (let y = 0; y < fieldHeight; y += 1) {
      const v = y / (fieldHeight - 1), latitude = (.5 - v) * Math.PI;
      const cosLatitude = y === 0 || y === fieldHeight - 1 ? 0 : Math.cos(latitude);
      const ny = y === 0 ? 1 : y === fieldHeight - 1 ? -1 : Math.sin(latitude);
      const row = y * fieldWidth;
      for (let x = 0; x < fieldWidth; x += 1) {
        const longitude = (x / fieldWidth - .5) * Math.PI * 2;
        values[row + x] = evaluate(cosLatitude * Math.cos(longitude), ny,
          cosLatitude * Math.sin(longitude), latitude);
      }
    }
    return function sample(u, v) {
      const px = ((u % 1) + 1) % 1 * fieldWidth;
      const py = clamp(v, 0, 1) * (fieldHeight - 1);
      const x0 = Math.floor(px), y0 = Math.floor(py), x1 = (x0 + 1) % fieldWidth;
      const y1 = Math.min(fieldHeight - 1, y0 + 1), tx = px - x0, ty = py - y0;
      const row0 = y0 * fieldWidth, row1 = y1 * fieldWidth;
      const top = values[row0 + x0] * (1 - tx) + values[row0 + x1] * tx;
      const bottom = values[row1 + x0] * (1 - tx) + values[row1 + x1] * tx;
      return top * (1 - ty) + bottom * ty;
    };
  }

  function climateOf(planet) {
    if (planet?.kind === 'glacée') return 'frozen';
    if (planet?.kind === 'aride') return 'arid';
    if (planet?.kind === 'volcanique') return 'volcanic';
    return 'temperate';
  }

  function polarIceThreshold(temperature, settings = Style.polarCaps) {
    // The boundary is in angular latitude degrees, so seeded noise remains a
    // small, controllable displacement instead of a huge shift in sin(latitude).
    return clamp(settings.thresholdBase + ((Number.isFinite(temperature) ? temperature : 16) -
      settings.temperatureReference) * settings.temperatureScale,
    settings.minimumThreshold, settings.maximumThreshold);
  }

  function polarIceCoverage(nx, ny, nz, temperature, seed, settings = Style.polarCaps) {
    const threshold = polarIceThreshold(temperature, settings);
    const absoluteLatitude = Math.asin(clamp(Math.abs(ny), 0, 1)) * 180 / Math.PI;
    if (absoluteLatitude < threshold - settings.eligibilityMarginDegrees) return 0;
    const broadBoundary = noise3(nx * settings.broadFrequency, ny * settings.broadFrequency,
      nz * settings.broadFrequency, seed ^ 0x2b79a4d1) * (1 - settings.secondWeight) +
      noise3(nx * settings.secondFrequency, ny * settings.secondFrequency,
        nz * settings.secondFrequency, seed ^ 0x42c8e6f3) * settings.secondWeight;
    const coastBreakup = noise3(nx * settings.coastFrequency, ny * settings.coastFrequency,
      nz * settings.coastFrequency, seed ^ 0x6c8e9cf5);
    // Broad noise moves the front by a few degrees; finer noise only breaks
    // the coast slightly. The pole itself remains fully covered by geometry.
    const broadDisplacement = clamp(broadBoundary * settings.broadDisplacementDegrees,
      -settings.maximumBroadShiftDegrees, settings.maximumBroadShiftDegrees);
    const coastDisplacement = clamp(coastBreakup * settings.coastDisplacementDegrees,
      -settings.maximumCoastShiftDegrees, settings.maximumCoastShiftDegrees);
    const irregularThreshold = clamp(threshold + broadDisplacement + coastDisplacement,
      settings.minimumThreshold - settings.maximumBroadShiftDegrees,
      settings.maximumThreshold + settings.maximumBroadShiftDegrees);
    return smoothstep(irregularThreshold - settings.edgeHalfWidthDegrees,
      irregularThreshold + settings.edgeHalfWidthDegrees, absoluteLatitude);
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
    const floor = climateSaturationFloor(climate);
    const luma = base[0] * .2126 + base[1] * .7152 + base[2] * .0722;
    const saturation = 1.04 + floor * .08;
    const contrast = 1.07;
    const brightness = 1 + detail.macro * .014 + detail.geology * .006;
    for (let channel = 0; channel < 3; channel += 1) {
      const chromatic = luma + (base[channel] - luma) * saturation;
      output[channel] = clamp((112 + (chromatic - 112) * contrast) * brightness, 0, 255);
    }
    output[3] = 0;
  }

  function colorFor(climate, elevation, seaLevel, basinLevel, moisture, latitude, latitudeCooling, detail, temperature,
    crater, polarCoverage, output, work) {
    const palette = COLOR_PALETTES[climate];
    const h = clamp((elevation - seaLevel) / Math.max(1, 255 - seaLevel), 0, 1);
    const depth = clamp((seaLevel - elevation) / 42, 0, 1);
    const humidity = clamp(moisture, 0, 1), absoluteLatitude = Math.abs(latitude);
    const localTemperature = temperature - latitudeCooling - h * 32;
    const base = work.a, land = work.b, temporary = work.c;

    if (climate === 'temperate') {
      if (elevation <= seaLevel) {
        if (depth > .62) mixInto(base, palette.ocean, palette.deepOcean, smoothstep(.62, 1, depth));
        else if (depth > .14) mixInto(base, palette.shallow, palette.ocean, smoothstep(.14, .62, depth));
        else copyInto(base, palette.shallow);
        if (polarCoverage > 0) {
          mixInto(temporary, palette.seaIce, palette.packedSeaIce,
            clamp(.50 + detail.medium * .12 + detail.fine * .04, 0, 1));
          const seaCrack = smoothstep(.982, .998, 1 - Math.abs(detail.crack));
          mixInto(land, temporary, palette.iceCrack, seaCrack * .08);
          mixInto(temporary, base, land, polarCoverage * .96);
          copyInto(base, temporary);
        }
      } else if (h < .42) {
        mixInto(base, palette.lowland, palette.plain, smoothstep(.04, .42, h) * .72);
        mixInto(temporary, base, palette.wetPlain, smoothstep(.62, .94, humidity) * .38);
        copyInto(base, temporary);
      } else if (h < .66) {
        mixInto(base, palette.plain, palette.upland, smoothstep(.42, .66, h) * .48);
      } else if (h < .82) {
        mixInto(base, palette.upland, palette.highland, smoothstep(.66, .82, h));
      } else copyInto(base, palette.highland);
      const snow = 1 - smoothstep(-4, 5, localTemperature);
      const summitSnow = smoothstep(.82, .97, h) * .30;
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
        const iceThickness = clamp(.52 + depth * .12 + detail.macro * .62 +
          detail.medium * .16 + detail.fine * .05, 0, 1);
        mixInto(base, palette.seaIce, palette.packedIce, iceThickness);
        mixInto(temporary, base, palette.polarCore, polarCoverage * .78);
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
    const polarCaps = options.polarCaps || Style.polarCaps;
    const polarSettingsKey = JSON.stringify(polarCaps);
    const key = `${id}:${planetSeed}`;
    const cacheKey = `${key}:${width}x${height}:${polarSettingsKey}`;
    const cached = options.cache === false ? null : textureCache.get(cacheKey);
    if (cached) {
      textureCache.delete(cacheKey); textureCache.set(cacheKey, cached);
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
    const polarThreshold = polarIceThreshold(temperature, polarCaps);
    const albedoWidth = Math.min(width, 1024);
    const albedoHeight = Math.min(height, Math.max(1, Math.round(albedoWidth * height / width)));
    const craters = climate === 'arid'
      ? craterField(albedoWidth, albedoHeight, createCraters(craterSeed)) : null;
    const pixelCount = width * height;
    const albedoPixels = new Uint8Array(pixelCount * 4);
    const sourceAlbedoPixels = albedoWidth === width && albedoHeight === height
      ? albedoPixels : new Uint8Array(albedoWidth * albedoHeight * 4);
    // Two normalized 8-bit channels encode a 16-bit height value. Keeping the
    // fractional source elevation prevents 8-bit derivative banding in the shader.
    const heightPixels = new Uint8Array(pixelCount * 2);
    const landMaskPixels = new Uint8Array(pixelCount);
    const terrainStructurePixels = new Uint8Array(pixelCount * 4);
    const structureFields = [terrain.mountainMask, terrain.ridgeField, terrain.valleyField, terrain.ruggednessField];
    const terrainCellCount = terrain.width * terrain.height;
    const detailPixels = new Uint8Array(pixelCount);
    const sourceDetailPixels = albedoWidth === width && albedoHeight === height
      ? detailPixels : new Uint8Array(albedoWidth * albedoHeight);
    const colorOutput = new Float32Array(4);
    const waterColor = new Float32Array(4), landColor = new Float32Array(4);
    const colorWork = { a: new Float32Array(3), b: new Float32Array(3), c: new Float32Array(3) };
    const detail = { macro: 0, medium: 0, fine: 0, crack: 0, ridge: 0, lava: 0, geology: 0 };
    const specialDetail = climate === 'frozen' || climate === 'volcanic';
    const macroSampler = createSphericalFieldSampler(width, height,
      (nx, ny, nz) => noise3(nx * 2.2, ny * 2.2, nz * 2.2, colorSeed));
    const mediumSampler = specialDetail ? createSphericalFieldSampler(width, height,
      (nx, ny, nz) => noise3(nx * 7, ny * 7, nz * 7, geologySeed)) : null;
    const fineSampler = specialDetail ? createSphericalFieldSampler(width, height,
      (nx, ny, nz) => noise3(nx * 24, ny * 24, nz * 24, climate === 'frozen' ? iceSeed : detailSeed)) : null;
    const usesPolarIce = climate === 'temperate' || climate === 'frozen' || climate === 'arid';
    const polarSampler = usesPolarIce ? createSphericalFieldSampler(width, height, (nx, ny, nz, latitude) =>
      Math.abs(latitude) * 180 / Math.PI >= polarThreshold - polarCaps.eligibilityMarginDegrees
        ? polarIceCoverage(nx, ny, nz, temperature, polarSeed, polarCaps) : 0) : null;
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
    const texelMapX = Math.max(0, terrain.width - 1) / width;
    const texelMapY = Math.max(0, terrain.height - 1) / height;
    const coastLow = seaLevel - 1.25, coastHigh = seaLevel + 1.25;
    const xProfiles = new Array(width), yProfiles = new Array(height);
    for (let px = 0; px < width; px += 1) {
      const mapX = px / width * (terrain.width - 1);
      xProfiles[px] = { center: wrappedXProfile(mapX, terrain.width),
        west: wrappedXProfile(mapX - .25 * texelMapX, terrain.width),
        east: wrappedXProfile(mapX + .25 * texelMapX, terrain.width) };
    }
    for (let py = 0; py < height; py += 1) {
      const mapY = py / (height - 1 || 1) * (terrain.height - 1);
      yProfiles[py] = { center: clampedYProfile(mapY, terrain.height),
        north: clampedYProfile(mapY - .25 * texelMapY, terrain.height),
        south: clampedYProfile(mapY + .25 * texelMapY, terrain.height) };
    }

    // Pre-interpolate source columns once. Four supersamples can then read
    // only the two neighboring rows per sample instead of repeating four
    // bilinear source lookups for every output texel.
    const sourceRowCount = terrain.height;
    const profilePlaneSize = width * sourceRowCount;
    const elevationProfiles = new Float32Array(profilePlaneSize * 3);
    for (let px = 0; px < width; px += 1) {
      const samples = xProfiles[px];
      const profiles = [samples.center, samples.west, samples.east];
      for (let profileIndex = 0; profileIndex < 3; profileIndex += 1) {
        const x = profiles[profileIndex], planeOffset = profileIndex * profilePlaneSize + px * sourceRowCount;
        for (let y = 0; y < sourceRowCount; y += 1) {
          const row = y * terrain.width;
          const left = terrain.elevation[row + x.x0], right = terrain.elevation[row + x.x1];
          elevationProfiles[planeOffset + y] = left * (1 - x.t) + right * x.t;
        }
      }
    }

    for (let py = 0; py < height; py += 1) {
      const ySamples = yProfiles[py], offset = py * width;
      for (let px = 0; px < width; px += 1) {
        const centerBase = px * sourceRowCount;
        const northBase = profilePlaneSize + centerBase;
        const southBase = profilePlaneSize * 2 + centerBase;
        const centerRows = ySamples.center;
        const elevation = elevationProfiles[centerBase + centerRows.y0] * (1 - centerRows.t) +
          elevationProfiles[centerBase + centerRows.y1] * centerRows.t;
        const northWestRows = ySamples.north, southWestRows = ySamples.south;
        const northWest = elevationProfiles[northBase + northWestRows.y0] * (1 - northWestRows.t) +
          elevationProfiles[northBase + northWestRows.y1] * northWestRows.t;
        const northEast = elevationProfiles[southBase + northWestRows.y0] * (1 - northWestRows.t) +
          elevationProfiles[southBase + northWestRows.y1] * northWestRows.t;
        const southWest = elevationProfiles[northBase + southWestRows.y0] * (1 - southWestRows.t) +
          elevationProfiles[northBase + southWestRows.y1] * southWestRows.t;
        const southEast = elevationProfiles[southBase + southWestRows.y0] * (1 - southWestRows.t) +
          elevationProfiles[southBase + southWestRows.y1] * southWestRows.t;
        const coverage = (smoothstep(coastLow, coastHigh, northWest) +
          smoothstep(coastLow, coastHigh, northEast) + smoothstep(coastLow, coastHigh, southWest) +
          smoothstep(coastLow, coastHigh, southEast)) * .25;
        // Preserve bathymetry and land elevation together. The shader derives
        // the mesh's shaped land relief and ocean depth from this shared field.
        const normalizedElevation = clamp(elevation / 255, 0, 1);
        const index = offset + px;
        landMaskPixels[index] = Math.round(clamp(coverage, 0, 1) * 255);
        const packedHeight = Math.round(normalizedElevation * 65535), heightOffset = index * 2;
        heightPixels[heightOffset] = packedHeight >>> 8;
        heightPixels[heightOffset + 1] = packedHeight & 255;
        const structureOffset = index * 4;
        const mapX = xProfiles[px].center, mapY = yProfiles[py].center;
        for (let channel = 0; channel < structureFields.length; channel += 1) {
          const field = structureFields[channel];
          terrainStructurePixels[structureOffset + channel] = field?.length === terrainCellCount
            ? Math.round(clamp(sampleRaster(field, terrain.width, mapX, mapY), 0, 255)) : 0;
        }
      }
    }

    const albedoXProfiles = new Array(albedoWidth), albedoYProfiles = new Array(albedoHeight);
    for (let px = 0; px < albedoWidth; px += 1) {
      albedoXProfiles[px] = wrappedXProfile(px / albedoWidth * (terrain.width - 1), terrain.width);
    }
    for (let py = 0; py < albedoHeight; py += 1) {
      albedoYProfiles[py] = clampedYProfile(py / (albedoHeight - 1 || 1) * (terrain.height - 1), terrain.height);
    }
    const albedoRowDirections = new Array(albedoHeight);
    for (let py = 0; py < albedoHeight; py += 1) {
      const v = py / (albedoHeight - 1 || 1), latitude = (.5 - v) * Math.PI;
      albedoRowDirections[py] = { latitude,
        latitudeCooling: Math.pow(Math.abs(Math.sin(latitude)), polarCaps.latitudeCoolingExponent) *
          polarCaps.latitudeCoolingDegrees,
        polarEligible: Math.abs(latitude) * 180 / Math.PI >= polarThreshold - polarCaps.eligibilityMarginDegrees };
    }

    for (let py = 0; py < albedoHeight; py += 1) {
      const row = albedoRowDirections[py], ySamples = albedoYProfiles[py], offset = py * albedoWidth;
      for (let px = 0; px < albedoWidth; px += 1) {
        const u = px / albedoWidth, v = py / (albedoHeight - 1 || 1);
        const xSamples = albedoXProfiles[px];
        const elevation = sampleRaster(terrain.elevation, terrain.width, xSamples, ySamples);
        const coverage = smoothstep(coastLow, coastHigh, elevation);
        const moisture = climate === 'temperate' || climate === 'arid'
          ? sampleRaster(terrain.moisture, terrain.width, xSamples, ySamples) / 255 : .5;
        const macro = macroSampler(u, v);
        const medium = mediumSampler ? mediumSampler(u, v) : macro * .32;
        const fine = fineSampler ? fineSampler(u, v) : 0;
        const polarCoverage = polarSampler && row.polarEligible ? polarSampler(u, v) : 0;
        const crater = craters ? craters[offset + px] : 0;
        detail.macro = macro;
        detail.medium = medium;
        detail.fine = specialDetail ? fine * .45 : 0;
        detail.crack = specialDetail ? fine : 0;
        detail.ridge = 1 - Math.abs(medium);
        detail.lava = .62 * macro + .38 * medium;
        detail.geology = medium;

        const rgbaIndex = (offset + px) * 4;
        if (coverage > .002 && coverage < .998) {
          colorFor(climate, seaLevel - 1.26, seaLevel, basinLevel, moisture, row.latitude, row.latitudeCooling, detail,
            temperature, crater, polarCoverage, waterColor, colorWork);
          colorFor(climate, seaLevel + 1.26, seaLevel, basinLevel, moisture, row.latitude, row.latitudeCooling, detail,
            temperature, crater, polarCoverage, landColor, colorWork);
          mixInto(colorOutput, waterColor, landColor, coverage);
        } else {
          colorFor(climate, elevation, seaLevel, basinLevel, moisture, row.latitude, row.latitudeCooling, detail,
            temperature, crater, polarCoverage, colorOutput, colorWork);
        }
        sourceAlbedoPixels[rgbaIndex] = Math.round(colorOutput[0]);
        sourceAlbedoPixels[rgbaIndex + 1] = Math.round(colorOutput[1]);
        sourceAlbedoPixels[rgbaIndex + 2] = Math.round(colorOutput[2]);
        sourceAlbedoPixels[rgbaIndex + 3] = 255;
        sourceDetailPixels[offset + px] = Math.round(clamp(.5 + (specialDetail ? fine : macro) * .05, 0, 1) * 255);
      }
    }

    if (sourceAlbedoPixels !== albedoPixels) {
      for (let py = 0; py < height; py += 1) {
        const sourceY = py / (height - 1 || 1) * (albedoHeight - 1), y0 = Math.floor(sourceY);
        const y1 = Math.min(albedoHeight - 1, y0 + 1), ty = sourceY - y0;
        for (let px = 0; px < width; px += 1) {
          const sourceX = px / width * albedoWidth, wrappedX = sourceX % albedoWidth;
          const x0 = Math.floor(wrappedX), x1 = (x0 + 1) % albedoWidth, tx = wrappedX - x0;
          const index = (py * width + px) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            const a = sourceAlbedoPixels[(y0 * albedoWidth + x0) * 4 + channel] * (1 - tx) +
              sourceAlbedoPixels[(y0 * albedoWidth + x1) * 4 + channel] * tx;
            const b = sourceAlbedoPixels[(y1 * albedoWidth + x0) * 4 + channel] * (1 - tx) +
              sourceAlbedoPixels[(y1 * albedoWidth + x1) * 4 + channel] * tx;
            albedoPixels[index + channel] = Math.round(a * (1 - ty) + b * ty);
          }
          albedoPixels[index + 3] = 255;
          const detailX = sourceX % albedoWidth;
          const detailX0 = Math.floor(detailX), detailX1 = (detailX0 + 1) % albedoWidth;
          const da = sourceDetailPixels[y0 * albedoWidth + detailX0] * (1 - tx) +
            sourceDetailPixels[y0 * albedoWidth + detailX1] * tx;
          const db = sourceDetailPixels[y1 * albedoWidth + detailX0] * (1 - tx) +
            sourceDetailPixels[y1 * albedoWidth + detailX1] * tx;
          detailPixels[py * width + px] = Math.round(da * (1 - ty) + db * ty);
        }
      }
    }

    const coastRange = 24;
    const coastSdfPixels = createCoastDistance(landMaskPixels, width, height, coastRange);
    const texture = Object.freeze({ width, height, pixels: albedoPixels, albedoPixels, heightPixels,
      landMaskPixels, coastSdfPixels, detailPixels, terrainStructurePixels, coastRange,
      coastColor: climate === 'temperate' ? PALETTES.temperate.coast :
        climate === 'frozen' ? PALETTES.frozen.packedIce :
          climate === 'arid' ? PALETTES.arid.sand : PALETTES.volcanic.basalt,
      key: cacheKey, climate });
    if (options.cache !== false) {
      textureCache.set(cacheKey, texture);
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
