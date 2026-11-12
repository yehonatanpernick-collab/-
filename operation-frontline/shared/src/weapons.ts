// Weapon + attachment tables. Pure data: both the authoritative simulation and
// the client (prediction, UI, view models, audio) read from here.

export type WeaponClass = 'ar' | 'carbine' | 'smg' | 'lmg' | 'sniper' | 'pistol';
export type AttachmentSlot = 'optic' | 'muzzle' | 'grip' | 'mag' | 'barrel';
export const ATTACHMENT_SLOTS: readonly AttachmentSlot[] = ['optic', 'muzzle', 'grip', 'mag', 'barrel'];

export interface RecoilDef {
  /** Degrees of vertical climb per shot. */
  v: number;
  /** Degrees of horizontal kick amplitude per shot. */
  h: number;
  /** Horizontal bias per shot index (-1..1), repeats on the last entries. */
  pattern: readonly number[];
  /** Multiplier applied to the first shot of a burst. */
  first: number;
  /** Degrees per second the accumulated recoil recovers when not firing. */
  recover: number;
  /** Recoil multiplier while aiming down sights. */
  adsMult: number;
}

export interface WeaponDef {
  id: string;
  index: number;
  name: string;
  desc: string;
  cls: WeaponClass;
  slot: 0 | 1;
  damage: number;
  minDamage: number;
  headMult: number;
  legMult: number;
  /** Metres: full damage up to rangeStart, minDamage from rangeEnd. */
  rangeStart: number;
  rangeEnd: number;
  maxRange: number;
  rpm: number;
  auto: boolean;
  boltAction: boolean;
  magSize: number;
  reserve: number;
  reloadTime: number;
  reloadEmptyTime: number;
  adsTime: number;
  /** Zoom factor when aiming with iron sights (FOV divisor). */
  adsZoom: number;
  adsMoveFactor: number;
  moveFactor: number;
  drawTime: number;
  sprintOutTime: number;
  /** Cone half angles in degrees. */
  hipSpread: number;
  adsSpread: number;
  moveSpread: number;
  jumpSpread: number;
  bloomPerShot: number;
  bloomMax: number;
  bloomDecay: number;
  recoil: RecoilDef;
  /** m/s, used for tracer visuals (bullets are lag compensated hitscan). */
  velocity: number;
  /** Damage multiplier against vehicles. */
  vehicleMult: number;
  /** Audible range in metres (minimap ping + bot hearing). */
  loudness: number;
  allowed: Record<AttachmentSlot, readonly string[]>;
}

export interface AttachmentDef {
  id: string;
  slot: AttachmentSlot;
  name: string;
  desc: string;
  /** Player level required. */
  level: number;
  mods: Partial<WeaponMods>;
}

export interface WeaponMods {
  zoom: number;
  adsTimeMul: number;
  recoilVMul: number;
  recoilHMul: number;
  hipSpreadMul: number;
  adsSpreadMul: number;
  bloomMul: number;
  magSizeMul: number;
  reloadMul: number;
  rangeMul: number;
  damageMul: number;
  velocityMul: number;
  moveMul: number;
  drawMul: number;
  loudnessMul: number;
  suppressed: boolean;
  scope: boolean;
}

/** Final stats after attachments have been applied. */
export interface WeaponStats extends WeaponDef {
  zoom: number;
  suppressed: boolean;
  scope: boolean;
  fireInterval: number;
  attachments: Loadout['primaryAtt'];
}

export type AttachmentSet = Record<AttachmentSlot, string>;

export interface Loadout {
  classId: number;
  primary: string;
  secondary: string;
  primaryAtt: AttachmentSet;
  secondaryAtt: AttachmentSet;
}

const NONE: AttachmentSet = { optic: 'iron', muzzle: 'none', grip: 'none', mag: 'std', barrel: 'std' };
export const defaultAttachments = (): AttachmentSet => ({ ...NONE });

export const ATTACHMENTS: Record<string, AttachmentDef> = {};
function att(a: AttachmentDef): void { ATTACHMENTS[a.id] = a; }

