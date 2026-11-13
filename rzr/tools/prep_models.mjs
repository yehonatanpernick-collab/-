// Turn the raw Poly Haven scans (millions of triangles, 1k textures) into
// real-time props: welded, meshopt-simplified to a triangle budget, textures
// resized, packed as a single .glb each.  Run after fetch_assets.py:
//   cd rzr/tools && npm i && node prep_models.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, textureCompress, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const RAW = new URL('../assets/_raw/models/', import.meta.url).pathname;
const OUT = new URL('../assets/models/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

// name: [target triangle count for the whole file, texture size]
const JOBS = {
  rock_moss_set_01: [9000, 1024], rock_moss_set_02: [9000, 1024],
  rock_09: [3000, 1024], rock_07: [3000, 1024], stone_01: [2000, 512],
  mountainside: [14000, 1024], rock_face_01: [5000, 1024],
  dead_tree_trunk: [5000, 1024], dead_tree_trunk_02: [6000, 1024],
  tree_stump_01: [2500, 512], tree_stump_02: [2500, 512],
  fern_02: [6300, 512], shrub_03: [5000, 512], shrub_04: [5000, 512],
  pine_roots: [6000, 1024], dry_branches_medium_01: [3000, 512],
  celandine_01: [9000, 512], dandelion_01: [6000, 512],
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

function triCount(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
}

const report = [];
for (const [name, [target, tex]] of Object.entries(JOBS)) {
  const alphaSrc = path.join(RAW, name, name + '.alpha.gltf');
  const hasAlpha = fs.existsSync(alphaSrc);
  const src = hasAlpha ? alphaSrc : path.join(RAW, name, name + '.gltf');
  if (!fs.existsSync(src)) { console.warn('missing', src); continue; }
  const doc = await io.read(src);
  const before = triCount(doc);
  await doc.transform(weld({}), dedup());
  const ratio = Math.min(1, target / before);
  if (ratio < 1) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: false }));
  }
  // second pass if the error bound stopped the simplifier early
  for (const err of [0.08, 0.3, 1.0]) {
    const mid = triCount(doc);
    if (mid <= target * 1.3) break;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: target / mid, error: err }));
  }
  await doc.transform(
    prune(),
    textureCompress({ encoder: sharp, targetFormat: hasAlpha ? 'webp' : 'jpeg', resize: [tex, tex], quality: 84 }),
  );
  const after = triCount(doc);
  const out = path.join(OUT, name + '.glb');
  await io.write(out, doc);
  const size = fs.statSync(out).size;
  report.push({ name, before, after: Math.round(after), kb: Math.round(size / 1024) });
  console.log(name, Math.round(before), '->', Math.round(after), 'tris', Math.round(size / 1024), 'KB');
}
fs.writeFileSync(path.join(OUT, 'models_report.json'), JSON.stringify(report, null, 1));
