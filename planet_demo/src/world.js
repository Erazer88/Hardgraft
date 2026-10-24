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
    const options = optionsFrom(input), rng = random(seed, 'continent');
    const scale = .79 + options.continentSize * .0041;
    const angle = (rng() - .5) * .48, cos = Math.cos(angle), sin = Math.sin(angle);
    const offsetX = (rng() - .5) * .05, offsetY = (rng() - .5) * .07;
    const blobs = [
      [-.08, -.47, .135, .205], [-.035, -.24, .205, .245], [.005, .025, .215, .265],
      [.085, .285, .17, .235], [.08, .515, .105, .155], [-.205, -.13, .115, .15], [.215, .12, .12, .145]
    ].map(([x, y, rx, ry]) => ({
      x: x + (rng() - .5) * .065, y: y + (rng() - .5) * .065,
      rx: rx * (.89 + rng() * .22), ry: ry * (.89 + rng() * .22)
    }));
    const bays = [
      {x: -.16, y: .245, rx: .135 + rng() * .025, ry: .16},
      {x: .205, y: -.265, rx: .118, ry: .105 + rng() * .025},
      {x: -.015, y: .095, rx: .052 + rng() * .014, ry: .085},
      {x: .19, y: .265, rx: .042 + rng() * .012, ry: .06}
    ];
    function local(x, y) {
      x = (x - offsetX) / scale; y = (y - offsetY) / scale;
      return {x: x * cos + y * sin * .5, y: -x * sin * 2 + y * cos};
    }
    function worldPoint(x, y) {
      return {x: offsetX + scale * (x * cos - y * sin * .5),
        y: offsetY + scale * (2 * x * sin + y * cos)};
    }
    function mainland(x, y) {
      const p = local(x, y);
      if (Math.abs(p.x) > .7 || Math.abs(p.y) > .92) return .3;
      const rough = .008 + options.roughness * .00029;
      const wx = p.x + (noise(p.x * 5.5 + 19, p.y * 3.6 - 8, seed) - .5) * rough * 1.7;
      const wy = p.y + (noise(p.x * 4.2 - 7, p.y * 4.7 + 13, seed ^ 19) - .5) * rough * 2.2;
      let field = 1;
      for (const b of blobs) field = union(field, ellipse(wx, wy, b), .033);
      for (const bay of bays) field = Math.max(field, -ellipse(wx, wy, bay));
      field += (noise(wx * 14 + 8, wy * 9 - 7, seed ^ 873) - .5) * (.004 + options.roughness * .0001);
      field += (noise(wx * 27 + 3, wy * 19 - 5, seed ^ 441) - .5) * (.001 + options.roughness * .000045);
      return field * scale;
    }

    const islands = [], lakes = [], chains = [], peaks = [], hills = [], forestZones = [], trees = [], rivers = [], clouds = [];
    const world = {seed, options, blobs, islands, lakes, chains, peaks, hills, forestZones, trees, rivers, clouds, mainland};

    function islandField(x, y, b) {
      return ellipse(x, y, b) + (noise(x * 34 + b.id, y * 29 - b.id, seed ^ b.id) - .5) * Math.min(b.rx, b.ry) * .19;
    }
    function landDistance(x, y) {
      let d = mainland(x, y);
      for (const b of islands) d = Math.min(d, islandField(x, y, b));
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
    function safePoint(r, margin, predicate) {
      for (let i = 0; i < 1800; i++) {
        const p = {x: (r() - .5) * .9, y: (r() - .5) * 1.45};
        if (mainland(p.x, p.y) < -margin && lakeDistance(p.x, p.y) > .025 && (!predicate || predicate(p))) return p;
      }
      return null;
    }

    const ir = random(seed, 'islands');
    function addIsland(p, group) {
      const latitudeScale = Math.max(.7, Math.cos(p.y * Math.PI * .5));
      const rx = (.006 + ir() * .016) / latitudeScale;
      const b = {x: p.x, y: p.y, rx, ry: rx * (1.25 + ir() * 1.8), angle: (ir() - .5) * .9,
        id: islands.length + 57, group};
      if (mainland(p.x, p.y) < b.rx * 1.25 + .012 || mainland(p.x, p.y) > .19) return false;
      if (islands.some(other => metricDistance(p.x, p.y, other.x, other.y) < (rx + other.rx) * .9 + .012)) return false;
      islands.push(b); return true;
    }
    function coastAnchor(start, bearing, gap) {
      const latitudeScale = Math.max(.5, Math.cos(start.y * Math.PI * .5));
      let coast = null;
      for (let d = .006; d < .76; d += .006) {
        const p = {x: start.x + Math.cos(bearing) * d / latitudeScale, y: start.y + Math.sin(bearing) * d * 2};
        if (mainland(p.x, p.y) >= 0) {coast = p; break;}
      }
      if (!coast) return null;
      return {x: coast.x + Math.cos(bearing) * gap / latitudeScale, y: coast.y + Math.sin(bearing) * gap * 2};
    }
    const groupCount = 2 + Math.floor(ir() * 2);
    for (let group = 0; group < groupCount; group++) {
      const origin = safePoint(ir, .04);
      if (!origin) continue;
      const bearing = ir() * Math.PI * 2, gap = .04 + ir() * .075;
      const anchor = coastAnchor(origin, bearing, gap);
      if (!anchor) continue;
      for (let j = 0, count = 3 + Math.floor(ir() * 4); j < count; j++) {
        let placed = false;
        for (let tries = 0; tries < 32 && !placed; tries++) {
          const radius = Math.sqrt(ir()) * (.035 + ir() * .055), a = ir() * Math.PI * 2;
          const p = {x: anchor.x + Math.cos(a) * radius, y: anchor.y + Math.sin(a) * radius * 2};
          if (mainland(p.x, p.y) > .003 && mainland(p.x, p.y) < .16) placed = addIsland(p, group);
        }
      }
    }
    const wantedIslands = 9 + Math.floor(ir() * 5);
    for (let i = 0; islands.length < wantedIslands && i < 1600; i++) {
      const p = {x: (ir() - .5) * .95, y: (ir() - .5) * 1.48};
      if (mainland(p.x, p.y) > .004 && mainland(p.x, p.y) < .15) addIsland(p, groupCount + i);
    }

    const mr = random(seed, 'mountains');
    const rangeCount = options.mountains === 0 ? 0 : options.mountains < 22 ? 1 : 2;
    function createRange(index) {
      const yBase = index === 0 ? -.155 : .245, xBase = index === 0 ? -.105 : .085;
      const span = index === 0 ? .37 : .33;
      for (let attempt = 0; attempt < 50; attempt++) {
        const x0 = xBase + (mr() - .5) * .105, y0 = yBase + (mr() - .5) * .085;
        const slope = (mr() - .5) * .25, phase = mr() * Math.PI * 2, side = (mr() - .5) * .012;
        const path = [];
        let valid = 0;
        for (let i = 0; i <= 40; i++) {
          const t = i / 40, y = y0 + (t - .5) * span, x = x0 + slope * (t - .5) + Math.sin(t * Math.PI * 2 + phase) * .015 + side;
          const p = worldPoint(x, y); path.push(p);
          if (mainland(p.x, p.y) < -.018) valid++;
        }
        if (valid < path.length * .79) continue;
        const start = path[0], end = path[path.length - 1], center = path[path.length >> 1];
        const length = Math.hypot(end.x - start.x, (end.y - start.y) * .5);
        const chain = {id: index, x: center.x, y: center.y, start, end, path, direction: Math.atan2(end.y - start.y, end.x - start.x),
          length, size: clamp(length * .92, .15, .24), variant: Math.floor(mr() * 24), peaks: []};
        const count = 12 + Math.round(options.mountains * .12);
        for (let i = 0; i < count; i++) {
          const t = (i + .42 + (mr() - .5) * .35) / count;
          const at = Math.max(0, Math.min(40, Math.round(t * 40))), base = path[at], localP = local(base.x, base.y);
          const p = worldPoint(localP.x + (mr() - .5) * .045, localP.y + (mr() - .5) * .018);
          if (mainland(p.x, p.y) > -.006) continue;
          const middle = 1 - Math.abs(t - .5) * 1.8;
          const size = .033 + clamp(middle, 0, 1) * .032 + mr() * .018;
          const peak = {...p, size, variant: Math.floor(mr() * 24), angle: (mr() - .5) * .18, mirror: mr() > .5,
            snow: size > .069 || (size > .057 && mr() > .42), chain: index, major: size > .065};
          peaks.push(peak); chain.peaks.push(peak);
        }
        chains.push(chain);
        return chain;
      }
      return null;
    }
    for (let i = 0; i < rangeCount; i++) createRange(i);
    for (let i = 0, count = Math.round(options.mountains / 26); i < count; i++) {
      const p = safePoint(mr, .035, p => chains.every(c => metricDistance(p.x, p.y, c.x, c.y) > .045));
      if (p) peaks.push({...p, size: .025 + mr() * .022, variant: Math.floor(mr() * 24), angle: (mr() - .5) * .2,
        mirror: mr() > .5, snow: mr() > .7, chain: -1, major: false});
    }

    const lr = random(seed, 'lakes');
    const lakeCount = 1 + Math.floor(lr() * 3);
    for (let i = 0; i < lakeCount; i++) {
      const p = safePoint(lr, .055, p => peaks.every(b => metricDistance(p.x, p.y, b.x, b.y) > .04));
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
