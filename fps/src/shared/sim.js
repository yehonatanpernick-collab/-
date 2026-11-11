// Authoritative match simulation: Conquest (5 flags, tickets), players + bots, ballistics
// with lag compensation, explosives & destruction, tanks, revives, squads, spotting.
// Runs on the Node server and in-browser (offline / practice mode).
import { generateWorld, raycast, heightAt, los, queryBoxes, overlapsSolid, destroyPanel, breakGlass, collapseBuilding, shouldCollapse, F, BOUNDS, MAT } from './world.js';
import { buildNav, findPath, isFree, refreshNavArea } from './nav.js';
import { makeBody, stepBody } from './movement.js';
import { makeTank, stepTank, tankMuzzle, tankMg } from './vehicle.js';
import { WEAPONS, CLASSES, CLASS_LIST, RULES, PROJECTILES, TANK, SCORE, MOVE, TICK_DT, GRAVITY, falloff } from './config.js';
import { mulberry32, clamp, wrapAngle, fwd, yawTo, rayCapsuleY, raySphere, rayBox } from './math.js';

const BOT_NAMES = ['Viper', 'Ghost', 'Nomad', 'Havoc', 'Raptor', 'Saber', 'Reaper', 'Atlas', 'Kodiak', 'Wolfhound', 'Mako', 'Talon', 'Outlaw', 'Specter', 'Bishop', 'Rook', 'Grizzly', 'Hornet', 'Jackal', 'Cobra', 'Falcon', 'Mantis', 'Ronin', 'Tusk', 'Warden', 'Onyx', 'Blitz', 'Cipher', 'Dagger', 'Echo', 'Fang', 'Gunner', 'Hex', 'Iron', 'Jester', 'Kilo', 'Lynx', 'Maverick', 'Nova', 'Orca'];
const PROJ_TYPES = ['gl', 'rocket', 'shell', 'frag'];
const INTERP = 0.1;

