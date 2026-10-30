'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of ['data/resources.js', 'simulation/resourceStack.js', 'data/processes.js', 'data/buildings.js',
  'simulation/composition.js', 'simulation/processGraph.js', 'simulation/processSimulation.js', 'simulation/depotRouting.js',
  'gameplay/industry.js', 'storage/library.js']) {
  vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);
}
const Data = context.OrbitProcessData;
const Graph = context.OrbitProcessGraph;
const Simulation = context.OrbitProcessSimulation;
const Industry = context.OrbitIndustry;
const Mix = context.OrbitComposition;
const plain = value => JSON.parse(JSON.stringify(value));
const IRON_ROCK = { iron: .3, carbon: .1, rock: .6 };

function machine(graph, id, type, x = 0, resourceId) {
  const result = Graph.addMachine(graph, { id, type, x, y: 0, ...(resourceId ? { resourceId } : {}) });
  assert.equal(result.ok, true, result.reason);
  return result.machine;
}

function connect(graph, id, fromMachineId, fromOutputId, toMachineId, toInputId) {
  const result = Graph.connect(graph, { id, fromMachineId, fromOutputId, toMachineId, toInputId });
  assert.equal(result.ok, true, result.reason);
  return result.connection;
}

// A rock line inside an extractor whose ground holds `composition`.
function chain(composition = IRON_ROCK) {
  const graph = Graph.create({ geology: { resourceId: 'rock', composition } });
  machine(graph, 'drill', 'drill');
  machine(graph, 'crusher', 'crusher', 350);
  machine(graph, 'grinder', 'grinder', 700);
  machine(graph, 'separator', 'magnetic_separator', 1050);
  machine(graph, 'furnace', 'reduction_furnace', 1400, 'iron');
  connect(graph, 'c1', 'drill', 'rock', 'crusher', 'rock');
  connect(graph, 'c2', 'crusher', 'rock', 'grinder', 'rock');
  connect(graph, 'c3', 'grinder', 'rock', 'separator', 'rock');
  connect(graph, 'c4', 'separator', 'concentrate', 'furnace', 'concentrate');
  return graph;
}

function advance(graph, seconds, context = { energyUnlimited: true }) {
  return Simulation.advance(graph, seconds, context);
}

const integral = graph => graph.machines.every(item => [...Object.values(item.inputBuffer), ...Object.values(item.outputBuffer)]
  .every(Number.isInteger));

test('extractors drill, crush and grind, factories do the rest; only docks are shared; furnaces come once per metal', () => {
  const name = def => def.contextResourceId ? `${def.id}:${def.contextResourceId}` : def.id;
  assert.deepEqual(plain(Data.catalog('extractor').map(name)), ['drill', 'crusher', 'grinder', 'output_dock']);
  const factory = Data.catalog('factory').map(name);
  assert.deepEqual(plain(factory), ['input_dock', 'magnetic_separator', 'gravity_separator', 'carbon_separator',
    'water_supply', 'silicon_washer', 'silicon_dryer', 'carbon_washer', 'reduction_furnace:iron', 'reduction_furnace:copper',
    'reduction_furnace:silicon', 'tar_furnace', 'rolling_mill', 'output_dock']);
  const shared = Data.catalog('extractor').map(name).filter(id => factory.includes(id));
  assert.deepEqual(plain(shared), ['output_dock'], 'no processing card in both');
  assert.deepEqual(plain(Data.catalog('oil_platform').map(def => def.id)), ['oil_pump', 'triphasic_separator', 'output_dock']);
  assert.deepEqual(plain(Data.catalog('waste_heap').map(def => def.id)), ['input_dock', 'reprocessor', 'incinerator', 'output_dock']);
  for (const def of [...Data.catalog('factory'), ...Data.catalog('extractor'), ...Data.catalog('oil_platform')]) {
    assert.ok(typeof def.description === 'string' && def.description.length > 10, `${def.id} has a palette description`);
    for (const part of [...(def.recipe?.inputs || []), ...(def.recipe?.outputs || [])]) {
      assert.ok(Number.isInteger(part.amount) && part.amount > 0, `${def.id} quantities are positive integers`);
    }
  }
  assert.equal(Data.get('drill').throughput, 6);
  assert.equal(Data.get('drill').maxPerBuilding, 1);
  assert.equal(Data.get('drill').outputPorts[0].resourceId, 'raw_rock');
  assert.equal(Data.get('reduction_furnace', 'copper').label, 'FOUR DE RÉDUCTION · CUIVRE');
  assert.equal(Data.get('reduction_furnace', 'rock').contextResourceId, 'iron', 'a furnace defaults to iron');
  assert.deepEqual(plain(Data.get('rolling_mill').recipe), { inputs: [{ inputId: 'iron', amount: 10 }],
    outputs: [{ outputId: 'plate', resourceId: 'metal_plate', amount: 1 }] });
  assert.deepEqual(plain(Data.get('tar_furnace').recipe.inputs), [{ inputId: 'rock', amount: 4 }, { inputId: 'coal', amount: 1 }]);
  assert.equal(Data.get('oil_pump', 'rock'), null);
});

