(function (root) {
  'use strict';

  const Mesh = root.OrbitPlanetGlobeMesh;
  const SurfaceTexture = root.OrbitPlanetSurfaceTexture;
  const Projection = root.OrbitPlanetGlobeProjection;
  const Style = root.OrbitPlanetGlobeStyle;
  const VERTEX_SHADER = `#version 300 es
    precision highp float;
    layout(location = 0) in vec3 aPosition;
    layout(location = 1) in vec3 aNormal;
    layout(location = 2) in vec2 aUv;
    layout(location = 3) in float aElevation;
    uniform float uYaw;
    uniform float uPitch;
    uniform vec2 uScale;
    uniform vec2 uOffset;
    uniform highp float uAtmospherePass;
    uniform float uShellScale;
    uniform float uReliefLow;
    uniform float uReliefHigh;
    uniform float uReliefPeak;
    uniform float uReliefPeakStart;
    uniform float uPolarNormalBlendStart;
    uniform float uPolarNormalBlendEnd;
    uniform float uPolarNormalBlendStrength;
    out vec3 vNormal;
    out vec3 vSphereNormal;
    out vec3 vTangentU;
    out vec3 vTangentV;
    out vec2 vUv;
    out float vElevation;
    out float vVisualHeight;
    ${Projection.shaderVisualHeight}
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
      float polarNormalBlend = smoothstep(uPolarNormalBlendStart, uPolarNormalBlendEnd, abs(latitude));
      n = normalize(mix(n, normalize(p), polarNormalBlend * uPolarNormalBlendStrength));
      gl_Position = vec4(p.xy * uScale + uOffset, -p.z * 0.72, 1.0);
      vNormal = normalize(n);
      vSphereNormal = normalize(p);
      vTangentU = normalize(tangentU);
      vTangentV = normalize(tangentV);
      vUv = aUv;
      vElevation = aElevation;
      vVisualHeight = normalizeVisualHeight(aElevation, uReliefLow, uReliefHigh, uReliefPeak, uReliefPeakStart);
    }`;
  const FRAGMENT_SHADER = `#version 300 es
    precision highp float;
    in vec3 vNormal;
    in vec3 vSphereNormal;
    in vec3 vTangentU;
    in vec3 vTangentV;
    in vec2 vUv;
    in float vElevation;
    in float vVisualHeight;
    uniform sampler2D uAlbedoTexture;
    uniform sampler2D uHeightTexture;
    uniform sampler2D uLandMaskTexture;
    uniform sampler2D uCoastSdfTexture;
    uniform sampler2D uDetailTexture;
    uniform sampler2D uTerrainStructureTexture;
    uniform vec2 uHeightTexelSize;
    uniform vec2 uFacetGrid;
    uniform vec3 uLightDirection;
    uniform float uMacroLod;
    uniform float uMacroStepTexels;
    uniform float uHillLod;
    uniform float uHillStepTexels;
    uniform float uFacetLod;
    uniform float uFacetStepTexels;
    uniform float uStructureLod;
    uniform float uPlainNormalStrength;
    uniform float uHillNormalMix;
    uniform float uSlopeScale;
    uniform float uPlainSlopeLow;
    uniform float uPlainSlopeHigh;
    uniform float uHillHeightLow;
    uniform float uHillHeightHigh;
    uniform float uMountainHeightLow;
    uniform float uMountainHeightHigh;
    uniform float uMountainSlopeLow;
    uniform float uMountainSlopeHigh;
    uniform float uMountainMaskLow;
    uniform float uMountainMaskHigh;
    uniform float uRuggednessLow;
    uniform float uRuggednessHigh;
    uniform float uSummitHeightLow;
    uniform float uSummitHeightHigh;
    uniform float uRockExposure;
    uniform float uRidgeMaterialMix;
    uniform float uValleyMaterialMix;
    uniform float uShadowStrength;
    uniform float uHighlightStrength;
    uniform float uCoastBandStrength;
    uniform float uWaterDiffuseAmbient;
    uniform float uWaterDiffuse;
    uniform float uWaterSpecularPower;
    uniform float uWaterFresnelPower;
    uniform float uReliefScale;
    uniform float uReliefShapeLinear;
    uniform float uReliefShapeExponent;
    uniform float uReliefCompressionStart;
    uniform float uMidReliefStrength;
    uniform float uFacetMix;
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
    uniform float uReliefLow;
    uniform float uReliefHigh;
    uniform float uReliefPeak;
    uniform float uReliefPeakStart;
    uniform float uContourInterval;
    uniform float uMajorInterval;
    uniform float uContourOpacity;
    uniform float uMajorOpacity;
    uniform highp float uAtmospherePass;
    uniform vec3 uAtmosphereColor;
    uniform float uAtmosphereAlpha;
    uniform float uAtmospherePower;
    out vec4 outColor;
    ${Projection.shaderVisualHeight}
    float decodeHeight(vec2 rg) {
      return dot(rg, vec2(65280.0, 255.0)) / 65535.0;
    }
    float sampleLandHeight(vec2 uv, float lod) {
      float elevation = decodeHeight(textureLod(uHeightTexture, uv, lod).rg) * 255.0;
      return normalizeVisualHeight(elevation, uReliefLow, uReliefHigh, uReliefPeak, uReliefPeakStart);
    }
    float shapeReliefHeight(float h) {
      h = clamp(h, 0.0, 1.0);
      float mountainCurve = clamp((h - uReliefCompressionStart) / max(0.001, 1.0 - uReliefCompressionStart), 0.0, 1.0);
      mountainCurve = mountainCurve * mountainCurve * (2.0 - mountainCurve);
      return uReliefShapeLinear * h + (1.0 - uReliefShapeLinear) * pow(mountainCurve, uReliefShapeExponent);
    }
    float sampleShapedLandHeight(vec2 uv, float lod) {
      return shapeReliefHeight(sampleLandHeight(uv, lod));
    }
    void main() {
      if (uAtmospherePass > 0.5) {
        float facing = dot(normalize(vNormal), vec3(0.0, 0.0, 1.0));
        if (facing <= 0.0) discard;
        float fresnel = pow(clamp(1.0 - facing, 0.0, 1.0), uAtmospherePower);
        outColor = vec4(uAtmosphereColor, fresnel * uAtmosphereAlpha * uOpacity);
        return;
      }

      vec3 lightDirection = normalize(uLightDirection);
      float latitude = (0.5 - vUv.y) * 3.14159265359;
      vec3 baseNormal = normalize(vSphereNormal);
      vec3 tangentU = normalize(vTangentU - baseNormal * dot(vTangentU, baseNormal));
      vec3 tangentV = normalize(vTangentV - baseNormal * dot(vTangentV, baseNormal));
      float lonMetric = max(0.18, cos(latitude));
      vec2 macroStep = uHeightTexelSize * uMacroStepTexels;
      float macroLeft = sampleShapedLandHeight(vUv - vec2(macroStep.x, 0.0), uMacroLod);
      float macroRight = sampleShapedLandHeight(vUv + vec2(macroStep.x, 0.0), uMacroLod);
      float macroNorth = sampleShapedLandHeight(vUv - vec2(0.0, macroStep.y), uMacroLod);
      float macroSouth = sampleShapedLandHeight(vUv + vec2(0.0, macroStep.y), uMacroLod);
      float macroDx = (macroRight - macroLeft) / max(0.0001, 12.5663706 * macroStep.x * lonMetric) * uReliefScale;
      float macroDy = (macroSouth - macroNorth) / max(0.0001, 6.2831853 * macroStep.y) * uReliefScale;
      vec3 macroTerrainNormal = normalize(baseNormal - tangentU * macroDx * uMidReliefStrength -
        tangentV * macroDy * uMidReliefStrength);

      vec2 hillStep = uHeightTexelSize * uHillStepTexels;
      float hillLeft = sampleShapedLandHeight(vUv - vec2(hillStep.x, 0.0), uHillLod);
      float hillRight = sampleShapedLandHeight(vUv + vec2(hillStep.x, 0.0), uHillLod);
      float hillNorth = sampleShapedLandHeight(vUv - vec2(0.0, hillStep.y), uHillLod);
      float hillSouth = sampleShapedLandHeight(vUv + vec2(0.0, hillStep.y), uHillLod);
      float hillDx = (hillRight - hillLeft) / max(0.0001, 12.5663706 * hillStep.x * lonMetric) * uReliefScale;
      float hillDy = (hillSouth - hillNorth) / max(0.0001, 6.2831853 * hillStep.y) * uReliefScale;
      vec3 hillHeightNormal = normalize(baseNormal - tangentU * hillDx * uMidReliefStrength -
        tangentV * hillDy * uMidReliefStrength);
      float slope = clamp(length(vec2(hillDx, hillDy)) * uSlopeScale, 0.0, 1.0);

      // Low-pass sampling plus a coarse spatial step makes mountain facets broad;
      // no full-resolution height derivatives enter the land shading.
      vec2 facetStep = max(uHeightTexelSize * uFacetStepTexels, 1.0 / uFacetGrid);
      float facetLeft = sampleShapedLandHeight(vUv - vec2(facetStep.x, 0.0), uFacetLod);
      float facetRight = sampleShapedLandHeight(vUv + vec2(facetStep.x, 0.0), uFacetLod);
      float facetNorth = sampleShapedLandHeight(vUv - vec2(0.0, facetStep.y), uFacetLod);
      float facetSouth = sampleShapedLandHeight(vUv + vec2(0.0, facetStep.y), uFacetLod);
      float fdHx = (facetRight - facetLeft) / max(0.0001, 12.5663706 * facetStep.x * lonMetric) * uReliefScale;
      float fdHy = (facetSouth - facetNorth) / max(0.0001, 6.2831853 * facetStep.y) * uReliefScale;
      vec3 facetNormal = normalize(baseNormal - tangentU * fdHx * uMidReliefStrength - tangentV * fdHy * uMidReliefStrength);

      float height = clamp(vVisualHeight, 0.0, 1.0);
      float landCoverage = texture(uLandMaskTexture, vUv).r;
      vec4 terrainStructure = texture(uTerrainStructureTexture, vUv);
      vec4 broadStructure = textureLod(uTerrainStructureTexture, vUv, uStructureLod);
      float mountainMask = max(terrainStructure.r, broadStructure.r) * landCoverage;
      float ridgeStrength = max(terrainStructure.g, broadStructure.g);
      float valleyStrength = mix(terrainStructure.b, broadStructure.b, .45);
      float ruggedness = max(terrainStructure.a, broadStructure.a);
      float plainMask = 1.0 - smoothstep(uPlainSlopeLow, uPlainSlopeHigh, slope);
      float mountainSlope = smoothstep(uMountainSlopeLow, uMountainSlopeHigh, slope);
      float mountainInfluence = max(mountainMask, ruggedness * mountainSlope) * landCoverage;
      float reliefStrength = mix(.05, .58, mountainInfluence);
      reliefStrength *= mix(.72, 1.0, 1.0 - plainMask);
      float facetMask = mountainMask * ruggedness
        * smoothstep(.14, .34, slope)
        * smoothstep(.28, .68, height);
      float rockExposure = mountainInfluence * smoothstep(.14, .30, slope);
      float mountainMaskVisual = mountainInfluence;

      // Keep the broad height signal almost invisible across the plains. The
      // visual mask only releases stronger hill normals inside rugged uplifts.
      vec3 plainNormal = normalize(mix(baseNormal, macroTerrainNormal, uPlainNormalStrength));
      vec3 hillNormal = normalize(mix(plainNormal, hillHeightNormal, reliefStrength));
      vec3 finalNormal = normalize(mix(hillNormal, facetNormal, facetMask * uFacetMix));

      float coastSdf = texture(uCoastSdfTexture, vUv).r * 2.0 - 1.0;
      float coastWidth = max(uCoastWidth, fwidth(coastSdf) * 1.15);
      float coastBlend = smoothstep(-coastWidth, coastWidth, coastSdf);
      float land = mix(landCoverage, coastBlend, 0.35);
      float shoreBand = 1.0 - smoothstep(coastWidth * 0.20, coastWidth * .82, abs(coastSdf));
      vec3 base = texture(uAlbedoTexture, vUv).rgb;
      base = mix(base, uCoastColor, shoreBand * uCoastBandStrength);

      vec3 landMaterial = mix(base, uRockColor, rockExposure * uRockExposure);
      float baseLuma = dot(base, vec3(.2126, .7152, .0722));
      float baseChroma = max(max(base.r, base.g), base.b) - min(min(base.r, base.g), base.b);
      float snowMask = smoothstep(.65, .84, baseLuma) * (1.0 - smoothstep(.08, .24, baseChroma));
      landMaterial = mix(landMaterial, base, snowMask);
      landMaterial = mix(landMaterial, uRidgeColor,
        ridgeStrength * uRidgeMaterialMix);
      landMaterial = mix(landMaterial, uCreviceColor,
        valleyStrength * uValleyMaterialMix);

      float ndl = dot(finalNormal, lightDirection);
      float shadow = smoothstep(-.30, .10, ndl);
      float light = smoothstep(.15, .65, ndl);
      vec3 shadowFactor = mix(vec3(.86, .89, .88), vec3(.55, .65, .73), mountainMaskVisual);
      vec3 highlightFactor = mix(vec3(1.025), vec3(1.18, 1.12, 1.02), mountainMaskVisual);
      vec3 shadowColor = landMaterial * shadowFactor;
      vec3 highlightColor = landMaterial * highlightFactor;
      float shadowMix = mix(.10, uShadowStrength, mountainMaskVisual);
      float highlightMix = mix(.06, uHighlightStrength, mountainMaskVisual);
      vec3 landColor = mix(landMaterial, shadowColor, (1.0 - shadow) * shadowMix);
      landColor = mix(landColor, highlightColor, light * highlightMix);
      float ao = 1.0 - slope * uAoStrength * land * mountainInfluence;
      float ridgeLight = ridgeStrength * mountainMaskVisual * max(ndl, 0.0) * uRidgeAccentStrength;
      landColor *= ao * (1.0 + ridgeLight);

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
      float waterDiffuse = uWaterDiffuseAmbient + max(dot(waterNormal, lightDirection), 0.0) * uWaterDiffuse;
      waterColor *= waterDiffuse;
      vec3 viewDirection = vec3(0.0, 0.0, 1.0);
      vec3 halfVector = normalize(lightDirection + viewDirection);
      float oceanSpecular = pow(max(dot(waterNormal, halfVector), 0.0), uWaterSpecularPower) * uWaterSpecularStrength;
      float oceanFresnel = pow(1.0 - max(dot(viewDirection, waterNormal), 0.0), uWaterFresnelPower) * uWaterFresnelStrength;
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

  // Two independent fragment programs prevent mobile drivers from compiling a
  // giant branch containing both the legacy height derivatives and the new pass.
  const LEGACY_FRAGMENT_SHADER = FRAGMENT_SHADER;
  const STYLIZED_FRAGMENT_SHADER = FRAGMENT_SHADER.slice(0, FRAGMENT_SHADER.indexOf('    void main() {')) + root.OrbitPlanetTerrainStylizedShader + `
    void main() {
      if (uAtmospherePass > 0.5) {
        if (uTerrainView > 0) { outColor = vec4(0.0); return; }
        float facing = dot(normalize(vNormal), vec3(0.0, 0.0, 1.0));
        if (facing <= 0.0) discard;
        float fresnel = pow(clamp(1.0 - facing, 0.0, 1.0), uAtmospherePower);
        // Fade the shell's outer silhouette to avoid a hard transparent sleeve.
        float outerFade = smoothstep(0.0, .18, facing);
        outColor = vec4(uAtmosphereColor, fresnel * outerFade * uAtmosphereAlpha * uOpacity);
        return;
      }
      drawStylizedTerrain();
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
    let gl = null, program = null, legacyProgram = null, stylizedProgram = null;
    let buffers = null, currentMesh = null, lastDrawn = null;
    let currentTextureWidth = SurfaceTexture.defaults.width;
    let maxTextureSize = 2048;
    const normalRotation = new Float32Array(9);
    let currentStyle = Style;
    let width = 1, height = 1, dpr = 1, lost = false, failure = '';
    const meshCache = new WeakMap();
    try {
      gl = canvas.getContext('webgl2', { alpha: true, antialias: true, depth: true,
        premultipliedAlpha: true, powerPreference: 'high-performance' });
      if (!gl) failure = 'WebGL2 unavailable';
      else initialize();
    } catch (error) { failure = error?.message || 'WebGL2 unavailable'; }

    function makeProgram(fragmentSource) {
      const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL program link failed');
      program.attributes = { position: 0, normal: 1, uv: 2, elevation: 3 };
      program.uniforms = { yaw: gl.getUniformLocation(program, 'uYaw'), pitch: gl.getUniformLocation(program, 'uPitch'),
        visualClassTexture: gl.getUniformLocation(program, 'uTerrainVisualClassTexture'),
        stylizedNormalTexture: gl.getUniformLocation(program, 'uStylizedNormalTexture'),
        realMountainNormalTexture: gl.getUniformLocation(program, 'uRealMountainNormalTexture'),
        stylizedMaterialTexture: gl.getUniformLocation(program, 'uStylizedMaterialTexture'),
        smallMassifTexture: gl.getUniformLocation(program, 'uSmallMassifTexture'),
        plainFacetNormalTexture: gl.getUniformLocation(program, 'uPlainFacetNormalTexture'),
        terrainFacetCandidatesTexture: gl.getUniformLocation(program, 'uTerrainFacetCandidatesTexture'),
        terrainFacetSitesTexture: gl.getUniformLocation(program, 'uTerrainFacetSitesTexture'),
        terrainFacetScale: gl.getUniformLocation(program, 'uTerrainFacetScale'),
        globeRotation: gl.getUniformLocation(program, 'uGlobeRotation'),
        terrainView: gl.getUniformLocation(program, 'uTerrainView'),
        visualClimate: gl.getUniformLocation(program, 'uVisualClimate'),
        terrainShadowStrength: gl.getUniformLocation(program, 'uTerrainShadowStrength'),
        terrainShadowReach: gl.getUniformLocation(program, 'uTerrainShadowReach'),
        rollingLightingContrast: gl.getUniformLocation(program, 'uRollingLightingContrast'),
        sphereLightCancellation: gl.getUniformLocation(program, 'uSphereLightCancellation'),
        mountainShadowFloor: gl.getUniformLocation(program, 'uMountainShadowFloor'),
        coastAaMinimum: gl.getUniformLocation(program, 'uCoastAaMinimum'),
        shallowBandWidth: gl.getUniformLocation(program, 'uShallowBandWidth'),
        sandBandWidth: gl.getUniformLocation(program, 'uSandBandWidth'),
        plainFacetStrength: gl.getUniformLocation(program, 'uPlainFacetStrength'),
        innerRimColor: gl.getUniformLocation(program, 'uInnerRimColor'),
        innerRimEdgeStrength: gl.getUniformLocation(program, 'uInnerRimEdgeStrength'),
        innerRimInwardStrength: gl.getUniformLocation(program, 'uInnerRimInwardStrength'),
        innerRimEdgeFalloff: gl.getUniformLocation(program, 'uInnerRimEdgeFalloff'),
        innerRimInwardFalloff: gl.getUniformLocation(program, 'uInnerRimInwardFalloff'),
        scale: gl.getUniformLocation(program, 'uScale'), offset: gl.getUniformLocation(program, 'uOffset'),
        opacity: gl.getUniformLocation(program, 'uOpacity'), seaLevel: gl.getUniformLocation(program, 'uSeaLevel'),
        reliefLow: gl.getUniformLocation(program, 'uReliefLow'), reliefHigh: gl.getUniformLocation(program, 'uReliefHigh'),
        reliefPeak: gl.getUniformLocation(program, 'uReliefPeak'), reliefPeakStart: gl.getUniformLocation(program, 'uReliefPeakStart'),
        polarNormalBlendStart: gl.getUniformLocation(program, 'uPolarNormalBlendStart'),
        polarNormalBlendEnd: gl.getUniformLocation(program, 'uPolarNormalBlendEnd'),
        polarNormalBlendStrength: gl.getUniformLocation(program, 'uPolarNormalBlendStrength'),
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
        terrainStructureTexture: gl.getUniformLocation(program, 'uTerrainStructureTexture'),
        heightTexelSize: gl.getUniformLocation(program, 'uHeightTexelSize'),
        facetGrid: gl.getUniformLocation(program, 'uFacetGrid'),
        lightDirection: gl.getUniformLocation(program, 'uLightDirection'),
        macroLod: gl.getUniformLocation(program, 'uMacroLod'),
        macroStepTexels: gl.getUniformLocation(program, 'uMacroStepTexels'),
        hillLod: gl.getUniformLocation(program, 'uHillLod'),
        hillStepTexels: gl.getUniformLocation(program, 'uHillStepTexels'),
        facetLod: gl.getUniformLocation(program, 'uFacetLod'),
        facetStepTexels: gl.getUniformLocation(program, 'uFacetStepTexels'),
        structureLod: gl.getUniformLocation(program, 'uStructureLod'),
        plainNormalStrength: gl.getUniformLocation(program, 'uPlainNormalStrength'),
        hillNormalMix: gl.getUniformLocation(program, 'uHillNormalMix'),
        slopeScale: gl.getUniformLocation(program, 'uSlopeScale'),
        plainSlopeLow: gl.getUniformLocation(program, 'uPlainSlopeLow'),
        plainSlopeHigh: gl.getUniformLocation(program, 'uPlainSlopeHigh'),
        hillHeightLow: gl.getUniformLocation(program, 'uHillHeightLow'),
        hillHeightHigh: gl.getUniformLocation(program, 'uHillHeightHigh'),
        mountainHeightLow: gl.getUniformLocation(program, 'uMountainHeightLow'),
        mountainHeightHigh: gl.getUniformLocation(program, 'uMountainHeightHigh'),
        mountainSlopeLow: gl.getUniformLocation(program, 'uMountainSlopeLow'),
        mountainSlopeHigh: gl.getUniformLocation(program, 'uMountainSlopeHigh'),
        mountainMaskLow: gl.getUniformLocation(program, 'uMountainMaskLow'),
        mountainMaskHigh: gl.getUniformLocation(program, 'uMountainMaskHigh'),
        ruggednessLow: gl.getUniformLocation(program, 'uRuggednessLow'),
        ruggednessHigh: gl.getUniformLocation(program, 'uRuggednessHigh'),
        summitHeightLow: gl.getUniformLocation(program, 'uSummitHeightLow'),
        summitHeightHigh: gl.getUniformLocation(program, 'uSummitHeightHigh'),
        rockExposure: gl.getUniformLocation(program, 'uRockExposure'),
        ridgeMaterialMix: gl.getUniformLocation(program, 'uRidgeMaterialMix'),
        valleyMaterialMix: gl.getUniformLocation(program, 'uValleyMaterialMix'),
        shadowStrength: gl.getUniformLocation(program, 'uShadowStrength'),
        highlightStrength: gl.getUniformLocation(program, 'uHighlightStrength'),
        coastBandStrength: gl.getUniformLocation(program, 'uCoastBandStrength'),
        waterDiffuseAmbient: gl.getUniformLocation(program, 'uWaterDiffuseAmbient'),
        waterDiffuse: gl.getUniformLocation(program, 'uWaterDiffuse'),
        waterSpecularPower: gl.getUniformLocation(program, 'uWaterSpecularPower'),
        waterFresnelPower: gl.getUniformLocation(program, 'uWaterFresnelPower'),
        reliefScale: gl.getUniformLocation(program, 'uReliefScale'),
        reliefShapeLinear: gl.getUniformLocation(program, 'uReliefShapeLinear'),
        reliefShapeExponent: gl.getUniformLocation(program, 'uReliefShapeExponent'),
        reliefCompressionStart: gl.getUniformLocation(program, 'uReliefCompressionStart'),
        midReliefStrength: gl.getUniformLocation(program, 'uMidReliefStrength'),
        facetMix: gl.getUniformLocation(program, 'uFacetMix'),
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
      return program;
    }

    function initialize() {
      lastDrawn = null;
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
      legacyProgram = null;
      stylizedProgram = makeProgram(STYLIZED_FRAGMENT_SHADER);
      program = stylizedProgram;
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      buffers = null;
      if (currentMesh) upload(currentMesh, currentTextureWidth, currentStyle);
    }

    function upload(mesh, textureWidth, style = Style) {
      if (!gl || lost || !mesh) return;
      lastDrawn = null;
      if (buffers) {
        gl.deleteBuffer(buffers.positions); gl.deleteBuffer(buffers.normals);
        gl.deleteBuffer(buffers.uvs); gl.deleteBuffer(buffers.elevations); gl.deleteBuffer(buffers.indices);
        gl.deleteTexture(buffers.albedoTexture); gl.deleteTexture(buffers.heightTexture);
        gl.deleteTexture(buffers.landMaskTexture); gl.deleteTexture(buffers.coastSdfTexture);
        gl.deleteTexture(buffers.detailTexture); gl.deleteTexture(buffers.terrainStructureTexture);
        gl.deleteTexture(buffers.visualClassTexture); gl.deleteTexture(buffers.stylizedNormalTexture);
        gl.deleteTexture(buffers.realMountainNormalTexture);
        gl.deleteTexture(buffers.smallMassifTexture);
        gl.deleteTexture(buffers.plainFacetNormalTexture);
        gl.deleteTexture(buffers.stylizedMaterialTexture);
        gl.deleteTexture(buffers.terrainFacetCandidatesTexture);
        gl.deleteTexture(buffers.terrainFacetSitesTexture);
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
      const prepared = mesh.terrain.globeRenderAssets;
      const preparedSurface = prepared?.surface;
      const matchingSurface = preparedSurface?.width === textureWidth &&
        preparedSurface?.coastSmoothing === style.stylizedTerrain.coastSmoothing &&
        preparedSurface?.coastFieldBlur === style.stylizedTerrain.coastFieldBlur &&
        JSON.stringify(style.polarCaps) === JSON.stringify(Style.polarCaps);
      const surfaceData = matchingSurface ? preparedSurface : SurfaceTexture.create(mesh.terrain, mesh.planet,
        { width: textureWidth, height: textureWidth / 2, polarCaps: style.polarCaps,
          coastSmoothing: style.stylizedTerrain.coastSmoothing, coastFieldBlur: style.stylizedTerrain.coastFieldBlur,
          cache: !mesh.terrain.debugTuning });
      const visualStyleKey = root.OrbitPlanetTerrainVisuals.styleKey(style);
      const visualData = prepared?.visualStyleKey === visualStyleKey
        ? prepared.visual : root.OrbitPlanetTerrainVisuals.create(mesh.terrain, mesh.planet, style);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      function uploadTexture(unit, internalFormat, format, pixels, mapWidth = surfaceData.width, mapHeight = surfaceData.height,
        type = gl.UNSIGNED_BYTE, nearest = false) {
        const texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR_MIPMAP_LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, mapWidth, mapHeight, 0,
          format, type, pixels);
        if (!nearest) gl.generateMipmap(gl.TEXTURE_2D);
        return texture;
      }
      const albedoTexture = uploadTexture(0, gl.RGBA8, gl.RGBA, surfaceData.albedoPixels);
      const heightTexture = uploadTexture(1, gl.RG8, gl.RG, surfaceData.heightPixels);
      const landMaskTexture = uploadTexture(2, gl.R8, gl.RED, surfaceData.landMaskPixels);
      const coastSdfTexture = uploadTexture(3, gl.R8, gl.RED, surfaceData.coastSdfPixels);
      const detailTexture = uploadTexture(4, gl.RG8, gl.RG, surfaceData.detailPixels);
      const terrainStructureTexture = uploadTexture(5, gl.RGBA8, gl.RGBA, surfaceData.terrainStructurePixels);
      const visualClassTexture = uploadTexture(6, gl.RGBA8, gl.RGBA, visualData.terrainVisualClassPixels,
        visualData.classWidth, visualData.classHeight);
      const stylizedNormalTexture = uploadTexture(7, gl.RGBA8, gl.RGBA, visualData.stylizedNormalPixels, visualData.width, visualData.height);
      const stylizedMaterialTexture = uploadTexture(8, gl.RGBA8, gl.RGBA, visualData.facetMaterialPixels,
        visualData.facetAtlasWidth, visualData.facetAtlasHeight, gl.UNSIGNED_BYTE, true);
      const realMountainNormalTexture = uploadTexture(9, gl.RGBA8, gl.RGBA, visualData.realMountainNormalPixels, visualData.width, visualData.height);
      const smallMassifTexture = uploadTexture(10, gl.RG8, gl.RG, visualData.smallMassifPixels,
        visualData.classWidth, visualData.classHeight);
      const plainFacetNormalTexture = uploadTexture(11, gl.RGBA8, gl.RGBA, visualData.facetNormalPixels,
        visualData.facetAtlasWidth, visualData.facetAtlasHeight, gl.UNSIGNED_BYTE, true);
      // Candidate IDs are a coarse acceleration map only. The shader computes
      // the actual spherical cell boundary, so its edges never follow texels.
      const terrainFacetCandidatesTexture = uploadTexture(12, gl.RGBA16UI, gl.RGBA_INTEGER, visualData.facetCandidatesPixels,
        visualData.facetCandidateWidth, visualData.facetCandidateHeight, gl.UNSIGNED_SHORT, true);
      const terrainFacetSitesTexture = uploadTexture(13, gl.RGBA32F, gl.RGBA, visualData.facetSitePixels,
        visualData.facetAtlasWidth, visualData.facetAtlasHeight, gl.FLOAT, true);
      gl.bindVertexArray(null);
      buffers = { vao, positions, normals, uvs, elevations, indices, albedoTexture, heightTexture,
        landMaskTexture, coastSdfTexture, detailTexture, terrainStructureTexture,
        visualClassTexture, stylizedNormalTexture, stylizedMaterialTexture, realMountainNormalTexture, smallMassifTexture,
        plainFacetNormalTexture, terrainFacetCandidatesTexture, terrainFacetSitesTexture,
        visualMetrics: { proportions: visualData.proportions, rollingRelief: visualData.rollingRelief,
          localRelief: visualData.localRelief, smallMassifs: visualData.smallMassifs,
          visualMountainChains: visualData.visualMountainChains, plainFacets: visualData.plainFacets,
          generationMs: visualData.generationMs },
        visualSand: visualData.sand, visualStyleKey: root.OrbitPlanetTerrainVisuals.styleKey(style), coastRange: surfaceData.coastRange,
        coastColor: surfaceData.coastColor, textureKey: surfaceData.key,
        climate: surfaceData.climate, reliefRange: mesh.reliefRange,
        textureWidth: surfaceData.width, textureHeight: surfaceData.height, count: mesh.indices.length,
        polarStyleKey: JSON.stringify(style.polarCaps),
        coastStyleKey: JSON.stringify([style.stylizedTerrain.coastSmoothing, style.stylizedTerrain.coastFieldBlur]),
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

    function meshFor(terrain, planet, textureWidth, style = Style) {
      const reliefKey = JSON.stringify([style.mesh, style.relief, style.stylizedTerrain.visualChains]);
      const cached = meshCache.get(terrain);
      let mesh = cached?.mesh;
      if (!mesh || cached.planetId !== (planet?.id || null) || cached.reliefKey !== reliefKey) {
        mesh = Mesh.create(terrain, planet, style.mesh, style.relief);
        meshCache.set(terrain, { mesh, planetId: planet?.id || null, reliefKey });
      }
      const polarStyleKey = JSON.stringify(style.polarCaps);
      const coastStyleKey = JSON.stringify([style.stylizedTerrain.coastSmoothing, style.stylizedTerrain.coastFieldBlur]);
      if (currentMesh !== mesh || buffers?.textureWidth !== textureWidth ||
          buffers?.polarStyleKey !== polarStyleKey || buffers?.coastStyleKey !== coastStyleKey ||
          buffers?.visualStyleKey !== root.OrbitPlanetTerrainVisuals.styleKey(style)) {
        currentMesh = mesh; currentTextureWidth = textureWidth; currentStyle = style;
        upload(mesh, textureWidth, style);
      }
      return mesh;
    }

    function textureWidthFor(radiusPx) {
      // Mobile fill-rate and initial CPU texture generation are the bottleneck;
      // 768x384 is still sharp at the standard globe zoom and avoids oversized
      // maps on high-DPR phone screens. Desktop keeps the full 1024x512 map.
      const requested = dpr >= 2.5 || Math.min(width, height) < 640 ? 768 : 1024;
      return Math.min(requested, maxTextureSize);
    }

    function atmosphereRgb(planet, style = Style) {
      const hex = style.atmosphere.colors[planet?.kind] || style.atmosphere.colors.default;
      const value = Number.parseInt(hex.slice(1), 16);
      return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
    }

    function setHexUniform(location, hex) {
      const value = Number.parseInt(hex.slice(1), 16);
      gl.uniform3f(location, ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255, (value & 255) / 255);
    }

    function render({ terrain, planet, view, transition = null, active = true, style = Style }) {
      style = style || Style;
      currentStyle = style;
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
      const radiusPx = Number.isFinite(transform.radiusPx) ? transform.radiusPx : Math.min(width, height) * style.camera.radiusRatio * view.zoom;
      const mesh = meshFor(terrain, planet, textureWidthFor(radiusPx), style);
      const opacity = Number.isFinite(transition?.globeOpacity) ? transition.globeOpacity : 1;
      const terrainView = root.OrbitDeveloperSettings?.get('terrainRenderView') || 'final';
      const terrainRenderer = root.OrbitDeveloperSettings?.get('terrainRenderer') || 'stylized';
      const stylized = terrainRenderer === 'stylized' || terrainView !== 'final';
      if (!stylized && !legacyProgram) legacyProgram = makeProgram(LEGACY_FRAGMENT_SHADER);
      program = stylized ? stylizedProgram : legacyProgram;
      if (lastDrawn && lastDrawn.mesh === mesh && lastDrawn.yaw === view.yaw && lastDrawn.pitch === view.pitch &&
        lastDrawn.centerX === centerX && lastDrawn.centerY === centerY && lastDrawn.radiusPx === radiusPx &&
        lastDrawn.opacity === opacity && lastDrawn.width === width && lastDrawn.height === height &&
        lastDrawn.style === style && lastDrawn.terrainView === terrainView && lastDrawn.terrainRenderer === terrainRenderer) {
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
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, buffers.terrainStructureTexture);
      gl.uniform1i(program.uniforms.terrainStructureTexture, 5);
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, buffers.visualClassTexture);
      gl.uniform1i(program.uniforms.visualClassTexture, 6);
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, buffers.stylizedNormalTexture);
      gl.uniform1i(program.uniforms.stylizedNormalTexture, 7);
      gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, buffers.stylizedMaterialTexture);
      gl.uniform1i(program.uniforms.stylizedMaterialTexture, 8);
      gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, buffers.realMountainNormalTexture);
      gl.uniform1i(program.uniforms.realMountainNormalTexture, 9);
      gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, buffers.smallMassifTexture);
      gl.uniform1i(program.uniforms.smallMassifTexture, 10);
      gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, buffers.plainFacetNormalTexture);
      gl.uniform1i(program.uniforms.plainFacetNormalTexture, 11);
      gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, buffers.terrainFacetCandidatesTexture);
      gl.uniform1i(program.uniforms.terrainFacetCandidatesTexture, 12);
      gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, buffers.terrainFacetSitesTexture);
      gl.uniform1i(program.uniforms.terrainFacetSitesTexture, 13);
      gl.uniform1f(program.uniforms.terrainFacetScale, style.stylizedTerrain.plainFacetScale);
      const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cx = Math.cos(view.pitch), sx = Math.sin(view.pitch);
      normalRotation[0] = cy; normalRotation[1] = sx * sy; normalRotation[2] = -cx * sy;
      normalRotation[3] = 0; normalRotation[4] = cx; normalRotation[5] = sx;
      normalRotation[6] = sy; normalRotation[7] = -sx * cy; normalRotation[8] = cx * cy;
      gl.uniformMatrix3fv(program.uniforms.globeRotation, false, normalRotation);
      gl.uniform1i(program.uniforms.terrainView, Math.max(0, ['final', 'classes', 'facetedNormals', 'shadow', 'material', 'realNormals', 'rolling', 'local', 'smallMassifs'].indexOf(terrainView)));
      gl.uniform1i(program.uniforms.visualClimate, ['temperate', 'frozen', 'arid', 'volcanic'].indexOf(buffers.climate));
      gl.uniform1f(program.uniforms.terrainShadowStrength, style.stylizedTerrain.shadowStrength);
      gl.uniform1f(program.uniforms.terrainShadowReach, style.stylizedTerrain.shadowReach);
      gl.uniform1f(program.uniforms.rollingLightingContrast, style.stylizedTerrain.rollingLightingContrast);
      gl.uniform1f(program.uniforms.sphereLightCancellation, style.stylizedTerrain.sphereLightCancellation);
      gl.uniform1f(program.uniforms.mountainShadowFloor, style.stylizedTerrain.mountainShadowFloor);
      gl.uniform1f(program.uniforms.coastAaMinimum, style.stylizedTerrain.coastAaMinimum);
      gl.uniform1f(program.uniforms.shallowBandWidth, style.stylizedTerrain.shallowBandWidth);
      gl.uniform1f(program.uniforms.sandBandWidth, style.stylizedTerrain.sandBandWidth);
      gl.uniform1f(program.uniforms.plainFacetStrength, style.stylizedTerrain.plainFacetStrength);
      const innerRim = style.atmosphere.innerRim;
      setHexUniform(program.uniforms.innerRimColor, innerRim.color);
      gl.uniform1f(program.uniforms.innerRimEdgeStrength, innerRim.edgeStrength);
      gl.uniform1f(program.uniforms.innerRimInwardStrength, innerRim.inwardStrength);
      gl.uniform1f(program.uniforms.innerRimEdgeFalloff, innerRim.edgeFalloff);
      gl.uniform1f(program.uniforms.innerRimInwardFalloff, innerRim.inwardFalloff);
      gl.uniform2f(program.uniforms.heightTexelSize, 1 / buffers.textureWidth, 1 / buffers.textureHeight);
      const shading = style.terrainShading, controls = shading.controls;
      gl.uniform2f(program.uniforms.facetGrid, shading.facetGrid.x, shading.facetGrid.y);
      const radians = Math.PI / 180;
      gl.uniform1f(program.uniforms.polarNormalBlendStart, controls.polarNormalBlendStartDegrees * radians);
      gl.uniform1f(program.uniforms.polarNormalBlendEnd, controls.polarNormalBlendEndDegrees * radians);
      gl.uniform1f(program.uniforms.polarNormalBlendStrength, controls.polarNormalBlendStrength);
      const lightDirection = stylized ? style.stylizedTerrain.lightDirection : controls.lightDirection;
      gl.uniform3f(program.uniforms.lightDirection, lightDirection.x, lightDirection.y, lightDirection.z);
      gl.uniform1f(program.uniforms.macroLod, controls.macroLod);
      gl.uniform1f(program.uniforms.macroStepTexels, controls.macroStepTexels);
      gl.uniform1f(program.uniforms.hillLod, controls.hillLod);
      gl.uniform1f(program.uniforms.hillStepTexels, controls.hillStepTexels);
      gl.uniform1f(program.uniforms.facetLod, controls.facetLod);
      gl.uniform1f(program.uniforms.facetStepTexels, controls.facetStepTexels);
      gl.uniform1f(program.uniforms.structureLod, controls.structureLod);
      gl.uniform1f(program.uniforms.plainNormalStrength, controls.plainNormalStrength);
      gl.uniform1f(program.uniforms.hillNormalMix, controls.hillNormalMix);
      gl.uniform1f(program.uniforms.slopeScale, controls.slopeScale);
      gl.uniform1f(program.uniforms.plainSlopeLow, controls.plainSlopeLow);
      gl.uniform1f(program.uniforms.plainSlopeHigh, controls.plainSlopeHigh);
      gl.uniform1f(program.uniforms.hillHeightLow, controls.hillHeightLow);
      gl.uniform1f(program.uniforms.hillHeightHigh, controls.hillHeightHigh);
      gl.uniform1f(program.uniforms.mountainHeightLow, controls.mountainHeightLow);
      gl.uniform1f(program.uniforms.mountainHeightHigh, controls.mountainHeightHigh);
      gl.uniform1f(program.uniforms.mountainSlopeLow, controls.mountainSlopeLow);
      gl.uniform1f(program.uniforms.mountainSlopeHigh, controls.mountainSlopeHigh);
      gl.uniform1f(program.uniforms.mountainMaskLow, controls.mountainMaskLow);
      gl.uniform1f(program.uniforms.mountainMaskHigh, controls.mountainMaskHigh);
      gl.uniform1f(program.uniforms.ruggednessLow, controls.ruggednessLow);
      gl.uniform1f(program.uniforms.ruggednessHigh, controls.ruggednessHigh);
      gl.uniform1f(program.uniforms.summitHeightLow, controls.summitHeightLow);
      gl.uniform1f(program.uniforms.summitHeightHigh, controls.summitHeightHigh);
      gl.uniform1f(program.uniforms.rockExposure, controls.rockExposure);
      gl.uniform1f(program.uniforms.ridgeMaterialMix, controls.ridgeMaterialMix);
      gl.uniform1f(program.uniforms.valleyMaterialMix, controls.valleyMaterialMix);
      gl.uniform1f(program.uniforms.shadowStrength, controls.shadowStrength);
      gl.uniform1f(program.uniforms.highlightStrength, controls.highlightStrength);
      gl.uniform1f(program.uniforms.coastBandStrength, controls.coastBandStrength);
      gl.uniform1f(program.uniforms.waterDiffuseAmbient, controls.waterDiffuseAmbient);
      gl.uniform1f(program.uniforms.waterDiffuse, controls.waterDiffuse);
      gl.uniform1f(program.uniforms.waterSpecularPower, style.water.specularPower);
      gl.uniform1f(program.uniforms.waterFresnelPower, style.water.fresnelPower);
      gl.uniform1f(program.uniforms.reliefScale, style.relief.scale);
      gl.uniform1f(program.uniforms.reliefShapeLinear, style.relief.linearFraction);
      gl.uniform1f(program.uniforms.reliefShapeExponent, style.relief.exponent);
      gl.uniform1f(program.uniforms.reliefCompressionStart, style.relief.compressionStart);
      gl.uniform1f(program.uniforms.midReliefStrength, shading.midReliefStrength);
      gl.uniform1f(program.uniforms.facetMix, shading.mountainFacetMix);
      gl.uniform1f(program.uniforms.aoStrength, shading.mountainAoStrength);
      gl.uniform1f(program.uniforms.ridgeAccentStrength, shading.ridgeAccentStrength);
      gl.uniform1f(program.uniforms.coastWidth, .72 / buffers.coastRange);
      gl.uniform1f(program.uniforms.coastRange, buffers.coastRange);
      setHexUniform(program.uniforms.coastColor, stylized ? buffers.visualSand : buffers.coastColor);
      const water = style.water, waterColors = stylized ? style.stylizedTerrain.water : water;
      setHexUniform(program.uniforms.waterShallowColor, waterColors.shallow);
      setHexUniform(program.uniforms.waterMidColor, waterColors.mid);
      setHexUniform(program.uniforms.waterDeepColor, waterColors.deep);
      gl.uniform1f(program.uniforms.waterNoiseAmplitude, water.noiseAmplitude);
      gl.uniform1f(program.uniforms.waterNormalStrength, water.normalStrength);
      gl.uniform1f(program.uniforms.waterSpecularStrength, water.specularStrength);
      gl.uniform1f(program.uniforms.waterFresnelStrength, water.fresnelStrength);
      gl.uniform1f(program.uniforms.waterCoastDepthDistance, water.coastDepthDistance);
      gl.uniform1f(program.uniforms.waterBathymetryDepthScale, water.bathymetryDepthScale);
      gl.uniform1f(program.uniforms.waterBathymetryInfluence, water.bathymetryInfluence);
      const materials = shading.mountainMaterials[buffers.climate] || shading.mountainMaterials.default;
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
      gl.uniform1f(program.uniforms.reliefLow, buffers.reliefRange.low);
      gl.uniform1f(program.uniforms.reliefHigh, buffers.reliefRange.high);
      gl.uniform1f(program.uniforms.reliefPeak, buffers.reliefRange.peak);
      gl.uniform1f(program.uniforms.reliefPeakStart, buffers.reliefRange.peakTailStart);
      gl.uniform1f(program.uniforms.contourInterval, style.topography.contourInterval);
      gl.uniform1f(program.uniforms.majorInterval, style.topography.majorInterval);
      gl.uniform1f(program.uniforms.contourOpacity, style.topography.contourOpacity);
      gl.uniform1f(program.uniforms.majorOpacity, style.topography.majorOpacity);
      gl.drawElements(gl.TRIANGLES, buffers.count, buffers.indexType, 0);
      const atmosphere = style.atmosphere, rgb = atmosphereRgb(planet, style);
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
      lastDrawn = { mesh, yaw: view.yaw, pitch: view.pitch, centerX, centerY, radiusPx, opacity, width, height, style, terrainView, terrainRenderer };
      return { available: true, failure: '', mesh };
    }

    return Object.freeze({ resize, render, available: () => Boolean(gl) && !failure && !lost,
      metrics: () => ({ width, height, dpr, vertices: currentMesh?.vertexCount || 0,
        longitudeSegments: currentMesh?.longitudeSegments || 0,
        latitudeSegments: currentMesh?.latitudeSegments || 0, textureWidth: buffers?.textureWidth || 0,
        textureHeight: buffers?.textureHeight || 0, textureKey: buffers?.textureKey || null,
        midReliefStrength: buffers ? currentStyle.terrainShading.midReliefStrength : 0,
        facetMix: buffers ? currentStyle.terrainShading.mountainFacetMix : 0,
        detailNormalStrength: 0,
        terrainRenderer: root.OrbitDeveloperSettings?.get('terrainRenderer') || 'stylized',
        terrainView: root.OrbitDeveloperSettings?.get('terrainRenderView') || 'final',
        visual: buffers?.visualMetrics || null,
        coastRange: buffers?.coastRange || 0, contextLost: lost, failure }) });
  }

  root.OrbitPlanetGlobeRenderer = Object.freeze({ create });
})(globalThis);
