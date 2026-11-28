// משלים לכל נקודה ב-data/occ.json את תאריך התצפית המלא (YYYY-MM-DD, או YYYY-MM כשהיום לא ידוע) כאיבר 6 במערך.
// מושך שוב את אותן תצפיות מ-GBIF ו-iNaturalist (כל השמות החלופיים) ומתאים לפי קואורדינטות.
// הרצה: node tools/fetch-occ-dates.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { SPECIES } = await import(path.join(root, 'data', 'species.js'));
const src = fs.readFileSync(path.join(root, 'tools', 'fetch-occurrences.mjs'), 'utf8');
const ALIAS = eval('(' + src.match(/const ALIAS = (\{.*?\});/s)[1] + ')');
const outFile = path.join(root, 'data', 'occ.json');
const occ = JSON.parse(fs.readFileSync(outFile, 'utf8'));
const UA = 'geophytes-app/1.0 (personal field checklist)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const { stdout } = await run('curl', ['-sS', '-L', '-m', '60', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 80 * 1024 * 1024 });
      const idx = stdout.lastIndexOf('\n'); const code = stdout.slice(idx + 1).trim();
      if (code === '429' || code.startsWith('5')) { await sleep(4000 * (i + 1)); continue; }
      if (code !== '200') return null;
      return JSON.parse(stdout.slice(0, idx));
    } catch { await sleep(1500); }
  }
  return null;
}
const names = (la) => { const p = la.replace(/[×]/g, ' ').replace(/\b(aff\.|var\.|subsp\.|sp\. nov\.)/g, ' ').split(/\s+/).filter(Boolean); const n = p.slice(0, 2).join(' '); return [...new Set([n, ALIAS[n], p.slice(0, 3).join(' ')].filter(Boolean))]; };
const INAT_ID = { anafei: 1077391, tulauc: 860616, ROMPET: 1191474 };
const pad = (n) => String(n).padStart(2, '0');
const key = (lat, lon, general) => (general ? `x${lat.toFixed(2)},${lon.toFixed(2)}` : `${lat.toFixed(4)},${lon.toFixed(4)}`);
const pkey = (p) => (p[4] === 'x' ? `x${p[0].toFixed(2)},${p[1].toFixed(2)}` : `${p[0].toFixed(4)},${p[1].toFixed(4)}`);

async function one(sp) {
  const dates = new Map();
  const put = (lat, lon, unc, d) => {
    if (typeof lat !== 'number' || !d) return;
    const k = key(lat, lon, unc > 5000);
    const old = dates.get(k);
    if (!old || d.length > old.length) dates.set(k, d);
  };
  const keys = new Set();
  for (const name of names(sp.la)) {
    const m = await getJson(`https://api.gbif.org/v1/species/match?kingdom=Plantae&name=${encodeURIComponent(name)}`);
    if (m?.usageKey && ['EXACT', 'FUZZY'].includes(m.matchType)) { keys.add(m.usageKey); if (m.acceptedUsageKey) keys.add(m.acceptedUsageKey); }
  }
  for (const k of keys) {
    for (let off = 0; off < 3000; off += 300) {
      const j = await getJson(`https://api.gbif.org/v1/occurrence/search?taxonKey=${k}&hasCoordinate=true&decimalLatitude=29.3,33.5&decimalLongitude=34.0,36.0&limit=300&offset=${off}`);
      if (!j?.results) break;
      for (const r of j.results) {
        let d = '';
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.eventDate || '');
        if (m) d = m[0]; else if (r.year && r.month && r.day) d = `${r.year}-${pad(r.month)}-${pad(r.day)}`; else if (r.year && r.month) d = `${r.year}-${pad(r.month)}`;
        put(r.decimalLatitude, r.decimalLongitude, r.coordinateUncertaintyInMeters, d);
      }
      if (j.endOfRecords) break; await sleep(100);
    }
  }
  const ids = new Set(INAT_ID[sp.c] ? [INAT_ID[sp.c]] : []);
  if (!ids.size) for (const name of names(sp.la).slice(0, 2)) {
    const res = (await getJson(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&per_page=5&all_names=true`))?.results || [];
    const hit = res.find((t) => t.name.toLowerCase() === name.toLowerCase() || (t.matched_term || '').toLowerCase() === name.toLowerCase());
    if (hit) ids.add(hit.id);
  }
  for (const id of ids) {
    let idAbove = 0;
    for (let page = 0; page < 15; page++) {
      const j = await getJson(`https://api.inaturalist.org/v1/observations?taxon_id=${id}&nelat=33.5&nelng=36.0&swlat=29.3&swlng=34.0&per_page=200&order_by=id&order=asc&id_above=${idAbove}&verifiable=any&quality_grade=research,needs_id,casual`);
      const list = j?.results || [];
      for (const ob of list) {
        idAbove = Math.max(idAbove, ob.id);
        if (!ob.geojson?.coordinates) continue;
        const [lon, lat] = ob.geojson.coordinates;
        put(lat, lon, ob.obscured ? Math.max(ob.public_positional_accuracy || 0, 20000) : (ob.positional_accuracy || 0), ob.observed_on || '');
      }
      if (list.length < 200) break; await sleep(600);
    }
  }
  let n = 0;
  for (const p of occ[sp.c] || []) { const d = dates.get(pkey(p)); if (d) { p[5] = d; n++; } }
  return n;
}
let i = 0, done = 0, tot = 0, all = 0;
async function worker() {
  while (i < SPECIES.length) {
    const sp = SPECIES[i++];
    try { tot += await one(sp); } catch (e) { console.log('ERR', sp.c, e.message); }
    all += (occ[sp.c] || []).length;
    if (++done % 20 === 0) { fs.writeFileSync(outFile, JSON.stringify(occ)); console.log(done, 'dated', tot, 'of', all); }
  }
}
await Promise.all([worker(), worker(), worker()]);
fs.writeFileSync(outFile, JSON.stringify(occ));
console.log('DONE dated', tot, 'of', all);
