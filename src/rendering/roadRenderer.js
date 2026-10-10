(function (root) {
  'use strict';

  const Style = root.OrbitRoadConfig.render;

  function roadRuns(frame, segment) {
    const points = segment.points, projected = points.map(point => frame.project(point.x, point.y));
    const ctx = frame.context;
    let landOpen = false, waterOpen = false, waterProgress = Style.waterDotSpacingPx / 2;
    ctx.beginPath();
    for (let i = 1; i < points.length; i++) {
      const isWater = Boolean(segment.surfaceTypes?.[i - 1]);
      const screenA = projected[i - 1], screenB = projected[i];
      if (isWater) {
        if (landOpen) { ctx.stroke(); ctx.beginPath(); landOpen = false; }
        if (!waterOpen) waterProgress = Style.waterDotSpacingPx / 2;
        waterProgress = drawWaterDots(ctx, screenA, screenB, waterProgress);
        waterOpen = true;
      } else {
        waterOpen = false; waterProgress = Style.waterDotSpacingPx / 2;
        if (!landOpen) { ctx.moveTo(screenA.x, screenA.y); landOpen = true; }
        ctx.lineTo(screenB.x, screenB.y);
      }
    }
    if (landOpen) ctx.stroke();
    ctx.beginPath();
  }

  function drawWaterDots(ctx, a, b, progress) {
    const length = Math.hypot(b.x - a.x, b.y - a.y), spacing = Style.waterDotSpacingPx;
    if (length < .1) return progress;
    ctx.save(); ctx.fillStyle = Style.waterColor; ctx.globalAlpha = Style.waterOpacity;
    for (; progress < length; progress += spacing) {
      const t = progress / length;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      ctx.beginPath(); ctx.arc(x, y, Style.waterDotRadiusPx, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.beginPath();
    return progress - length;
  }

  function visible(frame, segment) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of segment.points) {
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
    const topLeft = frame.project(minX, minY), bottomRight = frame.project(maxX, maxY), margin = 12;
    return bottomRight.x >= -margin && topLeft.x <= frame.viewport.width + margin &&
      bottomRight.y >= -margin && topLeft.y <= frame.viewport.height + margin;
  }

  function render(frame) {
    const network = frame.state.roadNetworks?.[frame.planet.id];
    if (!network) return;
    const ctx = frame.context;
    ctx.save(); ctx.strokeStyle = Style.landColor; ctx.lineWidth = Style.landWidthPx;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = Style.landOpacity;
    for (const segment of network.segments) {
      if (segment.points?.length < 2 || !visible(frame, segment)) continue;
      roadRuns(frame, segment);
    }
    ctx.restore();
    ctx.fillStyle = Style.junctionColor; ctx.globalAlpha = Style.landOpacity;
    for (const node of network.nodes) {
      if (node.type !== 'intersection') continue;
      const point = frame.project(node.x, node.y);
      if (point.x < -4 || point.y < -4 || point.x > frame.viewport.width + 4 || point.y > frame.viewport.height + 4) continue;
      ctx.beginPath(); ctx.arc(point.x, point.y, Style.junctionRadiusPx, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  root.OrbitRoadRenderer = Object.freeze({ render });
})(globalThis);
