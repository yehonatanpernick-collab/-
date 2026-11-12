// Procedural level construction toolkit. Maps are authored as code: handcrafted
// landmark areas are composed from these modular generators (walls with openings,
// multi-storey buildings with real interiors and stairs, slabs, props, …).
import type { TeamId } from '../config';
import { DEG, Rng } from '../math';
import { F_DYNAMIC, F_GLASS, F_INTERIOR, F_NOCOLLIDE, F_NORENDER, F_SOLID, F_WALL, World } from './World';
import { MAT, PROPS } from './materials';

export interface PropInst { model: string; x: number; y: number; z: number; yaw: number; scale: number; dyn: number }
export interface SpawnPoint { x: number; y: number; z: number; yaw: number }
export interface ObjectiveDef { id: string; name: string; x: number; y: number; z: number; radius: number; spawns: SpawnPoint[] }
export interface BaseDef { team: TeamId; name: string; x: number; z: number; spawns: SpawnPoint[]; vehicle: SpawnPoint | null }
export type DynKind = 'glass' | 'barrel' | 'crate' | 'door';
export interface DynEntity { id: number; kind: DynKind; boxes: number[]; x: number; y: number; z: number; hp: number; prop: number }
export interface LightDef { x: number; y: number; z: number; color: [number, number, number]; range: number; intensity: number }
export interface TreeInst { x: number; y: number; z: number; scale: number; kind: number }
export interface Zone { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
export interface Rect { x0: number; z0: number; x1: number; z1: number }

export interface MapData {
  id: string;
  name: string;
  tagline: string;
  world: World;
  props: PropInst[];
  objectives: ObjectiveDef[];
  bases: BaseDef[];
  dyn: DynEntity[];
  lights: LightDef[];
  interiors: Zone[];
  overwatch: SpawnPoint[];
  trees: TreeInst[];
}

export interface Opening { a0: number; a1: number; y0: number; y1: number; glass?: boolean }
export type Side = 'n' | 's' | 'e' | 'w';

export interface BuildingSpec {
  x0: number; z0: number; x1: number; z1: number;
  floors: number;
  floorH?: number;
  baseY?: number;
  mat: number;
  tint?: number;
  enterable?: boolean;
  doors?: { side: Side; at: number; w?: number; h?: number }[];
  win?: { spacing?: number; w?: number; sill?: number; h?: number; glass?: number; sides?: string; shop?: string; skipGround?: boolean };
  stairs?: { x: number; z: number; axis: 'x' | 'z' };
  roofAccess?: boolean;
  partitions?: { axis: 'x' | 'z'; at: number; door: number; from?: number; to?: number; floors?: number[] }[];
  floorMat?: number;
  roofMat?: number;
  /** Skip facade decoration (far skyline buildings). */
  plain?: boolean;
  parapet?: number;
}

export function subtractRects(rect: Rect, holes: readonly Rect[]): Rect[] {
  let list: Rect[] = [rect];
  for (const h of holes) {
    const next: Rect[] = [];
    for (const r of list) {
      if (h.x0 >= r.x1 || h.x1 <= r.x0 || h.z0 >= r.z1 || h.z1 <= r.z0) { next.push(r); continue; }
      if (h.z0 > r.z0) next.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: h.z0 });
      if (h.z1 < r.z1) next.push({ x0: r.x0, z0: h.z1, x1: r.x1, z1: r.z1 });
      const zz0 = Math.max(r.z0, h.z0), zz1 = Math.min(r.z1, h.z1);
      if (h.x0 > r.x0) next.push({ x0: r.x0, z0: zz0, x1: h.x0, z1: zz1 });
      if (h.x1 < r.x1) next.push({ x0: h.x1, z0: zz0, x1: r.x1, z1: zz1 });
    }
    list = next;
  }
  return list;
}

const WALL_T = 0.3;

export class MapBuilder {
  readonly world = new World();
  readonly props: PropInst[] = [];
  readonly dyn: DynEntity[] = [];
  readonly lights: LightDef[] = [];
  readonly interiors: Zone[] = [];
  readonly objectives: ObjectiveDef[] = [];
  readonly bases: BaseDef[] = [];
  readonly overwatch: SpawnPoint[] = [];
  readonly trees: TreeInst[] = [];
  readonly rng: Rng;

