(function (root) {
  'use strict';

  // The colony's built-up zone: terrain cells grown from the colony's spot,
  // cheapest first, so it spreads along its relief layer and around obstacles.
  // It never covers water, leaves other buildings (and a margin) alone, stays
  // gathered around its seed, and only ever gains cells.
  const Data = root.OrbitColonyData;
  const Buildings = root.OrbitBuildingData;

  function heap() {
    const items = [];
    return {
      get size() { return items.length; },
      push(cost, value) {
        items.push([cost, value]);
        for (let i = items.length - 1; i;) {
          const parent = (i - 1) >> 1;
          if (items[parent][0] <= items[i][0]) break;
          [items[parent], items[i]] = [items[i], items[parent]]; i = parent;
        }
      },
      pop() {
        const top = items[0], last = items.pop();
        if (items.length) {
          items[0] = last;
          for (let i = 0; ;) {
            const left = 2 * i + 1, right = left + 1;
            let smallest = i;
            if (left < items.length && items[left][0] < items[smallest][0]) smallest = left;
            if (right < items.length && items[right][0] < items[smallest][0]) smallest = right;
            if (smallest === i) break;
            [items[smallest], items[i]] = [items[i], items[smallest]]; i = smallest;
          }
        }
        return top;
      }
    };
  }

  // Cells under other buildings of the planet, with a margin around them.
  function blockedCells(terrain, textureScale, colony, buildings) {
    const blocked = new Set(), margin = Data.zone.buildingMarginCells * textureScale;
    for (const building of buildings) {
      if (building.id === colony.id || building.planetId !== colony.planetId) continue;
      const definition = Buildings.get(building.type);
      if (!definition) continue;
      const halfWidth = definition.footprint.width / 2 + margin, halfHeight = definition.footprint.height / 2 + margin;
      const cos = Math.cos(building.rotation || 0), sin = Math.sin(building.rotation || 0), reach = Math.hypot(halfWidth, halfHeight);
      const minX = Math.floor((building.x - reach) / textureScale), maxX = Math.ceil((building.x + reach) / textureScale);
      const minY = Math.floor((building.y - reach) / textureScale), maxY = Math.ceil((building.y + reach) / textureScale);
      for (let y = Math.max(0, minY); y <= Math.min(terrain.height - 1, maxY); y++) {
        for (let x = Math.max(0, minX); x <= Math.min(terrain.width - 1, maxX); x++) {
          const dx = x * textureScale - building.x, dy = y * textureScale - building.y;
          if (Math.abs(dx * cos + dy * sin) <= halfWidth && Math.abs(-dx * sin + dy * cos) <= halfHeight) blocked.add(y * terrain.width + x);
        }
      }
    }
    return blocked;
  }

  // Cells of the zone once it covers `target` cells, keeping every cell it had.
  function grow(terrain, textureScale, colony, buildings, target) {
    const { width, height, seaLevel, elevation } = terrain, relief = terrain.relief || elevation;
    const features = root.OrbitWorld?.TERRAIN_FEATURES || { lake: 1, cove: 5 };
    const existing = new Set(colony.colony?.cells || []);
    if (existing.size >= target) return [...existing];
    const seedX = Math.max(1, Math.min(width - 2, Math.round(colony.x / textureScale)));
    const seedY = Math.max(1, Math.min(height - 2, Math.round(colony.y / textureScale)));
    const seed = seedY * width + seedX;
    const layer = cell => Math.floor((relief[cell] - seaLevel - .5) / Data.zone.layerStep);
    const water = cell => elevation[cell] <= seaLevel || terrain.features?.[cell] === features.lake || terrain.features?.[cell] === features.cove;
    const base = layer(seed), reach = Data.zone.reachFactor * Math.sqrt(target / Math.PI);
    const blocked = blockedCells(terrain, textureScale, colony, buildings);
    const result = [...existing], cost = new Map([[seed, 0]]), done = new Set(), queue = heap();
    queue.push(0, seed);
    while (queue.size && result.length < target) {
      const [, cell] = queue.pop();
      if (done.has(cell)) continue;
      done.add(cell);
      if (!existing.has(cell)) result.push(cell);
      const x = cell % width, y = (cell / width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1 || done.has(next)) continue;
        if (!existing.has(next)) {
          if (Math.hypot(nx - seedX, ny - seedY) > reach || water(next) || blocked.has(next) ||
            Math.abs(layer(next) - base) > Data.zone.layers) continue;
        }
        const step = Math.hypot(dx, dy) * (1 + Math.abs(layer(next) - base) * 2.5);
        const total = cost.get(cell) + step + Math.hypot(nx - seedX, ny - seedY) * .08;
        if (total < (cost.get(next) ?? Infinity)) { cost.set(next, total); queue.push(total, next); }
      }
    }
    return result;
  }

  root.OrbitColonyZone = Object.freeze({ grow, blockedCells });
})(globalThis);
