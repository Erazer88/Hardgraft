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
      // Inland relief, in elevation units above the sea (sea level 102, top 255).
      // Scales are noise frequencies per map side; widths are in cells.
      relief: {
        // Relief fades out over a narrow coastal strip only, so the interior is
        // shaped by uplift and basins rather than by the distance to the sea.
        // The coastal strip width varies along the shore: cliffs here, broad plains there.
        coastRamp: [.012, .075], coastRampScale: 2.6, inlandScale: .07, coastalRise: 6, detail: 5, detailScale: 18,
        // Broad uplift: divides and long valleys that gather rivers into basins.
        uplift: { scale: 2, amplitude: 34 },
        // Broad lowland basins flatten the relief into plains.
        plains: { scale: 1.5, coverage: .45, flattening: .75 },
        hills: { scale: 7, amplitude: 24 },
        // Mesas: flat-topped plateaus with stepped cliffs, where rivers cut canyons.
        plateaus: { scale: 2.3, coverage: .44, height: 60, terraces: 3, cliff: .22 },
        // Mountain massifs follow winding belts; ridged noise raises the crests.
        mountains: { beltScale: 1.3, beltWidth: .42, ridgeScale: 5, octaves: 5,
          height: 132, peakPower: 1.3 },
        ocean: { shelfScale: .03, shelfDepth: 14, oceanScale: .12, oceanDepth: 46, seabedAmplitude: 6 }
      },
      // Water on land. Hydrology scales with the planet's water: dry worlds keep
      // canyons as dry riverbeds, without rivers, lakes or marshes.
      hydrology: {
        waterRange: [.04, .3],
        // Lakes fill basins up to their spill level; small hollows become flats.
        lakes: { basinCount: [3, 7], basinRadius: [.02, .05], basinDepth: 30, lobes: [2, 4],
          shoreNoise: .55, minDepth: 3, minArea: 10, maxDepth: 9,
          // At most this share of the land becomes lakes; the deepest basins win.
          maxShare: .025 },
        // Rivers start where the drained area passes the threshold (fraction of the map).
        rivers: { threshold: .0018, carve: 4, maxCarve: 14, valleyWidth: [1.6, 6],
          canyonStart: 45, canyonDepth: 40, canyonWidth: 1.6 },
        // Marshes: flat, wet floodplains (wider along big rivers), lake shores and filled hollows.
        marshes: { maxHeight: 40, maxSlope: .7, minMoisture: .45, reach: 4, floodplain: 2.5, patchiness: -.05 },
        // Criques: estuaries cut at the mouths of large rivers through high coasts.
        coves: { minFlow: 4, minCoastHeight: 14, length: [3, 9] }
      },
      // Ground composition: every cell mixes plain rock with these materials,
      // and the rest of the cell is rock. Shares are first drafts.
      // `affinity` weighs terrain traits, each between 0 and 1, where a
      // material concentrates: mountain, upland, plain, coast, river, marsh,
      // dry, rugged, remote, island, shelf, deep. `rarity` favors ground that is
      // hard to reach. Marine materials only exist under the sea.
      materials: {
        list: [
          { id: 'iron', base: .02, peak: .3, affinity: { mountain: 1, upland: .55, rugged: .3, island: .35 } },
          { id: 'copper', base: .004, peak: .14, rarity: 1,
            affinity: { rugged: .7, mountain: .45, remote: .45, island: .65 } },
          { id: 'silicon', base: .02, peak: .28, affinity: { coast: .85, dry: .7, river: .35, plain: .2 } },
          { id: 'carbon', base: .01, peak: .3, affinity: { marsh: 1, plain: .45, river: .3 } },
          { id: 'oil', base: 0, peak: .3, marine: true, pocketThreshold: .25, affinity: { shelf: .8, deep: .15 } }
        ],
        // Each zone (a warped Voronoi cell about this wide) scales every material
        // by its own factor, and favors one signature material. Factors blend
        // across this share of the zone size at borders.
        zoneSize: .075, zoneVariation: [.25, 1.9], signatureBoost: 1.7, zoneBlend: .35,
        // Pockets where materials concentrate, as a noise frequency per map side.
        hotspotScale: 9, hotspotSharpness: 2,
        // Hard-to-reach ground and small islands hold richer pockets.
        difficultyBonus: .8, islandBonus: .6,
        maxOreShare: .72,
        // The natal world always offers a rich pocket of each land material.
        natalMinimumPeak: .14
      }
    },
    colors: { tellurique: '#90a58b', océanique: '#6097ad', aride: '#bd9c77',
      glacée: '#99b5c6', volcanique: '#b9846d', gazeuse: '#b4aa92' },
    // Planet-wide richness indices of the land materials, drawn per planet.
    planetMaterials: ['iron', 'copper', 'silicon', 'carbon']
  };
})(globalThis);
