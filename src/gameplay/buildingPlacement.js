(function (root) {
  'use strict';

  const BuildingModel = root.OrbitSurfaceBuilding;
  const point = (x, y, origin, angle) => {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return { x: origin.x + x * cos - y * sin, y: origin.y + x * sin + y * cos };
  };

  function footprint(building, definition) {
    const halfWidth = definition.footprint.width / 2, halfHeight = definition.footprint.height / 2;
    return [point(-halfWidth, -halfHeight, building, building.rotation || 0),
      point(halfWidth, -halfHeight, building, building.rotation || 0),
      point(halfWidth, halfHeight, building, building.rotation || 0),
      point(-halfWidth, halfHeight, building, building.rotation || 0)];
  }

  function overlaps(first, firstDefinition, second, secondDefinition) {
    const a = footprint(first, firstDefinition), b = footprint(second, secondDefinition);
    for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
      const start = polygon[i], end = polygon[(i + 1) % polygon.length];
      const axis = { x: -(end.y - start.y), y: end.x - start.x };
      const projectionA = a.map(p => p.x * axis.x + p.y * axis.y);
      const projectionB = b.map(p => p.x * axis.x + p.y * axis.y);
      if (Math.max(...projectionA) <= Math.min(...projectionB) || Math.max(...projectionB) <= Math.min(...projectionA)) return false;
    }
    return true;
  }

  function sampleAxis(halfExtent, step) {
    const values = [-halfExtent];
    for (let value = -halfExtent + step; value < halfExtent; value += step) values.push(value);
    values.push(halfExtent);
    return values;
  }

  function validate(options) {
    const { terrain, textureScale, definition, position, rotation = 0, planetId, buildings = [] } = options;
    if (!terrain || !definition || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      return { valid: false, reason: 'Position de construction indisponible.' };
    }

    const candidate = { ...position, rotation };
    const corners = footprint(candidate, definition);
    const worldWidth = terrain.width * textureScale, worldHeight = terrain.height * textureScale;
    if (corners.some(p => p.x < 0 || p.y < 0 || p.x > worldWidth || p.y > worldHeight)) {
      return { valid: false, reason: 'Le bâtiment dépasse la surface cartographiée.' };
    }

    if (definition.placementRules.landOnly) {
      const step = Math.max(textureScale, 8);
      const halfWidth = definition.footprint.width / 2, halfHeight = definition.footprint.height / 2;
      for (const localY of sampleAxis(halfHeight, step)) for (const localX of sampleAxis(halfWidth, step)) {
        const p = point(localX, localY, candidate, rotation);
        const x = Math.floor(p.x / textureScale), y = Math.floor(p.y / textureScale);
        if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height ||
            terrain.elevation[y * terrain.width + x] <= terrain.seaLevel) {
          return { valid: false, reason: 'Le bâtiment doit tenir entièrement sur la terre ferme.' };
        }
      }
    }

    for (const existing of buildings) {
      if (existing.planetId !== planetId) continue;
      const existingDefinition = BuildingModel.getDefinition(existing.type);
      if (existingDefinition && overlaps(candidate, definition, existing, existingDefinition)) {
        return { valid: false, reason: 'Cet emplacement chevauche un autre bâtiment.' };
      }
    }
    return { valid: true, reason: '' };
  }

  root.OrbitBuildingPlacement = Object.freeze({ validate });
})(globalThis);
