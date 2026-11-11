// Procedural, tileable PBR textures generated at load time (no external assets).
// Each material = albedo (RGB + roughness in A) and normal (RGB + AO in A).
import * as THREE from 'three';
import { mulberry32 } from '../shared/math.js';

function makeLattice(seed) {
  const r = mulberry32(seed);
  const g = new Float32Array(256 * 256);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return g;
}
const LAT = makeLattice(9917), LAT2 = makeLattice(424242);
const sm = (t) => t * t * (3 - 2 * t);
// tileable value noise: x,y in [0,1), period integer power of two
function vnoise(L, x, y, per) {
  const X = x * per, Y = y * per;
  const xi = Math.floor(X), yi = Math.floor(Y);
  const fx = sm(X - xi), fy = sm(Y - yi);
  const m = per - 1;
  const x0 = xi & m, x1 = (xi + 1) & m, y0 = yi & m, y1 = (yi + 1) & m;
  const a = L[(y0 << 8) | x0], b = L[(y0 << 8) | x1], c = L[(y1 << 8) | x0], d = L[(y1 << 8) | x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
function fbm(L, x, y, per, oct = 4, gain = 0.5) {
  let s = 0, a = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += vnoise(L, x, y, per << o) * a; n += a; a *= gain; }
  return s / n;
}
// tileable cellular noise (F1 distance, cell id)
function cell(x, y, per, seed = 0) {
  const X = x * per, Y = y * per;
  const xi = Math.floor(X), yi = Math.floor(Y);
  let best = 9, id = 0, second = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = (xi + i), cy = (yi + j);
    const wx = ((cx % per) + per) % per, wy = ((cy % per) + per) % per;
    const h = ((wy * 73 + wx * 151 + seed * 37) & 255);
    const px = cx + LAT[(h << 8) | ((wx * 13) & 255)], py = cy + LAT2[(h << 8) | ((wy * 7) & 255)];
    const d = (px - X) ** 2 + (py - Y) ** 2;
    if (d < best) { second = best; best = d; id = LAT[(wy << 8) | wx]; } else if (d < second) second = d;
  }
  return [Math.sqrt(best), id, Math.sqrt(second) - Math.sqrt(best)];
}

