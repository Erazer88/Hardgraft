(function (root) {
  'use strict';

  const Mesh = root.OrbitPlanetGlobeMesh;
  const SurfaceTexture = root.OrbitPlanetSurfaceTexture;
  const Style = root.OrbitPlanetGlobeStyle;
  const VERTEX_SHADER = `#version 300 es
    precision highp float;
    in vec3 aPosition;
    in vec3 aNormal;
    in vec2 aUv;
    in float aElevation;
    uniform float uYaw;
    uniform float uPitch;
    uniform vec2 uScale;
    uniform vec2 uOffset;
    uniform highp float uAtmospherePass;
    uniform float uShellScale;
    out vec3 vNormal;
    out vec3 vSphereNormal;
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
      if (uAtmospherePass > 0.5) {
        p = normalize(p) * uShellScale;
        n = normalize(p);
      }
      // Keep the correction local to the final two degrees, where the
      // equirectangular parameterization converges at the pole.
      float polarNormalBlend = smoothstep(1.53589, 1.5707963, abs(latitude));
      n = normalize(mix(n, normalize(p), polarNormalBlend * 0.72));
      gl_Position = vec4(p.xy * uScale + uOffset, -p.z * 0.72, 1.0);
      vNormal = normalize(n);
      vSphereNormal = normalize(p);
      vTangentU = normalize(tangentU);
      vTangentV = normalize(tangentV);
      vUv = aUv;
      vElevation = aElevation;
    }`;
  const FRAGMENT_SHADER = `#version 300 es
    precision highp float;
    in vec3 vNormal;
    in vec3 vSphereNormal;
    in vec3 vTangentU;
    in vec3 vTangentV;
    in vec2 vUv;
    in float vElevation;
    uniform sampler2D uAlbedoTexture;
    uniform sampler2D uHeightTexture;
    uniform sampler2D uLandMaskTexture;
    uniform sampler2D uCoastSdfTexture;
    uniform sampler2D uDetailTexture;
    uniform vec2 uHeightTexelSize;
    uniform vec2 uFacetGrid;
    uniform float uReliefScale;
    uniform float uMidReliefStrength;
    uniform float uFacetMix;
    uniform float uDetailNormalStrength;
    uniform float uAoStrength;
    uniform float uRidgeAccentStrength;
    uniform float uCoastWidth;
    uniform float uCoastRange;
    uniform vec3 uCoastColor;
    uniform vec3 uWaterShallowColor;
    uniform vec3 uWaterMidColor;
    uniform vec3 uWaterDeepColor;
    uniform float uWaterNoiseAmplitude;
    uniform float uWaterNormalStrength;
    uniform float uWaterSpecularStrength;
    uniform float uWaterFresnelStrength;
    uniform float uWaterCoastDepthDistance;
    uniform float uWaterBathymetryDepthScale;
    uniform float uWaterBathymetryInfluence;
    uniform vec3 uRockColor;
    uniform vec3 uRidgeColor;
    uniform vec3 uCreviceColor;
    uniform float uHasLiquidOcean;
    uniform float uOpacity;
    uniform float uSeaLevel;
    uniform float uContourInterval;
    uniform float uMajorInterval;
    uniform float uContourOpacity;
    uniform float uMajorOpacity;
    uniform highp float uAtmospherePass;
    uniform vec3 uAtmosphereColor;
    uniform float uAtmosphereAlpha;
    uniform float uAtmospherePower;
    out vec4 outColor;
    float decodeHeight(vec2 rg) {
      return dot(rg, vec2(65280.0, 255.0)) / 65535.0;
    }
    float sampleLandHeight(vec2 uv, float lod) {
      return clamp((decodeHeight(textureLod(uHeightTexture, uv, lod).rg) * 255.0 - uSeaLevel) /
        max(1.0, 255.0 - uSeaLevel), 0.0, 1.0);
    }
    void main() {
      if (uAtmospherePass > 0.5) {
        float facing = dot(normalize(vNormal), vec3(0.0, 0.0, 1.0));
        if (facing <= 0.0) discard;
        float fresnel = pow(clamp(1.0 - facing, 0.0, 1.0), uAtmospherePower);
        outColor = vec4(uAtmosphereColor, fresnel * uAtmosphereAlpha * uOpacity);
        return;
      }

      vec3 lightDirection = normalize(vec3(-0.42, 0.55, 0.78));
      float latitude = (0.5 - vUv.y) * 3.14159265359;
      float polarDetailFade = 1.0 - smoothstep(1.55334, 1.5707963, abs(latitude));
      vec3 baseNormal = normalize(vNormal);
      vec3 tangentU = normalize(vTangentU - baseNormal * dot(vTangentU, baseNormal));
      vec3 tangentV = normalize(vTangentV - baseNormal * dot(vTangentV, baseNormal));
      float lonMetric = max(0.18, cos(latitude));
      // Geometry normals provide the calm macro form; the unsaturated source
      // height restores mountain structure that the shaped mesh flattens at summits.
      vec2 midStep = uHeightTexelSize * 2.0;
      float midLeft = sampleLandHeight(vUv - vec2(midStep.x, 0.0), 0.0);
      float midRight = sampleLandHeight(vUv + vec2(midStep.x, 0.0), 0.0);
      float midNorth = sampleLandHeight(vUv - vec2(0.0, midStep.y), 0.0);
      float midSouth = sampleLandHeight(vUv + vec2(0.0, midStep.y), 0.0);
      float midDx = (midRight - midLeft) / max(0.0001, 12.5663706 * midStep.x * lonMetric) * uReliefScale;
      float midDy = (midSouth - midNorth) / max(0.0001, 6.2831853 * midStep.y) * uReliefScale;
      vec3 midReliefNormal = normalize(baseNormal - tangentU * midDx * uMidReliefStrength - tangentV * midDy * uMidReliefStrength);
      float slope = clamp(length(vec2(midDx, midDy)) * 2.2, 0.0, 1.0);

      // Keep facet sampling continuous in UV space. Snapping the sample point
      // to a grid creates visible square patches on broad mountain faces.
      vec2 facetStep = max(uHeightTexelSize * 2.0, 1.0 / uFacetGrid);
      float facetLeft = sampleLandHeight(vUv - vec2(facetStep.x, 0.0), 1.0);
      float facetRight = sampleLandHeight(vUv + vec2(facetStep.x, 0.0), 1.0);
      float facetNorth = sampleLandHeight(vUv - vec2(0.0, facetStep.y), 1.0);
      float facetSouth = sampleLandHeight(vUv + vec2(0.0, facetStep.y), 1.0);
      float facetCenter = sampleLandHeight(vUv, 1.0);
      float fdHx = (facetRight - facetLeft) / max(0.0001, 12.5663706 * facetStep.x * lonMetric) * uReliefScale;
      float fdHy = (facetSouth - facetNorth) / max(0.0001, 6.2831853 * facetStep.y) * uReliefScale;
      vec3 facetNormal = normalize(baseNormal - tangentU * fdHx * uMidReliefStrength - tangentV * fdHy * uMidReliefStrength);
      // Dimensionless curvature is much less eager than dividing by the tiny
      // UV step: that normalization amplified every small terrain ripple into
      // a dark or bright contour. Accents now appear only at actual ridges.
      float ridgeSignal = facetCenter * 4.0 - facetLeft - facetRight - facetNorth - facetSouth;
      float ridgeStrength = smoothstep(0.0025, 0.014, max(0.0, ridgeSignal));
      float valleyStrength = smoothstep(0.003, 0.016, max(0.0, -ridgeSignal));

      float encodedElevation = decodeHeight(texture(uHeightTexture, vUv).rg);
      float height = sampleLandHeight(vUv, 0.0);
      float landCoverage = texture(uLandMaskTexture, vUv).r;
      float slopeMask = smoothstep(0.10, 0.24, slope);
      float altitudeMask = smoothstep(0.22, 0.55, height);
      float ruggedMask = smoothstep(0.60, 0.90, ridgeStrength);
      float mountainMask = landCoverage * altitudeMask * max(slopeMask, ruggedMask);
      vec3 terrainNormal = normalize(mix(baseNormal, midReliefNormal, mountainMask));
      float facetMask = mountainMask * smoothstep(0.08, 0.22, slope);
      vec3 finalNormal = normalize(mix(terrainNormal, facetNormal, facetMask * uFacetMix));
      float microDetail = texture(uDetailTexture, vUv).r - 0.5;
      vec3 detailedNormal = normalize(midReliefNormal - (tangentU + tangentV * 0.65) * microDetail *
        polarDetailFade);
      float detailMask = smoothstep(0.12, 0.30, slope) * mountainMask;
      finalNormal = normalize(mix(finalNormal, detailedNormal,
        detailMask * uDetailNormalStrength));

      float coastSdf = texture(uCoastSdfTexture, vUv).r * 2.0 - 1.0;
      float coastWidth = max(uCoastWidth, fwidth(coastSdf) * 1.15);
      float coastBlend = smoothstep(-coastWidth, coastWidth, coastSdf);
      float land = mix(landCoverage, coastBlend, 0.35);
      float shoreBand = 1.0 - smoothstep(coastWidth * 0.45, coastWidth * 1.55, abs(coastSdf));
      vec3 base = texture(uAlbedoTexture, vUv).rgb;
      base = mix(base, uCoastColor, shoreBand * 0.32);

      float rockExposure = mountainMask * smoothstep(0.34, 0.58, height) * smoothstep(0.14, 0.34, slope);
      vec3 landMaterial = mix(base, uRockColor, rockExposure * 0.44);
      landMaterial = mix(landMaterial, uCreviceColor,
        valleyStrength * mountainMask * smoothstep(0.30, 0.50, height) * 0.015);
      landMaterial = mix(landMaterial, uRidgeColor, ridgeStrength * mountainMask * 0.07);
      float diffuse = dot(finalNormal, lightDirection) * 0.5 + 0.5;
      diffuse *= diffuse;
      float shadeBands = mix(diffuse, floor(diffuse * 4.0) / 4.0, facetMask * 0.22);
      float lightTerm = 0.58 + shadeBands * 0.60;
      float ao = 1.0 - slope * uAoStrength * land * mountainMask;
      float ridgeLight = ridgeStrength * mountainMask * max(dot(finalNormal, lightDirection), 0.0) * uRidgeAccentStrength;
      vec3 landColor = landMaterial * lightTerm * ao * (1.0 + ridgeLight);

      float bathymetry = decodeHeight(textureLod(uHeightTexture, vUv, 2.0).rg) * 255.0;
      float waterDepth = clamp((uSeaLevel - bathymetry) / max(1.0, uWaterBathymetryDepthScale), 0.0, 1.0);
      float coastDistance = max(0.0, -coastSdf) * uCoastRange;
      float coastalDepth = smoothstep(1.0, uWaterCoastDepthDistance, coastDistance);
      // Coast distance sets the clean, broad water gradient. Smoothed
      // bathymetry only nudges it, so underwater elevation noise cannot paint
      // large cloudy patches across the ocean.
      float depth01 = mix(coastalDepth, waterDepth, uWaterBathymetryInfluence);
      vec3 waterColor = mix(uWaterShallowColor, uWaterMidColor, smoothstep(0.06, 0.48, depth01));
      waterColor = mix(waterColor, uWaterDeepColor, smoothstep(0.46, 0.96, depth01));
      float oceanNoise = clamp((texture(uDetailTexture, vUv).r - 0.5) * 20.0, -1.0, 1.0);
      waterColor *= 1.0 + oceanNoise * uWaterNoiseAmplitude;
      vec3 waterBaseNormal = normalize(vSphereNormal);
      vec3 waterNormal = normalize(waterBaseNormal - (tangentU + tangentV * 0.65) * oceanNoise * uWaterNormalStrength);
      float waterDiffuse = 0.94 + max(dot(waterNormal, lightDirection), 0.0) * 0.07;
      waterColor *= waterDiffuse;
      vec3 viewDirection = vec3(0.0, 0.0, 1.0);
      vec3 halfVector = normalize(lightDirection + viewDirection);
      float oceanSpecular = pow(max(dot(waterNormal, halfVector), 0.0), 48.0) * uWaterSpecularStrength;
      float oceanFresnel = pow(1.0 - max(dot(viewDirection, waterNormal), 0.0), 3.0) * uWaterFresnelStrength;
      waterColor += oceanSpecular * vec3(0.64, 0.84, 1.0) + oceanFresnel * vec3(0.16, 0.42, 0.54);
      float oceanCoverage = (1.0 - landCoverage) * uHasLiquidOcean;
      vec3 color = mix(landColor, waterColor, oceanCoverage);

      float minorLevel = (vElevation - uSeaLevel) / uContourInterval;
      float majorLevel = (vElevation - uSeaLevel) / uMajorInterval;
      float minorDistance = abs(fract(minorLevel + 0.5) - 0.5);
      float majorDistance = abs(fract(majorLevel + 0.5) - 0.5);
      float minorWidth = max(0.035, fwidth(minorLevel) * 0.72);
      float majorWidth = max(0.035, fwidth(majorLevel) * 0.72);
      float minorLine = (1.0 - smoothstep(0.0, minorWidth, minorDistance)) * land;
      float majorLine = (1.0 - smoothstep(0.0, majorWidth, majorDistance)) * land;
      float contour = max(minorLine * uContourOpacity, majorLine * uMajorOpacity) *
        smoothstep(uSeaLevel + 1.0, uSeaLevel + 3.0, vElevation);
      color = mix(color, color * 0.82, contour);
      outColor = vec4(clamp(color, 0.0, 1.0), uOpacity);
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
    let currentTextureWidth = SurfaceTexture.defaults.width;
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
        atmospherePass: gl.getUniformLocation(program, 'uAtmospherePass'), shellScale: gl.getUniformLocation(program, 'uShellScale'),
        atmosphereColor: gl.getUniformLocation(program, 'uAtmosphereColor'),
        atmosphereAlpha: gl.getUniformLocation(program, 'uAtmosphereAlpha'),
        atmospherePower: gl.getUniformLocation(program, 'uAtmospherePower'),
        contourInterval: gl.getUniformLocation(program, 'uContourInterval'),
        majorInterval: gl.getUniformLocation(program, 'uMajorInterval'),
        contourOpacity: gl.getUniformLocation(program, 'uContourOpacity'),
        majorOpacity: gl.getUniformLocation(program, 'uMajorOpacity'),
        albedoTexture: gl.getUniformLocation(program, 'uAlbedoTexture'),
        heightTexture: gl.getUniformLocation(program, 'uHeightTexture'),
        landMaskTexture: gl.getUniformLocation(program, 'uLandMaskTexture'),
        coastSdfTexture: gl.getUniformLocation(program, 'uCoastSdfTexture'),
        detailTexture: gl.getUniformLocation(program, 'uDetailTexture'),
        heightTexelSize: gl.getUniformLocation(program, 'uHeightTexelSize'),
        facetGrid: gl.getUniformLocation(program, 'uFacetGrid'),
        reliefScale: gl.getUniformLocation(program, 'uReliefScale'),
        midReliefStrength: gl.getUniformLocation(program, 'uMidReliefStrength'),
        facetMix: gl.getUniformLocation(program, 'uFacetMix'),
        detailNormalStrength: gl.getUniformLocation(program, 'uDetailNormalStrength'),
        aoStrength: gl.getUniformLocation(program, 'uAoStrength'),
        ridgeAccentStrength: gl.getUniformLocation(program, 'uRidgeAccentStrength'),
        coastWidth: gl.getUniformLocation(program, 'uCoastWidth'),
        coastRange: gl.getUniformLocation(program, 'uCoastRange'),
        coastColor: gl.getUniformLocation(program, 'uCoastColor'),
        waterShallowColor: gl.getUniformLocation(program, 'uWaterShallowColor'),
        waterMidColor: gl.getUniformLocation(program, 'uWaterMidColor'),
        waterDeepColor: gl.getUniformLocation(program, 'uWaterDeepColor'),
        waterNoiseAmplitude: gl.getUniformLocation(program, 'uWaterNoiseAmplitude'),
        waterNormalStrength: gl.getUniformLocation(program, 'uWaterNormalStrength'),
        waterSpecularStrength: gl.getUniformLocation(program, 'uWaterSpecularStrength'),
        waterFresnelStrength: gl.getUniformLocation(program, 'uWaterFresnelStrength'),
        waterCoastDepthDistance: gl.getUniformLocation(program, 'uWaterCoastDepthDistance'),
        waterBathymetryDepthScale: gl.getUniformLocation(program, 'uWaterBathymetryDepthScale'),
        waterBathymetryInfluence: gl.getUniformLocation(program, 'uWaterBathymetryInfluence'),
        rockColor: gl.getUniformLocation(program, 'uRockColor'),
        ridgeColor: gl.getUniformLocation(program, 'uRidgeColor'),
        creviceColor: gl.getUniformLocation(program, 'uCreviceColor'),
        hasLiquidOcean: gl.getUniformLocation(program, 'uHasLiquidOcean') };
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      buffers = null;
      if (currentMesh) upload(currentMesh, currentTextureWidth);
    }

    function upload(mesh, textureWidth) {
      if (!gl || lost || !mesh) return;
      lastDrawn = null;
      if (buffers) {
        gl.deleteBuffer(buffers.positions); gl.deleteBuffer(buffers.normals);
        gl.deleteBuffer(buffers.uvs); gl.deleteBuffer(buffers.elevations); gl.deleteBuffer(buffers.indices);
        gl.deleteTexture(buffers.albedoTexture); gl.deleteTexture(buffers.heightTexture);
        gl.deleteTexture(buffers.landMaskTexture); gl.deleteTexture(buffers.coastSdfTexture);
        gl.deleteTexture(buffers.detailTexture);
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
      const surfaceData = SurfaceTexture.create(mesh.terrain, mesh.planet,
        { width: textureWidth, height: textureWidth / 2 });
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      function uploadTexture(unit, internalFormat, format, pixels) {
        const texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, surfaceData.width, surfaceData.height, 0,
          format, gl.UNSIGNED_BYTE, pixels);
        gl.generateMipmap(gl.TEXTURE_2D);
        return texture;
      }
      const albedoTexture = uploadTexture(0, gl.RGBA8, gl.RGBA, surfaceData.albedoPixels);
      const heightTexture = uploadTexture(1, gl.RG8, gl.RG, surfaceData.heightPixels);
      const landMaskTexture = uploadTexture(2, gl.R8, gl.RED, surfaceData.landMaskPixels);
      const coastSdfTexture = uploadTexture(3, gl.R8, gl.RED, surfaceData.coastSdfPixels);
      const detailTexture = uploadTexture(4, gl.R8, gl.RED, surfaceData.detailPixels);
      gl.bindVertexArray(null);
      buffers = { vao, positions, normals, uvs, elevations, indices, albedoTexture, heightTexture,
        landMaskTexture, coastSdfTexture, detailTexture, coastRange: surfaceData.coastRange,
        coastColor: surfaceData.coastColor, textureKey: surfaceData.key,
        climate: surfaceData.climate,
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
      width = Math.max(1, nextWidth); height = Math.max(1, nextHeight); dpr = Math.min(3, ratio || 1);
      const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      if (width !== previousWidth || height !== previousHeight || dpr !== previousDpr) lastDrawn = null;
      if (gl && !lost) gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function meshFor(terrain, planet, textureWidth) {
      let mesh = meshCache.get(terrain);
      if (!mesh || mesh.planetId !== (planet?.id || null)) {
        mesh = Mesh.create(terrain, planet, Style.mesh); meshCache.set(terrain, mesh);
      }
      if (currentMesh !== mesh || buffers?.textureWidth !== textureWidth) {
        currentMesh = mesh; currentTextureWidth = textureWidth; upload(mesh, textureWidth);
      }
      return mesh;
    }

    function textureWidthFor(radiusPx) {
      const requested = SurfaceTexture.defaults.width;
      return Math.min(requested, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048);
    }

    function atmosphereRgb(planet) {
      const hex = Style.atmosphere.colors[planet?.kind] || Style.atmosphere.colors.default;
      const value = Number.parseInt(hex.slice(1), 16);
      return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
    }

    function setHexUniform(location, hex) {
      const value = Number.parseInt(hex.slice(1), 16);
      gl.uniform3f(location, ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255, (value & 255) / 255);
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
      const transform = transition || view;
      const centerX = Number.isFinite(transform.centerX) ? transform.centerX : width / 2;
      const centerY = Number.isFinite(transform.centerY) ? transform.centerY : height / 2;
      const radiusPx = Number.isFinite(transform.radiusPx) ? transform.radiusPx : Math.min(width, height) * Style.camera.radiusRatio * view.zoom;
      const mesh = meshFor(terrain, planet, textureWidthFor(radiusPx));
      const opacity = Number.isFinite(transition?.globeOpacity) ? transition.globeOpacity : 1;
      if (lastDrawn && lastDrawn.mesh === mesh && lastDrawn.yaw === view.yaw && lastDrawn.pitch === view.pitch &&
        lastDrawn.centerX === centerX && lastDrawn.centerY === centerY && lastDrawn.radiusPx === radiusPx &&
        lastDrawn.opacity === opacity && lastDrawn.width === width && lastDrawn.height === height) {
        return { available: true, failure: '', mesh, cached: true };
      }
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program); gl.bindVertexArray(buffers.vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, buffers.albedoTexture);
      gl.uniform1i(program.uniforms.albedoTexture, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, buffers.heightTexture);
      gl.uniform1i(program.uniforms.heightTexture, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, buffers.landMaskTexture);
      gl.uniform1i(program.uniforms.landMaskTexture, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, buffers.coastSdfTexture);
      gl.uniform1i(program.uniforms.coastSdfTexture, 3);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, buffers.detailTexture);
      gl.uniform1i(program.uniforms.detailTexture, 4);
      gl.uniform2f(program.uniforms.heightTexelSize, 1 / buffers.textureWidth, 1 / buffers.textureHeight);
      gl.uniform2f(program.uniforms.facetGrid, Style.terrainShading.facetGrid.x,
        Style.terrainShading.facetGrid.y);
      gl.uniform1f(program.uniforms.reliefScale, Style.relief.scale);
      gl.uniform1f(program.uniforms.midReliefStrength, Style.terrainShading.midReliefStrength);
      gl.uniform1f(program.uniforms.facetMix, Style.terrainShading.mountainFacetMix);
      gl.uniform1f(program.uniforms.detailNormalStrength, Style.terrainShading.microDetailStrength);
      gl.uniform1f(program.uniforms.aoStrength, Style.terrainShading.mountainAoStrength);
      gl.uniform1f(program.uniforms.ridgeAccentStrength, Style.terrainShading.ridgeAccentStrength);
      gl.uniform1f(program.uniforms.coastWidth, 1.5 / buffers.coastRange);
      gl.uniform1f(program.uniforms.coastRange, buffers.coastRange);
      setHexUniform(program.uniforms.coastColor, buffers.coastColor);
      const water = Style.water;
      setHexUniform(program.uniforms.waterShallowColor, water.shallow);
      setHexUniform(program.uniforms.waterMidColor, water.mid);
      setHexUniform(program.uniforms.waterDeepColor, water.deep);
      gl.uniform1f(program.uniforms.waterNoiseAmplitude, water.noiseAmplitude);
      gl.uniform1f(program.uniforms.waterNormalStrength, water.normalStrength);
      gl.uniform1f(program.uniforms.waterSpecularStrength, water.specularStrength);
      gl.uniform1f(program.uniforms.waterFresnelStrength, water.fresnelStrength);
      gl.uniform1f(program.uniforms.waterCoastDepthDistance, water.coastDepthDistance);
      gl.uniform1f(program.uniforms.waterBathymetryDepthScale, water.bathymetryDepthScale);
      gl.uniform1f(program.uniforms.waterBathymetryInfluence, water.bathymetryInfluence);
      const materials = Style.terrainShading.mountainMaterials[buffers.climate] ||
        Style.terrainShading.mountainMaterials.default;
      setHexUniform(program.uniforms.rockColor, materials.rock);
      setHexUniform(program.uniforms.ridgeColor, materials.ridge);
      setHexUniform(program.uniforms.creviceColor, materials.crevice);
      gl.uniform1f(program.uniforms.hasLiquidOcean,
        planet.kind === 'glacée' || planet.kind === 'aride' || planet.kind === 'volcanique' ? 0 : 1);
      gl.uniform1f(program.uniforms.atmospherePass, 0);
      gl.uniform1f(program.uniforms.shellScale, 1);
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
      const atmosphere = Style.atmosphere, rgb = atmosphereRgb(planet);
      gl.uniform3f(program.uniforms.atmosphereColor, rgb[0], rgb[1], rgb[2]);
      gl.uniform1f(program.uniforms.atmospherePass, 1);
      gl.depthMask(false); gl.disable(gl.DEPTH_TEST);
      gl.uniform1f(program.uniforms.shellScale, atmosphere.haloScale);
      gl.uniform1f(program.uniforms.atmosphereAlpha, atmosphere.haloAlpha);
      gl.uniform1f(program.uniforms.atmospherePower, atmosphere.haloPower);
      gl.drawElements(gl.TRIANGLES, buffers.count, buffers.indexType, 0);
      gl.uniform1f(program.uniforms.shellScale, atmosphere.shellScale);
      gl.uniform1f(program.uniforms.atmosphereAlpha, atmosphere.rimAlpha);
      gl.uniform1f(program.uniforms.atmospherePower, atmosphere.rimPower);
      gl.drawElements(gl.TRIANGLES, buffers.count, buffers.indexType, 0);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
      gl.bindVertexArray(null);
      lastDrawn = { mesh, yaw: view.yaw, pitch: view.pitch, centerX, centerY, radiusPx, opacity, width, height };
      return { available: true, failure: '', mesh };
    }

    return Object.freeze({ resize, render, available: () => Boolean(gl) && !failure && !lost,
      metrics: () => ({ width, height, dpr, vertices: currentMesh?.vertexCount || 0,
        longitudeSegments: currentMesh?.longitudeSegments || 0,
        latitudeSegments: currentMesh?.latitudeSegments || 0, textureWidth: buffers?.textureWidth || 0,
        textureHeight: buffers?.textureHeight || 0, textureKey: buffers?.textureKey || null,
        midReliefStrength: buffers ? Style.terrainShading.midReliefStrength : 0,
        facetMix: buffers ? Style.terrainShading.mountainFacetMix : 0,
        detailNormalStrength: buffers ? Style.terrainShading.microDetailStrength : 0,
        coastRange: buffers?.coastRange || 0, contextLost: lost, failure }) });
  }

  root.OrbitPlanetGlobeRenderer = Object.freeze({ create });
})(globalThis);
