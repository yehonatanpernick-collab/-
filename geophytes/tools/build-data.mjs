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
  // מיזוג ברמת שדה: ערך לא-ריק בקובץ מאוחר יותר דורס ערך קודם.
  for (const p of json.p) {
    const key = p.c.toLowerCase();
    const prev = details.get(key) || {};
    const merged = { ...prev };
    for (const [k, v] of Object.entries(p)) if (v != null && String(v).trim() !== '') merged[k] = v;
    details.set(key, merged);
  }
}

// תגיות שהגיעו כמילים בעברית → אותיות
function normTags(t) {
  let out = (t || '').replace(/[^ERDPIXA]/g, '');
  const he = t || '';
  if (/תת-אנדמי/.test(he)) out += 'S';
  else if (/אנדמי/.test(he)) out += 'E';
  if (/נדיר(?!\s*-)/.test(he) && !/כמעט נדיר/.test(he)) out += 'R';
  if (/בסכנ|באיום|פגיע/.test(he)) out += 'D';
  if (/פולש|זר /.test(he) || /^זר/.test(he)) out += 'I';
  if (/נכחד/.test(he)) out += 'X';
  return [...new Set(out)].join('');
}

// איבר האגירה האופייני לסוג – משמש כשעמוד המין אינו מציין אותו במפורש.
const GENUS_ORGAN = {
  Allium: 'B', Gagea: 'B', Ornithogalum: 'B', Bellevalia: 'B', Muscari: 'B', Leopoldia: 'B', Scilla: 'B',
  Drimia: 'B', Prospero: 'B', Narcissus: 'B', Pancratium: 'B', Sternbergia: 'B', Tulipa: 'B', Fritillaria: 'B',
  Lilium: 'B', Hyacinthus: 'B', Hyacinthella: 'B', Dipcadi: 'B', Vagaria: 'B', Nothoscordum: 'B', Ixiolirion: 'B',
  Crocus: 'C', Colchicum: 'C', Romulea: 'C', Gladiolus: 'C', Moraea: 'C', Androcymbium: 'C', Biarum: 'C', Arum: 'C',
  Arisarum: 'C', Eminium: 'C', Cyclamen: 'C', Anemone: 'C', Ophrys: 'C', Orchis: 'C', Anacamptis: 'C',
  Serapias: 'C', Himantoglossum: 'C', Neotinea: 'C', Platanthera: 'C', Dactylorhiza: 'T', Bunium: 'C', Leontice: 'C',
  Bongardia: 'C', Corydalis: 'C', Tamus: 'C', Geranium: 'C', Iris: 'R', Ranunculus: 'T', Eremurus: 'T',
  Asparagus: 'R', Arundo: 'R', Phragmites: 'R', Typha: 'R', Nuphar: 'R', Nymphaea: 'R', Butomus: 'R',
  Convolvulus: 'R', Epipactis: 'R', Cephalanthera: 'R', Limodorum: 'R', Sorghum: 'R', Pennisetum: 'R',
  Cynodon: 'R', Cyperus: 'R', Carex: 'R', Piptatherum: 'R', Hyparrhenia: 'R', Ophioglossum: 'R', Isoetes: 'C',
  Umbilicus: 'C', Arisaema: 'C', Aristolochia: 'C', Paeonia: 'T', Biebersteinia: 'T', Delphinium: 'T',
  Scorzonera: 'T', Rumex: 'T', Euphorbia: 'T', Astomaea: 'C', Arrhenatherum: 'C', Oxalis: 'B', Poa: 'B',
  Myriophyllum: 'R', Ambrosia: 'R', Ipomoea: 'T', Stipagrostis: 'R', Ammophila: 'R', Panicum: 'R', Urochloa: 'R',
  Chloris: 'R', Saccharum: 'R',
};

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
  rec.t = normTags(d.t);
  if (rec.t.includes('A')) rec.t = rec.t.replace('A', rec.t.includes('D') ? '' : 'D');
  rec.z = (d.z || '').replace(/[^MBTDHS]/g, '');
  rec.o = /^[BCRT]$/.test(d.o) ? d.o : (GENUS_ORGAN[genus] || 'O');
  rec.h = (d.h || '').trim();
  rec.s = (d.s || '').trim();
  if (!Object.keys(rec.r).length) warnings.push(`${c}: no Israeli region`);
  return rec;
});

// רק גאופיטים "קלאסיים" (בצל / פקעת / קנה שורש של אירוס וסחלבים) – בלי דגנים, צמחי מים, מטפסים ועשבוניים בעלי קנה שורש.
const KEEP_GROUP = 'classic';
const dropped = species.filter((s) => GENERA[s.g]?.group !== KEEP_GROUP).map((s) => s.c);
species.splice(0, species.length, ...species.filter((s) => GENERA[s.g]?.group === KEEP_GROUP));
console.log('dropped non-classic:', dropped.length);
const out = `// נוצר אוטומטית ע"י tools/build-data.mjs – אל תערכו ידנית.\n// מקור: צמחיית ישראל וסביבתה (flora.org.il), צורת חיים: גיאופיט – ${species.length} טקסונים.\nexport const SPECIES = ${JSON.stringify(species)};\n`;
fs.writeFileSync(path.join(root, 'data', 'species.js'), out);
console.log(`wrote ${species.length} species, ${details.size} detail records`);
if (warnings.length) console.log('warnings:\n' + warnings.join('\n'));
