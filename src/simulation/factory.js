(function (root) {
  'use strict';

  const Resources = root.OrbitResourceData;
  const Blocks = root.OrbitBlockData;
  const Recipes = root.OrbitRecipeData.recipes;
  const Buildings = root.OrbitBuildingData;
  const nodeSize = Blocks.node;
  const stockSize = stock => Object.values(stock || {}).reduce((sum, amount) => sum + amount, 0);
  const copyRecord = value => JSON.parse(JSON.stringify(value));

  function get(simulation, factoryId) { return simulation?.factories?.[factoryId] || null; }
  function byBuilding(simulation, buildingId) {
    const building = simulation?.buildings?.[buildingId];
    if (!building || building.type !== 'factory') return null;
    if (building.factoryId && simulation.factories[building.factoryId]) return simulation.factories[building.factoryId];
    return create(simulation, buildingId);
  }

  function makeBlock(factory, type, x, y) {
    const definition = Blocks.definitions[type];
    if (!definition) return null;
    const id = `block-${factory.nextBlockId++}`;
    const block = { id, entityType: 'block', type, x, y, capacity: definition.capacity,
      stock: {}, ready: {}, cycle: 0, status: 'waiting', roundRobin: 0 };
    if (definition.recipeId) block.recipeId = definition.recipeId;
    if (type === 'input') block.resource = 'iron';
    factory.blocks[id] = block; factory.order.push(id);
    return block;
  }

  function freePort(factory, blockId, direction) {
    const block = factory.blocks[blockId], definition = Blocks.definitions[block?.type];
    const count = direction === 'out' ? definition?.outputPorts : definition?.inputPorts;
    for (let i = 1; i <= count; i++) {
      const id = `${direction}-${i}`;
      if (!factory.connections.some(edge => direction === 'out' ? edge.from === blockId && edge.fromPort === id : edge.to === blockId && edge.toPort === id)) return id;
    }
    return null;
  }

  function connect(factory, fromId, toId, ports = {}) {
    const from = factory?.blocks?.[fromId], to = factory?.blocks?.[toId];
    if (!from || !to || fromId === toId) return { ok: false, reason: 'invalid-endpoint' };
    const fromPort = ports.fromPort || freePort(factory, fromId, 'out');
    const toPort = ports.toPort || freePort(factory, toId, 'in');
    const fromDefinition = Blocks.definitions[from.type], toDefinition = Blocks.definitions[to.type];
    if (!fromPort || !toPort || Number(fromPort.split('-')[1]) > fromDefinition.outputPorts ||
      Number(toPort.split('-')[1]) > toDefinition.inputPorts) return { ok: false, reason: 'no-free-port' };
    if (factory.connections.some(edge => edge.from === fromId && edge.fromPort === fromPort || edge.to === toId && edge.toPort === toPort)) {
      return { ok: false, reason: 'port-occupied' };
    }
    if (!Number.isInteger(factory.nextConnectionId) || factory.nextConnectionId < 1) {
      factory.nextConnectionId = factory.connections.reduce((next, edge) => {
        const match = /^connection-(\d+)$/.exec(edge.id);
        return match ? Math.max(next, Number(match[1]) + 1) : next;
      }, 1);
    }
    const edge = { id: `connection-${factory.nextConnectionId++}`, from: fromId, to: toId, fromPort, toPort };
    factory.connections.push(edge);
    return { ok: true, edge };
  }

  function create(simulation, buildingId) {
    const building = simulation?.buildings?.[buildingId];
    if (!building || building.type !== 'factory') return null;
    if (building.factoryId && simulation.factories[building.factoryId]) return simulation.factories[building.factoryId];
    const id = building.factoryId || `factory-${buildingId}`;
    const factory = { id, buildingId, planetId: building.planetId, rank: 1, width: 780, height: 1300,
      baseEnergyDemand: Buildings.definitions.factory.energy, energyDemand: Buildings.definitions.factory.energy,
      blocks: {}, order: [], connections: [], nextBlockId: 1, nextConnectionId: 1, production: {}, elapsed: 0 };
    simulation.factories[id] = factory; building.factoryId = id;
    const input = makeBlock(factory, 'input', 140, 255);
    const transform = makeBlock(factory, 'transform', 390, 255);
    const storage = makeBlock(factory, 'storage', 640, 255);
    const output = makeBlock(factory, 'output', 640, 475);
    connect(factory, input.id, transform.id);
    connect(factory, transform.id, storage.id);
    connect(factory, storage.id, output.id);
    refreshEnergy(factory);
    return factory;
  }

  function bounds(factory, x, y, blockId = null) {
    const halfWidth = nodeSize.width / 2, halfHeight = nodeSize.height / 2;
    if (x < halfWidth || y < halfHeight || x > factory.width - halfWidth || y > factory.height - halfHeight) return false;
    return !factory.order.some(id => {
      if (id === blockId) return false;
      const other = factory.blocks[id];
      return Math.abs(other.x - x) < nodeSize.width * .78 && Math.abs(other.y - y) < nodeSize.height * .78;
    });
  }

  function addBlock(simulation, factoryId, type, x, y) {
    const factory = get(simulation, factoryId);
    if (!factory || !Blocks.definitions[type]) return { ok: false, reason: 'invalid-block' };
    if (!Number.isFinite(x) || !Number.isFinite(y) || !bounds(factory, x, y)) return { ok: false, reason: 'occupied-or-outside' };
    const block = makeBlock(factory, type, x, y); refreshEnergy(factory);
    return { ok: true, block };
  }

  function moveBlock(simulation, factoryId, blockId, x, y) {
    const factory = get(simulation, factoryId), block = factory?.blocks?.[blockId];
    if (!block || !Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: 'invalid-block' };
    if (!bounds(factory, x, y, blockId)) return { ok: false, reason: 'occupied-or-outside' };
    block.x = x; block.y = y;
    return { ok: true, block };
  }

  function removeBlock(simulation, factoryId, blockId) {
    const factory = get(simulation, factoryId);
    if (!factory?.blocks?.[blockId]) return { ok: false, reason: 'invalid-block' };
    const block = factory.blocks[blockId];
    delete factory.blocks[blockId]; factory.order = factory.order.filter(id => id !== blockId);
    factory.connections = factory.connections.filter(edge => edge.from !== blockId && edge.to !== blockId);
    refreshEnergy(factory);
    return { ok: true, block };
  }

  function refreshEnergy(factory) {
    factory.energyDemand = factory.baseEnergyDemand + factory.order.reduce((sum, id) =>
      sum + (Blocks.definitions[factory.blocks[id]?.type]?.energy || 0), 0);
    return factory.energyDemand;
  }

  function connectBlocks(simulation, factoryId, fromId, toId, ports) {
    const factory = get(simulation, factoryId);
    if (!factory) return { ok: false, reason: 'invalid-factory' };
    const result = connect(factory, fromId, toId, ports);
    if (result.ok) refreshEnergy(factory);
    return result;
  }

  function disconnect(simulation, factoryId, connectionId) {
    const factory = get(simulation, factoryId);
    if (!factory) return false;
    const before = factory.connections.length;
    factory.connections = factory.connections.filter(edge => edge.id !== connectionId);
    return factory.connections.length !== before;
  }

  function createFrame(surfaceFrame, building, factory) {
    const physicalHeight = Buildings.definitions.factory.footprint;
    const scale = physicalHeight / factory.height;
    const mapFrame = { x: building.x - factory.width * scale / 2, y: building.y - physicalHeight / 2, scale };
    return { mapFrame, worldFrame: { x: surfaceFrame.x + mapFrame.x * surfaceFrame.scale,
      y: surfaceFrame.y + mapFrame.y * surfaceFrame.scale, scale: mapFrame.scale * surfaceFrame.scale } };
  }

  function processInput(factory, block, planetStock, seconds, infiniteMaterials = false) {
    const definition = Blocks.definitions.input;
    if (stockSize(block.stock) >= block.capacity || (!infiniteMaterials && (planetStock[block.resource] || 0) <= 0)) {
      block.status = stockSize(block.stock) >= block.capacity ? 'blocked' : 'starved';
      block.cycle = Math.min(block.cycle, definition.cycle); return;
    }
    block.cycle += seconds;
    while (block.cycle >= definition.cycle && stockSize(block.stock) < block.capacity &&
      (infiniteMaterials || (planetStock[block.resource] || 0) > 0)) {
      block.cycle -= definition.cycle;
      if (!infiniteMaterials) planetStock[block.resource] -= 1;
      block.stock[block.resource] = (block.stock[block.resource] || 0) + 1;
      block.ready[block.resource] = (block.ready[block.resource] || 0) + 1;
    }
    block.status = block.cycle > 0 ? 'running' : 'waiting';
  }

  function enough(stock, requirement) {
    return Object.entries(requirement).every(([id, amount]) => (stock[id] || 0) >= amount);
  }

  function processTransform(block, seconds) {
    const recipe = Recipes[block.recipeId];
    if (!recipe) { block.status = 'unconfigured'; return; }
    if (!enough(block.stock, recipe.inputs)) { block.status = 'starved'; block.cycle = 0; return; }
    const inputCount = stockSize(recipe.inputs), outputCount = stockSize(recipe.outputs);
    if (stockSize(block.stock) - inputCount + outputCount > block.capacity) { block.status = 'blocked'; return; }
    block.cycle += seconds;
    while (block.cycle >= recipe.duration && enough(block.stock, recipe.inputs) &&
      stockSize(block.stock) - inputCount + outputCount <= block.capacity) {
      block.cycle -= recipe.duration;
      for (const [id, amount] of Object.entries(recipe.inputs)) block.stock[id] -= amount;
      for (const [id, amount] of Object.entries(recipe.outputs)) {
        block.stock[id] = (block.stock[id] || 0) + amount;
        block.ready[id] = (block.ready[id] || 0) + amount;
      }
    }
    block.status = block.cycle > 0 ? 'running' : 'waiting';
  }

  function receive(factory, target, item, amount) {
    const free = Math.max(0, target.capacity - stockSize(target.stock));
    const moved = Math.min(amount, free);
    if (!moved) return 0;
    target.stock[item] = (target.stock[item] || 0) + moved;
    if (target.type !== 'transform') target.ready[item] = (target.ready[item] || 0) + moved;
    return moved;
  }

  function transfer(factory, source, edge) {
    const target = factory.blocks[edge.to];
    if (!target) return false;
    let movedAny = false;
    for (const [item, amount] of Object.entries(source.ready)) {
      if (amount <= 0) continue;
      const moved = receive(factory, target, item, amount);
      if (moved) {
        source.ready[item] -= moved; source.stock[item] -= moved; movedAny = true;
      }
    }
    return movedAny;
  }

  function routeOutput(factory, block, planetStock) {
    let movedAny = false;
    for (const [item, amount] of Object.entries(block.ready)) {
      if (amount <= 0) continue;
      planetStock[item] = (planetStock[item] || 0) + amount;
      block.ready[item] = 0; block.stock[item] -= amount;
      factory.production[item] = (factory.production[item] || 0) + amount; movedAny = true;
    }
    return movedAny;
  }

  function routeBlock(factory, block, planetStock) {
    let moved = false;
    if (block.type === 'output') moved = routeOutput(factory, block, planetStock);
    else {
      const edges = factory.connections.filter(edge => edge.from === block.id)
        .sort((a, b) => Number(a.fromPort.split('-')[1]) - Number(b.fromPort.split('-')[1]));
      if (block.type === 'splitter' && edges.length > 1) {
        const start = block.roundRobin;
        for (let offset = 0; offset < edges.length; offset++) {
          const index = (start + offset) % edges.length;
          if (transfer(factory, block, edges[index])) { block.roundRobin = (index + 1) % edges.length; moved = true; }
        }
      } else if (edges[0]) moved = transfer(factory, block, edges[0]);
    }
    if (block.type === 'storage' || block.type === 'splitter' || block.type === 'merger') {
      block.status = stockSize(block.stock) >= block.capacity ? 'blocked' : stockSize(block.stock) ? 'ready' : 'waiting';
    } else if (block.type === 'output') block.status = stockSize(block.stock) ? 'blocked' : 'ready';
    else if (block.type === 'input' && moved && block.status === 'blocked') block.status = 'waiting';
    return moved;
  }

  function advance(simulation, seconds, running = true) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Factory duration must be finite and non-negative.');
    if (!running || seconds === 0) return [];
    const events = [];
    for (const factory of Object.values(simulation?.factories || {})) {
      const building = simulation.buildings[factory.buildingId];
      const planetStock = simulation.resources[factory.planetId];
      if (!building || building.status !== 'complete' || !planetStock) continue;
      const before = { ...factory.production };
      factory.elapsed += seconds;
      for (const id of factory.order) {
        const block = factory.blocks[id];
        if (block.type === 'input') processInput(factory, block, planetStock, seconds, simulation.infiniteMaterials === true);
        else if (block.type === 'transform') processTransform(block, seconds);
      }
      for (const id of factory.order) routeBlock(factory, factory.blocks[id], planetStock);
      const products = Object.fromEntries(Object.entries(factory.production).filter(([id, count]) => count > (before[id] || 0))
        .map(([id, count]) => [id, count - (before[id] || 0)]));
      if (Object.keys(products).length) events.push({ factoryId: factory.id, products });
      refreshEnergy(factory);
    }
    return events;
  }

  root.OrbitFactorySimulation = Object.freeze({ get, byBuilding, create, addBlock, moveBlock,
    removeBlock, connect: connectBlocks, disconnect, createFrame, refreshEnergy, advance, copy: copyRecord });
})(globalThis);
