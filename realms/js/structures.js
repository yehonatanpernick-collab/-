import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as A from './assets.js';

let stoneTex = null;
export async function initStructures() {
  const [c, n, d, dn] = await Promise.all([A.tex('tex/stone_color.webp'), A.tex('tex/stone_normal.webp', { srgb: false }), A.tex('tex/dirt_color.jpg'), A.tex('tex/noise.png', { srgb: false })]);
  stoneTex = { c, n, d, noise: dn };
}
// world-space triplanar stone (no UV seams on procedural geometry)
const matCache = {};
export function stoneMat(tint = '#d8d2c4', { scale = 0.35, rough = 0.85, emissive = null, moss = 0, marble = 0 } = {}) {
  const key = [tint, scale, rough, emissive, moss, marble].join();
  if (matCache[key]) return matCache[key];
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness: rough, metalness: 0, emissive: emissive || '#000000' });
  m.onBeforeCompile = sh => {
    sh.uniforms.tS = { value: stoneTex.c }; sh.uniforms.tSN = { value: stoneTex.n }; sh.uniforms.tNz = { value: stoneTex.noise };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wpp = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
        wpp = instanceMatrix * wpp;
        #endif
        vWP = (modelMatrix * wpp).xyz;
        mat3 nm = mat3(modelMatrix);
        #ifdef USE_INSTANCING
        nm = nm * mat3(instanceMatrix);
        #endif
        vWN = normalize(nm * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D tS, tSN, tNz; varying vec3 vWP; varying vec3 vWN;
      vec3 trp(sampler2D t, vec3 p, vec3 b){ return texture2D(t, p.zy).rgb * b.x + texture2D(t, p.xz).rgb * b.y + texture2D(t, p.xy).rgb * b.z; }`)
      .replace('#include <map_fragment>', `
        vec3 bw = pow(abs(normalize(vWN)), vec3(4.)); bw /= dot(bw, vec3(1.));
        vec3 sp = vWP * ${scale.toFixed(3)};
        vec3 sc = trp(tS, sp, bw);
        float nz = texture2D(tNz, vWP.xz * 0.05 + vWP.y * 0.02).r;
        ${marble ? `sc = mix(vec3(dot(sc, vec3(0.33))) * 0.4 + 0.62, sc, 0.25); sc *= 0.92 + 0.12 * nz;` : ''}
        ${moss ? `float mm = smoothstep(0.35, 0.9, normalize(vWN).y + nz * 0.6) * ${moss.toFixed(2)}; sc = mix(sc, vec3(0.16, 0.26, 0.09), mm);` : ''}
        diffuseColor.rgb *= sc * 1.25;`)
      .replace('#include <normal_fragment_maps>', `{ vec3 tn = trp(tSN, sp, bw) * 2. - 1.; vec3 wn = normalize(normalize(vWN) + vec3(tn.x, 0., tn.y) * 0.5 * (1. - bw.y) + vec3(tn.x, 0., tn.y) * 0.35 * bw.y);
         normal = normalize((viewMatrix * vec4(wn, 0.)).xyz); }`);
  };
  m.customProgramCacheKey = () => 'stone' + key;
  matCache[key] = m; return m;
}
export const glowMat = (c, i = 3) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.4 });

function mesh(geo, mat, parent, { shadow = true } = {}) { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m; }
const T = (g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => { const q = g.clone(); q.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3().setScalar(s))); return q; };

// fluted classical column (base at y=0)
export function columnGeometry(h = 7, r = 0.55, broken = false) {
  const pts = [];
  const top = broken ? h * (0.35 + Math.random() * 0.35) : h;
  pts.push(new THREE.Vector2(0, 0), new THREE.Vector2(r * 1.45, 0), new THREE.Vector2(r * 1.45, 0.25), new THREE.Vector2(r * 1.25, 0.32), new THREE.Vector2(r * 1.2, 0.5), new THREE.Vector2(r * 1.05, 0.58));
  for (let i = 0; i <= 8; i++) { const t = i / 8, y = 0.6 + (top - 1.3) * t; pts.push(new THREE.Vector2(r * (1 - t * 0.12) * (1 + Math.sin(t * Math.PI) * 0.03), y)); }
  if (!broken) pts.push(new THREE.Vector2(r * 1.1, top - 0.6), new THREE.Vector2(r * 1.35, top - 0.35), new THREE.Vector2(r * 1.55, top - 0.3), new THREE.Vector2(r * 1.55, top), new THREE.Vector2(0, top));
  else pts.push(new THREE.Vector2(r * 0.85, top - 0.1), new THREE.Vector2(r * 0.3, top + 0.15), new THREE.Vector2(0, top));
  const g = new THREE.LatheGeometry(pts, 20);
  // flutes
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.65 && y < top - 0.65) { const a = Math.atan2(p.getZ(i), p.getX(i)), k = 1 - 0.045 * Math.max(0, Math.cos(a * 20)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } }
  g.computeVertexNormals();
  return g;
}

export function stoneCircle(parent, x, y, z, R = 9, n = 9, mat) {
  const geos = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, h = 4 + Math.random() * 2.5;
    const bx = new THREE.BoxGeometry(1.4, h, 0.9, 2, 4, 2); const pp = bx.attributes.position;
    for (let k = 0; k < pp.count; k++) { pp.setX(k, pp.getX(k) * (1 + (Math.random() - 0.5) * 0.12) * (pp.getY(k) > 0 ? 0.85 : 1)); pp.setZ(k, pp.getZ(k) * (1 + (Math.random() - 0.5) * 0.15)); }
    bx.computeVertexNormals();
    geos.push(T(bx, x + Math.cos(a) * R, y + h / 2 - 0.3, z + Math.sin(a) * R, (Math.random() - 0.5) * 0.08, -a + Math.PI / 2, (Math.random() - 0.5) * 0.1));
    if (i % 3 === 0) geos.push(T(new THREE.BoxGeometry(3.8, 0.7, 1), x + Math.cos(a + 0.35) * R, y + h - 0.1, z + Math.sin(a + 0.35) * R, 0, -a - 0.35 + Math.PI / 2, 0));
  }
  geos.push(T(new THREE.CylinderGeometry(3.2, 3.6, 0.6, 28), x, y + 0.05, z));
  geos.push(T(new THREE.CylinderGeometry(1.2, 1.4, 1.2, 16), x, y + 0.6, z));
  return mesh(mergeGeometries(geos.map(g => g.index ? g.toNonIndexed() : g).map(g => { g.deleteAttribute('uv'); return g; })), mat, parent);
}

// Sun beacon: pillar with brazier; light(true) ignites it
export function beacon(parent, x, y, z, mat, color = '#ffb347') {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  mesh(columnGeometry(4.2, 0.5), mat, g);
  const bowl = new THREE.LatheGeometry([new THREE.Vector2(0.2, 0), new THREE.Vector2(0.9, 0.2), new THREE.Vector2(1.25, 0.65), new THREE.Vector2(1.15, 0.7), new THREE.Vector2(0.8, 0.35), new THREE.Vector2(0, 0.35)], 20);
  const bm = mesh(bowl, new THREE.MeshStandardMaterial({ color: '#b08a3c', metalness: 0.85, roughness: 0.35 }), g); bm.position.y = 4.2;
  const fire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 2), glowMat(color, 6)); fire.position.y = 5.1; fire.visible = false; g.add(fire);
  const light = new THREE.PointLight(color, 0, 18, 1.6); light.position.y = 5.6; g.add(light);
  return { group: g, fire, light, lit: false, pos: new THREE.Vector3(x, y + 5, z) };
}

// swirling portal
export function portal(parent, x, y, z, color = '#9fd8ff', color2 = '#ffffff', ry = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
  const sm = stoneMat('#cfc8b8', { moss: 0.3 });
  const arch = [];
  for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI; const b = new THREE.BoxGeometry(0.9, 1.1, 1.1); arch.push(T(b, Math.cos(a) * 3.4, 3.4 + Math.sin(a) * 3.4, 0, 0, 0, a - Math.PI / 2)); }
  arch.push(T(new THREE.BoxGeometry(1.2, 3.6, 1.3), -3.4, 1.8, 0), T(new THREE.BoxGeometry(1.2, 3.6, 1.3), 3.4, 1.8, 0), T(new THREE.CylinderGeometry(4.6, 5, 0.5, 24), 0, 0.1, 0));
  mesh(mergeGeometries(arch.map(q => { const n = q.toNonIndexed(); n.deleteAttribute('uv'); return n; })), sm, g);
  const u = { uTime: { value: 0 }, uC1: { value: new THREE.Color(color) }, uC2: { value: new THREE.Color(color2) }, uOpen: { value: 0 } };
  const disc = new THREE.Mesh(new THREE.CircleGeometry(3.05, 64), new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform float uTime, uOpen; uniform vec3 uC1, uC2; varying vec2 vUv;
      void main(){ vec2 p = vUv - 0.5; float r = length(p) * 2.; float a = atan(p.y, p.x);
        float sw = sin(a * 5. + r * 14. - uTime * 4.) * 0.5 + 0.5; float sw2 = sin(a * 3. - r * 9. + uTime * 2.7) * 0.5 + 0.5;
        float core = (1. - smoothstep(0., 1., r)); float rim = smoothstep(0.75, 1., r) * (1. - smoothstep(0.95, 1.02, r));
        vec3 c = mix(uC1, uC2, sw * sw2) * (core * (0.4 + sw * 0.8) + rim * 2.5);
        gl_FragColor = vec4(c * uOpen * 1.6, 1.); }`,
  }));
  disc.position.y = 3.4; g.add(disc);
  const light = new THREE.PointLight(color, 0, 22, 1.5); light.position.set(0, 3.4, 1.5); g.add(light);
  return { group: g, u, light, pos: new THREE.Vector3(x, y + 1, z), open: false };
}

