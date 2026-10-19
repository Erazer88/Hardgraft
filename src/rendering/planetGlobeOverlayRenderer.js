(function (root) {
  'use strict';

  const Projection = root.OrbitPlanetGlobeProjection;
  const Style = root.OrbitPlanetGlobeStyle;
  const Buildings = root.OrbitBuildingData;
  const TAU = Math.PI * 2;
  const RESOURCE_ABBREVIATION = Object.freeze({ iron: 'Fe', copper: 'Cu', silicon: 'Si', carbon: 'C', oil: 'Hu' });
  const RESOURCE_DEPOSIT_STYLE = Object.freeze({
    iron: Object.freeze({ fill: '#ffd72c30', hatch: '#ffdb45e8', outline: '#fff0a0', glow: '#f1c623' }),
    copper: Object.freeze({ fill: '#ff943330', hatch: '#ff9d3de8', outline: '#ffd1a0', glow: '#ff832f' }),
    silicon: Object.freeze({ fill: '#45dff130', hatch: '#58efffe8', outline: '#b5faff', glow: '#32dcea' }),
    carbon: Object.freeze({ fill: '#b9eb3230', hatch: '#c6f34ae8', outline: '#edff9e', glow: '#a7d92c' }),
    oil: Object.freeze({ fill: '#ffad3030', hatch: '#ffbd43e8', outline: '#ffe0a1', glow: '#ff9f22' })
  });

  function create(canvas) {
    const ctx = canvas.getContext('2d', { alpha: true });
    let width = 1, height = 1, dpr = 1;
    let currentStyle = Style;
    const graticuleCache = new WeakMap();

    function resize(nextWidth, nextHeight, ratio) {
      width = Math.max(1, nextWidth); height = Math.max(1, nextHeight); dpr = Math.min(3, ratio || 1);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function mapProject(x, y, terrain, view) {
      const scale = root.OrbitConfig.terrain.textureScale;
      return Projection.projectSurfacePoint(x / scale, y / scale, terrain, view, currentStyle.relief);
    }

    function mapCoordinate(longitude, latitude, terrain) {
      return {
        x: (longitude / TAU + .5) * (terrain.width - 1),
        y: (.5 - latitude / Math.PI) * (terrain.height - 1)
      };
    }

    function graticuleFor(terrain) {
      const style = currentStyle.graticule;
      const cacheKey = JSON.stringify([style, currentStyle.relief]);
      const cached = graticuleCache.get(terrain);
      if (cached?.key === cacheKey) return cached.curves;
      const curves = [];
      function addCurve(points) {
        const values = new Float32Array(points.length * 3);
        for (let i = 0; i < points.length; i += 1) {
          const map = mapCoordinate(points[i][0], points[i][1], terrain);
          const point = Projection.surfacePosition(map.x, map.y, terrain, currentStyle.relief);
          values[i * 3] = point.x; values[i * 3 + 1] = point.y; values[i * 3 + 2] = point.z;
        }
        curves.push(values);
      }
      for (let longitudeDegrees = -150; longitudeDegrees <= 180; longitudeDegrees += style.longitudeStepDegrees) {
        const longitude = longitudeDegrees * Math.PI / 180, points = [];
        for (let latitudeDegrees = -84; latitudeDegrees <= 84; latitudeDegrees += style.sampleStepDegrees) {
          points.push([longitude, latitudeDegrees * Math.PI / 180]);
        }
        addCurve(points);
      }
      for (let latitudeDegrees = -60; latitudeDegrees <= 60; latitudeDegrees += style.latitudeStepDegrees) {
        const latitude = latitudeDegrees * Math.PI / 180, points = [];
        for (let longitudeDegrees = -174; longitudeDegrees <= 174; longitudeDegrees += style.sampleStepDegrees) {
          points.push([longitudeDegrees * Math.PI / 180, latitude]);
        }
        addCurve(points);
      }
      graticuleCache.set(terrain, { key: cacheKey, curves });
      return curves;
    }

    function drawGraticule(terrain, view, alpha) {
      const style = currentStyle.graticule, yaw = view.yaw || 0, pitch = view.pitch || 0;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
      const radius = Number.isFinite(view.radiusPx) ? view.radiusPx : Math.min(view.width, view.height) * .4 * (view.zoom || 1);
      const centerX = Number.isFinite(view.centerX) ? view.centerX : view.width / 2;
      const centerY = Number.isFinite(view.centerY) ? view.centerY : view.height / 2;
      ctx.save(); ctx.strokeStyle = style.color; ctx.globalAlpha = alpha * style.opacity;
      ctx.lineWidth = style.widthPx; ctx.lineCap = 'round'; ctx.setLineDash([]);
      for (const curve of graticuleFor(terrain)) {
        let open = false; ctx.beginPath();
        for (let i = 0; i < curve.length; i += 3) {
          const x = cy * curve[i] + sy * curve[i + 2];
          const z = -sy * curve[i] + cy * curve[i + 2];
          const y = cx * curve[i + 1] - sx * z, depth = sx * curve[i + 1] + cx * z;
          if (depth > .004) {
            const px = centerX + x * radius, py = centerY - y * radius;
            if (open) ctx.lineTo(px, py);
            else { ctx.moveTo(px, py); open = true; }
          } else if (open) { ctx.stroke(); ctx.beginPath(); open = false; }
        }
        if (open) ctx.stroke();
      }
      ctx.restore();
    }

    function drawBuildingGlyph(icon, x, y) {
      ctx.save(); ctx.translate(x, y); ctx.strokeStyle = '#e1e8e5'; ctx.fillStyle = '#e1e8e5';
      ctx.lineWidth = 1.45; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      if (icon === 'extractor') {
        ctx.moveTo(-6, 5); ctx.lineTo(5, -5); ctx.moveTo(-5, -6); ctx.lineTo(5, 4);
        ctx.moveTo(-6, -5); ctx.lineTo(0, -7); ctx.lineTo(6, -5);
        ctx.stroke();
      } else if (icon === 'factory') {
        ctx.moveTo(-7, 6); ctx.lineTo(-7, -1); ctx.lineTo(-2, 2); ctx.lineTo(-2, -2);
        ctx.lineTo(3, 1); ctx.lineTo(3, -6); ctx.lineTo(6, -6); ctx.lineTo(6, 6); ctx.closePath();
        ctx.stroke(); ctx.fillRect(-5, 3, 1.5, 1.5); ctx.fillRect(0, 3, 1.5, 1.5);
      } else if (icon === 'wind-turbine') {
        ctx.moveTo(0, 0); ctx.lineTo(0, 7); ctx.moveTo(0, 0); ctx.lineTo(-6, -5);
        ctx.moveTo(0, 0); ctx.lineTo(7, -3); ctx.moveTo(0, 0); ctx.lineTo(-1, -8); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 1.4, 0, TAU); ctx.fill();
      } else if (icon === 'storage') {
        ctx.moveTo(0, -7); ctx.lineTo(7, -3); ctx.lineTo(0, 1); ctx.lineTo(-7, -3); ctx.closePath();
        ctx.moveTo(-7, -3); ctx.lineTo(-7, 4); ctx.lineTo(0, 8); ctx.lineTo(7, 4); ctx.lineTo(7, -3);
        ctx.moveTo(0, 1); ctx.lineTo(0, 8); ctx.stroke();
      } else if (icon === 'hub') {
        ctx.moveTo(0, -8); ctx.lineTo(5, 3); ctx.lineTo(0, 1); ctx.lineTo(-5, 3); ctx.closePath();
        ctx.moveTo(0, 1); ctx.lineTo(0, 7); ctx.moveTo(-3, 5); ctx.lineTo(3, 5); ctx.stroke();
      } else if (icon === 'oil-platform') {
        ctx.moveTo(-7, -3); ctx.lineTo(7, -3); ctx.moveTo(-5, -3); ctx.lineTo(-4, 6);
        ctx.moveTo(5, -3); ctx.lineTo(4, 6); ctx.moveTo(-7, 6); ctx.lineTo(7, 6);
        ctx.moveTo(-2, -3); ctx.lineTo(0, -7); ctx.lineTo(2, -3); ctx.stroke();
      } else if (icon === 'surface-port') {
        ctx.moveTo(-7, -2); ctx.lineTo(6, -2); ctx.lineTo(4, 2); ctx.lineTo(-5, 2); ctx.closePath();
        ctx.moveTo(-6, 5); ctx.quadraticCurveTo(-3, 3, 0, 5); ctx.quadraticCurveTo(3, 7, 6, 5); ctx.stroke();
      } else {
        ctx.font = '8px ui-monospace, SFMono-Regular, Consolas, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icon.slice(0, 2).toUpperCase(), 0, 0);
      }
      ctx.restore();
    }

    function traceResourceBoundary(center, radius, resource) {
      const seed = root.OrbitWorld?.hashSeed?.(`${resource.id}:${resource.x}:${resource.y}`) || 0;
      const phase = seed / 4294967296 * TAU, rotation = -.45, points = [];
      for (let i = 0; i < 28; i += 1) {
        const angle = phase + i / 28 * TAU;
        const variation = 1 + Math.sin(angle * 3 + phase) * .1 +
          Math.cos(angle * 5 - phase) * .045 + Math.sin(angle * 7 + phase * .7) * .025;
        const x = Math.cos(angle) * radius * 1.28 * variation;
        const y = Math.sin(angle) * radius * .78 * variation;
        points.push({ x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation),
          y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) });
      }
      const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const start = midpoint(points[points.length - 1], points[0]);
      ctx.beginPath(); ctx.moveTo(start.x, start.y);
      for (let i = 0; i < points.length; i += 1) {
        const next = midpoint(points[i], points[(i + 1) % points.length]);
        ctx.quadraticCurveTo(points[i].x, points[i].y, next.x, next.y);
      }
      ctx.closePath();
    }

    function drawResources(terrain, view, alpha) {
      if (!terrain.resources?.length) return;
      ctx.save();
      for (const resource of terrain.resources) {
        const point = Projection.projectSurfacePoint(resource.x, resource.y, terrain, view, currentStyle.relief);
        if (!point.visible) continue;
        const edge = Projection.projectSurfacePoint(resource.x + resource.radius,
          resource.y, terrain, view, currentStyle.relief);
        const sampledRadius = edge.visible ? Math.hypot(edge.x - point.x, edge.y - point.y) : 0;
        // The patch follows the projected deposit radius, so it grows with the
        // globe instead of staying at a fixed screen-space size when zooming.
        const radius = sampledRadius * .58;
        const style = RESOURCE_DEPOSIT_STYLE[resource.id] || {
          fill: '#a5b0af30', hatch: '#d2dcdae8', outline: '#d2dcda', glow: '#a5b0af' };
        ctx.save();
        traceResourceBoundary(point, radius, resource);
        ctx.fillStyle = style.fill; ctx.globalAlpha = alpha; ctx.fill();
        ctx.clip(); ctx.strokeStyle = style.hatch; ctx.globalAlpha = alpha * .72;
        ctx.lineWidth = 1.15; ctx.setLineDash([]); ctx.beginPath();
        for (let offset = -radius * 2; offset < radius * 2; offset += 5) {
          ctx.moveTo(point.x + offset - radius, point.y + radius);
          ctx.lineTo(point.x + offset + radius, point.y - radius);
        }
        ctx.stroke(); ctx.restore();
        traceResourceBoundary(point, radius, resource);
        ctx.strokeStyle = style.outline; ctx.globalAlpha = alpha * .85; ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]); ctx.shadowColor = style.glow; ctx.shadowBlur = 3; ctx.stroke();
        ctx.shadowBlur = 0; ctx.setLineDash([]);
        if (radius >= 12) {
          ctx.font = '9px ui-monospace, SFMono-Regular, Consolas, monospace';
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = style.outline;
          ctx.globalAlpha = alpha * .95;
          ctx.fillText(RESOURCE_ABBREVIATION[resource.id] || resource.id.slice(0, 2).toUpperCase(),
            point.x + radius * .92, point.y - 2);
        }
        ctx.restore();
      }
    }

    function drawWorldPath(points, terrain, view, style = {}) {
      if (!points || points.length < 2) return;
      ctx.save(); ctx.strokeStyle = style.color || '#b8c4c4'; ctx.globalAlpha = style.opacity ?? .7;
      ctx.lineWidth = style.width || 1.15; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.setLineDash(style.dash || []); ctx.beginPath();
      let open = false;
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1], b = points[i];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < 1e-6) continue;
        const steps = Math.max(1, Math.min(8, Math.ceil(length / 42)));
        for (let step = 0; step <= steps; step += 1) {
          if (i > 1 && step === 0) continue;
          const t = step / steps, point = mapProject(a.x + (b.x - a.x) * t,
            a.y + (b.y - a.y) * t, terrain, view);
          if (point.visible) {
            if (!open) { ctx.moveTo(point.x, point.y); open = true; }
            else ctx.lineTo(point.x, point.y);
          } else if (open) { ctx.stroke(); ctx.beginPath(); open = false; }
        }
      }
      if (open) ctx.stroke();
      ctx.restore();
    }

    function drawRoads(state, terrain, view, alpha) {
      const network = state.roadNetworks?.[state.planet?.id];
      for (const segment of network?.segments || []) {
        let remaining = Number.isFinite(segment.builtLength) ? Math.min(segment.length, segment.builtLength) : segment.length;
        if (!(remaining > 0)) continue;
        const points = [segment.points[0]];
        for (let i = 1; i < segment.points.length && remaining > 0; i += 1) {
          const a = segment.points[i - 1], b = segment.points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
          if (length < 1e-6) continue;
          const used = Math.min(length, remaining), ratio = used / length;
          points.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio });
          remaining -= used;
          if (ratio < 1) break;
        }
        const marine = segment.routeType === 'marine';
        const dash = marine ? [2, 4] : [];
        drawWorldPath(points, terrain, view, { color: '#10212b',
          opacity: alpha * .72, width: marine ? 3 : 3.1, dash });
        drawWorldPath(points, terrain, view, { color: marine ? '#c0d1d5' : '#d5ded9',
          opacity: alpha * .93, width: marine ? 1.55 : 1.65, dash });
      }
      const preview = state.roadPreview;
      if (preview?.points?.length > 1) drawWorldPath(preview.points, terrain, view, {
        color: preview.color || (preview.valid ? '#e0b87f' : '#d48377'), opacity: alpha * .9,
        width: preview.lineWidth || 1.8, dash: preview.dash || [4, 4] });
    }

    function drawRoadJunctions(state, terrain, view, alpha) {
      const network = state.roadNetworks?.[state.planet?.id];
      if (!network?.nodes?.length || !network.segments?.length) return;
      const incident = new Map();
      for (const segment of network.segments) {
        if (segment.routeType === 'marine') continue;
        const length = Number.isFinite(segment.length) ? segment.length : 0;
        const built = Number.isFinite(segment.builtLength) ? segment.builtLength : length;
        if (!(length > 0) || !(built > 0)) continue;
        const fromReady = built > .01;
        const toReady = built >= length - .01;
        if (fromReady) {
          const edges = incident.get(segment.from) || [];
          edges.push(segment); incident.set(segment.from, edges);
        }
        if (toReady) {
          const edges = incident.get(segment.to) || [];
          edges.push(segment); incident.set(segment.to, edges);
        }
      }
      ctx.save();
      for (const node of network.nodes) {
        const edges = incident.get(node.id) || [];
        if (!node.isIntersection || edges.length < 3) continue;
        const point = mapProject(node.x, node.y, terrain, view);
        if (!point.visible) continue;
        ctx.globalAlpha = alpha * .92; ctx.fillStyle = '#e0e7e2';
        ctx.strokeStyle = '#10212b'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(point.x, point.y, 2.3, 0, TAU); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }

    function drawBuilding(building, terrain, view, state, alpha, ghost = false) {
      const definition = Buildings.get(building.type);
      if (!definition) return null;
      const point = mapProject(building.x, building.y, terrain, view);
      if (!point.visible) return null;
      const selected = !ghost && state.selected?.kind === 'building' && state.selected.id === building.id;
      const size = Style.icon.sizePx, radius = size / 2;
      const color = ghost ? (building.valid ? '#9cc9bd' : '#c98278') :
        definition.category === 'resource' ? '#d3ad79' : definition.category === 'logistics' ? '#a7bdc2' : '#c4ccc3';
      ctx.save(); ctx.globalAlpha = alpha * (ghost ? .78 : 1);
      ctx.fillStyle = '#10202bc9'; ctx.strokeStyle = selected ? '#e6b27b' : color;
      ctx.lineWidth = selected ? 1.6 : 1.05;
      ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      drawBuildingGlyph(definition.icon || definition.id, point.x, point.y);
      if (selected) {
        ctx.globalAlpha = alpha; ctx.strokeStyle = '#efb578'; ctx.lineWidth = .9; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(point.x, point.y, radius + 7, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      if (ghost) {
        ctx.globalAlpha = alpha * .82; ctx.font = '8px ui-monospace, SFMono-Regular, Consolas, monospace';
        ctx.textAlign = 'left'; ctx.fillStyle = color;
        ctx.fillText(`${definition.shortLabel} · ${building.valid ? 'EMPLACEMENT VALIDE' : 'EMPLACEMENT INVALIDE'}`,
          point.x + radius + 5, point.y - radius - 3);
      }
      ctx.restore();
      return { x: point.x, y: point.y, visible: point.visible, id: building.id };
    }

    function render({ terrain, state, view, transition = null, active = true, style = Style }) {
      currentStyle = style || Style;
      ctx.clearRect(0, 0, width, height);
      const visible = Boolean(active && terrain && state?.planet);
      canvas.style.display = visible ? 'block' : 'none';
      if (!visible) return;
      const globeView = transition ? { ...view, centerX: transition.centerX,
        centerY: transition.centerY, radiusPx: transition.radiusPx } : view;
      const alpha = Number.isFinite(transition?.globeOpacity) ? transition.globeOpacity : 1;
      drawGraticule(terrain, globeView, alpha);
      drawResources(terrain, globeView, alpha);
      drawRoads(state, terrain, globeView, alpha);
      drawRoadJunctions(state, terrain, globeView, alpha);
      for (const building of state.surfaceBuildings || []) {
        if (building.planetId === state.planet.id) drawBuilding(building, terrain, globeView, state, alpha);
      }
      if (state.tool === 'build' && state.placement) drawBuilding({ ...state.placement,
        type: state.placement.type, valid: state.placement.valid }, terrain, globeView, state, alpha, true);
    }

    function hitTest(buildings, planetId, terrain, view, x, y, style = Style) {
      currentStyle = style || Style;
      const radius = currentStyle.icon.hitRadiusPx;
      for (let i = buildings.length - 1; i >= 0; i -= 1) {
        const building = buildings[i];
        if (building.planetId !== planetId) continue;
        const point = mapProject(building.x, building.y, terrain, view);
        if (point.visible && Math.hypot(point.x - x, point.y - y) <= radius) return building;
      }
      return null;
    }

    return Object.freeze({ resize, render, hitTest, projectMapPoint: mapProject });
  }

  root.OrbitPlanetGlobeOverlayRenderer = Object.freeze({ create });
})(globalThis);
