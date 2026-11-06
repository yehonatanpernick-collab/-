"""Download AWS Terrain Tiles (Terrarium encoding, USGS 3DEP/NED + bathymetry) covering the SF bbox."""
import math
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from overture_index import BBOX

Z = 14
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data/raw/dem")
os.makedirs(OUT, exist_ok=True)


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


x0, y0 = tile_xy(BBOX[0], BBOX[3], Z)
x1, y1 = tile_xy(BBOX[2], BBOX[1], Z)
jobs = [(x, y) for x in range(int(x0), int(x1) + 1) for y in range(int(y0), int(y1) + 1)]


def get(xy):
    x, y = xy
    p = os.path.join(OUT, f"{Z}_{x}_{y}.png")
    if not os.path.exists(p):
        urllib.request.urlretrieve(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png", p)
    return p


with ThreadPoolExecutor(16) as ex:
    list(ex.map(get, jobs))
print(len(jobs), "tiles", int(x0), int(x1), int(y0), int(y1))
