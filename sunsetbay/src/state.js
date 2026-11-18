// Shared mutable game state (imported by every gameplay module)
import { CFG } from './core.js';
export const clock = { t: 0, frame: 0 };
export const humans = [];     // Human instances (incl. player)
export const vehicles = [];   // Vehicle instances
export const pickups = [];
export const stats = { copsKilled: 0, stunts: 0 };
export const player = {
  h: null, car: null, x: 0, z: 0, hp: CFG.playerHP, armor: 0, money: 0, dead: false, busted: false, weapon: 1,
  owned: [true, true, false, false], ammo: [0, 48, 0, 0], mag: [0, 12, 0, 0], fireT: 0, reloadT: 0, vy: 0, aimHold: 0, noiseT: 0, hurtT: 0, grounded: true, collider: null, stepT: 0,
};
export const cam = { yaw: 0, pitch: 0.22, carMode: 0, look: 0, menuA: 0 };
export const wanted = { level: 0, points: 0, evade: 0, seenT: 0, seen: false, spawnT: 0, lockMin: 0 };
export const mission = { idx: 0, active: null, d: {}, timer: -1, target: null, extra: null, giverMarker: null, giverSprite: null, cool: 0, declined: false };
export const race = { countdown: 0, path: [], cp: 0, racers: [] };
export const flags = { running: false, paused: false, modal: false, timeScale: 1, firstRun: true };
export const input = { keys: {}, pressed: new Set(), mouse: { l: false, r: false, dragged: false }, joy: { x: 0, y: 0 }, touch: { fire: false, jump: false, sprint: false, jumpTap: false, weapTap: false }, locked: false };
export const WEAPONS = [
  { name: 'אגרופים', melee: true, dmg: 24, rate: 0.5 },
  { name: 'אקדח', dmg: 34, rate: 0.22, mag: 12, spread: 0.008, range: 140, snd: 'pistol' },
  { name: 'תת-מקלע', dmg: 20, rate: 0.085, mag: 30, spread: 0.022, range: 110, snd: 'smg', auto: true },
  { name: 'רובה ציד', dmg: 16, pellets: 9, rate: 0.9, mag: 6, spread: 0.065, range: 45, snd: 'shotgun' },
];
