/// <reference lib="webworker" />
/**
 * Background tile builder (Web Worker).
 * Turns real geographic data (DEM, road centrelines, building footprints, piers) into render-ready
 * geometry buffers and physics collider meshes, entirely off the main thread.
 */
import { ShapeUtils, Vector2 } from 'three';
import { WorldData, type TileData, type TileBuilding } from '../data/WorldData';
import { RoadGraph, type Edge } from '../ai/RoadGraph';

type Attr = { [k: string]: [Float32Array | Uint8Array, number, boolean?] };
export interface GeoBuf { attrs: Attr; index: Uint32Array }
export interface TileResult {
  i: number; j: number; lod: number;
  terrain: GeoBuf;
  roads?: GeoBuf; sidewalks?: GeoBuf; bridges?: GeoBuf; buildings?: GeoBuf; piers?: GeoBuf;
  colBuildings?: GeoBuf; colBridges?: GeoBuf; colPiers?: GeoBuf;
  trees?: Float32Array; furniture?: Float32Array; buildingCount: number;
  names: { n: string; x: number; y: number; z: number; h: number }[];
}

const world = new WorldData('./data/');
let graph: RoadGraph;
const tileCache = new Map<string, TileData | null>();
let ready: Promise<void>;

class Builder {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; idx: number[] = [];
  extra: Record<string, { size: number; data: number[] }> = {};
  constructor(extras: Record<string, number> = {}) {
    for (const [k, s] of Object.entries(extras)) this.extra[k] = { size: s, data: [] };
  }
  get count(): number { return this.pos.length / 3; }
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, ex: Record<string, number[]> = {}): number {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, w);
    for (const k in this.extra) this.extra[k].data.push(...(ex[k] ?? new Array(this.extra[k].size).fill(0)));
    return this.count - 1;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number): void { this.idx.push(a, b, c, a, c, d); }
  /** triangle oriented so that its normal points up (+Y) */
  triUp(a: number, b: number, c: number): void {
    const P = this.pos;
    const cy = (P[3 * b + 2] - P[3 * a + 2]) * (P[3 * c] - P[3 * a]) - (P[3 * b] - P[3 * a]) * (P[3 * c + 2] - P[3 * a + 2]);
    if (cy >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  out(withNormals = true): GeoBuf | undefined {
    if (!this.idx.length) return undefined;
    const attrs: Attr = { position: [new Float32Array(this.pos), 3] };
    if (withNormals) attrs.normal = [new Float32Array(this.nrm), 3];
    attrs.uv = [new Float32Array(this.uv), 2];
    for (const k in this.extra) {
      if (k === 'color') attrs[k] = [Uint8Array.from(this.extra[k].data, (v) => Math.round(Math.max(0, Math.min(1, v)) * 255)), 3, true];
      else attrs[k] = [new Float32Array(this.extra[k].data), this.extra[k].size];
    }
    return { attrs, index: new Uint32Array(this.idx) };
  }
}

// ------------------------------------------------------------------ terrain
function buildTerrain(i: number, j: number, lod: number): GeoBuf {
  const g = world.meta.grid, T = world.tileSize;
  const step = lod <= 1 ? 1 : lod === 2 ? 2 : 5;
  const n = Math.round(T / g.step / step);
  const gi0 = Math.round((i * T - g.x0) / g.step), gj0 = Math.round((j * T - g.z0) / g.step);
  const b = new Builder({ surf: 4 });
  const W = n + 1;
  const surfW = (si: number, sj: number): number[] => {
    const w = [0, 0, 0, 0];
    let cnt = 0;
    // Marin Headlands (north of the Golden Gate strait) are natural scrub/grassland, not city
    const zz = world.meta.grid.z0 + sj * world.meta.grid.step;
    const marin = zz < -4300;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const s = world.surfaceGrid(si + di, sj + dj); cnt++;
      if (s === 1 || s === 8) w[0] += 1; else if (s === 2) w[1] += 1; else if (s === 3 || s === 6 || s === 7) w[2] += 1;
      else if (s === 4) w[3] += 1; else if (s === 5 || (s === 0 && marin)) { w[0] += 0.55; w[3] += 0.25; }
    }
    return w.map((v) => v / cnt);
  };
  for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) {
    const gi = gi0 + c * step, gj = gj0 + r * step;
    const x = g.x0 + gi * g.step, z = g.z0 + gj * g.step;
    const h = world.heightGrid(gi, gj);
    const hx = world.heightGrid(gi + 1, gj) - world.heightGrid(gi - 1, gj);
    const hz = world.heightGrid(gi, gj + 1) - world.heightGrid(gi, gj - 1);
    const nx = -hx, ny = 2 * g.step, nz = -hz; const l = Math.hypot(nx, ny, nz);
    b.v(x, h, z, nx / l, ny / l, nz / l, x / 50, z / 50, { surf: surfW(gi, gj) });
  }
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const a = r * W + c, bb = a + 1, cc = a + W, d = cc + 1;
    b.tri(a, cc, bb); b.tri(bb, cc, d);
  }
  // skirts (hide LOD cracks between tiles of different resolution)
  const drop = 3 * step;
  const edgeLoop: number[] = [];
  for (let c = 0; c <= n; c++) edgeLoop.push(c);
  for (let r = 1; r <= n; r++) edgeLoop.push(r * W + n);
  for (let c = n - 1; c >= 0; c--) edgeLoop.push(n * W + c);
  for (let r = n - 1; r >= 0; r--) edgeLoop.push(r * W);
  const P = b.pos, S = b.extra.surf.data;
  const low = edgeLoop.map((k) => b.v(P[3 * k], P[3 * k + 1] - drop, P[3 * k + 2], 0, 1, 0, 0, 0, { surf: S.slice(4 * k, 4 * k + 4) }));
  for (let k = 0; k < edgeLoop.length - 1; k++) {
    const a = edgeLoop[k], bb = edgeLoop[k + 1];
    b.quad(a, bb, low[k + 1], low[k]);
    b.quad(a, low[k], low[k + 1], bb);
  }
  return b.out()!;
}

