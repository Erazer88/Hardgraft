(function (root) {
  'use strict';
  const Config = root.OrbitConfig;
  const BuildingData = root.OrbitBuildingData;
  const ResourceData = root.OrbitResourceData;
  const Inventory = root.OrbitInventory;

  function create(document) {
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
      cost.textContent = resourceSummary(definition.cost);
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

    function resourceSummary(amounts) {
      return Object.entries(amounts || {}).map(([id, amount]) => `${resourceName(id)} ${fmt(amount)}`).join(' · ') || 'Aucun coût';
    }

    function inventoryEntries(building) {
      return Object.entries(building.inventory || {})
        .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, amount]) => ({ name: resourceName(id), amount }));
    }

    function buildingStats(building) {
      const flow = Number.isFinite(building.flowPerMinute) ? building.flowPerMinute : 0;
      const inventory = inventoryEntries(building), total = inventory.reduce((sum, item) => sum + item.amount, 0);
      const stockText = inventory.length
        ? inventory.map(item => `${item.name} · ${fmtDecimal(item.amount)}`).join('  /  ')
        : 'Aucune ressource en stock';
      const byType = {
        factory: [
          ['DÉBIT EN SORTIE', `${fmtDecimal(flow)} / min`],
          ['RESSOURCES TRAITÉES', mineralLabels.join(' · ')]
        ],
        extractor: [
          ['VITESSE DE MINAGE', `${fmtDecimal(flow)} / min`],
          ['RESSOURCE', building.resourceId ? resourceName(building.resourceId) : 'Gisement compatible']
        ],
        oil_platform: [
          ['VITESSE D’EXTRACTION', `${fmtDecimal(flow)} / min`],
          ['RESSOURCE', 'Hydrocarbures']
        ],
        wind_turbine: [['PRODUCTION ÉLECTRIQUE', formatPower(building.energyOutputWatts)]],
        hub: [
          ['ARRIVÉES', 'Personnel orbital'],
          ['DÉBIT D’EXPORT', `${fmtDecimal(flow)} / min`],
          ['MARCHANDISES', inventory.length ? stockText : 'En attente de matériaux']
        ],
        storage: [
          ['RESSOURCES', stockText],
          ['QUANTITÉ TOTALE', fmtDecimal(total)]
        ],
        surface_port: [['FONCTION', 'Relais entre navires et transport terrestre']]
      };
      const rows = byType[building.type] || [];
      if (building.constructionState === 'constructing') {
        rows.unshift(['ASSEMBLAGE', `${Math.round((building.constructionProgress || 0) * 100)} %`]);
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

    function showSelection(item, { state, systemModel }) {
      const panel = $('inspector');
      panel.hidden = false;
      $('toast').classList.remove('visible');
      const isBuilding = item.kind === 'building';
      panel.classList.toggle('building-panel', isBuilding);
      $('building-readout').hidden = !isBuilding;
      $('demolish-button').hidden = !isBuilding;
      $('selection-info').hidden = isBuilding;
      $('selection-meta').hidden = isBuilding;
      if (state.level === 'galaxy') {
        const planets = systemModel.planets.length, belts = systemModel.debris.length;
        $('selection-type').textContent = 'SYSTÈME STELLAIRE';
        $('selection-name').textContent = item.name;
        $('selection-info').textContent = `Étoile de classe ${item.stellarClass}. ${planets ? `${planets} planète${planets > 1 ? 's' : ''} détectée${planets > 1 ? 's' : ''}.` : 'Aucune planète détectée.'} ${belts ? `${belts} ceinture${belts > 1 ? 's' : ''} de débris.` : 'Aucune ceinture de débris.'}`;
        $('selection-meta').textContent = `X ${Math.round(item.x)} · Y ${Math.round(item.y)}   /   ${state.exploration.visited.has(item.id) ? 'VISITÉ' : 'DÉTECTÉ'}`;
        $('enter-label').textContent = 'Zoomer sur le système';
        $('enter-button').hidden = false;
        $('enter-button').disabled = false;
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
        renderBuildingReadout(item);
        $('enter-button').hidden = true;
        const refundRate = Number.isFinite(item.demolitionRefundRate) ? item.demolitionRefundRate : 1;
        $('demolish-button').textContent = `DÉMOLIR · RÉCUPÉRER ${Math.round(refundRate * 100)} %`;
      } else {
        $('selection-type').textContent = 'RELEVÉ DE TERRAIN';
        $('selection-name').textContent = item.name;
        $('selection-info').textContent = item.info;
        $('selection-meta').textContent = `X ${Math.round(item.x)} km · Y ${Math.round(item.y)} km   /   ALT. ${item.altitude} m`;
        $('enter-button').hidden = true;
      }
    }

    function update({ state, galaxy, terrainData, width, scaleCamera }) {
      const selectedBuilding = state.selected?.kind === 'building'
        ? state.surfaceBuildings.find(building => building.id === state.selected.id) : null;
      if (selectedBuilding && !$('building-readout').hidden) renderBuildingReadout(selectedBuilding);
      const known = galaxy.systems.filter(system => system.discovered || state.reveal).length;
      const level = state.level;
      document.body.dataset.level = level;
      document.body.dataset.tool = state.tool;
      $('stat-label').textContent = level === 'galaxy' ? 'SYSTÈMES' : level === 'system' ? 'PLANÈTES' : 'SURFACE';
      $('stat-value').textContent = level === 'galaxy' ? `${fmt(known)} / ${fmt(galaxy.systems.length)}` :
        level === 'system' ? String(state.system.planets.length).padStart(2, '0') :
          `${terrainData.width * Config.terrain.textureScale} × ${terrainData.height * Config.terrain.textureScale} km`;
      $('secondary-label').textContent = level === 'galaxy' ? 'SECTEUR CONNU' : level === 'system' ? 'ÉTOILE' : 'TYPE';
      $('secondary-value').textContent = level === 'galaxy' ? (known / galaxy.systems.length * 100).toFixed(1) + ' %' :
        level === 'system' ? 'CLASSE ' + state.system.star.type : state.planet.kind.toUpperCase();
      $('view-subtitle').textContent = level === 'galaxy' ? 'RECONNAISSANCE / BRAS 01' :
        level === 'system' ? 'NAVIGATION ORBITALE' : 'RELEVÉ TOPOGRAPHIQUE';
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
      const hasOrbitalHub = level === 'surface' && state.planet && (state.surfaceBuildings || []).some(building =>
        building.planetId === state.planet.id && building.type === 'hub');
      const orbitalHubRequired = level === 'surface' && state.planet && !hasOrbitalHub;
      for (const option of buildOptions.children) {
        const definition = BuildingData.get(option.dataset.buildingType);
        const isHub = definition?.id === 'hub';
        option.hidden = orbitalHubRequired ? !isHub : isHub;
        option.disabled = !Inventory.canAfford(state.inventory, definition?.cost || {});
        if (definition) option.title = option.disabled
          ? `Ressources requises : ${resourceSummary(definition.cost)}` : definition.description;
      }
      $('resource-stock').textContent = `STOCK · ${ResourceData.catalog()
        .map(resource => `${resource.label} ${Inventory.isInfinite(resource.id) ? '∞' : fmt(state.inventory?.[resource.id] || 0)}`).join(' · ')}`;
      $('build-menu-title').textContent = orbitalHubRequired ? 'HUB ORBITAL REQUIS' : 'INFRASTRUCTURES';
      $('build-menu-hint').hidden = !orbitalHubRequired;
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
              'Glisser · Inspecter le relief · Pincer pour zoomer';
      const units = level === 'galaxy' ? ' a.l.' : level === 'system' ? ' UA' : ' km';
      const span = (width < 600 ? 50 : 96) / scaleCamera.zoom;
      $('scale-text').textContent = (level === 'system' ? (span * state.system.auPerUnit).toFixed(2) : fmt(Math.max(1, Math.round(span)))) + units;
    }

    return Object.freeze({ toast, showSelection, update });
  }

  root.OrbitHUD = Object.freeze({ create });
})(globalThis);
