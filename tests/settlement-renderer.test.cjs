'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadRenderer() {
  const context = vm.createContext({
    OrbitSettlementConfig: { render: {
      minZoom: 0, secondaryColor: '#ffffff', secondaryOpacity: 1, secondaryWidthPx: 1,
      houseWidthWorld: 10, districtWidthWorld: 18, spriteOpacity: 1, cullMarginPx: 5
    } },
    Image: class {
      constructor() { this.complete = true; this.naturalWidth = 4; this.naturalHeight = 4; }
      set src(value) { this.path = value; }
    }
  });
  vm.runInContext(readFileSync(resolve(__dirname, '../src/rendering/settlementRenderer.js'), 'utf8'), context);
  return context.OrbitSettlementRenderer;
}

function makeFrame(visibility = {}) {
  const counts = { strokes: 0, images: 0 };
  const road = { id: 'road-1', length: 30, builtLength: 30,
    points: [{ x: 10, y: 20 }, { x: 40, y: 20 }] };
  const frame = {
    zoom: 2,
    planet: { id: 'planet-1' },
    state: { roadNetworks: {}, surfaceSettlements: { 'planet-1': {
      roads: [road], districts: [{ roadId: road.id, roadDistance: 20,
        asset: 'village-crossing.webp', x: 30, y: 40, variant: 0 }],
      houses: [{ roadId: road.id, roadDistance: 18,
        asset: 'house.webp', x: 35, y: 45, variant: 0 }]
    } } },
    context: {
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() { counts.strokes += 1; }, translate() {}, rotate() {},
      drawImage() { counts.images += 1; }
    },
    viewport: { width: 100, height: 100 },
    project: (x, y) => ({ x, y }),
    ...visibility
  };
  return { frame, counts };
}

test('surface road and house visibility switches independently', () => {
  const renderer = loadRenderer();

  const defaults = makeFrame();
  renderer.render(defaults.frame);
  assert.equal(defaults.counts.strokes, 1);
  assert.equal(defaults.counts.images, 2, 'district module and house are both visible by default');

  const roadsHidden = makeFrame({ showSurfaceRoads: false });
  renderer.render(roadsHidden.frame);
  assert.equal(roadsHidden.counts.strokes, 0);
  assert.equal(roadsHidden.counts.images, 1, 'houses remain visible when road display is disabled');

  const housesHidden = makeFrame({ showSurfaceHouses: false });
  renderer.render(housesHidden.frame);
  assert.equal(housesHidden.counts.strokes, 1);
  assert.equal(housesHidden.counts.images, 1, 'road district modules remain visible when houses are disabled');
});
