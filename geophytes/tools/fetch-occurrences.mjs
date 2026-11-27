// אוסף תצפיות של כל מין, בתוך גבולות ישראל בלבד (כולל הגולן, יהודה והשומרון):
//   1. GBIF – מאגר שמאחד אוספי הרבריום ומוזיאונים, סקרי טבע, ומאגרי תצפיות רבים.
//   2. iNaturalist ישירות – כל התצפיות (גם כאלה שעדיין לא אושרו ברמת "מחקר", ושאינן ב-GBIF).
// תצפיות שמיקומן הוסתר להגנה על מין נדיר (דיוק גרוע מ-5 ק"מ) נשמרות כ"אזור כללי" (src = x) ולא כנקודה מדויקת.
// פלט: data/occ.json  { code: [[lat, lon, year, uncertaintyMeters, source], ...] }   source: i=iNaturalist, h=דוגמה באוסף, o=תצפית אחרת, x=אזור כללי
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
const occ = fs.existsSync(outFile) && process.argv[3] === 'resume' ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
const INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';
const UA = 'geophytes-app/1.0 (personal field checklist)';
const MAX = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// גבול ישראל (כולל רמת הגולן, החרמון הישראלי, יהודה והשומרון, עזה) – קירוב עם מרווח קטן; [lon, lat]
const BORDER = [[34.05,33.12],[35.15,33.12],[35.35,33.12],[35.50,33.19],[35.60,33.33],[35.82,33.36],[35.90,33.30],[35.87,33.15],[35.86,32.98],[35.83,32.85],[35.81,32.74],[35.70,32.69],[35.58,32.64],[35.58,32.45],[35.58,32.20],[35.57,31.90],[35.53,31.65],[35.50,31.40],[35.47,31.10],[35.42,30.80],[35.35,30.50],[35.27,30.20],[35.15,29.85],[35.05,29.60],[35.00,29.50],[34.88,29.46],[34.88,29.80],[34.80,30.10],[34.63,30.50],[34.45,30.88],[34.27,31.20],[34.20,31.35],[34.05,31.40]];
function inIsrael(lon, lat) {
  let inside = false;
  for (let i = 0, j = BORDER.length - 1; i < BORDER.length; j = i++) {
    const [xi, yi] = BORDER[i], [xj, yj] = BORDER[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const { stdout } = await run('curl', ['-sS', '-L', '-m', '60', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 80 * 1024 * 1024 });
      const idx = stdout.lastIndexOf('\n');
      const code = stdout.slice(idx + 1).trim();
      if (code === '429' || code.startsWith('5')) { await sleep(4000 * (i + 1)); continue; }
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
  'Tulipa aucheriana': 'Tulipa humilis',
};
const INAT_ID = { anafei: 1077391, tulauc: 860616, ROMPET: 1191474 };
function candidates(la) {
  const parts = la.replace(/[×]/g, ' ').replace(/\b(aff\.|var\.|sp\. nov\.)/g, ' ').split(/\s+/).filter(Boolean);
  const n = parts.slice(0, 2).join(' ');
  return [...new Set([n, ALIAS[n]].filter(Boolean))];
}

const add = (state, lat, lon, year, unc, src) => {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !inIsrael(lon, lat)) return;
  const general = unc > 5000;
  const key = general ? `x${lat.toFixed(2)},${lon.toFixed(2)}` : `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (state.seen.has(key)) return;
  state.seen.add(key);
  state.pts.push([+lat.toFixed(4), +lon.toFixed(4), year || 0, Math.round(unc || 0), general ? 'x' : src]);
};

async function fromGbif(sp, state) {
  let key = null;
  for (const name of candidates(sp.la)) {
    const m = await getJson(`https://api.gbif.org/v1/species/match?kingdom=Plantae&name=${encodeURIComponent(name)}`);
    if (m && m.usageKey && ['EXACT', 'FUZZY'].includes(m.matchType) && ['SPECIES', 'VARIETY', 'SUBSPECIES', 'FORM'].includes(m.rank)) { key = m.usageKey; break; }
  }
  if (!key) return;
  for (let offset = 0; offset < MAX; offset += 300) {
    const j = await getJson(`https://api.gbif.org/v1/occurrence/search?taxonKey=${key}&hasCoordinate=true&hasGeospatialIssue=false&decimalLatitude=29.3,33.5&decimalLongitude=34.0,36.0&limit=300&offset=${offset}`);
    if (!j?.results) break;
    for (const r of j.results) {
      if (r.basisOfRecord === 'FOSSIL_SPECIMEN') continue;
      const unc = r.coordinateUncertaintyInMeters;
      if (unc != null && unc > 60000) continue;
      const src = r.datasetKey === INAT_DATASET || r.institutionCode === 'iNaturalist' ? 'i' : /SPECIMEN/.test(r.basisOfRecord || '') ? 'h' : 'o';
      add(state, r.decimalLatitude, r.decimalLongitude, r.year, unc, src);
    }
    if (j.endOfRecords) break;
    await sleep(120);
  }
}

