import type { RoadGraph } from '../ai/RoadGraph';

/** A* routing over the real directed street graph (respects one-way restrictions). */
export class Navigation {
  route: number[] = []; // flat x,z polyline
  target: { x: number; z: number } | null = null;
  constructor(private g: RoadGraph) {}

  plan(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    const a = this.g.nearest(fromX, fromZ, 300, (e) => e.cls <= 6);
    const b = this.g.nearest(toX, toZ, 600, (e) => e.cls <= 6);
    this.target = { x: toX, z: toZ };
    if (!a || !b) { this.route = [fromX, fromZ, toX, toZ]; return false; }
    const ea = this.g.edges[a.edge], eb = this.g.edges[b.edge];
    const starts = [ea.a, ea.b], goals = new Set([eb.a, eb.b]);
    const n = this.g.nodes.length / 2;
    const gScore = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const cameEdge = new Int32Array(n).fill(-1);
    const gx = this.g.nodeX(eb.a), gz = this.g.nodeZ(eb.a);
    const h = (k: number) => Math.hypot(this.g.nodeX(k) - gx, this.g.nodeZ(k) - gz);
    // binary heap
    const heap: [number, number][] = [];
    const push = (f: number, k: number) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (const s of starts) { gScore[s] = 0; push(h(s), s); }
    let found = -1, iters = 0;
    while (heap.length && iters++ < 200000) {
      const [, k] = pop();
      if (goals.has(k)) { found = k; break; }
      for (const l of this.g.outLinks[k]) {
        const e = this.g.edges[l.edge];
        if (e.cls > 6) continue;
        const cost = e.len / Math.max(e.speed, 5) * (e.cls <= 2 ? 0.85 : 1);
        const ng = gScore[k] + cost;
        if (ng < gScore[l.to]) { gScore[l.to] = ng; came[l.to] = k; cameEdge[l.to] = l.edge; push(ng + h(l.to) / 25, l.to); }
      }
    }
    if (found < 0) { this.route = [fromX, fromZ, toX, toZ]; return false; }
    const nodesPath: number[] = [];
    for (let k = found; k >= 0; k = came[k]) nodesPath.push(k);
    nodesPath.reverse();
    const out: number[] = [fromX, fromZ];
    for (let i = 1; i < nodesPath.length; i++) {
      const e = this.g.edges[cameEdge[nodesPath[i]]];
      const fwd = e.a === nodesPath[i - 1];
      const p = e.pts;
      if (fwd) for (let k = 0; k < p.length; k += 2) out.push(p[k], p[k + 1]);
      else for (let k = p.length - 2; k >= 0; k -= 2) out.push(p[k], p[k + 1]);
    }
    out.push(toX, toZ);
    this.route = out;
    return true;
  }

  clear(): void { this.route = []; this.target = null; }

  /** trims the route behind the player; returns remaining distance */
  progress(x: number, z: number): number {
    const r = this.route;
    if (r.length < 4) return 0;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < Math.min(r.length, 80); i += 2) { const d = Math.hypot(r[i] - x, r[i + 1] - z); if (d < bd) { bd = d; bi = i; } }
    if (bi > 0) this.route = [x, z, ...r.slice(bi + 2)];
    let L = 0;
    for (let i = 0; i < this.route.length - 2; i += 2) L += Math.hypot(this.route[i + 2] - this.route[i], this.route[i + 3] - this.route[i + 1]);
    if (this.target && Math.hypot(this.target.x - x, this.target.z - z) < 25) this.clear();
    return L;
  }
}
