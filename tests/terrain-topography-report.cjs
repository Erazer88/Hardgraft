#!/usr/bin/env node
'use strict';
// CPU-only evidence, deliberately independent of the globe/material/shader pipeline.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib');
const context=vm.createContext({Math});
for(const file of ['data/worldgen.js','world.js','world/system.js','world/tectonics.js','world/terrainElevation.js','world/thermalErosion.js','world/terrainStructure.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),context);
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(buffer){let n=0xffffffff;for(const b of buffer)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([name,data])),8+data.length);return out;}
function png(file,field,width,height,min=0,max=255){
  const scan=Buffer.alloc((width+1)*height),header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)scan[y*(width+1)+x+1]=Math.max(0,Math.min(255,Math.round((field[y*width+x]-min)/(max-min)*255)));
  fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]));
}
const out=path.join(__dirname,'../artifacts/tectonic-terrain');fs.mkdirSync(out,{recursive:true});
for(let n=0;n<3;n++) {
  const seed=`tectonic-check-${n}`,width=960,height=360;
  const started=performance.now();
  const terrain=context.OrbitWorld.createTerrain(seed,width,height,{geology:.65,surfaceWater:.42});
  const {tectonics,diagnostics}=terrain;
  for(const [name,max] of [['rawElevation',255],['erodedElevation',255],['tectonicUplift',90],['continentalField',1],
    ['mountainMask',255],['ridgeField',255],['valleyField',255],['ruggednessField',255]])
    png(path.join(out,`${seed}-${name}.png`),diagnostics[name],width,height,0,max);
  console.log(`${seed}: ${(performance.now()-started).toFixed(0)} ms, ${tectonics.plates.length} plates`);
}
console.log(out);
