(function (root) {
  'use strict';

  const Config = root.OrbitRoadConfig, Buildings = root.OrbitBuildingData;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function createBase(terrain, textureScale) {
    const step = Config.gridStep;
    const width = Math.floor((terrain.width - 1) / step) + 1;
    const height = Math.floor((terrain.height - 1) / step) + 1;
    // Longitude is periodic. When the last grid column lands exactly on the
    // duplicated equirectangular seam, omit it from pathfinding.
    const wrapColumns = (terrain.width - 1) % step === 0 ? Math.max(1, width - 1) : width;
    const wrapWorldWidth = (terrain.width - 1) * textureScale;
    const count = width * height, costs = new Float32Array(count), blocked = new Uint8Array(count);
    const elevations = new Uint8Array(count), water = new Uint8Array(count), seaLevel = terrain.seaLevel;
    const wrapCellX = x => ((x % wrapColumns) + wrapColumns) % wrapColumns;
    const valueAt = (x, y) => elevations[clamp(y, 0, height - 1) * width + wrapCellX(x)];
    const weights = Config.weights, radius = weights.valleyRadiusCells;

    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sourceX = Math.min(terrain.width - 1, x * step), sourceY = Math.min(terrain.height - 1, y * step);
      elevations[y * width + x] = terrain.elevation[sourceY * terrain.width + sourceX];
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x, elevation = elevations[index], depth = seaLevel - elevation;
      water[index] = depth >= 0 ? 1 : 0;
      if (depth > Config.obstacles.maxWaterDepth) { blocked[index] = 1; costs[index] = Infinity; continue; }
      let localTotal = 0, localCount = 0;
      for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
        localTotal += valueAt(x + ox, y + oy); localCount++;
      }
      const localAverage = localTotal / localCount;
      const dx = (valueAt(x + 1, y) - valueAt(x - 1, y)) / (2 * step);
      const dy = (valueAt(x, y + 1) - valueAt(x, y - 1)) / (2 * step);
      const roughness = Math.hypot(dx, dy);
      const valley = clamp((localAverage - elevation) / weights.valleyScale, 0, 1);
      let cost = weights.landBase + Math.max(0, elevation - seaLevel) * weights.highlandPerElevation +
        roughness * weights.terrainRoughness - valley * weights.valleyDiscount;
      // A shallow-water cell is the deck of a bridge, not rough terrain. Do
      // not multiply its shoreline gradient/noise into the crossing cost.
      if (depth >= 0) cost = weights.landBase * weights.shallowWaterMultiplier +
        clamp(depth / Math.max(1, Config.obstacles.maxWaterDepth), 0, 1) * .25;
      costs[index] = Math.max(weights.roadReuse, cost);
    }
    let minimumCost = Infinity;
    for (let index = 0; index < count; index++) if (!blocked[index]) minimumCost = Math.min(minimumCost, costs[index]);
    return { width, height, count, step, textureScale, cellWorld: step * textureScale,
      terrainWidth: terrain.width, terrainHeight: terrain.height, seaLevel,
      wrapX: true, wrapColumns, wrapWorldWidth, minimumCost,
      costs, blocked, elevations, water };
  }

  function createMarine(base) {
    const costs = new Float32Array(base.costs), blocked = new Uint8Array(base.blocked);
    for (let index = 0; index < base.count; index++) {
      blocked[index] = base.water[index] ? 0 : 1;
      costs[index] = base.water[index] ? Config.marine.waterCost : Infinity;
    }
    return { ...base, costs, blocked, minimumCost: Config.marine.waterCost, marine: true };
  }

  function pointToCell(field, point) {
    let worldX = point.x;
    if (field.wrapX && field.wrapWorldWidth > 0) {
      worldX = ((worldX % field.wrapWorldWidth) + field.wrapWorldWidth) % field.wrapWorldWidth;
    }
    let x = Math.round(worldX / field.cellWorld);
    if (field.wrapX) x = Math.min(field.wrapColumns - 1, x);
    return {
      x: field.wrapX ? x : clamp(x, 0, field.width - 1),
      y: clamp(Math.round(point.y / field.cellWorld), 0, field.height - 1)
    };
  }

  function cellIndex(field, point) {
    const cell = pointToCell(field, point);
    return { ...cell, index: cell.y * field.width + cell.x };
  }

  function withNetwork(base, network, buildings = [], endpoints = [], skipSegmentId = null, options = {}) {
    const costs = new Float32Array(base.costs), blocked = new Uint8Array(base.blocked);
    if (options.allowDeepWater) for (let index = 0; index < base.count; index++) {
      if (!base.water[index]) continue;
      blocked[index] = 0; costs[index] = Config.weights.marineWaterMultiplier;
    }
    const influence = Config.weights.roadInfluenceCells, roadCost = Config.weights.roadReuse;
    const nearCost = Config.weights.nearRoad;
    function markRoad(point) {
      const cell = pointToCell(base, point);
      for (let oy = -influence; oy <= influence; oy++) for (let ox = -influence; ox <= influence; ox++) {
        const rawX = cell.x + ox, y = cell.y + oy;
        if (y < 0 || y >= base.height || !base.wrapX && (rawX < 0 || rawX >= base.width)) continue;
        const x = base.wrapX ? ((rawX % base.wrapColumns) + base.wrapColumns) % base.wrapColumns : rawX;
        const index = y * base.width + x;
        if (blocked[index]) continue;
        const distance = Math.hypot(ox, oy);
        if (options.avoidExistingRoads) {
          if (distance <= .01) costs[index] = Math.max(costs[index], Config.weights.manualRoadCenterCost);
          else if (distance <= influence + .35) costs[index] = Math.max(costs[index], Config.weights.manualRoadInfluenceCost);
        } else if (distance <= .01) costs[index] = Math.min(costs[index], roadCost);
        else if (distance <= influence + .35) costs[index] = Math.min(costs[index], nearCost);
      }
    }
    for (const segment of network?.segments || []) {
      if (segment.id === skipSegmentId) continue;
      let remaining = options.builtRoadsOnly && Number.isFinite(segment.builtLength)
        ? Math.max(0, Math.min(segment.length, segment.builtLength)) : segment.length;
      for (let i = 1; i < segment.points.length; i++) {
        const a = segment.points[i - 1], b = segment.points[i];
        const fullLength = Math.hypot(b.x - a.x, b.y - a.y);
        if (fullLength <= 1e-8 || remaining <= 1e-7) continue;
        const ratio = Math.min(1, remaining / fullLength), length = fullLength * ratio;
        const count = Math.max(1, Math.ceil(length / (base.cellWorld * .45)));
        for (let j = 0; j <= count; j++) {
          const t = j / count * ratio; markRoad({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
        remaining -= length;
      }
    }

    const clearance = Config.obstacles.buildingClearance;
    for (const building of buildings) {
      const definition = Buildings.get(building.type);
      if (!definition?.footprint) continue;
      const radius = Math.hypot(definition.footprint.width, definition.footprint.height) / 2 + clearance;
      const left = Math.floor((building.x - radius) / base.cellWorld);
      const right = Math.ceil((building.x + radius) / base.cellWorld);
      const top = clamp(Math.floor((building.y - radius) / base.cellWorld), 0, base.height - 1);
      const bottom = clamp(Math.ceil((building.y + radius) / base.cellWorld), 0, base.height - 1);
      const rotation = building.rotation || 0, cos = Math.cos(rotation), sin = Math.sin(rotation);
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        if (y < 0 || y >= base.height || !base.wrapX && (x < 0 || x >= base.width)) continue;
        const cellX = base.wrapX ? ((x % base.wrapColumns) + base.wrapColumns) % base.wrapColumns : x;
        const worldX = cellX * base.cellWorld, worldY = y * base.cellWorld;
        let dx = worldX - building.x;
        if (base.wrapX) dx -= Math.round(dx / base.wrapWorldWidth) * base.wrapWorldWidth;
        const dy = worldY - building.y;
        const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
        if (Math.abs(localX) <= definition.footprint.width / 2 + clearance &&
            Math.abs(localY) <= definition.footprint.height / 2 + clearance) blocked[y * base.width + cellX] = 1;
      }
    }
    for (const endpoint of endpoints) {
      const { index } = cellIndex(base, endpoint);
      blocked[index] = 0;
      costs[index] = options.avoidExistingRoads ? base.costs[index] :
        Number.isFinite(costs[index]) ? Math.max(Config.weights.roadReuse, costs[index]) : Config.weights.landBase;
    }
    return { ...base, costs, blocked };
  }

  root.OrbitRoadCostField = Object.freeze({ createBase, createMarine, withNetwork, pointToCell, cellIndex });
})(globalThis);
