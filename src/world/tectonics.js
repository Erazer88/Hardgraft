(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const gaussian = n => Math.exp(-n*n);
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, n) => { const t = clamp((n - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const normalize = p => { const n = Math.hypot(p.x, p.y, p.z) || 1; return { x: p.x / n, y: p.y / n, z: p.z / n }; };
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

  // Seeded gradient noise in 3D. UVs never enter the geographical model.
  function noise3(seed) {
    const random = root.OrbitWorld.rng(seed), perm = new Uint8Array(512);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(random() * (i + 1)), n = perm[i]; perm[i] = perm[j]; perm[j] = n; }
    for (let i = 256; i < 512; i++) perm[i] = perm[i - 256];
    const fade = n => n * n * n * (n * (n * 6 - 15) + 10);
    function grad(hash, x, y, z) {
      const h = hash & 15, u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
      return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    }
    return (x, y, z) => {
      const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
      const X = fx & 255, Y = fy & 255, Z = fz & 255;
      x -= fx; y -= fy; z -= fz;
      const u = fade(x), v = fade(y), w = fade(z);
      const A = perm[X] + Y, B = perm[X + 1] + Y;
      const AA = perm[A] + Z, AB = perm[A + 1] + Z, BA = perm[B] + Z, BB = perm[B + 1] + Z;
      return mix(mix(mix(grad(perm[AA], x,y,z), grad(perm[BA], x-1,y,z), u),
        mix(grad(perm[AB], x,y-1,z), grad(perm[BB], x-1,y-1,z), u), v),
      mix(mix(grad(perm[AA+1], x,y,z-1), grad(perm[BA+1], x-1,y,z-1), u),
        mix(grad(perm[AB+1], x,y-1,z-1), grad(perm[BB+1], x-1,y-1,z-1), u), v), w);
    };
  }
  function fbm(noise, x, y, z, octaves = 3) {
    let value = 0, amplitude = 1, total = 0;
    for (let i = 0; i < octaves; i++) {
      value += noise(x, y, z) * amplitude; total += amplitude;
      x *= 2.03; y *= 2.03; z *= 2.03; amplitude *= .48;
    }
    return value / total;
  }
  function randomDirection(random) {
    const y = random() * 2 - 1, a = random() * TAU, r = Math.sqrt(1 - y * y);
    return { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
  }
  function rotate(p, axis, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), d = dot(axis, p), v = cross(axis, p);
    return normalize({ x: p.x*c + v.x*s + axis.x*d*(1-c),
      y: p.y*c + v.y*s + axis.y*d*(1-c), z: p.z*c + v.z*s + axis.z*d*(1-c) });
  }
  function createModel(seed, planet = {}, settings = root.OrbitWorldgenData.terrain.tectonics) {
    const modelSeed = root.OrbitWorld.hashSeed(String(seed) + ':static-tectonics-v1');
    const random = root.OrbitWorld.rng(modelSeed), noise = noise3(modelSeed ^ 0x75a82913);
    const detailNoise = noise3(modelSeed ^ 0x3e291b73);
    const count = settings.plateCount[0] + Math.floor(random() * (settings.plateCount[1] - settings.plateCount[0] + 1));
    const geology = clamp(Number.isFinite(planet.geology) ? planet.geology : .5, 0, 1);
    const rotationAxis = randomDirection(random), rotationAngle = random() * TAU;
    const plates = [], jitter = settings.seedJitter / Math.sqrt(count);
    const continentalAt = p => clamp(.5 + fbm(noise, p.x * settings.continentalFrequency + 17.3,
      p.y * settings.continentalFrequency - 8.7, p.z * settings.continentalFrequency + 3.1, 2) * 1.05, 0, 1);
    for (let i = 0; i < count; i++) {
      const y = 1 - 2 * (i + .5) / count, a = i * Math.PI * (3 - Math.sqrt(5)), r = Math.sqrt(1-y*y);
      let p = rotate({ x: r*Math.cos(a), y, z: r*Math.sin(a) }, rotationAxis, rotationAngle);
      const j = randomDirection(random);
      p = normalize({ x: p.x + j.x*jitter, y: p.y + j.y*jitter, z: p.z + j.z*jitter });
      const axis = randomDirection(random);
      const speed = mix(settings.angularSpeed[0], settings.angularSpeed[1], random()) * (.65 + geology * .6);
      const continentality = clamp(continentalAt(p) + (random()-.5)*.10 + (geology-.5)*.025, 0, 1);
      plates.push({ id: i, direction: p, rotationAxis: axis, angularSpeed: speed,
        omega: { x: axis.x*speed, y: axis.y*speed, z: axis.z*speed },
        crustType: continentality >= .48 ? 'continental' : 'oceanic', continentality });
    }
    const pairs = new Array(count*count);
    for(let i=0;i<count;i++)for(let j=i+1;j<count;j++) {
      const A=plates[i],B=plates[j],bx=B.direction.x-A.direction.x,by=B.direction.y-A.direction.y,bz=B.direction.z-A.direction.z;
      pairs[i*count+j]={bx,by,bz,spacing:Math.max(.1,Math.hypot(bx,by,bz)),
        ox:B.omega.x-A.omega.x,oy:B.omega.y-A.omega.y,oz:B.omega.z-A.omega.z,
        ca:A.crustType==='continental',cb:B.crustType==='continental'};
    }
    return { seed: modelSeed, plates, pairs, geology, settings, noise, detailNoise, continentalAt };
  }
  function velocityAt(plate, p) { return cross(plate.omega, p); }

  function boundarySource(model, p, i, j, best, scores, out) {
    const s=model.settings,{bx,by,bz,spacing,ox,oy,oz,ca,cb}=model.pairs[i*model.plates.length+j];
    const radial=bx*p.x+by*p.y+bz*p.z;
    const nx=bx-radial*p.x, ny=by-radial*p.y, nz=bz-radial*p.z, nLength=Math.hypot(nx,ny,nz)||1;
    const vx=oy*p.z-oz*p.y, vy=oz*p.x-ox*p.z, vz=ox*p.y-oy*p.x;
    const motion=(vx*nx+vy*ny+vz*nz)/nLength;
    const convergence=clamp(-motion/s.motionScale,0,1), divergence=clamp(motion/s.motionScale,0,1);
    const distance=Math.abs(scores[i]-scores[j])/spacing;
    const ownerDistance=Math.max(0,best-Math.max(scores[i],scores[j]))/spacing;
    const owner=gaussian(ownerDistance/(s.shoulderWidth*.65));
    const shoulder=gaussian(distance/s.shoulderWidth), core=gaussian(distance/s.coreWidth);
    let uplift=0,subsidence=0;
    if(ca&&cb) {
      uplift=convergence*s.continentalCollision*(shoulder*.74+core*.26);
      subsidence=divergence*s.riftDepth*gaussian(distance/s.riftWidth);
    } else if(ca||cb) {
      const continentalSide=(ca?1:-1)*(scores[i]-scores[j])/spacing;
      uplift=convergence*s.coastalUplift*gaussian((continentalSide-s.subductionOffset)/(s.shoulderWidth*.85));
      subsidence=convergence*s.trenchDepth*gaussian((continentalSide+s.subductionOffset)/s.trenchWidth)+divergence*s.riftDepth*.65*core;
    } else {
      uplift=convergence*s.islandArcUplift*shoulder*.65+divergence*s.oceanRidgeUplift*shoulder;
      subsidence=convergence*s.trenchDepth*core;
    }
    out.weight=owner*shoulder;out.uplift=uplift;out.subsidence=subsidence;
    out.convergence=convergence;out.divergence=divergence;
    out.shear=clamp(Math.sqrt(Math.max(0,vx*vx+vy*vy+vz*vz-motion*motion))/s.motionScale,0,1);
  }
  // Blend only nearby pairs with compact, smooth ownership at junctions. Plate IDs are Voronoi cells,
  // geological source fields remain continuous when the runner-up changes.
  function sample(model, p, out = {}) {
    let first=0,second=1,third=2,best=-Infinity,runner=-Infinity,thirdScore=-Infinity,weighted=0,weights=0;
    const scores=model.scores||(model.scores=new Float64Array(model.plates.length));
    for(let i=0;i<model.plates.length;i++) {
      const plate=model.plates[i],score=dot(p,plate.direction);scores[i]=score;
      if(score>best){third=second;thirdScore=runner;second=first;runner=best;first=i;best=score;}
      else if(score>runner){third=second;thirdScore=runner;second=i;runner=score;}
      else if(score>thirdScore){third=i;thirdScore=score;}
      const w=Math.max(0,score+.18)**4;weighted+=w*plate.continentality;weights+=w;
    }
    const source=model.sourceScratch||(model.sourceScratch={});
    const candidates=model.candidates||(model.candidates=new Uint8Array(model.plates.length));
    let candidateCount=0;
    for(let i=0;i<model.plates.length;i++)if(best-scores[i]<.22)candidates[candidateCount++]=i;
    let total=0,uplift=0,subsidence=0,convergence=0,divergence=0,shear=0;
    for(let ci=0;ci<candidateCount;ci++)for(let cj=ci+1;cj<candidateCount;cj++) {
      const i=candidates[ci],j=candidates[cj];
      boundarySource(model,p,i,j,best,scores,source);
      const ownership=(1-smooth(.07,.22,best-scores[i]))*(1-smooth(.07,.22,best-scores[j]));
      const w=source.weight*ownership;total+=w;uplift+=source.uplift*w;subsidence+=source.subsidence*w;
      convergence+=source.convergence*w;divergence+=source.divergence*w;shear+=source.shear*w;
    }
    const normalization=Math.max(1,total),s=model.settings,activity=.38+model.geology*.95;
    const summit=.84+model.detailNoise(p.x*9.1+2.7,p.y*9.1-5.3,p.z*9.1+7.6)*.22;
    out.plateId=first;out.secondaryPlateId=second;out.boundaryDistanceProxy=best-runner;
    out.boundaryInfluence=clamp(total,0,1);out.convergence=convergence/normalization;
    out.divergence=divergence/normalization;out.shear=shear/normalization;
    out.tectonicUplift=uplift/normalization*activity*summit;
    out.tectonicSubsidence=subsidence/normalization*activity;
    out.continentalField=clamp(model.continentalAt(p)+(weighted/Math.max(1e-9,weights)-.5)*s.plateContinentalInfluence,0,1);
    out.broadTerrain=fbm(model.detailNoise,p.x*4.3+9.2,p.y*4.3-3.4,p.z*4.3+5.8)*8;
    return out;
  }
  function create(seed, width, height, planet = {}, settings) {
    const model = createModel(seed, planet, settings), size = width*height;
    const result = { width, height, plates: model.plates, modelSeed: model.seed,
      plateId: new Uint8Array(size), secondaryPlateId: new Uint8Array(size) };
    for (const key of ['continentalField','boundaryDistanceProxy','boundaryInfluence','convergence','divergence',
      'shear','tectonicUplift','tectonicSubsidence','broadTerrain']) result[key] = new Float32Array(size);
    const keys = ['plateId','secondaryPlateId','continentalField','boundaryDistanceProxy','boundaryInfluence','convergence','divergence','shear','tectonicUplift','tectonicSubsidence','broadTerrain'];
    const p = {}, value = {};
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y*width+x;
      // Poles and the duplicate seam are the same physical samples, not averages.
      if ((x && (y === 0 || y === height-1)) || (x === width-1 && width>1)) {
        for (const key of keys) result[key][i] = result[key][y*width];
        continue;
      }
      root.OrbitWorld.directionForPixel(x,y,width,height,p); sample(model,p,value);
      for (const key of keys) result[key][i] = value[key];
    }
    return result;
  }
  root.OrbitTectonics = Object.freeze({ createModel, create, sample, velocityAt, noise3, fbm });
})(globalThis);
