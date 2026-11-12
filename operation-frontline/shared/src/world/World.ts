// Static collision world: axis aligned boxes + ramps in a uniform XZ grid.
// Shared by the authoritative simulation (movement, bullets, line of sight,
// navigation) and by the client (prediction, effects, audio occlusion).

export const F_SOLID = 1;     // blocks characters and vehicles
export const F_BULLET = 2;    // stops bullets / projectiles
export const F_SIGHT = 4;     // blocks line of sight
export const F_GLASS = 8;     // breakable glass pane
export const F_NORENDER = 16; // collision only (prop colliders, clip walls)
export const F_DYNAMIC = 32;  // may be disabled at runtime (glass, doors, crates)
export const F_INTERIOR = 64; // rendered with interior ambient darkening
export const F_NOCOLLIDE = 128; // render only
export const F_WALL = F_SOLID | F_BULLET | F_SIGHT;

export interface Box {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  mat: number;
  flags: number;
  /** Colour tint index into the map palette (0 = none). */
  tint: number;
  /** Id of the dynamic entity (glass / door / crate) this box belongs to, or -1. */
  ref: number;
  enabled: boolean;
}

/** Wedge: rises from y0 to y1 along `axis` (0 = X, 1 = Z); dir +1 rises towards +axis. */
export interface Ramp {
  minX: number; minZ: number; maxX: number; maxZ: number;
  y0: number; y1: number;
  axis: 0 | 1;
  dir: 1 | -1;
  mat: number;
  /** Render as individual stair steps instead of a smooth slope. */
  stairs: boolean;
}

export interface RayHit {
  t: number;
  nx: number; ny: number; nz: number;
  /** Index of the box that was hit, or -1 - rampIndex for ramps. */
  index: number;
  mat: number;
  flags: number;
}

export const makeRayHit = (): RayHit => ({ t: 0, nx: 0, ny: 1, nz: 0, index: -1, mat: 0, flags: 0 });

const CELL = 4;

export class World {
  readonly boxes: Box[] = [];
  readonly ramps: Ramp[] = [];
  minX = 0; minZ = 0; maxX = 0; maxZ = 0;
  /** Lowest Y a character can fall to before being killed. */
  killY = -30;

  private cols = 0;
  private rows = 0;
  private cellBoxes: number[][] = [];
  private cellRamps: number[][] = [];
  private stamp: Int32Array = new Int32Array(0);
  private stampId = 0;
  private finalized = false;
  private readonly scratch: number[] = [];

  setBounds(minX: number, minZ: number, maxX: number, maxZ: number): void {
    this.minX = minX; this.minZ = minZ; this.maxX = maxX; this.maxZ = maxZ;
  }

  addBox(b: Box): number {
    this.boxes.push(b);
    return this.boxes.length - 1;
  }

  addRamp(r: Ramp): number {
    this.ramps.push(r);
    return this.ramps.length - 1;
  }

