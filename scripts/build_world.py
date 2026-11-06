"""SAN FRANCISCO: SKYDRIVE — geographic preprocessing pipeline.

Inputs  (data/raw):  Overture Maps parquet subsets (OSM-derived) + AWS Terrarium DEM tiles.
Outputs (public/data):
  world.json        global metadata: projection, grid, tile index, landmarks, neighbourhoods, lakes, coast
  height.bin        Int16 terrain heights (decimetres), GH x GW row-major (z rows, x columns)
  surface.bin       Uint8 surface class raster (same grid)
  roads.bin/.json   global road graph (nodes, edges, polylines) used by traffic AI, map and road meshes
  peds.json         pedestrian graph (real footways / sidewalks / crossings)
  tiles/T_i_j.json  per-tile buildings, road pieces, trees, lamps, signals, street furniture, piers
"""
import json
import math
import os
import random
import struct
import sys
import time
import zlib
from collections import defaultdict

import numpy as np
import pyarrow.parquet as pq
import shapely
from PIL import Image
from shapely import STRtree
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import transform

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import GH, GRID, GW, KX, KY, LAT0, LON0, TILE, X0, X1, Z0, Z1, to_local, to_lonlat  # noqa

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RAW = os.path.join(ROOT, "data/raw")
OUT = os.path.join(ROOT, "public/data")
os.makedirs(os.path.join(OUT, "tiles"), exist_ok=True)
random.seed(1906)
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def proj(g):
    return shapely.ops.transform(lambda x, y, z=None: ((np.asarray(x) - LON0) * KX, -(np.asarray(y) - LAT0) * KY), g)


def read(name, cols=None):
    t = pq.read_table(os.path.join(RAW, name + ".parquet"), columns=cols)
    return t.to_pylist()


# ---------------------------------------------------------------- 1. DEM
log("DEM mosaic")
Z = 14
dem_dir = os.path.join(RAW, "dem")
tiles = [f for f in os.listdir(dem_dir) if f.endswith(".png")]
xs = sorted({int(f.split("_")[1]) for f in tiles}); ys = sorted({int(f.split("_")[2][:-4]) for f in tiles})
mosaic = np.zeros(((ys[-1] - ys[0] + 1) * 256, (xs[-1] - xs[0] + 1) * 256), np.float32)
for f in tiles:
    _, tx, ty = f[:-4].split("_"); tx, ty = int(tx), int(ty)
    im = np.asarray(Image.open(os.path.join(dem_dir, f)).convert("RGB")).astype(np.float32)
    h = im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256 - 32768
    mosaic[(ty - ys[0]) * 256:(ty - ys[0] + 1) * 256, (tx - xs[0]) * 256:(tx - xs[0] + 1) * 256] = h

gx = X0 + np.arange(GW) * GRID
gz = Z0 + np.arange(GH) * GRID
GX, GZ = np.meshgrid(gx, gz)
lon = LON0 + GX / KX
lat = LAT0 - GZ / KY
n = 2 ** Z
px = (lon + 180) / 360 * n * 256 - xs[0] * 256
py = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n * 256 - ys[0] * 256
px -= 0.5; py -= 0.5
x0i = np.clip(np.floor(px).astype(int), 0, mosaic.shape[1] - 2); y0i = np.clip(np.floor(py).astype(int), 0, mosaic.shape[0] - 2)
fx = np.clip(px - x0i, 0, 1); fy = np.clip(py - y0i, 0, 1)
H = (mosaic[y0i, x0i] * (1 - fx) * (1 - fy) + mosaic[y0i, x0i + 1] * fx * (1 - fy)
     + mosaic[y0i + 1, x0i] * (1 - fx) * fy + mosaic[y0i + 1, x0i + 1] * fx * fy).astype(np.float32)
log("DEM grid", H.shape, "min", H.min(), "max", H.max())

# ---------------------------------------------------------------- 2. land / water / surface
log("land & water")
land_rows = read("land", ["subtype", "class", "geometry", "names"])
water_rows = read("water", ["subtype", "class", "geometry", "names", "is_salt"]) if True else []
lu_rows = read("land_use", ["subtype", "class", "geometry", "names"])


def geoms(rows, pred):
    out = []
    for r in rows:
        if pred(r):
            g = shapely.from_wkb(r["geometry"])
            if g.geom_type in ("Polygon", "MultiPolygon"):
                out.append(proj(g).buffer(0))
    return out


land_polys = geoms(land_rows, lambda r: r["subtype"] == "land")
salt_water = geoms(water_rows, lambda r: r["subtype"] in ("ocean", "physical") and r["class"] in ("ocean", "bay", "strait"))
lakes = geoms(water_rows, lambda r: r["subtype"] in ("lake", "pond", "reservoir") or (r["subtype"] == "water" and r["class"] in ("water", "lagoon")))
log("land polys", len(land_polys), "salt", len(salt_water), "lakes", len(lakes))
land_u = shapely.union_all(land_polys) if land_polys else None
salt_u = shapely.union_all(salt_water) if salt_water else None

flatx = GX.ravel(); flatz = GZ.ravel()


def mask_of(geom):
    if geom is None or geom.is_empty:
        return np.zeros(GX.shape, bool)
    shapely.prepare(geom)
    return shapely.contains_xy(geom, flatx, flatz).reshape(GX.shape)


is_land = mask_of(land_u)
is_salt = mask_of(salt_u) & ~is_land
log("land cells", is_land.sum(), "salt cells", is_salt.sum())
# Outside the land polygons is sea (coastline-derived land polygons).
SEA = ~is_land

