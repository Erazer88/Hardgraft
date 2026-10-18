(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = value => Number.isFinite(value) ? value : 0;

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

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

  function surfaceRadius(x, y, terrain, relief = {}) {
    const seaLevel = Number.isFinite(terrain?.seaLevel) ? terrain.seaLevel : 0;
    const elevation = sampleElevation(x, y, terrain);
    const landHeight = clamp((elevation - seaLevel) / Math.max(1, 255 - seaLevel), 0, 1);
    const scale = Number.isFinite(relief.scale) ? relief.scale : .052;
    const exponent = Number.isFinite(relief.exponent) ? relief.exponent : 1.6;
    const mountain = smoothstep(.18, .82, landHeight);
    return 1 + scale * Math.pow(mountain, exponent);
  }

  function surfacePosition(x, y, terrain, relief) {
    const normal = terrainToSphere(x, y, terrain), radius = surfaceRadius(x, y, terrain, relief);
    return { x: normal.x * radius, y: normal.y * radius, z: normal.z * radius };
  }

  function poleSurfacePosition(terrain, north, relief = {}) {
    const row = north ? 0 : terrain.height - 1;
    const elevation = sampleElevation((terrain.width - 1) / 2, row, terrain);
    const landHeight = clamp((elevation - terrain.seaLevel) / Math.max(1, 255 - terrain.seaLevel), 0, 1);
    const scale = Number.isFinite(relief.scale) ? relief.scale : .052;
    const exponent = Number.isFinite(relief.exponent) ? relief.exponent : 1.6;
    const mountain = smoothstep(.18, .82, landHeight);
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
    const maxRadius = 1 + (Number.isFinite(relief?.scale) ? relief.scale : .052) + .002;
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
