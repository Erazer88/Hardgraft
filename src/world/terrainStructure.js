(function(root){
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const smooth=(a,b,n)=>{const t=clamp((n-a)/(b-a),0,1);return t*t*(3-2*t);};
  function derive(elevation,uplift,width,height,seaLevel,settings=root.OrbitWorldgenData.terrain.tectonics.structure) {
    const mountainMask=new Uint8Array(width*height),ridgeField=new Uint8Array(width*height),
      valleyField=new Uint8Array(width*height),ruggednessField=new Uint8Array(width*height);
    const fields=[mountainMask,ridgeField,valleyField,ruggednessField];
    const p={},q={},sample=root.OrbitTerrainElevation.sampleSphere;
    const angle=settings.sampleAngle,coarse=settings.coarseAngle;
    const ca=Math.cos(angle),sa=Math.sin(angle),cc=Math.cos(coarse),sc=Math.sin(coarse),diagonal=Math.SQRT1_2;
    const stencil=[[1,0],[-1,0],[0,1],[0,-1],[diagonal,diagonal],[-diagonal,diagonal],[diagonal,-diagonal],[-diagonal,-diagonal]];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const i=y*width+x;
      if((x && (y===0 || y===height-1)) || (x===width-1 && width>1)) {
        for(const field of fields)field[i]=field[y*width];continue;
      }
      const h=elevation[i];if(h<=seaLevel)continue;
      root.OrbitWorld.directionForPixel(x,y,width,height,p);
      const horizontal=Math.hypot(p.x,p.z);
      const ex=horizontal>1e-8?-p.z/horizontal:0,ez=horizontal>1e-8?p.x/horizontal:1;
      const nx=p.y*ez,ny=p.z*ex-p.x*ez,nz=-p.y*ex;
      let slope=0,mean=0,variance=0;
      for(let k=0;k<8;k++) {
        const [u,v]=stencil[k],tx=ex*u+nx*v,ty=ny*v,tz=ez*u+nz*v;
        if(k<4) {
          q.x=p.x*ca+tx*sa;q.y=p.y*ca+ty*sa;q.z=p.z*ca+tz*sa;
          slope=Math.max(slope,Math.abs(sample(elevation,q,width,height)-h)/angle);
        }
        q.x=p.x*cc+tx*sc;q.y=p.y*cc+ty*sc;q.z=p.z*cc+tz*sc;
        const neighbor=sample(elevation,q,width,height);mean+=neighbor;variance+=(neighbor-h)**2;
      }
      mean/=8;variance=Math.sqrt(variance/8);
      const altitude=clamp((h-seaLevel)/Math.max(1,255-seaLevel),0,1),convexity=h-mean;
      const slopeMask=smooth(settings.slopeRange[0],settings.slopeRange[1],slope);
      const relative=smooth(.09,.38,altitude);
      const land=smooth(seaLevel,seaLevel+5,h);
      const mountain=land*smooth(settings.upliftRange[0],settings.upliftRange[1],uplift[i])*
        (.25+.75*Math.max(relative,slopeMask));
      const crest=smooth(settings.convexityRange[0],settings.convexityRange[1],convexity)*
        (.2+.8*slopeMask)*smooth(.04,.24,altitude);
      mountainMask[i]=Math.round(mountain*255);
      ridgeField[i]=Math.round(mountain*crest*255);
      valleyField[i]=Math.round(land*smooth(.2,2.8,-convexity)*(.25+.75*mountain)*(.35+.65*slopeMask)*255);
      ruggednessField[i]=Math.round(land*smooth(30,330,slope+variance/coarse*.18)*255);
    }
    return {mountainMask,ridgeField,valleyField,ruggednessField};
  }
  root.OrbitTerrainStructure=Object.freeze({derive});
})(globalThis);
