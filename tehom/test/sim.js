import * as THREE from 'three';
import { buildBodies, updateBodies } from '../src/world.js';
import { FX } from '../src/fx.js';
import { Game } from '../src/game.js';
import { AI } from '../src/ai.js';
import { DIFFICULTY } from '../src/data.js';
const diffP = +process.argv[2] || 1, diffE = +process.argv[3] || 1;
const scene = new THREE.Scene();
const bodies = buildBodies(scene);
const fx = new FX(scene);
const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 2000, 0);
const g = new Game({ scene, fx, bodies, audio: null, camera, difficulty: DIFFICULTY[diffE] });
for (const f of ['player', 'enemy']) { const h = bodies.find(b => b.home === f); g.spawn('corvette', f, h, 6); g.spawn('frigate', f, h, 2); }
const ais = [new AI(g, 'enemy', DIFFICULTY[diffE]), new AI(g, 'player', DIFFICULTY[diffP])];
let end = null; g.on((t, d) => { if (t === 'end') end = d; });
const dt = 1 / 30;
for (let i = 0; i < 30 * 60 * 20 && !end; i++) {
  updateBodies(bodies, dt, g.time); g.update(dt); for (const a of ais) a.update(dt);
  if (i % (30 * 60) === 0) {
    const c = (f) => g.ships.filter(s => s.faction === f).map(s => s.cls[0]).join('').split('').reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
    console.log(`t=${(g.time/60).toFixed(0)}m P worlds ${g.bodyOf('player').length} ships ${JSON.stringify(c('player'))} alloy ${g.factions.player.alloy|0} | E worlds ${g.bodyOf('enemy').length} ships ${JSON.stringify(c('enemy'))} alloy ${g.factions.enemy.alloy|0}`);
  }
}
console.log('END', end, (g.time / 60).toFixed(1), 'min', 'killed P/E', g.factions.player.killed, g.factions.enemy.killed);
