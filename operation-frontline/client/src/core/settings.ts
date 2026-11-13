// Persistent player settings, key bindings, loadouts and profile (localStorage).
import { CLASSES, defaultLoadout, levelFromXp, sanitizeLoadout } from '@shared/classes';
import type { Loadout } from '@shared/weapons';

export type QualityLevel = 'minimal' | 'low' | 'medium' | 'high' | 'ultra';
export const QUALITY_LEVELS: QualityLevel[] = ['minimal', 'low', 'medium', 'high', 'ultra'];
export type RendererPref = 'auto' | 'webgl2';

export interface QualityPreset {
  pixelRatio: number;
  shadowRes: number;
  shadowDistance: number;
  cascades: number;
  ssao: boolean;
  bloom: boolean;
  msaa: number;
  particles: number;
  localLights: number;
  propDistance: number;
  anisotropy: number;
  renderScale: number;
  decals: number;
  shadows: boolean;
  /** Sky cubemap face size (pixels). */
  skyRes: number;
  /** Draw distance in metres (fog hides the cut-off). */
  farClip: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  minimal: { pixelRatio: 1, shadowRes: 512, shadowDistance: 30, cascades: 1, ssao: false, bloom: false, msaa: 1, particles: 0.25, localLights: 0, propDistance: 45, anisotropy: 1, renderScale: 0.6, decals: 24, shadows: false, skyRes: 128, farClip: 260 },
  low: { pixelRatio: 1, shadowRes: 1024, shadowDistance: 45, cascades: 1, ssao: false, bloom: false, msaa: 1, particles: 0.45, localLights: 0, propDistance: 70, anisotropy: 1, renderScale: 0.8, decals: 64, shadows: true, skyRes: 256, farClip: 380 },
  medium: { pixelRatio: 1, shadowRes: 2048, shadowDistance: 80, cascades: 2, ssao: false, bloom: true, msaa: 1, particles: 0.7, localLights: 24, propDistance: 110, anisotropy: 4, renderScale: 1, decals: 128, shadows: true, skyRes: 512, farClip: 600 },
  high: { pixelRatio: 1.5, shadowRes: 2048, shadowDistance: 110, cascades: 3, ssao: true, bloom: true, msaa: 4, particles: 1, localLights: 80, propDistance: 170, anisotropy: 8, renderScale: 1, decals: 256, shadows: true, skyRes: 512, farClip: 900 },
  ultra: { pixelRatio: 2, shadowRes: 4096, shadowDistance: 150, cascades: 4, ssao: true, bloom: true, msaa: 4, particles: 1.3, localLights: 120, propDistance: 260, anisotropy: 16, renderScale: 1, decals: 384, shadows: true, skyRes: 1024, farClip: 900 },
};

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint' | 'tacSprint' | 'reload' | 'use' | 'grenade'
  | 'primary' | 'secondary' | 'gadget1' | 'gadget2' | 'scoreboard' | 'map' | 'menu' | 'fire' | 'ads';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move Forward', back: 'Move Back', left: 'Strafe Left', right: 'Strafe Right', jump: 'Jump / Vehicle Brake', crouch: 'Crouch / Slide',
  sprint: 'Sprint', tacSprint: 'Tactical Sprint', reload: 'Reload', use: 'Interact / Enter Vehicle', grenade: 'Throw Grenade',
  primary: 'Primary Weapon', secondary: 'Sidearm', gadget1: 'Gadget 1', gadget2: 'Gadget 2', scoreboard: 'Scoreboard', map: 'Deploy Screen',
  menu: 'Pause Menu', fire: 'Fire', ads: 'Aim Down Sights',
};

export const DEFAULT_BINDINGS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'KeyC', sprint: 'ShiftLeft', tacSprint: 'KeyV',
  reload: 'KeyR', use: 'KeyE', grenade: 'KeyG', primary: 'Digit1', secondary: 'Digit2', gadget1: 'Digit3', gadget2: 'Digit4',
  scoreboard: 'Tab', map: 'KeyM', menu: 'Escape', fire: 'Mouse0', ads: 'Mouse2',
};

