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

  function normalizeDirection(vector) {
    const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
    return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
  }

  function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

  function cross3(a, b) {
    return { x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x };
  }

  function rotateAroundAxis(vector, axis, angle) {
    const cosine = Math.cos(angle), sine = Math.sin(angle), projection = dot3(axis, vector);
    const cross = cross3(axis, vector);
    return normalizeDirection({
      x: vector.x * cosine + cross.x * sine + axis.x * projection * (1 - cosine),
      y: vector.y * cosine + cross.y * sine + axis.y * projection * (1 - cosine),
      z: vector.z * cosine + cross.z * sine + axis.z * projection * (1 - cosine)
    });
  }

  function tangentAt(direction, bearing) {
    const reference = Math.abs(direction.y) < .85 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const east = normalizeDirection(cross3(reference, direction));
    const north = normalizeDirection(cross3(direction, east));
    return normalizeDirection({
      x: Math.cos(bearing) * east.x + Math.sin(bearing) * north.x,
      y: Math.cos(bearing) * east.y + Math.sin(bearing) * north.y,
      z: Math.cos(bearing) * east.z + Math.sin(bearing) * north.z
    });
  }

  function randomInRange(random, range) {
    return range[0] + random() * (range[1] - range[0]);
  }

  function randomIntegerInRange(random, range) {
    return range[0] + Math.floor(random() * (range[1] - range[0] + 1));
  }

  function createMountainPath(start, initialTangent, segmentCount, lengthRange, bendRange, random) {
    const points = [normalizeDirection(start)], tangents = [normalizeDirection(initialTangent)];
    const lengths = [];
    let point = points[0], tangent = tangents[0];
    for (let index = 0; index < segmentCount; index += 1) {
      const step = randomInRange(random, lengthRange);
      const cosine = Math.cos(step), sine = Math.sin(step);
      const nextPoint = normalizeDirection({
        x: point.x * cosine + tangent.x * sine,
        y: point.y * cosine + tangent.y * sine,
        z: point.z * cosine + tangent.z * sine
      });
      const nextTangent = normalizeDirection({
        x: tangent.x * cosine - point.x * sine,
        y: tangent.y * cosine - point.y * sine,
        z: tangent.z * cosine - point.z * sine
      });
      const curvedTangent = rotateAroundAxis(nextTangent, nextPoint, randomInRange(random, bendRange));
      points.push(nextPoint); tangents.push(curvedTangent); lengths.push(step);
      point = nextPoint; tangent = curvedTangent;
    }
    return { points, tangents, lengths };
  }

  function makeMountainSegment(a, b, width, amplitude, extras = {}) {
    const midpoint = normalizeDirection({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
    const axis = normalizeDirection({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    const side = normalizeDirection(cross3(midpoint, axis));
    const chordHalf = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * .5;
    const halfLength = Math.atan2(chordHalf, Math.sqrt(Math.max(1e-12, 1 - chordHalf * chordHalf)));
    const endBlend = Math.max(.008, width * .68);
    return {
      midpoint, axis, side, inverseWidth: 1 / Math.max(.004, Math.sin(width)),
      alongInner: Math.tan(halfLength),
      alongOuter: Math.tan(halfLength + endBlend),
      shoulderAmplitude: amplitude * .55, spineAmplitude: amplitude * .45,
      width, carve: extras.carve || 0
    };
  }

  function appendPathSegments(target, path, width, amplitude, extras = {}) {
    for (let index = 0; index < path.points.length - 1; index += 1) {
      target.push(makeMountainSegment(path.points[index], path.points[index + 1], width, amplitude, extras));
    }
  }

  function chooseContinentGroup(random, groups) {
    let total = 0;
    for (const group of groups) total += Math.max(.01, group.forms[0].angularRadius ** 2);
    let selection = random() * total;
    for (const group of groups) {
      selection -= Math.max(.01, group.forms[0].angularRadius ** 2);
      if (selection <= 0) return group;
    }
    return groups[groups.length - 1];
  }

  function createMountainSystems(terrainSeed, continentGroups, geology, relief) {
    if (!continentGroups.length) return { shoulders: [], valleys: [] };
    const settings = relief.mountainChains;
    const random = rng((terrainSeed ^ 0x6f4a7c15) >>> 0);
    const activity = clamp(geology, 0, 1);
    const chainCount = clamp(1 + Math.floor(activity * 3) +
      (random() < activity * .55 ? 1 : 0), settings.count[0], settings.count[1]);
    const shoulders = [], valleys = [];
    for (let chainIndex = 0; chainIndex < chainCount; chainIndex += 1) {
      const group = chooseContinentGroup(random, continentGroups);
      const landmass = group.forms[0];
      const anchor = offsetSphereDirection(landmass.direction,
        landmass.angularRadius * randomInRange(random, [.15, .50]), random() * TAU);
      const segmentCount = randomIntegerInRange(random, settings.segmentCount);
      const width = randomInRange(random, settings.width);
      const amplitude = randomInRange(random, settings.amplitude) * (.48 + activity * .92);
      const path = createMountainPath(anchor, tangentAt(anchor, random() * TAU), segmentCount,
        settings.segmentLength, settings.bend, random);
      appendPathSegments(shoulders, path, width, amplitude);

      if (segmentCount > 2 && random() < settings.branchChance * (.35 + activity * .8)) {
        const pointIndex = 1 + Math.floor(random() * (segmentCount - 1));
        const branchStart = path.points[pointIndex];
        const branchAngle = randomInRange(random, settings.branchAngle) * (random() < .5 ? -1 : 1);
        const branchTangent = rotateAroundAxis(path.tangents[pointIndex], branchStart, branchAngle);
        const parentLength = path.lengths.reduce((sum, value) => sum + value, 0);
        const lengthRatio = randomInRange(random, settings.branchLengthRatio);
        const branchSegments = Math.max(2, Math.round(segmentCount * lengthRatio));
        const branchStep = parentLength * lengthRatio / branchSegments;
        const branchPath = createMountainPath(branchStart, branchTangent, branchSegments,
          [branchStep * .78, branchStep * 1.22], settings.bend, random);
        appendPathSegments(shoulders, branchPath,
          width * randomInRange(random, settings.branchWidthRatio),
          amplitude * randomInRange(random, settings.branchHeightRatio));
      }

      const valleyCount = randomIntegerInRange(random, settings.valleyCount);
      const chainLength = path.lengths.reduce((sum, value) => sum + value, 0);
      for (let valleyIndex = 0; valleyIndex < valleyCount; valleyIndex += 1) {
        const pointIndex = 1 + Math.floor(random() * (segmentCount - 1));
        const valleyStart = path.points[pointIndex];
        const valleyAngle = randomInRange(random, settings.valleyAngle) * (random() < .5 ? -1 : 1);
        const valleyTangent = rotateAroundAxis(path.tangents[pointIndex], valleyStart, valleyAngle);
        const lengthRatio = randomInRange(random, settings.valleyLengthRatio);
        const valleySegments = 2 + Math.floor(random() * 2);
        const valleyStep = chainLength * lengthRatio / valleySegments;
        const valleyPath = createMountainPath(valleyStart, valleyTangent, valleySegments,
          [valleyStep * .8, valleyStep * 1.2], settings.bend, random);
        appendPathSegments(valleys, valleyPath, width * randomInRange(random, settings.valleyWidthRatio),
          0, { carve: randomInRange(random, settings.valleyCarve) * (.58 + activity * .62) });
      }
    }
    return { shoulders, valleys };
  }

  function segmentProfile(direction, segment, widthWarp = 1) {
    const center = dot3(direction, segment.midpoint);
    // Keep the anisotropic band on its own local hemisphere; without this
    // gate the same great-circle frame also paints a false antipodal mountain.
    if (center <= .01) return { shoulder: 0, spine: 0, valley: 0 };
    const crossRatio = Math.abs(dot3(direction, segment.side)) * segment.inverseWidth /
      Math.max(.8, widthWarp);
    const along = Math.abs(dot3(direction, segment.axis)) / center;
    const longitudinalEnvelope = 1 - smoothstep(segment.alongInner, segment.alongOuter, along);
    const crossSquared = crossRatio * crossRatio;
    return {
      shoulder: Math.exp(-crossSquared * .55) * longitudinalEnvelope,
      spine: Math.exp(-crossSquared * 3.2) * longitudinalEnvelope,
      valley: Math.exp(-crossSquared * 4.8) * longitudinalEnvelope
    };
  }

  function ruggednessFromElevation(elevation, width, height, seaLevel) {
    const field = new Uint8Array(width * height), uniqueWidth = Math.max(1, width - 1);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const canonicalX = x === width - 1 && width > 1 ? 0 : x;
        const index = y * width + canonicalX;
        if (elevation[index] <= seaLevel) continue;
        let total = 0, count = 0;
        for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          const nx = (canonicalX + ox + uniqueWidth) % uniqueWidth;
          const ny = clamp(y + oy, 0, height - 1);
          total += Math.abs(elevation[index] - elevation[ny * width + nx]);
          count += 1;
        }
        field[y * width + canonicalX] = Math.round(clamp((total / count - 1) / 22, 0, 1) * 255);
      }
    }
    if (height > 1) for (const y of [0, height - 1]) {
      let total = 0;
      for (let x = 0; x < uniqueWidth; x += 1) total += field[y * width + x];
      const polarValue = Math.round(total / uniqueWidth);
      for (let x = 0; x < width; x += 1) field[y * width + x] = polarValue;
    }
    for (let y = 0; y < height; y += 1) field[y * width + width - 1] = field[y * width];
    return field;
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
    const sampleMoisture = fbm3Sampler(terrainSeed ^ 0x19191531, 4);
    const sampleBorders = continentGroups.map(group => fbm3Sampler(group.borderSeed, 3));
    const mountainSystems = createMountainSystems(terrainSeed, continentGroups,
      Number.isFinite(planet?.geology) ? planet.geology : .5, settings.relief);
    const raw = new Float32Array(width * height);
    const elevation = new Uint8Array(width * height);
    const moisture = new Uint8Array(width * height);
    const mountainMask = new Uint8Array(width * height);
    const ridgeField = new Uint8Array(width * height);
    const valleyField = new Uint8Array(width * height);
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
        let shoulderField = 0, spineField = 0, mountainHeight = 0;
        let valleyStrength = 0, valleyCarve = 0;
        const widthWarp = 1 + medium * .15;
        for (const segment of mountainSystems.shoulders) {
          const profile = segmentProfile(direction, segment, widthWarp);
          shoulderField = Math.max(shoulderField, profile.shoulder);
          spineField = Math.max(spineField, profile.spine);
          mountainHeight = Math.max(mountainHeight,
            profile.shoulder * segment.shoulderAmplitude + profile.spine * segment.spineAmplitude);
        }
        for (const segment of mountainSystems.valleys) {
          const profile = segmentProfile(direction, segment, widthWarp);
          valleyStrength = Math.max(valleyStrength, profile.valley);
          valleyCarve = Math.max(valleyCarve, profile.valley * segment.carve);
        }
        const baseTerrain = 88 + continental * 140 + broad * settings.relief.broadAmplitude +
          medium * settings.relief.mediumAmplitude + fine * settings.relief.fineAmplitude;
        const altitude = clamp(baseTerrain + mountainHeight - valleyCarve, 0, 255);
        const index = y * width + x;
        raw[index] = altitude;
        mountainMask[index] = Math.round(clamp(shoulderField, 0, 1) * 255);
        ridgeField[index] = Math.round(clamp(spineField, 0, 1) * 255);
        valleyField[index] = Math.round(clamp(valleyStrength, 0, 1) * 255);
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
      const landCoverage = smoothstep(seaLevel - 1.5, seaLevel + 2.5, elevation[i]);
      mountainMask[i] = Math.round(mountainMask[i] * landCoverage);
      ridgeField[i] = Math.round(ridgeField[i] * landCoverage);
      valleyField[i] = Math.round(valleyField[i] * landCoverage);
    }
    const ruggednessField = ruggednessFromElevation(elevation, width, height, seaLevel);

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
      mountainMask, ridgeField, valleyField, ruggednessField };
  }

  root.OrbitWorld = Object.freeze({
    hashSeed, rng, createGalaxy, createSystem, planetPosition, directionForPixel, createTerrain
  });
})(globalThis);
