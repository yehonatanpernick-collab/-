// Navigation: layered 1 m grid generated from the collision world + A* search.
// Nodes are standable cell centres; links are validated with the same floor /
// clearance rules the character controller uses, so every path is walkable.
import { PLAYER } from './config';
import type { Rng } from './math';
import { findFloor } from './movement';
import { F_SOLID, type World } from './world/World';

const R = PLAYER.RADIUS;
const STEP = PLAYER.STEP_HEIGHT;
const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const SQRT2 = Math.SQRT2;

export class NavGrid {
  readonly w: number;
  readonly h: number;
  count = 0;
  nodeX = new Float32Array(0);
  nodeY = new Float32Array(0);
  nodeZ = new Float32Array(0);
  /** 8 neighbour node indices per node (-1 = none). */
  edges = new Int32Array(0);
  private cellFirst: Int32Array;
  private nodeNext = new Int32Array(0);
  private g = new Float32Array(0);
  private parent = new Int32Array(0);
  private state = new Int32Array(0);
  private searchId = 0;
  private heap: number[] = [];
  private heapF: number[] = [];
  buildMs = 0;

  constructor(readonly world: World) {
    this.w = Math.ceil(world.maxX - world.minX);
    this.h = Math.ceil(world.maxZ - world.minZ);
    this.cellFirst = new Int32Array(this.w * this.h).fill(-1);
    this.build();
  }

  private build(): void {
    const t0 = Date.now();
    const world = this.world;
    const xs: number[] = [], ys: number[] = [], zs: number[] = [], next: number[] = [];
    const q: number[] = [];
    const cand: number[] = [];
    for (let iz = 0; iz < this.h; iz++) {
      for (let ix = 0; ix < this.w; ix++) {
        const cx = world.minX + ix + 0.5, cz = world.minZ + iz + 0.5;
        const n = world.query(cx - R, -60, cz - R, cx + R, 120, cz + R, F_SOLID, q);
        cand.length = 0;
        for (let k = 0; k < n; k++) {
          const i = q[k];
          cand.push(i >= 0 ? world.boxes[i].maxY : world.rampHeight(world.ramps[-1 - i], cx, cz));
        }
        cand.sort((a, b) => a - b);
        let last = -Infinity;
        let prev = -1;
        for (const y of cand) {
          if (y - last < 0.06) continue;
          if (world.overlaps(cx - R, y + 0.02, cz - R, cx + R, y + PLAYER.HEIGHT, cz + R, F_SOLID)) continue;
          last = y;
          const id = xs.length;
          xs.push(cx); ys.push(y); zs.push(cz); next.push(-1);
          if (prev < 0) this.cellFirst[iz * this.w + ix] = id; else next[prev] = id;
          prev = id;
        }
      }
    }
    const count = xs.length;
    this.nodeX = Float32Array.from(xs); this.nodeY = Float32Array.from(ys); this.nodeZ = Float32Array.from(zs);
    this.nodeNext = Int32Array.from(next);
    const edges = new Int32Array(count * 8).fill(-1);

    // cardinal links (+x and +z, mirrored)
    for (let a = 0; a < count; a++) {
      const ix = Math.floor(xs[a] - world.minX), iz = Math.floor(zs[a] - world.minZ);
      for (let d = 0; d < 4; d += 2) {
        const nx = ix + DIRS[d][0], nz = iz + DIRS[d][1];
        if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h) continue;
        for (let b = this.cellFirst[nz * this.w + nx]; b >= 0; b = next[b]) {
          if (Math.abs(ys[b] - ys[a]) > 1.05) continue;
          if (this.traversable(xs[a], ys[a], zs[a], xs[b], ys[b], zs[b])) {
            edges[a * 8 + d] = b;
            edges[b * 8 + d + 1] = a;
            break;
          }
        }
      }
    }
    // diagonals: both cardinal routes must exist
    for (let a = 0; a < count; a++) {
      for (let d = 4; d < 8; d++) {
        const dx = DIRS[d][0], dz = DIRS[d][1];
        const ex = edges[a * 8 + (dx > 0 ? 0 : 1)], ez = edges[a * 8 + (dz > 0 ? 2 : 3)];
        if (ex < 0 || ez < 0) continue;
        const t1 = edges[ex * 8 + (dz > 0 ? 2 : 3)], t2 = edges[ez * 8 + (dx > 0 ? 0 : 1)];
        if (t1 >= 0 && t1 === t2) edges[a * 8 + d] = t1;
      }
    }

