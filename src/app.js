(function () {
  'use strict';
  const World = globalThis.OrbitWorld, Config = globalThis.OrbitConfig;
  const Camera = globalThis.OrbitCamera, Simulation = globalThis.OrbitSimulation;
  const Exploration = globalThis.OrbitExploration, Save = globalThis.OrbitSave;
  const Construction = globalThis.OrbitConstruction, BuildingData = globalThis.OrbitBuildingData;
  const ResourceData = globalThis.OrbitResourceData;
  const FactorySimulation = globalThis.OrbitFactorySimulation, BlockData = globalThis.OrbitBlockData;
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
  let lastHUD = 0, pointerMoved = false, menuStarted = false, pinch = null, pendingBuildingType = null;
  let pendingBlockType = null, factoryDrag = null;
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
    const nestedFactory = factoryView();
    if (nestedFactory) max = Math.min(max, 3.2 / nestedFactory.worldFrame.scale);
    else if (state.context) {
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
  function prepareColony(planet) {
    return Construction.initializePlanet(state.simulation, planet.id, Boolean(planet.startingCandidate));
  }
  function surfaceFrame(planet = state.planet, context = state.context) {
    const record = prepareTerrain(planet, context);
    return Camera.surfaceFrame(planetWorldPosition(planet, context), planet.radius * context.frame.scale, record.texture);
  }
  function factoryView() {
    const factory = FactorySimulation.get(state.simulation, state.focusFactory);
    const building = factory && state.simulation.buildings[factory.buildingId];
    if (!factory || !building || building.planetId !== state.planet?.id || !state.context) return null;
    return { factory, building, ...FactorySimulation.createFrame(surfaceFrame(), building, factory) };
  }
  function focusFactoryAt(screenX, screenY, factor = 1) {
    if (state.level !== 'surface' || state.focusFactory || !state.planet || factor <= 1) return false;
    const surfaceCamera = localCamera(surfaceFrame());
    const projectedBoardHeight = BuildingData.definitions.factory.footprint * surfaceCamera.zoom * factor;
    if (projectedBoardHeight < 95) return false;
    const hitRadius = Math.max(36, Math.min(72, BuildingData.definitions.factory.footprint * surfaceCamera.zoom * .55));
    let nearest = null, nearestDistance = hitRadius;
    for (const building of Construction.list(state.simulation, state.planet.id)) {
      if (building.type !== 'factory' || building.status !== 'complete') continue;
      const point = project(building.x, building.y, surfaceCamera);
      const d = Math.hypot(point.x - screenX, point.y - screenY);
      if (d <= nearestDistance) { nearest = building; nearestDistance = d; }
    }
    const factory = nearest && FactorySimulation.byBuilding(state.simulation, nearest.id);
    if (!factory) return false;
    state.focusFactory = factory.id;
    return true;
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
    if (state.level === 'factory') {
      const view = factoryView();
      if (view) return Camera.toWorld(view.worldFrame, { x: view.factory.width / 2, y: view.factory.height / 2,
        zoom: Math.max(W / view.factory.width, H / view.factory.height) * 1.12 });
    }
    return worldCamera(surfaceFrame(), { x: terrainData.width * Config.terrain.textureScale / 2, y: terrainData.height * Config.terrain.textureScale / 2,
      zoom: Math.max(W / (terrainData.width * Config.terrain.textureScale), H / (terrainData.height * Config.terrain.textureScale)) * 1.08 });
  }
  function resetCamera(immediate = false) { const cam = homeCamera(); focusCamera(cam.x, cam.y, cam.zoom, immediate); }


  function regenerate(seed, restoring = null) {
    const keepInfiniteMaterials = state.simulation.infiniteMaterials === true;
    state.seed = normalizedSeed(seed); galaxy = World.createGalaxy(state.seed);
    home = galaxy.systems.find(s => s.id === galaxy.homeId);
    state.simulation = Simulation.create(); state.exploration = Exploration.create(home);
    Save.restore(state, galaxy, restoring);
    if (!restoring) state.simulation.infiniteMaterials = keepInfiniteMaterials;
    state.level = 'galaxy'; state.system = null; state.planet = null; state.selected = null;
    state.context = null; state.tracking = null; state.focusPlanet = null; state.focusFactory = null;
    state.connectionSource = null; state.tool = 'pan'; pendingBuildingType = null; pendingBlockType = null;
    state.terrain = null; terrainData = null; terrainTexture = null;
    contexts.clear();
    const natalPlanet = prepareSystem(home).model.planets.find(planet => planet.startingCandidate);
    if (natalPlanet) prepareColony(natalPlanet);
    renderer.prepareGalaxy(galaxy, state.seed);
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
    if (previousContext !== state.context) { state.focusPlanet = null; state.focusFactory = null; clearSelection(); }
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
              prepareColony(planet);
              const record = context.terrains.get(planet.id); terrainTexture = record.texture; terrainData = record.data; state.terrain = record.data;
            }
          }
        }
      }
    }
    const nestedFactory = factoryView();
    if (nestedFactory) {
      const frame = nestedFactory.worldFrame, factory = nestedFactory.factory;
      const boardWidth = factory.width * state.camera.zoom * frame.scale;
      const boardHeight = factory.height * state.camera.zoom * frame.scale;
      const worldCenter = Camera.worldPoint(frame, { x: factory.width / 2, y: factory.height / 2 });
      const screenCenter = project(worldCenter.x, worldCenter.y);
      const centered = Math.abs(screenCenter.x - W / 2) < W * .48 && Math.abs(screenCenter.y - H / 2) < H * .48;
      if (centered && boardWidth >= W * 1.02 && boardHeight >= H * 1.02) state.level = 'factory';
      else if (boardWidth < 95 && boardHeight < 95) { state.focusFactory = null; state.connectionSource = null; }
    }
    if (state.tracking) {
      const r = state.tracking.planet.radius * state.tracking.context.frame.scale * state.camera.zoom;
      if (r < 22) state.tracking = null;
    }
    if (previousLevel !== state.level) {
      state.selected = null; state.tool = 'pan'; pendingBuildingType = null; pendingBlockType = null;
      state.connectionSource = null; factoryDrag = null;
      $('inspector').hidden = true; $('toast').classList.remove('visible'); updateUI();
    }
  }

  function renderUniverse(now) {
    const cam = state.camera;
    let visibleContexts = [];
    const closeSurface = (state.level === 'surface' || state.level === 'factory') && state.planet &&
      state.planet.radius * state.context.frame.scale * cam.zoom > Math.max(W, H) * 1.5;
    if (cam.zoom >= .7 && !closeSurface) {
      const visibleStars = galaxy.systems.filter(s => s.discovered || state.reveal)
        .filter(s => { const p = project(s.x, s.y); const padding = 18 * cam.zoom; return p.x > -padding && p.x < W + padding && p.y > -padding && p.y < H + padding; })
        .sort((a, b) => distance(a, cam) - distance(b, cam)).slice(0, 12);
      if (state.context && !visibleStars.some(s => s.id === state.context.star.id)) visibleStars.push(state.context.star);
      visibleContexts = visibleStars.map(prepareSystem);
    }
    renderer.render({ state, galaxy, home, contexts, visibleContexts, factoryView: factoryView(), now });
  }

  function clearSelection() {
    state.selected = null; state.tool = 'pan'; pendingBuildingType = null; pendingBlockType = null;
    state.connectionSource = null; factoryDrag = null;
    $('inspector').hidden = true; $('toast').classList.remove('visible');
  }
  function enterSystem() {
    if (state.level !== 'galaxy') return;
    const star = state.selected || home;
    if (!star.discovered && !state.reveal) return;
    state.context = prepareSystem(star); state.system = state.context.model;
    state.tracking = null; state.focusPlanet = null; state.focusFactory = null; clearSelection();
    const camera = systemCamera();
    focusCamera(camera.x, camera.y, camera.zoom); persist();
  }
  function enterPlanet() {
    if (state.level !== 'system') return;
    const planet = state.selected?.kind ? state.selected : state.system.planets.find(p => p.kind !== 'gazeuse');
    if (!planet) { toast('Aucun monde à surface solide dans ce système.'); return; }
    if (planet.kind === 'gazeuse') { toast('Cette géante gazeuse ne possède pas de surface solide.'); return; }
    const record = prepareTerrain(planet); prepareColony(planet); state.focusPlanet = planet; state.focusFactory = null; state.planet = planet; followPlanet(planet);
    clearSelection();
    const f = surfaceFrame(planet), camera = worldCamera(f, { x: record.texture.width / 2, y: record.texture.height / 2, zoom: Math.max(W / record.texture.width, H / record.texture.height) * 1.08 });
    focusCamera(camera.x, camera.y, camera.zoom);
  }
  function back() {
    if (state.level === 'factory') {
      const view = factoryView();
      clearSelection(); state.tracking = null;
      if (view) {
        const mapCamera = { x: view.building.x, y: view.building.y, zoom: 2.3 };
        const camera = worldCamera(surfaceFrame(), mapCamera);
        focusCamera(camera.x, camera.y, camera.zoom);
      }
    } else if (state.level === 'surface') {
      clearSelection(); state.tracking = null;
      state.focusPlanet = null;
      const camera = systemCamera();
      focusCamera(camera.x, camera.y, camera.zoom);
    } else if (state.level === 'system') {
      clearSelection(); state.tracking = null;
      const star = state.context.star; state.focusPlanet = null;
      focusCamera(star.x - 200, star.y - 160, Math.max(.09, fitZoom(1900)));
    } else { clearSelection(); state.tracking = null; overview(); }
  }
  function overview() {
    clearSelection(); state.tracking = null;
    if (state.level === 'galaxy') focusCamera(0, 0, fitZoom(11200));
    else if (state.level === 'system') {
      const camera = systemCamera();
      focusCamera(camera.x, camera.y, camera.zoom);
    } else if (state.level === 'factory') {
      resetCamera();
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
    else if (state.level === 'factory') resetCamera();
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
    const view = factoryView();
    const infiniteMaterials = state.simulation.infiniteMaterials === true;
    $('infinite-materials-button').setAttribute('aria-pressed', String(infiniteMaterials));
    $('infinite-materials-status').textContent = infiniteMaterials ? 'ACTIVÉS' : 'DÉSACTIVÉS';
    const scaleCamera = state.level === 'galaxy' ? state.camera : state.level === 'system' ? localCamera(state.context.frame) :
      state.level === 'factory' && view ? localCamera(view.worldFrame) : localCamera(surfaceFrame());
    hud.update({ state, galaxy, terrainData, width: W, scaleCamera, factoryView: view });
  }

  function missingText(missing = {}) {
    return Object.entries(missing).map(([id, amount]) => `${ResourceData.definitions[id]?.short || id} ${amount}`).join(' · ');
  }
  function nearestBuildingAt(screenX, screenY, frame) {
    const cam = localCamera(frame);
    let nearest = null, nearestDistance = Infinity;
    for (const building of Construction.list(state.simulation, state.planet.id)) {
      const point = project(building.x, building.y, cam);
      const definition = BuildingData.definitions[building.type];
      const hitRadius = Math.max(17, (definition?.footprint || 20) * cam.zoom * .7);
      const d = Math.hypot(point.x - screenX, point.y - screenY);
      if (d <= hitRadius && d < nearestDistance) { nearest = building; nearestDistance = d; }
    }
    return nearest;
  }
  function placeBuildingAt(terrainPoint, terrainHeight) {
    if (!pendingBuildingType) { state.tool = 'pan'; updateUI(); return; }
    if (terrainHeight <= terrainData.seaLevel + 4) {
      toast('Construction impossible sur l’eau ou le littoral. Choisissez une terre ferme.'); return;
    }
    const result = Construction.place(state.simulation, { planetId: state.planet.id, type: pendingBuildingType,
      x: Math.round(terrainPoint.x), y: Math.round(terrainPoint.y) });
    if (!result.ok) {
      if (result.reason === 'occupied') toast('Cette zone est trop proche d’une autre installation.');
      else if (result.reason === 'insufficient') toast(`Matériaux insuffisants : ${missingText(result.missing)}.`);
      else toast('Le chantier ne peut pas être lancé à cet endroit.');
      return;
    }
    if (result.building.type === 'factory') FactorySimulation.create(state.simulation, result.building.id);
    state.tool = 'pan'; pendingBuildingType = null; select(result.building);
    toast(`${BuildingData.definitions[result.building.type].name} : chantier lancé.`); persist();
  }
  function demolishSelected() {
    const building = state.selected?.entityType === 'building' ? state.simulation.buildings[state.selected.id] : null;
    if (!building) return;
    const name = BuildingData.definitions[building.type]?.name || 'Installation';
    const result = Construction.demolish(state.simulation, building.id);
    if (!result.ok) return;
    state.selected = null; $('inspector').hidden = true; persist(); updateUI();
    toast(`${name} démoli. Tous les matériaux ont été remboursés.`);
  }
  function factoryBlockAt(screenX, screenY, view = factoryView()) {
    if (!view) return null;
    const camera = localCamera(view.worldFrame);
    let nearest = null, nearestDistance = Infinity;
    for (const id of view.factory.order) {
      const block = view.factory.blocks[id], p = project(block.x, block.y, camera);
      const dx = Math.abs(p.x - screenX), dy = Math.abs(p.y - screenY);
      if (dx <= BlockData.node.width * camera.zoom * .55 && dy <= BlockData.node.height * camera.zoom * .58) {
        const d = dx + dy;
        if (d < nearestDistance) { nearest = block; nearestDistance = d; }
      }
    }
    return nearest;
  }
  function factoryPoint(screenX, screenY, view = factoryView()) {
    return view ? Camera.unproject({ x: screenX, y: screenY }, localCamera(view.worldFrame), viewport) : null;
  }
  function nearestFactoryConnection(screenX, screenY, view = factoryView()) {
    if (!view) return null;
    const camera = localCamera(view.worldFrame), width = BlockData.node.width, height = BlockData.node.height;
    let best = null, bestDistance = 12;
    for (const edge of view.factory.connections) {
      const from = view.factory.blocks[edge.from], to = view.factory.blocks[edge.to];
      if (!from || !to) continue;
      const a = project(from.x + width / 2, from.y, camera), b = project(to.x - width / 2, to.y, camera);
      const dx = b.x - a.x, dy = b.y - a.y, t = clamp(((screenX - a.x) * dx + (screenY - a.y) * dy) / Math.max(1, dx * dx + dy * dy), 0, 1);
      const d = Math.hypot(screenX - (a.x + dx * t), screenY - (a.y + dy * t));
      if (d < bestDistance) { best = edge; bestDistance = d; }
    }
    return best;
  }
  function deleteSelectedBlock() {
    const view = factoryView(), block = state.selected?.entityType === 'block' ? state.selected : null;
    if (!view || !block) return;
    FactorySimulation.removeBlock(state.simulation, view.factory.id, block.id);
    state.selected = null; $('inspector').hidden = true; persist(); updateUI(); toast('Bloc supprimé.');
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
    } else if (state.level === 'factory') {
      const view = factoryView();
      if (!view) { state.level = 'surface'; updateUI(); return; }
      if (state.tool === 'factory-delete-link') {
        const edge = nearestFactoryConnection(x, y, view);
        if (edge) { FactorySimulation.disconnect(state.simulation, view.factory.id, edge.id); persist(); toast('Connexion supprimée.'); }
        else toast('Touchez une ligne de connexion.');
        state.tool = 'pan'; updateUI(); return;
      }
      const block = factoryBlockAt(x, y, view);
      if (state.tool === 'factory-add') {
        const point = factoryPoint(x, y, view);
        if (!point) return;
        const result = FactorySimulation.addBlock(state.simulation, view.factory.id, pendingBlockType, point.x, point.y);
        if (!result.ok) { toast('Zone occupée ou trop proche du bord.'); return; }
        state.tool = 'pan'; pendingBlockType = null; select(result.block); persist(); return;
      }
      if (state.tool === 'factory-connect') {
        if (!block) { toast('Touchez un bloc pour choisir la source.'); return; }
        if (!state.connectionSource) {
          state.connectionSource = block.id; toast('Source choisie. Touchez un bloc de destination.'); updateUI(); return;
        }
        const result = FactorySimulation.connect(state.simulation, view.factory.id, state.connectionSource, block.id);
        if (result.ok) { toast('Connexion créée. Les ports sont reliés.'); persist(); }
        else toast(result.reason === 'no-free-port' || result.reason === 'port-occupied' ? 'Un port requis est déjà connecté.' : 'Connexion impossible.');
        state.connectionSource = null; state.tool = 'pan'; updateUI(); return;
      }
      if (block) select(block);
      else if (!state.tool.startsWith('factory-')) { state.selected = null; $('inspector').hidden = true; }
    } else {
      const frame = surfaceFrame(), terrainPoint = { x: (point.x - frame.x) / frame.scale, y: (point.y - frame.y) / frame.scale };
      const tx = Math.floor(terrainPoint.x / Config.terrain.textureScale), ty = Math.floor(terrainPoint.y / Config.terrain.textureScale);
      if (tx < 0 || ty < 0 || tx >= terrainData.width || ty >= terrainData.height) return;
      const height = terrainData.elevation[ty * terrainData.width + tx], altitude = Math.round((height - terrainData.seaLevel) * 35);
      if (state.tool === 'build') { placeBuildingAt(terrainPoint, height); return; }
      const building = nearestBuildingAt(x, y, frame);
      if (building) { select(building); return; }
      const names = height < 100 ? 'Zone océanique' : height < 109 ? 'Littoral' : height < 143 ? 'Plaine continentale' : height < 183 ? 'Plateau rocheux' : 'Massif montagneux';
      const nearest = terrainData.resources.find(r => Math.hypot(r.x - tx, r.y - ty) < 10);
      select({ surfacePoint: true, x: terrainPoint.x, y: terrainPoint.y, altitude, name: names,
        info: nearest ? `Gisement détecté : ${nearest.type}. Les courbes de niveau indiquent la pente du terrain.` : 'Le relief, les côtes et les ressources composent une surface générée pour ce monde.' });
    }
  }
  function zoomAt(factor, x = W / 2, y = H / 2) {
    focusFactoryAt(x, y, factor);
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
      factoryDrag = null;
      const ps = [...pointers.values()]; pinch = { distance: distance(ps[0], ps[1]), midpoint: { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 } }; pointerMoved = true;
    } else if (state.level === 'factory' && state.tool === 'pan') {
      const block = factoryBlockAt(e.clientX, e.clientY);
      if (block) factoryDrag = { pointerId: e.pointerId, blockId: block.id, moved: false, startX: e.clientX, startY: e.clientY };
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const last = pointers.get(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2 && pinch) {
      factoryDrag = null;
      const ps = [...pointers.values()], d = distance(ps[0], ps[1]), mid = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
      focusFactoryAt(mid.x, mid.y, d / Math.max(1, pinch.distance));
      const before = unproject(pinch.midpoint.x, pinch.midpoint.y), [min, max] = zoomLimits(before);
      const z = clamp(state.camera.zoom * d / Math.max(1, pinch.distance), min, max);
      state.target = Camera.anchoredZoom(state.camera, viewport, z, mid, pinch.midpoint);
      state.camera = { ...state.target }; pinch = { distance: d, midpoint: mid }; pointerMoved = true;
      updateSceneContext(); updateUI();
    } else if (factoryDrag?.pointerId === e.pointerId && state.level === 'factory') {
      const d = Math.hypot(e.clientX - factoryDrag.startX, e.clientY - factoryDrag.startY);
      if (d > 5) {
        const view = factoryView(), point = factoryPoint(e.clientX, e.clientY, view);
        if (view && point) {
          const result = FactorySimulation.moveBlock(state.simulation, view.factory.id, factoryDrag.blockId, point.x, point.y);
          if (result.ok) { factoryDrag.moved = true; pointerMoved = true; renderUniverse(performance.now()); }
        }
      }
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
    const finishedDrag = factoryDrag?.pointerId === e.pointerId ? factoryDrag : null;
    if (!cancelled && !pointerMoved && !wasPinch) {
      const now = performance.now(), double = now - lastTap.t < 340 && Math.hypot(lastTap.x - e.clientX, lastTap.y - e.clientY) < 24;
      clickMap(e.clientX, e.clientY, double); lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    if (finishedDrag?.moved) { persist(); updateUI(); }
    if (finishedDrag) factoryDrag = null;
    if (wasPinch) pointerMoved = true;
  }
  canvas.addEventListener('pointerup', e => release(e)); canvas.addEventListener('pointercancel', e => release(e, true));
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  $('zoom-in').onclick = () => zoomAt(1.55); $('zoom-out').onclick = () => zoomAt(1 / 1.55);
  $('back-button').onclick = back; $('overview-button').onclick = overview; $('home-button').onclick = focusHome;
  $('pan-button').onclick = () => {
    state.tool = 'pan'; pendingBuildingType = null; pendingBlockType = null;
    state.connectionSource = null; factoryDrag = null; updateUI();
  };
  $('scan-button').onclick = () => { state.tool = state.tool === 'scan' ? 'pan' : 'scan'; $('inspector').hidden = true; updateUI(); if (state.tool === 'scan') toast('Touchez la carte pour envoyer une sonde.'); };
  $('build-button').onclick = () => { if (state.level === 'surface') { updateUI(); $('build-dialog').showModal(); } };
  $('close-build-dialog').onclick = () => $('build-dialog').close();
  $('add-block-button').onclick = () => { updateUI(); $('blocks-dialog').showModal(); };
  $('close-blocks-dialog').onclick = () => $('blocks-dialog').close();
  for (const button of document.querySelectorAll('[data-block-type]')) button.onclick = () => {
    pendingBlockType = button.dataset.blockType; state.tool = 'factory-add'; state.connectionSource = null;
    $('blocks-dialog').close(); updateUI(); toast(`${BlockData.definitions[pendingBlockType].name} sélectionné. Touchez un espace libre.`);
  };
  $('connect-factory-button').onclick = () => {
    state.connectionSource = null; state.tool = state.tool === 'factory-connect' ? 'pan' : 'factory-connect';
    updateUI(); if (state.tool === 'factory-connect') toast('Choisissez le bloc source puis le bloc de destination.');
  };
  $('connect-selected-block-button').onclick = () => {
    const block = state.selected?.entityType === 'block' ? state.selected : null;
    if (!block || !factoryView()) return;
    state.tool = state.tool === 'factory-connect' ? 'pan' : 'factory-connect';
    state.connectionSource = state.tool === 'factory-connect' ? block.id : null;
    updateUI();
    if (state.tool === 'factory-connect') toast('Touchez le bloc de destination.');
  };
  $('delete-link-button').onclick = () => { state.tool = 'factory-delete-link'; state.connectionSource = null; updateUI(); toast('Touchez le lien à supprimer.'); };
  for (const button of document.querySelectorAll('[data-building-type]')) button.onclick = () => {
    pendingBuildingType = button.dataset.buildingType; state.tool = 'build'; state.selected = null;
    $('inspector').hidden = true; $('build-dialog').close(); updateUI();
    toast(`${BuildingData.definitions[pendingBuildingType].name} sélectionné. Touchez une terre ferme.`);
  };
  $('close-inspector').onclick = () => { state.selected = null; $('inspector').hidden = true; updateUI(); };
  $('enter-button').onclick = () => {
    if (state.level === 'galaxy') enterSystem();
    else if (state.level === 'system') enterPlanet();
  };
  $('delete-block-button').onclick = deleteSelectedBlock;
  $('demolish-button').onclick = demolishSelected;
  $('breadcrumb-galaxy').onclick = () => {
    if (state.level === 'galaxy') { overview(); return; }
    const star = state.context.star; state.tracking = null; state.focusPlanet = null; state.focusFactory = null; clearSelection();
    focusCamera(star.x - 200, star.y - 160, Math.max(.09, fitZoom(1900)));
  };
  $('breadcrumb-system').onclick = () => { if (state.level === 'surface' || state.level === 'factory') back(); };
  $('menu-button').onclick = () => { $('continue-button').firstElementChild.textContent = 'Reprendre l’exploration'; $('menu-dialog').showModal(); };
  $('continue-button').onclick = () => { $('menu-dialog').close(); if (!menuStarted) { menuStarted = true; toast('Zoomez sur Néréide pour explorer son système.'); } };
  $('infinite-materials-button').onclick = () => {
    state.simulation.infiniteMaterials = !state.simulation.infiniteMaterials;
    persist(); updateUI();
  };
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
    if (e.key === 'Escape') {
      if ($('blocks-dialog').open) $('blocks-dialog').close();
      else if ($('build-dialog').open) $('build-dialog').close();
      else if ($('menu-dialog').open) $('menu-dialog').close();
      else if (state.tool !== 'pan') {
        state.tool = 'pan'; pendingBuildingType = null; pendingBlockType = null;
        state.connectionSource = null; factoryDrag = null; updateUI();
      }
      else if (!$('inspector').hidden) { $('inspector').hidden = true; state.selected = null; updateUI(); }
      else back();
    }
    if (e.key === '+' || e.key === '=') zoomAt(1.4);
    if (e.key === '-') zoomAt(1 / 1.4);
    if (e.key === ' ' && !$('menu-dialog').open) { e.preventDefault(); setPause(!state.paused); }
    if (e.key === 'Enter' && state.selected && !$('menu-dialog').open && !$('blocks-dialog').open && !$('build-dialog').open && !$('enter-button').hidden) $('enter-button').click();
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
    const completedBuildings = Construction.advance(state.simulation);
    if (completedBuildings.length) {
      const localCompletions = completedBuildings.filter(building => building.planetId === state.planet?.id);
      if (localCompletions.length) toast(localCompletions.length === 1 ?
        `${BuildingData.definitions[localCompletions[0].type]?.name || 'Installation'} opérationnel.` :
        `${localCompletions.length} installations opérationnelles.`);
      persist(); updateUI();
    }
    const factoryEvents = FactorySimulation.advance(state.simulation, dt, !state.paused && !document.hidden);
    if (factoryEvents.length) persist();
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
      infiniteMaterials: state.simulation.infiniteMaterials,
      planetKind: state.planet?.kind || null, missions: state.exploration.missions.length,
      buildingCount: Object.keys(state.simulation.buildings).length }),
    focusHome, enterSystem, enterPlanet, back, regenerate, zoomAt,
    getCamera: () => ({ ...state.camera }),
    getHomeScreenPosition: () => project(home.x, home.y),
    getPlanetScreenPositions: () => (state.system?.planets || []).map(p => { const pos = planetWorldPosition(p); return { ...project(pos.x, pos.y), id: p.id, kind: p.kind }; }),
    getInventory: planetId => ({ ...(Construction.inventory(state.simulation, planetId || state.planet?.id) || {}) }),
    getBuildings: planetId => Construction.list(state.simulation, planetId || state.planet?.id).map(building => ({ ...building })),
    scanAt, setPause
  });
  resize(); const previous = stored(); regenerate(previous?.seed ?? 'NEREIDE-01', previous);
  $('menu-dialog').showModal(); requestAnimationFrame(frame);
})();
