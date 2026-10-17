(function (root) {
  'use strict';

  const Transit = root.OrbitOrbitalTransit;
  const Resources = root.OrbitResourceData;
  const trajectoryCache = new Map();

  function flightKey(lot, system) {
    const planet = system.planets.find(item => item.id === lot.originPlanetId), ark = system.ark;
    return [lot.systemId, lot.corridorId, lot.originPlanetId, lot.departureTime,
      lot.arrivalTime, lot.trajectoryVersion || 1, planet?.orbit, planet?.radius,
      planet?.phase, planet?.speed, ark?.orbit, ark?.phase, ark?.speed].join('|');
  }

  function cargoColor(resourceId) {
    const family = Resources.get(resourceId)?.family;
    return family === 'waste' ? '#e1a36b' : family === 'metal' ? '#85d8d0' : '#d5bf8f';
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

  function drawTraffic(ctx, { state, system, camera, project, label, line, circle }) {
    const time = state.simulation.time;
    const lots = (state.orbitalLogistics?.transit || []).filter(lot => lot.systemId === system.id &&
      lot.departureTime <= time && lot.arrivalTime > time).slice(0, 32);
    const paths = new Set();
    for (const lot of lots) {
      const key = flightKey(lot, system);
      let route = trajectoryCache.get(key);
      if (!route) {
        const curve = Transit.trajectoryFor(lot, system);
        if (!curve) continue;
        route = { curve, samples: Transit.trajectorySamples(curve, 48) };
        trajectoryCache.set(key, route);
        while (trajectoryCache.size > 128) trajectoryCache.delete(trajectoryCache.keys().next().value);
      }
      if (!paths.has(lot.corridorId)) {
        paths.add(lot.corridorId);
        const planet = system.planets.find(item => item.id === lot.originPlanetId);
        const liveRoute = Transit.previewTrajectory(system, planet, time);
        if (liveRoute) {
          const samples = Transit.trajectorySamples(liveRoute, 64);
          line(ctx, samples.map(point => project(point.x, point.y, camera)), '#efbd7f55', 1.35, [4, 4]);
        }
      }
      const current = Transit.cargoPosition(lot, system, time, route.curve);
      if (!current) continue;
      const point = project(current.x, current.y, camera), color = cargoColor(lot.resourceId);
      circle(ctx, point.x, point.y, 2.75, color + '52', 1);
      line(ctx, [{ x: point.x - 1.75, y: point.y }, { x: point.x + 1.75, y: point.y }], color, .7);
    }
  }

  root.OrbitOrbitalTrafficRenderer = Object.freeze({ drawArk, drawTraffic });
})(globalThis);
