// GLSL mirrors of js/world/heightfield.js. Any change here must match the CPU code
// so that rendered ground == physical ground.
export const HEIGHT_GLSL = /* glsl */`
uniform highp usampler2D uHeightCore;   // 2049^2, 0.1 m units
uniform highp usampler2D uHeightFar;    // 1025^2 over 40.96 km
uniform sampler2D uMaskA;               // wet, sediment, forest, snow (8 m)
uniform sampler2D uMaskB;               // road, waterProx, flowers, rock (8 m)

const float CORE_HALF = 4096.0;
const float CORE_CELL = 4.0;
const int   CORE_N = 2049;
const float FAR_HALF = 20480.0;
const float FAR_CELL = 40.0;
const int   FAR_N = 1025;
const float MASK_CELL = 8.0;
const float MASK_N = 1025.0;

float hCore(int i, int j) {
  i = clamp(i, 0, CORE_N - 1); j = clamp(j, 0, CORE_N - 1);
  return float(texelFetch(uHeightCore, ivec2(i, j), 0).r) * 0.1;
}
float hFar(int i, int j) {
  i = clamp(i, 0, FAR_N - 1); j = clamp(j, 0, FAR_N - 1);
  return float(texelFetch(uHeightFar, ivec2(i, j), 0).r) * 0.1;
}
float cr(float p0, float p1, float p2, float p3, float t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)));
}
float coreHeight(vec2 p) {
  vec2 g = (p + CORE_HALF) / CORE_CELL;
  vec2 fl = floor(g);
  int ix = int(fl.x), iz = int(fl.y);
  vec2 t = g - fl;
  float r[4];
  for (int k = 0; k < 4; k++) {
    int j = iz + k - 1;
    r[k] = cr(hCore(ix - 1, j), hCore(ix, j), hCore(ix + 1, j), hCore(ix + 2, j), t.x);
  }
  return cr(r[0], r[1], r[2], r[3], t.y);
}
float farHeight(vec2 p) {
  vec2 g = (p + FAR_HALF) / FAR_CELL;
  vec2 fl = floor(g);
  int ix = int(fl.x), iz = int(fl.y);
  vec2 t = g - fl;
  float r[4];
  for (int k = 0; k < 4; k++) {
    int j = iz + k - 1;
    r[k] = cr(hFar(ix - 1, j), hFar(ix, j), hFar(ix + 1, j), hFar(ix + 2, j), t.x);
  }
  return cr(r[0], r[1], r[2], r[3], t.y);
}
// 1 inside the core, 0 outside, blended over the last 220 m
float coreWeight(vec2 p) {
  vec2 a = abs(p);
  return 1.0 - smoothstep(CORE_HALF - 260.0, CORE_HALF - 40.0, max(a.x, a.y));
}
float baseHeight(vec2 p) {
  float w = coreWeight(p);
  if (w >= 1.0) return coreHeight(p);
  if (w <= 0.0) return farHeight(p);
  return mix(farHeight(p), coreHeight(p), w);
}
vec2 maskUV(vec2 p) { return ((p + CORE_HALF) / MASK_CELL + 0.5) / MASK_N; }

uint hashu(int ix, int iz) {
  uint h = (uint(ix) * 0x27d4eb2du) ^ (uint(iz) * 0x165667b1u);
  h = (h ^ (h >> 15)) * 0x2c1b3c6du;
  h ^= h >> 12;
  h *= 0x297a2d39u;
  h ^= h >> 15;
  return h;
}
float hash2(int ix, int iz) { return float(hashu(ix, iz)) / 4294967296.0; }
// value noise with analytic derivative: returns (value, d/dx, d/dz)
vec3 vnoiseD(vec2 p) {
  vec2 fl = floor(p);
  int ix = int(fl.x), iz = int(fl.y);
  vec2 f = p - fl;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  float k1 = b - a, k2 = c - a, k3 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k3 * u.x * u.y, du.x * (k1 + k3 * u.y), du.y * (k2 + k3 * u.x));
}
// micro relief (metres) + gradient; road/rock from mask B
vec3 detailNoiseD(vec2 p, float road, float rock) {
  vec2 q = p + 10000.0; // keep lattice coords positive (portable int->uint)
  vec3 n1 = vnoiseD(q * 0.4); n1.yz *= 0.4;
  vec3 n2 = vnoiseD(q * 1.1 + vec2(31.7, 17.3)); n2.yz *= 1.1;
  float amp = (0.22 + 0.45 * rock) * (1.0 - 0.82 * road);
  vec3 r = n1 + 0.45 * n2;
  r.x -= 0.725;
  return r * amp;
}
float terrainHeight(vec2 p) {
  float h = baseHeight(p);
  if (coreWeight(p) > 0.0) {
    vec4 mb = texture(uMaskB, maskUV(p));
    h += detailNoiseD(p, mb.r, mb.a).x * coreWeight(p);
  }
  return h;
}
`;
