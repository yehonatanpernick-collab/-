// Network message contracts + compact binary snapshot codec.
import type { TeamId } from './config';
import {
  type Cmd, type DeployableSnap, MATCH_PHASES, type MatchOptions, type MatchResult, type ObjectiveSnap, type OwnerSnap,
  type PlayerSnap, type ProjectileSnap, type RosterEntry, type SimEvent, type Snapshot, type VehicleSnap,
} from './types';

export const ROOM_CONQUEST = 'conquest';

/** Client → server message types. */
export const C2S = {
  CMD: 'c',
  SPAWN: 'spawn',
  LOADOUT: 'loadout',
  TEAM: 'team',
  PING: 'pg',
} as const;

/** Server → client message types. */
export const S2C = {
  WELCOME: 'welcome',
  SNAP: 's',
  EVENTS: 'e',
  ROSTER: 'roster',
  RESULT: 'result',
  PONG: 'pg',
  ERROR: 'err',
} as const;

export interface WelcomeMsg {
  id: number;
  map: string;
  options: MatchOptions;
  tick: number;
  /** Ids of dynamic map entities (glass, crates, barrels) that are already destroyed. */
  destroyed: number[];
  roomName: string;
  code: string;
}

export interface SnapMsg { b: Uint8Array; me?: OwnerSnap }
export type EventsMsg = SimEvent[];
export type RosterMsg = RosterEntry[];
export type ResultMsg = MatchResult;

/** Wire format of a command: compact tuple. */
export type CmdTuple = [seq: number, buttons: number, mx: number, mz: number, yaw: number, pitch: number, slot: number, viewTick: number];

export function packCmd(c: Cmd): CmdTuple {
  return [c.seq, c.buttons, Math.round(c.mx * 127), Math.round(c.mz * 127), Math.round(c.yaw * 10000) / 10000, Math.round(c.pitch * 10000) / 10000, c.slot, Math.round(c.viewTick * 100) / 100];
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates and converts an untrusted tuple. Returns null when malformed. */
export function unpackCmd(t: unknown): Cmd | null {
  if (!Array.isArray(t) || t.length < 8) return null;
  for (let i = 0; i < 8; i++) if (!fin(t[i])) return null;
  const [seq, buttons, mx, mz, yaw, pitch, slot, viewTick] = t as number[];
  if (!Number.isInteger(seq) || seq < 0 || !Number.isInteger(buttons) || buttons < 0 || buttons > 0xffff) return null;
  if (!Number.isInteger(slot) || slot < 0 || slot > 3) return null;
  if (Math.abs(yaw) > 1e4 || Math.abs(pitch) > 1.6) return null;
  return {
    seq, buttons,
    mx: Math.max(-1, Math.min(1, mx / 127)),
    mz: Math.max(-1, Math.min(1, mz / 127)),
    yaw, pitch, slot, viewTick,
  };
}

// ---------------------------------------------------------------- binary snapshot
class Writer {
  private buf = new Uint8Array(2048);
  private view = new DataView(this.buf.buffer);
  private o = 0;
  private need(n: number): void {
    if (this.o + n <= this.buf.length) return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.o + n));
    nb.set(this.buf);
    this.buf = nb; this.view = new DataView(nb.buffer);
  }
  u8(v: number): void { this.need(1); this.view.setUint8(this.o, v & 0xff); this.o += 1; }
  i8(v: number): void { this.need(1); this.view.setInt8(this.o, Math.max(-128, Math.min(127, Math.round(v)))); this.o += 1; }
  u16(v: number): void { this.need(2); this.view.setUint16(this.o, Math.max(0, Math.min(65535, Math.round(v))), true); this.o += 2; }
  i16(v: number): void { this.need(2); this.view.setInt16(this.o, Math.max(-32768, Math.min(32767, Math.round(v))), true); this.o += 2; }
  u32(v: number): void { this.need(4); this.view.setUint32(this.o, v >>> 0, true); this.o += 4; }
  done(): Uint8Array { return this.buf.slice(0, this.o); }
}

