// Time-trial races along the trail network: glowing start beacons, checkpoint gates every
// ~120 m, a HUD timer with a guidance arrow, and per-race best times. Drive into a beacon
// to start; leaving the route for too long abandons the run.
import * as THREE from 'three';
import { store } from './util.js';

const RACES = [
  { id: 'lake', name: 'Lake Loop', legs: [['lakeWest', 'lakeSouth'], ['lakeSouth', 'lakeEast'], ['lakeEast', 'lakeNorth'], ['lakeNorth', 'lakeWest']], color: 0x37c8ff },
  { id: 'gorge', name: 'Gorge Run', legs: [['village', 'forestMouth'], ['forestMouth', 'greenSouth'], ['greenSouth', 'gorge'], ['gorge', 'gorgeEnd']], color: 0xffa31a },
  { id: 'pass', name: 'Ice Pass Climb', legs: [['greenNorth', 'valleyHead'], ['valleyHead', 'icePass']], color: 0xb68cff },
];
const GATE_EVERY = 120, GATE_R = 7, START_R = 9;

const CSS = `
#race { position: absolute; left: 16px; top: 74px; background: rgba(12,16,20,.62); backdrop-filter: blur(4px); border-radius: 8px; padding: 8px 12px; min-width: 150px; display: none; pointer-events: none; }
#race.on { display: block; }
#race .rn { font: 700 11px system-ui; letter-spacing: .12em; color: #ffcf6e; }
#race .rt { font: 800 26px system-ui; font-variant-numeric: tabular-nums; color: #fff; }
#race .rc { font: 600 12px system-ui; color: rgba(255,255,255,.75); }
#race-arrow { position: absolute; left: 50%; top: 100px; width: 0; height: 0; margin-left: -14px; border-left: 14px solid transparent; border-right: 14px solid transparent; border-bottom: 30px solid #ffcf6e; filter: drop-shadow(0 2px 6px rgba(0,0,0,.6)); display: none; pointer-events: none; transform-origin: 14px 20px; }
#race-arrow.on { display: block; }
#race-count { position: absolute; left: 50%; top: 34%; transform: translate(-50%, -50%); font: 900 96px system-ui; color: #fff; text-shadow: 0 4px 24px rgba(0,0,0,.6); display: none; pointer-events: none; }
#race-count.on { display: block; }
body.touch #race { top: 60px; left: 10px; }
`;

function buildPath(meta, legs) {
  const pts = [];
  for (const [a, b] of legs) {
    let road = meta.roads.find(r => r.from === a && r.to === b), rev = false;
    if (!road) { road = meta.roads.find(r => r.from === b && r.to === a); rev = true; }
    if (!road) return null;
    const p = rev ? [...road.pts].reverse() : road.pts;
    for (const q of p) pts.push(new THREE.Vector3(q[0], q[1], q[2]));
  }
  return pts;
}

