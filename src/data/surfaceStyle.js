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
      globeRevealStartRadiusPx: 50,
      globeRevealEndRadiusPx: 150,
      mapExpansionRatio: 1 / 3
    }),
    resources: Object.freeze({
      markerRadiusBasePx: 8,
      markerRadiusPerZoom: 4,
      ellipseXRatio: 1.35,
      ellipseYRatio: .75,
      ellipseAngleRadians: -.45,
      hatchSpacingPx: 4,
      hatchColor: '#e7cf8291',
      hatchWidthPx: .7,
      labelOffsetXPx: 6,
      labelColor: '#c7c49b',
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
      siteImageWidthPx: 64,
      siteImageHeightPx: 48,
      siteImageOpacity: .96
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
      resourceLabelZoom: .55,
      buildingFullZoom: .65,
      buildingCompactZoom: .22,
      buildingSymbolZoom: .08
    })
  });
})(globalThis);
