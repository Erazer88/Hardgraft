(function (root) {
  'use strict';

  const requests = new Map();
  const prefetchEntries = new Map();
  const prefetchQueue = [];
  let foregroundSlot = null, prefetchSlot = null, nextId = 1;
  let idleHandle = null, idleTimer = null, nextPrefetchAt = 0;
  const MAX_QUEUED_PREFETCHES = 4;
  const PREFETCH_COOLDOWN_MS = 6500;

  function surfaceWidth() {
    return Math.min(root.devicePixelRatio >= 2.5 || Math.min(root.innerWidth, root.innerHeight) < 640 ? 768 : 1024,
      root.OrbitPlanetSurfaceTexture.defaults.width);
  }

  function requestKey(planet, width, height) {
    return JSON.stringify([planet.id, planet.seed, width, height, surfaceWidth()]);
  }

  function makeWorkerSlot(kind) {
    if (typeof root.Worker !== 'function') throw new Error('Web Worker indisponible');
    const bundle = root.document?.getElementById('planet-preparation-worker-bundle')?.textContent;
    let url = null, instance;
    if (bundle) {
      url = root.URL.createObjectURL(new Blob([bundle], { type: 'text/javascript' }));
      instance = new root.Worker(url);
    } else {
      instance = new root.Worker(new URL('src/workers/planetPreparationWorker.js', root.document.baseURI));
    }
    const slot = { kind, instance, url, pending: new Map() };
    if (kind === 'prefetch') prefetchSlot = slot;
    else foregroundSlot = slot;
    instance.onmessage = event => {
      const message = event.data || {}, entry = slot.pending.get(message.id);
      if (!entry) return;
      slot.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error));
      else entry.resolve({ terrain: message.terrain, assets: message.assets });
      if (kind === 'prefetch') {
        prefetchEntries.delete(entry.key);
        nextPrefetchAt = Date.now() + PREFETCH_COOLDOWN_MS;
        schedulePrefetch();
      }
    };
    instance.onerror = event => {
      const error = new Error(event.message || 'Échec du worker de préparation terrain');
      for (const entry of slot.pending.values()) entry.reject(error);
      slot.pending.clear();
      disposeSlot(slot);
      if (kind === 'prefetch') {
        for (const entry of prefetchEntries.values()) entry.reject(error);
        prefetchEntries.clear();
        prefetchQueue.length = 0;
      }
    };
    return slot;
  }

  function disposeSlot(slot) {
    if (!slot) return;
    slot.instance.terminate();
    if (slot.url) root.URL.revokeObjectURL(slot.url);
    if (foregroundSlot === slot) foregroundSlot = null;
    if (prefetchSlot === slot) prefetchSlot = null;
  }

  function workerFor(kind) {
    const current = kind === 'prefetch' ? prefetchSlot : foregroundSlot;
    return current || makeWorkerSlot(kind);
  }

  function dispatch(slot, planet, width, height, key) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      slot.pending.set(id, { resolve, reject, key });
      slot.instance.postMessage({ id, planet, width, height, textureWidth: surfaceWidth(),
        style: root.OrbitPlanetGlobeStyle });
    });
  }

  function clearPrefetchSchedule() {
    if (idleHandle !== null && typeof root.cancelIdleCallback === 'function') root.cancelIdleCallback(idleHandle);
    if (idleTimer !== null) root.clearTimeout(idleTimer);
    idleHandle = null; idleTimer = null;
  }

  function schedulePrefetch() {
    clearPrefetchSchedule();
    if (!prefetchQueue.length || root.document?.hidden) return;
    const delay = Math.max(0, nextPrefetchAt - Date.now());
    if (delay) {
      idleTimer = root.setTimeout(() => { idleTimer = null; schedulePrefetch(); }, delay);
      return;
    }
    const run = deadline => {
      idleHandle = null;
      if (!prefetchQueue.length || root.document?.hidden) return;
      if (deadline && !deadline.didTimeout && deadline.timeRemaining() < 4) {
        idleTimer = root.setTimeout(() => { idleTimer = null; schedulePrefetch(); }, 300);
        return;
      }
      const entry = prefetchQueue.shift();
      if (!entry || !prefetchEntries.has(entry.key)) { schedulePrefetch(); return; }
      try {
        const slot = workerFor('prefetch');
        dispatch(slot, entry.planet, entry.width, entry.height, entry.key).then(entry.resolve, entry.reject);
      } catch (error) {
        prefetchEntries.delete(entry.key);
        entry.reject(error);
        schedulePrefetch();
      }
    };
    if (typeof root.requestIdleCallback === 'function') idleHandle = root.requestIdleCallback(run, { timeout: 5000 });
    else idleTimer = root.setTimeout(() => { idleTimer = null; run(null); }, 2600);
  }

  function abortError() {
    const error = new Error('Préchargement interrompu pour préserver la fluidité.');
    error.name = 'AbortError';
    return error;
  }

  function cancelPrefetch() {
    clearPrefetchSchedule();
    prefetchQueue.length = 0;
    if (prefetchSlot) {
      for (const pending of prefetchSlot.pending.values()) pending.reject(abortError());
      prefetchSlot.pending.clear();
      disposeSlot(prefetchSlot);
    }
    for (const entry of prefetchEntries.values()) entry.reject(abortError());
    prefetchEntries.clear();
  }

  function generate(planet, width, height) {
    const key = requestKey(planet, width, height);
    // Interactive work always takes priority; a background world is killed
    // immediately so it cannot occupy the worker while the player zooms in.
    cancelPrefetch();
    if (requests.has(key)) return requests.get(key);
    let promise;
    try { promise = dispatch(workerFor('foreground'), planet, width, height, key); }
    catch (error) { promise = Promise.reject(error); }
    requests.set(key, promise);
    promise.then(() => requests.delete(key), () => requests.delete(key));
    return promise;
  }

  function prefetch(planet, width, height) {
    const key = requestKey(planet, width, height);
    if (requests.has(key)) return requests.get(key);
    if (prefetchEntries.has(key)) return prefetchEntries.get(key).promise;
    if (prefetchEntries.size >= MAX_QUEUED_PREFETCHES) return Promise.resolve(null);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const entry = { key, planet, width, height, resolve, reject, promise };
    prefetchEntries.set(key, entry);
    prefetchQueue.push(entry);
    schedulePrefetch();
    return promise;
  }

  root.OrbitTerrainPreparation = Object.freeze({ generate, prefetch, cancelPrefetch, surfaceWidth,
    pendingPrefetchCount: () => prefetchEntries.size, foregroundCount: () => requests.size });
})(globalThis);
