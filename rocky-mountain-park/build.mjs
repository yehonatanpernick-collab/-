// Bundles src/ into one self-contained page: park.html (artifact body) and index.html (standalone).
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const common = { bundle: true, format: 'esm', target: 'es2020', minify: process.argv.includes('--min'), legalComments: 'none' };
const worker = await esbuild.build({ ...common, entryPoints: ['src/worker.js'], format: 'iife', write: false });
const main = await esbuild.build({
  ...common, entryPoints: ['src/main.js'], write: false,
  external: ['three', 'three/addons/*'],
  define: { WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text) },
});
const shell = readFileSync('src/shell.html', 'utf8');
const js = main.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const page = shell.replace('/*__MAIN__*/', () => js);
writeFileSync('park.html', page);
writeFileSync('index.html', '<!doctype html>\n<html lang="he" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n' + page + '\n</html>\n');
console.log(`park.html ${(page.length / 1024).toFixed(0)} KB`);
