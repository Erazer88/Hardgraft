(function () {
  'use strict';
  const A = globalThis.NereideAtlas, byId = id => document.getElementById(id);
  const globe = new A.Globe(byId('globe'));
  const keys = Object.keys(A.defaults), queryKeys = {continentSize: 'c', mountains: 'm', forests: 'f', roughness: 'r'};
  let texture = null, request = 0, timer, mapMode = false;
  const parameters = new URLSearchParams(location.search);
  let initial = {};
  try {initial = JSON.parse(byId('initial-state').textContent);} catch (_) { /* A damaged preset uses defaults. */ }
  byId('seed').value = parameters.get('seed') ?? initial.seed ?? '4E455245';
  for (const key of keys) {
    const value = parameters.get(queryKeys[key]) ?? initial[key] ?? A.defaults[key];
    byId(key).value = A.clamp(Number.isFinite(Number(value)) ? Number(value) : A.defaults[key], 0, 100);
  }
  function values() {
    return {seed: A.parseSeed(byId('seed').value), ...Object.fromEntries(keys.map(key => [key, Number(byId(key).value)]))};
  }
  function updateRanges() {
    for (const key of keys) {
      byId(key + '-value').value = byId(key).value;
      byId(key).style.setProperty('--position', byId(key).value + '%');
    }
  }
  function message(text, error) {byId('message').textContent = text; byId('message').classList.toggle('error', !!error);}
  function urlFor(config) {
    const url = new URL(location.href); url.search = ''; url.hash = '';
    url.searchParams.set('seed', A.formatSeed(config.seed));
    for (const key of keys) url.searchParams.set(queryKeys[key], config[key]);
    return url;
  }
  async function regenerate(resetView) {
    let config;
    try {config = values();} catch (error) {message(error.message, true); return;}
    const id = ++request;
    updateRanges(); byId('loading').hidden = false; byId('visual').setAttribute('aria-busy', 'true');
    message('');
    try {
      // Let the loading state paint before the synchronous Canvas composition.
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      if (id !== request) return;
      const generated = await A.generatePlanetTexture(config);
      if (id !== request) return;
      texture = generated;
      globe.setTexture(texture); if (resetView) globe.reset();
      const map = byId('map'); map.width = texture.width; map.height = texture.height;
      map.getContext('2d').drawImage(texture.canvas, 0, 0);
      byId('seed').value = A.formatSeed(texture.world.seed);
      const mains = texture.world.rivers.filter(river => river.order === 'main').length;
      const tributaries = texture.world.rivers.length - mains;
      byId('world-stats').textContent = `${texture.world.chains.length} massifs · ${mains} rivières · ${tributaries} affluents · ${texture.world.islands.length} îles · ${texture.world.lakes.length} lacs`;
      try {history.replaceState(null, '', urlFor(config));} catch (_) { /* file:// can disallow history changes. */ }
      if (texture.failedAssets.length) message('Quelques illustrations sont indisponibles ; les motifs vectoriels prennent le relais.');
      byId('export-texture').disabled = false;
      byId('globe').setAttribute('aria-label', `Globe de Néréide, seed ${A.formatSeed(config.seed)}. Glisser ou utiliser les flèches pour tourner.`);
      document.dispatchEvent(new CustomEvent('nereide:ready', {detail: {seed: config.seed}}));
    } catch (error) {if (id === request) message('Génération impossible : ' + error.message, true);}
    finally {if (id === request) {byId('loading').hidden = true; byId('visual').setAttribute('aria-busy', 'false');}}
  }
  byId('export-texture').disabled = true;
  byId('seed-form').addEventListener('submit', event => {event.preventDefault(); clearTimeout(timer); regenerate(true);});
  for (const key of keys) byId(key).addEventListener('input', () => {
    updateRanges(); clearTimeout(timer); timer = setTimeout(() => regenerate(false), 160);
  });
  byId('randomize').addEventListener('click', () => {
    clearTimeout(timer);
    const current = texture ? texture.world.seed : A.parseSeed(byId('seed').value || 'Nereide');
    let next;
    do {next = crypto.getRandomValues(new Uint32Array(1))[0];} while (next === current);
    byId('seed').value = A.formatSeed(next); regenerate(true);
  });
  function setView(map) {
    mapMode = map; byId('globe').hidden = map; byId('map-view').hidden = !map;
    document.querySelector('.stage').classList.toggle('map-mode', map);
    for (const [name, selected] of [['globe', !map], ['map', map]]) {
      byId('view-' + name).classList.toggle('selected', selected); byId('view-' + name).setAttribute('aria-pressed', String(selected));
    }
    for (const id of ['grid', 'zoom-in', 'zoom-out', 'reset-view']) byId(id).disabled = map;
    byId('gesture').textContent = map ? 'La surface, à plat' : 'Glisser pour explorer';
    if (!map) globe.request();
  }
  byId('view-globe').addEventListener('click', () => setView(false));
  byId('view-map').addEventListener('click', () => setView(true));
  byId('grid').addEventListener('click', () => {
    globe.grid = !globe.grid; byId('grid').setAttribute('aria-pressed', String(globe.grid));
    byId('grid').classList.toggle('active', globe.grid); globe.request();
  });
  byId('zoom-in').addEventListener('click', () => globe.setZoom(globe.zoom * 1.12));
  byId('zoom-out').addEventListener('click', () => globe.setZoom(globe.zoom / 1.12));
  byId('reset-view').addEventListener('click', () => globe.reset());
  byId('share').addEventListener('click', async () => {
    try {
      const config = texture ? {seed: texture.world.seed, ...texture.world.options} : values();
      const text = location.protocol === 'file:' ? JSON.stringify({...config, seed: A.formatSeed(config.seed)}) : urlFor(config).href;
      await navigator.clipboard.writeText(text); message(location.protocol === 'file:' ? 'Seed et réglages copiés.' : 'Lien de cette planète copié.');
    } catch (_) {message('La copie est indisponible. La seed reste sélectionnable et le lien est dans la barre d’adresse.'); byId('seed').select();}
  });
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  byId('export-texture').addEventListener('click', () => {
    if (!texture) return;
    texture.canvas.toBlob(blob => {
      if (blob) {download(blob, `nereide-${A.formatSeed(texture.world.seed)}-texture.png`); message('Carte exportée. Le halo et la grille restent sur le globe.');}
      else message('L’export de la carte a échoué.', true);
    }, 'image/png');
  });
  byId('download-html').addEventListener('click', event => {
    if (document.querySelector('script[src]')) return; // Source mode: use the generated standalone link.
    event.preventDefault();
    const copy = document.documentElement.cloneNode(true);
    const config = texture ? {seed: A.formatSeed(texture.world.seed), ...texture.world.options} : {seed: byId('seed').value};
    copy.querySelector('#initial-state').textContent = JSON.stringify(config);
    copy.querySelector('#message').textContent = '';
    download(new Blob(['<!doctype html>\n' + copy.outerHTML], {type: 'text/html;charset=utf-8'}), 'nereide-atlas-v0.3.html');
    message('Démo autonome téléchargée avec la seed et les réglages actuels.');
  });
  globalThis.NereideDemo = {globe, regenerate, get texture() {return texture;}, get mapMode() {return mapMode;}};
  updateRanges(); setView(false); regenerate(false);
})();
