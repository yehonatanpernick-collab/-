// Driving game layer: drift and airtime scoring with combo multiplier, and a turbo meter
// that drains while boosting and recharges from drifting, jumps and clean speed.
// Self-contained: injects its own HUD elements and styles.
import { store } from './util.js';

const CSS = `
#stunt { position: absolute; left: 50%; top: 58px; transform: translateX(-50%); text-align: center; pointer-events: none;
  font: 800 30px system-ui; letter-spacing: .02em; color: #fff; text-shadow: 0 2px 12px rgba(0,0,0,.75); opacity: 0; transition: opacity .25s; }
#stunt.on { opacity: 1; }
#stunt .lbl { font: 700 13px system-ui; letter-spacing: .14em; color: #ffcf6e; }
#stunt .mul { font: 700 16px system-ui; color: #9fe3ff; margin-left: 6px; }
#stunt.bank { animation: stuntBank .7s ease-out; }
@keyframes stuntBank { 0% { transform: translateX(-50%) scale(1.25); color: #ffd36a; } 100% { transform: translateX(-50%) scale(1); } }
#boost-wrap { margin-top: 6px; display: flex; align-items: center; gap: 6px; justify-content: flex-end; font: 700 10px system-ui; letter-spacing: .1em; color: #9fe3ff; }
#boost-bar { width: 110px; height: 6px; border-radius: 3px; background: rgba(255,255,255,.15); overflow: hidden; }
#boost-fill { height: 100%; width: 100%; background: linear-gradient(90deg, #3fb8ff, #9ff0ff); transition: width .1s linear; }
#boost-fill.empty { background: #ff5b4a; }
#score-total { font: 600 11px system-ui; color: rgba(255,255,255,.7); margin-top: 4px; }
body.touch #stunt { top: 46px; font-size: 24px; }
`;

class Stunts {
  constructor(game) {
    this.game = game;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const hud = document.getElementById('hud');
    this.el = document.createElement('div'); this.el.id = 'stunt'; hud.appendChild(this.el);
    const sp = document.getElementById('speedo');
    const bw = document.createElement('div'); bw.id = 'boost-wrap';
    bw.innerHTML = 'TURBO <div id="boost-bar"><div id="boost-fill"></div></div>';
    sp.appendChild(bw);
    this.total = document.createElement('div'); this.total.id = 'score-total'; sp.appendChild(this.total);
    this.fill = document.getElementById('boost-fill');
    this.meter = 1; this.locked = false;
    this.combo = 0; this.mult = 1; this.kind = ''; this.idle = 0;
    this.drifting = 0; this.air = 0;
    this.score = 0; this.best = +store.get('rzr.best', 0) || 0;
    this._showT = 0;
  }

  get canBoost() { return !this.locked && this.meter > 0; }

  update(dt, game) {
    const ph = game.phys;
    if (!ph) return;
    const v = ph.vel, speed = Math.hypot(v.x, v.z);
    const f = ph.forward(this._f || (this._f = v.clone()));
    const contacts = ph.wheels.reduce((n, w) => n + (w.contact ? 1 : 0), 0);
    // drift angle between heading and travel direction
    let ang = 0;
    if (speed > 7 && contacts >= 2) {
      const fl = Math.hypot(f.x, f.z) || 1;
      const c = (f.x * v.x + f.z * v.z) / (fl * speed);
      ang = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
      if (ph.forwardSpeed() < 0) ang = 0;
    }
    let active = false;
    if (ang > 14 && ang < 110) {
      this.drifting += dt; active = true;
      this.combo += (ang - 10) * speed * dt * 0.9 * this.mult;
      this.kind = 'DRIFT';
    } else this.drifting = 0;
    // airtime
    if (contacts === 0 && speed > 4) { this.air += dt; if (this.air > 0.35) { active = true; this.kind = this.kind === 'DRIFT' ? 'DRIFT + AIR' : 'AIR'; this.combo += speed * dt * 14 * this.mult; } }
    else if (this.air > 0) {
      if (this.air > 0.35) { this.mult = Math.min(5, this.mult + 1); game.hud?.toast(`AIR ${this.air.toFixed(1)} s`, `combo x${this.mult}`, 1200); }
      this.air = 0;
    }
    if (this.drifting > 2.5 && Math.floor(this.drifting / 2.5) !== Math.floor((this.drifting - dt) / 2.5)) this.mult = Math.min(5, this.mult + 1);
    // bank the combo after a short calm period; a hard crash loses it
    const q = ph.quat, upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    if (upY < 0.35 && this.combo > 0) { this._end(false); }
    if (active) this.idle = 0; else if (this.combo > 0) { this.idle += dt; if (this.idle > 1.4) this._end(true); }

    // turbo meter
    const boosting = ph.input.boost && ph.input.throttle > 0.1 && !this.locked;
    if (boosting) this.meter -= dt * 0.16;
    else this.meter += dt * (0.025 + (this.drifting > 0 ? 0.14 : 0) + (this.air > 0.2 ? 0.3 : 0) + (speed > 25 ? 0.02 : 0));
    this.meter = Math.max(0, Math.min(1, this.meter));
    if (this.meter <= 0) this.locked = true;
    if (this.locked && this.meter > 0.2) this.locked = false;
    this.fill.style.width = `${(this.meter * 100).toFixed(1)}%`;
    this.fill.classList.toggle('empty', this.locked);

    if (this.combo > 0) {
      this.el.innerHTML = `<div class="lbl">${this.kind}</div>${Math.round(this.combo).toLocaleString()}<span class="mul">x${this.mult}</span>`;
      this.el.classList.add('on');
    } else if ((this._showT -= dt) <= 0) this.el.classList.remove('on');
    this.total.textContent = `SCORE ${Math.round(this.score).toLocaleString()} · BEST ${Math.round(this.best).toLocaleString()}`;
  }

  _end(bank) {
    const pts = Math.round(this.combo);
    if (bank) {
      this.score += pts;
      if (this.score > this.best) { this.best = this.score; store.set('rzr.best', this.best); }
      this.el.innerHTML = `<div class="lbl">${this.kind} BANKED</div>+${pts.toLocaleString()}`;
      this.el.classList.remove('bank'); void this.el.offsetWidth; this.el.classList.add('bank');
    } else this.el.innerHTML = `<div class="lbl" style="color:#ff7a6a">CRASHED</div>combo lost`;
    this._showT = 1.6;
    this.combo = 0; this.mult = 1; this.idle = 0; this.kind = '';
  }
}

export function create(game) { return new Stunts(game); }
