(function (root) {
  'use strict';

  // Data on each planet's surface (see src/data/dataNetwork.js):
  //  - every building at work sends its data to the nearest relay antenna in
  //    range;
  //  - relay antennas pass data from one to the next, wirelessly within
  //    linkRangeKm, down a chain to one that has a datacenter in range (or, on
  //    a planet without one, a high-frequency antenna, which sends it to
  //    another planet). Each relay carries at most its bandwidth, its own
  //    senders and what it relays together: the end of a chain is its
  //    bottleneck;
  //  - a datacenter's uplink cards hand their analyses by road to the nearest
  //    high-frequency antenna, bound for the Ark;
  //  - a lab with no relay antenna in range (on a world without colony, or in
  //    orbit of a gas giant) queues its own data and beams it itself.
  // Data lands in whole Mo: a datacenter keeps bufferMb per kind, an antenna
  // queueMb in all; beyond is lost. Returns per relay antenna, for display:
  // senders, offered and carried rates (Mo/s) and where it hands its data.
  const Data = root.OrbitDataNetworkData;
  const complete = building => building.constructionState === 'complete';
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const total = stock => Object.values(stock || {}).reduce((sum, amount) => sum + amount, 0);

  function nearest(candidates, point, maxDistance = Infinity) {
    let best = null, bestDistance = maxDistance;
    for (const candidate of candidates) {
      const gap = distance(candidate, point);
      if (gap <= bestDistance) { best = candidate; bestDistance = gap; }
    }
    return best;
  }

  // The nearest building of a type joined to `from` by a built road.
  function byRoad(state, from, type) {
    const network = state.roadNetworks?.[from.planetId];
    return nearest((state.surfaceBuildings || []).filter(candidate => candidate.type === type && complete(candidate) &&
      candidate.planetId === from.planetId && root.OrbitLogisticsNetwork?.hasBuiltLandPath(network, from.id, candidate.id)), from);
  }

  const uplinkAntenna = (state, datacenter) => byRoad(state, datacenter, 'hf_antenna');
  // A lab in orbit of a gas giant has no ground and no relay to reach.
  const orbitalLab = building => building.type === 'lab' && building.siteKind === 'gazeuse';

  // Adds `amount` Mo to a stock through a fractional credit, in whole Mo, up to
  // `room(resourceId)`; what does not fit is lost (counted in dataLost).
  function deposit(target, stockKey, resourceId, amount, room) {
    const credit = target.dataCredit ||= {}, stock = target[stockKey] ||= {};
    credit[resourceId] = (credit[resourceId] || 0) + amount;
    const whole = Math.floor(credit[resourceId] + 1e-9);
    if (!whole) return 0;
    credit[resourceId] -= whole;
    const kept = Math.min(whole, Math.max(0, Math.floor(room(resourceId))));
    if (kept) stock[resourceId] = (stock[resourceId] || 0) + kept;
    // Running totals received, for the panels (runtime only).
    target.receivedTotal ||= {};
    target.receivedTotal[resourceId] = (target.receivedTotal[resourceId] || 0) + kept;
    if (whole > kept) target.dataLost = (target.dataLost || 0) + whole - kept;
    return whole - kept;
  }
  const datacenterRoom = center => resourceId => Data.datacenter.bufferMb - (center.inventory?.[resourceId] || 0);
  const queueRoom = antenna => () => Data.highFrequency.queueMb - total(antenna.dataQueue);

  function advance(state, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Data time must be finite and non-negative');
    const buildings = state.surfaceBuildings || [];
    const relays = buildings.filter(building => building.type === 'antenna' && complete(building));
    const blank = relay => ({ antennaId: relay.id, planetId: relay.planetId, sources: [], offered: {}, offeredTotal: 0,
      relayed: 0, carried: 0, nextId: null, hops: null, datacenterId: null, hfAntennaId: null });
    const links = {};
    for (const source of buildings) {
      const spec = Data.sources[source.type];
      if (!spec || !complete(source) || !(spec.alwaysActive || source.status === 'active')) continue;
      const rate = Data.sourceRate(spec, source);
      const relay = !orbitalLab(source) &&
        nearest(relays.filter(candidate => candidate.planetId === source.planetId), source, Data.antenna.rangeKm);
      // A lab out of a relay's reach uses its own transmitter.
      if (!relay && source.type === 'lab') {
        deposit(source, 'dataQueue', spec.resourceId, rate * seconds, queueRoom(source));
        continue;
      }
      if (!relay) continue;
      const link = links[relay.id] ||= blank(relay);
      link.sources.push(source.id);
      link.offered[spec.resourceId] = (link.offered[spec.resourceId] || 0) + rate;
      link.offeredTotal += rate;
    }
    for (const relay of relays) links[relay.id] ||= blank(relay);
    // The chains: from each relay that has a datacenter in range (else, on a
    // planet without one, a high-frequency antenna), count hops backward.
    const range = Data.antenna.linkRangeKm, hops = new Map(), queue = [];
    for (const relay of relays) {
      const onPlanet = type => buildings.filter(candidate => candidate.type === type && complete(candidate) && candidate.planetId === relay.planetId);
      const centers = onPlanet('datacenter');
      const sink = nearest(centers, relay, range) || (!centers.length && nearest(onPlanet('hf_antenna'), relay, range));
      if (!sink) continue;
      const link = links[relay.id];
      if (sink.type === 'datacenter') link.datacenterId = sink.id; else link.hfAntennaId = sink.id;
      link.nextId = sink.id; link.hops = 0; hops.set(relay.id, 0); queue.push(relay);
    }
    while (queue.length) {
      const relay = queue.shift(), depth = hops.get(relay.id);
      for (const other of relays) {
        if (hops.has(other.id) || other.planetId !== relay.planetId || distance(other, relay) > range) continue;
        hops.set(other.id, depth + 1);
        Object.assign(links[other.id], { nextId: relay.id, hops: depth + 1,
          datacenterId: links[relay.id].datacenterId, hfAntennaId: links[relay.id].hfAntennaId });
        queue.push(other);
      }
    }
    // Data flows down each chain, farthest relays first; each relay passes on
    // at most its bandwidth, every kind of data in proportion.
    const incoming = new Map();
    for (const relay of [...relays].filter(item => hops.has(item.id)).sort((a, b) => hops.get(b.id) - hops.get(a.id))) {
      const link = links[relay.id], flow = { ...link.offered };
      for (const [resourceId, rate] of Object.entries(incoming.get(relay.id) || {})) flow[resourceId] = (flow[resourceId] || 0) + rate;
      const offered = Object.values(flow).reduce((sum, rate) => sum + rate, 0);
      link.relayed = offered - link.offeredTotal;
      const share = offered > 0 ? Math.min(1, Data.antenna.bandwidthMbPerSecond / offered) : 0;
      link.carried = offered * share;
      const next = buildings.find(candidate => candidate.id === link.nextId);
      for (const [resourceId, rate] of Object.entries(flow)) {
        const passed = rate * share;
        if (next.type === 'datacenter') deposit(next, 'inventory', resourceId, passed * seconds, datacenterRoom(next));
        else if (next.type === 'hf_antenna') deposit(next, 'dataQueue', resourceId, passed * seconds, queueRoom(next));
        else {
          const into = incoming.get(next.id) || {};
          into[resourceId] = (into[resourceId] || 0) + passed;
          incoming.set(next.id, into);
        }
      }
    }
    // Analyses leave the datacenters for their high-frequency antenna.
    for (const center of buildings.filter(building => building.type === 'datacenter' && complete(building))) {
      const waiting = Math.floor(center.dockStock?.analysis || 0);
      const antenna = waiting && uplinkAntenna(state, center);
      if (!antenna) continue;
      const moved = Math.min(waiting, Math.max(0, Math.floor(queueRoom(antenna)())));
      if (!moved) continue;
      center.dockStock.analysis -= moved;
      if (center.dockStock.analysis <= 0) delete center.dockStock.analysis;
      antenna.dataQueue ||= {};
      antenna.dataQueue.analysis = (antenna.dataQueue.analysis || 0) + moved;
    }
    state.dataLinks = links;
    return links;
  }

  root.OrbitDataNetwork = Object.freeze({ advance, nearest, byRoad, uplinkAntenna, orbitalLab, deposit, datacenterRoom });
})(globalThis);
