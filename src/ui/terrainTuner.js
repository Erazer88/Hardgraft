(function (root) {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  const definitions = Object.freeze([
    // Large continental structures.
    { group: '1 · MACRO RELIEF', kind: 'terrain', path: 'tectonics.continentalFrequency', label: 'Fréquence continentale', min: .35, max: 3.5, step: .01 },
    { group: '1 · MACRO RELIEF', kind: 'terrain', path: 'tectonics.plateCount.0', label: 'Plaques · minimum', min: 6, max: 32, step: 1 },
    { group: '1 · MACRO RELIEF', kind: 'terrain', path: 'tectonics.plateCount.1', label: 'Plaques · maximum', min: 8, max: 40, step: 1 },
    { group: '1 · MACRO RELIEF', kind: 'terrain', path: 'tectonics.angularSpeed.0', label: 'Vitesse des plaques · minimum', min: .1, max: 1.5, step: .001 },
    { group: '1 · MACRO RELIEF', kind: 'terrain', path: 'tectonics.angularSpeed.1', label: 'Vitesse des plaques · maximum', min: .1, max: 1.8, step: .001 },
    { group: '1 · MACRO RELIEF', kind: 'terrain', path: 'tectonics.plateContinentalInfluence', label: 'Influence continentale des plaques', min: 0, max: .16, step: .001 },
    { group: '1 · MACRO RELIEF', kind: 'terrain', path: 'tectonics.continentalBase.base', label: 'Altitude de base', min: 30, max: 120, step: .1 },
    { group: '1 · MACRO RELIEF', kind: 'terrain', path: 'tectonics.continentalBase.plateauRise', label: 'Montée du plateau continental', min: 0, max: 100, step: .1 },
    { group: '1 · MACRO RELIEF', kind: 'terrain', path: 'tectonics.continentalBase.coastRange.0', label: 'Début de transition côtière', min: .05, max: .75, step: .001 },
    { group: '1 · MACRO RELIEF', kind: 'terrain', path: 'tectonics.continentalBase.coastRange.1', label: 'Fin de transition côtière', min: .10, max: .95, step: .001 },

    // Tectonic sources and orogenic belts.
    { group: '2 · MONTAGNES', kind: 'planet', path: 'geology', label: 'Activité géologique', min: 0, max: 1, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.motionScale', label: 'Échelle du mouvement des plaques', min: .2, max: 2, step: .01 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.subductionOffset', label: 'Décalage de subduction', min: 0, max: .14, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.trenchWidth', label: 'Largeur des fosses', min: .005, max: .12, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.riftWidth', label: 'Largeur des rifts', min: .005, max: .14, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.continentalCollision', label: 'Collision continentale', min: 0, max: 140, step: .1 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.coastalUplift', label: 'Soulèvement côtier', min: 0, max: 140, step: .1 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.islandArcUplift', label: 'Soulèvement des arcs insulaires', min: 0, max: 80, step: .1 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.trenchDepth', label: 'Profondeur des fosses', min: 0, max: 36, step: .1 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.riftDepth', label: 'Profondeur des rifts', min: 0, max: 48, step: .1 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.oceanRidgeUplift', label: 'Soulèvement des dorsales océaniques', min: 0, max: 25, step: .1 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.crustProbe', label: 'Distance de sondage de croûte', min: .005, max: .14, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.continentalThreshold.0', label: 'Seuil continental bas', min: 0, max: .9, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.continentalThreshold.1', label: 'Seuil continental haut', min: .05, max: 1, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.beltWidth', label: 'Largeur de la zone orogénique', min: .04, max: .5, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.coreWidth', label: 'Largeur du cœur montagneux', min: .005, max: .24, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.ridgeSpacing', label: 'Espacement des crêtes', min: .01, max: .16, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.ridgeExponent', label: 'Contraste des crêtes', min: .4, max: 5, step: .01 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.ridgeWarpAmplitude', label: 'Déformation des crêtes', min: 0, max: .06, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.ridgeWarpFrequency', label: 'Fréquence de déformation des crêtes', min: .5, max: 14, step: .01 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.ridgeObliqueAmplitude', label: 'Crêtes obliques', min: 0, max: .08, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.ridgeAmplitude', label: 'Force des crêtes', min: 0, max: 1.6, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.alongVariationFrequency', label: 'Variation le long des chaînes', min: .3, max: 10, step: .01 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.interruptionFrequency', label: 'Fréquence des cols', min: .3, max: 12, step: .01 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.interruptionThreshold.0', label: 'Seuil des interruptions bas', min: -1, max: .8, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.interruptionThreshold.1', label: 'Seuil des interruptions haut', min: -.8, max: 1, step: .001 },
    { group: '2 · MONTAGNES', kind: 'terrain', path: 'tectonics.orogeny.coastalOffset', label: 'Décalage des chaînes côtières', min: 0, max: .14, step: .001 },

    // Low and regional terrain away from the tectonic cores.
    { group: '3 · PLAINES', kind: 'terrain', path: 'tectonics.continentalBase.inlandRange.0', label: 'Début du plateau intérieur', min: .1, max: .95, step: .001 },
    { group: '3 · PLAINES', kind: 'terrain', path: 'tectonics.continentalBase.inlandRange.1', label: 'Fin du plateau intérieur', min: .15, max: 1, step: .001 },
    { group: '3 · PLAINES', kind: 'terrain', path: 'tectonics.continentalBase.inlandRise', label: 'Relief du plateau intérieur', min: 0, max: 24, step: .1 },
    { group: '3 · PLAINES', kind: 'terrain', path: 'tectonics.terrainRelief.regional.frequency', label: 'Échelle régionale', min: .3, max: 8, step: .01 },
    { group: '3 · PLAINES', kind: 'terrain', path: 'tectonics.terrainRelief.regional.amplitude', label: 'Amplitude régionale', min: 0, max: 70, step: .1 },
    { group: '3 · PLAINES', kind: 'terrain', path: 'tectonics.terrainRelief.hills.frequency', label: 'Échelle des collines', min: .5, max: 20, step: .01 },
    { group: '3 · PLAINES', kind: 'terrain', path: 'tectonics.terrainRelief.hills.amplitude', label: 'Amplitude des collines', min: 0, max: 40, step: .1 },

    // Domain warping and structural irregularity.
    { group: '4 · WARP / IRRÉGULARITÉ', kind: 'terrain', path: 'tectonics.continentalWarpFrequency', label: 'Fréquence du warp continental', min: .1, max: 5, step: .01 },
    { group: '4 · WARP / IRRÉGULARITÉ', kind: 'terrain', path: 'tectonics.continentalWarpAmplitude', label: 'Force du warp continental', min: 0, max: .35, step: .001 },
    { group: '4 · WARP / IRRÉGULARITÉ', kind: 'terrain', path: 'tectonics.continentalEdgeFrequency', label: 'Fréquence du contour continental', min: .5, max: 14, step: .01 },
    { group: '4 · WARP / IRRÉGULARITÉ', kind: 'terrain', path: 'tectonics.continentalEdgeAmplitude', label: 'Irrégularité du contour continental', min: 0, max: .22, step: .001 },
    { group: '4 · WARP / IRRÉGULARITÉ', kind: 'terrain', path: 'tectonics.seedJitter', label: 'Jitter des plaques', min: 0, max: .5, step: .001 },
    { group: '4 · WARP / IRRÉGULARITÉ', kind: 'terrain', path: 'tectonics.warpFrequency', label: 'Fréquence du warp topographique', min: .3, max: 12, step: .01 },
    { group: '4 · WARP / IRRÉGULARITÉ', kind: 'terrain', path: 'tectonics.warpAmplitude', label: 'Force du warp topographique', min: 0, max: .08, step: .001 },

    // Existing FBM controls only.
    { group: '5 · DÉTAIL', kind: 'terrain', path: 'tectonics.fbm.persistence', label: 'Persistence / gain FBM', min: .1, max: .85, step: .001 },
    { group: '5 · DÉTAIL', kind: 'terrain', path: 'tectonics.fbm.lacunarity', label: 'Lacunarity FBM', min: 1.1, max: 3.5, step: .001 },
    { group: '5 · DÉTAIL', kind: 'terrain', path: 'tectonics.terrainRelief.regional.octaves', label: 'Octaves régionales', min: 1, max: 6, step: 1 },
    { group: '5 · DÉTAIL', kind: 'terrain', path: 'tectonics.terrainRelief.hills.octaves', label: 'Octaves des collines', min: 1, max: 6, step: 1 },
    { group: '5 · DÉTAIL', kind: 'terrain', path: 'tectonics.terrainRelief.fine.frequency', label: 'Fréquence du détail fin', min: 1, max: 42, step: .01 },
    { group: '5 · DÉTAIL', kind: 'terrain', path: 'tectonics.terrainRelief.fine.amplitude', label: 'Amplitude du détail fin', min: 0, max: 15, step: .1 },
    { group: '5 · DÉTAIL', kind: 'terrain', path: 'tectonics.terrainRelief.fine.octaves', label: 'Octaves du détail fin', min: 1, max: 6, step: 1 },

    // Actual erosion and terrain-structure sampling thresholds.
    { group: '6 · LISSAGE / ÉROSION', kind: 'terrain', path: 'tectonics.erosion.passes', label: 'Passes d’érosion thermique', min: 0, max: 32, step: 1 },
    { group: '6 · LISSAGE / ÉROSION', kind: 'terrain', path: 'tectonics.erosion.rate', label: 'Taux d’érosion', min: 0, max: .8, step: .001 },
    { group: '6 · LISSAGE / ÉROSION', kind: 'terrain', path: 'tectonics.erosion.talusPerRadian', label: 'Talus maximum', min: 20, max: 320, step: .1 },
    { group: '6 · LISSAGE / ÉROSION', kind: 'terrain', path: 'tectonics.structure.sampleAngle', label: 'Échelle de pente du masque', min: .005, max: .08, step: .001 },
    { group: '6 · LISSAGE / ÉROSION', kind: 'terrain', path: 'tectonics.structure.coarseAngle', label: 'Échelle de rugosité', min: .01, max: .16, step: .001 },
    { group: '6 · LISSAGE / ÉROSION', kind: 'terrain', path: 'tectonics.structure.upliftRange.0', label: 'Masque montagne · uplift bas', min: 0, max: 60, step: .1 },
    { group: '6 · LISSAGE / ÉROSION', kind: 'terrain', path: 'tectonics.structure.upliftRange.1', label: 'Masque montagne · uplift haut', min: 1, max: 90, step: .1 },
    { group: '6 · LISSAGE / ÉROSION', kind: 'terrain', path: 'tectonics.structure.slopeRange.0', label: 'Masque pente · bas', min: 0, max: 500, step: .1 },
    { group: '6 · LISSAGE / ÉROSION', kind: 'terrain', path: 'tectonics.structure.slopeRange.1', label: 'Masque pente · haut', min: 1, max: 650, step: .1 },
    { group: '6 · LISSAGE / ÉROSION', kind: 'terrain', path: 'tectonics.structure.convexityRange.0', label: 'Masque crête · convexité basse', min: 0, max: 5, step: .001 },
    { group: '6 · LISSAGE / ÉROSION', kind: 'terrain', path: 'tectonics.structure.convexityRange.1', label: 'Masque crête · convexité haute', min: .01, max: 8, step: .001 },

    // Per-planet inputs and the existing polar-cap material controls.
    { group: '7 · PLANÈTE', kind: 'terrain', path: 'seaLevel', label: 'Niveau marin gameplay', min: 70, max: 145, step: 1 },
    { group: '7 · PLANÈTE', kind: 'planet', path: 'surfaceWater', label: 'Fraction d’eau', min: 0, max: .86, step: .001 },
    { group: '7 · PLANÈTE', kind: 'planet', path: 'temperature', label: 'Température de surface', min: -100, max: 120, step: .1 },
    { group: '7 · PLANÈTE', kind: 'terrain', path: 'moisture.frequency', label: 'Fréquence du masque d’humidité', min: .5, max: 12, step: .01 },
    { group: '7 · PLANÈTE', kind: 'terrain', path: 'moisture.baseline', label: 'Humidité de base', min: 0, max: 1, step: .001 },
    { group: '7 · PLANÈTE', kind: 'terrain', path: 'moisture.amplitude', label: 'Amplitude d’humidité', min: 0, max: 1, step: .001 },
    { group: '7 · PLANÈTE', kind: 'terrain', path: 'moisture.octaves', label: 'Octaves d’humidité', min: 1, max: 7, step: 1 },
    { group: '7 · PLANÈTE', kind: 'terrain', path: 'moisture.altitudeScale', label: 'Échelle de pénalité d’altitude', min: 20, max: 255, step: .1 },
    { group: '7 · PLANÈTE', kind: 'terrain', path: 'moisture.altitudePenalty', label: 'Pénalité d’humidité en altitude', min: 0, max: .8, step: .001 },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'thresholdBase', label: 'Latitude moyenne du bord polaire', min: 35, max: 88, step: .1, unit: '°' },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'temperatureReference', label: 'Température de référence polaire', min: -80, max: 80, step: .1, unit: '°' },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'temperatureScale', label: 'Réponse à la température', min: 0, max: 1.2, step: .001 },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'minimumThreshold', label: 'Latitude minimale', min: 15, max: 75, step: .1, unit: '°' },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'maximumThreshold', label: 'Latitude maximale', min: 55, max: 89, step: .1, unit: '°' },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'broadFrequency', label: 'Fréquence du contour polaire', min: .5, max: 10, step: .01 },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'secondFrequency', label: 'Fréquence secondaire polaire', min: 1, max: 16, step: .01 },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'secondWeight', label: 'Poids du bruit secondaire', min: 0, max: 1, step: .001 },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'coastFrequency', label: 'Fréquence de côte de glace', min: 1, max: 24, step: .01 },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'broadDisplacementDegrees', label: 'Déplacement large du bord', min: 0, max: 40, step: .1, unit: '°' },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'maximumBroadShiftDegrees', label: 'Limite de déplacement large', min: 0, max: 15, step: .1, unit: '°' },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'coastDisplacementDegrees', label: 'Irrégularité fine du bord', min: 0, max: 8, step: .1, unit: '°' },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'maximumCoastShiftDegrees', label: 'Limite du détail côtier', min: 0, max: 6, step: .1, unit: '°' },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'edgeHalfWidthDegrees', label: 'Douceur du bord de glace', min: .1, max: 6, step: .1, unit: '°' },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'eligibilityMarginDegrees', label: 'Marge de calcul du pôle', min: 0, max: 30, step: .1, unit: '°' },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'latitudeCoolingExponent', label: 'Courbe de refroidissement polaire', min: .5, max: 4, step: .001 },
    { group: '7 · PLANÈTE', kind: 'polar', path: 'latitudeCoolingDegrees', label: 'Refroidissement aux pôles', min: 0, max: 100, step: .1, unit: '°' },

    // Display-only controls. These do not alter terrain.elevation.
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'relief.scale', label: 'Exagération géométrique', min: .005, max: .12, step: .001, live: false },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'relief.exponent', label: 'Courbe du relief', min: .4, max: 2.5, step: .001, live: false },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'relief.linearFraction', label: 'Part linéaire', min: 0, max: 1, step: .001, live: false },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'relief.compressionStart', label: 'Début de compression des plaines', min: 0, max: .85, step: .001, live: false },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'relief.peakTailStart', label: 'Réserve des pics · sans écrêtage', min: .40, max: .90, step: .005, live: false },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'relief.landQuantile', label: 'Quantile de normalisation terrestre', min: .85, max: 1, step: .001, live: false },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'relief.minLandRange', label: 'Plage minimale de hauteur', min: 8, max: 100, step: .1, live: false },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'relief.maxLandRange', label: 'Plage maximale de hauteur', min: 15, max: 130, step: .1, live: false },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.midReliefStrength', label: 'Force de normale heightmap', min: 0, max: 3, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainFacetMix', label: 'Mélange low-poly des montagnes', min: 0, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainAoStrength', label: 'Ombre AO des massifs', min: 0, max: .4, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.ridgeAccentStrength', label: 'Accent lumineux des crêtes', min: 0, max: .6, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.facetGrid.x', label: 'Échelle de facettes · longitude', min: 35, max: 260, step: 1 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.facetGrid.y', label: 'Échelle de facettes · latitude', min: 18, max: 140, step: 1 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.macroLod', label: 'Lissage des normales de plaine', min: 2, max: 6, step: .1 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.macroStepTexels', label: 'Pas de normale des plaines', min: 2, max: 24, step: .1 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.hillLod', label: 'Lissage des normales de colline', min: 1, max: 5, step: .1 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.hillStepTexels', label: 'Pas de normale des collines', min: 2, max: 24, step: .1 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.facetLod', label: 'Lissage des faces montagneuses', min: 1, max: 6, step: .1 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.facetStepTexels', label: 'Pas des normales facettées', min: .5, max: 8, step: .1 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.structureLod', label: 'Élargissement visuel des massifs', min: 0, max: 4, step: .1 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.plainNormalStrength', label: 'Relief résiduel des plaines', min: 0, max: .5, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.hillNormalMix', label: 'Modelé des collines', min: 0, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.slopeScale', label: 'Amplification de pente', min: 0, max: 6, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.plainSlopeLow', label: 'Seuil de pente bas', min: 0, max: .5, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.plainSlopeHigh', label: 'Seuil de pente haut', min: .01, max: .8, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.hillHeightLow', label: 'Altitude de début des collines', min: 0, max: .7, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.hillHeightHigh', label: 'Altitude complète des collines', min: .01, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.mountainHeightLow', label: 'Altitude de début des montagnes', min: 0, max: .8, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.mountainHeightHigh', label: 'Altitude complète des montagnes', min: .01, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.mountainSlopeLow', label: 'Pente initiale des montagnes', min: 0, max: .8, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.mountainSlopeHigh', label: 'Pente complète des montagnes', min: .01, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.mountainMaskLow', label: 'Seuil bas du masque tectonique', min: 0, max: .8, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.mountainMaskHigh', label: 'Seuil haut du masque tectonique', min: .01, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.ruggednessLow', label: 'Rugosité initiale des montagnes', min: 0, max: .8, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.ruggednessHigh', label: 'Rugosité complète des montagnes', min: .01, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.summitHeightLow', label: 'Altitude des sommets', min: .2, max: .9, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.summitHeightHigh', label: 'Altitude complète des sommets', min: .21, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.rockExposure', label: 'Exposition rocheuse', min: 0, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.ridgeMaterialMix', label: 'Mélange couleur des crêtes', min: 0, max: .5, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.valleyMaterialMix', label: 'Mélange couleur des vallées', min: 0, max: .5, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.temperate.rock', label: 'Roche · tempérée', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.temperate.ridge', label: 'Crête · tempérée', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.temperate.crevice', label: 'Creux · tempérée', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.frozen.rock', label: 'Roche · glacée', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.frozen.ridge', label: 'Crête · glacée', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.frozen.crevice', label: 'Creux · glacée', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.arid.rock', label: 'Roche · aride', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.arid.ridge', label: 'Crête · aride', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.arid.crevice', label: 'Creux · aride', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.volcanic.rock', label: 'Roche · volcanique', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.volcanic.ridge', label: 'Crête · volcanique', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.volcanic.crevice', label: 'Creux · volcanique', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.default.rock', label: 'Roche · autres climats', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.default.ridge', label: 'Crête · autres climats', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.mountainMaterials.default.crevice', label: 'Creux · autres climats', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.shadowStrength', label: 'Contraste des faces ombrées', min: 0, max: .9, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.highlightStrength', label: 'Contraste des faces éclairées', min: 0, max: .6, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.coastBandStrength', label: 'Force du liseré côtier', min: 0, max: .9, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.lightDirection.x', label: 'Direction lumière · X', min: -1, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.lightDirection.y', label: 'Direction lumière · Y', min: -1, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.lightDirection.z', label: 'Direction lumière · Z', min: -1, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.polarNormalBlendStartDegrees', label: 'Lissage normal pôle · début', min: 85, max: 90, step: .01, unit: '°' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.polarNormalBlendEndDegrees', label: 'Lissage normal pôle · fin', min: 85, max: 90, step: .01, unit: '°' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'terrainShading.controls.polarNormalBlendStrength', label: 'Force du lissage au pôle', min: 0, max: 1, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'water.noiseAmplitude', label: 'Variation de l’eau', min: 0, max: .2, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'water.normalStrength', label: 'Normale de l’eau', min: 0, max: .2, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'water.specularStrength', label: 'Intensité spéculaire de l’eau', min: 0, max: .5, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'water.specularPower', label: 'Netteté du reflet (puissance)', min: 2, max: 96, step: 1 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'water.fresnelStrength', label: 'Fresnel de l’eau', min: 0, max: .3, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'water.fresnelPower', label: 'Courbe Fresnel', min: .5, max: 8, step: .01 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'water.shallow', label: 'Couleur des hauts-fonds', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'water.mid', label: 'Couleur de l’océan', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'water.deep', label: 'Couleur de l’océan profond', type: 'color' },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'topography.contourInterval', label: 'Intervalle des courbes', min: 2, max: 30, step: .1 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'topography.majorInterval', label: 'Intervalle des courbes majeures', min: 5, max: 120, step: .1 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'topography.contourOpacity', label: 'Opacité des courbes', min: 0, max: .8, step: .001 },
    { group: '8 · RENDU DU RELIEF', kind: 'render', path: 'topography.majorOpacity', label: 'Opacité des courbes majeures', min: 0, max: .8, step: .001 },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.hillQuantile', label: 'Début des collines visuelles', min: .35, max: .8, step: .01, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.mountainQuantile', label: 'Seuil visuel des massifs (quantile)', min: .70, max: .95, step: .01, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.summitQuantile', label: 'Seuil visuel des sommets (quantile)', min: .90, max: .995, step: .001, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.heightLowPass', label: 'Lissage du relief intermédiaire', min: .008, max: .06, step: .001, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.macroLowPass', label: 'Lissage des formes larges', min: .025, max: .16, step: .001, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.classLowPass', label: 'Lissage des limites visuelles', min: .015, max: .11, step: .001, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.normalReliefScale', label: 'Force des normales topographiques', min: .04, max: .34, step: .005, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.residualNormalStrength', label: 'Relief intermédiaire des massifs', min: 0, max: 2.2, step: .05, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.localLowPass', label: 'Lissage du relief local', min: .008, max: .025, step: .001, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.localNormalStrength', label: 'Local relief strength · massifs', min: 0, max: .30, step: .005, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.macroNormalStrength', label: 'Formes larges des plaines', min: 0, max: .35, step: .005, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.plainNormalStrength', label: 'Modelé des plaines', min: 0, max: .15, step: .005, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.plainFacetStrength', label: 'Facettes aquarellées des plaines', min: 0, max: .9, step: .01, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.plainWashStrength', label: 'Nuances aquarelle des plaines', min: 0, max: .5, step: .005, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.rollingNormalStrength', label: 'Vallonnement doux des plaines', min: 0, max: .3, step: .005, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.hillockNormalStrength', label: 'Buttes isolées · hillocks', min: 0, max: .4, step: .005, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.smallMassifStrength', label: 'Small massif strength · petits massifs', min: 0, max: 1.5, step: .025, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.smallMassifNormalStrength', label: 'Small massif normal strength · modelé', min: 0, max: .4, step: .005, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.highlandMaterialMix', label: 'Highland material mix · transition minérale', min: 0, max: 1, step: .01, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.hillNormalStrength', label: 'Modelé large des collines', min: 0, max: .6, step: .01, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.mountainNormalStrength', label: 'Relief des massifs (normale réelle)', min: .2, max: .9, step: .01, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.facetAngleDegrees', label: 'Pas angulaire des facettes', min: 3, max: 14, step: .1, live: false, unit: '°' },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.facetJitter', label: 'Variation spatiale des facettes', min: 0, max: .35, step: .01, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.facetStrength', label: 'Stylisation de la normale montagne', min: 0, max: .9, step: .01, live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.shadowStrength', label: 'Ombres projetées du terrain', min: 0, max: .5, step: .01 },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.shadowReach', label: 'Portée angulaire des ombres', min: .02, max: .15, step: .005 },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.rollingLightingContrast', label: 'Rolling lighting contrast · vallonnement', min: 0, max: 2, step: .025 },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.sphereLightCancellation', label: 'Sphere-light cancellation · montagnes', min: 0, max: .35, step: .005 },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.mountainShadowFloor', label: 'Mountain shadow floor · plancher des ombres', min: .55, max: 1, step: .005 },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.coastAaMinimum', label: 'Coast AA minimum · rivage', min: .01, max: .45, step: .005 },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.coastSmoothing', label: 'Coast smoothing · masque source', min: 0, max: 4, step: .05, live: false, unit: ' px' },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.coastFieldBlur', label: 'Coast field blur · distance', min: 0, max: 4, step: .05, live: false, unit: ' px' },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.lightDirection.x', label: 'Lumière stylisée · X', min: -1, max: 1, step: .01 },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.lightDirection.y', label: 'Lumière stylisée · Y', min: -1, max: 1, step: .01 },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.lightDirection.z', label: 'Lumière stylisée · Z', min: -1, max: 1, step: .01 },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.shallowBandWidth', label: 'Largeur de la bande turquoise', min: .25, max: 4, step: .05 },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.sandBandWidth', label: 'Largeur du liseré sable', min: .25, max: 3, step: .05 },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.materials.temperate.plain', label: 'Matériau · plaine', type: 'color', live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.materials.temperate.wet', label: 'Matériau · plaine humide', type: 'color', live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.materials.temperate.hill', label: 'Matériau · colline', type: 'color', live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.materials.temperate.rolling', label: 'Matériau · vallonnement', type: 'color', live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.materials.temperate.foothill', label: 'Matériau · pied de massif', type: 'color', live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.materials.temperate.highland', label: 'Matériau · roche intermédiaire', type: 'color', live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.materials.temperate.mountain', label: 'Matériau · montagne', type: 'color', live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.materials.temperate.ridge', label: 'Matériau · crête', type: 'color', live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.materials.temperate.crevice', label: 'Matériau · creux', type: 'color', live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.materials.temperate.snow', label: 'Matériau · neige', type: 'color', live: false },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.water.shallow', label: 'Eau stylisée · hauts-fonds', type: 'color' },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.water.mid', label: 'Eau stylisée · océan', type: 'color' },
    { group: '9 · RENDU STYLISÉ', kind: 'render', path: 'stylizedTerrain.water.deep', label: 'Eau stylisée · large', type: 'color' }
  ]);

  function pathValue(object, path) {
    return path.split('.').reduce((value, part) => value?.[part], object);
  }

  function setPath(object, path, value) {
    const parts = path.split('.');
    const leaf = parts.pop();
    const parent = parts.reduce((item, part) => item[part], object);
    parent[leaf] = value;
  }

  function randomSeed() {
    const values = new Uint32Array(2);
    if (root.crypto?.getRandomValues) root.crypto.getRandomValues(values);
    else { values[0] = Date.now() >>> 0; values[1] = Math.floor(Math.random() * 0xffffffff); }
    return `TERRAIN-${values[0].toString(36).toUpperCase()}-${values[1].toString(36).toUpperCase()}`;
  }

  function create(document, options = {}) {
    const $ = id => document.getElementById(id);
    const panel = $('terrain-tuner-panel');
    const body = $('terrain-tuner-body');
    const groupsContainer = $('terrain-tuner-groups');
    const rows = new Map();
    let preset = null, defaults = null, planetId = null, seedEdited = false, generationQueued = false;
    let queuedRebuild = 'surface';

    function rootFor(kind) {
      if (kind === 'terrain') return preset.terrainSettings;
      if (kind === 'planet') return preset.planet;
      if (kind === 'polar') return preset.renderStyle.polarCaps;
      return preset.renderStyle;
    }

    function digits(step) {
      const text = String(step);
      return text.includes('.') ? text.split('.')[1].length : 0;
    }

    function format(value, definition) {
      return String(Number(value)) + (definition.unit || '');
    }

    function setValue(definition, rawValue, snap = true) {
      const rootObject = rootFor(definition.kind);
      const current = pathValue(rootObject, definition.path);
      if (definition.type === 'color') {
        setPath(rootObject, definition.path, /^#[\da-f]{6}$/i.test(rawValue) ? rawValue.toLowerCase() : current);
        return;
      }
      const value = Number(rawValue);
      if (!Number.isFinite(value)) return;
      const clamped = Math.max(definition.min, Math.min(definition.max, value));
      const step = definition.step || 1;
      const snapped = snap ? Math.round((clamped - definition.min) / step) * step + definition.min : clamped;
      const normalized = snap ? Number(snapped.toFixed(digits(step))) : clamped;
      setPath(rootObject, definition.path, normalized);
    }

    function readValue(definition) {
      return pathValue(rootFor(definition.kind), definition.path);
    }

    function syncRow(definition) {
      const row = rows.get(definition.path);
      if (!row) return;
      const value = readValue(definition);
      if (row.range) row.range.value = String(value);
      if (row.number) row.number.value = String(value);
      if (row.output) row.output.value = format(value, definition);
      if (row.color) row.color.value = String(value);
    }

    function serialize() {
      return {
        format: 'nereide-terrain-tuning-v1',
        planetId: preset.planetId,
        planetName: preset.planetName,
        seed: preset.seed,
        seedLocked: preset.seedLocked,
        planet: clone(preset.planet),
        terrainSettings: clone(preset.terrainSettings),
        renderStyle: clone(preset.renderStyle),
        generatorNotes: { note: 'Les paramètres de bruit présents dans ce preset sont ceux réellement lus par le générateur.' }
      };
    }

    function apply(regenerate = false, source = 'manual', rebuild = 'terrain') {
      if (!preset) return;
      if (regenerate && rebuild === 'terrain' && source !== 'seed' && source !== 'reset' &&
          !preset.seedLocked && !seedEdited) {
        preset.seed = randomSeed();
        $('terrain-tuner-seed').value = preset.seed;
      }
      seedEdited = false;
      const payload = clone(preset);
      if (!regenerate) {
        options.onTerrainTuningApply?.(payload, { regenerate: false, source, rebuild: 'render' });
        return;
      }
      $('terrain-tuner-status').textContent = rebuild === 'surface'
        ? 'Actualisation du matériau de surface…' : `Régénération · seed ${preset.seed}…`;
      if (generationQueued) {
        if (rebuild === 'terrain') queuedRebuild = 'terrain';
        return;
      }
      generationQueued = true;
      queuedRebuild = rebuild;
      requestAnimationFrame(() => setTimeout(() => {
        generationQueued = false;
        const actualRebuild = queuedRebuild;
        const result = options.onTerrainTuningApply?.(clone(preset), { regenerate: true, source,
          rebuild: actualRebuild });
        $('terrain-tuner-status').textContent = result?.message ||
          `Terrain recalculé · seed ${preset.seed} · ${preset.planetName || 'planète'}`;
      }, 0));
    }

    function numericControl(definition, parent) {
      const row = document.createElement('div');
      row.className = 'terrain-tuner-row';
      const labels = document.createElement('div');
      labels.className = 'terrain-tuner-labels';
      const label = document.createElement('label');
      const id = `terrain-tuner-${rows.size}`;
      label.htmlFor = id;
      label.textContent = definition.label;
      const output = document.createElement('output');
      output.value = '';
      output.setAttribute('aria-live', 'off');
      labels.append(label, output);
      const controls = document.createElement('div');
      controls.className = 'terrain-tuner-controls';
      const range = document.createElement('input');
      range.type = 'range'; range.id = id;
      range.min = String(definition.min); range.max = String(definition.max); range.step = String(definition.step);
      range.setAttribute('aria-label', definition.label);
      const number = document.createElement('input');
      number.type = 'number'; number.min = range.min; number.max = range.max; number.step = 'any';
      number.setAttribute('aria-label', `${definition.label}, valeur numérique`);
      controls.append(range, number);
      row.append(labels, controls); parent.append(row);
      rows.set(definition.path, { range, number, output });

      range.addEventListener('input', () => {
        setValue(definition, range.value); syncRow(definition);
        if (definition.kind === 'render' && definition.live !== false) apply(false, 'render-slider');
      });
      range.addEventListener('change', () => {
        setValue(definition, range.value); syncRow(definition);
        const rebuild = definition.kind === 'terrain' || definition.kind === 'planet' ? 'terrain' : 'surface';
        apply(definition.kind !== 'render', `slider:${definition.path}`, rebuild);
      });
      number.addEventListener('input', () => {
        const value = Number(number.value);
        if (!Number.isFinite(value)) return;
        if (value < definition.min || value > definition.max) return;
        setValue(definition, value, false);
        range.value = String(value); output.value = format(value, definition);
        if (definition.kind === 'render' && definition.live !== false) apply(false, 'render-number');
      });
      number.addEventListener('change', () => {
        setValue(definition, number.value, false); syncRow(definition);
        const rebuild = definition.kind === 'terrain' || definition.kind === 'planet' ? 'terrain' : 'surface';
        apply(definition.kind !== 'render', `number:${definition.path}`, rebuild);
      });
      syncRow(definition);
    }

    function colorControl(definition, parent) {
      const row = document.createElement('div');
      row.className = 'terrain-tuner-row terrain-tuner-color-row';
      const label = document.createElement('label');
      const id = `terrain-tuner-${rows.size}`;
      label.htmlFor = id; label.textContent = definition.label;
      const color = document.createElement('input'); color.type = 'color'; color.id = id;
      color.setAttribute('aria-label', definition.label);
      row.append(label, color); parent.append(row);
      rows.set(definition.path, { color });
      color.addEventListener('input', () => {
        setValue(definition, color.value);
        if (definition.live !== false) apply(false, 'render-color');
      });
      color.addEventListener('change', () => { setValue(definition, color.value); apply(false, 'render-color'); });
      syncRow(definition);
    }

    function buildGroups() {
      rows.clear(); groupsContainer.replaceChildren();
      const groups = new Map();
      for (const definition of definitions) {
        let group = groups.get(definition.group);
        if (!group) {
          group = document.createElement('details');
          group.className = 'terrain-tuner-group';
          group.open = groups.size === 0;
          const summary = document.createElement('summary'); summary.textContent = definition.group;
          const content = document.createElement('div'); content.className = 'terrain-tuner-group-content';
          group.append(summary, content); groupsContainer.append(group); groups.set(definition.group, content);
          group = content;
        }
        if (definition.type === 'color') colorControl(definition, group);
        else numericControl(definition, group);
      }
      const note = document.createElement('p');
      note.className = 'terrain-tuner-note';
      note.textContent = 'Les anciens réglages de normale et de facettes du groupe 8 concernent le renderer v0.35.12. Le groupe 9 pilote le renderer stylisé. La géométrie est commune aux deux modes ; ces réglages visuels ne modifient pas la topographie.';
      groupsContainer.append(note);
    }

    function syncHeader() {
      $('terrain-tuner-seed').value = preset?.seed ?? '';
      $('terrain-tuner-seed-lock').checked = preset?.seedLocked !== false;
      $('terrain-tuner-context').textContent = preset
        ? `${preset.planetName || 'Planète'} · ${preset.planetId} · réglages temporaires à la session`
        : 'Choisissez une planète solide pour régler son terrain.';
      $('terrain-tuner-open-surface').hidden = Boolean(options.getTerrainTuningContext?.()?.surfaceActive);
      for (const definition of definitions) syncRow(definition);
    }

    function defaultsFor(context) {
      const planet = context.planet;
      const terrainSettings = clone(context.terrainSettings);
      if (!Number.isFinite(terrainSettings.seaLevel)) terrainSettings.seaLevel = 102;
      return {
        format: 'nereide-terrain-tuning-v1',
        planetId: planet.id,
        planetName: planet.name || planet.label || planet.id,
        seed: String(planet.seed ?? ''),
        seedLocked: true,
        planet: {
          geology: Number.isFinite(planet.geology) ? planet.geology : .5,
          surfaceWater: Number.isFinite(planet.terrainWater) ? planet.terrainWater :
            Number.isFinite(planet.surfaceWater) ? planet.surfaceWater : .4,
          temperature: Number.isFinite(planet.temperature) ? planet.temperature : 16
        },
        terrainSettings,
        renderStyle: clone(context.globeStyle)
      };
    }

    function open() {
      const context = options.getTerrainTuningContext?.();
      if (context?.planet) {
        if (!preset || preset.planetId !== context.planet.id) {
          defaults = defaultsFor(context); preset = clone(defaults); planetId = context.planet.id;
          buildGroups(); $('terrain-tuner-status').textContent = 'Prêt';
        }
        syncHeader();
      } else {
        preset = null; defaults = null; planetId = null; rows.clear(); groupsContainer.replaceChildren();
        $('terrain-tuner-context').textContent = 'Sélectionnez une planète solide dans un système pour commencer.';
        $('terrain-tuner-status').textContent = 'Aucune planète active';
        $('terrain-tuner-open-surface').hidden = true;
        $('terrain-tuner-seed').value = '';
      }
      panel.hidden = false;
    }

    $('terrain-tuner-seed').addEventListener('input', event => {
      if (!preset) return;
      preset.seed = event.target.value.slice(0, 64); seedEdited = true;
    });
    $('terrain-tuner-seed').addEventListener('change', () => apply(true, 'seed'));
    $('terrain-tuner-seed-lock').addEventListener('change', event => {
      if (preset) preset.seedLocked = event.target.checked;
    });
    $('terrain-tuner-seed-random').addEventListener('click', () => {
      if (!preset) return;
      preset.seed = randomSeed(); preset.seedLocked = true; seedEdited = true; syncHeader(); apply(true, 'seed');
    });
    $('terrain-tuner-regenerate').addEventListener('click', () => apply(true, 'manual'));
    $('terrain-tuner-reset').addEventListener('click', () => {
      if (!defaults) return;
      preset = clone(defaults); preset.seedLocked = true; syncHeader(); apply(true, 'reset');
    });
    $('terrain-tuner-collapse').addEventListener('click', () => {
      const collapsed = panel.classList.toggle('is-collapsed');
      $('terrain-tuner-collapse').textContent = collapsed ? '+' : '−';
      $('terrain-tuner-collapse').setAttribute('aria-label', collapsed ? 'Déplier le réglage terrain' : 'Replier le réglage terrain');
      body.hidden = collapsed;
    });
    $('terrain-tuner-close').addEventListener('click', () => { panel.hidden = true; });
    $('terrain-tuner-copy').addEventListener('click', async () => {
      if (!preset) return;
      const text = JSON.stringify(serialize(), null, 2);
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
          const textarea = document.createElement('textarea'); textarea.value = text;
          textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.append(textarea);
          textarea.select(); document.execCommand('copy'); textarea.remove();
        }
        $('terrain-tuner-status').textContent = 'Preset JSON copié';
      } catch (_) { $('terrain-tuner-status').textContent = 'Copie indisponible · utilisez Export JSON'; }
    });
    $('terrain-tuner-export').addEventListener('click', () => {
      if (!preset) return;
      const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `terrain-${preset.planetId}-${preset.seed}.json`; anchor.click();
      URL.revokeObjectURL(url);
      $('terrain-tuner-status').textContent = 'Preset JSON exporté';
    });
    $('terrain-tuner-open-surface').addEventListener('click', () => options.onTerrainTuningEnterSurface?.());

    return Object.freeze({ open });
  }

  root.OrbitTerrainTuner = Object.freeze({ create, definitions });
})(globalThis);
