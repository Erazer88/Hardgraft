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
    // A longitude tangent is continuous across the map seam. At the exact
    // singularity we use a stable fallback; the final normal fades there.
    const horizontal = Math.hypot(d.x, d.z);
    const u = horizontal < 1e-6 ? { x: 0, y: 0, z: 1 } : { x: -d.z / horizontal, y: 0, z: d.x / horizontal };
    return { u, v: cross(d, u) };
  }
  function offset(d, t, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: d.x * c + t.x * s, y: d.y * c + t.y * s, z: d.z * c + t.z * s };
  }

  // Spherical filtering follows geodesic rings across the seam and poles.
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
    const bins = new Float64Array(2048); let total = 0;
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

  function scalarQuantile(field, elevations, width, height, seaLevel, q, upper = 1) {
    const bins = new Float64Array(1024); let total = 0;
    for (let y = 0; y < height; y += 1) {
      const area = Math.max(0, Math.sin(y / (height - 1) * Math.PI));
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x; if (elevations[i] <= seaLevel) continue;
        bins[Math.round(clamp(field[i] / Math.max(1e-6, upper)) * 1023)] += area; total += area;
      }
    }
    let area = 0;
    for (let i = 0; i < bins.length; i += 1) { area += bins[i]; if (area >= total * q) return i / 1023 * upper; }
    return upper;
  }

  function normalField(field, width, height, d, frame, step, reliefScale) {
    const plusU = sampleDirection(field, width, height, offset(d, frame.u, step));
    const minusU = sampleDirection(field, width, height, offset(d, frame.u, -step));
    const plusV = sampleDirection(field, width, height, offset(d, frame.v, step));
    const minusV = sampleDirection(field, width, height, offset(d, frame.v, -step));
    const du = (plusU - minusU) / (2 * step), dv = (plusV - minusV) / (2 * step);
    return { normal: normalFromGradient(d, frame, du, dv, reliefScale), du, dv };
  }
  function normalFromGradient(d, frame, du, dv, reliefScale) {
    return normalize({ x: d.x - reliefScale * (du * frame.u.x + dv * frame.v.x),
      y: d.y - reliefScale * (du * frame.u.y + dv * frame.v.y),
      z: d.z - reliefScale * (du * frame.u.z + dv * frame.v.z) });
  }

  function encodeNormal(pixels, offset, n) {
    pixels[offset] = Math.round((n.x * .5 + .5) * 255);
    pixels[offset + 1] = Math.round((n.y * .5 + .5) * 255);
    pixels[offset + 2] = Math.round((n.z * .5 + .5) * 255);
  }

  function quantizeTerrainNormal(normal, d, frame, jitter, stepDegrees, jitterStrength, minTilt = .012) {
    const radial = clamp(dot(normal, d), -1, 1);
    const tilt = Math.acos(radial);
    if (tilt < minTilt) return normal;
    const tangentU = dot(normal, frame.u), tangentV = dot(normal, frame.v);
    const azimuth = Math.atan2(tangentV, tangentU);
    const step = stepDegrees * Math.PI / 180;
    const azimuthStep = Math.max(10 * Math.PI / 180, step * 2.8);
    const phase = clamp(jitterStrength, 0, .35);
    const tiltQ = clamp(Math.round(tilt / step + jitter * phase) * step, 0, Math.PI * .46);
    const azimuthQ = Math.round((azimuth / azimuthStep) + jitter * phase) * azimuthStep;
    const sinTilt = Math.sin(tiltQ);
    return normalize({ x: d.x * Math.cos(tiltQ) + sinTilt * (frame.u.x * Math.cos(azimuthQ) + frame.v.x * Math.sin(azimuthQ)),
      y: d.y * Math.cos(tiltQ) + sinTilt * (frame.u.y * Math.cos(azimuthQ) + frame.v.y * Math.sin(azimuthQ)),
      z: d.z * Math.cos(tiltQ) + sinTilt * (frame.u.z * Math.cos(azimuthQ) + frame.v.z * Math.sin(azimuthQ)) });
  }

  function cellRandom(x, y, z, seed, salt = 0) {
    let h = (seed ^ salt) >>> 0;
    h = Math.imul(h ^ x, 0x45d9f3b) >>> 0;
    h = Math.imul(h ^ y, 0x45d9f3b) >>> 0;
    h = Math.imul(h ^ z, 0x45d9f3b) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }

  function facetSite(x, y, z, seed) {
    const tone = cellRandom(x, y, z, seed, 0x1a2b3c4d) * 2 - 1;
    const inset = .06, span = .88;
    return { x: x + inset + cellRandom(x, y, z, seed, 0x6c8e9cf5) * span,
      y: y + inset + cellRandom(x, y, z, seed, 0x3d72a4b1) * span,
      z: z + inset + cellRandom(x, y, z, seed, 0x52f8d731) * span,
      key: `${x},${y},${z}`, tone };
  }

  function valueNoise3(x, y, z, seed, salt) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
    const z0 = mix(mix(cellRandom(ix, iy, iz, seed, salt), cellRandom(ix + 1, iy, iz, seed, salt), sx),
      mix(cellRandom(ix, iy + 1, iz, seed, salt), cellRandom(ix + 1, iy + 1, iz, seed, salt), sx), sy);
    const z1 = mix(mix(cellRandom(ix, iy, iz + 1, seed, salt), cellRandom(ix + 1, iy, iz + 1, seed, salt), sx),
      mix(cellRandom(ix, iy + 1, iz + 1, seed, salt), cellRandom(ix + 1, iy + 1, iz + 1, seed, salt), sx), sy);
    return mix(z0, z1, sz) * 2 - 1;
  }

  function inverseWarpedSite(site, scale, seed) {
    let x = site.x, y = site.y, z = site.z;
    for (let i = 0; i < 2; i += 1) {
      x = site.x - valueNoise3(x * .42, y * .42, z * .42, seed, 0x7a43c215) * .48;
      y = site.y - valueNoise3(x * .42, y * .42, z * .42, seed, 0x3f51d8a7) * .48;
      z = site.z - valueNoise3(x * .42, y * .42, z * .42, seed, 0xb71c930d) * .48;
    }
    return normalize({ x: x / scale, y: y / scale, z: z / scale });
  }

  function nearestFacetSite(d, scale, seed) {
    let px = d.x * scale, py = d.y * scale, pz = d.z * scale;
    const sourceX = px, sourceY = py, sourceZ = pz;
    // A low-frequency spherical domain warp makes the cells breathe and
    // bend like watercolor pigment instead of exposing a regular 3D lattice.
    px += valueNoise3(sourceX * .42, sourceY * .42, sourceZ * .42, seed, 0x7a43c215) * .48;
    py += valueNoise3(sourceX * .42, sourceY * .42, sourceZ * .42, seed, 0x3f51d8a7) * .48;
    pz += valueNoise3(sourceX * .42, sourceY * .42, sourceZ * .42, seed, 0xb71c930d) * .48;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    let nearest = null, nearestDistance = Infinity;
    for (let z = -1; z <= 1; z += 1) for (let y = -1; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) {
      const site = facetSite(ix + x, iy + y, iz + z, seed);
      const dx = site.x - px, dy = site.y - py, dz = site.z - pz;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < nearestDistance) { nearestDistance = distance; nearest = site; }
    }
    return nearest;
  }

  function plainFacetMap(midNormals, width, height, scale, seed, facetAngle, facetJitter) {
    const pixels = new Uint8Array(width * height * 4), cells = new Map();
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const d = y === 0 ? { x: 0, y: 1, z: 0 } : y === height - 1 ? { x: 0, y: -1, z: 0 } : direction(x / width, y / (height - 1));
      const site = nearestFacetSite(d, scale, seed);
      let cell = cells.get(site.key);
      if (!cell) {
        const center = inverseWarpedSite(site, scale, seed), uv = Projection.sphereToTerrain(center, uvTerrain);
        const smooth = normalize({ x: sample(midNormals, width, height, uv.x, uv.y, 3, 0),
          y: sample(midNormals, width, height, uv.x, uv.y, 3, 1),
          z: sample(midNormals, width, height, uv.x, uv.y, 3, 2) });
        const frame = tangentFrame(center);
        // Boost only the real mid-scale slope before quantizing it into a
        // coherent face. This makes shallow plains read as watercolor facets.
        const amplified = normalize({ x: center.x + (smooth.x - center.x) * 2.2,
          y: center.y + (smooth.y - center.y) * 2.2, z: center.z + (smooth.z - center.z) * 2.2 });
        cell = { normal: quantizeTerrainNormal(amplified, center, frame, site.tone * .5,
          facetAngle * .82, facetJitter, .0015), tone: site.tone };
        cells.set(site.key, cell);
      }
      const o = (y * width + x) * 4;
      encodeNormal(pixels, o, cell.normal);
      pixels[o + 3] = Math.round((cell.tone * .5 + .5) * 255);
    }
    return { pixels, cells: cells.size };
  }

  function styleKey(style) {
    const s = style.stylizedTerrain;
    return JSON.stringify([s.fieldWidth, s.textureWidth, s.heightLowPass, s.macroLowPass, s.localLowPass, s.classLowPass,
      s.hillQuantile, s.mountainQuantile, s.summitQuantile, s.normalReliefScale, s.residualNormalStrength,
      s.localNormalStrength, s.smallMassifStrength, s.smallMassifNormalStrength, s.highlandMaterialMix,
      s.macroNormalStrength, s.plainNormalStrength, s.rollingNormalStrength, s.hillockNormalStrength,
      s.hillNormalStrength, s.plainFacetScale, s.plainFacetStrength, s.plainWashStrength, s.mountainNormalStrength,
      s.facetAngleDegrees, s.facetJitter, s.facetStrength, s.materials]);
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
    const valley = new Float32Array(count);
    const range = Projection.visualReliefRange(terrain, style.relief), sea = terrain.seaLevel;
    const surfaceSeed = root.OrbitWorld.hashSeed(`${planet.seed}:surface-v2`);
    const facetSeed = root.OrbitWorld.hashSeed(`${planet.seed}:watercolor-facets-v1`);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = y * width + x, tx = x / width * (terrain.width - 1), ty = y / (height - 1) * (terrain.height - 1);
      const field = values => Projection.sampleField(values, tx, ty, terrain);
      elevation[i] = field(terrain.elevation);
      heights[i] = Projection.normalizeVisualHeight(elevation[i], range);
      moisture[i] = field(terrain.moisture) / 255;
      mountain[i] = field(terrain.mountainMask) / 255;
      ridge[i] = field(terrain.ridgeField) / 255;
      ruggedness[i] = field(terrain.ruggednessField) / 255;
      valley[i] = field(terrain.valleyField) / 255;
    }

    const mid = lowPass(heights, width, height, settings.heightLowPass);
    const macro = lowPass(mid, width, height, settings.macroLowPass);
    const local = lowPass(heights, width, height, settings.localLowPass);
    const humidity = lowPass(moisture, width, height, settings.macroLowPass);
    // A second, terrain-scale moisture wash breaks broad biome color blocks
    // without adding independent noise or changing the generated climate.
    const localHumidity = lowPass(moisture, width, height, .022);
    const broadMountain = lowPass(mountain, width, height, settings.macroLowPass);
    const broadRuggedness = lowPass(ruggedness, width, height, settings.classLowPass);
    const visualRidge = lowPass(ridge, width, height, settings.heightLowPass);
    const visualValley = lowPass(valley, width, height, settings.classLowPass);
    const residual = new Float32Array(count), positiveResidual = new Float32Array(count);
    const localResidual = new Float32Array(count), localMagnitude = new Float32Array(count);
    const macroNormals = new Float32Array(count * 3), midNormals = new Float32Array(count * 3);
    const mountainNormals = new Float32Array(count * 3), localNormals = new Float32Array(count * 3);
    const slopes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      residual[i] = mid[i] - macro[i];
      positiveResidual[i] = Math.max(0, residual[i]);
      localResidual[i] = local[i] - mid[i];
      localMagnitude[i] = Math.abs(localResidual[i]);
    }

    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = y * width + x, d = direction(x / width, y / (height - 1)), frame = tangentFrame(d);
      // Keep unattenuated source normals. Their layer strengths are applied
      // once, when composing the visual normal, including on calm plains.
      const broad = normalField(macro, width, height, d, frame, settings.macroLowPass, settings.normalReliefScale);
      const middle = normalField(mid, width, height, d, frame, settings.heightLowPass, settings.normalReliefScale);
      const close = normalField(localResidual, width, height, d, frame,
        Math.max(.012, settings.heightLowPass * .75), settings.normalReliefScale);
      // The mountain layer amplifies only the real mid-minus-macro residual.
      // Existing ridges and shoulders become clearer; no new noise is added.
      const residualScale = settings.residualNormalStrength;
      const mountainNormal = normalFromGradient(d, frame,
        middle.du + (middle.du - broad.du) * residualScale,
        middle.dv + (middle.dv - broad.dv) * residualScale, settings.normalReliefScale);
      const localNormal = normalFromGradient(d, frame,
        middle.du + (middle.du - broad.du) * residualScale + close.du,
        middle.dv + (middle.dv - broad.dv) * residualScale + close.dv, settings.normalReliefScale);
      macroNormals.set([broad.normal.x, broad.normal.y, broad.normal.z], i * 3);
      midNormals.set([middle.normal.x, middle.normal.y, middle.normal.z], i * 3);
      mountainNormals.set([mountainNormal.x, mountainNormal.y, mountainNormal.z], i * 3);
      localNormals.set([localNormal.x, localNormal.y, localNormal.z], i * 3);
      const localSlope = Math.atan(Math.hypot(middle.du, middle.dv) * settings.normalReliefScale * 1.6);
      slopes[i] = clamp(localSlope / .42);
    }
    const plainFacets = plainFacetMap(midNormals, width, height, settings.plainFacetScale,
      facetSeed, settings.facetAngleDegrees, settings.facetJitter);

    const quantile = (field, q, upper = 1) => scalarQuantile(field, elevation, width, height, sea, q, upper);
    const residual15 = quantile(positiveResidual, .15, .5), residual30 = quantile(positiveResidual, .30, .5);
    const residual82 = quantile(positiveResidual, .82, .5), residual90 = quantile(positiveResidual, .90, .5);
    const residual94 = quantile(positiveResidual, .94, .5);
    const localReference = Math.max(.002, quantile(localMagnitude, .94, .25));
    const hillScore = new Float32Array(count), mountainScore = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const normalizedResidual = smoothstep(0, Math.max(.005, residual94), positiveResidual[i]);
      hillScore[i] = macro[i] * .35 + normalizedResidual * .35 + broadRuggedness[i] * .30;
      mountainScore[i] = broadMountain[i] * .60 + broadRuggedness[i] * .22 + slopes[i] * .12 + normalizedResidual * .06;
    }
    const broadHillScore = lowPass(hillScore, width, height, settings.classLowPass);
    const broadMountainScore = lowPass(mountainScore, width, height, settings.classLowPass);
    const thresholds = [landQuantile(broadHillScore, elevation, width, height, sea, settings.hillQuantile),
      ...[settings.mountainQuantile, settings.summitQuantile].map(q =>
        landQuantile(broadMountainScore, elevation, width, height, sea, q))];
    const hillEdge = Math.max(.020, (quantile(broadHillScore, .90) - quantile(broadHillScore, .10)) * .12);
    const mountainEdge = Math.max(.012, (thresholds[2] - thresholds[1]) * .14);
    const classPixels = new Uint8Array(count * 4), classWeights = new Float32Array(count * 4);
    const climate = planet.kind === 'glacée' ? 'frozen' : planet.kind === 'aride' ? 'arid' : planet.kind === 'volcanique' ? 'volcanic' : 'temperate';
    const materials = Object.fromEntries(Object.entries(settings.materials[climate]).map(([k, v]) => [k, rgb(v)]));
    const temperature = Number.isFinite(planet.temperature) ? planet.temperature : 16;
    const polarSeed = surfaceSeed ^ 0x5b1ce8a3;
    const polarThreshold = Surface.polarIceThreshold(temperature, style.polarCaps);
    const totals = [0, 0, 0, 0]; let landArea = 0;
    const snowField = new Float32Array(count);

    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = y * width + x, area = Math.max(0, Math.sin(y / (height - 1) * Math.PI));
      const hill = smoothstep(thresholds[0] - hillEdge, thresholds[0] + hillEdge, broadHillScore[i]);
      // Quantiles calibrate the amount of relief, but elevation alone can
      // never promote a high plateau into a mountain range.
      const mountainEvidence = smoothstep(.025, .24, broadMountain[i]) * smoothstep(1.5, 5, elevation[i] - sea);
      const mass = smoothstep(thresholds[1] - mountainEdge, thresholds[1] + mountainEdge,
        broadMountainScore[i]) * mountainEvidence;
      const summit = smoothstep(thresholds[2] - mountainEdge * .6, thresholds[2] + mountainEdge * .6,
        broadMountainScore[i]);
      const weights = [(1 - mass) * (1 - hill), (1 - mass) * hill, mass * (1 - summit), mass * summit];
      classWeights.set(weights, i * 4);
      for (let c = 0; c < 4; c += 1) {
        classPixels[i * 4 + c] = Math.round(weights[c] * 255);
        if (elevation[i] > sea) totals[c] += weights[c] * area;
      }
      if (elevation[i] > sea) landArea += area;

      const d = direction(x / width, y / (height - 1));
      const latitudeDegrees = Math.asin(clamp(Math.abs(d.y))) * 180 / Math.PI;
      const polar = climate !== 'volcanic' && latitudeDegrees > polarThreshold - style.polarCaps.eligibilityMarginDegrees
        ? Surface.polarIceCoverage(d.x, d.y, d.z, temperature, polarSeed, style.polarCaps) : 0;
      const localTemperature = temperature - Math.pow(Math.abs(d.y), 1.55) * 38 - mid[i] * 20;
      const cold = 1 - smoothstep(-10, 3, localTemperature);
      const highSnow = smoothstep(.78, .96, mid[i]) * cold * (.18 + slopes[i] * .28);
      const summitSnow = weights[3] * cold * .42;
      snowField[i] = climate === 'volcanic' ? 0 : Math.max(polar * .96, highSnow, summitSnow);
    }

    const rugged25 = quantile(broadRuggedness, .25), rugged92 = quantile(broadRuggedness, .92);
    const rollingRaw = new Float32Array(count), hillockRaw = new Float32Array(count);
    const smallMassifRaw = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      if (elevation[i] <= sea) continue;
      const plainOrHill = classWeights[i * 4] + classWeights[i * 4 + 1] * .58;
      const raised = 1 - clamp(classWeights[i * 4 + 2] + classWeights[i * 4 + 3]);
      const inland = smoothstep(1.5, 6, elevation[i] - sea);
      const residualAmount = smoothstep(residual15, Math.max(residual15 + .002, residual82), positiveResidual[i]);
      const ruggedAmount = smoothstep(rugged25, Math.max(rugged25 + .02, rugged92), broadRuggedness[i]);
      rollingRaw[i] = clamp(plainOrHill * raised * inland * (.20 + .48 * residualAmount + .32 * ruggedAmount) * .72);
      hillockRaw[i] = smoothstep(residual82, Math.max(residual82 + .002, residual94), positiveResidual[i]) *
        (classWeights[i * 4] + classWeights[i * 4 + 1]) * raised * inland;
      smallMassifRaw[i] = (classWeights[i * 4] + classWeights[i * 4 + 1] * .85) *
        (1 - classWeights[i * 4 + 2] * .75) * inland *
        (smoothstep(residual30, Math.max(residual30 + .002, residual90), positiveResidual[i]) * .55 +
          ruggedAmount * .45);
    }
    const rollingField = lowPass(rollingRaw, width, height, .018);
    const hillockField = lowPass(hillockRaw, width, height, .030);
    const smallMassifField = lowPass(smallMassifRaw, width, height, .040);
    const rollingReference = Math.max(.08, scalarQuantile(rollingField, elevation, width, height, sea, .78, 1));
    const smallMassifReference = Math.max(.08, quantile(smallMassifField, .82));
    const smallMassifPixels = new Uint8Array(count);
    let rollingMean = 0, smallMassifMean = 0;
    for (let i = 0; i < count; i += 1) {
      rollingField[i] = clamp(rollingField[i] / rollingReference);
      rollingMean += rollingField[i];
      // Preserve a soft shoulder around each secondary massif. Normalizing
      // the existing relief never adds new geometry or independent noise.
      smallMassifField[i] = clamp(smoothstep(.12, 1, smallMassifField[i] / smallMassifReference) * settings.smallMassifStrength);
      smallMassifPixels[i] = Math.round(smallMassifField[i] * 255);
      smallMassifMean += smallMassifField[i];
    }
    rollingMean /= count;
    smallMassifMean /= count;

    const textureWidth = settings.textureWidth, textureHeight = Math.round(textureWidth / 2);
    const normalPixels = new Uint8Array(textureWidth * textureHeight * 4);
    const realNormalPixels = new Uint8Array(normalPixels.length), materialPixels = new Uint8Array(normalPixels.length);
    const classes = new Float32Array(4), macroNormal = new Float32Array(3), midNormal = new Float32Array(3);
    const mountainNormalField = new Float32Array(3), localNormalField = new Float32Array(3);

    for (let y = 0; y < textureHeight; y += 1) for (let x = 0; x < textureWidth; x += 1) {
      const u = x / textureWidth, v = y / (textureHeight - 1), o = (y * textureWidth + x) * 4;
      for (let c = 0; c < 4; c += 1) classes[c] = sample(classPixels, width, height, u, v, 4, c) / 255;
      const d = direction(u, v), frame = tangentFrame(d);
      for (let c = 0; c < 3; c += 1) {
        macroNormal[c] = sample(macroNormals, width, height, u, v, 3, c);
        midNormal[c] = sample(midNormals, width, height, u, v, 3, c);
        mountainNormalField[c] = sample(mountainNormals, width, height, u, v, 3, c);
        localNormalField[c] = sample(localNormals, width, height, u, v, 3, c);
      }
      const real = normalize({ x: midNormal[0], y: midNormal[1], z: midNormal[2] });
      const residualAtPixel = sample(residual, width, height, u, v);
      const localResidualAtPixel = sample(localResidual, width, height, u, v);
      const localRuggedness = sample(broadRuggedness, width, height, u, v);
      const jitter = clamp((residualAtPixel - residual30) / Math.max(.001, residual90 - residual30) - .45, -.5, .5) * .55 +
        clamp(localRuggedness - .5, -.5, .5) * .35;
      // The third band is only composed into the mountain layer. It is a
      // residual of the existing relief, never a full-resolution micro-normal.
      const mountainReal = normalize({
        x: mix(mountainNormalField[0], localNormalField[0], settings.localNormalStrength),
        y: mix(mountainNormalField[1], localNormalField[1], settings.localNormalStrength),
        z: mix(mountainNormalField[2], localNormalField[2], settings.localNormalStrength) });
      const faceted = quantizeTerrainNormal(mountainReal, d, frame, jitter, settings.facetAngleDegrees, settings.facetJitter);
      const rolling = sample(rollingField, width, height, u, v);
      const hillocks = sample(hillockField, width, height, u, v);
      const smallMassif = sample(smallMassifField, width, height, u, v);
      const mountainWeight = clamp(classes[2] + classes[3]);
      const macroMix = mix(settings.plainNormalStrength, settings.macroNormalStrength, 1 - classes[0]);
      const smoothBase = normalize({ x: mix(d.x, macroNormal[0], macroMix),
        y: mix(d.y, macroNormal[1], macroMix), z: mix(d.z, macroNormal[2], macroMix) });
      const secondaryStrength = clamp(rolling * settings.rollingNormalStrength + hillocks * settings.hillockNormalStrength +
        smallMassif * settings.smallMassifNormalStrength + classes[1] * settings.hillNormalStrength, 0, .55);
      let styled = normalize({ x: mix(smoothBase.x, real.x, secondaryStrength),
        y: mix(smoothBase.y, real.y, secondaryStrength), z: mix(smoothBase.z, real.z, secondaryStrength) });
      // Plains also receive broad watercolor-like faces. Their normals come
      // from the real, low-passed terrain and are only gently quantized; no
      // regular globe mesh or added noise is involved.
      const plainActivity = clamp(rolling * .48 + hillocks * .70 + smallMassif * .78 + classes[1] * .52);
      const plainFacetNormal = quantizeTerrainNormal(real, d, frame, jitter,
        Math.max(3.2, settings.facetAngleDegrees * .72), settings.facetJitter, .0025);
      const isLandPixel = sample(elevation, width, height, u, v) > sea;
      const plainFacetMix = (isLandPixel ? 1 : 0) * (1 - mountainWeight) * clamp(settings.plainFacetStrength) *
        (.20 + plainActivity * .72);
      styled = normalize({ x: mix(styled.x, plainFacetNormal.x, plainFacetMix),
        y: mix(styled.y, plainFacetNormal.y, plainFacetMix), z: mix(styled.z, plainFacetNormal.z, plainFacetMix) });
      const mountainStyled = normalize({ x: mix(mountainReal.x, faceted.x, settings.facetStrength),
        y: mix(mountainReal.y, faceted.y, settings.facetStrength), z: mix(mountainReal.z, faceted.z, settings.facetStrength) });
      const mountainMix = clamp(mountainWeight * settings.mountainNormalStrength);
      let unfaceted = normalize({ x: mix(styled.x, mountainReal.x, mountainMix),
        y: mix(styled.y, mountainReal.y, mountainMix), z: mix(styled.z, mountainReal.z, mountainMix) });
      styled = normalize({ x: mix(styled.x, mountainStyled.x, mountainMix), y: mix(styled.y, mountainStyled.y, mountainMix),
        z: mix(styled.z, mountainStyled.z, mountainMix) });
      const latitudeDegrees = Math.asin(clamp(Math.abs(d.y))) * 180 / Math.PI;
      const polarFade = smoothstep(88.0, 89.95, latitudeDegrees);
      styled = normalize({ x: mix(styled.x, d.x, polarFade), y: mix(styled.y, d.y, polarFade), z: mix(styled.z, d.z, polarFade) });
      unfaceted = normalize({ x: mix(unfaceted.x, d.x, polarFade), y: mix(unfaceted.y, d.y, polarFade),
        z: mix(unfaceted.z, d.z, polarFade) });
      encodeNormal(normalPixels, o, styled);
      encodeNormal(realNormalPixels, o, unfaceted);
      normalPixels[o + 3] = Math.round(clamp(rolling * .72 + hillocks * .85) * 255);
      // Reuse the otherwise unused alpha channel for the signed local-relief
      // diagnostic; the normal RGB channels retain their original format.
      realNormalPixels[o + 3] = Math.round(128 + 127 * clamp(localResidualAtPixel / localReference, -1, 1) * mountainWeight);

      const broadWet = sample(humidity, width, height, u, v);
      const localWet = sample(localHumidity, width, height, u, v);
      const wet = mix(broadWet, localWet, .58), heightValue = sample(mid, width, height, u, v);
      const localSlope = sample(slopes, width, height, u, v);
      const crest = sample(visualRidge, width, height, u, v), hollow = sample(visualValley, width, height, u, v);
      const rollingAtPixel = rolling, hillockAtPixel = hillocks;
      const surfaceElevation = sample(elevation, width, height, u, v);
      const isSea = surfaceElevation <= sea;
      const plainCoverage = clamp(classes[0] + classes[1] * .72);
      const residualWash = smoothstep(residual15, Math.max(residual15 + .002, residual82), Math.max(0, residualAtPixel));
      const pigmentWash = clamp(residualWash * .38 + smoothstep(.30, .72, localWet) * .38 +
        rollingAtPixel * .14 + hillockAtPixel * .10);
      const watercolorMix = clamp(settings.plainWashStrength) * plainCoverage * (.62 + pigmentWash * .38);
      const facetTone = sample(plainFacets.pixels, width, height, u, v, 4, 3) / 127.5 - 1;
      const elevatedHighland = mountainWeight * smoothstep(.58, .82, heightValue);
      const rockExposure = mountainWeight * smoothstep(.42, .78, heightValue) * smoothstep(.14, .42, localSlope);
      const summitExposure = classes[3] * smoothstep(.72, .90, heightValue);
      const snowBase = smoothstep(.12, .84, sample(snowField, width, height, u, v));
      // Break up only the continental snow edge, after mask remapping, so
      // its shift stays bounded, with more articulation in the highlands.
      const snowBreakup = clamp((residualAtPixel * 1.9 + localResidualAtPixel * 1.2) *
        (.75 + .35 * clamp(elevatedHighland + summitExposure)), -.085, .085);
      const snowValue = clamp(snowBase + (isSea ? 0 : snowBreakup * 4 * snowBase * (1 - snowBase)));
      const foothillWeight = clamp(mountainWeight * smoothstep(.20, .62, heightValue) *
        (.36 + .28 * smoothstep(.08, .30, localSlope)) + classes[1] * smoothstep(.28, .68, heightValue) * .12);
      const ridgeMask = mountainWeight * crest * smoothstep(.38, .78, heightValue);
      const valleyExposure = hollow * (classes[1] * .24 + mountainWeight) *
        smoothstep(.15, .50, crest + mountainWeight) * .12;
      const regionalVariation = clamp((wet - .5) * .07 +
        (sample(macro, width, height, u, v) - .35) * .025 - rollingAtPixel * .012, -.05, .05);
      for (let channel = 0; channel < 3; channel += 1) {
        let plain = mix(materials.plain[channel], materials.wet[channel], smoothstep(.40, .76, wet) * .80);
        plain = mix(plain, materials.dry[channel], (1 - smoothstep(.12, .40, wet)) * .34);
        const washColor = mix(materials.dry[channel], materials.wet[channel], smoothstep(.24, .78, localWet));
        let color = mix(plain, washColor, watercolorMix);
        color = mix(color, materials.rolling[channel], rollingAtPixel * .18 + hillockAtPixel * .26);
        color = mix(color, materials.hill[channel], clamp(classes[1] * .72 + mountainWeight * .62));
        color = mix(color, materials.foothill[channel], clamp(foothillWeight * .45 + smallMassif * .22));
        color = mix(color, materials.highland[channel], elevatedHighland * settings.highlandMaterialMix);
        color = mix(color, materials.mountain[channel], rockExposure * .60);
        color = mix(color, materials.ridge[channel], clamp(summitExposure * .58 + ridgeMask * .24));
        color = mix(color, materials.crevice[channel], clamp(valleyExposure));
        // Seeded, soft-edged cell pigment gives each broad plain a small
        // watercolor variation. The cell normal itself remains tied to the
        // filtered height at that cell's spherical center.
        const channelTint = channel === 0 ? .22 : channel === 1 ? .12 : -.16;
        color *= 1 + facetTone * watercolorMix * channelTint;
        // Broad humidity and altitude make small regional color shifts; there
        // is deliberately no fine noise in the albedo.
        color *= 1 + regionalVariation;
        if (isSea && (climate === 'temperate' || climate === 'frozen')) color = materials.ice[channel];
        if (isSea && climate === 'arid') color *= .73;
        color = mix(color, isSea ? materials.ice[channel] : materials.snow[channel], snowValue);
        materialPixels[o + channel] = Math.round(clamp(color, 0, 255));
      }
      const polarCoverage = isSea && (climate === 'temperate' || climate === 'frozen') ? sample(snowField, width, height, u, v) : 0;
      materialPixels[o + 3] = Math.round(clamp(Math.max(snowValue, polarCoverage)) * 255);
    }

    const result = Object.freeze({ key, width: textureWidth, height: textureHeight, classWidth: width, classHeight: height,
      terrainVisualClassPixels: classPixels, smallMassifPixels,
      plainFacetNormalPixels: plainFacets.pixels,
      stylizedNormalPixels: normalPixels, realMountainNormalPixels: realNormalPixels,
      materialPixels, climate, sand: settings.materials[climate].sand, thresholds,
      proportions: Object.fromEntries(['plain', 'hill', 'mountain', 'summit'].map((name, i) => [name, totals[i] / Math.max(1, landArea)])),
      rollingRelief: { residual82, residual94, mean: rollingMean, reference: rollingReference },
      localRelief: { reference: localReference, strength: settings.localNormalStrength },
      smallMassifs: { reference: smallMassifReference, mean: smallMassifMean, strength: settings.smallMassifStrength },
      plainFacets: { cells: plainFacets.cells, scale: settings.plainFacetScale, strength: settings.plainFacetStrength },
      generationMs: performance.now() - start });
    cache.set(terrain, result); return result;
  }

  root.OrbitPlanetTerrainVisuals = Object.freeze({ create, styleKey });
})(globalThis);
