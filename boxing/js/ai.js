import { MOVES } from './moves.js';

const LEVELS = [
  { name: 'AMATEUR',  react: 0.3,  defend: 0.32, counter: 0.3, aggr: 0.45, combo: 2, think: 0.32, dmg: 0.85, shell: 0.15 },
  { name: 'PRO',      react: 0.2,  defend: 0.56, counter: 0.55, aggr: 0.62, combo: 3, think: 0.2,  dmg: 1.0,  shell: 0.3 },
  { name: 'CHAMPION', react: 0.14, defend: 0.74, counter: 0.78, aggr: 0.75, combo: 4, think: 0.12, dmg: 1.12, shell: 0.45 },
];
export const AI_LEVELS = LEVELS;

const COMBOS = [
  { m: ['jab'], w: 3 }, { m: ['jab', 'cross'], w: 4 }, { m: ['jab', 'jab', 'cross'], w: 2 }, { m: ['jab', 'cross', 'hook'], w: 3 },
  { m: ['cross', 'hook', 'cross'], w: 1.5 }, { m: ['jab', 'cross', 'lowkick'], w: 2 }, { m: ['hook_b', 'hook'], w: 1.5 },
  { m: ['jab', 'uppercut', 'hook'], w: 1.5 }, { m: ['lowkick'], w: 2 }, { m: ['bodykick'], w: 1.5 }, { m: ['jab', 'bodykick'], w: 1.5 },
  { m: ['teep'], w: 1 }, { m: ['cross', 'highkick'], w: 0.6 }, { m: ['jab', 'cross', 'hook', 'lowkick'], w: 1 },
  { m: ['jab_b', 'cross'], w: 1.2 }, { m: ['uppercut', 'hook'], w: 1 }, { m: ['jab', 'highkick'], w: 0.5 },
];

export class AIController {
  constructor(me, opp, level = 1) {
    this.me = me; this.opp = opp; this.L = LEVELS[level];
    this.plan = []; this.cool = 1.2; this.thinkT = 0; this.lat = 1; this.latT = 0;
    this.seenSwing = -1; this.defense = null; this.counterQ = null; this.shellT = 0; this.prefDist = 1.2;
    this.playerHabits = { head: 0, body: 0, kick: 0 };
  }
  pickCombo() {
    const me = this.me, opp = this.opp;
    const maxLen = this.L.combo;
    let list = COMBOS.filter(c => c.m.length <= maxLen);
    // finishers when opponent is hurt
    if (opp.health < 30 || opp.state === 'rocked') list = list.concat([{ m: ['cross', 'hook', 'uppercut'].slice(0, maxLen), w: 4 }, { m: ['highkick'], w: 1.5 }]);
    // opponent turtles -> go to the body / legs
    if (opp.blockW > 0.5) list = list.concat([{ m: ['hook_b', 'bodykick'], w: 3 }, { m: ['lowkick'], w: 3 }]);
    if (me.stamina < 35) list = list.filter(c => c.m.length <= 2 && !c.m.includes('highkick'));
    let tot = list.reduce((a, c) => a + c.w, 0), r = Math.random() * tot;
    for (const c of list) { r -= c.w; if (r <= 0) return c.m.slice(); }
    return ['jab'];
  }
  fire(id, it) {
    const body = id.endsWith('_b');
    it.attack = body ? id.slice(0, -2) : id; it.body = body;
  }
  reachOf(id) { const base = id.endsWith('_b') ? id.slice(0, -2) + '_body' : id; return (MOVES[base] || MOVES.jab).reach; }

  update(dt, game) {
    const me = this.me, opp = this.opp, it = me.intent, L = this.L;
    it.block = false; it.mx = 0; it.my = 0; it.body = false;
    if (me.down || me.victory || !game.fighting) return;
    const dist = me.dist ?? 2;
    this.cool -= dt; this.latT -= dt; this.shellT -= dt;
    if (this.latT <= 0) { this.lat = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.3) this.lat = 0; this.latT = 0.8 + Math.random() * 1.6; }

