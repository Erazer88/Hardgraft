(function (root) {
  'use strict';

  // Line of sight over a planet's relief, for the radio links of relay
  // antennas: one top sees another when no ground rises above the straight
  // line between them. Heights are metres above the sea (water is flat at
  // sea level, a lake at its surface); positions are world km, read on cells
  // of `textureScale` km. No DOM: the same answers serve the simulation and
  // the map's coverage view.
  const settings = () => root.OrbitDataNetworkData?.relief || { metersPerLevel: 35, sampleCells: .5 };
  const scaleKm = () => root.OrbitConfig?.terrain?.textureScale || 1;

  function groundAtCell(terrain, cell) {
    const level = terrain.relief?.[cell] ?? terrain.elevation[cell];
    return Math.max(0, level - terrain.seaLevel) * settings().metersPerLevel;
  }

  function cellAt(terrain, x, y) {
    const scale = scaleKm();
    const cx = Math.max(0, Math.min(terrain.width - 1, Math.floor(x / scale)));
    const cy = Math.max(0, Math.min(terrain.height - 1, Math.floor(y / scale)));
    return cy * terrain.width + cx;
  }

  // Ground height (m) under a world point.
  const groundAt = (terrain, x, y) => groundAtCell(terrain, cellAt(terrain, x, y));

  // Whether the top `fromHeightM` above `from` sees the top `toHeightM` above `to`.
  function clear(terrain, from, fromHeightM, to, toHeightM) {
    if (!terrain?.elevation) return true;
    const startTop = groundAt(terrain, from.x, from.y) + fromHeightM, endTop = groundAt(terrain, to.x, to.y) + toHeightM;
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / scaleKm() / settings().sampleCells);
    const startCell = cellAt(terrain, from.x, from.y), endCell = cellAt(terrain, to.x, to.y);
    for (let step = 1; step < steps; step++) {
      const t = step / steps, cell = cellAt(terrain, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      if (cell === startCell || cell === endCell) continue;
      if (groundAtCell(terrain, cell) > startTop + (endTop - startTop) * t) return false;
    }
    return true;
  }

  // What a top `heightM` above `center` sees within `rangeKm`, for targets
  // `targetHeightM` tall: a square of cells around it, 0 out of range,
  // 1 hidden, 2 in sight. Rays swept from the centre keep the steepest ground
  // met so far; a cell is in sight when its target top rises above it.
  function viewshed(terrain, center, heightM, rangeKm, targetHeightM) {
    const scale = scaleKm(), radius = Math.max(1, Math.ceil(rangeKm / scale)), size = radius * 2 + 1;
    const cells = new Uint8Array(size * size);
    const cx = Math.floor(center.x / scale), cy = Math.floor(center.y / scale);
    const top = groundAt(terrain, center.x, center.y) + heightM, step = settings().sampleCells;
    const rays = Math.ceil(Math.PI * 2 * radius * 1.5);
    for (let ray = 0; ray < rays; ray++) {
      const angle = ray / rays * Math.PI * 2, dx = Math.cos(angle), dy = Math.sin(angle);
      let steepest = -Infinity;
      for (let distance = step; distance <= radius; distance += step) {
        const x = cx + .5 + dx * distance, y = cy + .5 + dy * distance;
        const tx = Math.floor(x), ty = Math.floor(y);
        if (tx < 0 || ty < 0 || tx >= terrain.width || ty >= terrain.height) break;
        const ground = groundAtCell(terrain, ty * terrain.width + tx), km = distance * scale;
        const index = (ty - cy + radius) * size + (tx - cx + radius);
        const seen = (ground + targetHeightM - top) / km >= steepest;
        if (seen) cells[index] = 2; else if (!cells[index]) cells[index] = 1;
        steepest = Math.max(steepest, (ground - top) / km);
      }
    }
    return { radius, size, cells, originCellX: cx - radius, originCellY: cy - radius, cellKm: scale };
  }

  root.OrbitLineOfSight = Object.freeze({ clear, viewshed, groundAt });
})(globalThis);