SURF = np.zeros(GX.shape, np.uint8)   # 0 urban, 1 grass/park, 2 forest, 3 sand, 4 rock, 5 scrub, 6 sea, 7 lake, 8 golf
park = geoms(lu_rows, lambda r: r["subtype"] in ("park", "recreation", "managed", "horticulture", "cemetery", "agriculture") and r["class"] not in ("pitch_court", "track", "playground"))
park += geoms(land_rows, lambda r: r["subtype"] == "grass")
golf = geoms(lu_rows, lambda r: r["subtype"] == "golf")
forest = geoms(land_rows, lambda r: r["subtype"] in ("forest",)) + geoms(lu_rows, lambda r: r["class"] in ("forest", "wood"))
sand = geoms(land_rows, lambda r: r["subtype"] == "sand") + geoms(lu_rows, lambda r: r["class"] == "beach")
rock = geoms(land_rows, lambda r: r["subtype"] == "rock" or r["class"] == "cliff")
scrub = geoms(land_rows, lambda r: r["subtype"] in ("shrub", "wetland"))
for cls, gl in ((1, park), (8, golf), (5, scrub), (2, forest), (3, sand), (4, rock)):
    if gl:
        m = mask_of(shapely.union_all(gl))
        SURF[m] = cls
lake_u = shapely.union_all(lakes) if lakes else None
lake_m = mask_of(lake_u) & is_land
SURF[lake_m] = 7
SURF[SEA] = 6

# terrain conditioning so that the 3D coastline follows the vector coastline exactly
H = np.where(SEA, np.minimum(H, -1.5), np.maximum(H, 0.8))
# smooth seabed slightly to avoid DEM artefacts
log("surface done")

# ------- lakes: flatten to their own water level
lake_out = []
for g in lakes:
    polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
    for p in polys:
        if p.area < 400:
            continue
        mm = mask_of(p)
        if mm.sum() == 0:
            continue
        lvl = float(np.percentile(H[mm], 10))
        H[mm] = np.minimum(H[mm], lvl - 1.2)
        ext = list(p.simplify(1.5).exterior.coords)
        lake_out.append({"y": round(lvl - 0.2, 2), "p": [round(c, 1) for xy in ext for c in xy]})
log("lakes", len(lake_out))
HQ = (np.round(H * 10) / 10).astype(np.float32)


# ---------------------------------------------------------------- terrain sampler (same triangulation as runtime)
def h_at(x, z):
    fx = (x - X0) / GRID; fz = (z - Z0) / GRID
    i = min(max(int(math.floor(fx)), 0), GW - 2); j = min(max(int(math.floor(fz)), 0), GH - 2)
    u = min(max(fx - i, 0), 1); v = min(max(fz - j, 0), 1)
    h00 = HQ[j, i]; h10 = HQ[j, i + 1]; h01 = HQ[j + 1, i]; h11 = HQ[j + 1, i + 1]
    # triangles (00,01,10) and (10,01,11): split along the anti-diagonal
    if u + v <= 1:
        return float(h00 + (h10 - h00) * u + (h01 - h00) * v)
    return float(h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v))


# ---------------------------------------------------------------- 3. roads
log("roads")
seg_rows = read("segment", ["id", "names", "subtype", "class", "subclass", "connectors", "road_flags", "width_rules",
                            "level_rules", "access_restrictions", "speed_limits", "rail_flags", "geometry"])
con_rows = read("connector", ["id", "geometry"])
con_pos = {}
for r in con_rows:
    p = shapely.from_wkb(r["geometry"])
    con_pos[r["id"]] = to_local(p.x, p.y)

DRIVE = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4, "residential": 5,
         "living_street": 6, "unclassified": 6, "service": 7, "unknown": 7}
PED = {"footway", "steps", "path", "pedestrian", "cycleway", "track", "bridleway"}
WIDTH = {0: 11.5, 1: 11.0, 2: 13.0, 3: 12.0, 4: 10.5, 5: 9.0, 6: 7.5, 7: 5.5}
LANES = {0: 3, 1: 2, 2: 2, 3: 2, 4: 1, 5: 1, 6: 1, 7: 1}
SPEED = {0: 26.8, 1: 20.1, 2: 13.4, 3: 13.4, 4: 11.2, 5: 11.2, 6: 6.7, 7: 6.7}


def flag_frac(rules, flag):
    """fraction of the segment that carries the flag (rules use 'between' linear referencing)."""
    tot = 0.0
    for f in rules or []:
        if flag in (f.get("values") or []):
            b = f.get("between") or [0, 1]
            tot += b[1] - b[0]
    return tot


def cut(line, a, b):
    """sub-line between length fractions a..b"""
    L = line.length
    return shapely.ops.substring(line, a * L, b * L) if L > 0 else line


import shapely.ops  # noqa

nodes = {}       # connector id -> node index
node_xy = []
edges = []       # drivable
ped_edges = []
rail_lines = []


def nid(cid, fallback):
    if cid not in nodes:
        nodes[cid] = len(node_xy)
        node_xy.append(con_pos.get(cid, fallback))
    return nodes[cid]


