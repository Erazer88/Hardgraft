"""Optional real-browser checks. Requires Playwright; no application dependency."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--browser', choices=['chromium', 'firefox'], default='chromium')
args = parser.parse_args()
base = os.environ.get('NEREIDE_BASE_URL', 'http://127.0.0.1:8000')
out = Path(os.environ.get('NEREIDE_QA_DIR', '/tmp/nereide-atlas-qa')) / args.browser
out.mkdir(parents=True, exist_ok=True)
report = {'browser': args.browser, 'checks': [], 'errors': []}

def check(condition, label):
    assert condition, label
    report['checks'].append(label)

def texture_hash(page):
    return page.evaluate('''async()=>{
      const canvas=NereideDemo.texture.canvas;
      const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      const digest=await crypto.subtle.digest('SHA-256',pixels);
      return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    }''')

with sync_playwright() as playwright:
    kind = getattr(playwright, args.browser)
    options = {'headless': True}
    if args.browser == 'chromium':
        options.update(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    browser = kind.launch(**options)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    page.on('pageerror', lambda error: report['errors'].append(str(error)))
    page.goto(base, wait_until='networkidle')
    page.wait_for_function('!!globalThis.NereideDemo?.texture', timeout=30000)
    check(page.evaluate('NereideDemo.texture.failedAssets.length === 0'), 'three supplied images decoded')
    initial = texture_hash(page)
    page.screenshot(path=str(out / 'desktop.png'), full_page=True)
    page.evaluate('async()=>{await NereideDemo.regenerate(false)}')
    check(texture_hash(page) == initial, 'same seed and settings reproduce exact pixels')
    page.locator('#grid').click()
    check(not page.evaluate('NereideDemo.globe.grid'), 'grid toggles')
    check(texture_hash(page) == initial, 'grid does not change surface texture')
    zoom = page.evaluate('NereideDemo.globe.zoom')
    page.locator('#zoom-in').click()
    check(page.evaluate('NereideDemo.globe.zoom') > zoom, 'zoom control works')
    page.locator('#globe').focus(); page.keyboard.press('ArrowRight')
    check(page.evaluate('NereideDemo.globe.longitude') != 0, 'keyboard rotation works')
    page.locator('#reset-view').click()
    check(page.evaluate('NereideDemo.globe.longitude === 0 && NereideDemo.globe.zoom === 1'), 'camera reset works')
    page.locator('#view-map').click()
    check(page.locator('#map-view').is_visible() and not page.locator('#globe').is_visible(), 'flat map view works')
    page.screenshot(path=str(out / 'map.png'), full_page=True)
    page.locator('#view-globe').click()
    for width, height in [(1440, 1000), (1024, 900), (390, 844), (320, 720)]:
        page.set_viewport_size({'width': width, 'height': height})
        dimensions = page.evaluate('''()=>{const c=document.querySelector('#globe').getBoundingClientRect();const s=document.querySelector('.stage').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,left:c.left>=s.left-.5,right:c.right<=s.right+.5}}''')
        check(dimensions['scroll'] <= width and dimensions['left'] and dimensions['right'], f'layout fits at {width}px')
        if width == 390: page.screenshot(path=str(out / 'mobile.png'), full_page=True)
    page.set_viewport_size({'width': 1440, 'height': 1000})
    for key in ['mountains', 'forests']:
        page.locator('#' + key).evaluate("el=>{el.value=0;el.dispatchEvent(new Event('input',{bubbles:true}))}")
    page.wait_for_function('NereideDemo.texture.world.options.mountains===0 && NereideDemo.texture.world.options.forests===0')
    check(page.evaluate('NereideDemo.texture.world.peaks.length===0 && NereideDemo.texture.world.trees.length===0'), 'zero sliders remove their layers')
    before = page.locator('#seed').input_value()
    page.locator('#randomize').click()
    page.wait_for_function('(seed)=>NereideAtlas.formatSeed(NereideDemo.texture.world.seed)!==seed', arg=before)
    check(texture_hash(page) != initial, 'Randomiser changes the world')
    config = {'continentSize': 27, 'mountains': 18, 'forests': 30, 'roughness': 58}
    for key, value in config.items(): page.locator('#' + key).evaluate('(el,value)=>{el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}))}', value)
    page.locator('#seed').fill('00000000'); page.locator('#seed').press('Enter')
    page.wait_for_function('NereideDemo.texture.world.seed===0 && NereideDemo.texture.world.options.roughness===58')
    check(page.locator('#seed').input_value() == '00000000', 'seed zero is replayable through UI')
    check('seed=00000000' in page.url and 'r=58' in page.url, 'URL includes seed and all settings')
    final_hash = texture_hash(page)
    with page.expect_download() as event: page.locator('#export-texture').click()
    png = out / 'texture.png'; event.value.save_as(png)
    check(struct.unpack('>II', png.read_bytes()[16:24]) == (1536, 768), 'PNG export is equirectangular 2:1')
    page.locator('#view-map').click()  # Also test exporting while the flat map is selected.
    with page.expect_download() as event: page.locator('#download-html').click()
    html = out / 'offline.html'; event.value.save_as(html)
    check('script src=' not in html.read_text(), 'HTML contains its scripts')
    if args.browser == 'firefox':
        offline = browser.new_context(offline=True)
        offline_page = offline.new_page()
        external = []
        offline_page.on('request', lambda request: external.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
        offline_page.on('pageerror', lambda error: report['errors'].append(str(error)))
        offline_page.goto(html.as_uri(), wait_until='load')
        offline_page.wait_for_function('!!globalThis.NereideDemo?.texture', timeout=30000)
        check(not external, 'downloaded HTML works without network')
        check(texture_hash(offline_page) == final_hash, 'downloaded HTML preserves seed zero and all settings')
        check(offline_page.locator('#globe').is_visible(), 'downloaded HTML initializes a coherent globe view')
        report['offline_file_check'] = 'passed in Firefox with network disabled'
    else:
        report['offline_file_check'] = 'covered by Firefox; managed Chromium policy blocks file URLs'
    page.locator('#seed').fill(''); page.locator('#seed').press('Enter')
    check('Saisis' in page.locator('#message').inner_text(), 'empty seed shows an actionable message')
    api = page.evaluate('''async()=>{
      let rejected=false;try{await NereideAtlas.generatePlanetTexture({seed:0,width:513})}catch(_){rejected=true}
      const start=performance.now();const result=await NereideAtlas.generatePlanetTexture({seed:0,width:512,height:256});
      const ctx=result.canvas.getContext('2d'), data=ctx.getImageData(0,0,512,256).data;
      let seam=true;for(let y=0;y<256;y++)for(let c=0;c<4;c++)if(Math.abs(data[(y*512)*4+c]-data[(y*512+511)*4+c])>1)seam=false;
      return {rejected,seam,width:result.width,height:result.height,cells:result.terrain.length,ms:performance.now()-start};
    }''')
    check(api['rejected'] and api['seam'] and api['cells'] == 8192, 'texture API validates ratio, returns terrain and has no longitude seam')
    report['texture_api_ms_512'] = round(api['ms'], 1)
    check(not report['errors'], 'no JavaScript exceptions')
    browser.close()
(out / 'checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
