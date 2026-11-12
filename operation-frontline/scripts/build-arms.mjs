#!/usr/bin/env node
// First-person arms (Sketchfab "M4 FPS animation pack", CC-BY) -> client/public/assets/fps/arms.glb
// Keeps the skinned gloved arms and their clips (rebased to start at t = 0), drops the pack's own M4
// (the game attaches its own gun models), and writes arms.json with the bore height of the pack's rifle
// measured in the gun joint's space so the game can line its guns up with the hands.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mat4 } from 'gl-matrix';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'assets/raw/sketchfab/662fc74dda2646cfb48fc610705768ef.glb');
const OUT = join(root, 'client/public/assets/fps/arms.glb');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const r = doc.getRoot();
const node = (n) => r.listNodes().find((x) => x.getName() === n);

// bore line of the pack's M4 in the gun joint's local space: average height of the barrel's front 12 %
const mainJ = node('Main_j_049');
const jt = mainJ.getTranslation();
const pos = node('Main_M4_D_0').getMesh().listPrimitives()[0].getAttribute('POSITION');
let zMin = Infinity, zMax = -Infinity;
for (let i = 0; i < pos.getCount(); i++) { const p = pos.getElement(i, []); zMin = Math.min(zMin, p[2]); zMax = Math.max(zMax, p[2]); }
let ys = 0, n = 0;
for (let i = 0; i < pos.getCount(); i++) { const p = pos.getElement(i, []); if (p[2] > zMax - (zMax - zMin) * 0.12) { ys += p[1]; n++; } }
const info = { boreY: ys / n - jt[1], muzzleZ: zMax - jt[2], stockZ: zMin - jt[2], units: 'gun joint local (source cm)' };
console.log('pack rifle', info);

// drop the rifle, magazines and rounds
for (const nm of ['Main_M4_D_0', 'Mag1_M4_D_0', 'Mag2_M4_D_0', 'Bolt_M4_D_0', 'BoltCatch_M4_D_0', 'Trigger_M4_D_0', 'Safety_M4_D_0', 'Bullet5_56x45mm_Bullet5_56x45mm_D_0']) {
  for (const x of r.listNodes().filter((y) => y.getName() === nm)) x.setMesh(null);
}
// forearms -> uniform sleeves: paint the forearm triangles' UV area of the skin texture olive drab
// (vertices weighted mostly to the forearm joints), leaving the hands as they are
for (const [meshNode, rule] of [['Object_7', 'notFinger'], ['Object_8', 'fore']]) {
  const skinNode = node(meshNode);
  const prim = skinNode.getMesh().listPrimitives()[0];
  const joints = skinNode.getSkin().listJoints();
  const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0'), UV = prim.getAttribute('TEXCOORD_0');
  const idx = prim.getIndices().getArray();
  const fore = (i) => { const j = J.getElement(i, []), w = W.getElement(i, []); let f = 0; for (let k = 0; k < 4; k++) if (/ForeArm|Arm_/.test(joints[j[k]].getName())) f += w[k]; return f; };
  const mat = prim.getMaterial();
  const finger = (i) => { const j = J.getElement(i, []), w = W.getElement(i, []); let f = 0; for (let k = 0; k < 4; k++) if (/Thumb|Index|Middle|Ring|Pinky/.test(joints[j[k]].getName())) f += w[k]; return f; };
  const texture = mat.getExtension('KHR_materials_pbrSpecularGlossiness')?.getDiffuseTexture() ?? mat.getBaseColorTexture();
  const img = sharp(Buffer.from(texture.getImage()));
  const { data, info: ti } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const Wd = ti.width, Ht = ti.height;
  const mask = new Uint8Array(Wd * Ht);
  for (let t = 0; t < idx.length; t += 3) {
    const vs = [idx[t], idx[t + 1], idx[t + 2]];
    // everything but the fingers (Hand / ForeArm / Arm weighted skin) becomes sleeve
    if (rule === 'notFinger' ? vs.map(finger).reduce((x, y) => x + y, 0) / 3 > 0.5 : vs.map(fore).reduce((x, y) => x + y, 0) / 3 < 0.4) continue;
    const p = vs.map((v) => { const u = UV.getElement(v, []); return [u[0] * Wd, u[1] * Ht]; });
    const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])) - 1), maxX = Math.min(Wd - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])) + 1);
    const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])) - 1), maxY = Math.min(Ht - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])) + 1);
    const d = (p[1][1] - p[2][1]) * (p[0][0] - p[2][0]) + (p[2][0] - p[1][0]) * (p[0][1] - p[2][1]);
    if (Math.abs(d) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const l1 = ((p[1][1] - p[2][1]) * (x - p[2][0]) + (p[2][0] - p[1][0]) * (y - p[2][1])) / d;
      const l2 = ((p[2][1] - p[0][1]) * (x - p[2][0]) + (p[0][0] - p[2][0]) * (y - p[2][1])) / d;
      if (l1 >= -0.02 && l2 >= -0.02 && 1 - l1 - l2 >= -0.02) mask[y * Wd + x] = 1;
    }
  }
  let painted = 0;
  for (let i = 0; i < Wd * Ht; i++) {
    if (!mask[i]) continue;
    painted++;
    const lum = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11) / 255;
    const n = 0.75 + 0.5 * lum; // keep the texture's shading detail as fabric variation
    data[i * 4] = Math.min(255, 62 * n); data[i * 4 + 1] = Math.min(255, 70 * n); data[i * 4 + 2] = Math.min(255, 48 * n);
  }
  const png = await sharp(data, { raw: { width: Wd, height: Ht, channels: 4 } }).png().toBuffer();
  texture.setImage(new Uint8Array(png)).setMimeType('image/png');
  console.log(meshNode, 'sleeve pixels', painted, 'of', Wd * Ht);
}
// rebase clips (the pack stores them on one shared timeline)
const rename = { Reload_Empty: 'ReloadEmpty' };
for (const a of r.listAnimations()) {
  let t0 = Infinity;
  for (const c of a.listChannels()) t0 = Math.min(t0, c.getSampler().getInput().getMin([])[0]);
  const seen = new Set();
  for (const c of a.listChannels()) {
    const inp = c.getSampler().getInput();
    if (seen.has(inp)) continue;
    seen.add(inp);
    const arr = inp.getArray().slice();
    for (let i = 0; i < arr.length; i++) arr[i] -= t0;
    inp.setArray(arr);
  }
  a.setName(rename[a.getName()] ?? a.getName());
}
// the sampler inputs may be shared between clips; dedup after rebasing keeps them consistent
await doc.transform(prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 82 }));
mkdirSync(dirname(OUT), { recursive: true });
await io.write(OUT, doc);
writeFileSync(join(dirname(OUT), 'arms.json'), JSON.stringify(info, null, 2));
for (const a of r.listAnimations()) console.log(a.getName(), Math.max(...a.listChannels().map((c) => c.getSampler().getInput().getMax([])[0])).toFixed(2), 's');
console.log('wrote', OUT);