  finalize(): void {
    this.cols = Math.max(1, Math.ceil((this.maxX - this.minX) / CELL));
    this.rows = Math.max(1, Math.ceil((this.maxZ - this.minZ) / CELL));
    const n = this.cols * this.rows;
    this.cellBoxes = Array.from({ length: n }, () => []);
    this.cellRamps = Array.from({ length: n }, () => []);
    this.stamp = new Int32Array(this.boxes.length + this.ramps.length);
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.flags & F_NOCOLLIDE) continue;
      this.forCells(b.minX, b.minZ, b.maxX, b.maxZ, (c) => this.cellBoxes[c].push(i));
    }
    for (let i = 0; i < this.ramps.length; i++) {
      const r = this.ramps[i];
      this.forCells(r.minX, r.minZ, r.maxX, r.maxZ, (c) => this.cellRamps[c].push(i));
    }
    this.finalized = true;
  }

  private cx(x: number): number {
    const c = Math.floor((x - this.minX) / CELL);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private cz(z: number): number {
    const c = Math.floor((z - this.minZ) / CELL);
    return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c;
  }

  private forCells(minX: number, minZ: number, maxX: number, maxZ: number, fn: (cell: number) => void): void {
    const x0 = this.cx(minX), x1 = this.cx(maxX), z0 = this.cz(minZ), z1 = this.cz(maxZ);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) fn(z * this.cols + x);
  }

  setEnabled(index: number, on: boolean): void {
    const b = this.boxes[index];
    if (b) b.enabled = on;
  }

  /** Surface height of a ramp at a point clamped into its footprint. */
  rampHeight(r: Ramp, x: number, z: number): number {
    let t: number;
    if (r.axis === 0) {
      const cxp = x < r.minX ? r.minX : x > r.maxX ? r.maxX : x;
      t = (cxp - r.minX) / (r.maxX - r.minX);
    } else {
      const czp = z < r.minZ ? r.minZ : z > r.maxZ ? r.maxZ : z;
      t = (czp - r.minZ) / (r.maxZ - r.minZ);
    }
    if (r.dir < 0) t = 1 - t;
    return r.y0 + (r.y1 - r.y0) * t;
  }

  /**
   * Collect indices of enabled boxes overlapping an AABB whose flags match `mask`.
   * Ramps are reported as negative values (-1 - rampIndex) when their footprint overlaps.
   */
  query(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, mask: number, out: number[]): number {
    out.length = 0;
    if (!this.finalized) return 0;
    const id = ++this.stampId;
    const x0 = this.cx(minX), x1 = this.cx(maxX), z0 = this.cz(minZ), z1 = this.cz(maxZ);
    const boxes = this.boxes, ramps = this.ramps, stamp = this.stamp, nb = boxes.length;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = cz * this.cols + cx;
        const list = this.cellBoxes[cell];
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (stamp[i] === id) continue;
          stamp[i] = id;
          const b = boxes[i];
          if (!b.enabled || !(b.flags & mask)) continue;
          if (b.minX < maxX && b.maxX > minX && b.minZ < maxZ && b.maxZ > minZ && b.minY < maxY && b.maxY > minY) out.push(i);
        }
        if (mask & (F_SOLID | F_BULLET | F_SIGHT)) {
          const rl = this.cellRamps[cell];
          for (let k = 0; k < rl.length; k++) {
            const i = rl[k];
            if (stamp[nb + i] === id) continue;
            stamp[nb + i] = id;
            const r = ramps[i];
            if (r.minX < maxX && r.maxX > minX && r.minZ < maxZ && r.maxZ > minZ && r.y0 < maxY && r.y1 > minY) out.push(-1 - i);
          }
        }
      }
    }
    return out.length;
  }

  /** True when any solid overlaps the given AABB (ramps tested with their real slope). */
  overlaps(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, mask: number = F_SOLID): boolean {
    const out = this.scratch;
    const n = this.query(minX, minY, minZ, maxX, maxY, maxZ, mask, out);
    const cx = (minX + maxX) * 0.5, cz = (minZ + maxZ) * 0.5;
    for (let k = 0; k < n; k++) {
      const i = out[k];
      if (i >= 0) return true;
      const r = this.ramps[-1 - i];
      if (this.rampHeight(r, cx, cz) > minY + 1e-4) return true;
    }
    return false;
  }

  /**
   * Highest walkable surface at (x, z) that is not above `maxY`. Returns -Infinity if none.
   * Point query (no footprint) – used for spawning, vehicles and navigation.
   */
  surfaceAt(x: number, z: number, maxY: number): number {
    if (!this.finalized) return -Infinity;
    const cell = this.cz(z) * this.cols + this.cx(x);
    let best = -Infinity;
    const list = this.cellBoxes[cell];
    for (let k = 0; k < list.length; k++) {
      const b = this.boxes[list[k]];
      if (!b.enabled || !(b.flags & F_SOLID)) continue;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= maxY && b.maxY > best) best = b.maxY;
    }
    const rl = this.cellRamps[cell];
    for (let k = 0; k < rl.length; k++) {
      const r = this.ramps[rl[k]];
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
        const h = this.rampHeight(r, x, z);
        if (h <= maxY && h > best) best = h;
      }
    }
    return best;
  }

  /**
   * Ray cast against boxes and ramps matching `mask`. Direction must be normalised.
   * Returns true and fills `hit` with the nearest intersection within maxT.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, mask: number, hit: RayHit): boolean {
    if (!this.finalized) return false;
    const id = ++this.stampId;
    const boxes = this.boxes, ramps = this.ramps, stamp = this.stamp, nb = boxes.length;
    let best = maxT;
    let found = false;

    const idx = dx !== 0 ? 1 / dx : Infinity;
    const idy = dy !== 0 ? 1 / dy : Infinity;
    const idz = dz !== 0 ? 1 / dz : Infinity;

    // 2D DDA over the XZ grid
    let cx = Math.floor((ox - this.minX) / CELL);
    let cz = Math.floor((oz - this.minZ) / CELL);
    let tStart = 0;
    // If the origin is outside the grid, advance to the grid boundary first.
    if (cx < 0 || cx >= this.cols || cz < 0 || cz >= this.rows) {
      const gMaxX = this.minX + this.cols * CELL, gMaxZ = this.minZ + this.rows * CELL;
      let t0 = 0, t1 = maxT;
      if (dx !== 0) {
        const a = (this.minX - ox) * idx, b = (gMaxX - ox) * idx;
        t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
      } else if (ox < this.minX || ox > gMaxX) return false;
      if (dz !== 0) {
        const a = (this.minZ - oz) * idz, b = (gMaxZ - oz) * idz;
        t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
      } else if (oz < this.minZ || oz > gMaxZ) return false;
      if (t0 > t1) return false;
      tStart = t0 + 1e-4;
      cx = this.cx(ox + dx * tStart);
      cz = this.cz(oz + dz * tStart);
    }
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(CELL * idx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(CELL * idz) : Infinity;
    let tMaxX = dx !== 0 ? ((this.minX + (cx + (dx > 0 ? 1 : 0)) * CELL) - ox) * idx : Infinity;
    let tMaxZ = dz !== 0 ? ((this.minZ + (cz + (dz > 0 ? 1 : 0)) * CELL) - oz) * idz : Infinity;
    let tEnter = tStart;

    while (cx >= 0 && cx < this.cols && cz >= 0 && cz < this.rows && tEnter <= best) {
      const cell = cz * this.cols + cx;
      const list = this.cellBoxes[cell];
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        if (stamp[i] === id) continue;
        stamp[i] = id;
        const b = boxes[i];
        if (!b.enabled || !(b.flags & mask)) continue;
        // slab test
        let t0 = 0, t1 = best, axis = -1;
        let a = (b.minX - ox) * idx, c = (b.maxX - ox) * idx;
        if (dx === 0) { if (ox < b.minX || ox > b.maxX) continue; } else {
          if (a > c) { const s = a; a = c; c = s; }
          if (a > t0) { t0 = a; axis = 0; }
          if (c < t1) t1 = c;
          if (t0 > t1) continue;
        }
        a = (b.minY - oy) * idy; c = (b.maxY - oy) * idy;
        if (dy === 0) { if (oy < b.minY || oy > b.maxY) continue; } else {
          if (a > c) { const s = a; a = c; c = s; }
          if (a > t0) { t0 = a; axis = 1; }
          if (c < t1) t1 = c;
          if (t0 > t1) continue;
        }
        a = (b.minZ - oz) * idz; c = (b.maxZ - oz) * idz;
        if (dz === 0) { if (oz < b.minZ || oz > b.maxZ) continue; } else {
          if (a > c) { const s = a; a = c; c = s; }
          if (a > t0) { t0 = a; axis = 2; }
          if (c < t1) t1 = c;
          if (t0 > t1) continue;
        }
        if (axis < 0) continue; // origin inside the box: ignore
        if (t0 < best) {
          best = t0; found = true;
          hit.t = t0; hit.index = i; hit.mat = b.mat; hit.flags = b.flags;
          hit.nx = axis === 0 ? (dx > 0 ? -1 : 1) : 0;
          hit.ny = axis === 1 ? (dy > 0 ? -1 : 1) : 0;
          hit.nz = axis === 2 ? (dz > 0 ? -1 : 1) : 0;
        }
      }
      if (mask & (F_SOLID | F_BULLET | F_SIGHT)) {
        const rl = this.cellRamps[cell];
        for (let k = 0; k < rl.length; k++) {
          const i = rl[k];
          if (stamp[nb + i] === id) continue;
          stamp[nb + i] = id;
          const r = ramps[i];
          const t = this.rayRamp(r, ox, oy, oz, dx, dy, dz, idx, idy, idz, best, hit);
          if (t >= 0 && t < best) {
            best = t; found = true;
            hit.t = t; hit.index = -1 - i; hit.mat = r.mat; hit.flags = F_WALL;
          }
        }
      }
      if (tMaxX < tMaxZ) { tEnter = tMaxX; tMaxX += tDeltaX; cx += stepX; }
      else { tEnter = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; }
    }
    return found;
  }

  /** Ray vs wedge. Returns t or -1. Writes the normal into `hit` only when it returns a t < best. */
  private rayRamp(r: Ramp, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
    idx: number, idy: number, idz: number, best: number, hit: RayHit): number {
    let t0 = 0, t1 = best, axis = -1;
    let a = (r.minX - ox) * idx, c = (r.maxX - ox) * idx;
    if (dx === 0) { if (ox < r.minX || ox > r.maxX) return -1; } else {
      if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) { t0 = a; axis = 0; }
      if (c < t1) t1 = c;
      if (t0 > t1) return -1;
    }
    a = (r.y0 - oy) * idy; c = (r.y1 - oy) * idy;
    if (dy === 0) { if (oy < r.y0 || oy > r.y1) return -1; } else {
      if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) { t0 = a; axis = 1; }
      if (c < t1) t1 = c;
      if (t0 > t1) return -1;
    }
    a = (r.minZ - oz) * idz; c = (r.maxZ - oz) * idz;
    if (dz === 0) { if (oz < r.minZ || oz > r.maxZ) return -1; } else {
      if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) { t0 = a; axis = 2; }
      if (c < t1) t1 = c;
      if (t0 > t1) return -1;
    }
    // f(t) = y(t) - h(x(t), z(t)); solid where f <= 0
    const slope = ((r.y1 - r.y0) / (r.axis === 0 ? r.maxX - r.minX : r.maxZ - r.minZ)) * r.dir;
    const hAt = (t: number): number => this.rampHeight(r, ox + dx * t, oz + dz * t);
    const f0 = oy + dy * t0 - hAt(t0);
    if (f0 <= 1e-5) {
      if (axis < 0) return -1; // started inside
      hit.nx = axis === 0 ? (dx > 0 ? -1 : 1) : 0;
      hit.ny = axis === 1 ? (dy > 0 ? -1 : 1) : 0;
      hit.nz = axis === 2 ? (dz > 0 ? -1 : 1) : 0;
      return t0;
    }
    const f1 = oy + dy * t1 - hAt(t1);
    if (f1 > 0) return -1;
    const t = t0 + (t1 - t0) * (f0 / (f0 - f1));
    const len = Math.hypot(slope, 1);
    hit.nx = r.axis === 0 ? -slope / len : 0;
    hit.ny = 1 / len;
    hit.nz = r.axis === 1 ? -slope / len : 0;
    return t;
  }

  /** Convenience line-of-sight test between two points. */
  lineBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number, mask: number, hit: RayHit): boolean {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    dx /= len; dy /= len; dz /= len;
    return this.raycast(ax, ay, az, dx, dy, dz, len, mask, hit);
  }
}
