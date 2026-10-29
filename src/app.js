(function () {
  'use strict';
  const World = globalThis.OrbitWorld, Config = globalThis.OrbitConfig;
  const Camera = globalThis.OrbitCamera, Simulation = globalThis.OrbitSimulation;
  const Exploration = globalThis.OrbitExploration, Save = globalThis.OrbitSave;
  const BuildingData = globalThis.OrbitBuildingData, BuildingModel = globalThis.OrbitSurfaceBuilding;
  const ResourceData = globalThis.OrbitResourceData, Inventory = globalThis.OrbitInventory;
  const BuildingPlacement = globalThis.OrbitBuildingPlacement, Construction = globalThis.OrbitConstruction;
  const Colony = globalThis.OrbitColony, ColonyZone = globalThis.OrbitColonyZone, Progression = globalThis.OrbitProgression;
  const RoadNetwork = globalThis.OrbitRoadNetwork, RoadCostField = globalThis.OrbitRoadCostField;
  const RoadConstruction = globalThis.OrbitRoadConstruction;
  const RoadPlacement = globalThis.OrbitRoadPlacement;
  const Logistics = globalThis.OrbitLogistics;
  const LogisticsNetwork = globalThis.OrbitLogisticsNetwork;
  const OrbitalLogisticsData = globalThis.OrbitOrbitalLogisticsData;
  const SurfaceStyle = globalThis.OrbitSurfaceStyle;
  const surfaceAspect = Config.terrain.width / Config.terrain.height;
  const $ = id => document.getElementById(id);
  const canvas = $('universe');
  const pointers = new Map();
  let pointerMoved = false;
  const renderer = globalThis.OrbitRenderer.create(canvas, {
    isCameraInteracting: () => pointers.size > 0 && pointerMoved
  });
  const hud = globalThis.OrbitHUD.create(document);
  globalThis.OrbitDeveloperTools.create(document);
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
    isCardAvailable: definition => Progression.cardUnlocked(state, definition),
    onAddCard(building, definition) {
      const payment = Construction.payCard(building, state.inventory, Construction.cardCost(definition));
      if (payment.paid) { updateUI(); persist(); }
      return payment;
    },
    onRemoveCard(building, definition) {
      Construction.refundCard(building, state.inventory, Construction.cardCost(definition));
      updateUI(); persist();
    },
    onDockDestinationChange(buildingId, resourceId, destinationId) {
      const building = state.surfaceBuildings.find(candidate => candidate.id === buildingId);
      if (!building || !Logistics.setDockDestination(building, resourceId, destinationId)) return false;
      return true;
    }
  });
  let galaxy, home, terrainTexture, terrainData;
  let nextBuildingId = 1;
  let W = innerWidth, H = innerHeight, DPR = Math.min(devicePixelRatio || 1, 2), lastTime = 0;
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
  function prepareTerrain(planet, context = state.context) {
    if (!context.terrains.has(planet.id)) {
      terrainData = World.createTerrain(planet.seed, Config.terrain.width, Config.terrain.height, planet);
      terrainTexture = renderer.createTerrainTexture(planet, terrainData);
      context.terrains.set(planet.id, { data: terrainData, texture: terrainTexture, roadCostField: null });
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
  function surfaceFrame(planet = state.planet, context = state.context) {
    const record = prepareTerrain(planet, context);
    const texture = record.texture;
    return Camera.surfaceFrame(planetWorldPosition(planet, context), planet.radius * context.frame.scale,
      { width: texture.logicalWidth || texture.width, height: texture.logicalHeight || texture.height });
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
    return surfaceCamera();
  }
  function surfaceCamera(planet = state.planet) {
    const record = prepareTerrain(planet);
    const width = record.texture.logicalWidth || record.texture.width;
    const height = record.texture.logicalHeight || record.texture.height;
    // Arriving on a planet, the 4:3 map exactly covers the screen in both
    // dimensions, portrait or landscape. Keep world proportions intact; pan
    // and pinch reach the part of the map cropped by the screen shape.
    const zoom = Math.max(W / width, H / height);
    return worldCamera(surfaceFrame(planet), { x: width / 2, y: height / 2, zoom });
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
    state.surfaceBuildings = []; state.roadNetworks = {}; state.factoryPlans = {};
    state.colonyMaterials = [];
    state.industryAccumulator = 0;
    state.contextPoints = 0; state.unlocks = Progression.restoreUnlocks(null);
    state.orbitalLogistics = globalThis.OrbitOrbitalTransit.createState();
    state.placement = null; state.buildMenuOpen = false; nextBuildingId = 1;
    state.roadPreview = null;
    cancelRoadDrag();
    state.tool = 'pan';
    terrainData = null; terrainTexture = null;
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
          return point.x + r * surfaceAspect >= 0 && point.x - r * surfaceAspect <= W && point.y + r >= 0 && point.y - r <= H;
        };
        if (nearest && planet && !isVisible(planet) && isVisible(nearest)) planet = nearest;
        if (planet && planet.kind !== 'gazeuse') {
          const pp = planetWorldPosition(planet, context), point = project(pp.x, pp.y), r = planet.radius * localZoom;
          const visible = point.x + r * surfaceAspect >= 0 && point.x - r * surfaceAspect <= W && point.y + r >= 0 && point.y - r <= H;
          if (visible && r > 18) {
            state.focusPlanet = planet; prepareTerrain(planet, context);
            if (r > 45) followPlanet(planet, context);
            if (r >= 80) {
              state.level = 'surface'; state.planet = planet;
              const record = prepareTerrain(planet, context); terrainTexture = record.texture; terrainData = record.data;
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
      state.selected = null; state.tool = 'pan'; state.placement = null; state.buildMenuOpen = false;
      cancelRoadDrag();
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
    renderer.render({ state, galaxy, home, contexts, visibleContexts, now });
  }

  function clearSelection() {
    cancelRoadDrag();
    state.selected = null; state.tool = 'pan'; state.placement = null; state.buildMenuOpen = false;
    $('inspector').hidden = true; $('toast').classList.remove('visible');
  }
  function updateBuildingPreview(screenX, screenY, type = state.placement?.type) {
    if (state.level !== 'surface' || !state.planet || !terrainData || !terrainTexture) return;
    const definition = BuildingData.get(type);
    if (!definition) return;
    const frame = surfaceFrame(), worldPoint = unproject(screenX, screenY);
    const position = { x: (worldPoint.x - frame.x) / frame.scale, y: (worldPoint.y - frame.y) / frame.scale };
    const validation = BuildingPlacement.validate({ terrain: terrainData,
      textureScale: Config.terrain.textureScale, definition, position, planetId: state.planet.id,
      buildings: state.surfaceBuildings });
    state.placement = { type, ...position, rotation: 0, ...validation,
      groundText: siteReadout({ type, ...position, ...validation }) };
  }
  // The text under a beacon being placed or selected: the ore a drill drains,
  // the water a station pumps, the latitude and launch power of a platform.
  function siteReadout(building) {
    if (building.type === 'launch_platform') {
      const latitude = OrbitalLogisticsData.latitudeAt(building.y, Config.terrain.height * Config.terrain.textureScale);
      const rounded = Math.round(Math.abs(latitude));
      return `Latitude ${rounded}°${rounded ? (latitude > 0 ? ' N' : ' S') : ''} · lancement ≈ ${formatAmount(
        Math.round(OrbitalLogisticsData.launchEnergyMW(latitude) * 10) / 10)} MW`;
    }
    if (building.type === 'water_station' && building.resourceId) {
      return building.resourceId === 'salt_water' ? 'Eau salée · mer' : 'Eau douce · lac ou rivière';
    }
    return building.composition ? groundReadout(building.composition) : null;
  }
  // The ores a drill would drain, shown under its beacon: "Fer ≈ 30 % · Silice ≈ 10 %".
  function groundReadout(composition) {
    const text = hud.compositionText({ ...composition, rock: 0 }, 3);
    return text === 'Inconnue' ? 'Roche seule' : text;
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
      resourceId: preview.resourceId, resourceShare: preview.resourceShare, composition: preview.composition,
      waterPort: preview.waterPort,
      constructionState: 'planned', constructionProgress: 0, status: 'planned' });
    const construction = Construction.start(building, state.inventory,
      Construction.costFor(building.type));
    if (!construction.started) {
      const shortage = construction.missing?.map(item => `${resourceName(item.id)} ${formatAmount(item.amount)}`).join(' · ');
      toast(shortage ? `Ressources insuffisantes : ${shortage}.` : 'Construction impossible pour le moment.');
      updateUI(); return;
    }
    state.surfaceBuildings.push(building);
    state.placement = null; state.tool = 'pan'; state.buildMenuOpen = false;
    const routeHint = definition.roadRequired ? ' Tracez une route manuellement pour le relier.' : '';
    toast(`${definition.label} : assemblage en cours.${routeHint}`); updateUI(); persist();
  }
  function chooseBuilding(type) {
    const definition = BuildingData.get(type);
    if (!definition || state.level !== 'surface' || !Progression.buildingUnlocked(state, type)) return;
    const shortage = Inventory.missing(state.inventory,
      Construction.costFor(type) || {});
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
    state.selected = { kind: 'building', ...building, groundText: siteReadout(building) };
    hud.showSelection(state.selected, { state }); updateUI();
  }
  function demolishSelectedBuilding() {
    const building = state.selected?.kind === 'building'
      ? state.surfaceBuildings.find(candidate => candidate.id === state.selected.id) : null;
    if (!building || BuildingData.get(building.type)?.indestructible) return;
    const refund = Construction.demolish(building, state.inventory);
    if (refund === null) return;
    for (const network of Object.values(state.roadNetworks)) RoadNetwork.detachBuilding(network, building.id);
    state.surfaceBuildings = state.surfaceBuildings.filter(candidate => candidate.id !== building.id);
    globalThis.OrbitIndustry.reclaimBuilding(state, building);
    state.selected = null; $('inspector').hidden = true;
    const refunded = Object.values(refund).some(amount => amount > 0);
    toast(`${BuildingData.get(building.type)?.label || 'Bâtiment'} démoli.${refunded ? ` Récupéré : ${amountSummary(refund)}.` : ''}`);
    updateUI(); persist();
  }
  function buildingHit(frame, building, definition, x, y) {
    const anchor = project(frame.x + building.x * frame.scale, frame.y + building.y * frame.scale);
    const localZoom = state.camera.zoom * frame.scale;
    const footprintRadius = Math.max(definition.footprint.width, definition.footprint.height) * localZoom / 2 + 7;
    // The beacon's hexagon sits on the building's spot.
    const pinRadius = SurfaceStyle.buildings.pin.headRadiusPx * (globalThis.OrbitBuildingRenderer?.pinScale({ zoom: localZoom }) ?? 1);
    if (Math.hypot(x - anchor.x, y - anchor.y) <= pinRadius + 6) return true;
    if (Math.hypot(anchor.x - x, anchor.y - y) <= Math.max(18, footprintRadius)) return true;
    if (building.constructionState === 'complete') return false;

    const style = SurfaceStyle.buildings;
    const width = Math.max(style.cardMinWidthPx, Math.min(style.cardWidthPx, style.cardMaxWidthPx));
    const edge = definition.footprint.width * localZoom / 2 + 12;
    let cardX = anchor.x + edge, cardY = anchor.y - style.cardHeightPx / 2;
    if (cardX + width > W - 8) cardX = anchor.x - edge - width;
    cardX = Math.max(8, Math.min(W - width - 8, cardX));
    cardY = Math.max(8, Math.min(H - style.cardHeightPx - 8, cardY));
    return x >= cardX && x <= cardX + width && y >= cardY && y <= cardY + style.cardHeightPx;
  }

  function roadEndpointAt(screenX, screenY, from = null) {
    if (state.level !== 'surface' || !state.planet || !terrainData) return null;
    const frame = surfaceFrame();
    const network = state.roadNetworks[state.planet.id];
    const radius = RoadPlacement.config.interaction.roadSnapRadiusPx;
    const originBuilding = from?.kind === 'building'
      ? state.surfaceBuildings.find(candidate => candidate.id === from.buildingId) : null;
    const platformRequiresPort = originBuilding?.type === 'oil_platform';
    const world = unproject(screenX, screenY);
    const position = { x: (world.x - frame.x) / frame.scale, y: (world.y - frame.y) / frame.scale };
    const marineConnection = network?.segments.length
      ? RoadNetwork.nearestBuiltConnection(network, position, candidate => candidate.kind === 'segment' &&
        (candidate.segment.routeType === 'marine' ||
          (candidate.segment.surfaceTypes?.length > 0 && candidate.segment.surfaceTypes.every(Boolean))))
      : null;
    let marineRouteHit = false;
    if (marineConnection) {
      const point = project(frame.x + marineConnection.point.x * frame.scale,
        frame.y + marineConnection.point.y * frame.scale);
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
        const screenPoint = project(frame.x + point.x * frame.scale, frame.y + point.y * frame.scale);
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
      return Boolean((definition?.roadRequired || candidate.type === 'oil_platform') &&
        buildingHit(frame, candidate, definition, screenX, screenY));
    });
    if (building) return { kind: 'building', buildingId: building.id,
      point: { ...(building.roadPort || building.waterPort || { x: building.x, y: building.y }) } };
    // Marine paths are not road junctions, even if they overlap a land route.
    if (marineRouteHit) return null;
    // A platform can only begin a maritime route to a surface port.
    if (platformRequiresPort) return null;

    let closest = null;
    function consider(endpoint) {
      const screenPoint = project(frame.x + endpoint.point.x * frame.scale, frame.y + endpoint.point.y * frame.scale);
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

  // Like built roads, a preview reaches the ground ring of the buildings it joins.
  function anchorRoadPreview(points, surfaceTypes, from, to) {
    const anchor = endpoint => endpoint?.kind === 'building'
      ? state.surfaceBuildings.find(building => building.id === endpoint.buildingId) : null;
    const start = anchor(from), end = anchor(to);
    return {
      points: [...(start ? [{ x: start.x, y: start.y }] : []), ...points, ...(end ? [{ x: end.x, y: end.y }] : [])],
      surfaceTypes: [...(start ? [false] : []), ...(surfaceTypes || []), ...(end ? [false] : [])]
    };
  }

  function roadTerrainPointAt(screenX, screenY) {
    const frame = surfaceFrame(), world = unproject(screenX, screenY);
    return { x: (world.x - frame.x) / frame.scale, y: (world.y - frame.y) / frame.scale };
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
      const anchored = preview.connected ? anchorRoadPreview(preview.points, preview.surfaceTypes, roadDrag.from, target) : null;
      state.roadPreview = preview.connected
        ? { points: anchored.points, surfaceTypes: anchored.surfaceTypes, valid: true, snapped: true,
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
    clearSelection();
    const camera = surfaceCamera(planet);
    focusCamera(camera.x, camera.y, camera.zoom);
    persist();
  }
  function back() {
    if (state.level === 'surface') {
      clearSelection(); state.tracking = null; state.focusPlanet = null;
      const camera = systemCamera();
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
      followPlanet(state.planet);
      const camera = surfaceCamera();
      focusCamera(camera.x, camera.y, camera.zoom);
    }
    persist();
  }
  function focusHome() {
    if (state.level === 'galaxy') { state.context = prepareSystem(home); state.tracking = null; select(home); resetCamera(); }
    else if (state.level === 'system') { state.tracking = null; state.focusPlanet = null; resetCamera(); }
    else { followPlanet(state.planet); resetCamera(); }
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
    const frame = state.level === 'surface' ? surfaceFrame() : null;
    const scaleCamera = state.level === 'galaxy' ? state.camera : state.level === 'system' ? localCamera(state.context.frame) : localCamera(frame);
    const buildingPosition = state.selected?.kind === 'building' && frame
      ? project(frame.x + state.selected.x * frame.scale, frame.y + state.selected.y * frame.scale) : null;
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
      const frame = surfaceFrame(), terrainPoint = { x: (point.x - frame.x) / frame.scale, y: (point.y - frame.y) / frame.scale };
      if (state.tool === 'build') {
        updateBuildingPreview(x, y); placeSurfaceBuilding(); return;
      }
      const tx = Math.floor(terrainPoint.x / Config.terrain.textureScale), ty = Math.floor(terrainPoint.y / Config.terrain.textureScale);
      if (tx < 0 || ty < 0 || tx >= terrainData.width || ty >= terrainData.height) return;
      const building = [...state.surfaceBuildings].reverse().find(candidate => {
        if (candidate.planetId !== state.planet.id) return false;
        const definition = BuildingData.get(candidate.type);
        if (!definition) return false;
        return buildingHit(frame, candidate, definition, x, y);
      });
      if (building) { selectSurfaceBuilding(building); return; }
      const cell = ty * terrainData.width + tx, height = terrainData.elevation[cell];
      // Lakes report their surface altitude rather than their floor.
      const surfaceHeight = terrainData.relief?.[cell] ?? height;
      const altitude = Math.round((surfaceHeight - terrainData.seaLevel) * 35);
      const featureNames = { [World.TERRAIN_FEATURES.lake]: 'Lac', [World.TERRAIN_FEATURES.marsh]: 'Marais',
        [World.TERRAIN_FEATURES.river]: 'Rivière', [World.TERRAIN_FEATURES.canyon]: 'Canyon',
        [World.TERRAIN_FEATURES.cove]: 'Crique' };
      const names = featureNames[terrainData.features?.[cell]] || (height < 100 ? 'Zone océanique' : height < 109 ? 'Littoral' :
        height < 143 ? 'Plaine continentale' : height < 183 ? 'Plateau rocheux' : height < 225 ? 'Massif montagneux' : 'Sommet');
      // Report what a drill set here would drain, not the single cell under the cursor.
      const drill = BuildingData.get(height <= terrainData.seaLevel ? 'oil_platform' : 'extractor');
      const composition = terrainData.materials ? BuildingPlacement.groundComposition(terrainData,
        Config.terrain.textureScale, { x: terrainPoint.x, y: terrainPoint.y }, drill) : null;
      select({ surfacePoint: true, x: terrainPoint.x, y: terrainPoint.y, altitude, name: names,
        info: composition ? `Sol, moyenne sur ${drill.catchmentRadius} km : ${hud.compositionText(composition)}.` : 'Composition du sol inconnue.' });
    }
  }
  function zoomAt(factor, x = W / 2, y = H / 2) {
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
      if ($('developer-dialog').open) { $('developer-dialog').close(); return; }
      if ($('menu-dialog').open) $('menu-dialog').close();
      else if (state.buildMenuOpen) { state.buildMenuOpen = false; updateUI(); }
      else if (state.tool !== 'pan') { cancelRoadDrag(); state.tool = 'pan'; state.placement = null; updateUI(); }
      else if (!$('inspector').hidden) { $('inspector').hidden = true; state.selected = null; updateUI(); }
      else back();
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement ||
        $('menu-dialog').open || $('developer-dialog').open) return;
    if (e.key === '+' || e.key === '=') zoomAt(1.4);
    if (e.key === '-') zoomAt(1 / 1.4);
    if (e.key === ' ' && !$('menu-dialog').open) { e.preventDefault(); setPause(!state.paused); }
    if (e.key === 'Enter' && state.selected && !$('menu-dialog').open && !$('enter-button').hidden) $('enter-button').click();
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
  addEventListener('resize', resize);
  addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { persist(); lastTime = 0; });

  function createOrbitalLogisticsFixture() {
    if (state.level !== 'surface' || !state.planet) throw new Error('Open a planetary surface before creating the logistics fixture');
    const frame = surfaceFrame(), center = unproject(W / 2, H / 2);
    const width = terrainData.width * Config.terrain.textureScale, height = terrainData.height * Config.terrain.textureScale;
    const centerX = clamp((center.x - frame.x) / frame.scale, 220, width - 240);
    const centerY = clamp((center.y - frame.y) / frame.scale, 50, height - 50);
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

  // The colony consumes what it received, gains population by tiers and
  // spreads its zone; the needs it reveals unlock buildings and cards.
  function advanceColony(seconds) {
    for (const event of Colony.advance(state, seconds)) {
      toast(`La colonie compte désormais ${formatAmount(event.population)} habitants.`);
    }
    growColonyZones();
    const opened = Progression.advance(state);
    const names = [...opened.buildings.map(type => BuildingData.get(type)?.label),
      ...opened.cards.map(card => {
        const [type, material] = card.split(':');
        return globalThis.OrbitProcessData.get(type, material || 'rock')?.label;
      })].filter(Boolean);
    if (names.length && opened.buildings.some(type => type !== 'colony')) toast(`Nouveau : ${names.join(' · ')}.`);
    else if (names.length && opened.cards.length) toast(`Nouvelles cartes : ${names.join(' · ')}.`);
    if (names.length) updateUI();
  }

  // A colony's zone grows over its planet's terrain as it consumes.
  function growColonyZones() {
    const cellKm2 = Config.terrain.textureScale ** 2;
    for (const colony of Colony.colonies(state)) {
      if (colony.constructionState === 'planned') continue;
      colony.colony = Colony.normalize(colony.colony);
      const target = Colony.targetCells(colony.colony, cellKm2);
      if (colony.colony.cells.length >= target) continue;
      // Only terrain already generated: growing waits until the planet is seen.
      let record = null;
      for (const context of contexts.values()) if (context.terrains.has(colony.planetId)) record = context.terrains.get(colony.planetId);
      if (!record) continue;
      const cells = ColonyZone.grow(record.data, Config.terrain.textureScale, colony, state.surfaceBuildings, target);
      if (cells.length !== colony.colony.cells.length) colony.colony.cells = cells;
    }
  }

  function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, Config.simulation.maxFrameSeconds) : 0; lastTime = now;
    const simulationDt = dt * (globalThis.OrbitDeveloperSettings?.get('simulationSpeed') || 1);
    Simulation.advance(state.simulation, simulationDt, !state.paused && !document.hidden);
    if (!state.paused && !document.hidden) {
      Construction.advance(state.surfaceBuildings, simulationDt);
      RoadConstruction.advance(state.roadNetworks, simulationDt);
      globalThis.OrbitIndustry.advance(state, simulationDt);
      advanceColony(simulationDt);
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
      homeId: home.id, transitioning: false, moving: cameraMoving(), tool: state.tool,
      planetKind: state.planet?.kind || null, missions: state.exploration.missions.length }),
    getSurfaceZoom: () => state.planet ? localCamera(surfaceFrame(state.planet), state.camera).zoom : null,
    // Per material: peak share and the number of cells where it dominates with at least 8 %.
    getSurfaceMaterialMetrics: () => {
      const materials = state.planet && state.context?.terrains.get(state.planet.id)?.data?.materials;
      if (!materials) return null;
      const kinds = materials.ids.length, metrics = Object.fromEntries(materials.ids.map(id => [id, { peak: 0, dominantCells: 0 }]));
      for (let cell = 0; cell < materials.shares.length / kinds; cell += 1) {
        let best = -1, bestShare = 0;
        for (let kind = 0; kind < kinds; kind += 1) {
          const share = materials.shares[cell * kinds + kind] / 255;
          metrics[materials.ids[kind]].peak = Math.max(metrics[materials.ids[kind]].peak, share);
          if (share > bestShare) { bestShare = share; best = kind; }
        }
        if (best >= 0 && bestShare >= .08) metrics[materials.ids[best]].dominantCells += 1;
      }
      return metrics;
    },
    focusHome, enterSystem, enterPlanet, back, regenerate, zoomAt,
    getCamera: () => ({ ...state.camera }),
    getHomeScreenPosition: () => project(home.x, home.y),
    getPlanetScreenPositions: () => (state.system?.planets || []).map(p => { const pos = planetWorldPosition(p); return { ...project(pos.x, pos.y), id: p.id, kind: p.kind }; }),
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
      const frame = surfaceFrame(), point = project(frame.x + building.x * frame.scale, frame.y + building.y * frame.scale);
      return { ...point, id };
    },
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
