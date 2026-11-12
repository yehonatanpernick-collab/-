// Weapon / gadget state machine shared by server and client prediction.
// The server additionally resolves what each shot hits; the client only uses the
// outputs for immediate feedback (muzzle flash, sound, recoil, ammo counter).
import { GADGETS, type GadgetKind } from './classes';
import { DEG, approach, clamp, dirFromAngles, hash01, type Vec3 } from './math';
import { BTN_ADS, BTN_FIRE, BTN_GRENADE, BTN_RELOAD, BTN_USE, type Cmd, type PlayerState } from './types';
import type { WeaponStats } from './weapons';

export interface WeaponCtx {
  primary: WeaponStats;
  secondary: WeaponStats;
  gadgets: readonly [GadgetKind, GadgetKind | null];
  /** True when the player may not use weapons at all (driving, dead, warmup). */
  locked: boolean;
}

export interface WeaponOut {
  fired: boolean;
  /** Aim angles (including accumulated recoil) and cone half-angle (deg) of the shot. */
  aimYaw: number;
  aimPitch: number;
  spread: number;
  shotSeq: number;
  gadget: GadgetKind | null;
  grenade: boolean;
  reloadStart: boolean;
  reloadDone: boolean;
  dry: boolean;
  use: boolean;
  switched: boolean;
}

export const makeWeaponOut = (): WeaponOut => ({
  fired: false, aimYaw: 0, aimPitch: 0, spread: 0, shotSeq: 0, gadget: null, grenade: false,
  reloadStart: false, reloadDone: false, dry: false, use: false, switched: false,
});

export const GRENADE_COOLDOWN = 1.1;
const MAX_RECOIL = 14 * DEG;

export function activeWeapon(s: PlayerState, ctx: WeaponCtx): WeaponStats {
  return s.slot === 1 ? ctx.secondary : ctx.primary;
}

export function slotValid(slot: number, ctx: WeaponCtx): boolean {
  if (slot === 0 || slot === 1) return true;
  if (slot === 2) return true;
  if (slot === 3) return ctx.gadgets[1] !== null;
  return false;
}

/** Current cone half-angle in degrees. */
export function currentSpread(s: PlayerState, w: WeaponStats): number {
  const speed = Math.hypot(s.vx, s.vz);
  const moveFrac = clamp(speed / 5, 0, 1);
  let spread = w.hipSpread + (w.adsSpread - w.hipSpread) * s.ads;
  spread += moveFrac * w.moveSpread * (1 - 0.75 * s.ads);
  if (!s.grounded) spread += w.jumpSpread;
  if (s.crouching && s.slideT <= 0) spread *= 0.8;
  return spread + s.bloom;
}

