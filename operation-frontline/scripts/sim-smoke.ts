// Headless smoke run: 8v8 bots for a few simulated minutes. Usage: npx tsx scripts/sim-smoke.ts [seconds] [difficulty]
import { GameSim } from '../shared/src/sim/GameSim';

const seconds = Number(process.argv[2] ?? 120);
const difficulty = Number(process.argv[3] ?? 1) as 0 | 1 | 2 | 3;
const t0 = Date.now();
const sim = new GameSim({ warmup: 1, botDifficulty: difficulty, seed: 7 });
console.log(`map: ${sim.world.boxes.length} boxes, ${sim.world.ramps.length} ramps, ${sim.map.props.length} props, ${sim.map.dyn.length} dyn, ${sim.map.lights.length} lights; built in ${Date.now() - t0}ms`);
const t1 = Date.now();
const nav = sim.nav;
let usable = 0;
for (let i = 0; i < nav.count; i++) if (nav.usable(i)) usable++;
console.log(`nav: ${nav.count} nodes (${usable} usable) in ${nav.buildMs}ms (total ${Date.now() - t1}ms)`);
for (const o of sim.map.objectives) for (const s of o.spawns) if (nav.nearest(s.x, s.y, s.z, 1) < 0) console.log('UNREACHABLE objective spawn', o.id, s);
for (const b of sim.map.bases) for (const s of b.spawns) if (nav.nearest(s.x, s.y, s.z, 1) < 0) console.log('UNREACHABLE base spawn', b.team, s);
for (const s of sim.map.overwatch) { const n = nav.nearest(s.x, s.y, s.z, 2); if (n < 0 || Math.abs(nav.nodeY[n] - s.y) > 0.5) console.log('UNREACHABLE overwatch', s, n >= 0 ? nav.nodeY[n] : null); }

const counts: Record<string, number> = {};
const ticks = seconds * 30;
const t2 = Date.now();
let maxStep = 0;
for (let i = 0; i < ticks; i++) {
  const s0 = performance.now();
  sim.step();
  maxStep = Math.max(maxStep, performance.now() - s0);
  for (const e of sim.drainEvents()) {
    counts[e.t] = (counts[e.t] ?? 0) + 1;
    if (e.t === 'obj') console.log(`  t=${(sim.time).toFixed(0)}s objective ${sim.map.objectives[e.idx].id} ${e.kind} -> team ${e.owner}`);
    if (e.t === 'phase') console.log(`  t=${(sim.time).toFixed(0)}s phase ${e.phase} winner ${e.winner}`);
  }
}
const ms = Date.now() - t2;
console.log(`simulated ${seconds}s in ${ms}ms (${(ms / ticks).toFixed(3)} ms/tick avg, ${maxStep.toFixed(2)} ms max)`);
console.log('events', counts);
console.log('tickets', sim.tickets, 'objectives', sim.objectives.map((o) => `${o.owner}:${o.control.toFixed(2)}`).join(' '));
const r = sim.roster().sort((a, b) => b.score - a.score);
for (const p of r) console.log(`  T${p.team} ${p.name.padEnd(10)} c${p.classId} K${p.kills} D${p.deaths} A${p.assists} S${p.score} cap${p.captures} hs${p.headshots}`);
