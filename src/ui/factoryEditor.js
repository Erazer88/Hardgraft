(function (root) {
  'use strict';

  const Data = root.OrbitProcessData;
  const Graph = root.OrbitProcessGraph;
  const NODE = Object.freeze({ width: 258, height: 162 });
  const WORLD = Object.freeze({ width: 2600, height: 1800 });
  const SVG = 'http://www.w3.org/2000/svg';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const fmt = value => numberFormat.format(Number.isFinite(value) ? value : 0);

  function create(document, { onSave = () => {} } = {}) {
    const $ = id => document.getElementById(id);
    const editor = $('factory-editor'), viewport = $('factory-viewport');
    const world = $('factory-world'), nodeLayer = $('factory-nodes'), linkLayer = $('factory-link-layer');
    const palette = $('factory-block-list');
    let activeBuilding = null, graph = null, machines = [], connections = [];
    let pendingConnection = null, nextMachineId = 1, nextConnectionId = 1;
    const cards = new Map();

    const typeOf = type => Graph.definitionOf({ type });
    const machineById = id => machines.find(machine => machine.id === id);
    const portY = (machine, side, portId) => {
      const ports = side === 'input' ? typeOf(machine.type).inputPorts : typeOf(machine.type).outputPorts;
      const index = ports.findIndex(port => port.id === portId);
      return machine.y + 55 + Math.max(0, index) * 24;
    };

    function status(message) { $('factory-editor-status').textContent = message; }

    function persist() {
      if (!activeBuilding || !graph) return;
      graph.machines = machines; graph.connections = connections;
      onSave(activeBuilding.id, graph);
      status('PLAN ENREGISTRÉ');
    }

    function resourceLine(port, amount) {
      return `${port.label}<small>${amount ? `${amount} u` : '—'}</small>`;
    }

    function updateMachineReadout(machine) {
      const card = cards.get(machine.id);
      if (!card) return;
      const def = typeOf(machine.type), finite = Number.isFinite(def.throughput);
      const rate = machine.currentRate || 0;
      const rateText = `DÉBIT ACTUEL · ${fmt(rate)} / ${finite ? fmt(def.throughput) : '∞'} u/s`;
      const rateElement = card.querySelector('[data-readout="rate"]');
      if (rateElement.textContent !== rateText) rateElement.textContent = rateText;
      const rateFill = card.querySelector('.factory-rate-fill');
      const ratePercent = finite ? (def.throughput > 0 ? rate / def.throughput * 100 : 0) : rate > 0 ? 100 : 0;
      rateFill.style.width = `${clamp(ratePercent, 0, 100)}%`;
      const energy = card.querySelector('[data-readout="energy"]');
      energy.textContent = `${fmt(machine.energyMW)} / ${fmt(def.energyMW)} MW`;
      card.dataset.state = machine.state;
      const state = card.querySelector('[data-readout="state"]');
      state.textContent = Data.statuses[machine.state] || Data.statuses.waiting_input;
      const cycle = card.querySelector('.factory-cycle-fill');
      cycle.style.width = `${machine.type === 'drill' ? (machine.state === 'active' ? 100 : 0) : clamp(machine.cycleProgress * 100, 0, 100)}%`;
      const cycleLabel = card.querySelector('[data-readout="cycle"]');
      cycleLabel.textContent = machine.type === 'drill' ? 'EXTRACTION CONTINUE' : `CYCLE · ${Math.floor(machine.cycleProgress * 100)} %`;
      for (const port of def.inputPorts) {
        const label = card.querySelector(`[data-input-label="${port.id}"]`);
        if (label) label.innerHTML = resourceLine(port, machine.inputBuffer[port.id]);
      }
      for (const port of def.outputPorts) {
        const label = card.querySelector(`[data-output-label="${port.id}"]`);
        if (label) label.innerHTML = resourceLine(port, machine.outputBuffer[port.id]);
      }
    }

    function createPort(machine, side, port, index) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `factory-port ${side}`;
      button.dataset.machineId = machine.id;
      button.dataset[side === 'input' ? 'inputId' : 'outputId'] = port.id;
      button.style.top = `${47.5 + index * 24}px`;
      button.setAttribute('aria-label', `${side === 'input' ? 'Entrée' : 'Sortie'} ${port.label} · ${typeOf(machine.type).label}`);
      return button;
    }

    function createMachineCard(machine) {
      const def = typeOf(machine.type), card = document.createElement('article');
      card.className = 'factory-node';
      card.dataset.machineId = machine.id;
      card.style.left = `${machine.x}px`; card.style.top = `${machine.y}px`;
      const header = document.createElement('header'); header.className = 'factory-node-header';
      const mark = document.createElement('span'); mark.className = 'factory-node-mark'; mark.textContent = def.mark;
      const name = document.createElement('strong'); name.textContent = def.label;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'factory-node-remove';
      remove.dataset.removeMachine = machine.id; remove.setAttribute('aria-label', `Supprimer ${def.label}`); remove.textContent = '×';
      header.append(mark, name, remove);

      const body = document.createElement('div'); body.className = 'factory-node-body';
      const rows = document.createElement('div'); rows.className = 'factory-machine-ports';
      const rowCount = Math.max(1, def.inputPorts.length, def.outputPorts.length);
      for (let index = 0; index < rowCount; index++) {
        const row = document.createElement('div'); row.className = 'factory-machine-port-row';
        const input = def.inputPorts[index], output = def.outputPorts[index];
        const inputLabel = document.createElement('span'); inputLabel.className = 'factory-port-label input';
        if (input) { inputLabel.dataset.inputLabel = input.id; inputLabel.innerHTML = resourceLine(input, machine.inputBuffer[input.id]); }
        const outputLabel = document.createElement('span'); outputLabel.className = 'factory-port-label output';
        if (output) { outputLabel.dataset.outputLabel = output.id; outputLabel.innerHTML = resourceLine(output, machine.outputBuffer[output.id]); }
        row.append(inputLabel, outputLabel); rows.append(row);
        if (input) card.append(createPort(machine, 'input', input, index));
        if (output) card.append(createPort(machine, 'output', output, index));
      }
      const rate = document.createElement('div'); rate.className = 'factory-readout-row';
      const rateLabel = document.createElement('span'); rateLabel.dataset.readout = 'rate';
      const rateBar = document.createElement('div'); rateBar.className = 'factory-meter';
      const rateFill = document.createElement('i'); rateFill.className = 'factory-rate-fill'; rateBar.append(rateFill);
      rate.append(rateLabel, rateBar);
      const energy = document.createElement('div'); energy.className = 'factory-energy'; energy.dataset.readout = 'energy';
      const cycleRow = document.createElement('div'); cycleRow.className = 'factory-cycle-row';
      const cycleLabel = document.createElement('span'); cycleLabel.dataset.readout = 'cycle';
      const cycleBar = document.createElement('div'); cycleBar.className = 'factory-meter factory-cycle-meter';
      const cycleFill = document.createElement('i'); cycleFill.className = 'factory-cycle-fill'; cycleBar.append(cycleFill);
      cycleRow.append(cycleLabel, cycleBar);
      const state = document.createElement('small'); state.className = 'factory-state'; state.dataset.readout = 'state';
      body.append(rows, rate, energy, cycleRow, state);
      card.append(header, body);
      return card;
    }

    function renderNodes() {
      cards.clear();
      const elements = machines.map(machine => {
        const card = createMachineCard(machine); cards.set(machine.id, card); updateMachineReadout(machine); return card;
      });
      nodeLayer.replaceChildren(...elements);
      $('factory-empty').hidden = machines.length > 0;
      renderConnections();
    }

    function updateMachinePosition(machine) {
      const card = cards.get(machine.id);
      if (card) { card.style.left = `${machine.x}px`; card.style.top = `${machine.y}px`; }
      renderConnections();
    }

    function drawLink(connection, pending = false) {
      const source = machineById(connection.fromMachineId || connection.source?.machineId);
      if (!source) return;
      const fromOutputId = connection.fromOutputId || connection.source?.outputId;
      const start = { x: source.x + NODE.width, y: portY(source, 'output', fromOutputId) };
      const target = connection.toMachineId ? machineById(connection.toMachineId) : null;
      const end = target ? { x: target.x, y: portY(target, 'input', connection.toInputId) } : connection.point;
      if (!end) return;
      if (!pending) {
        const hit = document.createElementNS(SVG, 'path');
        hit.setAttribute('class', 'factory-link-hit'); hit.dataset.connectionId = connection.id;
        hit.setAttribute('d', linkPath(start, end)); linkLayer.append(hit);
      }
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('class', pending ? 'factory-link pending' : 'factory-link');
      path.setAttribute('d', linkPath(start, end)); linkLayer.append(path);
    }

    function linkPath(start, end) {
      const bend = Math.max(32, Math.abs(end.x - start.x) * .45);
      return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
    }

    function renderConnections() {
      linkLayer.replaceChildren();
      for (const connection of connections) drawLink(connection);
      if (pendingConnection) drawLink({ ...pendingConnection, point: pendingConnection.point }, true);
    }

    function freeInput(machine) {
      const def = typeOf(machine.type);
      return def.inputPorts.find(input => !connections.some(connection =>
        connection.toMachineId === machine.id && connection.toInputId === input.id)) || null;
    }

    function findInputTarget(clientX, clientY) {
      let candidate = null, distance = 31;
      for (const machine of machines) {
        const input = freeInput(machine);
        if (!input) continue;
        const port = cards.get(machine.id)?.querySelector(`.factory-port.input[data-input-id="${input.id}"]`);
        if (!port) continue;
        const bounds = port.getBoundingClientRect();
        const current = Math.hypot(clientX - (bounds.left + bounds.width / 2), clientY - (bounds.top + bounds.height / 2));
        if (current < distance) { distance = current; candidate = { machineId: machine.id, inputId: input.id }; }
      }
      if (candidate) return candidate;
      for (const machine of machines) {
        const input = freeInput(machine), bounds = cards.get(machine.id)?.getBoundingClientRect();
        if (!input || !bounds || typeOf(machine.type).inputPorts.length !== 1) continue;
        if (clientX >= bounds.left + bounds.width * .2 && clientX <= bounds.right - bounds.width * .2 &&
            clientY >= bounds.top + bounds.height * .2 && clientY <= bounds.bottom - bounds.height * .2) {
          return { machineId: machine.id, inputId: input.id };
        }
      }
      return null;
    }

    function findConnectionFrom(machineId, outputId) {
      return connections.find(connection => connection.fromMachineId === machineId && connection.fromOutputId === outputId) || null;
    }
    function findConnectionTo(machineId, inputId) {
      return connections.find(connection => connection.toMachineId === machineId && connection.toInputId === inputId) || null;
    }

    const viewportController = root.OrbitFactoryViewport.create(viewport, world, {
      getMachinePosition: id => {
        const machine = machineById(id); return machine ? { x: machine.x, y: machine.y } : null;
      },
      onMachineMove(id, point) {
        const machine = machineById(id); if (!machine) return;
        machine.x = clamp(point.x, 8, WORLD.width - NODE.width - 8);
        machine.y = clamp(point.y, 8, WORLD.height - NODE.height - 8);
        updateMachinePosition(machine);
      },
      onMachineEnd() { persist(); },
      onSelectMachine(id) {
        nodeLayer.querySelectorAll('.factory-node').forEach(card => card.classList.toggle('selected', card.dataset.machineId === id));
      },
      onPendingConnection(value) {
        pendingConnection = value;
        renderConnections();
      },
      findInputTarget,
      findConnectionFrom,
      findConnectionTo,
      findConnection: id => connections.find(connection => connection.id === id) || null,
      onDetachConnection(id) {
        connections = connections.filter(connection => connection.id !== id);
        graph.connections = connections; renderConnections();
      },
      onRestoreConnection(connection) {
        if (connections.some(item => item.id === connection.id)) return;
        const result = Graph.connect(graph, connection);
        if (result.ok) { connections = graph.connections; renderConnections(); }
      },
      onConnectionDrop(source, target, previous, detached) {
        if (target) {
          const result = Graph.connect(graph, { id: `link-${nextConnectionId++}`,
            fromMachineId: source.machineId, fromOutputId: source.outputId,
            toMachineId: target.machineId, toInputId: target.inputId });
          if (!result.ok) status(result.reason);
          else { connections = graph.connections; status('CONNEXION CRÉÉE'); }
        } else if (detached) status('CONNEXION DÉCROCHÉE');
        else status('RELIEZ UNE SORTIE À UNE ENTRÉE');
        pendingConnection = null;
        renderConnections(); persist();
      }
    });

    function addPalette() {
      palette.replaceChildren();
      for (const def of Data.catalog(activeBuilding?.type || 'factory')) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'factory-block-add'; button.dataset.addMachine = def.id;
        const icon = document.createElement('span'); icon.className = 'factory-block-icon'; icon.textContent = def.mark;
        const copy = document.createElement('span'); copy.className = 'factory-block-copy';
        const title = document.createElement('strong'); title.textContent = def.label;
        const detail = document.createElement('small');
        detail.textContent = `${Number.isFinite(def.throughput) ? `${fmt(def.throughput)} u/s` : 'DÉBIT NON PLAFONNÉ'} · ${fmt(def.energyMW)} MW`;
        copy.append(title, detail); button.append(icon, copy); palette.append(button);
      }
    }

    function addMachine(type) {
      const def = Data.get(type);
      if (!def || !activeBuilding) return;
      const viewportBounds = viewport.getBoundingClientRect();
      const center = viewportController.worldPoint(viewportBounds.left + viewportBounds.width / 2,
        viewportBounds.top + viewportBounds.height / 2);
      const last = machines.at(-1);
      const x = last ? last.x + NODE.width + 88 : center.x - NODE.width / 2;
      const y = last ? last.y : center.y - NODE.height / 2;
      const result = Graph.addMachine(graph, { id: `machine-${nextMachineId++}`, type,
        x: clamp(x, 8, WORLD.width - NODE.width - 8), y: clamp(y, 8, WORLD.height - NODE.height - 8) });
      if (!result.ok) { status(result.reason); return; }
      machines = graph.machines; renderNodes(); persist();
    }

    function removeMachine(id) {
      const result = Graph.removeMachine(graph, id);
      if (!result.ok) { status(result.reason); return; }
      machines = graph.machines; connections = graph.connections;
      renderNodes(); persist();
    }

    function open(building, savedPlan) {
      activeBuilding = building;
      graph = savedPlan?.version === Data.config.version && Array.isArray(savedPlan.machines)
        ? savedPlan : Graph.create(savedPlan || {});
      machines = graph.machines; connections = graph.connections; pendingConnection = null;
      nextMachineId = machines.reduce((max, item) => Math.max(max, Number(item.id.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
      nextConnectionId = connections.reduce((max, item) => Math.max(max, Number(item.id.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
      const buildingDef = root.OrbitBuildingData.get(building.type);
      $('factory-editor-title').textContent = building.customName || buildingDef?.label || 'USINE';
      $('factory-editor-building-type').textContent = `${buildingDef?.label || 'BÂTIMENT'} · NIVEAU ${building.upgradeLevel || 1}`;
      addPalette();
      editor.hidden = false; document.body.classList.add('factory-editor-open');
      renderNodes();
      viewportController.fit(machines, NODE);
      status('PLAN ENREGISTRÉ');
      $('factory-editor-close').focus();
    }

    function close() {
      if (editor.hidden) return;
      persist();
      editor.hidden = true; document.body.classList.remove('factory-editor-open');
      activeBuilding = null; graph = null; machines = []; connections = [];
      pendingConnection = null; cards.clear();
      nodeLayer.replaceChildren(); linkLayer.replaceChildren();
      $('factory-edit-button').focus();
    }

    function refresh() {
      if (editor.hidden || !graph) return;
      for (const machine of machines) updateMachineReadout(machine);
      if (viewportController.mode() === 'idle' && !pendingConnection) renderConnections();
    }

    palette.addEventListener('click', event => {
      const button = event.target.closest('[data-add-machine]');
      if (button) addMachine(button.dataset.addMachine);
    });
    viewport.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-machine]');
      if (button) removeMachine(button.dataset.removeMachine);
    });

    return Object.freeze({ open, close, refresh, refreshProgress: refresh,
      isOpen: () => !editor.hidden,
      getViewportState: () => ({ camera: viewportController.camera(), mode: viewportController.mode() }) });
  }

  root.OrbitFactoryEditor = Object.freeze({ create, types: Data.definitions });
})(globalThis);
