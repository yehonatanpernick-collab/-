// Vegetation: branch-card trees, lit impostors, interactive grass, wildflowers, boulders and logs.
import * as THREE from 'three';
import { clamp, lerp, mulberry32, nR, SIZE, HALF } from './shared.js';
import { scene, renderer, U, GRID, G, Q, isTouch, hex } from './core.js';
import { patchLit, ATMOS_PARS, atmosUniforms } from './atmos.js';

const STRIDE = 11;

// ---------------------------------------------------------------- painted foliage & bark atlas
const AW = 1024, AH = 512;
const R = { spruce: [0, 0, 256, 256], fir: [256, 0, 512, 256], pine: [512, 0, 768, 256], aspen: [768, 0, 1024, 256], willow: [0, 256, 256, 512], shrub: [256, 256, 512, 512], barkC: [512, 256, 640, 512], barkP: [640, 256, 768, 512], barkA: [768, 256, 896, 512], core: [896, 256, 1024, 512] };
const uvr = (k) => { const [x0, y0, x1, y1] = R[k]; return [x0 / AW, 1 - y1 / AH, x1 / AW, 1 - y0 / AH]; };
function paintAtlas() {
  const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH; const g = cv.getContext('2d'); const r = mulberry32(17);
  const rgb = (a, b, t) => `rgb(${lerp(a[0], b[0], t) | 0},${lerp(a[1], b[1], t) | 0},${lerp(a[2], b[2], t) | 0})`;
  const clip = (k, fn) => { const [x0, y0, x1, y1] = R[k]; g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip(); g.translate(x0, y0); fn(x1 - x0, y1 - y0); g.restore(); };
  const needleBranch = (dark, light, density, len, spread, tuft) => (w, h) => {
    const cy = h / 2;
    g.lineCap = 'round';
    // main stem and side twigs
    const stems = [[[6, cy], [w - 8, cy + (r() - 0.5) * 10]]];
    for (let i = 0; i < 7; i++) { const t = 0.12 + i * 0.12, x = 6 + t * (w - 14), s = i % 2 ? 1 : -1, l = (1 - t) * h * 0.38 + 10; stems.push([[x, cy], [x + l * 0.75, cy + s * l * spread]]); }
    // solid silhouette under every twig so the spray keeps its coverage when mipmapped
    for (const [[ax, ay], [bx, by]] of stems) {
      const L = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / L, ny = (bx - ax) / L, wd = len * (tuft ? 0.9 : 1.05);
      g.fillStyle = rgb(dark, light, 0.18); g.beginPath();
      for (let t = 0; t <= 1.001; t += 0.1) { const env = Math.sin(Math.PI * Math.min(1, 0.2 + t * 0.9)) * (tuft ? (t > 0.5 ? 1.3 : 0.35) : 1); g.lineTo(lerp(ax, bx, t) + nx * wd * env, lerp(ay, by, t) + ny * wd * env); }
      for (let t = 1; t >= -0.001; t -= 0.1) { const env = Math.sin(Math.PI * Math.min(1, 0.2 + t * 0.9)) * (tuft ? (t > 0.5 ? 1.3 : 0.35) : 1); g.lineTo(lerp(ax, bx, t) - nx * wd * env, lerp(ay, by, t) - ny * wd * env); }
      g.fill();
    }
    g.strokeStyle = 'rgb(72,58,44)';
    for (const [[ax, ay], [bx, by]] of stems) { g.lineWidth = 2.2; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); }
    for (const [[ax, ay], [bx, by]] of stems) {
      const L = Math.hypot(bx - ax, by - ay), n = L * density;
      for (let i = 0; i < n; i++) {
        const t = r(), x = lerp(ax, bx, t), y = lerp(ay, by, t), env = Math.sin(Math.PI * Math.min(1, 0.25 + t)) * (tuft ? (t > 0.55 ? 1.4 : 0.3) : 1);
        const a = Math.atan2(by - ay, bx - ax) + (r() < 0.5 ? 1 : -1) * (0.5 + r() * 1.0), l = len * (0.6 + r() * 0.6) * env;
        g.strokeStyle = rgb(dark, light, Math.pow(r(), 1.4)); g.lineWidth = tuft ? 2 : 2.4;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
    }
  };
  clip('spruce', needleBranch([26, 46, 40], [88, 118, 102], 3.2, 14, 0.9, false));
  clip('fir', needleBranch([22, 42, 32], [74, 104, 70], 3.6, 12, 0.6, false));
  clip('pine', needleBranch([40, 62, 28], [118, 140, 64], 2.8, 26, 1.1, true));
  const leaves = (cols, size, count, round) => (w, h) => {
    g.fillStyle = cols[3]; for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(w / 2 + (r() - 0.5) * w * 0.35, h / 2 + (r() - 0.5) * h * 0.35, w * 0.2, 0, 7); g.fill(); }
    g.strokeStyle = 'rgb(90,80,60)'; g.lineWidth = 2;
    for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + (r() - 0.5) * w * 0.8, h / 2 + (r() - 0.5) * h * 0.8); g.stroke(); }
    for (let i = 0; i < count; i++) {
      const a = r() * 6.283, d = Math.pow(r(), 0.7) * w * 0.44, x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d;
      const c = cols[(r() * cols.length) | 0], s = size * (0.7 + r() * 0.6);
      g.fillStyle = c; g.beginPath(); g.ellipse(x, y, s, s * (round ? 0.85 : 0.32), r() * 6.283, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,230,0.12)'; g.beginPath(); g.ellipse(x - s * 0.2, y - s * 0.2, s * 0.45, s * (round ? 0.35 : 0.14), 0.5, 0, 7); g.fill();
    }
  };
  clip('aspen', leaves(['#6f9e3c', '#86b24a', '#9cc35a', '#5f8a34', '#b9c95a'], 10, 900, true));
  clip('willow', leaves(['#6b8a56', '#86a06c', '#9cb38a', '#5c7848'], 13, 900, false));
  clip('shrub', (w, h) => { leaves(['#5f7a40', '#6f8a4a', '#809c56', '#52703a'], 6, 900, true)(w, h); for (let i = 0; i < 26; i++) { g.fillStyle = r() < 0.5 ? '#b0302a' : '#d8c060'; g.beginPath(); g.arc(w / 2 + (r() - 0.5) * w * 0.7, h / 2 + (r() - 0.5) * h * 0.7, 3, 0, 7); g.fill(); } });
  const bark = (base, dark, light, marks) => (w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { g.fillStyle = r() < 0.5 ? dark : light; g.globalAlpha = 0.25 + r() * 0.4; g.fillRect(r() * w, r() * h, 1 + r() * 3, 6 + r() * 30); }
    g.globalAlpha = 1;
    if (marks === 'plates') for (let i = 0; i < 60; i++) { g.strokeStyle = 'rgba(40,20,10,.75)'; g.lineWidth = 2; g.strokeRect(r() * w, r() * h, 14 + r() * 26, 20 + r() * 40); }
    if (marks === 'eyes') for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(30,28,26,.85)'; g.beginPath(); g.ellipse(r() * w, r() * h, 5 + r() * 9, 1.5 + r() * 2.5, 0, 0, 7); g.fill(); }
  };
  clip('barkC', bark('rgb(128,112,98)', 'rgb(70,58,50)', 'rgb(170,156,140)'));
  clip('barkP', bark('rgb(158,102,68)', 'rgb(70,42,26)', 'rgb(196,140,96)', 'plates'));
  clip('barkA', bark('rgb(222,220,210)', 'rgb(160,160,150)', 'rgb(240,240,232)', 'eyes'));
  clip('core', (w, h) => { g.fillStyle = 'rgb(30,48,38)'; g.fillRect(0, 0, w, h); needleBranch([20, 38, 30], [70, 100, 80], 3, 14, 1, false)(w, h);
    g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 160; i++) { g.beginPath(); g.arc(r() * w, r() * h, 2 + r() * 6, 0, 7); g.fill(); } g.globalCompositeOperation = 'source-over'; });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; return tex;
}