test('connections store explicit machine and port ids, and reject invalid routes and loops', () => {
  const graph = chain();
  assert.deepEqual(plain(graph.connections[0]), {
    id: 'c1', fromMachineId: 'drill', fromOutputId: 'rock', toMachineId: 'crusher', toInputId: 'rock'
  });
  assert.equal(Graph.connect(graph, { id: 'raw-into-grinder', fromMachineId: 'drill', fromOutputId: 'rock',
    toMachineId: 'grinder', toInputId: 'rock' }).ok, false, 'raw rock is not crushed rock');
  assert.equal(Graph.connect(graph, { id: 'loop', fromMachineId: 'furnace', fromOutputId: 'product',
    toMachineId: 'crusher', toInputId: 'rock' }).ok, false);
});

test('old industrial plans reset without migrating their graph schema', () => {
  const reset = Graph.create({ version: 3, nodes: [{ id: 'legacy', type: 'smelter', x: 2, y: 4 }],
    connections: [{ id: 'old-link', fromNodeId: 'legacy', toNodeId: 'legacy' }] });
  assert.equal(reset.version, Data.config.version);
  assert.deepEqual(plain(reset.machines), []);
});

test('the crusher processes six whole units per second and the rock keeps its composition', () => {
  const graph = Graph.create(), crusher = machine(graph, 'crusher', 'crusher');
  crusher.inputBuffer.rock = 10;
  crusher.inputMix = { rock: { iron: .2, rock: .8 } };
  advance(graph, 1);
  assert.equal(crusher.inputBuffer.rock, 4);
  assert.equal(crusher.outputBuffer.rock, 6);
  assert.deepEqual(plain(crusher.outputMix.rock), { iron: .2, rock: .8 });
});

test('the drill extracts raw rock with the composition of the ground below the extractor', () => {
  const graph = chain({ iron: .2, copper: .05, oil: .3, rock: .45 });
  advance(graph, 1);
  const crusher = graph.machines.find(item => item.id === 'crusher');
  assert.ok(crusher.inputBuffer.rock > 0 || crusher.outputBuffer.rock > 0);
  const composition = crusher.inputBuffer.rock ? crusher.inputMix.rock : crusher.outputMix.rock;
  assert.equal(composition.oil, undefined, 'no oil in rock');
  assert.ok(Math.abs(composition.iron - .2 / .7) < .001, JSON.stringify(composition));
});

test('mixing rock averages its composition, weighted by units', () => {
  assert.deepEqual(plain(Mix.blend({ iron: .4, rock: .6 }, 30, { copper: .2, rock: .8 }, 10)),
    { iron: .3, rock: .65, copper: .05 });
  const stock = {};
  Mix.add(stock, 'raw_rock', 'raw_rock', 0, 5, { iron: .5, rock: .5 });
  Mix.add(stock, 'raw_rock', 'raw_rock', 5, 5, { rock: 1 });
  assert.deepEqual(plain(stock.raw_rock), { iron: .25, rock: .75 });
  Mix.add(stock, 'raw_iron', 'raw_iron', 0, 5, { iron: 1 });
  assert.equal(stock.raw_iron, undefined, 'refined goods carry no composition');
});

