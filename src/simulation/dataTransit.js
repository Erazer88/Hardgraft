(function (root) {
  'use strict';

  // Data between worlds: high-frequency antennas (and labs using their own
  // transmitter) send their queue as packets, once per dispatch interval, at a
  // steady bandwidth. By default analyses go to the Ark, where each becomes a
  // technology point, and raw data to the high-frequency antenna of another
  // planet that has a datacenter by road, which takes it in. An antenna may
  // instead be pointed at another one (building.hfTarget), which takes in the
  // raw data if its datacenter can, and passes the rest on along its own
  // destination: a relay between worlds. Packets fly 3× faster than
  // freight; the star between both ends cuts the link (solar conjunction).
  // State: state.dataTransit = { packets, nextDispatchTime, delivered }.
  const Data = root.OrbitDataNetworkData, World = root.OrbitWorld, Transit = root.OrbitOrbitalTransit;
  const EPSILON = 1e-6;
  const complete = building => building.constructionState === 'complete';
  const systemOf = planetId => String(planetId).split(':p-')[0];

  function createState() { return { packets: [], nextDispatchTime: null, delivered: 0 }; }

  function normalize(value) {
    const state = createState();
    if (!value || typeof value !== 'object') return state;
    state.packets = (Array.isArray(value.packets) ? value.packets : []).filter(packet => packet &&
      typeof packet.resourceId === 'string' && Number.isInteger(packet.amount) && packet.amount > 0 &&
      Number.isFinite(packet.departureTime) && Number.isFinite(packet.arrivalTime) && typeof packet.systemId === 'string' &&
      typeof packet.fromPlanetId === 'string' && ['ark', 'antenna'].includes(packet.toKind))
      .map(packet => ({ ...packet }));
    state.nextDispatchTime = Number.isFinite(value.nextDispatchTime) ? value.nextDispatchTime : null;
    state.delivered = Number.isFinite(value.delivered) ? value.delivered : 0;
    return state;
  }

  // Where a body stands at a time, around its star.
  function position(system, target, time) {
    if (target.kind === 'ark') return Transit.arkPosition(system.ark, system.star, time);
    const planet = system.planets.find(item => item.id === target.planetId);
    return planet ? World.planetPosition(planet, time) : null;
  }

  // Whether the star hides one end from the other (its disc, widened, crosses the line).
  function conjunction(system, from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, -(from.x * dx + from.y * dy) / length)) : 0;
    const gap = Math.hypot(from.x + dx * t, from.y + dy * t);
    return gap < (system.star?.radius || 8) * Data.highFrequency.conjunctionStarRadii;
  }

  // Flight time: freight's own to the Ark, or freight's for the straight
  // line between planets, divided by speedOverFreight.
  function flightSeconds(system, planet, from, to, target, time) {
    const freight = target.kind === 'ark' ? Transit.travelTime(system, planet, time)
      : Transit.freightDuration(system, planet, Math.hypot(to.x - from.x, to.y - from.y));
    return Number.isFinite(freight) ? Math.max(1, freight / Data.highFrequency.speedOverFreight) : null;
  }

  const emitters = state => (state.surfaceBuildings || []).filter(building => complete(building) &&
    ['hf_antenna', 'lab'].includes(building.type));

  // High-frequency antennas of the system that hand their data to a datacenter by road.
  function receivers(state, systemId, exceptPlanetId) {
    return (state.surfaceBuildings || []).filter(building => building.type === 'hf_antenna' && complete(building) &&
      systemOf(building.planetId) === systemId && building.planetId !== exceptPlanetId &&
      root.OrbitDataNetwork?.byRoad(state, building, 'datacenter'));
  }

  // The antenna an emitter is pointed at, if it still stands on another planet
  // of the system and is not itself pointed back at the emitter.
  function destinationAntenna(state, systemId, emitter) {
    if (!emitter.hfTarget || emitter.hfTarget === 'ark') return null;
    const antenna = (state.surfaceBuildings || []).find(building => building.id === emitter.hfTarget);
    return antenna && antenna.type === 'hf_antenna' && complete(antenna) && systemOf(antenna.planetId) === systemId &&
      antenna.planetId !== emitter.planetId && antenna.hfTarget !== emitter.id ? antenna : null;
  }

  // Antennas an emitter may be pointed at (other planets of its system).
  function destinationChoices(state, emitter) {
    return (state.surfaceBuildings || []).filter(building => building.type === 'hf_antenna' && complete(building) &&
      building.id !== emitter.id && building.planetId !== emitter.planetId &&
      systemOf(building.planetId) === systemOf(emitter.planetId) && building.hfTarget !== emitter.id);
  }

  // Where an emitter's resource goes now, or why it waits.
  function routeFor(state, system, emitter, resourceId, time) {
    const planet = system.planets.find(item => item.id === emitter.planetId);
    if (!planet) return { reason: 'unknown' };
    const from = World.planetPosition(planet, time);
    let target;
    const chosen = destinationAntenna(state, system.id, emitter);
    if (chosen) target = { kind: 'antenna', id: chosen.id, planetId: chosen.planetId };
    else if (resourceId === 'analysis') {
      if (!system.ark) return { reason: 'no_ark' };
      target = { kind: 'ark' };
    } else {
      let best = null, bestGap = Infinity;
      for (const receiver of receivers(state, system.id, emitter.planetId)) {
        const point = position(system, { kind: 'antenna', planetId: receiver.planetId }, time);
        const gap = point ? Math.hypot(point.x - from.x, point.y - from.y) : Infinity;
        if (gap < bestGap) { best = receiver; bestGap = gap; }
      }
      if (!best) return { reason: 'no_receiver' };
      target = { kind: 'antenna', id: best.id, planetId: best.planetId };
    }
    const to = position(system, target, time);
    if (!to) return { reason: 'unknown' };
    if (conjunction(system, from, to)) return { reason: 'conjunction', target };
    const seconds = flightSeconds(system, planet, from, to, target, time);
    return seconds ? { target, seconds } : { reason: 'unknown' };
  }

  function dispatch(state, systems, time) {
    const spec = Data.highFrequency, budgetPerEmitter = spec.bandwidthMbPerSecond * spec.dispatchIntervalSeconds;
    for (const emitter of emitters(state)) {
      const system = systems.get(systemOf(emitter.planetId));
      emitter.dataLink = null;
      if (!system) continue;
      let budget = budgetPerEmitter;
      // Analyses first: they are what the Ark is waiting for.
      const order = Object.keys(emitter.dataQueue || {}).sort((a, b) => (a === 'analysis' ? -1 : 0) - (b === 'analysis' ? -1 : 0));
      for (const resourceId of order) {
        const queued = Math.floor(emitter.dataQueue[resourceId] || 0);
        if (!queued || budget < 1) continue;
        const route = routeFor(state, system, emitter, resourceId, time);
        // What the antenna sheet shows: sending, or why it waits (runtime only).
        emitter.dataLink = { reason: route.reason || null, toKind: route.target?.kind || null, toId: route.target?.id || null };
        if (!route.seconds) continue;
        const amount = Math.min(queued, Math.floor(budget));
        budget -= amount;
        emitter.dataQueue[resourceId] -= amount;
        if (emitter.dataQueue[resourceId] <= 0) delete emitter.dataQueue[resourceId];
        state.dataTransit.packets.push({ resourceId, amount, systemId: system.id, fromId: emitter.id, fromPlanetId: emitter.planetId,
          toKind: route.target.kind, toId: route.target.id || null, toPlanetId: route.target.planetId || null,
          departureTime: time, arrivalTime: time + route.seconds });
      }
    }
  }

  function deliver(state, packet) {
    if (packet.toKind === 'ark') {
      if (packet.resourceId === 'analysis') state.techPoints = (state.techPoints || 0) + packet.amount;
      state.dataTransit.delivered += packet.amount;
      return;
    }
    const antenna = (state.surfaceBuildings || []).find(building => building.id === packet.toId);
    if (!antenna) return;
    // Raw data goes to the datacenter by road; analyses, or data with no
    // datacenter to take it, wait in the antenna to go on.
    const center = packet.resourceId !== 'analysis' && root.OrbitDataNetwork.byRoad(state, antenna, 'datacenter');
    if (center) root.OrbitDataNetwork.deposit(center, 'inventory', packet.resourceId, packet.amount,
      root.OrbitDataNetwork.datacenterRoom(center));
    else root.OrbitDataNetwork.deposit(antenna, 'dataQueue', packet.resourceId, packet.amount,
      () => Data.highFrequency.queueMb - Object.values(antenna.dataQueue || {}).reduce((sum, value) => sum + value, 0));
  }

  function advance(state, time, systems, running = true) {
    const transit = state.dataTransit = normalize(state.dataTransit);
    const interval = Data.highFrequency.dispatchIntervalSeconds;
    let next = Number.isFinite(transit.nextDispatchTime) ? transit.nextDispatchTime : Math.ceil(time / interval) * interval;
    // After a long pause (or a reload far ahead), dispatch once rather than for every missed interval.
    if (next < time - interval * 5) next = Math.ceil(time / interval) * interval;
    while (running && next <= time + EPSILON) { dispatch(state, systems, next); next += interval; }
    if (running) transit.nextDispatchTime = next;
    const remaining = [];
    for (const packet of transit.packets) {
      if (packet.arrivalTime <= time + EPSILON) deliver(state, packet); else remaining.push(packet);
    }
    transit.packets = remaining;
    return transit;
  }

  // A packet's point on its way: along the line between both ends now.
  function packetPosition(packet, system, time) {
    const from = position(system, { kind: 'antenna', planetId: packet.fromPlanetId }, time);
    const to = position(system, packet.toKind === 'ark' ? { kind: 'ark' } : { kind: 'antenna', planetId: packet.toPlanetId }, time);
    if (!from || !to) return null;
    const progress = Math.max(0, Math.min(1, (time - packet.departureTime) / (packet.arrivalTime - packet.departureTime)));
    return { from, to, progress, x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
  }

  const snapshot = value => normalize(value);

  root.OrbitDataTransit = Object.freeze({ createState, normalize, snapshot, advance, conjunction, routeFor, packetPosition, position,
    destinationAntenna, destinationChoices });
})(globalThis);
