(function (root) {
  'use strict';

  // Settlements stay decorative and separate from the player road graph.
  root.OrbitSettlementConfig = Object.freeze({
    growth: Object.freeze({
      maxStages: 48,
      roadLengthPerStage: 320,
      secondaryRoadLengthPerStage: 150,
      initialRouteStages: 2,
      initialBranchMinLength: 240,
      initialBranchMaxLength: 400,
      minMainSegmentLength: 56,
      minAnchorNodeDistance: 36,
      minAnchorSpacing: 38,
      branchEndpointClearance: 30,
      branchMinLength: 180,
      branchMaxLength: 320,
      maxGeneratedRoadLength: 650,
      connectorChance: .62,
      connectorMinSpan: 140,
      connectorMaxSpan: 440,
      secondaryCandidateWeight: 2.1,
      branchCandidateFractions: Object.freeze([.32, .5, .68]),
      pathRetries: 5,
      cityStage: 5,
      districtMinRoadLength: 120,
      houseStartDistance: 54,
      houseMinSpacing: 15,
      houseMaxSpacing: 19,
      houseSideOffset: 4.5,
      districtRoadDistance: 11
    }),
    construction: Object.freeze({ secondarySpeed: 4.2 }),
    render: Object.freeze({
      minZoom: .075,
      secondaryColor: '#c4cdc5',
      secondaryOpacity: .68,
      secondaryWidthPx: 1.1,
      houseWidthWorld: 10,
      districtWidthWorld: 64,
      spriteOpacity: .93,
      cullMarginPx: 40
    })
  });
})(globalThis);