// ---------------------------------------------------------------- tree geometry (unit height)
class TB {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.f = []; }
  tri(v) { for (const q of v) { this.p.push(...q.p); this.n.push(...q.n); this.c.push(...q.c); this.u.push(...q.u); this.f.push(q.f); } }
  quad(a, b, c, d) { this.tri([a, b, c, b, d, c]); }
  mesh(geo, col, uvR, o = {}) {
    if (o.m) geo.applyMatrix4(o.m);
    if (geo.index) geo = geo.toNonIndexed();
    const P = geo.attributes.position, Nn = geo.attributes.normal, UV = geo.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i);
      const k = o.ao ? lerp(o.ao, 1, clamp(y, 0, 1)) : 1;
      this.p.push(P.getX(i), y, P.getZ(i)); this.n.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i));
      this.c.push(col.r * k, col.g * k, col.b * k);
      this.u.push(uvR[0] + UV.getX(i) * (uvR[2] - uvR[0]), uvR[1] + UV.getY(i) * (uvR[3] - uvR[1])); this.f.push(0);
    }
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('aFlex', new THREE.Float32BufferAttribute(this.f, 1)); g.computeBoundingSphere(); return g;
  }
}
const V3 = THREE.Vector3;
function crownNormal(p, cy, up = 0.35) { const n = new V3(p.x, (p.y - cy) * 0.8, p.z).normalize(); n.y += up; return n.normalize().toArray(); }
// one branch: a drooping card plus a crossing card, both curved
function branch(b, o, ang, len, width, droop, region, col, cy, flexK = 1, rnd) {
  const d = new V3(Math.cos(ang) * Math.cos(droop), -Math.sin(droop), Math.sin(ang) * Math.cos(droop));
  const side = new V3(-Math.sin(ang), 0, Math.cos(ang)), up2 = new V3().crossVectors(d, side).normalize();
  const tw = (rnd() - 0.5) * 0.5, s1 = side.clone().multiplyScalar(Math.cos(tw)).addScaledVector(up2, Math.sin(tw));
  const [u0, v0, u1, v1] = uvr(region);
  for (const [sv, wk] of [[s1, 1], [up2.clone().multiplyScalar(-1).addScaledVector(s1, 0.25).normalize(), 0.55]]) {
    const pts = [0, 0.5, 1].map(t => o.clone().addScaledVector(d, len * t).add(new V3(0, -len * 0.14 * t * t, 0)));
    const ws = [0.18, 0.55, 0.5].map(k => k * width * wk);
    const vtx = (i, s) => {
      const p = pts[i].clone().addScaledVector(sv, ws[i] * s), t = i / 2, ao = lerp(0.42, 1, t) * lerp(0.82, 1.08, clamp(p.y, 0, 1));
      return { p: p.toArray(), n: crownNormal(p, cy), c: [col.r * ao, col.g * ao, col.b * ao], u: [lerp(u0, u1, t), s < 0 ? v0 : v1], f: t * flexK };
    };
    for (let i = 0; i < 2; i++) b.quad(vtx(i, -1), vtx(i, 1), vtx(i + 1, -1), vtx(i + 1, 1));
  }
}
function trunk(b, h, r0, r1, col, region, seg = 7) { b.mesh(new THREE.CylinderGeometry(r1, r0, h, seg, 3, true).translate(0, h / 2, 0), col, uvr(region), { ao: 0.75 }); }
function conifer({ crownBase, radius, whorls, per, droopB, droopT, region, col, coreCol, exp = 1.0, trunkR = 0.022 }, seed) {
  const b = new TB(), rnd = mulberry32(seed);
  trunk(b, 1.0, trunkR, trunkR * 0.25, hex('#c8b8a6'), 'barkC');
  const cy = lerp(crownBase, 1, 0.4);
  if (coreCol) { const cone = new THREE.ConeGeometry(radius * 0.5, (1 - crownBase) * 0.95, 8, 1, true).translate(0, crownBase + (1 - crownBase) * 0.47, 0); b.mesh(cone, coreCol, uvr('core'), { ao: 0.55 }); }
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1), y = lerp(crownBase, 0.97, t), rr = radius * Math.pow(1 - t, exp) * (0.85 + rnd() * 0.3) + 0.025;
    const n = Math.max(3, Math.round(per * (1 - t * 0.45)));
    for (let i = 0; i < n; i++) {
      const a = (i + rnd() * 0.7) / n * Math.PI * 2 + w * 1.3;
      branch(b, new V3(Math.cos(a) * 0.01, y, Math.sin(a) * 0.01), a, rr * (0.85 + rnd() * 0.3), rr * 0.75 + 0.03, lerp(droopB, droopT, t) + (rnd() - 0.5) * 0.2, region, col, cy, 1, rnd);
    }
  }
  return b.geo();
}
function broadleaf({ trunkH, region, barkR, bark, crown, cards, size, col, flex, trunkR, lean = 0 }, seed) {
  const b = new TB(), rnd = mulberry32(seed);
  trunk(b, trunkH + 0.12, trunkR, trunkR * 0.45, bark, barkR);
  const [cx, cyc, cz, rx, ry, rz] = crown;
  const [u0, v0, u1, v1] = uvr(region);
  for (let i = 0; i < cards; i++) {
    let q; do { q = new V3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); } while (q.lengthSq() > 1);
    const p = new V3(cx + q.x * rx, cyc + q.y * ry, cz + q.z * rz);
    const nrm = new V3((p.x - cx) / rx, (p.y - cyc) / ry * 0.7 + 0.3, (p.z - cz) / rz).normalize();
    const t1 = new V3().crossVectors(nrm, new V3(rnd() - 0.5, 1, rnd() - 0.5)).normalize(), t2 = new V3().crossVectors(nrm, t1);
    const s = size * (0.75 + rnd() * 0.5), depth = clamp(q.length(), 0, 1), ao = lerp(0.55, 1.05, depth) * lerp(0.85, 1.05, (p.y - cyc) / ry * 0.5 + 0.5);
    const tint = 0.9 + rnd() * 0.2, c = [col.r * ao * tint, col.g * ao * tint, col.b * ao * tint];
    const v = (sx, sy, uu, vv) => ({ p: p.clone().addScaledVector(t1, sx * s).addScaledVector(t2, sy * s).toArray(), n: nrm.toArray(), c, u: [uu, vv], f: flex * (0.6 + depth * 0.4) });
    b.quad(v(-1, -1, u0, v0), v(1, -1, u1, v0), v(-1, 1, u0, v1), v(1, 1, u1, v1));
    if (i % 3 === 0) { const s2 = new V3(p.x - cx, 0, p.z - cz).normalize(); const pa = new V3(0, Math.min(p.y, trunkH), 0); b.mesh(new THREE.CylinderGeometry(0.004, 0.008, 1, 3).translate(0, 0.5, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), p.clone().sub(pa).normalize())).scale(1, p.distanceTo(pa), 1).translate(pa.x, pa.y, pa.z), bark, uvr(barkR)); void s2; }
  }
  return b.geo();
}
function snagGeo(seed) {
  const b = new TB(), rnd = mulberry32(seed), col = hex('#e4dcd0');
  trunk(b, 0.92, 0.024, 0.004, col, 'barkC', 6);
  for (let i = 0; i < 16; i++) {
    const y = 0.25 + rnd() * 0.65, a = rnd() * 6.283, l = (1 - y) * 0.18 + 0.03;
    b.mesh(new THREE.CylinderGeometry(0.002, 0.005, l, 3).translate(0, l / 2, 0).rotateZ(-1.2 - rnd() * 0.4).rotateY(a).translate(0, y, 0), col, uvr('barkC'));
  }
  return b.geo();
}
function makeTreeGeos() {
  const out = {};
  out.spruce = conifer({ crownBase: 0.12, radius: 0.2, whorls: 15, per: 7, droopB: 0.55, droopT: 0.15, region: 'spruce', col: hex('#c6dccf'), coreCol: hex('#7d9a88'), exp: 1.0 }, 1);
  out.fir = conifer({ crownBase: 0.1, radius: 0.13, whorls: 17, per: 6, droopB: 0.35, droopT: -0.05, region: 'fir', col: hex('#bcd2be'), coreCol: hex('#6f8e78'), exp: 1.15 }, 2);
  out.lodgepole = conifer({ crownBase: 0.58, radius: 0.11, whorls: 8, per: 5, droopB: 0.1, droopT: -0.25, region: 'pine', col: hex('#d6dcc0'), coreCol: null, exp: 0.8, trunkR: 0.018 }, 3);
  out.ponderosa = broadleaf({ trunkH: 0.62, region: 'pine', barkR: 'barkP', bark: hex('#ffffff'), crown: [0, 0.78, 0, 0.2, 0.2, 0.2], cards: 46, size: 0.085, col: hex('#e6ecd2'), flex: 0.6, trunkR: 0.032 }, 4);
  out.aspen = broadleaf({ trunkH: 0.55, region: 'aspen', barkR: 'barkA', bark: hex('#ffffff'), crown: [0, 0.72, 0, 0.13, 0.26, 0.13], cards: 54, size: 0.06, col: hex('#ffffff'), flex: 2.4, trunkR: 0.016 }, 5);
  out.snag = snagGeo(6);
  out.krummholz = conifer({ crownBase: 0.02, radius: 0.55, whorls: 5, per: 8, droopB: 0.05, droopT: 0.0, region: 'fir', col: hex('#e2f2e4'), coreCol: hex('#a8c2ae'), exp: 0.6 }, 7);
  out.willow = broadleaf({ trunkH: 0.25, region: 'willow', barkR: 'barkC', bark: hex('#9a8a70'), crown: [0, 0.55, 0, 0.32, 0.4, 0.32], cards: 32, size: 0.14, col: hex('#ffffff'), flex: 1.6, trunkR: 0.03 }, 8);
  out.shrub = broadleaf({ trunkH: 0.1, region: 'shrub', barkR: 'barkC', bark: hex('#6a5a48'), crown: [0, 0.45, 0, 0.45, 0.38, 0.45], cards: 22, size: 0.22, col: hex('#ffffff'), flex: 0.8, trunkR: 0.03 }, 9);
  return out;
}

