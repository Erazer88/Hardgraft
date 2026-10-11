#!/usr/bin/env node
'use strict';

// Real-browser smoke checks using Chromium and Node's built-in WebSocket.
// Start the app first, then run: node tests/browser-smoke.cjs
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, mkdir, rm, stat, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const BASE_URL = process.env.ORBITAL_BASE_URL || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROMIUM_BIN || '/usr/bin/chromium';
const ARTIFACTS = path.resolve(__dirname, '../artifacts');
const ARTIFACT_PREFIX = process.env.ORBITAL_ARTIFACT_PREFIX || '';
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        clearTimeout(entry.timeout);
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
        else entry.resolve(message.result);
      } else {
        for (const callback of this.listeners.get(message.method) || []) callback(message.params);
      }
    });
    socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timeout);
        entry.reject(new Error(`CDP disconnected during ${entry.method}`));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP connection timed out')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP connection failed')); }, { once: true });
    });
    return new CDP(socket);
  }

  on(method, callback) {
    const callbacks = this.listeners.get(method) || [];
    callbacks.push(callback);
    this.listeners.set(method, callbacks);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timeout, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async until(expression, description, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) return;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${description}`);
  }

  async click(selector) {
    const point = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Missing element: ' + ${JSON.stringify(selector)});
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) throw new Error('Invisible element: ' + ${JSON.stringify(selector)});
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    })()`);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    await sleep(120);
  }

  async tapAt(point, mobile) {
    if (mobile) {
      await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
      await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    }
    await sleep(150);
  }

  async screenshot(filename) {
    await this.until('!document.querySelector("#toast")?.classList.contains("visible")', 'notification fades before screenshot', 6000);
    // Let the animation loop draw two complete frames after a state transition.
    await this.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(ARTIFACTS, ARTIFACT_PREFIX + filename), Buffer.from(data, 'base64'));
  }
}

async function launchChrome(profile) {
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Chromium startup timed out. ${log.slice(-1500)}`));
    }, 15000);
    child.stderr.on('data', (chunk) => {
      log += chunk.toString();
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chromium exited (${code}) before readiness. ${log.slice(-1500)}`));
    });
  });
  return { child, url };
}

const stateExpression = 'window.OrbitalDebug.getState()';
const cameraExpression = 'window.OrbitalDebug.getCamera()';
const settledExpression = '!window.OrbitalDebug.getState().moving';
const menuVisibleExpression = `(() => {
  const menu = document.querySelector('#menu-dialog');
  if (!menu) return false;
  const style = getComputedStyle(menu);
  return menu.getBoundingClientRect().width > 0 && style.display !== 'none' && style.visibility !== 'hidden';
})()`;

async function checkLayout(cdp, width, height) {
  const layout = await cdp.evaluate(`(() => {
    const canvas = document.querySelector('#universe');
    const box = canvas?.getBoundingClientRect();
    return {
      viewport: [innerWidth, innerHeight],
      overflow: document.documentElement.scrollWidth - innerWidth,
      canvas: box ? [box.width, box.height] : null,
      canvasPixels: canvas ? [canvas.width, canvas.height] : null,
    };
  })()`);
  assert.deepEqual(layout.viewport, [width, height], 'Viewport dimensions');
  assert.ok(layout.overflow <= 1, `Horizontal overflow: ${layout.overflow}px`);
  assert.ok(layout.canvas?.[0] > width * 0.8 && layout.canvas?.[1] > height * 0.65, 'Universe canvas is visible');
  assert.ok(layout.canvasPixels?.[0] > 0 && layout.canvasPixels?.[1] > 0, 'Canvas has drawable pixels');
}

async function settle(cdp, description) {
  await cdp.until(settledExpression, description);
  await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}