export class Sim {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 1337;
    this.W = opts.world || generateWorld(this.seed);
    if (!this.W.nav) buildNav(this.W);
    this.W.boxes.forEach((b) => { b.initActive = b.active; });
    this.botTarget = opts.bots ?? 24;
    this.botSkill = opts.skill ?? 0.6;
    this.time = 0; this.tickN = 0;
    this.rng = mulberry32((this.seed * 9301 + (opts.salt ?? Date.now())) >>> 0);
    this.players = new Map();
    this.clients = new Map();
    this.nextCid = 1; this.nextId = 1;
    this.vehicles = []; this.projs = []; this.bullets = []; this.ents = [];
    this.events = [];
    this.pathBudget = 0;
    this.destroyed = []; this.glass = []; this.collapsed = [];
    this.rosterDirty = true; this.rosterT = 0;
    this.resetRound(true);
  }

  // ------------------------------------------------------------ round
  resetRound(first = false) {
    const W = this.W;
    if (!first) {
      for (const b of W.boxes) b.active = b.initActive;
      for (const P of W.panels) { P.alive = true; P.hp = P.maxHp; }
      for (const B of W.buildings) B.collapsed = false;
      buildNav(W);
    }
    this.destroyed = []; this.glass = []; this.collapsed = [];
    this.flags = W.flags.map((f, i) => ({ ...f, owner: i === 0 ? 1 : i === W.flags.length - 1 ? 2 : 0, prog: i === 0 ? 1 : i === W.flags.length - 1 ? -1 : 0 }));
    this.tickets = [0, RULES.tickets, RULES.tickets];
    this.bleedAcc = [0, 0, 0];
    this.phase = 'play'; this.winner = 0; this.endAt = 0;
    this.projs = []; this.bullets = []; this.ents = [];
    this.vehicles = [];
    for (const team of [1, 2]) {
      const h = W.hq[team].tank;
      this.vehicles.push(makeTank(this.vehicles.length, team, h.x, heightAt(W, h.x, h.z), h.z, h.yaw));
    }
    for (const p of this.players.values()) {
      p.alive = false; p.downed = false; p.veh = -1; p.respawnAt = this.time + 3;
      p.score = 0; p.kills = 0; p.deaths = 0; p.assists = 0; p.revives = 0; p.caps = 0;
    }
    if (!first) this.emit({ e: 'reset' });
    this.rosterDirty = true;
  }

  // ------------------------------------------------------------ clients
  addClient(send) {
    const cid = this.nextCid++;
    this.clients.set(cid, { cid, send, pid: -1, rtt: 0.08, pingT: 0, pingSent: 0 });
    return cid;
  }
  removeClient(cid) {
    const c = this.clients.get(cid);
    if (!c) return;
    if (c.pid >= 0) {
      const p = this.players.get(c.pid);
      if (p) { this.leaveVehicle(p); this.players.delete(p.id); this.emit({ e: 'leave', id: p.id, n: p.name }); }
    }
    this.clients.delete(cid);
    this.rosterDirty = true;
    this.balanceBots();
  }

  teamCounts() {
    const c = [0, 0, 0], h = [0, 0, 0];
    for (const p of this.players.values()) { c[p.team]++; if (!p.bot) h[p.team]++; }
    return { c, h };
  }
  pickSquad(team) {
    const n = {};
    for (const p of this.players.values()) if (p.team === team) n[p.squad] = (n[p.squad] || 0) + 1;
    for (let s = 1; s < 20; s++) if ((n[s] || 0) < RULES.squadSize) return s;
    return 1;
  }
  newPlayer(name, team, bot, cid = -1) {
    const id = this.nextId++;
    const p = {
      id, name, team, squad: this.pickSquad(team), bot, cid, cls: bot ? CLASS_LIST[(id * 7 + (this.rng() * 4) | 0) % 4] : 'assault',
      alive: false, downed: false, hp: 100, body: makeBody(), yaw: 0, pitch: 0, crouch: false, sprint: false, ads: false, slot: 0,
      ammo: {}, grenades: 2, veh: -1, score: 0, kills: 0, deaths: 0, assists: 0, revives: 0, caps: 0,
      respawnAt: this.time + (bot ? 1 + this.rng() * 4 : 0), bleedAt: 0, protUntil: 0, dmgBy: new Map(), hist: [], spottedUntil: 0,
      lastFire: {}, oobT: 0, lastHurtT: -10, lastHurtBy: -1, reloading: false, firingT: -10, gadgetT: -100, crateT: -100,
      inT: 0,
    };
    if (bot) p.brain = this.newBrain(p);
    this.players.set(id, p);
    this.rosterDirty = true;
    return p;
  }
  balanceBots() {
    const per = Math.floor(this.botTarget / 2);
    for (const team of [1, 2]) {
      let list = [...this.players.values()].filter((p) => p.team === team);
      const humans = list.filter((p) => !p.bot).length;
      let bots = list.filter((p) => p.bot);
      const want = Math.max(0, per - humans);
      while (bots.length > want) {
        bots.sort((a, b) => (a.alive ? 1 : 0) - (b.alive ? 1 : 0));
        const b = bots.shift();
        this.leaveVehicle(b);
        this.players.delete(b.id);
        this.emit({ e: 'leave', id: b.id, n: b.name, q: 1 });
      }
      while (bots.length < want) {
        const used = new Set([...this.players.values()].map((p) => p.name));
        let nm = BOT_NAMES[(this.rng() * BOT_NAMES.length) | 0];
        for (let k = 0; used.has(nm) && k < 40; k++) nm = BOT_NAMES[(this.rng() * BOT_NAMES.length) | 0] + '-' + ((this.rng() * 90 + 10) | 0);
        bots.push(this.newPlayer(nm, team, true));
      }
    }
    this.rosterDirty = true;
  }

  handle(cid, m) {
    const c = this.clients.get(cid);
    if (!c || !m || typeof m.t !== 'string') return;
    if (m.t === 'hello') {
      if (c.pid >= 0) return;
      const { c: cnt } = this.teamCounts();
      const { h } = this.teamCounts();
      const team = m.team === 1 || m.team === 2 ? m.team : (h[1] < h[2] ? 1 : h[2] < h[1] ? 2 : (cnt[1] <= cnt[2] ? 1 : 2));
      const name = String(m.name || 'Soldier').replace(/[^\w \-.]/g, '').slice(0, 16) || 'Soldier';
      const p = this.newPlayer(name, team, false, cid);
      c.pid = p.id;
      this.balanceBots();
      c.send({
        t: 'welcome', id: p.id, seed: this.seed, time: this.time, team,
        destroyed: this.destroyed, glass: this.glass, collapsed: this.collapsed,
        flags: this.flags.map((f) => [Math.round(f.prog * 1000), f.owner]), tickets: this.tickets, phase: this.phase,
      });
      this.emit({ e: 'join', id: p.id, n: p.name });
      this.sendRoster(true);
      return;
    }
    if (m.t === 'pong') { c.rtt = clamp(this.time - (m.s || 0), 0, 1); return; }
    const p = this.players.get(c.pid);
    if (!p) return;
    switch (m.t) {
      case 'spawn': this.trySpawn(p, m.at, m.cls); break;
      case 'in': this.applyInput(p, m); break;
      case 'fire': this.humanFire(p, m, c); break;
      case 'proj': this.humanProj(p, m); break;
      case 'reload': { const w = WEAPONS[m.w]; if (w && p.ammo[m.w]) { const a = p.ammo[m.w]; const need = w.mag - a[0]; const take = Math.min(need, a[1]); a[0] += take; a[1] -= take; } break; }
      case 'deploy': this.deploy(p, m); break;
      case 'enter': this.tryEnter(p); break;
      case 'exit': this.leaveVehicle(p, true); break;
      case 'tfire': this.tankFire(p, m); break;
      case 'tmg': this.tankMgFire(p, m, c); break;
      case 'revive': this.tryRevive(p, m.id); break;
      case 'spot': this.spot(p, m.ids); break;
      case 'giveup': if (p.downed) this.finishDown(p); break;
      case 'suicide': if (p.alive) this.kill(p, null, 'suicide', false, true); break;
      case 'team': if (!p.alive && (m.team === 1 || m.team === 2) && m.team !== p.team) { p.team = m.team; p.squad = this.pickSquad(p.team); this.balanceBots(); } break;
      case 'chat': this.emit({ e: 'chat', id: p.id, n: p.name, tm: p.team, m: String(m.m || '').slice(0, 120) }); break;
    }
  }

  emit(ev) { this.events.push(ev); }

  // ------------------------------------------------------------ spawning
  spawnOptions(p) {
    const o = ['hq'];
    for (const f of this.flags) if (f.owner === p.team && !this.flagContested(f)) o.push(f.id);
    for (const q of this.players.values()) if (q.team === p.team && q.squad === p.squad && q !== p && q.alive && !q.downed && q.veh < 0) o.push('sq:' + q.id);
    for (const e of this.ents) if (e.ty === 'beacon' && e.team === p.team && e.squad === p.squad) o.push('beacon');
    const t = this.vehicles.find((v) => v.team === p.team && v.alive && v.driver < 0);
    if (t) o.push('tank');
    return o;
  }
  flagContested(f) { return f._enemies && f._enemies[f.owner] > 0; }

  findSpot(cx, cz, r0, r1, tries = 30) {
    const W = this.W;
    for (let i = 0; i < tries; i++) {
      const a = this.rng() * Math.PI * 2, r = r0 + this.rng() * (r1 - r0);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!isFree(W, x, z)) continue;
      const h = heightAt(W, x, z);
      const out = {};
      let y = h;
      if (raycast(W, x, h + 2.2, z, 0, -1, 0, 3, F.SOLID, out, true) >= 0) y = Math.max(h, out.y);
      if (overlapsSolid(W, x - 0.4, y + 0.05, z - 0.4, x + 0.4, y + 1.8, z + 0.4)) continue;
      return [x, y, z];
    }
    return [cx, heightAt(W, cx, cz) + 0.5, cz];
  }

  trySpawn(p, at, cls) {
    if (p.alive || this.phase !== 'play') return false;
    if (this.time < p.respawnAt) return false;
    if (cls && CLASSES[cls]) p.cls = cls;
    const C = CLASSES[p.cls];
    const opts = this.spawnOptions(p);
    if (!opts.includes(at)) at = 'hq';
    const W = this.W;
    let pos, veh = -1, yaw = p.team === 1 ? Math.PI : 0;
    if (at === 'hq') { const h = W.hq[p.team]; pos = this.findSpot(h.x - 4, h.z - h.dir * 2, 2, 14); }
    else if (at === 'tank') {
      const t = this.vehicles.find((v) => v.team === p.team && v.alive && v.driver < 0);
      if (t) { veh = t.id; pos = [t.x, t.y + 1, t.z]; yaw = t.yaw; } else { const h = W.hq[p.team]; pos = this.findSpot(h.x, h.z, 2, 12); }
    } else if (at.startsWith('sq:')) {
      const q = this.players.get(+at.slice(3));
      if (q && q.alive && !q.downed) {
        const b = q.body;
        const bx = b.x + Math.sin(q.yaw) * 1.2, bz = b.z + Math.cos(q.yaw) * 1.2;
        pos = overlapsSolid(W, bx - 0.35, b.y + 0.05, bz - 0.35, bx + 0.35, b.y + 1.8, bz + 0.35) ? [b.x, b.y + 0.05, b.z] : [bx, b.y + 0.05, bz];
        yaw = q.yaw;
        this.addScore(q, SCORE.squadSpawn, 'SQUAD SPAWN');
      } else { const h = W.hq[p.team]; pos = this.findSpot(h.x, h.z, 2, 12); }
    } else if (at === 'beacon') {
      const e = this.ents.find((e) => e.ty === 'beacon' && e.team === p.team && e.squad === p.squad);
      pos = e ? this.findSpot(e.x, e.z, 0.8, 3) : this.findSpot(W.hq[p.team].x, W.hq[p.team].z, 2, 12);
    } else {
      const f = this.flags.find((f) => f.id === at);
      pos = this.findSpot(f.x, f.z, 5, Math.max(8, f.r * 0.8));
      yaw = yawTo(-f.x, (p.team === 1 ? 300 : -300) - f.z);
    }
    const b = p.body;
    b.x = pos[0]; b.y = pos[1]; b.z = pos[2]; b.vx = b.vy = b.vz = 0; b.h = MOVE.height; b.crouch = false; b.slideT = 0;
    p.alive = true; p.downed = false; p.hp = C.hp; p.yaw = yaw; p.pitch = 0; p.slot = 0;
    p.ammo = {};
    for (const wid of [C.primary, C.secondary, C.gadget]) { const w = WEAPONS[wid]; if (w.mag) p.ammo[wid] = [w.mag, w.reserve]; }
    p.grenades = C.grenades;
    p.protUntil = this.time + RULES.spawnProtect;
    p.dmgBy.clear(); p.hist = [];
    p.oobT = 0;
    p.veh = -1;
    if (veh >= 0) { const t = this.vehicles[veh]; t.driver = p.id; p.veh = veh; }
    if (p.bot) p.brain = this.newBrain(p);
    this.emit({ e: 'spawn', id: p.id, x: b.x, y: b.y, z: b.z, yaw, cls: p.cls, veh: p.veh });
    this.rosterDirty = true;
    return true;
  }

  // ------------------------------------------------------------ input
  applyInput(p, m) {
    if (!p.alive) return;
    p.inT = this.time;
    if (typeof m.yaw === 'number') p.yaw = m.yaw;
    if (typeof m.pitch === 'number') p.pitch = clamp(m.pitch, -1.55, 1.55);
    if (p.downed) return;
    if (p.veh >= 0) {
      const t = this.vehicles[p.veh];
      if (t && t.driver === p.id && Array.isArray(m.v)) {
        const [x, y, z, yaw, pitch, roll, speed, ty, gp] = m.v;
        if ([x, y, z].every(Number.isFinite) && Math.hypot(x - t.x, z - t.z) < 8) {
          t.x = x; t.y = y; t.z = z; t.yaw = yaw; t.pitch = pitch; t.roll = roll; t.speed = speed; t.turretYaw = ty; t.gunPitch = gp;
          t.tread += speed * TICK_DT;
        }
        p.body.x = t.x; p.body.y = t.y + 1; p.body.z = t.z;
      }
      return;
    }
    const b = p.body;
    if (Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.z)) {
      const d = Math.hypot(m.x - b.x, m.z - b.z);
      if (d > 14 || m.y - b.y > 4.5) {
        c_tp(this, p);
      } else { b.x = m.x; b.y = m.y; b.z = m.z; }
    }
    b.vx = m.vx || 0; b.vy = m.vy || 0; b.vz = m.vz || 0;
    p.crouch = !!m.c; p.sprint = !!m.sp; p.ads = !!m.ads; b.onGround = !!m.g; p.reloading = !!m.rl;
    b.h = p.crouch ? MOVE.crouchHeight : MOVE.height;
    if (m.s === 0 || m.s === 1 || m.s === 2) p.slot = m.s;
  }

  // ------------------------------------------------------------ weapons
  eye(p) { return p.body.y + (p.crouch ? MOVE.crouchEye : MOVE.eye); }
  classWeapon(p, wid) { const C = CLASSES[p.cls]; return wid === C.primary || wid === C.secondary || wid === C.gadget; }

  humanFire(p, m, c) {
    if (!p.alive || p.downed || p.veh >= 0) return;
    const w = WEAPONS[m.w];
    if (!w || w.gadget || !this.classWeapon(p, m.w)) return;
    const last = p.lastFire[m.w] || -10;
    if (this.time - last < (60 / w.rpm) * 0.5) return;
    const a = p.ammo[m.w];
    if (!a || a[0] <= 0) return;
    a[0]--;
    p.lastFire[m.w] = this.time;
    const o = m.o, d = m.d;
    if (!Array.isArray(o) || !Array.isArray(d)) return;
    if (Math.hypot(o[0] - p.body.x, o[1] - this.eye(p), o[2] - p.body.z) > 3) { o[0] = p.body.x; o[1] = this.eye(p); o[2] = p.body.z; }
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const dir = [d[0] / l, d[1] / l, d[2] / l];
    const lag = clamp((c ? c.rtt / 2 : 0) + INTERP, 0, 0.35);
    this.spawnBullet(p, w, o, dir, this.time - lag);
    p.firingT = this.time;
    p.protUntil = 0;
    this.emit({ e: 'shot', id: p.id, w: w.id, o: o.map((v) => +v.toFixed(2)), d: dir.map((v) => +v.toFixed(4)) });
  }

  spawnBullet(p, w, o, d, t0, mg = false) {
    this.bullets.push({ owner: p.id, team: p.team, w, x: o[0], y: o[1], z: o[2], vx: d[0] * w.vel, vy: d[1] * w.vel, vz: d[2] * w.vel, t0, age: 0, dist: 0, mg });
  }

  humanProj(p, m) {
    if (!p.alive || p.downed || p.veh >= 0) return;
    const ty = m.ty;
    if (!PROJECTILES[ty] || ty === 'shell') return;
    if (ty === 'frag') {
      if (p.grenades <= 0) return;
      p.grenades--;
    } else {
      const wid = ty === 'gl' ? 'gl40' : 'rpg';
      if (!this.classWeapon(p, wid)) return;
      const a = p.ammo[wid];
      if (!a || a[0] <= 0) return;
      const last = p.lastFire[wid] || -10;
      if (this.time - last < 1.0) return;
      a[0]--; p.lastFire[wid] = this.time;
    }
    const o = Array.isArray(m.o) ? m.o : [p.body.x, this.eye(p), p.body.z];
    if (Math.hypot(o[0] - p.body.x, o[2] - p.body.z) > 3) { o[0] = p.body.x; o[1] = this.eye(p); o[2] = p.body.z; }
    const d = m.d; const l = Math.hypot(d[0], d[1], d[2]) || 1;
    this.spawnProj(p, ty, o, [d[0] / l, d[1] / l, d[2] / l], m.cook || 0);
    p.protUntil = 0;
  }

  spawnProj(p, ty, o, d, cook = 0) {
    const P = PROJECTILES[ty];
    const id = this.nextId++;
    const sp = P.speed;
    const pr = { id, ty, owner: p.id, team: p.team, x: o[0], y: o[1], z: o[2], vx: d[0] * sp, vy: d[1] * sp, vz: d[2] * sp, age: 0, fuse: P.fuse ? P.fuse - clamp(cook, 0, 2.5) : 0, rest: false };
    if (ty === 'frag' && p.body) { pr.vx += p.body.vx * 0.5; pr.vz += p.body.vz * 0.5; pr.vy += 2.5; }
    this.projs.push(pr);
    this.emit({ e: 'proj', id, ty, owner: p.id, o: o.map((v) => +v.toFixed(2)), d: d.map((v) => +v.toFixed(3)) });
  }

  deploy(p, m) {
    if (!p.alive || p.downed || p.veh >= 0) return;
    const C = CLASSES[p.cls];
    const g = WEAPONS[C.gadget];
    if (!g.deploy) return;
    if (this.time - p.gadgetT < g.cooldown) return;
    p.gadgetT = this.time;
    const b = p.body;
    let x = Number.isFinite(m.x) ? m.x : b.x, z = Number.isFinite(m.z) ? m.z : b.z;
    if (Math.hypot(x - b.x, z - b.z) > 4) { x = b.x; z = b.z; }
    const y = Number.isFinite(m.y) && Math.abs(m.y - b.y) < 3 ? m.y : b.y;
    this.ents = this.ents.filter((e) => !(e.owner === p.id && e.ty === g.deploy));
    const e = { id: this.nextId++, ty: g.deploy, owner: p.id, team: p.team, squad: p.squad, x, y, z, until: this.time + (g.deploy === 'crate' ? 75 : 1e9), tick: 0 };
    this.ents.push(e);
    this.emit({ e: 'deploy', id: e.id, ty: e.ty, owner: p.id });
  }

  // ------------------------------------------------------------ vehicles
  tryEnter(p) {
    if (!p.alive || p.downed || p.veh >= 0) return;
    let best = null, bd = 6.5;
    for (const t of this.vehicles) {
      if (!t.alive || t.driver >= 0 || t.team !== p.team) continue;
      const d = Math.hypot(t.x - p.body.x, t.z - p.body.z);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return;
    best.driver = p.id; p.veh = best.id;
    this.emit({ e: 'enter', id: p.id, v: best.id });
  }
  leaveVehicle(p, place = false) {
    if (p.veh < 0) return;
    const t = this.vehicles[p.veh];
    p.veh = -1;
    if (t && t.driver === p.id) {
      t.driver = -1;
      if (place && p.alive) {
        const rx = Math.cos(t.yaw), rz = -Math.sin(t.yaw);
        const cands = [[rx * 3.4, rz * 3.4], [-rx * 3.4, -rz * 3.4], [Math.sin(t.yaw) * 5, Math.cos(t.yaw) * 5]];
        let pos = [t.x + cands[0][0], t.z + cands[0][1]];
        for (const c of cands) { const x = t.x + c[0], z = t.z + c[1]; const h = heightAt(this.W, x, z); if (!overlapsSolid(this.W, x - 0.4, h + 0.1, z - 0.4, x + 0.4, h + 1.8, z + 0.4)) { pos = [x, z]; break; } }
        p.body.x = pos[0]; p.body.z = pos[1]; p.body.y = heightAt(this.W, pos[0], pos[1]) + 0.1; p.body.vx = p.body.vy = p.body.vz = 0;
      }
      this.emit({ e: 'exit', id: p.id, v: t.id, x: p.body.x, y: p.body.y, z: p.body.z });
    }
  }
  tankFire(p, m) {
    if (p.veh < 0) return;
    const t = this.vehicles[p.veh];
    if (!t || !t.alive || t.driver !== p.id || t.reload > 0) return;
    t.reload = TANK.reload;
    const mz = tankMuzzle(t);
    this.spawnProj(p, 'shell', mz.o, mz.d);
    this.emit({ e: 'tshot', v: t.id });
    void m;
  }
  tankMgFire(p, m, c) {
    if (p.veh < 0) return;
    const t = this.vehicles[p.veh];
    if (!t || !t.alive || t.driver !== p.id) return;
    if (this.time - (p.lastFire.tmg || -1) < 60 / TANK.mgRpm * 0.5) return;
    p.lastFire.tmg = this.time;
    const mg = tankMg(t);
    const d = Array.isArray(m.d) ? m.d : mg.d; const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const dir = [d[0] / l, d[1] / l, d[2] / l];
    this.spawnBullet(p, MG_WEAPON, mg.o, dir, this.time - clamp((c ? c.rtt / 2 : 0) + INTERP, 0, 0.35), true);
    this.emit({ e: 'shot', id: p.id, w: 'tmg', o: mg.o.map((v) => +v.toFixed(2)), d: dir.map((v) => +v.toFixed(4)) });
  }
  damageVehicle(t, amount, att, wname) {
    if (!t.alive) return;
    if (att && att.team === t.team && (!t.driver || att.id !== t.driver)) return;
    t.hp -= amount;
    t.lastHitBy = att ? att.id : -1;
    if (att) this.emit({ e: 'vhit', a: att.id, v: t.id, d: Math.round(amount) });
    if (t.hp <= 0) {
      t.hp = 0; t.alive = false; t.respawnAt = this.time + RULES.tankRespawn;
      this.emit({ e: 'vboom', v: t.id, x: t.x, y: t.y, z: t.z });
      if (t.driver >= 0) { const d = this.players.get(t.driver); if (d) { this.leaveVehicle(d); this.kill(d, att, wname || 'rpg', false, true); } }
      if (att && att.team !== t.team) this.addScore(att, SCORE.vehicle, 'VEHICLE DESTROYED');
    }
  }

  // ------------------------------------------------------------ damage
  addScore(p, pts, reason) {
    if (!p) return;
    p.score += pts;
    this.emit({ e: 'sc', to: p.id, p: pts, r: reason });
  }
  damage(v, amount, att, wid, o = {}) {
    if (!v.alive || v.downed || amount <= 0) return;
    if (this.time < v.protUntil) return;
    if (att && att !== v && att.team === v.team) return;
    if (v.veh >= 0 && !o.force) return;
    v.hp -= amount;
    v.lastHurtT = this.time; v.lastHurtBy = att ? att.id : -1;
    if (att && att !== v) { const r = v.dmgBy.get(att.id) || { d: 0, t: 0 }; r.d += amount; r.t = this.time; v.dmgBy.set(att.id, r); }
    const killed = v.hp <= 0;
    this.emit({ e: 'hit', a: att ? att.id : -1, v: v.id, d: Math.round(amount), h: o.head ? 1 : 0, k: killed ? 1 : 0, x: att ? +att.body.x.toFixed(1) : v.body.x, z: att ? +att.body.z.toFixed(1) : v.body.z });
    if (v.bot && att && att !== v) { v.brain.hurtBy = att.id; v.brain.hurtT = this.time; }
    if (killed) {
      const hard = o.head || o.expl || v.hp < -45 || v.veh >= 0;
      if (hard) this.kill(v, att, wid, o.head, true);
      else this.down(v, att, wid, o.head);
    }
  }
  creditKill(v, att, wid, head) {
    const killer = att && att !== v ? att : null;
    this.tickets[v.team] = Math.max(0, this.tickets[v.team] - 1);
    v.deaths++;
    if (killer) {
      killer.kills++;
      this.addScore(killer, SCORE.kill, 'ENEMY KILLED');
      if (head) this.addScore(killer, SCORE.headshot, 'HEADSHOT');
      for (const f of this.flags) if (Math.hypot(v.body.x - f.x, v.body.z - f.z) < f.r + 8 && f.owner === killer.team) { this.addScore(killer, SCORE.defend, 'FLAG DEFEND'); break; }
    }
    for (const [aid, r] of v.dmgBy) {
      if (killer && aid === killer.id) continue;
      if (this.time - r.t < 12 && r.d >= 20) { const a = this.players.get(aid); if (a && a.team !== v.team) { a.assists++; this.addScore(a, SCORE.assist, 'KILL ASSIST'); } }
    }
    this.emit({ e: 'kill', k: killer ? killer.id : -1, v: v.id, w: wid, h: head ? 1 : 0 });
    this.rosterDirty = true;
  }
  down(v, att, wid, head) {
    v.downed = true; v.hp = 0; v.bleedAt = this.time + RULES.bleedOut;
    v.crouch = false;
    v.killer = att ? att.id : -1;
    this.creditKill(v, att, wid, head);
    this.emit({ e: 'down', id: v.id });
  }
  finishDown(v) {
    v.downed = false; v.alive = false; v.respawnAt = this.time + RULES.respawnDelay * 0.5;
    this.emit({ e: 'dead', id: v.id, k: v.killer ?? -1 });
  }
  kill(v, att, wid, head, hard) {
    if (!v.alive) return;
    if (!v.downed) this.creditKill(v, att, wid, head);
    v.downed = false; v.alive = false; v.hp = 0;
    v.killer = att ? att.id : -1;
    v.respawnAt = this.time + RULES.respawnDelay;
    this.leaveVehicle(v);
    this.emit({ e: 'dead', id: v.id, k: v.killer, hard: hard ? 1 : 0 });
  }
  tryRevive(p, id) {
    const v = this.players.get(id);
    if (!v || !p.alive || p.downed || !v.alive || !v.downed || v.team !== p.team) return;
    if (Math.hypot(v.body.x - p.body.x, v.body.z - p.body.z) > 3.2) return;
    this.revive(v, p);
  }
  revive(v, by) {
    v.downed = false; v.hp = by.cls === 'support' ? 100 : 50; v.protUntil = this.time + 1;
    v.deaths = Math.max(0, v.deaths - 1);
    this.tickets[v.team]++;
    by.revives++;
    this.addScore(by, SCORE.revive, 'REVIVE');
    this.emit({ e: 'revive', id: v.id, by: by.id });
    this.rosterDirty = true;
  }
  spot(p, ids) {
    if (!Array.isArray(ids)) return;
    const dur = RULES.spotTime * (p.cls === 'recon' ? 1.7 : 1);
    let n = 0;
    for (const id of ids.slice(0, 6)) {
      const v = this.players.get(id);
      if (v && v.team !== p.team && v.alive) { if (v.spottedUntil < this.time) n++; v.spottedUntil = this.time + dur; }
    }
    if (n) this.addScore(p, SCORE.spot * n, 'SPOT');
  }

  // ------------------------------------------------------------ lag-compensated hit tests
  posAt(p, t) {
    const h = p.hist;
    if (!h.length || t >= h[h.length - 1][0]) return [p.body.x, p.body.y, p.body.z, p.crouch ? 1 : 0];
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1][0] <= t) {
        const a = h[i - 1], b = h[i], k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k, k < 0.5 ? a[4] : b[4]];
      }
    }
    const a = h[0]; return [a[1], a[2], a[3], a[4]];
  }
  // returns {t, part:0 head 1 torso 2 legs}
  rayPlayer(p, pos, ox, oy, oz, dx, dy, dz, maxT) {
    const [x, y, z, c] = pos;
    if (Math.abs(x - ox) > maxT + 3 && Math.abs(z - oz) > maxT + 3) return null;
    const hy = c ? 1.08 : 1.62, t0 = c ? 0.55 : 0.92, t1 = c ? 0.98 : 1.42, l0 = 0.12, l1 = c ? 0.5 : 0.86;
    let best = null;
    const th = raySphere(ox, oy, oz, dx, dy, dz, x, y + hy, z, 0.15, maxT);
    if (th >= 0) best = { t: th, part: 0 };
    const tt = rayCapsuleY(ox, oy, oz, dx, dy, dz, x, y + t0, y + t1, z, 0.27, maxT);
    if (tt >= 0 && (!best || tt < best.t)) best = { t: tt, part: 1 };
    const tl = rayCapsuleY(ox, oy, oz, dx, dy, dz, x, y + l0, y + l1, z, 0.21, maxT);
    if (tl >= 0 && (!best || tl < best.t)) best = { t: tl, part: 2 };
    return best;
  }
  rayTank(t, ox, oy, oz, dx, dy, dz, maxT) {
    if (!t.alive) return -1;
    const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
    const lx = ox - t.x, lz = oz - t.z, ly = oy - t.y;
    // rotate into hull frame (inverse yaw)
    const rx = lx * c - lz * s, rz = lx * s + lz * c;
    const rdx = dx * c - dz * s, rdz = dx * s + dz * c;
    const i = [1 / (rdx || 1e-9), 1 / (dy || 1e-9), 1 / (rdz || 1e-9)];
    let best = rayBox(rx, ly, rz, i[0], i[1], i[2], -1.8, 0.3, -3.7, 1.8, 2.05, 3.7, maxT, null);
    const tt = rayBox(rx, ly, rz, i[0], i[1], i[2], -1.3, 2.0, -1.8, 1.3, 2.9, 1.4, maxT, null);
    if (tt >= 0 && (best < 0 || tt < best)) best = tt;
    return best;
  }

  stepBullets(dt) {
    const W = this.W, out = {};
    const keep = [];
    for (const b of this.bullets) {
      let alive = true;
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      let segLen = sp * dt;
      let dx = b.vx / sp, dy = b.vy / sp, dz = b.vz / sp;
      for (let pass = 0; pass < 3 && alive; pass++) {
        const tw = raycast(W, b.x, b.y, b.z, dx, dy, dz, segLen, F.SHOOT, out);
        let hitT = tw >= 0 ? tw : segLen, hitP = null, hitPart = 0, hitV = null;
        const tq = this.time - (this.time - b.t0) + b.age; // compensated target time
        for (const p of this.players.values()) {
          if (!p.alive || p.downed || p.veh >= 0 || p.id === b.owner || p.team === b.team) continue;
          const pos = this.posAt(p, Math.min(this.time, tq));
          if (Math.abs(pos[0] - b.x) > hitT + 2 || Math.abs(pos[2] - b.z) > hitT + 2) continue;
          const r = this.rayPlayer(p, pos, b.x, b.y, b.z, dx, dy, dz, hitT);
          if (r && r.t < hitT) { hitT = r.t; hitP = p; hitPart = r.part; hitV = null; }
        }
        for (const t of this.vehicles) {
          if (!t.alive || (t.driver >= 0 && this.players.get(t.driver)?.id === b.owner)) continue;
          const r = this.rayTank(t, b.x, b.y, b.z, dx, dy, dz, hitT);
          if (r >= 0 && r < hitT) { hitT = r; hitV = t; hitP = null; }
        }
        const nd = b.dist + hitT;
        if (hitP) {
          const att = this.players.get(b.owner);
          const w = b.w;
          let dmg = falloff(w, nd);
          if (hitPart === 0) dmg *= w.head; else if (hitPart === 2) dmg *= w.limb;
          this.damage(hitP, dmg, att, b.mg ? 'tmg' : w.id, { head: hitPart === 0 });
          alive = false;
        } else if (hitV) {
          const att = this.players.get(b.owner);
          this.damageVehicle(hitV, b.mg ? 2 : 1, att, b.w.id);
          alive = false;
        } else if (tw >= 0 && out.box >= 0 && W.boxes[out.box].flags & F.BREAK) {
          const bid = out.box;
          if (breakGlass(W, bid)) { this.glass.push(bid); this.emit({ e: 'glass', b: bid }); }
          b.x += dx * (hitT + 0.02); b.y += dy * (hitT + 0.02); b.z += dz * (hitT + 0.02);
          b.dist += hitT; segLen -= hitT;
          continue;
        } else if (tw >= 0) {
          alive = false;
        } else {
          b.x += dx * segLen; b.y += dy * segLen; b.z += dz * segLen; b.dist += segLen;
        }
        break;
      }
      b.age += dt;
      b.vy -= GRAVITY * dt;
      const drag = 1 - (b.w.drag || 0.02) * dt;
      b.vx *= drag; b.vy *= drag; b.vz *= drag;
      if (alive && b.age < 2.5 && b.dist < 1400 && b.y > -50) keep.push(b);
    }
    this.bullets = keep;
  }

  // ------------------------------------------------------------ projectiles / explosions
  stepProjs(dt) {
    const W = this.W, out = {};
    const keep = [];
    for (const p of this.projs) {
      const P = PROJECTILES[p.ty];
      p.age += dt;
      if (p.ty === 'frag') {
        p.fuse -= dt;
        if (p.fuse <= 0) { this.explode(p.x, p.y + 0.1, p.z, 'frag', p.owner); continue; }
        if (p.rest) { keep.push(p); continue; }
      }
      p.vy -= P.gravity * dt;
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      if (sp < 0.01) { keep.push(p); continue; }
      const dx = p.vx / sp, dy = p.vy / sp, dz = p.vz / sp;
      const len = sp * dt;
      const tw = raycast(W, p.x, p.y, p.z, dx, dy, dz, len, F.SHOOT | F.SOLID, out);
      let hitT = tw >= 0 ? tw : len, hitPl = null, hitV = null;
      if (p.ty !== 'frag') {
        for (const q of this.players.values()) {
          if (!q.alive || q.downed || q.veh >= 0 || q.id === p.owner || p.age < 0.05) continue;
          const r = this.rayPlayer(q, [q.body.x, q.body.y, q.body.z, q.crouch ? 1 : 0], p.x, p.y, p.z, dx, dy, dz, hitT);
          if (r && r.t < hitT) { hitT = r.t; hitPl = q; }
        }
        for (const t of this.vehicles) {
          const owner = this.players.get(p.owner);
          if (owner && owner.veh === t.id) continue;
          const r = this.rayTank(t, p.x, p.y, p.z, dx, dy, dz, hitT);
          if (r >= 0 && r < hitT) { hitT = r; hitV = t; hitPl = null; }
        }
      }
      if (tw >= 0 && !hitPl && !hitV && out.box >= 0 && (W.boxes[out.box].flags & F.BREAK)) {
        if (breakGlass(W, out.box)) { this.glass.push(out.box); this.emit({ e: 'glass', b: out.box }); }
        p.x += dx * len; p.y += dy * len; p.z += dz * len;
        keep.push(p); continue;
      }
      if (hitPl || hitV || tw >= 0) {
        const hx = p.x + dx * hitT, hy = p.y + dy * hitT, hz = p.z + dz * hitT;
        if (p.ty === 'frag') {
          // bounce
          let nx = out.nx, ny = out.ny, nz = out.nz;
          if (hitPl || hitV) { nx = -dx; ny = -dy; nz = -dz; }
          const vn = p.vx * nx + p.vy * ny + p.vz * nz;
          p.vx = (p.vx - 2 * vn * nx) * P.bounce; p.vy = (p.vy - 2 * vn * ny) * P.bounce; p.vz = (p.vz - 2 * vn * nz) * P.bounce;
          p.x = hx + nx * 0.06; p.y = hy + ny * 0.06; p.z = hz + nz * 0.06;
          if (ny > 0.6 && Math.hypot(p.vx, p.vy, p.vz) < 1.6) { p.rest = true; p.vx = p.vy = p.vz = 0; }
          keep.push(p);
          continue;
        }
        const owner = this.players.get(p.owner);
        if (hitV) this.damageVehicle(hitV, P.vehDamage, owner, p.ty === 'shell' ? 'tank' : p.ty === 'rocket' ? 'rpg' : 'gl40');
        if (hitPl && p.ty === 'shell') this.damage(hitPl, 200, owner, 'tank', { expl: true });
        const bx = hx - dx * 0.25, by = hy - dy * 0.25, bz = hz - dz * 0.25;
        this.explode(bx, by, bz, p.ty, p.owner, hitV ? hitV.id : -1, out.box);
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.age < 12 && p.y > -30) keep.push(p);
    }
    this.projs = keep;
  }

  explode(x, y, z, ty, ownerId, skipVeh = -1, hitBox = -1) {
    const W = this.W;
    const P = PROJECTILES[ty];
    const owner = this.players.get(ownerId) || null;
    const R = P.radius;
    this.emit({ e: 'boom', ty, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) });
    const wname = ty === 'shell' ? 'tank' : ty === 'rocket' ? 'rpg' : ty === 'gl' ? 'gl40' : 'frag';
    for (const q of this.players.values()) {
      if (!q.alive || q.downed) continue;
      const cy = q.body.y + 1.0;
      const d = Math.hypot(q.body.x - x, cy - y, q.body.z - z);
      if (d > R) continue;
      let f = Math.pow(1 - d / R, 1.25);
      if (!los(W, x, y + 0.2, z, q.body.x, cy, q.body.z)) f *= d < R * 0.4 ? 0.45 : 0.12;
      let dmg = P.damage * f;
      if (q.id === ownerId) dmg *= 0.6;
      if (q.veh < 0) this.damage(q, dmg, owner, wname, { expl: true });
    }
    for (const t of this.vehicles) {
      if (!t.alive || t.id === skipVeh) continue;
      const d = Math.hypot(t.x - x, t.y + 1.2 - y, t.z - z);
      if (d < R + 2.5) this.damageVehicle(t, P.vehDamage * 0.5 * (1 - d / (R + 2.5)), owner, wname);
    }
    for (const e of this.ents) if (Math.hypot(e.x - x, e.y - y, e.z - z) < R * 0.6) e.until = 0;
    // destruction
    const hitPanels = new Map();
    const glass = [];
    queryBoxes(W, x - R - 1.5, z - R - 1.5, x + R + 1.5, z + R + 1.5, F.SHOOT | F.SOLID | F.VIS, (b) => {
      if (b.y1 < y - R - 1 || b.y0 > y + R + 1) return;
      const px = clamp(x, b.x0, b.x1), py = clamp(y, b.y0, b.y1), pz = clamp(z, b.z0, b.z1);
      const d = Math.hypot(px - x, py - y, pz - z);
      if (b.flags & F.BREAK) { if (d < R * 1.3) glass.push(b.i); return; }
      if (b.panel < 0) return;
      const pd = b.i === hitBox ? 0 : d;
      const prev = hitPanels.get(b.panel);
      if (prev === undefined || pd < prev) hitPanels.set(b.panel, pd);
    });
    for (const g of glass) if (breakGlass(W, g)) { this.glass.push(g); this.emit({ e: 'glass', b: g }); }
    const killed = [];
    const blds = new Set();
    for (const [pid, d] of hitPanels) {
      const Pn = W.panels[pid];
      if (!Pn.alive) continue;
      const rr = R + 1.2;
      if (d > rr) continue;
      Pn.hp -= P.panelDamage * (1 - d / rr) * (d < 0.6 ? 1.4 : 1);
      if (Pn.hp <= 0) { if (destroyPanel(W, pid)) { killed.push(pid); if (Pn.bld >= 0) blds.add(Pn.bld); } }
    }
    if (killed.length) {
      this.destroyed.push(...killed);
      this.emit({ e: 'panels', l: killed, x: +x.toFixed(1), y: +y.toFixed(1), z: +z.toFixed(1) });
    }
    for (const bi of blds) this.checkCollapse(bi, owner);
  }

  crushPanel(pid, t) {
    const W = this.W;
    if (!destroyPanel(W, pid)) return;
    this.destroyed.push(pid);
    const P = W.panels[pid];
    this.emit({ e: 'panels', l: [pid], x: +t.x.toFixed(1), y: +(t.y + 1).toFixed(1), z: +t.z.toFixed(1), crush: 1 });
    if (P.bld >= 0) this.checkCollapse(P.bld, this.players.get(t.driver) || null);
  }
  checkCollapse(bi, owner) {
    const W = this.W;
    if (!shouldCollapse(W, bi)) return;
    if (!collapseBuilding(W, bi)) return;
    const B = W.buildings[bi];
    this.collapsed.push(bi);
    this.emit({ e: 'collapse', b: bi });
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      const b = q.body;
      if (b.x > B.x0 - 0.5 && b.x < B.x1 + 0.5 && b.z > B.z0 - 0.5 && b.z < B.z1 + 0.5 && b.y < B.top + 2) {
        if (q.veh >= 0) continue;
        this.damage(q, 500, owner && owner.team !== q.team ? owner : null, 'collapse', { expl: true });
        if (q.alive && !q.downed) { // friendly/self: still crushed
          this.kill(q, null, 'collapse', false, true);
        } else if (q.downed) this.finishDown(q);
        if (q.alive === false) continue;
        // push out survivors to top of rubble
        b.y = B.by + 3.5;
      }
    }
    refreshNavArea(W, B.x0 - 2, B.z0 - 2, B.x1 + 2, B.z1 + 2);
  }

  // ------------------------------------------------------------ flags & tickets
  stepFlags(dt) {
    let own = [0, 0, 0];
    for (const f of this.flags) {
      const n = [0, 0, 0];
      for (const p of this.players.values()) {
        if (!p.alive || p.downed) continue;
        const b = p.body;
        if (Math.abs(b.y - f.y) > 16) continue;
        if ((b.x - f.x) ** 2 + (b.z - f.z) ** 2 < f.r * f.r) n[p.team]++;
      }
      f._enemies = [0, n[2], n[1]];
      f._n = n;
      const diff = n[1] - n[2];
      const prevOwner = f.owner;
      if (diff !== 0) {
        const rate = Math.min(4, Math.abs(diff)) * 0.065 + 0.02;
        const s = Math.sign(diff);
        const before = f.prog;
        f.prog = clamp(f.prog + s * rate * dt, -1, 1);
        if (f.owner !== 0 && ((f.owner === 1 && f.prog <= 0) || (f.owner === 2 && f.prog >= 0))) {
          f.owner = 0;
          this.emit({ e: 'flag', f: f.id, o: 0, by: diff > 0 ? 1 : 2, was: prevOwner });
          for (const p of this.players.values()) if (p.alive && !p.downed && p.team === (diff > 0 ? 1 : 2) && (p.body.x - f.x) ** 2 + (p.body.z - f.z) ** 2 < f.r * f.r) this.addScore(p, SCORE.neutralize, 'OBJECTIVE NEUTRALIZED');
        }
        if (f.owner === 0 && Math.abs(f.prog) >= 1) {
          f.owner = f.prog > 0 ? 1 : 2;
          this.emit({ e: 'flag', f: f.id, o: f.owner, was: prevOwner });
          for (const p of this.players.values()) if (p.alive && !p.downed && p.team === f.owner && (p.body.x - f.x) ** 2 + (p.body.z - f.z) ** 2 < f.r * f.r) { this.addScore(p, SCORE.capture, 'OBJECTIVE CAPTURED'); p.caps++; }
        }
        if (Math.floor(before * 5) !== Math.floor(f.prog * 5)) {
          for (const p of this.players.values()) if (p.alive && !p.downed && p.team === (diff > 0 ? 1 : 2) && (p.body.x - f.x) ** 2 + (p.body.z - f.z) ** 2 < f.r * f.r) p.score += SCORE.captureTick;
        }
      } else if (n[1] + n[2] === 0) {
        const target = f.owner === 1 ? 1 : f.owner === 2 ? -1 : 0;
        f.prog += clamp(target - f.prog, -0.03 * dt, 0.03 * dt);
      }
      own[f.owner]++;
    }
    this.owned = own;
    for (const team of [1, 2]) {
      const other = team === 1 ? 2 : 1;
      if (own[other] > own[team] && own[other] >= 3) {
        const mult = own[other] === 5 ? 2.5 : own[other] === 4 ? 1.6 : 1;
        this.bleedAcc[team] += dt * mult;
        if (this.bleedAcc[team] >= RULES.bleedInterval) { this.bleedAcc[team] = 0; this.tickets[team] = Math.max(0, this.tickets[team] - 1); }
      }
    }
    if (this.phase === 'play' && (this.tickets[1] <= 0 || this.tickets[2] <= 0)) {
      this.phase = 'end';
      this.winner = this.tickets[1] > this.tickets[2] ? 1 : 2;
      this.endAt = this.time + RULES.roundEndDelay;
      this.emit({ e: 'end', w: this.winner });
      this.rosterDirty = true;
    }
  }

  stepEnts(dt) {
    this.ents = this.ents.filter((e) => {
      if (e.until <= this.time) { this.emit({ e: 'entgone', id: e.id }); return false; }
      if (e.ty === 'crate') {
        e.tick += dt;
        if (e.tick >= 1) {
          e.tick = 0;
          const owner = this.players.get(e.owner);
          for (const p of this.players.values()) {
            if (!p.alive || p.downed || p.team !== e.team || p.veh >= 0) continue;
            if (Math.hypot(p.body.x - e.x, p.body.z - e.z) > 5.5) continue;
            let gave = false;
            if (p.hp < 100) { p.hp = Math.min(100, p.hp + 9); gave = true; if (owner && owner !== p && this.rng() < 0.25) this.addScore(owner, SCORE.heal, 'HEAL'); }
            for (const wid in p.ammo) {
              const w = WEAPONS[wid], a = p.ammo[wid];
              const cap = w.reserve; if (a[1] < cap) { a[1] = Math.min(cap, a[1] + Math.ceil(w.mag * (w.gadget ? 1 : 0.34))); gave = true; }
            }
            const C = CLASSES[p.cls];
            if (p.grenades < C.grenades && this.rng() < 0.12) { p.grenades++; gave = true; }
            if (gave) {
              this.emit({ e: 'supply', to: p.id, hp: p.hp, ammo: p.ammo, g: p.grenades });
              if (owner && owner !== p && this.rng() < 0.2) this.addScore(owner, SCORE.resupply, 'RESUPPLY');
            }
          }
        }
      }
      return true;
    });
  }

  // ------------------------------------------------------------ main tick
  tick(dt = TICK_DT) {
    this.time += dt;
    this.tickN++;
    this.pathBudget = 2;
    if (this.tickN === 1 && this.players.size === 0) this.balanceBots();
    if (this.phase === 'end' && this.time >= this.endAt) this.resetRound();

    for (const p of this.players.values()) {
      if (p.alive) {
        if (p.bot) this.botThink(p, dt);
        const b = p.body;
        p.hist.push([this.time, b.x, b.y, b.z, p.crouch ? 1 : 0]);
        if (p.hist.length > 14) p.hist.shift();
        if (p.downed && this.time >= p.bleedAt) this.finishDown(p);
        // out of bounds
        if (b.x < BOUNDS.minX || b.x > BOUNDS.maxX || b.z < BOUNDS.minZ || b.z > BOUNDS.maxZ) {
          p.oobT += dt;
          if (p.oobT > RULES.outOfBoundsTime + 1) this.kill(p, null, 'oob', false, true);
        } else p.oobT = 0;
        if (b.y < -20) this.kill(p, null, 'fall', false, true);
        if (!p.bot && p.alive && this.time - p.inT > 20) { /* idle */ }
      } else if (p.bot && this.phase === 'play' && this.time >= p.respawnAt) {
        this.botSpawn(p);
      }
    }
    // vehicles
    for (const t of this.vehicles) {
      if (!t.alive) {
        if (this.time >= t.respawnAt && this.phase === 'play') {
          const h = this.W.hq[t.team].tank;
          Object.assign(t, makeTank(t.id, t.team, h.x, heightAt(this.W, h.x, h.z), h.z, h.yaw));
          this.emit({ e: 'vspawn', v: t.id });
        }
        continue;
      }
      const d = t.driver >= 0 ? this.players.get(t.driver) : null;
      if (t.driver >= 0 && (!d || !d.alive || d.veh !== t.id)) t.driver = -1;
      if (d && d.bot) this.botTank(d, t, dt);
      else if (!d) stepTank(this.W, t, { throttle: 0, steer: 0 }, dt);
      if (Math.abs(t.speed) > 2.2) this.crushCheck(t);
      // run over infantry
      if (Math.abs(t.speed) > 3) for (const q of this.players.values()) {
        if (!q.alive || q.veh >= 0 || q.team === t.team) continue;
        if (Math.hypot(q.body.x - t.x, q.body.z - t.z) < 2.6 && Math.abs(q.body.y - t.y) < 2) this.damage(q, 200, d, 'roadkill', { expl: true });
      }
    }
    this.stepBullets(dt);
    this.stepProjs(dt);
    if (this.phase === 'play') this.stepFlags(dt);
    this.stepEnts(dt);

    // pings
    for (const c of this.clients.values()) {
      if (this.time - c.pingT > 2) { c.pingT = this.time; c.send({ t: 'ping', s: this.time }); }
    }
    this.rosterT += dt;
    if (this.rosterT > 1.0 || this.rosterDirty) { this.rosterT = 0; this.sendRoster(); }
    this.broadcast();
  }

  crushCheck(t) {
    const W = this.W;
    const fx = -Math.sin(t.yaw), fz = -Math.cos(t.yaw);
    const cx = t.x + fx * 2.6 * Math.sign(t.speed), cz = t.z + fz * 2.6 * Math.sign(t.speed);
    const R = 2.3;
    const hits = [];
    queryBoxes(W, cx - R, cz - R, cx + R, cz + R, F.SOLID, (b) => {
      if (b.panel < 0 || b.y1 <= t.y + 1.0 || b.y0 >= t.y + 2.8) return;
      const px = clamp(cx, b.x0, b.x1), pz = clamp(cz, b.z0, b.z1);
      if (Math.hypot(px - cx, pz - cz) < R && W.panels[b.panel].maxHp < 400) hits.push(b.panel);
    });
    for (const pid of hits) this.crushPanel(pid, t);
  }

  sendRoster(force) {
    if (!force && !this.rosterDirty && this.rosterT > 0) return;
    this.rosterDirty = false;
    const l = [];
    for (const p of this.players.values()) {
      const c = p.cid >= 0 ? this.clients.get(p.cid) : null;
      l.push([p.id, p.name, p.team, p.squad, p.bot ? 1 : 0, p.cls, p.score, p.kills, p.deaths, p.assists, c ? Math.round(c.rtt * 1000) : 0, p.revives]);
    }
    const msg = { t: 'roster', l, ph: this.phase, w: this.winner, endIn: this.phase === 'end' ? Math.max(0, this.endAt - this.time) : 0 };
    for (const c of this.clients.values()) c.send(msg);
  }

  broadcast() {
    const P = [];
    for (const p of this.players.values()) {
      const b = p.body;
      let fl = 0;
      if (p.alive) fl |= 1; if (p.downed) fl |= 2; if (p.crouch) fl |= 4; if (p.sprint) fl |= 8; if (p.ads) fl |= 16;
      if (p.spottedUntil > this.time) fl |= 32; if (b.onGround) fl |= 64; if (p.reloading) fl |= 128; if (this.time - p.firingT < 0.3) fl |= 256;
      if (p.protUntil > this.time) fl |= 512;
      P.push([p.id, Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.z * 100), Math.round(p.yaw * 1000), Math.round(p.pitch * 1000), fl, Math.max(0, Math.round(p.hp)), p.slot, p.veh, CLASS_LIST.indexOf(p.cls),
        Math.round(Math.hypot(b.vx, b.vz) * 10), p.downed ? Math.max(0, Math.round((p.bleedAt - this.time) * 10)) : p.alive ? 0 : Math.max(0, Math.round((p.respawnAt - this.time) * 10))]);
    }
    const V = this.vehicles.map((t) => [t.id, Math.round(t.x * 100), Math.round(t.y * 100), Math.round(t.z * 100), Math.round(t.yaw * 1000), Math.round(t.pitch * 1000), Math.round(t.roll * 1000), Math.round(t.turretYaw * 1000), Math.round(t.gunPitch * 1000), Math.round(t.hp), t.driver, Math.round(t.speed * 100), t.alive ? 1 : 0, Math.round(t.reload * 10), t.team]);
    const PR = this.projs.map((p) => [p.id, PROJ_TYPES.indexOf(p.ty), Math.round(p.x * 100), Math.round(p.y * 100), Math.round(p.z * 100)]);
    const EN = this.ents.map((e) => [e.id, e.ty === 'crate' ? 0 : 1, Math.round(e.x * 100), Math.round(e.y * 100), Math.round(e.z * 100), e.team, e.squad, e.owner]);
    const FL = this.flags.map((f) => [Math.round(f.prog * 1000), f.owner, f._n ? f._n[1] : 0, f._n ? f._n[2] : 0]);
    const ev = this.events;
    this.events = [];
    for (const c of this.clients.values()) {
      const me = this.players.get(c.pid);
      const evs = ev.filter((e) => e.to === undefined || e.to === c.pid);
      const self = me ? { hp: Math.max(0, Math.round(me.hp)), g: me.grenades, oob: +me.oobT.toFixed(1), gt: Math.max(0, +(CLASSES[me.cls] && WEAPONS[CLASSES[me.cls].gadget].cooldown ? (WEAPONS[CLASSES[me.cls].gadget].cooldown - (this.time - me.gadgetT)) : 0).toFixed(1)) } : null;
      c.send({ t: 's', st: +this.time.toFixed(3), p: P, v: V, pr: PR, en: EN, f: FL, tk: [this.tickets[1], this.tickets[2]], ev: evs, me: self, so: me && !me.alive ? this.spawnOptions(me) : null });
    }
  }

  // ------------------------------------------------------------ bots
  newBrain(p) {
    return {
      goal: null, goalT: 0, path: null, pi: 0, tgt: -1, tgtVeh: -1, react: 0, err: 0.1, errSeed: this.rng() * 100, nextShot: 0, burst: 0,
      strafe: this.rng() < 0.5 ? -1 : 1, strafeT: 0, crouchT: 0, stuckT: 0, lpx: p.body.x, lpz: p.body.z, perceiveT: 0, seenT: -10,
      lastSeen: null, nadeT: this.time + 8 + this.rng() * 20, mag: WEAPONS[CLASSES[p.cls].primary].mag, reloadT: 0, wanderT: 0, wander: null,
      reviveId: -1, reviveT: 0, hurtBy: -1, hurtT: -10, gadgetT: this.time + 5 + this.rng() * 10, jumpT: 0, unstuck: 0, aimY: p.yaw, aimP: 0,
      tankGoalT: 0, deployT: this.time + 20 + this.rng() * 40, skill: clamp(this.botSkill + (this.rng() - 0.5) * 0.35, 0.15, 1),
    };
  }
  botSpawn(p) {
    const opts = this.spawnOptions(p);
    let at = 'hq';
    const tankOpt = opts.includes('tank');
    if (tankOpt && this.rng() < 0.45) at = 'tank';
    else {
      // prefer flags near the front
      const flagOpts = opts.filter((o) => o.length === 1);
      const enemyHQ = this.W.hq[p.team === 1 ? 2 : 1];
      if (flagOpts.length && this.rng() < 0.85) {
        flagOpts.sort((a, b) => { const fa = this.flags.find((f) => f.id === a), fb = this.flags.find((f) => f.id === b); return Math.hypot(fa.x - enemyHQ.x, fa.z - enemyHQ.z) - Math.hypot(fb.x - enemyHQ.x, fb.z - enemyHQ.z); });
        at = flagOpts[this.rng() < 0.7 ? 0 : (this.rng() * flagOpts.length) | 0];
      }
      const sq = opts.filter((o) => o.startsWith('sq:'));
      if (sq.length && this.rng() < 0.25) {
        const q = this.players.get(+sq[0].slice(3));
        if (q && isFree(this.W, q.body.x, q.body.z) && Math.abs(q.body.y - heightAt(this.W, q.body.x, q.body.z)) < 1) at = sq[0];
      }
    }
    if (this.rng() < 0.3) p.cls = CLASS_LIST[(this.rng() * 4) | 0];
    this.trySpawn(p, at, p.cls);
  }

  pickGoal(p) {
    const br = p.brain;
    const counts = {};
    for (const q of this.players.values()) if (q.bot && q.team === p.team && q.brain && q.brain.goal) counts[q.brain.goal.id] = (counts[q.brain.goal.id] || 0) + 1;
    let best = null, bs = 1e9;
    for (const f of this.flags) {
      const d = Math.hypot(f.x - p.body.x, f.z - p.body.z);
      let s = d / 90;
      if (f.owner !== p.team) s -= 2.4;
      else if (f._enemies && f._enemies[p.team] > 0) s -= 2.0;
      else s += 0.8;
      if (f.owner !== p.team && f.owner !== 0) s -= 0.2;
      s += (counts[f.id] || 0) * 0.32 + this.rng() * 1.3;
      if (s < bs) { bs = s; best = f; }
    }
    br.goal = best; br.goalT = this.time + 8 + this.rng() * 10; br.path = null; br.wander = null;
  }

  requestPath(p, x, z) {
    const br = p.brain;
    if (this.pathBudget <= 0) return false;
    this.pathBudget--;
    br.path = findPath(this.W, p.body.x, p.body.z, x, z, 14000) || [[x, z]];
    br.pi = 0;
    return true;
  }

  perceive(p) {
    const br = p.brain;
    const W = this.W;
    const ex = p.body.x, ey = this.eye(p), ez = p.body.z;
    const f = fwd(p.yaw, 0);
    let best = null, bd = 1e9, bestVeh = null;
    const maxR = p.cls === 'recon' ? 230 : 150;
    for (const q of this.players.values()) {
      if (q.team === p.team || !q.alive || q.downed) continue;
      let tx, ty, tz;
      if (q.veh >= 0) { const t = this.vehicles[q.veh]; if (!t) continue; tx = t.x; ty = t.y + 1.6; tz = t.z; }
      else { tx = q.body.x; ty = q.body.y + (q.crouch ? 0.8 : 1.3); tz = q.body.z; }
      const dx = tx - ex, dz = tz - ez, d = Math.hypot(dx, dz);
      if (d > maxR) continue;
      const recentlyHurt = br.hurtBy === q.id && this.time - br.hurtT < 2.5;
      const dot = (dx * f[0] + dz * f[2]) / (d || 1);
      if (d > 10 && dot < 0.3 && !recentlyHurt && !(q.spottedUntil > this.time && dot > -0.2)) continue;
      // concealment: crouched + far is harder
      if (q.crouch && d > 90 && this.rng() < 0.5) continue;
      let score = d;
      if (q.veh >= 0) score *= (p.cls === 'engineer' ? 0.5 : 2.2);
      if (recentlyHurt) score *= 0.4;
      if (q.id === br.tgt) score *= 0.7;
      if (score >= bd) continue;
      if (!los(W, ex, ey, ez, tx, ty, tz)) continue;
      bd = score; best = q;
    }
    if (best) {
      if (best.id !== br.tgt) {
        br.tgt = best.id;
        br.react = this.time + (0.3 + this.rng() * 0.45) * (1.6 - br.skill) + (best.veh >= 0 ? 0.3 : 0);
        br.err = 0.11 * (1.5 - br.skill) + 0.04;
        br.burst = 0;
        if (this.rng() < 0.25) best.spottedUntil = Math.max(best.spottedUntil, this.time + RULES.spotTime);
      }
      br.seenT = this.time;
      br.lastSeen = [best.body.x, best.body.y, best.body.z];
      void bestVeh;
    } else if (this.time - br.seenT > 1.0) {
      br.tgt = -1;
    }
  }

  botThink(p, dt) {
    const br = p.brain;
    const W = this.W;
    const b = p.body;
    if (p.downed) { b.vx = b.vz = 0; return; }
    if (p.veh >= 0) return; // tank handled separately
    if (this.time >= br.perceiveT) { br.perceiveT = this.time + 0.22 + this.rng() * 0.1; this.perceive(p); }
    const w = WEAPONS[CLASSES[p.cls].primary];
    let tgt = br.tgt >= 0 ? this.players.get(br.tgt) : null;
    if (tgt && (!tgt.alive || tgt.downed)) { tgt = null; br.tgt = -1; }
    const engaged = tgt && this.time - br.seenT < 0.6;

    // goals
    if (!br.goal || this.time > br.goalT) this.pickGoal(p);
    // revive nearby teammates
    if (!engaged && br.reviveId < 0 && this.rng() < 0.05) {
      for (const q of this.players.values()) {
        if (q.team === p.team && q.alive && q.downed && Math.hypot(q.body.x - b.x, q.body.z - b.z) < 22 && q.bleedAt - this.time > 3) { br.reviveId = q.id; br.path = null; break; }
      }
    }
    let mvx = 0, mvz = 0, speed = MOVE.walk, lookYaw = null;
    const rv = br.reviveId >= 0 ? this.players.get(br.reviveId) : null;
    if (rv && (!rv.alive || !rv.downed)) br.reviveId = -1;

    let dest = null;
    if (rv && br.reviveId >= 0 && !engaged) {
      const d = Math.hypot(rv.body.x - b.x, rv.body.z - b.z);
      if (d < 1.7) {
        br.reviveT += dt; p.crouch = true;
        if (br.reviveT > 1.6) { this.revive(rv, p); br.reviveId = -1; br.reviveT = 0; }
      } else { dest = [rv.body.x, rv.body.z]; br.reviveT = 0; }
    } else if (br.goal) {
      const f = br.goal;
      const inFlag = (b.x - f.x) ** 2 + (b.z - f.z) ** 2 < (f.r * 0.85) ** 2;
      if (inFlag) {
        if (!br.wander || this.time > br.wanderT) {
          const a = this.rng() * Math.PI * 2, r = this.rng() * f.r * 0.7;
          const wx = f.x + Math.cos(a) * r, wz = f.z + Math.sin(a) * r;
          if (isFree(W, wx, wz)) { br.wander = [wx, wz]; br.path = null; }
          br.wanderT = this.time + 3 + this.rng() * 4;
        }
        dest = br.wander;
        if (f.owner === p.team && !(f._enemies && f._enemies[p.team] > 0) && this.time > br.goalT - 2) br.goalT = Math.min(br.goalT, this.time + 1);
      } else dest = [f.x + (br.errSeed % 7 - 3.5), f.z + (br.errSeed % 5 - 2.5)];
    }

    // path following
    if (dest) {
      if (!br.path || br.pathDest == null || Math.hypot(br.pathDest[0] - dest[0], br.pathDest[1] - dest[1]) > 4) {
        if (this.requestPath(p, dest[0], dest[1])) br.pathDest = dest;
      }
      if (br.path && br.pi < br.path.length) {
        const wp = br.path[br.pi];
        const dx = wp[0] - b.x, dz = wp[1] - b.z, d = Math.hypot(dx, dz);
        if (d < 1.3) br.pi++;
        else { mvx = dx / d; mvz = dz / d; }
        if (br.pi >= br.path.length) { br.path = null; }
      }
    }
    const remaining = br.path ? br.path.length - br.pi : 0;
    p.sprint = !engaged && remaining > 2 && !p.crouch;
    if (p.sprint) speed = MOVE.sprint;
    if (mvx || mvz) lookYaw = yawTo(mvx, mvz);

    // combat
    if (tgt && this.time >= br.react) {
      let tx, ty, tz;
      if (tgt.veh >= 0) { const t = this.vehicles[tgt.veh]; tx = t.x; ty = t.y + 1.4; tz = t.z; }
      else {
        const lead = 0.12 * br.skill;
        tx = tgt.body.x + tgt.body.vx * lead; tz = tgt.body.z + tgt.body.vz * lead;
        ty = tgt.body.y + (tgt.crouch ? 0.85 : (this.rng() < 0.15 * br.skill ? 1.6 : 1.3));
      }
      const ex = b.x, ey = this.eye(p), ez = b.z;
      const dx = tx - ex, dy = ty - ey, dz = tz - ez, dh = Math.hypot(dx, dz);
      const dist = Math.hypot(dh, dy);
      br.err = Math.max(0.006 + (1 - br.skill) * 0.02, br.err - dt * 0.05 * (0.5 + br.skill));
      const wob = br.err * (Math.sin(this.time * 2.3 + br.errSeed) + 0.6 * Math.sin(this.time * 5.1 + br.errSeed * 2));
      let wantY = yawTo(dx, dz) + wob;
      let wantP = Math.atan2(dy, dh) + wob * 0.6 + (w.id === 'sr338' ? (GRAVITY * dist / (w.vel * w.vel)) * 0.5 : 0);
      const turn = 5.5 * dt;
      p.yaw = wrapAngle(p.yaw + clamp(wrapAngle(wantY - p.yaw), -turn, turn));
      p.pitch += clamp(wantP - p.pitch, -turn, turn);
      lookYaw = null;
      const aligned = Math.abs(wrapAngle(wantY - p.yaw)) < 0.06 + br.err;
      // combat movement: strafe
      if (engaged) {
        if (this.time > br.strafeT) { br.strafe = this.rng() < 0.5 ? -1 : 1; br.strafeT = this.time + 0.6 + this.rng() * 1.4; if (this.rng() < 0.25 && dist > 20) br.crouchT = this.time + 1.5 + this.rng() * 2; }
        const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
        const adv = dist > (w.id === 'rx9' ? 18 : w.id === 'sr338' ? 90 : 38) ? 0.7 : dist < 7 ? -0.6 : 0;
        if (w.id === 'sr338' && dist > 40) { mvx = 0; mvz = 0; p.crouch = true; }
        else { mvx = rx * br.strafe * 0.8 + fx * adv + mvx * 0.25; mvz = rz * br.strafe * 0.8 + fz * adv + mvz * 0.25; }
        const l = Math.hypot(mvx, mvz) || 1; mvx /= l; mvz /= l;
        speed = MOVE.walk * 0.85;
        p.sprint = false;
        p.ads = dist > 15;
      }
      p.crouch = this.time < br.crouchT || (w.id === 'sr338' && dist > 40);
      // reload
      if (br.reloadT > 0) {
        p.reloading = true;
        if (this.time >= br.reloadT) { br.reloadT = 0; br.mag = w.mag; p.reloading = false; }
      } else if (aligned && engaged && this.time >= br.nextShot && dist < (w.id === 'sr338' ? 260 : w.id === 'rx9' ? 70 : 140)) {
        // gadgets
        if (tgt.veh >= 0 && p.cls === 'engineer' && this.time > br.gadgetT && dist < 140) {
          br.gadgetT = this.time + 4.5;
          const d = fwd(p.yaw, p.pitch + 0.004 * dist * 0.1);
          this.spawnProj(p, 'rocket', [ex, ey - 0.1, ez], d);
          br.nextShot = this.time + 1.2;
        } else if (p.cls === 'assault' && this.time > br.gadgetT && dist > 18 && dist < 60 && this.rng() < 0.15) {
          br.gadgetT = this.time + 12 + this.rng() * 10;
          const loft = 0.5 * Math.asin(clamp(GRAVITY * dh / (72 * 72), -1, 1));
          this.spawnProj(p, 'gl', [ex, ey - 0.1, ez], fwd(p.yaw, Math.atan2(dy, dh) + loft));
          br.nextShot = this.time + 0.8;
        } else if (tgt.veh < 0) {
          // shoot bullet
          const spreadDeg = (p.ads ? w.adsSpread + 0.2 : w.hip * 0.45) * (1.4 - br.skill * 0.6);
          const sr = spreadDeg * Math.PI / 180;
          const d = fwd(p.yaw + (this.rng() - 0.5) * sr * 2, p.pitch + (this.rng() - 0.5) * sr * 2);
          this.spawnBullet(p, w, [ex, ey, ez], d, this.time);
          this.emit({ e: 'shot', id: p.id, w: w.id, o: [+ex.toFixed(2), +ey.toFixed(2), +ez.toFixed(2)], d: d.map((v) => +v.toFixed(4)) });
          p.firingT = this.time;
          p.pitch += (w.recoil[0] * Math.PI / 180) * 0.4;
          br.mag--;
          if (br.mag <= 0) br.reloadT = this.time + w.reload * (1.1 + this.rng() * 0.3);
          const iv = 60 / w.rpm;
          if (w.auto) {
            br.burst++;
            const maxBurst = dist < 20 ? 8 : dist < 50 ? 5 : 3;
            if (br.burst >= maxBurst) { br.burst = 0; br.nextShot = this.time + 0.2 + this.rng() * 0.5 + dist * 0.004; }
            else br.nextShot = this.time + iv;
          } else br.nextShot = this.time + Math.max(iv, w.bolt ? 1.4 + this.rng() * 1.2 : 0.25 + this.rng() * 0.3);
        } else br.nextShot = this.time + 0.5;
      }
      // grenade
      if (engaged && tgt.veh < 0 && p.grenades > 0 && this.time > br.nadeT && dist > 10 && dist < 32) {
        br.nadeT = this.time + 15 + this.rng() * 20;
        if (this.rng() < 0.55) {
          p.grenades--;
          const v = 17, g = GRAVITY;
          const s = clamp(g * dh / (v * v), 0, 0.99);
          const ang = 0.5 * Math.asin(s) + Math.atan2(dy, dh) * 0.5;
          this.spawnProj(p, 'frag', [ex, ey, ez], fwd(yawTo(dx, dz), clamp(ang, 0.1, 1.1)), this.rng() * 0.8);
        }
      }
    } else {
      p.ads = false;
      if (br.reloadT === 0 && br.mag < w.mag * 0.5 && !tgt) br.reloadT = this.time + w.reload;
      if (br.reloadT > 0 && this.time >= br.reloadT) { br.reloadT = 0; br.mag = w.mag; }
      p.reloading = br.reloadT > 0;
      if (lookYaw == null && br.lastSeen && this.time - br.seenT < 4) lookYaw = yawTo(br.lastSeen[0] - b.x, br.lastSeen[2] - b.z);
      if (lookYaw != null) { const turn = 3.2 * dt; p.yaw = wrapAngle(p.yaw + clamp(wrapAngle(lookYaw - p.yaw), -turn, turn)); }
      p.pitch *= 0.9;
      if (this.time > br.crouchT) p.crouch = br.reviveT > 0;
      // support drops crate at flags
      if (p.cls === 'support' && this.time > br.deployT && br.goal && Math.hypot(br.goal.x - b.x, br.goal.z - b.z) < br.goal.r) {
        br.deployT = this.time + 40 + this.rng() * 30;
        if (this.time - p.gadgetT > WEAPONS.supply.cooldown) this.deploy(p, { x: b.x, y: b.y, z: b.z });
      }
    }

    // stuck detection
    if (mvx || mvz) {
      br.stuckT += dt;
      if (br.stuckT > 1.2) {
        const moved = Math.hypot(b.x - br.lpx, b.z - br.lpz);
        if (moved < 0.6) {
          br.unstuck++;
          br.jumpT = this.time + 0.1;
          if (br.unstuck > 2) { br.path = null; br.unstuck = 0; br.wander = null; br.pathDest = null; }
          br.sidestep = this.time + 0.8; br.sideDir = this.rng() < 0.5 ? -1 : 1;
        } else br.unstuck = 0;
        br.lpx = b.x; br.lpz = b.z; br.stuckT = 0;
      }
    }
    if (br.sidestep && this.time < br.sidestep) {
      const rx = -mvz * br.sideDir, rz = mvx * br.sideDir;
      mvx = mvx * 0.3 + rx; mvz = mvz * 0.3 + rz;
    }
    if (p.crouch) speed = Math.min(speed, MOVE.crouch);
    b.crouch = p.crouch;
    const jump = this.time < br.jumpT;
    if (jump) br.jumpT = 0;
    stepBody(W, b, mvx * speed, mvz * speed, jump && b.onGround, dt);
  }

  botTank(p, t, dt) {
    const br = p.brain;
    const W = this.W;
    if (this.time >= br.perceiveT) {
      br.perceiveT = this.time + 0.35;
      // target: vehicles first, then infantry
      let best = null, bd = 1e9;
      for (const q of this.players.values()) {
        if (q.team === p.team || !q.alive || q.downed) continue;
        let tx, ty, tz;
        if (q.veh >= 0) { const v = this.vehicles[q.veh]; tx = v.x; ty = v.y + 1.5; tz = v.z; } else { tx = q.body.x; ty = q.body.y + 1.0; tz = q.body.z; }
        const d = Math.hypot(tx - t.x, tz - t.z) * (q.veh >= 0 ? 0.4 : 1);
        if (d > 170 || d >= bd) continue;
        if (!los(W, t.x, t.y + 2.6, t.z, tx, ty, tz)) continue;
        bd = d; best = q;
      }
      if (best && best.id !== br.tgt) { br.react = this.time + 0.8 + this.rng() * 0.8; }
      br.tgt = best ? best.id : -1;
    }
    if (!br.goal || this.time > br.goalT) this.pickGoal(p);
    let throttle = 0, steer = 0;
    const tgt = br.tgt >= 0 ? this.players.get(br.tgt) : null;
    let aimYaw = t.yaw, aimPitch = 0;
    if (br.goal) {
      const f = br.goal;
      const dd = Math.hypot(f.x - t.x, f.z - t.z);
      if (dd > f.r * 0.6) {
        if (!br.path || this.time > br.tankGoalT) { if (this.requestPath(p, f.x, f.z)) br.tankGoalT = this.time + 6; }
        if (br.path && br.pi < br.path.length) {
          const wp = br.path[br.pi];
          const dx = wp[0] - t.x, dz = wp[1] - t.z, d = Math.hypot(dx, dz);
          if (d < 4) br.pi++;
          const want = yawTo(dx, dz);
          const da = wrapAngle(want - t.yaw);
          steer = clamp(da * 2, -1, 1);
          throttle = Math.abs(da) > 1.0 ? 0.15 : tgt ? 0.45 : 0.85;
        }
      }
    }
    // stuck: reverse a bit
    br.stuckT += dt;
    if (br.stuckT > 2) {
      if (Math.hypot(t.x - br.lpx, t.z - br.lpz) < 1 && throttle > 0.1) { br.reverseT = this.time + 1.6; br.path = null; }
      br.lpx = t.x; br.lpz = t.z; br.stuckT = 0;
    }
    if (br.reverseT && this.time < br.reverseT) { throttle = -0.8; steer = 0.6; }
    if (tgt) {
      let tx, ty, tz;
      if (tgt.veh >= 0) { const v = this.vehicles[tgt.veh]; tx = v.x; ty = v.y + 1.2; tz = v.z; } else { tx = tgt.body.x; ty = tgt.body.y + 0.9; tz = tgt.body.z; }
      const dx = tx - t.x, dy = ty - (t.y + 2.45), dz = tz - t.z, dh = Math.hypot(dx, dz);
      aimYaw = yawTo(dx, dz) + (this.rng() - 0.5) * 0.01;
      aimPitch = Math.atan2(dy, dh) + (PROJECTILES.shell.gravity * dh / (PROJECTILES.shell.speed ** 2)) * 0.5;
      const mz = tankMuzzle(t);
      const ang = Math.acos(clamp(mz.d[0] * dx / Math.hypot(dx, dy, dz) + mz.d[1] * dy / Math.hypot(dx, dy, dz) + mz.d[2] * dz / Math.hypot(dx, dy, dz), -1, 1));
      if (this.time > br.react && ang < 0.03) {
        if (t.reload <= 0 && (tgt.veh >= 0 || dh > 25 || this.rng() < 0.3)) {
          t.reload = TANK.reload * 1.15;
          this.spawnProj(p, 'shell', mz.o, mz.d);
          this.emit({ e: 'tshot', v: t.id });
        } else if (tgt.veh < 0 && dh < 90 && this.time - (p.lastFire.tmg || -1) > 60 / TANK.mgRpm) {
          p.lastFire.tmg = this.time;
          const mg = tankMg(t);
          const sr = 0.012;
          const d = [mg.d[0] + (this.rng() - 0.5) * sr, mg.d[1] + (this.rng() - 0.5) * sr, mg.d[2] + (this.rng() - 0.5) * sr];
          const l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l;
          this.spawnBullet(p, MG_WEAPON, mg.o, d, this.time, true);
          if (this.tickN % 2 === 0) this.emit({ e: 'shot', id: p.id, w: 'tmg', o: mg.o.map((v) => +v.toFixed(2)), d: d.map((v) => +v.toFixed(4)) });
        }
      }
    } else aimYaw = t.yaw;
    stepTank(W, t, { throttle, steer, aimYaw, aimPitch }, dt);
    p.body.x = t.x; p.body.y = t.y + 1; p.body.z = t.z;
    p.yaw = t.turretYaw;
  }
}

export const MG_WEAPON = { id: 'tmg', dmg: [22, 15], range: [20, 90], vel: 820, drag: 0.02, head: 1.6, limb: 0.9 };

function c_tp(sim, p) {
  // teleport correction: tell client where it really is
  sim.emit({ e: 'tp', to: p.id, x: p.body.x, y: p.body.y, z: p.body.z });
}