// hi-detail tree material: wind (trunk sway + branch flutter), translucency, dithered fade into impostors
const BAYER = `float bayer4(vec2 p){ ivec2 q = ivec2(mod(p, 4.0)); int i = q.x + q.y*4;
  float m[16] = float[16](0.0,8.0,2.0,10.0,12.0,4.0,14.0,6.0,3.0,11.0,1.0,9.0,15.0,7.0,13.0,5.0); return (m[i] + 0.5)/16.0; }`;
function treeMat(atlas) {
  const m = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.3, side: THREE.DoubleSide, alphaToCoverage: Q().msaa > 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uHi = U.treeHi; s.uniforms.uPlayer = U.player;
    s.vertexShader = 'uniform float uHi; uniform vec3 uPlayer; attribute float aFlex; varying float vDC;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      vDC = distance(ip.xz, cameraPosition.xz);
      if (vDC > uHi + 22.0) transformed = vec3(0.0);
      float ph = ip.x*0.07 + ip.z*0.05;
      float gust = 0.6 + 0.4*sin(uTime*0.35 + ip.x*0.004) + uStormV*1.4;
      float sw = (sin(uTime*1.1 + ph) + 0.5*sin(uTime*2.3 + ip.z*0.11))*gust;
      transformed.x += sw*0.012*transformed.y*transformed.y; transformed.z += sw*0.008*transformed.y*transformed.y;
      transformed.y += aFlex*sin(uTime*(3.5 + aFlex) + ph*7.0 + position.x*40.0)*0.006*gust;
      transformed.xz += aFlex*vec2(sin(uTime*4.1 + position.z*50.0), cos(uTime*3.7 + position.y*45.0))*0.003*gust;`)
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uStormV;');
    s.uniforms.uStormV = U.storm;
  };
  return patchLit(m, {
    key: 'treehi', ao: 0.45,
    extraPars: `uniform float uHi; varying float vDC; ${BAYER}`,
    fragment: (f) => f.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (bayer4(gl_FragCoord.xy) < clamp((vDC - uHi + 22.0)/44.0, 0.0, 1.0)) discard;`)
      .replace('reflectedLight.directDiffuse *= lvis;', `reflectedLight.directDiffuse *= lvis;
        vec3 lv = normalize((viewMatrix*vec4(uLightDir, 0.0)).xyz);
        float back = pow(max(dot(normalize(-vViewPosition), -lv), 0.0), 3.0);
        reflectedLight.directDiffuse += diffuseColor.rgb*uSunCol*back*1.4*lvis*(1.0 - smoothstep(0.0, 1.0, uStorm));`),
  });
}

