// Game tuning shared by client and server. All weapon/class names are original.

export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;
export const GRAVITY = 9.81;

export const TEAMS = {
  1: { name: 'ATLANTIC VANGUARD', short: 'VANGUARD', color: '#4fb3ff', hex: 0x4fb3ff },
  2: { name: 'ONYX LEGION', short: 'ONYX', color: '#ff5a4a', hex: 0xff5a4a },
};

export const RULES = {
  tickets: 400,
  bleedInterval: 3.0,       // seconds per ticket when enemy holds majority
  respawnDelay: 5,
  bleedOut: 12,             // downed -> dead
  spawnProtect: 2.0,
  roundEndDelay: 18,
  maxPerTeam: 16,
  squadSize: 4,
  reviveTime: 1.4,
  spotTime: 6,
  tankRespawn: 40,
  outOfBoundsTime: 8,
};

// Player movement
export const MOVE = {
  walk: 4.6, sprint: 7.1, crouch: 2.5, ads: 2.9, accel: 50, airAccel: 9, friction: 10,
  jump: 4.9, height: 1.8, crouchHeight: 1.15, radius: 0.34, step: 0.55,
  eye: 1.63, crouchEye: 1.05, slideSpeed: 9.5, slideTime: 0.85,
};

// Damage falloff: [d0 at r0, d1 at r1]
export const WEAPONS = {
  vk30: {
    id: 'vk30', name: 'VK-30', type: 'Assault Rifle', slot: 0, auto: true, rpm: 760,
    dmg: [25, 17], range: [12, 60], vel: 740, drag: 0.02, mag: 30, reserve: 150,
    reload: 2.25, reloadEmpty: 2.8, ads: 0.22, zoom: 1.45, optic: 'reddot',
    recoil: [0.42, 0.22], recoilRecover: 0.55, hip: 2.4, adsSpread: 0.08, moveSpread: 1.6,
    head: 1.9, limb: 0.9, sound: 'ar', tracer: 0.5,
  },
  rx9: {
    id: 'rx9', name: 'RX-9', type: 'Submachine Gun', slot: 0, auto: true, rpm: 900,
    dmg: [22, 12], range: [8, 32], vel: 430, drag: 0.04, mag: 32, reserve: 160,
    reload: 1.9, reloadEmpty: 2.4, ads: 0.17, zoom: 1.3, optic: 'holo',
    recoil: [0.30, 0.26], recoilRecover: 0.6, hip: 1.7, adsSpread: 0.12, moveSpread: 1.0,
    head: 1.7, limb: 0.9, sound: 'smg', tracer: 0.5,
  },
  hm250: {
    id: 'hm250', name: 'HM-250', type: 'Light Machine Gun', slot: 0, auto: true, rpm: 640,
    dmg: [26, 20], range: [15, 70], vel: 780, drag: 0.018, mag: 100, reserve: 300,
    reload: 4.6, reloadEmpty: 5.4, ads: 0.32, zoom: 2.0, optic: 'acog',
    recoil: [0.48, 0.30], recoilRecover: 0.5, hip: 3.4, adsSpread: 0.12, moveSpread: 2.2,
    head: 1.8, limb: 0.9, sound: 'lmg', tracer: 0.34,
  },
  sr338: {
    id: 'sr338', name: 'SR-338', type: 'Sniper Rifle', slot: 0, auto: false, bolt: true, rpm: 48,
    dmg: [96, 80], range: [40, 160], vel: 900, drag: 0.008, mag: 5, reserve: 30,
    reload: 3.1, reloadEmpty: 3.6, ads: 0.36, zoom: 6.5, optic: 'scope',
    recoil: [3.2, 0.6], recoilRecover: 0.25, hip: 7.0, adsSpread: 0.0, moveSpread: 4,
    head: 2.6, limb: 0.9, sound: 'sniper', tracer: 1,
  },
  p19: {
    id: 'p19', name: 'P-19', type: 'Sidearm', slot: 1, auto: false, rpm: 420,
    dmg: [26, 15], range: [10, 30], vel: 380, drag: 0.04, mag: 15, reserve: 60,
    reload: 1.5, reloadEmpty: 1.9, ads: 0.14, zoom: 1.2, optic: 'iron',
    recoil: [0.7, 0.3], recoilRecover: 0.7, hip: 1.6, adsSpread: 0.25, moveSpread: 0.8,
    head: 1.8, limb: 0.9, sound: 'pistol', tracer: 0,
  },
  // gadgets (projectile launchers)
  gl40: {
    id: 'gl40', name: 'GL-40 Launcher', type: 'Gadget', slot: 2, gadget: true, proj: 'gl', rpm: 30,
    mag: 1, reserve: 4, reload: 2.3, reloadEmpty: 2.3, ads: 0.25, zoom: 1.3, optic: 'iron',
    recoil: [2.5, 0.5], hip: 1.0, adsSpread: 0.2, sound: 'gl',
  },
  rpg: {
    id: 'rpg', name: 'AT-7 Rocket', type: 'Gadget', slot: 2, gadget: true, proj: 'rocket', rpm: 20,
    mag: 1, reserve: 3, reload: 3.4, reloadEmpty: 3.4, ads: 0.4, zoom: 1.6, optic: 'iron',
    recoil: [3, 1], hip: 1.0, adsSpread: 0.1, sound: 'rocket',
  },
  supply: { id: 'supply', name: 'Supply Crate', type: 'Gadget', slot: 2, gadget: true, deploy: 'crate', cooldown: 25 },
  beacon: { id: 'beacon', name: 'Spawn Beacon', type: 'Gadget', slot: 2, gadget: true, deploy: 'beacon', cooldown: 20 },
};

