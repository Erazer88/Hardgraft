(function (root) {
  'use strict';

  // Routing weights and display measurements are centralized here so the
  // pathfinder and renderer can be tuned without changing their algorithms.
  root.OrbitRoadConfig = Object.freeze({
    gridStep: 2,
    weights: Object.freeze({
      landBase: 1,
      highlandPerElevation: .004,
      terrainRoughness: .3,
      valleyDiscount: .52,
      valleyScale: 10,
      uphillPerElevation: .15,
      downhillPerElevation: .1,
      comfortableSlopePerHeightCell: .8,
      steepGradePenalty: 4,
      maxSlopePerHeightCell: 12,
      directionChange: .14,
      switchbackGradePerHeightCell: .8,
      switchbackTurnMultiplier: .28,
      // Side slope of the hillside a road cuts across (earthworks).
      crossSlopePenalty: .03,
      // Drawn rivers (from this flow) are crossed by bridges, not followed.
      bridgeMinFlow: 2,
      riverCrossing: 5,
      riverAlong: 2.5,
      shallowWaterMultiplier: 22,
      marineWaterMultiplier: 64,
      roadReuse: .02,
      nearRoad: .055,
      manualRoadCenterCost: 8,
      manualRoadInfluenceCost: 2.4,
      roadInfluenceCells: 3,
      valleyRadiusCells: 6
    }),
    obstacles: Object.freeze({
      maxWaterDepth: 16,
      // Deep water narrower than this many routing cells (6 km each) between
      // two shores can be bridged; bridge cells cost bridgeMultiplier.
      bridgeMaxSpanCells: 6,
      bridgeMultiplier: 30,
      buildingClearance: 2
    }),
    search: Object.freeze({ maxExpandedStates: 500000, heuristicWeight: 1.6 }),
    marine: Object.freeze({
      waterCost: .65,
      // Sea lanes keep off the shore: water within this many routing cells of
      // land costs more, up to (1 + coastPenalty) times at the shore itself.
      coastClearanceCells: 6,
      coastPenalty: 5,
      // A lane may round a whole continent: the search may expand this many states.
      maxExpandedStates: 2500000,
      docking: Object.freeze({
        clearanceCells: 1,
        approachCells: 2,
        maxSearchCells: 12,
        searchStepFraction: .25
      })
    }),
    network: Object.freeze({
      snapDistance: 6.5,
      minimumSameRouteSeparation: 48
    }),
    interaction: Object.freeze({
      roadSnapRadiusPx: 18,
      previewIntervalMs: 85,
      previewOpacity: .52,
      freePreviewColor: '#ffffff',
      freePreviewOpacity: 1,
      freePreviewWidthPx: 1.8,
      freePreviewDashPx: Object.freeze([1, 5])
    }),
    construction: Object.freeze({
      speedByClass: Object.freeze({ main: 22, secondary: 8 })
    }),
    geometry: Object.freeze({
      rdpTolerance: 2,
      splineSamplesPerSpan: 10,
      splineStrength: .94,
      centripetalAlpha: .5,
      validationSpacing: 1.5,
      maxSplineDeviation: 8,
      validationRetries: 4
    }),
    // Neon filament: a soft cyan glow in two passes under a white core.
    render: Object.freeze({
      landColor: '#effcff',
      landOpacity: .95,
      landWidthPx: 1.2,
      glowColor: '#78f0ff',
      glowPasses: Object.freeze([
        Object.freeze({ widthPx: 5, opacity: .08 }),
        Object.freeze({ widthPx: 2.6, opacity: .24 })
      ]),
      // Zoomed out, roads thin down to this share of their width.
      zoomWidth: Object.freeze({ farZoom: .7, nearZoom: 1.8, farScale: .55 }),
      waterColor: '#b8f6ff',
      waterOpacity: .9,
      waterDotRadiusPx: 1.15,
      waterDotSpacingPx: 7,
      // Bridges: two short rails on both sides of the road over a river.
      bridgeColor: '#effcff',
      bridgeLengthPx: 7,
      bridgeOffsetPx: 3.2,
      bridgeWidthPx: 1.1,
      // Sea lanes: a dotted line, lighter than roads.
      marineColor: '#c8f8ff',
      marineMinScale: .8,
      marineOpacity: .85,
      marineWidthPx: 2.4,
      marineDashPx: Object.freeze([.1, 5.5]),
      // Transfers along a road: light pulses that start slowly, accelerate up
      // to a cruise speed they never exceed (cruiseMsPerKm on land, seaSlowdown
      // times slower on sea lanes) and strike the destination beacon, while
      // the link stays active.
      transit: Object.freeze({
        activeSeconds: 5,
        intervalMs: 1300,
        cruiseMsPerKm: 8,
        startSpeedFraction: .2,
        accelerationMs: 800,
        seaSlowdown: 4,
        // Tail length: the distance covered in this time, in screen pixels at most.
        tailMs: 90,
        tailMaxPx: 46,
        tailSteps: 10,
        headRadiusPx: 2.6,
        color: '#f4feff',
        glowColor: '#78f0ff',
        glowBlurPx: 9,
        impactMs: 420,
        impactRadiusPx: 14
      }),
      constructionColor: '#f3b46b',
      constructionPulsePeriodMs: 1450,
      constructionPulseRadiusPx: 5.5,
      constructionPulseOpacity: .42,
      constructionHeadRadiusPx: 1.8
    })
  });
})(globalThis);
