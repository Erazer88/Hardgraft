(function (root) {
  'use strict';

  const order = Object.freeze(['outpost', 'factory', 'extractor', 'depot', 'port']);
  const definitions = Object.freeze({
    outpost: Object.freeze({
      id: 'outpost', name: 'Avant-poste', code: 'AVP', color: '#efa35a', duration: 4, footprint: 30,
      description: 'Noyau de la colonie et relais de commandement au sol.',
      cost: Object.freeze({ iron: 60, copper: 35, silicon: 20, carbon: 15, water: 25 }),
      production: null, energy: 0
    }),
    factory: Object.freeze({
      id: 'factory', name: 'Usine', code: 'USI', color: '#77c7d9', duration: 4, footprint: 140,
      description: 'Espace industriel intérieur à rang I, prêt pour une chaîne de production.',
      cost: Object.freeze({ iron: 85, copper: 60, silicon: 45, carbon: 18, water: 15 }),
      production: null, energy: 1.2
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
      production: null, energy: 0, logisticsCapacity: 1200
    }),
    port: Object.freeze({
      id: 'port', name: 'Port d’envoi', code: 'POR', color: '#82c5de', duration: 5, footprint: 38,
      description: 'Terminal de fret pour recevoir les flux des usines et préparer leur expédition.',
      cost: Object.freeze({ iron: 110, copper: 70, silicon: 50, carbon: 35, water: 20 }),
      production: null, energy: 1.8, logisticsCapacity: 800
    })
  });

  root.OrbitBuildingData = Object.freeze({ order, definitions, refundRate: 1 });
})(globalThis);
