(function (root) {
  'use strict';

  const GROUP_SIZE = 3;
  const GROUP_COUNT = 3;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const ease = value => value * value * (3 - 2 * value);
  const transition = (value, start, end) => ease(clamp((value - start) / (end - start), 0, 1));

  function createWaterDistanceField(terrain) {
    const { width, height, elevation, seaLevel } = terrain;
    const far = width + height;
    const distance = new Float32Array(width * height);
    for (let i = 0; i < distance.length; i += 1) distance[i] = elevation[i] > seaLevel ? 0 : far;
    const diagonal = Math.SQRT2;
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

  function createPackedMasks(planet, terrain, coastDistance = createWaterDistanceField(terrain)) {
    const { width, height, elevation, moisture, seaLevel } = terrain;
    const masks = Array.from({ length: GROUP_COUNT }, () => new Uint8Array(width * height * GROUP_SIZE));
    const climate = root.OrbitSurfaceStyle.climate;
    const averageTemperature = Number.isFinite(planet.temperature) ? planet.temperature : 18;
    const frozenWorld = planet.kind === 'glacée';
    const aridWorld = planet.kind === 'aride';
    const volcanicWorld = planet.kind === 'volcanique';
    const snowlineStart = climate.snowlineStartTemperature;
    const vegetationMin = climate.vegetationTemperatureRange[0];
    const vegetationMax = climate.vegetationTemperatureRange[1];

    for (let i = 0; i < elevation.length; i += 1) {
      const value = elevation[i], aboveSea = value - seaLevel;
      const localTemperature = averageTemperature - Math.max(0, aboveSea) *
        root.OrbitSurfaceStyle.terrain.temperatureLapsePerElevation;
      const snow = clamp((snowlineStart - localTemperature + 2) / 14, 0, 1);
      const humidity = moisture[i] / 255;
      const vegetation = clamp((localTemperature - vegetationMin) / 13, 0, 1) *
        clamp((vegetationMax - localTemperature) / 18, 0, 1);
      const plain = transition(aboveSea, 3, 24) * (1 - transition(aboveSea, 84, 142));
      const offset = i * GROUP_SIZE;
      let lowlands = 0, wetlands = 0, arid = 0, beach = 0, alpine = 0, frozen = 0;
      let volcanic = 0, ocean = 0, shelf = 0;

      if (value <= seaLevel) {
        ocean = transition(seaLevel - value, 34, 78) * .88;
        const shallow = 1 - transition(seaLevel - value, 8, 52);
        const nearCoast = 1 - transition(coastDistance[i], 3, 30);
        const warmWater = clamp((averageTemperature + 12) / 42, 0, 1);
        shelf = shallow * (.22 + nearCoast * .78) * warmWater;
      } else {
        beach = (1 - transition(aboveSea, 1, 11)) * (1 - transition(snow, .08, .58));
        const forestMoisture = clamp((humidity - .18) / .55, 0, 1) *
          (1 - transition(humidity, .68, .92));
        lowlands = plain * forestMoisture * vegetation;
        wetlands = plain * clamp((humidity - .57) / .43, 0, 1) * vegetation;
        const dryness = clamp((.63 - humidity) * 2.5, 0, 1);
        const heat = clamp((localTemperature - 8) / 42, 0, 1);
        arid = plain * (aridWorld ? .96 : dryness * (.35 + heat * .65)) * (1 - snow);
        alpine = volcanicWorld ? 0 : transition(aboveSea, 52, 108) * (1 - transition(snow, .28, .7));
        frozen = frozenWorld ? Math.max(snow, .74) : snow;
        volcanic = volcanicWorld ? 1 : 0;
      }

      masks[0][offset] = Math.round(clamp(lowlands, 0, 1) * 255);
      masks[0][offset + 1] = Math.round(clamp(wetlands, 0, 1) * 255);
      masks[0][offset + 2] = Math.round(clamp(arid, 0, 1) * 255);
      masks[1][offset] = Math.round(clamp(beach, 0, 1) * 255);
      masks[1][offset + 1] = Math.round(clamp(alpine, 0, 1) * 255);
      masks[1][offset + 2] = Math.round(clamp(frozen, 0, 1) * 255);
      masks[2][offset] = Math.round(clamp(volcanic, 0, 1) * 255);
      masks[2][offset + 1] = Math.round(clamp(ocean, 0, 1) * 255);
      masks[2][offset + 2] = Math.round(clamp(shelf, 0, 1) * 255);
    }
    return masks;
  }

  root.OrbitSurfaceMaterialMasks = Object.freeze({ createWaterDistanceField, createPackedMasks });
})(globalThis);
