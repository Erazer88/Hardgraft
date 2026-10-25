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
  assert.equal(settings.get('showSurfaceRoads'), true);
  assert.equal(settings.get('showSurfaceHouses'), true);
  assert.equal(settings.get('depositMarkerSizePercent'), 100);
  assert.equal(settings.get('infiniteMinerals'), false);
  assert.equal(settings.definitions.find(definition => definition.id === 'showSurfaceRoads').type, 'checkbox');
  assert.equal(settings.definitions.find(definition => definition.id === 'showSurfaceHouses').type, 'checkbox');
  assert.equal(settings.definitions.find(definition => definition.id === 'infiniteMinerals').type, 'checkbox');
  assert.deepEqual(Array.from(settings.definitions)
    .filter(definition => definition.id.endsWith('Color') && definition.id.startsWith('deposit'))
    .map(definition => definition.id).sort(), [
    'depositCarbonColor', 'depositCopperColor', 'depositIronColor', 'depositOilColor', 'depositSiliconColor'
  ]);
});

test('contour color and opacity controls are described for every zoom level', () => {
  const { settings } = loadSettings();
  const color = settings.definitions.find(definition => definition.id === 'overviewContourColor');
  const opacity = settings.definitions.find(definition => definition.id === 'overviewContourOpacity');
  assert.equal(settings.get('overviewContourColor'), '#ffffff');
  assert.equal(settings.get('overviewContourOpacity'), 0);
  assert.equal(color.group, 'Courbes de relief');
  assert.equal(opacity.group, color.group);
  assert.match(color.help, /toutes les échelles/);
  assert.match(opacity.help, /toutes les échelles/);
});

test('simulation speed offers deterministic x1, x2, x5 and x10 values and resets to normal', () => {
  const { settings } = loadSettings();
  const speed = settings.definitions.find(definition => definition.id === 'simulationSpeed');
  assert.equal(speed.type, 'select');
  assert.equal(speed.group, 'Simulation');
  assert.deepEqual(Array.from(speed.options, option => [option.value, option.label]), [
    [1, 'x1'], [2, 'x2'], [5, 'x5'], [10, 'x10']
  ]);
  assert.equal(settings.get('simulationSpeed'), 1);
  assert.equal(settings.set('simulationSpeed', '5'), 5);
  assert.equal(settings.get('simulationSpeed'), 5);
  settings.reset();
  assert.equal(settings.get('simulationSpeed'), 1);
});

test('deposit size and colors validate, persist, notify controls, and reset to defaults', () => {
  const { settings, readStored } = loadSettings();
  const changes = [];
  settings.subscribe((id, value) => changes.push([id, value]));

  assert.equal(settings.set('depositMarkerSizePercent', 300), 200);
  assert.equal(settings.set('depositIronColor', '#F012aB'), '#f012ab');
  assert.equal(settings.set('depositSiliconColor', 'blue'), '#58efff');
  assert.equal(settings.set('infiniteMinerals', true), true);
  assert.equal(settings.set('showSurfaceRoads', false), false);
  assert.equal(settings.set('showSurfaceHouses', false), false);
  assert.deepEqual(changes, [['depositMarkerSizePercent', 200], ['depositIronColor', '#f012ab'],
    ['infiniteMinerals', true], ['showSurfaceRoads', false], ['showSurfaceHouses', false]]);
  assert.equal(readStored().depositMarkerSizePercent, 200);
  assert.equal(readStored().depositIronColor, '#f012ab');
  assert.equal(readStored().infiniteMinerals, true);
  assert.equal(readStored().showSurfaceRoads, false);
  assert.equal(readStored().showSurfaceHouses, false);

  settings.reset();
  assert.equal(settings.get('depositMarkerSizePercent'), 100);
  assert.equal(settings.get('depositIronColor'), '#ffdb45');
  assert.equal(settings.get('infiniteMinerals'), false);
  assert.equal(settings.get('showSurfaceRoads'), true);
  assert.equal(settings.get('showSurfaceHouses'), true);
  assert.equal(readStored().depositMarkerSizePercent, 100);
  assert.equal(readStored().infiniteMinerals, false);
  assert.equal(readStored().showSurfaceRoads, true);
  assert.equal(readStored().showSurfaceHouses, true);
  assert.deepEqual(changes.slice(-12).map(([id]) => id).sort(), [
    'depositCarbonColor', 'depositCopperColor', 'depositIronColor', 'depositMarkerSizePercent', 'depositOilColor',
    'depositSiliconColor', 'infiniteMinerals', 'overviewContourColor', 'overviewContourOpacity',
    'showSurfaceHouses', 'showSurfaceRoads', 'simulationSpeed'
  ].sort());
});