test('a separator recovers its material in proportion to the grade; the rest leaves as depleted tailings', () => {
  for (const [grade, low, high] of [[.3, 26, 28], [.1, 8, 10], [0, 0, 0]]) {
    const graph = Graph.create(), separator = machine(graph, 'separator', 'magnetic_separator');
    let concentrate = 0, tailings = 0;
    for (let batch = 0; batch < 20; batch++) {
      separator.inputBuffer.rock = 5; separator.inputMix = { rock: { iron: grade, rock: 1 - grade } };
      advance(graph, 2.5);
      concentrate += separator.outputBuffer.concentrate; tailings += separator.outputBuffer.residue;
      separator.outputBuffer.concentrate = 0; separator.outputBuffer.residue = 0;
    }
    assert.ok(concentrate >= low && concentrate <= high, `${grade}: ${concentrate} concentrate out of 100 rock`);
    assert.equal(concentrate + tailings, 100, 'units are conserved');
    if (grade) assert.ok((separator.outputMix.residue?.iron || 0) < grade, 'tailings hold less iron than the rock');
  }
});

test('the furnace smelts concentrate 2:1, the rolling mill makes one plate from ten raw iron', () => {
  const graph = Graph.create();
  const furnace = machine(graph, 'furnace', 'reduction_furnace', 0, 'iron');
  furnace.inputBuffer.concentrate = 4;
  advance(graph, 2);
  assert.equal(furnace.outputBuffer.product, 2);
  assert.equal(furnace.outputBuffer.slag, 2);
  const mill = machine(graph, 'mill', 'rolling_mill', 300);
  mill.inputBuffer.iron = 20;
  advance(graph, 10);
  assert.equal(mill.outputBuffer.plate, 2);
  assert.equal(mill.inputBuffer.iron, 0);
});

test('tar cooks crushed rock with coal: 4 + 1 give one tar and three waste', () => {
  const graph = Graph.create(), furnace = machine(graph, 'tar', 'tar_furnace');
  furnace.inputBuffer.rock = 8; furnace.inputBuffer.coal = 2;
  advance(graph, 4);
  assert.equal(furnace.outputBuffer.tar, 2);
  assert.equal(furnace.outputBuffer.waste, 6);
  assert.equal(furnace.inputBuffer.coal, 0);
});

test('silicon washing follows the grade, dries 1:1 and uses the silicon furnace', () => {
  const graph = Graph.create();
  machine(graph, 'water', 'water_supply');
  const washer = machine(graph, 'washer', 'silicon_washer', 300);
  const dryer = machine(graph, 'dryer', 'silicon_dryer', 600);
  const furnace = machine(graph, 'furnace', 'reduction_furnace', 900, 'silicon');
  washer.inputBuffer.rock = 20; washer.inputMix = { rock: { silicon: .5, rock: .5 } };
  connect(graph, 'water-washer', 'water', 'water', 'washer', 'water');
  connect(graph, 'washer-dryer', 'washer', 'wet_silicon', 'dryer', 'wet_silicon');
  connect(graph, 'dryer-furnace', 'dryer', 'dry_silicon', 'furnace', 'dry_silicon');
  for (let i = 0; i < 30; i++) advance(graph, 1);
  assert.equal(washer.outputBuffer.residue, 11, '20 rock at 50 % silicon leave 9 wet silicon and 11 tailings');
  assert.ok(furnace.outputBuffer.product >= 4);
  assert.ok(integral(graph));
});

test('carbon washing and petroleum separation keep their fixed yields', () => {
  const carbonGraph = Graph.create();
  machine(carbonGraph, 'water', 'water_supply');
  const washer = machine(carbonGraph, 'washer', 'carbon_washer', 300);
  washer.inputBuffer.coal = 20;
  connect(carbonGraph, 'water-washer', 'water', 'water', 'washer', 'water');
  advance(carbonGraph, 10);
  assert.equal(washer.outputBuffer.carbon, 8);
  assert.equal(washer.outputBuffer.sludge, 12);

  const oilGraph = Graph.create({ geology: { resourceId: 'oil' } });
  machine(oilGraph, 'pump', 'oil_pump', 0, 'oil');
  const separator = machine(oilGraph, 'separator', 'triphasic_separator', 300, 'oil');
  connect(oilGraph, 'pump-separator', 'pump', 'raw_oil', 'separator', 'raw_oil');
  advance(oilGraph, 10);
  assert.equal(separator.outputBuffer.oil, 16);
  assert.equal(separator.outputBuffer.gas, 3);
  assert.equal(separator.outputBuffer.waste, 1);
});

