(function () {
  'use strict';
  const World = globalThis.OrbitWorld, Config = globalThis.OrbitConfig;
  const Camera = globalThis.OrbitCamera, Simulation = globalThis.OrbitSimulation;
  const Exploration = globalThis.OrbitExploration, Save = globalThis.OrbitSave;
  const $ = id => document.getElementById(id);
  const canvas = $('universe');
  const renderer = globalThis.OrbitRenderer.create(canvas);
  const hud = globalThis.OrbitHUD.create(document);
  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const state = globalThis.OrbitState.create();
  let galaxy, home, terrainTexture, terrainData;
  let W = innerWidth, H = innerHeight, DPR = Math.min(devicePixelRatio || 1, 2), lastTime = 0;
  let lastHUD = 0, pointerMoved = false, menuStarted = false, pinch = null;
  const viewport = { width: W, height: H };
  const pointers = new Map();
  const contexts = new Map();
  const pointersLast = new Map();

  function stored() { try { return Save.load(localStorage); } catch (_) { return null; } }
  function persist() { try { Save.save(localStorage, state, galaxy); } catch (_) { /* Storage is optional. */ } }
  const normalizedSeed = globalThis.OrbitState.normalizedSeed;
  function project(x, y, cam = state.camera) { return Camera.project({ x, y }, cam, viewport); }
  function unproject(x, y, cam = state.camera) { return Camera.unproject({ x, y }, cam, viewport); }
  const toast = hud.toast;
  // One camera, one galactic coordinate space, at every level of detail.
  function zoomLimits(anchor = state.camera) {
    let max = Config.camera.maxZoom;
    if (state.context) {
      const planet = (state.level === 'surface' && state.tracking?.planet) || state.context.model.planets.find(p =>
        p.kind !== 'gazeuse' && distance(planetWorldPosition(p), anchor) <= p.radius * state.context.frame.scale * 1.4);
      // Stop at useful terrain detail rather than magnifying the raster into an
      // empty flat colour. This cap follows the planet's embedded map scale.
      if (planet) max = Math.min(max, Config.terrain.maxLocalZoom * Config.terrain.height * Config.terrain.textureScale / 2 / (planet.radius * state.context.frame.scale));
    }
    return [Config.camera.minZoom, max];
  }
  function focusCamera(x, y, zoom, immediate = false) {
    const [min, max] = zoomLimits({ x, y });
    state.target = { x, y, zoom: clamp(zoom, min, max) };
    if (immediate) state.camera = { ...state.target };
  }
  function fitZoom(span) { return Math.min(W - 60, H - 215) / span; }
  function localCamera(frame, camera = state.camera) { return Camera.toLocal(frame, camera); }
  function worldCamera(frame, camera) { return Camera.toWorld(frame, camera); }
  function prepareSystem(star) {
    if (contexts.has(star.id)) return contexts.get(star.id);
    const model = World.createSystem(state.seed, star.id, galaxy);
    const neighborDistance = Math.min(...galaxy.systems.filter(s => s.id !== star.id).map(s => distance(s, star)));
    const scale = Math.max(.001, Math.min(.012, neighborDistance * .32 / model.extent));
    const context = { star, model, frame: { x: star.x, y: star.y, scale }, terrains: new Map() };
    contexts.set(star.id, context); return context;
  }
  function planetWorldPosition(planet, context = state.context) {
    return Camera.worldPoint(context.frame, World.planetPosition(planet, state.simulation.time));
  }
  function prepareTerrain(planet, context = state.context) {
    if (!context.terrains.has(planet.id)) {
      terrainData = World.createTerrain(planet.seed, Config.terrain.width, Config.terrain.height, planet);
      state.terrain = terrainData;
      terrainTexture = renderer.createTerrainTexture(planet, terrainData);
      context.terrains.set(planet.id, { data: terrainData, texture: terrainTexture });
    }
    return context.terrains.get(planet.id);
  }
  function surfaceFrame(planet = state.planet, context = state.context) {
    const record = prepareTerrain(planet, context);
    return Camera.surfaceFrame(planetWorldPosition(planet, context), planet.radius * context.frame.scale, record.texture);
  }
  function cameraMoving() { return Camera.moving(state.camera, state.target); }
  function followPlanet(planet, context = state.context) {
    if (state.tracking?.planet.id === planet.id && state.tracking.context === context) return;
    state.tracking = { planet, context, position: planetWorldPosition(planet, context) };
  }
  function systemViewZoom(model) {
    return Math.min(W - 60, Math.max(80, H - 300)) / (model.extent * 2.35);
  }
  function systemCamera() {
    const zoom = systemViewZoom(state.context.model);
    return worldCamera(state.context.frame, { x: 0, y: -30 / zoom, zoom });
  }
  function homeCamera() {
    if (state.level === 'galaxy') return { x: home.x - 200, y: home.y - 160, zoom: Math.max(.09, fitZoom(1900)) };
    if (state.level === 'system') return systemCamera();
    return worldCamera(surfaceFrame(), { x: terrainData.width * Config.terrain.textureScale / 2, y: terrainData.height * Config.terrain.textureScale / 2,
      zoom: Math.max(W / (terrainData.width * Config.terrain.textureScale), H / (terrainData.height * Config.terrain.textureScale)) * 1.08 });
  }
  function resetCamera(immediate = false) { const cam = homeCamera(); focusCamera(cam.x, cam.y, cam.zoom, immediate); }


  function regenerate(seed, restoring = null) {
    state.seed = normalizedSeed(seed); galaxy = World.createGalaxy(state.seed);
    home = galaxy.systems.find(s => s.id === galaxy.homeId);
    state.simulation = Simulation.create(); state.exploration = Exploration.create(home);
    Save.restore(state, galaxy, restoring);
    state.level = 'galaxy'; state.system = null; state.planet = null; state.selected = null;
    state.context = null; state.tracking = null; state.focusPlanet = null; state.tool = 'pan';
    state.terrain = null; terrainData = null; terrainTexture = null;
    contexts.clear(); renderer.prepareGalaxy(galaxy, state.seed);
    focusCamera(home.x * .25, home.y * .3, Math.max(.045, fitZoom(6600)), true);
    $('seed-input').value = state.seed;
    $('inspector').hidden = true; updateUI(); persist();
  }

  function updateSceneContext() {
    if (!galaxy) return;
    const previousLevel = state.level, previousContext = state.context;
    const known = galaxy.systems.filter(s => s.discovered || state.reveal);
    if (state.tracking) state.context = state.tracking.context;
    if (state.camera.zoom >= .7 && !state.tracking && !cameraMoving()) {
      const nearest = [...known].sort((a, b) => distance(a, state.camera) - distance(b, state.camera))[0];
      const contextDistance = state.context ? distance(state.context.star, state.camera) : Infinity;
      const extent = state.context ? state.context.model.extent * state.context.frame.scale : 0;
      if (nearest && (!state.context || contextDistance > extent * 2 + Math.max(W, H) / state.camera.zoom * .7)) state.context = prepareSystem(nearest);
    }
    if (previousContext !== state.context) { state.focusPlanet = null; clearSelection(); }
    state.level = 'galaxy';
    if (state.context) {
      const context = state.context, frame = context.frame;
      const localZoom = state.camera.zoom * frame.scale;
      const center = project(frame.x, frame.y), visibleRadius = context.model.extent * localZoom;
      if (localZoom >= Math.min(.08, systemViewZoom(context.model) * .85) && center.x + visibleRadius >= 0 && center.x - visibleRadius <= W && center.y + visibleRadius >= 0 && center.y - visibleRadius <= H) {
        state.level = 'system'; state.system = context.model; state.exploration.visited.add(context.star.id);
        const selectedPlanet = state.selected?.kind ? state.selected : null;
        const candidates = context.model.planets.filter(p => p.kind !== 'gazeuse');
        const nearest = [...candidates].sort((a, b) => distance(planetWorldPosition(a, context), state.camera) - distance(planetWorldPosition(b, context), state.camera))[0];
        let planet = state.tracking?.planet || selectedPlanet || state.focusPlanet || nearest;
        if (planet && !context.model.planets.some(p => p.id === planet.id)) planet = nearest;
        const isVisible = p => {
          const position = planetWorldPosition(p, context), point = project(position.x, position.y), r = p.radius * localZoom;
          return point.x + r * 1.4 >= 0 && point.x - r * 1.4 <= W && point.y + r >= 0 && point.y - r <= H;
        };
        if (nearest && planet && !isVisible(planet) && isVisible(nearest)) planet = nearest;
        if (planet && planet.kind !== 'gazeuse') {
          const pp = planetWorldPosition(planet, context), point = project(pp.x, pp.y), r = planet.radius * localZoom;
          const visible = point.x + r * 1.4 >= 0 && point.x - r * 1.4 <= W && point.y + r >= 0 && point.y - r <= H;
          if (visible && r > 18) {
            state.focusPlanet = planet; prepareTerrain(planet, context);
            if (r > 45) followPlanet(planet, context);
            if (r >= 80) {
              state.level = 'surface'; state.planet = planet;
              const record = context.terrains.get(planet.id); terrainTexture = record.texture; terrainData = record.data; state.terrain = record.data;
            }
          }
        }
      }
    }
    if (state.tracking) {
      const r = state.tracking.planet.radius * state.tracking.context.frame.scale * state.camera.zoom;
      if (r < 22) state.tracking = null;
    }
    if (previousLevel !== state.level) {
      state.selected = null; state.tool = 'pan'; $('inspector').hidden = true; $('toast').classList.remove('visible'); updateUI();
    }
  }

  function renderUniverse(now) {
    const cam = state.camera;
    let visibleContexts = [];
    const closeSurface = state.level === 'surface' && state.planet &&
      state.planet.radius * state.context.frame.scale * cam.zoom > Math.max(W, H) * 1.5;
    if (cam.zoom >= .7 && !closeSurface) {
      const visibleStars = galaxy.systems.filter(s => s.discovered || state.reveal)
        .filter(s => { const p = project(s.x, s.y); const padding = 18 * cam.zoom; return p.x > -padding && p.x < W + padding && p.y > -padding && p.y < H + padding; })
        .sort((a, b) => distance(a, cam) - distance(b, cam)).slice(0, 12);
      if (state.context && !visibleStars.some(s => s.id === state.context.star.id)) visibleStars.push(state.context.star);
      visibleContexts = visibleStars.map(prepareSystem);
    }
    renderer.render({ state, galaxy, home, contexts, visibleContexts, now });
  }

  function clearSelection() { state.selected = null; state.tool = 'pan'; $('inspector').hidden = true; $('toast').classList.remove('visible'); }
  function enterSystem() {
    if (state.level !== 'galaxy') return;
    const star = state.selected || home;
    if (!star.discovered && !state.reveal) return;
    state.context = prepareSystem(star); state.system = state.context.model;
    state.tracking = null; state.focusPlanet = null; clearSelection();
    const camera = systemCamera();
    focusCamera(camera.x, camera.y, camera.zoom); persist();
  }
  function enterPlanet() {
    if (state.level !== 'system') return;
    const planet = state.selected?.kind ? state.selected : state.system.planets.find(p => p.kind !== 'gazeuse');
    if (!planet) { toast('Aucun monde à surface solide dans ce système.'); return; }
    if (planet.kind === 'gazeuse') { toast('Cette géante gazeuse ne possède pas de surface solide.'); return; }
    const record = prepareTerrain(planet); state.focusPlanet = planet; state.planet = planet; followPlanet(planet);
    clearSelection();
    const f = surfaceFrame(planet), camera = worldCamera(f, { x: record.texture.width / 2, y: record.texture.height / 2, zoom: Math.max(W / record.texture.width, H / record.texture.height) * 1.08 });
    focusCamera(camera.x, camera.y, camera.zoom);
  }
  function back() {
    clearSelection(); state.tracking = null;
    if (state.level === 'surface') {
      state.focusPlanet = null;
      const camera = systemCamera();
      focusCamera(camera.x, camera.y, camera.zoom);
    } else if (state.level === 'system') {
      const star = state.context.star; state.focusPlanet = null;
      focusCamera(star.x - 200, star.y - 160, Math.max(.09, fitZoom(1900)));
    } else overview();
  }
  function overview() {
    clearSelection(); state.tracking = null;
    if (state.level === 'galaxy') focusCamera(0, 0, fitZoom(11200));
    else if (state.level === 'system') {
      const camera = systemCamera();
      focusCamera(camera.x, camera.y, camera.zoom);
    } else {
      followPlanet(state.planet);
      const frame = surfaceFrame(), camera = worldCamera(frame, { x: terrainTexture.width / 2, y: terrainTexture.height / 2,
        zoom: Math.min((W - 30) / terrainTexture.width, (H - 200) / terrainTexture.height) });
      focusCamera(camera.x, camera.y, camera.zoom);
    }
  }
  function focusHome() {
    if (state.level === 'galaxy') { state.context = prepareSystem(home); state.tracking = null; select(home); resetCamera(); }
    else if (state.level === 'system') { state.tracking = null; state.focusPlanet = null; resetCamera(); }
    else { followPlanet(state.planet); resetCamera(); }
  }

  function select(item) {
    state.selected = item;
    if (state.level === 'system') state.focusPlanet = item;
    const systemModel = state.level === 'galaxy' ? prepareSystem(item).model : state.system;
    hud.showSelection(item, { state, systemModel }); updateUI();
  }
  function scanAt(point) {
    const from = state.selected && !state.selected.surfacePoint ? state.selected : home;
    Exploration.launch(state.exploration, from, point, performance.now());
    toast('Sonde en route. Relevé du secteur en cours.'); state.tool = 'pan'; updateUI();
  }
  function completeMissions(now) {
    for (const result of Exploration.advance(state.exploration, galaxy, now)) {
      const count = result.discoveredCount;
      toast(count ? `${count} systèmes détectés. Secteur cartographié.` : 'Secteur cartographié. Aucun nouveau système détecté.');
      persist(); updateUI();
    }
  }
  function updateUI() {
    const scaleCamera = state.level === 'galaxy' ? state.camera : localCamera(state.level === 'system' ? state.context.frame : surfaceFrame());
    hud.update({ state, galaxy, terrainData, width: W, scaleCamera });
  }

  function clickMap(x, y, doubleClick = false) {
    if ($('menu-dialog').open) return;
    const point = unproject(x, y);
    if (state.level === 'galaxy') {
      if (state.tool === 'scan') { scanAt(point); return; }
      const candidates = galaxy.systems.filter(s => s.discovered || state.reveal);
      let best = null, bestDistance = 18;
      for (const s of candidates) { const p = project(s.x, s.y), d = Math.hypot(p.x - x, p.y - y); if (d < bestDistance) { best = s; bestDistance = d; } }
      if (best) { select(best); if (doubleClick) enterSystem(); }
      else { $('inspector').hidden = true; state.selected = null; }
    } else if (state.level === 'system') {
      let best = null, bestDistance = 24;
      for (const p of state.system.planets) { const pos = planetWorldPosition(p), pp = project(pos.x, pos.y), d = Math.hypot(pp.x - x, pp.y - y); if (d < bestDistance) { best = p; bestDistance = d; } }
      if (best) { select(best); if (doubleClick) enterPlanet(); } else { $('inspector').hidden = true; state.selected = null; }
    } else {
      const frame = surfaceFrame(), terrainPoint = { x: (point.x - frame.x) / frame.scale, y: (point.y - frame.y) / frame.scale };
      const tx = Math.floor(terrainPoint.x / Config.terrain.textureScale), ty = Math.floor(terrainPoint.y / Config.terrain.textureScale);
      if (tx < 0 || ty < 0 || tx >= terrainData.width || ty >= terrainData.height) return;
      const height = terrainData.elevation[ty * terrainData.width + tx], altitude = Math.round((height - terrainData.seaLevel) * 35);
      const names = height < 100 ? 'Zone océanique' : height < 109 ? 'Littoral' : height < 143 ? 'Plaine continentale' : height < 183 ? 'Plateau rocheux' : 'Massif montagneux';
      const nearest = terrainData.resources.find(r => Math.hypot(r.x - tx, r.y - ty) < 10);
      select({ surfacePoint: true, x: terrainPoint.x, y: terrainPoint.y, altitude, name: names,
        info: nearest ? `Gisement détecté : ${nearest.type}. Les courbes de niveau indiquent la pente du terrain.` : 'Le relief, les côtes et les ressources composent une surface générée pour ce monde.' });
    }
  }
  function zoomAt(factor, x = W / 2, y = H / 2) {
    const before = unproject(x, y), [min, max] = zoomLimits(before);
    const z = clamp(state.camera.zoom * factor, min, max);
    state.target = Camera.anchoredZoom(state.camera, viewport, z, { x, y });
    state.camera = { ...state.target };
    updateSceneContext(); updateUI();
  }
  let lastTap = { t: 0, x: 0, y: 0 };
  canvas.addEventListener('pointerdown', e => {
    if ($('menu-dialog').open) return;
    canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pointersLast.set(e.pointerId, { x: e.clientX, y: e.clientY }); pointerMoved = false;
    if (pointers.size === 2) {
      const ps = [...pointers.values()]; pinch = { distance: distance(ps[0], ps[1]), midpoint: { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 } }; pointerMoved = true;
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const last = pointers.get(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2 && pinch) {
      const ps = [...pointers.values()], d = distance(ps[0], ps[1]), mid = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
      const before = unproject(pinch.midpoint.x, pinch.midpoint.y), [min, max] = zoomLimits(before);
      const z = clamp(state.camera.zoom * d / Math.max(1, pinch.distance), min, max);
      state.target = Camera.anchoredZoom(state.camera, viewport, z, mid, pinch.midpoint);
      state.camera = { ...state.target }; pinch = { distance: d, midpoint: mid }; pointerMoved = true;
      updateSceneContext(); updateUI();
    } else {
      const start = pointersLast.get(e.pointerId);
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) pointerMoved = true;
      if (pointerMoved) {
        state.target = { ...state.camera, x: state.camera.x - (e.clientX - last.x) / state.camera.zoom, y: state.camera.y - (e.clientY - last.y) / state.camera.zoom };
        state.camera = { ...state.target }; updateSceneContext();
      }
    }
  });
  function release(e, cancelled = false) {
    if (!pointers.has(e.pointerId)) return;
    const wasPinch = pinch !== null; pointers.delete(e.pointerId); pointersLast.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!cancelled && !pointerMoved && !wasPinch) {
      const now = performance.now(), double = now - lastTap.t < 340 && Math.hypot(lastTap.x - e.clientX, lastTap.y - e.clientY) < 24;
      clickMap(e.clientX, e.clientY, double); lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    if (wasPinch) pointerMoved = true;
  }
  canvas.addEventListener('pointerup', e => release(e)); canvas.addEventListener('pointercancel', e => release(e, true));
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  $('zoom-in').onclick = () => zoomAt(1.55); $('zoom-out').onclick = () => zoomAt(1 / 1.55);
  $('back-button').onclick = back; $('overview-button').onclick = overview; $('home-button').onclick = focusHome;
  $('pan-button').onclick = () => { state.tool = 'pan'; updateUI(); };
  $('scan-button').onclick = () => { state.tool = state.tool === 'scan' ? 'pan' : 'scan'; $('inspector').hidden = true; updateUI(); if (state.tool === 'scan') toast('Touchez la carte pour envoyer une sonde.'); };
  $('close-inspector').onclick = () => { state.selected = null; $('inspector').hidden = true; };
  $('enter-button').onclick = () => state.level === 'galaxy' ? enterSystem() : enterPlanet();
  $('breadcrumb-galaxy').onclick = () => {
    if (state.level === 'galaxy') { overview(); return; }
    const star = state.context.star; state.tracking = null; state.focusPlanet = null; clearSelection();
    focusCamera(star.x - 200, star.y - 160, Math.max(.09, fitZoom(1900)));
  };
  $('breadcrumb-system').onclick = () => { if (state.level === 'surface') back(); };
  $('menu-button').onclick = () => { $('continue-button').firstElementChild.textContent = 'Reprendre l’exploration'; $('menu-dialog').showModal(); };
  $('continue-button').onclick = () => { $('menu-dialog').close(); if (!menuStarted) { menuStarted = true; toast('Zoomez sur Néréide pour explorer son système.'); } };
  $('generate-button').onclick = () => { regenerate($('seed-input').value); $('continue-button').firstElementChild.textContent = 'Explorer cet univers'; };
  $('seed-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('generate-button').click(); });
  $('reveal-toggle').onchange = e => { state.reveal = e.target.checked; updateUI(); };
  function setPause(value) {
    state.paused = value; $('motion-toggle').checked = !value;
    $('pause-button').innerHTML = value ? '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>';
    $('pause-button').setAttribute('aria-label', value ? 'Animer les orbites' : 'Mettre les orbites en pause'); updateUI();
  }
  $('pause-button').onclick = () => setPause(!state.paused); $('motion-toggle').onchange = e => setPause(!e.target.checked);
  document.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') { if ($('menu-dialog').open) $('menu-dialog').close(); else if (!$('inspector').hidden) { $('inspector').hidden = true; state.selected = null; } else back(); }
    if (e.key === '+' || e.key === '=') zoomAt(1.4);
    if (e.key === '-') zoomAt(1 / 1.4);
    if (e.key === ' ' && !$('menu-dialog').open) { e.preventDefault(); setPause(!state.paused); }
    if (e.key === 'Enter' && state.selected && !$('menu-dialog').open) $('enter-button').click();
    if (!$('menu-dialog').open && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault(); const step = 70 / state.target.zoom;
      state.target.x += e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      state.target.y += e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    }
  });
  function resize() {
    W = innerWidth; H = innerHeight; DPR = Math.min(devicePixelRatio || 1, 2);
    viewport.width = W; viewport.height = H; renderer.resize(W, H, DPR);
    if (galaxy) updateUI();
  }
  addEventListener('resize', resize); document.addEventListener('visibilitychange', () => { persist(); lastTime = 0; });

  function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, Config.simulation.maxFrameSeconds) : 0; lastTime = now;
    Simulation.advance(state.simulation, dt, !state.paused && !document.hidden);
    if (state.tracking) {
      const follow = state.tracking, position = planetWorldPosition(follow.planet, follow.context);
      const dx = position.x - follow.position.x, dy = position.y - follow.position.y;
      state.camera.x += dx; state.camera.y += dy; state.target.x += dx; state.target.y += dy;
      follow.position = position;
    }
    completeMissions(now);
    state.camera = Camera.smooth(state.camera, state.target, dt, Config.camera.easingRate);
    updateSceneContext(); renderUniverse(now);
    if (now - lastHUD > 350) { updateUI(); lastHUD = now; }
    requestAnimationFrame(frame);
  }

  // A small inspection API supports browser checks without bypassing production paths.
  globalThis.OrbitalDebug = Object.freeze({
    getState: () => ({ level: state.level, seed: state.seed, selectedId: state.selected?.id || null,
      systemCount: galaxy.systems.length, discoveredCount: galaxy.systems.filter(s => s.discovered || state.reveal).length,
      planetCount: state.system?.planets.length || 0, zoom: state.camera.zoom, time: state.simulation.time,
      homeId: home.id, transitioning: false, moving: cameraMoving(), tool: state.tool,
      planetKind: state.planet?.kind || null, missions: state.exploration.missions.length }),
    focusHome, enterSystem, enterPlanet, back, regenerate, zoomAt,
    getCamera: () => ({ ...state.camera }),
    getHomeScreenPosition: () => project(home.x, home.y),
    getPlanetScreenPositions: () => (state.system?.planets || []).map(p => { const pos = planetWorldPosition(p); return { ...project(pos.x, pos.y), id: p.id, kind: p.kind }; }),
    scanAt, setPause
  });
  resize(); const previous = stored(); regenerate(previous?.seed ?? 'NEREIDE-01', previous);
  $('menu-dialog').showModal(); requestAnimationFrame(frame);
})();
