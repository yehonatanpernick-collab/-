// OPERATION: FRONTLINE game server (Colyseus over WebSockets).
// Also serves the room list API and, in production, the built client.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GAME_VERSION } from '@shared/config';
import { ROOM_CONQUEST } from '@shared/protocol';
import express from 'express';
import { ConquestRoom } from './ConquestRoom';

const port = Number(process.env.PORT ?? 2567);
const here = dirname(fileURLToPath(import.meta.url));
const clientDist = [join(here, '../../client/dist'), join(here, '../client/dist')].find((p) => existsSync(join(p, 'index.html')));

const server = new Server({
  transport: new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3 }),
  greet: false,
  express: (app) => {
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
      next();
    });
    app.get('/api/health', (_req, res) => { res.json({ ok: true, version: GAME_VERSION }); });
    app.get('/api/rooms', async (_req, res) => {
      try {
        const rooms = await matchMaker.query({ name: ROOM_CONQUEST });
        res.json(rooms.filter((r) => !r.private && !r.metadata?.private).map((r) => ({
          roomId: r.roomId, name: `Conquest #${r.roomId.slice(0, 4).toUpperCase()}`, clients: r.clients, maxClients: r.maxClients,
          phase: r.metadata?.phase ?? 'live', map: r.metadata?.map ?? 'KESTREL CROSSING', locked: !!r.locked,
          teamA: r.metadata?.teamA ?? 0, teamB: r.metadata?.teamB ?? 0, bots: r.metadata?.bots ?? 0,
        })));
      } catch { res.status(500).json([]); }
    });
    if (clientDist) app.use(express.static(clientDist, { maxAge: '1h' }));
  },
});

// rooms are matched by private code: public rooms have none
server.define(ROOM_CONQUEST, ConquestRoom).filterBy(['code']);

server.listen(port).then(() => {
  console.log(`[frontline] server v${GAME_VERSION} listening on :${port}${clientDist ? ' (serving client build)' : ''}`);
}).catch((e) => { console.error('[frontline] failed to start', e); process.exit(1); });
