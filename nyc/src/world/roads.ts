const BASE = import.meta.env.BASE_URL;
export interface Edge { a: number; b: number; pts: [number, number][]; lanes: number; park: number; w: number; dir: 'FT' | 'TF' | 'TW'; name: string; speed: number; kind: number; len: number; cum: number[] }

/** neighborhood anchors (lat, lon) → nearest wins */
const HOODS: [string, number, number][] = [
  ['Times Square', 40.758, -73.9855], ['Theater District', 40.7598, -73.9873], ["Hell's Kitchen", 40.7638, -73.9918], ['Hudson Yards', 40.7536, -74.0003],
  ['Garment District', 40.7531, -73.9904], ['Koreatown', 40.7477, -73.9869], ['Murray Hill', 40.7479, -73.9757], ['Midtown East', 40.7549, -73.9701],
  ['Turtle Bay', 40.7527, -73.9672], ['Sutton Place', 40.7576, -73.9617], ['Rockefeller Center', 40.7587, -73.9787], ['Fifth Avenue', 40.7625, -73.9742],
  ['Bryant Park', 40.7536, -73.9832], ['Grand Central', 40.7527, -73.9772], ['Columbus Circle', 40.7681, -73.9819], ['Lincoln Square', 40.7736, -73.9837],
  ['Upper West Side', 40.7810, -73.9790], ['Central Park', 40.7745, -73.9690], ['Upper East Side', 40.7700, -73.9600], ['Lenox Hill', 40.7662, -73.9602],
  ['Clinton', 40.7660, -73.9930], ['Chelsea', 40.7465, -74.0014], ['Herald Square', 40.7497, -73.9877], ['Midtown', 40.7550, -73.9840],
];

export class Roads {
  nodes: [number, number][] = [];
  edges: Edge[] = [];
  nodeEdges: number[][] = [];
  private grid = new Map<string, number[]>();
  private hoods: [string, number, number][] = [];
  readonly G = 60;

  async init(origin: [number, number], m: [number, number]) {
    const d = await (await fetch(`${BASE}data/roads.json`)).json();
    this.nodes = d.nodes; this.edges = d.edges;
    this.nodeEdges = this.nodes.map(() => []);
    this.edges.forEach((e, i) => {
      let L = 0; e.cum = [0];
      for (let k = 1; k < e.pts.length; k++) { L += Math.hypot(e.pts[k][0] - e.pts[k - 1][0], e.pts[k][1] - e.pts[k - 1][1]); e.cum.push(L); }
      e.len = L; this.nodeEdges[e.a].push(i); this.nodeEdges[e.b].push(i);
      for (let k = 0; k < e.pts.length; k++) {
        const steps = k ? Math.ceil(Math.hypot(e.pts[k][0] - e.pts[k - 1][0], e.pts[k][1] - e.pts[k - 1][1]) / 20) : 1;
        for (let s = 0; s < steps; s++) {
          const t = steps === 1 ? 1 : s / steps; const x = k ? e.pts[k - 1][0] + (e.pts[k][0] - e.pts[k - 1][0]) * t : e.pts[0][0], z = k ? e.pts[k - 1][1] + (e.pts[k][1] - e.pts[k - 1][1]) * t : e.pts[0][1];
          const key = `${Math.floor(x / this.G)}_${Math.floor(z / this.G)}`; let a = this.grid.get(key); if (!a) this.grid.set(key, (a = [])); if (a[a.length - 1] !== i) a.push(i);
        }
      }
    });
    this.hoods = HOODS.map(([n, lat, lon]) => [n, (lon - origin[0]) * m[0], -(lat - origin[1]) * m[1]]);
  }

  /** point on edge at arc length s → [x, z, dirX, dirZ] */
  at(e: Edge, s: number): [number, number, number, number] {
    s = Math.max(0, Math.min(e.len, s));
    let k = 1; while (k < e.pts.length - 1 && e.cum[k] < s) k++;
    const a = e.pts[k - 1], b = e.pts[k]; const seg = e.cum[k] - e.cum[k - 1] || 1; const t = (s - e.cum[k - 1]) / seg;
    const dx = (b[0] - a[0]) / seg, dz = (b[1] - a[1]) / seg;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, dx, dz];
  }

  /** nearest edge to x,z: {edge, s, dist, dirX, dirZ} */
  nearest(x: number, z: number, maxD = 60) {
    let best: { e: number; s: number; d: number } | null = null;
    const gx = Math.floor(x / this.G), gz = Math.floor(z / this.G);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) for (const ei of this.grid.get(`${i}_${j}`) || []) {
      const e = this.edges[ei];
      for (let k = 1; k < e.pts.length; k++) {
        const a = e.pts[k - 1], b = e.pts[k]; const dx = b[0] - a[0], dz = b[1] - a[1]; const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
        const d = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
        if (d < maxD && (!best || d < best.d)) best = { e: ei, s: e.cum[k - 1] + Math.sqrt(L2) * t, d };
      }
    }
    return best;
  }

  /** "W 44th St", cross street ahead, neighborhood */
  describe(x: number, z: number, hx: number, hz: number) {
    const n = this.nearest(x, z, 80);
    let street = '', cross = '';
    if (n) {
      const e = this.edges[n.e]; street = e.name;
      const [, , dx, dz] = this.at(e, n.s); const ahead = dx * hx + dz * hz >= 0;
      const node = ahead ? e.b : e.a;
      const names = new Set(this.nodeEdges[node].map((i) => this.edges[i].name).filter((nm) => nm && nm !== street));
      cross = [...names][0] || '';
      if (!cross) { const other = ahead ? e.a : e.b; cross = [...new Set(this.nodeEdges[other].map((i) => this.edges[i].name).filter((nm) => nm && nm !== street))][0] || ''; }
    }
    let hood = 'Manhattan', hd = 1e9; for (const [nm, hx2, hz2] of this.hoods) { const d = Math.hypot(hx2 - x, hz2 - z); if (d < hd) { hd = d; hood = nm; } }
    return { street, cross, hood };
  }
}
