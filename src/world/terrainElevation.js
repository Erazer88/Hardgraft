(function (root) {
  'use strict';
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const smooth = (a,b,n) => { const t=clamp((n-a)/(b-a),0,1); return t*t*(3-2*t); };
  const TAU = Math.PI*2;
  function sampleSphere(field,p,width,height) {
    const x=(Math.atan2(p.z,p.x)/TAU+.5)*(width-1);
    const y=(.5-Math.asin(clamp(p.y,-1,1))/Math.PI)*(height-1);
    const x0=Math.floor(x), y0=Math.floor(y), x1=Math.min(width-1,x0+1), y1=Math.min(height-1,y0+1);
    const tx=x-x0, ty=y-y0;
    return (field[y0*width+x0]*(1-tx)+field[y0*width+x1]*tx)*(1-ty)+
      (field[y1*width+x0]*(1-tx)+field[y1*width+x1]*tx)*ty;
  }
  function create(tectonics,seed,settings=root.OrbitWorldgenData.terrain.tectonics) {
    const {width,height}=tectonics, size=width*height;
    const rawElevation=new Float32Array(size), uplift=new Float32Array(size), subsidence=new Float32Array(size);
    const noise=root.OrbitTectonics.noise3(root.OrbitWorld.hashSeed(String(seed)+':tectonic-warp'));
    const p={}, warped={};
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const i=y*width+x;
      if ((x && (y===0 || y===height-1)) || (x===width-1 && width>1)) {
        rawElevation[i]=rawElevation[y*width]; uplift[i]=uplift[y*width]; subsidence[i]=subsidence[y*width]; continue;
      }
      root.OrbitWorld.directionForPixel(x,y,width,height,p);
      const f=settings.warpFrequency, a=settings.warpAmplitude;
      // Displace already constructed tectonic fields; noise cannot create a new range.
      warped.x=p.x+noise(p.x*f+13.2,p.y*f+3.7,p.z*f-4.1)*a;
      warped.y=p.y+noise(p.x*f-7.4,p.y*f+17.3,p.z*f+2.9)*a;
      warped.z=p.z+noise(p.x*f+5.8,p.y*f-1.2,p.z*f+19.7)*a;
      const length=Math.hypot(warped.x,warped.y,warped.z); warped.x/=length;warped.y/=length;warped.z/=length;
      uplift[i]=sampleSphere(tectonics.tectonicUplift,warped,width,height);
      subsidence[i]=sampleSphere(tectonics.tectonicSubsidence,warped,width,height);
      const c=tectonics.continentalField[i],base=settings.continentalBase;
      const coast=smooth(base.coastRange[0],base.coastRange[1],c);
      const inland=smooth(base.inlandRange[0],base.inlandRange[1],c);
      // Continentality defines the shelf/plateau transition; interior altitude comes from relief fields.
      const continentalBase=base.base+coast*base.plateauRise+inland*base.inlandRise;
      rawElevation[i]=continentalBase+tectonics.broadTerrain[i]+tectonics.hillTerrain[i]+
        tectonics.fineTerrain[i]+uplift[i]-subsidence[i];
    }
    return {width,height,rawElevation,tectonicUplift:uplift,tectonicSubsidence:subsidence};
  }
  function normalize(raw,width,height,waterFraction) {
    let min=Infinity,max=-Infinity;
    for(const n of raw) {min=Math.min(min,n);max=Math.max(max,n);}
    const histogram=new Float64Array(4096), span=Math.max(1e-6,max-min), uniqueWidth=Math.max(1,width-1);
    let total=0;
    for(let y=0;y<height;y++) {
      const weight=Math.max(0,Math.cos((.5-y/Math.max(1,height-1))*Math.PI));
      for(let x=0;x<uniqueWidth;x++) {
        const bin=clamp(Math.floor((raw[y*width+x]-min)/span*4095),0,4095);
        histogram[bin]+=weight;total+=weight;
      }
    }
    let sum=0,bin=0;
    for(;bin<4095;bin++) {sum+=histogram[bin];if(sum>=total*waterFraction)break;}
    const quantileLevel=waterFraction===0 ? min-4 : min+bin/4095*span;
    const seaLevel=102;
    const scaleAt=level=>Math.min(1,146/Math.max(1,max-level),98/Math.max(1,level-min));
    let rawSeaLevel=quantileLevel;
    if(waterFraction>0) {
      // Integer gameplay heights use Math.round; center the quantile half a byte below sea level
      // so cells rounded onto the sea-level byte do not inflate the requested water coverage.
      for(let n=0;n<3;n++) rawSeaLevel=quantileLevel-.5/scaleAt(rawSeaLevel);
    }
    const verticalScale=scaleAt(rawSeaLevel);
    const parameters={seaLevel,rawSeaLevel,verticalScale};
    const finalHeights=transform(raw,parameters), elevation=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) elevation[i]=Math.round(clamp(finalHeights[i],0,255));
    return {...parameters,elevation,finalHeights};
  }
  function transform(field,{seaLevel,rawSeaLevel,verticalScale}) {
    const output=new Float32Array(field.length);
    for(let i=0;i<field.length;i++) output[i]=seaLevel+(field[i]-rawSeaLevel)*verticalScale;
    return output;
  }
  root.OrbitTerrainElevation=Object.freeze({create,normalize,transform,sampleSphere});
})(globalThis);
