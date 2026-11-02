(function (root) {
  'use strict';

  // Labs in orbit of gas giants (skill "Laboratoire orbital"). Building one
  // takes its materials from the stock of the system's Ark
  // (OrbitDataNetworkData.orbitalLab.cost), then the Ark's robots assemble it
  // in buildSeconds. One lab per gas giant; it sends its data with its own
  // transmitter, to the Ark or to a high-frequency antenna (building.hfTarget).
  // No DOM.
  const settings = () => root.OrbitDataNetworkData.orbitalLab;
  const isOrbitalLab = building => building?.type === 'lab' && building.siteKind === 'gazeuse';

  // Where it orbits, in the system's own coordinates.
  function position(planet, time) {
    const center = root.OrbitWorld.planetPosition(planet, time), angle = time * .6;
    return { x: center.x + Math.cos(angle) * planet.radius * 1.8, y: center.y + Math.sin(angle) * planet.radius * 1.8 };
  }

  const arkStock = (state, systemId) => state.orbitalLogistics?.hubs?.[systemId]?.stock || {};

  // What the Ark still lacks for a lab, per resource.
  function missing(state, systemId) {
    const stock = arkStock(state, systemId);
    return Object.fromEntries(Object.entries(settings().cost).map(([id, amount]) => [id, Math.max(0, amount - (stock[id] || 0))])
      .filter(([, left]) => left > 0));
  }

  // Why no lab can be built here now (null when it can).
  function blocked(state, system, planet) {
    if (planet?.kind !== 'gazeuse') return 'Seules les géantes gazeuses reçoivent un laboratoire en orbite.';
    const rule = root.OrbitProgression.buildBlockedHere(state, 'lab', planet);
    if (rule) return rule;
    if ((state.surfaceBuildings || []).some(building => isOrbitalLab(building) && building.planetId === planet.id)) return 'Un laboratoire y est déjà en orbite.';
    if (Object.keys(missing(state, system.id)).length) return 'Stock de l’Arche insuffisant.';
    return null;
  }

  // Takes the materials from the Ark and opens the assembly; returns
  // { ok, building } or { ok: false, reason }.
  function build(state, system, planet, { id, name }) {
    const reason = blocked(state, system, planet);
    if (reason) return { ok: false, reason };
    const stock = arkStock(state, system.id);
    for (const [resourceId, amount] of Object.entries(settings().cost)) {
      stock[resourceId] -= amount;
      if (stock[resourceId] <= 0) delete stock[resourceId];
    }
    const building = root.OrbitSurfaceBuilding.create({ id, type: 'lab', planetId: planet.id, x: 0, y: 0, siteKind: 'gazeuse',
      customName: name, constructionState: 'constructing', constructionProgress: 0, status: 'building',
      constructionDurationSeconds: settings().buildSeconds, costPaid: {} });
    state.surfaceBuildings.push(building);
    return { ok: true, building };
  }

  root.OrbitOrbitalLab = Object.freeze({ isOrbitalLab, position, missing, blocked, build });
})(globalThis);
