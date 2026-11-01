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
    if (icon === 'datacenter') {
      // Racks of servers.
      for (const offset of [-.42, 0, .42]) {
        ctx.rect(x + size * (offset - .16), y - size * .55, size * .32, size * 1.1);
        ctx.moveTo(x + size * (offset - .08), y - size * .3); ctx.lineTo(x + size * (offset + .08), y - size * .3);
        ctx.moveTo(x + size * (offset - .08), y + size * .05); ctx.lineTo(x + size * (offset + .08), y + size * .05);
      }
      ctx.stroke(); return;
    }
    if (icon === 'antenna') {
      // A dish on its mast, beaming.
      ctx.moveTo(x - size * .55, y - size * .05); ctx.quadraticCurveTo(x - size * .1, y + size * .55, x + size * .45, y + size * .2);
      ctx.closePath();
      ctx.moveTo(x - size * .05, y + size * .32); ctx.lineTo(x - size * .2, y + size * .7); ctx.lineTo(x + size * .25, y + size * .7);
      ctx.moveTo(x - size * .05, y + size * .12); ctx.lineTo(x + size * .35, y - size * .4);
      ctx.moveTo(x + size * .45, y - size * .62); ctx.quadraticCurveTo(x + size * .68, y - size * .55, x + size * .72, y - size * .3);
      ctx.stroke(); return;
    }
    if (icon === 'hf-antenna') {
      // A tall mast with rings of high-frequency waves.
      ctx.moveTo(x, y + size * .7); ctx.lineTo(x, y - size * .45);
      ctx.moveTo(x - size * .35, y + size * .7); ctx.lineTo(x, y + size * .1); ctx.lineTo(x + size * .35, y + size * .7);
      for (const r of [.28, .52]) {
        ctx.moveTo(x - size * r, y - size * (.45 + r * .4)); ctx.quadraticCurveTo(x - size * (r + .12), y - size * .45, x - size * r, y - size * (.45 - r * .4));
        ctx.moveTo(x + size * r, y - size * (.45 + r * .4)); ctx.quadraticCurveTo(x + size * (r + .12), y - size * .45, x + size * r, y - size * (.45 - r * .4));
      }
      ctx.stroke(); return;
    }
    if (icon === 'lab') {
      // A flask.
      ctx.moveTo(x - size * .16, y - size * .66); ctx.lineTo(x - size * .16, y - size * .15); ctx.lineTo(x - size * .55, y + size * .6);
      ctx.lineTo(x + size * .55, y + size * .6); ctx.lineTo(x + size * .16, y - size * .15); ctx.lineTo(x + size * .16, y - size * .66);
      ctx.moveTo(x - size * .26, y - size * .66); ctx.lineTo(x + size * .26, y - size * .66);
      ctx.moveTo(x - size * .36, y + size * .25); ctx.lineTo(x + size * .36, y + size * .25);
      ctx.stroke(); return;
    }
    if (icon === 'ark') {
      // The mothership: a long hull, its bridge and two wings.
      ctx.ellipse(x, y, size * .72, size * .2, 0, 0, Math.PI * 2);
      ctx.moveTo(x - size * .2, y - size * .2); ctx.lineTo(x - size * .45, y - size * .58); ctx.lineTo(x - size * .02, y - size * .2);
      ctx.moveTo(x - size * .2, y + size * .2); ctx.lineTo(x - size * .45, y + size * .58); ctx.lineTo(x - size * .02, y + size * .2);
      ctx.moveTo(x + size * .3, y - size * .06); ctx.lineTo(x + size * .5, y - size * .06);
      ctx.stroke(); return;
    }
    if (icon === 'survey') {
      // A sight over the ground: crosshair and relief.
      ctx.arc(x, y - size * .12, size * .36, 0, Math.PI * 2);
      ctx.moveTo(x, y - size * .62); ctx.lineTo(x, y - size * .36); ctx.moveTo(x, y + size * .12); ctx.lineTo(x, y + size * .38);
      ctx.moveTo(x - size * .62, y - size * .12); ctx.lineTo(x - size * .36, y - size * .12);
      ctx.moveTo(x + size * .36, y - size * .12); ctx.lineTo(x + size * .62, y - size * .12);
      ctx.moveTo(x - size * .74, y + size * .62); ctx.lineTo(x - size * .32, y + size * .3); ctx.lineTo(x - size * .05, y + size * .5);
      ctx.lineTo(x + size * .3, y + size * .22); ctx.lineTo(x + size * .74, y + size * .62);
      ctx.stroke(); return;
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

  // A beacon's look (glowing hexagon and icon) is drawn once per icon, color,
  // size (to a quarter pixel) and finished state, at the screen's pixel
  // ratio, then stamped each frame: no blur is computed per frame.
  const pinSprites = new Map();
  function pinSprite(icon, color, radius, complete, ratio) {
    const key = `${icon}|${color}|${radius}|${complete ? 1 : 0}|${ratio}`;
    let sprite = pinSprites.get(key);
    if (sprite) return sprite;
    if (pinSprites.size > 500) pinSprites.clear();
    const pin = Style.buildings.pin, scale = radius / pin.headRadiusPx;
    const half = radius + pin.rimWidthPx + pin.glowBlurPx * 1.6 / ratio + 2, size = Math.ceil(half * 2 * ratio);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, size / 2, size / 2);
    ctx.shadowColor = color;
    hexagon(ctx, 0, 0, radius);
    ctx.strokeStyle = pin.rimColor; ctx.lineWidth = pin.rimWidthPx; ctx.stroke();
    ctx.strokeStyle = color; ctx.shadowBlur = pin.glowBlurPx;
    ctx.fillStyle = pin.fill; ctx.fill();
    ctx.lineWidth = pin.lineWidthPx; ctx.setLineDash(complete ? [] : [3, 2.5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    drawGlyph(ctx, 0, 0, pin.glyphSizePx * scale, pin.glyphColor, icon, pin.glyphLineWidthPx * Math.sqrt(scale));
    sprite = { canvas, half: size / 2 / ratio };
    pinSprites.set(key, sprite);
    return sprite;
  }

  function drawPin(frame, building, definition, ghost = false) {
    const ctx = frame.context, pin = Style.buildings.pin, { head, radius } = pinGeometry(frame, building);
    const selected = frame.state.selected?.kind === 'building' && frame.state.selected.id === building.id;
    const complete = ghost || building.constructionState === 'complete';
    const color = ghost ? (frame.state.placement?.valid ? '#7ebfba' : '#e57870')
      : pin.categoryColors[definition.category] || pin.defaultColor;
    const ratio = frame.pixelRatio || 1;
    const sprite = pinSprite(definition.icon, color, Math.round(radius * 4) / 4, complete, ratio);
    ctx.save();
    ctx.globalAlpha = ghost ? pin.ghostOpacity : complete ? 1 : pin.constructionOpacity + (1 - pin.constructionOpacity) * .5;
    // Stamped on whole device pixels, so it stays sharp.
    const left = Math.round((head.x - sprite.half) * ratio) / ratio, top = Math.round((head.y - sprite.half) * ratio) / ratio;
    ctx.drawImage(sprite.canvas, left, top, sprite.half * 2, sprite.half * 2);
    if (!complete) {
      // Construction progress runs around the head.
      // A site waiting for deliveries shows how much of them arrived.
      const done = building.constructionState === 'supplying'
        ? root.OrbitConstruction?.supplyFraction(building) || 0 : building.constructionProgress || 0;
      const progress = Math.max(0, Math.min(1, done));
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
    if (ghost) {
      const head = pinGeometry(frame, building).head;
      ctx.save(); ctx.font = `${root.OrbitTextScale.px(8)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`${definition.label} · EMPLACEMENT ${frame.state.placement?.valid ? 'VALIDE' : 'INVALIDE'}`,
        head.x + pinGeometry(frame, building).radius + 6, head.y);
      ctx.restore();
    }
    return color;
  }

  // Labels of the beacons: each building's name above it, the colony's
  // population under it. Names show once beacons are big enough; then each
  // label is placed by priority (selected, colony, hub, others) and left out
  // where it would cover a label already placed or another beacon.
  const LABEL_FONT = 'ui-monospace, SFMono-Regular, Consolas, monospace';
  function beaconLabels(frame, building, definition, color) {
    const style = Style.buildings.name, colonyStyle = Style.colonyZone, pin = Style.buildings.pin;
    const { head, radius, scale } = pinGeometry(frame, building);
    const selected = frame.state.selected?.kind === 'building' && frame.state.selected.id === building.id;
    const priority = selected ? 3 : building.type === 'colony' ? 2 : building.type === 'launch_platform' ? 1 : 0;
    const labels = [];
    if (building.type === 'colony') {
      const size = root.OrbitTextScale.px(colonyStyle.labelSizePx);
      labels.push({ priority: 2.5, text: `${new Intl.NumberFormat('fr-FR').format(building.colony?.population || 0)} HAB.`,
        x: head.x, top: head.y + radius + 6, size, pad: 12, color: pin.categoryColors.colony, fill: pin.readoutFill, owner: building.id });
    }
    if (building.customName && (selected || scale >= style.minPinScale)) {
      const factor = Math.max(style.minFactor, Math.min(style.maxFactor, scale ** style.zoomFollow));
      const size = root.OrbitTextScale.px(style.sizePx, style.scaleDamping ?? 1) * factor;
      // Above the beacon, or under it when the space above is taken.
      labels.push({ priority, text: building.customName, x: head.x, bottom: head.y - radius - style.gapPx,
        below: head.y + radius + style.gapPx, size, pad: 10, color, fill: style.fill, owner: building.id });
    }
    return labels;
  }

  // A label (rounded box and text) is drawn once per text, size, colors and
  // pixel ratio, then stamped; sizes go by half pixels.
  const labelSprites = new Map();
  function labelSprite(label, ratio) {
    const size = Math.round(label.size * 2) / 2;
    const key = `${label.text}|${size}|${label.color}|${label.fill}|${label.pad}|${ratio}`;
    let sprite = labelSprites.get(key);
    if (sprite) return sprite;
    if (labelSprites.size > 800) labelSprites.clear();
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    ctx.font = `600 ${size}px ${LABEL_FONT}`;
    const width = Math.ceil(ctx.measureText(label.text).width + label.pad), height = size + 6;
    canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = label.fill; ctx.beginPath(); ctx.roundRect(0, 0, width, height, 3); ctx.fill();
    ctx.font = `600 ${size}px ${LABEL_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = label.color; ctx.fillText(label.text, width / 2, height / 2 + .5);
    sprite = { canvas, width, height };
    labelSprites.set(key, sprite);
    return sprite;
  }

  function drawLabels(frame, labels, beacons) {
    const ctx = frame.context, margin = Style.buildings.name.marginPx, ratio = frame.pixelRatio || 1;
    const placed = [];
    const overlaps = (a, b) => a.x0 < b.x1 + margin && b.x0 < a.x1 + margin && a.y0 < b.y1 + margin && b.y0 < a.y1 + margin;
    for (const label of labels.map((item, index) => ({ ...item, index })).sort((a, b) => b.priority - a.priority || a.index - b.index)) {
      const sprite = labelSprite(label, ratio), { width, height } = sprite;
      const tops = label.top !== undefined ? [label.top] : [label.bottom - height, ...(label.below !== undefined ? [label.below] : [])];
      // The selected name always shows; the colony's labels only give way to
      // it; the other names also leave the beacons in view.
      const free = box => label.priority >= 3 || !placed.some(other => overlaps(box, other)) &&
        (label.priority >= 2 || !beacons.some(beacon => beacon.owner !== label.owner && overlaps(box, beacon)));
      const box = tops.map(y0 => ({ x0: label.x - width / 2, x1: label.x + width / 2, y0, y1: y0 + height })).find(free);
      if (!box) continue;
      placed.push(box);
      ctx.drawImage(sprite.canvas, Math.round(box.x0 * ratio) / ratio, Math.round(box.y0 * ratio) / ratio, width, height);
    }
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

  // The data network: faint lines from working buildings to their dish, a
  // moving dashed beam from each dish to its datacenter, and the dish's range
  // while it is placed or selected. Purely visual (state.dataLinks).
  // An antenna's relief view: within its range, the ground its mast sees is
  // lit, the ground hidden behind the relief is veiled. One small image per
  // antenna position (a pixel per terrain cell), drawn to scale.
  const coverageCache = new Map();
  function coverage(frame, dish) {
    const Sight = root.OrbitLineOfSight, terrain = frame.terrain, antenna = root.OrbitDataNetworkData?.antenna;
    if (!Sight || !terrain?.elevation || !antenna || !root.document) return null;
    const key = `${frame.planet.id}|${dish.x}|${dish.y}`;
    const cached = coverageCache.get(key);
    if (cached?.terrain === terrain) return cached;
    if (coverageCache.size > 8) coverageCache.clear();
    const view = Sight.viewshed(terrain, dish, antenna.mastHeightM, antenna.rangeKm, antenna.buildingHeightM);
    const canvas = root.document.createElement('canvas'); canvas.width = canvas.height = view.size;
    const context = canvas.getContext('2d'), image = context.createImageData(view.size, view.size);
    const [seen, hidden] = [Style.dataLinks.coverageSeen, Style.dataLinks.coverageHidden];
    for (let index = 0; index < view.cells.length; index++) {
      const color = view.cells[index] === 2 ? seen : view.cells[index] === 1 ? hidden : null;
      if (color) image.data.set(color, index * 4);
    }
    context.putImageData(image, 0, 0);
    const entry = { terrain, canvas, view };
    coverageCache.set(key, entry);
    return entry;
  }

  function drawReliefView(frame, dish) {
    const ctx = frame.context, entry = coverage(frame, dish);
    if (!entry) return;
    const { view } = entry, origin = frame.project(view.originCellX * view.cellKm, view.originCellY * view.cellKm);
    const size = view.size * view.cellKm * frame.zoom;
    ctx.save(); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(entry.canvas, origin.x, origin.y, size, size);
    ctx.restore();
    // Buildings sending data within reach: a green line to those the mast
    // sees, a red one to those behind the relief.
    const Network = root.OrbitDataNetwork, sources = root.OrbitDataNetworkData?.sources || {};
    const range = root.OrbitDataNetworkData.antenna.rangeKm, terrainOf = () => frame.terrain;
    const mast = { ...dish, type: 'antenna', planetId: frame.planet.id }, top = frame.project(dish.x, dish.y);
    ctx.save(); ctx.lineWidth = 1.2; ctx.setLineDash([3, 4]);
    for (const building of visibleBuildings(frame)) {
      if (!sources[building.type] || building.id === dish.id || Math.hypot(building.x - dish.x, building.y - dish.y) > range) continue;
      const point = frame.project(building.x, building.y), seen = Network?.relaySees(terrainOf, mast, building) !== false;
      ctx.strokeStyle = seen ? Style.dataLinks.seenColor : Style.dataLinks.blockedColor; ctx.globalAlpha = .85;
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(point.x, point.y); ctx.stroke();
    }
    ctx.restore();
  }

  // A wind turbine's view, while one is placed or selected: the wind of the
  // whole planet (green where turbines catch more, red where less, see-
  // through over the relief) and the wake of each turbine standing.
  const windCache = new WeakMap();
  function windLayer(terrain) {
    const Wind = root.OrbitWindPower, wind = root.OrbitProcessData?.config.wind;
    if (!Wind || !wind || !terrain?.elevation || !root.document) return null;
    if (windCache.has(terrain)) return windCache.get(terrain);
    const factors = Wind.siteGrid(terrain), style = Style.windView;
    const canvas = root.document.createElement('canvas'); canvas.width = terrain.width; canvas.height = terrain.height;
    const context = canvas.getContext('2d'), image = context.createImageData(terrain.width, terrain.height);
    // Colour and opacity follow the site factor along the style's stops:
    // red toward nothing, orange, pale yellow midway, then green.
    const stops = style.stops, colour = factor => {
      if (factor <= stops[0][0]) return [...stops[0][1], stops[0][2]];
      for (let index = 1; index < stops.length; index++) {
        const [to, toRgb, toAlpha] = stops[index], [from, fromRgb, fromAlpha] = stops[index - 1];
        if (factor > to) continue;
        const t = (factor - from) / (to - from);
        return [...fromRgb.map((value, channel) => Math.round(value + (toRgb[channel] - value) * t)), Math.round(fromAlpha + (toAlpha - fromAlpha) * t)];
      }
      const last = stops[stops.length - 1];
      return [...last[1], last[2]];
    };
    for (let cell = 0; cell < factors.length; cell++) if (factors[cell]) image.data.set(colour(factors[cell]), cell * 4);
    context.putImageData(image, 0, 0);
    windCache.set(terrain, canvas);
    return canvas;
  }

  function renderWindView(frame) {
    const state = frame.state, ctx = frame.context, wind = root.OrbitProcessData?.config.wind;
    const placing = state.tool === 'build' && state.placement?.type === 'wind_turbine' ? state.placement : null;
    const selected = state.selected?.kind === 'building' && state.selected.type === 'wind_turbine' ? state.selected : null;
    if ((!placing && !selected) || !wind) return;
    const layer = windLayer(frame.terrain);
    if (layer) {
      const top = frame.project(0, 0), scale = root.OrbitConfig.terrain.textureScale * frame.zoom;
      ctx.save(); ctx.imageSmoothingEnabled = true;
      ctx.drawImage(layer, top.x, top.y, layer.width * scale, layer.height * scale);
      ctx.restore();
    }
    // Each turbine's wake: a turbine set inside loses wind, the more the closer.
    const style = Style.windView;
    ctx.save(); ctx.setLineDash([5, 5]); ctx.lineWidth = 1.3;
    for (const turbine of visibleBuildings(frame)) {
      if (turbine.type !== 'wind_turbine') continue;
      const point = frame.project(turbine.x, turbine.y), radius = wind.wakeRadiusKm * frame.zoom;
      ctx.globalAlpha = .12; ctx.fillStyle = style.wakeColor;
      ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = .8; ctx.strokeStyle = style.wakeColor; ctx.stroke();
    }
    if (placing) {
      const point = frame.project(placing.x, placing.y);
      ctx.globalAlpha = .7; ctx.strokeStyle = style.ownWakeColor;
      ctx.beginPath(); ctx.arc(point.x, point.y, wind.wakeRadiusKm * frame.zoom, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function renderDataLinks(frame) {
    const state = frame.state, style = Style.dataLinks, ctx = frame.context;
    // The relief view of the antenna being placed or selected, under its links.
    const viewed = state.tool === 'build' && state.placement?.type === 'antenna' ? state.placement
      : state.selected?.kind === 'building' && state.selected.type === 'antenna' ? state.selected : null;
    if (viewed) drawReliefView(frame, viewed);
    // A dotted blue line with a few small packets gliding along it.
    const beam = (from, to) => {
      ctx.save();
      ctx.strokeStyle = style.color; ctx.globalAlpha = style.beamOpacity; ctx.lineWidth = style.beamWidthPx; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = style.packetOpacity; ctx.fillStyle = style.packetColor;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const count = Math.max(1, Math.min(style.packetsMax, Math.round(length / style.packetSpacingPx)));
      const cycle = ((frame.now || 0) % style.packetMs) / style.packetMs;
      for (let index = 0; index < count; index++) {
        const t = (cycle + index / count) % 1;
        const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, size = style.packetSizePx;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
      ctx.restore();
    };
    const byId = new Map(visibleBuildings(frame).map(building => [building.id, building]));
    const range = root.OrbitDataNetworkData?.antenna.rangeKm || 0;
    ctx.save();
    for (const link of Object.values(state.dataLinks || {})) {
      const dish = byId.get(link.antennaId);
      if (!dish) continue;
      const to = frame.project(dish.x, dish.y);
      ctx.strokeStyle = style.color; ctx.globalAlpha = style.sourceOpacity; ctx.lineWidth = style.sourceWidthPx; ctx.setLineDash([2, 4]);
      for (const id of link.sources) {
        const source = byId.get(id);
        if (!source) continue;
        const from = frame.project(source.x, source.y);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      }
      // Down the chain: to the next relay, or the datacenter at its end.
      const next = byId.get(link.nextId);
      if (next && link.carried > 0) beam(to, frame.project(next.x, next.y));
    }
    // Each datacenter's analyses go to its high-frequency antenna.
    for (const center of byId.values()) {
      if (center.type !== 'datacenter' || center.constructionState !== 'complete') continue;
      const antenna = root.OrbitDataNetwork?.uplinkAntenna(state, center);
      if (antenna) beam(frame.project(center.x, center.y), frame.project(antenna.x, antenna.y));
    }
    // Ranges: the antenna being placed or selected, and, while placing any
    // piece of the network, every relay already standing (to plan the chain).
    const placing = state.tool === 'build' && state.placement?.type === 'antenna' ? state.placement : null;
    const selected = state.selected?.kind === 'building' && state.selected.type === 'antenna' ? state.selected : null;
    const planning = state.tool === 'build' && ['antenna', 'datacenter', 'hf_antenna'].includes(state.placement?.type);
    const standing = planning ? [...byId.values()].filter(building => building.type === 'antenna') : [];
    for (const dish of [placing, selected, ...standing].filter(Boolean)) {
      const point = frame.project(dish.x, dish.y);
      ctx.globalAlpha = style.rangeOpacity; ctx.strokeStyle = style.color; ctx.lineWidth = 1.4; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(point.x, point.y, range * frame.zoom, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function renderPhysical(frame) {
    // Device pixels per screen pixel, for sprites drawn at full sharpness.
    frame.pixelRatio = Math.abs(frame.context.getTransform?.().a || 1);
    renderColonyZones(frame);
    renderLatitudeGrid(frame);
    renderWindView(frame);
    renderDataLinks(frame);
    const labels = [], beacons = [];
    for (const building of visibleBuildings(frame)) {
      const definition = Data.get(building.type);
      if (!definition) continue;
      const color = drawFootprint(frame, building, definition);
      const { head, radius } = pinGeometry(frame, building);
      beacons.push({ owner: building.id, x0: head.x - radius * .87, x1: head.x + radius * .87, y0: head.y - radius, y1: head.y + radius });
      labels.push(...beaconLabels(frame, building, definition, color));
    }
    drawLabels(frame, labels, beacons);
    const preview = frame.state.placement;
    if (frame.state.tool === 'build' && preview) {
      const definition = Data.get(preview.type);
      if (definition) drawFootprint(frame, preview, definition, true);
    }
  }

  // A building's badge for its sheet: the beacon's hexagon and icon, drawn
  // into a small canvas of its own.
  // Badges for things that are not buildings: the Ark and a ground survey.
  const OTHER_BADGES = { ark: { icon: 'ark', color: '#ffd27b' }, survey: { icon: 'survey', color: '#9fd8ff' } };
  function drawBadge(canvas, type) {
    const ctx = canvas.getContext('2d'), pin = Style.buildings.pin;
    const building = Data.get(type), definition = building || OTHER_BADGES[type];
    if (!ctx || !definition) return;
    const size = canvas.width, center = size / 2,
      color = building ? pin.categoryColors[building.category] || pin.defaultColor : definition.color;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = size * .12;
    hexagon(ctx, center, center, size * .4); ctx.fillStyle = '#0b1928'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = size * .035; ctx.stroke();
    ctx.shadowBlur = 0;
    drawGlyph(ctx, center, center, size * .36, color, definition.icon, size * .035);
    ctx.restore();
  }

  root.OrbitBuildingRenderer = Object.freeze({ renderPhysical, pinGeometry, pinScale, drawBadge });
})(globalThis);
