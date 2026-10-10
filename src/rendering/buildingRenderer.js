(function (root) {
  'use strict';

  // Rendering passes are reserved for the later planetary building blocks.
  // They receive a read-only surface frame and own no simulation state.
  function renderPhysical() {}
  function renderAnchors() {}
  function renderCards() {}

  root.OrbitBuildingRenderer = Object.freeze({ renderPhysical, renderAnchors, renderCards });
})(globalThis);
