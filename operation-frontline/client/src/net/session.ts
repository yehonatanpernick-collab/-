// A Session is the game client's only link to the authoritative simulation.
//  * LocalSession  – runs GameSim in the browser (offline training, no server needed).
//  * NetSession    – talks to the Colyseus room over WebSockets.
// The game code is identical for both: commands go in, snapshots / events come out.
import { PROTOCOL_VERSION, SIM, type TeamId } from '@shared/config';
import { C2S, ROOM_CONQUEST, S2C, type SnapMsg, type WelcomeMsg, decodeSnapshot, packCmd } from '@shared/protocol';
import { GameSim } from '@shared/sim/GameSim';
import type { Cmd, MatchOptions, MatchResult, RosterEntry, SimEvent, Snapshot } from '@shared/types';
import type { Loadout } from '@shared/weapons';
import type { MapData } from '@shared/world/MapBuilder';
import { Client, type Room } from '@colyseus/sdk';

export interface SessionHandlers {
  onSnapshot(s: Snapshot): void;
  onEvents(e: SimEvent[]): void;
  onRoster(r: RosterEntry[]): void;
  onResult(r: MatchResult): void;
  onStatus(status: 'connected' | 'reconnecting' | 'disconnected', detail?: string): void;
}

export interface Session {
  readonly kind: 'local' | 'net';
  readonly myId: number;
  readonly options: MatchOptions;
  readonly destroyed: number[];
  readonly roomCode: string;
  /** Round-trip time in milliseconds (0 for local sessions). */
  ping: number;
  /** Snapshots per second this session delivers. */
  readonly snapshotRate: number;
  handlers: SessionHandlers | null;
  sendCmd(cmd: Cmd): void;
  spawn(point: number, loadout: Loadout): void;
  setLoadout(loadout: Loadout): void;
  requestTeam(team: TeamId): void;
  update(dt: number): void;
  leave(): void;
}

// ---------------------------------------------------------------------- local
export class LocalSession implements Session {
  readonly kind = 'local' as const;
  readonly sim: GameSim;
  readonly myId: number;
  readonly options: MatchOptions;
  readonly destroyed: number[] = [];
  readonly roomCode = '';
  readonly snapshotRate = SIM.TICK_RATE;
  ping = 0;
  handlers: SessionHandlers | null = null;
  private acc = 0;
  private rosterT = 0;
  private resultSent = false;
  paused = false;

  constructor(options: Partial<MatchOptions>, map: MapData, name: string, loadout: Loadout, level: number) {
    this.sim = new GameSim(options, map);
    this.options = this.sim.opts;
    this.myId = this.sim.addPlayer({ name, loadout, level, team: 1 }).id;
  }

  sendCmd(cmd: Cmd): void { this.sim.queueCmd(this.myId, { ...cmd }); }
  spawn(point: number, loadout: Loadout): void { this.sim.requestSpawn(this.myId, point, loadout); }
  setLoadout(loadout: Loadout): void { this.sim.setLoadout(this.myId, loadout); }
  requestTeam(team: TeamId): void { this.sim.requestTeam(this.myId, team); }

  update(dt: number): void {
    if (this.paused) return;
    this.acc = Math.min(this.acc + dt, 0.25);
    let stepped = false;
    while (this.acc >= SIM.TICK_DT) {
      this.acc -= SIM.TICK_DT;
      this.sim.step();
      stepped = true;
      const ev = this.sim.drainEvents();
      if (ev.length) this.handlers?.onEvents(ev);
    }
    if (!stepped) return;
    const snap = this.sim.snapshot();
    snap.me = this.sim.ownerSnap(this.myId);
    this.handlers?.onSnapshot(snap);
    this.rosterT -= dt;
    if (this.sim.rosterDirty && this.rosterT <= 0) {
      this.sim.rosterDirty = false;
      this.rosterT = 0.4;
      this.handlers?.onRoster(this.sim.roster());
    }
    if (this.sim.phase === 'ended') {
      if (!this.resultSent) { this.resultSent = true; this.handlers?.onResult(this.sim.result()); }
    } else this.resultSent = false;
  }

  leave(): void { this.handlers = null; }
}

// ---------------------------------------------------------------------- network
export interface RoomInfo { roomId: string; name: string; clients: number; maxClients: number; phase: string; map: string; locked: boolean; teamA: number; teamB: number; bots: number }

export function serverHttpUrl(custom: string): string {
  if (custom) return custom.replace(/^ws/, 'http').replace(/\/$/, '');
  const env = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL;
  if (env) return env.replace(/^ws/, 'http').replace(/\/$/, '');
  // dev: the Vite client runs on 5173/4173 and the game server on 2567; production: same origin
  if (location.port === '5173' || location.port === '4173') return `${location.protocol}//${location.hostname}:2567`;
  return location.origin;
}

