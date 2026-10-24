(function (root) {
  'use strict';
  const A = root.NereideAtlas, {random, clamp, lerp} = A;

  // Gradient noise avoids the horizontal/vertical shelves of value noise.
  function gradientNoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    function dot(a, b, dx, dy) {
      let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
      h = Math.imul(h ^ h >>> 13, 1274126177); h ^= h >>> 16;
      switch (h & 7) {
        case 0: return dx; case 1: return -dx; case 2: return dy; case 3: return -dy;
        case 4: return (dx + dy) * .7071; case 5: return (dx - dy) * .7071;
        case 6: return (-dx + dy) * .7071; default: return (-dx - dy) * .7071;
      }
    }
    return lerp(lerp(dot(ix, iy, fx, fy), dot(ix + 1, iy, fx - 1, fy), fade(fx)),
      lerp(dot(ix, iy + 1, fx, fy - 1), dot(ix + 1, iy + 1, fx - 1, fy - 1), fade(fx)), fade(fy)) * 1.5;
  }
  function oval(x, y, b) {
    const dx = x - b.x, dy = y - b.y;
    return (Math.hypot((dx * b.cos + dy * b.sin) / b.rx, (-dx * b.sin + dy * b.cos) / b.ry) - 1) * Math.min(b.rx, b.ry);
  }
  function blob(x, y, rx, ry, angle) {return {x, y, rx, ry, cos: Math.cos(angle), sin: Math.sin(angle)};}
  function blend(a, b, k) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * .25;
  }

  function createGeography(seed, options) {
    const rng = random(seed, 'geography-v4'), count = 1 + Math.floor(rng() * 3);
    const scale = .82 + options.continentSize * .0032, rough = options.roughness / 100;
    // Coordinates use x, y/2 so shapes have the same scale in both map axes.
    // Separate envelopes keep the major landmasses apart at every slider value.
    const layouts = [
      [[0, 0, .31, .33]],
      [[-.20, -.06, .145, .29], [.20, .07, .14, .22]],
      [[-.22, -.16, .13, .16], [0, .13, .16, .21], [.22, -.16, .13, .15]]
    ];
    const mirror = rng() < .5 ? -1 : 1;
    const continents = layouts[count - 1].map(([x, y, rx, ry], id) => {
      const angle = (rng() - .5) * (count === 3 ? .42 : id === 0 ? .95 : 2.5);
      const c = {id, x: x * scale * mirror, y: (y + (rng() - .5) * .035) * scale * 2,
        rx: rx * scale, ry: ry * scale, angle, cos: Math.cos(angle), sin: Math.sin(angle),
        xCompression: count === 3 ? 1.08 : 1,
        seed: (seed ^ Math.floor(rng() * 0xffffffff)) >>> 0, lobes: [], bays: []};
      const phase = rng() * Math.PI * 2;
      for (let j = 0; j < 5; j++) {
        const t = j / 4, bx = Math.sin(t * 3.8 + phase) * .25;
        const taper = .68 + Math.sin(t * Math.PI) * .32;
        c.lobes.push(blob(bx, (t - .5) * 1.25, (.42 + rng() * .2) * taper, .34 + rng() * .13, (rng() - .5) * .5));
      }
      // Unequal lateral lobes produce broad peninsulas, isthmuses and asymmetric basins.
      for (let j = 0, n = 3 + Math.floor(rng() * 3); j < n; j++) {
        const side = j % 2 ? -1 : 1, by = (rng() - .5) * 1.3;
        const reach = count === 3 ? .34 + rng() * .12 : .4 + rng() * .21;
        const width = count === 3 ? .2 + rng() * .12 : .28 + rng() * .17;
        c.lobes.push(blob(side * reach, by, width, .12 + rng() * .17, side * (rng() - .5) * 1.4));
      }
      for (let j = 0, n = 2 + Math.floor(rng() * 3); j < n; j++) {
        const side = j % 2 ? -1 : 1;
        c.bays.push(blob(side * (.78 + rng() * .15), (rng() - .5) * 1.42, .32 + rng() * .18, .12 + rng() * .17, (rng() - .5) * 1.4));
      }
      return c;
    });
    function continentField(x, y, c) {
      const dx = x - c.x, dy = (y - c.y) * .5;
      const px = (dx * c.cos + dy * c.sin) / c.rx * c.xCompression;
      const py = (-dx * c.sin + dy * c.cos) / c.ry;
      if (Math.abs(px) > 1.65 || Math.abs(py) > 1.65) return .3;
      const s = c.seed, n = gradientNoise;
      const broad = .25 + rough * .15;
      const wx = px + n(px * 1.8 + 9, py * 1.8 - 5, s) * broad + n(px * 5 + 13, py * 5, s ^ 29) * .055;
      const wy = py + n(px * 1.8 - 7, py * 1.8 + 4, s ^ 71) * broad + n(px * 5, py * 5 + 7, s ^ 137) * .055;
      let d = 2;
      for (const b of c.lobes) d = blend(d, oval(wx, wy, b), .10);
      for (const b of c.bays) d = -blend(-d, oval(wx, wy, b), .045);
      // Detail amplitude decreases with wavelength: bays first, coves last.
      // Local exposure varies so sheltered shores remain calmer than broken coasts.
      const exposure = .55 + .45 * (n(px * 2.7 + 31, py * 2.7 - 13, s ^ 443) + 1) * .5;
      const detail = .45 + rough * .9;
      d += exposure * detail * (n(wx * 9 + 17, wy * 9 - 9, s ^ 831) * .083 +
        n(wx * 23 - 5, wy * 23 + 3, s ^ 921) * .033 + n(wx * 57, wy * 57 + 18, s ^ 1471) * .013);
      return d * Math.min(c.rx, c.ry);
    }
    // Precompute once: placement and rendering subsequently query a continuous
    // bilinear field. This is a 2D shoreline mask, not a terrain heightmap.
    const width = 1537, height = 769, step = 2 / (width - 1);
    const field = new Float32Array(width * height); field.fill(.3);
    for (const c of continents) {
      const radius = Math.hypot(c.rx, c.ry) * 1.32;
      const x0 = clamp(Math.floor((c.x - radius + 1) / step), 1, width - 2);
      const x1 = clamp(Math.ceil((c.x + radius + 1) / step), 1, width - 2);
      const y0 = clamp(Math.floor((c.y * .5 - radius + .5) / step), 1, height - 2);
      const y1 = clamp(Math.ceil((c.y * .5 + radius + .5) / step), 1, height - 2);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        // Preserve open water at the poles and at the equirectangular seam.
        field[i] = Math.min(field[i], Math.max(continentField(x * step - 1, y * step * 2 - 1, c),
          (Math.abs(y * step * 2 - 1) - .85) * .5, Math.abs(x * step - 1) - .88));
      }
    }
    // Retain the connected body containing each continent's core. Fragments are
    // generated separately as deliberate coastal archipelagos, never noise specks.
    const connected = new Uint8Array(field.length), queue = new Int32Array(field.length);
    // Fill tiny enclosed water pockets created by the coastal perturbation.
    // Designed lakes are added later; genuine open bays remain connected to sea.
    for (let i = 0; i < field.length; i++) {
      if (connected[i] || field[i] < 0) continue;
      let head = 0, tail = 0, boundary = false; queue[tail++] = i; connected[i] = 1;
      while (head < tail) {
        const at = queue[head++], x = at % width, y = Math.floor(at / width);
        if (!x || !y || x === width - 1 || y === height - 1) boundary = true;
        for (const next of [x ? at - 1 : -1, x < width - 1 ? at + 1 : -1, at - width, at + width]) {
          if (next >= 0 && next < field.length && !connected[next] && field[next] >= 0) {
            connected[next] = 1; queue[tail++] = next;
          }
        }
      }
      if (!boundary && tail < 500) for (let j = 0; j < tail; j++) field[queue[j]] = -Math.abs(field[queue[j]]) - step;
    }
    connected.fill(0);
    for (const c of continents) {
      let start = -1, best = Infinity;
      for (let y = 1; y < height - 1; y += 3) for (let x = 1; x < width - 1; x += 3) {
        const i = y * width + x;
        if (field[i] >= -.012) continue;
        const d = (x * step - 1 - c.x) ** 2 + (y * step - .5 - c.y * .5) ** 2;
        if (d < best) {best = d; start = i;}
      }
      if (start < 0 || connected[start]) continue;
      c.core = {x: (start % width) * step - 1, y: Math.floor(start / width) * step * 2 - 1};
      let head = 0, tail = 0; queue[tail++] = start; connected[start] = 1;
      while (head < tail) {
        const i = queue[head++];
        for (const j of [i - 1, i + 1, i - width, i + width]) {
          if (j >= 0 && j < field.length && !connected[j] && field[j] < 0) {connected[j] = 1; queue[tail++] = j;}
        }
      }
    }
    for (let i = 0; i < field.length; i++) if (field[i] < 0 && !connected[i]) field[i] = Math.abs(field[i]) + step;

    // Re-distance from subpixel zero crossings so narrow bays do not acquire
    // thick sand bands. Two chamfer sweeps preserve the original coastline.
    const distance = new Float32Array(field.length); distance.fill(4);
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x, a = field[i];
      for (const j of [i - 1, i + 1, i - width, i + width]) {
        if ((a < 0) !== (field[j] < 0)) distance[i] = Math.min(distance[i], Math.abs(a / (a - field[j])) * step);
      }
    }
    const diagonal = step * Math.SQRT2;
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      distance[i] = Math.min(distance[i], distance[i - 1] + step, distance[i - width] + step,
        distance[i - width - 1] + diagonal, distance[i - width + 1] + diagonal);
    }
    for (let y = height - 2; y > 0; y--) for (let x = width - 2; x > 0; x--) {
      const i = y * width + x;
      distance[i] = Math.min(distance[i], distance[i + 1] + step, distance[i + width] + step,
        distance[i + width + 1] + diagonal, distance[i + width - 1] + diagonal);
    }
    for (let i = 0; i < field.length; i++) field[i] = Math.min(.3, distance[i]) * (field[i] < 0 ? -1 : 1);
    function mainland(x, y) {
      if (Math.abs(x) >= .99 || Math.abs(y) >= .99) return .3;
      const gx = (x + 1) / step, gy = (y + 1) / (step * 2), ix = Math.floor(gx), iy = Math.floor(gy);
      const tx = gx - ix, ty = gy - iy, i = iy * width + ix;
      return lerp(lerp(field[i], field[i + 1], tx), lerp(field[i + width], field[i + width + 1], tx), ty);
    }
    return {continents, mainland, resolution: width};
  }
  Object.assign(A, {gradientNoise, createGeography});
})(globalThis);
