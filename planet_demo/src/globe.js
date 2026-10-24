(function (root) {
  'use strict';
  const A = root.NereideAtlas;
  class Globe {
    constructor(canvas) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.longitude = 0; this.latitude = 0; this.zoom = 1; this.grid = true;
      this.buffer = A.surface(1, 1); this.pending = false; this.drag = null;
      this.onChange = () => {};
      canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        this.drag = {x: event.clientX, y: event.clientY, longitude: this.longitude, latitude: this.latitude};
        canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging');
      });
      canvas.addEventListener('pointermove', event => {
        if (!this.drag) return;
        const size = canvas.getBoundingClientRect().width;
        this.longitude = this.drag.longitude - (event.clientX - this.drag.x) / size * 3.2;
        this.latitude = A.clamp(this.drag.latitude + (event.clientY - this.drag.y) / size * 2.4, -1.15, 1.15);
        this.request(true);
      });
      const end = () => {this.drag = null; canvas.classList.remove('dragging'); this.request(false);};
      canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
      canvas.addEventListener('lostpointercapture', () => {if (this.drag) end();});
      canvas.addEventListener('wheel', event => {
        event.preventDefault(); this.setZoom(this.zoom * Math.exp(-event.deltaY * .001));
      }, {passive: false});
      canvas.addEventListener('keydown', event => {
        const step = .12;
        if (event.key === 'ArrowLeft') this.longitude -= step;
        else if (event.key === 'ArrowRight') this.longitude += step;
        else if (event.key === 'ArrowUp') this.latitude = A.clamp(this.latitude + step, -1.15, 1.15);
        else if (event.key === 'ArrowDown') this.latitude = A.clamp(this.latitude - step, -1.15, 1.15);
        else if (event.key === '+' || event.key === '=') this.setZoom(this.zoom * 1.1);
        else if (event.key === '-') this.setZoom(this.zoom / 1.1);
        else return;
        event.preventDefault(); this.request();
      });
      this.resize = new ResizeObserver(() => this.request()); this.resize.observe(canvas);
    }
    setTexture(texture) {
      this.texture = texture;
      this.pixels = texture.canvas.getContext('2d').getImageData(0, 0, texture.width, texture.height).data;
      this.request();
    }
    setZoom(value) {this.zoom = A.clamp(value, .78, 1.38); this.onChange(); this.request();}
    reset() {this.longitude = 0; this.latitude = 0; this.zoom = 1; this.onChange(); this.request();}
    request(fast) {
      this.fast = !!fast;
      if (this.pending || !this.pixels) return;
      this.pending = true;
      requestAnimationFrame(() => {this.pending = false; this.draw(this.fast);});
    }
    draw(fast) {
      if (!this.pixels || !this.canvas.clientWidth) return;
      const displaySize = this.canvas.clientWidth;
      const size = Math.round(Math.min(fast ? 380 : 880, displaySize * Math.min(devicePixelRatio || 1, 1.5)));
      if (this.canvas.width !== size) {this.canvas.width = size; this.canvas.height = size; this.buffer.width = size; this.buffer.height = size;}
      const ctx = this.ctx, radius = size * .438 * this.zoom, center = size / 2;
      const image = ctx.createImageData(size, size), out = image.data, source = this.pixels;
      const tw = this.texture.width, th = this.texture.height, sin = Math.sin(this.latitude), cos = Math.cos(this.latitude);
      for (let y = 0; y < size; y++) {
        const sy = -(y + .5 - center) / radius;
        for (let x = 0; x < size; x++) {
          const sx = (x + .5 - center) / radius, rr = sx * sx + sy * sy;
          if (rr >= 1) continue;
          const sz = Math.sqrt(1 - rr), py = sy * cos + sz * sin, pz = sz * cos - sy * sin;
          const lat = Math.asin(A.clamp(py, -1, 1)), lon = Math.atan2(sx, pz) + this.longitude;
          const u = ((lon / (Math.PI * 2) + .5) % 1 + 1) % 1, v = .5 - lat / Math.PI;
          const fx = u * tw - .5, fy = v * th - .5;
          const rawX = Math.floor(fx), rawY = Math.floor(fy), dx = fx - rawX, dy = fy - rawY;
          const x0 = ((rawX % tw) + tw) % tw, x1 = (x0 + 1) % tw;
          const y0 = A.clamp(rawY, 0, th - 1), y1 = A.clamp(rawY + 1, 0, th - 1);
          const s00 = (y0 * tw + x0) * 4, s10 = (y0 * tw + x1) * 4;
          const s01 = (y1 * tw + x0) * 4, s11 = (y1 * tw + x1) * 4, d = (y * size + x) * 4;
          const light = .79 + .19 * Math.max(0, -.28 * sx + .38 * sy + .86 * sz);
          const edge = Math.pow(1 - sz, 3) * .16;
          let grid = 0;
          if (this.grid) {
            const latitudeLine = Math.abs(Math.sin(lat * 12)), longitudeLine = Math.abs(Math.sin(lon * 12));
            if (latitudeLine < .018 || longitudeLine < .018) grid = .075 * Math.min(1, sz * 4);
          }
          const r0 = A.lerp(source[s00], source[s10], dx), r1 = A.lerp(source[s01], source[s11], dx);
          const g0 = A.lerp(source[s00 + 1], source[s10 + 1], dx), g1 = A.lerp(source[s01 + 1], source[s11 + 1], dx);
          const b0 = A.lerp(source[s00 + 2], source[s10 + 2], dx), b1 = A.lerp(source[s01 + 2], source[s11 + 2], dx);
          out[d] = A.lerp(A.lerp(r0, r1, dy) * light, 137, grid) + edge * 10;
          out[d + 1] = A.lerp(A.lerp(g0, g1, dy) * light, 200, grid) + edge * 34;
          out[d + 2] = A.lerp(A.lerp(b0, b1, dy) * light, 221, grid) + edge * 48;
          out[d + 3] = Math.min(1, (1 - Math.sqrt(rr)) * radius) * 255;
        }
      }
      ctx.clearRect(0, 0, size, size);
      const halo = ctx.createRadialGradient(center, center, radius - 1, center, center, radius + size * .052);
      halo.addColorStop(0, '#5ecbff66'); halo.addColorStop(.23, '#2698e33b');
      halo.addColorStop(.72, '#1563ba15'); halo.addColorStop(1, '#155eaf00');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, size, size);
      this.buffer.getContext('2d').putImageData(image, 0, 0); ctx.drawImage(this.buffer, 0, 0);
      ctx.save(); ctx.shadowColor = '#70d7ff99'; ctx.shadowBlur = size * .008;
      ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#92ddffbb'; ctx.lineWidth = Math.max(1.2, size / 650); ctx.stroke(); ctx.restore();
    }
  }
  A.Globe = Globe;
})(globalThis);
