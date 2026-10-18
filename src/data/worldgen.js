(function (root) {
  'use strict';
  // Relative weights, visual orbital units, and approximate physical parameters.
  // Changing this table changes generated worlds for the same universe seed.
  root.OrbitWorldgenData = {
    version: 4,
    stars: [
      { type: 'M', color: '#cb937a', weight: .36, size: .7, mass: .3, luminosity: .02 },
      { type: 'K', color: '#dcc498', weight: .28, size: .85, mass: .7, luminosity: .25 },
      { type: 'G', color: '#e5dec1', weight: .20, size: 1, mass: 1, luminosity: 1 },
      { type: 'F', color: '#d5e0e3', weight: .10, size: 1.12, mass: 1.3, luminosity: 2.8 },
      { type: 'A', color: '#a4c3dd', weight: .05, size: 1.25, mass: 2, luminosity: 15 },
      { type: 'B', color: '#91abc9', weight: .01, size: 1.4, mass: 5, luminosity: 400 }
    ],
    planetCounts: [6, 10, 14, 17, 17, 13, 9, 6, 4, 2.5, 1.5],
    beltCounts: [40, 40, 16, 4],
    home: { minPlanets: 4, maxPlanets: 6, candidateIndex: 1, minBelts: 1,
      pressure: [.9, 1.1], water: [.38, .58], gravity: [.85, 1.15], geology: [.35, .65], minResource: .45 },
    layouts: [
      { id: 'compact', weight: 25, outer: [740, 900], gapVariation: .35 },
      { id: 'regular', weight: 60, outer: [900, 1050], gapVariation: .8 },
      { id: 'spread', weight: 15, outer: [1050, 1150], gapVariation: 1.5 }
    ],
    orbits: { inner: [170, 230], single: [230, 650], minGap: 74,
      habitableOrbit: [330, 650], emptyExtent: 320, edgePadding: 60 },
    belts: { width: [12, 25], clearance: 12, outerGap: 90 },
    wreckChance: .12,
    planets: { solidRadius: [9, 17], gasRadius: [20, 29],
      gasChance: [.04, .46], pressure: [.015, 6], gravity: [.35, 2.1], water: [0, .82], iceBonus: .10,
      greenhouse: 32, equilibriumKelvin: 255, maxSurfaceWater: .86, oceanCoverageExponent: .72 },
    terrain: {
      version: 7,
      genericWater: [.30, .46], islandWaterThreshold: .56,
      sphericalMasses: {
        continentalCount: [3, 6], islandWorldCount: [3, 6],
        continentalRadius: [.48, .88], islandWorldRadius: [.28, .56],
        continentalSecondaryCount: [1, 4], islandSecondaryCount: [1, 4],
        secondaryRadiusRatio: [.22, .48], secondaryDistanceRatio: [.45, 1.35]
      },
      frozenWaterStartTemperature: 12, frozenWaterFullTemperature: -23, frozenWaterRetention: .9,
      tectonics: {
        plateCount: [12, 24], seedJitter: .16, angularSpeed: [.45, 1.0],
        continentalFrequency: 1.2, plateContinentalInfluence: .035,
        motionScale: 1.1, shoulderWidth: .105, coreWidth: .032,
        subductionOffset: .047, trenchWidth: .033, riftWidth: .038,
        continentalCollision: 76, coastalUplift: 62, islandArcUplift: 27,
        trenchDepth: 12, riftDepth: 19, oceanRidgeUplift: 7,
        warpAmplitude: .014, warpFrequency: 4.2,
        erosion: { passes: 12, rate: .32, talusPerRadian: 155 },
        structure: { sampleAngle: .025, coarseAngle: .055,
          upliftRange: [4, 27], slopeRange: [65, 310], convexityRange: [.12, 2.4] }
      },
      relief: {
        broadAmplitude: 24,
        mediumAmplitude: 9,
        fineAmplitude: 1.5,
        mountainChains: {
          count: [1, 5], segmentCount: [3, 6], segmentLength: [.10, .22],
          beltWidth: [.14, .22], coreWidth: [.022, .045], amplitude: [18, 42],
          domainWarpFrequency: 3.6, domainWarpAmplitude: .038,
          ridgeFrequency: [13, 19], ridgeDetailFrequency: [25, 34],
          ridgeThreshold: [.58, .86], ridgePower: 1.25,
          shoulderHeightRatio: .14, ridgeHeightRatio: .62,
          bend: [-.35, .35],
          branchChance: .55, branchAngle: [.61, 1.22],
          branchLengthRatio: [.35, .60], branchWidthRatio: [.50, .70],
          branchHeightRatio: [.40, .70], branchCoreRatio: [.55, .75],
          valleyCount: [2, 4], valleyAngle: [.87, 1.40],
          valleyLengthRatio: [.35, .65], valleyWidth: [.045, .08],
          valleyCarve: [2, 7]
        }
      },
      deposits: { countWeights: [.08, .12, .34, .30, .13, .03],
        startingCandidateCount: 4, spacingRatio: .21, radiusRatio: [.06, .09] },
      offshoreOil: { planetChance: 1 / 3, temperatureRange: [-10, 40], minimumWater: .18,
        depthBelowSea: 12, radiusRatio: [.075, .10] }
    },
    colors: { tellurique: '#90a58b', océanique: '#6097ad', aride: '#bd9c77',
      glacée: '#99b5c6', volcanique: '#b9846d', gazeuse: '#b4aa92' },
    deposits: [
      { id: 'iron', type: 'fer' }, { id: 'copper', type: 'cuivre' },
      { id: 'silicon', type: 'silice' }, { id: 'carbon', type: 'carbone' }
    ],
    marineDeposits: [{ id: 'oil', type: 'pétrole' }]
  };
})(globalThis);
