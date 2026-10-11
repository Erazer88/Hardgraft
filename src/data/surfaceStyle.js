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
      reliefTextureOpacity: .28,
      materialTextureScale: 2,
      materialTextureOpacity: .56,
      shelfDepthCells: 72,
      shelfDistanceCells: 26,
      temperatureLapsePerElevation: .17,
      globeRevealStartRadiusPx: 50,
      globeRevealEndRadiusPx: 150,
      mapExpansionRatio: 1 / 3
    }),
    climate: Object.freeze({
      temperatureBands: Object.freeze([
        { temperature: -60, sea: '#527282', shore: '#bac5bd', lowland: '#7f8982', upland: '#929c97', highland: '#b4bebc', snow: '#e2e9e7', dry: '#9d9483' },
        { temperature: -20, sea: '#315d73', shore: '#b8c1b4', lowland: '#727f70', upland: '#828c83', highland: '#afb9b2', snow: '#e2e7e0', dry: '#a3987d' },
        { temperature: 5, sea: '#1b4055', shore: '#b8ac8b', lowland: '#536b4e', upland: '#73775d', highland: '#a49f89', snow: '#dbddd4', dry: '#a49170' },
        { temperature: 20, sea: '#173a50', shore: '#c0b18f', lowland: '#49694b', upland: '#737556', highland: '#a19881', snow: '#e1e0d7', dry: '#ad926b' },
        { temperature: 35, sea: '#16364d', shore: '#baa37a', lowland: '#72754f', upland: '#837459', highland: '#a59377', snow: '#e6dfd2', dry: '#b08c63' },
        { temperature: 55, sea: '#182f44', shore: '#b58e65', lowland: '#91714d', upland: '#9a7956', highland: '#b09b7f', snow: '#ece2cc', dry: '#bb8b5c' },
        { temperature: 100, sea: '#1b2d3d', shore: '#b67b57', lowland: '#9a664b', upland: '#a5795b', highland: '#bc9d7f', snow: '#e9d8bc', dry: '#c38255' },
        { temperature: 180, sea: '#222d39', shore: '#8e5443', lowland: '#6b4b43', upland: '#886257', highland: '#a58a75', snow: '#d5c5ae', dry: '#985740' }
      ]),
      vegetationTemperatureRange: [-8, 42],
      drySoilBlend: .52,
      snowlineStartTemperature: 4,
      snowlineRange: 18
    }),
    resources: Object.freeze({
      markerRadiusMinPx: 8,
      markerRadiusMaxPx: 14,
      markerRadiusPerTerrainCellPx: .6,
      ellipseXRatio: 1.35,
      ellipseYRatio: .75,
      ellipseAngleRadians: -.45,
      hatchSpacingPx: 4,
      hatchColor: '#e7cf8291',
      hatchWidthPx: .7,
      marineHatchColor: '#f0a84cbb',
      marineOutlineColor: '#f0a84caa',
      marineDotColor: '#ffd189',
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
      resourceLabelZoom: .55,
      buildingFullZoom: .65,
      buildingCompactZoom: .22,
      buildingSymbolZoom: .08
    })
  });
})(globalThis);
