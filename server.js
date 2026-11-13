// Local server for markets3d.html — serves the page and proxies Yahoo Finance
// so the browser gets live index data without relying on public CORS proxies.
// Usage: node server.js   (Node 18+, no dependencies)  ->  http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const SYMBOL_RE = /^[\^A-Za-z0-9.\-=]{1,20}$/;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/chart') {
    const sym = url.searchParams.get('symbol') || '';
    if (!SYMBOL_RE.test(sym)) { res.writeHead(400); return res.end('bad symbol'); }
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=5m&includePrePost=false`,
        { headers: { 'User-Agent': 'Mozilla/5.0 markets3d' } });
      const body = await r.text();
      res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(body);
    } catch (e) {
      res.writeHead(502); return res.end(String(e));
    }
  }
  // Alpine RZR Wilderness (rzr/): static files with real MIME types (ES modules need them)
  if (url.pathname === '/rzr' || url.pathname.startsWith('/rzr/')) {
    const root = path.join(__dirname, 'rzr');
    let rel = decodeURIComponent(url.pathname.slice(4)) || '/';
    if (rel.endsWith('/')) rel += 'index.html';
    const fp = path.normalize(path.join(root, rel));
    if (!fp.startsWith(root + path.sep) || fp.includes(`${path.sep}_raw${path.sep}`)) { res.writeHead(403); return res.end('forbidden'); }
    const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gz': 'application/octet-stream' };
    return fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'max-age=3600' });
      res.end(data);
    });
  }
  const file = url.pathname === '/' ? 'markets3d.html' : path.basename(url.pathname);
  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`עיר המדדים: http://localhost:${PORT}`));
