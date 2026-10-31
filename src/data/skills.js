(function (root) {
  'use strict';

  // The skill tree: improvements bought with what the colony gathers, opened
  // once the first goods reach the Ark. Only the root is known for now; the
  // rest stays in the fog as silhouettes. Positions are fractions of the map.
  const skills = [
    { id: 'archive_awakening', label: 'RÉVEIL DES ARCHIVES', mark: 'AR', branch: 'ark',
      description: 'L’Arche relit ce qui reste de ses archives à la lumière des premières ressources reçues.',
      effect: 'Ouvre l’arbre de compétences : les prochaines pistes apparaîtront ici.',
      cost: {}, requires: [], x: .5, y: .5 }
  ];
  // Silhouettes around the known skills, linked to the one they grow from.
  const fog = [
    { from: 'archive_awakening', x: .24, y: .26 }, { from: 'archive_awakening', x: .78, y: .24 },
    { from: 'archive_awakening', x: .2, y: .74 }, { from: 'archive_awakening', x: .8, y: .76 },
    { from: 'archive_awakening', x: .5, y: .16 }
  ];

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }

  const byId = new Map(skills.map(skill => [skill.id, skill]));
  root.OrbitSkillData = freeze({ skills, fog, get: id => byId.get(id) || null });
})(globalThis);