function pack(S, col, rough, height, strength, ao) {
  const alb = new Uint8Array(S * S * 4), nor = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    alb[i * 4] = Math.min(255, Math.max(0, col[i * 3] * 255));
    alb[i * 4 + 1] = Math.min(255, Math.max(0, col[i * 3 + 1] * 255));
    alb[i * 4 + 2] = Math.min(255, Math.max(0, col[i * 3 + 2] * 255));
    alb[i * 4 + 3] = Math.min(255, Math.max(0, rough[i] * 255));
    const l = height[y * S + ((x - 1 + S) % S)], r = height[y * S + ((x + 1) % S)];
    const u = height[((y - 1 + S) % S) * S + x], d = height[((y + 1) % S) * S + x];
    let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    nor[i * 4] = (nx * 0.5 + 0.5) * 255; nor[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; nor[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
    nor[i * 4 + 3] = (ao ? ao[i] : 1) * 255;
  }
  return { alb, nor };
}

function toTex(data, S, srgb, aniso) {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const GENS = {
  grass(S, col, rough, h) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const n = fbm(LAT, u, v, 8, 5), n2 = fbm(LAT2, u, v, 32, 3), blades = vnoise(LAT, u * 1.0, v * 0.25, 128) * vnoise(LAT2, u, v, 64);
      const dry = Math.max(0, fbm(LAT2, u + 0.3, v, 4, 3) - 0.45) * 2.2;
      let r = 0.20 + n * 0.10 + dry * 0.22, g = 0.30 + n * 0.14 + dry * 0.10, b = 0.10 + n * 0.04 + dry * 0.02;
      const k = 0.65 + blades * 0.55 + n2 * 0.25;
      col[i * 3] = r * k; col[i * 3 + 1] = g * k; col[i * 3 + 2] = b * k;
      rough[i] = 0.92 - blades * 0.1;
      h[i] = blades * 0.7 + n2 * 0.3;
    }
  },
  dirt(S, col, rough, h) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const n = fbm(LAT, u, v, 4, 6), c = cell(u, v, 24, 3), c2 = cell(u, v, 64, 5);
      const peb = Math.max(0, 1 - c[0] * 3.2) * (c[1] > 0.55 ? 1 : 0);
      const peb2 = Math.max(0, 1 - c2[0] * 2.6) * (c2[1] > 0.7 ? 0.6 : 0);
      const base = 0.75 + n * 0.5;
      col[i * 3] = (0.34 * base + peb * 0.12 + peb2 * 0.08); col[i * 3 + 1] = (0.26 * base + peb * 0.10 + peb2 * 0.07); col[i * 3 + 2] = (0.18 * base + peb * 0.08 + peb2 * 0.06);
      rough[i] = 0.95 - peb * 0.25;
      h[i] = n * 0.5 + peb * 0.6 + peb2 * 0.3;
    }
  },
  rock(S, col, rough, h) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const n = fbm(LAT, u, v, 4, 6, 0.55), c = cell(u, v, 8, 9);
      const strata = Math.sin((v + n * 0.15) * Math.PI * 24) * 0.5 + 0.5;
      const crack = Math.min(1, c[2] * 8);
      const base = 0.42 + n * 0.25 + strata * 0.06;
      col[i * 3] = base * 0.98 * (0.6 + 0.4 * crack); col[i * 3 + 1] = base * 0.94 * (0.6 + 0.4 * crack); col[i * 3 + 2] = base * 0.88 * (0.6 + 0.4 * crack);
      rough[i] = 0.8 + n * 0.15;
      h[i] = n * 0.7 + crack * 0.4 + strata * 0.1;
    }
  },
  asphalt(S, col, rough, h) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const n = fbm(LAT, u, v, 4, 5), agg = vnoise(LAT2, u, v, 256), c = cell(u, v, 3, 11);
      const crack = c[2] < 0.025 && fbm(LAT2, u, v, 8, 2) > 0.5 ? 1 : 0;
      const patch = fbm(LAT2, u + 0.5, v + 0.2, 2, 3) > 0.62 ? 0.06 : 0;
      const b = 0.16 + n * 0.08 + (agg > 0.82 ? 0.12 : agg < 0.12 ? -0.04 : 0) - patch - crack * 0.1;
      col[i * 3] = b; col[i * 3 + 1] = b * 0.99; col[i * 3 + 2] = b * 0.97;
      rough[i] = 0.82 + n * 0.12 - patch * 1.5;
      h[i] = agg * 0.4 + n * 0.3 - crack * 0.8;
    }
  },
  plaster(S, col, rough, h) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const n = fbm(LAT, u, v, 8, 6, 0.55), fine = vnoise(LAT2, u, v, 256);
      const stain = Math.max(0, fbm(LAT2, u, v * 0.5, 2, 4) - 0.5) * 1.6;
      const streak = Math.max(0, vnoise(LAT, u, v * 0.05, 32) - 0.6) * 1.2;
      const chip = fbm(LAT, u + 0.7, v + 0.1, 4, 4) > 0.71 ? 1 : 0;
      const b = 0.86 + n * 0.1 - stain * 0.22 - streak * 0.18 - chip * 0.18;
      col[i * 3] = b; col[i * 3 + 1] = b * 0.98; col[i * 3 + 2] = b * (0.95 - chip * 0.06);
      rough[i] = 0.9;
      h[i] = n * 0.4 + fine * 0.2 - chip * 0.6;
    }
  },
  brick(S, col, rough, h) {
    const rows = 16, cols = 8;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const row = Math.floor(v * rows);
      const uu = u * cols + (row % 2) * 0.5;
      const bc = Math.floor(uu), fu = uu - bc, fv = v * rows - row;
      const mortar = fu < 0.05 || fu > 0.95 || fv < 0.08 || fv > 0.92;
      const id = LAT[((row & 255) << 8) | ((bc % cols + cols) % cols * 31 & 255)];
      const n = fbm(LAT, u, v, 16, 4), fine = vnoise(LAT2, u, v, 256);
      let r, g, b, hh;
      if (mortar) { r = 0.62 + n * 0.1; g = 0.6 + n * 0.1; b = 0.56 + n * 0.1; hh = 0.1; }
      else {
        const t = 0.75 + id * 0.35 + n * 0.25;
        r = 0.55 * t; g = 0.27 * t; b = 0.18 * t;
        if (id > 0.85) { r *= 0.7; g *= 0.7; b *= 0.75; }
        hh = 0.7 + fine * 0.2 + n * 0.1;
      }
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      rough[i] = mortar ? 0.95 : 0.85;
      h[i] = hh;
    }
  },
  concrete(S, col, rough, h) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const n = fbm(LAT, u, v, 4, 6, 0.55), fine = vnoise(LAT2, u, v, 256), pore = vnoise(LAT, u, v, 128);
      const form = (Math.abs((v * 4) % 1 - 0.5) > 0.49 || Math.abs((u * 2) % 1 - 0.5) > 0.495) ? 1 : 0;
      const stain = Math.max(0, fbm(LAT2, u, v, 2, 4) - 0.55) * 1.5;
      const b = 0.62 + n * 0.16 - stain * 0.18 - form * 0.08 - (pore > 0.86 ? 0.15 : 0);
      col[i * 3] = b; col[i * 3 + 1] = b * 0.99; col[i * 3 + 2] = b * 0.96;
      rough[i] = 0.88;
      h[i] = n * 0.4 + fine * 0.15 - form * 0.3 - (pore > 0.86 ? 0.4 : 0);
    }
  },
  metal(S, col, rough, h) { // corrugated, tintable, with rust
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const rib = Math.sin(u * Math.PI * 2 * 16);
      const ribH = rib > 0.3 ? 1 : rib < -0.3 ? 0 : (rib + 0.3) / 0.6;
      const n = fbm(LAT, u, v, 4, 5);
      const rust = Math.max(0, fbm(LAT2, u, v, 4, 5) - 0.58) * 3.0 + Math.max(0, vnoise(LAT, u, v * 0.1, 16) - 0.7) * 1.5 * (1 - v);
      const scratch = vnoise(LAT2, u * 0.2, v, 256) > 0.93 ? 0.2 : 0;
      const k = 0.82 + n * 0.14 + scratch;
      const rr = Math.min(1, rust);
      col[i * 3] = k * (1 - rr) + 0.42 * rr; col[i * 3 + 1] = k * (1 - rr) + 0.22 * rr; col[i * 3 + 2] = k * (1 - rr) + 0.12 * rr;
      rough[i] = 0.5 + rr * 0.45 + n * 0.1;
      h[i] = ribH * 0.9 + rr * 0.1;
    }
  },
  wood(S, col, rough, h) {
    const planks = 8;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const p = Math.floor(u * planks), fu = u * planks - p;
      const seam = fu < 0.03 || fu > 0.97;
      const id = LAT[(p * 37) & 255];
      const grain = Math.sin((v * 40 + fbm(LAT, u, v, 4, 4) * 6 + id * 10) * Math.PI) * 0.5 + 0.5;
      const n = fbm(LAT2, u, v, 8, 4);
      const t = (0.55 + id * 0.3) * (0.8 + grain * 0.2 + n * 0.2) * (seam ? 0.4 : 1);
      col[i * 3] = 0.52 * t; col[i * 3 + 1] = 0.38 * t; col[i * 3 + 2] = 0.24 * t;
      rough[i] = 0.8;
      h[i] = seam ? 0 : 0.6 + grain * 0.2;
    }
  },
  sandbag(S, col, rough, h) {
    const rows = 4, cols = 2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const row = Math.floor(v * rows);
      const uu = u * cols + (row % 2) * 0.5, fu = uu - Math.floor(uu), fv = v * rows - row;
      const bulge = Math.sin(fu * Math.PI) ** 0.6 * Math.sin(fv * Math.PI) ** 0.6;
      const weave = (Math.sin(u * S * 0.9) * Math.sin(v * S * 0.9)) * 0.5 + 0.5;
      const n = fbm(LAT, u, v, 8, 4);
      const t = (0.62 + n * 0.25) * (0.55 + bulge * 0.45);
      col[i * 3] = 0.66 * t + weave * 0.03; col[i * 3 + 1] = 0.58 * t + weave * 0.03; col[i * 3 + 2] = 0.42 * t + weave * 0.02;
      rough[i] = 0.95;
      h[i] = bulge + weave * 0.05;
    }
  },
  hesco(S, col, rough, h) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const gx = Math.abs(((u * 6) % 1) - 0.5) > 0.46, gy = Math.abs(((v * 6) % 1) - 0.5) > 0.46;
      const wire = gx || gy;
      const n = fbm(LAT, u, v, 8, 4);
      const t = 0.6 + n * 0.3;
      if (wire) { col[i * 3] = 0.45; col[i * 3 + 1] = 0.45; col[i * 3 + 2] = 0.42; rough[i] = 0.45; h[i] = 1; }
      else { col[i * 3] = 0.62 * t; col[i * 3 + 1] = 0.56 * t; col[i * 3 + 2] = 0.42 * t; rough[i] = 0.95; h[i] = 0.3 + n * 0.2; }
    }
  },
  paving(S, col, rough, h) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const fu = (u * 8) % 1, fv = (v * 8 + (Math.floor(u * 8) % 2) * 0.5) % 1;
      const joint = fu < 0.04 || fv < 0.04;
      const n = fbm(LAT, u, v, 8, 4), id = LAT[((Math.floor(u * 8) * 9 + Math.floor(v * 8 + (Math.floor(u * 8) % 2) * 0.5) * 17) & 255) << 8];
      const t = 0.62 + n * 0.18 + id * 0.1 - (joint ? 0.25 : 0);
      col[i * 3] = t; col[i * 3 + 1] = t * 0.97; col[i * 3 + 2] = t * 0.92;
      rough[i] = 0.85;
      h[i] = joint ? 0 : 0.6 + n * 0.2;
    }
  },
  rubble(S, col, rough, h) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const c = cell(u, v, 10, 21), c2 = cell(u, v, 30, 23), n = fbm(LAT, u, v, 8, 4);
      const chunk = 1 - c[0] * 1.4, chunk2 = 1 - c2[0] * 1.6;
      const t = 0.42 + c[1] * 0.3 + n * 0.15;
      const brick = c[1] > 0.75;
      col[i * 3] = brick ? t * 0.9 : t; col[i * 3 + 1] = brick ? t * 0.5 : t * 0.97; col[i * 3 + 2] = brick ? t * 0.38 : t * 0.92;
      rough[i] = 0.95;
      h[i] = chunk * 0.7 + chunk2 * 0.3;
    }
  },
  roof(S, col, rough, h) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const g = vnoise(LAT, u, v, 256), n = fbm(LAT2, u, v, 4, 5);
      const puddle = fbm(LAT, u + 0.3, v + 0.6, 2, 3) > 0.64;
      const t = 0.34 + g * 0.18 + n * 0.12 - (puddle ? 0.08 : 0);
      col[i * 3] = t; col[i * 3 + 1] = t * 0.98; col[i * 3 + 2] = t * 0.95;
      rough[i] = puddle ? 0.35 : 0.92;
      h[i] = puddle ? 0.2 : g * 0.6 + n * 0.3;
    }
  },
  gravel(S, col, rough, h) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const c = cell(u, v, 48, 31), n = fbm(LAT, u, v, 4, 4);
      const st = Math.max(0, 1 - c[0] * 2.2);
      const t = 0.42 + c[1] * 0.25 + n * 0.12;
      col[i * 3] = t * (0.92 + st * 0.1); col[i * 3 + 1] = t * 0.88; col[i * 3 + 2] = t * 0.8;
      rough[i] = 0.9;
      h[i] = st;
    }
  },
};

