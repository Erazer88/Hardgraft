(function (root) {
  'use strict';
  const A = root.NereideAtlas;
  const sources = {
    ground: 'assets/ground-texture.jpg',
    massifA: 'assets/massif-05.webp',
    massifB: 'assets/massif-04.webp'
  };
  let pending;

  function surface(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }

  function smoothstep(edge0, edge1, value) {
    const t = A.clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Keep the connected mountain group, discard stray fragments, and feather its mask.
  function prepareMountain(image) {
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    const canvas = surface(width, height), ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.drawImage(image, 0, 0);
    try {
      const frame = ctx.getImageData(0, 0, width, height), pixels = frame.data;
      const count = width * height, visited = new Uint8Array(count), queue = new Int32Array(count);
      let largest = new Uint8Array(count), largestSize = 0;
      for (let start = 0; start < count; start++) {
        if (visited[start] || pixels[start * 4 + 3] < 64) continue;
        let head = 0, tail = 0;
        queue[tail++] = start; visited[start] = 1;
        while (head < tail) {
          const index = queue[head++], x = index % width;
          let next = index - 1;
          if (x && !visited[next] && pixels[next * 4 + 3] >= 64) {visited[next] = 1; queue[tail++] = next;}
          next = index + 1;
          if (x + 1 < width && !visited[next] && pixels[next * 4 + 3] >= 64) {visited[next] = 1; queue[tail++] = next;}
          next = index - width;
          if (next >= 0 && !visited[next] && pixels[next * 4 + 3] >= 64) {visited[next] = 1; queue[tail++] = next;}
          next = index + width;
          if (next < count && !visited[next] && pixels[next * 4 + 3] >= 64) {visited[next] = 1; queue[tail++] = next;}
        }
        if (tail > largestSize) {
          largestSize = tail; largest.fill(0);
          for (let i = 0; i < tail; i++) largest[queue[i]] = 1;
        }
      }
      if (!largestSize) return canvas;

      const distance = new Float32Array(count), far = width + height;
      for (let i = 0; i < count; i++) distance[i] = largest[i] ? far : 0;
      const diagonal = Math.SQRT2;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x; let d = distance[i];
        if (x) d = Math.min(d, distance[i - 1] + 1);
        if (y) d = Math.min(d, distance[i - width] + 1);
        if (x && y) d = Math.min(d, distance[i - width - 1] + diagonal);
        if (x + 1 < width && y) d = Math.min(d, distance[i - width + 1] + diagonal);
        distance[i] = d;
      }
      for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
        const i = y * width + x; let d = distance[i];
        if (x + 1 < width) d = Math.min(d, distance[i + 1] + 1);
        if (y + 1 < height) d = Math.min(d, distance[i + width] + 1);
        if (x + 1 < width && y + 1 < height) d = Math.min(d, distance[i + width + 1] + diagonal);
        if (x && y + 1 < height) d = Math.min(d, distance[i + width - 1] + diagonal);
        distance[i] = d;
      }

      const feather = Math.min(width, height) * .065;
      for (let i = 0; i < count; i++) {
        const alpha = largest[i] ? smoothstep(0, feather, distance[i]) : 0;
        pixels[i * 4 + 3] = Math.round(pixels[i * 4 + 3] * alpha);
      }
      ctx.putImageData(frame, 0, 0);
    } catch (_) {
      // If pixel access is unavailable, the supplied alpha channel still provides a soft edge.
    }
    return canvas;
  }

  async function loadLibrary() {
    if (pending) return pending;
    pending = (async () => {
      const images = {}, failed = [];
      await Promise.all(Object.entries(sources).map(([name, src]) => new Promise(resolve => {
        const image = new Image();
        image.onload = () => {images[name] = image; resolve();};
        image.onerror = () => {failed.push(name); resolve();};
        image.src = src;
      })));
      const mountains = [images.massifA, images.massifB].filter(Boolean).map(prepareMountain);
      return {images, ground: images.ground, mountains, failed};
    })();
    return pending;
  }

  Object.assign(A, {surface, loadLibrary});
})(globalThis);
