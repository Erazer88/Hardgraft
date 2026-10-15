(function (root) {
  'use strict';
  const Data = root.OrbitProcessData, Stack = root.OrbitResourceStack;
  const Graph = root.OrbitProcessGraph, Simulation = root.OrbitProcessSimulation;
  const legacyInventoryId = id => ({ standard_iron: 'iron', standard_copper: 'copper', standard_silicon: 'silicon' })[id] || id;

  function fraction(seed) {
    let hash = 2166136261;
    for (const letter of String(seed)) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
    return (hash >>> 0) / 4294967296;
  }
  function geology(state, building) {
    if (!['extractor', 'oil_platform'].includes(building.type) || !building.resourceId) return null;
    const definition = Data.config.geology, composition = definition.signatures[building.resourceId];
    if (!composition) return null;
    const id = `${building.planetId}:${building.resourceId}:${building.x.toFixed(3)}:${building.y.toFixed(3)}`;
    const hardness = definition.hardnessRange[0] + fraction(state.seed + id + ':hardness') *
      (definition.hardnessRange[1] - definition.hardnessRange[0]);
    return { id, planetId: building.planetId, resourceId: building.resourceId, composition: { ...composition }, hardness,
      moisture: definition.moistureRange[0] + fraction(state.seed + id + ':moisture') *
        (definition.moistureRange[1] - definition.moistureRange[0]),
      throughput: Math.min(12, (building.resourceId === 'oil' ? Data.get('oil_pump').baseThroughput : definition.baseThroughput) *
        (.5 + (building.depositAbundance ?? .5) * .5) / hardness) };
  }

  function ensureGraph(state, building) {
    const previous = state.factoryPlans[building.id];
    let graph = previous;
    if (!previous || previous.version !== Data.config.version || !Array.isArray(previous.externalStock) ||
        !previous.nodes?.every(node => node.internalBuffer && node.telemetry && node.inputPorts)) {
      graph = Graph.create(previous || {});
      if (!previous?.externalStock) for (const [resourceId, amount] of Object.entries(building.inventory || {})) {
        Stack.addToStock(graph.externalStock, Stack.create({ resourceId, amount, origin: { kind: 'building', id: building.id } }));
      }
      state.factoryPlans[building.id] = graph;
    }
    graph.buildingType = building.type;
    graph.technologyLevel = building.upgradeLevel || 1;
    if (!Number.isFinite(graph.geology?.throughput) || !graph.geology?.composition) graph.geology = geology(state, building);
    return graph;
  }

  function supply(state, building, resourceId, amount) {
    const definition = root.OrbitResourceData.get(resourceId);
    if (!definition || definition.canonicalId || !Number.isFinite(amount) || amount <= 0) {
      return { ok: false, message: 'Matière ou quantité invalide.' };
    }
    const graph = ensureGraph(state, building), room = Math.max(0, graph.inputCapacity - Stack.total(graph.externalStock));
    const accepted = Math.floor(Math.min(amount, room) + Stack.EPSILON);
    if (accepted < 1) return { ok: false, message: room < 1 ? 'Stock d’entrée du bâtiment plein.' : 'La quantité doit contenir au moins 1 u entière.' };
    const inventoryId = legacyInventoryId(resourceId);
    if (!Data.config.colonyReserveInfinite && !root.OrbitInventory.consume(state.inventory, { [inventoryId]: accepted })) {
      return { ok: false, message: 'Réserve de la colonie insuffisante.' };
    }
    Stack.addToStock(graph.externalStock, Stack.create({ resourceId, amount: accepted,
      origin: { kind: 'colony', seed: state.seed }, moisture: resourceId === 'sludge' ? .9 : 0 }));
    return { ok: true, amount: accepted, message: `${accepted} u ajoutées au stock d’entrée.` };
  }

  function step(state, seconds) {
    const power = new Map(), demands = new Map();
    for (const building of state.surfaceBuildings) {
      const complete = building.constructionState === 'complete';
      building.energyOutputUnlimited = complete && building.type === 'wind_turbine' && Data.config.windPowerUnlimited;
      if (!complete) continue;
      const entry = power.get(building.planetId) || { unlimited: false, megawatts: 0 };
      if (building.energyOutputUnlimited) entry.unlimited = true;
      if (building.type === 'wind_turbine') {
        building.energyOutputWatts = building.energyOutputUnlimited ? 0 : Data.config.windPowerMW * 1e6;
        if (!building.energyOutputUnlimited) entry.megawatts += Data.config.windPowerMW;
      }
      if (building.type === 'geothermal') { building.energyOutputWatts = Data.config.geothermalPowerMW * 1e6; entry.megawatts += Data.config.geothermalPowerMW; }
      power.set(building.planetId, entry);
      if (!state.factoryPlans[building.id]) continue;
      const graph = ensureGraph(state, building), demand = Simulation.demand(graph);
      demands.set(building.planetId, (demands.get(building.planetId) || 0) + demand);
    }
    for (const building of state.surfaceBuildings) {
      if (building.constructionState !== 'complete' || !state.factoryPlans[building.id]) continue;
      const graph = ensureGraph(state, building), available = power.get(building.planetId) || { unlimited: false, megawatts: 0 };
      const demand = Simulation.demand(graph), total = demands.get(building.planetId) || 0;
      Simulation.advance(graph, seconds, { energyUnlimited: available.unlimited,
        energyAvailableMW: total > Stack.EPSILON ? available.megawatts * demand / total : 0 });
      building.energyUse = graph.energyUsedMW * 1e6;
      building.flowPerMinute = graph.nodes.filter(node => ['extractor', 'oil_platform'].includes(building.type)
        ? Graph.definitionOf(node).operation === 'source' : node.type === 'dock')
        .reduce((sum, node) => sum + node.telemetry.outputRate * 60, 0);
      building.inventory = {};
      for (const stack of [...graph.externalStock, ...graph.exportStock, ...graph.retainedWaste]) {
        building.inventory[stack.resourceId] = (building.inventory[stack.resourceId] || 0) + stack.amount;
      }
      building.status = graph.nodes.some(node => ['active', 'degraded', 'useless', 'destructive'].includes(node.state)) ? 'active' : 'waiting';
    }
  }

  function advance(state, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Industry duration must be finite and non-negative');
    state.industryAccumulator = (state.industryAccumulator || 0) + seconds;
    let count = 0;
    while (state.industryAccumulator + Stack.EPSILON >= Data.config.fixedStepSeconds && count < Data.config.maxTicksPerAdvance) {
      step(state, Data.config.fixedStepSeconds);
      state.industryAccumulator = Math.max(0, state.industryAccumulator - Data.config.fixedStepSeconds); count++;
    }
  }

  function reclaimBuilding(state, building) {
    const graph = state.factoryPlans[building.id];
    if (!graph) return;
    const resolved = ensureGraph(state, building);
    const stocks = [...resolved.externalStock, ...resolved.exportStock, ...resolved.retainedWaste];
    for (const node of resolved.nodes) stocks.push(...node.internalBuffer.inputs, ...node.internalBuffer.outputs,
      node.internalBuffer.history, ...(node.internalBuffer.ingredientCredits || []),
      ...(node.internalBuffer.yieldRemainders || []).map(item => item.stack), ...(node.job?.inputs || []));
    state.colonyMaterials ||= [];
    for (const stack of stocks.filter(Boolean)) {
      Stack.addToStock(state.colonyMaterials, stack);
      root.OrbitInventory.add(state.inventory, { [legacyInventoryId(stack.resourceId)]: stack.amount });
    }
    delete state.factoryPlans[building.id];
  }
  root.OrbitIndustry = Object.freeze({ ensureGraph, supply, advance, reclaimBuilding, geology });
})(globalThis);
