(function (root) {
  'use strict';
  const Config = root.OrbitConfig;
  const Resources = root.OrbitResourceData;
  const Buildings = root.OrbitBuildingData;
  const Construction = root.OrbitConstruction;

  function create(document) {
    const $ = id => document.getElementById(id);
    $('game-version').textContent = `Version ${root.OrbitVersion}`;
    const TAU = Math.PI * 2;
    const fmt = n => new Intl.NumberFormat('fr-FR').format(n);
    const resourceNodes = new Map(), buildingNodes = new Map();
    let toastTimer;

    for (const id of Resources.order) {
      const definition = Resources.definitions[id];
      const row = document.createElement('div'); row.className = 'resource-item';
      row.style.setProperty('--resource-color', definition.color); row.title = definition.name;
      const code = document.createElement('span'); code.className = 'resource-code'; code.textContent = definition.short;
      const amount = document.createElement('span'); amount.className = 'resource-amount'; amount.textContent = '0';
      row.append(code, amount); $('resource-list').append(row); resourceNodes.set(id, amount);
    }
    for (const id of Buildings.order) {
      const definition = Buildings.definitions[id];
      const button = document.createElement('button'); button.className = 'building-option'; button.dataset.buildingType = id;
      const top = document.createElement('span'); top.className = 'building-option-top';
      const name = document.createElement('span'); name.className = 'building-option-name'; name.textContent = definition.name;
      const time = document.createElement('span'); time.className = 'building-option-time'; time.textContent = `${definition.duration.toFixed(1).replace('.0', '')} s`;
      const description = document.createElement('span'); description.className = 'building-option-description'; description.textContent = definition.description;
      const cost = document.createElement('span'); cost.className = 'building-option-cost';
      const costNodes = new Map();
      for (const [resourceId, amount] of Object.entries(definition.cost)) {
        const value = document.createElement('span'); value.textContent = `${Resources.definitions[resourceId]?.short || resourceId} ${amount}`;
        cost.append(value); costNodes.set(resourceId, value);
      }
      top.append(name, time); button.append(top, description, cost); $('building-options').append(button);
      buildingNodes.set(id, { button, costNodes });
    }

    function toast(text) {
      $('toast').textContent = text; $('toast').classList.add('visible'); clearTimeout(toastTimer);
      $('toast').classList.toggle('above-inspector', !$('inspector').hidden);
      toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200);
    }
    function buildingMeta(state, building) {
      const percent = Math.round(Construction.progress(state.simulation, building) * 100);
      const status = building.status === 'complete' ? 'OPÉRATIONNEL' : `CHANTIER ${percent} %`;
      return `X ${Math.round(building.x)} km · Y ${Math.round(building.y)} km   /   ${status}`;
    }
    function showSelection(item, { state, systemModel }) {
      const panel = $('inspector'); panel.hidden = false;
      $('toast').classList.remove('visible'); $('demolish-button').hidden = true;
      if (state.level === 'galaxy') {
        const count = systemModel.planets.length, belts = systemModel.debris.length;
        $('selection-type').textContent = 'SYSTÈME STELLAIRE'; $('selection-name').textContent = item.name;
        $('selection-info').textContent = `Étoile de classe ${item.stellarClass}. ${count ? `${count} planète${count > 1 ? 's' : ''} détectée${count > 1 ? 's' : ''}.` : 'Aucune planète détectée.'} ${belts ? `${belts} ceinture${belts > 1 ? 's' : ''} de débris.` : 'Aucune ceinture de débris.'}`;
        $('selection-meta').textContent = `X ${Math.round(item.x)} · Y ${Math.round(item.y)}   /   ${state.exploration.visited.has(item.id) ? 'VISITÉ' : 'DÉTECTÉ'}`;
        $('enter-label').textContent = 'Zoomer sur le système'; $('enter-button').hidden = false; $('enter-button').disabled = false;
      } else if (state.level === 'system') {
        $('selection-type').textContent = 'CORPS PLANÉTAIRE'; $('selection-name').textContent = item.name;
        $('selection-info').textContent = item.kind === 'gazeuse' ? 'Géante gazeuse. Une atmosphère profonde, sans surface solide.' :
          `Monde ${item.kind}. Température estimée : ${Math.round(item.temperature)} °C. Atmosphère ${item.atmosphere}${item.startingCandidate ? '. Candidat à l’installation.' : '.'}`;
        $('selection-meta').textContent = `${item.distanceAU.toFixed(2)} UA   /   PÉRIODE ${Math.round(TAU / item.speed)} s`;
        $('enter-label').textContent = item.kind === 'gazeuse' ? 'Aucune surface solide' : 'Zoomer sur la surface';
        $('enter-button').hidden = false; $('enter-button').disabled = item.kind === 'gazeuse';
      } else if (item.entityType === 'building') {
        const definition = Buildings.definitions[item.type];
        $('selection-type').textContent = item.status === 'complete' ? 'INSTALLATION' : 'CHANTIER';
        $('selection-name').textContent = definition?.name || 'Installation';
        $('selection-info').textContent = definition?.description || 'Installation de la colonie.';
        $('selection-meta').textContent = buildingMeta(state, item);
        $('enter-button').hidden = true; $('demolish-button').hidden = false;
      } else {
        $('selection-type').textContent = 'RELEVÉ DE TERRAIN'; $('selection-name').textContent = item.name;
        $('selection-info').textContent = item.info;
        $('selection-meta').textContent = `X ${Math.round(item.x)} km · Y ${Math.round(item.y)} km   /   ALT. ${item.altitude} m`;
        $('enter-button').hidden = true;
      }
    }
    function updateInventory(state) {
      const stock = state.planet ? Construction.inventory(state.simulation, state.planet.id) : null;
      for (const id of Resources.order) resourceNodes.get(id).textContent = fmt(stock?.[id] || 0);
    }
    function updateBuildingOptions(state) {
      if (!state.planet) return;
      const stock = Construction.inventory(state.simulation, state.planet.id);
      for (const id of Buildings.order) {
        const definition = Buildings.definitions[id], nodes = buildingNodes.get(id);
        const affordability = Construction.canAfford(state.simulation, state.planet.id, id);
        nodes.button.disabled = !affordability.ok;
        nodes.button.title = affordability.ok ? `Construire ${definition.name}` : 'Matériaux insuffisants';
        for (const [resourceId, node] of nodes.costNodes) node.classList.toggle('missing', (stock?.[resourceId] || 0) < definition.cost[resourceId]);
      }
    }
    function updateBuildingSelection(state) {
      if ($('inspector').hidden || state.selected?.entityType !== 'building') return;
      const building = state.simulation.buildings[state.selected.id];
      if (!building) { $('inspector').hidden = true; state.selected = null; return; }
      $('selection-type').textContent = building.status === 'complete' ? 'INSTALLATION' : 'CHANTIER';
      $('selection-meta').textContent = buildingMeta(state, building);
    }
    function update({ state, galaxy, terrainData, width, scaleCamera }) {
      const known = galaxy.systems.filter(s => s.discovered || state.reveal).length;
      const level = state.level;
      document.body.dataset.level = level;
      $('stat-label').textContent = level === 'galaxy' ? 'SYSTÈMES' : level === 'system' ? 'PLANÈTES' : 'SURFACE';
      $('stat-value').textContent = level === 'galaxy' ? `${fmt(known)} / ${fmt(galaxy.systems.length)}` : level === 'system' ? String(state.system.planets.length).padStart(2, '0') : `${terrainData.width * Config.terrain.textureScale} × ${terrainData.height * Config.terrain.textureScale} km`;
      $('secondary-label').textContent = level === 'galaxy' ? 'SECTEUR CONNU' : level === 'system' ? 'ÉTOILE' : 'TYPE';
      $('secondary-value').textContent = level === 'galaxy' ? (known / galaxy.systems.length * 100).toFixed(1) + ' %' : level === 'system' ? 'CLASSE ' + state.system.star.type : state.planet.kind.toUpperCase();
      $('view-subtitle').textContent = level === 'galaxy' ? 'RECONNAISSANCE / BRAS 01' : level === 'system' ? 'NAVIGATION ORBITALE' : 'RELEVÉ TOPOGRAPHIQUE';
      $('view-title').textContent = level === 'galaxy' ? 'Secteur Néréide' : level === 'system' ? state.system.name : state.planet.name;
      $('system-crumb-wrap').hidden = level === 'galaxy'; $('surface-crumb-wrap').hidden = level !== 'surface';
      $('breadcrumb-system').textContent = state.system?.name.toUpperCase() || '';
      $('breadcrumb-surface').textContent = state.planet?.name.replace(state.system?.name || '', '').trim() || '';
      $('scan-button').hidden = level === 'surface'; $('build-button').hidden = level !== 'surface';
      $('scan-button').disabled = level !== 'galaxy'; $('back-button').disabled = level === 'galaxy';
      $('pan-button').classList.toggle('active', state.tool === 'pan'); $('scan-button').classList.toggle('active', state.tool === 'scan');
      $('build-button').classList.toggle('active', state.tool === 'build');
      $('resource-panel').hidden = level !== 'surface';
      if (level === 'surface') { updateInventory(state); updateBuildingOptions(state); }
      updateBuildingSelection(state);
      $('live-status').textContent = state.paused ? 'ORBITE EN PAUSE' : state.tool === 'build' ? 'IMPLANTATION AU SOL' : level === 'galaxy' ? 'RECONNAISSANCE ACTIVE' : level === 'system' ? 'ÉPHÉMÉRIDES EN DIRECT' : 'TOPOGRAPHIE LOCALE';
      $('gesture-hint').textContent = state.tool === 'scan' ? 'Touchez la zone à sonder' : state.tool === 'build' ? 'Touchez une terre ferme · Échap pour annuler' : level === 'galaxy' ? 'Glisser · Toucher une étoile · Pincer pour zoomer' : level === 'system' ? 'Glisser · Toucher une planète · Pincer pour zoomer' : 'Glisser · Inspecter · Construire · Pincer pour zoomer';
      const units = level === 'galaxy' ? ' a.l.' : level === 'system' ? ' UA' : ' km';
      const camera = scaleCamera;
      const span = (width < 600 ? 50 : 96) / camera.zoom;
      $('scale-text').textContent = (level === 'system' ? (span * state.system.auPerUnit).toFixed(2) : fmt(Math.max(1, Math.round(span)))) + units;
    }
    return Object.freeze({ toast, showSelection, update });
  }
  root.OrbitHUD = Object.freeze({ create });
})(globalThis);
