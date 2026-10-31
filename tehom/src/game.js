import * as THREE from 'three';
import { SHIPS, STRUCTURES, FACTIONS } from './data.js';
import { Ship } from './ships.js';
import { paintOwner } from './world.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();
const ACCEL = { corvette: 2.6, frigate: 1.6, dreadnought: 0.8 };
const TURN = { corvette: 6, frigate: 3, dreadnought: 1.4 };
const EXPLO = { corvette: 0.7, frigate: 1.4, dreadnought: 3.0 };
const EVADE = { corvette: 0.55, frigate: 0.85, dreadnought: 0.97 };

export class Game {
  constructor({ scene, fx, bodies, audio, camera, difficulty }) {
    this.scene = scene; this.fx = fx; this.bodies = bodies; this.audio = audio; this.camera = camera;
    this.diff = difficulty;
    this.time = 0;
    this.ships = [];
    this.pending = [];
    this.factions = {
      player: { alloy: 240, lost: 0, killed: 0, built: 0, income: 0 },
      enemy: { alloy: 240, lost: 0, killed: 0, built: 0, income: 0 },
    };
    this.listeners = [];
    this.over = null;
    this.checkT = 0;
    for (const b of bodies) paintOwner(b);
  }
  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const f of this.listeners) f(type, data); }

  bodyOf(faction) { return this.bodies.filter((b) => b.owner === faction); }
  shipsOf(faction) { return this.ships.filter((s) => s.faction === faction); }

  spawn(cls, faction, body, count = 1) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const s = new Ship(cls, faction, body.pos, this.scene);
      s.host = body;
      s.orbitPoint(body, this.time, _a);
      s.pos.copy(body.pos).lerp(_a, 0.4);
      s.mesh.position.copy(s.pos);
      this.ships.push(s);
      out.push(s);
    }
    return out;
  }

  // ------------------------------------------------------------ orders
  order(ships, target) {
    if (!ships.length) return;
    let spread = Math.sqrt(ships.length) * 3.5 + 4;
    for (const s of ships) {
      s.hold = null;
      if (target.type === 'body') { s.order = { type: 'body', body: target.body }; }
      else { s.order = { type: 'point', point: target.point.clone(), spread }; s.host = null; }
      s.target = null;
    }
  }

  canAfford(f, cost) { return this.factions[f].alloy >= cost; }

  queueShip(body, cls, faction) {
    const def = SHIPS[cls];
    if (body.owner !== faction || !body.structures.yard || body.queue.length >= 6) return false;
    if (!this.canAfford(faction, def.cost)) return false;
    this.factions[faction].alloy -= def.cost;
    body.queue.push({ cls, t: 0 });
    return true;
  }
  cancelQueue(body, idx) {
    const q = body.queue[idx]; if (!q) return;
    this.factions[body.owner].alloy += SHIPS[q.cls].cost;
    body.queue.splice(idx, 1);
  }
  buildStructure(body, id, faction) {
    const def = STRUCTURES[id];
    if (body.owner !== faction || body.structures[id] || body.building) return false;
    if (!this.canAfford(faction, def.cost)) return false;
    this.factions[faction].alloy -= def.cost;
    body.building = { id, t: 0 };
    return true;
  }

  // ------------------------------------------------------------ main step
  update(dt) {
    if (this.over) dt *= 0.25;
    this.time += dt;
    const t = this.time;
    this.economy(dt);
    this.capture(dt);
    for (let i = 0; i < this.ships.length; i++) this.stepShip(this.ships[i], dt, t);
    this.defences(dt);
    this.resolve(t);
    // reap
    if (this.ships.some((s) => s.dead)) this.ships = this.ships.filter((s) => !s.dead);
    this.checkT -= dt;
    if (this.checkT <= 0 && !this.over) { this.checkT = 1; this.checkEnd(); }
  }

  economy(dt) {
    for (const f of ['player', 'enemy']) this.factions[f].income = 0.8;
    for (const b of this.bodies) {
      const F = this.factions[b.owner];
      if (F) F.income += b.productionRate;
      if (b.building && F) {
        b.building.t += dt;
        if (b.building.t >= STRUCTURES[b.building.id].build) {
          b.structures[b.building.id] = 1;
          if (b.owner === 'player') this.emit('log', { text: `${STRUCTURES[b.building.id].name} הושלמה · ${b.name}`, kind: 'ok' });
          b.building = null;
          this.emit('built', b);
        }
      }
      if (F && b.structures.yard && b.queue.length) {
        const q = b.queue[0];
        q.t += dt;
        if (q.t >= SHIPS[q.cls].build) {
          b.queue.shift();
          const [s] = this.spawn(q.cls, b.owner, b);
          this.factions[b.owner].built++;
          if (b.owner === 'player') this.emit('spawn', s);
        }
      }
    }
    this.factions.enemy.income *= this.diff.income;
    for (const f of ['player', 'enemy']) this.factions[f].alloy += this.factions[f].income * dt;
  }

  capture(dt) {
    for (const b of this.bodies) {
      b.presence = { player: 0, enemy: 0 };
      b.count = { player: 0, enemy: 0 };
      b.underAttack = Math.max(0, b.underAttack - dt);
    }
    for (const s of this.ships) {
      for (const b of this.bodies) {
        const r = b.captureR;
        if (Math.abs(s.pos.x - b.pos.x) > r || Math.abs(s.pos.z - b.pos.z) > r) continue;
        if (s.pos.distanceToSquared(b.pos) < r * r) { b.presence[s.faction] += s.def.capture; b.count[s.faction]++; }
      }
    }
    for (const b of this.bodies) {
      const p = b.presence.player, e = b.presence.enemy;
      b.contested = p > 0 && e > 0;
      if (b.contested) continue;
      const f = p > 0 ? 'player' : e > 0 ? 'enemy' : null;
      if (!f) { if (b.owner && b.owner !== 'neutral' && b.control < 100) b.control = Math.min(100, b.control + 3 * dt); continue; }
      const rate = 3.4 * Math.sqrt(b.presence[f]);
      if (b.owner === f) { b.control = Math.min(100, b.control + 5 * dt); continue; }
      if (b.owner) {
        const resist = b.owner === 'neutral' ? 1 + b.native * 0.35 : 1 + (b.structures.battery ? 0.6 : 0) + (b.home === b.owner ? 2.5 : 0);
        b.control -= rate * dt / resist;
        b.underAttack = 4;
        b.capBy = f;
        if (b.control <= 0) this.neutralize(b, f);
      } else {
        if (b.capBy && b.capBy !== f) {
          b.control -= rate * dt;
          if (b.control <= 0) { b.control = 0; b.capBy = f; }
        } else {
          b.capBy = f;
          b.control += rate * dt;
          if (b.control >= 100) this.claim(b, f);
        }
      }
    }
  }
  neutralize(b, by) {
    const prev = b.owner;
    b.owner = null; b.control = 0; b.capBy = by;
    b.native = 0;
    if (b.queue.length && FACTIONS[prev]) b.queue = [];
    b.building = null;
    b.structures.battery = 0;
    paintOwner(b);
    if (prev === 'player') this.emit('log', { text: `${b.name} אבד — המסלול פרוץ`, kind: 'bad' });
    if (prev === 'enemy') this.emit('log', { text: `ההגנות של ${b.name} קרסו`, kind: 'ok' });
    this.emit('owner', b);
  }
  claim(b, f) {
    b.owner = f; b.control = 100; b.capBy = null;
    paintOwner(b);
    this.emit('log', { text: f === 'player' ? `${b.name} בשליטת המשמרת` : `אופל השתלט על ${b.name}`, kind: f === 'player' ? 'ok' : 'bad' });
    this.emit('owner', b);
    this.audio?.capture(f === 'player');
  }

  // ------------------------------------------------------------ ships
  acquire(s) {
    const d = s.def;
    const idle = !s.order;
    const reach = idle ? d.aggro : d.range + 6;
    let best = null, bestScore = Infinity;
    for (const o of this.ships) {
      if (o.faction === s.faction || o.dead) continue;
      const dx = o.pos.x - s.pos.x, dz = o.pos.z - s.pos.z;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
      const dist = o.pos.distanceTo(s.pos);
      if (dist > reach) continue;
      let score = dist;
      if (d.bonus[o.cls]) score -= 25;
      score -= (1 - o.hp / o.maxHp) * 10;
      if (o === s.target) score -= 8;  // stickiness
      if (score < bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  stepShip(s, dt, t) {
    if (s.dead) return;
    const d = s.def;
    s.hit = Math.max(0, s.hit - dt * 4);
    s.thinkT -= dt;
    if (s.thinkT <= 0 || (s.target && s.target.dead)) {
      s.thinkT = 0.25 + Math.random() * 0.12;
      s.target = this.acquire(s);
    }

    // ---- where do we want to be
    const goal = _a;
    let speedCap = d.speed;
    const tgt = s.target;
    if (s.order && s.order.type === 'body') {
      const b = s.order.body;
      s.orbitPoint(b, t, goal);
      if (s.pos.distanceTo(b.pos) < b.captureR * 0.9) { s.host = b; s.order = null; }
    } else if (s.order && s.order.type === 'point') {
      goal.copy(s.slot.off).multiplyScalar(s.order.spread).add(s.order.point);
      if (s.pos.distanceTo(goal) < 2.5) { s.hold = s.order.point.clone(); s.holdSpread = s.order.spread; s.order = null; s.host = null; }
    } else if (tgt && this.leashOk(s, tgt)) {
      // stand off at weapon range and circle
      _b.subVectors(s.pos, tgt.pos);
      const dist = _b.length() || 1;
      _b.divideScalar(dist);
      _c.crossVectors(_b, UP).normalize().multiplyScalar(s.slot.w > 0 ? 1 : -1);
      goal.copy(tgt.pos).addScaledVector(_b, d.range * 0.72).addScaledVector(_c, d.range * 0.5);
      goal.y += s.slot.y * 3;
    } else if (s.host) {
      s.orbitPoint(s.host, t, goal);
    } else if (s.hold) {
      goal.copy(s.slot.off).multiplyScalar(s.holdSpread).add(s.hold);
      goal.y += Math.sin(t * 0.4 + s.id) * 0.6;
    } else {
      goal.copy(s.pos);
    }

    // ---- steer
    const des = _b.subVectors(goal, s.pos);
    const dist = des.length();
    const spd = Math.min(speedCap, dist * 1.4);
    if (dist > 0.001) des.multiplyScalar(spd / dist);
    // keep clear of the star and planets
    const rs = s.pos.length();
    if (rs < 60) des.addScaledVector(_c.copy(s.pos).normalize(), (60 - rs) * 2.5);
    for (const b of this.bodies) {
      const lim = b.r * 1.4 + 3;
      const dd = s.pos.distanceTo(b.pos);
      if (dd < lim) des.addScaledVector(_c.subVectors(s.pos, b.pos).normalize(), (lim - dd) * 6);
    }
    s.vel.lerp(des, 1 - Math.exp(-dt * ACCEL[s.cls]));
    s.pos.addScaledVector(s.vel, dt);
    s.mesh.position.copy(s.pos);

    // ---- face travel direction, or the target when stationary
    const v = s.vel.length();
    let look = null;
    if (tgt && v < d.speed * 0.4 && s.pos.distanceTo(tgt.pos) < d.range * 1.3) look = _c.subVectors(tgt.pos, s.pos);
    else if (v > 0.6) look = _c.copy(s.vel);
    if (look && look.lengthSq() > 1e-6) {
      _m.lookAt(look.normalize(), ORIGIN, UP);
      _q.setFromRotationMatrix(_m);
      s.mesh.quaternion.slerp(_q, 1 - Math.exp(-dt * TURN[s.cls]));
    }

    // ---- engine trail
    if (v > 3) {
      s.trailT -= dt;
      if (s.trailT <= 0) {
        s.trailT = s.cls === 'corvette' ? 0.05 : 0.06;
        const F = FACTIONS[s.faction].color;
        const eng = s.assets.def.engines;
        const k = Math.min(1, v / d.speed);
        for (let i = 0; i < eng.length; i++) {
          if (eng.length > 2 && i === 2 && s.cls === 'frigate') continue;
          _d.set(eng[i][0], eng[i][1], eng[i][2]).applyQuaternion(s.mesh.quaternion).add(s.pos);
          const sz = s.cls === 'dreadnought' ? 1.3 : s.cls === 'frigate' ? 0.75 : 0.55;
          this.fx.p.emit(_d.x, _d.y, _d.z, -s.vel.x * 0.15, -s.vel.y * 0.15, -s.vel.z * 0.15,
            s.cls === 'corvette' ? 0.7 : 1.1, sz, F.r * 1.6 * k, F.g * 1.4 * k, F.b * 1.3 * k, 0, 0.5);
        }
      }
    }

    // ---- weapons
    s.cd -= dt;
    if (tgt && !tgt.dead && s.cd <= 0) {
      const range = s.pos.distanceTo(tgt.pos);
      if (range <= d.range) { this.fire(s, tgt, range); s.cd = d.rof * (0.85 + Math.random() * 0.3); }
    }
  }

  leashOk(s, tgt) {
    if (!s.host && !s.hold) return true;
    const anchor = s.host ? s.host.pos : s.hold;
    return tgt.pos.distanceTo(anchor) < s.def.aggro + (s.host ? s.host.captureR : 20);
  }

  fire(s, tgt, range) {
    const d = s.def;
    const F = FACTIONS[s.faction].color;
    const q = s.mesh.quaternion;
    const near = this.camera.position.distanceTo(s.pos);
    if (d.kind === 'bolt') {
      const speed = 170;
      const tof = range / speed;
      _a.set(0, 0, 1.3).applyQuaternion(q).add(s.pos);
      _b.copy(tgt.pos).addScaledVector(tgt.vel, tof);
      _b.x += (Math.random() - 0.5) * 1.2; _b.y += (Math.random() - 0.5) * 1.2; _b.z += (Math.random() - 0.5) * 1.2;
      _c.subVectors(_b, _a).normalize().multiplyScalar(speed);
      for (let k = 0; k < 3; k++) {
        const o = k * 0.006;
        this.fx.p.emit(_a.x - _c.x * o, _a.y - _c.y * o, _a.z - _c.z * o, _c.x, _c.y, _c.z, tof, 0.55 - k * 0.12, F.r * 5, F.g * 4, F.b * 3, 0, 0);
      }
      const hit = Math.random() < EVADE[tgt.cls];
      this.pending.push({ at: this.time + tof, tgt, dmg: d.dmg, src: s.cls, faction: s.faction, pos: _b.clone(), hit, splash: 0 });
      this.audio?.shot('bolt', near);
    } else if (d.kind === 'beam') {
      _a.set(0, 0.38, 2.6).applyQuaternion(q).add(s.pos);
      _b.copy(tgt.pos).add(_c.randomDirection().multiplyScalar(0.7));
      this.fx.beams.add(_a, _b, F, 0.11, 0.3, 9);
      this.fx.sparks(_b, F, 5);
      this.damage(tgt, d.dmg, s.cls, s.faction);
      this.audio?.shot('beam', near);
    } else {
      const guns = s.assets.def.guns;
      const speed = 95;
      for (let g = 0; g < guns.length; g++) {
        _a.set(guns[g][0], guns[g][1], guns[g][2] + 1.8).applyQuaternion(q).add(s.pos);
        const tof = _a.distanceTo(tgt.pos) / speed;
        _b.copy(tgt.pos).addScaledVector(tgt.vel, tof).add(_c.randomDirection().multiplyScalar(2.2));
        _c.subVectors(_b, _a).normalize().multiplyScalar(speed);
        this.fx.p.emit(_a.x, _a.y, _a.z, _c.x, _c.y, _c.z, tof, 1.5, F.r * 6, F.g * 4.5, F.b * 3, 0, 0);
        this.fx.p.emit(_a.x, _a.y, _a.z, 0, 0, 0, 0.14, 1.8, 3, 2.3, 1.6, 2);
        this.pending.push({ at: this.time + tof, tgt, dmg: d.dmg, src: s.cls, faction: s.faction, pos: _b.clone(), hit: true, splash: d.splash });
      }
      this.audio?.shot('shell', near);
    }
  }

  resolve(t) {
    if (!this.pending.length) return;
    const keep = [];
    for (const p of this.pending) {
      if (p.at > t) { keep.push(p); continue; }
      const F = FACTIONS[p.faction].color;
      if (p.splash) {
        this.fx.explosion(p.pos, 0.35, F, null);
        for (const o of this.ships) {
          if (o.faction === p.faction || o.dead) continue;
          const dd = o.pos.distanceTo(p.pos);
          if (dd < p.splash) this.damage(o, p.dmg * (1 - dd / p.splash * 0.6), p.src, p.faction);
        }
      } else if (p.hit && !p.tgt.dead) {
        this.damage(p.tgt, p.dmg, p.src, p.faction);
        this.fx.sparks(p.tgt.pos, F, 3);
      }
    }
    this.pending = keep;
  }

  damage(o, dmg, srcCls, faction) {
    if (o.dead) return;
    const mult = srcCls && SHIPS[srcCls] ? (SHIPS[srcCls].bonus[o.cls] || 1) : 1;
    o.hp -= dmg * mult;
    o.hit = 1;
    if (o.host) o.host.underAttack = 4;
    if (o.hp <= 0) this.kill(o, faction);
  }

  kill(o, by) {
    if (o.dead) return;
    o.remove(this.scene);
    const F = FACTIONS[o.faction].color;
    this.fx.explosion(o.pos, EXPLO[o.cls], F, this.camera.position);
    this.factions[o.faction].lost++;
    if (this.factions[by]) this.factions[by].killed++;
    this.audio?.boom(EXPLO[o.cls], this.camera.position.distanceTo(o.pos));
    if (o.cls === 'dreadnought') this.emit('log', { text: o.faction === 'player' ? `מצודה אבדה` : `מצודה של אופל הושמדה`, kind: o.faction === 'player' ? 'bad' : 'ok' });
    this.emit('dead', o);
  }

  // planetary guns: shore batteries and native militia on unclaimed worlds
  defences(dt) {
    for (const b of this.bodies) {
      const armed = (b.structures.battery && (b.owner === 'player' || b.owner === 'enemy')) || (b.owner === 'neutral' && b.native > 0);
      if (!armed) continue;
      b.batteryCd -= dt;
      if (b.batteryCd > 0) continue;
      const range = b.captureR + 22;
      let best = null, bd = Infinity;
      for (const s of this.ships) {
        if (s.faction === b.owner) continue;
        const dd = s.pos.distanceTo(b.pos);
        if (dd < range && dd < bd) { bd = dd; best = s; }
      }
      if (!best) { b.batteryCd = 0.3; continue; }
      const neutral = b.owner === 'neutral';
      const col = neutral ? NATIVE : FACTIONS[b.owner].color;
      _a.subVectors(best.pos, b.pos).normalize().multiplyScalar(b.r * 1.02).add(b.pos);
      this.fx.beams.add(_a, best.pos, col, neutral ? 0.12 : 0.22, 0.35, neutral ? 5 : 10);
      this.fx.sparks(best.pos, col, 4);
      const capital = b.home === b.owner;
      this.damage(best, neutral ? 7 * b.native : capital ? 46 : 34, null, b.owner);
      b.batteryCd = neutral ? 1.6 : capital ? 0.7 : 1.0;
      this.audio?.shot('battery', this.camera.position.distanceTo(b.pos));
    }
  }

  checkEnd() {
    const p = this.bodies.some((b) => b.owner === 'player');
    const e = this.bodies.some((b) => b.owner === 'enemy');
    if (!p) { this.over = 'lose'; this.emit('end', 'lose'); }
    else if (!e) { this.over = 'win'; this.emit('end', 'win'); }
  }
}

const NATIVE = new THREE.Color('#d8d2c0');
