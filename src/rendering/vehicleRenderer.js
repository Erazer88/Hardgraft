(function (root) {
  'use strict';

  // Transfers between buildings, shown as light pulses running along the
  // built road from the source beacon to the destination one, like a beam in
  // an optical fiber. Visual only: the transfer itself is immediate.
  const BUILD_EPSILON = 1e-6;
  const routeCache = new WeakMap();

  function builtLand(segment) {
    return segment.routeType !== 'marine' && Number.isFinite(segment.length) &&
      Number.isFinite(segment.builtLength) && segment.builtLength + BUILD_EPSILON >= segment.length;
  }

  // Shortest built land route between two buildings, as world points.
  function routeBetween(network, sourceId, destinationId) {
    let cache = routeCache.get(network);
    const version = network.segments.length + ':' + network.segments.reduce((sum, segment) => sum + (segment.builtLength || 0), 0);
    if (!cache || cache.version !== version) { cache = { version, routes: new Map() }; routeCache.set(network, cache); }
    const key = sourceId + '>' + destinationId;
    if (cache.routes.has(key)) return cache.routes.get(key);
    const edges = new Map();
    for (const segment of network.segments) {
      if (!builtLand(segment)) continue;
      for (const [from, to, forward] of [[segment.from, segment.to, true], [segment.to, segment.from, false]]) {
        const list = edges.get(from) || []; list.push({ to, segment, forward }); edges.set(from, list);
      }
    }
    const isEnd = (node, buildingId) => node.buildingId === buildingId && node.connectionMode !== 'marine';
    const targets = new Set(network.nodes.filter(node => isEnd(node, destinationId)).map(node => node.id));
    const best = new Map(), previous = new Map(), open = [];
    for (const node of network.nodes) if (isEnd(node, sourceId)) { best.set(node.id, 0); open.push(node.id); }
    let reached = null;
    while (open.length) {
      open.sort((a, b) => best.get(a) - best.get(b));
      const current = open.shift();
      if (targets.has(current)) { reached = current; break; }
      for (const edge of edges.get(current) || []) {
        const distance = best.get(current) + edge.segment.length;
        if (distance >= (best.get(edge.to) ?? Infinity)) continue;
        best.set(edge.to, distance); previous.set(edge.to, { from: current, edge });
        if (!open.includes(edge.to)) open.push(edge.to);
      }
    }
    let points = null;
    if (reached) {
      const legs = [];
      for (let node = reached; previous.has(node); node = previous.get(node).from) legs.unshift(previous.get(node).edge);
      points = [];
      for (const leg of legs) {
        const part = leg.forward ? leg.segment.points : leg.segment.points.slice().reverse();
        points.push(...(points.length ? part.slice(1) : part));
      }
    }
    cache.routes.set(key, points);
    return points;
  }

  function pairPhase(key) {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
    return (hash >>> 0) / 4294967296;
  }

  // Point at a distance along a polyline with cumulative lengths.
  function pointAt(points, lengths, distance) {
    let index = 1;
    while (index < lengths.length - 1 && lengths[index] < distance) index++;
    const span = lengths[index] - lengths[index - 1] || 1, t = Math.max(0, Math.min(1, (distance - lengths[index - 1]) / span));
    const a = points[index - 1], b = points[index];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function render(frame) {
    const state = frame.state, network = state.roadNetworks?.[frame.planet.id], activity = state.transportActivity;
    if (!network || !activity || state.paused) return;
    const style = root.OrbitRoadConfig.render.transit, simulationTime = state.simulation?.time ?? 0;
    const buildings = new Map((state.surfaceBuildings || []).map(building => [building.id, building]));
    const corner = root.OrbitRoadRenderer?.beaconCorner;
    const ctx = frame.context, now = frame.now || 0;
    for (const [key, lastTime] of Object.entries(activity)) {
      if (simulationTime - lastTime > style.activeSeconds) continue;
      const [sourceId, destinationId] = key.split('>');
      const source = buildings.get(sourceId), destination = buildings.get(destinationId);
      if (!source || !destination || source.planetId !== frame.planet.id) continue;
      const route = routeBetween(network, sourceId, destinationId);
      if (!route || route.length < 2) continue;
      // From the source beacon's corner to the destination beacon's corner.
      const points = corner
        ? [corner(frame, source, route[0]), ...route, corner(frame, destination, route[route.length - 1])] : route;
      const screen = points.map(point => frame.project(point.x, point.y)), lengths = [0];
      for (let i = 1; i < screen.length; i++) lengths.push(lengths[i - 1] + Math.hypot(screen[i].x - screen[i - 1].x, screen[i].y - screen[i - 1].y));
      const total = lengths[lengths.length - 1];
      if (total < 4) continue;
      const routeKm = route.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - route[i].x, point.y - route[i].y), 0);
      const duration = Math.max(style.durationMs[0], Math.min(style.durationMs[1], style.durationMs[0] + routeKm * style.durationPerKm));
      const offset = pairPhase(key) * style.intervalMs;
      ctx.save();
      ctx.lineCap = 'round';
      // Every pulse still running or striking its target.
      const latest = Math.floor((now - offset) / style.intervalMs);
      for (let pulse = latest; pulse >= 0 && now - (offset + pulse * style.intervalMs) < duration + style.impactMs; pulse--) {
        const age = now - (offset + pulse * style.intervalMs);
        if (age < 0) continue;
        if (age >= duration) {
          // The strike: a ring that widens and fades on the destination beacon.
          const impact = (age - duration) / style.impactMs, center = frame.project(destination.x, destination.y);
          ctx.globalAlpha = (1 - impact) * .8;
          ctx.strokeStyle = style.glowColor; ctx.lineWidth = 1.6 * (1 - impact) + .4;
          ctx.shadowColor = style.glowColor; ctx.shadowBlur = style.glowBlurPx;
          ctx.beginPath(); ctx.arc(center.x, center.y, style.impactRadiusPx * (.7 + impact * .9), 0, Math.PI * 2); ctx.stroke();
          continue;
        }
        // Slow start, then a quick acceleration into the target.
        const progress = Math.pow(age / duration, style.easePower), head = progress * total;
        const speed = style.easePower * Math.pow(age / duration, style.easePower - 1);
        const tail = style.tailPx * Math.min(1.6, .25 + speed * .55);
        ctx.shadowColor = style.glowColor; ctx.shadowBlur = style.glowBlurPx;
        for (let step = 0; step < style.tailSteps; step++) {
          const from = Math.max(0, head - tail * (step + 1) / style.tailSteps), to = Math.max(0, head - tail * step / style.tailSteps);
          if (to <= from) continue;
          const a = pointAt(screen, lengths, from), b = pointAt(screen, lengths, to);
          ctx.globalAlpha = (1 - step / style.tailSteps) * .9;
          ctx.strokeStyle = step < 2 ? style.color : style.glowColor;
          ctx.lineWidth = 3 * (1 - step / style.tailSteps) + .5;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        const tip = pointAt(screen, lengths, head);
        ctx.globalAlpha = 1; ctx.fillStyle = style.color;
        ctx.beginPath(); ctx.arc(tip.x, tip.y, style.headRadiusPx, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  root.OrbitVehicleRenderer = Object.freeze({ render, routeBetween });
})(globalThis);
