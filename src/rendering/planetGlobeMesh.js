(function (root) {
  'use strict';

  const Projection = root.OrbitPlanetGlobeProjection;
  const Style = root.OrbitPlanetGlobeStyle;

  function create(terrain, planet, segments = Style.mesh, relief = Style.relief) {
    const longitudeSegments = Math.max(8, Math.floor(segments.longitudeSegments));
    const latitudeSegments = Math.max(4, Math.floor(segments.latitudeSegments));
    const columns = longitudeSegments + 1, rows = latitudeSegments + 1;
    const vertexCount = columns * rows;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const elevations = new Float32Array(vertexCount);
    const reliefRange = Projection.visualReliefRange(terrain, relief);
    const indices = vertexCount <= 65535
      ? new Uint16Array(longitudeSegments * latitudeSegments * 6)
      : new Uint32Array(longitudeSegments * latitudeSegments * 6);
    const northPole = Projection.poleSurfacePosition(terrain, true, relief);
    const southPole = Projection.poleSurfacePosition(terrain, false, relief);
    let vertex = 0;
    for (let row = 0; row < rows; row += 1) {
      const y = row / latitudeSegments * (terrain.height - 1);
      for (let column = 0; column < columns; column += 1) {
        const x = column / longitudeSegments * (terrain.width - 1);
        const isNorthPole = row === 0, isSouthPole = row === latitudeSegments;
        const point = isNorthPole ? northPole : isSouthPole ? southPole :
          Projection.surfacePosition(x, y, terrain, relief);
        positions[vertex * 3] = point.x; positions[vertex * 3 + 1] = point.y; positions[vertex * 3 + 2] = point.z;
        uvs[vertex * 2] = column / longitudeSegments;
        uvs[vertex * 2 + 1] = row / latitudeSegments;
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
    return Object.freeze({ positions, normals, uvs, elevations, indices, vertexCount, reliefRange,
      longitudeSegments, latitudeSegments, terrain, planet, planetId: planet?.id || null });
  }

  root.OrbitPlanetGlobeMesh = Object.freeze({ create });
})(globalThis);
