(function (root) {
  'use strict';

  const Config = root.OrbitRoadConfig, Network = root.OrbitRoadNetwork;
  const CostField = root.OrbitRoadCostField, Pathfinder = root.OrbitRoadPathfinder, Geometry = root.OrbitRoadGeometry;

  function isPortNode(node, buildings) {
    return Boolean(node && buildings.find(building => building.id === node.buildingId)?.type === 'surface_port');
  }

  function portRoute(fromPort, toPort) { return Boolean(fromPort && toPort); }

  function isPortConnection(candidate, buildings, network) {
    if (!candidate) return false;
    if (candidate.kind === 'node') return isPortNode(candidate.node, buildings);
    const endpoints = [Network.nodeById(network, candidate.segment.from), Network.nodeById(network, candidate.segment.to)];
    return Boolean(candidate.segment.surfaceTypes?.some(Boolean) && endpoints.some(node => isPortNode(node, buildings)));
  }

  function sameTarget(a, b) { return Boolean(a && b && a.kind === b.kind && a.id === b.id); }

  function pointAtDistance(points, targetDistance) {
    let travelled = 0;
    for (let edgeIndex = 0; edgeIndex < points.length - 1; edgeIndex++) {
      const a = points[edgeIndex], b = points[edgeIndex + 1];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length <= 1e-9) continue;
      if (travelled + length < targetDistance) { travelled += length; continue; }
      const t = Math.max(0, Math.min(1, (targetDistance - travelled) / length));
      return { point: { x: a.x + dx * t, y: a.y + dy * t }, edgeIndex, t,
        tangent: { x: dx / length, y: dy / length } };
    }
    return null;
  }

  function isEligibleBranchAxis(candidate, primaryTarget, departure, branchConfig) {
    if (!candidate || !candidate.point || sameTarget(candidate, primaryTarget)) return false;
    const targetDistance = Math.hypot(candidate.point.x - departure.point.x, candidate.point.y - departure.point.y);
    const axisSeparation = Math.hypot(candidate.point.x - primaryTarget.point.x, candidate.point.y - primaryTarget.point.y);
    if (targetDistance < branchConfig.minimumLength || targetDistance > branchConfig.maximumTargetDistance ||
        axisSeparation < branchConfig.minimumAxisSeparation) return false;
    const dx = candidate.point.x - departure.point.x, dy = candidate.point.y - departure.point.y;
    const length = Math.hypot(dx, dy);
    if (!length) return false;
    const cosine = Math.max(-1, Math.min(1, (departure.tangent.x * dx + departure.tangent.y * dy) / length));
    const angleDegrees = Math.acos(cosine) * 180 / Math.PI;
    return angleDegrees >= branchConfig.minimumAngleDegrees &&
      angleDegrees <= 180 - branchConfig.minimumAngleDegrees;
  }

  function planSecondaryBranch({ network, primaryRoute, primaryTarget, terrain, baseField, buildings, definition }) {
    const branchConfig = Config.network.secondaryBranch;
    if (!branchConfig || Network.lengthOf(primaryRoute.points) < branchConfig.offsetFromPort + branchConfig.minimumMainRun) return null;
    const departure = pointAtDistance(primaryRoute.points, branchConfig.offsetFromPort);
    if (!departure) return null;
    const eligible = candidate => isEligibleBranchAxis(candidate, primaryTarget, departure, branchConfig);
    const target = Network.nearestConnection(network, departure.point, null, eligible);
    if (!target) return null;
    const allowDeepWater = definition.id === 'surface_port' && isPortConnection(target, buildings, network);
    const field = CostField.withNetwork(baseField, network, buildings, [departure.point, target.point], null, { allowDeepWater });
    const rawPath = Pathfinder.findPath(field, terrain, departure.point, target.point);
    const route = Geometry.create(rawPath, terrain, baseField.textureScale, buildings, { allowDeepWater });
    if (!route) return null;

    const acceptsContact = candidate => eligible(candidate) &&
      (!allowDeepWater || isPortConnection(candidate, buildings, network));
    const contact = Network.firstContact(network, route.points, Config.network.snapDistance, acceptsContact);
    if (contact && Geometry.valid(contact.points, terrain, baseField.textureScale, buildings, { allowDeepWater }) &&
        Network.lengthOf(contact.points) >= branchConfig.minimumLength) {
      route.points = contact.points;
      route.surfaceTypes = Geometry.surfaceTypes(contact.points, terrain, baseField.textureScale);
      return { departure, target: contact.target, points: route.points, surfaceTypes: route.surfaceTypes };
    }
    if (Network.lengthOf(route.points) < branchConfig.minimumLength) return null;
    return { departure, target, points: route.points, surfaceTypes: route.surfaceTypes };
  }

  function connectBuilding({ network, building, definition, terrain, baseField, buildings }) {
    if (!definition?.roadRequired) return { connected: false, reason: 'no-road-required' };
    const port = building.roadPort || { x: building.x, y: building.y };
    let target = Network.nearestConnection(network, port);
    if (!target) {
      const node = Network.addNode(network, { ...port, type: 'building', buildingId: building.id });
      return { connected: false, root: true, node };
    }

    const allowDeepWater = definition.id === 'surface_port' && isPortConnection(target, buildings, network);
    const field = CostField.withNetwork(baseField, network, buildings, [port, target.point], null, { allowDeepWater });
    const rawPath = Pathfinder.findPath(field, terrain, port, target.point);
    const route = Geometry.create(rawPath, terrain, baseField.textureScale, buildings, { allowDeepWater });
    if (!route) return { connected: false, reason: 'no-valid-route' };

    const acceptContact = allowDeepWater ? candidate => isPortConnection(candidate, buildings, network) : null;
    const contact = Network.firstContact(network, route.points, Config.network.snapDistance, acceptContact);
    if (contact && Geometry.valid(contact.points, terrain, baseField.textureScale, buildings, { allowDeepWater })) {
      target = contact.target;
      route.points = contact.points;
      route.surfaceTypes = Geometry.surfaceTypes(contact.points, terrain, baseField.textureScale);
    }

    const secondary = planSecondaryBranch({ network, primaryRoute: route, primaryTarget: target,
      terrain, baseField, buildings, definition });
    const targetNode = Network.connectToTarget(network, target);
    if (!targetNode) return { connected: false, reason: 'target-lost' };
    const fromNode = Network.addNode(network, { ...port, type: 'building', buildingId: building.id });
    const segment = Network.addSegment(network, { from: fromNode.id, to: targetNode.id,
      points: route.points, surfaceTypes: route.surfaceTypes });
    let secondarySegment = null, branchNode = null;
    if (secondary) {
      const secondaryTargetNode = Network.connectToTarget(network, secondary.target);
      if (secondaryTargetNode) {
        branchNode = Network.connectToTarget(network, { kind: 'segment', id: segment.id,
          edgeIndex: secondary.departure.edgeIndex, t: secondary.departure.t, point: secondary.departure.point });
        if (branchNode) secondarySegment = Network.addSegment(network, { from: branchNode.id, to: secondaryTargetNode.id,
          points: secondary.points, surfaceTypes: secondary.surfaceTypes, roadClass: 'secondary',
          constructionPrerequisite: { fromNodeId: fromNode.id, toNodeId: branchNode.id } });
      }
    }
    return { connected: true, node: fromNode, target: targetNode, segment, secondarySegment,
      branchNode, points: route.points, secondaryPoints: secondarySegment?.points || null };
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
