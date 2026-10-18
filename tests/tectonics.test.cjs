'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
function load() {
  const context = vm.createContext({});
  for (const file of ['data/worldgen.js','world.js','world/system.js','world/tectonics.js'])
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