// ---------------------------------------------------------------- impostors (8 views per species, lit at runtime)
const IMP_SPECIES = ['spruce', 'fir', 'lodgepole', 'ponderosa', 'aspen', 'snag'];
const IMP_FR = 8, IMP_COLS = IMP_FR + 1, IMP_RES = isTouch ? 96 : 160;
function bakeImpostors(geos, atlas) {
  const W = IMP_RES * IMP_COLS, Hh = IMP_RES * IMP_SPECIES.length;
  const mk = (srgb) => { const t = new THREE.WebGLRenderTarget(W, Hh, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter }); if (srgb) t.texture.colorSpace = THREE.SRGBColorSpace; return t; };
  const albRT = mk(true), nrmRT = mk(false);
  const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-0.55, 0.55, 1.1, 0, -5, 5), top = new THREE.OrthographicCamera(-0.55, 0.55, 0.55, -0.55, 0, 6);
  const albM = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.3, side: THREE.DoubleSide });
  const nrmM = new THREE.ShaderMaterial({
    uniforms: { map: { value: atlas } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying vec3 vN; void main(){ if (texture2D(map, vUv).a < 0.3) discard; vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n*0.5 + 0.5, 1.0); }',
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(undefined, albM); sc.add(mesh);
  const prevT = renderer.getRenderTarget(), prevC = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha(), prevTM = renderer.toneMapping, prevAC = renderer.autoClear;
  renderer.toneMapping = THREE.NoToneMapping; renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
  for (const [rt, mat] of [[albRT, albM], [nrmRT, nrmM]]) {
    rt.viewport.set(0, 0, W, Hh); renderer.setRenderTarget(rt); renderer.clear();
    mesh.material = mat;
    IMP_SPECIES.forEach((sp, row) => {
      mesh.geometry = geos[sp];
      for (let f = 0; f < IMP_FR; f++) {
        const th = f / IMP_FR * Math.PI * 2;
        cam.position.set(Math.sin(th) * 2, 0.5, Math.cos(th) * 2); cam.lookAt(0, 0.5, 0); cam.updateMatrixWorld();
        rt.viewport.set(f * IMP_RES, row * IMP_RES, IMP_RES, IMP_RES); renderer.setRenderTarget(rt);
        renderer.render(sc, cam);
      }
      // top-down frame (column 8): screen right = +x, screen up = -z
      top.position.set(0, 3, 0); top.up.set(0, 0, -1); top.lookAt(0, 0, 0); top.updateMatrixWorld();
      rt.viewport.set(IMP_FR * IMP_RES, row * IMP_RES, IMP_RES, IMP_RES); renderer.setRenderTarget(rt);
      renderer.render(sc, top);
    });
    rt.viewport.set(0, 0, W, Hh);
  }
  renderer.setRenderTarget(prevT); renderer.setClearColor(prevC, prevA); renderer.toneMapping = prevTM; renderer.autoClear = prevAC;
  return { alb: albRT.texture, nrm: nrmRT.texture };
}
function impostorMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { ...atmosUniforms(), uAlb: { value: tex.alb }, uNrm: { value: tex.nrm }, uHi: U.treeHi, uFar: U.impFar },
    vertexShader: `uniform float uHi, uFar; attribute vec4 aPos; attribute vec4 aInfo; attribute vec3 aTint;
      varying vec2 vUv0; varying vec2 vUv1; varying vec2 vUvT; varying float vTop; varying float vRot; varying float vBlend; varying vec3 vTint; varying vec3 vW; varying vec3 vRight; varying vec3 vFwd; varying vec3 vUp; varying float vDC;
      void main(){
        vec3 toC = cameraPosition - aPos.xyz; vDC = length(toC.xz);
        vUp = vec3(0.0, 1.0, 0.0);
        if (vDC < uHi - 22.0 || vDC > uFar) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
        float ang = atan(toC.x, toC.z) - aInfo.y;
        float f = fract(ang/6.2831853)*${IMP_FR.toFixed(1)}; float f0 = floor(f); float f1 = mod(f0 + 1.0, ${IMP_FR.toFixed(1)}); vBlend = f - f0;
        // camera-facing card pivoting about the crown centre, so the forest keeps its cover from the air
        vec3 ctr = aPos.xyz + vec3(0.0, aPos.w*0.55, 0.0);
        vec3 vd = normalize(cameraPosition - ctr);
        vFwd = normalize(vec3(toC.x, 0.0, toC.z)); vRight = vec3(vFwd.z, 0.0, -vFwd.x);
        vec3 up = normalize(cross(vd, vRight));
        float tilt = smoothstep(0.15, 0.9, vd.y);
        vec3 wp = ctr + vRight*position.x*aInfo.x*1.1 + up*(position.y - 0.5)*aPos.w*1.1*mix(1.0, 0.8, tilt);
        vUp = up;
        float row = aInfo.z;
        vUv0 = vec2((f0 + uv.x)/${IMP_COLS.toFixed(1)}, (row + uv.y)/${IMP_SPECIES.length.toFixed(1)});
        vUv1 = vec2((f1 + uv.x)/${IMP_COLS.toFixed(1)}, (row + uv.y)/${IMP_SPECIES.length.toFixed(1)});
        // top-view lookup: project the card point onto the crown footprint in the tree's own frame
        vec2 rel = (wp.xz - aPos.xz)/max(aInfo.x, 0.01); float cr = cos(aInfo.y), sr = sin(aInfo.y);
        vec2 loc = vec2(cr*rel.x - sr*rel.y, sr*rel.x + cr*rel.y);
        vUvT = vec2((${IMP_FR.toFixed(1)} + clamp(loc.x/1.1 + 0.5, 0.0, 1.0))/${IMP_COLS.toFixed(1)}, (row + clamp(-loc.y/1.1 + 0.5, 0.0, 1.0))/${IMP_SPECIES.length.toFixed(1)});
        vTop = smoothstep(0.5, 0.85, vd.y); vRot = aInfo.y;
        vTint = aTint; vW = wp;
        gl_Position = projectionMatrix*viewMatrix*vec4(wp, 1.0);
      }`,
    fragmentShader: `${ATMOS_PARS} uniform sampler2D uAlb, uNrm; uniform float uHi;
      varying vec2 vUv0; varying vec2 vUv1; varying vec2 vUvT; varying float vTop; varying float vRot; varying float vBlend; varying vec3 vTint; varying vec3 vW; varying vec3 vRight; varying vec3 vFwd; varying vec3 vUp; varying float vDC; ${BAYER}
      void main(){
        vec4 a = mix(texture2D(uAlb, vUv0), texture2D(uAlb, vUv1), vBlend);
        vec4 at = texture2D(uAlb, vUvT);
        a = mix(a, vec4(at.rgb*1.25, at.a), vTop);
        if (a.a < 0.45) discard;
        if (bayer4(gl_FragCoord.xy) >= clamp((vDC - uHi + 22.0)/44.0, 0.0, 1.0)) discard;
        vec3 n = mix(texture2D(uNrm, vUv0).xyz, texture2D(uNrm, vUv1).xyz, vBlend)*2.0 - 1.0;
        vec3 N = normalize(vRight*n.x + mix(vec3(0.0, 1.0, 0.0), vUp, 0.5)*n.y + vFwd*n.z);
        if (vTop > 0.01) { vec3 nt = texture2D(uNrm, vUvT).xyz*2.0 - 1.0; vec3 lt = vec3(nt.x, nt.z, -nt.y); float cr = cos(vRot), sr = sin(vRot);
          N = normalize(mix(N, vec3(cr*lt.x + sr*lt.z, lt.y, -sr*lt.x + cr*lt.z), vTop)); }
        float lvis = sunVisAt(vW)*cloudShadow(vW);
        vec3 alb = a.rgb*vTint;
        vec3 L = uSkyAmb*(0.65 + 0.35*N.y)*mix(1.0, aoAt(vW), 0.45)*${Math.PI.toFixed(4)} + uSunCol*max(dot(N, uLightDir), 0.0)*lvis*${Math.PI.toFixed(4)};
        L += uSunCol*pow(max(dot(-vFwd, uLightDir), 0.0), 3.0)*1.2*lvis;
        vec3 col = alb*L/${Math.PI.toFixed(4)} + alb*uFlash*1.5;
        gl_FragColor = vec4(applyAtmos(col, vW), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
function buildImpostors(data, tex) {
  const mat = impostorMaterial(tex), RS = 1500, NR = SIZE / RS;
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  for (let rz = 0; rz < NR; rz++) for (let rx = 0; rx < NR; rx++) {
    const pos = [], info = [], tint = [];
    IMP_SPECIES.forEach((sp, row) => {
      const d = data[sp];
      for (let o = 0; o < d.length; o += STRIDE) {
        if (Math.floor((d[o] + HALF) / RS) !== rx || Math.floor((d[o + 2] + HALF) / RS) !== rz) continue;
        pos.push(d[o], d[o + 1], d[o + 2], d[o + 6]); info.push(d[o + 5], d[o + 4], row, 0); tint.push(d[o + 8], d[o + 9], d[o + 10]);
      }
    });
    if (!pos.length) continue;
    const g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(pos), 4)); g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(new Float32Array(info), 4));
    g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(tint), 3)); g.instanceCount = pos.length / 4;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(-HALF + (rx + 0.5) * RS, 600, -HALF + (rz + 0.5) * RS), RS * 0.75 + 600);
    const m = new THREE.Mesh(g, mat); m.matrixAutoUpdate = false; scene.add(m);
  }
}

// ---------------------------------------------------------------- pooled instancing near the camera
const PC = 100, PNC = Math.ceil(SIZE / PC);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function composeInto(arr, off, d, o) {
  _e.set(d[o + 3], d[o + 4], 0); _q.setFromEuler(_e); _v.set(d[o], d[o + 1], d[o + 2]); _s.set(d[o + 5], d[o + 6], d[o + 7]);
  _m4.compose(_v, _q, _s); arr.set(_m4.elements, off);
}
export class Pool {
  constructor(geo, mat, data, radiusFn, cap, shadow) {
    const n = data.length / STRIDE, cellIdx = new Int32Array(n), start = new Int32Array(PNC * PNC + 1);
    for (let i = 0; i < n; i++) { const o = i * STRIDE, cx = clamp(Math.floor((data[o] + HALF) / PC), 0, PNC - 1), cz = clamp(Math.floor((data[o + 2] + HALF) / PC), 0, PNC - 1); cellIdx[i] = cz * PNC + cx; start[cellIdx[i] + 1]++; }
    for (let c = 0; c < PNC * PNC; c++) start[c + 1] += start[c];
    const fill = start.slice(0, PNC * PNC); this.mats = new Float32Array(n * 16); this.cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const p = fill[cellIdx[i]]++, o = i * STRIDE; composeInto(this.mats, p * 16, data, o); this.cols[p * 3] = data[o + 8]; this.cols[p * 3 + 1] = data[o + 9]; this.cols[p * 3 + 2] = data[o + 10]; }
    this.start = start; this.cap = Math.max(1, Math.min(n, cap)); this.radiusFn = radiusFn; this.lx = 1e9; this.lz = 1e9;
    const m = this.mesh = new THREE.InstancedMesh(geo, mat, this.cap); m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
  }
  update(x, z, force) {
    if (!force && Math.abs(x - this.lx) + Math.abs(z - this.lz) < 24) return;
    this.lx = x; this.lz = z;
    const R = this.radiusFn() + PC * 0.75, cells = [];
    const c0x = Math.max(0, Math.floor((x - R + HALF) / PC)), c1x = Math.min(PNC - 1, Math.floor((x + R + HALF) / PC));
    const c0z = Math.max(0, Math.floor((z - R + HALF) / PC)), c1z = Math.min(PNC - 1, Math.floor((z + R + HALF) / PC));
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) { const d = Math.hypot(-HALF + (cx + 0.5) * PC - x, -HALF + (cz + 0.5) * PC - z); if (d < R) cells.push([d, cz * PNC + cx]); }
    cells.sort((a, b) => a[0] - b[0]);
    let cnt = 0; const M = this.mesh.instanceMatrix.array, C = this.mesh.instanceColor.array;
    for (const [, c] of cells) {
      const s = this.start[c], k = Math.min(this.start[c + 1] - s, this.cap - cnt); if (k <= 0) continue;
      M.set(this.mats.subarray(s * 16, (s + k) * 16), cnt * 16); C.set(this.cols.subarray(s * 3, (s + k) * 3), cnt * 3); cnt += k;
      if (cnt >= this.cap) break;
    }
    this.mesh.count = cnt; this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
}

// granite boulders share the cliff material (triplanar ground-texture layer 2)
function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3), P = g.attributes.position, rnd = mulberry32(seed);
  const ox = rnd() * 50, oz = rnd() * 50;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    let f = 1 + 0.22 * nR(x * 1.2 + ox, z * 1.2 + y + oz) + 0.07 * nR(x * 4 + oz, z * 4 - y * 2);
    f = Math.min(f, 1.08 - 0.12 * Math.max(0, Math.abs(x + z * 0.3) - 0.6) * 3);
    P.setXYZ(i, x * f, Math.max(y * f * 0.66, -0.35), z * f * 1.1);
  }
  g.computeVertexNormals();
  const b = new TB(); b.mesh(g, hex('#ffffff'), [0, 0, 1, 1]);
  const geo = b.geo(); const c = geo.attributes.color, p = geo.attributes.position;
  for (let i = 0; i < c.count; i++) { const k = 0.7 + 0.35 * clamp(p.getY(i) + 0.4, 0, 1); c.setXYZ(i, k, k, k); }
  return geo;
}
function rockMaterial(albTex) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (s) => {
    s.uniforms.uAlb = { value: albTex };
    s.vertexShader = 'varying vec3 vRP; varying vec3 vRN;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRP = position*3.0 + vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2])*0.37; vRN = normal;');
  };
  return patchLit(m, {
    key: 'rock', ao: 0.8, wet: 0.35, extraPars: 'uniform highp sampler2DArray uAlb; varying vec3 vRP; varying vec3 vRN;',
    fragment: f => f.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 bw = pow(abs(normalize(vRN)), vec3(4.0)); bw /= dot(bw, vec3(1.0));
      vec3 tc = texture(uAlb, vec3(vRP.zy/2.2, 2.0)).rgb*bw.x + texture(uAlb, vec3(vRP.xz/2.2, 2.0)).rgb*bw.y + texture(uAlb, vec3(vRP.xy/2.2, 2.0)).rgb*bw.z;
      float moss = smoothstep(0.55, 0.9, normalize(vRN).y)*0.6;
      diffuseColor.rgb *= mix(tc, tc*vec3(0.62, 0.8, 0.45), moss);`),
  });
}

