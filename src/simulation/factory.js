(function (root) {
  'use strict';

  const Resources = root.OrbitResourceData;
  const Blocks = root.OrbitBlockData;
  const Recipes = root.OrbitRecipeData.recipes;
  const Buildings = root.OrbitBuildingData;
  const Construction = root.OrbitConstruction;
  const LogisticsData = root.OrbitLogisticsData;
  const nodeSize = Blocks.node;
  const stockSize = stock => Object.values(stock || {}).reduce((sum, amount) => sum + amount, 0);
  const copyRecord = value => JSON.parse(JSON.stringify(value));
  const terrainByPlanet = new Map();

  function ensureLogistics(factory) {
    if (!factory) return null;
    if (!Array.isArray(factory.shipments)) factory.shipments = [];
    if (!Number.isInteger(factory.nextShipmentId) || factory.nextShipmentId < 1) factory.nextShipmentId = 1;
    if (typeof factory.outputDestinationId !== 'string') factory.outputDestinationId = null;
    if (!Number.isInteger(factory.logisticsLevel)) factory.logisticsLevel = 1;
    if (!Array.isArray(factory.trucks)) factory.trucks = [];
    factory.logisticsLevel = LogisticsData.get(factory.logisticsLevel).level;
    if (!Number.isInteger(factory.nextTruckId) || factory.nextTruckId < 1) {
      factory.nextTruckId = factory.trucks.reduce((next, truck) => {
        const match = /^truck-(\d+)$/.exec(truck.id || '');
        return match ? Math.max(next, Number(match[1]) + 1) : next;
      }, 1);
    }
    for (const truck of factory.trucks) {
      if (!['idle', 'loading', 'outbound', 'returning'].includes(truck.status)) truck.status = 'idle';
      if (!truck.cargo || typeof truck.cargo !== 'object') truck.cargo = {};
      if (!Number.isFinite(truck.elapsed)) truck.elapsed = 0;
      if (!Number.isFinite(truck.loadElapsed)) truck.loadElapsed = 0;
      if (!Number.isFinite(truck.tripsCompleted)) truck.tripsCompleted = 0;
    }
    syncFleet(factory);
    return factory;
  }

  function makeTruck(factory) {
    return { id: `truck-${factory.nextTruckId++}`, status: 'idle', destinationId: null,
      route: null, elapsed: 0, duration: 0, loadElapsed: 0, cargo: {}, tripsCompleted: 0,
      lastCargoSize: 0, resourceColor: '#d8c79e' };
  }

  function syncFleet(factory) {
    const profile = LogisticsData.get(factory.logisticsLevel);
    const active = factory.trucks.filter(truck => truck.status !== 'idle');
    const idle = factory.trucks.filter(truck => truck.status === 'idle');
    const idleTarget = Math.max(0, profile.trucks - active.length);
    const remove = Math.max(0, idle.length - idleTarget);
    if (remove) {
      const removeIds = new Set(idle.slice(-remove).map(truck => truck.id));
      factory.trucks = factory.trucks.filter(truck => !removeIds.has(truck.id));
    }
    while (factory.trucks.filter(truck => truck.status === 'idle').length < idleTarget) factory.trucks.push(makeTruck(factory));
  }

  function cargoSize(cargo) { return stockSize(cargo); }
  function get(simulation, factoryId) { return ensureLogistics(simulation?.factories?.[factoryId] || null); }
  function byBuilding(simulation, buildingId) {
    const building = simulation?.buildings?.[buildingId];
    if (!building || building.type !== 'factory') return null;
    if (building.factoryId && simulation.factories[building.factoryId]) return get(simulation, building.factoryId);
    return create(simulation, buildingId);
  }

  function makeBlock(factory, type, x, y) {
    const definition = Blocks.definitions[type];
    if (!definition) return null;
    const id = `block-${factory.nextBlockId++}`;
    const block = { id, entityType: 'block', type, x, y, capacity: definition.capacity,
      stock: {}, ready: {}, cycle: 0, status: 'waiting', roundRobin: 0 };
    if (definition.recipeId) block.recipeId = definition.recipeId;
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
    if (building.factoryId && simulation.factories[building.factoryId]) return get(simulation, building.factoryId);
    const id = building.factoryId || `factory-${buildingId}`;
    const factory = { id, buildingId, planetId: building.planetId, rank: 1, width: 780, height: 1300,
      baseEnergyDemand: Buildings.definitions.factory.energy, energyDemand: Buildings.definitions.factory.energy,
      blocks: {}, order: [], connections: [], nextBlockId: 1, nextConnectionId: 1,
      outputDestinationId: null, shipments: [], nextShipmentId: 1, trucks: [], nextTruckId: 1,
      logisticsLevel: 1, production: {}, elapsed: 0 };
    ensureLogistics(factory);
    simulation.factories[id] = factory; building.factoryId = id;
    const input = makeBlock(factory, 'input', 140, 650);
    const transform = makeBlock(factory, 'transform', 390, 650);
    const storage = makeBlock(factory, 'storage', 640, 650);
    const output = makeBlock(factory, 'output', 640, 860);
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

  function setTerrain(simulation, planetId, terrain, textureScale = 3) {
    if (!planetId || !terrain?.elevation || !terrain.width || !terrain.height) return false;
    const scale = Math.max(1, textureScale);
    const previous = terrainByPlanet.get(planetId);
    const changed = !previous || previous.sourceTerrain !== terrain || previous.textureScale !== scale;
    terrainByPlanet.delete(planetId);
    terrainByPlanet.set(planetId, { ...terrain, textureScale: scale, sourceTerrain: terrain });
    while (terrainByPlanet.size > 4) terrainByPlanet.delete(terrainByPlanet.keys().next().value);
    if (!simulation.deposits) simulation.deposits = {};
    if (!simulation.deposits[planetId] && Array.isArray(terrain.resources)) {
      simulation.deposits[planetId] = terrain.resources.map((deposit, index) => ({
        id: `${planetId}:${deposit.id || deposit.type}:${deposit.x}:${deposit.y}:${index}`,
        resourceId: deposit.id || 'iron', type: deposit.type,
        x: deposit.x * Math.max(1, textureScale), y: deposit.y * Math.max(1, textureScale),
        abundance: Math.max(.1, Number(deposit.abundance) || .5),
        remaining: Math.round(1200 + Math.max(.1, Number(deposit.abundance) || .5) * 3600)
      }));
    }
    if (changed) refreshRoutes(simulation, planetId);
    return true;
  }

  function routePoint(route, t) {
    if (route?.points?.length > 1) {
      const cumulative = route.cumulative || route.points.reduce((values, point, index) => {
        values.push(index ? values[index - 1] + Math.hypot(point.x - route.points[index - 1].x, point.y - route.points[index - 1].y) : 0);
        return values;
      }, []);
      const total = cumulative[cumulative.length - 1] || 0, distance = Math.max(0, Math.min(1, t)) * total;
      let index = 1;
      while (index < cumulative.length - 1 && cumulative[index] < distance) index++;
      const span = cumulative[index] - cumulative[index - 1], part = span > 0 ? (distance - cumulative[index - 1]) / span : 0;
      const a = route.points[index - 1], b = route.points[index];
      return { x: a.x + (b.x - a.x) * part, y: a.y + (b.y - a.y) * part };
    }
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { x: a * route.start.x + b * route.control1.x + c * route.control2.x + d * route.end.x,
      y: a * route.start.y + b * route.control1.y + c * route.control2.y + d * route.end.y };
  }

  function pushOpen(heap, id, score) {
    let index = heap.length;
    heap.push({ id, score });
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent].score <= score) break;
      heap[index] = heap[parent]; index = parent;
    }
    heap[index] = { id, score };
  }

  function popOpen(heap) {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1, right = left + 1;
        if (left >= heap.length) break;
        const child = right < heap.length && heap[right].score < heap[left].score ? right : left;
        if (heap[child].score >= last.score) break;
        heap[index] = heap[child]; index = child;
      }
      heap[index] = last;
    }
    return first;
  }

  function makeTerrainPath(simulation, planetId, start, end, terrain, sourceBuildingId, destinationId, blockEndpointBuildings) {
    const { width, height, elevation, seaLevel } = terrain;
    const textureScale = Math.max(1, terrain.textureScale || 1);
    if (!Number.isInteger(width) || !Number.isInteger(height) || !elevation || elevation.length < width * height ||
      start.x < 0 || start.y < 0 || end.x < 0 || end.y < 0 ||
      start.x >= width * textureScale || end.x >= width * textureScale ||
      start.y >= height * textureScale || end.y >= height * textureScale) return null;
    const sx = Math.floor(start.x / textureScale), sy = Math.floor(start.y / textureScale);
    const ex = Math.floor(end.x / textureScale), ey = Math.floor(end.y / textureScale);
    const startId = sy * width + sx, endId = ey * width + ex, total = width * height;
    const gScore = new Float64Array(total); gScore.fill(Infinity); gScore[startId] = 0;
    const parent = new Int32Array(total); parent.fill(-1);
    const closed = new Uint8Array(total), blocked = new Uint8Array(total), heap = [];
    const heuristic = id => Math.hypot(id % width - ex, Math.floor(id / width) - ey);
    pushOpen(heap, startId, heuristic(startId));
    const directions = [[-1, -1, 1.4142], [0, -1, 1], [1, -1, 1.4142], [-1, 0, 1], [1, 0, 1],
      [-1, 1, 1.4142], [0, 1, 1], [1, 1, 1.4142]];
    const obstacles = Object.values(simulation?.buildings || {}).filter(building => {
      if (building.planetId !== planetId || building.status !== 'complete') return false;
      const endpoint = building.id === sourceBuildingId || building.id === destinationId;
      if (!endpoint) return true;
      if (!blockEndpointBuildings) return false;
      return building.id === sourceBuildingId || (building.id === destinationId && building.type === 'factory');
    });
    for (const building of obstacles) {
      const radius = (Buildings.definitions[building.type]?.footprint || 24) * .34;
      const minX = Math.max(0, Math.floor((building.x - radius) / textureScale));
      const maxX = Math.min(width - 1, Math.ceil((building.x + radius) / textureScale));
      const minY = Math.max(0, Math.floor((building.y - radius) / textureScale));
      const maxY = Math.min(height - 1, Math.ceil((building.y + radius) / textureScale));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        if (Math.hypot((x + .5) * textureScale - building.x, (y + .5) * textureScale - building.y) < radius) {
          blocked[y * width + x] = 1;
        }
      }
    }
    const walkable = id => id === startId || id === endId ||
      (elevation[id] > seaLevel + 4 && !blocked[id]);
    const terrainFactor = (from, to, gridDistance) => {
      if (to !== startId && to !== endId && elevation[to] <= seaLevel + 4) return Infinity;
      const grade = Math.abs(elevation[to] - elevation[from]) / Math.max(.01, gridDistance);
      return 1 + grade * .1 + Math.pow(Math.max(0, grade - 12), 1.5) * .025;
    };
    let found = false;
    while (heap.length) {
      const current = popOpen(heap), id = current.id;
      if (closed[id]) continue;
      if (id === endId) { found = true; break; }
      closed[id] = 1;
      const x = id % width, y = Math.floor(id / width), here = elevation[id];
      for (const [dx, dy, step] of directions) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (closed[next] || !walkable(next)) continue;
        if (dx && dy) {
          const sideA = y * width + nx, sideB = ny * width + x;
          if (!walkable(sideA) || !walkable(sideB)) continue;
        }
        const candidate = gScore[id] + step * terrainFactor(id, next, step);
        if (candidate >= gScore[next]) continue;
        parent[next] = id; gScore[next] = candidate;
        pushOpen(heap, next, candidate + heuristic(next));
      }
    }
    if (!found) return null;
    const cells = [];
    for (let id = endId; id !== -1; id = parent[id]) {
      cells.push({ x: (id % width + .5) * textureScale, y: (Math.floor(id / width) + .5) * textureScale });
      if (id === startId) break;
    }
    if (cells.length === 0 || (startId !== endId && parent[endId] === -1)) return null;
    cells.reverse();
    const points = [start, ...cells, end];
    const compact = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const a = compact[compact.length - 1], b = points[i], c = points[i + 1];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) > textureScale * textureScale * .08) compact.push(b);
    }
    compact.push(points[points.length - 1]);
    const cumulative = [0]; let length = 0, distance = 0;
    for (let i = 1; i < compact.length; i++) {
      const a = compact[i - 1], b = compact[i];
      const horizontal = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(horizontal / textureScale));
      distance += horizontal;
      let segmentLength = 0;
      let previousX = Math.max(0, Math.min(width - 1, Math.floor(a.x / textureScale)));
      let previousY = Math.max(0, Math.min(height - 1, Math.floor(a.y / textureScale)));
      let previousHeight = elevation[previousY * width + previousX];
      for (let sample = 1; sample <= steps; sample++) {
        const t = sample / steps, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const gx = Math.max(0, Math.min(width - 1, Math.floor(x / textureScale)));
        const gy = Math.max(0, Math.min(height - 1, Math.floor(y / textureScale)));
        const currentHeight = elevation[gy * width + gx];
        const gridDistance = Math.max(.01, Math.hypot(gx - previousX, gy - previousY));
        const factor = currentHeight <= seaLevel + 4 ? 12 :
          1 + Math.abs(currentHeight - previousHeight) / gridDistance * .1 +
            Math.pow(Math.max(0, Math.abs(currentHeight - previousHeight) / gridDistance - 12), 1.5) * .025;
        segmentLength += horizontal / steps * factor;
        previousHeight = currentHeight; previousX = gx; previousY = gy;
      }
      length += segmentLength; cumulative.push(length);
    }
    return { start, end, points: compact, cumulative, distance, length };
  }

  function routeBetween(simulation, planetId, start, end, sourceBuildingId = null, destinationId = null,
    blockEndpointBuildings = false) {
    if (!start || !end || !Number.isFinite(start.x) || !Number.isFinite(start.y) ||
      !Number.isFinite(end.x) || !Number.isFinite(end.y)) return null;
    const dx = end.x - start.x, dy = end.y - start.y, direct = Math.hypot(dx, dy);
    if (direct < 1) return null;
    const terrain = terrainByPlanet.get(planetId);
    if (terrain) {
      const traced = makeTerrainPath(simulation, planetId, start, end, terrain, sourceBuildingId, destinationId,
        blockEndpointBuildings);
      if (!traced) return null;
      traced.sourceBuildingId = sourceBuildingId;
      traced.destinationId = destinationId;
      return traced;
    }
    const key = `${sourceBuildingId || ''}:${destinationId || ''}`;
    const seed = [...key].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const bend = Math.min(90, direct * .2) * (seed % 2 ? 1 : -1);
    const normal = { x: -dy / direct, y: dx / direct };
    const control1 = { x: start.x + dx * .34 + normal.x * bend, y: start.y + dy * .34 + normal.y * bend };
    const control2 = { x: start.x + dx * .66 + normal.x * bend, y: start.y + dy * .66 + normal.y * bend };
    const route = { start, control1, control2, end, length: 0 };
    let previous = start;
    for (let i = 1; i <= 20; i++) {
      const point = routePoint(route, i / 20);
      route.length += Math.hypot(point.x - previous.x, point.y - previous.y);
      previous = point;
    }
    route.sourceBuildingId = sourceBuildingId;
    route.destinationId = destinationId;
    return route;
  }

  function planetRouteRevision(simulation, planetId) {
    const revision = simulation?.routeRevisions?.[planetId];
    return Number.isInteger(revision) && revision >= 0 ? revision : 0;
  }

  function routeGeometry(simulation, factoryId, destinationId = null) {
    const factory = get(simulation, factoryId), building = simulation?.buildings?.[factory?.buildingId];
    const selectedId = destinationId || factory?.outputDestinationId;
    const target = simulation?.buildings?.[selectedId];
    if (!factory || !building || !target || target.planetId !== factory.planetId ||
      !['depot', 'port', 'factory'].includes(target.type)) return null;
    if (factory.outputRouteTargetId === selectedId && selectedId &&
      (factory.outputRouteRevision === planetRouteRevision(simulation, factory.planetId) ||
        !terrainByPlanet.has(factory.planetId))) return factory.outputRoute;
    const sourceOffset = Buildings.definitions.factory.footprint * .35;
    const targetOffset = target.type === 'factory' ? Buildings.definitions.factory.footprint * .35 : 0;
    const start = { x: building.x + sourceOffset, y: building.y };
    const end = { x: target.x - targetOffset, y: target.y };
    const route = routeBetween(simulation, factory.planetId, start, end, building.id, target.id, true);
    if (factory.outputDestinationId === target.id) {
      factory.outputRoute = route; factory.outputRouteTargetId = target.id;
      factory.outputRouteRevision = planetRouteRevision(simulation, factory.planetId);
    }
    return route;
  }

  function returnFactoryTruckCargo(simulation, factory, truck) {
    const output = factory.order.map(id => factory.blocks[id]).find(block => block?.type === 'output');
    const planetaryStock = Construction.inventory(simulation, factory.planetId);
    for (const [item, amount] of Object.entries(truck.cargo || {})) {
      if (amount <= 0) continue;
      const room = output ? Math.max(0, output.capacity - stockSize(output.stock)) : 0;
      const stored = Math.min(amount, room);
      if (stored) {
        output.stock[item] = (output.stock[item] || 0) + stored;
        output.ready[item] = (output.ready[item] || 0) + stored;
      }
      const overflow = amount - stored;
      if (overflow > 0 && planetaryStock) planetaryStock[item] = (planetaryStock[item] || 0) + overflow;
    }
    resetTruck(truck);
  }

  function refreshRoutes(simulation, planetId) {
    if (!simulation || !planetId) return 0;
    if (!simulation.routeRevisions || typeof simulation.routeRevisions !== 'object') simulation.routeRevisions = {};
    simulation.routeRevisions[planetId] = planetRouteRevision(simulation, planetId) + 1;

    for (const factory of Object.values(simulation.factories || {})) {
      if (factory.planetId !== planetId) continue;
      factory.outputRouteRevision = -1;
      const selected = factory.outputDestinationId && simulation.buildings?.[factory.outputDestinationId];
      const validSelected = selected && selected.planetId === planetId && selected.status === 'complete' &&
        ['depot', 'port', 'factory'].includes(selected.type);
      if (factory.outputDestinationId && !validSelected) {
        factory.outputDestinationId = null; factory.outputRoute = null; factory.outputRouteTargetId = null;
      } else if (selected && terrainByPlanet.has(planetId)) routeGeometry(simulation, factory.id);
      else if (selected) {
        if (factory.outputRoute?.destinationId !== selected.id) factory.outputRoute = null;
        factory.outputRouteTargetId = selected.id;
        factory.outputRouteRevision = planetRouteRevision(simulation, planetId);
      }

      for (const truck of factory.trucks || []) {
        if (!truck.destinationId) continue;
        const target = simulation.buildings?.[truck.destinationId];
        if (target && target.planetId === planetId && target.status === 'complete' &&
          ['depot', 'port', 'factory'].includes(target.type) && !terrainByPlanet.has(planetId)) {
          if (truck.route || (factory.outputRouteTargetId === target.id && factory.outputRoute)) continue;
        }
        const route = target && target.planetId === planetId && target.status === 'complete' &&
          ['depot', 'port', 'factory'].includes(target.type) ? routeGeometry(simulation, factory.id, target.id) : null;
        if (!route) {
          returnFactoryTruckCargo(simulation, factory, truck);
          continue;
        }
        const progress = truck.duration > 0 ? Math.max(0, Math.min(1, truck.elapsed / truck.duration)) : 0;
        truck.route = route;
        if (truck.status === 'outbound' || truck.status === 'returning') {
          const profile = LogisticsData.get(factory.logisticsLevel || 1);
          truck.duration = Math.max(profile.minimumLegSeconds, route.length / profile.speed);
          truck.elapsed = progress * truck.duration;
        }
      }
    }

    for (const building of Object.values(simulation.buildings || {})) {
      if (building.planetId !== planetId || building.type !== 'extractor') continue;
      building.outputRouteRevision = -1;
      const selected = building.outputDestinationId && simulation.buildings?.[building.outputDestinationId];
      const validSelected = selected && selected.type === 'factory' && selected.planetId === planetId && selected.status === 'complete';
      if (building.outputDestinationId && !validSelected) {
        building.outputDestinationId = null; building.outputRoute = null; building.outputRouteTargetId = null;
      } else if (selected && terrainByPlanet.has(planetId)) building.outputRoute = extractorRouteGeometry(simulation, building.id);
      else if (selected) {
        if (building.outputRoute?.destinationId !== selected.id) building.outputRoute = null;
        building.outputRouteTargetId = selected.id;
        building.outputRouteRevision = planetRouteRevision(simulation, planetId);
      }

      const truck = building.extractorTruck;
      if (truck?.destinationId) {
        if (validSelected && truck.destinationId === selected.id && !terrainByPlanet.has(planetId) &&
          (truck.route || building.outputRoute)) continue;
        const route = validSelected && truck.destinationId === selected.id ? building.outputRoute : null;
        if (!route) {
          returnExtractorTruckCargo(simulation, building);
        } else {
          const progress = truck.duration > 0 ? Math.max(0, Math.min(1, truck.elapsed / truck.duration)) : 0;
          truck.route = route;
          if (truck.status === 'outbound' || truck.status === 'returning') {
            const profile = LogisticsData.get(building.logisticsLevel || 1);
            truck.duration = Math.max(profile.minimumLegSeconds, route.length / profile.speed);
            truck.elapsed = progress * truck.duration;
          }
        }
      }
    }
    return simulation.routeRevisions[planetId];
  }

  function setOutputDestination(simulation, factoryId, buildingId) {
    const factory = get(simulation, factoryId);
    if (!factory) return { ok: false, reason: 'invalid-factory' };
    if (!buildingId) {
      factory.outputDestinationId = null;
      factory.outputRoute = null;
      factory.outputRouteTargetId = null;
      return { ok: true, destination: null, route: null };
    }
    const destination = simulation.buildings?.[buildingId];
    if (!destination || destination.id === factory.buildingId || destination.planetId !== factory.planetId ||
      !['depot', 'port', 'factory'].includes(destination.type)) {
      return { ok: false, reason: 'invalid-destination' };
    }
    if (destination.status !== 'complete') return { ok: false, reason: 'destination-under-construction' };
    const competing = Object.values(simulation.buildings || {}).some(source => source.id !== factory.buildingId &&
      source.outputDestinationId === destination.id);
    if (competing) return { ok: false, reason: 'input-occupied' };
    const previousId = factory.outputDestinationId, previousRoute = factory.outputRoute;
    const previousTargetId = factory.outputRouteTargetId, previousRevision = factory.outputRouteRevision;
    factory.outputDestinationId = destination.id;
    factory.outputRoute = routeGeometry(simulation, factoryId);
    if (!factory.outputRoute) {
      factory.outputDestinationId = previousId; factory.outputRoute = previousRoute;
      factory.outputRouteTargetId = previousTargetId; factory.outputRouteRevision = previousRevision;
      return { ok: false, reason: 'no-route' };
    }
    return { ok: true, destination, route: factory.outputRoute };
  }

  function extractorRouteGeometry(simulation, extractorId, destinationId = null) {
    const source = simulation?.buildings?.[extractorId];
    const selectedId = destinationId || source?.outputDestinationId;
    const target = simulation?.buildings?.[selectedId];
    if (!source || source.type !== 'extractor' || !target || target.type !== 'factory' ||
      source.planetId !== target.planetId) return null;
    if (source.outputRouteTargetId === target.id &&
      (source.outputRouteRevision === planetRouteRevision(simulation, source.planetId) ||
        !terrainByPlanet.has(source.planetId))) {
      return source.outputRoute;
    }
    const route = routeBetween(simulation, source.planetId,
      { x: source.x + Buildings.definitions.extractor.footprint * .35, y: source.y },
      { x: target.x - Buildings.definitions.factory.footprint * .35, y: target.y }, source.id, target.id, true);
    if (source.outputDestinationId === target.id) {
      source.outputRoute = route; source.outputRouteTargetId = target.id;
      source.outputRouteRevision = planetRouteRevision(simulation, source.planetId);
    }
    return route;
  }

  function setExtractorDestination(simulation, extractorId, buildingId) {
    const source = simulation?.buildings?.[extractorId];
    if (!source || source.type !== 'extractor') return { ok: false, reason: 'invalid-source' };
    if (!buildingId) {
      source.outputDestinationId = null; source.outputRoute = null;
      source.outputRouteTargetId = null;
      returnExtractorTruckCargo(simulation, source);
      return { ok: true, destination: null, route: null };
    }
    const destination = simulation.buildings?.[buildingId];
    if (!destination || destination.type !== 'factory' || destination.planetId !== source.planetId || destination.id === source.id) {
      return { ok: false, reason: 'invalid-destination' };
    }
    if (source.status !== 'complete' || destination.status !== 'complete') return { ok: false, reason: 'destination-under-construction' };
    const occupied = Object.values(simulation.buildings || {}).some(other => other.id !== source.id &&
      other.outputDestinationId === destination.id);
    if (occupied) return { ok: false, reason: 'input-occupied' };
    const route = extractorRouteGeometry(simulation, extractorId, destination.id);
    if (!route) return { ok: false, reason: 'no-route' };
    returnExtractorTruckCargo(simulation, source);
    source.outputDestinationId = destination.id;
    source.outputRoute = route;
    source.outputRouteTargetId = destination.id;
    source.outputRouteRevision = planetRouteRevision(simulation, source.planetId);
    source.extractorTruck = { status: 'idle', elapsed: 0, duration: 0, loadElapsed: 0, cargo: {}, tripsCompleted: 0 };
    return { ok: true, destination, route: source.outputRoute };
  }

  function connectBuildings(simulation, sourceId, destinationId) {
    const source = simulation?.buildings?.[sourceId], destination = simulation?.buildings?.[destinationId];
    if (!source || !destination || sourceId === destinationId || destination.type !== 'factory' ||
      !['factory', 'extractor'].includes(source.type) || source.planetId !== destination.planetId) {
      return { ok: false, reason: 'invalid-endpoint' };
    }
    if (source.status !== 'complete' || destination.status !== 'complete') return { ok: false, reason: 'building-incomplete' };
    if (source.outputDestinationId) return { ok: false, reason: 'output-occupied' };
    const occupied = Object.values(simulation.buildings).some(other => other.id !== source.id &&
      other.outputDestinationId === destination.id);
    if (occupied) return { ok: false, reason: 'input-occupied' };
    const result = source.type === 'factory' ? setOutputDestination(simulation, source.factoryId || `factory-${source.id}`, destination.id) :
      setExtractorDestination(simulation, source.id, destination.id);
    return result.ok ? { ...result, source, destination } : result;
  }

  function setLogisticsLevel(simulation, factoryId, level) {
    const factory = get(simulation, factoryId);
    if (!factory) return { ok: false, reason: 'invalid-factory' };
    if (!LogisticsData.profiles.some(profile => profile.level === level)) return { ok: false, reason: 'invalid-level' };
    factory.logisticsLevel = level;
    ensureLogistics(factory);
    return { ok: true, profile: LogisticsData.get(level), trucks: factory.trucks };
  }

  function reservedCapacity(simulation, buildingId, excludeBuildingId = null) {
    let reserved = 0;
    for (const factory of Object.values(simulation?.factories || {})) {
      for (const shipment of ensureLogistics(factory).shipments) {
        if (shipment.destinationId === buildingId) reserved += shipment.amount;
      }
      for (const truck of factory.trucks) {
        if (truck.destinationId === buildingId && ['loading', 'outbound'].includes(truck.status)) reserved += cargoSize(truck.cargo);
      }
    }
    for (const building of Object.values(simulation?.buildings || {})) {
      const vehicle = building.extractorTruck;
      if (building.id !== excludeBuildingId && building.outputDestinationId === buildingId && vehicle && ['loading', 'outbound'].includes(vehicle.status)) {
        reserved += cargoSize(vehicle.cargo);
      }
    }
    return reserved;
  }

  function destinationRoom(simulation, destination) {
    if (destination.type === 'factory') {
      const factory = byBuilding(simulation, destination.id);
      const input = factory?.order.map(id => factory.blocks[id]).find(block => block?.type === 'input');
      return Math.max(0, (input?.capacity || 0) - stockSize(input?.stock) - reservedCapacity(simulation, destination.id));
    }
    const definition = Buildings.definitions[destination.type];
    if (!definition?.logisticsCapacity) return 0;
    if (!destination.logisticsStock) destination.logisticsStock = {};
    return Math.max(0, definition.logisticsCapacity - stockSize(destination.logisticsStock) - reservedCapacity(simulation, destination.id));
  }

  function deliverShipment(simulation, factory, shipment) {
    const stock = Construction.inventory(simulation, factory.planetId);
    const destination = simulation.buildings?.[shipment.destinationId];
    if (!stock) return;
    if (!destination || destination.status !== 'complete' || destination.planetId !== factory.planetId) {
      stock[shipment.item] = (stock[shipment.item] || 0) + shipment.amount;
      factory.production[shipment.item] = (factory.production[shipment.item] || 0) + shipment.amount;
      return;
    }
    if (destination.type === 'factory') {
      const targetFactory = byBuilding(simulation, destination.id);
      const input = targetFactory?.order.map(id => targetFactory.blocks[id]).find(block => block?.type === 'input');
      const amount = input ? receive(targetFactory, input, shipment.item, shipment.amount) : 0;
      if (amount < shipment.amount) stock[shipment.item] = (stock[shipment.item] || 0) + shipment.amount - amount;
      factory.production[shipment.item] = (factory.production[shipment.item] || 0) + shipment.amount;
      return;
    }
    const capacity = Buildings.definitions[destination.type]?.logisticsCapacity || 0;
    const stored = destination.logisticsStock || (destination.logisticsStock = {});
    const room = Math.max(0, capacity - stockSize(stored));
    const amount = Math.min(shipment.amount, room);
    if (destination.type === 'depot') stock[shipment.item] = (stock[shipment.item] || 0) + amount;
    stored[shipment.item] = (stored[shipment.item] || 0) + amount;
    if (amount < shipment.amount) stock[shipment.item] = (stock[shipment.item] || 0) + shipment.amount - amount;
    factory.production[shipment.item] = (factory.production[shipment.item] || 0) + shipment.amount;
  }

  function advanceShipments(simulation, factory, seconds) {
    const active = [];
    for (const shipment of ensureLogistics(factory).shipments) {
      shipment.elapsed = Math.min(shipment.duration, shipment.elapsed + seconds);
      if (shipment.elapsed >= shipment.duration) deliverShipment(simulation, factory, shipment);
      else active.push(shipment);
    }
    factory.shipments = active;
  }

  function resetTruck(truck) {
    truck.status = 'idle'; truck.destinationId = null; truck.route = null;
    truck.elapsed = 0; truck.duration = 0; truck.loadElapsed = 0; truck.cargo = {};
  }

  function returnExtractorTruckCargo(simulation, source) {
    const truck = source.extractorTruck;
    if (!truck) return;
    const stock = source.logisticsStock || (source.logisticsStock = {});
    const planetaryStock = Construction.inventory(simulation, source.planetId);
    for (const [item, amount] of Object.entries(truck.cargo || {})) {
      if (amount <= 0) continue;
      const room = Math.max(0, 120 - stockSize(stock));
      const stored = Math.min(amount, room);
      if (stored) stock[item] = (stock[item] || 0) + stored;
      const overflow = amount - stored;
      if (overflow > 0 && planetaryStock) planetaryStock[item] = (planetaryStock[item] || 0) + overflow;
    }
    resetTruck(truck);
  }

  function advanceExtractors(simulation, seconds) {
    for (const building of Object.values(simulation?.buildings || {})) {
      if (building.type !== 'extractor' || building.status !== 'complete') continue;
      const deposit = (simulation.deposits?.[building.planetId] || []).find(item => item.id === building.depositId);
      const capacity = 120, stock = building.logisticsStock || (building.logisticsStock = {});
      const stored = stockSize(stock), resourceId = building.resourceId || deposit?.resourceId || 'iron';
      if (deposit && deposit.remaining > 0) {
        const mined = Math.min(Math.max(0, capacity - stored), deposit.remaining,
          seconds * (.55 + Math.min(1.5, deposit.abundance || .5) * .6));
        if (mined > 0) { stock[resourceId] = (stock[resourceId] || 0) + mined; deposit.remaining -= mined; }
      }

      if (!building.outputDestinationId) continue;
      const destination = simulation.buildings?.[building.outputDestinationId];
      if (!destination || destination.type !== 'factory' || destination.status !== 'complete') continue;
      const route = extractorRouteGeometry(simulation, building.id, destination.id);
      if (!route) continue;
      const profile = LogisticsData.get(building.logisticsLevel || 1);
      const truck = building.extractorTruck || (building.extractorTruck = {
        status: 'idle', elapsed: 0, duration: 0, loadElapsed: 0, cargo: {}, tripsCompleted: 0
      });
      if (truck.status === 'idle' && stored > 0) {
        truck.status = 'loading'; truck.destinationId = destination.id; truck.route = route;
        truck.elapsed = 0; truck.duration = 0; truck.loadElapsed = 0; truck.cargo = {};
      }
      if (truck.status === 'loading') {
        const factory = byBuilding(simulation, destination.id);
        const input = factory?.order.map(id => factory.blocks[id]).find(block => block?.type === 'input');
        const free = Math.max(0, (input?.capacity || 0) - stockSize(input?.stock) - reservedCapacity(simulation, destination.id, building.id));
        const room = Math.max(0, Math.min(profile.cargoCapacity - cargoSize(truck.cargo), free));
        for (const [item, amount] of Object.entries(stock)) {
          const loaded = Math.min(amount, room - cargoSize(truck.cargo));
          if (loaded <= 0) continue;
          truck.cargo[item] = (truck.cargo[item] || 0) + loaded;
          stock[item] -= loaded;
        }
        truck.loadElapsed += seconds;
        if (cargoSize(truck.cargo) >= profile.cargoCapacity || truck.loadElapsed >= profile.loadWindow) {
          if (cargoSize(truck.cargo) > 0) {
            truck.status = 'outbound'; truck.elapsed = 0;
            truck.duration = Math.max(profile.minimumLegSeconds, route.length / profile.speed);
          } else if (free <= 0) { truck.status = 'idle'; truck.destinationId = null; truck.route = null; }
        }
      } else if (truck.status === 'outbound') {
        truck.elapsed = Math.min(truck.duration, truck.elapsed + seconds);
        if (truck.elapsed >= truck.duration) {
          const factory = byBuilding(simulation, destination.id);
          const input = factory?.order.map(id => factory.blocks[id]).find(block => block?.type === 'input');
          let leftover = { ...truck.cargo };
          for (const [item, amount] of Object.entries(truck.cargo)) {
            const moved = input ? receive(factory, input, item, amount) : 0;
            if (moved) leftover[item] -= moved;
          }
          for (const [item, amount] of Object.entries(leftover)) if (amount > 0) stock[item] = (stock[item] || 0) + amount;
          truck.tripsCompleted++; truck.cargo = {}; truck.status = 'returning'; truck.elapsed = 0;
        }
      } else if (truck.status === 'returning') {
        truck.elapsed = Math.min(truck.duration, truck.elapsed + seconds);
        if (truck.elapsed >= truck.duration) {
          truck.status = 'idle'; truck.destinationId = null; truck.route = null;
          truck.elapsed = 0; truck.duration = 0; truck.loadElapsed = 0;
        }
      }
    }
  }

  function dispatchTruck(factory, truck) {
    const profile = LogisticsData.get(factory.logisticsLevel);
    if (!cargoSize(truck.cargo) || !truck.route) { resetTruck(truck); return false; }
    const firstItem = Object.keys(truck.cargo).find(item => truck.cargo[item] > 0);
    truck.resourceColor = Resources.definitions[firstItem]?.color || '#d8c79e';
    truck.lastCargoSize = cargoSize(truck.cargo);
    truck.status = 'outbound'; truck.elapsed = 0;
    truck.duration = Math.max(profile.minimumLegSeconds, truck.route.length / profile.speed);
    truck.loadElapsed = 0;
    return true;
  }

  function deliverTruck(simulation, factory, truck) {
    const total = cargoSize(truck.cargo);
    for (const [item, amount] of Object.entries(truck.cargo)) {
      if (amount > 0) deliverShipment(simulation, factory, {
        item, amount, destinationId: truck.destinationId
      });
    }
    if (total > 0) truck.tripsCompleted++;
    truck.cargo = {};
    truck.status = 'returning'; truck.elapsed = 0;
    const profile = LogisticsData.get(factory.logisticsLevel);
    truck.duration = Math.max(profile.minimumLegSeconds, truck.route?.length / profile.speed || profile.minimumLegSeconds);
  }

  function advanceTrucks(simulation, factory, seconds) {
    const profile = LogisticsData.get(factory.logisticsLevel);
    for (const truck of factory.trucks) {
      if (truck.status === 'loading') {
        if (cargoSize(truck.cargo) > 0) {
          truck.loadElapsed += seconds;
          if (truck.loadElapsed >= profile.loadWindow || cargoSize(truck.cargo) >= profile.cargoCapacity) dispatchTruck(factory, truck);
        }
      } else if (truck.status === 'outbound') {
        truck.elapsed = Math.min(truck.duration, truck.elapsed + seconds);
        if (truck.elapsed >= truck.duration) deliverTruck(simulation, factory, truck);
      } else if (truck.status === 'returning') {
        truck.elapsed = Math.min(truck.duration, truck.elapsed + seconds);
        if (truck.elapsed >= truck.duration) resetTruck(truck);
      }
    }
    syncFleet(factory);
  }

  function processInput(simulation, factory, block, planetStock, seconds, infiniteMaterials = false) {
    block.status = stockSize(block.stock) >= block.capacity ? 'blocked' : stockSize(block.stock) ? 'ready' : 'starved';
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

  function routeOutput(simulation, factory, block, planetStock) {
    let destination = factory.outputDestinationId && simulation.buildings?.[factory.outputDestinationId];
    if (factory.outputDestinationId && (!destination || destination.id === factory.buildingId ||
      destination.planetId !== factory.planetId || !['depot', 'port', 'factory'].includes(destination.type))) {
      factory.outputDestinationId = null; factory.outputRoute = null; destination = null;
    }
    if (destination && destination.status !== 'complete') return false;
    const route = destination && routeGeometry(simulation, factory.id);
    if (destination && !route) return false;

    let loader = factory.trucks.find(truck => truck.status === 'loading');
    if (loader) {
      const assigned = simulation.buildings?.[loader.destinationId];
      if (!assigned || assigned.status !== 'complete' || assigned.id === factory.buildingId || assigned.planetId !== factory.planetId ||
        !['depot', 'port', 'factory'].includes(assigned.type)) {
        for (const [item, amount] of Object.entries(loader.cargo)) {
          block.stock[item] = (block.stock[item] || 0) + amount;
          block.ready[item] = (block.ready[item] || 0) + amount;
        }
        resetTruck(loader);
        loader = null;
      }
    }

    if (!destination && !loader) {
      let movedAny = false;
      for (const [item, amount] of Object.entries(block.ready)) {
        if (amount <= 0) continue;
        planetStock[item] = (planetStock[item] || 0) + amount;
        factory.production[item] = (factory.production[item] || 0) + amount;
        block.ready[item] = 0;
        block.stock[item] = Math.max(0, (block.stock[item] || 0) - amount);
        movedAny = true;
      }
      return movedAny;
    }

    if (!loader) {
      const hasReady = Object.values(block.ready).some(amount => amount > 0);
      if (!hasReady) return false;
      loader = factory.trucks.find(truck => truck.status === 'idle');
      if (!loader) return false;
      loader.status = 'loading'; loader.destinationId = destination.id; loader.route = route;
      loader.elapsed = 0; loader.duration = 0; loader.loadElapsed = 0; loader.cargo = {};
    }

    const assignedDestination = simulation.buildings?.[loader.destinationId];
    if (!assignedDestination) return false;
    const profile = LogisticsData.get(factory.logisticsLevel);
    let room = destinationRoom(simulation, assignedDestination);
    let movedAny = false;
    for (const [item, amount] of Object.entries(block.ready)) {
      if (amount <= 0 || room <= 0) continue;
      const truckRoom = Math.max(0, profile.cargoCapacity - cargoSize(loader.cargo));
      const moved = Math.min(amount, room, truckRoom);
      if (!moved) continue;
      loader.cargo[item] = (loader.cargo[item] || 0) + moved;
      block.ready[item] -= moved;
      block.stock[item] = Math.max(0, (block.stock[item] || 0) - moved);
      room -= moved;
      movedAny = true;
    }
    if (cargoSize(loader.cargo) >= profile.cargoCapacity) dispatchTruck(factory, loader);
    return movedAny;
  }

  function routeBlock(simulation, factory, block, planetStock) {
    let moved = false;
    if (block.type === 'output') moved = routeOutput(simulation, factory, block, planetStock);
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
    advanceExtractors(simulation, seconds);
    const events = [];
    for (const factory of Object.values(simulation?.factories || {})) {
      ensureLogistics(factory);
      const building = simulation.buildings[factory.buildingId];
      const planetStock = simulation.resources[factory.planetId];
      if (!building || building.status !== 'complete' || !planetStock) continue;
      const before = { ...factory.production }, shipmentCount = factory.shipments.length;
      const fleetBefore = factory.trucks.map(truck => `${truck.id}:${truck.status}:${truck.destinationId || ''}:${cargoSize(truck.cargo)}`).join('|');
      let remaining = seconds;
      while (remaining > 0) {
        const step = Math.min(.1, remaining);
        factory.elapsed += step;
        advanceShipments(simulation, factory, step);
        advanceTrucks(simulation, factory, step);
        for (const id of factory.order) {
          const block = factory.blocks[id];
          if (block.type === 'input') processInput(simulation, factory, block, planetStock, step, simulation.infiniteMaterials === true);
          else if (block.type === 'transform') processTransform(block, step);
        }
        for (const id of factory.order) routeBlock(simulation, factory, factory.blocks[id], planetStock);
        remaining = Math.max(0, remaining - step);
      }
      const products = Object.fromEntries(Object.entries(factory.production).filter(([id, count]) => count > (before[id] || 0))
        .map(([id, count]) => [id, count - (before[id] || 0)]));
      const trucksInTransit = factory.trucks.filter(truck => ['outbound', 'returning'].includes(truck.status)).length;
      const fleetAfter = factory.trucks.map(truck => `${truck.id}:${truck.status}:${truck.destinationId || ''}:${cargoSize(truck.cargo)}`).join('|');
      if (Object.keys(products).length || factory.shipments.length !== shipmentCount || fleetBefore !== fleetAfter) {
        events.push({ factoryId: factory.id, products, shipmentsInTransit: factory.shipments.length, trucksInTransit });
      }
      refreshEnergy(factory);
    }
    return events;
  }

  root.OrbitFactorySimulation = Object.freeze({ get, byBuilding, create, addBlock, moveBlock,
    removeBlock, connect: connectBlocks, disconnect, createFrame, setOutputDestination, setExtractorDestination,
    connectBuildings, setLogisticsLevel, routeGeometry, extractorRouteGeometry, refreshRoutes, routeBetween, routePoint, setTerrain,
    refreshEnergy, advance, copy: copyRecord });
})(globalThis);
