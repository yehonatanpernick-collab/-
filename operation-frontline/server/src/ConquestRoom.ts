// Authoritative Conquest match room. All gameplay runs in the shared GameSim; this
// class only validates network input, feeds it to the simulation and fans out
// snapshots / events. Clients never send positions, damage, kills or scores.
import { type Client, CloseCode, Room } from '@colyseus/core';
import { PROTOCOL_VERSION, SIM, type TeamId } from '@shared/config';
import { C2S, S2C, type WelcomeMsg, encodeSnapshot, unpackCmd } from '@shared/protocol';
import { GameSim } from '@shared/sim/GameSim';
import type { MatchOptions } from '@shared/types';

interface Seat { id: number; lastSpawnReq: number; lastLoadout: number; lastTeam: number; cmdCount: number; cmdWindow: number }

const RECONNECT_SECONDS = 20;

export class ConquestRoom extends Room {
  override maxClients = SIM.MAX_PLAYERS;
  private sim!: GameSim;
  private seats = new Map<string, Seat>();
  private code = '';
  private snapAcc = 0;
  private rosterT = 0;
  private resultSent = false;

  override onCreate(options: { private?: boolean; code?: string }): void {
    const isPrivate = options?.private === true;
    this.code = isPrivate && typeof options.code === 'string' ? options.code.slice(0, 6).toUpperCase() : '';
    const matchOptions: Partial<MatchOptions> = { seed: Math.floor(Math.random() * 1e9), environment: Math.random() < 0.35 ? 1 : 0, fillBots: true };
    this.sim = new GameSim(matchOptions);
    void this.sim.nav; // build the navigation grid up-front, not during the first tick
    this.maxMessagesPerSecond = 120;
    this.patchRate = null;
    // private rooms stay joinable by code (filterBy) but are hidden from the public room list via metadata
    this.updateMeta();

    this.onMessage(C2S.CMD, (client, batch: unknown) => {
      const seat = this.seats.get(client.sessionId);
      if (!seat || !Array.isArray(batch) || batch.length > SIM.MAX_CMD_QUEUE) return;
      // rate limit: at most ~1.5x the nominal command rate per second
      const now = Date.now();
      if (now - seat.cmdWindow > 1000) { seat.cmdWindow = now; seat.cmdCount = 0; }
      for (const raw of batch) {
        if (++seat.cmdCount > SIM.CMD_RATE * 1.5) return;
        const cmd = unpackCmd(raw);
        if (cmd) this.sim.queueCmd(seat.id, cmd);
      }
    });
    this.onMessage(C2S.SPAWN, (client, msg: { point?: unknown; loadout?: unknown }) => {
      const seat = this.seats.get(client.sessionId);
      const now = Date.now();
      if (!seat || !msg || typeof msg !== 'object' || now - seat.lastSpawnReq < 250) return;
      seat.lastSpawnReq = now;
      this.sim.requestSpawn(seat.id, typeof msg.point === 'number' ? msg.point : -1, msg.loadout);
    });
    this.onMessage(C2S.LOADOUT, (client, loadout: unknown) => {
      const seat = this.seats.get(client.sessionId);
      const now = Date.now();
      if (!seat || now - seat.lastLoadout < 250) return;
      seat.lastLoadout = now;
      this.sim.setLoadout(seat.id, loadout);
    });
    this.onMessage(C2S.TEAM, (client, team: unknown) => {
      const seat = this.seats.get(client.sessionId);
      const now = Date.now();
      if (!seat || (team !== 1 && team !== 2) || now - seat.lastTeam < 3000) return;
      seat.lastTeam = now;
      this.sim.requestTeam(seat.id, team as TeamId);
    });
    this.onMessage(C2S.PING, (client, ping: unknown) => {
      const seat = this.seats.get(client.sessionId);
      const p = seat ? this.sim.player(seat.id) : undefined;
      if (p && typeof ping === 'number' && Number.isFinite(ping)) p.ping = Math.max(0, Math.min(999, ping));
      client.send(S2C.PONG, 0);
    });

    this.setSimulationInterval(() => this.tick(), 1000 / SIM.TICK_RATE / 2);
  }

