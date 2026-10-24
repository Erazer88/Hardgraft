(function (root) {
  'use strict';
  const A = root.NereideAtlas, {clamp, lerp, noise, smoothstep} = A;
  const mix = (a, b, t) => a.map((n, i) => lerp(n, b[i], clamp(t, 0, 1)));
  const palette = {
    ocean: [6, 43, 83], deep: [7, 51, 91], shallow: [10, 62, 101], coast: [48, 183, 184],
    sand: [236, 219, 151], plain: [174, 197, 100], light: [198, 210, 123],
    warm: [170, 188, 93], dark: [147, 178, 84], forest: [78, 130, 68], ice: [217, 232, 237]
  };

  function raster(world, width, height) {
    const length = width * height, field = new Float32Array(length);
    const variation = new Float32Array(length), forest = new Float32Array(length), polar = new Float32Array(length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = x / (width - 1), v = y / (height - 1), px = u * 2 - 1, py = v * 2 - 1, i = y * width + x;
      const shore = world.landDistance(px, py), lake = world.lakeDistance(px, py);
      field[i] = Math.max(shore, -lake);
      variation[i] = noise(u * 7.4 + 7, v * 5.6 - 2, world.seed ^ 798) * .7 +
        noise(u * 16.5 - 5, v * 11.2 + 9, world.seed ^ 889) * .3;
      forest[i] = shore < -.001 && lake > 0 ? world.forestAt(px, py) : 0;
      const longitude = u * Math.PI * 2;
      polar[i] = noise(Math.cos(longitude) * 3 + 4, v * 8.7 - 6 + Math.sin(longitude) * 3, world.seed ^ 233);
    }
    return {width, height, field, variation, forest, polar};
  }
  function interpolated(array, width, height, u, v) {
    const x = clamp(u, 0, 1) * (width - 1), y = clamp(v, 0, 1) * (height - 1);
    const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy;
    const x1 = Math.min(ix + 1, width - 1), y1 = Math.min(iy + 1, height - 1);
    return lerp(lerp(array[iy * width + ix], array[iy * width + x1], dx),
      lerp(array[y1 * width + ix], array[y1 * width + x1], dx), dy);
  }
  function sprite(ctx, image, p, width, height, scale, alpha) {
    if (!image) return;
    const cosLat = Math.max(.62, Math.cos((p.y || 0) * Math.PI * .5));
    const w = p.size * width * (scale || 1) / cosLat;
    const h = w * image.height / image.width * (p.heightScale || 1), anchor = p.anchor === undefined ? .67 : p.anchor;
    ctx.save(); ctx.translate((p.x + 1) * width / 2, (p.y + 1) * height / 2);
    ctx.rotate(p.angle || 0); ctx.scale(p.mirror ? -1 : 1, 1); ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(image, -w / 2, -h * anchor, w, h); ctx.restore();
  }
  function strokeRiver(ctx, river, width, height, unit, kind) {
    const main = river.order === 'main';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 1; i < river.points.length; i++) {
      const t = i / (river.points.length - 1), taper = main ? .5 + .5 * t : .72 + .28 * t;
      let lineWidth;
      if (kind === 'bank') lineWidth = (main ? 2.1 + river.width * 1.15 : .8 + river.width * .8) * taper;
      else if (kind === 'water') lineWidth = (main ? .8 + river.width * 1.75 : .38 + river.width * 1.25) * taper;
      else lineWidth = (main ? .36 : .22) * taper;
      const a = river.points[i - 1], b = river.points[i];
      ctx.beginPath(); ctx.moveTo((a.x + 1) * width / 2, (a.y + 1) * height / 2);
      ctx.lineTo((b.x + 1) * width / 2, (b.y + 1) * height / 2);
      ctx.lineWidth = Math.max(.45 * unit, lineWidth * unit);
      ctx.strokeStyle = kind === 'bank' ? (main ? '#517d4d78' : '#567e4c42') :
        kind === 'water' ? (main ? '#2d83bc' : '#4ca2c4') : '#b7e6df83';
      ctx.stroke();
    }
  }
  function drawClouds(ctx, world, width, height, unit) {
    ctx.save(); ctx.globalCompositeOperation = 'source-over';
    for (const cloud of world.clouds) {
      ctx.save(); ctx.translate((cloud.x + 1) * width / 2, (cloud.y + 1) * height / 2); ctx.rotate(cloud.angle);
      const rx = cloud.rx * width * .52, ry = cloud.ry * height * .52;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = 'rgba(221,237,247,' + (cloud.opacity * .5) + ')';
      ctx.shadowBlur = Math.max(2 * unit, ry * .48); ctx.strokeStyle = 'rgba(213,233,245,' + (cloud.opacity * .5) + ')';
      ctx.lineWidth = Math.max(1.4 * unit, ry * .2); ctx.beginPath(); ctx.moveTo(-rx, -ry * .05);
      ctx.bezierCurveTo(-rx * .32, -ry * .66, rx * .28, ry * .52, rx, -ry * .1); ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = .55; ctx.beginPath(); ctx.moveTo(-rx * .74, ry * .22);
      ctx.bezierCurveTo(-rx * .16, ry * .02, rx * .36, ry * .5, rx * .86, ry * .12); ctx.stroke(); ctx.globalAlpha = 1;
      for (let i = 0, count = 7 + cloud.seed % 5; i < count; i++) {
        const t = i / (count - 1) * 2 - 1, jitter = ((cloud.seed >>> (i % 24)) & 15) / 15 - .5;
        const x = t * rx * .78, y = jitter * ry * .6;
        const r = .38 + ((cloud.seed >>> ((i + 7) % 24)) & 15) / 45;
        const puff = ctx.createRadialGradient(x - rx * .025, y - ry * .06, .2 * unit, x, y, Math.min(rx, ry) * r);
        puff.addColorStop(0, 'rgba(207,232,245,' + (cloud.opacity * .7) + ')');
        puff.addColorStop(.56, 'rgba(184,218,237,' + (cloud.opacity * .36) + ')');
        puff.addColorStop(1, 'rgba(188,224,243,0)');
        ctx.fillStyle = puff; ctx.beginPath(); ctx.ellipse(x, y, rx * .19 * r, ry * .36 * r, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }
  async function generatePlanetTexture(config) {
    const settings = config || {}, width = settings.width ?? 1536, height = settings.height ?? width / 2;
    if (!Number.isInteger(width) || width % 2 || width < 256 || width > 4096 || height !== width / 2) {
      throw new Error('La texture doit avoir un ratio 2:1, entre 256 et 4096 pixels de large.');
    }
    const library = await A.loadLibrary(), world = A.createWorld(settings.seed === undefined ? 0x4E455245 : settings.seed, settings);
    const gridWidth = Math.min(1024, Math.max(512, width)), grid = raster(world, gridWidth, gridWidth / 2);
    const canvas = A.surface(width, height), ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height), landMask = A.surface(width, height), oceanMask = A.surface(width, height);
    const lctx = landMask.getContext('2d'), octx = oceanMask.getContext('2d');
    const landImage = lctx.createImageData(width, height), oceanImage = octx.createImageData(width, height);
    const shoreImage = ctx.createImageData(width, height), forestImage = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const v = y / (height - 1), mapY = v * 2 - 1;
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1), i = (y * width + x) * 4;
        const d = interpolated(grid.field, grid.width, grid.height, u, v);
        const water = d > 0, variation = interpolated(grid.variation, grid.width, grid.height, u, v);
        let color, beachAlpha = 0, forestAlpha = 0;
        if (water) {
          color = mix(palette.coast, palette.shallow, smoothstep(.0005, .0027, d));
          color = mix(color, palette.deep, smoothstep(.0027, .012, d));
          color = mix(color, palette.ocean, smoothstep(.012, .04, d));
          const polar = smoothstep(.86, .99, Math.abs(mapY));
          const iceNoise = interpolated(grid.polar, grid.width, grid.height, u, v);
          const ice = polar * smoothstep(.35, .77, iceNoise);
          color = mix(color, palette.ice, ice * .95);
          const wave = Math.sin(u * Math.PI * 8 + Math.sin(v * 14) * .5) * Math.sin(v * 19) * 1.25;
          color = color.map(n => n + wave);
        } else {
          const plain = variation > .5 ? mix(palette.plain, palette.light, smoothstep(.5, .94, variation)) :
            mix(palette.dark, palette.warm, smoothstep(.08, .55, variation));
          const forest = interpolated(grid.forest, grid.width, grid.height, u, v);
          color = mix(plain, palette.forest, forest * .72);
          const beachWidth = .0048 + variation * .0055;
          color = mix(palette.sand, color, smoothstep(beachWidth * .42, beachWidth * 1.15, -d));
          beachAlpha = 1 - smoothstep(beachWidth * .42, beachWidth * 1.15, -d);
          forestAlpha = forest * .2;
        }
        image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2]; image.data[i + 3] = 255;
        const maskIndex = i + 3, edge = clamp(.5 - d / .0012, 0, 1);
        landImage.data[maskIndex] = edge * 255; oceanImage.data[maskIndex] = (1 - edge) * 255;
        shoreImage.data[i] = palette.sand[0]; shoreImage.data[i + 1] = palette.sand[1];
        shoreImage.data[i + 2] = palette.sand[2]; shoreImage.data[i + 3] = beachAlpha * 255;
        forestImage.data[i] = 30; forestImage.data[i + 1] = 79; forestImage.data[i + 2] = 39;
        forestImage.data[i + 3] = forestAlpha * 255;
      }
    }
    ctx.putImageData(image, 0, 0); lctx.putImageData(landImage, 0, 0); octx.putImageData(oceanImage, 0, 0);
    if (library.ground) {
      const groundLayer = A.surface(width, height), groundCtx = groundLayer.getContext('2d');
      groundCtx.drawImage(library.ground, 0, 0, width, height);
      groundCtx.globalCompositeOperation = 'destination-in'; groundCtx.drawImage(landMask, 0, 0);
      groundCtx.globalCompositeOperation = 'source-over'; ctx.drawImage(groundLayer, 0, 0);
    }
    const shore = A.surface(width, height), sctx = shore.getContext('2d');
    sctx.putImageData(shoreImage, 0, 0); ctx.drawImage(shore, 0, 0);
    const forests = A.surface(width, height), fctx = forests.getContext('2d');
    fctx.putImageData(forestImage, 0, 0); fctx.globalCompositeOperation = 'destination-in';
    fctx.drawImage(landMask, 0, 0); fctx.globalCompositeOperation = 'source-over'; ctx.drawImage(forests, 0, 0);
    const clouds = A.surface(width, height), cctx = clouds.getContext('2d');
    drawClouds(cctx, world, width, height, width / 1536);
    cctx.globalCompositeOperation = 'destination-in'; cctx.drawImage(oceanMask, 0, 0); cctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(clouds, 0, 0);

    const details = A.surface(width, height), dctx = details.getContext('2d');
    for (let i = 0; i < world.chains.length; i++) {
      const chain = world.chains[i];
      if (!library.mountains.length) break;
      const variant = (i + (world.seed & 1)) % library.mountains.length;
      const mountain = library.mountains[variant];
      sprite(dctx, mountain, {...chain, size: chain.size * 1.12, heightScale: 1.75, angle: chain.direction,
        anchor: .72, mirror: ((chain.variant || i) & 1) === 1}, width, height, 1, .98);
    }
    dctx.globalCompositeOperation = 'destination-in'; dctx.drawImage(landMask, 0, 0); dctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(details, 0, 0);

    const rivers = A.surface(width, height), riverCtx = rivers.getContext('2d'), unit = width / 1536;
    for (const river of world.rivers) {
      strokeRiver(riverCtx, river, width, height, unit, 'bank');
      strokeRiver(riverCtx, river, width, height, unit, 'water');
      if (river.order === 'main' && river.width > 1) strokeRiver(riverCtx, river, width, height, unit, 'glint');
    }
    riverCtx.globalCompositeOperation = 'destination-in'; riverCtx.drawImage(landMask, 0, 0); riverCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(rivers, 0, 0);

    const terrainWidth = 128, terrainHeight = 64, terrain = new Uint8Array(terrainWidth * terrainHeight);
    for (let y = 0; y < terrainHeight; y++) for (let x = 0; x < terrainWidth; x++) {
      terrain[y * terrainWidth + x] = A.classify(world, x / (terrainWidth - 1) * 2 - 1, y / (terrainHeight - 1) * 2 - 1);
    }
    return {canvas, world, terrain, terrainWidth, terrainHeight, width, height, failedAssets: library.failed};
  }
  Object.assign(A, {generatePlanetTexture, palette});
})(globalThis);
