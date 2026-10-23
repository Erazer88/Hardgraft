(function (root) {
  'use strict';
  const Atlas = root.NereideAtlas = root.NereideAtlas || {};
  function hash(text) {
    let value = 2166136261;
    for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return value >>> 0;
  }
  function random(seed, stream) {
    let state = (seed ^ hash(stream || 'world')) >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ state >>> 15, 1 | state);
      t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function parseSeed(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
    const text = String(value).trim().replace(/^0x/i, '');
    if (!text) throw new Error('Saisis une seed ou un nom.');
    return /^[0-9a-f]{1,8}$/i.test(text) ? parseInt(text, 16) >>> 0 : hash(text);
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  function noise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    function at(a, b) {
      let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
      n = Math.imul(n ^ n >>> 13, 1274126177);
      return ((n ^ n >>> 16) >>> 0) / 4294967295;
    }
    return lerp(lerp(at(ix, iy), at(ix + 1, iy), fx), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), fx), fy);
  }
  Object.assign(Atlas, { hash, random, parseSeed, clamp, lerp, noise,
    formatSeed: seed => (seed >>> 0).toString(16).toUpperCase().padStart(8, '0') });
})(globalThis);
