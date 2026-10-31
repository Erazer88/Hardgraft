(function (root) {
  'use strict';

  // Data in the system view: a faint blue line between both ends of each
  // transfer in flight, and each packet as a small square gliding along it;
  // labs orbiting gas giants. Purely visual (state.dataTransit).
  const STYLE = Object.freeze({ line: '#6fc8ff', packet: '#d8f2ff', lineOpacity: .25, packetOpacity: .9, packetSizePx: 2.6 });

  function draw(ctx, { state, system, camera, project }) {
    const Transit = root.OrbitDataTransit, time = state.simulation.time;
    if (!Transit) return;
    const packets = (state.dataTransit?.packets || []).filter(packet => packet.systemId === system.id &&
      packet.departureTime <= time && packet.arrivalTime > time).slice(0, 64);
    const drawn = new Set();
    ctx.save();
    for (const packet of packets) {
      const at = Transit.packetPosition(packet, system, time);
      if (!at) continue;
      const from = project(at.from.x, at.from.y, camera), to = project(at.to.x, at.to.y, camera);
      const key = `${packet.fromPlanetId}>${packet.toKind}:${packet.toPlanetId || ''}`;
      if (!drawn.has(key)) {
        drawn.add(key);
        ctx.globalAlpha = STYLE.lineOpacity; ctx.strokeStyle = STYLE.line; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      const x = from.x + (to.x - from.x) * at.progress, y = from.y + (to.y - from.y) * at.progress, size = STYLE.packetSizePx;
      ctx.globalAlpha = STYLE.packetOpacity; ctx.fillStyle = STYLE.packet;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
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
