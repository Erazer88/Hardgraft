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
      version: 5,
      genericWater: [.30, .46], islandWaterThreshold: .56,
      frozenWaterStartTemperature: 12, frozenWaterFullTemperature: -23, frozenWaterRetention: .9,
      // Maps are drawn shape-first: landmasses and islands define the coast,
      // then the relief is built from the distance to that coast. Sizes are
      // fractions of the smaller map side; land areas are fractions of the map.
      landmasses: {
        continentCount: [2, 4], islandWorldContinentCount: [1, 3],
        // Share of the land budget spent on islands rather than continents.
        islandShare: [.08, .18], islandWorldIslandShare: [.35, .55],
        islandCount: [8, 18], islandWorldIslandCount: [22, 40],
        // Most islands form chains off a continent; the rest rise in open sea.
        coastalIslandRatio: .7, islandChainSpacing: [.9, 1.6],
        elongation: [1, 1.8], separation: 1, placementAttempts: 32,
        // Each continent is a core with smaller lobes: peninsulas and subcontinents.
        lobeCount: [1, 3], lobeSize: [.35, .62], lobeDistance: [.55, .95]
      },
      coast: {
        // A domain warp bends each landform, then fractal noise bands carve
        // capes, bays and coves: finer bands move the coast less, as on real
        // shorelines. Amplitudes are distances, in fractions of the map side.
        warp: .1, warpScale: 2.4,
        bands: [{ scale: 2.2, amplitude: .1 }, { scale: 6, amplitude: .06 },
          { scale: 16, amplitude: .035 }, { scale: 45, amplitude: .018 }, { scale: 120, amplitude: .007 }]
      },
      // Planet kinds whose landmasses always sit in open sea, off the map edge.
      oceanBorder: { kinds: ['tellurique', 'océanique'], minimumWater: .7,
        minimumOcean: .03, edgeWidth: .16, edgeDepth: .16, edgeWarp: .05 },
      relief: {
        // Heights above sea level grow inland; depths grow offshore.
        inlandScale: .07, lowlandRise: 30, hillAmplitude: 26, hillScale: 9,
        mountainScale: 6, mountainPower: 2.6, mountainAmplitude: 96, mountainCoverage: .5,
        shelfScale: .03, shelfDepth: 14, oceanScale: .12, oceanDepth: 46, seabedAmplitude: 6
      },
      deposits: { countWeights: [.08, .12, .34, .30, .13, .03],
        startingCandidateCount: 4, spacingRatio: .1575, radiusRatio: [.045, .0675] },
      offshoreOil: { planetChance: 1 / 3, temperatureRange: [-10, 40], minimumWater: .18,
        depthBelowSea: 12, radiusRatio: [.05625, .075] }
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
