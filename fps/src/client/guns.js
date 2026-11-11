// Procedural firearm models. Each gun is described as parts (geometry + material key +
// optional animated node). First-person builds individual meshes (animated mag/bolt,
// emissive optics); third-person merges per material and caches the result.
// Model space: muzzle toward -Z, y up, origin at the trigger/grip area.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

let MATS = null;
export function gunMaterials() {
  if (MATS) return MATS;
  MATS = {
    steel: new THREE.MeshStandardMaterial({ color: 0x26282a, metalness: 0.7, roughness: 0.42, envMapIntensity: 0.55 }),
    alu: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.45, roughness: 0.55, envMapIntensity: 0.45, side: THREE.DoubleSide }),
    poly: new THREE.MeshStandardMaterial({ color: 0x161615, metalness: 0.05, roughness: 0.78, envMapIntensity: 0.5 }),
    fde: new THREE.MeshStandardMaterial({ color: 0x9a8662, metalness: 0.05, roughness: 0.72, envMapIntensity: 0.6 }),
    od: new THREE.MeshStandardMaterial({ color: 0x4d4f3c, metalness: 0.05, roughness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, metalness: 0.4, roughness: 0.6, side: THREE.DoubleSide }),
    bright: new THREE.MeshStandardMaterial({ color: 0x8a8c8e, metalness: 0.9, roughness: 0.3, envMapIntensity: 0.7 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.95, roughness: 0.3 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x203048, metalness: 0.9, roughness: 0.02, envMapIntensity: 2.2, transparent: true, opacity: 0.45 }),
    red: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.5, 0.2), toneMapped: false, side: THREE.DoubleSide }),
    green: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 4, 0.8), toneMapped: false }),
    rocket: new THREE.MeshStandardMaterial({ color: 0x55603f, metalness: 0.2, roughness: 0.6 }),
    tube: new THREE.MeshStandardMaterial({ color: 0x4a5236, metalness: 0.25, roughness: 0.65 }),
  };
  return MATS;
}

let ROUND = true;
const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = Math.min(w, h, d); const g = ROUND && m > 0.014 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(0.006, m * 0.22)) : new THREE.BoxGeometry(w, h, d); if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz))); g.translate(x, y, z); return g; };
const cylZ = (r, len, x, y, z, seg = 14, r2 = r, open = false) => { const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, open); g.rotateX(Math.PI / 2); g.translate(x, y, z); return g; };
const cylX = (r, len, x, y, z, seg = 10) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return g; };
const torusZ = (r, t, x, y, z) => { const g = new THREE.TorusGeometry(r, t, 6, 20); g.translate(x, y, z); return g; };

function rail(parts, len, x, y, z, mat = 'alu') {
  parts.push([box(0.022, 0.008, len, x, y, z), mat]);
  for (let k = 0; k < len / 0.012 - 1; k += 1.0) parts.push([box(0.024, 0.004, 0.006, x, y + 0.005, z - len / 2 + 0.008 + k * 0.012), mat, null, true]);
}
function mag(parts, x, y, z, h, curve, mat, node = 'mag', w = 0.026, d = 0.06) {
  const segs = 5;
  for (let s = 0; s < segs; s++) {
    const t = s / segs;
    parts.push([box(w, h / segs + 0.002, d, x, y - t * h - h / segs / 2, z - t * t * curve, curve * 1.4 * t), mat, node]);
  }
  parts.push([box(w + 0.006, 0.012, d + 0.008, x, y - h - 0.004, z - curve, curve * 1.4), 'poly', node]);
}

