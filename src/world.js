(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const GALAXY_RADIUS = 5200;

  function hashSeed(value) {
    const text = String(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    return hash >>> 0;
  }

  function rng(seed) {
    let state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    return function random() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(random) {
    return Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) * Math.cos(TAU * random());
  }

  function clamp(value, lower, upper) {
    return Math.min(upper, Math.max(lower, value));
  }

  function weightedCount(random, weights) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let value = random() * total;
    for (let count = 0; count < weights.length; count += 1) {
      value -= weights[count];
      if (value < 0) return count;
    }
    return Math.max(0, weights.length - 1);
  }

  const STAR_CLASSES = root.OrbitWorldgenData.stars;
  const NAME_STARTS = ['Al', 'Er', 'Ves', 'Cor', 'Is', 'Tau', 'Hel', 'Ori', 'Cal', 'Mer', 'Sol', 'Vir', 'Nae', 'Eri', 'Ant', 'Aster', 'Lyr', 'Cass', 'Thal', 'Nox'];
  const NAME_ENDS = ['ara', 'ion', 'éa', 'aris', 'ora', 'is', 'ède', 'arae', 'ène', 'os', 'ys', 'onia', 'ius', 'ande', 'ine', 'ea'];

  function starClass(random) {
    const value = random();
    let limit = 0;
    for (const entry of STAR_CLASSES) {
      limit += entry.weight;
      if (value <= limit) return entry;
    }
    return STAR_CLASSES[0];
  }

  function systemName(seed, id) {
    if (id === 'home') return 'Néréide';
    const random = rng(hashSeed(String(seed) + ':name:' + id));
    return NAME_STARTS[Math.floor(random() * NAME_STARTS.length)] +
      NAME_ENDS[Math.floor(random() * NAME_ENDS.length)] + ' ' +
      (10 + Math.floor(random() * 890));
  }

  function createGalaxy(seed) {
    const random = rng(hashSeed(String(seed) + ':galaxy'));
    const systems = [];
    const rotation = -0.50 + (random() - 0.5) * 0.7;
    const winding = 1.44 + random() * 0.18;
    const spiralOffset = rotation - winding * Math.log(1 + 640 / 600);
    function addSystem(x, y, arm) {
      const id = 's-' + systems.length;
      const star = starClass(random);
      systems.push({
        id, name: systemName(seed, id), x, y, arm,
        stellarClass: star.type, color: star.color,
        size: star.size * (0.8 + random() * 0.4), discovered: false
      });
    }

    // The cross-section changes continuously along each arm. Stars scatter in
    // both dimensions, avoiding a uniform ribbon or a chain of large nodes.
    for (let arm = 0; arm < 4; arm += 1) {
      const phase = spiralOffset + arm * TAU / 4;
      const armVariation = random() * TAU;
      for (let i = 0; i < 560; i += 1) {
        const distance = 560 + Math.pow(random(), 0.87) * 4400;
        const patch = 0.70 + 0.24 * Math.sin(distance / 570 + armVariation) +
          0.18 * Math.sin(distance / 260 - armVariation);
        const width = (80 + distance * 0.055) * patch;
        const lateral = gaussian(random) * width;
        const radial = gaussian(random) * width * 0.56;
        const radius = clamp(distance + radial, 350, GALAXY_RADIUS - 70);
        const angle = phase + winding * Math.log(1 + distance / 600) +
          lateral / Math.max(distance, 400) +
          0.055 * Math.sin(distance / 850 + armVariation);
        addSystem(Math.cos(angle) * radius, Math.sin(angle) * radius, arm);
      }
    }

    // A compact, slightly barred nucleus joins all four arms.
    for (let i = 0; i < 320; i += 1) {
      const x = clamp(gaussian(random) * 420, -1040, 1040);
      const y = clamp(gaussian(random) * 235, -760, 760);
      addSystem(x * Math.cos(rotation) - y * Math.sin(rotation),
        x * Math.sin(rotation) + y * Math.cos(rotation), -1);
    }

    // The start location lives inside an arm, away from the crowded nucleus.
    let home = systems[0];
    let score = Infinity;
    for (const system of systems) {
      if (system.arm !== 0) continue;
      const current = Math.abs(Math.hypot(system.x, system.y) - 3340);
      if (current < score) { score = current; home = system; }
    }
    home.name = 'Néréide';
    home.stellarClass = 'G';
    home.color = '#e5dec1';
    home.size = 1;
    for (const system of systems) {
      system.discovered = Math.hypot(system.x - home.x, system.y - home.y) < 460;
    }
    return { seed, radius: GALAXY_RADIUS, systems, homeId: home.id };
  }

  function createSystem(seed, systemId, existingGalaxy, settings) {
    return root.OrbitSystemGeneration.create(seed, systemId, existingGalaxy || createGalaxy(seed), settings);
  }

  function planetPosition(planet, time) {
    const angle = planet.phase + planet.speed * time;
    return { x: Math.cos(angle) * planet.orbit, y: Math.sin(angle) * planet.orbit };
  }

  function directionForPixel(x, y, width, height, output = {}) {
    const pixelX = clamp(x, 0, width - 1), pixelY = clamp(y, 0, height - 1);
    const longitude = pixelX === width - 1 && width > 1 ? -Math.PI :
      (pixelX / Math.max(1, width - 1) - .5) * TAU;
    const northPole = pixelY === 0;
    const southPole = pixelY === height - 1 && !northPole;
    const latitude = northPole ? Math.PI / 2 : southPole ? -Math.PI / 2 :
      (.5 - pixelY / Math.max(1, height - 1)) * Math.PI;
    if (northPole || southPole) {
      output.x = 0; output.y = northPole ? 1 : -1; output.z = 0;
      return output;
    }
    const cosLatitude = Math.cos(latitude);
    output.x = cosLatitude * Math.cos(longitude);
    output.y = Math.sin(latitude);
    output.z = cosLatitude * Math.sin(longitude);
    return output;
  }

  const noiseKernels = new Map();

  function noiseKernel(seed) {
    const key = seed >>> 0;
    if (noiseKernels.has(key)) return noiseKernels.get(key);
    const random = rng(key);
    const y = random() * 2 - 1, longitude = random() * TAU;
    const horizontal = Math.sqrt(1 - y * y), frequency = .78 + random() * .68;
    const kernel = Object.freeze({
      x: Math.cos(longitude) * horizontal * frequency,
      y: y * frequency,
      z: Math.sin(longitude) * horizontal * frequency,
      phase: random() * TAU
    });
    noiseKernels.set(key, kernel);
    if (noiseKernels.size > 128) noiseKernels.delete(noiseKernels.keys().next().value);
    return kernel;
  }

  function fbm3Sampler(seed, octaves) {
    const waves = new Array(octaves);
    let amplitude = 1, normalization = 0;
    let octaveSeed = seed >>> 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      waves[octave] = { ...noiseKernel(octaveSeed), amplitude };
      normalization += amplitude;
      amplitude *= .5;
      octaveSeed = (octaveSeed + 0x6d2b79f5) >>> 0;
    }
    return function sample(x, y, z) {
      let value = 0, frequency = 1;
      for (const wave of waves) {
        value += Math.sin((x * wave.x + y * wave.y + z * wave.z) * frequency + wave.phase) * wave.amplitude;
        frequency *= 2.03;
      }
      return value / normalization;
    };
  }

  function randomSphereDirection(random) {
    const y = random() * 2 - 1;
    const longitude = random() * TAU;
    const horizontal = Math.sqrt(1 - y * y);
    return { x: Math.cos(longitude) * horizontal, y,
      z: Math.sin(longitude) * horizontal };
  }

  function offsetSphereDirection(direction, angularDistance, bearing) {
    const reference = Math.abs(direction.y) < .85 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    let eastX = reference.y * direction.z - reference.z * direction.y;
    let eastY = reference.z * direction.x - reference.x * direction.z;
    let eastZ = reference.x * direction.y - reference.y * direction.x;
    const eastLength = Math.hypot(eastX, eastY, eastZ) || 1;
    eastX /= eastLength; eastY /= eastLength; eastZ /= eastLength;
    const northX = direction.y * eastZ - direction.z * eastY;
    const northY = direction.z * eastX - direction.x * eastZ;
    const northZ = direction.x * eastY - direction.y * eastX;
    const tangentX = Math.cos(bearing) * eastX + Math.sin(bearing) * northX;
    const tangentY = Math.cos(bearing) * eastY + Math.sin(bearing) * northY;
    const tangentZ = Math.cos(bearing) * eastZ + Math.sin(bearing) * northZ;
    const radial = Math.cos(angularDistance), tangent = Math.sin(angularDistance);
    return { x: direction.x * radial + tangentX * tangent,
      y: direction.y * radial + tangentY * tangent,
      z: direction.z * radial + tangentZ * tangent };
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function createTerrain(seed, width = 320, height = 240, planet = null) {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    const settings = root.OrbitWorldgenData.terrain;
    const terrainSeed = hashSeed(String(seed) + ':terrain:v' + (settings.version || 1));
    const random = rng(terrainSeed);
    const waterFraction = clamp(planet?.terrainWater ?? planet?.surfaceWater ??
      (settings.genericWater[0] + random() * (settings.genericWater[1] - settings.genericWater[0])),
    0, root.OrbitWorldgenData.planets.maxSurfaceWater);
    const islandWorld = waterFraction >= settings.islandWaterThreshold;
    const massCountRange = islandWorld ? settings.sphericalMasses.islandWorldCount :
      settings.sphericalMasses.continentalCount;
    const radiusRange = islandWorld ? settings.sphericalMasses.islandWorldRadius :
      settings.sphericalMasses.continentalRadius;
    const secondaryRange = islandWorld ? settings.sphericalMasses.islandSecondaryCount :
      settings.sphericalMasses.continentalSecondaryCount;
    const mainCount = massCountRange[0] + Math.floor(random() * (massCountRange[1] - massCountRange[0] + 1));
    const radiusRatio = settings.sphericalMasses.secondaryRadiusRatio;
    const distanceRatio = settings.sphericalMasses.secondaryDistanceRatio;
    const continentGroups = [];
    for (let i = 0; i < mainCount; i += 1) {
      const direction = randomSphereDirection(random);
      const angularRadius = radiusRange[0] + random() * (radiusRange[1] - radiusRange[0]);
      const borderSeed = (terrainSeed ^ Math.imul(i + 1, 0x45d9f3b)) >>> 0;
      const forms = [{ direction, angularRadius, strength: .9 + random() * .2,
        borderScale: .8 + random() * .4, borderBias: (random() - .5) * .07 }];
      const secondaryCount = secondaryRange[0] +
        Math.floor(random() * (secondaryRange[1] - secondaryRange[0] + 1));
      for (let lobe = 0; lobe < secondaryCount; lobe += 1) {
        const distance = angularRadius * (distanceRatio[0] + random() * (distanceRatio[1] - distanceRatio[0]));
        const lobeRadius = angularRadius * (radiusRatio[0] + random() * (radiusRatio[1] - radiusRatio[0]));
        forms.push({ direction: offsetSphereDirection(direction, distance, random() * TAU),
          angularRadius: lobeRadius, strength: .78 + random() * .35,
          borderScale: .8 + random() * .4, borderBias: (random() - .5) * .09 });
      }
      for (const form of forms) {
        const maximumRadius = form.angularRadius * (1 + .22 * 1.2 + Math.abs(form.borderBias));
        form.influenceCutoff = Math.cos(Math.min(Math.PI, maximumRadius * 2.4));
      }
      continentGroups.push({ borderSeed, forms });
    }
    const sampleBroad = fbm3Sampler(terrainSeed, 5);
    const sampleMedium = fbm3Sampler(terrainSeed ^ 0x5a6a4f29, 4);
    const sampleFine = fbm3Sampler(terrainSeed ^ 0x29f1483b, 3);
    const sampleRidge = fbm3Sampler(terrainSeed ^ 0x3482f129, 4);
    const sampleMoisture = fbm3Sampler(terrainSeed ^ 0x19191531, 4);
    const sampleBorders = continentGroups.map(group => fbm3Sampler(group.borderSeed, 3));
    const raw = new Float32Array(width * height);
    const elevation = new Uint8Array(width * height);
    const moisture = new Uint8Array(width * height);
    const histogram = new Float64Array(256);
    const direction = {};
    let minAltitude = Infinity, totalSurfaceWeight = 0;
    for (let y = 0; y < height; y += 1) {
      const latitude = y === 0 ? Math.PI / 2 : y === height - 1 ? -Math.PI / 2 :
        (.5 - y / Math.max(1, height - 1)) * Math.PI;
      const rowWeight = Math.max(0, Math.cos(latitude));
      for (let x = 0; x < width; x += 1) {
        directionForPixel(x, y, width, height, direction);
        const { x: dx, y: dy, z: dz } = direction;
        const broad = sampleBroad(dx * 2.8, dy * 2.8, dz * 2.8);
        const medium = sampleMedium(dx * 8, dy * 8, dz * 8);
        const fine = sampleFine(dx * 22, dy * 22, dz * 22);
        const ridgeNoise = 1 - Math.abs(sampleRidge(dx * 11, dy * 11, dz * 11));
        let continental = 0;
        for (let groupIndex = 0; groupIndex < continentGroups.length; groupIndex += 1) {
          const group = continentGroups[groupIndex];
          const borderNoise = sampleBorders[groupIndex](dx * 3.5, dy * 3.5, dz * 3.5);
          for (const form of group.forms) {
            const dot = dx * form.direction.x + dy * form.direction.y + dz * form.direction.z;
            if (dot <= form.influenceCutoff) continue;
            const effectiveRadius = form.angularRadius *
              (1 + borderNoise * .22 * form.borderScale + form.borderBias);
            const angularDistance = Math.acos(clamp(dot, -1, 1));
            const normalizedDistance = angularDistance / effectiveRadius;
            const influence = Math.exp(-normalizedDistance * normalizedDistance * 1.4) * form.strength;
            continental = Math.max(continental, influence);
          }
        }
        const ridgeMask = smoothstep(.12, .48, continental);
        const altitude = clamp(88 + continental * 140 + broad * 42 + medium * 18 + fine * 7 +
          Math.pow(ridgeNoise, settings.relief.ridgePower) * ridgeMask * settings.relief.ridgeAmplitude, 0, 255);
        const index = y * width + x;
        raw[index] = altitude;
        histogram[Math.round(altitude)] += rowWeight;
        totalSurfaceWeight += rowWeight;
        minAltitude = Math.min(minAltitude, altitude);
        const altitudePenalty = clamp((altitude - 102) / 200, 0, 1) * .20;
        moisture[index] = Math.round(clamp(.52 +
          sampleMoisture(dx * 5.5, dy * 5.5, dz * 5.5) * .36 -
          altitudePenalty, 0, 1) * 255);
      }
    }

    const targetWater = totalSurfaceWeight * waterFraction;
    let cumulative = 0, rawSeaLevel = 0;
    for (; rawSeaLevel < 255; rawSeaLevel += 1) {
      cumulative += histogram[rawSeaLevel];
      if (cumulative >= targetWater) break;
    }
    if (waterFraction === 0) rawSeaLevel = Math.floor(minAltitude) - 4;
    const seaLevel = 102;
    for (let i = 0; i < raw.length; i += 1) {
      elevation[i] = Math.round(clamp(raw[i] + seaLevel - rawSeaLevel, 0, 255));
    }

    const resources = [];
    const resourceTypes = root.OrbitWorldgenData.deposits;
    const depositSettings = settings.deposits;
    const oilSettings = settings.offshoreOil;
    const temperature = planet?.temperature;
    const temperatureRange = oilSettings.temperatureRange;
    const eligibleForOil = planet?.kind === 'tellurique' && Number.isFinite(temperature) &&
      temperature >= temperatureRange[0] && temperature <= temperatureRange[1];
    const oilPresenceRoll = hashSeed(String(planet?.seed ?? seed) + ':offshore-oil:v' + root.OrbitWorldgenData.version) /
      4294967296;
    const hasOilDeposit = typeof planet?.hasOilDeposit === 'boolean' ? planet.hasOilDeposit :
      eligibleForOil && oilPresenceRoll < oilSettings.planetChance;
    const requestedTotal = planet?.startingCandidate ? depositSettings.startingCandidateCount :
      weightedCount(random, depositSettings.countWeights);
    const requestedResources = planet?.startingCandidate ? requestedTotal :
      Math.max(0, requestedTotal - (hasOilDeposit ? 1 : 0));
    let attempts = 0;
    const depositSpacing = Math.min(width, height) * depositSettings.spacingRatio;
    while (resources.length < requestedResources && attempts < 800) {
      attempts += 1;
      const x = Math.floor(random() * width), y = Math.floor(random() * height);
      const altitude = elevation[y * width + x];
      if (altitude <= seaLevel + 10) continue;
      if (resources.some(resource => !resource.marine &&
          Math.hypot(resource.x - x, resource.y - y) < depositSpacing)) continue;
      // A natal candidate has at least one accessible deposit of each basic
      // solid resource. Water is represented by its sea and water abundance.
      const landResourceCount = resources.length;
      const definition = planet?.startingCandidate && landResourceCount < resourceTypes.length ? resourceTypes[landResourceCount] :
        resourceTypes[Math.floor(random() * resourceTypes.length)];
      const radius = Math.max(5, Math.min(width, height) * (depositSettings.radiusRatio[0] +
        random() * (depositSettings.radiusRatio[1] - depositSettings.radiusRatio[0])));
      resources.push({ ...definition, x, y, radius, marine: false,
        abundance: planet?.resources?.[definition.id] ?? .5 });
    }

    if (hasOilDeposit && waterFraction >= oilSettings.minimumWater) {
      const oilDefinition = root.OrbitWorldgenData.marineDeposits[0];
      let oilAttempts = 0;
      while (!resources.some(resource => resource.marine) && oilAttempts < 1800) {
        oilAttempts += 1;
        const x = Math.floor(random() * width), y = Math.floor(random() * height);
        if (elevation[y * width + x] > seaLevel - oilSettings.depthBelowSea) continue;
        const radius = Math.max(7, Math.min(width, height) * (oilSettings.radiusRatio[0] +
          random() * (oilSettings.radiusRatio[1] - oilSettings.radiusRatio[0])));
        resources.push({ ...oilDefinition, x, y, radius, marine: true,
          abundance: planet?.resources?.oil ?? (0.55 + random() * 0.4) });
      }
    }
    return { width, height, elevation, moisture, seaLevel, resources };
  }

  root.OrbitWorld = Object.freeze({
    hashSeed, rng, createGalaxy, createSystem, planetPosition, directionForPixel, createTerrain
  });
})(globalThis);
