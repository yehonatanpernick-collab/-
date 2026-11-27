// שלב 1: אוסף מועמדות לתמונות לכל מין (iNaturalist – רישיון CC בלבד) ומוריד גרסת medium לניתוח איכות.
// פלט: cand/<code>/NN.jpg + cand/<code>/meta.json.   הרצה: node tools/photos-candidates.mjs [code1,code2]
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candDir = path.join(root, 'cand');
fs.mkdirSync(candDir, { recursive: true });
const { SPECIES } = await import(path.join(root, 'data', 'species.js'));

const ALLOWED = new Set(['cc0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa']);
const LIC_Q = 'cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa';
const UA = 'geophytes-app/1.0 (personal field checklist)';
const POOL = 14;
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
  'Ophrys holosericea': 'Ophrys holoserica', 'Nothoscordum borbonicum': 'Nothoscordum gracile', 'Narcissus deficiens': 'Narcissus serotinus',
};
const TAXON_ID = { anafei: 1077391, tulauc: 860616, ROMPET: 1191474 };
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

async function candidates(sp) {
  const out = [];
  const seen = new Set();
  const add = (p, page, prior) => {
    if (!p || !ALLOWED.has(p.license_code) || seen.has(p.id)) return;
    const w = p.original_dimensions?.width || 0;
    if (w && w < 1200) return; // לא מספיק חד/גדול
    seen.add(p.id);
    out.push({ id: p.id, medium: p.url.replace('square', 'medium'), large: p.url.replace('square', 'large'), credit: p.attribution, license: p.license_code, page, prior, width: w });
  };
  for (const name of names(sp.la)) {
    const t = TAXON_ID[sp.c] ? { id: TAXON_ID[sp.c] } : await findTaxon(name);
    if (!t) continue;
    // רק תצפיות שסומנו ב-iNaturalist כ"פורח" (Plant Phenology = Flowering), לפי מספר המועדפים – כך מקבלים תמונות של הצמח בפריחה.
    const q = `taxon_id=${t.id}&photo_license=${LIC_Q}&quality_grade=research&order_by=votes&per_page=40&photos=true`;
    const flowering = await getJson(`https://api.inaturalist.org/v1/observations?${q}&term_id=12&term_value_id=13`);
    (flowering?.results || []).forEach((ob, i) => (ob.photos || []).slice(0, 1).forEach((p) => add(p, `https://www.inaturalist.org/observations/${ob.id}`, i)));
    if (out.length < 6) { // מין עם מעט תצפיות מסומנות – משלימים מכל התצפיות המחקריות
      const all = await getJson(`https://api.inaturalist.org/v1/observations?${q}`);
      (all?.results || []).forEach((ob, i) => (ob.photos || []).slice(0, 1).forEach((p) => add(p, `https://www.inaturalist.org/observations/${ob.id}`, 20 + i)));
    }
    if (out.length >= POOL) break;
  }
  return out.slice(0, POOL);
}

const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const todo = SPECIES.filter((s) => !only || only.has(s.c));
let i = 0, done = 0;
async function worker() {
  while (i < todo.length) {
    const sp = todo[i++];
    const dir = path.join(candDir, sp.c.toLowerCase());
    if (fs.existsSync(path.join(dir, 'meta.json'))) { done++; continue; }
    fs.mkdirSync(dir, { recursive: true });
    const list = await candidates(sp).catch(() => []);
    const kept = [];
    for (const c of list) {
      const dest = path.join(dir, `${String(kept.length).padStart(2, '0')}.jpg`);
      const code = (await curl(c.medium, dest)).slice(-3);
      if (code === '200' && fs.existsSync(dest) && fs.statSync(dest).size > 4000) kept.push(c);
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(kept));
    if (++done % 10 === 0) console.log(`${done}/${todo.length}`);
    await sleep(200);
  }
}
await Promise.all([worker(), worker(), worker()]);
console.log('DONE');
