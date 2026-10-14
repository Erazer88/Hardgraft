'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({});
for (const relative of [
  'data/resources.js', 'data/processes.js', 'simulation/resourceStack.js',
  'simulation/processGraph.js', 'simulation/recipeResolver.js', 'simulation/processSimulation.js',
  'simulation/inventory.js', 'gameplay/industry.js'
]) vm.runInContext(readFileSync(resolve(__dirname, '../src', relative), 'utf8'), context);

const Data = context.OrbitProcessData;
const Stack = context.OrbitResourceStack;
const Block = context.OrbitProcessBlock;
const Graph = context.OrbitProcessGraph;
const Resolver = context.OrbitRecipeResolver;
const Simulation = context.OrbitProcessSimulation;
const Industry = context.OrbitIndustry;
const plain = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
const material = (resourceId, amount, extra = {}) => Stack.create({ resourceId, amount, ...extra });
const makeGraph = (types, options = {}) => Graph.create({
  ...options,
  nodes: types.map((type, index) => ({ id: `n${index + 1}`, type, x: index * 260, y: 0,
    ...(options.nodes?.[index] || {}) }))
});
const node = (graph, id = 'n1') => graph.nodes.find(item => item.id === id);
const feed = (target, port, stack) => { target.internalBuffer.inputs[port] = Stack.create(stack); };
const outputs = packet => packet.outputs.map(item => ({ port: item.port, stack: item.stack }));
const outputAt = (packet, port) => packet.outputs.find(item => item.port === port)?.stack || null;
const inputMass = packet => packet.inputs.reduce((sum, item) => sum + item.amount, 0);
const outputMass = packet => Stack.total(packet.outputs.map(item => item.stack));
const assertConservative = packet => close(outputMass(packet), inputMass(packet));
const link = (graph, fromNodeId, toNodeId, id, fromPort = 0, toPort = 0) => {
  const result = Graph.connect(graph, { id, fromNodeId, toNodeId, fromPort, toPort });
  assert.equal(result.ok, true, result.reason);
  return graph.connections.at(-1);
};
const advance = (graph, seconds, context = { energyUnlimited: true }) => Simulation.advance(graph, seconds, context);

test('catalogue covers the V1 industrial and petroleum block set', () => {
  const required = ['input', 'drill', 'crusher', 'grinder', 'screen', 'magnetic_sorter', 'gravity_sorter',
    'silicon_washer', 'silicon_dryer', 'coal_sorter', 'coal_washer', 'smelter', 'refiner', 'storage',
    'splitter', 'merger', 'dock', 'dump', 'waste_analyzer', 'oil_pump', 'triphasic_separator'];
  for (const type of required) assert.ok(Data.get(type), `${type} is defined`);
  assert.equal(Data.get('quality_analyzer').enabled, false);
  assert.equal(Data.catalog('oil_platform').some(item => item.id === 'magnetic_sorter'), false);
});

test('resource stacks canonicalize legacy ids and preserve weighted metadata', () => {
  const first = material('iron', 8, { quality: 'superior', moisture: .2, composition: { iron: .8 } });
  const second = material('standard_iron', 2, { quality: 'standard', moisture: .7, composition: { iron: 1 } });
  assert.equal(first.resourceId, 'standard_iron');
  const merged = Stack.merge(first, second);
  assert.equal(merged.resourceId, 'standard_iron');
  assert.equal(merged.quality, 'standard');
  close(merged.moisture, .3);
  close(merged.amount, 10);
  assert.throws(() => Stack.merge(first, material('standard_copper', 1)), /Cannot merge different resources/);
});

