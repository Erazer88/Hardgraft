(function (root) {
  'use strict';

  const order = Object.freeze(['outpost', 'extractor', 'depot']);
  const definitions = Object.freeze({
    outpost: Object.freeze({
      id: 'outpost', name: 'Avant-poste', code: 'AVP', color: '#efa35a', duration: 4, footprint: 30,
      description: 'Noyau de la colonie et relais de commandement au sol.',
      cost: Object.freeze({ iron: 60, copper: 35, silicon: 20, carbon: 15, water: 25 }),
      production: null, energy: 0
    }),
    extractor: Object.freeze({
      id: 'extractor', name: 'Extracteur', code: 'EXT', color: '#d6c47b', duration: 3, footprint: 22,
      description: 'Prépare un gisement pour la future chaîne d’extraction.',
      cost: Object.freeze({ iron: 35, copper: 20, silicon: 10, carbon: 6 }),
      production: null, energy: 0
    }),
    depot: Object.freeze({
      id: 'depot', name: 'Dépôt', code: 'DEP', color: '#8eb8c5', duration: 3.5, footprint: 26,
      description: 'Réserve sécurisée pour les matériaux de la colonie.',
      cost: Object.freeze({ iron: 45, copper: 15, silicon: 25, carbon: 10, water: 5 }),
      production: null, energy: 0
    })
  });

  root.OrbitBuildingData = Object.freeze({ order, definitions, refundRate: 1 });
})(globalThis);
