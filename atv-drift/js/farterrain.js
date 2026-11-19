// Far terrain: the analytic height field outside the main 3 km grid, drawn as a quadtree of LOD tiles
// (4 m cells near the player, up to 1 km cells at the horizon), built on demand from rawHeight().
import * as THREE from 'three';
import { rawHeight, HALF } from './terrain.js';

const S0 = 256, LEVELS = 8;
const RES = [64, 64, 32, 32, 32, 32, 32, 32];

export class FarTerrain {
  constructor(scene, baseMat, colorAt) {
    this.scene = scene; this.colorAt = colorAt;
    this.group = new THREE.Group(); scene.add(this.group);
    this.tiles = new Map();
    this.mats = [];
    for (let l = 0; l < LEVELS; l++) {
      const m = baseMat.clone();
      m.onBeforeCompile = baseMat.onBeforeCompile;
      m.customProgramCacheKey = baseMat.customProgramCacheKey;
      m.polygonOffset = true; m.polygonOffsetFactor = 1 + l; m.polygonOffsetUnits = 2 * (l + 1);
      this.mats.push(m);
    }
    this.frame = 0;
    this.c3 = [0, 0, 0];
    this.built = 0;
  }
  key(l, i, j) { return l * 1e10 + (i + 5000) * 1e5 + (j + 5000); }
  inside(x0, x1, z0, z1) { return x0 >= -HALF && x1 <= HALF && z0 >= -HALF && z1 <= HALF; }

