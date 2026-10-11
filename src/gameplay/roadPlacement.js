(function (root) {
  'use strict';

  const Config = root.OrbitRoadConfig, Network = root.OrbitRoadNetwork;
  const CostField = root.OrbitRoadCostField, Pathfinder = root.OrbitRoadPathfinder, Geometry = root.OrbitRoadGeometry;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

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

  function marineEndpoint(endpoint, buildings) {
    const building = buildingFor(endpoint, buildings), point = building?.waterPort;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return { ...endpoint, point: { ...point }, connectionMode: 'marine' };
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

  function validateEndpoints({ network, from, to }) {
    if (!from?.point || !to?.point || ![from.point.x, from.point.y, to.point.x, to.point.y].every(Number.isFinite)) {
      return 'Choisissez deux extrémités valides.';
    }
    if (from.kind === 'building' && to.kind === 'building' && from.buildingId === to.buildingId) {
      return 'Choisissez deux bâtiments différents.';
    }
    if (distance(from.point, to.point) < 1) return 'Les deux extrémités sont trop proches.';
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
    if (hasOilPlatform && !isMarine) {
      return { connected: false, reason: 'Une plateforme pétrolière doit être reliée à un port de surface.' };
    }
    const routeFrom = isMarine ? marineEndpoint(from, buildings) : from;
    const routeTo = isMarine ? marineEndpoint(to, buildings) : to;
    if (!routeFrom || !routeTo) return { connected: false, reason: 'Point de raccordement maritime indisponible.' };
    const problem = validateEndpoints({ network, from: routeFrom, to: routeTo });
    if (problem) return { connected: false, reason: problem };
    const allowDeepWater = isMarine;
    // Maritime routes use a water-only field, so their A* path is the shortest
    // navigable route. Land routes avoid duplicating existing corridors.
    const field = isMarine
      ? CostField.createMarine(baseField)
      : CostField.withNetwork(baseField, network, buildings, [routeFrom.point, routeTo.point], null,
        { allowDeepWater, avoidExistingRoads: true, builtRoadsOnly: true });
    const rawPath = Pathfinder.findPath(field, terrain, routeFrom.point, routeTo.point);
    const route = Geometry.create(rawPath, terrain, baseField.textureScale, buildings,
      { allowDeepWater, waterOnly: isMarine });
    if (!route) return { connected: false, reason: 'Aucun tracé valide ne relie ces deux points.' };
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
    const crossings = Network.connectRouteCrossings(draft, route.points, route.routeType || 'land');
    const pieces = Network.splitPolylineAtNodes(route.points, route.surfaceTypes, crossings, fromNode.id, toNode.id);
    const routeId = `${draft.planetId}:route:${draft.nextRouteId++}`, segments = [];
    for (const piece of pieces) {
      segments.push(Network.addSegment(draft, { ...piece, routeId, routeType: route.routeType || 'land',
        constructionPrerequisiteSegmentId: segments.length ? segments[segments.length - 1].id : null }));
    }
    const segment = segments[0];
    network.nextNodeId = draft.nextNodeId; network.nextSegmentId = draft.nextSegmentId;
    network.nextRouteId = draft.nextRouteId; network.nodes = draft.nodes; network.segments = draft.segments;
    return { connected: true, segment, segments, crossings, points: route.points,
      surfaceTypes: route.surfaceTypes, routeType: route.routeType || 'land' };
  }

  root.OrbitRoadPlacement = Object.freeze({ previewBetween, createBetween, config: Config });
})(globalThis);