// ------------------------------------------------------------------ roads
interface Sample { x: number; z: number; s: number; tx: number; tz: number; y: number | null }

function resample(e: Edge, spacing: number, extraS: number[]): Sample[] {
  const set = new Set<number>();
  for (let k = 0; k < e.cum.length; k++) set.add(+e.cum[k].toFixed(3));
  for (let s = spacing; s < e.len; s += spacing) set.add(+s.toFixed(3));
  for (const s of extraS) if (s > 0 && s < e.len) set.add(+s.toFixed(3));
  const ss = [...set].sort((a, b) => a - b);
  const o = { x: 0, z: 0, tx: 0, tz: 0, y: 0 };
  const res: Sample[] = [];
  for (const s of ss) {
    graph.sample(e, s, o);
    // averaged tangent at polyline vertices
    graph.sample(e, Math.max(0, s - 0.5), o); const ax = o.x, az = o.z;
    graph.sample(e, Math.min(e.len, s + 0.5), o); const bx = o.x, bz = o.z;
    graph.sample(e, s, o);
    let tx = bx - ax, tz = bz - az; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    res.push({ x: o.x, z: o.z, s, tx, tz, y: e.el ? o.y : null });
  }
  return res;
}

const inTile = (x: number, z: number, i: number, j: number) => {
  const T = world.tileSize; return x >= i * T && x < (i + 1) * T && z >= j * T && z < (j + 1) * T;
};

