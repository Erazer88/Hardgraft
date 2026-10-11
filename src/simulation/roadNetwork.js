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
    return { version: 3, planetId, nextNodeId: 1, nextSegmentId: 1, nodes: [], segments: [] };
  }

  function constructionPrerequisite(value, network) {
    if (!value || typeof value.fromNodeId !== 'string' || typeof value.toNodeId !== 'string' ||
        !nodeById(network, value.fromNodeId) || !nodeById(network, value.toNodeId)) return null;
    return { fromNodeId: value.fromNodeId, toNodeId: value.toNodeId };
  }

  function addNode(network, properties) {
    if (!network || !finitePoint(properties)) throw new TypeError('Road nodes require finite terrain coordinates');
    const node = {
      id: `${network.planetId}:node:${network.nextNodeId++}`,
      type: properties.type || 'building',
      buildingId: properties.buildingId || null,
      connectionMode: properties.connectionMode === 'marine' ? 'marine' : 'land',
      x: properties.x,
      y: properties.y
    };
    network.nodes.push(node);
    return node;
  }

  function nodeById(network, id) { return network.nodes.find(node => node.id === id) || null; }
  function segmentById(network, id) { return network.segments.find(segment => segment.id === id) || null; }

  function distanceAlongSegment(network, segmentId, firstPoint, secondPoint) {
    const segment = segmentById(network, segmentId);
    if (!segment || !finitePoint(firstPoint) || !finitePoint(secondPoint)) return Infinity;
    function measure(point) {
      let travelled = 0, best = Infinity, bestMeasure = 0;
      for (let i = 1; i < segment.points.length; i++) {
        const a = segment.points[i - 1], b = segment.points[i];
        const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
        const projection = { x: a.x + dx * t, y: a.y + dy * t }, error = distance(point, projection);
        if (error < best) { best = error; bestMeasure = travelled + Math.sqrt(lengthSquared) * t; }
        travelled += Math.sqrt(lengthSquared);
      }
      return bestMeasure;
    }
    return Math.abs(measure(firstPoint) - measure(secondPoint));
  }

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
    const length = lengthOf(points);
    const segment = {
      id: `${network.planetId}:road:${network.nextSegmentId++}`,
      from: properties.from,
      to: properties.to,
      points,
      surfaceTypes,
      length,
      builtLength: Math.max(0, Math.min(length, Number.isFinite(properties.builtLength) ? properties.builtLength : 0)),
      roadClass: properties.roadClass || 'main',
      routeType: properties.routeType === 'marine' ? 'marine' : 'land',
      constructionPrerequisite: constructionPrerequisite(properties.constructionPrerequisite, network)
    };
    network.segments.push(segment);
    return segment;
  }

  function nearestConnection(network, point, excludedNodeId = null, accepts = null) {
    let best = null;
    function consider(candidate) {
      if (accepts && !accepts(candidate)) return;
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

  function nearestBuiltConnection(network, point, accepts = null) {
    if (!network || !finitePoint(point)) return null;
    let best = null;
    function consider(candidate) {
      if (accepts && !accepts(candidate)) return;
      if (!best || candidate.distance < best.distance - 1e-7 ||
          (Math.abs(candidate.distance - best.distance) <= 1e-7 && candidate.kind === 'node' && best.kind !== 'node') ||
          (Math.abs(candidate.distance - best.distance) <= 1e-7 && candidate.kind === best.kind && candidate.id < best.id)) best = candidate;
    }
    for (const node of network.nodes) {
      const reached = network.segments.some(segment => {
        const built = Number.isFinite(segment.builtLength) ? segment.builtLength : segment.length;
        return (segment.from === node.id && built > 1e-5) ||
          (segment.to === node.id && built >= segment.length - 1e-5);
      });
      if (reached) consider({ kind: 'node', id: node.id, node, point: copyPoint(node), distance: distance(point, node) });
    }
    for (const segment of network.segments) {
      let remaining = Number.isFinite(segment.builtLength) ? Math.max(0, Math.min(segment.length, segment.builtLength)) : segment.length;
      for (let i = 1; i < segment.points.length && remaining > 1e-7; i++) {
        const a = segment.points[i - 1], b = segment.points[i], dx = b.x - a.x, dy = b.y - a.y;
        const edgeLength = Math.hypot(dx, dy);
        if (edgeLength <= 1e-9) continue;
        const builtRatio = Math.min(1, remaining / edgeLength), builtEnd = { x: a.x + dx * builtRatio, y: a.y + dy * builtRatio };
        const builtX = builtEnd.x - a.x, builtY = builtEnd.y - a.y, lengthSquared = builtX * builtX + builtY * builtY;
        const tBuilt = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * builtX + (point.y - a.y) * builtY) / lengthSquared)) : 0;
        const projection = { x: a.x + builtX * tBuilt, y: a.y + builtY * tBuilt };
        consider({ kind: 'segment', id: segment.id, segment, edgeIndex: i - 1,
          t: tBuilt * builtRatio, point: projection, distance: distance(point, projection) });
        remaining -= edgeLength * builtRatio;
      }
    }
    return best;
  }

  function firstContact(network, points, snapDistance, accepts = null) {
    if (!network || !Array.isArray(points) || points.length < 2 || !Number.isFinite(snapDistance) || snapDistance < 0) return null;
    const bucketSize = Math.max(1, snapDistance), buckets = new Map();
    const bucketKey = (x, y) => `${x},${y}`;
    for (const segment of network.segments) for (let edgeIndex = 1; edgeIndex < segment.points.length; edgeIndex++) {
      const a = segment.points[edgeIndex - 1], b = segment.points[edgeIndex];
      const left = Math.floor(Math.min(a.x, b.x) / bucketSize), right = Math.floor(Math.max(a.x, b.x) / bucketSize);
      const top = Math.floor(Math.min(a.y, b.y) / bucketSize), bottom = Math.floor(Math.max(a.y, b.y) / bucketSize);
      const edge = { segment, edgeIndex: edgeIndex - 1, a, b };
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const key = bucketKey(x, y), candidates = buckets.get(key) || [];
        candidates.push(edge); buckets.set(key, candidates);
      }
    }
    function nearbyEdges(left, top, right, bottom) {
      const candidates = new Map();
      for (let y = Math.floor(top / bucketSize); y <= Math.floor(bottom / bucketSize); y++) {
        for (let x = Math.floor(left / bucketSize); x <= Math.floor(right / bucketSize); x++) {
          for (const edge of buckets.get(bucketKey(x, y)) || []) candidates.set(`${edge.segment.id}:${edge.edgeIndex}`, edge);
        }
      }
      return candidates.values();
    }
    function trimAt(index, point) {
      const trimmed = points.slice(0, index).map(copyPoint);
      const contact = copyPoint(point);
      if (!trimmed.length) trimmed.push(copyPoint(points[0]));
      if (distance(trimmed[trimmed.length - 1], contact) > 1e-7) trimmed.push(contact);
      if (trimmed.length === 1) trimmed.push(contact);
      return trimmed;
    }

    // Prefer the real crossing when two polylines intersect. This keeps the
    // junction marker on the visible crossing instead of snapping to an
    // earlier point that merely happens to be nearby.
    let crossing = null;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index], rx = b.x - a.x, ry = b.y - a.y;
      const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
      for (const edge of nearbyEdges(left, top, right, bottom)) {
        const { segment, edgeIndex, a: c, b: d } = edge, sx = d.x - c.x, sy = d.y - c.y;
        const denominator = rx * sy - ry * sx;
        if (Math.abs(denominator) < 1e-9) continue;
        const qx = c.x - a.x, qy = c.y - a.y;
        const routeT = (qx * sy - qy * sx) / denominator;
        const segmentT = (qx * ry - qy * rx) / denominator;
        if (routeT < -1e-8 || routeT > 1 + 1e-8 || segmentT < -1e-8 || segmentT > 1 + 1e-8) continue;
        const point = { x: a.x + rx * routeT, y: a.y + ry * routeT };
        const existingNode = network.nodes.find(node => distance(node, point) <= 1e-6);
        const target = existingNode
          ? { kind: 'node', id: existingNode.id, node: existingNode, point: copyPoint(existingNode), distance: 0 }
          : { kind: 'segment', id: segment.id, segment, edgeIndex: edgeIndex - 1,
            t: Math.max(0, Math.min(1, segmentT)), point, distance: 0 };
        if (accepts && !accepts(target)) continue;
        const progress = index - 1 + routeT;
        if (!crossing || progress < crossing.progress) crossing = { target, index, t: routeT, progress };
      }
    }
    if (crossing) return { target: crossing.target, points: trimAt(crossing.index, crossing.target.point), contactIndex: crossing.index };

    for (let index = 1; index < points.length; index++) {
      const point = points[index];
      let target = null;
      function consider(candidate) {
        if (accepts && !accepts(candidate)) return;
        if (!target || candidate.distance < target.distance - 1e-7 ||
            (Math.abs(candidate.distance - target.distance) <= 1e-7 && candidate.kind === 'node' && target.kind !== 'node') ||
            (Math.abs(candidate.distance - target.distance) <= 1e-7 && candidate.kind === target.kind && candidate.id < target.id)) target = candidate;
      }
      for (const node of network.nodes) consider({ kind: 'node', id: node.id, node, point: copyPoint(node), distance: distance(point, node) });
      for (const edge of nearbyEdges(point.x - snapDistance, point.y - snapDistance, point.x + snapDistance, point.y + snapDistance)) {
        const { segment, edgeIndex, a, b } = edge, dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
        const projection = { x: a.x + dx * t, y: a.y + dy * t };
        consider({ kind: 'segment', id: segment.id, segment, edgeIndex, t, point: projection, distance: distance(point, projection) });
      }
      if (!target || target.distance > snapDistance) continue;
      return { target, points: trimAt(index, target.point), contactIndex: index };
    }
    return null;
  }

  function connectToTarget(network, target) {
    if (!target) return null;
    if (target.kind === 'node') return nodeById(network, target.id);
    const segment = segmentById(network, target.id);
    if (!segment) return null;
    const from = nodeById(network, segment.from), to = nodeById(network, segment.to);
    if (target.t < 1e-7 && target.edgeIndex === 0) return from;
    if (target.t > 1 - 1e-7 && target.edgeIndex === segment.points.length - 2) return to;

    const junction = addNode(network, { ...target.point, type: 'intersection',
      connectionMode: segment.routeType === 'marine' ? 'marine' : 'land' });
    const originalTo = segment.to;
    let leftPoints, rightPoints;
    let leftSurfaceTypes, rightSurfaceTypes;
    const surfaceTypes = segment.surfaceTypes || Array(segment.points.length - 1).fill(false);
    const previousBuiltLength = Number.isFinite(segment.builtLength) ? segment.builtLength : segment.length;
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
    segment.builtLength = Math.min(previousBuiltLength, segment.length);
    const rightLength = lengthOf(rightPoints);
    addSegment(network, { from: junction.id, to: originalTo, points: rightPoints,
      surfaceTypes: rightSurfaceTypes, roadClass: segment.roadClass,
      routeType: segment.routeType,
      constructionPrerequisite: segment.constructionPrerequisite,
      builtLength: Math.max(0, Math.min(rightLength, previousBuiltLength - segment.length)) });
    return junction;
  }

  function replaceSegmentPoints(network, segmentId, points, surfaceTypes = []) {
    const segment = segmentById(network, segmentId);
    if (!segment || !Array.isArray(points) || points.length < 2 || points.some(point => !finitePoint(point))) return false;
    segment.points = points.map(copyPoint);
    segment.surfaceTypes = Array.isArray(surfaceTypes) && surfaceTypes.length === points.length - 1 &&
      surfaceTypes.every(value => typeof value === 'boolean') ? surfaceTypes.slice() : Array(points.length - 1).fill(false);
    segment.length = lengthOf(segment.points);
    segment.builtLength = 0;
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
        buildingId: typeof saved.buildingId === 'string' ? saved.buildingId : null,
        connectionMode: saved.connectionMode === 'marine' ? 'marine' : 'land', x: saved.x, y: saved.y });
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
      const length = lengthOf(points);
      const prerequisite = saved.constructionPrerequisite &&
        typeof saved.constructionPrerequisite.fromNodeId === 'string' &&
        typeof saved.constructionPrerequisite.toNodeId === 'string' &&
        validNodes.has(saved.constructionPrerequisite.fromNodeId) &&
        validNodes.has(saved.constructionPrerequisite.toNodeId)
        ? { fromNodeId: saved.constructionPrerequisite.fromNodeId,
          toNodeId: saved.constructionPrerequisite.toNodeId } : null;
      network.segments.push({ id: saved.id, from: saved.from, to: saved.to, points,
        surfaceTypes, length,
        builtLength: Number.isFinite(saved.builtLength) ? Math.max(0, Math.min(length, saved.builtLength)) : length,
        roadClass: typeof saved.roadClass === 'string' ? saved.roadClass : 'standard',
        routeType: saved.routeType === 'marine' ? 'marine' : 'land',
        constructionPrerequisite: prerequisite });
      const suffix = Number(saved.id.split(':road:').pop());
      if (Number.isInteger(suffix)) network.nextSegmentId = Math.max(network.nextSegmentId, suffix + 1);
    }
    return network;
  }

  root.OrbitRoadNetwork = Object.freeze({ create, addNode, addSegment, nodeById, segmentById,
    nearestConnection, firstContact, connectToTarget, replaceSegmentPoints, restore, lengthOf,
    nearestBuiltConnection, distanceAlongSegment });
})(globalThis);
