#!/usr/bin/env node
// Turns the raw downloads in assets/raw into web-ready assets under client/public/assets:
//  * world textures  -> resized JPEG (diffuse / normal / ARM)
//  * HDRIs           -> 1k .hdr for lighting + 4k tonemapped JPEG for the visible sky
//  * Poly Haven glTF -> simplified, texture-resized, single-file GLB
// and writes assets/manifest.json + client/public/assets/models.json (bounds, triangle counts).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
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
// Radiance .hdr reader / writer. The image-based-lighting copy has the sun disc clamped so the
// environment only provides sky fill light – direct sunlight comes from the shadow casting light.
function readHdr(buf) {
  let o = 0, line = '';
  const lines = [];
  for (;;) {
    const c = buf[o++];
    if (c === 10) { lines.push(line); if (/^-Y \d+ \+X \d+$/.test(line)) break; line = ''; } else line += String.fromCharCode(c);
  }
  const m = /^-Y (\d+) \+X (\d+)$/.exec(lines[lines.length - 1]);
  const H = +m[1], W = +m[2];
  const rgb = new Float32Array(W * H * 3);
  const scan = new Uint8Array(W * 4);
  for (let y = 0; y < H; y++) {
    if (buf[o] === 2 && buf[o + 1] === 2 && ((buf[o + 2] << 8) | buf[o + 3]) === W) {
      o += 4;
      for (let ch = 0; ch < 4; ch++) {
        let x = 0;
        while (x < W) {
          let n = buf[o++];
          if (n > 128) { n -= 128; const v = buf[o++]; while (n--) scan[x++ * 4 + ch] = v; }
          else while (n--) scan[x++ * 4 + ch] = buf[o++];
        }
      }
    } else { scan.set(buf.subarray(o, o + W * 4)); o += W * 4; }
    for (let x = 0; x < W; x++) {
      const e = scan[x * 4 + 3];
      const f = e ? Math.pow(2, e - 136) : 0;
      const k = (y * W + x) * 3;
      rgb[k] = scan[x * 4] * f; rgb[k + 1] = scan[x * 4 + 1] * f; rgb[k + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { W, H, rgb };
}
function writeHdr(W, H, rgb) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`, 'ascii');
  const rows = [];
  for (let y = 0; y < H; y++) {
    const ch = [new Uint8Array(W), new Uint8Array(W), new Uint8Array(W), new Uint8Array(W)];
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 3;
      const r = rgb[k], g = rgb[k + 1], b = rgb[k + 2];
      const mx = Math.max(r, g, b);
      if (mx < 1e-32) continue;
      const e = Math.ceil(Math.log2(mx) + 1e-9);
      const f = 256 / Math.pow(2, e);
      ch[0][x] = Math.min(255, r * f); ch[1][x] = Math.min(255, g * f); ch[2][x] = Math.min(255, b * f); ch[3][x] = e + 128;
    }
    const outRow = [2, 2, W >> 8, W & 255];
    for (const c of ch) for (let x = 0; x < W; x += 128) { const n = Math.min(128, W - x); outRow.push(n); for (let i = 0; i < n; i++) outRow.push(c[x + i]); }
    rows.push(Buffer.from(outRow));
  }
  return Buffer.concat([head, ...rows]);
}
function makeIblHdr(src, dst) {
  const { W, H, rgb } = readHdr(readFileSync(src));
  const lum = (k) => 0.2126 * rgb[k] + 0.7152 * rgb[k + 1] + 0.0722 * rgb[k + 2];
  const upper = [];
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W; x += 3) upper.push(lum((y * W + x) * 3));
  upper.sort((a, b) => a - b);
  const cap = upper[Math.floor(upper.length * 0.9)] * 2.2;
  const w2 = W >> 1, h2 = H >> 1;
  const outRgb = new Float32Array(w2 * h2 * 3);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const acc = [0, 0, 0];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const k = ((y * 2 + dy) * W + x * 2 + dx) * 3;
      const l = lum(k), s = l > cap ? cap / l : 1;
      acc[0] += rgb[k] * s; acc[1] += rgb[k + 1] * s; acc[2] += rgb[k + 2] * s;
    }
    const o = (y * w2 + x) * 3;
    outRgb[o] = acc[0] / 4; outRgb[o + 1] = acc[1] / 4; outRgb[o + 2] = acc[2] / 4;
  }
  writeFileSync(dst, writeHdr(w2, h2, outRgb));
  return cap;
}

for (const h of POLYHAVEN_HDRIS) {
  const hdr = join(out, 'hdri', `${h.id}_ibl.hdr`);
  const sky = join(out, 'hdri', `${h.id}_sky.jpg`);
  ensure(hdr);
  if (!fresh(hdr)) console.log(`${h.id}: IBL sun clamp at luminance ${makeIblHdr(join(raw, 'hdri', `${h.id}_1k.hdr`), hdr).toFixed(2)}`);
  if (!fresh(sky)) {
    await sharp(join(raw, 'hdri', `${h.id}_tonemapped.jpg`), { limitInputPixels: false })
      .resize(2048, 1024, { fit: 'fill' }).jpeg({ quality: 84, mozjpeg: true }).toFile(sky);
  }
  manifest.push({
    name: h.id, type: 'HDRI', source: `Poly Haven — https://polyhaven.com/a/${h.id}`, license: 'CC0 1.0',
    format: `Radiance HDR 512x256, sun clamped for IBL (${kb(hdr)}KB) + tonemapped JPEG 2k (${kb(sky)}KB)`, files: `client/public/assets/hdri/${h.id}_*`, use: h.use,
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
