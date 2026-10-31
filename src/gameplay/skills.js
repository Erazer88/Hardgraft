(function (root) {
  'use strict';

  // The skill tree's state (state.skills): whether it is revealed — once the
  // first goods reach the Ark — and the skills acquired. Both only grow.
  const Data = root.OrbitSkillData;

  function restore(value) {
    const unlocked = Array.isArray(value?.unlocked)
      ? [...new Set(value.unlocked.filter(id => typeof id === 'string' && Data.get(id)))] : [];
    return { revealed: value?.revealed === true, unlocked };
  }

  const everything = () => root.OrbitDeveloperSettings?.get('unlockEverything') === true;

  // Whether any Ark already holds goods.
  function arkReached(state) {
    return Object.values(state.orbitalLogistics?.hubs || {}).some(hub =>
      Object.values(hub?.stock || {}).some(amount => amount > 0));
  }

  // Reveals the tree once the Ark is reached; returns true at that moment.
  function advance(state) {
    const skills = state.skills = restore(state.skills);
    if (skills.revealed || !arkReached(state)) return false;
    skills.revealed = true;
    return true;
  }

  const available = state => everything() || Boolean(state.skills?.revealed);
  const isUnlocked = (state, id) => Boolean(state.skills?.unlocked?.includes(id));

  // Whether its prerequisites are held (it then shows as reachable).
  const reachable = (state, id) => Boolean(Data.get(id)) && available(state) && !isUnlocked(state, id) &&
    Data.get(id).requires.every(required => isUnlocked(state, required));
  // Technology points it still lacks.
  const missingPoints = (state, id) => Math.max(0, (Data.get(id)?.cost.tech || 0) - Math.floor(state.techPoints || 0));

  // A skill can be acquired once reachable and paid for.
  const canUnlock = (state, id) => reachable(state, id) && missingPoints(state, id) === 0;

  function unlock(state, id) {
    if (!canUnlock(state, id)) return false;
    state.techPoints = (state.techPoints || 0) - (Data.get(id).cost.tech || 0);
    state.skills = restore(state.skills);
    state.skills.unlocked.push(id);
    return true;
  }

  root.OrbitSkills = Object.freeze({ restore, arkReached, advance, available, isUnlocked, reachable, missingPoints, canUnlock, unlock });
})(globalThis);
