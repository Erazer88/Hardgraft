(function (root) {
  'use strict';

  root.OrbitPlanetGlobeStyle = Object.freeze({
    mesh: Object.freeze({ longitudeSegments: 640, latitudeSegments: 320 }),
    relief: Object.freeze({ scale: .045, exponent: 1.10, linearFraction: .34,
      compressionStart: .24, landQuantile: .98, minLandRange: 28, maxLandRange: 70 }),
    water: Object.freeze({ shallow: '#42A4AE', mid: '#176F91', deep: '#073B5C',
      noiseAmplitude: .03, normalStrength: .02, specularStrength: .10, fresnelStrength: .05,
      specularPower: 48, fresnelPower: 3,
      coastDepthDistance: 22, bathymetryDepthScale: 42, bathymetryInfluence: .16 }),
    polarCaps: Object.freeze({ thresholdBase: 76, temperatureReference: 16,
      temperatureScale: .38, minimumThreshold: 48, maximumThreshold: 82,
      broadFrequency: 3.8, secondFrequency: 7, secondWeight: .42,
      coastFrequency: 9.2, broadDisplacementDegrees: 24,
      maximumBroadShiftDegrees: 5.2, coastDisplacementDegrees: 1.6,
      maximumCoastShiftDegrees: 1.2, edgeHalfWidthDegrees: 1.35,
      eligibilityMarginDegrees: 10, latitudeCoolingExponent: 1.55,
      latitudeCoolingDegrees: 38 }),
    terrainShading: Object.freeze({ midReliefStrength: 1.25, microDetailStrength: 0,
      mountainFacetMix: .24, mountainAoStrength: .055, ridgeAccentStrength: .10,
      facetGrid: Object.freeze({ x: 100, y: 50 }),
      controls: Object.freeze({
        heightDerivativeStep: 2, facetStepTexels: 2, slopeScale: 2.2,
        polarNormalBlendStartDegrees: 88, polarNormalBlendEndDegrees: 90,
        polarNormalBlendStrength: .72, polarDetailFadeStartDegrees: 89,
        polarDetailFadeEndDegrees: 90,
        plainSlopeLow: .08, plainSlopeHigh: .22,
        reliefStrengthLow: .14, reliefStrengthHigh: .82, plainReliefMultiplier: .55,
        facetAltitudeLow: .12, facetAltitudeHigh: .42,
        detailSlopeLow: .12, detailSlopeHigh: .30,
        rockSlopeLow: .06, rockSlopeHigh: .20,
        rockExposure: .66, ridgeMaterialMix: .12, valleyMaterialMix: .08,
        lightAmbient: .58, lightDiffuse: .60,
        waterDiffuseAmbient: .94, waterDiffuse: .07,
        lightDirection: Object.freeze({ x: -.42, y: .55, z: .78 })
      }),
      mountainMaterials: Object.freeze({
        temperate: Object.freeze({ rock: '#B59A76', ridge: '#DCC59D', crevice: '#665744' }),
        frozen: Object.freeze({ rock: '#849BA4', ridge: '#D7E4E6', crevice: '#586A70' }),
        arid: Object.freeze({ rock: '#B67852', ridge: '#E0AD78', crevice: '#684438' }),
        volcanic: Object.freeze({ rock: '#765044', ridge: '#A36C50', crevice: '#302625' }),
        default: Object.freeze({ rock: '#B59A76', ridge: '#DCC59D', crevice: '#665744' })
      }) }),
    atmosphere: Object.freeze({ shellScale: 1.025, haloScale: 1.075,
      haloAlpha: .28, rimAlpha: .62, haloPower: 1.55, rimPower: 3.0,
      colors: Object.freeze({ tellurique: '#64C9E8', océanique: '#35D2F2',
        glacée: '#C4E9F5', aride: '#F0B76C', volcanique: '#FF6336',
        gazeuse: '#B5A991', default: '#73C8E0' }) }),
    camera: Object.freeze({ minZoom: .8, maxZoom: 1.56, initialZoom: 1,
      radiusRatio: .4, rotationSensitivity: .006, maxPitch: .72, transitionMs: 320 }),
    resources: Object.freeze({ iron: '#d4a76d', copper: '#c88462', silicon: '#91b5b9',
      carbon: '#a6ad83', oil: '#8f877a' }),
    graticule: Object.freeze({ color: '#d0dddc', opacity: .05, widthPx: .55,
      longitudeStepDegrees: 30, latitudeStepDegrees: 30, sampleStepDegrees: 6 }),
    icon: Object.freeze({ sizePx: 34, hitRadiusPx: 24 }),
    topography: Object.freeze({ contourInterval: 9, majorInterval: 36,
      // Regular elevation bands read as global shadow waves on the globe.
      contourOpacity: 0, majorOpacity: 0 })
  });
})(globalThis);
