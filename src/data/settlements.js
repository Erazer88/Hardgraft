(function (root) {
  'use strict';

  // Settlements stay decorative and separate from the player road graph.
  root.OrbitSettlementConfig = Object.freeze({
    growth: Object.freeze({
      maxStages: 32,
      roadLengthPerStage: 320,
      secondaryRoadLengthPerStage: 150,
      minMainSegmentLength: 56,
      minAnchorNodeDistance: 36,
      minAnchorSpacing: 38,
      branchEndpointClearance: 30,
      branchMinLength: 105,
      branchMaxLength: 230,
      maxGeneratedRoadLength: 480,
      connectorChance: .62,
      connectorMinSpan: 100,
      connectorMaxSpan: 330,
      secondaryCandidateWeight: 2.1,
      branchCandidateFractions: Object.freeze([.32, .5, .68]),
      pathRetries: 5,
      houseMinSpacing: 38,
      houseMaxSpacing: 58,
      houseSideOffset: 10,
      districtRoadDistance: 9
    }),
    construction: Object.freeze({ secondarySpeed: 4.2 }),
    render: Object.freeze({
      minZoom: .075,
      secondaryColor: '#c4cdc5',
      secondaryOpacity: .68,
      secondaryWidthPx: 1.1,
      houseWidthWorld: 12,
      districtWidthWorld: 48,
      spriteOpacity: .93,
      cullMarginPx: 40
    })
  });
})(globalThis);
