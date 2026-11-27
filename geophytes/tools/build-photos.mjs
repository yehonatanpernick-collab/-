// יוצר data/photos.js מתוך data/photos.json (רק תמונות שקיימות בפועל בתיקיית img).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const photos = JSON.parse(fs.readFileSync(path.join(root, 'data', 'photos.json'), 'utf8'));
const out = {};
for (const [code, info] of Object.entries(photos)) if (fs.existsSync(path.join(root, 'img', `${code.toLowerCase()}.jpg`))) out[code] = info;
fs.writeFileSync(path.join(root, 'data', 'photos.js'), `// נוצר אוטומטית ע"י tools/build-photos.mjs\nexport const PHOTOS = ${JSON.stringify(out)};\n`);
console.log(Object.keys(out).length, 'photos');
