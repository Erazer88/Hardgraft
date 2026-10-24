(function (root) {
  'use strict';
  const A = root.NereideAtlas;
  const sources = {
    mountain: 'assets/mountain.webp', forest: 'assets/forest.webp', hills: 'assets/hills.svg',
    valley: 'assets/valley.svg'
  };
  let pending;
  function surface(width, height) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    return canvas;
  }
  function polygon(ctx, points, color) {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function mountain(variant) {
    const c = surface(120, 132), ctx = c.getContext('2d'), shift = variant % 3 * 4;
    const x = 58 + shift, y = 17 + variant % 4 * 3;
    polygon(ctx, [[8, 119], [x, y], [110, 119]], '#8a684b');
    polygon(ctx, [[8, 119], [x, y], [x + 2, 119]], '#d4b47d');
    polygon(ctx, [[x, y], [110, 119], [x + 2, 119]], '#544c43');
    polygon(ctx, [[x - 24, y + 28], [x, y], [x + 10, y + 23], [x - 1, y + 17]], '#f4f0df');
    polygon(ctx, [[x, y], [x + 10, y + 23], [x + 2, y + 19], [x - 1, y + 17]], '#c7c5b8');
    polygon(ctx, [[0, 125], [42, 105], [85, 114], [120, 126], [120, 132], [0, 132]], '#687c4d');
    return c;
  }
  function forest(variant) {
    const c = surface(108, 92), ctx = c.getContext('2d'), r = A.random(variant, 'forest-fallback');
    for (let i = 0; i < 7; i++) {
      const x = 8 + r() * 92, y = 16 + r() * 56, h = 18 + r() * 22, w = 9 + r() * 9;
      polygon(ctx, [[x, y - h], [x - w, y + 3], [x + w, y + 3]], ['#31563b', '#3d7043', '#28513c'][i % 3]);
      ctx.beginPath(); ctx.ellipse(x, y + 2, w * 1.2, 3, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#92784955'; ctx.fill();
    }
    return c;
  }
  function hill(variant) {
    const c = surface(100, 68), ctx = c.getContext('2d'), r = A.random(variant, 'hill-asset');
    for (let i = 0; i < 3; i++) {
      const x = 23 + i * 27, y = 45 + (i % 2) * 4, size = 15 + r() * 11;
      ctx.beginPath(); ctx.moveTo(x - size, y); ctx.quadraticCurveTo(x, y - size * 1.65, x + size, y);
      ctx.quadraticCurveTo(x, y + 8, x - size, y); ctx.fillStyle = ['#91a956', '#a2b965', '#819d51'][i]; ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - size * .7, y - 3); ctx.quadraticCurveTo(x - 4, y - size * 1.1, x + 3, y - size * .65);
      ctx.strokeStyle = '#d4d98b'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    return c;
  }
  function illustratedFragment(image, frame, variant, width, height) {
    const c = surface(width, height), ctx = c.getContext('2d');
    ctx.save();
    if (variant % 2) {ctx.translate(width, 0); ctx.scale(-1, 1);}
    ctx.filter = 'saturate(' + (.9 + variant % 4 * .03) + ')';
    ctx.drawImage(image, ...frame, 0, 0, width, height); ctx.restore();
    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createRadialGradient(width * .5, height * .46, width * .2, width * .5, height * .5, width * .55);
    mask.addColorStop(0, '#fff'); mask.addColorStop(.62, '#ffffffeb'); mask.addColorStop(1, '#ffffff00');
    ctx.fillStyle = mask; ctx.fillRect(0, 0, width, height); ctx.globalCompositeOperation = 'source-over';
    return c;
  }
  async function loadLibrary() {
    if (pending) return pending;
    pending = (async () => {
      const images = {}, failed = [];
      await Promise.all(Object.entries(sources).map(([name, src]) => new Promise(resolve => {
        const image = new Image();
        image.onload = () => {images[name] = image; resolve();};
        image.onerror = () => {failed.push(name); resolve();};
        image.src = src;
      })));
      const library = {images, failed, mountain: [], forest: [], hill: []};
      const mountainFrames = [[140, 20, 210, 235], [235, 150, 230, 250], [380, 300, 250, 285],
        [35, 100, 240, 255], [300, 235, 230, 250], [125, 165, 230, 250]];
      const forestFrames = [[85, 55, 230, 220], [255, 45, 240, 230], [350, 150, 240, 230],
        [60, 160, 235, 230], [215, 160, 240, 225]];
      for (let i = 0; i < 24; i++) {
        library.mountain.push(images.mountain ? illustratedFragment(images.mountain, mountainFrames[i % mountainFrames.length], i, 120, 132) : mountain(i));
      }
      for (let i = 0; i < 20; i++) {
        library.forest.push(images.forest ? illustratedFragment(images.forest, forestFrames[i % forestFrames.length], i, 108, 92) : forest(i));
        library.hill.push(hill(i));
      }
      if (images.valley) {
        const c = surface(320, 210), ctx = c.getContext('2d');
        ctx.drawImage(images.valley, 0, 0, 320, 210);
        ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#558b49'; ctx.fillRect(0, 0, 320, 210);
        library.valley = c;
      }
      return library;
    })();
    return pending;
  }
  Object.assign(A, {surface, loadLibrary});
})(globalThis);