export const PROJECTILES = {
  gl: { speed: 72, gravity: 9.81, radius: 4.5, damage: 95, vehDamage: 90, panelDamage: 170, fuse: 0, arm: 0.04 },
  rocket: { speed: 92, gravity: 1.6, radius: 4.2, damage: 85, vehDamage: 340, panelDamage: 260, fuse: 0, arm: 0.02 },
  shell: { speed: 210, gravity: 4.5, radius: 5.5, damage: 140, vehDamage: 300, panelDamage: 330, fuse: 0, arm: 0 },
  frag: { speed: 17, gravity: 9.81, radius: 7.5, damage: 120, vehDamage: 40, panelDamage: 120, fuse: 3.0, bounce: 0.38 },
};

export const CLASSES = {
  assault: {
    id: 'assault', name: 'ASSAULT', desc: 'Front-line breacher. VK-30 rifle and GL-40 launcher to blow open walls.',
    primary: 'vk30', secondary: 'p19', gadget: 'gl40', grenades: 2, hp: 100, icon: '⨯',
  },
  engineer: {
    id: 'engineer', name: 'ENGINEER', desc: 'Anti-armor specialist. RX-9 SMG and AT-7 rockets that wreck tanks and cover.',
    primary: 'rx9', secondary: 'p19', gadget: 'rpg', grenades: 1, hp: 100, icon: '⚙',
  },
  support: {
    id: 'support', name: 'SUPPORT', desc: 'Keeps the squad fighting. HM-250 LMG, supply crates, fast revives.',
    primary: 'hm250', secondary: 'p19', gadget: 'supply', grenades: 2, hp: 100, icon: '✚',
  },
  recon: {
    id: 'recon', name: 'RECON', desc: 'Long-range eyes. SR-338 bolt-action and a squad spawn beacon. Spots last longer.',
    primary: 'sr338', secondary: 'p19', gadget: 'beacon', grenades: 1, hp: 100, icon: '◎',
  },
};
export const CLASS_LIST = ['assault', 'engineer', 'support', 'recon'];

export const TANK = {
  hp: 1000, maxFwd: 11.5, maxRev: 4.8, accel: 4.2, brake: 9, turn: 0.75, turretSpeed: 1.0,
  gunMin: -0.14, gunMax: 0.32, reload: 4.2, mgRpm: 700, mgDmg: 18, radius: 3.1, length: 7.2, width: 3.6,
  seatOffset: [0, 2.9, -0.6],
};

export const SCORE = {
  kill: 100, headshot: 25, assist: 50, capture: 250, neutralize: 150, captureTick: 10,
  revive: 100, resupply: 15, heal: 10, vehicle: 400, spot: 10, defend: 40, squadSpawn: 20,
};

export function falloff(w, d) {
  if (!w.dmg) return 0;
  if (d <= w.range[0]) return w.dmg[0];
  if (d >= w.range[1]) return w.dmg[1];
  const t = (d - w.range[0]) / (w.range[1] - w.range[0]);
  return w.dmg[0] + (w.dmg[1] - w.dmg[0]) * t;
}
