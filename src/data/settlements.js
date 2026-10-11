(function (root) {
  'use strict';

  // Settlements stay decorative and separate from the player road graph.
  root.OrbitSettlementConfig = Object.freeze({
    growth: Object.freeze({
      maxStages: 12,
      roadLengthPerStage: 320,
      minMainSegmentLength: 56,
      minAnchorNodeDistance: 36,
      minAnchorSpacing: 72,
      branchMinLength: 34,
      branchMaxLength: 66,
      loopChance: .24,
      loopMinSpan: 58,
      loopMaxSpan: 96,
      loopOffsetMin: 24,
      loopOffsetMax: 44,
      roundaboutRadius: 4.4,
      pathRetries: 4,
      houseDistances: Object.freeze([32, 50]),
      houseSideOffset: 10,
      districtRoadDistance: 9
    }),
    construction: Object.freeze({ secondarySpeed: 4.2 }),
    render: Object.freeze({
      minZoom: .075,
      secondaryColor: '#c4cdc5',
      secondaryOpacity: .5,
      secondaryWidthPx: .85,
      roundaboutRadiusMinPx: 1.7,
      roundaboutRadiusMaxPx: 5.5,
      roundaboutFill: '#34433a',
      roundaboutFillOpacity: .72,
      houseWidthWorld: 12,
      districtWidthWorld: 48,
      spriteOpacity: .93,
      cullMarginPx: 40
    })
  });
})(globalThis);
