(function (root) {
  'use strict';

  // The data network: buildings at work send data (1 unit = 1 Mo) to the
  // nearest dish in range; each dish beams what its bandwidth allows to the
  // nearest datacenter of its planet, which turns data into technology
  // points. Values are first drafts.
  const network = {
    // What a building at work sends, per second.
    sources: {
      extractor: { resourceId: 'geo_data', mbPerSecond: 1 },
      factory: { resourceId: 'industrial_data', mbPerSecond: 1 }
    },
    // A dish gathers the buildings within its range and carries at most its
    // bandwidth (Mo/s), shared between them.
    antenna: { rangeKm: 300, bandwidthMbPerSecond: 4 },
    // Data waiting at a datacenter, per kind; what arrives beyond is lost.
    datacenter: { bufferMb: 200 },
    // Local temperature at a site: the planet's mean, warmer at the equator,
    // colder toward the poles and with altitude. A datacenter's cards draw
    // their power times a cooling factor that grows with it.
    climate: {
      equatorWarmingC: 12, coolingPerLatitudeDegreeC: .45, lapseRateCPerKm: 6.5,
      cooling: { referenceC: 0, perDegree: .02, min: .6, max: 2.5 }
    }
  };

  // Temperature (°C) at a latitude (degrees) and altitude (m) of a planet.
  function siteTemperature(planetTemperatureC, latitude, altitudeM) {
    const climate = network.climate;
    return planetTemperatureC + climate.equatorWarmingC - climate.coolingPerLatitudeDegreeC * Math.abs(latitude) -
      climate.lapseRateCPerKm * Math.max(0, altitudeM) / 1000;
  }

  // Power factor of a datacenter's cards at a temperature (1 at the reference).
  function coolingFactor(temperatureC) {
    const cooling = network.climate.cooling;
    if (!Number.isFinite(temperatureC)) return 1;
    return Math.max(cooling.min, Math.min(cooling.max, 1 + (temperatureC - cooling.referenceC) * cooling.perDegree));
  }

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }

  root.OrbitDataNetworkData = freeze({ ...network, siteTemperature, coolingFactor });
})(globalThis);
