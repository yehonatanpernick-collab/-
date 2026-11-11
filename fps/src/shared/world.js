// Procedural battlefield "VARESH CROSSING": terrain heightfield, a destructible town,
// industrial yard, rail depot, farmstead, HQs. Provides collision + raycasting used by
// movement, bullets, bots and rendering. Deterministic from a seed (server == clients).
import { mulberry32, makeNoise2, fbm, smoothstep, clamp, lerp, rayBox } from './math.js';

export const MAP_NAME = 'VARESH CROSSING';
export const HALF = 512;          // terrain extends -HALF..HALF
export const HRES = 2;            // heightfield spacing (m)
export const HN = HALF * 2 / HRES + 1;
export const BOUNDS = { minX: -255, maxX: 255, minZ: -340, maxZ: 340 };
export const TOWN_H = 4.0;
const CELL = 8, GN = (HALF * 2) / CELL;

// render kinds
export const K = {
  PLASTER: 0, BRICK: 1, CONCRETE: 2, SLAB: 3, GLASS: 4, TRIM: 5, CONTAINER: 6, SANDBAG: 7,
  BARRIER: 8, WOOD: 9, METAL: 10, RUBBLE: 11, STAIR: 12, SIDEWALK: 13, HESCO: 14, INVIS: 15, ROOF: 16,
};
export const KIND_NAMES = Object.keys(K);
// impact materials
export const MAT = { CONCRETE: 0, METAL: 1, WOOD: 2, GLASS: 3, DIRT: 4, FLESH: 5, SAND: 6 };
// flags
export const F = { SOLID: 1, SHOOT: 2, BREAK: 4, VIS: 8 };
const FULL = F.SOLID | F.SHOOT | F.VIS;

export const PW = 3;   // panel width
export const WT = 0.3; // wall thickness

