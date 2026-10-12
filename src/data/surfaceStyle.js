(function (root) {
  'use strict';

  // Screen-space art direction for the planet surface. Values here affect only
  // drawing; terrain/building/road positions remain in world coordinates.
  root.OrbitSurfaceStyle = Object.freeze({
    grid: Object.freeze({
      worldStep: 100,
      minSpacingPx: 45,
      maxSpacingPx: 180,
      lineWidthPx: 1,
      lineColor: '#d5d9b713',
      tickSpacingThresholdPx: 65,
      tickHalfLengthPx: 2.5,
      tickColor: '#dde1c025',
      labelOffsetXPx: 6,
      labelOffsetBottomPx: 97,
      labelColor: '#557184',
      labelSizePx: 8
    }),
    terrain: Object.freeze({
      edgeColor: '#a9b9ad40',
      edgeWidthPx: 1,
      shelfDepthCells: 72,
      shelfDistanceCells: 26,
      temperatureLapsePerElevation: .17,
      globeRevealStartRadiusPx: 50,
      globeRevealEndRadiusPx: 150,
      mapExpansionRatio: 1 / 3
    }),
    climate: Object.freeze({
      temperatureBands: Object.freeze([
        { temperature: -60, sea: '#294e68', shore: '#c6d6d2', lowland: '#637b78', upland: '#82928a', highland: '#aeb9b5', snow: '#f2f5f1', dry: '#a49b88' },
        { temperature: -20, sea: '#174462', shore: '#c9c8a8', lowland: '#496b54', upland: '#70816e', highland: '#a0aaa0', snow: '#f1f3eb', dry: '#ad9a70' },
        { temperature: 5, sea: '#0d3450', shore: '#d8bd86', lowland: '#37643f', upland: '#6b714c', highland: '#8e8b7a', snow: '#eff2eb', dry: '#b49360' },
        { temperature: 20, sea: '#071f3b', shore: '#d7b879', lowland: '#30623a', upland: '#687146', highland: '#888374', snow: '#f4f5ef', dry: '#b2844f' },
        { temperature: 35, sea: '#09243e', shore: '#d1aa6e', lowland: '#5e6938', upland: '#77704a', highland: '#93836e', snow: '#f0eee5', dry: '#b88a52' },
        { temperature: 55, sea: '#102c43', shore: '#c99966', lowland: '#816447', upland: '#92704f', highland: '#a78b6d', snow: '#eee5d3', dry: '#bd8956' },
        { temperature: 100, sea: '#1a2c40', shore: '#b87955', lowland: '#966044', upland: '#a47655', highland: '#b89472', snow: '#ead9c0', dry: '#c17d4e' },
        { temperature: 180, sea: '#242d3a', shore: '#945342', lowland: '#70453c', upland: '#8e5e50', highland: '#ad8870', snow: '#ddcbb5', dry: '#a25a41' }
      ]),
      vegetationTemperatureRange: [-8, 42],
      drySoilBlend: .52,
      snowlineStartTemperature: 4,
      snowlineRange: 18
    }),
    resources: Object.freeze({
      markerRadiusMinPx: 11,
      markerRadiusMaxPx: 54,
      markerRadiusWorldScale: .45,
      ellipseXRatio: 1.28,
      ellipseYRatio: .78,
      ellipseAngleRadians: -.45,
      hatchSpacingPx: 5,
      hatchWidthPx: 1.25,
      outlineWidthPx: 1.25,
      outlineDashPx: Object.freeze([4, 3]),
      glowBlurPx: 5,
      deposits: Object.freeze({
        iron: Object.freeze({ fill: '#ffd72c26', hatch: '#ffdb45f2', outline: '#fff0a0', glow: '#f1c623', label: '#ffe575' }),
        copper: Object.freeze({ fill: '#ff943326', hatch: '#ff9d3df2', outline: '#ffd1a0', glow: '#ff832f', label: '#ffc07a' }),
        silicon: Object.freeze({ fill: '#45dff126', hatch: '#58effff2', outline: '#b5faff', glow: '#32dcea', label: '#8bf5ff' }),
        carbon: Object.freeze({ fill: '#b9eb3226', hatch: '#c6f34af2', outline: '#edff9e', glow: '#a7d92c', label: '#d7f776' }),
        oil: Object.freeze({ fill: '#ffad3026', hatch: '#ffbd43f2', outline: '#ffe0a1', glow: '#ff9f22', label: '#ffd079' })
      }),
      labelOffsetXPx: 6,
      labelSizePx: 8
    }),
    selection: Object.freeze({
      radiusPx: 7,
      color: '#efb26e',
      outlineWidthPx: 1,
      tickInnerRadiusPx: 9,
      tickOuterRadiusPx: 13,
      tickWidthPx: .8
    }),
    buildings: Object.freeze({
      cardWidthPx: 132,
      cardMinWidthPx: 120,
      cardMaxWidthPx: 145,
      cardHeightPx: 62,
      cardRadiusPx: 5,
      cardPaddingPx: 9,
      cardFill: '#0a1724',
      cardOpacity: .92,
      cardOutlineColor: '#8da8b7',
      cardOutlineWidthPx: .8,
      selectedOutlineColor: '#efa35a',
      selectedOutlineWidthPx: 1.2,
      iconSizePx: 18,
      iconRadiusPx: 9,
      titleSizePx: 9,
      valueSizePx: 8,
      activityBarHeightPx: 2,
      portRadiusPx: 3.5,
      spriteFootprintScale: 1.5,
      spriteMinWidthPx: 7.5,
      spriteSelectedPaddingPx: 1.5,
      spriteOpacity: .96,
      spriteGhostOpacity: .62
    }),
    roads: Object.freeze({
      normalColor: '#b9c5c7',
      normalOpacity: .62,
      selectedColor: '#e7b477',
      selectedOpacity: .86,
      constructionOpacity: .55,
      projectDashPx: 4,
      farWidthPx: 1,
      closeWidthPx: 1.7,
      selectedWidthPx: 1.9,
      junctionRadiusPx: 2.1,
      junctionOpacity: .55
    }),
    vehicles: Object.freeze({
      widthPx: 7,
      heightPx: 4,
      visualProgressPerSecond: .025,
      visibleZoom: .35,
      fadeStartZoom: .28,
      fadeEndZoom: .42
    }),
    labels: Object.freeze({
      siteTitleSizePx: 9,
      siteDetailSizePx: 8,
      distantSiteSizePx: 8,
      maxMobileWidthPx: 145
    }),
    lod: Object.freeze({
      surfaceGridZoom: .06,
      terrainDetailsZoom: .15,
      resourceLabelZoom: .28,
      buildingFullZoom: .65,
      buildingCompactZoom: .22,
      buildingSymbolZoom: .08
    })
  });
})(globalThis);
