// World queries for physics: ground (terrain + bridge decks + boulders), obstacles
// (trees, rocks, buildings) and the surface type under a wheel.
import { WORLD } from './heightfield.js';

export const SURFACES = {
  gravel: { mu: 0.74, rr: 0.024, dust: [0.62, 0.57, 0.5], dusty: 1.0, label: 'gravel' },
  dirt: { mu: 0.78, rr: 0.02, dust: [0.55, 0.45, 0.33], dusty: 1.0, label: 'dirt' },
  mud: { mu: 0.46, rr: 0.075, dust: [0.28, 0.21, 0.14], dusty: 0, mud: 1, label: 'mud' },
  grass: { mu: 0.63, rr: 0.034, dust: [0.42, 0.45, 0.3], dusty: 0.25, label: 'grass' },
  rock: { mu: 0.86, rr: 0.015, dust: [0.6, 0.58, 0.55], dusty: 0.5, label: 'rock' },
  scree: { mu: 0.62, rr: 0.045, dust: [0.6, 0.58, 0.55], dusty: 0.9, label: 'scree' },
  forest: { mu: 0.66, rr: 0.035, dust: [0.35, 0.28, 0.2], dusty: 0.4, label: 'forest floor' },
  snow: { mu: 0.36, rr: 0.05, dust: [0.95, 0.96, 1.0], dusty: 1.0, snow: 1, label: 'snow' },
  ice: { mu: 0.12, rr: 0.008, dust: [0.9, 0.95, 1.0], dusty: 0.2, snow: 1, label: 'ice' },
  water: { mu: 0.55, rr: 0.11, dust: [0.8, 0.85, 0.9], dusty: 0, water: 1, label: 'water' },
  wood: { mu: 0.7, rr: 0.015, dust: [0.5, 0.4, 0.3], dusty: 0, label: 'bridge' },
  track: { mu: 0.7, rr: 0.022, dust: [0.58, 0.48, 0.36], dusty: 1.0, label: 'drift track' },
};

const CELL = 16;
export class WorldCollision {
  constructor(world) {
    this.field = world.field;
    this.meta = world.meta;
    this.grid = new Map();        // obstacle spatial hash
    this.roadGrid = new Map();    // road sample hash -> surface
    this.wetness = 0;             // weather
    this.snowCover = 0;
    for (const r of world.meta.roads) {
      for (let i = 0; i < r.pts.length; i += 2) {
        const p = r.pts[i];
        const k = this._key(p[0], p[2]);
        let a = this.roadGrid.get(k); if (!a) this.roadGrid.set(k, a = []);
        a.push([p[0], p[2], r.w, r.surface, p[3], p[1]]);
      }
    }
    // bridge decks follow the road polyline across the span
    this.bridges = (world.meta.bridges || []).map(b => {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const p of b.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
      return { ...b, bb: [x0 - b.w, x1 + b.w, z0 - b.w, z1 + b.w], half: b.w / 2 };
    });
    const d = world.meta.drift;
    this.drift = d;
  }

  _key(x, z) { return ((Math.floor(x / CELL) + 4096) << 13) | (Math.floor(z / CELL) + 4096); }

  // obstacle: {type:'cyl'|'sphere'|'box', x,y,z, r, h, (box: hx,hz,rot,hy)}
  add(ob) {
    const r = ob.type === 'box' ? Math.hypot(ob.hx, ob.hz) : ob.r;
    for (let x = Math.floor((ob.x - r) / CELL); x <= Math.floor((ob.x + r) / CELL); x++)
      for (let z = Math.floor((ob.z - r) / CELL); z <= Math.floor((ob.z + r) / CELL); z++) {
        const k = ((x + 4096) << 13) | (z + 4096);
        let a = this.grid.get(k); if (!a) this.grid.set(k, a = []);
        a.push(ob);
      }
  }
  removeWhere(pred) {
    for (const [k, a] of this.grid) {
      const b = a.filter(o => !pred(o));
      if (b.length) this.grid.set(k, b); else this.grid.delete(k);
    }
  }
  near(x, z) { return this.grid.get(this._key(x, z)); }

