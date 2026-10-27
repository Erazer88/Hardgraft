(function (root) {
  'use strict';

  const Data = root.OrbitProcessData;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const integer = (value, fallback = 0) => Number.isFinite(value) && value >= 0
    ? Math.floor(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function definitionOf(machine) {
    const definition = Data.get(machine?.type, machine?.resourceId);
    if (!definition?.externalInput) return definition;
    const resourceId = machine.importResourceId || null;
    return { ...definition, outputPorts: [{ ...definition.outputPorts[0], resourceId,
      label: root.OrbitResourceData.get(resourceId)?.label || 'Ressource reçue' }] };
  }

  function createMachine(value = {}, geologyResourceId = null) {
    const resourceId = value.resourceId || geologyResourceId || 'iron';
    const definition = Data.get(value.type, resourceId);
    if (!definition || typeof value.id !== 'string' || !value.id) return null;
    const inputBuffer = {}, outputBuffer = {};
    for (const port of definition.inputPorts) inputBuffer[port.id] = integer(value.inputBuffer?.[port.id]);
    for (const port of definition.outputPorts) outputBuffer[port.id] = integer(value.outputBuffer?.[port.id]);
    return {
      id: value.id,
      type: definition.id,
      resourceId,
      ...(definition.externalInput ? { importResourceId: typeof value.importResourceId === 'string' ? value.importResourceId : null } : {}),
      x: Number.isFinite(value.x) ? value.x : 80,
      y: Number.isFinite(value.y) ? value.y : 80,
      inputBuffer,
      outputBuffer,
      storedResources: Object.fromEntries(Object.entries(value.storedResources || {})
        .filter(([, amount]) => Number.isInteger(amount) && amount > 0)),
      ...(definition.routing ? { config: routingConfig(value.config) } : {}),
      cycleProgress: clamp(Number.isFinite(value.cycleProgress) ? value.cycleProgress : 0, 0, .999999),
      state: Data.statuses[value.state] ? value.state : 'waiting_input',
      currentRate: 0,
      energyMW: 0
    };
  }

  // Settings of a depot routing card: filtered resource, split share (% to
  // output A) and the destination building of an output gate.
  function routingConfig(value = {}) {
    const config = {};
    if (typeof value?.filterResourceId === 'string') config.filterResourceId = value.filterResourceId;
    if (Number.isFinite(value?.splitPercent)) config.splitPercent = clamp(Math.round(value.splitPercent), 0, 100);
    if (typeof value?.destinationId === 'string') config.destinationId = value.destinationId;
    return config;
  }

  function create(value = {}) {
    const current = value.version === Data.config.version && Array.isArray(value.machines);
    const geology = value.geology ? clone(value.geology) : null;
    const machines = current ? value.machines.map(machine => createMachine(machine, geology?.resourceId)).filter(Boolean) : [];
    const graph = {
      version: Data.config.version,
      machines,
      connections: [],
      geology,
      accumulator: current ? Math.max(0, Number(value.accumulator) || 0) : 0,
      tick: current ? integer(value.tick) : 0,
      energyUnlimited: false,
      energyAvailableMW: 0,
      energyDemandMW: 0,
      energyUsedMW: 0
    };
    if (current) {
      const machineIds = new Set(machines.map(machine => machine.id));
      for (const connection of value.connections || []) {
        if (!machineIds.has(connection?.fromMachineId) || !machineIds.has(connection?.toMachineId)) continue;
        connect(graph, connection);
      }
    }
    return graph;
  }

  function reaches(graph, startId, targetId) {
    const seen = new Set(), stack = [startId];
    while (stack.length) {
      const id = stack.pop();
      if (id === targetId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const connection of graph.connections) {
        if (connection.fromMachineId === id) stack.push(connection.toMachineId);
      }
    }
    return false;
  }

  // An input that accepts a family: a tag, and optionally a material the
  // resource must contain (the waste of one ore line).
  function acceptsResource(accepts, resourceId) {
    const resource = root.OrbitResourceData?.get(resourceId);
    if (!resource) return false;
    if (accepts.tag && !resource.tags.includes(accepts.tag)) return false;
    return !accepts.composition || (resource.composition?.[accepts.composition] || 0) > 0;
  }

  function connect(graph, value) {
    if (!value || typeof value.id !== 'string' || !value.id ||
        ['fromMachineId', 'fromOutputId', 'toMachineId', 'toInputId']
          .some(key => typeof value[key] !== 'string' || !value[key])) {
      return { ok: false, reason: 'La connexion doit préciser ses deux machines et ses ports.' };
    }
    if (graph.connections.some(connection => connection.id === value.id)) {
      return { ok: false, reason: 'Identifiant de connexion déjà utilisé.' };
    }
    const from = graph.machines.find(machine => machine.id === value.fromMachineId);
    const to = graph.machines.find(machine => machine.id === value.toMachineId);
    if (!from || !to || from === to) return { ok: false, reason: 'Machine source ou destination invalide.' };
    const output = definitionOf(from).outputPorts.find(port => port.id === value.fromOutputId);
    const input = definitionOf(to).inputPorts.find(port => port.id === value.toInputId);
    if (!output || !input) return { ok: false, reason: 'Port de sortie ou d’entrée invalide.' };
    if (output.mixed || input.mixed) {
      // Depot routing cards pass mixed flows between each other only.
      if (!output.mixed || !input.mixed) return { ok: false, reason: 'Les cartes du dépôt se relient entre elles.' };
    } else {
      if (!output.resourceId) return { ok: false, reason: 'Choisissez une ressource reçue dans le quai d’entrée.' };
      if (!input.acceptsAnyResource && output.resourceId !== input.resourceId) {
        return { ok: false, reason: 'Ces ports ne transportent pas la même matière.' };
      }
      if (input.accepts && !acceptsResource(input.accepts, output.resourceId)) {
        return { ok: false, reason: input.accepts.composition
          ? 'Cette carte ne retraite que les déchets de sa filière.' : 'Cette carte n’accepte que des déchets.' };
      }
    }
    if (graph.connections.some(connection => connection.fromMachineId === from.id && connection.fromOutputId === output.id)) {
      return { ok: false, reason: 'Cette sortie est déjà reliée.' };
    }
    if (!input.mixed && (!definitionOf(to).sink || definitionOf(to).externalOutput) && graph.connections.some(connection =>
      connection.toMachineId === to.id && connection.toInputId === input.id)) {
      return { ok: false, reason: 'Cette entrée est déjà reliée.' };
    }
    if (reaches(graph, to.id, from.id)) return { ok: false, reason: 'Les boucles sont désactivées dans l’usine V1.' };
    graph.connections.push({ id: value.id, fromMachineId: from.id, fromOutputId: output.id,
      toMachineId: to.id, toInputId: input.id });
    return { ok: true, connection: graph.connections.at(-1) };
  }

  function addMachine(graph, value) {
    const machine = createMachine(value, graph.geology?.resourceId);
    if (!machine || graph.machines.some(item => item.id === machine.id)) return { ok: false, reason: 'Machine invalide.' };
    graph.machines.push(machine);
    return { ok: true, machine };
  }

  function removeMachine(graph, id) {
    const machine = graph.machines.find(item => item.id === id);
    if (!machine) return { ok: false, reason: 'Machine introuvable.' };
    const discardedUnits = [...Object.values(machine.inputBuffer), ...Object.values(machine.outputBuffer),
      ...Object.values(machine.storedResources)]
      .reduce((sum, amount) => sum + amount, 0);
    graph.machines = graph.machines.filter(item => item !== machine);
    graph.connections = graph.connections.filter(connection =>
      connection.fromMachineId !== id && connection.toMachineId !== id);
    return { ok: true, discardedUnits };
  }

  function topologicalOrder(graph) {
    const incoming = new Map(graph.machines.map(machine => [machine.id, 0]));
    for (const connection of graph.connections) incoming.set(connection.toMachineId,
      (incoming.get(connection.toMachineId) || 0) + 1);
    const ready = graph.machines.filter(machine => incoming.get(machine.id) === 0);
    const order = [];
    while (ready.length) {
      const machine = ready.shift(); order.push(machine);
      for (const connection of graph.connections) {
        if (connection.fromMachineId !== machine.id) continue;
        const degree = incoming.get(connection.toMachineId) - 1;
        incoming.set(connection.toMachineId, degree);
        if (!degree) ready.push(graph.machines.find(item => item.id === connection.toMachineId));
      }
    }
    return order.length === graph.machines.length ? order : [];
  }

  function snapshot(graph) {
    return {
      version: graph.version,
      accumulator: graph.accumulator,
      tick: graph.tick,
      geology: clone(graph.geology),
      machines: graph.machines.map(machine => ({ id: machine.id, type: machine.type,
        resourceId: machine.resourceId,
        ...(definitionOf(machine).externalInput ? { importResourceId: machine.importResourceId } : {}),
        x: machine.x, y: machine.y, inputBuffer: clone(machine.inputBuffer),
        outputBuffer: clone(machine.outputBuffer), cycleProgress: machine.cycleProgress,
        storedResources: clone(machine.storedResources),
        ...(machine.config ? { config: clone(machine.config) } : {}),
        state: machine.state })),
      connections: graph.connections.map(connection => ({ id: connection.id,
        fromMachineId: connection.fromMachineId, fromOutputId: connection.fromOutputId,
        toMachineId: connection.toMachineId, toInputId: connection.toInputId }))
    };
  }

  root.OrbitProcessBlock = Object.freeze({ create: createMachine });
  root.OrbitProcessGraph = Object.freeze({ create, snapshot, connect, addMachine, removeMachine,
    definitionOf, topologicalOrder, acceptsResource });
})(globalThis);