test('the whole rock line runs at six units per second and energy shortage slows it down', () => {
  const graph = chain();
  advance(graph, 3);
  for (const id of ['crusher', 'grinder', 'separator']) assert.equal(graph.machines.find(item => item.id === id).currentRate, 6, id);
  advance(graph, 2);
  assert.ok(graph.machines.find(item => item.id === 'furnace').outputBuffer.product > 0);
  const starved = chain();
  advance(starved, 3, { energyAvailableMW: Simulation.demand(starved) / 2 });
  const starvedRate = starved.machines.find(item => item.id === 'separator').currentRate;
  assert.ok(starvedRate > 0 && starvedRate < 6, `half the power slows the separator (${starvedRate})`);
  assert.ok(integral(graph) && integral(starved));
});

test('an unconnected byproduct can fill its buffer and stops the recipe safely', () => {
  const graph = Graph.create(), separator = machine(graph, 'separator', 'magnetic_separator');
  separator.inputBuffer.rock = 20; separator.outputBuffer.residue = 18;
  advance(graph, 2);
  assert.equal(separator.state, 'output_full');
  assert.equal(separator.inputBuffer.rock, 20);
});

test('machines show the four essential states and stop without power', () => {
  const graph = Graph.create(), crusher = machine(graph, 'crusher', 'crusher');
  crusher.inputBuffer.rock = 10;
  advance(graph, .5, { energyAvailableMW: 0 });
  assert.equal(crusher.state, 'no_energy');
  advance(graph, .5);
  assert.equal(crusher.state, 'active');
  assert.equal(machine(graph, 'grinder', 'grinder').state, 'waiting_input');
});

test('graph snapshots keep connections, buffers, compositions and yield credit', () => {
  const graph = chain();
  advance(graph, 6);
  const restored = Graph.create(plain(Graph.snapshot(graph)));
  assert.deepEqual(plain(restored.connections), plain(graph.connections));
  for (const original of graph.machines) {
    const copy = restored.machines.find(item => item.id === original.id);
    assert.deepEqual(plain(copy.inputBuffer), plain(original.inputBuffer));
    assert.deepEqual(plain(copy.inputMix), plain(original.inputMix));
    assert.deepEqual(plain(copy.yieldCredit), plain(original.yieldCredit));
  }
});

test('the drill only works in an extractor, with a receiver and power', () => {
  const noGround = Graph.create();
  machine(noGround, 'drill', 'drill'); machine(noGround, 'crusher', 'crusher');
  connect(noGround, 'c1', 'drill', 'rock', 'crusher', 'rock');
  advance(noGround, .5);
  assert.equal(noGround.machines[0].state, 'waiting_input');

  const alone = Graph.create({ geology: { resourceId: 'rock', composition: IRON_ROCK } });
  machine(alone, 'drill', 'drill');
  advance(alone, .5);
  assert.equal(alone.machines[0].state, 'waiting_input');

  const unpowered = chain();
  advance(unpowered, .5, { energyAvailableMW: 0 });
  assert.equal(unpowered.machines[0].state, 'no_energy');
});

test('a saturated crusher pauses the drill without discarding rock', () => {
  const graph = chain(), crusher = graph.machines.find(item => item.id === 'crusher');
  crusher.outputBuffer.rock = Data.config.outputCapacity;
  graph.connections = graph.connections.filter(link => link.id === 'c1');
  advance(graph, .5);
  assert.equal(graph.machines[0].state, 'output_full');
  assert.equal(crusher.inputBuffer.rock, 0);
});

