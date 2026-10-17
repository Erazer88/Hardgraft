(function (root) {
  'use strict';

  const MIN_ZOOM = .16, MAX_ZOOM = 4;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function create(viewport, world, actions = {}) {
    let camera = { x: 0, y: 0, scale: 1 };
    let gesture = { mode: 'idle' };
    let activeTouches = new Map();

    function apply(next) {
      camera = { x: next.x, y: next.y, scale: clamp(next.scale, MIN_ZOOM, MAX_ZOOM) };
      world.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`;
      actions.onCameraChange?.({ ...camera });
    }

    function localPoint(clientX, clientY) {
      const bounds = viewport.getBoundingClientRect();
      return { x: clientX - bounds.left, y: clientY - bounds.top };
    }

    function worldPoint(clientX, clientY) {
      const point = localPoint(clientX, clientY);
      return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
    }

    function zoomAt(scale, point) {
      const nextScale = clamp(scale, MIN_ZOOM, MAX_ZOOM);
      const anchor = { x: (point.x - camera.x) / camera.scale,
        y: (point.y - camera.y) / camera.scale };
      apply({ scale: nextScale, x: point.x - anchor.x * nextScale, y: point.y - anchor.y * nextScale });
    }

    function capture(event) {
      try { viewport.setPointerCapture(event.pointerId); } catch (_) { /* Pointer capture is optional. */ }
    }

    function touchPair() { return [...activeTouches.entries()].slice(0, 2); }

    function cancelGestureForPinch() {
      if (gesture.mode === 'machine') actions.onMachineEnd?.(gesture.machineId);
      if (gesture.mode === 'connection' && gesture.connection && gesture.detached) {
        actions.onRestoreConnection?.(gesture.connection);
      }
      gesture = { mode: 'idle' };
      actions.onPendingConnection?.(null);
    }

    function beginPinch() {
      const pair = touchPair();
      if (pair.length < 2) return false;
      cancelGestureForPinch();
      const [a, b] = pair.map(([, point]) => point);
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const local = localPoint(midpoint.x, midpoint.y);
      gesture = { mode: 'pinch', pointerIds: pair.map(([id]) => id),
        startDistance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        startScale: camera.scale,
        anchor: { x: (local.x - camera.x) / camera.scale, y: (local.y - camera.y) / camera.scale } };
      return true;
    }

    function outputTarget(target) {
      const port = target.closest?.('.factory-port.output');
      if (!port) return null;
      return { machineId: port.dataset.machineId, outputId: port.dataset.outputId };
    }

    function inputTarget(target, clientX, clientY) {
      const direct = target.closest?.('.factory-port.input');
      if (direct) return { machineId: direct.dataset.machineId, inputId: direct.dataset.inputId };
      return actions.findInputTarget?.(clientX, clientY) || null;
    }

    function onPointerDown(event) {
      if (event.pointerType === 'touch') {
        activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (activeTouches.size >= 2 && beginPinch()) {
          capture(event); event.preventDefault(); return;
        }
      }
      if (gesture.mode === 'pinch') { event.preventDefault(); return; }
      const target = event.target;
      if (target.closest?.('[data-remove-machine], select, input, textarea')) return;

      const output = outputTarget(target);
      if (output) {
        const existing = actions.findConnectionFrom?.(output.machineId, output.outputId) || null;
        gesture = { mode: 'connection', pointerId: event.pointerId, source: output,
          connection: existing, detached: false, moved: false, startX: event.clientX, startY: event.clientY };
        capture(event); event.preventDefault();
        actions.onPendingConnection?.({ source: output, point: worldPoint(event.clientX, event.clientY) });
        return;
      }

      const input = target.closest?.('.factory-port.input');
      if (input) {
        const connection = actions.findConnectionTo?.(input.dataset.machineId, input.dataset.inputId);
        if (connection) {
          const source = { machineId: connection.fromMachineId, outputId: connection.fromOutputId };
          gesture = { mode: 'connection', pointerId: event.pointerId, source, connection,
            detached: false, moved: false, startX: event.clientX, startY: event.clientY };
          capture(event); event.preventDefault();
          actions.onPendingConnection?.({ source, point: worldPoint(event.clientX, event.clientY) });
        }
        return;
      }

      const hit = target.closest?.('[data-connection-id]');
      if (hit) {
        const connection = actions.findConnection?.(hit.dataset.connectionId);
        if (connection) {
          gesture = { mode: 'connection', pointerId: event.pointerId,
            source: { machineId: connection.fromMachineId, outputId: connection.fromOutputId },
            connection, detached: false, moved: false, startX: event.clientX, startY: event.clientY };
          capture(event); event.preventDefault();
          actions.onPendingConnection?.({ source: gesture.source, point: worldPoint(event.clientX, event.clientY) });
        }
        return;
      }

      const card = target.closest?.('.factory-node');
      if (card) {
        const machineId = card.dataset.machineId;
        const position = actions.getMachinePosition?.(machineId);
        if (!position) return;
        gesture = { mode: 'machine', pointerId: event.pointerId, machineId,
          startX: event.clientX, startY: event.clientY, origin: position, moved: false };
        actions.onSelectMachine?.(machineId);
        capture(event); event.preventDefault(); return;
      }

      gesture = { mode: 'pan', pointerId: event.pointerId,
        startX: event.clientX, startY: event.clientY, origin: { x: camera.x, y: camera.y } };
      capture(event); event.preventDefault();
    }

    function onPointerMove(event) {
      if (event.pointerType === 'touch' && activeTouches.has(event.pointerId)) {
        activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (gesture.mode === 'pinch') {
        const pair = gesture.pointerIds.map(id => activeTouches.get(id));
        if (!pair[0] || !pair[1]) return;
        const midpoint = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };
        const local = localPoint(midpoint.x, midpoint.y);
        const distance = Math.max(1, Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y));
        const scale = clamp(gesture.startScale * distance / gesture.startDistance, MIN_ZOOM, MAX_ZOOM);
        apply({ scale, x: local.x - gesture.anchor.x * scale, y: local.y - gesture.anchor.y * scale });
        event.preventDefault(); return;
      }
      if (gesture.pointerId !== event.pointerId) return;
      const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
      if (gesture.mode === 'pan') {
        apply({ ...camera, x: gesture.origin.x + dx, y: gesture.origin.y + dy });
      } else if (gesture.mode === 'machine') {
        gesture.moved ||= Math.abs(dx) + Math.abs(dy) > 2;
        actions.onMachineMove?.(gesture.machineId, {
          x: gesture.origin.x + dx / camera.scale,
          y: gesture.origin.y + dy / camera.scale
        });
      } else if (gesture.mode === 'connection') {
        const distance = Math.hypot(dx, dy);
        if (!gesture.moved && distance < 5) return;
        gesture.moved = true;
        if (gesture.connection && !gesture.detached) {
          actions.onDetachConnection?.(gesture.connection.id);
          gesture.detached = true;
        }
        actions.onPendingConnection?.({ source: gesture.source,
          point: worldPoint(event.clientX, event.clientY), target: inputTarget(event.target, event.clientX, event.clientY) });
      }
      event.preventDefault();
    }

    function onPointerUp(event) {
      if (event.pointerType === 'touch') activeTouches.delete(event.pointerId);
      if (gesture.mode === 'pinch') {
        const remaining = touchPair();
        if (remaining.length === 1) {
          const [pointerId, point] = remaining[0];
          gesture = { mode: 'pan', pointerId, startX: point.x, startY: point.y,
            origin: { x: camera.x, y: camera.y } };
        } else gesture = { mode: 'idle' };
        return;
      }
      if (gesture.pointerId !== event.pointerId) return;
      const finished = gesture;
      gesture = { mode: 'idle' };
      if (finished.mode === 'machine') {
        if (finished.moved) actions.onMachineEnd?.(finished.machineId);
      } else if (finished.mode === 'connection') {
        const target = inputTarget(event.target, event.clientX, event.clientY);
        if (finished.moved) {
          actions.onConnectionDrop?.(finished.source, target, finished.connection, finished.detached);
        } else if (!finished.connection && target) {
          actions.onConnectionDrop?.(finished.source, target, null, false);
        }
        actions.onPendingConnection?.(null);
      }
    }

    function onWheel(event) {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      const delta = clamp(event.deltaY * unit, -480, 480);
      zoomAt(camera.scale * Math.exp(-delta * .0012), localPoint(event.clientX, event.clientY));
    }

    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
    viewport.addEventListener('wheel', onWheel, { passive: false });

    function setCamera(value) { apply(value); }
    function fit(machines, cardSize) {
      if (!machines.length) {
        apply({ x: (viewport.clientWidth - world.clientWidth) / 2,
          y: (viewport.clientHeight - world.clientHeight) / 2, scale: 1 }); return;
      }
      const bounds = machines.reduce((box, machine) => ({
        minX: Math.min(box.minX, machine.x), minY: Math.min(box.minY, machine.y),
        maxX: Math.max(box.maxX, machine.x + cardSize.width), maxY: Math.max(box.maxY, machine.y + cardSize.height)
      }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      const scale = clamp(Math.min((viewport.clientWidth - 100) / (bounds.maxX - bounds.minX + 100),
        (viewport.clientHeight - 100) / (bounds.maxY - bounds.minY + 100)), .78, 1.2);
      apply({ scale,
        x: (viewport.clientWidth - (bounds.minX + bounds.maxX) * scale) / 2,
        y: (viewport.clientHeight - (bounds.minY + bounds.maxY) * scale) / 2 });
    }

    return Object.freeze({
      setCamera,
      fit,
      worldPoint,
      camera: () => ({ ...camera }),
      mode: () => gesture.mode,
      dispose() {
        viewport.removeEventListener('pointerdown', onPointerDown);
        viewport.removeEventListener('pointermove', onPointerMove);
        viewport.removeEventListener('pointerup', onPointerUp);
        viewport.removeEventListener('pointercancel', onPointerUp);
        viewport.removeEventListener('wheel', onWheel);
        gesture = { mode: 'idle' };
        activeTouches.clear();
      }
    });
  }

  root.OrbitFactoryViewport = Object.freeze({ create, MIN_ZOOM, MAX_ZOOM });
})(globalThis);
