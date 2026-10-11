(function (root) {
  'use strict';

  // Routing weights and display measurements are centralized here so the
  // pathfinder and renderer can be tuned without changing their algorithms.
  root.OrbitRoadConfig = Object.freeze({
    gridStep: 2,
    weights: Object.freeze({
      landBase: 1,
      highlandPerElevation: .004,
      terrainRoughness: .18,
      valleyDiscount: .4,
      valleyScale: 12,
      uphillPerElevation: .12,
      downhillPerElevation: .07,
      comfortableSlopePerHeightCell: 1.4,
      steepGradePenalty: .48,
      maxSlopePerHeightCell: 12,
      directionChange: .22,
      switchbackGradePerHeightCell: 2.5,
      switchbackTurnMultiplier: .28,
      shallowWaterMultiplier: 22,
      marineWaterMultiplier: 64,
      roadReuse: .08,
      nearRoad: .25,
      roadInfluenceCells: 1,
      valleyRadiusCells: 4
    }),
    obstacles: Object.freeze({
      maxWaterDepth: 16,
      buildingClearance: 2
    }),
    search: Object.freeze({ maxExpandedStates: 500000 }),
    geometry: Object.freeze({
      rdpTolerance: 3,
      splineSamplesPerSpan: 6,
      splineStrength: .62,
      centripetalAlpha: .5,
      validationSpacing: 1.5,
      maxSplineDeviation: 4.5,
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
      junctionRadiusPx: 2.1
    })
  });
})(globalThis);
