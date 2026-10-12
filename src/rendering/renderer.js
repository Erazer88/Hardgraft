(function (root) {
  'use strict';
  const World = root.OrbitWorld, Camera = root.OrbitCamera;
  const SurfaceStyle = root.OrbitSurfaceStyle;
  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t * t * (3 - 2 * t);

  function create(canvas, options = {}) {
    const ctx = canvas.getContext('2d', { alpha: false });
    let W = 1, H = 1, DPR = 1;
    let state, galaxy, home, contexts, visibleContexts, now;
    let galaxyTexture, fogCanvas, fogMask;
    const viewport = { width: W, height: H };
    function project(x, y, cam = state.camera) { return Camera.project({ x, y }, cam, viewport); }
    function localCamera(frame) { return Camera.toLocal(frame, state.camera); }
    function planetWorldPosition(planet, context = state.context) {
      return Camera.worldPoint(context.frame, World.planetPosition(planet, state.simulation.time));
    }
    function surfaceFrame(planet, context) {
      const record = context.terrains.get(planet.id);
      const texture = record.texture;
      return Camera.surfaceFrame(planetWorldPosition(planet, context), planet.radius * context.frame.scale,
        { width: texture.logicalWidth || texture.width, height: texture.logicalHeight || texture.height });
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
    const surfaceRenderer = root.OrbitSurfaceRenderer.create(ctx, {
      project, localCamera, surfaceFrame,
      getState: () => state,
      getViewport: () => viewport,
      getNow: () => now,
      isCameraInteracting: options.isCameraInteracting || (() => false),
      drawLine: line, drawCircle: circle, drawLabel: label,
      layers: {
        roads: root.OrbitRoadRenderer,
        settlements: root.OrbitSettlementRenderer,
        buildings: root.OrbitBuildingRenderer,
        vehicles: root.OrbitVehicleRenderer
      }
    });
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
    function drawGrid(cam, blueprint = false) {
      const worldStep = blueprint ? 200 : 500;
      let step = worldStep * cam.zoom;
      let scaleStep = worldStep;
      while (step < 45) { step *= 2; scaleStep *= 2; }
      while (step > 180) { step /= 2; scaleStep /= 2; }
      const origin = project(0, 0, cam);
      ctx.lineWidth = 1; ctx.strokeStyle = blueprint ? '#87bace15' : '#87bace0d';
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
          line(ctx, [{ x: x - 2.5, y }, { x: x + 2.5, y }], '#9ebacd25');
          line(ctx, [{ x, y: y - 2.5 }, { x, y: y + 2.5 }], '#9ebacd25');
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
      ctx.save();
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
        if (planet.kind !== 'gazeuse' && radius > 18 && context.terrains.has(planet.id)) {
          const suppressPreviewContours = state.level !== 'surface' || state.planet?.id !== planet.id;
          surfaceRenderer.drawPlanetTerrain(planet, context, p, radius, suppressPreviewContours);
        }
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

    function drawUniverse() {
      ctx.fillStyle = '#101b28'; ctx.fillRect(0, 0, W, H);
      const cam = state.camera;
      if (state.level === 'surface') {
        if (state.planet && state.context) {
          const p = planetWorldPosition(state.planet), center = project(p.x, p.y);
          const r = state.planet.radius * state.context.frame.scale * cam.zoom;
          surfaceRenderer.drawPlanetTerrain(state.planet, state.context, center, r);
        }
        return;
      }
      drawGalaxy(cam);
      if (cam.zoom < .7) return;
      if (state.context && state.level === 'system') drawGrid(localCamera(state.context.frame), true);
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
      ({ state, galaxy, home, contexts, visibleContexts, now } = scene);
      drawUniverse();
    }
    return Object.freeze({
      resize,
      render,
      prepareGalaxy,
      createTerrainTexture: surfaceRenderer.createTerrainTexture,
      createSurfaceDetail: surfaceRenderer.createSurfaceDetail,
      cancelSurfaceDetail: surfaceRenderer.cancelSurfaceDetail,
      releaseSurfaceDetail: surfaceRenderer.releaseDetail
    });
  }
  root.OrbitRenderer = Object.freeze({ create });
})(globalThis);
