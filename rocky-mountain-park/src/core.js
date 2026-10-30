// Renderer, scene, quality tiers, shared uniforms and world-grid queries.
import * as THREE from 'three';
import { clamp, SIZE, HALF, N, CELL, BASE, TR, TCELL, LAKES } from './shared.js';

export const $ = (id) => document.getElementById(id);
export const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 && !matchMedia('(pointer: fine)').matches;
export const dpr = window.devicePixelRatio || 1;

export const canvas = $('c');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.25, 26000);
camera.rotation.order = 'YXZ';

// quality tiers; 'ultra' adds MSAA, god rays and wider vegetation radii
export const QUALITY = {
  low: { pr: Math.min(dpr, 1), shadow: 0, grass: 14000, grassR: 28, flowers: 4500, flowerR: 26, treeHi: 170, treeLo: 2800, imp: 2600, rockR: 240, lod: 0.6, reflect: false, post: 0, msaa: 0, normals: false },
  medium: { pr: Math.min(dpr, 1.35), shadow: 1024, grass: 26000, grassR: 36, flowers: 9000, flowerR: 34, treeHi: 230, treeLo: 3800, imp: 3600, rockR: 360, lod: 0.85, reflect: false, post: 1, msaa: 0, normals: true },
  high: { pr: Math.min(dpr, 1.75), shadow: 2048, grass: 46000, grassR: 48, flowers: 16000, flowerR: 44, treeHi: 330, treeLo: 5600, imp: 5600, rockR: 520, lod: 1.0, reflect: true, post: 2, msaa: 4, normals: true },
  ultra: { pr: Math.min(dpr, 2), shadow: 4096, grass: 64000, grassR: 58, flowers: 22000, flowerR: 52, treeHi: 420, treeLo: 7000, imp: 7000, rockR: 640, lod: 1.25, reflect: true, post: 3, msaa: 4, normals: true },
};
export const Qs = { name: isTouch ? 'medium' : 'high' };
export const Q = () => QUALITY[Qs.name];

export const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
export const hex = (h) => new THREE.Color(h);

// uniforms shared by every custom shader and patched material
export const U = {
  time: { value: 0 }, sunDir: { value: new THREE.Vector3(0.3, 0.8, 0.3).normalize() }, lightDir: { value: new THREE.Vector3(0, 1, 0) },
  sunCol: { value: new THREE.Color() }, skyAmb: { value: new THREE.Color() }, sunTint: { value: new THREE.Color() },
  zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() },
  fogDen: { value: 9e-5 }, mist: { value: 0 }, night: { value: 0 }, storm: { value: 0 }, wet: { value: 0 }, flash: { value: 0 },
  cloudCov: { value: 0.42 }, cam: { value: new THREE.Vector2() }, player: { value: new THREE.Vector3() },
  treeHi: { value: 330 }, treeLo: { value: 5600 }, impFar: { value: 5600 },
  skyLUT: { value: null }, sunVis: { value: null }, extra: { value: null },
  heightTex: { value: null }, biomeTex: { value: null }, trailTex: { value: null },
};
export const GRID = { uHalf: { value: HALF }, uCell: { value: CELL }, uN: { value: N }, uSize: { value: SIZE }, uBase: { value: BASE } };

// world grids (filled from the worker)
export const G = {};
export const bridges = [];
export function heightAt(x, z) {
  const H = G.H;
  let gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
  gx = gx < 0 ? 0 : gx > N - 1.0001 ? N - 1.0001 : gx; gz = gz < 0 ? 0 : gz > N - 1.0001 ? N - 1.0001 : gz;
  const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, k = j * N + i;
  const a = H[k], b = H[k + 1], c = H[k + N], d = H[k + N + 1];
  return (fx + fz <= 1) ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
export const cellOf = (x, z) => clamp(Math.round((z + HALF) / CELL), 0, N - 1) * N + clamp(Math.round((x + HALF) / CELL), 0, N - 1);
export const trailAt = (x, z) => clamp(Math.floor((z + HALF) / TCELL), 0, TR - 1) * TR + clamp(Math.floor((x + HALF) / TCELL), 0, TR - 1);
export function groundAt(x, z) {
  let h = heightAt(x, z);
  for (const b of bridges) {
    const dx = b.bx - b.ax, dz = b.bz - b.az, l2 = dx * dx + dz * dz; let t = ((x - b.ax) * dx + (z - b.az) * dz) / l2;
    if (t < -0.02 || t > 1.02) continue; t = clamp(t, 0, 1);
    if (Math.hypot(x - b.ax - dx * t, z - b.az - dz * t) < 1.25) h = Math.max(h, b.y);
  }
  return h;
}
export function waterAt(x, z) {
  const k = cellOf(x, z);
  if (G.LKD[k] < 0) return LAKES[G.LKID[k]].level;
  if (G.CHD[k] < 0) return G.CHL[k];
  return null;
}
export function surfaceAt(x, z) {
  const k = cellOf(x, z), w = waterAt(x, z), h = heightAt(x, z);
  if (w !== null && w > h + 0.05) return 'water';
  if (G.TRL[trailAt(x, z)] > 110) return 'dirt';
  const s = 1 - G.NRM[k * 3 + 1], e = h + BASE;
  if (e > 3800 || s > 0.45) return 'rock';
  if (G.BIO[k * 4] > 120) return 'forest';
  return 'grass';
}