// ---------------------------------------------------------------- build all vegetation
export const pools = [];
const HI_CAP = { spruce: 7000, fir: 6000, lodgepole: 7000, ponderosa: 3500, aspen: 5000, krummholz: 3000, willow: 4000, snag: 1500, shrub: 5000 };
export function buildVegetation(data, albTex) {
  const atlas = paintAtlas(), geos = makeTreeGeos(), mat = treeMat(atlas);
  const capK = isTouch ? 0.55 : 1;
  for (const s of Object.keys(HI_CAP)) {
    const small = s === 'krummholz' || s === 'willow' || s === 'shrub';
    pools.push(new Pool(geos[s], mat, data[s], small ? () => Math.min(Q().treeHi, 200) + 30 : () => Q().treeHi + 40, Math.round(HI_CAP[s] * capK), !small || s === 'willow'));
  }
  buildImpostors(data, bakeImpostors(geos, atlas));
  const rm = rockMaterial(albTex);
  for (let v = 0; v < 3; v++) {
    const d = data.rocks, sub = []; for (let o = v * STRIDE; o < d.length; o += STRIDE * 3) for (let k = 0; k < STRIDE; k++) sub.push(d[o + k]);
    pools.push(new Pool(rockGeo(v + 1), rm, new Float32Array(sub), () => Q().rockR, isTouch ? 1800 : 3500, true));
  }
  const lg = new THREE.CylinderGeometry(0.5, 0.5, 1, 9, 1).rotateZ(Math.PI / 2), lb = new TB(); lb.mesh(lg, hex('#b0a492'), uvr('barkC'));
  const lm = patchLit(new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true }), { key: 'log', ao: 0.8, wet: 0.3 });
  pools.push(new Pool(lb.geo(), lm, data.logs, () => 300, 1500, true));
  return atlas;
}
export function updatePools(x, z, force) { for (const p of pools) p.update(x, z, force); }

