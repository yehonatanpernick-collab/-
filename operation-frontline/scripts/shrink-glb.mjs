#!/usr/bin/env node
// Re-encodes the textures of the big Sketchfab-derived GLBs as 512 px WebP so the whole game stays light enough
// for phones (iOS Safari drops the page when too much data is in flight). Idempotent.
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'client/public/assets');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const FILES = ['weapons/m4a1', 'weapons/akm', 'weapons/mp5', 'weapons/m249', 'fps/arms', 'characters/operator', 'vehicles/hmmwv',
  'models/tank_m1a2', 'models/tank_t80', 'models/wreck_cars', 'models/wreck_sedan', 'models/van_izh', 'models/pickup_c10',
  'models/tree_oak_a', 'models/tree_oak_b', 'models/tree_leafy'];
for (const f of FILES) {
  const p = join(root, `${f}.glb`);
  const before = statSync(p).size;
  const doc = await io.read(p);
  await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 74 }));
  await io.write(p, doc);
  console.log(f, (before / 1e6).toFixed(2), '->', (statSync(p).size / 1e6).toFixed(2), 'MB');
}
