(function (root) {
  'use strict';

  const Config = root.OrbitSettlementConfig;
  const World = root.OrbitWorld;
  const CostField = root.OrbitRoadCostField;
  const Pathfinder = root.OrbitRoadPathfinder;
  const Geometry = root.OrbitRoadGeometry;

  const HOUSE_ASSETS = Object.freeze([
    'assets/settlements/maison_01.webp',
    'assets/settlements/maison_02.webp',
    'assets/settlements/maison_03.webp'
  ]);
  const DISTRICT_ASSETS = Object.freeze(['village', 'ville'].flatMap(scale =>
    ['ligne_droite', 'carrefour_T', 'carrefour_croix'].map(layout =>
      `assets/settlements/${scale}_${layout}.webp`)));
  const INDUSTRIAL_TYPES = new Set(['factory', 'extractor', 'oil_platform']);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const copyPoint = point => ({ x: point.x, y: point.y });

  function lengthOf(points) {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i]);
    return length;
  }

  function pointAtDistance(points, target) {
    let remaining = target;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = distance(a, b);
      if (remaining <= length) {
        const t = length > 1e-8 ? remaining / length : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      remaining -= length;
    }
    return copyPoint(points[points.length - 1]);
  }

  function tangentAtDistance(points, target) {
    let remaining = target;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = distance(a, b);
      if (remaining <= length || i === points.length - 1) {
        const magnitude = length || 1;
        return { x: (b.x - a.x) / magnitude, y: (b.y - a.y) / magnitude };
      }
      remaining -= length;
    }
    return { x: 1, y: 0 };
  }

  function create(planetId) {
    return { version: 1, planetId, generatedStage: 0, roads: [], houses: [], districts: [] };
  }

  function isComplete(segment) {
    const length = Number.isFinite(segment.length) ? segment.length : 0;
    const built = Number.isFinite(segment.builtLength) ? segment.builtLength : length;
    return length > 1e-7 && built >= length - 1e-6;
  }

  function completedRouteGroups(network, includeMarine = false) {
    const groups = new Map();
    for (const segment of network?.segments || []) {
      if (segment.routeType === 'marine' && !includeMarine) continue;
      const id = segment.routeId || segment.id, group = groups.get(id) || [];
      group.push(segment); groups.set(id, group);
    }
    return [...groups.entries()].filter(([, segments]) => segments.every(isComplete));
  }

  function growthMetrics(network, buildings) {
    const groups = completedRouteGroups(network), completeSegments = groups.flatMap(([, segments]) => segments);
    const allCompletedSegments = completedRouteGroups(network, true).flatMap(([, segments]) => segments);
    const completedLength = completeSegments.reduce((sum, segment) => sum + segment.length, 0);
    const nodes = new Map((network?.nodes || []).map(node => [node.id, node]));
    const buildingById = new Map((buildings || []).map(building => [building.id, building]));
    const connectedIndustry = new Set();
    for (const segment of allCompletedSegments) for (const nodeId of [segment.from, segment.to]) {
      const node = nodes.get(nodeId), building = buildingById.get(node?.buildingId);
      if (building && INDUSTRIAL_TYPES.has(building.type) && building.constructionState === 'complete') {
        connectedIndustry.add(building.id);
      }
    }
    const score = Math.min(Config.growth.maxStages,
      connectedIndustry.size + Math.floor(completedLength / Config.growth.roadLengthPerStage));
    return { score, completedLength, groups };
  }

  function buildCandidates(groups, network, buildings, settlement) {
    const nodeById = new Map((network?.nodes || []).map(node => [node.id, node]));
    const candidates = [];
    for (const [routeId, segments] of groups) for (const segment of segments) {
      if (!Array.isArray(segment.points) || segment.length < Config.growth.minMainSegmentLength) continue;
      const fractions = [.32, .5, .68];
      for (const fraction of fractions) {
        const measure = segment.length * fraction, point = pointAtDistance(segment.points, measure);
        const endpointNodes = [nodeById.get(segment.from), nodeById.get(segment.to)].filter(Boolean);
        if (endpointNodes.some(node => distance(point, node) < Config.growth.minAnchorNodeDistance)) continue;
        if ((buildings || []).some(building => distance(point, building) < Config.growth.minAnchorNodeDistance)) continue;
        if ((settlement.roads || []).some(road => road.anchor && distance(point, road.anchor) < Config.growth.minAnchorSpacing)) continue;
        const tangent = tangentAtDistance(segment.points, measure);
        candidates.push({ routeId, segment, measure, point, tangent });
      }
    }
    return candidates;
  }

  function pathBetween({ from, to, via = [], network, baseField, terrain, buildings }) {
    const endpoints = [from, ...via, to];
    const field = CostField.withNetwork(baseField, network, buildings, endpoints, null,
      { avoidExistingRoads: true, builtRoadsOnly: true });
    const raw = [];
    for (let i = 1; i < endpoints.length; i++) {
      const part = Pathfinder.findPath(field, terrain, endpoints[i - 1], endpoints[i]);
      if (!part) return null;
      raw.push(...(raw.length ? part.slice(1) : part));
    }
    const geometry = Geometry.create(raw, terrain, baseField.textureScale, buildings);
    if (!geometry || geometry.surfaceTypes.some(Boolean)) return null;
    const length = lengthOf(geometry.points);
    return length > 1 ? { points: geometry.points, length } : null;
  }

  function createLoop(candidate, random, options) {
    const { network, baseField, terrain, buildings, stage } = options;
    const segment = candidate.segment, available = segment.length - candidate.measure;
    const gap = Math.min(available - Config.growth.minAnchorNodeDistance,
      Config.growth.loopMinSpan + random() * (Config.growth.loopMaxSpan - Config.growth.loopMinSpan));
    if (gap < Config.growth.loopMinSpan * .65) return null;
    const endMeasure = candidate.measure + gap;
    const to = pointAtDistance(segment.points, endMeasure), tangent = candidate.tangent;
    const side = random() < .5 ? -1 : 1;
    const normal = { x: -tangent.y * side, y: tangent.x * side };
    const offset = Config.growth.loopOffsetMin + random() * (Config.growth.loopOffsetMax - Config.growth.loopOffsetMin);
    const midpoint = { x: (candidate.point.x + to.x) / 2 + normal.x * offset,
      y: (candidate.point.y + to.y) / 2 + normal.y * offset };
    const geometry = pathBetween({ from: candidate.point, to, via: [midpoint], network, baseField,
      terrain, buildings });
    if (!geometry) return null;
    return { ...geometry, type: 'loop', anchor: copyPoint(candidate.point), endpoint: copyPoint(to),
      tangent: { ...tangent }, roundabout: null, routeId: candidate.routeId, stage };
  }

  function createDeadEnd(candidate, random, options) {
    const { network, baseField, terrain, buildings, stage } = options;
    const tangent = candidate.tangent, side = random() < .5 ? -1 : 1;
    const normal = { x: -tangent.y * side, y: tangent.x * side };
    const branchLength = Config.growth.branchMinLength + random() *
      (Config.growth.branchMaxLength - Config.growth.branchMinLength);
    const along = (random() - .5) * branchLength * .3;
    const center = { x: candidate.point.x + normal.x * branchLength + tangent.x * along,
      y: candidate.point.y + normal.y * branchLength + tangent.y * along };
    const directionLength = distance(candidate.point, center) || 1;
    const direction = { x: (center.x - candidate.point.x) / directionLength,
      y: (center.y - candidate.point.y) / directionLength };
    const radius = Config.growth.roundaboutRadius;
    const entry = { x: center.x - direction.x * radius, y: center.y - direction.y * radius };
    const geometry = pathBetween({ from: candidate.point, to: entry, network, baseField,
      terrain, buildings });
    if (!geometry) return null;
    return { ...geometry, type: 'cul-de-sac', anchor: copyPoint(candidate.point),
      endpoint: copyPoint(entry), tangent: { ...tangent },
      roundabout: { x: center.x, y: center.y, radius }, routeId: candidate.routeId, stage };
  }

  function assetForDistrict(stage, type) {
    const scale = stage >= 7 ? 'ville' : 'village';
    const layout = type === 'cul-de-sac' ? 'ligne_droite' : stage % 4 === 0 ? 'carrefour_croix' : 'carrefour_T';
    return `assets/settlements/${scale}_${layout}.webp`;
  }

  function isLand(terrain, textureScale, point) {
    if (point.x < 0 || point.y < 0 || point.x > (terrain.width - 1) * textureScale ||
        point.y > (terrain.height - 1) * textureScale) return false;
    return Geometry.elevationAt(terrain, textureScale, point.x, point.y) > terrain.seaLevel;
  }

  function createResidents(road, random, terrain, textureScale, buildings) {
    const houses = [], maxDistance = road.length - (road.roundabout?.radius || 4);
    for (const roadDistance of Config.growth.houseDistances) {
      if (roadDistance > maxDistance) continue;
      const point = pointAtDistance(road.points, roadDistance), tangent = tangentAtDistance(road.points, roadDistance);
      const side = random() < .5 ? -1 : 1, offset = Config.growth.houseSideOffset;
      const normal = { x: -tangent.y * side, y: tangent.x * side };
      let position = { x: point.x + normal.x * offset, y: point.y + normal.y * offset };
      if (!isLand(terrain, textureScale, position)) {
        position = { x: point.x - normal.x * offset, y: point.y - normal.y * offset };
      }
      if (!isLand(terrain, textureScale, position) || (buildings || []).some(building =>
          distance(position, building) < Config.growth.minAnchorNodeDistance)) continue;
      houses.push({ id: `${road.id}:house:${houses.length + 1}`, roadId: road.id, roadDistance,
        x: position.x, y: position.y, rotation: Math.atan2(tangent.y, tangent.x),
        asset: HOUSE_ASSETS[Math.floor(random() * HOUSE_ASSETS.length)] });
    }
    return houses;
  }

  function districtFor(road, stage) {
    const distanceOnRoad = Math.min(Config.growth.districtRoadDistance, road.length * .35);
    const position = pointAtDistance(road.points, distanceOnRoad);
    const tangent = tangentAtDistance(road.points, distanceOnRoad);
    return { id: `${road.id}:district`, roadId: road.id, roadDistance: distanceOnRoad,
      x: position.x, y: position.y, rotation: Math.atan2(tangent.y, tangent.x),
      asset: assetForDistrict(stage, road.type) };
  }

  function grow(settlement, options) {
    const { seed, network, buildings, baseField, terrain } = options;
    if (!settlement || settlement.planetId !== options.planetId) settlement = create(options.planetId);
    const metrics = growthMetrics(network, buildings);
    if (!metrics.score || settlement.generatedStage >= metrics.score) return { settlement, changed: false };
    let candidates = buildCandidates(metrics.groups, network, buildings, settlement);
    if (!candidates.length) return { settlement, changed: false };

    let changed = false;
    while (settlement.generatedStage < metrics.score && settlement.generatedStage < Config.growth.maxStages) {
      const stage = settlement.generatedStage + 1;
      const random = World.rng(World.hashSeed(`${seed}:${options.planetId}:settlement:${stage}`));
      const candidate = candidates[Math.floor(random() * candidates.length)];
      let road = random() < Config.growth.loopChance
        ? createLoop(candidate, random, { network, baseField, terrain, buildings, stage }) : null;
      for (let attempt = 0; !road && attempt < Config.growth.pathRetries; attempt++) {
        road = createDeadEnd(candidate, random, { network, baseField, terrain, buildings, stage });
      }
      if (!road) break;
      road.id = `${options.planetId}:settlement-road:${stage}`;
      road.builtLength = 0;
      road.houses = createResidents(road, random, terrain, baseField.textureScale, buildings);
      const district = districtFor(road, stage);
      settlement.roads.push(road);
      settlement.houses.push(...road.houses);
      settlement.districts.push(district);
      settlement.generatedStage = stage;
      changed = true;
      candidates = buildCandidates(metrics.groups, network, buildings, settlement);
      if (!candidates.length) break;
    }
    return { settlement, changed };
  }

  function advance(settlements, deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Settlement construction time must be non-negative');
    let changed = false;
    for (const settlement of Object.values(settlements || {})) for (const road of settlement.roads || []) {
      const built = Number.isFinite(road.builtLength) ? road.builtLength : 0;
      const next = Math.min(road.length, built + Config.construction.secondarySpeed * deltaSeconds);
      if (next > built) { road.builtLength = next; changed = true; }
    }
    return changed;
  }

  function validAsset(path, allowed) { return allowed.includes(path); }
  function restore(saved, planetId) {
    const result = create(planetId);
    if (!saved || typeof saved !== 'object' || saved.planetId !== planetId) return result;
    result.generatedStage = Number.isInteger(saved.generatedStage)
      ? Math.max(0, Math.min(Config.growth.maxStages, saved.generatedStage)) : 0;
    const roads = Array.isArray(saved.roads) ? saved.roads : [];
    result.roads = roads.flatMap(road => {
      if (!road || typeof road.id !== 'string' || !Array.isArray(road.points) || road.points.length < 2 ||
          !road.points.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y)) ||
          !Number.isFinite(road.length) || road.length <= 0) return [];
      const roundabout = road.roundabout && [road.roundabout.x, road.roundabout.y, road.roundabout.radius].every(Number.isFinite)
        ? { x: road.roundabout.x, y: road.roundabout.y, radius: Math.max(0, road.roundabout.radius) } : null;
      return [{ id: road.id, type: road.type === 'loop' ? 'loop' : 'cul-de-sac',
        routeId: typeof road.routeId === 'string' ? road.routeId : '',
        anchor: Number.isFinite(road.anchor?.x) && Number.isFinite(road.anchor?.y) ? copyPoint(road.anchor) : null,
        points: road.points.map(copyPoint), length: road.length,
        builtLength: Math.max(0, Math.min(road.length, Number.isFinite(road.builtLength) ? road.builtLength : 0)),
        roundabout }];
    });
    const roadById = new Map(result.roads.map(road => [road.id, road]));
    result.houses = (Array.isArray(saved.houses) ? saved.houses : []).flatMap(house => {
      if (!house || typeof house.id !== 'string' || !roadById.has(house.roadId) ||
          !Number.isFinite(house.x) || !Number.isFinite(house.y) || !Number.isFinite(house.rotation) ||
          !Number.isFinite(house.roadDistance) || !validAsset(house.asset, HOUSE_ASSETS)) return [];
      return [{ ...house }];
    });
    result.districts = (Array.isArray(saved.districts) ? saved.districts : []).flatMap(district => {
      if (!district || typeof district.id !== 'string' || !roadById.has(district.roadId) ||
          !Number.isFinite(district.x) || !Number.isFinite(district.y) || !Number.isFinite(district.rotation) ||
          !Number.isFinite(district.roadDistance) || !validAsset(district.asset, DISTRICT_ASSETS)) return [];
      return [{ ...district }];
    });
    return result;
  }

  root.OrbitSettlementSimulation = Object.freeze({ create, grow, advance, restore, growthMetrics });
})(globalThis);
