'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadSettings(initialValue = null) {
  let stored = initialValue;
  const context = vm.createContext({ localStorage: {
    getItem: () => stored,
    setItem: (_, value) => { stored = value; }
  } });
  vm.runInContext(readFileSync(resolve(__dirname, '../src/data/developerSettings.js'), 'utf8'), context);
  return { settings: context.OrbitDeveloperSettings, readStored: () => JSON.parse(stored) };
}

test('developer settings add deposit controls without discarding saved contour preferences', () => {
  const { settings } = loadSettings('{"overviewContourColor":"#abcdef","overviewContourOpacity":42}');
  assert.equal(settings.get('overviewContourColor'), '#abcdef');
  assert.equal(settings.get('overviewContourOpacity'), 42);
  assert.equal(settings.get('depositMarkerSizePx'), 32);
  assert.deepEqual(Array.from(settings.definitions)
    .filter(definition => definition.id.endsWith('Color') && definition.id.startsWith('deposit'))
    .map(definition => definition.id).sort(), [
    'depositCarbonColor', 'depositCopperColor', 'depositIronColor', 'depositOilColor', 'depositSiliconColor'
  ]);
});

test('deposit size and colors validate, persist, notify controls, and reset to defaults', () => {
  const { settings, readStored } = loadSettings();
  const changes = [];
  settings.subscribe((id, value) => changes.push([id, value]));

  assert.equal(settings.set('depositMarkerSizePx', 200), 64);
  assert.equal(settings.set('depositIronColor', '#F012aB'), '#f012ab');
  assert.equal(settings.set('depositSiliconColor', 'blue'), '#58efff');
  assert.deepEqual(changes, [['depositMarkerSizePx', 64], ['depositIronColor', '#f012ab']]);
  assert.equal(readStored().depositMarkerSizePx, 64);
  assert.equal(readStored().depositIronColor, '#f012ab');

  settings.reset();
  assert.equal(settings.get('depositMarkerSizePx'), 32);
  assert.equal(settings.get('depositIronColor'), '#ffdb45');
  assert.equal(readStored().depositMarkerSizePx, 32);
  assert.deepEqual(changes.slice(-8).map(([id]) => id).sort(), [
    'depositCarbonColor', 'depositCopperColor', 'depositIronColor', 'depositMarkerSizePx', 'depositOilColor',
    'depositSiliconColor', 'overviewContourColor', 'overviewContourOpacity'
  ].sort());
});
