(function (root) {
  'use strict';

  const MINERAL_IDS = new Set(['iron', 'copper', 'silicon', 'carbon']);

  function isAmountMap(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function validEntries(amounts) {
    if (!isAmountMap(amounts)) return false;
    return Object.entries(amounts).every(([id, amount]) => id.trim() &&
      Number.isFinite(amount) && amount >= 0);
  }

  function create(amounts = {}) {
    if (!isAmountMap(amounts)) return {};
    return Object.fromEntries(Object.entries(amounts)
      .filter(([id, amount]) => id.trim() && Number.isFinite(amount) && amount > 0));
  }

  function isInfinite(id) {
    return MINERAL_IDS.has(id) && root.OrbitDeveloperSettings?.get('infiniteMinerals') === true;
  }

  function chargeableCost(cost) {
    if (!validEntries(cost)) return null;
    return Object.fromEntries(Object.entries(cost).filter(([id]) => !isInfinite(id)));
  }

  function missing(inventory, cost) {
    const chargeable = chargeableCost(cost);
    if (chargeable === null) return null;
    return Object.entries(chargeable).flatMap(([id, amount]) => {
      const available = Number.isFinite(inventory?.[id]) && inventory[id] > 0 ? inventory[id] : 0;
      return available + 1e-9 >= amount ? [] : [{ id, amount: amount - available }];
    });
  }

  function canAfford(inventory, cost) {
    return Boolean(isAmountMap(inventory) && missing(inventory, cost)?.length === 0);
  }

  function consume(inventory, cost) {
    const chargeable = chargeableCost(cost);
    if (chargeable === null || !canAfford(inventory, cost)) return false;
    for (const [id, amount] of Object.entries(chargeable)) {
      const remaining = inventory[id] - amount;
      if (remaining <= 1e-9) delete inventory[id];
      else inventory[id] = remaining;
    }
    return true;
  }

  function add(inventory, amounts) {
    if (!isAmountMap(inventory) || !validEntries(amounts)) {
      throw new TypeError('Inventory additions must be non-negative resource amounts');
    }
    for (const [id, amount] of Object.entries(amounts)) {
      if (amount > 0) inventory[id] = (inventory[id] || 0) + amount;
    }
    return inventory;
  }

  root.OrbitInventory = Object.freeze({ create, canAfford, missing, consume, add, isInfinite, chargeableCost });
})(globalThis);
