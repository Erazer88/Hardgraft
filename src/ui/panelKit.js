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

  // One list of what arrives: per resource, its rate and the buildings
  // sending it (from a rateTracker sample).
  function arrivals(live, state, resourceName) {
    return Object.entries(live.resources).filter(([, rate]) => rate > .05).sort((a, b) => b[1] - a[1]).map(([id, rate]) => ({
      id, label: resourceName(id), rate,
      from: Object.entries(live.sources).filter(([, perResource]) => (perResource[id] || 0) > .05)
        .map(([sourceId]) => state.surfaceBuildings.find(candidate => candidate.id === sourceId)?.customName).filter(Boolean)
    }));
  }

  // A small header badge of a building type (drawn once per canvas).
  function badge(canvas, type) {
    if (!canvas || canvas.dataset.type === type) return;
    canvas.dataset.type = type;
    root.OrbitBuildingRenderer?.drawBadge(canvas, type);
  }

  // A full-width line of a building's menu: an arrow in (blue) or out
  // (amber), or a box for a stock; the resource, the buildings or a note,
  // and a value on the right.
  const LINE_ICONS = { in: 'M20 12H5M11 6l-6 6 6 6', out: 'M4 12h15M13 6l6 6-6 6',
    stock: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8' };
  function line(document, kind, title, detail = '', value = '') {
    const node = document.createElement('div'); node.className = `flow-line ${kind}`;
    node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${LINE_ICONS[kind]}"/></svg>`;
    const text = document.createElement('div'); text.className = 'flow-line-text';
    const name = document.createElement('strong'); name.textContent = title; text.append(name);
    if (detail) { const note = document.createElement('span'); note.textContent = detail; text.append(note); }
    node.append(text);
    if (value) { const amount = document.createElement('b'); amount.textContent = value; node.append(amount); }
    return node;
  }

  root.OrbitPanelKit = Object.freeze({ fmt, units, perMinute, clamp, builders, rateTracker, arrivals, badge, line });
})(globalThis);
