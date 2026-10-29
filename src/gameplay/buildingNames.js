(function (root) {
  'use strict';

  // Every building is named "Usine 1", "Usine 2"…: one counter per type for
  // the whole game, across planets. The player may rename any building.
  const Buildings = root.OrbitBuildingData;
  const MAX_LENGTH = 32;

  function baseName(type) {
    const label = (Buildings.get(type)?.label || 'Bâtiment').toLocaleLowerCase('fr-FR');
    return label.charAt(0).toLocaleUpperCase('fr-FR') + label.slice(1);
  }

  function nextName(state, type) {
    const counters = state.nameCounters ||= {};
    counters[type] = (counters[type] || 0) + 1;
    return `${baseName(type)} ${counters[type]}`;
  }

  // Names buildings that have none (older saves) and keeps each counter above
  // the numbers already used by default names.
  function ensureNames(state) {
    const counters = state.nameCounters ||= {};
    for (const building of state.surfaceBuildings || []) {
      const match = typeof building.customName === 'string' && building.customName.match(/^(.*) (\d+)$/);
      if (match && match[1] === baseName(building.type)) counters[building.type] = Math.max(counters[building.type] || 0, Number(match[2]));
    }
    for (const building of state.surfaceBuildings || []) if (!building.customName) building.customName = nextName(state, building.type);
  }

  // A cleaned name, or null if nothing usable was typed.
  function clean(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
    return text || null;
  }

  root.OrbitBuildingNames = Object.freeze({ baseName, nextName, ensureNames, clean, maxLength: MAX_LENGTH });
})(globalThis);
