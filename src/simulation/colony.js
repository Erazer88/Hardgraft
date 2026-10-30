(function (root) {
  'use strict';

  // The colony consumes what reaches it by road to climb its tiers, raises
  // its population at each tier and produces context. Its state lives on the
  // colony building (building.colony); context points are galaxy-wide
  // (state.contextPoints, not to be confused with the navigation context).
  const Data = root.OrbitColonyData;
  const isInteger = value => Number.isInteger(value) && value >= 0;

  function normalize(value = {}) {
    const tier = isInteger(value?.tier) ? Math.min(value.tier, Data.tiers.length) : 0;
    const population = isInteger(value?.population) && value.population > 0 ? value.population : Data.startingPopulation;
    const progress = value?.progress && typeof value.progress === 'object' && !Array.isArray(value.progress)
      ? Object.fromEntries(Object.entries(value.progress).filter(([id, amount]) => id && isInteger(amount) && amount > 0)) : {};
    const consumed = isInteger(value?.consumed) ? value.consumed : 0;
    const cells = Array.isArray(value?.cells) ? value.cells.filter(isInteger) : [];
    // Units each flow is behind (what should have arrived and did not).
    const owed = value?.owed && typeof value.owed === 'object' && !Array.isArray(value.owed)
      ? Object.fromEntries(Object.entries(value.owed).filter(([id, amount]) => id && Number.isFinite(amount) && amount > 0)) : {};
    return { population, tier, progress, consumed, cells, owed };
  }

  // Steady flows a tier asks for: everything the earlier tiers needed.
  function flows(tierIndex) {
    const resources = new Set(Data.tiers.slice(0, tierIndex).flatMap(tier => Object.keys(tier.needs)));
    return Object.fromEntries([...resources].map(id => [id, Data.flowPerMinute[id] || 0]).filter(([, rate]) => rate > 0));
  }

  // A flow is met while it is less than a minute behind.
  function flowsMet(colony) {
    return Object.entries(flows(colony.tier)).every(([id, rate]) => (colony.owed[id] || 0) < rate);
  }

  const colonies = state => (state.surfaceBuildings || []).filter(building => building.type === 'colony');

  // Buildings a tier asks for (tier.requires): each must stand assembled on
  // the colony's planet. Returns, per type, whether it does.
  function requirements(state, building, tier) {
    return Object.fromEntries((tier?.requires || []).map(type => [type, (state.surfaceBuildings || []).some(candidate =>
      candidate.type === type && candidate.planetId === building.planetId && candidate.constructionState === 'complete')]));
  }

  // What the current tier still asks for, or null once every tier is done.
  function needs(colony) {
    const tier = Data.tiers[colony?.tier ?? 0];
    if (!tier) return null;
    return Object.fromEntries(Object.entries(tier.needs).map(([id, amount]) => [id, Math.max(0, amount - (colony.progress[id] || 0))]));
  }

  function advance(state, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Colony time must be finite and non-negative');
    const events = [];
    const active = colonies(state).filter(building => building.constructionState === 'complete');
    if (active.length) state.contextPoints = (state.contextPoints || 0) + Data.contextPerMinute * seconds / 60;
    for (const building of active) {
      const colony = building.colony = normalize(building.colony);
      const tier = Data.tiers[colony.tier];
      if (!tier) continue;
      const stock = building.inventory ||= {};
      const take = (resourceId, wanted) => {
        const amount = Math.min(Math.floor(stock[resourceId] || 0), Math.floor(wanted));
        if (amount <= 0) return 0;
        stock[resourceId] -= amount;
        if (stock[resourceId] <= 0) { delete stock[resourceId]; if (building.inventoryMix) delete building.inventoryMix[resourceId]; }
        colony.consumed += amount;
        return amount;
      };
      // Flows first: what is owed grows with time (at most two minutes' worth)
      // and is paid in whole units from what arrived.
      for (const [resourceId, rate] of Object.entries(flows(colony.tier))) {
        const owed = Math.min(2 * rate, (colony.owed[resourceId] || 0) + rate * seconds / 60);
        const left = owed - take(resourceId, owed);
        if (left > 0) colony.owed[resourceId] = left; else delete colony.owed[resourceId];
      }
      if (!flowsMet(colony)) continue;
      for (const [resourceId, need] of Object.entries(tier.needs)) {
        const taken = take(resourceId, need - (colony.progress[resourceId] || 0));
        if (taken) colony.progress[resourceId] = (colony.progress[resourceId] || 0) + taken;
      }
      if (Object.entries(tier.needs).every(([id, amount]) => (colony.progress[id] || 0) >= amount) &&
          Object.values(requirements(state, building, tier)).every(Boolean)) {
        colony.tier += 1;
        colony.population = tier.population;
        colony.progress = {}; colony.owed = {};
        events.push({ kind: 'tier', buildingId: building.id, tier: colony.tier, population: colony.population });
      }
    }
    return events;
  }

  // Population of every colony; the galaxy total for now is the single colony.
  function totalPopulation(state) {
    return colonies(state).reduce((sum, building) => sum + normalize(building.colony).population, 0);
  }

  // Terrain cells the colony's zone should cover, from what it has consumed.
  function targetCells(colony, cellKm2) {
    const zone = Data.zone, km2 = Math.min(zone.maxKm2, zone.baseKm2 + zone.km2PerUnit * (colony?.consumed || 0));
    return Math.max(1, Math.round(km2 / cellKm2));
  }

  root.OrbitColony = Object.freeze({ normalize, needs, flows, flowsMet, requirements, advance, totalPopulation, targetCells, colonies });
})(globalThis);
