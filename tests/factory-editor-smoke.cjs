#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { CDP, launchChrome } = require('./browser-smoke.cjs');

const BASE_URL = process.env.ORBITAL_BASE_URL || 'http://127.0.0.1:8000';

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'factory-editor-v1-'));
  let chrome, cdp;
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(10000) });
    assert.ok(response.ok, `App server response: ${response.status}`);
    await response.arrayBuffer();
    chrome = await launchChrome(profile);
    const endpoint = new URL(chrome.url);
    const targetResponse = await fetch(`http://${endpoint.host}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    assert.ok(targetResponse.ok, 'Chromium creates the test page');
    cdp = await CDP.connect((await targetResponse.json()).webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      (() => {
        let moduleValue;
        Object.defineProperty(globalThis, 'OrbitFactoryEditor', {
          configurable: true,
          get: () => moduleValue,
          set: value => {
            moduleValue = Object.freeze({ ...value, create(document, options) {
              const editor = value.create(document, options);
              globalThis.__factoryEditorTest = editor;
              return editor;
            }});
          }
        });
      })();
    ` });
    const navigation = await cdp.send('Page.navigate', { url: BASE_URL });
    if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
    await cdp.until('Boolean(window.__factoryEditorTest && window.OrbitProcessGraph)', 'factory V1 startup', 20000);
    if (await cdp.evaluate('document.querySelector("#menu-dialog").open')) await cdp.click('#continue-button');
    await cdp.until('!document.querySelector("#menu-dialog").open', 'main menu closing');

    const openTwoMachines = async () => cdp.evaluate(`(() => {
      const version = window.OrbitProcessData.config.version;
      const graph = window.OrbitProcessGraph.create({ version, geology: { resourceId: 'iron' }, machines: [
        { id: 'drill-test', type: 'drill', x: 520, y: 700 },
        { id: 'crusher-test', type: 'crusher', x: 890, y: 700 }
      ], connections: [] });
      window.__factoryEditorTest.open({ id: 'editor-test', type: 'factory', upgradeLevel: 1 }, graph);
    })()`);
    const openEmpty = async () => cdp.evaluate(`(() => {
      const graph = window.OrbitProcessGraph.create({ version: window.OrbitProcessData.config.version,
        geology: { resourceId: 'iron' } });
      window.__factoryEditorTest.open({ id: 'editor-test', type: 'extractor', upgradeLevel: 1 }, graph);
    })()`);
    const frame = async () => cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => resolve()))');
    const editorSnapshot = async () => cdp.evaluate(`(() => {
      const viewport = document.querySelector('#factory-viewport').getBoundingClientRect();
      const state = window.__factoryEditorTest.getViewportState();
      return { camera: state.camera, mode: state.mode,
        viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
        cards: [...document.querySelectorAll('.factory-node')].map(card => ({
          id: card.dataset.machineId, rect: card.getBoundingClientRect().toJSON() })) };
    })()`);
    const point = async selector => cdp.evaluate(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    const mouseDrag = async (from, to) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
      await frame();
    };

    await openEmpty();
    await cdp.until('!document.querySelector("#factory-editor").hidden', 'factory editor opening');
    const worldSize = await cdp.evaluate(`(() => ({
      width: document.querySelector('#factory-world').clientWidth,
      height: document.querySelector('#factory-world').clientHeight,
      linkWidth: document.querySelector('#factory-link-layer').ownerSVGElement.clientWidth,
      linkHeight: document.querySelector('#factory-link-layer').ownerSVGElement.clientHeight
    }))()`);
    assert.deepEqual(worldSize, { width: 7800, height: 5400, linkWidth: 7800, linkHeight: 5400 });
    await cdp.click('[data-add-machine="crusher"]');
    let placement = await cdp.evaluate(`(() => {
      const viewport = document.querySelector('#factory-viewport').getBoundingClientRect();
      const card = document.querySelector('.factory-node').getBoundingClientRect();
      return { viewport: viewport.toJSON(), card: card.toJSON() };
    })()`);
    assert.ok(Math.abs((placement.card.x + placement.card.width / 2) -
      (placement.viewport.x + placement.viewport.width / 2)) < 1 &&
      Math.abs((placement.card.y + placement.card.height / 2) -
        (placement.viewport.y + placement.viewport.height / 2)) < 1,
    `first palette machine appears at the visible camera center: ${JSON.stringify(placement)}`);
    await cdp.click('[data-add-machine="grinder"]');
    assert.ok(await cdp.evaluate('Boolean(document.querySelector(\'[data-add-machine="output_dock"]\'))'),
      'the output dock is available in the machine palette');
    placement = await cdp.evaluate(`(() => {
      const viewport = document.querySelector('#factory-viewport').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.factory-node')].map(card => card.getBoundingClientRect());
      return { viewport: viewport.toJSON(), cards: cards.map(rect => rect.toJSON()) };
    })()`);
    assert.equal(placement.cards.length, 2, 'a second palette machine is created');
    assert.ok(placement.cards.every(card => card.right > placement.viewport.left &&
      card.left < placement.viewport.right && card.bottom > placement.viewport.top &&
      card.top < placement.viewport.bottom), 'new machines remain visible near the camera center');
    assert.ok(placement.cards[0].x !== placement.cards[1].x || placement.cards[0].y !== placement.cards[1].y,
      'new machine headers do not become inaccessible under an exact overlap');
    await cdp.evaluate('window.__factoryEditorTest.close()');

    await openTwoMachines();
    await cdp.until('!document.querySelector("#factory-editor").hidden', 'factory editor opening');
    const ui = await cdp.evaluate(`(() => ({ count: document.querySelectorAll('.factory-node').length,
      oldSystems: ['#factory-stock-toggle', '#factory-process-details', '[data-add-machine="screen"]', '[data-add-machine="smelter"]']
        .some(selector => document.querySelector(selector)),
      ports: [...document.querySelectorAll('.factory-port')].map(port => port.dataset.outputId || port.dataset.inputId),
      fields: [...document.querySelectorAll('.factory-node [data-readout]')].map(item => item.dataset.readout),
      drillRate: document.querySelector('.factory-node[data-machine-id="drill-test"] [data-readout="rate"]').textContent,
      crusherRate: document.querySelector('.factory-node[data-machine-id="crusher-test"] [data-readout="rate"]').textContent
    }))()`);
    assert.equal(ui.count, 2);
    assert.equal(ui.oldSystems, false, 'removed stocks, inspectors, screen and smelter controls are absent');
    assert.ok(ui.ports.includes('raw_ore') && ui.ports.includes('crushed_ore'));
    assert.ok(ui.fields.includes('rate') && ui.fields.includes('energy') && ui.fields.includes('cycle') && ui.fields.includes('state'));
    assert.match(ui.drillRate, /∞/);
    assert.match(ui.crusherRate, /2 u\/s/);

    let before = await editorSnapshot();
    const blank = { x: before.viewport.x + before.viewport.width * .91, y: before.viewport.y + before.viewport.height * .87 };
    await mouseDrag(blank, { x: blank.x + 42, y: blank.y - 24 });
    let after = await editorSnapshot();
    assert.ok(Math.abs(after.camera.x - before.camera.x - 42) < .1 &&
      Math.abs(after.camera.y - before.camera.y + 24) < .1 && after.camera.scale === before.camera.scale,
    'desktop dragging on the background pans the shared world transform');

    const wheel = { x: before.viewport.x + before.viewport.width * .34,
      y: before.viewport.y + before.viewport.height * .42 };
    before = await editorSnapshot();
    const local = { x: wheel.x - before.viewport.x, y: wheel.y - before.viewport.y };
    const anchor = { x: (local.x - before.camera.x) / before.camera.scale,
      y: (local.y - before.camera.y) / before.camera.scale };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...wheel });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheel, deltaX: 0, deltaY: 100 });
    await frame();
    after = await editorSnapshot();
    assert.ok(after.camera.scale !== before.camera.scale);
    assert.ok(Math.abs(local.x - after.camera.x - anchor.x * after.camera.scale) < .35 &&
      Math.abs(local.y - after.camera.y - anchor.y * after.camera.scale) < .35,
    `desktop wheel zoom keeps the pointer anchor fixed: ${JSON.stringify({ before, after, local, anchor })}`);

    const cardBefore = await cdp.evaluate(`(() => {
      const node = document.querySelector('[data-machine-id="crusher-test"]');
      const header = node.querySelector('.factory-node-header').getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      return { point: { x: header.x + header.width / 2, y: header.y + header.height / 2 },
        rect: { x: rect.x, y: rect.y } };
    })()`);
    await mouseDrag(cardBefore.point, { x: cardBefore.point.x + 34, y: cardBefore.point.y + 18 });
    const cardAfter = await cdp.evaluate(`(() => { const rect = document.querySelector('[data-machine-id="crusher-test"]').getBoundingClientRect();
      return { x: rect.x, y: rect.y }; })()`);
    assert.ok(Math.abs(cardAfter.x - cardBefore.rect.x - 34) < .2 &&
      Math.abs(cardAfter.y - cardBefore.rect.y - 18) < .2,
    'desktop machine drag follows the pointer without changing the camera');

    let source = await point('.factory-port.output[data-output-id="raw_ore"]');
    let target = await point('.factory-port.input[data-input-id="raw_ore"]');
    await mouseDrag(source, target);
    let connections = await cdp.evaluate('window.__factoryEditorTest.isOpen() && document.querySelectorAll(".factory-link-hit").length');
    assert.equal(connections, 1, 'desktop drag snaps an output port to the compatible input');
    const connectionShape = await cdp.evaluate(`(() => {
      const path = document.querySelector('.factory-link-hit');
      const camera = window.__factoryEditorTest.getViewportState().camera;
      const viewport = document.querySelector('#factory-viewport').getBoundingClientRect();
      const toWorld = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { x: (rect.left + rect.width / 2 - viewport.left - camera.x) / camera.scale,
          y: (rect.top + rect.height / 2 - viewport.top - camera.y) / camera.scale };
      };
      const start = path.getPointAtLength(0), end = path.getPointAtLength(path.getTotalLength());
      const output = toWorld('.factory-port.output[data-output-id="raw_ore"]');
      const input = toWorld('.factory-port.input[data-input-id="raw_ore"]');
      return { path: path.getAttribute('d') || '',
        startError: Math.hypot(start.x - output.x, start.y - output.y),
        endError: Math.hypot(end.x - input.x, end.y - input.y),
        markup: [...document.querySelectorAll('.factory-link')].some(item => item.textContent || item.querySelector('title')) };
    })()`);
    assert.match(connectionShape.path, /^M /);
    assert.ok(connectionShape.startError < .8 && connectionShape.endError < .8,
      `line endpoints stay centered on their ports through transforms: ${JSON.stringify(connectionShape)}`);
    assert.equal(connectionShape.markup, false, 'connections carry no labels or hidden payloads');

    const linePoint = await cdp.evaluate(`(() => {
      const path = document.querySelector('.factory-link-hit');
      const point = path.getPointAtLength(path.getTotalLength() / 2);
      const camera = window.__factoryEditorTest.getViewportState().camera;
      const viewport = document.querySelector('#factory-viewport').getBoundingClientRect();
      return { x: viewport.left + camera.x + point.x * camera.scale,
        y: viewport.top + camera.y + point.y * camera.scale };
    })()`);
    const detachTarget = await cdp.evaluate(`(() => {
      const viewport = document.querySelector('#factory-viewport').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.factory-node')].map(card => card.getBoundingClientRect());
      const points = [[.95,.92],[.95,.08],[.05,.92],[.05,.08],[.8,.92],[.2,.92]]
        .map(([x,y]) => ({ x: viewport.left + viewport.width*x, y: viewport.top + viewport.height*y }));
      return points.find(point => cards.every(card => point.x < card.left || point.x > card.right ||
        point.y < card.top || point.y > card.bottom));
    })()`);
    await mouseDrag(linePoint, detachTarget);
    connections = await cdp.evaluate('document.querySelectorAll(".factory-link-hit").length');
    assert.equal(connections, 0, 'dragging an existing connection away detaches it');
    await cdp.evaluate('window.__factoryEditorTest.close()');

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await openTwoMachines();
    await cdp.until('!document.querySelector("#factory-editor").hidden', 'touch editor opening');
    before = await editorSnapshot();
    assert.ok(before.viewport.width > 500 && before.viewport.height > 220,
      `landscape touch workspace is usable: ${JSON.stringify(before.viewport)}`);

    const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: points.map(point => ({ ...point, radiusX: 1, radiusY: 1, force: 1 }))
    });
    const touchBlank = { x: before.viewport.x + before.viewport.width * .9,
      y: before.viewport.y + before.viewport.height * .88 };
    await touch('touchStart', [{ ...touchBlank, id: 1 }]);
    await touch('touchMove', [{ x: touchBlank.x + 30, y: touchBlank.y - 15, id: 1 }]);
    await frame();
    await touch('touchEnd', []);
    after = await editorSnapshot();
    assert.ok(Math.abs(after.camera.x - before.camera.x - 30) < .2 &&
      Math.abs(after.camera.y - before.camera.y + 15) < .2,
    'one-finger background drag pans the view');

    const focus = { x: after.viewport.x + after.viewport.width * .78,
      y: after.viewport.y + after.viewport.height * .78 };
    const pair = (spread, offsetX = 0, offsetY = 0) => [
      { x: focus.x - spread + offsetX, y: focus.y + offsetY, id: 2 },
      { x: focus.x + spread + offsetX, y: focus.y + offsetY, id: 3 }
    ];
    before = await editorSnapshot();
    const localFocus = { x: focus.x - before.viewport.x, y: focus.y - before.viewport.y };
    const pinchAnchor = { x: (localFocus.x - before.camera.x) / before.camera.scale,
      y: (localFocus.y - before.camera.y) / before.camera.scale };
    await touch('touchStart', pair(24));
    await touch('touchMove', pair(31, 5, 3));
    await frame();
    after = await editorSnapshot();
    const scaleExpected = Math.min(4, Math.max(.16, before.camera.scale * 62 / 48));
    assert.ok(Math.abs(after.camera.scale - scaleExpected) < .0001 &&
      Math.abs(after.camera.x - ((localFocus.x + 5) - pinchAnchor.x * scaleExpected)) < .2 &&
      Math.abs(after.camera.y - ((localFocus.y + 3) - pinchAnchor.y * scaleExpected)) < .2,
    'touch pinch zoom follows its moving midpoint without jumps');
    await touch('touchEnd', []);
    const afterLift = await editorSnapshot();
    assert.deepEqual(afterLift.camera, after.camera, 'lifting one finger does not alter the camera');
    const followPoint = { x: focus.x + 36, y: focus.y + 26 };
    await touch('touchStart', [{ ...followPoint, id: 6 }]);
    await touch('touchMove', [{ x: followPoint.x + 15, y: followPoint.y + 6, id: 6 }]);
    await frame();
    const afterPinchPan = await editorSnapshot();
    assert.ok(Math.abs(afterPinchPan.camera.x - after.camera.x - 15) < .2 &&
      Math.abs(afterPinchPan.camera.y - after.camera.y - 6) < .2,
    `one-finger panning resumes from the exact pinch endpoint: ${JSON.stringify({ after, afterLift, afterPinchPan })}`);
    await touch('touchEnd', []);

    const machineStart = await point('[data-machine-id="crusher-test"] .factory-node-header');
    const machineRect = await cdp.evaluate('document.querySelector("[data-machine-id=crusher-test]").getBoundingClientRect().toJSON()');
    await touch('touchStart', [{ ...machineStart, id: 4 }]);
    await touch('touchMove', [{ x: machineStart.x + 22, y: machineStart.y + 12, id: 4 }]);
    await touch('touchEnd', []);
    const movedMachine = await cdp.evaluate('document.querySelector("[data-machine-id=crusher-test]").getBoundingClientRect().toJSON()');
    assert.ok(Math.abs(movedMachine.x - machineRect.x - 22) < .3 && Math.abs(movedMachine.y - machineRect.y - 12) < .3,
      'touch drag moves a machine independently from the camera');

    source = await point('.factory-port.output[data-output-id="raw_ore"]');
    target = await point('.factory-port.input[data-input-id="raw_ore"]');
    const portTargetSize = await cdp.evaluate(`(() => {
      const port = document.querySelector('.factory-port.input[data-input-id="raw_ore"]').getBoundingClientRect();
      const scale = window.__factoryEditorTest.getViewportState().camera.scale;
      return { width: port.width / scale, height: port.height / scale };
    })()`);
    assert.ok(portTargetSize.width >= 43.9 && portTargetSize.height >= 43.9,
      `input port target is at least 44 by 44 CSS pixels: ${JSON.stringify(portTargetSize)}`);
    target = { x: target.x + 17, y: target.y };
    await touch('touchStart', [{ ...source, id: 5 }]);
    await touch('touchMove', [{ ...target, id: 5 }]);
    await touch('touchEnd', []);
    connections = await cdp.evaluate('document.querySelectorAll(".factory-link-hit").length');
    assert.equal(connections, 1, 'touch connection snapping still works after pinch and pan');

    await cdp.evaluate('window.__factoryEditorTest.close()');
    await openEmpty();
    await cdp.until('!document.querySelector("#factory-editor").hidden', 'empty mobile editor opening');
    await cdp.click('[data-add-machine="crusher"]');
    const mobilePlacement = await cdp.evaluate(`(() => {
      const viewport = document.querySelector('#factory-viewport').getBoundingClientRect();
      const card = document.querySelector('.factory-node').getBoundingClientRect();
      const port = document.querySelector('.factory-port.input').getBoundingClientRect();
      const scale = window.__factoryEditorTest.getViewportState().camera.scale;
      return { centerError: Math.hypot(card.left + card.width / 2 - viewport.left - viewport.width / 2,
        card.top + card.height / 2 - viewport.top - viewport.height / 2),
        targetSize: { width: port.width / scale, height: port.height / scale } };
    })()`);
    assert.ok(mobilePlacement.centerError < 1,
      `mobile palette machine appears at viewport center: ${JSON.stringify(mobilePlacement)}`);
    assert.ok(mobilePlacement.targetSize.width >= 43.9 && mobilePlacement.targetSize.height >= 43.9);

    await cdp.evaluate(`(() => {
      const graph = window.OrbitProcessGraph.create({ version: window.OrbitProcessData.config.version,
        machines: [{ id: 'occupied-crusher', type: 'crusher', inputBuffer: { raw_ore: 1 } }] });
      window.__factoryEditorTest.open({ id: 'editor-test', type: 'factory', upgradeLevel: 1 }, graph);
    })()`);
    await cdp.click('[data-remove-machine="occupied-crusher"]');
    const removal = await cdp.evaluate(`({ count: document.querySelectorAll('.factory-node').length,
      status: document.querySelector('#factory-editor-status').textContent })`);
    assert.equal(removal.count, 0, 'a machine with buffered resources can be removed');
    assert.match(removal.status, /1 UNITÉ RETIRÉE/,
      `buffered resources are reported when their card is removed: ${removal.status}`);

    process.stdout.write('PASS V1 factory editor in Chromium: world sizing, centered placement, output dock palette, occupied-card deletion, port targets, desktop pan/wheel/drag/connect/detach and landscape touch pan/pinch/drag/connect\n');
  } finally {
    if (cdp) cdp.socket.close();
    if (chrome?.child.exitCode === null) {
      const stopped = new Promise(resolve => chrome.child.once('exit', resolve));
      chrome.child.kill('SIGTERM');
      await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 2000))]);
      if (chrome.child.exitCode === null) chrome.child.kill('SIGKILL');
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
