(function () {
  'use strict';
  const World = globalThis.OrbitWorld;
  const $ = id => document.getElementById(id);
  const canvas = $('universe'), ctx = canvas.getContext('2d', { alpha: false });
  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t * t * (3 - 2 * t);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const fmt = n => new Intl.NumberFormat('fr-FR').format(n);
  const state = { seed: 'NEREIDE-01', level: 'galaxy', selected: null, system: null, planet: null,
    camera: { x: 0, y: 0, zoom: .1 }, target: { x: 0, y: 0, zoom: .1 }, time: 0,
    paused: false, reveal: false, tool: 'pan', scans: [], missions: [], terrain: null,
    visited: new Set(), context: null, tracking: null, focusPlanet: null };
  let galaxy, home, galaxyTexture, fogCanvas, fogMask, terrainTexture, terrainData;
  let W = innerWidth, H = innerHeight, DPR = Math.min(devicePixelRatio || 1, 2), lastTime = 0;
  let lastHUD = 0, toastTimer, pointerMoved = false, menuStarted = false, pinch = null;
  const pointers = new Map();
  const contexts = new Map();
  const pointersLast = new Map();

  function stored() { try { return JSON.parse(localStorage.getItem('nereide-atlas-v1') || 'null'); } catch (_) { return null; } }
  function persist() {
    try { localStorage.setItem('nereide-atlas-v1', JSON.stringify({ seed: state.seed,
      discovered: galaxy.systems.filter(s => s.discovered).map(s => s.id), scans: state.scans,
      visited: [...state.visited], time: state.time })); } catch (_) { /* The atlas works without storage. */ }
  }
  function normalizedSeed(value) {
    const text = String(value).trim() || 'NEREIDE-01';
    return /^\d{1,9}$/.test(text) ? Number(text) : text.slice(0, 64);
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
  function project(x, y, cam = state.camera) {
    return { x: W / 2 + (x - cam.x) * cam.zoom, y: H / 2 + (y - cam.y) * cam.zoom };
  }
  function unproject(x, y, cam = state.camera) {
    return { x: cam.x + (x - W / 2) / cam.zoom, y: cam.y + (y - H / 2) / cam.zoom };
  }
  function toast(text) {
    $('toast').textContent = text; $('toast').classList.add('visible'); clearTimeout(toastTimer);
    $('toast').classList.toggle('above-inspector', !$('inspector').hidden);
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200);
  }
  // One camera, one galactic coordinate space, at every level of detail.
  function zoomLimits(anchor = state.camera) {
    let max = 2000000;
    if (state.context) {
      const planet = (state.level === 'surface' && state.tracking?.planet) || state.context.model.planets.find(p =>
        p.kind !== 'gazeuse' && distance(planetWorldPosition(p), anchor) <= p.radius * state.context.frame.scale * 1.4);
      // Stop at useful terrain detail rather than magnifying the raster into an
      // empty flat colour. This cap follows the planet's embedded map scale.
      if (planet) max = Math.min(max, 4 * 540 / (planet.radius * state.context.frame.scale));
    }
    return [.025, max];
  }
  function focusCamera(x, y, zoom, immediate = false) {
    const [min, max] = zoomLimits({ x, y });
    state.target = { x, y, zoom: clamp(zoom, min, max) };
    if (immediate) state.camera = { ...state.target };
  }
  function fitZoom(span) { return Math.min(W - 60, H - 215) / span; }
  function localCamera(frame, camera = state.camera) {
    return { x: (camera.x - frame.x) / frame.scale, y: (camera.y - frame.y) / frame.scale, zoom: camera.zoom * frame.scale };
  }
  function worldCamera(frame, camera) {
    return { x: frame.x + camera.x * frame.scale, y: frame.y + camera.y * frame.scale, zoom: camera.zoom / frame.scale };
  }
  function prepareSystem(star) {
    if (contexts.has(star.id)) return contexts.get(star.id);
    const model = World.createSystem(state.seed, star.id, galaxy);
    const neighborDistance = Math.min(...galaxy.systems.filter(s => s.id !== star.id).map(s => distance(s, star)));
    const scale = Math.max(.001, Math.min(.012, neighborDistance * .32 / (model.planets.at(-1).orbit + 150)));
    const context = { star, model, frame: { x: star.x, y: star.y, scale }, terrains: new Map() };
    contexts.set(star.id, context); return context;
  }
  function planetWorldPosition(planet, context = state.context) {
    const p = World.planetPosition(planet, state.time), f = context.frame;
    return { x: f.x + p.x * f.scale, y: f.y + p.y * f.scale };
  }
  function prepareTerrain(planet, context = state.context) {
    if (!context.terrains.has(planet.id)) {
      buildTerrain(planet);
      context.terrains.set(planet.id, { data: terrainData, texture: terrainTexture });
    }
    return context.terrains.get(planet.id);
  }
  function surfaceFrame(planet = state.planet, context = state.context) {
    const record = prepareTerrain(planet, context), p = planetWorldPosition(planet, context);
    const scale = planet.radius * context.frame.scale * 2 / record.texture.height;
    return { x: p.x - record.texture.width * scale / 2, y: p.y - record.texture.height * scale / 2, scale };
  }
  function cameraMoving() {
    return state.camera.zoom !== state.target.zoom || state.camera.x !== state.target.x || state.camera.y !== state.target.y;
  }
  function followPlanet(planet, context = state.context) {
    if (state.tracking?.planet.id === planet.id && state.tracking.context === context) return;
    state.tracking = { planet, context, position: planetWorldPosition(planet, context) };
  }
  function homeCamera() {
    if (state.level === 'galaxy') return { x: home.x - 200, y: home.y - 160, zoom: Math.max(.09, fitZoom(1900)) };
    if (state.level === 'system') return worldCamera(state.context.frame, { x: 115, y: 120, zoom: Math.max(.10, Math.min((W - 50) / 1900, (H - 210) / 2100)) });
    return worldCamera(surfaceFrame(), { x: terrainData.width * 3 / 2, y: terrainData.height * 3 / 2,
      zoom: Math.max(W / (terrainData.width * 3), H / (terrainData.height * 3)) * 1.08 });
  }
  function resetCamera(immediate = false) { const cam = homeCamera(); focusCamera(cam.x, cam.y, cam.zoom, immediate); }

  function buildGalaxyTexture() {
    const resolution = 1500, extent = 5900;
    galaxyTexture = makeCanvas(resolution, resolution);
    const c = galaxyTexture.getContext('2d'), unit = resolution / (extent * 2);
    const random = World.rng(World.hashSeed(state.seed + ':dust'));
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(.000001, random()))) * Math.cos(TAU * random());
    c.globalCompositeOperation = 'lighter';
    for (const s of galaxy.systems) {
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

  function regenerate(seed, restoring = null) {
    state.seed = normalizedSeed(seed); galaxy = World.createGalaxy(state.seed);
    home = galaxy.systems.find(s => s.id === galaxy.homeId);
    state.scans = [{ x: home.x, y: home.y, radius: 590 }];
    state.visited = new Set(); state.time = 0;
    if (restoring && restoring.seed === state.seed) {
      const discovered = new Set(restoring.discovered || []);
      galaxy.systems.forEach(s => { s.discovered = s.discovered || discovered.has(s.id); });
      state.scans = restoring.scans?.length ? restoring.scans : state.scans;
      state.visited = new Set(restoring.visited || []); state.time = restoring.time || 0;
    }
    state.level = 'galaxy'; state.system = null; state.planet = null; state.selected = null;
    state.missions = []; state.context = null; state.tracking = null; state.focusPlanet = null; state.tool = 'pan';
    state.terrain = null; terrainData = null; terrainTexture = null;
    contexts.clear();
    buildGalaxyTexture();
    focusCamera(home.x * .25, home.y * .3, Math.max(.045, fitZoom(6600)), true);
    $('seed-input').value = state.seed;
    $('inspector').hidden = true; updateUI(); persist();
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
      for (const scan of state.scans) {
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
      const t = (state.time * .03 + i * .16) % 1;
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
      if (state.visited.has(s.id)) circle(ctx, p.x, p.y, r + 3.5, '#95bac659', .7);
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
    for (const mission of state.missions) {
      const t = clamp((performance.now() - mission.start) / mission.duration, 0, 1);
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
    const detailed = cam.zoom >= .075;
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
        const angle = belt.phase + random() * TAU + state.time * .0018;
        const radius = belt.orbit + (random() - .5) * belt.width * 2;
        const p = project(Math.cos(angle) * radius, Math.sin(angle) * radius, cam);
        if (p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H) dot(ctx, p.x, p.y, .35 + random() * .55, '#a3a89b66');
      }
      const belt = system.debris[0], bp = project(Math.cos(belt.phase) * belt.orbit, Math.sin(belt.phase) * belt.orbit, cam);
      label(ctx, 'DÉBRIS', bp.x + 10, bp.y - 12, '#8c9a99', 8);
    }
    for (const planet of system.planets) {
      const pos = World.planetPosition(planet, state.time), p = project(pos.x, pos.y, cam);
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
      const name = planet.name.toUpperCase(), textWidth = name.length * 5.5;
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
    if (detailed) {
      const wa = system.wreck.phase + state.time * .002;
      const wreck = project(Math.cos(wa) * system.wreck.orbit, Math.sin(wa) * system.wreck.orbit, cam);
      ctx.save(); ctx.translate(wreck.x, wreck.y); ctx.rotate(-.55);
      line(ctx, [{ x: -6, y: -3 }, { x: 5, y: -3 }, { x: 7, y: 2 }, { x: -4, y: 3 }, { x: -6, y: -3 }], '#a4b4bd', .8);
      line(ctx, [{ x: -2, y: -6 }, { x: -2, y: 6 }], '#a4b4bd', .8); ctx.restore();
      label(ctx, 'ÉPAVE', wreck.x + 12, wreck.y, '#7d98a9', 8);
    }
  }

  const PALETTE = [
    [0, '#142b3b'], [68, '#1b3b4a'], [88, '#274e57'], [98, '#4c6966'],
    [103, '#b0ad8d'], [109, '#879578'], [125, '#738365'], [143, '#5e7257'],
    [159, '#4b604e'], [177, '#566357'], [192, '#777967'], [209, '#93907a'],
    [230, '#b7af94'], [246, '#ccc4ad']
  ];
  function hexRGB(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
  function buildTerrain(planet) {
    terrainData = World.createTerrain(planet.seed, 480, 360); state.terrain = terrainData;
    const { width, height, elevation, moisture } = terrainData;
    const rawCanvas = makeCanvas(width, height), rc = rawCanvas.getContext('2d'), image = rc.createImageData(width, height);
    const palette = PALETTE.map(([threshold, hex]) => [threshold, hexRGB(hex)]);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, value = elevation[i];
      let rgb = palette[0][1]; for (const entry of palette) if (value >= entry[0]) rgb = entry[1];
      const dx = elevation[y * width + Math.min(width - 1, x + 1)] - elevation[y * width + Math.max(0, x - 1)];
      const dy = elevation[Math.min(height - 1, y + 1) * width + x] - elevation[Math.max(0, y - 1) * width + x];
      let shade = clamp((-dx * .9 - dy * 1.1), -23, 19);
      if (value > 109 && value < 177) shade += (moisture[i] - 120) * .055;
      if (planet.kind === 'aride') rgb = [rgb[0] + 14, rgb[1] - 4, rgb[2] - 10];
      if (planet.kind === 'glacée' && value > 105) rgb = [rgb[0] + 26, rgb[1] + 31, rgb[2] + 32];
      if (planet.kind === 'volcanique' && value > 109) rgb = [rgb[0] + 8, rgb[1] - 13, rgb[2] - 14];
      for (let k = 0; k < 3; k++) image.data[i * 4 + k] = clamp(rgb[k] + shade, 0, 255);
      image.data[i * 4 + 3] = 255;
    }
    rc.putImageData(image, 0, 0);
    terrainTexture = makeCanvas(width * 3, height * 3);
    const c = terrainTexture.getContext('2d'); c.imageSmoothingEnabled = true; c.drawImage(rawCanvas, 0, 0, width * 3, height * 3);
    // Interpolated contour lines retain the topographic map at every zoom.
    const contourLevels = [...Array.from({ length: 29 }, (_, i) => 48 + i * 7), 103];
    let edgeX = 0, edgeY = 0, pairing = false;
    function contourEdge(x, y) {
      if (pairing) { c.moveTo(edgeX * 3, edgeY * 3); c.lineTo(x * 3, y * 3); }
      else { edgeX = x; edgeY = y; }
      pairing = !pairing;
    }
    for (const level of contourLevels) {
      c.beginPath(); c.strokeStyle = level === 103 ? '#ded8b991' : level < 102 ? '#7fadb329' : '#d7d4b63c';
      c.lineWidth = level === 103 ? 1 : level > 205 ? .8 : .55;
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
        dot(c, x * 3, y * 3, 1 + random() * 3.5, '#243e3327');
      }
    }
  }

  function drawSurface(cam, planet) {
    const top = project(0, 0, cam), scale = cam.zoom;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(terrainTexture, top.x, top.y, terrainTexture.width * scale, terrainTexture.height * scale);
    if (scale > .06) drawGrid(cam, true);
    const bottom = project(terrainTexture.width, terrainTexture.height, cam);
    ctx.strokeStyle = '#a9b9ad40'; ctx.lineWidth = 1; ctx.strokeRect(top.x, top.y, bottom.x - top.x, bottom.y - top.y);
    if (scale < .15) return;
    for (const res of terrainData.resources) {
      const p = project(res.x * 3, res.y * 3, cam), r = 8 + 4 * scale;
      if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) continue;
      ctx.save(); ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.35, r * .75, -.45, 0, TAU); ctx.clip();
      for (let i = -r * 2; i < r * 2; i += 4) line(ctx, [{ x: p.x + i - r, y: p.y + r }, { x: p.x + i + r, y: p.y - r }], '#e7cf8291', .7);
      ctx.restore();
      if (scale > .55) label(ctx, res.type.toUpperCase(), p.x + r + 6, p.y, '#c7c49b', 8);
    }
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
    const previousTexture = terrainTexture, previousData = terrainData;
    terrainTexture = record.texture; terrainData = record.data;
    drawSurface(localCamera(frame), planet);
    terrainTexture = previousTexture; terrainData = previousData;
    ctx.restore();
  }

  function updateSceneContext() {
    if (!galaxy) return;
    const previousLevel = state.level, previousContext = state.context;
    const known = galaxy.systems.filter(s => s.discovered || state.reveal);
    if (state.tracking) state.context = state.tracking.context;
    if (state.camera.zoom >= .7 && !state.tracking && !cameraMoving()) {
      const nearest = [...known].sort((a, b) => distance(a, state.camera) - distance(b, state.camera))[0];
      const contextDistance = state.context ? distance(state.context.star, state.camera) : Infinity;
      const extent = state.context ? state.context.model.planets.at(-1).orbit * state.context.frame.scale : 0;
      if (nearest && (!state.context || contextDistance > extent * 2 + Math.max(W, H) / state.camera.zoom * .7)) state.context = prepareSystem(nearest);
    }
    if (previousContext !== state.context) { state.focusPlanet = null; clearSelection(); }
    state.level = 'galaxy';
    if (state.context) {
      const context = state.context, frame = context.frame;
      const localZoom = state.camera.zoom * frame.scale;
      const center = project(frame.x, frame.y), visibleRadius = context.model.planets.at(-1).orbit * localZoom;
      if (localZoom >= .08 && center.x + visibleRadius >= 0 && center.x - visibleRadius <= W && center.y + visibleRadius >= 0 && center.y - visibleRadius <= H) {
        state.level = 'system'; state.system = context.model; state.visited.add(context.star.id);
        const selectedPlanet = state.selected?.kind ? state.selected : null;
        const candidates = context.model.planets.filter(p => p.kind !== 'gazeuse');
        const nearest = [...candidates].sort((a, b) => distance(planetWorldPosition(a, context), state.camera) - distance(planetWorldPosition(b, context), state.camera))[0];
        let planet = state.tracking?.planet || selectedPlanet || state.focusPlanet || nearest;
        if (planet && !context.model.planets.some(p => p.id === planet.id)) planet = nearest;
        const isVisible = p => {
          const position = planetWorldPosition(p, context), point = project(position.x, position.y), r = p.radius * localZoom;
          return point.x + r * 1.4 >= 0 && point.x - r * 1.4 <= W && point.y + r >= 0 && point.y - r <= H;
        };
        if (nearest && planet && !isVisible(planet) && isVisible(nearest)) planet = nearest;
        if (planet && planet.kind !== 'gazeuse') {
          const pp = planetWorldPosition(planet, context), point = project(pp.x, pp.y), r = planet.radius * localZoom;
          const visible = point.x + r * 1.4 >= 0 && point.x - r * 1.4 <= W && point.y + r >= 0 && point.y - r <= H;
          if (visible && r > 18) {
            state.focusPlanet = planet; prepareTerrain(planet, context);
            if (r > 45) followPlanet(planet, context);
            if (r >= 80) {
              state.level = 'surface'; state.planet = planet;
              const record = context.terrains.get(planet.id); terrainTexture = record.texture; terrainData = record.data; state.terrain = record.data;
            }
          }
        }
      }
    }
    if (state.tracking) {
      const r = state.tracking.planet.radius * state.tracking.context.frame.scale * state.camera.zoom;
      if (r < 22) state.tracking = null;
    }
    if (previousLevel !== state.level) {
      state.selected = null; state.tool = 'pan'; $('inspector').hidden = true; $('toast').classList.remove('visible'); updateUI();
    }
  }

  function drawUniverse() {
    ctx.fillStyle = '#101b28'; ctx.fillRect(0, 0, W, H);
    const cam = state.camera;
    if (state.level === 'surface' && state.planet) {
      const p = planetWorldPosition(state.planet), center = project(p.x, p.y), r = state.planet.radius * state.context.frame.scale * cam.zoom;
      if (r > Math.max(W, H) * 1.5) { drawPlanetTerrain(state.planet, state.context, center, r); return; }
    }
    drawGalaxy(cam);
    if (cam.zoom < .7) return;
    if (state.context && state.level === 'system') drawGrid(localCamera(state.context.frame), false, true);
    const visibleStars = galaxy.systems.filter(s => s.discovered || state.reveal)
      .filter(s => { const p = project(s.x, s.y); const padding = 18 * cam.zoom; return p.x > -padding && p.x < W + padding && p.y > -padding && p.y < H + padding; })
      .sort((a, b) => distance(a, cam) - distance(b, cam)).slice(0, 12);
    if (state.context && !visibleStars.some(s => s.id === state.context.star.id)) visibleStars.push(state.context.star);
    for (const star of visibleStars) {
      const context = prepareSystem(star), local = localCamera(context.frame);
      if (local.zoom < .025) continue;
      drawSystem(local, context.model, context);
    }
  }

  function clearSelection() { state.selected = null; state.tool = 'pan'; $('inspector').hidden = true; $('toast').classList.remove('visible'); }
  function enterSystem() {
    if (state.level !== 'galaxy') return;
    const star = state.selected || home;
    if (!star.discovered && !state.reveal) return;
    state.context = prepareSystem(star); state.system = state.context.model;
    state.tracking = null; state.focusPlanet = null; clearSelection();
    const camera = worldCamera(state.context.frame, { x: 115, y: 120, zoom: Math.max(.1, Math.min((W - 50) / 1900, (H - 210) / 2100)) });
    focusCamera(camera.x, camera.y, camera.zoom); persist();
  }
  function enterPlanet() {
    if (state.level !== 'system') return;
    const planet = state.selected?.kind ? state.selected : state.system.planets.find(p => p.kind !== 'gazeuse');
    if (!planet || planet.kind === 'gazeuse') { toast('Cette géante gazeuse ne possède pas de surface solide.'); return; }
    const record = prepareTerrain(planet); state.focusPlanet = planet; state.planet = planet; followPlanet(planet);
    clearSelection();
    const f = surfaceFrame(planet), camera = worldCamera(f, { x: record.texture.width / 2, y: record.texture.height / 2, zoom: Math.max(W / record.texture.width, H / record.texture.height) * 1.08 });
    focusCamera(camera.x, camera.y, camera.zoom);
  }
  function back() {
    clearSelection(); state.tracking = null;
    if (state.level === 'surface') {
      state.focusPlanet = null;
      const camera = worldCamera(state.context.frame, { x: 115, y: 120, zoom: Math.max(.1, Math.min((W - 50) / 1900, (H - 210) / 2100)) });
      focusCamera(camera.x, camera.y, camera.zoom);
    } else if (state.level === 'system') {
      const star = state.context.star; state.focusPlanet = null;
      focusCamera(star.x - 200, star.y - 160, Math.max(.09, fitZoom(1900)));
    } else overview();
  }
  function overview() {
    clearSelection(); state.tracking = null;
    if (state.level === 'galaxy') focusCamera(0, 0, fitZoom(11200));
    else if (state.level === 'system') {
      const camera = worldCamera(state.context.frame, { x: 0, y: 0, zoom: fitZoom(state.system.planets.at(-1).orbit * 2.35) });
      focusCamera(camera.x, camera.y, camera.zoom);
    } else {
      followPlanet(state.planet);
      const frame = surfaceFrame(), camera = worldCamera(frame, { x: terrainTexture.width / 2, y: terrainTexture.height / 2,
        zoom: Math.min((W - 30) / terrainTexture.width, (H - 200) / terrainTexture.height) });
      focusCamera(camera.x, camera.y, camera.zoom);
    }
  }
  function focusHome() {
    if (state.level === 'galaxy') { state.context = prepareSystem(home); state.tracking = null; select(home); resetCamera(); }
    else if (state.level === 'system') { state.tracking = null; state.focusPlanet = null; resetCamera(); }
    else { followPlanet(state.planet); resetCamera(); }
  }

  function select(item) {
    state.selected = item; const panel = $('inspector'); panel.hidden = false;
    $('toast').classList.remove('visible');
    if (state.level === 'galaxy') {
      const count = prepareSystem(item).model.planets.length;
      $('selection-type').textContent = 'SYSTÈME STELLAIRE'; $('selection-name').textContent = item.name;
      $('selection-info').textContent = `Étoile de classe ${item.stellarClass}. ${count} mondes en orbite attendent leur premier relevé.`;
      $('selection-meta').textContent = `X ${Math.round(item.x)} · Y ${Math.round(item.y)}   /   ${state.visited.has(item.id) ? 'VISITÉ' : 'DÉTECTÉ'}`;
      $('enter-label').textContent = 'Zoomer sur le système'; $('enter-button').hidden = false; $('enter-button').disabled = false;
    } else if (state.level === 'system') {
      state.focusPlanet = item;
      $('selection-type').textContent = 'CORPS PLANÉTAIRE'; $('selection-name').textContent = item.name;
      $('selection-info').textContent = item.kind === 'gazeuse' ? 'Géante gazeuse. Une atmosphère profonde, sans surface solide.' : 'Un monde ' + item.kind + '. Son relief et ses ressources peuvent être cartographiés.';
      $('selection-meta').textContent = `${(item.orbit / 220).toFixed(2)} UA   /   PÉRIODE ${Math.round(TAU / item.speed)} s`;
      $('enter-label').textContent = item.kind === 'gazeuse' ? 'Aucune surface solide' : 'Zoomer sur la surface';
      $('enter-button').hidden = false; $('enter-button').disabled = item.kind === 'gazeuse';
    } else {
      $('selection-type').textContent = 'RELEVÉ DE TERRAIN'; $('selection-name').textContent = item.name;
      $('selection-info').textContent = item.info;
      $('selection-meta').textContent = `X ${Math.round(item.x)} km · Y ${Math.round(item.y)} km   /   ALT. ${item.altitude} m`;
      $('enter-button').hidden = true;
    }
    updateUI();
  }
  function scanAt(point) {
    const from = state.selected && !state.selected.surfacePoint ? state.selected : home;
    const mission = { x: point.x, y: point.y, from: { x: from.x, y: from.y }, radius: 680, start: performance.now(), duration: 1900 };
    state.missions.push(mission); toast('Sonde en route. Relevé du secteur en cours.');
    state.tool = 'pan'; updateUI();
  }
  function completeMissions(now) {
    state.missions = state.missions.filter(mission => {
      if (now - mission.start < mission.duration) return true;
      let count = 0; state.scans.push({ x: mission.x, y: mission.y, radius: mission.radius });
      for (const s of galaxy.systems) if (!s.discovered && distance(s, mission) < mission.radius * .84) { s.discovered = true; count++; }
      toast(count ? `${count} systèmes détectés. Secteur cartographié.` : 'Secteur cartographié. Aucun nouveau système détecté.');
      persist(); updateUI(); return false;
    });
  }
  function updateUI() {
    const known = galaxy.systems.filter(s => s.discovered || state.reveal).length;
    const level = state.level;
    document.body.dataset.level = level;
    $('stat-label').textContent = level === 'galaxy' ? 'SYSTÈMES' : level === 'system' ? 'PLANÈTES' : 'SURFACE';
    $('stat-value').textContent = level === 'galaxy' ? `${fmt(known)} / ${fmt(galaxy.systems.length)}` : level === 'system' ? String(state.system.planets.length).padStart(2, '0') : `${terrainData.width * 3} × ${terrainData.height * 3} km`;
    $('secondary-label').textContent = level === 'galaxy' ? 'SECTEUR CONNU' : level === 'system' ? 'ÉTOILE' : 'TYPE';
    $('secondary-value').textContent = level === 'galaxy' ? (known / galaxy.systems.length * 100).toFixed(1) + ' %' : level === 'system' ? 'CLASSE ' + state.system.star.type : state.planet.kind.toUpperCase();
    $('view-subtitle').textContent = level === 'galaxy' ? 'RECONNAISSANCE / BRAS 01' : level === 'system' ? 'NAVIGATION ORBITALE' : 'RELEVÉ TOPOGRAPHIQUE';
    $('view-title').textContent = level === 'galaxy' ? 'Secteur Néréide' : level === 'system' ? state.system.name : state.planet.name;
    $('system-crumb-wrap').hidden = level === 'galaxy'; $('surface-crumb-wrap').hidden = level !== 'surface';
    $('breadcrumb-system').textContent = state.system?.name.toUpperCase() || '';
    $('breadcrumb-surface').textContent = state.planet?.name.replace(state.system?.name || '', '').trim() || '';
    $('scan-button').disabled = level !== 'galaxy'; $('back-button').disabled = level === 'galaxy';
    $('pan-button').classList.toggle('active', state.tool === 'pan'); $('scan-button').classList.toggle('active', state.tool === 'scan');
    $('live-status').textContent = state.paused ? 'ORBITE EN PAUSE' : level === 'galaxy' ? 'RECONNAISSANCE ACTIVE' : level === 'system' ? 'ÉPHÉMÉRIDES EN DIRECT' : 'TOPOGRAPHIE LOCALE';
    $('gesture-hint').textContent = state.tool === 'scan' ? 'Touchez la zone à sonder' : level === 'galaxy' ? 'Glisser · Toucher une étoile · Pincer pour zoomer' : level === 'system' ? 'Glisser · Toucher une planète · Pincer pour zoomer' : 'Glisser · Pincer · Toucher le terrain pour l’inspecter';
    const units = level === 'galaxy' ? ' a.l.' : level === 'system' ? ' UA' : ' km';
    const camera = level === 'galaxy' ? state.camera : localCamera(level === 'system' ? state.context.frame : surfaceFrame());
    const span = (W < 600 ? 50 : 96) / camera.zoom;
    $('scale-text').textContent = (level === 'system' ? (span / 220).toFixed(2) : fmt(Math.max(1, Math.round(span)))) + units;
  }

  function clickMap(x, y, doubleClick = false) {
    if ($('menu-dialog').open) return;
    const point = unproject(x, y);
    if (state.level === 'galaxy') {
      if (state.tool === 'scan') { scanAt(point); return; }
      const candidates = galaxy.systems.filter(s => s.discovered || state.reveal);
      let best = null, bestDistance = 18;
      for (const s of candidates) { const p = project(s.x, s.y), d = Math.hypot(p.x - x, p.y - y); if (d < bestDistance) { best = s; bestDistance = d; } }
      if (best) { select(best); if (doubleClick) enterSystem(); }
      else { $('inspector').hidden = true; state.selected = null; }
    } else if (state.level === 'system') {
      let best = null, bestDistance = 24;
      for (const p of state.system.planets) { const pos = planetWorldPosition(p), pp = project(pos.x, pos.y), d = Math.hypot(pp.x - x, pp.y - y); if (d < bestDistance) { best = p; bestDistance = d; } }
      if (best) { select(best); if (doubleClick) enterPlanet(); } else { $('inspector').hidden = true; state.selected = null; }
    } else {
      const frame = surfaceFrame(), terrainPoint = { x: (point.x - frame.x) / frame.scale, y: (point.y - frame.y) / frame.scale };
      const tx = Math.floor(terrainPoint.x / 3), ty = Math.floor(terrainPoint.y / 3);
      if (tx < 0 || ty < 0 || tx >= terrainData.width || ty >= terrainData.height) return;
      const height = terrainData.elevation[ty * terrainData.width + tx], altitude = Math.round((height - terrainData.seaLevel) * 35);
      const names = height < 100 ? 'Zone océanique' : height < 109 ? 'Littoral' : height < 143 ? 'Plaine continentale' : height < 183 ? 'Plateau rocheux' : 'Massif montagneux';
      const nearest = terrainData.resources.find(r => Math.hypot(r.x - tx, r.y - ty) < 10);
      select({ surfacePoint: true, x: terrainPoint.x, y: terrainPoint.y, altitude, name: names,
        info: nearest ? `Gisement détecté : ${nearest.type}. Les courbes de niveau indiquent la pente du terrain.` : 'Le relief, les côtes et les ressources composent une surface générée pour ce monde.' });
    }
  }
  function zoomAt(factor, x = W / 2, y = H / 2) {
    const before = unproject(x, y), [min, max] = zoomLimits(before);
    const z = clamp(state.camera.zoom * factor, min, max);
    state.target = { x: before.x - (x - W / 2) / z, y: before.y - (y - H / 2) / z, zoom: z };
    state.camera = { ...state.target };
    updateSceneContext(); updateUI();
  }
  let lastTap = { t: 0, x: 0, y: 0 };
  canvas.addEventListener('pointerdown', e => {
    if ($('menu-dialog').open) return;
    canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pointersLast.set(e.pointerId, { x: e.clientX, y: e.clientY }); pointerMoved = false;
    if (pointers.size === 2) {
      const ps = [...pointers.values()]; pinch = { distance: distance(ps[0], ps[1]), midpoint: { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 } }; pointerMoved = true;
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const last = pointers.get(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2 && pinch) {
      const ps = [...pointers.values()], d = distance(ps[0], ps[1]), mid = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
      const before = unproject(pinch.midpoint.x, pinch.midpoint.y), [min, max] = zoomLimits(before);
      const z = clamp(state.camera.zoom * d / Math.max(1, pinch.distance), min, max);
      state.target = { x: before.x - (mid.x - W / 2) / z, y: before.y - (mid.y - H / 2) / z, zoom: z };
      state.camera = { ...state.target }; pinch = { distance: d, midpoint: mid }; pointerMoved = true;
      updateSceneContext(); updateUI();
    } else {
      const start = pointersLast.get(e.pointerId);
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) pointerMoved = true;
      if (pointerMoved) {
        state.target = { ...state.camera, x: state.camera.x - (e.clientX - last.x) / state.camera.zoom, y: state.camera.y - (e.clientY - last.y) / state.camera.zoom };
        state.camera = { ...state.target }; updateSceneContext();
      }
    }
  });
  function release(e, cancelled = false) {
    if (!pointers.has(e.pointerId)) return;
    const wasPinch = pinch !== null; pointers.delete(e.pointerId); pointersLast.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!cancelled && !pointerMoved && !wasPinch) {
      const now = performance.now(), double = now - lastTap.t < 340 && Math.hypot(lastTap.x - e.clientX, lastTap.y - e.clientY) < 24;
      clickMap(e.clientX, e.clientY, double); lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    if (wasPinch) pointerMoved = true;
  }
  canvas.addEventListener('pointerup', e => release(e)); canvas.addEventListener('pointercancel', e => release(e, true));
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  $('zoom-in').onclick = () => zoomAt(1.55); $('zoom-out').onclick = () => zoomAt(1 / 1.55);
  $('back-button').onclick = back; $('overview-button').onclick = overview; $('home-button').onclick = focusHome;
  $('pan-button').onclick = () => { state.tool = 'pan'; updateUI(); };
  $('scan-button').onclick = () => { state.tool = state.tool === 'scan' ? 'pan' : 'scan'; $('inspector').hidden = true; updateUI(); if (state.tool === 'scan') toast('Touchez la carte pour envoyer une sonde.'); };
  $('close-inspector').onclick = () => { state.selected = null; $('inspector').hidden = true; };
  $('enter-button').onclick = () => state.level === 'galaxy' ? enterSystem() : enterPlanet();
  $('breadcrumb-galaxy').onclick = () => {
    if (state.level === 'galaxy') { overview(); return; }
    const star = state.context.star; state.tracking = null; state.focusPlanet = null; clearSelection();
    focusCamera(star.x - 200, star.y - 160, Math.max(.09, fitZoom(1900)));
  };
  $('breadcrumb-system').onclick = () => { if (state.level === 'surface') back(); };
  $('menu-button').onclick = () => { $('continue-button').firstElementChild.textContent = 'Reprendre l’exploration'; $('menu-dialog').showModal(); };
  $('continue-button').onclick = () => { $('menu-dialog').close(); if (!menuStarted) { menuStarted = true; toast('Zoomez sur Néréide pour explorer son système.'); } };
  $('generate-button').onclick = () => { regenerate($('seed-input').value); $('continue-button').firstElementChild.textContent = 'Explorer cet univers'; };
  $('seed-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('generate-button').click(); });
  $('reveal-toggle').onchange = e => { state.reveal = e.target.checked; updateUI(); };
  function setPause(value) {
    state.paused = value; $('motion-toggle').checked = !value;
    $('pause-button').innerHTML = value ? '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>';
    $('pause-button').setAttribute('aria-label', value ? 'Animer les orbites' : 'Mettre les orbites en pause'); updateUI();
  }
  $('pause-button').onclick = () => setPause(!state.paused); $('motion-toggle').onchange = e => setPause(!e.target.checked);
  document.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') { if ($('menu-dialog').open) $('menu-dialog').close(); else if (!$('inspector').hidden) { $('inspector').hidden = true; state.selected = null; } else back(); }
    if (e.key === '+' || e.key === '=') zoomAt(1.4);
    if (e.key === '-') zoomAt(1 / 1.4);
    if (e.key === ' ' && !$('menu-dialog').open) { e.preventDefault(); setPause(!state.paused); }
    if (e.key === 'Enter' && state.selected && !$('menu-dialog').open) $('enter-button').click();
    if (!$('menu-dialog').open && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault(); const step = 70 / state.target.zoom;
      state.target.x += e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      state.target.y += e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    }
  });
  function resize() {
    W = innerWidth; H = innerHeight; DPR = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (galaxy) updateUI();
  }
  addEventListener('resize', resize); document.addEventListener('visibilitychange', () => { persist(); lastTime = 0; });

  function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, .05) : 0; lastTime = now;
    if (!state.paused && !document.hidden) state.time += dt;
    if (state.tracking) {
      const follow = state.tracking, position = planetWorldPosition(follow.planet, follow.context);
      const dx = position.x - follow.position.x, dy = position.y - follow.position.y;
      state.camera.x += dx; state.camera.y += dy; state.target.x += dx; state.target.y += dy;
      follow.position = position;
    }
    completeMissions(now);
    const factor = 1 - Math.exp(-dt * 9), oldZoom = state.camera.zoom;
    const zoom = Math.exp(lerp(Math.log(oldZoom), Math.log(state.target.zoom), factor));
    // Recadrage buttons move the same camera. Manual gestures apply immediately.
    state.camera.x = state.target.x - (state.target.x - state.camera.x) * oldZoom / zoom * (1 - factor);
    state.camera.y = state.target.y - (state.target.y - state.camera.y) * oldZoom / zoom * (1 - factor);
    state.camera.zoom = zoom;
    if (Math.abs(Math.log(state.target.zoom / zoom)) < .0005 && distance(state.target, state.camera) * zoom < .2) state.camera = { ...state.target };
    updateSceneContext(); drawUniverse();
    if (now - lastHUD > 350) { updateUI(); lastHUD = now; }
    requestAnimationFrame(frame);
  }

  // A small inspection API supports browser checks without bypassing production paths.
  globalThis.OrbitalDebug = Object.freeze({
    getState: () => ({ level: state.level, seed: state.seed, selectedId: state.selected?.id || null,
      systemCount: galaxy.systems.length, discoveredCount: galaxy.systems.filter(s => s.discovered || state.reveal).length,
      planetCount: state.system?.planets.length || 0, zoom: state.camera.zoom, time: state.time,
      homeId: home.id, transitioning: false, moving: cameraMoving(), tool: state.tool,
      planetKind: state.planet?.kind || null, missions: state.missions.length }),
    focusHome, enterSystem, enterPlanet, back, regenerate, zoomAt,
    getCamera: () => ({ ...state.camera }),
    getHomeScreenPosition: () => project(home.x, home.y),
    getPlanetScreenPositions: () => (state.system?.planets || []).map(p => { const pos = planetWorldPosition(p); return { ...project(pos.x, pos.y), id: p.id, kind: p.kind }; }),
    scanAt, setPause
  });
  resize(); const previous = stored(); regenerate(previous?.seed ?? 'NEREIDE-01', previous);
  $('menu-dialog').showModal(); requestAnimationFrame(frame);
})();
