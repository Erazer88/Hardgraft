'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/resources.js', 'data/processes.js', 'simulation/processGraph.js',
  'simulation/processSimulation.js']) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);
}
const Data = context.OrbitProcessData;
const Graph = context.OrbitProcessGraph;
const Simulation = context.OrbitProcessSimulation;
const plain = value => JSON.parse(JSON.stringify(value));

function machine(graph, id, type, x = 0) {
  const result = Graph.addMachine(graph, { id, type, x, y: 0 });
  assert.equal(result.ok, true, result.reason);
  return result.machine;
}

function connect(graph, id, fromMachineId, fromOutputId, toMachineId, toInputId) {
  const result = Graph.connect(graph, { id, fromMachineId, fromOutputId, toMachineId, toInputId });
  assert.equal(result.ok, true, result.reason);
  return result.connection;
}

function chain() {
  const graph = Graph.create({ geology: { resourceId: 'iron' } });
  machine(graph, 'drill', 'drill');
  machine(graph, 'crusher', 'crusher', 350);
  machine(graph, 'grinder', 'grinder', 700);
  machine(graph, 'separator', 'magnetic_separator', 1050);
  machine(graph, 'furnace', 'reduction_furnace', 1400);
  connect(graph, 'c1', 'drill', 'raw_ore', 'crusher', 'raw_ore');
  connect(graph, 'c2', 'crusher', 'crushed_ore', 'grinder', 'crushed_ore');
  connect(graph, 'c3', 'grinder', 'ground_ore', 'separator', 'ground_ore');
  connect(graph, 'c4', 'separator', 'concentrate', 'furnace', 'concentrate');
  return graph;
}

function advance(graph, seconds, context = { energyUnlimited: true }) {
  return Simulation.advance(graph, seconds, context);
}

test('V1 exposes only the five iron-chain machines and integer recipes', () => {
  assert.deepEqual(Object.keys(Data.definitions), [
    'drill', 'crusher', 'grinder', 'magnetic_separator', 'reduction_furnace'
  ]);
  assert.equal(Data.get('drill').throughput, null, 'the drill has no nominal rate ceiling');
  assert.equal(Data.get('crusher').throughput, 2);
  assert.equal(Data.get('grinder').throughput, 8);
  assert.equal(Data.get('magnetic_separator').throughput, 10);
  assert.equal(Data.get('reduction_furnace').throughput, 8);
  for (const def of Object.values(Data.definitions)) {
    for (const part of [...(def.recipe?.inputs || []), ...(def.recipe?.outputs || [])]) {
      assert.ok(Number.isInteger(part.amount) && part.amount > 0, `${def.id} quantities are positive integers`);
    }
  }
  assert.deepEqual(plain(Data.get('magnetic_separator').recipe.outputs.map(item => item.amount)), [2, 3]);
  assert.deepEqual(plain(Data.get('reduction_furnace').recipe.outputs.map(item => item.amount)), [1, 1]);
});

test('connections store explicit machine and port ids, and reject invalid routes and loops', () => {
  const graph = chain();
  assert.deepEqual(plain(graph.connections[0]), {
    id: 'c1', fromMachineId: 'drill', fromOutputId: 'raw_ore',
    toMachineId: 'crusher', toInputId: 'raw_ore'
  });
  assert.equal(Graph.connect(graph, { id: 'wrong-resource', fromMachineId: 'drill', fromOutputId: 'raw_ore',
    toMachineId: 'grinder', toInputId: 'crushed_ore' }).ok, false);
  assert.equal(Graph.connect(graph, { id: 'loop', fromMachineId: 'furnace', fromOutputId: 'raw_iron',
    toMachineId: 'crusher', toInputId: 'raw_ore' }).ok, false);
  assert.equal(Graph.connect(graph, { id: 'duplicate-port', fromMachineId: 'drill', fromOutputId: 'raw_ore',
    toMachineId: 'grinder', toInputId: 'crushed_ore' }).ok, false);
});

test('old industrial plans reset without migrating their graph schema', () => {
  const reset = Graph.create({ version: 3,
    nodes: [{ id: 'legacy', type: 'smelter', x: 2, y: 4 }],
    connections: [{ id: 'old-link', fromNodeId: 'legacy', toNodeId: 'legacy' }] });
  assert.equal(reset.version, Data.config.version);
  assert.deepEqual(plain(reset.machines), []);
  assert.deepEqual(plain(reset.connections), []);
});

