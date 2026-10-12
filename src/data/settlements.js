(function (root) {
  'use strict';

  // Settlements stay decorative and separate from the player road graph.
  root.OrbitSettlementConfig = Object.freeze({
    growth: Object.freeze({
      maxStages: 48,
      roadLengthPerStage: 320,
      secondaryRoadLengthPerStage: 150,
      // Give each connected land producer room for several short feeder roads.
      secondaryRoadLengthPerProductionBuilding: 260,
      productionRoadInfluenceRadius: 180,
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
      connectorMinSpan: 140,
      connectorMaxSpan: 440,
      secondaryCandidateWeight: 2.1,
      branchCandidateFractions: Object.freeze([.15, .3, .45, .6, .75, .9]),
      pathRetries: 5,
      cityStage: 5,
      districtMinMainRoadLength: 260,
      districtMinPlacementSegmentLength: 90,
      districtRouteChance: .12,
      districtMinSpacing: 220,
      houseStartDistance: 54,
      houseMinSpacing: 15,
      houseMaxSpacing: 19,
      houseSideOffset: 5.8,
      districtSideOffset: 7.5
    }),
    construction: Object.freeze({ secondarySpeed: 21 }),
    render: Object.freeze({
      minZoom: .075,
      secondaryColor: '#c4cdc5',
      secondaryOpacity: .68,
      secondaryWidthPx: 1.1,
      houseWidthWorld: 10,
      districtWidthWorld: 10,
      spriteOpacity: .93,
      cullMarginPx: 40
    })
  });
})(globalThis);