  constructor(seed: number) { this.rng = new Rng(seed); }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: number, flags: number = F_WALL, tint = 0, ref = -1): number {
    return this.world.addBox({
      minX: Math.min(x0, x1), minY: Math.min(y0, y1), minZ: Math.min(z0, z1),
      maxX: Math.max(x0, x1), maxY: Math.max(y0, y1), maxZ: Math.max(z0, z1),
      mat, flags, tint, ref, enabled: true,
    });
  }

  decor(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: number, tint = 0): number {
    return this.box(x0, y0, z0, x1, y1, z1, mat, F_NOCOLLIDE, tint);
  }

  ramp(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, axis: 0 | 1, dir: 1 | -1, mat: number, stairs = true): number {
    return this.world.addRamp({ minX: Math.min(x0, x1), minZ: Math.min(z0, z1), maxX: Math.max(x0, x1), maxZ: Math.max(z0, z1), y0, y1, axis, dir, mat, stairs });
  }

  light(x: number, y: number, z: number, color: [number, number, number] = [1, 0.86, 0.66], range = 11, intensity = 1.4): void {
    this.lights.push({ x, y, z, color, range, intensity });
  }

  private addDyn(kind: DynKind, boxes: number[], x: number, y: number, z: number, hp: number, prop = -1): number {
    const id = this.dyn.length;
    this.dyn.push({ id, kind, boxes, x, y, z, hp, prop });
    for (const b of boxes) this.world.boxes[b].ref = id;
    return id;
  }

  /** Breakable glass pane occupying the given box. */
  glass(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const b = this.box(x0, y0, z0, x1, y1, z1, MAT.GLASS, F_SOLID | F_GLASS | F_DYNAMIC);
    this.addDyn('glass', [b], (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 1);
  }

  /**
   * Wall along the X axis occupying z ∈ [z, z + t]. Openings are cut out; `glass` openings receive a pane.
   */
  wallX(z: number, x0: number, x1: number, y0: number, y1: number, mat: number, tint = 0, openings: Opening[] = [], t = WALL_T, flags: number = F_WALL): void {
    this.wall(0, z, x0, x1, y0, y1, mat, tint, openings, t, flags);
  }

  /** Wall along the Z axis occupying x ∈ [x, x + t]. */
  wallZ(x: number, z0: number, z1: number, y0: number, y1: number, mat: number, tint = 0, openings: Opening[] = [], t = WALL_T, flags: number = F_WALL): void {
    this.wall(1, x, z0, z1, y0, y1, mat, tint, openings, t, flags);
  }

  private wall(axis: 0 | 1, fixed: number, a0: number, a1: number, y0: number, y1: number, mat: number, tint: number, openings: Opening[], t: number, flags: number): void {
    const ops = openings
      .map((o) => ({ ...o, a0: Math.max(a0, o.a0), a1: Math.min(a1, o.a1), y0: Math.max(y0, o.y0), y1: Math.min(y1, o.y1) }))
      .filter((o) => o.a1 - o.a0 > 0.01 && o.y1 - o.y0 > 0.01);
    const ys = Array.from(new Set([y0, y1, ...ops.flatMap((o) => [o.y0, o.y1])])).sort((p, q) => p - q);
    const put = (p0: number, p1: number, ya: number, yb: number): void => {
      if (p1 - p0 < 0.01 || yb - ya < 0.01) return;
      if (axis === 0) this.box(p0, ya, fixed, p1, yb, fixed + t, mat, flags, tint);
      else this.box(fixed, ya, p0, fixed + t, yb, p1, mat, flags, tint);
    };
    for (let i = 0; i < ys.length - 1; i++) {
      const ya = ys[i], yb = ys[i + 1];
      const active = ops.filter((o) => o.y0 < yb - 1e-6 && o.y1 > ya + 1e-6).sort((p, q) => p.a0 - q.a0);
      let cur = a0;
      for (const o of active) {
        if (o.a0 > cur) put(cur, o.a0, ya, yb);
        cur = Math.max(cur, o.a1);
      }
      put(cur, a1, ya, yb);
    }
    for (const o of ops) {
      if (!o.glass) continue;
      const m = fixed + t / 2;
      if (axis === 0) this.glass(o.a0, o.y0, m - 0.03, o.a1, o.y1, m + 0.03);
      else this.glass(m - 0.03, o.y0, o.a0, m + 0.03, o.y1, o.a1);
    }
  }

  /** Horizontal slab with rectangular holes. */
  slab(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: number, holes: Rect[] = [], flags: number = F_WALL, tint = 0): void {
    for (const r of subtractRects({ x0, z0, x1, z1 }, holes)) this.box(r.x0, y0, r.z0, r.x1, y1, r.z1, mat, flags, tint);
  }

  /**
   * Place a GLB prop with its bottom centre at (x, y, z). Solid props get an (invisible) AABB collider.
   * `dyn` turns it into a destructible entity.
   */
  prop(model: string, x: number, y: number, z: number, yawDeg = 0, scale = 1, opts: { collide?: boolean; dyn?: DynKind; hp?: number } = {}): number {
    const def = PROPS[model];
    if (!def) throw new Error(`unknown prop ${model}`);
    const index = this.props.length;
    const inst: PropInst = { model, x, y, z, yaw: yawDeg * DEG, scale, dyn: -1 };
    this.props.push(inst);
    const collide = opts.collide ?? def.solid;
    if (collide) {
      const hx = ((def.max[0] - def.min[0]) / 2) * scale, hz = ((def.max[2] - def.min[2]) / 2) * scale;
      const c = Math.abs(Math.cos(inst.yaw)), s = Math.abs(Math.sin(inst.yaw));
      const ex = c * hx + s * hz, ez = s * hx + c * hz;
      const top = y + (def.max[1] - Math.max(0, def.min[1])) * scale;
      const flags = F_WALL | F_NORENDER | (opts.dyn ? F_DYNAMIC : 0);
      const b = this.box(x - ex, y, z - ez, x + ex, top, z + ez, MAT.METAL, flags);
      if (opts.dyn) inst.dyn = this.addDyn(opts.dyn, [b], x, y + (top - y) / 2, z, opts.hp ?? 40, index);
    }
    return index;
  }

  /** Explosive barrel. */
  barrel(x: number, y: number, z: number): void {
    this.prop('Barrel_01', x, y, z, this.rng.range(0, 360), 1.15, { dyn: 'barrel', hp: 35 });
  }

  /** Destructible wooden crate stack. */
  crate(x: number, y: number, z: number, yawDeg = 0, scale = 2): void {
    this.prop('wooden_crate_02', x, y, z, yawDeg, scale, { dyn: 'crate', hp: 60 });
  }

  /** Sandbag wall segment (solid, chest high). */
  sandbags(x0: number, z0: number, x1: number, z1: number, y: number, h = 1.1): void {
    this.box(x0, y, z0, x1, y + h, z1, MAT.SANDBAG, F_WALL, 0);
    // rounded cap row for silhouette
    this.decor(x0 + 0.06, y + h, z0 + 0.06, x1 - 0.06, y + h + 0.1, z1 - 0.06, MAT.SANDBAG);
  }

  /** Shipping container: hollow look is not needed, it is solid cover. */
  container(x: number, y: number, z: number, alongX: boolean, tint: number): void {
    const hx = alongX ? 3.05 : 1.22, hz = alongX ? 1.22 : 3.05;
    this.box(x - hx, y, z - hz, x + hx, y + 2.6, z + hz, MAT.CORRUGATED, F_WALL, tint);
    this.decor(x - hx - 0.04, y, z - hz - 0.04, x + hx + 0.04, y + 0.18, z + hz + 0.04, MAT.METAL, 12);
    this.decor(x - hx - 0.04, y + 2.5, z - hz - 0.04, x + hx + 0.04, y + 2.64, z + hz + 0.04, MAT.METAL, 12);
  }

  // ---------------------------------------------------------------- buildings
  building(o: BuildingSpec): void {
    const FH = o.floorH ?? 3.4;
    const base = o.baseY ?? 0.15;
    const tint = o.tint ?? 0;
    const { x0, z0, x1, z1, floors } = o;
    const top = base + floors * FH;
    const T = WALL_T;
    const rng = this.rng;

    if (!o.enterable) {
      this.box(x0, base - 0.15, z0, x1, top, z1, o.mat, F_WALL, tint);
      this.decor(x0 - 0.12, top, z0 - 0.12, x1 + 0.12, top + 0.5, z1 + 0.12, MAT.TRIM, 0);
      if (o.plain) return;
      this.decor(x0 - 0.06, base - 0.15, z0 - 0.06, x1 + 0.06, base + 0.9, z1 + 0.06, MAT.TRIM, 8);
      const spacing = 3.2, w = 1.5;
      for (let f = 0; f < floors; f++) {
        const yb = base + f * FH + (f === 0 ? 1.3 : 1.0), yt = base + f * FH + FH - 0.7;
        const lit = (): number => (rng.chance(0.07) ? MAT.LAMP : MAT.DARKGLASS);
        const nX = Math.floor((x1 - x0 - 1.6) / spacing), sX = x0 + (x1 - x0 - nX * spacing) / 2 + (spacing - w) / 2;
        for (let i = 0; i < nX; i++) {
          const a = sX + i * spacing;
          this.decor(a, yb, z0 - 0.05, a + w, yt, z0, lit());
          this.decor(a, yb, z1, a + w, yt, z1 + 0.05, lit());
        }
        const nZ = Math.floor((z1 - z0 - 1.6) / spacing), sZ = z0 + (z1 - z0 - nZ * spacing) / 2 + (spacing - w) / 2;
        for (let i = 0; i < nZ; i++) {
          const a = sZ + i * spacing;
          this.decor(x0 - 0.05, yb, a, x0, yt, a + w, lit());
          this.decor(x1, yb, a, x1 + 0.05, yt, a + w, lit());
        }
        if (f > 0) this.decor(x0 - 0.08, base + f * FH - 0.12, z0 - 0.08, x1 + 0.08, base + f * FH + 0.08, z1 + 0.08, MAT.TRIM, 0);
      }
      return;
    }

    const floorMat = o.floorMat ?? MAT.FLOOR;
    const win = { spacing: 3.2, w: 1.4, sill: 1.0, h: 1.4, glass: 0.6, sides: 'nsew', shop: '', skipGround: false };
    for (const [k, v] of Object.entries(o.win ?? {})) if (v !== undefined) (win as Record<string, unknown>)[k] = v;
    this.box(x0 + T, base, z0 + T, x1 - T, base + 0.04, z1 - T, floorMat, F_WALL | F_INTERIOR);

    // --- stairs
    const flights: { rect: Rect; k: number }[] = [];
    if (o.stairs) {
      const last = o.roofAccess ? floors - 1 : floors - 2;
      for (let k = 0; k <= last; k++) {
        const lane = k % 2;
        const dir: 1 | -1 = k % 2 === 0 ? 1 : -1;
        const y0 = base + k * FH, y1 = base + (k + 1) * FH;
        let rect: Rect;
        if (o.stairs.axis === 'z') {
          rect = { x0: o.stairs.x + lane * 2, z0: o.stairs.z, x1: o.stairs.x + lane * 2 + 2, z1: o.stairs.z + 6 };
          this.ramp(rect.x0, rect.z0, rect.x1, rect.z1, y0, y1, 1, dir, MAT.CONCRETE);
        } else {
          rect = { x0: o.stairs.x, z0: o.stairs.z + lane * 2, x1: o.stairs.x + 6, z1: o.stairs.z + lane * 2 + 2 };
          this.ramp(rect.x0, rect.z0, rect.x1, rect.z1, y0, y1, 0, dir, MAT.CONCRETE);
        }
        flights.push({ rect, k });
        // railing at the low end of the opening on the floor above
        const ry = y1, rh = 1.0;
        if (o.stairs.axis === 'z') {
          const zLow = dir > 0 ? rect.z0 : rect.z1;
          this.box(rect.x0, ry, zLow - 0.05, rect.x1, ry + rh, zLow + 0.05, MAT.METAL, F_WALL, 12);
          const xOut = lane === 0 ? rect.x0 : rect.x1;
          this.box(xOut - 0.05, ry, rect.z0, xOut + 0.05, ry + rh, rect.z1, MAT.METAL, F_WALL, 12);
        } else {
          const xLow = dir > 0 ? rect.x0 : rect.x1;
          this.box(xLow - 0.05, ry, rect.z0, xLow + 0.05, ry + rh, rect.z1, MAT.METAL, F_WALL, 12);
          const zOut = lane === 0 ? rect.z0 : rect.z1;
          this.box(rect.x0, ry, zOut - 0.05, rect.x1, ry + rh, zOut + 0.05, MAT.METAL, F_WALL, 12);
        }
      }
    }

    // --- slabs
    for (let k = 1; k <= floors; k++) {
      const y1 = base + k * FH;
      const holes = flights.filter((f) => f.k === k - 1).map((f) => f.rect);
      const isRoof = k === floors;
      this.slab(x0 + (isRoof ? 0 : T), z0 + (isRoof ? 0 : T), x1 - (isRoof ? 0 : T), z1 - (isRoof ? 0 : T), y1 - 0.3, y1,
        isRoof ? (o.roofMat ?? MAT.CONCRETE) : floorMat, holes, F_WALL | (isRoof ? 0 : F_INTERIOR), isRoof ? 8 : 0);
    }

    // --- outer walls
    const doors = o.doors ?? [];
    const sideOpenings = (side: Side, f: number, a0: number, a1: number): Opening[] => {
      const yb = base + f * FH;
      const ops: Opening[] = [];
      if (f === 0) for (const d of doors) if (d.side === side) ops.push({ a0: d.at, a1: d.at + (d.w ?? 2), y0: yb, y1: yb + (d.h ?? 2.3) });
      if (!win.sides.includes(side) || (f === 0 && win.skipGround)) return ops;
      const shop = f === 0 && win.shop.includes(side);
      const spacing = shop ? win.spacing + 1 : win.spacing;
      const w = shop ? spacing - 1.2 : win.w;
      const sill = shop ? 0.55 : win.sill, h = shop ? 2.0 : win.h;
      const len = a1 - a0;
      const n = Math.floor((len - 1.6) / spacing);
      if (n <= 0) return ops;
      const start = a0 + (len - n * spacing) / 2 + (spacing - w) / 2;
      for (let i = 0; i < n; i++) {
        const wa = start + i * spacing;
        if (ops.some((d) => wa < d.a1 + 0.5 && wa + w > d.a0 - 0.5)) continue;
        ops.push({ a0: wa, a1: wa + w, y0: yb + sill, y1: yb + sill + h, glass: rng.chance(win.glass) });
      }
      return ops;
    };
    for (let f = 0; f < floors; f++) {
      const yb = base + f * FH, yt = yb + FH - (f === floors - 1 ? 0.3 : 0);
      this.wallX(z0, x0, x1, yb, yt, o.mat, tint, sideOpenings('n', f, x0 + T, x1 - T));
      this.wallX(z1 - T, x0, x1, yb, yt, o.mat, tint, sideOpenings('s', f, x0 + T, x1 - T));
      this.wallZ(x0, z0 + T, z1 - T, yb, yt, o.mat, tint, sideOpenings('w', f, z0 + T, z1 - T));
      this.wallZ(x1 - T, z0 + T, z1 - T, yb, yt, o.mat, tint, sideOpenings('e', f, z0 + T, z1 - T));
      if (f > 0 && !o.plain) this.decor(x0 - 0.07, yb - 0.14, z0 - 0.07, x1 + 0.07, yb + 0.06, z1 + 0.07, MAT.TRIM, 0);

      // partitions
      for (const p of o.partitions ?? []) {
        if (p.floors && !p.floors.includes(f)) continue;
        const ceil = yb + FH - 0.3;
        const op: Opening[] = [{ a0: p.door, a1: p.door + 2, y0: yb, y1: yb + 2.3 }];
        if (p.axis === 'x') this.wallX(p.at, p.from ?? x0 + T, p.to ?? x1 - T, yb, ceil, MAT.PAINTED, 5, op, 0.2, F_WALL | F_INTERIOR);
        else this.wallZ(p.at, p.from ?? z0 + T, p.to ?? z1 - T, yb, ceil, MAT.PAINTED, 5, op, 0.2, F_WALL | F_INTERIOR);
      }

      // ceiling lights
      const nx = Math.max(1, Math.round((x1 - x0) / 10)), nz = Math.max(1, Math.round((z1 - z0) / 10));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const lx = x0 + ((i + 0.5) * (x1 - x0)) / nx, lz = z0 + ((j + 0.5) * (z1 - z0)) / nz;
        const ly = yb + FH - 0.34;
        if (flights.some((fl) => fl.k === f && lx > fl.rect.x0 - 0.5 && lx < fl.rect.x1 + 0.5 && lz > fl.rect.z0 - 0.5 && lz < fl.rect.z1 + 0.5)) continue;
        this.decor(lx - 0.5, ly - 0.05, lz - 0.12, lx + 0.5, ly, lz + 0.12, MAT.LAMP);
        this.light(lx, ly - 0.5, lz);
      }
    }
    this.interiors.push({ minX: x0 + T, minY: base, minZ: z0 + T, maxX: x1 - T, maxY: top - 0.3, maxZ: z1 - T });

    // --- roof: parapet + stair bulkhead + clutter
    const ph = o.parapet ?? 0.9;
    this.wallX(z0, x0, x1, top, top + ph, o.mat, tint);
    this.wallX(z1 - T, x0, x1, top, top + ph, o.mat, tint);
    this.wallZ(x0, z0 + T, z1 - T, top, top + ph, o.mat, tint);
    this.wallZ(x1 - T, z0 + T, z1 - T, top, top + ph, o.mat, tint);
    if (!o.plain) this.decor(x0 - 0.1, top + ph, z0 - 0.1, x1 + 0.1, top + ph + 0.08, z1 + 0.1, MAT.TRIM, 0);
    const roofFlight = flights.find((f) => f.k === floors - 1);
    if (roofFlight && o.stairs) {
      const r = roofFlight.rect, bh = 2.5, t = 0.2;
      const dir = (floors - 1) % 2 === 0 ? 1 : -1;
      // side walls stop flush with the exit (high) end so the doorway stays clear
      if (o.stairs.axis === 'z') {
        const za = dir > 0 ? r.z0 - t : r.z0, zb = dir > 0 ? r.z1 : r.z1 + t;
        this.box(r.x0 - t, top, za, r.x0, top + bh, zb, MAT.CONCRETE, F_WALL, 8);
        this.box(r.x1, top, za, r.x1 + t, top + bh, zb, MAT.CONCRETE, F_WALL, 8);
        const zLow = dir > 0 ? r.z0 - t : r.z1;
        this.box(r.x0, top, zLow, r.x1, top + bh, zLow + t, MAT.CONCRETE, F_WALL, 8);
        this.box(r.x0 - t, top + bh, za, r.x1 + t, top + bh + 0.2, zb, MAT.CONCRETE, F_WALL, 8);
      } else {
        const xa = dir > 0 ? r.x0 - t : r.x0, xb = dir > 0 ? r.x1 : r.x1 + t;
        this.box(xa, top, r.z0 - t, xb, top + bh, r.z0, MAT.CONCRETE, F_WALL, 8);
        this.box(xa, top, r.z1, xb, top + bh, r.z1 + t, MAT.CONCRETE, F_WALL, 8);
        const xLow = dir > 0 ? r.x0 - t : r.x1;
        this.box(xLow, top, r.z0, xLow + t, top + bh, r.z1, MAT.CONCRETE, F_WALL, 8);
        this.box(xa, top + bh, r.z0 - t, xb, top + bh + 0.2, r.z1 + t, MAT.CONCRETE, F_WALL, 8);
      }
    }
  }

  /** Ground tiling from a breakpoint grid; `classify` returns null for holes. */
  ground(xs: number[], zs: number[], yBottom: number, classify: (cx: number, cz: number) => { mat: number; top: number; tint?: number } | null): void {
    for (let j = 0; j < zs.length - 1; j++) {
      let runStart = -1;
      let runKey = '';
      let runVal: { mat: number; top: number; tint?: number } | null = null;
      const flush = (iEnd: number): void => {
        if (runStart >= 0 && runVal) this.box(xs[runStart], yBottom, zs[j], xs[iEnd], runVal.top, zs[j + 1], runVal.mat, F_WALL, runVal.tint ?? 0);
        runStart = -1;
      };
      for (let i = 0; i < xs.length - 1; i++) {
        const c = classify((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2);
        const key = c ? `${c.mat}|${c.top}|${c.tint ?? 0}` : 'hole';
        if (key !== runKey) { flush(i); runKey = key; runVal = c; runStart = c ? i : -1; }
      }
      flush(xs.length - 1);
    }
  }

  /**
   * Scatter street trees on free sidewalk. Must run after all other geometry so overlap tests see everything.
   * Each tree gets a small solid trunk collider.
   */
  scatterTrees(spacing: number, max: number, bounds: Rect): void {
    const boxes = this.world.boxes;
    const groundAt = (x: number, z: number): { top: number; mat: number } => {
      let top = -Infinity, mat = -1;
      for (const b of boxes) {
        if (b.flags & F_NOCOLLIDE) continue;
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.minY <= 0.01 && b.maxY > top) { top = b.maxY; mat = b.mat; }
      }
      return { top, mat };
    };
    const free = (x: number, z: number, r: number): boolean => {
      for (const b of boxes) {
        if (!(b.flags & F_SOLID) || b.enabled === false) continue;
        if (b.maxY < 0.4) continue;
        if (b.minX < x + r && b.maxX > x - r && b.minZ < z + r && b.maxZ > z - r) return false;
      }
      return true;
    };
    const keepClear: { x: number; z: number; r: number }[] = [
      ...this.objectives.map((o) => ({ x: o.x, z: o.z, r: o.radius + 3 })),
      ...this.bases.flatMap((bs) => bs.spawns.map((sp) => ({ x: sp.x, z: sp.z, r: 4 }))),
    ];
    const w = { minX: bounds.x0, maxX: bounds.x1, minZ: bounds.z0, maxZ: bounds.z1 };
    let n = 0;
    for (let tries = 0; tries < 2500 && n < max; tries++) {
      const x = this.rng.range(w.minX + 6, w.maxX - 6), z = this.rng.range(w.minZ + 6, w.maxZ - 6);
      const g = groundAt(x, z);
      if (g.mat !== MAT.SIDEWALK || Math.abs(g.top - 0.15) > 0.02) continue;
      if (!free(x, z, 1.3)) continue;
      if (keepClear.some((k) => Math.hypot(x - k.x, z - k.z) < k.r)) continue;
      if (this.trees.some((t) => Math.hypot(t.x - x, t.z - z) < spacing)) continue;
      // keep the street edge readable: stay at least 1.2 m off the kerb
      if (groundAt(x + 1.2, z).mat !== MAT.SIDEWALK || groundAt(x - 1.2, z).mat !== MAT.SIDEWALK || groundAt(x, z + 1.2).mat !== MAT.SIDEWALK || groundAt(x, z - 1.2).mat !== MAT.SIDEWALK) continue;
      this.trees.push({ x, y: 0.15, z, scale: this.rng.range(0.85, 1.25), kind: this.rng.int(0, 2) });
      this.box(x - 0.2, 0.15, z - 0.2, x + 0.2, 3.2, z + 0.2, MAT.METAL, F_WALL | F_NORENDER);
      n++;
    }
  }

  finish(id: string, name: string, tagline: string, bounds: Rect): MapData {
    this.world.setBounds(bounds.x0, bounds.z0, bounds.x1, bounds.z1);
    this.world.finalize();
    return {
      id, name, tagline, world: this.world, props: this.props, objectives: this.objectives, bases: this.bases,
      dyn: this.dyn, lights: this.lights, interiors: this.interiors, overwatch: this.overwatch, trees: this.trees,
    };
  }
}
