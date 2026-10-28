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

    // Signed shore field per cell, positive on land: the raw sea/land sign
    // blended with its blur, so the traced shore rounds the cell staircase off
    // while single-cell islets and inlets still show. Mask and coast line share it.
    const shoreFieldCache = new WeakMap();
    function shoreField(terrain) {
      if (shoreFieldCache.has(terrain)) return shoreFieldCache.get(terrain);
      const { width, height, elevation, seaLevel } = terrain, smoothing = SurfaceStyle.neon.shoreSmoothing;
      const raw = new Float32Array(width * height), blurred = new Float32Array(width * height);
      for (let i = 0; i < raw.length; i += 1) raw[i] = clamp(elevation[i] - seaLevel - .5, -1, 1);
      const at = (x, y) => raw[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        blurred[y * width + x] = (4 * at(x, y) + 2 * (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) +
          at(x - 1, y - 1) + at(x + 1, y - 1) + at(x - 1, y + 1) + at(x + 1, y + 1)) / 16;
      }
      for (let i = 0; i < raw.length; i += 1) blurred[i] = raw[i] + (blurred[i] - raw[i]) * smoothing;
      shoreFieldCache.set(terrain, blurred);
      return blurred;
    }

    function createNeonCoast(terrainData, textureWidth, textureHeight, textureScale, coastColor) {
      // Upscale a signed sea-level field with bilinear smoothing. Dividing by
      // its local gradient estimates the distance to the shore in texels, which
      // gives an antialiased land mask and a smooth coast line that follow the
      // same interpolated shoreline as the contours, not the terrain cells.
      const { width, height } = terrainData, shore = shoreField(terrainData);
      const field = makeCanvas(width + 1, height + 1), fieldContext = field.getContext('2d');
      const fieldImage = fieldContext.createImageData(width + 1, height + 1);
      for (let y = 0; y <= height; y += 1) for (let x = 0; x <= width; x += 1) {
        const value = shore[Math.min(y, height - 1) * width + Math.min(x, width - 1)];
        const pixel = (y * (width + 1) + x) * 4;
        const signed = clamp(Math.round(128 + value * 64), 0, 255);
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

    function isMarineMaterial(id) {
      return Boolean(root.OrbitWorldgenData?.terrain?.materials?.list?.find(material => material.id === id)?.marine);
    }

    // Ground materials as a grade map, baked in two layers: flat tints between
    // the grade levels (always shown) and their isolines (overview only; close
    // up they are traced as vectors). Shares are sampled bilinearly, like the
    // vector isolines, and both tints and lines are antialiased on the field.
    function createMaterialLayers(terrainData) {
      const style = SurfaceStyle.neon.materials, scale = style.layerScale, materials = terrainData.materials;
      const { width, height } = terrainData, layerWidth = width * scale, layerHeight = height * scale;
      const fill = makeCanvas(layerWidth, layerHeight), lines = makeCanvas(layerWidth, layerHeight);
      if (!materials) return { fill, lines };
      const fillContext = fill.getContext('2d'), lineContext = lines.getContext('2d');
      const fillImage = fillContext.createImageData(layerWidth, layerHeight), lineImage = lineContext.createImageData(layerWidth, layerHeight);
      const kinds = materials.ids.length, shares = materials.shares, levels = style.levels, lowest = levels[0] * 255;
      const colors = materials.ids.map(id => hexRGB(style.colors[id] || '#ffffff'));
      const halos = materials.ids.map(id => style.lineHalo?.[id] ? hexRGB(style.lineHalo[id]) : null);
      const strength = materials.ids.map(id => isMarineMaterial(id) ? style.marineOpacity : 1);
      // Composites a color over a pixel with straight alpha.
      const over = (pixels, pixel, color, alpha) => {
        if (alpha <= 0) return;
        const below = pixels[pixel + 3] / 255, out = alpha + below * (1 - alpha);
        for (let channel = 0; channel < 3; channel++) {
          pixels[pixel + channel] = (color[channel] * alpha + pixels[pixel + channel] * below * (1 - alpha)) / out;
        }
        pixels[pixel + 3] = out * 255;
      };
      for (let ty = 0; ty < layerHeight; ty++) {
        const fy = Math.min(height - 1, (ty + .5) / scale), y0 = Math.min(height - 2, Math.floor(fy)), sy = fy - y0;
        for (let tx = 0; tx < layerWidth; tx++) {
          const fx = Math.min(width - 1, (tx + .5) / scale), x0 = Math.min(width - 2, Math.floor(fx)), sx = fx - x0;
          const i00 = y0 * width + x0, i10 = i00 + 1, i01 = i00 + width, i11 = i01 + 1, pixel = (ty * layerWidth + tx) * 4;
          for (let kind = 0; kind < kinds; kind++) {
            const a = shares[i00 * kinds + kind], b = shares[i10 * kinds + kind];
            const c = shares[i01 * kinds + kind], d = shares[i11 * kinds + kind];
            if (Math.max(a, b, c, d) < lowest * .8) continue;
            const top = a + (b - a) * sx, bottom = c + (d - c) * sx, value = (top + (bottom - top) * sy) / 255;
            const gx = ((b - a) * (1 - sy) + (d - c) * sy) / 255 / scale, gy = (bottom - top) / 255 / scale;
            const gradient = Math.max(1e-4, Math.hypot(gx, gy));
            let fillAlpha = 0, lineAlpha = 0, haloAlpha = 0, previous = 0;
            for (let level = 0; level < levels.length; level++) {
              const distance = (value - levels[level]) / gradient;
              fillAlpha += (style.fillOpacity[level] - previous) * clamp(.5 + distance, 0, 1);
              previous = style.fillOpacity[level];
              const half = style.lineWidthPx[level] / 2 + .5;
              lineAlpha = Math.max(lineAlpha, style.lineOpacity[level] * clamp(half - Math.abs(distance), 0, 1));
              if (halos[kind]) haloAlpha = Math.max(haloAlpha, .55 * style.lineOpacity[level] * clamp(half + 1.2 - Math.abs(distance), 0, 1));
              if (level === levels.length - 1) {
                lineAlpha = Math.max(lineAlpha, .3 * clamp(1 - Math.abs(distance) / style.topGlowPx, 0, 1));
              }
            }
            over(fillImage.data, pixel, colors[kind], fillAlpha * strength[kind]);
            if (halos[kind]) over(lineImage.data, pixel, halos[kind], haloAlpha * strength[kind]);
            over(lineImage.data, pixel, colors[kind], lineAlpha * strength[kind]);
          }
        }
      }
      fillContext.putImageData(fillImage, 0, 0);
      lineContext.putImageData(lineImage, 0, 0);
      return { fill, lines };
    }

    function materialsVisible() {
      return root.OrbitDeveloperSettings?.get('showGroundMaterials') !== false;
    }

    // Baked isolines crossfade into the vector isolines of the close-up raster.
    function closeUpMaterialAlpha(zoom) {
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
          // Small headwaters stay in the data but are not drawn, to keep the map light.
          if ((fs[i] + fs[i + 1]) / 2 < SurfaceStyle.neon.water.riverMinFlow) continue;
          const width = Math.round(riverWidthKm((fs[i] + fs[i + 1]) / 2) * 4) / 4;
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

    // Micro-relief knolls and hollows, a render-only detail layer. A fine
    // two-octave noise is cut into blobs past a threshold; a blob is kept whole
    // or dropped: it must lie in one of the scattered patches, on dry land, in a
    // single stratum and clear of its limits. The kept blobs and the ring of
    // cells around them keep their noise, everything else is zero, so the
    // texture and the vector contours draw the same closed outlines.
    const reliefDetailCache = new WeakMap();
    function reliefDetail(planet, terrain) {
      if (reliefDetailCache.has(terrain)) return reliefDetailCache.get(terrain);
      const style = SurfaceStyle.neon.relief, detailStyle = style.detail, step = style.bandStep;
      const { width, height, seaLevel, elevation } = terrain, count = width * height;
      const relief = terrain.relief || elevation, cellFeatures = terrain.features, { base } = reliefLevels(seaLevel, step);
      const seed = World.hashSeed(String(planet.seed) + ':neon-detail:v1'), scale = detailStyle.scaleCells;
      const raw = new Float32Array(count), fits = new Uint8Array(count), stratum = new Int16Array(count);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const cell = y * width + x;
        raw[cell] = (valueNoise(x / scale, y / scale, seed) - .5) * 1.6 +
          (valueNoise(x / scale * 2.3 + 17.3, y / scale * 2.3 - 5.1, seed ^ 0x5bd1e995) - .5) * .3;
        const patch = valueNoise(x / detailStyle.patchCells, y / detailStyle.patchCells, seed ^ 0x27d4eb2f);
        const slope = Math.max(.5, Math.hypot(
          relief[y * width + Math.min(width - 1, x + 1)] - relief[y * width + Math.max(0, x - 1)],
          relief[Math.min(height - 1, y + 1) * width + x] - relief[Math.max(0, y - 1) * width + x]) * .5);
        const strata = (relief[cell] - base) / step;
        stratum[cell] = Math.floor(strata);
        const clearance = Math.abs(strata - Math.round(strata)) * step / slope;
        fits[cell] = elevation[cell] > seaLevel && patch >= detailStyle.patchThreshold &&
          clearance >= detailStyle.marginCells && (!cellFeatures || cellFeatures[cell] === World.TERRAIN_FEATURES.none) ? 1 : 0;
      }
      const kept = new Uint8Array(count), seen = new Uint8Array(count), blob = [], stack = [];
      for (let start = 0; start < count; start += 1) {
        if (seen[start] || Math.abs(raw[start]) <= detailStyle.threshold) continue;
        const sign = Math.sign(raw[start]);
        blob.length = 0; seen[start] = 1; stack.push(start);
        while (stack.length) {
          const cell = stack.pop(), cx = cell % width, cy = (cell - cx) / width;
          blob.push(cell);
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
            const nx = cx + dx, ny = cy + dy, next = ny * width + nx;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || raw[next] * sign <= detailStyle.threshold) continue;
            seen[next] = 1; stack.push(next);
          }
        }
        if (blob.length > detailStyle.maxCells) continue;
        // The blob and its ring must all fit, in the blob's stratum.
        let fitsWhole = true;
        for (const cell of blob) {
          const cx = cell % width, cy = (cell - cx) / width;
          for (let dy = -1; dy <= 1 && fitsWhole; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
            const nx = cx + dx, ny = cy + dy, next = ny * width + nx;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || !fits[next] || stratum[next] !== stratum[blob[0]]) { fitsWhole = false; break; }
          }
          if (!fitsWhole) break;
        }
        if (!fitsWhole) continue;
        for (const cell of blob) {
          const cx = cell % width, cy = (cell - cx) / width;
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) kept[(cy + dy) * width + cx + dx] = 1;
        }
      }
      const field = Float32Array.from(raw, (value, cell) => kept[cell] ? value : 0);
      const slopeX = new Float32Array(count), slopeY = new Float32Array(count);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        slopeX[y * width + x] = (field[y * width + Math.min(width - 1, x + 1)] - field[y * width + Math.max(0, x - 1)]) * .5;
        slopeY[y * width + x] = (field[Math.min(height - 1, y + 1) * width + x] - field[Math.max(0, y - 1) * width + x]) * .5;
      }
      const detail = { field, slopeX, slopeY, edge: detailStyle.threshold + detailStyle.softness / 2 };
      reliefDetailCache.set(terrain, detail);
      return detail;
    }

    // Hypsometric land layer, lit like stacked paper: each texel samples the
    // relief bilinearly (cell values sit on multiples of the layer scale, as
    // for the contours) and takes its stratum tint, brightening toward the next
    // stratum. Every step casts a soft shadow on the stratum below where the
    // higher one faces the light, and gets a thin highlight on its lit rim.
    // Faint secondary lines and a gentle directional hillshade add detail. Sea
    // texels instead draw faint isobaths on a separate layer. Both layers are
    // computed at `layerScale` texels per cell and smoothed when drawn: close
    // up, the vector contours take over.
    function createReliefLayer(planet, terrainData, layerScale) {
      const style = SurfaceStyle.neon.relief, marsh = SurfaceStyle.neon.marsh, features = World.TERRAIN_FEATURES;
      const { width, height, seaLevel } = terrainData;
      const relief = terrainData.relief || terrainData.elevation, cellFeatures = terrainData.features;
      const { base } = reliefLevels(seaLevel, style.bandStep), step = style.bandStep, minorStep = step / style.minorLines;
      const bandCount = Math.ceil((255 - base) / step) + 2, stops = style.colors.map(hexRGB);
      const bands = Array.from({ length: bandCount }, (_, band) => {
        const position = Math.min(1, band / Math.max(1, bandCount - 2)) * (stops.length - 1);
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
      const detailStyle = style.detail, { field: detail, slopeX: detailX, slopeY: detailY, edge: detailEdge } = reliefDetail(planet, terrainData);
      const line = hexRGB(style.lineColor), marshTint = hexRGB(marsh.tint), marshMark = hexRGB(marsh.mark);
      const marshField = cellFeatures ? Uint8Array.from(cellFeatures, feature => feature === features.marsh ? 1 : 0) : null;
      // Per-cell gradient from central differences, interpolated per texel, so
      // shading and shadow directions stay smooth instead of showing the grid.
      const slopeX = new Float32Array(width * height), slopeY = new Float32Array(width * height);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        slopeX[y * width + x] = (relief[y * width + Math.min(width - 1, x + 1)] - relief[y * width + Math.max(0, x - 1)]) * .5;
        slopeY[y * width + x] = (relief[Math.min(height - 1, y + 1) * width + x] - relief[Math.max(0, y - 1) * width + x]) * .5;
      }
      const [lightX, lightY] = style.lightDirection, lightLength = Math.hypot(lightX, lightY, style.lightHeight);
      const sunX = lightX / lightLength, sunY = lightY / lightLength, sunZ = style.lightHeight / lightLength;
      const towardX = lightX / Math.hypot(lightX, lightY), towardY = lightY / Math.hypot(lightX, lightY);
      const bathymetry = SurfaceStyle.neon.bathymetry, depthLine = hexRGB(bathymetry.color);
      const layerWidth = width * layerScale, layerHeight = height * layerScale, textureScale = layerScale;
      const layer = makeCanvas(layerWidth, layerHeight), context = layer.getContext('2d');
      const seaLayer = makeCanvas(layerWidth, layerHeight), seaContext = seaLayer.getContext('2d');
      const image = context.createImageData(layerWidth, layerHeight), pixels = image.data;
      const seaImage = seaContext.createImageData(layerWidth, layerHeight), seaPixels = seaImage.data;
      for (let ty = 0; ty < layerHeight; ty += 1) {
        const fy = Math.min(height - 1, (ty + .5) / textureScale);
        const y0 = Math.min(height - 2, Math.floor(fy)), sy = fy - y0;
        for (let tx = 0; tx < layerWidth; tx += 1) {
          const fx = Math.min(width - 1, (tx + .5) / textureScale);
          const x0 = Math.min(width - 2, Math.floor(fx)), sx = fx - x0;
          const i00 = y0 * width + x0, i10 = i00 + 1, i01 = i00 + width, i11 = i01 + 1;
          const bilinear = field => {
            const upper = field[i00] + (field[i10] - field[i00]) * sx;
            return upper + (field[i01] + (field[i11] - field[i01]) * sx - upper) * sy;
          };
          const top = relief[i00] + (relief[i10] - relief[i00]) * sx;
          const bottom = relief[i01] + (relief[i11] - relief[i01]) * sx;
          const value = top + (bottom - top) * sy;
          const gx = ((relief[i10] - relief[i00]) * (1 - sy) + (relief[i11] - relief[i01]) * sy) / textureScale;
          const gy = (bottom - top) / textureScale;
          const gradient = Math.max(.08, Math.hypot(gx, gy));
          const pixel = (ty * layerWidth + tx) * 4;
          if (value < base) {
            // Faint isobaths offshore.
            for (const level of bathymetry.levels) {
              const coverage = clamp(1 - Math.abs(value - level) / gradient / .6, 0, 1);
              if (coverage <= 0) continue;
              seaPixels[pixel] = depthLine[0]; seaPixels[pixel + 1] = depthLine[1]; seaPixels[pixel + 2] = depthLine[2];
              seaPixels[pixel + 3] = Math.round(coverage * bathymetry.opacity * 255);
            }
          }
          const strata = (value - base) / step, nearest = Math.round(strata);
          // Signed distance to the nearest stratum limit, in texels: within a
          // texel of it, the two tints blend so limits stay smooth close up.
          const signed = (value - (base + nearest * step)) / gradient;
          const lower = clamp(Math.floor(strata) + 1, 0, bandCount - 2);
          let band = mixRGB(bands[lower], bands[lower + 1], (strata - Math.floor(strata)) * style.innerGradient);
          if (nearest >= 1 && Math.abs(signed) < 1) {
            const below = mixRGB(bands[clamp(nearest, 0, bandCount - 2)], bands[clamp(nearest + 1, 0, bandCount - 1)], style.innerGradient);
            band = mixRGB(below, bands[clamp(nearest + 1, 0, bandCount - 1)], smoothstep(.5 + signed * .5));
          }
          // Smooth gradient for lighting, in relief units per cell.
          const smoothX = bilinear(slopeX), smoothY = bilinear(slopeY), smoothLength = Math.hypot(smoothX, smoothY);
          const normalX = -smoothX * style.reliefExaggeration, normalY = -smoothY * style.reliefExaggeration;
          const lambert = (normalX * sunX + normalY * sunY + sunZ) / Math.hypot(normalX, normalY, 1);
          let light = (1 + bilinear(pigment) * style.pigment) * (1 + style.hillshade * (lambert - sunZ));
          if (strata > 0 && smoothLength > .05) {
            // Uphill direction against the light: the step above shades the
            // stratum below when it stands between it and the light, the step
            // below lights its rim. Both fade quadratically over several texels
            // and ease in at the step itself, so shadows stay diffuse.
            const facing = (smoothX * towardX + smoothY * towardY) / smoothLength;
            const texelSlope = Math.max(.08, smoothLength / textureScale);
            const toAbove = (base + Math.ceil(strata) * step - value) / texelSlope;
            const fromBelow = (value - (base + Math.floor(strata) * step)) / texelSlope;
            const soft = distance => smoothstep(.35 + distance / style.stepSoftenTexels);
            const shadow = (1 - clamp(toAbove / style.stepShadowTexels, 0, 1)) ** 2 * soft(toAbove);
            const rim = (1 - clamp(fromBelow / style.stepHighlightTexels, 0, 1)) ** 2 * soft(fromBelow);
            light *= 1 - shadow * (style.stepAmbient + style.stepShadow * Math.max(0, facing));
            light *= 1 + rim * style.stepHighlight * Math.max(0, -facing);
          }
          // Knolls rise where the kept detail passes the threshold, hollows sink
          // below its opposite: lighter or darker, lightly shaded by their own
          // slope toward or away from the light.
          const knollValue = bilinear(detail), knollSlopeX = bilinear(detailX), knollSlopeY = bilinear(detailY);
          const knoll = smoothstep((knollValue - detailStyle.threshold) / detailStyle.softness);
          const hollow = smoothstep((-knollValue - detailStyle.threshold) / detailStyle.softness);
          light *= (1 + (knoll - hollow) * detailStyle.lift) *
            (1 - (knollSlopeX * towardX + knollSlopeY * towardY) * detailStyle.shade * (knoll + hollow));
          let red = band[0] * light, green = band[1] * light, blue = band[2] * light;
          if (marshField) {
            // Marsh cells blend bilinearly into soft patches with a map symbol:
            // short horizontal tufts in staggered rows.
            const marshAmount = smoothstep((bilinear(marshField) - .3) / .4);
            if (marshAmount > 0) {
              const amount = marsh.tintOpacity * marshAmount;
              red += (marshTint[0] - red) * amount; green += (marshTint[1] - green) * amount; blue += (marshTint[2] - blue) * amount;
              if (marshAmount > .5 && ty % 6 === 0 && (tx + Math.floor(ty / 6) * 4) % 9 < 5) {
                red += (marshMark[0] - red) * marsh.markOpacity; green += (marshMark[1] - green) * marsh.markOpacity;
                blue += (marshMark[2] - blue) * marsh.markOpacity;
              }
            }
          }
          // Main contour lines, then much fainter secondary lines between them.
          const minor = Math.round((value - base) / minorStep);
          const lineLevel = base + minor * minorStep;
          const major = minor % style.minorLines === 0;
          if (minor >= 1) {
            const coverage = clamp(1 - Math.abs(value - lineLevel) / gradient / (major ? .6 : .45), 0, 1);
            if (coverage > 0) {
              const amount = coverage * (major ? style.lineOpacity : style.minorLineOpacity);
              red += (line[0] - red) * amount; green += (line[1] - green) * amount; blue += (line[2] - blue) * amount;
            }
          }
          // A fine contour around each knoll and hollow.
          const knollEdge = (Math.abs(knollValue) - detailEdge) / Math.max(.004, Math.hypot(knollSlopeX, knollSlopeY) / textureScale);
          const knollLine = clamp(1 - Math.abs(knollEdge) / .7, 0, 1) * detailStyle.lineOpacity;
          if (knollLine > 0) {
            red += (line[0] - red) * knollLine; green += (line[1] - green) * knollLine; blue += (line[2] - blue) * knollLine;
          }
          pixels[pixel] = red; pixels[pixel + 1] = green; pixels[pixel + 2] = blue; pixels[pixel + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0);
      seaContext.putImageData(seaImage, 0, 0);
      return { layer, seaLayer };
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
      const { layer: reliefLayer, seaLayer } = createReliefLayer(planet, terrainData, style.relief.layerScale);
      context.imageSmoothingEnabled = true;
      context.drawImage(seaLayer, 0, 0, textureWidth, textureHeight);
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
      // The grade map lives on its own layers so it can be hidden, and its
      // baked lines can give way to vector isolines close up.
      const materialLayers = createMaterialLayers(terrainData);
      terrainTexture.materialFill = materialLayers.fill;
      terrainTexture.materialLines = materialLayers.lines;
      for (const canvas of [mask, edge, layer, reliefLayer, seaLayer]) { canvas.width = 0; canvas.height = 0; }
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
      const { width, elevation } = job.terrain, shore = shoreField(job.terrain);
      const relief = job.terrain.relief || elevation, cache = job.cache, cellSize = Config.terrain.textureScale;
      const index = y * width + x;
      traceLevel(cache.path, 0, shore[index], shore[index + 1], shore[index + width], shore[index + width + 1], x, y, cellSize);
      const a = relief[index], b = relief[index + 1], d = relief[index + width], e = relief[index + width + 1];
      const low = Math.min(a, b, d, e), high = Math.max(a, b, d, e), step = SurfaceStyle.neon.relief.bandStep;
      const first = Math.max(1, Math.ceil((low - cache.levelBase) / step));
      const last = Math.min(cache.levelPaths.length, Math.floor((high - cache.levelBase) / step));
      for (let level = first; level <= last; level += 1) {
        traceLevel(cache.levelPaths[level - 1], cache.levelBase + level * step, a, b, d, e, x, y, cellSize);
      }
      // Grade isolines of every material crossing this cell.
      if (cache.materialPaths) {
        const { ids, shares } = job.terrain.materials, kinds = ids.length, levels = SurfaceStyle.neon.materials.levels;
        for (let kind = 0; kind < kinds; kind++) {
          const ma = shares[index * kinds + kind] / 255, mb = shares[(index + 1) * kinds + kind] / 255;
          const md = shares[(index + width) * kinds + kind] / 255, me = shares[(index + width + 1) * kinds + kind] / 255;
          const low = Math.min(ma, mb, md, me), high = Math.max(ma, mb, md, me);
          if (high < levels[0]) continue;
          for (let level = 0; level < levels.length; level++) {
            if (levels[level] > low && levels[level] < high) traceLevel(cache.materialPaths[kind][level], levels[level], ma, mb, md, me, x, y, cellSize);
          }
        }
      }
      // Knoll and hollow outlines, once the baked texture has built the detail.
      const detail = reliefDetailCache.get(job.terrain);
      if (detail) {
        const field = detail.field;
        traceLevel(cache.knollPath, detail.edge, Math.abs(field[index]), Math.abs(field[index + 1]),
          Math.abs(field[index + width]), Math.abs(field[index + width + 1]), x, y, cellSize);
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
      // Contour lines first, all alike.
      const reliefStyle = SurfaceStyle.neon.relief;
      for (const path of cache.levelPaths) {
        context.lineWidth = reliefStyle.lineWidthPx / job.zoom;
        context.strokeStyle = rgba(reliefStyle.lineColor, reliefStyle.lineOpacity);
        context.stroke(path);
      }
      context.lineWidth = reliefStyle.lineWidthPx / job.zoom;
      context.strokeStyle = rgba(reliefStyle.lineColor, reliefStyle.detail.vectorLineOpacity);
      context.stroke(cache.knollPath);
      const closeLines = materialsVisible() ? closeUpMaterialAlpha(job.zoom) : 0;
      if (closeLines > .001 && cache.materialPaths) {
        const materialStyle = SurfaceStyle.neon.materials, ids = job.terrain.materials.ids;
        cache.materialPaths.forEach((paths, kind) => {
          const color = materialStyle.colors[ids[kind]] || '#ffffff', strength = isMarineMaterial(ids[kind]) ? materialStyle.marineOpacity : 1;
          paths.forEach((path, level) => {
            const top = level === paths.length - 1, halo = materialStyle.lineHalo?.[ids[kind]];
            if (halo) {
              context.save();
              context.lineWidth = materialStyle.lineWidthPx[level] / job.zoom + 2.4 / job.zoom;
              context.strokeStyle = rgba(halo, .55 * materialStyle.lineOpacity[level] * strength * closeLines);
              context.stroke(path);
              context.restore();
            }
            context.save();
            context.lineWidth = materialStyle.lineWidthPx[level] / job.zoom;
            context.strokeStyle = rgba(color, materialStyle.lineOpacity[level] * strength * closeLines);
            if (top) { context.shadowColor = rgba(color, .9 * closeLines); context.shadowBlur = materialStyle.topGlowPx * job.pixelRatio; }
            context.stroke(path);
            context.restore();
          });
        });
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
        path: new root.Path2D(), knollPath: new root.Path2D(), raster: null,
        materialPaths: request.terrain.materials ? request.terrain.materials.ids.map(() =>
          SurfaceStyle.neon.materials.levels.map(() => new root.Path2D())) : null,
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
      if (materialsVisible() && terrainTexture.materialFill) {
        canvasContext.drawImage(terrainTexture.materialFill, top.x, top.y, terrainWidth * frame.zoom, terrainHeight * frame.zoom);
        const overviewLines = 1 - closeUpMaterialAlpha(frame.zoom);
        if (overviewLines > .001) {
          canvasContext.save();
          canvasContext.globalAlpha = overviewLines;
          canvasContext.drawImage(terrainTexture.materialLines, top.x, top.y, terrainWidth * frame.zoom, terrainHeight * frame.zoom);
          canvasContext.restore();
        }
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
      drawTerrain(frame, !planetPreview);
      if (frame.showSurfaceRoads) layers.roads.render(frame);
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
