(function (root) {
  'use strict';

  const launch = Object.freeze({ capacityUPerSecond: 4, batchIntervalSeconds: 10, energyMW: 5 });
  const transit = Object.freeze({ minimumSeconds: 5, maximumSeconds: 45, referenceHalfOrbitSeconds: 30,
    cargoSpeedMultiplier: .7 });
  const transfer = Object.freeze({ directCorrectionRadians: .12, radialExcursionFraction: .16,
    alignmentLaunchIntervalFactor: 1.5, alignmentMinimumRadians: .12, alignmentMaximumRadians: .7,
    routeSamples: 48, durationIterations: 16, durationToleranceSeconds: .001 });
  // Destination choice is made at the dock: factories, launch platforms,
  // depots (which route further) and waste heaps.
  const dockDestinationTypes = Object.freeze(['factory', 'launch_platform', 'storage', 'waste_heap']);
  // The launch platform (space hub) climbs to orbit more cheaply near the
  // equator: launch energy grows with latitude. The map spans this many
  // degrees north and south of its middle row.
  const launchSite = Object.freeze({ latitudeExtentDegrees: 75, equatorEnergyMW: 5, energyPerDegreeMW: .14,
    favorableLatitudeDegrees: 10 });
  // The Ark turns refined materials it receives into construction stock for
  // the colony (per unit received). Other cargo only fills its hold.
  const arkConstructionCredits = Object.freeze({
    raw_iron: Object.freeze({ iron: 1 }), raw_copper: Object.freeze({ copper: 1 }),
    raw_silicon: Object.freeze({ silicon: 1 }), carbon: Object.freeze({ carbon: 1 })
  });
  // Latitude of a surface point: the middle row is the equator, north at the top.
  function latitudeAt(y, mapHeight) {
    if (!Number.isFinite(y) || !(mapHeight > 0)) return 0;
    return Math.max(-1, Math.min(1, (.5 - y / mapHeight) * 2)) * launchSite.latitudeExtentDegrees;
  }
  // Launch power of a platform at this latitude.
  function launchEnergyMW(latitude) {
    return launchSite.equatorEnergyMW + launchSite.energyPerDegreeMW * Math.abs(latitude || 0);
  }
  const exportResources = Object.freeze((root.OrbitResourceData?.catalog() || [])
    .filter(resource => resource.transportable)
    .map(resource => Object.freeze({ id: resource.id, label: resource.label })));

  root.OrbitOrbitalLogisticsData = Object.freeze({ version: 1, launch, transit, transfer,
    dockDestinationTypes, exportResources, launchSite, latitudeAt, launchEnergyMW, arkConstructionCredits });
})(globalThis);