export function stepWeapon(s: PlayerState, cmd: Cmd, dt: number, ctx: WeaponCtx, out: WeaponOut): void {
  out.fired = false; out.gadget = null; out.grenade = false; out.reloadStart = false;
  out.reloadDone = false; out.dry = false; out.use = false; out.switched = false;
  const btn = cmd.buttons;

  s.fireCd -= dt;
  if (s.fireCd < -dt) s.fireCd = -dt;
  if (s.switchT > 0) s.switchT = Math.max(0, s.switchT - dt);
  if (s.gadgetCd0 > 0) s.gadgetCd0 = Math.max(0, s.gadgetCd0 - dt);
  if (s.gadgetCd1 > 0) s.gadgetCd1 = Math.max(0, s.gadgetCd1 - dt);
  if (s.grenadeCd > 0) s.grenadeCd = Math.max(0, s.grenadeCd - dt);
  s.burstT += dt;

  const usePressed = (btn & BTN_USE) !== 0;
  if (usePressed && !s.useLatch) out.use = true;
  s.useLatch = usePressed;

  if (ctx.locked) {
    s.ads = approach(s.ads, 0, dt / 0.2);
    s.reloadT = 0;
    s.triggerLatch = true;
    s.grenadeLatch = (btn & BTN_GRENADE) !== 0;
    recover(s, activeWeapon(s, ctx), dt);
    return;
  }

  // ------------------------------------------------------------ slot switch
  if (cmd.slot !== s.slot && slotValid(cmd.slot, ctx)) {
    s.slot = cmd.slot;
    s.reloadT = 0;
    s.burst = 0;
    s.triggerLatch = true;
    s.switchT = s.slot < 2 ? activeWeapon(s, ctx).drawTime : GADGETS[ctx.gadgets[s.slot - 2] as GadgetKind].drawTime;
    out.switched = true;
  }

  const isGun = s.slot < 2;
  const w = activeWeapon(s, ctx);
  if (s.sprinting) s.sprintOutT = w.sprintOutTime;
  else if (s.sprintOutT > 0) s.sprintOutT = Math.max(0, s.sprintOutT - dt);

  const adsWanted = isGun && (btn & BTN_ADS) !== 0 && !s.sprinting && s.switchT <= 0 && s.reloadT <= 0;
  s.ads = approach(s.ads, adsWanted ? 1 : 0, dt / w.adsTime);

  const trigger = (btn & BTN_FIRE) !== 0;

  if (isGun) {
    const first = s.slot === 0;
    let ammo = first ? s.ammo0 : s.ammo1;
    let reserve = first ? s.reserve0 : s.reserve1;

    if (s.reloadT > 0) {
      s.reloadT -= dt;
      if (s.reloadT <= 0) {
        s.reloadT = 0;
        const take = Math.min(w.magSize - ammo, reserve);
        ammo += take; reserve -= take;
        out.reloadDone = true;
      }
    } else if (s.switchT <= 0 && ammo < w.magSize && reserve > 0 && ((btn & BTN_RELOAD) !== 0 || ammo === 0)) {
      s.reloadT = ammo === 0 ? w.reloadEmptyTime : w.reloadTime;
      out.reloadStart = true;
    }

    if (trigger && s.fireCd <= 0 && s.switchT <= 0 && s.reloadT <= 0 && s.sprintOutT <= 0 && (w.auto || !s.triggerLatch)) {
      if (ammo > 0) {
        ammo--;
        s.fireCd += w.fireInterval;
        if (s.burstT > Math.max(0.22, w.fireInterval * 2.2)) s.burst = 0;
        out.fired = true;
        out.aimYaw = cmd.yaw + s.recoilY;
        out.aimPitch = clamp(cmd.pitch + s.recoilP, -1.55, 1.55);
        out.spread = currentSpread(s, w);
        out.shotSeq = s.shotSeq;

        const r = w.recoil;
        let mult = 1 + (r.adsMult - 1) * s.ads;
        if (s.burst === 0) mult *= r.first;
        if (s.crouching && s.slideT <= 0) mult *= w.cls === 'lmg' ? 0.6 : 0.85;
        const n = r.pattern.length;
        const idx = s.burst < n ? s.burst : (n >> 1) + ((s.burst - n) % (n - (n >> 1)));
        const jitter = hash01(s.shotSeq, 17, 3) - 0.5;
        s.recoilP = Math.min(MAX_RECOIL, s.recoilP + r.v * mult * DEG * (0.9 + 0.2 * hash01(s.shotSeq, 5, 11)));
        s.recoilY = clamp(s.recoilY + r.h * mult * DEG * (r.pattern[idx] + jitter * 0.6), -MAX_RECOIL, MAX_RECOIL);
        s.burst++;
        s.burstT = 0;
        s.bloom = Math.min(w.bloomMax, s.bloom + w.bloomPerShot);
        s.shotSeq = (s.shotSeq + 1) & 0xffff;
      } else if (!s.triggerLatch) {
        out.dry = true;
      }
    }
    if (first) { s.ammo0 = ammo; s.reserve0 = reserve; } else { s.ammo1 = ammo; s.reserve1 = reserve; }
  } else {
    const gi = s.slot - 2;
    const kind = ctx.gadgets[gi];
    if (kind) {
      const def = GADGETS[kind];
      const count = gi === 0 ? s.gadget0 : s.gadget1;
      const cd = gi === 0 ? s.gadgetCd0 : s.gadgetCd1;
      if (def.hold) {
        if (trigger && s.switchT <= 0) out.gadget = kind;
      } else if (trigger && !s.triggerLatch && s.switchT <= 0 && cd <= 0 && count !== 0) {
        if (gi === 0) { if (count > 0) s.gadget0 = count - 1; s.gadgetCd0 = def.cooldown; }
        else { if (count > 0) s.gadget1 = count - 1; s.gadgetCd1 = def.cooldown; }
        out.gadget = kind;
        out.aimYaw = cmd.yaw;
        out.aimPitch = cmd.pitch;
      }
    }
  }
  s.triggerLatch = trigger;

  // ------------------------------------------------------------ grenade (quick throw)
  const gren = (btn & BTN_GRENADE) !== 0;
  if (gren && !s.grenadeLatch && s.grenades > 0 && s.grenadeCd <= 0 && s.switchT <= 0) {
    s.grenades--;
    s.grenadeCd = GRENADE_COOLDOWN;
    out.grenade = true;
    out.aimYaw = cmd.yaw;
    out.aimPitch = cmd.pitch;
  }
  s.grenadeLatch = gren;

  recover(s, w, dt);
}

function recover(s: PlayerState, w: WeaponStats, dt: number): void {
  if (s.burstT > w.fireInterval * 1.4) {
    const rec = w.recoil.recover * DEG * dt * (1 + s.burstT * 2);
    s.recoilP = approach(s.recoilP, 0, rec);
    s.recoilY = approach(s.recoilY, 0, rec);
  }
  if (s.burstT > w.fireInterval * 1.1 && s.bloom > 0) s.bloom = Math.max(0, s.bloom - w.bloomDecay * dt);
}

/** Deterministic bullet direction inside the spread cone; identical on client and server. */
export function shotDirection(yaw: number, pitch: number, spreadDeg: number, playerId: number, shotSeq: number, out: Vec3): Vec3 {
  const u1 = hash01(playerId + 1, shotSeq, 101);
  const u2 = hash01(playerId + 1, shotSeq, 211);
  const ang = spreadDeg * DEG * Math.sqrt(u1);
  const rot = u2 * Math.PI * 2;
  const p = clamp(pitch + Math.sin(rot) * ang, -1.56, 1.56);
  const y = yaw + (Math.cos(rot) * ang) / Math.max(0.2, Math.cos(pitch));
  return dirFromAngles(y, p, out);
}
