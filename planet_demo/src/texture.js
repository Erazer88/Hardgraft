(function (root) {
  'use strict';
  const A = root.NereideAtlas, {clamp, lerp, noise, smoothstep} = A;
  const mix = (a, b, t) => a.map((n, i) => lerp(n, b[i], clamp(t, 0, 1)));
  const palette = {
    ocean: [3, 31, 72], deep: [5, 53, 111], shallow: [8, 93, 145], coast: [34, 178, 196],
    sand: [238, 217, 145], plain: [139, 178, 84], light: [171, 198, 100],
    warm: [190, 192, 104], dark: [112, 153, 76], forest: [60, 112, 64], ice: [217, 232, 237]
  };

  function signedShore(world, width, height) {
    const length = width * height, land = new Uint8Array(length), distance = new Float32Array(length);
    const variation = new Float32Array(length), forest = new Float32Array(length), polar = new Float32Array(length);
    const horizontal = 2 / (width - 1), vertical = 1 / (height - 1);
    const diagonal = Math.hypot(horizontal, vertical), far = 1e6;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = x / (width - 1) * 2 - 1, py = y / (height - 1) * 2 - 1, i = y * width + x;
      land[i] = world.landDistance(px, py) < 0 && world.lakeDistance(px, py) > 0 ? 1 : 0;
      const u = x / (width - 1), v = y / (height - 1);
      variation[i] = noise(u * 4.6 + 7, v * 4.1 - 2, world.seed ^ 798) * .66 +
        noise(u * 10.5 - 5, v * 8.2 + 9, world.seed ^ 889) * .34;
      forest[i] = land[i] ? world.forestAt(px, py) : 0;
      polar[i] = noise(u * 6.2 + 4, v * 8.7 - 6, world.seed ^ 233);
      distance[i] = far;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, here = land[i];
      if ((x && land[i - 1] !== here) || (x + 1 < width && land[i + 1] !== here) ||
          (y && land[i - width] !== here) || (y + 1 < height && land[i + width] !== here)) distance[i] = 0;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x; let d = distance[i];
      if (x) d = Math.min(d, distance[i - 1] + horizontal);
      if (y) d = Math.min(d, distance[i - width] + vertical);
      if (x && y) d = Math.min(d, distance[i - width - 1] + diagonal);
      if (x + 1 < width && y) d = Math.min(d, distance[i - width + 1] + diagonal);
      distance[i] = d;
    }
    for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x; let d = distance[i];
      if (x + 1 < width) d = Math.min(d, distance[i + 1] + horizontal);
      if (y + 1 < height) d = Math.min(d, distance[i + width] + vertical);
      if (x + 1 < width && y + 1 < height) d = Math.min(d, distance[i + width + 1] + diagonal);
      if (x && y + 1 < height) d = Math.min(d, distance[i + width - 1] + diagonal);
      distance[i] = d;
    }
    const signed = new Float32Array(length);
    for (let i = 0; i < length; i++) signed[i] = (land[i] ? -1 : 1) * distance[i];
    return {width, height, signed, land, variation, forest, polar};
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
    const grid = signedShore(world, 768, 384), canvas = A.surface(width, height), ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height), landMask = A.surface(width, height), oceanMask = A.surface(width, height);
    const mountainMask = A.surface(width, height);
    const lctx = landMask.getContext('2d'), octx = oceanMask.getContext('2d'), mctx = mountainMask.getContext('2d');
    const landImage = lctx.createImageData(width, height), oceanImage = octx.createImageData(width, height);
    const mountainImage = mctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const v = y / (height - 1), mapY = v * 2 - 1;
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1), i = (y * width + x) * 4;
        const d = interpolated(grid.signed, grid.width, grid.height, u, v);
        const water = d > 0, variation = interpolated(grid.variation, grid.width, grid.height, u, v);
        let color;
        if (water) {
          color = mix(palette.coast, palette.shallow, smoothstep(.0005, .0026, d));
          color = mix(color, palette.deep, smoothstep(.0026, .009, d));
          color = mix(color, palette.ocean, smoothstep(.009, .035, d));
          const polar = smoothstep(.86, .99, Math.abs(mapY));
          const iceNoise = interpolated(grid.polar, grid.width, grid.height, u, v);
          const ice = polar * smoothstep(.35, .77, iceNoise);
          color = mix(color, palette.ice, ice * .95);
          const wave = Math.sin(u * Math.PI * 8 + Math.sin(v * 14) * .5) * Math.sin(v * 19) * 1.25;
          color = color.map(n => n + wave);
        } else {
          const plain = variation > .48 ? mix(palette.plain, palette.light, smoothstep(.48, .94, variation)) :
            mix(palette.dark, palette.warm, smoothstep(.08, .56, variation));
          const forest = interpolated(grid.forest, grid.width, grid.height, u, v);
          color = mix(plain, palette.forest, forest * .72);
          const beachWidth = .005 + variation * .007;
          color = mix(palette.sand, color, smoothstep(beachWidth * .45, beachWidth * 1.2, -d));
        }
        image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2]; image.data[i + 3] = 255;
        const maskIndex = i + 3, edge = clamp(.5 - d / .0012, 0, 1);
        landImage.data[maskIndex] = edge * 255; oceanImage.data[maskIndex] = (1 - edge) * 255;
        mountainImage.data[maskIndex] = clamp((-d - .004) / .01, 0, 1) * 255;
      }
    }
    ctx.putImageData(image, 0, 0); lctx.putImageData(landImage, 0, 0); octx.putImageData(oceanImage, 0, 0);
    mctx.putImageData(mountainImage, 0, 0);
    const clouds = A.surface(width, height), cctx = clouds.getContext('2d');
    drawClouds(cctx, world, width, height, width / 1536);
    cctx.globalCompositeOperation = 'destination-in'; cctx.drawImage(oceanMask, 0, 0); cctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(clouds, 0, 0);

    const details = A.surface(width, height), dctx = details.getContext('2d');
    const mountainLayer = A.surface(width, height), mountainCtx = mountainLayer.getContext('2d');
    const mountainGroups = world.chains.map(chain => ({
      p: {...chain, size: chain.size * 1.04, heightScale: 1.5, angle: chain.direction, anchor: .84}, image: library.chain, alpha: .97
    }));
    mountainGroups.sort((a, b) => a.p.y - b.p.y);
    for (const item of mountainGroups) sprite(mountainCtx, item.image, item.p, width, height, 1, item.alpha);
    for (const p of world.peaks) sprite(mountainCtx, library.mountain[p.variant], {...p, anchor: .84}, width, height, 1, p.major ? .97 : .88);
    mountainCtx.globalCompositeOperation = 'destination-in'; mountainCtx.drawImage(mountainMask, 0, 0); mountainCtx.globalCompositeOperation = 'source-over';
    dctx.drawImage(mountainLayer, 0, 0);

    const decorations = [];
    for (const zone of world.forestZones) {
      decorations.push({p: {...zone, size: zone.rx * 1.3, angle: zone.phase * .12, anchor: .72}, image: library.grove, alpha: .58});
    }
    for (const p of world.hills) decorations.push({p: {...p, heightScale: .72}, image: library.hill[p.variant], alpha: .7});
    for (const p of world.trees) decorations.push({p: {...p, heightScale: .9}, image: library.forest[p.variant], alpha: .94});
    for (let i = 0; i < world.hills.length; i += 9) {
      const p = world.hills[i];
      decorations.push({p: {...p, size: .04, heightScale: .8}, image: library.images.hills, alpha: .42});
    }
    decorations.sort((a, b) => a.p.y - b.p.y);
    for (const item of decorations) sprite(dctx, item.image, item.p, width, height, 1, item.alpha);
    dctx.globalCompositeOperation = 'destination-in'; dctx.drawImage(landMask, 0, 0); dctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(details, 0, 0);

    const rivers = A.surface(width, height), riverCtx = rivers.getContext('2d'), unit = width / 1536;
    for (const river of world.rivers) {
      if (river.order === 'main' && library.valley && river.points.length > 38) {
        const index = Math.floor(river.points.length * .54), p = river.points[index];
        const before = river.points[Math.max(0, index - 3)], after = river.points[Math.min(river.points.length - 1, index + 3)];
        const angle = Math.atan2((after.y - before.y) * .5, after.x - before.x);
        sprite(riverCtx, library.valley, {...p, size: .045, angle, anchor: .5}, width, height, 1, .065);
      }
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
