(function (root) {
  'use strict';

  // The colony's own menu: population and tiers, what the current tier still
  // needs and how fast it arrives, the flows it requires, its reserve, the
  // buildings supplying it, its zone and power. Rates are measured from the
  // running totals the logistics keep on the colony (receivedTotal and
  // receivedFrom), over the last minute of simulation time.
  const WINDOW_SECONDS = 60;
  const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const fmt = value => numberFormat.format(Number.isFinite(value) ? value : 0);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function create(document, { onRename = () => {}, onClose = () => {} } = {}) {
    const $ = id => document.getElementById(id);
    const panel = $('colony-panel'), body = $('colony-panel-body'), nameInput = $('colony-panel-name');
    // Samples are taken on every refresh, even while the panel is closed, so
    // rates are ready when it opens.
    let colonyId = null, sampledId = null, samples = [];

    const resourceName = id => root.OrbitResourceData.get(id)?.label || id;
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

    // Live rates per minute, per resource and per source, over the window.
    function rates(state, building) {
      const time = state.simulation?.time ?? 0;
      samples.push({ time, totals: { ...(building.receivedTotal || {}) },
        sources: JSON.parse(JSON.stringify(building.receivedFrom || {})) });
      while (samples.length > 2 && time - samples[0].time > WINDOW_SECONDS) samples.shift();
      const first = samples[0], span = time - first.time;
      const perMinute = (now, then) => span > 1 ? (now - then) / span * 60 : 0;
      const resources = {};
      for (const [id, total] of Object.entries(building.receivedTotal || {})) resources[id] = perMinute(total, first.totals[id] || 0);
      const sources = {};
      for (const [sourceId, totals] of Object.entries(building.receivedFrom || {})) {
        sources[sourceId] = Object.fromEntries(Object.entries(totals).map(([id, total]) =>
          [id, perMinute(total, first.sources[sourceId]?.[id] || 0)]));
      }
      return { resources, sources, span };
    }

    function render(state) {
      const building = state.surfaceBuildings.find(candidate => candidate.id === colonyId);
      if (!building) { close(); return; }
      const Colony = root.OrbitColony, Data = root.OrbitColonyData;
      const colony = Colony.normalize(building.colony), tier = Data.tiers[colony.tier];
      const live = rates(state, building);
      if (document.activeElement !== nameInput) nameInput.value = building.customName || '';
      body.replaceChildren();

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
      row(people, 'CONTEXTE', `${fmt(Math.floor(state.contextPoints || 0))}`, `+${fmt(Data.contextPerMinute)} / min`);

      // What the current tier still needs, with its incoming rate and an estimate.
      if (tier) {
        const needs = section(`PALIER ${colony.tier + 1} · QUANTITÉS`);
        const flowsMet = Colony.flowsMet(colony);
        for (const [id, amount] of Object.entries(tier.needs)) {
          const done = colony.progress[id] || 0, rate = live.resources[id] || 0, left = amount - done;
          const eta = !flowsMet ? 'bloqué : flux en retard' : rate > .05 ? `≈ ${fmt(left / rate)} min restantes` : 'aucune arrivée récente';
          row(needs, resourceName(id), `${fmt(done)} / ${fmt(amount)}`, `${fmt(rate)} / min reçus · ${eta}`);
          needs.append(bar(done, amount, null, 'gold'));
        }
        const flows = Object.entries(Colony.flows(colony.tier));
        if (flows.length) {
          const required = section(`FLUX REQUIS · ${flowsMet ? 'TENUS' : 'EN RETARD'}`);
          for (const [id, rate] of flows) {
            const incoming = live.resources[id] || 0, owed = colony.owed[id] || 0;
            row(required, resourceName(id), `${fmt(incoming)} / ${fmt(rate)} par min`,
              owed >= rate ? `en retard de ${fmt(owed)} u` : 'tenu');
            required.append(bar(incoming, Math.max(rate * 2, incoming), rate, owed >= rate ? 'late' : 'ok'));
          }
          required.append(element('p', 'colony-note', 'Les quantités n’avancent que si chaque flux a moins d’une minute de retard.'));
        }
      }

      // What arrives now, and from where.
      const incoming = section('ARRIVÉES · DERNIÈRE MINUTE');
      const arriving = Object.entries(live.resources).filter(([, rate]) => rate > .05).sort((a, b) => b[1] - a[1]);
      if (!arriving.length) incoming.append(element('p', 'colony-note', live.span < 5 ? 'Mesure en cours…' : 'Rien n’arrive pour l’instant.'));
      for (const [id, rate] of arriving) row(incoming, resourceName(id), `${fmt(rate)} / min`);
      const suppliers = Object.entries(live.sources).map(([sourceId, perResource]) => {
        const source = state.surfaceBuildings.find(candidate => candidate.id === sourceId);
        const total = Object.values(perResource).reduce((sum, rate) => sum + rate, 0);
        return { source, perResource, total };
      }).filter(item => item.source && item.total > .05).sort((a, b) => b.total - a.total);
      if (suppliers.length) {
        const from = section('FOURNISSEURS');
        for (const { source, perResource } of suppliers) {
          row(from, source.customName || source.type, Object.entries(perResource).filter(([, rate]) => rate > .05)
            .map(([id, rate]) => `${resourceName(id)} ${fmt(rate)}/min`).join(' · '));
        }
      }

      // Reserve waiting for a later tier.
      const reserve = section('RÉSERVE');
      const stock = Object.entries(building.inventory || {}).filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]);
      if (!stock.length) reserve.append(element('p', 'colony-note', 'Tout ce qui arrive est consommé.'));
      for (const [id, amount] of stock) row(reserve, resourceName(id), `${fmt(amount)} u`);
      row(reserve, 'CONSOMMÉ AU TOTAL', `${fmt(colony.consumed)} u`);

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

    function open(building, state) {
      if (sampledId !== building.id) { samples = []; sampledId = building.id; }
      colonyId = building.id;
      panel.hidden = false;
      render(state);
    }

    function close() {
      if (panel.hidden) return;
      panel.hidden = true; colonyId = null;
      onClose();
    }

    function refresh(state) {
      if (!panel.hidden) { render(state); return; }
      const building = (state.surfaceBuildings || []).find(candidate => candidate.type === 'colony');
      if (!building) return;
      if (sampledId !== building.id) { samples = []; sampledId = building.id; }
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
