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
      // Ground materials as a grade map: for each material, isolines at these
      // shares and a translucent flat tint between them. The richer the band,
      // the more opaque its tint and the brighter and thicker its line.
      materials: Object.freeze({
        // Hues kept away from the magenta strata and from each other: rusty
        // orange iron, verdigris copper, electric blue silica, black carbon
        // (outlined in light so it reads on dark strata), neon green oil.
        colors: Object.freeze({ iron: '#ff8a1c', copper: '#18e0a0', silicon: '#29a3ff', carbon: '#07070b', oil: '#3dff6e' }),
        // A pale halo under the isolines of dark materials.
        lineHalo: Object.freeze({ carbon: '#f1ecff' }),
        levels: Object.freeze([.07, .12, .18, .26]),
        // Tint once a share passes each level (cumulative opacity per band).
        fillOpacity: Object.freeze([.14, .24, .36, .5]),
        lineOpacity: Object.freeze([.6, .75, .9, 1]),
        lineWidthPx: Object.freeze([.9, 1.1, 1.4, 1.8]),
        // The richest line glows.
        topGlowPx: 6,
        // Offshore materials stay quieter.
        marineOpacity: .6,
        // Baked overview layers, in texels per terrain cell.
        layerScale: 2,
        // Baked lines crossfade into vector isolines close up.
        closeUpZoom: Object.freeze([1.1, 1.7])
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
    // Placement guide of the launch platform: equator, favorable band,
    // parallels and meridians.
    // The colony's built-up zone: neon flat tint, brighter near its edge.
    colonyZone: Object.freeze({ pixelsPerCell: 4, fillOpacity: .26, edgeOpacity: .36, outlineWidthPx: 1.4,
      glowWidthPx: 4.5, glowOpacity: .28, glowBlurPx: 10, labelSizePx: 10 }),
    latitudeGrid: Object.freeze({ parallelStepDegrees: 15, meridianStepDegrees: 30,
      equatorColor: '#ffd27b', bandFill: '#ffd27b14', lineColor: '#9fc4dc', lineOpacity: .32,
      labelColor: '#cfe0ea', labelSizePx: 9 }),
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
      // Buildings show as beacons: a hexagon carrying the building icon,
      // centered on the exact spot; roads join it at a corner. Sizes are
      // screen pixels, fixed at every zoom; the outline follows the category.
      pin: Object.freeze({
        // Size at zoomReference (px per km); it follows the zoom
        // (scale = (zoom / zoomReference) ^ zoomExponent, within minScale–maxScale),
        // so beacons stay small over the whole planet and grow close up.
        headRadiusPx: 12.5,
        zoomReference: 1.6,
        zoomExponent: .8,
        minScale: .45,
        maxScale: 2.2,
        fill: '#0b1a2c',
        lineWidthPx: 1.8,
        // A dark rim under the colored outline keeps the head readable on pale strata.
        rimColor: 'rgba(5,10,22,.85)',
        rimWidthPx: 4,
        glowBlurPx: 9,
        glyphSizePx: 12.5,
        glyphLineWidthPx: 1.6,
        glyphColor: '#eefcff',
        categoryColors: Object.freeze({ colony: '#ffd27b', industry: '#ff9a5c', resource: '#ffcf6b', logistics: '#78f0ff', energy: '#b8ff7a', waste: '#c3a6e0' }),
        defaultColor: '#c9d6dc',
        selectedRingPx: 4,
        constructionColor: '#d7a66f',
        constructionOpacity: .55,
        progressWidthPx: 2.4,
        // Ground readout under a drill being placed or selected.
        readoutSizePx: 10,
        readoutFill: 'rgba(6,14,28,.86)',
        readoutColor: '#eefcff',
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