  build(l, i, j) {
    const n = RES[l], S = S0 << l, cell = S / n, ox = i * S, oz = j * S;
    const W = n + 3, H = new Float32Array(W * W);
    for (let jj = 0; jj < W; jj++) {
      const z = oz + (jj - 1) * cell;
      for (let ii = 0; ii < W; ii++) H[jj * W + ii] = rawHeight(ox + (ii - 1) * cell, z);
    }
    const V = n + 1, nv = V * V, skirtN = 4 * V;
    const pos = new Float32Array((nv + skirtN) * 3), nor = new Float32Array((nv + skirtN) * 3);
    const col = new Float32Array((nv + skirtN) * 3), uv = new Float32Array((nv + skirtN) * 2);
    const c3 = this.c3, drop = cell * 1.6 + 4;
    for (let jj = 0; jj < V; jj++) for (let ii = 0; ii < V; ii++) {
      const k = jj * V + ii, hi = (jj + 1) * W + (ii + 1);
      const x = ox + ii * cell, z = oz + jj * cell, h = H[hi];
      const dx = (H[hi + 1] - H[hi - 1]) / (2 * cell), dz = (H[hi + W] - H[hi - W]) / (2 * cell);
      const il = 1 / Math.hypot(dx, 1, dz);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      nor[k * 3] = -dx * il; nor[k * 3 + 1] = il; nor[k * 3 + 2] = -dz * il;
      uv[k * 2] = x / 7; uv[k * 2 + 1] = z / 7;
      this.colorAt(x, z, h, nor[k * 3 + 1], c3);
      col[k * 3] = c3[0]; col[k * 3 + 1] = c3[1]; col[k * 3 + 2] = c3[2];
    }
    // skirts: drop copies of the edge vertices so neighbouring LODs never show cracks
    const edge = [];
    for (let a = 0; a < V; a++) edge.push(a);                              // z = 0 row
    for (let a = 0; a < V; a++) edge.push((V - 1) * V + a);                // z = max row
    for (let a = 0; a < V; a++) edge.push(a * V);                          // x = 0 column
    for (let a = 0; a < V; a++) edge.push(a * V + (V - 1));                // x = max column
    edge.forEach((src, q) => {
      const d = nv + q;
      pos[d * 3] = pos[src * 3]; pos[d * 3 + 1] = pos[src * 3 + 1] - drop; pos[d * 3 + 2] = pos[src * 3 + 2];
      nor[d * 3] = nor[src * 3]; nor[d * 3 + 1] = nor[src * 3 + 1]; nor[d * 3 + 2] = nor[src * 3 + 2];
      col[d * 3] = col[src * 3]; col[d * 3 + 1] = col[src * 3 + 1]; col[d * 3 + 2] = col[src * 3 + 2];
      uv[d * 2] = uv[src * 2]; uv[d * 2 + 1] = uv[src * 2 + 1];
    });
    const idx = [];
    const inMain = (ii, jj) => Math.abs(ox + ii * cell) <= HALF && Math.abs(oz + jj * cell) <= HALF;
    for (let jj = 0; jj < n; jj++) for (let ii = 0; ii < n; ii++) {
      if (inMain(ii, jj) && inMain(ii + 1, jj) && inMain(ii, jj + 1) && inMain(ii + 1, jj + 1)) continue;   // the main mesh covers it
      const a = jj * V + ii, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, c, b, c, d, b);
    }
    const sk = (row, flip) => {                                             // skirt quads along one edge
      for (let a = 0; a < n; a++) {
        const t0 = row.top + a, t1 = row.top + a + 1, d0 = nv + row.skirt + a, d1 = nv + row.skirt + a + 1;
        if (flip) idx.push(t0, d0, t1, d0, d1, t1); else idx.push(t0, t1, d0, d0, t1, d1);
      }
    };
    const rowStep = (start, step) => ({ start, step });
    // edge quads: use explicit indices (top vertex ids are src ids)
    const quad = (srcs, skirtBase, flip) => {
      for (let a = 0; a < n; a++) {
        const t0 = srcs(a), t1 = srcs(a + 1), d0 = nv + skirtBase + a, d1 = nv + skirtBase + a + 1;
        if (flip) idx.push(t0, d0, t1, d0, d1, t1); else idx.push(t0, t1, d0, d0, t1, d1);
      }
    };
    quad(a => a, 0, true); quad(a => (V - 1) * V + a, V, false); quad(a => a * V, 2 * V, false); quad(a => a * V + V - 1, 3 * V, true);
    void sk; void rowStep;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.mats[l]);
    mesh.receiveShadow = l < 2;
    mesh.visible = false;
    this.group.add(mesh);
    this.built++;
    return { mesh, l, i, j, used: 0 };
  }

  // choose tiles for the player position; returns the list of wanted-but-missing leaves
  select(px, pz) {
    const leaves = [];
    const rec = (l, i, j) => {
      const S = S0 << l, x0 = i * S, z0 = j * S;
      if (this.inside(x0, x0 + S, z0, z0 + S)) return;
      const dx = Math.max(x0 - px, 0, px - (x0 + S)), dz = Math.max(z0 - pz, 0, pz - (z0 + S));
      if (l === 0 || Math.hypot(dx, dz) > S * 1.15) { leaves.push({ l, i, j, d: Math.hypot(dx, dz) }); return; }
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) rec(l - 1, i * 2 + a, j * 2 + b);
    };
    const top = LEVELS - 1;
    for (let i = -1; i <= 0; i++) for (let j = -1; j <= 0; j++) rec(top, i, j);
    return leaves;
  }

  update(px, pz, budgetMs = 6) {
    this.frame++;
    const leaves = this.select(px, pz);
    const vis = new Set(), missing = [];
    for (const L of leaves) {
      const t = this.tiles.get(this.key(L.l, L.i, L.j));
      if (t) { vis.add(t); t.used = this.frame; continue; }
      missing.push(L);
      let l = L.l, i = L.i, j = L.j;
      while (l < LEVELS - 1) {                                       // show the nearest built ancestor meanwhile
        l++; i = Math.floor(i / 2); j = Math.floor(j / 2);
        const a = this.tiles.get(this.key(l, i, j));
        if (a) { vis.add(a); a.used = this.frame; break; }
      }
    }
    missing.sort((a, b) => b.l - a.l || a.d - b.d);                   // coarse first (fast), then near-to-far
    const t0 = performance.now();
    let built = 0;
    for (const L of missing) {
      if (built > 0 && performance.now() - t0 > budgetMs) break;
      this.tiles.set(this.key(L.l, L.i, L.j), this.build(L.l, L.i, L.j)); built++;
    }
    for (const t of this.tiles.values()) t.mesh.visible = vis.has(t) || (t.used === this.frame);
    // memory: drop tiles that have not been needed for a while
    if (this.tiles.size > 420) {
      const old = [...this.tiles.entries()].filter(([, t]) => this.frame - t.used > 600 && t.l < LEVELS - 1).sort((a, b) => a[1].used - b[1].used).slice(0, 60);
      for (const [k, t] of old) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); this.tiles.delete(k); }
    }
    return missing.length - built;
  }

  async prebuild(px, pz, onProgress) {
    let guard = 0;
    for (;;) {
      const left = this.update(px, pz, 14);
      onProgress?.(left);
      if (left <= 0 || guard++ > 400) break;
      await new Promise(r => setTimeout(r, 0));
    }
  }
}
