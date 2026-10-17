(function (root) {
  'use strict';

  const launch = Object.freeze({ capacityUPerSecond: 4, batchIntervalSeconds: 10, energyMW: 5 });
  const transit = Object.freeze({ minimumSeconds: 5, maximumSeconds: 45, referenceHalfOrbitSeconds: 30,
    cargoSpeedMultiplier: .7 });
  const transfer = Object.freeze({ directCorrectionRadians: .12, radialExcursionFraction: .16,
    alignmentLaunchIntervalFactor: 1.5, alignmentMinimumRadians: .12, alignmentMaximumRadians: .7,
    routeSamples: 48, durationIterations: 16, durationToleranceSeconds: .001 });
  // Every transportable material can be routed by an output dock. Destination
  // selection lives on the dock; the platform no longer maintains an allowlist.
  const exportResources = Object.freeze((root.OrbitResourceData?.catalog() || [])
    .filter(resource => resource.transportable)
    .map(resource => Object.freeze({ id: resource.id, label: resource.label })));

  root.OrbitOrbitalLogisticsData = Object.freeze({ version: 1, launch, transit, transfer, exportResources });
})(globalThis);
