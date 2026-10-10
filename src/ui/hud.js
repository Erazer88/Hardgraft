(function (root) {
  'use strict';
  const Config = root.OrbitConfig;
  const Resources = root.OrbitResourceData;
  const Buildings = root.OrbitBuildingData;
  const Blocks = root.OrbitBlockData;
  const Construction = root.OrbitConstruction;
  const FactorySimulation = root.OrbitFactorySimulation;

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
    for (const id of Blocks.order) {
      const definition = Blocks.definitions[id];
      const button = document.createElement('button'); button.className = 'building-option'; button.dataset.blockType = id;
      const top = document.createElement('span'); top.className = 'building-option-top';
      const name = document.createElement('span'); name.className = 'building-option-name'; name.textContent = definition.name;
      const ports = document.createElement('span'); ports.className = 'building-option-time';
      ports.textContent = `${definition.inputPorts} → ${definition.outputPorts} port${definition.outputPorts > 1 ? 's' : ''}`;
      const description = document.createElement('span'); description.className = 'building-option-description';
      description.textContent = definition.recipeId ? `Recette : ${root.OrbitRecipeData.recipes[definition.recipeId].name}. Capacité ${definition.capacity}.` : `Capacité ${definition.capacity}. Placement sans coût.`;
      top.append(name, ports); button.append(top, description); $('block-options').append(button);
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
      $('toast').classList.remove('visible'); $('demolish-button').hidden = true; $('delete-block-button').hidden = true;
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
      } else if (item.entityType === 'block') {
        const definition = Blocks.definitions[item.type], stock = Object.entries(item.stock || {}).filter(([, amount]) => amount > 0)
          .map(([id, amount]) => `${Resources.definitions[id]?.short || id} ${fmt(amount)}`).join(' · ') || 'Stock vide';
        $('selection-type').textContent = 'BLOC INDUSTRIEL'; $('selection-name').textContent = definition?.name || 'Bloc';
        $('selection-info').textContent = definition?.recipeId ? `Recette active : ${root.OrbitRecipeData.recipes[definition.recipeId].name}. Le stock interne reste bloqué si la sortie est saturée.` : `Stock interne limité à ${item.capacity}. Les transferts vers le bloc suivant sont instantanés si sa capacité le permet.`;
        $('selection-meta').textContent = `${stock}   /   ${String(item.status || 'waiting').toUpperCase()} · ${Math.round(item.x)}, ${Math.round(item.y)}`;
        $('enter-button').hidden = true; $('delete-block-button').hidden = false;
      } else if (item.entityType === 'building') {
        const definition = Buildings.definitions[item.type];
        $('selection-type').textContent = item.status === 'complete' ? 'INSTALLATION' : 'CHANTIER';
        $('selection-name').textContent = definition?.name || 'Installation';
        $('selection-info').textContent = definition?.description || 'Installation de la colonie.';
        $('selection-meta').textContent = buildingMeta(state, item);
        $('enter-button').hidden = item.type !== 'factory'; $('enter-button').disabled = item.status !== 'complete';
        if (item.type === 'factory') $('enter-label').textContent = item.status === 'complete' ? 'Zoomer dans l’usine' : 'Usine en construction';
        $('demolish-button').hidden = false;
      } else {
        $('selection-type').textContent = 'RELEVÉ DE TERRAIN'; $('selection-name').textContent = item.name;
        $('selection-info').textContent = item.info;
        $('selection-meta').textContent = `X ${Math.round(item.x)} km · Y ${Math.round(item.y)} km   /   ALT. ${item.altitude} m`;
        $('enter-button').hidden = true;
      }
    }
    function updateInventory(state) {
      const stock = state.planet ? Construction.inventory(state.simulation, state.planet.id) : null;
      for (const id of Resources.order) resourceNodes.get(id).textContent = state.simulation.infiniteMaterials ? '∞' : fmt(stock?.[id] || 0);
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
    function updateSelection(state) {
      if ($('inspector').hidden) return;
      if (state.selected?.entityType === 'building') {
        const building = state.simulation.buildings[state.selected.id];
        if (!building) { $('inspector').hidden = true; state.selected = null; return; }
        $('selection-type').textContent = building.status === 'complete' ? 'INSTALLATION' : 'CHANTIER';
        $('selection-meta').textContent = buildingMeta(state, building);
        if (building.type === 'factory') $('enter-button').disabled = building.status !== 'complete';
      } else if (state.selected?.entityType === 'block') {
        const factory = state.factoryView?.factory || FactorySimulation.get(state.simulation, state.focusFactory);
        const block = factory?.blocks?.[state.selected.id];
        if (!block) { $('inspector').hidden = true; state.selected = null; return; }
        const stock = Object.entries(block.stock || {}).filter(([, amount]) => amount > 0)
          .map(([id, amount]) => `${Resources.definitions[id]?.short || id} ${fmt(amount)}`).join(' · ') || 'Stock vide';
        $('selection-meta').textContent = `${stock}   /   ${String(block.status || 'waiting').toUpperCase()} · ${Math.round(block.x)}, ${Math.round(block.y)}`;
      }
    }
    function update({ state, galaxy, terrainData, width, scaleCamera, factoryView }) {
      const known = galaxy.systems.filter(s => s.discovered || state.reveal).length;
      const level = state.level;
      document.body.dataset.level = level;
      $('stat-label').textContent = level === 'galaxy' ? 'SYSTÈMES' : level === 'system' ? 'PLANÈTES' : level === 'factory' ? 'USINE' : 'SURFACE';
      $('stat-value').textContent = level === 'galaxy' ? `${fmt(known)} / ${fmt(galaxy.systems.length)}` : level === 'system' ? String(state.system.planets.length).padStart(2, '0') : level === 'factory' ? `RANG ${factoryView?.factory.rank || 1}` : `${terrainData.width * Config.terrain.textureScale} × ${terrainData.height * Config.terrain.textureScale} km`;
      $('secondary-label').textContent = level === 'galaxy' ? 'SECTEUR CONNU' : level === 'system' ? 'ÉTOILE' : level === 'factory' ? 'DEMANDE ÉNERGIE' : 'TYPE';
      $('secondary-value').textContent = level === 'galaxy' ? (known / galaxy.systems.length * 100).toFixed(1) + ' %' : level === 'system' ? 'CLASSE ' + state.system.star.type : level === 'factory' ? `${(factoryView?.factory.energyDemand || 0).toFixed(1)} MW` : state.planet.kind.toUpperCase();
      $('view-subtitle').textContent = level === 'galaxy' ? 'RECONNAISSANCE / BRAS 01' : level === 'system' ? 'NAVIGATION ORBITALE' : level === 'factory' ? 'ESPACE INDUSTRIEL / MATIÈRE' : 'RELEVÉ TOPOGRAPHIQUE';
      $('view-title').textContent = level === 'galaxy' ? 'Secteur Néréide' : level === 'system' ? state.system.name : level === 'factory' ? `${state.planet.name} · Usine` : state.planet.name;
      $('system-crumb-wrap').hidden = level === 'galaxy'; $('surface-crumb-wrap').hidden = level !== 'surface' && level !== 'factory';
      $('breadcrumb-system').textContent = state.system?.name.toUpperCase() || '';
      $('breadcrumb-surface').textContent = level === 'factory' ? 'USINE' : state.planet?.name.replace(state.system?.name || '', '').trim() || '';
      $('scan-button').hidden = level !== 'galaxy'; $('build-button').hidden = level !== 'surface';
      $('scan-button').disabled = level !== 'galaxy'; $('back-button').disabled = level === 'galaxy';
      $('pan-button').classList.toggle('active', state.tool === 'pan'); $('scan-button').classList.toggle('active', state.tool === 'scan');
      $('build-button').classList.toggle('active', state.tool === 'build');
      $('connect-factory-button').classList.toggle('active', state.tool === 'factory-connect');
      $('resource-panel').hidden = level !== 'surface'; $('factory-console').hidden = level !== 'factory';
      if (level === 'surface') { updateInventory(state); updateBuildingOptions(state); }
      if (level === 'factory' && factoryView) {
        $('factory-console-title').textContent = `USINE · RANG ${factoryView.factory.rank}`;
        $('factory-energy').textContent = `DEMANDE ${(factoryView.factory.energyDemand || 0).toFixed(1)} MW`;
        const products = Object.entries(factoryView.factory.production || {}).filter(([, count]) => count > 0)
          .map(([id, count]) => `${Resources.definitions[id]?.short || id} ${fmt(count)}`).join(' · ');
        const blocked = factoryView.factory.order.filter(id => ['blocked', 'starved'].includes(factoryView.factory.blocks[id]?.status)).length;
        $('factory-console-status').textContent = products ? `Flux produits : ${products}${blocked ? `   /   ${blocked} bloc${blocked > 1 ? 's' : ''} en attente` : ''}` : 'Chaîne de départ : minerai → transformation → stockage → sortie';
      }
      updateSelection({ ...state, factoryView });
      $('live-status').textContent = state.paused ? 'SIMULATION EN PAUSE' : state.tool === 'build' ? 'IMPLANTATION AU SOL' : state.tool === 'factory-add' ? 'AJOUT DE BLOC' : state.tool === 'factory-connect' ? 'CONNEXION DE BLOCS' : level === 'galaxy' ? 'RECONNAISSANCE ACTIVE' : level === 'system' ? 'ÉPHÉMÉRIDES EN DIRECT' : level === 'factory' ? 'PRODUCTION ACTIVE' : 'TOPOGRAPHIE LOCALE';
      $('gesture-hint').textContent = state.tool === 'scan' ? 'Touchez la zone à sonder' : state.tool === 'build' ? 'Touchez une terre ferme · Échap pour annuler' : state.tool === 'factory-add' ? 'Touchez une zone vide pour poser le bloc' : state.tool === 'factory-connect' ? (state.connectionSource ? 'Touchez le bloc de destination' : 'Touchez le bloc source') : level === 'galaxy' ? 'Glisser · Toucher une étoile · Pincer pour zoomer' : level === 'system' ? 'Glisser · Toucher une planète · Pincer pour zoomer' : level === 'factory' ? 'Glisser un bloc · Relier les ports · Pincer pour zoomer' : 'Glisser · Inspecter · Construire · Pincer pour zoomer';
      const units = level === 'galaxy' ? ' a.l.' : level === 'system' ? ' UA' : level === 'factory' ? ' unités' : ' km';
      const camera = scaleCamera;
      const span = (width < 600 ? 50 : 96) / camera.zoom;
      $('scale-text').textContent = (level === 'system' ? (span * state.system.auPerUnit).toFixed(2) : fmt(Math.max(1, Math.round(span)))) + units;
    }
    return Object.freeze({ toast, showSelection, update });
  }
  root.OrbitHUD = Object.freeze({ create });
})(globalThis);
