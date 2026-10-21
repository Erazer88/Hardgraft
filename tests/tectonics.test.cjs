'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
function load() {
  const context = vm.createContext({});
  for (const file of ['data/worldgen.js','world.js','world/system.js','world/tectonics.js','world/terrainElevation.js','world/thermalErosion.js','world/terrainStructure.js','ui/terrainDiagnostics.js'])
    vm.runInContext(fs.readFileSync(`${__dirname}/../src/${file}`,'utf8'),context);
  return context;
}
const fields = ['plateId','secondaryPlateId','continentalField','boundaryInfluence','convergence','divergence',
  'shear','tectonicUplift','tectonicSubsidence','broadTerrain','hillTerrain','fineTerrain'];
function equalArrays(a,b,message) { assert.deepEqual(Array.from(a),Array.from(b),message); }

test('tectonic analysis has no side effects on terrain generation', () => {
  const c = load(), before = c.OrbitWorld.createTerrain('stage-A-unchanged',48,24,{surfaceWater:.42});
  c.OrbitTectonics.create('stage-A-unchanged',48,24,{surfaceWater:.42});
  const after = c.OrbitWorld.createTerrain('stage-A-unchanged',48,24,{surfaceWater:.42});
  equalArrays(before.elevation,after.elevation);
});

test('plates are seeded, well spaced on the sphere and carry tangent angular motion', () => {
  const T = load().OrbitTectonics, a=T.createModel('plate-layout'), b=T.createModel('plate-layout');
  assert.equal(JSON.stringify(a.plates),JSON.stringify(b.plates));
  assert.notEqual(JSON.stringify(a.plates),JSON.stringify(T.createModel('other-layout').plates));
  assert.ok(a.plates.length>=12 && a.plates.length<=24);
  let nearest=Infinity;
  for(const plate of a.plates) {
    const p=plate.direction, v=T.velocityAt(plate,p);
    assert.ok(Math.abs(Math.hypot(p.x,p.y,p.z)-1)<1e-12);
    assert.ok(Math.abs(v.x*p.x+v.y*p.y+v.z*p.z)<1e-12);
    assert.ok(Number.isFinite(plate.angularSpeed));
    assert.ok(['continental','oceanic'].includes(plate.crustType));
    for(const other of a.plates) if(other!==plate)
      nearest=Math.min(nearest,Math.hypot(p.x-other.direction.x,p.y-other.direction.y,p.z-other.direction.z));
  }
  assert.ok(nearest>.30,'Fibonacci layout avoids tiny plates from randomly clustered seeds');
});

test('tectonic fields are deterministic, finite, seamless and canonical at both poles', () => {
  const T=load().OrbitTectonics, a=T.create('tectonic-fields',128,64,{geology:.6}),
    b=T.create('tectonic-fields',128,64,{geology:.6}), other=T.create('tectonic-other',128,64,{geology:.6});
  for(const name of fields) {
    equalArrays(a[name],b[name],`${name} repeats`);
    assert.notDeepEqual(Array.from(a[name]),Array.from(other[name]),`${name} depends on seed`);
    assert.ok(a[name].every(Number.isFinite),`${name} is finite`);
    for(let y=0;y<a.height;y++) assert.equal(a[name][y*a.width],a[name][y*a.width+a.width-1]);
    for(const y of [0,a.height-1]) for(let x=1;x<a.width;x++) assert.equal(a[name][y*a.width+x],a[name][y*a.width]);
  }
  assert.ok(a.plateId.every(id=>id<a.plates.length));
});

