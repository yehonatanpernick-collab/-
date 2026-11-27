// מוריד תמונה אחת לכל טקסון מ-iNaturalist (רק צילומים ברישיון CC) ומ-Wikipedia כגיבוי.
// הרצה: node tools/fetch-photos.mjs   -> geophytes/img/<code>.jpg + data/photos.json
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'img');
fs.mkdirSync(outDir, { recursive: true });
const { SPECIES } = await import(path.join(root, 'data', 'species.js'));

const ALLOWED = new Set(['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa']);
const UA = { 'User-Agent': 'geophytes-app/1.0 (personal field checklist)' };
const photosFile = path.join(root, 'data', 'photos.json');
const photos = fs.existsSync(photosFile) ? JSON.parse(fs.readFileSync(photosFile, 'utf8')) : {};
const misses = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// node fetch אינו עובר דרך הפרוקסי של הסביבה, לכן משתמשים ב-curl.
function curl(url, outFile) {
  const args = ['-sS', '-L', '-m', '40', '-A', UA['User-Agent'], '-w', '%{http_code}'];
  if (outFile) args.push('-o', outFile);
  args.push(url);
  try { return execFileSync('curl', args, { maxBuffer: 20 * 1024 * 1024 }).toString(); } catch { return ''; }
}
async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    const out = curl(url);
    const code = out.slice(-3);
    if (code === '429' || code.startsWith('5')) { await sleep(3000 * (i + 1)); continue; }
    if (code !== '200') return null;
    try { return JSON.parse(out.slice(0, -3)); } catch { return null; }
  }
  return null;
}

// שמות לטיניים שבמאגר ישראלי שונים משם הקבוצה ב-iNaturalist
const ALIAS = {
  'Tamus communis': 'Dioscorea communis', 'Tamus orientalis': 'Dioscorea orientalis',
  'Drimia aphylla': 'Drimia maritima', 'Prospero autumnale': 'Prospero autumnale',
  'Androcymbium palaestinum': 'Colchicum palaestinum', 'Leopoldia comosa': 'Muscari comosum',
  'Orchis laxiflora': 'Anacamptis laxiflora', 'Orchis collina': 'Anacamptis collina',
  'Orchis israelitica': 'Anacamptis israelitica', 'Gagea gageoides': 'Gagea gageoides',
};
function cleanName(la) {
  const parts = la.replace(/[×]/g, ' ').replace(/\b(aff\.|var\.|sp\. nov\.)/g, ' ').split(/\s+/).filter(Boolean);
  const n = parts.slice(0, 2).join(' ');
  return ALIAS[n] || n;
}

async function findTaxon(name) {
  const j = await getJson(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&rank=species&per_page=5&is_active=true`);
  const res = j?.results || [];
  const norm = (s) => s.toLowerCase();
  return res.find((t) => norm(t.name) === norm(name)) || res.find((t) => norm(t.matched_term || '') === norm(name)) || null;
}

function pickPhoto(taxon) {
  const list = [taxon.default_photo, ...(taxon.taxon_photos || []).map((p) => p.photo)].filter(Boolean);
  return list.find((p) => ALLOWED.has(p.license_code));
}

async function fromINat(sp) {
  const name = cleanName(sp.la);
  const t = await findTaxon(name);
  if (!t) return null;
  const full = await getJson(`https://api.inaturalist.org/v1/taxa/${t.id}`);
  const taxon = full?.results?.[0];
  if (!taxon) return null;
  let p = pickPhoto(taxon);
  if (!p) { // חיפוש בתצפיות מחקריות עם צילום ברישיון פתוח
    const o = await getJson(`https://api.inaturalist.org/v1/observations?taxon_id=${t.id}&photo_license=cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa&quality_grade=research&order_by=votes&per_page=3&photos=true`);
    p = o?.results?.flatMap((r) => r.photos || []).find((x) => ALLOWED.has(x.license_code));
  }
  if (!p) return null;
  const url = (p.url || '').replace('square', 'medium');
  return { url, credit: p.attribution, license: p.license_code, source: 'iNaturalist', page: `https://www.inaturalist.org/taxa/${t.id}` };
}

async function fromWikipedia(sp) {
  const name = cleanName(sp.la);
  const j = await getJson(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages|info&piprop=thumbnail&pithumbsize=640&inprop=url&redirects=1&titles=${encodeURIComponent(name)}`);
  const page = Object.values(j?.query?.pages || {})[0];
  const src = page?.thumbnail?.source;
  if (!src) return null;
  const file = decodeURIComponent(src.split('/').slice(-2, -1)[0] || '');
  const meta = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata&titles=File:${encodeURIComponent(file)}`);
  const em = Object.values(meta?.query?.pages || {})[0]?.imageinfo?.[0]?.extmetadata;
  const lic = (em?.LicenseShortName?.value || '').toLowerCase();
  if (!em || !/cc|public domain|pd/.test(lic)) return null;
  const artist = (em.Artist?.value || 'Wikimedia Commons').replace(/<[^>]+>/g, '').trim();
  return { url: src, credit: `${artist}, ${em.LicenseShortName.value}`, license: lic.replace(/\s+/g, '-'), source: 'Wikimedia Commons', page: page.fullurl };
}

async function download(url, dest) {
  const code = curl(url, dest).slice(-3);
  return code === '200' && fs.existsSync(dest) && fs.statSync(dest).size > 2000;
}

const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
let n = 0;
for (const sp of SPECIES) {
  if (only && !only.has(sp.c)) continue;
  const dest = path.join(outDir, `${sp.c.toLowerCase()}.jpg`);
  if (photos[sp.c] && fs.existsSync(dest)) continue;
  let info = null;
  try { info = (await fromINat(sp)) || (await fromWikipedia(sp)); } catch (e) { console.log('ERR', sp.c, e.message); }
  if (info && (await download(info.url, dest))) {
    photos[sp.c] = { credit: info.credit, license: info.license, source: info.source, page: info.page };
    fs.writeFileSync(photosFile, JSON.stringify(photos));
  } else misses.push(sp.c);
  if (++n % 20 === 0) console.log(`${n} done, ${Object.keys(photos).length} photos, ${misses.length} misses`);
  await sleep(700);
}
console.log(`DONE photos=${Object.keys(photos).length} misses=${misses.length}\n${misses.join(' ')}`);
