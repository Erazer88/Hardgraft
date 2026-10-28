(function (root) {
  'use strict';

  const BUILD_EPSILON = 1e-6;
  const ALLOWED_DOCK_DESTINATIONS = root.OrbitOrbitalLogisticsData.dockDestinationTypes;

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

  // A destination receives once its plan has an entry: an input dock, or a
  // depot's input gate. Launch platforms always receive.
  function hasReceivingDock(state, building) {
    if (building?.type === 'launch_platform' || building?.type === 'colony') return true;
    const entry = { factory: 'input_dock', waste_heap: 'input_dock', storage: 'depot_input' }[building?.type];
    return Boolean(entry && state.factoryPlans?.[building.id]?.machines?.some(machine => machine.type === entry));
  }

  // Moves every docked stock to its assigned destination. Besides the totals,
  // returns each source-to-destination flow, so the road can show it.
  function transferDockStockToBuildings(state, seconds = 0) {
    const transferred = new Map(), flows = [];
    const buildings = state.surfaceBuildings || [];
    const byId = new Map(buildings.map(building => [building.id, building]));
    const Mix = root.OrbitComposition;
    const deliver = (source, network, destinationId, resourceId, rawAmount, sourceMix = null) => {
      const amount = Number.isInteger(rawAmount) && rawAmount > 0 ? rawAmount : 0;
      const destination = byId.get(destinationId);
      if (!amount || !destination || destination.id === source.id || destination.planetId !== source.planetId ||
          !ALLOWED_DOCK_DESTINATIONS.includes(destination.type) || destination.constructionState !== 'complete' ||
          !hasReceivingDock(state, destination) ||
          !hasBuiltLandPath(network, source.id, destination.id)) return false;
      const stock = destination.type === 'launch_platform'
        ? (destination.launchStock ||= {}) : (destination.inventory ||= {});
      // Rock arrives with the composition it left with.
      if (Mix && destination.type !== 'launch_platform') {
        Mix.add(destination.inventoryMix ||= {}, resourceId, resourceId, stock[resourceId] || 0, amount, Mix.of(sourceMix, resourceId));
      }
      stock[resourceId] = (stock[resourceId] || 0) + amount;
      if (destination.type === 'launch_platform') {
        destination.launchReceivedTotal ||= {};
        destination.launchReceivedTotal[resourceId] = (destination.launchReceivedTotal[resourceId] || 0) + amount;
      }
      flows.push({ sourceId: source.id, destinationId: destination.id, resourceId, amount });
      transferred.set(`${destination.id}:${resourceId}`, (transferred.get(`${destination.id}:${resourceId}`) || 0) + amount);
      return true;
    };
    for (const source of buildings) {
      if (source.constructionState !== 'complete') continue;
      const network = state.roadNetworks?.[source.planetId];
      if (source.dockStock && typeof source.dockStock === 'object') {
        for (const [resourceId, amount] of Object.entries(source.dockStock)) {
          if (deliver(source, network, source.dockDestinations?.[resourceId], resourceId, amount, source.dockMix)) {
            delete source.dockStock[resourceId];
            if (source.dockMix) delete source.dockMix[resourceId];
          }
        }
      }
      // A depot's output gates queue their units per destination building.
      for (const [destinationId, queue] of Object.entries(source.gateStock || {})) {
        for (const [resourceId, amount] of Object.entries(queue)) {
          if (deliver(source, network, destinationId, resourceId, amount, source.gateMix?.[destinationId])) {
            delete queue[resourceId];
            if (source.gateMix?.[destinationId]) delete source.gateMix[destinationId][resourceId];
          }
        }
      }
    }
    const rates = {};
    if (seconds > 0) for (const [key, amount] of transferred) rates[key] = amount / seconds;
    return { transferred, rates, flows };
  }

  root.OrbitLogisticsNetwork = Object.freeze({ hasBuiltLandPath, hasReceivingDock,
    transferDockStockToBuildings, transferDockStockToPlatforms: transferDockStockToBuildings });
})(globalThis);
