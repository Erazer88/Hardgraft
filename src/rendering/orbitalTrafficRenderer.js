(function (root) {
  'use strict';

  const Transit = root.OrbitOrbitalTransit;
  const Resources = root.OrbitResourceData;

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
      const curve = Transit.trajectoryFor(lot, system);
      if (!curve) continue;
      const p0 = project(curve.p0.x, curve.p0.y, camera), p1 = project(curve.p1.x, curve.p1.y, camera);
      const p2 = project(curve.p2.x, curve.p2.y, camera), p3 = project(curve.p3.x, curve.p3.y, camera);
      if (!paths.has(lot.corridorId)) {
        paths.add(lot.corridorId);
        ctx.save(); ctx.strokeStyle = '#8cb6ba28'; ctx.lineWidth = .8; ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y); ctx.stroke(); ctx.restore();
      }
      const current = Transit.cargoPosition(lot, system, time);
      if (!current) continue;
      const point = project(current.x, current.y, camera), color = cargoColor(lot.resourceId);
      circle(ctx, point.x, point.y, 5.5, color + '52', 2);
      line(ctx, [{ x: point.x - 3.5, y: point.y }, { x: point.x + 3.5, y: point.y }], color, 1.4);
    }
  }

  root.OrbitOrbitalTrafficRenderer = Object.freeze({ drawArk, drawTraffic });
})(globalThis);