    // ---- defence: notice new strikes
    if (opp.state === 'attack' && opp.stats.thrown !== this.seenSwing) {
      this.seenSwing = opp.stats.thrown;
      const m = opp.move;
      this.playerHabits[m.kind === 'kick' ? 'kick' : m.target]++;
      const inRange = dist < m.reach + 0.15;
      const hurt = me.health < 35 ? 0.15 : 0;
      if (inRange && Math.random() < L.defend + hurt) {
        let type = 'block';
        if (m.kind === 'punch' && m.target === 'head' && Math.random() < 0.35) type = 'slip';
        if (m.kind === 'kick' && m.id !== 'lowkick' && Math.random() < 0.45) type = 'back';
        this.defense = { type, t: L.react * (0.8 + Math.random() * 0.5), dur: m.total + 0.1, body: m.target === 'body' };
      }
    }
    if (this.defense) {
      const d = this.defense;
      d.t -= dt;
      if (d.t <= 0) {
        if (d.type === 'block') { it.block = true; it.body = d.body; }
        else if (d.type === 'slip' && me.state === 'idle') { it.slip = true; it.mx = Math.random() < 0.5 ? -1 : 1; this.defense = null; }
        else if (d.type === 'back') { it.my = -1; }
        if (d.type !== 'slip') { d.dur -= dt; if (d.dur <= 0) this.defense = null; }
      }
      if (this.defense && d.type === 'block' && d.t <= 0 && opp.state !== 'attack') { d.dur = Math.min(d.dur, 0.08); }
    }
    // ---- counter after a successful defence
    if (this.counterQ && me.state === 'idle' && !it.block) {
      this.plan = this.counterQ; this.counterQ = null; this.cool = 0;
    }

    // ---- movement
    let pref = this.plan.length ? this.reachOf(this.plan[0]) - 0.1 : 1.32;
    if (me.stamina < 25 && !this.plan.length) pref = 1.7;
    if (me.health < 25 && opp.health > 50 && !this.plan.length) pref = 1.6;
    const err = dist - pref;
    if (!it.block || this.defense?.type === 'back') {
      if (this.defense?.type !== 'back') it.my = Math.abs(err) > 0.08 ? Math.max(-1, Math.min(1, err * 3)) : 0;
      it.mx = this.lat * (this.plan.length ? 0.3 : 0.8);
    }
    // pinned near ropes -> circle out
    if (Math.hypot(me.pos.x, me.pos.z) > 2.3) it.mx = this.lat || 1;

    // ---- shell up when the opponent is close and dangerous
    if (!this.plan.length && dist < 1.05 && opp.state === 'idle' && Math.random() < L.shell * dt * 3) this.shellT = 0.3 + Math.random() * 0.5;
    if (this.shellT > 0 && !this.plan.length) it.block = true;

    // ---- offence
    this.thinkT -= dt;
    if (!this.plan.length && this.cool <= 0 && this.thinkT <= 0) {
      this.thinkT = L.think;
      const aggr = L.aggr + (opp.health < 35 ? 0.2 : 0) - (me.stamina < 30 ? 0.3 : 0) + (opp.state === 'attack' && opp.vulnerablePhase ? 0.3 : 0);
      if (Math.random() < aggr) { this.plan = this.pickCombo(); }
    }
    if (this.plan.length && !it.block) {
      const next = this.plan[0];
      const reach = this.reachOf(next);
      const ready = me.state === 'idle' || (me.state === 'attack' && me.moveHit && me.moveT > me.move.startup + me.move.active * 0.5);
      if (dist < reach - 0.02 && ready && me.stamina > 6) {
        this.fire(next, it); this.plan.shift();
        if (!this.plan.length) this.cool = 0.35 + Math.random() * (1.4 - L.aggr);
      } else if (dist > reach + 0.6) {
        // too far, give up for now
        if (Math.random() < dt) { this.plan = []; this.cool = 0.4; }
      }
    }
  }
  // game callbacks
  onDefended(kind) {
    if (Math.random() < this.L.counter) this.counterQ = Math.random() < 0.5 ? ['cross', 'hook'].slice(0, this.L.combo) : (Math.random() < 0.5 ? ['hook'] : ['uppercut', 'hook'].slice(0, this.L.combo));
  }
  onPlayerWhiff() {
    if (Math.random() < this.L.counter * 0.8) this.counterQ = ['cross'];
  }
}
