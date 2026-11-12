import { describe, expect, it } from 'vitest';
import { CLASSES, defaultLoadout, sanitizeLoadout } from '@shared/classes';
import { PLAYER, SIM } from '@shared/config';
import { stepMove } from '@shared/movement';
import { NavGrid } from '@shared/nav';
import { decodeSnapshot, encodeSnapshot, packCmd, unpackCmd } from '@shared/protocol';
import { BTN_CROUCH, BTN_FIRE, BTN_JUMP, BTN_RELOAD, BTN_SPRINT, type Cmd, makePlayerState } from '@shared/types';
import { makeWeaponOut, shotDirection, stepWeapon, type WeaponCtx } from '@shared/weaponLogic';
import { WEAPONS, damageAtRange, resolveWeapon } from '@shared/weapons';
import { F_BULLET, makeRayHit } from '@shared/world/World';
import { buildKestrel } from '@shared/world/maps/kestrel';

const map = buildKestrel();
const world = map.world;
const params = { speedMul: 1, adsMoveFactor: 0.6, boost: 1 };
const cmd = (o: Partial<Cmd> = {}): Cmd => ({ seq: 1, buttons: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, slot: 0, viewTick: 0, ...o });
const spawn = () => { const s = makePlayerState(); s.x = -12; s.y = 0.02; s.z = 0.3; s.tacT = PLAYER.TAC_SPRINT_MAX; return s; };
const run = (s: ReturnType<typeof spawn>, c: Cmd, n: number) => { for (let i = 0; i < n; i++) stepMove(s, c, SIM.CMD_DT, world, params); };

describe('movement', () => {
  it('settles on the ground and walks at walk speed', () => {
    const s = spawn();
    run(s, cmd({ mz: 1, yaw: Math.PI / 2 }), 120); // facing -X along the avenue
    expect(s.grounded).toBe(true);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(PLAYER.WALK_SPEED, 1);
    expect(s.x).toBeLessThan(-18);
  });
  it('sprints faster than walking and slides when crouching at speed', () => {
    const s = spawn();
    run(s, cmd({ mz: 1, yaw: Math.PI / 2, buttons: BTN_SPRINT }), 90);
    expect(Math.hypot(s.vx, s.vz)).toBeGreaterThan(PLAYER.WALK_SPEED + 1);
    run(s, cmd({ mz: 1, yaw: Math.PI / 2, buttons: BTN_SPRINT | BTN_CROUCH }), 3);
    expect(s.slideT).toBeGreaterThan(0);
    expect(s.crouching).toBe(true);
  });
  it('jumps roughly one metre and lands again', () => {
    const s = spawn();
    run(s, cmd(), 5);
    const y0 = s.y;
    let peak = 0;
    for (let i = 0; i < 90; i++) { stepMove(s, cmd({ buttons: i < 2 ? BTN_JUMP : 0 }), SIM.CMD_DT, world, params); peak = Math.max(peak, s.y - y0); }
    expect(peak).toBeGreaterThan(0.8); expect(peak).toBeLessThan(1.3);
    expect(s.grounded).toBe(true);
  });
  it('cannot walk through walls', () => {
    const s = spawn(); s.x = -70; s.z = 20; // inside the west base, perimeter wall at x -68..-67
    run(s, cmd({ mz: 1, yaw: -Math.PI / 2 }), 300);
    expect(s.x).toBeLessThan(-68);
  });
  it('climbs stairs to the upper floor', () => {
    const s = spawn(); s.x = 5; s.y = 0.2; s.z = -33; // Bank stair flight rises towards +X
    run(s, cmd({ mz: 1, yaw: -Math.PI / 2 }), 240);
    expect(s.y).toBeGreaterThan(3);
  });
  it('is deterministic', () => {
    const a = spawn(), b = spawn();
    for (let i = 0; i < 200; i++) { const c = cmd({ mz: 1, mx: Math.sin(i * 0.1), yaw: i * 0.02, buttons: i % 50 === 0 ? BTN_JUMP : 0 }); stepMove(a, c, SIM.CMD_DT, world, params); stepMove(b, c, SIM.CMD_DT, world, params); }
    expect(a).toEqual(b);
  });
});