async function inatTaxon(sp) {
  if (INAT_ID[sp.c]) return INAT_ID[sp.c];
  for (const name of candidates(sp.la)) {
    for (const url of [
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&rank=species&per_page=5&is_active=true`,
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&per_page=5&all_names=true`,
    ]) {
      const res = (await getJson(url))?.results || [];
      const hit = res.find((t) => t.name.toLowerCase() === name.toLowerCase()) || res.find((t) => (t.matched_term || '').toLowerCase() === name.toLowerCase());
      if (hit) return hit.id;
    }
  }
  return null;
}

async function fromInat(sp, state) {
  const id = await inatTaxon(sp);
  if (!id) return;
  let idAbove = 0;
  for (let page = 0; page < 15; page++) {
    const j = await getJson(`https://api.inaturalist.org/v1/observations?taxon_id=${id}&nelat=33.5&nelng=36.0&swlat=29.3&swlng=34.0&per_page=200&order_by=id&order=asc&id_above=${idAbove}&verifiable=any&quality_grade=research,needs_id,casual`);
    const list = j?.results || [];
    for (const ob of list) {
      idAbove = Math.max(idAbove, ob.id);
      if (!ob.geojson?.coordinates) continue;
      const [lon, lat] = ob.geojson.coordinates;
      const unc = ob.obscured ? Math.max(ob.public_positional_accuracy || 0, 20000) : (ob.positional_accuracy || 0);
      if (unc > 60000) continue;
      add(state, lat, lon, ob.observed_on_details?.year || (ob.observed_on ? +ob.observed_on.slice(0, 4) : 0), unc, 'i');
    }
    if (list.length < 200) break;
    await sleep(700);
  }
}

const only = process.argv[2] && process.argv[2] !== 'all' ? new Set(process.argv[2].split(',')) : null;
const todo = SPECIES.filter((s) => (!only || only.has(s.c)) && !(s.c in occ));
let i = 0, done = 0;
async function worker() {
  while (i < todo.length) {
    const sp = todo[i++];
    const state = { seen: new Set(), pts: [] };
    try { await fromGbif(sp, state); } catch (e) { console.log('ERR gbif', sp.c, e.message); }
    try { await fromInat(sp, state); } catch (e) { console.log('ERR inat', sp.c, e.message); }
    occ[sp.c] = state.pts.slice(0, MAX + 500);
    if (++done % 10 === 0) { fs.writeFileSync(outFile, JSON.stringify(occ)); console.log(`${done}/${todo.length}`); }
  }
}
await Promise.all([worker(), worker(), worker()]);
fs.writeFileSync(outFile, JSON.stringify(occ));
const counts = Object.values(occ).map((v) => v.length).sort((a, b) => a - b);
const gen = Object.values(occ).reduce((a, v) => a + v.filter((p) => p[4] === 'x').length, 0);
console.log('DONE species', counts.length, 'total points', counts.reduce((a, b) => a + b, 0), 'general-area', gen, 'zero', counts.filter((c) => c === 0).length);