export interface Settings {
  name: string;
  quality: QualityLevel;
  renderer: RendererPref;
  adaptiveResolution: boolean;
  fov: number;
  sensitivity: number;
  adsSensitivity: number;
  touchSensitivity: number;
  invertY: boolean;
  toggleCrouch: boolean;
  toggleAds: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  showFps: boolean;
  crosshairColor: string;
  touchScale: number;
  touchLeftHanded: boolean;
  autoFire: boolean;
  bindings: Record<Action, string>;
  serverUrl: string;
}

export interface Profile {
  xp: number;
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  captures: number;
  headshots: number;
  bestScore: number;
  playSeconds: number;
}

const KEY_SETTINGS = 'frontline.settings.v1';
const KEY_PROFILE = 'frontline.profile.v1';
const KEY_LOADOUTS = 'frontline.loadouts.v1';

function isMobile(): boolean {
  return typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.matchMedia?.('(pointer: coarse)').matches));
}

export const IS_MOBILE = isMobile();

function defaultQuality(): QualityLevel {
  if (IS_MOBILE) return 'low';
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  if (cores >= 8 && mem >= 8) return 'high';
  return 'medium';
}

function callsign(): string {
  const a = ['Ghost', 'Viper', 'Raptor', 'Nomad', 'Echo', 'Saber', 'Havoc', 'Onyx'];
  return `${a[Math.floor(Math.random() * a.length)]}${Math.floor(100 + Math.random() * 900)}`;
}

export function defaultSettings(): Settings {
  return {
    name: callsign(), quality: defaultQuality(), renderer: 'auto', adaptiveResolution: true, fov: 80, sensitivity: 1, adsSensitivity: 0.8,
    touchSensitivity: 1, invertY: false, toggleCrouch: false, toggleAds: IS_MOBILE, masterVolume: 0.8, sfxVolume: 1, musicVolume: 0.5,
    showFps: false, crosshairColor: '#ffffff', touchScale: 1, touchLeftHanded: false, autoFire: false,
    bindings: { ...DEFAULT_BINDINGS }, serverUrl: '',
  };
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? ({ ...fallback, ...v } as T) : fallback;
  } catch { return fallback; }
}

function save(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable (private mode) */ }
}

export class Store {
  settings: Settings;
  profile: Profile;
  /** One loadout per class + the selected class. */
  loadouts: Loadout[];
  classId: number;
  private listeners = new Set<() => void>();

  constructor() {
    const d = defaultSettings();
    this.settings = load(KEY_SETTINGS, d);
    this.settings.bindings = { ...DEFAULT_BINDINGS, ...(this.settings.bindings ?? {}) };
    this.profile = load<Profile>(KEY_PROFILE, { xp: 0, matches: 0, wins: 0, kills: 0, deaths: 0, assists: 0, captures: 0, headshots: 0, bestScore: 0, playSeconds: 0 });
    const lo = load<{ classId: number; list: unknown[] }>(KEY_LOADOUTS, { classId: 0, list: [] });
    this.classId = CLASSES[lo.classId] ? lo.classId : 0;
    this.loadouts = CLASSES.map((c, i) => {
      const raw = lo.list?.[i];
      const l = raw ? sanitizeLoadout({ ...(raw as object), classId: c.index }, this.level) : defaultLoadout(c.index);
      return l.classId === c.index ? l : defaultLoadout(c.index);
    });
    if (!localStorage.getItem(KEY_SETTINGS)) save(KEY_SETTINGS, this.settings);
  }

  get level(): number { return levelFromXp(this.profile?.xp ?? 0); }
  get loadout(): Loadout { return this.loadouts[this.classId]; }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  saveSettings(): void { save(KEY_SETTINGS, this.settings); for (const l of this.listeners) l(); }
  saveProfile(): void { save(KEY_PROFILE, this.profile); }
  saveLoadouts(): void { save(KEY_LOADOUTS, { classId: this.classId, list: this.loadouts }); }

  setLoadout(l: Loadout): void {
    this.loadouts[l.classId] = sanitizeLoadout(l, this.level);
    this.classId = l.classId;
    this.saveLoadouts();
  }

  resetSettings(): void {
    const name = this.settings.name;
    this.settings = { ...defaultSettings(), name };
    this.saveSettings();
  }
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'M4', Mouse4: 'M5', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL',
    ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT', Space: 'SPACE', Escape: 'ESC', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    CapsLock: 'CAPS', Backquote: '`', Enter: 'ENTER', Tab: 'TAB',
  };
  return map[code] ?? code.toUpperCase();
}