test('high continental frequency breaks the land field into multiple seeded regions', () => {
  const c=load(),W=c.OrbitWorld,w=96,h=48;
  const settings={...c.OrbitWorldgenData.terrain.tectonics,continentalFrequency:3.5};
  let meanLargestShare=0;
  for(const seed of ['arch-a','arch-b','arch-c','arch-d','arch-e']) {
    const terrain=W.createTerrain(seed,w,h,{surfaceWater:.5,geology:.55},
      {...c.OrbitWorldgenData.terrain,tectonics:settings});
    const land=new Uint8Array(w*h),seen=new Uint8Array(w*h),sizes=[];
    for(let i=0;i<land.length;i++)land[i]=terrain.elevation[i]>terrain.seaLevel?1:0;
    for(let y=0;y<h;y++)for(let x=0;x<w-1;x++) {
      const start=y*w+x;if(!land[start]||seen[start])continue;
      const queue=[start];seen[start]=1;let size=0;
      for(let head=0;head<queue.length;head++) {
        const index=queue[head],cx=index%w,cy=Math.floor(index/w);size++;
        const neighbors=[cy*w+(cx+w-2)%(w-1),cy*w+(cx+1)%(w-1)];
        if(cy>0)neighbors.push(index-w);if(cy+1<h)neighbors.push(index+w);
        for(const next of neighbors)if(land[next]&&!seen[next]){seen[next]=1;queue.push(next);}
      }
      sizes.push(size);
    }
    sizes.sort((a,b)=>b-a);
    const total=sizes.reduce((sum,size)=>sum+size,0);
    assert.ok(sizes.length>=6,`${seed} has several distinct continental regions and islands`);
    const largestShare=sizes[0]/total;
    assert.ok(largestShare<.82,`${seed} does not collapse into one dominant supercontinent`);
    meanLargestShare+=largestShare;
  }
  assert.ok(meanLargestShare/5<.70,
    'generated coastlines keep the largest landmass from swallowing most land across seeds');
});

test('relative angular motions classify convergent, divergent and shear boundaries', () => {
  const T=load().OrbitTectonics; let convergent=0,neutral=0,divergent=0,cn=0,nn=0,dn=0;
  let quiet=0,active=0,rift=0;
  for(let seed=0;seed<6;seed++) {
    const a=T.create(`boundary-types-${seed}`,96,48,{geology:.8});
    const low=T.create(`boundary-types-${seed}`,96,48,{geology:.1});
    for(let i=0;i<a.plateId.length;i++) {
      active+=a.tectonicUplift[i]; quiet+=low.tectonicUplift[i];
      if(a.convergence[i]>.2) { convergent+=a.tectonicUplift[i]; cn++; }
      if(a.boundaryInfluence[i]<.01) {neutral+=a.tectonicUplift[i];nn++;}
      if(a.divergence[i]>.2) {divergent+=a.tectonicUplift[i];dn++;rift+=a.tectonicSubsidence[i];}
    }
  }
  assert.ok(cn>0 && nn>0 && dn>0);
  assert.ok(convergent/cn>neutral/nn+4,'collision, not every boundary, creates the strongest uplift');
  assert.ok(convergent/cn>divergent/dn*1.5,'divergence produces weaker uplift than convergence');
  assert.ok(rift/dn>1,'divergent boundaries include subsidence/rifts');
  assert.ok(active>quiet*1.25,'geology amplifies tectonic activity without covering every plate');
});

test('B: new elevation is tectonic, deterministic and respects surface-weighted water coverage', () => {
  const c=load(),T=c.OrbitTectonics,E=c.OrbitTerrainElevation;
  for(const water of [0,.32,.5,.78]) {
    const fields=T.create('tectonic-elevation',192,96,{geology:.65});
    const raw=E.create(fields,'tectonic-elevation');
    const again=E.create(fields,'tectonic-elevation');
    equalArrays(raw.rawElevation,again.rawElevation);
    const result=E.normalize(raw.rawElevation,192,96,water);
    let wet=0,total=0;
    for(let y=0;y<96;y++) for(let x=0;x<191;x++) {
      const weight=Math.cos((.5-y/95)*Math.PI); total+=weight;
      if(result.elevation[y*192+x]<=result.seaLevel)wet+=weight;
    }
    assert.ok(Math.abs(wet/total-water)<.025,`${water}: coverage ${wet/total}`);
    assert.ok(result.elevation.every(Number.isFinite));
    for(let y=0;y<96;y++)assert.equal(result.elevation[y*192],result.elevation[y*192+191]);
    for(const y of [0,95])for(let x=1;x<192;x++)assert.equal(result.elevation[y*192+x],result.elevation[y*192]);
    assert.ok(result.elevation.every(v=>v<255),'height conversion does not clip summits into flat saturated caps');
  }
  const a=T.create('terrain-a',96,48),b=T.create('terrain-b',96,48);
  assert.notDeepEqual(Array.from(E.create(a,'terrain-a').rawElevation),Array.from(E.create(b,'terrain-b').rawElevation));
});