test('an extractor drills rock with the composition recorded at placement', () => {
  const extractor = { id: 'extractor-1', type: 'extractor', resourceId: 'iron', composition: { iron: .25, rock: .75 },
    planetId: 'planet-1', x: 25, y: 30, constructionState: 'complete', dockDestinations: { raw_rock: 'colony' } };
  const wind = { id: 'wind-1', type: 'wind_turbine', planetId: 'planet-1', constructionState: 'complete' };
  const state = { seed: 'factory-seed', surfaceBuildings: [extractor, wind], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, extractor);
  assert.equal(graph.geology.resourceId, 'rock');
  assert.deepEqual(plain(graph.geology.composition), { iron: .25, rock: .75 });
  machine(graph, 'drill', 'drill');
  machine(graph, 'dock', 'output_dock', 300);
  connect(graph, 'c1', 'drill', 'rock', 'dock', 'material');
  Industry.advance(state, 3);
  assert.ok(extractor.dockStock.raw_rock > 0);
  assert.deepEqual(plain(extractor.dockMix.raw_rock), { iron: .25, rock: .75 });
});

test('an offshore oil platform receives its own pump process graph', () => {
  const platform = { id: 'oil-platform-1', type: 'oil_platform', resourceId: 'oil', planetId: 'planet-1',
    x: 25, y: 30, constructionState: 'complete' };
  const wind = { id: 'wind-oil', type: 'wind_turbine', planetId: 'planet-1', constructionState: 'complete' };
  const state = { seed: 'factory-seed', surfaceBuildings: [platform, wind], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, platform);
  const pump = machine(graph, 'pump', 'oil_pump');
  machine(graph, 'separator', 'triphasic_separator', 300);
  connect(graph, 'pump-separator', 'pump', 'raw_oil', 'separator', 'raw_oil');
  assert.equal(graph.geology.resourceId, 'oil');
  Industry.advance(state, 1);
  assert.equal(pump.state, 'active');
});

test('the old terril card still stores what reaches it, and demolition returns it', () => {
  const graph = Graph.create();
  const terril = machine(graph, 'terril', 'terril');
  terril.storedResources = { crushed_rock: 12, copper_concentrate: 5 };
  const restored = Graph.create(Graph.snapshot(graph));
  assert.deepEqual(plain(restored.machines[0].storedResources), terril.storedResources);
  const state = { seed: 'terril-stock', factoryPlans: { factory: restored }, colonyMaterials: [] };
  Industry.reclaimBuilding(state, { id: 'factory', type: 'factory' });
  assert.deepEqual(plain(state.colonyMaterials.map(stack => [stack.resourceId, stack.amount]).sort()), [
    ['copper_concentrate', 5], ['crushed_rock', 12]
  ]);
});

test('an input dock passes received rock on, with its composition', () => {
  const factory = { id: 'receiver', type: 'factory', planetId: 'planet', constructionState: 'complete',
    inventory: { raw_rock: 7 }, inventoryMix: { raw_rock: { copper: .4, rock: .6 } } };
  const wind = { id: 'wind', type: 'wind_turbine', planetId: 'planet', constructionState: 'complete' };
  const state = { seed: 'import', factoryPlans: {}, surfaceBuildings: [factory, wind] };
  const graph = Industry.ensureGraph(state, factory);
  machine(graph, 'input', 'input_dock');
  const crusher = machine(graph, 'crusher', 'crusher');
  Industry.ensureGraph(state, factory);
  assert.equal(Graph.definitionOf(graph.machines[0]).outputPorts[0].resourceId, 'raw_rock');
  connect(graph, 'import-crusher', 'input', 'material', 'crusher', 'rock');
  for (let i = 0; i < 10; i++) Industry.advance(state, 1);
  assert.equal(factory.inventory.raw_rock || 0, 0);
  assert.equal(crusher.outputBuffer.rock, 7);
  assert.deepEqual(plain(crusher.outputMix.rock), { copper: .4, rock: .6 });
  assert.equal(graph.geology, null, 'a factory never drills');
});