export function generateWorld(seed = 1337) {
  const rnd = mulberry32(seed);
  const n1 = makeNoise2(seed * 7 + 1), n2 = makeNoise2(seed * 13 + 5), n3 = makeNoise2(seed * 31 + 9);
  const W = {
    seed, boxes: [], panels: [], buildings: [], props: [], roads: [], flags: [], hq: {}, decor: [],
    heights: new Float32Array(HN * HN), grid: new Array(GN * GN), stamp: 1, stampArr: null,
    craters: [], flagSpots: {},
  };

  // ---------------- terrain ----------------
  const townSd = (x, z) => { const dx = Math.abs(x) - 182, dz = Math.abs(z) - 168; return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0); };
  const flats = [
    { x: -70, z: -238, r: 46, f: 30 }, // farm A
    { x: 78, z: 238, r: 52, f: 30 },   // depot E
    { x: 0, z: -312, r: 40, f: 25 },   // HQ1
    { x: 0, z: 312, r: 40, f: 25 },    // HQ2
  ];
  const rawH = (x, z) => {
    let h = fbm(n1, x * 0.0032, z * 0.0032, 5) * 20 + fbm(n2, x * 0.011, z * 0.011, 3) * 3.2 + fbm(n3, x * 0.05, z * 0.05, 2) * 0.35;
    h += 6;
    const ax = Math.abs(x), az = Math.abs(z);
    h += smoothstep(225, 430, ax) * (48 + fbm(n2, x * 0.01, z * 0.01, 3) * 22);
    h += smoothstep(320, 470, az) * (42 + fbm(n1, x * 0.012, z * 0.009, 3) * 18);
    return h;
  };
  for (const f of flats) f.h = rawH(f.x, f.z) * 0.6 + TOWN_H * 0.4;
  for (let j = 0; j < HN; j++) {
    for (let i = 0; i < HN; i++) {
      const x = -HALF + i * HRES, z = -HALF + j * HRES;
      let h = rawH(x, z);
      for (const f of flats) {
        const d = Math.hypot(x - f.x, z - f.z);
        const t = 1 - smoothstep(f.r, f.r + f.f, d);
        if (t > 0) h = lerp(h, f.h, t);
      }
      const tt = 1 - smoothstep(0, 46, townSd(x, z));
      h = lerp(h, TOWN_H, tt);
      W.heights[j * HN + i] = h;
    }
  }
  // shell craters in the fields
  for (let c = 0; c < 26; c++) {
    const cx = (rnd() - 0.5) * 440, cz = (rnd() < 0.5 ? -1 : 1) * (185 + rnd() * 110);
    const r = 3 + rnd() * 4;
    if (Math.hypot(cx - flats[0].x, cz - flats[0].z) < 60 || Math.hypot(cx - flats[1].x, cz - flats[1].z) < 60) continue;
    if (Math.abs(cx) < 10) continue;
    W.craters.push({ x: cx, z: cz, r });
    const ri = Math.ceil(r * 1.6 / HRES);
    const ci = Math.round((cx + HALF) / HRES), cj = Math.round((cz + HALF) / HRES);
    for (let j = cj - ri; j <= cj + ri; j++) for (let i = ci - ri; i <= ci + ri; i++) {
      if (i < 0 || j < 0 || i >= HN || j >= HN) continue;
      const x = -HALF + i * HRES, z = -HALF + j * HRES;
      const d = Math.hypot(x - cx, z - cz) / r;
      if (d < 1.6) W.heights[j * HN + i] += d < 1 ? -(1 - d * d) * r * 0.32 : Math.sin((d - 1) / 0.6 * Math.PI) * r * 0.06;
    }
  }

  W.heightAt = (x, z) => heightAt(W, x, z);

  // ---------------- helpers ----------------
  const addBox = (x0, y0, z0, x1, y1, z1, kind, mat, flags = FULL, o = {}) => {
    const b = {
      i: W.boxes.length, x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1),
      x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1),
      kind, mat, flags, panel: o.panel ?? -1, bld: o.bld ?? -1, color: o.color ?? 0xffffff, active: o.active ?? true,
    };
    W.boxes.push(b);
    return b.i;
  };
  const groundMax = (x0, z0, x1, z1) => {
    let m = -1e9;
    for (let x = x0; x <= x1 + 0.01; x += Math.max(1, (x1 - x0) / 4)) for (let z = z0; z <= z1 + 0.01; z += Math.max(1, (z1 - z0) / 4)) m = Math.max(m, W.heightAt(x, z));
    return m;
  };
  const groundMin = (x0, z0, x1, z1) => {
    let m = 1e9;
    for (let x = x0; x <= x1 + 0.01; x += Math.max(1, (x1 - x0) / 4)) for (let z = z0; z <= z1 + 0.01; z += Math.max(1, (z1 - z0) / 4)) m = Math.min(m, W.heightAt(x, z));
    return m;
  };
  const pick = (arr) => arr[(rnd() * arr.length) | 0];
  const prop = (type, x, y, z, ry = 0, s = 1, extra = {}) => { W.props.push({ type, x, y, z, ry, s, ...extra }); };

  const PLASTER_COLORS = [0xe8dcc3, 0xd9c7a3, 0xcfb28a, 0xe2d2b4, 0xc9b9a0, 0xd8b98e, 0xbfae95, 0xe6e0d2, 0xc4a27c, 0xd5c4ae, 0xb8a58a];
  const BRICK_COLORS = [0xffffff, 0xf0e0d8, 0xe4d0c0, 0xd8c8c0];

  // ---------------- building generator ----------------
  function building(o) {
    const { x0, z0 } = o;
    const w = Math.max(PW * 2, Math.round(o.w / PW) * PW), d = Math.max(PW * 2, Math.round(o.d / PW) * PW);
    const floors = o.floors || 1, fh = o.fh || 3.2;
    const style = o.style || 'plaster';
    const kind = style === 'brick' ? K.BRICK : style === 'concrete' ? K.CONCRETE : style === 'metal' ? K.METAL : style === 'wood' ? K.WOOD : K.PLASTER;
    const mat = style === 'metal' ? MAT.METAL : style === 'wood' ? MAT.WOOD : MAT.CONCRETE;
    const color = o.color ?? (style === 'brick' ? pick(BRICK_COLORS) : style === 'plaster' ? pick(PLASTER_COLORS) : style === 'concrete' ? pick([0xd0d0cc, 0xc2c0b8, 0xb8b6b0]) : style === 'metal' ? pick([0x8a9a9a, 0x9a8a78, 0x7d8b78, 0xa8a49a]) : 0xa08060);
    const hp = o.hp || (style === 'concrete' ? 320 : style === 'brick' ? 230 : style === 'metal' ? 160 : style === 'wood' ? 90 : 170);
    const x1 = x0 + w, z1 = z0 + d;
    const by = (o.baseY ?? groundMax(x0, z0, x1, z1)) + 0.02;
    const bi = W.buildings.length;
    const B = { i: bi, x0, z0, x1, z1, by, floors, fh, style, kind, color, panels: [], boxes: [], rubble: [], collapsed: false, top: by + floors * fh, groundPanels: 0, hp };
    W.buildings.push(B);
    const ob = { bld: bi, color };
    // foundation
    const gmin = groundMin(x0, z0, x1, z1);
    B.boxes.push(addBox(x0 - 0.1, gmin - 1.5, z0 - 0.1, x1 + 0.1, by, z1 + 0.1, K.CONCRETE, MAT.CONCRETE, FULL, { bld: bi, color: 0xb0aca4 }));

    const winChance = o.windows ?? 0.62;
    const doorSides = o.doorSides || ['S'];
    const sides = [
      { s: 'S', axis: 'x', a0: x0, a1: x1, c: z0 + WT / 2, out: -1 },
      { s: 'N', axis: 'x', a0: x0, a1: x1, c: z1 - WT / 2, out: 1 },
      { s: 'W', axis: 'z', a0: z0 + WT, a1: z1 - WT, c: x0 + WT / 2, out: -1 },
      { s: 'E', axis: 'z', a0: z0 + WT, a1: z1 - WT, c: x1 - WT / 2, out: 1 },
    ];
    const stairs = d >= 9 && w >= 6 && floors >= 1 && !o.noStairs;
    const runLen = 5.4, stairW = 1.3;
    const sx0 = x0 + WT, sx1 = x0 + WT + stairW, sz0 = z0 + WT + 1.2, sz1 = sz0 + runLen;

    for (let f = 0; f < floors; f++) {
      const yb = by + f * fh, yt = yb + fh;
      for (const S of sides) {
        const len = S.a1 - S.a0;
        const n = Math.max(1, Math.round(len / PW));
        const doorIdx = (f === 0 && doorSides.includes(S.s)) ? (o.doorAt != null ? Math.min(n - 1, o.doorAt) : Math.min(n - 1, 1 + ((rnd() * (n - 2)) | 0))) : -1;
        for (let k = 0; k < n; k++) {
          const s0 = S.a0 + (len * k) / n, s1 = S.a0 + (len * (k + 1)) / n;
          let type = 'solid';
          if (k === doorIdx) type = o.bigDoor ? 'garage' : 'door';
          else if (o.style === 'metal' && f === 0) type = rnd() < 0.15 ? 'window' : 'solid';
          else if (rnd() < winChance && !(S.s === 'W' && stairs && s1 > sz0 && s0 < sz1)) type = 'window';
          if (o.allWindows && type === 'solid' && rnd() < 0.85) type = 'window';
          const pid = W.panels.length;
          const P = { i: pid, bld: bi, boxes: [], hp, maxHp: hp, alive: true, floor: f, side: S.s, type };
          W.panels.push(P);
          B.panels.push(pid);
          if (f === 0) B.groundPanels++;
          const po = { ...ob, panel: pid };
          const mk = (a0, a1, y0, y1, kd = kind, mt = mat, fl = FULL, th = WT, off = 0, col = color) => {
            const c = S.c + off * S.out;
            const bi2 = S.axis === 'x' ? addBox(a0, y0, c - th / 2, a1, y1, c + th / 2, kd, mt, fl, { ...po, color: col })
              : addBox(c - th / 2, y0, a0, c + th / 2, y1, a1, kd, mt, fl, { ...po, color: col });
            P.boxes.push(bi2); B.boxes.push(bi2);
            return bi2;
          };
          const L = s1 - s0;
          if (type === 'solid') mk(s0, s1, yb, yt);
          else if (type === 'window') {
            const sill = Math.min(0.95, fh * 0.3), lin = Math.min(yb + 2.2, yt - 0.3);
            const pier = Math.max(0.5, (L - 1.5) / 2);
            mk(s0, s1, yb, yb + sill);
            mk(s0, s1, lin, yt);
            mk(s0, s0 + pier, yb + sill, lin);
            mk(s1 - pier, s1, yb + sill, lin);
            mk(s0 + pier, s1 - pier, yb + sill, lin, K.GLASS, MAT.GLASS, F.SHOOT | F.BREAK | F.VIS, 0.05);
            mk(s0 + pier - 0.08, s1 - pier + 0.08, yb + sill - 0.1, yb + sill + 0.015, K.TRIM, MAT.CONCRETE, F.VIS, WT + 0.24, 0, 0xd8d4cc);
          } else {
            const ow = type === 'garage' ? Math.min(L - 0.4, 4.2) : 1.25;
            const oh = type === 'garage' ? Math.min(fh - 0.5, 4.2) : 2.3;
            const pier = (L - ow) / 2;
            mk(s0, s1, yb + oh, yt);
            if (pier > 0.05) { mk(s0, s0 + pier, yb, yb + oh); mk(s1 - pier, s1, yb, yb + oh); }
          }
          if (f > 0 && style !== 'metal') mk(s0, s1, yb - 0.12, yb + 0.1, K.TRIM, MAT.CONCRETE, F.VIS, WT + 0.2, 0, 0xd6d2c8);
          let cx = 0, cy = 0, cz = 0;
          for (const b of P.boxes) { const bb = W.boxes[b]; cx += (bb.x0 + bb.x1) / 2; cy += (bb.y0 + bb.y1) / 2; cz += (bb.z0 + bb.z1) / 2; }
          P.cx = cx / P.boxes.length; P.cy = cy / P.boxes.length; P.cz = cz / P.boxes.length;
          P.nx = S.axis === 'z' ? S.out : 0; P.nz = S.axis === 'x' ? S.out : 0;
        }
      }
      // floor slab above this floor (with stair hole)
      const sy0 = yt - 0.25, sy1 = yt;
      const isRoof = f === floors - 1;
      const sk = isRoof ? K.ROOF : K.SLAB;
      const ix0 = isRoof ? x0 : x0 + WT, ix1 = isRoof ? x1 : x1 - WT, iz0 = isRoof ? z0 : z0 + WT, iz1 = isRoof ? z1 : z1 - WT;
      const so = { bld: bi, color: isRoof ? 0x9a958c : 0xb8b2a6 };
      if (stairs) {
        B.boxes.push(addBox(sx1 + 0.05, sy0, iz0, ix1, sy1, iz1, sk, MAT.CONCRETE, FULL, so));
        B.boxes.push(addBox(ix0, sy0, iz0, sx1 + 0.05, sy1, sz0, sk, MAT.CONCRETE, FULL, so));
        B.boxes.push(addBox(ix0, sy0, sz1, sx1 + 0.05, sy1, iz1, sk, MAT.CONCRETE, FULL, so));
        if (isRoof) B.boxes.push(addBox(sx1 + 0.05, sy1, sz0, sx1 + 0.2, sy1 + 1.0, sz1, K.TRIM, MAT.CONCRETE, FULL, so));
        const nSteps = Math.round(fh / 0.27);
        const rise = fh / nSteps, depth = runLen / nSteps;
        for (let k = 0; k < nSteps; k++) {
          const top = yb + (k + 1) * rise;
          B.boxes.push(addBox(sx0, k === 0 ? yb : top - 0.3, sz0 + k * depth, sx1, top, sz0 + (k + 1) * depth, K.STAIR, MAT.CONCRETE, FULL, { bld: bi, color: 0xa8a49c }));
        }
      } else {
        B.boxes.push(addBox(ix0, sy0, iz0, ix1, sy1, iz1, sk, MAT.CONCRETE, FULL, so));
      }
      // interior partition with a doorway on big footprints
      if (w >= 12 && d >= 12 && !o.open) {
        const px = x0 + Math.round(w / 2 / PW) * PW;
        const pid = W.panels.length;
        const P = { i: pid, bld: bi, boxes: [], hp: hp * 0.6, maxHp: hp * 0.6, alive: true, floor: f, side: 'I', type: 'door' };
        W.panels.push(P); B.panels.push(pid);
        const pz0 = z0 + WT, pz1 = z1 - WT, mid = (pz0 + pz1) / 2;
        const po = { bld: bi, panel: pid, color: 0xddd6c8 };
        for (const bb of [[pz0, mid - 0.7, yb, yt - 0.25], [mid + 0.7, pz1, yb, yt - 0.25], [mid - 0.7, mid + 0.7, yb + 2.2, yt - 0.25]]) {
          const id = addBox(px - 0.08, bb[2], bb[0], px + 0.08, bb[3], bb[1], K.PLASTER, MAT.CONCRETE, FULL, po);
          P.boxes.push(id); B.boxes.push(id);
        }
        P.cx = px; P.cy = yb + fh / 2; P.cz = mid; P.nx = 1; P.nz = 0;
      }
    }
    // parapet + roof props
    const ry = B.top;
    if (!o.noParapet) {
      const pc = { bld: bi, color: 0xcfc9bd };
      const pt = WT + 0.04;
      B.boxes.push(addBox(x0 - 0.02, ry, z0 - 0.02, x1 + 0.02, ry + 0.9, z0 + pt, K.TRIM, MAT.CONCRETE, FULL, pc));
      B.boxes.push(addBox(x0 - 0.02, ry, z1 - pt, x1 + 0.02, ry + 0.9, z1 + 0.02, K.TRIM, MAT.CONCRETE, FULL, pc));
      B.boxes.push(addBox(x0 - 0.02, ry, z0 + pt, x0 + pt, ry + 0.9, z1 - pt, K.TRIM, MAT.CONCRETE, FULL, pc));
      B.boxes.push(addBox(x1 - pt, ry, z0 + pt, x1 + 0.02, ry + 0.9, z1 - pt, K.TRIM, MAT.CONCRETE, FULL, pc));
    }
    if (!o.noRoofProps && w >= 6) {
      const nac = 1 + ((rnd() * 3) | 0);
      for (let a = 0; a < nac; a++) {
        const ax = x0 + 2.5 + rnd() * (w - 5), az = z0 + 1.5 + rnd() * (d - 3);
        if (stairs && ax < sx1 + 1.5 && az > sz0 - 1 && az < sz1 + 1) continue;
        B.boxes.push(addBox(ax - 0.6, ry, az - 0.45, ax + 0.6, ry + 0.9, az + 0.45, K.METAL, MAT.METAL, FULL, { bld: bi, color: 0xc8ccc8 }));
        prop('acunit', ax, ry, az, 0, 1, { bld: bi });
      }
      if (rnd() < 0.35) prop('antenna', x0 + w - 1.5, ry, z0 + d - 1.5, rnd() * 6, 1, { bld: bi });
      if (rnd() < 0.3 && w >= 9) { const tx = x0 + w - 2.5, tz = z0 + 2.5; B.boxes.push(addBox(tx - 1, ry, tz - 1, tx + 1, ry + 2.4, tz + 1, K.INVIS, MAT.METAL, F.SOLID | F.SHOOT, { bld: bi })); prop('watertank', tx, ry, tz, 0, 1, { bld: bi }); }
    }
    // pre-built (inactive) rubble pile used on collapse
    const rh = Math.min(3.2, 0.9 + floors * 0.55);
    const rs = [[0, 0, 1, 1, 0.45], [0.1, 0.15, 0.6, 0.7, 0.8], [0.45, 0.3, 0.92, 0.85, 1]];
    for (const r of rs) {
      const id = addBox(x0 + w * r[0] - 0.6, by - 0.3, z0 + d * r[1] - 0.6, x0 + w * r[2] + 0.6, by + rh * r[4], z0 + d * r[3] + 0.6, K.RUBBLE, MAT.CONCRETE, FULL, { bld: bi, active: false, color: color });
      B.rubble.push(id);
    }
    B.collapseAt = Math.ceil(B.groundPanels * 0.5);
    return B;
  }
  W.buildingFn = building;

  // ---------------- town ----------------
  const XL = [-165, -82, 0, 82, 165], ZL = [-150, -75, 0, 75, 150];
  const streetW = (v) => (v === 0 ? 16 : 12);
  const SWK = 2.5; // sidewalk
  // streets as roads (for splat/minimap)
  for (const x of XL) W.roads.push({ type: 'asphalt', w: streetW(x), pts: [[x, -172], [x, 172]] });
  for (const z of ZL) W.roads.push({ type: 'asphalt', w: streetW(z), pts: [[-188, z], [188, z]] });
  W.roads.push({ type: 'asphalt', w: 11, pts: [[0, -340], [0, -172]] });
  W.roads.push({ type: 'asphalt', w: 11, pts: [[0, 172], [0, 340]] });
  W.roads.push({ type: 'dirt', w: 6, pts: [[-82, -172], [-80, -195], [-72, -220], [-70, -238]] });
  W.roads.push({ type: 'dirt', w: 6, pts: [[82, 172], [84, 200], [80, 222], [78, 238]] });
  W.roads.push({ type: 'dirt', w: 5, pts: [[-165, -172], [-150, -230], [-110, -262], [-70, -262]] });
  W.roads.push({ type: 'dirt', w: 5, pts: [[165, 172], [150, 230], [118, 262], [78, 262]] });
  W.roads.push({ type: 'dirt', w: 5, pts: [[0, -280], [-40, -262], [-70, -250]] });
  W.roads.push({ type: 'dirt', w: 5, pts: [[0, 280], [40, 262], [78, 250]] });
  // rails at the depot
  W.rails = [{ z: 226, x0: -40, x1: 250 }, { z: 232, x0: -40, x1: 250 }];

  const plazaR = 24;
  for (let ci = 0; ci < 4; ci++) for (let ri = 0; ri < 4; ri++) {
    const bx0 = XL[ci] + streetW(XL[ci]) / 2, bx1 = XL[ci + 1] - streetW(XL[ci + 1]) / 2;
    const bz0 = ZL[ri] + streetW(ZL[ri]) / 2, bz1 = ZL[ri + 1] - streetW(ZL[ri + 1]) / 2;
    // sidewalks
    const sw = { color: 0xbab5aa };
    const swh = TOWN_H + 0.16;
    addBox(bx0, TOWN_H - 0.5, bz0, bx1, swh, bz0 + SWK, K.SIDEWALK, MAT.CONCRETE, FULL, sw);
    addBox(bx0, TOWN_H - 0.5, bz1 - SWK, bx1, swh, bz1, K.SIDEWALK, MAT.CONCRETE, FULL, sw);
    addBox(bx0, TOWN_H - 0.5, bz0 + SWK, bx0 + SWK, swh, bz1 - SWK, K.SIDEWALK, MAT.CONCRETE, FULL, sw);
    addBox(bx1 - SWK, TOWN_H - 0.5, bz0 + SWK, bx1, swh, bz1 - SWK, K.SIDEWALK, MAT.CONCRETE, FULL, sw);
    // street lamps along sidewalks
    for (let x = bx0 + 6; x < bx1 - 4; x += 22) { prop('lamp', x, swh, bz0 + 0.6, 0); prop('lamp', x, swh, bz1 - 0.6, Math.PI); }
    const lx0 = bx0 + SWK + 0.5, lx1 = bx1 - SWK - 0.5, lz0 = bz0 + SWK + 0.5, lz1 = bz1 - SWK - 0.5;
    const key = ci + ',' + ri;
    if (key === '0,0') { marketBlock(lx0, lz0, lx1, lz1); continue; }
    if (key === '3,3') { industrialBlock(lx0, lz0, lx1, lz1); continue; }
    if (key === '1,3') { constructionBlock(lx0, lz0, lx1, lz1); continue; }
    if (key === '2,0') { parkBlock(lx0, lz0, lx1, lz1); continue; }
    // regular residential/commercial block, with plaza cut at center
    const nearPlaza = (ci === 1 || ci === 2) && (ri === 1 || ri === 2);
    const cutX = ci === 1 ? lx1 : lx0, cutZ = ri === 1 ? lz1 : lz0;
    const inCut = (ax0, az0, ax1, az1) => {
      if (!nearPlaza) return false;
      const cx0 = ci === 1 ? cutX - plazaR : cutX, cx1 = ci === 1 ? cutX : cutX + plazaR;
      const cz0 = ri === 1 ? cutZ - plazaR : cutZ, cz1 = ri === 1 ? cutZ : cutZ + plazaR;
      return ax1 > cx0 && ax0 < cx1 && az1 > cz0 && az0 < cz1;
    };
    const tall = nearPlaza ? 2 : 0;
    const placed = [];
    const tryB = (x0, z0, w, d, door) => {
      if (x0 < lx0 - 0.01 || z0 < lz0 - 0.01 || x0 + w > lx1 + 0.01 || z0 + d > lz1 + 0.01) return false;
      if (inCut(x0, z0, x0 + w, z0 + d)) return false;
      for (const p of placed) if (x0 < p[2] + 2 && x0 + w > p[0] - 2 && z0 < p[3] + 2 && z0 + d > p[1] - 2) return false;
      const r = rnd();
      const style = r < 0.58 ? 'plaster' : r < 0.88 ? 'brick' : 'concrete';
      const floors = 1 + ((rnd() * (3 + tall)) | 0) + (rnd() < 0.3 ? 1 : 0);
      building({ x0, z0, w, d, floors, style, doorSides: door, baseY: TOWN_H + 0.16 });
      placed.push([x0, z0, x0 + w, z0 + d]);
      return true;
    };
    // central tower next to plaza
    if (key === '2,2') {
      const t = building({ x0: lx0 + plazaR + 3, z0: lz0 + plazaR + 3, w: 18, d: 18, floors: 9, style: 'concrete', doorSides: ['S', 'W'], allWindows: true, baseY: TOWN_H + 0.16, hp: 360 });
      t.tower = true;
      placed.push([t.x0, t.z0, t.x1, t.z1]);
    }
    // south row facing street
    let x = lx0;
    while (x < lx1 - 8) {
      const w = pick([9, 12, 12, 15, 18]), d = pick([9, 12, 12, 15]);
      if (!tryB(x, lz0, Math.min(w, Math.floor((lx1 - x) / PW) * PW), d, ['S'])) x += 3; else x += w + (rnd() < 0.5 ? 3 : 5);
    }
    x = lx0;
    while (x < lx1 - 8) {
      const w = pick([9, 12, 12, 15, 18]), d = pick([9, 12, 12, 15]);
      if (!tryB(x, lz1 - d, Math.min(w, Math.floor((lx1 - x) / PW) * PW), d, ['N'])) x += 3; else x += w + (rnd() < 0.5 ? 3 : 5);
    }
    // side buildings
    let z = lz0 + 18;
    while (z < lz1 - 26) {
      const d = pick([9, 12, 15]), w = pick([9, 12]);
      tryB(lx0, z, w, d, ['W']); tryB(lx1 - w, z, w, d, ['E']);
      z += d + 4;
    }
    // courtyard clutter
    for (let c = 0; c < 5; c++) {
      const cx = lerp(lx0 + 16, lx1 - 16, rnd()), cz = lerp(lz0 + 18, lz1 - 18, rnd());
      if (inCut(cx - 2, cz - 2, cx + 2, cz + 2)) continue;
      let ok = true; for (const p of placed) if (cx > p[0] - 3 && cx < p[2] + 3 && cz > p[1] - 3 && cz < p[3] + 3) ok = false;
      if (!ok) continue;
      const r = rnd();
      if (r < 0.35) car(cx, cz, rnd() * Math.PI);
      else if (r < 0.6) crates(cx, cz);
      else if (r < 0.8) tree(cx, cz, 0.8 + rnd() * 0.4);
      else sandbags(cx, cz, 4.5, rnd() < 0.5);
    }
  }

  // plaza: fountain + statue, barricades
  {
    const y = TOWN_H;
    addBox(-5, y - 0.3, -5, 5, y + 0.6, -4.4, K.CONCRETE, MAT.CONCRETE, FULL, { color: 0xd8d0c0 });
    addBox(-5, y - 0.3, 4.4, 5, y + 0.6, 5, K.CONCRETE, MAT.CONCRETE, FULL, { color: 0xd8d0c0 });
    addBox(-5, y - 0.3, -4.4, -4.4, y + 0.6, 4.4, K.CONCRETE, MAT.CONCRETE, FULL, { color: 0xd8d0c0 });
    addBox(4.4, y - 0.3, -4.4, 5, y + 0.6, 4.4, K.CONCRETE, MAT.CONCRETE, FULL, { color: 0xd8d0c0 });
    addBox(-1.2, y - 0.3, -1.2, 1.2, y + 2.6, 1.2, K.CONCRETE, MAT.CONCRETE, FULL, { color: 0xcfc6b4 });
    prop('statue', 0, y + 2.6, 0, 0.6);
    prop('water', 0, y + 0.35, 0, 0, 8.8);
    for (const [bx, bz, ax] of [[-13, 8, 1], [12, -10, 1], [9, 14, 0], [-10, -14, 0], [16, 3, 0], [-17, -3, 0]]) barrier(bx, bz, ax);
    sandbags(-9, 18, 6, true); sandbags(10, -19, 6, true);
    car(19, -18, 0.3); car(-20, 17, 2.6);
  }
  // cars along streets
  for (let c = 0; c < 46; c++) {
    const alongX = rnd() < 0.5;
    if (alongX) { const z = pick(ZL), x = (rnd() - 0.5) * 340; if (Math.abs(x) < 26 && Math.abs(z) < 26) continue; car(x, z + (rnd() < 0.5 ? -1 : 1) * (streetW(z) / 2 - 1.6), (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 0.3, true); }
    else { const x = pick(XL), z = (rnd() - 0.5) * 300; if (Math.abs(x) < 26 && Math.abs(z) < 26) continue; car(x + (rnd() < 0.5 ? -1 : 1) * (streetW(x) / 2 - 1.6), z, Math.PI / 2 + (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 0.3, true); }
  }
  // street barricades
  for (let c = 0; c < 26; c++) {
    const x = pick(XL) + (rnd() - 0.5) * 6, z = (rnd() - 0.5) * 290;
    if (rnd() < 0.5) barrier(x, z, rnd() < 0.5 ? 1 : 0); else hesco(x, z);
  }

  function marketBlock(lx0, lz0, lx1, lz1) {
    const cx = (lx0 + lx1) / 2, cz = (lz0 + lz1) / 2;
    // perimeter low buildings with arcades
    building({ x0: lx0, z0: lz0, w: 15, d: 12, floors: 2, style: 'plaster', doorSides: ['N', 'S'], baseY: TOWN_H + 0.16 });
    building({ x0: lx1 - 18, z0: lz0, w: 18, d: 12, floors: 3, style: 'brick', doorSides: ['N', 'S'], baseY: TOWN_H + 0.16 });
    building({ x0: lx0, z0: lz1 - 12, w: 12, d: 12, floors: 2, style: 'plaster', doorSides: ['S', 'N'], baseY: TOWN_H + 0.16 });
    building({ x0: lx1 - 15, z0: lz1 - 15, w: 15, d: 15, floors: 3, style: 'plaster', doorSides: ['S', 'W'], baseY: TOWN_H + 0.16 });
    building({ x0: lx0 + 22, z0: lz1 - 9, w: 12, d: 9, floors: 1, style: 'brick', doorSides: ['S'], baseY: TOWN_H + 0.16 });
    // stalls grid
    for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue;
      if (rnd() < 0.15) continue;
      const sx = cx + i * 8, sz = cz + j * 8;
      addBox(sx - 1.6, TOWN_H, sz - 0.5, sx + 1.6, TOWN_H + 1.0, sz + 0.5, K.WOOD, MAT.WOOD, FULL, { color: 0xb08860 });
      prop('stall', sx, TOWN_H, sz, 0, 1, { c: pick([0xc0392b, 0x2e86c1, 0xd4ac0d, 0x239b56, 0xaf7ac5, 0xe67e22, 0xecf0f1]) });
    }
    crates(cx - 14, cz + 13); crates(cx + 15, cz - 12); car(cx + 17, cz + 6, 1.2); sandbags(cx - 4, cz - 15, 6, true);
    W.flagSpots.B = { x: cx, z: cz };
  }
  function industrialBlock(lx0, lz0, lx1, lz1) {
    const wh = building({ x0: lx0, z0: lz1 - 30, w: 36, d: 30, floors: 1, fh: 8, style: 'metal', doorSides: ['S', 'E'], bigDoor: true, noRoofProps: false, windows: 0.2, open: true, baseY: TOWN_H + 0.16, noStairs: false });
    wh.warehouse = true;
    building({ x0: lx1 - 12, z0: lz1 - 12, w: 12, d: 12, floors: 2, style: 'concrete', doorSides: ['S'], baseY: TOWN_H + 0.16 });
    const cols = [0x8e3b2f, 0x2f5d8e, 0x2f7a4a, 0xb07a2a, 0x6a6a6a, 0x8a2f5d, 0xd0a040, 0x3a7a8a];
    const cx = (lx0 + lx1) / 2, cz = (lz0 + lz1) / 2 - 8;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      if (rnd() < 0.2) continue;
      const x = lx0 + 4 + i * 15 + rnd() * 2, z = lz0 + 4 + j * 9;
      const h = 1 + (rnd() < 0.45 ? 1 : 0) + (rnd() < 0.15 ? 1 : 0);
      for (let k = 0; k < h; k++) container(x, z, TOWN_H + k * 2.6, true, pick(cols));
    }
    prop('crane2', lx1 - 6, TOWN_H, lz0 + 18, Math.PI / 2);
    crates(cx + 10, cz + 4); crates(cx - 8, cz - 2);
    for (let i = 0; i < 3; i++) prop('barrel', cx + rnd() * 10 - 5, TOWN_H, cz + rnd() * 6 - 3, 0, 1);
    W.flagSpots.D = { x: cx + 4, z: cz + 2 };
  }
  function constructionBlock(lx0, lz0, lx1, lz1) {
    // concrete skeleton: columns + slabs, partial walls
    const x0 = lx0 + 10, z0 = lz0 + 10, w = 30, d = 24, fl = 5, fh = 3.4;
    const by = TOWN_H + 0.16;
    const bi = W.buildings.length;
    W.buildings.push({ i: bi, x0, z0, x1: x0 + w, z1: z0 + d, by, floors: fl, fh, style: 'concrete', kind: K.CONCRETE, color: 0xb8b4aa, panels: [], boxes: [], rubble: [], collapsed: false, top: by + fl * fh, groundPanels: 0, skeleton: true });
    const sk = W.buildings[bi];
    for (let f = 0; f < fl; f++) {
      const yb = by + f * fh;
      for (let cx = 0; cx <= w; cx += 6) for (let cz = 0; cz <= d; cz += 6) {
        if (f === fl - 1 && rnd() < 0.4) continue;
        sk.boxes.push(addBox(x0 + cx - 0.3, yb, z0 + cz - 0.3, x0 + cx + 0.3, yb + fh - 0.3, z0 + cz + 0.3, K.CONCRETE, MAT.CONCRETE, FULL, { bld: bi, color: 0xb8b4aa }));
      }
      if (f < fl - 1 || true) {
        // slab with stair hole at west
        sk.boxes.push(addBox(x0 - 0.3 + 2.2, yb + fh - 0.3, z0 - 0.3, x0 + w + 0.3, yb + fh, z0 + d + 0.3, K.SLAB, MAT.CONCRETE, FULL, { bld: bi, color: 0xa8a49a }));
        sk.boxes.push(addBox(x0 - 0.3, yb + fh - 0.3, z0 + 9, x0 + 2.2, yb + fh, z0 + d + 0.3, K.SLAB, MAT.CONCRETE, FULL, { bld: bi, color: 0xa8a49a }));
      }
      const n = 13, rise = fh / n, dep = 6.2 / n;
      for (let k = 0; k < n; k++) { const top = yb + (k + 1) * rise; sk.boxes.push(addBox(x0 + 0.2, k === 0 ? yb : top - 0.3, z0 + 1 + k * dep, x0 + 1.9, top, z0 + 1 + (k + 1) * dep, K.STAIR, MAT.CONCRETE, FULL, { bld: bi, color: 0xa8a49c })); }
      if (f < 2) { // some brick infill
        for (let k = 0; k < 4; k++) if (rnd() < 0.6) sk.boxes.push(addBox(x0 + 6 + k * 6 + 0.3, yb, z0 - 0.1, x0 + 12 + k * 6 - 0.3, yb + (rnd() < 0.5 ? 1.2 : fh - 0.3), z0 + 0.2, K.BRICK, MAT.CONCRETE, FULL, { bld: bi, color: 0xffffff }));
      }
    }
    prop('crane', x0 + w + 8, by, z0 + d / 2, 0.6);
    for (let i = 0; i < 4; i++) crates(lx0 + 6 + rnd() * (lx1 - lx0 - 12), lz1 - 8 - rnd() * 8);
    for (let i = 0; i < 3; i++) prop('pipes', lx0 + 50 + rnd() * 10, TOWN_H, lz0 + 6 + i * 3, 0);
    addBox(lx0 + 46, TOWN_H, lz0 + 4, lx0 + 58, TOWN_H + 1.2, lz0 + 12, K.INVIS, MAT.METAL, F.SOLID | F.SHOOT);
    sandbags(x0 + w / 2, z0 + d + 6, 6, true);
    building({ x0: lx1 - 15, z0: lz1 - 12, w: 15, d: 12, floors: 3, style: 'brick', doorSides: ['S'], baseY: TOWN_H + 0.16 });
  }
  function parkBlock(lx0, lz0, lx1, lz1) {
    for (let i = 0; i < 22; i++) tree(lerp(lx0 + 3, lx1 - 3, rnd()), lerp(lz0 + 3, lz1 - 3, rnd()), 0.8 + rnd() * 0.6);
    for (let i = 0; i < 6; i++) prop('bench', lerp(lx0 + 6, lx1 - 6, rnd()), TOWN_H, lerp(lz0 + 6, lz1 - 6, rnd()), rnd() * 3);
    building({ x0: (lx0 + lx1) / 2 - 4.5, z0: (lz0 + lz1) / 2 - 4.5, w: 9, d: 9, floors: 1, style: 'brick', doorSides: ['N', 'S'], baseY: TOWN_H + 0.05 });
    sandbags((lx0 + lx1) / 2, lz1 - 6, 8, true);
    sandbags(lx0 + 8, (lz0 + lz1) / 2, 6, false);
  }

  // ---------------- props ----------------
  function container(x, z, y, alongX, color) {
    const L = 6.06, Wd = 2.44, H = 2.6;
    const hx = alongX ? L / 2 : Wd / 2, hz = alongX ? Wd / 2 : L / 2;
    const base = y ?? W.heightAt(x, z);
    addBox(x - hx, base, z - hz, x + hx, base + H, z + hz, K.CONTAINER, MAT.METAL, FULL, { color: color ?? 0x8e3b2f });
  }
  function sandbags(x, z, len, alongX) {
    const y = W.heightAt(x, z);
    const hx = alongX ? len / 2 : 0.45, hz = alongX ? 0.45 : len / 2;
    addBox(x - hx, y - 0.2, z - hz, x + hx, y + 1.05, z + hz, K.SANDBAG, MAT.SAND, FULL, { color: 0xffffff });
  }
  function barrier(x, z, alongX) {
    const y = W.heightAt(x, z);
    const hx = alongX ? 1.6 : 0.32, hz = alongX ? 0.32 : 1.6;
    addBox(x - hx, y - 0.1, z - hz, x + hx, y + 0.95, z + hz, K.BARRIER, MAT.CONCRETE, FULL, { color: 0xdedad2 });
  }
  function hesco(x, z) {
    const y = W.heightAt(x, z);
    addBox(x - 0.55, y - 0.1, z - 0.55, x + 0.55, y + 1.35, z + 0.55, K.HESCO, MAT.SAND, FULL, { color: 0xffffff });
  }
  function crates(x, z) {
    const y = W.heightAt(x, z);
    addBox(x - 0.6, y, z - 0.6, x + 0.6, y + 1.2, z + 0.6, K.WOOD, MAT.WOOD, FULL, { color: 0xc8a070 });
    if (rnd() < 0.7) addBox(x + 0.7, y, z - 0.5, x + 1.7, y + 1.0, z + 0.5, K.WOOD, MAT.WOOD, FULL, { color: 0xb89060 });
    if (rnd() < 0.5) addBox(x - 0.5, y + 1.2, z - 0.5, x + 0.5, y + 2.2, z + 0.5, K.WOOD, MAT.WOOD, FULL, { color: 0xa88050 });
  }
  function car(x, z, ry, street) {
    const y = street ? TOWN_H : W.heightAt(x, z);
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    const hx = 2.2 * c + 0.9 * s, hz = 2.2 * s + 0.9 * c;
    addBox(x - hx, y, z - hz, x + hx, y + 1.35, z + hz, K.INVIS, MAT.METAL, F.SOLID | F.SHOOT);
    prop('car', x, y, z, ry, 1, { c: pick([0x6b6b6b, 0x8a3a2a, 0x2a4a6a, 0xd8d4c8, 0x3a3a3a, 0x6a7a5a, 0xa08850, 0x4a2a2a]), burnt: rnd() < 0.4 });
  }
  function tree(x, z, s = 1) {
    const y = W.heightAt(x, z);
    addBox(x - 0.22 * s, y, z - 0.22 * s, x + 0.22 * s, y + 4.5 * s, z + 0.22 * s, K.INVIS, MAT.WOOD, F.SOLID | F.SHOOT);
    prop('tree', x, y, z, rnd() * 6.28, s, { v: (rnd() * 3) | 0 });
  }
  function rock(x, z, s) {
    const y = W.heightAt(x, z);
    addBox(x - s * 0.8, y - s * 0.4, z - s * 0.8, x + s * 0.8, y + s * 0.9, z + s * 0.8, K.INVIS, MAT.CONCRETE, F.SOLID | F.SHOOT);
    prop('rock', x, y, z, rnd() * 6.28, s);
  }

  // ---------------- farm (A) ----------------
  {
    const fx = -70, fz = -238;
    const b1 = building({ x0: fx - 26, z0: fz - 6, w: 15, d: 12, floors: 2, style: 'plaster', doorSides: ['E', 'S'], color: 0xd9c7a3 });
    const barn = building({ x0: fx + 8, z0: fz - 14, w: 18, d: 12, floors: 1, fh: 5.5, style: 'wood', doorSides: ['W', 'N'], bigDoor: true, open: true, noRoofProps: true });
    barn.barn = true;
    building({ x0: fx - 6, z0: fz + 14, w: 9, d: 9, floors: 1, style: 'brick', doorSides: ['S'] });
    // stone walls (destructible panels w/o building)
    const wall = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 3));
      for (let k = 0; k < n; k++) {
        const a = k / n, b = (k + 1) / n;
        const ax = lerp(x0, x1, a), az = lerp(z0, z1, a), bx = lerp(x0, x1, b), bz = lerp(z0, z1, b);
        const y = Math.min(W.heightAt(ax, az), W.heightAt(bx, bz));
        const pid = W.panels.length;
        const P = { i: pid, bld: -1, boxes: [], hp: 120, maxHp: 120, alive: true, floor: 0, side: 'X', type: 'wall' };
        W.panels.push(P);
        const t = 0.35;
        const id = x0 === x1 ? addBox(ax - t, y - 0.3, Math.min(az, bz), ax + t, y + 1.1, Math.max(az, bz), K.BRICK, MAT.CONCRETE, FULL, { panel: pid, color: 0xb8a890 })
          : addBox(Math.min(ax, bx), y - 0.3, az - t, Math.max(ax, bx), y + 1.1, az + t, K.BRICK, MAT.CONCRETE, FULL, { panel: pid, color: 0xb8a890 });
        P.boxes.push(id); P.cx = (ax + bx) / 2; P.cy = y + 0.5; P.cz = (az + bz) / 2; P.nx = 0; P.nz = 0;
      }
    };
    wall(fx - 40, fz - 30, fx + 38, fz - 30); wall(fx - 40, fz + 30, fx - 4, fz + 30); wall(fx + 10, fz + 30, fx + 38, fz + 30);
    wall(fx - 40, fz - 30, fx - 40, fz - 6); wall(fx - 40, fz + 6, fx - 40, fz + 30); wall(fx + 38, fz - 30, fx + 38, fz + 30);
    for (let i = 0; i < 7; i++) { const hx = fx - 10 + rnd() * 16, hz = fz - 22 + rnd() * 8; const y = W.heightAt(hx, hz); addBox(hx - 0.8, y, hz - 0.6, hx + 0.8, y + 1.2, hz + 0.6, K.INVIS, MAT.WOOD, F.SOLID | F.SHOOT); prop('hay', hx, y, hz, rnd() * 3); }
    prop('tractor', fx + 2, W.heightAt(fx + 2, fz + 4), fz + 4, 0.8);
    addBox(fx + 0.2, W.heightAt(fx + 2, fz + 4), fz + 2.4, fx + 3.8, W.heightAt(fx + 2, fz + 4) + 2.6, fz + 5.6, K.INVIS, MAT.METAL, F.SOLID | F.SHOOT);
    sandbags(fx - 4, fz - 6, 5, true); crates(fx + 30, fz + 18); car(fx - 30, fz + 18, 0.5);
    W.flagSpots.A = { x: fx - 2, z: fz + 2 };
    void b1;
  }
  // ---------------- rail depot (E) ----------------
  {
    const ex = 78, ez = 238;
    const st = building({ x0: ex - 34, z0: ez + 8, w: 24, d: 12, floors: 2, style: 'brick', doorSides: ['S', 'N'], color: 0xe0c8b8 });
    st.station = true;
    building({ x0: ex + 14, z0: ez + 10, w: 30, d: 18, floors: 1, fh: 7, style: 'metal', doorSides: ['S', 'W'], bigDoor: true, open: true, windows: 0.25 });
    // wagons on rails
    const wagonCols = [0x6a3020, 0x3a4a5a, 0x5a5a4a, 0x7a4a2a];
    for (let i = 0; i < 6; i++) {
      if (i === 2) continue;
      const wx = ex - 60 + i * 16, wz = 226 + (i % 2 ? 6 : 0);
      const y = W.heightAt(wx, wz) + 0.9;
      addBox(wx - 6.5, y, wz - 1.45, wx + 6.5, y + 3.0, wz + 1.45, K.CONTAINER, MAT.METAL, FULL, { color: pick(wagonCols) });
      prop('bogie', wx, y - 0.9, wz, 0, 1);
    }
    prop('watertower', ex - 6, W.heightAt(ex - 6, ez + 30), ez + 30, 0);
    addBox(ex - 8.5, W.heightAt(ex - 6, ez + 30), ez + 27.5, ex - 3.5, W.heightAt(ex - 6, ez + 30) + 3.5, ez + 32.5, K.INVIS, MAT.METAL, F.SOLID | F.SHOOT);
    for (let i = 0; i < 5; i++) container(ex - 20 + i * 7, ez - 20 + (i % 2) * 3, null, false, pick([0x8e3b2f, 0x2f5d8e, 0x2f7a4a, 0xb07a2a]));
    sandbags(ex, ez - 8, 6, true); sandbags(ex + 4, ez + 2, 5, false); crates(ex + 8, ez - 2); hesco(ex - 10, ez - 2); hesco(ex - 11.1, ez - 2);
    W.flagSpots.E = { x: ex + 2, z: ez - 4 };
  }
  // ---------------- HQs ----------------
  for (const [team, hz, dir] of [[1, -312, 1], [2, 312, -1]]) {
    const y = W.heightAt(0, hz);
    W.hq[team] = { x: 0, z: hz, y, dir, tank: { x: 12, z: hz + dir * 6, yaw: dir > 0 ? Math.PI : 0 } };
    for (let i = -3; i <= 3; i++) { if (i === 0) continue; hesco(i * 6, hz + dir * 18); hesco(i * 6 + 1.1, hz + dir * 18); }
    prop('tent', -14, W.heightAt(-14, hz - dir * 4), hz - dir * 4, 0, 1, { team });
    addBox(-17, W.heightAt(-14, hz - dir * 4), hz - dir * 4 - 2.5, -11, W.heightAt(-14, hz - dir * 4) + 2.6, hz - dir * 4 + 2.5, K.INVIS, MAT.WOOD, F.SOLID | F.SHOOT);
    prop('tent', -14, W.heightAt(-14, hz + dir * 6), hz + dir * 6, 0, 1, { team });
    addBox(-17, W.heightAt(-14, hz + dir * 6), hz + dir * 6 - 2.5, -11, W.heightAt(-14, hz + dir * 6) + 2.6, hz + dir * 6 + 2.5, K.INVIS, MAT.WOOD, F.SOLID | F.SHOOT);
    for (let i = 0; i < 4; i++) crates(-22 + i * 3, hz - dir * 10);
    prop('hqflag', 4, y, hz - dir * 2, 0, 1, { team });
  }

  // ---------------- countryside ----------------
  const nearRoad = (x, z, pad) => {
    for (const r of W.roads) for (let k = 0; k < r.pts.length - 1; k++) {
      const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1];
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
      const t = clamp(((x - ax) * vx + (z - az) * vz) / l2, 0, 1);
      if (Math.hypot(x - (ax + vx * t), z - (az + vz * t)) < r.w / 2 + pad) return true;
    }
    return false;
  };
  W.nearRoad = nearRoad;
  const blockedSpot = (x, z, r) => {
    if (townSd(x, z) < 6) return true;
    for (const f of flats) if (Math.hypot(x - f.x, z - f.z) < f.r - 4) return true;
    if (Math.abs(z) > 290 && Math.abs(x) < 30) return true;
    return nearRoad(x, z, r);
  };
  let trees = 0;
  for (let tries = 0; tries < 6000 && trees < 520; tries++) {
    const x = (rnd() - 0.5) * 980, z = (rnd() - 0.5) * 980;
    const inPlay = x > BOUNDS.minX - 30 && x < BOUNDS.maxX + 30 && z > BOUNDS.minZ - 30 && z < BOUNDS.maxZ + 30;
    const dens = fbm(n3, x * 0.006, z * 0.006, 2);
    if (dens < (inPlay ? 0.12 : -0.15)) continue;
    if (blockedSpot(x, z, 3)) continue;
    if (inPlay) tree(x, z, 0.85 + rnd() * 0.7);
    else { const y = W.heightAt(x, z); prop('tree', x, y, z, rnd() * 6.28, 1 + rnd() * 0.8, { v: (rnd() * 3) | 0 }); }
    trees++;
  }
  for (let i = 0; i < 90; i++) {
    const x = (rnd() - 0.5) * 520, z = (rnd() - 0.5) * 700;
    if (blockedSpot(x, z, 3)) continue;
    rock(x, z, 0.6 + rnd() * 1.4);
  }
  // hedgerows / bushes (visual)
  for (let i = 0; i < 260; i++) {
    const x = (rnd() - 0.5) * 520, z = (rnd() - 0.5) * 700;
    if (blockedSpot(x, z, 2)) continue;
    prop('bush', x, W.heightAt(x, z), z, rnd() * 6.28, 0.7 + rnd() * 0.8);
  }
  // field fortifications
  for (let i = 0; i < 34; i++) {
    const x = (rnd() - 0.5) * 420, z = (rnd() < 0.5 ? -1 : 1) * (180 + rnd() * 110);
    if (blockedSpot(x, z, 4)) continue;
    const r = rnd();
    if (r < 0.5) sandbags(x, z, 4 + rnd() * 3, rnd() < 0.5);
    else if (r < 0.7) car(x, z, rnd() * 6.28);
    else if (r < 0.85) { hesco(x, z); hesco(x + 1.1, z); hesco(x + 2.2, z); }
    else container(x, z, null, rnd() < 0.5, 0x5a6a4a);
  }
  // power line poles along the main road
  for (let z = -330; z <= 330; z += 32) if (Math.abs(z) > 170) prop('pole', 9, W.heightAt(9, z), z, 0);

  // ---------------- flags ----------------
  W.flagSpots.C = { x: 0, z: 0 };
  const flagDefs = [
    ['A', 'FARMSTEAD', 22], ['B', 'MARKET', 22], ['C', 'PLAZA', 20], ['D', 'FOUNDRY YARD', 22], ['E', 'RAIL DEPOT', 24],
  ];
  for (const [id, name, r] of flagDefs) {
    const s = W.flagSpots[id];
    W.flags.push({ id, name, x: s.x, z: s.z, y: W.heightAt(s.x, s.z), r });
  }

  // ---------------- collision grid ----------------
  buildGrid(W);
  W.stampArr = new Uint32Array(W.boxes.length + 1024);
  return W;
}