// classical temple (front faces +z of its local frame)
export function temple(parent, x, y, z, ry, mat) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
  const W = 22, D = 15;
  const base = [];
  for (let i = 0; i < 4; i++) base.push(T(new THREE.BoxGeometry(W + 4 - i * 1.2, 0.5, D + 4 - i * 1.2), 0, 0.25 + i * 0.5, 0));
  const cols = [];
  const pos = [];
  for (let i = 0; i < 7; i++) for (const zz of [-D / 2 + 1, D / 2 - 1]) pos.push([-W / 2 + 1.5 + i * (W - 3) / 6, zz]);
  for (let i = 1; i < 4; i++) for (const xx of [-W / 2 + 1.5, W / 2 - 1.5]) pos.push([xx, -D / 2 + 1 + i * (D - 2) / 4]);
  const ch = 8.5;
  pos.forEach(([cx, cz], i) => { const broken = (i === 3 || i === 10 || i === 17); cols.push(T(columnGeometry(broken ? ch * 0.55 : ch, 0.62, broken), cx, 2, cz)); });
  const top = [T(new THREE.BoxGeometry(W - 0.6, 1.0, D - 0.6), 0, 2 + ch + 0.5, 0), T(new THREE.BoxGeometry(W, 0.5, D), 0, 2 + ch + 1.25, 0)];
  // pediment front/back
  for (const zz of [-D / 2 + 0.2, D / 2 - 0.2]) { const s = new THREE.Shape(); s.moveTo(-W / 2, 0); s.lineTo(W / 2, 0); s.lineTo(0, 3.2); s.closePath(); const pg = new THREE.ExtrudeGeometry(s, { depth: 0.8, bevelEnabled: false }); top.push(T(pg, 0, 2 + ch + 1.5, zz - 0.4)); }
  // roof slabs
  const rl = Math.hypot(W / 2, 3.2);
  for (const sgn of [-1, 1]) top.push(T(new THREE.BoxGeometry(rl + 0.6, 0.4, D + 0.4), sgn * W / 4, 2 + ch + 3.1, 0, 0, 0, -sgn * Math.atan2(3.2, W / 2)));
  // inner sanctum
  top.push(T(new THREE.BoxGeometry(W - 9, 7, D - 7), 0, 2 + 3.5, -1.2));
  const all = [...base, ...cols, ...top].map(q => { const n = q.index ? q.toNonIndexed() : q; if (n.attributes.uv) n.deleteAttribute('uv'); return n; });
  mesh(mergeGeometries(all), mat, g);
  return { group: g, colPos: pos, W, D, floor: y + 2 };
}