test('thousands of rock units on the move keep one composition per stock', () => {
  const composition = { iron: .2, copper: .1, rock: .7 };
  const extractor = { id: 'e', type: 'extractor', planetId: 'p', x: 0, y: 0, constructionState: 'complete', composition,
    dockDestinations: { iron_concentrate: 'factory', tailings: 'heap' } };
  const wind = { id: 'w', type: 'wind_turbine', planetId: 'p', constructionState: 'complete' };
  const state = { seed: 'mass', surfaceBuildings: [extractor, wind], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, extractor);
  machine(graph, 'drill', 'drill'); machine(graph, 'crusher', 'crusher'); machine(graph, 'grinder', 'grinder');
  machine(graph, 'separator', 'magnetic_separator');
  machine(graph, 'dock-c', 'output_dock'); machine(graph, 'dock-t', 'output_dock');
  connect(graph, 'c1', 'drill', 'rock', 'crusher', 'rock');
  connect(graph, 'c2', 'crusher', 'rock', 'grinder', 'rock');
  connect(graph, 'c3', 'grinder', 'rock', 'separator', 'rock');
  connect(graph, 'c4', 'separator', 'concentrate', 'dock-c', 'material');
  connect(graph, 'c5', 'separator', 'residue', 'dock-t', 'material');
  for (let i = 0; i < 1500; i++) Industry.advance(state, 1);
  assert.ok(extractor.dockStock.tailings > 2000, `${extractor.dockStock.tailings} tailings`);
  assert.deepEqual(Object.keys(extractor.dockMix), ['tailings'], 'concentrate is refined: no composition kept');
  assert.ok(extractor.dockMix.tailings.iron < composition.iron && extractor.dockMix.tailings.copper > composition.copper,
    JSON.stringify(extractor.dockMix.tailings));
  const mixCount = graph.machines.reduce((sum, item) => sum + Object.keys(item.inputMix).length + Object.keys(item.outputMix).length, 0);
  assert.ok(mixCount <= 8, `${mixCount} compositions held for thousands of units`);
});

