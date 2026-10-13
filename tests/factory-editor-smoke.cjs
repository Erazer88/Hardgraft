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
    await cdp.evaluate(`window.__factoryEditorTest.open({ id: 'editor-test', type: 'factory', upgradeLevel: 1 }, null)`);
    await cdp.until('!document.querySelector("#factory-editor").hidden', 'factory editor opening');

    const layout = await cdp.evaluate(`(() => {
      const viewport = document.querySelector('#factory-viewport');
      const bounds = viewport.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
        zoomControls: document.querySelectorAll('[data-factory-zoom], #factory-editor-fit').length };
    })()`);
    assert.ok(layout.width > 500 && layout.height > 200, `Landscape work area is visible: ${JSON.stringify(layout)}`);
    assert.equal(layout.zoomControls, 0, 'Process view has no zoom or reframe controls');
    await cdp.click('#factory-block-list [data-add-node="transform"]');
    await cdp.until('document.querySelectorAll("#factory-nodes .factory-node").length === 1', 'factory block added');

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
    assert.deepEqual(afterOneFinger.transform, beforeGestures.transform,
      'One-finger movement does not pan the process view');
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
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pair(58, 16, 8) });
    await frame();
    const afterPinch = await snapshot();
    const focusX = pinchCenter.x - layout.x, focusY = pinchCenter.y - layout.y;
    const anchorWorldX = (focusX - pinchBase.transform.x) / pinchBase.transform.scale;
    const anchorWorldY = (focusY - pinchBase.transform.y) / pinchBase.transform.scale;
    const expectedPinchScale = Math.min(1.45, pinchBase.transform.scale * (116 / 56));
    assert.ok(Math.abs(afterPinch.transform.scale - expectedPinchScale) < .00001,
      `Pinch updates zoom from distance ratio (got ${afterPinch.transform.scale}, expected ${expectedPinchScale}, start ${pinchBase.transform.scale})`);
    assert.ok(Math.abs(afterPinch.transform.x - (focusX - anchorWorldX * expectedPinchScale)) < .05 &&
      Math.abs(afterPinch.transform.y - (focusY - anchorWorldY * expectedPinchScale)) < .05,
    'Pinch keeps its initial focal point fixed even if the midpoint drifts');

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frame();
    const afterLift = await snapshot();
    assert.deepEqual(afterLift.transform, afterPinch.transform,
      'Lifting both fingers does not change the zoom');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pair(30, 8, 3) });
    await frame();
    const afterSecondPinchStart = await snapshot();
    assert.deepEqual(afterSecondPinchStart.transform, afterPinch.transform,
      'Starting a second pinch does not jump the process view');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pair(20, 8, 3) });
    await frame();
    const afterSecondPinchZoom = await snapshot();
    assert.ok(Math.abs(afterSecondPinchZoom.transform.scale - afterPinch.transform.scale * (40 / 60)) < .00001,
      `A second pinch uses its own distance baseline (got ${afterSecondPinchZoom.transform.scale}, expected ${afterPinch.transform.scale * (40 / 60)})`);
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

    process.stdout.write('PASS 844x390 mobile landscape factory editor: pinch/wheel zoom, no pan or zoom buttons, block drag preserved\n');
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
