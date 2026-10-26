(function (root) {
  'use strict';

  const Data = root.OrbitProcessData;
  const Graph = root.OrbitProcessGraph;
  const Simulation = root.OrbitProcessSimulation;
  const Stack = root.OrbitResourceStack;

  function fraction(seed) {
    let hash = 2166136261;
    for (const letter of String(seed)) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
    return (hash >>> 0) / 4294967296;
  }

  function geology(state, building) {
    if (!['extractor', 'oil_platform'].includes(building.type) || !building.resourceId) return null;
    const id = `${building.planetId}:${building.resourceId}:${building.x.toFixed(3)}:${building.y.toFixed(3)}`;
    return { id, planetId: building.planetId, resourceId: building.resourceId,
      hardness: Data.config.geology.hardnessRange[0] + fraction(state.seed + id) *
        (Data.config.geology.hardnessRange[1] - Data.config.geology.hardnessRange[0]),
      share: Number.isFinite(building.resourceShare) ? building.resourceShare : Data.config.geology.defaultShare };
  }

  function ensureGraph(state, building) {
    const ground = geology(state, building);
    const previous = state.factoryPlans[building.id];
    if (!previous || previous.version !== Data.config.version || !Array.isArray(previous.machines) ||
        (ground && previous.geology?.resourceId !== ground.resourceId)) {
      state.factoryPlans[building.id] = Graph.create({ version: Data.config.version,
        geology: ground });
    }
    const graph = state.factoryPlans[building.id];
    graph.geology ||= ground;
    for (const machine of graph.machines) {
      if (!Graph.definitionOf(machine).externalInput) continue;
      machine.outputBuffer.material ||= 0;
      if (!machine.importResourceId) {
        machine.importResourceId = Object.keys(building.inventory || {}).sort()
          .find(resourceId => Number.isInteger(building.inventory[resourceId]) && building.inventory[resourceId] > 0) || null;
      }
    }
    return graph;
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
      if (building.type === 'geothermal') {
        building.energyOutputWatts = Data.config.geothermalPowerMW * 1e6;
        entry.megawatts += Data.config.geothermalPowerMW;
      }
      power.set(building.planetId, entry);
      const savedGraph = state.factoryPlans[building.id];
      if (!savedGraph) continue;
      const graph = ensureGraph(state, building), demand = Simulation.demand(graph, building.inventory);
      demands.set(building.planetId, (demands.get(building.planetId) || 0) + demand);
    }

    for (const building of state.surfaceBuildings) {
      if (building.constructionState !== 'complete' || !state.factoryPlans[building.id]) continue;
      const graph = ensureGraph(state, building);
      const available = power.get(building.planetId) || { unlimited: false, megawatts: 0 };
      const demand = Simulation.demand(graph, building.inventory), planetDemand = demands.get(building.planetId) || 0;
      Simulation.advance(graph, seconds, {
        energyUnlimited: available.unlimited,
        externalStock: building.inventory ||= {},
        energyAvailableMW: planetDemand > 1e-9 ? available.megawatts * demand / planetDemand : 0
      });
      building.energyUse = graph.energyUsedMW * 1e6;
      building.flowPerMinute = graph.machines.reduce((sum, machine) => {
        return Graph.definitionOf(machine).externalOutput ? sum + machine.currentRate * 60 : sum;
      }, 0);
      building.dockFlowByResource = dockFlowByResource(building, graph);
      collectDockedResources(building, graph);
      building.status = graph.machines.some(machine => machine.state === 'active') ? 'active' : 'waiting';
    }
  }

  function collectDockedResources(building, graph) {
    building.dockStock ||= {};
    for (const machine of graph.machines) {
      const definition = Graph.definitionOf(machine);
      if (!definition.externalOutput) continue;
      const input = definition.inputPorts[0];
      const amount = machine.inputBuffer[input.id] || 0;
      if (!amount) continue;
      const connection = graph.connections.find(item => item.toMachineId === machine.id && item.toInputId === input.id);
      const source = connection && graph.machines.find(item => item.id === connection.fromMachineId);
      const resource = source && Graph.definitionOf(source).outputPorts
        .find(port => port.id === connection.fromOutputId)?.resourceId;
      if (!resource) continue;
      building.dockStock[resource] = (building.dockStock[resource] || 0) + amount;
      machine.inputBuffer[input.id] = 0;
    }
  }

  function dockFlowByResource(building, graph) {
    const rates = {};
    for (const machine of graph.machines) {
      const definition = Graph.definitionOf(machine);
      if (!definition.externalOutput) continue;
      const input = definition.inputPorts[0];
      const connection = graph.connections.find(item => item.toMachineId === machine.id && item.toInputId === input.id);
      const source = connection && graph.machines.find(item => item.id === connection.fromMachineId);
      const resource = source && Graph.definitionOf(source).outputPorts
        .find(port => port.id === connection.fromOutputId)?.resourceId;
      if (resource) rates[resource] = (rates[resource] || 0) + Math.max(0, machine.currentRate || 0);
    }
    return rates;
  }

  function advance(state, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Industry duration must be finite and non-negative');
    state.industryAccumulator = (state.industryAccumulator || 0) + seconds;
    let count = 0;
    while (state.industryAccumulator + 1e-9 >= Data.config.fixedStepSeconds && count < Data.config.maxTicksPerAdvance) {
      step(state, Data.config.fixedStepSeconds);
      state.industryAccumulator = Math.max(0, state.industryAccumulator - Data.config.fixedStepSeconds);
      count++;
    }
  }

  function reclaimBuilding(state, building) {
    const graph = state.factoryPlans[building.id];
    state.colonyMaterials ||= [];
    if (graph) {
      const resolved = ensureGraph(state, building);
      for (const machine of resolved.machines) {
        const def = Graph.definitionOf(machine);
        for (const input of def.inputPorts) {
          const amount = machine.inputBuffer[input.id];
          const connection = graph.connections.find(item => item.toMachineId === machine.id && item.toInputId === input.id);
          const source = connection && resolved.machines.find(item => item.id === connection.fromMachineId);
          const resourceId = input.resourceId || (source && Graph.definitionOf(source).outputPorts
            .find(port => port.id === connection.fromOutputId)?.resourceId);
          if (amount && resourceId) Stack.addToStock(state.colonyMaterials, Stack.create({ resourceId,
            amount, origin: { kind: 'building', id: building.id } }));
        }
        for (const output of def.outputPorts) {
          const amount = machine.outputBuffer[output.id];
          if (amount) Stack.addToStock(state.colonyMaterials, Stack.create({ resourceId: output.resourceId,
            amount, origin: { kind: 'building', id: building.id } }));
        }
        for (const [resourceId, amount] of Object.entries(machine.storedResources || {})) {
          if (amount) Stack.addToStock(state.colonyMaterials, Stack.create({ resourceId,
            amount, origin: { kind: 'building', id: building.id } }));
        }
      }
      delete state.factoryPlans[building.id];
    }
    for (const [resourceId, amount] of Object.entries(building.inventory || {})) {
      if (Number.isInteger(amount) && amount > 0) Stack.addToStock(state.colonyMaterials,
        Stack.create({ resourceId, amount, origin: { kind: 'building', id: building.id } }));
    }
    for (const [resourceId, amount] of Object.entries(building.dockStock || {})) {
      if (Number.isInteger(amount) && amount > 0) Stack.addToStock(state.colonyMaterials,
        Stack.create({ resourceId, amount, origin: { kind: 'building', id: building.id } }));
    }
    for (const [resourceId, amount] of Object.entries(building.launchStock || {})) {
      if (Number.isInteger(amount) && amount > 0) Stack.addToStock(state.colonyMaterials,
        Stack.create({ resourceId, amount, origin: { kind: 'building', id: building.id } }));
    }
  }

  root.OrbitIndustry = Object.freeze({ ensureGraph, advance, reclaimBuilding, geology });
})(globalThis);
