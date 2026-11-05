#!/usr/bin/env python3
"""Concatenate src/ into a single self-contained HTML page.
Outputs: index.html (full document) and dist/artifact.html (body-only, for Claude artifacts)."""
import glob, os
here = os.path.dirname(os.path.abspath(__file__))
shell = open(os.path.join(here, 'src/shell.html'), encoding='utf-8').read()
js = '\n'.join(open(f, encoding='utf-8').read() for f in sorted(glob.glob(os.path.join(here, 'src/[0-9]*.js'))))
page = shell.replace('/*__JS__*/', js)
os.makedirs(os.path.join(here, 'dist'), exist_ok=True)
open(os.path.join(here, 'dist/artifact.html'), 'w', encoding='utf-8').write(page)
full = '<!doctype html>\n<html lang="he" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n' + page.replace('<canvas id="gl">', '</head>\n<body>\n<canvas id="gl">', 1) + '\n</body>\n</html>\n'
open(os.path.join(here, 'index.html'), 'w', encoding='utf-8').write(full)
print('built', len(full)//1024, 'KB')
