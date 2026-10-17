(function (root) {
  'use strict';

  const launch = Object.freeze({ capacityUPerSecond: 4, batchIntervalSeconds: 5, energyMW: 5 });
  const transit = Object.freeze({ minimumSeconds: 5, maximumSeconds: 45, referenceHalfOrbitSeconds: 30,
    cargoSpeedMultiplier: .7 });
  const exportResources = Object.freeze([
    Object.freeze({ id: 'raw_iron', label: 'Fer brut' }),
    Object.freeze({ id: 'iron_tailings', label: 'Résidus' }),
    Object.freeze({ id: 'iron_slag', label: 'Laitier' })
  ]);

  root.OrbitOrbitalLogisticsData = Object.freeze({ version: 1, launch, transit, exportResources });
})(globalThis);