export function obelisk(parent, x, y, z, mat, color = '#b05cff') {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  const geo = new THREE.CylinderGeometry(0.5, 1.2, 9, 4, 6); geo.rotateY(Math.PI / 4); geo.translate(0, 4.5, 0);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 8.9) { p.setX(i, 0); p.setZ(i, 0); p.setY(i, 10.5); }
  geo.computeVertexNormals();
  const body = mesh(geo, mat, g);
  const runeMat = glowMat(color, 4);
  for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.5, 0.05), runeMat); const a = i * Math.PI / 2; r.position.set(Math.sin(a) * 0.86, 4.2, Math.cos(a) * 0.86); r.rotation.y = a; r.rotation.x = Math.sin(a) * 0.07; r.rotation.z = -Math.cos(a) * 0.07; g.add(r); }
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), glowMat(color, 6)); core.position.y = 12; g.add(core);
  const light = new THREE.PointLight(color, 30, 16, 1.8); light.position.y = 6; g.add(light);
  for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.5, 5), mat); const a = i / 5 * Math.PI * 2; s.position.set(Math.cos(a) * 2.4, 0.8, Math.sin(a) * 2.4); s.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); s.castShadow = true; g.add(s); }
  return { group: g, core, light, runeMat, pos: new THREE.Vector3(x, y, z), hp: 220, maxHp: 220, alive: true, radius: 1.6, height: 9 };
}

