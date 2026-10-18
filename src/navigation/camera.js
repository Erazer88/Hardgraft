(function (root) {
  'use strict';

  function project(point, camera, viewport) {
    return { x: viewport.width / 2 + (point.x - camera.x) * camera.zoom,
      y: viewport.height / 2 + (point.y - camera.y) * camera.zoom };
  }

  function unproject(point, camera, viewport) {
    return { x: camera.x + (point.x - viewport.width / 2) / camera.zoom,
      y: camera.y + (point.y - viewport.height / 2) / camera.zoom };
  }

  function toLocal(frame, camera) {
    return { x: (camera.x - frame.x) / frame.scale, y: (camera.y - frame.y) / frame.scale, zoom: camera.zoom * frame.scale };
  }

  function toWorld(frame, camera) {
    return { x: frame.x + camera.x * frame.scale, y: frame.y + camera.y * frame.scale, zoom: camera.zoom / frame.scale };
  }

  function worldPoint(frame, point) {
    return { x: frame.x + point.x * frame.scale, y: frame.y + point.y * frame.scale };
  }

  function anchoredZoom(camera, viewport, zoom, anchor, previousAnchor = anchor) {
    const before = unproject(previousAnchor, camera, viewport);
    return { x: before.x - (anchor.x - viewport.width / 2) / zoom,
      y: before.y - (anchor.y - viewport.height / 2) / zoom, zoom };
  }

  function moving(camera, target) {
    return camera.zoom !== target.zoom || camera.x !== target.x || camera.y !== target.y;
  }

  function smooth(camera, target, seconds, rate) {
    const factor = 1 - Math.exp(-seconds * rate);
    const zoom = Math.exp(Math.log(camera.zoom) + (Math.log(target.zoom) - Math.log(camera.zoom)) * factor);
    const next = { x: target.x - (target.x - camera.x) * camera.zoom / zoom * (1 - factor),
      y: target.y - (target.y - camera.y) * camera.zoom / zoom * (1 - factor), zoom };
    if (Math.abs(Math.log(target.zoom / zoom)) < .0005 && Math.hypot(target.x - next.x, target.y - next.y) * zoom < .2) return { ...target };
    return next;
  }

  root.OrbitCamera = Object.freeze({ project, unproject, toLocal, toWorld, worldPoint, anchoredZoom, moving, smooth });
})(globalThis);
