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

  function portPoint(building, definition) {
    if (building.roadPort) return building.roadPort;
    const offset = definition.roadPortOffset;
    if (!offset) return null;
    const rotation = building.rotation || 0, cos = Math.cos(rotation), sin = Math.sin(rotation);
    return { x: building.x + offset.x * cos - offset.y * sin, y: building.y + offset.x * sin + offset.y * cos };
  }

  // Beacon geometry around a building's ground point, in screen pixels.
  function pinGeometry(frame, building) {
    const pin = Style.buildings.pin, ground = frame.project(building.x, building.y);
    return { ground, head: { x: ground.x, y: ground.y - pin.stemPx - pin.headRadiusPx }, radius: pin.headRadiusPx };
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
    const ctx = frame.context, pin = Style.buildings.pin, { ground, head, radius } = pinGeometry(frame, building);
    const selected = frame.state.selected?.kind === 'building' && frame.state.selected.id === building.id;
    const complete = ghost || building.constructionState === 'complete';
    const color = ghost ? (frame.state.placement?.valid ? '#7ebfba' : '#e57870')
      : pin.categoryColors[definition.category] || pin.defaultColor;
    ctx.save();
    ctx.globalAlpha = ghost ? pin.ghostOpacity : complete ? 1 : pin.constructionOpacity + (1 - pin.constructionOpacity) * .5;
    // Ground: a soft shadow and a glowing ring at the exact spot.
    ctx.fillStyle = 'rgba(4,10,20,.45)';
    ctx.beginPath(); ctx.ellipse(ground.x, ground.y, pin.groundShadowPx, pin.groundShadowPx * .42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.1; ctx.shadowColor = color; ctx.shadowBlur = pin.glowBlurPx * .6;
    ctx.beginPath(); ctx.ellipse(ground.x, ground.y, pin.groundRingPx, pin.groundRingPx * .55, 0, 0, Math.PI * 2); ctx.stroke();
    // Stem, then the head with its glow.
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ground.x, ground.y); ctx.lineTo(head.x, head.y + radius); ctx.stroke();
    hexagon(ctx, head.x, head.y, radius);
    ctx.shadowBlur = 0; ctx.strokeStyle = pin.rimColor; ctx.lineWidth = pin.rimWidthPx; ctx.stroke();
    ctx.strokeStyle = color; ctx.shadowBlur = pin.glowBlurPx;
    ctx.fillStyle = pin.fill; ctx.fill();
    ctx.lineWidth = pin.lineWidthPx; ctx.setLineDash(complete ? [] : [3, 2.5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    drawGlyph(ctx, head.x, head.y, pin.glyphSizePx, pin.glyphColor, definition.icon, pin.glyphLineWidthPx);
    if (!complete) {
      // Construction progress runs around the head.
      const progress = Math.max(0, Math.min(1, building.constructionProgress || 0));
      ctx.strokeStyle = pin.constructionColor; ctx.lineWidth = pin.progressWidthPx; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(head.x, head.y, radius + 5, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); ctx.stroke();
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

    const port = portPoint(building, definition);
    if (port) {
      const screenPort = frame.project(port.x, port.y);
      ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = ghost ? 1 : .55; ctx.fillStyle = '#0b1826'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(screenPort.x, screenPort.y);
      if (ghost) ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(screenPort.x, screenPort.y, ghost ? 4 : 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    const marineOffset = definition.marinePortOffset || definition.seaFacingOffset;
    const waterPort = building.waterPort || (marineOffset && pointOnBuilding(building, marineOffset));
    if (waterPort) {
      const screenPort = frame.project(waterPort.x, waterPort.y);
      ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = ghost ? 1 : .55; ctx.lineWidth = 1; ctx.setLineDash(ghost ? [3, 3] : []);
      ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(screenPort.x, screenPort.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(screenPort.x, screenPort.y, ghost ? 4 : 2.5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    drawPin(frame, building, definition, ghost);
    if (ghost) {
      const head = pinGeometry(frame, building).head;
      ctx.save(); ctx.font = '8px ui-monospace, SFMono-Regular, Consolas, monospace';
      ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`${definition.label} · EMPLACEMENT ${frame.state.placement?.valid ? 'VALIDE' : 'INVALIDE'}`,
        head.x + Style.buildings.pin.headRadiusPx + 6, head.y);
      ctx.restore();
    }
  }

  function pointOnBuilding(building, offset) {
    const rotation = building.rotation || 0, cos = Math.cos(rotation), sin = Math.sin(rotation);
    return { x: building.x + offset.x * cos - offset.y * sin, y: building.y + offset.x * sin + offset.y * cos };
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

  function renderPhysical(frame) {
    for (const building of visibleBuildings(frame)) {
      const definition = Data.get(building.type);
      if (definition) drawFootprint(frame, building, definition);
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
      ctx.font = `${style.titleSizePx}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      ctx.fillStyle = '#d0dee3'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(definition.label, iconX + style.iconRadiusPx + 8, card.y + 19);
      ctx.font = `${style.valueSizePx}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      ctx.fillStyle = building.constructionState === 'complete' ? '#809baa' : '#d7a66f';
      ctx.fillText(building.constructionState === 'complete' ? 'ASSEMBLÉE' : 'ASSEMBLAGE', iconX + style.iconRadiusPx + 8, card.y + 34);
      const barX = iconX + style.iconRadiusPx + 8, barY = card.y + card.height - 12;
      const barWidth = Math.max(10, card.width - (barX - card.x) - style.cardPaddingPx);
      ctx.fillStyle = '#52687866'; ctx.fillRect(barX, barY, barWidth, style.activityBarHeightPx);
      ctx.fillStyle = building.constructionState === 'complete' ? '#8bb1b8' : '#d7a66f';
      ctx.fillRect(barX, barY, barWidth * Math.max(0, Math.min(1, building.constructionProgress)), style.activityBarHeightPx);
      ctx.restore();
    }
  }

  root.OrbitBuildingRenderer = Object.freeze({ renderPhysical, renderAnchors, renderCards, pinGeometry });
})(globalThis);
