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
      cost: {}, requires: ['archive_awakening'], x: .5, y: .3 },
    { id: 'lander', label: 'ATTERRISSEUR', mark: 'AT', branch: 'space',
      description: 'Un atterrisseur dépose robots et matériel sur les autres mondes du système.',
      effect: 'Permet de poser une colonie et un laboratoire d’analyse sur les autres planètes rocheuses.',
      cost: { tech: 200 }, requires: ['computer_network'], x: .78, y: .14 },
    // The cost and the assembly time of the lab: OrbitDataNetworkData.orbitalLab.
    { id: 'orbital_lab', label: 'LABORATOIRE ORBITAL', mark: 'LO', branch: 'space',
      description: 'Les robots de l’Arche assemblent un laboratoire en orbite d’une géante gazeuse, avec les matériaux de son stock.',
      effect: 'Permet de construire un laboratoire en orbite des géantes gazeuses : 20 plaques de métal, 10 cuivre brut et 10 silicium brut pris dans le stock de l’Arche, puis 90 s d’assemblage.',
      cost: { tech: 300 }, requires: ['lander'], x: .9, y: .34 }
  ];
  // Silhouettes around the known skills, linked to the one they grow from.
  const fog = [
    { from: 'archive_awakening', x: .2, y: .55 }, { from: 'archive_awakening', x: .8, y: .55 },
    { from: 'archive_awakening', x: .3, y: .86 }, { from: 'archive_awakening', x: .7, y: .86 },
    { from: 'computer_network', x: .22, y: .12 }, { from: 'orbital_lab', x: .95, y: .6 }
  ];

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }

  const byId = new Map(skills.map(skill => [skill.id, skill]));
  root.OrbitSkillData = freeze({ skills, fog, get: id => byId.get(id) || null });
})(globalThis);