describe('weapons', () => {
  const ctx = (): WeaponCtx => ({ primary: resolveWeapon('kr7'), secondary: resolveWeapon('p12'), gadgets: CLASSES[0].gadgets, locked: false });
  it('respects fire rate, magazine size and reloads', () => {
    const c = ctx(), s = makePlayerState(), out = makeWeaponOut();
    s.ammo0 = c.primary.magSize; s.reserve0 = 60;
    let shots = 0;
    for (let i = 0; i < 60; i++) { stepWeapon(s, cmd({ buttons: BTN_FIRE }), SIM.CMD_DT, c, out); if (out.fired) shots++; }
    expect(shots).toBeGreaterThanOrEqual(11); expect(shots).toBeLessThanOrEqual(13); // 700 rpm for one second
    for (let i = 0; i < 600 && s.ammo0 > 0; i++) stepWeapon(s, cmd({ buttons: BTN_FIRE }), SIM.CMD_DT, c, out);
    expect(s.ammo0).toBe(0);
    for (let i = 0; i < 240; i++) stepWeapon(s, cmd({ buttons: BTN_RELOAD }), SIM.CMD_DT, c, out);
    expect(s.ammo0).toBe(c.primary.magSize); expect(s.reserve0).toBe(30);
  });
  it('never fires without ammunition and semi-auto needs a trigger release', () => {
    const c = ctx(), s = makePlayerState(), out = makeWeaponOut();
    s.slot = 1; s.ammo1 = 12;
    let shots = 0;
    for (let i = 0; i < 120; i++) { stepWeapon(s, cmd({ buttons: BTN_FIRE, slot: 1 }), SIM.CMD_DT, c, out); if (out.fired) shots++; }
    expect(shots).toBe(1);
    s.ammo1 = 0; s.reserve1 = 0; s.triggerLatch = false;
    for (let i = 0; i < 60; i++) { stepWeapon(s, cmd({ buttons: i % 2 ? BTN_FIRE : 0, slot: 1 }), SIM.CMD_DT, c, out); expect(out.fired).toBe(false); }
  });
  it('attachments change stats and damage falls off with range', () => {
    const base = resolveWeapon('kr7'), mod = resolveWeapon('kr7', { mag: 'extended', muzzle: 'suppressor', optic: 'acog' });
    expect(mod.magSize).toBeGreaterThan(base.magSize); expect(mod.suppressed).toBe(true); expect(mod.zoom).toBe(4);
    expect(damageAtRange(base, 5)).toBe(base.damage); expect(damageAtRange(base, 500)).toBe(base.minDamage);
    expect(WEAPONS.length).toBeGreaterThanOrEqual(6);
  });
  it('spread is deterministic for client and server', () => {
    const a = shotDirection(1, 0.1, 2, 3, 77, { x: 0, y: 0, z: 0 }), b = shotDirection(1, 0.1, 2, 3, 77, { x: 0, y: 0, z: 0 });
    expect(a).toEqual(b);
  });
});

describe('validation + protocol', () => {
  it('rejects illegal loadouts', () => {
    const l = sanitizeLoadout({ classId: 3, primary: 'bulwark', secondary: 'nuke', primaryAtt: { optic: 'scope12', muzzle: 'laser' } }, 1);
    expect(l.primary).toBe('longbow'); expect(l.secondary).toBe('p12'); expect(l.primaryAtt.optic).not.toBe('scope12'); expect(l.primaryAtt.muzzle).toBe('none');
    expect(sanitizeLoadout('garbage')).toEqual(defaultLoadout(0));
  });
  it('rejects malformed commands', () => {
    expect(unpackCmd(null)).toBeNull(); expect(unpackCmd([1, 2, 3])).toBeNull();
    expect(unpackCmd([1, 0, 0, 0, NaN, 0, 0, 0])).toBeNull(); expect(unpackCmd([1, 0, 0, 0, 0, 9, 0, 0])).toBeNull(); expect(unpackCmd([1, 0, 0, 0, 0, 0, 7, 0])).toBeNull();
    const c = unpackCmd(packCmd(cmd({ seq: 9, mx: 5, mz: -1, yaw: 1.2345, pitch: -0.3, buttons: 5 })));
    expect(c?.seq).toBe(9); expect(c?.mx).toBe(1); expect(c?.yaw).toBeCloseTo(1.2345, 3);
  });
  it('round-trips snapshots through the binary codec', () => {
    const snap = { tick: 1234, phase: 'live' as const, timeLeft: 600, tickets: [250, 199] as [number, number],
      players: [{ id: 3, x: -51.23, y: 3.55, z: 20.5, yaw: 1.5, pitch: -0.4, flags: 517, health: 87, slot: 1 }],
      projectiles: [{ id: 9, kind: 2, x: 1, y: 2, z: 3 }], deployables: [{ id: 4, kind: 1, team: 2 as const, x: 5, y: 0.15, z: -6, life: 30 }],
      vehicles: [{ id: 0, x: -80, y: 0.15, z: 11.5, yaw: -1.57, pitch: 0.1, roll: 0, speed: 12.5, steer: 0.3, health: 600, driver: 3, passenger: -1, team: 1 as const, alive: true }],
      objectives: [{ owner: 1 as const, control: 0.5, contested: true, presence: 3 }] };
    const out = decodeSnapshot(encodeSnapshot(snap));
    expect(out.tick).toBe(1234); expect(out.players[0].x).toBeCloseTo(-51.23, 2); expect(out.players[0].flags).toBe(517);
    expect(out.vehicles[0].driver).toBe(3); expect(out.vehicles[0].passenger).toBe(-1); expect(out.objectives[0].contested).toBe(true);
    expect(encodeSnapshot(snap).length).toBeLessThan(120);
  });
});

describe('world + navigation', () => {
  it('raycasts hit walls and miss open space', () => {
    const hit = makeRayHit();
    expect(world.raycast(-70, 1.5, 20, 1, 0, 0, 50, F_BULLET, hit)).toBe(true);
    expect(hit.t).toBeLessThan(3);
    expect(world.raycast(0, 30, 0, 0, 1, 0, 50, F_BULLET, hit)).toBe(false);
  });
  it('connects every spawn, objective and overwatch position', () => {
    const nav = new NavGrid(world);
    const path: number[] = [];
    const baseA = map.bases[0].spawns[0], baseB = map.bases[1].spawns[0];
    const from = nav.nearest(baseA.x, baseA.y, baseA.z);
    const targets = [baseB, ...map.objectives.flatMap((o) => [o, ...o.spawns]), ...map.overwatch];
    for (const t of targets) {
      const n = nav.nearest(t.x, t.y, t.z, 2);
      expect(n, `no nav node near ${JSON.stringify(t)}`).toBeGreaterThanOrEqual(0);
      expect(nav.findPath(from, n, path), `no path to ${JSON.stringify(t)}`).toBe(true);
    }
  });
});