test('graph links are directional, allow shared inputs, and require real ports', () => {
  const graph = makeGraph(['input', 'input', 'crusher', 'crusher', 'drill']);
  assert.equal(Graph.connect(graph, { id: 'l1', fromNodeId: 'n1', fromPort: 0, toNodeId: 'n3', toPort: 0 }).ok, true);
  assert.match(Graph.connect(graph, { id: 'l2', fromNodeId: 'n1', fromPort: 0, toNodeId: 'n4', toPort: 0 }).reason, /Division/);
  assert.equal(Graph.connect(graph, { id: 'l3', fromNodeId: 'n2', fromPort: 0, toNodeId: 'n3', toPort: 0 }).ok, true);
  assert.equal(graph.connections[1].toSlot, 1);
  assert.match(Graph.connect(graph, { id: 'l4', fromNodeId: 'n4', fromPort: 0, toNodeId: 'n3', toPort: 0, toSlot: 0 }).reason, /point d’entrée/i);
  assert.equal(Graph.connect(graph, { id: 'self', fromNodeId: 'n3', fromPort: 0, toNodeId: 'n3', toPort: 0 }).ok, false);
  assert.equal(Graph.connect(graph, { id: 'no-input', fromNodeId: 'n3', fromPort: 0, toNodeId: 'n5', toPort: 0 }).ok, false);
});

test('crusher turns raw rock into fragments without changing its mass or composition', () => {
  const graph = makeGraph(['crusher']), crusher = node(graph);
  feed(crusher, 0, material('raw_rock', 10, { composition: { iron: .52, copper: .08, sterile: .4 } }));
  const before = Graph.materialTotal(graph), packet = Resolver.resolve(crusher, graph);
  assert.equal(packet.ready, true); assert.equal(outputAt(packet, 0).resourceId, 'rock_fragments');
  assert.equal(outputAt(packet, 0).particleSize, 'fragment'); assertConservative(packet);
  advance(graph, 1.1);
  assert.equal(crusher.internalBuffer.outputs[0].resourceId, 'rock_fragments');
  close(crusher.internalBuffer.outputs[0].amount, 10); close(Graph.materialTotal(graph), before);
});

test('grinder accepts raw rock slowly and rejects already powdered material unchanged', () => {
  const graph = makeGraph(['grinder']), grinder = node(graph);
  feed(grinder, 0, material('raw_rock', 10));
  const raw = Resolver.resolve(grinder, graph);
  assert.equal(raw.mode, 'degraded'); assert.equal(outputAt(raw, 0).resourceId, 'rock_powder');
  assert.ok(raw.duration > 1); assert.ok(raw.energyUse > Data.get('grinder').energyUse);
  assertConservative(raw);
  feed(grinder, 0, material('rock_powder', 10, { particleSize: 'powder' }));
  const powder = Resolver.resolve(grinder, graph);
  assert.equal(powder.mode, 'useless'); assert.equal(outputAt(powder, 0).resourceId, 'rock_powder');
  assertConservative(powder);
});

test('screen routes raw and processed grain sizes to different outputs', () => {
  const graph = makeGraph(['screen']), screen = node(graph);
  feed(screen, 0, material('raw_rock', 4, { particleSize: 'raw' }));
  let packet = Resolver.resolve(screen, graph);
  assert.equal(outputAt(packet, 0).particleSize, 'raw'); assert.equal(outputAt(packet, 1), null); assertConservative(packet);
  feed(screen, 0, material('rock_fragments', 4, { particleSize: 'fragment' }));
  packet = Resolver.resolve(screen, graph);
  assert.equal(outputAt(packet, 0), null); assert.equal(outputAt(packet, 1).particleSize, 'fragment'); assertConservative(packet);
});

test('magnetic and gravity sorters recover the matching geological fraction and conserve mass', () => {
  for (const [type, element, resource] of [['magnetic_sorter', 'iron', 'impure_iron'],
    ['gravity_sorter', 'copper', 'impure_copper']]) {
    const graph = makeGraph([type]), sorter = node(graph);
    feed(sorter, 0, material('rock_fragments', 100, { particleSize: 'fragment',
      composition: { iron: .52, copper: .08, silicon: .14, carbon: .03, sterile: .23 } }));
    const packet = Resolver.resolve(sorter, graph), product = outputAt(packet, 0), reject = outputAt(packet, 1);
    assert.equal(product.resourceId, resource); assert.ok(product.amount > 0);
    assert.ok(reject.amount > product.amount); assertConservative(packet);
    const processed = Stack.portion(sorter.internalBuffer.inputs[0], inputMass(packet));
    close(Stack.recoverableAmount(reject, element) + Stack.recoverableAmount(product, element),
      Stack.recoverableAmount(processed, element));
  }
});