  bridgeAt(x, z, y) {
    let out = null, bestDy = 1e9;
    for (const b of this.bridges) {
      if (x < b.bb[0] || x > b.bb[1] || z < b.bb[2] || z > b.bb[3]) continue;
      const P = b.pts;
      let best = 1e9, deck = 0, bi = 0, bu = 0;
      for (let i = 0; i < P.length - 1; i++) {
        const ax = P[i][0], az = P[i][2], dx = P[i + 1][0] - ax, dz = P[i + 1][2] - az, L2 = dx * dx + dz * dz || 1;
        const uRaw = ((x - ax) * dx + (z - az) * dz) / L2;
        const u = Math.max(0, Math.min(1, uRaw));
        const d = Math.hypot(ax + u * dx - x, az + u * dz - z);
        if (d < best) { best = d; deck = P[i][1] + (P[i + 1][1] - P[i][1]) * u; bi = i; bu = uRaw; }
      }
      // beyond either end of the deck the (carved) approach terrain takes over
      if ((bi === 0 && bu < 0) || (bi === P.length - 2 && bu > 1)) continue;
      if (best < b.half && (y === undefined || y > deck - 1.5)) {
        const dy = y === undefined ? -deck : Math.abs(y - deck);
        if (dy < bestDy) { bestDy = dy; out = deck; }
      }
    }
    return out;
  }

  // ground height & normal under (x,z) for an object at height y (for bridges)
  ground(x, z, y, out) {
    const f = this.field;
    const h = f.height(x, z);
    out.h = h; out.bridge = false;
    const deck = this.bridges.length ? this.bridgeAt(x, z, y) : null;
    if (deck !== null && deck > h) { out.h = deck; out.nx = 0; out.ny = 1; out.nz = 0; out.bridge = true; return out; }
    const wl = f.waterLevel(x, z);
    if (wl > h && this._frozenAt(x, z)) { out.h = wl; out.nx = 0; out.ny = 1; out.nz = 0; return out; }
    const e = 0.3;
    const hl = f.height(x - e, z), hr = f.height(x + e, z), hd = f.height(x, z - e), hu = f.height(x, z + e);
    let nx = hl - hr, ny = 2 * e, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out.nx = nx / l; out.ny = ny / l; out.nz = nz / l;
    return out;
  }

  roadAt(x, z) {
    let best = null, bd = 1e9;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = this.roadGrid.get(this._key(x + dx * CELL, z + dz * CELL));
      if (!a) continue;
      for (const s of a) { const d = Math.hypot(s[0] - x, s[1] - z); if (d < bd) { bd = d; best = s; } }
    }
    if (best && bd < best[2] + 1.6) return { surface: best[3], dist: bd, w: best[2], bridge: best[4] };
    return null;
  }

  surfaceAt(x, z, groundH, onBridge) {
    const f = this.field;
    if (onBridge) return 'wood';
    const wl = f.waterLevel(x, z);
    if (wl > groundH + 0.06) {
      const L = this._frozenAt(x, z);
      return L ? 'ice' : 'water';
    }
    const dr = this.drift;
    // drift circuit: the compacted ring band (baked into the road mask), not the infield
    if (dr && Math.hypot((x - dr.x) / 1.25, (z - dr.z) / 0.9) < 160 && f.mask(x, z, 4) > 0.45) return 'track';
    const road = this.roadAt(x, z);
    const snow = f.mask(x, z, 3);
    if (road) {
      if (snow + this.snowCover * 0.6 > 0.75) return 'snow';
      return road.surface === 'rock' ? 'scree' : road.surface;
    }
    if (snow + this.snowCover * 0.7 > 0.55) return 'snow';
    const rock = f.mask(x, z, 7), wet = f.mask(x, z, 0), forest = f.mask(x, z, 2), sed = f.mask(x, z, 1), waterProx = f.mask(x, z, 5);
    if (waterProx > 0.8) return 'gravel';
    if (rock > 0.55) return 'rock';
    if (sed > 0.5) {
      const b0 = f.baseHeight(x, z), sl = Math.hypot(f.baseHeight(x + 2, z) - b0, f.baseHeight(x, z + 2) - b0) / 2;
      if (sl > 0.12) return 'scree';
    }
    if (wet + this.wetness * 0.12 > 0.84 && rock < 0.3) return 'mud';
    if (forest > 0.45) return 'forest';
    if (groundH > 2350) return rock > 0.25 ? 'scree' : 'grass';
    return 'grass';
  }

  _frozenAt(x, z) {
    for (const L of this.meta.lakes) if (L.frozen && Math.hypot(x - L.x, z - L.z) < L.r * 1.3) return L;
    return null;
  }
}

// railing colliders along both deck edges of every bridge (boxes per segment)
export function bridgeRailColliders(meta) {
  const out = [];
  for (const b of meta.bridges || []) {
    const P = b.pts;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], c = P[i + 1];
      const dx = c[0] - a[0], dz = c[2] - a[2], L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L, rot = Math.atan2(dx, dz);
      for (const side of [-1, 1]) {
        const off = b.w / 2 + 0.1;
        out.push({ type: 'box', x: (a[0] + c[0]) / 2 + nx * off * side, z: (a[2] + c[2]) / 2 + nz * off * side, y: Math.min(a[1], c[1]) - 0.2, hy: 1.4, hx: 0.12, hz: L / 2 + 0.05, rot, rail: true });
      }
    }
  }
  return out;
}
