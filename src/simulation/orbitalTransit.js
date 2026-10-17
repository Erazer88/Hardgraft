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
      const lot = { corridorId: item.corridorId, resourceId: item.resourceId, amount: item.amount,
        departureTime: item.departureTime, arrivalTime: item.arrivalTime,
        systemId: item.systemId, originPlanetId: item.originPlanetId };
      // Pending cargo keeps its economic schedule, but old visual curves are normalized
      // to the current prograde route model when a save is loaded.
      lot.trajectoryVersion = 3;
      return [lot];
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

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const positiveAngle = angle => ((angle % TAU) + TAU) % TAU;
  const signedAngle = angle => {
    const wrapped = positiveAngle(angle);
    return wrapped > Math.PI ? wrapped - TAU : wrapped;
  };

  function departureAlignment(system, planet, departureTime) {
    const ark = system?.ark;
    if (!ark || !planet) return { phaseOffset: 0, wrap: false };
    const sourceAngle = planet.phase + planet.speed * departureTime;
    const arkAngle = ark.phase + ark.speed * departureTime;
    const phaseOffset = signedAngle(arkAngle - sourceAngle);
    const relativeSpeed = ark.speed - planet.speed;
    // If the Ark is falling behind the source, begin the prograde wrap slightly
    // before alignment and keep it after the crossing. If it is ahead, only wrap
    // while it is still behind the source at departure.
    const leadWindow = relativeSpeed < -EPSILON
      ? clamp(Math.abs(relativeSpeed) * Data.launch.batchIntervalSeconds * Data.transfer.alignmentLaunchIntervalFactor,
        Data.transfer.alignmentMinimumRadians, Data.transfer.alignmentMaximumRadians)
      : 0;
    return { phaseOffset, wrap: phaseOffset < 0 || (leadWindow > 0 && phaseOffset <= leadWindow) };
  }

  function medianOrbit(system, fallback) {
    const orbits = (system.planets || []).map(item => item.orbit)
      .filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    return orbits.length ? orbits[Math.floor(orbits.length / 2)] : fallback;
  }

  function orbitalGeometry(system, planet, departureTime, duration,
    destinationTime = departureTime + duration, stabilizeAlignment = false) {
    const ark = system?.ark;
    if (!ark || !planet || !Number.isFinite(duration) || duration <= 0) return null;
    const sourceAngle = planet.phase + planet.speed * departureTime;
    const targetAngle = ark.phase + ark.speed * destinationTime;
    const startRadius = planet.orbit + planet.radius;
    const endRadius = ark.orbit;
    const meanRadius = Math.max(.01, (planet.orbit + ark.orbit) / 2);
    const neutralSpeed = planet.speed * Math.pow(Math.max(.01, planet.orbit) / meanRadius, 1.5);
    const neutralAngle = sourceAngle + neutralSpeed * duration;
    let liftedTargetAngle;
    if (stabilizeAlignment && departureAlignment(system, planet, departureTime).wrap) {
      // Keep one consistent prograde wrap while the Ark is trailing the source.
      liftedTargetAngle = sourceAngle + TAU + signedAngle(targetAngle - sourceAngle);
    } else {
      liftedTargetAngle = targetAngle + TAU * Math.round((neutralAngle - targetAngle) / TAU);
      if (liftedTargetAngle < sourceAngle - EPSILON) {
        liftedTargetAngle += TAU * Math.ceil((sourceAngle - liftedTargetAngle) / TAU);
      }
    }
    if (liftedTargetAngle < sourceAngle) liftedTargetAngle = sourceAngle;
    const correction = liftedTargetAngle - neutralAngle;
    const threshold = Data.transfer.directCorrectionRadians;
    const mode = Math.abs(correction) <= threshold ? 'direct' : correction > 0 ? 'inner' : 'outer';
    const angularSweep = Math.max(0, liftedTargetAngle - sourceAngle);

    const systemExtent = Number.isFinite(system.extent) ? system.extent : Math.max(startRadius, endRadius) * 1.6;
    const starRadius = Math.max(0, system.star?.radius || 0);
    const margin = Math.max(3, starRadius * .12);
    const availableExcursion = mode === 'inner'
      ? Math.max(0, Math.min(startRadius, endRadius) - starRadius - margin)
      : mode === 'outer'
        ? Math.max(0, systemExtent - Math.max(startRadius, endRadius) - margin) : 0;
    const strength = .35 + .65 * Math.min(1, Math.abs(correction) / Math.PI);
    const requestedExcursion = meanRadius * Data.transfer.radialExcursionFraction * strength;
    const radialExcursion = mode === 'inner' ? -Math.min(availableExcursion, requestedExcursion)
      : mode === 'outer' ? Math.min(availableExcursion, requestedExcursion) : 0;
    return { kind: 'orbital', version: stabilizeAlignment ? 3 : 2, mode, correction, sourceAngle, targetAngle,
      angularSweep, startRadius, endRadius, meanRadius, radialExcursion };
  }

  function radiusAt(trajectory, progress) {
    const u = clamp(progress, 0, 1);
    return trajectory.startRadius + (trajectory.endRadius - trajectory.startRadius) * u +
      trajectory.radialExcursion * Math.sin(Math.PI * u) ** 2;
  }

  function addAngularProfile(trajectory) {
    const segments = Math.max(8, Data.transfer.routeSamples), values = [0];
    let previous = Math.pow(trajectory.meanRadius / Math.max(.01, radiusAt(trajectory, 0)), 1.5), total = 0;
    for (let index = 1; index <= segments; index++) {
      const weight = Math.pow(trajectory.meanRadius / Math.max(.01, radiusAt(trajectory, index / segments)), 1.5);
      total += (previous + weight) * .5 / segments;
      values.push(total);
      previous = weight;
    }
    trajectory.angularProfile = values.map(value => value / Math.max(EPSILON, total));
    trajectory.angularSegments = segments;
    return trajectory;
  }

  function angularProgressAt(trajectory, progress) {
    const u = clamp(progress, 0, 1), scaled = u * trajectory.angularSegments;
    const index = Math.min(trajectory.angularSegments - 1, Math.floor(scaled));
    const fraction = scaled - index, profile = trajectory.angularProfile;
    return profile[index] + (profile[index + 1] - profile[index]) * fraction;
  }

  function positionOnTrajectory(trajectory, progress) {
    if (!trajectory) return null;
    const u = clamp(progress, 0, 1);
    if (trajectory.kind === 'legacy') {
      const t = u, v = 1 - t, { p0, p1, p2, p3 } = trajectory;
      return { x: v ** 3 * p0.x + 3 * v ** 2 * t * p1.x + 3 * v * t ** 2 * p2.x + t ** 3 * p3.x,
        y: v ** 3 * p0.y + 3 * v ** 2 * t * p1.y + 3 * v * t ** 2 * p2.y + t ** 3 * p3.y };
    }
    if (u === 0) return { x: Math.cos(trajectory.sourceAngle) * trajectory.startRadius,
      y: Math.sin(trajectory.sourceAngle) * trajectory.startRadius };
    if (u === 1) return { x: Math.cos(trajectory.targetAngle) * trajectory.endRadius,
      y: Math.sin(trajectory.targetAngle) * trajectory.endRadius };
    const radius = radiusAt(trajectory, u);
    const angle = trajectory.sourceAngle + trajectory.angularSweep * angularProgressAt(trajectory, u);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }

  function trajectoryLength(trajectory) {
    const segments = Math.max(24, Data.transfer.routeSamples), first = positionOnTrajectory(trajectory, 0);
    let length = 0, previous = first;
    for (let index = 1; index <= segments; index++) {
      const point = positionOnTrajectory(trajectory, index / segments);
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      previous = point;
    }
    return length;
  }

  function durationForLength(system, planet, length) {
    const referenceOrbit = Math.max(.01, medianOrbit(system, system.ark.orbit));
    const nominal = clamp(Data.transit.referenceHalfOrbitSeconds * length /
      (Math.PI * referenceOrbit), Data.transit.minimumSeconds, Data.transit.maximumSeconds);
    return nominal / Data.transit.cargoSpeedMultiplier;
  }

  function travelTime(system, planet, departureTime) {
    const ark = system?.ark;
    if (!ark || !planet) return null;
    const sourceAngle = planet.phase + planet.speed * departureTime;
    const arkAngle = ark.phase + ark.speed * departureTime;
    const startRadius = planet.orbit + planet.radius, endRadius = ark.orbit;
    const meanRadius = Math.max(.01, (planet.orbit + ark.orbit) / 2);
    const alignment = departureAlignment(system, planet, departureTime);
    const forwardSweep = alignment.wrap ? TAU + alignment.phaseOffset : positiveAngle(arkAngle - sourceAngle) || TAU;
    const initialLength = Math.hypot(meanRadius * forwardSweep, endRadius - startRadius);
    let duration = durationForLength(system, planet, initialLength);
    for (let iteration = 0; iteration < Data.transfer.durationIterations; iteration++) {
      const trajectory = addAngularProfile(orbitalGeometry(system, planet, departureTime, duration,
        departureTime + duration, true));
      const nextDuration = durationForLength(system, planet, trajectoryLength(trajectory));
      if (Math.abs(nextDuration - duration) <= Data.transfer.durationToleranceSeconds) return nextDuration;
      duration = (duration + nextDuration) * .5;
    }
    return duration;
  }

  function previewTrajectory(system, planet, departureTime) {
    const duration = travelTime(system, planet, departureTime);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    // The guide tracks the current Ark position; launched cargo targets its frozen arrival position.
    const trajectory = addAngularProfile(orbitalGeometry(system, planet, departureTime, duration,
      departureTime, true));
    if (!trajectory) return null;
    trajectory.p0 = positionOnTrajectory(trajectory, 0);
    trajectory.p3 = positionOnTrajectory(trajectory, 1);
    return trajectory;
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
        departureTime, arrivalTime, systemId: system.id, originPlanetId: planet.id, trajectoryVersion: 3 });
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
    if (lot.trajectoryVersion === 2 || lot.trajectoryVersion === 3) {
      const trajectory = addAngularProfile(orbitalGeometry(system, planet, lot.departureTime,
        lot.arrivalTime - lot.departureTime, lot.arrivalTime, lot.trajectoryVersion === 3));
      if (!trajectory) return null;
      trajectory.p0 = positionOnTrajectory(trajectory, 0);
      trajectory.p3 = positionOnTrajectory(trajectory, 1);
      return trajectory;
    }
    return legacyTrajectoryFor(lot, system, planet, ark);
  }

  function legacyTrajectoryFor(lot, system, planet, ark) {
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
    return { kind: 'legacy', p0: start, p1, p2, p3: end };
  }

  function trajectorySamples(trajectory, segments = Data.transfer.routeSamples) {
    if (!trajectory) return [];
    const count = Math.max(2, Math.floor(segments));
    return Array.from({ length: count + 1 }, (_, index) =>
      positionOnTrajectory(trajectory, index / count));
  }

  function cargoPosition(lot, system, time, curve = trajectoryFor(lot, system)) {
    if (!curve) return null;
    const progress = Math.max(0, Math.min(1, (time - lot.departureTime) / (lot.arrivalTime - lot.departureTime)));
    return positionOnTrajectory(curve, progress);
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
    ensureHub, corridorFor, advance, trajectoryFor, previewTrajectory, trajectorySamples, cargoPosition,
    currentHubMetrics, currentPlatformMetrics });
})(globalThis);
