(function (root) {
  'use strict';

  const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
  const copyPoint = point => ({ x: point.x, y: point.y });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function lengthOf(points) {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i]);
    return length;
  }

  function create(planetId) {
    if (typeof planetId !== 'string' || !planetId) throw new TypeError('A planet id is required for a road network');
    return { version: 1, planetId, nextNodeId: 1, nextSegmentId: 1, nodes: [], segments: [] };
  }

  function addNode(network, properties) {
    if (!network || !finitePoint(properties)) throw new TypeError('Road nodes require finite terrain coordinates');
    const node = {
      id: `${network.planetId}:node:${network.nextNodeId++}`,
      type: properties.type || 'building',
      buildingId: properties.buildingId || null,
      x: properties.x,
      y: properties.y
    };
    network.nodes.push(node);
    return node;
  }

  function nodeById(network, id) { return network.nodes.find(node => node.id === id) || null; }
  function segmentById(network, id) { return network.segments.find(segment => segment.id === id) || null; }

  function addSegment(network, properties) {
    if (!network || !nodeById(network, properties.from) || !nodeById(network, properties.to)) {
      throw new TypeError('Road segment endpoints must exist in the network');
    }
    if (!Array.isArray(properties.points) || properties.points.length < 2 || properties.points.some(point => !finitePoint(point))) {
      throw new TypeError('Road segments require a terrain-coordinate polyline');
    }
    const points = properties.points.map(copyPoint);
    const surfaceTypes = Array.isArray(properties.surfaceTypes) &&
      properties.surfaceTypes.length === points.length - 1 && properties.surfaceTypes.every(value => typeof value === 'boolean')
      ? properties.surfaceTypes.slice() : Array(points.length - 1).fill(false);
    const segment = {
      id: `${network.planetId}:road:${network.nextSegmentId++}`,
      from: properties.from,
      to: properties.to,
      points,
      surfaceTypes,
      length: lengthOf(points),
      roadClass: properties.roadClass || 'standard'
    };
    network.segments.push(segment);
    return segment;
  }

  function nearestConnection(network, point, excludedNodeId = null) {
    let best = null;
    function consider(candidate) {
      if (!best || candidate.distance < best.distance - 1e-7 ||
          (Math.abs(candidate.distance - best.distance) <= 1e-7 && candidate.kind === 'node' && best.kind !== 'node') ||
          (Math.abs(candidate.distance - best.distance) <= 1e-7 && candidate.kind === best.kind && candidate.id < best.id)) best = candidate;
    }
    for (const node of network.nodes) {
      if (node.id === excludedNodeId) continue;
      consider({ kind: 'node', id: node.id, node, point: copyPoint(node), distance: distance(point, node) });
    }
    for (const segment of network.segments) for (let i = 1; i < segment.points.length; i++) {
      const a = segment.points[i - 1], b = segment.points[i], dx = b.x - a.x, dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
      const projection = { x: a.x + dx * t, y: a.y + dy * t };
      consider({ kind: 'segment', id: segment.id, segment, edgeIndex: i - 1, t,
        point: projection, distance: distance(point, projection) });
    }
    return best;
  }

  function connectToTarget(network, target) {
    if (!target) return null;
    if (target.kind === 'node') return nodeById(network, target.id);
    const segment = segmentById(network, target.id);
    if (!segment) return null;
    const from = nodeById(network, segment.from), to = nodeById(network, segment.to);
    if (target.t < 1e-7 && target.edgeIndex === 0) return from;
    if (target.t > 1 - 1e-7 && target.edgeIndex === segment.points.length - 2) return to;

    const junction = addNode(network, { ...target.point, type: 'intersection' });
    const originalTo = segment.to;
    let leftPoints, rightPoints;
    let leftSurfaceTypes, rightSurfaceTypes;
    const surfaceTypes = segment.surfaceTypes || Array(segment.points.length - 1).fill(false);
    if (target.t < 1e-7) {
      leftPoints = segment.points.slice(0, target.edgeIndex + 1).map(copyPoint);
      rightPoints = segment.points.slice(target.edgeIndex).map(copyPoint);
      leftSurfaceTypes = surfaceTypes.slice(0, target.edgeIndex);
      rightSurfaceTypes = surfaceTypes.slice(target.edgeIndex);
    } else if (target.t > 1 - 1e-7) {
      leftPoints = segment.points.slice(0, target.edgeIndex + 2).map(copyPoint);
      rightPoints = segment.points.slice(target.edgeIndex + 1).map(copyPoint);
      leftSurfaceTypes = surfaceTypes.slice(0, target.edgeIndex + 1);
      rightSurfaceTypes = surfaceTypes.slice(target.edgeIndex + 1);
    } else {
      leftPoints = [...segment.points.slice(0, target.edgeIndex + 1).map(copyPoint), copyPoint(target.point)];
      rightPoints = [copyPoint(target.point), ...segment.points.slice(target.edgeIndex + 1).map(copyPoint)];
      leftSurfaceTypes = [...surfaceTypes.slice(0, target.edgeIndex), surfaceTypes[target.edgeIndex] || false];
      rightSurfaceTypes = [surfaceTypes[target.edgeIndex] || false, ...surfaceTypes.slice(target.edgeIndex + 1)];
    }
    segment.to = junction.id;
    segment.points = leftPoints;
    segment.surfaceTypes = leftSurfaceTypes;
    segment.length = lengthOf(leftPoints);
    addSegment(network, { from: junction.id, to: originalTo, points: rightPoints,
      surfaceTypes: rightSurfaceTypes, roadClass: segment.roadClass });
    return junction;
  }

  function replaceSegmentPoints(network, segmentId, points, surfaceTypes = []) {
    const segment = segmentById(network, segmentId);
    if (!segment || !Array.isArray(points) || points.length < 2 || points.some(point => !finitePoint(point))) return false;
    segment.points = points.map(copyPoint);
    segment.surfaceTypes = Array.isArray(surfaceTypes) && surfaceTypes.length === points.length - 1 &&
      surfaceTypes.every(value => typeof value === 'boolean') ? surfaceTypes.slice() : Array(points.length - 1).fill(false);
    segment.length = lengthOf(segment.points);
    return true;
  }

  function restore(value, planetId) {
    if (!value || typeof value !== 'object' || value.planetId !== planetId ||
        !Array.isArray(value.nodes) || !Array.isArray(value.segments)) return null;
    const network = create(planetId), seenNodes = new Set();
    for (const saved of value.nodes) {
      if (!saved || typeof saved.id !== 'string' || !finitePoint(saved) || seenNodes.has(saved.id)) continue;
      seenNodes.add(saved.id);
      network.nodes.push({ id: saved.id, type: typeof saved.type === 'string' ? saved.type : 'building',
        buildingId: typeof saved.buildingId === 'string' ? saved.buildingId : null, x: saved.x, y: saved.y });
      const suffix = Number(saved.id.split(':node:').pop());
      if (Number.isInteger(suffix)) network.nextNodeId = Math.max(network.nextNodeId, suffix + 1);
    }
    const validNodes = new Set(network.nodes.map(node => node.id));
    const seenSegments = new Set();
    for (const saved of value.segments) {
      if (!saved || typeof saved.id !== 'string' || seenSegments.has(saved.id) ||
          !validNodes.has(saved.from) || !validNodes.has(saved.to) || !Array.isArray(saved.points) ||
          saved.points.length < 2 || saved.points.some(point => !finitePoint(point))) continue;
      seenSegments.add(saved.id);
      const points = saved.points.map(copyPoint);
      const surfaceTypes = Array.isArray(saved.surfaceTypes) && saved.surfaceTypes.length === points.length - 1 &&
        saved.surfaceTypes.every(value => typeof value === 'boolean') ? saved.surfaceTypes.slice() : Array(points.length - 1).fill(false);
      network.segments.push({ id: saved.id, from: saved.from, to: saved.to, points,
        surfaceTypes, length: lengthOf(points), roadClass: typeof saved.roadClass === 'string' ? saved.roadClass : 'standard' });
      const suffix = Number(saved.id.split(':road:').pop());
      if (Number.isInteger(suffix)) network.nextSegmentId = Math.max(network.nextSegmentId, suffix + 1);
    }
    return network;
  }

  root.OrbitRoadNetwork = Object.freeze({ create, addNode, addSegment, nodeById, segmentById,
    nearestConnection, connectToTarget, replaceSegmentPoints, restore, lengthOf });
})(globalThis);
