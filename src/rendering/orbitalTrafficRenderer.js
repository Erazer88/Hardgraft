(function (root) {
  'use strict';

  const Transit = root.OrbitOrbitalTransit;
  const trajectoryCache = new Map();

  function flightKey(lot, system) {
    const planet = system.planets.find(item => item.id === lot.originPlanetId), ark = system.ark;
    return [lot.systemId, lot.corridorId, lot.originPlanetId, lot.departureTime,
      lot.arrivalTime, lot.trajectoryVersion || 1, planet?.orbit, planet?.radius,
      planet?.phase, planet?.speed, ark?.orbit, ark?.phase, ark?.speed].join('|');
  }

  function drawArk(ctx, { state, system, camera, project, circle, line, label }) {
    const ark = system.ark;
    if (!ark) return;
    const world = Transit.arkPosition(ark, system.star, state.simulation.time), p = project(world.x, world.y, camera);
    if (p.x < -28 || p.x > ctx.canvas.clientWidth + 28 || p.y < -28 || p.y > ctx.canvas.clientHeight + 28) return;
    const selected = state.selected?.kind === 'orbital-hub' && state.selected.id === ark.id;
    circle(ctx, p.x, p.y, selected ? 14 : 11, selected ? '#efbd7f' : '#b9d6d6', selected ? 1.4 : 1);
    line(ctx, [{ x: p.x - 7, y: p.y - 4 }, { x: p.x + 7, y: p.y + 4 }], '#d3ded6', 1);
    line(ctx, [{ x: p.x - 6, y: p.y + 5 }, { x: p.x + 5, y: p.y - 5 }], '#d3ded6', 1);
    circle(ctx, p.x, p.y, 2.5, '#efbd7f', 1);
    label(ctx, 'L’ARCHE · HUB ORBITAL', p.x + 16, p.y - 10, selected ? '#efbd7f' : '#a6c1c7', 8);
  }

  // One freight leaves each hub a minute: its lots (one per resource) fly
  // together and show as one ship with its load; a ring marks the launch.
  const LAUNCH_FLASH_SECONDS = 2.5;
  function drawTraffic(ctx, { state, system, camera, project, label, line, circle }) {
    const time = state.simulation.time;
    const flights = new Map();
    for (const lot of state.orbitalLogistics?.transit || []) {
      if (lot.systemId !== system.id || lot.departureTime > time || lot.arrivalTime <= time) continue;
      const key = `${lot.corridorId}|${lot.departureTime}`;
      const flight = flights.get(key) || { lot, amount: 0 };
      flight.amount += lot.amount;
      flights.set(key, flight);
    }
    const paths = new Set();
    for (const { lot, amount } of [...flights.values()].slice(0, 16)) {
      const key = flightKey(lot, system);
      let route = trajectoryCache.get(key);
      if (!route) {
        const curve = Transit.trajectoryFor(lot, system);
        if (!curve) continue;
        route = { curve, samples: Transit.trajectorySamples(curve, 48) };
        trajectoryCache.set(key, route);
        while (trajectoryCache.size > 128) trajectoryCache.delete(trajectoryCache.keys().next().value);
      }
      const planet = system.planets.find(item => item.id === lot.originPlanetId);
      if (!paths.has(lot.corridorId)) {
        paths.add(lot.corridorId);
        const liveRoute = Transit.previewTrajectory(system, planet, time);
        if (liveRoute) {
          const samples = Transit.trajectorySamples(liveRoute, 64);
          line(ctx, samples.map(point => project(point.x, point.y, camera)), '#efbd7f55', 1.35, [4, 4]);
        }
      }
      // The launch: a ring that widens from the planet.
      const age = time - lot.departureTime;
      if (age < LAUNCH_FLASH_SECONDS && planet) {
        const start = project(route.curve.p0.x, route.curve.p0.y, camera), t = age / LAUNCH_FLASH_SECONDS;
        ctx.save(); ctx.globalAlpha = 1 - t;
        circle(ctx, start.x, start.y, 4 + t * 16, '#efbd7f', 1.4);
        ctx.restore();
      }
      const current = Transit.cargoPosition(lot, system, time, route.curve);
      if (!current) continue;
      const point = project(current.x, current.y, camera);
      circle(ctx, point.x, point.y, 4, '#efbd7f88', 1.2);
      line(ctx, [{ x: point.x - 2.4, y: point.y }, { x: point.x + 2.4, y: point.y }], '#ffe2b8', 1);
      label(ctx, `${amount} u`, point.x + 7, point.y - 7, '#d9b98f', 8);
    }
  }

  root.OrbitOrbitalTrafficRenderer = Object.freeze({ drawArk, drawTraffic });
})(globalThis);
