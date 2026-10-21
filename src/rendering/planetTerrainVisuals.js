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
    const sinRadius = Math.sin(radius), polarRows = Math.max(2, Math.ceil(height * .012));
    for (let y = 0; y < height; y += 1) {
      const v = y / (height - 1), latitude = (.5 - v) * Math.PI;
      const cosLatitude = Math.max(.12, Math.cos(latitude));
      const useExactSphere = y < polarRows || y >= height - polarRows;
      for (let x = 0; x < width; x += 1) {
        let sum = field[y * width + x] * 4;
        if (useExactSphere) {
          const d = direction(x / width, v), frame = tangentFrame(d);
          const cosRadius = Math.cos(radius);
          for (const [c, s] of filterRing) {
            const t = { x: frame.u.x * c + frame.v.x * s, y: frame.u.y * c + frame.v.y * s,
              z: frame.u.z * c + frame.v.z * s };
            sum += sampleDirection(field, width, height, { x: d.x * cosRadius + t.x * sinRadius,
              y: d.y * cosRadius + t.y * sinRadius, z: d.z * cosRadius + t.z * sinRadius });
          }
        } else {
          // Away from the singularity, a local equirectangular metric is an
          // accurate small-angle approximation of the geodesic ring and
          // avoids millions of per-sample sphere projections during loading.
          const u = x / width;
          for (const [c, s] of filterRing) {
            const du = sinRadius * c / (2 * Math.PI * cosLatitude);
            const dv = sinRadius * s / Math.PI;
            sum += sample(field, width, height, u + du, v - dv);
          }
        }
        output[y * width + x] = sum / 12;
      }
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

  function resizeRgba(source, sourceWidth, sourceHeight, width, height) {
    if (sourceWidth === width && sourceHeight === height) return source;
    const output = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const u = x / width, v = y / (height - 1), offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[offset + channel] = Math.round(sample(source, sourceWidth, sourceHeight, u, v, 4, channel));
      }
    }
    return output;
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

  function plainFacetMap(midNormals, width, height, scale, seed, facetAngle, facetJitter, outputScale = 1,
    candidateWidth = 0) {
    // The raster only supplies four nearby candidates. The final boundary is
    // reconstructed from their actual 3D positions in the fragment shader,
    // so neither this map's resolution nor bilinear magnification blurs it.
    const outputWidth = Math.max(384, Math.round(width * outputScale), candidateWidth,
      Math.ceil(scale * 16));
    const outputHeight = Math.round(outputWidth / 2);
    const pixels = new Uint8Array(outputWidth * outputHeight * 4);
    const candidateIds = new Uint16Array(pixels.length), cells = [];
    const radius = Math.ceil(scale) + 3, span = radius * 2 + 1;
    const grid = new Int32Array(span * span * span); grid.fill(-1);
    const distances = new Float64Array(4), ids = new Uint16Array(4);
    function siteAt(x, y, z) {
      const index = ((z + radius) * span + y + radius) * span + x + radius;
      if (grid[index] >= 0) return cells[grid[index]];
      const site = { x: x + .06 + cellRandom(x, y, z, seed, 0x6c8e9cf5) * .88,
        y: y + .06 + cellRandom(x, y, z, seed, 0x3d72a4b1) * .88,
        z: z + .06 + cellRandom(x, y, z, seed, 0x52f8d731) * .88,
        tone: cellRandom(x, y, z, seed, 0x1a2b3c4d) * 2 - 1, id: cells.length };
      const center = normalize(site), uv = Projection.sphereToTerrain(center, uvTerrain);
      const smooth = normalize({ x: sample(midNormals, width, height, uv.x, uv.y, 3, 0),
        y: sample(midNormals, width, height, uv.x, uv.y, 3, 1),
        z: sample(midNormals, width, height, uv.x, uv.y, 3, 2) });
      const amplified = normalize({ x: center.x + (smooth.x - center.x) * 2.2,
        y: center.y + (smooth.y - center.y) * 2.2, z: center.z + (smooth.z - center.z) * 2.2 });
      site.center = center; site.uv = uv;
      site.normal = quantizeTerrainNormal(amplified, center, tangentFrame(center), site.tone * .5,
        facetAngle * .82, facetJitter, .0015);
      grid[index] = site.id; cells.push(site);
      return site;
    }
    for (let y = 0; y < outputHeight; y += 1) for (let x = 0; x < outputWidth; x += 1) {
      const d = y === 0 ? { x: 0, y: 1, z: 0 } : y === outputHeight - 1 ? { x: 0, y: -1, z: 0 } : direction(x / outputWidth, y / (outputHeight - 1));
      const px = d.x * scale, py = d.y * scale, pz = d.z * scale;
      const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
      distances.fill(Infinity);
      for (let dz = -1; dz <= 1; dz += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const site = siteAt(ix + dx, iy + dy, iz + dz);
        const sx = site.x - px, sy = site.y - py, sz = site.z - pz;
        const distance = sx * sx + sy * sy + sz * sz;
        if (distance >= distances[3]) continue;
        let k = 3;
        while (k > 0 && distance < distances[k - 1]) {
          distances[k] = distances[k - 1]; ids[k] = ids[k - 1]; k -= 1;
        }
        distances[k] = distance; ids[k] = site.id;
      }
      const o = (y * outputWidth + x) * 4;
      const cell = cells[ids[0]];
      candidateIds.set(ids, o);
      encodeNormal(pixels, o, cell.normal);
      pixels[o + 3] = Math.round((cell.tone * .5 + .5) * 255);
    }
    return { pixels, candidateIds, cellData: cells, cells: cells.length, scale,
      width: outputWidth, height: outputHeight };
  }

  function combineFacetMaps(layers) {
    const width = Math.max(...layers.map(layer => layer.width));
    const layerHeight = Math.max(...layers.map(layer => layer.height));
    const height = layerHeight * layers.length;
    const totalCells = layers.reduce((total, layer) => total + layer.cells, 0);
    if (totalCells > 65535) throw new Error(`Terrain facet atlas exceeds 16-bit cell IDs (${totalCells})`);
    const candidateIds = new Uint16Array(width * height * 4), cellData = [];
    let cellOffset = 0;
    layers.forEach((layer, layerIndex) => {
      const rowOffset = layerIndex * layerHeight;
      for (let y = 0; y < layer.height; y += 1) for (let x = 0; x < layer.width; x += 1) {
        const source = (y * layer.width + x) * 4;
        const target = ((rowOffset + y) * width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) candidateIds[target + channel] = layer.candidateIds[source + channel] + cellOffset;
      }
      for (const cell of layer.cellData) cellData.push({ ...cell, id: cell.id + cellOffset });
      layer.atlasOffset = cellOffset;
      layer.candidateRowOffset = rowOffset;
      cellOffset += layer.cells;
    });
    return { layers, width, height, layerHeight, cells: totalCells, candidateIds, cellData };
  }

  function facetAtlas(facets, normalPixels, materialPixels, classPixels, elevations, seaLevel, width, height, strength) {
    const atlasWidth = 128, atlasHeight = Math.ceil(facets.cells / atlasWidth);
    const sites = new Float32Array(atlasWidth * atlasHeight * 4);
    const normals = new Uint8Array(sites.length), materials = new Uint8Array(sites.length);
    // A coastal face must take its land pigment from a land texel, never from
    // the ice-colored ocean placeholder used by the climate material map.
    const landSamples = new Int32Array(facets.cells); landSamples.fill(-1);
    const landDistances = new Float32Array(facets.cells); landDistances.fill(Infinity);
    for (const layer of facets.layers) {
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (elevations[i] <= seaLevel) continue;
        const px = Math.round(x / width * layer.width) % layer.width;
        const py = Math.round(y / (height - 1) * (layer.height - 1));
        const localId = layer.candidateIds[(py * layer.width + px) * 4];
        const id = localId + layer.atlasOffset;
        const cell = facets.cellData[id], d = direction(x / width, y / (height - 1));
        const distance = 1 - dot(d, cell.center);
        if (distance < landDistances[id]) { landDistances[id] = distance; landSamples[id] = i; }
      }
    }
    for (const cell of facets.cellData) {
      const o = cell.id * 4, u = cell.uv.x, v = cell.uv.y;
      sites[o] = cell.x; sites[o + 1] = cell.y; sites[o + 2] = cell.z; sites[o + 3] = 1;
      const landIndex = landSamples[cell.id];
      for (let c = 0; c < 4; c += 1) {
        materials[o + c] = landIndex >= 0 ? materialPixels[landIndex * 4 + c] :
          Math.round(sample(materialPixels, width, height, u, v, 4, c));
      }
      const sourceNormal = normalize({
        x: sample(normalPixels, width, height, u, v, 4, 0) / 127.5 - 1,
        y: sample(normalPixels, width, height, u, v, 4, 1) / 127.5 - 1,
        z: sample(normalPixels, width, height, u, v, 4, 2) / 127.5 - 1 });
      const mountain = clamp((sample(classPixels, width, height, u, v, 4, 2) +
        sample(classPixels, width, height, u, v, 4, 3)) / 255);
      // All faces follow the real relief. Lowland facets use the broad,
      // amplified mid normal; mountain faces retain the sculpted normal.
      const plainMix = (1 - mountain) * clamp(strength) * .78;
      const normal = normalize({ x: mix(sourceNormal.x, cell.normal.x, plainMix),
        y: mix(sourceNormal.y, cell.normal.y, plainMix), z: mix(sourceNormal.z, cell.normal.z, plainMix) });
      encodeNormal(normals, o, normal);
      normals[o + 3] = Math.round(sample(normalPixels, width, height, u, v, 4, 3));
    }
    return { width: atlasWidth, height: atlasHeight, sites, normals, materials };
  }

  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createCoastStyleNoise(seed) {
    const random = seededRandom(seed), waves = [];
    for (let i = 0; i < 4; i += 1) {
      waves.push({ direction: randomDirection(random), frequency: 5.5 + i * 4.6 + random() * 2.0,
        phase: random() * Math.PI * 2, weight: [.32, .28, .23, .17][i] });
    }
    return direction => {
      let value = .5;
      for (const wave of waves) {
        value += Math.sin((direction.x * wave.direction.x + direction.y * wave.direction.y +
          direction.z * wave.direction.z) * wave.frequency + wave.phase) * wave.weight * .5;
      }
      return clamp(value);
    };
  }

  function createForestPatches(seed, terrain, seaLevel, settings) {
    const random = seededRandom(seed), patches = [];
    const targetCount = settings.patchCount;
    for (let attempt = 0; attempt < targetCount * 24 && patches.length < targetCount; attempt += 1) {
      const direction = randomDirection(random);
      if (Math.abs(direction.y) > settings.maximumLatitude) continue;
      const point = Projection.sphereToTerrain(direction, terrain);
      const elevation = Projection.sampleElevation(point.x, point.y, terrain);
      const moisture = Projection.sampleField(terrain.moisture, point.x, point.y, terrain) / 255;
      // Place seeded forest nuclei only on suitably moist, temperate land.
      // Their soft influence is clipped by local climate again below.
      if (elevation < seaLevel + 5 || moisture < settings.minimumMoisture) continue;
      const radius = settings.patchRadius[0] + random() * (settings.patchRadius[1] - settings.patchRadius[0]);
      patches.push({ ...direction, outerCos: Math.cos(radius * 1.18), innerCos: Math.cos(radius * .62) });
    }
    return patches;
  }

  function forestPatchCoverage(direction, patches) {
    let coverage = 0;
    for (const patch of patches) {
      const alignment = dot(direction, patch);
      const influence = smoothstep(patch.outerCos, patch.innerCos, alignment);
      coverage = Math.max(coverage, influence);
    }
    return coverage;
  }

  function randomDirection(random) {
    const y = random() * 2 - 1, angle = random() * Math.PI * 2;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    return { x: horizontal * Math.cos(angle), y, z: horizontal * Math.sin(angle) };
  }

  function rotateAround(vector, axis, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), axisCross = cross(axis, vector), axisDot = dot(axis, vector);
    return normalize({ x: vector.x * c + axisCross.x * s + axis.x * axisDot * (1 - c),
      y: vector.y * c + axisCross.y * s + axis.y * axisDot * (1 - c),
      z: vector.z * c + axisCross.z * s + axis.z * axisDot * (1 - c) });
  }

  function createVisualChainSegments(seed, width, height, elevation, sea, settings) {
    const random = seededRandom(seed), chainSettings = settings.visualChains;
    const multiplier = chainSettings.minimumMultiplier + Math.floor(random() *
      (chainSettings.maximumMultiplier - chainSettings.minimumMultiplier + 1));
    const chainCount = chainSettings.baseCount * multiplier, segments = [], origins = [];
    const separation = Math.cos(.20);
    const islandChainCount = Math.round(chainCount * clamp(chainSettings.islandChainRatio ?? .18));
    let islandChains = 0;
    for (let chain = 0; chain < chainCount; chain += 1) {
      let start = null, bestIslandStart = null, bestIslandScore = -1;
      for (let attempt = 0; attempt < 128; attempt += 1) {
        const candidate = randomDirection(random);
        if (sampleDirection(elevation, width, height, candidate) <= sea + 2) continue;
        if (origins.some(origin => dot(origin, candidate) > separation)) continue;
        if (chain >= islandChainCount) { start = candidate; break; }
        const frame = tangentFrame(candidate);
        let waterNeighbors = 0;
        for (let k = 0; k < 8; k += 1) {
          const angle = k * Math.PI / 4;
          const tangent = { x: frame.u.x * Math.cos(angle) + frame.v.x * Math.sin(angle),
            y: frame.u.y * Math.cos(angle) + frame.v.y * Math.sin(angle),
            z: frame.u.z * Math.cos(angle) + frame.v.z * Math.sin(angle) };
          if (sampleDirection(elevation, width, height, offset(candidate, tangent, .045)) <= sea + 1)
            waterNeighbors += 1;
        }
        if (waterNeighbors > bestIslandScore) {
          bestIslandScore = waterNeighbors; bestIslandStart = candidate;
        }
        if (waterNeighbors >= 6) { start = candidate; break; }
      }
      if (!start && chain < islandChainCount) start = bestIslandStart;
      // Extremely ocean-heavy planets still get the requested deterministic
      // count; land masking below clips any section that crosses the sea.
      if (!start) start = randomDirection(random);
      else if (chain < islandChainCount && bestIslandScore >= 0) islandChains += 1;
      origins.push(start);

      const segmentCount = Math.round(mix(chainSettings.segmentCount[0], chainSettings.segmentCount[1], random()));
      const segmentLength = mix(chainSettings.segmentLength[0], chainSettings.segmentLength[1], random());
      const widthBase = mix(chainSettings.width[0], chainSettings.width[1], random());
      const randomTangent = randomDirection(random);
      let point = start;
      let tangent = normalize({ x: randomTangent.x - point.x * dot(randomTangent, point),
        y: randomTangent.y - point.y * dot(randomTangent, point),
        z: randomTangent.z - point.z * dot(randomTangent, point) });
      if (Math.hypot(tangent.x, tangent.y, tangent.z) < .01) {
        tangent = normalize(cross(point, Math.abs(point.z) < .9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 }));
      }
      const step = segmentLength;
      for (let part = 0; part < segmentCount; part += 1) {
        tangent = rotateAround(tangent, point, (random() * 2 - 1) * .20);
        const next = normalize({ x: point.x * Math.cos(step) + tangent.x * Math.sin(step),
          y: point.y * Math.cos(step) + tangent.y * Math.sin(step),
          z: point.z * Math.cos(step) + tangent.z * Math.sin(step) });
        const nextTangent = normalize({ x: tangent.x * Math.cos(step) - point.x * Math.sin(step),
          y: tangent.y * Math.cos(step) - point.y * Math.sin(step),
          z: tangent.z * Math.cos(step) - point.z * Math.sin(step) });
        const middle = normalize({ x: point.x + next.x, y: point.y + next.y, z: point.z + next.z });
        const axis = normalize({ x: next.x - point.x, y: next.y - point.y, z: next.z - point.z });
        const side = normalize(cross(middle, axis));
        const segmentWidth = widthBase * mix(.88, 1.12, random());
        segments.push({ middle, axis, side, halfLength: Math.tan(step * .5), width: segmentWidth,
          ridgeOffsets: [(-.34 + random() * .08) * segmentWidth, (-.04 + random() * .08) * segmentWidth,
            (.27 + random() * .10) * segmentWidth] });
        point = next;
        tangent = rotateAround(nextTangent, point, (random() * 2 - 1) * .13);
      }
    }
    return { segments, count: chainCount, multiplier, islandChains };
  }

  function addVisualMountainChains(heights, mountain, ridge, elevation, width, height, sea, seed, settings) {
    const generated = createVisualChainSegments(seed, width, height, elevation, sea, settings);
    const { segments } = generated;
    const liftField = new Float32Array(heights.length);
    let maxLift = 0;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = y * width + x, land = smoothstep(1.5, 9, elevation[i] - sea);
      if (land <= .001) continue;
      const d = direction(x / width, y / (height - 1));
      let belt = 0, crest = 0;
      for (const segment of segments) {
        const hemisphere = dot(d, segment.middle);
        const angularReach = Math.atan(segment.halfLength) + segment.width * 2.7;
        if (hemisphere < Math.cos(angularReach)) continue;
        const denominator = Math.max(.45, hemisphere);
        const along = dot(d, segment.axis) / denominator;
        const across = dot(d, segment.side) / denominator;
        const alongClamped = Math.max(-segment.halfLength, Math.min(segment.halfLength, along));
        const alongDelta = along - alongClamped;
        const influenceRadius = segment.width * 2.7;
        if (Math.abs(across) > influenceRadius || Math.abs(alongDelta) > influenceRadius) continue;
        const width2 = segment.width * segment.width;
        const beltDistance = (across * across + alongDelta * alongDelta) / width2;
        belt = Math.max(belt, Math.exp(-beltDistance * 1.05));

        const ridgeWidth = segment.width * .17;
        for (const ridgeOffset of segment.ridgeOffsets) {
          const ridgeDistance = ((across - ridgeOffset) ** 2 + alongDelta * alongDelta) /
            (ridgeWidth * ridgeWidth);
          crest = Math.max(crest, Math.exp(-ridgeDistance * 1.15));
        }
      }
      if (belt <= .002) continue;
      belt *= land;
      crest *= land;
      // These visual ridges are a seeded illustration layer over the existing
      // height field. Canonical elevation and all gameplay queries stay intact.
      const lift = belt * settings.visualChains.uplift + crest * settings.visualChains.ridgeUplift;
      liftField[i] = lift; maxLift = Math.max(maxLift, lift);
      heights[i] = clamp(heights[i] + lift);
      mountain[i] = Math.max(mountain[i], clamp(belt * .72 + crest * .30));
      ridge[i] = Math.max(ridge[i], crest);
    }
    return { diagnostics: { count: generated.count, multiplier: generated.multiplier,
      islandChains: generated.islandChains }, liftField, maxLift };
  }

  function styleKey(style) {
    const s = style.stylizedTerrain;
    return JSON.stringify(['analytic-facets-v2', s.fieldWidth, s.textureWidth, s.heightLowPass, s.macroLowPass, s.localLowPass, s.classLowPass,
      s.hillQuantile, s.mountainQuantile, s.summitQuantile, s.normalReliefScale, s.residualNormalStrength,
      s.localNormalStrength, s.smallMassifStrength, s.smallMassifNormalStrength, s.highlandMaterialMix,
      s.macroNormalStrength, s.plainNormalStrength, s.rollingNormalStrength, s.hillockNormalStrength,
      s.hillNormalStrength, s.plainFacetScale, s.mountainFacetScale, s.plainFacetStrength, s.plainWashStrength, s.facetMapScale,
      s.visualChains, s.mountainNormalStrength,
      s.facetAngleDegrees, s.facetJitter, s.facetStrength, s.materials, s.forests]);
  }

  function create(terrain, planet, style = root.OrbitPlanetGlobeStyle) {
    const settings = style.stylizedTerrain;
    const key = JSON.stringify([planet.id, planet.seed, planet.temperature, style.relief, style.polarCaps, styleKey(style)]);
    const previous = cache.get(terrain);
    if (previous?.key === key) return previous;
    const start = performance.now();
    const width = settings.fieldWidth, height = Math.round(width / 2), count = width * height;
    const textureWidth = Math.max(settings.textureWidth, Math.round(width * settings.facetMapScale));
    const textureHeight = Math.round(textureWidth / 2);
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

    const visualChainData = addVisualMountainChains(heights, mountain, ridge, elevation,
      width, height, sea, root.OrbitWorld.hashSeed(`${planet.seed}:visual-mountain-chains-v1`), settings);
    const visualChains = visualChainData.diagnostics;

    const mid = lowPass(heights, width, height, settings.heightLowPass);
    const macro = lowPass(mid, width, height, settings.macroLowPass);
    const local = lowPass(heights, width, height, settings.localLowPass);
    const humidity = lowPass(moisture, width, height, settings.macroLowPass);
    const broadMountain = lowPass(mountain, width, height, settings.macroLowPass);
    const broadRuggedness = lowPass(ruggedness, width, height, settings.classLowPass);
    // These structural fields are already resampled from the canonical terrain;
    // avoid redundant per-field blur passes during planet entry.
    const visualRidge = ridge, visualValley = valley;
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
    const facetLookupWidth = Math.max(384, Math.round(width * Math.min(1.25, textureWidth / width)),
      Math.ceil(settings.mountainFacetScale * 16));
    const plainFacets = plainFacetMap(midNormals, width, height, settings.plainFacetScale,
      facetSeed, settings.facetAngleDegrees, settings.facetJitter, Math.min(1.25, textureWidth / width), facetLookupWidth);
    const mountainFacets = plainFacetMap(midNormals, width, height, settings.mountainFacetScale,
      facetSeed ^ 0x3c6ef372, settings.facetAngleDegrees * .78, settings.facetJitter, 1, facetLookupWidth);
    const facetLayers = combineFacetMaps([plainFacets, mountainFacets]);

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
    const climateWash = climate === 'frozen' ? .12 : 1;
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
    // R remains the small-massif diagnostic; G provides smooth, seeded
    // spherical regions for absent, fine, and broad sandy shore sections.
    const smallMassifPixels = new Uint8Array(count * 2);
    const beachStyleNoise = createCoastStyleNoise(root.OrbitWorld.hashSeed(`${planet.seed}:beach-layout-v1`));
    let rollingMean = 0, smallMassifMean = 0;
    for (let i = 0; i < count; i += 1) {
      rollingField[i] = clamp(rollingField[i] / rollingReference);
      rollingMean += rollingField[i];
      // Preserve a soft shoulder around each secondary massif. Normalizing
      // the existing relief never adds new geometry or independent noise.
      smallMassifField[i] = clamp(smoothstep(.12, 1, smallMassifField[i] / smallMassifReference) * settings.smallMassifStrength);
      smallMassifPixels[i * 2] = Math.round(smallMassifField[i] * 255);
      smallMassifMean += smallMassifField[i];
    }
    rollingMean /= count;
    smallMassifMean /= count;

    // Forests are a deterministic material overlay, placed only on moist
    // temperate lowlands and hills. Their spherical patch shapes follow the
    // seed and never alter the canonical elevation or gameplay terrain.
    const forestPatches = climate === 'temperate'
      ? createForestPatches(root.OrbitWorld.hashSeed(`${planet.seed}:forest-patches-v1`), terrain, sea, settings.forests) : [];
    const forestField = new Float32Array(count), forestPixels = new Uint8Array(count);
    let forestArea = 0, forestLandArea = 0;
    if (forestPatches.length) {
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (elevation[i] <= sea) continue;
        const area = Math.max(0, Math.sin(y / (height - 1) * Math.PI));
        forestLandArea += area;
        const d = direction(x / width, y / (height - 1));
        const patch = forestPatchCoverage(d, forestPatches);
        if (patch <= .001) continue;
        const localTemperature = temperature - Math.pow(Math.abs(d.y), 1.45) * 27 - mid[i] * 12;
        const humid = smoothstep(.24, .56, humidity[i]);
        const temperate = smoothstep(-17, 0, localTemperature) *
          (1 - smoothstep(38, 48, localTemperature) * .22);
        const lowlandOrHill = clamp(classWeights[i * 4] + classWeights[i * 4 + 1] * .82 + smallMassifField[i] * .20);
        const highlandFade = 1 - smoothstep(.66, .90, mid[i]);
        const mountainFade = 1 - smoothstep(.16, .72, classWeights[i * 4 + 2] + classWeights[i * 4 + 3]);
        const coverage = clamp(patch * humid * temperate * lowlandOrHill * highlandFade * mountainFade);
        forestField[i] = coverage;
        forestPixels[i] = Math.round(coverage * 255);
        forestArea += coverage * area;
      }
    }
    const forestProportion = forestArea / Math.max(1, forestLandArea);

    // Build visual materials at the field resolution, then upsample once.
    // Evaluating every biome mix and sphere projection at 1024x512 synchronously
    // was stalling the game loop for tens of seconds on mobile CPUs.
    const sourceWidth = width, sourceHeight = height;
    const normalPixels = new Uint8Array(count * 4);
    const realNormalPixels = new Uint8Array(normalPixels.length), materialPixels = new Uint8Array(normalPixels.length);
    const classes = new Float32Array(4), macroNormal = new Float32Array(3), midNormal = new Float32Array(3);
    const mountainNormalField = new Float32Array(3), localNormalField = new Float32Array(3);

    for (let y = 0; y < sourceHeight; y += 1) for (let x = 0; x < sourceWidth; x += 1) {
      const i = y * width + x, u = x / width, v = y / (height - 1), o = i * 4;
      for (let c = 0; c < 4; c += 1) classes[c] = classPixels[i * 4 + c] / 255;
      const d = direction(u, v), frame = tangentFrame(d);
      smallMassifPixels[i * 2 + 1] = Math.round(beachStyleNoise(d) * 255);
      for (let c = 0; c < 3; c += 1) {
        macroNormal[c] = macroNormals[i * 3 + c];
        midNormal[c] = midNormals[i * 3 + c];
        mountainNormalField[c] = mountainNormals[i * 3 + c];
        localNormalField[c] = localNormals[i * 3 + c];
      }
      const real = normalize({ x: midNormal[0], y: midNormal[1], z: midNormal[2] });
      const residualAtPixel = residual[i];
      const localResidualAtPixel = localResidual[i];
      const localRuggedness = broadRuggedness[i];
      const jitter = clamp((residualAtPixel - residual30) / Math.max(.001, residual90 - residual30) - .45, -.5, .5) * .55 +
        clamp(localRuggedness - .5, -.5, .5) * .35;
      // The third band is only composed into the mountain layer. It is a
      // residual of the existing relief, never a full-resolution micro-normal.
      const mountainReal = normalize({
        x: mix(mountainNormalField[0], localNormalField[0], settings.localNormalStrength),
        y: mix(mountainNormalField[1], localNormalField[1], settings.localNormalStrength),
        z: mix(mountainNormalField[2], localNormalField[2], settings.localNormalStrength) });
      const faceted = quantizeTerrainNormal(mountainReal, d, frame, jitter, settings.facetAngleDegrees, settings.facetJitter);
      const rolling = rollingField[i];
      const hillocks = hillockField[i];
      const smallMassif = smallMassifField[i];
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
      const isLandPixel = elevation[i] > sea;
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

      const broadWet = humidity[i];
      const localWet = broadWet;
      const wet = broadWet, heightValue = mid[i];
      const localSlope = slopes[i];
      const crest = visualRidge[i], hollow = visualValley[i];
      const rollingAtPixel = rolling, hillockAtPixel = hillocks;
      const surfaceElevation = elevation[i];
      const isSea = surfaceElevation <= sea;
      const plainCoverage = clamp(classes[0] + classes[1] * .72);
      const residualWash = smoothstep(residual15, Math.max(residual15 + .002, residual82), Math.max(0, residualAtPixel));
      const pigmentWash = clamp(residualWash * .38 + smoothstep(.30, .72, localWet) * .38 +
        rollingAtPixel * .14 + hillockAtPixel * .10);
      const watercolorMix = clamp(settings.plainWashStrength) * climateWash * plainCoverage * (.62 + pigmentWash * .38);
      const facetTone = sample(plainFacets.pixels, plainFacets.width, plainFacets.height, u, v, 4, 3) / 127.5 - 1;
      const elevatedHighland = mountainWeight * smoothstep(.58, .82, heightValue);
      const rockExposure = mountainWeight * smoothstep(.42, .78, heightValue) * smoothstep(.14, .42, localSlope);
      const summitExposure = classes[3] * smoothstep(.72, .90, heightValue);
      const snowBase = smoothstep(.12, .84, snowField[i]);
      // Break up only the continental snow edge, after mask remapping, so
      // its shift stays bounded, with more articulation in the highlands.
      const snowBreakup = clamp((residualAtPixel * 1.9 + localResidualAtPixel * 1.2) *
        (.75 + .35 * clamp(elevatedHighland + summitExposure)), -.085, .085);
      // Keep polar snow and summit snow off the first shallow land cells. They
      // otherwise read as stray white beach patches beside the deliberately
      // randomized sand/rock shoreline. The sea-ice material remains intact.
      const coastalSnowFactor = climate === 'temperate'
        ? smoothstep(1.5, 7, surfaceElevation - sea) : 1;
      const snowValue = clamp(snowBase + (isSea ? 0 : snowBreakup * 4 * snowBase * (1 - snowBase))) *
        (isSea ? 1 : coastalSnowFactor);
      const foothillWeight = clamp(mountainWeight * smoothstep(.20, .62, heightValue) *
        (.36 + .28 * smoothstep(.08, .30, localSlope)) + classes[1] * smoothstep(.28, .68, heightValue) * .12);
      const ridgeMask = mountainWeight * crest * smoothstep(.38, .78, heightValue);
      const valleyExposure = hollow * (classes[1] * .24 + mountainWeight) *
        smoothstep(.15, .50, crest + mountainWeight) * (climate === 'frozen' ? .055 : .12);
      const regionalVariation = clamp(((wet - .5) * .07 +
        (macro[i] - .35) * .025 - rollingAtPixel * .012) * (climate === 'frozen' ? .35 : 1), -.05, .05);
      for (let channel = 0; channel < 3; channel += 1) {
        let plain = mix(materials.plain[channel], materials.wet[channel], smoothstep(.40, .76, wet) * .80);
        plain = mix(plain, materials.dry[channel], (1 - smoothstep(.12, .40, wet)) * .34);
        const washColor = mix(materials.dry[channel], materials.wet[channel], smoothstep(.24, .78, localWet));
        let color;
        if (climate === 'frozen') {
          // Keep ice worlds in a compact blue-white family. Height classes
          // still reveal cold rock and bright summits, while broad terrain
          // stays even and procedural pigment cannot introduce warm patches.
          color = mix(materials.plain[channel], materials.wet[channel], smoothstep(.38, .74, wet) * .22);
          color = mix(color, materials.rolling[channel], rollingAtPixel * .08 + hillockAtPixel * .10);
          color = mix(color, materials.hill[channel], classes[1] * .28);
          color = mix(color, materials.foothill[channel], foothillWeight * .20 + smallMassif * .10);
          color = mix(color, materials.highland[channel], elevatedHighland * .32);
          color = mix(color, materials.mountain[channel], rockExposure * .38);
          color = mix(color, materials.ridge[channel], clamp(summitExposure * .48 + ridgeMask * .16));
          color = mix(color, (materials.summit || materials.ridge)[channel],
            clamp(summitExposure * .54 + ridgeMask * .12));
          color = mix(color, materials.crevice[channel], clamp(valleyExposure));
        } else {
          color = mix(plain, washColor, watercolorMix);
          color = mix(color, materials.rolling[channel], rollingAtPixel * .18 + hillockAtPixel * .26);
          color = mix(color, materials.hill[channel], clamp(classes[1] * .72 + mountainWeight * .62));
          color = mix(color, materials.foothill[channel], clamp(foothillWeight * .45 + smallMassif * .22));
          color = mix(color, materials.highland[channel], elevatedHighland * settings.highlandMaterialMix);
          color = mix(color, materials.mountain[channel], rockExposure * .60);
          color = mix(color, materials.ridge[channel], clamp(summitExposure * .58 + ridgeMask * .24));
          color = mix(color, (materials.summit || materials.ridge)[channel],
            clamp(summitExposure * .74 + ridgeMask * .18));
          color = mix(color, materials.crevice[channel], clamp(valleyExposure));
        }
        // Seeded, soft-edged cell pigment gives each broad plain a small
        // watercolor variation. The cell normal itself remains tied to the
        // filtered height at that cell's spherical center.
        const channelTint = channel === 0 ? .075 : channel === 1 ? .055 : -.055;
        color *= 1 + facetTone * watercolorMix * channelTint;
        // Broad humidity and altitude make small regional color shifts; there
        // is deliberately no fine noise in the albedo.
        color *= 1 + regionalVariation;
        if (climate === 'temperate' && !isSea && forestField[i] > .001) {
          const canopyTone = clamp(.50 + facetTone * .48 + (wet - .5) * .36, .12, .90);
          const forestColor = mix(materials.forest[channel], materials.canopy[channel], canopyTone);
          color = mix(color, forestColor, forestField[i] * settings.forests.colorMix);
        }
        if (isSea && (climate === 'frozen' || climate === 'temperate' && snowField[i] > .02)) {
          color = materials.ice[channel];
        } else if (isSea && climate === 'temperate') {
          // Non-frozen water is drawn by the separate ocean shader. A land
          // pigment fallback prevents thin coastal faces from inheriting the
          // old white ice placeholder when their center lies just offshore.
          color = materials.plain[channel];
        }
        if (isSea && climate === 'arid') color *= .73;
        color = mix(color, isSea ? materials.ice[channel] : materials.snow[channel], snowValue);
        materialPixels[o + channel] = Math.round(clamp(color, 0, 255));
      }
      const polarCoverage = isSea && (climate === 'temperate' || climate === 'frozen') ? snowField[i] : 0;
      materialPixels[o + 3] = Math.round(clamp(Math.max(snowValue, polarCoverage)) * 255);
    }

    const crispFacets = facetAtlas(facetLayers, normalPixels, materialPixels, classPixels,
      elevation, sea, width, height, settings.plainFacetStrength);
    const finalNormalPixels = resizeRgba(normalPixels, sourceWidth, sourceHeight, textureWidth, textureHeight);
    const finalRealNormalPixels = resizeRgba(realNormalPixels, sourceWidth, sourceHeight, textureWidth, textureHeight);
    const finalMaterialPixels = resizeRgba(materialPixels, sourceWidth, sourceHeight, textureWidth, textureHeight);

    const result = Object.freeze({ key, width: textureWidth, height: textureHeight, classWidth: width, classHeight: height,
      plainFacetWidth: plainFacets.width, plainFacetHeight: plainFacets.height,
      facetCandidatesPixels: facetLayers.candidateIds,
      facetCandidateWidth: plainFacets.width, facetCandidateHeight: plainFacets.height,
      mountainFacetCandidateWidth: mountainFacets.width, mountainFacetCandidateHeight: mountainFacets.height,
      facetCandidateTextureWidth: facetLayers.width, facetCandidateTextureHeight: facetLayers.height,
      facetSitePixels: crispFacets.sites, facetAtlasWidth: crispFacets.width, facetAtlasHeight: crispFacets.height,
      facetMaterialPixels: crispFacets.materials, facetNormalPixels: crispFacets.normals,
      terrainVisualClassPixels: classPixels, smallMassifPixels, forestPixels,
      visualMountainLiftPixels: visualChainData.liftField, visualMountainLiftMax: visualChainData.maxLift,
      plainFacetNormalPixels: plainFacets.pixels,
      stylizedNormalPixels: finalNormalPixels, realMountainNormalPixels: finalRealNormalPixels,
      materialPixels: finalMaterialPixels, climate, sand: settings.materials[climate].sand, thresholds,
      proportions: Object.fromEntries(['plain', 'hill', 'mountain', 'summit'].map((name, i) => [name, totals[i] / Math.max(1, landArea)])),
      rollingRelief: { residual82, residual94, mean: rollingMean, reference: rollingReference },
      localRelief: { reference: localReference, strength: settings.localNormalStrength },
      smallMassifs: { reference: smallMassifReference, mean: smallMassifMean, strength: settings.smallMassifStrength },
      forests: { patches: forestPatches.length, landCoverage: forestProportion },
      plainFacets: { cells: plainFacets.cells, scale: settings.plainFacetScale, strength: settings.plainFacetStrength,
        resolution: [plainFacets.width, plainFacets.height] },
      mountainFacets: { cells: mountainFacets.cells, scale: settings.mountainFacetScale,
        densityRatio: mountainFacets.cells / Math.max(1, plainFacets.cells),
        resolution: [mountainFacets.width, mountainFacets.height] },
      visualMountainChains: visualChains,
      generationMs: performance.now() - start });
    cache.set(terrain, result); return result;
  }

  root.OrbitPlanetTerrainVisuals = Object.freeze({ create, styleKey });
})(globalThis);