function buildRoads(t: TileData, lod: number) {
  const roads = new Builder({ rinfo: 4, rj: 4 });
  const side = new Builder();
  const bridge = new Builder();
  const colBr = new Builder();
  const lat0 = lod === 0 ? [-1, -0.5, 0, 0.5, 1] : [-1, 0, 1];
  for (const id of t.rd) {
    const e = graph.edges[id];
    if (e.tunnel) continue;
    if (lod >= 2 && e.cls >= 6) continue;
    if (lod >= 3 && e.cls >= 4) continue;
    const hw = e.w / 2;
    const jrS = graph.degree[e.a] >= 3 ? graph.junctionRadius[e.a] : 0;
    const jrE = graph.degree[e.b] >= 3 ? graph.junctionRadius[e.b] : 0;
    const swS = Math.max(0, jrS - 0.6), swE = Math.max(0, jrE - 0.6);
    const smp = resample(e, lod === 0 ? 5 : lod === 1 ? 10 : 25, [swS, e.len - swE]);
    const rinfo = [hw, Math.max(1, e.lanes), e.oneway !== 0 ? 1 : 0, e.cls];
    const yAt = (sm: Sample, ox: number, oz: number) => sm.y !== null ? sm.y + 0.02 : world.heightAt(ox, oz) + 0.07;
    // cross sections
    const secs: number[][] = [];
    for (const sm of smp) {
      const rx = -sm.tz, rz = sm.tx; // right-hand normal
      const row: number[] = [];
      for (const f of lat0) {
        const ox = sm.x + rx * hw * f, oz = sm.z + rz * hw * f;
        row.push(roads.v(ox, yAt(sm, ox, oz), oz, 0, 1, 0, hw * f, sm.s, { rinfo, rj: [sm.s, e.len - sm.s, jrS, jrE] }));
      }
      secs.push(row);
    }
    const keep: boolean[] = [];
    for (let k = 0; k < smp.length - 1; k++) {
      const mx = (smp[k].x + smp[k + 1].x) / 2, mz = (smp[k].z + smp[k + 1].z) / 2;
      keep.push(inTile(mx, mz, t.i, t.j));
      if (!keep[k]) continue;
      const A = secs[k], B = secs[k + 1];
      for (let c = 0; c < A.length - 1; c++) roads.quad(A[c], A[c + 1], B[c + 1], B[c]);
    }
    // fix normals of draped ribbons from geometry
    // sidewalks with curbs (detail LOD, urban streets)
    if (lod === 0 && !e.el && e.cls >= 1 && e.cls <= 6 && e.w >= 6) {
      for (const sgn of [1, -1]) {
        let prev: number[] | null = null;
        for (let k = 0; k < smp.length; k++) {
          const sm = smp[k];
          const ok = sm.s >= swS - 0.01 && sm.s <= e.len - swE + 0.01;
          if (!ok) { prev = null; continue; }
          const rx = -sm.tz * sgn, rz = sm.tx * sgn;
          const x0 = sm.x + rx * hw, z0 = sm.z + rz * hw;
          const x1 = sm.x + rx * (hw + 2.6), z1 = sm.z + rz * (hw + 2.6);
          const y0 = world.heightAt(x0, z0) + 0.07, y1 = world.heightAt(x1, z1);
          const top0 = Math.max(y0 + 0.15, y1 + 0.12);
          const cur = [
            side.v(x0, y0 - 0.05, z0, rx, 0, rz, 0, sm.s),
            side.v(x0, top0, z0, 0, 1, 0, 0.0, sm.s),
            side.v(x1, Math.max(y1 + 0.12, top0 - 0.12), z1, 0, 1, 0, 2.6, sm.s),
            side.v(x1, y1 - 0.3, z1, -rx, 0, -rz, 2.6, sm.s),
          ];
          if (prev && k > 0 && keep[k - 1]) {
            const f = sgn > 0;
            for (let c = 0; c < 3; c++) {
              if (f) side.quad(prev[c], prev[c + 1], cur[c + 1], cur[c]); else side.quad(prev[c], cur[c], cur[c + 1], prev[c + 1]);
            }
          }
          prev = cur;
        }
      }
    }
    // bridge deck structure: slab sides, underside, barriers, piers
    if (e.el) {
      const deep = 1.8;
      for (let k = 0; k < smp.length - 1; k++) {
        if (!keep[k]) continue;
        const a = smp[k], c = smp[k + 1];
        const ya = a.y!, yc = c.y!;
        for (const sgn of [1, -1]) {
          const ra = [-a.tz * sgn, a.tx * sgn], rc = [-c.tz * sgn, c.tx * sgn];
          const ax = a.x + ra[0] * (hw + 0.4), az = a.z + ra[1] * (hw + 0.4);
          const cx = c.x + rc[0] * (hw + 0.4), cz = c.z + rc[1] * (hw + 0.4);
          const p0 = bridge.v(ax, ya + 1.0, az, ra[0], 0, ra[1], 0, 0);
          const p1 = bridge.v(cx, yc + 1.0, cz, ra[0], 0, ra[1], 1, 0);
          const p2 = bridge.v(cx, yc - deep, cz, ra[0], 0, ra[1], 1, 1);
          const p3 = bridge.v(ax, ya - deep, az, ra[0], 0, ra[1], 0, 1);
          if (sgn > 0) bridge.quad(p0, p3, p2, p1); else bridge.quad(p0, p1, p2, p3);
          // inner barrier face
          const ix = a.x + ra[0] * hw, iz = a.z + ra[1] * hw, jx = c.x + rc[0] * hw, jz = c.z + rc[1] * hw;
          const q0 = bridge.v(ix, ya + 1.0, iz, -ra[0], 0, -ra[1], 0, 0);
          const q1 = bridge.v(jx, yc + 1.0, jz, -ra[0], 0, -ra[1], 1, 0);
          const q2 = bridge.v(jx, yc, jz, -ra[0], 0, -ra[1], 1, 1);
          const q3 = bridge.v(ix, ya, iz, -ra[0], 0, -ra[1], 0, 1);
          if (sgn > 0) bridge.quad(q0, q1, q2, q3); else bridge.quad(q0, q3, q2, q1);
          const t0 = bridge.v(ix, ya + 1.0, iz, 0, 1, 0, 0, 0), t1 = bridge.v(jx, yc + 1.0, jz, 0, 1, 0, 1, 0);
          const t2 = bridge.v(cx, yc + 1.0, cz, 0, 1, 0, 1, 1), t3 = bridge.v(ax, ya + 1.0, az, 0, 1, 0, 0, 1);
          if (sgn > 0) bridge.quad(t0, t1, t2, t3); else bridge.quad(t0, t3, t2, t1);
          // collider barrier
          const c0 = colBr.v(ix, ya - 0.2, iz, 0, 0, 0, 0, 0), c1 = colBr.v(jx, yc - 0.2, jz, 0, 0, 0, 0, 0);
          const c2 = colBr.v(jx, yc + 1.2, jz, 0, 0, 0, 0, 0), c3 = colBr.v(ix, ya + 1.2, iz, 0, 0, 0, 0, 0);
          colBr.quad(c0, c1, c2, c3); colBr.quad(c0, c3, c2, c1);
        }
        // underside
        const la = [-a.tz, a.tx], lc = [-c.tz, c.tx];
        const u0 = bridge.v(a.x + la[0] * (hw + 0.4), ya - deep, a.z + la[1] * (hw + 0.4), 0, -1, 0, 0, 0);
        const u1 = bridge.v(c.x + lc[0] * (hw + 0.4), yc - deep, c.z + lc[1] * (hw + 0.4), 0, -1, 0, 1, 0);
        const u2 = bridge.v(c.x - lc[0] * (hw + 0.4), yc - deep, c.z - lc[1] * (hw + 0.4), 0, -1, 0, 1, 1);
        const u3 = bridge.v(a.x - la[0] * (hw + 0.4), ya - deep, a.z - la[1] * (hw + 0.4), 0, -1, 0, 0, 1);
        bridge.quad(u0, u3, u2, u1);
        // deck collider (drivable surface)
        const d0 = colBr.v(a.x + la[0] * hw, ya + 0.02, a.z + la[1] * hw, 0, 0, 0, 0, 0);
        const d1 = colBr.v(c.x + lc[0] * hw, yc + 0.02, c.z + lc[1] * hw, 0, 0, 0, 0, 0);
        const d2 = colBr.v(c.x - lc[0] * hw, yc + 0.02, c.z - lc[1] * hw, 0, 0, 0, 0, 0);
        const d3 = colBr.v(a.x - la[0] * hw, ya + 0.02, a.z - la[1] * hw, 0, 0, 0, 0, 0);
        colBr.quad(d0, d1, d2, d3);
      }
      // piers / columns
      for (let s = 20; s < e.len; s += 38) {
        const o = { x: 0, z: 0, tx: 0, tz: 0, y: 0 };
        graph.sample(e, s, o);
        if (!inTile(o.x, o.z, t.i, t.j)) continue;
        const ground = world.heightAt(o.x, o.z);
        const clear = o.y - deep - ground;
        if (clear < 3) continue;
        if (ground < -1 && o.y > 25) continue; // suspension spans carried by the landmark structures
        const rx = -o.tz, rz = o.tx;
        for (const f of hw > 6 ? [-0.55, 0.55] : [0]) {
          const cx = o.x + rx * hw * f, cz = o.z + rz * hw * f;
          boxV(bridge, cx, ground - 2, cz, 1.1, o.y - deep - ground + 2, 1.1, o.tx, o.tz);
        }
        // cap beam
        boxV(bridge, o.x, o.y - deep - 1.0, o.z, hw + 0.6, 1.0, 1.0, o.tx, o.tz);
      }
    }
  }
  return { roads: roads.out(), sidewalks: side.out(), bridges: bridge.out(), colBridges: colBr.out(false) };
}

