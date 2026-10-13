(function (root) {
  'use strict';

  const WORLD = Object.freeze({ width: 2600, height: 1800 });
  const NODE = Object.freeze({ width: 184, height: 96 });
  const TYPES = Object.freeze({
    input: Object.freeze({ label: 'ENTRÉE D’USINE', detail: 'Arrivée de ressources', mark: 'IN', inputs: 0, outputs: 1 }),
    transform: Object.freeze({ label: 'TRANSFORMATION', detail: 'Traitement générique', mark: 'TR', inputs: 1, outputs: 1 }),
    assembly: Object.freeze({ label: 'ASSEMBLAGE', detail: 'Réunit plusieurs composants', mark: 'AS', inputs: 1, outputs: 1 }),
    separator: Object.freeze({ label: 'SÉPARATION', detail: 'Distribue un flux entrant', mark: 'SP', inputs: 1, outputs: 2 }),
    storage: Object.freeze({ label: 'STOCKAGE', detail: 'Réserve interne limitée', mark: 'ST', inputs: 1, outputs: 1 }),
    filter: Object.freeze({ label: 'FILTRE', detail: 'Sélectionne un flux', mark: 'FL', inputs: 1, outputs: 1 }),
    output: Object.freeze({ label: 'SORTIE D’USINE', detail: 'Expédition de ressources', mark: 'OUT', inputs: 1, outputs: 0 })
  });
  const PALETTE = Object.freeze([
    ['input', 'FLUX'], ['transform', 'TRAITEMENT'], ['assembly', 'TRAITEMENT'],
    ['separator', 'FLUX'], ['storage', 'FLUX'], ['filter', 'TRAITEMENT'], ['output', 'FLUX']
  ]);
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function create(document, { onSave = () => {} } = {}) {
    const $ = id => document.getElementById(id);
    const editor = $('factory-editor'), viewport = $('factory-viewport');
    const world = $('factory-world'), nodeLayer = $('factory-nodes');
    const linkLayer = $('factory-link-layer');
    const palette = $('factory-block-list');
    let activeBuilding = null, nodes = [], connections = [];
    let selectedNodeId = null, pendingOutput = null, pendingPointer = null, drag = null, pinch = null;
    const activePointers = new Map();
    let transform = { x: 0, y: 0, scale: 1 }, nextNodeId = 1, nextConnectionId = 1;

    function typeOf(type) { return TYPES[type] || null; }

    function normalizePlan(value) {
      const planNodes = Array.isArray(value?.nodes) ? value.nodes.flatMap(node => {
        if (!node || typeof node.id !== 'string' || !typeOf(node.type) ||
            !Number.isFinite(node.x) || !Number.isFinite(node.y)) return [];
        return [{ id: node.id, type: node.type,
          x: clamp(node.x, 8, WORLD.width - NODE.width - 8),
          y: clamp(node.y, 8, WORLD.height - NODE.height - 8) }];
      }) : [];
      const nodeById = new Map(planNodes.map(node => [node.id, node]));
      const usedInputs = new Set();
      const planConnections = Array.isArray(value?.connections) ? value.connections.flatMap(connection => {
        const source = nodeById.get(connection?.fromNodeId), target = nodeById.get(connection?.toNodeId);
        if (!source || !target || source.id === target.id || !Number.isInteger(connection.fromPort) ||
            !Number.isInteger(connection.toPort) || connection.fromPort < 0 ||
            connection.fromPort >= typeOf(source.type).outputs || connection.toPort !== 0 ||
            typeOf(target.type).inputs < 1 || usedInputs.has(`${target.id}:${connection.toPort}`)) return [];
        usedInputs.add(`${target.id}:${connection.toPort}`);
        return [{ id: typeof connection.id === 'string' ? connection.id : `link-${usedInputs.size}`,
          fromNodeId: source.id, fromPort: connection.fromPort,
          toNodeId: target.id, toPort: connection.toPort }];
      }) : [];
      return { nodes: planNodes, connections: planConnections };
    }

    function writeStatus(message = 'PLAN ENREGISTRÉ') {
      $('factory-editor-status').textContent = message;
    }

    function persistPlan() {
      if (!activeBuilding) return;
      onSave(activeBuilding.id, {
        nodes: nodes.map(node => ({ id: node.id, type: node.type, x: node.x, y: node.y })),
        connections: connections.map(connection => ({ ...connection }))
      });
      writeStatus('PLAN ENREGISTRÉ');
    }

    function updateTransform() {
      world.style.transform = `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`;
      $('factory-editor-zoom').textContent = `${Math.round(transform.scale * 100)} %`;
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
      const end = target ? nodePoint(target, 'input') : pendingPointer;
      if (!end) return;
      const bend = Math.max(44, Math.abs(end.x - start.x) * .46);
      const path = document.createElementNS(svgNamespace, 'path');
      path.setAttribute('class', pending ? 'factory-link pending' : 'factory-link');
      path.setAttribute('d', `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`);
      linkLayer.append(path);
    }

    function renderConnections() {
      linkLayer.replaceChildren();
      for (const connection of connections) drawConnection(connection);
      if (pendingOutput) drawConnection({ fromNodeId: pendingOutput.nodeId, fromPort: pendingOutput.port }, true);
    }

    function createPort(side, node, index = 0) {
      const port = document.createElement('button');
      port.type = 'button';
      port.className = `factory-port ${side}`;
      port.dataset.portSide = side;
      port.dataset.nodeId = node.id;
      port.dataset.portIndex = String(index);
      port.setAttribute('aria-label', side === 'output' ? `Sortie ${index + 1} de ${typeOf(node.type).label}` : `Entrée de ${typeOf(node.type).label}`);
      port.title = side === 'output' ? 'Choisir cette sortie, puis toucher une entrée' : 'Relier ici la sortie sélectionnée';
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
      const description = document.createElement('span'); description.textContent = type.detail;
      const portSummary = document.createElement('small');
      portSummary.textContent = `${type.inputs} ENTRÉE${type.inputs === 1 ? '' : 'S'} · ${type.outputs} SORTIE${type.outputs === 1 ? '' : 'S'}`;
      body.append(description, portSummary); card.append(header, body);
      if (type.inputs) card.append(createPort('input', node));
      for (let index = 0; index < type.outputs; index++) card.append(createPort('output', node, index));
      return card;
    }

    function renderNodes() {
      nodeLayer.replaceChildren(...nodes.map(createNodeElement));
      $('factory-empty').hidden = nodes.length > 0;
      renderConnections();
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
      if (!type || !activeBuilding) return;
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
      const node = { id: `node-${index}`, type: typeId,
        x: clamp(x, 8, WORLD.width - NODE.width - 8),
        y: clamp(y, 8, WORLD.height - NODE.height - 8) };
      nodes.push(node); selectedNodeId = node.id; pendingOutput = null;
      renderNodes(); savePlanStatus();
    }

    function removeNode(id) {
      nodes = nodes.filter(node => node.id !== id);
      connections = connections.filter(connection => connection.fromNodeId !== id && connection.toNodeId !== id);
      if (selectedNodeId === id) selectedNodeId = null;
      if (pendingOutput?.nodeId === id) pendingOutput = null;
      renderNodes(); savePlanStatus();
    }

    function connectTo(targetNodeId) {
      if (!pendingOutput || pendingOutput.nodeId === targetNodeId) return;
      const source = nodes.find(node => node.id === pendingOutput.nodeId);
      const target = nodes.find(node => node.id === targetNodeId);
      if (!source || !target || !typeOf(target.type).inputs ||
          connections.some(connection => connection.toNodeId === targetNodeId)) {
        writeStatus('ENTRÉE DÉJÀ RELIÉE');
        pendingOutput = null; renderConnections(); return;
      }
      connections.push({ id: `link-${nextConnectionId++}`, fromNodeId: source.id,
        fromPort: pendingOutput.port, toNodeId: target.id, toPort: 0 });
      pendingOutput = null; selectedNodeId = target.id;
      renderNodes(); savePlanStatus();
    }

    function setZoom(value, screenX = viewport.clientWidth / 2, screenY = viewport.clientHeight / 2) {
      const nextScale = clamp(value, .42, 1.45);
      const worldX = (screenX - transform.x) / transform.scale;
      const worldY = (screenY - transform.y) / transform.scale;
      transform.scale = nextScale;
      transform.x = screenX - worldX * nextScale;
      transform.y = screenY - worldY * nextScale;
      updateTransform();
    }

    function fitGraph() {
      if (!nodes.length) {
        transform.scale = 1;
        transform.x = viewport.clientWidth / 2 - WORLD.width * transform.scale / 2;
        transform.y = viewport.clientHeight / 2 - WORLD.height * transform.scale / 2;
        updateTransform(); return;
      }
      const minX = Math.min(...nodes.map(node => node.x)), minY = Math.min(...nodes.map(node => node.y));
      const maxX = Math.max(...nodes.map(node => node.x + NODE.width));
      const maxY = Math.max(...nodes.map(node => node.y + NODE.height));
      const scale = clamp(Math.min((viewport.clientWidth - 100) / (maxX - minX + 100),
        (viewport.clientHeight - 90) / (maxY - minY + 90)), .42, 1.25);
      transform.scale = scale;
      transform.x = (viewport.clientWidth - (minX + maxX) * scale) / 2;
      transform.y = (viewport.clientHeight - (minY + maxY) * scale) / 2;
      updateTransform();
    }

    function worldPoint(clientX, clientY) {
      const bounds = viewport.getBoundingClientRect();
      return { x: (clientX - bounds.left - transform.x) / transform.scale,
        y: (clientY - bounds.top - transform.y) / transform.scale };
    }

    function capture(event) {
      try { viewport.setPointerCapture(event.pointerId); } catch (_) { /* Pointer capture is optional in older browsers. */ }
    }

    function touchPoints() {
      return [...activePointers.entries()].filter(([, point]) => point.type === 'touch').slice(0, 2);
    }

    function beginPinch() {
      const points = touchPoints();
      if (points.length < 2) return false;
      if (drag?.kind === 'node' && drag.moved) savePlanStatus();
      drag = null;
      pendingOutput = null; pendingPointer = null; renderConnections();
      const [first, second] = points.map(([, point]) => point);
      const midpointX = (first.x + second.x) / 2, midpointY = (first.y + second.y) / 2;
      const bounds = viewport.getBoundingClientRect();
      pinch = {
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        scale: transform.scale,
        worldX: (midpointX - bounds.left - transform.x) / transform.scale,
        worldY: (midpointY - bounds.top - transform.y) / transform.scale
      };
      return true;
    }

    function movePinch() {
      const points = touchPoints();
      if (!pinch || points.length < 2) return;
      const [first, second] = points.map(([, point]) => point);
      const midpointX = (first.x + second.x) / 2, midpointY = (first.y + second.y) / 2;
      const bounds = viewport.getBoundingClientRect();
      transform.scale = clamp(pinch.scale * Math.hypot(second.x - first.x, second.y - first.y) / pinch.distance, .42, 1.45);
      transform.x = midpointX - bounds.left - pinch.worldX * transform.scale;
      transform.y = midpointY - bounds.top - pinch.worldY * transform.scale;
      updateTransform();
    }

    function onPointerDown(event) {
      if (event.target.closest?.('[data-remove-node]')) return;
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
      if (touchPoints().length >= 2 && beginPinch()) {
        capture(event); event.preventDefault(); return;
      }
      const port = event.target.closest?.('[data-port-side]');
      if (port) {
        capture(event);
        event.preventDefault();
        const side = port.dataset.portSide, nodeId = port.dataset.nodeId;
        if (side === 'output') {
          pendingOutput = { nodeId, port: Number(port.dataset.portIndex) || 0 };
          pendingPointer = worldPoint(event.clientX, event.clientY);
          selectedNodeId = nodeId;
          writeStatus('SORTIE CHOISIE · TOUCHEZ UNE ENTRÉE');
          renderNodes();
        } else if (pendingOutput) connectTo(nodeId);
        return;
      }
      const nodeElement = event.target.closest?.('[data-node-id]');
      if (nodeElement) {
        const node = nodes.find(item => item.id === nodeElement.dataset.nodeId);
        if (!node) return;
        selectedNodeId = node.id; pendingOutput = null;
        drag = { kind: 'node', pointerId: event.pointerId, nodeId: node.id, startX: event.clientX, startY: event.clientY,
          originX: node.x, originY: node.y, moved: false };
        nodeLayer.querySelectorAll('.factory-node').forEach(item =>
          item.classList.toggle('selected', item.dataset.nodeId === selectedNodeId));
        event.preventDefault(); capture(event); return;
      }
      pendingOutput = null; pendingPointer = null; renderConnections();
      drag = { kind: 'pan', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
        originX: transform.x, originY: transform.y };
      event.preventDefault(); capture(event);
    }

    function onPointerMove(event) {
      const pointer = activePointers.get(event.pointerId);
      if (pointer) { pointer.x = event.clientX; pointer.y = event.clientY; }
      if (pinch) { movePinch(); event.preventDefault(); return; }
      if (!drag) {
        if (pendingOutput) { pendingPointer = worldPoint(event.clientX, event.clientY); renderConnections(); }
        return;
      }
      const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
      if (drag.kind === 'node') {
        const node = nodes.find(item => item.id === drag.nodeId);
        if (!node) return;
        node.x = clamp(drag.originX + dx / transform.scale, 8, WORLD.width - NODE.width - 8);
        node.y = clamp(drag.originY + dy / transform.scale, 8, WORLD.height - NODE.height - 8);
        drag.moved ||= Math.abs(dx) + Math.abs(dy) > 2;
        updateNodePosition(node);
      } else {
        transform.x = drag.originX + dx; transform.y = drag.originY + dy; updateTransform();
      }
    }

    function onPointerUp(event) {
      activePointers.delete(event.pointerId);
      if (pinch) {
        pinch = null;
        if (touchPoints().length >= 2) beginPinch();
        else if (touchPoints().length === 1) {
          const [pointerId, point] = touchPoints()[0];
          drag = { kind: 'pan', pointerId, startX: point.x, startY: point.y,
            originX: transform.x, originY: transform.y };
        } else drag = null;
        return;
      }
      if (drag && drag.pointerId !== event.pointerId) return;
      if (drag?.kind === 'node' && drag.moved) savePlanStatus();
      drag = null;
    }

    function addPalette() {
      for (const [typeId, category] of PALETTE) {
        const type = typeOf(typeId), button = document.createElement('button');
        button.type = 'button'; button.className = 'factory-block-add'; button.dataset.addNode = typeId;
        const icon = document.createElement('span'); icon.className = 'factory-block-icon'; icon.textContent = type.mark;
        const copy = document.createElement('span'); copy.className = 'factory-block-copy';
        const label = document.createElement('strong'); label.textContent = type.label;
        const detail = document.createElement('small'); detail.textContent = `${category} · ${type.detail}`;
        copy.append(label, detail); button.append(icon, copy); palette.append(button);
      }
    }

    function open(building, savedPlan) {
      activeBuilding = building;
      ({ nodes, connections } = normalizePlan(savedPlan));
      selectedNodeId = null; pendingOutput = null; pendingPointer = null; drag = null;
      pinch = null; activePointers.clear();
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
      if (nodes.length) fitGraph(); else updateTransform();
      writeStatus('PLAN ENREGISTRÉ');
      $('factory-editor-close').focus();
    }

    function close() {
      if (editor.hidden) return;
      persistPlan();
      editor.hidden = true; document.body.classList.remove('factory-editor-open');
      activeBuilding = null; drag = null; pinch = null; activePointers.clear(); pendingOutput = null;
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
    viewport.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-node]');
      if (button) removeNode(button.dataset.removeNode);
    });
    viewport.addEventListener('wheel', event => {
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      setZoom(transform.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX - bounds.left, event.clientY - bounds.top);
    }, { passive: false });
    editor.querySelector('[data-factory-zoom="out"]').addEventListener('click', () => setZoom(transform.scale / 1.18));
    editor.querySelector('[data-factory-zoom="in"]').addEventListener('click', () => setZoom(transform.scale * 1.18));
    $('factory-editor-fit').addEventListener('click', fitGraph);
    addPalette(); fitGraph();

    return Object.freeze({ open, close, isOpen: () => !editor.hidden });
  }

  root.OrbitFactoryEditor = Object.freeze({ create, types: TYPES });
})(globalThis);
