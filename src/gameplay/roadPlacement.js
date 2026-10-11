(function (root) {
  'use strict';

  const Config = root.OrbitRoadConfig, Network = root.OrbitRoadNetwork;
  const CostField = root.OrbitRoadCostField, Pathfinder = root.OrbitRoadPathfinder, Geometry = root.OrbitRoadGeometry;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function buildingFor(endpoint, buildings) {
    return endpoint?.kind === 'building' ? buildings.find(building => building.id === endpoint.buildingId) || null : null;
  }

  function endpointIsPort(endpoint, network, buildings) {
    const building = buildingFor(endpoint, buildings);
    if (building) return building.type === 'surface_port';
    const connection = endpoint?.connection;
    if (!connection) return false;
    if (connection.kind === 'node') {
      const node = Network.nodeById(network, connection.id);
      return Boolean(node && buildings.find(item => item.id === node.buildingId)?.type === 'surface_port');
    }
    const segment = Network.segmentById(network, connection.id);
    if (!segment?.surfaceTypes?.some(Boolean)) return false;
    return [segment.from, segment.to].some(id => {
      const node = Network.nodeById(network, id);
      return Boolean(node && buildings.find(item => item.id === node.buildingId)?.type === 'surface_port');
    });
  }

  function sameSegmentGap(network, from, to) {
    const a = from?.connection, b = to?.connection;
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
    const problem = validateEndpoints({ network, from, to });
    if (problem) return { connected: false, reason: problem };
    const allowDeepWater = endpointIsPort(from, network, buildings) && endpointIsPort(to, network, buildings);
    // The player already chose both junctions. Penalize the existing built
    // road corridors so a new connector does not simply redraw the same line.
    const field = CostField.withNetwork(baseField, network, buildings, [from.point, to.point], null,
      { allowDeepWater, avoidExistingRoads: true, builtRoadsOnly: true });
    const rawPath = Pathfinder.findPath(field, terrain, from.point, to.point);
    const route = Geometry.create(rawPath, terrain, baseField.textureScale, buildings, { allowDeepWater });
    if (!route) return { connected: false, reason: 'Aucun tracé valide ne relie ces deux points.' };
    return { connected: true, from, to, ...route };
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
      const existing = network.nodes.find(node => node.buildingId === endpoint.buildingId);
      return existing || Network.addNode(network, { ...endpoint.point, type: 'building', buildingId: endpoint.buildingId });
    }
    const target = Network.nearestConnection(network, endpoint.point);
    if (!target || target.distance > .05) return null;
    return Network.connectToTarget(network, target);
  }

  function createBetween({ network, from, to, terrain, baseField, buildings, preview = null }) {
    const route = preview?.connected ? preview : previewBetween({ network, from, to, terrain, baseField, buildings });
    if (!route.connected) return route;
    const draft = copyNetwork(network);
    const fromNode = attachEndpoint(draft, from), toNode = attachEndpoint(draft, to);
    if (!fromNode || !toNode) return { connected: false, reason: 'Une extrémité ne rejoint plus le réseau.' };
    if (fromNode.id === toNode.id) return { connected: false, reason: 'Les deux extrémités rejoignent déjà le même nœud.' };
    const segment = Network.addSegment(draft, { from: fromNode.id, to: toNode.id,
      points: route.points, surfaceTypes: route.surfaceTypes });
    network.nextNodeId = draft.nextNodeId; network.nextSegmentId = draft.nextSegmentId;
    network.nodes = draft.nodes; network.segments = draft.segments;
    return { connected: true, segment, points: route.points, surfaceTypes: route.surfaceTypes };
  }

  root.OrbitRoadPlacement = Object.freeze({ previewBetween, createBetween, config: Config });
})(globalThis);
