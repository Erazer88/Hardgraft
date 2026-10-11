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
      comfortableSlopePerHeightCell: 1,
      steepGradePenalty: .7,
      maxSlopePerHeightCell: 12,
      directionChange: .14,
      switchbackGradePerHeightCell: 2.5,
      switchbackTurnMultiplier: .28,
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
    search: Object.freeze({ maxExpandedStates: 500000 }),
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
    render: Object.freeze({
      landColor: '#f2f4ef',
      landOpacity: .86,
      landWidthPx: 1.25,
      waterColor: '#f2f4ef',
      waterOpacity: .82,
      waterDotRadiusPx: 1.15,
      waterDotSpacingPx: 7,
      junctionColor: '#f2f4ef',
      junctionRadiusPx: 2.1,
      constructionColor: '#f3b46b',
      constructionPulsePeriodMs: 1450,
      constructionPulseRadiusPx: 5.5,
      constructionPulseOpacity: .42,
      constructionHeadRadiusPx: 1.8
    })
  });
})(globalThis);
