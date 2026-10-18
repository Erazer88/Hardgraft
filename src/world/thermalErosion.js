(function(root){
  'use strict';
  let cached=null;
  function topology(width,height) {
    if(cached?.width===width && cached.height===height)return cached;
    const w=Math.max(1,width-1),rows=height-2,count=w*rows+2;
    const area=new Float64Array(count),north=0,south=count-1,dl=Math.PI/(height-1),dx=2*Math.PI/w;
    const node=(x,y)=>y===0?north:y===height-1?south:1+(y-1)*w+(x+w)%w;
    area[north]=area[south]=2*Math.PI*(1-Math.cos(dl*.5));
    for(let y=1;y<height-1;y++) {
      const lat=(.5-y/(height-1))*Math.PI;
      const a=dx*(Math.sin(lat+dl*.5)-Math.sin(lat-dl*.5));
      for(let x=0;x<w;x++)area[node(x,y)]=a;
    }
    const capacity=2*w*Math.max(1,height-1),a=new Uint32Array(capacity),b=new Uint32Array(capacity);
    const angles=new Float32Array(capacity),mass=new Float64Array(capacity),degree=new Float64Array(count);
    let edges=0;
    function add(i,j,angle) {
      if(i===j)return;
      a[edges]=i;b[edges]=j;angles[edges]=angle;
      const m=Math.min(area[i],area[j]);mass[edges]=m;degree[i]+=m/area[i];degree[j]+=m/area[j];edges++;
    }
    for(let y=1;y<height-1;y++) {
      const lat=(.5-y/(height-1))*Math.PI;
      const horizontal=Math.acos(Math.min(1,Math.sin(lat)**2+Math.cos(lat)**2*Math.cos(dx)));
      for(let x=0;x<w;x++) {
        if(w>2 || (w===2 && x===0))add(node(x,y),node(x+1,y),horizontal);
        add(node(x,y),node(x,y-1),dl);
        if(y===height-2)add(node(x,y),south,dl);
      }
    }
    for(let e=0;e<edges;e++)mass[e]/=Math.max(degree[a[e]],degree[b[e]],1);
    cached={width,height,w,count,area,a,b,angles,mass,edges,node};
    return cached;
  }
  function erode(input,width,height,settings=root.OrbitWorldgenData.terrain.tectonics.erosion) {
    if(height<3 || width<2 || settings.passes<=0)return new Float32Array(input);
    const grid=topology(width,height),h=new Float64Array(grid.count),delta=new Float64Array(grid.count);
    h[0]=input[0];h[grid.count-1]=input[(height-1)*width];
    for(let y=1;y<height-1;y++)for(let x=0;x<grid.w;x++)h[grid.node(x,y)]=input[y*width+x];
    const {a,b,angles,mass,area,edges}=grid;
    // Every edge exchanges a surface-weighted mass. The pole is one node,
    // connected to its latitude ring, never a collection of independent UV cells.
    for(let pass=0;pass<settings.passes;pass++) {
      delta.fill(0);
      for(let e=0;e<edges;e++) {
        const i=a[e],j=b[e],difference=h[i]-h[j];
        const excess=Math.abs(difference)-settings.talusPerRadian*angles[e];
        if(excess<=0)continue;
        const flux=Math.sign(difference)*excess*settings.rate*mass[e];
        delta[i]-=flux/area[i];delta[j]+=flux/area[j];
      }
      for(let i=0;i<h.length;i++)h[i]+=delta[i];
    }
    const output=new Float32Array(input.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)output[y*width+x]=h[grid.node(x===width-1?0:x,y)];
    return output;
  }
  function surfaceIntegral(field,width,height) {
    if(width<2 || height<3)return field.reduce((a,b)=>a+b,0);
    const grid=topology(width,height);let total=field[0]*grid.area[0]+field[(height-1)*width]*grid.area[grid.count-1];
    for(let y=1;y<height-1;y++)for(let x=0;x<grid.w;x++)total+=field[y*width+x]*grid.area[grid.node(x,y)];
    return total;
  }
  root.OrbitThermalErosion=Object.freeze({erode,surfaceIntegral});
})(globalThis);
