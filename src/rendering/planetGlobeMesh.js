(function (root) {
  'use strict';

  const Projection = root.OrbitPlanetGlobeProjection;
  const Style = root.OrbitPlanetGlobeStyle;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function rgb(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function blend(a, b, amount) {
    const t = clamp(amount, 0, 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  const smoothstep = (a, b, value) => {
    const t = clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function paletteFor(planet) {
    if (planet?.kind === 'glacée' || (Number.isFinite(planet?.temperature) && planet.temperature < -15)) return Style.colors.frozen;
    if (planet?.kind === 'aride' || (Number.isFinite(planet?.temperature) && planet.temperature > 48)) return Style.colors.arid;
    if (planet?.kind === 'volcanique') return Style.colors.volcanic;
    return Style.colors.temperate;
  }

  function terrainColorComponents(x, y, terrain, planet) {
    const elevation = Projection.sampleElevation(x, y, terrain), sea = terrain.seaLevel;
    const palette = paletteFor(planet);
    const landHeight = clamp((elevation - sea) / Math.max(1, 255 - sea), 0, 1);
    const depth = clamp((sea - elevation) / 58, 0, 1);
    const ocean = blend(rgb(palette.ocean), rgb(palette.deepOcean), smoothstep(.04, .86, depth));
    const moisture = Projection.sampleField(terrain.moisture, x, y, terrain) / 255;
    const latitude = Math.abs(.5 - y / Math.max(1, terrain.height - 1)) * Math.PI;
    const baseTemperature = Number.isFinite(planet?.temperature) ? planet.temperature : 16;
    const temperature = baseTemperature - Math.sin(latitude) * 12 - (elevation - sea) * .06;
    const dry = clamp((.48 - moisture) * 1.8 + Math.max(0, baseTemperature - 28) / 145, 0, .68);

    const shore = rgb(palette.shore), lowland = blend(rgb(palette.lowland), rgb(palette.dry), dry);
    const low = blend(shore, lowland, smoothstep(.005, .075, landHeight));
    const upland = blend(rgb(palette.upland), rgb(palette.dry), dry * .36);
    const rising = blend(low, upland, smoothstep(.1, .38, landHeight));
    const high = blend(upland, rgb(palette.highland), smoothstep(.3, .62, landHeight));
    const relief = blend(rising, high, smoothstep(.24, .52, landHeight));
    const coldness = clamp((10 - temperature) / 46, 0, .7);
    const mountainSnow = smoothstep(.58, .92, landHeight) * .48;
    const snowCover = clamp(coldness * .62 + mountainSnow + (moisture > .3 ? .07 : 0), 0, .84);
    const land = blend(relief, rgb(palette.snow), snowCover);
    return { ocean, land };
  }

  function terrainColor(x, y, terrain, planet) {
    const colors = terrainColorComponents(x, y, terrain, planet);
    const elevation = Projection.sampleElevation(x, y, terrain);
    return blend(colors.ocean, colors.land, smoothstep(terrain.seaLevel - 1.4, terrain.seaLevel + 2.8, elevation));
  }

  function create(terrain, planet, segments = Style.mesh) {
    const longitudeSegments = Math.max(8, Math.floor(segments.longitudeSegments));
    const latitudeSegments = Math.max(4, Math.floor(segments.latitudeSegments));
    const columns = longitudeSegments + 1, rows = latitudeSegments + 1;
    const vertexCount = columns * rows;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const oceanColors = new Float32Array(vertexCount * 3);
    const elevations = new Float32Array(vertexCount);
    const indices = vertexCount <= 65535
      ? new Uint16Array(longitudeSegments * latitudeSegments * 6)
      : new Uint32Array(longitudeSegments * latitudeSegments * 6);
    const northPole = Projection.poleSurfacePosition(terrain, true, Style.relief);
    const southPole = Projection.poleSurfacePosition(terrain, false, Style.relief);
    const northColors = terrainColorComponents((terrain.width - 1) / 2, 0, terrain, planet);
    const southColors = terrainColorComponents((terrain.width - 1) / 2, terrain.height - 1, terrain, planet);
    let vertex = 0;
    for (let row = 0; row < rows; row += 1) {
      const y = row / latitudeSegments * (terrain.height - 1);
      for (let column = 0; column < columns; column += 1) {
        const x = column / longitudeSegments * (terrain.width - 1);
        const isNorthPole = row === 0, isSouthPole = row === latitudeSegments;
        const point = isNorthPole ? northPole : isSouthPole ? southPole :
          Projection.surfacePosition(x, y, terrain, Style.relief);
        positions[vertex * 3] = point.x; positions[vertex * 3 + 1] = point.y; positions[vertex * 3 + 2] = point.z;
        const components = isNorthPole ? northColors : isSouthPole ? southColors : terrainColorComponents(x, y, terrain, planet);
        colors[vertex * 3] = components.land[0] / 255;
        colors[vertex * 3 + 1] = components.land[1] / 255;
        colors[vertex * 3 + 2] = components.land[2] / 255;
        oceanColors[vertex * 3] = components.ocean[0] / 255;
        oceanColors[vertex * 3 + 1] = components.ocean[1] / 255;
        oceanColors[vertex * 3 + 2] = components.ocean[2] / 255;
        elevations[vertex] = Projection.sampleElevation(x, y, terrain);
        vertex += 1;
      }
    }

    let index = 0;
    for (let row = 0; row < latitudeSegments; row += 1) {
      for (let column = 0; column < longitudeSegments; column += 1) {
        const a = row * columns + column, b = a + 1, c = a + columns, d = c + 1;
        indices[index++] = a; indices[index++] = b; indices[index++] = c;
        indices[index++] = b; indices[index++] = d; indices[index++] = c;
      }
    }

    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
      const abx = positions[ib] - positions[ia], aby = positions[ib + 1] - positions[ia + 1], abz = positions[ib + 2] - positions[ia + 2];
      const acx = positions[ic] - positions[ia], acy = positions[ic + 1] - positions[ia + 1], acz = positions[ic + 2] - positions[ia + 2];
      const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
      normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
      normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
    }
    for (let i = 0; i < vertexCount; i += 1) {
      const offset = i * 3, px = positions[offset], py = positions[offset + 1], pz = positions[offset + 2];
      let nx = normals[offset], ny = normals[offset + 1], nz = normals[offset + 2];
      if (nx * px + ny * py + nz * pz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      let length = Math.hypot(nx, ny, nz);
      if (length < 1e-9) { nx = px; ny = py; nz = pz; length = Math.hypot(px, py, pz) || 1; }
      normals[offset] = nx / length; normals[offset + 1] = ny / length; normals[offset + 2] = nz / length;
    }
    return Object.freeze({ positions, normals, colors, oceanColors, elevations, indices, vertexCount,
      longitudeSegments, latitudeSegments, terrain, planetId: planet?.id || null });
  }

  root.OrbitPlanetGlobeMesh = Object.freeze({ create, terrainColor, terrainColorComponents });
})(globalThis);
