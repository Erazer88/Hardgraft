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
    if (upper < 0) return CLIMATE_BANDS.at(-1).colors;
    if (upper === 0) return CLIMATE_BANDS[0].colors;
    const lowerBand = CLIMATE_BANDS[upper - 1], upperBand = CLIMATE_BANDS[upper];
    const mix = clamp((temperature - lowerBand.temperature) /
      (upperBand.temperature - lowerBand.temperature), 0, 1);
    return Object.fromEntries(CLIMATE_FIELDS.map(field => [field,
      lowerBand.colors[field].map((channel, i) => channel + (upperBand.colors[field][i] - channel) * mix)]));
  });

  function create(canvasContext, dependencies) {
    const { project, localCamera, surfaceFrame, getState, getViewport, isCameraMoving, layers } = dependencies;
    const materialDefinitions = [
      { id: 'lowlands', src: 'assets/textures/terrain-lowlands.webp', opacity: 1 },
      { id: 'wetlands', src: 'assets/textures/terrain-wetlands.webp', opacity: 1 },
      { id: 'arid', src: 'assets/textures/terrain-arid-desert.webp', opacity: 1 },
      { id: 'beach', src: 'assets/textures/terrain-coastal-sand.webp', opacity: 1 },
      { id: 'alpine', src: 'assets/textures/terrain-alpine.webp', opacity: 1 },
      { id: 'frozen', src: 'assets/textures/terrain-frozen.webp', opacity: 1 },
      { id: 'volcanic', src: 'assets/textures/terrain-volcanic-basalt.webp', opacity: 1 },
      { id: 'ocean', src: 'assets/textures/terrain-deep-ocean.webp', opacity: 1 },
      { id: 'shelf', src: 'assets/textures/terrain-shallow-reef.webp', opacity: 1 }
    ];
    const materialImages = Object.create(null);
    const pendingMaterialTextures = new Set();
    let materialImagesReady = false;
    let detailContourCache = null;

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

    function materialMask(record, materialId) {
      const { width, height, elevation, moisture, seaLevel } = record.terrain;
      const coastDistance = record.coastDistance;
      const mask = makeCanvas(width, height), maskContext = mask.getContext('2d');
      const pixels = maskContext.createImageData(width, height);
      const averageTemperature = Number.isFinite(record.planet.temperature) ? record.planet.temperature : 18;
      const climate = SurfaceStyle.climate;
      const frozenWorld = record.planet.kind === 'glacée';
      const aridWorld = record.planet.kind === 'aride';
      const volcanicWorld = record.planet.kind === 'volcanique';
      for (let i = 0; i < elevation.length; i += 1) {
        const value = elevation[i], aboveSea = value - seaLevel;
        const localTemperature = averageTemperature - Math.max(0, aboveSea) * SurfaceStyle.terrain.temperatureLapsePerElevation;
        const snow = clamp((climate.snowlineStartTemperature - localTemperature + 2) / 14, 0, 1);
        const humidity = moisture[i] / 255;
        const vegetation = clamp((localTemperature - climate.vegetationTemperatureRange[0]) / 13, 0, 1) *
          clamp((climate.vegetationTemperatureRange[1] - localTemperature) / 18, 0, 1);
        const plain = transition(aboveSea, 3, 24) * (1 - transition(aboveSea, 84, 142));
        let alpha = 0;
        if (materialId === 'ocean' && value <= seaLevel) {
          alpha = transition(seaLevel - value, 34, 78) * .88;
        } else if (materialId === 'shelf' && value <= seaLevel) {
          const shallow = 1 - transition(seaLevel - value, 8, 52);
          const nearCoast = 1 - transition(coastDistance[i], 3, 30);
          const warmWater = clamp((averageTemperature + 12) / 42, 0, 1);
          alpha = shallow * (.22 + nearCoast * .78) * warmWater;
        } else if (materialId === 'beach' && aboveSea > 0) {
          alpha = (1 - transition(aboveSea, 1, 11)) * (1 - transition(snow, .08, .58));
        } else if (materialId === 'lowlands' && aboveSea > 0) {
          const forestMoisture = clamp((humidity - .18) / .55, 0, 1) *
            (1 - transition(humidity, .68, .92));
          alpha = plain * forestMoisture * vegetation;
        } else if (materialId === 'wetlands' && aboveSea > 0) {
          const waterlogged = clamp((humidity - .57) / .43, 0, 1);
          alpha = plain * waterlogged * vegetation;
        } else if (materialId === 'arid' && aboveSea > 0) {
          const dryness = clamp((.63 - humidity) * 2.5, 0, 1);
          const heat = clamp((localTemperature - 8) / 42, 0, 1);
          const desert = aridWorld ? .96 : dryness * (.35 + heat * .65);
          alpha = plain * desert * (1 - snow);
        } else if (materialId === 'alpine' && aboveSea > 0) {
          alpha = volcanicWorld ? 0 : transition(aboveSea, 52, 108) * (1 - transition(snow, .28, .7));
        } else if (materialId === 'frozen' && aboveSea > 0) {
          alpha = frozenWorld ? Math.max(snow, .74) : snow;
        } else if (materialId === 'volcanic' && aboveSea > 0) {
          alpha = volcanicWorld ? 1 : 0;
        }
        const pixel = i * 4;
        pixels.data[pixel] = pixels.data[pixel + 1] = pixels.data[pixel + 2] = 255;
        pixels.data[pixel + 3] = Math.round(clamp(alpha, 0, 1) * 255);
      }
      maskContext.putImageData(pixels, 0, 0);
      return mask;
    }

    function drawMaterialSample(record, definition, image, sampleCanvas) {
      const scale = Config.terrain.textureScale;
      const width = record.terrain.width * scale, height = record.terrain.height * scale;
      const sampleContext = sampleCanvas.getContext('2d');
      sampleContext.clearRect(0, 0, width, height);
      const random = World.rng(World.hashSeed(String(record.planet.seed) + ':material:' + definition.id));
      const size = Math.max(width, height) * 1.52;
      sampleContext.save();
      sampleContext.translate(width / 2 + (random() - .5) * width * .12,
        height / 2 + (random() - .5) * height * .12);
      sampleContext.rotate(Math.floor(random() * 4) * Math.PI / 2);
      sampleContext.scale(random() < .5 ? -1 : 1, random() < .5 ? -1 : 1);
      sampleContext.drawImage(image, -size / 2, -size / 2, size, size);
      sampleContext.restore();
      sampleContext.globalCompositeOperation = 'destination-in';
      const mask = materialMask(record, definition.id);
      sampleContext.drawImage(mask, 0, 0, width, height);
      sampleContext.globalCompositeOperation = 'source-over';
      mask.width = 0; mask.height = 0;
      return sampleCanvas;
    }

    function applyMaterialTextures(record) {
      if (record.materialsApplied || !materialImagesReady) return;
      const textureContext = record.texture.getContext('2d');
      const sampleCanvas = makeCanvas(record.texture.width, record.texture.height);
      textureContext.clearRect(0, 0, record.texture.width, record.texture.height);
      textureContext.drawImage(record.rawCanvas, 0, 0, record.texture.width, record.texture.height);
      textureContext.save();
      textureContext.globalCompositeOperation = 'source-over';
      for (const definition of materialDefinitions) {
        const image = materialImages[definition.id];
        if (!image) continue;
        textureContext.globalAlpha = definition.opacity;
        textureContext.drawImage(drawMaterialSample(record, definition, image, sampleCanvas), 0, 0);
      }
      textureContext.restore();
      record.drawDetails(textureContext);
      record.materialsApplied = true;
      record.rawCanvas = null;
      record.drawDetails = null;
      record.terrain = null;
      record.coastDistance = null;
      sampleCanvas.width = 0; sampleCanvas.height = 0;
      pendingMaterialTextures.delete(record);
    }

    if (typeof root.Image === 'function') {
      let pending = materialDefinitions.length;
      const settle = () => {
        pending -= 1;
        if (pending > 0) return;
        materialImagesReady = true;
        for (const record of [...pendingMaterialTextures]) applyMaterialTextures(record);
      };
      for (const definition of materialDefinitions) {
        const image = new root.Image();
        image.onload = () => { materialImages[definition.id] = image; settle(); };
        image.onerror = settle;
        image.src = definition.src;
      }
    }

    function transition(value, start, end) {
      return ease(clamp((value - start) / (end - start), 0, 1));
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

    function surfaceNoise(x, y, seed) {
      return valueNoise(x * .12, y * .12, seed) * .5 +
        valueNoise(x * .38, y * .38, seed ^ 0x5a6a4f29) * .32 +
        valueNoise(x * 1.15, y * 1.15, seed ^ 0x74a1d2c7) * .18;
    }

    function dot(context, x, y, radius, color) {
      context.fillStyle = color; context.beginPath(); context.arc(x, y, Math.max(.1, radius), 0, TAU); context.fill();
    }

    function createTerrainTexture(planet, terrainData, options = {}) {
      const { width, height, elevation, moisture, seaLevel } = terrainData;
      const textureScale = options.textureScale || Config.terrain.textureScale;
      const coastDistance = createWaterDistanceField(terrainData);
      const rawCanvas = makeCanvas(width, height), rawContext = rawCanvas.getContext('2d'), image = rawContext.createImageData(width, height);
      const averageTemperature = Number.isFinite(planet.temperature) ? planet.temperature : 18;
      const lapseRate = SurfaceStyle.terrain.temperatureLapsePerElevation;
      const climate = SurfaceStyle.climate;
      const albedoSeed = World.hashSeed(String(planet.seed) + ':surface-albedo:v1');
      const light = [-.48, -.59, .65];
      const lightLength = Math.hypot(...light);
      for (let i = 0; i < light.length; i += 1) light[i] /= lightLength;
      const elevationAt = (x, y) => elevation[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = y * width + x, value = elevation[index];
        const localTemperature = averageTemperature - Math.max(0, value - seaLevel) * lapseRate;
        const climateIndex = clamp(Math.round(localTemperature) - CLIMATE_LOOKUP_MIN,
          0, CLIMATE_LOOKUP.length - 1);
        const colors = CLIMATE_LOOKUP[climateIndex];
        const aboveSea = value - seaLevel;
        const grain = surfaceNoise(x, y, albedoSeed) - .5;
        const dx = (elevationAt(x + 1, y) - elevationAt(x - 1, y)) * .5;
        const dy = (elevationAt(x, y + 1) - elevationAt(x, y - 1)) * .5;
        const normal = [-dx * .055, -dy * .055, 1];
        const normalLength = Math.hypot(...normal);
        for (let channel = 0; channel < 3; channel += 1) normal[channel] /= normalLength;
        const diffuse = normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2];
        let rgb;
        if (value <= seaLevel) {
          const depth = clamp((seaLevel - value) / 122, 0, 1);
          const shelfColor = mixRGB([47, 145, 153], [28, 99, 132], transition(depth, .12, .72));
          const deepColor = mixRGB(colors.sea, [3, 13, 29], transition(depth, .3, .9));
          rgb = mixRGB(shelfColor, deepColor, transition(depth, .1, .84));
          const depthShelf = 1 - transition(seaLevel - value, 4, SurfaceStyle.terrain.shelfDepthCells);
          const coastShelf = 1 - transition(coastDistance[index], 0, SurfaceStyle.terrain.shelfDistanceCells);
          rgb = mixRGB(rgb, [37, 151, 157], depthShelf * coastShelf * .58);
          const ice = clamp((climate.snowlineStartTemperature - localTemperature) / climate.snowlineRange, 0, .9);
          rgb = mixRGB(rgb, colors.snow, ice);
        } else {
          const upland = transition(aboveSea, 18, 106);
          const highland = transition(aboveSea, 70, 168);
          rgb = mixRGB(colors.lowland, colors.upland, upland);
          rgb = mixRGB(rgb, colors.highland, highland);
          const coast = 1 - transition(aboveSea, 1, 10);
          rgb = mixRGB(rgb, colors.shore, coast * .68);
          const humidity = moisture[index] / 255;
          const vegetationRange = climate.vegetationTemperatureRange;
          const vegetation = clamp((localTemperature - vegetationRange[0]) / 13, 0, 1) *
            clamp((vegetationRange[1] - localTemperature) / 18, 0, 1);
          const dryness = clamp((.58 - humidity) * 1.9, 0, 1) * vegetation;
          rgb = mixRGB(rgb, colors.dry, dryness * climate.drySoilBlend);
          const alpineSnow = clamp((climate.snowlineStartTemperature - localTemperature + 2) / 14, 0, 1);
          rgb = mixRGB(rgb, colors.snow, alpineSnow);
        }
        const land = value > seaLevel;
        const lighting = land ? clamp(.68 + .54 * diffuse, .47, 1.22) : clamp(.92 + .11 * diffuse, .84, 1.06);
        const cardinalMean = (elevationAt(x - 1, y) + elevationAt(x + 1, y) +
          elevationAt(x, y - 1) + elevationAt(x, y + 1)) * .25;
        const valleyShade = land ? clamp((cardinalMean - value) * .009, 0, .17) : 0;
        const textureStrength = land ? 9 + transition(aboveSea, 35, 150) * 8 : 4;
        const albedoVariation = grain * textureStrength;
        const albedoTint = land ? [albedoVariation * .78, albedoVariation, albedoVariation * .7] :
          [albedoVariation * .5, albedoVariation * .75, albedoVariation];
        const reliefLight = lighting - valleyShade;
        for (let channel = 0; channel < 3; channel += 1) {
          image.data[index * 4 + channel] = clamp(rgb[channel] * reliefLight + albedoTint[channel], 0, 255);
        }
        image.data[index * 4 + 3] = 255;
      }
      rawContext.putImageData(image, 0, 0);
      const terrainTexture = makeCanvas(width * textureScale, height * textureScale);
      terrainTexture.logicalWidth = options.logicalWidth || width * textureScale;
      terrainTexture.logicalHeight = options.logicalHeight || height * textureScale;
      const textureContext = terrainTexture.getContext('2d');
      textureContext.imageSmoothingEnabled = true;
      textureContext.drawImage(rawCanvas, 0, 0, terrainTexture.width, terrainTexture.height);
      const materialRecord = {
        planet, terrain: terrainData, texture: terrainTexture, coastDistance, rawCanvas,
        materialsApplied: false, drawDetails: null
      };
      function drawDetails(context) {
        // The active high-resolution map draws its contour lines directly in
        // screen space so they do not soften when the raster underneath zooms.
        if (!options.skipContours) {
          const contourLevels = [...Array.from({ length: 40 }, (_, i) => 48 + i * 5), 103];
          let edgeX = 0, edgeY = 0, pairing = false;
          function contourEdge(x, y) {
            if (pairing) {
              context.moveTo(edgeX * textureScale, edgeY * textureScale);
              context.lineTo(x * textureScale, y * textureScale);
            } else { edgeX = x; edgeY = y; }
            pairing = !pairing;
          }
          for (const level of contourLevels) {
            const coastline = level === 103;
            const indexContour = !coastline && (level - 48) % 20 === 0;
            context.beginPath();
            context.strokeStyle = coastline ? '#e0c98b9c' : level < 102 ? '#9dd3df46' : indexContour ? '#20302265' : '#1e302544';
            context.lineWidth = coastline ? 1.15 : indexContour ? .85 : .56;
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
            context.stroke();
          }
        }
        const random = World.rng(planet.seed + 113);
        for (let i = 0; i < 800; i++) {
          const x = Math.floor(random() * width), y = Math.floor(random() * height), index = y * width + x;
          if (elevation[index] > 113 && elevation[index] < 165 && moisture[index] > 139) {
            dot(context, x * textureScale, y * textureScale, 1 + random() * 3.5, '#243e3327');
          }
        }
      }
      materialRecord.drawDetails = drawDetails;
      if (materialImagesReady) applyMaterialTextures(materialRecord);
      else {
        drawDetails(textureContext);
        pendingMaterialTextures.add(materialRecord);
      }
      return terrainTexture;
    }

    function drawDetailContours(frame) {
      const terrain = frame.detailTerrain;
      if (!terrain) {
        if (getState().level !== 'surface') detailContourCache = null;
        return;
      }
      if (frame.zoom < 2 || typeof root.Path2D !== 'function') return;
      const { width, height, elevation } = terrain;
      const viewport = frame.viewport, top = frame.project(0, 0);
      const detailFactor = Config.terrain.renderDetailFactor;
      const subdivision = frame.zoom >= 3 ? 4 : 2;
      const gridWidth = (width - 1) * subdivision + 1, gridHeight = (height - 1) * subdivision + 1;
      const cellSize = Config.terrain.textureScale / detailFactor / subdivision;
      const minX = clamp(Math.floor((-top.x / frame.zoom) / cellSize) - 1, 0, gridWidth - 2);
      const maxX = clamp(Math.ceil(((viewport.width - top.x) / frame.zoom) / cellSize) + 1, 0, gridWidth - 2);
      const minY = clamp(Math.floor((-top.y / frame.zoom) / cellSize) - 1, 0, gridHeight - 2);
      const maxY = clamp(Math.ceil(((viewport.height - top.y) / frame.zoom) / cellSize) + 1, 0, gridHeight - 2);
      const visibleMinX = clamp(Math.floor((-top.x / frame.zoom) / cellSize), 0, gridWidth - 2);
      const visibleMaxX = clamp(Math.ceil(((viewport.width - top.x) / frame.zoom) / cellSize), 0, gridWidth - 2);
      const visibleMinY = clamp(Math.floor((-top.y / frame.zoom) / cellSize), 0, gridHeight - 2);
      const visibleMaxY = clamp(Math.ceil(((viewport.height - top.y) / frame.zoom) / cellSize), 0, gridHeight - 2);
      const coversViewport = detailContourCache?.planetId === frame.planet.id &&
        detailContourCache.subdivision === subdivision &&
        visibleMinX >= detailContourCache.minX &&
        visibleMaxX <= detailContourCache.maxX && visibleMinY >= detailContourCache.minY &&
        visibleMaxY <= detailContourCache.maxY;
      if (!coversViewport && (!isCameraMoving || !isCameraMoving())) {
        const contourLevels = [...Array.from({ length: 40 }, (_, i) => 48 + i * 5), 103];
        const sampleWidth = maxX - minX + 2, sampleHeight = maxY - minY + 2;
        const samples = new Float32Array(sampleWidth * sampleHeight);
        for (let y = 0; y < sampleHeight; y += 1) for (let x = 0; x < sampleWidth; x += 1) {
          const sourceX = (minX + x) / subdivision, sourceY = (minY + y) / subdivision;
          const x0 = Math.floor(sourceX), y0 = Math.floor(sourceY);
          const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
          const tx = sourceX - x0, ty = sourceY - y0;
          const a = elevation[y0 * width + x0], b = elevation[y0 * width + x1];
          const c = elevation[y1 * width + x0], d = elevation[y1 * width + x1];
          samples[y * sampleWidth + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
        }
        const contours = contourLevels.map(level => {
          const path = new root.Path2D();
          for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
            const index = (y - minY) * sampleWidth + x - minX;
            const a = samples[index], b = samples[index + 1];
            const d = samples[index + sampleWidth], e = samples[index + sampleWidth + 1];
            const mask = (a < level ? 1 : 0) | (b < level ? 2 : 0) | (e < level ? 4 : 0) | (d < level ? 8 : 0);
            if (mask === 0 || mask === 15) continue;
            let hasFirst = false, firstX = 0, firstY = 0;
            if ((a < level) !== (b < level)) {
              const px = x + (level - a) / (b - a), py = y;
              if (hasFirst) { path.moveTo(firstX * cellSize, firstY * cellSize); path.lineTo(px * cellSize, py * cellSize); hasFirst = false; }
              else { firstX = px; firstY = py; hasFirst = true; }
            }
            if ((b < level) !== (e < level)) {
              const px = x + 1, py = y + (level - b) / (e - b);
              if (hasFirst) { path.moveTo(firstX * cellSize, firstY * cellSize); path.lineTo(px * cellSize, py * cellSize); hasFirst = false; }
              else { firstX = px; firstY = py; hasFirst = true; }
            }
            if ((e < level) !== (d < level)) {
              const px = x + 1 - (level - e) / (d - e), py = y + 1;
              if (hasFirst) { path.moveTo(firstX * cellSize, firstY * cellSize); path.lineTo(px * cellSize, py * cellSize); hasFirst = false; }
              else { firstX = px; firstY = py; hasFirst = true; }
            }
            if ((d < level) !== (a < level)) {
              const px = x, py = y + 1 - (level - d) / (a - d);
              if (hasFirst) { path.moveTo(firstX * cellSize, firstY * cellSize); path.lineTo(px * cellSize, py * cellSize); hasFirst = false; }
              else { firstX = px; firstY = py; hasFirst = true; }
            }
          }
          const coastline = level === 103;
          const indexContour = !coastline && (level - 48) % 20 === 0;
          return { path, color: coastline ? '#e0c98b9c' : level < 102 ? '#9dd3df46' : indexContour ? '#20302265' : '#1e302544',
            width: (coastline ? 1.15 : indexContour ? .85 : .56) / detailFactor };
        });
        detailContourCache = { planetId: frame.planet.id, subdivision, minX, maxX, minY, maxY, contours };
      }
      if (!detailContourCache || detailContourCache.planetId !== frame.planet.id) return;
      canvasContext.save();
      canvasContext.translate(top.x, top.y);
      canvasContext.scale(frame.zoom, frame.zoom);
      canvasContext.lineCap = 'round'; canvasContext.lineJoin = 'round';
      for (const contour of detailContourCache.contours) {
        canvasContext.strokeStyle = contour.color; canvasContext.lineWidth = contour.width;
        canvasContext.stroke(contour.path);
      }
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
      const state = getState();
      const useDetailedTexture = state.level === 'surface' && state.planet?.id === planet.id &&
        cam.zoom >= 2 && record.detailTexture;
      const terrainTexture = useDetailedTexture || record.texture;
      return {
        context: canvasContext,
        camera: cam,
        zoom: cam.zoom,
        planet,
        terrain: record.data,
        terrainTexture,
        detailTerrain: useDetailedTexture ? record.detailTerrain : null,
        terrainWidth: record.texture.logicalWidth || record.texture.width,
        terrainHeight: record.texture.logicalHeight || record.texture.height,
        state,
        viewport: getViewport(),
        now: dependencies.getNow(),
        project: (x, y) => project(x, y, cam)
      };
    }

    function drawTerrain(frame) {
      const { terrainTexture, terrainWidth, terrainHeight } = frame, top = frame.project(0, 0);
      const width = terrainWidth * frame.zoom, height = terrainHeight * frame.zoom;
      canvasContext.imageSmoothingEnabled = true;
      canvasContext.drawImage(terrainTexture, top.x, top.y, width, height);
      if (frame.zoom > SurfaceStyle.lod.surfaceGridZoom) drawSurfaceGrid(frame.camera);
      drawDetailContours(frame);
      const bottom = frame.project(terrainWidth, terrainHeight);
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
      const top = frame.project(0, 0), bottom = frame.project(frame.terrainWidth, frame.terrainHeight);
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
