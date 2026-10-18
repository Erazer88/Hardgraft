(function (root) {
  'use strict';

  const Mesh = root.OrbitPlanetGlobeMesh;
  const SurfaceTexture = root.OrbitPlanetSurfaceTexture;
  const Style = root.OrbitPlanetGlobeStyle;
  const VERTEX_SHADER = `#version 300 es
    in vec3 aPosition;
    in vec3 aNormal;
    in vec2 aUv;
    in float aElevation;
    uniform float uYaw;
    uniform float uPitch;
    uniform vec2 uScale;
    uniform vec2 uOffset;
    out vec3 vNormal;
    out vec3 vTangentU;
    out vec3 vTangentV;
    out vec2 vUv;
    out float vElevation;
    void main() {
      float cy = cos(uYaw), sy = sin(uYaw), cx = cos(uPitch), sx = sin(uPitch);
      float longitude = (aUv.x - 0.5) * 6.28318530718;
      float latitude = (0.5 - aUv.y) * 3.14159265359;
      vec3 p = vec3(cy * aPosition.x + sy * aPosition.z, aPosition.y,
        -sy * aPosition.x + cy * aPosition.z);
      vec3 n = vec3(cy * aNormal.x + sy * aNormal.z, aNormal.y,
        -sy * aNormal.x + cy * aNormal.z);
      vec3 tangentU = vec3(-sin(longitude), 0.0, cos(longitude));
      vec3 tangentV = vec3(sin(latitude) * cos(longitude), -cos(latitude),
        sin(latitude) * sin(longitude));
      tangentU = vec3(cy * tangentU.x + sy * tangentU.z, tangentU.y,
        -sy * tangentU.x + cy * tangentU.z);
      tangentV = vec3(cy * tangentV.x + sy * tangentV.z, tangentV.y,
        -sy * tangentV.x + cy * tangentV.z);
      p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
      n = vec3(n.x, cx * n.y - sx * n.z, sx * n.y + cx * n.z);
      tangentU = vec3(tangentU.x, cx * tangentU.y - sx * tangentU.z,
        sx * tangentU.y + cx * tangentU.z);
      tangentV = vec3(tangentV.x, cx * tangentV.y - sx * tangentV.z,
        sx * tangentV.y + cx * tangentV.z);
      // Keep the correction local to the final two degrees, where the
      // equirectangular parameterization converges at the pole.
      float polarNormalBlend = smoothstep(1.53589, 1.5707963, abs(latitude));
      n = normalize(mix(n, normalize(p), polarNormalBlend * 0.72));
      gl_Position = vec4(p.xy * uScale + uOffset, -p.z * 0.72, 1.0);
      vNormal = normalize(n);
      vTangentU = normalize(tangentU);
      vTangentV = normalize(tangentV);
      vUv = aUv;
      vElevation = aElevation;
    }`;
  const FRAGMENT_SHADER = `#version 300 es
    precision mediump float;
    in vec3 vNormal;
    in vec3 vTangentU;
    in vec3 vTangentV;
    in vec2 vUv;
    in float vElevation;
    uniform sampler2D uSurfaceTexture;
    uniform sampler2D uDetailTexture;
    uniform vec2 uDetailTexelSize;
    uniform float uNormalDetailStrength;
    uniform float uOpacity;
    uniform float uSeaLevel;
    uniform float uContourInterval;
    uniform float uMajorInterval;
    uniform float uContourOpacity;
    uniform float uMajorOpacity;
    out vec4 outColor;
    void main() {
      vec3 lightDirection = normalize(vec3(-0.42, 0.55, 0.78));
      float latitude = (0.5 - vUv.y) * 3.14159265359;
      // Preserve relief detail almost to the pole; fade only the final row
      // where longitude derivatives are singular.
      float polarDetailFade = 1.0 - smoothstep(1.55334, 1.5707963, abs(latitude));
      float coastline = smoothstep(uSeaLevel - 1.5, uSeaLevel + 1.5, vElevation);
      vec2 bumpOffset = uDetailTexelSize * 2.0;
      float bumpLeft = texture(uDetailTexture, vUv - vec2(bumpOffset.x, 0.0)).r;
      float bumpRight = texture(uDetailTexture, vUv + vec2(bumpOffset.x, 0.0)).r;
      float bumpNorth = texture(uDetailTexture, vUv - vec2(0.0, bumpOffset.y)).r;
      float bumpSouth = texture(uDetailTexture, vUv + vec2(0.0, bumpOffset.y)).r;
      float bumpU = bumpRight - bumpLeft;
      float bumpV = bumpSouth - bumpNorth;
      vec3 normal = normalize(vNormal);
      vec3 tangentU = normalize(vTangentU - normal * dot(vTangentU, normal));
      vec3 tangentV = normalize(vTangentV - normal * dot(vTangentV, normal));
      normal = normalize(normal - (tangentU * bumpU + tangentV * bumpV) *
        (uNormalDetailStrength * 8.0 * polarDetailFade * coastline));
      float diffuse = max(dot(normalize(normal), lightDirection), 0.0);
      vec4 surface = texture(uSurfaceTexture, vUv);
      vec3 base = surface.rgb;
      float lighting = 0.68 + diffuse * 0.40;
      lighting = clamp(lighting, 0.66, 1.08);
      vec3 color = base * lighting;
      float land = smoothstep(uSeaLevel - 1.5, uSeaLevel + 1.5, vElevation);
      float minorLevel = (vElevation - uSeaLevel) / uContourInterval;
      float majorLevel = (vElevation - uSeaLevel) / uMajorInterval;
      float minorDistance = abs(fract(minorLevel + 0.5) - 0.5);
      float majorDistance = abs(fract(majorLevel + 0.5) - 0.5);
      float minorWidth = max(0.035, fwidth(minorLevel) * 0.72);
      float majorWidth = max(0.035, fwidth(majorLevel) * 0.72);
      float minorLine = (1.0 - smoothstep(0.0, minorWidth, minorDistance)) * land;
      float majorLine = (1.0 - smoothstep(0.0, majorWidth, majorDistance)) * land;
      float contour = max(minorLine * uContourOpacity, majorLine * uMajorOpacity) * coastline;
      color = mix(color, color * 0.72, contour);
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
        normal: gl.getAttribLocation(program, 'aNormal'), uv: gl.getAttribLocation(program, 'aUv'),
        elevation: gl.getAttribLocation(program, 'aElevation') };
      program.uniforms = { yaw: gl.getUniformLocation(program, 'uYaw'), pitch: gl.getUniformLocation(program, 'uPitch'),
        scale: gl.getUniformLocation(program, 'uScale'), offset: gl.getUniformLocation(program, 'uOffset'),
        opacity: gl.getUniformLocation(program, 'uOpacity'), seaLevel: gl.getUniformLocation(program, 'uSeaLevel'),
        contourInterval: gl.getUniformLocation(program, 'uContourInterval'),
        majorInterval: gl.getUniformLocation(program, 'uMajorInterval'),
        contourOpacity: gl.getUniformLocation(program, 'uContourOpacity'),
        majorOpacity: gl.getUniformLocation(program, 'uMajorOpacity'),
        surfaceTexture: gl.getUniformLocation(program, 'uSurfaceTexture'),
        detailTexture: gl.getUniformLocation(program, 'uDetailTexture'),
        detailTexelSize: gl.getUniformLocation(program, 'uDetailTexelSize'),
        normalDetailStrength: gl.getUniformLocation(program, 'uNormalDetailStrength') };
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
        gl.deleteBuffer(buffers.uvs); gl.deleteBuffer(buffers.elevations); gl.deleteBuffer(buffers.indices);
        gl.deleteTexture(buffers.surfaceTexture); gl.deleteTexture(buffers.detailTexture);
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
      const uvs = attribute('uv', mesh.uvs, 2);
      const elevations = attribute('elevation', mesh.elevations, 1);
      const indices = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      const surfaceData = SurfaceTexture.create(mesh.terrain, mesh.planet);
      const surfaceTexture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, surfaceTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, surfaceData.width, surfaceData.height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, surfaceData.pixels);
      gl.generateMipmap(gl.TEXTURE_2D);
      const detailTexture = gl.createTexture(); gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, detailTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, surfaceData.width, surfaceData.height, 0,
        gl.RED, gl.UNSIGNED_BYTE, surfaceData.detailPixels);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindVertexArray(null);
      buffers = { vao, positions, normals, uvs, elevations, indices, surfaceTexture, detailTexture, textureKey: surfaceData.key,
        textureWidth: surfaceData.width, textureHeight: surfaceData.height, count: mesh.indices.length,
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
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, buffers.surfaceTexture);
      gl.uniform1i(program.uniforms.surfaceTexture, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, buffers.detailTexture);
      gl.uniform1i(program.uniforms.detailTexture, 1);
      gl.uniform2f(program.uniforms.detailTexelSize, 1 / buffers.textureWidth, 1 / buffers.textureHeight);
      gl.uniform1f(program.uniforms.normalDetailStrength, .15);
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
        latitudeSegments: currentMesh?.latitudeSegments || 0, textureWidth: buffers?.textureWidth || 0,
        textureHeight: buffers?.textureHeight || 0, textureKey: buffers?.textureKey || null,
        normalDetailStrength: buffers ? .15 : 0, contextLost: lost, failure }) });
  }

  root.OrbitPlanetGlobeRenderer = Object.freeze({ create });
})(globalThis);
