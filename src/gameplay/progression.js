(function (root) {
  'use strict';

  // Opens the steps of OrbitProgressionData as the colony's needs appear.
  // Unlocks are kept in state.unlocks and only ever grow.
  const Data = root.OrbitProgressionData;

  function restoreUnlocks(value) {
    const list = items => Array.isArray(items) ? [...new Set(items.filter(item => typeof item === 'string' && item))] : [];
    return { steps: list(value?.steps), buildings: list(value?.buildings), cards: list(value?.cards) };
  }

  function everything() { return root.OrbitDeveloperSettings?.get('unlockEverything') === true; }

  function holds(condition, state) {
    const colonies = (state.surfaceBuildings || []).filter(building => building.type === 'colony');
    if (condition === 'start') return true;
    if (condition === 'colonyPlaced') return colonies.length > 0;
    if (condition === 'powerShort') return Object.values(state.powerStatus || {}).some(power => power.demandMW > power.supplyMW + 1e-6);
    if (Number.isInteger(condition?.tier)) return colonies.some(building => (building.colony?.tier || 0) >= condition.tier);
    return false;
  }

  // Opens every step whose condition now holds; returns what just appeared.
  function advance(state) {
    const unlocks = state.unlocks = restoreUnlocks(state.unlocks);
    const opened = { buildings: [], cards: [] };
    for (const step of Data.steps) {
      // A step already open still gains what the table added since.
      if (!unlocks.steps.includes(step.id)) {
        if (!holds(step.when, state)) continue;
        unlocks.steps.push(step.id);
      }
      for (const type of step.buildings || []) if (!unlocks.buildings.includes(type)) { unlocks.buildings.push(type); opened.buildings.push(type); }
      for (const card of step.cards || []) if (!unlocks.cards.includes(card)) { unlocks.cards.push(card); opened.cards.push(card); }
    }
    return opened;
  }

  function buildingUnlocked(state, type) {
    return everything() || Boolean(state.unlocks?.buildings?.includes(type));
  }

  // A card definition is available once its type, or its "type:material"
  // variant, has been unlocked.
  function cardUnlocked(state, definition) {
    if (everything()) return true;
    const cards = state.unlocks?.cards || [];
    return cards.includes(definition.id) ||
      Boolean(definition.contextResourceId && cards.includes(`${definition.id}:${definition.contextResourceId}`));
  }

  root.OrbitProgression = Object.freeze({ restoreUnlocks, advance, buildingUnlocked, cardUnlocked });
})(globalThis);
