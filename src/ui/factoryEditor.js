(function (root) {
  'use strict';

  const Data = root.OrbitProcessData;
  const Graph = root.OrbitProcessGraph;
  const NODE = Object.freeze({ width: 258, height: 162, outputDockHeight: 222, inputDockHeight: 252 });
  const WORLD = Object.freeze({ width: 7800, height: 5400 });
  const SVG = 'http://www.w3.org/2000/svg';
  const BLOCK_ART = Object.freeze({
    drill: { accent: '#ecc06e', shape: '<rect x="50" y="10" width="28" height="18" rx="4" fill="#31566a"/><path d="M44 28h40l-7 10H51z" fill="#54798a"/><path d="M61 38v17l3 8 3-8V38" fill="var(--art-accent)"/><path d="M38 63h52M44 67l8-7 8 4 8-9 7 10 8-5 7 6" fill="none"/>' },
    oil_pump: { accent: '#e8b66e', shape: '<path d="M29 64h71M39 64l13-34M52 30h32M61 30l13 34M44 25l48 9" fill="none"/><path d="M76 31l16 3-6 6-17-4z" fill="var(--art-accent)"/><rect x="49" y="61" width="30" height="7" rx="2" fill="#385568"/><path d="M58 68v5m13-5v5"/>' },
    water_supply: { accent: '#75cfee', shape: '<path d="M64 14C54 28 44 39 44 50a20 20 0 0 0 40 0c0-11-10-22-20-36z" fill="#16445e"/><path d="M64 22C57 33 51 41 51 50a13 13 0 0 0 13 13" fill="none" stroke="var(--art-accent)" stroke-width="4"/><path d="M31 68h66"/><circle cx="94" cy="24" r="3" fill="var(--art-accent)"/><circle cx="101" cy="34" r="2" fill="var(--art-accent)"/>' },
    crusher: { accent: '#f0ad5e', shape: '<path d="M31 24h66l-8 10H39zM31 61h66l-8-10H39z" fill="#496b7b"/><circle cx="49" cy="43" r="12" fill="#142d3d"/><circle cx="79" cy="43" r="12" fill="#142d3d"/><path d="M49 34v18m-9-9h18M79 34v18m-9-9h18"/><path d="M61 32l4-5 4 6-4 5zM62 50l4-4 4 5-4 5z" fill="var(--art-accent)"/><path d="M41 68l7-6 7 5 8-7 7 7 7-5 9 6" fill="none" stroke="var(--art-accent)"/>' },
    grinder: { accent: '#74d2ce', shape: '<path d="M36 30h56v34H36z" fill="#173448"/><circle cx="51" cy="47" r="11" fill="#0c1b2a"/><circle cx="77" cy="47" r="11" fill="#0c1b2a"/><path d="M51 38v18m-9-9h18M77 38v18m-9-9h18"/><path d="M64 15v13m-9-7h18M64 64v10M38 74h52"/><path d="M59 19l5-5 5 5" fill="none" stroke="var(--art-accent)" stroke-width="3"/><circle cx="64" cy="47" r="3" fill="var(--art-accent)"/>' },
    magnetic_separator: { accent: '#75d9cd', shape: '<path d="M42 26v22a22 22 0 0 0 44 0V26h-13v22a9 9 0 0 1-18 0V26z" fill="#375c71"/><path d="M42 26h13v11H42zM73 26h13v11H73z" fill="var(--art-accent)"/><path d="M34 67h60"/><circle cx="47" cy="60" r="3" fill="#e6ae69"/><circle cx="60" cy="66" r="2" fill="#a8c3cf"/><circle cx="77" cy="61" r="3" fill="var(--art-accent)"/>' },
    gravity_separator: { accent: '#c6a7ec', shape: '<path d="M35 24h58l-7 13H42zM42 41h44l-7 12H49zM49 58h30l-5 10H54z" fill="#244255"/><path d="M40 30h48M47 47h34M54 63h20"/><circle cx="51" cy="31" r="3" fill="#e4b165"/><circle cx="73" cy="47" r="3" fill="var(--art-accent)"/><circle cx="63" cy="63" r="3" fill="#a7d0d6"/><path d="M64 16v7m-4-3 4-4 4 4" fill="none" stroke="var(--art-accent)"/>' },
    silicon_washer: { accent: '#76cef0', shape: '<path d="M37 29h54v37H37z" fill="#123b52"/><path d="M39 48q12-7 25 0t25 0v16H39z" fill="#167aa0" stroke="var(--art-accent)"/><path d="M51 18c-4 6-6 8-6 12a6 6 0 0 0 12 0c0-4-2-6-6-12zM75 18c-3 5-5 7-5 10a5 5 0 0 0 10 0c0-3-2-5-5-10z" fill="var(--art-accent)"/><path d="M44 67v6m40-6v6"/>' },
    silicon_dryer: { accent: '#efbc66', shape: '<rect x="34" y="29" width="60" height="36" rx="5" fill="#304b5b"/><rect x="43" y="38" width="42" height="20" rx="3" fill="#132635"/><path d="M53 54c-5-5 5-7 0-12m12 12c-5-5 5-7 0-12m12 12c-5-5 5-7 0-12" fill="none" stroke="var(--art-accent)" stroke-width="3"/><path d="M41 25c-4-4 4-6 0-10m18 10c-4-4 4-6 0-10m18 10c-4-4 4-6 0-10" fill="none" stroke="var(--art-accent)" stroke-width="2"/>' },
    carbon_separator: { accent: '#d5a36d', shape: '<path d="M32 57h64l-8 12H40z" fill="#284455"/><path d="M41 48h51M44 52l5 13m10-13 4 13m11-13 4 13"/><path d="M44 45l6-13 11 3 4 10zM67 44l8-16 12 5-3 11z" fill="#26313a" stroke="var(--art-accent)"/><circle cx="51" cy="40" r="2" fill="#d7e0d8"/><circle cx="80" cy="37" r="2" fill="#d7e0d8"/>' },
    carbon_washer: { accent: '#74ced4', shape: '<path d="M37 30h54v37H37z" fill="#123342"/><path d="M39 49q13-7 25 0t25 0v15H39z" fill="#146277" stroke="var(--art-accent)"/><path d="M48 44l5-12 9 2 4 10zM68 44l5-13 10 4-2 9z" fill="#1f2e36" stroke="#cf9c68"/><path d="M45 24h38M46 69v4m37-4v4"/>' },
    reduction_furnace: { accent: '#ff9863', shape: '<path d="M39 66V37l10-10h30l10 10v29z" fill="#4a3b39"/><path d="M51 66V47a13 13 0 0 1 26 0v19z" fill="#111b24"/><path d="M64 57c-9-7 3-11 0-18 9 7 11 12 4 18z" fill="var(--art-accent)" stroke="#ffd27b"/><path d="M33 68h62M49 22h30"/><circle cx="64" cy="70" r="3" fill="#ffd27b"/>' },
    triphasic_separator: { accent: '#79cde3', shape: '<path d="M49 20h30v8l8 9v29H41V37l8-9z" fill="#18384c"/><path d="M43 44h42v8H43z" fill="#ae8154"/><path d="M43 53h42v8H43z" fill="#405c69"/><path d="M43 39h42v5H43z" fill="var(--art-accent)"/><path d="M55 17h18M37 68h54"/><circle cx="58" cy="41" r="2" fill="#d5e3e8"/><circle cx="72" cy="57" r="2" fill="#d5e3e8"/>' },
    terril: { accent: '#bc9369', shape: '<path d="M28 66h72"/><path d="M35 65l9-17 8 7 12-23 11 16 7-6 11 23z" fill="#364855"/><path d="M42 54l7-4m17-14 5 6m9 7 6-4" fill="none" stroke="var(--art-accent)" stroke-width="3"/><circle cx="51" cy="61" r="2" fill="#e3c293"/><circle cx="75" cy="58" r="2" fill="#e3c293"/>' },
    input_dock: { accent: '#79d6c2', shape: '<path d="M91 43H42"/><path d="M50 34l-10 9 10 9" fill="none" stroke="var(--art-accent)" stroke-width="4"/><path d="M41 56h49l-7 12H48z" fill="#254758"/><path d="M50 54V46m14 8V46m14 8V46"/><rect x="86" y="29" width="15" height="28" rx="3" fill="#355a6d"/><path d="M89 36h9m-9 6h9"/>' },
    output_dock: { accent: '#75cfde', shape: '<path d="M37 43h49"/><path d="M78 34l10 9-10 9" fill="none" stroke="var(--art-accent)" stroke-width="4"/><path d="M38 56h49l-7 12H45z" fill="#254758"/><path d="M49 54V46m14 8V46m14 8V46"/><rect x="27" y="29" width="15" height="28" rx="3" fill="#355a6d"/><path d="M30 36h9m-9 6h9"/>' }
  });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const fmt = value => numberFormat.format(Number.isFinite(value) ? value : 0);

  function create(document, { onSave = () => {}, getDestinations = () => [], onDockDestinationChange = null } = {}) {
    const $ = id => document.getElementById(id);
    const editor = $('factory-editor'), viewport = $('factory-viewport');
    const world = $('factory-world'), nodeLayer = $('factory-nodes'), linkLayer = $('factory-link-layer');
    const palette = $('factory-block-list');
    const paletteOverlay = $('factory-palette-overlay'), paletteToggle = $('factory-add-block-toggle');
    const paletteClose = $('factory-palette-close');
    let activeBuilding = null, graph = null, machines = [], connections = [];
    let pendingConnection = null, nextMachineId = 1, nextConnectionId = 1;
    const cards = new Map();

    const processingResource = () => graph?.geology?.resourceId || activeBuilding?.resourceId ||
      Data.contextForResource(machines.find(machine => machine.type === 'input_dock' && machine.importResourceId)?.importResourceId) || 'iron';
    const typeOf = value => Graph.definitionOf(typeof value === 'string'
      ? { type: value, resourceId: processingResource() } : value);
    const heightOf = value => {
      const definition = typeOf(value);
      if (definition.externalInput) return NODE.inputDockHeight;
      if (definition.externalOutput) return NODE.outputDockHeight;
      const portRows = Math.max(1, definition.inputPorts.length, definition.outputPorts.length);
      return NODE.height + (portRows - 1) * 24;
    };
    const machineById = id => machines.find(machine => machine.id === id);
    const portY = (machine, side, portId) => {
      const ports = side === 'input' ? typeOf(machine).inputPorts : typeOf(machine).outputPorts;
      const index = ports.findIndex(port => port.id === portId);
      return machine.y + 55 + Math.max(0, index) * 24;
    };
    const portPoint = (machine, side, portId) => {
      const port = cards.get(machine.id)?.querySelector(
        `.factory-port.${side}[data-${side === 'input' ? 'input' : 'output'}-id="${portId}"]`);
      if (port) {
        const bounds = port.getBoundingClientRect();
        return viewportController.worldPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      }
      return { x: side === 'output' ? machine.x + NODE.width : machine.x, y: portY(machine, side, portId) };
    };

    function status(message) { $('factory-editor-status').textContent = message; }

    function setPaletteOpen(open) {
      paletteOverlay.hidden = !open;
      paletteToggle.setAttribute('aria-expanded', String(open));
      paletteToggle.setAttribute('aria-label', open ? 'Fermer le menu des blocs' : 'Ajouter un bloc au processus');
      const label = paletteToggle.querySelector('span');
      if (label) label.textContent = open ? 'FERMER LE MENU' : 'AJOUTER UN BLOC';
      const icon = paletteToggle.querySelector('svg path');
      if (icon) icon.setAttribute('d', open ? 'M6 6l12 12M18 6 6 18' : 'M12 5v14M5 12h14');
      if (open) palette.querySelector('[data-add-machine]')?.focus({ preventScroll: true });
    }

    function createBlockArtwork(def) {
      const art = BLOCK_ART[def.id] || BLOCK_ART.terril;
      const image = document.createElementNS(SVG, 'svg');
      image.classList.add('factory-block-art');
      image.setAttribute('viewBox', '0 0 128 84');
      image.setAttribute('role', 'img');
      image.setAttribute('aria-label', `Illustration : ${def.label}`);
      image.innerHTML = `<defs><linearGradient id="art-${def.id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#183348"/><stop offset="1" stop-color="#0a1927"/></linearGradient></defs><rect x="1" y="1" width="126" height="82" rx="5" fill="url(#art-${def.id})" stroke="#58768a" stroke-opacity=".34"/><path d="M8 16h112M8 73h112" stroke="#507086" stroke-opacity=".18"/><path d="M14 9h2m12 0h2m12 0h2m60 0h2m12 0h2" stroke="#84a6b6" stroke-opacity=".3" stroke-width="2"/><g stroke="#8ba9b7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" style="--art-accent:${art.accent}">${art.shape}</g>`;
      return image;
    }

    function blockSpecification(def) {
      if (def.externalInput) return 'RÉSEAU TERRESTRE';
      if (def.storesResources) return 'STOCKAGE ILLIMITÉ';
      if (def.externalOutput) return `${fmt(def.throughput)} u/s · EXPORT`;
      const throughput = Number.isFinite(def.throughput) ? `${fmt(def.throughput)} u/s` : '∞';
      return `${throughput} · ${fmt(def.energyMW)} MW`;
    }

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
      if (machine.type === 'input_dock') {
        machine.importResourceId ||= Object.keys(activeBuilding?.inventory || {}).sort()
          .find(id => activeBuilding.inventory[id] > 0) || null;
      }
      const def = typeOf(machine), finite = Number.isFinite(def.throughput);
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
      const continuous = def.source || def.externalOutput;
      cycle.style.width = `${continuous ? (machine.state === 'active' ? 100 : 0) : clamp(machine.cycleProgress * 100, 0, 100)}%`;
      const cycleLabel = card.querySelector('[data-readout="cycle"]');
      cycleLabel.textContent = def.externalInput ? `CYCLE · ${Math.floor(machine.cycleProgress * 100)} %`
        : def.storesResources
        ? `STOCKAGE · ${Object.values(machine.storedResources || {}).reduce((sum, amount) => sum + amount, 0)} U`
        : def.source ? (def.usesGround ? 'EXTRACTION CONTINUE' : 'ALIMENTATION CONTINUE')
        : def.externalOutput ? 'TRANSFERT VERS LA PLANÈTE'
        : def.sink ? `DESTRUCTION · CYCLE ${Math.floor(machine.cycleProgress * 100)} %`
          : `CYCLE · ${Math.floor(machine.cycleProgress * 100)} %`;
      for (const port of def.inputPorts) {
        const label = card.querySelector(`[data-input-label="${port.id}"]`);
        if (label) {
          const connection = def.externalOutput && connections.find(item =>
            item.toMachineId === machine.id && item.toInputId === port.id);
          const source = connection && machineById(connection.fromMachineId);
          const resource = source && typeOf(source).outputPorts
            .find(output => output.id === connection.fromOutputId);
          label.innerHTML = resource
            ? resourceLine({ ...port, label: resource.label }, machine.inputBuffer[port.id])
            : resourceLine(port, machine.inputBuffer[port.id]);
        }
      }
      for (const port of def.outputPorts) {
        const label = card.querySelector(`[data-output-label="${port.id}"]`);
        if (label) label.innerHTML = resourceLine(port, machine.outputBuffer[port.id]);
      }
      updateDockDestination(machine);
      if (def.externalInput) updateInputDock(machine);
    }

    function updateInputDock(machine) {
      const card = cards.get(machine.id), select = card?.querySelector('[data-dock-resource]');
      if (!select) return;
      const stock = activeBuilding.inventory || {};
      const resources = Object.keys(stock).filter(id => stock[id] > 0);
      if (machine.importResourceId && !resources.includes(machine.importResourceId)) resources.push(machine.importResourceId);
      resources.sort();
      const key = JSON.stringify([resources.map(id => [id, stock[id] || 0]), machine.importResourceId]);
      if (select.dataset.stockKey !== key) {
        select.dataset.stockKey = key;
        select.replaceChildren();
        if (!resources.length) {
          const option = document.createElement('option'); option.value = ''; option.textContent = 'En attente de livraison'; select.append(option);
        }
        for (const id of resources) {
          const option = document.createElement('option'); option.value = id;
          option.textContent = `${root.OrbitResourceData.get(id)?.label || id} · ${stock[id] || 0} u`;
          select.append(option);
        }
        select.value = machine.importResourceId || '';
      }
      select.disabled = !resources.length || machine.outputBuffer.material > 0 ||
        connections.some(link => link.fromMachineId === machine.id);
      select.title = select.disabled && resources.length ? 'Débranchez et videz le quai pour changer de ressource.' : 'Ressource à envoyer aux machines';
      card.querySelector('[data-received-stock]').textContent = `STOCK REÇU · ${Object.entries(stock)
        .filter(([, amount]) => amount > 0).map(([id, amount]) => `${root.OrbitResourceData.get(id)?.label || id} : ${amount} u`).join(' · ') || 'VIDE'}`;
    }

    function connectedDockResource(machine) {
      const input = typeOf(machine).inputPorts[0];
      const connection = input && connections.find(item => item.toMachineId === machine.id && item.toInputId === input.id);
      const source = connection && machineById(connection.fromMachineId);
      return source && typeOf(source).outputPorts.find(port => port.id === connection.fromOutputId)?.resourceId;
    }

    function updateDockDestination(machine) {
      if (!typeOf(machine).externalOutput) return;
      const select = cards.get(machine.id)?.querySelector('[data-dock-destination]');
      if (!select) return;
      const resourceId = connectedDockResource(machine);
      const options = getDestinations(activeBuilding) || [];
      const selected = resourceId ? activeBuilding?.dockDestinations?.[resourceId] || '' : '';
      const routeKey = JSON.stringify([resourceId, options.map(option => option.id), selected]);
      if (select.dataset.routeKey === routeKey) return;
      select.dataset.routeKey = routeKey;
      select.dataset.resourceId = resourceId || '';
      select.disabled = !resourceId || !options.length;
      select.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = !resourceId ? 'Reliez une ressource' : options.length ? 'Choisir une destination' : 'Aucun bâtiment disponible';
      select.append(placeholder);
      for (const destination of options) {
        const option = document.createElement('option');
        option.value = destination.id;
        const def = root.OrbitBuildingData.get(destination.type);
        option.textContent = destination.customName || `${def?.label || destination.type} · ${destination.id.slice(-5)}`;
        select.append(option);
      }
      select.value = options.some(option => option.id === selected) ? selected : '';
    }

    function createPort(machine, side, port, index) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `factory-port ${side}`;
      button.dataset.machineId = machine.id;
      button.dataset[side === 'input' ? 'inputId' : 'outputId'] = port.id;
      button.style.top = `${55 + index * 24}px`;
      button.setAttribute('aria-label', `${side === 'input' ? 'Entrée' : 'Sortie'} ${port.label} · ${typeOf(machine).label}`);
      return button;
    }

    function createMachineCard(machine) {
      const def = typeOf(machine), card = document.createElement('article');
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
      let dockControl = null;
      if (def.externalOutput || def.externalInput) {
        if (def.externalInput) card.classList.add('factory-node-input-dock');
        else card.classList.add('factory-node-output-dock');
        const destination = document.createElement('label'); destination.className = 'factory-dock-route';
        const label = document.createElement('span'); label.textContent = def.externalInput ? 'RESSOURCE À SORTIR' : 'DESTINATION DU QUAI';
        const select = document.createElement('select');
        if (def.externalInput) select.dataset.dockResource = machine.id;
        else select.dataset.dockDestination = machine.id;
        select.setAttribute('aria-label', def.externalInput ? 'Choisir la ressource reçue à envoyer aux machines' : 'Choisir le bâtiment destinataire pour cette ressource');
        destination.append(label, select);
        dockControl = destination;
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
      if (dockControl) body.append(dockControl);
      if (def.externalInput) {
        const stock = document.createElement('small'); stock.className = 'factory-received-stock'; stock.dataset.receivedStock = '';
        body.append(stock);
      }
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
      const start = portPoint(source, 'output', fromOutputId);
      const target = connection.toMachineId ? machineById(connection.toMachineId) : null;
      const end = target ? portPoint(target, 'input', connection.toInputId) : connection.point;
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
      const def = typeOf(machine);
      return def.inputPorts.find(input => (def.sink && !def.externalOutput) || !connections.some(connection =>
        connection.toMachineId === machine.id && connection.toInputId === input.id)) || null;
    }

    function findInputTarget(clientX, clientY) {
      let candidate = null, distance = 46;
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
        if (!input || !bounds || typeOf(machine).inputPorts.length !== 1) continue;
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
        machine.y = clamp(point.y, 8, WORLD.height - heightOf(machine.type) - 8);
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
        if (result.ok) {
          connections = graph.connections; renderConnections();
          for (const machine of machines) updateMachineReadout(machine);
        }
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
        renderConnections();
        for (const machine of machines) updateMachineReadout(machine);
        persist();
      }
    });

    function addPalette() {
      palette.dataset.context = processingResource();
      palette.replaceChildren();
      for (const def of Data.catalog(activeBuilding?.type || 'factory',
        processingResource())) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'factory-block-add'; button.dataset.addMachine = def.id;
        const specification = blockSpecification(def);
        button.setAttribute('aria-label', `${def.label}. ${def.description || 'Machine de traitement.'} ${specification}`);
        button.append(createBlockArtwork(def));
        const copy = document.createElement('span'); copy.className = 'factory-block-copy';
        const title = document.createElement('strong'); title.textContent = def.label;
        const description = document.createElement('small');
        description.className = 'factory-block-description';
        description.textContent = def.description || 'Machine de traitement industriel.';
        const specs = document.createElement('small');
        specs.className = 'factory-block-specs'; specs.textContent = specification;
        copy.append(title, description, specs); button.append(copy); palette.append(button);
      }
    }

    function addMachine(type) {
      const def = Data.get(type, processingResource());
      if (!def || !activeBuilding) return;
      const viewportBounds = viewport.getBoundingClientRect();
      const center = viewportController.worldPoint(viewportBounds.left + viewportBounds.width / 2,
        viewportBounds.top + viewportBounds.height / 2);
      const height = heightOf(type);
      const topLeft = { x: center.x - NODE.width / 2, y: center.y - height / 2 };
      const visibleTopLeft = viewportController.worldPoint(viewportBounds.left, viewportBounds.top);
      const visibleBottomRight = viewportController.worldPoint(viewportBounds.right, viewportBounds.bottom);
      const minX = Math.max(8, visibleTopLeft.x + 8);
      const maxX = Math.min(WORLD.width - NODE.width - 8, visibleBottomRight.x - NODE.width - 8);
      const minY = Math.max(8, visibleTopLeft.y + 8);
      const maxY = Math.min(WORLD.height - height - 8, visibleBottomRight.y - height - 8);
      const positions = [{ ...topLeft }];
      const stepX = NODE.width + 20, stepY = NODE.outputDockHeight + 20;
      for (let ring = 1; ring <= 8; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
          for (const dy of [-ring, ring]) positions.push({ x: topLeft.x + dx * stepX, y: topLeft.y + dy * stepY });
        }
        for (let dy = -ring + 1; dy < ring; dy++) {
          for (const dx of [-ring, ring]) positions.push({ x: topLeft.x + dx * stepX, y: topLeft.y + dy * stepY });
        }
      }
      positions.sort((a, b) => Math.hypot(a.x - topLeft.x, a.y - topLeft.y) -
        Math.hypot(b.x - topLeft.x, b.y - topLeft.y));
      const visible = position => position.x >= minX && position.x <= maxX &&
        position.y >= minY && position.y <= maxY;
      const available = positions.find(position => visible(position) &&
        machines.every(machine =>
          position.x + NODE.width + 12 <= machine.x || machine.x + NODE.width + 12 <= position.x ||
          position.y + height + 12 <= machine.y || machine.y + heightOf(machine.type) + 12 <= position.y));
      const visibleEnough = position => position.x + NODE.width > visibleTopLeft.x &&
        position.x < visibleBottomRight.x && position.y + height > visibleTopLeft.y &&
        position.y < visibleBottomRight.y;
      const offsetPlacement = machines.length ? { x: topLeft.x + 44, y: topLeft.y + 40 } : topLeft;
      const placement = available || (visibleEnough(offsetPlacement) ? offsetPlacement : topLeft);
      const result = Graph.addMachine(graph, { id: `machine-${nextMachineId++}`, type, resourceId: processingResource(),
        x: clamp(placement.x, 8, WORLD.width - NODE.width - 8),
        y: clamp(placement.y, 8, WORLD.height - height - 8) });
      if (!result.ok) { status(result.reason); return false; }
      machines = graph.machines; renderNodes(); persist();
      return true;
    }

    function removeMachine(id) {
      const machine = machineById(id);
      const discardedUnits = machine
        ? [...Object.values(machine.inputBuffer), ...Object.values(machine.outputBuffer)].reduce((sum, amount) => sum + amount, 0)
        : 0;
      const result = Graph.removeMachine(graph, id);
      if (!result.ok) { status(result.reason); return; }
      machines = graph.machines; connections = graph.connections;
      renderNodes(); persist();
      status(discardedUnits
        ? `CARTE SUPPRIMÉE · ${fmt(discardedUnits)} ${discardedUnits === 1 ? 'UNITÉ RETIRÉE' : 'UNITÉS RETIRÉES'}`
        : 'CARTE SUPPRIMÉE');
    }

    function open(building, savedPlan) {
      activeBuilding = building;
      setPaletteOpen(false);
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
      const fitHeight = Math.max(NODE.height, ...machines.map(machine => heightOf(machine.type)));
      viewportController.fit(machines, { width: NODE.width, height: fitHeight });
      status('PLAN ENREGISTRÉ');
      $('factory-editor-close').focus();
    }

    function close() {
      if (editor.hidden) return;
      setPaletteOpen(false);
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
      if (palette.dataset.context !== processingResource()) addPalette();
      if (viewportController.mode() === 'idle' && !pendingConnection) renderConnections();
    }

    paletteToggle.addEventListener('click', () => {
      if (palette.dataset.context !== processingResource()) addPalette();
      setPaletteOpen(paletteOverlay.hidden);
    });
    paletteClose.addEventListener('click', () => {
      setPaletteOpen(false);
      paletteToggle.focus({ preventScroll: true });
    });
    paletteOverlay.addEventListener('click', event => {
      if (event.target === paletteOverlay) {
        setPaletteOpen(false);
        paletteToggle.focus({ preventScroll: true });
      }
    });
    editor.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !paletteOverlay.hidden) {
        event.preventDefault();
        setPaletteOpen(false);
        paletteToggle.focus({ preventScroll: true });
      }
    });
    palette.addEventListener('click', event => {
      const button = event.target.closest('[data-add-machine]');
      if (button && addMachine(button.dataset.addMachine)) {
        setPaletteOpen(false);
        paletteToggle.focus({ preventScroll: true });
      }
    });
    viewport.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-machine]');
      if (button) removeMachine(button.dataset.removeMachine);
    });
    nodeLayer.addEventListener('change', event => {
      const resourceSelect = event.target.closest('select[data-dock-resource]');
      if (resourceSelect && activeBuilding) {
        const machine = machineById(resourceSelect.dataset.dockResource);
        if (!machine || machine.outputBuffer.material > 0 || connections.some(link => link.fromMachineId === machine.id)) return;
        if (!(activeBuilding.inventory?.[resourceSelect.value] > 0)) return;
        machine.importResourceId = resourceSelect.value;
        machine.cycleProgress = 0;
        updateMachineReadout(machine); addPalette(); persist();
        return;
      }
      const select = event.target.closest('select[data-dock-destination]');
      if (!select || !activeBuilding || !select.dataset.resourceId) return;
      const resourceId = select.dataset.resourceId, destinationId = select.value || null;
      if (onDockDestinationChange) {
        if (onDockDestinationChange(activeBuilding.id, resourceId, destinationId) === false) {
          updateDockDestination(machineById(select.dataset.dockDestination));
          status('DESTINATION INVALIDE');
          return;
        }
      } else {
        activeBuilding.dockDestinations ||= {};
        if (destinationId) activeBuilding.dockDestinations[resourceId] = destinationId;
        else delete activeBuilding.dockDestinations[resourceId];
      }
      persist();
      status(destinationId ? `QUAI · ${select.selectedOptions[0]?.textContent || 'DESTINATION'}` : 'DESTINATION DU QUAI SUPPRIMÉE');
    });

    return Object.freeze({ open, close, refresh, refreshProgress: refresh,
      isOpen: () => !editor.hidden,
      getViewportState: () => ({ camera: viewportController.camera(), mode: viewportController.mode() }) });
  }

  root.OrbitFactoryEditor = Object.freeze({ create, types: Data.definitions });
})(globalThis);