export function heightAt(W, x, z) {
  const fx = (x + HALF) / HRES, fz = (z + HALF) / HRES;
  let i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0) i = 0; if (j < 0) j = 0; if (i > HN - 2) i = HN - 2; if (j > HN - 2) j = HN - 2;
  const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1);
  const h = W.heights;
  const a = h[j * HN + i], b = h[j * HN + i + 1], c = h[(j + 1) * HN + i], d = h[(j + 1) * HN + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

export function normalAt(W, x, z, out = [0, 1, 0]) {
  const e = 1.0;
  const hx = heightAt(W, x + e, z) - heightAt(W, x - e, z);
  const hz = heightAt(W, x, z + e) - heightAt(W, x, z - e);
  const l = Math.hypot(hx, 2 * e, hz);
  out[0] = -hx / l; out[1] = 2 * e / l; out[2] = -hz / l;
  return out;
}

function cellIdx(x, z) {
  const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
  if (i < 0 || j < 0 || i >= GN || j >= GN) return -1;
  return j * GN + i;
}

export function buildGrid(W) {
  W.grid = new Array(GN * GN);
  for (const b of W.boxes) insertBox(W, b);
}
export function insertBox(W, b) {
  const i0 = clamp(Math.floor((b.x0 + HALF) / CELL), 0, GN - 1), i1 = clamp(Math.floor((b.x1 + HALF) / CELL), 0, GN - 1);
  const j0 = clamp(Math.floor((b.z0 + HALF) / CELL), 0, GN - 1), j1 = clamp(Math.floor((b.z1 + HALF) / CELL), 0, GN - 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * GN + i;
    (W.grid[k] || (W.grid[k] = [])).push(b.i);
  }
}

// Iterate active boxes overlapping an XZ rectangle and matching flag mask.
export function queryBoxes(W, x0, z0, x1, z1, mask, fn) {
  const st = ++W.stamp;
  const sa = W.stampArr;
  const i0 = clamp(Math.floor((x0 + HALF) / CELL), 0, GN - 1), i1 = clamp(Math.floor((x1 + HALF) / CELL), 0, GN - 1);
  const j0 = clamp(Math.floor((z0 + HALF) / CELL), 0, GN - 1), j1 = clamp(Math.floor((z1 + HALF) / CELL), 0, GN - 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = W.grid[j * GN + i];
    if (!c) continue;
    for (let n = 0; n < c.length; n++) {
      const id = c[n];
      if (sa[id] === st) continue;
      sa[id] = st;
      const b = W.boxes[id];
      if (!b.active || !(b.flags & mask)) continue;
      if (b.x1 < x0 || b.x0 > x1 || b.z1 < z0 || b.z0 > z1) continue;
      if (fn(b) === false) return;
    }
  }
}

const _rb = { axis: 0, sgn: 0 };
// Raycast against boxes (mask) and terrain. dir must be normalized.
export function raycast(W, ox, oy, oz, dx, dy, dz, maxT, mask = F.SHOOT, out = {}, ignoreTerrain = false) {
  let bestT = maxT, bestBox = -1, bAxis = 0, bSgn = 0;
  const idx = 1 / (dx || 1e-9), idy = 1 / (dy || 1e-9), idz = 1 / (dz || 1e-9);
  const st = ++W.stamp, sa = W.stampArr;
  // DDA over cells
  let cx = Math.floor((ox + HALF) / CELL), cz = Math.floor((oz + HALF) / CELL);
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const nextBX = (cx + (dx > 0 ? 1 : 0)) * CELL - HALF, nextBZ = (cz + (dz > 0 ? 1 : 0)) * CELL - HALF;
  let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : (nextBX - ox) / dx;
  let tMaxZ = Math.abs(dz) < 1e-9 ? Infinity : (nextBZ - oz) / dz;
  const tDX = Math.abs(dx) < 1e-9 ? Infinity : CELL / Math.abs(dx);
  const tDZ = Math.abs(dz) < 1e-9 ? Infinity : CELL / Math.abs(dz);
  let tCell = 0;
  for (let guard = 0; guard < 512; guard++) {
    if (cx >= 0 && cz >= 0 && cx < GN && cz < GN) {
      const c = W.grid[cz * GN + cx];
      if (c) for (let n = 0; n < c.length; n++) {
        const id = c[n];
        if (sa[id] === st) continue;
        sa[id] = st;
        const b = W.boxes[id];
        if (!b.active || !(b.flags & mask)) continue;
        const t = rayBox(ox, oy, oz, idx, idy, idz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, bestT, _rb);
        if (t >= 0 && t < bestT) { bestT = t; bestBox = id; bAxis = _rb.axis; bSgn = _rb.sgn; }
      }
    }
    const tNext = Math.min(tMaxX, tMaxZ);
    if (tNext > bestT || tNext > maxT) break;
    tCell = tNext;
    if (tMaxX < tMaxZ) { tMaxX += tDX; cx += stepX; } else { tMaxZ += tDZ; cz += stepZ; }
  }
  void tCell;
  out.box = bestBox; out.terrain = false;
  out.nx = 0; out.ny = 0; out.nz = 0;
  if (bestBox >= 0) {
    if (bAxis === 0) out.nx = bSgn; else if (bAxis === 1) out.ny = bSgn; else out.nz = bSgn;
  }
  // terrain
  if (!ignoreTerrain) {
    const tt = rayTerrain(W, ox, oy, oz, dx, dy, dz, bestT);
    if (tt >= 0 && tt < bestT) {
      bestT = tt; out.box = -1; out.terrain = true;
      const n = normalAt(W, ox + dx * tt, oz + dz * tt);
      out.nx = n[0]; out.ny = n[1]; out.nz = n[2];
    }
  }
  out.t = bestT;
  out.hit = out.box >= 0 || out.terrain;
  out.x = ox + dx * bestT; out.y = oy + dy * bestT; out.z = oz + dz * bestT;
  return out.hit ? bestT : -1;
}

export function rayTerrain(W, ox, oy, oz, dx, dy, dz, maxT) {
  let t = 0, prevT = 0;
  let h = heightAt(W, ox, oz);
  if (oy < h - 0.05) return 0;
  while (t < maxT) {
    const y = oy + dy * t;
    h = heightAt(W, ox + dx * t, oz + dz * t);
    const gap = y - h;
    if (gap <= 0) {
      let a = prevT, b = t;
      for (let k = 0; k < 8; k++) {
        const m = (a + b) / 2;
        if (oy + dy * m - heightAt(W, ox + dx * m, oz + dz * m) > 0) a = m; else b = m;
      }
      return b;
    }
    prevT = t;
    t += Math.max(0.4, Math.min(gap * 0.7, 8));
  }
  const y = oy + dy * maxT;
  if (y < heightAt(W, ox + dx * maxT, oz + dz * maxT)) return maxT;
  return -1;
}

// line of sight test (true if clear)
const _los = {};
export function los(W, ax, ay, az, bx, by, bz, mask = F.SOLID) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.01) return true;
  return raycast(W, ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, mask, _los) < 0;
}

