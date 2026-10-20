(function (root) {
  'use strict';

  // Separate terrestrial pass; the v0.35.12 path stays available for comparison.
  root.OrbitPlanetTerrainStylizedShader = `
    uniform sampler2D uTerrainVisualClassTexture;
    uniform sampler2D uStylizedNormalTexture;
    uniform sampler2D uRealMountainNormalTexture;
    uniform sampler2D uStylizedMaterialTexture;
    uniform sampler2D uSmallMassifTexture;
    uniform sampler2D uPlainFacetNormalTexture;
    uniform int uTerrainView;
    uniform int uVisualClimate;
    uniform mat3 uGlobeRotation;
    uniform float uTerrainShadowStrength;
    uniform float uTerrainShadowReach;
    uniform float uRollingLightingContrast;
    uniform float uSphereLightCancellation;
    uniform float uMountainShadowFloor;
    uniform float uCoastAaMinimum;
    uniform float uShallowBandWidth;
    uniform float uSandBandWidth;
    uniform float uPlainFacetStrength;
    uniform vec3 uInnerRimColor;
    uniform float uInnerRimEdgeStrength;
    uniform float uInnerRimInwardStrength;
    uniform float uInnerRimEdgeFalloff;
    uniform float uInnerRimInwardFalloff;

    ${root.OrbitPlanetGlobeProjection.shaderSphereUv}

    vec3 rotateTerrainNormal(vec3 n) {
      return normalize(uGlobeRotation * n);
    }
    vec3 inverseTerrainNormal(vec3 n) {
      return normalize(transpose(uGlobeRotation) * n);
    }

    float terrainCastShadow(vec3 surfaceDirection, vec3 light, float receiver) {
      float facing = dot(surfaceDirection, light);
      if (receiver < .10 || facing <= .02 || facing > .92) return 0.0;
      vec3 tangentLight = light - surfaceDirection * facing;
      float horizontal = length(tangentLight);
      tangentLight /= max(.001, horizontal);
      float rise = facing / max(.12, horizontal);
      float ground = sampleShapedLandHeight(vUv, 2.5) * uReliefScale;
      float obstruction = 0.0;
      float softObstruction = 0.0;
      // Look toward the light; the resulting shadows fall on its opposite side.
      // Geodesic samples keep the shadow stable at the poles and UV seam.
      for (int i = 1; i <= 8; i++) {
        float angle = uTerrainShadowReach * float(i) / 8.0;
        vec3 neighbor = surfaceDirection * cos(angle) + tangentLight * sin(angle);
        vec2 uv = globeDirectionUv(neighbor);
        float neighborHeight = sampleShapedLandHeight(uv, 3.0) * uReliefScale;
        float horizon = neighborHeight - ground - sin(angle) * rise * .20;
        float shade = smoothstep(.0003, .0022, horizon);
        obstruction = max(obstruction, shade);
        softObstruction += shade;
      }
      return (obstruction * .65 + softObstruction * (.35 / 8.0)) * receiver;
    }

    void drawStylizedTerrain() {
      vec3 sphereNormal = normalize(vSphereNormal);
      vec3 objectDirection = inverseTerrainNormal(sphereNormal);
      vec3 lightDirection = normalize(uLightDirection);
      vec4 classes = texture(uTerrainVisualClassTexture, vUv);
      classes /= max(.001, dot(classes, vec4(1.0)));
      vec4 normalSample = texture(uStylizedNormalTexture, vUv);
      vec3 stylizedNormal = rotateTerrainNormal(normalize(normalSample.rgb * 2.0 - 1.0));
      vec4 realNormalSample = texture(uRealMountainNormalTexture, vUv);
      vec3 realMountainNormal = rotateTerrainNormal(normalize(realNormalSample.rgb * 2.0 - 1.0));
      vec4 material = texture(uStylizedMaterialTexture, vUv);
      float mountain = clamp(classes.b + classes.a, 0.0, 1.0);
      float smallMassif = texture(uSmallMassifTexture, vUv).r;
      float raisedTerrain = clamp(mountain + classes.g * .34 + smallMassif * .24, 0.0, 1.0);
      float castShadow = uTerrainView == 0 || uTerrainView == 3
        ? terrainCastShadow(objectDirection, inverseTerrainNormal(lightDirection), raisedTerrain) : 0.0;
      vec4 structure = texture(uTerrainStructureTexture, vUv);
      float ridge = structure.g;
      float valley = structure.b;

      float coastDistance = (texture(uCoastSdfTexture, vUv).r * 2.0 - 1.0) * uCoastRange;
      float aa = clamp(fwidth(coastDistance) * .60, uCoastAaMinimum, max(.45, uCoastAaMinimum));
      float land = smoothstep(-aa, aa, coastDistance);
      float sandBand = land * (1.0 - smoothstep(uSandBandWidth, uSandBandWidth + aa, max(0.0, coastDistance)));
      sandBand *= 1.0 - material.a;
      material.rgb = mix(material.rgb, uCoastColor, sandBand * .94);
      float lavaMask = 0.0;
      if (uVisualClimate == 3) {
        // Preserve the existing procedural lava material in volcanic basins.
        vec3 lava = texture(uAlbedoTexture, vUv).rgb;
        lavaMask = smoothstep(.18, .34, lava.r - lava.g) * smoothstep(.25, .50, lava.r);
        material.rgb = mix(material.rgb, lava, max(1.0 - land, lavaMask));
      }

      // Suppress part of the globe's broad illumination only in the massifs:
      // the ramp reads their face orientation instead of lighting every slope
      // at once just because the whole hemisphere is facing the sun.
      float mountainInfluence = smoothstep(.03, .60, mountain + ridge * .08);
      vec4 plainFacetSample = texture(uPlainFacetNormalTexture, vUv);
      vec3 plainFacetNormal = rotateTerrainNormal(normalize(plainFacetSample.rgb * 2.0 - 1.0));
      float plainRegion = clamp(classes.r + classes.g * .92 + smallMassif * .30, 0.0, 1.0);
      float plainFacetCoverage = land * (1.0 - mountainInfluence) * plainRegion;
      float plainFacetMix = clamp(plainFacetCoverage * uPlainFacetStrength, 0.0, .78);
      stylizedNormal = normalize(mix(stylizedNormal, plainFacetNormal, plainFacetMix));
      float rollingActivity = normalSample.a;
      float plainFacetActivity = (1.0 - mountainInfluence) *
        smoothstep(.004, .11, length(stylizedNormal - sphereNormal));
      float terrainActivity = clamp(rollingActivity * .55 + classes.g * .35 + smallMassif * .28 +
        plainFacetActivity * .52 + mountain, 0.0, 1.0);
      // Cell normals are intentionally visible across the lowlands. Their
      // broad lighting range creates watercolor-like planes even where the
      // source terrain is nearly level; relief-derived normals still shape
      // each face instead of a UV grid.
      float secondaryActivity = clamp((terrainActivity - mountain) * uRollingLightingContrast +
        plainFacetCoverage * .72, 0.0, 1.0);
      float ndl = dot(stylizedNormal, lightDirection) -
        dot(sphereNormal, lightDirection) * mountain * uSphereLightCancellation;
      float shadow = smoothstep(-.22, .14, ndl);
      float highlight = smoothstep(.28, .66, ndl);
      float darkTone = mix(mix(.95, .84, secondaryActivity), .72, mountainInfluence);
      float brightTone = mix(mix(1.04, 1.13, secondaryActivity), 1.17, mountainInfluence);
      brightTone = mix(brightTone, min(brightTone, 1.04), material.a);
      float lighting = mix(darkTone, 1.0, shadow);
      lighting = mix(lighting, brightTone, highlight);
      // A projected shadow cannot multiply a dark face all the way to black.
      float castFactor = max(uMountainShadowFloor, 1.0 - castShadow * uTerrainShadowStrength);
      lighting *= castFactor;
      lighting *= 1.0 + ridge * mountainInfluence * highlight * .045;
      vec3 mountainShadowTint = uVisualClimate == 0 ? vec3(.88, .91, .82) : vec3(.88, .91, .94);
      vec3 shadowTint = mix(vec3(1.0), mountainShadowTint, mountainInfluence);
      shadowTint = mix(shadowTint, vec3(.84, .91, .98), material.a);
      vec3 lightTint = uVisualClimate == 0 ? vec3(1.06, 1.025, .96) : vec3(1.04, 1.035, 1.02);
      lightTint = mix(lightTint, vec3(.99, 1.0, 1.015), material.a);
      vec3 tint = mix(shadowTint, vec3(1.0), shadow);
      tint = mix(tint, lightTint, highlight * mountainInfluence);
      vec3 landColor = material.rgb * lighting * tint;
      landColor = mix(landColor, material.rgb, lavaMask * .25);
      // Valley metadata only deepens the actual mountain troughs; the mask is
      // absent from ordinary plains, so it cannot draw global dark stripes.
      float valleyDarkening = valley * mountainInfluence * smoothstep(.15, .50, ridge + mountain) * .10;
      landColor = mix(landColor, landColor * vec3(.82, .87, .78), valleyDarkening);

      // Two finite bands: a narrow turquoise shoal and a separate sand strip.
      // The broad ocean gradient never adds light to the edge of the continent.
      float distanceToLand = max(0.0, -coastDistance);
      float shallowWaterBand = (1.0 - land) * (1.0 - smoothstep(.10, uShallowBandWidth + aa, distanceToLand));
      float depth = smoothstep(1.5, 14.0, distanceToLand);
      vec3 waterMaterial = mix(uWaterMidColor, uWaterDeepColor, depth);
      waterMaterial = mix(waterMaterial, uWaterShallowColor, shallowWaterBand * .85);
      float oceanNoise = clamp((texture(uDetailTexture, vUv).r - .5) * 20.0, -1.0, 1.0);
      vec3 waterColor = waterMaterial * (1.0 + oceanNoise * uWaterNoiseAmplitude);
      float oceanLight = .93 + max(dot(sphereNormal, lightDirection), 0.0) * .07;
      waterColor *= oceanLight;
      vec3 halfVector = normalize(lightDirection + vec3(0.0, 0.0, 1.0));
      float specular = pow(max(dot(sphereNormal, halfVector), 0.0), uWaterSpecularPower) * uWaterSpecularStrength;
      float fresnel = pow(1.0 - max(sphereNormal.z, 0.0), uWaterFresnelPower) * uWaterFresnelStrength;
      waterColor += specular * vec3(.64, .84, 1.0) + fresnel * vec3(.10, .26, .38);
      float ocean = (1.0 - land) * uHasLiquidOcean * (1.0 - material.a);
      vec3 color = mix(landColor, waterColor, ocean);

      if (uTerrainView == 1) {
        color = classes.r * vec3(.22, .65, .30) + classes.g * vec3(.77, .76, .23) +
          classes.b * vec3(.87, .33, .12) + classes.a * vec3(.93, .95, .99);
        color = mix(vec3(.025, .065, .10), color, land);
      } else if (uTerrainView == 2) {
        color = stylizedNormal * .5 + .5;
      } else if (uTerrainView == 3) {
        color = mix(vec3(.025, .065, .10), vec3(castFactor), land);
      } else if (uTerrainView == 4) {
        color = mix(material.rgb, waterMaterial, ocean);
      } else if (uTerrainView == 5) {
        color = realMountainNormal * .5 + .5;
      } else if (uTerrainView == 6) {
        float rolling = pow(normalSample.a, .72);
        color = vec3(rolling, rolling * .76, rolling * .34) * land;
      } else if (uTerrainView == 7) {
        float localRelief = clamp((realNormalSample.a * 255.0 - 128.0) / 127.0, -1.0, 1.0);
        vec3 localTint = localRelief >= 0.0 ? vec3(1.0, .73, .29) : vec3(.29, .65, 1.0);
        color = localTint * abs(localRelief) * land;
      } else if (uTerrainView == 8) {
        color = vec3(.48, .79, .32) * pow(smallMassif, .8) * land;
      }
      if (uTerrainView == 0) {
        // A narrow cyan edge sits inside the silhouette, then fades softly
        // across the outer terrain and ocean without adding a broad veil.
        float limbFacing = max(0.0, sphereNormal.z);
        float crispEdge = exp(-limbFacing * uInnerRimEdgeFalloff);
        float inwardFade = exp(-limbFacing * uInnerRimInwardFalloff);
        float innerRim = clamp(crispEdge * uInnerRimEdgeStrength +
          inwardFade * uInnerRimInwardStrength, 0.0, .42);
        color = mix(color, uInnerRimColor, innerRim);
      }
      outColor = vec4(clamp(color, 0.0, 1.0), uOpacity);
    }
  `;
})(globalThis);
