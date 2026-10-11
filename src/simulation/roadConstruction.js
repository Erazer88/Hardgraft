(function (root) {
  'use strict';

  const Config = root.OrbitRoadConfig;

  function advance(networks, deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Road construction time must be non-negative');
    let changed = false;
    for (const network of Object.values(networks || {})) for (const segment of network.segments || []) {
      const length = Number.isFinite(segment.length) ? segment.length : 0;
      const builtLength = Number.isFinite(segment.builtLength) ? Math.max(0, segment.builtLength) : length;
      if (builtLength >= length) { segment.builtLength = length; continue; }
      const speed = Config.construction.speedByClass[segment.roadClass] || Config.construction.speedByClass.main;
      const nextLength = Math.min(length, builtLength + speed * deltaSeconds);
      if (nextLength > builtLength) changed = true;
      segment.builtLength = nextLength;
    }
    return changed;
  }

  root.OrbitRoadConstruction = Object.freeze({ advance });
})(globalThis);