test('silicon washer waits for water, then emits wet silicon and sludge conservatively', () => {
  const graph = makeGraph(['silicon_washer']), washer = node(graph);
  feed(washer, 0, material('rock_fragments', 20, { particleSize: 'fragment',
    composition: { iron: .08, copper: .04, silicon: .58, carbon: .03, sterile: .27 } }));
  let packet = Resolver.resolve(washer, graph);
  assert.equal(packet.ready, false); assert.equal(packet.state, 'missing_input'); assert.match(packet.message, /EAU/);
  feed(washer, 1, material('water', 5)); packet = Resolver.resolve(washer, graph);
  assert.equal(packet.ready, true); assert.equal(outputAt(packet, 0).resourceId, 'impure_silicon');
  assert.equal(outputAt(packet, 0).moisture, .8); assert.equal(outputAt(packet, 1).resourceId, 'sludge');
  assertConservative(packet);
});

test('silicon dryer removes moisture but does not change mass', () => {
  const graph = makeGraph(['silicon_dryer']), dryer = node(graph);
  feed(dryer, 0, material('impure_silicon', 7, { moisture: .8 }));
  const packet = Resolver.resolve(dryer, graph);
  assert.equal(outputAt(packet, 0).resourceId, 'impure_silicon');
  assert.equal(outputAt(packet, 0).moisture, 0); assertConservative(packet);
});

test('coal sorter and washer separate carbon, while the washer requires water', () => {
  const sorterGraph = makeGraph(['coal_sorter']), sorter = node(sorterGraph);
  feed(sorter, 0, material('rock_fragments', 20, { particleSize: 'fragment',
    composition: { iron: .06, copper: .03, silicon: .12, carbon: .52, sterile: .27 } }));
  const sorted = Resolver.resolve(sorter, sorterGraph);
  assert.equal(outputAt(sorted, 0).resourceId, 'coal'); assert.ok(outputAt(sorted, 0).amount > 0); assertConservative(sorted);

  const washGraph = makeGraph(['coal_washer']), washer = node(washGraph);
  feed(washer, 0, material('coal', 10));
  assert.equal(Resolver.resolve(washer, washGraph).state, 'missing_input');
  feed(washer, 1, material('water', 10));
  const washed = Resolver.resolve(washer, washGraph);
  assert.equal(outputAt(washed, 0).resourceId, 'carbon'); assert.equal(outputAt(washed, 1).resourceId, 'sludge');
  assertConservative(washed);
});

test('smelter waits for carbon, converts prepared iron, and routes raw ore to waste', () => {
  const graph = makeGraph(['smelter']), smelter = node(graph);
  feed(smelter, 0, material('impure_iron', 10));
  let packet = Resolver.resolve(smelter, graph);
  assert.equal(packet.state, 'missing_input'); assert.match(packet.message, /CARBONE/);
  feed(smelter, 1, material('carbon', 4)); packet = Resolver.resolve(smelter, graph);
  assert.equal(packet.ready, true); assert.equal(outputAt(packet, 0).resourceId, 'standard_iron');
  assert.equal(outputAt(packet, 1).resourceId, 'waste'); assertConservative(packet);

  feed(smelter, 0, material('raw_rock', 10)); packet = Resolver.resolve(smelter, graph);
  assert.equal(packet.mode, 'destructive'); assert.equal(outputAt(packet, 1).resourceId, 'waste');
  assertConservative(packet);
});

test('refiner produces steel and pure copper, while impure feed is degraded', () => {
  const graph = makeGraph(['refiner']), refiner = node(graph);
  feed(refiner, 0, material('standard_iron', 10)); feed(refiner, 1, material('carbon', 2));
  let packet = Resolver.resolve(refiner, graph);
  assert.equal(outputAt(packet, 0).resourceId, 'steel'); assertConservative(packet);
  feed(refiner, 0, material('standard_copper', 10)); packet = Resolver.resolve(refiner, graph);
  assert.equal(outputAt(packet, 0).resourceId, 'pure_copper'); assertConservative(packet);
  feed(refiner, 0, material('impure_iron', 10)); packet = Resolver.resolve(refiner, graph);
  assert.equal(packet.mode, 'degraded'); assert.equal(outputAt(packet, 0).resourceId, 'standard_iron');
  assertConservative(packet);
});

