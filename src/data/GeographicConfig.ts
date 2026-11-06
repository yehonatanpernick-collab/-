/**
 * Geographic coordinate system — MUST stay in sync with scripts/geo.py.
 *
 * Local tangent-plane projection centred on Union Square (37.78799 N, 122.40744 W) using the WGS84
 * meridional (M) and prime-vertical (N) radii of curvature at the origin.
 *   east  = (lon - LON0) * KX
 *   north = (lat - LAT0) * KY
 * three.js world space: X = east, Y = up (metres above mean sea level), Z = -north.
 */
export const LAT0 = 37.78799;
export const LON0 = -122.40744;
const A = 6378137.0;
const E2 = 0.00669437999014;
const DEG = Math.PI / 180;
const s = Math.sin(LAT0 * DEG);
const M = (A * (1 - E2)) / Math.pow(1 - E2 * s * s, 1.5);
const N = A / Math.sqrt(1 - E2 * s * s);
export const KX = DEG * N * Math.cos(LAT0 * DEG);
export const KY = DEG * M;

export function lonLatToWorld(lon: number, lat: number): { x: number; z: number } {
  return { x: (lon - LON0) * KX, z: -(lat - LAT0) * KY };
}

export function worldToLonLat(x: number, z: number): { lon: number; lat: number } {
  return { lon: LON0 + x / KX, lat: LAT0 - z / KY };
}

export function formatLatLon(x: number, z: number): string {
  const { lon, lat } = worldToLonLat(x, z);
  return `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(5)}°${lon >= 0 ? 'E' : 'W'}`;
}

/** Heading in degrees (0 = north, 90 = east) for a world-space direction. */
export function headingDeg(dx: number, dz: number): number {
  const h = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return (h + 360) % 360;
}
