// מוריד עד 3 תמונות שונות לכל מין (iNaturalist בעדיפות, Wikimedia Commons כגיבוי) – רק רישיונות CC.
// פלט: raw-img/<code>-<n>.jpg + data/photos.json  ({code: [{credit, license, source, page}, ...]})
// הרצה: node tools/fetch-photos2.mjs [code1,code2]
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(root, 'raw-img');
fs.mkdirSync(rawDir, { recursive: true });
const { SPECIES } = await import(path.join(root, 'data', 'species.js'));

const WANT = 3;
const ALLOWED = new Set(['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa']);
const LIC_Q = 'cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa';
const UA = 'geophytes-app/1.0 (personal field checklist)';
const photosFile = path.join(root, 'data', 'photos.json');
let photos = fs.existsSync(photosFile) ? JSON.parse(fs.readFileSync(photosFile, 'utf8')) : {};
if (Array.isArray(Object.values(photos)[0]) === false) photos = {}; // פורמט ישן (תמונה אחת) – מתחילים מחדש

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function curl(url, outFile) {
  const args = ['-sS', '-L', '-m', '45', '-A', UA, '-w', '%{http_code}'];
  if (outFile) args.push('-o', outFile);
  args.push(url);
  try { return (await run('curl', args, { maxBuffer: 30 * 1024 * 1024 })).stdout.toString(); } catch { return ''; }
}
async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    const out = await curl(url);
    const code = out.slice(-3);
    if (code === '429' || code.startsWith('5')) { await sleep(3000 * (i + 1)); continue; }
    if (code !== '200') return null;
    try { return JSON.parse(out.slice(0, -3)); } catch { return null; }
  }
  return null;
}

const ALIAS = {
  'Tamus communis': 'Dioscorea communis', 'Drimia aphylla': 'Drimia maritima', 'Androcymbium palaestinum': 'Colchicum palaestinum',
  'Leopoldia comosa': 'Muscari comosum', 'Leopoldia bicolor': 'Muscari bicolor', 'Leopoldia longipes': 'Muscari longipes',
  'Orchis laxiflora': 'Anacamptis laxiflora', 'Orchis collina': 'Anacamptis collina', 'Orchis israelitica': 'Anacamptis israelitica',
  'Ophrys holosericea': 'Ophrys holoserica', 'Nothoscordum borbonicum': 'Nothoscordum gracile', 'Allium sindjarense': 'Allium sindjarense',
  'Scilla hyacinthoides': 'Scilla hyacinthoides', 'Narcissus deficiens': 'Narcissus serotinus', 'Gagea libanotica': 'Gagea libanotica',
  'Ornithogalum cuspidatum': 'Ornithogalum cuspidatum', 'Allium dumetorum': 'Allium dumetorum', 'Prospero hanburyi': 'Prospero hanburyi',
  'Crocus aleppicus': 'Crocus aleppicus', 'Iris petrana': 'Iris petrana', 'Iris regis-uzziae': 'Iris regis-uzziae',
};
function names(la) {
  const parts = la.replace(/[×]/g, ' ').replace(/\b(aff\.|var\.|sp\. nov\.)/g, ' ').split(/\s+/).filter(Boolean);
  const n = parts.slice(0, 2).join(' ');
  return [...new Set([n, ALIAS[n]].filter(Boolean))];
}

async function findTaxon(name) {
  for (const url of [
    `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&rank=species&per_page=5&is_active=true`,
    `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&per_page=5&all_names=true`,
  ]) {
    const res = (await getJson(url))?.results || [];
    const n = name.toLowerCase();
    const hit = res.find((t) => t.name.toLowerCase() === n) || res.find((t) => (t.matched_term || '').toLowerCase() === n);
    if (hit) return hit;
  }
  return null;
}

// מינים ששמם ב-iNaturalist שונה (הכלאה, זן) – מזהה ישיר.
const TAXON_ID = { anafei: 1077391, tulauc: 860616, ROMPET: 1191474 };

