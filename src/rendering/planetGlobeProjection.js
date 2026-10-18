(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = value => Number.isFinite(value) ? value : 0;
  const edgeAverageCache = new WeakMap();
  const polarCapCache = new WeakMap();

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function terrainToSphere(x, y, terrain) {
    const u = clamp(finite(x) / Math.max(1, terrain.width - 1), 0, 1);
    const v = clamp(finite(y) / Math.max(1, terrain.height - 1), 0, 1);
    const longitude = (u - .5) * TAU;
    const latitude = (.5 - v) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    return { x: cosLatitude * Math.cos(longitude), y: Math.sin(latitude),
      z: cosLatitude * Math.sin(longitude) };
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

  function edgeAverages(values, terrain) {
    let fields = edgeAverageCache.get(terrain);
    if (!fields) { fields = new WeakMap(); edgeAverageCache.set(terrain, fields); }
    let averages = fields.get(values);
    if (!averages) {
      averages = new Float32Array(terrain.height);
      for (let y = 0; y < terrain.height; y += 1) {
        const offset = y * terrain.width;
        averages[y] = (values[offset] + values[offset + terrain.width - 1]) * .5;
      }
      fields.set(values, averages);
    }
    return averages;
  }

  function polarCapAverage(values, terrain, north) {
    let fields = polarCapCache.get(terrain);
    if (!fields) { fields = new WeakMap(); polarCapCache.set(terrain, fields); }
    let caps = fields.get(values);
    if (!caps) { caps = Float64Array.from([NaN, NaN]); fields.set(values, caps); }
    const key = north ? 0 : 1;
    if (Number.isFinite(caps[key])) return caps[key];
    const capRows = Math.max(0, Math.min(terrain.height - 2,
      Math.ceil((terrain.height - 1) * 12 / 180)));
    const start = north ? 0 : terrain.height - 1 - capRows;
    const end = north ? capRows : terrain.height - 1;
    let sum = 0, count = 0;
    for (let y = start; y <= end; y += 1) {
      const latitude = (.5 - y / Math.max(1, terrain.height - 1)) * Math.PI;
      const weight = Math.max(.02, Math.cos(latitude));
      const offset = y * terrain.width;
      for (let x = 0; x < terrain.width; x += 1) { sum += values[offset + x] * weight; count += weight; }
    }
    caps[key] = sum / (count || 1);
    return caps[key];
  }

  function sampleField(values, x, y, terrain) {
    if (!values?.length || !terrain?.width || !terrain.height) return 0;
    const px = clamp(finite(x), 0, terrain.width - 1), py = clamp(finite(y), 0, terrain.height - 1);
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const x1 = Math.min(terrain.width - 1, x0 + 1), y1 = Math.min(terrain.height - 1, y0 + 1);
    const tx = px - x0, ty = py - y0, width = terrain.width;
    const a = values[y0 * width + x0] * (1 - tx) + values[y0 * width + x1] * tx;
    const b = values[y1 * width + x0] * (1 - tx) + values[y1 * width + x1] * tx;
    let sample = a * (1 - ty) + b * ty;

    // The map's left and right edges share a longitude on the sphere. Blend
    // both edges together in a narrow visual seam without changing map data.
    const edgeFraction = Math.min(px, terrain.width - 1 - px) / Math.max(1, terrain.width - 1);
    const seamBlend = 1 - smoothstep(0, .035, edgeFraction);
    if (seamBlend > 0) {
      const edges = edgeAverages(values, terrain);
      const seamMean = edges[y0] * (1 - ty) + edges[y1] * ty;
      sample += (seamMean - sample) * seamBlend;
    }

    // The current procedural map is rectangular, so its polar rows contain
    // unrelated longitudes even though they collapse to one point on a globe.
    // Blend those rows toward their latitude mean near each pole. This is a
    // display-only projection correction; saved terrain and gameplay x/y stay intact.
    const signedLatitude = (.5 - py / Math.max(1, terrain.height - 1)) * Math.PI;
    const latitude = Math.abs(signedLatitude);
    const polarBlend = smoothstep(68 * Math.PI / 180, 84 * Math.PI / 180, latitude);
    if (polarBlend <= 0) return sample;
    const mean = polarCapAverage(values, terrain, signedLatitude >= 0);
    return sample + (mean - sample) * polarBlend;
  }

  function sampleElevation(x, y, terrain) {
    return sampleField(terrain?.elevation, x, y, terrain);
  }

  function surfaceRadius(x, y, terrain, relief = {}) {
    const seaLevel = Number.isFinite(terrain?.seaLevel) ? terrain.seaLevel : 0;
    const elevation = sampleElevation(x, y, terrain);
    const landHeight = Math.max(0, elevation - seaLevel) / Math.max(1, 255 - seaLevel);
    if (landHeight <= 0) return 1;
    const scale = Number.isFinite(relief.scale) ? relief.scale : .026;
    const exponent = Number.isFinite(relief.exponent) ? relief.exponent : 1.85;
    const mountain = smoothstep(.12, .92, landHeight);
    return 1 + scale * Math.pow(mountain, exponent);
  }

  function surfacePosition(x, y, terrain, relief) {
    const normal = terrainToSphere(x, y, terrain), radius = surfaceRadius(x, y, terrain, relief);
    return { x: normal.x * radius, y: normal.y * radius, z: normal.z * radius };
  }

  function poleSurfacePosition(terrain, north, relief = {}) {
    const row = north ? 0 : terrain.height - 1;
    const elevation = polarCapAverage(terrain.elevation, terrain, north);
    const landHeight = Math.max(0, elevation - terrain.seaLevel) / Math.max(1, 255 - terrain.seaLevel);
    const scale = Number.isFinite(relief.scale) ? relief.scale : .026;
    const exponent = Number.isFinite(relief.exponent) ? relief.exponent : 1.85;
    const mountain = smoothstep(.12, .92, landHeight);
    const radius = 1 + scale * Math.pow(mountain, exponent);
    const normal = terrainToSphere((terrain.width - 1) / 2, row, terrain);
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
    const maxRadius = 1 + (Number.isFinite(relief?.scale) ? relief.scale : .026) + .002;
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
    const steps = 36;
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
    sampleField, sampleElevation, surfaceRadius, surfacePosition, poleSurfacePosition, projectSurfacePoint,
    isSurfacePointVisible, raycastTerrain, rotateToCamera });
})(globalThis);
