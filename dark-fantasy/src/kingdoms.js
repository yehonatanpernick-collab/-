// ============================================================
//  The four kingdoms — themes, terrain, props, lights
// ============================================================
import * as THREE from 'three';
import { scene, applySky, bakeEnvironment, applyGrade, HeightFog, Q } from './engine.js';
import { pbr } from './texgen.js';
import { lathe, frontLathe, taperTube, tube, rounded, mapVerts, scaleUV, ni, mergeGeometries } from './geo.js';
import { terrainMaterial, buildTerrain, buildGrass, scatter, ambientParticles } from './world.js';
import { rockGeo } from './undead.js';
import { fbm2, ridged2, makeRng, smoothstep, setNoiseSeed } from './noise.js';

export const ARENA_R = 29;

export const KINGDOMS = [
  {
    id: 'ash', numeral: 'I', name: 'ממלכת האפר', sub: 'בית הקברות שתחת הירח האדום',
    lore: 'כאן נקברו אבירי המשמר. עכשיו הם קמים — ואינם זוכרים את שמם.',
    sky: { zenith: 0x040309, horizon: 0x1a0f18, groundCol: 0x050304, glowCol: 0x7a1c14, glowHDR: 0.8, sunDir: new THREE.Vector3(-0.35, 0.3, -1), sunCol: 0xff7a5a, sunColHDR: 2.4, sunSize: 0.042, stars: 1, clouds: 0.55, cloudCol: 0x0a0709, cloudLit: 0x5a2018, craters: 1 },
    fog: [0x130b10, 0.012, 0.15], sun: [0xc8b0bc, 1.9], hemi: [0x4a4268, 0x140c0c, 0.5],
    grade: { lift: [0.008, 0.0, 0.016], gamma: [1, 1, 1.02], gain: [1.04, 0.98, 0.96], sat: 0.82, contrast: 1.12, exposure: 1.15, rayCol: 0xff6040, rayStr: 0.7, bloom: 0.55 },
    particles: [{ n: 700, color: [3, 0.9, 0.25], size: 0.06, fall: 0.5, swirl: 1.2 }, { n: 1600, color: [0.32, 0.3, 0.33], size: 0.04, fall: -0.35, swirl: 1.5, additive: false, flicker: false }],
    wind: [1.2, 0.4],
  },
  {
    id: 'frost', numeral: 'II', name: 'ממלכת הכפור', sub: 'האגם הקפוא של המלכה שנשכחה',
    lore: 'השלג כאן אינו נמס מאז הלילה שבו נשבר הכתר. מתחת לקרח — עיניים פקוחות.',
    sky: { zenith: 0x020409, horizon: 0x1a2a40, groundCol: 0x04070b, glowCol: 0x6080c0, glowHDR: 0.7, sunDir: new THREE.Vector3(0.5, 0.36, -0.8), sunCol: 0xdce8ff, sunColHDR: 2.0, sunSize: 0.03, stars: 1.4, clouds: 0.3, cloudCol: 0x0a1018, cloudLit: 0x6a88a8, aurora: 1, auroraCol: 0x2aff96, craters: 1 },
    fog: [0x1e2c42, 0.013, 0.11], sun: [0xb8d0ff, 2.6], hemi: [0x6a8ab8, 0x1a2028, 0.75],
    grade: { lift: [0.0, 0.006, 0.02], gamma: [1, 1, 1], gain: [0.95, 1.0, 1.07], sat: 0.85, contrast: 1.08, exposure: 1.1, rayCol: 0x9ac8ff, rayStr: 0.55, bloom: 0.6 },
    particles: [{ n: 2600, color: [0.9, 0.95, 1.0], size: 0.05, fall: -1.1, swirl: 0.8, additive: false, flicker: false }, { n: 300, color: [0.4, 1.2, 1.6], size: 0.05, fall: 0.2, swirl: 1.2 }],
    wind: [2.2, 0.8],
  },
  {
    id: 'ember', numeral: 'III', name: 'ממלכת הלהבה', sub: 'הכבשן שבלב ההר הבוער',
    lore: 'הנפחים היו מחשלים כאן חרבות לאלים. הם עדיין עובדים — מן הצד השני של המוות.',
    sky: { zenith: 0x070302, horizon: 0x5a1a08, groundCol: 0x080302, glowCol: 0xff4010, glowHDR: 1.4, sunDir: new THREE.Vector3(0.25, 0.14, -1), sunCol: 0xff5a20, sunColHDR: 3.0, sunSize: 0.065, stars: 0.15, clouds: 0.85, cloudCol: 0x160a07, cloudLit: 0xff4a10, cloudSpeed: 0.012, craters: 0.2 },
    fog: [0x1e0c06, 0.013, 0.1], sun: [0xff9a68, 2.0], hemi: [0x5a3028, 0x180604, 0.5],
    grade: { lift: [0.006, 0.0, 0.004], gamma: [1, 1, 0.98], gain: [1.04, 0.96, 0.9], sat: 0.92, contrast: 1.12, exposure: 1.0, rayCol: 0xff7a30, rayStr: 0.5, bloom: 0.6 },
    particles: [{ n: 1400, color: [4, 1.2, 0.25], size: 0.06, fall: 1.2, swirl: 1.4 }, { n: 1500, color: [0.12, 0.1, 0.1], size: 0.05, fall: -0.6, swirl: 1.2, additive: false, flicker: false }],
    wind: [0.8, 0.3],
  },
  {
    id: 'void', numeral: 'IV', name: 'ממלכת הצל', sub: 'כס המלכות שנשבר מעל התהום',
    lore: 'מעבר לשמיים יש מקום שבו אפילו האור שוכח לחזור. שם יושב מי שהיה פעם אתה.',
    sky: { zenith: 0x020106, horizon: 0x16082c, groundCol: 0x010003, glowCol: 0x8a40ff, glowHDR: 1.1, sunDir: new THREE.Vector3(0.05, 0.42, -1), sunCol: 0xe0c0ff, sunColHDR: 2.6, sunSize: 0.05, stars: 2.2, nebula: 1, nebulaCol: 0x6a20c0, clouds: 0, craters: 0.3 },
    fog: [0x120a22, 0.009, 0.06], sun: [0xc0a0ff, 2.1], hemi: [0x5a40a0, 0x0a0614, 0.6],
    grade: { lift: [0.01, 0.0, 0.03], gamma: [1, 1, 1], gain: [0.98, 0.95, 1.08], sat: 0.95, contrast: 1.12, exposure: 1.15, rayCol: 0xb080ff, rayStr: 0.6, bloom: 0.7 },
    particles: [{ n: 900, color: [1.4, 0.6, 3.5], size: 0.06, fall: 0.6, swirl: 1.4 }, { n: 500, color: [0.8, 0.8, 1.2], size: 0.03, fall: 0.2, swirl: 2 }],
    wind: [0.6, 0.6],
  },
];

