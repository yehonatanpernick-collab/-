import type { RoadsData } from '../data/WorldData';
import type { WorldData } from '../data/WorldData';

/**
 * Directed lane graph built from the real OpenStreetMap/Overture road network.
 * Each undirected edge yields one or two directed "links" according to its one-way restriction.
 */
export interface Edge {
  id: number; a: number; b: number; cls: number; w: number; lanes: number; oneway: number;
  bridge: boolean; tunnel: boolean; speed: number; name: string;
  pts: Float32Array;  // x,z pairs
  el: Float32Array | null; // bridge deck elevations per point
  cum: Float32Array;  // cumulative length per point
  len: number;
  minx: number; minz: number; maxx: number; maxz: number;
}
export interface Link { edge: number; dir: 1 | -1; from: number; to: number; }

export class RoadGraph {
  nodes: Float32Array;
  edges: Edge[] = [];
  nodeEdges: number[][] = [];
  degree: Int32Array;
  junctionRadius: Float32Array;
  signal: Uint8Array;
  outLinks: Link[][] = [];
  private grid = new Map<number, number[]>();
  private cell = 250;

  constructor(data: RoadsData, private world: WorldData) {
    this.nodes = new Float32Array(data.nodes);
    const nn = this.nodes.length / 2;
    this.degree = new Int32Array(nn);
    this.junctionRadius = new Float32Array(nn);
    this.signal = new Uint8Array(nn);
    for (const s of data.sig) this.signal[s] = 1;
    for (let i = 0; i < nn; i++) { this.nodeEdges.push([]); this.outLinks.push([]); }
    data.e.forEach((r, id) => {
      const pts = new Float32Array(r[9]);
      const n = pts.length / 2;
      const cum = new Float32Array(n);
      let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
      for (let k = 0; k < n; k++) {
        if (k > 0) cum[k] = cum[k - 1] + Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]);
        minx = Math.min(minx, pts[2 * k]); maxx = Math.max(maxx, pts[2 * k]);
        minz = Math.min(minz, pts[2 * k + 1]); maxz = Math.max(maxz, pts[2 * k + 1]);
      }
      const e: Edge = {
        id, a: r[0], b: r[1], cls: r[2], w: r[3], lanes: r[4], oneway: r[5], bridge: !!r[6], tunnel: !!r[7], speed: r[8],
        name: r[11], pts, el: r[10] ? new Float32Array(r[10]) : null, cum, len: cum[n - 1], minx, minz, maxx, maxz,
      };
      this.edges.push(e);
      if (e.tunnel) return;
      this.nodeEdges[e.a].push(id); this.nodeEdges[e.b].push(id);
      this.degree[e.a]++; this.degree[e.b]++;
      if (e.oneway >= 0) this.outLinks[e.a].push({ edge: id, dir: 1, from: e.a, to: e.b });
      if (e.oneway <= 0) this.outLinks[e.b].push({ edge: id, dir: -1, from: e.b, to: e.a });
      // spatial hash
      for (let gx = Math.floor(minx / this.cell); gx <= Math.floor(maxx / this.cell); gx++)
        for (let gz = Math.floor(minz / this.cell); gz <= Math.floor(maxz / this.cell); gz++) {
          const key = gx * 100000 + gz;
          let l = this.grid.get(key); if (!l) this.grid.set(key, (l = [])); l.push(id);
        }
    });
    for (let i = 0; i < nn; i++) {
      if (this.degree[i] >= 3) {
        let r = 0;
        for (const e of this.nodeEdges[i]) r = Math.max(r, this.edges[e].w / 2);
        this.junctionRadius[i] = r + 0.6;
      }
    }
  }

  nodeX(n: number): number { return this.nodes[2 * n]; }
  nodeZ(n: number): number { return this.nodes[2 * n + 1]; }

  edgesNear(x: number, z: number, r: number): number[] {
    const out = new Set<number>();
    for (let gx = Math.floor((x - r) / this.cell); gx <= Math.floor((x + r) / this.cell); gx++)
      for (let gz = Math.floor((z - r) / this.cell); gz <= Math.floor((z + r) / this.cell); gz++)
        this.grid.get(gx * 100000 + gz)?.forEach((e) => out.add(e));
    return [...out];
  }

  /** Point along an edge at distance s (from node a). Writes x,z, tangent and elevation. */
  sample(e: Edge, s: number, out: { x: number; z: number; tx: number; tz: number; y: number }): void {
    const cum = e.cum, pts = e.pts;
    s = Math.max(0, Math.min(e.len, s));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const seg = Math.max(cum[hi] - cum[lo], 1e-6);
    const t = (s - cum[lo]) / seg;
    const x0 = pts[2 * lo], z0 = pts[2 * lo + 1], x1 = pts[2 * hi], z1 = pts[2 * hi + 1];
    out.x = x0 + (x1 - x0) * t; out.z = z0 + (z1 - z0) * t;
    out.tx = (x1 - x0) / seg; out.tz = (z1 - z0) / seg;
    out.y = e.el ? e.el[lo] + (e.el[hi] - e.el[lo]) * t : this.world.heightAt(out.x, out.z);
  }

  /** Nearest drivable edge position to (x,z): returns edge id and distance along. */
  nearest(x: number, z: number, maxR = 120, filter?: (e: Edge) => boolean): { edge: number; s: number; d: number } | null {
    let best: { edge: number; s: number; d: number } | null = null;
    for (const id of this.edgesNear(x, z, maxR)) {
      const e = this.edges[id];
      if (e.tunnel || (filter && !filter(e))) continue;
      const p = e.pts;
      for (let k = 0; k < p.length / 2 - 1; k++) {
        const ax = p[2 * k], az = p[2 * k + 1], bx = p[2 * k + 2], bz = p[2 * k + 3];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-6;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const qx = ax + dx * t, qz = az + dz * t;
        const d = Math.hypot(x - qx, z - qz);
        if (!best || d < best.d) best = { edge: id, s: e.cum[k] + Math.sqrt(l2) * t, d };
      }
    }
    return best && best.d <= maxR ? best : null;
  }
}
