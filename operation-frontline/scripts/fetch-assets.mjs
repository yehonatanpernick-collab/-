#!/usr/bin/env node
// Downloads the raw third-party assets listed in asset-list.mjs into assets/raw/.
// Uses curl so that system proxy settings are honoured. Safe to re-run: existing
// files are skipped. Run `npm run assets:fetch` then `npm run assets:build`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OTHER_ASSETS, POLYHAVEN_HDRIS, POLYHAVEN_MODELS, POLYHAVEN_TEXTURES } from './asset-list.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = join(root, 'assets', 'raw');

function curl(url, out) {
  if (existsSync(out) && statSync(out).size > 0) return false;
  mkdirSync(dirname(out), { recursive: true });
  execFileSync('curl', ['-sS', '-f', '-L', '--retry', '3', '-m', '180', '-o', out, url], { stdio: 'inherit' });
  return true;
}

function api(id) {
  const cache = join(raw, 'api', `${id}.json`);
  curl(`https://api.polyhaven.com/files/${id}`, cache);
  return JSON.parse(readFileSync(cache, 'utf8'));
}

let count = 0;
const failures = [];
const attempt = (label, fn) => {
  try { fn(); } catch (e) { failures.push(label); console.error(`FAILED ${label}: ${e.message}`); }
};

for (const t of POLYHAVEN_TEXTURES) {
  attempt(`texture ${t.id}`, () => {
    const files = api(t.id);
    const pick = (key) => files[key]?.['1k']?.jpg?.url;
    const maps = { diff: pick('Diffuse'), nor: pick('nor_gl'), arm: pick('arm') };
    if (!maps.diff || !maps.nor) throw new Error('missing diffuse/normal map');
    if (!maps.arm) { maps.rough = pick('Rough'); maps.ao = pick('AO'); }
    for (const [k, url] of Object.entries(maps)) {
      if (url && curl(url, join(raw, 'textures', t.id, `${k}.jpg`))) count++;
    }
  });
}

for (const h of POLYHAVEN_HDRIS) {
  attempt(`hdri ${h.id}`, () => {
    const files = api(h.id);
    if (curl(files.hdri['1k'].hdr.url, join(raw, 'hdri', `${h.id}_1k.hdr`))) count++;
    const tm = files.tonemapped?.url;
    if (tm && curl(tm, join(raw, 'hdri', `${h.id}_tonemapped.jpg`))) count++;
  });
}

for (const m of POLYHAVEN_MODELS) {
  attempt(`model ${m.id}`, () => {
    const files = api(m.id);
    const g = files.gltf?.['1k']?.gltf;
    if (!g) throw new Error('no 1k gltf');
    const dir = join(raw, 'models', m.id);
    if (curl(g.url, join(dir, `${m.id}.gltf`))) count++;
    for (const [rel, inc] of Object.entries(g.include ?? {})) {
      if (curl(inc.url, join(dir, rel))) count++;
    }
  });
}

for (const o of OTHER_ASSETS) {
  attempt(o.name, () => { if (curl(o.url, join(raw, 'other', o.out))) count++; });
}

writeFileSync(join(raw, '.fetched'), new Date().toISOString());
console.log(`Downloaded ${count} new files into assets/raw`);
if (failures.length) { console.error('Failures:', failures.join(', ')); process.exit(1); }
