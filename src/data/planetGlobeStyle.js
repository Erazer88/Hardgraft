(function (root) {
  'use strict';

  root.OrbitPlanetGlobeStyle = Object.freeze({
    mesh: Object.freeze({ longitudeSegments: 360, latitudeSegments: 180 }),
    relief: Object.freeze({ scale: .085, exponent: 1.28 }),
    camera: Object.freeze({ minZoom: .8, maxZoom: 1.3, initialZoom: 1,
      radiusRatio: .4, rotationSensitivity: .006, maxPitch: .72, transitionMs: 320 }),
    colors: Object.freeze({
      temperate: Object.freeze({ ocean: '#3279a4', deepOcean: '#1b5277', shore: '#c9b783',
        lowland: '#5f8d43', upland: '#587642', highland: '#a68a60', dry: '#b99b69', snow: '#e8ebe4' }),
      frozen: Object.freeze({ ocean: '#3b5968', deepOcean: '#2c4656', shore: '#b5c1bf',
        lowland: '#95a9a5', upland: '#879c99', highland: '#9ea9a4', dry: '#939e9b', snow: '#e4e5df' }),
      arid: Object.freeze({ ocean: '#465b64', deepOcean: '#344a54', shore: '#b4a580',
        lowland: '#a8956e', upland: '#99876a', highland: '#928678', dry: '#b49b70', snow: '#d8d5cb' }),
      volcanic: Object.freeze({ ocean: '#394c58', deepOcean: '#2c3d47', shore: '#928275',
        lowland: '#78736a', upland: '#767166', highland: '#92877b', dry: '#826458', snow: '#d0ccc4' })
    }),
    resources: Object.freeze({ iron: '#d4a76d', copper: '#c88462', silicon: '#91b5b9',
      carbon: '#a6ad83', oil: '#8f877a' }),
    graticule: Object.freeze({ color: '#d0dddc', opacity: .19, widthPx: .75,
      longitudeStepDegrees: 30, latitudeStepDegrees: 30, sampleStepDegrees: 6 }),
    icon: Object.freeze({ sizePx: 34, hitRadiusPx: 24 })
  });
})(globalThis);
