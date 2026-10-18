(function () {
  'use strict';
  const World = globalThis.OrbitWorld, Config = globalThis.OrbitConfig;
  const Camera = globalThis.OrbitCamera, Simulation = globalThis.OrbitSimulation;
  const Exploration = globalThis.OrbitExploration, Save = globalThis.OrbitSave;
  const BuildingData = globalThis.OrbitBuildingData, BuildingModel = globalThis.OrbitSurfaceBuilding;
  const ResourceData = globalThis.OrbitResourceData, Inventory = globalThis.OrbitInventory;
  const BuildingPlacement = globalThis.OrbitBuildingPlacement, Construction = globalThis.OrbitConstruction;
  const RoadNetwork = globalThis.OrbitRoadNetwork, RoadCostField = globalThis.OrbitRoadCostField;
  const RoadConstruction = globalThis.OrbitRoadConstruction;
  const RoadPlacement = globalThis.OrbitRoadPlacement;
  const Logistics = globalThis.OrbitLogistics;
  const LogisticsNetwork = globalThis.OrbitLogisticsNetwork;
  const OrbitalLogisticsData = globalThis.OrbitOrbitalLogisticsData;
  const SettlementSimulation = globalThis.OrbitSettlementSimulation;
  const GlobeProjection = globalThis.OrbitPlanetGlobeProjection;
  const GlobeStyle = globalThis.OrbitPlanetGlobeStyle;
  const globeCamera = globalThis.OrbitPlanetGlobeCamera.create(GlobeStyle.camera);
  let terrainTuningPreset = null, terrainPreviewRecord = null, terrainTuningTarget = null;
  const $ = id => document.getElementById(id);
  const canvas = $('universe');
  const pointers = new Map();
  let pointerMoved = false;
  const renderer = globalThis.OrbitRenderer.create(canvas, {
    globeCanvas: $('planet-globe'), globeOverlayCanvas: $('planet-globe-overlay'),
    globeErrorElement: $('planet-globe-error'),
    isCameraInteracting: () => pointers.size > 0 && pointerMoved
  });
  const hud = globalThis.OrbitHUD.create(document);
  globalThis.OrbitDeveloperTools.create(document, {
    getTerrain: () => state.planet ? { terrain: prepareTerrain(state.planet).data, planet: state.planet } : null,
    getTerrainTuningContext: terrainTuningContext,
    onTerrainTuningApply: applyTerrainTuning,
    onTerrainTuningEnterSurface: enterTerrainTuningSurface
  });
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const formatAmount = value => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
  function resourceName(id) { return ResourceData.get(id)?.label || String(id).replace(/[_-]+/g, ' '); }
  function amountSummary(amounts) {
    const entries = Object.entries(amounts || {}).filter(([, amount]) => Number.isFinite(amount) && amount > 0);
    return entries.length ? entries.map(([id, amount]) => `${resourceName(id)} ${formatAmount(amount)}`).join(' · ') : 'aucun matériau';
  }
  const state = globalThis.OrbitState.create();
  const factoryEditor = globalThis.OrbitFactoryEditor.create(document, {
    onSave(buildingId, plan) {
      state.factoryPlans[buildingId] = plan;
      persist();
    },
    getDestinations(building) {
      return state.surfaceBuildings.filter(candidate => candidate.id !== building.id &&
        candidate.planetId === building.planetId && candidate.constructionState === 'complete' &&
        OrbitalLogisticsData.dockDestinationTypes.includes(candidate.type) &&
        LogisticsNetwork.hasReceivingDock(state, candidate) &&
        BuildingData.get(candidate.type)?.roadRequired);
    },
    onDockDestinationChange(buildingId, resourceId, destinationId) {
      const building = state.surfaceBuildings.find(candidate => candidate.id === buildingId);
      if (!building || !Logistics.setDockDestination(building, resourceId, destinationId)) return false;
      return true;
    }
  });
  let galaxy, home, terrainData;
  let nextBuildingId = 1;
  let W = innerWidth, H = innerHeight, DPR = Math.min(devicePixelRatio || 1, 3), lastTime = 0;
  let lastHUD = 0, lastAutosave = 0, menuStarted = false, storageWarningShown = false, pinch = null;
  const viewport = { width: W, height: H };
  const contexts = new Map();
  let roadDrag = null;

  function cancelRoadDrag() {
    roadDrag = null;
    state.roadPreview = null;
  }

  function stored() { try { return Save.load(localStorage); } catch (_) { return null; } }
  function persist() {
    try {
      if (!Save.save(localStorage, state, galaxy, performance.now())) {
        if (!storageWarningShown) toast('Échec de sauvegarde : le stockage local est indisponible ou plein. La partie actuelle risque de ne pas être conservée.');
        storageWarningShown = true;
      } else storageWarningShown = false;
    } catch (_) {
      if (!storageWarningShown) toast('Échec de sauvegarde : le stockage local est indisponible ou plein. La partie actuelle risque de ne pas être conservée.');
      storageWarningShown = true;
    }
  }
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
  function logisticsSystemModels() {
    const models = new Map();
    for (const building of state.surfaceBuildings) {
      if (building.type !== 'launch_platform') continue;
      const systemId = building.planetId.split(':p-')[0];
      if (models.has(systemId)) continue;
      const star = galaxy?.systems.find(item => item.id === systemId);
      if (star) models.set(systemId, prepareSystem(star).model);
    }
    if (state.system?.ark) models.set(state.system.id, state.system);
    return models;
  }
  function planetWorldPosition(planet, context = state.context) {
    return Camera.worldPoint(context.frame, World.planetPosition(planet, state.simulation.time));
  }
  function locateTuningPlanet(id) {
    if (!id) return null;
    if (state.context) {
      const planet = state.context.model.planets.find(candidate => candidate.id === id);
      if (planet) return { planet, context: state.context };
    }
    for (const context of contexts.values()) {
      const planet = context.model.planets.find(candidate => candidate.id === id);
      if (planet) return { planet, context };
    }
    return null;
  }
  function terrainTuningContext() {
    const selectedPlanet = state.context?.model.planets.find(candidate => candidate.id === state.selected?.id);
    const planet = state.planet || state.focusPlanet || selectedPlanet;
    if (!planet || planet.kind === 'gazeuse') return null;
    const found = locateTuningPlanet(planet.id);
    if (!found) return null;
    terrainTuningTarget = found;
    return { ...found, terrainSettings: globalThis.OrbitWorldgenData.terrain,
      globeStyle: GlobeStyle, surfaceActive: state.level === 'surface' && state.planet?.id === planet.id };
  }
  function applyTerrainTuning(preset, { regenerate = false, rebuild = 'terrain' } = {}) {
    if (!preset?.planetId) return { message: 'Aucune planète sélectionnée' };
    const target = locateTuningPlanet(preset.planetId) || terrainTuningTarget;
    if (!target || target.planet.id !== preset.planetId) return { message: 'Planète cible introuvable' };
    terrainTuningTarget = target;
    terrainTuningPreset = { planetId: preset.planetId, seed: preset.seed,
      renderStyle: preset.renderStyle };
    if (!regenerate) return { message: 'Shading appliqué en temps réel' };
    if (rebuild === 'surface') {
      prepareTerrain(target.planet, target.context);
      return { message: 'Matériau polaire actualisé' };
    }
    const planet = { ...target.planet, seed: preset.seed,
      geology: preset.planet.geology, temperature: preset.planet.temperature,
      terrainWater: preset.planet.surfaceWater, surfaceWater: preset.planet.surfaceWater };
    const data = World.createTerrain(preset.seed, Config.terrain.width, Config.terrain.height,
      planet, preset.terrainSettings);
    data.debugTuning = true;
    terrainPreviewRecord = { planetId: planet.id, data, planet, roadCostField: null, tuned: true };
    terrainData = data;
    return { message: `Terrain recalculé · seed ${preset.seed} · ${planet.name || planet.id}` };
  }
  function enterTerrainTuningSurface() {
    const target = terrainTuningTarget || terrainTuningContext();
    if (!target) { toast('Sélectionnez une planète solide avant d’ouvrir sa surface.'); return; }
    if (state.level === 'galaxy') {
      state.context = target.context; state.system = target.context.model; state.level = 'system';
      state.focusPlanet = target.planet; state.selected = target.planet;
      followPlanet(target.planet, target.context);
      const position = planetWorldPosition(target.planet, target.context);
      const radius = target.planet.radius * target.context.frame.scale;
      focusCamera(position.x, position.y, 130 / Math.max(1e-9, radius), true);
      return;
    }
    if (state.context?.star.id !== target.context.star.id) {
      state.context = target.context; state.system = target.context.model;
    }
    if (state.level === 'system') {
      state.selected = target.planet;
      enterPlanet();
    }
  }
  function activeGlobeStyle() {
    return terrainTuningPreset && terrainTuningPreset.planetId === state.planet?.id
      ? terrainTuningPreset.renderStyle : GlobeStyle;
  }
  function activeGlobePlanet() {
    return terrainPreviewRecord?.tuned && terrainPreviewRecord.planet?.id === state.planet?.id
      ? terrainPreviewRecord.planet : state.planet;
  }
  function prepareTerrain(planet, context = state.context) {
    if (terrainPreviewRecord?.tuned && terrainPreviewRecord.data &&
        terrainPreviewRecord.planetId === planet.id) {
      terrainData = terrainPreviewRecord.data;
      return terrainPreviewRecord;
    }
    if (!context.terrains.has(planet.id)) {
      terrainData = World.createTerrain(planet.seed, Config.terrain.width, Config.terrain.height, planet);
      context.terrains.set(planet.id, { data: terrainData, roadCostField: null });
    }
    const record = context.terrains.get(planet.id);
    terrainData = record.data;
    if (!record.marineDockAnchorsResolved) {
      record.marineDockAnchorsResolved = true;
      const network = state.roadNetworks[planet.id];
      let changed = false;
      for (const building of state.surfaceBuildings) {
        if (building.planetId !== planet.id ||
            (building.type !== 'surface_port' && building.type !== 'oil_platform')) continue;
        const marineNodeIds = new Set((network?.nodes || []).filter(node =>
          node.buildingId === building.id && node.connectionMode === 'marine').map(node => node.id));
        const hasMarineRoute = (network?.segments || []).some(segment => segment.routeType === 'marine' &&
          (marineNodeIds.has(segment.from) || marineNodeIds.has(segment.to)));
        if (hasMarineRoute) continue;
        const dock = BuildingPlacement.resolveMarineDock(record.data, Config.terrain.textureScale,
          building, BuildingData.get(building.type));
        if (dock && (!building.waterPort || distance(building.waterPort, dock.point) > .01)) {
          building.waterPort = dock.point;
          changed = true;
        }
      }
      if (changed && state.level === 'surface' && state.planet?.id === planet.id) persist();
    }
    return record;
  }
  function refreshSettlements(planetId) {
    const network = state.roadNetworks[planetId];
    if (!network) return false;
    let found = null;
    for (const context of contexts.values()) {
      const planet = context.model.planets.find(candidate => candidate.id === planetId);
      if (planet) { found = { context, planet }; break; }
    }
    if (!found) return false;
    const record = prepareTerrain(found.planet, found.context);
    record.roadCostField ||= RoadCostField.createBase(record.data, Config.terrain.textureScale);
    const result = SettlementSimulation.grow(state.surfaceSettlements[planetId] || SettlementSimulation.create(planetId), {
      planetId, seed: found.planet.seed, network,
      buildings: state.surfaceBuildings.filter(building => building.planetId === planetId),
      baseField: record.roadCostField, terrain: record.data
    });
    state.surfaceSettlements[planetId] = result.settlement;
    if (result.changed) persist();
    return result.changed;
  }
  function globeView() { return globeCamera.view(W, H); }
  function terrainPointAtScreen(screenX, screenY, planet = state.planet, context = state.context) {
    if (!planet || !context) return null;
    const record = prepareTerrain(planet, context);
    const point = GlobeProjection.raycastTerrain(screenX, screenY, record.data, globeView(), activeGlobeStyle().relief);
    return point ? { x: point.x * Config.terrain.textureScale, y: point.y * Config.terrain.textureScale } : null;
  }
  function projectTerrainPoint(x, y, planet = state.planet, context = state.context, view = globeView()) {
    const record = prepareTerrain(planet, context);
    return GlobeProjection.projectSurfacePoint(x / Config.terrain.textureScale,
      y / Config.terrain.textureScale, record.data, view, activeGlobeStyle().relief);
  }
  function systemPlanetScreenPose() {
    if (!state.planet || !state.context) return null;
    const position = planetWorldPosition(state.planet, state.context), point = project(position.x, position.y);
    return { x: point.x, y: point.y,
      radiusPx: state.planet.radius * state.context.frame.scale * state.camera.zoom };
  }
  function globeTransitionForFrame(now) {
    const mode = globeCamera.transitionMode();
    if (state.level !== 'surface' && mode !== 'exit') return null;
    return globeCamera.transitionFrame(now, W, H, mode === 'exit' ? systemPlanetScreenPose() : null);
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
  function systemCameraAtPlanet(planet = state.planet) {
    if (!planet || !state.context) return systemCamera();
    const position = planetWorldPosition(planet, state.context);
    const radiusPx = clamp(Math.min(W, H) * .14, 44, 70);
    const zoom = radiusPx / Math.max(1e-9, planet.radius * state.context.frame.scale);
    return { x: position.x, y: position.y, zoom };
  }
  function homeCamera() {
    if (state.level === 'galaxy') return { x: home.x - 200, y: home.y - 160, zoom: Math.max(.09, fitZoom(1900)) };
    if (state.level === 'system') return systemCamera();
    return { ...state.camera };
  }
  function resetCamera(immediate = false) { const cam = homeCamera(); focusCamera(cam.x, cam.y, cam.zoom, immediate); }


  function regenerate(seed, restoring = null) {
    if (factoryEditor.isOpen()) factoryEditor.close();
    state.seed = normalizedSeed(seed); galaxy = World.createGalaxy(state.seed);
    home = galaxy.systems.find(s => s.id === galaxy.homeId);
    state.simulation = Simulation.create(); state.exploration = Exploration.create(home);
    state.inventory = Inventory.create(ResourceData.startingInventory);
    state.level = 'galaxy'; state.system = null; state.planet = null; state.selected = null;
    state.context = null; state.tracking = null; state.focusPlanet = null;
    state.surfaceBuildings = []; state.roadNetworks = {}; state.surfaceSettlements = {}; state.factoryPlans = {};
    state.colonyMaterials = [];
    state.industryAccumulator = 0;
    state.orbitalLogistics = globalThis.OrbitOrbitalTransit.createState();
    state.placement = null; state.buildMenuOpen = false; nextBuildingId = 1;
    state.roadPreview = null;
    cancelRoadDrag();
    state.tool = 'pan';
    terrainData = null; globeCamera.clearTransition(); globeCamera.reset();
    contexts.clear();
    const restored = Save.restore(state, galaxy, restoring, performance.now());
    nextBuildingId = state.surfaceBuildings.reduce((next, building) => {
      const suffix = Number(building.id.match(/-(\d+)$/)?.[1]);
      return Number.isFinite(suffix) ? Math.max(next, suffix + 1) : next;
    }, 1);
    renderer.prepareGalaxy(galaxy, state.seed);
    const view = restored ? restoring?.view : null;
    const validCamera = camera => camera && Number.isFinite(camera.x) && Number.isFinite(camera.y) &&
      Number.isFinite(camera.zoom) && camera.zoom >= Config.camera.minZoom && camera.zoom <= Config.camera.maxZoom;
    let cameraRestored = false;
    if (validCamera(view?.camera)) {
      state.camera = { ...view.camera };
      state.target = validCamera(view.target) ? { ...view.target } : { ...state.camera };
      cameraRestored = true;
      const star = galaxy.systems.find(system => system.id === view.contextStarId && (system.discovered || state.reveal));
      if (star) {
        state.context = prepareSystem(star); state.system = state.context.model;
        const planet = state.context.model.planets.find(item => item.id === view.planetId);
        if (planet) state.focusPlanet = planet;
        const trackingPlanet = state.context.model.planets.find(item => item.id === view.trackingPlanetId && item.kind !== 'gazeuse');
        if (trackingPlanet) {
          state.focusPlanet = trackingPlanet;
          state.tracking = { planet: trackingPlanet, context: state.context,
            position: planetWorldPosition(trackingPlanet, state.context) };
        }
      }
    }
    if (!cameraRestored) focusCamera(home.x * .25, home.y * .3, Math.max(.045, fitZoom(6600)), true);
    $('seed-input').value = state.seed;
    $('inspector').hidden = true; updateUI(); persist();
  }

  function updateSceneContext() {
    if (!galaxy) return;
    const previousLevel = state.level, previousContext = state.context;
    if (state.tracking) state.context = state.tracking.context;
    if (state.camera.zoom >= .7 && !state.tracking && !cameraMoving()) {
      const known = galaxy.systems.filter(s => s.discovered || state.reveal);
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
        const selectedPlanet = context.model.planets.some(planet => planet.id === state.selected?.id) ? state.selected : null;
        const candidates = context.model.planets.filter(p => p.kind !== 'gazeuse');
        const nearest = [...candidates].sort((a, b) => distance(planetWorldPosition(a, context), state.camera) - distance(planetWorldPosition(b, context), state.camera))[0];
        let planet = state.tracking?.planet || selectedPlanet || state.focusPlanet || nearest;
        if (planet && !context.model.planets.some(p => p.id === planet.id)) planet = nearest;
        const isVisible = p => {
          const position = planetWorldPosition(p, context), point = project(position.x, position.y), r = p.radius * localZoom;
          return point.x + r >= 0 && point.x - r <= W && point.y + r >= 0 && point.y - r <= H;
        };
        if (nearest && planet && !isVisible(planet) && isVisible(nearest)) planet = nearest;
        if (planet && planet.kind !== 'gazeuse') {
          const pp = planetWorldPosition(planet, context), point = project(pp.x, pp.y), r = planet.radius * localZoom;
          const visible = point.x + r >= 0 && point.x - r <= W && point.y + r >= 0 && point.y - r <= H;
          if (visible && r > 18) {
            state.focusPlanet = planet; prepareTerrain(planet, context);
            if (r > 45) followPlanet(planet, context);
            if (r >= 80) {
              state.level = 'surface'; state.planet = planet;
              terrainData = prepareTerrain(planet, context).data;
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
      if (state.level === 'surface' && state.planet) {
        const position = planetWorldPosition(state.planet), point = project(position.x, position.y);
        const radius = state.planet.radius * state.context.frame.scale * state.camera.zoom;
        globeCamera.beginEnter(point, radius, W, H, performance.now());
      } else if (previousLevel === 'surface' && state.level !== 'surface') {
        if (globeCamera.transitionMode() !== 'exit') globeCamera.beginExit(W, H, performance.now());
      } else globeCamera.clearTransition();
      state.selected = null; state.tool = 'pan'; state.placement = null; state.buildMenuOpen = false;
      cancelRoadDrag();
      if (state.level === 'surface' && state.planet) refreshSettlements(state.planet.id);
      $('inspector').hidden = true; $('toast').classList.remove('visible'); updateUI();
    }
  }

  function renderUniverse(now) {
    const cam = state.camera;
    let visibleContexts = [];
    if (state.level !== 'surface' && cam.zoom >= .7) {
      const visibleStars = galaxy.systems.filter(s => s.discovered || state.reveal)
        .filter(s => { const p = project(s.x, s.y); const padding = 18 * cam.zoom; return p.x > -padding && p.x < W + padding && p.y > -padding && p.y < H + padding; })
        .sort((a, b) => distance(a, cam) - distance(b, cam)).slice(0, 12);
      if (state.context && !visibleStars.some(s => s.id === state.context.star.id)) visibleStars.push(state.context.star);
      visibleContexts = visibleStars.map(prepareSystem);
    }
    const transitionMode = globeCamera.transitionMode();
    const globeActive = state.level === 'surface' || transitionMode === 'exit';
    const activeTerrain = globeActive && state.planet ? prepareTerrain(state.planet).data : null;
    terrainData = activeTerrain || terrainData;
    const globeTransition = globeActive ? globeTransitionForFrame(now) : null;
    renderer.render({ state, galaxy, home, contexts, visibleContexts, now,
      terrainData: activeTerrain, globeView: globeView(), globeTransition,
      globeStyle: activeGlobeStyle(), globePlanet: activeGlobePlanet() });
    if (state.level !== 'surface' && globeTransition?.mode === 'exit' && !globeTransition.active) globeCamera.clearTransition();
  }

  function findBuildableScreenPosition(type, minSpacingPx = 0, nearBuildingId = null, maxTerrainDistance = Infinity) {
    if (state.level !== 'surface' || !state.planet || !terrainData) return null;
    const definition = BuildingData.get(type);
    if (!definition) return null;
    const view = globeView(), radius = view.radiusPx * .86, step = 16;
    const nearBuilding = nearBuildingId && state.surfaceBuildings.find(building => building.id === nearBuildingId);
    const anchor = nearBuilding ? projectTerrainPoint(nearBuilding.x, nearBuilding.y) : { x: W / 2, y: H / 2 };
    const candidates = [];
    for (let y = Math.max(90, H / 2 - radius); y <= Math.min(H - 100, H / 2 + radius); y += step) {
      for (let x = Math.max(28, W / 2 - radius); x <= Math.min(W - 28, W / 2 + radius); x += step) {
        const dx = x - W / 2, dy = y - H / 2, distanceFromCenter = Math.hypot(dx, dy);
        if (distanceFromCenter > radius) continue;
        candidates.push({ x, y, distanceFromCenter });
      }
    }
    candidates.sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) -
      Math.hypot(b.x - anchor.x, b.y - anchor.y));
    for (const candidate of candidates) {
      const position = terrainPointAtScreen(candidate.x, candidate.y);
      if (!position) continue;
      if (nearBuilding && distance(position, nearBuilding) > maxTerrainDistance) continue;
      const validation = BuildingPlacement.validate({ terrain: terrainData,
        textureScale: Config.terrain.textureScale, definition, position,
        planetId: state.planet.id, buildings: state.surfaceBuildings });
      if (!validation.valid) continue;
      const tooClose = state.surfaceBuildings.some(building => {
        if (building.planetId !== state.planet.id) return false;
        const point = projectTerrainPoint(building.x, building.y);
        return point.visible && Math.hypot(point.x - candidate.x, point.y - candidate.y) < minSpacingPx;
      });
      if (!tooClose) return { x: candidate.x, y: candidate.y, mapX: position.x, mapY: position.y,
        type, resourceId: validation.resourceId || null };
    }
    return null;
  }

  function clearSelection() {
    cancelRoadDrag();
    state.selected = null; state.tool = 'pan'; state.placement = null; state.buildMenuOpen = false;
    $('inspector').hidden = true; $('toast').classList.remove('visible');
  }
  function updateBuildingPreview(screenX, screenY, type = state.placement?.type) {
    if (state.level !== 'surface' || !state.planet || !terrainData) return;
    const definition = BuildingData.get(type);
    if (!definition) return;
    const point = terrainPointAtScreen(screenX, screenY);
    if (!point) { state.placement = null; return; }
    const position = point;
    const validation = BuildingPlacement.validate({ terrain: terrainData,
      textureScale: Config.terrain.textureScale, definition, position, planetId: state.planet.id,
      buildings: state.surfaceBuildings });
    state.placement = { type, ...position, rotation: 0, ...validation };
  }
  function placeSurfaceBuilding() {
    const preview = state.placement;
    if (!preview?.valid) {
      toast(preview?.reason || 'Choisissez un emplacement valide sur la planète.');
      return;
    }
    const definition = BuildingData.get(preview.type);
    const building = BuildingModel.create({ id: `${preview.type}-${state.planet.id}-${nextBuildingId++}`,
      type: preview.type, planetId: state.planet.id, x: preview.x, y: preview.y, rotation: preview.rotation,
      resourceId: preview.resourceId, depositAbundance: preview.depositAbundance, waterPort: preview.waterPort,
      constructionState: 'planned', constructionProgress: 0, status: 'planned' });
    const construction = Construction.start(building, state.inventory);
    if (!construction.started) {
      const shortage = construction.missing?.map(item => `${resourceName(item.id)} ${formatAmount(item.amount)}`).join(' · ');
      toast(shortage ? `Ressources insuffisantes : ${shortage}.` : 'Construction impossible pour le moment.');
      updateUI(); return;
    }
    state.surfaceBuildings.push(building);
    state.placement = null; state.tool = 'pan'; state.buildMenuOpen = false;
    const routeHint = definition.roadRequired ? ' Tracez une route manuellement pour le relier.' : '';
    toast(`${definition.label} posé. Assemblage en cours.${routeHint}`); updateUI(); persist();
  }
  function chooseBuilding(type) {
    const definition = BuildingData.get(type);
    if (!definition || state.level !== 'surface') return;
    const shortage = Inventory.missing(state.inventory, definition.cost || {});
    if (shortage === null || shortage.length) {
      const details = shortage?.map(item => `${resourceName(item.id)} ${formatAmount(item.amount)}`).join(' · ');
      toast(details ? `Ressources insuffisantes : ${details}.` : 'Coût de construction invalide.');
      return;
    }
    cancelRoadDrag();
    state.buildMenuOpen = false; state.tool = 'build'; state.selected = null;
    $('inspector').hidden = true;
    updateBuildingPreview(W / 2, H / 2, type);
    toast(`Déplacez l’aperçu de ${definition.label} et touchez pour le poser.`);
    updateUI();
  }
  function selectSurfaceBuilding(building) {
    cancelRoadDrag();
    state.tool = 'pan'; state.placement = null; state.buildMenuOpen = false;
    state.selected = { kind: 'building', ...building };
    hud.showSelection(state.selected, { state }); updateUI();
  }
  function demolishSelectedBuilding() {
    const building = state.selected?.kind === 'building'
      ? state.surfaceBuildings.find(candidate => candidate.id === state.selected.id) : null;
    if (!building) return;
    const refund = Construction.demolish(building, state.inventory);
    if (refund === null) return;
    for (const network of Object.values(state.roadNetworks)) RoadNetwork.detachBuilding(network, building.id);
    state.surfaceBuildings = state.surfaceBuildings.filter(candidate => candidate.id !== building.id);
    globalThis.OrbitIndustry.reclaimBuilding(state, building);
    state.selected = null; $('inspector').hidden = true;
    toast(`${BuildingData.get(building.type)?.label || 'Bâtiment'} démoli. Récupéré : ${amountSummary(refund)}.`);
    updateUI(); persist();
  }
  function nearestSettlementConnection(settlement, position) {
    let best = null;
    for (const road of settlement?.roads || []) {
      let remaining = Number.isFinite(road.builtLength) ? Math.min(road.length, road.builtLength) : road.length;
      let travelled = 0;
      for (let edgeIndex = 1; edgeIndex < road.points.length && remaining > 1e-7; edgeIndex++) {
        const a = road.points[edgeIndex - 1], b = road.points[edgeIndex];
        const dx = b.x - a.x, dy = b.y - a.y, edgeLength = Math.hypot(dx, dy);
        if (edgeLength <= 1e-9) continue;
        const builtRatio = Math.min(1, remaining / edgeLength);
        const builtX = dx * builtRatio, builtY = dy * builtRatio, lengthSquared = builtX * builtX + builtY * builtY;
        const t = lengthSquared ? Math.max(0, Math.min(1,
          ((position.x - a.x) * builtX + (position.y - a.y) * builtY) / lengthSquared)) : 0;
        const point = { x: a.x + builtX * t, y: a.y + builtY * t };
        const candidate = { road, point, distance: distance(position, point),
          roadDistance: travelled + edgeLength * builtRatio * t };
        if (!best || candidate.distance < best.distance) best = candidate;
        remaining -= edgeLength * builtRatio;
        travelled += edgeLength;
      }
    }
    return best;
  }

  function roadEndpointAt(screenX, screenY, from = null) {
    if (state.level !== 'surface' || !state.planet || !terrainData) return null;
    const network = state.roadNetworks[state.planet.id];
    const radius = RoadPlacement.config.interaction.roadSnapRadiusPx;
    const originBuilding = from?.kind === 'building'
      ? state.surfaceBuildings.find(candidate => candidate.id === from.buildingId) : null;
    const platformRequiresPort = originBuilding?.type === 'oil_platform';
    const position = terrainPointAtScreen(screenX, screenY);
    if (!position) return null;
    const marineConnection = network?.segments.length
      ? RoadNetwork.nearestBuiltConnection(network, position, candidate => candidate.kind === 'segment' &&
        (candidate.segment.routeType === 'marine' ||
          (candidate.segment.surfaceTypes?.length > 0 && candidate.segment.surfaceTypes.every(Boolean))))
      : null;
    let marineRouteHit = false;
    if (marineConnection) {
      const point = projectTerrainPoint(marineConnection.point.x, marineConnection.point.y);
      marineRouteHit = Math.hypot(point.x - screenX, point.y - screenY) <= radius;
    }

    // The sea-side marker sits outside the port sprite's hit box. Treat either
    // visible connector as a building target so a platform can snap to it.
    let connectorTarget = null;
    for (const candidate of [...state.surfaceBuildings].reverse()) {
      if (candidate.planetId !== state.planet.id ||
          (platformRequiresPort && candidate.type !== 'surface_port') ||
          (marineRouteHit && candidate.type !== 'surface_port' && candidate.type !== 'oil_platform')) continue;
      const points = (platformRequiresPort ? [candidate.waterPort] :
        [candidate.roadPort, candidate.waterPort]).filter(Boolean);
      for (const point of points) {
        const screenPoint = projectTerrainPoint(point.x, point.y);
        const screenDistance = Math.hypot(screenPoint.x - screenX, screenPoint.y - screenY);
        if (screenDistance <= Math.min(radius, 12) &&
            (!connectorTarget || screenDistance < connectorTarget.screenDistance)) {
          connectorTarget = { building: candidate, point, screenDistance };
        }
      }
    }
    if (connectorTarget) return { kind: 'building', buildingId: connectorTarget.building.id,
      point: { ...connectorTarget.point } };

    const building = [...state.surfaceBuildings].reverse().find(candidate => {
      if (candidate.planetId !== state.planet.id) return false;
      if (platformRequiresPort && candidate.type !== 'surface_port') return false;
      if (marineRouteHit && candidate.type !== 'surface_port' && candidate.type !== 'oil_platform') return false;
      const definition = BuildingData.get(candidate.type);
      if (!(definition?.roadRequired || candidate.type === 'oil_platform')) return false;
      const point = projectTerrainPoint(candidate.x, candidate.y);
      return point.visible && Math.hypot(point.x - screenX, point.y - screenY) <= GlobeStyle.icon.hitRadiusPx;
    });
    if (building) return { kind: 'building', buildingId: building.id,
      point: { ...(building.roadPort || building.waterPort || { x: building.x, y: building.y }) } };
    // Marine paths are not road junctions, even if they overlap a land route.
    if (marineRouteHit) return null;
    // A platform can only begin a maritime route to a surface port.
    if (platformRequiresPort) return null;

    let closest = null;
    function consider(endpoint) {
      const screenPoint = projectTerrainPoint(endpoint.point.x, endpoint.point.y);
      const screenDistance = Math.hypot(screenPoint.x - screenX, screenPoint.y - screenY);
      if (screenDistance <= radius && (!closest || screenDistance < closest.screenDistance)) {
        closest = { ...endpoint, screenDistance };
      }
    }
    if (network?.nodes.length) {
      const connection = RoadNetwork.nearestBuiltConnection(network, position, candidate =>
        candidate.kind === 'node' ? candidate.node.connectionMode !== 'marine' : candidate.segment.routeType !== 'marine');
      if (connection) {
        const target = connection.kind === 'node'
          ? { kind: 'node', id: connection.id }
          : { kind: 'segment', id: connection.id, edgeIndex: connection.edgeIndex, t: connection.t };
        consider({ kind: 'road', point: { ...connection.point }, connection: target });
      }
    }
    const settlementConnection = nearestSettlementConnection(state.surfaceSettlements[state.planet.id], position);
    if (globeCamera.snapshot().zoom >= globalThis.OrbitSettlementConfig.interaction.roadSnapMinZoom && settlementConnection) {
      consider({ kind: 'settlement', point: settlementConnection.point,
        connection: { kind: 'settlement', id: settlementConnection.road.id,
          roadDistance: settlementConnection.roadDistance } });
    }
    if (!closest) return null;
    return { kind: closest.kind, point: { ...closest.point }, connection: closest.connection };
  }

  function roadRouteParameters(from, to) {
    const planetId = state.planet.id, network = state.roadNetworks[planetId] || RoadNetwork.create(planetId);
    const record = prepareTerrain(state.planet);
    record.roadCostField ||= RoadCostField.createBase(record.data, Config.terrain.textureScale);
    return { planetId, network, from, to, terrain: record.data,
      baseField: record.roadCostField, buildings: state.surfaceBuildings };
  }

  function roadTerrainPointAt(screenX, screenY) {
    return terrainPointAtScreen(screenX, screenY);
  }

  function updateRoadPreview(screenX, screenY, force = false) {
    if (!roadDrag || state.level !== 'surface') return;
    const now = performance.now();
    if (!force && now - roadDrag.lastPreviewAt < RoadPlacement.config.interaction.previewIntervalMs) return;
    roadDrag.lastPreviewAt = now;
    const target = roadEndpointAt(screenX, screenY, roadDrag.from);
    roadDrag.target = target;
    if (target) {
      const preview = RoadPlacement.previewBetween(roadRouteParameters(roadDrag.from, target));
      state.roadPreview = preview.connected
        ? { points: preview.points, surfaceTypes: preview.surfaceTypes, valid: true, snapped: true,
          routeType: preview.routeType,
          opacity: preview.routeType === 'marine' ? RoadPlacement.config.render.marineOpacity : RoadPlacement.config.interaction.previewOpacity,
          fromPoint: roadDrag.from.point, toPoint: target.point }
        : { points: [roadDrag.from.point, target.point], surfaceTypes: [], valid: false, snapped: true,
          opacity: RoadPlacement.config.interaction.freePreviewOpacity,
          lineWidth: RoadPlacement.config.interaction.freePreviewWidthPx,
          dash: RoadPlacement.config.interaction.freePreviewDashPx, waterOpacity: 1,
          color: RoadPlacement.config.interaction.freePreviewColor,
          fromPoint: roadDrag.from.point, toPoint: target.point, reason: preview.reason };
      roadDrag.preview = preview;
      return;
    }

    const point = roadTerrainPointAt(screenX, screenY);
    if (!point) { state.roadPreview = null; roadDrag.preview = null; roadDrag.target = null; return; }
    state.roadPreview = {
      points: [roadDrag.from.point, point],
      surfaceTypes: [],
      valid: false, snapped: false, committable: false,
      opacity: RoadPlacement.config.interaction.freePreviewOpacity,
      lineWidth: RoadPlacement.config.interaction.freePreviewWidthPx,
      dash: RoadPlacement.config.interaction.freePreviewDashPx,
      waterOpacity: 1,
      color: RoadPlacement.config.interaction.freePreviewColor,
      fromPoint: roadDrag.from.point, toPoint: point
    };
    roadDrag.preview = null;
  }

  function finishRoadDrag(screenX, screenY, cancelled = false) {
    const drag = roadDrag;
    cancelRoadDrag();
    if (!drag || cancelled || !pointerMoved) { updateUI(); return; }
    const target = roadEndpointAt(screenX, screenY, drag.from);
    if (!target) { toast('Relâchez sur un bâtiment ou sur une route existante.'); updateUI(); return; }
    const params = roadRouteParameters(drag.from, target);
    const preview = RoadPlacement.previewBetween(params);
    if (!preview.connected) { toast(preview.reason); updateUI(); return; }
    const result = RoadPlacement.createBetween({ ...params, preview });
    if (!result.connected) { toast(result.reason); updateUI(); return; }
    state.roadNetworks[params.planetId] = params.network;
    toast('Route ajoutée. Sa construction commence progressivement.');
    updateUI(); persist();
  }
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
    const selectedPlanet = state.system.planets.find(item => item.id === state.selected?.id);
    const planet = selectedPlanet || state.system.planets.find(p => p.kind !== 'gazeuse');
    if (!planet) { toast('Aucun monde à surface solide dans ce système.'); return; }
    if (planet.kind === 'gazeuse') { toast('Cette géante gazeuse ne possède pas de surface solide.'); return; }
    prepareTerrain(planet); state.focusPlanet = planet; state.planet = planet; followPlanet(planet);
    refreshSettlements(planet.id);
    clearSelection();
    const position = planetWorldPosition(planet), radius = planet.radius * state.context.frame.scale;
    focusCamera(position.x, position.y, 130 / Math.max(1e-9, radius));
    persist();
  }
  function back() {
    if (state.level === 'surface') {
      if (globeCamera.transitionMode() !== 'exit') globeCamera.beginExit(W, H, performance.now());
      clearSelection(); state.tracking = null; state.focusPlanet = state.planet;
      const camera = systemCameraAtPlanet();
      focusCamera(camera.x, camera.y, camera.zoom);
    } else if (state.level === 'system') {
      clearSelection(); state.tracking = null;
      const star = state.context.star; state.focusPlanet = null;
      focusCamera(star.x - 200, star.y - 160, Math.max(.09, fitZoom(1900)));
    } else { clearSelection(); state.tracking = null; overview(); }
    persist();
  }
  function overview() {
    clearSelection(); state.tracking = null;
    if (state.level === 'galaxy') focusCamera(0, 0, fitZoom(11200));
    else if (state.level === 'system') {
      const camera = systemCamera();
      focusCamera(camera.x, camera.y, camera.zoom);
    } else {
      globeCamera.reset(); updateUI();
    }
    persist();
  }
  function focusHome() {
    if (state.level === 'galaxy') { state.context = prepareSystem(home); state.tracking = null; select(home); resetCamera(); }
    else if (state.level === 'system') { state.tracking = null; state.focusPlanet = null; resetCamera(); }
    else { globeCamera.reset(); updateUI(); }
    persist();
  }

  function select(item) {
    state.selected = item;
    if (state.level === 'system' && state.system?.planets.some(planet => planet.id === item.id)) state.focusPlanet = item;
    const systemModel = state.level === 'galaxy' ? prepareSystem(item).model : state.system;
    hud.showSelection(item, { state, systemModel }); updateUI();
  }
  function scanAt(point) {
    const from = state.selected && !state.selected.surfacePoint ? state.selected : home;
    Exploration.launch(state.exploration, from, point, performance.now());
    toast('Sonde en route. Relevé du secteur en cours.'); state.tool = 'pan'; updateUI(); persist();
  }
  function completeMissions(now) {
    for (const result of Exploration.advance(state.exploration, galaxy, now)) {
      const count = result.discoveredCount;
      toast(count ? `${count} systèmes détectés. Secteur cartographié.` : 'Secteur cartographié. Aucun nouveau système détecté.');
      persist(); updateUI();
    }
  }
  function updateUI() {
    let scaleCamera = state.level === 'galaxy' ? state.camera : state.level === 'system' ? localCamera(state.context.frame) : null;
    if (state.level === 'surface' && state.planet) {
      const record = prepareTerrain(state.planet), radiusPx = globeView().radiusPx;
      scaleCamera = { zoom: radiusPx * Math.PI * 2 /
        Math.max(1, record.data.width * Config.terrain.textureScale) };
    }
    const buildingPosition = state.selected?.kind === 'building' && state.level === 'surface'
      ? projectTerrainPoint(state.selected.x, state.selected.y) : null;
    hud.update({ state, galaxy, terrainData, width: W, scaleCamera, buildingPosition });
  }

  function clickMap(x, y, doubleClick = false) {
    if ($('menu-dialog').open) return;
    if (state.tool === 'road') return;
    const point = unproject(x, y);
    if (state.level === 'galaxy') {
      if (state.tool === 'scan') { scanAt(point); return; }
      const candidates = galaxy.systems.filter(s => s.discovered || state.reveal);
      let best = null, bestDistance = 18;
      for (const star of candidates) { const p = project(star.x, star.y), d = Math.hypot(p.x - x, p.y - y); if (d < bestDistance) { best = star; bestDistance = d; } }
      if (best) { select(best); if (doubleClick) enterSystem(); }
      else { $('inspector').hidden = true; state.selected = null; }
    } else if (state.level === 'system') {
      let best = null, bestDistance = 24;
      const ark = state.system?.ark;
      if (ark) {
        const position = globalThis.OrbitOrbitalTransit.arkPosition(ark, state.system.star, state.simulation.time);
        const worldPosition = Camera.worldPoint(state.context.frame, position), pointOnScreen = project(worldPosition.x, worldPosition.y);
        const separation = Math.hypot(pointOnScreen.x - x, pointOnScreen.y - y);
        if (separation < bestDistance) { best = ark; bestDistance = separation; }
      }
      for (const planet of state.system.planets) {
        const pos = planetWorldPosition(planet), p = project(pos.x, pos.y), d = Math.hypot(p.x - x, p.y - y);
        if (d < bestDistance) { best = planet; bestDistance = d; }
      }
      if (best) { select(best); if (doubleClick && best.kind !== 'orbital-hub') enterPlanet(); }
      else { $('inspector').hidden = true; state.selected = null; }
    } else {
      if (state.buildMenuOpen) { state.buildMenuOpen = false; updateUI(); }
      const terrainPoint = terrainPointAtScreen(x, y);
      if (!terrainPoint) return;
      if (state.tool === 'build') {
        updateBuildingPreview(x, y); placeSurfaceBuilding(); return;
      }
      const tx = Math.floor(terrainPoint.x / Config.terrain.textureScale), ty = Math.floor(terrainPoint.y / Config.terrain.textureScale);
      if (tx < 0 || ty < 0 || tx >= terrainData.width || ty >= terrainData.height) return;
      const building = renderer.hitTestGlobeBuilding(state.surfaceBuildings, state.planet.id,
        terrainData, globeView(), x, y, activeGlobeStyle());
      if (building) { selectSurfaceBuilding(building); return; }
      const height = terrainData.elevation[ty * terrainData.width + tx], altitude = Math.round((height - terrainData.seaLevel) * 35);
      const names = height < 100 ? 'Zone océanique' : height < 109 ? 'Littoral' : height < 143 ? 'Plaine continentale' : height < 183 ? 'Plateau rocheux' : 'Massif montagneux';
      const nearest = terrainData.resources.find(resource => Math.hypot(resource.x - tx, resource.y - ty) < 10);
      select({ surfacePoint: true, x: terrainPoint.x, y: terrainPoint.y, altitude, name: names,
        info: nearest ? `Gisement détecté : ${nearest.type}. Les courbes de niveau indiquent la pente du terrain.` : 'Le relief, les côtes et les ressources composent une surface générée pour ce monde.' });
    }
  }
  function zoomAt(factor, x = W / 2, y = H / 2) {
    if (state.level === 'surface') {
      const result = globeCamera.zoomBy(factor);
      if (result.crossedMinimum) back();
      updateUI(); persist(); return;
    }
    const before = unproject(x, y), [min, max] = zoomLimits(before);
    const z = clamp(state.camera.zoom * factor, min, max);
    state.target = Camera.anchoredZoom(state.camera, viewport, z, { x, y });
    state.camera = { ...state.target };
    updateSceneContext(); updateUI(); persist();
  }
  let lastTap = { t: 0, x: 0, y: 0 };
  function beginPinch() {
    const points = [...pointers.values()].slice(0, 2);
    if (points.length < 2) return;
    pinch = { distance: distance(points[0], points[1]),
      midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } };
    pointerMoved = true;
  }
  canvas.addEventListener('pointerdown', e => {
    if ($('menu-dialog').open) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pointerMoved = false;
    if (state.level === 'surface') {
      if (state.tool === 'road' && pointers.size === 1) {
        const from = roadEndpointAt(e.clientX, e.clientY);
        roadDrag = from ? { pointerId: e.pointerId, from,
          startScreen: { x: e.clientX, y: e.clientY }, lastPreviewAt: -Infinity, target: null, preview: null } : null;
      } else if (pointers.size > 1 && state.tool === 'road') cancelRoadDrag();
      if (pointers.size === 2) beginPinch();
      return;
    }
    if (state.tool === 'road') {
      if (pointers.size === 1) {
        const from = roadEndpointAt(e.clientX, e.clientY);
        roadDrag = from ? { pointerId: e.pointerId, from,
          startScreen: { x: e.clientX, y: e.clientY }, lastPreviewAt: -Infinity, target: null, preview: null } : null;
      } else {
        cancelRoadDrag(); pointerMoved = true;
        if (pointers.size === 2) beginPinch();
      }
      return;
    }
    if (state.tool === 'build' && pointers.size === 1) updateBuildingPreview(e.clientX, e.clientY);
    if (pointers.size === 2) beginPinch();
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) {
      if (state.tool === 'build') updateBuildingPreview(e.clientX, e.clientY);
      return;
    }
    const previous = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (state.level === 'surface') {
      if (pointers.size >= 2 && pinch) {
        const points = [...pointers.values()], nextDistance = distance(points[0], points[1]);
        const ratio = nextDistance / Math.max(1, pinch.distance);
        const result = globeCamera.zoomBy(ratio);
        pinch = { distance: nextDistance,
          midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } };
        pointerMoved = true;
        if (result.crossedMinimum) { pinch = null; back(); }
        else updateUI();
      } else if (pointers.size === 1 && state.tool === 'road' && roadDrag) {
        if (Math.hypot(e.clientX - roadDrag.startScreen.x, e.clientY - roadDrag.startScreen.y) > 5) pointerMoved = true;
        if (pointerMoved) updateRoadPreview(e.clientX, e.clientY);
      } else if (pointers.size === 1) {
        const dx = e.clientX - previous.x, dy = e.clientY - previous.y;
        if (Math.hypot(dx, dy) > 5) pointerMoved = true;
        if (pointerMoved) {
          globeCamera.rotateBy(dx, dy);
          if (state.tool === 'build') updateBuildingPreview(e.clientX, e.clientY);
          updateUI();
        }
      }
      return;
    }
    if (pointers.size >= 2 && pinch) {
      const points = [...pointers.values()], nextDistance = distance(points[0], points[1]);
      const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const before = unproject(pinch.midpoint.x, pinch.midpoint.y), [min, max] = zoomLimits(before);
      const zoom = clamp(state.camera.zoom * nextDistance / Math.max(1, pinch.distance), min, max);
      state.target = Camera.anchoredZoom(state.camera, viewport, zoom, midpoint, pinch.midpoint);
      state.camera = { ...state.target }; pinch = { distance: nextDistance, midpoint }; pointerMoved = true;
      updateSceneContext(); updateUI();
    } else if (pointers.size === 1 && state.tool === 'build') {
      if (Math.hypot(e.clientX - previous.x, e.clientY - previous.y) > 5) pointerMoved = true;
      updateBuildingPreview(e.clientX, e.clientY);
    } else if (pointers.size === 1 && state.tool === 'road') {
      if (roadDrag && Math.hypot(e.clientX - roadDrag.startScreen.x, e.clientY - roadDrag.startScreen.y) > 5) pointerMoved = true;
      if (roadDrag && pointerMoved) updateRoadPreview(e.clientX, e.clientY);
    } else if (pointers.size === 1) {
      if (Math.hypot(e.clientX - previous.x, e.clientY - previous.y) > 5) pointerMoved = true;
      if (pointerMoved) {
        state.target = { ...state.camera, x: state.camera.x - (e.clientX - previous.x) / state.camera.zoom,
          y: state.camera.y - (e.clientY - previous.y) / state.camera.zoom };
        state.camera = { ...state.target }; updateSceneContext();
      }
    }
  });
  function release(e, cancelled = false) {
    if (!pointers.has(e.pointerId)) return;
    const wasPinch = pinch !== null;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (roadDrag?.pointerId === e.pointerId) {
      finishRoadDrag(e.clientX, e.clientY, cancelled);
      pointerMoved = true;
      return;
    }
    if (state.tool === 'road') { if (pointerMoved) persist(); pointerMoved = true; return; }
    if (!cancelled && !pointerMoved && !wasPinch) {
      const now = performance.now(), double = now - lastTap.t < 340 && Math.hypot(lastTap.x - e.clientX, lastTap.y - e.clientY) < 24;
      clickMap(e.clientX, e.clientY, double); lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    if (wasPinch) pointerMoved = true;
    if (pointerMoved) persist();
  }
  canvas.addEventListener('pointerup', e => release(e));
  canvas.addEventListener('pointercancel', e => release(e, true));
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  $('zoom-in').onclick = () => zoomAt(1.55); $('zoom-out').onclick = () => zoomAt(1 / 1.55);
  $('back-button').onclick = back; $('overview-button').onclick = overview; $('home-button').onclick = focusHome;
  $('pan-button').onclick = () => { cancelRoadDrag(); state.tool = 'pan'; state.placement = null; state.buildMenuOpen = false; updateUI(); };
  $('road-button').onclick = () => {
    if (state.level !== 'surface') return;
    cancelRoadDrag(); state.placement = null; state.buildMenuOpen = false;
    state.tool = state.tool === 'road' ? 'pan' : 'road'; state.selected = null;
    $('inspector').hidden = true;
    if (state.tool === 'road') toast('Glissez d’un bâtiment ou d’une route vers une autre extrémité.');
    updateUI();
  };
  $('build-button').onclick = () => {
    if (state.level !== 'surface') return;
    cancelRoadDrag();
    if (state.tool === 'build') { state.tool = 'pan'; state.placement = null; }
    else state.buildMenuOpen = !state.buildMenuOpen;
    if (state.buildMenuOpen) { state.tool = 'pan'; state.placement = null; state.selected = null; $('inspector').hidden = true; }
    updateUI();
  };
  $('build-menu-close').onclick = () => { state.buildMenuOpen = false; updateUI(); };
  $('build-options').addEventListener('click', event => {
    const option = event.target.closest('[data-building-type]');
    if (option) chooseBuilding(option.dataset.buildingType);
  });
  $('scan-button').onclick = () => { cancelRoadDrag(); state.tool = state.tool === 'scan' ? 'pan' : 'scan'; state.buildMenuOpen = false; $('inspector').hidden = true; updateUI(); if (state.tool === 'scan') toast('Touchez la carte pour envoyer une sonde.'); };
  $('close-inspector').onclick = () => { state.selected = null; $('inspector').hidden = true; updateUI(); };
  $('factory-edit-button').onclick = () => {
    const building = state.selected?.kind === 'building'
      ? state.surfaceBuildings.find(candidate => candidate.id === state.selected.id) : null;
    if (building) factoryEditor.open(building, globalThis.OrbitIndustry.ensureGraph(state, building));
  };
  $('factory-editor-close').onclick = () => factoryEditor.close();
  $('demolish-button').onclick = demolishSelectedBuilding;
  $('enter-button').onclick = () => {
    if (state.level === 'galaxy') enterSystem();
    else if (state.level === 'system') enterPlanet();
  };
  $('breadcrumb-galaxy').onclick = () => {
    if (state.level === 'galaxy') { overview(); return; }
    const star = state.context.star; state.tracking = null; state.focusPlanet = null; clearSelection();
    focusCamera(star.x - 200, star.y - 160, Math.max(.09, fitZoom(1900)));
  };
  $('breadcrumb-system').onclick = () => { if (state.level === 'surface') back(); };
  $('menu-button').onclick = () => { state.buildMenuOpen = false; updateUI(); $('continue-button').firstElementChild.textContent = 'Reprendre l’exploration'; $('menu-dialog').showModal(); };
  const fullscreenButton = $('fullscreen-button');
  const fullscreenMedia = typeof matchMedia === 'function' ? matchMedia('(display-mode: fullscreen), (display-mode: standalone)') : null;
  function standaloneDisplay() { return Boolean(navigator.standalone || fullscreenMedia?.matches); }
  function currentFullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function updateFullscreenButton() {
    const standalone = standaloneDisplay(), nativeFullscreen = Boolean(currentFullscreenElement());
    fullscreenButton.hidden = standalone && !nativeFullscreen;
    const active = standalone || nativeFullscreen;
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.setAttribute('aria-label', active ? 'Quitter le plein écran' : 'Passer en plein écran');
    fullscreenButton.title = active ? 'Quitter le plein écran' : 'Plein écran';
    fullscreenButton.innerHTML = active
      ? '<svg viewBox="0 0 24 24"><path d="M8 3v5H3m13-5v5h5M3 16h5v5m13-5h-5v5"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>';
  }
  fullscreenButton.onclick = async () => {
    const active = currentFullscreenElement();
    if (active) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) {
        try { await exit.call(document); } catch (_) { toast('La sortie du plein écran a échoué.'); }
      }
      return;
    }
    if (standaloneDisplay()) {
      toast('Le jeu est déjà lancé sans barre de navigateur.');
      return;
    }
    const request = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
    if (!request) {
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      toast(isIOS
        ? 'Dans Safari, choisissez Partager → Sur l’écran d’accueil, puis lancez le jeu depuis son icône pour masquer la barre.'
        : 'Le plein écran n’est pas disponible dans ce navigateur.');
      return;
    }
    try {
      await request.call(document.documentElement, { navigationUI: 'hide' });
    } catch (_) {
      try { await request.call(document.documentElement); }
      catch (_) { toast('Le navigateur a refusé le mode plein écran.'); }
    }
  };
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
  fullscreenMedia?.addEventListener?.('change', updateFullscreenButton);
  updateFullscreenButton();
  $('continue-button').onclick = () => {
    $('menu-dialog').close();
    if (storageWarningShown) toast('La sauvegarde locale est indisponible. Vérifiez les réglages de stockage du navigateur.');
    else if (!menuStarted) { menuStarted = true; toast('Zoomez sur Néréide pour explorer son système.'); }
  };
  $('reset-system-button').onclick = () => {
    regenerate(state.seed);
    $('continue-button').firstElementChild.textContent = 'Explorer cet univers';
    $('menu-dialog').close();
    toast(`Système réinitialisé avec la graine ${state.seed}.`);
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
    if (factoryEditor.isOpen()) {
      if (e.key === 'Escape') { factoryEditor.close(); e.preventDefault(); }
      return;
    }
    if (e.key === 'Escape') {
      if ($('terrain-diagnostics-dialog').open) { $('terrain-diagnostics-dialog').close(); return; }
      if ($('developer-dialog').open) { $('developer-dialog').close(); return; }
      if (!$('terrain-tuner-panel').hidden) { $('terrain-tuner-panel').hidden = true; return; }
      if ($('menu-dialog').open) $('menu-dialog').close();
      else if (state.buildMenuOpen) { state.buildMenuOpen = false; updateUI(); }
      else if (state.tool !== 'pan') { cancelRoadDrag(); state.tool = 'pan'; state.placement = null; updateUI(); }
      else if (!$('inspector').hidden) { $('inspector').hidden = true; state.selected = null; updateUI(); }
      else back();
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement ||
        $('menu-dialog').open || $('developer-dialog').open || $('terrain-diagnostics-dialog').open) return;
    if (e.key === '+' || e.key === '=') zoomAt(1.4);
    if (e.key === '-') zoomAt(1 / 1.4);
    if (e.key === ' ' && !$('menu-dialog').open) { e.preventDefault(); setPause(!state.paused); }
    if (e.key === 'Enter' && state.selected && !$('menu-dialog').open && !$('enter-button').hidden) $('enter-button').click();
    if (!$('menu-dialog').open && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      if (state.level === 'surface') {
        const step = 50;
        globeCamera.rotateBy(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
      } else {
        const step = 70 / state.target.zoom;
        state.target.x += e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        state.target.y += e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      }
    }
  });
  function resize() {
    W = innerWidth; H = innerHeight; DPR = Math.min(devicePixelRatio || 1, 3);
    viewport.width = W; viewport.height = H; renderer.resize(W, H, DPR);
    if (galaxy) updateUI();
  }
  addEventListener('resize', resize);
  addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { persist(); lastTime = 0; });

  function createOrbitalLogisticsFixture() {
    if (state.level !== 'surface' || !state.planet) throw new Error('Open a planetary surface before creating the logistics fixture');
    const width = terrainData.width * Config.terrain.textureScale, height = terrainData.height * Config.terrain.textureScale;
    const center = terrainPointAtScreen(W / 2, H / 2) || { x: width / 2, y: height / 2 };
    const centerX = clamp(center.x, 220, width - 240), centerY = clamp(center.y, 50, height - 50);
    const planetId = state.planet.id, suffix = `${planetId}-${Math.floor(state.simulation.time)}`;
    const source = BuildingModel.create({ id: `fixture-factory-${suffix}`, type: 'factory', planetId,
      x: centerX - 200, y: centerY, constructionState: 'complete', inventory: { iron: 77 }, dockStock: { raw_iron: 8 } });
    source.dockFlowByResource = { raw_iron: 4 };
    const platform = BuildingModel.create({ id: `fixture-platform-${suffix}`, type: 'launch_platform', planetId,
      x: centerX + 200, y: centerY, constructionState: 'complete' });
    state.factoryPlans ||= {};
    state.factoryPlans[source.id] = globalThis.OrbitProcessGraph.create({
      version: globalThis.OrbitProcessData.config.version, geology: { resourceId: 'iron' },
      machines: [{ id: 'fixture-furnace', type: 'reduction_furnace', x: 520, y: 700 },
        { id: 'fixture-output-dock', type: 'output_dock', x: 890, y: 700 }],
      connections: [{ id: 'fixture-link', fromMachineId: 'fixture-furnace', fromOutputId: 'raw_iron',
        toMachineId: 'fixture-output-dock', toInputId: 'material' }]
    });
    const network = RoadNetwork.create(planetId);
    const from = RoadNetwork.addNode(network, { x: source.x, y: source.y, buildingId: source.id });
    const to = RoadNetwork.addNode(network, { x: platform.x, y: platform.y, buildingId: platform.id });
    RoadNetwork.addSegment(network, { from: from.id, to: to.id,
      points: [{ x: source.x, y: source.y }, { x: platform.x, y: platform.y }], builtLength: 400 });
    state.surfaceBuildings.push(source, platform);
    state.roadNetworks[planetId] = network;
    updateUI(); persist();
    return { sourceId: source.id, platformId: platform.id };
  }

  function advanceOrbitalSimulationTo(time) {
    if (!Number.isFinite(time) || time < state.simulation.time) throw new RangeError('Target time must not precede simulation time');
    if (!state.paused) setPause(true);
    state.simulation.time = time;
    Logistics.advance(state, time, logisticsSystemModels(), true);
    updateUI(); persist();
    return time;
  }

  function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, Config.simulation.maxFrameSeconds) : 0; lastTime = now;
    const simulationDt = dt * (globalThis.OrbitDeveloperSettings?.get('simulationSpeed') || 1);
    Simulation.advance(state.simulation, simulationDt, !state.paused && !document.hidden);
    if (!state.paused && !document.hidden) {
      Construction.advance(state.surfaceBuildings, simulationDt, building => refreshSettlements(building.planetId));
      RoadConstruction.advance(state.roadNetworks, simulationDt, planetId => refreshSettlements(planetId));
      SettlementSimulation.advance(state.surfaceSettlements, simulationDt, refreshSettlements);
      globalThis.OrbitIndustry.advance(state, simulationDt);
    }
    Logistics.advance(state, state.simulation.time, logisticsSystemModels(), !state.paused && !document.hidden);
    if (state.tracking) {
      const follow = state.tracking, position = planetWorldPosition(follow.planet, follow.context);
      const dx = position.x - follow.position.x, dy = position.y - follow.position.y;
      state.camera.x += dx; state.camera.y += dy; state.target.x += dx; state.target.y += dy;
      follow.position = position;
    }
    completeMissions(now);
    state.camera = Camera.smooth(state.camera, state.target, dt, Config.camera.easingRate);
    updateSceneContext();
    renderUniverse(now);
    if (now - lastAutosave >= 3000) { persist(); lastAutosave = now; }
    factoryEditor.refreshProgress();
    if (now - lastHUD > 350) { updateUI(); factoryEditor.refresh(); lastHUD = now; }
    requestAnimationFrame(frame);
  }

  // A small inspection API supports browser checks without bypassing production paths.
  globalThis.OrbitalDebug = Object.freeze({
    getState: () => ({ level: state.level, seed: state.seed, selectedId: state.selected?.id || null,
      systemCount: galaxy.systems.length, discoveredCount: galaxy.systems.filter(s => s.discovered || state.reveal).length,
      planetCount: state.system?.planets.length || 0, zoom: state.camera.zoom, time: state.simulation.time,
      paused: state.paused,
      homeId: home.id, transitioning: false, moving: cameraMoving(), tool: state.tool,
      planetId: state.planet?.id || null, planetKind: state.planet?.kind || null,
      buildingCount: state.surfaceBuildings.length, missions: state.exploration.missions.length }),
    getPlanetGlobeMetrics: () => ({ camera: globeCamera.snapshot(), renderer: renderer.globeMetrics(),
      transition: globeCamera.transitionMode(), available: renderer.globeAvailable() }),
    findBuildableScreenPosition,
    getSurfaceResourceMetrics: () => {
      const record = state.planet && state.context?.terrains.get(state.planet.id);
      return record?.data?.resources?.map(resource => ({ id: resource.id, x: resource.x, y: resource.y,
        radius: resource.radius, marine: resource.marine })) || [];
    },
    focusHome, enterSystem, enterPlanet, back, regenerate, zoomAt,
    getCamera: () => ({ ...state.camera }),
    getHomeScreenPosition: () => project(home.x, home.y),
    getPlanetScreenPositions: () => (state.system?.planets || []).map(p => { const pos = planetWorldPosition(p); return { ...project(pos.x, pos.y),
      radiusPx: p.radius * state.context.frame.scale * state.camera.zoom, id: p.id, kind: p.kind }; }),
    getArkScreenPosition: () => {
      if (!state.system?.ark || !state.context) return null;
      const position = globalThis.OrbitOrbitalTransit.arkPosition(state.system.ark, state.system.star, state.simulation.time);
      const worldPosition = Camera.worldPoint(state.context.frame, position);
      return { ...project(worldPosition.x, worldPosition.y), id: state.system.ark.id };
    },
    getOrbitalLogistics: () => JSON.parse(JSON.stringify(state.orbitalLogistics)),
    getBuildingScreenPosition: id => {
      const building = state.surfaceBuildings.find(item => item.id === id);
      if (!building || !state.planet || building.planetId !== state.planet.id) return null;
      const point = projectTerrainPoint(building.x, building.y);
      return point.visible ? { x: point.x, y: point.y, id } : null;
    },
    getRoadNetworkMetrics: planetId => {
      const network = state.roadNetworks[planetId || state.planet?.id];
      return network ? { nodeCount: network.nodes.length, segmentCount: network.segments.length,
        builtLength: network.segments.reduce((sum, segment) => sum + Math.min(segment.length, segment.builtLength || 0), 0) } :
        { nodeCount: 0, segmentCount: 0, builtLength: 0 };
    },
    getSurfaceBuildings: () => state.surfaceBuildings.map(building => ({ id: building.id, type: building.type,
      planetId: building.planetId, x: building.x, y: building.y, constructionState: building.constructionState,
      constructionProgress: building.constructionProgress })),
    getOrbitalBuildingState: id => {
      const building = state.surfaceBuildings.find(item => item.id === id);
      return building ? { id: building.id, type: building.type, dockStock: { ...building.dockStock },
        launchStock: { ...building.launchStock }, inventory: { ...building.inventory },
        launchReceivedTotal: { ...building.launchReceivedTotal },
        dockDestinations: { ...building.dockDestinations }, exportEnabled: { ...building.exportEnabled } } : null;
    },
    createOrbitalLogisticsFixture,
    advanceOrbitalSimulationTo,
    scanAt, setPause
  });
  resize(); const previous = stored(); menuStarted = Boolean(previous);
  regenerate(previous?.seed ?? 'NEREIDE-01', previous);
  if (!previous) $('menu-dialog').showModal();
  requestAnimationFrame(frame);
})();
