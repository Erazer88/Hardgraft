(function (root) {
  'use strict';

  // The hub's own menu (launch platform), opened like the colony's. On its
  // site: what it still waits for, how fast each material arrives (30 s
  // moving average) and who sends it. Assembled: the next freight (a loading
  // bar to its launch, the units on board) and the last one. Redrawn every
  // REDRAW_MS; the delivered quantities and the loading bar follow every
  // refresh.
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
    let hubId = null, renderedAt = 0, renderedState = null, quantities = [], loading = null;

    const find = state => state.surfaceBuildings.find(candidate => candidate.id === hubId);

    function render(state) {
      const building = find(state);
      if (!building) { close(); return; }
      const definition = root.OrbitBuildingData.get(building.type);
      const live = tracker.sample(state, building);
      if (document.activeElement !== nameInput) nameInput.value = building.customName || '';
      body.replaceChildren();
      quantities = []; loading = null; renderedState = building.constructionState;

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
        // One freight a minute to the Ark, with all the hub holds.
        const exportSection = section('VERS L’ARCHE');
        const status = root.OrbitLogistics.platformStatus(state, building, getSystem(building), state.simulation.time);
        const next = row(exportSection, 'Prochain fret', '', '');
        const track = bar(0, 1, null, 'gold loading');
        exportSection.append(track);
        const last = row(exportSection, 'Dernier fret', '', '');
        loading = { status, next, fill: track.firstChild, last };
        updateLoading(state, building);
      }

      // What arrives now (30 s average), and who sends it.
      const incoming = section('ARRIVÉES');
      const list = Kit.arrivals(live, state, resourceName);
      if (!list.length) incoming.append(element('p', 'colony-note', live.span < 5 ? 'Mesure en cours…' : 'Rien n’arrive pour l’instant.'));
      for (const item of list) incoming.append(Kit.line(document, 'in', item.label, item.from.join(', '), perMinute(item.rate)));
    }

    // The loading bar: time left to the launch, units on board, the last freight.
    function updateLoading(state, building) {
      if (!loading) return;
      const time = state.simulation.time;
      const metrics = root.OrbitOrbitalTransit.currentPlatformMetrics(state, building.id, time);
      const aboard = Object.values(building.launchStock || {}).reduce((sum, amount) => sum + Math.max(0, Math.floor(amount)), 0);
      const blocked = ['PAS DE HUB', 'PAS DE CONNEXION', 'AUCUN FLUX ASSIGNÉ'].includes(loading.status);
      loading.next.querySelector('strong').textContent = `dans ${fmt(Math.max(0, Math.ceil(metrics.nextLaunchTime - time)))} s`;
      const detail = [aboard ? `${units(aboard)} à bord` : 'soute vide', blocked ? loading.status.toLowerCase() : ''].filter(Boolean).join(' · ');
      let note = loading.next.querySelector('small');
      if (!note) { note = document.createElement('small'); loading.next.append(note); }
      note.textContent = detail;
      loading.fill.style.width = `${Math.round(metrics.loading * 1000) / 10}%`;
      loading.last.querySelector('strong').textContent = metrics.last ? units(metrics.last.amount) : '—';
      let lastNote = loading.last.querySelector('small');
      if (!lastNote) { lastNote = document.createElement('small'); loading.last.append(lastNote); }
      lastNote.textContent = metrics.last ? `parti il y a ${fmt(Math.max(0, Math.floor(time - metrics.last.time)))} s` : 'aucun depuis une minute';
    }

    // Quick update of the delivered quantities; a change of state redraws.
    function updateQuantities(state, building) {
      if (building.constructionState !== renderedState) return false;
      updateLoading(state, building);
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
      if (now - renderedAt >= REDRAW_MS || !updateQuantities(state, building)) { renderedAt = now; render(state); }
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