/** axis-aligned (rotated by tangent) box, centre-bottom at (x,y,z) with half extents hx/hz and height h */
function boxV(b: Builder, x: number, y: number, z: number, hx: number, h: number, hz: number, tx: number, tz: number): void {
  const rx = -tz, rz = tx; // local X axis = right, local Z = tangent
  const corners = (dx: number, dz: number) => [x + rx * dx + tx * dz, z + rz * dx + tz * dz];
  const cs = [corners(-hx, -hz), corners(hx, -hz), corners(hx, hz), corners(-hx, hz)];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = cs[k], [bx, bz] = cs[(k + 1) % 4];
    let nx = bz - az, nz = -(bx - ax); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const a = b.v(ax, y, az, nx, 0, nz, 0, 0), bb = b.v(bx, y, bz, nx, 0, nz, 1, 0);
    const c = b.v(bx, y + h, bz, nx, 0, nz, 1, 1), d = b.v(ax, y + h, az, nx, 0, nz, 0, 1);
    b.quad(a, d, c, bb);
    b.quad(a, bb, c, d);
  }
  const t = cs.map(([cx, cz]) => b.v(cx, y + h, cz, 0, 1, 0, 0, 0));
  b.quad(t[0], t[3], t[2], t[1]); b.quad(t[0], t[1], t[2], t[3]);
}