// ---------------------------------------------------------------- grass & flowers (GPU, follow the camera)
const GLSL_HEIGHT = `
float terrainH(vec2 p){
  vec2 g = (p + uHalf)/uCell; vec2 fi = floor(g); vec2 f = g - fi;
  ivec2 i = ivec2(clamp(fi, vec2(0.0), vec2(uN - 2.0)));
  float a = texelFetch(uHeight, i, 0).r, b = texelFetch(uHeight, i + ivec2(1,0), 0).r;
  float c = texelFetch(uHeight, i + ivec2(0,1), 0).r, d = texelFetch(uHeight, i + ivec2(1,1), 0).r;
  return (f.x + f.y <= 1.0) ? a + (b-a)*f.x + (c-a)*f.y : d + (c-d)*(1.0-f.x) + (b-d)*(1.0-f.y);
}`;
const GRASS_PARS = `uniform vec2 uCam; uniform float uR, uInner, uWide, uHalf, uCell, uN, uSize, uBase; uniform highp sampler2D uHeight; uniform sampler2D uBiome, uTrail; uniform vec3 uPlayer;`;
export let grassMesh, flowerMesh, farGrass;
export function buildGrass() {
  const pos = [], idx = []; let v = 0; const r = mulberry32(99);
  for (let b = 0; b < 7; b++) {
    const ang = r() * Math.PI * 2, ox = (r() - 0.5) * 0.45, oz = (r() - 0.5) * 0.45, lean = 0.1 + r() * 0.4, h = 0.55 + r() * 0.45, w = 0.022 + r() * 0.016;
    const dx = Math.cos(ang), dz = Math.sin(ang), px = -dz, pz = dx;
    for (let s = 0; s <= 4; s++) { const t = s / 4, ww = w * (1 - t * 0.9), cx = ox + dx * lean * t * t, cz = oz + dz * lean * t * t; pos.push(cx - px * ww, h * t, cz - pz * ww, cx + px * ww, h * t, cz + pz * ww); }
    for (let s = 0; s < 4; s++) { const a = v + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    v += 10;
  }
  const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const MAX = 64000, off = new Float32Array(MAX * 3);
  for (let i = 0; i < MAX; i++) { off[i * 3] = r() * 2 - 1; off[i * 3 + 1] = r() * 100; off[i * 3 + 2] = r() * 2 - 1; }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3)); g.instanceCount = Q().grass;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosUniforms(), ...GRID, uHeight: U.heightTex, uBiome: U.biomeTex, uTrail: U.trailTex, uCam: U.cam, uR: { value: Q().grassR }, uInner: { value: 0 }, uWide: { value: 1 }, uPlayer: U.player },
    vertexShader: `${GRASS_PARS} ${ATMOS_PARS} attribute vec3 aOff; varying vec3 vCol; varying vec3 vW; varying float vT; varying float vTrans;
      ${GLSL_HEIGHT}
      void main(){
        float S = 2.0*uR; vec2 o = aOff.xz*uR; vec2 wp = o + S*floor((uCam - o)/S + 0.5);
        float dist = length(wp - uCam);
        vec4 bio = textureLod(uBiome, ((wp + uHalf)/uCell + 0.5)/uN, 0.0);
        float tr = textureLod(uTrail, (wp + uHalf)/uSize, 0.0).r;
        float dens = bio.a*(1.0 - smoothstep(0.2, 0.55, tr));
        float fade = (1.0 - smoothstep(uR*0.6, uR, dist))*(uInner > 0.0 ? smoothstep(uInner*0.7, uInner, dist) : 1.0);
        vCol = vec3(0.0); vW = vec3(0.0); vT = 0.0; vTrans = 0.0;
        if (hash12(wp*0.731 + aOff.y) > dens || fade <= 0.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
        float gy = terrainH(wp), E = gy + uBase, tun = smoothstep(3380.0, 3560.0, E);
        float clump = vnoise(wp*0.35);
        float sc = 0.62*mix(0.4, 1.0, hash12(wp + 3.1))*mix(0.55, 1.15, clump)*mix(1.0, 0.3, tun)*(0.75 + 0.5*bio.b)*(0.6 + 0.4*dens)*mix(0.35, 1.0, fade);
        float a = hash12(wp + 9.7)*6.2831, ca = cos(a), sa = sin(a);
        vec3 p = position; float t = position.y;
        p.xz = vec2(ca*p.x - sa*p.z, sa*p.x + ca*p.z)*mix(0.8, 1.5, hash12(wp + 1.3))*uWide;
        p.y *= sc;
        // travelling gusts: bright waves rolling across the meadow
        float wave = vnoise(wp*0.045 - uTime*vec2(0.55, 0.22));
        float gust = (0.25 + wave*1.1)*(1.0 + uStorm*1.8);
        float w = (sin(uTime*2.1 + wp.x*0.33 + wp.y*0.21)*0.25 + 0.55)*gust;
        vec2 wdir = normalize(vec2(0.9, 0.42));
        // bend away from the hiker
        vec2 away = wp - uPlayer.xz; float pd = length(away); float push = (1.0 - smoothstep(0.3, 1.3, pd))*step(abs(uPlayer.y - gy), 2.5);
        vec2 bend = wdir*w*0.55 + (pd > 0.01 ? away/pd : vec2(0.0))*push*1.1;
        p.xz += bend*t*t*sc; p.y -= dot(bend, bend)*t*t*sc*0.22;
        vec3 world = vec3(wp.x, gy - 0.05, wp.y) + p;
        float dry = smoothstep(0.55, 0.85, vnoise(wp*0.0035) + 0.3*vnoise(wp*0.045) - 0.15)*(1.0 - bio.b);
        vec3 tipC = mix(srgb(vec3(0.46,0.58,0.18)), srgb(vec3(0.76,0.68,0.38)), dry);
        tipC = mix(tipC, srgb(vec3(0.52,0.54,0.30)), tun) * (1.0 + wave*0.25);
        vec3 c = mix(srgb(vec3(0.12,0.2,0.06)), tipC, smoothstep(0.0, 0.9, t))*(0.82 + 0.36*hash12(wp + 5.5));
        float canopy = 1.0 - 0.65*smoothstep(0.2, 0.7, bio.r);
        vec3 wpos = vec3(wp.x, gy, wp.y);
        float lvis = sunVisAt(wpos)*cloudShadow(wpos)*canopy;
        vec3 L = uSkyAmb*(0.45 + 0.55*t)*aoAt(wpos)*3.14159 + uSunCol*clamp(uLightDir.y*0.7 + 0.3, 0.0, 1.0)*lvis*(0.5 + 0.5*t)*3.14159;
        vCol = c*L/3.14159 + c*uFlash*1.5; vT = t; vTrans = lvis; vW = world;
        gl_Position = projectionMatrix*viewMatrix*vec4(world, 1.0);
      }`,
    fragmentShader: `${ATMOS_PARS} varying vec3 vCol; varying vec3 vW; varying float vT; varying float vTrans;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float back = pow(max(dot(-V, uLightDir), 0.0), 4.0)*vT;
        vec3 c = vCol + vCol*uSunCol*back*6.0*vTrans;
        gl_FragColor = vec4(applyAtmos(c, vW), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
  grassMesh = new THREE.Mesh(g, mat); grassMesh.frustumCulled = false; scene.add(grassMesh);
  // sparse, wider far ring so the meadow does not end in a hard edge
  const fg2 = new THREE.InstancedBufferGeometry(); fg2.index = g.index; fg2.attributes.position = g.attributes.position; fg2.attributes.aOff = g.attributes.aOff;
  fg2.instanceCount = 0;
  const m2 = new THREE.ShaderMaterial({ uniforms: { ...mat.uniforms, uR: { value: 120 }, uInner: { value: Q().grassR }, uWide: { value: 2.2 } }, vertexShader: mat.vertexShader, fragmentShader: mat.fragmentShader, side: THREE.DoubleSide });
  farGrass = new THREE.Mesh(fg2, m2); farGrass.frustumCulled = false; scene.add(farGrass);

  // wildflowers: disc heads (daisies, columbines) and spikes (paintbrush, lupine, elephant's head)
  const fp = [], fu = [], fpart = [], fi = [];
  const quad = (a, b, c, d, part) => { const s = fp.length / 3; fp.push(...a, ...b, ...c, ...d); fu.push(0, 0, 1, 0, 1, 1, 0, 1); fpart.push(part, part, part, part); fi.push(s, s + 1, s + 2, s, s + 2, s + 3); };
  quad([-0.01, 0, 0], [0.01, 0, 0], [0.01, 1, 0], [-0.01, 1, 0], 0);
  quad([0, 0, -0.01], [0, 0, 0.01], [0, 1, 0.01], [0, 1, -0.01], 0);
  quad([-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], 1);
  quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], 2);
  quad([0, -0.5, -0.5], [0, -0.5, 0.5], [0, 0.5, 0.5], [0, 0.5, -0.5], 2);
  for (let l = 0; l < 2; l++) { const a = l * 2.1 + 0.4, cx = Math.cos(a), sz = Math.sin(a); quad([0, 0.3, 0], [cx * 0.09, 0.32, sz * 0.09], [cx * 0.1, 0.42, sz * 0.1], [0.0, 0.36, 0], 3); }
  const fg = new THREE.InstancedBufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); fg.setAttribute('aPart', new THREE.Float32BufferAttribute(fpart, 1)); fg.setIndex(fi);
  const FMAX = 22000, foff = new Float32Array(FMAX * 3);
  for (let i = 0; i < FMAX; i++) { foff[i * 3] = r() * 2 - 1; foff[i * 3 + 1] = r() * 100; foff[i * 3 + 2] = r() * 2 - 1; }
  fg.setAttribute('aOff', new THREE.InstancedBufferAttribute(foff, 3)); fg.instanceCount = Q().flowers;
  const fmat = new THREE.ShaderMaterial({
    uniforms: { ...atmosUniforms(), ...GRID, uHeight: U.heightTex, uBiome: U.biomeTex, uTrail: U.trailTex, uCam: U.cam, uR: { value: Q().flowerR }, uPlayer: U.player },
    vertexShader: `${GRASS_PARS} ${ATMOS_PARS} attribute vec3 aOff; attribute float aPart;
      varying vec2 vUv; varying float vPart; varying vec3 vA; varying vec3 vB; varying float vPet; varying float vSpike; varying vec3 vL; varying vec3 vW;
      const vec3 FA[9] = vec3[9](vec3(0.55,0.62,0.98), vec3(0.92,0.18,0.10), vec3(0.42,0.34,0.88), vec3(1.0,0.80,0.12), vec3(0.93,0.42,0.68), vec3(0.38,0.58,1.0), vec3(0.96,0.52,0.76), vec3(1.0,0.84,0.10), vec3(0.95,0.95,0.92));
      const vec3 FB[9] = vec3[9](vec3(0.98,0.97,0.92), vec3(0.98,0.55,0.22), vec3(0.88,0.88,1.0), vec3(0.72,0.42,0.08), vec3(0.98,0.70,0.85), vec3(1.0,0.90,0.30), vec3(1.0,0.82,0.90), vec3(0.85,0.50,0.05), vec3(1.0,0.85,0.20));
      const float FP[9] = float[9](5.0, 7.0, 6.0, 12.0, 5.0, 5.0, 5.0, 14.0, 8.0);
      const float FS[9] = float[9](1.35, 1.0, 1.0, 1.15, 1.0, 0.7, 0.65, 1.5, 0.8);
      const float SPK[9] = float[9](0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
      ${GLSL_HEIGHT}
      void main(){
        float S = 2.0*uR; vec2 o = aOff.xz*uR; vec2 wp = o + S*floor((uCam - o)/S + 0.5);
        float dist = length(wp - uCam);
        vec4 bio = textureLod(uBiome, ((wp + uHalf)/uCell + 0.5)/uN, 0.0);
        float tr = textureLod(uTrail, (wp + uHalf)/uSize, 0.0).r;
        float fade = 1.0 - smoothstep(uR*0.6, uR, dist);
        vUv = uv; vPart = aPart; vA = vec3(0.0); vB = vec3(0.0); vPet = 5.0; vSpike = 0.0; vL = vec3(0.0); vW = vec3(0.0);
        float patchy = smoothstep(0.35, 0.75, vnoise(wp*0.08 + aOff.y*0.01));
        if (hash12(wp*0.913 + aOff.y) > bio.g*(0.5 + patchy)*(1.0 - smoothstep(0.2, 0.5, tr))*1.3 || fade <= 0.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
        float gy = terrainH(wp), E = gy + uBase; bool tun = E > 3470.0 + (hash12(wp + 2.0) - 0.5)*80.0;
        float spf = vnoise(wp*0.12 + 4.0)*0.6 + hash12(wp + 4.2)*0.4;
        int s = tun ? 5 + int(spf*3.99) : int(spf*4.99);
        if (!tun && hash12(wp + 9.0) < 0.08) s = 8;
        float spike = SPK[s];
        float stem = tun ? mix(0.05, 0.12, hash12(wp + 6.0)) : mix(0.22, 0.6, hash12(wp + 6.0));
        float head = FS[s]*(tun ? 0.06 : 0.1)*mix(0.8, 1.25, hash12(wp + 8.0))*mix(0.4, 1.0, fade);
        vec3 p = position;
        vec2 away = wp - uPlayer.xz; float pd = length(away); float push = (1.0 - smoothstep(0.3, 1.1, pd))*step(abs(uPlayer.y - gy), 2.5);
        vec2 bend = vec2(sin(uTime*2.0 + wp.x*0.4 + wp.y*0.3), cos(uTime*1.7 + wp.y*0.5))*0.06*stem*(1.0 + uStorm*2.0) + (pd > 0.01 ? away/pd : vec2(0.0))*push*0.25;
        if (aPart > 2.5) { p *= stem*0.9; p.xz += bend*0.4; }
        else if (aPart > 1.5) { p.y = (p.y + 0.5)*(spike > 0.5 ? 2.6 : 1.0) - 0.5; p.xz *= spike > 0.5 ? 0.7 : 1.0; p = p*head + vec3(bend.x, stem + (spike > 0.5 ? head*0.8 : 0.0), bend.y); }
        else if (aPart > 0.5) { p = p*head*(1.0 - spike) + vec3(bend.x, stem, bend.y); }
        else { p.y *= stem; p.xz += bend*p.y/stem*p.y/stem; }
        float a = hash12(wp + 1.9)*6.2831, ca = cos(a), sa = sin(a); p.xz = vec2(ca*p.x - sa*p.z, sa*p.x + ca*p.z);
        vec3 world = vec3(wp.x, gy - 0.02, wp.y) + p;
        vA = srgb(FA[s]); vB = srgb(FB[s]); vPet = FP[s]; vSpike = spike;
        vec3 wpos = vec3(wp.x, gy, wp.y);
        vL = uSkyAmb*0.9*aoAt(wpos) + uSunCol*clamp(uLightDir.y*0.7 + 0.3, 0.0, 1.0)*sunVisAt(wpos)*cloudShadow(wpos)*(1.0 - 0.6*smoothstep(0.2, 0.7, bio.r)) + uFlash*0.5;
        vW = world;
        gl_Position = projectionMatrix*viewMatrix*vec4(world, 1.0);
      }`,
    fragmentShader: `${ATMOS_PARS} varying vec2 vUv; varying float vPart; varying vec3 vA; varying vec3 vB; varying float vPet; varying float vSpike; varying vec3 vL; varying vec3 vW;
      void main(){
        vec3 c;
        if (vPart < 0.5 || vPart > 2.5) { c = srgb(vec3(0.25, 0.42, 0.14)); if (vPart > 2.5 && abs(vUv.x - 0.5) > 0.45*(1.0 - vUv.y) + 0.05) discard; }
        else if (vSpike > 0.5 && vPart > 1.5) {
          float y = vUv.y, wdt = 0.42*(1.0 - y*0.8)*(0.75 + 0.25*sin(y*40.0));
          if (abs(vUv.x - 0.5) > wdt || y < 0.05) discard;
          c = mix(vB, vA, smoothstep(0.0, 0.6, y))*(0.85 + 0.3*fract(y*7.0));
        } else {
          vec2 q = vUv - 0.5; float r = length(q)*2.0, a = atan(q.y, q.x); float pet = 0.5 + 0.5*abs(cos(a*vPet*0.5));
          if (r > pet) discard; c = mix(vB, vA, smoothstep(0.12, 0.38, r))*(0.9 + 0.2*smoothstep(0.6, 1.0, r/pet));
        }
        gl_FragColor = vec4(applyAtmos(c*vL, vW), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
  flowerMesh = new THREE.Mesh(fg, fmat); flowerMesh.frustumCulled = false; scene.add(flowerMesh);
}
export function applyVegQuality() {
  if (!grassMesh) return;
  grassMesh.geometry.instanceCount = Q().grass; grassMesh.material.uniforms.uR.value = Q().grassR;
  farGrass.geometry.instanceCount = Q().post >= 2 ? 30000 : 0; farGrass.material.uniforms.uInner.value = Q().grassR;
  flowerMesh.geometry.instanceCount = Q().flowers; flowerMesh.material.uniforms.uR.value = Q().flowerR;
  U.treeHi.value = Q().treeHi; U.impFar.value = Q().imp;
}
export { G };
