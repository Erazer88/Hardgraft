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

  const STAR_CLASSES = [
    { type: 'M', color: '#cb937a', weight: 0.36, size: 0.7 },
    { type: 'K', color: '#dcc498', weight: 0.28, size: 0.85 },
    { type: 'G', color: '#e5dec1', weight: 0.20, size: 1 },
    { type: 'F', color: '#d5e0e3', weight: 0.10, size: 1.12 },
    { type: 'A', color: '#a4c3dd', weight: 0.05, size: 1.25 },
    { type: 'B', color: '#91abc9', weight: 0.01, size: 1.4 }
  ];
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

  const PLANET_TYPES = [
    { kind: 'tellurique', color: '#90a58b' },
    { kind: 'océanique', color: '#6097ad' },
    { kind: 'aride', color: '#bd9c77' },
    { kind: 'glacée', color: '#99b5c6' },
    { kind: 'volcanique', color: '#b9846d' },
    { kind: 'gazeuse', color: '#b4aa92' }
  ];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  function createSystem(seed, systemId, existingGalaxy) {
    const random = rng(hashSeed(String(seed) + ':system:' + systemId));
    const galaxy = existingGalaxy || createGalaxy(seed);
    const galacticSystem = galaxy.systems.find(system => system.id === systemId);
    const name = galacticSystem ? galacticSystem.name : systemName(seed, systemId);
    const stellarClass = galacticSystem ? galacticSystem.stellarClass : starClass(random).type;
    const starDefinition = STAR_CLASSES.find(star => star.type === stellarClass);
    const count = 4 + Math.floor(random() * 4);
    const planets = [];
    const innerOrbit = 205 + random() * 35;
    const outerOrbit = 970 + random() * 120;
    for (let i = 0; i < count; i += 1) {
      const orbit = innerOrbit + (outerOrbit - innerOrbit) * i / (count - 1) +
        (i === 0 || i === count - 1 ? 0 : (random() - 0.5) * 30);
      // The first home world is habitable; other planets vary with radius.
      let typeIndex = Math.floor(random() * PLANET_TYPES.length);
      if (name === 'Néréide' && i === 1) typeIndex = 0;
      if (i === count - 1 && random() > 0.36) typeIndex = 5;
      const type = PLANET_TYPES[typeIndex];
      planets.push({
        id: systemId + ':p-' + i,
        name: name + ' ' + ROMAN[i],
        orbit,
        radius: type.kind === 'gazeuse' ? 19 + random() * 10 : 9 + random() * 8,
        phase: random() * TAU,
        // Radians per game second. Relative periods obey Kepler's third law.
        speed: 0.050 * Math.pow(220 / orbit, 1.5),
        color: type.color, kind: type.kind,
        seed: hashSeed(String(seed) + ':' + systemId + ':terrain:' + i)
      });
    }
    const beltGap = 1 + Math.floor(random() * (count - 2));
    const beltOrbit = (planets[beltGap].orbit + planets[beltGap + 1].orbit) * 0.5;
    return {
      id: systemId, name,
      star: { radius: 48 + random() * 13, color: starDefinition.color, type: stellarClass },
      planets,
      debris: [
        { orbit: beltOrbit, width: 20 + random() * 18, phase: random() * TAU },
        { orbit: outerOrbit + 95, width: 26, phase: random() * TAU }
      ],
      wreck: { orbit: beltOrbit + 38, phase: random() * TAU }
    };
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

  function createTerrain(seed, width = 320, height = 240) {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    const terrainSeed = hashSeed(String(seed) + ':terrain');
    const random = rng(terrainSeed);
    const offsetX = random() * 80 + 8, offsetY = random() * 80 + 8;
    const aspect = width / height;
    const continentCount = 2 + Math.floor(random() * 2);
    const continents = [];
    for (let i = 0; i < continentCount; i += 1) {
      continents.push({
        x: 0.15 + random() * 0.7,
        y: 0.12 + random() * 0.76,
        radiusX: 0.20 + random() * 0.19,
        radiusY: 0.20 + random() * 0.18
      });
    }
    const raw = new Float32Array(width * height);
    const elevation = new Uint8Array(width * height);
    const moisture = new Uint8Array(width * height);
    const histogram = new Uint32Array(256);
    for (let y = 0; y < height; y += 1) {
      const ny = y / Math.max(1, height - 1);
      for (let x = 0; x < width; x += 1) {
        const nx = x / Math.max(1, width - 1);
        const broad = fbm(offsetX + nx * 3.3 * aspect, offsetY + ny * 3.3, terrainSeed, 4);
        const detail = fbm(offsetX + nx * 15 * aspect, offsetY + ny * 15, terrainSeed ^ 0x5a6a4f29, 4);
        let continental = 0;
        for (const continent of continents) {
          const dx = (nx - continent.x) / continent.radiusX;
          const dy = (ny - continent.y) / continent.radiusY;
          continental = Math.max(continental, Math.exp(-(dx * dx + dy * dy) * 0.75));
        }
        const ridge = 1 - Math.abs(fbm(offsetX + nx * 7 * aspect, offsetY + ny * 7, terrainSeed ^ 0x3482f129, 3));
        const ridgeMask = clamp((broad + continental * 0.9 - 0.53) * 2.1, 0, 1);
        const altitude = clamp(52 + continental * 120 + broad * 52 + detail * 16 +
          Math.pow(ridge, 5) * ridgeMask * 80, 0, 255);
        const index = y * width + x;
        raw[index] = altitude;
        histogram[Math.round(altitude)] += 1;
        moisture[index] = Math.round(clamp(0.52 + fbm(offsetX + nx * 6 * aspect,
          offsetY + ny * 6, terrainSeed ^ 0x19191531, 4) * 0.7 -
          ridgeMask * 0.12, 0, 1) * 255);
      }
    }

    // Vary the ocean coverage while retaining usable land for every map.
    const targetWater = raw.length * (0.30 + random() * 0.16);
    let cumulative = 0, rawSeaLevel = 0;
    for (; rawSeaLevel < 255; rawSeaLevel += 1) {
      cumulative += histogram[rawSeaLevel];
      if (cumulative >= targetWater) break;
    }
    const seaLevel = 102;
    for (let i = 0; i < raw.length; i += 1) {
      elevation[i] = Math.round(clamp(raw[i] + seaLevel - rawSeaLevel, 0, 255));
    }

    const resources = [];
    const resourceTypes = ['fer', 'cuivre', 'silice', 'cristal'];
    let attempts = 0;
    const requestedResources = Math.max(4, Math.min(24, Math.floor(raw.length / 4500)));
    while (resources.length < requestedResources && attempts < 500) {
      attempts += 1;
      const x = Math.floor(random() * width), y = Math.floor(random() * height);
      const altitude = elevation[y * width + x];
      if (altitude <= seaLevel + 10) continue;
      if (resources.some(resource => Math.hypot(resource.x - x, resource.y - y) < Math.min(width, height) * 0.09)) continue;
      resources.push({ type: resourceTypes[Math.floor(random() * resourceTypes.length)], x, y });
    }
    return { width, height, elevation, moisture, seaLevel, resources };
  }

  root.OrbitWorld = Object.freeze({
    hashSeed, rng, createGalaxy, createSystem, planetPosition, createTerrain
  });
})(globalThis);