async function zoomStep(cdp, factor, focal, gesture = 'direct') {
  const before = await cdp.evaluate(cameraExpression);
  const viewport = await cdp.evaluate('({ width: innerWidth, height: innerHeight })');
  // A single galactic coordinate must project to the same pixel through every
  // detail threshold; a view-specific recenter would violate this invariant.
  const fixedWorld = {
    x: before.x + (focal.x - viewport.width / 2) / before.zoom,
    y: before.y + (focal.y - viewport.height / 2) / before.zoom,
  };
  if (gesture === 'wheel') {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: focal.x, y: focal.y, deltaX: 0,
      deltaY: -Math.log(factor) / .0015,
    });
  } else if (gesture === 'pinch') {
    const touches = spread => [
      { x: focal.x - spread, y: focal.y, id: 1 },
      { x: focal.x + spread, y: focal.y, id: 2 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(24) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(24 * factor) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp.evaluate(`window.OrbitalDebug.zoomAt(${factor}, ${focal.x}, ${focal.y})`);
  }
  await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const after = await cdp.evaluate(cameraExpression);
  const state = await cdp.evaluate(stateExpression);
  assert.ok(Math.abs(after.zoom / before.zoom - factor) < 1e-6,
    `${gesture} zoom preserves factor ${factor}: ${after.zoom / before.zoom}`);
  const projected = {
    x: viewport.width / 2 + (fixedWorld.x - after.x) * after.zoom,
    y: viewport.height / 2 + (fixedWorld.y - after.y) * after.zoom,
  };
  assert.ok(Math.hypot(projected.x - focal.x, projected.y - focal.y) < .5,
    `${gesture} keeps its focal point fixed through ${state.level} (${Math.hypot(projected.x - focal.x, projected.y - focal.y)}px)`);
  assert.equal(Boolean(state.moving), false, 'Gesture zoom never starts automatic camera movement');
  assert.equal(Boolean(state.transitioning), false, 'Gesture zoom never starts a scene transition');
  return state;
}

async function checkBoundary(cdp, name, mobile, from, to, focal) {
  const original = await cdp.evaluate(cameraExpression);
  assert.equal((await cdp.evaluate(stateExpression)).level, from, `${name} begins boundary test in ${from}`);
  let crossed = false;
  // Locate the threshold using powers of two, then approach it in 3% steps.
  // This avoids a slow traversal of the entire galactic-to-terrain scale.
  for (let i = 0; i < 30; i++) {
    const state = await zoomStep(cdp, 2, focal);
    if (state.level === to) { crossed = true; break; }
    assert.equal(state.level, from, `${name} does not skip ${to}`);
  }
  assert.ok(crossed, `${name} continuous zoom reaches ${to}`);
  await zoomStep(cdp, .5, focal);
  assert.equal((await cdp.evaluate(stateExpression)).level, from, `${name} returns just before ${to} threshold`);
  crossed = false;
  for (let i = 0; i < 25; i++) {
    const state = await zoomStep(cdp, 1.03, focal);
    if (state.level === to) { crossed = true; break; }
    assert.equal(state.level, from, `${name} fine zoom stays in ${from} before its threshold`);
  }
  assert.ok(crossed, `${name} a 3% step crosses ${from} → ${to}`);
  await cdp.screenshot(`${name}-${from}-to-${to}-boundary.png`);
  await zoomStep(cdp, 1 / 1.03, focal);
  assert.equal((await cdp.evaluate(stateExpression)).level, from, `${name} reverse 3% step returns to ${from}`);
  const gesture = mobile ? 'pinch' : 'wheel';
  assert.equal((await zoomStep(cdp, 1.03, focal, gesture)).level, to,
    `${name} real ${gesture} crosses ${from} → ${to} continuously`);
  assert.equal((await zoomStep(cdp, 1 / 1.03, focal, gesture)).level, from,
    `${name} real ${gesture} returns through the same threshold`);
  const current = await cdp.evaluate(cameraExpression);
  await zoomStep(cdp, original.zoom / current.zoom, focal);
  const returned = await cdp.evaluate(cameraExpression);
  assert.equal((await cdp.evaluate(stateExpression)).level, from, `${name} zoom round trip restores ${from}`);
  assert.ok(Math.abs(returned.zoom / original.zoom - 1) < 1e-6, `${name} round trip restores magnification`);
  assert.ok(Math.hypot(returned.x - original.x, returned.y - original.y) * original.zoom < .5,
    `${name} round trip restores the same position`);
  process.stdout.write(`PASS ${name}: ${from} ↔ ${to}, 3% ${gesture} threshold, fixed focal point, exact camera round trip\n`);
}

async function checkTerrainZoomLimit(cdp, name) {
  const measurement = await cdp.evaluate(`(() => {
    const debug = window.OrbitalDebug;
    const focal = { x: innerWidth * .61, y: innerHeight * .48 };
    const before = debug.getCamera();
    const fixedWorld = { x: before.x + (focal.x-innerWidth/2)/before.zoom,
      y: before.y + (focal.y-innerHeight/2)/before.zoom };
    debug.zoomAt(999, focal.x, focal.y);
    const capped = debug.getCamera();
    debug.zoomAt(2, focal.x, focal.y);
    const repeated = debug.getCamera();
    const projected = { x: innerWidth/2 + (fixedWorld.x-repeated.x)*repeated.zoom,
      y: innerHeight/2 + (fixedWorld.y-repeated.y)*repeated.zoom };
    const level = debug.getState().level;
    debug.zoomAt(before.zoom/repeated.zoom, focal.x, focal.y);
    return { before, capped, repeated, focal, projected, level, returned: debug.getCamera() };
  })()`);
  assert.equal(measurement.level, 'surface', `${name} terrain zoom limit preserves surface context`);
  assert.ok(measurement.capped.zoom > measurement.before.zoom, `${name} terrain can zoom farther before its limit`);
  assert.ok(measurement.capped.zoom < measurement.before.zoom * 999, `${name} terrain has a useful detail limit`);
  assert.deepEqual(measurement.repeated, measurement.capped, `${name} another zoom at the limit leaves the camera fixed`);
  assert.ok(Math.hypot(measurement.projected.x-measurement.focal.x,
    measurement.projected.y-measurement.focal.y) < .5, `${name} terrain zoom limit preserves the focal point`);
  assert.ok(Math.abs(measurement.returned.zoom/measurement.before.zoom-1) < 1e-6,
    `${name} zooming back from the limit restores magnification`);
  assert.ok(Math.hypot(measurement.returned.x-measurement.before.x,
    measurement.returned.y-measurement.before.y)*measurement.before.zoom < .5,
    `${name} zooming back from the limit restores position`);
  process.stdout.write(`PASS ${name}: terrain detail limit, fixed focal point, reversible camera\n`);
}

async function checkContinuousZoom(cdp, name, mobile) {
  await cdp.evaluate('window.OrbitalDebug.focusHome()');
  await settle(cdp, `${name} home camera settles before continuous zoom`);
  await cdp.evaluate('window.OrbitalDebug.setPause(true)');
  const homePoint = await cdp.evaluate('window.OrbitalDebug.getHomeScreenPosition()');
  await checkBoundary(cdp, name, mobile, 'galaxy', 'system', homePoint);
  await cdp.evaluate('window.OrbitalDebug.enterSystem()');
  await settle(cdp, `${name} system camera settles before continuous zoom`);
  const gas = await cdp.evaluate(`window.OrbitalDebug.getPlanetScreenPositions().find(p => p.kind === 'gazeuse' && p.x > 40 && p.x < innerWidth - 40 && p.y > 210 && p.y < innerHeight - 150)`);
  assert.ok(gas, `${name} gas planet visible for surface guard test`);
  const beforeGas = await cdp.evaluate(cameraExpression);
  await cdp.tapAt({ x: gas.x, y: gas.y }, mobile);
  assert.equal((await cdp.evaluate(stateExpression)).selectedId, gas.id, `${name} gas planet can be selected`);
  await cdp.evaluate('window.OrbitalDebug.enterPlanet()');
  assert.equal((await cdp.evaluate(stateExpression)).level, 'system', `${name} gas planet has no enterable terrain surface`);
  assert.deepEqual(await cdp.evaluate(cameraExpression), beforeGas, `${name} gas surface request leaves camera fixed`);
  await cdp.click('#close-inspector');
  const planet = await cdp.evaluate(`window.OrbitalDebug.getPlanetScreenPositions().find(p => p.kind !== 'gazeuse' && p.x > 40 && p.x < innerWidth - 40 && p.y > 210 && p.y < innerHeight - 150)`);
  assert.ok(planet, `${name} solid planet visible for surface threshold`);
  const planetPoint = { x: planet.x, y: planet.y };
  await checkBoundary(cdp, name, mobile, 'system', 'surface', planetPoint);
  await cdp.tapAt(planetPoint, mobile);
  await cdp.evaluate('window.OrbitalDebug.enterPlanet()');
  await settle(cdp, `${name} surface camera settles before close terrain zoom`);
  await zoomStep(cdp, 2, { x: planetPoint.x, y: planetPoint.y });
  assert.equal((await cdp.evaluate(stateExpression)).level, 'surface', `${name} close terrain keeps surface detail`);
  await cdp.screenshot(`${name}-terrain-close.png`);
  await checkTerrainZoomLimit(cdp, name);
  assert.equal(await cdp.evaluate('typeof window.OrbitalDebug.getTransferMinRadius'), 'undefined',
    `${name} orbital rendezvous API is removed`);
  assert.equal(await cdp.evaluate('/rendez[ -]?vous/i.test(document.body.textContent)'), false,
    `${name} orbital rendezvous interface is removed`);
}

async function checkSystemVariety(cdp, name, mobile) {
  await cdp.evaluate('window.OrbitalDebug.regenerate(424242)');
  await cdp.evaluate('document.querySelector("#reveal-toggle").checked = true; document.querySelector("#reveal-toggle").dispatchEvent(new Event("change"))');
  const scenarios = [
    ['empty', 'model.planets.length === 0 && model.debris.length === 0 && !model.wreck'],
    ['single', 'model.planets.length === 1'],
    ['gas-only', 'model.planets.length > 0 && model.planets.every(p => p.kind === "gazeuse")'],
    ['rich', 'model.planets.length >= 8 && model.debris.length >= 2']
  ];
  for (const [scenario, predicate] of scenarios) {
    await cdp.click('#overview-button');
    await settle(cdp, `${name} galaxy overview before ${scenario}`);
    const target = await cdp.evaluate(`(() => {
      const debug = window.OrbitalDebug, state = debug.getState();
      const galaxy = window.OrbitWorld.createGalaxy(state.seed), camera = debug.getCamera();
      for (const star of galaxy.systems) {
        const point = window.OrbitCamera.project(star, camera, {width:innerWidth,height:innerHeight});
        if (point.x < 60 || point.x > innerWidth-60 || point.y < 270 || point.y > innerHeight-230) continue;
        const model = window.OrbitWorld.createSystem(state.seed, star.id, galaxy);
        if (${predicate}) return {id:star.id, point, count:model.planets.length};
      }
      return null;
    })()`);
    assert.ok(target, `${name} ${scenario} system is available for real selection`);
    await cdp.evaluate(`window.OrbitalDebug.zoomAt(8, ${target.point.x}, ${target.point.y})`);
    await cdp.tapAt(target.point, mobile);
    assert.equal((await cdp.evaluate(stateExpression)).selectedId, target.id, `${name} ${scenario} star tap selects its system`);
    if (scenario === 'empty') assert.match(await cdp.evaluate('document.querySelector("#selection-info").textContent'), /Aucune planète/);
    await cdp.click('#enter-button');
    await cdp.until('window.OrbitalDebug.getState().level === "system" && !window.OrbitalDebug.getState().moving', `${name} enters ${scenario}`);
    assert.equal((await cdp.evaluate(stateExpression)).planetCount, target.count);
    await cdp.click('#overview-button');
    await settle(cdp, `${name} ${scenario} system overview`);
    assert.equal((await cdp.evaluate(stateExpression)).level, 'system');
    await cdp.click('#home-button');
    await settle(cdp, `${name} ${scenario} recenter`);
    const camera = await cdp.evaluate(cameraExpression);
    assert.ok(Object.values(camera).every(Number.isFinite));
    if (scenario === 'empty' || scenario === 'gas-only') {
      await cdp.evaluate('window.OrbitalDebug.enterPlanet()');
      assert.equal((await cdp.evaluate(stateExpression)).level, 'system');
      assert.deepEqual(await cdp.evaluate(cameraExpression), camera);
    }
    await cdp.screenshot(`${name}-worldgen-${scenario}.png`);
    await cdp.click('#back-button');
    await cdp.until('window.OrbitalDebug.getState().level === "galaxy" && !window.OrbitalDebug.getState().moving', `${name} leaves ${scenario}`);
  }
  process.stdout.write(`PASS ${name}: empty, single-planet, gas-only and rich systems, overview and return\n`);
}

async function runViewport(cdp, viewport, runtimeErrors) {
  const { name, width, height, mobile } = viewport;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 2 });
  const navigation = await cdp.send('Page.navigate', { url: BASE_URL });
  if (navigation.errorText) throw new Error(`Browser navigation blocked: ${navigation.errorText} (${BASE_URL})`);
  await cdp.until('Boolean(window.OrbitalDebug && document.querySelector("#universe"))', `${name} application ready`, 20000);
  await cdp.until('window.OrbitalDebug.getState().systemCount > 0', `${name} galaxy generation`);
  if (await cdp.evaluate(menuVisibleExpression)) await cdp.click('#continue-button');
  await cdp.until(`!(${menuVisibleExpression})`, `${name} initial menu closed`);
  await checkLayout(cdp, width, height);
  if (mobile) await cdp.screenshot('mobile-startup.png');

  await cdp.evaluate('window.OrbitalDebug.regenerate(424242)');
  await cdp.evaluate('document.querySelector("#reveal-toggle").checked = false; document.querySelector("#reveal-toggle").dispatchEvent(new Event("change"))');
  await cdp.evaluate('window.OrbitalDebug.focusHome()');
  await settle(cdp, `${name} home camera settles`);
  const initial = await cdp.evaluate(stateExpression);
  assert.equal(initial.level, 'galaxy', `${name} starts in galaxy`);
  assert.ok(initial.systemCount >= 100, `${name} galaxy contains enough systems`);
  assert.ok(initial.discoveredCount > 0 && initial.discoveredCount < initial.systemCount, `${name} has explored and unexplored systems`);
  assert.ok(initial.selectedId !== null && initial.selectedId !== undefined, `${name} home system selected`);
  await cdp.screenshot(`${name}-galaxy.png`);

  await cdp.click('#close-inspector');
  assert.equal((await cdp.evaluate(stateExpression)).selectedId, null, `${name} selection closes`);
  await cdp.click('#overview-button');
  await settle(cdp, `${name} overview camera settles`);
  await cdp.screenshot(`${name}-galaxy-overview.png`);
  await cdp.evaluate('window.OrbitalDebug.focusHome()');
  await settle(cdp, `${name} home camera settles after overview`);
  await cdp.click('#close-inspector');
  if (mobile) {
    const beforeZoom = (await cdp.evaluate(stateExpression)).zoom;
    const y = height * 0.48;
    const touches = (spread) => [{ x: width / 2 - spread, y, id: 1 }, { x: width / 2 + spread, y, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(40) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(58) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
    assert.ok((await cdp.evaluate(stateExpression)).zoom > beforeZoom * 1.1, 'Mobile two-finger pinch zooms');
    const beforePan = await cdp.evaluate('window.OrbitalDebug.getHomeScreenPosition()');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width / 2, y: height * .55, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width / 2, y: height * .55 + 45, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterPan = await cdp.evaluate('window.OrbitalDebug.getHomeScreenPosition()');
    assert.ok(afterPan.y - beforePan.y > 30, 'Mobile one-finger drag pans the map');
    await cdp.evaluate('window.OrbitalDebug.focusHome()');
    await settle(cdp, `${name} home camera settles after gestures`);
    await cdp.click('#close-inspector');
  }
  const homePoint = await cdp.evaluate('window.OrbitalDebug.getHomeScreenPosition()');
  await cdp.tapAt(homePoint, mobile);
  assert.equal((await cdp.evaluate(stateExpression)).selectedId, initial.homeId, `${name} real star tap selects home`);
  await cdp.click('#enter-button');
  await cdp.until('window.OrbitalDebug.getState().level === "system" && !window.OrbitalDebug.getState().moving', `${name} system navigation`);
  await cdp.evaluate('window.OrbitalDebug.setPause(true)');
  const system = await cdp.evaluate(stateExpression);
  assert.ok(system.planetCount > 0, `${name} system contains planets`);
  await checkLayout(cdp, width, height);
  await cdp.screenshot(`${name}-system.png`);

  const planetPoint = await cdp.evaluate(`window.OrbitalDebug.getPlanetScreenPositions().find(p => p.kind !== 'gazeuse' && p.x > 35 && p.x < innerWidth - 35 && p.y > 245 && p.y < innerHeight - 145)`);
  assert.ok(planetPoint, `${name} a solid planet can be tapped in the viewport`);
  await cdp.tapAt({ x: planetPoint.x, y: planetPoint.y }, mobile);
  assert.equal((await cdp.evaluate(stateExpression)).selectedId, planetPoint.id, `${name} real planet tap selects planet`);
  await cdp.click('#enter-button');
  await cdp.until('["surface", "planet"].includes(window.OrbitalDebug.getState().level) && !window.OrbitalDebug.getState().moving', `${name} surface navigation`);
  await checkLayout(cdp, width, height);
  await cdp.screenshot(`${name}-surface.png`);

  await cdp.evaluate('window.OrbitalDebug.back()');
  await cdp.until('window.OrbitalDebug.getState().level === "system" && !window.OrbitalDebug.getState().moving', `${name} return to system`);
  assert.equal((await cdp.evaluate(stateExpression)).level, 'system', `${name} surface returns to system`);
  await cdp.evaluate('window.OrbitalDebug.back()');
  await cdp.until('window.OrbitalDebug.getState().level === "galaxy" && !window.OrbitalDebug.getState().moving', `${name} return to galaxy`);
  assert.equal((await cdp.evaluate(stateExpression)).level, 'galaxy', `${name} system returns to galaxy`);

  await checkContinuousZoom(cdp, name, mobile);

  await cdp.evaluate('window.OrbitalDebug.regenerate(424242)');
  await cdp.evaluate('window.OrbitalDebug.focusHome()');
  await settle(cdp, `${name} repeated seed camera settles`);
  const repeated = await cdp.evaluate(stateExpression);
  for (const key of ['seed', 'selectedId', 'systemCount', 'discoveredCount']) {
    assert.equal(repeated[key], initial[key], `${name} seed reproduces ${key}`);
  }
  await cdp.evaluate('window.OrbitalDebug.regenerate(517823)');
  const different = await cdp.evaluate(stateExpression);
  assert.notEqual(String(different.seed), String(initial.seed), `${name} accepts a different seed`);

  await cdp.evaluate('window.OrbitalDebug.regenerate(424242)');
  await cdp.evaluate('window.OrbitalDebug.focusHome()');
  await settle(cdp, `${name} camera settles before probe test`);
  const scanPoint = await cdp.evaluate(`(() => {
    const state = window.OrbitalDebug.getState();
    const galaxy = window.OrbitWorld.createGalaxy(state.seed);
    const home = galaxy.systems.find(s => s.id === galaxy.homeId);
    const center = window.OrbitalDebug.getHomeScreenPosition();
    return galaxy.systems.filter(s => !s.discovered && Math.hypot(s.x-home.x,s.y-home.y) > 620)
      .map(s => ({ x: center.x + (s.x-home.x)*state.zoom, y: center.y + (s.y-home.y)*state.zoom }))
      .find(p => p.x > 25 && p.x < innerWidth-25 && p.y > 250 && p.y < innerHeight-155);
  })()`);
  assert.ok(scanPoint, `${name} an unexplored sector is reachable on screen`);
  const beforeScan = (await cdp.evaluate(stateExpression)).discoveredCount;
  await cdp.click('#scan-button');
  assert.equal((await cdp.evaluate(stateExpression)).tool, 'scan', `${name} scan tool activates`);
  await cdp.tapAt(scanPoint, mobile);
  assert.equal((await cdp.evaluate(stateExpression)).missions, 1, `${name} tapping the map launches a probe`);
  await cdp.until('window.OrbitalDebug.getState().missions === 0', `${name} probe completes`, 6000);
  assert.ok((await cdp.evaluate(stateExpression)).discoveredCount > beforeScan, `${name} probe discovers systems`);

  await cdp.click('#menu-button');
  await cdp.until(menuVisibleExpression, `${name} menu opens`);
  if (mobile) await cdp.screenshot('mobile-menu.png');
  await cdp.evaluate(`(() => {
    const input = document.querySelector('#seed-input');
    if (!input) throw new Error('Missing seed input');
    input.value = '883401';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await cdp.click('#generate-button');
  await cdp.until('String(window.OrbitalDebug.getState().seed) === "883401"', `${name} menu generates requested seed`);
  if (await cdp.evaluate(menuVisibleExpression)) await cdp.click('#continue-button');
  await cdp.until(`!(${menuVisibleExpression})`, `${name} continue closes menu`);
  assert.equal((await cdp.evaluate(stateExpression)).level, 'galaxy', `${name} regenerate returns to galaxy`);
  await checkLayout(cdp, width, height);
  await checkSystemVariety(cdp, name, mobile);
  assert.deepEqual(runtimeErrors, [], `${name} has no JavaScript or console errors`);
  process.stdout.write(`PASS ${name}: galaxy → system → surface → back, seeds, menu, layout\n`);
}

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  const profile = await mkdtemp(path.join(tmpdir(), 'orbital-browser-'));
  let chrome;
  let cdp;
  try {
    const appUrl = new URL(BASE_URL);
    if (appUrl.protocol === 'file:') {
      assert.ok((await stat(fileURLToPath(appUrl))).isFile(), 'Standalone HTML exists');
    } else {
      const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(10000) });
      assert.ok(response.ok, `App server response: ${response.status}`);
      // Consume the bundle before closing this read-only availability check.
      // Leaving a large HTTP/1.0 response paused trips Node 24's parser at EOF.
      await response.arrayBuffer();
    }
    chrome = await launchChrome(profile);
    const endpoint = new URL(chrome.url);
    const targetResponse = await fetch(`http://${endpoint.host}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    assert.ok(targetResponse.ok, 'Chromium created page target');
    const target = await targetResponse.json();
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    const runtimeErrors = [];
    const externalRequests = [];
    cdp.on('Network.requestWillBeSent', ({ request }) => {
      if (!/^https?:/.test(request.url)) return;
      if (appUrl.protocol === 'file:' || new URL(request.url).origin !== appUrl.origin) externalRequests.push(request.url);
    });
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      runtimeErrors.push(exceptionDetails.exception?.description || exceptionDetails.text);
    });
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type === 'error') runtimeErrors.push(args.map((argument) => argument.value ?? argument.description ?? '').join(' '));
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await runViewport(cdp, { name: 'mobile', width: 390, height: 844, mobile: true }, runtimeErrors);
    await runViewport(cdp, { name: 'desktop', width: 1440, height: 900, mobile: false }, runtimeErrors);
    assert.deepEqual(externalRequests, [], 'App makes no requests to external network resources');
    process.stdout.write(`Screenshots: ${ARTIFACTS}\n`);
  } catch (error) {
    if (cdp) {
      try { await cdp.screenshot('failure.png'); } catch { /* Preserve original failure. */ }
    }
    throw error;
  } finally {
    if (cdp) cdp.socket.close();
    if (chrome && chrome.child.exitCode === null) {
      const stopped = new Promise((resolve) => chrome.child.once('exit', resolve));
      chrome.child.kill('SIGTERM');
      await Promise.race([stopped, sleep(2000)]);
      if (chrome.child.exitCode === null) chrome.child.kill('SIGKILL');
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

module.exports = { CDP, launchChrome };
if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`FAIL ${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