// ------------------------------------------------------------------ buildings
const STYLE_FLOOR = [3.9, 3.8, 3.7, 3.4, 3.0, 4.0, 6.0, 3.5, 3.4];
const STYLE_BAY = [1.6, 2.1, 2.4, 1.55, 2.6, 2.8, 5.0, 2.3, 1.55];

function hash1(n: number): number { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }

function buildBuildings(t: TileData, lod: number) {
  const b = new Builder({ binfo: 4, color: 3 });
  const col = new Builder();
  const T = world.tileSize, ox = t.i * T, oz = t.j * T;
  const names: TileResult['names'] = [];
  const pushWall = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, u0: number, base: number, info: number[], c: number[], inward = false) => {
    let nx = z1 - z0, nz = -(x1 - x0); const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
    if (inward) { nx = -nx; nz = -nz; }
    const a = b.v(x0, y0, z0, nx, 0, nz, u0, y0 - base, { binfo: info, color: c });
    const bb = b.v(x1, y0, z1, nx, 0, nz, u0 + L, y0 - base, { binfo: info, color: c });
    const cc = b.v(x1, y1, z1, nx, 0, nz, u0 + L, y1 - base, { binfo: info, color: c });
    const d = b.v(x0, y1, z0, nx, 0, nz, u0, y1 - base, { binfo: info, color: c });
    if (inward) b.quad(a, bb, cc, d); else b.quad(a, d, cc, bb);
  };
  for (const bd of t.b) {
    if (lod >= 2 && bd.h < 6 && !bd.n) continue;
    if (lod >= 3 && bd.h < 20) continue;
    const rings = bd.r.map((r) => { const o: number[][] = []; for (let k = 0; k < r.length; k += 2) o.push([ox + r[k] / 10, oz + r[k + 1] / 10]); return o; });
    if (lod >= 1) rings.length = 1;
    // ensure CCW (as seen from above with x east, z south) for outer ring → outward normals
    const area = (r: number[][]) => { let a = 0; for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
    if (area(rings[0]) < 0) rings[0].reverse();
    for (let k = 1; k < rings.length; k++) if (area(rings[k]) > 0) rings[k].reverse();
    const st = bd.s;
    const seed = hash1(bd.id);
    const cHex = bd.c >= 0 ? bd.c : 0xcccccc;
    const c = [((cHex >> 16) & 255) / 255, ((cHex >> 8) & 255) / 255, (cHex & 255) / 255];
    const info = [st, seed, STYLE_FLOOR[st] ?? 3.5, 0];
    const roofInfo = [st, seed, STYLE_FLOOR[st] ?? 3.5, 1];
    const base = bd.b;
    const y0 = bd.mh > 0 ? base + bd.mh : base - 1.2;
    const top = base + bd.h;
    const flat = !(st === 8 || bd.rf === 1 || bd.rf === 2);
    const parapet = lod === 0 && flat && bd.h > 7 ? 0.9 : 0;
    const roofY = top - parapet;
    const bw = STYLE_BAY[st] ?? 2;
    const v0 = rings[0].length;
    for (let ri = 0; ri < rings.length; ri++) {
      const r = rings[ri];
      for (let k = 0; k < r.length; k++) {
        const p = r[k], q = r[(k + 1) % r.length];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const u0 = k * bw * 7 + ri * 31 - (L % bw) / 2;
        pushWall(p[0], p[1], q[0], q[1], y0, top, u0, base, info, c);
        if (parapet && ri === 0) pushWall(p[0], p[1], q[0], q[1], roofY, top, u0, base, [st, seed, 99, 2], c, true);
      }
    }
    // roof (earcut via ShapeUtils)
    const contour = rings[0].map((p) => new Vector2(p[0], p[1]));
    const holes = rings.slice(1).map((r) => r.map((p) => new Vector2(p[0], p[1])));
    let tris: number[][] = [];
    try { tris = ShapeUtils.triangulateShape(contour, holes); } catch { tris = []; }
    const all = rings.flat();
    if (flat) {
      const startI = b.count;
      for (const p of all) b.v(p[0], roofY, p[1], 0, 1, 0, p[0], p[1], { binfo: roofInfo, color: c });
      for (const tr of tris) b.triUp(startI + tr[0], startI + tr[1], startI + tr[2]);
      // parapet top cap (thin) is implicit; rooftop equipment for larger flat roofs
      if (lod === 0 && bd.h > 12) {
        const xs = rings[0].map((p) => p[0]), zs = rings[0].map((p) => p[1]);
        const minx = Math.min(...xs), maxx = Math.max(...xs), minz = Math.min(...zs), maxz = Math.max(...zs);
        const areaAbs = Math.abs(area(rings[0]));
        const nBox = Math.min(5, Math.floor(areaAbs / 220));
        for (let n = 0; n < nBox; n++) {
          const hx = 1 + hash1(bd.id + n * 7) * 3, hz = 1 + hash1(bd.id + n * 13) * 2.5, hh = 1.2 + hash1(bd.id + n * 3) * 2.2;
          const cx = minx + hx + (maxx - minx - 2 * hx) * hash1(bd.id * 1.3 + n), cz = minz + hz + (maxz - minz - 2 * hz) * hash1(bd.id * 2.1 + n);
          if (!pointInRing(cx, cz, rings[0]) || !pointInRing(cx - hx, cz - hz, rings[0]) || !pointInRing(cx + hx, cz + hz, rings[0])) continue;
          const bc = [0.62 + hash1(n) * 0.15, 0.62 + hash1(n) * 0.15, 0.6 + hash1(n) * 0.15];
          const s0 = b.count;
          boxV(b as Builder, cx, roofY, cz, hx, hh, hz, 0, 1);
          // assign roof binfo/color for the box vertices
          const ex = b.extra;
          for (let q = s0; q < b.count; q++) { ex.binfo.data.splice(q * 4, 4, st, seed, 99, 1); ex.color.data.splice(q * 3, 3, bc[0], bc[1], bc[2]); }
        }
      }
    } else {
      // gabled roof along the long axis of the oriented bounding box
      const r = rings[0];
      let best = 0, ang = 0;
      for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length]; const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L > best) { best = L; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); } }
      const ax = Math.cos(ang), az = Math.sin(ang), px = -az, pz = ax;
      let minA = Infinity, maxA = -Infinity, minP = Infinity, maxP = -Infinity;
      for (const p of r) { const a = p[0] * ax + p[1] * az, pp = p[0] * px + p[1] * pz; minA = Math.min(minA, a); maxA = Math.max(maxA, a); minP = Math.min(minP, pp); maxP = Math.max(maxP, pp); }
      const halfW = (maxP - minP) / 2, midP = (minP + maxP) / 2;
      const ridgeH = Math.min(halfW * 0.8, 4.5);
      const startI = b.count;
      for (const p of all) {
        const pp = p[0] * px + p[1] * pz;
        const y = top + ridgeH * (1 - Math.min(1, Math.abs(pp - midP) / halfW));
        b.v(p[0], y, p[1], 0, 1, 0, p[0], p[1], { binfo: roofInfo, color: c });
      }
      for (const tr of tris) b.triUp(startI + tr[0], startI + tr[1], startI + tr[2]);
      // ridge planes over the footprint bounding rectangle
      const P = (a: number, pp: number, y: number) => [ax * a + px * pp, y, az * a + pz * pp];
      const rc = [0.42, 0.36, 0.33];
      const rr = [st, seed, 99, 1];
      for (const sgn of [-1, 1]) {
        const e0 = P(minA, midP + sgn * halfW, top), e1 = P(maxA, midP + sgn * halfW, top);
        const r0 = P(minA, midP, top + ridgeH), r1 = P(maxA, midP, top + ridgeH);
        const ny = halfW, nh = ridgeH; const l = Math.hypot(ny, nh);
        const nx = px * sgn * nh / l, nz = pz * sgn * nh / l;
        const i0 = b.v(e0[0], e0[1] + 0.05, e0[2], nx, ny / l, nz, 0, 0, { binfo: rr, color: rc });
        const i1 = b.v(e1[0], e1[1] + 0.05, e1[2], nx, ny / l, nz, 1, 0, { binfo: rr, color: rc });
        const i2 = b.v(r1[0], r1[1] + 0.05, r1[2], nx, ny / l, nz, 1, 1, { binfo: rr, color: rc });
        const i3 = b.v(r0[0], r0[1] + 0.05, r0[2], nx, ny / l, nz, 0, 1, { binfo: rr, color: rc });
        b.quad(i0, i1, i2, i3); b.quad(i0, i3, i2, i1);
      }
      // gable end triangles (facade colour)
      for (const a of [minA, maxA]) {
        const g0 = P(a, midP - halfW, top), g1 = P(a, midP + halfW, top), g2 = P(a, midP, top + ridgeH);
        const i0 = b.v(g0[0], g0[1], g0[2], ax, 0, az, 0, bd.h, { binfo: [st, seed, 99, 2], color: c });
        const i1 = b.v(g1[0], g1[1], g1[2], ax, 0, az, 1, bd.h, { binfo: [st, seed, 99, 2], color: c });
        const i2 = b.v(g2[0], g2[1], g2[2], ax, 0, az, 0.5, bd.h + ridgeH, { binfo: [st, seed, 99, 2], color: c });
        b.tri(i0, i1, i2); b.tri(i0, i2, i1);
      }
    }
    void v0;
    // collider (detail LOD only): wall prism + roof
    if (lod === 0) {
      const r = rings[0];
      const s0 = col.count;
      for (const p of r) { col.v(p[0], y0, p[1], 0, 0, 0, 0, 0); col.v(p[0], top, p[1], 0, 0, 0, 0, 0); }
      for (let k = 0; k < r.length; k++) {
        const a = s0 + 2 * k, bb = s0 + 2 * ((k + 1) % r.length);
        col.quad(a, bb, bb + 1, a + 1);
      }
      const rs = col.count;
      for (const p of r) col.v(p[0], top, p[1], 0, 0, 0, 0, 0);
      try { for (const tr of ShapeUtils.triangulateShape(contour, [])) col.tri(rs + tr[0], rs + tr[2], rs + tr[1]); } catch { /* skip */ }
    }
    if (bd.n && bd.h > 40) {
      const xs = rings[0].map((p) => p[0]), zs = rings[0].map((p) => p[1]);
      names.push({ n: bd.n, x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2, y: top, h: bd.h });
    }
  }
  return { buildings: b.out(), colBuildings: col.out(false), names };
}

