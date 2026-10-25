(function (root) {
  'use strict';

  const World = root.OrbitWorld, Config = root.OrbitConfig;
  const SurfaceStyle = root.OrbitSurfaceStyle;
  const TAU = Math.PI * 2;
  const RESOURCE_COLOR_SETTINGS = Object.freeze({
    iron: 'depositIronColor', copper: 'depositCopperColor', silicon: 'depositSiliconColor',
    carbon: 'depositCarbonColor', oil: 'depositOilColor'
  });
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const ease = t => t * t * (3 - 2 * t);
  const coastClock = () => root.performance?.now ? root.performance.now() : Date.now();

  function hexRGB(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function create(canvasContext, dependencies) {
    const { project, localCamera, surfaceFrame, getState, getViewport, isCameraInteracting, layers } = dependencies;
    let coastCache = null;
    let coastJob = null;
    let coastRasterBuffer = null;
    let lastCoastBuildAt = -Infinity;

    function makeCanvas(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      return canvas;
    }

    function valueNoise(x, y, seed) {
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = ease(x - x0), fy = ease(y - y0);
      const lattice = (ix, iy) => {
        let value = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ seed;
        value = Math.imul(value ^ (value >>> 13), 1274126177);
        return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
      };
      const top = lattice(x0, y0) + (lattice(x0 + 1, y0) - lattice(x0, y0)) * fx;
      const bottom = lattice(x0, y0 + 1) + (lattice(x0 + 1, y0 + 1) - lattice(x0, y0 + 1)) * fx;
      return top + (bottom - top) * fy;
    }

    function rgba(hex, alpha) {
      const [red, green, blue] = hexRGB(hex);
      return `rgba(${red},${green},${blue},${alpha})`;
    }

    function createNeonCoast(terrainData, textureWidth, textureHeight, textureScale, coastColor) {
      // Upscale a signed sea-level field with bilinear smoothing. Dividing by
      // its local gradient estimates the distance to the shore in texels, which
      // gives an antialiased land mask and a smooth coast line that follow the
      // same interpolated shoreline as the contours, not the terrain cells.
      const { width, height, elevation, seaLevel } = terrainData;
      const field = makeCanvas(width + 1, height + 1), fieldContext = field.getContext('2d');
      const fieldImage = fieldContext.createImageData(width + 1, height + 1);
      for (let y = 0; y <= height; y += 1) for (let x = 0; x <= width; x += 1) {
        const value = elevation[Math.min(y, height - 1) * width + Math.min(x, width - 1)];
        const pixel = (y * (width + 1) + x) * 4;
        const signed = clamp(Math.round(128 + (value - seaLevel - .5) * 2), 0, 255);
        fieldImage.data[pixel] = fieldImage.data[pixel + 1] = fieldImage.data[pixel + 2] = signed;
        fieldImage.data[pixel + 3] = 255;
      }
      fieldContext.putImageData(fieldImage, 0, 0);
      const mask = makeCanvas(textureWidth, textureHeight);
      const maskContext = mask.getContext('2d', { willReadFrequently: true });
      maskContext.imageSmoothingEnabled = true;
      // Cell corners sit on world multiples of textureScale, as in the contours.
      maskContext.drawImage(field, -textureScale / 2, -textureScale / 2,
        (width + 1) * textureScale, (height + 1) * textureScale);
      field.width = 0; field.height = 0;
      const image = maskContext.getImageData(0, 0, textureWidth, textureHeight), pixels = image.data;
      const signedField = new Float32Array(textureWidth * textureHeight);
      for (let i = 0; i < signedField.length; i += 1) signedField[i] = pixels[i * 4] - 127.5;
      const edge = makeCanvas(textureWidth, textureHeight), edgeContext = edge.getContext('2d');
      const edgeImage = edgeContext.createImageData(textureWidth, textureHeight), edgePixels = edgeImage.data;
      const [red, green, blue] = hexRGB(coastColor);
      for (let y = 0; y < textureHeight; y += 1) for (let x = 0; x < textureWidth; x += 1) {
        const index = y * textureWidth + x, value = signedField[index];
        const left = signedField[index - (x > 0 ? 1 : 0)], right = signedField[index + (x + 1 < textureWidth ? 1 : 0)];
        const up = signedField[index - (y > 0 ? textureWidth : 0)];
        const down = signedField[index + (y + 1 < textureHeight ? textureWidth : 0)];
        const gradient = Math.max(.25, Math.hypot(right - left, down - up) * .5);
        const distance = value / gradient, pixel = index * 4;
        pixels[pixel] = pixels[pixel + 1] = pixels[pixel + 2] = 255;
        pixels[pixel + 3] = Math.round(clamp(distance + .5, 0, 1) * 255);
        // A line about two texels wide straddles the shore: the only part that emits light.
        const line = clamp(1.25 - Math.abs(distance), 0, 1);
        if (line <= 0) continue;
        edgePixels[pixel] = red; edgePixels[pixel + 1] = green; edgePixels[pixel + 2] = blue;
        edgePixels[pixel + 3] = Math.round(line * 235);
      }
      maskContext.putImageData(image, 0, 0);
      edgeContext.putImageData(edgeImage, 0, 0);
      return { mask, edge };
    }

    function createNeonPigment(planet, terrainData, color) {
      // Low-amplitude pigment variation breaks the single-color sticker look
      // while keeping the land flat.
      const { width, height } = terrainData;
      const pigment = makeCanvas(width, height), pigmentContext = pigment.getContext('2d');
      const image = pigmentContext.createImageData(width, height), pixels = image.data;
      const [red, green, blue] = hexRGB(color);
      const [macroScale, mesoScale, fineScale, grainScale] = SurfaceStyle.neon.pigmentFrequencies;
      const seed = World.hashSeed(String(planet.seed) + ':neon-pigment:v1');
      for (let y = 0; y < height; y += 1) {
        const v = y / height;
        for (let x = 0; x < width; x += 1) {
          const u = x / height;
          const macro = valueNoise(u * macroScale + 2.1, v * macroScale - 6.4, seed) - .5;
          const meso = valueNoise(u * mesoScale - 9.2, v * mesoScale + 3.7, seed ^ 0x9e3779b9) - .5;
          const fine = valueNoise(u * fineScale + 12.8, v * fineScale - 1.5, seed ^ 0x243f6a88) - .5;
          const grain = valueNoise(u * grainScale - 4.3, v * grainScale + 8.2, seed ^ 0xbb67ae85) - .5;
          const pixel = (y * width + x) * 4;
          pixels[pixel] = clamp(Math.round(red * (1 + macro * .32 + meso * .16 + fine * .07)), 0, 255);
          pixels[pixel + 1] = clamp(Math.round(green * (1 + macro * .27 + meso * .14 + fine * .06 - grain * .06)), 0, 255);
          pixels[pixel + 2] = clamp(Math.round(blue * (1 + macro * .32 + meso * .16 + fine * .07 + grain * .08)), 0, 255);
          pixels[pixel + 3] = 255;
        }
      }
      pigmentContext.putImageData(image, 0, 0);
      return pigment;
    }

    function drawNeonOcean(context, width, height, color) {
      const style = SurfaceStyle.neon;
      const base = hexRGB(color);
      const shade = amount => `rgb(${base.map(channel => clamp(Math.round(channel * amount), 0, 255)).join(',')})`;
      const gradient = context.createLinearGradient(0, 0, width * .2, height);
      gradient.addColorStop(0, shade(1.13));
      gradient.addColorStop(.52, color);
      gradient.addColorStop(1, shade(.78));
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      // The chart grid stays under the land and on world multiples of the
      // surface grid step, so the screen-space grid overlay lines up with it.
      context.lineWidth = style.oceanGridLineWidth;
      const step = style.oceanGridStepWorld;
      for (const major of [false, true]) {
        context.strokeStyle = major ? style.oceanGridMajorColor : style.oceanGridMinorColor;
        context.beginPath();
        for (let column = 1; column * step < width; column += 1) {
          if ((column % style.oceanGridMajorEvery === 0) !== major) continue;
          context.moveTo(column * step, 0); context.lineTo(column * step, height);
        }
        for (let row = 1; row * step < height; row += 1) {
          if ((row % style.oceanGridMajorEvery === 0) !== major) continue;
          context.moveTo(0, row * step); context.lineTo(width, row * step);
        }
        context.stroke();
      }
    }

    function createTerrainTexture(planet, terrainData, options = {}) {
      const style = SurfaceStyle.neon;
      const textureScale = options.textureScale || Config.terrain.textureScale;
      const textureWidth = terrainData.width * textureScale, textureHeight = terrainData.height * textureScale;
      const terrainTexture = makeCanvas(textureWidth, textureHeight);
      terrainTexture.logicalWidth = options.logicalWidth || textureWidth;
      terrainTexture.logicalHeight = options.logicalHeight || textureHeight;
      terrainTexture.materialMasks = null;
      const context = terrainTexture.getContext('2d');
      const glow = style.glow, blurScale = textureWidth / style.glowReferenceWidthPx;
      const { mask, edge } = createNeonCoast(terrainData, textureWidth, textureHeight, textureScale, style.coastColor);
      drawNeonOcean(context, textureWidth, textureHeight, style.oceanColor);

      // A single union mask means only the actual coastline emits light.
      const layer = makeCanvas(textureWidth, textureHeight), layerContext = layer.getContext('2d');
      layerContext.fillStyle = style.coastColor;
      layerContext.fillRect(0, 0, textureWidth, textureHeight);
      layerContext.globalCompositeOperation = 'destination-in';
      layerContext.drawImage(mask, 0, 0);
      context.save();
      context.globalCompositeOperation = 'screen';
      context.globalAlpha = .14 + glow * .44;
      context.shadowColor = rgba(style.coastColor, .92);
      context.shadowBlur = (2 + glow * 13) * blurScale;
      context.drawImage(layer, 0, 0);
      context.restore();

      const pigment = createNeonPigment(planet, terrainData, style.landColor);
      layerContext.globalCompositeOperation = 'copy';
      layerContext.imageSmoothingEnabled = true;
      layerContext.drawImage(pigment, 0, 0, textureWidth, textureHeight);
      layerContext.globalCompositeOperation = 'destination-in';
      layerContext.drawImage(mask, 0, 0);
      context.drawImage(layer, 0, 0);

      context.save();
      context.globalCompositeOperation = 'screen';
      context.globalAlpha = .54 + glow * .34;
      context.shadowColor = rgba(style.coastColor, .95);
      context.shadowBlur = (1.5 + glow * 5.5) * blurScale;
      context.drawImage(edge, 0, 0);
      context.restore();
      context.save();
      context.globalAlpha = .62 + glow * .30;
      context.drawImage(edge, 0, 0);
      context.restore();
      for (const canvas of [mask, edge, layer, pigment]) { canvas.width = 0; canvas.height = 0; }
      return terrainTexture;
    }

    // The baked texture shows the coast at map scale. On the active surface,
    // the shoreline is also traced as vectors for the visible area, a few
    // milliseconds at a time, then rasterized at screen resolution.
    function sameCoastRequest(first, second) {
      return first && second && first.kind === second.kind && first.planetId === second.planetId &&
        first.terrain === second.terrain && first.minX === second.minX && first.maxX === second.maxX &&
        first.minY === second.minY && first.maxY === second.maxY && first.zoom === second.zoom &&
        first.pixelRatio === second.pixelRatio &&
        (first.kind !== 'raster' || (first.cache === second.cache &&
          first.rasterBounds?.x === second.rasterBounds?.x && first.rasterBounds?.y === second.rasterBounds?.y &&
          first.rasterBounds?.width === second.rasterBounds?.width && first.rasterBounds?.height === second.rasterBounds?.height));
    }

    function stopCoastJob() {
      if (!coastJob) return;
      if (coastJob.timer) root.clearTimeout(coastJob.timer);
      if (coastJob.raster) coastRasterBuffer = coastJob.raster.canvas;
      coastJob = null;
    }

    function queueCoastJob(job, delay = 0) {
      job.timer = root.setTimeout(() => processCoastJob(job), delay);
    }

    function traceCoastCell(job, x, y) {
      // Marching squares on the shore level, halfway between the last water
      // cell and the first land cell, like the baked land mask.
      const { width, elevation, seaLevel } = job.terrain;
      const level = seaLevel + .5, cellSize = Config.terrain.textureScale, path = job.cache.path;
      const index = y * width + x;
      const a = elevation[index], b = elevation[index + 1];
      const d = elevation[index + width], e = elevation[index + width + 1];
      const mask = (a < level ? 1 : 0) | (b < level ? 2 : 0) | (e < level ? 4 : 0) | (d < level ? 8 : 0);
      if (mask === 0 || mask === 15) return;
      let hasFirst = false, firstX = 0, firstY = 0;
      const crossing = (px, py) => {
        if (hasFirst) {
          path.moveTo(firstX * cellSize, firstY * cellSize); path.lineTo(px * cellSize, py * cellSize);
          hasFirst = false;
        } else { firstX = px; firstY = py; hasFirst = true; }
      };
      if ((a < level) !== (b < level)) crossing(x + (level - a) / (b - a), y);
      if ((b < level) !== (e < level)) crossing(x + 1, y + (level - b) / (e - b));
      if ((e < level) !== (d < level)) crossing(x + 1 - (level - e) / (d - e), y + 1);
      if ((d < level) !== (a < level)) crossing(x, y + 1 - (level - d) / (a - d));
    }

    function rasterizeCoast(job) {
      const cache = job.cache, cellSize = Config.terrain.textureScale;
      const padding = 2 / job.zoom;
      const bounds = job.rasterBounds || {
        x: cache.minX * cellSize - padding,
        y: cache.minY * cellSize - padding,
        width: (cache.maxX - cache.minX + 1) * cellSize + padding * 2,
        height: (cache.maxY - cache.minY + 1) * cellSize + padding * 2
      };
      const rasterWidth = Math.max(1, Math.ceil(bounds.width * job.zoom * job.pixelRatio));
      const rasterHeight = Math.max(1, Math.ceil(bounds.height * job.zoom * job.pixelRatio));
      const canvas = coastRasterBuffer || makeCanvas(rasterWidth, rasterHeight);
      coastRasterBuffer = null;
      if (canvas.width !== rasterWidth) canvas.width = rasterWidth;
      if (canvas.height !== rasterHeight) canvas.height = rasterHeight;
      const context = canvas.getContext('2d'), scale = job.zoom * job.pixelRatio;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, rasterWidth, rasterHeight);
      context.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
      context.lineCap = 'round'; context.lineJoin = 'round';
      // A soft glow stroke under a crisp line. Shadow blur is in device pixels,
      // independent of the world transform. The line thickens slightly with
      // zoom to cover the texel steps of the magnified base texture.
      const style = SurfaceStyle.neon;
      const lineWidth = style.coastLineWidthPx * clamp(job.zoom, 1, style.coastLineMaxZoomScale) / job.zoom;
      context.save();
      context.lineWidth = lineWidth;
      context.strokeStyle = rgba(style.coastColor, style.coastGlowOpacity);
      context.shadowColor = rgba(style.coastColor, .95);
      context.shadowBlur = style.coastGlowBlurPx * job.pixelRatio;
      context.stroke(cache.path);
      context.restore();
      context.lineWidth = lineWidth;
      context.strokeStyle = style.coastColor;
      context.stroke(cache.path);
      job.raster = { canvas, ...bounds, zoom: job.zoom, pixelRatio: job.pixelRatio };
    }

    function processCoastJob(job) {
      if (coastJob !== job) return;
      job.timer = null;
      if (getState().level !== 'surface') {
        coastCache = null;
        stopCoastJob();
        return;
      }
      if (job.phase === 'trace') {
        // The coast keeps rebuilding during a pinch, but each task yields
        // quickly so pointer handling and the rest of the frame stay responsive.
        const interacting = isCameraInteracting && isCameraInteracting();
        const stopAt = coastClock() + (interacting ? .8 : 3);
        const maxX = Math.min(job.maxX, job.terrain.width - 2);
        const maxY = Math.min(job.maxY, job.terrain.height - 2);
        while (job.y <= maxY && coastClock() < stopAt) {
          traceCoastCell(job, job.x, job.y);
          job.x += 1;
          if (job.x > maxX) { job.x = job.minX; job.y += 1; }
        }
        if (job.y <= maxY) { queueCoastJob(job); return; }
        job.phase = 'rasterize';
        queueCoastJob(job);
        return;
      }
      rasterizeCoast(job);
      const previousRaster = job.kind === 'trace' ? coastCache?.raster : job.cache.raster;
      if (job.kind === 'trace') coastCache = job.cache;
      if (coastCache === job.cache) {
        job.cache.raster = job.raster;
        if (previousRaster && previousRaster !== job.raster) coastRasterBuffer = previousRaster.canvas;
      }
      lastCoastBuildAt = coastClock();
      coastJob = null;
    }

    function scheduleCoastTrace(request) {
      const candidate = { ...request, kind: 'trace' };
      if (sameCoastRequest(coastJob, candidate)) return;
      const activeTrace = coastJob?.kind === 'trace' && coastJob.planetId === candidate.planetId &&
        coastJob.terrain === candidate.terrain ? coastJob : null;
      const overlapsActiveTrace = activeTrace && candidate.minX <= activeTrace.maxX &&
        candidate.maxX >= activeTrace.minX && candidate.minY <= activeTrace.maxY && candidate.maxY >= activeTrace.minY;
      if (overlapsActiveTrace || (activeTrace && isCameraInteracting && isCameraInteracting())) return;
      stopCoastJob();
      candidate.cache = { planetId: request.planetId, terrain: request.terrain, minX: request.minX,
        maxX: request.maxX, minY: request.minY, maxY: request.maxY,
        path: new root.Path2D(), raster: null };
      candidate.x = candidate.minX; candidate.y = candidate.minY; candidate.phase = 'trace';
      coastJob = candidate;
      lastCoastBuildAt = coastClock();
      queueCoastJob(candidate);
    }

    function scheduleCoastRaster(cache, zoom, pixelRatio, rasterBounds) {
      const candidate = { kind: 'raster', planetId: cache.planetId, terrain: cache.terrain,
        minX: cache.minX, maxX: cache.maxX, minY: cache.minY, maxY: cache.maxY,
        cache, zoom, pixelRatio, rasterBounds, phase: 'rasterize' };
      if (sameCoastRequest(coastJob, candidate)) return;
      // Finish an in-flight trace first; it will replace this cache.
      if (coastJob?.kind === 'trace') return;
      if (coastJob?.kind === 'raster' && coastJob.cache === cache) return;
      stopCoastJob();
      coastJob = candidate;
      lastCoastBuildAt = coastClock();
      queueCoastJob(candidate);
    }

    function drawCoastline(frame) {
      if (typeof root.Path2D !== 'function') return;
      const terrain = frame.terrain, { width, height } = terrain;
      const viewport = frame.viewport, top = frame.project(0, 0);
      const cellSize = Config.terrain.textureScale;
      const visibleMinX = clamp(Math.floor((-top.x / frame.zoom) / cellSize), 0, width - 2);
      const visibleMaxX = clamp(Math.ceil(((viewport.width - top.x) / frame.zoom) / cellSize), 0, width - 2);
      const visibleMinY = clamp(Math.floor((-top.y / frame.zoom) / cellSize), 0, height - 2);
      const visibleMaxY = clamp(Math.ceil(((viewport.height - top.y) / frame.zoom) / cellSize), 0, height - 2);
      // Keep untraced terrain around the view so ordinary pans reuse this cache.
      const marginX = Math.max(2, Math.ceil((visibleMaxX - visibleMinX + 1) * .12));
      const marginY = Math.max(2, Math.ceil((visibleMaxY - visibleMinY + 1) * .12));
      const minX = clamp(visibleMinX - marginX, 0, width - 2), maxX = clamp(visibleMaxX + marginX, minX, width - 2);
      const minY = clamp(visibleMinY - marginY, 0, height - 2), maxY = clamp(visibleMaxY + marginY, minY, height - 2);
      const coversViewport = coastCache?.planetId === frame.planet.id && coastCache.terrain === terrain &&
        visibleMinX >= coastCache.minX && visibleMaxX <= coastCache.maxX + 1 &&
        visibleMinY >= coastCache.minY && visibleMaxY <= coastCache.maxY + 1;
      const pixelRatio = canvasContext.canvas.width / viewport.width;
      const canRefreshDuringGesture = !(isCameraInteracting && isCameraInteracting()) ||
        coastClock() - lastCoastBuildAt >= 150;
      if (!coversViewport && canRefreshDuringGesture) {
        scheduleCoastTrace({ planetId: frame.planet.id, terrain, minX, maxX, minY, maxY,
          zoom: frame.zoom, pixelRatio });
      }
      if (!coastCache || coastCache.planetId !== frame.planet.id ||
          coastCache.terrain !== terrain || !coastCache.raster) return;
      const raster = coastCache.raster;
      const viewWorldWidth = viewport.width / frame.zoom, viewWorldHeight = viewport.height / frame.zoom;
      // Rasterize a viewport-sized window with a small pan buffer, not the whole
      // planet cache; this keeps pinch refreshes sharp without huge canvases.
      const panBufferX = viewWorldWidth * .12, panBufferY = viewWorldHeight * .12;
      const rasterBounds = {
        x: -top.x / frame.zoom - panBufferX,
        y: -top.y / frame.zoom - panBufferY,
        width: viewWorldWidth + panBufferX * 2,
        height: viewWorldHeight + panBufferY * 2
      };
      const rasterNeedsRefresh = raster.pixelRatio !== pixelRatio ||
        Math.abs(Math.log(frame.zoom / raster.zoom)) > .08 ||
        Math.abs((raster.x + raster.width / 2) - (rasterBounds.x + rasterBounds.width / 2)) > rasterBounds.width * .08 ||
        Math.abs((raster.y + raster.height / 2) - (rasterBounds.y + rasterBounds.height / 2)) > rasterBounds.height * .08;
      if (coversViewport && rasterNeedsRefresh && canRefreshDuringGesture && coastJob?.kind !== 'trace') {
        scheduleCoastRaster(coastCache, frame.zoom, pixelRatio, rasterBounds);
      }
      canvasContext.save();
      canvasContext.translate(top.x, top.y);
      canvasContext.scale(frame.zoom, frame.zoom);
      canvasContext.drawImage(raster.canvas, raster.x, raster.y, raster.width, raster.height);
      canvasContext.restore();
    }

    function drawSurfaceGrid(cam) {
      const style = SurfaceStyle.grid, viewport = getViewport();
      const worldStep = style.worldStep;
      let step = worldStep * cam.zoom, scaleStep = worldStep;
      while (step < style.minSpacingPx) { step *= 2; scaleStep *= 2; }
      while (step > style.maxSpacingPx) { step /= 2; scaleStep /= 2; }
      const origin = project(0, 0, cam);
      canvasContext.lineWidth = style.lineWidthPx; canvasContext.strokeStyle = style.lineColor;
      const x0 = ((origin.x % step) + step) % step, y0 = ((origin.y % step) + step) % step;
      canvasContext.beginPath();
      for (let x = x0; x < viewport.width; x += step) { canvasContext.moveTo(Math.round(x) + .5, 0); canvasContext.lineTo(Math.round(x) + .5, viewport.height); }
      for (let y = y0; y < viewport.height; y += step) { canvasContext.moveTo(0, Math.round(y) + .5); canvasContext.lineTo(viewport.width, Math.round(y) + .5); }
      canvasContext.stroke();
      if (step > style.tickSpacingThresholdPx) {
        for (let x = x0; x < viewport.width; x += step) for (let y = y0; y < viewport.height; y += step) {
          dependencies.drawLine(canvasContext, [{ x: x - style.tickHalfLengthPx, y }, { x: x + style.tickHalfLengthPx, y }], style.tickColor);
          dependencies.drawLine(canvasContext, [{ x, y: y - style.tickHalfLengthPx }, { x, y: y + style.tickHalfLengthPx }], style.tickColor);
        }
      }
      for (let x = x0; x < viewport.width; x += step) dependencies.drawLabel(canvasContext,
        String(Math.round((x - origin.x) / cam.zoom / scaleStep)),
        x + style.labelOffsetXPx, viewport.height - style.labelOffsetBottomPx, style.labelColor, style.labelSizePx);
    }

    function makeSurfaceFrame(cam, planet, record) {
      return {
        context: canvasContext,
        camera: cam,
        zoom: cam.zoom,
        planet,
        terrain: record.data,
        terrainTexture: record.texture,
        terrainWidth: record.texture.logicalWidth || record.texture.width,
        terrainHeight: record.texture.logicalHeight || record.texture.height,
        state: getState(),
        viewport: getViewport(),
        now: dependencies.getNow(),
        project: (x, y) => project(x, y, cam)
      };
    }

    function drawTerrain(frame, drawCoast = true) {
      const { terrainTexture, terrainWidth, terrainHeight } = frame, top = frame.project(0, 0);
      canvasContext.imageSmoothingEnabled = true;
      canvasContext.drawImage(terrainTexture, top.x, top.y, terrainWidth * frame.zoom, terrainHeight * frame.zoom);
      if (frame.zoom > SurfaceStyle.lod.surfaceGridZoom) drawSurfaceGrid(frame.camera);
      if (drawCoast) drawCoastline(frame);
      else if (getState().level !== 'surface') { coastCache = null; stopCoastJob(); }
      const bottom = frame.project(terrainWidth, terrainHeight);
      canvasContext.strokeStyle = SurfaceStyle.terrain.edgeColor;
      canvasContext.lineWidth = SurfaceStyle.terrain.edgeWidthPx;
      canvasContext.strokeRect(top.x, top.y, bottom.x - top.x, bottom.y - top.y);
    }

    function resourceMarkerWorldRadius(resource, marker = SurfaceStyle.resources) {
      const configured = Number(root.OrbitDeveloperSettings?.get('depositMarkerSizePercent'));
      const sizePercent = Number.isFinite(configured) ? clamp(configured, 25, 200) : 100;
      return (resource.radius || 10) * Config.terrain.textureScale * marker.markerRadiusWorldScale * sizePercent / 100;
    }

    function resourceMarkerRadius(resource, frame, marker = SurfaceStyle.resources) {
      return resourceMarkerWorldRadius(resource, marker) * frame.zoom;
    }

    function resourceDepositStyle(resource, marker = SurfaceStyle.resources) {
      const base = marker.deposits[resource.id] || marker.deposits.iron;
      const setting = RESOURCE_COLOR_SETTINGS[resource.id];
      const color = setting && root.OrbitDeveloperSettings?.get(setting);
      if (!color || color === base.hatch.slice(0, 7)) return base;
      return { fill: `${color}30`, hatch: `${color}f2`, outline: color, glow: color, label: color };
    }

    function getResourceRenderStyle(resourceId, resourceRadius = 10, zoom = 1) {
      const resource = { id: resourceId, radius: resourceRadius };
      const radiusWorldKm = resourceMarkerWorldRadius(resource);
      return { radiusWorldKm, radiusPx: radiusWorldKm * zoom,
        hatchColor: resourceDepositStyle(resource).hatch };
    }

    function traceResourceBoundary(context, center, radius, resource, marker) {
      const seed = World.hashSeed(`${resource.id}:${resource.x}:${resource.y}`) / 4294967296;
      const phase = seed * TAU, rotation = marker.ellipseAngleRadians;
      const points = [];
      for (let i = 0; i < 24; i += 1) {
        const angle = phase + i / 24 * TAU;
        const variation = 1 + Math.sin(angle * 3 + phase) * .1 + Math.cos(angle * 5 - phase) * .045 +
          Math.sin(angle * 7 + phase * .7) * .025;
        const x = Math.cos(angle) * radius * marker.ellipseXRatio * variation;
        const y = Math.sin(angle) * radius * marker.ellipseYRatio * variation;
        points.push({ x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation),
          y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) });
      }
      const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const start = midpoint(points.at(-1), points[0]);
      context.beginPath();
      context.moveTo(start.x, start.y);
      for (let i = 0; i < points.length; i += 1) {
        const next = midpoint(points[i], points[(i + 1) % points.length]);
        context.quadraticCurveTo(points[i].x, points[i].y, next.x, next.y);
      }
      context.closePath();
    }

    function drawGeologicalOverlays(frame) {
      const marker = SurfaceStyle.resources;
      for (const resource of frame.terrain.resources) {
        const p = frame.project(resource.x * Config.terrain.textureScale, resource.y * Config.terrain.textureScale);
        const radius = resourceMarkerRadius(resource, frame, marker);
        const style = resourceDepositStyle(resource, marker);
        if (p.x < 0 || p.y < 0 || p.x > frame.viewport.width || p.y > frame.viewport.height) continue;
        canvasContext.save();
        traceResourceBoundary(canvasContext, p, radius, resource, marker);
        canvasContext.fillStyle = style.fill;
        canvasContext.fill();
        canvasContext.clip();
        canvasContext.beginPath();
        for (let i = -radius * 2; i < radius * 2; i += marker.hatchSpacingPx) {
          canvasContext.moveTo(p.x + i - radius, p.y + radius);
          canvasContext.lineTo(p.x + i + radius, p.y - radius);
        }
        canvasContext.strokeStyle = style.hatch;
        canvasContext.lineWidth = marker.hatchWidthPx;
        canvasContext.setLineDash([]);
        canvasContext.stroke();
        canvasContext.restore();
        canvasContext.save();
        traceResourceBoundary(canvasContext, p, radius, resource, marker);
        canvasContext.strokeStyle = style.outline;
        canvasContext.lineWidth = marker.outlineWidthPx;
        canvasContext.setLineDash(marker.outlineDashPx);
        canvasContext.shadowColor = style.glow;
        canvasContext.shadowBlur = marker.glowBlurPx;
        canvasContext.stroke();
        canvasContext.restore();
      }
    }

    function drawSelection(frame) {
      if (frame.zoom < SurfaceStyle.lod.terrainDetailsZoom) return;
      if (frame.state.selected?.surfacePoint) {
        const p = frame.project(frame.state.selected.x, frame.state.selected.y), mark = SurfaceStyle.selection;
        dependencies.drawCircle(canvasContext, p.x, p.y, mark.radiusPx, mark.color, mark.outlineWidthPx);
        dependencies.drawLine(canvasContext, [{ x: p.x - mark.tickOuterRadiusPx, y: p.y }, { x: p.x - mark.tickInnerRadiusPx, y: p.y }], mark.color, mark.tickWidthPx);
        dependencies.drawLine(canvasContext, [{ x: p.x + mark.tickInnerRadiusPx, y: p.y }, { x: p.x + mark.tickOuterRadiusPx, y: p.y }], mark.color, mark.tickWidthPx);
        dependencies.drawLine(canvasContext, [{ x: p.x, y: p.y - mark.tickOuterRadiusPx }, { x: p.x, y: p.y - mark.tickInnerRadiusPx }], mark.color, mark.tickWidthPx);
        dependencies.drawLine(canvasContext, [{ x: p.x, y: p.y + mark.tickInnerRadiusPx }, { x: p.x, y: p.y + mark.tickOuterRadiusPx }], mark.color, mark.tickWidthPx);
      }
    }

    function drawLabels(frame) {
      if (frame.zoom < SurfaceStyle.lod.terrainDetailsZoom) return;
      if (frame.zoom > SurfaceStyle.lod.resourceLabelZoom) {
        const marker = SurfaceStyle.resources;
        for (const resource of frame.terrain.resources) {
          const p = frame.project(resource.x * Config.terrain.textureScale, resource.y * Config.terrain.textureScale);
          if (p.x < 0 || p.y < 0 || p.x > frame.viewport.width || p.y > frame.viewport.height) continue;
          const radius = resourceMarkerRadius(resource, frame, marker);
          dependencies.drawLabel(canvasContext, resource.type.toUpperCase(),
            p.x + radius * marker.ellipseXRatio + marker.labelOffsetXPx, p.y,
            resourceDepositStyle(resource, marker).label,
            marker.labelSizePx);
        }
      }
      const top = frame.project(0, 0), bottom = frame.project(frame.terrainWidth, frame.terrainHeight);
      dependencies.drawLabel(canvasContext, frame.planet.name.toUpperCase() + ' / CARTOGRAPHIE',
        top.x + 15, bottom.y - 16, '#c3c9b1', SurfaceStyle.labels.siteDetailSizePx);
    }

    function drawSurface(cam, planet, record, planetPreview = false) {
      const frame = makeSurfaceFrame(cam, planet, record);
      const developerSettings = root.OrbitDeveloperSettings;
      frame.showSurfaceRoads = developerSettings?.get('showSurfaceRoads') !== false;
      frame.showSurfaceHouses = developerSettings?.get('showSurfaceHouses') !== false;
      drawTerrain(frame, !planetPreview);
      drawGeologicalOverlays(frame);
      if (frame.showSurfaceRoads) layers.roads.render(frame);
      layers.settlements.render(frame);
      layers.buildings.renderPhysical(frame);
      layers.vehicles.render(frame);
      layers.buildings.renderAnchors(frame);
      layers.buildings.renderCards(frame);
      drawSelection(frame);
      drawLabels(frame);
    }

    function drawPlanetTerrain(planet, context, center, radius, planetPreview = false) {
      const record = context.terrains.get(planet.id);
      if (!record) return;
      const frame = surfaceFrame(planet, context), style = SurfaceStyle.terrain;
      const open = ease(clamp((radius - style.globeRevealStartRadiusPx) /
        (style.globeRevealEndRadiusPx - style.globeRevealStartRadiusPx), 0, 1));
      const textureWidth = record.texture.logicalWidth || record.texture.width;
      const textureHeight = record.texture.logicalHeight || record.texture.height;
      const mapAspect = textureWidth / textureHeight;
      const width = radius * 2 * (1 + open * (mapAspect - 1)), height = radius * 2;
      canvasContext.save(); canvasContext.beginPath();
      canvasContext.roundRect(center.x - width / 2, center.y - height / 2, width, height, Math.max(0, radius * (1 - open)));
      canvasContext.clip();
      drawSurface(localCamera(frame), planet, record, planetPreview);
      canvasContext.restore();
    }

    return Object.freeze({
      createTerrainTexture,
      getResourceRenderStyle,
      drawPlanetTerrain
    });
  }

  root.OrbitSurfaceRenderer = Object.freeze({ create });
})(globalThis);
