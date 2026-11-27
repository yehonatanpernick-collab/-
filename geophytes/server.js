// שרת מקומי לאפליקציית הגאופיטים.
// מגיש את הקבצים, ובאופן אופציונלי מעביר בקשות ל-Claude כשהמפתח שמור בשרת (ולא בדפדפן).
// הרצה:  ANTHROPIC_API_KEY=sk-ant-... node geophytes/server.js   ->  http://localhost:8090
// באפליקציה: הגדרות ← אופן החיבור ← "דרך השרת".
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8090;
const ROOT = __dirname;
const KEY = process.env.ANTHROPIC_API_KEY || '';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};
const FORWARD = ['content-type', 'anthropic-version', 'anthropic-beta', 'accept'];

async function proxy(req, res, apiPath) {
  if (!KEY) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"ANTHROPIC_API_KEY is not set on the server"}'); }
  if (req.method !== 'POST' || !/^\/v1\/messages(\/count_tokens)?$/.test(apiPath)) { res.writeHead(404); return res.end(); }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { 'x-api-key': KEY };
  for (const h of FORWARD) if (req.headers[h]) headers[h] = req.headers[h];
  try {
    const upstream = await fetch(`https://api.anthropic.com${apiPath}`, { method: 'POST', headers, body: Buffer.concat(chunks) });
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
    for await (const part of upstream.body) res.write(part);
    res.end();
  } catch (e) {
    res.writeHead(502); res.end(String(e));
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/anthropic/')) return proxy(req, res, url.pathname.slice('/anthropic'.length));
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}tools${path.sep}`)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`אתגר הגאופיטים: http://localhost:${PORT}  (proxy ${KEY ? 'פעיל' : 'כבוי – אין ANTHROPIC_API_KEY'})`));
