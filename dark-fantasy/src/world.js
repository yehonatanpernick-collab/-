// ============================================================
//  World building blocks: splat terrain, grass, scatter, particles
// ============================================================
import * as THREE from 'three';
import { G, Q, pointScale } from './engine.js';
import { fbm2, makeRng, smoothstep } from './noise.js';

// ---------- splat terrain ----------
/**
 * layers: [{set, scale, tint}] x3 (A base, B patches by vertex weight, C slope rock triplanar)
 */
export function terrainMaterial(layers, o = {}) {
  const [A, B, C] = layers;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: o.env ?? 0.6 });
  const U = {
    tA: { value: A.set.map }, nA: { value: A.set.normalMap }, oA: { value: A.set.orm }, eA: { value: A.set.emissiveMap || A.set.map },
    tB: { value: B.set.map }, nB: { value: B.set.normalMap }, oB: { value: B.set.orm }, eB: { value: B.set.emissiveMap || B.set.map },
    tC: { value: C.set.map }, nC: { value: C.set.normalMap }, oC: { value: C.set.orm },
    sA: { value: A.scale }, sB: { value: B.scale }, sC: { value: C.scale },
    cA: { value: new THREE.Color(A.tint ?? 0xffffff) }, cB: { value: new THREE.Color(B.tint ?? 0xffffff) }, cC: { value: new THREE.Color(C.tint ?? 0xffffff) },
    emA: { value: A.set.emissiveMap ? (A.emissive ?? 6) : 0 }, emB: { value: B.set.emissiveMap ? (B.emissive ?? 6) : 0 },
    slopeLo: { value: o.slopeLo ?? 0.22 }, slopeHi: { value: o.slopeHi ?? 0.45 }, nStr: { value: o.normal ?? 1.0 },
    uTime: G.time,
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 splat; varying vec3 vSplat; varying vec3 vWPos; varying vec3 vWNrm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = splat; vWPos = (modelMatrix * vec4(position,1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tA,nA,oA,eA,tB,nB,oB,eB,tC,nC,oC; uniform float sA,sB,sC,emA,emB,slopeLo,slopeHi,nStr,uTime;
        uniform vec3 cA,cB,cC; varying vec3 vSplat; varying vec3 vWPos; varying vec3 vWNrm;
        vec3 gNrm; float gRough; float gAO; vec3 gEmis; vec3 gAlb;
        vec3 triW(vec3 n){ vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x+w.y+w.z); }
        void splatSample(){
          vec3 n = normalize(vWNrm);
          float slope = 1.0 - n.y;
          float wC = smoothstep(slopeLo, slopeHi, slope + (vSplat.z - 0.5)*0.1);
          float wB = clamp(vSplat.x, 0.0, 1.0) * (1.0 - wC);
          float wA = (1.0 - wB) * (1.0 - wC);
          vec2 uA = vWPos.xz * sA, uB = vWPos.xz * sB;
          // break tiling: blend two rotated/scaled samples of A
          vec2 uA2 = mat2(0.8,-0.6,0.6,0.8) * uA * 0.37 + 0.31;
          float var = texture2D(oB, vWPos.xz*0.013).g;
          vec3 aA = mix(texture2D(tA, uA).rgb, texture2D(tA, uA2).rgb, 0.35) * cA;
          vec3 aB = texture2D(tB, uB).rgb * cB;
          vec3 w = triW(n);
          vec3 aC = (texture2D(tC, vWPos.zy*sC).rgb*w.x + texture2D(tC, vWPos.xz*sC).rgb*w.y + texture2D(tC, vWPos.xy*sC).rgb*w.z) * cC;
          vec3 oA_ = texture2D(oA, uA).rgb, oB_ = texture2D(oB, uB).rgb;
          vec3 oC_ = texture2D(oC, vWPos.zy*sC).rgb*w.x + texture2D(oC, vWPos.xz*sC).rgb*w.y + texture2D(oC, vWPos.xy*sC).rgb*w.z;
          vec3 nA_ = texture2D(nA, uA).xyz*2.0-1.0, nB_ = texture2D(nB, uB).xyz*2.0-1.0;
          vec3 nCx = texture2D(nC, vWPos.zy*sC).xyz*2.0-1.0, nCy = texture2D(nC, vWPos.xz*sC).xyz*2.0-1.0, nCz = texture2D(nC, vWPos.xy*sC).xyz*2.0-1.0;
          // height-aware blend between A and B
          float hA = oA_.r, hB = oB_.r;
          float bB = smoothstep(0.0, 1.0, clamp((wB - wA) * 2.0 + (hB - hA) * 0.8 + 0.5, 0.0, 1.0)) * (1.0 - wC);
          float bA = (1.0 - bB) * (1.0 - wC);
          gAlb = aA*bA + aB*bB + aC*wC;
          gAlb *= mix(1.0, vSplat.y, 0.85) * (0.85 + 0.3*var);
          gRough = oA_.g*bA + oB_.g*bB + oC_.g*wC;
          gAO = oA_.r*bA + oB_.r*bB + oC_.r*wC;
          vec3 tn = nA_*bA + nB_*bB;
          vec3 wn = n + vec3(tn.x, 0.0, tn.y) * nStr * (1.0 - wC);
          vec3 cN = vec3(0.0, nCx.y, nCx.x)*w.x + vec3(nCy.x, 0.0, nCy.y)*w.y + vec3(nCz.x, nCz.y, 0.0)*w.z;
          wn += cN * nStr * 1.2 * wC;
          gNrm = normalize(wn);
          gEmis = vec3(0.0);
          if (emA > 0.0) gEmis += texture2D(eA, uA).rgb * emA * bA;
          if (emB > 0.0) gEmis += texture2D(eB, uB).rgb * emB * bB;
        }`)
      .replace('#include <map_fragment>', `splatSample(); diffuseColor.rgb *= gAlb;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * gRough;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = 0.0;`)
      .replace('#include <normal_fragment_maps>', `normal = normalize((viewMatrix * vec4(gNrm, 0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gEmis * (0.75 + 0.25*sin(uTime*1.7 + vWPos.x*0.3 + vWPos.z*0.2));`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(1.0, gAO, 0.8); reflectedLight.directDiffuse *= mix(1.0, gAO, 0.35);`);
  };
  mat.customProgramCacheKey = () => 'terrain-v1';
  return mat;
}

/** Terrain mesh from a height function; splatFn(x,z,h,slope) -> [bWeight, ao, var] */
export function buildTerrain(heightAt, mat, splatFn, size = 300, seg = 240) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const sp = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const s = splatFn(p.getX(i), p.getZ(i), p.getY(i), 1 - n.getY(i));
    sp[i * 3] = s[0]; sp[i * 3 + 1] = s[1]; sp[i * 3 + 2] = s[2] ?? 0.5;
  }
  g.setAttribute('splat', new THREE.BufferAttribute(sp, 3));
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

// ---------- instanced grass ----------
export function buildGrass({ count, area, heightAt, accept, colA, colB, height = 0.45, width = 0.028, seed = 3, tipFrost = 0 }) {
  const segs = 4;
  const bg = new THREE.BufferGeometry();
  const pos = [], col = [], idx = [];
  // 3 blades per clump, crossing
  const blades = 3;
  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * Math.PI + 0.3;
    const lean = 0.15 + b * 0.08;
    const off = b * (segs + 1) * 2;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const w = width * (1 - t) * (1 - t * 0.3);
      const bend = lean * t * t;
      const cx = Math.cos(ang), cz = Math.sin(ang);
      const ox = -cz * bend * 0.4, oz = cx * bend * 0.4;
      pos.push(cx * w + ox, t, cz * w + oz, -cx * w + ox, t, -cz * w + oz);
      const c = t;
      col.push(c, b / blades, 0, c, b / blades, 0);
      if (s < segs) { const a = off + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  bg.setIndex(idx);
  bg.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, envMapIntensity: 0.4, vertexColors: true });
  const cA = new THREE.Color(colA), cB = new THREE.Color(colB);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = G.time; sh.uniforms.uWind = G.wind; sh.uniforms.uPlayer = G.player;
    sh.uniforms.cA = { value: cA }; sh.uniforms.cB = { value: cB }; sh.uniforms.frost = { value: tipFrost };
    sh.vertexShader = 'uniform float uTime; uniform vec2 uWind; uniform vec3 uPlayer; uniform vec3 cA, cB; uniform float frost; varying vec3 vGCol;\n' + sh.vertexShader
      .replace('#include <color_vertex>', `#include <color_vertex>
        float tip = color.r;
        vec3 gc = mix(cA, cB, tip);
        #ifdef USE_INSTANCING_COLOR
          gc *= instanceColor.rgb;
        #endif
        gc = mix(gc, vec3(0.85, 0.9, 1.0), frost * smoothstep(0.6, 1.0, tip));
        vGCol = gc * (0.55 + 0.45 * tip);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wBase = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float t = position.y;
        float sway = sin(uTime * 1.7 + wBase.x * 0.35 + wBase.z * 0.25) * 0.5 + sin(uTime * 3.1 + wBase.x * 1.1) * 0.25;
        vec2 bend = uWind * (0.18 + sway * 0.16) * t * t;
        vec2 away = wBase.xz - uPlayer.xz; float dp = length(away);
        bend += normalize(away + 0.0001) * smoothstep(1.3, 0.0, dp) * 0.7 * t;
        transformed.xz += bend;
        transformed.y -= dot(bend, bend) * 0.4;`);
    sh.fragmentShader = 'varying vec3 vGCol;\n' + sh.fragmentShader.replace('#include <color_fragment>', 'diffuseColor.rgb *= vGCol;').replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
  };
  mat.customProgramCacheKey = () => 'grass-v1';
  const im = new THREE.InstancedMesh(bg, mat, count);
  const rng = makeRng(seed);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 4) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * area;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const dens = accept(x, z);
    if (dens <= 0 || rng() > dens) continue;
    p.set(x, heightAt(x, z) - 0.02, z);
    e.set((rng() - 0.5) * 0.25, rng() * Math.PI * 2, (rng() - 0.5) * 0.25); q.setFromEuler(e);
    const h = height * (0.5 + rng() * 0.9) * (0.6 + dens * 0.5);
    s.set(0.8 + rng() * 0.5, h, 0.8 + rng() * 0.5);
    m.compose(p, q, s); im.setMatrixAt(n, m);
    c.setHSL(0, 0, 0.75 + rng() * 0.5); c.r *= 0.9 + rng() * 0.2; im.setColorAt(n, c);
    n++;
  }
  im.count = n;
  im.receiveShadow = true; im.castShadow = false;
  im.frustumCulled = false;
  im.userData.noAO = true;
  return im;
}

