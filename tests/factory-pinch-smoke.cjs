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
  const profile = await mkdtemp(path.join(tmpdir(), 'factory-pinch-'));
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
    await cdp.evaluate(`window.__factoryEditorTest.open({ id: 'pinch-test', type: 'factory', upgradeLevel: 1 }, null)`);
    await cdp.until('!document.querySelector("#factory-editor").hidden', 'factory editor opening');
    const box = await cdp.evaluate(`(() => {
      const viewport = document.querySelector('#factory-viewport');
      const bounds = viewport.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    })()`);
    assert.ok(box.width > 500 && box.height > 200, `Landscape work area is visible: ${JSON.stringify(box)}`);
    await cdp.evaluate(`(() => {
      const viewport = document.querySelector('#factory-viewport');
      const world = document.querySelector('#factory-world');
      const points = new Map();
      const matrix = () => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
        return { x: matrix.e, y: matrix.f, scale: matrix.a };
      };
      viewport.addEventListener('pointerdown', event => {
        if (event.pointerType === 'touch') points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }, true);
      viewport.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch') points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }, true);
      for (const type of ['pointerup', 'pointercancel']) viewport.addEventListener(type, event => {
        if (event.pointerType === 'touch') points.delete(event.pointerId);
      }, true);
      globalThis.__factoryPinchProbe = { points, viewport, snapshot: () => {
        const bounds = viewport.getBoundingClientRect();
        return { transform: matrix(), bounds: { x: bounds.x, y: bounds.y },
          points: [...points.values()].slice(0, 2).map(point => ({ ...point })) };
      } };
    })()`);
    await cdp.click('#factory-block-list [data-add-node="transform"]');
    await cdp.until('document.querySelectorAll("#factory-nodes .factory-node").length === 1', 'factory block added');
    const start = { x: box.x + box.width * .58, y: box.y + box.height * .56 };
    const pair = (firstId, secondId, midX, midY, spread) => [
      { x: midX - spread, y: midY - spread * .12, id: firstId },
      { x: midX + spread, y: midY + spread * .12, id: secondId },
    ];
    const frame = async () => cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => resolve()))');
    const snapshot = async () => cdp.evaluate('window.__factoryPinchProbe.snapshot()');
    const midpoint = state => ({ x: (state.points[0].x + state.points[1].x) / 2,
      y: (state.points[0].y + state.points[1].y) / 2 });
    const makeBaseline = state => {
      const center = midpoint(state), distance = Math.hypot(state.points[1].x - state.points[0].x,
        state.points[1].y - state.points[0].y);
      return { state, center, distance,
        worldX: (center.x - state.bounds.x - state.transform.x) / state.transform.scale,
        worldY: (center.y - state.bounds.y - state.transform.y) / state.transform.scale };
    };
    const measure = (baseline, current) => {
      const center = midpoint(current), distance = Math.hypot(current.points[1].x - current.points[0].x,
        current.points[1].y - current.points[0].y);
      const scale = Math.max(.18, Math.min(1.45, baseline.state.transform.scale * distance / baseline.distance));
      const expectedX = center.x - current.bounds.x - baseline.worldX * scale;
      const expectedY = center.y - current.bounds.y - baseline.worldY * scale;
      return { scaleError: Math.abs(current.transform.scale - scale),
        positionError: Math.hypot(current.transform.x - expectedX, current.transform.y - expectedY),
        fingerStep: Math.hypot(center.x - baseline.center.x, center.y - baseline.center.y) };
    };
    const advancePhase = async (baseline, makePoints, from, to) => {
      let maxScaleError = 0, maxPositionError = 0, maxFingerStep = 0, count = 0;
      for (let step = from + 1; step <= to; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: makePoints(step) });
        await frame();
        const reading = measure(baseline, await snapshot());
        maxScaleError = Math.max(maxScaleError, reading.scaleError);
        maxPositionError = Math.max(maxPositionError, reading.positionError);
        maxFingerStep = Math.max(maxFingerStep, reading.fingerStep);
        count++;
        await sleep(8);
      }
      return { maxScaleError, maxPositionError, maxFingerStep, count };
    };

    const firstStart = pair(1, 2, start.x, start.y, 30);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: firstStart });
    await frame();
    const firstBaseState = await snapshot(), firstBase = makeBaseline(firstBaseState);
    const firstPhase = await advancePhase(firstBase, step => pair(1, 2,
      start.x + step * .65, start.y + step * .28, 30 + step * .25), 0, 18);
    const afterFirst = await snapshot();
    const remaining = pair(1, 2, start.x + 18 * .65, start.y + 18 * .28, 30 + 18 * .25)[1];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [remaining] });
    await frame();
    const beforeRegrip = await snapshot();
    assert.ok(Math.hypot(beforeRegrip.transform.x - afterFirst.transform.x,
      beforeRegrip.transform.y - afterFirst.transform.y) < .05 &&
      Math.abs(beforeRegrip.transform.scale - afterFirst.transform.scale) < .00001,
    'Lifting one finger does not move the workspace');

    const secondStart = pair(2, 3, remaining.x + 30, remaining.y, 30);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: secondStart });
    await frame();
    const afterRegrip = await snapshot();
    assert.ok(Math.hypot(afterRegrip.transform.x - beforeRegrip.transform.x,
      afterRegrip.transform.y - beforeRegrip.transform.y) < .05 &&
      Math.abs(afterRegrip.transform.scale - beforeRegrip.transform.scale) < .00001,
    'Starting a new pinch does not jump the workspace');
    const secondBase = makeBaseline(afterRegrip);
    const secondPhase = await advancePhase(secondBase, step => pair(2, 3,
      remaining.x + 30 + step * .45, remaining.y - step * .22, 30 - step * .3), 0, 18);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const result = { count: firstPhase.count + secondPhase.count,
      maxScaleError: Math.max(firstPhase.maxScaleError, secondPhase.maxScaleError),
      maxPositionError: Math.max(firstPhase.maxPositionError, secondPhase.maxPositionError),
      maxFingerStep: Math.max(firstPhase.maxFingerStep, secondPhase.maxFingerStep) };
    assert.ok(result.maxScaleError < .00001, `Pinch scale jumps by ${result.maxScaleError}`);
    assert.ok(result.maxPositionError < .05, `Pinch world anchor jumps by ${result.maxPositionError}px`);
    assert.ok(result.maxFingerStep < 20, `Pinch input step is unexpectedly large: ${result.maxFingerStep}px`);
    process.stdout.write(`PASS 844x390 mobile landscape factory pinch/regrip: ${result.count} animation frames, ` +
      `max scale error ${result.maxScaleError}, max anchor error ${result.maxPositionError}px\n`);
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
