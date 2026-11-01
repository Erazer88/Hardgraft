#!/usr/bin/env node
'use strict';

// Planet view benchmark (development tool, not part of `npm test`): builds a
// dense base around a colony (extractors at work, wind turbines, factories,
// antennas, datacenters, depots, finished roads to the colony), measures the
// frame times for a few seconds and prints the JavaScript hot spots of a CPU
// profile. It serves the repository itself and drives Chromium through
// Playwright, which it needs installed (it is not a dependency of the game).
//
//   node tools/planet-bench.cjs [buildings=120] [wheelSteps=0]
//   PAN=3 …        pans the view by about 3 px a frame while measuring
//   ZOOMRATE=.012  zooms in and out continuously while measuring
//   DPR=3          device pixel ratio (default 2), on a 390 × 844 screen
//   SECONDS=6      measuring time
//
// Headless Chromium paints the canvas in software: absolute numbers are lower
// than on a phone's GPU, but the comparisons between versions hold.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COUNT = Number(process.argv[2] || 120), WHEEL = Number(process.argv[3] || 0);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve() {
  const server = http.createServer((request, response) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(request.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (_) {
    console.error('Playwright est requis pour ce banc (npm i -g playwright, ou un environnement qui le fournit).');
    process.exit(1);
  }
  const server = await serve(), url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DPR || 2) });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('nereide-atlas-dev-settings-v1', JSON.stringify({ unlockEverything: true }));
    // The game state, through a production path that receives it each frame.
    let transit;
    Object.defineProperty(globalThis, 'OrbitDataTransit', { configurable: true, get: () => transit, set: value => {
      transit = Object.freeze({ ...value, advance(state, ...rest) { globalThis.__benchState = state; return value.advance(state, ...rest); } });
    } });
  });
  await page.goto(url); await page.waitForTimeout(2000);
  if (await page.evaluate(() => document.querySelector('#menu-dialog').open)) await page.click('#continue-button');
  await page.evaluate(() => OrbitalDebug.focusHome()); await page.waitForTimeout(1200);
  await page.evaluate(() => OrbitalDebug.enterSystem()); await page.waitForTimeout(2000);
  await page.evaluate(() => OrbitalDebug.enterPlanet()); await page.waitForTimeout(2500);
  const built = await page.evaluate(count => {
    const s = globalThis.__benchState, Building = OrbitSurfaceBuilding, Graph = OrbitProcessGraph, Road = OrbitRoadNetwork;
    const planetId = s.planet.id, cx = 1000, cy = 430;
    const add = properties => { const building = Building.create({ planetId, constructionState: 'complete', ...properties }); s.surfaceBuildings.push(building); return building; };
    const colony = add({ id: 'bench-colony', type: 'colony', x: cx, y: cy, customName: 'Colonie 1' });
    colony.colony = { population: 1600 };
    const network = s.roadNetworks[planetId] ||= Road.create(planetId);
    const hub = Road.addNode(network, { x: cx, y: cy, buildingId: colony.id });
    const types = ['extractor', 'extractor', 'wind_turbine', 'factory', 'extractor', 'antenna', 'storage', 'wind_turbine', 'water_station', 'datacenter', 'hf_antenna', 'extractor'];
    const counts = {};
    for (let i = 0; i < count; i++) {
      const type = types[i % types.length]; counts[type] = (counts[type] || 0) + 1;
      const ring = Math.floor(i / 16) + 1, angle = (i % 16) / 16 * Math.PI * 2 + ring * .3;
      const x = cx + Math.cos(angle) * ring * 34, y = cy + Math.sin(angle) * ring * 22;
      const building = add({ id: `bench-${i}`, type, x, y, customName: `${type} ${counts[type]}`,
        composition: { iron: .2, copper: .05, rock: .75 }, resourceId: type === 'water_station' ? 'water' : undefined,
        dockDestinations: type === 'extractor' ? { crushed_rock: colony.id } : {} });
      const node = Road.addNode(network, { x, y, buildingId: building.id });
      Road.addSegment(network, { from: node.id, to: hub.id, points: [{ x, y }, { x: (x + cx) / 2 + 6, y: (y + cy) / 2 - 4 }, { x: cx, y: cy }], builtLength: 1e9 });
      if (type === 'extractor') {
        const graph = OrbitIndustry.ensureGraph(s, building);
        Graph.addMachine(graph, { id: 'd', type: 'drill', x: 0, y: 0 });
        Graph.addMachine(graph, { id: 'c', type: 'crusher', x: 300, y: 0 });
        Graph.addMachine(graph, { id: 'o', type: 'output_dock', x: 600, y: 0 });
        Graph.connect(graph, { id: 'l1', fromMachineId: 'd', fromOutputId: 'rock', toMachineId: 'c', toInputId: 'rock' });
        Graph.connect(graph, { id: 'l2', fromMachineId: 'c', fromOutputId: 'rock', toMachineId: 'o', toInputId: 'material' });
      }
    }
    for (const segment of network.segments) segment.builtLength = segment.length;
    return { buildings: s.surfaceBuildings.length, roads: network.segments.length };
  }, COUNT);
  await page.waitForTimeout(3000);
  const colony = await page.evaluate(() => OrbitalDebug.getBuildingScreenPosition('bench-colony'));
  for (let step = 0; step < WHEEL; step++) { await page.mouse.move(colony.x, colony.y); await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
  await page.waitForTimeout(1500);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const times = await page.evaluate(([seconds, pan, zoomRate]) => new Promise(resolve => {
    const frames = []; let last = performance.now(), k = 0; const end = last + seconds * 1000;
    function tick(now) {
      frames.push(now - last); last = now; k++;
      const s = globalThis.__benchState;
      if (zoomRate) s.camera = { ...s.camera, zoom: s.camera.zoom * Math.exp(Math.sin(k / 30) * zoomRate) };
      if (pan) s.camera = { ...s.camera, x: s.camera.x + Math.sin(k / 40) * pan / s.camera.zoom };
      if (zoomRate || pan) s.target = { ...s.camera };
      if (now < end) requestAnimationFrame(tick); else resolve(frames);
    }
    requestAnimationFrame(tick);
  }), [Number(process.env.SECONDS || 6), Number(process.env.PAN || 0), Number(process.env.ZOOMRATE || 0)]);
  const { profile } = await cdp.send('Profiler.stop');

  times.shift(); times.sort((a, b) => a - b);
  const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
  const nodes = new Map(profile.nodes.map(node => [node.id, node])), self = new Map();
  const total = profile.timeDeltas.reduce((sum, delta) => sum + delta, 0);
  profile.samples.forEach((id, index) => {
    const frame = nodes.get(id).callFrame;
    const key = `${frame.functionName || '(anonyme)'} ${frame.url.split('/').pop()}:${frame.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + profile.timeDeltas[index]);
  });
  console.log(JSON.stringify({ built, frames: times.length, meanMs: +mean.toFixed(2), fps: +(1000 / mean).toFixed(1),
    p50: +times[Math.floor(times.length * .5)].toFixed(1), p95: +times[Math.floor(times.length * .95)].toFixed(1), errors }));
  for (const [key, time] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`${(time / total * 100).toFixed(1).padStart(5)} %  ${key}`);
  await browser.close(); server.close();
})();
