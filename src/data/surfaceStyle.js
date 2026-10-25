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
      lineColor: '#75a4c413',
      tickSpacingThresholdPx: 65,
      tickHalfLengthPx: 2.5,
      tickColor: '#8ab0c930',
      labelOffsetXPx: 6,
      labelOffsetBottomPx: 97,
      labelColor: '#6f8ea6',
      labelSizePx: 8
    }),
    terrain: Object.freeze({
      edgeColor: '#a9b9ad40',
      edgeWidthPx: 1,
      globeRevealStartRadiusPx: 50,
      globeRevealEndRadiusPx: 150
    }),
    // Neon map palette, ported from the neon-map prototype. Land remains flat:
    // no relief lighting, shadows or contour cues, only a low pigment variation.
    neon: Object.freeze({
      oceanColor: '#07182b',
      landColor: '#bd4d89',
      coastColor: '#ff87b7',
      glow: .42,
      oceanGridStepWorld: 100,
      oceanGridMajorEvery: 4,
      oceanGridMinorColor: '#75a4c413',
      oceanGridMajorColor: '#8ab0c91d',
      oceanGridLineWidth: 1,
      // Glow radii are tuned for a map about this wide on screen.
      glowReferenceWidthPx: 1600,
      pigmentFrequencies: Object.freeze([3, 10.5, 30, 83]),
      coastLineWidthPx: 1.15,
      coastLineMaxZoomScale: 2.2,
      coastGlowBlurPx: 4.5,
      coastGlowOpacity: .7
    }),
    resources: Object.freeze({
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