for r in seg_rows:
    g = proj(shapely.from_wkb(r["geometry"]))
    if g.geom_type != "LineString" or g.length < 0.5:
        continue
    cls = r["class"] or "unknown"
    name = (r["names"] or {}).get("primary") or ""
    if r["subtype"] == "rail":
        if cls in ("tram", "light_rail", "funicular") and flag_frac(r["rail_flags"], "is_tunnel") < 0.5:
            rail_lines.append({"c": cls, "n": name, "p": [round(v, 1) for xy in g.coords for v in xy]})
        continue
    if r["subtype"] != "road":
        continue
    conns = sorted(r["connectors"] or [], key=lambda c: c["at"])
    if len(conns) < 2:
        conns = [{"connector_id": r["id"] + ":a", "at": 0.0}, {"connector_id": r["id"] + ":b", "at": 1.0}]
    tunnel = flag_frac(r["road_flags"], "is_tunnel") > 0.5 or flag_frac(r["road_flags"], "is_covered") > 0.6
    bridge = flag_frac(r["road_flags"], "is_bridge") > 0.5
    lvl = 0
    for lr in r["level_rules"] or []:
        lvl = max(lvl, lr.get("value") or 0)
    oneway = 0
    for a in r["access_restrictions"] or []:
        w = a.get("when") or {}
        if a["access_type"] == "denied" and w.get("heading") and not w.get("mode") and not w.get("using") and not a.get("between"):
            oneway = 1 if w["heading"] == "backward" else -1
    width = None
    for wr in r["width_rules"] or []:
        if wr.get("value"):
            width = wr["value"]
    speed = None
    for sl in r["speed_limits"] or []:
        ms = sl.get("max_speed")
        if ms and ms.get("value"):
            speed = ms["value"] * (0.44704 if ms.get("unit") == "mph" else 0.27778)
    for k in range(len(conns) - 1):
        a, b = conns[k], conns[k + 1]
        if b["at"] - a["at"] <= 1e-6:
            continue
        part = cut(g, a["at"], b["at"])
        if part.geom_type != "LineString" or part.length < 0.3:
            continue
        coords = list(part.coords)
        na = nid(a["connector_id"], coords[0]); nb = nid(b["connector_id"], coords[-1])
        coords[0] = node_xy[na]; coords[-1] = node_xy[nb]
        if cls in DRIVE:
            c = DRIVE[cls]
            if cls == "service" and (r["subclass"] in ("parking_aisle", "driveway", "drive_through")):
                c = 7
            lanes = LANES[c] if oneway == 0 else max(1, LANES[c] + (1 if c <= 3 else 0))
            w = width if width else (WIDTH[c] if oneway == 0 else WIDTH[c] * 0.72)
            if c == 0:
                w = width or (3.6 * lanes + 2.0)
            edges.append({"a": na, "b": nb, "c": c, "w": round(min(max(w, 4.0), 32.0), 1), "l": lanes, "o": oneway,
                          "br": 1 if bridge else 0, "tu": 1 if tunnel else 0, "lv": lvl, "s": round(speed or SPEED[c], 1),
                          "n": name, "sub": r["subclass"] or "", "pts": coords})
        elif cls in PED and not tunnel:
            ped_edges.append({"a": na, "b": nb, "c": cls, "sub": r["subclass"] or "", "br": 1 if bridge else 0, "pts": coords})
log("drivable edges", len(edges), "ped edges", len(ped_edges), "nodes", len(node_xy), "rail", len(rail_lines))

# junction degree (drivable)
deg = defaultdict(int)
for e in edges:
    if not e["tu"]:
        deg[e["a"]] += 1; deg[e["b"]] += 1


# ---------------------------------------------------------------- 3b. bridge elevation profiles
def edge_len(pts):
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


# Golden Gate Bridge: deck profile from published engineering data (deck ~67 m above MHW at mid-span,
# rising from ~64 m at the towers... approximated by a gentle parabola anchored at the approaches).
GGB_SOUTH = to_local(-122.47740, 37.81070)   # south anchorage/toll plaza approach (approx.)
for e in edges:
    e["el"] = None
# compute chains of bridge edges and interpolate elevation between their terrain end points
br_adj = defaultdict(list)
for i, e in enumerate(edges):
    if e["br"]:
        br_adj[e["a"]].append(i); br_adj[e["b"]].append(i)

seen = set()
chains = 0
for i, e in enumerate(edges):
    if not e["br"] or i in seen:
        continue
    # flood fill the connected bridge component
    comp = []; stack = [i]
    while stack:
        k = stack.pop()
        if k in seen:
            continue
        seen.add(k); comp.append(k)
        for nn in (edges[k]["a"], edges[k]["b"]):
            for k2 in br_adj[nn]:
                if k2 not in seen:
                    stack.append(k2)
    # end nodes = nodes of the component that touch non-bridge edges (or have degree 1)
    comp_nodes = defaultdict(int)
    for k in comp:
        comp_nodes[edges[k]["a"]] += 1; comp_nodes[edges[k]["b"]] += 1
    ends = [nn for nn in comp_nodes if deg[nn] > len(br_adj[nn]) or deg[nn] == 1]
    if not ends:
        ends = list(comp_nodes)[:2]
    lv = max(edges[k]["lv"] for k in comp)
    end_h = [(node_xy[nn], h_at(*node_xy[nn])) for nn in ends]
    for k in comp:
        el = []
        for p in edges[k]["pts"]:
            # inverse-distance interpolation of end heights (smooth deck between abutments)
            ws = 0; hs = 0
            for q, hq in end_h:
                d = max(math.dist(p, q), 1.0)
                w = 1 / d ** 2; ws += w; hs += w * hq
            hb = hs / ws if ws else h_at(*p)
            ht = h_at(*p)
            clear = 0.0 if ht > 0.5 else 0  # over water keep deck interpolation
            hval = max(hb, ht + 1.2 + lv * 6.5 + clear)
            el.append(round(hval, 2))
        edges[k]["el"] = el
    chains += 1
log("bridge components", chains)

