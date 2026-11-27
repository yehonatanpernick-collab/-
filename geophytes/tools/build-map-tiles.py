"""בונה את תמונות הרקע של המפה (לוויין + מצויר) מאריחי EOX (Sentinel-2 cloudless 2020 / Terrain Light) לשטח ישראל.
כל רמת זום מודבקת לתמונה אחת (או לכמה פסים), כי ב-Artifact אי אפשר לטעון אריחים מהרשת בזמן ריצה.
פלט: map/<layer><z>[<band>].jpg  +  js/mapmeta.js
Sentinel-2 cloudless: EOX IT Services GmbH, Contains modified Copernicus Sentinel data 2020 (CC BY-NC-SA 4.0). Terrain Light: EOX, OpenStreetMap + SRTM/GMTED.
"""
import json, math, os, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAT0, LAT1, LON0, LON1 = 29.35, 33.55, 34.1, 36.05
LAYERS = {'sat': 's2cloudless-2020_3857', 'ter': 'terrain-light_3857'}
ZOOMS = [9, 10, 11]
BANDS = 3  # פסים לרמת הזום הגבוהה

def tile(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y

def fetch(args):
    layer, z, x, y = args
    url = f'https://tiles.maps.eox.at/wmts/1.0.0/{layer}/default/g/{z}/{y}/{x}.jpg'
    for _ in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'geophytes-app/1.0 (personal field checklist)'})
            return (x, y), urllib.request.urlopen(req, timeout=40).read()
        except Exception:
            pass
    return (x, y), None

meta = {'bbox': [LAT0, LAT1, LON0, LON1], 'levels': {}}
os.makedirs(os.path.join(ROOT, 'map'), exist_ok=True)
for style, layer in LAYERS.items():
    for z in ZOOMS:
        x0, y1 = tile(LAT0, LON0, z)
        x1, y0 = tile(LAT1, LON1, z)
        nx, ny = x1 - x0 + 1, y1 - y0 + 1
        jobs = [(layer, z, x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
        with ThreadPoolExecutor(6) as ex:
            res = dict(ex.map(fetch, jobs))
        im = Image.new('RGB', (nx * 256, ny * 256), (230, 230, 230))
        miss = 0
        import io
        for (x, y), data in res.items():
            if data is None:
                miss += 1
                continue
            im.paste(Image.open(io.BytesIO(data)).convert('RGB'), ((x - x0) * 256, (y - y0) * 256))
        bands = BANDS if z == max(ZOOMS) else 1
        rows = math.ceil(ny / bands)
        files = []
        for b in range(bands):
            r0, r1 = b * rows, min(ny, (b + 1) * rows)
            if r0 >= r1:
                break
            part = im.crop((0, r0 * 256, nx * 256, r1 * 256))
            name = f'map/{style}{z}' + ('abc'[b] if bands > 1 else '') + '.jpg'
            part.save(os.path.join(ROOT, name), 'JPEG', quality=78 if style == 'sat' else 82, optimize=True, progressive=True)
            files.append(dict(file=name, y=y0 + r0, rows=r1 - r0))
        meta['levels'].setdefault(style, {})[str(z)] = dict(x0=x0, cols=nx, files=files)
        print(style, z, nx, ny, 'missing', miss, [os.path.getsize(os.path.join(ROOT, f['file'])) // 1024 for f in files], 'KB')
open(os.path.join(ROOT, 'js', 'mapmeta.js'), 'w').write('// נוצר אוטומטית ע"י tools/build-map-tiles.py\nexport const MAPMETA = ' + json.dumps(meta) + ';\n')
