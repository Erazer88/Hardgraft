(function (root) {
  'use strict';

  const Data = root.OrbitBuildingData, Style = root.OrbitSurfaceStyle;

  function visibleBuildings(frame) {
    return (frame.state.surfaceBuildings || []).filter(building => building.planetId === frame.planet.id);
  }

  function drawGlyph(ctx, x, y, size, color, icon = 'factory', lineWidth = 1.2) {
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
    if (icon === 'extractor') {
      ctx.moveTo(x - size * .6, y + size * .45); ctx.lineTo(x + size * .45, y - size * .6);
      ctx.moveTo(x - size * .45, y - size * .45); ctx.lineTo(x + size * .6, y + size * .45);
      ctx.moveTo(x - size * .72, y + size * .62); ctx.lineTo(x + size * .72, y + size * .62); ctx.stroke(); return;
    }
    if (icon === 'surface-port') {
      ctx.moveTo(x, y + size * .58); ctx.lineTo(x, y - size * .12); ctx.lineTo(x + size * .66, y - size * .12);
      ctx.moveTo(x - size * .12, y + size * .15); ctx.lineTo(x + size * .72, y + size * .15);
      ctx.moveTo(x - size * .65, y - size * .48); ctx.quadraticCurveTo(x - size * .42, y - size * .22, x - size * .18, y - size * .48);
      ctx.moveTo(x + size * .02, y - size * .48); ctx.quadraticCurveTo(x + size * .25, y - size * .22, x + size * .5, y - size * .48);
      ctx.stroke(); return;
    }
    if (icon === 'oil-platform') {
      ctx.moveTo(x - size * .65, y - size * .12); ctx.lineTo(x + size * .65, y - size * .12);
      ctx.moveTo(x - size * .5, y - size * .12); ctx.lineTo(x - size * .35, y + size * .62);
      ctx.moveTo(x + size * .5, y - size * .12); ctx.lineTo(x + size * .35, y + size * .62);
      ctx.moveTo(x - size * .78, y + size * .62); ctx.lineTo(x + size * .78, y + size * .62);
      ctx.moveTo(x - size * .22, y - size * .12); ctx.lineTo(x - size * .22, y - size * .55);
      ctx.moveTo(x - size * .38, y - size * .55); ctx.lineTo(x - size * .06, y - size * .55); ctx.stroke(); return;
    }
    if (icon === 'storage') {
      ctx.ellipse(x, y - size * .38, size * .5, size * .2, 0, 0, Math.PI * 2);
      ctx.moveTo(x - size * .5, y - size * .38); ctx.lineTo(x - size * .5, y + size * .42);
      ctx.ellipse(x, y + size * .42, size * .5, size * .2, 0, 0, Math.PI);
      ctx.moveTo(x + size * .5, y - size * .38); ctx.lineTo(x + size * .5, y + size * .42); ctx.stroke(); return;
    }
    if (icon === 'hub') {
      ctx.arc(x, y + size * .12, size * .48, Math.PI, 0);
      ctx.moveTo(x, y + size * .12); ctx.lineTo(x, y - size * .62);
      ctx.moveTo(x - size * .28, y - size * .35); ctx.lineTo(x, y - size * .63); ctx.lineTo(x + size * .28, y - size * .35);
      ctx.moveTo(x - size * .64, y + size * .4); ctx.lineTo(x + size * .64, y + size * .4); ctx.stroke(); return;
    }
    if (icon === 'colony') {
      // Three domes on one ground line.
      ctx.moveTo(x - size * .78, y + size * .5); ctx.lineTo(x + size * .78, y + size * .5);
      ctx.moveTo(x - size * .62, y + size * .5); ctx.arc(x - size * .38, y + size * .5, size * .24, Math.PI, 0);
      ctx.moveTo(x - size * .2, y + size * .5); ctx.arc(x + size * .08, y + size * .5, size * .4, Math.PI, 0);
      ctx.moveTo(x + size * .5, y + size * .5); ctx.arc(x + size * .64, y + size * .5, size * .14, Math.PI, 0);
      ctx.stroke(); return;
    }
    if (icon === 'water-pump') {
      ctx.moveTo(x - size * .45, y + size * .5); ctx.lineTo(x - size * .45, y - size * .3); ctx.lineTo(x + size * .2, y - size * .3);
      ctx.lineTo(x + size * .2, y + size * .05);
      ctx.moveTo(x + size * .2, y + size * .05);
      ctx.bezierCurveTo(x - size * .05, y + size * .4, x + size * .05, y + size * .62, x + size * .2, y + size * .62);
      ctx.bezierCurveTo(x + size * .35, y + size * .62, x + size * .45, y + size * .4, x + size * .2, y + size * .05);
      ctx.moveTo(x - size * .7, y - size * .3); ctx.lineTo(x - size * .2, y - size * .3); ctx.stroke(); return;
    }
    if (icon === 'terril') {
      ctx.moveTo(x - size * .75, y + size * .5); ctx.lineTo(x - size * .25, y - size * .2); ctx.lineTo(x, y + size * .05);
      ctx.lineTo(x + size * .3, y - size * .45); ctx.lineTo(x + size * .75, y + size * .5); ctx.closePath();
      ctx.moveTo(x - size * .2, y + size * .28); ctx.lineTo(x + size * .12, y + size * .28); ctx.stroke(); return;
    }
    if (icon === 'wind-turbine') {
      ctx.moveTo(x, y - size * .1); ctx.lineTo(x, y + size * .66); ctx.moveTo(x, y - size * .1); ctx.lineTo(x, y - size * .68);
      ctx.moveTo(x, y - size * .1); ctx.lineTo(x - size * .52, y + size * .12);
      ctx.moveTo(x, y - size * .1); ctx.lineTo(x + size * .52, y + size * .12); ctx.stroke(); return;
    }
    if (icon === 'geothermal') {
      ctx.moveTo(x - size * .7, y + size * .55); ctx.lineTo(x + size * .7, y + size * .55);
      for (const offset of [-.32, 0, .32]) {
        ctx.moveTo(x + size * offset, y + size * .35);
        ctx.bezierCurveTo(x + size * (offset - .18), y + size * .05, x + size * (offset + .18), y - size * .2, x + size * offset, y - size * .55);
      }
      ctx.stroke(); return;
    }
    ctx.moveTo(x - size * .55, y + size * .42); ctx.lineTo(x - size * .55, y - size * .14);
    ctx.lineTo(x - size * .08, y + size * .12); ctx.lineTo(x - size * .08, y - size * .14);
    ctx.lineTo(x + size * .35, y + size * .12); ctx.lineTo(x + size * .35, y - size * .52);
    ctx.lineTo(x + size * .62, y - size * .52); ctx.lineTo(x + size * .62, y + size * .42); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - size * .7, y + size * .48); ctx.lineTo(x + size * .75, y + size * .48); ctx.stroke();
  }

  // Beacon scale at this zoom: smaller far out, larger close up.
  function pinScale(frame) {
    const pin = Style.buildings.pin, zoom = Number.isFinite(frame?.zoom) && frame.zoom > 0 ? frame.zoom : pin.zoomReference;
    return Math.max(pin.minScale, Math.min(pin.maxScale, (zoom / pin.zoomReference) ** pin.zoomExponent));
  }

  // Beacon geometry, in screen pixels: the hexagon sits on the building's spot.
  function pinGeometry(frame, building) {
    const ground = frame.project(building.x, building.y), scale = pinScale(frame);
    return { ground, head: ground, radius: Style.buildings.pin.headRadiusPx * scale, scale };
  }

  function hexagon(ctx, x, y, radius) {
    ctx.beginPath();
    for (let corner = 0; corner < 6; corner++) {
      const angle = Math.PI / 6 + corner * Math.PI / 3;
      const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
      corner ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  function drawPin(frame, building, definition, ghost = false) {
    const ctx = frame.context, pin = Style.buildings.pin, { head, radius, scale } = pinGeometry(frame, building);
    const selected = frame.state.selected?.kind === 'building' && frame.state.selected.id === building.id;
    const complete = ghost || building.constructionState === 'complete';
    const color = ghost ? (frame.state.placement?.valid ? '#7ebfba' : '#e57870')
      : pin.categoryColors[definition.category] || pin.defaultColor;
    ctx.save();
    ctx.globalAlpha = ghost ? pin.ghostOpacity : complete ? 1 : pin.constructionOpacity + (1 - pin.constructionOpacity) * .5;
    ctx.shadowColor = color;
    hexagon(ctx, head.x, head.y, radius);
    ctx.shadowBlur = 0; ctx.strokeStyle = pin.rimColor; ctx.lineWidth = pin.rimWidthPx; ctx.stroke();
    ctx.strokeStyle = color; ctx.shadowBlur = pin.glowBlurPx;
    ctx.fillStyle = pin.fill; ctx.fill();
    ctx.lineWidth = pin.lineWidthPx; ctx.setLineDash(complete ? [] : [3, 2.5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    drawGlyph(ctx, head.x, head.y, pin.glyphSizePx * scale, pin.glyphColor, definition.icon, pin.glyphLineWidthPx * Math.sqrt(scale));
    if (!complete) {
      // Construction progress runs around the head.
      const progress = Math.max(0, Math.min(1, building.constructionProgress || 0));
      ctx.strokeStyle = pin.constructionColor; ctx.lineWidth = pin.progressWidthPx; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(head.x, head.y, radius + 4, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); ctx.stroke();
    }
    if (selected) {
      ctx.strokeStyle = Style.buildings.selectedOutlineColor; ctx.lineWidth = Style.buildings.selectedOutlineWidthPx;
      hexagon(ctx, head.x, head.y, radius + pin.selectedRingPx); ctx.stroke();
    }
    ctx.restore();
    return color;
  }

  function drawFootprint(frame, building, definition, ghost = false) {
    const ctx = frame.context, center = frame.project(building.x, building.y), scale = frame.zoom;
    const width = definition.footprint.width * scale, height = definition.footprint.height * scale;
    const color = ghost ? (frame.state.placement?.valid ? '#7ebfba' : '#e57870') :
      Style.buildings.pin.categoryColors[definition.category] || Style.buildings.pin.defaultColor;
    if (ghost) {
      // The placement preview still shows the ground the building will take.
      ctx.save(); ctx.translate(center.x, center.y); ctx.rotate(building.rotation || 0);
      ctx.fillStyle = frame.state.placement?.valid ? '#76bdb522' : '#e5787022';
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.fillRect(-width / 2, -height / 2, width, height); ctx.strokeRect(-width / 2, -height / 2, width, height);
      ctx.restore();
    }

    // A drill being placed or selected shows the ground it drains and what it holds.
    const selected = frame.state.selected?.kind === 'building' && frame.state.selected.id === building.id;
    const groundText = ghost ? frame.state.placement?.groundText : selected ? frame.state.selected.groundText : null;
    if (groundText) drawGroundReadout(frame, building, definition, groundText, color);
    drawPin(frame, building, definition, ghost);
    if (!ghost && building.customName) drawName(frame, building, color);
    if (ghost) {
      const head = pinGeometry(frame, building).head;
      ctx.save(); ctx.font = `${root.OrbitTextScale.px(8)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`${definition.label} · EMPLACEMENT ${frame.state.placement?.valid ? 'VALIDE' : 'INVALIDE'}`,
        head.x + pinGeometry(frame, building).radius + 6, head.y);
      ctx.restore();
    }
  }

  // The building's name, just above its beacon.
  function drawName(frame, building, color) {
    const ctx = frame.context, style = Style.buildings.name, { head, radius } = pinGeometry(frame, building);
    const size = root.OrbitTextScale.px(style.sizePx, style.scaleDamping ?? 1);
    ctx.save();
    ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const y = head.y - radius - style.gapPx, width = ctx.measureText(building.customName).width + 10;
    ctx.fillStyle = style.fill; ctx.beginPath(); ctx.roundRect(head.x - width / 2, y - size - 4, width, size + 6, 3); ctx.fill();
    ctx.fillStyle = color; ctx.fillText(building.customName, head.x, y + 1);
    ctx.restore();
  }

  function drawGroundReadout(frame, building, definition, text, color) {
    const ctx = frame.context, pin = Style.buildings.pin, ground = frame.project(building.x, building.y);
    ctx.save();
    if (definition.catchmentRadius) {
      ctx.strokeStyle = color; ctx.globalAlpha = .55; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.arc(ground.x, ground.y, definition.catchmentRadius * frame.zoom, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    ctx.font = `${root.OrbitTextScale.px(pin.readoutSizePx)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const y = ground.y + pinGeometry(frame, building).radius + 8, width = ctx.measureText(text).width + 14;
    ctx.fillStyle = pin.readoutFill;
    ctx.beginPath(); ctx.roundRect(ground.x - width / 2, y - 3, width, pin.readoutSizePx + 7, 4); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = .8; ctx.stroke();
    ctx.fillStyle = pin.readoutColor; ctx.fillText(text, ground.x, y + 1);
    ctx.restore();
  }

  function cardPosition(frame, building, definition) {
    const style = Style.buildings, width = Math.max(style.cardMinWidthPx, Math.min(style.cardWidthPx, style.cardMaxWidthPx));
    const anchor = frame.project(building.x, building.y), edge = definition.footprint.width * frame.zoom / 2 + 12;
    let x = anchor.x + edge, y = anchor.y - style.cardHeightPx / 2;
    if (x + width > frame.viewport.width - 8) x = anchor.x - edge - width;
    x = Math.max(8, Math.min(frame.viewport.width - width - 8, x));
    y = Math.max(8, Math.min(frame.viewport.height - style.cardHeightPx - 8, y));
    return { anchor, x, y, width, height: style.cardHeightPx };
  }

  // The colony's zone, rendered once per size into an offscreen tint and an
  // outline, then drawn at the current zoom.
  const zoneCache = new Map();
  const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function zoneShape(building, terrainWidth, color) {
    const cells = building.colony.cells, key = `${cells.length}:${color}`;
    const cached = zoneCache.get(building.id);
    if (cached?.key === key) return cached;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cell of cells) {
      const x = cell % terrainWidth, y = (cell / terrainWidth) | 0;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const pad = 3, fx = minX - pad, fy = minY - pad, fw = maxX - minX + 1 + pad * 2, fh = maxY - minY + 1 + pad * 2;
    let field = new Float32Array(fw * fh);
    for (const cell of cells) field[(((cell / terrainWidth) | 0) - fy) * fw + (cell % terrainWidth) - fx] = 1;
    for (let pass = 0; pass < 2; pass++) {
      const next = new Float32Array(fw * fh);
      for (let y = 1; y < fh - 1; y++) for (let x = 1; x < fw - 1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += field[(y + dy) * fw + x + dx] * (dx && dy ? .5 : dx || dy ? 1 : 2);
        next[y * fw + x] = sum / 8;
      }
      field = next;
    }
    const at = (u, v) => {
      const x = u - fx, y = v - fy, ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
      if (ix < 0 || iy < 0 || ix >= fw - 1 || iy >= fh - 1) return 0;
      const i = iy * fw + ix;
      return (field[i] * (1 - tx) + field[i + 1] * tx) * (1 - ty) + (field[i + fw] * (1 - tx) + field[i + fw + 1] * tx) * ty;
    };
    const style = Style.colonyZone, scale = style.pixelsPerCell;
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(fw * scale, fh * scale)
      : Object.assign(document.createElement('canvas'), { width: fw * scale, height: fh * scale });
    const context = canvas.getContext('2d'), image = context.createImageData(fw * scale, fh * scale);
    const [r, g, b] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
    for (let py = 0; py < fh * scale; py++) for (let px = 0; px < fw * scale; px++) {
      const value = at(fx - .5 + (px + .5) / scale, fy - .5 + (py + .5) / scale);
      const inside = smoothstep(.46, .54, value);
      if (!inside) continue;
      const edge = 1 - smoothstep(.5, .82, value), i = (py * fw * scale + px) * 4;
      image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b;
      image.data[i + 3] = Math.round(255 * inside * (style.fillOpacity + style.edgeOpacity * edge));
    }
    context.putImageData(image, 0, 0);
    // Outline: marching squares on the smoothed field, in cell coordinates.
    const segments = [];
    for (let y = 0; y < fh - 1; y++) for (let x = 0; x < fw - 1; x++) {
      const values = [field[y * fw + x], field[y * fw + x + 1], field[(y + 1) * fw + x + 1], field[(y + 1) * fw + x]];
      const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]], points = [];
      for (let edge = 0; edge < 4; edge++) {
        const a = values[edge], bValue = values[(edge + 1) % 4];
        if ((a < .5) === (bValue < .5)) continue;
        const t = (.5 - a) / (bValue - a), from = corners[edge], to = corners[(edge + 1) % 4];
        points.push([fx + from[0] + (to[0] - from[0]) * t, fy + from[1] + (to[1] - from[1]) * t]);
      }
      if (points.length === 2) segments.push(points);
      if (points.length === 4) segments.push([points[0], points[1]], [points[2], points[3]]);
    }
    const shape = { key, canvas, left: fx - .5, top: fy - .5, width: fw, height: fh, segments };
    zoneCache.set(building.id, shape);
    return shape;
  }

  function renderColonyZones(frame) {
    const terrain = frame.terrain, scale = root.OrbitConfig?.terrain?.textureScale || 3;
    if (!terrain) return;
    const ctx = frame.context, style = Style.colonyZone, color = Style.buildings.pin.categoryColors.colony;
    for (const building of visibleBuildings(frame)) {
      if (building.type !== 'colony' || !building.colony?.cells?.length) continue;
      const shape = zoneShape(building, terrain.width, color);
      const a = frame.project(shape.left * scale, shape.top * scale);
      const b = frame.project((shape.left + shape.width) * scale, (shape.top + shape.height) * scale);
      if (b.x < 0 || b.y < 0 || a.x > frame.viewport.width || a.y > frame.viewport.height) continue;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(shape.canvas, a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.lineCap = 'round'; ctx.strokeStyle = color; ctx.shadowColor = color;
      for (const [width, opacity, blur] of [[style.glowWidthPx, style.glowOpacity, style.glowBlurPx], [style.outlineWidthPx, 1, 0]]) {
        ctx.lineWidth = width; ctx.globalAlpha = opacity; ctx.shadowBlur = blur;
        ctx.beginPath();
        for (const [p, q] of shape.segments) {
          const from = frame.project(p[0] * scale, p[1] * scale), to = frame.project(q[0] * scale, q[1] * scale);
          ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // The colony's population, under its beacon.
  function drawPopulation(frame, building) {
    const ctx = frame.context, style = Style.colonyZone, pin = Style.buildings.pin, head = pinGeometry(frame, building).head;
    const text = `${new Intl.NumberFormat('fr-FR').format(building.colony?.population || 0)} HAB.`;
    ctx.save();
    ctx.font = `600 ${root.OrbitTextScale.px(style.labelSizePx)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const y = head.y + pinGeometry(frame, building).radius + 6, width = ctx.measureText(text).width + 12;
    ctx.fillStyle = pin.readoutFill; ctx.beginPath(); ctx.roundRect(head.x - width / 2, y - 3, width, style.labelSizePx + 7, 4); ctx.fill();
    ctx.fillStyle = pin.categoryColors.colony; ctx.fillText(text, head.x, y + 1);
    ctx.restore();
  }

  // Where the launch platform pays least to reach orbit: the equator, the
  // favorable band around it, parallels and meridians with their degrees.
  function renderLatitudeGrid(frame) {
    const state = frame.state, terrain = root.OrbitConfig?.terrain, Logistics = root.OrbitOrbitalLogisticsData;
    const placing = state.tool === 'build' && state.placement?.type === 'launch_platform';
    const selected = state.selected?.kind === 'building' && state.selected.type === 'launch_platform';
    if (!terrain || !Logistics?.launchSite || !(placing || selected)) return;
    const style = Style.latitudeGrid, site = Logistics.launchSite;
    const width = terrain.width * terrain.textureScale, height = terrain.height * terrain.textureScale;
    const rowOf = latitude => (.5 - latitude / site.latitudeExtentDegrees / 2) * height;
    const ctx = frame.context, left = frame.project(0, 0).x, right = frame.project(width, 0).x;
    const top = frame.project(0, 0).y, bottom = frame.project(0, height).y;
    const clipLeft = Math.max(0, left), clipRight = Math.min(frame.viewport.width, right);
    ctx.save();
    ctx.font = `${root.OrbitTextScale.px(style.labelSizePx)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.textBaseline = 'bottom'; ctx.textAlign = 'right';
    const band = [frame.project(0, rowOf(site.favorableLatitudeDegrees)).y, frame.project(0, rowOf(-site.favorableLatitudeDegrees)).y];
    ctx.fillStyle = style.bandFill; ctx.fillRect(clipLeft, band[0], clipRight - clipLeft, band[1] - band[0]);
    for (let latitude = -site.latitudeExtentDegrees + site.latitudeExtentDegrees % style.parallelStepDegrees;
      latitude <= site.latitudeExtentDegrees; latitude += style.parallelStepDegrees) {
      const y = frame.project(0, rowOf(latitude)).y;
      if (y < -2 || y > frame.viewport.height + 2) continue;
      const equator = latitude === 0;
      ctx.globalAlpha = equator ? .85 : style.lineOpacity;
      ctx.strokeStyle = equator ? style.equatorColor : style.lineColor;
      ctx.lineWidth = equator ? 1.4 : .8; ctx.setLineDash(equator ? [] : [2, 6]);
      ctx.beginPath(); ctx.moveTo(clipLeft, y); ctx.lineTo(clipRight, y); ctx.stroke();
      ctx.globalAlpha = equator ? 1 : .75; ctx.fillStyle = equator ? style.equatorColor : style.labelColor;
      const text = equator ? `ÉQUATEUR · LANCEMENT ${Math.round(Logistics.launchEnergyMW(0))} MW`
        : `${Math.abs(latitude)}° ${latitude > 0 ? 'N' : 'S'} · ${Logistics.launchEnergyMW(latitude).toFixed(1).replace('.', ',')} MW`;
      ctx.fillText(text, clipRight - 12, y - 2);
    }
    ctx.setLineDash([2, 6]); ctx.strokeStyle = style.lineColor; ctx.lineWidth = .8; ctx.globalAlpha = style.lineOpacity;
    for (let longitude = -180; longitude <= 180; longitude += style.meridianStepDegrees) {
      const x = frame.project((longitude + 180) / 360 * width, 0).x;
      if (x < -2 || x > frame.viewport.width + 2) continue;
      ctx.beginPath(); ctx.moveTo(x, Math.max(0, top)); ctx.lineTo(x, Math.min(frame.viewport.height, bottom)); ctx.stroke();
    }
    ctx.restore();
  }

  function renderPhysical(frame) {
    renderColonyZones(frame);
    renderLatitudeGrid(frame);
    for (const building of visibleBuildings(frame)) {
      const definition = Data.get(building.type);
      if (definition) drawFootprint(frame, building, definition);
      if (building.type === 'colony') drawPopulation(frame, building);
    }
    const preview = frame.state.placement;
    if (frame.state.tool === 'build' && preview) {
      const definition = Data.get(preview.type);
      if (definition) drawFootprint(frame, preview, definition, true);
    }
  }

  function renderAnchors(frame) {
    const ctx = frame.context, style = Style.buildings;
    for (const building of visibleBuildings(frame)) {
      if (building.constructionState === 'complete') continue;
      const definition = Data.get(building.type);
      if (!definition) continue;
      const card = cardPosition(frame, building, definition), side = card.x > card.anchor.x ? card.x : card.x + card.width;
      const selected = frame.state.selected?.kind === 'building' && frame.state.selected.id === building.id;
      ctx.strokeStyle = selected ? '#efa35a99' : '#b3c3c344'; ctx.lineWidth = .8; ctx.beginPath();
      ctx.moveTo(card.anchor.x, card.anchor.y); ctx.lineTo(side, card.y + card.height / 2); ctx.stroke();
      ctx.fillStyle = style.cardOutlineColor; ctx.beginPath(); ctx.arc(card.anchor.x, card.anchor.y, 2, 0, Math.PI * 2); ctx.fill();
    }
  }

  function renderCards(frame) {
    const ctx = frame.context, style = Style.buildings;
    for (const building of visibleBuildings(frame)) {
      if (building.constructionState === 'complete') continue;
      const definition = Data.get(building.type);
      if (!definition) continue;
      const card = cardPosition(frame, building, definition);
      ctx.save(); ctx.globalAlpha = style.cardOpacity;
      const selected = frame.state.selected?.kind === 'building' && frame.state.selected.id === building.id;
      ctx.fillStyle = style.cardFill; ctx.strokeStyle = selected ? style.selectedOutlineColor : style.cardOutlineColor;
      ctx.lineWidth = selected ? style.selectedOutlineWidthPx : style.cardOutlineWidthPx;
      ctx.beginPath(); ctx.roundRect(card.x, card.y, card.width, card.height, style.cardRadiusPx); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
      const iconX = card.x + style.cardPaddingPx + style.iconRadiusPx, iconY = card.y + card.height / 2 - 3;
      ctx.fillStyle = '#102232'; ctx.strokeStyle = style.cardOutlineColor; ctx.lineWidth = .9;
      ctx.beginPath(); ctx.arc(iconX, iconY, style.iconRadiusPx, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      drawGlyph(ctx, iconX, iconY, style.iconSizePx * .42, '#a8c0cc', definition.icon);
      ctx.font = `${root.OrbitTextScale.px(style.titleSizePx)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      ctx.fillStyle = '#d0dee3'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(building.customName || definition.label, iconX + style.iconRadiusPx + 8, card.y + 19);
      ctx.font = `${root.OrbitTextScale.px(style.valueSizePx)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      ctx.fillStyle = building.constructionState === 'complete' ? '#809baa' : '#d7a66f';
      ctx.fillText(building.constructionState === 'complete' ? 'ASSEMBLÉE' : building.status === 'queued' ? 'EN ATTENTE' : 'ASSEMBLAGE', iconX + style.iconRadiusPx + 8, card.y + 34);
      const barX = iconX + style.iconRadiusPx + 8, barY = card.y + card.height - 12;
      const barWidth = Math.max(10, card.width - (barX - card.x) - style.cardPaddingPx);
      ctx.fillStyle = '#52687866'; ctx.fillRect(barX, barY, barWidth, style.activityBarHeightPx);
      ctx.fillStyle = building.constructionState === 'complete' ? '#8bb1b8' : '#d7a66f';
      ctx.fillRect(barX, barY, barWidth * Math.max(0, Math.min(1, building.constructionProgress)), style.activityBarHeightPx);
      ctx.restore();
    }
  }

  root.OrbitBuildingRenderer = Object.freeze({ renderPhysical, renderAnchors, renderCards, pinGeometry, pinScale });
})(globalThis);
