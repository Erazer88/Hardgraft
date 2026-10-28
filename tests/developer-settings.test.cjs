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

test('developer settings drop the removed relief contour preferences', () => {
  const { settings } = loadSettings('{"overviewContourColor":"#abcdef","overviewContourOpacity":42,"showSurfaceRoads":false}');
  assert.equal(settings.get('overviewContourColor'), undefined);
  assert.equal(settings.get('overviewContourOpacity'), undefined);
  assert.equal(settings.get('showSurfaceRoads'), false);
  assert.equal(settings.definitions.some(definition => definition.group === 'Courbes de relief'), false);
});

test('developer settings expose terrain display controls and drop the removed deposit settings', () => {
  const { settings } = loadSettings('{"depositMarkerSizePercent":150,"depositIronColor":"#abcdef"}');
  assert.equal(settings.get('showSurfaceRoads'), true);
  assert.equal(settings.get('showSurfaceHouses'), undefined, 'the house system is gone');
  assert.equal(settings.get('showGroundMaterials'), true);
  assert.equal(settings.get('infiniteMinerals'), false);
  assert.equal(settings.get('depositMarkerSizePercent'), undefined);
  assert.equal(settings.get('depositIronColor'), undefined);
  for (const id of ['showSurfaceRoads', 'showGroundMaterials', 'infiniteMinerals']) {
    assert.equal(settings.definitions.find(definition => definition.id === id).type, 'checkbox');
  }
  assert.equal(settings.definitions.some(definition => definition.id.startsWith('deposit')), false);
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

test('display and resource settings validate, persist, notify controls, and reset to defaults', () => {
  const { settings, readStored } = loadSettings();
  const changes = [];
  settings.subscribe((id, value) => changes.push([id, value]));

  assert.equal(settings.set('showGroundMaterials', false), false);
  assert.equal(settings.set('infiniteMinerals', true), true);
  assert.equal(settings.set('showSurfaceRoads', false), false);
  assert.deepEqual(changes, [['showGroundMaterials', false], ['infiniteMinerals', true],
    ['showSurfaceRoads', false]]);
  assert.equal(readStored().showGroundMaterials, false);
  assert.equal(readStored().infiniteMinerals, true);
  assert.equal(readStored().showSurfaceRoads, false);

  settings.reset();
  assert.equal(settings.get('showGroundMaterials'), true);
  assert.equal(settings.get('infiniteMinerals'), false);
  assert.equal(settings.get('showSurfaceRoads'), true);
  assert.equal(readStored().showGroundMaterials, true);
  assert.equal(readStored().infiniteMinerals, false);
  assert.deepEqual(changes.slice(-5).map(([id]) => id).sort(), [
    'infiniteMinerals', 'showGroundMaterials', 'showSurfaceRoads', 'simulationSpeed', 'unlockEverything'
  ].sort());
});
