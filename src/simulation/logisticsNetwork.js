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

  function transferDockStockToBuildings(state, seconds = 0) {
    const transferred = new Map();
    const buildings = state.surfaceBuildings || [];
    const byId = new Map(buildings.map(building => [building.id, building]));
    for (const source of buildings) {
      if (source.constructionState !== 'complete' || !source.dockStock || typeof source.dockStock !== 'object') continue;
      const network = state.roadNetworks?.[source.planetId];
      for (const [resourceId, rawAmount] of Object.entries(source.dockStock)) {
        const amount = Number.isInteger(rawAmount) && rawAmount > 0 ? rawAmount : 0;
        const destinationId = source.dockDestinations?.[resourceId];
        const destination = byId.get(destinationId);
        if (!amount || !destination || destination.id === source.id || destination.planetId !== source.planetId ||
            destination.constructionState !== 'complete' || !hasBuiltLandPath(network, source.id, destination.id)) continue;
        const stock = destination.type === 'launch_platform'
          ? (destination.launchStock ||= {}) : (destination.inventory ||= {});
        stock[resourceId] = (stock[resourceId] || 0) + amount;
        if (destination.type === 'launch_platform') {
          destination.launchReceivedTotal ||= {};
          destination.launchReceivedTotal[resourceId] = (destination.launchReceivedTotal[resourceId] || 0) + amount;
        }
        delete source.dockStock[resourceId];
        transferred.set(`${destination.id}:${resourceId}`, (transferred.get(`${destination.id}:${resourceId}`) || 0) + amount);
      }
    }
    const rates = {};
    if (seconds > 0) for (const [key, amount] of transferred) rates[key] = amount / seconds;
    return { transferred, rates };
  }

  root.OrbitLogisticsNetwork = Object.freeze({ hasBuiltLandPath,
    transferDockStockToBuildings, transferDockStockToPlatforms: transferDockStockToBuildings });
})(globalThis);
