(function (root) {
  'use strict';
  // Relative weights, visual orbital units, and approximate physical parameters.
  // Changing this table changes generated worlds for the same universe seed.
  root.OrbitWorldgenData = {
    version: 3,
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
      version: 2,
      genericWater: [.30, .46], islandWaterThreshold: .56,
      continentalMassCount: [2, 4], islandMassCount: [6, 10],
      continentalMassRadius: [.20, .39], islandMassRadius: [.10, .23],
      archipelago: { continentalIslets: [5, 11], islandIslets: [12, 24],
        isletRadius: [.012, .038], parentDistance: [1.15, 2.2] },
      frozenWaterStartTemperature: 12, frozenWaterFullTemperature: -23, frozenWaterRetention: .9,
      relief: { warpScale: 2.2, warpStrength: .035, fineScale: 40, fineAmplitude: 8,
        microScale: 92, microAmplitude: 3.8 },
      deposits: { minimum: 4, maximum: 12, cellsPerDeposit: 14000,
        spacingRatio: .115, radiusRatio: [.034, .052] },
      offshoreOil: { minimumWater: .18, fieldsPerWaterFraction: 5,
        minimumFields: 1, maximumFields: 4, depthBelowSea: 12,
        spacingRatio: .13, radiusRatio: [.052, .078] }
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
