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
  const DISTRICT_ASSETS = Object.freeze(['village', 'ville'].map(scale =>
    `assets/settlements/${scale}_ligne_droite.webp`));
  const HOUSE_ASSET_KEYS = Object.freeze(['house:maison_01', 'house:maison_02', 'house:maison_03']);
  const DISTRICT_ASSET_KEYS = Object.freeze(['district:village_ligne_droite', 'district:ville_ligne_droite']);
  const VISUAL_VERSION = 6;
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
    return { version: VISUAL_VERSION, planetId, generatedStage: 0, roads: [], houses: [], districts: [] };
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

  function growthMetrics(network, buildings, settlement) {
    const groups = completedRouteGroups(network), completeSegments = groups.flatMap(([, segments]) => segments);
    const allCompletedSegments = completedRouteGroups(network, true).flatMap(([, segments]) => segments);
    const completedLength = completeSegments.reduce((sum, segment) => sum + segment.length, 0);
    const primaryLength = (network?.segments || []).filter(segment =>
      segment.routeType !== 'marine' && segment.roadClass !== 'secondary')
      .reduce((sum, segment) => sum + (Number.isFinite(segment.length) ? segment.length : 0), 0);
    const nodes = new Map((network?.nodes || []).map(node => [node.id, node]));
    const buildingById = new Map((buildings || []).map(building => [building.id, building]));
    const connectedIndustry = new Set();
    for (const segment of allCompletedSegments) for (const nodeId of [segment.from, segment.to]) {
      const node = nodes.get(nodeId), building = buildingById.get(node?.buildingId);
      if (building && INDUSTRIAL_TYPES.has(building.type) && building.constructionState === 'complete') {
        connectedIndustry.add(building.id);
      }
    }
    const secondaryLength = (settlement?.roads || []).filter(isComplete)
      .reduce((sum, road) => sum + road.length, 0);
    const secondaryTargetLength = primaryLength * Config.growth.secondaryToPrimaryRatio;
    const activityScore = connectedIndustry.size +
      Math.floor(completedLength / Config.growth.roadLengthPerStage) +
      Math.floor(secondaryLength / Config.growth.secondaryRoadLengthPerStage);
    const score = Math.min(Config.growth.maxStages,
      Math.max(groups.length ? Config.growth.initialRouteStages : 0, activityScore));
    return { score, completedLength, primaryLength, secondaryLength, secondaryTargetLength, groups };
  }

  function buildCandidates(groups, network, buildings, settlement) {
    const nodeById = new Map((network?.nodes || []).map(node => [node.id, node]));
    const hosts = [];
    for (const [routeId, segments] of groups) for (const segment of segments) {
      hosts.push({ id: segment.id, kind: 'main', routeId, points: segment.points,
        length: segment.length, segment });
    }
    for (const road of settlement.roads || []) if (isComplete(road)) {
      hosts.push({ id: road.id, kind: 'secondary', routeId: road.routeId, points: road.points,
        length: road.length, road });
    }
    const candidates = [];
    for (const host of hosts) {
      if (!Array.isArray(host.points) || host.length < Config.growth.minMainSegmentLength) continue;
      for (const fraction of Config.growth.branchCandidateFractions) {
        const measure = host.length * fraction, point = pointAtDistance(host.points, measure);
        if (host.kind === 'main') {
          const endpointNodes = [nodeById.get(host.segment.from), nodeById.get(host.segment.to)].filter(Boolean);
          if (endpointNodes.some(node => distance(point, node) < Config.growth.minAnchorNodeDistance)) continue;
        } else if (Math.min(measure, host.length - measure) < Config.growth.branchEndpointClearance) continue;
        if ((buildings || []).some(building => distance(point, building) < Config.growth.minAnchorNodeDistance)) continue;
        if ((settlement.roads || []).some(road => road.anchor && distance(point, road.anchor) < Config.growth.minAnchorSpacing)) continue;
        const tangent = tangentAtDistance(host.points, measure);
        candidates.push({ routeId: host.routeId, hostId: host.id, hostKind: host.kind,
          host, measure, point, tangent });
      }
    }
    return candidates;
  }

  function chooseCandidate(candidates, random) {
    const weightFor = candidate => candidate.hostKind === 'secondary'
      ? Config.growth.secondaryCandidateWeight : 1;
    const totalWeight = candidates.reduce((sum, candidate) => sum + weightFor(candidate), 0);
    let choice = random() * totalWeight;
    for (const candidate of candidates) {
      choice -= weightFor(candidate);
      if (choice < 0) return candidate;
    }
    return candidates[candidates.length - 1];
  }

  function networkWithSettlements(network, settlement) {
    const secondarySegments = (settlement?.roads || []).map(road => ({
      id: `settlement:${road.id}`, routeId: `settlement:${road.id}`, from: road.id, to: road.id,
      points: road.points, length: road.length,
      builtLength: Number.isFinite(road.builtLength) ? road.builtLength : road.length
    }));
    return { ...(network || {}), segments: [...(network?.segments || []), ...secondarySegments] };
  }

  function pathBetween({ from, to, network, settlement, baseField, terrain, buildings }) {
    const endpoints = [from, to];
    const field = CostField.withNetwork(baseField, networkWithSettlements(network, settlement), buildings, endpoints, null,
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
    if (length > Config.growth.maxGeneratedRoadLength) return null;
    return length > 1 ? { points: geometry.points, length } : null;
  }

  function connectorTargets(candidate, candidates) {
    return candidates.filter(target => {
      if (target.hostId === candidate.hostId) return false;
      if (candidate.hostKind === 'main' && target.hostKind === 'main' &&
          candidate.routeId && candidate.routeId === target.routeId) return false;
      const span = distance(candidate.point, target.point);
      return span >= Config.growth.connectorMinSpan && span <= Config.growth.connectorMaxSpan;
    });
  }

  function createConnector(candidate, target, options) {
    const { network, baseField, terrain, buildings, stage } = options;
    const geometry = pathBetween({ from: candidate.point, to: target.point, network,
      settlement: options.settlement, baseField, terrain, buildings });
    if (!geometry) return null;
    return { ...geometry, type: 'connector', anchor: copyPoint(candidate.point),
      endpoint: copyPoint(target.point), tangent: { ...candidate.tangent }, routeId: candidate.routeId,
      parentRoadId: candidate.hostKind === 'secondary' ? candidate.hostId : null,
      connectsToRoadId: target.hostKind === 'secondary' ? target.hostId : null, stage };
  }

  function createBranch(candidate, random, options) {
    const { network, settlement, baseField, terrain, buildings, stage } = options;
    const tangent = candidate.tangent, side = random() < .5 ? -1 : 1;
    const normal = { x: -tangent.y * side, y: tangent.x * side };
    const isInitialRoute = stage <= Config.growth.initialRouteStages;
    const minLength = isInitialRoute ? Config.growth.initialBranchMinLength : Config.growth.branchMinLength;
    const maxLength = isInitialRoute ? Config.growth.initialBranchMaxLength : Config.growth.branchMaxLength;
    const budget = Number.isFinite(options.lengthBudget) ? Math.max(0, options.lengthBudget) : maxLength;
    if (budget <= 1) return null;
    const cappedMinLength = Math.min(minLength, budget), cappedMaxLength = Math.min(maxLength, budget);
    const branchLength = cappedMinLength + random() * (cappedMaxLength - cappedMinLength);
    const along = (random() - .5) * branchLength * .45;
    const center = { x: candidate.point.x + normal.x * branchLength + tangent.x * along,
      y: candidate.point.y + normal.y * branchLength + tangent.y * along };
    const geometry = pathBetween({ from: candidate.point, to: center, network, settlement,
      baseField, terrain, buildings });
    if (!geometry) return null;
    return { ...geometry, type: 'branch', anchor: copyPoint(candidate.point),
      endpoint: copyPoint(center), tangent: { ...tangent }, routeId: candidate.routeId,
      parentRoadId: candidate.hostKind === 'secondary' ? candidate.hostId : null, stage };
  }

  function clipRoadToLength(road, budget) {
    if (!road || road.length <= budget + 1e-7) return road;
    if (!Array.isArray(road.points) || budget <= 1e-7) return null;
    const points = [copyPoint(road.points[0])];
    let remaining = budget, length = 0;
    for (let i = 1; i < road.points.length && remaining > 1e-7; i++) {
      const start = road.points[i - 1], end = road.points[i], edgeLength = distance(start, end);
      if (edgeLength <= remaining) {
        points.push(copyPoint(end)); remaining -= edgeLength; length += edgeLength;
      } else if (edgeLength > 1e-9) {
        const ratio = remaining / edgeLength;
        points.push({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio });
        length += remaining; remaining = 0;
      }
    }
    if (points.length < 2 || length <= 1e-7) return null;
    return { ...road, points, length,
      builtLength: Math.max(0, Math.min(length, Number.isFinite(road.builtLength) ? road.builtLength : 0)),
      endpoint: copyPoint(points[points.length - 1]) };
  }

  function fitRoadToBudget(road, budget) {
    if (!road || road.length <= budget + 1e-7) return road;
    if (road.type === 'connector') return null;
    return clipRoadToLength(road, budget);
  }

  function enforceSecondaryLength(settlement, targetLength) {
    const roads = settlement.roads || [];
    const totalLength = roads.reduce((sum, road) => sum + (Number.isFinite(road.length) ? road.length : 0), 0);
    if (totalLength <= targetLength + 1e-7) return false;

    const retained = [];
    let remaining = Math.max(0, targetLength);
    for (const road of roads) {
      if (remaining <= 1e-7) break;
      if (road.length <= remaining + 1e-7) {
        retained.push(road);
        remaining -= road.length;
      } else {
        const clipped = clipRoadToLength(road, remaining);
        if (clipped) retained.push(clipped);
        break;
      }
    }

    settlement.roads = retained;
    const lengthByRoadId = new Map(retained.map(road => [road.id, road.length]));
    settlement.houses = (settlement.houses || []).filter(house => lengthByRoadId.has(house.roadId) &&
      house.roadDistance <= lengthByRoadId.get(house.roadId));
    settlement.districts = (settlement.districts || []).filter(district => district.mainRoadAsset ||
      (lengthByRoadId.has(district.roadId) && district.roadDistance <= lengthByRoadId.get(district.roadId)));
    for (const road of retained) {
      if (Array.isArray(road.houses)) road.houses = road.houses.filter(house => house.roadDistance <= road.length);
      road.builtLength = Math.max(0, Math.min(road.length, Number.isFinite(road.builtLength) ? road.builtLength : 0));
    }
    return true;
  }

  function assetForDistrict(stage) {
    const scale = stage >= Config.growth.cityStage ? 'ville' : 'village';
    return `assets/settlements/${scale}_ligne_droite.webp`;
  }

  function isLand(terrain, textureScale, point) {
    if (point.x < 0 || point.y < 0 || point.x > (terrain.width - 1) * textureScale ||
        point.y > (terrain.height - 1) * textureScale) return false;
    return Geometry.elevationAt(terrain, textureScale, point.x, point.y) > terrain.seaLevel;
  }

  function createResidents(road, random, terrain, textureScale, buildings) {
    const houses = [], maxDistance = road.length - Config.growth.branchEndpointClearance * .5;
    const firstHouseDistance = Config.growth.houseStartDistance;
    for (let roadDistance = firstHouseDistance; roadDistance < maxDistance;
         roadDistance += Config.growth.houseMinSpacing + random() *
           (Config.growth.houseMaxSpacing - Config.growth.houseMinSpacing)) {
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

  function districtOnMainRoute(routeId, segments, random, settlement, options) {
    const mainSegments = segments.filter(segment => segment.routeType !== 'marine' && segment.roadClass !== 'secondary');
    if (mainSegments.reduce((sum, segment) => sum + segment.length, 0) < Config.growth.districtMinMainRoadLength) return null;
    const candidates = mainSegments.filter(segment => segment.length >= Config.growth.districtMinPlacementSegmentLength)
      .sort((a, b) => b.length - a.length || a.id.localeCompare(b.id));
    if (!candidates.length) return null;
    const segment = candidates[0];
    const roadDistance = segment.length * (.36 + random() * .28);
    const anchor = pointAtDistance(segment.points, roadDistance);
    const tangent = tangentAtDistance(segment.points, roadDistance);
    const normal = { x: -tangent.y, y: tangent.x };
    const rotation = Math.atan2(tangent.y, tangent.x);
    const halfSpan = Config.render.districtWidthWorld * .38;
    const side = random() < .5 ? 1 : -1;
    const stage = settlement.generatedStage || 0;
    for (const direction of [side, -side]) {
      const position = { x: anchor.x + normal.x * direction * Config.growth.districtSideOffset,
        y: anchor.y + normal.y * direction * Config.growth.districtSideOffset };
      const samples = [position,
        { x: position.x - tangent.x * halfSpan, y: position.y - tangent.y * halfSpan },
        { x: position.x + tangent.x * halfSpan, y: position.y + tangent.y * halfSpan }];
      if (!samples.every(point => isLand(options.terrain, options.baseField.textureScale, point))) continue;
      if ((options.buildings || []).some(building => samples.some(point =>
          distance(point, building) < Config.growth.minAnchorNodeDistance * .55))) continue;
      return { id: `${routeId}:district`, roadId: segment.id, routeId, mainRoadAsset: true,
        roadDistance, x: position.x, y: position.y, rotation,
        variant: Math.floor(random() * 2), asset: assetForDistrict(stage) };
    }
    return null;
  }

  function syncMainRoadDistricts(settlement, options) {
    const existingRoutes = new Set((settlement.districts || [])
      .filter(district => district.mainRoadAsset && typeof district.routeId === 'string')
      .map(district => district.routeId));
    const candidates = [];
    for (const [routeId, segments] of completedRouteGroups(options.network)) {
      if (existingRoutes.has(routeId)) continue;
      const random = World.rng(World.hashSeed(`${options.seed}:${options.planetId}:settlement:main-road-pair:${routeId}`));
      const include = random() < Config.growth.districtRouteChance;
      const district = districtOnMainRoute(routeId, segments, random, settlement, options);
      if (district) candidates.push({ district, include });
    }
    if (!candidates.length) return false;
    let chosen = candidates.filter(candidate => candidate.include);
    if (!chosen.length && !existingRoutes.size) {
      const fallback = World.hashSeed(`${options.seed}:${options.planetId}:settlement:main-road-pair:fallback`) % candidates.length;
      chosen = [candidates[fallback]];
    }
    const placed = [...(settlement.districts || [])];
    let changed = false;
    for (const candidate of chosen) {
      if (placed.some(district => distance(district, candidate.district) < Config.growth.districtMinSpacing)) continue;
      placed.push(candidate.district); changed = true;
    }
    if (changed) settlement.districts = placed;
    return changed;
  }

  function migrateSettlementVisuals(settlement, options) {
    const roads = settlement.roads || [];
    if (settlement.version >= VISUAL_VERSION &&
        Array.isArray(settlement.houses) && Array.isArray(settlement.districts)) return false;
    settlement.houses = []; settlement.districts = [];
    for (let index = 0; index < roads.length; index++) {
      const road = roads[index];
      const stageMatch = road.id.match(/settlement-road:(\d+)$/);
      if (!Number.isInteger(road.stage)) road.stage = stageMatch ? Number(stageMatch[1]) : index + 1;
      const random = World.rng(World.hashSeed(`${options.seed}:${options.planetId}:settlement:visual:${road.id}`));
      const updatedHouses = createResidents(road, random, options.terrain, options.baseField.textureScale, options.buildings);
      road.houses = updatedHouses;
      settlement.houses.push(...road.houses);
    }
    settlement.version = VISUAL_VERSION;
    return true;
  }

  function nextRoadOrdinal(settlement) {
    const roadMaximum = (settlement.roads || []).reduce((maximum, road) => {
      const match = typeof road.id === 'string' && road.id.match(/settlement-road:(\d+)$/);
      return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0);
    return Math.max(roadMaximum, Number.isInteger(settlement.generatedStage) ? settlement.generatedStage : 0) + 1;
  }

  function grow(settlement, options) {
    const { seed, network, buildings, baseField, terrain } = options;
    if (!settlement || settlement.planetId !== options.planetId) settlement = create(options.planetId);
    const previousVisualVersion = settlement.version || 1;
    let migrated = migrateSettlementVisuals(settlement, options);
    migrated = syncMainRoadDistricts(settlement, options) || migrated;
    let metrics = growthMetrics(network, buildings, settlement);
    if (enforceSecondaryLength(settlement, metrics.secondaryTargetLength)) {
      migrated = true;
      metrics = growthMetrics(network, buildings, settlement);
    }
    if (migrated && previousVisualVersion < 3 && metrics.score > 0 && settlement.generatedStage >= metrics.score) {
      settlement.generatedStage = metrics.score - 1;
      migrated = true;
    }
    if (!metrics.score || settlement.generatedStage >= metrics.score) return { settlement, changed: migrated };
    if ((settlement.roads || []).some(road => !isComplete(road))) return { settlement, changed: migrated };
    const secondaryBudget = metrics.secondaryTargetLength - metrics.secondaryLength;
    if (secondaryBudget <= 1e-7) return { settlement, changed: migrated };
    let candidates = buildCandidates(metrics.groups, network, buildings, settlement);
    if (!candidates.length) return { settlement, changed: migrated };

    const stage = settlement.generatedStage + 1;
    const random = World.rng(World.hashSeed(`${seed}:${options.planetId}:settlement:${stage}`));
    let road = null;
    const tried = new Set();
    for (let attempt = 0; !road && attempt < Config.growth.pathRetries && tried.size < candidates.length; attempt++) {
      const available = candidates.filter(candidate => !tried.has(candidate));
      const candidate = chooseCandidate(available, random);
      tried.add(candidate);
      const targets = connectorTargets(candidate, candidates);
      if (targets.length && random() < Config.growth.connectorChance) {
        const target = targets[Math.floor(random() * targets.length)];
        const connector = createConnector(candidate, target, { network, settlement, baseField, terrain, buildings, stage });
        if (connector && connector.length <= secondaryBudget + 1e-7) road = connector;
      }
      if (!road) road = createBranch(candidate, random, { network, settlement, baseField, terrain,
        buildings, stage, lengthBudget: secondaryBudget });
    }
    if (!road) return { settlement, changed: migrated };
    road = fitRoadToBudget(road, secondaryBudget);
    if (!road) return { settlement, changed: migrated };
    road.id = `${options.planetId}:settlement-road:${nextRoadOrdinal(settlement)}`;
    road.stage = stage;
    road.builtLength = 0;
    road.houses = createResidents(road, random, terrain, baseField.textureScale, buildings);
    settlement.roads.push(road);
    settlement.houses.push(...road.houses);
    settlement.generatedStage = stage;
    return { settlement, changed: true };
  }

  function advance(settlements, deltaSeconds, onComplete = null) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Settlement construction time must be non-negative');
    let changed = false; const completedPlanetIds = new Set();
    for (const settlement of Object.values(settlements || {})) for (const road of settlement.roads || []) {
      const built = Number.isFinite(road.builtLength) ? road.builtLength : 0;
      const next = Math.min(road.length, built + Config.construction.secondarySpeed * deltaSeconds);
      if (next > built) {
        road.builtLength = next; changed = true;
        if (built < road.length - 1e-6 && next >= road.length - 1e-6) completedPlanetIds.add(settlement.planetId);
      }
    }
    if (typeof onComplete === 'function') for (const planetId of completedPlanetIds) onComplete(planetId);
    return changed;
  }

  function assetKey(asset) {
    const houseIndex = HOUSE_ASSETS.indexOf(asset);
    if (houseIndex >= 0) return HOUSE_ASSET_KEYS[houseIndex];
    const districtIndex = DISTRICT_ASSETS.indexOf(asset);
    if (districtIndex >= 0) return DISTRICT_ASSET_KEYS[districtIndex];
    if (HOUSE_ASSET_KEYS.includes(asset) || DISTRICT_ASSET_KEYS.includes(asset)) return asset;
    return asset;
  }

  function resolveAsset(value, assets, keys) {
    if (typeof value !== 'string') return null;
    const keyIndex = keys.indexOf(value);
    if (keyIndex >= 0) return assets[keyIndex];
    // Accept saves made before assets were serialized as compact identifiers.
    const legacyIndex = assets.indexOf(value);
    return legacyIndex >= 0 ? assets[legacyIndex] : null;
  }

  function restore(saved, planetId) {
    const result = create(planetId);
    if (!saved || typeof saved !== 'object' || saved.planetId !== planetId) return result;
    result.version = Number.isInteger(saved.version) ? saved.version : 1;
    result.generatedStage = Number.isInteger(saved.generatedStage)
      ? Math.max(0, Math.min(Config.growth.maxStages, saved.generatedStage)) : 0;
    const roads = Array.isArray(saved.roads) ? saved.roads : [];
    result.roads = roads.flatMap(road => {
      if (!road || typeof road.id !== 'string' || !Array.isArray(road.points) || road.points.length < 2 ||
          !road.points.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y)) ||
          !Number.isFinite(road.length) || road.length <= 0) return [];
      return [{ id: road.id, type: road.type === 'connector' ? 'connector' : 'branch',
        stage: Number.isInteger(road.stage) ? road.stage : null,
        routeId: typeof road.routeId === 'string' ? road.routeId : '',
        anchor: Number.isFinite(road.anchor?.x) && Number.isFinite(road.anchor?.y) ? copyPoint(road.anchor) : null,
        endpoint: Number.isFinite(road.endpoint?.x) && Number.isFinite(road.endpoint?.y) ? copyPoint(road.endpoint) : null,
        parentRoadId: typeof road.parentRoadId === 'string' ? road.parentRoadId : null,
        connectsToRoadId: typeof road.connectsToRoadId === 'string' ? road.connectsToRoadId : null,
        points: road.points.map(copyPoint), length: road.length,
        builtLength: Math.max(0, Math.min(road.length, Number.isFinite(road.builtLength) ? road.builtLength : 0)) }];
    });
    const roadById = new Map(result.roads.map(road => [road.id, road]));
    result.houses = (Array.isArray(saved.houses) ? saved.houses : []).flatMap(house => {
      const asset = resolveAsset(house?.asset, HOUSE_ASSETS, HOUSE_ASSET_KEYS);
      if (!house || typeof house.id !== 'string' || !roadById.has(house.roadId) ||
          !Number.isFinite(house.x) || !Number.isFinite(house.y) || !Number.isFinite(house.rotation) ||
          !Number.isFinite(house.roadDistance) || !asset) return [];
      return [{ ...house, asset }];
    });
    result.districts = (Array.isArray(saved.districts) ? saved.districts : []).flatMap(district => {
      const asset = resolveAsset(district?.asset, DISTRICT_ASSETS, DISTRICT_ASSET_KEYS);
      const mainRoadAsset = district?.mainRoadAsset === true && typeof district.routeId === 'string';
      if (!district || typeof district.id !== 'string' || (!mainRoadAsset && !roadById.has(district.roadId)) ||
          !Number.isFinite(district.x) || !Number.isFinite(district.y) || !Number.isFinite(district.rotation) ||
          !Number.isFinite(district.roadDistance) || !asset) return [];
      const variant = Number.isInteger(district.variant) && district.variant >= 0 && district.variant < 2
        ? district.variant : World.hashSeed(`settlement-district:${district.id}`) % 2;
      return [{ ...district, asset, variant, mainRoadAsset }];
    });
    return result;
  }

  root.OrbitSettlementSimulation = Object.freeze({ create, grow, advance, restore, growthMetrics, assetKey });
})(globalThis);
