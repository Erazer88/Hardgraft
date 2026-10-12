(function (root) {
  'use strict';

  const World = root.OrbitWorld, Config = root.OrbitConfig;
  const SurfaceStyle = root.OrbitSurfaceStyle;
  const surfaceRendererScriptUrl = root.document?.currentScript?.src || '';
  const TAU = Math.PI * 2;
  const RESOURCE_COLOR_SETTINGS = Object.freeze({
    iron: 'depositIronColor', copper: 'depositCopperColor', silicon: 'depositSiliconColor',
    carbon: 'depositCarbonColor', oil: 'depositOilColor'
  });
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
    const { project, localCamera, surfaceFrame, getState, getViewport, isCameraInteracting, layers } = dependencies;
    const materialRenderer = root.OrbitSurfaceMaterialRenderer.create();
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
    let detailContourJob = null;
    let lastContourBuildAt = -Infinity;
    const materialIndices = Object.fromEntries(materialDefinitions.map((definition, index) => [definition.id, index]));
    let detailWorker = null;
    let detailWorkerUrl = null;
    let detailWorkerDisabled = false;
    let detailJobId = 0;
    const detailJobs = new Map();

    function makeCanvas(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      return canvas;
    }

    function stopDetailWorker(error, disable = true) {
      if (detailWorker) {
        const worker = detailWorker;
        detailWorker = null;
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
      if (detailWorkerUrl) root.URL.revokeObjectURL(detailWorkerUrl);
      detailWorkerUrl = null;
      for (const job of detailJobs.values()) job.reject(error);
      detailJobs.clear();
      if (disable) detailWorkerDisabled = true;
    }

    function cancelDetailWorker() {
      if (!detailWorker || !detailJobs.size) return;
      const error = new Error('Le calcul du relief a été interrompu pendant le déplacement.');
      error.name = 'AbortError';
      stopDetailWorker(error, false);
    }

    function createDetailWorker() {
      if (detailWorker || detailWorkerDisabled || typeof root.Worker !== 'function') return detailWorker;
      try {
        let sourceUrl;
        if (root.OrbitSurfaceTerrainWorkerSource && typeof root.Blob === 'function') {
          detailWorkerUrl = root.URL.createObjectURL(new root.Blob(
            [root.OrbitSurfaceTerrainWorkerSource], { type: 'text/javascript' }));
          sourceUrl = detailWorkerUrl;
        } else if (surfaceRendererScriptUrl) {
          sourceUrl = new URL('../workers/surfaceDetailWorker.js', surfaceRendererScriptUrl).href;
        } else {
          sourceUrl = new URL('src/workers/surfaceDetailWorker.js', root.location.href).href;
        }
        detailWorker = new root.Worker(sourceUrl);
        detailWorker.onmessage = event => {
          const message = event.data || {};
          if (message.type === 'ready') {
            if (detailWorkerUrl) root.URL.revokeObjectURL(detailWorkerUrl);
            detailWorkerUrl = null;
            return;
          }
          const job = detailJobs.get(message.id);
          if (!job) return;
          detailJobs.delete(message.id);
          if (message.error) job.reject(new Error(message.error));
          else job.resolve({ terrain: message.terrain, masks: message.masks });
        };
        detailWorker.onerror = event => stopDetailWorker(new Error(
          event.message || 'Impossible de préparer le relief détaillé en arrière-plan.'));
        return detailWorker;
      } catch (error) {
        detailWorkerDisabled = true;
        if (detailWorkerUrl) root.URL.revokeObjectURL(detailWorkerUrl);
        detailWorkerUrl = null;
        return null;
      }
    }

    function generateSurfaceDetail(planet, seed, width, height, baseTexture, options = {}) {
      const worker = createDetailWorker();
      if (!worker) return Promise.reject(new Error('Le calcul du relief en arrière-plan est indisponible.'));
      return new Promise((resolve, reject) => {
        const id = ++detailJobId;
        detailJobs.set(id, { resolve, reject });
        try { worker.postMessage({ id, seed, width, height, planet }); }
        catch (error) { detailJobs.delete(id); reject(error); }
      }).then(({ terrain, masks }) => {
        const baseCanvas = makeCanvas(terrain.width, terrain.height);
        const baseContext = baseCanvas.getContext('2d');
        baseContext.imageSmoothingEnabled = true;
        // Preserve the already-composed, map-scale biome image as the high-res
        // base. The GPU texture layer is only blended in as the camera zooms in.
        baseContext.drawImage(baseTexture, 0, 0, terrain.width, terrain.height);
        const textureScale = options.textureScale || Config.terrain.textureScale;
        return {
          terrain,
          texture: {
            width: Math.round(terrain.width * textureScale),
            height: Math.round(terrain.height * textureScale),
            logicalWidth: options.logicalWidth || baseTexture.logicalWidth || baseTexture.width,
            logicalHeight: options.logicalHeight || baseTexture.logicalHeight || baseTexture.height,
            baseColorCanvas: baseCanvas,
            materialMasks: masks
          }
        };
      });
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
      const materialIndex = materialIndices[materialId];
      const retainedGroup = record.materialMasks ? record.materialMasks[Math.floor(materialIndex / 3)] : null;
      const retainedChannel = materialIndex % 3;
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
        const alphaByte = Math.round(clamp(alpha, 0, 1) * 255);
        if (retainedGroup) retainedGroup[i * 3 + retainedChannel] = alphaByte;
        pixels.data[pixel] = pixels.data[pixel + 1] = pixels.data[pixel + 2] = 255;
        pixels.data[pixel + 3] = alphaByte;
      }
      maskContext.putImageData(pixels, 0, 0);
      return mask;
    }

    function drawMaterialSample(record, definition, image, sampleCanvas) {
      const scale = record.textureScale || Config.terrain.textureScale;
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
      if (record.materialMasks) record.texture.baseColorCanvas = record.rawCanvas;
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
        materialRenderer.setMaterials(
          materialDefinitions.map(definition => materialImages[definition.id]),
          Config.terrain.materialTextureResolutionScale
        );
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
      terrainTexture.materialMasks = options.retainMaterialMasks
        ? Array.from({ length: 3 }, () => new Uint8Array(width * height * 3)) : null;
      const textureContext = terrainTexture.getContext('2d');
      textureContext.imageSmoothingEnabled = true;
      textureContext.drawImage(rawCanvas, 0, 0, terrainTexture.width, terrainTexture.height);
      const materialRecord = {
        planet, terrain: terrainData, texture: terrainTexture, coastDistance, rawCanvas,
        textureScale, materialMasks: terrainTexture.materialMasks,
        materialsApplied: false, drawDetails: null
      };
      function drawDetails(context) {
        // Contours are traced asynchronously for the visible area and overlaid
        // in screen space. Baking them here would scan every high-resolution
        // terrain cell synchronously and make planet entry stall.
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

    function contourDefinitions() {
      const contourByIndex = new Array(40), contours = [];
      for (let index = 0; index < contourByIndex.length; index += 1) {
        const level = 48 + index * 5;
        const coastline = level === 103;
        if (!coastline && index % 2 !== 0) continue;
        const major = index % 4 === 0;
        const contour = { level, path: new root.Path2D(), major, coastline,
          width: coastline ? 1.05 : major ? .82 : .58 };
        contourByIndex[index] = contour;
        contours.push(contour);
      }
      return { contourByIndex, contours };
    }

    function sameContourRequest(first, second) {
      return first && second && first.kind === second.kind && first.planetId === second.planetId &&
        first.terrain === second.terrain && first.terrainFactor === second.terrainFactor &&
        first.lod === second.lod && first.sampleStride === second.sampleStride &&
        first.minX === second.minX && first.maxX === second.maxX &&
        first.minY === second.minY && first.maxY === second.maxY && first.zoom === second.zoom &&
        first.pixelRatio === second.pixelRatio && first.color === second.color &&
        (first.kind !== 'raster' || (first.cache === second.cache &&
          first.rasterBounds?.x === second.rasterBounds?.x && first.rasterBounds?.y === second.rasterBounds?.y &&
          first.rasterBounds?.width === second.rasterBounds?.width && first.rasterBounds?.height === second.rasterBounds?.height));
    }

    function stopContourJob() {
      if (!detailContourJob) return;
      if (detailContourJob.timer) root.clearTimeout(detailContourJob.timer);
      detailContourJob = null;
    }

    function queueContourJob(job, delay = 0) {
      job.timer = root.setTimeout(() => processContourJob(job), delay);
    }

    function prepareContourRaster(job) {
      const cache = job.cache;
      const cellSize = Config.terrain.textureScale / cache.terrainFactor;
      const padding = 2 / job.zoom;
      const rasterBounds = job.rasterBounds || {
        x: cache.minX * cellSize - padding,
        y: cache.minY * cellSize - padding,
        width: (cache.maxX - cache.minX + cache.sampleStride) * cellSize + padding * 2,
        height: (cache.maxY - cache.minY + cache.sampleStride) * cellSize + padding * 2
      };
      const { x: worldX, y: worldY, width: worldWidth, height: worldHeight } = rasterBounds;
      const rasterWidth = Math.max(1, Math.ceil(worldWidth * job.zoom * job.pixelRatio));
      const rasterHeight = Math.max(1, Math.ceil(worldHeight * job.zoom * job.pixelRatio));
      const createLayer = () => {
        const canvas = makeCanvas(rasterWidth, rasterHeight);
        const context = canvas.getContext('2d');
        context.scale(job.zoom * job.pixelRatio, job.zoom * job.pixelRatio);
        context.translate(-worldX, -worldY);
        context.lineCap = 'round'; context.lineJoin = 'round';
        return { canvas, context };
      };
      const majorLayer = createLayer(), detailLayer = createLayer();
      job.rasterContexts = { major: majorLayer.context, detail: detailLayer.context };
      job.rasterContourIndex = 0;
      job.raster = { major: majorLayer.canvas, detail: detailLayer.canvas, x: worldX, y: worldY,
        width: worldWidth, height: worldHeight, zoom: job.zoom,
        pixelRatio: job.pixelRatio, color: job.color };
      job.phase = 'rasterize';
    }

    function processContourCell(job, x, y) {
      const { width, elevation } = job.terrain;
      const stride = job.sampleStride;
      const cellSize = Config.terrain.textureScale / job.terrainFactor;
      const index = y * width + x;
      const a = elevation[index], b = elevation[index + stride];
      const d = elevation[index + stride * width], e = elevation[index + stride * width + stride];
      const cellMinimum = Math.min(a, b, d, e), cellMaximum = Math.max(a, b, d, e);
      const firstLevel = Math.max(0, Math.ceil((cellMinimum - 48) / 5));
      const lastLevel = Math.min(39, Math.floor((cellMaximum - 48) / 5));
      for (let levelIndex = firstLevel; levelIndex <= lastLevel; levelIndex += 1) {
        const contour = job.contourByIndex[levelIndex];
        if (!contour) continue;
        const level = contour.level, path = contour.path;
        const mask = (a < level ? 1 : 0) | (b < level ? 2 : 0) | (e < level ? 4 : 0) | (d < level ? 8 : 0);
        if (mask === 0 || mask === 15) continue;
        let hasFirst = false, firstX = 0, firstY = 0;
        if ((a < level) !== (b < level)) {
          const px = x + (level - a) / (b - a) * stride, py = y;
          if (hasFirst) { path.moveTo(firstX * cellSize, firstY * cellSize); path.lineTo(px * cellSize, py * cellSize); hasFirst = false; }
          else { firstX = px; firstY = py; hasFirst = true; }
        }
        if ((b < level) !== (e < level)) {
          const px = x + stride, py = y + (level - b) / (e - b) * stride;
          if (hasFirst) { path.moveTo(firstX * cellSize, firstY * cellSize); path.lineTo(px * cellSize, py * cellSize); hasFirst = false; }
          else { firstX = px; firstY = py; hasFirst = true; }
        }
        if ((e < level) !== (d < level)) {
          const px = x + stride - (level - e) / (d - e) * stride, py = y + stride;
          if (hasFirst) { path.moveTo(firstX * cellSize, firstY * cellSize); path.lineTo(px * cellSize, py * cellSize); hasFirst = false; }
          else { firstX = px; firstY = py; hasFirst = true; }
        }
        if ((d < level) !== (a < level)) {
          const px = x, py = y + stride - (level - d) / (a - d) * stride;
          if (hasFirst) { path.moveTo(firstX * cellSize, firstY * cellSize); path.lineTo(px * cellSize, py * cellSize); hasFirst = false; }
          else { firstX = px; firstY = py; hasFirst = true; }
        }
      }
    }

    function strokeContour(job, contour) {
      const context = contour.major || contour.coastline
        ? job.rasterContexts.major : job.rasterContexts.detail;
      context.lineWidth = contour.width / job.zoom;
      context.strokeStyle = job.color || '#ffffff';
      context.stroke(contour.path);
    }

    function processContourJob(job) {
      if (detailContourJob !== job) return;
      job.timer = null;
      if (getState().level !== 'surface') {
        detailContourCache = null;
        stopContourJob();
        return;
      }
      if (job.phase === 'prepare-raster') {
        prepareContourRaster(job);
        queueContourJob(job);
        return;
      }
      const now = () => root.performance?.now?.() || Date.now();
      const interacting = isCameraInteracting && isCameraInteracting();
      // Contours keep rebuilding during a pinch, but each task yields quickly
      // so pointer handling and the rest of the frame stay responsive.
      const stopAt = now() + (interacting ? .8 : 3);
      if (job.phase === 'geometry') {
        const maxX = Math.min(job.maxX, job.terrain.width - 1 - job.sampleStride);
        const maxY = Math.min(job.maxY, job.terrain.height - 1 - job.sampleStride);
        while (job.y <= maxY && now() < stopAt) {
          processContourCell(job, job.x, job.y);
          job.x += job.sampleStride;
          if (job.x > maxX) { job.x = job.minX; job.y += job.sampleStride; }
        }
        if (job.y > maxY) {
          job.phase = 'prepare-raster';
          queueContourJob(job);
          return;
        }
      }
      if (job.phase === 'rasterize') {
        const contours = job.cache.contours;
        while (job.rasterContourIndex < contours.length && now() < stopAt) {
          strokeContour(job, contours[job.rasterContourIndex]);
          job.rasterContourIndex += 1;
        }
        if (job.rasterContourIndex >= contours.length) {
          if (job.kind === 'geometry') {
            job.cache.raster = job.raster;
            detailContourCache = job.cache;
          } else if (detailContourCache === job.cache) job.cache.raster = job.raster;
          detailContourJob = null;
          return;
        }
      }
      queueContourJob(job);
    }

    function scheduleContourBuild(request) {
      const candidate = { ...request, kind: 'geometry' };
      if (sameContourRequest(detailContourJob, candidate)) return;
      const activeBuild = detailContourJob;
      const overlapsActiveBuild = activeBuild?.kind === 'geometry' &&
        activeBuild.planetId === candidate.planetId && activeBuild.terrain === candidate.terrain &&
        activeBuild.terrainFactor === candidate.terrainFactor &&
        candidate.minX <= activeBuild.maxX && candidate.maxX >= activeBuild.minX &&
        candidate.minY <= activeBuild.maxY && candidate.maxY >= activeBuild.minY;
      const cameraInteracting = isCameraInteracting && isCameraInteracting();
      if (overlapsActiveBuild || (cameraInteracting && activeBuild?.kind === 'geometry' &&
          activeBuild.planetId === candidate.planetId && activeBuild.terrain === candidate.terrain)) return;
      stopContourJob();
      const { contourByIndex, contours } = contourDefinitions();
      candidate.contourByIndex = contourByIndex;
      candidate.cache = { planetId: request.planetId, terrain: request.terrain,
        terrainFactor: request.terrainFactor, subdivision: 1, minX: request.minX,
        maxX: request.maxX, minY: request.minY, maxY: request.maxY,
        lod: request.lod, sampleStride: request.sampleStride, contours, raster: null };
      candidate.x = candidate.minX; candidate.y = candidate.minY; candidate.phase = 'geometry';
      detailContourJob = candidate;
      lastContourBuildAt = root.performance?.now?.() || Date.now();
      queueContourJob(candidate);
    }

    function scheduleContourRaster(cache, zoom, pixelRatio, color, rasterBounds) {
      const candidate = { kind: 'raster', planetId: cache.planetId, terrain: cache.terrain,
        terrainFactor: cache.terrainFactor, lod: cache.lod, minX: cache.minX,
        maxX: cache.maxX, minY: cache.minY, maxY: cache.maxY,
        cache, zoom, pixelRatio, color, rasterBounds };
      if (sameContourRequest(detailContourJob, candidate)) return;
      // Finish an in-flight geometry build first; it will replace this cache.
      if (detailContourJob?.kind === 'geometry') return;
      if (detailContourJob?.kind === 'raster' && detailContourJob.cache === cache) return;
      stopContourJob();
      candidate.phase = 'prepare-raster'; candidate.rasterContourIndex = 0;
      detailContourJob = candidate;
      lastContourBuildAt = root.performance?.now?.() || Date.now();
      queueContourJob(candidate);
    }

    function drawDetailContours(frame) {
      const terrain = frame.detailTerrain || frame.terrain;
      if (!terrain) {
        if (getState().level !== 'surface') { detailContourCache = null; stopContourJob(); }
        return;
      }
      if (typeof root.Path2D !== 'function') return;
      const contourLod = 'detail';
      const { width, height } = terrain;
      const viewport = frame.viewport, top = frame.project(0, 0);
      const terrainFactor = frame.detailTerrain ? frame.detailTerrainFactor || Config.terrain.renderDetailFactor : 1;
      const sampleStride = Math.min(terrainFactor, 2);
      const cellSize = Config.terrain.textureScale / terrainFactor;
      const visibleMinX = clamp(Math.floor((-top.x / frame.zoom) / cellSize), 0, width - 2);
      const visibleMaxX = clamp(Math.ceil(((viewport.width - top.x) / frame.zoom) / cellSize), 0, width - 2);
      const visibleMinY = clamp(Math.floor((-top.y / frame.zoom) / cellSize), 0, height - 2);
      const visibleMaxY = clamp(Math.ceil(((viewport.height - top.y) / frame.zoom) / cellSize), 0, height - 2);
      // Keep untraced terrain around the view so ordinary pans reuse this cache.
      const marginX = Math.max(2, Math.ceil((visibleMaxX - visibleMinX + 1) * .12));
      const marginY = Math.max(2, Math.ceil((visibleMaxY - visibleMinY + 1) * .12));
      const maxCellX = width - 1 - sampleStride, maxCellY = height - 1 - sampleStride;
      const minX = clamp(Math.floor((visibleMinX - marginX) / sampleStride) * sampleStride, 0, maxCellX);
      const maxX = clamp(Math.ceil((visibleMaxX + marginX) / sampleStride) * sampleStride, minX, maxCellX);
      const minY = clamp(Math.floor((visibleMinY - marginY) / sampleStride) * sampleStride, 0, maxCellY);
      const maxY = clamp(Math.ceil((visibleMaxY + marginY) / sampleStride) * sampleStride, minY, maxCellY);
      const coversViewport = detailContourCache?.planetId === frame.planet.id &&
        detailContourCache.lod === contourLod && detailContourCache.terrainFactor === terrainFactor &&
        detailContourCache.sampleStride === sampleStride &&
        detailContourCache.terrain === terrain && visibleMinX >= detailContourCache.minX &&
        visibleMaxX <= detailContourCache.maxX + detailContourCache.sampleStride &&
        visibleMinY >= detailContourCache.minY &&
        visibleMaxY <= detailContourCache.maxY + detailContourCache.sampleStride;
      const cameraInteracting = isCameraInteracting && isCameraInteracting();
      const developerSettings = root.OrbitDeveloperSettings;
      const contourColor = developerSettings?.get('overviewContourColor') || '#ffffff';
      const contourOpacity = clamp(Number(developerSettings?.get('overviewContourOpacity') ?? 67) / 100, 0, 1);
      const pixelRatio = canvasContext.canvas.width / viewport.width;
      const now = root.performance?.now?.() || Date.now();
      const canRefreshDuringGesture = !cameraInteracting || now - lastContourBuildAt >= 100;
      if (!coversViewport && canRefreshDuringGesture) {
        scheduleContourBuild({ planetId: frame.planet.id, terrain, terrainFactor,
          lod: contourLod, sampleStride, minX, maxX, minY, maxY,
          zoom: frame.zoom, pixelRatio, color: contourColor });
      }
      if (!detailContourCache || detailContourCache.planetId !== frame.planet.id ||
          detailContourCache.terrain !== terrain || !detailContourCache.raster) return;
      if (contourOpacity === 0) return;
      const rasterColor = contourColor;
      const raster = detailContourCache.raster;
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
      const rasterNeedsRefresh = raster.color !== rasterColor || raster.pixelRatio !== pixelRatio ||
        Math.abs(Math.log(frame.zoom / raster.zoom)) > .08 ||
        Math.abs((raster.x + raster.width / 2) - (rasterBounds.x + rasterBounds.width / 2)) > rasterBounds.width * .08 ||
        Math.abs((raster.y + raster.height / 2) - (rasterBounds.y + rasterBounds.height / 2)) > rasterBounds.height * .08;
      if (coversViewport && rasterNeedsRefresh && canRefreshDuringGesture && detailContourJob?.kind !== 'geometry') {
        scheduleContourRaster(detailContourCache, frame.zoom, pixelRatio, rasterColor, rasterBounds);
      }
      canvasContext.save();
      canvasContext.globalAlpha = contourOpacity;
      canvasContext.translate(top.x, top.y);
      canvasContext.scale(frame.zoom, frame.zoom);
      canvasContext.drawImage(raster.major, raster.x, raster.y, raster.width, raster.height);
      const detailMix = ease(clamp((frame.zoom - .4) / 1.4, 0, 1));
      if (detailMix > .001) {
        canvasContext.globalAlpha = contourOpacity * detailMix;
        canvasContext.drawImage(raster.detail, raster.x, raster.y, raster.width, raster.height);
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

    function makeSurfaceFrame(cam, planet, record, planetPreview = false) {
      const state = getState();
      const activeSurface = state.level === 'surface' && state.planet?.id === planet.id;
      const retainedPreview = planetPreview && state.level === 'system' &&
        state.planet?.id === planet.id && state.focusPlanet?.id === planet.id;
      const useSurfaceDetail = Boolean((activeSurface || retainedPreview) &&
        record.detailTerrain && record.detailTexture);
      const terrainTexture = useSurfaceDetail ? record.detailTexture : record.texture;
      return {
        context: canvasContext,
        camera: cam,
        zoom: cam.zoom,
        planet,
        terrain: record.data,
        terrainTexture,
        detailTerrain: useSurfaceDetail ? (record.detailTerrain || record.data) : null,
        detailTerrainFactor: record.detailTerrain ? Config.terrain.renderDetailFactor : 1,
        fallbackTexture: record.texture,
        surfaceDetail: useSurfaceDetail,
        terrainWidth: record.texture.logicalWidth || record.texture.width,
        terrainHeight: record.texture.logicalHeight || record.texture.height,
        state,
        viewport: getViewport(),
        now: dependencies.getNow(),
        project: (x, y) => project(x, y, cam)
      };
    }

    function drawTerrain(frame, drawContours = true) {
      const { terrainTexture, terrainWidth, terrainHeight } = frame, top = frame.project(0, 0);
      const width = terrainWidth * frame.zoom, height = terrainHeight * frame.zoom;
      canvasContext.imageSmoothingEnabled = true;
      const pixelRatio = canvasContext.canvas.width / frame.viewport.width;
      // Keep material coordinates fixed in world space so texture features do
      // not slide or rescale as the camera zooms.
      const maxDetailMultiplier = Math.max(1, Config.terrain.materialTextureMaxDetailMultiplier);
      const deviceDetailLimit = Math.min(maxDetailMultiplier, Math.max(1, pixelRatio));
      const materialTextureDensity = Config.terrain.materialTexturePixelsPerKm * deviceDetailLimit;
      const blendStart = Config.terrain.materialTextureDetailBlendStartZoom;
      const blendEnd = Math.max(blendStart + .001, Config.terrain.materialTextureDetailBlendEndZoom);
      const detailBlend = ease(clamp((frame.zoom - blendStart) / (blendEnd - blendStart), 0, 1)) *
        Config.terrain.materialTextureMaxBlend;
      const gpuRendered = frame.surfaceDetail &&
        materialRenderer.draw({
          detailTexture: terrainTexture,
          baseCanvas: terrainTexture.baseColorCanvas,
          materialMasks: terrainTexture.materialMasks,
          viewport: frame.viewport,
          pixelRatio,
          top,
          zoom: frame.zoom,
          mapSize: { width: terrainWidth, height: terrainHeight },
          tileWorldSize: (materialImages[materialDefinitions[0].id]?.naturalWidth || 1254) /
            materialTextureDensity * Config.terrain.materialTextureTileScale,
          detailBlend,
          seed: World.hashSeed(String(frame.planet.seed) + ':stochastic-materials:v1')
        });
      if (gpuRendered) {
        // Keep the small base masks for instant re-entry; free the larger detail set.
        if (terrainTexture !== frame.fallbackTexture) terrainTexture.materialMasks = null;
        canvasContext.drawImage(materialRenderer.canvas, 0, 0, frame.viewport.width, frame.viewport.height);
      } else {
        canvasContext.drawImage(frame.fallbackTexture || terrainTexture, top.x, top.y, width, height);
      }
      if (frame.zoom > SurfaceStyle.lod.surfaceGridZoom) drawSurfaceGrid(frame.camera);
      if (drawContours) drawDetailContours(frame);
      else if (getState().level !== 'surface') { detailContourCache = null; stopContourJob(); }
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
      dependencies.drawLabel(canvasContext, frame.planet.name.toUpperCase() + ' / RELEVÉ TOPOGRAPHIQUE',
        top.x + 15, bottom.y - 16, '#c3c9b1', SurfaceStyle.labels.siteDetailSizePx);
    }

    function drawSurface(cam, planet, record, planetPreview = false) {
      const frame = makeSurfaceFrame(cam, planet, record, planetPreview);
      drawTerrain(frame, !planetPreview);
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

    function drawPlanetTerrain(planet, context, center, radius, planetPreview = false) {
      const record = context.terrains.get(planet.id);
      if (!record) return;
      const frame = surfaceFrame(planet, context), style = SurfaceStyle.terrain;
      const open = ease(clamp((radius - style.globeRevealStartRadiusPx) /
        (style.globeRevealEndRadiusPx - style.globeRevealStartRadiusPx), 0, 1));
      const width = radius * 2 * (1 + open * style.mapExpansionRatio), height = radius * 2;
      canvasContext.save(); canvasContext.beginPath();
      canvasContext.roundRect(center.x - width / 2, center.y - height / 2, width, height, Math.max(0, radius * (1 - open)));
      canvasContext.clip();
      drawSurface(localCamera(frame), planet, record, planetPreview);
      canvasContext.restore();
    }

    return Object.freeze({
      createTerrainTexture,
      createSurfaceDetail: generateSurfaceDetail,
      cancelSurfaceDetail: cancelDetailWorker,
      getResourceRenderStyle,
      drawPlanetTerrain,
      releaseDetail: () => materialRenderer.release()
    });
  }

  root.OrbitSurfaceRenderer = Object.freeze({ create });
})(globalThis);