att({ id: 'iron', slot: 'optic', name: 'Iron Sights', desc: 'Factory sights. Fastest handling.', level: 1, mods: {} });
att({ id: 'reddot', slot: 'optic', name: 'RX-1 Red Dot', desc: '1x reflex sight with a clean sight picture.', level: 1, mods: { zoom: 1.25, adsTimeMul: 1.03 } });
att({ id: 'holo', slot: 'optic', name: 'HX Holographic', desc: '1.5x holographic sight for mid-range fights.', level: 2, mods: { zoom: 1.5, adsTimeMul: 1.06 } });
att({ id: 'acog', slot: 'optic', name: 'TA-4 Combat Scope', desc: '4x magnified optic. Slower to aim.', level: 4, mods: { zoom: 4, adsTimeMul: 1.22, adsSpreadMul: 0.8, scope: true } });
att({ id: 'scope8', slot: 'optic', name: 'LR-8 Marksman Scope', desc: '8x long-range scope.', level: 1, mods: { zoom: 8, adsTimeMul: 1.15, adsSpreadMul: 0.6, scope: true } });
att({ id: 'scope12', slot: 'optic', name: 'LR-12 Ballistic Scope', desc: '12x extreme-range scope. Heavy.', level: 5, mods: { zoom: 12, adsTimeMul: 1.3, adsSpreadMul: 0.5, moveMul: 0.97, scope: true } });

att({ id: 'none', slot: 'muzzle', name: 'No Muzzle Device', desc: 'Standard crown.', level: 1, mods: {} });
att({ id: 'suppressor', slot: 'muzzle', name: 'Sound Suppressor', desc: 'Hides you from the minimap. Reduced range.', level: 3, mods: { suppressed: true, rangeMul: 0.85, velocityMul: 0.9, loudnessMul: 0.3, recoilVMul: 0.95 } });
att({ id: 'compensator', slot: 'muzzle', name: 'Compensator', desc: 'Less vertical recoil, slightly wider hip fire.', level: 2, mods: { recoilVMul: 0.82, hipSpreadMul: 1.1, loudnessMul: 1.1 } });
att({ id: 'flashhider', slot: 'muzzle', name: 'Muzzle Brake', desc: 'Tames horizontal recoil.', level: 5, mods: { recoilHMul: 0.75, bloomMul: 0.92 } });

att({ id: 'none_g', slot: 'grip', name: 'No Grip', desc: 'Bare handguard.', level: 1, mods: {} });
att({ id: 'vertical', slot: 'grip', name: 'Vertical Grip', desc: 'Improved recoil control. Slower ADS.', level: 2, mods: { recoilVMul: 0.88, recoilHMul: 0.9, adsTimeMul: 1.06 } });
att({ id: 'angled', slot: 'grip', name: 'Angled Grip', desc: 'Faster ADS and weapon swap.', level: 3, mods: { adsTimeMul: 0.86, drawMul: 0.9 } });
att({ id: 'stubby', slot: 'grip', name: 'Stubby Grip', desc: 'Tighter hip fire and less bloom.', level: 6, mods: { hipSpreadMul: 0.78, bloomMul: 0.85 } });

att({ id: 'std', slot: 'mag', name: 'Standard Magazine', desc: 'Factory magazine.', level: 1, mods: {} });
att({ id: 'extended', slot: 'mag', name: 'Extended Magazine', desc: '+40% capacity. Slower reload and ADS.', level: 3, mods: { magSizeMul: 1.4, reloadMul: 1.15, adsTimeMul: 1.05, moveMul: 0.98 } });
att({ id: 'fastmag', slot: 'mag', name: 'Quick-Pull Magazine', desc: '25% faster reloads.', level: 4, mods: { reloadMul: 0.75 } });

att({ id: 'std_b', slot: 'barrel', name: 'Standard Barrel', desc: 'Factory barrel.', level: 1, mods: {} });
att({ id: 'heavy', slot: 'barrel', name: 'Heavy Barrel', desc: 'Longer effective range, more weight.', level: 4, mods: { rangeMul: 1.25, velocityMul: 1.12, adsSpreadMul: 0.8, adsTimeMul: 1.1, moveMul: 0.97 } });
att({ id: 'short', slot: 'barrel', name: 'CQB Barrel', desc: 'Fast handling, shorter range.', level: 2, mods: { rangeMul: 0.8, adsTimeMul: 0.9, hipSpreadMul: 0.88, drawMul: 0.9, moveMul: 1.02 } });

const RIFLE_ATT: Record<AttachmentSlot, readonly string[]> = {
  optic: ['iron', 'reddot', 'holo', 'acog'],
  muzzle: ['none', 'suppressor', 'compensator', 'flashhider'],
  grip: ['none_g', 'vertical', 'angled', 'stubby'],
  mag: ['std', 'extended', 'fastmag'],
  barrel: ['std_b', 'heavy', 'short'],
};

