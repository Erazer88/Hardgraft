(function (root) {
  'use strict';

  const Config = root.OrbitRoadConfig, Network = root.OrbitRoadNetwork;
  const BuildingData = root.OrbitBuildingData, BuildingPlacement = root.OrbitBuildingPlacement;
  const CostField = root.OrbitRoadCostField, Pathfinder = root.OrbitRoadPathfinder, Geometry = root.OrbitRoadGeometry;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function routeLength(points) {
    return points.slice(1).reduce((length, point, index) => length + distance(points[index], point), 0);
  }

  function directSurfaceDistance(a, b, field) {
    let dx = Math.abs(a.x - b.x);
    if (field.wrapX && field.wrapWorldWidth > 0) {
      dx %= field.wrapWorldWidth;
      dx = Math.min(dx, field.wrapWorldWidth - dx);
    }
    return Math.hypot(dx, b.y - a.y);
  }

  function detourLimit(a, b, field) {
    return directSurfaceDistance(a, b, field) * Config.search.maxDetourRatio + field.cellWorld * 2;
  }

  function buildingFor(endpoint, buildings) {
    return endpoint?.kind === 'building' ? buildings.find(building => building.id === endpoint.buildingId) || null : null;
  }

  function isMarineRoadEndpoint(endpoint, network) {
    if (endpoint?.kind !== 'road' || !endpoint.connection) return false;
    const connection = endpoint?.connection;
    if (connection.kind === 'node') {
      const node = Network.nodeById(network, connection.id);
      return Boolean(node?.connectionMode === 'marine');
    }
    const segment = Network.segmentById(network, connection.id);
    return Boolean(segment?.routeType === 'marine');
  }

  function marinePair(from, to, buildings) {
    const a = buildingFor(from, buildings), b = buildingFor(to, buildings);
    return Boolean((a?.type === 'oil_platform' && b?.type === 'surface_port') ||
      (b?.type === 'oil_platform' && a?.type === 'surface_port'));
  }

  function marinePairAlreadyConnected(network, from, to) {
    const wanted = new Set([from.buildingId, to.buildingId]);
    const groups = new Map();
    for (const segment of network?.segments || []) {
      if (segment.routeType !== 'marine') continue;
      const routeId = segment.routeId || segment.id, group = groups.get(routeId) || [];
      group.push(segment); groups.set(routeId, group);
    }
    for (const segments of groups.values()) {
      const degree = new Map();
      for (const segment of segments) {
        degree.set(segment.from, (degree.get(segment.from) || 0) + 1);
        degree.set(segment.to, (degree.get(segment.to) || 0) + 1);
      }
      const buildingIds = [...degree].filter(([, count]) => count === 1)
        .map(([id]) => Network.nodeById(network, id)?.buildingId).filter(Boolean);
      if (buildingIds.length === 2 && wanted.has(buildingIds[0]) && wanted.has(buildingIds[1])) return true;
    }
    return false;
  }

  function marineEndpoint(endpoint, buildings, network, terrain, textureScale, baseField) {
    const building = buildingFor(endpoint, buildings);
    if (!building) return null;
    const definition = BuildingData.get(building.type);
    const dock = BuildingPlacement.resolveMarineDock(terrain, textureScale, building, definition);
    const existingNode = (network?.nodes || []).find(node => node.buildingId === building.id &&
      node.connectionMode === 'marine');
    const point = existingNode ? { x: existingNode.x, y: existingNode.y } : dock?.point;
    const normal = dock?.normal || BuildingPlacement.marineFacingNormal(building.rotation || 0, definition);
    if (!point || !normal || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const approachDistance = Config.marine.docking.approachCells * baseField.cellWorld;
    const approachPoint = { x: point.x + normal.x * approachDistance,
      y: point.y + normal.y * approachDistance };
    return { ...endpoint, point, normal, approachPoint, connectionMode: 'marine' };
  }

  function landEndpoint(endpoint, buildings) {
    const building = buildingFor(endpoint, buildings);
    if (building?.type !== 'surface_port' || !building.roadPort) return endpoint;
    return { ...endpoint, point: { ...building.roadPort }, connectionMode: 'land' };
  }

  function sameSegmentGap(network, from, to) {
    const a = from?.connection, b = to?.connection;
    if (a?.kind === 'settlement' && b?.kind === 'settlement' && a.id === b.id) {
      return Math.abs(a.roadDistance - b.roadDistance);
    }
    if (a?.kind === 'segment' && b?.kind === 'segment' && a.id === b.id) {
      return Network.distanceAlongSegment(network, a.id, from.point, to.point);
    }
    if (a?.kind === 'node' && b?.kind === 'segment') {
      const segment = Network.segmentById(network, b.id), node = Network.nodeById(network, a.id);
      if (segment && node && (segment.from === node.id || segment.to === node.id)) {
        return Network.distanceAlongSegment(network, b.id, node, to.point);
      }
    }
    if (b?.kind === 'node' && a?.kind === 'segment') return sameSegmentGap(network, to, from);
    if (a?.kind === 'node' && b?.kind === 'node' && a.id === b.id) return 0;
    return Infinity;
  }

  function validateEndpoints({ network, from, to, baseField }) {
    if (!from?.point || !to?.point || ![from.point.x, from.point.y, to.point.x, to.point.y].every(Number.isFinite)) {
      return 'Choisissez deux extrémités valides.';
    }
    if (from.kind === 'building' && to.kind === 'building' && from.buildingId === to.buildingId) {
      return 'Choisissez deux bâtiments différents.';
    }
    if (directSurfaceDistance(from.point, to.point, baseField) < 1) return 'Les deux extrémités sont trop proches.';
    const gap = sameSegmentGap(network, from, to);
    if (gap < Config.network.minimumSameRouteSeparation) {
      return `Écartez les deux points d’au moins ${Config.network.minimumSameRouteSeparation} km sur cette route.`;
    }
    return '';
  }

  function previewBetween({ network, from, to, terrain, baseField, buildings }) {
    if (isMarineRoadEndpoint(from, network) || isMarineRoadEndpoint(to, network)) {
      return { connected: false, reason: 'Une route maritime se relie uniquement entre un port et une plateforme pétrolière.' };
    }
    const fromBuilding = buildingFor(from, buildings), toBuilding = buildingFor(to, buildings);
    const hasOilPlatform = fromBuilding?.type === 'oil_platform' || toBuilding?.type === 'oil_platform';
    const isMarine = marinePair(from, to, buildings);
    if (isMarine && marinePairAlreadyConnected(network, from, to)) {
      return { connected: false, reason: 'Cette plateforme est déjà reliée à ce port.' };
    }
    if (hasOilPlatform && !isMarine) {
      return { connected: false, reason: 'Une plateforme pétrolière doit être reliée à un port de surface.' };
    }
    const routeFrom = isMarine
      ? marineEndpoint(from, buildings, network, terrain, baseField.textureScale, baseField)
      : landEndpoint(from, buildings);
    const routeTo = isMarine
      ? marineEndpoint(to, buildings, network, terrain, baseField.textureScale, baseField)
      : landEndpoint(to, buildings);
    if (!routeFrom || !routeTo) return { connected: false, reason: 'Point de raccordement maritime indisponible.' };
    const problem = validateEndpoints({ network, from: routeFrom, to: routeTo, baseField });
    if (problem) return { connected: false, reason: problem };
    const allowDeepWater = isMarine;
    // Maritime routes use a water-only field, so their A* path is the shortest
    // navigable route. Land routes avoid duplicating existing corridors.
    const field = isMarine
      ? CostField.createMarine(baseField)
      : CostField.withNetwork(baseField, network, buildings, [routeFrom.point, routeTo.point], null,
        { allowDeepWater, avoidExistingRoads: true, builtRoadsOnly: true });
    let route;
    if (isMarine) {
      const portEndpoint = fromBuilding?.type === 'surface_port' ? routeFrom : routeTo;
      const portIsFrom = portEndpoint === routeFrom;
      const pathStart = portIsFrom ? portEndpoint.approachPoint : routeFrom.point;
      const pathEnd = portIsFrom ? routeTo.point : portEndpoint.approachPoint;
      const rawPath = Pathfinder.findPath(field, terrain, pathStart, pathEnd);
      const seaRoute = Geometry.create(rawPath, terrain, baseField.textureScale, buildings,
        { allowDeepWater: true, waterOnly: true, wrapX: true });
      if (seaRoute) {
        const lead = Geometry.resample([portEndpoint.point, portEndpoint.approachPoint],
          Config.geometry.validationSpacing);
        const points = portIsFrom
          ? [...lead, ...seaRoute.points.slice(1)]
          : [...seaRoute.points.slice(0, -1), ...lead.slice().reverse().slice(1)];
        if (Geometry.valid(points, terrain, baseField.textureScale, buildings,
            { allowDeepWater: true, waterOnly: true, wrapX: true })) {
          route = { ...seaRoute, points,
            surfaceTypes: Geometry.surfaceTypes(points, terrain, baseField.textureScale) };
        }
      }
    } else {
      const rawPath = Pathfinder.findPath(field, terrain, routeFrom.point, routeTo.point);
      if (rawPath && routeLength(rawPath) > detourLimit(routeFrom.point, routeTo.point, baseField)) {
        return { connected: false, reason: 'Le tracé ferait un détour trop long. Rapprochez les points ou choisissez une traversée moins profonde.' };
      }
      route = Geometry.create(rawPath, terrain, baseField.textureScale, buildings, { allowDeepWater, wrapX: true });
    }
    if (!route) return { connected: false, reason: 'Aucun tracé valide ne relie ces deux points.' };
    if (!isMarine) {
      if (routeLength(route.points) > detourLimit(routeFrom.point, routeTo.point, baseField)) {
        return { connected: false, reason: 'Le tracé ferait un détour trop long. Rapprochez les points ou choisissez une traversée moins profonde.' };
      }
    }
    return { connected: true, from: routeFrom, to: routeTo, routeType: isMarine ? 'marine' : 'land', ...route };
  }

  function copyNetwork(network) {
    return { ...network,
      nodes: network.nodes.map(node => ({ ...node })),
      segments: network.segments.map(segment => ({ ...segment,
        points: segment.points.map(point => ({ ...point })),
        surfaceTypes: segment.surfaceTypes.slice(),
        constructionPrerequisite: segment.constructionPrerequisite ? { ...segment.constructionPrerequisite } : null })) };
  }

  function attachEndpoint(network, endpoint) {
    if (endpoint.kind === 'building') {
      const connectionMode = endpoint.connectionMode === 'marine' ? 'marine' : 'land';
      const existing = network.nodes.find(node => node.buildingId === endpoint.buildingId &&
        (node.connectionMode || 'land') === connectionMode);
      return existing || Network.addNode(network, { ...endpoint.point,
        type: connectionMode === 'marine' ? 'marine-port' : 'building', buildingId: endpoint.buildingId, connectionMode });
    }
    if (endpoint.kind === 'settlement') {
      return network.nodes.find(node => node.type === 'settlement-connection' && distance(node, endpoint.point) < .5) ||
        Network.addNode(network, { ...endpoint.point, type: 'settlement-connection' });
    }
    const target = endpoint.connection || Network.nearestConnection(network, endpoint.point, null, candidate =>
      candidate.kind === 'node' ? candidate.node.connectionMode !== 'marine' : candidate.segment.routeType !== 'marine');
    if (!target) return null;
    if (target.kind === 'node' && Network.nodeById(network, target.id)?.connectionMode === 'marine') return null;
    if (target.kind === 'segment' && Network.segmentById(network, target.id)?.routeType === 'marine') return null;
    return Network.connectToTarget(network, { ...target, point: endpoint.point });
  }

  function createBetween({ network, from, to, terrain, baseField, buildings, preview = null }) {
    const route = preview?.connected ? preview : previewBetween({ network, from, to, terrain, baseField, buildings });
    if (!route.connected) return route;
    const draft = copyNetwork(network);
    const fromNode = attachEndpoint(draft, route.from || from), toNode = attachEndpoint(draft, route.to || to);
    if (!fromNode || !toNode) return { connected: false, reason: 'Une extrémité ne rejoint plus le réseau.' };
    if (fromNode.id === toNode.id) return { connected: false, reason: 'Les deux extrémités rejoignent déjà le même nœud.' };
    const routeId = `${draft.planetId}:route:${draft.nextRouteId++}`, segments = [], crossings = [];
    const routeType = route.routeType || 'land';
    const routeParts = Geometry.splitAtLongitudeSeam(route.points, route.surfaceTypes,
      (terrain.width - 1) * baseField.textureScale);
    let startNodeId = fromNode.id;
    for (let partIndex = 0; partIndex < routeParts.length; partIndex++) {
      const part = routeParts[partIndex];
      const endNodeId = partIndex === routeParts.length - 1 ? toNode.id :
        Network.addNode(draft, { ...part.points[part.points.length - 1], type: 'longitude-seam',
          connectionMode: routeType === 'marine' ? 'marine' : 'land' }).id;
      const partCrossings = Network.connectRouteCrossings(draft, part.points, routeType);
      crossings.push(...partCrossings);
      const pieces = Network.splitPolylineAtNodes(part.points, part.surfaceTypes, partCrossings, startNodeId, endNodeId);
      for (const piece of pieces) {
        segments.push(Network.addSegment(draft, { ...piece, routeId, routeType,
          constructionPrerequisiteSegmentId: segments.length ? segments[segments.length - 1].id : null }));
      }
      startNodeId = endNodeId;
    }
    if (!segments.length) return { connected: false, reason: 'Le tracé ne contient aucun segment constructible.' };
    const segment = segments[0];
    network.nextNodeId = draft.nextNodeId; network.nextSegmentId = draft.nextSegmentId;
    network.nextRouteId = draft.nextRouteId; network.nodes = draft.nodes; network.segments = draft.segments;
    return { connected: true, segment, segments, crossings, points: route.points,
      surfaceTypes: route.surfaceTypes, routeType: route.routeType || 'land' };
  }

  root.OrbitRoadPlacement = Object.freeze({ previewBetween, createBetween, config: Config });
})(globalThis);
