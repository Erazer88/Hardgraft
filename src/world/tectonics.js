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
  function fbm(noise, x, y, z, octaves = 3, settings = root.OrbitWorldgenData.terrain.tectonics.fbm) {
    let value = 0, amplitude = 1, total = 0;
    for (let i = 0; i < octaves; i++) {
      value += noise(x, y, z) * amplitude; total += amplitude;
      x *= settings.lacunarity; y *= settings.lacunarity; z *= settings.lacunarity;
      amplitude *= settings.persistence;
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
    const regionalNoise = noise3(modelSeed ^ 0x4f19ab27);
    const hillsNoise = noise3(modelSeed ^ 0xb617d8c1);
    const fineNoise = noise3(modelSeed ^ 0x28e53f91);
    const count = settings.plateCount[0] + Math.floor(random() * (settings.plateCount[1] - settings.plateCount[0] + 1));
    const geology = clamp(Number.isFinite(planet.geology) ? planet.geology : .5, 0, 1);
    const rotationAxis = randomDirection(random), rotationAngle = random() * TAU;
    const plates = [], jitter = settings.seedJitter / Math.sqrt(count);
    const continentalAt = p => {
      const wf=settings.continentalWarpFrequency,wa=settings.continentalWarpAmplitude;
      const wx=noise(p.x*wf+13.1,p.y*wf+3.7,p.z*wf-8.4)*wa;
      const wy=noise(p.x*wf-6.2,p.y*wf+15.3,p.z*wf+2.5)*wa;
      const wz=noise(p.x*wf+4.8,p.y*wf-9.6,p.z*wf+17.2)*wa;
      const warped=normalize({x:p.x+wx,y:p.y+wy,z:p.z+wz});
      const f=settings.continentalFrequency;
      const broad=fbm(noise,warped.x*f+17.3,warped.y*f-8.7,warped.z*f+3.1,2,settings.fbm)*1.05;
      const edge=detailNoise(warped.x*settings.continentalEdgeFrequency+7.2,
        warped.y*settings.continentalEdgeFrequency-11.4,warped.z*settings.continentalEdgeFrequency+5.9)*
        settings.continentalEdgeAmplitude;
      return clamp(.5+broad+edge,0,1);
    };
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
      const axis=normalize(cross(A.direction,B.direction));
      const midpoint=normalize({x:A.direction.x+B.direction.x,y:A.direction.y+B.direction.y,z:A.direction.z+B.direction.z});
      pairs[i*count+j]={bx,by,bz,spacing:Math.max(.1,Math.hypot(bx,by,bz)),axis,midpoint,phase:random()*TAU,
        ox:B.omega.x-A.omega.x,oy:B.omega.y-A.omega.y,oz:B.omega.z-A.omega.z};
    }
    return { seed: modelSeed, plates, pairs, geology, settings, noise, detailNoise,
      regionalNoise,hillsNoise,fineNoise,continentalAt };
  }
  function velocityAt(plate, p) { return cross(plate.omega, p); }

  function boundarySource(model, p, i, j, best, scores, out) {
    const s=model.settings,o=s.orogeny,plates=model.plates;
    const {bx,by,bz,spacing,axis,midpoint,phase,ox,oy,oz}=model.pairs[i*plates.length+j];
    const radial=bx*p.x+by*p.y+bz*p.z;
    const nx0=bx-radial*p.x,ny0=by-radial*p.y,nz0=bz-radial*p.z,nLength=Math.hypot(nx0,ny0,nz0)||1;
    const nx=nx0/nLength,ny=ny0/nLength,nz=nz0/nLength;
    const vx=oy*p.z-oz*p.y,vy=oz*p.x-ox*p.z,vz=ox*p.y-oy*p.x;
    const motion=vx*nx+vy*ny+vz*nz;
    const convergence=clamp(-motion/s.motionScale,0,1),divergence=clamp(motion/s.motionScale,0,1);
    const signedDistance=(scores[i]-scores[j])/spacing,distance=Math.abs(signedDistance);
    const ownerDistance=Math.max(0,best-Math.max(scores[i],scores[j]))/spacing;
    const owner=gaussian(ownerDistance/(o.beltWidth*.65));
    const shoulder=gaussian(distance/o.beltWidth),core=gaussian(distance/o.coreWidth);
    const zoneWeight=owner*shoulder;
    if(zoneWeight<.0001) {
      out.weight=0;out.sourceWeight=0;out.uplift=0;out.subsidence=0;out.convergence=0;out.divergence=0;out.shear=0;return;
    }

    // Collision style follows the continuous continental field on each side;
    // a plate's center label never decides whether this local boundary is continental.
    const probe=o.crustProbe;
    const sideA=normalize({x:p.x-nx*probe,y:p.y-ny*probe,z:p.z-nz*probe});
    const sideB=normalize({x:p.x+nx*probe,y:p.y+ny*probe,z:p.z+nz*probe});
    const localA=clamp(model.continentalAt(sideA)+(plates[i].continentality-.5)*s.plateContinentalInfluence,0,1);
    const localB=clamp(model.continentalAt(sideB)+(plates[j].continentality-.5)*s.plateContinentalInfluence,0,1);
    const crustA=smooth(o.continentalThreshold[0],o.continentalThreshold[1],localA);
    const crustB=smooth(o.continentalThreshold[0],o.continentalThreshold[1],localB);
    const continentalCollision=crustA*crustB;
    const mixedCollision=crustA*(1-crustB)+crustB*(1-crustA);
    const oceanCollision=(1-crustA)*(1-crustB);
    const continentalSide=Math.sign(crustA-crustB)||Math.sign(signedDistance)||1;
    const coastalDistance=signedDistance-continentalSide*o.coastalOffset;

    // Broad uplift is the range; warped bands add uneven ridges and cols inside it.
    const along=Math.atan2(p.x*axis.x+p.y*axis.y+p.z*axis.z,
      p.x*midpoint.x+p.y*midpoint.y+p.z*midpoint.z);
    const freq=o.ridgeWarpFrequency;
    const warp=model.detailNoise(p.x*freq+phase,p.y*freq-phase*.73,p.z*freq+phase*.41)*o.ridgeWarpAmplitude;
    const oblique=Math.sin(along*2.1+phase)*o.ridgeObliqueAmplitude;
    const slow=model.regionalNoise(p.x*o.alongVariationFrequency+phase*.31,
      p.y*o.alongVariationFrequency-phase*.17,p.z*o.alongVariationFrequency+phase*.53);
    const interruption=model.detailNoise(p.x*o.interruptionFrequency+phase*.47,
      p.y*o.interruptionFrequency-phase*.29,p.z*o.interruptionFrequency+phase*.19);
    const continuity=smooth(o.interruptionThreshold[0],o.interruptionThreshold[1],interruption);
    const bandAt=offset=>Math.pow(Math.max(0,Math.cos(TAU*(signedDistance-offset+warp+oblique)/o.ridgeSpacing+phase)),o.ridgeExponent);
    const slowAmplitude=clamp(.82+slow*.25,.52,1.08);
    const broadOrogen=shoulder*.72+core*.10+shoulder*bandAt(0)*continuity*o.ridgeAmplitude;
    const coastalShoulder=gaussian(coastalDistance/(o.beltWidth*.72));
    const coastalOrogen=coastalShoulder*.72+
      coastalShoulder*bandAt(continentalSide*o.coastalOffset)*continuity*o.ridgeAmplitude;
    let uplift=convergence*slowAmplitude*(
      continentalCollision*s.continentalCollision*broadOrogen+
      mixedCollision*s.coastalUplift*coastalOrogen+
      oceanCollision*s.islandArcUplift*(shoulder*.62+shoulder*bandAt(0)*continuity*.24));
    let subsidence=divergence*continentalCollision*s.riftDepth*gaussian(distance/s.riftWidth);
    if(mixedCollision>0) {
      const oceanSideDistance=-continentalSide*signedDistance;
      subsidence+=convergence*mixedCollision*s.trenchDepth*
        gaussian((oceanSideDistance-o.coastalOffset*.35)/s.trenchWidth);
      subsidence+=divergence*mixedCollision*s.riftDepth*.65*core;
    }
    subsidence+=convergence*oceanCollision*s.trenchDepth*core;
    uplift+=divergence*oceanCollision*s.oceanRidgeUplift*shoulder;
    // Blend boundary diagnostics only where the boundary has support. The
    // topographic profile already contains its own falloff, so use owner-only
    // weighting for uplift/subsidence instead of squaring the belt envelope.
    out.weight=zoneWeight;out.sourceWeight=owner;out.uplift=uplift;out.subsidence=subsidence;
    out.convergence=convergence;out.divergence=divergence;
    out.shear=clamp(Math.sqrt(Math.max(0,vx*vx+vy*vy+vz*vz-motion*motion))/s.motionScale,0,1);
  }
  // Blend only nearby pairs with compact, smooth ownership at junctions. Plate IDs are Voronoi cells,
  // geological source fields remain continuous when the runner-up changes.
  function sample(model, p, out = {}) {
    let first=0,second=1,best=-Infinity,runner=-Infinity,weighted=0,weights=0;
    const scores=model.scores||(model.scores=new Float64Array(model.plates.length));
    for(let i=0;i<model.plates.length;i++) {
      const plate=model.plates[i],score=dot(p,plate.direction);scores[i]=score;
      if(score>best){second=first;runner=best;first=i;best=score;}
      else if(score>runner){second=i;runner=score;}
      const w=Math.max(0,score+.18)**4;weighted+=w*plate.continentality;weights+=w;
    }
    const source=model.sourceScratch||(model.sourceScratch={});
    const candidates=model.candidates||(model.candidates=new Uint8Array(model.plates.length));
    let candidateCount=0;
    for(let i=0;i<model.plates.length;i++)if(best-scores[i]<.22)candidates[candidateCount++]=i;
    let total=0,sourceTotal=0,uplift=0,subsidence=0,convergence=0,divergence=0,shear=0;
    for(let ci=0;ci<candidateCount;ci++)for(let cj=ci+1;cj<candidateCount;cj++) {
      const i=candidates[ci],j=candidates[cj];
      boundarySource(model,p,i,j,best,scores,source);
      const ownership=(1-smooth(.07,.22,best-scores[i]))*(1-smooth(.07,.22,best-scores[j]));
      const w=source.weight*ownership,sw=source.sourceWeight*ownership;total+=w;sourceTotal+=sw;
      uplift+=source.uplift*sw;subsidence+=source.subsidence*sw;
      convergence+=source.convergence*w;divergence+=source.divergence*w;shear+=source.shear*w;
    }
    const normalization=Math.max(1,total),sourceNormalization=Math.max(1,sourceTotal),s=model.settings,activity=.38+model.geology*.95;
    const summit=.84+model.detailNoise(p.x*9.1+2.7,p.y*9.1-5.3,p.z*9.1+7.6)*.22;
    out.plateId=first;out.secondaryPlateId=second;out.boundaryDistanceProxy=best-runner;
    out.boundaryInfluence=clamp(total,0,1);out.convergence=convergence/normalization;
    out.divergence=divergence/normalization;out.shear=shear/normalization;
    out.tectonicUplift=uplift/sourceNormalization*activity*summit;
    out.tectonicSubsidence=subsidence/sourceNormalization*activity;
    out.continentalField=clamp(model.continentalAt(p)+(weighted/Math.max(1e-9,weights)-.5)*s.plateContinentalInfluence,0,1);
    const relief=model.settings.terrainRelief;
    out.broadTerrain=fbm(model.regionalNoise,p.x*relief.regional.frequency+9.2,
      p.y*relief.regional.frequency-3.4,p.z*relief.regional.frequency+5.8,relief.regional.octaves,s.fbm)*relief.regional.amplitude;
    out.hillTerrain=fbm(model.hillsNoise,p.x*relief.hills.frequency-11.7,
      p.y*relief.hills.frequency+6.8,p.z*relief.hills.frequency+2.3,relief.hills.octaves,s.fbm)*relief.hills.amplitude;
    out.fineTerrain=fbm(model.fineNoise,p.x*relief.fine.frequency+4.9,
      p.y*relief.fine.frequency-13.2,p.z*relief.fine.frequency+8.1,relief.fine.octaves,s.fbm)*relief.fine.amplitude;
    return out;
  }
  function create(seed, width, height, planet = {}, settings) {
    const model = createModel(seed, planet, settings), size = width*height;
    const result = { width, height, plates: model.plates, modelSeed: model.seed,
      plateId: new Uint8Array(size), secondaryPlateId: new Uint8Array(size) };
    for (const key of ['continentalField','boundaryDistanceProxy','boundaryInfluence','convergence','divergence',
      'shear','tectonicUplift','tectonicSubsidence','broadTerrain','hillTerrain','fineTerrain']) result[key] = new Float32Array(size);
    const keys = ['plateId','secondaryPlateId','continentalField','boundaryDistanceProxy','boundaryInfluence','convergence','divergence','shear','tectonicUplift','tectonicSubsidence','broadTerrain','hillTerrain','fineTerrain'];
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
