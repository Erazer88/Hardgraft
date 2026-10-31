(function (root) {
  'use strict';

  // Data in the system view: a thin blue line between both ends of each
  // transfer in flight, and each packet as a dot moving along it; labs
  // orbiting gas giants show beside their planet. Purely visual (state.dataTransit).
  const STYLE = Object.freeze({ color: '#9fd8ff', lineOpacity: .4, lineWidthPx: 1, packetOpacity: .95, packetRadiusPx: 2.2 });

  function draw(ctx, { state, system, camera, project }) {
    const Transit = root.OrbitDataTransit, time = state.simulation.time;
    if (!Transit) return;
    const packets = (state.dataTransit?.packets || []).filter(packet => packet.systemId === system.id &&
      packet.departureTime <= time && packet.arrivalTime > time).slice(0, 64);
    const drawn = new Set();
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
      const point = project(at.x, at.y, camera);
      ctx.globalAlpha = STYLE.packetOpacity;
      ctx.beginPath(); ctx.arc(point.x, point.y, STYLE.packetRadiusPx, 0, Math.PI * 2); ctx.fill();
    }
    // Labs in orbit of gas giants: a small blue ring around their planet.
    for (const lab of (state.surfaceBuildings || []).filter(building => building.type === 'lab' && building.siteKind === 'gazeuse')) {
      const planet = system.planets.find(item => item.id === lab.planetId);
      if (!planet) continue;
      const center = root.OrbitWorld.planetPosition(planet, time), angle = time * .6;
      const point = project(center.x + Math.cos(angle) * planet.radius * 1.8, center.y + Math.sin(angle) * planet.radius * 1.8, camera);
      ctx.globalAlpha = lab.constructionState === 'complete' ? 1 : .5;
      ctx.fillStyle = STYLE.color; ctx.beginPath(); ctx.arc(point.x, point.y, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  root.OrbitDataTrafficRenderer = Object.freeze({ draw });
})(globalThis);
