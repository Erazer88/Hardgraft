(function (root) {
  'use strict';

  const MATERIAL_COUNT = 9;

  const VERTEX_SHADER = `#version 300 es
    const vec2 positions[3] = vec2[3](
      vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0)
    );
    void main() {
      gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `#version 300 es
    precision highp float;
    precision highp int;

    uniform sampler2DArray uBiomeTextures;
    uniform sampler2DArray uMaterialMasks;
    uniform sampler2D uBaseColor;
    uniform vec2 uViewportSize;
    uniform vec2 uMapOrigin;
    uniform vec2 uMapSize;
    uniform float uPixelRatio;
    uniform float uZoom;
    uniform float uTileWorldSize;
    uniform uint uPlanetSeed;

    out vec4 outputColor;

    uint hashCell(ivec2 cell, uint salt) {
      uvec2 point = uvec2(cell);
      uint value = point.x * 0x8da6b343u ^ point.y * 0xd8163841u ^ uPlanetSeed ^ salt;
      value ^= value >> 16;
      value *= 0x7feb352du;
      value ^= value >> 15;
      value *= 0x846ca68bu;
      return value ^ (value >> 16);
    }

    float randomCell(ivec2 cell, uint salt) {
      return float(hashCell(cell, salt) & 0x00ffffffu) / 16777216.0;
    }

    float materialMask(vec2 uv, int layer) {
      return texture(uMaterialMasks, vec3(uv, float(layer))).r;
    }

    vec2 stochasticUv(vec2 coordinate, vec2 site, ivec2 cell, int material) {
      uint salt = uint(material + 1) * 0x9e3779b9u;
      float rotation = floor(randomCell(cell, salt) * 4.0);
      vec2 local = coordinate - site;
      if (rotation < 1.0) local = vec2(local.x, local.y);
      else if (rotation < 2.0) local = vec2(-local.y, local.x);
      else if (rotation < 3.0) local = vec2(-local.x, -local.y);
      else local = vec2(local.y, -local.x);

      float scale = 0.82 + randomCell(cell, salt ^ 0xa511e9b3u) * 0.36;
      vec2 crop = vec2(randomCell(cell, salt ^ 0x63d83595u),
        randomCell(cell, salt ^ 0xb8d14e27u));
      return local * scale + crop + 0.5;
    }

    vec3 sampleBiomeSite(vec2 coordinate, ivec2 cell, int material) {
      vec2 uv = stochasticUv(coordinate, vec2(cell), cell, material);
      return texture(uBiomeTextures, vec3(uv, float(material))).rgb;
    }

    vec3 sampleBiome(vec2 world, int material) {
      vec2 coordinate = world / uTileWorldSize;
      ivec2 cell = ivec2(floor(coordinate));
      vec2 fraction = fract(coordinate);
      if (fraction.x + fraction.y <= 1.0) {
        float firstWeight = 1.0 - fraction.x - fraction.y;
        return sampleBiomeSite(coordinate, cell, material) * firstWeight +
          sampleBiomeSite(coordinate, cell + ivec2(1, 0), material) * fraction.x +
          sampleBiomeSite(coordinate, cell + ivec2(0, 1), material) * fraction.y;
      }
      float firstWeight = fraction.x + fraction.y - 1.0;
      return sampleBiomeSite(coordinate, cell + ivec2(1, 1), material) * firstWeight +
        sampleBiomeSite(coordinate, cell + ivec2(1, 0), material) * (1.0 - fraction.y) +
        sampleBiomeSite(coordinate, cell + ivec2(0, 1), material) * (1.0 - fraction.x);
    }

    void main() {
      vec2 screen = vec2(gl_FragCoord.x, uViewportSize.y - gl_FragCoord.y) / uPixelRatio;
      vec2 world = (screen - uMapOrigin) / uZoom;
      vec2 mapUv = world / uMapSize;
      if (mapUv.x < 0.0 || mapUv.y < 0.0 || mapUv.x > 1.0 || mapUv.y > 1.0) discard;

      vec3 color = texture(uBaseColor, mapUv).rgb;
      for (int material = 0; material < 9; material++) {
        float coverage = materialMask(mapUv, material);
        if (coverage > 0.005) {
          vec3 textureColor = sampleBiome(world, material);
          color = mix(color, textureColor, coverage);
        }
      }
      outputColor = vec4(color, 1.0);
    }
  `;

  function create() {
    if (!root.document?.createElement) return Object.freeze({ setMaterials() {}, draw() { return false; }, release() {} });

    const canvas = root.document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    if (!gl) return Object.freeze({ setMaterials() {}, draw() { return false; }, release() {} });

    let program = null;
    let vertexArray = null;
    let locations = null;
    let biomeTexture = null;
    let biomeImages = null;
    let activeSurface = null;
    let contextLost = false;
    let disabled = false;
    let failedSurface = null;
    let reportedFailure = false;

    function compileShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || 'Shader WebGL invalide.';
        gl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    }

    function configureSampler(target, wrap, mipmapped) {
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(target, gl.TEXTURE_WRAP_T, wrap);
      if (target === gl.TEXTURE_2D_ARRAY) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    }

    function initializeProgram() {
      const vertex = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragment = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program) || 'Impossible de lier le shader WebGL.';
        gl.deleteProgram(program);
        program = null;
        throw new Error(message);
      }

      vertexArray = gl.createVertexArray();
      gl.bindVertexArray(vertexArray);
      locations = {
        biomeTextures: gl.getUniformLocation(program, 'uBiomeTextures'),
        materialMasks: gl.getUniformLocation(program, 'uMaterialMasks'),
        baseColor: gl.getUniformLocation(program, 'uBaseColor'),
        viewportSize: gl.getUniformLocation(program, 'uViewportSize'),
        mapOrigin: gl.getUniformLocation(program, 'uMapOrigin'),
        mapSize: gl.getUniformLocation(program, 'uMapSize'),
        pixelRatio: gl.getUniformLocation(program, 'uPixelRatio'),
        zoom: gl.getUniformLocation(program, 'uZoom'),
        tileWorldSize: gl.getUniformLocation(program, 'uTileWorldSize'),
        planetSeed: gl.getUniformLocation(program, 'uPlanetSeed')
      };
    }

    function setMaterials(images) {
      if (contextLost || disabled || !Array.isArray(images) || images.length !== MATERIAL_COUNT ||
          images.some(image => !image || !(image.naturalWidth || image.width))) return false;
      if (!biomeImages || !images.every((image, index) => image === biomeImages[index])) biomeImages = images.slice();
      const width = images[0].naturalWidth || images[0].width;
      const height = images[0].naturalHeight || images[0].height;
      if (images.some(image => (image.naturalWidth || image.width) !== width ||
          (image.naturalHeight || image.height) !== height) ||
          width > gl.getParameter(gl.MAX_TEXTURE_SIZE) || height > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
          gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) < MATERIAL_COUNT) return false;
      try {
        if (!program) initializeProgram();
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    }

    function uploadBiomeTextures() {
      if (contextLost || disabled || !biomeImages) return false;
      const images = biomeImages;
      const width = images[0].naturalWidth || images[0].width;
      const height = images[0].naturalHeight || images[0].height;
      try {
        if (biomeTexture) gl.deleteTexture(biomeTexture);
        biomeTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, biomeTexture);
        configureSampler(gl.TEXTURE_2D_ARRAY, gl.MIRRORED_REPEAT, true);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(Math.max(width, height))) + 1,
          gl.RGB8, width, height, MATERIAL_COUNT);
        for (let index = 0; index < images.length; index += 1) {
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, index, width, height, 1,
            gl.RGB, gl.UNSIGNED_BYTE, images[index]);
        }
        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Le GPU ne peut pas charger les textures de biome.');
        gl.useProgram(program);
        gl.uniform1i(locations.biomeTextures, 0);
        gl.uniform1i(locations.materialMasks, 1);
        gl.uniform1i(locations.baseColor, 2);
        gl.clearColor(0, 0, 0, 0);
        gl.disable(gl.BLEND);
        return true;
      } catch (error) {
        if (biomeTexture) gl.deleteTexture(biomeTexture);
        biomeTexture = null;
        fail(error);
        return false;
      }
    }

    function deleteSurface(surface) {
      if (!surface) return;
      gl.deleteTexture(surface.maskTexture);
      gl.deleteTexture(surface.baseTexture);
    }

    function release() {
      deleteSurface(activeSurface);
      activeSurface = null;
      failedSurface = null;
      if (biomeTexture) gl.deleteTexture(biomeTexture);
      biomeTexture = null;
      canvas.width = 1;
      canvas.height = 1;
    }

    function uploadSurface(key, baseCanvas, masks, seed) {
      if (!biomeTexture || !program || !baseCanvas || !masks) return false;
      if (activeSurface?.key === key) return true;
      if (failedSurface === key) return false;
      deleteSurface(activeSurface);
      activeSurface = null;
      failedSurface = null;
      const width = baseCanvas.width, height = baseCanvas.height;
      if (!width || !height || width > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
          height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return false;
      const maskTexture = gl.createTexture();
      const baseTexture = gl.createTexture();
      try {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, maskTexture);
        configureSampler(gl.TEXTURE_2D_ARRAY, gl.CLAMP_TO_EDGE, false);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8, width, height, MATERIAL_COUNT);
        for (let index = 0; index < MATERIAL_COUNT; index += 1) {
          const alpha = masks[index];
          if (!alpha || alpha.length !== width * height) continue;
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, index, width, height, 1,
            gl.RED, gl.UNSIGNED_BYTE, alpha);
        }

        gl.bindTexture(gl.TEXTURE_2D, baseTexture);
        configureSampler(gl.TEXTURE_2D, gl.CLAMP_TO_EDGE, true);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, baseCanvas);
        gl.generateMipmap(gl.TEXTURE_2D);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Le GPU ne peut pas charger la carte de relief.');
        activeSurface = { key, maskTexture, baseTexture, seed: seed >>> 0 };
        return true;
      } catch (error) {
        gl.deleteTexture(maskTexture);
        gl.deleteTexture(baseTexture);
        failedSurface = key;
        fail(error);
        return false;
      }
    }

    function draw(frame) {
      if (contextLost || disabled || !frame.baseCanvas || !frame.materialMasks || !frame.detailTexture) return false;
      if (!biomeTexture && !uploadBiomeTextures()) return false;
      const { viewport, pixelRatio, top, zoom, mapSize, tileWorldSize, seed } = frame;
      const width = Math.max(1, Math.round(viewport.width * pixelRatio));
      const height = Math.max(1, Math.round(viewport.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (!uploadSurface(frame.detailTexture, frame.baseCanvas, frame.materialMasks, seed)) return false;

      gl.viewport(0, 0, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vertexArray);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, biomeTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, activeSurface.maskTexture);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, activeSurface.baseTexture);
      gl.uniform2f(locations.viewportSize, width, height);
      gl.uniform2f(locations.mapOrigin, top.x, top.y);
      gl.uniform2f(locations.mapSize, mapSize.width, mapSize.height);
      gl.uniform1f(locations.pixelRatio, pixelRatio);
      gl.uniform1f(locations.zoom, zoom);
      gl.uniform1f(locations.tileWorldSize, tileWorldSize);
      gl.uniform1ui(locations.planetSeed, activeSurface.seed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    }

    function fail(error) {
      disabled = true;
      if (!reportedFailure) {
        reportedFailure = true;
        root.console?.warn?.('Rendu GPU des textures indisponible, retour au rendu de carte intégré.', error);
      }
    }

    canvas.addEventListener('webglcontextlost', event => {
      // A lost GPU surface falls back to the already-baked Canvas texture.
      // Rebuilding masks here would force a large terrain pass during a gesture.
      contextLost = true;
      disabled = true;
      activeSurface = null;
      biomeTexture = null;
    });

    return Object.freeze({
      canvas,
      setMaterials,
      draw,
      release
    });
  }

  root.OrbitSurfaceMaterialRenderer = Object.freeze({ create });
})(globalThis);
