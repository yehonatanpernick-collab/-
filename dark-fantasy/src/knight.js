// ============================================================
//  The Knight — articulated plate harness, longsword, cloth cape
// ============================================================
import * as THREE from 'three';
import { lathe, frontLathe, scaleXZ, tube, taperTube, shell, rounded, mesh, joint, mapVerts, scaleUV, mergeGeometries, ni } from './geo.js';
import { pbr } from './texgen.js';
import { G } from './engine.js';

export function knightMaterials(baker, variant) {
  const steel = baker.bake('steel', { normal: 2.5 });
  const gold = baker.bake('gold', { normal: 7 });
  const leather = baker.bake('leather', { normal: 5 });
  const cloth = baker.bake('cloth', { normal: 3 });
  const chain = baker.bake('chain', { normal: 9, ao: 4 });
  const emblem = baker.bake('emblem', { normal: 3 });
  const side = THREE.DoubleSide;
  const out = {
    plate: pbr(steel, { physical: true, color: 0x6e727c, repeat: [2, 2], clearcoat: 0.25, clearcoatRoughness: 0.35, side, env: 1.2 }),
    bright: pbr(steel, { physical: true, color: 0xc4c8d0, repeat: [3, 3], roughness: 0.7, clearcoat: 0.4, clearcoatRoughness: 0.2, side, env: 1.4 }),
    dark: pbr(steel, { physical: true, color: 0x2c2d33, repeat: [2, 2], clearcoat: 0.2, side, env: 1.0 }),
    gold: pbr(gold, { physical: true, repeat: [2, 1], side, env: 1.3 }),
    leather: pbr(leather, { repeat: [2, 2], metalness: 0, side }),
    cloth: pbr(cloth, { physical: true, color: 0x4a070c, repeat: [3, 3], metalness: 0, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.6, 0.15, 0.15), side }),
    chain: pbr(chain, { color: 0x8c8e96, repeat: [4, 2], side, env: 1.2 }),
    tabard: pbr(emblem, { physical: true, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color(0.5, 0.2, 0.2), side }),
    black: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 2.2, 0.6) }),
    rune: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.3, 0.35) }),
  };
  if (variant === 'dark') {
    out.plate.color.set(0x15141c); out.bright.color.set(0x3a3448); out.dark.color.set(0x0a0a0e);
    out.gold.color.set(0x7a50c0); out.cloth.color.set(0x14061e); out.tabard.color.set(0x302040);
    out.eye.color.setRGB(3, 1.2, 7); out.rune.color.setRGB(2.5, 0.8, 6);
  }
  return out;
}

// ------------------------------------------------------------
function buildSword(M) {
  const g = new THREE.Group();
  // blade: lozenge cross-section with a fuller, tapering to a point (built along +z)
  const L = 0.98, W = 0.026, T = 0.0065, rings = 40;
  const sec = (w, t, f) => [[w, 0], [w * 0.42, t], [0.12 * w, t * (1 - f)], [-0.12 * w, t * (1 - f)], [-w * 0.42, t], [-w, 0], [-w * 0.42, -t], [-0.12 * w, -t * (1 - f)], [0.12 * w, -t * (1 - f)], [w * 0.42, -t]];
  const pos = [], idx = [];
  const S = 10;
  for (let i = 0; i <= rings; i++) {
    const v = i / rings;
    const z = v * L;
    let w = W * (1 - 0.35 * v);
    if (v > 0.82) w *= Math.sqrt(Math.max(0, 1 - (v - 0.82) / 0.18)) * 0.98 + 0.002;
    const f = v < 0.72 ? 0.75 : Math.max(0, 0.75 * (1 - (v - 0.72) / 0.14));
    const t = T * (1 - 0.4 * v) + 0.0006;
    for (const [x, y] of sec(w, t, f)) pos.push(x, y, z);
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < S; j++) {
    const a = i * S + j, b = i * S + ((j + 1) % S), c = (i + 1) * S + j, d = (i + 1) * S + ((j + 1) % S);
    idx.push(a, c, b, b, c, d);
  }
  let bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bg.setIndex(idx);
  bg = bg.toNonIndexed();
  bg.computeVertexNormals();
  const uv = []; const p = bg.attributes.position;
  for (let i = 0; i < p.count; i++) uv.push(p.getX(i) * 8 + 0.5, p.getZ(i) * 2);
  bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  bg.translate(0, 0, 0.06);
  const blade = mesh(bg, M.bright, g);
  // glowing rune inlay in the fuller
  const rune = mesh(new THREE.BoxGeometry(0.004, 0.0135, 0.6), M.rune, g, 0, 0, 0.42, { cast: false });
  // cross guard (curved quillons with finials)
  const guard = mesh(taperTube([[-0.13, 0, -0.035], [-0.07, 0, -0.005], [0, 0, 0.02], [0.07, 0, -0.005], [0.13, 0, -0.035]], (t) => 0.011 * (1 - 0.5 * Math.abs(t - 0.5)) + 0.004, 24, 8), M.dark, g, 0, 0, 0.04);
  for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(0.016, 12, 8), M.gold, g, sx * 0.132, 0, 0.004);
  mesh(rounded(0.05, 0.03, 0.035, 0.008), M.dark, g, 0, 0, 0.055);
  // grip with wire wrap
  const grip = mesh(new THREE.CylinderGeometry(0.0155, 0.0175, 0.2, 12), M.leather, g, 0, 0, -0.06, { rx: Math.PI / 2 });
  for (let i = 0; i < 9; i++) mesh(new THREE.TorusGeometry(0.0168, 0.0022, 4, 14), M.gold, g, 0, 0, 0.03 - i * 0.022, {});
  // wheel pommel
  const pom = lathe([[0.001, -0.025], [0.022, -0.02], [0.03, 0], [0.022, 0.02], [0.001, 0.025]], 18);
  mesh(pom, M.dark, g, 0, 0, -0.18, { rx: Math.PI / 2, rz: Math.PI / 2 });
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.062, 12), M.gold, g, 0, 0, -0.18, { rz: Math.PI / 2 });
  g.userData = { blade, rune, tip: new THREE.Vector3(0, 0, L + 0.06), base: new THREE.Vector3(0, 0, 0.12) };
  return g;
}