test('invalid feeds are either unchanged, destructive, or physically refused as specified', () => {
  const washerGraph = makeGraph(['coal_washer']), washer = node(washerGraph);
  feed(washer, 0, material('raw_rock', 10));
  let packet = Resolver.resolve(washer, washerGraph);
  assert.equal(packet.mode, 'useless'); assert.equal(outputAt(packet, 0).resourceId, 'raw_rock'); assertConservative(packet);

  const graph = makeGraph(['input', 'crusher']);
  const source = node(graph, 'n1'), crusher = node(graph, 'n2');
  source.internalBuffer.outputs[0] = material('gas', 10);
  const connection = link(graph, 'n1', 'n2', 'gas-to-crusher');
  const before = Graph.materialTotal(graph); advance(graph, .1);
  assert.equal(connection.state, 'incompatible'); assert.match(connection.message, /physique/i);
  assert.equal(source.internalBuffer.outputs[0].resourceId, 'gas');
  assert.equal(crusher.internalBuffer.inputs[0], null); close(Graph.materialTotal(graph), before);
});

test('storage enforces phase, filters, and a single-resource lock', () => {
  const graph = makeGraph(['storage']), storage = node(graph);
  assert.equal(Graph.acceptance(storage, 0, material('gas', 1)).ok, false);
  storage.settings.phase = 'gas';
  assert.equal(Graph.acceptance(storage, 0, material('gas', 1)).ok, true);
  storage.settings.filter = 'gas';
  assert.equal(Graph.acceptance(storage, 0, material('oil', 1)).ok, false);
  storage.settings.filter = null; feed(storage, 0, material('gas', 1));
  assert.equal(Graph.acceptance(storage, 0, material('oil', 1)).ok, false);
  assert.equal(Graph.acceptance(storage, 0, material('gas', 1)).ok, true);
});

test('splitter redistributes around a full branch and merger refuses different resources', () => {
  const graph = makeGraph(['splitter']), splitter = node(graph);
  splitter.settings.ratio = .9;
  feed(splitter, 0, material('rock_fragments', 30));
  splitter.internalBuffer.outputs[0] = material('rock_fragments', 20);
  let packet = Resolver.resolve(splitter, graph);
  assert.equal(outputAt(packet, 0), null); assert.ok(outputAt(packet, 1).amount > 0); assertConservative(packet);

  const mergeGraph = makeGraph(['merger']), merger = node(mergeGraph);
  feed(merger, 0, material('standard_iron', 10, { quality: 'superior' }));
  feed(merger, 1, material('standard_iron', 10, { quality: 'standard' }));
  packet = Resolver.resolve(merger, mergeGraph);
  assert.equal(outputAt(packet, 0).quality, 'standard'); assertConservative(packet);
  feed(merger, 1, material('standard_copper', 10)); packet = Resolver.resolve(merger, mergeGraph);
  assert.equal(packet.ready, false); assert.equal(packet.state, 'incompatible');
  close(Stack.total(merger.internalBuffer.inputs), 20);
});

test('dock blocks when its external stock is full, while dump retains waste history', () => {
  const dockGraph = makeGraph(['dock'], { exportStock: [material('waste', 500)] });
  const dock = node(dockGraph); feed(dock, 0, material('raw_rock', 5));
  assert.equal(Resolver.resolve(dock, dockGraph).state, 'output_blocked');

  const dumpGraph = makeGraph(['dump']), dump = node(dumpGraph);
  feed(dump, 0, material('raw_rock', 5)); const before = Graph.materialTotal(dumpGraph);
  advance(dumpGraph, 1.1);
  assert.equal(dump.internalBuffer.history.resourceId, 'waste');
  close(dump.internalBuffer.history.amount, 5); close(Graph.materialTotal(dumpGraph), before);
});

test('dock transfers accepted material to the finite export stock', () => {
  const graph = makeGraph(['dock']), dock = node(graph);
  feed(dock, 0, material('raw_rock', 5)); const before = Graph.materialTotal(graph);
  advance(graph, 1.1);
  assert.equal(graph.exportStock[0].resourceId, 'raw_rock');
  close(graph.exportStock[0].amount, 5); close(Graph.materialTotal(graph), before);
});

