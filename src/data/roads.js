(function (root) {
  'use strict';

  // Routing weights and display measurements are centralized here so the
  // pathfinder and renderer can be tuned without changing their algorithms.
  root.OrbitRoadConfig = Object.freeze({
    gridStep: 2,
    weights: Object.freeze({
      landBase: 1,
      highlandPerElevation: .002,
      terrainRoughness: .065,
      valleyDiscount: .28,
      valleyScale: 18,
      uphillPerElevation: .085,
      downhillPerElevation: .035,
      maxSlopePerHeightCell: 20,
      directionChange: .42,
      shallowWaterMultiplier: 22,
      marineWaterMultiplier: 64,
      roadReuse: .08,
      nearRoad: .25,
      roadInfluenceCells: 1,
      valleyRadiusCells: 3
    }),
    obstacles: Object.freeze({
      maxWaterDepth: 16,
      buildingClearance: 2
    }),
    search: Object.freeze({ maxExpandedStates: 500000 }),
    geometry: Object.freeze({
      rdpTolerance: 9,
      splineSamplesPerSpan: 6,
      splineStrength: .9,
      centripetalAlpha: .5,
      validationSpacing: 3,
      validationRetries: 3
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
