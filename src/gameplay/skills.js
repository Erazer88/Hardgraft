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

  // A skill can be acquired once the tree is open, its prerequisites held.
  function canUnlock(state, id) {
    const skill = Data.get(id);
    return Boolean(skill) && available(state) && !isUnlocked(state, id) &&
      skill.requires.every(required => isUnlocked(state, required));
  }

  function unlock(state, id) {
    if (!canUnlock(state, id)) return false;
    state.skills = restore(state.skills);
    state.skills.unlocked.push(id);
    return true;
  }

  root.OrbitSkills = Object.freeze({ restore, arkReached, advance, available, isUnlocked, canUnlock, unlock });
})(globalThis);