# ---------------------------------------------------------------- 3c. signals → junction nodes
infra = read("infrastructure", ["subtype", "class", "geometry", "names", "height"])
node_arr = np.array(node_xy) if node_xy else np.zeros((0, 2))
junction_nodes = [nn for nn in deg if deg[nn] >= 3]
jtree = STRtree([Point(node_xy[nn]) for nn in junction_nodes])
signal_nodes = set()
signal_pts = []
for r in infra:
    if r["class"] == "traffic_signals":
        p = shapely.from_wkb(r["geometry"])
        if p.geom_type != "Point":
            continue
        x, z = to_local(p.x, p.y)
        signal_pts.append((x, z))
        idx = jtree.query_nearest(Point(x, z), max_distance=25)
        for ii in np.atleast_1d(idx):
            signal_nodes.add(junction_nodes[int(ii)])
log("signal points", len(signal_pts), "signalised junctions", len(signal_nodes))

# ---------------------------------------------------------------- 4. buildings
log("buildings")
bld_rows = read("building", ["id", "names", "height", "min_height", "is_underground", "num_floors", "class", "subtype",
                             "facade_color", "facade_material", "roof_shape", "roof_color", "geometry"])

LANDMARKS = [
    # id, name, lon, lat, footprint-removal radius (m) (0 = enhance only), category
    ("salesforce", "Salesforce Tower", -122.39694, 37.78977, 40, "tower"),
    ("transamerica", "Transamerica Pyramid", -122.40279, 37.79519, 32, "tower"),
    ("coit", "Coit Tower", -122.40582, 37.80239, 14, "tower"),
    ("ferry", "Ferry Building", -122.39343, 37.79554, 0, "building"),
    ("cityhall", "San Francisco City Hall", -122.41929, 37.77926, 0, "building"),
    ("sutro", "Sutro Tower", -122.45277, 37.75523, 30, "tower"),
    ("alcatraz", "Alcatraz Island", -122.42295, 37.82664, 0, "island"),
    ("lombard", "Lombard Street", -122.41874, 37.80207, 0, "street"),
    ("paintedladies", "Painted Ladies", -122.43288, 37.77620, 0, "houses"),
    ("unionsq", "Union Square", -122.40744, 37.78799, 0, "plaza"),
    ("fishermans", "Fisherman's Wharf", -122.41770, 37.80800, 0, "district"),
    ("pier39", "Pier 39", -122.40980, 37.80870, 0, "district"),
    ("twinpeaks", "Twin Peaks", -122.44770, 37.75440, 0, "nature"),
    ("ggpark", "Golden Gate Park", -122.46870, 37.76940, 0, "park"),
    ("oceanbeach", "Ocean Beach", -122.51070, 37.75940, 0, "nature"),
    ("palace", "Palace of Fine Arts", -122.44843, 37.80293, 0, "building"),
    ("chinatown", "Chinatown Dragon Gate", -122.40564, 37.79067, 0, "district"),
    ("castro", "Castro Theatre", -122.43489, 37.76209, 0, "district"),
    ("mission", "Mission Dolores", -122.42690, 37.76428, 0, "district"),
    ("oracle", "Oracle Park", -122.38926, 37.77857, 0, "stadium"),
    ("presidio", "Presidio", -122.46620, 37.79890, 0, "park"),
    ("ggb", "Golden Gate Bridge", -122.47830, 37.81990, 0, "bridge"),
    ("baybridge", "Bay Bridge", -122.37720, 37.79830, 0, "bridge"),
    ("coit_hill", "Telegraph Hill", -122.40582, 37.80239, 0, "nature"),
    ("embarcadero", "The Embarcadero", -122.39500, 37.79900, 0, "street"),
    ("marina", "Marina Green", -122.44000, 37.80630, 0, "park"),
    ("fortpoint", "Fort Point", -122.47700, 37.81060, 0, "building"),
]
lm_local = {l[0]: to_local(l[2], l[3]) for l in LANDMARKS}
remove_zones = [(Point(lm_local[l[0]]).buffer(l[4]), l[0]) for l in LANDMARKS if l[4] > 0]

# neighbourhood style zones (centre lon, lat, radius m, style-bias)
ZONES = {
    "downtown": (-122.4000, 37.7915, 1300),
    "soma": (-122.4000, 37.7790, 1300),
    "chinatown": (-122.4065, 37.7941, 330),
    "victorian": [(-122.4330, 37.7760, 1700), (-122.4350, 37.7620, 1400), (-122.4200, 37.7600, 1300),
                  (-122.4330, 37.7900, 1400), (-122.4470, 37.7700, 900), (-122.4200, 37.7980, 900),
                  (-122.4100, 37.8000, 600)],
    "stucco": [(-122.4900, 37.7550, 2600), (-122.4850, 37.7800, 2100), (-122.4600, 37.7300, 2400), (-122.4250, 37.7300, 2000)],
    "industrial": [(-122.3900, 37.7550, 1500), (-122.3850, 37.7300, 1500), (-122.4050, 37.7700, 700)],
}


def in_zone(x, z, zone):
    lst = zone if isinstance(zone, list) else [zone]
    for lo, la, r in lst:
        cx, cz = to_local(lo, la)
        if (x - cx) ** 2 + (z - cz) ** 2 < r * r:
            return True
    return False


def hexcol(s):
    if not s:
        return -1
    s = s.strip().lstrip("#")
    try:
        if len(s) == 6:
            return int(s, 16)
    except ValueError:
        pass
    named = {"white": 0xEEEEE8, "red": 0xA0392F, "grey": 0x8C8C8C, "gray": 0x8C8C8C, "beige": 0xD8C9A8,
             "yellow": 0xE2C46A, "brown": 0x7A5A3E, "blue": 0x5A7CA8, "green": 0x6E8C5A, "black": 0x303030}
    return named.get(s.lower(), -1)


