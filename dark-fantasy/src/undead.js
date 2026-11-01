// ============================================================
//  Undead & monsters — anatomical skeletons, wraiths, priests,
//  golems and the bosses. Geometry is merged per joint+material.
// ============================================================
import * as THREE from 'three';
import { lathe, frontLathe, scaleXZ, tube, taperTube, shell, rounded, joint, mapVerts, ni, mergeGeometries } from './geo.js';
import { mergeVertices } from '../lib/utils/BufferGeometryUtils.js';
import { pbr } from './texgen.js';
import { G } from './engine.js';
import { fbm3, makeRng } from './noise.js';

// ---------- merged part builder ----------
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
class Parts {
  constructor() { this.groups = new Map(); }
  add(j, mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z);
    if (Array.isArray(s)) _s.set(...s); else _s.set(s, s, s);
    _m4.compose(_p, _q, _s);
    let g = ni(geo);
    if (g === geo) g = geo.clone();
    g.applyMatrix4(_m4);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const key = j.uuid + mat.uuid;
    if (!this.groups.has(key)) this.groups.set(key, { j, mat, geos: [] });
    this.groups.get(key).geos.push(g);
  }
  build(cast = true) {
    const meshes = [];
    for (const { j, mat, geos } of this.groups.values()) {
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.castShadow = cast && !mat.transparent; m.receiveShadow = true;
      j.add(m); meshes.push(m);
    }
    return meshes;
  }
}

