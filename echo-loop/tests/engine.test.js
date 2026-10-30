const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

const idle = { dx: 0, dy: 0, aim: 0, fire: false };

function runTicks(g, n, inputFn) {
  for (let i = 0; i < n && !g.over; i++) E.step(g, inputFn ? inputFn(g, i) : idle);
  return g;
}

test('spawn plan is deterministic and earlier spawns repeat in later loops', () => {
  const a = E.spawnPlan(0, 42);
  const b = E.spawnPlan(0, 42);
  assert.deepEqual(a, b);
  const later = E.spawnPlan(3, 42);
  assert.ok(later.length > a.length);
  // every chaser spawn from loop 0 appears at the same tick and place in loop 3
  for (const s of a) {
    assert.ok(later.some((l) => l.tick === s.tick && l.x === s.x && l.y === s.y));
  }
});

test('different seeds give different plans', () => {
  assert.notDeepEqual(E.spawnPlan(0, 1), E.spawnPlan(0, 2));
});

test('finishing a loop turns the run into an echo and resets the arena', () => {
  const g = E.createGame({ seed: 7 });
  // dodge by circling the arena edge so the player survives a full loop
  runTicks(g, E.C.LOOP_TICKS, (gg, i) => ({ dx: Math.cos(i / 20), dy: Math.sin(i / 20), aim: null, fire: true }));
  assert.equal(g.loop, 1);
  assert.equal(g.echoes.length, 1);
  assert.equal(g.echoes[0].rec.length, E.C.LOOP_TICKS);
  assert.equal(g.tick, 0);
  assert.equal(g.enemies.length, 0);
  assert.equal(g.player.x, E.C.W / 2);
  const events = E.drainEvents(g);
  assert.ok(events.some((e) => e.type === 'loop' && e.echoes === 1));
});

test('an echo replays the recorded path tick by tick', () => {
  const g = E.createGame({ seed: 7 });
  g.lives = 1e9;
  runTicks(g, E.C.LOOP_TICKS, () => ({ dx: 1, dy: 0, aim: 0, fire: false }));
  const rec = g.echoes[0].rec;
  runTicks(g, 50, () => idle);
  const [pos] = E.echoPositions(g);
  assert.equal(pos.r.x, rec[50].x);
  assert.equal(pos.r.y, rec[50].y);
});

test('echoes fire the shots that were recorded', () => {
  const g = E.createGame({ seed: 7 });
  g.lives = 1e9;
  runTicks(g, E.C.LOOP_TICKS, () => ({ dx: 0, dy: 0, aim: 1, fire: true }));
  const recordedShots = g.echoes[0].rec.filter((r) => r.f).length;
  assert.ok(recordedShots > 0);
  E.drainEvents(g);
  let echoShots = 0;
  runTicks(g, E.C.LOOP_TICKS - 1, (gg) => {
    const ev = E.drainEvents(gg);
    echoShots += ev.filter((e) => e.type === 'shoot' && e.owner === 'echo').length;
    return { dx: 1, dy: 1, aim: 1, fire: false };
  });
  echoShots += E.drainEvents(g).filter((e) => e.type === 'shoot' && e.owner === 'echo').length;
  // echoes stop firing if an enemy shatters them, so allow fewer but never more
  assert.ok(echoShots > 0 && echoShots <= recordedShots);
});

test('echo count is capped and the oldest echo is dropped', () => {
  const g = E.createGame({ seed: 3 });
  g.lives = 1e9; // keep the run alive regardless of hits
  const loops = E.C.MAX_ECHOES + 3;
  runTicks(g, E.C.LOOP_TICKS * loops, () => ({ dx: 0, dy: 0, aim: null, fire: true }));
  assert.equal(g.loop, loops);
  assert.equal(g.echoes.length, E.C.MAX_ECHOES);
  assert.equal(g.echoes[0].born, 3);
});

test('shooting kills enemies and scores', () => {
  const g = E.createGame({ seed: 11 });
  runTicks(g, 400, () => ({ dx: 0, dy: 0, aim: null, fire: true }));
  assert.ok(g.stats.kills > 0);
  assert.ok(g.score >= g.stats.kills * 10);
});

test('standing still without shooting eventually ends the run', () => {
  const g = E.createGame({ seed: 5 });
  runTicks(g, E.C.LOOP_TICKS * 6, () => idle);
  assert.equal(g.over, true);
  assert.equal(g.lives, 0);
  const before = { tick: g.tick, score: g.score };
  E.step(g, idle);
  assert.deepEqual({ tick: g.tick, score: g.score }, before, 'no updates after game over');
});

test('a hit grants temporary invulnerability', () => {
  const h = E.createGame({ seed: 5 });
  let hitTick = -1;
  for (let i = 0; i < E.C.LOOP_TICKS * 3 && hitTick < 0; i++) {
    E.step(h, idle);
    if (E.drainEvents(h).some((e) => e.type === 'hit')) hitTick = i;
  }
  assert.ok(hitTick >= 0);
  assert.equal(h.lives, E.C.START_LIVES - 1);
  assert.equal(h.player.invuln, E.C.INVULN_TICKS);
});

test('an enemy touching an echo shatters it for the rest of the loop', () => {
  const g = E.createGame({ seed: 9 });
  g.lives = 1e9;
  runTicks(g, E.C.LOOP_TICKS, () => ({ dx: 0, dy: 0, aim: null, fire: true }));
  // walk the live player away from the shared start point so only the echo is touched
  runTicks(g, 40, () => ({ dx: 1, dy: 0, aim: null, fire: false }));
  const echo = g.echoes[0];
  const r = echo.rec[g.tick];
  g.enemies.push({ id: 999, kind: 'chaser', x: r.x, y: r.y, r: 11, hp: 1, speed: 0 });
  E.step(g, { dx: 1, dy: 0, aim: 0, fire: false });
  assert.equal(echo.alive, false);
  assert.equal(g.stats.shattered, 1);
  // revived at the next loop
  runTicks(g, E.C.LOOP_TICKS, () => ({ dx: 0, dy: 0, aim: null, fire: true }));
  if (!g.over) assert.equal(g.echoes.find((e) => e.id === echo.id).alive, true);
});

test('same seed and same inputs give the same game', () => {
  const play = () => {
    const g = E.createGame({ seed: 21 });
    runTicks(g, 900, (gg, i) => ({ dx: Math.sin(i / 30), dy: Math.cos(i / 45), aim: null, fire: true }));
    return { score: g.score, lives: g.lives, loop: g.loop, kills: g.stats.kills };
  };
  assert.deepEqual(play(), play());
});

test('diagonal input is normalized and the player stays in bounds', () => {
  const g = E.createGame({ seed: 1 });
  E.step(g, { dx: 1, dy: 1, aim: 0, fire: false });
  const moved = Math.hypot(g.player.x - E.C.W / 2, g.player.y - E.C.H / 2);
  assert.ok(Math.abs(moved - E.C.PLAYER_SPEED) < 1e-9);
  runTicks(g, 300, () => ({ dx: -1, dy: -1, aim: 0, fire: false }));
  assert.ok(g.player.x >= E.C.PLAYER_R && g.player.y >= E.C.PLAYER_R);
});
