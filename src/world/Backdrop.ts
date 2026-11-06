import * as THREE from 'three/webgpu';
import { attribute, mix, mx_noise_float, smoothstep, normalWorld, vec3, float } from 'three/tsl';
import type { WorldData } from '../data/WorldData';
import { U, absPos } from '../core/Uniforms';

/**
 * Distant backdrop: 72 x 72 km real-DEM terrain (Marin Headlands, Mt Tamalpais, Angel Island, East Bay
 * hills, the Peninsula). It also acts as the coarsest terrain LOD under San Francisco itself (sampled from
 * the city DEM there, lowered slightly so streamed tiles always draw on top).
 */
export async function buildBackdrop(world: WorldData, step: number): Promise<THREE.Mesh | null> {
  const r = await fetch('./data/backdrop.bin.png');
  if (!r.ok) return null;
  const raw = new Int16Array(await r.arrayBuffer());
  const N = Math.round(Math.sqrt(raw.length));
  const R = 36000, S = 120;
  const k = Math.max(1, Math.round(step / S));
  const n = Math.floor((N - 1) / k) + 1;
  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
  const g = world.meta.grid;
  const c = new THREE.Color();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -R + i * k * S, z = -R + j * k * S;
    let h = raw[j * k * N + i * k];
    const inGrid = world.inBounds(x, z, 30);
    let urban = false;
    if (inGrid) { h = world.heightAt(x, z) - 4; urban = world.surfaceAt(x, z) === 0; }
    else if (h > 0 && h < 70 && (x > 5000 || z > 9000)) urban = true; // East Bay / Peninsula flats
    if (!inGrid && h <= 0) h = Math.min(h, -6);
    const o = (j * n + i) * 3;
    pos[o] = x; pos[o + 1] = h; pos[o + 2] = z;
    if (urban) c.setRGB(0.36, 0.35, 0.34);
    else if (h > 250) c.setRGB(0.24, 0.29, 0.16);
    else c.setRGB(0.48, 0.44, 0.27); // California golden grassland
    col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let p = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
    idx[p++] = a; idx[p++] = cc; idx[p++] = b; idx[p++] = b; idx[p++] = cc; idx[p++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95 });
  const vc: any = attribute('color', 'vec3');
  const nz: any = mx_noise_float(absPos.xz.mul(0.0011)).mul(0.5).add(0.5);
  const nf: any = mx_noise_float(absPos.xz.mul(0.006)).mul(0.5).add(0.5);
  const greenery = vec3(0.17, 0.24, 0.12);
  let colr: any = mix(vc, greenery, smoothstep(0.55, 0.8, nz).mul(0.7));
  colr = mix(colr, vec3(0.42, 0.38, 0.33), smoothstep(0.25, 0.5, normalWorld.y.oneMinus()).mul(0.5));
  m.colorNode = colr.mul(mix(0.85, 1.1, nf)).mul(mix(float(1), float(0.65), U.wet));
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = false; mesh.castShadow = false;
  mesh.renderOrder = -2;
  void g;
  return mesh;
}
