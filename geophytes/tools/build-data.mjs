// בונה את data/species.js מתוך רשימת המינים (list.tsv) ונתוני העמודים שחולצו מ-flora.org.il (raw/*.json).
// הרצה: node tools/build-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(root, 'data', 'raw');
const { GENERA } = await import(path.join(root, 'data', 'genera.js'));
const { REGIONS, EXTRA_REGIONS } = await import(path.join(root, 'data', 'regions.js'));

const regionCodes = new Set(REGIONS.map((r) => r.code));
const extraCodes = new Set(Object.keys(EXTRA_REGIONS));
const heToCode = Object.fromEntries([
  ...REGIONS.map((r) => [r.name, r.code]),
  ...Object.entries(EXTRA_REGIONS).map(([c, n]) => [n, c]),
]);

const list = fs.readFileSync(path.join(rawDir, 'list.tsv'), 'utf8').trim().split('\n').map((l) => {
  const [c, he, la] = l.split('\t');
  return { c, he, la };
});

const details = new Map();
for (const f of fs.readdirSync(rawDir).filter((f) => f.endsWith('.json')).sort()) {
  const json = JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8'));
  for (const p of json.p) details.set(p.c.toLowerCase(), p);
}

const warnings = [];
const species = list.map(({ c, he, la }) => {
  const d = details.get(c.toLowerCase());
  const genus = la.split(' ')[0];
  if (!GENERA[genus]) warnings.push(`no genus info: ${genus}`);
  const rec = { c, he, la, g: genus, r: {}, x: {}, f: [], t: '', z: '', o: 'O', h: '', s: '' };
  if (!d) { warnings.push(`no details: ${c}`); return rec; }
  for (const part of (d.r || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(.*?)(\d)?$/);
    let code = m[1].trim();
    const ab = m[2] !== undefined ? Number(m[2]) : 0;
    if (!regionCodes.has(code) && !extraCodes.has(code)) code = heToCode[code] || code;
    if (regionCodes.has(code)) rec.r[code] = ab;
    else if (extraCodes.has(code)) rec.x[code] = ab;
    else warnings.push(`${c}: unknown region "${part}"`);
  }
  rec.f = (d.f || '').split(',').map((n) => Number(n)).filter((n) => n >= 1 && n <= 12);
  rec.t = (d.t || '').replace(/[^ERDPIXA]/g, '');
  rec.z = (d.z || '').replace(/[^MBTDHS]/g, '');
  rec.o = /^[BCRTO]$/.test(d.o) ? d.o : 'O';
  rec.h = (d.h || '').trim();
  rec.s = (d.s || '').trim();
  if (!Object.keys(rec.r).length) warnings.push(`${c}: no Israeli region`);
  return rec;
});

const out = `// נוצר אוטומטית ע"י tools/build-data.mjs – אל תערכו ידנית.\n// מקור: צמחיית ישראל וסביבתה (flora.org.il), צורת חיים: גיאופיט – ${species.length} טקסונים.\nexport const SPECIES = ${JSON.stringify(species)};\n`;
fs.writeFileSync(path.join(root, 'data', 'species.js'), out);
console.log(`wrote ${species.length} species, ${details.size} detail records`);
if (warnings.length) console.log('warnings:\n' + warnings.join('\n'));