// ------------------------------------------------------------
function gauntlet(M, parent, sx, grip) {
  // parent = wrist joint; hand extends along -y
  const cuff = lathe([[0.046, 0.02], [0.05, -0.03], [0.066, -0.075]], 20);
  mesh(cuff, M.plate, parent, 0, 0.0, 0);
  mesh(new THREE.TorusGeometry(0.066, 0.004, 4, 24), M.gold, parent, 0, -0.075, 0, { rx: Math.PI / 2 });
  const hand = joint(parent, 0, -0.06, 0);
  // back of hand plate (towards outside = +x*sx side ... the back faces outward)
  const back = mesh(rounded(0.03, 0.085, 0.085, 0.012), M.plate, hand, sx * 0.012, -0.035, 0.0);
  mesh(rounded(0.022, 0.07, 0.075, 0.01), M.leather, hand, -sx * 0.01, -0.03, 0);
  // knuckle lame
  mesh(rounded(0.036, 0.02, 0.09, 0.008), M.bright, hand, sx * 0.004, -0.082, 0);
  // fingers: 4 x 3 phalanges, curled into a fist around the grip (grip axis = z)
  const fingers = [];
  for (let f = 0; f < 4; f++) {
    const fz = -0.032 + f * 0.0215;
    let par = joint(hand, sx * 0.0, -0.09, fz);
    const segs = [0.03, 0.024, 0.02];
    for (let k = 0; k < 3; k++) {
      const s = segs[k];
      mesh(new THREE.CapsuleGeometry(0.0095 - k * 0.001, s - 0.01, 3, 8), k === 0 ? M.bright : M.plate, par, 0, -s / 2, 0);
      const nx = joint(par, 0, -s, 0);
      par.rotation.z = grip ? -sx * (k === 0 ? 1.35 : 1.25) : -sx * (0.25 + k * 0.2);
      fingers.push(par);
      par = nx;
    }
  }
  // thumb
  const th = joint(hand, -sx * 0.018, -0.05, 0.045);
  th.rotation.set(grip ? 0.9 : 0.3, 0, -sx * 0.5);
  mesh(new THREE.CapsuleGeometry(0.01, 0.025, 3, 8), M.plate, th, 0, -0.02, 0);
  const th2 = joint(th, 0, -0.04, 0); th2.rotation.z = -sx * (grip ? 0.8 : 0.3);
  mesh(new THREE.CapsuleGeometry(0.009, 0.018, 3, 8), M.bright, th2, 0, -0.014, 0);
  return { hand, fingers };
}