test('topography gives continents a plateau and independent regional relief', () => {
  const c=load(),T=c.OrbitTectonics,E=c.OrbitTerrainElevation,w=192,h=96,seed='continental-plateau-relief';
  const tectonics=T.create(seed,w,h,{geology:.65}),raw=E.create(tectonics,seed).rawElevation;
  const inland=[];
  for(let i=0;i<raw.length;i++)if(tectonics.continentalField[i]>.72&&tectonics.tectonicUplift[i]<2)inland.push(raw[i]);
  inland.sort((a,b)=>a-b);
  assert.ok(inland.length>w*h*.04,'the test samples a meaningful interior area outside mountain belts');
  assert.ok(inland[Math.floor(inland.length*.9)]-inland[Math.floor(inland.length*.1)]>12,
    'upland interiors retain regional terrain and hills away from tectonic uplift');

  const lower={...tectonics,continentalField:Float32Array.from(tectonics.continentalField,v=>v>.74?.76:v)};
  const higher={...tectonics,continentalField:Float32Array.from(tectonics.continentalField,v=>v>.74?.98:v)};
  const lowRaw=E.create(lower,seed).rawElevation,highRaw=E.create(higher,seed).rawElevation;
  for(let i=0;i<raw.length;i++)if(tectonics.continentalField[i]>.74)
    assert.ok(Math.abs(lowRaw[i]-highRaw[i])<1e-6,'continental field saturates into a stable interior plateau');
});

test('local continental field can change crust character inside one tectonic plate', () => {
  const T=load().OrbitTectonics,w=128,h=64,terrain=T.create('coast-crosses-plate',w,h,{geology:.65});
  const byPlate=new Map();
  for(let i=0;i<terrain.plateId.length;i++) {
    const id=terrain.plateId[i];let range=byPlate.get(id);
    if(!range)byPlate.set(id,range={min:1,max:0});
    range.min=Math.min(range.min,terrain.continentalField[i]);
    range.max=Math.max(range.max,terrain.continentalField[i]);
  }
  assert.ok([...byPlate.values()].some(range=>range.min<.40&&range.max>.62),
    'at least one plate contains both continental and oceanic portions');
});

test('convergent belts have broad uplift with several structured ridge crests', () => {
  const c=load(),T=c.OrbitTectonics,model=T.createModel('topography-diagnostic',{geology:.9});
  let structured=null;
  for(let y=2;y<46&&!structured;y++)for(let x=0;x<95&&!structured;x++) {
    const p=c.OrbitWorld.directionForPixel(x,y,96,48),sample=T.sample(model,p,{});
    if(sample.convergence<.45||sample.tectonicUplift<12)continue;
    const a=Math.min(sample.plateId,sample.secondaryPlateId),b=Math.max(sample.plateId,sample.secondaryPlateId);
    const A=model.plates[a].direction,B=model.plates[b].direction;
    let nx=B.x-A.x,ny=B.y-A.y,nz=B.z-A.z,dot=nx*p.x+ny*p.y+nz*p.z;
    nx-=dot*p.x;ny-=dot*p.y;nz-=dot*p.z;const length=Math.hypot(nx,ny,nz);nx/=length;ny/=length;nz/=length;
    const profile=[];
    for(let step=-35;step<=35;step++) {
      const angle=step*.004,co=Math.cos(angle),si=Math.sin(angle),q={x:p.x*co+nx*si,y:p.y*co+ny*si,z:p.z*co+nz*si};
      profile.push(T.sample(model,q,{}).tectonicUplift);
    }
    const maximum=Math.max(...profile),peaks=[];
    for(let i=1;i<profile.length-1;i++)if(profile[i]>profile[i-1]&&profile[i]>=profile[i+1]&&profile[i]>maximum*.4)peaks.push(profile[i]);
    if(peaks.length>=2)structured={profile,maximum,peaks};
  }
  assert.ok(structured,'a convergent belt contains multiple distinct ridge crests');
  assert.ok(structured.profile.filter(value=>value>structured.maximum*.22).length>9,
    'orogenic uplift spans a belt rather than a boundary line');
});

