(function (root) {
  'use strict';

  // The data network (1 unit = 1 Mo):
  //   building at work → relay antenna in range → (road) datacenter
  //   → (road) high-frequency antenna → the Ark, where each analysis becomes
  //   a technology point;
  //   on a planet without datacenter: relay antenna → (road) high-frequency
  //   antenna → high-frequency antenna of a planet with one → (road) datacenter.
  // Values are first drafts.
  const network = {
    // What a building at work sends, per second. A lab sends planetary data,
    // more on extreme worlds (by planet kind).
    sources: {
      extractor: { resourceId: 'geo_data', mbPerSecond: 1 },
      factory: { resourceId: 'industrial_data', mbPerSecond: 1 },
      lab: { resourceId: 'planetary_data', mbPerSecond: 1, alwaysActive: true,
        byPlanetKind: { tellurique: 1, aride: 1, océanique: 1.5, glacée: 1.5, volcanique: 2, gazeuse: 3 } }
    },
    // A relay antenna gathers the buildings within its range and passes data
    // to the next relay within linkRangeKm, down a chain to the datacenter;
    // it carries at most its bandwidth (Mo/s), relayed data included. Every
    // radio link needs a line of sight over the relief: from the top of its
    // mast (mastHeightM) to the top of a building (buildingHeightM) or of
    // another mast; behind a hill, no network.
    antenna: { rangeKm: 300, linkRangeKm: 300, bandwidthMbPerSecond: 4, mastHeightM: 80, buildingHeightM: 15 },
    // Relief read for lines of sight: metres per elevation level (as the
    // ground readout), and the sampling step along a line, in cells.
    relief: { metersPerLevel: 35, sampleCells: .5 },
    // A high-frequency antenna sends a packet every dispatch interval (5 s of
    // its bandwidth at once), holding at most queueMb. Packets fly 3× faster than
    // interplanetary freight; the star between both ends cuts the link
    // (solar conjunction): within conjunctionStarRadii star radii of the line.
    highFrequency: { bandwidthMbPerSecond: 4, queueMb: 400, dispatchIntervalSeconds: 5,
      speedOverFreight: 3, conjunctionStarRadii: 4 },
    // Data waiting at a datacenter, per kind; what arrives beyond is lost.
    // Its uplink cards hold at most uplinkMb for the high-frequency antenna.
    datacenter: { bufferMb: 200, uplinkMb: 20 },
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

  // Data a source sends per second (a lab's depends on its planet's kind).
  function sourceRate(spec, building) {
    return spec.byPlanetKind?.[building.siteKind] ?? spec.mbPerSecond;
  }

  root.OrbitDataNetworkData = freeze({ ...network, siteTemperature, coolingFactor, sourceRate });
})(globalThis);
