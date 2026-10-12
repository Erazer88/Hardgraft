(function (root) {
  'use strict';

  const Buildings = root.OrbitBuildingData;
  const Inventory = root.OrbitInventory;
  const defaultDurationSeconds = 3.5;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function start(building, inventory) {
    if (!building || building.constructionState !== 'planned') return { started: false, missing: null };
    const definition = Buildings.get(building.type);
    if (!definition) return { started: false, missing: null };
    const cost = definition.cost || {};
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

  function advance(buildings, deltaSeconds, onComplete = null) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Construction time must be non-negative');
    for (const building of buildings) {
      if (building.constructionState !== 'constructing') continue;
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
    const paid = building.costPaid || {};
    const rate = Number.isFinite(building.demolitionRefundRate)
      ? clamp(building.demolitionRefundRate, 0, 1) : 1;
    const refund = Object.fromEntries(Object.entries(paid).map(([id, amount]) => [id, amount * rate]));
    Inventory.add(inventory, refund);
    return refund;
  }

  root.OrbitConstruction = Object.freeze({ start, advance, demolish, durationSeconds: defaultDurationSeconds });
})(globalThis);
