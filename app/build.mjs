// Builds the store app's web bundle (www/): the game page with three.js and its fonts copied
// locally, so the app runs offline and passes store review without external CDNs.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const www = join(here, 'www');
const nm = join(here, 'node_modules');
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

let html = readFileSync(join(here, '..', 'sky-storm', 'index.html'), 'utf8');

html = html.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/([^"]+)/g, (_, rel) => {
  const out = join(www, 'lib', 'three', rel);
  mkdirSync(dirname(out), { recursive: true });
  cpSync(join(nm, 'three', rel), out);
  return `lib/three/${rel}`;
});

const fonts = [['suez-one', ['400']], ['karantina', ['400', '700']], ['frank-ruhl-libre', ['400', '700']]];
const links = [];
for (const [pkg, weights] of fonts) {
  cpSync(join(nm, '@fontsource', pkg), join(www, 'fonts', pkg), { recursive: true });
  for (const w of weights) links.push(`<link rel="stylesheet" href="fonts/${pkg}/${w}.css">`);
}
html = html
  .replace(/<link rel="preconnect"[^>]*>\n?/, '')
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, links.join('\n'));

const leftover = html.match(/https?:\/\/(cdn\.|fonts\.)[^"' )]+/);
if (leftover) throw new Error(`external resource left in the bundle: ${leftover[0]}`);

writeFileSync(join(www, 'index.html'), `<!DOCTYPE html>
<html lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
${html}
</html>
`);
console.log('www/ ready');
