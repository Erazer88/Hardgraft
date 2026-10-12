(function (root) {
  'use strict';

  const storageKey = 'nereide-atlas-dev-settings-v1';
  const definitions = Object.freeze([
    Object.freeze({
      id: 'overviewContourColor', type: 'color', group: 'Courbes au dézoom',
      label: 'Couleur des courbes', help: 'Teinte des lignes de relief visibles à moyenne et grande échelle.',
      defaultValue: '#e2e8ea'
    }),
    Object.freeze({
      id: 'overviewContourOpacity', type: 'range', group: 'Courbes au dézoom',
      label: 'Opacité', help: 'Intensité des courbes de relief éloignées.',
      defaultValue: 67, min: 0, max: 100, step: 1, unit: '%'
    }),
    Object.freeze({
      id: 'depositMarkerSizePercent', type: 'range', group: 'Gisements',
      label: 'Taille réelle', help: 'Emprise sur la carte. À l’écran, les gisements suivent le zoom comme le terrain.',
      defaultValue: 100, min: 25, max: 200, step: 5, unit: '%'
    }),
    Object.freeze({
      id: 'depositIronColor', type: 'color', group: 'Gisements',
      label: 'Fer', help: 'Couleur des hachures, du contour lumineux et du nom.',
      defaultValue: '#ffdb45'
    }),
    Object.freeze({
      id: 'depositCopperColor', type: 'color', group: 'Gisements',
      label: 'Cuivre', help: 'Couleur des hachures, du contour lumineux et du nom.',
      defaultValue: '#ff9d3d'
    }),
    Object.freeze({
      id: 'depositSiliconColor', type: 'color', group: 'Gisements',
      label: 'Silicium', help: 'Couleur des hachures, du contour lumineux et du nom.',
      defaultValue: '#58efff'
    }),
    Object.freeze({
      id: 'depositCarbonColor', type: 'color', group: 'Gisements',
      label: 'Carbone', help: 'Couleur des hachures, du contour lumineux et du nom.',
      defaultValue: '#c6f34a'
    }),
    Object.freeze({
      id: 'depositOilColor', type: 'color', group: 'Gisements',
      label: 'Pétrole', help: 'Couleur des hachures, du contour lumineux et du nom.',
      defaultValue: '#ffbd43'
    })
  ]);
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const listeners = new Set();

  function normalize(definition, value) {
    if (definition.type === 'color') {
      return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
        ? value.toLowerCase() : definition.defaultValue;
    }
    if (definition.type === 'range') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return definition.defaultValue;
      const step = definition.step || 1;
      const stepped = Math.round((numeric - definition.min) / step) * step + definition.min;
      return Math.max(definition.min, Math.min(definition.max, stepped));
    }
    if (definition.type === 'checkbox') return Boolean(value);
    if (definition.type === 'select') {
      return definition.options.find(option => String(option.value) === String(value))?.value ?? definition.defaultValue;
    }
    return definition.defaultValue;
  }

  function defaults() {
    return Object.fromEntries(definitions.map(definition => [definition.id, definition.defaultValue]));
  }

  function readStored() {
    try {
      const stored = JSON.parse(root.localStorage.getItem(storageKey) || '{}');
      return Object.fromEntries(definitions.map(definition => [
        definition.id,
        Object.prototype.hasOwnProperty.call(stored, definition.id)
          ? normalize(definition, stored[definition.id]) : definition.defaultValue
      ]));
    } catch (_) {
      return defaults();
    }
  }

  let values = readStored();

  function save() {
    try { root.localStorage.setItem(storageKey, JSON.stringify(values)); }
    catch (_) { /* Developer preferences remain active for this session. */ }
  }

  function notify(id) {
    for (const listener of listeners) listener(id, values[id]);
  }

  const api = Object.freeze({
    definitions,
    get(id) { return values[id]; },
    set(id, value) {
      const definition = byId.get(id);
      if (!definition) return undefined;
      const normalized = normalize(definition, value);
      if (Object.is(values[id], normalized)) return normalized;
      values[id] = normalized;
      save();
      notify(id);
      return normalized;
    },
    reset() {
      values = defaults();
      save();
      for (const definition of definitions) notify(definition.id);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });

  root.OrbitDeveloperSettings = api;
})(globalThis);