function defs(id) {
  const P = [];
  let meta = { sightY: 0.075, sightZ: 0.0, muzzle: [0, 0.035, -0.62], eject: [0.03, 0.04, -0.05], hip: [0.15, -0.165, -0.44], ads: [0, 0, -0.36], len: 0.8, recoilZ: 0.05 };
  if (id === 'vk30') {
    // receiver
    P.push([box(0.05, 0.065, 0.3, 0, 0.03, -0.05), 'alu']);
    P.push([box(0.052, 0.022, 0.3, 0, 0.074, -0.05), 'alu']);
    P.push([box(0.012, 0.02, 0.05, 0.03, 0.045, -0.06), 'dark']); // ejection port
    P.push([box(0.01, 0.012, 0.03, 0.031, 0.045, -0.02), 'bright', 'bolt']);
    P.push([box(0.02, 0.015, 0.04, 0, 0.07, 0.11), 'steel']); // charging handle
    P.push([box(0.05, 0.008, 0.012, 0, 0.072, 0.13), 'steel']);
    rail(P, 0.28, 0, 0.088, -0.06);
    // handguard
    P.push([box(0.056, 0.058, 0.32, 0, 0.035, -0.36), 'alu']);
    for (let k = 0; k < 5; k++) for (const s of [-1, 1]) P.push([box(0.004, 0.012, 0.035, s * 0.029, 0.03, -0.25 - k * 0.055), 'dark', null, true]);
    rail(P, 0.26, 0, 0.068, -0.37);
    P.push([box(0.024, 0.006, 0.12, 0, -0.0, -0.4), 'alu']);
    // barrel + muzzle brake + front sight block
    P.push([cylZ(0.0105, 0.22, 0, 0.035, -0.62), 'steel']);
    P.push([cylZ(0.017, 0.07, 0, 0.035, -0.74, 8), 'steel']);
    for (let k = 0; k < 3; k++) P.push([box(0.036, 0.006, 0.008, 0, 0.035, -0.725 - k * 0.018), 'dark', null, true]);
    P.push([cylZ(0.013, 0.03, 0, 0.035, -0.54), 'steel']);
    // pistol grip, trigger guard, trigger
    P.push([box(0.034, 0.1, 0.045, 0, -0.04, 0.05, -0.32), 'fde']);
    for (let k = 0; k < 3; k++) P.push([box(0.036, 0.006, 0.04, 0, -0.02 - k * 0.025, 0.055 + k * 0.008, -0.32), 'dark', null, true]);
    P.push([box(0.008, 0.006, 0.07, 0, -0.01, -0.0), 'alu']);
    P.push([box(0.006, 0.025, 0.006, 0, 0.0, -0.01, 0.3), 'steel']);
    // mag well + curved mag
    P.push([box(0.04, 0.03, 0.07, 0, -0.008, -0.1), 'alu']);
    mag(P, 0, -0.02, -0.1, 0.17, 0.05, 'fde');
    // stock: buffer tube + adjustable stock
    P.push([cylZ(0.017, 0.2, 0, 0.045, 0.17), 'alu']);
    P.push([box(0.042, 0.075, 0.12, 0, 0.03, 0.28), 'fde']);
    P.push([box(0.044, 0.105, 0.02, 0, 0.02, 0.345), 'dark']);
    P.push([box(0.02, 0.025, 0.08, 0, 0.068, 0.27), 'fde']); // cheek riser
    // angled foregrip
    P.push([box(0.028, 0.05, 0.05, 0, -0.022, -0.42, 0.5), 'fde']);
    // laser/light box
    P.push([box(0.03, 0.025, 0.06, 0.035, 0.04, -0.47), 'poly']);
    P.push([cylZ(0.008, 0.01, 0.035, 0.045, -0.502), 'lens']);
    meta = { ...meta, sightY: 0.123, muzzle: [0, 0.035, -0.79], len: 0.9, optic: 'reddot', opticZ: -0.06, hand2: [0, -0.02, -0.4] };
    optic(P, 'reddot', 0.088, -0.06);
  } else if (id === 'rx9') {
    P.push([box(0.048, 0.07, 0.24, 0, 0.03, -0.06), 'poly']);
    P.push([box(0.05, 0.02, 0.24, 0, 0.074, -0.06), 'alu']);
    P.push([box(0.01, 0.02, 0.04, 0.026, 0.045, -0.06), 'dark']);
    P.push([box(0.008, 0.012, 0.025, 0.028, 0.045, -0.03), 'bright', 'bolt']);
    rail(P, 0.22, 0, 0.088, -0.07);
    P.push([box(0.05, 0.05, 0.16, 0, 0.032, -0.26), 'poly']);
    for (let k = 0; k < 4; k++) P.push([box(0.052, 0.01, 0.02, 0, 0.032, -0.2 - k * 0.035), 'dark', null, true]);
    P.push([cylZ(0.024, 0.16, 0, 0.035, -0.42), 'steel']); // integrated suppressor
    for (let k = 0; k < 5; k++) P.push([cylZ(0.0245, 0.004, 0, 0.035, -0.36 - k * 0.025), 'alu', null, true]);
    P.push([box(0.032, 0.095, 0.042, 0, -0.04, 0.04, -0.25), 'poly']);
    P.push([box(0.008, 0.006, 0.06, 0, -0.01, -0.0), 'poly']);
    P.push([box(0.006, 0.022, 0.006, 0, 0.0, -0.01, 0.3), 'steel']);
    mag(P, 0, -0.005, -0.09, 0.16, 0.01, 'poly', 'mag', 0.022, 0.032);
    P.push([box(0.02, 0.02, 0.18, 0, 0.05, 0.14), 'steel']); // folding stock arm
    P.push([box(0.04, 0.09, 0.025, 0, 0.015, 0.23), 'poly']);
    P.push([box(0.028, 0.055, 0.04, 0, -0.018, -0.25, 0.1), 'poly']);
    meta = { ...meta, sightY: 0.128, muzzle: [0, 0.035, -0.5], len: 0.65, optic: 'holo', opticZ: -0.05, hip: [0.14, -0.155, -0.4], ads: [0, 0, -0.33], hand2: [0, -0.02, -0.25] };
    optic(P, 'holo', 0.088, -0.05);
  } else if (id === 'hm250') {
    P.push([box(0.07, 0.08, 0.36, 0, 0.03, -0.05), 'steel']);
    P.push([box(0.075, 0.03, 0.22, 0, 0.085, -0.02), 'alu', 'bolt']); // feed cover
    P.push([box(0.012, 0.025, 0.06, 0.037, 0.04, -0.05), 'dark']);
    rail(P, 0.2, 0, 0.104, -0.04);
    P.push([box(0.06, 0.062, 0.3, 0, 0.035, -0.38), 'alu']);
    for (let k = 0; k < 6; k++) P.push([box(0.064, 0.016, 0.022, 0, 0.035, -0.26 - k * 0.04), 'dark', null, true]);
    P.push([cylZ(0.014, 0.36, 0, 0.035, -0.7), 'steel']);
    P.push([cylZ(0.02, 0.06, 0, 0.035, -0.9, 8), 'steel']);
    P.push([box(0.012, 0.05, 0.012, 0, 0.065, -0.85), 'steel']); // front post
    P.push([box(0.012, 0.2, 0.012, 0.015, -0.08, -0.55, 0.15), 'steel']); // bipod legs folded
    P.push([box(0.012, 0.2, 0.012, -0.015, -0.08, -0.55, 0.15), 'steel']);
    P.push([box(0.036, 0.1, 0.045, 0, -0.04, 0.06, -0.3), 'poly']);
    P.push([box(0.008, 0.006, 0.07, 0, -0.01, 0.01), 'steel']);
    // box mag + belt
    P.push([box(0.1, 0.12, 0.12, -0.03, -0.05, -0.09), 'od', 'mag']);
    P.push([box(0.102, 0.02, 0.122, -0.03, 0.005, -0.09), 'poly', 'mag']);
    for (let k = 0; k < 4; k++) P.push([box(0.012, 0.012, 0.03, 0.04 + k * 0.004, 0.06 - k * 0.012, -0.07), 'brass', 'mag', true]);
    P.push([box(0.045, 0.08, 0.2, 0, 0.03, 0.24), 'poly']);
    P.push([box(0.048, 0.11, 0.02, 0, 0.02, 0.34), 'dark']);
    P.push([box(0.03, 0.06, 0.05, 0, -0.025, -0.4, 0.2), 'poly']);
    meta = { ...meta, sightY: 0.145, muzzle: [0, 0.035, -0.94], len: 1.0, optic: 'acog', opticZ: -0.02, hip: [0.16, -0.18, -0.46], ads: [0, 0, -0.34], hand2: [0, -0.02, -0.4], recoilZ: 0.06 };
    optic(P, 'acog', 0.104, -0.02);
  } else if (id === 'sr338') {
    P.push([box(0.05, 0.065, 0.28, 0, 0.03, -0.06), 'steel']);
    P.push([cylZ(0.018, 0.2, 0, 0.055, -0.02), 'steel']);
    P.push([cylX(0.007, 0.06, 0.04, 0.055, 0.04), 'bright', 'bolt']); // bolt handle
    P.push([new THREE.SphereGeometry(0.012, 8, 6).translate(0.072, 0.055, 0.04), 'bright', 'bolt']);
    P.push([box(0.064, 0.075, 0.46, 0, 0.0, -0.18), 'fde']); // chassis/stock fore
    P.push([cylZ(0.013, 0.56, 0, 0.04, -0.68), 'steel']);
    P.push([cylZ(0.022, 0.09, 0, 0.04, -1.0, 8), 'steel']);
    for (let k = 0; k < 4; k++) P.push([box(0.046, 0.008, 0.01, 0, 0.04, -0.97 - k * 0.018), 'dark', null, true]);
    P.push([box(0.036, 0.11, 0.05, 0, -0.06, 0.06, -0.25), 'fde']);
    P.push([box(0.05, 0.09, 0.32, 0, 0.0, 0.25), 'fde']);
    P.push([box(0.052, 0.14, 0.02, 0, -0.01, 0.41), 'dark']);
    P.push([box(0.03, 0.03, 0.14, 0, 0.06, 0.24), 'fde']);
    P.push([box(0.008, 0.006, 0.07, 0, -0.035, -0.0), 'steel']);
    mag(P, 0, -0.03, -0.1, 0.07, 0, 'poly', 'mag', 0.032, 0.07);
    meta = { ...meta, sightY: 0.125, muzzle: [0, 0.04, -1.05], len: 1.2, optic: 'scope', opticZ: -0.05, hip: [0.16, -0.18, -0.48], ads: [0, 0, -0.3], hand2: [0, -0.03, -0.38], recoilZ: 0.09 };
    optic(P, 'scope', 0.078, -0.05);
  } else if (id === 'p19') {
    P.push([box(0.03, 0.035, 0.19, 0, 0.055, -0.07), 'steel', 'bolt']); // slide
    for (let k = 0; k < 6; k++) P.push([box(0.031, 0.025, 0.004, 0, 0.055, 0.0 - k * 0.008), 'dark', null, true]);
    P.push([box(0.012, 0.016, 0.006, 0, 0.078, -0.155), 'steel']);
    P.push([box(0.02, 0.012, 0.008, 0, 0.078, 0.015), 'steel']);
    P.push([box(0.028, 0.025, 0.17, 0, 0.025, -0.07), 'poly']);
    P.push([box(0.03, 0.11, 0.045, 0, -0.035, 0.01, -0.22), 'poly']);
    P.push([box(0.006, 0.006, 0.05, 0, 0.005, -0.03), 'poly']);
    P.push([box(0.005, 0.02, 0.005, 0, 0.012, -0.03, 0.3), 'steel']);
    mag(P, 0, -0.07, 0.02, 0.03, 0, 'poly', 'mag', 0.024, 0.04);
    P.push([box(0.006, 0.004, 0.006, 0, 0.068, -0.157), 'green']);
    meta = { ...meta, sightY: 0.083, muzzle: [0, 0.055, -0.17], len: 0.22, optic: 'iron', opticZ: 0, hip: [0.12, -0.14, -0.38], ads: [0, 0, -0.36], hand2: [0, -0.03, -0.0], recoilZ: 0.04, pistol: true };
  } else if (id === 'gl40') {
    P.push([cylZ(0.024, 0.32, 0, 0.03, -0.2, 16), 'od']);
    P.push([cylZ(0.028, 0.03, 0, 0.03, -0.36), 'steel']);
    P.push([cylZ(0.026, 0.06, 0, 0.03, -0.02), 'steel', 'mag']);
    P.push([box(0.034, 0.1, 0.045, 0, -0.04, 0.06, -0.3), 'poly']);
    P.push([box(0.035, 0.06, 0.2, 0, 0.0, 0.15), 'poly']);
    P.push([box(0.045, 0.1, 0.02, 0, -0.005, 0.25), 'dark']);
    P.push([box(0.006, 0.05, 0.03, 0, 0.075, -0.08), 'steel']); // ladder sight
    P.push([box(0.03, 0.05, 0.05, 0, -0.01, -0.25, 0.4), 'poly']);
    meta = { ...meta, sightY: 0.1, muzzle: [0, 0.03, -0.38], len: 0.5, optic: 'iron', hip: [0.15, -0.16, -0.42], ads: [0, 0, -0.36], hand2: [0, -0.02, -0.25] };
  } else if (id === 'rpg') {
    P.push([cylZ(0.042, 1.0, 0, 0.0, -0.1, 18), 'tube']);
    P.push([cylZ(0.05, 0.08, 0, 0.0, 0.42, 18, 0.06), 'tube']);
    P.push([cylZ(0.046, 0.04, 0, 0.0, -0.6), 'dark']);
    P.push([box(0.034, 0.1, 0.045, 0, -0.09, 0.05, -0.3), 'poly']);
    P.push([box(0.034, 0.09, 0.045, 0, -0.09, -0.25, 0.1), 'poly']);
    P.push([box(0.04, 0.06, 0.1, -0.06, 0.04, -0.1), 'dark']); // optic
    P.push([cylZ(0.016, 0.02, -0.06, 0.05, -0.16), 'lens']);
    // rocket warhead
    P.push([cylZ(0.05, 0.12, 0, 0, -0.66, 14, 0.04), 'rocket', 'mag']);
    P.push([new THREE.ConeGeometry(0.05, 0.16, 14).rotateX(-Math.PI / 2).translate(0, 0, -0.8), 'rocket', 'mag']);
    meta = { ...meta, sightY: 0.05, sightX: -0.06, muzzle: [0, 0, -0.85], len: 1.1, optic: 'iron', hip: [0.14, -0.1, -0.4], ads: [0.06, -0.01, -0.36], hand2: [0, -0.06, -0.25], shoulder: true };
  } else if (id === 'supply' || id === 'beacon') {
    if (id === 'supply') {
      P.push([box(0.3, 0.2, 0.18, 0, -0.04, -0.12), 'od']);
      P.push([box(0.31, 0.03, 0.19, 0, 0.06, -0.12), 'poly']);
      P.push([box(0.1, 0.1, 0.01, 0, -0.04, -0.215), 'red']);
      P.push([box(0.12, 0.02, 0.03, 0, 0.09, -0.12), 'dark']);
    } else {
      P.push([box(0.12, 0.18, 0.08, 0, -0.02, -0.12), 'od']);
      P.push([cylZ(0.006, 0.3, 0, 0.12, -0.12, 4), 'dark']);
      P.push([new THREE.SphereGeometry(0.012, 8, 6).translate(0, 0.08, -0.165), 'red']);
    }
    meta = { ...meta, sightY: 0.0, muzzle: [0, 0, -0.2], len: 0.3, optic: 'none', hip: [0.12, -0.15, -0.36], ads: [0.12, -0.15, -0.36], hand2: [0, -0.05, -0.12], deploy: true };
  }
  return { parts: P, meta };
}

