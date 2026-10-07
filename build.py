#!/usr/bin/env python3
"""Export the prototype into one HTML file, with no network dependencies."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'dist'
OUT.mkdir(exist_ok=True)
html = (ROOT / 'index.html').read_text()
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + (ROOT / 'styles.css').read_text() + '</style>')
for name in ('world', 'app'):
    js = (ROOT / 'src' / f'{name}.js').read_text().replace('</script', '<\\/script')
    html = html.replace(f'<script src="src/{name}.js"></script>', '<script>\n' + js + '\n</script>')
destination = OUT / 'nereide-prototype.html'
destination.write_text(html)
(OUT / 'nereide-zoom-continu.html').write_text(html)
print(f'Export autonome : {destination} ({destination.stat().st_size:,} octets)')
with zipfile.ZipFile(OUT / 'nereide-sources.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for relative in ('index.html', 'styles.css', 'src/world.js', 'src/app.js', 'src/world.test.cjs', 'tests/browser-smoke.cjs', 'build.py', 'README.md', 'package.json', '.gitignore'):
        path = ROOT / relative
        if path.exists():
            archive.write(path, 'nereide/' + relative)
print(f'Sources : {OUT / "nereide-sources.zip"}')
