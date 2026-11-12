#!/usr/bin/env node
// Normalises realistic Sketchfab props (CC-BY) into client/public/assets/models/<id>.glb so they load like the
// Poly Haven props: bottom on y = 0, centred, long axis along Z, real-world size, simplified, 1k JPEG textures.
// Prints the bounds for the PROPS table in shared/src/world/materials.ts.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

// size: metres along the long axis (length) or height
export const PROPS = [
  { id: 'tank_m1a2', uid: '10a16c96ca8b4ebc855915f5d5202046', length: 9.8, tris: 14000 },
  { id: 'tank_t80', uid: 'ebf4b55eeabb421cbf2758a2ec948439', length: 9.6, tris: 20000 },
  { id: 'wreck_cars', uid: '701066df6b914fd08318524c7ccd96a7', height: 1.45, tris: 8000 },
  { id: 'wreck_sedan', uid: 'efc4dfe2c7284a64bc9281eb4f61d402', length: 5.2, tris: 10000 },
  { id: 'van_izh', uid: '07bc48134b364d4f8a43d288b3a0282d', length: 4.1, tris: 5000 },
  { id: 'pickup_c10', uid: '679354c151984747bb74310ec5af8995', length: 4.9, tris: 12000 },
  // game-ready trees with alpha-tested leaf cards (WebP keeps the alpha), bottom centred under the trunk
  { id: 'tree_oak_a', uid: '3dc59560f2d24345bdbe65c44636453b', height: 7.5, tris: 30000, tree: true },
  { id: 'tree_oak_b', uid: '6468dd4d3eb240ef902b9057d9913606', height: 8, tris: 30000, tree: true },
  { id: 'tree_leafy', uid: 'd989c0f801d847b9a74992ec4ddcfdfc', height: 7, tris: 30000, tree: true },
];

const only = process.argv.slice(2);
for (const p of PROPS) {
  if (only.length && !only.includes(p.id)) continue;
  const doc = await io.read(join(root, `assets/raw/sketchfab/${p.uid}.glb`));
  const scene = doc.getRoot().listScenes()[0];
  const turn = doc.createNode('turn');
  for (const c of scene.listChildren()) { scene.removeChild(c); turn.addChild(c); }
  const scale = doc.createNode('scale').addChild(turn);
  const place = doc.createNode(p.id).addChild(scale);
  scene.addChild(place);
  let b = getBounds(scene);
  // long axis along Z
  if (!p.tree && b.max[0] - b.min[0] > b.max[2] - b.min[2]) turn.setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
  b = getBounds(scene);
  const s = p.length ? p.length / (b.max[2] - b.min[2]) : p.height / (b.max[1] - b.min[1]);
  scale.setScale([s, s, s]);
  b = getBounds(scene);
  place.setTranslation([-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2]);
  const tris = () => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, pr) => k + (pr.getIndices()?.getCount() ?? pr.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const before = tris();
  const steps = [dedup(), weld()];
  if (before > p.tris * 1.1) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: p.tris / before, error: 0.004 }));
  steps.push(prune(), p.tree ? textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }) : textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 80 }));
  await doc.transform(...steps);
  b = getBounds(scene);
  const out = join(root, `client/public/assets/models/${p.id}.glb`);
  mkdirSync(dirname(out), { recursive: true });
  await io.write(out, doc);
  console.log(`  ${p.id}: { min: [${b.min.map((v) => +v.toFixed(3)).join(', ')}], max: [${b.max.map((v) => +v.toFixed(3)).join(', ')}], solid: true, surface: 'metal' },  // ${Math.round(before)} -> ${Math.round(tris())} tris`);
}
