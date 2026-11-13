#!/usr/bin/env node
// Normalises the Sketchfab gun models (CC-BY) into client/public/assets/weapons/<id>.glb:
// muzzle along -Z, up +Y, real-world length, origin at the pistol grip on the bore line.
// Writes client/public/assets/weapons/weapons.json with the points the game needs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'client', 'public', 'assets', 'weapons');
mkdirSync(out, { recursive: true });
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
// muzzle: axis the barrel points along in the source file; grip / bore: measured from side renders
export const GUNS = [
  { id: 'm4a1', uid: '1b858701dd7142d9b82bbe3fd121a97b', muzzle: '+z', length: 0.84, grip: 0.67, bore: 0.27, tris: 22000 },
  { id: 'akm', uid: '8b6ce77441f8446786e0680d61d327db', muzzle: '-z', length: 0.88, grip: 0.69, bore: 0.31, tris: 16000 },
  { id: 'mp5', uid: 'fad0226e1dcf4af180f707a5509d3a4e', muzzle: '-z', length: 0.68, grip: 0.6, bore: 0.18, tris: 18000 },
  { id: 'm249', uid: '75cacc16a52640c7adb100d7294da244', muzzle: '-x', length: 1.04, grip: 0.7, bore: 0.2, tris: 14000 },
];
const yawFor = { '+z': 180, '-z': 0, '+x': -90, '-x': 90 }; // rotation about Y that makes the muzzle point down -Z
const meta = {};
for (const g of GUNS) {
  const doc = await io.read(join(root, 'assets', 'raw', 'sketchfab', `${g.uid}.glb`));
  const scene = doc.getRoot().listScenes()[0];
  const turn = doc.createNode('turn').setRotation(quatY(yawFor[g.muzzle]));
  for (const c of scene.listChildren()) { scene.removeChild(c); turn.addChild(c); }
  const scale = doc.createNode('scale').addChild(turn);
  const place = doc.createNode(g.id).addChild(scale);
  scene.addChild(place);
  let b = getBounds(scene);
  const len = b.max[2] - b.min[2];
  const s = g.length / len;
  scale.setScale([s, s, s]);
  b = getBounds(scene);
  const L = b.max[2] - b.min[2], H = b.max[1] - b.min[1];
  const muzzleZ = b.min[2];
  const gripZ = muzzleZ + g.grip * L;
  const boreY = b.max[1] - g.bore * H;
  place.setTranslation([-(b.min[0] + b.max[0]) / 2, -boreY, -gripZ]);
  b = getBounds(scene);
  const before = triCount(doc);
  if (before > g.tris * 1.1) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: g.tris / before, error: 0.004 }));
  await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 82 }));
  await io.write(join(out, `${g.id}.glb`), doc);
  meta[g.id] = { min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)), tris: triCount(doc) };
  console.log(g.id, 'tris', before, '->', meta[g.id].tris, 'bounds', meta[g.id].min, meta[g.id].max);
}
writeFileSync(join(out, 'weapons.json'), JSON.stringify(meta, null, 1));

function quatY(deg) { const r = (deg * Math.PI) / 360; return [0, Math.sin(r), 0, Math.cos(r)]; }
function triCount(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); n += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
  return Math.round(n);
}