# styles: 0 glass tower, 1 modern office, 2 classic masonry, 3 victorian, 4 stucco, 5 brick, 6 industrial, 7 chinatown, 8 painted lady
VICTORIAN_PAL = [0xE8D3B0, 0xC9D8C5, 0xB7C9D9, 0xE6C3B3, 0xF0E4C8, 0xD8BFD8, 0xA9C1A0, 0xE9D9A6, 0xC4B5A0, 0xF2EDE4, 0x9DB4C0, 0xD9A88F]
STUCCO_PAL = [0xF1ECE2, 0xE9E1D1, 0xDDD5C3, 0xEFE6D6, 0xE8D8C4, 0xD5DCD8, 0xE3E0D9, 0xF4F0E8, 0xCFC6B4, 0xE6D2C1]
MASON_PAL = [0xC8B89A, 0xB9AC95, 0xD2C6B0, 0xA89A86, 0xBFB3A0, 0xD8D0C0]
GLASS_PAL = [0x4A6A80, 0x5B7F8F, 0x3E5566, 0x6F8A99, 0x7E96A6, 0x2F4655, 0x58706E]
OFFICE_PAL = [0xB8B8B4, 0xA7A9AA, 0xCAC7C0, 0x9A9EA1, 0xD4D1CA]
BRICK_PAL = [0x8E4B36, 0x9C5A42, 0x7D4430, 0xA76A50, 0x86503F]
IND_PAL = [0x9CA3A6, 0xB0B4B0, 0x8A8F92, 0xA89F90, 0xC2BFB5]
CHINA_PAL = [0xE8DCC4, 0xD9C7A8, 0xC9B79A, 0xEADFD0, 0xB98E6E]
PAINTED_LADIES = [0x9DBAC9, 0xE8C9A7, 0xB6CDB0, 0xF0D7C0, 0xC7B1C9, 0xE5DAB4, 0xA9C5C8]

bt = defaultdict(list)
btree_polys = []
btree_meta = []
cnt_est = 0
removed = 0
for r in bld_rows:
    if r["is_underground"]:
        continue
    g = shapely.from_wkb(r["geometry"])
    if g.geom_type not in ("Polygon", "MultiPolygon"):
        continue
    g = proj(g)
    polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
    for p in polys:
        if not p.is_valid:
            p = p.buffer(0)
            if p.geom_type != "Polygon":
                continue
        if p.area < 10:
            continue
        p = p.simplify(0.25, preserve_topology=True)
        if p.is_empty or p.geom_type != "Polygon":
            continue
        c = p.centroid
        cx, cz = c.x, c.y
        if not (X0 + 5 < cx < X1 - 5 and Z0 + 5 < cz < Z1 - 5):
            continue
        rm = None
        for zg, lid in remove_zones:
            if zg.contains(c):
                rm = lid
        if rm:
            removed += 1
            continue
        h = r["height"]; mh = r["min_height"] or 0.0
        area = p.area
        est = False
        if not h:
            if r["num_floors"]:
                h = r["num_floors"] * 3.4
            else:
                est = True
                if in_zone(cx, cz, ZONES["downtown"]):
                    h = 18 + (zlib.crc32(r["id"].encode()) % 30)
                elif area > 2000:
                    h = 9 + (zlib.crc32(r["id"].encode()) % 6)
                else:
                    h = 7.5 + (zlib.crc32(r["id"].encode()) % 5)
                cnt_est += 1
        h = float(min(max(h, 2.5), 330))
        if h - mh < 1.0:
            continue
        hsh = (zlib.crc32(r["id"].encode()) & 0xFFFFFF)
        cls = r["class"] or ""
        # ----- style selection based on real attributes + neighbourhood
        if in_zone(cx, cz, ZONES["chinatown"]) and h < 40:
            st = 7
        elif h >= 70:
            st = 0 if hsh % 10 < 7 else (1 if hsh % 10 < 9 else 2)
        elif in_zone(cx, cz, ZONES["downtown"]) and h >= 25:
            st = (2, 1, 0, 2, 1)[hsh % 5]
        elif in_zone(cx, cz, ZONES["industrial"]) and area > 1200 and h < 22:
            st = 6
        elif (in_zone(cx, cz, ZONES["soma"]) or in_zone(cx, cz, ZONES["industrial"])) and h < 30:
            st = (5, 5, 1, 6, 4)[hsh % 5]
        elif h >= 25:
            st = (1, 2, 4, 1)[hsh % 4]
        elif in_zone(cx, cz, ZONES["victorian"]) and area < 600:
            st = 3
        elif in_zone(cx, cz, ZONES["stucco"]):
            st = 4
        elif area > 2500 and h < 15:
            st = 6
        else:
            st = (3, 4, 4, 5)[hsh % 4] if area < 500 else (4, 1, 5)[hsh % 3]
        pal = {0: GLASS_PAL, 1: OFFICE_PAL, 2: MASON_PAL, 3: VICTORIAN_PAL, 4: STUCCO_PAL, 5: BRICK_PAL, 6: IND_PAL, 7: CHINA_PAL}[st]
        col = hexcol(r["facade_color"])
        if col < 0:
            col = pal[(hsh >> 4) % len(pal)]
        # painted ladies enhancement (710–720 Steiner St)
        pl = lm_local["paintedladies"]
        if st in (3, 4, 5) and (cx - pl[0]) ** 2 + (cz - pl[1]) ** 2 < 60 ** 2 and h < 16:
            st = 8
            col = PAINTED_LADIES[int((cz - pl[1] + 60) / 8) % len(PAINTED_LADIES)]
        # base elevation: lowest terrain point under the footprint (foundation goes down to it)
        ext = list(p.exterior.coords)[:-1]
        hs = [h_at(x, z) for x, z in ext] + [h_at(cx, cz)]
        base = min(hs)
        top_ref = max(hs)
        if base < 0.3 and mh == 0:
            base = max(base, 0.3)
        ti = int(math.floor(cx / TILE)); tj = int(math.floor(cz / TILE))
        rings = [ext] + [list(i.coords)[:-1] for i in p.interiors if Polygon(i).area > 6]
        roof = {"flat": 0, "gabled": 1, "hipped": 2, "pyramidal": 3, "dome": 4}.get(r["roof_shape"] or "", 0)
        nm = (r["names"] or {}).get("primary") or ""
        bt[(ti, tj)].append({"r": rings, "h": round(h, 1), "mh": round(mh, 1), "b": round(base, 2), "bt": round(top_ref, 2),
                             "s": st, "c": col, "rf": roof, "e": 1 if est else 0, "id": hsh, "n": nm if area > 1500 or h > 60 else ""})
        btree_polys.append(p); btree_meta.append((cx, cz, h))
