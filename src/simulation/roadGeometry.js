(function (root) {
  'use strict';

  const Config = root.OrbitRoadConfig, Buildings = root.OrbitBuildingData, EPSILON = 1e-8;
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  function pointSegmentDistanceSquared(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
    const x = a.x + dx * t, y = a.y + dy * t;
    return (point.x - x) ** 2 + (point.y - y) ** 2;
  }

  function simplify(points, tolerance) {
    if (points.length <= 2) return points.map(point => ({ ...point }));
    const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]], threshold = tolerance * tolerance;
    while (stack.length) {
      const [first, last] = stack.pop();
      let bestDistance = threshold, bestIndex = -1;
      for (let i = first + 1; i < last; i++) {
        const current = pointSegmentDistanceSquared(points[i], points[first], points[last]);
        if (current > bestDistance) { bestDistance = current; bestIndex = i; }
      }
      if (bestIndex >= 0) {
        keep[bestIndex] = 1;
        stack.push([first, bestIndex], [bestIndex, last]);
      }
    }
    return points.filter((_, index) => keep[index]).map(point => ({ ...point }));
  }

  function blend(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  function mix(a, b, ta, tb, t) {
    const span = Math.max(EPSILON, tb - ta);
    return { x: a.x * (tb - t) / span + b.x * (t - ta) / span,
      y: a.y * (tb - t) / span + b.y * (t - ta) / span };
  }

  function catmullRom(points, samplesPerSpan, alpha, strength) {
    if (points.length < 2) return points.map(point => ({ ...point }));
    const output = [{ ...points[0] }];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)], p1 = points[i];
      const p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
      const t0 = 0;
      const t1 = t0 + Math.max(EPSILON, distance(p0, p1)) ** alpha;
      const t2 = t1 + Math.max(EPSILON, distance(p1, p2)) ** alpha;
      const t3 = t2 + Math.max(EPSILON, distance(p2, p3)) ** alpha;
      for (let sample = 1; sample <= samplesPerSpan; sample++) {
        const u = sample / samplesPerSpan, t = t1 + u * (t2 - t1);
        const a1 = mix(p0, p1, t0, t1, t), a2 = mix(p1, p2, t1, t2, t), a3 = mix(p2, p3, t2, t3, t);
        const b1 = mix(a1, a2, t0, t2, t), b2 = mix(a2, a3, t1, t3, t);
        const curve = mix(b1, b2, t1, t2, t), straight = blend(p1, p2, u);
        output.push({ x: straight.x + (curve.x - straight.x) * strength,
          y: straight.y + (curve.y - straight.y) * strength });
      }
    }
    output[0] = { ...points[0] }; output[output.length - 1] = { ...points[points.length - 1] };
    return output;
  }

  function resample(points, spacing) {
    if (points.length < 2) return points.map(point => ({ ...point }));
    const output = [{ ...points[0] }];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = distance(a, b);
      const steps = Math.max(1, Math.ceil(length / spacing));
      for (let step = 1; step <= steps; step++) output.push(blend(a, b, step / steps));
    }
    return output;
  }

  function followsPath(points, path, maxDeviation) {
    const limitSquared = maxDeviation * maxDeviation, bucketSize = Math.max(maxDeviation, EPSILON), buckets = new Map();
    const bucketKey = (x, y) => `${x},${y}`;
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1], b = path[index];
      const left = Math.floor((Math.min(a.x, b.x) - maxDeviation) / bucketSize);
      const right = Math.floor((Math.max(a.x, b.x) + maxDeviation) / bucketSize);
      const top = Math.floor((Math.min(a.y, b.y) - maxDeviation) / bucketSize);
      const bottom = Math.floor((Math.max(a.y, b.y) + maxDeviation) / bucketSize);
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const key = bucketKey(x, y), candidates = buckets.get(key) || [];
        candidates.push(index - 1); buckets.set(key, candidates);
      }
    }
    for (const point of points) {
      const candidates = buckets.get(bucketKey(Math.floor(point.x / bucketSize), Math.floor(point.y / bucketSize))) || [];
      if (!candidates.some(index => pointSegmentDistanceSquared(point, path[index], path[index + 1]) <= limitSquared)) return false;
    }
    return true;
  }

  function elevationAt(terrain, textureScale, xWorld, yWorld) {
    const x = xWorld / textureScale, y = yWorld / textureScale;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(terrain.width - 1, x0 + 1), y1 = Math.min(terrain.height - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const a = terrain.elevation[y0 * terrain.width + x0], b = terrain.elevation[y0 * terrain.width + x1];
    const c = terrain.elevation[y1 * terrain.width + x0], d = terrain.elevation[y1 * terrain.width + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }

  function surfaceTypes(points, terrain, textureScale) {
    return points.slice(1).map((point, index) => {
      const previous = points[index], midpoint = { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2 };
      return elevationAt(terrain, textureScale, midpoint.x, midpoint.y) <= terrain.seaLevel;
    });
  }

  function valid(points, terrain, textureScale, buildings = [], options = {}) {
    const rules = Config.obstacles, maxX = (terrain.width - 1) * textureScale, maxY = (terrain.height - 1) * textureScale;
    let previous = null, previousHeight = 0, previousWater = false;
    for (const point of points) {
      if (point.x < 0 || point.y < 0 || point.x > maxX || point.y > maxY) return false;
      const height = elevationAt(terrain, textureScale, point.x, point.y);
      const water = height <= terrain.seaLevel;
      if (!options.allowDeepWater && height < terrain.seaLevel - rules.maxWaterDepth) return false;
      for (const building of buildings) {
        const footprint = Buildings.get(building.type)?.footprint;
        if (!footprint) continue;
        const rotation = building.rotation || 0, cos = Math.cos(rotation), sin = Math.sin(rotation);
        const dx = point.x - building.x, dy = point.y - building.y;
        const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
        if (Math.abs(localX) < footprint.width / 2 - .1 && Math.abs(localY) < footprint.height / 2 - .1) return false;
      }
      if (previous) {
        const horizontalCells = Math.max(EPSILON, distance(previous, point) / textureScale);
        if (!(water && previousWater) && Math.abs(height - previousHeight) / horizontalCells > Config.weights.maxSlopePerHeightCell) return false;
      }
      previous = point; previousHeight = height; previousWater = water;
    }
    return true;
  }

  function create(rawPath, terrain, textureScale, buildings = [], options = {}) {
    if (!Array.isArray(rawPath) || rawPath.length < 2) return null;
    const geometry = Config.geometry;
    for (let attempt = 0; attempt <= geometry.validationRetries; attempt++) {
      const tolerance = geometry.rdpTolerance / (2 ** attempt);
      const strength = geometry.splineStrength * Math.max(.25, 1 - attempt * .23);
      const simplified = simplify(rawPath, tolerance);
      const curve = catmullRom(simplified, geometry.splineSamplesPerSpan, geometry.centripetalAlpha, strength);
      const points = resample(curve, geometry.validationSpacing);
      if (followsPath(points, rawPath, geometry.maxSplineDeviation) && valid(points, terrain, textureScale, buildings, options)) {
        return { points, surfaceTypes: surfaceTypes(points, terrain, textureScale), simplifiedPointCount: simplified.length };
      }
    }
    return null;
  }

  root.OrbitRoadGeometry = Object.freeze({ simplify, catmullRom, resample, followsPath, elevationAt, surfaceTypes, valid, create });
})(globalThis);
