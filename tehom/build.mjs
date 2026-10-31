import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/main.js'],
  bundle: true, minify: true, format: 'iife', write: false,
  target: ['es2020'], legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('src/style.css', 'utf8');
const html = readFileSync('src/shell.html', 'utf8')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);
writeFileSync('index.html', html);
console.log('built index.html', (html.length / 1024).toFixed(0) + ' KB');
