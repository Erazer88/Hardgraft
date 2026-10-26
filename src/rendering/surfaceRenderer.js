(function (root) {
  'use strict';

  const World = root.OrbitWorld, Config = root.OrbitConfig;
  const SurfaceStyle = root.OrbitSurfaceStyle;
  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const ease = t => t * t * (3 - 2 * t);
  const smoothstep = t => ease(clamp(t, 0, 1));
  const coastClock = () => root.performance?.now ? root.performance.now() : Date.now();

  function hexRGB(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function mixRGB(first, second, amount) {
    return first.map((channel, index) => channel + (second[index] - channel) * amount);
  }

  // Contour levels sit between integer heights, so flat ground never lies on a line.
  function reliefLevels(seaLevel, step) {
    const base = seaLevel + .5, levels = [];
    for (let level = base + step; level < 255; level += step) levels.push(level);
    return { base, levels };
  }

  // Corner cutting turns the cell-to-cell steps of a river into a smooth
  // course, then a gentle sideways wave adds meanders. Ends stay in place so
  // confluences and mouths still meet.
  function smoothCourse(points, flows, water) {
    let xs = [], ys = [], fs = [];
    for (let i = 0; i < points.length; i += 2) { xs.push(points[i]); ys.push(points[i + 1]); fs.push(flows[i / 2]); }
    const length = xs.length, phase = (points[0] * 12.9898 + points[1] * 78.233) % (Math.PI * 2);
    for (let i = 1; i + 1 < length; i += 1) {
      const dx = xs[i + 1] - xs[i - 1], dy = ys[i + 1] - ys[i - 1], norm = Math.hypot(dx, dy) || 1;
      const taper = Math.min(1, i / 3, (length - 1 - i) / 3);
      const wave = Math.sin(i / water.meanderWavelength * Math.PI * 2 + phase) * .7 +
        Math.sin(i / water.meanderWavelength * Math.PI * 4.7 + phase * 1.7) * .3;
      xs[i] += -dy / norm * wave * water.meanderAmplitude * taper;
      ys[i] += dx / norm * wave * water.meanderAmplitude * taper;
    }
    for (let pass = 0; pass < 2; pass += 1) {
      const nx = [xs[0]], ny = [ys[0]], nf = [fs[0]];
      for (let i = 0; i + 1 < xs.length; i += 1) {
        nx.push(xs[i] * .75 + xs[i + 1] * .25, xs[i] * .25 + xs[i + 1] * .75);
        ny.push(ys[i] * .75 + ys[i + 1] * .25, ys[i] * .25 + ys[i + 1] * .75);
        nf.push(fs[i], fs[i + 1]);
      }
      nx.push(xs.at(-1)); ny.push(ys.at(-1)); nf.push(fs.at(-1));
      xs = nx; ys = ny; fs = nf;
    }
    return { xs, ys, fs };
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

    // Ground materials as sparse glowing dots, one candidate per terrain cell,
    // colored by the dominant material. The richer the cell, the likelier and
    // brighter its dot. Positions are deterministic so every view agrees.
    const materialDotCache = new WeakMap();
    function materialDots(terrain) {
      if (materialDotCache.has(terrain)) return materialDotCache.get(terrain);
      const style = SurfaceStyle.neon.materials, materials = terrain.materials;
      const xs = [], ys = [], kinds = [], strengths = [];
      if (materials) {
        const count = materials.ids.length, shares = materials.shares;
        for (let cell = 0; cell < terrain.width * terrain.height; cell += 1) {
          let kind = 0, best = 0;
          for (let index = 0; index < count; index += 1) {
            if (shares[cell * count + index] > best) { best = shares[cell * count + index]; kind = index; }
          }
          const strength = smoothstep((best / 255 - style.minShare) / (style.fullShare - style.minShare));
          if (strength <= 0) continue;
          let hash = Math.imul(cell ^ 0x9e3779b9, 0x85ebca6b);
          hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35); hash ^= hash >>> 16;
          if ((hash >>> 0) / 4294967296 >= strength * style.density) continue;
          const jitter = Math.imul(hash, 0x27d4eb2d);
          const x = cell % terrain.width, y = (cell - x) / terrain.width;
          xs.push(x + ((jitter & 0xffff) / 65536 - .5) * .9);
          ys.push(y + ((jitter >>> 16) / 65536 - .5) * .9);
          kinds.push(kind); strengths.push(strength);
        }
      }
      const colors = (materials?.ids || []).map(id => style.colors[id] || '#ffffff');
      const dots = { xs: Float32Array.from(xs), ys: Float32Array.from(ys), kinds: Uint8Array.from(kinds),
        strengths: Float32Array.from(strengths), colors };
      materialDotCache.set(terrain, dots);
      return dots;
    }

    // Draws the dots whose cell positions fall in `bounds` (cell units), with a
    // faint halo under a bright core; sizes are in the context's units.
    function drawMaterialDots(context, terrain, scale, coreSize, haloSize, bounds = null, alpha = 1) {
      const style = SurfaceStyle.neon.materials, dots = materialDots(terrain);
      context.save();
      context.globalCompositeOperation = 'lighter';
      for (let pass = 0; pass < 2; pass += 1) {
        const size = pass ? coreSize : haloSize;
        for (let i = 0; i < dots.xs.length; i += 1) {
          const x = dots.xs[i], y = dots.ys[i];
          if (bounds && (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY)) continue;
          context.globalAlpha = alpha * (pass ? style.coreOpacity : style.haloOpacity) * (.45 + .55 * dots.strengths[i]);
          context.fillStyle = dots.colors[dots.kinds[i]];
          context.fillRect(x * scale - size / 2, y * scale - size / 2, size, size);
        }
      }
      context.restore();
    }

    function materialsVisible() {
      return root.OrbitDeveloperSettings?.get('showGroundMaterials') !== false;
    }

    // Overview dots crossfade into the screen-space dots of the close-up raster.
    function closeUpDotsAlpha(zoom) {
      const [start, end] = SurfaceStyle.neon.materials.closeUpZoom;
      return smoothstep((zoom - start) / (end - start));
    }

    function riverWidthKm(flow) {
      const water = SurfaceStyle.neon.water;
      return clamp(water.riverMinWidthKm + water.riverWidthPerFlowKm * Math.log2(1 + flow),
        water.riverMinWidthKm, water.riverMaxWidthKm);
    }

    // River courses in world units, grouped by width: one Path2D per width so
    // the texture and the close-up overlay stroke the same smooth geometry.
    const riverGeometry = new WeakMap();
    function riverPaths(terrain) {
      if (riverGeometry.has(terrain)) return riverGeometry.get(terrain);
      const cellSize = Config.terrain.textureScale, groups = new Map();
      for (const river of terrain.rivers || []) {
        const { xs, ys, fs } = smoothCourse(river.points, river.flows, SurfaceStyle.neon.water);
        // A course that ends in a sea or lake cell stops on the shore, halfway
        // between its last land cell and the water, where the coastline runs.
        const last = river.points.length - 2;
        if (last >= 2 && terrain.elevation[river.points[last + 1] * terrain.width + river.points[last]] <= terrain.seaLevel) {
          xs[xs.length - 1] = (river.points[last] + river.points[last - 2]) / 2;
          ys[ys.length - 1] = (river.points[last + 1] + river.points[last - 1]) / 2;
        }
        for (let i = 0; i + 1 < xs.length; i += 1) {
          const width = Math.round(riverWidthKm((fs[i] + fs[i + 1]) / 2) * 2) / 2;
          if (!groups.has(width)) groups.set(width, new root.Path2D());
          const path = groups.get(width);
          path.moveTo(xs[i] * cellSize, ys[i] * cellSize);
          path.lineTo(xs[i + 1] * cellSize, ys[i + 1] * cellSize);
        }
      }
      const paths = [...groups.entries()].sort((first, second) => first[0] - second[0])
        .map(([width, path]) => ({ width, path }));
      riverGeometry.set(terrain, paths);
      return paths;
    }

    function strokeRivers(context, terrain, pixelSize) {
      if (typeof root.Path2D !== 'function') return;
      const water = SurfaceStyle.neon.water, paths = riverPaths(terrain);
      context.save();
      context.lineCap = 'round'; context.lineJoin = 'round';
      context.strokeStyle = rgba(water.riverEdgeColor, water.riverEdgeOpacity);
      for (const { width, path } of paths) { context.lineWidth = width + water.riverEdgePx * pixelSize; context.stroke(path); }
      context.strokeStyle = water.riverColor;
      for (const { width, path } of paths) { context.lineWidth = width; context.stroke(path); }
      context.restore();
    }

    // Hypsometric land layer: each texel samples the relief bilinearly (cell
    // values sit on multiples of the layer scale, as for the contours), takes
    // its stratum tint and draws antialiased contour lines at the limits. It is
    // computed at `layerScale` texels per cell and smoothed when drawn: close
    // up, the vector contours take over.
    function createReliefLayer(planet, terrainData, layerScale) {
      const style = SurfaceStyle.neon.relief, marsh = SurfaceStyle.neon.marsh, features = World.TERRAIN_FEATURES;
      const { width, height, seaLevel } = terrainData;
      const relief = terrainData.relief || terrainData.elevation, cellFeatures = terrainData.features;
      const { base } = reliefLevels(seaLevel, style.bandStep), step = style.bandStep;
      const bandCount = Math.ceil((255 - base) / step) + 1, stops = style.colors.map(hexRGB);
      const bands = Array.from({ length: bandCount }, (_, band) => {
        const position = band / Math.max(1, bandCount - 1) * (stops.length - 1);
        const index = Math.min(stops.length - 2, Math.floor(position));
        return mixRGB(stops[index], stops[index + 1], position - index);
      });
      // Low-amplitude pigment variation keeps each stratum from looking printed.
      const pigment = new Float32Array(width * height);
      const seed = World.hashSeed(String(planet.seed) + ':neon-pigment:v1');
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const u = x / height, v = y / height;
        pigment[y * width + x] = (valueNoise(u * 3 + 2.1, v * 3 - 6.4, seed) - .5) * 1.4 +
          (valueNoise(u * 10.5 - 9.2, v * 10.5 + 3.7, seed ^ 0x9e3779b9) - .5) * .6;
      }
      const line = hexRGB(style.lineColor), marshTint = hexRGB(marsh.tint), marshMark = hexRGB(marsh.mark);
      const marshField = cellFeatures ? Uint8Array.from(cellFeatures, feature => feature === features.marsh ? 1 : 0) : null;
      // Per-cell slope from central differences, interpolated per texel: the
      // shading stays smooth instead of showing the cell grid.
      const slope = new Float32Array(width * height);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const left = relief[y * width + Math.max(0, x - 1)], right = relief[y * width + Math.min(width - 1, x + 1)];
        const up = relief[Math.max(0, y - 1) * width + x], down = relief[Math.min(height - 1, y + 1) * width + x];
        slope[y * width + x] = Math.hypot(right - left, down - up) * .5;
      }
      const layerWidth = width * layerScale, layerHeight = height * layerScale, textureScale = layerScale;
      const layer = makeCanvas(layerWidth, layerHeight), context = layer.getContext('2d');
      const image = context.createImageData(layerWidth, layerHeight), pixels = image.data;
      for (let ty = 0; ty < layerHeight; ty += 1) {
        const fy = Math.min(height - 1, (ty + .5) / textureScale);
        const y0 = Math.min(height - 2, Math.floor(fy)), sy = fy - y0;
        for (let tx = 0; tx < layerWidth; tx += 1) {
          const fx = Math.min(width - 1, (tx + .5) / textureScale);
          const x0 = Math.min(width - 2, Math.floor(fx)), sx = fx - x0;
          const i00 = y0 * width + x0, i10 = i00 + 1, i01 = i00 + width, i11 = i01 + 1;
          const top = relief[i00] + (relief[i10] - relief[i00]) * sx;
          const bottom = relief[i01] + (relief[i11] - relief[i01]) * sx;
          const value = top + (bottom - top) * sy;
          const gx = ((relief[i10] - relief[i00]) * (1 - sy) + (relief[i11] - relief[i01]) * sy) / textureScale;
          const gy = (bottom - top) / textureScale;
          const strata = (value - base) / step;
          const band = bands[clamp(Math.floor(strata) + 1, 0, bandCount - 1)];
          const topSlope = slope[i00] + (slope[i10] - slope[i00]) * sx;
          const slopeHere = topSlope + (slope[i01] + (slope[i11] - slope[i01]) * sx - topSlope) * sy;
          const light = (1 + (pigment[i00] + (pigment[i10] - pigment[i00]) * sx) * style.pigment) *
            (1 - style.slopeShade * smoothstep(slopeHere / style.slopeShadeFull));
          let red = band[0] * light, green = band[1] * light, blue = band[2] * light;
          if (marshField) {
            // Marsh cells blend bilinearly into soft patches with a map symbol:
            // short horizontal tufts in staggered rows.
            const topMarsh = marshField[i00] + (marshField[i10] - marshField[i00]) * sx;
            const marshAmount = smoothstep(((topMarsh + (marshField[i01] + (marshField[i11] - marshField[i01]) * sx - topMarsh) * sy) - .3) / .4);
            if (marshAmount > 0) {
              const amount = marsh.tintOpacity * marshAmount;
              red += (marshTint[0] - red) * amount; green += (marshTint[1] - green) * amount; blue += (marshTint[2] - blue) * amount;
              if (marshAmount > .5 && ty % 6 === 0 && (tx + Math.floor(ty / 6) * 4) % 9 < 5) {
                red += (marshMark[0] - red) * marsh.markOpacity; green += (marshMark[1] - green) * marsh.markOpacity;
                blue += (marshMark[2] - blue) * marsh.markOpacity;
              }
            }
          }
          const nearest = Math.round(strata);
          if (nearest >= 1) {
            const distance = Math.abs(value - (base + nearest * step)) / Math.max(.08, Math.hypot(gx, gy));
            const coverage = clamp(1.1 - distance / .75, 0, 1);
            if (coverage > 0) {
              const amount = coverage * (nearest % style.majorEvery === 0 ? style.majorLineOpacity : style.lineOpacity);
              red += (line[0] - red) * amount; green += (line[1] - green) * amount; blue += (line[2] - blue) * amount;
            }
          }
          const pixel = (ty * layerWidth + tx) * 4;
          pixels[pixel] = red; pixels[pixel + 1] = green; pixels[pixel + 2] = blue; pixels[pixel + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0);
      return layer;
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

      // Lakes and coves are holes in the land mask: give them their water tone.
      const cellFeatures = terrainData.features, features = World.TERRAIN_FEATURES;
      if (cellFeatures) {
        context.fillStyle = style.water.lakeColor;
        for (let i = 0; i < cellFeatures.length; i += 1) {
          if (cellFeatures[i] !== features.lake) continue;
          const x = i % terrainData.width, y = (i - x) / terrainData.width;
          context.fillRect((x - .6) * textureScale, (y - .6) * textureScale, textureScale * 1.2, textureScale * 1.2);
        }
      }
      const reliefLayer = createReliefLayer(planet, terrainData, style.relief.layerScale);
      layerContext.globalCompositeOperation = 'copy';
      layerContext.imageSmoothingEnabled = true;
      layerContext.drawImage(reliefLayer, 0, 0, textureWidth, textureHeight);
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
      // Rivers come last: at a mouth their water opens the shoreline.
      strokeRivers(context, terrainData, textureWidth / SurfaceStyle.neon.glowReferenceWidthPx);
      // Material dots live on their own layer so they can be hidden or faded out close up.
      const dotStyle = style.materials, dotScale = dotStyle.layerScale;
      const materialLayer = makeCanvas(terrainData.width * dotScale, terrainData.height * dotScale);
      drawMaterialDots(materialLayer.getContext('2d'), terrainData, dotScale, dotStyle.coreTexels, dotStyle.haloTexels);
      terrainTexture.materialLayer = materialLayer;
      for (const canvas of [mask, edge, layer, reliefLayer]) { canvas.width = 0; canvas.height = 0; }
      return terrainTexture;
    }

    // The baked texture shows coast, contours and rivers at map scale. On the
    // active surface, the shoreline and contour lines are also traced as
    // vectors for the visible area, a few milliseconds at a time, then
    // rasterized with the rivers at screen resolution.
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

    // Marching squares for one level over the cell whose top-left corner is (x, y).
    function traceLevel(path, level, a, b, d, e, x, y, cellSize) {
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

    function traceContourCell(job, x, y) {
      // The shore sits halfway between the last water cell and the first land
      // cell, like the baked land mask; contour lines follow the relief, where
      // lakes keep their surface height.
      const { width, elevation, seaLevel } = job.terrain;
      const relief = job.terrain.relief || elevation, cache = job.cache, cellSize = Config.terrain.textureScale;
      const index = y * width + x;
      traceLevel(cache.path, seaLevel + .5, elevation[index], elevation[index + 1],
        elevation[index + width], elevation[index + width + 1], x, y, cellSize);
      const a = relief[index], b = relief[index + 1], d = relief[index + width], e = relief[index + width + 1];
      const low = Math.min(a, b, d, e), high = Math.max(a, b, d, e), step = SurfaceStyle.neon.relief.bandStep;
      const first = Math.max(1, Math.ceil((low - cache.levelBase) / step));
      const last = Math.min(cache.levelPaths.length, Math.floor((high - cache.levelBase) / step));
      for (let level = first; level <= last; level += 1) {
        traceLevel(cache.levelPaths[level - 1], cache.levelBase + level * step, a, b, d, e, x, y, cellSize);
      }
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
      // Contour lines first, every majorEvery-th one stronger, then rivers.
      const reliefStyle = SurfaceStyle.neon.relief;
      for (const [index, path] of cache.levelPaths.entries()) {
        const major = (index + 1) % reliefStyle.majorEvery === 0;
        context.lineWidth = (major ? reliefStyle.majorLineWidthPx : reliefStyle.lineWidthPx) / job.zoom;
        context.strokeStyle = rgba(reliefStyle.lineColor, major ? reliefStyle.majorLineOpacity : reliefStyle.lineOpacity);
        context.stroke(path);
      }
      const closeDots = materialsVisible() ? closeUpDotsAlpha(job.zoom) : 0;
      if (closeDots > .001) {
        const dotStyle = SurfaceStyle.neon.materials, margin = 2;
        drawMaterialDots(context, job.terrain, cellSize, dotStyle.corePx / job.zoom, dotStyle.haloPx / job.zoom, {
          minX: bounds.x / cellSize - margin, maxX: (bounds.x + bounds.width) / cellSize + margin,
          minY: bounds.y / cellSize - margin, maxY: (bounds.y + bounds.height) / cellSize + margin }, closeDots);
      }
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
      strokeRivers(context, job.terrain, 1 / job.zoom);
      job.raster = { canvas, ...bounds, zoom: job.zoom, pixelRatio: job.pixelRatio, materials: materialsVisible() };
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
          traceContourCell(job, job.x, job.y);
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
        path: new root.Path2D(), raster: null,
        levelBase: reliefLevels(request.terrain.seaLevel, SurfaceStyle.neon.relief.bandStep).base,
        levelPaths: reliefLevels(request.terrain.seaLevel, SurfaceStyle.neon.relief.bandStep).levels.map(() => new root.Path2D()) };
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
      const rasterNeedsRefresh = raster.pixelRatio !== pixelRatio || raster.materials !== materialsVisible() ||
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
      const overviewDots = materialsVisible() && terrainTexture.materialLayer ? 1 - closeUpDotsAlpha(frame.zoom) : 0;
      if (overviewDots > .001) {
        canvasContext.save();
        canvasContext.globalAlpha = overviewDots;
        canvasContext.globalCompositeOperation = 'screen';
        canvasContext.drawImage(terrainTexture.materialLayer, top.x, top.y, terrainWidth * frame.zoom, terrainHeight * frame.zoom);
        canvasContext.restore();
      }
      if (frame.zoom > SurfaceStyle.lod.surfaceGridZoom) drawSurfaceGrid(frame.camera);
      if (drawCoast) drawCoastline(frame);
      else if (getState().level !== 'surface') { coastCache = null; stopCoastJob(); }
      const bottom = frame.project(terrainWidth, terrainHeight);
      canvasContext.strokeStyle = SurfaceStyle.terrain.edgeColor;
      canvasContext.lineWidth = SurfaceStyle.terrain.edgeWidthPx;
      canvasContext.strokeRect(top.x, top.y, bottom.x - top.x, bottom.y - top.y);
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
      drawPlanetTerrain
    });
  }

  root.OrbitSurfaceRenderer = Object.freeze({ create });
})(globalThis);
