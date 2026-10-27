(function (root) {
  'use strict';

  const Buildings = root.OrbitBuildingData;
  const Inventory = root.OrbitInventory;
  const defaultDurationSeconds = 3.5;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // Price of the next building of a type on a planet: the base cost, raised
  // by costGrowth for each building of that type already there.
  function costFor(type, buildings = [], planetId = null) {
    const definition = Buildings.get(type);
    if (!definition) return null;
    const count = buildings.filter(item => item.type === type && (!planetId || item.planetId === planetId)).length;
    const factor = 1 + (Buildings.construction?.costGrowth || 0) * count;
    return Object.fromEntries(Object.entries(definition.cost || {}).map(([id, amount]) => [id, Math.round(amount * factor)]));
  }

  function start(building, inventory, price = null) {
    if (!building || building.constructionState !== 'planned') return { started: false, missing: null };
    const definition = Buildings.get(building.type);
    if (!definition) return { started: false, missing: null };
    const cost = price || definition.cost || {};
    const missing = Inventory.missing(inventory, cost);
    if (missing === null || missing.length) return { started: false, missing };
    if (!Inventory.consume(inventory, cost)) return { started: false, missing: Inventory.missing(inventory, cost) };
    building.costPaid = Inventory.chargeableCost(cost);
    building.constructionDurationSeconds = definition.constructionDurationSeconds || defaultDurationSeconds;
    building.demolitionRefundRate = definition.demolitionRefundRate ?? 1;
    building.constructionProgress = 0;
    building.constructionState = 'constructing';
    building.status = 'building';
    return { started: true, missing: [] };
  }

  // Sites progress in the order they were started, as many at once as there
  // are construction crews; the others wait their turn.
  function advance(buildings, deltaSeconds, onComplete = null) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Construction time must be non-negative');
    const crews = Buildings.construction?.crews ?? Infinity;
    let busy = 0;
    for (const building of buildings) {
      if (building.constructionState !== 'constructing') continue;
      if (busy >= crews) { building.status = 'queued'; continue; }
      busy++;
      building.status = 'building';
      const duration = Number.isFinite(building.constructionDurationSeconds) && building.constructionDurationSeconds > 0
        ? building.constructionDurationSeconds : defaultDurationSeconds;
      building.constructionProgress = clamp(building.constructionProgress + deltaSeconds / duration, 0, 1);
      if (building.constructionProgress >= 1) {
        building.constructionState = 'complete';
        building.status = 'idle';
        if (typeof onComplete === 'function') onComplete(building);
      }
    }
  }

  function demolish(building, inventory) {
    if (!building || !Buildings.get(building.type)) return null;
    const paid = { ...(building.costPaid || {}) };
    for (const [id, amount] of Object.entries(building.cardCostPaid || {})) paid[id] = (paid[id] || 0) + amount;
    const rate = Number.isFinite(building.demolitionRefundRate)
      ? clamp(building.demolitionRefundRate, 0, 1) : 1;
    const refund = Object.fromEntries(Object.entries(paid).map(([id, amount]) => [id, amount * rate]));
    Inventory.add(inventory, refund);
    return refund;
  }

  // A card added to a building's plan is paid from the colony stock and kept
  // in cardCostPaid, so demolishing the building refunds it too.
  function payCard(building, inventory, cost = {}) {
    const missing = Inventory.missing(inventory, cost);
    if (!building || missing === null || missing.length) return { paid: false, missing };
    const chargeable = Inventory.chargeableCost(cost);
    if (!Inventory.consume(inventory, cost)) return { paid: false, missing: Inventory.missing(inventory, cost) };
    building.cardCostPaid ||= {};
    for (const [id, amount] of Object.entries(chargeable)) building.cardCostPaid[id] = (building.cardCostPaid[id] || 0) + amount;
    return { paid: true, missing: [] };
  }

  // Removing a card refunds what was paid for it, never more than what its
  // building's cards cost (cards of older plans were free).
  function refundCard(building, inventory, cost = {}) {
    if (!building) return {};
    const paid = building.cardCostPaid ||= {}, refund = {};
    for (const [id, amount] of Object.entries(Inventory.chargeableCost(cost) || {})) {
      const amountBack = Math.min(amount, Math.max(0, paid[id] || 0));
      if (amountBack <= 0) continue;
      refund[id] = amountBack;
      paid[id] -= amountBack;
    }
    Inventory.add(inventory, refund);
    return refund;
  }

  root.OrbitConstruction = Object.freeze({ start, costFor, advance, demolish, payCard, refundCard, durationSeconds: defaultDurationSeconds });
})(globalThis);