// ------------------------------------------------------------
function heightFns(id) {
  const R = ARENA_R;
  if (id === 'ash') {
    const g = (x, z) => { const r = Math.hypot(x, z); return (fbm2(x * 0.06 + 10, z * 0.06 + 10, 3) - 0.5) * 1.2 * smoothstep(4.5, 10, r) + smoothstep(R + 5, R + 32, r) * (5 + fbm2(x * 0.03 + 3, z * 0.03 + 1, 5) * 24); };
    return { ground: g, walk: g };
  }
  if (id === 'frost') {
    const g = (x, z) => { const r = Math.hypot(x, z); let h = (fbm2(x * 0.05, z * 0.05, 3) - 0.5) * 1.4 * smoothstep(9, 14, r); h -= 0.7 * (1 - smoothstep(8.5, 10.5, r)); h += smoothstep(R + 4, R + 34, r) * (9 + ridged2(x * 0.02 + 2, z * 0.02, 5) * 42); return h; };
    return { ground: g, walk: (x, z) => Math.max(g(x, z), Math.hypot(x, z) < 10.2 ? 0.0 : -9) };
  }
  if (id === 'ember') {
    const pools = [[11, -8, 3.2], [-12, -6, 2.6], [-4, 14, 3.0], [15, 9, 2.2]];
    const g = (x, z) => {
      const r = Math.hypot(x, z);
      let h = (fbm2(x * 0.07, z * 0.07, 4) - 0.5) * 1.6 * smoothstep(5, 10, r);
      for (const [px, pz, pr] of pools) h -= 1.4 * (1 - smoothstep(pr * 0.6, pr + 0.8, Math.hypot(x - px, z - pz)));
      h += smoothstep(R + 3, R + 26, r) * (8 + ridged2(x * 0.025, z * 0.025 + 5, 5) * 36);
      return h;
    };
    const walk = (x, z) => Math.max(g(x, z), -0.35);
    return { ground: g, walk, pools };
  }
  // void: floating island
  const g = (x, z) => {
    const r = Math.hypot(x, z);
    const edge = 33 + (fbm2(x * 0.08, z * 0.08, 3) - 0.5) * 5;
    let h = (fbm2(x * 0.05 + 4, z * 0.05, 3) - 0.5) * 1.0 * smoothstep(6, 12, r);
    h -= smoothstep(edge - 1, edge + 5, r) * 70;
    return h;
  };
  return { ground: g, walk: g };
}

// ------------------------------------------------------------
//  Prop geometry
// ------------------------------------------------------------
function deadTreeGeo(rng, scale = 1, gnarl = 1) {
  const geos = [];
  const up = new THREE.Vector3(0, 1, 0);
  function branch(start, dir, len, rad, depth) {
    const pts = [start.clone()];
    let p = start.clone(), d = dir.clone();
    for (let i = 0; i < 3; i++) {
      d.add(new THREE.Vector3((rng() - 0.5) * 0.5 * gnarl, (rng() - 0.3) * 0.25, (rng() - 0.5) * 0.5 * gnarl)).normalize();
      p = p.clone().addScaledVector(d, len / 3);
      pts.push(p);
    }
    geos.push(ni(taperTube(pts, (t) => rad * (1 - t * 0.45), 8, 7)));
    if (depth <= 0 || rad < 0.025) return;
    const kids = depth > 3 ? 2 : 2 + Math.floor(rng() * 2);
    for (let k = 0; k < kids; k++) {
      const nd = d.clone().add(new THREE.Vector3((rng() - 0.5) * 2, rng() * 0.8 - 0.1, (rng() - 0.5) * 2).multiplyScalar(0.8)).normalize();
      branch(p, nd, len * (0.62 + rng() * 0.2), rad * (0.5 + rng() * 0.15), depth - 1);
    }
  }
  // flared roots
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng();
    geos.push(ni(taperTube([[0, 0.5, 0], [Math.cos(a) * 0.4, 0.12, Math.sin(a) * 0.4], [Math.cos(a) * 0.9, -0.1, Math.sin(a) * 0.9]], (t) => 0.2 * (1 - t) + 0.03, 8, 6)));
  }
  branch(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3((rng() - 0.5) * 0.3, 1, (rng() - 0.5) * 0.3).normalize(), 3.2, 0.32, 5);
  const g = mergeGeometries(geos);
  g.scale(scale, scale, scale);
  return g;
}