// Does an AABB overlap any solid box?
export function overlapsSolid(W, x0, y0, z0, x1, y1, z1) {
  let hit = false;
  queryBoxes(W, x0, z0, x1, z1, F.SOLID, (b) => {
    if (b.y1 > y0 && b.y0 < y1) { hit = true; return false; }
  });
  return hit;
}

// ---------- destruction state helpers (used by both sides) ----------
export function destroyPanel(W, pid) {
  const P = W.panels[pid];
  if (!P || !P.alive) return false;
  P.alive = false; P.hp = 0;
  for (const b of P.boxes) W.boxes[b].active = false;
  return true;
}
export function breakGlass(W, bid) {
  const b = W.boxes[bid];
  if (!b || !b.active || !(b.flags & F.BREAK)) return false;
  b.active = false;
  return true;
}
export function collapseBuilding(W, bi) {
  const B = W.buildings[bi];
  if (!B || B.collapsed) return false;
  B.collapsed = true;
  for (const b of B.boxes) W.boxes[b].active = false;
  for (const p of B.panels) { W.panels[p].alive = false; }
  for (const r of B.rubble) W.boxes[r].active = true;
  return true;
}
export function shouldCollapse(W, bi) {
  const B = W.buildings[bi];
  if (!B || B.collapsed || B.skeleton) return false;
  let dead = 0, deadAll = 0;
  for (const p of B.panels) { const P = W.panels[p]; if (!P.alive) { deadAll++; if (P.floor === 0 && P.side !== 'I') dead++; } }
  return dead >= B.collapseAt || deadAll > B.panels.length * 0.62;
}