function pauldron(M, parent, sx) {
  // spaulder hugging the shoulder: domed cop + lames wrapping down the upper arm
  const g = new THREE.Group(); parent.add(g);
  g.position.set(sx * 0.02, 0.01, 0);
  g.rotation.z = sx * 0.32;
  const cop = shell(0.098, 0, Math.PI * 2, 0, 1.15, 32, 12);
  scaleXZ(cop, 1.0, 1.12); cop.scale(1, 0.75, 1);
  mesh(cop, M.plate, g, 0, 0.02, 0);
  mesh(new THREE.TorusGeometry(0.0898, 0.0035, 5, 40), M.gold, g, 0, 0.02 + 0.098 * 0.75 * Math.cos(1.15), 0, { rx: Math.PI / 2, s: [1, 1.12, 1] });
  // lames continue the sphere down over the deltoid, each slightly larger and overlapping
  const arc = Math.PI * 1.35, ph0 = sx > 0 ? Math.PI / 2 - arc / 2 : -Math.PI / 2 - arc / 2;
  for (let i = 0; i < 4; i++) {
    const r = 0.1 + i * 0.006, t0 = 0.95 + i * 0.2;
    const l = shell(r, ph0, arc, t0, 0.3, 32, 5);
    scaleXZ(l, 1.0, 1.12); l.scale(1, 0.95, 1);
    mesh(l, i % 2 ? M.bright : M.plate, g, sx * 0.004 * i, 0.02 - i * 0.012, 0);
    if (i === 3) {
      const yr = r * Math.cos(t0 + 0.3) * 0.95, rr = r * Math.sin(t0 + 0.3);
      const t = new THREE.TorusGeometry(rr, 0.0035, 4, 32, arc);
      const m = mesh(t, M.gold, g, sx * 0.012, 0.02 - i * 0.012 + yr, 0, { rx: -Math.PI / 2, s: [1, 1.12, 1] });
      m.rotation.z = -ph0 + Math.PI / 2 - arc;
    }
  }
  // haute-piece (raised neck guard) on the inner side
  const hp = lathe([[0.1, 0.0], [0.108, 0.05], [0.104, 0.065]], 20, 0, Math.PI * 0.8);
  const hpm = mesh(hp, M.bright, g, 0, 0.03, 0);
  hpm.rotation.y = sx > 0 ? Math.PI - Math.PI * 0.4 + Math.PI / 2 : -Math.PI * 0.4 - Math.PI / 2 + Math.PI;
  for (let i = 0; i < 6; i++) {
    const a = (i / 5) * Math.PI * 1.2 - Math.PI * 0.6 + (sx > 0 ? Math.PI / 2 : -Math.PI / 2);
    mesh(new THREE.SphereGeometry(0.0045, 6, 4), M.gold, g, Math.sin(a) * 0.1, -0.13, Math.cos(a) * 0.11);
  }
  return g;
}

