(function (root) {
  'use strict';
  const A = root.NereideAtlas;
  const { random, noise, clamp, lerp } = A;
  const Terrain = Object.freeze({ ocean: 0, land: 1, coast: 2, plain: 3, forest: 4,
    hill: 5, mountain: 6, valley: 7, river: 8, snow: 9, lake: 10 });
  const defaults = Object.freeze({ continentSize: 50, mountains: 60, forests: 65, roughness: 45 });
  function optionsFrom(input) {
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) => {
      const n = Number(input && input[key]);
      return [key, Number.isFinite(n) ? clamp(n, 0, 100) : value];
    }));
  }
  function ellipse(x, y, b) {
    return (Math.hypot((x - b.x) / b.rx, (y - b.y) / b.ry) - 1) * Math.min(b.rx, b.ry);
  }
  function union(a, b, radius) {
    const h = Math.max(radius - Math.abs(a - b), 0) / radius;
    return Math.min(a, b) - h * h * radius * .25;
  }
  function segmentDistance(x, y, a, b) {
    const dx = b.x - a.x, dy = (b.y - a.y) * .5;
    const t = clamp(((x - a.x) * dx + (y - a.y) * .5 * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(x - a.x - dx * t, (y - a.y) * .5 - dy * t);
  }
  function createWorld(seed, input) {
    seed = A.parseSeed(seed);
    const options = optionsFrom(input), rng = random(seed, 'continent');
    const scale = .78 + options.continentSize * .004;
    const angle = (rng() - .5) * .55, cos = Math.cos(angle), sin = Math.sin(angle);
    const offsetX = (rng() - .5) * .05, offsetY = (rng() - .5) * .08;
    const blobs = [
      [-.08, -.46, .14, .22], [-.03, -.23, .21, .25], [0, .02, .22, .27],
      [.10, .28, .17, .24], [.08, .51, .10, .17], [-.20, -.13, .12, .16], [.21, .13, .13, .17]
    ].map(([x, y, rx, ry]) => ({ x: x + (rng() - .5) * .075, y: y + (rng() - .5) * .08,
      rx: rx * (.85 + rng() * .3), ry: ry * (.85 + rng() * .3) }));
    const bays = [{x: -.17, y: .25, rx: .14 + rng() * .025, ry: .17},
      {x: .22, y: -.25, rx: .13, ry: .10 + rng() * .06}];
    function local(x, y) {
      x = (x - offsetX) / scale; y = (y - offsetY) / scale;
      return {x: x * cos + y * sin * .5, y: -x * sin * 2 + y * cos};
    }
    function mainland(x, y) {
      const p = local(x, y);
      if (Math.abs(p.x) > .7 || Math.abs(p.y) > .92) return .3;
      const rough = .009 + options.roughness * .00035;
      const wx = p.x + (noise(p.x * 7 + 19, p.y * 4 - 8, seed) - .5) * rough * 2;
      const wy = p.y + (noise(p.x * 6 - 7, p.y * 5 + 13, seed ^ 19) - .5) * rough * 3;
      let field = 1;
      for (const b of blobs) field = union(field, ellipse(wx, wy, b), .035);
      for (const bay of bays) field = Math.max(field, -ellipse(wx, wy, bay));
      field += (noise(wx * 18 + 8, wy * 11 - 7, seed ^ 873) - .5) * (.005 + options.roughness * .00017);
      return field * scale;
    }
    const islands = [], lakes = [], chains = [], peaks = [], hills = [], forestZones = [], trees = [], rivers = [];
    const world = { seed, options, blobs, islands, lakes, chains, peaks, hills, forestZones, trees, rivers, mainland };
    function landDistance(x, y) {
      let d = mainland(x, y);
      for (const b of islands) {
        const r = ellipse(x, y, b) + (noise(x * 45, y * 28, seed ^ b.id) - .5) * b.rx * .25;
        d = Math.min(d, r);
      }
      return d;
    }
    function lakeDistance(x, y) {
      let d = 1;
      for (const b of lakes) {
        const lobe = {x: b.x + b.rx * .42, y: b.y + b.ry * .38, rx: b.rx * .72, ry: b.ry * .8};
        const shape = union(ellipse(x, y, b), ellipse(x, y, lobe), .006);
        d = Math.min(d, shape + (noise(x * 65, y * 38, seed ^ b.id) - .5) * .009);
      }
      return d;
    }
    function water(x, y) { return landDistance(x, y) >= 0 || lakeDistance(x, y) <= 0; }
    function safePoint(r, margin, predicate) {
      for (let i = 0; i < 1600; i++) {
        const p = {x: (r() - .5) * 1.05, y: (r() - .5) * 1.6};
        if (mainland(p.x, p.y) < -margin && lakeDistance(p.x, p.y) > .025 && (!predicate || predicate(p))) return p;
      }
      return null;
    }
    const ir = random(seed, 'islands');
    const wantedIslands = 7 + Math.floor(ir() * 6);
    for (let i = 0; islands.length < wantedIslands && i < 1400; i++) {
      const p = {x: (ir() - .5) * 1.15, y: (ir() - .5) * 1.55};
      const d = mainland(p.x, p.y), rx = .009 + ir() * .016;
      if (d > rx + .018 && d < .15 && islands.every(b => Math.hypot(p.x - b.x, (p.y - b.y) * .5) > rx + b.rx + .016)) {
        islands.push({...p, rx, ry: rx * (1.15 + ir() * 1.8), id: islands.length + 57});
      }
    }
    const mr = random(seed, 'mountains');
    const chainCount = options.mountains === 0 ? 0 : 1 + Math.round(options.mountains / 32);
    for (let n = 0; n < chainCount; n++) {
      const center = safePoint(mr, .055, p => chains.every(c => Math.hypot(p.x - c.x, (p.y - c.y) * .5) > .075));
      if (!center) continue;
      const direction = -.8 + mr() * 1.1, length = .09 + mr() * .13;
      const chain = {...center, direction, length, variant: Math.floor(mr() * 24), size: .075 + mr() * .035};
      chains.push(chain);
      const count = 5 + Math.round(options.mountains * .08);
      for (let i = 0; i < count; i++) {
        const t = (i / (count - 1) - .5) * length;
        const x = center.x + Math.cos(direction) * t + (mr() - .5) * .018;
        const y = center.y + Math.sin(direction) * t * 2 + (mr() - .5) * .025;
        const size = .017 + Math.sin(i / count * Math.PI) * .012 + mr() * .009;
        if (mainland(x, y) < -size * .9) peaks.push({x, y, size, variant: Math.floor(mr() * 24), angle: (mr() - .5) * .15, mirror: mr() > .5, snow: size > .027});
      }
    }
    for (let i = 0; i < Math.round(options.mountains / 15); i++) {
      const p = safePoint(mr, .035);
      if (p) peaks.push({...p, size: .014 + mr() * .008, variant: Math.floor(mr() * 24), angle: 0, mirror: mr() > .5, snow: false});
    }
    const lr = random(seed, 'lakes');
    for (let i = 0, count = 2 + Math.floor(lr() * 3); i < count; i++) {
      const p = safePoint(lr, .052, p => peaks.every(b => Math.hypot(p.x - b.x, (p.y - b.y) * .5) > .045));
      if (p) lakes.push({...p, rx: .012 + lr() * .011, ry: .020 + lr() * .018, id: 125 + i});
    }
    const rr = random(seed, 'rivers');
    function makeRiver(source) {
      let target = null, best = Infinity;
      const desiredLength = .15 + rr() * .13, preferOcean = rivers.length % 2 === 0;
      for (let k = 0; k < 48; k++) {
        const a = k / 48 * Math.PI * 2 + rr() * .08;
        for (let d = .018; d < .8; d += .012) {
          const p = {x: source.x + Math.cos(a) * d, y: source.y + Math.sin(a) * d * 2};
          if (water(p.x, p.y)) {
            if (preferOcean && landDistance(p.x, p.y) < 0) break;
            const score = Math.abs(d - desiredLength) * (.9 + rr() * .2);
            if (score < best) {best = score; target = p;}
            break;
          }
        }
      }
      if (!target) return;
      const dx = target.x - source.x, dy = target.y - source.y;
      const length = Math.hypot(dx, dy * .5), bend = (rr() - .5) * Math.min(.065, length * .55);
      const phase = rr() * Math.PI * 2;
      const points = [{...source}];
      for (let i = 1; i <= 100; i++) {
        const t = i / 100, wave = Math.sin(t * Math.PI) * (bend + Math.sin(t * 9 + phase) * length * .055);
        const p = {x: lerp(source.x, target.x, t) - dy * .5 / length * wave,
          y: lerp(source.y, target.y, t) + dx / length * wave * 2};
        if (water(p.x, p.y)) {
          let start = points[points.length - 1], end = p;
          for (let j = 0; j < 14; j++) {
            const mid = {x: (start.x + end.x) * .5, y: (start.y + end.y) * .5};
            if (water(mid.x, mid.y)) end = mid; else start = mid;
          }
          points.push(end);
          rivers.push({points, destination: landDistance(end.x, end.y) >= 0 ? 'ocean' : 'lake', width: .7 + rr() * .45});
          return;
        }
        points.push(p);
      }
    }
    const sources = chains.length ? chains : [safePoint(rr, .06), safePoint(rr, .05)].filter(Boolean);
    for (const source of sources) makeRiver(source);
    if (chains.length > 1) makeRiver(peaks[Math.floor(rr() * peaks.length)] || chains[0]);
    function riverDistance(x, y) {
      let d = 1;
      for (const river of rivers) for (let i = 1; i < river.points.length; i += 4) {
        d = Math.min(d, segmentDistance(x, y, river.points[i - 1], river.points[Math.min(i + 3, river.points.length - 1)]));
      }
      return d;
    }
    const hr = random(seed, 'hills');
    for (let i = 0; i < 24 + Math.round(options.mountains * .22); i++) {
      const p = safePoint(hr, .025);
      if (p) hills.push({...p, size: .014 + hr() * .016, variant: Math.floor(hr() * 20), angle: (hr() - .5) * .25});
    }
    const fr = random(seed, 'forests');
    const zoneCount = options.forests === 0 ? 0 : 3 + Math.round(options.forests / 12);
    for (let i = 0; i < zoneCount; i++) {
      const p = safePoint(fr, .03);
      if (!p) continue;
      const zone = {...p, rx: .045 + fr() * .07, ry: .065 + fr() * .12, phase: fr() * 7, id: i};
      forestZones.push(zone);
      const count = Math.round(10 + options.forests * .35);
      for (let j = 0; j < count; j++) {
        const a = fr() * Math.PI * 2, radius = Math.sqrt(fr());
        const wobble = 1 + .22 * Math.sin(a * 3 + zone.phase) + .12 * Math.cos(a * 5 - zone.phase);
        const x = p.x + Math.cos(a) * radius * zone.rx * wobble;
        const y = p.y + Math.sin(a) * radius * zone.ry * wobble;
        if (mainland(x, y) < -.02 && lakeDistance(x, y) > .012 && riverDistance(x, y) > .0045 &&
          peaks.every(b => Math.hypot(x - b.x, (y - b.y) * .5) > b.size * .35)) {
          trees.push({x, y, size: .008 + fr() * .010, variant: Math.floor(fr() * 20), mirror: fr() > .5});
        }
      }
    }
    function forestAt(x, y) {
      let density = 0;
      for (const zone of forestZones) {
        const dx = (x - zone.x) / zone.rx, dy = (y - zone.y) / zone.ry;
        const a = Math.atan2(dy, dx), edge = 1 + .22 * Math.sin(a * 3 + zone.phase) + .12 * Math.cos(a * 5 - zone.phase);
        density = Math.max(density, clamp((edge - Math.hypot(dx, dy)) * 1.2, 0, 1));
      }
      return density;
    }
    Object.assign(world, {landDistance, lakeDistance, water, riverDistance, forestAt});
    return world;
  }
  function classify(world, x, y) {
    const d = world.landDistance(x, y);
    if (d >= 0) return d < .006 ? Terrain.coast : Terrain.ocean;
    if (world.lakeDistance(x, y) <= 0) return Terrain.lake;
    if (d > -.004) return Terrain.coast;
    if (world.riverDistance(x, y) < .0013) return Terrain.river;
    if (world.riverDistance(x, y) < .005) return Terrain.valley;
    for (const p of world.peaks) {
      const distance = Math.hypot(x - p.x, (y - p.y) * .5);
      if (distance < p.size * .16 && p.snow) return Terrain.snow;
      if (distance < p.size * .45) return Terrain.mountain;
    }
    for (const p of world.hills) if (Math.hypot(x - p.x, (y - p.y) * .5) < p.size * .35) return Terrain.hill;
    return world.forestAt(x, y) > .25 ? Terrain.forest : Terrain.plain;
  }
  Object.assign(A, {Terrain, defaults, optionsFrom, createWorld, classify, segmentDistance});
})(globalThis);
