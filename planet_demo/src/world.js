(function (root) {
  'use strict';
  const A = root.NereideAtlas;
  const {random, noise, clamp, lerp} = A;
  const Terrain = Object.freeze({
    ocean: 0, land: 1, coast: 2, plain: 3, forest: 4, hill: 5,
    mountain: 6, valley: 7, river: 8, snow: 9, lake: 10, ice: 11
  });
  const defaults = Object.freeze({continentSize: 50, mountains: 60, forests: 65, roughness: 45});
  const smoothstep = (a, b, x) => {const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t);};

  function optionsFrom(input) {
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) => {
      const n = Number(input && input[key]);
      return [key, Number.isFinite(n) ? clamp(n, 0, 100) : value];
    }));
  }
  function ellipse(x, y, b) {
    const dx = x - b.x, dy = y - b.y, angle = b.angle || 0;
    const px = dx * Math.cos(angle) + dy * Math.sin(angle);
    const py = -dx * Math.sin(angle) + dy * Math.cos(angle);
    return (Math.hypot(px / b.rx, py / b.ry) - 1) * Math.min(b.rx, b.ry);
  }
  function union(a, b, radius) {
    const h = Math.max(radius - Math.abs(a - b), 0) / radius;
    return Math.min(a, b) - h * h * radius * .25;
  }
  function metricDistance(x1, y1, x2, y2) {
    const latitude = ((y1 + y2) * .5) * Math.PI * .5;
    const dx = (x1 - x2) * Math.max(.22, Math.cos(latitude));
    return Math.hypot(dx, (y1 - y2) * .5);
  }
  function segmentDistance(x, y, a, b) {
    const latitude = (a.y + b.y + y) / 3 * Math.PI * .5;
    const cos = Math.max(.22, Math.cos(latitude));
    const ax = a.x * cos, bx = b.x * cos, px = x * cos;
    const ay = a.y * .5, by = b.y * .5, py = y * .5;
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
  }

  function createWorld(seed, input) {
    seed = A.parseSeed(seed);
    const options = optionsFrom(input);
    const {continents, mainland} = A.createGeography(seed, options);
    const islands = [], lakes = [], chains = [], peaks = [], hills = [], forestZones = [], trees = [], rivers = [], clouds = [];
    const world = {seed, options, continents, islands, lakes, chains, peaks, hills, forestZones, trees, rivers, clouds, mainland};

    function islandField(x, y, b) {
      const dx = x - b.x, dy = (y - b.y) * .5, cos = Math.cos(b.angle), sin = Math.sin(b.angle);
      const u = (dx * cos + dy * sin) / b.rx, v = (-dx * sin + dy * cos) / b.ry;
      if (Math.abs(u) > 1.8 || Math.abs(v) > 1.8) return .3;
      const n = A.gradientNoise;
      const wx = u + n(u * 2 + b.id, v * 2, seed ^ 771) * .25;
      const wy = v + n(u * 2, v * 2 - b.id, seed ^ 919) * .25;
      const angle = Math.atan2(wy, wx);
      const radius = 1 + Math.sin(angle * 3 + b.phase) * .14 + Math.cos(angle * 5 - b.phase) * .07;
      return (Math.hypot(wx, wy) - radius + n(u * 7, v * 7, seed ^ b.id) * .065) * Math.min(b.rx, b.ry);
    }
    function landDistance(x, y) {
      let d = mainland(x, y);
      for (const b of islands) {
        if (Math.abs(x - b.x) > b.bound || Math.abs(y - b.y) > b.bound * 2) continue;
        d = Math.min(d, islandField(x, y, b));
      }
      return d;
    }
    function lakeDistance(x, y) {
      let d = 1;
      for (const b of lakes) {
        const lobe = {x: b.x + Math.cos(b.angle) * b.rx * .55, y: b.y + Math.sin(b.angle) * b.ry * .55,
          rx: b.rx * .62, ry: b.ry * .68, angle: b.angle};
        const shape = union(ellipse(x, y, b), ellipse(x, y, lobe), .007);
        d = Math.min(d, shape + (noise(x * 33 + b.id, y * 25 - b.id, seed ^ b.id) - .5) * .006);
      }
      return d;
    }
    function water(x, y) { return landDistance(x, y) >= 0 || lakeDistance(x, y) <= 0; }
    function safePoint(r, margin, predicate, continent) {
      for (let i = 0; i < 1400; i++) {
        const c = continent || continents[Math.floor(r() * continents.length)];
        const p = {x: c.x + (r() - .5) * c.rx * 2, y: c.y + (r() - .5) * c.ry * 4};
        if (mainland(p.x, p.y) < -margin && lakeDistance(p.x, p.y) > .025 && (!predicate || predicate(p))) return p;
      }
      return null;
    }

    const ir = random(seed, 'islands');
    function addIsland(p, group, radius, bearing) {
      const rx = radius * (1.05 + ir() * .5), ry = radius * (.5 + ir() * .35);
      const bound = Math.max(rx, ry) * 1.45;
      const b = {...p, rx, ry, bound, angle: bearing + (ir() - .5) * .65,
        phase: ir() * Math.PI * 2, id: islands.length + 57, group};
      const d = mainland(p.x, p.y);
      if (d < bound + .006 || d > .11 || Math.abs(p.x) + bound > .87 || Math.abs(p.y) + bound * 2 > .83) return false;
      if (islands.some(other => Math.hypot(p.x - other.x, (p.y - other.y) * .5) < bound + other.bound + .004)) return false;
      islands.push(b); return true;
    }
    // Follow the coastline, then curve away from it; large inner islands taper
    // into small outer ones rather than forming a uniform ring or random dots.
    for (const c of continents) {
      for (let group = 0, groups = 2 + Math.floor(ir() * 3); group < groups; group++) {
        const origin = c.core || safePoint(ir, .025, null, c);
        if (!origin) continue;
        const bearing = ir() * Math.PI * 2;
        let coast = null;
        for (let d = .004; d < .7; d += .004) {
          const p = {x: origin.x + Math.cos(bearing) * d, y: origin.y + Math.sin(bearing) * d * 2};
          if (mainland(p.x, p.y) > 0) {coast = p; break;}
        }
        if (!coast) continue;
        const h = .003;
        let nx = mainland(coast.x + h, coast.y) - mainland(coast.x - h, coast.y);
        let ny = mainland(coast.x, coast.y + h * 2) - mainland(coast.x, coast.y - h * 2);
        const length = Math.hypot(nx, ny) || 1; nx /= length; ny /= length;
        const sign = ir() < .5 ? -1 : 1, base = .009 + ir() * .010, gap = .025 + ir() * .017;
        for (let j = 0, n = 4 + Math.floor(ir() * 4); j < n; j++) {
          const t = j / (n - 1), along = (t - .3) * (.085 + base * 3) * sign;
          const offshore = gap + t * .033 + Math.sin(t * Math.PI) * .014;
          const p = {x: coast.x + nx * offshore - ny * along, y: coast.y + (ny * offshore + nx * along) * 2};
          addIsland(p, c.id * 10 + group, base * (1 - t * .64), Math.atan2(ny, nx) + Math.PI * .5 + t * sign * .45);
        }
      }
    }
    const wantedIslands = 8 + continents.length * 4 + Math.floor(ir() * 5);
    for (let i = 0; islands.length < wantedIslands && i < 3000; i++) {
      const c = continents[Math.floor(ir() * continents.length)];
      const p = {x: c.x + (ir() - .5) * c.rx * 3, y: c.y + (ir() - .5) * c.ry * 6};
      addIsland(p, 100 + i, .005 + ir() * .009, ir() * Math.PI * 2);
    }

    const mr = random(seed, 'mountains');
    const rangeCount = options.mountains === 0 ? 0 : options.mountains < 22 ? 1 : Math.max(2, continents.length);
    function createRange(index) {
      const c = continents[index % continents.length];
      for (let attempt = 0; attempt < 90; attempt++) {
        const center = safePoint(mr, .027, p => chains.every(other => metricDistance(p.x, p.y, other.x, other.y) > .08), c);
        if (!center) continue;
        // Keep the painted peaks upright; slight variation avoids perfectly parallel rows.
        const direction = (mr() - .5) * .34;
        const span = (.07 + mr() * .08) * (attempt > 40 ? .65 : 1), phase = mr() * Math.PI * 2;
        const path = [], dx = Math.cos(direction), dy = Math.sin(direction);
        let valid = true;
        for (let i = 0; i <= 40; i++) {
          const t = i / 40, along = (t - .5) * span, bend = Math.sin(t * Math.PI * 2 + phase) * .008;
          const p = {x: center.x + dx * along - dy * bend, y: center.y + (dy * along + dx * bend) * 2};
          path.push(p); if (mainland(p.x, p.y) > -.014) valid = false;
        }
        if (!valid) continue;
        const start = path[0], end = path[path.length - 1];
        // Keep the painted massif footprint consistent across seeds. A narrow
        // variation prevents repeated stamps while staying below a 20% spread.
        const size = .10 * (.92 + mr() * .16);
        const chain = {id: index, ...center, start, end, path, direction, length: span,
          size, variant: Math.floor(mr() * 24), peaks: []};
        const count = 12 + Math.round(options.mountains * .12);
        for (let i = 0; i < count; i++) {
          const t = (i + .42 + (mr() - .5) * .35) / count, base = path[Math.min(40, Math.round(t * 40))];
          const p = {x: base.x + (mr() - .5) * .015, y: base.y + (mr() - .5) * .024};
          const clearance = -mainland(p.x, p.y);
          if (clearance < .014) continue;
          const size = Math.min(.036 + Math.sin(t * Math.PI) * .036 + mr() * .014, clearance * 1.1);
          const peak = {...p, size, variant: Math.floor(mr() * 24), angle: (mr() - .5) * .18, mirror: mr() > .5,
            snow: size > .062 || (size > .05 && mr() > .42), chain: index, major: size > .06};
          peaks.push(peak); chain.peaks.push(peak);
        }
        chains.push(chain); return chain;
      }
      return null;
    }
    for (let i = 0; i < rangeCount; i++) createRange(i);
    for (let i = 0, count = Math.round(options.mountains / 26); i < count; i++) {
      const p = safePoint(mr, .04, p => chains.every(c => metricDistance(p.x, p.y, c.x, c.y) > .045));
      if (p) peaks.push({...p, size: .025 + mr() * .018, variant: Math.floor(mr() * 24), angle: (mr() - .5) * .2,
        mirror: mr() > .5, snow: mr() > .7, chain: -1, major: false});
    }

    const lr = random(seed, 'lakes');
    const lakeCount = 1 + Math.floor(lr() * 3);
    for (let i = 0; i < lakeCount; i++) {
      const clearOfRelief = (p, clearance) => peaks.every(b => metricDistance(p.x, p.y, b.x, b.y) > clearance);
      const p = safePoint(lr, .055, p => clearOfRelief(p, .04)) ||
        safePoint(lr, .055, p => clearOfRelief(p, .022));
      if (!p) continue;
      const angle = lr() * Math.PI, rx = .014 + lr() * .012, ry = rx * (1.55 + lr() * 1.3);
      lakes.push({...p, rx, ry, angle, id: 125 + i});
    }

    const rr = random(seed, 'rivers');
    function outletFrom(source, desired, preferred, preferOcean) {
      let best = null, bestScore = Infinity;
      const offset = rr() * Math.PI * 2;
      for (let i = 0; i < 112; i++) {
        const angle = i / 112 * Math.PI * 2 + offset;
        const latitudeScale = Math.max(.5, Math.cos(source.y * Math.PI * .5));
        for (let d = .006; d < .82; d += .008) {
          const p = {x: source.x + Math.cos(angle) * d / latitudeScale, y: source.y + Math.sin(angle) * d * 2};
          if (!water(p.x, p.y)) continue;
          if (metricDistance(source.x, source.y, p.x, p.y) < .075) break;
          if (preferOcean && landDistance(p.x, p.y) < 0) break;
          const distance = metricDistance(source.x, source.y, p.x, p.y);
          const turn = Math.abs(Math.atan2(Math.sin(angle - preferred), Math.cos(angle - preferred)));
          const score = Math.abs(distance - desired) + turn * .011 + rr() * .004;
          if (score < bestScore) {best = p; bestScore = score;}
          break;
        }
      }
      return best;
    }
    function route(source, target, flow, mustStayLand, phase, bend) {
      const dx = target.x - source.x, dy = target.y - source.y;
      const length = Math.hypot(dx, dy * .5);
      if (length < .04) return null;
      const nx = -(dy * .5) / length, ny = dx / length;
      const c1 = {x: source.x + dx * .32 + nx * bend, y: source.y + dy * .32 + ny * bend * 2};
      const c2 = {x: source.x + dx * .72 - nx * bend * .38, y: source.y + dy * .72 - ny * bend * .76};
      const points = [{x: source.x, y: source.y}], samples = 112;
      for (let i = 1; i <= samples; i++) {
        const t = i / samples, q = 1 - t;
        const bx = q*q*q*source.x + 3*q*q*t*c1.x + 3*q*t*t*c2.x + t*t*t*target.x;
        const by = q*q*q*source.y + 3*q*q*t*c1.y + 3*q*t*t*c2.y + t*t*t*target.y;
        const wave = Math.sin(t * Math.PI) * Math.sin(t * Math.PI * 4 + phase) * Math.min(.022, length * .055);
        const p = {x: bx + nx * wave, y: by + ny * wave * 2};
        if (water(p.x, p.y)) {
          if (mustStayLand || i < 8 || points.length < 5) return null;
          let a = points[points.length - 1], b = p;
          for (let k = 0; k < 16; k++) {
            const m = {x: (a.x + b.x) * .5, y: (a.y + b.y) * .5};
            if (water(m.x, m.y)) b = m; else a = m;
          }
          points.push(b);
          return {points, destination: landDistance(b.x, b.y) < 0 ? 'lake' : 'ocean'};
        }
        points.push(p);
      }
      if (mustStayLand) return {points, destination: 'junction'};
      return null;
    }
    const mainRivers = [];
    const sources = [];
    if (chains.length) {
      for (const chain of chains) {
        const preferred = Math.atan2(-chain.start.y + chain.end.y, -chain.start.x + chain.end.x) + (rr() > .5 ? Math.PI * .5 : -Math.PI * .5);
        const source = chain.peaks[Math.floor(chain.peaks.length * (.18 + rr() * .55))] || chain;
        sources.push({source, chain, preferred});
      }
    } else {
      for (let i = 0; i < 2; i++) {
        const source = safePoint(rr, .055);
        if (source) sources.push({source, chain: null, preferred: rr() * Math.PI * 2});
      }
    }
    for (let i = 0; i < sources.length; i++) {
      const {source, chain, preferred} = sources[i];
      let made = null;
      const alternatives = chain ? chain.peaks.filter(p => p !== source).sort((a, b) => mainland(a.x, a.y) - mainland(b.x, b.y)) : [];
      const candidates = [source, ...alternatives].slice(0, 9);
      for (const head of candidates) {
        const target = outletFrom(head, .28 + rr() * .22, preferred, i % 2 === 0);
        if (!target) continue;
        for (let attempt = 0; attempt < 8 && !made; attempt++) {
          const bend = attempt === 7 ? 0 : (rr() - .5) * (.08 + attempt * .025);
          const candidate = route(head, target, null, false, rr() * Math.PI * 2, bend);
          if (candidate && candidate.points.length > 34) made = candidate;
        }
        if (made) break;
      }
      if (made) {
        const river = {...made, width: .8 + options.mountains * .004, order: 'main', basin: i, chain: chain ? chain.id : -1};
        rivers.push(river); mainRivers.push(river);
      }
    }
    function riverPoint(river, t) {return river.points[Math.min(river.points.length - 1, Math.floor(t * (river.points.length - 1)))];}
    for (const river of mainRivers) {
      const chain = chains.find(c => c.id === river.chain);
      const sourcePeaks = chain ? chain.peaks : peaks;
      const branchCount = options.mountains < 18 ? 1 : 2 + (options.mountains > 82 ? 1 : 0);
      for (let branch = 0; branch < branchCount; branch++) {
        const join = riverPoint(river, .43 + branch * .18 + rr() * .07);
        const candidates = sourcePeaks.filter(p => metricDistance(p.x, p.y, join.x, join.y) > .045 &&
          metricDistance(p.x, p.y, join.x, join.y) < .24).sort((a, b) =>
          metricDistance(a.x, a.y, join.x, join.y) - metricDistance(b.x, b.y, join.x, join.y));
        let tributary = null;
        for (const source of candidates.slice(0, 7)) {
          for (let attempt = 0; attempt < 3 && !tributary; attempt++) {
            tributary = route(source, join, null, true, rr() * Math.PI * 2, (rr() - .5) * (.018 + attempt * .012));
          }
          if (tributary) break;
        }
        if (tributary && tributary.points.length > 18) {
          rivers.push({...tributary, width: .34 + rr() * .18, order: 'tributary', basin: river.basin, chain: river.chain});
        }
      }
    }
    function riverDistance(x, y) {
      let d = 1;
      for (const river of rivers) for (let i = 1; i < river.points.length; i += 4) {
        d = Math.min(d, segmentDistance(x, y, river.points[i - 1], river.points[Math.min(i + 3, river.points.length - 1)]));
      }
      return d;
    }
    function valleyDistance(x, y) {
      let d = 1;
      for (const river of rivers) {
        const margin = river.order === 'main' ? .009 : .0055;
        for (let i = 1; i < river.points.length; i += 5) {
          d = Math.min(d, Math.max(0, segmentDistance(x, y, river.points[i - 1], river.points[Math.min(i + 4, river.points.length - 1)]) - margin));
        }
      }
      return d;
    }

    const hr = random(seed, 'hills');
    for (let i = 0, count = 15 + Math.round(options.roughness * .18) + Math.round(options.mountains * .12); i < count; i++) {
      const p = safePoint(hr, .028, p => peaks.every(b => metricDistance(p.x, p.y, b.x, b.y) > b.size * .65));
      if (p) hills.push({...p, size: .014 + hr() * .018, variant: Math.floor(hr() * 20), angle: (hr() - .5) * .32});
    }

    const fr = random(seed, 'forests');
    const zoneCount = options.forests === 0 ? 0 : 2 + Math.round(options.forests / 10);
    for (let i = 0; i < zoneCount; i++) {
      const p = safePoint(fr, .032, p => peaks.every(b => metricDistance(p.x, p.y, b.x, b.y) > .038) &&
        (!rivers.length || riverDistance(p.x, p.y) > .009));
      if (!p) continue;
      const zone = {...p, rx: .052 + fr() * .082, ry: .075 + fr() * .13, phase: fr() * 7, id: i};
      forestZones.push(zone);
      const count = Math.round(10 + options.forests * .42);
      for (let j = 0; j < count; j++) {
        const a = fr() * Math.PI * 2, radius = Math.sqrt(fr());
        const wobble = 1 + .22 * Math.sin(a * 3 + zone.phase) + .12 * Math.cos(a * 5 - zone.phase) +
          .075 * Math.sin(a * 7 + zone.phase * 1.7);
        const x = p.x + Math.cos(a) * radius * zone.rx * wobble;
        const y = p.y + Math.sin(a) * radius * zone.ry * wobble;
        if (mainland(x, y) < -.025 && lakeDistance(x, y) > .014 && riverDistance(x, y) > .006 &&
          peaks.every(b => metricDistance(x, y, b.x, b.y) > .022)) {
          trees.push({x, y, size: .0055 + fr() * .0065, variant: Math.floor(fr() * 20), mirror: fr() > .5, angle: (fr() - .5) * .2});
        }
      }
    }
    function forestAt(x, y) {
      let density = 0;
      for (const zone of forestZones) {
        const dx = (x - zone.x) / zone.rx, dy = (y - zone.y) / zone.ry;
        const a = Math.atan2(dy, dx), edge = 1 + .22 * Math.sin(a * 3 + zone.phase) +
          .12 * Math.cos(a * 5 - zone.phase) + .075 * Math.sin(a * 7 + zone.phase * 1.7);
        const interior = edge - Math.hypot(dx, dy);
        const mottling = noise(x * 8.5 + zone.id * 3, y * 7.2 - zone.id * 5, seed ^ 223);
        density = Math.max(density, clamp((interior + (mottling - .5) * .19) * 1.18, 0, 1));
      }
      return density;
    }

    const cr = random(seed, 'clouds');
    for (let i = 0, count = 9 + Math.floor(cr() * 5); i < count; i++) {
      let p = null;
      for (let tries = 0; tries < 240; tries++) {
        const candidate = {x: (cr() - .5) * 1.8, y: (cr() - .5) * 1.72};
        if (landDistance(candidate.x, candidate.y) > .045 && lakeDistance(candidate.x, candidate.y) > .045) {p = candidate; break;}
      }
      if (p) clouds.push({...p, rx: .035 + cr() * .055, ry: .018 + cr() * .035,
        angle: (cr() - .5) * .7, opacity: .14 + cr() * .12, seed: Math.floor(cr() * 0xffffffff)});
    }

    Object.assign(world, {landDistance, lakeDistance, water, riverDistance, valleyDistance, forestAt, metricDistance});
    return world;
  }

  function classify(world, x, y) {
    const d = world.landDistance(x, y);
    if (d >= 0) {
      if (Math.abs(d) < .006) return Terrain.coast;
      if (Math.abs(y) > .82 && noise(x * 18 + 4, y * 10 - 6, world.seed ^ 233) > .38) return Terrain.ice;
      return Terrain.ocean;
    }
    if (world.lakeDistance(x, y) <= 0) return Terrain.lake;
    if (d > -.006) return Terrain.coast;
    const river = world.riverDistance(x, y);
    if (river < .0014) return Terrain.river;
    if (world.valleyDistance(x, y) < .004) return Terrain.valley;
    for (const p of world.peaks) {
      const distance = metricDistance(x, y, p.x, p.y);
      if (distance < p.size * .17 && p.snow) return Terrain.snow;
      if (distance < p.size * .46) return Terrain.mountain;
    }
    for (const p of world.hills) if (metricDistance(x, y, p.x, p.y) < p.size * .34) return Terrain.hill;
    return world.forestAt(x, y) > .25 ? Terrain.forest : Terrain.plain;
  }
  Object.assign(A, {Terrain, defaults, optionsFrom, createWorld, classify, segmentDistance, metricDistance, smoothstep});
})(globalThis);
