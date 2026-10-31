import { SHIPS, STRUCTURES } from './data.js';

const power = (s) => s.def.power * (0.35 + 0.65 * s.hp / s.maxHp);

export class AI {
  constructor(game, faction, diff) {
    this.g = game; this.f = faction; this.foe = faction === 'enemy' ? 'player' : 'enemy';
    this.diff = diff;
    this.t = 4;
    this.ops = [];       // [{ body, ships:Set, since }]
    this.saveFor = null;
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = this.diff.think * (0.8 + Math.random() * 0.4);
    if (this.g.over) return;
    this.economy();
    this.military();
  }

  // ------------------------------------------------------------ economy
  economy() {
    const g = this.g, F = g.factions[this.f];
    const mine = g.bodyOf(this.f);
    if (!mine.length) return;
    const foeBodies = g.bodyOf(this.foe);
    const frontDist = (b) => foeBodies.length ? Math.min(...foeBodies.map((o) => o.pos.distanceTo(b.pos))) : 999;
    const yards = mine.filter((b) => b.structures.yard);

    // structures
    const idleBuild = mine.filter((b) => !b.building);
    if (F.alloy > 160) {
      const wantYard = yards.length < 1 + Math.floor(mine.length / 4);
      if (wantYard) {
        const c = idleBuild.filter((b) => !b.structures.yard && b.control > 90).sort((a, b) => a.pos.distanceTo(mine[0].pos) - b.pos.distanceTo(mine[0].pos))[0];
        if (c && g.buildStructure(c, 'yard', this.f)) return;
      }
      const mineC = idleBuild.filter((b) => !b.structures.mine && b.prod >= 3).sort((a, b) => b.prod - a.prod)[0];
      if (mineC && F.alloy > 200 && Math.random() < 0.6 && g.buildStructure(mineC, 'mine', this.f)) return;
      const front = idleBuild.filter((b) => !b.structures.battery).sort((a, b) => frontDist(a) - frontDist(b))[0];
      if (front && F.alloy > 260 && frontDist(front) < 260 && Math.random() < 0.5 && g.buildStructure(front, 'battery', this.f)) return;
    }

    // ships, weighted toward countering what the opponent fields
    const foeShips = g.shipsOf(this.foe);
    const comp = { corvette: 0, frigate: 0, dreadnought: 0 };
    for (const s of foeShips) comp[s.cls] += s.def.power;
    const tot = comp.corvette + comp.frigate + comp.dreadnought || 1;
    const early = g.time < 100;
    const w = {
      corvette: (early ? 2.2 : 0.7) + 3 * comp.dreadnought / tot,
      frigate: 0.7 + 3 * comp.corvette / tot,
      dreadnought: (early ? 0 : 0.45) + 3 * comp.frigate / tot,
    };
    for (const y of yards.sort((a, b) => a.queue.length - b.queue.length)) {
      if (y.queue.length >= 2) continue;
      let pick = this.saveFor;
      if (!pick) {
        const r = Math.random() * (w.corvette + w.frigate + w.dreadnought);
        pick = r < w.corvette ? 'corvette' : r < w.corvette + w.frigate ? 'frigate' : 'dreadnought';
      }
      if (g.queueShip(y, pick, this.f)) { this.saveFor = null; continue; }
      // can't afford: sometimes save for the big hull, otherwise take something cheaper
      if (pick === 'dreadnought' && Math.random() < 0.5) { this.saveFor = 'dreadnought'; break; }
      this.saveFor = null;
      if (!g.queueShip(y, 'frigate', this.f)) g.queueShip(y, 'corvette', this.f);
      break;
    }
  }

  // ------------------------------------------------------------ military
  military() {
    const g = this.g;
    const my = g.shipsOf(this.f);
    // prune finished ops
    this.ops = this.ops.filter((op) => {
      for (const s of op.ships) if (s.dead) op.ships.delete(s);
      const done = op.ships.size === 0 || op.body.owner === this.f || g.time - op.since > 140;
      return !done;
    });
    const busy = new Set();
    for (const op of this.ops) for (const s of op.ships) busy.add(s);
    const idle = my.filter((s) => !s.order && !busy.has(s));
    if (!idle.length) return;

    const threatAt = (b) => {
      let p = 0;
      for (const s of g.ships) if (s.faction === this.foe && s.pos.distanceTo(b.pos) < b.captureR + 40) p += power(s);
      return p;
    };
    const ownAt = (b) => {
      let p = 0;
      for (const s of my) if (s.pos.distanceTo(b.pos) < b.captureR + 30) p += power(s);
      return p;
    };

    // 1. defend
    for (const b of g.bodyOf(this.f)) {
      const th = threatAt(b);
      if (th <= 0) continue;
      const have = ownAt(b);
      if (have > th * 1.3) continue;
      const pool = idle.filter((s) => s.host !== b && !busy.has(s)).sort((a, c) => a.pos.distanceTo(b.pos) - c.pos.distanceTo(b.pos));
      const group = []; let sum = have;
      for (const s of pool) { if (sum > th * 1.5) break; group.push(s); sum += power(s); }
      if (group.length && sum > th * 0.9) {
        g.order(group, { type: 'body', body: b });
        this.ops.push({ body: b, ships: new Set(group), since: g.time, defend: true });
        for (const s of group) busy.add(s);
      }
    }

    // 2. expand / attack
    if (this.ops.filter((o) => !o.defend).length >= (this.diff.id === 2 ? 3 : 2)) return;
    const avail = idle.filter((s) => !busy.has(s));
    if (!avail.length) return;
    const centre = avail.reduce((v, s) => v.add(s.pos), avail[0].pos.clone().multiplyScalar(0)).multiplyScalar(1 / avail.length);
    let best = null, bestScore = -Infinity, bestNeed = 0;
    for (const b of g.bodies) {
      if (b.owner === this.f) continue;
      if (this.ops.some((o) => o.body === b)) continue;
      const def = threatAt(b) + (b.structures.battery && b.owner === this.foe ? 9 : 0) + (b.owner === 'neutral' ? b.native * 2.2 : 0);
      const value = b.prod * 2 + (b.structures.yard ? 4 : 0) + (b.structures.mine ? 2 : 0) + (b.home ? 5 : 0) + (b.owner === this.foe ? 3 : 0);
      const dist = centre.distanceTo(b.pos);
      const score = value / (1 + dist / 180) / (1 + def / (6 * this.diff.aggression));
      if (score > bestScore) { bestScore = score; best = b; bestNeed = def * 1.5 / this.diff.aggression + 1.5; }
    }
    if (!best) return;
    // pull from the closest idle ships, keeping a token guard on the home yard
    const home = g.bodies.find((b) => b.home === this.f && b.owner === this.f);
    const pool = avail.sort((a, c) => a.pos.distanceTo(best.pos) - c.pos.distanceTo(best.pos));
    const group = []; let sum = 0; let guard = 0;
    for (const s of pool) {
      if (home && s.host === home && guard < 2 && g.time > 120) { guard += power(s); continue; }
      group.push(s); sum += power(s);
      if (sum >= bestNeed * 1.6) break;
    }
    if (sum >= bestNeed && group.length) {
      g.order(group, { type: 'body', body: best });
      this.ops.push({ body: best, ships: new Set(group), since: g.time });
    }
  }
}
export { power };
