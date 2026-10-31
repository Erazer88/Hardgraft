(function (root) {
  'use strict';

  // Data in the system view, kept quiet: each packet in flight is a small
  // dot moving from one world to the other; labs orbiting gas giants show
  // beside their planet. Purely visual (state.dataTransit).
  const STYLE = Object.freeze({ color: '#9fd8ff', packetOpacity: .75, packetRadiusPx: 1.3 });

  function draw(ctx, { state, system, camera, project }) {
    const Transit = root.OrbitDataTransit, time = state.simulation.time;
    if (!Transit) return;
    const packets = (state.dataTransit?.packets || []).filter(packet => packet.systemId === system.id &&
      packet.departureTime <= time && packet.arrivalTime > time).slice(0, 64);
    ctx.save();
    ctx.fillStyle = STYLE.color; ctx.globalAlpha = STYLE.packetOpacity;
    for (const packet of packets) {
      const at = Transit.packetPosition(packet, system, time);
      if (!at) continue;
      const point = project(at.x, at.y, camera);
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
