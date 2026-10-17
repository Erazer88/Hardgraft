(function (root) {
  'use strict';

  const BUILD_EPSILON = 1e-6;

  function hasBuiltLandPath(network, fromBuildingId, toBuildingId) {
    if (!network || fromBuildingId === toBuildingId) return false;
    const starts = network.nodes.filter(node => node.buildingId === fromBuildingId && node.connectionMode !== 'marine');
    const targets = new Set(network.nodes.filter(node => node.buildingId === toBuildingId && node.connectionMode !== 'marine')
      .map(node => node.id));
    if (!starts.length || !targets.size) return false;
    const edges = new Map();
    for (const segment of network.segments || []) {
      if (segment.routeType === 'marine' || !Number.isFinite(segment.length) ||
          !Number.isFinite(segment.builtLength) || segment.builtLength + BUILD_EPSILON < segment.length) continue;
      const a = edges.get(segment.from) || []; a.push(segment.to); edges.set(segment.from, a);
      const b = edges.get(segment.to) || []; b.push(segment.from); edges.set(segment.to, b);
    }
    const visited = new Set(starts.map(node => node.id)), queue = [...visited];
    while (queue.length) {
      const current = queue.shift();
      if (targets.has(current)) return true;
      for (const next of edges.get(current) || []) if (!visited.has(next)) {
        visited.add(next); queue.push(next);
      }
    }
    return false;
  }

  function transferDockStockToPlatforms(state, seconds = 0) {
    const transferred = new Map();
    for (const platform of state.surfaceBuildings || []) {
      if (platform.type !== 'launch_platform' || platform.constructionState !== 'complete') continue;
      const network = state.roadNetworks?.[platform.planetId];
      platform.launchStock ||= {};
      platform.launchReceivedTotal ||= {};
      for (const source of state.surfaceBuildings || []) {
        if (source.id === platform.id || source.planetId !== platform.planetId ||
            source.constructionState !== 'complete' || !hasBuiltLandPath(network, source.id, platform.id)) continue;
        const stock = source.dockStock;
        if (!stock || typeof stock !== 'object') continue;
        for (const [resourceId, rawAmount] of Object.entries(stock)) {
          const amount = Number.isInteger(rawAmount) && rawAmount > 0 ? rawAmount : 0;
          if (!amount) continue;
          delete stock[resourceId];
          platform.launchStock[resourceId] = (platform.launchStock[resourceId] || 0) + amount;
          platform.launchReceivedTotal[resourceId] = (platform.launchReceivedTotal[resourceId] || 0) + amount;
          transferred.set(`${platform.id}:${resourceId}`, (transferred.get(`${platform.id}:${resourceId}`) || 0) + amount);
        }
      }
    }
    const rates = {};
    if (seconds > 0) for (const [key, amount] of transferred) rates[key] = amount / seconds;
    return { transferred, rates };
  }

  root.OrbitLogisticsNetwork = Object.freeze({ hasBuiltLandPath, transferDockStockToPlatforms });
})(globalThis);
