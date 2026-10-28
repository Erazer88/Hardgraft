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
    return { population, tier, progress, consumed, cells };
  }

  const colonies = state => (state.surfaceBuildings || []).filter(building => building.type === 'colony');

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
      for (const [resourceId, need] of Object.entries(tier.needs)) {
        const take = Math.min(Math.floor(stock[resourceId] || 0), need - (colony.progress[resourceId] || 0));
        if (take <= 0) continue;
        stock[resourceId] -= take;
        if (stock[resourceId] <= 0) { delete stock[resourceId]; if (building.inventoryMix) delete building.inventoryMix[resourceId]; }
        colony.progress[resourceId] = (colony.progress[resourceId] || 0) + take;
        colony.consumed += take;
      }
      if (Object.entries(tier.needs).every(([id, amount]) => (colony.progress[id] || 0) >= amount)) {
        colony.tier += 1;
        colony.population = tier.population;
        colony.progress = {};
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

  root.OrbitColony = Object.freeze({ normalize, needs, advance, totalPopulation, targetCells, colonies });
})(globalThis);