function optic(P, type, railY, z) {
  if (type === 'reddot') {
    P.push([box(0.03, 0.012, 0.05, 0, railY + 0.012, z), 'alu']);
    P.push([cylZ(0.019, 0.075, 0, railY + 0.035, z, 18, 0.019, true), 'alu']);
    P.push([cylZ(0.0185, 0.075, 0, railY + 0.035, z, 18, 0.0185, true), 'dark']);
    P.push([torusZ(0.019, 0.004, 0, railY + 0.035, z - 0.038), 'alu']);
    P.push([cylZ(0.0165, 0.002, 0, railY + 0.035, z - 0.033), 'lens']);
    P.push([new THREE.CircleGeometry(0.0011, 10).translate(0, railY + 0.035, z - 0.03), 'red', 'reticle']);
    P.push([box(0.012, 0.012, 0.012, 0.022, railY + 0.035, z + 0.005), 'alu']);
  } else if (type === 'holo') {
    P.push([box(0.04, 0.012, 0.1, 0, railY + 0.012, z), 'poly']);
    P.push([box(0.004, 0.045, 0.06, 0.022, railY + 0.04, z - 0.02), 'poly']);
    P.push([box(0.004, 0.045, 0.06, -0.022, railY + 0.04, z - 0.02), 'poly']);
    P.push([box(0.048, 0.005, 0.06, 0, railY + 0.064, z - 0.02), 'poly']);
    P.push([box(0.04, 0.035, 0.002, 0, railY + 0.04, z - 0.045), 'lens']);
    const ring = new THREE.RingGeometry(0.0055, 0.0065, 24); ring.translate(0, railY + 0.04, z - 0.044);
    P.push([ring, 'red', 'reticle']);
    P.push([new THREE.CircleGeometry(0.0008, 8).translate(0, railY + 0.04, z - 0.044), 'red', 'reticle']);
  } else if (type === 'acog') {
    P.push([box(0.03, 0.015, 0.07, 0, railY + 0.012, z), 'alu']);
    P.push([cylZ(0.017, 0.11, 0, railY + 0.041, z, 16, 0.017, true), 'alu']);
    P.push([cylZ(0.024, 0.035, 0, railY + 0.041, z - 0.07, 18, 0.017, true), 'alu']);
    P.push([cylZ(0.022, 0.002, 0, railY + 0.041, z - 0.086), 'lens']);
    P.push([cylZ(0.015, 0.002, 0, railY + 0.041, z + 0.054), 'lens']);
    const chev = new THREE.BufferGeometry();
    chev.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.0012, 0, -0.0012, -0.001, 0, 0.0012, -0.001, 0], 3));
    chev.computeVertexNormals(); chev.translate(0, railY + 0.041, z + 0.05);
    P.push([chev, 'red', 'reticle']);
    P.push([box(0.012, 0.016, 0.03, 0, railY + 0.066, z - 0.01), 'alu']); // mini RDS mount
  } else if (type === 'scope') {
    P.push([box(0.034, 0.025, 0.04, 0, railY + 0.012, z - 0.05), 'alu']);
    P.push([box(0.034, 0.025, 0.04, 0, railY + 0.012, z + 0.06), 'alu']);
    P.push([cylZ(0.016, 0.28, 0, railY + 0.047, z, 18), 'alu']);
    P.push([cylZ(0.027, 0.08, 0, railY + 0.047, z - 0.17, 20, 0.016), 'alu']);
    P.push([cylZ(0.021, 0.06, 0, railY + 0.047, z + 0.16, 18, 0.017), 'alu']);
    P.push([cylZ(0.025, 0.002, 0, railY + 0.047, z - 0.211), 'lens']);
    P.push([cylZ(0.018, 0.002, 0, railY + 0.047, z + 0.191), 'lens']);
    P.push([cylZ(0.009, 0.03, 0, railY + 0.07, z), 'alu']);
    P.push([cylX(0.009, 0.04, 0.025, railY + 0.047, z), 'alu']);
  }
}