test('waste analyzer creates residual ore and reduces recoverable potential', () => {
  const graph = makeGraph(['waste_analyzer']), analyzer = node(graph);
  feed(analyzer, 0, material('waste', 100, { composition: { iron: .1, copper: .05, sterile: .85 },
    recoverableFraction: .15, particleSize: 'fragment' }));
  const packet = Resolver.resolve(analyzer, graph), residual = outputAt(packet, 0), depleted = outputAt(packet, 1);
  assert.equal(residual.resourceId, 'residual_ore_fragment');
  assert.equal(residual.reprocessingPasses, 1); assert.ok(depleted.recoverableFraction < .15);
  assertConservative(packet);
});

test('triphasic separator conserves crude oil across gas, oil, and waste outputs', () => {
  const graph = makeGraph(['triphasic_separator']), separator = node(graph);
  feed(separator, 0, material('raw_oil', 20, { composition: { oil: .8, gas: .15, sterile: .05 } }));
  const packet = Resolver.resolve(separator, graph);
  assert.equal(outputAt(packet, 0).resourceId, 'gas'); assert.equal(outputAt(packet, 1).resourceId, 'oil');
  assert.equal(outputAt(packet, 2).resourceId, 'waste'); assertConservative(packet);
});

test('oil pump only extracts from an oil deposit and creates crude at cycle completion', () => {
  const geology = { id: 'oil-field', planetId: 'p', resourceId: 'oil',
    composition: { oil: .8, gas: .15, sterile: .05 }, hardness: 1, moisture: .1, throughput: 8 };
  const graph = makeGraph(['oil_pump'], { geology }), pump = node(graph);
  const packet = Resolver.resolve(pump, graph);
  assert.equal(packet.ready, true); assert.equal(outputAt(packet, 0).resourceId, 'raw_oil');
  assert.equal(outputAt(packet, 0).amount, 8);
  advance(graph, 1.1);
  assert.equal(pump.internalBuffer.outputs[0].resourceId, 'raw_oil');
  close(pump.internalBuffer.outputs[0].amount, 8); close(graph.totalExtracted, 8);

  const invalidGraph = makeGraph(['oil_pump'], { geology: { ...geology, resourceId: 'iron' } });
  assert.equal(Resolver.resolve(node(invalidGraph), invalidGraph).state, 'missing_input');
});

test('quality analyzer stays disabled and cannot consume input', () => {
  const graph = makeGraph(['quality_analyzer']), analyzer = node(graph);
  feed(analyzer, 0, material('standard_iron', 3));
  const packet = Resolver.resolve(analyzer, graph);
  assert.equal(packet.ready, false); assert.equal(packet.state, 'waiting');
  assert.equal(analyzer.internalBuffer.inputs[0].amount, 3);
});

test('simulation preserves input without energy, then completes the smelting cycle with power', () => {
  const graph = makeGraph(['smelter']), smelter = node(graph);
  feed(smelter, 0, material('impure_iron', 10)); feed(smelter, 1, material('carbon', 2));
  const before = Graph.materialTotal(graph);
  advance(graph, .1, { energyAvailableMW: 0 });
  assert.equal(smelter.state, 'no_energy'); assert.equal(smelter.job, null);
  close(Graph.materialTotal(graph), before);
  advance(graph, 1.1);
  assert.equal(smelter.internalBuffer.outputs[0].resourceId, 'standard_iron');
  assert.equal(smelter.internalBuffer.outputs[1].resourceId, 'waste');
  close(Graph.materialTotal(graph), before);
});

test('transfers stop at the first block and respect the maximum connection rate transactionally', () => {
  const graph = makeGraph(['input', 'filter', 'filter']);
  const source = node(graph, 'n1'), middle = node(graph, 'n2'), destination = node(graph, 'n3');
  source.internalBuffer.outputs[0] = material('raw_rock', 10);
  link(graph, 'n1', 'n2', 'first'); link(graph, 'n2', 'n3', 'second');
  const before = Graph.materialTotal(graph); advance(graph, .1);
  assert.equal(middle.internalBuffer.outputs[0], null);
  assert.equal(destination.internalBuffer.inputs[0], null);
  assert.ok(middle.job || middle.internalBuffer.inputs[0]);
  close(Graph.materialTotal(graph), before);

  const blockedGraph = makeGraph(['input', 'crusher']);
  const blockedSource = node(blockedGraph, 'n1'), blockedTarget = node(blockedGraph, 'n2');
  blockedSource.internalBuffer.outputs[0] = material('raw_rock', 10);
  feed(blockedTarget, 0, material('raw_rock', 20));
  const blockedLink = link(blockedGraph, 'n1', 'n2', 'blocked');
  const blockedBefore = Graph.materialTotal(blockedGraph); advance(blockedGraph, .1);
  assert.equal(blockedLink.state, 'saturated');
  close(blockedSource.internalBuffer.outputs[0].amount, 10);
  close(Graph.materialTotal(blockedGraph), blockedBefore);
});

