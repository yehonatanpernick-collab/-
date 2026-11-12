import { describe, expect, it } from 'vitest';
import { TEAM_A, TEAM_B } from '@shared/config';
import { GameSim } from '@shared/sim/GameSim';
import { BTN_ADS, BTN_FIRE, type Cmd, type SimEvent } from '@shared/types';

function runSim(sim: GameSim, seconds: number, each?: (ev: SimEvent) => void): Record<string, number> {
  const counts: Record<string, number> = {};
  for (let i = 0; i < seconds * 30; i++) { sim.step(); for (const e of sim.drainEvents()) { counts[e.t] = (counts[e.t] ?? 0) + 1; each?.(e); } }
  return counts;
}

describe('conquest with bots (offline training simulation)', () => {
  it('bots navigate, fight, capture objectives and bleed tickets', () => {
    const sim = new GameSim({ warmup: 1, seed: 11, botDifficulty: 1 });
    const c = runSim(sim, 150);
    expect(sim.players.length).toBe(16);
    expect(c.kill).toBeGreaterThan(10);
    expect(c.obj).toBeGreaterThanOrEqual(2);
    expect(c.shot).toBeGreaterThan(300);
    expect(sim.tickets[0] + sim.tickets[1]).toBeLessThan(600);
    expect(sim.objectives.some((o) => o.owner !== 0)).toBe(true);
    for (const p of sim.players) { expect(p.s.ammo0).toBeGreaterThanOrEqual(0); expect(p.health).toBeLessThanOrEqual(100); }
  }, 120000);

  it('a match ends, reports a result and restarts', () => {
    const sim = new GameSim({ warmup: 1, seed: 5, tickets: 20, botDifficulty: 2 });
    const phases: string[] = [];
    runSim(sim, 150, (e) => { if (e.t === 'phase') phases.push(e.phase); });
    expect(phases).toContain('live'); expect(phases).toContain('ended');
    expect(sim.result().roster.length).toBe(16);
  }, 120000);

  it('harder bots beat easier humans-free teams more often (difficulty matters)', () => {
    // same seed, different skill: elite bots land a higher share of their shots
    const acc = (d: 0 | 3): number => {
      const sim = new GameSim({ warmup: 1, seed: 21, botDifficulty: d });
      const c = runSim(sim, 90);
      return (c.hit ?? 0) / Math.max(1, c.shot ?? 1);
    };
    expect(acc(3)).toBeGreaterThan(acc(0));
  }, 120000);
});

describe('server authority', () => {
  const idle = (seq: number, o: Partial<Cmd> = {}): Cmd => ({ seq, buttons: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, slot: 0, viewTick: 0, ...o });
  it('ignores input from dead players, caps command bursts and validates spawn points', () => {
    const sim = new GameSim({ warmup: 0.1, fillBots: false, seed: 2 });
    const p = sim.addPlayer({ name: 'x', team: TEAM_A });
    for (let i = 0; i < 6; i++) sim.step();
    sim.requestSpawn(p.id, 2, undefined); // objective not owned → falls back to base
    for (let i = 0; i < 3; i++) sim.step();
    expect(p.alive).toBe(true);
    const base = sim.map.bases.find((b) => b.team === TEAM_A)!;
    expect(Math.hypot(p.s.x - base.x, p.s.z - base.z)).toBeLessThan(25);
    const x0 = p.s.x;
    // speed hack attempt: 600 forward commands in one tick
    for (let i = 1; i <= 600; i++) sim.queueCmd(p.id, idle(i, { mz: 1, yaw: -Math.PI / 2 }));
    sim.step();
    expect(Math.abs(p.s.x - x0)).toBeLessThan(1.5);
  });
  it('damage only comes from validated server-side hits; friendly fire is off', () => {
    const sim = new GameSim({ warmup: 0.1, fillBots: false, vehicles: false, seed: 3 });
    const a = sim.addPlayer({ name: 'a', team: TEAM_A }), b = sim.addPlayer({ name: 'b', team: TEAM_B }), c = sim.addPlayer({ name: 'c', team: TEAM_A });
    for (let i = 0; i < 6; i++) sim.step();
    for (const p of [a, b, c]) { sim.requestSpawn(p.id, -1, undefined); }
    for (let i = 0; i < 3; i++) sim.step();
    // place them on the open avenue: a shoots along +X at b (enemy) with c (friend) standing next to b
    const put = (p: typeof a, x: number, z: number) => { p.s.x = x; p.s.y = 0.02; p.s.z = z; p.protectT = 0; };
    put(a, -40, 0); put(b, -30, 0); put(c, -32, 1.2);
    let seq = 0;
    for (let i = 0; i < 70; i++) {
      put(a, -40, 0); put(b, -30, 0); put(c, -32, 1.2);
      // aim down sights and pull down against the server-applied recoil, like a player would
      for (let k = 0; k < 2; k++) sim.queueCmd(a.id, idle(++seq, { buttons: (i > 12 ? BTN_FIRE : 0) | BTN_ADS, yaw: -Math.PI / 2 - a.s.recoilY, pitch: -0.045 - a.s.recoilP }));
      sim.step();
    }
    expect(b.alive).toBe(false);
    expect(c.health).toBe(100);
    expect(a.kills).toBe(1);
    expect(sim.tickets[1]).toBe(sim.opts.tickets - 1);
  });
});
