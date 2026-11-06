"""Shared geographic configuration. MUST stay in sync with src/data/GeographicConfig.ts.

Local coordinate system: a tangent-plane projection centred on Union Square using the WGS84
meridional (M) and prime-vertical (N) radii of curvature at the origin.
  east  (m) = (lon - LON0) * DEG * N * cos(LAT0)
  north (m) = (lat - LAT0) * DEG * M
Three.js world: X = east, Y = up, Z = -north.
Over the ±9 km playable area the scale error versus true geodesic distance is < 0.15 %.
"""
import math

LAT0 = 37.78799
LON0 = -122.40744
A = 6378137.0
E2 = 0.00669437999014
DEG = math.pi / 180
_s = math.sin(LAT0 * DEG)
M = A * (1 - E2) / (1 - E2 * _s * _s) ** 1.5
N = A / math.sqrt(1 - E2 * _s * _s)
KX = DEG * N * math.cos(LAT0 * DEG)   # metres per degree of longitude
KY = DEG * M                          # metres per degree of latitude

TILE = 500.0          # world tile size in metres
GRID = 10.0           # heightmap spacing in metres
# world extent (x = east, z = -north), aligned to tiles and grid
X0, X1 = -11500.0, 6000.0
Z0, Z1 = -6500.0, 10000.0
GW = int((X1 - X0) / GRID) + 1
GH = int((Z1 - Z0) / GRID) + 1


def to_local(lon, lat):
    """lon/lat (deg) -> (x, z) metres in three.js world space."""
    return (lon - LON0) * KX, -(lat - LAT0) * KY


def to_lonlat(x, z):
    return LON0 + x / KX, LAT0 - z / KY
