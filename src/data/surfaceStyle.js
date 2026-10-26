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
      coastColor: '#ff87b7',
      glow: .42,
      oceanGridStepWorld: 100,
      oceanGridMajorEvery: 4,
      oceanGridMinorColor: '#75a4c413',
      oceanGridMajorColor: '#8ab0c91d',
      oceanGridLineWidth: 1,
      // Glow radii are tuned for a map about this wide on screen.
      glowReferenceWidthPx: 1600,
      // Share of a 3×3 blur in the shore field (0 keeps the cell staircase; above .66 drops lone cells).
      shoreSmoothing: .6,
      coastLineWidthPx: 1.15,
      coastLineMaxZoomScale: 2.2,
      coastGlowBlurPx: 4.5,
      coastGlowOpacity: .7,
      // Relief strata: one tint per elevation band, darker lowlands to pale
      // summits, separated by thin, identical contour lines. Kept discreet so
      // gameplay elements stand out.
      relief: Object.freeze({
        bandStep: 16,
        // Texels per terrain cell for the baked strata; the map texture has 3.
        layerScale: 2,
        colors: Object.freeze(['#521440', '#6c1f55', '#882d6a', '#a33f7f', '#bb5593', '#ce6fa6', '#dc8bb8', '#e6a5c8']),
        pigment: .06,
        lineColor: '#ffd3e8',
        lineOpacity: .16,
        lineWidthPx: .6,
        // Fainter secondary lines split each stratum in this many slices.
        minorLines: 4,
        minorLineOpacity: .055,
        // Each stratum brightens slightly toward the next one.
        innerGradient: .3,
        // Light from the top left: a gentle hillshade, then stacked-paper steps
        // (ambient and cast shadow below each step, a lit rim above it), both
        // fading out over several texels and eased in over stepSoftenTexels.
        lightDirection: Object.freeze([-.62, -.78]),
        lightHeight: .9,
        reliefExaggeration: .09,
        hillshade: .28,
        stepShadow: .2,
        stepAmbient: .06,
        stepShadowTexels: 11,
        stepHighlight: .12,
        stepHighlightTexels: 4,
        stepSoftenTexels: 2.5,
        // Small knolls and hollows of micro-relief over the strata (render only):
        // noise feature size in cells, the noise level past which ground rises
        // (or sinks below its opposite), and how much they lighten or darken,
        // self-shade and outline (baked texture, then vector lines close up).
        // A blob is kept whole only inside a patch (patch noise size in cells
        // and threshold), within one stratum, marginCells clear of its limits
        // and no larger than maxCells.
        detail: Object.freeze({ scaleCells: 3.4, threshold: .26, softness: .12, lift: .05, shade: .16,
          lineOpacity: .22, vectorLineOpacity: .14,
          patchCells: 30, patchThreshold: .5, marginCells: 1.2, maxCells: 40 })
      }),
      // Faint depth lines offshore, at these elevations (sea level is 102).
      bathymetry: Object.freeze({ levels: Object.freeze([94, 80, 62]), color: '#6fa3cc', opacity: .16 }),
      marsh: Object.freeze({ tint: '#5a3a78', tintOpacity: .3, mark: '#86e6d2', markOpacity: .35 }),
      // Ground materials: sparse glowing dots colored by the dominant material.
      // A cell starts showing a dot from minShare and is at full chance and
      // brightness at fullShare; density caps the share of cells with a dot.
      materials: Object.freeze({
        colors: Object.freeze({ iron: '#ffb83d', copper: '#3ee8c6', silicon: '#4fd9ff', carbon: '#b9a8ff', oil: '#d4ff5c' }),
        minShare: .08,
        fullShare: .3,
        density: .12,
        coreOpacity: .75,
        haloOpacity: .14,
        // Baked overview layer: texels per terrain cell and dot sizes in texels.
        layerScale: 1.5,
        coreTexels: 1.1,
        haloTexels: 3,
        // Close up, dots are drawn at a constant screen size instead.
        corePx: 1.8,
        haloPx: 5,
        closeUpZoom: Object.freeze([1.1, 1.7]),
        // Ore veins, a light hint: a faint glow, a thin body and a fine core whose
        // width follows the vein's strength. Texels on the baked layer, px close up.
        veins: Object.freeze({
          glowTexels: 3.4, bodyTexels: 1.4, coreTexels: .55,
          glowPx: 6, bodyPx: 2.2, corePx: .9,
          glowOpacity: .1, bodyOpacity: .5, coreOpacity: .85,
          coreColor: '#fff6e8', coreTint: .45,
          minWidth: .35, strengthBuckets: 4
        }),
        // Rich nodes where veins meet: a soft halo, a faint ring and a bright center.
        nodes: Object.freeze({
          haloTexels: 6, ringTexels: 4, coreTexels: 1.8,
          haloPx: 11, ringPx: 6, corePx: 2.2,
          haloOpacity: .22, ringOpacity: .22, ringWidthPx: .7, coreOpacity: .8
        })
      }),
      // Lakes and rivers share the sea's dark water and its neon shoreline.
      water: Object.freeze({
        lakeColor: '#0d2742',
        riverColor: '#0d2742',
        riverEdgeColor: '#ff9cc6',
        riverEdgeOpacity: .3,
        riverEdgePx: 1.2,
        riverMinWidthKm: .6,
        riverWidthPerFlowKm: .4,
        riverMaxWidthKm: 3,
        // Only rivers draining at least this many times the source threshold are drawn.
        riverMinFlow: 2,
        // Visual meanders, in cells, so courses never run as straight grid lines.
        meanderAmplitude: .9,
        meanderWavelength: 7
      })
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
      // Buildings show as beacons: a hexagonal head carrying the building icon,
      // raised on a thin stem over a glowing ring that marks the exact spot.
      // Sizes are screen pixels; the outline color follows the category.
      pin: Object.freeze({
        headRadiusPx: 17,
        stemPx: 15,
        groundRingPx: 4.5,
        groundShadowPx: 10,
        fill: '#0b1a2c',
        lineWidthPx: 2.2,
        // A dark rim under the colored outline keeps the head readable on pale strata.
        rimColor: 'rgba(5,10,22,.85)',
        rimWidthPx: 5,
        glowBlurPx: 12,
        glyphSizePx: 17,
        glyphLineWidthPx: 1.9,
        glyphColor: '#eefcff',
        categoryColors: Object.freeze({ industry: '#ff9a5c', resource: '#ffcf6b', logistics: '#78f0ff', energy: '#b8ff7a' }),
        defaultColor: '#c9d6dc',
        selectedRingPx: 5,
        constructionColor: '#d7a66f',
        constructionOpacity: .55,
        progressWidthPx: 3,
        ghostOpacity: .65
      })
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
      buildingFullZoom: .65,
      buildingCompactZoom: .22,
      buildingSymbolZoom: .08
    })
  });
})(globalThis);
