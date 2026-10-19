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

  function quantizeTerrainNormal(normal, d, frame, jitter, stepDegrees, jitterStrength) {
    const radial = clamp(dot(normal, d), -1, 1);
    const tilt = Math.acos(radial);
    if (tilt < .012) return normal;
    const tangentU = dot(normal, frame.u), tangentV = dot(normal, frame.v);
    const azimuth = Math.atan2(tangentV, tangentU);
    const step = stepDegrees * Math.PI / 180;
    const azimuthStep = 22 * Math.PI / 180;
    const phase = clamp(jitterStrength, 0, .35);
    const tiltQ = clamp(Math.round(tilt / step + jitter * phase) * step, 0, Math.PI * .46);
    const azimuthQ = Math.round((azimuth / azimuthStep) + jitter * phase) * azimuthStep;
    const sinTilt = Math.sin(tiltQ);
    return normalize({ x: d.x * Math.cos(tiltQ) + sinTilt * (frame.u.x * Math.cos(azimuthQ) + frame.v.x * Math.sin(azimuthQ)),
      y: d.y * Math.cos(tiltQ) + sinTilt * (frame.u.y * Math.cos(azimuthQ) + frame.v.y * Math.sin(azimuthQ)),
      z: d.z * Math.cos(tiltQ) + sinTilt * (frame.u.z * Math.cos(azimuthQ) + frame.v.z * Math.sin(azimuthQ)) });
  }

  function styleKey(style) {
    const s = style.stylizedTerrain;
    return JSON.stringify([s.fieldWidth, s.textureWidth, s.heightLowPass, s.macroLowPass, s.classLowPass,
      s.hillQuantile, s.mountainQuantile, s.summitQuantile, s.normalReliefScale, s.residualNormalStrength,
      s.macroNormalStrength, s.plainNormalStrength, s.rollingNormalStrength, s.hillockNormalStrength,
      s.hillNormalStrength, s.mountainNormalStrength, s.facetAngleDegrees, s.facetJitter, s.facetStrength, s.materials]);
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
    const residual = new Float32Array(count), positiveResidual = new Float32Array(count);
    const macroNormals = new Float32Array(count * 3), midNormals = new Float32Array(count * 3);
    const mountainNormals = new Float32Array(count * 3);
    const slopes = new Float32Array(count);

    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = y * width + x, d = direction(x / width, y / (height - 1)), frame = tangentFrame(d);
      const broad = normalField(macro, width, height, d, frame, .075, settings.normalReliefScale * settings.macroNormalStrength);
      const middle = normalField(mid, width, height, d, frame, .022, settings.normalReliefScale);
      // The mountain layer amplifies only the real mid-minus-macro residual.
      // Existing ridges and shoulders become clearer; no new noise is added.
      const residualScale = settings.residualNormalStrength;
      const mountainNormal = normalFromGradient(d, frame,
        middle.du + (middle.du - broad.du) * residualScale,
        middle.dv + (middle.dv - broad.dv) * residualScale, settings.normalReliefScale);
      macroNormals.set([broad.normal.x, broad.normal.y, broad.normal.z], i * 3);
      midNormals.set([middle.normal.x, middle.normal.y, middle.normal.z], i * 3);
      mountainNormals.set([mountainNormal.x, mountainNormal.y, mountainNormal.z], i * 3);
      const localSlope = Math.atan(Math.hypot(middle.du, middle.dv) * settings.normalReliefScale * 1.6);
      slopes[i] = clamp(localSlope / .42);
      residual[i] = mid[i] - macro[i];
      positiveResidual[i] = Math.max(0, residual[i]);
      const inland = smoothstep(1.5, 5, elevation[i] - sea);
      score[i] = clamp(macro[i] * .52 + inland * (broadMountain[i] * .30 + broadRuggedness[i] * .14 + slopes[i] * .12));
    }

    const broadScore = lowPass(score, width, height, settings.classLowPass);
    const thresholds = [settings.hillQuantile, settings.mountainQuantile, settings.summitQuantile]
      .map(q => landQuantile(broadScore, elevation, width, height, sea, q));
    const classPixels = new Uint8Array(count * 4), classWeights = new Float32Array(count * 4);
    const climate = planet.kind === 'glacée' ? 'frozen' : planet.kind === 'aride' ? 'arid' : planet.kind === 'volcanique' ? 'volcanic' : 'temperate';
    const materials = Object.fromEntries(Object.entries(settings.materials[climate]).map(([k, v]) => [k, rgb(v)]));
    const temperature = Number.isFinite(planet.temperature) ? planet.temperature : 16;
    const surfaceSeed = root.OrbitWorld.hashSeed(`${planet.seed}:surface-v2`), polarSeed = surfaceSeed ^ 0x5b1ce8a3;
    const polarThreshold = Surface.polarIceThreshold(temperature, style.polarCaps);
    const totals = [0, 0, 0, 0]; let landArea = 0;
    const snowField = new Float32Array(count);

    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = y * width + x, area = Math.max(0, Math.sin(y / (height - 1) * Math.PI));
      const s = broadScore[i], edge = Math.max(.008, (thresholds[2] - thresholds[0]) * .12);
      const hill = smoothstep(thresholds[0] - edge, thresholds[0] + edge, s);
      const mass = smoothstep(thresholds[1] - edge, thresholds[1] + edge, s);
      const summit = smoothstep(thresholds[2] - edge * .6, thresholds[2] + edge * .6, s);
      const weights = [1 - hill, hill * (1 - mass), hill * mass * (1 - summit), hill * mass * summit];
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
      // The snow edge follows the real mid/macro residual, rather than an
      // independent texture that could introduce another pattern.
      const edgeBreakup = clamp(residual[i] * 1.6, -.10, .10);
      snowField[i] = climate === 'volcanic' ? 0 : clamp(Math.max(polar * .96, highSnow, summitSnow) + edgeBreakup * cold);
    }

    const residual82 = scalarQuantile(positiveResidual, elevation, width, height, sea, .82, .5);
    const residual94 = scalarQuantile(positiveResidual, elevation, width, height, sea, .94, .5);
    const residual15 = scalarQuantile(positiveResidual, elevation, width, height, sea, .15, .5);
    const residual30 = scalarQuantile(positiveResidual, elevation, width, height, sea, .30, .5);
    const residual82ForRoll = scalarQuantile(positiveResidual, elevation, width, height, sea, .82, .5);
    const residual90 = scalarQuantile(positiveResidual, elevation, width, height, sea, .90, .5);
    const rugged25 = scalarQuantile(broadRuggedness, elevation, width, height, sea, .25, 1);
    const rugged60 = scalarQuantile(broadRuggedness, elevation, width, height, sea, .60, 1);
    const rugged92 = scalarQuantile(broadRuggedness, elevation, width, height, sea, .92, 1);
    const rollingRaw = new Float32Array(count), hillockRaw = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      if (elevation[i] <= sea) continue;
      const plainOrHill = classWeights[i * 4] + classWeights[i * 4 + 1] * .58;
      const raised = 1 - clamp(classWeights[i * 4 + 2] + classWeights[i * 4 + 3]);
      const inland = smoothstep(1.5, 6, elevation[i] - sea);
      const residualAmount = smoothstep(residual15, Math.max(residual15 + .002, residual82ForRoll), positiveResidual[i]);
      const ruggedAmount = smoothstep(rugged25, Math.max(rugged25 + .02, rugged92), broadRuggedness[i]);
      rollingRaw[i] = clamp(plainOrHill * raised * inland * (.20 + .48 * residualAmount + .32 * ruggedAmount) * .72);
      hillockRaw[i] = smoothstep(residual82, Math.max(residual82 + .002, residual94), positiveResidual[i]) *
        (classWeights[i * 4] + classWeights[i * 4 + 1]) * raised * inland;
    }
    const rollingField = lowPass(rollingRaw, width, height, .018);
    const hillockField = lowPass(hillockRaw, width, height, .030);
    const rollingReference = Math.max(.08, scalarQuantile(rollingField, elevation, width, height, sea, .78, 1));
    let rollingMean = 0;
    for (let i = 0; i < count; i += 1) {
      rollingField[i] = clamp(rollingField[i] / rollingReference);
      rollingMean += rollingField[i];
    }
    rollingMean /= count;

    const textureWidth = settings.textureWidth, textureHeight = Math.round(textureWidth / 2);
    const normalPixels = new Uint8Array(textureWidth * textureHeight * 4);
    const realNormalPixels = new Uint8Array(normalPixels.length), materialPixels = new Uint8Array(normalPixels.length);
    const classes = new Float32Array(4), macroNormal = new Float32Array(3), midNormal = new Float32Array(3);
    const mountainNormalField = new Float32Array(3);

    for (let y = 0; y < textureHeight; y += 1) for (let x = 0; x < textureWidth; x += 1) {
      const u = x / textureWidth, v = y / (textureHeight - 1), o = (y * textureWidth + x) * 4;
      for (let c = 0; c < 4; c += 1) classes[c] = sample(classPixels, width, height, u, v, 4, c) / 255;
      const d = direction(u, v), frame = tangentFrame(d);
      for (let c = 0; c < 3; c += 1) {
        macroNormal[c] = sample(macroNormals, width, height, u, v, 3, c);
        midNormal[c] = sample(midNormals, width, height, u, v, 3, c);
        mountainNormalField[c] = sample(mountainNormals, width, height, u, v, 3, c);
      }
      const real = normalize({ x: midNormal[0], y: midNormal[1], z: midNormal[2] });
      encodeNormal(realNormalPixels, o, real);
      const localResidual = sample(residual, width, height, u, v);
      const localRuggedness = sample(broadRuggedness, width, height, u, v);
      const jitter = clamp((localResidual - residual30) / Math.max(.001, residual90 - residual30) - .45, -.5, .5) * .55 +
        clamp(localRuggedness - .5, -.5, .5) * .35;
      const mountainReal = normalize({ x: mountainNormalField[0], y: mountainNormalField[1], z: mountainNormalField[2] });
      const faceted = quantizeTerrainNormal(mountainReal, d, frame, jitter, settings.facetAngleDegrees, settings.facetJitter);
      const rolling = sample(rollingField, width, height, u, v);
      const hillocks = sample(hillockField, width, height, u, v);
      const mountainWeight = clamp(classes[2] + classes[3]);
      const macroMix = mix(settings.plainNormalStrength, settings.macroNormalStrength, 1 - classes[0]);
      const smoothBase = normalize({ x: mix(d.x, macroNormal[0], macroMix),
        y: mix(d.y, macroNormal[1], macroMix), z: mix(d.z, macroNormal[2], macroMix) });
      const secondaryStrength = clamp(rolling * settings.rollingNormalStrength + hillocks * settings.hillockNormalStrength +
        classes[1] * settings.hillNormalStrength, 0, .55);
      let styled = normalize({ x: mix(smoothBase.x, real.x, secondaryStrength),
        y: mix(smoothBase.y, real.y, secondaryStrength), z: mix(smoothBase.z, real.z, secondaryStrength) });
      const mountainStyled = normalize({ x: mix(mountainReal.x, faceted.x, settings.facetStrength),
        y: mix(mountainReal.y, faceted.y, settings.facetStrength), z: mix(mountainReal.z, faceted.z, settings.facetStrength) });
      const mountainMix = clamp(mountainWeight * settings.mountainNormalStrength);
      styled = normalize({ x: mix(styled.x, mountainStyled.x, mountainMix), y: mix(styled.y, mountainStyled.y, mountainMix),
        z: mix(styled.z, mountainStyled.z, mountainMix) });
      const latitudeDegrees = Math.asin(clamp(Math.abs(d.y))) * 180 / Math.PI;
      const polarFade = smoothstep(88.0, 89.95, latitudeDegrees);
      styled = normalize({ x: mix(styled.x, d.x, polarFade), y: mix(styled.y, d.y, polarFade), z: mix(styled.z, d.z, polarFade) });
      encodeNormal(normalPixels, o, styled);
      normalPixels[o + 3] = Math.round(clamp(rolling * .72 + hillocks * .85) * 255);

      const wet = sample(humidity, width, height, u, v), heightValue = sample(mid, width, height, u, v);
      const localSlope = sample(slopes, width, height, u, v);
      const crest = sample(visualRidge, width, height, u, v), hollow = sample(visualValley, width, height, u, v);
      const rollingAtPixel = rolling, hillockAtPixel = hillocks;
      const snowValue = smoothstep(.12, .84, sample(snowField, width, height, u, v));
      const surfaceElevation = sample(elevation, width, height, u, v);
      const isSea = surfaceElevation <= sea;
      const mountainAtPixel = clamp(classes[2] + classes[3]);
      const ruggedSurface = Math.max(smoothstep(.12, .34, localSlope), smoothstep(.22, .50, localRuggedness) * .72);
      const mountainCore = classes[2] * smoothstep(.32, .65, heightValue) * ruggedSurface;
      const lowerMountain = Math.max(0, classes[2] - mountainCore);
      const foothillWeight = clamp(classes[1] * smoothstep(.24, .62, heightValue) * .22 + lowerMountain * .86);
      const rockExposure = mountainCore * smoothstep(.32, .66, heightValue);
      for (let channel = 0; channel < 3; channel += 1) {
        let plain = mix(materials.plain[channel], materials.wet[channel], smoothstep(.42, .80, wet) * .66);
        plain = mix(plain, materials.dry[channel], (1 - smoothstep(.12, .40, wet)) * .34);
        const hillColor = materials.hill[channel];
        let color = plain * classes[0] + hillColor * classes[1] + materials.foothill[channel] * lowerMountain +
          materials.mountain[channel] * mountainCore + materials.ridge[channel] * classes[3];
        const rollingColor = materials.rolling[channel];
        color = mix(color, rollingColor, rollingAtPixel * .16 + hillockAtPixel * .24);
        color = mix(color, materials.foothill[channel], foothillWeight * .48);
        color = mix(color, materials.mountain[channel], rockExposure * .42);
        color = mix(color, materials.ridge[channel], mountainAtPixel * crest * .22);
        color = mix(color, materials.crevice[channel], clamp(hollow * (classes[1] * .05 + mountainAtPixel * .24)));
        // Broad humidity and altitude make small regional color shifts; there
        // is deliberately no fine noise in the albedo.
        color *= 1 + (wet - .5) * .045 + (heightValue - .35) * .018;
        if (isSea && (climate === 'temperate' || climate === 'frozen')) color = materials.ice[channel];
        if (isSea && climate === 'arid') color *= .73;
        color = mix(color, isSea ? materials.ice[channel] : materials.snow[channel], snowValue);
        materialPixels[o + channel] = Math.round(clamp(color, 0, 255));
      }
      const polarCoverage = isSea && (climate === 'temperate' || climate === 'frozen') ? sample(snowField, width, height, u, v) : 0;
      materialPixels[o + 3] = Math.round(clamp(Math.max(snowValue, polarCoverage)) * 255);
    }

    const result = Object.freeze({ key, width: textureWidth, height: textureHeight, classWidth: width, classHeight: height,
      terrainVisualClassPixels: classPixels, stylizedNormalPixels: normalPixels, realMountainNormalPixels: realNormalPixels,
      materialPixels, climate, sand: settings.materials[climate].sand, thresholds,
      proportions: Object.fromEntries(['plain', 'hill', 'mountain', 'summit'].map((name, i) => [name, totals[i] / Math.max(1, landArea)])),
      rollingRelief: { residual82, residual94, mean: rollingMean, reference: rollingReference },
      generationMs: performance.now() - start });
    cache.set(terrain, result); return result;
  }

  root.OrbitPlanetTerrainVisuals = Object.freeze({ create, styleKey });
})(globalThis);
