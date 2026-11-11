// IRON HORIZON dedicated server (Node 18+, zero dependencies).
//   node server.js            -> http://localhost:8080  (game + WebSocket at /ws)
//   PORT=9000 BOTS=32 SKILL=0.7 node server.js
// Serves the client, runs the authoritative 20 Hz simulation (bots fill empty slots) and
// speaks a minimal RFC 6455 WebSocket implementation.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Sim } from './src/shared/sim.js';
import { TICK_DT } from './src/shared/config.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 8080;
const BOTS = Math.max(0, Math.min(64, +(process.env.BOTS ?? 24)));
const SKILL = Math.max(0.1, Math.min(1, +(process.env.SKILL ?? 0.6)));
const NAME = process.env.SERVER_NAME || 'IRON HORIZON · Varesh Crossing';
const MAX_HUMANS = +process.env.MAX_PLAYERS || 32;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };

const sim = new Sim({ seed: 1337, bots: BOTS, skill: SKILL });
for (let i = 0; i < 40; i++) sim.tick();
let humans = 0;

// ---------------------------------------------------------------- HTTP
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ name: NAME, humans, players: sim.players.size, max: Math.max(BOTS, MAX_HUMANS), tickets: sim.tickets.slice(1), phase: sim.phase }));
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}node_modules${path.sep}`) || path.basename(file).startsWith('.')) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------------------------------------------------------------- WebSocket
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function frame(payload, opcode = 1) {
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  if (humans >= MAX_HUMANS) { socket.end('HTTP/1.1 503 Server Full\r\n\r\n'); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  humans++;
  let alive = true;
  const send = (msg) => {
    if (!alive) return;
    if (socket.writableLength > 2_000_000 && msg.t === 's') return; // slow client: drop snapshots
    socket.write(frame(Buffer.from(JSON.stringify(msg))));
  };
  const cid = sim.addClient(send);
  let buf = Buffer.alloc(0), frag = [], msgCount = 0, msgWindow = Date.now();
  const close = () => {
    if (!alive) return;
    alive = false; humans--;
    sim.removeClient(cid);
    try { socket.end(frame(Buffer.alloc(0), 8)); } catch (e) { /* closed */ }
    socket.destroy();
  };
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 1_000_000) return close();
    while (buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 256_000) return close();
      const total = off + (masked ? 4 : 0) + len;
      if (buf.length < total) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), total);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.subarray(total);
      if (op === 8) return close();
      if (op === 9) { socket.write(frame(payload, 10)); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) {
        frag.push(payload);
        if (!fin) continue;
        const text = Buffer.concat(frag).toString('utf8');
        frag = [];
        // simple flood protection (inputs arrive at ~30 Hz plus shots)
        const now = Date.now();
        if (now - msgWindow > 1000) { msgWindow = now; msgCount = 0; }
        if (++msgCount > 400) continue;
        let m;
        try { m = JSON.parse(text); } catch (e) { continue; }
        try { sim.handle(cid, m); } catch (e) { console.error('handle error', e); }
      }
    }
  });
  socket.on('close', close);
  socket.on('error', close);
});

// ---------------------------------------------------------------- simulation loop
let next = performance.now();
function loop() {
  const now = performance.now();
  let steps = 0;
  while (now >= next && steps < 4) {
    try { sim.tick(TICK_DT); } catch (e) { console.error('tick error', e); }
    next += TICK_DT * 1000; steps++;
  }
  if (now - next > 1000) next = now; // fell far behind: resync
  setTimeout(loop, Math.max(1, next - performance.now()));
}
loop();

server.listen(PORT, () => {
  console.log(`\n  ${NAME}`);
  console.log(`  Play:   http://localhost:${PORT}`);
  console.log(`  Bots:   ${BOTS} slots (filled with AI when players are missing), skill ${SKILL}`);
  console.log(`  Share your LAN IP (e.g. http://192.168.x.x:${PORT}) so friends can join.\n`);
});