test('several sources share one input point group and its maximum throughput', () => {
  const graph = makeGraph(['input', 'input', 'crusher']);
  const first = node(graph, 'n1'), second = node(graph, 'n2'), crusher = node(graph, 'n3');
  first.internalBuffer.outputs[0] = material('raw_rock', 10);
  second.internalBuffer.outputs[0] = material('raw_rock', 10);
  link(graph, 'n1', 'n3', 'a-source'); link(graph, 'n2', 'n3', 'b-source');
  assert.deepEqual(plain(graph.connections.map(item => item.toSlot)), [0, 1]);
  const before = Graph.materialTotal(graph);
  advance(graph, .1);
  assert.ok(crusher.job);
  close(crusher.job.inputs[0].amount, Data.get('crusher').inputPorts[0].maxThroughput * .1);
  close(first.internalBuffer.outputs[0]?.amount + second.internalBuffer.outputs[0]?.amount, 18.8);
  close(Graph.materialTotal(graph), before);
});

test('building input stock enters the graph once and advances at the connection limit', () => {
  const graph = makeGraph(['input', 'crusher'], { externalStock: [material('raw_rock', 10)] });
  const importer = node(graph), crusher = node(graph, 'n2');
  link(graph, 'n1', 'n2', 'building-input');
  const before = Graph.materialTotal(graph); advance(graph, 1.1);
  assert.equal(graph.externalStock.length, 0);
  assert.equal(importer.internalBuffer.outputs[0].resourceId, 'raw_rock');
  close(importer.internalBuffer.outputs[0].amount, 8.8);
  assert.equal(crusher.job.inputs[0].resourceId, 'raw_rock');
  close(crusher.job.inputs[0].amount, 1.2); close(Graph.materialTotal(graph), before);
});

test('loops transfer at most one buffer snapshot per tick and preserve all material', () => {
  const graph = makeGraph(['filter', 'filter']);
  const first = node(graph), second = node(graph, 'n2');
  first.internalBuffer.outputs[0] = material('raw_rock', 5);
  second.internalBuffer.outputs[0] = material('raw_rock', 5);
  link(graph, 'n1', 'n2', 'loop-forward'); link(graph, 'n2', 'n1', 'loop-return');
  const before = Graph.materialTotal(graph); advance(graph, .1);
  assert.ok(first.job && second.job);
  close(first.job.inputs[0].amount, 1.2); close(second.job.inputs[0].amount, 1.2);
  close(Graph.materialTotal(graph), before);
});

test('simultaneous docks reserve export room so they cannot overfill the building stock', () => {
  const graph = makeGraph(['dock', 'dock'], { exportStock: [material('waste', 495)] });
  const first = node(graph), second = node(graph, 'n2');
  feed(first, 0, material('raw_rock', 10)); feed(second, 0, material('rock_fragments', 10));
  const before = Graph.materialTotal(graph); advance(graph, .1);
  assert.ok(first.job); assert.equal(second.job, null);
  advance(graph, 1.1);
  close(Stack.total(graph.exportStock), 500);
  close(Graph.materialTotal(graph), before);
});

test('fixed-step advance accumulates sub-tick time without running early', () => {
  const graph = makeGraph(['crusher']), crusher = node(graph);
  feed(crusher, 0, material('raw_rock', 2));
  advance(graph, .05);
  assert.equal(graph.tick, 0); close(graph.accumulator, .05);
  advance(graph, .05);
  assert.equal(graph.tick, 1); close(graph.accumulator, 0);
});

