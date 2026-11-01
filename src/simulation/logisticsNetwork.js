(function (root) {
  'use strict';

  const BUILD_EPSILON = 1e-6;
  const ALLOWED_DOCK_DESTINATIONS = root.OrbitOrbitalLogisticsData.dockDestinationTypes;

  // Built route between two buildings: roads, and sea lanes between ports,
  // which hand goods from ships to trucks (a building's land and marine
  // nodes are the same place). An oil platform ships through its sea lane.
  // The buildings a network joins are grouped once per change of the
  // network (its nodes, segments or built lengths), then compared.
  const componentCache = new WeakMap();
  function builtComponents(network) {
    let built = 0;
    for (const segment of network.segments || []) built += Number.isFinite(segment.builtLength) ? segment.builtLength : 0;
    const version = `${network.nodes.length}|${(network.segments || []).length}|${built}`;
    const cached = componentCache.get(network);
    if (cached?.version === version) return cached.byBuilding;
    const parent = new Map(network.nodes.map(node => [node.id, node.id]));
    const find = id => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
    const join = (a, b) => { if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b)); };
    for (const segment of network.segments || []) {
      if (!Number.isFinite(segment.length) || !Number.isFinite(segment.builtLength) ||
          segment.builtLength + BUILD_EPSILON < segment.length) continue;
      join(segment.from, segment.to);
    }
    const firstNode = new Map();
    for (const node of network.nodes) if (node.buildingId) {
      if (firstNode.has(node.buildingId)) join(node.id, firstNode.get(node.buildingId));
      else firstNode.set(node.buildingId, node.id);
    }
    const byBuilding = new Map();
    for (const [buildingId, nodeId] of firstNode) byBuilding.set(buildingId, find(nodeId));
    componentCache.set(network, { version, byBuilding });
    return byBuilding;
  }

  function hasBuiltLandPath(network, fromBuildingId, toBuildingId) {
    if (!network || fromBuildingId === toBuildingId) return false;
    const components = builtComponents(network);
    const from = components.get(fromBuildingId);
    return from !== undefined && from === components.get(toBuildingId);
  }

  // A destination receives once its plan has an entry: an input dock, or a
  // depot's input gate. Launch platforms always receive.
  // A site under construction takes what it still waits for, nothing more.
  function siteRoom(destination, resourceId) {
    if (destination.constructionState !== 'supplying') return null;
    const left = root.OrbitConstruction?.needsLeft(destination)?.[resourceId] || 0;
    return Math.max(0, left - Math.floor(destination.inventory?.[resourceId] || 0));
  }

  // A building with cards keeps at most dockCapacity units of each resource
  // received (its input docks draw from there); the colony and the launch
  // platform take everything.
  function dockRoom(destination, resourceId) {
    if (destination.type === 'colony' || destination.type === 'launch_platform') return null;
    const capacity = root.OrbitProcessData?.config.dockCapacity;
    if (!Number.isFinite(capacity)) return null;
    return Math.max(0, capacity - Math.floor(destination.inventory?.[resourceId] || 0));
  }

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
    // Returns how many units reached the destination.
    const deliver = (source, network, destinationId, resourceId, rawAmount, sourceMix = null) => {
      const offered = Number.isInteger(rawAmount) && rawAmount > 0 ? rawAmount : 0;
      const destination = byId.get(destinationId);
      if (!offered || !destination || destination.id === source.id || destination.planetId !== source.planetId ||
          !ALLOWED_DOCK_DESTINATIONS.includes(destination.type) ||
          !['complete', 'supplying'].includes(destination.constructionState) ||
          !hasReceivingDock(state, destination) ||
          !hasBuiltLandPath(network, source.id, destination.id)) return 0;
      const room = siteRoom(destination, resourceId) ?? dockRoom(destination, resourceId);
      const amount = room === null ? offered : Math.min(offered, room);
      if (!amount) return 0;
      const site = destination.constructionState === 'supplying';
      const stock = destination.type === 'launch_platform' && !site
        ? (destination.launchStock ||= {}) : (destination.inventory ||= {});
      // Rock arrives with the composition it left with.
      if (Mix && destination.type !== 'launch_platform') {
        Mix.add(destination.inventoryMix ||= {}, resourceId, resourceId, stock[resourceId] || 0, amount, Mix.of(sourceMix, resourceId));
      }
      stock[resourceId] = (stock[resourceId] || 0) + amount;
      if (destination.type === 'launch_platform' && !site) {
        destination.launchReceivedTotal ||= {};
        destination.launchReceivedTotal[resourceId] = (destination.launchReceivedTotal[resourceId] || 0) + amount;
      }
      // Running totals received, overall and per source (runtime only), from
      // which panels derive live rates.
      destination.receivedTotal ||= {};
      destination.receivedTotal[resourceId] = (destination.receivedTotal[resourceId] || 0) + amount;
      const fromSource = (destination.receivedFrom ||= {})[source.id] ||= {};
      fromSource[resourceId] = (fromSource[resourceId] || 0) + amount;
      flows.push({ sourceId: source.id, destinationId: destination.id, resourceId, amount });
      transferred.set(`${destination.id}:${resourceId}`, (transferred.get(`${destination.id}:${resourceId}`) || 0) + amount);
      return amount;
    };
    // Takes what was delivered out of a source stock (and its composition once empty).
    const settle = (stock, mixes, resourceId, delivered) => {
      if (!delivered) return;
      stock[resourceId] -= delivered;
      if (stock[resourceId] > 0) return;
      delete stock[resourceId];
      if (mixes) delete mixes[resourceId];
    };
    for (const source of buildings) {
      if (source.constructionState !== 'complete') continue;
      const network = state.roadNetworks?.[source.planetId];
      if (source.dockStock && typeof source.dockStock === 'object') {
        for (const [resourceId, amount] of Object.entries(source.dockStock)) {
          settle(source.dockStock, source.dockMix, resourceId,
            deliver(source, network, source.dockDestinations?.[resourceId], resourceId, amount, source.dockMix));
        }
      }
      // A depot's output gates queue their units per destination building.
      for (const [destinationId, queue] of Object.entries(source.gateStock || {})) {
        for (const [resourceId, amount] of Object.entries(queue)) {
          settle(queue, source.gateMix?.[destinationId], resourceId,
            deliver(source, network, destinationId, resourceId, amount, source.gateMix?.[destinationId]));
        }
      }
    }
    const rates = {};
    if (seconds > 0) for (const [key, amount] of transferred) rates[key] = amount / seconds;
    return { transferred, rates, flows };
  }

  root.OrbitLogisticsNetwork = Object.freeze({ hasBuiltLandPath, hasReceivingDock, transferDockStockToBuildings });
})(globalThis);
