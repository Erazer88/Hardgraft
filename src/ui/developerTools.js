(function (root) {
  'use strict';

  function create(document, options = {}) {
    const settings = root.OrbitDeveloperSettings;
    const $ = id => document.getElementById(id);
    const container = $('developer-options');
    const diagnostics = root.OrbitTerrainDiagnostics.create(document, options);
    const terrainTuner = root.OrbitTerrainTuner.create(document, options);
    const controls = new Map();
    const groups = new Map();

    function updateControl(id, value) {
      const entry = controls.get(id);
      if (!entry) return;
      if (entry.definition.type === 'checkbox') entry.input.checked = Boolean(value);
      else entry.input.value = String(value);
      if (entry.output) entry.output.value = `${value}${entry.definition.unit || ''}`;
    }

    for (const definition of settings.definitions) {
      let group = groups.get(definition.group);
      if (!group) {
        group = document.createElement('section');
        group.className = 'developer-option-group';
        const heading = document.createElement('h3');
        heading.textContent = definition.group;
        group.append(heading);
        groups.set(definition.group, group);
        container.append(group);
      }

      const row = document.createElement('div');
      row.className = 'developer-option';
      const copy = document.createElement('div');
      copy.className = 'developer-option-copy';
      const label = document.createElement('label');
      const input = document.createElement(definition.type === 'select' ? 'select' : 'input');
      const inputId = `developer-setting-${definition.id}`;
      input.id = inputId;
      if (definition.type !== 'select') input.type = definition.type;
      input.dataset.setting = definition.id;
      input.setAttribute('aria-label', definition.label);
      label.htmlFor = inputId;
      label.textContent = definition.label;
      const help = document.createElement('small');
      help.textContent = definition.help || '';
      copy.append(label, help);
      const control = document.createElement('div');
      control.className = 'developer-option-control';
      let output = null;
      if (definition.type === 'range') {
        input.min = String(definition.min);
        input.max = String(definition.max);
        input.step = String(definition.step || 1);
        output = document.createElement('output');
        output.htmlFor = inputId;
        control.append(input, output);
      } else if (definition.type === 'select') {
        for (const optionDefinition of definition.options) {
          const option = document.createElement('option');
          option.value = String(optionDefinition.value);
          option.textContent = optionDefinition.label;
          input.append(option);
        }
        control.append(input);
      } else {
        control.append(input);
      }
      input.addEventListener('input', () => {
        const value = settings.set(definition.id,
          definition.type === 'range' ? Number(input.value) : input.type === 'checkbox' ? input.checked : input.value);
        updateControl(definition.id, value);
      });
      row.append(copy, control);
      group.append(row);
      controls.set(definition.id, { definition, input, output });
      updateControl(definition.id, settings.get(definition.id));
    }

    $('terrain-diagnostics-open').addEventListener('click', () => {
      $('developer-dialog').close(); diagnostics.open();
    });
    $('terrain-tuner-open').addEventListener('click', () => {
      $('developer-dialog').close();
      options.onTerrainTuningOpen?.();
      terrainTuner.open();
    });
    $('developer-reset').addEventListener('click', () => settings.reset());
    settings.subscribe(updateControl);

    $('developer-tools-button').addEventListener('click', () => {
      $('menu-dialog').close();
      $('developer-dialog').showModal();
    });
    $('developer-tools-close').addEventListener('click', () => $('developer-dialog').close());

    return Object.freeze({ open: () => $('developer-dialog').showModal() });
  }

  root.OrbitDeveloperTools = Object.freeze({ create });
})(globalThis);
