(function (root) {
  'use strict';

  const Style = root.OrbitSettlementConfig.render;
  const imageCache = new Map();

  function imageFor(path) {
    if (typeof root.Image !== 'function') return null;
    if (!imageCache.has(path)) {
      const image = new root.Image();
      image.src = path;
      imageCache.set(path, image);
    }
    return imageCache.get(path);
  }

  function isVisible(frame, x, y, margin) {
    const point = frame.project(x, y);
    return point.x >= -margin && point.y >= -margin &&
      point.x <= frame.viewport.width + margin && point.y <= frame.viewport.height + margin;
  }

  function drawRoad(frame, road) {
    const points = road.points || [], ctx = frame.context;
    let remaining = Number.isFinite(road.builtLength) ? Math.min(road.length, road.builtLength) : road.length;
    if (points.length < 2 || remaining <= 0) return;
    const projected = points.map(point => frame.project(point.x, point.y));
    ctx.save(); ctx.strokeStyle = Style.secondaryColor; ctx.globalAlpha = Style.secondaryOpacity;
    ctx.lineWidth = Style.secondaryWidthPx; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(projected[0].x, projected[0].y);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length <= 1e-8) continue;
      const ratio = Math.min(1, remaining / length), start = projected[i - 1], end = projected[i];
      ctx.lineTo(start.x + (end.x - start.x) * ratio, start.y + (end.y - start.y) * ratio);
      remaining -= length * ratio;
      if (ratio < 1 || remaining <= 1e-8) break;
    }
    ctx.stroke(); ctx.restore();
  }

  function drawAsset(frame, item, widthWorld, opacity) {
    if (!isVisible(frame, item.x, item.y, Style.cullMarginPx)) return;
    const image = imageFor(item.asset);
    if (!image?.complete || !image.naturalWidth) return;
    const size = widthWorld * frame.zoom;
    if (size < 1.6) return;
    const center = frame.project(item.x, item.y), aspect = image.naturalWidth / image.naturalHeight;
    const width = size, height = size / aspect, ctx = frame.context;
    ctx.save(); ctx.globalAlpha = opacity; ctx.translate(center.x, center.y); ctx.rotate(item.rotation || 0);
    ctx.drawImage(image, -width / 2, -height / 2, width, height); ctx.restore();
  }

  function render(frame) {
    if (frame.zoom < Style.minZoom) return;
    const settlement = frame.state.surfaceSettlements?.[frame.planet.id];
    if (!settlement) return;
    for (const road of settlement.roads || []) drawRoad(frame, road);
    for (const district of settlement.districts || []) {
      const road = settlement.roads.find(item => item.id === district.roadId);
      if (road && road.builtLength >= district.roadDistance) {
        drawAsset(frame, district, Style.districtWidthWorld, Style.spriteOpacity);
      }
    }
    for (const house of settlement.houses || []) {
      const road = settlement.roads.find(item => item.id === house.roadId);
      if (road && road.builtLength >= house.roadDistance) {
        drawAsset(frame, house, Style.houseWidthWorld, Style.spriteOpacity);
      }
    }
  }

  root.OrbitSettlementRenderer = Object.freeze({ render });
})(globalThis);
