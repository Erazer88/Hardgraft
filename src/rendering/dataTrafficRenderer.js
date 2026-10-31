(function (root) {
  'use strict';

  // Data in the system view: a thin blue line between both ends of each
  // transfer in flight, an electric impulse running along it for each packet,
  // and labs orbiting gas giants. Purely visual (state.dataTransit).
  const STYLE = Object.freeze({ line: '#6fc8ff', impulse: '#e8f8ff', lineOpacity: .35, impulseLength: .06 });

  function draw(ctx, { state, system, camera, project }) {
    const Transit = root.OrbitDataTransit, time = state.simulation.time;
    if (!Transit) return;
    const packets = (state.dataTransit?.packets || []).filter(packet => packet.systemId === system.id &&
      packet.departureTime <= time && packet.arrivalTime > time).slice(0, 48);
    const drawn = new Set();
    ctx.save();
    ctx.lineCap = 'round';
    for (const packet of packets) {
      const at = Transit.packetPosition(packet, system, time);
      if (!at) continue;
      const from = project(at.from.x, at.from.y, camera), to = project(at.to.x, at.to.y, camera);
      const key = `${packet.fromPlanetId}>${packet.toKind}:${packet.toPlanetId || ''}`;
      if (!drawn.has(key)) {
        drawn.add(key);
        ctx.globalAlpha = STYLE.lineOpacity; ctx.strokeStyle = STYLE.line; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      }
      // The impulse: a short zigzag that flickers, glowing blue.
      const head = at.progress, tail = Math.max(0, head - STYLE.impulseLength);
      const along = t => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
      const a = along(tail), b = along(head), length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
      const flicker = Math.sin(time * 37 + packet.departureTime * 13);
      ctx.globalAlpha = 1; ctx.strokeStyle = STYLE.impulse; ctx.lineWidth = 1.6;
      ctx.shadowColor = STYLE.line; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      for (const [t, side] of [[.33, 1], [.66, -1]]) {
        ctx.lineTo(a.x + (b.x - a.x) * t + normal.x * 3 * side * flicker, a.y + (b.y - a.y) * t + normal.y * 3 * side * flicker);
      }
      ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // Labs in orbit of gas giants: a small blue ring around their planet.
    for (const lab of (state.surfaceBuildings || []).filter(building => building.type === 'lab' && building.siteKind === 'gazeuse')) {
      const planet = system.planets.find(item => item.id === lab.planetId);
      if (!planet) continue;
      const center = root.OrbitWorld.planetPosition(planet, time), angle = time * .6;
      const point = project(center.x + Math.cos(angle) * planet.radius * 1.8, center.y + Math.sin(angle) * planet.radius * 1.8, camera);
      ctx.globalAlpha = lab.constructionState === 'complete' ? 1 : .5;
      ctx.fillStyle = STYLE.line; ctx.beginPath(); ctx.arc(point.x, point.y, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  root.OrbitDataTrafficRenderer = Object.freeze({ draw });
})(globalThis);
