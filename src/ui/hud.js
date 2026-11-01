(function (root) {
  'use strict';
  const Config = root.OrbitConfig;
  const BuildingData = root.OrbitBuildingData;
  const ResourceData = root.OrbitResourceData;
  const Inventory = root.OrbitInventory;
  const Data = root.OrbitOrbitalLogisticsData;

  function create(document, callbacks = {}) {
    const $ = id => document.getElementById(id);
    $('game-version').textContent = `Version ${root.OrbitVersion}`;
    const TAU = Math.PI * 2;
    const fmt = value => new Intl.NumberFormat('fr-FR').format(value);
    const fmtDecimal = value => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
    const mineralLabels = ['Fer', 'Cuivre', 'Silice', 'Carbone'];
    let toastTimer;

    const buildOptions = $('build-options');
    for (const definition of BuildingData.catalog()) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'build-option'; button.dataset.buildingType = definition.id;
      const icon = document.createElement('span'); icon.className = 'build-option-icon'; icon.textContent = definition.shortLabel;
      const copy = document.createElement('span'); copy.className = 'build-option-copy';
      const title = document.createElement('strong'); title.textContent = definition.label;
      const description = document.createElement('small'); description.textContent = definition.description;
      const cost = document.createElement('small'); cost.className = 'build-option-cost';
      cost.textContent = root.OrbitConstruction?.pricesEnabled() ? resourceSummary(definition.cost) : '';
      copy.append(title, description, cost); button.append(icon, copy); buildOptions.append(button);
    }

    function toast(text) {
      $('toast').textContent = text;
      $('toast').classList.add('visible');
      $('toast').classList.toggle('above-inspector', !$('inspector').hidden);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200);
    }

    function formatPower(watts) {
      const value = Number.isFinite(watts) && watts >= 0 ? watts : 0;
      if (value >= 1e12) return `${fmtDecimal(value / 1e12)} TW`;
      if (value >= 1e9) return `${fmtDecimal(value / 1e9)} GW`;
      if (value >= 1e6) return `${fmtDecimal(value / 1e6)} MW`;
      if (value >= 1e3) return `${fmtDecimal(value / 1e3)} kW`;
      return `${fmt(value)} W`;
    }

    function resourceName(id) {
      return ResourceData.get(id)?.label || String(id).replace(/[_-]+/g, ' ').replace(/^./, first => first.toUpperCase());
    }

    // Shares are estimates, not assays: "≈ 15 %", in steps of 5 % from 10 %
    // up and of 1 % below, "traces" under half a percent.
    function approximateShare(share) {
      if (share < .005) return 'traces';
      const percent = share * 100;
      return `≈ ${percent >= 10 ? Math.round(percent / 5) * 5 : Math.max(1, Math.round(percent))} %`;
    }

    // Ground composition, richest first: "Roche ≈ 80 % · Fer ≈ 15 % · Cuivre ≈ 3 %".
    function compositionText(composition, limit = 4) {
      return Object.entries(composition || {}).filter(([, share]) => share >= .005)
        .sort((first, second) => second[1] - first[1]).slice(0, limit)
        .map(([id, share]) => `${id === 'rock' ? 'Roche' : resourceName(id)} ${approximateShare(share)}`)
        .join(' · ') || 'Inconnue';
    }

    function resourceSummary(amounts) {
      return Object.entries(amounts || {}).map(([id, amount]) => `${resourceName(id)} ${fmt(amount)}`).join(' · ') || 'Gratuit';
    }

    function appendLogisticsRow(container, name, value, detail = '') {
      const row = document.createElement('div'); row.className = 'logistics-row';
      const label = document.createElement('span'); label.textContent = name;
      const reading = document.createElement('span'); reading.textContent = value;
      row.append(label, reading);
      if (detail) { const small = document.createElement('small'); small.textContent = detail; row.append(small); }
      container.append(row);
    }

    function renderPlatformLogistics(platform, { state, systemsById = new Map() }) {
      const systemId = platform.planetId.split(':p-')[0], system = systemsById.get(systemId);
      const stock = platform.launchStock || {}, received = platform.launchReceivedTotal || {};
      const connectedSources = (state.surfaceBuildings || []).filter(source => source.id !== platform.id &&
        source.planetId === platform.planetId && source.constructionState === 'complete' &&
        root.OrbitLogisticsNetwork.hasBuiltLandPath(state.roadNetworks?.[platform.planetId], source.id, platform.id));
      const routedSources = connectedSources.filter(source => Object.values(source.dockDestinations || {}).includes(platform.id));
      const inbound = {};
      for (const source of routedSources) for (const [resourceId, rate] of Object.entries(source.dockFlowByResource || {})) {
        if (source.dockDestinations?.[resourceId] !== platform.id) continue;
        inbound[resourceId] = (inbound[resourceId] || 0) + Math.max(0, rate || 0);
      }
      const metrics = root.OrbitOrbitalTransit.currentPlatformMetrics(state, platform.id, state.simulation.time);
      const reception = $('platform-reception-data'); reception.replaceChildren();
      const resources = new Set([...Object.keys(stock), ...Object.keys(inbound)]);
      if (!resources.size) appendLogisticsRow(reception, 'Aucune ressource reçue', '—');
      for (const resourceId of [...resources].sort()) {
        appendLogisticsRow(reception, resourceName(resourceId), fmt(stock[resourceId] || 0),
          `Entrée · ${fmtDecimal(inbound[resourceId] || 0)} u/s`);
      }
      const receivedTotal = Object.values(received).reduce((sum, amount) => sum + amount, 0);
      $('platform-received-total').textContent = `TOTAL REÇU · ${fmt(receivedTotal)} u`;

      const launch = $('platform-launch-data'); launch.replaceChildren();
      const status = root.OrbitLogistics.platformStatus(state, platform, system, state.simulation.time);
      appendLogisticsRow(launch, 'Débit actuel', `${fmtDecimal(metrics.throughput)} / ${fmt(Data.launch.capacityUPerSecond)} u/s`);
      const energyMW = (platform.energyUse || 0) / 1e6;
      appendLogisticsRow(launch, 'Énergie', `${fmtDecimal(energyMW)} / ${fmt(Data.launch.energyMW)} MW`);
      appendLogisticsRow(launch, 'État', status);
    }

    function renderOrbitalHub(state, system) {
      const hub = state.orbitalLogistics.hubs?.[system.id] || { id: system.ark.id, stock: {} };
      const metrics = root.OrbitOrbitalTransit.currentHubMetrics(state, system.id, state.simulation.time);
      const platforms = (state.surfaceBuildings || []).filter(building => building.type === 'launch_platform' &&
        building.planetId.startsWith(system.id + ':p-'));
      const connectedPlatforms = platforms.filter(platform => (state.surfaceBuildings || []).some(source => source.id !== platform.id &&
        source.planetId === platform.planetId && source.constructionState === 'complete' &&
        root.OrbitLogisticsNetwork.hasBuiltLandPath(state.roadNetworks?.[platform.planetId], source.id, platform.id)));
      const currentRate = Object.values(metrics.rates).reduce((sum, rate) => sum + rate, 0);
      const quays = $('hub-quays-data'); quays.replaceChildren();
      appendLogisticsRow(quays, 'Plateformes reliées', String(connectedPlatforms.length));
      appendLogisticsRow(quays, 'Débit / capacité', `${fmtDecimal(currentRate)} / ${fmt(connectedPlatforms.length * Data.launch.capacityUPerSecond)} u/s`);
      appendLogisticsRow(quays, 'État', connectedPlatforms.length && currentRate >= connectedPlatforms.length * Data.launch.capacityUPerSecond ? 'SATURÉ' : 'DISPONIBLE');

      const core = $('hub-core-data'); core.replaceChildren();
      appendLogisticsRow(core, 'Débit traité', `${fmtDecimal(currentRate)} u/s`);
      appendLogisticsRow(core, 'Stockage', 'Direct · sans limite');

      const stock = $('hub-stock-data'); stock.replaceChildren();
      const stocked = Object.entries(metrics.stock).sort(([a], [b]) => a.localeCompare(b));
      if (!stocked.length) appendLogisticsRow(stock, 'En attente de matières', '—');
      for (const [resourceId, amount] of stocked) appendLogisticsRow(stock, resourceName(resourceId), `${fmt(amount)} u`);

      const energy = $('hub-energy-data'); energy.replaceChildren();
      const activeLaunches = platforms.filter(platform => Number.isFinite(platform.lastLaunchTime) &&
        state.simulation.time - platform.lastLaunchTime < 1).length;
      appendLogisticsRow(energy, 'Consommation actuelle', `${fmt(activeLaunches * Data.launch.energyMW)} MW`);
      appendLogisticsRow(energy, 'Par plateforme active', `${fmt(Data.launch.energyMW)} MW`);

      const incoming = $('hub-incoming-data'); incoming.replaceChildren();
      const resourceIds = new Set([...Object.keys(metrics.stock), ...Object.keys(metrics.inTransit), ...Object.keys(metrics.rates)]);
      if (!resourceIds.size) appendLogisticsRow(incoming, 'Aucun flux en transit', '—');
      for (const resourceId of [...resourceIds].sort()) appendLogisticsRow(incoming, resourceName(resourceId),
        `Stock ${fmt(metrics.stock[resourceId] || 0)} · Transit ${fmt(metrics.inTransit[resourceId] || 0)} u`,
        `Entrée · +${fmtDecimal(metrics.rates[resourceId] || 0)} u/s`);
      return hub;
    }

    // Small line icons of the building sheet's tiles (24×24 paths).
    const ICONS = {
      speed: 'M14 4l6 6M17 7 6 18M4 20l2-2M12 5l7 7',
      rock: 'M4 15l3-7 6-2 6 4 1 6-6 3-7-1zM7 8l4 5 8-3M11 13l-1 7',
      ore: 'M3 16l4-8h10l4 8zM7 8l3 8M17 8l-3 8M3 16h18',
      flow: 'M4 12h13M13 7l5 5-5 5M4 7h5M4 17h5',
      power: 'M13 2 4 14h7l-1 8 9-12h-7z',
      water: 'M12 3c-4 5-6 8-6 11a6 6 0 0 0 12 0c0-3-2-6-6-11z',
      cards: 'M4 6h10v12H4zM10 3h10v12h-3',
      data: 'M12 3 21 7.5 12 12 3 7.5zM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5',
      link: 'M5 19a10 10 0 0 1 0-14M9 15a5 5 0 0 1 0-6M19 5a10 10 0 0 1 0 14M15 9a5 5 0 0 1 0 6M12 12h.01',
      temperature: 'M10 4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0zM12 9v7',
      clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3',
      planet: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM2 14c4 3 16 0 20-6',
      box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8'
    };
    const tile = (icon, label, value) => ({ icon, label, value });
    const rate = value => `${fmtDecimal(Math.round((Number.isFinite(value) ? value : 0) * 10) / 10)} /min`;
    // What a building's sheet shows: a few tiles of what matters to play it.
    function buildingStats(building) {
      if (building.constructionState === 'supplying') {
        const needs = BuildingData.get(building.type)?.constructionNeeds || {};
        return Object.entries(needs).map(([id, amount]) =>
          tile('box', resourceName(id), `${fmt(Math.min(amount, building.constructionSupplied?.[id] || 0))} / ${fmt(amount)}`));
      }
      if (building.constructionState === 'constructing') {
        return [tile('clock', 'Assemblage', building.status === 'queued' ? 'En attente des robots'
          : `${Math.round((building.constructionProgress || 0) * 100)} %`)];
      }
      const flow = building.flowPerMinute;
      // The richest of the ground, as shares.
      const ground = () => Object.entries(building.composition || {}).filter(([, share]) => share >= .005)
        .sort((a, b) => b[1] - a[1])
        .map(([id, share]) => tile(id === 'rock' ? 'rock' : 'ore', id === 'rock' ? 'Roche' : resourceName(id), approximateShare(share)));
      switch (building.type) {
        case 'extractor': return [tile('speed', 'Vitesse', rate(flow)), ...ground()];
        case 'factory': return [];
        case 'oil_platform': return [tile('speed', 'Extraction', rate(flow)),
          tile('ore', 'Pétrole', Number.isFinite(building.resourceShare) ? approximateShare(building.resourceShare) : '—')];
        case 'water_station': return [tile('water', 'Eau', building.resourceId === 'salt_water' ? 'Salée' : 'Douce'), tile('flow', 'Débit', rate(flow))];
        case 'waste_heap': return [];
        case 'storage': return [];
        case 'antenna': case 'datacenter': case 'hf_antenna': case 'lab': return dataStats(building);
        default: return [];
      }
    }

    // Where a building's goods come from and go to, by resource, with the
    // names of the buildings: arrivals by road (docks, depot gates) and
    // departures (its docks' destinations, its depot gates).
    function buildingFlows(building) {
      const buildings = currentState?.surfaceBuildings || [], plans = currentState?.factoryPlans || {};
      const nameOf = item => item?.customName || BuildingData.get(item?.type)?.label || '—';
      const group = entries => {
        const byResource = new Map();
        for (const { resource, name } of entries) {
          const names = byResource.get(resource) || new Set(); names.add(name); byResource.set(resource, names);
        }
        return [...byResource].map(([resource, names]) => ({ resource, names: [...names].join(', ') }))
          .sort((a, b) => a.resource.localeCompare(b.resource));
      };
      const arrivals = [], departures = [];
      for (const source of buildings) {
        if (source.id === building.id || source.planetId !== building.planetId) continue;
        for (const [resourceId, destination] of Object.entries(source.dockDestinations || {})) {
          if (destination === building.id) arrivals.push({ resource: resourceName(resourceId), name: nameOf(source) });
        }
        if ((plans[source.id]?.machines || []).some(machine => machine.type === 'depot_output' && machine.config?.destinationId === building.id)) {
          arrivals.push({ resource: 'Flux du dépôt', name: nameOf(source) });
        }
      }
      for (const [resourceId, destination] of Object.entries(building.dockDestinations || {})) {
        if (building.type === 'datacenter') continue;
        departures.push({ resource: resourceName(resourceId), name: nameOf(buildings.find(item => item.id === destination)) });
      }
      for (const machine of plans[building.id]?.machines || []) {
        if (machine.type !== 'depot_output' || !machine.config?.destinationId) continue;
        const filter = machine.config.filterResourceId;
        departures.push({ resource: filter ? resourceName(filter) : 'Porte de sortie',
          name: nameOf(buildings.find(item => item.id === machine.config.destinationId)) });
      }
      return { arrivals: group(arrivals), departures: group(departures) };
    }

    // What a depot holds: received, in its buffers and waiting at its gates.
    function heldStock(building) {
      const held = {};
      const add = stock => { for (const [id, amount] of Object.entries(stock || {})) held[id] = (held[id] || 0) + amount; };
      add(building.inventory);
      for (const queue of Object.values(building.gateStock || {})) add(queue);
      for (const machine of currentState?.factoryPlans?.[building.id]?.machines || []) add(machine.storedResources);
      return Object.entries(held).filter(([, amount]) => amount >= 1).map(([id, amount]) => [id, Math.floor(amount)]).sort((a, b) => b[1] - a[1]);
    }

    function renderFlows(building) {
      const list = $('building-flows');
      const shown = building.constructionState === 'complete' && ['factory', 'storage', 'waste_heap', 'extractor', 'water_station', 'oil_platform'].includes(building.type);
      const flows = shown ? buildingFlows(building) : { arrivals: [], departures: [] };
      // A relay antenna: the buildings it gathers, by kind of data.
      const relayed = building.type === 'antenna' ? (currentState?.dataLinks?.[building.id]?.sources || []).map(id => {
        const source = currentState.surfaceBuildings.find(item => item.id === id);
        const spec = root.OrbitDataNetworkData.sources[source?.type];
        return { resource: resourceName(spec?.resourceId), name: source?.customName || '—' };
      }) : [];
      if (relayed.length) {
        const byResource = new Map();
        for (const item of relayed) byResource.set(item.resource, [...(byResource.get(item.resource) || []), item.name]);
        flows.sources = [...byResource].map(([resource, names]) => ({ resource, names: names.join(', ') }));
      }
      const held = building.type === 'storage' && building.constructionState === 'complete' ? heldStock(building) : null;
      const key = JSON.stringify([flows, held]);
      if (list.dataset.key === key) return;
      list.dataset.key = key;
      // Each flow is a full-width line: an arrow (in or out), the resource, the buildings.
      const section = (title, entries, arrow, empty) => {
        const block = document.createElement('section'); block.className = 'building-flow';
        const heading = document.createElement('h3'); heading.textContent = title; block.append(heading);
        if (!entries.length) {
          const none = document.createElement('p'); none.textContent = empty; block.append(none);
        }
        for (const entry of entries) block.append(root.OrbitPanelKit.line(document, arrow === '←' ? 'in' : 'out', entry.resource, entry.names));
        return block;
      };
      const blocks = [];
      if (shown && ['factory', 'storage', 'waste_heap'].includes(building.type)) blocks.push(section('PROVENANCE', flows.arrivals, '←', 'Rien n’arrive encore.'));
      if (shown) blocks.push(section('DESTINATIONS', flows.departures, '→', 'Aucune destination choisie (cartes du bâtiment).'));
      if (flows.sources) blocks.push(section('SOURCES', flows.sources, '←', ''));
      // A depot's stock, as lines with a box.
      if (held) {
        const block = document.createElement('section'); block.className = 'building-flow';
        const heading = document.createElement('h3'); heading.textContent = 'STOCK'; block.append(heading);
        if (!held.length) { const none = document.createElement('p'); none.textContent = 'Vide.'; block.append(none); }
        for (const [id, amount] of held) block.append(root.OrbitPanelKit.line(document, 'stock', resourceName(id), '', `${fmt(amount)} u`));
        blocks.unshift(block);
      }
      list.replaceChildren(...blocks);
      list.hidden = !blocks.length;
    }

    function renderBuildingReadout(building) {
      renderFlows(building);
      const definition = BuildingData.get(building.type);
      $('building-kind').textContent = definition?.label || 'BÂTIMENT';
      $('building-level').textContent = `NIV. ${fmt(building.upgradeLevel || 1)}`;
      // Power drawn, or made by a generator.
      const made = building.energyOutputWatts > 0 && ['wind_turbine', 'waste_heap', 'geothermal'].includes(building.type);
      const watts = made ? building.energyOutputWatts : building.energyUse || 0;
      $('building-power').textContent = made || watts > 0 ? `${made ? '+' : ''}${formatPower(watts)}` : '';
      $('building-power').classList.toggle('made', made);
      const canvas = $('building-icon');
      if (canvas.dataset.type !== building.type) { canvas.dataset.type = building.type; root.OrbitBuildingRenderer?.drawBadge(canvas, building.type); }
      const stats = $('building-stats');
      const tiles = buildingStats(building);
      const key = JSON.stringify(tiles);
      if (stats.dataset.key === key) return;
      stats.dataset.key = key;
      stats.hidden = !tiles.length;
      stats.replaceChildren(...tiles.map(item => {
        const cell = document.createElement('div'); cell.className = 'building-tile';
        cell.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[item.icon] || ICONS.box}"/></svg>`;
        const text = document.createElement('div');
        const label = document.createElement('span'); label.textContent = item.label;
        const value = document.createElement('strong'); value.textContent = item.value;
        text.append(label, value); cell.append(text);
        return cell;
      }));
    }

    function clearBuildingPanelPosition() {
      const panel = $('inspector');
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
      panel.style.removeProperty('right');
      panel.style.removeProperty('bottom');
    }

    function showSelection(item, { state, systemModel }) {
      const panel = $('inspector');
      panel.hidden = false;
      $('toast').classList.remove('visible');
      const isBuilding = item.kind === 'building';
      const isArk = item.kind === 'orbital-hub';
      const isLaunchPlatform = isBuilding && item.type === 'launch_platform';
      const hasFactoryEditor = isBuilding && BuildingData.processTypes.includes(item.type);
      panel.classList.toggle('building-panel', isBuilding);
      panel.classList.toggle('launch-platform-panel', isLaunchPlatform);
      panel.classList.toggle('orbital-hub-panel', isArk);
      clearBuildingPanelPosition();
      $('building-head').hidden = !isBuilding;
      $('building-meta').hidden = !isBuilding || isLaunchPlatform;
      panel.querySelector('.inspector-top').hidden = isBuilding;
      $('building-readout').hidden = !isBuilding || isLaunchPlatform;
      $('platform-logistics').hidden = !isLaunchPlatform;
      $('orbital-hub-logistics').hidden = !isArk;
      $('demolish-button').hidden = !isBuilding || Boolean(BuildingData.get(item.type)?.indestructible);
      $('selection-name').hidden = isBuilding;
      $('building-name').hidden = !isBuilding;
      $('factory-edit-button').hidden = !hasFactoryEditor;
      // Only buildings with cards can be saved to the build menu.
      $('save-building-button').hidden = !hasFactoryEditor;
      $('hf-destination').hidden = !(isBuilding && item.type === 'hf_antenna');
      if (state.level !== 'system' || item.kind !== 'gazeuse') $('orbital-lab-button').hidden = true;
      $('selection-info').hidden = isBuilding || isArk;
      $('selection-meta').hidden = isBuilding || isArk;
      if (state.level === 'galaxy') {
        const planets = systemModel.planets.length, belts = systemModel.debris.length;
        $('selection-type').textContent = 'SYSTÈME STELLAIRE';
        $('selection-name').textContent = item.name;
        $('selection-info').textContent = `Étoile de classe ${item.stellarClass}. ${planets ? `${planets} planète${planets > 1 ? 's' : ''} détectée${planets > 1 ? 's' : ''}.` : 'Aucune planète détectée.'} ${belts ? `${belts} ceinture${belts > 1 ? 's' : ''} de débris.` : 'Aucune ceinture de débris.'}`;
        $('selection-meta').textContent = `X ${Math.round(item.x)} · Y ${Math.round(item.y)}   /   ${state.exploration.visited.has(item.id) ? 'VISITÉ' : 'DÉTECTÉ'}`;
        $('enter-label').textContent = 'Zoomer sur le système';
        $('enter-button').hidden = false;
        $('enter-button').disabled = false;
      } else if (isArk) {
        $('selection-type').textContent = 'HUB ORBITAL · VAISSEAU-MÈRE';
        $('selection-name').textContent = item.name || 'L’ARCHE';
        $('selection-info').textContent = '';
        $('selection-meta').textContent = '';
        $('enter-button').hidden = true;
        renderOrbitalHub(state, systemModel);
      } else if (state.level === 'system') {
        $('selection-type').textContent = 'CORPS PLANÉTAIRE';
        $('selection-name').textContent = item.name;
        $('selection-info').textContent = item.kind === 'gazeuse' ? 'Géante gazeuse. Une atmosphère profonde, sans surface solide.' :
          `Monde ${item.kind}. Température estimée : ${Math.round(item.temperature)} °C. Atmosphère ${item.atmosphere}${item.startingCandidate ? '. Monde tempéré.' : '.'}`;
        $('selection-meta').textContent = `${item.distanceAU.toFixed(2)} UA   /   PÉRIODE ${Math.round(TAU / item.speed)} s`;
        $('enter-label').textContent = item.kind === 'gazeuse' ? 'Aucune surface solide' : 'Zoomer sur la surface';
        $('enter-button').hidden = false;
        $('enter-button').disabled = item.kind === 'gazeuse';
        // A gas giant takes a lab in orbit, once the skill "Atterrisseur" is acquired.
        const orbitalLabAllowed = item.kind === 'gazeuse' && !root.OrbitProgression.buildBlockedHere(state, 'lab', item) &&
          root.OrbitProgression.buildingUnlocked(state, 'lab');
        const hasLab = (state.surfaceBuildings || []).some(building => building.type === 'lab' && building.planetId === item.id);
        $('orbital-lab-button').hidden = !orbitalLabAllowed;
        $('orbital-lab-button').disabled = hasLab;
        $('orbital-lab-label').textContent = hasLab ? 'Laboratoire en orbite' : 'Poser un laboratoire en orbite';
      } else if (item.kind === 'building') {
        const definition = BuildingData.get(item.type);
        $('selection-type').textContent = definition?.label || 'INFRASTRUCTURE';
        $('selection-name').textContent = item.customName || definition?.label || 'BÂTIMENT';
        // The name is edited in place.
        const nameInput = $('building-name');
        if (document.activeElement !== nameInput) nameInput.value = item.customName || '';
        $('selection-info').textContent = '';
        $('selection-meta').textContent = '';
        if (!isLaunchPlatform) renderBuildingReadout(item);
        else renderPlatformLogistics(item, { state, systemsById: new Map([[state.system?.id, state.system]]) });
        $('enter-button').hidden = true;
        const refundRate = Number.isFinite(item.demolitionRefundRate) ? item.demolitionRefundRate : 1;
        $('demolish-label').textContent = root.OrbitConstruction?.pricesEnabled()
          ? `DÉMOLIR · RÉCUPÉRER ${Math.round(refundRate * 100)} %` : 'DÉMOLIR';
      } else {
        $('selection-type').textContent = 'RELEVÉ DE TERRAIN';
        $('selection-name').textContent = item.name;
        $('selection-info').textContent = item.info;
        $('selection-meta').textContent = `X ${Math.round(item.x)} km · Y ${Math.round(item.y)} km   /   ALT. ${item.altitude} m`;
        $('enter-button').hidden = true;
      }
    }

    let currentState = null;
    // The data network as seen from a relay antenna, a datacenter or a lab.
    function dataStats(building) {
      const links = Object.values(currentState?.dataLinks || {}), Spec = root.OrbitDataNetworkData;
      const nameOf = id => currentState?.surfaceBuildings.find(item => item.id === id)?.customName || '—';
      if (building.type === 'antenna') {
        const link = currentState?.dataLinks?.[building.id];
        const inChain = Number.isInteger(link?.hops);
        return [
          tile('data', 'Sources', fmt(link?.sources.length || 0)),
          tile('flow', 'Débit', `${fmtDecimal(Math.round((link?.carried || 0) * 10) / 10)} / ${fmt(Spec.antenna.bandwidthMbPerSecond)} Mo/s`),
          tile('link', 'Transmet à', inChain ? nameOf(link.nextId) : 'Hors chaîne')
        ];
      }
      if (building.type === 'hf_antenna' || building.type === 'lab') return transmitterStats(building);
      const received = links.filter(link => link.nextId === building.id).reduce((sum, link) => sum + link.carried, 0);
      const factor = Spec.coolingFactor(building.siteTemperature);
      return [
        tile('temperature', 'Site', Number.isFinite(building.siteTemperature) ? `${fmt(Math.round(building.siteTemperature))} °C` : '—'),
        tile('power', 'Énergie', `×${fmtDecimal(Math.round(factor * 100) / 100)}`),
        tile('flow', 'Reçu', `${fmtDecimal(Math.round(received * 10) / 10)} Mo/s`)
      ];
    }

    // The destination picker of a high-frequency antenna: the Ark, or an
    // antenna of another planet of the system (a relay between worlds).
    function renderHfDestination(building) {
      const select = $('hf-destination-select');
      const choices = root.OrbitDataTransit.destinationChoices(currentState, building);
      const planetLabel = planetId => `planète ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][Number(String(planetId).split(':p-')[1])] || '?'}`;
      const current = choices.some(item => item.id === building.hfTarget) ? building.hfTarget : 'ark';
      const key = JSON.stringify([building.id, choices.map(item => [item.id, item.customName]), current]);
      if (select.dataset.key === key || document.activeElement === select) return;
      select.dataset.key = key; select.dataset.buildingId = building.id;
      const option = (value, text) => { const node = document.createElement('option'); node.value = value; node.textContent = text; return node; };
      select.replaceChildren(option('ark', 'L’Arche'),
        ...choices.map(item => option(item.id, `${item.customName || 'Antenne haute fréquence'} · ${planetLabel(item.planetId)}`)));
      select.value = current;
    }

    // A high-frequency antenna, or a lab using its own transmitter: where its
    // data goes, or why it waits (solar conjunction…), and what waits.
    function transmitterStats(building) {
      const Spec = root.OrbitDataNetworkData, link = building.dataLink;
      const target = link?.toKind === 'ark' ? 'l’Arche' : link?.toId
        ? currentState?.surfaceBuildings.find(item => item.id === link.toId)?.customName || 'autre planète' : null;
      const status = !link ? 'En attente' : link.reason === 'conjunction' ? 'Conjonction solaire'
        : link.reason === 'no_receiver' ? 'Aucun datacenter' : link.reason === 'no_ark' ? 'Pas d’Arche'
          : link.reason ? 'Indisponible' : `→ ${target}`;
      const queued = Object.values(building.dataQueue || {}).reduce((sum, amount) => sum + amount, 0);
      const tiles = [];
      if (building.type === 'lab') {
        tiles.push(tile('data', 'Données', `${fmtDecimal(Spec.sourceRate(Spec.sources.lab, building))} Mo/s`),
          tile('planet', 'Monde', building.siteKind || '—'));
        const relayed = Object.values(currentState?.dataLinks || {}).some(item => item.sources.includes(building.id));
        if (relayed) return [...tiles, tile('link', 'Transmission', 'Antenne relais')];
      }
      return [...tiles, tile('link', 'Liaison', status), tile('box', 'En attente', `${fmt(queued)} Mo`)];
    }

    function update({ state, galaxy, terrainData, width, scaleCamera, buildingPosition }) {
      currentState = state;
      const selectedBuilding = state.selected?.kind === 'building'
        ? state.surfaceBuildings.find(building => building.id === state.selected.id) : null;
      if (selectedBuilding?.type === 'hf_antenna' && !$('hf-destination').hidden) renderHfDestination(selectedBuilding);
      if (selectedBuilding && !$('building-readout').hidden) renderBuildingReadout(selectedBuilding);
      const systemsById = new Map();
      if (state.system) systemsById.set(state.system.id, state.system);
      if (selectedBuilding?.type === 'launch_platform' && !$('platform-logistics').hidden) {
        renderPlatformLogistics(selectedBuilding, { state, systemsById });
      }
      if (state.selected?.kind === 'orbital-hub' && !$('orbital-hub-logistics').hidden && state.system) {
        renderOrbitalHub(state, state.system);
      }
      const level = state.level;
      document.body.dataset.level = level;
      document.body.dataset.tool = state.tool;
      // Galaxy-wide totals: population of every colony and context gathered.
      const population = root.OrbitColony.totalPopulation(state);
      const contextText = fmt(Math.floor((root.OrbitSkills.isUnlocked(state, 'computer_network') ? state.techPoints : state.contextPoints) || 0));
      $('stat-label').textContent = 'POPULATION';
      if ($('stat-value').textContent !== fmt(population)) $('stat-value').textContent = fmt(population);
      // Once the data network exists, technology points take the place of context.
      const techShown = root.OrbitSkills.isUnlocked(state, 'computer_network');
      $('secondary-label').textContent = techShown ? 'POINTS TECH' : 'CONTEXTE';
      $('secondary-stat').title = techShown ? 'Points de technologie' : 'Contexte';
      $('skill-tree-button').hidden = !root.OrbitSkills.available(state);
      if ($('secondary-value').textContent !== contextText) $('secondary-value').textContent = contextText;
      $('scan-button').hidden = level !== 'galaxy';
      $('scan-button').disabled = level !== 'galaxy';
      $('build-button').hidden = level !== 'surface';
      $('build-button').disabled = level !== 'surface';
      $('road-button').hidden = level !== 'surface';
      $('road-button').disabled = level !== 'surface';
      $('build-button').setAttribute('aria-expanded', String(state.buildMenuOpen));
      $('build-button').setAttribute('aria-label', state.tool === 'build' ? 'Annuler la pose' : 'Ouvrir le catalogue des bâtiments');
      $('road-button').setAttribute('aria-pressed', String(state.tool === 'road'));
      $('build-menu').hidden = level !== 'surface' || !state.buildMenuOpen;
      for (const option of buildOptions.children) {
        const definition = BuildingData.get(option.dataset.buildingType);
        const price = root.OrbitConstruction.costFor(option.dataset.buildingType) || {};
        const showPrice = root.OrbitConstruction.pricesEnabled();
        const unique = (definition?.placementRules?.uniquePerPlanet || definition?.placementRules?.uniqueInGame) &&
          (state.surfaceBuildings || []).some(building => building.type === definition.id &&
            (definition.placementRules.uniqueInGame || building.planetId === state.planet?.id));
        // Buildings appear as the colony needs them.
        option.hidden = !root.OrbitProgression.buildingUnlocked(state, option.dataset.buildingType);
        // A world without colony takes only a colony or labs (skill "Atterrisseur").
        const blocked = state.planet ? root.OrbitProgression.buildBlockedHere(state, option.dataset.buildingType, state.planet) : null;
        option.disabled = unique || Boolean(blocked) || !Inventory.canAfford(state.inventory, price);
        // Prices are masked for now: only the unique-base notice shows.
        const costLabel = option.querySelector('.build-option-cost'), costText = unique ? 'Déjà posée' : blocked && !option.hidden ? 'Hors colonie' : showPrice ? resourceSummary(price) : '';
        if (costLabel && costLabel.textContent !== costText) costLabel.textContent = costText;
        if (costLabel) costLabel.hidden = !costText;
        if (definition) option.title = unique ? 'Un seul exemplaire possible.' : blocked || option.disabled
          ? `Ressources requises : ${resourceSummary(price)}` : definition.description;
      }
      renderBuildMenuTabs(state);
      $('resource-stock').textContent = root.OrbitProcessData?.config.colonyReserveInfinite ? 'RÉSERVE COLONIE ∞ · MODE V1' :
        `STOCK · ${ResourceData.catalog().filter(resource => Object.hasOwn(ResourceData.startingInventory, resource.id))
          .map(resource => `${resource.label} ${Inventory.isInfinite(resource.id) ? '∞' : fmt(state.inventory?.[resource.id] || 0)}`).join(' · ')}`;
      $('build-menu-title').textContent = 'INFRASTRUCTURES';
      // On a world without colony, say what may be built there.
      const settled = (state.surfaceBuildings || []).some(building => building.type === 'colony' && building.planetId === state.planet?.id);
      const anyColony = (state.surfaceBuildings || []).some(building => building.type === 'colony');
      $('build-menu-hint').hidden = !(level === 'surface' && anyColony && !settled);
      $('build-menu-hint').textContent = root.OrbitProgression.buildBlockedHere(state, 'factory', state.planet) || '';
      // The planet's power, discreet: drawn / produced, with a thin bar.
      const power = level === 'surface' ? state.powerStatus?.[state.planet?.id] : null;
      $('power-gauge').hidden = !power;
      if (power) {
        const supply = power.supplyMW, finite = Number.isFinite(supply);
        const text = `${fmt(Math.round(power.demandMW))} / ${finite ? fmt(Math.round(supply)) : '∞'} MW`;
        if ($('power-value').textContent !== text) $('power-value').textContent = text;
        $('power-fill').style.width = `${finite && supply > 0 ? Math.min(100, power.demandMW / supply * 100) : 0}%`;
        $('power-gauge').classList.toggle('short', finite && power.demandMW > supply + 1e-6);
      }
      // Back names the scale it returns to; the galaxy has none above.
      $('back-button').hidden = level === 'galaxy';
      $('back-label').textContent = level === 'surface' ? 'SYSTÈME' : 'GALAXIE';
      $('scan-button').classList.toggle('active', state.tool === 'scan');
      $('build-button').classList.toggle('active', state.tool === 'build' || state.buildMenuOpen);
      $('road-button').classList.toggle('active', state.tool === 'road');
    }

    // The build menu's second tab: buildings the player saved (state.library),
    // placed again with their name and cards.
    let savedSignature = null;
    function renderBuildMenuTabs(state) {
      const saved = (state.library?.buildings || []).filter(item => BuildingData.processTypes.includes(item.type));
      const tab = state.buildMenuTab === 'saved' ? 'saved' : 'catalog';
      for (const [id, name] of [['build-tab-catalog', 'catalog'], ['build-tab-saved', 'saved']]) {
        $(id).classList.toggle('active', tab === name);
        $(id).setAttribute('aria-selected', String(tab === name));
      }
      $('build-options').hidden = tab !== 'catalog';
      $('resource-stock').hidden = tab !== 'catalog';
      $('saved-buildings').hidden = tab !== 'saved';
      $('saved-buildings-count').textContent = String(saved.length);
      const available = saved.map(item => root.OrbitProgression.buildingUnlocked(state, item.type));
      const signature = JSON.stringify([saved.map(item => [item.id, item.name]), available]);
      if (signature === savedSignature) return;
      savedSignature = signature;
      const list = $('saved-buildings');
      if (!saved.length) {
        const empty = document.createElement('p'); empty.className = 'saved-buildings-empty';
        empty.textContent = 'Aucun bâtiment enregistré. Touchez un bâtiment, puis « Enregistrer le bâtiment ».';
        list.replaceChildren(empty); return;
      }
      list.replaceChildren(...saved.map((item, index) => {
        const definition = BuildingData.get(item.type);
        const entry = document.createElement('div'); entry.className = 'saved-building';
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'build-option'; button.dataset.savedBuildingId = item.id;
        button.disabled = !available[index] || !definition;
        const icon = document.createElement('span'); icon.className = 'build-option-icon'; icon.textContent = definition?.shortLabel || '?';
        const copy = document.createElement('span'); copy.className = 'build-option-copy';
        const title = document.createElement('strong'); title.textContent = item.name;
        const cards = item.plan.machines.length;
        const description = document.createElement('small');
        description.textContent = `${definition?.label || item.type}${cards ? ` · ${cards} carte${cards > 1 ? 's' : ''}` : ''}${available[index] ? '' : ' · pas encore disponible'}`;
        copy.append(title, description); button.append(icon, copy);
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'saved-building-remove'; remove.dataset.deleteSavedBuilding = item.id;
        remove.setAttribute('aria-label', `Retirer ${item.name} des bâtiments enregistrés`); remove.textContent = '×';
        entry.append(button, remove);
        return entry;
      }));
    }

    return Object.freeze({ toast, showSelection, update, compositionText });
  }

  root.OrbitHUD = Object.freeze({ create });
})(globalThis);
