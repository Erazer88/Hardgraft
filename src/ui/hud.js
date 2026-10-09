(function (root) {
  'use strict';
  const Config = root.OrbitConfig;
  function create(document) {
    const $ = id => document.getElementById(id);
    $('game-version').textContent = `Version ${root.OrbitVersion}`;
    const TAU = Math.PI * 2;
    const fmt = n => new Intl.NumberFormat('fr-FR').format(n);
    let toastTimer;
    function toast(text) {
      $('toast').textContent = text; $('toast').classList.add('visible'); clearTimeout(toastTimer);
      $('toast').classList.toggle('above-inspector', !$('inspector').hidden);
      toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200);
    }
    function showSelection(item, { state, planetCount }) {
      const panel = $('inspector'); panel.hidden = false;
      $('toast').classList.remove('visible');
      if (state.level === 'galaxy') {
        const count = planetCount;
        $('selection-type').textContent = 'SYSTÈME STELLAIRE'; $('selection-name').textContent = item.name;
        $('selection-info').textContent = `Étoile de classe ${item.stellarClass}. ${count} mondes en orbite attendent leur premier relevé.`;
        $('selection-meta').textContent = `X ${Math.round(item.x)} · Y ${Math.round(item.y)}   /   ${state.exploration.visited.has(item.id) ? 'VISITÉ' : 'DÉTECTÉ'}`;
        $('enter-label').textContent = 'Zoomer sur le système'; $('enter-button').hidden = false; $('enter-button').disabled = false;
      } else if (state.level === 'system') {
        $('selection-type').textContent = 'CORPS PLANÉTAIRE'; $('selection-name').textContent = item.name;
        $('selection-info').textContent = item.kind === 'gazeuse' ? 'Géante gazeuse. Une atmosphère profonde, sans surface solide.' : 'Un monde ' + item.kind + '. Son relief et ses ressources peuvent être cartographiés.';
        $('selection-meta').textContent = `${(item.orbit / 220).toFixed(2)} UA   /   PÉRIODE ${Math.round(TAU / item.speed)} s`;
        $('enter-label').textContent = item.kind === 'gazeuse' ? 'Aucune surface solide' : 'Zoomer sur la surface';
        $('enter-button').hidden = false; $('enter-button').disabled = item.kind === 'gazeuse';
      } else {
        $('selection-type').textContent = 'RELEVÉ DE TERRAIN'; $('selection-name').textContent = item.name;
        $('selection-info').textContent = item.info;
        $('selection-meta').textContent = `X ${Math.round(item.x)} km · Y ${Math.round(item.y)} km   /   ALT. ${item.altitude} m`;
        $('enter-button').hidden = true;
      }
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
      $('scan-button').disabled = level !== 'galaxy'; $('back-button').disabled = level === 'galaxy';
      $('pan-button').classList.toggle('active', state.tool === 'pan'); $('scan-button').classList.toggle('active', state.tool === 'scan');
      $('live-status').textContent = state.paused ? 'ORBITE EN PAUSE' : level === 'galaxy' ? 'RECONNAISSANCE ACTIVE' : level === 'system' ? 'ÉPHÉMÉRIDES EN DIRECT' : 'TOPOGRAPHIE LOCALE';
      $('gesture-hint').textContent = state.tool === 'scan' ? 'Touchez la zone à sonder' : level === 'galaxy' ? 'Glisser · Toucher une étoile · Pincer pour zoomer' : level === 'system' ? 'Glisser · Toucher une planète · Pincer pour zoomer' : 'Glisser · Pincer · Toucher le terrain pour l’inspecter';
      const units = level === 'galaxy' ? ' a.l.' : level === 'system' ? ' UA' : ' km';
      const camera = scaleCamera;
      const span = (width < 600 ? 50 : 96) / camera.zoom;
      $('scale-text').textContent = (level === 'system' ? (span / 220).toFixed(2) : fmt(Math.max(1, Math.round(span)))) + units;
    }
    return Object.freeze({ toast, showSelection, update });
  }
  root.OrbitHUD = Object.freeze({ create });
})(globalThis);