// ---------- shared materials per kingdom ----------
let TATTER = null;
function tatterTex() {
  if (TATTER) return TATTER;
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, 128, 256);
  c.fillStyle = '#000';
  c.beginPath(); c.moveTo(0, 256);
  for (let x = 0; x <= 128; x += 3) c.lineTo(x, 256 - 6 - Math.abs(Math.sin(x * 0.31) * 30 + Math.sin(x * 0.11) * 26) - Math.random() * 18);
  c.lineTo(128, 256); c.fill();
  for (let i = 0; i < 18; i++) { c.beginPath(); c.ellipse(Math.random() * 128, 60 + Math.random() * 170, 1 + Math.random() * 5, 2 + Math.random() * 9, Math.random(), 0, Math.PI * 2); c.fill(); }
  TATTER = new THREE.CanvasTexture(cv);
  return TATTER;
}
export function monsterMaterials(baker, theme) {
  const bone = baker.bake('bone', { normal: 5 });
  const rust = baker.bake('rust', { normal: 4 });
  const cloth = baker.bake('cloth', { normal: 3 });
  const gold = baker.bake('gold', { normal: 6 });
  const rock = baker.bake('rock', { normal: 5 });
  const DS = THREE.DoubleSide;
  const M = {
    bone: pbr(bone, { color: theme.boneColor ?? 0xb8aa94, metalness: 0, repeat: [2, 2] }),
    boneDark: pbr(bone, { color: 0x6a5e50, metalness: 0, repeat: [2, 2] }),
    rust: pbr(rust, { repeat: [2, 2], side: DS }),
    gold: pbr(gold, { repeat: [2, 1], side: DS, color: 0xb08a50 }),
    rag: pbr(cloth, { color: theme.ragColor ?? 0x2a2220, metalness: 0, repeat: [2, 2], side: DS, alphaTest: 0.5 }),
    robe: pbr(cloth, { physical: true, color: theme.robeColor ?? 0x241018, metalness: 0, repeat: [3, 3], side: DS, alphaTest: 0.5, sheen: 0.5, sheenColor: new THREE.Color(0.3, 0.1, 0.15) }),
    wood: pbr(baker.bake('bark', { normal: 5 }), { color: 0x6a5a50, metalness: 0, repeat: [1, 3] }),
    eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.eye ?? 0xff4020).multiplyScalar(5) }),
    socket: new THREE.MeshBasicMaterial({ color: 0x020101 }),
    rock: pbr(rock, { color: theme.golemColor ?? 0x6a6060, metalness: 0, repeat: [1, 1], flatShading: true }),
  };
  M.rag.alphaMap = tatterTex(); M.robe.alphaMap = tatterTex();
  if (theme.char) { // charred bones with ember cracks
    const bas = baker.bake('basalt', { normal: 5, emissive: true });
    M.bone = pbr(bas, { color: 0x8a7a70, metalness: 0, repeat: [2, 2], emissive: 0xffffff, emissiveIntensity: 1.8 });
  }
  if (theme.frost) {
    const ice = baker.bake('ice', { normal: 3, emissive: true });
    M.ice = pbr(ice, { physical: true, metalness: 0, roughness: 0.8, clearcoat: 1, clearcoatRoughness: 0.15, color: 0x9ab4c4, emissive: 0x66ccff, emissiveIntensity: 2.5, flatShading: true });
  }
  M.spirit = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.spirit ?? 0x050809), emissive: new THREE.Color(theme.spiritGlow ?? 0x2aa8a0), emissiveIntensity: 0.9, roughness: 0.9, transparent: true, opacity: 0.72, side: DS, depthWrite: false, alphaMap: tatterTex(), alphaTest: 0.02 });
  flowShader(M.spirit, 1.0);
  return M;
}
/** Animate cloth-like flow in the vertex shader (wraith robes). */
function flowShader(mat, amp) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = G.time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float fl = clamp(-position.y * 0.9 + 0.6, 0.0, 1.6);
      transformed.x += sin(uTime * 2.3 + position.y * 5.0 + position.z * 4.0) * 0.05 * fl * ${amp.toFixed(2)};
      transformed.z += cos(uTime * 1.9 + position.y * 4.0 + position.x * 5.0) * 0.06 * fl * ${amp.toFixed(2)};
      transformed.y += sin(uTime * 3.1 + position.x * 9.0) * 0.015 * fl;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.0);
      totalEmissiveRadiance *= 0.06 + fres * fres * 2.6;`);
  };
}

// ---------- anatomy geometry ----------
function skullGeo() {
  const g = new THREE.SphereGeometry(0.1, 36, 28);
  mapVerts(g, (v) => {
    if (v.z < 0) v.z *= 1.18;
    v.x *= 0.84;
    if (v.y < -0.01) { const k = -v.y - 0.01; v.x *= 1 - k * 2.2; v.z *= 1 - k * 0.9; }
    if (v.y > 0.04) v.y *= 1.05;
    for (const sx of [-1, 1]) { // deep eye sockets
      const dx = v.x - sx * 0.035, dy = v.y - 0.005;
      if (v.z > 0.03) v.multiplyScalar(1 - 0.32 * Math.exp(-(dx * dx + dy * dy * 1.3) / 0.0007));
      const cx = v.x - sx * 0.058, cy = v.y + 0.028; // cheekbones
      if (v.z > 0.0) v.multiplyScalar(1 + 0.05 * Math.exp(-(cx * cx + cy * cy) / 0.0006));
    }
    const nx = v.x, ny = v.y + 0.035; // nasal cavity
    if (v.z > 0.04) v.multiplyScalar(1 - 0.2 * Math.exp(-(nx * nx * 5 + ny * ny) / 0.0005));
    const by = v.y - 0.03; // brow ridge
    if (v.z > 0.05) v.multiplyScalar(1 + 0.04 * Math.exp(-(by * by) / 0.0002));
  });
  return g;
}
function boneGeo(L, r0, r1, rm) {
  return lathe([[r0 * 0.6, 0.005], [r0, -0.015], [r0 * 0.75, -0.05], [rm, -L * 0.3], [rm * 0.95, -L * 0.6], [r1 * 0.8, -L + 0.04], [r1, -L + 0.012], [r1 * 0.6, -L - 0.005]], 10);
}
function rockGeo(r, detail, seed, rough = 0.5, stretch = [1, 1, 1]) {
  let g = new THREE.IcosahedronGeometry(r, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const d = fbm3(n.x * 1.6 + seed, n.y * 1.6, n.z * 1.6, 5);
    const facet = Math.round(d * 6) / 6;
    v.copy(n).multiplyScalar(r * (1 + (d * 0.7 + facet * 0.3 - 0.5) * rough * 2));
    v.multiply(new THREE.Vector3(...stretch));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // spherical uvs
  const uv = [];
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); uv.push(Math.atan2(v.z, v.x) / (Math.PI * 2) + 0.5, v.y * 0.5 + 0.5); }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
export { rockGeo };

function weaponGeo(kind) {
  const geos = { metal: [], wood: [], gold: [] };
  if (kind === 'sword' || kind === 'greatsword') {
    const L = kind === 'sword' ? 0.8 : 1.5, W = kind === 'sword' ? 0.045 : 0.085;
    const b = new THREE.BoxGeometry(W, 0.012, L, 1, 1, 8);
    mapVerts(b, (v) => { const t = (v.z + L / 2) / L; if (t > 0.85) v.x *= (1 - t) / 0.15; v.x *= 1 - t * 0.25; if (Math.random() < 0.15) v.x *= 0.85; });
    b.translate(0, 0, L / 2 + 0.06);
    geos.metal.push(b);
    geos.metal.push(new THREE.BoxGeometry(W * 4.2, 0.03, 0.035).translate(0, 0, 0.05));
    geos.wood.push(new THREE.CylinderGeometry(0.016, 0.018, kind === 'sword' ? 0.18 : 0.36, 8).rotateX(Math.PI / 2).translate(0, 0, kind === 'sword' ? -0.05 : -0.14));
  } else if (kind === 'axe') {
    geos.wood.push(new THREE.CylinderGeometry(0.02, 0.024, 1.2, 8).rotateX(Math.PI / 2).translate(0, 0, 0.35));
    const s = new THREE.Shape();
    s.moveTo(0, 0.04); s.quadraticCurveTo(0.12, 0.08, 0.22, 0.2); s.quadraticCurveTo(0.26, 0, 0.22, -0.2); s.quadraticCurveTo(0.12, -0.08, 0, -0.04); s.lineTo(0, 0.04);
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 10 });
    e.translate(0, 0, -0.01); e.rotateY(Math.PI / 2); e.rotateZ(Math.PI / 2);
    e.translate(0, 0, 0.85);
    geos.metal.push(e);
  } else if (kind === 'hammer') {
    geos.wood.push(new THREE.CylinderGeometry(0.03, 0.035, 1.6, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5));
    geos.metal.push(rounded(0.42, 0.24, 0.24, 0.03).translate(0, 0, 1.25));
  } else if (kind === 'staff') {
    geos.wood.push(taperTube([[0, 0, -0.5], [0.02, 0.01, 0.2], [-0.02, 0, 0.9], [0.04, 0.02, 1.35]], (t) => 0.024 - t * 0.008, 24, 6));
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; geos.metal.push(taperTube([[0.04, 0, 1.35], [Math.cos(a) * 0.08, Math.sin(a) * 0.08, 1.45], [Math.cos(a) * 0.05, Math.sin(a) * 0.05, 1.6]], (t) => 0.012 * (1 - t) + 0.002, 10, 5)); }
  }
  return geos;
}

// ---------- skeleton ----------
export function buildSkeleton(M, o = {}) {
  const P = new Parts();
  const root = new THREE.Group();
  const body = joint(root);
  const J = {};
  const bm = o.boneMat || M.bone;
  const hips = J.hips = joint(body, 0, 0.95, 0);
  // pelvis
  for (const sx of [-1, 1]) {
    const wing = shell(0.09, 0, Math.PI * 1.1, 0.3, 1.2, 14, 8);
    P.add(hips, bm, wing, sx * 0.06, 0.02, -0.01, 0, sx > 0 ? -1.2 : 1.2 - Math.PI * 0.1, sx * 0.4, [0.8, 1, 0.6]);
  }
  P.add(hips, bm, tube([[-0.07, -0.04, 0.03], [0, -0.07, 0.06], [0.07, -0.04, 0.03]], 0.014, 12, 6));
  P.add(hips, bm, rounded(0.06, 0.1, 0.04, 0.015), 0, 0.0, -0.06, 0.3);
  // legs
  for (const [n, sx] of [['L', 1], ['R', -1]]) {
    const th = J['thigh' + n] = joint(hips, sx * 0.085, -0.03, 0);
    P.add(th, bm, new THREE.SphereGeometry(0.03, 10, 8), 0, 0, 0);
    P.add(th, bm, boneGeo(0.43, 0.03, 0.034, 0.016));
    const sh = J['shin' + n] = joint(th, 0, -0.44, 0);
    P.add(sh, bm, new THREE.SphereGeometry(0.022, 8, 6), 0, 0.015, 0.03, 0, 0, 0, [1.2, 1, 0.7]); // kneecap
    P.add(sh, bm, boneGeo(0.41, 0.03, 0.022, 0.014), -sx * 0.008, 0, 0);
    P.add(sh, bm, boneGeo(0.39, 0.016, 0.014, 0.007), sx * 0.022, -0.01, -0.006);
    const ft = J['foot' + n] = joint(sh, 0, -0.42, 0);
    P.add(ft, bm, rounded(0.06, 0.04, 0.09, 0.015), 0, -0.02, 0.01);
    for (let t = 0; t < 5; t++) P.add(ft, bm, taperTube([[0, 0, 0], [0, -0.01, 0.06], [0, -0.03, 0.1]], (k) => 0.008 - k * 0.004, 6, 4), (t - 2) * 0.014, -0.02, 0.05);
  }
  // spine + ribcage
  const spine = J.spine = joint(hips, 0, 0.06, 0);
  for (let i = 0; i < 5; i++) P.add(spine, bm, rounded(0.035, 0.028, 0.03, 0.01), 0, i * 0.04, -0.05 - Math.sin(i * 0.5) * 0.01);
  const chest = J.chest = joint(spine, 0, 0.2, 0);
  for (let i = 0; i < 7; i++) P.add(chest, bm, rounded(0.03, 0.026, 0.028, 0.008), 0, -0.02 + i * 0.038, -0.075);
  for (let i = 0; i < 7; i++) {
    const y = 0.2 - i * 0.034, w = 0.075 + Math.sin(i / 6 * Math.PI) * 0.045 + i * 0.006;
    for (const sx of [-1, 1]) {
      P.add(chest, bm, taperTube([[sx * 0.015, y + 0.01, -0.075], [sx * w * 0.9, y + 0.005, -0.07], [sx * w * 1.08, y - 0.025, 0.0], [sx * w * 0.8, y - 0.055, 0.07], [sx * 0.025, y - 0.06 - i * 0.004, 0.09]], (t) => 0.0085 * (1 - t * 0.3), 16, 5));
    }
  }
  P.add(chest, bm, rounded(0.035, 0.17, 0.016, 0.006), 0, 0.12, 0.092, -0.1);
  for (const sx of [-1, 1]) {
    P.add(chest, bm, taperTube([[sx * 0.02, 0.24, 0.06], [sx * 0.1, 0.25, 0.03], [sx * 0.17, 0.235, -0.02]], () => 0.009, 10, 5)); // clavicle
    P.add(chest, bm, shell(0.1, 0, 1.2, 1.1, 0.9, 8, 6), sx * 0.09, 0.14, -0.06, 0, sx > 0 ? Math.PI : 0, 0, [0.9, 1, 0.3]); // scapula
  }
  const neck = J.neck = joint(chest, 0, 0.27, -0.03);
  for (let i = 0; i < 3; i++) P.add(neck, bm, rounded(0.028, 0.022, 0.026, 0.008), 0, i * 0.03, 0);
  const head = J.head = joint(neck, 0, 0.12, 0.02);
  P.add(head, bm, skullGeo(), 0, 0.03, 0);
  for (const sx of [-1, 1]) P.add(head, M.socket, new THREE.SphereGeometry(0.019, 10, 8), sx * 0.033, 0.035, 0.06);
  const eyes = new THREE.Group(); head.add(eyes);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), M.eye); e.position.set(sx * 0.033, 0.035, 0.073); eyes.add(e); }
  for (let i = 0; i < 10; i++) { const a = (i / 9 - 0.5) * 1.7; P.add(head, bm, rounded(0.011, 0.016, 0.01, 0.003), Math.sin(a) * 0.045, -0.035, 0.04 + Math.cos(a) * 0.035, 0, a); }
  const jaw = J.jaw = joint(head, 0, -0.02, -0.02);
  P.add(jaw, bm, taperTube([[-0.048, 0.0, -0.02], [-0.045, -0.045, 0.03], [0, -0.06, 0.075], [0.045, -0.045, 0.03], [0.048, 0.0, -0.02]], (t) => 0.011 + Math.sin(t * Math.PI) * 0.004, 20, 6));
  for (let i = 0; i < 8; i++) { const a = (i / 7 - 0.5) * 1.5; P.add(jaw, bm, rounded(0.01, 0.014, 0.009, 0.003), Math.sin(a) * 0.04, -0.04, 0.03 + Math.cos(a) * 0.035, 0, a); }
  // arms
  for (const [n, sx] of [['L', 1], ['R', -1]]) {
    const sh = J['sh' + n] = joint(chest, sx * 0.17, 0.21, -0.02, 'YXZ');
    P.add(sh, bm, new THREE.SphereGeometry(0.026, 10, 8));
    P.add(sh, bm, boneGeo(0.29, 0.026, 0.026, 0.013));
    const el = J['el' + n] = joint(sh, 0, -0.3, 0);
    P.add(el, bm, boneGeo(0.26, 0.02, 0.016, 0.009), sx * 0.008, 0, 0);
    P.add(el, bm, boneGeo(0.26, 0.016, 0.018, 0.008), -sx * 0.01, 0, 0.005);
    const wr = J['wr' + n] = joint(el, 0, -0.27, 0);
    P.add(wr, bm, rounded(0.03, 0.05, 0.05, 0.01), 0, -0.02, 0);
    for (let f = 0; f < 4; f++) {
      const z = -0.02 + f * 0.014, len = 0.085 + (f === 1 || f === 2 ? 0.015 : 0);
      P.add(wr, bm, taperTube([[0, -0.04, z], [-sx * 0.005, -0.04 - len * 0.5, z + 0.01], [-sx * 0.02, -0.04 - len, z + 0.015]], (t) => 0.006 - t * 0.003, 8, 4));
    }
    P.add(wr, bm, taperTube([[0, -0.03, 0.03], [-sx * 0.015, -0.06, 0.05], [-sx * 0.03, -0.075, 0.05]], (t) => 0.006 - t * 0.003, 8, 4));
    J['grip' + n] = joint(wr, 0, -0.08, 0);
  }
  // ---- garments & armor ----
  if (o.rags !== false) {
    const loin = new THREE.PlaneGeometry(0.22, 0.42, 4, 6);
    mapVerts(loin, (v) => { v.z += Math.cos(v.x * 14) * 0.012; });
    P.add(hips, M.rag, loin, 0, -0.2, 0.08, -0.1);
    P.add(hips, M.rag, loin, 0, -0.2, -0.08, 0.1, Math.PI);
    const sash = new THREE.CylinderGeometry(0.11, 0.12, 0.06, 16, 1, true);
    P.add(hips, M.rag, sash, 0, 0.0, 0);
  }
  if (o.hood) {
    const hood = shell(0.125, 0, Math.PI * 2, 0, 2.0, 24, 12);
    mapVerts(hood, (v) => { if (v.z > 0.05 && v.y < 0.06) v.z -= (v.z - 0.05) * 1.2; });
    P.add(head, M.rag, hood, 0, 0.04, -0.015, 0, 0, 0, [1.05, 1.1, 1.15]);
    const mantle = new THREE.CylinderGeometry(0.14, 0.27, 0.3, 20, 3, true);
    P.add(chest, M.rag, mantle, 0, 0.14, -0.01);
  }
  if (o.armor === 'rusty' || o.armor === 'king') {
    const am = o.armor === 'king' ? M.gold : M.rust;
    const helm = lathe([[0.112, -0.02], [0.118, 0.05], [0.1, 0.12], [0.05, 0.16], [0.002, 0.17]], 24);
    if (o.armor !== 'king') {
      P.add(head, M.rust, helm, 0, 0.03, -0.005, 0, 0, 0, [1, 1, 1.12]);
      P.add(head, M.rust, frontLathe([[0.118, -0.06], [0.122, 0.02]], 16, Math.PI * 0.9), 0, 0.03, -0.01, 0, Math.PI, 0, [1, 1, 1.12]); // neck guard
      P.add(head, M.rust, rounded(0.012, 0.09, 0.02, 0.004), 0, 0.02, 0.118); // nasal bar
    }
    for (const sx of [-1, 1]) if (o.armor === 'king' || sx > 0) {
      const pd = shell(0.1, 0, Math.PI * 2, 0, 1.3, 20, 8);
      P.add(J['sh' + (sx > 0 ? 'L' : 'R')], am, pd, sx * 0.02, 0.02, 0, 0, 0, sx * 0.3, [1, 0.8, 1.1]);
    }
    if (o.armor === 'king') {
      const plate = frontLathe([[0.13, 0.02], [0.16, 0.1], [0.155, 0.2], [0.11, 0.26]], 24, Math.PI * 0.9);
      P.add(chest, M.rust, plate, 0, 0.0, 0.0, 0, 0, 0, [1, 1, 0.85]);
    } else {
      // a rusted gorget + a strap across the ribs
      P.add(chest, M.rust, lathe([[0.09, 0.22], [0.12, 0.27]], 20), 0, 0, 0);
      P.add(chest, M.rag, taperTube([[0.16, 0.24, 0.0], [0.05, 0.12, 0.1], [-0.12, -0.02, 0.06], [-0.13, -0.05, -0.05]], () => 0.018, 16, 4));
    }
  }
  if (o.crown) {
    const crown = new THREE.CylinderGeometry(0.105, 0.1, 0.05, 20, 1, true);
    P.add(head, M.gold, crown, 0, 0.11, -0.01, -0.12);
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; P.add(head, M.gold, new THREE.ConeGeometry(0.014, 0.09 + (i % 2) * 0.05, 4), Math.sin(a) * 0.1, 0.17 + (i % 2) * 0.025, Math.cos(a) * 0.1 - 0.01, -0.12); }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; P.add(head, M.eye, new THREE.OctahedronGeometry(0.01), Math.sin(a) * 0.104, 0.11, Math.cos(a) * 0.104 - 0.01); }
  }
  if (o.cape) {
    const cape = new THREE.PlaneGeometry(0.55, 1.15, 8, 12);
    mapVerts(cape, (v) => { const t = (0.575 - v.y) / 1.15; v.z = -Math.cos(v.x * 7) * 0.035 * (0.4 + t) - t * t * 0.25; v.x *= 0.8 + t * 0.5; });
    P.add(chest, M.robe, cape, 0, -0.35, -0.14);
  }
  if (o.ice) {
    for (let i = 0; i < 9; i++) {
      const j = [J.shL, J.shR, J.chest, J.head, J.chest][i % 5];
      const c = new THREE.ConeGeometry(0.02 + Math.random() * 0.02, 0.08 + Math.random() * 0.14, 5);
      P.add(j, M.ice, c, (Math.random() - 0.5) * 0.12, 0.06 + Math.random() * 0.05, -0.05 + (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2);
    }
  }
  // weapon
  let weapon = null;
  if (o.weapon) {
    weapon = new THREE.Group();
    J.gripR.add(weapon);
    const wg = weaponGeo(o.weapon);
    const metal = o.weapon === 'staff' ? M.bone : (o.armor === 'king' ? M.rust : M.rust);
    if (wg.metal.length) P.add(weapon, metal, mergeGeometries(wg.metal.map(ni)));
    if (wg.wood.length) P.add(weapon, M.wood, mergeGeometries(wg.wood.map(ni)));
    if (o.weapon === 'staff') {
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 1), M.eye);
      orb.position.set(0.04, 0.02, 1.5); weapon.add(orb); weapon.userData.orb = orb;
    }
  }
  P.build();
  root.scale.setScalar(o.scale || 1);
  return { root, body, hips, hipBase: 0.95, joints: J, eyes, weapon, M };
}

// ---------- wraith ----------
export function buildWraith(M, o = {}) {
  const P = new Parts();
  const root = new THREE.Group();
  const body = joint(root, 0, 0.35, 0);
  const J = {};
  const hips = J.hips = joint(body, 0, 0.9, 0);
  const robe = lathe([[0.14, 0.45], [0.2, 0.3], [0.26, 0.0], [0.34, -0.45], [0.42, -0.85]], 28);
  P.add(hips, M.spirit, robe, 0, 0, 0);
  const chest = J.chest = joint(hips, 0, 0.4, 0);
  const spine = J.spine = chest;
  const neck = J.neck = joint(chest, 0, 0.1, 0);
  const head = J.head = joint(neck, 0, 0.12, 0.04);
  const hood = shell(0.17, 0, Math.PI * 2, 0, 2.1, 24, 12);
  mapVerts(hood, (v) => { if (v.z > 0.04 && v.y < 0.08) v.z -= (v.z - 0.04) * 1.3; v.y *= 1.25; if (v.y > 0.12) v.z -= (v.y - 0.12) * 0.6; });
  P.add(head, M.spirit, hood, 0, 0.0, -0.03);
  P.add(head, M.socket, new THREE.SphereGeometry(0.1, 16, 12), 0, -0.02, -0.03);
  P.add(head, o.boneMat || M.bone, skullGeo(), 0, -0.02, 0.055, 0, 0, 0, 0.8);
  const eyes = new THREE.Group(); head.add(eyes);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), M.eye); e.position.set(sx * 0.027, 0.0, 0.11); eyes.add(e); }
  for (const [n, sx] of [['L', 1], ['R', -1]]) {
    const sh = J['sh' + n] = joint(chest, sx * 0.2, 0.0, 0, 'YXZ');
    P.add(sh, M.spirit, lathe([[0.06, 0.02], [0.08, -0.2], [0.13, -0.45]], 12), 0, 0, 0);
    const el = J['el' + n] = joint(sh, 0, -0.4, 0);
    const wr = J['wr' + n] = joint(el, 0, -0.08, 0);
    for (let f = 0; f < 4; f++) {
      const z = -0.03 + f * 0.02;
      P.add(wr, o.boneMat || M.bone, taperTube([[0, 0, z], [-sx * 0.01, -0.12, z + 0.02], [-sx * 0.05, -0.24, z + 0.05]], (t) => 0.008 * (1 - t) + 0.0015, 10, 4));
    }
  }
  P.build();
  root.scale.setScalar(o.scale || 1);
  return { root, body, hips, hipBase: 0.9, joints: J, eyes, M, flying: true };
}

// ---------- priest (caster) ----------
export function buildPriest(M, o = {}) {
  const sk = buildSkeleton(M, { rags: false, weapon: 'staff', hood: false });
  const P = new Parts();
  const J = sk.joints;
  const robe = lathe([[0.16, 0.42], [0.2, 0.25], [0.22, 0.0], [0.3, -0.5], [0.38, -0.92]], 28);
  mapVerts(robe, (v) => { const a = Math.atan2(v.z, v.x); v.x += Math.sin(a * 7) * 0.01 * (-v.y + 0.4); v.z += Math.cos(a * 7) * 0.01 * (-v.y + 0.4); });
  P.add(J.hips, M.robe, robe, 0, 0, 0);
  const mantle = lathe([[0.1, 0.32], [0.2, 0.25], [0.3, 0.08], [0.31, -0.05]], 24);
  P.add(J.chest, M.robe, mantle, 0, 0, 0);
  const hood = shell(0.135, 0, Math.PI * 2, 0, 2.0, 24, 12);
  mapVerts(hood, (v) => { if (v.z > 0.04 && v.y < 0.07) v.z -= (v.z - 0.04) * 1.2; v.y *= 1.2; });
  P.add(J.head, M.robe, hood, 0, 0.04, -0.02, 0, 0, 0, [1.05, 1.1, 1.15]);
  // antler crown
  for (const sx of [-1, 1]) {
    P.add(J.head, M.boneDark, taperTube([[sx * 0.06, 0.12, -0.02], [sx * 0.11, 0.22, -0.03], [sx * 0.13, 0.33, -0.06], [sx * 0.11, 0.42, -0.1]], (t) => 0.014 * (1 - t) + 0.003, 14, 5));
    P.add(J.head, M.boneDark, taperTube([[sx * 0.11, 0.24, -0.035], [sx * 0.17, 0.3, -0.02], [sx * 0.2, 0.34, 0.0]], (t) => 0.009 * (1 - t) + 0.002, 8, 4));
  }
  for (const n of ['L', 'R']) P.add(J['sh' + n], M.robe, lathe([[0.06, 0.03], [0.08, -0.15], [0.12, -0.33]], 12), 0, 0, 0);
  // hanging chains + skull charm
  for (let i = 0; i < 9; i++) P.add(J.chest, M.rust, new THREE.TorusGeometry(0.012, 0.003, 4, 8), -0.05 + i * 0.012, 0.05 - Math.sin(i / 8 * Math.PI) * 0.12, 0.17, 0, (i % 2) * Math.PI / 2);
  P.build();
  return sk;
}

// ---------- golem (frost / magma boss & brutes) ----------
export function buildGolem(M, o = {}) {
  const mat = o.mat || M.rock, glow = o.glow || M.eye;
  const P = new Parts();
  const root = new THREE.Group();
  const body = joint(root);
  const J = {};
  const rng = makeRng(o.seed || 7);
  const hips = J.hips = joint(body, 0, 1.0, 0);
  P.add(hips, mat, rockGeo(0.32, 2, rng() * 9, 0.3, [1.2, 0.7, 0.9]), 0, 0, 0);
  for (const [n, sx] of [['L', 1], ['R', -1]]) {
    const th = J['thigh' + n] = joint(hips, sx * 0.22, -0.08, 0);
    P.add(th, mat, rockGeo(0.2, 2, rng() * 9, 0.3, [1, 1.4, 1]), 0, -0.22, 0);
    const sh = J['shin' + n] = joint(th, 0, -0.45, 0);
    P.add(sh, mat, rockGeo(0.19, 2, rng() * 9, 0.3, [1, 1.5, 1]), 0, -0.22, 0);
    const ft = J['foot' + n] = joint(sh, 0, -0.46, 0);
    P.add(ft, mat, rockGeo(0.2, 1, rng() * 9, 0.3, [1.1, 0.5, 1.4]), 0, -0.04, 0.06);
  }
  const spine = J.spine = joint(hips, 0, 0.18, 0);
  P.add(spine, mat, rockGeo(0.3, 2, rng() * 9, 0.3, [1.1, 0.8, 0.9]), 0, 0.1, 0);
  const chest = J.chest = joint(spine, 0, 0.3, 0);
  P.add(chest, mat, rockGeo(0.48, 3, rng() * 9, 0.28, [1.3, 0.95, 0.95]), 0, 0.22, -0.02);
  // glowing core visible through cracks
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), glow); core.position.set(0, 0.22, 0.32); chest.add(core);
  const neck = J.neck = joint(chest, 0, 0.55, 0.08);
  const head = J.head = joint(neck, 0, 0.12, 0.06);
  P.add(head, mat, rockGeo(0.2, 2, rng() * 9, 0.3, [1.1, 0.85, 1]), 0, 0.05, 0);
  const eyes = new THREE.Group(); head.add(eyes);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), glow); e.position.set(sx * 0.07, 0.06, 0.17); e.scale.set(1.4, 0.6, 1); eyes.add(e); }
  for (const [n, sx] of [['L', 1], ['R', -1]]) {
    const sh = J['sh' + n] = joint(chest, sx * 0.55, 0.42, 0, 'YXZ');
    P.add(sh, mat, rockGeo(0.26, 2, rng() * 9, 0.32, [1.1, 0.9, 1]), sx * 0.04, 0.0, 0);
    P.add(sh, mat, rockGeo(0.17, 2, rng() * 9, 0.3, [1, 1.5, 1]), 0, -0.3, 0);
    const el = J['el' + n] = joint(sh, 0, -0.55, 0);
    P.add(el, mat, rockGeo(0.17, 2, rng() * 9, 0.3, [1, 1.6, 1]), 0, -0.25, 0);
    const wr = J['wr' + n] = joint(el, 0, -0.52, 0);
    P.add(wr, mat, rockGeo(0.24, 2, rng() * 9, 0.32, [1.1, 1, 1.1]), 0, -0.1, 0.02);
    J['grip' + n] = joint(wr, 0, -0.12, 0);
  }
  // crystals / spikes
  if (o.crystals) {
    for (let i = 0; i < 16; i++) {
      const j = [J.chest, J.shL, J.shR, J.chest, J.spine][i % 5];
      const c = new THREE.ConeGeometry(0.05 + rng() * 0.06, 0.25 + rng() * 0.45, 5);
      P.add(j, o.crystals, c, (rng() - 0.5) * 0.5, 0.25 + rng() * 0.2, -0.15 - rng() * 0.25, -0.5 - rng() * 0.6, rng() * 6, (rng() - 0.5) * 0.9);
    }
  }
  let weapon = null;
  if (o.weapon) {
    weapon = new THREE.Group(); J.gripR.add(weapon);
    const wg = weaponGeo(o.weapon);
    if (wg.metal.length) P.add(weapon, o.weaponMat || M.rust, mergeGeometries(wg.metal.map(ni)));
    if (wg.wood.length) P.add(weapon, M.wood, mergeGeometries(wg.wood.map(ni)));
    weapon.scale.setScalar(1.4);
  }
  P.build();
  root.scale.setScalar(o.scale || 1);
  return { root, body, hips, hipBase: 1.0, joints: J, eyes, core, weapon, M };
}
