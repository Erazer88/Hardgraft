(function (root) {
  'use strict';
  const World = root.OrbitWorld;
  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const range = (random, limits) => limits[0] + random() * (limits[1] - limits[0]);
  function weightedIndex(random, weights) {
    let value = random() * weights.reduce((sum, weight) => sum + weight, 0);
    for (let i = 0; i < weights.length; i++) { value -= weights[i]; if (value < 0) return i; }
    return weights.length - 1;
  }
  function roman(number) {
    let text = '';
    for (const [value, symbol] of [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) {
      while (number >= value) { text += symbol; number -= value; }
    }
    return text;
  }

  // Pure approximation, not a climate simulator. At fixed atmosphere, flux
  // increases with stellar luminosity and decreases with distance squared.
  function environment(star, distanceAU, traits, settings = root.OrbitWorldgenData) {
    const flux = star.luminosity / (distanceAU * distanceAU);
    const temperature = settings.planets.equilibriumKelvin * Math.pow(flux, .25) - 273.15 +
      settings.planets.greenhouse * Math.log2(1 + traits.pressure);
    const liquidFraction = clamp((temperature + 25) / 40, 0, 1) * clamp((110 - temperature) / 55, 0, 1);
    const surfaceWater = Math.min(settings.planets.maxSurfaceWater, traits.water * liquidFraction * clamp(traits.pressure / .3, 0, 1));
    const habitability = clamp(1 - Math.abs(temperature - 16) / 70, 0, 1) *
      clamp(1 - Math.abs(Math.log2(Math.max(.001, traits.pressure))) / 4, 0, 1) *
      clamp(traits.water * 3, 0, 1) * clamp(1 - Math.abs(traits.gravity - 1) / 2, 0, 1);
    return { ...traits, temperature, surfaceWater, habitability,
      atmosphere: traits.pressure < .08 ? 'ténue' : traits.pressure > 2.5 ? 'dense' : 'modérée' };
  }

  function create(seed, systemId, galaxy, settings = root.OrbitWorldgenData) {
    const random = World.rng(World.hashSeed(String(seed) + ':system-v2:' + systemId));
    const source = galaxy.systems.find(system => system.id === systemId);
    if (!source) throw new RangeError('Unknown system: ' + systemId);
    const natal = source.id === galaxy.homeId;
    const definition = settings.stars.find(star => star.type === source.stellarClass);
    const star = { type: definition.type, color: definition.color,
      radius: (48 + random() * 13) * definition.size,
      mass: definition.mass, luminosity: definition.luminosity,
      habitableZone: { inner: Math.sqrt(definition.luminosity / 1.4), outer: Math.sqrt(definition.luminosity / .55) } };
    const count = natal ? settings.home.minPlanets + Math.floor(random() * (settings.home.maxPlanets - settings.home.minPlanets + 1)) :
      weightedIndex(random, settings.planetCounts);
    const layout = settings.layouts[weightedIndex(random, settings.layouts.map(item => item.weight))];
    const inner = range(random, count === 1 ? settings.orbits.single : settings.orbits.inner);
    const outer = Math.max(range(random, layout.outer), inner + settings.orbits.minGap * Math.max(0, count - 1));
    const gaps = Array.from({ length: Math.max(0, count - 1) }, () => .5 + random() * layout.gapVariation);
    const gapSum = gaps.reduce((sum, gap) => sum + gap, 0);
    const spare = outer - inner - gaps.length * settings.orbits.minGap;
    const orbits = count ? [inner] : [];
    for (const gap of gaps) orbits.push(orbits.at(-1) + settings.orbits.minGap + spare * gap / gapSum);
    // Physical AU and drawable units are proportional within each system.
    // This keeps relative Kepler periods and readable distances on a phone.
    const habitableOrbit = natal ? orbits[settings.home.candidateIndex] : range(random, settings.orbits.habitableOrbit);
    const auPerUnit = Math.sqrt(star.luminosity) / habitableOrbit;
    const planets = orbits.map((orbit, i) => {
      const candidate = natal && i === settings.home.candidateIndex;
      const distanceAU = orbit * auPerUnit;
      const coldness = clamp((orbit / habitableOrbit - 1) / 2, 0, 1);
      const gasProbability = settings.planets.gasChance[0] + coldness * (settings.planets.gasChance[1] - settings.planets.gasChance[0]);
      const gas = !candidate && ((natal && i === count - 1) || random() < gasProbability);
      const pressure = candidate ? range(random, settings.home.pressure) :
        Math.exp(range(random, settings.planets.pressure.map(Math.log)));
      const rawWater = range(random, candidate ? settings.home.water : settings.planets.water);
      const waterRange = settings.planets.water[1] - settings.planets.water[0];
      const oceanBias = candidate || waterRange <= 0 ? rawWater : settings.planets.water[0] +
        Math.pow(clamp((rawWater - settings.planets.water[0]) / waterRange, 0, 1),
          settings.planets.oceanCoverageExponent) * waterRange;
      const traits = {
        pressure,
        water: candidate ? oceanBias : clamp(oceanBias + coldness * settings.planets.iceBonus, 0, .95),
        gravity: range(random, candidate ? settings.home.gravity : settings.planets.gravity),
        geology: candidate ? range(random, settings.home.geology) : random()
      };
      const climate = environment(star, distanceAU, traits, settings);
      const iceCoverage = clamp((settings.terrain.frozenWaterStartTemperature - climate.temperature) /
        (settings.terrain.frozenWaterStartTemperature - settings.terrain.frozenWaterFullTemperature), 0, 1);
      const terrainWater = gas ? 0 : Math.max(climate.surfaceWater,
        traits.water * iceCoverage * settings.terrain.frozenWaterRetention);
      const kind = gas ? 'gazeuse' : climate.temperature < -35 ? 'glacée' :
        climate.temperature > 180 && traits.geology > .65 ? 'volcanique' :
          climate.surfaceWater > .65 ? 'océanique' :
            climate.surfaceWater < .08 || climate.temperature > 80 ? 'aride' : 'tellurique';
      const resources = { water: traits.water };
      for (const deposit of settings.deposits) {
        const abundance = .1 + random() * (.45 + traits.geology * .45);
        resources[deposit.id] = candidate ? Math.max(settings.home.minResource, abundance) : abundance;
      }
      return { id: systemId + ':p-' + i, name: source.name + ' ' + roman(i + 1),
        orbit, distanceAU, radius: range(random, gas ? settings.planets.gasRadius : settings.planets.solidRadius),
        phase: random() * TAU, speed: .05 * Math.sqrt(star.mass) * Math.pow(220 / orbit, 1.5),
        kind, color: settings.colors[kind], ...climate,
        surfaceWater: gas ? 0 : climate.surfaceWater, habitability: gas ? 0 : climate.habitability,
        terrainWater,
        resources, startingCandidate: candidate,
        seed: World.hashSeed(String(seed) + ':' + systemId + ':terrain:' + i) };
    });

    let beltCount = weightedIndex(random, settings.beltCounts);
    if (natal) beltCount = Math.max(settings.home.minBelts, beltCount);
    const beltSlots = [];
    for (let i = 1; i < planets.length; i++) {
      const left = planets[i - 1], right = planets[i];
      const start = left.orbit + left.radius + settings.belts.clearance;
      const end = right.orbit - right.radius - settings.belts.clearance;
      if (end - start >= settings.belts.width[0] * 2) beltSlots.push({ orbit: (start + end) / 2, maxWidth: (end - start) / 2 });
    }
    const lastOrbit = planets.at(-1)?.orbit || settings.orbits.emptyExtent * .5;
    for (let i = 1; i <= beltCount; i++) beltSlots.push({ orbit: lastOrbit + i * settings.belts.outerGap, maxWidth: settings.belts.width[1] });
    const debris = [];
    while (debris.length < beltCount) {
      const slot = beltSlots.splice(Math.floor(random() * beltSlots.length), 1)[0];
      debris.push({ orbit: slot.orbit, width: Math.min(slot.maxWidth, range(random, settings.belts.width)), phase: random() * TAU });
    }
    debris.sort((a, b) => a.orbit - b.orbit);
    const wreck = natal || random() < settings.wreckChance ?
      { orbit: (debris[0]?.orbit || Math.max(inner, settings.orbits.emptyExtent)) + 38, phase: random() * TAU } : null;
    const extent = Math.max(settings.orbits.emptyExtent, star.radius,
      ...planets.map(planet => planet.orbit + planet.radius), ...debris.map(belt => belt.orbit + belt.width), wreck?.orbit || 0) + settings.orbits.edgePadding;
    return { id: systemId, name: source.name, generationVersion: settings.version, layout: layout.id,
      star, planets, debris, wreck, extent, auPerUnit,
      startingPlanetId: planets.find(planet => planet.startingCandidate)?.id || null };
  }
  root.OrbitSystemGeneration = Object.freeze({ create, environment });
})(globalThis);
