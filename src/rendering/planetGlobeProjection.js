(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = value => Number.isFinite(value) ? value : 0;
  const smoothstep = (edge0, edge1, value) => {
    const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const reliefRangeCache = new WeakMap();

  function terrainToSphere(x, y, terrain) {
    return root.OrbitWorld.directionForPixel(finite(x), finite(y), terrain.width, terrain.height);
  }

  function sphereToTerrain(direction, terrain) {
    const length = Math.hypot(direction?.x || 0, direction?.y || 0, direction?.z || 0) || 1;
    const x = (direction?.x || 0) / length, y = clamp((direction?.y || 0) / length, -1, 1);
    const z = (direction?.z || 0) / length;
    const longitude = Math.atan2(z, x);
    const latitude = Math.atan2(y, Math.hypot(x, z));
    const u = clamp(longitude / TAU + .5, 0, 1);
    const v = clamp(.5 - latitude / Math.PI, 0, 1);
    return { x: u * (terrain.width - 1), y: v * (terrain.height - 1) };
  }

  function sampleField(values, x, y, terrain) {
    if (!values?.length || !terrain?.width || !terrain.height) return 0;
    const px = clamp(finite(x), 0, terrain.width - 1), py = clamp(finite(y), 0, terrain.height - 1);
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const x1 = Math.min(terrain.width - 1, x0 + 1), y1 = Math.min(terrain.height - 1, y0 + 1);
    const tx = px - x0, ty = py - y0, width = terrain.width;
    const a = values[y0 * width + x0] * (1 - tx) + values[y0 * width + x1] * tx;
    const b = values[y1 * width + x0] * (1 - tx) + values[y1 * width + x1] * tx;
    return a * (1 - ty) + b * ty;
  }

  function sampleElevation(x, y, terrain) {
    return sampleField(terrain?.elevation, x, y, terrain);
  }

  function visualReliefRange(terrain, relief = {}) {
    const seaLevel = Number.isFinite(terrain?.seaLevel) ? terrain.seaLevel : 0;
    const quantile = Number.isFinite(relief.landQuantile) ? clamp(relief.landQuantile, 0, 1) : .98;
    const minRange = Number.isFinite(relief.minLandRange) ? Math.max(1, relief.minLandRange) : 28;
    const maxRange = Number.isFinite(relief.maxLandRange) ? Math.max(minRange, relief.maxLandRange) : 70;
    const values = terrain?.elevation;
    if (!terrain || typeof terrain !== 'object' || !values?.length) {
      return { low: seaLevel, high: seaLevel + minRange, peak: seaLevel + minRange,
        peakTailStart: Number.isFinite(relief.peakTailStart) ? clamp(relief.peakTailStart, .05, .95) : .70 };
    }

    let cached = reliefRangeCache.get(terrain);
    if (!cached || cached.values !== values || cached.seaLevel !== seaLevel) {
      // Equirectangular rows have unequal surface area. Weight each latitude
      // by cos(latitude), matching the spherical area convention in worldgen.
      const histogram = new Float64Array(256);
      let landArea = 0, landPeak = seaLevel;
      const width = Math.max(1, Math.floor(terrain.width || values.length));
      const height = Math.max(1, Math.floor(terrain.height || Math.ceil(values.length / width)));
      for (let y = 0; y < height; y += 1) {
        const latitude = (.5 - y / Math.max(1, height - 1)) * Math.PI;
        const areaWeight = Math.max(0, Math.cos(latitude));
        const rowStart = y * width;
        const rowEnd = Math.min(values.length, rowStart + width);
        for (let i = rowStart; i < rowEnd; i += 1) {
          const elevation = finite(values[i]);
          if (elevation <= seaLevel) continue;
          landPeak = Math.max(landPeak, elevation);
          histogram[clamp(Math.floor(elevation), 0, 255)] += areaWeight;
          landArea += areaWeight;
        }
      }
      cached = { values, seaLevel, histogram, landArea, landPeak, ranges: new Map() };
      reliefRangeCache.set(terrain, cached);
    }

    const peakTailStart = Number.isFinite(relief.peakTailStart) ? clamp(relief.peakTailStart, .05, .95) : .70;
    const cacheKey = `${quantile}:${minRange}:${maxRange}:${peakTailStart}`;
    if (cached.ranges.has(cacheKey)) return cached.ranges.get(cacheKey);
    const target = Math.max(Number.EPSILON, cached.landArea * quantile);
    let count = 0, landHigh = seaLevel;
    for (let elevation = 0; elevation < cached.histogram.length; elevation += 1) {
      count += cached.histogram[elevation];
      if (count >= target) { landHigh = elevation; break; }
    }
    const high = clamp(landHigh, seaLevel + minRange, seaLevel + maxRange);
    const range = Object.freeze({ low: seaLevel, high, peak: Math.max(high, cached.landPeak), peakTailStart });
    cached.ranges.set(cacheKey, range);
    return range;
  }

  function normalizeVisualHeight(elevation, range) {
    const span = Math.max(1, range.high - range.low);
    const raw = Math.max(0, (finite(elevation) - range.low) / span);
    const start = Number.isFinite(range.peakTailStart) ? clamp(range.peakTailStart, .05, .95) : .70;
    const peak = Number.isFinite(range.peak) ? range.peak : range.high;
    const budget = 1 - start;
    const peakSpan = Math.max(1, (peak - range.low) / span) - start;
    const compression = Math.max(0, (peakSpan - budget) / (peakSpan * budget));
    const tail = Math.max(0, raw - start);
    // The quantile is a calibration point, never a flat summit ceiling.
    // This C1 tail has positive slope all the way to the actual highest peak.
    return clamp(raw <= start ? raw : start + tail / (1 + compression * tail), 0, 1);
  }

  function visualHeight(elevation, terrain, relief = {}) {
    return normalizeVisualHeight(elevation, visualReliefRange(terrain, relief));
  }

  function shapeReliefHeight(height, relief = {}) {
    const normalized = clamp(finite(height), 0, 1);
    const linearFraction = Number.isFinite(relief.linearFraction) ? clamp(relief.linearFraction, 0, 1) : .25;
    const exponent = Number.isFinite(relief.exponent) ? Math.max(.01, relief.exponent) : 1.10;
    const compressionStart = Number.isFinite(relief.compressionStart) ?
      clamp(relief.compressionStart, 0, .99) : .24;
    const mountainCurve = clamp((normalized - compressionStart) / (1 - compressionStart), 0, 1);
    // Rounded shoulders, but a non-zero slope at the tip. Smoothstep flattens
    // the very relief differences that should form pointed crests.
    const pointedMountainCurve = mountainCurve * mountainCurve * (2 - mountainCurve);
    return linearFraction * normalized + (1 - linearFraction) * Math.pow(pointedMountainCurve, exponent);
  }

  function mountainReliefHeight(elevation, mountainMask, ridgeField, terrain, relief = {}) {
    const height = visualHeight(elevation, terrain, relief);
    const mountain = clamp(finite(mountainMask) / 255, 0, 1);
    const ridge = clamp(finite(ridgeField) / 255, 0, 1);
    // Lift broad massifs, then concentrate the extra height on actual ridges so
    // the skyline resolves into peaks instead of flat-topped mountain blobs.
    const mountainSupport = Math.pow(mountain, 1.35) * smoothstep(.18, .60, height);
    const peakSupport = Math.pow(ridge, 2.35) * smoothstep(.52, .84, height);
    const mountainBoost = Number.isFinite(relief.mountainBoost) ? Math.max(0, relief.mountainBoost) : 1;
    const peakBoost = Number.isFinite(relief.peakBoost) ? Math.max(0, relief.peakBoost) : 1.35;
    return shapeReliefHeight(height, relief) + mountainSupport * mountainBoost + peakSupport * peakBoost;
  }

  function sampleMountainReliefHeight(x, y, terrain, relief = {}) {
    const elevation = sampleElevation(x, y, terrain);
    const mountainMask = sampleField(terrain?.mountainMask, x, y, terrain);
    const ridgeField = sampleField(terrain?.ridgeField, x, y, terrain);
    return mountainReliefHeight(elevation, mountainMask, ridgeField, terrain, relief);
  }

  function maximumSurfaceRadius(relief = {}) {
    const scale = Number.isFinite(relief.scale) ? Math.max(0, relief.scale) : .045;
    const mountainBoost = Number.isFinite(relief.mountainBoost) ? Math.max(0, relief.mountainBoost) : 1;
    const peakBoost = Number.isFinite(relief.peakBoost) ? Math.max(0, relief.peakBoost) : 1.35;
    return 1 + scale * (1 + mountainBoost + peakBoost);
  }

  function surfaceRadius(x, y, terrain, relief = {}) {
    const scale = Number.isFinite(relief.scale) ? relief.scale : .045;
    return 1 + scale * sampleMountainReliefHeight(x, y, terrain, relief);
  }

  function surfacePosition(x, y, terrain, relief) {
    const normal = terrainToSphere(x, y, terrain), radius = surfaceRadius(x, y, terrain, relief);
    return { x: normal.x * radius, y: normal.y * radius, z: normal.z * radius };
  }

  function poleSurfacePosition(terrain, north, relief = {}) {
    const row = north ? 0 : terrain.height - 1;
    const x = (terrain.width - 1) / 2;
    const scale = Number.isFinite(relief.scale) ? relief.scale : .045;
    const radius = 1 + scale * sampleMountainReliefHeight(x, row, terrain, relief);
    const normal = terrainToSphere(x, row, terrain);
    return { x: normal.x * radius, y: normal.y * radius, z: normal.z * radius };
  }

  function rotateToCamera(point, view) {
    const yaw = view.yaw || 0, pitch = view.pitch || 0;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
    const x = cy * point.x + sy * point.z;
    const z = -sy * point.x + cy * point.z;
    return { x, y: cx * point.y - sx * z, z: sx * point.y + cx * z };
  }

  function isSurfacePointVisible(x, y, terrain, view, relief) {
    return rotateToCamera(surfacePosition(x, y, terrain, relief), view).z > .004;
  }

  function projectSurfacePoint(x, y, terrain, view, relief) {
    const rotated = rotateToCamera(surfacePosition(x, y, terrain, relief), view);
    const radiusPx = Number.isFinite(view.radiusPx) ? view.radiusPx :
      Math.min(view.width, view.height) * .4 * (view.zoom || 1);
    const centerX = Number.isFinite(view.centerX) ? view.centerX : view.width / 2;
    const centerY = Number.isFinite(view.centerY) ? view.centerY : view.height / 2;
    return { x: centerX + rotated.x * radiusPx, y: centerY - rotated.y * radiusPx,
      depth: rotated.z, visible: rotated.z > .004 };
  }

  function inverseRotate(point, view) {
    const yaw = view.yaw || 0, pitch = view.pitch || 0;
    const cx = Math.cos(-pitch), sx = Math.sin(-pitch);
    const y = cx * point.y - sx * point.z, z = sx * point.y + cx * point.z;
    const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
    return { x: cy * point.x + sy * z, y, z: -sy * point.x + cy * z };
  }

  function raycastTerrain(screenX, screenY, terrain, view, relief) {
    const radiusPx = Number.isFinite(view.radiusPx) ? view.radiusPx :
      Math.min(view.width, view.height) * .4 * (view.zoom || 1);
    if (!(radiusPx > 0)) return null;
    const centerX = Number.isFinite(view.centerX) ? view.centerX : view.width / 2;
    const centerY = Number.isFinite(view.centerY) ? view.centerY : view.height / 2;
    const rayX = (screenX - centerX) / radiusPx, rayY = (centerY - screenY) / radiusPx;
    const maxRadius = maximumSurfaceRadius(relief) + .002;
    const perpendicular = rayX * rayX + rayY * rayY;
    if (perpendicular > maxRadius * maxRadius) return null;

    const origin = inverseRotate({ x: rayX, y: rayY, z: 4 }, view);
    const direction = inverseRotate({ x: 0, y: 0, z: -1 }, view);
    const b = origin.x * direction.x + origin.y * direction.y + origin.z * direction.z;
    const c = origin.x * origin.x + origin.y * origin.y + origin.z * origin.z - maxRadius * maxRadius;
    const discriminant = b * b - c;
    if (discriminant < 0) return null;
    const rootDepth = Math.sqrt(discriminant);
    const entry = -b - rootDepth, exit = -b + rootDepth;
    const valueAt = depth => {
      const point = { x: origin.x + direction.x * depth,
        y: origin.y + direction.y * depth, z: origin.z + direction.z * depth };
      const length = Math.hypot(point.x, point.y, point.z);
      const map = sphereToTerrain(point, terrain);
      return { value: length - surfaceRadius(map.x, map.y, terrain, relief), map, point };
    };

    let previousDepth = Math.max(0, entry - .002), previous = valueAt(previousDepth);
    // Narrower, taller peaks need a denser bracket before bisection so taps and
    // building placement still intersect the same silhouette as the mesh.
    const steps = 72;
    for (let i = 1; i <= steps; i += 1) {
      const depth = entry + (exit - entry) * i / steps;
      const current = valueAt(depth);
      if (previous.value >= 0 && current.value <= 0) {
        let low = previousDepth, high = depth, hit = current;
        for (let iteration = 0; iteration < 12; iteration += 1) {
          const middle = (low + high) / 2, sample = valueAt(middle);
          if (sample.value > 0) low = middle;
          else { high = middle; hit = sample; }
        }
        return { ...hit.map, direction: terrainToSphere(hit.map.x, hit.map.y, terrain),
          point: hit.point, radius: surfaceRadius(hit.map.x, hit.map.y, terrain, relief) };
      }
      previousDepth = depth; previous = current;
    }
    return null;
  }

  root.OrbitPlanetGlobeProjection = Object.freeze({ terrainToSphere, sphereToTerrain,
    shaderVisualHeight: `float normalizeVisualHeight(float elevation, float low, float high,
      float peak, float start) {
      float span = max(1.0, high - low);
      float raw = max(0.0, (elevation - low) / span);
      float budget = 1.0 - start;
      float peakSpan = max(1.0, (peak - low) / span) - start;
      float compression = max(0.0, (peakSpan - budget) / (peakSpan * budget));
      float tail = max(0.0, raw - start);
      return clamp(raw <= start ? raw : start + tail / (1.0 + compression * tail), 0.0, 1.0);
    }`,
    // The shader uses the same inverse projection for spherical shadow samples.
    shaderSphereUv: `vec2 globeDirectionUv(vec3 d) {
      d = normalize(d);
      return vec2(atan(d.z, d.x) / 6.28318530718 + 0.5,
        0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.14159265359);
    }`,
    sampleField, sampleElevation, visualReliefRange, normalizeVisualHeight, visualHeight, shapeReliefHeight,
    mountainReliefHeight, maximumSurfaceRadius, surfaceRadius, surfacePosition, poleSurfacePosition, projectSurfacePoint,
    isSurfacePointVisible, raycastTerrain, rotateToCamera });
})(globalThis);
