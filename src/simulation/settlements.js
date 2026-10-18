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
  const DISTRICT_KINDS = Object.freeze(['ligne_droite', 'carrefour_T', 'carrefour_croix']);
  const DISTRICT_ASSETS = Object.freeze(['village', 'ville'].flatMap(scale =>
    DISTRICT_KINDS.map(kind => `assets/settlements/${scale}_${kind}.webp`)));
  const HOUSE_ASSET_KEYS = Object.freeze(['house:maison_01', 'house:maison_02', 'house:maison_03']);
  const DISTRICT_ASSET_KEYS = Object.freeze(['village', 'ville'].flatMap(scale =>
    DISTRICT_KINDS.map(kind => `district:${scale}_${kind}`)));
  const VISUAL_VERSION = 8;
  const INDUSTRIAL_TYPES = new Set(['factory', 'extractor', 'oil_platform']);
  const ROAD_PRODUCTION_TYPES = new Set(['factory', 'extractor']);
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
    return { version: VISUAL_VERSION, planetId, generatedStage: 0,
      roads: [], houses: [], districts: [], neighborhoods: [] };
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

  function connectedIndustryIds(network, buildings) {
    const nodes = new Map((network?.nodes || []).map(node => [node.id, node]));
    const buildingById = new Map((buildings || []).map(building => [building.id, building]));
    const connected = new Set();
    for (const segment of completedRouteGroups(network, true).flatMap(([, segments]) => segments)) {
      for (const nodeId of [segment.from, segment.to]) {
        const node = nodes.get(nodeId), building = buildingById.get(node?.buildingId);
        if (building && INDUSTRIAL_TYPES.has(building.type) && building.constructionState === 'complete') {
          connected.add(building.id);
        }
      }
    }
    return connected;
  }

  function connectedRoadProducers(network, buildings) {
    const connected = connectedIndustryIds(network, buildings);
    return (buildings || []).filter(building => connected.has(building.id) && ROAD_PRODUCTION_TYPES.has(building.type));
  }

  function neighborhoodFor(point, productionBuilding, settlement) {
    let closest = null, closestDistance = Config.growth.neighborhoodAttachmentRadius;
    for (const neighborhood of settlement?.neighborhoods || []) {
      if (neighborhood.productionBuildingId !== productionBuilding.id) continue;
      const current = distance(point, neighborhood);
      if (current < closestDistance) { closest = neighborhood; closestDistance = current; }
    }
    return closest;
  }

  function growthMetrics(network, buildings, settlement) {
    const groups = completedRouteGroups(network), completeSegments = groups.flatMap(([, segments]) => segments);
    const completedLength = completeSegments.reduce((sum, segment) => sum + segment.length, 0);
    const connectedIndustry = connectedIndustryIds(network, buildings);
    const productionBuildings = connectedRoadProducers(network, buildings);
    const secondaryLength = (settlement?.roads || []).filter(isComplete)
      .reduce((sum, road) => sum + road.length, 0);
    const secondaryTargetLength =
      productionBuildings.length * Config.growth.secondaryRoadLengthPerProductionBuilding;
    const activityScore = connectedIndustry.size +
      Math.floor(completedLength / Config.growth.roadLengthPerStage) +
      Math.floor(secondaryLength / Config.growth.secondaryRoadLengthPerStage);
    const score = Math.min(Config.growth.maxStages,
      Math.max(groups.length ? Config.growth.initialRouteStages : 0, activityScore));
    return { score, completedLength, secondaryLength, secondaryTargetLength, productionBuildings, groups };
  }

  function buildCandidates(groups, network, buildings, productionBuildings, settlement) {
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
    const productionById = new Map(productionBuildings.map(building => [building.id, building]));
    const productionFor = point => {
      let closest = null, closestDistance = Config.growth.productionRoadInfluenceRadius;
      for (const building of productionBuildings) {
        const current = distance(point, building);
        if (current < closestDistance) { closest = building; closestDistance = current; }
      }
      return closest;
    };
    for (const host of hosts) {
      if (!Array.isArray(host.points) || host.length < Config.growth.minMainSegmentLength) continue;
      const measures = [];
      const addMeasure = measure => {
        if (!Number.isFinite(measure) || measure <= 0 || measure >= host.length ||
            measures.some(existing => Math.abs(existing - measure) < Config.growth.minAnchorSpacing / 2)) return;
        measures.push(measure);
      };
      for (const fraction of Config.growth.branchCandidateFractions) addMeasure(host.length * fraction);
      if (host.kind === 'main') {
        const fromNode = nodeById.get(host.segment.from), toNode = nodeById.get(host.segment.to);
        if (productionById.has(fromNode?.buildingId)) for (const offset of Config.growth.productionAnchorOffsets) addMeasure(offset);
        if (productionById.has(toNode?.buildingId)) for (const offset of Config.growth.productionAnchorOffsets) addMeasure(host.length - offset);
      }
      measures.sort((a, b) => a - b);
      const endpointNodes = host.kind === 'main'
        ? [nodeById.get(host.segment.from), nodeById.get(host.segment.to)].filter(Boolean) : [];
      for (const measure of measures) {
        const point = pointAtDistance(host.points, measure);
        if (host.kind === 'main') {
          if (endpointNodes.some(node => distance(point, node) < Config.growth.minAnchorNodeDistance)) continue;
        } else if (Math.min(measure, host.length - measure) < Config.growth.branchEndpointClearance) continue;
        if ((buildings || []).some(building => distance(point, building) < Config.growth.minAnchorNodeDistance)) continue;
        if ((settlement.roads || []).some(road => road.anchor && distance(point, road.anchor) < Config.growth.minAnchorSpacing)) continue;
        const productionBuilding = productionFor(point);
        if (!productionBuilding) continue;
        const tangent = tangentAtDistance(host.points, measure);
        const attachedNeighborhood = host.kind === 'secondary'
          ? settlement.neighborhoods.find(neighborhood => neighborhood.id === host.road.neighborhoodId &&
            neighborhood.productionBuildingId === productionBuilding.id) : null;
        candidates.push({ routeId: host.routeId, hostId: host.id, hostKind: host.kind,
          host, measure, point, tangent, productionBuilding,
          neighborhood: attachedNeighborhood || neighborhoodFor(point, productionBuilding, settlement) });
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
      if (!candidate.neighborhood || target.neighborhood?.id !== candidate.neighborhood.id) return false;
      if (target.productionBuilding.id !== candidate.productionBuilding.id) return false;
      if (target.hostId === candidate.hostId) return false;
      if (candidate.hostKind === 'main' && target.hostKind === 'main' &&
          candidate.routeId && candidate.routeId === target.routeId) return false;
      const span = distance(candidate.point, target.point);
      return span >= Config.growth.connectorMinSpan && span <= Math.min(Config.growth.connectorMaxSpan,
        Config.growth.productionRoadInfluenceRadius);
    });
  }

  function staysNearProduction(points, building) {
    return points.every(point => distance(point, building) <= Config.growth.productionRoadInfluenceRadius);
  }

  function createConnector(candidate, target, options) {
    const { network, baseField, terrain, buildings, stage } = options;
    const geometry = pathBetween({ from: candidate.point, to: target.point, network,
      settlement: options.settlement, baseField, terrain, buildings });
    if (!geometry || geometry.length > Config.growth.secondaryRoadMaxLength ||
        !staysNearProduction(geometry.points, candidate.productionBuilding)) return null;
    return { ...geometry, type: 'connector', anchor: copyPoint(candidate.point),
      endpoint: copyPoint(target.point), tangent: { ...candidate.tangent }, routeId: candidate.routeId,
      parentRoadId: candidate.hostKind === 'secondary' ? candidate.hostId : null,
      connectsToRoadId: target.hostKind === 'secondary' ? target.hostId : null,
      startHostId: candidate.hostId, startHostKind: candidate.hostKind,
      startHostRouteId: candidate.routeId, startHostMeasure: candidate.measure,
      endHostId: target.hostId, endHostKind: target.hostKind,
      endHostRouteId: target.routeId, endHostMeasure: target.measure,
      endTangent: { ...target.tangent }, stage };
  }

  function createBranch(candidate, random, options) {
    const { network, settlement, baseField, terrain, buildings, stage } = options;
    const tangent = candidate.tangent, side = random() < .5 ? -1 : 1;
    const normal = { x: -tangent.y * side, y: tangent.x * side };
    const isInitialRoute = stage <= Config.growth.initialRouteStages;
    const minLength = isInitialRoute ? Config.growth.initialBranchMinLength : Config.growth.branchMinLength;
    const maxLength = isInitialRoute ? Config.growth.initialBranchMaxLength : Config.growth.branchMaxLength;
    const budget = Math.min(Config.growth.secondaryRoadMaxLength,
      Number.isFinite(options.lengthBudget) ? Math.max(0, options.lengthBudget) : maxLength);
    if (budget <= 1) return null;
    const cappedMinLength = Math.min(minLength, budget), cappedMaxLength = Math.min(maxLength, budget);
    const branchLength = cappedMinLength + random() * (cappedMaxLength - cappedMinLength);
    const along = (random() - .5) * branchLength * .45;
    const center = { x: candidate.point.x + normal.x * branchLength + tangent.x * along,
      y: candidate.point.y + normal.y * branchLength + tangent.y * along };
    if (distance(center, candidate.productionBuilding) > Config.growth.productionRoadInfluenceRadius) return null;
    if (candidate.neighborhood && distance(center, candidate.neighborhood) > Config.growth.neighborhoodStreetRadius) return null;
    const geometry = pathBetween({ from: candidate.point, to: center, network, settlement,
      baseField, terrain, buildings });
    if (!geometry || geometry.length > Config.growth.secondaryRoadMaxLength ||
        !staysNearProduction(geometry.points, candidate.productionBuilding)) return null;
    return { ...geometry, type: 'branch', anchor: copyPoint(candidate.point),
      endpoint: copyPoint(center), tangent: { ...tangent }, routeId: candidate.routeId,
      parentRoadId: candidate.hostKind === 'secondary' ? candidate.hostId : null,
      startHostId: candidate.hostId, startHostKind: candidate.hostKind,
      startHostRouteId: candidate.routeId, startHostMeasure: candidate.measure,
      endHostId: null, endHostKind: null, endHostRouteId: null, endHostMeasure: null, stage };
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
    const endpoint = copyPoint(points[points.length - 1]);
    return { ...road, points, length,
      builtLength: Math.max(0, Math.min(length, Number.isFinite(road.builtLength) ? road.builtLength : 0)),
      endpoint, toNode: road.toNode ? { ...road.toNode, x: endpoint.x, y: endpoint.y } : road.toNode };
  }

  function pruneUnservedRoads(settlement, productionBuildings) {
    const roads = settlement.roads || [];
    const retained = roads.filter(road => Number.isFinite(road.length) &&
      road.length <= Config.growth.secondaryRoadMaxLength && Array.isArray(road.points) &&
      productionBuildings.some(building => road.points.every(point =>
        distance(point, building) <= Config.growth.productionRoadInfluenceRadius)));
    if (retained.length === roads.length) return false;

    const retainedIds = new Set(retained.map(road => road.id));
    settlement.roads = retained;
    settlement.houses = (settlement.houses || []).filter(house => retainedIds.has(house.roadId));
    settlement.districts = (settlement.districts || []).filter(district => district.mainRoadAsset ||
      retainedIds.has(district.roadId));
    settlement.neighborhoods = (settlement.neighborhoods || []).flatMap(neighborhood => {
      const roadIds = (neighborhood.roadIds || []).filter(id => retainedIds.has(id));
      if (!roadIds.length) return [];
      return [{ ...neighborhood, roadIds,
        collectorRoadId: roadIds.includes(neighborhood.collectorRoadId) ? neighborhood.collectorRoadId : roadIds[0] }];
    });
    for (const road of retained) {
      if (Array.isArray(road.houses)) road.houses = road.houses.filter(house => house.roadDistance <= road.length);
    }
    settlement.generatedStage = Math.min(Number.isInteger(settlement.generatedStage)
      ? settlement.generatedStage : 0, retained.length);
    return true;
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
    settlement.neighborhoods = (settlement.neighborhoods || []).flatMap(neighborhood => {
      const roadIds = (neighborhood.roadIds || []).filter(id => lengthByRoadId.has(id));
      if (!roadIds.length) return [];
      return [{ ...neighborhood, roadIds,
        collectorRoadId: roadIds.includes(neighborhood.collectorRoadId) ? neighborhood.collectorRoadId : roadIds[0] }];
    });
    for (const road of retained) {
      if (Array.isArray(road.houses)) road.houses = road.houses.filter(house => house.roadDistance <= road.length);
      road.builtLength = Math.max(0, Math.min(road.length, Number.isFinite(road.builtLength) ? road.builtLength : 0));
    }
    return true;
  }

  function assetForDistrict(degree, urban = false) {
    const scale = urban ? 'ville' : 'village';
    const kind = degree >= 4 ? 'carrefour_croix' : degree === 3 ? 'carrefour_T' : 'ligne_droite';
    return `assets/settlements/${scale}_${kind}.webp`;
  }

  function districtScale(settlement, neighborhoodId) {
    const neighborhood = (settlement.neighborhoods || []).find(candidate => candidate.id === neighborhoodId);
    if (!neighborhood) return 'village';
    const roads = (settlement.roads || []).filter(road => road.neighborhoodId === neighborhoodId).length;
    const residents = (settlement.houses || []).filter(house => house.neighborhoodId === neighborhoodId).length;
    return roads >= 3 || residents >= 12 ? 'ville' : 'village';
  }

  function isLand(terrain, textureScale, point) {
    if (point.x < 0 || point.y < 0 || point.x > (terrain.width - 1) * textureScale ||
        point.y > (terrain.height - 1) * textureScale) return false;
    return Geometry.elevationAt(terrain, textureScale, point.x, point.y) > terrain.seaLevel;
  }

  function createResidents(road, random, terrain, textureScale, buildings, existingHouses = []) {
    const houses = [], maxDistance = road.length - Config.growth.branchEndpointClearance * .5;
    let roadDistance = Config.growth.houseStartDistance + random() * 5;
    const firstSide = random() < .5 ? -1 : 1, firstAsset = Math.floor(random() * HOUSE_ASSETS.length);
    while (roadDistance < maxDistance) {
      const point = pointAtDistance(road.points, roadDistance);
      const tangent = tangentAtDistance(road.points, roadDistance);
      let position = null, chosenTangent = tangent;
      for (const sideOffset of [firstSide, -firstSide]) {
        const normal = { x: -tangent.y * sideOffset, y: tangent.x * sideOffset };
        const along = (random() - .5) * 2.4;
        const candidate = { x: point.x + tangent.x * along + normal.x * Config.growth.houseSideOffset,
          y: point.y + tangent.y * along + normal.y * Config.growth.houseSideOffset };
        if (!isLand(terrain, textureScale, candidate) || (buildings || []).some(building =>
            distance(candidate, building) < Config.growth.minAnchorNodeDistance)) continue;
        if ([...existingHouses, ...houses].some(house => distance(candidate, house) < Config.growth.houseSideOffset * 1.6)) continue;
        position = candidate;
        if (sideOffset === -firstSide) chosenTangent = { x: -tangent.x, y: -tangent.y };
        break;
      }
      if (position) {
        const assetIndex = (firstAsset + houses.length) % HOUSE_ASSETS.length;
        houses.push({ id: `${road.id}:house:${houses.length + 1}`, roadId: road.id,
          neighborhoodId: road.neighborhoodId || null, roadDistance,
          x: position.x, y: position.y, rotation: Math.atan2(chosenTangent.y, chosenTangent.x),
          asset: HOUSE_ASSETS[assetIndex] });
      }
      roadDistance += Config.growth.houseMinSpacing + random() *
        (Config.growth.houseMaxSpacing - Config.growth.houseMinSpacing);
    }
    return houses;
  }

  function attachmentDegree(settlement, hostId, hostKind, measure) {
    const snap = Config.growth.districtJunctionSnapDistance;
    let attached = 0;
    for (const road of settlement.roads || []) {
      if (road.startHostId === hostId && road.startHostKind === hostKind &&
          Math.abs(road.startHostMeasure - measure) <= snap) attached++;
      if (road.endHostId === hostId && road.endHostKind === hostKind &&
          Math.abs(road.endHostMeasure - measure) <= snap) attached++;
    }
    return Math.min(4, 2 + attached);
  }

  function syncDistrictVisuals(settlement, network) {
    const roads = settlement.roads || [], neighborhoods = settlement.neighborhoods || [];
    const roadById = new Map(roads.map(road => [road.id, road]));
    const visuals = [];
    for (const neighborhood of neighborhoods) {
      const collector = roadById.get(neighborhood.collectorRoadId) ||
        roadById.get(neighborhood.roadIds?.[0]);
      if (!collector) continue;
      const tangent = tangentAtDistance(collector.points, collector.length);
      visuals.push({ id: `${neighborhood.id}:center`, kind: 'center', neighborhoodId: neighborhood.id,
        roadId: collector.id, roadDistance: collector.length, x: neighborhood.x, y: neighborhood.y,
        rotation: Math.atan2(tangent.y, tangent.x), widthWorld: Config.districtVisuals.widthWorld * 1.35,
        variant: World.hashSeed(`${neighborhood.id}:center`) % 2,
        asset: assetForDistrict(2, districtScale(settlement, neighborhood.id)) });
    }
    for (const road of roads) {
      if (!road.anchor || !road.startHostId || !Number.isFinite(road.startHostMeasure)) continue;
      const degree = attachmentDegree(settlement, road.startHostId, road.startHostKind, road.startHostMeasure);
      visuals.push({ id: `${road.id}:junction:start`, kind: 'junction', neighborhoodId: road.neighborhoodId,
        roadId: road.id, roadDistance: 0.01, x: road.anchor.x, y: road.anchor.y,
        rotation: Math.atan2(road.tangent?.y || 0, road.tangent?.x || 1), degree,
        widthWorld: Config.districtVisuals.widthWorld, variant: World.hashSeed(`${road.id}:junction:start`) % 2,
        asset: assetForDistrict(degree, districtScale(settlement, road.neighborhoodId)) });
      if (road.endpoint && road.endHostId && Number.isFinite(road.endHostMeasure)) {
        const endDegree = attachmentDegree(settlement, road.endHostId, road.endHostKind, road.endHostMeasure);
        visuals.push({ id: `${road.id}:junction:end`, kind: 'junction', neighborhoodId: road.neighborhoodId,
          roadId: road.id, roadDistance: Math.max(0, road.length - 0.01), x: road.endpoint.x, y: road.endpoint.y,
          rotation: Math.atan2(road.endTangent?.y ?? road.tangent?.y ?? 0,
            road.endTangent?.x ?? road.tangent?.x ?? 1), degree: endDegree,
          widthWorld: Config.districtVisuals.widthWorld, variant: World.hashSeed(`${road.id}:junction:end`) % 2,
          asset: assetForDistrict(endDegree, districtScale(settlement, road.neighborhoodId)) });
      }
    }

    const nodes = new Map((network?.nodes || []).map(node => [node.id, node]));
    const incident = new Map();
    for (const segment of network?.segments || []) {
      if (segment.routeType === 'marine' || !isComplete(segment)) continue;
      for (const [nodeId, roadDistance] of [[segment.from, 0], [segment.to, segment.length]]) {
        const node = nodes.get(nodeId);
        if (!node) continue;
        const entries = incident.get(nodeId) || [];
        entries.push({ segment, roadDistance }); incident.set(nodeId, entries);
      }
    }
    for (const [nodeId, entries] of incident) {
      const node = nodes.get(nodeId);
      if (!node || node.buildingId || entries.length < 3) continue;
      entries.sort((a, b) => String(a.segment.id).localeCompare(String(b.segment.id)));
      const { segment, roadDistance } = entries[0];
      const tangent = tangentAtDistance(segment.points, roadDistance === 0 ? 0 : segment.length - .01);
      visuals.push({ id: `main-junction:${nodeId}`, kind: 'junction', roadId: segment.id,
        routeId: segment.routeId || segment.id, mainRoadAsset: true, roadDistance,
        x: node.x, y: node.y, rotation: Math.atan2(tangent.y, tangent.x), degree: Math.min(4, entries.length),
        widthWorld: Config.districtVisuals.widthWorld, variant: World.hashSeed(`main-junction:${nodeId}`) % 2,
        asset: assetForDistrict(entries.length, entries.length >= 4) });
    }

    const signature = items => JSON.stringify(items.map(item => [item.id, item.roadId, item.roadDistance,
      item.x, item.y, item.rotation, item.variant, item.asset]));
    if (signature(settlement.districts || []) === signature(visuals)) return false;
    settlement.districts = visuals;
    return true;
  }

  function ensureNeighborhoods(settlement, options) {
    if (!Array.isArray(settlement.neighborhoods)) settlement.neighborhoods = [];
    let changed = false;
    const producers = connectedRoadProducers(options.network, options.buildings);
    const roadsByNeighborhood = new Map();
    for (const road of settlement.roads || []) {
      let neighborhood = settlement.neighborhoods.find(candidate => candidate.id === road.neighborhoodId);
      if (!neighborhood) {
        const point = road.endpoint || road.points?.[road.points.length - 1];
        let producer = null, nearest = Config.growth.productionRoadInfluenceRadius;
        for (const candidate of producers) {
          const current = distance(point || candidate, candidate);
          if (current < nearest) { producer = candidate; nearest = current; }
        }
        if (!producer) continue;
        neighborhood = settlement.neighborhoods.filter(candidate =>
          candidate.productionBuildingId === producer.id)
          .sort((a, b) => distance(a, point) - distance(b, point))[0];
        if (!neighborhood) {
          const id = `${settlement.planetId}:neighborhood:${producer.id}:legacy:${settlement.neighborhoods.length + 1}`;
          neighborhood = { id, productionBuildingId: producer.id, x: point.x, y: point.y,
            collectorRoadId: road.id, roadIds: [], routeId: road.routeId || '' };
          settlement.neighborhoods.push(neighborhood);
        }
        road.neighborhoodId = neighborhood.id;
        if (!road.roadClass) road.roadClass = road.parentRoadId ? 'local' : 'collector';
        changed = true;
      }
      const roadIds = roadsByNeighborhood.get(neighborhood.id) || [];
      roadIds.push(road.id); roadsByNeighborhood.set(neighborhood.id, roadIds);
    }
    const filtered = settlement.neighborhoods.flatMap(neighborhood => {
      const roadIds = roadsByNeighborhood.get(neighborhood.id) || [];
      if (!roadIds.length) return [];
      const collectorRoadId = roadIds.includes(neighborhood.collectorRoadId)
        ? neighborhood.collectorRoadId : roadIds[0];
      const collector = (settlement.roads || []).find(road => road.id === collectorRoadId);
      const center = collector?.endpoint || collector?.points?.[collector.points.length - 1];
      if (neighborhood.collectorRoadId !== collectorRoadId ||
          JSON.stringify(neighborhood.roadIds || []) !== JSON.stringify(roadIds) ||
          (center && (neighborhood.x !== center.x || neighborhood.y !== center.y))) changed = true;
      return [{ ...neighborhood, collectorRoadId, roadIds,
        ...(center ? { x: center.x, y: center.y } : {}) }];
    });
    if (filtered.length !== settlement.neighborhoods.length) changed = true;
    settlement.neighborhoods = filtered;
    return changed;
  }

  function migrateSettlementVisuals(settlement, options) {
    const roads = settlement.roads || [];
    if (settlement.version >= VISUAL_VERSION &&
        Array.isArray(settlement.houses) && Array.isArray(settlement.districts) &&
        Array.isArray(settlement.neighborhoods)) return false;
    settlement.houses = []; settlement.districts = [];
    ensureNeighborhoods(settlement, options);
    for (let index = 0; index < roads.length; index++) {
      const road = roads[index];
      const stageMatch = road.id.match(/settlement-road:(\d+)$/);
      if (!Number.isInteger(road.stage)) road.stage = stageMatch ? Number(stageMatch[1]) : index + 1;
      const random = World.rng(World.hashSeed(`${options.seed}:${options.planetId}:settlement:visual:${road.id}`));
      const updatedHouses = createResidents(road, random, options.terrain, options.baseField.textureScale,
        options.buildings, settlement.houses);
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

  function nextNeighborhoodId(settlement, planetId, producerId) {
    const ordinal = (settlement.neighborhoods || []).filter(neighborhood =>
      neighborhood.productionBuildingId === producerId).length + 1;
    return `${planetId}:neighborhood:${producerId}:${ordinal}`;
  }

  function grow(settlement, options) {
    const { seed, network, buildings, baseField, terrain } = options;
    if (!settlement || settlement.planetId !== options.planetId) settlement = create(options.planetId);
    const previousVisualVersion = settlement.version || 1;
    let migrated = migrateSettlementVisuals(settlement, options);
    migrated = ensureNeighborhoods(settlement, options) || migrated;
    migrated = pruneUnservedRoads(settlement, connectedRoadProducers(network, buildings)) || migrated;
    migrated = ensureNeighborhoods(settlement, options) || migrated;
    let metrics = growthMetrics(network, buildings, settlement);
    if (enforceSecondaryLength(settlement, metrics.secondaryTargetLength)) {
      migrated = true;
      migrated = ensureNeighborhoods(settlement, options) || migrated;
      metrics = growthMetrics(network, buildings, settlement);
    }
    migrated = syncDistrictVisuals(settlement, network) || migrated;
    if (migrated && previousVisualVersion < 3 && metrics.score > 0 && settlement.generatedStage >= metrics.score) {
      settlement.generatedStage = metrics.score - 1;
      migrated = true;
    }
    if (!metrics.score || settlement.generatedStage >= metrics.score) return { settlement, changed: migrated };
    if ((settlement.roads || []).some(road => !isComplete(road))) return { settlement, changed: migrated };
    const secondaryBudget = metrics.secondaryTargetLength - metrics.secondaryLength;
    if (secondaryBudget <= 1e-7) return { settlement, changed: migrated };
    let candidates = buildCandidates(metrics.groups, network, buildings, metrics.productionBuildings, settlement);
    if (!candidates.length) return { settlement, changed: migrated };

    const stage = settlement.generatedStage + 1;
    const random = World.rng(World.hashSeed(`${seed}:${options.planetId}:settlement:${stage}`));
    let road = null, chosenCandidate = null;
    const tried = new Set();
    for (let attempt = 0; !road && attempt < Config.growth.pathRetries && tried.size < candidates.length; attempt++) {
      const available = candidates.filter(candidate => !tried.has(candidate));
      const candidate = chooseCandidate(available, random);
      tried.add(candidate);
      const targets = connectorTargets(candidate, candidates);
      if (targets.length && random() < Config.growth.connectorChance) {
        const target = targets[Math.floor(random() * targets.length)];
        const connector = createConnector(candidate, target, { network, settlement, baseField, terrain, buildings, stage });
        if (connector && connector.length <= secondaryBudget + 1e-7) {
          road = connector; chosenCandidate = candidate;
        }
      }
      if (!road) {
        road = createBranch(candidate, random, { network, settlement, baseField, terrain,
          buildings, stage, lengthBudget: secondaryBudget });
        if (road) chosenCandidate = candidate;
      }
    }
    if (!road) return { settlement, changed: migrated };
    road = fitRoadToBudget(road, secondaryBudget);
    if (!road) return { settlement, changed: migrated };
    road.id = `${options.planetId}:settlement-road:${nextRoadOrdinal(settlement)}`;
    road.stage = stage;
    road.builtLength = 0;
    let neighborhood = chosenCandidate.neighborhood, createdNeighborhood = false;
    if (!neighborhood) {
      const neighborhoodId = nextNeighborhoodId(settlement, options.planetId,
        chosenCandidate.productionBuilding.id);
      neighborhood = { id: neighborhoodId, productionBuildingId: chosenCandidate.productionBuilding.id,
        x: road.endpoint.x, y: road.endpoint.y, routeId: road.routeId,
        collectorRoadId: road.id, roadIds: [] };
      settlement.neighborhoods.push(neighborhood);
      createdNeighborhood = true;
    }
    road.neighborhoodId = neighborhood.id;
    road.roadClass = road.startHostKind === 'main' || road.endHostKind === 'main' ? 'collector' : 'local';
    const startNodeKind = road.startHostKind === 'main' ? 'main' : 'street';
    road.fromNode = { id: `${startNodeKind}:${road.startHostId}:${Math.round(road.startHostMeasure * 10)}`,
      kind: startNodeKind,
      hostId: road.startHostId, routeId: road.startHostRouteId, measure: road.startHostMeasure,
      x: road.anchor.x, y: road.anchor.y };
    road.toNode = road.endHostId ? { id: `${road.endHostKind === 'main' ? 'main' : 'street'}:${road.endHostId}:${Math.round(road.endHostMeasure * 10)}`,
      kind: road.endHostKind === 'main' ? 'main' : 'street',
      hostId: road.endHostId, routeId: road.endHostRouteId, measure: road.endHostMeasure,
      x: road.endpoint.x, y: road.endpoint.y } :
      createdNeighborhood
        ? { id: neighborhood.id, kind: 'neighborhood', neighborhoodId: neighborhood.id,
          x: road.endpoint.x, y: road.endpoint.y }
        : { id: `${neighborhood.id}:end:${road.id}`, kind: 'street-end', neighborhoodId: neighborhood.id,
          x: road.endpoint.x, y: road.endpoint.y };
    road.houses = createResidents(road, random, terrain, baseField.textureScale, buildings, settlement.houses);
    settlement.roads.push(road);
    settlement.houses.push(...road.houses);
    neighborhood.roadIds.push(road.id);
    if (!neighborhood.collectorRoadId) neighborhood.collectorRoadId = road.id;
    settlement.generatedStage = stage;
    syncDistrictVisuals(settlement, network);
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
        roadClass: road.roadClass === 'local' ? 'local' :
          road.roadClass === 'collector' ? 'collector' : road.parentRoadId ? 'local' : 'collector',
        neighborhoodId: typeof road.neighborhoodId === 'string' ? road.neighborhoodId : null,
        anchor: Number.isFinite(road.anchor?.x) && Number.isFinite(road.anchor?.y) ? copyPoint(road.anchor) : null,
        endpoint: Number.isFinite(road.endpoint?.x) && Number.isFinite(road.endpoint?.y) ? copyPoint(road.endpoint) : null,
        parentRoadId: typeof road.parentRoadId === 'string' ? road.parentRoadId : null,
        connectsToRoadId: typeof road.connectsToRoadId === 'string' ? road.connectsToRoadId : null,
        startHostId: typeof road.startHostId === 'string' ? road.startHostId : null,
        startHostKind: road.startHostKind === 'secondary' ? 'secondary' : 'main',
        startHostRouteId: typeof road.startHostRouteId === 'string' ? road.startHostRouteId : '',
        startHostMeasure: Number.isFinite(road.startHostMeasure) ? road.startHostMeasure : null,
        endHostId: typeof road.endHostId === 'string' ? road.endHostId : null,
        endHostKind: road.endHostKind === 'secondary' ? 'secondary' : road.endHostKind === 'main' ? 'main' : null,
        endHostRouteId: typeof road.endHostRouteId === 'string' ? road.endHostRouteId : null,
        endHostMeasure: Number.isFinite(road.endHostMeasure) ? road.endHostMeasure : null,
        tangent: Number.isFinite(road.tangent?.x) && Number.isFinite(road.tangent?.y)
          ? { x: road.tangent.x, y: road.tangent.y } : { x: 1, y: 0 },
        endTangent: Number.isFinite(road.endTangent?.x) && Number.isFinite(road.endTangent?.y)
          ? { x: road.endTangent.x, y: road.endTangent.y } : null,
        fromNode: road.fromNode && typeof road.fromNode === 'object' ? { ...road.fromNode } : null,
        toNode: road.toNode && typeof road.toNode === 'object' ? { ...road.toNode } : null,
        points: road.points.map(copyPoint), length: road.length,
        builtLength: Math.max(0, Math.min(road.length, Number.isFinite(road.builtLength) ? road.builtLength : 0)) }];
    });
    const roadById = new Map(result.roads.map(road => [road.id, road]));
    result.houses = (Array.isArray(saved.houses) ? saved.houses : []).flatMap(house => {
      const asset = resolveAsset(house?.asset, HOUSE_ASSETS, HOUSE_ASSET_KEYS);
      if (!house || typeof house.id !== 'string' || !roadById.has(house.roadId) ||
          !Number.isFinite(house.x) || !Number.isFinite(house.y) || !Number.isFinite(house.rotation) ||
          !Number.isFinite(house.roadDistance) || !asset) return [];
      return [{ ...house, neighborhoodId: typeof house.neighborhoodId === 'string' ? house.neighborhoodId : null, asset }];
    });
    result.districts = (Array.isArray(saved.districts) ? saved.districts : []).flatMap(district => {
      const asset = resolveAsset(district?.asset, DISTRICT_ASSETS, DISTRICT_ASSET_KEYS);
      const mainRoadAsset = district?.mainRoadAsset === true && typeof district.routeId === 'string';
      if (!district || typeof district.id !== 'string' || (!mainRoadAsset && !roadById.has(district.roadId)) ||
          !Number.isFinite(district.x) || !Number.isFinite(district.y) || !Number.isFinite(district.rotation) ||
          !Number.isFinite(district.roadDistance) || !asset) return [];
      const variant = Number.isInteger(district.variant) && district.variant >= 0 && district.variant < 2
        ? district.variant : World.hashSeed(`settlement-district:${district.id}`) % 2;
      return [{ ...district, asset, variant, mainRoadAsset,
        neighborhoodId: typeof district.neighborhoodId === 'string' ? district.neighborhoodId : null,
        kind: district.kind === 'junction' ? 'junction' : 'center' }];
    });
    result.neighborhoods = (Array.isArray(saved.neighborhoods) ? saved.neighborhoods : []).flatMap(neighborhood => {
      if (!neighborhood || typeof neighborhood.id !== 'string' ||
          typeof neighborhood.productionBuildingId !== 'string' ||
          !Number.isFinite(neighborhood.x) || !Number.isFinite(neighborhood.y)) return [];
      return [{ id: neighborhood.id, productionBuildingId: neighborhood.productionBuildingId,
        x: neighborhood.x, y: neighborhood.y, routeId: typeof neighborhood.routeId === 'string' ? neighborhood.routeId : '',
        collectorRoadId: typeof neighborhood.collectorRoadId === 'string' ? neighborhood.collectorRoadId : null,
        roadIds: Array.isArray(neighborhood.roadIds) ? neighborhood.roadIds.filter(id => roadById.has(id)) : [] }];
    });
    return result;
  }

  root.OrbitSettlementSimulation = Object.freeze({ create, grow, advance, restore, growthMetrics, assetKey,
    districtAssetForTopology: assetForDistrict,
    modelAssets: Object.freeze({ houses: HOUSE_ASSETS, districts: DISTRICT_ASSETS }) });
})(globalThis);
