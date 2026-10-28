(function (root) {
  'use strict';

  // Rock keeps what it is made of without tracking single units: every stock
  // (a card port, a building inventory, a dock) holds one average composition
  // per resource, weighted by its units. Memory grows with the number of
  // stocks, never with the number of units on the move.
  const TRACKED = new Set(['raw_rock', 'crushed_rock', 'ground_rock', 'tailings']);
  const PLAIN_ROCK = Object.freeze({ rock: 1 });
  const round = value => Math.round(value * 1e4) / 1e4;

  const tracks = resourceId => TRACKED.has(resourceId);

  // Shares that sum to 1, rounded; marine materials (oil) never sit in rock.
  function normalize(composition) {
    const entries = Object.entries(composition || {})
      .filter(([id, share]) => id !== 'oil' && Number.isFinite(share) && share > 0);
    const total = entries.reduce((sum, [, share]) => sum + share, 0);
    if (!(total > 0)) return { ...PLAIN_ROCK };
    return Object.fromEntries(entries.map(([id, share]) => [id, round(share / total)]).filter(([, share]) => share > 0));
  }

  // Composition of a stock holding `held` units of `current` once `amount`
  // units of `incoming` join it.
  function blend(current, held, incoming, amount) {
    if (!(amount > 0)) return current ? { ...current } : null;
    const base = current || PLAIN_ROCK, added = incoming || PLAIN_ROCK, kept = held > 0 ? held : 0;
    if (!kept) return normalize(added);
    const mixed = {};
    for (const id of new Set([...Object.keys(base), ...Object.keys(added)])) {
      mixed[id] = ((base[id] || 0) * kept + (added[id] || 0) * amount) / (kept + amount);
    }
    return normalize(mixed);
  }

  // Records that `amount` units of a tracked resource joined mixes[key],
  // which already held `held` units.
  function add(mixes, key, resourceId, held, amount, composition) {
    if (!mixes || !tracks(resourceId) || !(amount > 0)) return;
    mixes[key] = blend(mixes[key], held, composition, amount);
  }

  // Composition of the units held under mixes[key] (plain rock if unknown).
  function of(mixes, key) { return mixes?.[key] || PLAIN_ROCK; }

  // Forgets a mix once its stock is empty.
  function prune(mixes, key, remaining) { if (mixes && !(remaining > 0)) delete mixes[key]; }

  // What is left of a rock once `removed` of one material per unit is taken out.
  function deplete(composition, material, removed) {
    const left = { ...(composition || PLAIN_ROCK) };
    left[material] = Math.max(0, (left[material] || 0) - removed);
    return normalize(left);
  }

  // Valid mixes from a save.
  function restore(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .filter(([key, composition]) => key && composition && typeof composition === 'object')
      .map(([key, composition]) => [key, normalize(composition)]));
  }

  root.OrbitComposition = Object.freeze({ tracks, normalize, blend, add, of, prune, deplete, restore, plainRock: PLAIN_ROCK });
})(globalThis);
