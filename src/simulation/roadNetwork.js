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

  function pathMeasures(points) {
    const measures = [0];
    for (let i = 1; i < points.length; i++) measures.push(measures[i - 1] + distance(points[i - 1], points[i]));
    return measures;
  }

  function pointAtMeasure(points, measures, measure) {
    const target = Math.max(0, Math.min(measures[measures.length - 1], measure));
    for (let i = 1; i < measures.length; i++) {
      if (target > measures[i] && i < measures.length - 1) continue;
      const span = measures[i] - measures[i - 1], ratio = span > 1e-9 ? (target - measures[i - 1]) / span : 0;
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * ratio,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * ratio };
    }
    return copyPoint(points[points.length - 1]);
  }

  function slicePath(points, surfaceTypes, measures, start, end) {
    const samples = [{ point: pointAtMeasure(points, measures, start), measure: start }];
    for (let i = 1; i < points.length - 1; i++) {
      if (measures[i] > start + 1e-7 && measures[i] < end - 1e-7) {
        samples.push({ point: copyPoint(points[i]), measure: measures[i] });
      }
    }
    samples.push({ point: pointAtMeasure(points, measures, end), measure: end });
    const types = samples.slice(1).map((sample, index) => {
      const middle = (samples[index].measure + sample.measure) / 2;
      let edge = 0;
      while (edge < measures.length - 2 && middle >= measures[edge + 1] - 1e-9) edge++;
      return Boolean(surfaceTypes[edge]);
    });
    return { points: samples.map(sample => sample.point), surfaceTypes: types };
  }

  function alignSliceEnds(geometry, start, end) {
    if (start.point) geometry.points[0] = copyPoint(start.point);
    if (end.point) geometry.points[geometry.points.length - 1] = copyPoint(end.point);
    return geometry;
  }

  function cross(ax, ay, bx, by) { return ax * by - ay * bx; }

  function boundsOverlap(a, b) {
    return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
  }

  function pointsBounds(points) {
    return points.reduce((bounds, point) => ({ left: Math.min(bounds.left, point.x),
      right: Math.max(bounds.right, point.x), top: Math.min(bounds.top, point.y),
      bottom: Math.max(bounds.bottom, point.y) }),
    { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
  }

  function routeCrossings(network, points) {
    const routeMeasures = pathMeasures(points), routeLength = routeMeasures[routeMeasures.length - 1];
    if (routeLength <= 1e-8) return [];
    const found = [], routeBounds = pointsBounds(points);
    for (const segment of network.segments) {
      if (segment.routeType === 'marine') continue;
      if (!boundsOverlap(routeBounds, pointsBounds(segment.points))) continue;
      const segmentMeasures = pathMeasures(segment.points);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], rx = b.x - a.x, ry = b.y - a.y;
        const routeEdgeBounds = { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x),
          top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
        const routeSpan = routeMeasures[i] - routeMeasures[i - 1];
        if (routeSpan <= 1e-9) continue;
        for (let j = 1; j < segment.points.length; j++) {
          const c = segment.points[j - 1], d = segment.points[j], sx = d.x - c.x, sy = d.y - c.y;
          if (!boundsOverlap(routeEdgeBounds, { left: Math.min(c.x, d.x), right: Math.max(c.x, d.x),
            top: Math.min(c.y, d.y), bottom: Math.max(c.y, d.y) })) continue;
          const oldSpan = segmentMeasures[j] - segmentMeasures[j - 1], denominator = cross(rx, ry, sx, sy);
          if (oldSpan <= 1e-9 || Math.abs(denominator) <= 1e-9) continue;
          const qx = c.x - a.x, qy = c.y - a.y;
          const routeT = cross(qx, qy, sx, sy) / denominator;
          const segmentT = cross(qx, qy, rx, ry) / denominator;
          if (routeT < -1e-8 || routeT > 1 + 1e-8 || segmentT < -1e-8 || segmentT > 1 + 1e-8) continue;
          const t = Math.max(0, Math.min(1, routeT)), u = Math.max(0, Math.min(1, segmentT));
          const point = { x: a.x + rx * t, y: a.y + ry * t };
          const routeDistance = routeMeasures[i - 1] + routeSpan * t;
          if (routeDistance <= 1e-6 || routeDistance >= routeLength - 1e-6) continue;
          const event = { point, routeDistance, segmentId: segment.id,
            segmentDistance: segmentMeasures[j - 1] + oldSpan * u };
          let duplicate = found.find(item => Math.abs(item.routeDistance - routeDistance) <= 1e-6 &&
            distance(item.point, point) <= 1e-6);
          if (!duplicate) { duplicate = { point, routeDistance, targets: [] }; found.push(duplicate); }
          if (!duplicate.targets.some(target => target.segmentId === event.segmentId &&
              Math.abs(target.segmentDistance - event.segmentDistance) <= 1e-6)) {
            duplicate.targets.push({ segmentId: event.segmentId, segmentDistance: event.segmentDistance });
          }
        }
      }
    }
    return found.sort((a, b) => a.routeDistance - b.routeDistance);
  }

  function connectRouteCrossings(network, points, routeType = 'land') {
    if (routeType === 'marine') return [];
    const crossings = routeCrossings(network, points);
    for (const crossing of crossings) {
      let node = network.nodes.find(candidate => candidate.connectionMode !== 'marine' &&
        distance(candidate, crossing.point) <= 1e-6);
      if (!node) node = addNode(network, { ...crossing.point, type: 'intersection', isIntersection: true });
      node.isIntersection = true;
      crossing.nodeId = node.id;
    }
    const bySegment = new Map();
    for (const crossing of crossings) for (const target of crossing.targets) {
      const cuts = bySegment.get(target.segmentId) || [];
      cuts.push({ distance: target.segmentDistance, nodeId: crossing.nodeId, point: crossing.point });
      bySegment.set(target.segmentId, cuts);
    }
    for (const [segmentId, cuts] of bySegment) splitSegmentAtMeasures(network, segmentId, cuts);
    return crossings.map(({ point, routeDistance, nodeId }) => ({ point: copyPoint(point), distance: routeDistance, nodeId }));
  }

  function splitSegmentAtMeasures(network, segmentId, cuts) {
    const segment = segmentById(network, segmentId);
    if (!segment) return [];
    const points = segment.points.map(copyPoint), measures = pathMeasures(points), length = measures[measures.length - 1];
    const uniqueCuts = cuts.filter(cut => cut.distance > 1e-6 && cut.distance < length - 1e-6)
      .sort((a, b) => a.distance - b.distance)
      .filter((cut, index, sorted) => index === 0 || Math.abs(cut.distance - sorted[index - 1].distance) > 1e-6);
    if (!uniqueCuts.length) return [];

    const original = { from: segment.from, to: segment.to, builtLength: segment.builtLength,
      roadClass: segment.roadClass, routeType: segment.routeType, routeId: segment.routeId || segment.id,
      constructionPrerequisite: segment.constructionPrerequisite ? { ...segment.constructionPrerequisite } : null,
      constructionPrerequisiteSegmentId: segment.constructionPrerequisiteSegmentId || null,
      surfaceTypes: segment.surfaceTypes.slice() };
    const boundaries = [{ distance: 0, nodeId: original.from }, ...uniqueCuts,
      { distance: length, nodeId: original.to }];
    const parts = [];
    for (let i = 1; i < boundaries.length; i++) {
      const start = boundaries[i - 1], end = boundaries[i], geometry = alignSliceEnds(slicePath(points,
        original.surfaceTypes, measures, start.distance, end.distance), start, end);
      const partLength = lengthOf(geometry.points);
      if (partLength <= 1e-8) continue;
      parts.push({ from: start.nodeId, to: end.nodeId, points: geometry.points,
        surfaceTypes: geometry.surfaceTypes, length: partLength,
        builtLength: Math.max(0, Math.min(partLength, original.builtLength - start.distance)) });
    }
    if (!parts.length) return [];
    const first = parts[0];
    segment.from = first.from; segment.to = first.to; segment.points = first.points;
    segment.surfaceTypes = first.surfaceTypes; segment.length = first.length; segment.builtLength = first.builtLength;
    const created = [segment];
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      created.push(addSegment(network, { ...part, routeId: original.routeId,
        roadClass: original.roadClass, routeType: original.routeType,
        constructionPrerequisiteSegmentId: created[i - 1].id }));
    }
    return created;
  }

  function splitPolylineAtNodes(points, surfaceTypes, crossings, fromNodeId, toNodeId) {
    const measures = pathMeasures(points), length = measures[measures.length - 1];
    const boundaries = [{ distance: 0, nodeId: fromNodeId }, ...crossings,
      { distance: length, nodeId: toNodeId }];
    return boundaries.slice(1).map((end, index) => {
      const start = boundaries[index], geometry = alignSliceEnds(
        slicePath(points, surfaceTypes, measures, start.distance, end.distance), start, end);
      return { from: start.nodeId, to: end.nodeId, points: geometry.points, surfaceTypes: geometry.surfaceTypes };
    });
  }

  function create(planetId) {
    if (typeof planetId !== 'string' || !planetId) throw new TypeError('A planet id is required for a road network');
    return { version: 4, planetId, nextNodeId: 1, nextSegmentId: 1, nextRouteId: 1, nodes: [], segments: [] };
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
      isIntersection: properties.isIntersection === true || properties.type === 'intersection',
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
    const id = `${network.planetId}:road:${network.nextSegmentId++}`;
    const segment = {
      id,
      routeId: typeof properties.routeId === 'string' ? properties.routeId : id,
      from: properties.from,
      to: properties.to,
      points,
      surfaceTypes,
      length,
      builtLength: Math.max(0, Math.min(length, Number.isFinite(properties.builtLength) ? properties.builtLength : 0)),
      roadClass: properties.roadClass || 'main',
      routeType: properties.routeType === 'marine' ? 'marine' : 'land',
      constructionPrerequisite: constructionPrerequisite(properties.constructionPrerequisite, network),
      constructionPrerequisiteSegmentId: typeof properties.constructionPrerequisiteSegmentId === 'string'
        ? properties.constructionPrerequisiteSegmentId : null
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
    for (const segment of network.segments) {
      if (segment.routeType === 'marine') continue;
      for (let edgeIndex = 1; edgeIndex < segment.points.length; edgeIndex++) {
        const a = segment.points[edgeIndex - 1], b = segment.points[edgeIndex];
        const left = Math.floor(Math.min(a.x, b.x) / bucketSize), right = Math.floor(Math.max(a.x, b.x) / bucketSize);
        const top = Math.floor(Math.min(a.y, b.y) / bucketSize), bottom = Math.floor(Math.max(a.y, b.y) / bucketSize);
        const edge = { segment, edgeIndex: edgeIndex - 1, a, b };
        for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
          const key = bucketKey(x, y), candidates = buckets.get(key) || [];
          candidates.push(edge); buckets.set(key, candidates);
        }
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
        const existingNode = network.nodes.find(node => node.connectionMode !== 'marine' &&
          distance(node, point) <= 1e-6);
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
      for (const node of network.nodes) {
        if (node.connectionMode === 'marine') continue;
        consider({ kind: 'node', id: node.id, node, point: copyPoint(node), distance: distance(point, node) });
      }
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
    if (target.kind === 'node') {
      const node = nodeById(network, target.id);
      return node?.connectionMode === 'marine' ? null : node;
    }
    const segment = segmentById(network, target.id);
    if (!segment || segment.routeType === 'marine') return null;
    const from = nodeById(network, segment.from), to = nodeById(network, segment.to);
    if (target.t < 1e-7 && target.edgeIndex === 0) return from;
    if (target.t > 1 - 1e-7 && target.edgeIndex === segment.points.length - 2) return to;

    const junction = addNode(network, { ...target.point, type: 'intersection', isIntersection: true,
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
      routeType: segment.routeType, routeId: segment.routeId || segment.id,
      constructionPrerequisite: segment.constructionPrerequisite,
      constructionPrerequisiteSegmentId: segment.id,
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

  function restore(value, planetId, buildings = []) {
    if (!value || typeof value !== 'object' || value.planetId !== planetId ||
        !Array.isArray(value.nodes) || !Array.isArray(value.segments)) return null;
    const network = create(planetId), seenNodes = new Set();
    for (const saved of value.nodes) {
      if (!saved || typeof saved.id !== 'string' || !finitePoint(saved) || seenNodes.has(saved.id)) continue;
      seenNodes.add(saved.id);
      network.nodes.push({ id: saved.id, type: typeof saved.type === 'string' ? saved.type : 'building',
        buildingId: typeof saved.buildingId === 'string' ? saved.buildingId : null,
        connectionMode: saved.connectionMode === 'marine' ? 'marine' : 'land',
        isIntersection: saved.isIntersection === true || saved.type === 'intersection', x: saved.x, y: saved.y });
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
      network.segments.push({ id: saved.id, routeId: typeof saved.routeId === 'string' ? saved.routeId : saved.id,
        from: saved.from, to: saved.to, points,
        surfaceTypes, length,
        builtLength: Number.isFinite(saved.builtLength) ? Math.max(0, Math.min(length, saved.builtLength)) : length,
        roadClass: typeof saved.roadClass === 'string' ? saved.roadClass : 'standard',
        routeType: saved.routeType === 'marine' ? 'marine' : 'land',
        constructionPrerequisiteSegmentId: typeof saved.constructionPrerequisiteSegmentId === 'string'
          ? saved.constructionPrerequisiteSegmentId : null,
        constructionPrerequisite: prerequisite });
      const suffix = Number(saved.id.split(':road:').pop());
      if (Number.isInteger(suffix)) network.nextSegmentId = Math.max(network.nextSegmentId, suffix + 1);
      const routeSuffix = Number((typeof saved.routeId === 'string' ? saved.routeId : '').split(':route:').pop());
      if (Number.isInteger(routeSuffix)) network.nextRouteId = Math.max(network.nextRouteId, routeSuffix + 1);
    }
    const validSegments = new Set(network.segments.map(segment => segment.id));
    for (const segment of network.segments) {
      if (segment.constructionPrerequisiteSegmentId && !validSegments.has(segment.constructionPrerequisiteSegmentId)) {
        segment.constructionPrerequisiteSegmentId = null;
      }
    }
    restoreLegacyMarineRoutes(network, buildings);
    return network;
  }

  function restoreLegacyMarineRoutes(network, buildings) {
    const buildingById = new Map((buildings || []).map(building => [building.id, building]));
    const groups = new Map();
    for (const segment of network.segments) {
      if (segment.routeType === 'marine') continue;
      const routeId = segment.routeId || segment.id, group = groups.get(routeId) || [];
      group.push(segment); groups.set(routeId, group);
    }
    for (const segments of groups.values()) {
      const degree = new Map();
      for (const segment of segments) {
        degree.set(segment.from, (degree.get(segment.from) || 0) + 1);
        degree.set(segment.to, (degree.get(segment.to) || 0) + 1);
      }
      const endpointIds = [...degree].filter(([, count]) => count === 1).map(([id]) => id);
      if (endpointIds.length !== 2) continue;
      const endpoints = endpointIds.map(id => ({ node: nodeById(network, id), building: buildingById.get(nodeById(network, id)?.buildingId) }));
      if (endpoints.some(endpoint => !endpoint.node || !endpoint.building)) continue;
      const types = endpoints.map(endpoint => endpoint.building.type);
      const hasPlatformAndPort = types.includes('oil_platform') && types.includes('surface_port');
      const isAllWater = segments.every(segment => segment.surfaceTypes.length > 0 && segment.surfaceTypes.every(Boolean));
      const isLegacySeaLink = hasPlatformAndPort || (isAllWater &&
        types.every(type => type === 'surface_port' || type === 'oil_platform'));
      if (!isLegacySeaLink) continue;

      const groupIds = new Set(segments.map(segment => segment.id));
      for (const segment of segments) segment.routeType = 'marine';
      for (const { node } of endpoints) {
        const sharedWithLand = network.segments.some(segment => !groupIds.has(segment.id) &&
          segment.routeType !== 'marine' && (segment.from === node.id || segment.to === node.id));
        if (sharedWithLand) {
          const marineNode = addNode(network, { ...node, type: 'marine-port', connectionMode: 'marine' });
          for (const segment of segments) {
            if (segment.from === node.id) segment.from = marineNode.id;
            if (segment.to === node.id) segment.to = marineNode.id;
          }
        } else node.connectionMode = 'marine';
      }
    }
  }

  root.OrbitRoadNetwork = Object.freeze({ create, addNode, addSegment, nodeById, segmentById,
    nearestConnection, firstContact, connectToTarget, connectRouteCrossings, splitPolylineAtNodes,
    replaceSegmentPoints, restore, lengthOf,
    nearestBuiltConnection, distanceAlongSegment });
})(globalThis);
