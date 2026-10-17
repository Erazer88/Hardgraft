'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { CDP, launchChrome } = require('./browser-smoke.cjs');
const BASE_URL = process.env.ORBITAL_BASE_URL || 'http://127.0.0.1:8000';

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'orbital-seed-reset-'));
  let chrome, cdp;
  try {
    chrome = await launchChrome(profile);
    const endpoint = new URL(chrome.url);
    const response = await fetch(`http://${endpoint.host}/json/new?about:blank`, { method: 'PUT' });
    cdp = await CDP.connect((await response.json()).webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      let module;
      Object.defineProperty(globalThis, 'OrbitState', { configurable: true, get: () => module,
        set: value => { module = { ...value, create() {
          const state = value.create(); globalThis.__seedResetState = state; return state;
        }}; }
      });
    })()` });
    await cdp.send('Page.navigate', { url: BASE_URL });
    await cdp.until('Boolean(window.OrbitalDebug && window.__seedResetState)', 'application startup', 20000);
    if (process.env.ORBITAL_EXPECTED_VERSION) {
      assert.equal(await cdp.evaluate('OrbitVersion'), process.env.ORBITAL_EXPECTED_VERSION);
    }
    await cdp.evaluate('OrbitalDebug.setPause(true)');

    // Only set up completed buildings and their road. Routing, dispatch, arrivals,
    // seed changes and persistence use the actual application paths.
    const addFixture = () => cdp.evaluate(`(() => {
      const state = window.__seedResetState;
      const galaxy = OrbitWorld.createGalaxy(state.seed);
      const system = OrbitWorld.createSystem(state.seed, galaxy.homeId, galaxy);
      const planetId = system.startingPlanetId;
      const source = OrbitSurfaceBuilding.create({ id: 'freight-source', type: 'extractor',
        planetId, x: 10, y: 10, constructionState: 'complete', dockStock: { raw_iron: 8 },
        dockDestinations: { raw_iron: 'freight-platform' } });
      const platform = OrbitSurfaceBuilding.create({ id: 'freight-platform', type: 'launch_platform',
        planetId, x: 110, y: 10, constructionState: 'complete' });
      const network = OrbitRoadNetwork.create(planetId);
      const a = OrbitRoadNetwork.addNode(network, { x: 10, y: 10, buildingId: source.id });
      const b = OrbitRoadNetwork.addNode(network, { x: 110, y: 10, buildingId: platform.id });
      OrbitRoadNetwork.addSegment(network, { from: a.id, to: b.id,
        points: [{ x: 10, y: 10 }, { x: 110, y: 10 }], builtLength: 100 });
      state.surfaceBuildings.push(source, platform); state.roadNetworks[planetId] = network;
      return system.id;
    })()`);

    await addFixture();
    await cdp.evaluate('OrbitalDebug.advanceOrbitalSimulationTo(10)');
    assert.equal((await cdp.evaluate('OrbitalDebug.getOrbitalLogistics()')).transit[0].amount, 8);
    await cdp.evaluate('OrbitalDebug.advanceOrbitalSimulationTo(3600)');
    assert.equal((await cdp.evaluate('OrbitalDebug.getOrbitalLogistics()')).nextDispatchTime, 3610);
    await cdp.evaluate('document.querySelector("#seed-input").value = "FREIGHT-SEED-RESET"');
    await cdp.evaluate('document.querySelector("#generate-button").scrollIntoView({block:"center"})');
    await cdp.click('#generate-button');
    const reset = await cdp.evaluate('({state:OrbitalDebug.getState(), logistics:OrbitalDebug.getOrbitalLogistics()})');
    assert.equal(reset.state.seed, 'FREIGHT-SEED-RESET');
    assert.equal(reset.state.time, 0);
    assert.equal(reset.logistics.nextDispatchTime, 10, 'a new seed cannot inherit the old dispatch deadline');
    assert.deepEqual(reset.logistics.hubs, {});
    assert.deepEqual(reset.logistics.corridors, []);
    assert.deepEqual(reset.logistics.transit, []);

    const systemId = await addFixture();
    await cdp.evaluate('OrbitalDebug.advanceOrbitalSimulationTo(0)');
    // Reproduce an already-saved affected game without replacing its buildings or stock.
    const storageKey = await cdp.evaluate('OrbitConfig.storageKey');
    // Inject before application startup: pagehide's normal autosave must not
    // overwrite the corrupted-save fixture before the reload reads it.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const key = ${JSON.stringify(storageKey)}, saved = JSON.parse(localStorage.getItem(key));
      saved.orbitalLogistics.nextDispatchTime = 3610;
      localStorage.setItem(key, JSON.stringify(saved));
      window.__injectedStaleDeadline = 3610;
    })()` });
    await cdp.evaluate('window.__beforeSeedReload = true');
    await cdp.send('Page.reload');
    await cdp.until('!window.__beforeSeedReload && Boolean(window.OrbitalDebug && window.__seedResetState)', 'saved game reload', 20000);
    assert.equal(await cdp.evaluate('window.__injectedStaleDeadline'), 3610);
    await cdp.evaluate('OrbitalDebug.setPause(true)');
    assert.equal((await cdp.evaluate('OrbitalDebug.getOrbitalBuildingState("freight-platform")')).launchStock.raw_iron, 8);
    await cdp.evaluate('OrbitalDebug.advanceOrbitalSimulationTo(10)');
    const launched = await cdp.evaluate('OrbitalDebug.getOrbitalLogistics()');
    assert.equal(launched.transit.length, 1, 'the new platform dispatches after 10 s, not after the previous world clock');
    assert.equal(launched.transit[0].amount, 8);
    assert.equal(launched.transit[0].departureTime, 10);
    await cdp.evaluate(`OrbitalDebug.advanceOrbitalSimulationTo(${launched.transit[0].arrivalTime})`);
    assert.equal((await cdp.evaluate('OrbitalDebug.getOrbitalLogistics()')).hubs[systemId].stock.raw_iron, 8);
    console.log('PASS mobile freight after seed change and reload of an affected save: dispatch at 10 s, arrival at the new Ark, preserved stock');
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
