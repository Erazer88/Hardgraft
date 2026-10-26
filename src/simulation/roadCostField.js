(function (root) {
  'use strict';

  const Config = root.OrbitRoadConfig, Buildings = root.OrbitBuildingData;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // Roads read the relief the map draws (canyons, lake shores, strata),
  // averaged over each routing cell; water still comes from the gameplay
  // elevation. Every cell keeps its slope vector, so the pathfinder can
  // charge earthworks for crossing a hillside, and marks drawn rivers so
  // crossings become explicit bridges.
  function createBase(terrain, textureScale) {
    const step = Config.gridStep;
    const width = Math.floor((terrain.width - 1) / step) + 1;
    const height = Math.floor((terrain.height - 1) / step) + 1;
    const count = width * height, costs = new Float32Array(count), blocked = new Uint8Array(count);
    const elevations = new Float32Array(count), water = new Uint8Array(count), seaLevel = terrain.seaLevel;
    const slopeX = new Float32Array(count), slopeY = new Float32Array(count), river = new Uint8Array(count);
    const valueAt = (x, y) => elevations[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
    const weights = Config.weights, radius = weights.valleyRadiusCells, relief = terrain.relief || terrain.elevation;

    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sourceX = Math.min(terrain.width - 1, x * step), sourceY = Math.min(terrain.height - 1, y * step);
      let total = 0, samples = 0;
      for (let oy = -Math.floor(step / 2); oy <= Math.floor(step / 2); oy++) for (let ox = -Math.floor(step / 2); ox <= Math.floor(step / 2); ox++) {
        const sx = clamp(sourceX + ox, 0, terrain.width - 1), sy = clamp(sourceY + oy, 0, terrain.height - 1);
        total += relief[sy * terrain.width + sx]; samples++;
      }
      elevations[y * width + x] = total / samples;
      water[y * width + x] = terrain.elevation[sourceY * terrain.width + sourceX] <= seaLevel ? 1 : 0;
    }
    for (const course of terrain.rivers || []) {
      for (let i = 0; i < course.points.length; i += 2) {
        if (course.flows[i / 2] < weights.bridgeMinFlow) continue;
        const x = Math.round(course.points[i] / step), y = Math.round(course.points[i + 1] / step);
        if (x >= 0 && y >= 0 && x < width && y < height) river[y * width + x] = 1;
      }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x, elevation = elevations[index];
      const depth = seaLevel - terrain.elevation[Math.min(terrain.height - 1, y * step) * terrain.width +
        Math.min(terrain.width - 1, x * step)];
      if (depth > Config.obstacles.maxWaterDepth) { blocked[index] = 1; costs[index] = Infinity; continue; }
      let localTotal = 0, localCount = 0;
      for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
        localTotal += valueAt(x + ox, y + oy); localCount++;
      }
      const localAverage = localTotal / localCount;
      const dx = (valueAt(x + 1, y) - valueAt(x - 1, y)) / (2 * step);
      const dy = (valueAt(x, y + 1) - valueAt(x, y - 1)) / (2 * step);
      slopeX[index] = dx; slopeY[index] = dy;
      const roughness = Math.hypot(dx, dy);
      const valley = clamp((localAverage - elevation) / weights.valleyScale, 0, 1);
      let cost = weights.landBase + Math.max(0, elevation - seaLevel) * weights.highlandPerElevation +
        roughness * weights.terrainRoughness - valley * weights.valleyDiscount;
      if (depth > 0) cost *= weights.shallowWaterMultiplier;
      costs[index] = Math.max(weights.roadReuse, cost);
    }
    // The cheapest cell bounds the A* heuristic without overestimating.
    let minimumCost = Infinity;
    for (let index = 0; index < count; index++) if (costs[index] < minimumCost) minimumCost = costs[index];
    return { width, height, count, step, textureScale, cellWorld: step * textureScale,
      terrainWidth: terrain.width, terrainHeight: terrain.height, seaLevel,
      costs, blocked, elevations, water, slopeX, slopeY, river, minimumCost };
  }

  // Sea lanes: only water is open, and water near the shore costs more, so
  // lanes run offshore and round headlands instead of hugging the coast.
  function createMarine(base) {
    const marine = Config.marine, costs = new Float32Array(base.count), blocked = new Uint8Array(base.count);
    const toLand = new Float32Array(base.count).fill(Infinity), queue = [];
    for (let index = 0; index < base.count; index++) if (!base.water[index]) { toLand[index] = 0; queue.push(index); }
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head], x = index % base.width, y = Math.floor(index / base.width);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nx = x + ox, ny = y + oy, next = ny * base.width + nx;
        if ((!ox && !oy) || nx < 0 || ny < 0 || nx >= base.width || ny >= base.height) continue;
        const distance = toLand[index] + (ox && oy ? Math.SQRT2 : 1);
        if (distance < toLand[next]) { toLand[next] = distance; queue.push(next); }
      }
    }
    // Connected bodies of water, so a lake port fails fast instead of searching the sea.
    const waterBody = new Int32Array(base.count).fill(-1);
    for (let start = 0, label = 0; start < base.count; start++) {
      if (!base.water[start] || waterBody[start] >= 0) continue;
      const stack = [start]; waterBody[start] = label;
      while (stack.length) {
        const index = stack.pop(), x = index % base.width, y = Math.floor(index / base.width);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox, ny = y + oy, next = ny * base.width + nx;
          if (nx < 0 || ny < 0 || nx >= base.width || ny >= base.height || !base.water[next] || waterBody[next] >= 0) continue;
          waterBody[next] = label; stack.push(next);
        }
      }
      label++;
    }
    for (let index = 0; index < base.count; index++) {
      blocked[index] = base.water[index] ? 0 : 1;
      const nearShore = Math.max(0, 1 - toLand[index] / marine.coastClearanceCells);
      costs[index] = base.water[index] ? marine.waterCost * (1 + marine.coastPenalty * nearShore * nearShore) : Infinity;
    }
    return { ...base, costs, blocked, waterBody, minimumCost: marine.waterCost, maxExpandedStates: marine.maxExpandedStates };
  }

  function pointToCell(field, point) {
    return {
      x: clamp(Math.round(point.x / field.cellWorld), 0, field.width - 1),
      y: clamp(Math.round(point.y / field.cellWorld), 0, field.height - 1)
    };
  }

  function cellIndex(field, point) {
    const cell = pointToCell(field, point);
    return { ...cell, index: cell.y * field.width + cell.x };
  }

  function withNetwork(base, network, buildings = [], endpoints = [], skipSegmentId = null, options = {}) {
    const costs = new Float32Array(base.costs), blocked = new Uint8Array(base.blocked);
    let minimumCost = base.minimumCost;
    if (options.allowDeepWater) for (let index = 0; index < base.count; index++) {
      if (!base.water[index]) continue;
      blocked[index] = 0; costs[index] = Config.weights.marineWaterMultiplier;
    }
    const influence = Config.weights.roadInfluenceCells, roadCost = Config.weights.roadReuse;
    const nearCost = Config.weights.nearRoad;
    function markRoad(point) {
      const cell = pointToCell(base, point);
      for (let oy = -influence; oy <= influence; oy++) for (let ox = -influence; ox <= influence; ox++) {
        const x = cell.x + ox, y = cell.y + oy;
        if (x < 0 || y < 0 || x >= base.width || y >= base.height) continue;
        const index = y * base.width + x;
        if (blocked[index]) continue;
        const distance = Math.hypot(ox, oy);
        if (options.avoidExistingRoads) {
          if (distance <= .01) costs[index] = Math.max(costs[index], Config.weights.manualRoadCenterCost);
          else if (distance <= influence + .35) costs[index] = Math.max(costs[index], Config.weights.manualRoadInfluenceCost);
        } else if (distance <= .01) { costs[index] = Math.min(costs[index], roadCost); minimumCost = Math.min(minimumCost, roadCost); }
        else if (distance <= influence + .35) { costs[index] = Math.min(costs[index], nearCost); minimumCost = Math.min(minimumCost, nearCost); }
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
      const left = clamp(Math.floor((building.x - radius) / base.cellWorld), 0, base.width - 1);
      const right = clamp(Math.ceil((building.x + radius) / base.cellWorld), 0, base.width - 1);
      const top = clamp(Math.floor((building.y - radius) / base.cellWorld), 0, base.height - 1);
      const bottom = clamp(Math.ceil((building.y + radius) / base.cellWorld), 0, base.height - 1);
      const rotation = building.rotation || 0, cos = Math.cos(rotation), sin = Math.sin(rotation);
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const worldX = x * base.cellWorld, worldY = y * base.cellWorld;
        const dx = worldX - building.x, dy = worldY - building.y;
        const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
        if (Math.abs(localX) <= definition.footprint.width / 2 + clearance &&
            Math.abs(localY) <= definition.footprint.height / 2 + clearance) blocked[y * base.width + x] = 1;
      }
    }
    for (const endpoint of endpoints) {
      const { index } = cellIndex(base, endpoint);
      blocked[index] = 0;
      costs[index] = options.avoidExistingRoads ? base.costs[index] :
        Number.isFinite(costs[index]) ? Math.max(Config.weights.roadReuse, costs[index]) : Config.weights.landBase;
      minimumCost = Math.min(minimumCost, costs[index]);
    }
    return { ...base, costs, blocked, minimumCost };
  }

  root.OrbitRoadCostField = Object.freeze({ createBase, createMarine, withNetwork, pointToCell, cellIndex });
})(globalThis);
