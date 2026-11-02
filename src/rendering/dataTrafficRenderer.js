(function (root) {
  'use strict';

  // Data in the system view: a thin blue line between both ends of each
  // transfer in flight, and one dot per sending (an antenna's packets of
  // different kinds leave together) moving along it; labs orbiting gas
  // giants show beside their planet. Purely visual (state.dataTransit).
  const STYLE = Object.freeze({ color: '#9fd8ff', lineOpacity: .4, lineWidthPx: 1, packetOpacity: .95, packetRadiusPx: 2.2 });
  const LAB = Object.freeze({ radiusPx: 7, fill: '#163a52', pendingFill: '#0d1d2b', selected: '#efa35a' });

  function draw(ctx, { state, system, camera, project }) {
    const Transit = root.OrbitDataTransit, time = state.simulation.time;
    if (!Transit) return;
    const packets = (state.dataTransit?.packets || []).filter(packet => packet.systemId === system.id &&
      packet.departureTime <= time && packet.arrivalTime > time).slice(0, 64);
    const drawn = new Set(), sent = new Set();
    ctx.save();
    ctx.strokeStyle = STYLE.color; ctx.fillStyle = STYLE.color; ctx.lineWidth = STYLE.lineWidthPx;
    for (const packet of packets) {
      const at = Transit.packetPosition(packet, system, time);
      if (!at) continue;
      // One line per pair of ends, however many packets travel it.
      const key = `${packet.fromPlanetId}>${packet.toKind}:${packet.toPlanetId || ''}`;
      if (!drawn.has(key)) {
        drawn.add(key);
        const from = project(at.from.x, at.from.y, camera), to = project(at.to.x, at.to.y, camera);
        ctx.globalAlpha = STYLE.lineOpacity;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      }
      const sending = `${packet.fromId}|${packet.departureTime}|${key}`;
      if (sent.has(sending)) continue;
      sent.add(sending);
      const point = project(at.x, at.y, camera);
      ctx.globalAlpha = STYLE.packetOpacity;
      ctx.beginPath(); ctx.arc(point.x, point.y, STYLE.packetRadiusPx, 0, Math.PI * 2); ctx.fill();
    }
    // Labs in orbit of gas giants: a small hexagon beside their planet (tap
    // it to open its sheet); while assembled, a ring fills with its progress.
    for (const lab of (state.surfaceBuildings || []).filter(building => root.OrbitOrbitalLab?.isOrbitalLab(building))) {
      const planet = system.planets.find(item => item.id === lab.planetId);
      if (!planet) continue;
      const at = root.OrbitOrbitalLab.position(planet, time), point = project(at.x, at.y, camera);
      const done = lab.constructionState === 'complete', r = LAB.radiusPx;
      ctx.globalAlpha = 1; ctx.lineWidth = 1.4;
      ctx.fillStyle = done ? LAB.fill : LAB.pendingFill; ctx.strokeStyle = STYLE.color;
      ctx.beginPath();
      for (let side = 0; side < 6; side++) {
        const angle = Math.PI / 6 + side * Math.PI / 3;
        ctx[side ? 'lineTo' : 'moveTo'](point.x + Math.cos(angle) * r, point.y + Math.sin(angle) * r);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = STYLE.color; ctx.beginPath(); ctx.arc(point.x, point.y, r * .32, 0, Math.PI * 2); ctx.fill();
      if (!done) {
        ctx.lineWidth = 2; ctx.globalAlpha = .9;
        ctx.beginPath(); ctx.arc(point.x, point.y, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (lab.constructionProgress || 0)); ctx.stroke();
      }
      if (state.selected?.id === lab.id) {
        ctx.globalAlpha = .8; ctx.lineWidth = 1; ctx.strokeStyle = LAB.selected;
        ctx.beginPath(); ctx.arc(point.x, point.y, r + 7, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  root.OrbitDataTrafficRenderer = Object.freeze({ draw });
})(globalThis);