class Reader {
  private view: DataView;
  private o = 0;
  constructor(buf: Uint8Array) { this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  u8(): number { const v = this.view.getUint8(this.o); this.o += 1; return v; }
  i8(): number { const v = this.view.getInt8(this.o); this.o += 1; return v; }
  u16(): number { const v = this.view.getUint16(this.o, true); this.o += 2; return v; }
  i16(): number { const v = this.view.getInt16(this.o, true); this.o += 2; return v; }
  u32(): number { const v = this.view.getUint32(this.o, true); this.o += 4; return v; }
}

const POS = 100;   // 1 cm
const ANG = 10000; // 0.0001 rad

function wrapPi(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const w = new Writer();
  w.u32(s.tick);
  w.u8(MATCH_PHASES.indexOf(s.phase));
  w.u16(Math.max(0, Math.ceil(s.timeLeft)));
  w.u16(s.tickets[0]); w.u16(s.tickets[1]);
  w.u8(s.players.length);
  for (const p of s.players) {
    w.u8(p.id);
    w.i16(p.x * POS); w.i16(p.y * POS); w.i16(p.z * POS);
    w.i16(wrapPi(p.yaw) * ANG); w.i16(p.pitch * ANG);
    w.u16(p.flags); w.u8(p.health); w.u8(p.slot);
  }
  w.u8(s.projectiles.length);
  for (const p of s.projectiles) { w.u16(p.id); w.u8(p.kind); w.i16(p.x * POS); w.i16(p.y * POS); w.i16(p.z * POS); }
  w.u8(s.deployables.length);
  for (const d of s.deployables) { w.u16(d.id); w.u8(d.kind); w.u8(d.team); w.i16(d.x * POS); w.i16(d.y * POS); w.i16(d.z * POS); w.u8(Math.min(255, Math.ceil(d.life))); }
  w.u8(s.vehicles.length);
  for (const v of s.vehicles) {
    w.u8(v.id);
    w.i16(v.x * POS); w.i16(v.y * POS); w.i16(v.z * POS);
    w.i16(wrapPi(v.yaw) * ANG); w.i16(v.pitch * ANG); w.i16(v.roll * ANG);
    w.i16(v.speed * 100); w.i8(v.steer * 100); w.u16(v.health);
    w.i8(v.driver); w.i8(v.passenger); w.u8(v.team | (v.alive ? 128 : 0));
  }
  w.u8(s.objectives.length);
  for (const o of s.objectives) { w.u8(o.owner | (o.contested ? 4 : 0) | (o.presence << 3)); w.i8(o.control * 100); }
  return w.done();
}

export function decodeSnapshot(buf: Uint8Array): Snapshot {
  const r = new Reader(buf);
  const tick = r.u32();
  const phase = MATCH_PHASES[r.u8()] ?? 'live';
  const timeLeft = r.u16();
  const tickets: [number, number] = [r.u16(), r.u16()];
  const players: PlayerSnap[] = [];
  for (let n = r.u8(); n > 0; n--) {
    players.push({ id: r.u8(), x: r.i16() / POS, y: r.i16() / POS, z: r.i16() / POS, yaw: r.i16() / ANG, pitch: r.i16() / ANG, flags: r.u16(), health: r.u8(), slot: r.u8() });
  }
  const projectiles: ProjectileSnap[] = [];
  for (let n = r.u8(); n > 0; n--) projectiles.push({ id: r.u16(), kind: r.u8(), x: r.i16() / POS, y: r.i16() / POS, z: r.i16() / POS });
  const deployables: DeployableSnap[] = [];
  for (let n = r.u8(); n > 0; n--) deployables.push({ id: r.u16(), kind: r.u8(), team: r.u8() as TeamId, x: r.i16() / POS, y: r.i16() / POS, z: r.i16() / POS, life: r.u8() });
  const vehicles: VehicleSnap[] = [];
  for (let n = r.u8(); n > 0; n--) {
    const id = r.u8();
    const x = r.i16() / POS, y = r.i16() / POS, z = r.i16() / POS;
    const yaw = r.i16() / ANG, pitch = r.i16() / ANG, roll = r.i16() / ANG;
    const speed = r.i16() / 100, steer = r.i8() / 100, health = r.u16();
    const driver = r.i8(), passenger = r.i8(), ta = r.u8();
    vehicles.push({ id, x, y, z, yaw, pitch, roll, speed, steer, health, driver, passenger, team: (ta & 3) as TeamId, alive: (ta & 128) !== 0 });
  }
  const objectives: ObjectiveSnap[] = [];
  for (let n = r.u8(); n > 0; n--) {
    const b = r.u8();
    objectives.push({ owner: (b & 3) as TeamId, contested: (b & 4) !== 0, presence: (b >> 3) & 3, control: r.i8() / 100 });
  }
  return { tick, phase, timeLeft, tickets, players, projectiles, deployables, vehicles, objectives };
}