// ---------- instanced scatter ----------
export function scatter(geo, mat, n, place, opts = {}) {
  const im = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let c = 0;
  for (let i = 0; i < n * 6 && c < n; i++) {
    const r = place(i);
    if (!r) continue;
    p.set(r.x, r.y, r.z);
    e.set(r.rx || 0, r.ry || 0, r.rz || 0); q.setFromEuler(e);
    if (Array.isArray(r.s)) s.set(...r.s); else s.setScalar(r.s ?? 1);
    m.compose(p, q, s); im.setMatrixAt(c, m);
    if (r.color) im.setColorAt(c, r.color);
    c++;
  }
  im.count = c;
  im.castShadow = opts.cast !== false; im.receiveShadow = true;
  return im;
}

// ---------- ambient GPU particles (snow, ash, embers, motes) ----------
export function ambientParticles({ n, radius = 45, height = 18, color, size, fall = -0.3, swirl = 1, additive = true, flicker = true, follow = true }) {
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * radius; pos[i * 3 + 1] = Math.random() * height; pos[i * 3 + 2] = (Math.random() * 2 - 1) * radius;
    seed[i] = Math.random() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { time: G.time, scale: { value: pointScale() }, col: { value: new THREE.Color(color) }, size: { value: size }, fall: { value: fall }, swirl: { value: swirl }, R: { value: radius }, H: { value: height }, center: G.player, flick: { value: flicker ? 1 : 0 } },
    vertexShader: /* glsl */`
      attribute float seed; uniform float time, scale, size, fall, swirl, R, H, flick; uniform vec3 center; varying float vA;
      void main(){
        vec3 p = position;
        p.y = mod(p.y + time * fall * (0.6 + 0.4 * fract(seed * 7.3)) + seed, H);
        p.x += sin(time * 0.5 + seed) * swirl + sin(time * 1.3 + seed * 3.0) * 0.3 * swirl;
        p.z += cos(time * 0.4 + seed * 1.7) * swirl;
        vec2 rel = mod(p.xz - center.xz + R, 2.0 * R) - R;
        p.xz = center.xz + rel;
        p.y += center.y - 2.0;
        float edge = smoothstep(R, R * 0.6, length(rel));
        vA = edge * smoothstep(0.0, 1.5, p.y - center.y + 2.0) * mix(1.0, 0.45 + 0.55 * sin(time * 4.0 + seed * 9.0), flick);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * scale * projectionMatrix[1][1] / -mv.z;
      }`,
    fragmentShader: `uniform vec3 col; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d) * vA; gl_FragColor = vec4(col * a, a); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.userData.update = () => { mat.uniforms.scale.value = pointScale(); };
  return pts;
}

// ---------- CPU particle pool for effects ----------
export class Particles {
  constructor(scene, max, blending = THREE.AdditiveBlending, soft = true) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.cursor = 0; this.alive = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending,
      uniforms: { scale: { value: pointScale() } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; uniform float scale; varying vec3 vC; varying float vA;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = alpha > 0.0 ? size * scale * projectionMatrix[1][1] / -mv.z : 0.0; }`,
      fragmentShader: blending === THREE.AdditiveBlending
        ? `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a; gl_FragColor = vec4(vC * a * vA, a * vA); }`
        : `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.2, d) * vA * 0.8; gl_FragColor = vec4(vC, a); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, c0, c1, size, life, grav = 0, drag = 0, size1 = -1) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.c0[i3] = c0[0]; this.c0[i3 + 1] = c0[1]; this.c0[i3 + 2] = c0[2];
    this.c1[i3] = c1[0]; this.c1[i3 + 1] = c1[1]; this.c1[i3 + 2] = c1[2];
    this.s0[i] = size; this.s1[i] = size1 < 0 ? size * 0.4 : size1; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.drag[i] = drag;
  }
  burst(p, n, speed, c0, c1, size, life, grav = 0, up = 0.4, drag = 2, size1 = -1) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, el = (Math.random() - 0.3) * Math.PI * 0.6;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(el) * s, Math.sin(el) * s + up * speed, Math.sin(a) * Math.cos(el) * s,
        c0, c1, size * (0.6 + Math.random() * 0.7), life * (0.6 + Math.random() * 0.6), grav, drag, size1);
    }
  }
  update(dt) {
    const { pos, vel, life, maxLife, col, c0, c1, size, s0, s1, alpha, grav, drag } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) alpha[i] = 0; continue; }
      life[i] -= dt;
      const t = 1 - life[i] / maxLife[i];
      const dr = Math.exp(-drag[i] * dt), i3 = i * 3;
      vel[i3] *= dr; vel[i3 + 1] = vel[i3 + 1] * dr - grav[i] * dt; vel[i3 + 2] *= dr;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      col[i3] = c0[i3] + (c1[i3] - c0[i3]) * t; col[i3 + 1] = c0[i3 + 1] + (c1[i3 + 1] - c0[i3 + 1]) * t; col[i3 + 2] = c0[i3 + 2] + (c1[i3 + 2] - c0[i3 + 2]) * t;
      size[i] = s0[i] + (s1[i] - s0[i]) * t;
      alpha[i] = Math.min(1, (1 - t) * 1.8) * Math.min(1, t * 14 + 0.15);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
    this.mat.uniforms.scale.value = pointScale();
  }
  clear() { this.life.fill(0); }
}

export { smoothstep, fbm2 };
