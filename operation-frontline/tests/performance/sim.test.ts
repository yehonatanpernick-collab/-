import { describe, expect, it } from 'vitest';
import { NavGrid } from '@shared/nav';
import { encodeSnapshot } from '@shared/protocol';
import { GameSim } from '@shared/sim/GameSim';
import { buildKestrel } from '@shared/world/maps/kestrel';

describe('performance budgets', () => {
  it('builds the map and navigation quickly', () => {
    const t0 = performance.now();
    const map = buildKestrel();
    const t1 = performance.now();
    const nav = new NavGrid(map.world);
    const t2 = performance.now();
    console.log(`map ${(t1 - t0).toFixed(0)} ms (${map.world.boxes.length} boxes), nav ${(t2 - t1).toFixed(0)} ms (${nav.count} nodes)`);
    expect(t1 - t0).toBeLessThan(1500); expect(t2 - t1).toBeLessThan(4000);
  });
  it('simulates a full 16 soldier match well inside the 33 ms tick budget', () => {
    const sim = new GameSim({ warmup: 1, seed: 9 });
    for (let i = 0; i < 300; i++) sim.step();
    let total = 0, worst = 0, bytes = 0;
    const n = 1800;
    for (let i = 0; i < n; i++) {
      const t = performance.now(); sim.step(); const d = performance.now() - t;
      total += d; worst = Math.max(worst, d); sim.drainEvents();
      if (i % 3 !== 2) bytes += encodeSnapshot(sim.snapshot()).length;
    }
    console.log(`tick avg ${(total / n).toFixed(3)} ms, worst ${worst.toFixed(1)} ms, snapshot traffic ${(bytes / 60 / 1024).toFixed(1)} KB/s per client`);
    expect(total / n).toBeLessThan(4);
    expect(bytes / 60).toBeLessThan(16 * 1024);
  }, 120000);
});
