// השלמת תצפיות ממקורות נוספים, מתמזג לתוך data/occ.json (ללא כפילויות, בתוך גבולות ישראל בלבד):
//  - GBIF: כל וריאציות השם והמילים נרדפות (taxonKey נפרד לכל שם), כולל רשומות עם דגל גאוספציאלי קל
//  - iNaturalist: taxon נפרד לכל שם חלופי
//  - ויקישיתוף (Wikimedia Commons): תמונות עם תיוג מיקום בקטגוריית המין  → מקור 'c'
// הרצה: node tools/fetch-occ-extra.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { SPECIES } = await import(path.join(root, 'data', 'species.js'));
const src = fs.readFileSync(path.join(root, 'tools', 'fetch-occurrences.mjs'), 'utf8');
const BORDER = eval(src.match(/const BORDER = (\[\[.*?\]\]);/s)[1]);
const ALIAS = eval('(' + src.match(/const ALIAS = (\{.*?\});/s)[1] + ')');
const outFile = path.join(root, 'data', 'occ.json');
const occ = JSON.parse(fs.readFileSync(outFile, 'utf8'));
const UA = 'geophytes-app/1.0 (personal field checklist)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function inIsrael(lon, lat) { let inside = false; for (let i = 0, j = BORDER.length - 1; i < BORDER.length; j = i++) { const [xi, yi] = BORDER[i], [xj, yj] = BORDER[j]; if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside; } return inside; }
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
const INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';
let added = {};
function mk(code) {
  const seen = new Set((occ[code] || []).map((p) => (p[4] === 'x' ? `x${p[0].toFixed(2)},${p[1].toFixed(2)}` : `${p[0].toFixed(4)},${p[1].toFixed(4)}`)));
  return (lat, lon, year, unc, s) => {
    if (typeof lat !== 'number' || typeof lon !== 'number' || !inIsrael(lon, lat)) return;
    const g = unc > 5000; const key = g ? `x${lat.toFixed(2)},${lon.toFixed(2)}` : `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (seen.has(key)) return; seen.add(key);
    (occ[code] ||= []).push([+lat.toFixed(4), +lon.toFixed(4), year || 0, Math.round(unc || 0), g ? 'x' : s]);
    added[s] = (added[s] || 0) + 1;
  };
}
async function one(sp) {
  const add = mk(sp.c);
  const keys = new Set();
  for (const name of names(sp.la)) {
    const m = await getJson(`https://api.gbif.org/v1/species/match?kingdom=Plantae&name=${encodeURIComponent(name)}`);
    if (m?.usageKey && ['EXACT', 'FUZZY'].includes(m.matchType)) { keys.add(m.usageKey); if (m.acceptedUsageKey) keys.add(m.acceptedUsageKey); }
  }
  for (const key of keys) {
    for (let off = 0; off < 3000; off += 300) {
      const j = await getJson(`https://api.gbif.org/v1/occurrence/search?taxonKey=${key}&hasCoordinate=true&decimalLatitude=29.3,33.5&decimalLongitude=34.0,36.0&limit=300&offset=${off}`);
      if (!j?.results) break;
      for (const r of j.results) {
        if (r.basisOfRecord === 'FOSSIL_SPECIMEN') continue;
        const bad = (r.issues || []).some((x) => ['COUNTRY_COORDINATE_MISMATCH', 'ZERO_COORDINATE', 'COORDINATE_OUT_OF_RANGE', 'PRESUMED_SWAPPED_COORDINATE', 'COORDINATE_INVALID'].includes(x));
        if (bad) continue;
        const unc = r.coordinateUncertaintyInMeters; if (unc != null && unc > 60000) continue;
        const s = r.datasetKey === INAT_DATASET ? 'i' : /SPECIMEN/.test(r.basisOfRecord || '') ? 'h' : 'o';
        add(r.decimalLatitude, r.decimalLongitude, r.year, unc, s);
      }
      if (j.endOfRecords) break; await sleep(100);
    }
  }
  // iNaturalist: taxon לכל שם חלופי
  for (const name of names(sp.la).slice(0, 2)) {
    const res = (await getJson(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&per_page=5&all_names=true`))?.results || [];
    const hit = res.find((t) => t.name.toLowerCase() === name.toLowerCase() || (t.matched_term || '').toLowerCase() === name.toLowerCase());
    if (!hit) continue;
    let idAbove = 0;
    for (let page = 0; page < 15; page++) {
      const j = await getJson(`https://api.inaturalist.org/v1/observations?taxon_id=${hit.id}&nelat=33.5&nelng=36.0&swlat=29.3&swlng=34.0&per_page=200&order_by=id&order=asc&id_above=${idAbove}&verifiable=any&quality_grade=research,needs_id,casual`);
      const list = j?.results || [];
      for (const ob of list) { idAbove = Math.max(idAbove, ob.id); if (!ob.geojson?.coordinates) continue; const [lon, lat] = ob.geojson.coordinates; const unc = ob.obscured ? Math.max(ob.public_positional_accuracy || 0, 20000) : (ob.positional_accuracy || 0); if (unc > 60000) continue; add(lat, lon, ob.observed_on ? +ob.observed_on.slice(0, 4) : 0, unc, 'i'); }
      if (list.length < 200) break; await sleep(600);
    }
  }
  // ויקישיתוף
  for (const name of names(sp.la).slice(0, 2)) {
    const j = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=categorymembers&gcmtitle=${encodeURIComponent('Category:' + name)}&gcmtype=file&gcmlimit=200&prop=coordinates&colimit=200`);
    for (const pg of Object.values(j?.query?.pages || {})) for (const c of pg.coordinates || []) add(c.lat, c.lon, 0, 50, 'c');
  }
}
let i = 0, done = 0;
async function worker() { while (i < SPECIES.length) { const sp = SPECIES[i++]; try { await one(sp); } catch (e) { console.log('ERR', sp.c, e.message); } if (++done % 20 === 0) { fs.writeFileSync(outFile, JSON.stringify(occ)); console.log(done, JSON.stringify(added)); } } }
await Promise.all([worker(), worker(), worker()]);
fs.writeFileSync(outFile, JSON.stringify(occ));
console.log('DONE', JSON.stringify(added), 'total', Object.values(occ).reduce((a, v) => a + v.length, 0), 'zero', Object.values(occ).filter((v) => !v.length).length);
