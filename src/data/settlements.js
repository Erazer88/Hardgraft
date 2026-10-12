(function (root) {
  'use strict';

  // Settlements stay decorative and separate from the player road graph.
  root.OrbitSettlementConfig = Object.freeze({
    growth: Object.freeze({
      maxStages: 48,
      roadLengthPerStage: 320,
      secondaryRoadLengthPerStage: 150,
      // Budget a small connected collector/local-street network per producer.
      secondaryRoadLengthPerProductionBuilding: 300,
      productionRoadInfluenceRadius: 180,
      neighborhoodAttachmentRadius: 130,
      neighborhoodStreetRadius: 118,
      secondaryRoadMaxLength: 150,
      productionAnchorOffsets: Object.freeze([50, 95, 140]),
      initialRouteStages: 2,
      initialBranchMinLength: 65,
      initialBranchMaxLength: 130,
      minMainSegmentLength: 56,
      minAnchorNodeDistance: 36,
      minAnchorSpacing: 38,
      branchEndpointClearance: 30,
      branchMinLength: 55,
      branchMaxLength: 110,
      maxGeneratedRoadLength: 650,
      connectorChance: .62,
      connectorMinSpan: 48,
      connectorMaxSpan: 132,
      secondaryCandidateWeight: 2.1,
      branchCandidateFractions: Object.freeze([.15, .3, .45, .6, .75, .9]),
      pathRetries: 5,
      houseStartDistance: 18,
      houseMinSpacing: 15,
      houseMaxSpacing: 19,
      houseSideOffset: 5.8,
      districtJunctionSnapDistance: 12
    }),
    construction: Object.freeze({ secondarySpeed: 21 }),
    render: Object.freeze({
      minZoom: .075,
      secondaryColor: '#c4cdc5',
      secondaryOpacity: .68,
      secondaryWidthPx: 1.1,
      houseWidthWorld: 10,
      districtWidthWorld: 18,
      spriteOpacity: .93,
      cullMarginPx: 40
    })
  });
})(globalThis);