export function gunMeta(id) { return defs(id).meta; }

const TP_CACHE = {};
export function buildGun(id, mode = 'fp') {
  const M = gunMaterials();
  if (mode === 'tp') {
    if (!TP_CACHE[id]) {
      ROUND = false;
      const { parts, meta } = defs(id);
      ROUND = true;
      const byMat = {};
      for (const [g, m, , tiny] of parts) { if (tiny) continue; (byMat[m] = byMat[m] || []).push(g.index ? g.toNonIndexed() : g); }
      TP_CACHE[id] = { meta, list: Object.entries(byMat).map(([m, gs]) => [mergeGeometries(gs.map((g) => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.attributes.normal) g.computeVertexNormals(); return g; })), M[m]]) };
    }
    const grp = new THREE.Group();
    for (const [g, m] of TP_CACHE[id].list) grp.add(new THREE.Mesh(g, m));
    grp.userData.meta = TP_CACHE[id].meta;
    return grp;
  }
  const { parts, meta } = defs(id);
  const grp = new THREE.Group();
  const nodes = {};
  for (const [g, m, node] of parts) {
    const mesh = new THREE.Mesh(g, M[m]);
    if (node) {
      if (!nodes[node]) { nodes[node] = new THREE.Group(); grp.add(nodes[node]); }
      nodes[node].add(mesh);
    } else grp.add(mesh);
  }
  grp.userData.meta = meta;
  grp.userData.nodes = nodes;
  return grp;
}