function pineGeo(rng, h = 9, snow = true) {
  const geos = [], cols = [];
  const add = (g, c) => { g = ni(g); geos.push(g); const n = g.attributes.position.count; const p = g.attributes.position; for (let i = 0; i < n; i++) { const top = c === 'snowtop' ? 1 : 0; const y = p.getY(i); cols.push(...(c === 'trunk' ? [0.18, 0.13, 0.1] : [0.05, 0.08, 0.06])); } return g; };
  const trunk = new THREE.CylinderGeometry(0.08, 0.28, h, 8);
  trunk.translate(0, h / 2 - 0.3, 0);
  add(trunk, 'trunk');
  const layers = 9;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const y = 1.6 + t * (h - 2);
    const r = (1 - t) * 2.6 + 0.35;
    const cone = new THREE.ConeGeometry(r, 1.6 - t * 0.6, 14, 3, true);
    mapVerts(cone, (v) => {
      const a = Math.atan2(v.z, v.x);
      const droop = Math.sin(a * 7 + i) * 0.12;
      const rr = Math.hypot(v.x, v.z);
      v.y += droop - rr * 0.18 + (Math.sin(a * 13 + i * 2) * 0.1) * (rr / r);
      v.x *= 1 + Math.sin(a * 5 + i * 3) * 0.12; v.z *= 1 + Math.sin(a * 5 + i * 3) * 0.12;
    });
    cone.translate(0, y, 0);
    add(cone, 'needle');
  }
  const g = mergeGeometries(geos);
  // vertex colors: dark needles, snow accumulating on upward-facing surfaces
  g.computeVertexNormals();
  const n = g.attributes.normal, p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let c = [cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]];
    if (snow && c[0] < 0.1) { const s = smoothstep(0.35, 0.75, n.getY(i)) * (0.7 + 0.3 * Math.sin(p.getX(i) * 7 + p.getZ(i) * 5)); c = [c[0] + (0.85 - c[0]) * s, c[1] + (0.9 - c[1]) * s, c[2] + (0.98 - c[2]) * s]; }
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function headstoneGeos() {
  const round = mergeGeometries([ni(rounded(0.62, 0.8, 0.14, 0.02).translate(0, 0.4, 0)), ni(new THREE.CylinderGeometry(0.31, 0.31, 0.14, 20, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0.8, 0))]);
  const cross = mergeGeometries([ni(rounded(0.13, 1.3, 0.13, 0.02).translate(0, 0.65, 0)), ni(rounded(0.62, 0.13, 0.13, 0.02).translate(0, 0.95, 0)), ni(rounded(0.3, 0.12, 0.25, 0.02).translate(0, 0.06, 0))]);
  const celtic = mergeGeometries([ni(rounded(0.14, 1.5, 0.14, 0.02).translate(0, 0.75, 0)), ni(rounded(0.7, 0.14, 0.14, 0.02).translate(0, 1.1, 0)), ni(new THREE.TorusGeometry(0.2, 0.035, 6, 24).translate(0, 1.1, 0)), ni(rounded(0.36, 0.22, 0.3, 0.03).translate(0, 0.1, 0))]);
  const obelisk = mergeGeometries([ni(new THREE.CylinderGeometry(0.1, 0.17, 1.9, 4).rotateY(Math.PI / 4).translate(0, 1.15, 0)), ni(new THREE.ConeGeometry(0.11, 0.25, 4).rotateY(Math.PI / 4).translate(0, 2.22, 0)), ni(rounded(0.5, 0.25, 0.5, 0.03).translate(0, 0.12, 0))]);
  const slab = ni(rounded(0.9, 0.18, 1.9, 0.04).translate(0, 0.06, 0));
  return [round, cross, celtic, obelisk, slab];
}

export function pointedArchShape(w, t, leg) {
  const s = new THREE.Shape();
  const R = w + t, ao = Math.acos(-(w / 2) / R);
  s.moveTo(-(w / 2 + t), -leg); s.lineTo(-(w / 2 + t), 0);
  s.absarc(w / 2, 0, R, Math.PI, ao, true); s.absarc(-w / 2, 0, R, Math.PI - ao, 0, true);
  s.lineTo(w / 2 + t, -leg); s.lineTo(-(w / 2 + t), -leg);
  const h = new THREE.Path();
  h.moveTo(-w / 2, -leg); h.lineTo(-w / 2, 0);
  h.absarc(w / 2, 0, w, Math.PI, (2 * Math.PI) / 3, true); h.absarc(-w / 2, 0, w, Math.PI / 3, 0, true);
  h.lineTo(w / 2, -leg); h.lineTo(-w / 2, -leg);
  s.holes.push(h);
  return s;
}

function ridge(radius, minH, maxH, color, seed, sharp = 1.6) {
  const g = new THREE.CylinderGeometry(radius, radius, 1, 256, 1, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const n = ridged2(Math.cos(a) * 3 + seed, Math.sin(a) * 3 + seed, 6);
      p.setY(i, minH + Math.pow(n, sharp) * (maxH - minH) * 1.6);
    } else p.setY(i, -40);
  }
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false }));
  m.userData.noAO = true;
  return m;
}

// lava material (animated, emissive)
function lavaMaterial(G) {
  const m = new THREE.MeshStandardMaterial({ color: 0x1a0500, roughness: 0.6, emissive: 0xff5010, emissiveIntensity: 1 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = G.time;
    sh.vertexShader = 'varying vec3 vLW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLW = (modelMatrix*vec4(position,1.0)).xyz;');
    sh.fragmentShader = 'uniform float uTime; varying vec3 vLW;\nfloat lh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }\nfloat ln(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(lh(i),lh(i+vec2(1,0)),f.x),mix(lh(i+vec2(0,1)),lh(i+vec2(1,1)),f.x),f.y); }\nfloat lf(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*ln(p); p=p*2.03+uTime*0.05; a*=.5; } return s; }\n' + sh.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 lp = vLW.xz * 0.5;
        float flow = lf(lp + vec2(uTime*0.08, uTime*0.05) + lf(lp*1.7 - uTime*0.04)*1.5);
        float crust = smoothstep(0.45, 0.7, flow);
        vec3 hot = mix(vec3(1.6, 0.22, 0.02), vec3(3.2, 0.9, 0.12), smoothstep(0.25, 0.0, flow));
        totalEmissiveRadiance = mix(hot, vec3(0.08, 0.02, 0.0), crust);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), crust);`);
  };
  return m;
}

// swirling portal disc
export function portalMaterial(G, color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { time: G.time, col: { value: new THREE.Color(color) }, open: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float time, open; uniform vec3 col; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){
        vec2 c = vUv - 0.5; float r = length(c) * 2.0; float a = atan(c.y, c.x);
        float sw = n(vec2(a * 3.0 + r * 6.0 - time * 2.0, r * 4.0 - time)) * 0.6 + n(vec2(a * 6.0 - r * 9.0 + time * 1.3, r * 8.0)) * 0.4;
        float core = smoothstep(1.0, 0.0, r);
        float ring = smoothstep(0.08, 0.0, abs(r - 0.92));
        vec3 c3 = col * (sw * 1.6 * core + ring * 3.0) + vec3(1.0) * pow(core, 6.0) * 2.0;
        float alpha = clamp((sw * core * 1.2 + ring) * open, 0.0, 1.0) * step(r, 1.0);
        gl_FragColor = vec4(c3 * alpha, alpha);
      }`,
  });
}