export function cage(parent, x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  const iron = new THREE.MeshStandardMaterial({ color: '#2e2a30', metalness: 0.8, roughness: 0.45 });
  const geos = [];
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; geos.push(T(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), Math.cos(a) * 0.9, 1.3, Math.sin(a) * 0.9)); }
  geos.push(T(new THREE.TorusGeometry(0.92, 0.07, 6, 24), 0, 0.1, 0, Math.PI / 2), T(new THREE.TorusGeometry(0.92, 0.07, 6, 24), 0, 2.6, 0, Math.PI / 2), T(new THREE.SphereGeometry(0.95, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 2.55, 0), T(new THREE.TorusGeometry(0.25, 0.05, 6, 16), 0, 3.6, 0));
  geos.push(T(new THREE.CylinderGeometry(0.03, 0.03, 30, 4), 0, 18.5, 0));
  const all = mergeGeometries(geos.map(q => { const n = q.index ? q.toNonIndexed() : q; n.deleteAttribute('uv'); return n; }));
  const m = mesh(all, iron, g);
  const fairy = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), glowMat('#c8fff4', 6)); fairy.position.y = 1.4; g.add(fairy);
  const light = new THREE.PointLight('#8fffe0', 14, 9, 1.8); light.position.y = 1.4; g.add(light);
  g.position.y += 0.6; // hanging slightly above ground
  return { group: g, bars: m, fairy, light, pos: new THREE.Vector3(x, y, z), open: false };
}

export function crystalCluster(parent, x, y, z, color = '#7fe8ff', s = 1) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(s); parent.add(g);
  const m = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.08, metalness: 0, transmission: 0, clearcoat: 1, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 7; i++) {
    const h = 1.2 + Math.random() * 2.2; const geo = new THREE.CylinderGeometry(0, 0.3 + Math.random() * 0.2, 0.6, 6); geo.translate(0, h + 0.3, 0);
    const shaft = new THREE.CylinderGeometry(0.3, 0.32, h, 6); shaft.translate(0, h / 2, 0);
    const c = new THREE.Mesh(mergeGeometries([shaft, geo]), m); const a = i * 0.9;
    c.position.set(Math.cos(a) * (i ? 0.5 : 0), 0, Math.sin(a) * (i ? 0.5 : 0)); c.rotation.set(Math.sin(a) * 0.5 * (i ? 1 : 0), Math.random() * 3, Math.cos(a) * 0.5 * (i ? 1 : 0)); c.castShadow = true; g.add(c);
  }
  return g;
}

export function floatingIsland(parent, x, y, z, r, grassTint = '#6f9a48', rockMat) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  const geo = new THREE.ConeGeometry(r, r * 2.4, 10, 5); geo.rotateX(Math.PI); geo.translate(0, -r * 1.2, 0);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + (Math.sin(i * 12.9898) * 0.5) * 0.25; if (p.getY(i) < -0.2) { p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } }
  geo.computeVertexNormals();
  mesh(geo, rockMat, g);
  const top = new THREE.CylinderGeometry(r * 1.02, r * 0.98, 0.5, 20, 1); top.translate(0, 0.0, 0);
  mesh(top, new THREE.MeshStandardMaterial({ color: grassTint, roughness: 0.95 }), g);
  return g;
}
