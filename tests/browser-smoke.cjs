#!/usr/bin/env node
'use strict';

// Real Chromium interaction checks for the experimental WebGL2 planet view.
// Start the prototype on port 8000 first, or set ORBITAL_BASE_URL.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const BASE_URL = process.env.ORBITAL_BASE_URL || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROMIUM_BIN || '/usr/bin/chromium';
const ARTIFACTS = path.resolve(__dirname, '../artifacts');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

class CDP {
  constructor(socket) {
    this.socket = socket; this.nextId = 0; this.pending = new Map(); this.listeners = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id); clearTimeout(entry.timeout);
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
        else entry.resolve(message.result);
      } else for (const callback of this.listeners.get(message.method) || []) callback(message.params);
    });
    socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timeout); entry.reject(new Error(`CDP closed during ${entry.method}`));
      }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chromium CDP connection timed out')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Chromium CDP connection failed')); }, { once: true });
    });
    return new CDP(socket);
  }
  on(method, callback) {
    const callbacks = this.listeners.get(method) || []; callbacks.push(callback); this.listeners.set(method, callbacks);
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
      this.pending.set(id, { resolve, reject, timeout, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async until(expression, description, timeout = 20000) {
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
      if (!element) throw new Error('Missing UI element: ' + ${JSON.stringify(selector)});
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height || getComputedStyle(element).visibility === 'hidden')
        throw new Error('UI element is not visible: ' + ${JSON.stringify(selector)});
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    })()`);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    await sleep(100);
  }
  async tap(point, mobile) {
    if (mobile) {
      await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
      await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    }
    await sleep(120);
  }
  async drag(from, to, mobile, steps = 8) {
    if (mobile) {
      await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        await this.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
          x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id: 1
        }] });
        await sleep(18);
      }
      await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', ...from });
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1,
          x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
        await sleep(18);
      }
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', ...to });
    }
    await sleep(180);
  }
  async pinch(center, fromSpread, toSpread) {
    const touches = spread => [
      { x: center.x - spread, y: center.y, id: 1 },
      { x: center.x + spread, y: center.y, id: 2 }
    ];
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(fromSpread) });
    for (let i = 1; i <= 6; i += 1) {
      const spread = fromSpread + (toSpread - fromSpread) * i / 6;
      await this.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(spread) });
      await sleep(25);
    }
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
  }
  async screenshot(filename) {
    await this.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(ARTIFACTS, filename), Buffer.from(data, 'base64'));
  }
}

async function launchChrome(profile) {
  const child = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Chromium startup timeout: ${log.slice(-1000)}`)); }, 15000);
    child.stderr.on('data', chunk => {
      log += chunk.toString(); const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Chromium exited ${code}: ${log.slice(-1000)}`)); });
  });
  return { child, url };
}

async function enterSurface(cdp, viewport, name) {
  const { width, height, mobile } = viewport;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile,
    screenWidth: width, screenHeight: height });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 2 });
  await cdp.send('Page.navigate', { url: BASE_URL });
  await cdp.until('Boolean(window.OrbitalDebug && document.querySelector("#universe"))', `${name} application boot`);
  if (await cdp.evaluate('document.querySelector("#menu-dialog").open')) {
    await cdp.click('#continue-button');
    await cdp.until('!document.querySelector("#menu-dialog").open', `${name} initial menu closes`);
  }
  const seed = mobile ? 'GLOBE-MOBILE-SMOKE' : 'GLOBE-DESKTOP-SMOKE';
  await cdp.evaluate(`window.OrbitalDebug.regenerate(${JSON.stringify(seed)}); window.OrbitalDebug.focusHome(); window.OrbitalDebug.setPause(true)`);
  await cdp.until('window.OrbitalDebug.getState().level === "galaxy" && !window.OrbitalDebug.getState().moving', `${name} home camera`);
  await cdp.click('#enter-button');
  try {
    await cdp.until('window.OrbitalDebug.getState().level === "system" && !window.OrbitalDebug.getState().moving', `${name} system view`);
  } catch (error) {
    const state = await cdp.evaluate(`(() => { const button = document.querySelector('#enter-button'), box = button.getBoundingClientRect();
      return { state: OrbitalDebug.getState(), enterHidden: button.hidden, inspectorHidden: document.querySelector('#inspector').hidden,
        name: document.querySelector('#selection-name').textContent, box: [box.x,box.y,box.width,box.height],
        hit: document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.id,
        target: OrbitalDebug.getCamera() } })()`);
    throw new Error(`${error.message}; after system command: ${JSON.stringify(state)}`);
  }
  const planet = await cdp.evaluate(`(() => {
    const state = window.OrbitalDebug.getState();
    const galaxy = window.OrbitWorld.createGalaxy(state.seed);
    const model = window.OrbitWorld.createSystem(state.seed, state.homeId, galaxy);
    const starting = window.OrbitalDebug.getPlanetScreenPositions().find(point => point.id === model.startingPlanetId);
    return starting && starting.x > 42 && starting.x < innerWidth - 42 && starting.y > 105 && starting.y < innerHeight - 85
      ? starting : window.OrbitalDebug.getPlanetScreenPositions()
        .filter(point => point.kind !== 'gazeuse' && point.x > 42 && point.x < innerWidth - 42 &&
          point.y > 105 && point.y < innerHeight - 85)
        .sort((a,b) => Math.hypot(a.x-innerWidth/2,a.y-innerHeight/2)-Math.hypot(b.x-innerWidth/2,b.y-innerHeight/2))[0];
  })()`);
  assert.ok(planet, `${name} has a tappable solid planet`);
  await cdp.tap(planet, mobile);
  assert.equal((await cdp.evaluate('window.OrbitalDebug.getState().selectedId')), planet.id,
    `${name} real tap selects a planet in the system`);
  await cdp.click('#enter-button');
  await cdp.until('window.OrbitalDebug.getState().level === "surface" && window.OrbitalDebug.getPlanetGlobeMetrics().transition === null',
    `${name} system-to-globe transition`, 30000);
  try {
    await cdp.until('window.OrbitalDebug.getPlanetGlobeMetrics().renderer.vertices > 0', `${name} globe mesh upload`, 30000);
  } catch (error) {
    const state = await cdp.evaluate(`({ metrics: OrbitalDebug.getPlanetGlobeMetrics(),
      error: document.querySelector('#planet-globe-error').textContent, resolution: devicePixelRatio })`);
    throw new Error(`${error.message}; WebGL diagnostics: ${JSON.stringify(state)}`);
  }
  const metrics = await cdp.evaluate(`({ globe: window.OrbitalDebug.getPlanetGlobeMetrics(),
    webgl: document.querySelector('#planet-globe').style.display,
    overlay: document.querySelector('#planet-globe-overlay').style.display,
    error: document.querySelector('#planet-globe-error').hidden,
    viewport: [innerWidth, innerHeight], overflow: document.documentElement.scrollWidth-innerWidth })`);
  assert.equal(metrics.globe.available, true, `${name} WebGL2 context is available`);
  assert.equal(metrics.webgl, 'block', `${name} 3D canvas is visible`);
  assert.equal(metrics.overlay, 'block', `${name} projected cartographic overlay is visible`);
  assert.equal(metrics.error, true, `${name} WebGL2 fallback message is hidden when rendering succeeds`);
  assert.ok(metrics.globe.renderer.vertices >= 18000, `${name} globe reuses the expected mobile mesh resolution`);
  assert.equal(metrics.globe.renderer.textureWidth, 2048, `${name} globe uses the clean 2048px source surface maps`);
  assert.equal(metrics.globe.renderer.textureHeight, metrics.globe.renderer.textureWidth / 2,
    `${name} separated surface maps preserve the equirectangular ratio`);
  assert.equal(metrics.globe.renderer.dpr, mobile ? 3 : 1, `${name} globe rendering honors the mobile DPR cap of 3`);
  assert.equal(metrics.overflow <= 1, true, `${name} layout has no horizontal overflow`);
  return { planet, mobile, width, height };
}

async function placeStorage(cdp, mobile, spacing = 0, nearBuildingId = null, maxTerrainDistance = 320) {
  await cdp.click('#build-button');
  await cdp.until('!document.querySelector("#build-menu").hidden', 'building catalogue opens');
  await cdp.click('#build-options [data-building-type="storage"]');
  await cdp.until('window.OrbitalDebug.getState().tool === "build"', 'storage placement mode activates');
  const position = await cdp.evaluate(`window.OrbitalDebug.findBuildableScreenPosition('storage', ${spacing}, ${JSON.stringify(nearBuildingId)}, ${maxTerrainDistance})`);
  assert.ok(position, 'a valid visible terrain position is available for a building');
  const before = (await cdp.evaluate('window.OrbitalDebug.getState().buildingCount'));
  await cdp.tap({ x: position.x, y: position.y }, mobile);
  try {
    await cdp.until(`window.OrbitalDebug.getState().buildingCount === ${before + 1}`, 'building placement by a real tap');
  } catch (error) {
    const diagnostics = await cdp.evaluate(`({ state: window.OrbitalDebug.getState(), toast: document.querySelector('#toast').textContent,
      inspector: document.querySelector('#inspector').hidden, position: ${JSON.stringify(position)},
      canvas: (() => { const r = document.querySelector('#universe').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })() })`);
    throw new Error(`${error.message}; placement diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  const buildings = await cdp.evaluate('window.OrbitalDebug.getSurfaceBuildings()');
  return buildings[buildings.length - 1];
}

async function runViewport(cdp, viewport, errors) {
  const { name, mobile, width, height } = viewport;
  await enterSurface(cdp, viewport, name);
  if (process.env.ORBITAL_BROWSER_CAPTURE_ZOOM === '1') {
    assert.equal(mobile, false, 'the large-texture visual capture uses the desktop viewport');
    const beforeZoom = await cdp.evaluate('window.OrbitalDebug.getPlanetGlobeMetrics().camera.zoom');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: height / 2, deltaX: 0, deltaY: -200 });
    await cdp.until(`window.OrbitalDebug.getPlanetGlobeMetrics().camera.zoom > ${beforeZoom}`,
      `${name} globe zooms while retaining its full-resolution surface maps`, 60000);
  }
  await cdp.screenshot(`${name}-planet-globe.png`);
  if (process.env.ORBITAL_BROWSER_CAPTURE_ONLY === '1') {
    process.stdout.write(`CAPTURE ${name}: globe frame saved for visual review\n`);
    return;
  }
  const center = { x: width / 2, y: height / 2 };
  const beforeRotate = await cdp.evaluate('window.OrbitalDebug.getPlanetGlobeMetrics().camera');
  await cdp.drag({ x: center.x - 44, y: center.y }, { x: center.x + 50, y: center.y + 26 }, mobile);
  const afterRotate = await cdp.evaluate('window.OrbitalDebug.getPlanetGlobeMetrics().camera');
  assert.ok(Math.abs(afterRotate.yaw - beforeRotate.yaw) > .15, `${name} real ${mobile ? 'touch drag' : 'mouse drag'} rotates the globe`);
  if (mobile) {
    const beforePinch = afterRotate.zoom;
    await cdp.pinch(center, 30, 43);
    const afterPinch = await cdp.evaluate('window.OrbitalDebug.getPlanetGlobeMetrics().camera.zoom');
    assert.ok(afterPinch > beforePinch * 1.1, `${name} real pinch smoothly zooms in`);
    await cdp.pinch(center, 42, 28);
    const afterPinchOut = await cdp.evaluate('window.OrbitalDebug.getPlanetGlobeMetrics().camera.zoom');
    assert.ok(afterPinchOut < afterPinch, `${name} real pinch zooms back out`);
    const beforePostPinchDrag = await cdp.evaluate('window.OrbitalDebug.getPlanetGlobeMetrics().camera.yaw');
    await cdp.drag({ x: center.x - 36, y: center.y }, { x: center.x + 38, y: center.y - 16 }, true);
    assert.ok(Math.abs((await cdp.evaluate('window.OrbitalDebug.getPlanetGlobeMetrics().camera.yaw')) - beforePostPinchDrag) > .12,
      `${name} one-finger rotation works after pinch`);
  } else {
    const beforeWheel = afterRotate.zoom;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: center.x, y: center.y, deltaX: 0, deltaY: -85 });
    const afterWheel = await cdp.evaluate('window.OrbitalDebug.getPlanetGlobeMetrics().camera.zoom');
    assert.ok(afterWheel > beforeWheel, `${name} real wheel zooms the globe`);
    assert.ok(afterWheel <= 1.56, `${name} wheel respects the short globe zoom range`);
  }

  const first = await placeStorage(cdp, mobile);
  let firstPoint = await cdp.evaluate(`window.OrbitalDebug.getBuildingScreenPosition(${JSON.stringify(first.id)})`);
  assert.ok(firstPoint?.x, `${name} placed icon is projected on the visible hemisphere`);
  await cdp.tap(firstPoint, mobile);
  assert.equal((await cdp.evaluate('window.OrbitalDebug.getState().selectedId')), first.id,
    `${name} real tap selects its projected building icon`);
  assert.equal(await cdp.evaluate('document.querySelector("#selection-name").textContent'), 'DÉPÔT',
    `${name} selected icon opens the normal building description panel`);
  await cdp.click('#close-inspector');
  // Keep the second test building nearby; the terrain still decides whether
  // the visible gesture can reach it by a valid surface route.
  const second = await placeStorage(cdp, mobile, 48, first.id, 180);
  await cdp.evaluate('window.OrbitalDebug.setPause(false)');
  try {
    await cdp.until(`window.OrbitalDebug.getSurfaceBuildings().filter(b => ${JSON.stringify(first.id)} === b.id || ${JSON.stringify(second.id)} === b.id).every(b => b.constructionState === "complete")`,
      `${name} placed buildings complete`, 30000);
  } catch (error) {
    const diagnostics = await cdp.evaluate(`({ state: window.OrbitalDebug.getState(),
      buildings: window.OrbitalDebug.getSurfaceBuildings().filter(b => b.id === ${JSON.stringify(first.id)} || b.id === ${JSON.stringify(second.id)}) })`);
    throw new Error(`${error.message}; construction diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  firstPoint = await cdp.evaluate(`window.OrbitalDebug.getBuildingScreenPosition(${JSON.stringify(first.id)})`);
  const secondPoint = await cdp.evaluate(`window.OrbitalDebug.getBuildingScreenPosition(${JSON.stringify(second.id)})`);
  assert.ok(firstPoint && secondPoint, `${name} both route endpoints are visible`);
  await cdp.click('#road-button');
  await cdp.drag(firstPoint, secondPoint, mobile, 12);
  const route = await cdp.evaluate(`window.OrbitalDebug.getRoadNetworkMetrics(${JSON.stringify(first.planetId)})`);
  if (!route.segmentCount) {
    const diagnostics = await cdp.evaluate(`({ state: window.OrbitalDebug.getState(), toast: document.querySelector('#toast').textContent,
      buildings: window.OrbitalDebug.getSurfaceBuildings(), first: ${JSON.stringify(firstPoint)}, second: ${JSON.stringify(secondPoint)} })`);
    await cdp.screenshot(`${name}-route-failed.png`);
    assert.equal(diagnostics.toast, 'Aucun tracé valide ne relie ces deux points.',
      `${name} rejects a route crossing impassable terrain with a clear explanation`);
  } else {
    await cdp.screenshot(`${name}-planet-road.png`);
  }

  const beforeRotateAway = await cdp.evaluate(`window.OrbitalDebug.getPlanetGlobeMetrics().camera.yaw`);
  let hidden = false;
  for (let i = 0; i < 5 && !hidden; i += 1) {
    const x0 = Math.max(22, width / 2 - 155), x1 = Math.min(width - 22, x0 + 205);
    await cdp.drag({ x: x0, y: center.y }, { x: x1, y: center.y }, mobile, 6);
    hidden = await cdp.evaluate(`window.OrbitalDebug.getBuildingScreenPosition(${JSON.stringify(first.id)}) === null`);
  }
  assert.ok(hidden, `${name} rotating the globe hides a rear-side building marker`);
  assert.notEqual(await cdp.evaluate('window.OrbitalDebug.getPlanetGlobeMetrics().camera.yaw'), beforeRotateAway,
    `${name} rear-side occlusion follows the actual globe rotation`);
  await cdp.click('#pan-button');
  await cdp.tap(center, mobile);
  assert.notEqual(await cdp.evaluate('window.OrbitalDebug.getState().selectedId'), first.id,
    `${name} hidden rear-side building cannot be selected through the globe`);

  await cdp.evaluate('window.OrbitalDebug.setPause(true)');
  const savedBuildings = await cdp.evaluate('window.OrbitalDebug.getSurfaceBuildings().map(b => ({id:b.id,x:b.x,y:b.y}))');
  if (mobile) await cdp.pinch(center, 30, 5);
  else await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: center.x, y: center.y, deltaX: 0, deltaY: 1400 });
  await cdp.until('window.OrbitalDebug.getState().level === "system" && !window.OrbitalDebug.getState().moving', `${name} globe exits to system`);
  const planetPoint = await cdp.evaluate(`window.OrbitalDebug.getPlanetScreenPositions().find(p => p.id === ${JSON.stringify((await cdp.evaluate('window.OrbitalDebug.getState().planetId')))} )`);
  assert.ok(planetPoint, `${name} selected planet remains in system view`);
  assert.ok(planetPoint.radiusPx >= 35 && planetPoint.radiusPx < 80,
    `${name} globe exits into a nearby system framing instead of jumping to the distant overview (${planetPoint.radiusPx}px)`);
  await cdp.tap(planetPoint, mobile);
  const reentryState = await cdp.evaluate('window.OrbitalDebug.getState()');
  assert.equal(reentryState.selectedId, planetPoint.id,
    `${name} real tap reselects the same planet before re-entry (selected ${reentryState.selectedId})`);
  await cdp.click('#enter-button');
  await cdp.until('window.OrbitalDebug.getState().level === "surface" && window.OrbitalDebug.getPlanetGlobeMetrics().transition === null',
    `${name} returns to the same 3D surface`);
  const restoredBuildings = await cdp.evaluate('window.OrbitalDebug.getSurfaceBuildings().map(b => ({id:b.id,x:b.x,y:b.y}))');
  assert.deepEqual(restoredBuildings, savedBuildings, `${name} globe rotation never changes saved building coordinates`);
  await cdp.screenshot(`${name}-planet-reentry.png`);

  const canLoseContext = await cdp.evaluate(`(() => Boolean(document.querySelector('#planet-globe').getContext('webgl2')?.getExtension('WEBGL_lose_context')) )()`);
  if (canLoseContext) {
    await cdp.evaluate(`window.__globeLossExtension = document.querySelector('#planet-globe').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__globeLossExtension.loseContext()`);
    await cdp.until('window.OrbitalDebug.getPlanetGlobeMetrics().renderer.contextLost', `${name} WebGL context loss event`);
    await cdp.until('document.querySelector("#planet-globe-error").hidden === false', `${name} visible WebGL context loss status`);
    assert.equal(await cdp.evaluate('document.querySelector("#planet-globe-error").hidden'), false,
      `${name} context loss has a visible status message`);
    await cdp.evaluate('window.__globeLossExtension.restoreContext()');
    await cdp.until('!window.OrbitalDebug.getPlanetGlobeMetrics().renderer.contextLost && window.OrbitalDebug.getPlanetGlobeMetrics().renderer.vertices > 0',
      `${name} WebGL context restores the cached mesh`, 12000);
  }
  assert.deepEqual(errors, [], `${name} browser has no JavaScript exceptions or console errors`);
  process.stdout.write(`PASS ${name}: system → globe, controls, placement, selection, route, occlusion, re-entry${canLoseContext ? ', WebGL restore' : ''}\n`);
}

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  const profile = await mkdtemp(path.join(tmpdir(), 'planet-globe-browser-'));
  let chrome, cdp;
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(10000) });
    assert.ok(response.ok, `Prototype server response: ${response.status} at ${BASE_URL}`);
    await response.arrayBuffer();
    chrome = await launchChrome(profile);
    const endpoint = new URL(chrome.url);
    const targetResponse = await fetch(`http://${endpoint.host}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    assert.ok(targetResponse.ok, 'Chromium page target created');
    cdp = await CDP.connect((await targetResponse.json()).webSocketDebuggerUrl);
    const errors = [], externalRequests = [];
    const baseOrigin = new URL(BASE_URL).origin;
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => errors.push(exceptionDetails.exception?.description || exceptionDetails.text));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type === 'error') errors.push(args.map(item => item.value ?? item.description ?? '').join(' '));
    });
    cdp.on('Network.requestWillBeSent', ({ request }) => {
      if (/^https?:/.test(request.url) && new URL(request.url).origin !== baseOrigin) externalRequests.push(request.url);
    });
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable');
    const viewports = [
      { name: 'desktop', width: 1280, height: 800, mobile: false },
      { name: 'mobile-portrait', width: 390, height: 844, mobile: true },
      { name: 'mobile-landscape', width: 844, height: 390, mobile: true }
    ].filter(viewport => !process.env.ORBITAL_BROWSER_VIEWPORT || viewport.name === process.env.ORBITAL_BROWSER_VIEWPORT);
    for (const viewport of viewports) await runViewport(cdp, viewport, errors);
    assert.deepEqual(externalRequests, [], 'globe prototype requests no external network resources');
    process.stdout.write(`Screenshots: ${ARTIFACTS}\n`);
  } finally {
    if (cdp) cdp.socket.close();
    if (chrome && chrome.child.exitCode === null) {
      const stopped = new Promise(resolve => chrome.child.once('exit', resolve));
      chrome.child.kill('SIGTERM'); await Promise.race([stopped, sleep(2000)]);
      if (chrome.child.exitCode === null) chrome.child.kill('SIGKILL');
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

module.exports = { CDP, launchChrome };

if (require.main === module) main().catch(error => {
  process.stderr.write(`FAIL ${error.stack || error}\n`); process.exitCode = 1;
});