function helm(M, head) {
  const h = new THREE.Group(); head.add(h);
  // skull (bascinet with slight point)
  const skull = lathe([[0.104, -0.085], [0.112, -0.02], [0.119, 0.04], [0.113, 0.1], [0.09, 0.15], [0.05, 0.19], [0.008, 0.215], [0.0005, 0.218]], 40);
  scaleXZ(skull, 0.95, 1.1);
  mesh(skull, M.plate, h);
  // inner darkness
  const inner = lathe([[0.1, -0.09], [0.108, 0.05], [0.09, 0.12]], 24);
  scaleXZ(inner, 0.92, 1.04);
  mesh(inner, M.black, h, 0, 0, -0.003, { cast: false });
  // glowing eyes behind the slit
  for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(0.009, 8, 6), M.eye, h, sx * 0.036, 0.034, 0.108, { cast: false, s: [1.6, 0.6, 1] });
  // visor: one smooth snouted plate over the face, eye slits glow from within
  const visor = frontLathe([[0.108, -0.105], [0.124, -0.07], [0.132, -0.02], [0.133, 0.03], [0.128, 0.07], [0.12, 0.1]], 40, Math.PI * 1.15);
  scaleXZ(visor, 0.98, 1.12);
  mapVerts(visor, (v) => {
    const front = Math.max(0, v.z) / 0.15;
    const cx = Math.max(0, 1 - Math.abs(v.x) / 0.095);
    const cy = Math.max(0, 1 - Math.abs(v.y + 0.025) / 0.085);
    v.z += 0.055 * front * Math.pow(cx, 1.4) * cy;
    if (v.z > 0) v.z += 0.006 * Math.max(0, 1 - Math.abs(v.x) / 0.012); // center ridge
  });
  mesh(visor, M.bright, h);
  const slitMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.9, 0.22) });
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
    const ang = sx * (0.1 + i * 0.1);
    const y = 0.043 - i * 0.002;
    const cx = Math.max(0, 1 - Math.abs(Math.sin(ang) * 0.13) / 0.095);
    const cy = Math.max(0, 1 - Math.abs(y + 0.025) / 0.085);
    const z = Math.cos(ang) * 0.1315 * 1.12 + 0.055 * Math.cos(ang) * Math.pow(cx, 1.4) * cy + 0.001;
    mesh(new THREE.BoxGeometry(0.03, 0.008, 0.012), slitMat, h, Math.sin(ang) * 0.1315 * 0.98, y, z, { cast: false, ry: ang * 1.6 });
  }
  // breath holes (dark dots on the right cheek)
  for (let i = 0; i < 7; i++) {
    const a = -0.35 - (i % 4) * 0.13, y = -0.05 + Math.floor(i / 4) * 0.025;
    mesh(new THREE.CircleGeometry(0.0042, 8), M.black, h, Math.sin(a) * 0.131, y - 0.03, Math.cos(a) * 0.131 * 1.12 + 0.012, { ry: a, cast: false });
  }
  // central ridge (comb) over the skull
  const comb = tube([[0, 0.1, 0.13], [0, 0.18, 0.08], [0, 0.222, 0], [0, 0.19, -0.09], [0, 0.11, -0.13]], 0.006, 30, 6);
  mesh(comb, M.gold, h);
  // hinge rosettes
  for (const sx of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.01, 16), M.gold, h, sx * 0.118, 0.04, 0.0, { rz: Math.PI / 2 });
    mesh(new THREE.SphereGeometry(0.008, 8, 6), M.bright, h, sx * 0.125, 0.04, 0);
  }
  // gorget lames (neck)
  for (let i = 0; i < 3; i++) {
    const g = lathe([[0.1 + i * 0.012, -0.075 - i * 0.03], [0.108 + i * 0.016, -0.11 - i * 0.03]], 32);
    scaleXZ(g, 1.0, 1.06);
    mesh(g, i === 1 ? M.bright : M.plate, h);
  }
  // plume: swept-back crimson horsehair
  const plume = new THREE.Group(); plume.position.set(0, 0.2, -0.04); h.add(plume);
  const strands = [];
  for (let i = 0; i < 18; i++) {
    const f = i / 17 - 0.5;
    const sx = f * 0.05, len = 0.34 + Math.sin(i * 2.1) * 0.06, droop = 0.06 + Math.cos(i * 1.7) * 0.04;
    const tg = taperTube([[sx * 0.4, 0, 0.02], [sx, 0.07, -0.05], [sx * 1.8, 0.06, -len * 0.55], [sx * 2.6, -droop, -len]], (t) => 0.016 * Math.pow(1 - t, 0.8) + 0.002, 20, 6);
    strands.push(mesh(tg, M.cloth, plume, 0, 0, 0, { cast: true }));
  }
  return { h, plume, strands };
}

