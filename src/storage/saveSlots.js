(function (root) {
  'use strict';

  // Several games kept in this browser. The game being played always lives
  // under config.storageKey (as before); the others wait under their own key
  // (storageKey + ':slot:' + id). An index lists them all with what the
  // saves menu shows: name, seed, population, technology points, last save.
  // Opening a game puts the current one aside and brings the other in.
  const config = root.OrbitConfig;
  const INDEX_KEY = 'nereide-atlas-saves-v1';
  const slotKey = id => `${config.storageKey}:slot:${id}`;

  function readIndex(storage) {
    try {
      const index = JSON.parse(storage.getItem(INDEX_KEY) || 'null');
      if (index && Array.isArray(index.slots) && typeof index.activeId === 'string') return index;
    } catch (_) { /* rebuilt below */ }
    return null;
  }
  function writeIndex(storage, index) {
    try { storage.setItem(INDEX_KEY, JSON.stringify(index)); return true; } catch (_) { return false; }
  }
  const nextId = index => `s${index.slots.reduce((max, slot) => Math.max(max, Number(slot.id.slice(1)) || 0), 0) + 1}`;
  const nextName = index => `Partie ${index.slots.reduce((max, slot) => Math.max(max, Number(slot.name.match(/(\d+)$/)?.[1]) || 0), 0) + 1}`;

  // The index, created on first use around the game already saved, if any.
  function ensure(storage) {
    const existing = readIndex(storage);
    if (existing) return existing;
    let seed = null;
    try { seed = JSON.parse(storage.getItem(config.storageKey) || 'null')?.seed ?? null; } catch (_) { seed = null; }
    const index = { activeId: 's1', slots: [{ id: 's1', name: 'Partie 1', seed: seed === null ? null : String(seed), updatedAt: Date.now() }] };
    writeIndex(storage, index);
    return index;
  }

  function list(storage) {
    const index = ensure(storage);
    return index.slots.map(slot => ({ ...slot, active: slot.id === index.activeId }))
      .sort((a, b) => (b.active - a.active) || (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  // What the menu shows of the game being played, after each save.
  function touch(storage, summary) {
    const index = ensure(storage), slot = index.slots.find(item => item.id === index.activeId);
    if (!slot) return;
    Object.assign(slot, summary, { updatedAt: Date.now() });
    writeIndex(storage, index);
  }

  // Puts the game being played aside, under its own key.
  function stash(storage) {
    const index = ensure(storage), data = storage.getItem(config.storageKey);
    if (data === null) return true;
    try { storage.setItem(slotKey(index.activeId), data); return true; } catch (_) { return false; }
  }

  // A new game becomes the one being played; returns its slot.
  function create(storage, seed) {
    const index = ensure(storage), slot = { id: nextId(index), name: nextName(index), seed: String(seed), updatedAt: Date.now() };
    index.slots.push(slot); index.activeId = slot.id;
    writeIndex(storage, index);
    return slot;
  }

  // Brings a game aside back in; returns its saved data (null if lost).
  function activate(storage, id) {
    const index = ensure(storage);
    if (!index.slots.some(slot => slot.id === id) || id === index.activeId) return null;
    let data = null;
    try { data = JSON.parse(storage.getItem(slotKey(id)) || 'null'); } catch (_) { data = null; }
    if (!data || !['string', 'number'].includes(typeof data.seed)) return null;
    index.activeId = id;
    writeIndex(storage, index);
    try { storage.removeItem(slotKey(id)); } catch (_) { /* kept */ }
    return data;
  }

  // Forgets a game aside (never the one being played).
  function remove(storage, id) {
    const index = ensure(storage);
    if (id === index.activeId) return false;
    index.slots = index.slots.filter(slot => slot.id !== id);
    writeIndex(storage, index);
    try { storage.removeItem(slotKey(id)); } catch (_) { /* gone anyway */ }
    return true;
  }

  // A seed to suggest for a new game: a word and a number.
  function randomSeed(random = Math.random) {
    const words = ['NEREIDE', 'TETHYS', 'AURORE', 'BOREAL', 'CALYPSO', 'DORIS', 'ELARA', 'HALO', 'IRIS', 'LYRA', 'NOVA', 'ORION', 'PHEBE', 'SELENE', 'THALIA', 'VESTA'];
    return `${words[Math.floor(random() * words.length)]}-${String(Math.floor(random() * 100)).padStart(2, '0')}`;
  }

  root.OrbitSaveSlots = Object.freeze({ ensure, list, touch, stash, create, activate, remove, randomSeed, slotKey });
})(globalThis);
