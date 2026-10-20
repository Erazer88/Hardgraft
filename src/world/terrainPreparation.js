(function (root) {
  'use strict';

  const requests = new Map();
  let worker = null, workerUrl = null, nextId = 1;

  function surfaceWidth() {
    return Math.min(root.devicePixelRatio >= 2.5 || Math.min(root.innerWidth, root.innerHeight) < 640 ? 768 : 1024,
      root.OrbitPlanetSurfaceTexture.defaults.width);
  }

  function buildWorker() {
    if (worker) return worker;
    if (typeof root.Worker !== 'function') throw new Error('Web Worker indisponible');
    const bundle = root.document?.getElementById('planet-preparation-worker-bundle')?.textContent;
    if (bundle) {
      workerUrl = root.URL.createObjectURL(new Blob([bundle], { type: 'text/javascript' }));
      worker = new root.Worker(workerUrl);
    } else {
      worker = new root.Worker(new URL('src/workers/planetPreparationWorker.js', root.document.baseURI));
    }
    const pending = new Map();
    worker.onmessage = event => {
      const message = event.data || {}, entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error));
      else entry.resolve({ terrain: message.terrain, assets: message.assets });
    };
    worker.onerror = event => {
      const error = new Error(event.message || 'Échec du worker de préparation terrain');
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      worker?.terminate(); worker = null;
      if (workerUrl) root.URL.revokeObjectURL(workerUrl);
      workerUrl = null;
    };
    worker.generate = (planet, width, height, textureWidth) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, planet, width, height, textureWidth, style: root.OrbitPlanetGlobeStyle });
    });
    return worker;
  }

  function generate(planet, width, height) {
    const key = JSON.stringify([planet.id, planet.seed, width, height, surfaceWidth()]);
    if (requests.has(key)) return requests.get(key);
    let promise;
    try { promise = buildWorker().generate(planet, width, height, surfaceWidth()); }
    catch (error) { promise = Promise.reject(error); }
    requests.set(key, promise);
    promise.then(() => requests.delete(key), () => requests.delete(key));
    return promise;
  }

  root.OrbitTerrainPreparation = Object.freeze({ generate, surfaceWidth });
})(globalThis);
