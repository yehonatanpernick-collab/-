// אוסף תצפיות (נקודות) של כל מין מ-GBIF – מאגר שמאחד iNaturalist, אוספי הרבריום ומוזיאונים, סקרי טבע ועוד.
// פלט: data/occ.json  { code: [[lat, lon, year, uncertaintyMeters, source], ...] }   source: i=iNaturalist, h=דוגמה באוסף, o=תצפית אחרת
// הרצה: node tools/fetch-occurrences.mjs [code1,code2]
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { SPECIES } = await import(path.join(root, 'data', 'species.js'));
const outFile = path.join(root, 'data', 'occ.json');
const occ = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
const INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';
const UA = 'geophytes-app/1.0 (personal field checklist)';
const LAT = '29.3,33.7';
const LON = '34.1,36.1';
const MAX = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const { stdout } = await run('curl', ['-sS', '-L', '-m', '60', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 50 * 1024 * 1024 });
      const idx = stdout.lastIndexOf('\n');
      const code = stdout.slice(idx + 1).trim();
      if (code === '429' || code.startsWith('5')) { await sleep(3000 * (i + 1)); continue; }
      if (code !== '200') return null;
      return JSON.parse(stdout.slice(0, idx));
    } catch { await sleep(1500); }
  }
  return null;
}

const ALIAS = {
  'Tamus communis': 'Dioscorea communis', 'Drimia aphylla': 'Drimia maritima', 'Androcymbium palaestinum': 'Colchicum palaestinum',
  'Leopoldia comosa': 'Muscari comosum', 'Leopoldia bicolor': 'Muscari bicolor', 'Leopoldia longipes': 'Muscari longipes',
  'Leopoldia deserticola': 'Muscari deserticola', 'Leopoldia eburnea': 'Muscari eburneum',
  'Orchis laxiflora': 'Anacamptis laxiflora', 'Orchis collina': 'Anacamptis collina', 'Orchis israelitica': 'Anacamptis israelitica',
  'Ophrys holosericea': 'Ophrys holoserica', 'Nothoscordum borbonicum': 'Nothoscordum gracile', 'Narcissus deficiens': 'Narcissus serotinus',
  'Tulipa aucheriana': 'Tulipa humilis', 'Prospero autumnale': 'Prospero autumnale', 'Prospero hanburyi': 'Prospero hanburyi',
};
function candidates(la) {
  const parts = la.replace(/[×]/g, ' ').replace(/\b(aff\.|var\.|sp\. nov\.)/g, ' ').split(/\s+/).filter(Boolean);
  const n = parts.slice(0, 2).join(' ');
  return [...new Set([n, ALIAS[n]].filter(Boolean))];
}

async function keyFor(la) {
  for (const name of candidates(la)) {
    const m = await getJson(`https://api.gbif.org/v1/species/match?kingdom=Plantae&name=${encodeURIComponent(name)}`);
    if (m && m.usageKey && ['EXACT', 'FUZZY'].includes(m.matchType) && ['SPECIES', 'VARIETY', 'SUBSPECIES', 'FORM'].includes(m.rank)) return m.usageKey;
  }
  return null;
}

async function collect(sp) {
  const key = await keyFor(sp.la);
  if (!key) return null;
  const seen = new Set();
  const pts = [];
  for (let offset = 0; offset < MAX; offset += 300) {
    const j = await getJson(`https://api.gbif.org/v1/occurrence/search?taxonKey=${key}&hasCoordinate=true&hasGeospatialIssue=false&decimalLatitude=${LAT}&decimalLongitude=${LON}&limit=300&offset=${offset}`);
    if (!j?.results) break;
    for (const r of j.results) {
      const lat = r.decimalLatitude, lon = r.decimalLongitude;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      if (r.basisOfRecord === 'FOSSIL_SPECIMEN') continue;
      const unc = r.coordinateUncertaintyInMeters;
      if (unc != null && unc > 5000) continue;
      const k = `${lat.toFixed(4)},${lon.toFixed(4)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const src = r.datasetKey === INAT_DATASET ? 'i' : /SPECIMEN/.test(r.basisOfRecord || '') ? 'h' : 'o';
      pts.push([+lat.toFixed(4), +lon.toFixed(4), r.year || 0, unc != null ? Math.round(unc) : 0, src]);
    }
    if (j.endOfRecords) break;
    await sleep(150);
  }
  return pts;
}

const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const todo = SPECIES.filter((s) => (!only || only.has(s.c)) && !(s.c in occ));
let i = 0, done = 0;
async function worker() {
  while (i < todo.length) {
    const sp = todo[i++];
    try { occ[sp.c] = (await collect(sp)) || []; } catch (e) { console.log('ERR', sp.c, e.message); }
    if (++done % 10 === 0) { fs.writeFileSync(outFile, JSON.stringify(occ)); console.log(`${done}/${todo.length}`); }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
fs.writeFileSync(outFile, JSON.stringify(occ));
const counts = Object.values(occ).map((v) => v.length).sort((a, b) => a - b);
console.log('DONE species', counts.length, 'total points', counts.reduce((a, b) => a + b, 0), 'zero', counts.filter((c) => c === 0).length);
