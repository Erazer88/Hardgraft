(function (root) {
  'use strict';

  // A button in the top-right corner counts the current problems and opens a
  // drop-down list of them. An alert stays a few seconds after its cause ends,
  // so a problem on the edge does not blink. A building alert selects it.
  const HOLD_MS = 3000;
  const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const fmt = value => numberFormat.format(Number.isFinite(value) ? Math.round(value) : 0);

  function create(document, { onSelectBuilding = () => {} } = {}) {
    const $ = id => document.getElementById(id);
    const box = $('alerts'), toggle = $('alerts-toggle'), count = $('alerts-count'), listElement = $('alerts-list');
    const shown = new Map();
    let signature = '', open = false, lastCount = 0;

    const resourceName = id => root.OrbitResourceData.get(id)?.label || id;
    const resources = ids => ids.map(resourceName).join(', ');

    function describe(alert, state, planetName) {
      const building = alert.buildingId && state.surfaceBuildings.find(item => item.id === alert.buildingId);
      const name = building ? building.customName || root.OrbitBuildingData.get(building.type)?.label || building.type : '';
      if (alert.kind === 'power') {
        const share = alert.demandMW > 0 ? Math.round(alert.supplyMW / alert.demandMW * 100) : 0;
        return { title: 'ÉNERGIE INSUFFISANTE', place: planetName(alert.planetId),
          detail: `${fmt(alert.supplyMW)} MW produits pour ${fmt(alert.demandMW)} MW demandés : les machines tournent à ${share} %. Construisez une éolienne ou réduisez la demande.` };
      }
      if (alert.kind === 'dock') {
        return { title: 'DOCK SANS DESTINATION', place: name,
          detail: alert.resourceIds.length
            ? `${resources(alert.resourceIds)} : aucune destination choisie, la chaîne en amont est à l’arrêt.`
            : 'Un dock de sortie n’est relié à aucune carte ou n’a pas de destination.' };
      }
      return { title: 'FLUX DE LA COLONIE EN RETARD', place: name,
        detail: `${resources(alert.resourceIds)} : plus d’une minute de retard, le palier n’avance plus.` };
    }

    function render(alerts, state, planetName) {
      const items = alerts.map(alert => ({ alert, text: describe(alert, state, planetName) }));
      const next = JSON.stringify(items.map(({ alert, text }) => [alert.id, text]));
      if (next === signature) return;
      signature = next;
      listElement.replaceChildren(...items.map(({ alert, text }) => {
        const item = document.createElement('li');
        item.className = `alert-item ${alert.severity}`;
        if (alert.buildingId) item.dataset.buildingId = alert.buildingId;
        const title = document.createElement('strong'); title.textContent = text.title;
        const place = document.createElement('span'); place.textContent = text.place || '';
        const detail = document.createElement('p'); detail.textContent = text.detail;
        item.append(title, place, detail);
        return item;
      }));
    }

    function setOpen(value) {
      open = value && !box.hidden;
      listElement.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    }

    function update(state, { planetName = () => '' } = {}) {
      const now = performance.now();
      for (const alert of root.OrbitAlerts.list(state)) shown.set(alert.id, { alert, seen: now });
      for (const [id, entry] of shown) if (now - entry.seen > HOLD_MS) shown.delete(id);
      const alerts = [...shown.values()].map(entry => entry.alert)
        .sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1) || a.id.localeCompare(b.id));
      box.hidden = !alerts.length;
      if (!alerts.length) { setOpen(false); lastCount = 0; return; }
      count.textContent = String(alerts.length);
      box.classList.toggle('critical', alerts.some(alert => alert.severity === 'critical'));
      // A new problem makes the button pulse once.
      if (alerts.length > lastCount) { toggle.classList.remove('pulse'); void toggle.offsetWidth; toggle.classList.add('pulse'); }
      lastCount = alerts.length;
      render(alerts, state, planetName);
    }

    toggle.addEventListener('click', () => setOpen(!open));
    // A touch elsewhere closes the list.
    document.addEventListener('pointerdown', event => { if (open && !box.contains(event.target)) setOpen(false); });
    listElement.addEventListener('click', event => {
      const item = event.target.closest('[data-building-id]');
      if (!item) return;
      setOpen(false);
      onSelectBuilding(item.dataset.buildingId);
    });

    return Object.freeze({ update, close: () => setOpen(false), isOpen: () => open });
  }

  root.OrbitAlertsPanel = Object.freeze({ create });
})(globalThis);
