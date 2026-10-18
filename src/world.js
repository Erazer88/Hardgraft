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

  function createTerrain(seed, width = 960, height = 360, planet = null) {
    width=Math.max(1,Math.floor(width));height=Math.max(1,Math.floor(height));
    const settings=root.OrbitWorldgenData.terrain;
    const terrainSeed=hashSeed(String(seed)+':terrain:v'+settings.version);
    const random=rng(terrainSeed);
    const waterFraction=clamp(planet?.terrainWater ?? planet?.surfaceWater ??
      (settings.genericWater[0]+random()*(settings.genericWater[1]-settings.genericWater[0])),
      0,root.OrbitWorldgenData.planets.maxSurfaceWater);
    const tectonics=root.OrbitTectonics.create(terrainSeed,width,height,planet || {});
    const source=root.OrbitTerrainElevation.create(tectonics,terrainSeed);
    const eroded=root.OrbitThermalErosion.erode(source.rawElevation,width,height);
    const normalized=root.OrbitTerrainElevation.normalize(eroded,width,height,waterFraction);
    const {elevation,seaLevel}=normalized;
    const structure=root.OrbitTerrainStructure.derive(elevation,source.tectonicUplift,width,height,seaLevel);
    const moisture=new Uint8Array(width*height),direction={};
    const sampleMoisture=root.OrbitTectonics.noise3(terrainSeed ^ 0x19191531);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const index=y*width+x;
      if((x && (y===0 || y===height-1)) || (x===width-1 && width>1)) {
        moisture[index]=moisture[y*width];continue;
      }
      directionForPixel(x,y,width,height,direction);
      const penalty=clamp((elevation[index]-seaLevel)/153,0,1)*.20;
      moisture[index]=Math.round(clamp(.52+root.OrbitTectonics.fbm(sampleMoisture,
        direction.x*3.5+7.4,direction.y*3.5-3.8,direction.z*3.5+1.7,3)*.46-penalty,0,1)*255);
    }
    const diagnostics={plateId:tectonics.plateId,continentalField:tectonics.continentalField,
      convergence:tectonics.convergence,divergence:tectonics.divergence,
      tectonicUplift:source.tectonicUplift,
      rawElevation:root.OrbitTerrainElevation.transform(source.rawElevation,normalized),
      erodedElevation:normalized.finalHeights,...structure};

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
    return { width, height, elevation, moisture, seaLevel, resources,
      ...structure, tectonics, diagnostics };
  }

  root.OrbitWorld = Object.freeze({
    hashSeed, rng, createGalaxy, createSystem, planetPosition, directionForPixel, createTerrain
  });
})(globalThis);
