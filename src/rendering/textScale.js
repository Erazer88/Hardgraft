(function (root) {
  'use strict';

  // Text drawn on the canvas follows the same scale as the page text: the
  // stylesheet declares it (--ta, --tb: size × ta + tb), larger on a phone held
  // upright. Read again when the window changes size or orientation. A damping
  // below 1 keeps part of the offset only, for text that should grow less.
  let factor = 1, offset = 0;
  function update() {
    try {
      const style = root.getComputedStyle(root.document.documentElement);
      factor = parseFloat(style.getPropertyValue('--ta')) || 1;
      offset = parseFloat(style.getPropertyValue('--tb')) || 0;
    } catch { factor = 1; offset = 0; }
  }
  if (root.document && root.getComputedStyle) {
    update();
    root.addEventListener?.('resize', update);
  }

  root.OrbitTextScale = Object.freeze({ px: (size, damping = 1) => size * factor + offset * damping, update });
})(globalThis);