async function inatCandidates(sp) {
  const out = [];
  for (const name of names(sp.la)) {
    const t = TAXON_ID[sp.c] ? { id: TAXON_ID[sp.c] } : await findTaxon(name);
    if (!t) continue;
    const full = (await getJson(`https://api.inaturalist.org/v1/taxa/${t.id}`))?.results?.[0];
    const page = `https://www.inaturalist.org/taxa/${t.id}`;
    for (const tp of full?.taxon_photos || []) {
      const p = tp.photo;
      if (p && ALLOWED.has(p.license_code)) out.push({ id: `t${p.id}`, url: p.url.replace('square', 'large'), credit: p.attribution, license: p.license_code, page });
    }
    const o = await getJson(`https://api.inaturalist.org/v1/observations?taxon_id=${t.id}&photo_license=${LIC_Q}&quality_grade=research&order_by=votes&per_page=30&photos=true`);
    for (const ob of o?.results || []) {
      for (const p of (ob.photos || []).slice(0, 1)) {
        if (ALLOWED.has(p.license_code)) out.push({ id: `o${p.id}`, url: p.url.replace('square', 'large'), credit: p.attribution, license: p.license_code, page: `https://www.inaturalist.org/observations/${ob.id}` });
      }
    }
    if (out.length >= WANT) break;
  }
  return out;
}

async function commonsCandidates(sp) {
  const out = [];
  for (const name of names(sp.la)) {
    const j = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(name)}&gsrlimit=12&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=1024`);
    for (const pg of Object.values(j?.query?.pages || {})) {
      const ii = pg.imageinfo?.[0];
      if (!ii || !/jpeg/.test(ii.mime || '')) continue;
      const em = ii.extmetadata || {};
      const lic = (em.LicenseShortName?.value || '').toLowerCase();
      if (!/cc|public domain/.test(lic)) continue;
      const desc = ((em.ImageDescription?.value || '') + ' ' + pg.title).toLowerCase();
      if (!desc.includes(name.split(' ')[1].toLowerCase())) continue; // ודא שהשם מופיע בתיאור
      const artist = (em.Artist?.value || 'Wikimedia Commons').replace(/<[^>]+>/g, '').trim();
      out.push({ id: `c${pg.pageid}`, url: ii.thumburl || ii.url, credit: `${artist}, ${em.LicenseShortName.value}`, license: lic.replace(/\s+/g, '-'), page: ii.descriptionurl, source: 'Wikimedia Commons' });
    }
    if (out.length >= WANT) break;
  }
  return out;
}

async function doSpecies(sp) {
  const have = photos[sp.c]?.length || 0;
  if (have >= WANT) return;
  for (const f of fs.readdirSync(rawDir)) if (f.startsWith(sp.c.toLowerCase() + '-')) fs.unlinkSync(path.join(rawDir, f));
  let cands = [];
  try { cands = await inatCandidates(sp); } catch (e) { console.log('ERR inat', sp.c, e.message); }
  if (cands.length < WANT) { try { cands = cands.concat(await commonsCandidates(sp)); } catch (e) { console.log('ERR commons', sp.c, e.message); } }
  const seen = new Set();
  const got = [];
  for (const c of cands) {
    if (got.length >= WANT) break;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const dest = path.join(rawDir, `${sp.c.toLowerCase()}-${got.length + 1}.jpg`);
    const code = (await curl(c.url, dest)).slice(-3);
    if (code === '200' && fs.existsSync(dest) && fs.statSync(dest).size > 5000) {
      got.push({ credit: c.credit, license: c.license, source: c.source || 'iNaturalist', page: c.page });
    }
    await sleep(250);
  }
  if (got.length) photos[sp.c] = got;
  fs.writeFileSync(photosFile, JSON.stringify(photos));
}

const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const todo = SPECIES.filter((s) => !only || only.has(s.c));
let i = 0, done = 0;
async function worker() {
  while (i < todo.length) {
    const sp = todo[i++];
    await doSpecies(sp);
    if (++done % 10 === 0) console.log(`${done}/${todo.length}`);
    await sleep(300);
  }
}
await Promise.all([worker(), worker(), worker()]);
const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
for (const s of SPECIES) counts[photos[s.c]?.length || 0]++;
console.log('DONE', JSON.stringify(counts));
console.log('FEW', SPECIES.filter((s) => (photos[s.c]?.length || 0) < WANT).map((s) => `${s.c}:${photos[s.c]?.length || 0}`).join(' '));
