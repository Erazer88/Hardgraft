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

  // Binary min-heap of cell indices keyed by height, for priority flooding.
  function createHeap(capacity) {
    const keys = new Float64Array(capacity), items = new Int32Array(capacity);
    let size = 0;
    return {
      get size() { return size; },
      push(item, key) {
        let i = size++;
        while (i > 0) {
          const parent = (i - 1) >> 1;
          if (keys[parent] <= key) break;
          keys[i] = keys[parent]; items[i] = items[parent]; i = parent;
        }
        keys[i] = key; items[i] = item;
      },
      pop() {
        const top = items[0];
        size -= 1;
        if (size > 0) {
          const key = keys[size], item = items[size];
          let i = 0;
          for (;;) {
            let child = i * 2 + 1;
            if (child >= size) break;
            if (child + 1 < size && keys[child + 1] < keys[child]) child += 1;
            if (keys[child] >= key) break;
            keys[i] = keys[child]; items[i] = items[child]; i = child;
          }
          keys[i] = key; items[i] = item;
        }
        return top;
      }
    };
  }

  const NEIGHBORS = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
    [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]];
  const CARDINAL = NEIGHBORS.slice(0, 4);
  const NEIGHBOR_DX = Int8Array.from(NEIGHBORS, ([dx]) => dx), NEIGHBOR_DY = Int8Array.from(NEIGHBORS, ([, dy]) => dy);

  // Smooth, low-frequency noise sampled every `step` cells and interpolated:
  // the same field as a per-cell evaluation, at a fraction of the cost.
  function coarseField(width, height, minSide, step, evaluate) {
    const columns = Math.ceil((width - 1) / step) + 1, rows = Math.ceil((height - 1) / step) + 1;
    const grid = new Float32Array(columns * rows), field = new Float32Array(width * height);
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      grid[row * columns + column] = evaluate(column * step / minSide, row * step / minSide);
    }
    for (let y = 0; y < height; y += 1) {
      const gy = y / step, row = Math.min(rows - 2, Math.floor(gy)), sy = gy - row;
      for (let x = 0; x < width; x += 1) {
        const gx = x / step, column = Math.min(columns - 2, Math.floor(gx)), sx = gx - column;
        const i = row * columns + column;
        const top = grid[i] + (grid[i + 1] - grid[i]) * sx;
        const bottom = grid[i + columns] + (grid[i + columns + 1] - grid[i + columns]) * sx;
        field[y * width + x] = top + (bottom - top) * sy;
      }
    }
    return field;
  }

  // Flat treads separated by cliffs: t in [0, 1] becomes `steps` mesa levels.
  function terrace(t, steps, cliff) {
    const scaled = clamp(t, 0, 1) * steps, level = Math.min(steps - 1, Math.floor(scaled));
    return (level + smoothstep((scaled - level - (1 - cliff)) / cliff)) / steps;
  }

  // Cell features exposed with the terrain, for rendering and descriptions.
  const TERRAIN_FEATURES = Object.freeze({ none: 0, lake: 1, marsh: 2, river: 3, canyon: 4, cove: 5 });

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

  // Inland relief and water for a fixed coastline. Heights are in elevation
  // units above the sea. Lakes and coves become water cells (elevation at or
  // below sea level); `relief` keeps a lake's surface height for contours.
  function buildLandRelief(options) {
    const { width, height, minSide, land, toWater, offsetX, offsetY, terrainSeed, random,
      settings, waterFraction, seaLevel, elevation } = options;
    const count = width * height, relief = settings.relief, hydrology = settings.hydrology;
    const plains = relief.plains, hills = relief.hills, plateaus = relief.plateaus, mountains = relief.mountains;
    const wetness = smoothstep((waterFraction - hydrology.waterRange[0]) /
      (hydrology.waterRange[1] - hydrology.waterRange[0]));
    const rainfall = new Float32Array(count), ground = new Float32Array(count);
    const ridgeTurn = { cos: Math.cos(.7), sin: Math.sin(.7) };
    let landCount = 0;

    // Low-frequency fields are sampled on a coarse grid; only hills, ridges
    // and fine detail are evaluated closer to every cell.
    const coarse = (step, evaluate) => coarseField(width, height, minSide, step, evaluate);
    const rain = coarse(4, (u, v) => fbm(offsetX + u * 6, offsetY + v * 6, terrainSeed ^ 0x19191531, 4));
    const rampNoise = coarse(4, (u, v) => fbm(offsetX + 71 + u * relief.coastRampScale,
      offsetY - 13 + v * relief.coastRampScale, terrainSeed ^ 0x1f83d9ab, 2));
    const plainNoise = coarse(4, (u, v) => fbm(offsetX + 3 + u * plains.scale, offsetY - 9 + v * plains.scale,
      terrainSeed ^ 0x51ed270b, 3));
    const mesaNoise = coarse(4, (u, v) => fbm(offsetX - 17 + u * plateaus.scale, offsetY + 23 + v * plateaus.scale,
      terrainSeed ^ 0x7b3e1d55, 3));
    const beltNoise = coarse(4, (u, v) => {
      const bend = fbm(offsetX + 61 + u * 1.1, offsetY - 37 + v * 1.1, terrainSeed ^ 0x6a09e667, 2) * .35;
      return 1 - Math.abs(fbm(offsetX + 91 + (u + bend) * mountains.beltScale,
        offsetY + 13 + (v - bend) * mountains.beltScale, terrainSeed ^ 0x3c6ef372, 3));
    });
    const upliftNoise = coarse(4, (u, v) => fbm(offsetX - 41 + u * relief.uplift.scale,
      offsetY + 57 + v * relief.uplift.scale, terrainSeed ^ 0x0f6d2c1b, 3));
    const hillNoise = coarse(2, (u, v) => fbm(offsetX + u * hills.scale, offsetY + v * hills.scale, terrainSeed ^ 0x29f1483b, 4));

    // Base heights: coastal lowlands, plains basins, hills, mesas and massifs.
    for (let y = 0; y < height; y += 1) {
      const v = y / minSide;
      for (let x = 0; x < width; x += 1) {
        const u = x / minSide, index = y * width + x;
        rainfall[index] = clamp(0.52 + rain[index] * 0.7, 0, 1);
        if (!land[index]) continue;
        landCount += 1;
        const inland = 1 - Math.exp(-toWater[index] / (relief.inlandScale * minSide));
        const ramp = relief.coastRamp[0] + (relief.coastRamp[1] - relief.coastRamp[0]) * smoothstep(rampNoise[index] * 1.6 + .5);
        const envelope = smoothstep(toWater[index] / (ramp * minSide));
        const plain = smoothstep((plainNoise[index] + plains.coverage - .5) * 2.5);
        const open = 1 - plain * plains.flattening;
        const hilly = (hillNoise[index] * .5 + .5) * hills.amplitude * Math.sqrt(envelope) * open;
        const mesa = smoothstep((mesaNoise[index] + plateaus.coverage - .5) * 3.2);
        const plateau = terrace(mesa * envelope, plateaus.terraces, plateaus.cliff) * plateaus.height * open;
        const belt = beltNoise[index];
        const beltMask = smoothstep((belt - (1 - mountains.beltWidth)) / mountains.beltWidth) *
          envelope * (1 - plain * .85);
        let massif = 0;
        if (beltMask > 0) {
          // Ridged multifractal: each octave sharpens the crests of the previous one.
          let frequency = mountains.ridgeScale, amplitude = .5, weight = 1, sum = 0, normalization = 0;
          const ru = u * ridgeTurn.cos - v * ridgeTurn.sin, rv = u * ridgeTurn.sin + v * ridgeTurn.cos;
          for (let octave = 0; octave < mountains.octaves; octave += 1) {
            let ridge = 1 - Math.abs(noise(offsetX + 7 * octave + ru * frequency, offsetY - 3 * octave + rv * frequency,
              ((terrainSeed ^ 0x2545f491) + Math.imul(octave, 163399)) >>> 0));
            ridge *= ridge * weight;
            weight = clamp(ridge * 1.8, 0, 1);
            sum += ridge * amplitude; normalization += amplitude;
            amplitude *= .5; frequency *= 2.03;
          }
          massif = Math.pow(sum / normalization, mountains.peakPower) * beltMask * mountains.height;
        }
        const uplift = (upliftNoise[index] * .5 + .5) * relief.uplift.amplitude * envelope * open;
        // Fine relief makes channels wander instead of running straight downhill.
        const detail = fbm(offsetX + 5 + u * relief.detailScale, offsetY - 3 + v * relief.detailScale,
          terrainSeed ^ 0x165667b1, 3) * relief.detail * envelope;
        ground[index] = 1 + relief.coastalRise * inland + uplift + hilly + plateau + massif + detail;
      }
    }

    const lakes = hydrology.lakes, riverSettings = hydrology.rivers;
    // Lake basins: irregular bowls dug into the relief; flooding decides their shores.
    const basinCount = wetness > .25 ? Math.round(pickCount(random, lakes.basinCount) * wetness) : 0;
    for (let basin = 0; basin < basinCount; basin += 1) {
      let center = -1;
      for (let attempt = 0; attempt < 40 && center < 0; attempt += 1) {
        const candidate = Math.floor(random() * count);
        if (land[candidate] && toWater[candidate] > .05 * minSide) center = candidate;
      }
      if (center < 0) continue;
      // A few overlapping elongated bowls with a noisy rim: irregular shores and arms.
      const depth = lakes.basinDepth * (.6 + random() * .6);
      let lobeX = center % width, lobeY = Math.floor(center / width);
      for (let lobe = pickCount(random, lakes.lobes); lobe > 0; lobe -= 1) {
        const radius = pickRange(random, lakes.basinRadius) * minSide, angle = random() * Math.PI;
        const stretch = 1 + random() * 1.2, cos = Math.cos(angle), sin = Math.sin(angle);
        const reach = Math.ceil(radius * stretch * (1 + lakes.shoreNoise));
        const cx = Math.round(lobeX), cy = Math.round(lobeY);
        for (let y = Math.max(0, cy - reach); y <= Math.min(height - 1, cy + reach); y += 1) {
          for (let x = Math.max(0, cx - reach); x <= Math.min(width - 1, cx + reach); x += 1) {
            const index = y * width + x;
            if (!land[index]) continue;
            const along = ((x - cx) * cos + (y - cy) * sin) / (radius * stretch);
            const across = (-(x - cx) * sin + (y - cy) * cos) / radius;
            const rim = 1 + lakes.shoreNoise * fbm(offsetX + x / minSide * 16, offsetY + y / minSide * 16,
              terrainSeed ^ 0x4a7484aa, 3);
            const distance = Math.hypot(along, across) / rim;
            if (distance < 1) ground[index] -= depth * (1 - distance * distance) ** 2;
          }
        }
        lobeX += Math.cos(angle) * radius * stretch * (random() < .5 ? 1 : -1);
        lobeY += Math.sin(angle) * radius * stretch * (random() < .5 ? 1 : -1);
      }
    }

    // Priority flood from the sea (or the map edge on dry worlds): every land
    // cell gets a drainage parent and the lowest spill height that reaches the
    // outlet. Cells below their spill height sit in a closed depression.
    const filled = new Float32Array(count), parent = new Int32Array(count).fill(-1);
    const order = new Int32Array(landCount), visited = new Uint8Array(count), heap = createHeap(Math.max(1, landCount));
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!land[index]) continue;
      let outlet = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      for (let n = 0; n < 8 && !outlet; n += 1) outlet = !land[index + NEIGHBOR_DY[n] * width + NEIGHBOR_DX[n]];
      if (!outlet) continue;
      visited[index] = 1; filled[index] = ground[index];
      heap.push(index, filled[index]);
    }
    let flooded = 0;
    while (heap.size) {
      const cell = heap.pop(), cx = cell % width, cy = (cell - cx) / width;
      order[flooded++] = cell;
      for (let n = 0; n < 8; n += 1) {
        const x = cx + NEIGHBOR_DX[n], y = cy + NEIGHBOR_DY[n];
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const next = y * width + x;
        if (!land[next] || visited[next]) continue;
        visited[next] = 1;
        filled[next] = Math.max(ground[next], filled[cell] + 1e-3);
        parent[next] = cell;
        heap.push(next, filled[next]);
      }
    }

    // Lakes: closed depressions deep and wide enough on wet worlds. Shallower
    // hollows are filled to their spill height and become flats.
    const lake = new Uint8Array(count);
    if (wetness > .25) {
      const seen = new Uint8Array(count), stack = [], basins = [];
      for (let start = 0; start < count; start += 1) {
        if (!land[start] || seen[start] || filled[start] - ground[start] <= .3) continue;
        const component = [];
        let deepest = 0;
        seen[start] = 1; stack.push(start);
        while (stack.length) {
          const cell = stack.pop(), cx = cell % width, cy = (cell - cx) / width;
          component.push(cell);
          deepest = Math.max(deepest, filled[cell] - ground[cell]);
          for (const [dx, dy] of CARDINAL) {
            const x = cx + dx, y = cy + dy, next = y * width + x;
            if (x < 0 || y < 0 || x >= width || y >= height || seen[next] || !land[next] ||
                filled[next] - ground[next] <= .3) continue;
            seen[next] = 1; stack.push(next);
          }
        }
        if (deepest >= lakes.minDepth && component.length >= lakes.minArea) basins.push({ component, score: deepest * Math.sqrt(component.length) });
      }
      let lakeCells = 0;
      for (const basin of basins.sort((first, second) => second.score - first.score)) {
        if (lakeCells + basin.component.length > lakes.maxShare * landCount * wetness) continue;
        lakeCells += basin.component.length;
        for (const cell of basin.component) lake[cell] = 1;
      }
    }

    // Drainage: rain gathers downstream along the flood parents.
    const flow = new Float32Array(count);
    for (let i = 0; i < flooded; i += 1) flow[order[i]] = .3 + rainfall[order[i]];
    for (let i = flooded - 1; i >= 0; i -= 1) {
      const cell = order[i];
      if (parent[cell] >= 0) flow[parent[cell]] += flow[cell];
    }
    // Wet worlds have more rivers; dry worlds keep only their largest channels as dry canyons.
    const threshold = riverSettings.threshold * count / (.5 + wetness);
    const flowing = wetness > .2;
    const channel = new Uint8Array(count), bed = new Float32Array(count), valley = new Float32Array(count);
    const canyon = new Float32Array(count);
    for (let i = 0; i < flooded; i += 1) {
      const cell = order[i];
      if (lake[cell] || flow[cell] < threshold) continue;
      channel[cell] = 1;
      const strength = Math.log2(1 + flow[cell] / threshold);
      // Across filled hollows the drainage runs in straight lines: barely
      // incise there, so no artificial straight grooves appear.
      const hollow = filled[cell] - ground[cell] > .5;
      const carve = Math.min(riverSettings.maxCarve, riverSettings.carve * strength) * (hollow ? .25 : 1);
      // Rivers crossing high mesas and massifs cut narrow canyons.
      canyon[cell] = hollow ? 0 : smoothstep((filled[cell] - riverSettings.canyonStart) / 30);
      const target = filled[cell] - carve - riverSettings.canyonDepth * canyon[cell] * Math.min(1, strength / 2);
      const down = parent[cell];
      const downstreamBed = down < 0 ? .5 : lake[down] ? filled[down] : channel[down] ? bed[down] : filled[down];
      // Beds never rise downstream, so every river keeps flowing to its outlet.
      bed[cell] = Math.max(target, downstreamBed + .05);
      valley[cell] = canyon[cell] > .5 ? riverSettings.canyonWidth :
        riverSettings.valleyWidth[0] + (riverSettings.valleyWidth[1] - riverSettings.valleyWidth[0]) * clamp((strength - 1) / 3, 0, 1);
    }

    // Valleys: lower each cell toward the bed of its nearest channel, with
    // steep walls in canyons and gentle slopes in plains.
    const nearest = new Int32Array(count).fill(-1), distance = new Float32Array(count).fill(width + height);
    for (let i = 0; i < count; i += 1) if (channel[i]) { nearest[i] = i; distance[i] = 0; }
    // Two chamfer passes that also carry the index of the nearest channel cell.
    const relax = (cell, other, cost) => {
      if (nearest[other] >= 0 && distance[other] + cost < distance[cell]) {
        distance[cell] = distance[other] + cost; nearest[cell] = nearest[other];
      }
    };
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const cell = y * width + x;
      if (x > 0) relax(cell, cell - 1, 1);
      if (y > 0) {
        relax(cell, cell - width, 1);
        if (x > 0) relax(cell, cell - width - 1, Math.SQRT2);
        if (x + 1 < width) relax(cell, cell - width + 1, Math.SQRT2);
      }
    }
    for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
      const cell = y * width + x;
      if (x + 1 < width) relax(cell, cell + 1, 1);
      if (y + 1 < height) {
        relax(cell, cell + width, 1);
        if (x + 1 < width) relax(cell, cell + width + 1, Math.SQRT2);
        if (x > 0) relax(cell, cell + width - 1, Math.SQRT2);
      }
    }
    const heightAbove = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      if (!land[i] || lake[i]) continue;
      let value = filled[i];
      const river = nearest[i];
      if (river >= 0) {
        const reach = valley[river] * 2.2, t = distance[i] / reach;
        if (t < 1) {
          const profile = canyon[river] > .5 ? Math.pow(t, .45) : smoothstep(t);
          value = Math.min(value, bed[river] + (filled[i] - bed[river]) * profile);
        }
      }
      heightAbove[i] = value;
    }

    // Criques: the last cells of large rivers through high coasts open to the sea.
    const coves = hydrology.coves, cove = new Uint8Array(count);
    if (flowing) {
      const mainChild = new Int32Array(count).fill(-1);
      for (let i = 0; i < count; i += 1) {
        const down = parent[i];
        if (channel[i] && down >= 0 && (mainChild[down] < 0 || flow[i] > flow[mainChild[down]])) mainChild[down] = i;
      }
      for (let i = 0; i < count; i += 1) {
        if (!channel[i] || parent[i] >= 0 || flow[i] < threshold * coves.minFlow) continue;
        const strength = clamp((Math.log2(1 + flow[i] / threshold) - 2) / 3, 0, 1);
        const length = Math.round(coves.length[0] + (coves.length[1] - coves.length[0]) * strength);
        const stem = [];
        for (let cell = i; cell >= 0 && stem.length < length; cell = mainChild[cell]) stem.push(cell);
        const coastHeight = stem.reduce((highest, cell) => Math.max(highest, filled[cell]), 0);
        if (coastHeight < coves.minCoastHeight && strength < 1) continue;
        for (const [position, cell] of stem.entries()) {
          cove[cell] = 1;
          // Wider near the mouth: a funnel-shaped estuary.
          if (position > stem.length / 2) continue;
          const cx = cell % width, cy = (cell - cx) / width;
          for (const [dx, dy] of CARDINAL) {
            const next = (cy + dy) * width + cx + dx;
            if (cx + dx >= 0 && cy + dy >= 0 && cx + dx < width && cy + dy < height && land[next] && !lake[next]) cove[next] = 1;
          }
        }
      }
    }

    // Marshes: wet, low and flat ground beside rivers, lakes and shores.
    const marshes = hydrology.marshes, features = new Uint8Array(count);
    const lakeShore = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) if (lake[i]) {
      const cx = i % width, cy = (i - cx) / width;
      for (let dy = -marshes.reach; dy <= marshes.reach; dy += 1) for (let dx = -marshes.reach; dx <= marshes.reach; dx += 1) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < width && y < height) lakeShore[y * width + x] = 1;
      }
    }
    const heightAt = (x, y) => {
      const index = clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1);
      return land[index] && !lake[index] ? heightAbove[index] : 0;
    };
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!land[index]) continue;
      if (lake[index]) { features[index] = TERRAIN_FEATURES.lake; continue; }
      if (cove[index]) { features[index] = TERRAIN_FEATURES.cove; continue; }
      if (channel[index]) { features[index] = flowing ? TERRAIN_FEATURES.river : TERRAIN_FEATURES.canyon; continue; }
      if (filled[index] - heightAbove[index] > 12) { features[index] = TERRAIN_FEATURES.canyon; continue; }
      if (!flowing || heightAbove[index] > marshes.maxHeight || rainfall[index] < marshes.minMoisture) continue;
      const slope = Math.hypot(heightAt(x + 1, y) - heightAt(x - 1, y), heightAt(x, y + 1) - heightAt(x, y - 1)) * .5;
      const river = nearest[index];
      const floodplain = river >= 0 && distance[index] <= marshes.reach +
        marshes.floodplain * Math.log2(1 + flow[river] / threshold) && canyon[river] < .5;
      const nearWater = floodplain || filled[index] - ground[index] > .2 || lakeShore[index] ||
        (toWater[index] <= marshes.reach && flow[index] > threshold * .25);
      const patch = fbm(offsetX + 47 + x / minSide * 12, offsetY - 29 + y / minSide * 12, terrainSeed ^ 0x2f8c1d4b, 2);
      if (slope < marshes.maxSlope && nearWater && patch > marshes.patchiness) features[index] = TERRAIN_FEATURES.marsh;
    }

    // Rivers as polylines from each source to the sea, a lake or a confluence.
    const rivers = [];
    if (flowing) {
      const hasChannelChild = new Uint8Array(count), traced = new Uint8Array(count);
      for (let i = 0; i < count; i += 1) if (channel[i] && !cove[i] && parent[i] >= 0) hasChannelChild[parent[i]] = 1;
      for (let i = 0; i < flooded; i += 1) {
        const source = order[flooded - 1 - i];
        if (!channel[source] || cove[source] || hasChannelChild[source]) continue;
        const points = [], flows = [];
        let cell = source;
        for (;;) {
          const cx = cell % width, cy = (cell - cx) / width;
          points.push(cx, cy); flows.push(+(flow[cell] / threshold).toFixed(2));
          if (traced[cell]) break;
          traced[cell] = 1;
          const down = parent[cell];
          if (down < 0) {
            // Reach into the neighboring sea for a visible mouth.
            const sea = NEIGHBORS.find(([dx, dy]) => {
              const x = cx + dx, y = cy + dy;
              return x >= 0 && y >= 0 && x < width && y < height && !land[y * width + x];
            });
            if (sea) { points.push(cx + sea[0], cy + sea[1]); flows.push(flows.at(-1)); }
            break;
          }
          if (lake[down] || cove[down]) {
            points.push(down % width, Math.floor(down / width)); flows.push(flows.at(-1));
            break;
          }
          cell = down;
        }
        if (points.length >= 6) rivers.push({ points, flows });
      }
    }

    // Final heights: land above the sea, lakes and coves at or below it.
    const reliefHeight = new Uint8Array(count), moisture = new Uint8Array(count);
    const soften = value => value <= 120 ? value : 120 + 33 * (1 - Math.exp(-(value - 120) / 33));
    for (let i = 0; i < count; i += 1) {
      moisture[i] = Math.round(rainfall[i] * 255);
      if (!land[i]) continue;
      if (lake[i]) {
        elevation[i] = seaLevel - clamp(Math.round((filled[i] - ground[i]) / 3), 1, lakes.maxDepth);
        reliefHeight[i] = seaLevel + clamp(Math.round(soften(filled[i])), 1, 153);
      } else if (cove[i]) {
        elevation[i] = reliefHeight[i] = seaLevel - 3;
      } else {
        elevation[i] = reliefHeight[i] = seaLevel + clamp(Math.round(soften(heightAbove[i])), 1, 153);
      }
    }
    return { moisture, relief: reliefHeight, features, rivers };
  }

  // Ground composition. Each cell gets a share of every material, rock filling
  // the rest. Terrain traits set where a material tends to gather, warped
  // Voronoi zones give every area its own mix, and noise pockets concentrate
  // it. Shares are stored per cell and material as bytes (255 = 100 %).
  function buildMaterials(options) {
    const { width, height, minSide, land, toWater, elevation, relief, features, moisture, seaLevel,
      offsetX, offsetY, terrainSeed, planet, settings } = options;
    const table = settings.materials, list = table.list, count = width * height, kinds = list.length;

    // Landmass sizes: small islands hold richer and more varied pockets.
    const landmass = new Float32Array(count), seen = new Uint8Array(count), stack = [];
    for (let start = 0; start < count; start += 1) {
      if (!land[start] || seen[start]) continue;
      const component = [];
      seen[start] = 1; stack.push(start);
      while (stack.length) {
        const cell = stack.pop(), cx = cell % width, cy = (cell - cx) / width;
        component.push(cell);
        for (let n = 0; n < 8; n += 1) {
          const x = cx + NEIGHBOR_DX[n], y = cy + NEIGHBOR_DY[n], next = y * width + x;
          if (x < 0 || y < 0 || x >= width || y >= height || seen[next] || !land[next]) continue;
          seen[next] = 1; stack.push(next);
        }
      }
      for (const cell of component) landmass[cell] = component.length / count;
    }

    // Zones: a jittered grid of seeds; every zone scales each material by its
    // own factor and boosts one signature material.
    const spacing = Math.max(2, table.zoneSize * minSide);
    const columns = Math.ceil(width / spacing) + 1, rows = Math.ceil(height / spacing) + 1;
    const zoneRandom = rng(terrainSeed ^ 0x5bd1e995);
    const seedX = new Float32Array(columns * rows), seedY = new Float32Array(columns * rows);
    const zoneFactor = new Float32Array(columns * rows * kinds);
    const [lowVariation, highVariation] = table.zoneVariation.map(Math.log);
    for (let zone = 0; zone < columns * rows; zone += 1) {
      seedX[zone] = (zone % columns + .5 + (zoneRandom() - .5) * .9) * spacing;
      seedY[zone] = (Math.floor(zone / columns) + .5 + (zoneRandom() - .5) * .9) * spacing;
      const signature = Math.floor(zoneRandom() * kinds);
      for (let kind = 0; kind < kinds; kind += 1) {
        zoneFactor[zone * kinds + kind] = Math.exp(lowVariation + zoneRandom() * (highVariation - lowVariation)) *
          (kind === signature ? table.signatureBoost : 1);
      }
    }
    const coarse = (step, evaluate) => coarseField(width, height, minSide, step, evaluate);
    const zoneWarpX = coarse(4, (u, v) => fbm(offsetX + 211 + u * 3, offsetY - 7 + v * 3, terrainSeed ^ 0x27d4eb2f, 2));
    const zoneWarpY = coarse(4, (u, v) => fbm(offsetX - 59 + u * 3, offsetY + 151 + v * 3, terrainSeed ^ 0x165667b1, 2));
    const hotspots = list.map((material, kind) => coarse(2, (u, v) => fbm(offsetX + 37 * (kind + 1) + u * table.hotspotScale,
      offsetY - 23 * (kind + 1) + v * table.hotspotScale, (terrainSeed ^ 0x68e31da4) + kind * 0x9e3779b9 >>> 0, 3)));
    const richness = list.map(material => .5 + (planet?.resources?.[material.id] ?? .5));

    const shares = new Uint8Array(count * kinds), share = new Float32Array(kinds);
    const natal = Boolean(planet?.startingCandidate);
    const best = list.map(() => ({ cell: -1, score: -1 }));
    const heightAt = (x, y) => relief[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
    const traits = {};
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const cell = y * width + x, onLand = land[cell] === 1;
      // Terrain traits, each between 0 and 1.
      const above = relief[cell] - seaLevel;
      const slope = Math.hypot(heightAt(x + 1, y) - heightAt(x - 1, y), heightAt(x, y + 1) - heightAt(x, y - 1)) * .5;
      const feature = features[cell];
      traits.mountain = onLand ? smoothstep((above - 65) / 55) : 0;
      traits.upland = onLand ? smoothstep((above - 22) / 35) * (1 - traits.mountain) : 0;
      traits.plain = onLand ? 1 - smoothstep((above - 6) / 34) : 0;
      traits.coast = onLand ? 1 - smoothstep(toWater[cell] / (.025 * minSide)) : 0;
      traits.river = feature === TERRAIN_FEATURES.river || feature === TERRAIN_FEATURES.lake ? 1 : 0;
      traits.marsh = feature === TERRAIN_FEATURES.marsh ? 1 : 0;
      traits.dry = onLand ? smoothstep((.55 - moisture[cell] / 255) / .35) : 0;
      traits.rugged = onLand ? Math.max(smoothstep((slope - 2) / 6), feature === TERRAIN_FEATURES.canyon ? 1 : 0) : 0;
      traits.remote = onLand ? smoothstep(toWater[cell] / (.16 * minSide)) : 0;
      traits.island = onLand ? 1 - smoothstep((landmass[cell] - .002) / .03) : 0;
      const depth = seaLevel - elevation[cell];
      traits.shelf = onLand ? 0 : 1 - smoothstep((depth - 8) / 22);
      traits.deep = onLand ? 0 : smoothstep((depth - 20) / 25);
      const difficulty = Math.max(traits.rugged, traits.mountain * .8, traits.remote * .6, traits.island * .7);

      // Nearest zone seed, on warped coordinates for organic zone borders.
      const wx = x + zoneWarpX[cell] * spacing * 1.2, wy = y + zoneWarpY[cell] * spacing * 1.2;
      const gx = Math.floor(wx / spacing), gy = Math.floor(wy / spacing);
      let zone = 0, nearest = Infinity, other = 0, second = Infinity;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const column = clamp(gx + dx, 0, columns - 1), row = clamp(gy + dy, 0, rows - 1), candidate = row * columns + column;
        if (candidate === zone && nearest < Infinity) continue;
        const distance = (seedX[candidate] - wx) ** 2 + (seedY[candidate] - wy) ** 2;
        if (distance < nearest) { other = zone; second = nearest; nearest = distance; zone = candidate; }
        else if (distance < second && candidate !== zone) { second = distance; other = candidate; }
      }
      // Soft borders: near the edge between two zones, their factors blend.
      const own = .5 + .5 * smoothstep((Math.sqrt(second) - Math.sqrt(nearest)) / (spacing * table.zoneBlend));

      // Lakes and coves hold neither land materials nor offshore ones.
      const inlandWater = feature === TERRAIN_FEATURES.lake || feature === TERRAIN_FEATURES.cove;
      let ore = 0;
      for (let kind = 0; kind < kinds; kind += 1) {
        const material = list[kind];
        if (inlandWater || Boolean(material.marine) === onLand) { share[kind] = 0; continue; }
        let affinity = 0;
        for (const trait in material.affinity) affinity += material.affinity[trait] * traits[trait];
        affinity = clamp(affinity, 0, 1);
        const pocket = Math.pow(smoothstep((hotspots[kind][cell] + .35 - (material.pocketThreshold ?? .25)) / .5),
          table.hotspotSharpness);
        const bonus = (1 + table.difficultyBonus * difficulty * (material.rarity ? 1 : .35)) *
          (1 + table.islandBonus * traits.island);
        const factor = zoneFactor[zone * kinds + kind] * own + zoneFactor[other * kinds + kind] * (1 - own);
        share[kind] = material.base * factor + (material.peak - material.base) * affinity * factor * pocket * richness[kind] * bonus;
        ore += share[kind];
        if (natal && affinity * pocket > best[kind].score) best[kind] = { cell, score: affinity * pocket };
      }
      const scale = ore > table.maxOreShare ? table.maxOreShare / ore : 1;
      for (let kind = 0; kind < kinds; kind += 1) shares[cell * kinds + kind] = Math.round(clamp(share[kind] * scale, 0, 1) * 255);
    }

    // The natal world always offers at least one rich pocket of each land material.
    if (natal) {
      const target = Math.round(table.natalMinimumPeak * 255), sigma = Math.max(1.5, .02 * minSide);
      for (let kind = 0; kind < kinds; kind += 1) {
        if (list[kind].marine || best[kind].cell < 0) continue;
        let peak = 0;
        for (let cell = 0; cell < count; cell += 1) peak = Math.max(peak, shares[cell * kinds + kind]);
        if (peak >= target) continue;
        const cx = best[kind].cell % width, cy = Math.floor(best[kind].cell / width), reach = Math.ceil(sigma * 3);
        for (let y = Math.max(0, cy - reach); y <= Math.min(height - 1, cy + reach); y += 1) {
          for (let x = Math.max(0, cx - reach); x <= Math.min(width - 1, cx + reach); x += 1) {
            const cell = y * width + x;
            if (!land[cell]) continue;
            const boost = (target + 10) * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma));
            shares[cell * kinds + kind] = Math.min(255, Math.max(shares[cell * kinds + kind], Math.round(boost)));
          }
        }
      }
    }
    const veins = buildVeins({ width, height, minSide, land, features, shares, list, table, terrainSeed, richness });
    return { ids: list.map(material => material.id), shares, veins: veins.veins, nodes: veins.nodes };
  }

  // Ore veins: from the richest spots of each land material, branching
  // fractures wander outward. Every vein enriches the cells it crosses, so the
  // ground under a vein really holds more of its material.
  function buildVeins(options) {
    const { width, height, minSide, land, features, shares, list, table, terrainSeed, richness } = options;
    const settings = table.veins, kinds = list.length, random = rng(terrainSeed ^ 0x2f6e2b1d);
    const veins = [], nodes = [];
    const onLand = (x, y) => {
      const cx = Math.round(x), cy = Math.round(y);
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) return false;
      const cell = cy * width + cx, feature = features[cell];
      return land[cell] === 1 && feature !== TERRAIN_FEATURES.lake && feature !== TERRAIN_FEATURES.cove;
    };
    const enrich = (kind, x, y, strength) => {
      const peak = settings.share * strength, reach = Math.ceil(settings.width);
      for (let cy = Math.round(y) - reach; cy <= Math.round(y) + reach; cy += 1) {
        for (let cx = Math.round(x) - reach; cx <= Math.round(x) + reach; cx += 1) {
          if (!onLand(cx, cy)) continue;
          const falloff = 1 - Math.hypot(cx - x, cy - y) / settings.width;
          if (falloff <= 0) continue;
          const cell = cy * width + cx, index = cell * kinds + kind;
          shares[index] = Math.max(shares[index], Math.round(peak * falloff * 255));
          let ore = 0;
          for (let other = 0; other < kinds; other += 1) ore += shares[cell * kinds + other];
          const limit = table.maxOreShare * 255;
          if (ore > limit) for (let other = 0; other < kinds; other += 1) {
            if (other !== kind) shares[cell * kinds + other] = Math.floor(shares[cell * kinds + other] * Math.max(0, limit - shares[index]) / Math.max(1, ore - shares[index]));
          }
        }
      }
    };
    const grow = (kind, x, y, heading, length, strength, depth) => {
      const points = [x, y], strengths = [strength];
      const steps = Math.max(2, Math.round(length / settings.step));
      for (let step = 1; step <= steps; step += 1) {
        heading += (random() - .5) * 2 * settings.turn;
        const nx = x + Math.cos(heading) * settings.step, ny = y + Math.sin(heading) * settings.step;
        if (!onLand(nx, ny)) break;
        x = nx; y = ny;
        // Veins thin out from the node toward their tips.
        const local = strength * (1 - .65 * step / steps);
        points.push(x, y); strengths.push(local);
        enrich(kind, x, y, local);
        if (depth < settings.maxDepth && random() < settings.splitChance) {
          const turn = (random() < .5 ? -1 : 1) * pickRange(random, settings.splitAngle);
          grow(kind, x, y, heading + turn, (steps - step) * settings.step * pickRange(random, settings.splitLength),
            local * .8, depth + 1);
        }
      }
      if (points.length >= 4) veins.push({ kind, points: points.map(value => Math.round(value * 100) / 100), strengths });
    };
    const spacing = settings.nodeSpacing * minSide, stride = 4;
    for (let kind = 0; kind < kinds; kind += 1) {
      if (list[kind].marine) continue;
      // The richest spots, kept apart from each other.
      const candidates = [];
      for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) {
        const share = shares[(y * width + x) * kinds + kind] / 255;
        if (share >= settings.minNodeShare && onLand(x, y)) candidates.push({ x, y, share });
      }
      candidates.sort((first, second) => second.share - first.share || first.y - second.y || first.x - second.x);
      const wanted = Math.round(settings.nodes[0] + (settings.nodes[1] - settings.nodes[0]) * clamp(richness[kind] - .5, 0, 1));
      const chosen = [];
      for (const candidate of candidates) {
        if (chosen.length >= wanted) break;
        if (chosen.some(node => Math.hypot(node.x - candidate.x, node.y - candidate.y) < spacing)) continue;
        chosen.push(candidate);
      }
      for (const node of chosen) {
        const strength = clamp(.55 + node.share * 1.5, .55, 1);
        nodes.push({ kind, x: node.x, y: node.y, strength });
        enrich(kind, node.x, node.y, strength);
        const branches = pickCount(random, settings.branches), start = random() * TAU;
        for (let branch = 0; branch < branches; branch += 1) {
          const heading = start + branch / branches * TAU + (random() - .5) * .6;
          grow(kind, node.x, node.y, heading, pickRange(random, settings.length) * minSide, strength, 0);
        }
      }
    }
    return { veins, nodes };
  }

  // Shares of every material in one cell, rock included, as fractions.
  function materialsAt(terrain, cell) {
    const { ids, shares } = terrain.materials, kinds = ids.length, result = {};
    let ore = 0;
    for (let kind = 0; kind < kinds; kind += 1) {
      result[ids[kind]] = shares[cell * kinds + kind] / 255;
      ore += result[ids[kind]];
    }
    result.rock = Math.max(0, 1 - ore);
    return result;
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
        for (let band = 0; band < coast.bands.length; band += 1) {
          // Each band is rotated differently so lattice noise never lines the
          // coast up with the map axes.
          const { scale, amplitude } = coast.bands[band];
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

    // 3. Relief: inland heights and hydrology on the fixed coastline, then
    // the shelf and deep ocean offshore.
    const toWater = distanceField(width, height, water), toLand = distanceField(width, height, land);
    const seaLevel = 102;
    const elevation = new Uint8Array(count);
    const { moisture, relief: reliefHeight, features, rivers } = buildLandRelief({
      width, height, minSide, land, toWater, offsetX, offsetY, terrainSeed, random, settings,
      waterFraction: mapWater, seaLevel, elevation
    });
    const ocean = settings.relief.ocean;
    for (let y = 0; y < height; y += 1) {
      const v = y / minSide;
      for (let x = 0; x < width; x += 1) {
        const u = x / minSide, index = y * width + x;
        if (land[index]) continue;
        const offshore = toLand[index];
        const deep = smoothstep(offshore / (ocean.oceanScale * minSide));
        const depth = 1 + ocean.shelfDepth * (1 - Math.exp(-offshore / (ocean.shelfScale * minSide))) +
          ocean.oceanDepth * deep + fbm(offsetX + 31 + u * 5, offsetY + 17 + v * 5,
            terrainSeed ^ 0x74a1d2c7, 3) * ocean.seabedAmplitude * deep;
        elevation[index] = reliefHeight[index] = Math.max(0, seaLevel - Math.max(0, Math.round(depth)));
      }
    }

    const materials = buildMaterials({ width, height, minSide, land, toWater, elevation, relief: reliefHeight, features,
      moisture, seaLevel, offsetX, offsetY, terrainSeed, planet, settings });
    return { width, height, elevation, relief: reliefHeight, features, rivers, moisture, seaLevel, materials };
  }

  root.OrbitWorld = Object.freeze({
    hashSeed, rng, createGalaxy, createSystem, planetPosition, createTerrain, materialsAt, TERRAIN_FEATURES
  });
})(globalThis);
