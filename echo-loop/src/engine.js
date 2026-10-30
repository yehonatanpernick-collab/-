// Echo Loop — pure game logic. No DOM, no timers: the caller feeds one input per tick.
// Loaded as a classic <script> in the browser (window.EchoEngine) and via require() in tests.
(function (root) {
  'use strict';

  const C = {
    W: 960,
    H: 600,
    TPS: 60,
    LOOP_TICKS: 600, // 10 seconds per loop
    PLAYER_R: 12,
    PLAYER_SPEED: 4.2,
    BULLET_SPEED: 11,
    BULLET_R: 4,
    BULLET_LIFE: 90,
    FIRE_COOLDOWN: 8,
    MAX_ECHOES: 12,
    START_LIVES: 3,
    INVULN_TICKS: 90,
    LOOP_BONUS: 50,
  };

  const KINDS = {
    chaser: { r: 11, hp: 1, score: 10, speed: 1.6 },
    eater: { r: 13, hp: 2, score: 25, speed: 1.9 },
    brute: { r: 22, hp: 5, score: 40, speed: 0.9 },
  };

  // mulberry32 — small, fast, deterministic.
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Spawn i always appears at the same tick and spot in every loop, so the shots an
  // echo recorded last loop land where enemies will be again. Each loop adds more.
  function spawnPlan(loop, seed) {
    const count = 6 + loop * 5;
    const plan = [];
    for (let i = 0; i < count; i++) {
      const r = rng((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
      const edge = Math.floor(r() * 4);
      const u = r();
      let x, y;
      if (edge === 0) { x = u * C.W; y = -30; }
      else if (edge === 1) { x = C.W + 30; y = u * C.H; }
      else if (edge === 2) { x = u * C.W; y = C.H + 30; }
      else { x = -30; y = u * C.H; }
      let kind = 'chaser';
      if (loop >= 3 && i % 7 === 6) kind = 'brute';
      else if (loop >= 2 && i % 5 === 4) kind = 'eater';
      const tick = 30 + ((i * 97) % 500);
      plan.push({ tick, x, y, kind });
      // from loop 2 on, every third spawn arrives as a pack
      if (loop >= 2 && i % 3 === 0) {
        for (let k = 1; k <= Math.min(1 + Math.floor(loop / 3), 4); k++) {
          plan.push({ tick: tick + k * 4, x: x + (r() - 0.5) * 80, y: y + (r() - 0.5) * 80, kind: 'chaser' });
        }
      }
    }
    return plan.sort((a, b) => a.tick - b.tick);
  }

  function createGame(opts) {
    const seed = (opts && opts.seed) >>> 0 || 1337;
    const g = {
      seed,
      tick: 0,
      totalTicks: 0,
      loop: 0,
      score: 0,
      lives: C.START_LIVES,
      over: false,
      player: null,
      recording: [],
      echoes: [],
      enemies: [],
      bullets: [],
      plan: [],
      planIdx: 0,
      nextId: 1,
      events: [],
      stats: { kills: 0, echoKills: 0, shattered: 0 },
    };
    startLoop(g);
    return g;
  }

  function startLoop(g) {
    g.tick = 0;
    g.player = { x: C.W / 2, y: C.H / 2, a: 0, cooldown: 0, invuln: g.player ? C.INVULN_TICKS : 0 };
    g.recording = [];
    g.enemies = [];
    g.bullets = [];
    g.plan = spawnPlan(g.loop, g.seed);
    g.planIdx = 0;
    for (const e of g.echoes) { e.alive = true; e.cooldown = 0; }
  }

  function endLoop(g) {
    g.echoes.push({ id: g.nextId++, born: g.loop, rec: g.recording, alive: true, cooldown: 0 });
    while (g.echoes.length > C.MAX_ECHOES) g.echoes.shift();
    g.score += C.LOOP_BONUS * (g.loop + 1);
    g.loop++;
    g.events.push({ type: 'loop', loop: g.loop, echoes: g.echoes.length });
    startLoop(g);
  }

  function selves(g) {
    const out = [{ x: g.player.x, y: g.player.y, echo: null }];
    for (const e of g.echoes) {
      if (!e.alive) continue;
      const p = e.rec[g.tick];
      if (p) out.push({ x: p.x, y: p.y, echo: e });
    }
    return out;
  }

  function nearest(list, x, y) {
    let best = null, bd = Infinity;
    for (const t of list) {
      const d = (t.x - x) ** 2 + (t.y - y) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  function fire(g, x, y, a, owner) {
    g.bullets.push({
      x: x + Math.cos(a) * C.PLAYER_R,
      y: y + Math.sin(a) * C.PLAYER_R,
      vx: Math.cos(a) * C.BULLET_SPEED,
      vy: Math.sin(a) * C.BULLET_SPEED,
      life: C.BULLET_LIFE,
      owner,
    });
    g.events.push({ type: 'shoot', owner, x, y });
  }

  // Angle from (x, y) to the closest enemy, or null if the arena is empty.
  function autoAim(g, x, y) {
    const t = nearest(g.enemies, x, y);
    return t ? Math.atan2(t.y - y, t.x - x) : null;
  }

  // input: { dx, dy, aim (radians) | null for auto-aim, fire: bool }
  function step(g, input) {
    if (g.over) return g;
    input = input || {};
    const p = g.player;

    // 1. spawns
    while (g.planIdx < g.plan.length && g.plan[g.planIdx].tick <= g.tick) {
      const s = g.plan[g.planIdx++];
      const k = KINDS[s.kind];
      const speed = Math.min(k.speed + g.loop * 0.12, k.speed * 2.2);
      const hp = k.hp + Math.floor(g.loop / 4);
      g.enemies.push({ id: g.nextId++, kind: s.kind, x: s.x, y: s.y, r: k.r, hp, speed });
      g.events.push({ type: 'spawn', kind: s.kind, x: s.x, y: s.y });
    }

    // 2. live player: move, aim, fire, record
    let dx = +input.dx || 0, dy = +input.dy || 0;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    p.x = Math.max(C.PLAYER_R, Math.min(C.W - C.PLAYER_R, p.x + dx * C.PLAYER_SPEED));
    p.y = Math.max(C.PLAYER_R, Math.min(C.H - C.PLAYER_R, p.y + dy * C.PLAYER_SPEED));
    const aim = typeof input.aim === 'number' && isFinite(input.aim) ? input.aim : autoAim(g, p.x, p.y);
    if (aim !== null) p.a = aim;
    if (p.cooldown > 0) p.cooldown--;
    if (p.invuln > 0) p.invuln--;
    let fired = false;
    if (input.fire && aim !== null && p.cooldown === 0) {
      fire(g, p.x, p.y, p.a, 'player');
      p.cooldown = C.FIRE_COOLDOWN;
      fired = true;
    }
    g.recording.push({ x: p.x, y: p.y, a: p.a, f: fired });

    // 3. echoes replay exactly what you did in earlier loops
    for (const e of g.echoes) {
      const r = e.rec[g.tick];
      if (e.alive && r && r.f) fire(g, r.x, r.y, r.a, 'echo');
    }

    // 4. enemies hunt a self — eaters prefer echoes
    const all = selves(g);
    const echoesOnly = all.filter((s) => s.echo);
    for (const en of g.enemies) {
      const pool = en.kind === 'eater' && echoesOnly.length ? echoesOnly : all;
      const t = nearest(pool, en.x, en.y);
      const d = Math.hypot(t.x - en.x, t.y - en.y) || 1;
      en.x += ((t.x - en.x) / d) * en.speed;
      en.y += ((t.y - en.y) / d) * en.speed;
    }

    // 5. bullets
    for (const b of g.bullets) { b.x += b.vx; b.y += b.vy; b.life--; }
    for (const b of g.bullets) {
      if (b.life <= 0) continue;
      for (const en of g.enemies) {
        if (en.hp <= 0) continue;
        if ((b.x - en.x) ** 2 + (b.y - en.y) ** 2 <= (en.r + C.BULLET_R) ** 2) {
          b.life = 0;
          en.hp--;
          if (en.hp <= 0) {
            g.score += KINDS[en.kind].score;
            g.stats.kills++;
            if (b.owner === 'echo') g.stats.echoKills++;
            g.events.push({ type: 'kill', kind: en.kind, owner: b.owner, x: en.x, y: en.y });
          } else {
            g.events.push({ type: 'hurt', x: en.x, y: en.y });
          }
          break;
        }
      }
    }
    g.bullets = g.bullets.filter(
      (b) => b.life > 0 && b.x > -20 && b.x < C.W + 20 && b.y > -20 && b.y < C.H + 20
    );

    // 6. enemies touching selves
    for (const en of g.enemies) {
      if (en.hp <= 0) continue;
      for (const s of all) {
        if (s.echo && !s.echo.alive) continue;
        if ((s.x - en.x) ** 2 + (s.y - en.y) ** 2 > (en.r + C.PLAYER_R) ** 2) continue;
        if (s.echo) {
          s.echo.alive = false;
          g.stats.shattered++;
          g.events.push({ type: 'shatter', x: s.x, y: s.y, id: s.echo.id });
          if (en.kind === 'eater') { en.r += 3; en.hp += 1; }
          else en.hp = 0;
        } else if (p.invuln === 0) {
          g.lives--;
          p.invuln = C.INVULN_TICKS;
          en.hp = 0;
          g.events.push({ type: 'hit', x: p.x, y: p.y, lives: g.lives });
          if (g.lives <= 0) {
            g.over = true;
            g.events.push({ type: 'over', score: g.score, loop: g.loop });
          }
        }
        break;
      }
    }
    g.enemies = g.enemies.filter((en) => en.hp > 0);

    g.tick++;
    g.totalTicks++;
    if (!g.over && g.tick >= C.LOOP_TICKS) endLoop(g);
    return g;
  }

  // Positions of every self this tick, for rendering.
  function echoPositions(g) {
    return g.echoes
      .map((e, i) => ({ e, i, r: e.rec[g.tick] || e.rec[e.rec.length - 1] }))
      .filter((o) => o.r);
  }

  function drainEvents(g) {
    const ev = g.events;
    g.events = [];
    return ev;
  }

  const api = { C, KINDS, rng, spawnPlan, createGame, step, echoPositions, drainEvents, autoAim };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EchoEngine = api;
})(typeof self !== 'undefined' ? self : this);
