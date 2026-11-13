// Bot behaviour diagnostics: npx tsx scripts/bot-diag.ts [difficulty] [seconds]
import { GameSim } from '../shared/src/sim/GameSim';
const d = Number(process.argv[2] ?? 1) as 0 | 1 | 2 | 3, secs = Number(process.argv[3] ?? 90);
const sim = new GameSim({ warmup: 1, seed: 5, botDifficulty: d });
const n: Record<string, number> = {}; let moving = 0, samples = 0, still = 0; const speeds: number[] = [];
let visTicks = 0, fireWhileVis = 0, shots = 0, hits = 0, heads = 0;
for (let i = 0; i < secs * 30; i++) {
  sim.step();
  for (const e of sim.drainEvents()) { n[e.t] = (n[e.t] ?? 0) + 1; if (e.t === 'hit') { hits++; if (e.head) heads++; } if (e.t === 'shot') shots++; }
  if (i % 15 === 0) for (const p of sim.players) if (p.alive && p.bot) { const sp = Math.hypot(p.s.vx, p.s.vz); samples++; speeds.push(sp); if (sp > 1) moving++; else still++; }
}
const r = sim.roster();
console.log({ events: n, avgSpeed: (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(2), movingFrac: (moving / samples).toFixed(2), shots, hits, hitRate: (hits / Math.max(1, shots)).toFixed(3), heads });
console.log('kills', r.reduce((a, p) => a + p.kills, 0), 'deaths', r.reduce((a, p) => a + p.deaths, 0), 'tickets', sim.tickets);
