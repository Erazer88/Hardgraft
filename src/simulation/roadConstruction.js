(function (root) {
  'use strict';

  const Config = root.OrbitRoadConfig;

  function addCompletedSegment(adjacency, segment) {
    const from = adjacency.get(segment.from) || [];
    const to = adjacency.get(segment.to) || [];
    from.push(segment.to); to.push(segment.from);
    adjacency.set(segment.from, from); adjacency.set(segment.to, to);
  }

  function completedAdjacency(network) {
    const adjacency = new Map();
    for (const segment of network.segments || []) {
      const length = Number.isFinite(segment.length) ? segment.length : 0;
      const builtLength = Number.isFinite(segment.builtLength) ? segment.builtLength : length;
      if (builtLength >= length - 1e-7) addCompletedSegment(adjacency, segment);
    }
    return adjacency;
  }

  function hasConnection(adjacency, fromNodeId, toNodeId) {
    if (fromNodeId === toNodeId) return true;
    const visited = new Set([fromNodeId]), pending = [fromNodeId];
    while (pending.length) {
      for (const next of adjacency.get(pending.shift()) || []) {
        if (next === toNodeId) return true;
        if (!visited.has(next)) { visited.add(next); pending.push(next); }
      }
    }
    return false;
  }

  function hasCompletedConnection(network, fromNodeId, toNodeId) {
    return hasConnection(completedAdjacency(network), fromNodeId, toNodeId);
  }

  function advance(networks, deltaSeconds, onComplete = null) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Road construction time must be non-negative');
    let changed = false;
    for (const [planetId, network] of Object.entries(networks || {})) {
      const adjacency = completedAdjacency(network);
      const segmentsById = new Map((network.segments || []).map(segment => [segment.id, segment]));
      for (const segment of network.segments || []) {
        const length = Number.isFinite(segment.length) ? segment.length : 0;
        const builtLength = Number.isFinite(segment.builtLength) ? Math.max(0, segment.builtLength) : length;
        if (builtLength >= length) { segment.builtLength = length; continue; }
        const previousSegment = segment.constructionPrerequisiteSegmentId &&
          segmentsById.get(segment.constructionPrerequisiteSegmentId);
        if (previousSegment) {
          const previousLength = Number.isFinite(previousSegment.length) ? previousSegment.length : 0;
          const previousBuilt = Number.isFinite(previousSegment.builtLength) ? previousSegment.builtLength : previousLength;
          if (previousBuilt < previousLength - 1e-7) continue;
        }
        const prerequisite = segment.constructionPrerequisite;
        if (prerequisite && !hasConnection(adjacency, prerequisite.fromNodeId, prerequisite.toNodeId)) continue;
        const speed = Config.construction.speedByClass[segment.roadClass] || Config.construction.speedByClass.main;
        const nextLength = Math.min(length, builtLength + speed * deltaSeconds);
        if (nextLength > builtLength) changed = true;
        segment.builtLength = nextLength;
        if (nextLength >= length - 1e-7) {
          addCompletedSegment(adjacency, segment);
          if (builtLength < length - 1e-7 && typeof onComplete === 'function') onComplete(planetId, network, segment);
        }
      }
    }
    return changed;
  }

  root.OrbitRoadConstruction = Object.freeze({ advance, hasCompletedConnection });
})(globalThis);