test('deleting an active block returns actual in-progress inputs but never planned products', () => {
  const graph = makeGraph(['smelter']), smelter = node(graph);
  feed(smelter, 0, material('impure_iron', 10)); feed(smelter, 1, material('carbon', 2));
  advance(graph, .1);
  assert.ok(smelter.job); const before = Graph.materialTotal(graph);
  assert.equal(Graph.removeNode(graph, smelter.id), true);
  close(Graph.materialTotal(graph), before);
  assert.equal(graph.externalStock.find(item => item.resourceId === 'impure_iron').amount, 10);
  assert.equal(graph.externalStock.find(item => item.resourceId === 'carbon').amount, 2);
  assert.equal(graph.externalStock.some(item => item.resourceId === 'standard_iron'), false);
});

test('unfinished geological cycles create no free ore and completed drill cycles account for extraction', () => {
  const geology = { id: 'deposit', planetId: 'p', resourceId: 'iron', composition: { iron: .52, copper: .08,
    silicon: .14, carbon: .03, sterile: .23 }, hardness: 1, moisture: .1, throughput: 10 };
  const graph = makeGraph(['drill'], { geology }), drill = node(graph);
  advance(graph, .1);
  assert.ok(drill.job); assert.equal(Graph.materialTotal(graph), 0); assert.equal(graph.totalExtracted, 0);
  Graph.removeNode(graph, drill.id);
  close(Graph.materialTotal(graph), 0); close(graph.totalExtracted, 0);

  const completed = makeGraph(['drill'], { geology }), completeDrill = node(completed);
  advance(completed, 1.1);
  assert.equal(completeDrill.internalBuffer.outputs[0].resourceId, 'raw_rock');
  close(completeDrill.internalBuffer.outputs[0].amount, 10);
  close(completed.totalExtracted, 10); close(Graph.materialTotal(completed), 10);
});

test('graph snapshots restore buffers, metadata, active jobs, connections, and material totals', () => {
  const graph = makeGraph(['input', 'crusher'], { externalStock: [material('water', 4, { moisture: .9 })] });
  const source = node(graph), crusher = node(graph, 'n2');
  source.internalBuffer.outputs[0] = material('raw_rock', 3, { composition: { iron: .7, sterile: .3 } });
  link(graph, 'n1', 'n2', 'saved-link'); feed(crusher, 0, material('rock_fragments', 2));
  advance(graph, .1);
  const before = Graph.materialTotal(graph), saved = Graph.snapshot(graph), restored = Graph.create(plain(saved));
  close(Graph.materialTotal(restored), before);
  assert.equal(restored.connections[0].fromPortId, 'product');
  assert.equal(restored.connections[0].toSlot, 0);
  assert.equal(restored.externalStock[0].moisture, .9);
  assert.equal(restored.nodes[1].job.inputs[0].resourceId, 'rock_fragments');
  assert.deepEqual(plain(Graph.snapshot(restored)), plain(saved));
});

test('colony reserve supplies building stock without spending, while a completed wind turbine powers it', () => {
  const state = { seed: 'test', inventory: { water: 100 }, factoryPlans: {}, surfaceBuildings: [], industryAccumulator: 0 };
  const factory = { id: 'factory', type: 'factory', planetId: 'planet', x: 0, y: 0, constructionState: 'complete', upgradeLevel: 1 };
  const graph = makeGraph(['smelter']);
  feed(node(graph), 0, material('impure_iron', 10)); feed(node(graph), 1, material('carbon', 2));
  state.factoryPlans.factory = graph; state.surfaceBuildings.push(factory);
  const supplied = Industry.supply(state, factory, 'water', 25);
  assert.equal(supplied.ok, true); close(state.inventory.water, 100);
  assert.equal(graph.externalStock.find(item => item.resourceId === 'water').amount, 25);
  Industry.advance(state, .1);
  assert.equal(node(graph).state, 'no_energy');
  state.surfaceBuildings.push({ id: 'wind', type: 'wind_turbine', planetId: 'planet', constructionState: 'complete' });
  Industry.advance(state, 1.1);
  assert.ok(factory.energyUse > 0, 'last cycle reports its power use in watts');
  assert.equal(node(graph).internalBuffer.outputs[0].resourceId, 'standard_iron');
});