    // keep only the largest connected component
    const comp = new Int32Array(count).fill(-1);
    let bestComp = -1, bestSize = 0, nComp = 0;
    const stack: number[] = [];
    for (let s = 0; s < count; s++) {
      if (comp[s] >= 0) continue;
      let size = 0;
      stack.push(s); comp[s] = nComp;
      while (stack.length) {
        const a = stack.pop() as number;
        size++;
        for (let d = 0; d < 4; d++) {
          const b = edges[a * 8 + d];
          if (b >= 0 && comp[b] < 0) { comp[b] = nComp; stack.push(b); }
        }
      }
      if (size > bestSize) { bestSize = size; bestComp = nComp; }
      nComp++;
    }
    for (let a = 0; a < count; a++) {
      if (comp[a] !== bestComp) for (let d = 0; d < 8; d++) edges[a * 8 + d] = -2; // -2 marks an unusable node
    }
    this.edges = edges;
    this.count = count;
    this.g = new Float32Array(count);
    this.parent = new Int32Array(count);
    this.state = new Int32Array(count);
    this.buildMs = Date.now() - t0;
  }

  /** Can a character walk in a straight line from a to b (both standing heights known)? */
  traversable(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const world = this.world;
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.ceil(dist / 0.25));
    let y = ay;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const fl = findFloor(world, null, px, y + STEP, pz, 2 * STEP + 0.1);
      if (fl === -Infinity) return false;
      if (world.overlaps(px - R, fl + 0.02, pz - R, px + R, fl + PLAYER.HEIGHT, pz + R, F_SOLID)) return false;
      y = fl;
    }
    return Math.abs(y - by) < 0.12;
  }

  usable(n: number): boolean { return n >= 0 && this.edges[n * 8] !== -2; }

  /** Closest usable node to a position (searches a small neighbourhood of cells). */
  nearest(x: number, y: number, z: number, radius = 3): number {
    const ix = Math.floor(x - this.world.minX), iz = Math.floor(z - this.world.minZ);
    let best = -1, bestD = Infinity;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = ix + dx, cz = iz + dz;
        if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) continue;
        for (let n = this.cellFirst[cz * this.w + cx]; n >= 0; n = this.nodeNext[n]) {
          if (this.edges[n * 8] === -2) continue;
          const d = Math.hypot(this.nodeX[n] - x, this.nodeZ[n] - z) + Math.abs(this.nodeY[n] - y) * 2.5;
          if (d < bestD) { bestD = d; best = n; }
        }
      }
    }
    return best;
  }

  /** Random usable node within a horizontal radius, close to height y. */
  randomNear(x: number, y: number, z: number, radius: number, rng: Rng, maxDy = 2.5): number {
    for (let tries = 0; tries < 12; tries++) {
      const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * radius;
      const n = this.nearest(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 1);
      if (n >= 0 && Math.abs(this.nodeY[n] - y) <= maxDy) return n;
    }
    return this.nearest(x, y, z, 4);
  }

  /** A* search. Fills `out` with node indices from start to goal (inclusive). */
  findPath(start: number, goal: number, out: number[], maxExpand = 40000): boolean {
    out.length = 0;
    if (!this.usable(start) || !this.usable(goal)) return false;
    if (start === goal) { out.push(start); return true; }
    const id = ++this.searchId;
    const { nodeX, nodeY, nodeZ, edges, g, parent, state } = this;
    const heap = this.heap, heapF = this.heapF;
    heap.length = 0; heapF.length = 0;
    const gx = nodeX[goal], gy = nodeY[goal], gz = nodeZ[goal];
    const hCost = (n: number): number => {
      const dx = Math.abs(nodeX[n] - gx), dz = Math.abs(nodeZ[n] - gz);
      return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz)) + Math.abs(nodeY[n] - gy) * 1.2;
    };
    const push = (n: number, f: number): void => {
      let i = heap.length;
      heap.push(n); heapF.push(f);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= f) break;
        heap[i] = heap[p]; heapF[i] = heapF[p];
        i = p;
      }
      heap[i] = n; heapF[i] = f;
    };
    const pop = (): number => {
      const top = heap[0];
      const n = heap.pop() as number, f = heapF.pop() as number;
      const len = heap.length;
      if (len > 0) {
        let i = 0;
        for (;;) {
          let c = i * 2 + 1;
          if (c >= len) break;
          if (c + 1 < len && heapF[c + 1] < heapF[c]) c++;
          if (heapF[c] >= f) break;
          heap[i] = heap[c]; heapF[i] = heapF[c];
          i = c;
        }
        heap[i] = n; heapF[i] = f;
      }
      return top;
    };
    g[start] = 0; parent[start] = -1; state[start] = id * 2;
    push(start, hCost(start));
    let expanded = 0;
    while (heap.length > 0) {
      const a = pop();
      if (state[a] === id * 2 + 1) continue;
      state[a] = id * 2 + 1;
      if (a === goal) {
        for (let n = goal; n >= 0; n = parent[n]) out.push(n);
        out.reverse();
        return true;
      }
      if (++expanded > maxExpand) return false;
      const ga = g[a];
      for (let d = 0; d < 8; d++) {
        const b = edges[a * 8 + d];
        if (b < 0 || state[b] === id * 2 + 1) continue;
        const cost = ga + (d < 4 ? 1 : SQRT2) + Math.abs(nodeY[b] - nodeY[a]) * 1.5;
        if (state[b] !== id * 2 || cost < g[b]) {
          g[b] = cost; parent[b] = a; state[b] = id * 2;
          push(b, cost + hCost(b));
        }
      }
    }
    return false;
  }
}
