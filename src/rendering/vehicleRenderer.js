(function (root) {
  'use strict';

  // Transfers between buildings, shown as light pulses running along the
  // built road from the source beacon to the destination one, like a beam in
  // an optical fiber. Visual only: the transfer itself is immediate.
  const BUILD_EPSILON = 1e-6;
  const routeCache = new WeakMap();

  function built(segment) {
    return Number.isFinite(segment.length) && Number.isFinite(segment.builtLength) &&
      segment.builtLength + BUILD_EPSILON >= segment.length;
  }

  // Shortest built route between two buildings, as world points: roads, and
  // sea lanes between ports (a port's land and marine nodes are joined
  // through the building, where goods pass from trucks to ships).
  function routeBetween(network, sourceId, destinationId) {
    let cache = routeCache.get(network);
    const version = network.segments.length + ':' + network.nodes.length + ':' +
      network.segments.reduce((sum, segment) => sum + (segment.builtLength || 0), 0);
    if (!cache || cache.version !== version) { cache = { version, routes: new Map() }; routeCache.set(network, cache); }
    const key = sourceId + '>' + destinationId;
    if (cache.routes.has(key)) return cache.routes.get(key);
    const edges = new Map();
    const link = (from, to, segment, forward) => {
      const list = edges.get(from) || []; list.push({ to, segment, forward }); edges.set(from, list);
    };
    for (const segment of network.segments) {
      if (!built(segment)) continue;
      link(segment.from, segment.to, segment, true); link(segment.to, segment.from, segment, false);
    }
    const byBuilding = new Map();
    for (const node of network.nodes) if (node.buildingId) {
      const list = byBuilding.get(node.buildingId) || []; list.push(node); byBuilding.set(node.buildingId, list);
    }
    for (const nodes of byBuilding.values()) for (const a of nodes) for (const b of nodes) if (a !== b) {
      const through = { points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], length: Math.hypot(b.x - a.x, b.y - a.y) };
      link(a.id, b.id, through, true);
    }
    const isEnd = (node, buildingId) => node.buildingId === buildingId;
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
      // Each point remembers whether the stretch leading to it is at sea.
      for (const leg of legs) {
        const sea = leg.segment.routeType === 'marine';
        const part = (leg.forward ? leg.segment.points : leg.segment.points.slice().reverse()).map(point => ({ x: point.x, y: point.y, sea }));
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

  // Distance covered (in effective km) after `time` ms: the speed rises from
  // startSpeedFraction to the cruise speed over accelerationMs, then holds.
  function travelled(style, time) {
    const cruise = 1 / style.cruiseMsPerKm, ramp = style.accelerationMs, start = style.startSpeedFraction;
    if (time <= ramp) return cruise * (start * time + (1 - start) * time * time / (2 * ramp));
    return cruise * (start * ramp + (1 - start) * ramp / 2) + cruise * (time - ramp);
  }

  function travelTime(style, distance) {
    const cruise = 1 / style.cruiseMsPerKm, ramp = style.accelerationMs, start = style.startSpeedFraction;
    const rampDistance = travelled(style, ramp);
    if (distance > rampDistance) return ramp + (distance - rampDistance) / cruise;
    const a = cruise * (1 - start) / (2 * ramp), b = cruise * start;
    return (-b + Math.sqrt(b * b + 4 * a * distance)) / (2 * a);
  }

  function speedAt(style, time) {
    return (style.startSpeedFraction + (1 - style.startSpeedFraction) * Math.min(1, time / style.accelerationMs)) / style.cruiseMsPerKm;
  }

  function render(frame) {
    const state = frame.state, network = state.roadNetworks?.[frame.planet.id], activity = state.transportActivity;
    if (!network || !activity || state.paused) return;
    const style = root.OrbitRoadConfig.render.transit, simulationTime = state.simulation?.time ?? 0;
    const buildings = new Map((state.surfaceBuildings || []).map(building => [building.id, building]));
    const corner = root.OrbitRoadRenderer?.beaconCorner;
    const ctx = frame.context, now = frame.now || 0;
    // Only the most recently used links pulse, so a busy colony stays readable.
    const links = Object.entries(activity).filter(([, lastTime]) => simulationTime - lastTime <= style.activeSeconds)
      .sort((a, b) => b[1] - a[1]).slice(0, style.maxLinks);
    for (const [key] of links) {
      const [sourceId, destinationId] = key.split('>');
      const source = buildings.get(sourceId), destination = buildings.get(destinationId);
      if (!source || !destination || source.planetId !== frame.planet.id) continue;
      const route = routeBetween(network, sourceId, destinationId);
      if (!route || route.length < 2) continue;
      // From the source beacon's corner to the destination beacon's corner.
      const points = corner
        ? [corner(frame, source, route[0]), ...route, corner(frame, destination, route[route.length - 1])] : route;
      const screen = points.map(point => frame.project(point.x, point.y)), lengths = [0];
      // Effective distance along the route: sea lanes count seaSlowdown times.
      const effective = [0];
      for (let i = 1; i < screen.length; i++) {
        lengths.push(lengths[i - 1] + Math.hypot(screen[i].x - screen[i - 1].x, screen[i].y - screen[i - 1].y));
        const km = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
        effective.push(effective[i - 1] + km * (points[i].sea ? style.seaSlowdown : 1));
      }
      if (lengths[lengths.length - 1] < 4) continue;
      const routeLength = effective[effective.length - 1], duration = travelTime(style, routeLength);
      // Screen distance at an effective distance along the route.
      const screenAt = distance => {
        let index = 1;
        while (index < effective.length - 1 && effective[index] < distance) index++;
        const span = effective[index] - effective[index - 1] || 1, t = Math.max(0, Math.min(1, (distance - effective[index - 1]) / span));
        return lengths[index - 1] + (lengths[index] - lengths[index - 1]) * t;
      };
      // One pulse at a time per link: the next leaves once the last has struck
      // (and a short pause), however long the route.
      const period = Math.max(style.intervalMs, duration + style.impactMs + style.pauseMs);
      const offset = pairPhase(key) * period;
      ctx.save();
      ctx.lineCap = 'round';
      const latest = Math.floor((now - offset) / period);
      for (let pulse = latest; pulse >= 0 && now - (offset + pulse * period) < duration + style.impactMs; pulse--) {
        const age = now - (offset + pulse * period);
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
        // Slow start, then a capped cruise speed into the target.
        const reached = Math.min(routeLength, travelled(style, age)), head = screenAt(reached);
        const tail = Math.min(style.tailMaxPx, head - screenAt(Math.max(0, reached - speedAt(style, age) * style.tailMs)));
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

  root.OrbitVehicleRenderer = Object.freeze({ render, routeBetween, travelTime });
})(globalThis);