  override onJoin(client: Client, options: { name?: unknown; loadout?: unknown; level?: unknown; protocol?: unknown }): void {
    if (options?.protocol !== PROTOCOL_VERSION) {
      client.send(S2C.ERROR, 'Your game version does not match the server. Please reload the page.');
      client.leave(4003);
      return;
    }
    const name = typeof options.name === 'string' ? options.name.replace(/[^\w \-.]/g, '').trim().slice(0, 16) || 'Soldier' : 'Soldier';
    const level = typeof options.level === 'number' && Number.isFinite(options.level) ? options.level : 1;
    const p = this.sim.addPlayer({ name, loadout: options.loadout, level });
    this.seats.set(client.sessionId, { id: p.id, lastSpawnReq: 0, lastLoadout: 0, lastTeam: 0, cmdCount: 0, cmdWindow: Date.now() });
    const welcome: WelcomeMsg = { id: p.id, map: this.sim.map.id, options: this.sim.opts, tick: this.sim.tick, destroyed: this.sim.ents.destroyedDyn(), roomName: this.roomId, code: this.code };
    client.send(S2C.WELCOME, welcome);
    client.send(S2C.ROSTER, this.sim.roster());
    this.updateMeta();
  }

  /** Unexpected disconnect: keep the soldier's seat for a while so the player can reconnect. */
  override onDrop(client: Client, code?: number): void {
    if (process.env.FRONTLINE_DEBUG) console.log("onDrop", client.sessionId, code);
    if (code === CloseCode.CONSENTED) return; // deliberate leave: onLeave frees the seat immediately
    const seat = this.seats.get(client.sessionId);
    const p = seat ? this.sim.player(seat.id) : undefined;
    if (p) p.connected = false;
    this.sim.rosterDirty = true;
    void this.allowReconnection(client, RECONNECT_SECONDS);
  }

  override onReconnect(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    const p = seat ? this.sim.player(seat.id) : undefined;
    if (!seat || !p) return;
    p.connected = true;
    this.sim.rosterDirty = true;
    client.send(S2C.WELCOME, { id: p.id, map: this.sim.map.id, options: this.sim.opts, tick: this.sim.tick, destroyed: this.sim.ents.destroyedDyn(), roomName: this.roomId, code: this.code } satisfies WelcomeMsg);
  }

  override onLeave(client: Client, code?: number): void {
    if (process.env.FRONTLINE_DEBUG) console.log("onLeave", client.sessionId, code);
    const seat = this.seats.get(client.sessionId);
    if (seat) this.sim.removePlayer(seat.id);
    this.seats.delete(client.sessionId);
    this.updateMeta();
  }

  private updateMeta(): void {
    if (!this.sim) return;
    let a = 0, b = 0, bots = 0;
    for (const p of this.sim.players) { if (p.bot) bots++; else if (p.team === 1) a++; else b++; }
    // `code` must stay in the metadata: Colyseus matches filterBy(['code']) against it
    void this.setMetadata({ code: this.code || undefined, map: this.sim.map.name, phase: this.sim.phase, teamA: a, teamB: b, bots, private: this.code !== '' });
  }

  private lastTick = performance.now();

  private tick(): void {
    // measure wall-clock time ourselves: the delta handed to the callback is not reliable enough for a fixed step
    const now = performance.now();
    const dtMs = now - this.lastTick;
    this.lastTick = now;
    // fixed simulation step; catch up at most a few ticks if the process stalled
    this.snapAcc += Math.min(dtMs, 250);
    const stepMs = 1000 / SIM.TICK_RATE;
    let steps = 0;
    while (this.snapAcc >= stepMs && steps < 4) {
      this.snapAcc -= stepMs;
      steps++;
      const phaseBefore = this.sim.phase;
      this.sim.step();
      const events = this.sim.drainEvents();
      if (events.length) this.broadcast(S2C.EVENTS, events);
      if (this.sim.phase !== phaseBefore) this.updateMeta();
      // snapshots at SNAPSHOT_RATE (every 3rd tick out of 2 → ticks 0,1 of each 3 at 30 Hz = 20 Hz)
      if (this.sim.tick % 3 !== 2) {
        const bytes = encodeSnapshot(this.sim.snapshot());
        for (const client of this.clients) {
          const seat = this.seats.get(client.sessionId);
          if (seat) client.send(S2C.SNAP, { b: bytes, me: this.sim.ownerSnap(seat.id) });
        }
      }
    }
    if (steps === 0) return;
    this.rosterT -= steps * stepMs;
    if (this.sim.rosterDirty && this.rosterT <= 0) {
      this.sim.rosterDirty = false;
      this.rosterT = 500;
      this.broadcast(S2C.ROSTER, this.sim.roster());
    }
    if (this.sim.phase === 'ended') {
      if (!this.resultSent) { this.resultSent = true; this.broadcast(S2C.RESULT, this.sim.result()); }
    } else this.resultSent = false;
  }
}
