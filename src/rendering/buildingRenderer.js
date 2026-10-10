(function (root) {
  'use strict';

  const Data = root.OrbitBuildingData, Style = root.OrbitSurfaceStyle;

  function visibleBuildings(frame) {
    return (frame.state.surfaceBuildings || []).filter(building => building.planetId === frame.planet.id);
  }

  function drawGlyph(ctx, x, y, size, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
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

  function drawFootprint(frame, building, definition, ghost = false) {
    const ctx = frame.context, center = frame.project(building.x, building.y), scale = frame.zoom;
    const width = definition.footprint.width * scale, height = definition.footprint.height * scale;
    const selected = frame.state.selected?.kind === 'building' && frame.state.selected.id === building.id;
    const color = ghost ? (frame.state.placement?.valid ? '#7ebfba' : '#e57870') :
      selected ? Style.buildings.selectedOutlineColor : '#aebfba';
    ctx.save(); ctx.translate(center.x, center.y); ctx.rotate(building.rotation || 0);
    ctx.fillStyle = ghost ? (frame.state.placement?.valid ? '#76bdb522' : '#e5787022') : '#0b1a24b8';
    ctx.strokeStyle = color; ctx.lineWidth = ghost ? 1.4 : 1.1; ctx.setLineDash(ghost ? [5, 4] : []);
    ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.strokeRect(-width / 2, -height / 2, width, height);
    ctx.setLineDash([]);
    const glyphSize = Math.max(7, Math.min(13, Math.min(width, height) * .45));
    drawGlyph(ctx, 0, 0, glyphSize, color);
    ctx.restore();

    const port = portPoint(building, definition);
    if (port) {
      const screenPort = frame.project(port.x, port.y);
      ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = '#0b1826'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(screenPort.x, screenPort.y);
      if (ghost) ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(screenPort.x, screenPort.y, ghost ? 4 : 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    if (ghost) {
      ctx.save(); ctx.font = '8px ui-monospace, SFMono-Regular, Consolas, monospace';
      ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(frame.state.placement?.valid ? 'USINE · EMPLACEMENT VALIDE' : 'USINE · EMPLACEMENT INVALIDE', center.x + 12, center.y - height / 2 - 9);
      ctx.restore();
    }
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
    if (frame.state.tool === 'build-factory' && preview) {
      const definition = Data.get(preview.type);
      if (definition) drawFootprint(frame, preview, definition, true);
    }
  }

  function renderAnchors(frame) {
    const ctx = frame.context, style = Style.buildings;
    for (const building of visibleBuildings(frame)) {
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
      drawGlyph(ctx, iconX, iconY, style.iconSizePx * .42, '#a8c0cc');
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

  root.OrbitBuildingRenderer = Object.freeze({ renderPhysical, renderAnchors, renderCards });
})(globalThis);
