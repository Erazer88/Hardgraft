(function (root) {
  'use strict';

  const Style = root.OrbitRoadConfig.render;

  function roadRuns(frame, segment, opacity = 1, color = Style.landColor) {
    const points = segment.points, projected = points.map(point => frame.project(point.x, point.y));
    const ctx = frame.context;
    let landOpen = false, waterOpen = false, waterProgress = Style.waterDotSpacingPx / 2;
    let remaining = Number.isFinite(segment.builtLength)
      ? Math.max(0, Math.min(segment.length, segment.builtLength)) : segment.length;
    if (remaining <= 0) return;
    ctx.beginPath();
    for (let i = 1; i < points.length; i++) {
      const worldA = points[i - 1], worldB = points[i];
      const worldLength = Math.hypot(worldB.x - worldA.x, worldB.y - worldA.y);
      if (worldLength <= 1e-8) continue;
      const ratio = Math.min(1, remaining / worldLength);
      const isWater = Boolean(segment.surfaceTypes?.[i - 1]);
      const screenA = projected[i - 1], fullScreenB = projected[i];
      const screenB = ratio < 1 ? {
        x: screenA.x + (fullScreenB.x - screenA.x) * ratio,
        y: screenA.y + (fullScreenB.y - screenA.y) * ratio
      } : fullScreenB;
      if (isWater) {
        if (landOpen) { ctx.stroke(); ctx.beginPath(); landOpen = false; }
        if (!waterOpen) waterProgress = Style.waterDotSpacingPx / 2;
        waterProgress = drawWaterDots(ctx, screenA, screenB, waterProgress, opacity, color);
        waterOpen = true;
      } else {
        waterOpen = false; waterProgress = Style.waterDotSpacingPx / 2;
        if (!landOpen) { ctx.moveTo(screenA.x, screenA.y); landOpen = true; }
        ctx.lineTo(screenB.x, screenB.y);
      }
      remaining -= worldLength * ratio;
      if (ratio < 1 || remaining <= 1e-8) break;
    }
    if (landOpen) ctx.stroke();
    ctx.beginPath();
  }

  function reachesNode(segment, nodeId) {
    const builtLength = Number.isFinite(segment.builtLength) ? segment.builtLength : segment.length;
    if (segment.from === nodeId) return builtLength > 1e-5;
    if (segment.to === nodeId) return builtLength >= segment.length - 1e-5;
    return false;
  }

  function reachedIntersection(network, node) {
    let reachedRoads = 0;
    for (const segment of network.segments) {
      if ((segment.from === node.id || segment.to === node.id) && reachesNode(segment, node.id)) reachedRoads++;
      if (reachedRoads >= 2) return true;
    }
    return false;
  }

  function drawWaterDots(ctx, a, b, progress, opacity = 1, color = Style.waterColor) {
    const length = Math.hypot(b.x - a.x, b.y - a.y), spacing = Style.waterDotSpacingPx;
    if (length < .1) return progress;
    ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = Style.waterOpacity * opacity;
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

  function pointAtDistance(points, target) {
    let remaining = target;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
      if (remaining <= length) {
        const t = length > 0 ? remaining / length : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      remaining -= length;
    }
    return { ...points[points.length - 1] };
  }

  function drawConstructionHead(frame, segment) {
    const built = Number.isFinite(segment.builtLength) ? segment.builtLength : segment.length;
    if (built <= 0 || built >= segment.length || segment.points?.length < 2) return;
    const style = Style, point = pointAtDistance(segment.points, built), screen = frame.project(point.x, point.y);
    if (screen.x < -style.constructionPulseRadiusPx || screen.y < -style.constructionPulseRadiusPx ||
        screen.x > frame.viewport.width + style.constructionPulseRadiusPx ||
        screen.y > frame.viewport.height + style.constructionPulseRadiusPx) return;
    const phase = ((frame.now || 0) % style.constructionPulsePeriodMs) / style.constructionPulsePeriodMs;
    const eased = phase * phase * (3 - 2 * phase);
    const radius = style.constructionHeadRadiusPx + eased * (style.constructionPulseRadiusPx - style.constructionHeadRadiusPx);
    frame.context.save();
    frame.context.globalAlpha = style.constructionPulseOpacity * (1 - eased * .5);
    frame.context.strokeStyle = style.constructionColor;
    frame.context.lineWidth = 1;
    frame.context.beginPath(); frame.context.arc(screen.x, screen.y, radius, 0, Math.PI * 2); frame.context.stroke();
    frame.context.globalAlpha = .8;
    frame.context.fillStyle = style.constructionColor;
    frame.context.beginPath(); frame.context.arc(screen.x, screen.y, style.constructionHeadRadiusPx * .65, 0, Math.PI * 2); frame.context.fill();
    frame.context.restore();
  }

  function render(frame) {
    const network = frame.state.roadNetworks?.[frame.planet.id];
    const ctx = frame.context;
    if (network) {
      ctx.save(); ctx.strokeStyle = Style.landColor; ctx.lineWidth = Style.landWidthPx;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = Style.landOpacity;
      for (const segment of network.segments) {
        if (segment.points?.length < 2 || !visible(frame, segment)) continue;
        roadRuns(frame, segment);
        drawConstructionHead(frame, segment);
      }
      ctx.restore();
      ctx.fillStyle = Style.junctionColor; ctx.globalAlpha = Style.landOpacity;
      for (const node of network.nodes) {
        if (node.type !== 'intersection' || !reachedIntersection(network, node)) continue;
        const point = frame.project(node.x, node.y);
        if (point.x < -4 || point.y < -4 || point.x > frame.viewport.width + 4 || point.y > frame.viewport.height + 4) continue;
        ctx.beginPath(); ctx.arc(point.x, point.y, Style.junctionRadiusPx, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const preview = frame.state.roadPreview;
    if (preview?.points?.length >= 2) {
      const length = preview.points.slice(1).reduce((sum, point, index) =>
        sum + Math.hypot(point.x - preview.points[index].x, point.y - preview.points[index].y), 0);
      const opacity = Number.isFinite(preview.opacity) ? preview.opacity : .52;
      const color = preview.valid ? Style.landColor : (preview.color || Style.landColor);
      const lineWidth = Number.isFinite(preview.lineWidth) ? preview.lineWidth : Style.landWidthPx;
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = opacity;
      roadRuns(frame, { points: preview.points, surfaceTypes: preview.surfaceTypes || [], length, builtLength: length }, opacity, color);
      ctx.restore();
    }
  }

  root.OrbitRoadRenderer = Object.freeze({ render });
})(globalThis);