test('crusher level 1 processes exactly two whole units per second', () => {
  const graph = Graph.create(), crusher = machine(graph, 'crusher', 'crusher');
  crusher.inputBuffer.raw_ore = 4;
  advance(graph, 1);
  assert.equal(crusher.inputBuffer.raw_ore, 2);
  assert.equal(crusher.outputBuffer.crushed_ore, 2);
  assert.equal(crusher.cycleProgress, 0);
  assert.equal(Number.isInteger(crusher.outputBuffer.crushed_ore), true);
});

test('the drill stays unbounded and the crusher is the first chain bottleneck', () => {
  const graph = chain();
  Simulation.estimateRates(graph);
  const rates = Object.fromEntries(graph.machines.map(item => [item.id, item.currentRate]));
  assert.deepEqual(plain(rates), {
    drill: 2, crusher: 2, grinder: 2, separator: 2, furnace: .8
  });
  advance(graph, 10);
  assert.ok(graph.machines.find(item => item.id === 'drill').currentRate >= 2);
  assert.ok(graph.machines.every(item => [...Object.values(item.inputBuffer), ...Object.values(item.outputBuffer)]
    .every(Number.isInteger)), 'all material transfers and buffers remain integral');
  assert.ok(graph.machines.find(item => item.id === 'furnace').outputBuffer.raw_iron > 0);
});

test('energy shortage scales the sustained rate without creating fractional material', () => {
  const graph = chain();
  const nominalDemand = Simulation.demand(graph);
  advance(graph, 5, { energyAvailableMW: nominalDemand / 2 });
  const rates = Object.fromEntries(graph.machines.map(item => [item.id, item.currentRate]));
  assert.deepEqual(plain(rates), {
    drill: 1, crusher: 1, grinder: 1, separator: 1, furnace: .4
  });
  assert.ok(graph.machines.every(item => [...Object.values(item.inputBuffer), ...Object.values(item.outputBuffer)]
    .every(Number.isInteger)));
});

test('the separator and reduction furnace conserve their integer recipe batches', () => {
  const graph = Graph.create();
  const separator = machine(graph, 'separator', 'magnetic_separator');
  separator.inputBuffer.ground_ore = 10;
  advance(graph, 1);
  assert.equal(separator.outputBuffer.concentrate, 4);
  assert.equal(separator.outputBuffer.tailings, 6);
  assert.equal(separator.inputBuffer.ground_ore, 0);

  const furnace = machine(graph, 'furnace', 'reduction_furnace');
  furnace.inputBuffer.concentrate = 4;
  advance(graph, 1);
  assert.equal(furnace.outputBuffer.raw_iron, 2);
  assert.equal(furnace.outputBuffer.slag, 2);
  assert.equal(furnace.inputBuffer.concentrate, 0);
});

test('an unconnected byproduct can fill its buffer and stops the whole recipe safely', () => {
  const graph = Graph.create();
  const separator = machine(graph, 'separator', 'magnetic_separator');
  separator.inputBuffer.ground_ore = 20;
  separator.outputBuffer.tailings = 18;
  advance(graph, 2);
  assert.equal(separator.state, 'output_full');
  assert.equal(separator.inputBuffer.ground_ore, 20);
  assert.equal(separator.outputBuffer.tailings, 18);
  assert.equal(separator.outputBuffer.concentrate, 0);
});

test('machines show the four essential states and stop without power', () => {
  const graph = Graph.create(), crusher = machine(graph, 'crusher', 'crusher');
  crusher.inputBuffer.raw_ore = 2;
  advance(graph, .5, { energyAvailableMW: 0 });
  assert.equal(crusher.state, 'no_energy');
  assert.equal(crusher.outputBuffer.crushed_ore, 0);
  advance(graph, .5);
  assert.equal(crusher.state, 'active');
  assert.equal(crusher.outputBuffer.crushed_ore, 1);
  const empty = machine(graph, 'grinder', 'grinder');
  advance(graph, .1);
  assert.equal(empty.state, 'waiting_input');
});

test('graph snapshots retain port connections and integer buffers', () => {
  const graph = chain();
  graph.machines.find(item => item.id === 'crusher').inputBuffer.raw_ore = 7;
  const restored = Graph.create(plain(Graph.snapshot(graph)));
  assert.deepEqual(plain(restored.connections), plain(graph.connections));
  assert.equal(restored.machines.find(item => item.id === 'crusher').inputBuffer.raw_ore, 7);
  assert.equal(restored.machines.length, 5);
});
