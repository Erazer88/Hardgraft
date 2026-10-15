#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { CDP, launchChrome } = require('./browser-smoke.cjs');

const BASE_URL = process.env.ORBITAL_BASE_URL || 'http://127.0.0.1:8000';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'factory-editor-'));
  let chrome, cdp;
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(10000) });
    assert.ok(response.ok, `App server response: ${response.status}`);
    await response.arrayBuffer();

    chrome = await launchChrome(profile);
    const endpoint = new URL(chrome.url);
    const targetResponse = await fetch(`http://${endpoint.host}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    assert.ok(targetResponse.ok, 'Chromium created page target');
    cdp = await CDP.connect((await targetResponse.json()).webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 2, mobile: true,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
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
    await cdp.until('Boolean(window.__factoryEditorTest && window.OrbitBuildingData)', 'factory editor startup', 20000);
    if (await cdp.evaluate('document.querySelector("#menu-dialog").open')) await cdp.click('#continue-button');
    await cdp.until('!document.querySelector("#menu-dialog").open', 'initial game menu closing');
    await cdp.evaluate(`window.__factoryEditorTest.open({ id: 'editor-test', type: 'factory', upgradeLevel: 1 }, {
      nodes: [{ id: 'node-1', type: 'smelter', x: 500, y: 700 }], connections: []
    })`);
    await cdp.until('!document.querySelector("#factory-editor").hidden', 'factory editor opening');

    const layout = await cdp.evaluate(`(() => {
      const viewport = document.querySelector('#factory-viewport');
      const bounds = viewport.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
        zoomControls: document.querySelectorAll('[data-factory-zoom], #factory-editor-fit').length };
    })()`);
    assert.ok(layout.width > 500 && layout.height > 200, `Landscape work area is visible: ${JSON.stringify(layout)}`);
    assert.equal(layout.zoomControls, 0, 'Process view has no zoom or reframe controls');
    await cdp.click('#factory-block-list [data-add-node="crusher"]');
    const addedBlocks = await cdp.evaluate(`({ count: document.querySelectorAll('#factory-nodes .factory-node').length,
      addButton: (() => { const item = document.querySelector('#factory-block-list [data-add-node="crusher"]');
        const bounds = item.getBoundingClientRect(); return { disabled: item.disabled, bounds: bounds.toJSON(),
          hit: document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.outerHTML.slice(0, 120) }; })(),
      status: document.querySelector('#factory-editor-status').textContent })`);
    assert.equal(addedBlocks.count, 2, `Factory block was added: ${JSON.stringify(addedBlocks)}`);
    const cardReadouts = await cdp.evaluate(`(() => {
      const card = document.querySelector('.factory-node');
      return { rate: card.querySelector('[data-readout="rate"]').textContent,
        energy: card.querySelector('[data-readout="energy"]').textContent,
        removedReadouts: ['state', 'cycle', 'input', 'output'].filter(key => card.querySelector('[data-readout="' + key + '"]')),
        progress: Boolean(card.querySelector('.factory-progress-fill')),
        outputs: [...card.querySelectorAll('.factory-port-label.output b')].map(item => item.textContent) };
    })()`);
    assert.match(cardReadouts.rate, /DÉBIT/);
    assert.match(cardReadouts.energy, /MW/);
    assert.deepEqual(cardReadouts.removedReadouts, [], 'Redundant status, cycle, input, and output rows are absent');
    assert.equal(cardReadouts.progress, true, 'Process cards show a cycle progress bar');
    assert.ok(cardReadouts.outputs.includes('Métal') && cardReadouts.outputs.includes('Déchets'),
      `Smelter outputs are labeled beside their ports: ${JSON.stringify(cardReadouts.outputs)}`);

    const frame = async () => cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => resolve()))');
    const snapshot = async () => cdp.evaluate(`(() => {
      const viewport = document.querySelector('#factory-viewport');
      const world = document.querySelector('#factory-world');
      const node = document.querySelector('.factory-node');
      const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
      const bounds = node.getBoundingClientRect();
      return { transform: { x: matrix.e, y: matrix.f, scale: matrix.a },
        node: { x: bounds.x, y: bounds.y }, viewport: viewport.getBoundingClientRect().toJSON() };
    })()`);
    const beforeGestures = await snapshot();
    const blank = { x: layout.x + layout.width * .8, y: layout.y + layout.height * .8 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...blank, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: blank.x + 36, y: blank.y - 18, id: 1 }] });
    await frame();
    const afterOneFinger = await snapshot();
    assert.ok(Math.abs(afterOneFinger.transform.x - (beforeGestures.transform.x + 36)) < .05 &&
      Math.abs(afterOneFinger.transform.y - (beforeGestures.transform.y - 18)) < .05 &&
      afterOneFinger.transform.scale === beforeGestures.transform.scale,
    'One-finger movement pans the process view exactly with the finger');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frame();

    const pinchCenter = { x: layout.x + layout.width * .58, y: layout.y + layout.height * .56 };
    const pair = (spread, offsetX = 0, offsetY = 0) => [
      { x: pinchCenter.x - spread + offsetX, y: pinchCenter.y + offsetY, id: 2 },
      { x: pinchCenter.x + spread + offsetX, y: pinchCenter.y + offsetY, id: 3 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pair(28) });
    await frame();
    const pinchBase = await snapshot();
    const startFocusX = pinchCenter.x - layout.x, startFocusY = pinchCenter.y - layout.y;
    const anchorWorldX = (startFocusX - pinchBase.transform.x) / pinchBase.transform.scale;
    const anchorWorldY = (startFocusY - pinchBase.transform.y) / pinchBase.transform.scale;
    let afterPinch = pinchBase;
    for (let step = 1; step <= 4; step++) {
      const spread = 28 + step * 7.5, offsetX = step * 4, offsetY = step * 2;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: pair(spread, offsetX, offsetY),
      });
      await frame();
      afterPinch = await snapshot();
      const stepScale = Math.min(3.2, Math.max(.12, pinchBase.transform.scale * (spread / 28)));
      const stepFocusX = startFocusX + offsetX, stepFocusY = startFocusY + offsetY;
      assert.ok(Math.abs(afterPinch.transform.scale - stepScale) < .00001 &&
        Math.abs(afterPinch.transform.x - (stepFocusX - anchorWorldX * stepScale)) < .05 &&
        Math.abs(afterPinch.transform.y - (stepFocusY - anchorWorldY * stepScale)) < .05,
      `Pinch stays aligned with the moving midpoint at step ${step}`);
    }
    const currentFocusX = startFocusX + 16, currentFocusY = startFocusY + 8;
    const expectedPinchScale = Math.min(3.2, Math.max(.12, pinchBase.transform.scale * (116 / 56)));
    assert.ok(Math.abs(afterPinch.transform.scale - expectedPinchScale) < .00001,
      `Pinch updates zoom from distance ratio (got ${afterPinch.transform.scale}, expected ${expectedPinchScale}, start ${pinchBase.transform.scale})`);
    assert.ok(afterPinch.transform.scale > 1.45,
      'Pinch zoom is not capped immediately above the fitted process view');
    assert.ok(Math.abs(afterPinch.transform.x - (currentFocusX - anchorWorldX * expectedPinchScale)) < .05 &&
      Math.abs(afterPinch.transform.y - (currentFocusY - anchorWorldY * expectedPinchScale)) < .05,
    'Pinch tracks its moving midpoint while keeping the world point under the fingers stable');

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pair(28) });
    await frame();
    const afterPinchReturns = await snapshot();
    assert.ok(Math.abs(afterPinchReturns.transform.scale - pinchBase.transform.scale) < .00001 &&
      Math.abs(afterPinchReturns.transform.x - pinchBase.transform.x) < .05 &&
      Math.abs(afterPinchReturns.transform.y - pinchBase.transform.y) < .05,
    'Returning both fingers to their starting distance and midpoint restores the exact starting view');

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frame();
    const afterLift = await snapshot();
    assert.deepEqual(afterLift.transform, afterPinchReturns.transform,
      'Lifting both fingers does not change the zoom');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pair(30, 8, 3) });
    await frame();
    const afterSecondPinchStart = await snapshot();
    assert.deepEqual(afterSecondPinchStart.transform, afterPinchReturns.transform,
      'Starting a second pinch does not jump the process view');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pair(20, 8, 3) });
    await frame();
    const afterSecondPinchZoom = await snapshot();
    assert.ok(Math.abs(afterSecondPinchZoom.transform.scale - afterPinchReturns.transform.scale * (40 / 60)) < .00001,
      `A second pinch uses its own distance baseline (got ${afterSecondPinchZoom.transform.scale}, expected ${afterPinchReturns.transform.scale * (40 / 60)})`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frame();

    const wheelPoint = { x: layout.x + layout.width * .34, y: layout.y + layout.height * .42 };
    const beforeWheel = await snapshot();
    const wheelFocusX = wheelPoint.x - layout.x, wheelFocusY = wheelPoint.y - layout.y;
    const wheelAnchorX = (wheelFocusX - beforeWheel.transform.x) / beforeWheel.transform.scale;
    const wheelAnchorY = (wheelFocusY - beforeWheel.transform.y) / beforeWheel.transform.scale;
    await cdp.evaluate(`(() => {
      globalThis.__factoryWheelEvent = null;
      document.querySelector('#factory-viewport').addEventListener('wheel', event => {
        globalThis.__factoryWheelEvent = { deltaY: event.deltaY, target: event.target.id,
          deltaMode: event.deltaMode, defaultPrevented: event.defaultPrevented };
      }, { once: true });
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: wheelPoint.x, y: wheelPoint.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: 120 });
    await frame();
    const afterWheel = await snapshot();
    const wheelEvent = await cdp.evaluate('window.__factoryWheelEvent');
    const wheelUnit = wheelEvent.deltaMode === 1 ? 16 : wheelEvent.deltaMode === 2 ? layout.height : 1;
    const expectedWheelScale = beforeWheel.transform.scale * Math.exp(-wheelEvent.deltaY * wheelUnit * .0012);
    assert.ok(Math.abs(afterWheel.transform.scale - expectedWheelScale) < .00001,
      `Mouse wheel changes the process zoom smoothly (got ${afterWheel.transform.scale}, expected ${expectedWheelScale})`);
    assert.ok(Math.abs(afterWheel.transform.x - (wheelFocusX - wheelAnchorX * expectedWheelScale)) < .05 &&
      Math.abs(afterWheel.transform.y - (wheelFocusY - wheelAnchorY * expectedWheelScale)) < .05,
    'Mouse wheel keeps the cursor focal point fixed');

    const beforeNodeDrag = await cdp.evaluate(`(() => {
      const bounds = document.querySelector('.factory-node-header').getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
        node: document.querySelector('.factory-node').getBoundingClientRect().toJSON() };
    })()`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: beforeNodeDrag.x, y: beforeNodeDrag.y, id: 4 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: beforeNodeDrag.x + 24, y: beforeNodeDrag.y + 12, id: 4 }] });
    await frame();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterNodeDrag = await snapshot();
    assert.ok(Math.abs(afterNodeDrag.node.x - beforeNodeDrag.node.x - 24) < .1 &&
      Math.abs(afterNodeDrag.node.y - beforeNodeDrag.node.y - 12) < .1,
    'Blocks remain individually draggable');

    await cdp.evaluate(`window.__factoryEditorTest.open({ id: 'editor-links', type: 'factory', upgradeLevel: 1 }, {
      nodes: [
        { id: 'source-a', type: 'input', x: 320, y: 560 },
        { id: 'source-b', type: 'input', x: 320, y: 850 },
        { id: 'crusher', type: 'crusher', x: 780, y: 700 }
      ], connections: []
    })`);
    await cdp.until('document.querySelectorAll("#factory-nodes .factory-node").length === 3', 'shared-input test plan loaded');
    let touchId = 10;
    const tap = async selector => {
      const point = await cdp.evaluate(`(() => {
        const selector = ${JSON.stringify(selector)};
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      })()`);
      const id = touchId++;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await frame();
    };
    await tap('.factory-node[data-node-id="source-a"] .factory-port.output');
    await tap('.factory-node[data-node-id="crusher"] .factory-port.input[data-port-index="0"][data-port-slot="0"]');
    await tap('.factory-node[data-node-id="source-b"] .factory-port.output');
    await tap('.factory-node[data-node-id="crusher"] .factory-port.input[data-port-index="0"][data-port-slot="1"]');
    const sharedInput = await cdp.evaluate(`(() => {
      const card = document.querySelector('.factory-node[data-node-id="crusher"]');
      return { links: document.querySelectorAll('.factory-link-hit').length,
        linkLabels: document.querySelectorAll('.factory-link-label').length,
        linkTooltips: [...document.querySelectorAll('.factory-link')].filter(path => path.querySelector('title')).length,
        slots: [...card.querySelectorAll('.factory-port.input[data-port-index="0"]')]
          .map(port => ({ slot: Number(port.dataset.portSlot), connected: port.dataset.connected === 'true' })) };
    })()`);
    assert.equal(sharedInput.links, 2, 'Two sources can connect to one crusher input');
    assert.equal(sharedInput.linkLabels, 0, 'Connections have no overlaid data labels');
    assert.equal(sharedInput.linkTooltips, 0, 'Connections have no hidden data tooltips');
    assert.deepEqual(sharedInput.slots.slice(0, 2), [{ slot: 0, connected: true }, { slot: 1, connected: true }]);
    assert.ok(sharedInput.slots.some(item => !item.connected), 'The shared input exposes the next free snap point');

    process.stdout.write('PASS 844x390 mobile landscape factory editor: Upload Labs-style readouts, multi-source input snapping, pan, pinch/wheel zoom, block drag\n');
  } finally {
    if (cdp) cdp.socket.close();
    if (chrome?.child.exitCode === null) {
      const stopped = new Promise(resolve => chrome.child.once('exit', resolve));
      chrome.child.kill('SIGTERM');
      await Promise.race([stopped, sleep(2000)]);
      if (chrome.child.exitCode === null) chrome.child.kill('SIGKILL');
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  process.stderr.write(`FAIL ${error.stack || error}\n`);
  process.exitCode = 1;
});
