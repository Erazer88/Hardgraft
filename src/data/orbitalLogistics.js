(function (root) {
  'use strict';

  const launch = Object.freeze({ capacityUPerSecond: 4, batchIntervalSeconds: 10, energyMW: 5 });
  const transit = Object.freeze({ minimumSeconds: 5, maximumSeconds: 45, referenceHalfOrbitSeconds: 30,
    cargoSpeedMultiplier: .7 });
  const transfer = Object.freeze({ directCorrectionRadians: .12, radialExcursionFraction: .16,
    alignmentLaunchIntervalFactor: 1.5, alignmentMinimumRadians: .12, alignmentMaximumRadians: .7,
    routeSamples: 48, durationIterations: 16, durationToleranceSeconds: .001 });
  // Destination choice is made at the dock. V1 only routes to factories and
  // launch platforms; other logistics/building destinations remain out of scope.
  const dockDestinationTypes = Object.freeze(['factory', 'launch_platform']);
  const exportResources = Object.freeze((root.OrbitResourceData?.catalog() || [])
    .filter(resource => resource.transportable)
    .map(resource => Object.freeze({ id: resource.id, label: resource.label })));

  root.OrbitOrbitalLogisticsData = Object.freeze({ version: 1, launch, transit, transfer,
    dockDestinationTypes, exportResources });
})(globalThis);