test('boundary collision classification uses local crust values rather than plate labels', () => {
  const c=load(),T=c.OrbitTectonics,model=T.createModel('local-crust-classification',{geology:.85});
  let point=null;
  for(let y=2;y<46&&!point;y+=2)for(let x=0;x<95&&!point;x+=2) {
    const p=c.OrbitWorld.directionForPixel(x,y,96,48),sample=T.sample(model,p,{});
    if(sample.convergence>.35&&sample.tectonicUplift>12)point={p,sample};
  }
  assert.ok(point,'the seeded world contains an active collision');
  const original=point.sample.tectonicUplift;
  for(const plate of model.plates)plate.crustType=plate.crustType==='continental'?'oceanic':'continental';
  const after=T.sample(model,point.p,{}).tectonicUplift;
  assert.equal(after,original,'local continental-field samples, not fixed center labels, classify the collision');
});

test('B: uplift stays continuous where the second-nearest plate changes at a junction', () => {
  const c=load(),T=c.OrbitTectonics,model=T.createModel('junction-continuity',{geology:.9});
  let checked=0;
  const middle=(a,b)=>{const x=a.x+b.x,y=a.y+b.y,z=a.z+b.z,l=Math.hypot(x,y,z);return{x:x/l,y:y/l,z:z/l};};
  for(let y=2;y<46 && checked<30;y++)for(let x=0;x<95 && checked<30;x++) {
    let a=c.OrbitWorld.directionForPixel(x,y,96,48),b=c.OrbitWorld.directionForPixel(x+1,y,96,48);
    let sa=T.sample(model,a,{}),sb=T.sample(model,b,{});
    if(sa.plateId!==sb.plateId || sa.secondaryPlateId===sb.secondaryPlateId)continue;
    const first=sa.plateId,second=sa.secondaryPlateId;
    for(let k=0;k<20;k++) {
      const m=middle(a,b),sm=T.sample(model,m,{});
      if(sm.secondaryPlateId===second){a=m;sa=sm;}else{b=m;sb=sm;}
    }
    if(sa.plateId!==first || sb.plateId!==first)continue;
    assert.ok(Math.abs(sa.tectonicUplift-sb.tectonicUplift)<.02,
      `junction ${checked} changes uplift by ${Math.abs(sa.tectonicUplift-sb.tectonicUplift)}`);
    checked++;
  }
  assert.ok(checked>=10,'inspect multiple runner-up transitions rather than just an arbitrary point');
});

test('C: thermal erosion lowers sharp peaks conservatively on a sphere, including both poles', () => {
  const c=load(),E=c.OrbitThermalErosion,width=128,height=64,field=new Float32Array(width*height).fill(100);
  field[30*width+60]=200;
  for(let x=0;x<width;x++)field[x]=180;
  const before=E.surfaceIntegral(field,width,height),after=E.erode(field,width,height);
  const repeated=E.erode(field,width,height);
  equalArrays(after,repeated);
  assert.ok(after[30*width+60]<150,'isolated steep summit is softened');
  assert.ok(after[30*width+59]>100,'eroded material is deposited beside the summit');
  assert.ok(Math.abs(E.surfaceIntegral(after,width,height)-before)<before*1e-6,'surface-weighted material is conserved');
  assert.ok(after.every(Number.isFinite));
  for(let y=0;y<height;y++)assert.equal(after[y*width],after[y*width+width-1]);
  for(const y of [0,height-1])for(let x=1;x<width;x++)assert.equal(after[y*width+x],after[y*width]);
  equalArrays(E.erode(new Float32Array(width*height).fill(100),width,height),new Float32Array(width*height).fill(100),
    'flat plains are not textured by erosion');
});