test('a pumping station pumps the water of its shore: salt water faster than fresh water', () => {
  const rates = {};
  for (const resourceId of ['salt_water', 'water']) {
    const station = { id: `station-${resourceId}`, type: 'water_station', resourceId, planetId: 'planet-1',
      x: 25, y: 30, constructionState: 'complete', dockDestinations: { [resourceId]: 'factory' } };
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

test('the waste heap reprocesses tailings at a low yield, or burns waste for energy', () => {
  const heap = { id: 'heap-1', type: 'waste_heap', planetId: 'planet-1', x: 0, y: 0, constructionState: 'complete',
    inventory: { tailings: 40, waste: 40 }, inventoryMix: { tailings: { iron: .1, rock: .9 } } };
  const wind = { id: 'wind-heap', type: 'wind_turbine', planetId: 'planet-1', constructionState: 'complete' };
  const state = { seed: 'heap-seed', surfaceBuildings: [heap, wind], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, heap);
  const tailings = machine(graph, 'dock-tailings', 'input_dock');
  tailings.importResourceId = 'tailings';
  const reprocessor = machine(graph, 'reprocessor', 'reprocessor', 300);
  connect(graph, 'tailings-reprocessor', 'dock-tailings', 'material', 'reprocessor', 'waste');
  const waste = machine(graph, 'dock-waste', 'input_dock', 0);
  waste.importResourceId = 'waste';
  const incinerator = machine(graph, 'incinerator', 'incinerator', 600);
  connect(graph, 'waste-incinerator', 'dock-waste', 'material', 'incinerator', 'waste');
  for (let second = 0; second < 12; second++) Industry.advance(state, 1);
  assert.equal(incinerator.state, 'active');
  assert.ok(heap.inventory.waste < 40);
  assert.ok(heap.energyOutputWatts > 0, 'burning waste feeds the grid');
  assert.ok(reprocessor.outputBuffer.rock >= 1, 'ten tailings give one ground rock');
  assert.deepEqual(plain(reprocessor.outputMix.rock), { iron: .1, rock: .9 });
});

test('an input dock feeds several cards and shares its stock between them', () => {
  const factory = { id: 'factory-share', type: 'factory', planetId: 'planet-1', x: 0, y: 0, constructionState: 'complete',
    inventory: { raw_rock: 60 } };
  const wind = { id: 'wind-share', type: 'wind_turbine', planetId: 'planet-1', constructionState: 'complete' };
  const state = { seed: 'share-seed', surfaceBuildings: [factory, wind], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, factory);
  const dock = machine(graph, 'dock-rock', 'input_dock', 0);
  dock.importResourceId = 'raw_rock';
  const first = machine(graph, 'crusher-a', 'crusher', 300), second = machine(graph, 'crusher-b', 'crusher', 600);
  connect(graph, 'dock-a', 'dock-rock', 'material', 'crusher-a', 'rock');
  connect(graph, 'dock-b', 'dock-rock', 'material', 'crusher-b', 'rock');
  assert.equal(Graph.connect(graph, { id: 'dock-a-again', fromMachineId: 'dock-rock', fromOutputId: 'material',
    toMachineId: 'crusher-a', toInputId: 'rock' }).ok, false, 'one link per pair of ports');
  for (let second = 0; second < 3; second++) Industry.advance(state, 1);
  assert.equal(first.state, 'active');
  assert.equal(second.state, 'active');
  const crushed = machine => machine.outputBuffer.rock;
  assert.ok(crushed(first) >= 12 && crushed(second) >= 12, `${crushed(first)} / ${crushed(second)}`);
  assert.ok(Math.abs(crushed(first) - crushed(second)) <= 2, `${crushed(first)} / ${crushed(second)}`);
});

test('an incinerator fed in bursts gives steady power', () => {
  const heap = { id: 'heap-burst', type: 'waste_heap', planetId: 'planet-1', x: 0, y: 0, constructionState: 'complete', inventory: {} };
  const state = { seed: 'burst-seed', surfaceBuildings: [heap], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, heap);
  const waste = machine(graph, 'dock-waste', 'input_dock', 0);
  waste.importResourceId = 'waste';
  machine(graph, 'incinerator', 'incinerator', 600);
  connect(graph, 'waste-incinerator', 'dock-waste', 'material', 'incinerator', 'waste');
  // Twenty waste every twenty seconds: half the incinerator's rate, in bursts.
  const supply = [];
  for (let second = 0; second < 240; second++) {
    if (second % 20 === 0) heap.inventory.waste = (heap.inventory.waste || 0) + 20;
    Industry.advance(state, 1);
    if (second >= 120) supply.push(heap.energyOutputWatts / 1e6);
  }
  const low = Math.min(...supply), high = Math.max(...supply);
  assert.ok(low > 2 && high < 6, `power stays near 4 MW (${low.toFixed(2)}–${high.toFixed(2)})`);
});

test('depot cards carry rock compositions through their gates', () => {
  const depot = { id: 'depot-mix', type: 'storage', planetId: 'planet-1', x: 0, y: 0, constructionState: 'complete',
    inventory: { raw_rock: 10 }, inventoryMix: { raw_rock: { iron: .3, rock: .7 } } };
  const state = { seed: 'depot-seed', surfaceBuildings: [depot], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, depot);
  machine(graph, 'in', 'depot_input');
  const gate = machine(graph, 'gate', 'depot_output', 300);
  gate.config = { destinationId: 'factory-a' };
  connect(graph, 'c1', 'in', 'out', 'gate', 'in');
  for (let second = 0; second < 10; second++) Industry.advance(state, 1);
  assert.equal(depot.gateStock['factory-a'].raw_rock, 10);
  assert.deepEqual(plain(depot.gateMix['factory-a'].raw_rock), { iron: .3, rock: .7 });
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

test('an output dock takes several links of one same resource, never two resources', () => {
  const graph = Graph.create();
  const a = machine(graph, 'a', 'crusher'), b = machine(graph, 'b', 'crusher', 100);
  machine(graph, 'grinder', 'grinder', 200);
  machine(graph, 'dock', 'output_dock', 300);
  connect(graph, 'a-dock', 'a', 'rock', 'dock', 'material');
  connect(graph, 'b-dock', 'b', 'rock', 'dock', 'material');
  assert.equal(Graph.connect(graph, { id: 'g-dock', fromMachineId: 'grinder', fromOutputId: 'rock',
    toMachineId: 'dock', toInputId: 'material' }).ok, false, 'ground rock is another resource');
  a.outputBuffer.rock = 3; b.outputBuffer.rock = 4;
  const building = { id: 'factory', type: 'factory', constructionState: 'complete', inventory: {}, dockStock: {},
    dockDestinations: { crushed_rock: 'colony' } };
  const state = { seed: 'docks', surfaceBuildings: [building], factoryPlans: { factory: graph } };
  Industry.advance(state, .1);
  assert.equal(building.dockStock.crushed_rock, 7);
});

test('one drill per extractor', () => {
  const graph = Graph.create({ geology: { resourceId: 'rock', composition: IRON_ROCK } });
  machine(graph, 'drill', 'drill');
  const second = Graph.addMachine(graph, { id: 'drill-2', type: 'drill', x: 0, y: 0 });
  assert.equal(second.ok, false);
  assert.match(second.reason, /1 par bâtiment/);
});

test('an output dock without a destination takes nothing and stops what feeds it', () => {
  const extractor = { id: 'e2', type: 'extractor', planetId: 'p', x: 0, y: 0, constructionState: 'complete', composition: IRON_ROCK };
  const wind = { id: 'w2', type: 'wind_turbine', planetId: 'p', constructionState: 'complete' };
  const state = { seed: 'closed', surfaceBuildings: [extractor, wind], factoryPlans: {} };
  const graph = Industry.ensureGraph(state, extractor);
  const drill = machine(graph, 'drill', 'drill');
  const dock = machine(graph, 'dock', 'output_dock', 300);
  connect(graph, 'c', 'drill', 'rock', 'dock', 'material');
  for (let i = 0; i < 5; i++) Industry.advance(state, 1);
  assert.equal(extractor.dockStock?.raw_rock || 0, 0, 'nothing absorbed');
  assert.equal(dock.state, 'no_destination');
  assert.notEqual(drill.state, 'active');
  extractor.dockDestinations = { raw_rock: 'colony' };
  for (let i = 0; i < 2; i++) Industry.advance(state, 1);
  assert.ok(extractor.dockStock.raw_rock > 0, 'it works once its resource has a destination');
});

test('a blueprint keeps a region of cards and their links, and comes back with fresh ids', () => {
  const Library = context.OrbitLibrary;
  const graph = Graph.create({ version: Data.config.version });
  machine(graph, 'dock', 'input_dock', 100).importResourceId = 'raw_rock';
  machine(graph, 'crusher', 'crusher', 400);
  machine(graph, 'grinder', 'grinder', 700);
  connect(graph, 'a', 'dock', 'material', 'crusher', 'rock');
  connect(graph, 'b', 'crusher', 'rock', 'grinder', 'rock');
  const blueprint = Library.blueprint('  Ligne   ', 'factory', graph, ['dock', 'crusher']);
  assert.equal(blueprint.name, 'Ligne');
  assert.deepEqual(plain(blueprint.machines.map(item => [item.type, item.dx])), [['input_dock', 0], ['crusher', 300]]);
  assert.equal(blueprint.connections.length, 1, 'only links inside the region');
  let next = 0;
  const placed = Library.instantiate(blueprint, { origin: { x: 50, y: 60 }, machineId: () => `m-${++next}`, connectionId: () => 'l-1' });
  const copy = Graph.create({ version: Data.config.version, ...placed });
  assert.deepEqual(plain(copy.machines.map(item => [item.id, item.type, item.x, item.y])), [['m-1', 'input_dock', 50, 60], ['m-2', 'crusher', 350, 60]]);
  assert.equal(copy.machines[0].importResourceId, 'raw_rock');
  assert.equal(copy.connections.length, 1);
  const library = Library.normalize({ buildings: [Library.buildingTemplate({ type: 'factory', customName: 'Usine 1' }, graph)], blueprints: [blueprint, { bad: true }] });
  assert.equal(library.buildings[0].plan.machines.length, 3);
  assert.equal(library.blueprints.length, 1);
});