// ------------------------------------------------------------
export function buildKnight(baker, variant) {
  const M = knightMaterials(baker, variant);
  const root = new THREE.Group();
  const rollPivot = joint(root, 0, 0.75, 0);
  const body = joint(rollPivot, 0, -0.75, 0);
  const J = {};
  const hips = J.hips = joint(body, 0, 0.98, 0);
  // ---- pelvis: belt, faulds, chain skirt, tabard ----
  mesh(scaleXZ(lathe([[0.155, -0.02], [0.162, 0.03], [0.158, 0.06]], 32), 1, 0.82), M.leather, hips, 0, 0, 0);
  mesh(rounded(0.06, 0.05, 0.02, 0.006), M.gold, hips, 0, 0.02, 0.135);
  for (let i = 0; i < 3; i++) {
    const f = lathe([[0.165 + i * 0.012, -0.0 - i * 0.045], [0.18 + i * 0.012, -0.055 - i * 0.045]], 32);
    scaleXZ(f, 1, 0.84);
    mesh(f, i % 2 ? M.bright : M.plate, hips);
  }
  const skirt = new THREE.CylinderGeometry(0.19, 0.25, 0.26, 32, 3, true);
  scaleXZ(skirt, 1, 0.86);
  mapVerts(skirt, (v) => { if (v.y < -0.12) v.y += Math.sin(Math.atan2(v.z, v.x) * 9) * 0.012; });
  mesh(skirt, M.chain, hips, 0, -0.2, 0);
  const tabard = new THREE.PlaneGeometry(0.24, 0.5, 4, 8);
  mapVerts(tabard, (v) => { v.z += 0.02 * Math.cos(v.x * 12); if (v.y < -0.22) v.y += Math.sin(v.x * 50) * 0.012; });
  tabard.translate(0, -0.25, 0);
  const tabF = joint(hips, 0, 0.0, 0.17);
  mesh(tabard, M.tabard, tabF);
  // lantern on the left hip
  const lantern = joint(hips, 0.2, -0.02, 0.06);
  mesh(new THREE.TorusGeometry(0.015, 0.003, 4, 12), M.dark, lantern, 0, 0, 0);
  const cage = joint(lantern, 0, -0.04, 0);
  mesh(new THREE.ConeGeometry(0.04, 0.04, 6), M.dark, cage, 0, -0.01, 0);
  mesh(new THREE.CylinderGeometry(0.042, 0.035, 0.015, 6), M.dark, cage, 0, -0.12, 0);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; mesh(new THREE.BoxGeometry(0.005, 0.09, 0.005), M.gold, cage, Math.cos(a) * 0.036, -0.07, Math.sin(a) * 0.036); }
  const flame = mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 3.4, 0.9) }), cage, 0, -0.07, 0, { cast: false, s: [1, 1.6, 1] });
  const glass = mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.09, 12, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xffc080, transparent: true, opacity: 0.25, roughness: 0.1, emissive: 0xff8020, emissiveIntensity: 0.6, depthWrite: false }), cage, 0, -0.07, 0, { cast: false });
  const lanternLight = new THREE.PointLight(0xff9a45, 1.4, 7, 1.7);
  lanternLight.position.set(0, -0.07, 0);
  cage.add(lanternLight);
  // tassets (follow thighs partially in animation)
  const tassets = [];
  for (const sx of [-1, 1]) {
    const t = joint(hips, sx * 0.095, -0.13, 0.055);
    for (let i = 0; i < 3; i++) {
      const g = frontLathe([[0.095 + i * 0.004, 0], [0.1 + i * 0.004, -0.065]], 16, Math.PI * 0.8);
      const m = mesh(g, i === 2 ? M.bright : M.plate, t, 0, -i * 0.055, -0.055);
      m.rotation.y = sx * 0.25;
    }
    mesh(new THREE.TorusGeometry(0.104, 0.003, 4, 16, Math.PI * 0.8), M.gold, t, 0, -0.17, -0.055, { rx: Math.PI / 2, rz: -Math.PI * 0.5 + Math.PI * 0.4 + sx * 0.25 });
    tassets.push(t);
  }
  // ---- legs ----
  for (const [name, sx] of [['L', 1], ['R', -1]]) {
    const th = J['thigh' + name] = joint(hips, sx * 0.1, -0.04, 0);
    mesh(new THREE.CylinderGeometry(0.07, 0.058, 0.4, 14), M.chain, th, 0, -0.2, 0);
    const cuisse = frontLathe([[0.088, -0.03], [0.097, -0.12], [0.09, -0.28], [0.074, -0.4]], 24, Math.PI * 1.45);
    mesh(cuisse, M.plate, th, 0, 0, 0.004);
    const sh = J['shin' + name] = joint(th, 0, -0.44, 0);
    // poleyn with side wing
    const pol = shell(0.058, -Math.PI * 0.75, Math.PI * 1.5, 0.4, 1.3, 20, 10);
    mesh(pol, M.bright, sh, 0, 0.01, 0.012, { rx: Math.PI / 2 - 0.2 });
    const wing = new THREE.SphereGeometry(0.05, 16, 8, 0, Math.PI * 2, 0, 0.9);
    mesh(wing, M.plate, sh, sx * 0.055, 0.01, 0.0, { rz: -sx * Math.PI / 2, s: [1, 0.35, 1.2] });
    mesh(new THREE.SphereGeometry(0.008, 6, 4), M.gold, sh, sx * 0.07, 0.01, 0);
    const greave = lathe([[0.062, -0.03], [0.071, -0.11], [0.066, -0.21], [0.05, -0.36], [0.054, -0.41]], 24);
    scaleXZ(greave, 0.92, 1.05);
    mesh(greave, M.plate, sh, 0, 0, 0.004);
    mesh(tube([[0, -0.04, 0.066], [0, -0.2, 0.066], [0, -0.36, 0.05]], 0.0035, 12, 4), M.bright, sh);
    const ft = J['foot' + name] = joint(sh, 0, -0.42, 0);
    // sabaton: a shaped foot shell with overlapping lames and a pointed toe
    mesh(rounded(0.09, 0.025, 0.26, 0.01), M.leather, ft, 0, -0.06, 0.055);
    const footShell = new THREE.SphereGeometry(0.06, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    mapVerts(footShell, (v) => { v.z *= 2.3; v.x *= 0.85; v.y *= 0.85; if (v.z > 0.05) { v.x *= 1 - (v.z - 0.05) * 3.2; v.y *= 1 - (v.z - 0.05) * 2.6; } });
    mesh(footShell, M.plate, ft, 0, -0.055, 0.06);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.SphereGeometry(0.063 - i * 0.004, 20, 6, 0, Math.PI * 2, 0, 0.9);
      mapVerts(l, (v) => { v.z *= 0.6; });
      mesh(l, i % 2 ? M.plate : M.bright, ft, 0, -0.035 - i * 0.004, 0.0 + i * 0.04, { rx: 0.5 });
    }
    mesh(rounded(0.075, 0.08, 0.075, 0.03), M.plate, ft, 0, -0.01, -0.03);
    mesh(new THREE.TorusGeometry(0.066, 0.004, 4, 24), M.gold, ft, 0, 0.0, 0, { rx: Math.PI / 2 });
  }
  // ---- torso ----
  const spine = J.spine = joint(hips, 0, 0.08, 0);
  mesh(scaleXZ(new THREE.CylinderGeometry(0.15, 0.155, 0.14, 24, 1, true), 1, 0.82), M.chain, spine, 0, 0.02, 0);
  const chest = J.chest = joint(spine, 0, 0.2, 0);
  const cuirass = lathe([[0.142, -0.2], [0.152, -0.12], [0.188, 0.0], [0.215, 0.1], [0.208, 0.18], [0.17, 0.245], [0.1, 0.275]], 56);
  scaleXZ(cuirass, 1, 0.76);
  mapVerts(cuirass, (v) => { // medial ridge + slight forward chest swell
    if (v.z > 0) { const k = Math.max(0, 1 - Math.abs(v.x) / 0.06); v.z += 0.022 * k * k * Math.max(0, 1 - Math.abs(v.y - 0.05) / 0.28); v.z += 0.012 * Math.max(0, 1 - Math.abs(v.y - 0.08) / 0.15); }
  });
  mesh(cuirass, M.plate, chest);
  // plackart overlay (lower front plate) with gold border
  const plack = frontLathe([[0.158, -0.2], [0.17, -0.1], [0.19, 0.0]], 32, Math.PI * 0.9);
  scaleXZ(plack, 1.035, 0.84);
  mapVerts(plack, (v) => { const k = Math.abs(v.x) / 0.16; v.y += -0.06 * (1 - k * k) * (v.y > -0.05 ? 0 : 0) + (v.y > -0.03 ? -(v.y + 0.03) * k * 1.5 : 0); });
  mesh(plack, M.bright, chest);
  mesh(new THREE.TorusGeometry(0.173, 0.0032, 4, 40, Math.PI * 0.9), M.gold, chest, 0, -0.2, 0, { rx: Math.PI / 2, rz: Math.PI / 2 - Math.PI * 0.45, s: [1.035, 0.84, 1] });
  // arm-hole gussets and neck rolled edge
  mesh(new THREE.TorusGeometry(0.1, 0.006, 6, 32), M.gold, chest, 0, 0.275, 0, { rx: Math.PI / 2, s: [1, 0.85, 1] });
  // backplate straps / spaulder anchors
  for (const sx of [-1, 1]) mesh(rounded(0.04, 0.02, 0.06, 0.006), M.leather, chest, sx * 0.13, 0.25, -0.02);
  const neck = J.neck = joint(chest, 0, 0.28, 0);
  mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 16), M.chain, neck, 0, 0.02, 0);
  const head = J.head = joint(neck, 0, 0.13, 0.01);
  const H = helm(M, head);
  // ---- arms ----
  const hands = {};
  for (const [name, sx] of [['L', 1], ['R', -1]]) {
    const sh = J['sh' + name] = joint(chest, sx * 0.205, 0.2, 0, 'YXZ');
    pauldron(M, sh, sx);
    mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.26, 14), M.chain, sh, 0, -0.14, 0);
    const reb = lathe([[0.052, -0.06], [0.056, -0.15], [0.05, -0.27]], 20);
    mesh(reb, M.plate, sh);
    const el = J['el' + name] = joint(sh, 0, -0.29, 0);
    const cop = shell(0.05, 0, Math.PI * 2, 0, 1.4, 18, 8);
    mesh(cop, M.bright, el, 0, 0, -0.01, { rx: -Math.PI / 2 });
    const fan = new THREE.SphereGeometry(0.06, 16, 8, 0, Math.PI * 2, 0, 0.8);
    mesh(fan, M.plate, el, sx * 0.035, 0, -0.005, { rz: -sx * Math.PI / 2, s: [1, 0.3, 1.1] });
    mesh(new THREE.SphereGeometry(0.007, 6, 4), M.gold, el, sx * 0.055, 0, -0.005);
    const vam = lathe([[0.047, -0.03], [0.052, -0.1], [0.044, -0.24]], 20);
    mesh(vam, M.plate, el);
    mesh(tube([[sx * 0.046, -0.05, 0], [sx * 0.044, -0.22, 0]], 0.003, 6, 4), M.gold, el);
    const wr = J['wr' + name] = joint(el, 0, -0.26, 0);
    hands[name] = gauntlet(M, wr, sx, name === 'R');
  }
  // sword in the right fist (blade along local +z of grip joint)
  const sword = buildSword(M);
  const gripJ = joint(hands.R.hand, -0.0, -0.1, 0.0);
  gripJ.add(sword);
  sword.position.set(0, 0, 0.0);

  // eye-glow light inside helm for rim drama
  const markers = { tip: new THREE.Object3D(), base: new THREE.Object3D() };
  markers.tip.position.copy(sword.userData.tip); markers.base.position.copy(sword.userData.base);
  sword.add(markers.tip, markers.base);

  root.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; } });
  const rig = {
    root, rollPivot, body, hips, hipBase: 0.98, joints: J, sword, swordGrip: gripJ, markers, M,
    lantern, cage, flame, lanternLight, glass, tassets, tabF, plume: H.plume, helm: H.h, hands,
  };
  rig.cape = new Cape(rig, M);
  return rig;
}

