'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
function load() {
  const context = vm.createContext({});
  for (const file of ['data/worldgen.js','world.js','world/system.js','world/tectonics.js','world/terrainElevation.js','world/thermalErosion.js'])
    vm.runInContext(fs.readFileSync(`${__dirname}/../src/${file}`,'utf8'),context);
  return context;
}
const fields = ['plateId','secondaryPlateId','continentalField','boundaryInfluence','convergence','divergence',
  'shear','tectonicUplift','tectonicSubsidence'];
function equalArrays(a,b,message) { assert.deepEqual(Array.from(a),Array.from(b),message); }

test('A: tectonic analysis leaves the v7 elevation untouched', () => {
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
  assert.ok(total/raw.length<2,'thermal pass keeps the large-scale relief intact');
  const a=c.OrbitThermalErosion.surfaceIntegral(raw,w,h),b=c.OrbitThermalErosion.surfaceIntegral(eroded,w,h);
  assert.ok(Math.abs(a-b)<Math.abs(a)*1e-6);
});
