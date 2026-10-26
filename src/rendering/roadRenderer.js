(function (root) {
  'use strict';

  const Style = root.OrbitRoadConfig.render, Weights = root.OrbitRoadConfig.weights;

  function roadRuns(frame, segment, opacity = 1, color = Style.landColor, waterOpacity = Style.waterOpacity, drawDots = true) {
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
        if (drawDots) waterProgress = drawWaterDots(ctx, screenA, screenB, waterProgress, opacity, color, waterOpacity);
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

  function marineRun(frame, segment, opacity = Style.marineOpacity) {
    const points = segment.points, projected = points.map(point => frame.project(point.x, point.y));
    const ctx = frame.context;
    let remaining = Number.isFinite(segment.builtLength)
      ? Math.max(0, Math.min(segment.length, segment.builtLength)) : segment.length;
    if (remaining <= 0) return;
    ctx.save(); ctx.strokeStyle = Style.marineColor; ctx.globalAlpha = opacity;
    ctx.lineWidth = Style.marineWidthPx; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash(Style.marineDashPx); ctx.beginPath(); ctx.moveTo(projected[0].x, projected[0].y);
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

  function reachesNode(segment, nodeId) {
    const builtLength = Number.isFinite(segment.builtLength) ? segment.builtLength : segment.length;
    if (segment.from === nodeId) return builtLength > 1e-5;
    if (segment.to === nodeId) return builtLength >= segment.length - 1e-5;
    return false;
  }

  function reachedIntersection(network, node) {
    const reachedRoutes = new Set();
    for (const segment of network.segments) {
      if ((segment.from === node.id || segment.to === node.id) && reachesNode(segment, node.id)) {
        reachedRoutes.add(segment.routeId || segment.id);
      }
      if (reachedRoutes.size >= 2) return true;
    }
    return false;
  }

  function drawWaterDots(ctx, a, b, progress, opacity = 1, color = Style.waterColor, waterOpacity = Style.waterOpacity) {
    const length = Math.hypot(b.x - a.x, b.y - a.y), spacing = Style.waterDotSpacingPx;
    if (length < .1) return progress;
    ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = waterOpacity * opacity;
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

  // Cells of the rivers the map draws, per terrain, for bridges.
  const riverCellCache = new WeakMap();
  function riverCells(terrain) {
    if (riverCellCache.has(terrain)) return riverCellCache.get(terrain);
    const cells = new Set();
    for (const course of terrain.rivers || []) for (let i = 0; i < course.points.length; i += 2) {
      if (course.flows[i / 2] >= Weights.bridgeMinFlow) cells.add(course.points[i + 1] * terrain.width + course.points[i]);
    }
    riverCellCache.set(terrain, cells);
    return cells;
  }

  // Bridge positions of a land segment, in world units, where it enters a river.
  const bridgeCache = new WeakMap();
  function bridges(segment, terrain) {
    if (!terrain?.rivers || segment.routeType === 'marine') return [];
    if (bridgeCache.has(segment.points)) return bridgeCache.get(segment.points);
    const scale = root.OrbitConfig.terrain.textureScale, cells = riverCells(terrain), found = [];
    let wasRiver = false, lastDistance = -Infinity, walked = 0;
    for (let i = 1; i < segment.points.length; i++) {
      const a = segment.points[i - 1], b = segment.points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
      const cell = Math.round(b.y / scale) * terrain.width + Math.round(b.x / scale);
      const river = cells.has(cell) && !segment.surfaceTypes?.[i - 1];
      walked += length;
      if (river && !wasRiver && walked - lastDistance > scale * 2 && length > 1e-6) {
        found.push({ x: b.x, y: b.y, angle: Math.atan2(b.y - a.y, b.x - a.x), distance: walked });
        lastDistance = walked;
      }
      wasRiver = river;
    }
    bridgeCache.set(segment.points, found);
    return found;
  }

  function drawBridges(frame, segment) {
    const built = Number.isFinite(segment.builtLength) ? segment.builtLength : segment.length, ctx = frame.context;
    for (const bridge of bridges(segment, frame.terrain)) {
      if (bridge.distance > built) break;
      const point = frame.project(bridge.x, bridge.y), along = Style.bridgeLengthPx / 2, side = Style.bridgeOffsetPx;
      const cos = Math.cos(bridge.angle), sin = Math.sin(bridge.angle);
      ctx.beginPath();
      for (const offset of [-side, side]) {
        ctx.moveTo(point.x - cos * along - sin * offset, point.y - sin * along + cos * offset);
        ctx.lineTo(point.x + cos * along - sin * offset, point.y + sin * along + cos * offset);
      }
      ctx.stroke();
    }
  }

  function drawJunction(ctx, point) {
    const size = Style.junctionHalfSizePx;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - size); ctx.lineTo(point.x + size, point.y);
    ctx.lineTo(point.x, point.y + size); ctx.lineTo(point.x - size, point.y); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  function render(frame) {
    const network = frame.state.roadNetworks?.[frame.planet.id];
    const ctx = frame.context;
    if (network) {
      const segments = network.segments.filter(segment => segment.points?.length >= 2 && visible(frame, segment));
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // Glow passes first, then the white core with its causeway dots.
      for (const pass of Style.glowPasses) {
        ctx.strokeStyle = Style.glowColor; ctx.lineWidth = pass.widthPx; ctx.globalAlpha = pass.opacity;
        for (const segment of segments) if (segment.routeType !== 'marine') roadRuns(frame, segment, 1, Style.landColor, 0, false);
      }
      ctx.strokeStyle = Style.landColor; ctx.lineWidth = Style.landWidthPx; ctx.globalAlpha = Style.landOpacity;
      for (const segment of segments) {
        if (segment.routeType === 'marine') marineRun(frame, segment);
        else roadRuns(frame, segment, 1, Style.waterColor);
      }
      ctx.strokeStyle = Style.bridgeColor; ctx.lineWidth = Style.bridgeWidthPx; ctx.globalAlpha = Style.landOpacity;
      for (const segment of segments) drawBridges(frame, segment);
      for (const segment of segments) drawConstructionHead(frame, segment);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = Style.junctionFill; ctx.strokeStyle = Style.junctionColor; ctx.lineWidth = Style.junctionLineWidthPx;
      ctx.shadowColor = Style.glowColor; ctx.shadowBlur = 8;
      for (const node of network.nodes) {
        if ((node.type !== 'intersection' && node.isIntersection !== true) || !reachedIntersection(network, node)) continue;
        const point = frame.project(node.x, node.y), margin = Style.junctionHalfSizePx + 2;
        if (point.x < -margin || point.y < -margin || point.x > frame.viewport.width + margin || point.y > frame.viewport.height + margin) continue;
        drawJunction(ctx, point);
      }
      ctx.restore();
    }

    const preview = frame.state.roadPreview;
    if (preview?.points?.length >= 2) {
      const length = preview.points.slice(1).reduce((sum, point, index) =>
        sum + Math.hypot(point.x - preview.points[index].x, point.y - preview.points[index].y), 0);
      if (preview.routeType === 'marine') {
        marineRun(frame, { points: preview.points, length, builtLength: length }, Style.marineOpacity);
        return;
      }
      const opacity = Number.isFinite(preview.opacity) ? preview.opacity : .52;
      const color = preview.valid ? Style.landColor : (preview.color || Style.landColor);
      const lineWidth = Number.isFinite(preview.lineWidth) ? preview.lineWidth : Style.landWidthPx;
      const waterOpacity = Number.isFinite(preview.waterOpacity) ? preview.waterOpacity : Style.waterOpacity;
      const draft = { points: preview.points, surfaceTypes: preview.surfaceTypes || [], length, builtLength: length };
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (preview.valid) for (const pass of Style.glowPasses) {
        ctx.strokeStyle = Style.glowColor; ctx.lineWidth = pass.widthPx; ctx.globalAlpha = pass.opacity * opacity;
        roadRuns(frame, draft, opacity, color, 0, false);
      }
      ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.globalAlpha = opacity;
      ctx.setLineDash(preview.valid ? [] : (preview.dash || []));
      roadRuns(frame, draft, opacity, color, waterOpacity);
      ctx.restore();
    }
  }

  root.OrbitRoadRenderer = Object.freeze({ render });
})(globalThis);