// ------------------------------------------------------------
//  Verlet cloth cape pinned to the shoulders
// ------------------------------------------------------------
export class Cape {
  constructor(rig, M) {
    this.rig = rig;
    const W = this.W = 11, H = this.H = 16;
    this.width = 0.56; this.len = 1.18;
    this.p = new Float32Array(W * H * 3);
    this.o = new Float32Array(W * H * 3);
    this.pin = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(W * H * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = [], idx = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) uv.push(x / (W - 1), 1 - y / (H - 1));
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      const a = y * W + x, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.geo = geo;
    // tattered hem alpha
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 128, 256);
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.moveTo(0, 256);
    for (let x = 0; x <= 128; x += 4) ctx.lineTo(x, 256 - 8 - Math.abs(Math.sin(x * 0.21) * 18 + Math.sin(x * 0.07) * 14) - (Math.random() * 10));
    ctx.lineTo(128, 256); ctx.fill();
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(Math.random() * 128, 150 + Math.random() * 80, 2 + Math.random() * 4, 3 + Math.random() * 6, 0, 0, Math.PI * 2); ctx.fill(); }
    const alpha = new THREE.CanvasTexture(cv);
    const mat = M.cloth.clone();
    mat.alphaMap = alpha; mat.alphaTest = 0.5; mat.side = THREE.DoubleSide;
    mat.color = M.cloth.color.clone().multiplyScalar(0.8);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: alpha, alphaTest: 0.5 });
    this.anchorsL = [];
    for (let x = 0; x < W; x++) {
      const t = x / (W - 1) * 2 - 1; // -1..1 across the back
      this.anchorsL.push(new THREE.Vector3(t * 0.19, 0.24 - Math.abs(t) * 0.025, -0.14 - (1 - t * t) * 0.03));
    }
    this.colliders = [
      { j: 'chest', p: new THREE.Vector3(0, 0.04, -0.01), r: 0.23 },
      { j: 'chest', p: new THREE.Vector3(0, -0.15, -0.0), r: 0.2 },
      { j: 'hips', p: new THREE.Vector3(0, -0.08, -0.02), r: 0.22 },
      { j: 'thighL', p: new THREE.Vector3(0, -0.25, 0), r: 0.11 },
      { j: 'thighR', p: new THREE.Vector3(0, -0.25, 0), r: 0.11 },
      { j: 'shinL', p: new THREE.Vector3(0, -0.15, 0), r: 0.09 },
      { j: 'shinR', p: new THREE.Vector3(0, -0.15, 0), r: 0.09 },
    ];
    this.initialized = false;
    this.acc = 0;
    this._v = new THREE.Vector3();
  }
  reset() { this.initialized = false; }
  update(dt, windVec) {
    const { W, H, p, o } = this;
    const J = this.rig.joints;
    this.rig.root.updateMatrixWorld(true);
    const anchors = this.anchorsL.map((a) => J.chest.localToWorld(a.clone()));
    const down = J.chest.localToWorld(new THREE.Vector3(0, -1, -0.15)).sub(J.chest.localToWorld(new THREE.Vector3())).normalize();
    const segY = this.len / (H - 1), segX = this.width / (W - 1);
    if (!this.initialized) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3; const a = anchors[x];
        p[i] = o[i] = a.x + down.x * y * segY; p[i + 1] = o[i + 1] = a.y + down.y * y * segY; p[i + 2] = o[i + 2] = a.z + down.z * y * segY;
      }
      this.initialized = true;
    }
    const cols = this.colliders.map((c) => ({ w: J[c.j].localToWorld(c.p.clone()), r: c.r }));
    this.acc += Math.min(dt, 0.05);
    const step = 1 / 90;
    let guard = 0;
    while (this.acc >= step && guard++ < 6) {
      this.acc -= step;
      const t = G.time.value;
      for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        const vx = (p[i] - o[i]) * 0.985, vy = (p[i + 1] - o[i + 1]) * 0.985, vz = (p[i + 2] - o[i + 2]) * 0.985;
        o[i] = p[i]; o[i + 1] = p[i + 1]; o[i + 2] = p[i + 2];
        const gust = 0.6 + 0.4 * Math.sin(t * 2.3 + x * 0.6 + y * 0.3);
        p[i] += vx + windVec.x * gust * step * step * (y / H);
        p[i + 1] += vy - 9.8 * step * step;
        p[i + 2] += vz + windVec.y * gust * step * step * (y / H);
      }
      for (let x = 0; x < W; x++) { const i = x * 3; const a = anchors[x]; p[i] = a.x; p[i + 1] = a.y; p[i + 2] = a.z; }
      for (let it = 0; it < 5; it++) {
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (x < W - 1 && y > 0) this._c(y * W + x, y * W + x + 1, segX, false);
          if (y < H - 1) this._c(y * W + x, (y + 1) * W + x, segY, y === 0);
          if (x < W - 1 && y < H - 1) { const dg = Math.hypot(segX, segY); this._c(y * W + x, (y + 1) * W + x + 1, dg, y === 0); this._c(y * W + x + 1, (y + 1) * W + x, dg, y === 0); }
          if (y < H - 2) this._c(y * W + x, (y + 2) * W + x, segY * 2, y === 0, 0.5);
        }
        for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 3;
          for (const c of cols) {
            const dx = p[i] - c.w.x, dy = p[i + 1] - c.w.y, dz = p[i + 2] - c.w.z;
            const d = Math.hypot(dx, dy, dz);
            if (d < c.r && d > 1e-5) { const k = (c.r - d) / d; p[i] += dx * k; p[i + 1] += dy * k; p[i + 2] += dz * k; }
          }
          if (p[i + 1] < this.ground + 0.02) p[i + 1] = this.ground + 0.02;
        }
      }
    }
    const pos = this.geo.attributes.position;
    pos.array.set(p);
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
  _c(a, b, rest, pinA, stiff = 1) {
    const p = this.p; a *= 3; b *= 3;
    const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    const diff = ((d - rest) / d) * stiff;
    if (pinA) { p[b] -= dx * diff; p[b + 1] -= dy * diff; p[b + 2] -= dz * diff; return; }
    const h = diff * 0.5;
    p[a] += dx * h; p[a + 1] += dy * h; p[a + 2] += dz * h;
    p[b] -= dx * h; p[b + 1] -= dy * h; p[b + 2] -= dz * h;
  }
}
Cape.prototype.ground = -100;
