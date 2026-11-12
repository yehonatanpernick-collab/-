#!/usr/bin/env node
// Turns the raw downloads in assets/raw into web-ready assets under client/public/assets:
//  * world textures  -> resized JPEG (diffuse / normal / ARM)
//  * HDRIs           -> 1k .hdr for lighting + 4k tonemapped JPEG for the visible sky
//  * Poly Haven glTF -> simplified, texture-resized, single-file GLB
// and writes assets/manifest.json + client/public/assets/models.json (bounds, triangle counts).
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, weld, textureCompress, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { OTHER_ASSETS, POLYHAVEN_HDRIS, POLYHAVEN_MODELS, POLYHAVEN_TEXTURES } from './asset-list.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = join(root, 'assets', 'raw');
const out = join(root, 'client', 'public', 'assets');
const force = process.argv.includes('--force');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const ensure = (p) => mkdirSync(dirname(p), { recursive: true });
const fresh = (p) => !force && existsSync(p) && statSync(p).size > 0;
const manifest = [];
const kb = (p) => Math.round(statSync(p).size / 1024);

// ---------------------------------------------------------------- textures
for (const t of POLYHAVEN_TEXTURES) {
  const maps = [];
  for (const m of ['diff', 'nor', 'arm', 'rough', 'ao']) {
    const src = join(raw, 'textures', t.id, `${m}.jpg`);
    if (!existsSync(src)) continue;
    const dst = join(out, 'textures', `${t.id}_${m}.jpg`);
    ensure(dst);
    if (!fresh(dst)) {
      await sharp(src).resize(t.size, t.size, { fit: 'fill' }).jpeg({ quality: m === 'nor' ? 88 : 80, mozjpeg: true }).toFile(dst);
    }
    maps.push(`${m} ${kb(dst)}KB`);
  }
  manifest.push({
    name: t.id, type: 'PBR texture set', source: `Poly Haven — https://polyhaven.com/a/${t.id}`, license: 'CC0 1.0',
    format: `JPEG ${t.size}px (${maps.join(', ')})`, files: `client/public/assets/textures/${t.id}_*.jpg`, use: t.use,
  });
}

// ---------------------------------------------------------------- hdri
for (const h of POLYHAVEN_HDRIS) {
  const hdr = join(out, 'hdri', `${h.id}_1k.hdr`);
  const sky = join(out, 'hdri', `${h.id}_sky.jpg`);
  ensure(hdr);
  if (!fresh(hdr)) copyFileSync(join(raw, 'hdri', `${h.id}_1k.hdr`), hdr);
  if (!fresh(sky)) {
    await sharp(join(raw, 'hdri', `${h.id}_tonemapped.jpg`), { limitInputPixels: false })
      .resize(4096, 2048, { fit: 'fill' }).jpeg({ quality: 84, mozjpeg: true }).toFile(sky);
  }
  manifest.push({
    name: h.id, type: 'HDRI', source: `Poly Haven — https://polyhaven.com/a/${h.id}`, license: 'CC0 1.0',
    format: `Radiance HDR 1k (${kb(hdr)}KB) + tonemapped JPEG 4k (${kb(sky)}KB)`, files: `client/public/assets/hdri/${h.id}_*`, use: h.use,
  });
}

// ---------------------------------------------------------------- models
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const meta = {};
const triCount = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return Math.round(n);
};

for (const m of POLYHAVEN_MODELS) {
  if (only && only !== m.id) continue;
  const src = join(raw, 'models', m.id, `${m.id}.gltf`);
  const dst = join(out, 'models', `${m.id}.glb`);
  ensure(dst);
  const doc = await io.read(src);
  const before = triCount(doc);
  if (!fresh(dst)) {
    const steps = [dedup(), weld()];
    if (m.tris > 0 && before > m.tris * 1.1) {
      steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: m.tris / before, error: 0.02, lockBorder: false }));
    }
    steps.push(prune());
    await doc.transform(...steps);
    // Resize textures; keep PNG for anything carrying alpha, JPEG otherwise.
    for (const tex of doc.getRoot().listTextures()) {
      const img = tex.getImage();
      if (!img) continue;
      const md = await sharp(img).metadata();
      const hasAlpha = md.hasAlpha && tex.getMimeType() === 'image/png';
      let pipe = sharp(img).resize(m.tex, m.tex, { fit: 'inside', withoutEnlargement: true });
      if (hasAlpha) { pipe = pipe.png({ compressionLevel: 9, palette: false }); tex.setMimeType('image/png'); }
      else { pipe = pipe.jpeg({ quality: 80, mozjpeg: true }); tex.setMimeType('image/jpeg'); }
      tex.setImage(new Uint8Array(await pipe.toBuffer()));
      const uri = tex.getURI();
      if (uri) tex.setURI(uri.replace(/\.(png|jpe?g)$/i, hasAlpha ? '.png' : '.jpg'));
    }
    await io.write(dst, doc);
  }
  const done = await io.read(dst);
  const b = getBounds(done.getRoot().listScenes()[0]);
  meta[m.id] = {
    min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)),
    tris: triCount(done), srcTris: before, kb: kb(dst),
  };
  manifest.push({
    name: m.id, type: '3D model', source: `Poly Haven — https://polyhaven.com/a/${m.id}`, license: 'CC0 1.0',
    format: `GLB, ${meta[m.id].tris} tris (source ${before}), textures ≤${m.tex}px, ${meta[m.id].kb}KB`,
    files: `client/public/assets/models/${m.id}.glb`, use: m.use,
  });
  console.log(`${m.id}: ${before} -> ${meta[m.id].tris} tris, ${meta[m.id].kb}KB, size ${b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(' x ')}`);
}

for (const o of OTHER_ASSETS) {
  const dst = join(out, o.out);
  ensure(dst);
  if (!fresh(dst)) copyFileSync(join(raw, 'other', o.out), dst);
  manifest.push({ name: o.name, type: '3D model', source: o.source, license: o.license, format: `${o.format}, ${kb(dst)}KB`, files: `client/public/assets/${o.out}`, use: o.use });
}

if (!only) {
  writeFileSync(join(out, 'models.json'), JSON.stringify(meta, null, 1));
  writeFileSync(join(root, 'assets', 'manifest.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), assets: manifest }, null, 2));
}
const total = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? total(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
console.log(`client/public/assets total: ${(total(out) / 1048576).toFixed(1)} MB`);
