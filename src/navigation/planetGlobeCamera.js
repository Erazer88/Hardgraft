(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const ease = value => value * value * (3 - 2 * value);
  const DEFAULTS = Object.freeze({ minZoom: .8, maxZoom: 1.3, initialZoom: 1,
    initialYaw: -.38, initialPitch: .16, rotationSensitivity: .006,
    maxPitch: .72, radiusRatio: .4, transitionMs: 320 });

  function create(options = {}) {
    const settings = { ...DEFAULTS, ...options };
    let yaw = settings.initialYaw, pitch = settings.initialPitch, zoom = settings.initialZoom;
    let transition = null;

    function view(width, height) {
      return { width, height, yaw, pitch, zoom,
        centerX: width / 2, centerY: height / 2,
        radiusPx: Math.min(width, height) * settings.radiusRatio * zoom };
    }

    function setView(value = {}) {
      if (Number.isFinite(value.yaw)) yaw = value.yaw;
      if (Number.isFinite(value.pitch)) pitch = clamp(value.pitch, -settings.maxPitch, settings.maxPitch);
      if (Number.isFinite(value.zoom)) zoom = clamp(value.zoom, settings.minZoom, settings.maxZoom);
      return snapshot();
    }

    function rotateBy(dx, dy) {
      yaw = ((yaw + dx * settings.rotationSensitivity) % TAU + TAU) % TAU;
      pitch = clamp(pitch + dy * settings.rotationSensitivity, -settings.maxPitch, settings.maxPitch);
      return snapshot();
    }

    function zoomBy(factor) {
      if (!Number.isFinite(factor) || factor <= 0) return { zoom, crossedMinimum: false };
      const requested = zoom * factor;
      const crossedMinimum = requested < settings.minZoom;
      zoom = clamp(requested, settings.minZoom, settings.maxZoom);
      return { zoom, crossedMinimum };
    }

    function beginEnter(point, radiusPx, width, height, now = performance.now()) {
      const targetRadius = Math.min(width, height) * settings.radiusRatio * zoom;
      transition = { mode: 'enter', startTime: now, duration: settings.transitionMs,
        fromX: Number.isFinite(point?.x) ? point.x : width / 2,
        fromY: Number.isFinite(point?.y) ? point.y : height / 2,
        fromRadius: Math.max(2, Number.isFinite(radiusPx) ? radiusPx : 18),
        toX: width / 2, toY: height / 2, toRadius: targetRadius };
    }

    function beginExit(width, height, now = performance.now()) {
      transition = { mode: 'exit', startTime: now, duration: settings.transitionMs,
        fromX: width / 2, fromY: height / 2,
        fromRadius: Math.min(width, height) * settings.radiusRatio * zoom };
    }

    function transitionFrame(now, width, height, exitTarget = null) {
      if (!transition) return { active: false, mode: null, centerX: width / 2, centerY: height / 2,
        radiusPx: Math.min(width, height) * settings.radiusRatio * zoom,
        globeOpacity: 1, systemOpacity: 0 };
      const raw = clamp((now - transition.startTime) / transition.duration, 0, 1);
      const t = ease(raw), current = transition;
      let targetX = current.toX, targetY = current.toY, targetRadius = current.toRadius;
      if (current.mode === 'exit') {
        targetX = Number.isFinite(exitTarget?.x) ? exitTarget.x : width / 2;
        targetY = Number.isFinite(exitTarget?.y) ? exitTarget.y : height / 2;
        targetRadius = Number.isFinite(exitTarget?.radiusPx) ? exitTarget.radiusPx : 12;
      }
      const frame = { active: raw < 1, mode: current.mode, progress: raw,
        centerX: current.fromX + (targetX - current.fromX) * t,
        centerY: current.fromY + (targetY - current.fromY) * t,
        radiusPx: current.fromRadius + (targetRadius - current.fromRadius) * t,
        globeOpacity: current.mode === 'enter' ? raw : 1 - raw,
        systemOpacity: current.mode === 'enter' ? 1 - raw : raw };
      if (raw >= 1 && current.mode === 'enter') transition = null;
      return frame;
    }

    function clearTransition() { transition = null; }
    function isTransitioning() { return Boolean(transition); }
    function transitionMode() { return transition?.mode || null; }
    function snapshot() { return { yaw, pitch, zoom }; }

    return Object.freeze({ view, setView, rotateBy, zoomBy, beginEnter, beginExit,
      transitionFrame, clearTransition, isTransitioning, transitionMode, snapshot,
      reset() { yaw = settings.initialYaw; pitch = settings.initialPitch; zoom = settings.initialZoom; } });
  }

  root.OrbitPlanetGlobeCamera = Object.freeze({ create, defaults: DEFAULTS });
})(globalThis);
