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

  function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Chamfer distance, in cells, from every cell to the nearest source cell.
  function distanceField(width, height, source) {
    const far = width + height, diagonal = Math.SQRT2;
    const distance = new Float32Array(width * height);
    for (let i = 0; i < distance.length; i += 1) distance[i] = source[i] ? 0 : far;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (x > 0) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
      if (y > 0) distance[i] = Math.min(distance[i], distance[i - width] + 1);
      if (x > 0 && y > 0) distance[i] = Math.min(distance[i], distance[i - width - 1] + diagonal);
      if (x + 1 < width && y > 0) distance[i] = Math.min(distance[i], distance[i - width + 1] + diagonal);
    }
    for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (x + 1 < width) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
      if (y + 1 < height) distance[i] = Math.min(distance[i], distance[i + width] + 1);
      if (x + 1 < width && y + 1 < height) distance[i] = Math.min(distance[i], distance[i + width + 1] + diagonal);
      if (x > 0 && y + 1 < height) distance[i] = Math.min(distance[i], distance[i + width - 1] + diagonal);
    }
    return distance;
  }

  function pickRange(random, range) {
    return range[0] + random() * (range[1] - range[0]);
  }

  function pickCount(random, range) {
    return range[0] + Math.floor(random() * (range[1] - range[0] + 1));
  }

  // Landforms are rotated ellipses in cell units. Their `reach` bounds the
  // coast once noise has pushed it outward, for placement and culling.
  function makeLandform(random, x, y, area, elongationRange) {
    const radius = Math.sqrt(Math.max(1, area) / Math.PI);
    const elongation = Math.sqrt(pickRange(random, elongationRange));
    const angle = random() * Math.PI;
    const radiusX = radius * elongation, radiusY = radius / elongation;
    return { x, y, radius, radiusX, radiusY, cos: Math.cos(angle), sin: Math.sin(angle),
      reach: Math.max(radiusX, radiusY) * 1.2 };
  }

  function placeLandforms(random, width, height, landFraction, islandWorld, bounds, settings) {
    const masses = settings.landmasses, mapArea = width * height;
    const islandShare = pickRange(random, islandWorld ? masses.islandWorldIslandShare : masses.islandShare);
    const continentCount = pickCount(random, islandWorld ? masses.islandWorldContinentCount : masses.continentCount);
    const islandCount = pickCount(random, islandWorld ? masses.islandWorldIslandCount : masses.islandCount);
    const inside = (landform, x, y) => {
      const minX = bounds.minX + landform.reach, maxX = bounds.maxX - landform.reach;
      const minY = bounds.minY + landform.reach, maxY = bounds.maxY - landform.reach;
      return {
        x: minX < maxX ? clamp(x, minX, maxX) : (bounds.minX + bounds.maxX) / 2,
        y: minY < maxY ? clamp(y, minY, maxY) : (bounds.minY + bounds.maxY) / 2
      };
    };
    const continents = [];
    const weights = Array.from({ length: continentCount }, () => .4 + random());
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    for (const weight of weights.sort((first, second) => second - first)) {
      const area = mapArea * landFraction * (1 - islandShare) * weight / weightTotal;
      const continent = makeLandform(random, 0, 0, area, masses.elongation);
      // Keep the candidate farthest from the others, relative to their sizes.
      let best = null, bestSpacing = -Infinity;
      for (let attempt = 0; attempt < masses.placementAttempts; attempt += 1) {
        const candidate = inside(continent, bounds.minX + random() * (bounds.maxX - bounds.minX),
          bounds.minY + random() * (bounds.maxY - bounds.minY));
        const spacing = continents.reduce((closest, other) => Math.min(closest,
          Math.hypot(candidate.x - other.x, candidate.y - other.y) / (continent.reach + other.reach)), Infinity);
        if (spacing > bestSpacing) { best = candidate; bestSpacing = spacing; }
        if (spacing >= masses.separation) break;
      }
      Object.assign(continent, best);
      continents.push(continent);
    }
    const lobes = [];
    for (const continent of continents) {
      for (let lobe = pickCount(random, masses.lobeCount); lobe > 0; lobe -= 1) {
        const angle = random() * TAU, distance = continent.radius * pickRange(random, masses.lobeDistance);
        const part = makeLandform(random, 0, 0, Math.PI * (continent.radius * pickRange(random, masses.lobeSize)) ** 2,
          masses.elongation);
        lobes.push(Object.assign(part, inside(part, continent.x + Math.cos(angle) * distance,
          continent.y + Math.sin(angle) * distance)));
      }
    }
    const islands = [];
    const islandArea = mapArea * landFraction * islandShare;
    const sizes = Array.from({ length: islandCount }, () => .3 + random() * random() * 1.7);
    const sizeTotal = sizes.reduce((sum, size) => sum + size, 0);
    let previous = null, heading = 0;
    for (const [index, size] of sizes.entries()) {
      const island = makeLandform(random, 0, 0, islandArea * size / sizeTotal, masses.elongation);
      // Chains of two to five islands, either off a continent's coast or in open sea.
      if (!previous || random() < .3) {
        heading = random() * TAU;
        if (continents.length && random() < masses.coastalIslandRatio) {
          const parent = continents[Math.floor(random() * continents.length)];
          const distance = parent.reach * (.85 + random() * .35);
          previous = { x: parent.x + Math.cos(heading) * distance, y: parent.y + Math.sin(heading) * distance, reach: 0 };
          heading += (random() < .5 ? 1 : -1) * Math.PI / 2;
        } else {
          previous = { x: bounds.minX + random() * (bounds.maxX - bounds.minX),
            y: bounds.minY + random() * (bounds.maxY - bounds.minY), reach: 0 };
        }
      }
      heading += (random() - .5) * .9;
      const step = (previous.reach + island.reach) * pickRange(random, masses.islandChainSpacing) * (index ? 1 : 0);
      Object.assign(island, inside(island, previous.x + Math.cos(heading) * step, previous.y + Math.sin(heading) * step));
      islands.push(island);
      previous = island;
    }
    return continents.concat(lobes, islands);
  }

  function createTerrain(seed, width = 320, height = 240, planet = null) {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    const settings = root.OrbitWorldgenData.terrain;
    const terrainSeed = hashSeed(String(seed) + ':terrain:v' + (settings.version || 1));
    const random = rng(terrainSeed);
    const offsetX = random() * 80 + 8, offsetY = random() * 80 + 8;
    const waterFraction = clamp(planet?.terrainWater ?? planet?.surfaceWater ??
      (settings.genericWater[0] + random() * (settings.genericWater[1] - settings.genericWater[0])),
    0, root.OrbitWorldgenData.planets.maxSurfaceWater);
    const border = settings.oceanBorder;
    const oceanBorder = Boolean(border.kinds.includes(planet?.kind));
    // Continents need open sea around them: drier bordered maps keep the minimum water.
    const mapWater = oceanBorder ? Math.max(waterFraction, border.minimumWater) : waterFraction;
    const minSide = Math.min(width, height);
    const edgeMargin = oceanBorder ? (border.minimumOcean + border.edgeWidth * .6) * minSide : minSide * .06;
    const bounds = { minX: edgeMargin, maxX: width - 1 - edgeMargin, minY: edgeMargin, maxY: height - 1 - edgeMargin };
    const landforms = placeLandforms(random, width, height, 1 - mapWater,
      waterFraction >= settings.islandWaterThreshold, bounds, settings);

    // 1. Shape field, in cells: roughly the distance inside a landform's
    // outline (negative offshore), carved by fractal coastal noise.
    const coast = settings.coast, relief = settings.relief;
    const count = width * height, shape = new Float32Array(count);
    const hardBand = border.minimumOcean * minSide;
    const bandRotations = coast.bands.map((_, band) => ({ cos: Math.cos(.55 + band * 1.13), sin: Math.sin(.55 + band * 1.13) }));
    let hardBandMaximum = -Infinity;
    for (let y = 0; y < height; y += 1) {
      const v = y / minSide;
      for (let x = 0; x < width; x += 1) {
        const u = x / minSide;
        const turnedU = (u * .8 - v * .6) * coast.warpScale, turnedV = (u * .6 + v * .8) * coast.warpScale;
        const warpX = x + fbm(offsetX + turnedU, offsetY + turnedV, terrainSeed ^ 0x6c8e9cf5, 3) * coast.warp * minSide;
        const warpY = y + fbm(offsetX + 41 + turnedU, offsetY + 19 + turnedV, terrainSeed ^ 0x1b56c4e9, 3) * coast.warp * minSide;
        let value = -minSide;
        for (const landform of landforms) {
          const dx = warpX - landform.x, dy = warpY - landform.y;
          if (Math.abs(dx) > landform.reach * 3 || Math.abs(dy) > landform.reach * 3) continue;
          const along = (dx * landform.cos + dy * landform.sin) / landform.radiusX;
          const across = (-dx * landform.sin + dy * landform.cos) / landform.radiusY;
          value = Math.max(value, (1 - Math.hypot(along, across)) * landform.radius);
        }
        for (const [band, { scale, amplitude }] of coast.bands.entries()) {
          // Each band is rotated differently so lattice noise never lines the
          // coast up with the map axes.
          const cos = bandRotations[band].cos, sin = bandRotations[band].sin;
          value += fbm(offsetX + 7 * band + (u * cos - v * sin) * scale, offsetY - 5 * band + (u * sin + v * cos) * scale,
            terrainSeed ^ (0x5a6a4f29 + band * 0x9e3779b9), band < 2 ? 3 : 2) * amplitude * minSide;
        }
        if (oceanBorder) {
          const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
          const wavyEdge = edge / minSide + fbm(offsetX + 113 + u * 3, offsetY + 71 + v * 3,
            terrainSeed ^ 0x2c1b3c6d, 3) * border.edgeWarp;
          value -= border.edgeDepth * minSide * (1 - smoothstep((wavyEdge - border.minimumOcean) / border.edgeWidth));
          if (edge < hardBand) hardBandMaximum = Math.max(hardBandMaximum, value);
        }
        shape[y * width + x] = value;
      }
    }

    // 2. Coastline: the shape level that leaves exactly the requested water.
    // The guaranteed open-sea band along bordered maps stays submerged.
    const waterCells = Math.round(count * mapWater);
    let coastLevel = -Infinity;
    if (waterCells > 0) {
      const sorted = Float32Array.from(shape).sort();
      coastLevel = sorted[Math.min(count, waterCells) - 1];
    }
    coastLevel = Math.max(coastLevel, hardBandMaximum);
    const land = new Uint8Array(count), water = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) {
      land[i] = shape[i] > coastLevel ? 1 : 0;
      water[i] = 1 - land[i];
    }

    // 3. Relief from the distance to the coast: lowlands, hills and mountain
    // ranges inland; a shelf, then deep ocean offshore.
    const toWater = distanceField(width, height, water), toLand = distanceField(width, height, land);
    const seaLevel = 102;
    const elevation = new Uint8Array(count), moisture = new Uint8Array(count);
    for (let y = 0; y < height; y += 1) {
      const v = y / minSide;
      for (let x = 0; x < width; x += 1) {
        const u = x / minSide, index = y * width + x;
        const broad = fbm(offsetX + u * 1.8, offsetY + v * 1.8, terrainSeed, 3);
        let mountainMask = 0;
        if (land[index]) {
          const inland = 1 - Math.exp(-toWater[index] / (relief.inlandScale * minSide));
          const hills = (fbm(offsetX + u * relief.hillScale, offsetY + v * relief.hillScale,
            terrainSeed ^ 0x29f1483b, 3) * .5 + .5) * relief.hillAmplitude * inland;
          mountainMask = smoothstep((broad + relief.mountainCoverage - .5) * 3) * inland * Math.sqrt(inland);
          const ridge = Math.pow(1 - Math.abs(fbm(offsetX + u * relief.mountainScale, offsetY + v * relief.mountainScale,
            terrainSeed ^ 0x3482f129, 4)), relief.mountainPower);
          const rise = 1 + relief.lowlandRise * inland + hills + ridge * mountainMask * relief.mountainAmplitude;
          elevation[index] = Math.min(255, seaLevel + Math.max(1, Math.round(rise)));
        } else {
          const offshore = toLand[index];
          const deep = smoothstep(offshore / (relief.oceanScale * minSide));
          const depth = 1 + relief.shelfDepth * (1 - Math.exp(-offshore / (relief.shelfScale * minSide))) +
            relief.oceanDepth * deep + fbm(offsetX + 31 + u * 5, offsetY + 17 + v * 5,
              terrainSeed ^ 0x74a1d2c7, 3) * relief.seabedAmplitude * deep;
          elevation[index] = Math.max(0, seaLevel - Math.max(0, Math.round(depth)));
        }
        moisture[index] = Math.round(clamp(0.52 + fbm(offsetX + u * 6, offsetY + v * 6,
          terrainSeed ^ 0x19191531, 4) * 0.7 - mountainMask * 0.12, 0, 1) * 255);
      }
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
