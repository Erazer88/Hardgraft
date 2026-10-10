(function (root) {
  'use strict';

  const durationSeconds = 3.5;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function advance(buildings, deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Construction time must be non-negative');
    for (const building of buildings) {
      if (building.constructionState !== 'constructing') continue;
      building.constructionProgress = clamp(building.constructionProgress + deltaSeconds / durationSeconds, 0, 1);
      if (building.constructionProgress >= 1) {
        building.constructionState = 'complete';
        building.status = 'idle';
      }
    }
  }

  root.OrbitConstruction = Object.freeze({ advance, durationSeconds });
})(globalThis);