log("buildings kept", len(btree_polys), "height-estimated", cnt_est, "removed for landmarks", removed)

# landmark validation against named buildings in the dataset
VALIDATE = {"salesforce": "Salesforce Tower", "transamerica": "Transamerica Pyramid", "coit": "Coit Tower",
            "ferry": "Ferry Building", "cityhall": "San Francisco City Hall", "palace": "Palace of Fine Arts"}
validation = {}
for r in bld_rows:
    nm = (r["names"] or {}).get("primary") or ""
    for lid, want in VALIDATE.items():
        if nm and (nm == want or nm.startswith(want)) and lid not in validation:
            c = proj(shapely.from_wkb(r["geometry"])).centroid
            d = math.dist((c.x, c.y), lm_local[lid])
            validation[lid] = {"dataset_name": nm, "offset_m": round(d, 1), "dataset_height": r["height"]}
log("landmark validation", json.dumps(validation))

bidx = STRtree(btree_polys)

# ---------------------------------------------------------------- 5. trees, lamps, furniture
log("vegetation & furniture")
road_lines = [LineString(e["pts"]) for e in edges if not e["tu"]]
road_w = [e["w"] for e in edges if not e["tu"]]
rtree = STRtree(road_lines)


def blocked(x, z, road_clear=1.0, bld_clear=1.5):
    pt = Point(x, z)
    for ii in rtree.query(pt.buffer(16)):
        if road_lines[ii].distance(pt) < road_w[ii] / 2 + road_clear:
            return True
    for ii in bidx.query(pt.buffer(bld_clear)):
        if btree_polys[ii].distance(pt) < bld_clear:
            return True
    return False


trees = defaultdict(list)   # (ti,tj) -> [x,z,kind,scale]
TREE_KINDS = 5  # 0 broadleaf/plane, 1 cypress (Monterey), 2 eucalyptus, 3 palm (Dolores/Embarcadero), 4 pine
palm_zones = [(-122.3940, 37.7960, 1400), (-122.4260, 37.7610, 500)]


def tree_kind(x, z, natural):
    if in_zone(x, z, palm_zones) and random.random() < 0.6:
        return 3
    if natural:
        return random.choice((1, 2, 2, 4, 1, 0))
    return random.choice((0, 0, 0, 1, 4))


nt = 0
for r in land_rows:
    if r["subtype"] == "tree" and r["class"] == "tree":
        p = shapely.from_wkb(r["geometry"])
        if p.geom_type != "Point":
            continue
        x, z = to_local(p.x, p.y)
        if not (X0 < x < X1 and Z0 < z < Z1):
            continue
        trees[(int(math.floor(x / TILE)), int(math.floor(z / TILE)))].append([round(x, 1), round(z, 1), tree_kind(x, z, False), round(random.uniform(0.75, 1.25), 2)])
        nt += 1
log("real street trees", nt)
# procedural trees inside real forest / park polygons
nproc = 0
for gl, dens, natural in ((forest, 1 / 90.0, True), (park, 1 / 420.0, False)):
    for g in gl:
        for p in (list(g.geoms) if g.geom_type == "MultiPolygon" else [g]):
            if p.area < 300:
                continue
            k = int(p.area * dens)
            k = min(k, 40000)
            minx, miny, maxx, maxy = p.bounds
            shapely.prepare(p)
            xs_ = np.random.uniform(minx, maxx, k * 2); zs_ = np.random.uniform(miny, maxy, k * 2)
            ins = shapely.contains_xy(p, xs_, zs_)
            for x, z in zip(xs_[ins][:k], zs_[ins][:k]):
                fi = int((x - X0) / GRID); fj = int((z - Z0) / GRID)
                if not (0 <= fi < GW and 0 <= fj < GH) or SEA[fj, fi] or SURF[fj, fi] in (3, 7, 8):
                    continue
                if blocked(x, z, 1.5, 2.0):
                    continue
                trees[(int(math.floor(x / TILE)), int(math.floor(z / TILE)))].append([round(float(x), 1), round(float(z), 1), tree_kind(x, z, natural), round(random.uniform(0.8, 1.35), 2)])
                nproc += 1
log("procedural park/forest trees", nproc)

