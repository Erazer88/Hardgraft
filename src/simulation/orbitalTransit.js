(function (root) {
  'use strict';

  const Data = root.OrbitOrbitalLogisticsData;
  const World = root.OrbitWorld;
  const TAU = Math.PI * 2;
  const EPSILON = 1e-9;

  function integerMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, amount]) => Number.isInteger(amount) && amount > 0));
  }

  function createState() {
    return { version: Data.version, corridors: [], transit: [], hubs: {},
      nextDispatchTime: Data.launch.batchIntervalSeconds };
  }

  function normalize(value) {
    const result = createState();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    result.corridors = Array.isArray(value.corridors) ? value.corridors.flatMap(item => {
      if (!item || typeof item.id !== 'string' || typeof item.fromEntityId !== 'string' || typeof item.toEntityId !== 'string') return [];
      return [{ id: item.id, fromEntityId: item.fromEntityId, toEntityId: item.toEntityId }];
    }) : [];
    result.transit = Array.isArray(value.transit) ? value.transit.flatMap(item => {
      if (!item || typeof item.corridorId !== 'string' || typeof item.resourceId !== 'string' ||
          !Number.isInteger(item.amount) || item.amount <= 0 || !Number.isFinite(item.departureTime) ||
          !Number.isFinite(item.arrivalTime) || item.arrivalTime < item.departureTime ||
          typeof item.systemId !== 'string' || typeof item.originPlanetId !== 'string') return [];
      return [{ corridorId: item.corridorId, resourceId: item.resourceId, amount: item.amount,
        departureTime: item.departureTime, arrivalTime: item.arrivalTime,
        systemId: item.systemId, originPlanetId: item.originPlanetId }];
    }) : [];
    if (value.hubs && typeof value.hubs === 'object' && !Array.isArray(value.hubs)) {
      for (const [systemId, hub] of Object.entries(value.hubs)) {
        if (!systemId || !hub || typeof hub !== 'object') continue;
        result.hubs[systemId] = { id: typeof hub.id === 'string' ? hub.id : `${systemId}:ark`,
          stock: integerMap(hub.stock) };
      }
    }
    if (Number.isFinite(value.nextDispatchTime) && value.nextDispatchTime >= 0) result.nextDispatchTime = value.nextDispatchTime;
    return result;
  }

  function snapshot(value) {
    const normalized = normalize(value);
    return { version: normalized.version, corridors: normalized.corridors, transit: normalized.transit,
      hubs: normalized.hubs, nextDispatchTime: normalized.nextDispatchTime };
  }

  function arkPosition(ark, star, time) {
    const angle = ark.phase + ark.speed * time;
    return { x: Math.cos(angle) * ark.orbit, y: Math.sin(angle) * ark.orbit };
  }

  function travelTime(system, planet, departureTime) {
    const ark = system?.ark;
    if (!ark || !planet) return null;
    const sourceAngle = planet.phase + planet.speed * departureTime;
    const arkAngle = ark.phase + ark.speed * departureTime;
    let angularDistance = Math.abs(((sourceAngle - arkAngle + Math.PI) % TAU + TAU) % TAU - Math.PI);
    const orbitList = (system.planets || []).map(item => item.orbit).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    const middle = orbitList.length ? orbitList[Math.floor(orbitList.length / 2)] : ark.orbit;
    const meanRadius = Math.max(.01, (planet.orbit + ark.orbit) / 2);
    const nominalDuration = Math.max(Data.transit.minimumSeconds, Math.min(Data.transit.maximumSeconds,
      Data.transit.referenceHalfOrbitSeconds * (angularDistance / Math.PI) * (meanRadius / Math.max(.01, middle))));
    return nominalDuration / Data.transit.cargoSpeedMultiplier;
  }

  function corridorFor(logistics, platform, ark) {
    const id = `${platform.id}->${ark.id}`;
    let corridor = logistics.corridors.find(item => item.id === id);
    if (!corridor) {
      corridor = { id, fromEntityId: platform.id, toEntityId: ark.id };
      logistics.corridors.push(corridor);
    }
    return corridor;
  }

  function ensureHub(logistics, system) {
    if (!system?.ark) return null;
    const hub = logistics.hubs[system.id] ||= { id: system.ark.id, stock: {} };
    hub.id = system.ark.id;
    hub.stock ||= {};
    return hub;
  }

  function appendLot(logistics, lot) {
    const existing = logistics.transit.find(item => item.corridorId === lot.corridorId &&
      item.resourceId === lot.resourceId && item.departureTime === lot.departureTime &&
      item.arrivalTime === lot.arrivalTime && item.systemId === lot.systemId &&
      item.originPlanetId === lot.originPlanetId);
    if (existing) existing.amount += lot.amount;
    else logistics.transit.push(lot);
  }

  function recordDispatch(logistics, corridorId, systemId, resourceId, amount, time) {
    const entries = logistics.dispatchHistory || (logistics.dispatchHistory = []);
    const existing = entries.find(item => item.corridorId === corridorId && item.resourceId === resourceId && item.time === time);
    if (existing) existing.amount += amount;
    else entries.push({ corridorId, systemId, resourceId, amount, time });
  }

  function enabledResources(platform) {
    return Data.exportResources.filter(resource => platform.exportEnabled?.[resource.id] === true)
      .map(resource => resource.id);
  }

  function launchBatch(state, platform, system, departureTime) {
    const logistics = state.orbitalLogistics, ark = system?.ark;
    if (!ark || platform.constructionState !== 'complete') return 0;
    const resources = enabledResources(platform);
    const available = resources.reduce((sum, id) => sum + Math.max(0, Math.floor(platform.launchStock?.[id] || 0)), 0);
    if (!available) return 0;
    const batchCapacity = Math.floor(Data.launch.capacityUPerSecond * Data.launch.batchIntervalSeconds);
    const amountToLaunch = Math.min(batchCapacity, available);
    const corridor = corridorFor(logistics, platform, ark);
    const planet = system.planets.find(item => item.id === platform.planetId);
    if (!planet) return 0;
    const duration = travelTime(system, planet, departureTime);
    let left = amountToLaunch, launched = 0;
    const batchByResource = {};
    let cursor = Math.max(0, resources.indexOf(platform.exportCursorResourceId || resources[0]));
    while (left > 0) {
      let resourceId = null, index = cursor;
      for (let checked = 0; checked < resources.length; checked++) {
        index = (cursor + checked) % resources.length;
        if ((platform.launchStock[resources[index]] || 0) > 0) { resourceId = resources[index]; break; }
      }
      if (!resourceId) break;
      platform.launchStock[resourceId] -= 1;
      batchByResource[resourceId] = (batchByResource[resourceId] || 0) + 1;
      cursor = (index + 1) % resources.length;
      platform.exportCursorResourceId = resources[cursor];
      left--; launched++;
    }
    const arrivalTime = departureTime + duration;
    for (const [resourceId, amount] of Object.entries(batchByResource)) {
      appendLot(logistics, { corridorId: corridor.id, resourceId, amount,
        departureTime, arrivalTime, systemId: system.id, originPlanetId: planet.id });
      recordDispatch(logistics, corridor.id, system.id, resourceId, amount, departureTime);
    }
    platform.energyUse = launched ? Data.launch.energyMW * 1e6 : 0;
    platform.lastLaunchTime = launched ? departureTime : null;
    return launched;
  }

  function advance(state, currentTime, systemsById = {}, allowDispatch = true) {
    if (!Number.isFinite(currentTime) || currentTime < 0) throw new RangeError('Orbital simulation time must be non-negative');
    const previous = state.orbitalLogistics || {};
    const history = (previous.dispatchHistory || []).filter(item => item && Number.isFinite(item.time) && item.time >= currentTime - 12);
    const hadDispatchClock = Number.isFinite(previous.nextDispatchTime);
    state.orbitalLogistics = normalize(previous);
    const logistics = state.orbitalLogistics;
    logistics.dispatchHistory = history;
    const interval = Data.launch.batchIntervalSeconds;
    if (!hadDispatchClock) logistics.nextDispatchTime = (Math.floor(currentTime / interval) + 1) * interval;
    const systems = systemsById instanceof Map ? systemsById : new Map(Object.entries(systemsById || {}));
    const platformById = new Map((state.surfaceBuildings || []).filter(item => item.type === 'launch_platform').map(item => [item.id, item]));
    for (const platform of platformById.values()) {
      const systemId = platform.planetId.split(':p-')[0], system = systems.get(systemId);
      if (system?.ark) {
        ensureHub(logistics, system);
        corridorFor(logistics, platform, system.ark);
        platform.energyUse = Number.isFinite(platform.lastLaunchTime) && currentTime - platform.lastLaunchTime < 1
          ? Data.launch.energyMW * 1e6 : 0;
      } else platform.energyUse = 0;
    }

    let next = Number.isFinite(logistics.nextDispatchTime) ? logistics.nextDispatchTime : interval;
    if (next <= 0) next = interval;
    next = Math.ceil((next - EPSILON) / interval) * interval;
    while (allowDispatch && next <= currentTime + EPSILON) {
      for (const platform of platformById.values()) {
        const system = systems.get(platform.planetId.split(':p-')[0]);
        if (system?.ark) launchBatch(state, platform, system, next);
      }
      next += interval;
    }
    if (allowDispatch) logistics.nextDispatchTime = next;

    const remaining = [];
    for (const lot of logistics.transit) {
      if (lot.arrivalTime <= currentTime + EPSILON) {
        const hub = logistics.hubs[lot.systemId] ||= { id: `${lot.systemId}:ark`, stock: {} };
        hub.stock[lot.resourceId] = (hub.stock[lot.resourceId] || 0) + lot.amount;
      } else remaining.push(lot);
    }
    logistics.transit = remaining;
    return logistics;
  }

  function trajectoryFor(lot, system) {
    const planet = system?.planets.find(item => item.id === lot.originPlanetId), ark = system?.ark;
    if (!planet || !ark || !Number.isFinite(lot.arrivalTime) || lot.arrivalTime <= lot.departureTime) return null;
    const center = World.planetPosition(planet, lot.departureTime);
    const sourceAngle = planet.phase + planet.speed * lot.departureTime;
    const sourceRadial = { x: Math.cos(sourceAngle), y: Math.sin(sourceAngle) };
    const start = { x: center.x + sourceRadial.x * planet.radius,
      y: center.y + sourceRadial.y * planet.radius };
    const end = arkPosition(ark, system.star, lot.arrivalTime);
    const arrivalAngle = ark.phase + ark.speed * lot.arrivalTime;
    const sourceTangent = { x: -sourceRadial.y, y: sourceRadial.x };
    const arrivalTangent = { x: -Math.sin(arrivalAngle), y: Math.cos(arrivalAngle) };
    const length = Math.max(.01, Math.hypot(end.x - start.x, end.y - start.y));
    const controlLength = Math.max(planet.radius * 1.5, length * .34);
    const p1 = { x: start.x + sourceTangent.x * controlLength,
      y: start.y + sourceTangent.y * controlLength };
    const p2 = { x: end.x - arrivalTangent.x * controlLength,
      y: end.y - arrivalTangent.y * controlLength };
    return { p0: start, p1, p2, p3: end };
  }

  function cargoPosition(lot, system, time) {
    const curve = trajectoryFor(lot, system);
    if (!curve) return null;
    const { p0, p1, p2, p3 } = curve;
    const progress = Math.max(0, Math.min(1, (time - lot.departureTime) / (lot.arrivalTime - lot.departureTime)));
    const t = progress, u = 1 - t;
    return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
  }

  function currentHubMetrics(state, systemId, currentTime) {
    const logistics = state.orbitalLogistics || createState(), hub = logistics.hubs?.[systemId] || { stock: {} };
    const inTransit = {}, rates = {};
    for (const lot of logistics.transit || []) if (lot.systemId === systemId) {
      inTransit[lot.resourceId] = (inTransit[lot.resourceId] || 0) + lot.amount;
    }
    const entries = (logistics.dispatchHistory || []).filter(item => item.systemId === systemId && item.time <= currentTime);
    const window = 10, interval = Data.launch.batchIntervalSeconds;
    const recent = entries.filter(item => item.time > currentTime - window);
    const duration = Math.max(interval, Math.min(window, currentTime - (recent[0]?.time ?? currentTime) + interval));
    for (const item of recent) {
      rates[item.resourceId] = (rates[item.resourceId] || 0) + item.amount / duration;
    }
    return { stock: integerMap(hub.stock), inTransit, rates };
  }

  function currentPlatformMetrics(state, platformId, currentTime) {
    const logistics = state.orbitalLogistics || createState(), corridorIds = new Set(
      (logistics.corridors || []).filter(item => item.fromEntityId === platformId).map(item => item.id));
    const window = 10, interval = Data.launch.batchIntervalSeconds;
    const entries = (logistics.dispatchHistory || []).filter(item => corridorIds.has(item.corridorId) &&
      item.time <= currentTime && item.time > currentTime - window);
    const duration = Math.max(interval, Math.min(window, currentTime - (entries[0]?.time ?? currentTime) + interval));
    const rates = {};
    for (const item of entries) rates[item.resourceId] = (rates[item.resourceId] || 0) + item.amount / duration;
    return { rates, throughput: Object.values(rates).reduce((sum, rate) => sum + rate, 0) };
  }

  root.OrbitOrbitalTransit = Object.freeze({ createState, normalize, snapshot, travelTime, arkPosition,
    ensureHub, corridorFor, advance, trajectoryFor, cargoPosition, currentHubMetrics, currentPlatformMetrics });
})(globalThis);
