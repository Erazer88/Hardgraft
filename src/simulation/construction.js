(function (root) {
  'use strict';

  const Resources = root.OrbitResourceData;
  const Buildings = root.OrbitBuildingData;
  const copyCost = cost => Object.fromEntries(Object.entries(cost).map(([id, amount]) => [id, amount]));

  function inventory(simulation, planetId) {
    const value = simulation?.resources?.[planetId];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function initializePlanet(simulation, planetId, grantStartingStock = false) {
    if (!simulation || !simulation.resources || typeof planetId !== 'string' || !planetId) {
      throw new TypeError('A simulation and a planet id are required.');
    }
    const existing = inventory(simulation, planetId);
    const target = existing || Resources.emptyInventory();
    for (const id of Resources.order) {
      if (!Number.isFinite(target[id]) || target[id] < 0) target[id] = 0;
      if (!existing && grantStartingStock) target[id] = Resources.startingStock[id];
    }
    if (!existing) simulation.resources[planetId] = target;
    return target;
  }

  function missingResources(simulation, planetId, cost) {
    const stock = inventory(simulation, planetId);
    return Object.fromEntries(Object.entries(cost).filter(([id, amount]) => !stock || (stock[id] || 0) < amount)
      .map(([id, amount]) => [id, amount - (stock?.[id] || 0)]));
  }

  function canAfford(simulation, planetId, type) {
    const definition = Buildings.definitions[type];
    if (!definition) return { ok: false, reason: 'unknown-building', missing: {} };
    if (simulation?.infiniteMaterials === true) return { ok: true, reason: null, missing: {} };
    const missing = missingResources(simulation, planetId, definition.cost);
    return { ok: Object.keys(missing).length === 0, reason: Object.keys(missing).length ? 'insufficient' : null, missing };
  }

  function list(simulation, planetId) {
    return Object.values(simulation?.buildings || {}).filter(building => building && building.planetId === planetId);
  }

  function nextId(simulation) {
    if (!Number.isInteger(simulation.nextBuildingId) || simulation.nextBuildingId < 1) {
      simulation.nextBuildingId = Object.keys(simulation.buildings || {}).reduce((max, id) => {
        const match = /^building-(\d+)$/.exec(id);
        return match ? Math.max(max, Number(match[1]) + 1) : max;
      }, 1);
    }
    let id;
    do { id = `building-${simulation.nextBuildingId++}`; } while (simulation.buildings[id]);
    return id;
  }

  function place(simulation, { planetId, type, x, y }) {
    const definition = Buildings.definitions[type];
    if (!definition) return { ok: false, reason: 'unknown-building' };
    if (typeof planetId !== 'string' || !planetId || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, reason: 'invalid-location' };
    }
    const stock = inventory(simulation, planetId);
    if (!stock) return { ok: false, reason: 'inventory-unavailable' };
    const affordability = canAfford(simulation, planetId, type);
    if (!affordability.ok) return affordability;
    for (const other of list(simulation, planetId)) {
      const otherDefinition = Buildings.definitions[other.type];
      const clearance = (definition.footprint + (otherDefinition?.footprint || 20)) * .65;
      if (Math.hypot(other.x - x, other.y - y) < clearance) return { ok: false, reason: 'occupied' };
    }
    const cost = simulation.infiniteMaterials ? {} : copyCost(definition.cost);
    if (!simulation.infiniteMaterials) {
      for (const [id, amount] of Object.entries(cost)) consume(simulation, planetId, id, amount);
    }
    const id = nextId(simulation);
    const building = { id, entityType: 'building', type, planetId, x, y, status: 'constructing',
      startedAt: simulation.time, completeAt: simulation.time + definition.duration, cost };
    if (definition.logisticsCapacity) building.logisticsStock = {};
    simulation.buildings[id] = building;
    return { ok: true, building };
  }

  function consume(simulation, planetId, resourceId, amount) {
    const stock = inventory(simulation, planetId);
    if (!stock || !Number.isFinite(amount) || amount <= 0) return 0;
    const consumed = Math.min(stock[resourceId] || 0, amount);
    stock[resourceId] = (stock[resourceId] || 0) - consumed;
    let remaining = consumed;
    for (const building of list(simulation, planetId)) {
      if (building.type !== 'depot' || !building.logisticsStock) continue;
      const stored = Math.min(building.logisticsStock[resourceId] || 0, remaining);
      if (stored > 0) {
        building.logisticsStock[resourceId] -= stored;
        remaining -= stored;
      }
      if (!remaining) break;
    }
    return consumed;
  }

  function progress(simulation, building) {
    if (!building || building.status === 'complete') return 1;
    const duration = building.completeAt - building.startedAt;
    if (!Number.isFinite(duration) || duration <= 0) return 1;
    return Math.max(0, Math.min(1, (simulation.time - building.startedAt) / duration));
  }

  function advance(simulation) {
    const completed = [];
    for (const building of Object.values(simulation?.buildings || {})) {
      if (building?.status === 'constructing' && Number.isFinite(building.completeAt) && simulation.time >= building.completeAt) {
        building.status = 'complete'; completed.push(building);
      }
    }
    return completed;
  }

  function demolish(simulation, buildingId, refundRate = Buildings.refundRate) {
    const building = simulation?.buildings?.[buildingId];
    if (!building) return { ok: false, reason: 'unknown-building' };
    if (!Number.isFinite(refundRate) || refundRate < 0 || refundRate > 1) throw new RangeError('Refund rate must be between 0 and 1.');
    const stock = initializePlanet(simulation, building.planetId, false);
    const sourceCost = building.cost || Buildings.definitions[building.type]?.cost || {};
    const refund = {};
    for (const [id, amount] of Object.entries(sourceCost)) {
      refund[id] = Math.floor(amount * refundRate);
      stock[id] = (stock[id] || 0) + refund[id];
    }
    if (building.type === 'port') {
      for (const [id, amount] of Object.entries(building.logisticsStock || {})) stock[id] = (stock[id] || 0) + amount;
    }
    if (building.factoryId) {
      const factory = simulation.factories?.[building.factoryId];
      for (const shipment of factory?.shipments || []) stock[shipment.item] = (stock[shipment.item] || 0) + shipment.amount;
      for (const truck of factory?.trucks || []) {
        for (const [id, amount] of Object.entries(truck.cargo || {})) stock[id] = (stock[id] || 0) + amount;
      }
      delete simulation.factories?.[building.factoryId];
    }
    delete simulation.buildings[buildingId];
    return { ok: true, building, refund };
  }

  root.OrbitConstruction = Object.freeze({ inventory, initializePlanet, consume, canAfford, list, place, progress, advance, demolish });
})(globalThis);
