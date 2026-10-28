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

    function inventoryEntries(building, property = 'inventory') {
      return Object.entries(building[property] || {})
        .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, amount]) => ({ name: resourceName(id), amount }));
    }

    // The colony: its population, the tier it climbs and what that tier asks.
    function colonyStats(building) {
      const colony = root.OrbitColony.normalize(building.colony), tiers = root.OrbitColonyData.tiers;
      const tier = tiers[colony.tier];
      const rows = [['POPULATION', `${fmt(colony.population)} habitants`],
        ['CONTEXTE', `+${fmtDecimal(root.OrbitColonyData.contextPerMinute)} / min`]];
      if (tier) {
        rows.push([`PALIER ${colony.tier + 1} / ${tiers.length} · ${fmt(tier.population)} HAB.`, Object.entries(tier.needs)
          .map(([id, amount]) => `${resourceName(id)} ${fmt(colony.progress[id] || 0)} / ${fmt(amount)}`).join('  /  ')]);
      } else rows.push(['PALIERS', 'Tous atteints pour l’instant']);
      const stock = inventoryEntries(building, 'inventory');
      if (stock.length) rows.push(['EN RÉSERVE', stock.map(item => `${item.name} · ${fmtDecimal(item.amount)}`).join('  /  ')]);
      rows.push(['GÉNÉRATEUR', formatPower((BuildingData.get('colony')?.generatorMW || 0) * 1e6)]);
      return rows;
    }

    function buildingStats(building) {
      const flow = Number.isFinite(building.flowPerMinute) ? building.flowPerMinute : 0;
      const property = BuildingData.dockSourceTypes.includes(building.type) ? 'dockStock' : 'inventory';
      const inventory = inventoryEntries(building, property), total = inventory.reduce((sum, item) => sum + item.amount, 0);
      const stockText = inventory.length
        ? inventory.map(item => `${item.name} · ${fmtDecimal(item.amount)}`).join('  /  ')
        : 'Aucune ressource en stock';
      const received = inventoryEntries(building, 'inventory');
      const receivedText = received.length
        ? received.map(item => `${item.name} · ${fmtDecimal(item.amount)}`).join('  /  ')
        : 'Aucune ressource reçue';
      const byType = {
        factory: [
          ['DÉBIT EN SORTIE', `${fmtDecimal(flow)} / min`],
          ['STOCK AU DOCK', inventory.length ? stockText : 'Aucune ressource dockée'],
          ['STOCK REÇU', receivedText]
        ],
        extractor: [
          ['VITESSE DE MINAGE', `${fmtDecimal(flow)} / min`],
          ['ROCHE EXTRAITE', compositionText(building.composition)],
          ['STOCK AU DOCK', inventory.length ? stockText : 'Aucune ressource dockée'],
          ['STOCK REÇU', receivedText]
        ],
        oil_platform: [
          ['VITESSE D’EXTRACTION', `${fmtDecimal(flow)} / min`],
          ['RESSOURCE', `Pétrole${Number.isFinite(building.resourceShare) ? ` · ${approximateShare(building.resourceShare)}` : ''}`]
        ],
        wind_turbine: [['PRODUCTION ÉLECTRIQUE', building.energyOutputUnlimited ? '∞ · MODE V1' : formatPower(building.energyOutputWatts)]],
        launch_platform: [['FONCTION', 'Export orbital vers l’Arche']],
        colony: colonyStats(building),
        storage: [
          ['EN ATTENTE D’ENTRÉE', stockText],
          ['QUANTITÉ TOTALE', fmtDecimal(total)],
          ['DÉBIT DES PORTES', `${fmtDecimal(flow)} / min`]
        ],
        water_station: [
          ['EAU POMPÉE', building.resourceId === 'salt_water' ? 'Eau salée · mer' : 'Eau douce · lac ou rivière'],
          ['DÉBIT EN SORTIE', `${fmtDecimal(flow)} / min`],
          ['STOCK AU DOCK', inventory.length ? stockText : 'Aucune ressource dockée']
        ],
        waste_heap: [
          ['DÉCHETS REÇUS', receivedText],
          ['DÉBIT EN SORTIE', `${fmtDecimal(flow)} / min`],
          ['STOCK AU DOCK', inventory.length ? stockText : 'Aucune ressource dockée'],
          ...(building.energyOutputWatts > 0 ? [['PRODUCTION ÉLECTRIQUE', formatPower(building.energyOutputWatts)]] : [])
        ],
        surface_port: [['FONCTION', 'Relais entre navires et transport terrestre']]
      };
      const rows = byType[building.type] || [];
      if (building.energyUse > 0) rows.push(['PUISSANCE UTILISÉE', formatPower(building.energyUse)]);
      if (building.constructionState === 'constructing') {
        rows.unshift(['ASSEMBLAGE', building.status === 'queued' ? 'En attente d’une équipe de robots'
          : `${Math.round((building.constructionProgress || 0) * 100)} %`]);
      }
      return rows;
    }

    function renderBuildingReadout(building) {
      $('building-level').textContent = `NIVEAU D’AMÉLIORATION ${fmt(building.upgradeLevel || 1)}`;
      const stats = $('building-stats');
      stats.replaceChildren();
      for (const [label, value] of buildingStats(building)) {
        const row = document.createElement('div'); row.className = 'building-stat';
        const name = document.createElement('span'); name.className = 'building-stat-label'; name.textContent = label;
        const reading = document.createElement('span'); reading.className = 'building-stat-value'; reading.textContent = value;
        row.append(name, reading); stats.append(row);
      }
    }

    function clearBuildingPanelPosition() {
      const panel = $('inspector');
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
      panel.style.removeProperty('right');
      panel.style.removeProperty('bottom');
    }

    function positionBuildingPanel(point) {
      const panel = $('inspector');
      if (!point || panel.hidden || !panel.classList.contains('building-panel')) return;
      const panelRect = panel.getBoundingClientRect();
      const rootStyle = getComputedStyle(document.documentElement);
      const edge = parseFloat(rootStyle.getPropertyValue('--edge')) || 8;
      const safeTop = parseFloat(rootStyle.getPropertyValue('--safe-top')) || 0;
      const safeBottom = parseFloat(rootStyle.getPropertyValue('--safe-bottom')) || 0;
      const safeLeft = parseFloat(rootStyle.getPropertyValue('--safe-left')) || 0;
      const safeRight = parseFloat(rootStyle.getPropertyValue('--safe-right')) || 0;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const minLeft = edge + safeLeft;
      const maxLeft = Math.max(minLeft, viewportWidth - panelRect.width - edge - safeRight);
      const minTop = edge + safeTop;
      const maxTop = Math.max(minTop, viewportHeight - 108 - safeBottom - panelRect.height);
      const gap = 12;
      let left = point.x + gap;
      if (left > maxLeft) left = point.x - panelRect.width - gap;
      const top = Math.max(minTop, Math.min(maxTop, point.y - panelRect.height / 2));
      left = Math.max(minLeft, Math.min(maxLeft, left));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
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
      if (!isBuilding) clearBuildingPanelPosition();
      $('building-readout').hidden = !isBuilding || isLaunchPlatform;
      $('platform-logistics').hidden = !isLaunchPlatform;
      $('orbital-hub-logistics').hidden = !isArk;
      $('demolish-button').hidden = !isBuilding || Boolean(BuildingData.get(item.type)?.indestructible);
      $('factory-edit-button').hidden = !hasFactoryEditor;
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
      } else if (item.kind === 'building') {
        const definition = BuildingData.get(item.type);
        $('selection-type').textContent = definition?.label || 'INFRASTRUCTURE';
        $('selection-name').textContent = item.customName || definition?.label || 'BÂTIMENT';
        $('selection-info').textContent = '';
        $('selection-meta').textContent = '';
        if (!isLaunchPlatform) renderBuildingReadout(item);
        else renderPlatformLogistics(item, { state, systemsById: new Map([[state.system?.id, state.system]]) });
        $('enter-button').hidden = true;
        const refundRate = Number.isFinite(item.demolitionRefundRate) ? item.demolitionRefundRate : 1;
        $('demolish-button').textContent = root.OrbitConstruction?.pricesEnabled()
          ? `DÉMOLIR · RÉCUPÉRER ${Math.round(refundRate * 100)} %` : 'DÉMOLIR';
      } else {
        $('selection-type').textContent = 'RELEVÉ DE TERRAIN';
        $('selection-name').textContent = item.name;
        $('selection-info').textContent = item.info;
        $('selection-meta').textContent = `X ${Math.round(item.x)} km · Y ${Math.round(item.y)} km   /   ALT. ${item.altitude} m`;
        $('enter-button').hidden = true;
      }
    }

    function update({ state, galaxy, terrainData, width, scaleCamera, buildingPosition }) {
      const selectedBuilding = state.selected?.kind === 'building'
        ? state.surfaceBuildings.find(building => building.id === state.selected.id) : null;
      if (selectedBuilding && !$('building-readout').hidden) {
        renderBuildingReadout(selectedBuilding);
        positionBuildingPanel(buildingPosition);
      }
      const systemsById = new Map();
      if (state.system) systemsById.set(state.system.id, state.system);
      if (selectedBuilding?.type === 'launch_platform' && !$('platform-logistics').hidden) {
        renderPlatformLogistics(selectedBuilding, { state, systemsById });
        positionBuildingPanel(buildingPosition);
      }
      if (state.selected?.kind === 'orbital-hub' && !$('orbital-hub-logistics').hidden && state.system) {
        renderOrbitalHub(state, state.system);
      }
      const level = state.level;
      document.body.dataset.level = level;
      document.body.dataset.tool = state.tool;
      // Galaxy-wide totals: population of every colony and context gathered.
      const population = root.OrbitColony.totalPopulation(state);
      const contextText = fmt(Math.floor(state.contextPoints || 0));
      $('stat-label').textContent = 'POPULATION';
      if ($('stat-value').textContent !== fmt(population)) $('stat-value').textContent = fmt(population);
      $('secondary-label').textContent = 'CONTEXTE';
      if ($('secondary-value').textContent !== contextText) $('secondary-value').textContent = contextText;
      $('view-subtitle').textContent = level === 'galaxy' ? 'RECONNAISSANCE / BRAS 01' :
        level === 'system' ? 'NAVIGATION ORBITALE' : 'CARTOGRAPHIE';
      $('view-title').textContent = level === 'galaxy' ? 'Secteur Néréide' : level === 'system' ? state.system.name : state.planet.name;
      $('system-crumb-wrap').hidden = level === 'galaxy';
      $('surface-crumb-wrap').hidden = level !== 'surface';
      $('breadcrumb-system').textContent = state.system?.name.toUpperCase() || '';
      $('breadcrumb-surface').textContent = state.planet?.name.replace(state.system?.name || '', '').trim() || '';
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
        option.disabled = unique || !Inventory.canAfford(state.inventory, price);
        // Prices are masked for now: only the unique-base notice shows.
        const costLabel = option.querySelector('.build-option-cost'), costText = unique ? 'Déjà posée' : showPrice ? resourceSummary(price) : '';
        if (costLabel && costLabel.textContent !== costText) costLabel.textContent = costText;
        if (costLabel) costLabel.hidden = !costText;
        if (definition) option.title = unique ? 'Un seul exemplaire possible.' : option.disabled
          ? `Ressources requises : ${resourceSummary(price)}` : definition.description;
      }
      $('resource-stock').textContent = root.OrbitProcessData?.config.colonyReserveInfinite ? 'RÉSERVE COLONIE ∞ · MODE V1' :
        `STOCK · ${ResourceData.catalog().filter(resource => Object.hasOwn(ResourceData.startingInventory, resource.id))
          .map(resource => `${resource.label} ${Inventory.isInfinite(resource.id) ? '∞' : fmt(state.inventory?.[resource.id] || 0)}`).join(' · ')}`;
      $('build-menu-title').textContent = 'INFRASTRUCTURES';
      $('build-menu-hint').hidden = true;
      $('back-button').disabled = level === 'galaxy';
      $('pan-button').classList.toggle('active', state.tool === 'pan' && !state.buildMenuOpen);
      $('scan-button').classList.toggle('active', state.tool === 'scan');
      $('build-button').classList.toggle('active', state.tool === 'build' || state.buildMenuOpen);
      $('road-button').classList.toggle('active', state.tool === 'road');
      const constructing = (state.surfaceBuildings || []).filter(building =>
        building.planetId === state.planet?.id && building.constructionState === 'constructing').length;
      const placementLabel = BuildingData.get(state.placement?.type)?.label || 'BÂTIMENT';
      const buildingWord = constructing > 1 ? 'INFRASTRUCTURES' : 'INFRASTRUCTURE';
      $('live-status').textContent = state.paused ? 'SIMULATION EN PAUSE' :
        state.tool === 'scan' ? 'SONDE EN ATTENTE' : level === 'galaxy' ? 'RECONNAISSANCE ACTIVE' :
          level === 'system' ? 'ÉPHÉMÉRIDES EN DIRECT' : state.tool === 'road' ? 'TRACÉ ROUTIER MANUEL' : state.tool === 'build' ?
            `${placementLabel} · POSITION ${state.placement?.valid ? 'VALIDE' : 'INVALIDE'}` : state.buildMenuOpen ? 'CHOIX DES INFRASTRUCTURES' :
              constructing ? `ASSEMBLAGE · ${constructing} ${buildingWord}` : 'TOPOGRAPHIE LOCALE';
      $('gesture-hint').textContent = state.tool === 'scan' ? 'Touchez la zone à sonder' :
        level === 'galaxy' ? 'Glisser · Toucher une étoile · Pincer pour zoomer' :
          level === 'system' ? 'Glisser · Toucher une planète · Pincer pour zoomer' : state.tool === 'road' ?
            'Glisser · Bâtiment ou route → bâtiment ou route' : state.tool === 'build' ?
            `Déplacer l’aperçu · Toucher pour poser ${placementLabel.toLowerCase()} · Échap pour annuler` : state.buildMenuOpen ?
              'Choisir une infrastructure à poser' :
              'Glisser · Inspecter le terrain · Pincer pour zoomer';
      const units = level === 'galaxy' ? ' a.l.' : level === 'system' ? ' UA' : ' km';
      const span = (width < 600 ? 50 : 96) / scaleCamera.zoom;
      $('scale-text').textContent = (level === 'system' ? (span * state.system.auPerUnit).toFixed(2) : fmt(Math.max(1, Math.round(span)))) + units;
    }

    return Object.freeze({ toast, showSelection, update, compositionText });
  }

  root.OrbitHUD = Object.freeze({ create });
})(globalThis);
