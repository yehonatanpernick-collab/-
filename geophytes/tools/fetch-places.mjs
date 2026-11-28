// שמות יישובים אמיתיים (עם שם עברי וקואורדינטות) מוויקיפדיה האנגלית: geosearch על רשת נקודות + קישור שפה לעברית + תיאור ויקינתונים.
// פלט: data/places.json  [[nameHe, lon, lat, tier, kind], ...]  tier: 1=עיר, 2=יישוב/עיירה, 3=שכונה/קטן
// הרצה: node tools/fetch-places.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'tools', 'fetch-occurrences.mjs'), 'utf8');
const BORDER = eval(src.match(/const BORDER = (\[\[.*?\]\]);/s)[1]);
function inIsrael(lon, lat) { let inside = false; for (let i = 0, j = BORDER.length - 1; i < BORDER.length; j = i++) { const [xi, yi] = BORDER[i], [xj, yj] = BORDER[j]; if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside; } return inside; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'geophytes-app/1.0 (personal field checklist)';
async function get(url) {
  for (let i = 0; i < 8; i++) {
    try {
      const { stdout } = await run('curl', ['-sS', '-m', '40', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 20e6 });
      const idx = stdout.lastIndexOf('\n'); const code = stdout.slice(idx + 1).trim();
      if (code === '200') return JSON.parse(stdout.slice(0, idx));
      await sleep(4000 * (i + 1));
    } catch { await sleep(3000); }
  }
  return null;
}
const KIND = [
  [/\b(city|metropolis)\b/i, 1, 'city'], [/\b(town|local council|municipality)\b/i, 2, 'town'],
  [/\b(kibbutz|moshav|village|community|settlement|locality|bedouin|neighbou?rhood|moshava|hamlet|suburb)\b/i, 3, 'village'],
];
const BAD = /(reserve|park|museum|station|junction|interchange|road|highway|battle|school|university|hospital|synagogue|church|mosque|monastery|castle|fortress|tomb|cave|spring|stream|river|valley|mountain|hill|archaeolog|ruins|tell|site|bridge|airport|base|prison|camp|stadium|mall|center|centre|forest|beach|lake|sea|waterfall|nature|garden|zoo|cemetery|memorial|monument|power|plant|factory|company|organization|group|event|war|massacre|operation|raid|tourist)/i;
const found = new Map();
const pts = [];
const A = process.argv.slice(2).map(Number); // [latMin, latMax, lonMin, lonMax, stepLat, stepLon, radius]
const [LA0, LA1, LO0, LO1, SLA, SLO, RAD] = A.length ? A : [29.45, 33.4, 34.2, 35.95, 0.115, 0.135, 10000];
const OUT = process.env.OUT || 'places-raw.json';
for (let lat = LA0; lat <= LA1; lat += SLA) for (let lon = LO0; lon <= LO1; lon += SLO) if (inIsrael(lon, lat) || inIsrael(lon + 0.1, lat) || inIsrael(lon - 0.1, lat)) pts.push([lat, lon]);
console.log('grid points', pts.length);
let n = 0;
for (const [lat, lon] of pts) {
  let cont = {};
  for (let k = 0; k < 4; k++) {
    const qs = new URLSearchParams({ action: 'query', format: 'json', generator: 'geosearch', ggscoord: `${lat}|${lon}`, ggsradius: String(RAD), ggslimit: '500', prop: 'coordinates|langlinks|description', lllang: 'he', lllimit: '500', ...cont });
    const j = await get(`https://en.wikipedia.org/w/api.php?${qs}`);
    if (!j?.query?.pages) break;
    for (const pg of Object.values(j.query.pages)) {
      const e = found.get(pg.pageid) || { title: pg.title };
      if (pg.coordinates?.[0]) { e.lat = pg.coordinates[0].lat; e.lon = pg.coordinates[0].lon; }
      if (pg.langlinks?.[0]) e.he = pg.langlinks[0]['*'];
      if (pg.description) e.desc = pg.description;
      found.set(pg.pageid, e);
    }
    if (!j.continue) break; cont = j.continue;
  }
  if (++n % 25 === 0) console.log(n, pts.length, found.size);
  await sleep(500);
}
const out = [];
for (const e of found.values()) {
  if (!e.he || e.lat == null || !e.desc || BAD.test(e.desc) || BAD.test(e.title)) continue;
  const k = KIND.find(([re]) => re.test(e.desc)); if (!k) continue;
  if (!/israel|palestin|west bank|golan|gaza|bedouin|arab/i.test(e.desc) && !inIsrael(e.lon, e.lat)) continue;
  if (!inIsrael(e.lon, e.lat)) continue;
  out.push([e.he.replace(/ \(.*\)$/, ''), +e.lon.toFixed(4), +e.lat.toFixed(4), k[1], k[2], e.desc]);
}
fs.writeFileSync(path.join(root, 'data', OUT), JSON.stringify(out));
console.log('DONE', found.size, 'kept', out.length);