export const WEAPONS: WeaponDef[] = [
  {
    id: 'kr7', index: 0, name: 'KR-7 Vanguard', cls: 'ar', slot: 0,
    desc: 'Balanced 5.56 assault rifle. Reliable at every range.',
    damage: 27, minDamage: 18, headMult: 1.9, legMult: 0.85, rangeStart: 28, rangeEnd: 70, maxRange: 260,
    rpm: 700, auto: true, boltAction: false, magSize: 30, reserve: 150, reloadTime: 2.2, reloadEmptyTime: 2.7,
    adsTime: 0.24, adsZoom: 1.2, adsMoveFactor: 0.6, moveFactor: 0.97, drawTime: 0.55, sprintOutTime: 0.2,
    hipSpread: 2.6, adsSpread: 0.16, moveSpread: 1.4, jumpSpread: 3.5, bloomPerShot: 0.16, bloomMax: 1.6, bloomDecay: 7,
    recoil: { v: 0.62, h: 0.26, pattern: [0, 0.2, -0.3, 0.5, 0.7, 0.4, -0.2, -0.7, -0.9, -0.4, 0.3, 0.8], first: 1.5, recover: 9, adsMult: 0.78 },
    velocity: 780, vehicleMult: 0.08, loudness: 75, allowed: RIFLE_ATT,
  },
  {
    id: 'mx4', index: 1, name: 'MX-4 Sentinel', cls: 'ar', slot: 0,
    desc: 'Hard-hitting 7.62 battle rifle. Slower fire rate, heavier recoil.',
    damage: 34, minDamage: 24, headMult: 1.9, legMult: 0.85, rangeStart: 38, rangeEnd: 90, maxRange: 300,
    rpm: 540, auto: true, boltAction: false, magSize: 24, reserve: 120, reloadTime: 2.5, reloadEmptyTime: 3.0,
    adsTime: 0.28, adsZoom: 1.2, adsMoveFactor: 0.55, moveFactor: 0.95, drawTime: 0.62, sprintOutTime: 0.23,
    hipSpread: 3.0, adsSpread: 0.12, moveSpread: 1.7, jumpSpread: 4, bloomPerShot: 0.2, bloomMax: 1.8, bloomDecay: 6,
    recoil: { v: 0.95, h: 0.22, pattern: [0, -0.3, -0.5, -0.2, 0.3, 0.6, 0.8, 0.3, -0.4, -0.8], first: 1.35, recover: 8, adsMult: 0.8 },
    velocity: 820, vehicleMult: 0.1, loudness: 85, allowed: RIFLE_ATT,
  },
  {
    id: 'ac8', index: 2, name: 'AC-8 Carbine', cls: 'carbine', slot: 0,
    desc: 'Compact carbine. Snappy handling for crews and close quarters.',
    damage: 25, minDamage: 15, headMult: 1.8, legMult: 0.85, rangeStart: 20, rangeEnd: 52, maxRange: 220,
    rpm: 770, auto: true, boltAction: false, magSize: 30, reserve: 150, reloadTime: 2.0, reloadEmptyTime: 2.45,
    adsTime: 0.2, adsZoom: 1.2, adsMoveFactor: 0.68, moveFactor: 1.0, drawTime: 0.45, sprintOutTime: 0.16,
    hipSpread: 2.2, adsSpread: 0.22, moveSpread: 1.1, jumpSpread: 3, bloomPerShot: 0.15, bloomMax: 1.5, bloomDecay: 8,
    recoil: { v: 0.58, h: 0.32, pattern: [0, 0.4, 0.6, 0.1, -0.5, -0.8, -0.3, 0.4, 0.9, 0.5, -0.2], first: 1.4, recover: 10, adsMult: 0.8 },
    velocity: 700, vehicleMult: 0.07, loudness: 70, allowed: RIFLE_ATT,
  },
  {
    id: 'viper9', index: 3, name: 'Viper-9', cls: 'smg', slot: 0,
    desc: '9mm submachine gun. Devastating up close, excellent hip fire.',
    damage: 21, minDamage: 11, headMult: 1.7, legMult: 0.9, rangeStart: 11, rangeEnd: 34, maxRange: 160,
    rpm: 920, auto: true, boltAction: false, magSize: 32, reserve: 192, reloadTime: 1.8, reloadEmptyTime: 2.2,
    adsTime: 0.17, adsZoom: 1.15, adsMoveFactor: 0.78, moveFactor: 1.03, drawTime: 0.38, sprintOutTime: 0.12,
    hipSpread: 1.7, adsSpread: 0.32, moveSpread: 0.7, jumpSpread: 2.2, bloomPerShot: 0.12, bloomMax: 1.4, bloomDecay: 9,
    recoil: { v: 0.44, h: 0.36, pattern: [0, 0.3, -0.4, 0.6, -0.6, 0.2, 0.7, -0.3, -0.7, 0.5], first: 1.3, recover: 12, adsMult: 0.85 },
    velocity: 420, vehicleMult: 0.04, loudness: 60,
    allowed: { ...RIFLE_ATT, optic: ['iron', 'reddot', 'holo'], barrel: ['std_b', 'short'] },
  },
  {
    id: 'bulwark', index: 4, name: 'HMG-88 Bulwark', cls: 'lmg', slot: 0,
    desc: 'Belt-fed light machine gun. Sustained suppressive fire; steadier when crouched.',
    damage: 30, minDamage: 22, headMult: 1.8, legMult: 0.85, rangeStart: 35, rangeEnd: 85, maxRange: 300,
    rpm: 640, auto: true, boltAction: false, magSize: 100, reserve: 200, reloadTime: 4.6, reloadEmptyTime: 5.2,
    adsTime: 0.42, adsZoom: 1.2, adsMoveFactor: 0.45, moveFactor: 0.9, drawTime: 0.85, sprintOutTime: 0.32,
    hipSpread: 3.6, adsSpread: 0.3, moveSpread: 2.2, jumpSpread: 5, bloomPerShot: 0.1, bloomMax: 1.3, bloomDecay: 5,
    recoil: { v: 0.5, h: 0.3, pattern: [0, 0.5, -0.5, 0.7, -0.7, 0.3, -0.3, 0.8, -0.8], first: 1.8, recover: 7, adsMult: 0.82 },
    velocity: 800, vehicleMult: 0.14, loudness: 90,
    allowed: { ...RIFLE_ATT, mag: ['std', 'extended'], barrel: ['std_b', 'heavy'] },
  },
  {
    id: 'longbow', index: 5, name: 'Longbow SR-762', cls: 'sniper', slot: 0,
    desc: 'Bolt-action 7.62 rifle. One shot to the head at any range.',
    damage: 92, minDamage: 78, headMult: 2.4, legMult: 0.75, rangeStart: 90, rangeEnd: 220, maxRange: 420,
    rpm: 44, auto: false, boltAction: true, magSize: 5, reserve: 35, reloadTime: 3.0, reloadEmptyTime: 3.4,
    adsTime: 0.36, adsZoom: 1.3, adsMoveFactor: 0.42, moveFactor: 0.95, drawTime: 0.75, sprintOutTime: 0.28,
    hipSpread: 5.5, adsSpread: 0.02, moveSpread: 2.5, jumpSpread: 6, bloomPerShot: 0.8, bloomMax: 1.5, bloomDecay: 3,
    recoil: { v: 3.4, h: 0.8, pattern: [0.3, -0.3], first: 1, recover: 6, adsMult: 0.9 },
    velocity: 880, vehicleMult: 0.2, loudness: 110,
    allowed: {
      optic: ['scope8', 'iron', 'acog', 'scope12'],
      muzzle: ['none', 'suppressor', 'flashhider'],
      grip: ['none_g'],
      mag: ['std', 'fastmag'],
      barrel: ['std_b', 'heavy'],
    },
  },
  {
    id: 'p12', index: 6, name: 'P-12 Service', cls: 'pistol', slot: 1,
    desc: 'Semi-automatic sidearm. Fast draw, always dependable.',
    damage: 30, minDamage: 15, headMult: 1.8, legMult: 0.9, rangeStart: 12, rangeEnd: 32, maxRange: 120,
    rpm: 400, auto: false, boltAction: false, magSize: 12, reserve: 48, reloadTime: 1.5, reloadEmptyTime: 1.8,
    adsTime: 0.14, adsZoom: 1.12, adsMoveFactor: 0.85, moveFactor: 1.05, drawTime: 0.3, sprintOutTime: 0.1,
    hipSpread: 1.5, adsSpread: 0.25, moveSpread: 0.6, jumpSpread: 2.5, bloomPerShot: 0.45, bloomMax: 2.2, bloomDecay: 9,
    recoil: { v: 1.5, h: 0.5, pattern: [0.2, -0.3, 0.4, -0.2], first: 1, recover: 14, adsMult: 0.85 },
    velocity: 380, vehicleMult: 0.03, loudness: 55,
    allowed: {
      optic: ['iron', 'reddot'],
      muzzle: ['none', 'suppressor', 'compensator'],
      grip: ['none_g'],
      mag: ['std', 'extended'],
      barrel: ['std_b'],
    },
  },
];

