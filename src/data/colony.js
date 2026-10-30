(function (root) {
  'use strict';

  // The colony: population, context and the tiers it climbs by consuming
  // what it receives by road. Values are first drafts.
  const colony = {
    startingPopulation: 100,
    // Context flows from the colony from the start, at a steady rate.
    contextPerMinute: 1,
    // Built-up zone: grows from its seed along its relief layer (±layers),
    // never over water or other buildings, one terrain cell (9 km²) at a time.
    // layerStep matches the relief bands drawn on the map.
    zone: { baseKm2: 600, km2PerUnit: 1, maxKm2: 6000, layers: 1, layerStep: 16, reachFactor: 1.6, buildingMarginCells: 1 },
    // Each tier consumes what it needs, then raises the population. From the
    // next tier on, what earlier tiers asked for must keep arriving as a
    // steady flow (per minute): a tier's needs only progress while those
    // flows are met.
    flowPerMinute: { raw_rock: 500, tar: 25, metal_plate: 1 },
    tiers: [
      { population: 200, needs: { raw_rock: 1000 } },
      { population: 400, needs: { tar: 150 } },
      { population: 800, needs: { metal_plate: 25 } }
    ]
  };

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }

  root.OrbitColonyData = freeze(colony);
})(globalThis);