// ------------------------------------------------------------
//  Build a kingdom
// ------------------------------------------------------------
export function buildKingdom(def, baker, G) {
  setNoiseSeed({ ash: 11, frost: 23, ember: 37, void: 51 }[def.id]);
  const rng = makeRng({ ash: 101, frost: 202, ember: 303, void: 404 }[def.id]);
  const root = new THREE.Group();
  scene.add(root);
  const colliders = [], flames = [], lights = [], updaters = [], hazards = [];
  const H = heightFns(def.id);

  // ---- sky / env / fog / grade ----
  applySky(def.sky);
  scene.fog = new HeightFog(def.fog[0], def.fog[1], def.fog[2]);
  scene.background = new THREE.Color(def.fog[0]);
  applyGrade(def.grade);
  G.wind.value.set(def.wind[0], def.wind[1]);

  // ---- lights ----
  const sun = new THREE.DirectionalLight(def.sun[0], def.sun[1]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  const sc = sun.shadow.camera; sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035;
  root.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(def.hemi[0], def.hemi[1], def.hemi[2]);
  root.add(hemi);
  const fill = new THREE.DirectionalLight(new THREE.Color(def.hemi[0]).lerp(new THREE.Color(0xffffff), 0.3), 0.35);
  fill.position.set(-def.sky.sunDir.x * 40, 20, -def.sky.sunDir.z * 40);
  root.add(fill);

  // ---- materials ----
  const S = (n, o) => baker.bake(n, o);
  const ashlar = pbr(S('ashlar', { normal: 4 }), { metalness: 0, repeat: [1, 1], color: { ash: 0x8a8088, frost: 0x9aa4b4, ember: 0x5a4a44, void: 0x4a4258 }[def.id] });
  const rockM = pbr(S('rock', { normal: 5 }), { metalness: 0, color: { ash: 0x7a7070, frost: 0x8a96a6, ember: 0x4a3c38, void: 0x3a3248 }[def.id] });
  const barkM = pbr(S('bark', { normal: 5 }), { metalness: 0, repeat: [1, 4], color: def.id === 'ember' ? 0x2a2420 : 0x8a7a70 });

  // ---- terrain ----
  let layers, splatFn, tOpts = {};
  if (def.id === 'ash') {
    layers = [{ set: S('soil', { normal: 5 }), scale: 0.16 }, { set: S('moss', { normal: 4 }), scale: 0.13, tint: 0x9a8a78 }, { set: S('rock'), scale: 0.07, tint: 0x8a8080 }];
    splatFn = (x, z, h, sl) => { const r = Math.hypot(x, z); return [smoothstep(0.45, 0.7, fbm2(x * 0.06, z * 0.06, 4)) * (1 - smoothstep(3, 6, r) * 0) * (r < 5 ? 0.2 : 1), 1 - 0.35 * smoothstep(ARENA_R, ARENA_R + 25, r) - 0.3 * (1 - smoothstep(3.5, 7, r)), fbm2(x * 0.2, z * 0.2, 2)]; };
  } else if (def.id === 'frost') {
    layers = [{ set: S('snow', { normal: 3 }), scale: 0.1 }, { set: S('moss'), scale: 0.13, tint: 0x8090a0 }, { set: S('rock'), scale: 0.06, tint: 0x9aa4b4 }];
    splatFn = (x, z, h, sl) => [smoothstep(0.55, 0.75, fbm2(x * 0.07, z * 0.07, 4)) * 0.8, 1.0 - 0.2 * smoothstep(ARENA_R, ARENA_R + 30, Math.hypot(x, z)), fbm2(x * 0.2, z * 0.2, 2)];
    tOpts = { slopeLo: 0.3, slopeHi: 0.55, env: 0.8 };
  } else if (def.id === 'ember') {
    layers = [{ set: S('ash', { normal: 4, emissive: true }), scale: 0.14, emissive: 2 }, { set: S('basalt', { normal: 5, emissive: true }), scale: 0.09, emissive: 2.5 }, { set: S('rock'), scale: 0.06, tint: 0x5a4a44 }];
    splatFn = (x, z, h, sl) => { let b = smoothstep(0.4, 0.62, fbm2(x * 0.05, z * 0.05, 4)); for (const [px, pz, pr] of H.pools) b = Math.max(b, 1 - smoothstep(pr + 0.5, pr + 3.5, Math.hypot(x - px, z - pz))); return [b, 1, fbm2(x * 0.2, z * 0.2, 2)]; };
  } else {
    layers = [{ set: S('voidstone', { normal: 4, emissive: true }), scale: 0.09, emissive: 1.6 }, { set: S('rock'), scale: 0.12, tint: 0x4a4058 }, { set: S('rock'), scale: 0.05, tint: 0x3a3048 }];
    splatFn = (x, z, h, sl) => { const r = Math.hypot(x, z); return [smoothstep(0.5, 0.7, fbm2(x * 0.06, z * 0.06, 4)) + smoothstep(24, 32, r), 1, fbm2(x * 0.2, z * 0.2, 2)]; };
  }
  const tmat = terrainMaterial(layers, tOpts);
  const terrain = buildTerrain(H.ground, tmat, splatFn, def.id === 'void' ? 140 : 300, def.id === 'void' ? 200 : 240);
  root.add(terrain);

  // ---- horizon silhouettes ----
  const ridgeCols = { ash: [0x150a0e, 0x0c0609], frost: [0x16202e, 0x0d141d], ember: [0x1c0a05, 0x100503], void: [0x0a0614, 0x05030a] }[def.id];
  if (def.id !== 'void') {
    root.add(ridge(520, 25, 95, ridgeCols[0], 4.2, 1.8));
    root.add(ridge(380, 18, 70, ridgeCols[1], 9.7, 1.5));
  }

  const avoid = (x, z, pad) => colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + pad);
  const inArena = (x, z) => Math.hypot(x, z) < ARENA_R - 1;

  // ---- shared: ring of ruined pillars & arches ----
  function ruinRing(R, count, mat, archEvery = 3, tall = 8.5) {
    const pg = [], ag = [];
    const info = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.1;
      const arch = i % archEvery !== archEvery - 1;
      const broken = !arch || rng() < 0.18;
      info.push({ a, h: broken ? 2 + rng() * 4 : tall, broken });
    }
    for (let i = 0; i < count; i++) {
      const { a, h, broken } = info[i];
      const x = Math.cos(a) * R, z = Math.sin(a) * R, y0 = H.ground(x, z) - 0.3;
      const parts = [];
      parts.push(ni(scaleUV(rounded(1.9, 0.9, 1.9, 0.06), 1, 0.5).translate(0, 0.45, 0)));
      // fluted column
      const shaft = new THREE.CylinderGeometry(0.62, 0.7, h, 24, Math.max(2, Math.round(h * 2)));
      mapVerts(shaft, (v) => { const ang = Math.atan2(v.z, v.x); const f = 1 - 0.04 * Math.pow(Math.abs(Math.sin(ang * 8)), 0.5); v.x *= f; v.z *= f; if (broken && v.y > h / 2 - 0.05) v.y -= rng() * 1.1; });
      scaleUV(shaft, 3, h / 2.5);
      parts.push(ni(shaft.translate(0, h / 2 + 0.9, 0)));
      parts.push(ni(new THREE.TorusGeometry(0.72, 0.08, 6, 24).rotateX(Math.PI / 2).translate(0, 0.95, 0)));
      if (!broken) {
        parts.push(ni(lathe([[0.62, 0], [0.8, 0.35], [0.95, 0.5]], 24).translate(0, h + 0.9, 0)));
        parts.push(ni(rounded(1.9, 0.4, 1.9, 0.05).translate(0, h + 1.6, 0)));
      }
      const g = mergeGeometries(parts);
      g.rotateY(-a + rng() * 0.3);
      g.translate(x, y0, z);
      pg.push(g);
      colliders.push({ x, z, r: 1.2 });
      if (broken && rng() < 0.8) {
        const len = 1.4 + rng() * 1.8;
        const d = new THREE.CylinderGeometry(0.62, 0.62, len, 20);
        scaleUV(d, 3, 1); d.rotateZ(Math.PI / 2); d.rotateY(rng() * Math.PI);
        const ox = x + (rng() - 0.5) * 6, oz = z + (rng() - 0.5) * 6;
        if (Math.hypot(ox, oz) < ARENA_R - 1.5 && !avoid(ox, oz, 0.6)) {
          d.translate(ox, H.ground(ox, oz) + 0.45, oz);
          pg.push(ni(d)); colliders.push({ x: ox, z: oz, r: 0.9 });
        }
      }
    }
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      if (i % archEvery !== 0 || info[i].broken || info[j].broken) continue;
      const p1 = new THREE.Vector3(Math.cos(info[i].a) * R, 0, Math.sin(info[i].a) * R);
      const p2 = new THREE.Vector3(Math.cos(info[j].a) * R, 0, Math.sin(info[j].a) * R);
      const span = p1.distanceTo(p2);
      const g = new THREE.ExtrudeGeometry(pointedArchShape(span - 0.4, 0.85, 0), { depth: 1.1, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 20 });
      g.translate(0, 0, -0.55); g.scale(1, 0.55, 1);
      const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 0.35, uv.getY(k) * 0.35);
      const mid = p1.clone().add(p2).multiplyScalar(0.5);
      const y = Math.min(H.ground(p1.x, p1.z), H.ground(p2.x, p2.z)) - 0.3 + tall + 2.0;
      g.rotateY(-Math.atan2(p2.z - p1.z, p2.x - p1.x)); g.translate(mid.x, y, mid.z);
      ag.push(ni(g));
    }
    const m1 = new THREE.Mesh(mergeGeometries(pg), mat); m1.castShadow = m1.receiveShadow = true; root.add(m1);
    if (ag.length) { const m2 = new THREE.Mesh(mergeGeometries(ag), mat); m2.castShadow = m2.receiveShadow = true; root.add(m2); }
  }

  function boulders(n, mat, rMin, rMax, sMin, sMax, inside = false) {
    const geos = [rockGeo(1, 3, 1.3, 0.55, [1.2, 0.8, 1]), rockGeo(1, 3, 7.1, 0.6, [1, 0.6, 1.3]), rockGeo(1, 2, 4.4, 0.5, [0.9, 1.1, 0.9])];
    geos.forEach((g, gi) => {
      root.add(scatter(g, mat, Math.ceil(n / 3), () => {
        const a = rng() * Math.PI * 2, r = rMin + rng() * (rMax - rMin);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (avoid(x, z, 1)) return null;
        const s = sMin + rng() * (sMax - sMin);
        if (inside && s > 0.6) colliders.push({ x, z, r: s * 0.9 });
        return { x, y: H.ground(x, z) - s * 0.25, z, ry: rng() * 6, rx: (rng() - 0.5) * 0.4, s: [s * (0.8 + rng() * 0.4), s, s * (0.8 + rng() * 0.4)] };
      }));
    });
  }

  function brazier(x, z, color = 0xff6a28, fireCol = 'fire') {
    const y = H.walk(x, z);
    const iron = pbr(S('steel', { normal: 2.5 }), { physical: true, color: 0x2a2624, side: THREE.DoubleSide });
    const g = new THREE.Group();
    const ped = new THREE.Mesh(lathe([[0.55, 0], [0.5, 0.15], [0.32, 0.3], [0.26, 0.9], [0.36, 1.1]], 16), ashlar);
    const bowl = new THREE.Mesh(lathe([[0.3, 1.1], [0.55, 1.25], [0.75, 1.5], [0.78, 1.56]], 20), iron);
    const coals = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4) }));
    coals.rotation.x = -Math.PI / 2; coals.position.y = 1.45;
    for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.45, 5), iron); const ka = (k / 4) * Math.PI * 2; sp.position.set(Math.cos(ka) * 0.76, 1.75, Math.sin(ka) * 0.76); sp.castShadow = true; g.add(sp); }
    [ped, bowl].forEach((m) => { m.castShadow = m.receiveShadow = true; });
    g.add(ped, bowl, coals);
    g.position.set(x, y, z);
    root.add(g);
    const light = new THREE.PointLight(color, 26, 22, 1.6);
    light.position.set(x, y + 2.3, z);
    root.add(light);
    flames.push({ pos: new THREE.Vector3(x, y + 1.5, z), light, base: 26, seed: rng() * 10, kind: fireCol });
    colliders.push({ x, z, r: 0.85 });
  }

  // ============ per-kingdom content ============
  let centerpiece = null, portalPos = new THREE.Vector3(0, 0, 0);
  if (def.id === 'ash') {
    ruinRing(27, 18, ashlar, 3, 8.5);
    // altar with floating crystal
    const altar = new THREE.Group();
    const step1 = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(4.0, 4.3, 0.35, 48), 6, 0.4), ashlar); step1.position.y = 0.17;
    const step2 = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(3.2, 3.4, 0.35, 48), 5, 0.4), ashlar); step2.position.y = 0.5;
    [step1, step2].forEach((m) => { m.receiveShadow = m.castShadow = true; });
    altar.add(step1, step2);
    const crystalMat = new THREE.MeshPhysicalMaterial({ color: 0x2a0a40, emissive: 0x9a40ff, emissiveIntensity: 2.2, roughness: 0.1, metalness: 0.2, clearcoat: 1, flatShading: true });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 0), crystalMat);
    crystal.scale.set(0.8, 1.8, 0.8); crystal.position.y = 3.1; crystal.castShadow = true;
    altar.add(crystal);
    const cl = new THREE.PointLight(0xa050ff, 30, 22, 1.6); cl.position.y = 3.1; altar.add(cl);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4, h = 2.4 + rng() * 0.8;
      const m = new THREE.Mesh(scaleUV(rounded(0.6, h, 0.45, 0.05), 0.5, h / 3), ashlar);
      m.position.set(Math.cos(a) * 3.7, h / 2 + 0.3, Math.sin(a) * 3.7); m.rotation.y = -a; m.castShadow = m.receiveShadow = true;
      altar.add(m);
    }
    root.add(altar);
    colliders.push({ x: 0, z: 0, r: 4.1 });
    updaters.push((t) => { crystal.rotation.y = t * 0.5; crystal.position.y = 3.1 + Math.sin(t * 1.3) * 0.15; cl.intensity = 26 + Math.sin(t * 2.3) * 4; });
    centerpiece = crystal;
    portalPos.set(0, 0, -9);
    // graves
    const [round, cross, celtic, obelisk, slab] = headstoneGeos();
    const graveM = pbr(S('ashlar'), { metalness: 0, color: 0x7a747c, repeat: [0.5, 0.5] });
    const placeGrave = (rMin, rMax, tilt) => () => {
      const a = rng() * Math.PI * 2, r = rMin + rng() * (rMax - rMin);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (avoid(x, z, 0.9) || Math.abs(Math.sin(a * 3)) < 0.14) return null;
      return { x, y: H.ground(x, z) - 0.05, z, rx: (rng() - 0.5) * tilt, ry: Math.atan2(x, z) + (rng() - 0.5) * 0.4, rz: (rng() - 0.5) * tilt, s: 0.8 + rng() * 0.45, color: new THREE.Color().setHSL(0.75, 0.04, 0.4 + rng() * 0.35) };
    };
    root.add(scatter(round, graveM, 80, placeGrave(8, 26, 0.35)));
    root.add(scatter(cross, graveM, 40, placeGrave(9, 34, 0.4)));
    root.add(scatter(celtic, graveM, 18, placeGrave(9, 26, 0.2)));
    root.add(scatter(obelisk, graveM, 8, placeGrave(12, 25, 0.1)));
    root.add(scatter(slab, graveM, 14, placeGrave(9, 24, 0.05)));
    // dead trees
    const treeGeos = [deadTreeGeo(makeRng(3), 1.1), deadTreeGeo(makeRng(9), 1.4), deadTreeGeo(makeRng(17), 0.9, 1.4)];
    treeGeos.forEach((g) => {
      root.add(scatter(g, barkM, 8, () => {
        const a = rng() * Math.PI * 2, r = rng() < 0.35 ? 14 + rng() * 11 : 31 + rng() * 30;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (avoid(x, z, 1.5)) return null;
        if (r < ARENA_R) colliders.push({ x, z, r: 0.5 });
        return { x, y: H.ground(x, z), z, ry: rng() * 6, s: 0.8 + rng() * 0.6 };
      }));
    });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; brazier(Math.cos(a) * 12.5, Math.sin(a) * 12.5); }
    boulders(36, rockM, 30, 70, 0.8, 3.5);
    // distant castle silhouette on the northern ridge
    const castle = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: 0x0a0608, roughness: 1 });
    const towers = [[-14, 28, 4.5], [-6, 40, 5], [3, 52, 6], [11, 34, 4.5], [19, 24, 4]];
    for (const [x, h, w] of towers) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.45, w * 0.55, h, 8), cm); t.position.set(x, h / 2, 0); castle.add(t);
      const sp = new THREE.Mesh(new THREE.ConeGeometry(w * 0.62, h * 0.45, 8), cm); sp.position.set(x, h + h * 0.22, 0); castle.add(sp);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.5, 0.2), fog: false })); win.position.set(x, h * 0.7, w * 0.5 + 0.05); castle.add(win);
    }
    const wall = new THREE.Mesh(new THREE.BoxGeometry(36, 14, 3), cm); wall.position.set(2, 7, 0); castle.add(wall);
    castle.position.set(-20, H.ground(-20, -150) - 4, -150); castle.rotation.y = 0.15;
    castle.traverse((o) => { o.userData.noAO = true; });
    root.add(castle);
  } else if (def.id === 'frost') {
    // frozen lake
    const ice = S('ice', { normal: 2, emissive: true });
    const lakeM = pbr(ice, { physical: true, metalness: 0, roughness: 0.35, repeat: [4, 4], clearcoat: 1, clearcoatRoughness: 0.04, color: 0xbfd8e8, emissive: 0x2a6a9a, emissiveIntensity: 2.5, env: 1.6 });
    const lake = new THREE.Mesh(new THREE.CircleGeometry(10.4, 64), lakeM);
    lake.rotation.x = -Math.PI / 2; lake.position.y = 0.01; lake.receiveShadow = true;
    root.add(lake);
    hazards.push({ kind: 'ice', x: 0, z: 0, r: 10.2 });
    // standing stones around the lake + crystal clusters
    const crystalM = new THREE.MeshPhysicalMaterial({ color: 0x9ad8ff, emissive: 0x3aa0ff, emissiveIntensity: 0.7, roughness: 0.08, metalness: 0, clearcoat: 1, flatShading: true, transparent: true, opacity: 0.88 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, r = 12.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, h = 2.6 + rng() * 2.2;
      const st = new THREE.Mesh(rockGeo(1, 2, i * 3.1, 0.35, [0.55, h * 0.5, 0.4]), rockM);
      st.position.set(x, H.ground(x, z) + h * 0.35, z); st.rotation.y = -a; st.castShadow = st.receiveShadow = true;
      root.add(st);
      colliders.push({ x, z, r: 0.75 });
    }
    const clusterGeo = (() => { const gs = []; for (let k = 0; k < 7; k++) { const c = new THREE.ConeGeometry(0.18 + Math.random() * 0.15, 1.2 + Math.random() * 1.8, 6); c.translate(0, 0.6, 0); c.rotateX((Math.random() - 0.5) * 0.9); c.rotateZ((Math.random() - 0.5) * 0.9); gs.push(ni(c)); } return mergeGeometries(gs); })();
    root.add(scatter(clusterGeo, crystalM, 26, () => {
      const a = rng() * Math.PI * 2, r = 14 + rng() * 30;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (avoid(x, z, 1)) return null;
      if (r < ARENA_R) colliders.push({ x, z, r: 0.7 });
      return { x, y: H.ground(x, z) - 0.1, z, ry: rng() * 6, s: 0.7 + rng() * 1.1 };
    }));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3; const L = new THREE.PointLight(0x5ab8ff, 14, 16, 1.6); const x = Math.cos(a) * 17, z = Math.sin(a) * 17; L.position.set(x, H.ground(x, z) + 1.5, z); root.add(L); lights.push(L); }
    // snowy pine forest
    const pineM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.6 });
    [pineGeo(makeRng(2), 9), pineGeo(makeRng(5), 12), pineGeo(makeRng(8), 7)].forEach((g) => {
      root.add(scatter(g, pineM, 34, () => {
        const a = rng() * Math.PI * 2, r = rng() < 0.25 ? 20 + rng() * 7 : 30 + rng() * 45;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (avoid(x, z, 2.5)) return null;
        if (r < ARENA_R) colliders.push({ x, z, r: 0.6 });
        return { x, y: H.ground(x, z) - 0.3, z, ry: rng() * 6, s: 0.8 + rng() * 0.5 };
      }));
    });
    ruinRing(28, 14, ashlar, 7, 7);
    boulders(40, rockM, 24, 75, 0.8, 4);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; brazier(Math.cos(a) * 22, Math.sin(a) * 22, 0x6ac8ff); }
    portalPos.set(0, 0, 0);
    // distant ice spires
    const spM = new THREE.MeshStandardMaterial({ color: 0x1a2a3e, roughness: 0.6 });
    for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.13; const h = 60 + rng() * 80; const s = new THREE.Mesh(new THREE.ConeGeometry(6 + rng() * 6, h, 6), spM); s.position.set(Math.cos(a) * 220, h / 2 - 10, Math.sin(a) * 220); s.userData.noAO = true; root.add(s); }
  } else if (def.id === 'ember') {
    // lava pools
    const lavaM = lavaMaterial(G);
    for (const [px, pz, pr] of H.pools) {
      const lp = new THREE.Mesh(new THREE.CircleGeometry(pr + 0.8, 40), lavaM);
      lp.rotation.x = -Math.PI / 2; lp.position.set(px, -0.35, pz);
      root.add(lp);
      const L = new THREE.PointLight(0xff5010, 12, 12, 1.6); L.position.set(px, 1.5, pz); root.add(L);
      flames.push({ pos: new THREE.Vector3(px, -0.3, pz), light: L, base: 12, seed: rng() * 10, kind: 'lava', r: pr });
      hazards.push({ kind: 'lava', x: px, z: pz, r: pr });
    }
    // basalt column clusters
    const hex = new THREE.CylinderGeometry(0.55, 0.55, 1, 6);
    hex.translate(0, 0.5, 0);
    const basaltM = pbr(S('basalt', { normal: 5, emissive: true }), { metalness: 0, repeat: [0.6, 1.5], emissive: 0xffffff, emissiveIntensity: 3 });
    for (let c = 0; c < 12; c++) {
      const a = rng() * Math.PI * 2, r = c < 5 ? 16 + rng() * 9 : 31 + rng() * 20;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      if (avoid(cx, cz, 2)) continue;
      root.add(scatter(hex, basaltM, 14, (i) => {
        const ox = cx + (rng() - 0.5) * 3.6, oz = cz + (rng() - 0.5) * 3.6;
        const h = 1 + rng() * (r < ARENA_R ? 4 : 9);
        return { x: ox, y: H.ground(ox, oz) - 0.2, z: oz, ry: rng(), s: [1, h, 1] };
      }));
      if (r < ARENA_R) colliders.push({ x: cx, z: cz, r: 2.2 });
    }
    // the forge: anvil altar at the center
    const forge = new THREE.Group();
    const base = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(3.6, 4.0, 0.6, 8), 4, 0.5), ashlar); base.position.y = 0.3;
    const anvilM = pbr(S('steel', { normal: 2.5 }), { physical: true, color: 0x2a2624 });
    const anvil = new THREE.Mesh(mergeGeometries([ni(rounded(1.6, 0.5, 0.8, 0.08).translate(0, 1.6, 0)), ni(rounded(0.7, 0.8, 0.5, 0.05).translate(0, 1.0, 0)), ni(rounded(1.3, 0.3, 0.9, 0.05).translate(0, 0.75, 0)), ni(new THREE.ConeGeometry(0.25, 0.9, 12).rotateZ(Math.PI / 2).translate(1.2, 1.6, 0))]), anvilM);
    const glowSword = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 1.8, 0.3) }));
    glowSword.position.set(0, 2.5, 0); glowSword.rotation.z = 0.15;
    [base, anvil].forEach((m) => { m.castShadow = m.receiveShadow = true; });
    forge.add(base, anvil, glowSword);
    const fl = new THREE.PointLight(0xff7020, 24, 18, 1.6); fl.position.y = 2.6; forge.add(fl);
    root.add(forge);
    colliders.push({ x: 0, z: 0, r: 4.0 });
    updaters.push((t) => { glowSword.position.y = 2.5 + Math.sin(t * 1.4) * 0.12; glowSword.rotation.y = t * 0.6; });
    centerpiece = glowSword;
    portalPos.set(0, 0, -9);
    const charred = [deadTreeGeo(makeRng(31), 1.0, 1.6), deadTreeGeo(makeRng(37), 1.3, 1.2)];
    charred.forEach((g) => root.add(scatter(g, barkM, 10, () => { const a = rng() * Math.PI * 2, r = 20 + rng() * 40; const x = Math.cos(a) * r, z = Math.sin(a) * r; if (avoid(x, z, 2)) return null; if (r < ARENA_R) colliders.push({ x, z, r: 0.5 }); return { x, y: H.ground(x, z), z, ry: rng() * 6, s: 0.8 + rng() * 0.5 }; })));
    boulders(44, rockM, 22, 70, 0.8, 4);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; brazier(Math.cos(a) * 20, Math.sin(a) * 20); }
    // volcano on the horizon
    const vg = new THREE.CylinderGeometry(18, 120, 110, 48, 6, true);
    mapVerts(vg, (v) => { const a = Math.atan2(v.z, v.x); const k = 1 + (ridged2(Math.cos(a) * 2, Math.sin(a) * 2 + v.y * 0.02, 4) - 0.5) * 0.3; v.x *= k; v.z *= k; });
    const volcano = new THREE.Mesh(vg, new THREE.MeshBasicMaterial({ color: 0x120604, fog: false }));
    volcano.position.set(60, 40, -330); root.add(volcano);
    const crater = new THREE.Mesh(new THREE.CircleGeometry(18, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.2, 0.15), fog: false, side: THREE.DoubleSide }));
    crater.rotation.x = -Math.PI / 2; crater.position.set(60, 94, -330); root.add(crater);
    flames.push({ pos: new THREE.Vector3(60, 96, -330), light: null, kind: 'volcano', seed: 0 });
  } else {
    // void: floating island with a broken throne
    const under = new THREE.Mesh(rockGeo(1, 4, 2.2, 0.35, [34, 40, 34]), rockM);
    under.position.y = -40; under.userData.noAO = true; root.add(under);
    const throne = new THREE.Group();
    const dais = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(5, 5.6, 0.8, 12), 5, 0.6), ashlar); dais.position.y = 0.4;
    const back = new THREE.Mesh(new THREE.ExtrudeGeometry(pointedArchShape(1.6, 0.5, 3.4), { depth: 0.5, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05 }), ashlar);
    back.position.set(0, 4.2, -2.6); back.scale.set(1, 1.4, 1);
    const seat = new THREE.Mesh(rounded(2.4, 0.6, 1.8, 0.08), ashlar); seat.position.set(0, 1.4, -1.8);
    [dais, back, seat].forEach((m) => { m.castShadow = m.receiveShadow = true; });
    throne.add(dais, back, seat);
    throne.position.set(0, 0, -18);
    root.add(throne);
    colliders.push({ x: 0, z: -18, r: 5.4 });
    portalPos.set(0, 0, 4);
    const crystalM = new THREE.MeshPhysicalMaterial({ color: 0x3a1a6a, emissive: 0x9a50ff, emissiveIntensity: 2.0, roughness: 0.1, clearcoat: 1, flatShading: true });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = 24;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, h = 4 + rng() * 4;
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), crystalM); c.scale.set(0.7, h * 0.5, 0.7);
      c.position.set(x, H.ground(x, z) + h * 0.5 + 0.6, z); c.castShadow = true; root.add(c);
      colliders.push({ x, z, r: 0.9 });
      updaters.push((t) => { c.position.y = H.ground(x, z) + h * 0.5 + 0.6 + Math.sin(t * 0.8 + i) * 0.3; c.rotation.y = t * 0.3 + i; });
      if (i % 2 === 0) { const L = new THREE.PointLight(0xa060ff, 16, 16, 1.6); L.position.set(x, 2.5, z); root.add(L); }
    }
    ruinRing(30, 16, ashlar, 4, 9);
    // floating rocks around the island
    const fr = [];
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2, r = 50 + rng() * 110, s = 2 + rng() * 9;
      const m = new THREE.Mesh(rockGeo(1, 2, i * 1.7, 0.45, [s, s * 0.7, s]), rockM);
      m.position.set(Math.cos(a) * r, -10 + rng() * 40, Math.sin(a) * r);
      m.userData.noAO = true; m.castShadow = false;
      root.add(m); fr.push({ m, y: m.position.y, ph: rng() * 6 });
    }
    updaters.push((t) => { for (const f of fr) { f.m.position.y = f.y + Math.sin(t * 0.3 + f.ph) * 1.5; f.m.rotation.y += 0.0008; } });
    // giant ring in the sky
    const ring = new THREE.Mesh(new THREE.TorusGeometry(90, 2.5, 8, 128), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.5, 2.4), fog: false }));
    ring.position.set(0, 140, -380); ring.rotation.x = 0.3; root.add(ring);
    updaters.push((t) => { ring.rotation.z = t * 0.02; });
    boulders(20, rockM, 12, 28, 0.6, 1.8, true);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; brazier(Math.cos(a) * 14, Math.sin(a) * 14, 0xa050ff); }
  }

  // ---- grass ----
  const grassCfg = {
    ash: { colA: 0x2a2418, colB: 0xa08c5c, height: 0.42, dens: (x, z) => { const r = Math.hypot(x, z); return r < 5 || r > ARENA_R + 14 ? 0 : 0.35 + 0.65 * smoothstep(0.4, 0.65, fbm2(x * 0.08 + 3, z * 0.08, 3)); } },
    frost: { colA: 0x24302a, colB: 0x7a8a7c, height: 0.38, frost: 0.9, dens: (x, z) => { const r = Math.hypot(x, z); return r < 11 || r > ARENA_R + 12 ? 0 : 0.6 * smoothstep(0.5, 0.7, fbm2(x * 0.07, z * 0.07, 4)); } },
    ember: null,
    void: { colA: 0x0a0614, colB: 0x6a3aa0, height: 0.35, dens: (x, z) => { const r = Math.hypot(x, z); return r < 6 || r > 31 ? 0 : 0.4 * smoothstep(0.5, 0.7, fbm2(x * 0.07, z * 0.07, 3)); } },
  }[def.id];
  if (grassCfg) {
    const gr = buildGrass({ count: Q.grass, area: ARENA_R + 14, heightAt: H.ground, accept: (x, z) => (avoid(x, z, 0.3) ? 0 : grassCfg.dens(x, z)), colA: grassCfg.colA, colB: grassCfg.colB, height: grassCfg.height, tipFrost: grassCfg.frost || 0 });
    root.add(gr);
  }

  // ---- ambient particles ----
  for (const p of def.particles) {
    const pts = ambientParticles({ n: Math.round(p.n * (Q.grass > 20000 ? 1 : 0.6)), color: new THREE.Color(...p.color), size: p.size, fall: p.fall, swirl: p.swirl, additive: p.additive !== false, flicker: p.flicker !== false });
    root.add(pts);
    updaters.push(() => pts.userData.update());
  }

  // ---- environment lighting ----
  const envExtras = [];
  if (def.id === 'ember') { const lp = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.12, 0.02), side: THREE.DoubleSide })); lp.rotation.x = -Math.PI / 2; lp.position.y = -30; envExtras.push(lp); }
  bakeEnvironment(envExtras);

  return {
    def, root, colliders, flames, hazards, lights, sun, hemi, heightAt: H.walk, groundAt: H.ground, portalPos, centerpiece,
    update(t, dt) { for (const u of updaters) u(t, dt); },
    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => m.dispose()); }
        if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
      });
    },
  };
}
