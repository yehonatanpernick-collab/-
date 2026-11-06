"""Distant backdrop terrain (Marin Headlands, Mt Tamalpais, East Bay hills, Angel Island, Peninsula):
a coarse 120 m heightmap over ~70 x 70 km from AWS Terrain Tiles (z11), in the same local projection."""
import math, os, urllib.request
import numpy as np
from PIL import Image
from geo import KX, KY, LAT0, LON0
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "public/data/backdrop.bin.png")
Z = 11; R = 36000; STEP = 120
N = int(2 * R / STEP) + 1
lon0, lon1 = LON0 - R / KX, LON0 + R / KX
lat0, lat1 = LAT0 - R / KY, LAT0 + R / KY
def txy(lon, lat):
    n = 2 ** Z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
x0, y0 = txy(lon0, lat1); x1, y1 = txy(lon1, lat0)
xs = range(int(x0), int(x1) + 1); ys = range(int(y0), int(y1) + 1)
d = os.path.join(ROOT, "data/raw/dem11"); os.makedirs(d, exist_ok=True)
mos = np.zeros((len(ys) * 256, len(xs) * 256), np.float32)
for i, x in enumerate(xs):
    for j, y in enumerate(ys):
        p = os.path.join(d, f"{x}_{y}.png")
        if not os.path.exists(p):
            urllib.request.urlretrieve(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png", p)
        im = np.asarray(Image.open(p).convert("RGB")).astype(np.float32)
        mos[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256 - 32768
g = np.arange(N) * STEP - R
GX, GZ = np.meshgrid(g, g)
lon = LON0 + GX / KX; lat = LAT0 - GZ / KY
n = 2 ** Z
px = ((lon + 180) / 360 * n - xs[0]) * 256 - 0.5
py = ((1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n - ys[0]) * 256 - 0.5
i0 = np.clip(px.astype(int), 0, mos.shape[1] - 2); j0 = np.clip(py.astype(int), 0, mos.shape[0] - 2)
fx = px - i0; fy = py - j0
H = mos[j0, i0] * (1 - fx) * (1 - fy) + mos[j0, i0 + 1] * fx * (1 - fy) + mos[j0 + 1, i0] * (1 - fx) * fy + mos[j0 + 1, i0 + 1] * fx * fy
np.round(H).astype(np.int16).tofile(OUT)
print("backdrop", N, "x", N, "max", H.max(), "->", OUT)
