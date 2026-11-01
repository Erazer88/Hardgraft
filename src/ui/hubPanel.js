(function (root) {
  'use strict';

  // The hub's own menu (launch platform), opened like the colony's. On its
  // site: what it still waits for, how fast each material arrives (30 s
  // moving average) and who sends it. Assembled: what waits to leave for the
  // Ark, the launch rate, its power and state. Redrawn every REDRAW_MS; the
  // delivered quantities follow every refresh.
  const Kit = root.OrbitPanelKit;
  const { fmt, units, perMinute } = Kit;
  const REDRAW_MS = 5000;

  function create(document, { onRename = () => {}, onDemolish = () => {}, onClose = () => {},
    getSystem = () => null, siteText = () => '' } = {}) {
    const $ = id => document.getElementById(id);
    const panel = $('hub-panel'), body = $('hub-panel-body'), nameInput = $('hub-panel-name');
    const tracker = Kit.rateTracker(30);
    const { element, bar, section, row } = Kit.builders(document, body);
    const resourceName = id => root.OrbitResourceData.get(id)?.label || id;
    const Construction = root.OrbitConstruction;
    let hubId = null, renderedAt = 0, renderedState = null, quantities = [];

    const find = state => state.surfaceBuildings.find(candidate => candidate.id === hubId);

    function render(state) {
      const building = find(state);
      if (!building) { close(); return; }
      const definition = root.OrbitBuildingData.get(building.type);
      const live = tracker.sample(state, building);
      if (document.activeElement !== nameInput) nameInput.value = building.customName || '';
      body.replaceChildren();
      quantities = []; renderedState = building.constructionState;

      Kit.badge(document.getElementById('hub-panel-icon'), building.type);
      // Where it stands: site, robots, or assembled; its launch site.
      const supply = Construction.supplyFraction(building);
      const stateText = building.constructionState === 'supplying' ? `chantier · ${fmt(supply * 100)} % livré`
        : building.constructionState === 'constructing'
          ? building.status === 'queued' ? 'en attente des robots' : `assemblage ${fmt((building.constructionProgress || 0) * 100)} %`
          : 'assemblé';
      document.getElementById('hub-panel-meta').textContent = [stateText, siteText(building)].filter(Boolean).join(' · ');

      if (building.constructionState === 'supplying') {
        // Each material still awaited, with its delivered share and pace.
        const needs = section('MATÉRIAUX À RECEVOIR');
        for (const [id, amount] of Object.entries(definition?.constructionNeeds || {})) {
          const done = Math.min(amount, building.constructionSupplied?.[id] || 0), rate = live.resources[id] || 0;
          const detail = done >= amount ? 'livré' : rate > .05 ? `≈ ${fmt(Math.max(1, (amount - done) / rate))} min` : 'rien n’arrive';
          const line = row(needs, resourceName(id), `${units(done)} / ${units(amount)}`, detail);
          const track = bar(done, amount, null, done >= amount ? 'ok' : 'gold');
          needs.append(track);
          quantities.push({ id, amount, value: line.querySelector('strong'), fill: track.firstChild });
        }
        needs.append(element('p', 'colony-note', 'Choisissez ce hub comme destination dans les Docks de sortie.'));
      }

      if (building.constructionState === 'complete') {
        // The launches to the Ark, and what waits for them.
        const exportSection = section('VERS L’ARCHE');
        const metrics = root.OrbitOrbitalTransit.currentPlatformMetrics(state, building.id, state.simulation.time);
        const launch = root.OrbitOrbitalLogisticsData.launch;
        row(exportSection, 'Lancements', `${fmt(metrics.throughput * 60)} / ${fmt(launch.capacityUPerSecond * 60)} u/min`,
          root.OrbitLogistics.platformStatus(state, building, getSystem(building), state.simulation.time).toLowerCase());
        exportSection.append(bar(metrics.throughput, launch.capacityUPerSecond, null, 'ok'));
        for (const [id, amount] of Object.entries(building.launchStock || {}).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1])) {
          row(exportSection, resourceName(id), units(amount), 'en attente');
        }
      }

      // What arrives now (30 s average), and who sends it.
      const incoming = section('ARRIVÉES');
      const list = Kit.arrivals(live, state, resourceName);
      if (!list.length) incoming.append(element('p', 'colony-note', live.span < 5 ? 'Mesure en cours…' : 'Rien n’arrive pour l’instant.'));
      for (const item of list) row(incoming, item.label, perMinute(item.rate), item.from.length ? `← ${item.from.join(', ')}` : '');
    }

    // Quick update of the delivered quantities; a change of state redraws.
    function updateQuantities(building) {
      if (building.constructionState !== renderedState) return false;
      for (const { id, amount, value, fill } of quantities) {
        const done = Math.min(amount, building.constructionSupplied?.[id] || 0);
        value.textContent = `${units(done)} / ${units(amount)}`;
        fill.style.width = `${Kit.clamp(amount > 0 ? done / amount * 100 : 0, 0, 100)}%`;
      }
      return true;
    }

    function open(building, state) {
      hubId = building.id;
      panel.hidden = false;
      renderedAt = performance.now();
      render(state);
    }

    function close() {
      if (panel.hidden) return;
      panel.hidden = true; hubId = null;
      onClose();
    }

    function refresh(state) {
      if (panel.hidden) return;
      const building = find(state);
      if (!building) { close(); return; }
      const now = performance.now();
      if (now - renderedAt >= REDRAW_MS || !updateQuantities(building)) { renderedAt = now; render(state); }
      else tracker.sample(state, building);
    }

    $('hub-panel-close').addEventListener('click', close);
    $('hub-panel-demolish').addEventListener('click', () => { if (hubId) onDemolish(hubId); });
    nameInput.addEventListener('change', () => { if (hubId) onRename(hubId, nameInput.value); });
    nameInput.addEventListener('keydown', event => { if (event.key === 'Enter') nameInput.blur(); });
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });

    return Object.freeze({ open, close, refresh, isOpen: () => !panel.hidden, openId: () => hubId });
  }

  root.OrbitHubPanel = Object.freeze({ create });
})(globalThis);
