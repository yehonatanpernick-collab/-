"""Download CC0 assets: ambientCG facades + Poly Haven HDRI and street textures into tools/raw/assets."""
import json, os, subprocess, urllib.request, zipfile, io, sys
OUT = os.path.join(os.path.dirname(__file__), 'raw', 'assets'); os.makedirs(OUT, exist_ok=True)
def get(url):
    return subprocess.run(['curl', '-sSL', '--fail', '--retry', '3', '--max-time', '300', url], capture_output=True, check=True).stdout
FACADES = ['Facade001', 'Facade005', 'Facade006', 'Facade012', 'Facade014', 'Facade018A', 'Facade018C', 'Facade019A', 'Facade019C', 'Facade020A', 'Facade020C']
for f in FACADES:
    d = os.path.join(OUT, f)
    if os.path.isdir(d) and os.listdir(d): continue
    z = zipfile.ZipFile(io.BytesIO(get(f'https://ambientcg.com/get?file={f}_2K-JPG.zip')))
    os.makedirs(d, exist_ok=True)
    for n in z.namelist():
        if n.lower().endswith('.jpg') and any(k in n for k in ['Color', 'NormalGL', 'Roughness', 'Metalness', 'Emission', 'AmbientOcclusion']):
            open(os.path.join(d, os.path.basename(n)), 'wb').write(z.read(n))
    print(f, sorted(os.listdir(d)))
PH = {'asphalt_02': ['Diffuse', 'nor_gl', 'Rough'], 'concrete_pavement': ['Diffuse', 'nor_gl', 'Rough'], 'granite_tile': ['Diffuse', 'nor_gl', 'Rough'], 'brick_floor_02': ['Diffuse', 'nor_gl', 'Rough']}
for tid, maps in PH.items():
    files = json.loads(get(f'https://api.polyhaven.com/files/{tid}'))
    d = os.path.join(OUT, tid); os.makedirs(d, exist_ok=True)
    for m in maps:
        if m not in files: print('missing', tid, m, list(files)); continue
        url = files[m]['1k']['jpg']['url']; open(os.path.join(d, m + '.jpg'), 'wb').write(get(url))
    print(tid, os.listdir(d))
for h in ['kloofendal_48d_partly_cloudy_puresky', 'qwantani_dusk_2_puresky', 'kloppenheim_02_puresky']:
    p = os.path.join(OUT, h + '_2k.hdr')
    if not os.path.exists(p):
        files = json.loads(get(f'https://api.polyhaven.com/files/{h}'))
        open(p, 'wb').write(get(files['hdri']['2k']['hdr']['url']))
    print(h, os.path.getsize(p))
