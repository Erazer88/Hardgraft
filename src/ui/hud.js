(function (root) {
  'use strict';
  const Config = root.OrbitConfig;
  const BuildingData = root.OrbitBuildingData;

  function create(document) {
    const $ = id => document.getElementById(id);
    $('game-version').textContent = `Version ${root.OrbitVersion}`;
    const TAU = Math.PI * 2;
    const fmt = value => new Intl.NumberFormat('fr-FR').format(value);
    let toastTimer;

    const buildOptions = $('build-options');
    for (const definition of BuildingData.catalog()) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'build-option'; button.dataset.buildingType = definition.id;
      const icon = document.createElement('span'); icon.className = 'build-option-icon'; icon.textContent = definition.shortLabel;
      const copy = document.createElement('span'); copy.className = 'build-option-copy';
      const title = document.createElement('strong'); title.textContent = definition.label;
      const description = document.createElement('small'); description.textContent = definition.description;
      copy.append(title, description); button.append(icon, copy); buildOptions.append(button);
    }

    function toast(text) {
      $('toast').textContent = text;
      $('toast').classList.add('visible');
      $('toast').classList.toggle('above-inspector', !$('inspector').hidden);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200);
    }

    function showSelection(item, { state, systemModel }) {
      const panel = $('inspector');
      panel.hidden = false;
      $('toast').classList.remove('visible');
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
        const progress = Math.round((item.constructionProgress || 0) * 100);
        $('selection-type').textContent = definition?.label || 'INFRASTRUCTURE';
        $('selection-name').textContent = item.customName || definition?.label || 'BÂTIMENT';
        $('selection-info').textContent = item.constructionState === 'complete' ?
          definition?.description || 'Structure assemblée.' : `Assemblage de la structure en cours : ${progress} %.`;
        const count = state.surfaceBuildings.filter(building => building.planetId === state.planet?.id).length;
        $('selection-meta').textContent = `RANG I   /   ${count} INFRASTRUCTURE${count > 1 ? 'S' : ''} SUR CE MONDE`;
        $('enter-button').hidden = true;
      } else {
        $('selection-type').textContent = 'RELEVÉ DE TERRAIN';
        $('selection-name').textContent = item.name;
        $('selection-info').textContent = item.info;
        $('selection-meta').textContent = `X ${Math.round(item.x)} km · Y ${Math.round(item.y)} km   /   ALT. ${item.altitude} m`;
        $('enter-button').hidden = true;
      }
    }

    function update({ state, galaxy, terrainData, width, scaleCamera }) {
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
      $('build-button').setAttribute('aria-expanded', String(state.buildMenuOpen));
      $('build-button').setAttribute('aria-label', state.tool === 'build' ? 'Annuler la pose' : 'Ouvrir le catalogue des bâtiments');
      $('build-menu').hidden = level !== 'surface' || !state.buildMenuOpen;
      $('back-button').disabled = level === 'galaxy';
      $('pan-button').classList.toggle('active', state.tool === 'pan' && !state.buildMenuOpen);
      $('scan-button').classList.toggle('active', state.tool === 'scan');
      $('build-button').classList.toggle('active', state.tool === 'build' || state.buildMenuOpen);
      const constructing = (state.surfaceBuildings || []).filter(building =>
        building.planetId === state.planet?.id && building.constructionState === 'constructing').length;
      const placementLabel = BuildingData.get(state.placement?.type)?.label || 'BÂTIMENT';
      const buildingWord = constructing > 1 ? 'INFRASTRUCTURES' : 'INFRASTRUCTURE';
      $('live-status').textContent = state.paused ? 'SIMULATION EN PAUSE' :
        state.tool === 'scan' ? 'SONDE EN ATTENTE' : level === 'galaxy' ? 'RECONNAISSANCE ACTIVE' :
          level === 'system' ? 'ÉPHÉMÉRIDES EN DIRECT' : state.tool === 'build' ?
            `${placementLabel} · POSITION ${state.placement?.valid ? 'VALIDE' : 'INVALIDE'}` : state.buildMenuOpen ? 'CHOIX DES INFRASTRUCTURES' :
              constructing ? `ASSEMBLAGE · ${constructing} ${buildingWord}` : 'TOPOGRAPHIE LOCALE';
      $('gesture-hint').textContent = state.tool === 'scan' ? 'Touchez la zone à sonder' :
        level === 'galaxy' ? 'Glisser · Toucher une étoile · Pincer pour zoomer' :
          level === 'system' ? 'Glisser · Toucher une planète · Pincer pour zoomer' : state.tool === 'build' ?
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
