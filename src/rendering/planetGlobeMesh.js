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

  function terrainColor(x, y, terrain, planet) {
    const elevation = Projection.sampleElevation(x, y, terrain), sea = terrain.seaLevel;
    const palette = paletteFor(planet);
    if (elevation <= sea) {
      const depth = clamp((sea - elevation) / 58, 0, 1);
      return blend(rgb(palette.ocean), rgb(palette.deepOcean), smoothstep(.04, .86, depth));
    }
    const landHeight = clamp((elevation - sea) / Math.max(1, 255 - sea), 0, 1);
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
    return blend(relief, rgb(palette.snow), snowCover);
  }

  function create(terrain, planet, segments = Style.mesh) {
    const longitudeSegments = Math.max(8, Math.floor(segments.longitudeSegments));
    const latitudeSegments = Math.max(4, Math.floor(segments.latitudeSegments));
    const columns = longitudeSegments + 1, rows = latitudeSegments + 1;
    const vertexCount = columns * rows;
    if (vertexCount > 65535) throw new RangeError('Globe mesh exceeds 16-bit index capacity');
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const indices = new Uint16Array(longitudeSegments * latitudeSegments * 6);
    const northPole = Projection.poleSurfacePosition(terrain, true, Style.relief);
    const southPole = Projection.poleSurfacePosition(terrain, false, Style.relief);
    function poleColor(row) {
      const color = [0, 0, 0], y = row === 0 ? 0 : terrain.height - 1;
      for (let x = 0; x < terrain.width; x += Math.max(1, Math.floor(terrain.width / 96))) {
        const sample = terrainColor(x, y, terrain, planet);
        color[0] += sample[0]; color[1] += sample[1]; color[2] += sample[2];
      }
      const samples = Math.ceil(terrain.width / Math.max(1, Math.floor(terrain.width / 96)));
      return color.map(channel => channel / samples);
    }
    const northColor = poleColor(0), southColor = poleColor(terrain.height - 1);
    let vertex = 0;
    for (let row = 0; row < rows; row += 1) {
      const y = row / latitudeSegments * (terrain.height - 1);
      for (let column = 0; column < columns; column += 1) {
        const x = column / longitudeSegments * (terrain.width - 1);
        const isNorthPole = row === 0, isSouthPole = row === latitudeSegments;
        const point = isNorthPole ? northPole : isSouthPole ? southPole :
          Projection.surfacePosition(x, y, terrain, Style.relief);
        positions[vertex * 3] = point.x; positions[vertex * 3 + 1] = point.y; positions[vertex * 3 + 2] = point.z;
        const color = isNorthPole ? northColor : isSouthPole ? southColor : terrainColor(x, y, terrain, planet);
        colors[vertex * 3] = color[0] / 255; colors[vertex * 3 + 1] = color[1] / 255; colors[vertex * 3 + 2] = color[2] / 255;
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
      for (const target of [ia, ib, ic]) {
        normals[target] += nx; normals[target + 1] += ny; normals[target + 2] += nz;
      }
    }
    for (let i = 0; i < vertexCount; i += 1) {
      const offset = i * 3, px = positions[offset], py = positions[offset + 1], pz = positions[offset + 2];
      let nx = normals[offset], ny = normals[offset + 1], nz = normals[offset + 2];
      if (nx * px + ny * py + nz * pz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      let length = Math.hypot(nx, ny, nz);
      if (length < 1e-9) { nx = px; ny = py; nz = pz; length = Math.hypot(px, py, pz) || 1; }
      normals[offset] = nx / length; normals[offset + 1] = ny / length; normals[offset + 2] = nz / length;
    }
    return Object.freeze({ positions, normals, colors, indices, vertexCount,
      longitudeSegments, latitudeSegments, terrain, planetId: planet?.id || null });
  }

  root.OrbitPlanetGlobeMesh = Object.freeze({ create, terrainColor });
})(globalThis);
