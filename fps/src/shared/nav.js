// Grid navigation for bots: 2m cells over the play area, A* with octile heuristic and
// line-of-sight path smoothing. Rebuilt locally when destruction opens new routes.
import { BOUNDS, queryBoxes, heightAt, F } from './world.js';

export const NCELL = 2;
const PAD = 30;

export function buildNav(W) {
  const x0 = BOUNDS.minX - PAD, z0 = BOUNDS.minZ - PAD;
  const nx = Math.ceil((BOUNDS.maxX - BOUNDS.minX + PAD * 2) / NCELL), nz = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ + PAD * 2) / NCELL);
  const N = { x0, z0, nx, nz, block: new Uint8Array(nx * nz), cost: new Uint8Array(nx * nz) };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) markCell(W, N, i, j);
  N.g = new Float32Array(nx * nz); N.f = new Float32Array(nx * nz); N.par = new Int32Array(nx * nz);
  N.seen = new Uint32Array(nx * nz); N.closed = new Uint32Array(nx * nz); N.gen = 1;
  N.heap = new Int32Array(nx * nz);
  W.nav = N;
  return N;
}

function markCell(W, N, i, j) {
  const cx = N.x0 + (i + 0.5) * NCELL, cz = N.z0 + (j + 0.5) * NCELL;
  const h = heightAt(W, cx, cz);
  let blocked = 0;
  // steep slope
  const s = Math.max(Math.abs(heightAt(W, cx + 1.5, cz) - heightAt(W, cx - 1.5, cz)), Math.abs(heightAt(W, cx, cz + 1.5) - heightAt(W, cx, cz - 1.5))) / 3;
  if (s > 0.85) blocked = 1;
  const r = 0.55;
  queryBoxes(W, cx - r, cz - r, cx + r, cz + r, F.SOLID, (b) => {
    if (b.y1 > h + 0.6 && b.y0 < h + 1.9) { blocked = 1; return false; }
  });
  // building interiors are off-limits for bot pathing (intact buildings)
  if (!blocked) for (const B of W.buildings) {
    if (!B.collapsed && !B.skeleton && cx > B.x0 - 0.3 && cx < B.x1 + 0.3 && cz > B.z0 - 0.3 && cz < B.z1 + 0.3) { blocked = 1; break; }
  }
  N.block[j * N.nx + i] = blocked;
  N.cost[j * N.nx + i] = s > 0.45 ? 3 : 0;
}

export function refreshNavArea(W, x0, z0, x1, z1) {
  const N = W.nav; if (!N) return;
  const i0 = Math.max(0, Math.floor((x0 - N.x0) / NCELL)), i1 = Math.min(N.nx - 1, Math.floor((x1 - N.x0) / NCELL));
  const j0 = Math.max(0, Math.floor((z0 - N.z0) / NCELL)), j1 = Math.min(N.nz - 1, Math.floor((z1 - N.z0) / NCELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) markCell(W, N, i, j);
}

export function cellOf(N, x, z) {
  const i = Math.floor((x - N.x0) / NCELL), j = Math.floor((z - N.z0) / NCELL);
  if (i < 0 || j < 0 || i >= N.nx || j >= N.nz) return -1;
  return j * N.nx + i;
}
export function cellCenter(N, c, out = [0, 0]) {
  const i = c % N.nx, j = (c / N.nx) | 0;
  out[0] = N.x0 + (i + 0.5) * NCELL; out[1] = N.z0 + (j + 0.5) * NCELL;
  return out;
}

export function nearestFree(N, c, maxR = 8) {
  if (c < 0) return -1;
  if (!N.block[c]) return c;
  const ci = c % N.nx, cj = (c / N.nx) | 0;
  for (let r = 1; r <= maxR; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= N.nx || j >= N.nz) continue;
      const k = j * N.nx + i;
      if (!N.block[k]) return k;
    }
  }
  return -1;
}

function lineFree(N, a, b) {
  let x0 = a % N.nx, y0 = (a / N.nx) | 0;
  const x1 = b % N.nx, y1 = (b / N.nx) | 0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < 2000; guard++) {
    const k = y0 * N.nx + x0;
    if (N.block[k]) return false;
    // check diagonal neighbors to avoid corner cutting
    if (x0 + 1 < N.nx && N.block[k + 1] && dy > 0 && dx > 0) { /* soft */ }
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
    if (e2 > -dy && e2 < dx) { // diagonal step: both orthogonal neighbours must be free
      if (N.block[(y0 - sy) * N.nx + x0] || N.block[y0 * N.nx + x0 - sx]) return false;
    }
  }
  return true;
}

// A* from world (ax,az) to (bx,bz). Returns array of [x,z] waypoints or null.
export function findPath(W, ax, az, bx, bz, maxIter = 24000) {
  const N = W.nav;
  let s = nearestFree(N, cellOf(N, ax, az)), g = nearestFree(N, cellOf(N, bx, bz), 12);
  if (s < 0 || g < 0) return null;
  if (s === g) return [[bx, bz]];
  const gen = ++N.gen;
  const nx = N.nx, gi = g % nx, gj = (g / nx) | 0;
  const H = (c) => { const di = Math.abs((c % nx) - gi), dj = Math.abs(((c / nx) | 0) - gj); return (di + dj + (1.4142 - 2) * Math.min(di, dj)); };
  let hs = 0; const heap = N.heap, f = N.f, gg = N.g;
  const push = (c) => { let i = hs++; heap[i] = c; while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[c]) break; heap[i] = heap[p]; i = p; } heap[i] = c; };
  const pop = () => { const top = heap[0]; const last = heap[--hs]; let i = 0; for (;;) { let l = i * 2 + 1; if (l >= hs) break; const r = l + 1; if (r < hs && f[heap[r]] < f[heap[l]]) l = r; if (f[heap[l]] >= f[last]) break; heap[i] = heap[l]; i = l; } heap[i] = last; return top; };
  gg[s] = 0; f[s] = H(s); N.seen[s] = gen; N.par[s] = -1; push(s);
  let found = false, it = 0, best = s, bestH = 1e9;
  while (hs > 0 && it++ < maxIter) {
    const c = pop();
    if (N.closed[c] === gen) continue;
    N.closed[c] = gen;
    if (c === g) { found = true; break; }
    const h = f[c] - gg[c];
    if (h < bestH) { bestH = h; best = c; }
    const ci = c % nx, cj = (c / nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= nx || j >= N.nz) continue;
      const k = j * nx + i;
      if (N.block[k] || N.closed[k] === gen) continue;
      if (di && dj && (N.block[cj * nx + i] || N.block[j * nx + ci])) continue;
      const ng = gg[c] + (di && dj ? 1.4142 : 1) + N.cost[k] * 0.5;
      if (N.seen[k] !== gen || ng < gg[k]) {
        N.seen[k] = gen; gg[k] = ng; f[k] = ng + H(k) * 1.15; N.par[k] = c; push(k);
      }
    }
  }
  let end = found ? g : best;
  const cells = [];
  for (let c = end, guard = 0; c !== -1 && guard < 20000; c = N.par[c], guard++) cells.push(c);
  cells.reverse();
  // smooth
  const out = [];
  let anchor = 0;
  for (let i = 2; i < cells.length; i++) {
    if (!lineFree(N, cells[anchor], cells[i])) { out.push(cellCenter(N, cells[i - 1], [0, 0])); anchor = i - 1; }
  }
  if (found) out.push([bx, bz]); else out.push(cellCenter(N, end, [0, 0]));
  return out;
}

export function isFree(W, x, z) { const N = W.nav; const c = cellOf(N, x, z); return c >= 0 && !N.block[c]; }
