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
    let selectedNodeId = null, pendingOutput = null, pendingPointer = null, pendingTarget = null;
    let drag = null, pinch = null, wireDrag = null;
    const activePointers = new Map();
    let transform = { x: 0, y: 0, scale: 1 }, nextNodeId = 1, nextConnectionId = 1;
    let zoomFrame = null;

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
            connection.fromPort >= typeOf(source.type).outputs || connection.toPort < 0 ||
            connection.toPort >= typeOf(target.type).inputs || usedInputs.has(`${target.id}:${connection.toPort}`)) return [];
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
      if (!pending) path.dataset.connectionId = connection.id;
      path.setAttribute('d', curve);
      linkLayer.append(path);
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
      port.setAttribute('aria-label', side === 'output' ? `Sortie ${index + 1} de ${typeOf(node.type).label}` : `Entrée de ${typeOf(node.type).label}`);
      port.title = side === 'output' ? 'Glisser vers une entrée pour relier' : 'Déposer une sortie ici pour la relier';
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
      for (let index = 0; index < type.inputs; index++) card.append(createPort('input', node, index));
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
      nodes.push(node); selectedNodeId = node.id;
      pendingOutput = null; pendingPointer = null; pendingTarget = null; wireDrag = null;
      renderNodes(); savePlanStatus();
    }

    function removeNode(id) {
      nodes = nodes.filter(node => node.id !== id);
      connections = connections.filter(connection => connection.fromNodeId !== id && connection.toNodeId !== id);
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
      connections.push({ id: `link-${nextConnectionId++}`, fromNodeId: source.id,
        fromPort: pendingOutput.port, toNodeId: target.id, toPort: targetPort });
      pendingOutput = null; pendingPointer = null; pendingTarget = null; wireDrag = null;
      selectedNodeId = target.id;
      renderNodes(); savePlanStatus();
    }

    function updateWireDrag(event) {
      if (!wireDrag || wireDrag.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - wireDrag.startX, event.clientY - wireDrag.startY);
      if (!wireDrag.moved && distance <= 5) return;
      wireDrag.moved = true;
      if (wireDrag.connectionId && !wireDrag.detached) {
        connections = connections.filter(connection => connection.id !== wireDrag.connectionId);
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
      const scale = clamp(value, .18, 1.45);
      const worldX = (screenX - transform.x) / transform.scale;
      const worldY = (screenY - transform.y) / transform.scale;
      applyCamera(scale, screenX - worldX * scale, screenY - worldY * scale);
    }

    function frameSavedPlan() {
      const minX = Math.min(...nodes.map(node => node.x)), minY = Math.min(...nodes.map(node => node.y));
      const maxX = Math.max(...nodes.map(node => node.x + NODE.width));
      const maxY = Math.max(...nodes.map(node => node.y + NODE.height));
      const scale = clamp(Math.min((viewport.clientWidth - 100) / (maxX - minX + 100),
        (viewport.clientHeight - 90) / (maxY - minY + 90)), .18, 1.25);
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
      const scale = clamp(transform.scale * distance / pinch.distance, .18, 1.45);
      const worldX = (pinch.midpoint.x - transform.x) / transform.scale;
      const worldY = (pinch.midpoint.y - transform.y) / transform.scale;
      applyCamera(scale, midpoint.x - worldX * scale, midpoint.y - worldY * scale);
      pinch = { ...pinch, distance, midpoint };
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
      pinch = { pointerIds: [firstId, secondId], distance: Math.max(1,
        Math.hypot(second.x - first.x, second.y - first.y)), midpoint: {
          x: (first.x + second.x) / 2 - bounds.left,
          y: (first.y + second.y) / 2 - bounds.top
        } };
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
        selectedNodeId = node.id; pendingOutput = null;
        drag = { kind: 'node', pointerId: event.pointerId, nodeId: node.id, startX: event.clientX, startY: event.clientY,
          originX: node.x, originY: node.y, moved: false };
        nodeLayer.querySelectorAll('.factory-node').forEach(item =>
          item.classList.toggle('selected', item.dataset.nodeId === selectedNodeId));
        event.preventDefault(); capture(event); return;
      }
      pendingOutput = null; pendingPointer = null; pendingTarget = null; renderConnections();
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
        } else if (completedWireDrag.connectionId) {
          pendingOutput = null; pendingPointer = null; pendingTarget = null; renderConnections();
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
      cancelZoomFrame();
      activeBuilding = building;
      ({ nodes, connections } = normalizePlan(savedPlan));
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
      writeStatus('PLAN ENREGISTRÉ');
      $('factory-editor-close').focus();
    }

    function close() {
      if (editor.hidden) return;
      cancelZoomFrame();
      persistPlan();
      editor.hidden = true; document.body.classList.remove('factory-editor-open');
      activeBuilding = null; drag = null; pinch = null; wireDrag = null; activePointers.clear();
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
    addPalette();

    return Object.freeze({ open, close, isOpen: () => !editor.hidden });
  }

  root.OrbitFactoryEditor = Object.freeze({ create, types: TYPES });
})(globalThis);
