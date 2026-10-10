(function (root) {
  'use strict';
  const World = root.OrbitWorld, Camera = root.OrbitCamera, Config = root.OrbitConfig;
  const BuildingData = root.OrbitBuildingData, Construction = root.OrbitConstruction;
  const BlockData = root.OrbitBlockData, FactorySimulation = root.OrbitFactorySimulation, ResourceData = root.OrbitResourceData;
  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t * t * (3 - 2 * t);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function create(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    let W = 1, H = 1, DPR = 1;
    let state, galaxy, home, contexts, visibleContexts, factoryView, now;
    let galaxyTexture, fogCanvas, fogMask;
    const surfaceBranchCache = new Map();
    const viewport = { width: W, height: H };
    function project(x, y, cam = state.camera) { return Camera.project({ x, y }, cam, viewport); }
    function localCamera(frame) { return Camera.toLocal(frame, state.camera); }
    function planetWorldPosition(planet, context = state.context) {
      return Camera.worldPoint(context.frame, World.planetPosition(planet, state.simulation.time));
    }
    function surfaceFrame(planet, context) {
      const record = context.terrains.get(planet.id);
      return Camera.surfaceFrame(planetWorldPosition(planet, context), planet.radius * context.frame.scale, record.texture);
    }
    function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    function dot(c, x, y, r, color) { c.fillStyle = color; c.beginPath(); c.arc(x, y, Math.max(.1, r), 0, TAU); c.fill(); }
    function line(c, points, color, width = 1, dash = []) {
      c.strokeStyle = color; c.lineWidth = width; c.setLineDash(dash); c.beginPath();
      points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke(); c.setLineDash([]);
    }
    function circle(c, x, y, r, color, width = 1, dash = []) {
      c.strokeStyle = color; c.lineWidth = width; c.setLineDash(dash); c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke(); c.setLineDash([]);
    }
    function label(c, text, x, y, color = '#91a9b9', size = 10, align = 'left') {
      c.font = `${size}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(text, x, y);
    }
    function prepareGalaxy(model, seed) {
      const resolution = 1500, extent = 5900;
      galaxyTexture = makeCanvas(resolution, resolution);
      const c = galaxyTexture.getContext('2d'), unit = resolution / (extent * 2);
      const random = World.rng(World.hashSeed(seed + ':dust'));
      const gauss = () => Math.sqrt(-2 * Math.log(Math.max(.000001, random()))) * Math.cos(TAU * random());
      c.globalCompositeOperation = 'lighter';
      for (const s of model.systems) {
        const x = resolution / 2 + s.x * unit, y = resolution / 2 + s.y * unit;
        const radius = (s.arm < 0 ? 100 : 85 + Math.hypot(s.x, s.y) * .019) * unit;
        const glow = c.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, s.arm < 0 ? 'rgba(181,169,132,.037)' : 'rgba(106,139,158,.044)');
        glow.addColorStop(.38, 'rgba(77,113,138,.019)'); glow.addColorStop(1, 'rgba(45,77,103,0)');
        c.fillStyle = glow; c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        for (let i = 0; i < 10; i++) {
          const px = x + gauss() * radius * .62, py = y + gauss() * radius * .5;
          dot(c, px, py, .17 + random() * .55, `rgba(168,190,202,${.04 + random() * .14})`);
        }
      }
      const glow = c.createRadialGradient(750, 750, 0, 750, 750, 115);
      glow.addColorStop(0, 'rgba(214,189,142,.15)'); glow.addColorStop(.3, 'rgba(181,166,127,.08)'); glow.addColorStop(1, 'rgba(93,110,120,0)');
      c.fillStyle = glow; c.fillRect(635, 635, 230, 230);
      galaxyTexture.extent = extent;
    }
    function drawGrid(cam, surface = false, blueprint = false) {
      const worldStep = surface ? 100 : blueprint ? 200 : 500;
      let step = worldStep * cam.zoom;
      let scaleStep = worldStep;
      while (step < 45) { step *= 2; scaleStep *= 2; }
      while (step > 180) { step /= 2; scaleStep /= 2; }
      const origin = project(0, 0, cam);
      ctx.lineWidth = 1; ctx.strokeStyle = surface ? '#d5d9b713' : blueprint ? '#87bace15' : '#87bace0d';
      const x0 = ((origin.x % step) + step) % step, y0 = ((origin.y % step) + step) % step;
      ctx.beginPath();
      for (let x = x0; x < W; x += step) { ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, H); }
      for (let y = y0; y < H; y += step) { ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(W, Math.round(y) + .5); }
      ctx.stroke();
      if (blueprint) {
        ctx.strokeStyle = '#86bace0a'; ctx.beginPath();
        for (let x = x0 % (step / 4); x < W; x += step / 4) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        for (let y = y0 % (step / 4); y < H; y += step / 4) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
        ctx.stroke();
      }
      if (step > 65) {
        for (let x = x0; x < W; x += step) for (let y = y0; y < H; y += step) {
          line(ctx, [{ x: x - 2.5, y }, { x: x + 2.5, y }], surface ? '#dde1c025' : '#9ebacd25');
          line(ctx, [{ x, y: y - 2.5 }, { x, y: y + 2.5 }], surface ? '#dde1c025' : '#9ebacd25');
        }
      }
      for (let x = x0; x < W; x += step) label(ctx, String(Math.round((x - origin.x) / cam.zoom / scaleStep)), x + 6, H - 97, '#557184', 8);
    }

    function drawGalaxy(cam) {
      const dustDetail = ease(clamp((8 - cam.zoom) / 7.5, 0, 1));
      if (dustDetail > 0) {
      const e = galaxyTexture.extent, a = project(-e, -e, cam), z = e * 2 * cam.zoom;
      ctx.save(); ctx.globalAlpha *= .32 * dustDetail; ctx.drawImage(galaxyTexture, a.x, a.y, z, z); ctx.restore();
      if (!fogCanvas || fogCanvas.width !== Math.round(W * DPR) || fogCanvas.height !== Math.round(H * DPR)) fogCanvas = makeCanvas(Math.round(W * DPR), Math.round(H * DPR));
      const f = fogCanvas.getContext('2d'); f.setTransform(DPR, 0, 0, DPR, 0, 0); f.clearRect(0, 0, W, H);
      f.drawImage(galaxyTexture, a.x, a.y, z, z);
      if (!state.reveal) {
        f.globalCompositeOperation = 'destination-in'; f.fillStyle = '#fff';
        if (!fogMask || fogMask.width !== Math.round(W) || fogMask.height !== Math.round(H)) fogMask = makeCanvas(Math.round(W), Math.round(H));
        const m = fogMask.getContext('2d'); m.clearRect(0, 0, W, H);
        for (const scan of state.exploration.scans) {
          const p = project(scan.x, scan.y, cam), r = scan.radius * cam.zoom;
          const g = m.createRadialGradient(p.x, p.y, r * .38, p.x, p.y, r);
          g.addColorStop(0, '#fff'); g.addColorStop(.68, '#ffffffdb'); g.addColorStop(1, '#ffffff00');
          m.fillStyle = g; m.fillRect(p.x - r, p.y - r, r * 2, r * 2);
        }
        f.drawImage(fogMask, 0, 0, W, H); f.globalCompositeOperation = 'source-over';
      }
      ctx.save(); ctx.globalAlpha *= .9 * dustDetail; ctx.drawImage(fogCanvas, 0, 0, W, H); ctx.restore();
      }
      if (state.level === 'galaxy') drawGrid(cam);
      const known = galaxy.systems.filter(s => s.discovered || state.reveal);
      const neighbors = known.filter(s => s.id !== home.id).sort((a, b) => distance(a, home) - distance(b, home)).slice(0, 5);
      const routeNodes = [home, ...neighbors];
      const routesDetail = ease(clamp((.06 - cam.zoom * (state.context?.frame.scale || .012)) / .05, 0, 1));
      ctx.save(); ctx.globalAlpha *= routesDetail;
      for (let i = 1; i < routeNodes.length; i++) {
        const from = project(routeNodes[i - 1].x, routeNodes[i - 1].y, cam), to = project(routeNodes[i].x, routeNodes[i].y, cam);
        line(ctx, [from, to], '#9fbac84c', .65);
        const t = (state.simulation.time * .03 + i * .16) % 1;
        dot(ctx, lerp(from.x, to.x, t), lerp(from.y, to.y, t), 1.05, '#dfa363');
      }
      ctx.restore();
      for (const s of known) {
        const p = project(s.x, s.y, cam);
        if (p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) continue;
        const embedded = contexts.get(s.id);
        if (embedded && embedded.frame.scale * cam.zoom >= .025) continue;
        const r = clamp(.65 + s.size * .5 + cam.zoom * .35, .75, 2.2);
        dot(ctx, p.x, p.y, r, s.color);
        if (state.exploration.visited.has(s.id)) circle(ctx, p.x, p.y, r + 3.5, '#95bac659', .7);
        if (s.id === home.id && state.selected?.id !== s.id) {
          circle(ctx, p.x, p.y, 5, '#d7a06b85', .8); label(ctx, s.name.toUpperCase(), p.x + 10, p.y - 9, '#b5c9d4', 9);
        }
        if (state.selected?.id === s.id) {
          circle(ctx, p.x, p.y, 7, '#efa35a', 1); dot(ctx, p.x, p.y, 1.9, '#f3b37a');
          line(ctx, [{ x: p.x + 7, y: p.y - 7 }, { x: p.x + 17, y: p.y - 17 }], '#d49b63', .7);
          label(ctx, s.name.toUpperCase(), p.x + 21, p.y - 17, '#d2dfdf', 10);
        }
      }
      ctx.save(); ctx.globalAlpha *= routesDetail;
      for (const mission of state.exploration.missions) {
        const t = clamp((now - mission.start) / mission.duration, 0, 1);
        const from = project(mission.from.x, mission.from.y, cam), to = project(mission.x, mission.y, cam);
        line(ctx, [from, to], '#cd9e6460', .8, [3, 5]);
        const p = { x: lerp(from.x, to.x, ease(t)), y: lerp(from.y, to.y, ease(t)) };
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(to.y - from.y, to.x - from.x));
        line(ctx, [{ x: -4, y: -3 }, { x: 4, y: 0 }, { x: -4, y: 3 }], '#e5ad6d', 1); ctx.restore();
        circle(ctx, to.x, to.y, mission.radius * cam.zoom * t, '#8fc0d52e', .7, [2, 7]);
        label(ctx, 'SONDE ' + Math.round(t * 100) + '%', to.x + 12, to.y - 12, '#b39a7a', 8);
      }
      ctx.restore();
      if (state.level === 'galaxy' && !known.some(s => { const p = project(s.x, s.y, cam); return p.x > 0 && p.x < W && p.y > 100 && p.y < H - 100; })) {
        label(ctx, 'SECTEUR NON SONDÉ', W / 2, H / 2, '#6e91a7', 10, 'center');
        label(ctx, 'Envoyez une sonde pour révéler les systèmes', W / 2, H / 2 + 21, '#4b6d84', 9, 'center');
      }
    }

    function drawSystem(cam, system, context) {
      const star = project(0, 0, cam), sr = system.star.radius * cam.zoom;
      const detailed = cam.zoom >= Math.min(.075, Math.min(W - 60, Math.max(80, H - 300)) / (system.extent * 2.35) * .8);
      const planetLabels = [{ x: star.x - 65, y: star.y + sr + 11, w: 130, h: 31 }];
      for (const planet of system.planets) {
        const radius = planet.orbit * cam.zoom;
        circle(ctx, star.x, star.y, radius, '#86bace3c', .75, [2, 5]);
        if (detailed && radius < 4000) for (let i = 0; i < 24; i++) {
          const t = i * TAU / 24;
          line(ctx, [{ x: star.x + Math.cos(t) * (radius - 2), y: star.y + Math.sin(t) * (radius - 2) },
            { x: star.x + Math.cos(t) * (radius + 2), y: star.y + Math.sin(t) * (radius + 2) }], '#86bace3b', .7);
        }
      }
      if (star.x + sr > 0 && star.x - sr < W && star.y + sr > 0 && star.y - sr < H) {
        dot(ctx, star.x, star.y, Math.max(sr, 1.2), '#112333');
        ctx.save(); ctx.beginPath(); ctx.arc(star.x, star.y, Math.max(sr, 1.2), 0, TAU); ctx.clip();
        ctx.fillStyle = '#9a784429'; ctx.fillRect(star.x - sr - 2, star.y - sr - 2, sr * 2 + 4, sr * 2 + 4);
        if (sr > 3) for (let i = -sr * 2 - 4; i < sr * 2 + 4; i += Math.max(5, sr / 20)) {
          line(ctx, [{ x: star.x - sr + i, y: star.y + sr }, { x: star.x + sr + i, y: star.y - sr }], '#bf9b6155', .7);
        }
        ctx.restore(); circle(ctx, star.x, star.y, Math.max(sr, 1.2), system.star.color, 1);
        if (detailed) {
          line(ctx, [{ x: star.x - sr - 5, y: star.y }, { x: star.x + sr + 5, y: star.y }], '#c7a56971', .7);
          line(ctx, [{ x: star.x, y: star.y - sr - 5 }, { x: star.x, y: star.y + sr + 5 }], '#c7a56971', .7);
          label(ctx, system.name.toUpperCase(), star.x, star.y + sr + 20, '#c5a579', 10, 'center');
          label(ctx, 'ÉTOILE · TYPE ' + system.star.type, star.x, star.y + sr + 35, '#7d827c', 7, 'center');
        }
      }
      if (detailed) {
        const random = World.rng(World.hashSeed(state.seed + system.id + ':debris'));
        for (const belt of system.debris) for (let i = 0; i < 180; i++) {
          const angle = belt.phase + random() * TAU + state.simulation.time * .0018;
          const radius = belt.orbit + (random() - .5) * belt.width * 2;
          const p = project(Math.cos(angle) * radius, Math.sin(angle) * radius, cam);
          if (p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H) dot(ctx, p.x, p.y, .35 + random() * .55, '#a3a89b66');
        }
        for (const belt of system.debris) {
          const bp = project(Math.cos(belt.phase) * belt.orbit, Math.sin(belt.phase) * belt.orbit, cam);
          label(ctx, 'DÉBRIS', bp.x + 10, bp.y - 12, '#8c9a99', 8);
        }
        if (!system.planets.length) label(ctx, 'AUCUNE PLANÈTE DÉTECTÉE', star.x, star.y + sr + 58, '#7d98a9', 8, 'center');
      }
      for (const planet of system.planets) {
        const pos = World.planetPosition(planet, state.simulation.time), p = project(pos.x, pos.y, cam);
        const radius = Math.max(1.1, planet.radius * cam.zoom);
        if (p.x + radius * 1.4 < 0 || p.x - radius * 1.4 > W || p.y + radius < 0 || p.y - radius > H) continue;
        dot(ctx, p.x, p.y, radius, '#102230'); circle(ctx, p.x, p.y, radius, planet.color, 1);
        if (radius > 4 && radius < 90) {
          ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, radius - .5, 0, TAU); ctx.clip();
          ctx.strokeStyle = planet.color + '77'; ctx.lineWidth = .6;
          ctx.beginPath(); ctx.ellipse(p.x, p.y, radius * .45, radius, 0, 0, TAU); ctx.stroke();
          line(ctx, [{ x: p.x - radius, y: p.y }, { x: p.x + radius, y: p.y }], planet.color + '99', .6); ctx.restore();
        }
        if (planet.kind !== 'gazeuse' && radius > 18 && context.terrains.has(planet.id)) drawPlanetTerrain(planet, context, p, radius);
        const selected = state.selected?.id === planet.id;
        if (selected && radius < 90) circle(ctx, p.x, p.y, radius + 5, '#e6a25a', 1);
        if (!detailed || radius > 90) continue;
        // Short orbital designations keep ten-world systems readable on mobile.
        const name = (selected || cam.zoom > .38 ? planet.name : planet.name.slice(system.name.length).trim()).toUpperCase();
        const textWidth = name.length * 5.5;
        const align = p.x + radius + 9 + textWidth > W - 14 ? 'right' : 'left';
        const lx = align === 'left' ? p.x + radius + 9 : p.x - radius - 9;
        let ly = p.y - 5;
        for (const offset of [-5, -23, 18, 35]) {
          const candidate = { x: align === 'left' ? lx : lx - textWidth, y: p.y + offset - 6, w: textWidth, h: 14 };
          if (!planetLabels.some(r => candidate.x < r.x + r.w + 3 && candidate.x + candidate.w + 3 > r.x && candidate.y < r.y + r.h + 3 && candidate.y + candidate.h + 3 > r.y)) {
            ly = p.y + offset; planetLabels.push(candidate); break;
          }
        }
        label(ctx, name, lx, ly, selected ? '#d9c1a1' : '#91aeba', 9, align);
        if (selected || cam.zoom > .38) label(ctx, planet.kind.toUpperCase(), lx, ly + 14, '#5f8195', 7, align);
      }
      if (detailed && system.wreck) {
        const wa = system.wreck.phase + state.simulation.time * .002;
        const wreck = project(Math.cos(wa) * system.wreck.orbit, Math.sin(wa) * system.wreck.orbit, cam);
        ctx.save(); ctx.translate(wreck.x, wreck.y); ctx.rotate(-.55);
        line(ctx, [{ x: -6, y: -3 }, { x: 5, y: -3 }, { x: 7, y: 2 }, { x: -4, y: 3 }, { x: -6, y: -3 }], '#a4b4bd', .8);
        line(ctx, [{ x: -2, y: -6 }, { x: -2, y: 6 }], '#a4b4bd', .8); ctx.restore();
        label(ctx, 'ÉPAVE', wreck.x + 12, wreck.y, '#7d98a9', 8);
      }
    }

    const PALETTE = [
      [0, '#101f2c'], [68, '#182d37'], [88, '#2a3c3f'], [98, '#505b52'],
      [103, '#aaa58d'], [109, '#7b826d'], [125, '#68745f'], [143, '#586851'],
      [159, '#47594a'], [177, '#505a4e'], [192, '#666a5b'], [209, '#7c7d6a'],
      [230, '#9d967e'], [246, '#b9ad91']
    ];
    function hexRGB(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
    function createTerrainTexture(planet, terrainData) {
      const { width, height, elevation, moisture } = terrainData;
      const textureScale = Config.terrain.textureScale;
      const rawCanvas = makeCanvas(width, height), rc = rawCanvas.getContext('2d'), image = rc.createImageData(width, height);
      const palette = PALETTE.map(([threshold, hex]) => [threshold, hexRGB(hex)]);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x, value = elevation[i];
        let rgb = palette[0][1]; for (const entry of palette) if (value >= entry[0]) rgb = entry[1];
        const dx = elevation[y * width + Math.min(width - 1, x + 1)] - elevation[y * width + Math.max(0, x - 1)];
        const dy = elevation[Math.min(height - 1, y + 1) * width + x] - elevation[Math.max(0, y - 1) * width + x];
        let shade = clamp((-dx * 1.5 - dy * 1.8), -30, 25);
        if (value > 109 && value < 209) {
          const humidity = (moisture[i] - 128) / 255;
          rgb = [rgb[0] - humidity * 7, rgb[1] + humidity * 10, rgb[2] + humidity * 5];
        }
        if (planet.kind === 'aride') rgb = [rgb[0] + 14, rgb[1] - 4, rgb[2] - 10];
        if (planet.kind === 'glacée' && value > 105) rgb = [rgb[0] + 26, rgb[1] + 31, rgb[2] + 32];
        if (planet.kind === 'volcanique' && value > 109) rgb = [rgb[0] + 8, rgb[1] - 13, rgb[2] - 14];
        for (let k = 0; k < 3; k++) image.data[i * 4 + k] = clamp(rgb[k] + shade, 0, 255);
        image.data[i * 4 + 3] = 255;
      }
      rc.putImageData(image, 0, 0);
      const terrainTexture = makeCanvas(width * textureScale, height * textureScale);
      const c = terrainTexture.getContext('2d'); c.imageSmoothingEnabled = true; c.drawImage(rawCanvas, 0, 0, terrainTexture.width, terrainTexture.height);
      // Interpolated contour lines retain the topographic map at every zoom.
      const contourLevels = [...Array.from({ length: 40 }, (_, i) => 48 + i * 5), 103];
      let edgeX = 0, edgeY = 0, pairing = false;
      function contourEdge(x, y) {
        if (pairing) { c.moveTo(edgeX * textureScale, edgeY * textureScale); c.lineTo(x * textureScale, y * textureScale); }
        else { edgeX = x; edgeY = y; }
        pairing = !pairing;
      }
      for (const level of contourLevels) {
        const coastline = level === 103;
        const indexContour = !coastline && (level - 48) % 20 === 0;
        c.beginPath();
        c.strokeStyle = coastline ? '#d3c9a878' : level < 102 ? '#9db3b02c' : indexContour ? '#d0cbb04f' : '#c6cbb13c';
        c.lineWidth = coastline ? 1.15 : indexContour ? .85 : .56;
        for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
          const a = elevation[y * width + x], b = elevation[y * width + x + 1];
          const d = elevation[(y + 1) * width + x], e = elevation[(y + 1) * width + x + 1];
          const mask = (a < level ? 1 : 0) | (b < level ? 2 : 0) | (e < level ? 4 : 0) | (d < level ? 8 : 0);
          if (mask === 0 || mask === 15) continue;
          pairing = false;
          if ((a < level) !== (b < level)) contourEdge(x + (level - a) / (b - a), y);
          if ((b < level) !== (e < level)) contourEdge(x + 1, y + (level - b) / (e - b));
          if ((e < level) !== (d < level)) contourEdge(x + 1 - (level - e) / (d - e), y + 1);
          if ((d < level) !== (a < level)) contourEdge(x, y + 1 - (level - d) / (a - d));
        }
        c.stroke();
      }
      const random = World.rng(planet.seed + 113);
      for (let i = 0; i < 800; i++) {
        const x = Math.floor(random() * width), y = Math.floor(random() * height), index = y * width + x;
        if (elevation[index] > 113 && elevation[index] < 165 && moisture[index] > 139) {
          dot(c, x * textureScale, y * textureScale, 1 + random() * 3.5, '#243e3327');
        }
      }
      return terrainTexture;
    }
    function nearestRoutePoint(route, target) {
      const points = route.points?.length > 1 ? route.points :
        Array.from({ length: 33 }, (_, index) => FactorySimulation.routePoint(route, index / 32));
      let closest = points[0], best = Infinity;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
        const t = clamp(((target.x - a.x) * dx + (target.y - a.y) * dy) / Math.max(.0001, dx * dx + dy * dy), 0, 1);
        const point = { x: a.x + dx * t, y: a.y + dy * t }, distanceToRoute = distance(point, target);
        if (distanceToRoute < best) { best = distanceToRoute; closest = point; }
      }
      return { ...closest };
    }
    function organicBranches(factory, planet, route) {
      if (!route) return [];
      const buildings = Construction.list(state.simulation, planet.id)
        .filter(item => item.status === 'complete' && item.id !== factory.buildingId && item.id !== route.destinationId);
      const signature = `${factory.outputDestinationId}:${route.length.toFixed(2)}:${route.points?.length || 0}:` +
        buildings.map(item => `${item.id}:${item.type}:${item.x.toFixed(1)}:${item.y.toFixed(1)}`).join('|');
      const cached = surfaceBranchCache.get(factory.id);
      if (cached?.signature === signature) return cached.branches;
      const branches = [];
      for (const building of buildings) {
        const junction = nearestRoutePoint(route, building);
        if (distance(junction, building) < 24) continue;
        const branch = FactorySimulation.routeBetween(state.simulation, planet.id, junction,
          { x: building.x, y: building.y }, factory.buildingId, building.id);
        if (branch) branches.push({ route: branch, junction, end: { x: building.x, y: building.y } });
      }
      surfaceBranchCache.set(factory.id, { signature, branches });
      if (surfaceBranchCache.size > 32) surfaceBranchCache.delete(surfaceBranchCache.keys().next().value);
      return branches;
    }
    function drawLogisticsRoutes(cam, planet) {
      const buildings = Construction.list(state.simulation, planet.id);
      for (const building of buildings) {
        if (building.type !== 'factory') continue;
        const factory = FactorySimulation.byBuilding(state.simulation, building.id);
        const destinationIds = new Set((factory.shipments || []).map(shipment => shipment.destinationId));
        for (const truck of factory.trucks || []) if (truck.destinationId) destinationIds.add(truck.destinationId);
        if (factory.outputDestinationId) destinationIds.add(factory.outputDestinationId);
        for (const destinationId of destinationIds) {
          const shipment = (factory.shipments || []).find(item => item.destinationId === destinationId);
          const truck = (factory.trucks || []).find(item => item.destinationId === destinationId && item.route);
          const route = destinationId === factory.outputDestinationId ? (factory.outputRoute || FactorySimulation.routeGeometry(state.simulation, factory.id)) :
            truck?.route || shipment?.route || FactorySimulation.routeGeometry(state.simulation, factory.id, destinationId);
          if (!route) continue;
          const start = project(route.start.x, route.start.y, cam), end = project(route.end.x, route.end.y, cam);
          if (Math.max(start.x, end.x) < -W || Math.min(start.x, end.x) > W * 2 ||
            Math.max(start.y, end.y) < -H || Math.min(start.y, end.y) > H * 2) continue;
          const trace = path => {
            const samples = path.points?.length > 1 ? path.points :
              Array.from({ length: 33 }, (_, index) => FactorySimulation.routePoint(path, index / 32));
            const screen = samples.map(point => project(point.x, point.y, cam));
            ctx.beginPath(); ctx.moveTo(screen[0].x, screen[0].y);
            if (screen.length < 3) ctx.lineTo(screen[screen.length - 1].x, screen[screen.length - 1].y);
            else {
              for (let i = 1; i < screen.length - 1; i++) {
                const midpoint = { x: (screen[i].x + screen[i + 1].x) / 2, y: (screen[i].y + screen[i + 1].y) / 2 };
                ctx.quadraticCurveTo(screen[i].x, screen[i].y, midpoint.x, midpoint.y);
              }
              ctx.lineTo(screen[screen.length - 1].x, screen[screen.length - 1].y);
            }
          };
          const strokeRoute = (path, branch = false) => {
            ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            trace(path); ctx.strokeStyle = '#14231fc7'; ctx.lineWidth = branch ? clamp(cam.zoom * 3.2, 1, 3) : clamp(cam.zoom * 4.2, 1.2, 4); ctx.stroke();
            trace(path); ctx.strokeStyle = branch ? '#c6c9ae99' : '#d4d0b1c4';
            ctx.lineWidth = branch ? clamp(cam.zoom * .7, .55, .9) : clamp(cam.zoom * .9, .65, 1.1);
            ctx.setLineDash(branch ? [Math.max(2, cam.zoom * 2.2), Math.max(3, cam.zoom * 5.5)] : []); ctx.stroke();
            ctx.setLineDash([]); ctx.restore();
          };
          const branches = destinationId === factory.outputDestinationId ? organicBranches(factory, planet, route) : [];
          for (const branch of branches) {
            strokeRoute(branch.route, true);
            const junction = project(branch.junction.x, branch.junction.y, cam), terminal = project(branch.end.x, branch.end.y, cam);
            circle(ctx, junction.x, junction.y, clamp(cam.zoom * 5, 3, 5), '#d4cdb577', .7);
            dot(ctx, junction.x, junction.y, clamp(cam.zoom * 2.1, 1.2, 2.2), '#d6d0b7');
            dot(ctx, terminal.x, terminal.y, clamp(cam.zoom * 2.4, 1.4, 2.4), '#d6d0b7');
          }
          strokeRoute(route);
          for (const shipment of factory.shipments || []) {
            if (shipment.destinationId !== destinationId) continue;
            const shipmentRoute = shipment.route || route;
            const t = clamp(shipment.elapsed / shipment.duration, 0, 1), resource = ResourceData.definitions[shipment.item];
            for (let trail = 2; trail >= 0; trail--) {
              const at = Math.max(0, t - trail * .045), point = FactorySimulation.routePoint(shipmentRoute, at), p = project(point.x, point.y, cam);
              dot(ctx, p.x, p.y, Math.max(1.7, Math.min(4.2, 1.8 + cam.zoom * 1.5)) * (trail ? .68 : 1), resource?.color || '#d8c79e');
            }
          }
          for (const vehicle of factory.trucks || []) {
            if (vehicle.destinationId !== destinationId || !vehicle.route || !['loading', 'outbound', 'returning'].includes(vehicle.status)) continue;
            const progress = vehicle.status === 'loading' ? 0 : clamp(vehicle.elapsed / vehicle.duration, 0, 1);
            const t = vehicle.status === 'returning' ? 1 - progress : progress;
            const point = FactorySimulation.routePoint(vehicle.route, t), p = project(point.x, point.y, cam);
            const before = FactorySimulation.routePoint(vehicle.route, Math.max(0, t - .015));
            const after = FactorySimulation.routePoint(vehicle.route, Math.min(1, t + .015));
            const direction = vehicle.status === 'returning' ? -1 : 1;
            const angle = Math.atan2((after.y - before.y) * direction, (after.x - before.x) * direction);
            const item = Object.keys(vehicle.cargo || {}).find(id => vehicle.cargo[id] > 0);
            const color = vehicle.status === 'returning' ? '#273b40' :
              ResourceData.definitions[item]?.color || vehicle.resourceColor || '#d8c79e';
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle); ctx.scale(clamp(.8 + cam.zoom * .15, .8, 1.2), clamp(.8 + cam.zoom * .15, .8, 1.2));
            ctx.fillStyle = '#111b20'; ctx.strokeStyle = '#e3dfc8'; ctx.lineWidth = .9;
            ctx.beginPath(); ctx.roundRect(-6.5, -4, 13, 8, 1.8); ctx.fill(); ctx.stroke();
            ctx.fillStyle = color; ctx.fillRect(-4.7, -2.5, 5.7, 5);
            ctx.fillStyle = '#c7d0cc'; ctx.fillRect(1.7, -2.5, 3.1, 5);
            ctx.fillStyle = '#091114'; ctx.fillRect(-4.4, -4.7, 2.7, 1.3); ctx.fillRect(2.8, -4.7, 2.7, 1.3);
            ctx.fillRect(-4.4, 3.4, 2.7, 1.3); ctx.fillRect(2.8, 3.4, 2.7, 1.3);
            ctx.restore();
          }
          ctx.restore();
        }
      }
    }
    function drawBuildingPlan(type, radius, color) {
      ctx.save(); ctx.fillStyle = '#101d22e8'; ctx.strokeStyle = color; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.roundRect(-radius, -radius * .76, radius * 2, radius * 1.52, Math.max(2, radius * .16)); ctx.fill(); ctx.stroke();
      const scale = radius / 24; ctx.scale(scale, scale); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = color; ctx.fillStyle = color + '55'; ctx.lineWidth = 1.4;
      if (type === 'outpost') {
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill(); ctx.stroke();
        for (const [x, y] of [[-15, -10], [15, -10], [-15, 10], [15, 10]]) {
          ctx.strokeRect(x - 4, y - 3, 8, 6); line(ctx, [{ x: x < 0 ? -9 : 9, y: y < 0 ? -3 : 3 }, { x: x < 0 ? -12 : 12, y }], color, 1);
        }
      } else if (type === 'factory') {
        ctx.fillRect(-17, -10, 34, 20); ctx.strokeRect(-17, -10, 34, 20);
        for (let x = -9; x <= 9; x += 9) line(ctx, [{ x, y: -9 }, { x, y: 9 }], color, 1);
        ctx.fillRect(-14, -14, 5, 5); ctx.fillRect(8, -14, 5, 5);
        line(ctx, [{ x: -14, y: 11 }, { x: 14, y: 11 }], '#d4a56e', 1);
      } else if (type === 'extractor') {
        for (let i = 0; i < 4; i++) {
          const angle = i * Math.PI / 2;
          line(ctx, [{ x: Math.cos(angle) * 5, y: Math.sin(angle) * 5 }, { x: Math.cos(angle) * 17, y: Math.sin(angle) * 17 }], color, 1.5);
          circle(ctx, Math.cos(angle) * 17, Math.sin(angle) * 17, 2, color, 1);
        }
        circle(ctx, 0, 0, 7, color, 1.5); dot(ctx, 0, 0, 3, color);
      } else if (type === 'depot') {
        for (let x = -11; x <= 11; x += 11) {
          ctx.beginPath(); ctx.roundRect(x - 4, -12, 8, 24, 3); ctx.fill(); ctx.stroke();
          line(ctx, [{ x: x - 3, y: -5 }, { x: x + 3, y: -5 }], color, .8);
          line(ctx, [{ x: x - 3, y: 3 }, { x: x + 3, y: 3 }], color, .8);
        }
      } else if (type === 'port') {
        ctx.setLineDash([3, 3]); ctx.strokeRect(-19, -9, 38, 18); ctx.setLineDash([]);
        line(ctx, [{ x: -15, y: 0 }, { x: 15, y: 0 }], color + 'bb', 1);
        ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(4, -4); ctx.lineTo(9, 0); ctx.lineTo(4, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
        line(ctx, [{ x: 12, y: -13 }, { x: 18, y: -13 }, { x: 18, y: 13 }], '#d4a56e', 1);
      }
      ctx.restore();
    }
    function drawSurfaceBuilding(cam, building) {
      const definition = BuildingData.definitions[building.type];
      if (!definition) return;
      const p = project(building.x, building.y, cam);
      const radius = clamp(definition.footprint * cam.zoom * .32, 5.5, 22);
      if (p.x < -radius * 2 || p.y < -radius * 2 || p.x > W + radius * 2 || p.y > H + radius * 2) return;
      const selected = state.selected?.entityType === 'building' && state.selected.id === building.id;
      ctx.save(); ctx.translate(p.x, p.y);
      if (building.status === 'constructing') {
        circle(ctx, 0, 0, radius + 3, '#b9c7c06b', .8, [2, 3]);
        ctx.strokeStyle = definition.color; ctx.lineWidth = 1.7; ctx.beginPath();
        ctx.arc(0, 0, radius + 3, -Math.PI / 2, -Math.PI / 2 + TAU * Construction.progress(state.simulation, building)); ctx.stroke();
        line(ctx, [{ x: -radius, y: -radius }, { x: radius, y: radius }], '#d7caaa78', .8);
        line(ctx, [{ x: radius, y: -radius }, { x: -radius, y: radius }], '#d7caaa78', .8);
        ctx.strokeStyle = '#aabcb86e'; ctx.strokeRect(-radius, -radius, radius * 2, radius * 2);
      } else {
        drawBuildingPlan(building.type, radius, definition.color);
      }
      if (selected) circle(ctx, 0, 0, radius + 7, '#efa35a', 1);
      ctx.restore();
      if (cam.zoom > .55 || selected) label(ctx, `${definition.code} · ${building.status === 'complete' ? 'ACTIF' : Math.round(Construction.progress(state.simulation, building) * 100) + '%'}`,
        p.x + radius + 7, p.y - radius - 2, selected ? '#f0b478' : '#b7c7c2', 8);
    }
    function drawBlockPlan(type, x, y, size, color) {
      if (size < 2) return;
      ctx.save(); ctx.translate(x, y); ctx.scale(size / 24, size / 24);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 1.7; ctx.strokeStyle = color; ctx.fillStyle = color + '42';
      if (type === 'input') {
        ctx.beginPath(); ctx.moveTo(-17, -7); ctx.lineTo(5, -7); ctx.lineTo(5, -13); ctx.lineTo(17, 0); ctx.lineTo(5, 13); ctx.lineTo(5, 7); ctx.lineTo(-17, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
        for (const [cx, cy, r] of [[-11, -3, 2], [-4, 2, 2.5], [-12, 4, 1.5]]) dot(ctx, cx, cy, r, color);
      } else if (type === 'transform') {
        circle(ctx, 0, 0, 10, color, 2); circle(ctx, 0, 0, 4, color, 1.5);
        for (let i = 0; i < 8; i++) {
          const a = i * TAU / 8, inner = 10, outer = 15;
          line(ctx, [{ x: Math.cos(a) * inner, y: Math.sin(a) * inner }, { x: Math.cos(a) * outer, y: Math.sin(a) * outer }], color, 2);
        }
      } else if (type === 'storage') {
        for (let cx = -9; cx <= 9; cx += 9) {
          ctx.beginPath(); ctx.roundRect(cx - 4, -11, 8, 22, 3); ctx.fill(); ctx.stroke();
          line(ctx, [{ x: cx - 2, y: -4 }, { x: cx + 2, y: -4 }], color, 1);
          line(ctx, [{ x: cx - 2, y: 3 }, { x: cx + 2, y: 3 }], color, 1);
        }
      } else if (type === 'output') {
        ctx.strokeRect(-15, -10, 22, 20); line(ctx, [{ x: -10, y: 0 }, { x: 17, y: 0 }], color, 2);
        line(ctx, [{ x: 10, y: -7 }, { x: 17, y: 0 }, { x: 10, y: 7 }], color, 2);
      } else if (type === 'splitter') {
        line(ctx, [{ x: -16, y: 0 }, { x: -4, y: 0 }, { x: 7, y: -10 }, { x: 16, y: -10 }], color, 2);
        line(ctx, [{ x: -4, y: 0 }, { x: 7, y: 10 }, { x: 16, y: 10 }], color, 2); dot(ctx, -4, 0, 3, color);
      } else if (type === 'merger') {
        line(ctx, [{ x: -16, y: -10 }, { x: -7, y: -10 }, { x: 4, y: 0 }, { x: 16, y: 0 }], color, 2);
        line(ctx, [{ x: -16, y: 10 }, { x: -7, y: 10 }, { x: 4, y: 0 }], color, 2); dot(ctx, 4, 0, 3, color);
      }
      ctx.restore();
    }
    function factoryPort(block, port, direction, camera) {
      const count = direction === 'out' ? BlockData.definitions[block.type].outputPorts : BlockData.definitions[block.type].inputPorts;
      const index = Number(port.split('-')[1]) - 1;
      const y = block.y + (index - (count - 1) / 2) * 24;
      return project(block.x + (direction === 'out' ? BlockData.node.width / 2 : -BlockData.node.width / 2), y, camera);
    }
    function drawFactoryInterior(camera, factory) {
      if (!factory) return;
      const a = project(0, 0, camera), b = project(factory.width, factory.height, camera);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), width = Math.abs(b.x - a.x), height = Math.abs(b.y - a.y);
      if (x > W || y > H || x + width < 0 || y + height < 0) return;
      const reveal = clamp((height - 60) / 180, 0, 1);
      if (reveal <= 0) return;
      ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, width, height, Math.min(9, Math.max(0, 6 * camera.zoom))); ctx.clip();
      ctx.globalAlpha *= reveal;
      ctx.fillStyle = '#0a172215'; ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = '#83c3d014'; ctx.lineWidth = 1; ctx.beginPath();
      for (let gx = Math.ceil((0 - camera.x) / 48) * 48; gx < factory.width; gx += 48) {
        const px = project(gx, 0, camera).x; ctx.moveTo(px, y); ctx.lineTo(px, y + height);
      }
      for (let gy = Math.ceil((0 - camera.y) / 48) * 48; gy < factory.height; gy += 48) {
        const py = project(0, gy, camera).y; ctx.moveTo(x, py); ctx.lineTo(x + width, py);
      }
      ctx.stroke();
      ctx.strokeStyle = '#8fcbd253'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, Math.max(0, width - 1), Math.max(0, height - 1));
      for (const edge of factory.connections) {
        const from = factory.blocks[edge.from], to = factory.blocks[edge.to];
        if (!from || !to) continue;
        const p1 = factoryPort(from, edge.fromPort, 'out', camera), p2 = factoryPort(to, edge.toPort, 'in', camera);
        const bend = Math.max(24, Math.abs(p2.x - p1.x) * .42);
        ctx.strokeStyle = state.connectionSource === from.id ? '#efb67bba' : '#65b7c68a'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.bezierCurveTo(p1.x + bend, p1.y, p2.x - bend, p2.y, p2.x, p2.y); ctx.stroke();
        const t = (state.simulation.time * .45 + Number(edge.id.replace(/\D/g, '')) * .18) % 1;
        const u = 1 - t, px = u * u * u * p1.x + 3 * u * u * t * (p1.x + bend) + 3 * u * t * t * (p2.x - bend) + t * t * t * p2.x;
        const py = u * u * u * p1.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p2.y;
        dot(ctx, px, py, 2, '#b2e1d9');
      }
      for (const id of factory.order) {
        const block = factory.blocks[id], definition = BlockData.definitions[block.type];
        const center = project(block.x, block.y, camera), bw = BlockData.node.width * camera.zoom, bh = BlockData.node.height * camera.zoom;
        if (center.x + bw < 0 || center.x - bw > W || center.y + bh < 0 || center.y - bh > H) continue;
        const selected = state.selected?.entityType === 'block' && state.selected.id === block.id;
        const left = center.x - bw / 2, top = center.y - bh / 2;
        ctx.fillStyle = '#102333ed'; ctx.strokeStyle = selected ? '#efa35a' : definition.color + 'bb'; ctx.lineWidth = selected ? 1.6 : 1;
        ctx.beginPath(); ctx.roundRect(left, top, bw, bh, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = definition.color + '30'; ctx.fillRect(left + 1, top + 1, Math.max(0, bw - 2), Math.max(8, 26 * camera.zoom));
        label(ctx, definition.code, left + 9 * camera.zoom, top + 13 * camera.zoom, definition.color, 9);
        label(ctx, definition.name.toUpperCase(), left + bw / 2, top + 35 * camera.zoom, '#d3e3e8', 8, 'center');
        drawBlockPlan(block.type, left + bw - 18 * camera.zoom, top + 14 * camera.zoom, 10 * camera.zoom, definition.color);
        const contents = Object.entries(block.stock || {}).filter(([, amount]) => amount > 0).slice(0, 2);
        contents.forEach(([resource, amount], index) => label(ctx, `${ResourceData.definitions[resource]?.short || resource} ${Math.floor(amount)}/${block.capacity}`,
          left + 9 * camera.zoom, top + (62 + index * 15) * camera.zoom, ResourceData.definitions[resource]?.color || '#a9c6cf', 8));
        const status = block.status === 'starved' ? 'FAMINE' : block.status === 'blocked' ? 'BLOQUÉ' : block.status === 'running' ? 'ACTIF' : 'EN ATTENTE';
        label(ctx, status, left + 9 * camera.zoom, top + bh - 12 * camera.zoom, block.status === 'blocked' ? '#e1a276' : '#7194a2', 7);
        const portCountIn = definition.inputPorts, portCountOut = definition.outputPorts;
        for (let port = 1; port <= portCountIn; port++) { const p = factoryPort(block, `in-${port}`, 'in', camera); dot(ctx, p.x, p.y, 3, '#80c6d4'); }
        for (let port = 1; port <= portCountOut; port++) { const p = factoryPort(block, `out-${port}`, 'out', camera); dot(ctx, p.x, p.y, 3, '#80c6d4'); }
      }
      label(ctx, `RANG ${factory.rank}   /   ESPACE ${factory.width} × ${factory.height}`, x + 12, y + height - 13, '#5d8797', 8);
      ctx.restore();
    }
    function drawSurface(cam, planet, record) {
      const { texture: terrainTexture, data: terrainData } = record;
      const top = project(0, 0, cam), scale = cam.zoom;
      ctx.imageSmoothingEnabled = true; ctx.drawImage(terrainTexture, top.x, top.y, terrainTexture.width * scale, terrainTexture.height * scale);
      if (scale > .06) drawGrid(cam, true);
      drawLogisticsRoutes(cam, planet);
      const bottom = project(terrainTexture.width, terrainTexture.height, cam);
      ctx.strokeStyle = '#a9b9ad40'; ctx.lineWidth = 1; ctx.strokeRect(top.x, top.y, bottom.x - top.x, bottom.y - top.y);
      if (scale >= .15) for (const res of terrainData.resources) {
        const p = project(res.x * Config.terrain.textureScale, res.y * Config.terrain.textureScale, cam), r = 8 + 4 * scale;
        if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) continue;
        ctx.save(); ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.35, r * .75, -.45, 0, TAU); ctx.clip();
        for (let i = -r * 2; i < r * 2; i += 4) line(ctx, [{ x: p.x + i - r, y: p.y + r }, { x: p.x + i + r, y: p.y - r }], '#e7cf8291', .7);
        ctx.restore();
        if (scale > .55) label(ctx, res.type.toUpperCase(), p.x + r + 6, p.y, '#c7c49b', 8);
      }
      for (const building of Construction.list(state.simulation, planet.id)) {
        if (factoryView?.building.id !== building.id) drawSurfaceBuilding(cam, building);
      }
      if (factoryView?.building.planetId === planet.id) {
        const nested = Camera.toLocal(factoryView.mapFrame, cam);
        drawFactoryInterior(nested, factoryView.factory);
      }
      if (scale < .15) return;
      if (state.selected?.surfacePoint) {
        const p = project(state.selected.x, state.selected.y, cam);
        circle(ctx, p.x, p.y, 7, '#efb26e', 1);
        line(ctx, [{ x: p.x - 13, y: p.y }, { x: p.x - 9, y: p.y }], '#efb26e', .8);
        line(ctx, [{ x: p.x + 9, y: p.y }, { x: p.x + 13, y: p.y }], '#efb26e', .8);
        line(ctx, [{ x: p.x, y: p.y - 13 }, { x: p.x, y: p.y - 9 }], '#efb26e', .8);
        line(ctx, [{ x: p.x, y: p.y + 9 }, { x: p.x, y: p.y + 13 }], '#efb26e', .8);
      }
      label(ctx, planet.name.toUpperCase() + ' / RELEVÉ TOPOGRAPHIQUE', top.x + 15, bottom.y - 16, '#c3c9b1', 8);
    }
    function drawPlanetTerrain(planet, context, center, radius) {
      const record = context.terrains.get(planet.id);
      if (!record) return;
      const frame = surfaceFrame(planet, context), open = ease(clamp((radius - 50) / 100, 0, 1));
      const width = radius * 2 * (1 + open / 3), height = radius * 2;
      // The texture's world position never changes. Only the globe's clipping
      // outline opens into the rectangular map as more terrain becomes visible.
      ctx.save(); ctx.beginPath(); ctx.roundRect(center.x - width / 2, center.y - height / 2, width, height, Math.max(0, radius * (1 - open))); ctx.clip();
      drawSurface(localCamera(frame), planet, record);
      ctx.restore();
    }
    function drawUniverse() {
      ctx.fillStyle = '#101b28'; ctx.fillRect(0, 0, W, H);
      const cam = state.camera;
      if ((state.level === 'surface' || state.level === 'factory') && state.planet) {
        const p = planetWorldPosition(state.planet), center = project(p.x, p.y), r = state.planet.radius * state.context.frame.scale * cam.zoom;
        if (state.level === 'factory' || r > Math.max(W, H) * 1.5) { drawPlanetTerrain(state.planet, state.context, center, r); return; }
      }
      drawGalaxy(cam);
      if (cam.zoom < .7) return;
      if (state.context && state.level === 'system') drawGrid(localCamera(state.context.frame), false, true);
      for (const context of visibleContexts) {
        const local = localCamera(context.frame);
        if (local.zoom < .025) continue;
        drawSystem(local, context.model, context);
      }
    }

    function resize(width, height, ratio) {
      W = width; H = height; DPR = ratio;
      viewport.width = W; viewport.height = H;
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    function render(scene) {
      ({ state, galaxy, home, contexts, visibleContexts, factoryView, now } = scene);
      drawUniverse();
    }
    return Object.freeze({ resize, render, prepareGalaxy, createTerrainTexture });
  }
  root.OrbitRenderer = Object.freeze({ create });
})(globalThis);