export const TEX_LIST = Object.keys(GENS);
const NSTR = { grass: 2.5, dirt: 3, rock: 5, asphalt: 2, plaster: 2, brick: 4, concrete: 2.5, metal: 6, wood: 3, sandbag: 4, hesco: 3, paving: 3, rubble: 6, roof: 2, gravel: 4 };

export function generateTextures(size, aniso, onProgress) {
  const out = {};
  const S = size;
  const col = new Float32Array(S * S * 3), rough = new Float32Array(S * S), h = new Float32Array(S * S);
  let k = 0;
  for (const name of TEX_LIST) {
    GENS[name](S, col, rough, h);
    const p = pack(S, col, rough, h, NSTR[name] * (S / 256), null);
    out[name] = { map: toTex(p.alb, S, true, aniso), normal: toTex(p.nor, S, false, aniso) };
    k++;
    if (onProgress) onProgress(k / TEX_LIST.length, name);
  }
  return out;
}

// ---------- canvas sprites (particles, decals) ----------
function canvasTex(S, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  draw(g, S);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
export function spriteTextures() {
  const smoke = canvasTex(128, (g, S) => {
    // 2x2 atlas of soft noisy puffs
    for (let q = 0; q < 4; q++) {
      const ox = (q % 2) * S / 2, oy = Math.floor(q / 2) * S / 2, R = S / 4;
      const img = g.createImageData(S / 2, S / 2);
      for (let y = 0; y < S / 2; y++) for (let x = 0; x < S / 2; x++) {
        const dx = (x - R) / R, dy = (y - R) / R;
        const d = Math.sqrt(dx * dx + dy * dy);
        const n = fbm(LAT, x / (S / 2) + q * 0.25, y / (S / 2), 4, 4);
        let a = Math.max(0, 1 - d) ** 1.5 * (0.45 + n * 0.9);
        a = Math.max(0, Math.min(1, a * 1.3 - 0.08 * (1 - d)));
        const i = (y * S / 2 + x) * 4;
        const shade = 200 + n * 55 - dy * 30;
        img.data[i] = shade; img.data[i + 1] = shade; img.data[i + 2] = shade; img.data[i + 3] = a * 255;
      }
      g.putImageData(img, ox, oy);
    }
  });
  const flare = canvasTex(64, (g, S) => {
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,240,200,0.9)'); gr.addColorStop(0.5, 'rgba(255,160,60,0.35)'); gr.addColorStop(1, 'rgba(255,100,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  });
  const fire = canvasTex(128, (g, S) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = fbm(LAT2, x / S, y / S, 4, 5);
      const a = Math.max(0, 1 - d * (0.8 + n * 0.6)) ** 1.2;
      const i = (y * S + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 160 + n * 95; img.data[i + 2] = 60 + n * 80; img.data[i + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
  });
  const muzzle = canvasTex(128, (g, S) => {
    g.translate(S / 2, S / 2);
    for (let k = 0; k < 7; k++) {
      g.rotate(Math.PI * 2 / 7 + (k % 2) * 0.2);
      const gr = g.createLinearGradient(0, 0, S / 2, 0);
      gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.4, 'rgba(255,190,90,0.7)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, -S * 0.05); g.lineTo(S * (0.38 + (k % 3) * 0.04), 0); g.lineTo(0, S * 0.05); g.fill();
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.25);
    gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(1, 'rgba(255,180,80,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, S * 0.25, 0, 7); g.fill();
  });
  const hole = canvasTex(64, (g, S) => {
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(10,8,6,1)'); gr.addColorStop(0.18, 'rgba(20,16,12,0.95)'); gr.addColorStop(0.35, 'rgba(60,55,50,0.6)'); gr.addColorStop(1, 'rgba(80,75,70,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(30,25,20,0.5)'; g.lineWidth = 1;
    for (let k = 0; k < 6; k++) { const a = Math.random() * 6.28; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + Math.cos(a) * S * 0.35, S / 2 + Math.sin(a) * S * 0.35); g.stroke(); }
  });
  const scorch = canvasTex(128, (g, S) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = fbm(LAT, x / S, y / S, 4, 5);
      const a = Math.max(0, 1 - d * (0.7 + n * 0.6)) ** 0.8;
      const i = (y * S + x) * 4;
      img.data[i] = 12; img.data[i + 1] = 10; img.data[i + 2] = 8; img.data[i + 3] = Math.min(255, a * 270);
    }
    g.putImageData(img, 0, 0);
  });
  const blood = canvasTex(64, (g, S) => {
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * 6.28, r = Math.random() * S * 0.3;
      g.fillStyle = `rgba(${110 + Math.random() * 40},10,8,${0.5 + Math.random() * 0.5})`;
      g.beginPath(); g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, S * (0.05 + Math.random() * 0.12), 0, 7); g.fill();
    }
  });
  const spark = canvasTex(32, (g, S) => {
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,220,150,0.8)'); gr.addColorStop(1, 'rgba(255,150,50,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  });
  const shock = canvasTex(128, (g, S) => {
    const gr = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,240,220,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  });
  return { smoke, flare, fire, muzzle, hole, scorch, blood, spark, shock };
}

// macro variation noise (non-tiling look), single channel in RGBA
export function macroTexture(S = 256) {
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    d[i] = fbm(LAT, x / S, y / S, 4, 5) * 255;
    d[i + 1] = fbm(LAT2, x / S, y / S, 8, 4) * 255;
    d[i + 2] = vnoise(LAT, x / S, y / S, 64) * 255;
    d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export async function generateTexturesAsync(size, aniso, onProgress) {
  const out = {};
  const S = size;
  const col = new Float32Array(S * S * 3), rough = new Float32Array(S * S), h = new Float32Array(S * S);
  let k = 0;
  for (const name of TEX_LIST) {
    GENS[name](S, col, rough, h);
    const p = pack(S, col, rough, h, NSTR[name] * (S / 256), null);
    out[name] = { map: toTex(p.alb, S, true, aniso), normal: toTex(p.nor, S, false, aniso) };
    k++;
    if (onProgress) onProgress(k / TEX_LIST.length, name);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}
