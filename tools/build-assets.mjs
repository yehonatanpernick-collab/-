// Asset pipeline: optimise downloaded source models (assets-src/) into runtime GLBs (public/assets/models).
// Uses glTF Transform: dedup, prune, weld, meshopt compression and WebP texture compression.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, resample, textureCompress, meshopt, simplify, reorder, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const OUT = 'public/assets/models'; fs.mkdirSync(OUT, { recursive: true });
const SRC = 'assets-src/candidates';
const manifest = [];

async function build(name, src, out, prep, opts = {}) {
  const doc = await io.read(`${SRC}/${src}`);
  if (prep) await prep(doc);
  await doc.transform(
    dedup(), prune(), weld(),
    ...(opts.simplify ? [simplify({ simplifier: MeshoptSimplifier, ratio: opts.simplify, error: 0.0008 })] : []),
    resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [opts.tex || 1024, opts.tex || 1024] }),
    reorder({ encoder: MeshoptEncoder }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(`${OUT}/${out}`, doc);
  const a = fs.statSync(`${SRC}/${src}`).size, b = fs.statSync(`${OUT}/${out}`).size;
  console.log(`${name}: ${(a / 1e6).toFixed(2)} MB -> ${(b / 1e6).toFixed(2)} MB`);
  return b;
}

// 1. Hero vehicle base — Khronos "CarConcept" (CC-BY 4.0, derived from a CC0 model by Unity Fan)
const carSize = await build('vehicle', 'CarConcept.glb', 'skydrive-car.glb.png', async (doc) => {
  // drop the dense windshield-wiper mesh (24k verts) — the hero car uses hydrophobic glass
  for (const n of doc.getRoot().listNodes()) if (/Wipers$|License Plate/.test(n.getName())) n.dispose();
}, { tex: 1024 });
manifest.push({ name: 'Skydrive hero vehicle base', category: 'vehicle', file: 'models/skydrive-car.glb.png', source: 'KhronosGroup/glTF-Sample-Assets Models/CarConcept (based on "Free Concept Car 004" by Unity Fan, CC0)', license: 'CC-BY-4.0 (Khronos logos excluded/removed)', attribution: 'Car Concept — Khronos Group, Eric Chadwick et al.; original model by Unity Fan', format: 'glb (meshopt, webp)', bytes: carSize, optimized: true, integrated: 'VehicleModel.ts — doors, wheels, steering, lights, interior animated; custom flight thrusters added procedurally' });

// 2. Pedestrians: rigs WITH their native locomotion clips (cross-rig retargeting of Mixamo exports with
//    different bone rest orientations proved unreliable, so each character keeps its own animations)
const keep = (names) => async (doc) => { for (const a of doc.getRoot().listAnimations()) if (!names.includes(a.getName())) a.dispose(); };
const pedSize = await build('pedestrian-a', 'Xbot.glb', 'pedestrian.glb.png', keep(['idle', 'walk', 'run']), { tex: 512 });
const soldierSize = await build('pedestrian-b', 'Soldier.glb', 'pedestrian-b.glb.png', keep(['Idle', 'Walk', 'Run']), { tex: 512 });
manifest.push({ name: 'Pedestrian A (mannequin, tinted clothing)', category: 'character', file: 'models/pedestrian.glb.png', source: 'three.js examples (Xbot, Adobe Mixamo character + animations)', license: 'Mixamo royalty-free use in projects (distributed with three.js examples)', attribution: 'Adobe Mixamo', format: 'glb (meshopt)', bytes: pedSize, optimized: true, integrated: 'PedestrianManager.ts (skinned, pooled, idle/walk/run blending)' });
manifest.push({ name: 'Pedestrian B (jacket)', category: 'character', file: 'models/pedestrian-b.glb.png', source: 'three.js examples (Soldier/Vanguard, Adobe Mixamo character + animations)', license: 'Mixamo royalty-free use in projects (distributed with three.js examples)', attribution: 'Adobe Mixamo', format: 'glb (meshopt)', bytes: soldierSize, optimized: true, integrated: 'PedestrianManager.ts' });
manifest.push({ name: 'Michelle (casual female)', category: 'character', file: null, source: 'three.js examples (Adobe Mixamo)', license: 'Mixamo', attribution: 'Adobe Mixamo', format: 'glb', bytes: 0, optimized: false, integrated: 'evaluated, NOT used: ships only a dance clip and cross-rig retargeting failed visual QA' });

// 3. Delivery truck for traffic
const truckSize = 0;
manifest.push({ name: 'Delivery truck', category: 'traffic', file: 'models/delivery-truck.glb', source: 'KhronosGroup/glTF-Sample-Assets Models/CesiumMilkTruck', license: 'CC-BY-4.0', attribution: 'Cesium', format: 'glb', bytes: truckSize, optimized: true, integrated: 'evaluated, NOT used: procedural instanced traffic classes chosen for draw-call efficiency and visual consistency' });

fs.writeFileSync('public/assets/manifest.json', JSON.stringify({ generated: new Date().toISOString(), assets: manifest }, null, 1));
