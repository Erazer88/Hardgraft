(function (root) {
  'use strict';

  // Wind turbines. A site catches wind on wide plains and high plateaus:
  // open ground (little relief around it), more so up high; broken ground
  // catches almost none, and the output grows slowly until the ground is
  // really open. A turbine in the wake of others (closer than
  // wakeRadiusKm) catches less: its efficiency falls with each neighbour, the
  // more the closer, so ten turbines on one spot give little more than a few.
  // Output = windPowerMW × site factor × wake efficiency. No DOM.
  const settings = () => root.OrbitProcessData?.config.wind;
  const scaleKm = () => root.OrbitConfig?.terrain?.textureScale || 1;
  const metersPerLevel = () => root.OrbitDataNetworkData?.relief?.metersPerLevel || 35;

  // Site factor of every cell of a terrain (0 on water), computed once per
  // terrain with summed-area tables: the relief's spread around each cell
  // (standard deviation of the land within siteRadiusKm; the sea is open, it
  // does not count as broken ground) and its altitude.
  const grids = new WeakMap();
  function siteGrid(terrain) {
    if (grids.has(terrain)) return grids.get(terrain);
    const wind = settings(), { width, height, seaLevel, elevation } = terrain, relief = terrain.relief || elevation;
    const ground = new Float64Array(width * height), water = new Uint8Array(width * height);
    for (let cell = 0; cell < ground.length; cell++) {
      ground[cell] = Math.max(0, relief[cell] - seaLevel) * metersPerLevel();
      water[cell] = elevation[cell] <= seaLevel ? 1 : 0;
    }
    // Summed-area tables of the land cells, their ground and its square,
    // (width+1)×(height+1).
    const stride = width + 1, size = stride * (height + 1);
    const lands = new Float64Array(size), sum = new Float64Array(size), squares = new Float64Array(size);
    for (let y = 0; y < height; y++) {
      let rowLand = 0, row = 0, rowSquares = 0;
      for (let x = 0; x < width; x++) {
        const cell = y * width + x, land = water[cell] ? 0 : 1, value = land ? ground[cell] : 0;
        rowLand += land; row += value; rowSquares += value * value;
        const at = (y + 1) * stride + x + 1, above = y * stride + x + 1;
        lands[at] = lands[above] + rowLand; sum[at] = sum[above] + row; squares[at] = squares[above] + rowSquares;
      }
    }
    const radius = Math.max(1, Math.round(wind.siteRadiusKm / scaleKm())), factors = new Float32Array(width * height);
    const area = (table, x0, y0, x1, y1) => table[y1 * stride + x1] - table[y0 * stride + x1] - table[y1 * stride + x0] + table[y0 * stride + x0];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      if (water[cell]) continue;
      const x0 = Math.max(0, x - radius), y0 = Math.max(0, y - radius), x1 = Math.min(width, x + radius + 1), y1 = Math.min(height, y + radius + 1);
      const count = Math.max(1, area(lands, x0, y0, x1, y1)), mean = area(sum, x0, y0, x1, y1) / count;
      const spread = Math.sqrt(Math.max(0, area(squares, x0, y0, x1, y1) / count - mean * mean));
      const openness = Math.max(0, 1 - spread / wind.roughnessScaleM);
      const quality = openness * (1 + wind.altitudeBoost * Math.min(1, ground[cell] / wind.altitudeFullM));
      const share = Math.max(0, Math.min(1, (quality - wind.calmBelow) / (wind.fullAt - wind.calmBelow)));
      factors[cell] = Math.max(wind.minSite, wind.maxSite * share ** wind.curve);
    }
    grids.set(terrain, factors);
    return factors;
  }

  // Site factor at a world point (1 without terrain).
  function siteFactor(terrain, point) {
    if (!terrain?.elevation || !settings()) return 1;
    const scale = scaleKm();
    const x = Math.max(0, Math.min(terrain.width - 1, Math.floor(point.x / scale)));
    const y = Math.max(0, Math.min(terrain.height - 1, Math.floor(point.y / scale)));
    return siteGrid(terrain)[y * terrain.width + x] || settings().minSite;
  }

  // Share of its wind a turbine keeps among `turbines` (itself skipped).
  function wakeEfficiency(turbine, turbines) {
    const wind = settings();
    if (!wind) return 1;
    let shadow = 0;
    for (const other of turbines) {
      if (other === turbine || other.id === turbine.id || other.planetId !== turbine.planetId) continue;
      const distance = Math.hypot(other.x - turbine.x, other.y - turbine.y);
      if (distance < wind.wakeRadiusKm) shadow += 1 - distance / wind.wakeRadiusKm;
    }
    return 1 / (1 + wind.wakeLoss * shadow);
  }

  // Megawatts a turbine gives, its site and the others of its planet counted.
  function outputMW(turbine, turbines) {
    const site = Number.isFinite(turbine.windSite) ? turbine.windSite : 1;
    return (root.OrbitProcessData?.config.windPowerMW || 0) * site * wakeEfficiency(turbine, turbines);
  }

  root.OrbitWindPower = Object.freeze({ siteGrid, siteFactor, wakeEfficiency, outputMW });
})(globalThis);
