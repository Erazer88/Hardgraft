(function (root) {
  'use strict';

  const Mesh = root.OrbitPlanetGlobeMesh;
  const Style = root.OrbitPlanetGlobeStyle;
  const VERTEX_SHADER = `#version 300 es
    in vec3 aPosition;
    in vec3 aNormal;
    in vec3 aColor;
    in vec3 aOceanColor;
    in float aElevation;
    uniform float uYaw;
    uniform float uPitch;
    uniform vec2 uScale;
    uniform vec2 uOffset;
    out vec3 vNormal;
    out vec3 vColor;
    out vec3 vOceanColor;
    out float vElevation;
    void main() {
      float cy = cos(uYaw), sy = sin(uYaw), cx = cos(uPitch), sx = sin(uPitch);
      vec3 p = vec3(cy * aPosition.x + sy * aPosition.z, aPosition.y,
        -sy * aPosition.x + cy * aPosition.z);
      vec3 n = vec3(cy * aNormal.x + sy * aNormal.z, aNormal.y,
        -sy * aNormal.x + cy * aNormal.z);
      p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
      n = vec3(n.x, cx * n.y - sx * n.z, sx * n.y + cx * n.z);
      gl_Position = vec4(p.xy * uScale + uOffset, -p.z * 0.72, 1.0);
      vNormal = normalize(n);
      vColor = aColor;
      vOceanColor = aOceanColor;
      vElevation = aElevation;
    }`;
  const FRAGMENT_SHADER = `#version 300 es
    precision mediump float;
    in vec3 vNormal;
    in vec3 vColor;
    in vec3 vOceanColor;
    in float vElevation;
    uniform float uOpacity;
    uniform float uSeaLevel;
    uniform float uContourInterval;
    uniform float uMajorInterval;
    uniform float uContourOpacity;
    uniform float uMajorOpacity;
    out vec4 outColor;
    void main() {
      vec3 lightDirection = normalize(vec3(-0.42, 0.55, 0.78));
      float diffuse = max(dot(normalize(vNormal), lightDirection), 0.0);
      float ambient = 0.68;
      float limb = mix(0.84, 1.0, smoothstep(0.0, 0.86, vNormal.z));
      float rim = pow(1.0 - max(vNormal.z, 0.0), 4.0);
      float coastWidth = clamp(fwidth(vElevation) * 0.85, 1.4, 8.0);
      float coastline = smoothstep(uSeaLevel - coastWidth, uSeaLevel + coastWidth, vElevation);
      vec3 surfaceColor = mix(vOceanColor, vColor, coastline);
      vec3 color = surfaceColor * (ambient + diffuse * 0.43) * limb + vec3(0.018, 0.07, 0.13) * rim;
      float land = smoothstep(uSeaLevel - coastWidth, uSeaLevel + coastWidth, vElevation);
      float minorLevel = (vElevation - uSeaLevel) / uContourInterval;
      float majorLevel = (vElevation - uSeaLevel) / uMajorInterval;
      float minorDistance = abs(fract(minorLevel + 0.5) - 0.5);
      float majorDistance = abs(fract(majorLevel + 0.5) - 0.5);
      float minorWidth = max(0.035, fwidth(minorLevel) * 0.72);
      float majorWidth = max(0.035, fwidth(majorLevel) * 0.72);
      float minorLine = (1.0 - smoothstep(0.0, minorWidth, minorDistance)) * land;
      float majorLine = (1.0 - smoothstep(0.0, majorWidth, majorDistance)) * land;
      float contour = max(minorLine * uContourOpacity, majorLine * uMajorOpacity);
      color = mix(color, vec3(0.075, 0.12, 0.11), contour);
      outColor = vec4(color, uOpacity);
    }`;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Unknown WebGL shader error';
      gl.deleteShader(shader); throw new Error(message);
    }
    return shader;
  }

  function create(canvas, errorElement = null) {
    let gl = null, program = null, buffers = null, currentMesh = null, lastDrawn = null;
    let width = 1, height = 1, dpr = 1, lost = false, failure = '';
    const meshCache = new WeakMap();
    try {
      gl = canvas.getContext('webgl2', { alpha: true, antialias: true, depth: true,
        premultipliedAlpha: true, powerPreference: 'high-performance' });
      if (!gl) failure = 'WebGL2 unavailable';
      else initialize();
    } catch (error) { failure = error?.message || 'WebGL2 unavailable'; }

    function initialize() {
      lastDrawn = null;
      const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL program link failed');
      program.attributes = { position: gl.getAttribLocation(program, 'aPosition'),
        normal: gl.getAttribLocation(program, 'aNormal'), color: gl.getAttribLocation(program, 'aColor'),
        oceanColor: gl.getAttribLocation(program, 'aOceanColor'), elevation: gl.getAttribLocation(program, 'aElevation') };
      program.uniforms = { yaw: gl.getUniformLocation(program, 'uYaw'), pitch: gl.getUniformLocation(program, 'uPitch'),
        scale: gl.getUniformLocation(program, 'uScale'), offset: gl.getUniformLocation(program, 'uOffset'),
        opacity: gl.getUniformLocation(program, 'uOpacity'), seaLevel: gl.getUniformLocation(program, 'uSeaLevel'),
        contourInterval: gl.getUniformLocation(program, 'uContourInterval'),
        majorInterval: gl.getUniformLocation(program, 'uMajorInterval'),
        contourOpacity: gl.getUniformLocation(program, 'uContourOpacity'),
        majorOpacity: gl.getUniformLocation(program, 'uMajorOpacity') };
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      buffers = null;
      if (currentMesh) upload(currentMesh);
    }

    function upload(mesh) {
      if (!gl || lost || !mesh) return;
      lastDrawn = null;
      if (buffers) {
        gl.deleteBuffer(buffers.positions); gl.deleteBuffer(buffers.normals);
        gl.deleteBuffer(buffers.colors); gl.deleteBuffer(buffers.oceanColors);
        gl.deleteBuffer(buffers.elevations); gl.deleteBuffer(buffers.indices);
        gl.deleteVertexArray(buffers.vao);
      }
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      function attribute(name, values, size) {
        const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
        const location = program.attributes[name]; gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0); return buffer;
      }
      const positions = attribute('position', mesh.positions, 3);
      const normals = attribute('normal', mesh.normals, 3);
      const colors = attribute('color', mesh.colors, 3);
      const oceanColors = attribute('oceanColor', mesh.oceanColors, 3);
      const elevations = attribute('elevation', mesh.elevations, 1);
      const indices = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      buffers = { vao, positions, normals, colors, oceanColors, elevations, indices, count: mesh.indices.length,
        indexType: mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    }

    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); lost = true; buffers = null; lastDrawn = null;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      try { lost = false; initialize(); failure = ''; }
      catch (error) { failure = error?.message || 'WebGL2 context restore failed'; }
    });

    function resize(nextWidth, nextHeight, ratio) {
      const previousWidth = width, previousHeight = height, previousDpr = dpr;
      width = Math.max(1, nextWidth); height = Math.max(1, nextHeight); dpr = Math.min(2, ratio || 1);
      const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      if (width !== previousWidth || height !== previousHeight || dpr !== previousDpr) lastDrawn = null;
      if (gl && !lost) gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function meshFor(terrain, planet) {
      let mesh = meshCache.get(terrain);
      if (!mesh || mesh.planetId !== (planet?.id || null)) {
        mesh = Mesh.create(terrain, planet, Style.mesh); meshCache.set(terrain, mesh);
      }
      if (currentMesh !== mesh) { currentMesh = mesh; upload(mesh); }
      return mesh;
    }

    function render({ terrain, planet, view, transition = null, active = true }) {
      const visible = Boolean(active && terrain && planet);
      const canRender = Boolean(gl && !lost && !failure);
      canvas.style.display = visible && canRender ? 'block' : 'none';
      if (errorElement) {
        errorElement.hidden = !(visible && !canRender);
        if (visible && !canRender) errorElement.textContent = lost
          ? 'Le rendu WebGL2 est temporairement indisponible.' : 'Cette vue nécessite WebGL2.';
      }
      if (!visible || !canRender) return { available: canRender, failure, mesh: null };
      const mesh = meshFor(terrain, planet), transform = transition || view;
      const centerX = Number.isFinite(transform.centerX) ? transform.centerX : width / 2;
      const centerY = Number.isFinite(transform.centerY) ? transform.centerY : height / 2;
      const radiusPx = Number.isFinite(transform.radiusPx) ? transform.radiusPx : Math.min(width, height) * Style.camera.radiusRatio * view.zoom;
      const opacity = Number.isFinite(transition?.globeOpacity) ? transition.globeOpacity : 1;
      if (lastDrawn && lastDrawn.mesh === mesh && lastDrawn.yaw === view.yaw && lastDrawn.pitch === view.pitch &&
        lastDrawn.centerX === centerX && lastDrawn.centerY === centerY && lastDrawn.radiusPx === radiusPx &&
        lastDrawn.opacity === opacity && lastDrawn.width === width && lastDrawn.height === height) {
        return { available: true, failure: '', mesh, cached: true };
      }
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program); gl.bindVertexArray(buffers.vao);
      gl.uniform1f(program.uniforms.yaw, view.yaw); gl.uniform1f(program.uniforms.pitch, view.pitch);
      gl.uniform2f(program.uniforms.scale, radiusPx * 2 / width, radiusPx * 2 / height);
      gl.uniform2f(program.uniforms.offset, centerX * 2 / width - 1, 1 - centerY * 2 / height);
      gl.uniform1f(program.uniforms.opacity, opacity);
      gl.uniform1f(program.uniforms.seaLevel, terrain.seaLevel);
      gl.uniform1f(program.uniforms.contourInterval, Style.topography.contourInterval);
      gl.uniform1f(program.uniforms.majorInterval, Style.topography.majorInterval);
      gl.uniform1f(program.uniforms.contourOpacity, Style.topography.contourOpacity);
      gl.uniform1f(program.uniforms.majorOpacity, Style.topography.majorOpacity);
      gl.drawElements(gl.TRIANGLES, buffers.count, buffers.indexType, 0);
      gl.bindVertexArray(null);
      lastDrawn = { mesh, yaw: view.yaw, pitch: view.pitch, centerX, centerY, radiusPx, opacity, width, height };
      return { available: true, failure: '', mesh };
    }

    return Object.freeze({ resize, render, available: () => Boolean(gl) && !failure && !lost,
      metrics: () => ({ width, height, dpr, vertices: currentMesh?.vertexCount || 0,
        longitudeSegments: currentMesh?.longitudeSegments || 0,
        latitudeSegments: currentMesh?.latitudeSegments || 0, contextLost: lost, failure }) });
  }

  root.OrbitPlanetGlobeRenderer = Object.freeze({ create });
})(globalThis);
