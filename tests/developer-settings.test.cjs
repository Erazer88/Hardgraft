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

test('developer settings expose only active gameplay prototype controls', () => {
  const { settings } = loadSettings();
  assert.deepEqual(Array.from(settings.definitions, item => item.id).sort(), ['infiniteMinerals', 'simulationSpeed'].sort());
});

test('simulation speed offers deterministic x1, x2, x5 and x10 values and resets', () => {
  const { settings } = loadSettings();
  const speed = settings.definitions.find(definition => definition.id === 'simulationSpeed');
  assert.equal(speed.type, 'select');
  assert.deepEqual(Array.from(speed.options, option => [option.value, option.label]), [
    [1, 'x1'], [2, 'x2'], [5, 'x5'], [10, 'x10']
  ]);
  assert.equal(settings.get('simulationSpeed'), 1);
  assert.equal(settings.set('simulationSpeed', '5'), 5);
  assert.equal(settings.get('simulationSpeed'), 5);
  settings.reset();
  assert.equal(settings.get('simulationSpeed'), 1);
});

test('infinite prototype minerals validate, persist, notify listeners, and reset', () => {
  const { settings, readStored } = loadSettings();
  const changes = [];
  settings.subscribe((id, value) => changes.push([id, value]));
  assert.equal(settings.get('infiniteMinerals'), false);
  assert.equal(settings.set('infiniteMinerals', true), true);
  assert.equal(settings.get('infiniteMinerals'), true);
  assert.equal(readStored().infiniteMinerals, true);
  assert.deepEqual(changes, [['infiniteMinerals', true]]);
  settings.reset();
  assert.equal(settings.get('infiniteMinerals'), false);
  assert.equal(readStored().infiniteMinerals, false);
});
