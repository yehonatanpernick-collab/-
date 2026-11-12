#!/usr/bin/env node
// Normalises the "HMMWV M998A1 (soft top)" model (Sketchfab, CC-BY) into client/public/assets/vehicles/hmmwv.glb:
// nose towards -Z, wheels on y = 0, centred, 4.6 m long.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(join(root, 'assets/raw/sketchfab/ffbc4b053628413fb84acf5b89595d96.glb'));
const scene = doc.getRoot().listScenes()[0];
const turn = doc.createNode('turn').setRotation([0, 1, 0, 0]); // 180 degrees about Y
for (const c of scene.listChildren()) { scene.removeChild(c); turn.addChild(c); }
const scale = doc.createNode('scale').addChild(turn);
const place = doc.createNode('hmmwv').addChild(scale);
scene.addChild(place);
let b = getBounds(scene);
const s = 4.6 / (b.max[2] - b.min[2]);
scale.setScale([s, s, s]);
b = getBounds(scene);
place.setTranslation([-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2]);
b = getBounds(scene);
console.log('bounds', b.min.map((v) => v.toFixed(2)), b.max.map((v) => v.toFixed(2)));
await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 82 }));
mkdirSync(join(root, 'client/public/assets/vehicles'), { recursive: true });
await io.write(join(root, 'client/public/assets/vehicles/hmmwv.glb'), doc);
