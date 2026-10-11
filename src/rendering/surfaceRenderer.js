(function (root) {
  'use strict';

  const World = root.OrbitWorld, Config = root.OrbitConfig;
  const SurfaceStyle = root.OrbitSurfaceStyle;
  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const ease = t => t * t * (3 - 2 * t);

  const PALETTE = [
    [0, '#101f2c'], [68, '#182d37'], [88, '#2a3c3f'], [98, '#505b52'],
    [103, '#aaa58d'], [109, '#7b826d'], [125, '#68745f'], [143, '#586851'],
    [159, '#47594a'], [177, '#505a4e'], [192, '#666a5b'], [209, '#7c7d6a'],
    [230, '#9d967e'], [246, '#b9ad91']
  ];

  function hexRGB(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function create(canvasContext, dependencies) {
    const { project, localCamera, surfaceFrame, getState, getViewport, layers } = dependencies;

    function makeCanvas(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      return canvas;
    }

    function dot(context, x, y, radius, color) {
      context.fillStyle = color; context.beginPath(); context.arc(x, y, Math.max(.1, radius), 0, TAU); context.fill();
    }

    function createTerrainTexture(planet, terrainData) {
      const { width, height, elevation, moisture } = terrainData;
      const textureScale = Config.terrain.textureScale;
      const rawCanvas = makeCanvas(width, height), rawContext = rawCanvas.getContext('2d'), image = rawContext.createImageData(width, height);
      const palette = PALETTE.map(([threshold, hex]) => [threshold, hexRGB(hex)]);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = y * width + x, value = elevation[index];
        let rgb = palette[0][1]; for (const entry of palette) if (value >= entry[0]) rgb = entry[1];
        const dx = elevation[y * width + Math.min(width - 1, x + 1)] - elevation[y * width + Math.max(0, x - 1)];
        const dy = elevation[Math.min(height - 1, y + 1) * width + x] - elevation[Math.max(0, y - 1) * width + x];
        const shade = clamp((-dx * 1.5 - dy * 1.8), -30, 25);
        if (value > 109 && value < 209) {
          const humidity = (moisture[index] - 128) / 255;
          rgb = [rgb[0] - humidity * 7, rgb[1] + humidity * 10, rgb[2] + humidity * 5];
        }
        if (planet.kind === 'aride') rgb = [rgb[0] + 14, rgb[1] - 4, rgb[2] - 10];
        if (planet.kind === 'glacée' && value > 105) rgb = [rgb[0] + 26, rgb[1] + 31, rgb[2] + 32];
        if (planet.kind === 'volcanique' && value > 109) rgb = [rgb[0] + 8, rgb[1] - 13, rgb[2] - 14];
        for (let channel = 0; channel < 3; channel++) image.data[index * 4 + channel] = clamp(rgb[channel] + shade, 0, 255);
        image.data[index * 4 + 3] = 255;
      }
      rawContext.putImageData(image, 0, 0);
      const terrainTexture = makeCanvas(width * textureScale, height * textureScale);
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
      canvasContext.imageSmoothingEnabled = true;
      canvasContext.drawImage(terrainTexture, top.x, top.y, terrainTexture.width * frame.zoom, terrainTexture.height * frame.zoom);
      if (frame.zoom > SurfaceStyle.lod.surfaceGridZoom) drawSurfaceGrid(frame.camera);
      const bottom = frame.project(terrainTexture.width, terrainTexture.height);
      canvasContext.strokeStyle = SurfaceStyle.terrain.edgeColor;
      canvasContext.lineWidth = SurfaceStyle.terrain.edgeWidthPx;
      canvasContext.strokeRect(top.x, top.y, bottom.x - top.x, bottom.y - top.y);
    }

    function drawGeologicalOverlays(frame) {
      if (frame.zoom < SurfaceStyle.lod.terrainDetailsZoom) return;
      const marker = SurfaceStyle.resources;
      for (const resource of frame.terrain.resources) {
        const p = frame.project(resource.x * Config.terrain.textureScale, resource.y * Config.terrain.textureScale);
        const radius = marker.markerRadiusBasePx + marker.markerRadiusPerZoom * frame.zoom;
        if (p.x < 0 || p.y < 0 || p.x > frame.viewport.width || p.y > frame.viewport.height) continue;
        canvasContext.save(); canvasContext.beginPath();
        canvasContext.ellipse(p.x, p.y, radius * marker.ellipseXRatio, radius * marker.ellipseYRatio, marker.ellipseAngleRadians, 0, TAU);
        canvasContext.clip();
        for (let i = -radius * 2; i < radius * 2; i += marker.hatchSpacingPx) {
          dependencies.drawLine(canvasContext,
            [{ x: p.x + i - radius, y: p.y + radius }, { x: p.x + i + radius, y: p.y - radius }],
            marker.hatchColor, marker.hatchWidthPx);
        }
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
          const radius = marker.markerRadiusBasePx + marker.markerRadiusPerZoom * frame.zoom;
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
