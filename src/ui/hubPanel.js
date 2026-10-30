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

  function create(document, { onRename = () => {}, onDemolish = () => {}, onSave = () => {}, onClose = () => {},
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

      // Where it stands: site, robots, or assembled.
      const status = section('ÉTAT');
      const supply = Construction.supplyFraction(building);
      const stateText = building.constructionState === 'supplying' ? `CHANTIER · ${fmt(supply * 100)} % LIVRÉ`
        : building.constructionState === 'constructing'
          ? building.status === 'queued' ? 'EN ATTENTE DES ROBOTS' : `ASSEMBLAGE ${fmt((building.constructionProgress || 0) * 100)} %`
          : 'ASSEMBLÉ';
      row(status, 'HUB', stateText, siteText(building) || '');
      status.append(bar(building.constructionState === 'complete' ? 1 : building.constructionState === 'supplying' ? supply
        : building.constructionProgress || 0, 1, null, 'gold'));

      if (building.constructionState === 'supplying') {
        // Each material still awaited, with its delivered share and pace.
        const needs = section('MATÉRIAUX À RECEVOIR');
        for (const [id, amount] of Object.entries(definition?.constructionNeeds || {})) {
          const done = Math.min(amount, building.constructionSupplied?.[id] || 0), rate = live.resources[id] || 0;
          const detail = done >= amount ? 'livré' : rate > .05
            ? `${perMinute(rate)} reçus · ≈ ${fmt(Math.max(1, (amount - done) / rate))} min restantes` : 'aucune arrivée récente';
          const line = row(needs, resourceName(id), `${units(done)} / ${units(amount)}`, detail);
          const track = bar(done, amount, null, done >= amount ? 'ok' : 'gold');
          needs.append(track);
          quantities.push({ id, amount, value: line.querySelector('strong'), fill: track.firstChild });
        }
        needs.append(element('p', 'colony-note', 'Choisissez ce hub comme destination dans les Docks de sortie : il ne prend que ce qui lui manque.'));
      }

      if (building.constructionState === 'complete') {
        // What waits to leave, and the launches to the Ark.
        const exportSection = section('EXPORT VERS L’ARCHE');
        const metrics = root.OrbitOrbitalTransit.currentPlatformMetrics(state, building.id, state.simulation.time);
        const launch = root.OrbitOrbitalLogisticsData.launch;
        row(exportSection, 'ÉTAT', root.OrbitLogistics.platformStatus(state, building, getSystem(building), state.simulation.time));
        row(exportSection, 'DÉBIT DE LANCEMENT', `${fmt(metrics.throughput * 60)} / ${fmt(launch.capacityUPerSecond * 60)} u/min`);
        exportSection.append(bar(metrics.throughput, launch.capacityUPerSecond, null, 'ok'));
        row(exportSection, 'ÉNERGIE', `${fmt((building.energyUse || 0) / 1e6)} / ${fmt(launch.energyMW)} MW`);
        const stock = Object.entries(building.launchStock || {}).filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]);
        const waiting = section('EN ATTENTE DE LANCEMENT');
        if (!stock.length) waiting.append(element('p', 'colony-note', 'Rien n’attend sur la plateforme.'));
        for (const [id, amount] of stock) row(waiting, resourceName(id), units(amount));
        const sent = Object.values(building.launchReceivedTotal || {}).reduce((sum, amount) => sum + amount, 0);
        row(waiting, 'REÇU AU TOTAL', units(sent));
      }

      // What arrives now, and from where.
      const incoming = section('ARRIVÉES · MOYENNE SUR 30 S');
      const arriving = Object.entries(live.resources).filter(([, rate]) => rate > .05).sort((a, b) => b[1] - a[1]);
      if (!arriving.length) incoming.append(element('p', 'colony-note', live.span < 5 ? 'Mesure en cours…' : 'Rien n’arrive pour l’instant.'));
      for (const [id, rate] of arriving) row(incoming, resourceName(id), perMinute(rate));
      const suppliers = Object.entries(live.sources).map(([sourceId, perResource]) => ({
        source: state.surfaceBuildings.find(candidate => candidate.id === sourceId), perResource,
        total: Object.values(perResource).reduce((sum, rate) => sum + rate, 0)
      })).filter(item => item.source && item.total > .05).sort((a, b) => b.total - a.total);
      if (suppliers.length) {
        const from = section('FOURNISSEURS');
        for (const { source, perResource } of suppliers) {
          row(from, source.customName || source.type, Object.entries(perResource).filter(([, rate]) => rate > .05)
            .map(([id, rate]) => `${resourceName(id)} ${perMinute(rate)}`).join(' · '));
        }
      }
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
    $('hub-panel-save').addEventListener('click', () => { if (hubId) onSave(hubId); });
    $('hub-panel-demolish').addEventListener('click', () => { if (hubId) onDemolish(hubId); });
    nameInput.addEventListener('change', () => { if (hubId) onRename(hubId, nameInput.value); });
    nameInput.addEventListener('keydown', event => { if (event.key === 'Enter') nameInput.blur(); });
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });

    return Object.freeze({ open, close, refresh, isOpen: () => !panel.hidden, openId: () => hubId });
  }

  root.OrbitHubPanel = Object.freeze({ create });
})(globalThis);
