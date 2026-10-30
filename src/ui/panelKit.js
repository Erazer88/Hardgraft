(function (root) {
  'use strict';

  // Shared pieces of the colony and hub menus: whole numbers with units that
  // scale like bytes (u, ku, Mu, Gu, Tu), bars, sections and rows, and live
  // rates measured from the running totals the logistics keep on each
  // destination (receivedTotal, receivedFrom).
  const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const fmt = value => numberFormat.format(Number.isFinite(value) ? Math.round(value) : 0);
  const SCALES = ['', 'k', 'M', 'G', 'T'];
  function units(value, suffix = '') {
    let amount = Number.isFinite(value) ? Math.max(0, value) : 0, scale = 0;
    while (Math.round(amount) >= 1000 && scale < SCALES.length - 1) { amount /= 1000; scale++; }
    return `${fmt(amount)} ${SCALES[scale]}u${suffix}`;
  }
  const perMinute = value => units(value, '/min');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // Builders writing into one panel body.
  function builders(document, body) {
    const element = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    // A bar from 0 to max, with an optional marker (what is required).
    function bar(value, max, marker = null, tone = '') {
      const track = element('div', `colony-bar ${tone}`);
      const fill = element('i');
      fill.style.width = `${clamp(max > 0 ? value / max * 100 : 0, 0, 100)}%`;
      track.append(fill);
      if (marker !== null && max > 0) {
        const tick = element('b'); tick.style.left = `${clamp(marker / max * 100, 0, 100)}%`; track.append(tick);
      }
      return track;
    }
    function section(title) {
      const node = element('section', 'colony-section');
      node.append(element('h3', '', title));
      body.append(node);
      return node;
    }
    function row(parent, label, value, detail = '') {
      const line = element('div', 'colony-row');
      line.append(element('span', '', label), element('strong', '', value));
      if (detail) line.append(element('small', '', detail));
      parent.append(line);
      return line;
    }
    return { element, bar, section, row };
  }

  // Rates per minute over the last `windowSeconds` of simulation time, per
  // resource and per source. Sample on every refresh, even while closed, so
  // rates are ready when a panel opens; a new building starts afresh.
  function rateTracker(windowSeconds = 30) {
    let sampledId = null, samples = [];
    function sample(state, building) {
      if (sampledId !== building.id) { samples = []; sampledId = building.id; }
      const time = state.simulation?.time ?? 0;
      samples.push({ time, totals: { ...(building.receivedTotal || {}) },
        sources: JSON.parse(JSON.stringify(building.receivedFrom || {})) });
      while (samples.length > 2 && time - samples[0].time > windowSeconds) samples.shift();
      const first = samples[0], span = time - first.time;
      const rate = (now, then) => span > 1 ? (now - then) / span * 60 : 0;
      const resources = {};
      for (const [id, total] of Object.entries(building.receivedTotal || {})) resources[id] = rate(total, first.totals[id] || 0);
      const sources = {};
      for (const [sourceId, totals] of Object.entries(building.receivedFrom || {})) {
        sources[sourceId] = Object.fromEntries(Object.entries(totals).map(([id, total]) =>
          [id, rate(total, first.sources[sourceId]?.[id] || 0)]));
      }
      return { resources, sources, span };
    }
    return { sample, reset: () => { sampledId = null; samples = []; } };
  }

  root.OrbitPanelKit = Object.freeze({ fmt, units, perMinute, clamp, builders, rateTracker });
})(globalThis);