function pointInRing(x: number, z: number, r: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], zi = r[i][1], xj = r[j][0], zj = r[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function buildPiers(t: TileData, lod: number) {
  const b = new Builder();
  const col = new Builder();
  for (const poly of t.pr) {
    const r: number[][] = [];
    for (let k = 0; k < poly.length; k += 2) r.push([poly[k], poly[k + 1]]);
    if (r.length < 3) continue;
    let a = 0; for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
    if (a < 0) r.reverse();
    const top = 2.4, bot = -3;
    for (let k = 0; k < r.length; k++) {
      const p = r[k], q = r[(k + 1) % r.length];
      let nx = q[1] - p[1], nz = -(q[0] - p[0]); const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
      const i0 = b.v(p[0], bot, p[1], nx, 0, nz, 0, 0), i1 = b.v(q[0], bot, q[1], nx, 0, nz, L, 0);
      const i2 = b.v(q[0], top, q[1], nx, 0, nz, L, 1), i3 = b.v(p[0], top, p[1], nx, 0, nz, 0, 1);
      b.quad(i0, i3, i2, i1);
    }
    let tris: number[][] = [];
    try { tris = ShapeUtils.triangulateShape(r.map((p) => new Vector2(p[0], p[1])), []); } catch { /* */ }
    const s0 = b.count;
    for (const p of r) b.v(p[0], top, p[1], 0, 1, 0, p[0], p[1]);
    for (const tr of tris) b.triUp(s0 + tr[0], s0 + tr[1], s0 + tr[2]);
    if (lod === 0) {
      const c0 = col.count;
      for (const p of r) col.v(p[0], top, p[1], 0, 0, 0, 0, 0);
      for (const tr of tris) col.tri(c0 + tr[0], c0 + tr[2], c0 + tr[1]);
    }
  }
  return { piers: b.out(), colPiers: col.out(false) };
}

async function build(i: number, j: number, lod: number): Promise<TileResult> {
  await ready;
  const key = `${i}_${j}`;
  let t = tileCache.get(key);
  if (t === undefined) {
    t = await world.loadTile(i, j);
    tileCache.set(key, t);
    if (tileCache.size > 400) tileCache.delete(tileCache.keys().next().value!);
  }
  const res: TileResult = { i, j, lod, terrain: buildTerrain(i, j, lod), buildingCount: 0, names: [] };
  if (!t) return res;
  Object.assign(res, buildRoads(t, lod));
  const bb = buildBuildings(t, lod);
  res.buildings = bb.buildings; res.colBuildings = bb.colBuildings; res.names = bb.names; res.buildingCount = t.b.length;
  Object.assign(res, buildPiers(t, lod));
  if (lod <= 1) {
    const tr = new Float32Array(t.t.length * 5);
    t.t.forEach((v, k) => tr.set([v[0], world.heightAt(v[0], v[1]), v[1], v[2], v[3]], k * 5));
    res.trees = tr;
  }
  if (lod === 0) {
    const fu = new Float32Array(t.f.length * 5);
    t.f.forEach((v, k) => fu.set([v[0], world.heightAt(v[0], v[1]), v[1], v[2], v[3]], k * 5));
    res.furniture = fu;
  }
  return res;
}

function transfer(r: TileResult): Transferable[] {
  const out: Transferable[] = [];
  for (const k of ['terrain', 'roads', 'sidewalks', 'bridges', 'buildings', 'piers', 'colBuildings', 'colBridges', 'colPiers'] as const) {
    const g = r[k] as GeoBuf | undefined;
    if (!g) continue;
    out.push(g.index.buffer);
    for (const a of Object.values(g.attrs)) out.push(a[0].buffer);
  }
  if (r.trees) out.push(r.trees.buffer);
  if (r.furniture) out.push(r.furniture.buffer);
  return out;
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === 'init') {
    ready = (async () => {
      world.setBase(m.base);
      await world.load(() => {});
      graph = new RoadGraph(world.roads, world);
    })();
    await ready;
    (self as unknown as Worker).postMessage({ type: 'ready' });
  } else if (m.type === 'build') {
    try {
      const r = await build(m.i, m.j, m.lod);
      (self as unknown as Worker).postMessage({ type: 'tile', id: m.id, result: r }, transfer(r));
    } catch (e) {
      (self as unknown as Worker).postMessage({ type: 'error', id: m.id, error: String(e) });
    }
  }
};
export type { TileBuilding };
