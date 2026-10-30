(function (root) {
  'use strict';

  const Buildings = root.OrbitBuildingData;
  const Inventory = root.OrbitInventory;
  const defaultDurationSeconds = 3.5;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const pricesEnabled = () => Buildings.construction?.pricesEnabled !== false;

  // What a building costs to start; nothing while prices are masked.
  function costFor(type) {
    const definition = Buildings.get(type);
    if (!definition) return null;
    return pricesEnabled() ? { ...(definition.cost || {}) } : {};
  }

  // What a card costs to add to a plan; nothing while prices are masked.
  function cardCost(definition) {
    return pricesEnabled() ? { ...(definition?.cost || {}) } : {};
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
    // A site that needs deliveries waits for them before the robots come.
    if (Object.keys(definition.constructionNeeds || {}).length) {
      building.constructionState = 'supplying';
      building.status = 'supplying';
      building.constructionSupplied = {};
    } else {
      building.constructionState = 'constructing';
      building.status = 'building';
    }
    return { started: true, missing: [] };
  }

  // What a supplying site still waits for, per resource.
  function needsLeft(building) {
    const needs = Buildings.get(building?.type)?.constructionNeeds || {};
    return Object.fromEntries(Object.entries(needs).map(([id, amount]) =>
      [id, Math.max(0, amount - (building.constructionSupplied?.[id] || 0))]).filter(([, left]) => left > 0));
  }

  // Share of a site's deliveries received, from 0 to 1.
  function supplyFraction(building) {
    const needs = Object.entries(Buildings.get(building?.type)?.constructionNeeds || {});
    const total = needs.reduce((sum, [, amount]) => sum + amount, 0);
    if (!total) return 1;
    return needs.reduce((sum, [id, amount]) => sum + Math.min(amount, building.constructionSupplied?.[id] || 0), 0) / total;
  }

  // Moves what reached a supplying site (its inventory) into its supplies;
  // once complete, the site goes to the robots.
  function supply(building) {
    const supplied = building.constructionSupplied ||= {}, stock = building.inventory ||= {};
    for (const [id, left] of Object.entries(needsLeft(building))) {
      const amount = Math.min(left, Math.floor(stock[id] || 0));
      if (amount <= 0) continue;
      supplied[id] = (supplied[id] || 0) + amount;
      stock[id] -= amount;
      if (stock[id] <= 0) delete stock[id];
    }
    if (Object.keys(needsLeft(building)).length) return false;
    building.constructionState = 'constructing';
    building.status = 'building';
    building.constructionProgress = 0;
    return true;
  }

  // Sites progress in the order they were started, as many at once as there
  // are construction crews; the others wait their turn.
  function advance(buildings, deltaSeconds, onComplete = null) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Construction time must be non-negative');
    const crews = Buildings.construction?.crews ?? Infinity;
    let busy = 0;
    for (const building of buildings) {
      if (building.constructionState === 'supplying') supply(building);
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

  root.OrbitConstruction = Object.freeze({ start, needsLeft, supplyFraction, costFor, cardCost, pricesEnabled, advance, demolish, payCard, refundCard, durationSeconds: defaultDurationSeconds });
})(globalThis);
