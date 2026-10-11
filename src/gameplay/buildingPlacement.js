(function (root) {
  'use strict';

  const BuildingModel = root.OrbitSurfaceBuilding;
  const RoadConfig = root.OrbitRoadConfig;
  const RoadGeometry = root.OrbitRoadGeometry;
  const TAU = Math.PI * 2;
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

  function elevationAt(terrain, textureScale, x, y) {
    const cellX = Math.floor(x / textureScale), cellY = Math.floor(y / textureScale);
    if (cellX < 0 || cellY < 0 || cellX >= terrain.width || cellY >= terrain.height) return null;
    return terrain.elevation[cellY * terrain.width + cellX];
  }

  function footprintFits(terrain, textureScale, building, definition, mode = 'land', deepWaterMargin = 10) {
    const corners = footprint(building, definition);
    const worldWidth = terrain.width * textureScale, worldHeight = terrain.height * textureScale;
    if (corners.some(p => p.x < 0 || p.y < 0 || p.x > worldWidth || p.y > worldHeight)) return false;

    const step = Math.max(textureScale, 8);
    const halfWidth = definition.footprint.width / 2, halfHeight = definition.footprint.height / 2;
    for (const localY of sampleAxis(halfHeight, step)) for (const localX of sampleAxis(halfWidth, step)) {
      const p = point(localX, localY, building, building.rotation || 0), height = elevationAt(terrain, textureScale, p.x, p.y);
      if (height === null) return false;
      if (mode === 'land' && height <= terrain.seaLevel) return false;
      if (mode === 'deep-water' && height > terrain.seaLevel - deepWaterMargin) return false;
    }
    return true;
  }

  function coastFacingRotation(terrain, textureScale, position, definition) {
    const shoreClearance = Math.max(8, textureScale * 2);
    const facing = definition.seaFacingOffset || { x: 0, y: -definition.footprint.height / 2 };
    const facingLength = Math.hypot(facing.x, facing.y) || 1;
    const facingNormal = { x: facing.x / facingLength, y: facing.y / facingLength };
    const tries = 72;
    for (let i = 0; i < tries; i++) {
      const rotation = TAU * i / tries, candidate = { ...position, rotation };
      if (!footprintFits(terrain, textureScale, candidate, definition, 'land')) continue;
      const seaPoint = point(facing.x + facingNormal.x * shoreClearance,
        facing.y + facingNormal.y * shoreClearance, candidate, rotation);
      const roadPoint = point(-facing.x - facingNormal.x * shoreClearance,
        -facing.y - facingNormal.y * shoreClearance, candidate, rotation);
      const seaHeight = elevationAt(terrain, textureScale, seaPoint.x, seaPoint.y);
      const landHeight = elevationAt(terrain, textureScale, roadPoint.x, roadPoint.y);
      if (seaHeight !== null && seaHeight <= terrain.seaLevel && landHeight !== null && landHeight > terrain.seaLevel) {
        return rotation;
      }
    }
    return null;
  }

  function inBounds(terrain, textureScale, sample) {
    return sample.x >= 0 && sample.y >= 0 &&
      sample.x <= (terrain.width - 1) * textureScale &&
      sample.y <= (terrain.height - 1) * textureScale;
  }

  function waterAt(terrain, textureScale, sample) {
    return inBounds(terrain, textureScale, sample) &&
      RoadGeometry.elevationAt(terrain, textureScale, sample.x, sample.y) <= terrain.seaLevel;
  }

  function navigableWaterAt(terrain, textureScale, sample, gridStep) {
    const cellWorld = gridStep * textureScale;
    const maxCellX = Math.floor((terrain.width - 1) / gridStep);
    const maxCellY = Math.floor((terrain.height - 1) / gridStep);
    const cellX = Math.max(0, Math.min(maxCellX, Math.round(sample.x / cellWorld)));
    const cellY = Math.max(0, Math.min(maxCellY, Math.round(sample.y / cellWorld)));
    return waterAt(terrain, textureScale, { x: cellX * cellWorld, y: cellY * cellWorld });
  }

  function waterCorridor(terrain, textureScale, start, normal, distance, gridStep) {
    const cellWorld = gridStep * textureScale;
    const sampleStep = Math.max(.5, Math.min(textureScale, cellWorld / 4));
    const samples = Math.ceil(distance / sampleStep);
    for (let i = 0; i <= samples; i++) {
      const travelled = distance * i / Math.max(1, samples);
      const sample = { x: start.x + normal.x * travelled, y: start.y + normal.y * travelled };
      if (!waterAt(terrain, textureScale, sample) || !navigableWaterAt(terrain, textureScale, sample, gridStep)) return false;
    }
    return true;
  }

  function marineFacingNormal(rotation, definition) {
    const offset = definition?.marinePortOffset || definition?.seaFacingOffset;
    const offsetLength = offset ? Math.hypot(offset.x, offset.y) : 0;
    if (!offsetLength || !Number.isFinite(rotation)) return null;
    const localNormal = { x: offset.x / offsetLength, y: offset.y / offsetLength };
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    return { x: localNormal.x * cos - localNormal.y * sin,
      y: localNormal.x * sin + localNormal.y * cos };
  }

  function resolveMarineDock(terrain, textureScale, position, definition) {
    const offset = definition?.marinePortOffset || definition?.seaFacingOffset;
    if (!offset || !Number.isFinite(position?.x) || !Number.isFinite(position?.y) ||
        !Number.isFinite(position?.rotation) || !RoadGeometry || !RoadConfig) return null;
    const gridStep = RoadConfig.gridStep;
    const cellWorld = gridStep * textureScale;
    const settings = RoadConfig.marine.docking;
    const offsetLength = Math.hypot(offset.x, offset.y);
    if (!offsetLength || !Number.isFinite(cellWorld) || cellWorld <= 0) return null;
    const normal = marineFacingNormal(position.rotation, definition);
    if (!normal) return null;
    const approachDistance = settings.approachCells * cellWorld;
    const clearDistance = Math.max(settings.clearanceCells * cellWorld, approachDistance);
    const searchStep = Math.max(.5, cellWorld * settings.searchStepFraction);
    const maxSearchDistance = settings.maxSearchCells * cellWorld;
    const resultAt = point => ({ point: { x: point.x, y: point.y }, normal,
      approachPoint: { x: point.x + normal.x * approachDistance,
        y: point.y + normal.y * approachDistance } });

    if (Number.isFinite(position.waterPort?.x) && Number.isFinite(position.waterPort?.y) &&
        waterCorridor(terrain, textureScale, position.waterPort, normal, clearDistance, gridStep)) {
      return resultAt(position.waterPort);
    }

    for (let extra = 0; extra <= maxSearchDistance; extra += searchStep) {
      const point = { x: position.x + normal.x * (offsetLength + extra),
        y: position.y + normal.y * (offsetLength + extra) };
      if (!waterCorridor(terrain, textureScale, point, normal, clearDistance, gridStep)) continue;
      return resultAt(point);
    }
    return null;
  }

  function compatibleDeposit(terrain, textureScale, position, definition, rules) {
    const allowed = new Set(definition.extracts || []), margin = rules.depositMargin || 0;
    const halfWidth = definition.footprint.width / 2, halfHeight = definition.footprint.height / 2;
    const cos = Math.cos(position.rotation || 0), sin = Math.sin(position.rotation || 0);
    return (terrain.resources || []).map(resource => {
      if (!allowed.has(resource.id)) return false;
      const dx = resource.x * textureScale - position.x, dy = resource.y * textureScale - position.y;
      const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
      const outsideX = Math.max(0, Math.abs(localX) - halfWidth);
      const outsideY = Math.max(0, Math.abs(localY) - halfHeight);
      const distance = Math.hypot(outsideX, outsideY);
      const fieldRadius = Math.max(0, resource.radius || 0) * textureScale;
      return distance <= margin + fieldRadius ? { resource, distance } : null;
    }).filter(Boolean).sort((a, b) => a.distance - b.distance)[0]?.resource || null;
  }

  function validate(options) {
    const { terrain, textureScale, definition, position, rotation = 0, planetId, buildings = [] } = options;
    if (!terrain || !definition || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      return { valid: false, reason: 'Position de construction indisponible.', rotation };
    }

    const hasOrbitalHub = buildings.some(building => building.planetId === planetId && building.type === 'hub');
    if (definition.id === 'hub' && hasOrbitalHub) {
      return { valid: false, reason: 'Un hub orbital est déjà installé sur cette planète.', rotation };
    }
    if (definition.id !== 'hub' && !hasOrbitalHub) {
      return { valid: false, reason: 'Le hub orbital doit être le premier bâtiment posé sur cette planète.', rotation };
    }

    const rules = definition.placementRules || {};
    let resolvedRotation = rotation;
    if (rules.coastRequired) {
      resolvedRotation = coastFacingRotation(terrain, textureScale, position, definition);
      if (resolvedRotation === null) {
        return { valid: false, reason: 'Le port doit être placé au bord de l’eau, tourné vers la mer.', rotation };
      }
    }

    const candidate = { ...position, rotation: resolvedRotation };
    if (rules.landOnly && !footprintFits(terrain, textureScale, candidate, definition, 'land')) {
      return { valid: false, reason: 'Le bâtiment doit tenir entièrement sur la terre ferme.', rotation: resolvedRotation };
    }
    if (rules.deepWaterOnly && !footprintFits(terrain, textureScale, candidate, definition, 'deep-water', rules.deepWaterMargin || 10)) {
      return { valid: false, reason: 'La plateforme doit tenir entièrement en mer profonde.', rotation: resolvedRotation };
    }
    const hasMarineConnector = Boolean(definition.marinePortOffset || definition.seaFacingOffset);
    const marineDock = hasMarineConnector
      ? resolveMarineDock(terrain, textureScale, candidate, definition) : null;
    if (hasMarineConnector && !marineDock) {
      return { valid: false, reason: 'Aucun point d’amarrage sûr ne rejoint la mer depuis ce côté.', rotation: resolvedRotation };
    }
    const deposit = rules.requiresDeposit ? compatibleDeposit(terrain, textureScale, candidate, definition, rules) : null;
    if (rules.requiresDeposit && !deposit) {
      return { valid: false, reason: 'Placez l’extracteur sur un gisement de minerai compatible.', rotation: resolvedRotation };
    }

    for (const existing of buildings) {
      if (existing.planetId !== planetId) continue;
      const existingDefinition = BuildingModel.getDefinition(existing.type);
      if (existingDefinition && overlaps(candidate, definition, existing, existingDefinition)) {
        return { valid: false, reason: 'Cet emplacement chevauche un autre bâtiment.', rotation: resolvedRotation };
      }
    }
    return { valid: true, reason: '', rotation: resolvedRotation, resourceId: deposit?.id || null,
      waterPort: marineDock?.point || null };
  }

  root.OrbitBuildingPlacement = Object.freeze({ validate, coastFacingRotation,
    marineFacingNormal, resolveMarineDock });
})(globalThis);
