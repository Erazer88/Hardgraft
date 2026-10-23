(function (root) {
  'use strict';
  const A = root.NereideAtlas, {clamp, lerp, noise} = A;
  const mix = (a, b, t) => a.map((n, i) => lerp(n, b[i], clamp(t, 0, 1)));
  const palette = {ocean: [6, 43, 83], shallow: [10, 62, 101], coast: [48, 183, 184],
    sand: [236, 219, 151], plain: [174, 197, 100], light: [198, 210, 123], dark: [147, 178, 84], forest: [106, 151, 75]};
  function raster(world, width, height) {
    const length = width * height, field = new Float32Array(length), variation = new Float32Array(length), forest = new Float32Array(length), lake = new Uint8Array(length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = x / (width - 1) * 2 - 1, v = y / (height - 1) * 2 - 1, i = y * width + x;
      const land = world.landDistance(u, v), water = world.lakeDistance(u, v);
      field[i] = Math.max(land, -water); lake[i] = water < 0 ? 1 : 0;
      if (land < -.001) {
        variation[i] = noise(u * 12 + 7, v * 7 - 2, world.seed ^ 415) * .7 + noise(u * 25, v * 15, world.seed ^ 798) * .3;
        forest[i] = world.forestAt(u, v);
      }
    }
    return {width, height, field, variation, forest, lake};
  }
  function interpolated(array, width, height, u, v) {
    const x = clamp(u, 0, 1) * (width - 1), y = clamp(v, 0, 1) * (height - 1);
    const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy;
    const x1 = Math.min(ix + 1, width - 1), y1 = Math.min(iy + 1, height - 1);
    return lerp(lerp(array[iy * width + ix], array[iy * width + x1], dx), lerp(array[y1 * width + ix], array[y1 * width + x1], dx), dy);
  }
  function sprite(ctx, image, p, width, height, factor, alpha) {
    if (!image) return;
    const w = p.size * width * (factor || 1), h = w * image.height / image.width;
    ctx.save(); ctx.translate((p.x + 1) * width / 2, (p.y + 1) * height / 2);
    ctx.rotate(p.angle || 0); ctx.scale(p.mirror ? -1 : 1, 1); ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(image, -w / 2, -h * .65, w, h); ctx.restore();
  }
  function riverPath(ctx, points, width, height) {
    ctx.beginPath(); points.forEach((p, i) => {
      const x = (p.x + 1) * width / 2, y = (p.y + 1) * height / 2;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
  }
  async function generatePlanetTexture(config) {
    const settings = config || {}, width = settings.width ?? 1536, height = settings.height ?? width / 2;
    if (!Number.isInteger(width) || width % 2 || width < 256 || width > 4096 || height !== width / 2) throw new Error('La texture doit avoir un ratio 2:1, entre 256 et 4096 pixels de large.');
    const library = await A.loadLibrary(), world = A.createWorld(settings.seed === undefined ? 0x4E455245 : settings.seed, settings);
    const grid = raster(world, 512, 256), canvas = A.surface(width, height), ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height), mask = A.surface(width, height), mctx = mask.getContext('2d'), maskImage = mctx.createImageData(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = x / (width - 1), v = y / (height - 1), i = (y * width + x) * 4;
      const d = interpolated(grid.field, grid.width, grid.height, u, v);
      let color;
      if (d > 0) {
        color = mix(palette.coast, palette.shallow, d / .0027);
        color = mix(color, palette.ocean, (d - .0027) / .012);
        const wave = Math.sin(u * Math.PI * 8 + Math.sin(v * 16) * .5) * Math.sin(v * 21) * .65;
        color = color.map(n => n + wave);
      } else {
        const variation = clamp((interpolated(grid.variation, grid.width, grid.height, u, v) - .5) * 2 + .5, 0, 1);
        const forest = interpolated(grid.forest, grid.width, grid.height, u, v);
        color = variation > .5 ? mix(palette.plain, palette.light, (variation - .5) * 1.9) : mix(palette.dark, palette.plain, variation * 2);
        color = mix(color, palette.forest, forest * .47);
        color = mix(palette.sand, color, (-d - .0012) / .0042);
      }
      // An antialiased, narrow waterline; all shading belongs to the globe renderer.
      if (Math.abs(d) < .0007) color = mix(palette.sand, palette.coast, (d + .0007) / .0014);
      image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2]; image.data[i + 3] = 255;
      maskImage.data[i + 3] = clamp(-d / .0012, 0, 1) * 255;
    }
    ctx.putImageData(image, 0, 0); mctx.putImageData(maskImage, 0, 0);
    const details = A.surface(width, height), dctx = details.getContext('2d');
    dctx.lineCap = 'round'; dctx.lineJoin = 'round';
    const unit = width / 1536;
    for (const river of world.rivers) {
      if (library.valley && river.points.length > 25) {
        const p = river.points[Math.floor(river.points.length * .55)];
        sprite(dctx, library.valley, {...p, size: .045}, width, height, 1, .17);
      }
      riverPath(dctx, river.points, width, height);
      dctx.strokeStyle = '#558a4b59'; dctx.lineWidth = (6 + river.width) * unit; dctx.stroke();
      dctx.strokeStyle = '#247eae'; dctx.lineWidth = (1.7 + river.width) * unit; dctx.stroke();
      dctx.strokeStyle = '#85d5d5'; dctx.lineWidth = .65 * unit; dctx.stroke();
    }
    const decorations = [];
    for (const p of world.hills) decorations.push({p, image: library.hill[p.variant], alpha: .75});
    for (const p of world.trees) decorations.push({p, image: library.forest[p.variant], alpha: 1});
    for (const p of world.peaks) decorations.push({p, image: library.mountain[p.variant], alpha: 1});
    // Original illustrated patches supply detail; smaller reusable motifs shape their edges.
    for (let i = 0; i < world.chains.length; i++) {
      const chain = world.chains[i];
      decorations.push({p: {...chain, size: chain.size * .72, angle: chain.direction * .12}, image: library.images.mountain, alpha: .94});
    }
    for (let i = 0; i < world.forestZones.length; i += 2) {
      const zone = world.forestZones[i];
      if (world.landDistance(zone.x, zone.y) < -.055 && world.lakeDistance(zone.x, zone.y) > .04 && world.riverDistance(zone.x, zone.y) > .025)
        decorations.push({p: {...zone, size: .034, angle: 0}, image: library.images.forest, alpha: .93});
    }
    for (let i = 0; i < world.hills.length; i += 8) {
      const p = world.hills[i];
      decorations.push({p, image: library.images.hills, alpha: .55});
    }
    decorations.sort((a, b) => a.p.y - b.p.y);
    for (const item of decorations) sprite(dctx, item.image, item.p, width, height, 1, item.alpha);
    dctx.globalCompositeOperation = 'destination-in'; dctx.drawImage(mask, 0, 0); dctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(details, 0, 0);
    const terrainWidth = 128, terrainHeight = 64, terrain = new Uint8Array(terrainWidth * terrainHeight);
    for (let y = 0; y < terrainHeight; y++) for (let x = 0; x < terrainWidth; x++) terrain[y * terrainWidth + x] = A.classify(world, x / (terrainWidth - 1) * 2 - 1, y / (terrainHeight - 1) * 2 - 1);
    return {canvas, world, terrain, terrainWidth, terrainHeight, width, height, failedAssets: library.failed};
  }
  Object.assign(A, {generatePlanetTexture, palette});
})(globalThis);
