// Post-process the artifact build: binary assets → base64 .txt (served type), and write the page body (page.html).
import fs from 'node:fs'; import path from 'node:path';
const D = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist-artifact');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
let n = 0;
for (const f of walk(D)) if (/\.(glb|hdr)$/.test(f)) { fs.writeFileSync(f + '.txt', fs.readFileSync(f).toString('base64')); fs.unlinkSync(f); n++; }
for (const f of walk(D)) if (/brick_[cnr]\.jpg$/.test(f)) fs.unlinkSync(f); // unused
const html = fs.readFileSync(path.join(D, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1], body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const scripts = head.match(/<script type="module"[^>]*><\/script>/g) || [];
let h = head.replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, ''); for (const s of scripts) h = h.replace(s, '');
const title = h.match(/<title>[\s\S]*?<\/title>/)[0]; h = h.replace(title, '');
fs.writeFileSync(path.join(D, 'page.html'), `${title}\n${h.trim()}\n${body.trim()}\n${scripts.join('\n')}\n`);
const files = walk(D).map((f) => path.relative(D, f)).filter((f) => f !== 'index.html' && f !== 'page.html');
fs.writeFileSync(path.join(D, '..', 'artifact-files.json'), JSON.stringify(files));
const size = files.reduce((s, f) => s + fs.statSync(path.join(D, f)).size, 0);
console.log('packed', n, 'binaries;', files.length, 'files,', (size / 1e6).toFixed(1), 'MB');
