(function (root) {
  'use strict';

  const World = root.OrbitWorld, Config = root.OrbitConfig;
  const SurfaceStyle = root.OrbitSurfaceStyle;
  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const ease = t => t * t * (3 - 2 * t);

  function hexRGB(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function mixRGB(first, second, amount) {
    return first.map((channel, index) => channel + (second[index] - channel) * amount);
  }

  const CLIMATE_FIELDS = ['sea', 'shore', 'lowland', 'upland', 'highland', 'snow', 'dry'];
  const CLIMATE_BANDS = SurfaceStyle.climate.temperatureBands.map(band => ({
    temperature: band.temperature,
    colors: Object.fromEntries(CLIMATE_FIELDS.map(field => [field, hexRGB(band[field])]))
  }));
  const CLIMATE_LOOKUP_MIN = CLIMATE_BANDS[0].temperature;
  const CLIMATE_LOOKUP_MAX = CLIMATE_BANDS.at(-1).temperature;
  const CLIMATE_LOOKUP = Array.from({ length: CLIMATE_LOOKUP_MAX - CLIMATE_LOOKUP_MIN + 1 }, (_, index) => {
    const temperature = CLIMATE_LOOKUP_MIN + index;
    let upper = CLIMATE_BANDS.findIndex(band => band.temperature >= temperature);
    if (upper <= 0) return CLIMATE_BANDS[0].colors;
    if (upper < 0) return CLIMATE_BANDS.at(-1).colors;
    const lowerBand = CLIMATE_BANDS[upper - 1], upperBand = CLIMATE_BANDS[upper];
    const mix = clamp((temperature - lowerBand.temperature) /
      (upperBand.temperature - lowerBand.temperature), 0, 1);
    return Object.fromEntries(CLIMATE_FIELDS.map(field => [field,
      lowerBand.colors[field].map((channel, i) => channel + (upperBand.colors[field][i] - channel) * mix)]));
  });

  function create(canvasContext, dependencies) {
    const { project, localCamera, surfaceFrame, getState, getViewport, layers } = dependencies;
    const materialAssets = [
      { id: 'shore', src: 'assets/textures/aerial_sand_diff_1k.webp', opacity: .52 },
      { id: 'lowland', src: 'assets/textures/aerial_rocks_04_diff_1k.webp', opacity: .34 },
      { id: 'highland', src: 'assets/textures/aerial_rocks_02_diff_1k.webp', opacity: .48 }
    ];
    const materialImages = Object.create(null);
    const terrainMaterialCache = new WeakMap();
    let materialAssetsReady = false;

    if (typeof root.Image === 'function') {
      let pending = materialAssets.length;
      for (const asset of materialAssets) {
        const image = new root.Image();
        const settle = () => { pending -= 1; if (pending === 0) materialAssetsReady = true; };
        image.onload = () => { materialImages[asset.id] = image; settle(); };
        image.onerror = settle;
        image.src = asset.src;
      }
    }

    function makeCanvas(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      return canvas;
    }

    function createWaterDistanceField(terrain) {
      const { width, height, elevation, seaLevel } = terrain;
      const far = width + height;
      const distance = new Float32Array(width * height);
      for (let i = 0; i < distance.length; i += 1) distance[i] = elevation[i] > seaLevel ? 0 : far;
      const diagonal = Math.SQRT2;
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (x > 0) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
        if (y > 0) distance[i] = Math.min(distance[i], distance[i - width] + 1);
        if (x > 0 && y > 0) distance[i] = Math.min(distance[i], distance[i - width - 1] + diagonal);
        if (x + 1 < width && y > 0) distance[i] = Math.min(distance[i], distance[i - width + 1] + diagonal);
      }
      for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
        const i = y * width + x;
        if (x + 1 < width) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
        if (y + 1 < height) distance[i] = Math.min(distance[i], distance[i + width] + 1);
        if (x + 1 < width && y + 1 < height) distance[i] = Math.min(distance[i], distance[i + width + 1] + diagonal);
        if (x > 0 && y + 1 < height) distance[i] = Math.min(distance[i], distance[i + width - 1] + diagonal);
      }
      return distance;
    }

    function transition(value, start, end) {
      return ease(clamp((value - start) / (end - start), 0, 1));
    }

    function drawTextureSample(context, image, width, height, seed, materialId) {
      const random = World.rng(World.hashSeed(String(seed) + ':surface:' + materialId));
      const offsetX = (random() - .5) * width * .16;
      const offsetY = (random() - .5) * height * .16;
      const rotation = Math.floor(random() * 4) * Math.PI / 2;
      const flipX = random() < .5 ? -1 : 1;
      const flipY = random() < .5 ? -1 : 1;
      const size = Math.max(width, height) * 1.55;
      context.save();
      context.translate(width / 2 + offsetX, height / 2 + offsetY);
      context.rotate(rotation);
      context.scale(flipX, flipY);
      context.drawImage(image, -size / 2, -size / 2, size, size);
      context.restore();
    }

    function materialMask(terrain, coastDistance, materialId, planet, mask) {
      const { width, height, elevation, moisture, seaLevel } = terrain;
      const context = mask.getContext('2d');
      const pixels = context.createImageData(width, height);
      const temperature = Number.isFinite(planet.temperature) ? planet.temperature : 18;
      for (let i = 0; i < elevation.length; i += 1) {
        const aboveSea = elevation[i] - seaLevel, humidity = moisture[i] / 255;
        const localTemperature = temperature - Math.max(0, aboveSea) * SurfaceStyle.terrain.temperatureLapsePerElevation;
        let alpha = 0;
        if (materialId === 'shore') {
          if (aboveSea <= 0) {
            const coast = 1 - transition(coastDistance[i], 0, SurfaceStyle.terrain.shelfDistanceCells);
            const shallow = 1 - transition(-aboveSea, 0, SurfaceStyle.terrain.shelfDepthCells);
            alpha = coast * shallow * .82;
          } else {
            alpha = (1 - transition(aboveSea, 2, 13)) * .72;
          }
        } else if (aboveSea > 0 && materialId === 'lowland') {
          const plain = clamp(1 - Math.abs(aboveSea - 34) / 72, 0, 1);
          const temperate = clamp((localTemperature + 18) / 36, 0, 1);
          alpha = plain * (.2 + humidity * .8) * temperate * .76;
        } else if (aboveSea > 0 && materialId === 'highland') {
          const mountain = transition(aboveSea, 30, 130);
          alpha = mountain * (.62 + (1 - humidity) * .24) * .78;
        }
        const pixel = i * 4;
        pixels.data[pixel] = pixels.data[pixel + 1] = pixels.data[pixel + 2] = 255;
        pixels.data[pixel + 3] = Math.round(clamp(alpha, 0, 1) * 255);
      }
      context.putImageData(pixels, 0, 0);
      return mask;
    }

    function createMaterialOverlay(terrain, planet, coastDistance) {
      const scale = SurfaceStyle.terrain.materialTextureScale;
      const width = terrain.width * scale, height = terrain.height * scale;
      const overlay = makeCanvas(width, height), overlayContext = overlay.getContext('2d');
      const sample = makeCanvas(width, height), sampleContext = sample.getContext('2d');
      const mask = makeCanvas(terrain.width, terrain.height);
      overlayContext.imageSmoothingEnabled = true;
      sampleContext.imageSmoothingEnabled = true;
      for (const material of materialAssets) {
        const image = materialImages[material.id];
        if (!image) continue;
        sampleContext.clearRect(0, 0, width, height);
        drawTextureSample(sampleContext, image, width, height, planet.seed, material.id);
        const maskCanvas = materialMask(terrain, coastDistance, material.id, planet, mask);
        sampleContext.globalCompositeOperation = 'destination-in';
        sampleContext.drawImage(maskCanvas, 0, 0, width, height);
        sampleContext.globalCompositeOperation = 'source-over';
        overlayContext.globalAlpha = material.opacity;
        overlayContext.drawImage(sample, 0, 0);
        overlayContext.globalAlpha = 1;
      }
      return overlay;
    }

    let reliefDetailTexture = null;
    function makeReliefDetailTexture(image) {
      const size = 256, sample = makeCanvas(size, size), sampleContext = sample.getContext('2d');
      sampleContext.drawImage(image, 0, 0, size, size);
      const source = sampleContext.getImageData(0, 0, size, size).data;
      const integralSize = size + 1, integral = new Float64Array(integralSize * integralSize);
      for (let y = 1; y <= size; y += 1) {
        let rowSum = 0;
        for (let x = 1; x <= size; x += 1) {
          const index = ((y - 1) * size + x - 1) * 4;
          rowSum += source[index] * .2126 + source[index + 1] * .7152 + source[index + 2] * .0722;
          integral[y * integralSize + x] = integral[(y - 1) * integralSize + x] + rowSum;
        }
      }
      const texture = makeCanvas(size, size), textureContext = texture.getContext('2d');
      const output = textureContext.createImageData(size, size), radius = 7;
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
        const x0 = Math.max(0, x - radius), x1 = Math.min(size, x + radius + 1);
        const y0 = Math.max(0, y - radius), y1 = Math.min(size, y + radius + 1);
        const total = integral[y1 * integralSize + x1] - integral[y0 * integralSize + x1] -
          integral[y1 * integralSize + x0] + integral[y0 * integralSize + x0];
        const mean = total / ((x1 - x0) * (y1 - y0));
        const sourceIndex = (y * size + x) * 4;
        const luma = source[sourceIndex] * .2126 + source[sourceIndex + 1] * .7152 + source[sourceIndex + 2] * .0722;
        const value = clamp(128 + (luma - mean) * 2.2, 72, 184);
        const outputIndex = sourceIndex;
        output.data[outputIndex] = output.data[outputIndex + 1] = output.data[outputIndex + 2] = value;
        output.data[outputIndex + 3] = 255;
      }
      textureContext.putImageData(output, 0, 0);
      return texture;
    }

    if (typeof root.Image === 'function') {
      const image = new root.Image();
      image.onload = () => { reliefDetailTexture = makeReliefDetailTexture(image); };
      image.src = 'assets/textures/blue-marble-relief-source.jpg';
    }

    function dot(context, x, y, radius, color) {
      context.fillStyle = color; context.beginPath(); context.arc(x, y, Math.max(.1, radius), 0, TAU); context.fill();
    }

    function createTerrainTexture(planet, terrainData) {
      const { width, height, elevation, moisture, seaLevel } = terrainData;
      const textureScale = Config.terrain.textureScale;
      const coastDistance = createWaterDistanceField(terrainData);
      const rawCanvas = makeCanvas(width, height), rawContext = rawCanvas.getContext('2d'), image = rawContext.createImageData(width, height);
      const averageTemperature = Number.isFinite(planet.temperature) ? planet.temperature : 18;
      const lapseRate = SurfaceStyle.terrain.temperatureLapsePerElevation;
      const climate = SurfaceStyle.climate;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = y * width + x, value = elevation[index];
        const localTemperature = averageTemperature - Math.max(0, value - seaLevel) * lapseRate;
        const climateIndex = clamp(Math.round(localTemperature) - CLIMATE_LOOKUP_MIN,
          0, CLIMATE_LOOKUP.length - 1);
        const colors = CLIMATE_LOOKUP[climateIndex];
        const altitude = clamp((value - seaLevel - 4) / 145, 0, 1);
        let rgb;
        if (value <= seaLevel) {
          const depth = ease(clamp((seaLevel - value) / SurfaceStyle.terrain.shelfDepthCells, 0, 1));
          rgb = mixRGB(colors.shore, colors.sea, depth);
          const depthShelf = 1 - transition(seaLevel - value, 0, SurfaceStyle.terrain.shelfDepthCells);
          const coastShelf = 1 - transition(coastDistance[index], 0, SurfaceStyle.terrain.shelfDistanceCells);
          const warmShelf = clamp((localTemperature + 20) / 45, 0, 1);
          const shelfColor = mixRGB([91, 151, 169], [35, 151, 148], warmShelf);
          rgb = mixRGB(rgb, shelfColor, Math.min(depthShelf, coastShelf) * .78);
          const ice = clamp((climate.snowlineStartTemperature - localTemperature) / climate.snowlineRange, 0, .9);
          rgb = mixRGB(rgb, colors.snow, ice);
        } else {
          const upland = ease(clamp(altitude / .65, 0, 1));
          const highland = ease(clamp((altitude - .48) / .52, 0, 1));
          rgb = mixRGB(colors.lowland, colors.upland, upland);
          rgb = mixRGB(rgb, colors.highland, highland);
          const coast = 1 - ease(clamp((value - seaLevel - 1) / 12, 0, 1));
          rgb = mixRGB(rgb, colors.shore, coast * .58);
          const humidity = moisture[index] / 255;
          const vegetationRange = climate.vegetationTemperatureRange;
          const vegetation = clamp((localTemperature - vegetationRange[0]) / 13, 0, 1) *
            clamp((vegetationRange[1] - localTemperature) / 18, 0, 1);
          const dryness = clamp((.58 - humidity) * 1.9, 0, 1) * vegetation;
          rgb = mixRGB(rgb, colors.dry, dryness * climate.drySoilBlend);
          const alpineSnow = clamp((value - 214) / 28, 0, .8);
          const temperatureSnow = clamp((climate.snowlineStartTemperature - localTemperature) /
            climate.snowlineRange, 0, 1);
          rgb = mixRGB(rgb, colors.snow, Math.max(alpineSnow, temperatureSnow * altitude));
        }
        const dx = elevation[y * width + Math.min(width - 1, x + 1)] - elevation[y * width + Math.max(0, x - 1)];
        const dy = elevation[Math.min(height - 1, y + 1) * width + x] - elevation[Math.max(0, y - 1) * width + x];
        const shade = clamp((-dx * 1.3 - dy * 1.65), -38, 32);
        for (let channel = 0; channel < 3; channel++) image.data[index * 4 + channel] = clamp(rgb[channel] + shade, 0, 255);
        image.data[index * 4 + 3] = 255;
      }
      rawContext.putImageData(image, 0, 0);
      const terrainTexture = makeCanvas(width * textureScale, height * textureScale);
      terrainMaterialCache.set(terrainTexture, { coastDistance, overlay: null });
      const textureContext = terrainTexture.getContext('2d');
      textureContext.imageSmoothingEnabled = true;
      textureContext.drawImage(rawCanvas, 0, 0, terrainTexture.width, terrainTexture.height);

      // Interpolated contour lines retain the topographic map at every zoom.
      const contourLevels = [...Array.from({ length: 40 }, (_, i) => 48 + i * 5), 103];
      let edgeX = 0, edgeY = 0, pairing = false;
      function contourEdge(x, y) {
        if (pairing) {
          textureContext.moveTo(edgeX * textureScale, edgeY * textureScale);
          textureContext.lineTo(x * textureScale, y * textureScale);
        } else { edgeX = x; edgeY = y; }
        pairing = !pairing;
      }
      for (const level of contourLevels) {
        const coastline = level === 103;
        const indexContour = !coastline && (level - 48) % 20 === 0;
        textureContext.beginPath();
        textureContext.strokeStyle = coastline ? '#d3c9a878' : level < 102 ? '#9db3b02c' : indexContour ? '#d0cbb04f' : '#c6cbb13c';
        textureContext.lineWidth = coastline ? 1.15 : indexContour ? .85 : .56;
        for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
          const a = elevation[y * width + x], b = elevation[y * width + x + 1];
          const d = elevation[(y + 1) * width + x], e = elevation[(y + 1) * width + x + 1];
          const mask = (a < level ? 1 : 0) | (b < level ? 2 : 0) | (e < level ? 4 : 0) | (d < level ? 8 : 0);
          if (mask === 0 || mask === 15) continue;
          pairing = false;
          if ((a < level) !== (b < level)) contourEdge(x + (level - a) / (b - a), y);
          if ((b < level) !== (e < level)) contourEdge(x + 1, y + (level - b) / (e - b));
          if ((e < level) !== (d < level)) contourEdge(x + 1 - (level - e) / (d - e), y + 1);
          if ((d < level) !== (a < level)) contourEdge(x, y + 1 - (level - d) / (a - d));
        }
        textureContext.stroke();
      }
      const random = World.rng(planet.seed + 113);
      for (let i = 0; i < 800; i++) {
        const x = Math.floor(random() * width), y = Math.floor(random() * height), index = y * width + x;
        if (elevation[index] > 113 && elevation[index] < 165 && moisture[index] > 139) {
          dot(textureContext, x * textureScale, y * textureScale, 1 + random() * 3.5, '#243e3327');
        }
      }
      return terrainTexture;
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
        state: getState(),
        viewport: getViewport(),
        now: dependencies.getNow(),
        project: (x, y) => project(x, y, cam)
      };
    }

    function drawTerrain(frame) {
      const { terrainTexture } = frame, top = frame.project(0, 0);
      const width = terrainTexture.width * frame.zoom, height = terrainTexture.height * frame.zoom;
      canvasContext.imageSmoothingEnabled = true;
      canvasContext.drawImage(terrainTexture, top.x, top.y, width, height);
      if (reliefDetailTexture) {
        canvasContext.save();
        canvasContext.globalAlpha = SurfaceStyle.terrain.reliefTextureOpacity;
        canvasContext.globalCompositeOperation = 'soft-light';
        canvasContext.drawImage(reliefDetailTexture, top.x, top.y, width, height);
        canvasContext.restore();
      }
      const materialRecord = terrainMaterialCache.get(terrainTexture);
      if (materialRecord && materialAssetsReady) {
        if (!materialRecord.overlay) materialRecord.overlay = createMaterialOverlay(
          frame.terrain, frame.planet, materialRecord.coastDistance);
        canvasContext.save();
        canvasContext.globalAlpha = SurfaceStyle.terrain.materialTextureOpacity;
        canvasContext.globalCompositeOperation = 'soft-light';
        canvasContext.drawImage(materialRecord.overlay, top.x, top.y, width, height);
        canvasContext.restore();
        materialRecord.coastDistance = null;
      }
      if (frame.zoom > SurfaceStyle.lod.surfaceGridZoom) drawSurfaceGrid(frame.camera);
      const bottom = frame.project(terrainTexture.width, terrainTexture.height);
      canvasContext.strokeStyle = SurfaceStyle.terrain.edgeColor;
      canvasContext.lineWidth = SurfaceStyle.terrain.edgeWidthPx;
      canvasContext.strokeRect(top.x, top.y, bottom.x - top.x, bottom.y - top.y);
    }

    function resourceMarkerRadius(resource, marker = SurfaceStyle.resources) {
      return clamp((resource.radius || 10) * marker.markerRadiusPerTerrainCellPx,
        marker.markerRadiusMinPx, marker.markerRadiusMaxPx);
    }

    function drawGeologicalOverlays(frame) {
      const marker = SurfaceStyle.resources;
      for (const resource of frame.terrain.resources) {
        const p = frame.project(resource.x * Config.terrain.textureScale, resource.y * Config.terrain.textureScale);
        const radius = resourceMarkerRadius(resource, marker);
        const hatchColor = resource.marine ? marker.marineHatchColor : marker.hatchColor;
        if (p.x < 0 || p.y < 0 || p.x > frame.viewport.width || p.y > frame.viewport.height) continue;
        canvasContext.save(); canvasContext.beginPath();
        canvasContext.ellipse(p.x, p.y, radius * marker.ellipseXRatio, radius * marker.ellipseYRatio, marker.ellipseAngleRadians, 0, TAU);
        canvasContext.clip();
        for (let i = -radius * 2; i < radius * 2; i += marker.hatchSpacingPx) {
          dependencies.drawLine(canvasContext,
            [{ x: p.x + i - radius, y: p.y + radius }, { x: p.x + i + radius, y: p.y - radius }],
            hatchColor, marker.hatchWidthPx);
        }
        canvasContext.restore();
        if (resource.marine) {
          canvasContext.save();
          canvasContext.strokeStyle = marker.marineOutlineColor;
          canvasContext.lineWidth = .8;
          canvasContext.setLineDash([2, 2]);
          canvasContext.beginPath();
          canvasContext.ellipse(p.x, p.y, radius * marker.ellipseXRatio, radius * marker.ellipseYRatio,
            marker.ellipseAngleRadians, 0, TAU);
          canvasContext.stroke();
          canvasContext.setLineDash([]);
          dot(canvasContext, p.x, p.y, 1.15, marker.marineDotColor);
          canvasContext.restore();
        }
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
          const radius = resourceMarkerRadius(resource, marker);
          dependencies.drawLabel(canvasContext, resource.type.toUpperCase(),
            p.x + radius + marker.labelOffsetXPx, p.y, marker.labelColor, marker.labelSizePx);
        }
      }
      const top = frame.project(0, 0), bottom = frame.project(frame.terrainTexture.width, frame.terrainTexture.height);
      dependencies.drawLabel(canvasContext, frame.planet.name.toUpperCase() + ' / RELEVÉ TOPOGRAPHIQUE',
        top.x + 15, bottom.y - 16, '#c3c9b1', SurfaceStyle.labels.siteDetailSizePx);
    }

    function drawSurface(cam, planet, record) {
      const frame = makeSurfaceFrame(cam, planet, record);
      drawTerrain(frame);
      drawGeologicalOverlays(frame);
      layers.roads.render(frame);
      layers.settlements.render(frame);
      layers.buildings.renderPhysical(frame);
      layers.vehicles.render(frame);
      layers.buildings.renderAnchors(frame);
      layers.buildings.renderCards(frame);
      drawSelection(frame);
      drawLabels(frame);
    }

    function drawPlanetTerrain(planet, context, center, radius) {
      const record = context.terrains.get(planet.id);
      if (!record) return;
      const frame = surfaceFrame(planet, context), style = SurfaceStyle.terrain;
      const open = ease(clamp((radius - style.globeRevealStartRadiusPx) /
        (style.globeRevealEndRadiusPx - style.globeRevealStartRadiusPx), 0, 1));
      const width = radius * 2 * (1 + open * style.mapExpansionRatio), height = radius * 2;
      canvasContext.save(); canvasContext.beginPath();
      canvasContext.roundRect(center.x - width / 2, center.y - height / 2, width, height, Math.max(0, radius * (1 - open)));
      canvasContext.clip();
      drawSurface(localCamera(frame), planet, record);
      canvasContext.restore();
    }

    return Object.freeze({ createTerrainTexture, drawPlanetTerrain });
  }

  root.OrbitSurfaceRenderer = Object.freeze({ create });
})(globalThis);
