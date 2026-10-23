"""Build the versioned, offline HTML; no dependencies or remote resources."""
from pathlib import Path
import base64
import json
import mimetypes
import re
import zipfile

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'dist'
OUT.mkdir(exist_ok=True)
version = json.loads((ROOT / 'package.json').read_text())['version']
html = (ROOT / 'index.html').read_text()
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + (ROOT / 'styles.css').read_text() + '\n</style>')

def embed_script(match):
    path = (ROOT / match[1]).resolve()
    if not path.is_relative_to(ROOT / 'src'):
        raise ValueError('Script outside src: ' + match[1])
    return '<script>\n' + path.read_text().replace('</script', '<\\/script') + '\n</script>'

html = re.sub(r'<script src="([^"]+)"></script>', embed_script, html)
for path in sorted((ROOT / 'assets').glob('*')):
    if path.is_file():
        mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        data = base64.b64encode(path.read_bytes()).decode('ascii')
        html = html.replace('assets/' + path.name, f'data:{mime};base64,{data}')
if re.search(r'<script\s+src=|<link[^>]+href="styles.css"|[\"\x27]assets/', html):
    raise ValueError('An external application resource remains in the standalone HTML')
for name in ['index.html', 'nereide-atlas-v0.1.html']:
    (OUT / name).write_text(html)
with zipfile.ZipFile(OUT / 'nereide-atlas-v0.1-sources.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(ROOT.rglob('*')):
        relative = path.relative_to(ROOT)
        if path.is_file() and relative.parts[0] in {'src', 'assets', 'tests'}:
            archive.write(path, 'planet_demo/' + relative.as_posix())
    for name in ['index.html', 'styles.css', 'build.py', 'package.json', 'README.md', 'CHANGELOG.md', 'VALIDATION.md']:
        if (ROOT / name).is_file(): archive.write(ROOT / name, 'planet_demo/' + name)
    archive.writestr('planet_demo/dist/nereide-atlas-v0.1.html', html)
print(f'Néréide atlas {version}: {len(html.encode()):,} bytes, standalone HTML + source ZIP')
