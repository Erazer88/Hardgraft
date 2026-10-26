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
      buildingClearance: 2
    }),
    search: Object.freeze({ maxExpandedStates: 500000, heuristicWeight: 1.6 }),
    marine: Object.freeze({
      waterCost: .65,
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
        Object.freeze({ widthPx: 7, opacity: .13 }),
        Object.freeze({ widthPx: 3.4, opacity: .38 })
      ]),
      waterColor: '#b8f6ff',
      waterOpacity: .9,
      waterDotRadiusPx: 1.15,
      waterDotSpacingPx: 7,
      // Junctions are small diamonds: dark center, glowing outline.
      junctionColor: '#9ff4ff',
      junctionFill: '#0b1a2c',
      junctionHalfSizePx: 4.2,
      junctionLineWidthPx: 1.3,
      // Bridges: two short rails on both sides of the road over a river.
      bridgeColor: '#effcff',
      bridgeLengthPx: 7,
      bridgeOffsetPx: 3.2,
      bridgeWidthPx: 1.1,
      marineColor: '#9ff4ff',
      marineOpacity: .6,
      marineWidthPx: 1.25,
      marineDashPx: Object.freeze([6, 5]),
      constructionColor: '#f3b46b',
      constructionPulsePeriodMs: 1450,
      constructionPulseRadiusPx: 5.5,
      constructionPulseOpacity: .42,
      constructionHeadRadiusPx: 1.8
    })
  });
})(globalThis);
