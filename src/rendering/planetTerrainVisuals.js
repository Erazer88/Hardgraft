(function (root) {
  'use strict';

  const Projection = root.OrbitPlanetGlobeProjection;
  const Surface = root.OrbitPlanetSurfaceTexture;
  const cache = new WeakMap();
  const uvTerrain = { width: 2, height: 2 };
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const smoothstep = (a, b, v) => { const t = clamp((v - a) / Math.max(1e-8, b - a)); return t * t * (3 - 2 * t); };
  const normalize = p => { const l = Math.hypot(p.x, p.y, p.z) || 1; return { x: p.x / l, y: p.y / l, z: p.z / l }; };
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const mix = (a, b, t) => a + (b - a) * t;
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const filterRing = Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4), Math.sin(k * Math.PI / 4)]);

  function sample(field, width, height, u, v, channels = 1, channel = 0) {
    const x = ((u % 1) + 1) % 1 * width, y = clamp(v) * (height - 1);
    const x0 = Math.floor(x), x1 = (x0 + 1) % width, y0 = Math.floor(y), y1 = Math.min(height - 1, y0 + 1);
    const tx = x - x0, ty = y - y0;
    return mix(mix(field[(y0 * width + x0) * channels + channel], field[(y0 * width + x1) * channels + channel], tx),
      mix(field[(y1 * width + x0) * channels + channel], field[(y1 * width + x1) * channels + channel], tx), ty);
  }

  function direction(u, v) { return Projection.terrainToSphere(u, v, uvTerrain); }
  function sampleDirection(field, width, height, d) {
    const uv = Projection.sphereToTerrain(d, uvTerrain);
    return sample(field, width, height, uv.x, uv.y);
  }
  function tangentFrame(d) {
    const u = normalize(cross(Math.abs(d.y) > .90 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }, d));
    return { u, v: cross(d, u) };
  }
  function offset(d, t, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: d.x * c + t.x * s, y: d.y * c + t.y * s, z: d.z * c + t.z * s };
  }

  // All filtering follows spherical caps, including across the seam and poles.
  // No row averaging, UV noise or change to the canonical elevation is involved.
  function lowPass(field, width, height, radius) {
    const output = new Float32Array(field.length);
    const cosRadius = Math.cos(radius), sinRadius = Math.sin(radius);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const d = direction(x / width, y / (height - 1)), frame = tangentFrame(d);
      let sum = field[y * width + x] * 4;
      for (const [c, s] of filterRing) {
        const t = { x: frame.u.x * c + frame.v.x * s, y: frame.u.y * c + frame.v.y * s,
          z: frame.u.z * c + frame.v.z * s };
        sum += sampleDirection(field, width, height, { x: d.x * cosRadius + t.x * sinRadius,
          y: d.y * cosRadius + t.y * sinRadius, z: d.z * cosRadius + t.z * sinRadius });
      }
      output[y * width + x] = sum / 12;
    }
    return output;
  }

  function landQuantile(field, elevations, width, height, seaLevel, q) {
    const bins = new Float64Array(2048);
    let total = 0;
    for (let y = 0; y < height; y += 1) {
      const area = Math.max(0, Math.sin(y / (height - 1) * Math.PI));
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (elevations[i] <= seaLevel) continue;
        bins[Math.round(clamp(field[i]) * 2047)] += area; total += area;
      }
    }
    let area = 0;
    for (let i = 0; i < bins.length; i += 1) { area += bins[i]; if (area >= total * q) return i / 2047; }
    return 1;
  }

  function styleKey(style) {
    const s = style.stylizedTerrain;
    return JSON.stringify([s.fieldWidth, s.textureWidth, s.facetResolution, s.heightLowPass, s.macroLowPass,
      s.classLowPass, s.hillQuantile, s.mountainQuantile, s.summitQuantile, s.normalReliefScale,
      s.hillNormalStrength, s.plainNormalStrength, s.mountainNormalStrength, s.materials]);
  }

  function create(terrain, planet, style = root.OrbitPlanetGlobeStyle) {
    const settings = style.stylizedTerrain;
    const key = JSON.stringify([planet.id, planet.seed, planet.temperature, style.relief, style.polarCaps, styleKey(style)]);
    const previous = cache.get(terrain);
    if (previous?.key === key) return previous;
    const start = performance.now();
    const width = settings.fieldWidth, height = Math.round(width / 2), count = width * height;
    const elevation = new Float32Array(count), heights = new Float32Array(count), moisture = new Float32Array(count);
    const mountain = new Float32Array(count), ridge = new Float32Array(count), ruggedness = new Float32Array(count);
    const valley = new Float32Array(count), score = new Float32Array(count);
    const range = Projection.visualReliefRange(terrain, style.relief), sea = terrain.seaLevel;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = y * width + x, tx = x / width * (terrain.width - 1), ty = y / (height - 1) * (terrain.height - 1);
      const field = values => Projection.sampleField(values, tx, ty, terrain);
      elevation[i] = field(terrain.elevation);
      heights[i] = clamp((elevation[i] - sea) / Math.max(1, range.high - range.low));
      moisture[i] = field(terrain.moisture) / 255;
      mountain[i] = field(terrain.mountainMask) / 255;
      ridge[i] = field(terrain.ridgeField) / 255;
      ruggedness[i] = field(terrain.ruggednessField) / 255;
      valley[i] = field(terrain.valleyField) / 255;
    }
    const mid = lowPass(heights, width, height, settings.heightLowPass);
    const macro = lowPass(mid, width, height, settings.macroLowPass);
    const humidity = lowPass(moisture, width, height, settings.macroLowPass);
    const broadMountain = lowPass(mountain, width, height, settings.macroLowPass);
    const broadRuggedness = lowPass(ruggedness, width, height, settings.classLowPass);
    const visualRidge = lowPass(ridge, width, height, settings.heightLowPass);
    const visualValley = lowPass(valley, width, height, settings.classLowPass);
    const macroNormals = new Float32Array(count * 3);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = y * width + x, d = direction(x / width, y / (height - 1)), frame = tangentFrame(d), step = .045;
      const du = (sampleDirection(macro, width, height, offset(d, frame.u, step)) -
        sampleDirection(macro, width, height, offset(d, frame.u, -step))) / (2 * step);
      const dv = (sampleDirection(macro, width, height, offset(d, frame.v, step)) -
        sampleDirection(macro, width, height, offset(d, frame.v, -step))) / (2 * step);
      const slope = clamp(Math.hypot(du, dv) * .22);
      const inland = smoothstep(1.5, 5, elevation[i] - sea);
      // The material regions follow the entire massif, not each parallel crest.
      // Fine geological fields remain available only as subdued material accents.
      score[i] = clamp(macro[i] * .52 + inland * (broadMountain[i] * .30 + broadRuggedness[i] * .14 + slope * .12));
      const n = normalize({ x: d.x - settings.normalReliefScale * (du * frame.u.x + dv * frame.v.x),
        y: d.y - settings.normalReliefScale * (du * frame.u.y + dv * frame.v.y),
        z: d.z - settings.normalReliefScale * (du * frame.u.z + dv * frame.v.z) });
      macroNormals[i * 3] = n.x; macroNormals[i * 3 + 1] = n.y; macroNormals[i * 3 + 2] = n.z;
    }
    const broadScore = lowPass(score, width, height, settings.classLowPass);
    const thresholds = [settings.hillQuantile, settings.mountainQuantile, settings.summitQuantile]
      .map(q => landQuantile(broadScore, elevation, width, height, sea, q));
    const classPixels = new Uint8Array(count * 4), snowField = new Float32Array(count);
    const climate = planet.kind === 'glacée' ? 'frozen' : planet.kind === 'aride' ? 'arid' : planet.kind === 'volcanique' ? 'volcanic' : 'temperate';
    const materials = Object.fromEntries(Object.entries(settings.materials[climate]).map(([k, v]) => [k, rgb(v)]));
    const temperature = Number.isFinite(planet.temperature) ? planet.temperature : 16;
    const surfaceSeed = root.OrbitWorld.hashSeed(`${planet.seed}:surface-v2`), polarSeed = surfaceSeed ^ 0x5b1ce8a3;
    const polarThreshold = Surface.polarIceThreshold(temperature, style.polarCaps);
    const totals = [0, 0, 0, 0]; let landArea = 0;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = y * width + x, area = Math.max(0, Math.sin(y / (height - 1) * Math.PI));
      const s = broadScore[i], edge = Math.max(.008, (thresholds[2] - thresholds[0]) * .12);
      const hill = smoothstep(thresholds[0] - edge, thresholds[0] + edge, s);
      const mass = smoothstep(thresholds[1] - edge, thresholds[1] + edge, s);
      const summit = smoothstep(thresholds[2] - edge * .6, thresholds[2] + edge * .6, s);
      const weights = [1 - hill, hill * (1 - mass), hill * mass * (1 - summit), hill * mass * summit];
      for (let c = 0; c < 4; c += 1) {
        classPixels[i * 4 + c] = Math.round(weights[c] * 255);
        if (elevation[i] > sea) totals[c] += weights[c] * area;
      }
      if (elevation[i] > sea) landArea += area;
      const d = direction(x / width, y / (height - 1));
      const latitudeDegrees = Math.asin(clamp(Math.abs(d.y))) * 180 / Math.PI;
      const polar = climate !== 'volcanic' && latitudeDegrees > polarThreshold - style.polarCaps.eligibilityMarginDegrees
        ? Surface.polarIceCoverage(d.x, d.y, d.z, temperature, polarSeed, style.polarCaps) : 0;
      const localTemperature = temperature - Math.pow(Math.abs(d.y), 1.55) * 38 - mid[i] * 12;
      snowField[i] = climate === 'volcanic' ? 0 : Math.max(polar * .94,
        weights[3] * (1 - smoothstep(-10, 0, localTemperature)) * .45);
    }

    // A triangular octahedral subdivision has no latitude bands or preferred
    // meridian. Each face samples the same low-pass height and keeps one normal.
    const faces = new Map(), resolution = Math.max(4, Math.round(settings.facetResolution));
    function facetNormal(d) {
      const l1 = Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z);
      const u = Math.abs(d.x) / l1 * resolution, v = Math.abs(d.y) / l1 * resolution;
      let i = Math.min(resolution - 1, Math.floor(u)), j = Math.min(resolution - 1, Math.floor(v));
      if (i + j >= resolution) j = resolution - 1 - i;
      const upper = u - i + v - j > 1 && i + j < resolution - 1;
      const octant = (d.x < 0 ? 1 : 0) | (d.y < 0 ? 2 : 0) | (d.z < 0 ? 4 : 0);
      const id = (octant * resolution * resolution + i * resolution + j) * 2 + (upper ? 1 : 0);
      if (faces.has(id)) return faces.get(id);
      const sx = d.x < 0 ? -1 : 1, sy = d.y < 0 ? -1 : 1, sz = d.z < 0 ? -1 : 1;
      function vertex(a, b) {
        const n = normalize({ x: sx * a / resolution, y: sy * b / resolution, z: sz * (1 - (a + b) / resolution) });
        const h = sampleDirection(mid, width, height, n);
        const r = 1 + settings.normalReliefScale * (.20 * h + .80 * h * h);
        return { x: n.x * r, y: n.y * r, z: n.z * r };
      }
      const a = vertex(i + (upper ? 1 : 0), j), b = vertex(i + 1, j + (upper ? 1 : 0)), c = vertex(i, j + 1);
      let normal = normalize(cross({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
        { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }));
      if (dot(normal, d) < 0) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
      faces.set(id, normal); return normal;
    }

    const textureWidth = settings.textureWidth, textureHeight = Math.round(textureWidth / 2);
    const normalPixels = new Uint8Array(textureWidth * textureHeight * 4);
    const materialPixels = new Uint8Array(normalPixels.length);
    const classes = new Float32Array(4), macroNormal = new Float32Array(3);
    for (let y = 0; y < textureHeight; y += 1) for (let x = 0; x < textureWidth; x += 1) {
      const u = x / textureWidth, v = y / (textureHeight - 1), o = (y * textureWidth + x) * 4;
      for (let c = 0; c < 4; c += 1) classes[c] = sample(classPixels, width, height, u, v, 4, c) / 255;
      const d = direction(u, v), facet = facetNormal(d);
      for (let c = 0; c < 3; c += 1) macroNormal[c] = sample(macroNormals, width, height, u, v, 3, c);
      const macroMix = classes[0] * settings.plainNormalStrength + (1 - classes[0]) * settings.hillNormalStrength;
      const facetMix = (classes[2] + classes[3]) * settings.mountainNormalStrength;
      const n = normalize({ x: mix(mix(d.x, macroNormal[0], macroMix), facet.x, facetMix),
        y: mix(mix(d.y, macroNormal[1], macroMix), facet.y, facetMix),
        z: mix(mix(d.z, macroNormal[2], macroMix), facet.z, facetMix) });
      normalPixels[o] = Math.round((n.x * .5 + .5) * 255);
      normalPixels[o + 1] = Math.round((n.y * .5 + .5) * 255);
      normalPixels[o + 2] = Math.round((n.z * .5 + .5) * 255);
      const crest = sample(visualRidge, width, height, u, v), hollow = sample(visualValley, width, height, u, v);
      normalPixels[o + 3] = Math.round(clamp(crest) * 255);
      const wet = sample(humidity, width, height, u, v);
      const snow = smoothstep(.12, .88, sample(snowField, width, height, u, v));
      const isSea = sample(elevation, width, height, u, v) <= sea;
      for (let channel = 0; channel < 3; channel += 1) {
        let plain = mix(materials.plain[channel], materials.wet[channel], smoothstep(.45, .82, wet) * .62);
        plain = mix(plain, materials.dry[channel], (1 - smoothstep(.14, .40, wet)) * .32);
        let color = plain * classes[0] + materials.hill[channel] * classes[1] +
          materials.mountain[channel] * classes[2] + materials.ridge[channel] * classes[3];
        color = mix(color, materials.ridge[channel], (classes[2] + classes[3]) * crest * .38);
        color = mix(color, materials.crevice[channel], (classes[2] + classes[3]) * hollow * .30);
        color *= 1 + (wet - .5) * .035;
        // Sea ice has its own material, never a green-land/water/snow mixture.
        // Its coverage is applied once in the shader, with no luminous fringe.
        if (isSea && (climate === 'temperate' || climate === 'frozen')) color = materials.ice[channel];
        if (isSea && climate === 'arid') color *= .73;
        color = mix(color, isSea ? materials.ice[channel] : materials.snow[channel], snow);
        materialPixels[o + channel] = Math.round(clamp(color, 0, 255));
      }
      materialPixels[o + 3] = Math.round(clamp(snow) * 255);
    }
    const result = Object.freeze({ key, width: textureWidth, height: textureHeight, classWidth: width, classHeight: height,
      terrainVisualClassPixels: classPixels, stylizedNormalPixels: normalPixels, materialPixels,
      climate, sand: settings.materials[climate].sand, thresholds,
      proportions: Object.fromEntries(['plain', 'hill', 'mountain', 'summit'].map((name, i) => [name, totals[i] / Math.max(1, landArea)])),
      facetCount: faces.size, generationMs: performance.now() - start });
    cache.set(terrain, result); return result;
  }

  root.OrbitPlanetTerrainVisuals = Object.freeze({ create, styleKey });
})(globalThis);
