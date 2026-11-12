// Integration test: boots the real Colyseus server and drives it with simulated clients.
import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client, type Room } from '@colyseus/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultLoadout } from '@shared/classes';
import { PROTOCOL_VERSION } from '@shared/config';
import { C2S, ROOM_CONQUEST, S2C, type SnapMsg, type WelcomeMsg, decodeSnapshot, packCmd } from '@shared/protocol';
import type { OwnerSnap, RosterEntry, Snapshot } from '@shared/types';

const PORT = 2599;
const URL_HTTP = `http://localhost:${PORT}`;
let proc: ChildProcess;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Bot {
  room!: Room; id = -1; snaps = 0; last: Snapshot | null = null; me: OwnerSnap | null = null; roster: RosterEntry[] = []; seq = 0; code = '';
  async join(opts: Record<string, unknown> = {}, mode: 'joinOrCreate' | 'create' | 'join' = 'joinOrCreate') {
    const client = new Client(URL_HTTP);
    this.room = await client[mode](ROOM_CONQUEST, { name: `Sim${Math.floor(Math.random() * 999)}`, loadout: defaultLoadout(0), level: 5, protocol: PROTOCOL_VERSION, ...opts });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no welcome')), 8000);
      this.room.onMessage(S2C.WELCOME, (w: WelcomeMsg) => { this.id = w.id; this.code = w.code; clearTimeout(t); resolve(); });
      this.room.onMessage(S2C.SNAP, (m: SnapMsg) => { this.snaps++; this.last = decodeSnapshot(new Uint8Array(m.b)); this.me = m.me ?? null; });
      this.room.onMessage(S2C.ROSTER, (r: RosterEntry[]) => { this.roster = r; });
      this.room.onMessage('*', () => undefined);
    });
    return this;
  }
  send(n: number, o: { mz?: number; yaw?: number; buttons?: number } = {}) {
    const batch = [];
    for (let i = 0; i < n; i++) batch.push(packCmd({ seq: ++this.seq, buttons: o.buttons ?? 0, mx: 0, mz: o.mz ?? 0, yaw: o.yaw ?? 0, pitch: 0, slot: 0, viewTick: this.last?.tick ?? 0 }));
    this.room.send(C2S.CMD, batch);
  }
}

beforeAll(async () => {
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: fileURLToPath(new URL('../../server', import.meta.url)), env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${URL_HTTP}/api/health`)).ok) return; } catch { /* not up yet */ } await sleep(250); }
  throw new Error('server did not start');
}, 30000);
afterAll(() => { proc?.kill('SIGTERM'); });

describe('multiplayer server', () => {
  it('synchronises four simulated clients in one authoritative match', async () => {
    const bots = await Promise.all([0, 1, 2, 3].map(() => new Bot().join()));
    expect(new Set(bots.map((b) => b.id)).size).toBe(4);
    expect(new Set(bots.map((b) => b.room.roomId)).size).toBe(1);
    await sleep(1500);
    const roster = bots[0].roster;
    expect(roster.length).toBe(16); // 8 v 8, bots fill empty seats
    const humans = roster.filter((r) => !r.bot);
    expect(humans.length).toBe(4);
    expect(humans.filter((r) => r.team === 1).length).toBe(2); // team balancing
    // snapshot rate ≈ 20 Hz, not per rendered frame
    const s0 = bots[0].snaps; await sleep(2000);
    const rate = (bots[0].snaps - s0) / 2;
    expect(rate).toBeGreaterThan(15); expect(rate).toBeLessThan(25);
    // wait for the match to go live, deploy and move: the server owns the position
    for (let i = 0; i < 60 && bots[0].last?.phase !== 'live'; i++) await sleep(250);
    expect(bots[0].last?.phase).toBe('live');
    const b = bots[0];
    b.room.send(C2S.SPAWN, { point: -1, loadout: defaultLoadout(0) });
    for (let i = 0; i < 40 && !b.me?.alive; i++) await sleep(100);
    expect(b.me?.alive).toBe(true);
    const start = { x: b.me!.state.x, z: b.me!.state.z };
    for (let i = 0; i < 45; i++) { b.send(2, { mz: 1, yaw: b.me!.state.yaw }); await sleep(33); }
    await sleep(300);
    const moved = Math.hypot(b.me!.state.x - start.x, b.me!.state.z - start.z);
    expect(moved).toBeGreaterThan(3); expect(moved).toBeLessThan(9); // ~1.5 s at walking speed, no speed-up from spamming
    expect(b.me!.ack).toBeGreaterThan(60);
    // other clients see the same authoritative position
    const seen = bots[1].last!.players.find((p) => p.id === b.id)!;
    expect(Math.hypot(seen.x - b.me!.state.x, seen.z - b.me!.state.z)).toBeLessThan(1.5);
    // hostile / malformed traffic must not crash the room or change state
    b.room.send(C2S.CMD, 'garbage'); b.room.send(C2S.CMD, [[1, 2], null, [NaN]]); b.room.send(C2S.SPAWN, null);
    b.room.send(C2S.LOADOUT, { classId: 99, primary: 'x' }); b.room.send(C2S.TEAM, 7); b.room.send('score', { kills: 999 });
    await sleep(600);
    expect(bots[1].roster.find((r) => r.id === b.id)!.kills).toBe(0);
    expect(bots[1].snaps).toBeGreaterThan(40);
    // room browser API
    const rooms = (await (await fetch(`${URL_HTTP}/api/rooms`)).json()) as { roomId: string; clients: number; maxClients: number }[];
    expect(rooms.length).toBe(1); expect(rooms[0].clients).toBe(4); expect(rooms[0].maxClients).toBe(16);
    // a departing player is either removed at once (consented leave) or flagged disconnected while the
    // reconnection window is open (dropped socket) – either way the others see it
    await bots[3].room.leave(true);
    await sleep(1500);
    // (the client that sent hostile traffic above may additionally have been disconnected by the server)
    const connected = bots[1].roster.filter((r) => !r.bot && r.connected).length;
    expect(connected).toBeLessThanOrEqual(3); expect(connected).toBeGreaterThanOrEqual(2);
    expect(bots[1].roster.length).toBe(16);
    for (const x of bots.slice(0, 3)) await x.room.leave(true);
  }, 60000);

  it('supports private rooms joined by code and rejects wrong protocol versions', async () => {
    const host = await new Bot().join({ private: true, code: 'ALPHA1' }, 'create');
    expect(host.code).toBe('ALPHA1');
    const friend = await new Bot().join({ private: true, code: 'ALPHA1' }, 'join');
    expect(friend.room.roomId).toBe(host.room.roomId);
    const rooms = (await (await fetch(`${URL_HTTP}/api/rooms`)).json()) as { roomId: string; clients: number; maxClients: number }[];
    expect(rooms.find((r) => r.roomId === host.room.roomId)).toBeUndefined(); // hidden from the browser
    await expect(new Bot().join({ private: true, code: 'WRONG9' }, 'join')).rejects.toBeTruthy();
    await expect(new Bot().join({ protocol: 1 })).rejects.toBeTruthy();
    await host.room.leave(true); await friend.room.leave(true);
  }, 30000);
});
