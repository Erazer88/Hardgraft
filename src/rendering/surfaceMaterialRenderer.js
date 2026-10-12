(function (root) {
  'use strict';

  const MATERIAL_COUNT = 9;
  const MATERIAL_MASK_GROUPS = 3;

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
    precision highp sampler2D;
    precision highp sampler2DArray;

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

    vec3 sampleBiome(vec2 coordinate, ivec2 cell, vec2 fraction, vec2 seams, int material) {
      float seamX = seams.x;
      float seamY = seams.y;
      vec3 current = sampleBiomeSite(coordinate, cell, material);
      if (seamX > 0.0 && seamY > 0.0) {
        vec3 right = sampleBiomeSite(coordinate, cell + ivec2(1, 0), material);
        vec3 down = sampleBiomeSite(coordinate, cell + ivec2(0, 1), material);
        vec3 diagonal = sampleBiomeSite(coordinate, cell + ivec2(1, 1), material);
        return mix(mix(current, right, seamX), mix(down, diagonal, seamX), seamY);
      }
      if (seamX > 0.0) return mix(current,
        sampleBiomeSite(coordinate, cell + ivec2(1, 0), material), seamX);
      if (seamY > 0.0) return mix(current,
        sampleBiomeSite(coordinate, cell + ivec2(0, 1), material), seamY);
      return current;
    }

    void blendBiome(inout vec3 color, float coverage, vec2 coordinate,
        ivec2 cell, vec2 fraction, vec2 seams, int material) {
      if (coverage > 0.005) {
        color = mix(color, sampleBiome(coordinate, cell, fraction, seams, material), coverage);
      }
    }

    void main() {
      vec2 screen = vec2(gl_FragCoord.x, uViewportSize.y - gl_FragCoord.y) / uPixelRatio;
      vec2 world = (screen - uMapOrigin) / uZoom;
      vec2 mapUv = world / uMapSize;
      if (mapUv.x < 0.0 || mapUv.y < 0.0 || mapUv.x > 1.0 || mapUv.y > 1.0) discard;

      vec3 color = texture(uBaseColor, mapUv).rgb;
      vec2 coordinate = world / uTileWorldSize;
      ivec2 cell = ivec2(floor(coordinate));
      vec2 fraction = fract(coordinate);
      const float seamWidth = 0.09;
      vec2 seams = vec2(smoothstep(1.0 - seamWidth, 1.0, fraction.x),
        smoothstep(1.0 - seamWidth, 1.0, fraction.y));
      vec3 maskGroup0 = texture(uMaterialMasks, vec3(mapUv, 0.0)).rgb;
      vec3 maskGroup1 = texture(uMaterialMasks, vec3(mapUv, 1.0)).rgb;
      vec3 maskGroup2 = texture(uMaterialMasks, vec3(mapUv, 2.0)).rgb;
      blendBiome(color, maskGroup0.r, coordinate, cell, fraction, seams, 0);
      blendBiome(color, maskGroup0.g, coordinate, cell, fraction, seams, 1);
      blendBiome(color, maskGroup0.b, coordinate, cell, fraction, seams, 2);
      blendBiome(color, maskGroup1.r, coordinate, cell, fraction, seams, 3);
      blendBiome(color, maskGroup1.g, coordinate, cell, fraction, seams, 4);
      blendBiome(color, maskGroup1.b, coordinate, cell, fraction, seams, 5);
      blendBiome(color, maskGroup2.r, coordinate, cell, fraction, seams, 6);
      blendBiome(color, maskGroup2.g, coordinate, cell, fraction, seams, 7);
      blendBiome(color, maskGroup2.b, coordinate, cell, fraction, seams, 8);
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
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    if (!gl) return Object.freeze({ setMaterials() {}, draw() { return false; }, release() {} });

    let program = null;
    let vertexArray = null;
    let locations = null;
    let biomeTexture = null;
    let biomeUploadTexture = null;
    let biomeUploadLayer = 0;
    let biomeImages = null;
    let activeSurface = null;
    let pendingSurface = null;
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
      if (biomeTexture) return true;
      const images = biomeImages;
      const width = images[0].naturalWidth || images[0].width;
      const height = images[0].naturalHeight || images[0].height;
      try {
        if (!biomeUploadTexture) {
          biomeUploadTexture = gl.createTexture();
          biomeUploadLayer = 0;
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, biomeUploadTexture);
          const mipLevels = Math.floor(Math.log2(Math.max(width, height))) + 1;
          configureSampler(gl.TEXTURE_2D_ARRAY, gl.MIRRORED_REPEAT, true);
          gl.texStorage3D(gl.TEXTURE_2D_ARRAY, mipLevels, gl.RGB8, width, height, MATERIAL_COUNT);
        } else {
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, biomeUploadTexture);
        }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, biomeUploadLayer,
          width, height, 1, gl.RGB, gl.UNSIGNED_BYTE, images[biomeUploadLayer]);
        biomeUploadLayer += 1;
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Le GPU ne peut pas charger les textures de biome.');
        if (biomeUploadLayer < images.length) return false;

        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Le GPU ne peut pas finaliser les textures de biome.');
        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Le GPU ne peut pas lisser les niveaux de détail des textures.');
        biomeTexture = biomeUploadTexture;
        biomeUploadTexture = null;
        gl.useProgram(program);
        gl.uniform1i(locations.biomeTextures, 0);
        gl.uniform1i(locations.materialMasks, 1);
        gl.uniform1i(locations.baseColor, 2);
        gl.clearColor(0, 0, 0, 0);
        gl.disable(gl.BLEND);
        return true;
      } catch (error) {
        if (biomeUploadTexture) gl.deleteTexture(biomeUploadTexture);
        biomeUploadTexture = null;
        biomeUploadLayer = 0;
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
      deleteSurface(pendingSurface);
      activeSurface = null;
      pendingSurface = null;
      failedSurface = null;
      // Biome atlases are shared across planets. Keep them resident so leaving
      // and re-entering a surface does not trigger another large GPU upload.
      canvas.width = 1;
      canvas.height = 1;
    }

    function uploadSurface(key, baseCanvas, masks, seed) {
      if (!biomeTexture || !program || !baseCanvas) return false;
      if (activeSurface?.key === key) return true;
      if (failedSurface === key) return false;
      if (pendingSurface?.key !== key) {
        deleteSurface(activeSurface);
        deleteSurface(pendingSurface);
        activeSurface = null;
        pendingSurface = null;
        failedSurface = null;
        if (!masks) return false;
        const width = baseCanvas.width, height = baseCanvas.height;
        if (!width || !height || width > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
            height > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
            masks.length !== MATERIAL_MASK_GROUPS || masks.some(mask => mask.length !== width * height * 3)) return false;
        const maskTexture = gl.createTexture();
        const baseTexture = gl.createTexture();
        try {
          const mipLevels = Math.floor(Math.log2(Math.max(width, height))) + 1;
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, maskTexture);
          configureSampler(gl.TEXTURE_2D_ARRAY, gl.CLAMP_TO_EDGE, true);
          gl.texStorage3D(gl.TEXTURE_2D_ARRAY, mipLevels, gl.RGB8, width, height, MATERIAL_MASK_GROUPS);
          gl.bindTexture(gl.TEXTURE_2D, baseTexture);
          configureSampler(gl.TEXTURE_2D, gl.CLAMP_TO_EDGE, true);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
          if (gl.getError() !== gl.NO_ERROR) throw new Error('Le GPU ne peut pas réserver la carte de relief.');
          pendingSurface = { key, baseCanvas, masks, seed: seed >>> 0,
            width, height, maskTexture, baseTexture, nextLayer: 0 };
        } catch (error) {
          gl.deleteTexture(maskTexture);
          gl.deleteTexture(baseTexture);
          failedSurface = key;
          fail(error);
          return false;
        }
      }

      const upload = pendingSurface;
      try {
        if (upload.nextLayer < MATERIAL_MASK_GROUPS) {
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, upload.maskTexture);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, upload.nextLayer,
            upload.width, upload.height, 1, gl.RGB, gl.UNSIGNED_BYTE, upload.masks[upload.nextLayer]);
          upload.nextLayer += 1;
          if (gl.getError() !== gl.NO_ERROR) throw new Error('Le GPU ne peut pas charger les masques du relief.');
          return false;
        } else {
          gl.bindTexture(gl.TEXTURE_2D, upload.baseTexture);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, upload.baseCanvas);
        }
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Le GPU ne peut pas charger la carte de relief.');
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, upload.maskTexture);
        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
        gl.bindTexture(gl.TEXTURE_2D, upload.baseTexture);
        gl.generateMipmap(gl.TEXTURE_2D);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Le GPU ne peut pas lisser les niveaux de détail de la carte.');
        activeSurface = { key, maskTexture: upload.maskTexture,
          baseTexture: upload.baseTexture, seed: upload.seed };
        pendingSurface = null;
        return true;
      } catch (error) {
        deleteSurface(upload);
        pendingSurface = null;
        failedSurface = key;
        fail(error);
        return false;
      }
    }

    function draw(frame) {
      if (contextLost || disabled || !frame.baseCanvas || !frame.detailTexture) return false;
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
      pendingSurface = null;
      biomeTexture = null;
      biomeUploadTexture = null;
      biomeUploadLayer = 0;
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
