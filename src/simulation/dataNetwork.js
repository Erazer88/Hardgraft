(function (root) {
  'use strict';

  // Data flow on each planet (see src/data/dataNetwork.js): every building at
  // work sends its data to the nearest dish in range; a dish carries at most
  // its bandwidth, shared between its senders, to the nearest datacenter
  // joined to it by a built road (OrbitLogisticsNetwork.hasBuiltLandPath).
  // Data lands in the datacenter's inventory (whole Mo, up to its buffer;
  // beyond is lost), where its Receiver cards pull it.
  // Returns per dish, for display: senders, offered and carried rates (Mo/s).
  const Data = root.OrbitDataNetworkData;
  const complete = building => building.constructionState === 'complete';
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function nearest(candidates, point, maxDistance = Infinity) {
    let best = null, bestDistance = maxDistance;
    for (const candidate of candidates) {
      const gap = distance(candidate, point);
      if (gap <= bestDistance) { best = candidate; bestDistance = gap; }
    }
    return best;
  }

  function advance(state, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Data time must be finite and non-negative');
    const buildings = state.surfaceBuildings || [];
    const dishes = buildings.filter(building => building.type === 'antenna' && complete(building));
    const centers = buildings.filter(building => building.type === 'datacenter' && complete(building));
    const links = {};
    for (const source of buildings) {
      const spec = Data.sources[source.type];
      if (!spec || !complete(source) || source.status !== 'active') continue;
      const dish = nearest(dishes.filter(candidate => candidate.planetId === source.planetId), source, Data.antenna.rangeKm);
      if (!dish) continue;
      const link = links[dish.id] ||= { antennaId: dish.id, planetId: dish.planetId, sources: [], offered: {},
        offeredTotal: 0, carried: 0, datacenterId: null };
      link.sources.push(source.id);
      link.offered[spec.resourceId] = (link.offered[spec.resourceId] || 0) + spec.mbPerSecond;
      link.offeredTotal += spec.mbPerSecond;
    }
    for (const dish of dishes) {
      const link = links[dish.id] ||= { antennaId: dish.id, planetId: dish.planetId, sources: [], offered: {},
        offeredTotal: 0, carried: 0, datacenterId: null };
      const onPlanet = centers.filter(candidate => candidate.planetId === dish.planetId);
      const network = state.roadNetworks?.[dish.planetId];
      const center = nearest(onPlanet.filter(candidate =>
        root.OrbitLogisticsNetwork?.hasBuiltLandPath(network, dish.id, candidate.id)), dish);
      // A datacenter stands on the planet but no road reaches it yet.
      link.roadMissing = !center && onPlanet.length > 0;
      if (!center) continue;
      link.datacenterId = center.id;
      const share = link.offeredTotal > 0 ? Math.min(1, Data.antenna.bandwidthMbPerSecond / link.offeredTotal) : 0;
      link.carried = link.offeredTotal * share;
      const stock = center.inventory ||= {}, credit = center.dataCredit ||= {};
      for (const [resourceId, rate] of Object.entries(link.offered)) {
        credit[resourceId] = (credit[resourceId] || 0) + rate * share * seconds;
        const whole = Math.floor(credit[resourceId] + 1e-9);
        if (!whole) continue;
        credit[resourceId] -= whole;
        const kept = Math.min(whole, Math.max(0, Data.datacenter.bufferMb - (stock[resourceId] || 0)));
        if (kept) stock[resourceId] = (stock[resourceId] || 0) + kept;
        // Running totals received and lost, for the panels (runtime only).
        center.receivedTotal ||= {};
        center.receivedTotal[resourceId] = (center.receivedTotal[resourceId] || 0) + kept;
        if (whole > kept) center.dataLost = (center.dataLost || 0) + whole - kept;
      }
    }
    state.dataLinks = links;
    return links;
  }

  root.OrbitDataNetwork = Object.freeze({ advance, nearest });
})(globalThis);
