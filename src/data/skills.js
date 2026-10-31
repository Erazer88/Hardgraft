(function (root) {
  'use strict';

  // The skill tree, opened once the first goods reach the Ark. Skills are
  // paid in technology points (cost.tech, made by datacenters); the rest of
  // the tree stays in the fog as silhouettes. Positions are fractions of the map.
  const skills = [
    { id: 'archive_awakening', label: 'RÉVEIL DES ARCHIVES', mark: 'AR', branch: 'ark',
      description: 'L’Arche relit ce qui reste de ses archives à la lumière des premières ressources reçues.',
      effect: 'Ouvre l’arbre de compétences : les prochaines pistes apparaîtront ici.',
      cost: {}, requires: [], x: .5, y: .62 },
    // Free: the datacenter it opens is what makes technology points.
    { id: 'computer_network', label: 'RÉSEAU INFORMATIQUE', mark: 'RI', branch: 'ark',
      description: 'Foreuses et usines transmettent leurs données par des paraboles à un datacenter, qui les traite en points de technologie.',
      effect: 'Débloque le Datacenter, la Parabole et leurs cartes. Les points de technologie paient la suite de l’arbre.',
      cost: {}, requires: ['archive_awakening'], x: .5, y: .3 }
  ];
  // Silhouettes around the known skills, linked to the one they grow from.
  const fog = [
    { from: 'archive_awakening', x: .2, y: .55 }, { from: 'archive_awakening', x: .8, y: .55 },
    { from: 'archive_awakening', x: .3, y: .86 }, { from: 'archive_awakening', x: .7, y: .86 },
    { from: 'computer_network', x: .22, y: .12 }, { from: 'computer_network', x: .78, y: .12 }
  ];

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }

  const byId = new Map(skills.map(skill => [skill.id, skill]));
  root.OrbitSkillData = freeze({ skills, fog, get: id => byId.get(id) || null });
})(globalThis);