test('C: real tectonic terrain changes gently and keeps its long mountain systems', () => {
  const c=load(),w=192,h=96,fields=c.OrbitTectonics.create('erosion-real',w,h,{geology:.9}),
    raw=c.OrbitTerrainElevation.create(fields,'erosion-real').rawElevation;
  const eroded=c.OrbitThermalErosion.erode(raw,w,h);
  let total=0,maximum=0;
  for(let i=0;i<raw.length;i++){const d=Math.abs(eroded[i]-raw[i]);total+=d;maximum=Math.max(maximum,d);}
  assert.ok(maximum>.1,'erosion has a measurable effect on steep slopes');
  assert.ok(total/raw.length<4.5,
    'the broader seeded continent margins allow coast shaping while preserving the large-scale relief');
  const a=c.OrbitThermalErosion.surfaceIntegral(raw,w,h),b=c.OrbitThermalErosion.surfaceIntegral(eroded,w,h);
  assert.ok(Math.abs(a-b)<Math.abs(a)*1e-6);
});

test('D: renderer ridge and valley fields describe final topography rather than independent noise', () => {
  const c=load(),w=128,h=64,uplift=new Float32Array(w*h).fill(45);
  const ridge=new Uint8Array(w*h),trough=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const dir=c.OrbitWorld.directionForPixel(x,y,w,h);
    const shape=Math.exp(-Math.pow(dir.z/.16,2))*35;
    ridge[y*w+x]=Math.round(150+shape);trough[y*w+x]=Math.round(185-shape);
  }
  const a=c.OrbitTerrainStructure.derive(ridge,uplift,w,h,102),b=c.OrbitTerrainStructure.derive(trough,uplift,w,h,102);
  const sum=field=>field.reduce((a,b)=>a+b,0);
  assert.ok(sum(a.ridgeField)>sum(b.ridgeField)*1.4,'convex crest is recognized as a ridge');
  assert.ok(sum(b.valleyField)>sum(a.valleyField)*1.4,'inverting the final shape creates a valley');
  assert.ok(a.ridgeField.every((v,i)=>v<=a.mountainMask[i]));
  const flat=c.OrbitTerrainStructure.derive(new Uint8Array(w*h).fill(150),uplift,w,h,102);
  assert.equal(sum(flat.ridgeField),0);assert.equal(sum(flat.valleyField),0);assert.equal(sum(flat.ruggednessField),0);
});

test('D: canonical terrain exposes complete diagnostics and all structural fields remain spherical', () => {
  const c=load(),a=c.OrbitWorld.createTerrain('final-tectonic-contract',128,64,{surfaceWater:.42,geology:.65});
  for(const key of ['plateId','continentalField','convergence','divergence','tectonicUplift','rawElevation','erodedElevation',
    'mountainMask','ridgeField','valleyField','ruggednessField']) {
    assert.equal(a.diagnostics[key].length,128*64,key);
    assert.ok(a.diagnostics[key].every(Number.isFinite),key);
    for(let y=0;y<64;y++)assert.equal(a.diagnostics[key][y*128],a.diagnostics[key][y*128+127],key);
    for(const y of [0,63])for(let x=1;x<128;x++)assert.equal(a.diagnostics[key][y*128+x],a.diagnostics[key][y*128],key);
  }
  assert.equal(a.diagnostics.erodedElevation.filter((v,i)=>Math.round(v)!==a.elevation[i]).length,0,
    'the diagnostic final height is exactly the canonical gameplay elevation before integer rounding');
});

test('diagnostic maps expose all requested fields with direct grayscale heights and categorical plate IDs', () => {
  const c=load(),D=c.OrbitTerrainDiagnostics;
  const terrain=c.OrbitWorld.createTerrain('diagnostic-pixels',48,24,{surfaceWater:.4});
  assert.equal(D.definitions.length,11);
  for(const definition of D.definitions) {
    const pixels=D.pixelsFor(terrain,definition.id);
    assert.equal(pixels.length,terrain.width*terrain.height*4);
    if(definition.id==='plateId') assert.ok(pixels.some((n,i)=>i%4===0 && n!==pixels[i+1]));
    else for(let i=0;i<pixels.length;i+=4)assert.ok(pixels[i]===pixels[i+1] && pixels[i]===pixels[i+2]);
  }
  const pixels=D.pixelsFor(terrain,'erodedElevation');
  for(let i=0;i<terrain.elevation.length;i++)assert.equal(pixels[i*4],terrain.elevation[i]);
});
