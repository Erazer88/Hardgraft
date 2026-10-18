(function (root) {
  'use strict';

  root.OrbitPlanetGlobeStyle = Object.freeze({
    mesh: Object.freeze({ longitudeSegments: 640, latitudeSegments: 320 }),
    relief: Object.freeze({ scale: .052, exponent: 1.6 }),
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
