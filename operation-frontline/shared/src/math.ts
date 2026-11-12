// Small allocation-free math helpers used by the simulation.

export interface Vec3 { x: number; y: number; z: number }

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (v: number): number => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const approach = (v: number, target: number, maxDelta: number): number =>
  v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);
export const smoothstep = (t: number): number => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function angleDiff(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(a, b) * t;
}

/**
 * Convention used everywhere: yaw 0 looks down -Z, positive yaw turns left
 * (counter-clockwise seen from above), positive pitch looks up.
 */
export function dirFromAngles(yaw: number, pitch: number, out: Vec3): Vec3 {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

export function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export function pitchTo(dx: number, dy: number, dz: number): number {
  return Math.atan2(dy, Math.hypot(dx, dz));
}

export const dist2D = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);
export const dist3D = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): number =>
  Math.hypot(ax - bx, ay - by, az - bz);

/** Deterministic 32 bit PRNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.next(); }
  int(lo: number, hi: number): number { return Math.floor(this.range(lo, hi + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  chance(p: number): boolean { return this.next() < p; }
}

/** Stateless hash → [0,1). Used for per-shot spread that client and server agree on. */
export function hash01(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
