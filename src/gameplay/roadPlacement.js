(function (root) {
  'use strict';

  const Config = root.OrbitRoadConfig, Network = root.OrbitRoadNetwork;
  const CostField = root.OrbitRoadCostField, Pathfinder = root.OrbitRoadPathfinder, Geometry = root.OrbitRoadGeometry;

  function isPortNode(node, buildings) {
    return Boolean(node && buildings.find(building => building.id === node.buildingId)?.type === 'surface_port');
  }

  function portRoute(fromPort, toPort) { return Boolean(fromPort && toPort); }

  function connectBuilding({ network, building, definition, terrain, baseField, buildings }) {
    if (!definition?.roadRequired) return { connected: false, reason: 'no-road-required' };
    const port = building.roadPort || { x: building.x, y: building.y };
    const target = Network.nearestConnection(network, port);
    if (!target) {
      const node = Network.addNode(network, { ...port, type: 'building', buildingId: building.id });
      return { connected: false, root: true, node };
    }

    const allowDeepWater = definition.id === 'surface_port' && target.kind === 'node' && isPortNode(target.node, buildings);
    const field = CostField.withNetwork(baseField, network, buildings, [port, target.point], null, { allowDeepWater });
    const rawPath = Pathfinder.findPath(field, terrain, port, target.point);
    const route = Geometry.create(rawPath, terrain, baseField.textureScale, buildings, { allowDeepWater });
    if (!route) return { connected: false, reason: 'no-valid-route' };

    const targetNode = Network.connectToTarget(network, target);
    if (!targetNode) return { connected: false, reason: 'target-lost' };
    const fromNode = Network.addNode(network, { ...port, type: 'building', buildingId: building.id });
    const segment = Network.addSegment(network, { from: fromNode.id, to: targetNode.id,
      points: route.points, surfaceTypes: route.surfaceTypes });
    return { connected: true, node: fromNode, target: targetNode, segment, points: route.points };
  }

  function modifySegment({ network, segmentId, terrain, baseField, buildings }) {
    const segment = Network.segmentById(network, segmentId);
    if (!segment) return { changed: false, reason: 'segment-not-found' };
    const from = Network.nodeById(network, segment.from), to = Network.nodeById(network, segment.to);
    if (!from || !to) return { changed: false, reason: 'endpoint-not-found' };
    const allowDeepWater = portRoute(isPortNode(from, buildings), isPortNode(to, buildings));
    const field = CostField.withNetwork(baseField, network, buildings, [from, to], segmentId, { allowDeepWater });
    const rawPath = Pathfinder.findPath(field, terrain, from, to);
    const route = Geometry.create(rawPath, terrain, baseField.textureScale, buildings, { allowDeepWater });
    if (!route) return { changed: false, reason: 'no-valid-route' };
    Network.replaceSegmentPoints(network, segmentId, route.points, route.surfaceTypes);
    return { changed: true, segment };
  }

  function createBetween({ network, from, to, terrain, baseField, buildings }) {
    if (!from || !to || from.id === to.id) return { connected: false, reason: 'invalid-endpoints' };
    const allowDeepWater = portRoute(isPortNode(from, buildings), isPortNode(to, buildings));
    const field = CostField.withNetwork(baseField, network, buildings, [from, to], null, { allowDeepWater });
    const rawPath = Pathfinder.findPath(field, terrain, from, to);
    const route = Geometry.create(rawPath, terrain, baseField.textureScale, buildings, { allowDeepWater });
    if (!route) return { connected: false, reason: 'no-valid-route' };
    const segment = Network.addSegment(network, { from: from.id, to: to.id,
      points: route.points, surfaceTypes: route.surfaceTypes });
    return { connected: true, segment, points: route.points };
  }

  root.OrbitRoadPlacement = Object.freeze({ connectBuilding, modifySegment, createBetween, config: Config });
})(globalThis);
