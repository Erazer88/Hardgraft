(function (root) {
  'use strict';
  const Data = root.OrbitProcessData, Stack = root.OrbitResourceStack;
  const clone = value => JSON.parse(JSON.stringify(value));
  const number = (value, fallback = 0) => Number.isFinite(value) && value >= 0 ? value : fallback;
  const unknown = Object.freeze({ id: 'unsupported', label: 'BLOC NON RECONNU', mark: '?', detail: 'Ancien bloc conservé',
    inputs: 0, outputs: 0, inputPorts: [], outputPorts: [], recipes: [], operation: 'disabled',
    processingTime: 1, energyUse: 0, baseThroughput: 0, inputCapacity: 20, outputCapacity: 20 });
  const definitionOf = node => Data.get(node.type) || unknown;
  const normalizeStock = value => Array.isArray(value) ? value.map(Stack.create).filter(Boolean) : [];

  function createBlock(value) {
    const definition = Data.get(value.type), type = definition?.id || value.type;
    const sourceBuffer = value.internalBuffer || {};
    const inputs = Array.from({ length: Math.max(definition?.inputs || 0, sourceBuffer.inputs?.length || 0) },
      (_, index) => Stack.create(sourceBuffer.inputs?.[index]));
    const outputs = Array.from({ length: Math.max(definition?.outputs || 0, sourceBuffer.outputs?.length || 0) },
      (_, index) => Stack.create(sourceBuffer.outputs?.[index]));
    const job = value.job && Array.isArray(value.job.outputs) ? {
      recipeId: value.job.recipeId || null, mode: value.job.mode || 'valid', message: String(value.job.message || ''),
      remainingSeconds: number(value.job.remainingSeconds), duration: Math.max(.01, number(value.job.duration, 1)),
      energyUse: number(value.job.energyUse),
      inputs: normalizeStock(value.job.inputs),
      outputs: value.job.outputs.flatMap(item => {
        const stack = Stack.create(item.stack);
        return stack && Number.isInteger(item.port) ? [{ port: item.port, stack }] : [];
      }), destination: value.job.destination || null, geologicalSource: value.job.geologicalSource === true
    } : null;
    const settings = value.settings || {};
    return { id: value.id, type, x: number(value.x, 24), y: number(value.y, 24),
      inputPorts: clone(definition?.inputPorts || []), outputPorts: clone(definition?.outputPorts || []),
      internalBuffer: { inputs, outputs, history: Stack.create(sourceBuffer.history) },
      processingTime: definition?.processingTime || 1, energyUse: definition?.energyUse || 0,
      recipes: definition?.recipes || [], settings: {
        ratio: Number.isFinite(settings.ratio) ? Math.max(0, Math.min(1, settings.ratio)) : .5,
        phase: ['solid', 'liquid', 'gas'].includes(settings.phase) ? settings.phase : definition?.storagePhase || 'solid',
        filter: typeof settings.filter === 'string' && settings.filter ? root.OrbitResourceData.canonicalId(settings.filter) : null
      }, job, state: definition ? 'waiting' : 'incompatible',
      message: definition ? '' : 'Type inconnu : matière conservée, aucun traitement automatique.',
      recipeId: null, mode: 'valid', telemetry: { inputRate: 0, outputRate: 0, energyMW: 0,
        inputAmounts: {}, outputAmounts: {} } };
  }

  function create(value = {}) {
    const ids = new Set();
    const nodes = (Array.isArray(value.nodes) ? value.nodes : []).flatMap(node => {
      if (!node || typeof node.id !== 'string' || typeof node.type !== 'string' || ids.has(node.id)) return [];
      ids.add(node.id); return [createBlock(node)];
    });
    const graph = { version: Data.config.version, nodes, connections: [],
      externalStock: normalizeStock(value.externalStock), exportStock: normalizeStock(value.exportStock),
      retainedWaste: normalizeStock(value.retainedWaste), inputCapacity: Data.config.buildingInputCapacity,
      exportCapacity: Data.config.buildingExportCapacity, geology: value.geology ? clone(value.geology) : null,
      energyUnlimited: false, energyAvailableMW: number(value.energyAvailableMW), energyDemandMW: 0, energyUsedMW: 0,
      accumulator: number(value.accumulator), tick: number(value.tick), totalExtracted: number(value.totalExtracted),
      technologyLevel: Math.max(1, Math.floor(number(value.technologyLevel, 1))),
      diagnostics: [] };
    for (const connection of Array.isArray(value.connections) ? value.connections : []) {
      const result = connect(graph, connection);
      if (!result.ok) graph.diagnostics.push(result.reason);
    }
    return graph;
  }

  function connect(graph, connection) {
    if (!connection || typeof connection !== 'object') return { ok: false, reason: 'Connexion invalide.' };
    if (graph.connections.length >= Data.config.maxConnections) return { ok: false, reason: 'Limite de connexions atteinte.' };
    const source = graph.nodes.find(node => node.id === connection.fromNodeId);
    const target = graph.nodes.find(node => node.id === connection.toNodeId);
    const from = source && (connection.fromPortId ? source.outputPorts.findIndex(port => port.id === connection.fromPortId) :
      Number.isInteger(connection.fromPort) ? connection.fromPort : source.outputPorts.findIndex(port => port.id === connection.fromPort));
    const to = target && (connection.toPortId ? target.inputPorts.findIndex(port => port.id === connection.toPortId) :
      Number.isInteger(connection.toPort) ? connection.toPort : target.inputPorts.findIndex(port => port.id === connection.toPort));
    if (!source || !target || source === target || !Number.isInteger(from) || !Number.isInteger(to) ||
        !source.outputPorts[from] || !target.inputPorts[to]) return { ok: false, reason: 'Connexion structurellement impossible.' };
    if (graph.connections.some(link => link.fromNodeId === source.id && link.fromPort === from)) {
      return { ok: false, reason: 'Sortie déjà reliée : utilisez un bloc Division.' };
    }
    if (graph.connections.some(link => link.toNodeId === target.id && link.toPort === to)) {
      return { ok: false, reason: 'Entrée déjà reliée : utilisez un bloc Fusion.' };
    }
    if (typeof connection.id !== 'string' || graph.connections.some(link => link.id === connection.id)) {
      return { ok: false, reason: 'Identifiant de connexion invalide ou dupliqué.' };
    }
    graph.connections.push({ id: connection.id, fromNodeId: source.id, fromPort: from,
      toNodeId: target.id, toPort: to, fromPortId: source.outputPorts[from].id,
      toPortId: target.inputPorts[to].id, resourceId: null, currentThroughput: 0,
      maxThroughput: Math.min(source.outputPorts[from].maxThroughput, target.inputPorts[to].maxThroughput),
      state: 'waiting', message: '' });
    return { ok: true };
  }

  function lockedResource(node) {
    return [...node.internalBuffer.inputs, ...node.internalBuffer.outputs,
      ...(node.job?.outputs.map(item => item.stack) || [])].find(Boolean)?.resourceId || null;
  }

  function acceptance(node, portIndex, stack) {
    const port = node.inputPorts[portIndex], definition = definitionOf(node), resource = root.OrbitResourceData.get(stack.resourceId);
    if (!port) return { ok: false, state: 'incompatible', kind: 'impossible', reason: 'Ce bloc ne possède pas cette entrée.' };
    const phases = node.type === 'storage' ? [node.settings.phase || 'solid'] : port.phases;
    if (!resource || !phases.includes(resource.phase)) {
      return { ok: false, state: 'incompatible', kind: 'impossible', reason: 'État physique incompatible avec ce port.' };
    }
    if (port.compatibilityMode === 'strict' && (port.acceptedResources.length || port.acceptedTags.length) &&
        !port.acceptedResources.includes(stack.resourceId) && !port.acceptedTags.some(tag => stack.tags.includes(tag))) {
      return { ok: false, state: 'incompatible', kind: 'incompatible', reason: `Le port ${port.id} n’accepte pas cette matière.` };
    }
    if (['filter', 'dock', 'storage'].includes(node.type) && node.settings.filter && node.settings.filter !== stack.resourceId) {
      return { ok: false, state: 'incompatible', kind: 'incompatible', reason: 'Matière refusée par le filtre du bloc.' };
    }
    const current = node.internalBuffer.inputs[portIndex];
    const lock = ['storage', 'merger'].includes(node.type) ? lockedResource(node) : current?.resourceId;
    if (lock && lock !== stack.resourceId) return { ok: false, state: 'incompatible', kind: 'incompatible',
      reason: node.type === 'merger' ? 'Fusion refusée : les matières diffèrent.' : 'Une autre matière occupe ce stock.' };
    const capacity = Math.max(0, definition.inputCapacity - (current?.amount || 0));
    return capacity > Stack.EPSILON ? { ok: true, capacity } :
      { ok: false, state: 'saturated', kind: 'capacity', reason: 'Buffer d’entrée plein.' };
  }

  function outputRoom(node, index, stack) {
    const current = node.internalBuffer.outputs[index];
    if (current && stack && current.resourceId !== stack.resourceId) return 0;
    return Math.max(0, definitionOf(node).outputCapacity - (current?.amount || 0));
  }

  function salvage(graph, stack) {
    if (!stack) return;
    const room = Math.max(0, graph.inputCapacity - Stack.total(graph.externalStock));
    const stored = Math.min(room, stack.amount);
    if (stored > Stack.EPSILON) Stack.addToStock(graph.externalStock, Stack.portion(stack, stored));
    if (stack.amount - stored > Stack.EPSILON) Stack.addToStock(graph.retainedWaste,
      Stack.convert(stack, 'waste', stack.amount - stored));
  }

  function removeNode(graph, id) {
    const node = graph.nodes.find(item => item.id === id);
    if (!node) return false;
    [...node.internalBuffer.inputs, ...node.internalBuffer.outputs, node.internalBuffer.history,
      ...(node.job?.inputs || [])].forEach(stack => salvage(graph, stack));
    graph.nodes = graph.nodes.filter(item => item !== node);
    graph.connections = graph.connections.filter(link => link.fromNodeId !== id && link.toNodeId !== id);
    return true;
  }

  function snapshot(graph) {
    return { version: graph.version, accumulator: graph.accumulator, tick: graph.tick,
      totalExtracted: graph.totalExtracted, technologyLevel: graph.technologyLevel,
      geology: graph.geology ? clone(graph.geology) : null,
      externalStock: clone(graph.externalStock), exportStock: clone(graph.exportStock), retainedWaste: clone(graph.retainedWaste),
      nodes: graph.nodes.map(node => ({ id: node.id, type: node.type, x: node.x, y: node.y,
        settings: clone(node.settings), internalBuffer: clone(node.internalBuffer), job: node.job ? clone(node.job) : null })),
      connections: graph.connections.map(link => ({ id: link.id, fromNodeId: link.fromNodeId,
        fromPort: link.fromPort, fromPortId: link.fromPortId, toNodeId: link.toNodeId,
        toPort: link.toPort, toPortId: link.toPortId })) };
  }
  function materialTotal(graph) {
    return Stack.total([...graph.externalStock, ...graph.exportStock, ...graph.retainedWaste]) +
      graph.nodes.reduce((sum, node) => sum + Stack.total([...node.internalBuffer.inputs, ...node.internalBuffer.outputs,
        node.internalBuffer.history, ...(node.job?.inputs || [])]), 0);
  }
  root.OrbitProcessBlock = Object.freeze({ create: createBlock });
  root.OrbitProcessGraph = Object.freeze({ create, snapshot, connect, acceptance, outputRoom, removeNode,
    definitionOf, materialTotal, salvage, lockedResource });
})(globalThis);
