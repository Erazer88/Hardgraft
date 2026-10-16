'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/resources.js', 'simulation/resourceStack.js', 'data/processes.js',
  'simulation/processGraph.js', 'simulation/processSimulation.js', 'gameplay/industry.js']) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);
}
const Data = context.OrbitProcessData;
const Graph = context.OrbitProcessGraph;
const Simulation = context.OrbitProcessSimulation;
const Industry = context.OrbitIndustry;
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

test('V1 exposes the iron-chain machines at crusher pace and integer recipes', () => {
  assert.deepEqual(Object.keys(Data.definitions), [
    'drill', 'crusher', 'grinder', 'magnetic_separator', 'reduction_furnace'
  ]);
  assert.equal(Data.get('drill').throughput, null, 'the drill has no nominal rate ceiling');
  assert.equal(Data.get('crusher').throughput, 2);
  assert.equal(Data.get('grinder').throughput, 2);
  assert.equal(Data.get('magnetic_separator').throughput, 2);
  assert.equal(Data.get('reduction_furnace').throughput, 2);
  assert.equal(Data.get('trash').throughput, 2);
  assert.equal(Data.get('output_dock').throughput, 2);
  assert.equal(Data.get('output_dock').externalOutput, true);
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
  advance(graph, 5);
  assert.equal(separator.outputBuffer.concentrate, 4);
  assert.equal(separator.outputBuffer.tailings, 6);
  assert.equal(separator.inputBuffer.ground_ore, 0);

  const furnace = machine(graph, 'furnace', 'reduction_furnace');
  furnace.inputBuffer.concentrate = 4;
  advance(graph, 2);
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

test('foreuse activates only on an iron deposit, a receiver, and available power', () => {
  const missingDeposit = Graph.create({ geology: { resourceId: 'copper' } });
  machine(missingDeposit, 'drill', 'drill');
  machine(missingDeposit, 'crusher', 'crusher');
  connect(missingDeposit, 'c1', 'drill', 'raw_ore', 'crusher', 'raw_ore');
  advance(missingDeposit, .5);
  assert.equal(missingDeposit.machines[0].state, 'waiting_input');

  const missingReceiver = Graph.create({ geology: { resourceId: 'iron' } });
  machine(missingReceiver, 'drill', 'drill');
  advance(missingReceiver, .5);
  assert.equal(missingReceiver.machines[0].state, 'waiting_input');

  const unpowered = Graph.create({ geology: { resourceId: 'iron' } });
  machine(unpowered, 'drill', 'drill');
  machine(unpowered, 'crusher', 'crusher');
  connect(unpowered, 'c1', 'drill', 'raw_ore', 'crusher', 'raw_ore');
  advance(unpowered, .5, { energyAvailableMW: 0 });
  assert.equal(unpowered.machines[0].state, 'no_energy');

  advance(unpowered, .5);
  assert.equal(unpowered.machines[0].state, 'active');
  assert.ok(unpowered.machines[1].outputBuffer.crushed_ore > 0);
});

test('a saturated first processor pauses the foreuse without discarding ore', () => {
  const graph = Graph.create({ geology: { resourceId: 'iron' } });
  const drill = machine(graph, 'drill', 'drill');
  const crusher = machine(graph, 'crusher', 'crusher');
  crusher.outputBuffer.crushed_ore = Data.config.outputCapacity;
  connect(graph, 'c1', 'drill', 'raw_ore', 'crusher', 'raw_ore');
  advance(graph, .5);
  assert.equal(drill.state, 'output_full');
  assert.equal(drill.outputBuffer.raw_ore, 0);
  assert.equal(crusher.inputBuffer.raw_ore, 0);
});

test('the extractor building supplies the foreuse with deterministic iron geology', () => {
  const extractor = { id: 'extractor-1', type: 'extractor', resourceId: 'iron', planetId: 'planet-1',
    x: 25, y: 30, constructionState: 'complete' };
  const wind = { id: 'wind-1', type: 'wind_turbine', planetId: 'planet-1', constructionState: 'complete' };
  const state = { seed: 'factory-seed', surfaceBuildings: [extractor, wind], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, extractor);
  machine(graph, 'drill', 'drill');
  machine(graph, 'crusher', 'crusher');
  connect(graph, 'c1', 'drill', 'raw_ore', 'crusher', 'raw_ore');
  Industry.advance(state, 1);
  assert.equal(graph.geology.resourceId, 'iron');
  assert.equal(graph.machines[0].state, 'active');
  assert.ok(graph.machines[1].outputBuffer.crushed_ore > 0);
});

test('the shared trash accepts several resource connections and destroys at two units per second', () => {
  const graph = Graph.create({ geology: { resourceId: 'iron' } });
  machine(graph, 'drill-a', 'drill');
  machine(graph, 'drill-b', 'drill', 300);
  machine(graph, 'trash', 'trash', 600);
  connect(graph, 'trash-a', 'drill-a', 'raw_ore', 'trash', 'material');
  connect(graph, 'trash-b', 'drill-b', 'raw_ore', 'trash', 'material');
  advance(graph, 5);
  const sink = graph.machines.find(item => item.id === 'trash');
  assert.equal(sink.currentRate, 2);
  assert.ok(sink.inputBuffer.material <= Data.config.inputCapacity);
  assert.ok(graph.machines.every(item => [...Object.values(item.inputBuffer), ...Object.values(item.outputBuffer)]
    .every(Number.isInteger)));
  assert.ok(graph.machines.some(item => item.outputBuffer.raw_ore > 0),
    'excess feed queues in the drills instead of being deleted faster than the sink');
});

test('the trash accepts different output resources and processes exactly two units per second', () => {
  const graph = Graph.create();
  const crusher = machine(graph, 'crusher', 'crusher');
  const furnace = machine(graph, 'furnace', 'reduction_furnace', 300);
  const trash = machine(graph, 'trash', 'trash', 600);
  crusher.outputBuffer.crushed_ore = 3;
  furnace.outputBuffer.slag = 3;
  connect(graph, 'ore-trash', 'crusher', 'crushed_ore', 'trash', 'material');
  connect(graph, 'slag-trash', 'furnace', 'slag', 'trash', 'material');
  advance(graph, 1.5);
  assert.equal(trash.inputBuffer.material, 3,
    'six integer units enter; exactly three are destroyed during 1.5 seconds');
  assert.equal(crusher.outputBuffer.crushed_ore, 0);
  assert.equal(furnace.outputBuffer.slag, 0);
});

test('an output dock accepts a single resource stream and exposes it in planet stock', () => {
  const graph = Graph.create();
  const crusher = machine(graph, 'crusher', 'crusher');
  const dock = machine(graph, 'dock', 'output_dock', 300);
  crusher.outputBuffer.crushed_ore = 1;
  connect(graph, 'crusher-dock', 'crusher', 'crushed_ore', 'dock', 'material');
  assert.equal(Graph.connect(graph, { id: 'second-dock-input', fromMachineId: 'crusher',
    fromOutputId: 'crushed_ore', toMachineId: 'dock', toInputId: 'material' }).ok, false,
  'one dock has one source so its exported resource remains unambiguous');

  const building = { id: 'factory', type: 'factory', constructionState: 'complete', inventory: {} };
  const state = { seed: 'factory-seed', surfaceBuildings: [building], factoryPlans: { factory: graph } };
  Industry.advance(state, .1);
  assert.equal(dock.inputBuffer.material, 0);
  assert.equal(building.inventory.iron_ore_crushed, 1);
  assert.ok(building.flowPerMinute > 0);
});

test('a machine with buffered resources can be deleted immediately', () => {
  const graph = Graph.create();
  const crusher = machine(graph, 'crusher', 'crusher');
  crusher.inputBuffer.raw_ore = 1;
  const result = Graph.removeMachine(graph, 'crusher');
  assert.equal(result.ok, true);
  assert.equal(result.discardedUnits, 1);
  assert.equal(graph.machines.length, 0);
});

test('demolishing a building reclaims resources already exported through its dock', () => {
  const graph = Graph.create();
  const crusher = machine(graph, 'crusher', 'crusher');
  const dock = machine(graph, 'dock', 'output_dock', 300);
  dock.inputBuffer.material = 2;
  connect(graph, 'crusher-dock', 'crusher', 'crushed_ore', 'dock', 'material');
  const building = { id: 'factory', type: 'factory', constructionState: 'complete',
    inventory: { iron_ore_crushed: 3 } };
  const state = { seed: 'factory-seed', surfaceBuildings: [building], factoryPlans: { factory: graph }, colonyMaterials: [] };
  Industry.reclaimBuilding(state, building);
  assert.equal(state.colonyMaterials.reduce((sum, stack) => sum +
    (stack.resourceId === 'iron_ore_crushed' ? stack.amount : 0), 0), 5,
  'docked stock and the dock buffer both return to colony materials');
  assert.equal(state.factoryPlans.factory, undefined);
});