furn = defaultdict(list)   # [x,z,type,rot]   type: 0 lamp,1 bench,2 bus stop,3 hydrant,4 signal pole,5 waste basket
FT = {"street_lamp": 0, "bench": 1, "bus_stop": 2, "fire_hydrant": 3, "traffic_signals": 4, "waste_basket": 5}
lamp_pts = []
piers = defaultdict(list)
for r in infra:
    t = FT.get(r["class"])
    g = shapely.from_wkb(r["geometry"])
    if r["class"] == "pier" and g.geom_type in ("Polygon", "MultiPolygon"):
        g = proj(g)
        for p in (list(g.geoms) if g.geom_type == "MultiPolygon" else [g]):
            if p.area < 30:
                continue
            p = p.simplify(0.5)
            c = p.centroid
            piers[(int(math.floor(c.x / TILE)), int(math.floor(c.y / TILE)))].append([round(v, 1) for xy in list(p.exterior.coords)[:-1] for v in xy])
        continue
    if t is None or g.geom_type != "Point":
        continue
    x, z = to_local(g.x, g.y)
    if not (X0 < x < X1 and Z0 < z < Z1):
        continue
    # orient toward nearest road
    rot = 0.0
    near = rtree.query_nearest(Point(x, z), max_distance=30)
    if len(np.atleast_1d(near)):
        ln = road_lines[int(np.atleast_1d(near)[0])]
        q = ln.interpolate(ln.project(Point(x, z)))
        rot = math.atan2(q.x - x, q.y - z)
    furn[(int(math.floor(x / TILE)), int(math.floor(z / TILE)))].append([round(x, 1), round(z, 1), t, round(rot, 2)])
    if t == 0:
        lamp_pts.append((x, z))
lamp_tree = STRtree([Point(p) for p in lamp_pts]) if lamp_pts else None
# procedural street lamps along drivable roads where no real lamp exists nearby
nl = 0
for e in edges:
    if e["tu"] or e["c"] == 7:
        continue
    ln = LineString(e["pts"]); L = ln.length
    step = 32.0 if e["c"] <= 3 else 40.0
    s = step * 0.5; side = 1
    while s < L:
        p = ln.interpolate(s); p2 = ln.interpolate(min(s + 1, L))
        dx, dz = p2.x - p.x, p2.y - p.y
        dl = math.hypot(dx, dz) or 1
        nx, nz = -dz / dl, dx / dl
        off = e["w"] / 2 + 0.9
        x, z = p.x + nx * off * side, p.y + nz * off * side
        if not (lamp_tree is not None and len(np.atleast_1d(lamp_tree.query_nearest(Point(x, z), max_distance=18)))) and not e["br"]:
            if not blocked(x, z, -0.2, 0.6):
                rot = math.atan2(-nx * side, -nz * side)
                furn[(int(math.floor(x / TILE)), int(math.floor(z / TILE)))].append([round(x, 1), round(z, 1), 0, round(rot, 2)])
                nl += 1
        side = -side if e["c"] <= 4 else side
        s += step
log("procedural lamps", nl)

# ---------------------------------------------------------------- 6. per-tile road pieces
log("tiling roads")
tile_roads = defaultdict(list)
for ei, e in enumerate(edges):
    if e["tu"]:
        continue
    ln = LineString(e["pts"])
    minx, minz, maxx, maxz = ln.bounds
    for ti in range(int(math.floor(minx / TILE)), int(math.floor(maxx / TILE)) + 1):
        for tj in range(int(math.floor(minz / TILE)), int(math.floor(maxz / TILE)) + 1):
            tb = box(ti * TILE, tj * TILE, (ti + 1) * TILE, (tj + 1) * TILE)
            if not ln.intersects(tb):
                continue
            tile_roads[(ti, tj)].append(ei)
ped_tiles = defaultdict(list)
for pi, e in enumerate(ped_edges):
    ln = LineString(e["pts"])
    c = ln.interpolate(0.5, normalized=True)
    ped_tiles[(int(math.floor(c.x / TILE)), int(math.floor(c.y / TILE)))].append(pi)

# ---------------------------------------------------------------- 7. write outputs
log("writing")
HQ = np.round(H * 10).astype(np.int16)
HQ.tofile(os.path.join(OUT, "height.bin.png"))
SURF.tofile(os.path.join(OUT, "surface.bin.png"))
# keep float version consistent with runtime decode
HQ = HQ.astype(np.float32) / 10.0

# recompute building bases with the quantised terrain (exact runtime match) — quick pass
for k, lst in bt.items():
    for b in lst:
        ext = b["r"][0]
        hs = [h_at(x, z) for x, z in ext]
        b["b"] = round(max(min(hs), 0.3) if b["mh"] == 0 else min(hs), 2)
        b["bt"] = round(max(hs), 2)

