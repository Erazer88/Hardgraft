(function (root) {
  'use strict';

  const Data = root.OrbitProcessData, Graph = root.OrbitProcessGraph, Stack = root.OrbitResourceStack;
  const WORLD = Data.config.world;
  const NODE = Object.freeze({ width: 220, height: 156 });
  const CAMERA_MIN_SCALE = .12, CAMERA_MAX_SCALE = 3.2;
  const TYPES = Data.definitions;
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const fmt = value => numberFormat.format(Number.isFinite(value) ? value : 0);
  const resourceName = id => root.OrbitResourceData.get(id)?.label || id || '—';
  const phaseName = phase => ({ solid: 'solide', liquid: 'liquide', gas: 'gaz' })[phase] || phase;

  function create(document, { onSave = () => {}, isPaused = () => false,
    onSupply = () => ({ ok: false, message: 'Approvisionnement indisponible.' }) } = {}) {
    const $ = id => document.getElementById(id);
    const editor = $('factory-editor'), viewport = $('factory-viewport');
    const world = $('factory-world'), nodeLayer = $('factory-nodes');
    const linkLayer = $('factory-link-layer');
    const palette = $('factory-block-list');
    let activeBuilding = null, graph = null, nodes = [], connections = [];
    let selectedConnectionId = null;
    let selectedNodeId = null, pendingOutput = null, pendingPointer = null, pendingTarget = null;
    let drag = null, pinch = null, wireDrag = null;
    const activePointers = new Map();
    let transform = { x: 0, y: 0, scale: 1 }, nextNodeId = 1, nextConnectionId = 1;
    let zoomFrame = null;

    function typeOf(type) { return Graph.definitionOf({ type }); }

    function normalizePlan(value) {
      const live = value?.version === Data.config.version && Array.isArray(value.externalStock) &&
        value.nodes?.every(node => node.internalBuffer && node.telemetry);
      const plan = live ? value : Graph.create(value || {});
      for (const node of plan.nodes) {
        node.x = clamp(node.x, 8, WORLD.width - NODE.width - 8);
        node.y = clamp(node.y, 8, WORLD.height - NODE.height - 8);
      }
      return plan;
    }

    function writeStatus(message = 'PLAN ENREGISTRÉ') {
      $('factory-editor-status').textContent = message;
    }

    function stackSummary(stacks) {
      const present = stacks.filter(Boolean);
      return present.length ? present.map(stack => `${resourceName(stack.resourceId)} ${fmt(stack.amount)} u`).join(' · ') : '—';
    }

    function updateNodeReadout(card, node) {
      const definition = typeOf(node.type), set = (key, text) => {
        const target = card.querySelector(`[data-readout="${key}"]`); if (target) target.textContent = text;
      };
      card.dataset.state = node.state;
      set('state', Data.statuses[node.state] || node.state);
      set('input', `IN · ${definition.operation === 'source' ? 'Gisement' : stackSummary(node.internalBuffer.inputs.some(Boolean)
        ? node.internalBuffer.inputs : node.job?.inputs || [])}`);
      set('output', `${node.internalBuffer.outputs.some(Boolean) ? 'OUT' : node.job ? 'PRÉVU' : 'OUT'} · ${stackSummary(node.internalBuffer.outputs.some(Boolean) ? node.internalBuffer.outputs :
        node.job?.outputs.map(item => item.stack) || [])}`);
      set('rate', `${fmt(node.telemetry.outputRate)} u/s · ${fmt(node.telemetry.energyMW)} MW`);
      set('buffer', node.type === 'dump' ? `Terril · ${fmt(node.internalBuffer.history?.amount || 0)} u` :
        `Buffers · ${fmt(Stack.total(node.internalBuffer.inputs))} / ${definition.inputCapacity * node.inputPorts.length} u`);
      card.title = node.message || definition.detail;
    }

    function connectionReading(connection) {
      return `${resourceName(connection.resourceId)} · ${fmt(connection.currentThroughput)} / ${fmt(connection.maxThroughput)} u/s · ` +
        `${Data.statuses[connection.state] || connection.state}${connection.message ? ' · ' + connection.message : ''}`;
    }

    function detail(parent, label, value) {
      const row = document.createElement('div'); row.className = 'factory-detail-row';
      const name = document.createElement('small'), reading = document.createElement('span');
      name.textContent = label; reading.textContent = value; row.append(name, reading); parent.append(row);
    }

    function resourceSelector(value, onChange) {
      const select = document.createElement('select');
      const all = document.createElement('option'); all.value = ''; all.textContent = 'Toutes les matières'; select.append(all);
      for (const resource of root.OrbitResourceData.catalog().filter(item => !item.canonicalId)) {
        const option = document.createElement('option'); option.value = resource.id; option.textContent = resource.label; select.append(option);
      }
      select.value = value || ''; select.addEventListener('change', () => onChange(select.value || null));
      return select;
    }

    function renderNodeConfiguration(node, parent) {
      const field = (name, control) => {
        const label = document.createElement('label'); label.textContent = name; label.append(control); parent.append(label);
      };
      if (['input', 'dock', 'filter', 'storage'].includes(node.type)) {
        field('Filtre matière', resourceSelector(node.settings.filter, value => {
          node.settings.filter = value; savePlanStatus();
        }));
      }
      if (node.type === 'storage') {
        const select = document.createElement('select'); select.dataset.storagePhase = node.id;
        for (const [value, label] of [['solid', 'Solides'], ['liquid', 'Liquides'], ['gas', 'Gaz']]) {
          const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
        }
        select.value = node.settings.phase; select.disabled = Boolean(Graph.lockedResource(node));
        select.title = 'Videz le stock avant de changer son état physique.';
        select.addEventListener('change', () => {
          if (Graph.lockedResource(node)) return;
          node.settings.phase = select.value; savePlanStatus();
        });
        field('Type de stockage', select);
      }
      if (node.type === 'splitter') {
        const control = document.createElement('input'); control.type = 'range'; control.min = '0'; control.max = '100';
        control.value = String(Math.round(node.settings.ratio * 100));
        const caption = document.createElement('span');
        const update = () => { caption.textContent = `A ${control.value} % · B ${100 - Number(control.value)} % · redistribution automatique`; };
        update(); control.addEventListener('input', () => { node.settings.ratio = Number(control.value) / 100; update(); });
        control.addEventListener('change', savePlanStatus); field('Répartition', control); parent.append(caption);
      }
    }

    function renderInspector() {
      const panel = $('factory-process-details'), summary = $('factory-selected-summary');
      const node = nodes.find(item => item.id === selectedNodeId);
      const connection = connections.find(item => item.id === selectedConnectionId);
      panel.hidden = (!node && !connection) || !$('factory-stock-panel').hidden;
      if (panel.hidden) return;
      summary.replaceChildren();
      const selection = node ? node.id : connection.id;
      if (panel.dataset.selection !== selection) {
        panel.dataset.selection = selection; $('factory-selected-config').replaceChildren();
        if (node) renderNodeConfiguration(node, $('factory-selected-config'));
      }
      if (connection) {
        $('factory-selected-title').textContent = 'CONNEXION';
        const source = nodes.find(item => item.id === connection.fromNodeId), target = nodes.find(item => item.id === connection.toNodeId);
        detail(summary, 'Direction', `${typeOf(source.type).label} (${source.outputPorts[connection.fromPort].label}) → ${typeOf(target.type).label} (${target.inputPorts[connection.toPort].label})`);
        detail(summary, 'Ressource dominante', resourceName(connection.resourceId));
        detail(summary, 'Débit actuel / maximal', `${fmt(connection.currentThroughput)} / ${fmt(connection.maxThroughput)} u/s`);
        detail(summary, 'État', Data.statuses[connection.state] || connection.state);
        if (connection.message) detail(summary, 'Problème', connection.message);
        return;
      }
      const definition = typeOf(node.type), job = node.job;
      $('factory-selected-title').textContent = definition.label;
      detail(summary, 'État', Data.statuses[node.state] || node.state);
      detail(summary, 'Entrée actuelle', stackSummary(node.internalBuffer.inputs.some(Boolean) ? node.internalBuffer.inputs : job?.inputs || []));
      detail(summary, 'Sortie actuelle', stackSummary(node.internalBuffer.outputs));
      if (job) detail(summary, 'Production prévue', stackSummary(job.outputs.map(item => item.stack)));
      detail(summary, 'Débit', `${fmt(node.telemetry.outputRate)} / ${fmt(definition.baseThroughput)} u/s`);
      detail(summary, 'Énergie', `${fmt(node.telemetry.energyMW)} MW · nominal ${fmt(job?.energyUse ?? definition.energyUse)} MW`);
      detail(summary, 'Recette active', job ? `${[...new Set(job.inputs.map(stack => resourceName(stack.resourceId)))].join(' + ') || 'Gisement'} → ` +
        [...new Set(job.outputs.map(item => resourceName(item.stack.resourceId)))].join(' + ') : definition.detail);
      if (job?.inputs.length) detail(summary, 'Rendement utile', `${fmt(Stack.total(job.outputs.filter(item => item.port === 0).map(item => item.stack)) / Stack.total(job.inputs) * 100)} %`);
      detail(summary, 'Entrées attendues', definition.inputPorts.map(port => `${port.label} : ${port.acceptedResources.map(resourceName).join(', ') || port.phases.map(phaseName).join(', ')}`).join(' · ') || 'Aucune entrée matière');
      detail(summary, 'Sorties prévues', definition.outputPorts.map(port => port.label).join(' · ') ||
        (node.type === 'dump' ? 'Terril permanent' : 'Stock extérieur du quai'));
      if (node.message) detail(summary, 'Diagnostic', node.message);
      const materials = node.internalBuffer.inputs.filter(Boolean);
      if (materials.length) detail(summary, 'Préparation', materials.map(stack => `${resourceName(stack.resourceId)} · ` +
        `${({ impure: 'impur', standard: 'standard', superior: 'supérieur' })[stack.quality]} · ` +
        `${({ raw: 'brut', fragment: 'fragmenté', powder: 'poudre' })[stack.particleSize]} · humidité ${fmt(stack.moisture * 100)} %`).join(' / '));
      if (definition.operation === 'source' && graph.geology) detail(summary, 'Gisement',
        `${resourceName(graph.geology.resourceId)} · dureté ${fmt(graph.geology.hardness)} · débit géologique ${fmt(graph.geology.throughput)} u/s`);
      if (node.type === 'dump') {
        const history = node.internalBuffer.history;
        detail(summary, 'Historique conservé', history ? `${fmt(history.amount)} u · fer récupérable ${fmt(Stack.recoverableAmount(history, 'iron'))} u · cuivre ${fmt(Stack.recoverableAmount(history, 'copper'))} u` : 'Terril vide');
      }
      const phaseControl = panel.querySelector('[data-storage-phase]');
      if (phaseControl) phaseControl.disabled = Boolean(Graph.lockedResource(node));
    }

    function renderStocks() {
      const parent = $('factory-building-stocks'); if (!graph || $('factory-stock-panel').hidden) return;
      parent.replaceChildren();
      detail(parent, `ENTRÉE · ${fmt(Stack.total(graph.externalStock))} / ${graph.inputCapacity} u`, stackSummary(graph.externalStock));
      detail(parent, `QUAIS · ${fmt(Stack.total(graph.exportStock))} / ${graph.exportCapacity} u`, stackSummary(graph.exportStock));
      detail(parent, 'DÉCHETS DE RÉCUPÉRATION', stackSummary(graph.retainedWaste));
    }

    function refresh() {
      if (editor.hidden || !graph) return;
      for (const card of nodeLayer.children) {
        const node = nodes.find(item => item.id === card.dataset.nodeId); if (node) updateNodeReadout(card, node);
      }
      $('factory-energy-status').textContent = isPaused() ? 'SIMULATION EN PAUSE' : activeBuilding.constructionState !== 'complete' ? 'ASSEMBLAGE EN COURS' :
        `ÉNERGIE ${fmt(graph.energyUsedMW)} MW / ${graph.energyUnlimited ? '∞' : fmt(graph.energyAvailableMW) + ' MW'}`;
      if (!drag && !wireDrag && !pinch) renderConnections();
      renderInspector(); renderStocks();
    }

    function persistPlan() {
      if (!activeBuilding) return;
      graph.nodes = nodes; graph.connections = connections;
      onSave(activeBuilding.id, graph);
      writeStatus(graph.diagnostics.length ? 'MIGRATION : ' + graph.diagnostics[0] : 'PLAN ENREGISTRÉ');
    }

    function updateTransform() {
      world.style.transform = `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`;
    }

    function nodePoint(node, side, portIndex = 0) {
      const port = [...nodeLayer.querySelectorAll('.factory-port')].find(item =>
        item.dataset.nodeId === node.id && item.dataset.portSide === side &&
        Number(item.dataset.portIndex) === portIndex);
      if (!port) return { x: node.x, y: node.y + NODE.height / 2 };
      const bounds = port.getBoundingClientRect();
      return worldPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    }

    function drawConnection(connection, pending = false) {
      const source = nodes.find(node => node.id === connection.fromNodeId);
      if (!source) return;
      const start = nodePoint(source, 'output', connection.fromPort);
      const target = nodes.find(node => node.id === connection.toNodeId);
      const end = target ? nodePoint(target, 'input', connection.toPort || 0) : pendingPointer;
      if (!end) return;
      const bend = Math.max(44, Math.abs(end.x - start.x) * .46);
      const curve = `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
      if (!pending) {
        const hitPath = document.createElementNS(svgNamespace, 'path');
        hitPath.setAttribute('class', 'factory-link-hit');
        hitPath.dataset.connectionId = connection.id;
        hitPath.setAttribute('d', curve);
        linkLayer.append(hitPath);
      }
      const path = document.createElementNS(svgNamespace, 'path');
      path.setAttribute('class', pending ? 'factory-link pending' : 'factory-link');
      if (!pending) {
        path.dataset.connectionId = connection.id;
        const family = root.OrbitResourceData.get(connection.resourceId)?.family || 'mineral';
        path.dataset.family = family; path.dataset.state = connection.state;
        const title = document.createElementNS(svgNamespace, 'title');
        title.textContent = connectionReading(connection); path.append(title);
      }
      path.setAttribute('d', curve);
      linkLayer.append(path);
      if (!pending) {
        const label = document.createElementNS(svgNamespace, 'text');
        label.setAttribute('class', 'factory-link-label'); label.dataset.connectionId = connection.id;
        label.setAttribute('x', (start.x + end.x) / 2); label.setAttribute('y', (start.y + end.y) / 2 - 8);
        label.textContent = connection.resourceId ? `${resourceName(connection.resourceId)} · ${fmt(connection.currentThroughput)} / ${fmt(connection.maxThroughput)} u/s` : 'EN ATTENTE';
        linkLayer.append(label);
      }
    }

    function renderConnections() {
      linkLayer.replaceChildren();
      for (const connection of connections) drawConnection(connection);
      if (pendingOutput) drawConnection({ fromNodeId: pendingOutput.nodeId, fromPort: pendingOutput.port,
        toNodeId: pendingTarget?.nodeId, toPort: pendingTarget?.port || 0 }, true);
    }

    function createPort(side, node, index = 0) {
      const port = document.createElement('button');
      port.type = 'button';
      port.className = `factory-port ${side}`;
      port.dataset.portSide = side;
      port.dataset.nodeId = node.id;
      port.dataset.portIndex = String(index);
      const definition = (side === 'output' ? node.outputPorts : node.inputPorts)[index];
      port.style.top = `${54 + index * 32}px`;
      port.setAttribute('aria-label', `${side === 'output' ? 'Sortie' : 'Entrée'} ${definition.label} de ${typeOf(node.type).label}`);
      port.title = `${definition.label} · ${definition.maxThroughput} u/s · ${definition.acceptedResources.map(resourceName).join(', ') || definition.phases.map(phaseName).join(', ')}`;
      return port;
    }

    function createNodeElement(node) {
      const type = typeOf(node.type), card = document.createElement('article');
      card.className = `factory-node${node.id === selectedNodeId ? ' selected' : ''}`;
      card.dataset.nodeId = node.id;
      card.style.left = `${node.x}px`; card.style.top = `${node.y}px`;
      const header = document.createElement('div'); header.className = 'factory-node-header';
      const mark = document.createElement('span'); mark.className = 'factory-node-mark'; mark.textContent = type.mark;
      const title = document.createElement('strong'); title.textContent = type.label;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'factory-node-remove';
      remove.dataset.removeNode = node.id; remove.setAttribute('aria-label', `Supprimer ${type.label}`); remove.textContent = '×';
      header.append(mark, title, remove);
      const body = document.createElement('div'); body.className = 'factory-node-body';
      for (const key of ['state', 'input', 'output', 'rate', 'buffer']) {
        const reading = document.createElement('span'); reading.dataset.readout = key; body.append(reading);
      }
      card.append(header, body); updateNodeReadout(card, node);
      for (let index = 0; index < node.inputPorts.length; index++) card.append(createPort('input', node, index));
      for (let index = 0; index < node.outputPorts.length; index++) card.append(createPort('output', node, index));
      return card;
    }

    function renderNodes() {
      nodeLayer.replaceChildren(...nodes.map(createNodeElement));
      $('factory-empty').hidden = nodes.length > 0;
      renderConnections();
      renderInspector();
    }

    function updateNodePosition(node) {
      const element = [...nodeLayer.children].find(item => item.dataset.nodeId === node.id);
      if (element) { element.style.left = `${node.x}px`; element.style.top = `${node.y}px`; }
      renderConnections();
    }

    function savePlanStatus() {
      persistPlan();
      writeStatus('MODIFICATIONS ENREGISTRÉES');
    }

    function addNode(typeId) {
      const type = typeOf(typeId);
      if (!TYPES[typeId] || type.enabled === false || !activeBuilding) return;
      if (nodes.length >= Data.config.maxNodes) { writeStatus('Limite de blocs atteinte.'); return; }
      const index = nextNodeId++;
      const bounds = viewport.getBoundingClientRect();
      const centerX = (bounds.width / 2 - transform.x) / transform.scale;
      const centerY = (bounds.height / 2 - transform.y) / transform.scale;
      const previous = nodes[nodes.length - 1];
      const gap = 58;
      let x = previous ? previous.x + NODE.width + gap : centerX - NODE.width - gap / 2;
      let y = previous ? previous.y : centerY - NODE.height / 2;
      const visibleWorldRight = (bounds.width - transform.x) / transform.scale - NODE.width - 8;
      if (x > visibleWorldRight) {
        x = centerX - NODE.width - gap / 2;
        y = previous.y + NODE.height + 54;
        if (y + NODE.height > WORLD.height - 8) y = 16;
      }
      const node = root.OrbitProcessBlock.create({ id: `node-${index}`, type: typeId,
        x: clamp(x, 8, WORLD.width - NODE.width - 8),
        y: clamp(y, 8, WORLD.height - NODE.height - 8),
        settings: typeId === 'storage' && activeBuilding.type === 'oil_platform' ? { phase: 'liquid' } : {} });
      nodes.push(node); selectedNodeId = node.id;
      selectedConnectionId = null;
      pendingOutput = null; pendingPointer = null; pendingTarget = null; wireDrag = null;
      renderNodes(); savePlanStatus();
    }

    function removeNode(id) {
      graph.nodes = nodes; graph.connections = connections;
      Graph.removeNode(graph, id);
      nodes = graph.nodes; connections = graph.connections;
      if (selectedNodeId === id) selectedNodeId = null;
      if (pendingOutput?.nodeId === id || pendingTarget?.nodeId === id) {
        pendingOutput = null; pendingPointer = null; pendingTarget = null; wireDrag = null;
      }
      renderNodes(); savePlanStatus();
    }

    function availableInputPorts(node) {
      if (!node) return [];
      const inputCount = typeOf(node?.type)?.inputs || 0;
      const connected = new Set(connections.filter(connection => connection.toNodeId === node.id)
        .map(connection => connection.toPort));
      return Array.from({ length: inputCount }, (_, port) => port).filter(port => !connected.has(port));
    }

    function connectionTargetAt(clientX, clientY) {
      if (!pendingOutput) return null;
      const element = document.elementFromPoint(clientX, clientY);
      const port = element?.closest?.('.factory-port.input');
      if (port) {
        const node = nodes.find(item => item.id === port.dataset.nodeId);
        const portIndex = Number(port.dataset.portIndex) || 0;
        return node && node.id !== pendingOutput.nodeId && availableInputPorts(node).includes(portIndex)
          ? { nodeId: node.id, port: portIndex } : null;
      }
      const card = element?.closest?.('.factory-node');
      const node = card && nodes.find(item => item.id === card.dataset.nodeId);
      if (!node || node.id === pendingOutput.nodeId) return null;
      const inputs = availableInputPorts(node);
      if (inputs.length !== 1) return null;
      const bounds = card.getBoundingClientRect();
      const inCenter = clientX >= bounds.left + bounds.width * .22 &&
        clientX <= bounds.right - bounds.width * .22 &&
        clientY >= bounds.top + bounds.height * .18 &&
        clientY <= bounds.bottom - bounds.height * .18;
      return inCenter ? { nodeId: node.id, port: inputs[0] } : null;
    }

    function connectTo(targetNodeId, targetPort = 0) {
      if (!pendingOutput || pendingOutput.nodeId === targetNodeId) return;
      const source = nodes.find(node => node.id === pendingOutput.nodeId);
      const target = nodes.find(node => node.id === targetNodeId);
      if (!source || !target || !availableInputPorts(target).includes(targetPort)) {
        writeStatus('ENTRÉE DÉJÀ RELIÉE');
        pendingOutput = null; pendingPointer = null; pendingTarget = null; renderConnections(); return;
      }
      graph.connections = connections;
      const result = Graph.connect(graph, { id: `link-${nextConnectionId++}`, fromNodeId: source.id,
        fromPort: pendingOutput.port, toNodeId: target.id, toPort: targetPort });
      if (!result.ok) {
        writeStatus(result.reason); pendingOutput = null; pendingPointer = null; pendingTarget = null;
        wireDrag = null; renderConnections(); return;
      }
      connections = graph.connections;
      pendingOutput = null; pendingPointer = null; pendingTarget = null; wireDrag = null;
      selectedNodeId = target.id;
      selectedConnectionId = null;
      renderNodes(); savePlanStatus();
    }

    function updateWireDrag(event) {
      if (!wireDrag || wireDrag.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - wireDrag.startX, event.clientY - wireDrag.startY);
      if (!wireDrag.moved && distance <= 5) return;
      wireDrag.moved = true;
      if (wireDrag.connectionId && !wireDrag.detached) {
        connections = connections.filter(connection => connection.id !== wireDrag.connectionId);
        graph.connections = connections;
        wireDrag.detached = true;
      }
      pendingPointer = worldPoint(event.clientX, event.clientY);
      pendingTarget = connectionTargetAt(event.clientX, event.clientY);
      renderConnections();
    }

    function startExistingWireDrag(event, connection) {
      pendingOutput = { nodeId: connection.fromNodeId, port: connection.fromPort };
      pendingPointer = worldPoint(event.clientX, event.clientY);
      pendingTarget = { nodeId: connection.toNodeId, port: connection.toPort };
      wireDrag = { pointerId: event.pointerId, connectionId: connection.id,
        startX: event.clientX, startY: event.clientY, moved: false, detached: false };
      writeStatus('GLISSEZ LE TRAIT POUR LE DÉCONNECTER');
      event.preventDefault(); capture(event);
    }

    function applyCamera(scale, x, y) {
      transform.scale = scale;
      transform.x = x;
      transform.y = y;
      updateTransform();
    }

    function zoomAt(value, screenX, screenY) {
      const scale = clamp(value, CAMERA_MIN_SCALE, CAMERA_MAX_SCALE);
      const worldX = (screenX - transform.x) / transform.scale;
      const worldY = (screenY - transform.y) / transform.scale;
      applyCamera(scale, screenX - worldX * scale, screenY - worldY * scale);
    }

    function frameSavedPlan() {
      const minX = Math.min(...nodes.map(node => node.x)), minY = Math.min(...nodes.map(node => node.y));
      const maxX = Math.max(...nodes.map(node => node.x + NODE.width));
      const maxY = Math.max(...nodes.map(node => node.y + NODE.height));
      const scale = clamp(Math.min((viewport.clientWidth - 100) / (maxX - minX + 100),
        (viewport.clientHeight - 90) / (maxY - minY + 90)), CAMERA_MIN_SCALE, 1.25);
      applyCamera(scale, (viewport.clientWidth - (minX + maxX) * scale) / 2,
        (viewport.clientHeight - (minY + maxY) * scale) / 2);
    }

    function worldPoint(clientX, clientY) {
      const bounds = viewport.getBoundingClientRect();
      return { x: (clientX - bounds.left - transform.x) / transform.scale,
        y: (clientY - bounds.top - transform.y) / transform.scale };
    }

    function touchPoints() {
      return [...activePointers.entries()].filter(([, point]) => point.type === 'touch').slice(0, 2);
    }

    function cancelZoomFrame() {
      if (zoomFrame !== null) cancelAnimationFrame(zoomFrame);
      zoomFrame = null;
    }

    function updatePinchZoom() {
      if (!pinch) return;
      const [first, second] = pinch.pointerIds.map(pointerId => activePointers.get(pointerId));
      if (!first || !second) return;
      const bounds = viewport.getBoundingClientRect();
      const midpoint = { x: (first.x + second.x) / 2 - bounds.left,
        y: (first.y + second.y) / 2 - bounds.top };
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const scale = clamp(pinch.startScale * distance / pinch.startDistance,
        CAMERA_MIN_SCALE, CAMERA_MAX_SCALE);
      applyCamera(scale, midpoint.x - pinch.worldX * scale, midpoint.y - pinch.worldY * scale);
    }

    function queuePinchZoom() {
      if (zoomFrame !== null) return;
      zoomFrame = requestAnimationFrame(() => {
        zoomFrame = null;
        updatePinchZoom();
      });
    }

    function beginPinchZoom() {
      const points = touchPoints();
      if (points.length < 2) return false;
      const ids = points.map(([pointerId]) => pointerId);
      if (pinch && pinch.pointerIds.every(pointerId => ids.includes(pointerId))) return true;
      cancelZoomFrame();
      updatePinchZoom();
      if (drag?.kind === 'node' && drag.moved) savePlanStatus();
      if (wireDrag?.detached) savePlanStatus();
      drag = null; wireDrag = null;
      pendingOutput = null; pendingPointer = null; pendingTarget = null; renderConnections();
      const [[firstId, first], [secondId, second]] = points;
      const bounds = viewport.getBoundingClientRect();
      const midpoint = { x: (first.x + second.x) / 2 - bounds.left,
        y: (first.y + second.y) / 2 - bounds.top };
      pinch = { pointerIds: [firstId, secondId],
        startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        startScale: transform.scale,
        worldX: (midpoint.x - transform.x) / transform.scale,
        worldY: (midpoint.y - transform.y) / transform.scale };
      return true;
    }

    function capture(event) {
      try { viewport.setPointerCapture(event.pointerId); } catch (_) { /* Pointer capture is optional in older browsers. */ }
    }

    function onPointerDown(event) {
      if (event.target.closest?.('[data-remove-node]')) return;
      if (event.pointerType === 'touch') {
        activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
        if (touchPoints().length >= 2 && beginPinchZoom()) {
          capture(event); event.preventDefault(); return;
        }
        if (!event.isPrimary) { event.preventDefault(); return; }
      }
      const port = event.target.closest?.('[data-port-side]');
      if (port) {
        capture(event);
        event.preventDefault();
        const side = port.dataset.portSide, nodeId = port.dataset.nodeId;
        if (side === 'output') {
          pendingOutput = { nodeId, port: Number(port.dataset.portIndex) || 0 };
          pendingPointer = worldPoint(event.clientX, event.clientY);
          pendingTarget = null;
          wireDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
            moved: false, detached: false };
          selectedNodeId = nodeId;
          writeStatus('TOUCHEZ OU GLISSEZ VERS UNE ENTRÉE');
          renderNodes();
        } else if (pendingOutput) connectTo(nodeId, Number(port.dataset.portIndex) || 0);
        else {
          const connection = connections.find(item => item.toNodeId === nodeId &&
            item.toPort === (Number(port.dataset.portIndex) || 0));
          if (connection) startExistingWireDrag(event, connection);
        }
        return;
      }
      const link = event.target.closest?.('[data-connection-id]');
      if (link) {
        const connection = connections.find(item => item.id === link.dataset.connectionId);
        if (connection) {
          startExistingWireDrag(event, connection); return;
        }
      }
      const nodeElement = event.target.closest?.('[data-node-id]');
      if (nodeElement) {
        const node = nodes.find(item => item.id === nodeElement.dataset.nodeId);
        if (!node) return;
        selectedNodeId = node.id; selectedConnectionId = null; pendingOutput = null;
        $('factory-stock-panel').hidden = true;
        drag = { kind: 'node', pointerId: event.pointerId, nodeId: node.id, startX: event.clientX, startY: event.clientY,
          originX: node.x, originY: node.y, moved: false };
        nodeLayer.querySelectorAll('.factory-node').forEach(item =>
          item.classList.toggle('selected', item.dataset.nodeId === selectedNodeId));
        renderInspector();
        event.preventDefault(); capture(event); return;
      }
      pendingOutput = null; pendingPointer = null; pendingTarget = null; renderConnections();
      selectedNodeId = null; selectedConnectionId = null; renderInspector();
      nodeLayer.querySelectorAll('.factory-node').forEach(item => item.classList.remove('selected'));
      drag = { kind: 'pan', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
        originX: transform.x, originY: transform.y, moved: false };
      capture(event);
      event.preventDefault();
    }

    function onPointerMove(event) {
      const pointer = activePointers.get(event.pointerId);
      if (pointer) { pointer.x = event.clientX; pointer.y = event.clientY; }
      if (pinch) {
        if (pinch.pointerIds.includes(event.pointerId)) queuePinchZoom();
        event.preventDefault(); return;
      }
      if (wireDrag?.pointerId === event.pointerId) {
        updateWireDrag(event); event.preventDefault(); return;
      }
      if (!drag) {
        if (pendingOutput) { pendingPointer = worldPoint(event.clientX, event.clientY); renderConnections(); }
        return;
      }
      const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
      if (drag.kind === 'pan') {
        applyCamera(transform.scale, drag.originX + dx, drag.originY + dy);
        drag.moved ||= Math.abs(dx) + Math.abs(dy) > 2;
        event.preventDefault(); return;
      }
      if (drag.kind === 'node') {
        const node = nodes.find(item => item.id === drag.nodeId);
        if (!node) return;
        node.x = clamp(drag.originX + dx / transform.scale, 8, WORLD.width - NODE.width - 8);
        node.y = clamp(drag.originY + dy / transform.scale, 8, WORLD.height - NODE.height - 8);
        drag.moved ||= Math.abs(dx) + Math.abs(dy) > 2;
        updateNodePosition(node);
      }
    }

    function onPointerUp(event) {
      if (pinch?.pointerIds.includes(event.pointerId)) {
        const point = activePointers.get(event.pointerId);
        if (point && event.type !== 'pointercancel') {
          point.x = event.clientX; point.y = event.clientY;
        }
        cancelZoomFrame();
        updatePinchZoom();
        activePointers.delete(event.pointerId);
        pinch = null;
        const remaining = touchPoints();
        if (remaining.length === 1) {
          const [pointerId, point] = remaining[0];
          drag = { kind: 'pan', pointerId, startX: point.x, startY: point.y,
            originX: transform.x, originY: transform.y, moved: false };
        }
        return;
      }
      activePointers.delete(event.pointerId);
      if (pinch) return;
      if (wireDrag?.pointerId === event.pointerId) {
        if (event.type !== 'pointercancel') updateWireDrag(event);
        const completedWireDrag = wireDrag;
        wireDrag = null;
        if (event.type === 'pointercancel') {
          pendingOutput = null; pendingPointer = null; pendingTarget = null; renderConnections();
          if (completedWireDrag.detached) savePlanStatus();
        } else if (completedWireDrag.moved && pendingTarget) {
          connectTo(pendingTarget.nodeId, pendingTarget.port);
        } else if (completedWireDrag.moved) {
          pendingOutput = null; pendingPointer = null; pendingTarget = null; renderConnections();
          if (completedWireDrag.detached) savePlanStatus();
          writeStatus('Aucune entrée disponible au point de dépôt.');
        } else if (completedWireDrag.connectionId) {
          pendingOutput = null; pendingPointer = null; pendingTarget = null; renderConnections();
          selectedConnectionId = completedWireDrag.connectionId; selectedNodeId = null;
          $('factory-stock-panel').hidden = true; renderInspector();
        } else {
          pendingPointer = worldPoint(event.clientX, event.clientY);
          pendingTarget = null; renderConnections();
        }
        return;
      }
      if (drag?.kind === 'pan' && !activePointers.has(drag.pointerId)) drag = null;
      if (drag && drag.pointerId !== event.pointerId) return;
      if (drag?.kind === 'node' && drag.moved) savePlanStatus();
      drag = null;
    }

    function addPalette() {
      palette.replaceChildren();
      for (const type of Data.catalog(activeBuilding?.type || 'factory')) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'factory-block-add'; button.dataset.addNode = type.id;
        button.disabled = type.enabled === false;
        const icon = document.createElement('span'); icon.className = 'factory-block-icon'; icon.textContent = type.mark;
        const copy = document.createElement('span'); copy.className = 'factory-block-copy';
        const label = document.createElement('strong'); label.textContent = type.label;
        const detail = document.createElement('small'); detail.textContent = `${type.category} · ${type.detail}`;
        copy.append(label, detail); button.append(icon, copy); palette.append(button);
      }
    }

    function open(building, savedPlan) {
      cancelZoomFrame();
      activeBuilding = building;
      graph = normalizePlan(savedPlan); ({ nodes, connections } = graph);
      selectedConnectionId = null;
      $('factory-stock-panel').hidden = true; $('factory-process-details').dataset.selection = '';
      addPalette();
      selectedNodeId = null; pendingOutput = null; pendingPointer = null; pendingTarget = null;
      drag = null; pinch = null; wireDrag = null; activePointers.clear();
      nextNodeId = nodes.reduce((max, node) => Math.max(max, Number(node.id.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
      nextConnectionId = connections.reduce((max, connection) => Math.max(max, Number(connection.id.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
      const definition = root.OrbitBuildingData.get(building.type);
      $('factory-editor-title').textContent = building.customName || definition?.label || 'USINE';
      $('factory-editor-building-type').textContent = `${definition?.label || 'BÂTIMENT'} · NIVEAU ${building.upgradeLevel || 1}`;
      editor.hidden = false;
      document.body.classList.add('factory-editor-open');
      transform.scale = 1;
      transform.x = viewport.clientWidth / 2 - WORLD.width * transform.scale / 2;
      transform.y = viewport.clientHeight / 2 - WORLD.height * transform.scale / 2;
      updateTransform();
      renderNodes();
      if (nodes.length) frameSavedPlan();
      writeStatus(graph.diagnostics.length ? 'MIGRATION : ' + graph.diagnostics[0] : 'PLAN ENREGISTRÉ');
      refresh();
      $('factory-editor-close').focus();
    }

    function close() {
      if (editor.hidden) return;
      cancelZoomFrame();
      persistPlan();
      editor.hidden = true; document.body.classList.remove('factory-editor-open');
      activeBuilding = null; drag = null; pinch = null; wireDrag = null; activePointers.clear();
      graph = null; nodes = []; connections = [];
      $('factory-stock-panel').hidden = true; $('factory-process-details').hidden = true;
      pendingOutput = null; pendingPointer = null; pendingTarget = null;
      $('factory-edit-button').focus();
    }

    palette.addEventListener('click', event => {
      const button = event.target.closest('[data-add-node]');
      if (button) addNode(button.dataset.addNode);
    });
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
    viewport.addEventListener('wheel', event => {
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientHeight : 1;
      zoomAt(transform.scale * Math.exp(-event.deltaY * unit * .0012),
        event.clientX - bounds.left, event.clientY - bounds.top);
    }, { passive: false });
    viewport.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-node]');
      if (button) removeNode(button.dataset.removeNode);
    });
    $('factory-stock-toggle').addEventListener('click', () => {
      const panel = $('factory-stock-panel'); panel.hidden = !panel.hidden;
      renderInspector(); renderStocks();
    });
    $('factory-stocks-close').addEventListener('click', () => { $('factory-stock-panel').hidden = true; renderInspector(); });
    $('factory-details-close').addEventListener('click', () => {
      selectedNodeId = null; selectedConnectionId = null; renderInspector();
      nodeLayer.querySelectorAll('.factory-node').forEach(item => item.classList.remove('selected'));
    });
    for (const resource of root.OrbitResourceData.catalog().filter(item => !item.canonicalId)) {
      const option = document.createElement('option'); option.value = resource.id; option.textContent = resource.label;
      $('factory-supply-resource').append(option);
    }
    $('factory-supply-resource').value = 'water';
    $('factory-reserve-label').textContent = Data.config.colonyReserveInfinite ? 'RÉSERVE COLONIE ∞ · MODE V1' : 'RÉSERVE DE LA COLONIE';
    $('factory-supply-form').addEventListener('submit', event => {
      event.preventDefault(); if (!activeBuilding) return;
      const result = onSupply(activeBuilding, $('factory-supply-resource').value, Number($('factory-supply-amount').value));
      writeStatus(result.message); renderStocks();
    });
    addPalette();

    return Object.freeze({ open, close, refresh, isOpen: () => !editor.hidden });
  }

  root.OrbitFactoryEditor = Object.freeze({ create, types: TYPES });
})(globalThis);