export async function fetchRooms(custom: string): Promise<RoomInfo[]> {
  const res = await fetch(`${serverHttpUrl(custom)}/api/rooms`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`server answered ${res.status}`);
  return (await res.json()) as RoomInfo[];
}

export interface JoinRequest {
  mode: 'quick' | 'join' | 'private-create' | 'private-join';
  roomId?: string;
  code?: string;
  name: string;
  loadout: Loadout;
  level: number;
  serverUrl: string;
}

export class NetSession implements Session {
  readonly kind = 'net' as const;
  myId = -1;
  options!: MatchOptions;
  destroyed: number[] = [];
  roomCode = '';
  readonly snapshotRate = SIM.SNAPSHOT_RATE;
  ping = 0;
  handlers: SessionHandlers | null = null;
  private pingT = 0;
  private pingSent = 0;
  private outbox: ReturnType<typeof packCmd>[] = [];
  private sendT = 0;
  private left = false;

  private constructor(private readonly room: Room) {}

  static async connect(req: JoinRequest): Promise<NetSession> {
    const client = new Client(serverHttpUrl(req.serverUrl));
    const opts = { name: req.name, loadout: req.loadout, level: req.level, protocol: PROTOCOL_VERSION, code: req.code };
    let room: Room;
    if (req.mode === 'join' && req.roomId) room = await client.joinById(req.roomId, opts);
    else if (req.mode === 'private-create') room = await client.create(ROOM_CONQUEST, { ...opts, private: true });
    else if (req.mode === 'private-join') room = await client.join(ROOM_CONQUEST, { ...opts, private: true });
    else room = await client.joinOrCreate(ROOM_CONQUEST, opts);
    const session = new NetSession(room);
    await session.init();
    return session;
  }

  private init(): Promise<void> {
    const room = this.room;
    room.reconnection.maxRetries = 8;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The server did not answer in time.')), 12000);
      room.onMessage(S2C.WELCOME, (w: WelcomeMsg) => {
        this.myId = w.id; this.options = w.options; this.destroyed = w.destroyed; this.roomCode = w.code;
        clearTimeout(timer);
        resolve();
      });
      room.onMessage(S2C.SNAP, (m: SnapMsg) => {
        const snap = decodeSnapshot(m.b instanceof Uint8Array ? m.b : new Uint8Array(m.b as ArrayLike<number>));
        snap.me = m.me;
        this.handlers?.onSnapshot(snap);
      });
      room.onMessage(S2C.EVENTS, (e: SimEvent[]) => this.handlers?.onEvents(e));
      room.onMessage(S2C.ROSTER, (r: RosterEntry[]) => this.handlers?.onRoster(r));
      room.onMessage(S2C.RESULT, (r: MatchResult) => this.handlers?.onResult(r));
      room.onMessage(S2C.PONG, () => { this.ping = Math.round(performance.now() - this.pingSent); });
      room.onMessage(S2C.ERROR, (msg: string) => this.handlers?.onStatus('disconnected', String(msg)));
      room.onDrop(() => this.handlers?.onStatus('reconnecting'));
      room.onReconnect(() => this.handlers?.onStatus('connected'));
      room.onLeave((code: number, reason?: string) => {
        if (this.left) return;
        clearTimeout(timer);
        this.handlers?.onStatus('disconnected', reason || (code === 4002 ? 'Room is full.' : `Connection closed (${code}).`));
        reject(new Error(reason || `Connection closed (${code})`));
      });
      room.onError((code: number, message?: string) => console.warn('[net] room error', code, message));
    });
  }

  sendCmd(cmd: Cmd): void { this.outbox.push(packCmd(cmd)); }
  spawn(point: number, loadout: Loadout): void { this.room.send(C2S.SPAWN, { point, loadout }); }
  setLoadout(loadout: Loadout): void { this.room.send(C2S.LOADOUT, loadout); }
  requestTeam(team: TeamId): void { this.room.send(C2S.TEAM, team); }

  update(dt: number): void {
    // batch commands: one network message per simulation tick instead of one per command
    this.sendT += dt;
    if (this.sendT >= SIM.TICK_DT && this.outbox.length > 0) {
      this.sendT = 0;
      if (this.outbox.length > SIM.MAX_CMD_QUEUE) this.outbox.splice(0, this.outbox.length - SIM.MAX_CMD_QUEUE);
      this.room.send(C2S.CMD, this.outbox);
      this.outbox = [];
    }
    this.pingT -= dt;
    if (this.pingT <= 0) {
      this.pingT = 2;
      this.pingSent = performance.now();
      this.room.send(C2S.PING, this.ping);
    }
  }

  leave(): void {
    this.left = true;
    this.handlers = null;
    void this.room.leave(true).catch(() => undefined);
  }
}
