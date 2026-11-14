// Bake two LODs of each scanned cliff / boulder for the cliff-dressing system:
//   <name>_lod0.glb  near (detailed, 1k textures)
//   <name>_lod1.glb  far  (~700 tris, 256 px textures)
// Meshes are merged into one primitive per file so each LOD is a single instanced draw.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, textureCompress, flatten, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const RAW = new URL('../assets/_raw/models/', import.meta.url).pathname;
const OUT = new URL('../assets/models/cliffs/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

// name: [lod0 tris, lod1 tris]
const JOBS = {
  mountainside: [9000, 700], rock_face_01: [5000, 600], rock_face_02: [7000, 700],
  coastal_cliff_01: [10000, 900], namaqualand_cliff_02: [9000, 800],
};
const LODS = [{ suffix: 'lod0', tex: 1024, q: 84 }, { suffix: 'lod1', tex: 256, q: 80 }];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const tris = (doc) => {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
};

for (const [name, targets] of Object.entries(JOBS)) {
  for (let l = 0; l < LODS.length; l++) {
    const L = LODS[l], target = targets[l];
    const doc = await io.read(path.join(RAW, name, name + '.gltf'));
    const before = tris(doc);
    await doc.transform(flatten(), join(), weld({}), dedup());
    for (const err of [0.01, 0.05, 0.2, 1.0]) {
      const cur = tris(doc);
      if (cur <= target * 1.15) break;
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: target / cur, error: err, lockBorder: false }));
    }
    await doc.transform(prune(), textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [L.tex, L.tex], quality: L.q }));
    const out = path.join(OUT, `${name}_${L.suffix}.glb`);
    await io.write(out, doc);
    console.log(name, L.suffix, Math.round(before), '->', Math.round(tris(doc)), 'tris', Math.round(fs.statSync(out).size / 1024), 'KB');
  }
}
