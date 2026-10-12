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

  function lattice(x, y, seed) {
    let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295 * 2 - 1;
  }

  function noise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = lattice(ix, iy, seed), b = lattice(ix + 1, iy, seed);
    const c = lattice(ix, iy + 1, seed), d = lattice(ix + 1, iy + 1, seed);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }

  function fbm(x, y, seed, octaves) {
    let value = 0, amplitude = 1, normalization = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      value += noise(x, y, (seed + Math.imul(octave, 163399)) >>> 0) * amplitude;
      normalization += amplitude;
      amplitude *= 0.5;
      x *= 2.06; y *= 2.06;
    }
    return value / normalization;
  }

  function createTerrain(seed, width = 320, height = 240, planet = null) {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    const settings = root.OrbitWorldgenData.terrain;
    const terrainSeed = hashSeed(String(seed) + ':terrain:v' + (settings.version || 1));
    const random = rng(terrainSeed);
    const offsetX = random() * 80 + 8, offsetY = random() * 80 + 8;
    const aspect = width / height;
    const waterFraction = clamp(planet?.terrainWater ?? planet?.surfaceWater ??
      (settings.genericWater[0] + random() * (settings.genericWater[1] - settings.genericWater[0])),
    0, root.OrbitWorldgenData.planets.maxSurfaceWater);
    const islandWorld = waterFraction >= settings.islandWaterThreshold;
    const massCount = islandWorld ? settings.islandMassCount : settings.continentalMassCount;
    const massRadius = islandWorld ? settings.islandMassRadius : settings.continentalMassRadius;
    const continentCount = massCount[0] + Math.floor(random() * (massCount[1] - massCount[0] + 1));
    const continents = [];
    for (let i = 0; i < continentCount; i += 1) {
      const radiusX = massRadius[0] + random() * (massRadius[1] - massRadius[0]);
      continents.push({
        x: 0.15 + random() * 0.7,
        y: 0.12 + random() * 0.76,
        radiusX,
        radiusY: radiusX * (0.78 + random() * 0.44)
      });
    }
    const archipelago = settings.archipelago;
    const isletRange = islandWorld ? archipelago.islandIslets : archipelago.continentalIslets;
    const isletCount = isletRange[0] + Math.floor(random() * (isletRange[1] - isletRange[0] + 1));
    const islets = [];
    for (let i = 0; i < isletCount; i += 1) {
      const parent = continents[Math.floor(random() * continents.length)];
      const angle = random() * TAU;
      const distance = archipelago.parentDistance[0] +
        random() * (archipelago.parentDistance[1] - archipelago.parentDistance[0]);
      const radiusX = archipelago.isletRadius[0] + random() *
        (archipelago.isletRadius[1] - archipelago.isletRadius[0]);
      islets.push({
        x: parent.x + Math.cos(angle) * parent.radiusX * distance,
        y: parent.y + Math.sin(angle) * parent.radiusY * distance,
        radiusX,
        radiusY: radiusX * (0.65 + random() * 0.7)
      });
    }
    const landforms = continents.concat(islets);
    const raw = new Float32Array(width * height);
    const elevation = new Uint8Array(width * height);
    const moisture = new Uint8Array(width * height);
    const histogram = new Uint32Array(256);
    for (let y = 0; y < height; y += 1) {
      const ny = y / Math.max(1, height - 1);
      for (let x = 0; x < width; x += 1) {
        const nx = x / Math.max(1, width - 1);
        const warpX = fbm(offsetX + nx * settings.relief.warpScale * aspect,
          offsetY + ny * settings.relief.warpScale, terrainSeed ^ 0x6c8e9cf5, 3);
        const warpY = fbm(offsetX + 41 + nx * settings.relief.warpScale * aspect,
          offsetY + 19 + ny * settings.relief.warpScale, terrainSeed ^ 0x1b56c4e9, 3);
        const warpedX = nx + warpX * settings.relief.warpStrength;
        const warpedY = ny + warpY * settings.relief.warpStrength;
        const broad = fbm(offsetX + warpedX * 3.3 * aspect, offsetY + warpedY * 3.3, terrainSeed, 4);
        const detail = fbm(offsetX + warpedX * 15 * aspect, offsetY + warpedY * 15, terrainSeed ^ 0x5a6a4f29, 4);
        const fine = fbm(offsetX + warpedX * settings.relief.fineScale * aspect,
          offsetY + warpedY * settings.relief.fineScale, terrainSeed ^ 0x29f1483b, 3);
        const micro = fbm(offsetX + warpedX * settings.relief.microScale * aspect,
          offsetY + warpedY * settings.relief.microScale, terrainSeed ^ 0x74a1d2c7, 2);
        let continental = 0;
        for (const landform of landforms) {
          const dx = (warpedX - landform.x) / landform.radiusX;
          const dy = (warpedY - landform.y) / landform.radiusY;
          continental = Math.max(continental, Math.exp(-(dx * dx + dy * dy) * 0.75));
        }
        const ridge = 1 - Math.abs(fbm(offsetX + warpedX * settings.relief.ridgeScale * aspect,
          offsetY + warpedY * settings.relief.ridgeScale, terrainSeed ^ 0x3482f129, 3));
        const ridgeMask = clamp((broad + continental * 0.9 - 0.53) * 2.1, 0, 1);
        const altitude = clamp(52 + continental * 120 + broad * 52 + detail * 16 +
          fine * settings.relief.fineAmplitude + micro * settings.relief.microAmplitude +
          Math.pow(ridge, settings.relief.ridgePower) * ridgeMask * settings.relief.ridgeAmplitude, 0, 255);
        const index = y * width + x;
        raw[index] = altitude;
        histogram[Math.round(altitude)] += 1;
        moisture[index] = Math.round(clamp(0.52 + fbm(offsetX + warpedX * 6 * aspect,
          offsetY + warpedY * 6, terrainSeed ^ 0x19191531, 4) * 0.7 -
          ridgeMask * 0.12, 0, 1) * 255);
      }
    }

    const targetWater = raw.length * waterFraction;
    let cumulative = 0, rawSeaLevel = 0;
    for (; rawSeaLevel < 255; rawSeaLevel += 1) {
      cumulative += histogram[rawSeaLevel];
      if (cumulative >= targetWater) break;
    }
    if (waterFraction === 0) rawSeaLevel = histogram.findIndex(count => count > 0) - 4;
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
    hashSeed, rng, createGalaxy, createSystem, planetPosition, createTerrain
  });
})(globalThis);
