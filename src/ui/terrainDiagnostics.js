(function(root){
  'use strict';
  const definitions=Object.freeze([
    {id:'plateId',label:'Plaques · IDs',max:24},
    {id:'continentalField',label:'Champ continental',max:1},
    {id:'convergence',label:'Convergence',max:1},
    {id:'divergence',label:'Divergence',max:1},
    {id:'tectonicUplift',label:'Uplift tectonique',max:90},
    {id:'rawElevation',label:'Hauteur brute · avant érosion',max:255},
    {id:'erodedElevation',label:'Hauteur finale · après érosion',max:255},
    {id:'mountainMask',label:'Massifs',max:255},
    {id:'ridgeField',label:'Crêtes',max:255},
    {id:'valleyField',label:'Vallées',max:255},
    {id:'ruggednessField',label:'Rugosité',max:255}
  ]);
  function pixelsFor(terrain,id) {
    const definition=definitions.find(d=>d.id===id),field=terrain?.diagnostics?.[id];
    if(!definition || !field)return null;
    const pixels=new Uint8ClampedArray(terrain.width*terrain.height*4);
    for(let i=0;i<field.length;i++) {
      const offset=i*4;
      if(id==='plateId') {
        const n=(field[i]*0.618033988749895)%1;
        for(let k=0;k<3;k++)pixels[offset+k]=Math.round(125+80*Math.cos(2*Math.PI*(n+k/3)));
      } else {
        const value=Math.round(Math.max(0,Math.min(1,field[i]/definition.max))*255);
        pixels[offset]=pixels[offset+1]=pixels[offset+2]=value;
      }
      pixels[offset+3]=255;
    }
    return pixels;
  }
  function create(document,options={}) {
    const $=id=>document.getElementById(id),dialog=$('terrain-diagnostics-dialog');
    const select=$('terrain-diagnostics-field'),canvas=$('terrain-diagnostics-canvas');
    let current=null;
    for(const definition of definitions) {
      const option=document.createElement('option');option.value=definition.id;option.textContent=definition.label;select.append(option);
    }
    select.value='erodedElevation';
    function draw() {
      const terrain=current?.terrain,pixels=pixelsFor(terrain,select.value);
      canvas.hidden=!pixels;
      $('terrain-diagnostics-export').disabled=!pixels;
      if(!pixels) {$('terrain-diagnostics-status').textContent='Ouvrez une planète pour inspecter son terrain.';return;}
      canvas.width=terrain.width;canvas.height=terrain.height;
      const context=canvas.getContext('2d'),image=context.createImageData(terrain.width,terrain.height);
      image.data.set(pixels);context.putImageData(image,0,0);
      let delta=0,maxDelta=0;
      const {rawElevation,erodedElevation}=terrain.diagnostics;
      for(let i=0;i<rawElevation.length;i++){const n=Math.abs(rawElevation[i]-erodedElevation[i]);delta+=n;maxDelta=Math.max(maxDelta,n);}
      const definition=definitions.find(d=>d.id===select.value);
      $('terrain-diagnostics-status').textContent=`${current.planet?.name || 'Planète'} · seed ${current.planet?.seed ?? ''} · ${terrain.width} × ${terrain.height} · ${terrain.tectonics.plates.length} plaques · niveau marin ${terrain.seaLevel}`;
      $('terrain-diagnostics-legend').textContent=select.value==='plateId' ? 'Couleurs = identifiants des plaques.' :
        `Noir = 0 · Blanc = ${definition.max}. Hauteurs avant/après à la même échelle. Érosion : Δ moyen ${(delta/rawElevation.length).toFixed(3)}, max ${maxDelta.toFixed(2)}.`;
    }
    select.addEventListener('change',draw);
    $('terrain-diagnostics-close').addEventListener('click',()=>dialog.close());
    $('terrain-diagnostics-export').addEventListener('click',()=>{
      const anchor=document.createElement('a');anchor.href=canvas.toDataURL('image/png');
      anchor.download=`terrain-${current?.planet?.seed ?? 'diagnostic'}-${select.value}.png`;anchor.click();
    });
    return Object.freeze({open(){current=options.getTerrain?.() || null;draw();dialog.showModal();}});
  }
  root.OrbitTerrainDiagnostics=Object.freeze({definitions,pixelsFor,create});
})(globalThis);
