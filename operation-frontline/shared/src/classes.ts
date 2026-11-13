// Soldier classes, gadgets and loadout validation.
import { type Loadout, WEAPON_BY_ID, defaultAttachments, sanitizeAttachments } from './weapons';

export type GadgetKind = 'stim' | 'smoke' | 'rocket' | 'repair' | 'ammoCrate' | 'medCrate' | 'sensor';

export interface GadgetDef {
  id: GadgetKind;
  name: string;
  desc: string;
  /** Uses carried on spawn (Infinity style tools use -1). */
  ammo: number;
  /** Seconds between uses. */
  cooldown: number;
  /** Seconds to bring the gadget up. */
  drawTime: number;
  /** 'hold' gadgets act continuously while fire is held. */
  hold: boolean;
}

export const GADGETS: Record<GadgetKind, GadgetDef> = {
  stim: { id: 'stim', name: 'Combat Stim', desc: 'Inject to restore 75 health over 3 seconds and refill tactical sprint.', ammo: 2, cooldown: 6, drawTime: 0.35, hold: false },
  smoke: { id: 'smoke', name: 'Smoke Grenade', desc: 'Thick smoke screen that blocks line of sight for 14 seconds.', ammo: 2, cooldown: 1.5, drawTime: 0.35, hold: false },
  rocket: { id: 'rocket', name: 'RPG-9 Launcher', desc: 'Unguided anti-vehicle rocket. Lethal splash against infantry.', ammo: 3, cooldown: 3.2, drawTime: 0.8, hold: false },
  repair: { id: 'repair', name: 'Repair Torch', desc: 'Hold to repair friendly vehicles or damage enemy ones up close.', ammo: -1, cooldown: 0, drawTime: 0.4, hold: true },
  ammoCrate: { id: 'ammoCrate', name: 'Ammo Crate', desc: 'Deploy a crate that resupplies ammunition and gadgets to nearby allies.', ammo: 1, cooldown: 12, drawTime: 0.4, hold: false },
  medCrate: { id: 'medCrate', name: 'Medical Crate', desc: 'Deploy a crate that heals nearby allies.', ammo: 1, cooldown: 12, drawTime: 0.4, hold: false },
  sensor: { id: 'sensor', name: 'Motion Sensor', desc: 'Throwable sensor that reveals enemies within 22 m on the team minimap.', ammo: 2, cooldown: 3, drawTime: 0.35, hold: false },
};

export interface ClassDef {
  index: number;
  id: 'assault' | 'engineer' | 'support' | 'recon';
  name: string;
  role: string;
  desc: string;
  primaries: readonly string[];
  secondaries: readonly string[];
  gadgets: readonly [GadgetKind, GadgetKind | null];
  grenades: number;
  /** Passive trait description shown in the UI. */
  trait: string;
  speedMul: number;
  /** Bot behaviour hints. */
  botRange: [number, number];
}

export const CLASSES: ClassDef[] = [
  {
    index: 0, id: 'assault', name: 'Assault', role: 'Frontline Combat',
    desc: 'Leads the push. Assault rifles, self-sustain and smoke to break into objectives.',
    primaries: ['kr7', 'mx4'], secondaries: ['p12'], gadgets: ['stim', 'smoke'], grenades: 2,
    trait: 'Breacher — captures objectives 15% faster and regenerates health sooner.',
    speedMul: 1.0, botRange: [6, 35],
  },
  {
    index: 1, id: 'engineer', name: 'Engineer', role: 'Vehicles & Anti-Armor',
    desc: 'Keeps friendly armour alive and enemy armour burning. Carbines and SMGs.',
    primaries: ['ac8', 'viper9'], secondaries: ['p12'], gadgets: ['rocket', 'repair'], grenades: 1,
    trait: 'Mechanic — takes 25% less explosive damage.',
    speedMul: 1.0, botRange: [5, 28],
  },
  {
    index: 2, id: 'support', name: 'Support', role: 'Sustained Fire & Resupply',
    desc: 'Anchors the squad with machine gun fire, ammunition and medical crates.',
    primaries: ['bulwark', 'ac8'], secondaries: ['p12'], gadgets: ['ammoCrate', 'medCrate'], grenades: 1,
    trait: 'Quartermaster — carries extra reserve ammunition.',
    speedMul: 0.97, botRange: [10, 45],
  },
  {
    index: 3, id: 'recon', name: 'Recon', role: 'Long Range & Intel',
    desc: 'Controls sightlines and feeds the team intel with sensors and spotting.',
    primaries: ['longbow', 'viper9'], secondaries: ['p12'], gadgets: ['sensor', null], grenades: 1,
    trait: 'Spotter — enemies you aim at through a scope are marked for your team.',
    speedMul: 1.02, botRange: [30, 110],
  },
];

export const CLASS_BY_ID: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.id, c]));

export function defaultLoadout(classId: number): Loadout {
  const c = CLASSES[classId] ?? CLASSES[0];
  const primary = WEAPON_BY_ID[c.primaries[0]];
  const secondary = WEAPON_BY_ID[c.secondaries[0]];
  return {
    classId: c.index,
    primary: primary.id,
    secondary: secondary.id,
    primaryAtt: sanitizeAttachments(primary, defaultAttachments()),
    secondaryAtt: sanitizeAttachments(secondary, defaultAttachments()),
  };
}

/** Server-side loadout validation: anything not allowed is replaced by the class default. */
export function sanitizeLoadout(raw: unknown, level = 99): Loadout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Loadout>;
  const classId = Number.isInteger(r.classId) && CLASSES[r.classId as number] ? (r.classId as number) : 0;
  const c = CLASSES[classId];
  const primaryId = typeof r.primary === 'string' && c.primaries.includes(r.primary) ? r.primary : c.primaries[0];
  const secondaryId = typeof r.secondary === 'string' && c.secondaries.includes(r.secondary) ? r.secondary : c.secondaries[0];
  return {
    classId,
    primary: primaryId,
    secondary: secondaryId,
    primaryAtt: sanitizeAttachments(WEAPON_BY_ID[primaryId], r.primaryAtt, level),
    secondaryAtt: sanitizeAttachments(WEAPON_BY_ID[secondaryId], r.secondaryAtt, level),
  };
}

/** XP → level curve used by the profile and for attachment unlocks. */
export function levelFromXp(xp: number): number {
  let level = 1;
  let need = 600;
  let left = xp;
  while (left >= need && level < 50) { left -= need; level++; need = Math.round(need * 1.12 + 150); }
  return level;
}

export function levelProgress(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let need = 600;
  let left = xp;
  while (left >= need && level < 50) { left -= need; level++; need = Math.round(need * 1.12 + 150); }
  return { level, into: left, need };
}

export const RANKS = ['Recruit', 'Private', 'Lance Corporal', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Lieutenant', 'Captain', 'Major', 'Colonel', 'Commander'];
export const rankName = (level: number): string => RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 3))];
