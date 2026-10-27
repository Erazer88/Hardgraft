'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/resources.js', 'simulation/resourceStack.js', 'data/processes.js',
  'simulation/processGraph.js', 'simulation/processSimulation.js', 'simulation/depotRouting.js', 'gameplay/industry.js']) {
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

test('V1 exposes resource-specific lines with shared crusher, grinder and furnace cards', () => {
  assert.deepEqual(plain(Data.catalog('extractor', 'iron').map(def => def.id)), [
    'drill', 'crusher', 'grinder', 'magnetic_separator', 'reduction_furnace', 'output_dock'
  ]);
  assert.deepEqual(plain(Data.catalog('extractor', 'copper').map(def => def.id)), [
    'drill', 'crusher', 'grinder', 'gravity_separator', 'reduction_furnace', 'output_dock'
  ]);
  assert.deepEqual(plain(Data.catalog('extractor', 'silicon').map(def => def.id)), [
    'drill', 'crusher', 'grinder', 'water_supply', 'silicon_washer', 'silicon_dryer',
    'reduction_furnace', 'output_dock'
  ]);
  assert.deepEqual(plain(Data.catalog('extractor', 'carbon').map(def => def.id)), [
    'drill', 'crusher', 'grinder', 'carbon_separator', 'water_supply', 'carbon_washer', 'output_dock'
  ]);
  assert.equal(Data.catalog('factory', 'iron')[0].id, 'input_dock');
  assert.equal(Data.get('input_dock').externalInput, true);
  assert.deepEqual(plain(Data.catalog('oil_platform', 'oil').map(def => def.id)), [
    'oil_pump', 'triphasic_separator', 'output_dock'
  ]);
  for (const catalog of [Data.catalog('factory', 'iron'), Data.catalog('extractor', 'iron'),
    Data.catalog('oil_platform', 'oil')]) {
    assert.ok(catalog.every(def => typeof def.description === 'string' && def.description.length > 10),
      'each available machine has a readable palette description');
  }
  assert.equal(Data.get('drill').throughput, null, 'the drill has no nominal rate ceiling');
  assert.equal(Data.get('crusher').throughput, 2);
  assert.equal(Data.get('grinder').throughput, 2);
  assert.equal(Data.get('magnetic_separator').throughput, 2);
  assert.equal(Data.get('reduction_furnace').throughput, 2);
  assert.equal(Data.get('terril').throughput, null);
  assert.equal(Data.get('terril').storesResources, true);
  assert.equal(Data.get('oil_pump', 'iron'), null);
  assert.equal(Data.get('triphasic_separator', 'copper'), null);
  assert.equal(Data.get('output_dock').throughput, 2);
  assert.equal(Data.get('output_dock').externalOutput, true);
  for (const resourceId of ['iron', 'copper', 'silicon', 'carbon', 'oil']) for (const def of Data.catalog(
    resourceId === 'oil' ? 'oil_platform' : 'extractor', resourceId)) {
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
  assert.equal(Graph.connect(graph, { id: 'loop', fromMachineId: 'furnace', fromOutputId: 'product',
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

test('the same crusher and grinder cards expose the matching ground material', () => {
  const variants = {
    iron: ['iron_ore_raw', 'iron_ore_crushed', 'iron_ore_ground'],
    copper: ['copper_ore_raw', 'copper_ore_crushed', 'copper_ore_ground'],
    silicon: ['silicon_ore_raw', 'silicon_ore_crushed', 'silicon_ore_ground'],
    carbon: ['carbon_ore_raw', 'carbon_ore_crushed', 'carbon_ore_ground']
  };
  const labels = new Set();
  for (const [resourceId, [raw, crushed, ground]] of Object.entries(variants)) {
    const graph = Graph.create({ geology: { resourceId } });
    const drill = machine(graph, 'drill', 'drill');
    const crusher = machine(graph, 'crusher', 'crusher', 300);
    const grinder = machine(graph, 'grinder', 'grinder', 600);
    const drillDef = Graph.definitionOf(drill), crusherDef = Graph.definitionOf(crusher);
    const grinderDef = Graph.definitionOf(grinder);
    assert.equal(drillDef.outputPorts[0].resourceId, raw);
    assert.equal(crusherDef.inputPorts[0].resourceId, raw);
    assert.equal(crusherDef.outputPorts[0].resourceId, crushed);
    assert.equal(grinderDef.inputPorts[0].resourceId, crushed);
    assert.equal(grinderDef.outputPorts[0].resourceId, ground);
    labels.add(crusherDef.label); labels.add(grinderDef.label);
    connect(graph, 'drill-crusher', 'drill', 'raw_ore', 'crusher', 'raw_ore');
    connect(graph, 'crusher-grinder', 'crusher', 'crushed_ore', 'grinder', 'crushed_ore');
    advance(graph, 2);
    assert.ok(crusher.outputBuffer.crushed_ore > 0, `${resourceId} crusher produces its own ore variant`);
  }
  assert.deepEqual([...labels].sort(), ['BROYEUR', 'CONCASSEUR']);
});

test('copper and carbon separators use the provisional iron yield ratio', () => {
  for (const [resourceId, type, concentrateResource] of [
    ['copper', 'gravity_separator', 'copper_concentrate'],
    ['carbon', 'carbon_separator', 'coal']
  ]) {
    const graph = Graph.create({ geology: { resourceId } });
    const separator = machine(graph, 'separator', type);
    separator.inputBuffer.ground_ore = 5;
    advance(graph, 2.5);
    assert.equal(separator.outputBuffer.concentrate, 2);
    assert.equal(separator.outputBuffer.residue, 3);
    assert.equal(Graph.definitionOf(separator).outputPorts[0].resourceId, concentrateResource);
  }
});

test('silicon washing consumes whole water units, dries 1:1, then uses the shared furnace', () => {
  const graph = Graph.create({ geology: { resourceId: 'silicon' } });
  const supply = machine(graph, 'water', 'water_supply');
  const washer = machine(graph, 'washer', 'silicon_washer', 300);
  const dryer = machine(graph, 'dryer', 'silicon_dryer', 600);
  const furnace = machine(graph, 'furnace', 'reduction_furnace', 900);
  washer.inputBuffer.ground_ore = 20;
  connect(graph, 'water-washer', 'water', 'water', 'washer', 'water');
  connect(graph, 'washer-dryer', 'washer', 'wet_silicon', 'dryer', 'wet_silicon');
  connect(graph, 'dryer-furnace', 'dryer', 'dry_silicon', 'furnace', 'dry_silicon');
  advance(graph, 10); advance(graph, 10); advance(graph, 5);
  assert.equal(washer.inputBuffer.water, 0);
  assert.equal(washer.outputBuffer.wet_silicon, 0);
  assert.equal(washer.outputBuffer.sludge, 12);
  assert.equal(dryer.outputBuffer.dry_silicon, 0);
  assert.ok(furnace.outputBuffer.product > 0);
  assert.ok(['active', 'output_full'].includes(supply.state));
  assert.ok(graph.machines.every(item => [...Object.values(item.inputBuffer), ...Object.values(item.outputBuffer)]
    .every(Number.isInteger)));
});

test('carbon washing and petroleum separation preserve the shared provisional yields', () => {
  const carbonGraph = Graph.create({ geology: { resourceId: 'carbon' } });
  const water = machine(carbonGraph, 'water', 'water_supply');
  const washer = machine(carbonGraph, 'washer', 'carbon_washer', 300);
  washer.inputBuffer.coal = 20;
  connect(carbonGraph, 'water-washer', 'water', 'water', 'washer', 'water');
  advance(carbonGraph, 10);
  assert.equal(washer.outputBuffer.carbon, 8);
  assert.equal(washer.outputBuffer.sludge, 12);
  assert.equal(water.state, 'active');

  const oilGraph = Graph.create({ geology: { resourceId: 'oil' } });
  const pump = machine(oilGraph, 'pump', 'oil_pump');
  const separator = machine(oilGraph, 'separator', 'triphasic_separator', 300);
  connect(oilGraph, 'pump-separator', 'pump', 'raw_oil', 'separator', 'raw_oil');
  advance(oilGraph, 10);
  assert.equal(separator.outputBuffer.oil, 16);
  assert.equal(separator.outputBuffer.gas, 3);
  assert.equal(separator.outputBuffer.waste, 1);
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
  assert.ok(graph.machines.find(item => item.id === 'furnace').outputBuffer.product > 0);
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
  assert.equal(separator.outputBuffer.residue, 6);
  assert.equal(separator.inputBuffer.ground_ore, 0);

  const furnace = machine(graph, 'furnace', 'reduction_furnace');
  furnace.inputBuffer.concentrate = 4;
  advance(graph, 2);
  assert.equal(furnace.outputBuffer.product, 2);
  assert.equal(furnace.outputBuffer.slag, 2);
  assert.equal(furnace.inputBuffer.concentrate, 0);
});

test('an unconnected byproduct can fill its buffer and stops the whole recipe safely', () => {
  const graph = Graph.create();
  const separator = machine(graph, 'separator', 'magnetic_separator');
  separator.inputBuffer.ground_ore = 20;
  separator.outputBuffer.residue = 18;
  advance(graph, 2);
  assert.equal(separator.state, 'output_full');
  assert.equal(separator.inputBuffer.ground_ore, 20);
  assert.equal(separator.outputBuffer.residue, 18);
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

test('foreuse mines the material recorded for its ground and still needs a receiver and power', () => {
  const copperDeposit = Graph.create({ geology: { resourceId: 'copper' } });
  machine(copperDeposit, 'drill', 'drill');
  machine(copperDeposit, 'crusher', 'crusher');
  connect(copperDeposit, 'c1', 'drill', 'raw_ore', 'crusher', 'raw_ore');
  advance(copperDeposit, .5);
  assert.equal(copperDeposit.machines[0].state, 'active');
  assert.ok(copperDeposit.machines[1].outputBuffer.crushed_ore > 0);

  const missingDeposit = Graph.create();
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

test('extractor geology configures the foreuse and shared processor for the local ground', () => {
  const extractor = { id: 'extractor-1', type: 'extractor', resourceId: 'copper', planetId: 'planet-1',
    x: 25, y: 30, constructionState: 'complete' };
  const wind = { id: 'wind-1', type: 'wind_turbine', planetId: 'planet-1', constructionState: 'complete' };
  const state = { seed: 'factory-seed', surfaceBuildings: [extractor, wind], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, extractor);
  machine(graph, 'drill', 'drill');
  machine(graph, 'crusher', 'crusher');
  connect(graph, 'c1', 'drill', 'raw_ore', 'crusher', 'raw_ore');
  Industry.advance(state, 1);
  assert.equal(graph.geology.resourceId, 'copper');
  assert.equal(graph.machines[0].state, 'active');
  assert.equal(Graph.definitionOf(graph.machines[0]).outputPorts[0].resourceId, 'copper_ore_raw');
  assert.equal(Graph.definitionOf(graph.machines[1]).inputPorts[0].resourceId, 'copper_ore_raw');
  assert.ok(graph.machines[1].outputBuffer.crushed_ore > 0);
});

test('an offshore oil platform receives its own deterministic pump process graph', () => {
  const platform = { id: 'oil-platform-1', type: 'oil_platform', resourceId: 'oil', planetId: 'planet-1',
    x: 25, y: 30, constructionState: 'complete' };
  const wind = { id: 'wind-oil', type: 'wind_turbine', planetId: 'planet-1', constructionState: 'complete' };
  const state = { seed: 'factory-seed', surfaceBuildings: [platform, wind], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, platform);
  const pump = machine(graph, 'pump', 'oil_pump');
  const separator = machine(graph, 'separator', 'triphasic_separator', 300);
  connect(graph, 'pump-separator', 'pump', 'raw_oil', 'separator', 'raw_oil');
  assert.equal(graph.geology.resourceId, 'oil');
  assert.equal(Graph.definitionOf(pump).outputPorts[0].resourceId, 'raw_oil');
  Industry.advance(state, 1);
  assert.equal(pump.state, 'active');
  assert.equal(Graph.definitionOf(separator).inputPorts[0].resourceId, 'raw_oil');
});

test('the shared terril stores multiple resources without a capacity or throughput limit', () => {
  const graph = Graph.create({ geology: { resourceId: 'iron' } });
  const iron = machine(graph, 'iron-crusher', 'crusher');
  const copper = Graph.addMachine(graph, { id: 'copper-crusher', type: 'crusher', resourceId: 'copper', x: 300, y: 0 }).machine;
  machine(graph, 'terril', 'terril', 600);
  iron.outputBuffer.crushed_ore = 125;
  copper.outputBuffer.crushed_ore = 125;
  connect(graph, 'iron-terril', 'iron-crusher', 'crushed_ore', 'terril', 'material');
  connect(graph, 'copper-terril', 'copper-crusher', 'crushed_ore', 'terril', 'material');
  advance(graph, .1);
  const sink = graph.machines.find(item => item.id === 'terril');
  assert.equal(Graph.definitionOf(sink).throughput, null);
  assert.equal(sink.storedResources.iron_ore_crushed, 125);
  assert.equal(sink.storedResources.copper_ore_crushed, 125);
  assert.equal(sink.inputBuffer.material, 0);
  assert.ok(graph.machines.every(item => [...Object.values(item.inputBuffer), ...Object.values(item.outputBuffer),
    ...Object.values(item.storedResources)].every(Number.isInteger)));
});

test('the terril retains its stored resources in graph snapshots and deletion accounts for them', () => {
  const graph = Graph.create();
  const terril = machine(graph, 'terril', 'terril');
  terril.storedResources = { iron_ore_crushed: 123, copper_concentrate: 45 };
  const restored = Graph.create(Graph.snapshot(graph));
  assert.deepEqual(plain(restored.machines[0].storedResources), terril.storedResources);
  assert.equal(Graph.removeMachine(restored, 'terril').discardedUnits, 168);
});

test('demolishing a building returns its terril stock to the colony', () => {
  const graph = Graph.create();
  const terril = machine(graph, 'terril', 'terril');
  terril.storedResources = { iron_ore_crushed: 12, copper_concentrate: 5 };
  const building = { id: 'factory', type: 'factory' };
  const state = { seed: 'terril-stock', factoryPlans: { factory: graph }, colonyMaterials: [] };
  Industry.reclaimBuilding(state, building);
  assert.deepEqual(plain(state.colonyMaterials.map(stack => [stack.resourceId, stack.amount]).sort()), [
    ['copper_concentrate', 5], ['iron_ore_crushed', 12]
  ]);
});

test('an output dock accepts one stream and writes only to the dedicated dock export stock', () => {
  const graph = Graph.create();
  const crusher = machine(graph, 'crusher', 'crusher');
  const dock = machine(graph, 'dock', 'output_dock', 300);
  crusher.outputBuffer.crushed_ore = 1;
  connect(graph, 'crusher-dock', 'crusher', 'crushed_ore', 'dock', 'material');
  assert.equal(Graph.connect(graph, { id: 'second-dock-input', fromMachineId: 'crusher',
    fromOutputId: 'crushed_ore', toMachineId: 'dock', toInputId: 'material' }).ok, false,
  'one dock has one source so its exported resource remains unambiguous');

  const building = { id: 'factory', type: 'factory', constructionState: 'complete', inventory: {}, dockStock: {} };
  const state = { seed: 'factory-seed', surfaceBuildings: [building], factoryPlans: { factory: graph } };
  Industry.advance(state, .1);
  assert.equal(dock.inputBuffer.material, 0);
  assert.equal(building.dockStock.iron_ore_crushed, 1);
  assert.deepEqual(building.inventory, {}, 'Dock output does not enter another building inventory');
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

test('the input dock supplies only received stock in whole units and survives a graph reload', () => {
  const factory = { id: 'receiver', type: 'factory', planetId: 'planet', constructionState: 'complete',
    inventory: { iron_ore_raw: 7 } };
  const wind = { id: 'wind', type: 'wind_turbine', planetId: 'planet', constructionState: 'complete' };
  const state = { seed: 'import', factoryPlans: {}, surfaceBuildings: [factory, wind] };
  const graph = Industry.ensureGraph(state, factory);
  const dock = machine(graph, 'input', 'input_dock');
  const crusher = machine(graph, 'crusher', 'crusher');
  Industry.ensureGraph(state, factory);
  assert.equal(Graph.definitionOf(dock).outputPorts[0].resourceId, 'iron_ore_raw');
  connect(graph, 'import-crusher', 'input', 'material', 'crusher', 'raw_ore');
  Industry.advance(state, .4);
  assert.equal(factory.inventory.iron_ore_raw, 7, 'no fractional material is withdrawn');
  Industry.advance(state, .1);
  assert.equal(factory.inventory.iron_ore_raw, 6);
  const restored = Graph.create(Graph.snapshot(graph));
  assert.equal(restored.machines[0].importResourceId, 'iron_ore_raw');
  assert.equal(restored.connections.length, 1);
  state.factoryPlans.receiver = restored;
  for (let i = 0; i < 10; i++) Industry.advance(state, 1);
  const product = restored.machines.find(item => item.id === crusher.id);
  assert.equal(factory.inventory.iron_ore_raw, 0);
  assert.equal(product.outputBuffer.crushed_ore, 7);
  assert.equal(restored.machines[0].outputBuffer.material, 0);
  assert.equal(product.inputBuffer.raw_ore, 0);
  assert.equal(graph.geology, null, 'an import never creates a geological source for factory drills');
});

test('an input dock waits for delivery and preserves stock while its processor is blocked', () => {
  const factory = { id: 'receiver', type: 'factory', planetId: 'planet', constructionState: 'complete', inventory: {} };
  const state = { seed: 'import', factoryPlans: {}, surfaceBuildings: [factory] };
  const graph = Industry.ensureGraph(state, factory);
  const dock = machine(graph, 'input', 'input_dock');
  const crusher = machine(graph, 'crusher', 'crusher');
  assert.equal(Graph.connect(graph, { id: 'empty', fromMachineId: 'input', fromOutputId: 'material',
    toMachineId: 'crusher', toInputId: 'raw_ore' }).ok, false);
  Industry.advance(state, 1);
  assert.equal(dock.state, 'waiting_input');
  factory.inventory.iron_ore_raw = 8;
  Industry.ensureGraph(state, factory);
  connect(graph, 'delivered', 'input', 'material', 'crusher', 'raw_ore');
  crusher.outputBuffer.crushed_ore = Data.config.outputCapacity;
  Industry.advance(state, 2);
  assert.equal(factory.inventory.iron_ore_raw, 8);
  assert.equal(dock.outputBuffer.material, 0);
});

test('multiple input docks share one inventory without duplicating received units', () => {
  const graph = Graph.create();
  const stock = { raw_copper: 5 };
  for (const id of ['a', 'b']) {
    Graph.addMachine(graph, { id, type: 'input_dock', importResourceId: 'raw_copper' });
    machine(graph, `${id}-sink`, 'terril');
    connect(graph, `${id}-link`, id, 'material', `${id}-sink`, 'material');
  }
  advance(graph, 5, { externalStock: stock });
  assert.equal(stock.raw_copper, 0);
  assert.equal(graph.machines.filter(item => item.type === 'terril')
    .reduce((sum, item) => sum + (item.storedResources.raw_copper || 0), 0), 5);
});

test('demolishing a building reclaims resources already exported through its dock', () => {
  const graph = Graph.create();
  const crusher = machine(graph, 'crusher', 'crusher');
  const dock = machine(graph, 'dock', 'output_dock', 300);
  dock.inputBuffer.material = 2;
  connect(graph, 'crusher-dock', 'crusher', 'crushed_ore', 'dock', 'material');
  const building = { id: 'factory', type: 'factory', constructionState: 'complete',
    inventory: {}, dockStock: { iron_ore_crushed: 3 } };
  const state = { seed: 'factory-seed', surfaceBuildings: [building], factoryPlans: { factory: graph }, colonyMaterials: [] };
  Industry.reclaimBuilding(state, building);
  assert.equal(state.colonyMaterials.reduce((sum, stack) => sum +
    (stack.resourceId === 'iron_ore_crushed' ? stack.amount : 0), 0), 5,
  'docked stock and the dock buffer both return to colony materials');
  assert.equal(state.factoryPlans.factory, undefined);
});

test('a pumping station pumps the water of its shore: salt water faster than fresh water', () => {
  const rates = {};
  for (const resourceId of ['salt_water', 'water']) {
    const station = { id: `station-${resourceId}`, type: 'water_station', resourceId, planetId: 'planet-1',
      x: 25, y: 30, constructionState: 'complete' };
    const wind = { id: 'wind-water', type: 'wind_turbine', planetId: 'planet-1', constructionState: 'complete' };
    const state = { seed: 'water-seed', surfaceBuildings: [station, wind], factoryPlans: {} };
    const graph = Industry.ensureGraph(state, station);
    assert.equal(graph.geology.resourceId, resourceId);
    assert.deepEqual(plain(Data.catalog('water_station', resourceId).map(def => def.id)),
      resourceId === 'salt_water' ? ['water_pump', 'desalinator', 'output_dock'] : ['water_pump', 'output_dock']);
    const pump = machine(graph, 'pump', 'water_pump');
    pump.resourceId = resourceId;
    const dock = machine(graph, 'dock', 'output_dock', 300);
    connect(graph, 'pump-dock', 'pump', 'water', 'dock', 'material');
    assert.equal(Graph.definitionOf(pump).outputPorts[0].resourceId, resourceId);
    Industry.advance(state, 10);
    assert.equal(pump.state, 'active');
    rates[resourceId] = station.dockStock[resourceId] || 0;
    assert.ok(dock);
  }
  assert.ok(rates.salt_water > rates.water, `salt ${rates.salt_water} > fresh ${rates.water}`);
});

test('the desalinator turns salt water into fresh water and brine', () => {
  const graph = Graph.create({ geology: { resourceId: 'salt_water' } });
  const pump = machine(graph, 'pump', 'water_pump');
  const desalinator = machine(graph, 'desalinator', 'desalinator', 300);
  connect(graph, 'pump-desalinator', 'pump', 'water', 'desalinator', 'salt_water');
  assert.equal(pump.resourceId, 'salt_water');
  Simulation.advance(graph, 5, { energyUnlimited: true });
  assert.equal(desalinator.state, 'active');
  assert.ok(desalinator.outputBuffer.water >= 3);
  assert.equal(desalinator.outputBuffer.water, desalinator.outputBuffer.brine * 3);
});

test('the waste heap reprocesses the waste of one line at a low yield, or burns waste for energy', () => {
  assert.deepEqual(plain(Data.catalog('waste_heap').map(def => def.id)), ['input_dock', 'reprocessor', 'reprocessor',
    'reprocessor', 'reprocessor', 'incinerator', 'output_dock']);
  assert.equal(Data.catalog('factory', 'iron').some(def => def.id === 'terril'), false);
  const heap = { id: 'heap-1', type: 'waste_heap', planetId: 'planet-1', x: 0, y: 0, constructionState: 'complete',
    inventory: { iron_tailings: 40, waste: 40 } };
  const wind = { id: 'wind-heap', type: 'wind_turbine', planetId: 'planet-1', constructionState: 'complete' };
  const state = { seed: 'heap-seed', surfaceBuildings: [heap, wind], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, heap);
  const tailings = machine(graph, 'dock-tailings', 'input_dock');
  tailings.importResourceId = 'iron_tailings';
  const reprocessor = Graph.addMachine(graph, { id: 'reprocessor', type: 'reprocessor', resourceId: 'iron', x: 300, y: 0 }).machine;
  connect(graph, 'tailings-reprocessor', 'dock-tailings', 'material', 'reprocessor', 'waste');
  const waste = machine(graph, 'dock-waste', 'input_dock', 0);
  waste.importResourceId = 'waste';
  const copper = Graph.addMachine(graph, { id: 'copper-reprocessor', type: 'reprocessor', resourceId: 'copper', x: 300, y: 300 }).machine;
  const refused = Graph.connect(graph, { id: 'refused', fromMachineId: 'dock-waste', fromOutputId: 'material',
    toMachineId: copper.id, toInputId: 'waste' });
  assert.equal(refused.ok, false, 'generic waste holds no copper');
  const incinerator = machine(graph, 'incinerator', 'incinerator', 600);
  connect(graph, 'waste-incinerator', 'dock-waste', 'material', 'incinerator', 'waste');
  for (let second = 0; second < 12; second++) Industry.advance(state, 1);
  assert.equal(incinerator.state, 'active');
  assert.ok(heap.inventory.waste < 40);
  assert.ok(heap.energyOutputWatts > 0, 'burning waste feeds the grid');
  assert.ok(reprocessor.outputBuffer.ground_ore >= 1, 'ten units of tailings give one unit of ground ore');
  assert.equal(Graph.definitionOf(reprocessor).outputPorts[0].resourceId, 'iron_ore_ground');
});

test('depot cards route mixed flows through filters, splitters and priorities to their gates', () => {
  assert.deepEqual(plain(Data.catalog('storage').map(def => def.id)),
    ['depot_input', 'depot_buffer', 'depot_filter', 'depot_splitter', 'depot_priority', 'depot_output']);
  const depot = { id: 'depot-1', type: 'storage', planetId: 'planet-1', x: 0, y: 0, constructionState: 'complete',
    inventory: { raw_iron: 30, water: 30 } };
  const state = { seed: 'depot-seed', surfaceBuildings: [depot], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, depot);
  machine(graph, 'in', 'depot_input');
  const filter = machine(graph, 'filter', 'depot_filter', 300);
  const splitter = machine(graph, 'split', 'depot_splitter', 600);
  const iron = machine(graph, 'gate-iron', 'depot_output', 900);
  const a = machine(graph, 'gate-a', 'depot_output', 900);
  const b = machine(graph, 'gate-b', 'depot_output', 900);
  filter.config = { filterResourceId: 'raw_iron' };
  splitter.config = { splitPercent: 75 };
  iron.config = { destinationId: 'factory-iron' };
  a.config = { destinationId: 'factory-a' };
  b.config = { destinationId: 'factory-b' };
  connect(graph, 'c1', 'in', 'out', 'filter', 'in');
  connect(graph, 'c2', 'filter', 'match', 'gate-iron', 'in');
  connect(graph, 'c3', 'filter', 'other', 'split', 'in');
  connect(graph, 'c4', 'split', 'a', 'gate-a', 'in');
  connect(graph, 'c5', 'split', 'b', 'gate-b', 'in');
  assert.equal(Graph.connect(graph, { id: 'mixed-bad', fromMachineId: 'gate-a', fromOutputId: 'out',
    toMachineId: 'filter', toInputId: 'in' }).ok, false);
  for (let second = 0; second < 20; second++) Industry.advance(state, 1);
  assert.equal(depot.inventory.raw_iron || 0, 0);
  assert.equal(depot.inventory.water || 0, 0);
  assert.deepEqual(plain(depot.gateStock['factory-iron']), { raw_iron: 30 });
  const toA = depot.gateStock['factory-a'].water || 0, toB = depot.gateStock['factory-b'].water || 0;
  assert.equal(toA + toB, 30);
  assert.ok(Math.abs(toA - 22.5) <= 1, `three quarters of the water go to A (${toA})`);
  const saved = Graph.create(plain(Graph.snapshot(graph)));
  assert.equal(saved.machines.find(item => item.id === 'split').config.splitPercent, 75);
  assert.equal(saved.machines.find(item => item.id === 'filter').config.filterResourceId, 'raw_iron');
});

test('a depot priority card fills its first output before overflowing', () => {
  const depot = { id: 'depot-2', type: 'storage', planetId: 'planet-1', x: 0, y: 0, constructionState: 'complete',
    inventory: { raw_iron: 60 } };
  const state = { seed: 'depot-seed', surfaceBuildings: [depot], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, depot);
  machine(graph, 'in', 'depot_input');
  machine(graph, 'priority', 'depot_priority', 300);
  const primary = machine(graph, 'buffer', 'depot_buffer', 600);
  const overflow = machine(graph, 'gate', 'depot_output', 900);
  overflow.config = { destinationId: 'factory-b' };
  connect(graph, 'c1', 'in', 'out', 'priority', 'in');
  connect(graph, 'c2', 'priority', 'primary', 'buffer', 'in');
  connect(graph, 'c3', 'priority', 'overflow', 'gate', 'in');
  for (let second = 0; second < 20; second++) Industry.advance(state, 1);
  assert.equal(primary.storedResources.raw_iron, 60, 'the unconnected buffer keeps everything');
  assert.equal(depot.gateStock?.['factory-b']?.raw_iron || 0, 0);
});