all_tiles = set(bt) | set(tile_roads) | set(trees) | set(furn) | set(piers) | set(ped_tiles)
# include every land tile even if empty
for ti in range(int(X0 // TILE), int(X1 // TILE)):
    for tj in range(int(Z0 // TILE), int(Z1 // TILE)):
        all_tiles.add((ti, tj))


def q(v):
    return round(v, 1)


tile_index = {}
for key in sorted(all_tiles):
    ti, tj = key
    ox, oz = ti * TILE, tj * TILE
    blds = []
    for b in bt.get(key, []):
        blds.append({**b, "r": [[v for xy in ring for v in (int(round((xy[0] - ox) * 10)), int(round((xy[1] - oz) * 10)))] for ring in b["r"]]})
    data = {"i": ti, "j": tj, "b": blds, "rd": tile_roads.get(key, []), "t": trees.get(key, []), "f": furn.get(key, []),
            "pr": piers.get(key, []), "pe": ped_tiles.get(key, [])}
    if not any((blds, data["rd"], data["t"], data["f"], data["pr"])):
        tile_index[f"{ti}_{tj}"] = 0
        continue
    with open(os.path.join(OUT, "tiles", f"T_{ti}_{tj}.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    tile_index[f"{ti}_{tj}"] = len(blds) + 1

# road graph (global)
node_used = sorted({e["a"] for e in edges} | {e["b"] for e in edges} | {e["a"] for e in ped_edges} | {e["b"] for e in ped_edges})
roads = {
    "nodes": [q(v) for nn in range(len(node_xy)) for v in node_xy[nn]],
    "sig": sorted(signal_nodes),
    "e": [[e["a"], e["b"], e["c"], e["w"], e["l"], e["o"], e["br"], e["tu"], e["s"], [q(v) for p in e["pts"] for v in p], e["el"], e["n"]] for e in edges],
}
with open(os.path.join(OUT, "roads.json"), "w") as f:
    json.dump(roads, f, separators=(",", ":"))
peds = {"e": [[e["a"], e["b"], {"footway": 0, "steps": 1, "path": 2, "pedestrian": 3, "cycleway": 4, "track": 2, "bridleway": 2}[e["c"]],
               {"sidewalk": 1, "crosswalk": 2}.get(e["sub"], 0), [q(v) for p in e["pts"] for v in p]] for e in ped_edges]}
with open(os.path.join(OUT, "peds.json"), "w") as f:
    json.dump(peds, f, separators=(",", ":"))

# neighbourhoods
div = read("division", ["subtype", "names", "geometry"])
hoods = []
for r in div:
    if r["subtype"] in ("neighborhood", "macrohood", "microhood"):
        p = shapely.from_wkb(r["geometry"])
        x, z = to_local(p.x, p.y)
        hoods.append({"n": r["names"]["primary"], "x": q(x), "z": q(z), "k": r["subtype"][0]})
EXTRA_HOODS = [("Financial District", -122.4000, 37.7946), ("Chinatown", -122.4065, 37.7941), ("North Beach", -122.4100, 37.8005),
               ("Nob Hill", -122.4150, 37.7930), ("Pacific Heights", -122.4350, 37.7925), ("Marina District", -122.4370, 37.8030),
               ("Presidio", -122.4662, 37.7989), ("The Castro", -122.4350, 37.7609), ("Mission District", -122.4194, 37.7599),
               ("Embarcadero", -122.3950, 37.7990), ("Haight-Ashbury", -122.4469, 37.7692), ("Golden Gate Park", -122.4862, 37.7694),
               ("Outer Sunset", -122.4990, 37.7550), ("Inner Richmond", -122.4650, 37.7800), ("Outer Richmond", -122.4950, 37.7780),
               ("Twin Peaks", -122.4477, 37.7544), ("Noe Valley", -122.4330, 37.7502), ("Potrero Hill", -122.4000, 37.7600),
               ("Tenderloin", -122.4140, 37.7840), ("Civic Center", -122.4180, 37.7790), ("Mission Bay", -122.3920, 37.7700),
               ("Bernal Heights", -122.4150, 37.7400), ("Alcatraz Island", -122.4230, 37.8267), ("Treasure Island", -122.3700, 37.8230),
               ("Yerba Buena Island", -122.3640, 37.8100), ("Golden Gate Strait", -122.4800, 37.8150), ("Sea Cliff", -122.4900, 37.7870),
               ("Lands End", -122.5050, 37.7850), ("Glen Park", -122.4330, 37.7340), ("Excelsior", -122.4270, 37.7240)]
for nm, lo, la in EXTRA_HOODS:
    x, z = to_local(lo, la)
    hoods.append({"n": nm, "x": q(x), "z": q(z), "k": "n"})

# coastline polylines for the map (simplified exterior rings of land polygons)
coast = []
if land_u is not None:
    for p in (list(land_u.geoms) if land_u.geom_type == "MultiPolygon" else [land_u]):
        cl = p.intersection(box(X0, Z0, X1, Z1))
        for pp in (list(cl.geoms) if hasattr(cl, "geoms") else [cl]):
            if pp.geom_type == "Polygon" and pp.area > 2000:
                coast.append([q(v) for xy in pp.simplify(4).exterior.coords for v in xy])
parks_map = []
for g in park + forest + golf:
    for p in (list(g.geoms) if g.geom_type == "MultiPolygon" else [g]):
        if p.area > 6000:
            parks_map.append([q(v) for xy in p.simplify(6).exterior.coords for v in xy])

world = {
    "name": "San Francisco",
    "source": {"vector": "Overture Maps Foundation release 2026-10-21.0 (OpenStreetMap contributors, ODbL; Esri Community Maps; Microsoft; Meta)",
               "dem": "AWS Terrain Tiles (Terrarium z14): USGS 3DEP / NED + NOAA coastal bathymetry"},
    "origin": {"lat": LAT0, "lon": LON0, "kx": KX, "ky": KY},
    "grid": {"x0": X0, "z0": Z0, "w": GW, "h": GH, "step": GRID, "x1": X1, "z1": Z1},
    "tile": TILE,
    "tiles": tile_index,
    "landmarks": [{"id": l[0], "n": l[1], "lon": l[2], "lat": l[3], "x": q(lm_local[l[0]][0]), "z": q(lm_local[l[0]][1]), "k": l[5]} for l in LANDMARKS],
    "validation": validation,
    "hoods": hoods,
    "lakes": lake_out,
    "rail": rail_lines,
    "coast": coast,
    "parks": parks_map,
    "signals": [[q(x), q(z)] for x, z in signal_pts],
    "stats": {"buildings": len(btree_polys), "heightEstimated": cnt_est, "roads": len(edges), "peds": len(ped_edges),
              "trees": nt + nproc, "realTrees": nt, "lamps": len(lamp_pts) + nl},
}
with open(os.path.join(OUT, "world.json"), "w") as f:
    json.dump(world, f, separators=(",", ":"))
log("done", world["stats"])