export const WEAPON_BY_ID: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

const statsCache = new Map<string, WeaponStats>();

/** Returns a sanitised attachment set that only contains attachments this weapon may mount. */
export function sanitizeAttachments(def: WeaponDef, set: Partial<AttachmentSet> | undefined, level = 99): AttachmentSet {
  const out = defaultAttachments();
  for (const slot of ATTACHMENT_SLOTS) {
    const allowed = def.allowed[slot];
    const wanted = set?.[slot];
    const ok = typeof wanted === 'string' && allowed.includes(wanted) && (ATTACHMENTS[wanted]?.level ?? 99) <= level;
    out[slot] = ok ? (wanted as string) : allowed[0];
  }
  return out;
}

export function resolveWeapon(id: string, attachments?: Partial<AttachmentSet>): WeaponStats {
  const def = WEAPON_BY_ID[id] ?? WEAPONS[0];
  const set = sanitizeAttachments(def, attachments);
  const key = `${def.id}|${ATTACHMENT_SLOTS.map((s) => set[s]).join(',')}`;
  const cached = statsCache.get(key);
  if (cached) return cached;

  const m: WeaponMods = {
    zoom: def.adsZoom, adsTimeMul: 1, recoilVMul: 1, recoilHMul: 1, hipSpreadMul: 1, adsSpreadMul: 1, bloomMul: 1,
    magSizeMul: 1, reloadMul: 1, rangeMul: 1, damageMul: 1, velocityMul: 1, moveMul: 1, drawMul: 1, loudnessMul: 1,
    suppressed: false, scope: false,
  };
  for (const slot of ATTACHMENT_SLOTS) {
    const mods = ATTACHMENTS[set[slot]]?.mods;
    if (!mods) continue;
    for (const k of Object.keys(mods) as (keyof WeaponMods)[]) {
      const v = mods[k];
      if (k === 'zoom') m.zoom = v as number;
      else if (k === 'suppressed' || k === 'scope') (m[k] as boolean) = (m[k] as boolean) || (v as boolean);
      else (m[k] as number) *= v as number;
    }
  }
  const stats: WeaponStats = {
    ...def,
    damage: def.damage * m.damageMul,
    minDamage: def.minDamage * m.damageMul,
    rangeStart: def.rangeStart * m.rangeMul,
    rangeEnd: def.rangeEnd * m.rangeMul,
    magSize: Math.round(def.magSize * m.magSizeMul),
    reloadTime: def.reloadTime * m.reloadMul,
    reloadEmptyTime: def.reloadEmptyTime * m.reloadMul,
    adsTime: def.adsTime * m.adsTimeMul,
    drawTime: def.drawTime * m.drawMul,
    moveFactor: def.moveFactor * m.moveMul,
    hipSpread: def.hipSpread * m.hipSpreadMul,
    adsSpread: def.adsSpread * m.adsSpreadMul,
    bloomPerShot: def.bloomPerShot * m.bloomMul,
    velocity: def.velocity * m.velocityMul,
    loudness: def.loudness * m.loudnessMul,
    recoil: { ...def.recoil, v: def.recoil.v * m.recoilVMul, h: def.recoil.h * m.recoilHMul },
    zoom: m.zoom,
    suppressed: m.suppressed,
    scope: m.scope,
    fireInterval: 60 / def.rpm,
    attachments: set,
  };
  statsCache.set(key, stats);
  return stats;
}

/** Damage at a distance, before body-part multipliers. */
export function damageAtRange(w: WeaponStats, dist: number): number {
  if (dist <= w.rangeStart) return w.damage;
  if (dist >= w.rangeEnd) return w.minDamage;
  const t = (dist - w.rangeStart) / (w.rangeEnd - w.rangeStart);
  return w.damage + (w.minDamage - w.damage) * t;
}
