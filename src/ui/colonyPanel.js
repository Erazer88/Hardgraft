(function (root) {
  'use strict';

  // The colony's own menu: population and tiers, what the current tier still
  // needs and how fast it arrives, the flows it requires, its reserve, the
  // buildings supplying it, its zone and power. Rates are measured from the
  // running totals the logistics keep on the colony (receivedTotal and
  // receivedFrom), as a moving average over the last 30 s of simulation time.
  const Kit = root.OrbitPanelKit;
  const { fmt, units, perMinute } = Kit;
  // Whole numbers only; the panel redraws every REDRAW_MS so values stay readable.
  // The current tier's quantities are not flows: they follow every refresh.
  const REDRAW_MS = 5000;

  function create(document, { onRename = () => {}, onClose = () => {} } = {}) {
    const $ = id => document.getElementById(id);
    const panel = $('colony-panel'), body = $('colony-panel-body'), nameInput = $('colony-panel-name');
    // Samples are taken on every refresh, even while the panel is closed, so
    // rates are ready when it opens.
    let colonyId = null;
    const tracker = Kit.rateTracker(30);
    // The quantity rows of the tier on screen, updated between redraws.
    let quantities = [], renderedTier = null;

    const resourceName = id => root.OrbitResourceData.get(id)?.label || id;
    const { element, bar, section, row } = Kit.builders(document, body);
    const rates = (state, building) => tracker.sample(state, building);

    function render(state) {
      const building = state.surfaceBuildings.find(candidate => candidate.id === colonyId);
      if (!building) { close(); return; }
      const Colony = root.OrbitColony, Data = root.OrbitColonyData;
      const colony = Colony.normalize(building.colony), tier = Data.tiers[colony.tier];
      const live = rates(state, building);
      if (document.activeElement !== nameInput) nameInput.value = building.customName || '';
      body.replaceChildren();
      quantities = []; renderedTier = colony.tier;

      // Population and tiers, as a track of steps.
      const people = section('POPULATION');
      const steps = element('div', 'colony-steps');
      const levels = [Data.startingPopulation, ...Data.tiers.map(item => item.population)];
      levels.forEach((population, index) => {
        const step = element('div', index < colony.tier + 1 ? 'reached' : index === colony.tier + 1 ? 'next' : '');
        step.append(element('b', '', fmt(population)), element('small', '', index ? `PALIER ${index}` : 'DÉPART'));
        steps.append(step);
      });
      people.append(steps);
      row(people, 'HABITANTS', `${fmt(colony.population)}`, tier ? `prochain palier : ${fmt(tier.population)}` : 'tous les paliers atteints');
      row(people, 'CONTEXTE', `${fmt(Math.floor(state.contextPoints || 0))}`, `+${fmt(Data.contextPerMinute)}/min`);

      // What the current tier still needs, with its incoming rate and an estimate.
      if (tier) {
        const needs = section(`PALIER ${colony.tier + 1} · ${Object.keys(tier.needs).length ? 'QUANTITÉS' : 'OBJECTIF'}`);
        const flowsMet = Colony.flowsMet(colony);
        // Buildings the tier asks for, with the progress of their site.
        for (const [type, standing] of Object.entries(Colony.requirements(state, building, tier))) {
          const label = root.OrbitBuildingData.get(type)?.label || type;
          const site = state.surfaceBuildings.find(candidate => candidate.type === type && candidate.planetId === building.planetId &&
            candidate.constructionState !== 'complete');
          const supply = site && root.OrbitConstruction ? root.OrbitConstruction.supplyFraction(site) : 0;
          row(needs, label, standing ? 'ASSEMBLÉ' : site ? `CHANTIER ${fmt(supply * 100)} %` : 'À CONSTRUIRE',
            standing ? '' : site ? 'ses ressources arrivent par route' : 'à poser et alimenter par route');
          needs.append(bar(standing ? 1 : supply, 1, null, 'gold'));
        }
        for (const [id, amount] of Object.entries(tier.needs)) {
          const done = colony.progress[id] || 0, rate = live.resources[id] || 0, left = amount - done;
          const eta = !flowsMet ? 'bloqué : flux en retard' : rate > .05 ? `≈ ${fmt(Math.max(1, left / rate))} min restantes` : 'aucune arrivée récente';
          const line = row(needs, resourceName(id), `${units(done)} / ${units(amount)}`, `${perMinute(rate)} reçus · ${eta}`);
          const track = bar(done, amount, null, 'gold');
          needs.append(track);
          quantities.push({ id, amount, value: line.querySelector('strong'), fill: track.firstChild });
        }
        const flows = Object.entries(Colony.flows(colony.tier));
        if (flows.length) {
          const required = section(`FLUX REQUIS · ${flowsMet ? 'TENUS' : 'EN RETARD'}`);
          for (const [id, rate] of flows) {
            const incoming = live.resources[id] || 0, owed = colony.owed[id] || 0;
            row(required, resourceName(id), `${perMinute(incoming)} / ${perMinute(rate)}`,
              owed >= rate ? `en retard de ${units(owed)}` : 'tenu');
            required.append(bar(incoming, Math.max(rate * 2, incoming), rate, owed >= rate ? 'late' : 'ok'));
          }
          required.append(element('p', 'colony-note', 'Les quantités n’avancent que si chaque flux a moins d’une minute de retard.'));
        }
      }

      // What arrives now, and from where.
      const incoming = section('ARRIVÉES · MOYENNE SUR 30 S');
      const arriving = Object.entries(live.resources).filter(([, rate]) => rate > .05).sort((a, b) => b[1] - a[1]);
      if (!arriving.length) incoming.append(element('p', 'colony-note', live.span < 5 ? 'Mesure en cours…' : 'Rien n’arrive pour l’instant.'));
      for (const [id, rate] of arriving) row(incoming, resourceName(id), perMinute(rate));
      const suppliers = Object.entries(live.sources).map(([sourceId, perResource]) => {
        const source = state.surfaceBuildings.find(candidate => candidate.id === sourceId);
        const total = Object.values(perResource).reduce((sum, rate) => sum + rate, 0);
        return { source, perResource, total };
      }).filter(item => item.source && item.total > .05).sort((a, b) => b.total - a.total);
      if (suppliers.length) {
        const from = section('FOURNISSEURS');
        for (const { source, perResource } of suppliers) {
          row(from, source.customName || source.type, Object.entries(perResource).filter(([, rate]) => rate > .05)
            .map(([id, rate]) => `${resourceName(id)} ${perMinute(rate)}`).join(' · '));
        }
      }

      // Reserve waiting for a later tier.
      const reserve = section('RÉSERVE');
      const stock = Object.entries(building.inventory || {}).filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]);
      if (!stock.length) reserve.append(element('p', 'colony-note', 'Tout ce qui arrive est consommé.'));
      for (const [id, amount] of stock) row(reserve, resourceName(id), units(amount));
      row(reserve, 'CONSOMMÉ AU TOTAL', units(colony.consumed));

      // Zone and power.
      const ground = section('TERRITOIRE ET ÉNERGIE');
      const cellKm2 = (root.OrbitConfig?.terrain?.textureScale || 3) ** 2;
      const area = colony.cells.length * cellKm2, target = Colony.targetCells(colony, cellKm2) * cellKm2;
      row(ground, 'ZONE', `${fmt(area)} km²`, `cible ${fmt(target)} km² · maximum ${fmt(Data.zone.maxKm2)} km²`);
      ground.append(bar(area, Data.zone.maxKm2, target, 'gold'));
      const generator = root.OrbitBuildingData.get('colony')?.generatorMW || 0;
      const power = state.powerStatus?.[building.planetId];
      row(ground, 'GÉNÉRATEUR', `${fmt(generator)} MW`);
      if (power) {
        const supply = Number.isFinite(power.supplyMW) ? power.supplyMW : power.demandMW;
        row(ground, 'PLANÈTE', `${fmt(power.demandMW)} / ${Number.isFinite(power.supplyMW) ? fmt(power.supplyMW) : '∞'} MW`,
          power.demandMW > supply ? 'demande supérieure à la production' : 'production suffisante');
        ground.append(bar(power.demandMW, Math.max(supply, power.demandMW), supply, power.demandMW > supply ? 'late' : 'ok'));
      }
    }

    // Quick update of the tier's quantities; a new tier needs a full redraw.
    function updateQuantities(building) {
      const colony = root.OrbitColony.normalize(building.colony);
      if (colony.tier !== renderedTier) return false;
      for (const { id, amount, value, fill } of quantities) {
        const done = colony.progress[id] || 0;
        value.textContent = `${units(done)} / ${units(amount)}`;
        fill.style.width = `${Kit.clamp(amount > 0 ? done / amount * 100 : 0, 0, 100)}%`;
      }
      return true;
    }

    function open(building, state) {
      colonyId = building.id;
      panel.hidden = false;
      renderedAt = performance.now();
      render(state);
    }

    function close() {
      if (panel.hidden) return;
      panel.hidden = true; colonyId = null;
      onClose();
    }

    let renderedAt = 0;
    function refresh(state) {
      if (!panel.hidden) {
        const now = performance.now();
        if (now - renderedAt >= REDRAW_MS) { renderedAt = now; render(state); }
        else {
          const building = state.surfaceBuildings.find(candidate => candidate.id === colonyId);
          if (!building) close();
          else if (updateQuantities(building)) rates(state, building);
          else { renderedAt = now; render(state); }
        }
        return;
      }
      const building = (state.surfaceBuildings || []).find(candidate => candidate.type === 'colony');
      if (!building) return;
      rates(state, building);
    }

    $('colony-panel-close').addEventListener('click', close);
    nameInput.addEventListener('change', () => { if (colonyId) onRename(colonyId, nameInput.value); });
    nameInput.addEventListener('keydown', event => { if (event.key === 'Enter') nameInput.blur(); });
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });

    return Object.freeze({ open, close, refresh, isOpen: () => !panel.hidden });
  }

  root.OrbitColonyPanel = Object.freeze({ create });
})(globalThis);
