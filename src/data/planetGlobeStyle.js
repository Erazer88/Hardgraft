(function (root) {
  'use strict';

  root.OrbitPlanetGlobeStyle = Object.freeze({
    mesh: Object.freeze({ longitudeSegments: 640, latitudeSegments: 320 }),
    relief: Object.freeze({ scale: .024, exponent: 1.9 }),
    camera: Object.freeze({ minZoom: .8, maxZoom: 1.56, initialZoom: 1,
      radiusRatio: .4, rotationSensitivity: .006, maxPitch: .72, transitionMs: 320 }),
    resources: Object.freeze({ iron: '#d4a76d', copper: '#c88462', silicon: '#91b5b9',
      carbon: '#a6ad83', oil: '#8f877a' }),
    graticule: Object.freeze({ color: '#d0dddc', opacity: .05, widthPx: .55,
      longitudeStepDegrees: 30, latitudeStepDegrees: 30, sampleStepDegrees: 6 }),
    icon: Object.freeze({ sizePx: 34, hitRadiusPx: 24 }),
    topography: Object.freeze({ contourInterval: 9, majorInterval: 36,
      contourOpacity: .055, majorOpacity: .11 })
  });
})(globalThis);
