#!/usr/bin/env node
// Downloads the CC-BY Sketchfab models listed below as GLB into assets/raw/sketchfab/<uid>.glb and
// records name / author / licence in assets/raw/sketchfab/<uid>.json.
// Needs a Sketchfab API token. In the cloud environment the proxy injects it; locally run with
// SKETCHFAB_TOKEN=... node scripts/fetch-sketchfab.mjs [uid ...]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKETCHFAB } from './asset-list.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets', 'raw', 'sketchfab');
mkdirSync(out, { recursive: true });
const auth = process.env.SKETCHFAB_TOKEN ? ['-H', `Authorization: Token ${process.env.SKETCHFAB_TOKEN}`] : [];
const get = (url, file) => execFileSync('curl', ['-sS', '-f', '-L', '--retry', '3', '-m', '600', ...auth, '-o', file, url], { stdio: 'inherit' });
const uids = process.argv.slice(2).length ? process.argv.slice(2) : SKETCHFAB.map((a) => a.uid);
for (const uid of uids) {
  const glb = join(out, `${uid}.glb`);
  if (existsSync(glb) && statSync(glb).size > 0) { console.log('have', uid); continue; }
  const meta = join(out, `${uid}.json`);
  get(`https://api.sketchfab.com/v3/models/${uid}`, meta);
  const m = JSON.parse(readFileSync(meta, 'utf8'));
  writeFileSync(meta, JSON.stringify({ uid, name: m.name, author: m.user?.displayName ?? m.user?.username, authorUrl: m.user?.profileUrl, license: m.license?.label, url: m.viewerUrl, faces: m.faceCount }, null, 1));
  const dj = join(out, `${uid}.download.json`);
  get(`https://api.sketchfab.com/v3/models/${uid}/download`, dj);
  const d = JSON.parse(readFileSync(dj, 'utf8'));
  if (!d.glb) { console.error('no glb for', uid); continue; }
  // the signed S3 url must not receive the Sketchfab token
  execFileSync('curl', ['-sS', '-f', '-L', '--retry', '3', '-m', '900', '-o', glb, d.glb.url], { stdio: 'inherit' });
  console.log('got', uid, m.name, (statSync(glb).size / 1048576).toFixed(1), 'MB', m.license?.label);
}
