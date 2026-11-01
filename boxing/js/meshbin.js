import * as THREE from 'three';

export function b64ToBuffer(b64) {
  const bin = atob(b64), n = bin.length, u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

// Loads the compact binary meshes produced by tools/gen-body.mjs
export async function loadMeshBin(base) {
  const meta = await fetch(base + '.json').then(r => r.json());
  const buf = b64ToBuffer(meta.b64); delete meta.b64;
  const L = Object.fromEntries(meta.layout.map(l => [l.name, l]));
  const n = meta.vertexCount;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, L.position.offset, n * 3), 3));
  const nb = new THREE.InterleavedBuffer(new Int8Array(buf, L.normal.offset, n * 4), 4);
  geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(nb, 3, 0, true));
  const ao = new Uint8Array(buf, L.ao.offset, n);
  geo.userData.ao = ao;
  if (meta.skinned) {
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(buf, L.skinIndex.offset, n * 4), 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Uint8Array(buf, L.skinWeight.offset, n * 4), 4, true));
  }
  const ic = meta.indexCount;
  const idx = meta.index32 ? new Uint32Array(buf, L.index.offset, ic) : new Uint16Array(buf, L.index.offset, ic);
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  for (const g of meta.groups) geo.addGroup(g.start, g.count, g.mat);
  geo.userData.groups = meta.groups;
  geo.userData.meta = meta;
  return geo;
}

// bake AO (+ a warm crevice tint) into vertex colours
export function bakeColors(geo, crevice = [0.62, 0.36, 0.3], strength = 1) {
  const ao = geo.userData.ao, n = ao.length;
  const col = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    let a = ao[i] / 255;
    a = 1 - (1 - a) * strength;
    const t = Math.pow(a, 1.2);
    col[i * 3] = 255 * (crevice[0] * (1 - t) + t) * (0.75 + 0.25 * a);
    col[i * 3 + 1] = 255 * (crevice[1] * (1 - t) + t) * (0.75 + 0.25 * a);
    col[i * 3 + 2] = 255 * (crevice[2] * (1 - t) + t) * (0.75 + 0.25 * a);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
}