class Races {
  constructor(game) {
    this.game = game;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const hud = document.getElementById('hud');
    this.panel = document.createElement('div'); this.panel.id = 'race'; hud.appendChild(this.panel);
    this.arrow = document.createElement('div'); this.arrow.id = 'race-arrow'; hud.appendChild(this.arrow);
    this.countEl = document.createElement('div'); this.countEl.id = 'race-count'; hud.appendChild(this.countEl);
    this.group = new THREE.Group(); game.scene.add(this.group);
    this.races = [];
    const meta = game.world.meta;
    const torus = new THREE.TorusGeometry(GATE_R, 0.32, 8, 48);
    const beamGeo = new THREE.CylinderGeometry(3.5, 3.5, 45, 24, 1, true);
    for (const R of RACES) {
      const path = buildPath(meta, R.legs);
      if (!path || path.length < 10) continue;
      // checkpoints every GATE_EVERY metres along the path, plus the finish
      const gates = [];
      let acc = 0;
      for (let i = 1; i < path.length; i++) {
        acc += path[i].distanceTo(path[i - 1]);
        if (acc >= GATE_EVERY || i === path.length - 1) {
          acc = 0;
          const j = Math.min(path.length - 1, i + 3), k = Math.max(0, i - 3);
          const dir = path[j].clone().sub(path[k]).setY(0).normalize();
          gates.push({ p: path[i].clone(), dir });
        }
      }
      const loop = path[0].distanceTo(path[path.length - 1]) < 40;
      const mat = new THREE.MeshBasicMaterial({ color: R.color, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false });
      const gm = new THREE.InstancedMesh(torus, mat, gates.length);
      gm.frustumCulled = false; gm.count = 0; this.group.add(gm);
      const beamMat = new THREE.MeshBasicMaterial({ color: R.color, transparent: true, opacity: 0.28, toneMapped: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.copy(path[0]).add(new THREE.Vector3(0, 22, 0));
      this.group.add(beam);
      this.races.push({ ...R, path, gates, loop, mesh: gm, beam, best: +store.get(`rzr.race.${R.id}`, 0) || 0 });
    }
    this.active = null; this.cool = 0; this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
  }

  _start(r) {
    this.active = { r, next: 0, t: -3, lastGo: 3 };
    this.game.hud?.toast(r.name, `${r.gates.length} checkpoints${r.best ? ` · best ${fmt(r.best)}` : ''}`, 2200);
    for (const x of this.races) x.beam.visible = false;
  }

  _end(done) {
    const a = this.active; if (!a) return;
    const r = a.r;
    if (done) {
      const t = a.t;
      const rec = !r.best || t < r.best;
      if (rec) { r.best = t; store.set(`rzr.race.${r.id}`, t); }
      this.game.hud?.toast(`${r.name}: ${fmt(t)}`, rec ? 'NEW RECORD' : `best ${fmt(r.best)}`, 4000);
      if (this.game.stunts) { this.game.stunts.score += Math.round(20000 * r.gates.length / Math.max(30, t)); }
    } else this.game.hud?.toast('Race abandoned', r.name, 2000);
    this.active = null; this.cool = 8;
    r.mesh.count = 0;
    for (const x of this.races) x.beam.visible = true;
    this.panel.classList.remove('on'); this.arrow.classList.remove('on'); this.countEl.classList.remove('on');
  }

  update(dt, game) {
    const p = game.phys?.pos; if (!p) return;
    this.cool = Math.max(0, this.cool - dt);
    for (const r of this.races) r.beam.material.opacity = 0.14 + 0.06 * Math.sin(performance.now() * 0.003);
    if (!this.active) {
      if (this.cool > 0) return;
      // start on entering a beacon (not when spawned/teleported inside one)
      for (const r of this.races) {
        const inside = Math.hypot(p.x - r.path[0].x, p.z - r.path[0].z) < START_R && Math.abs(p.y - r.path[0].y) < 6;
        const entered = inside && r.wasOutside;
        r.wasOutside = !inside;
        if (entered && game.phys.vel.length() > 1.5) { this._start(r); break; }
      }
      return;
    }
    const a = this.active, r = a.r;
    a.t += dt;
    // countdown
    if (a.t < 0) {
      const n = Math.ceil(-a.t);
      this.countEl.textContent = n; this.countEl.classList.add('on');
    } else if (a.t < 0.8) { this.countEl.textContent = 'GO'; this.countEl.classList.add('on'); }
    else this.countEl.classList.remove('on');
    // gates: show the next three
    const m = this._m, q = this._q;
    r.mesh.count = 0;
    for (let i = a.next; i < Math.min(r.gates.length, a.next + 3); i++) {
      const g = r.gates[i];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(g.dir.x, g.dir.z));
      const s = i === a.next ? 1 + 0.06 * Math.sin(performance.now() * 0.008) : 0.8;
      m.compose(g.p.clone().add(new THREE.Vector3(0, GATE_R - 1.2, 0)), q, new THREE.Vector3(s, s, s));
      r.mesh.setMatrixAt(r.mesh.count++, m);
    }
    r.mesh.instanceMatrix.needsUpdate = true;
    const g = r.gates[a.next];
    const d = Math.hypot(p.x - g.p.x, p.z - g.p.z);
    if (a.t >= 0 && d < GATE_R + 2) {
      a.next++;
      game.audio?.blip?.();
      if (a.next >= r.gates.length) { this._end(true); return; }
    }
    if (d > 450) { this._end(false); return; }
    // HUD
    this.panel.classList.add('on');
    this.panel.innerHTML = `<div class="rn">${r.name.toUpperCase()}</div><div class="rt">${fmt(Math.max(0, a.t))}</div><div class="rc">CP ${a.next}/${r.gates.length}${r.best ? ` · best ${fmt(r.best)}` : ''}</div>`;
    const cam = game.camera, f = cam.getWorldDirection(this._f || (this._f = new THREE.Vector3()));
    const ang = Math.atan2(g.p.x - cam.position.x, g.p.z - cam.position.z) - Math.atan2(f.x, f.z);
    this.arrow.style.transform = `rotate(${-ang}rad)`;
    this.arrow.classList.add('on');
  }
}

function fmt(t) { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; }

export function create(game) { return new Races(game); }
