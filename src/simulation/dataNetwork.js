(function (root) {
  'use strict';

  // Data on each planet's surface (see src/data/dataNetwork.js):
  //  - every building at work sends its data to the nearest relay antenna in
  //    range, which carries at most its bandwidth, shared between senders;
  //  - a relay hands it by road (OrbitLogisticsNetwork.hasBuiltLandPath) to
  //    the nearest datacenter, or, on a planet without one, to the nearest
  //    high-frequency antenna, which sends it to another planet;
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
      carried: 0, datacenterId: null, hfAntennaId: null, roadMissing: false });
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
    for (const relay of relays) {
      const link = links[relay.id] ||= blank(relay);
      const center = byRoad(state, relay, 'datacenter');
      const antenna = center ? null : byRoad(state, relay, 'hf_antenna');
      // Something to hand over to stands on the planet, but no road reaches it.
      link.roadMissing = !center && !antenna && buildings.some(candidate => complete(candidate) &&
        candidate.planetId === relay.planetId && ['datacenter', 'hf_antenna'].includes(candidate.type));
      if (!center && !antenna) continue;
      link.datacenterId = center?.id || null; link.hfAntennaId = antenna?.id || null;
      const share = link.offeredTotal > 0 ? Math.min(1, Data.antenna.bandwidthMbPerSecond / link.offeredTotal) : 0;
      link.carried = link.offeredTotal * share;
      for (const [resourceId, rate] of Object.entries(link.offered)) {
        if (center) deposit(center, 'inventory', resourceId, rate * share * seconds, datacenterRoom(center));
        else deposit(antenna, 'dataQueue', resourceId, rate * share * seconds, queueRoom(antenna));
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
