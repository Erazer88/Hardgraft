(function (root) {
  'use strict';
  const A = root.NereideAtlas;
  const sources = {mountain: 'assets/mountain.webp', forest: 'assets/forest.webp',
    hills: 'assets/hills.svg', valley: 'assets/valley.svg'};
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
    const c = surface(100, 110), ctx = c.getContext('2d'), r = A.random(variant, 'mountain-asset');
    const summit = 39 + r() * 18, top = 10 + r() * 12, foot = 92 + r() * 5;
    ctx.fillStyle = '#5e77384a'; ctx.beginPath(); ctx.ellipse(50, 95, 44, 9, -.1, 0, Math.PI * 2); ctx.fill();
    polygon(ctx, [[5, foot], [22, 57], [summit, top], [67, 49], [96, foot], [53, 102]], '#a18c56');
    polygon(ctx, [[5, foot], [22, 57], [summit, top], [39, 60], [48, 88], [20, 95]], '#d8c68a');
    polygon(ctx, [[summit, top], [67, 49], [96, foot], [65, 81], [54, 59]], '#87734e');
    polygon(ctx, [[summit, top], [39, 60], [48, 88], [57, 69], [54, 46]], '#b4a172');
    polygon(ctx, [[22, 57], [summit, top], [62, 40], [53, 36], [51, 49], [43, 39], [33, 49]], '#f5f2d9');
    polygon(ctx, [[summit, top], [62, 40], [53, 36], [51, 49], [47, 32]], '#d3dfd8');
    ctx.strokeStyle = '#e4d29a'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(30, 62); ctx.lineTo(20, 84); ctx.moveTo(58, 59); ctx.lineTo(74, 87); ctx.stroke();
    return c;
  }
  function forest(variant) {
    const c = surface(100, 90), ctx = c.getContext('2d'), r = A.random(variant, 'forest-asset');
    const trees = Array.from({length: 5 + variant % 5}, () => ({x: 15 + r() * 70, y: 30 + r() * 44, size: 17 + r() * 17})).sort((a, b) => a.y - b.y);
    for (const t of trees) {
      ctx.fillStyle = '#355f3240'; ctx.beginPath(); ctx.ellipse(t.x + 4, t.y + 6, t.size * .45, 4, -.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#625c32'; ctx.fillRect(t.x - 1, t.y - 6, 2, 10);
      polygon(ctx, [[t.x, t.y - t.size], [t.x - t.size * .42, t.y], [t.x + t.size * .4, t.y]], ['#2d633e', '#326d40', '#3e7845'][variant % 3]);
      polygon(ctx, [[t.x, t.y - t.size], [t.x - t.size * .42, t.y], [t.x - 1, t.y - 4]], '#5b914a');
      polygon(ctx, [[t.x, t.y - t.size], [t.x - 2, t.y - 6], [t.x + t.size * .4, t.y]], '#275b3c');
    }
    return c;
  }
  function hill(variant) {
    const c = surface(110, 65), ctx = c.getContext('2d'), r = A.random(variant, 'hill-asset');
    for (let i = 0; i < 3; i++) {
      const x = 25 + i * 27, y = 42 + (i % 2) * 5, size = 16 + r() * 10;
      ctx.beginPath(); ctx.moveTo(x - size, y); ctx.quadraticCurveTo(x, y - size * 1.8, x + size, y);
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
    ctx.filter = `saturate(${.88 + variant % 4 * .035})`;
    ctx.drawImage(image, ...frame, 0, 0, width, height); ctx.restore();
    // Keep the illustrated core and soften the existing patch's green boundary.
    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createRadialGradient(width * .5, height * .47, width * .19, width * .5, height * .5, width * .53);
    mask.addColorStop(0, '#fff'); mask.addColorStop(.55, '#fffffff0'); mask.addColorStop(1, '#ffffff00');
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
      const mountainFrames = [[140, 20, 210, 235], [235, 150, 230, 250], [380, 300, 250, 285], [35, 100, 240, 255], [300, 235, 230, 250], [125, 165, 230, 250]];
      const forestFrames = [[85, 55, 230, 220], [255, 45, 240, 230], [350, 150, 240, 230], [60, 160, 235, 230], [215, 160, 240, 225]];
      for (let i = 0; i < 24; i++) library.mountain.push(images.mountain ? illustratedFragment(images.mountain, mountainFrames[i % 6], i, 100, 110) : mountain(i));
      for (let i = 0; i < 20; i++) {
        library.forest.push(images.forest ? illustratedFragment(images.forest, forestFrames[i % 5], i, 100, 90) : forest(i));
        library.hill.push(hill(i));
      }
      if (images.valley) {
        const c = surface(320, 210), ctx = c.getContext('2d');
        ctx.drawImage(images.valley, 0, 0, 320, 210);
        ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#54884c'; ctx.fillRect(0, 0, 320, 210);
        library.valley = c;
      }
      return library;
    })();
    return pending;
  }
  Object.assign(A, {surface, loadLibrary});
})(globalThis);
