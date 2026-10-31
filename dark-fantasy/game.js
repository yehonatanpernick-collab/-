// ============================================================
//  משמר האפר — ASHEN VIGIL
//  A dark-fantasy third-person action game (Three.js)
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from './lib/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './lib/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from './lib/postprocessing/ShaderPass.js';
import { OutputPass } from './lib/postprocessing/OutputPass.js';
import { buildWorld, heightAt, ARENA_R, softSpriteTexture } from './world.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const ease = (t) => t * t * (3 - 2 * t);
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------------- renderer / scene ----------------
const canvasEl = $('c');
const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: false, powerPreference: 'high-performance' });
const PR = Math.min(window.devicePixelRatio, IS_TOUCH ? 1.25 : 1.5);
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0x120a10);
scene.background = FOG_COLOR;
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.016);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 900);

// lights
const hemi = new THREE.HemisphereLight(0x4a3a6a, 0x140c0a, 1.3);
scene.add(hemi);
const world = buildWorld(scene);
const moon = new THREE.DirectionalLight(0xe08a84, 1.9);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -28; moon.shadow.camera.right = 28;
moon.shadow.camera.top = 28; moon.shadow.camera.bottom = -28;
moon.shadow.camera.near = 1; moon.shadow.camera.far = 140;
moon.shadow.bias = -0.0006;
moon.shadow.normalBias = 0.04;
scene.add(moon, moon.target);
const rim = new THREE.DirectionalLight(0x6070d0, 0.9); // cold back-fill
rim.position.set(30, 20, 40);
scene.add(rim);

// ---------------- post-processing ----------------
const rt = new THREE.WebGLRenderTarget(innerWidth * PR, innerHeight * PR, { type: THREE.HalfFloatType, samples: IS_TOUCH ? 0 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.55, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, damage: { value: 0 }, lowHp: { value: 0 },
    res: { value: new THREE.Vector2(innerWidth, innerHeight) }, fade: { value: 0 }, heal: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float time, damage, lowHp, fade, heal; uniform vec2 res; varying vec2 vUv;
    void main(){
      vec2 uv = vUv; vec2 c = uv-0.5; float d = length(c*vec2(res.x/res.y,1.0));
      float ca = 0.0015 + damage*0.008;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c*ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c*ca).b;
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, 0.88 - lowHp*0.4);
      col += vec3(0.012,0.0,0.022)*(1.0-l);
      col = pow(col, vec3(1.06));
      float v = smoothstep(1.05, 0.28, d);
      col *= mix(0.25, 1.0, v);
      float pulse = 0.6+0.4*sin(time*5.0);
      col = mix(col, vec3(0.45,0.0,0.02), clamp(damage*0.55 + lowHp*0.3*pulse, 0.0, 0.8)*smoothstep(0.25,0.9,d));
      col += vec3(0.9,0.55,0.2)*heal*0.25*smoothstep(0.3,0.95,d);
      float g = fract(sin(dot(floor(uv*res) + fract(time*7.13)*vec2(91.7,47.3), vec2(12.9898,78.233)))*43758.5453);
      col += (g-0.5)*0.04;
      col *= 1.0 - fade;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(grade);

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth, innerHeight);
  grade.uniforms.res.value.set(innerWidth * PR, innerHeight * PR);
}
addEventListener('resize', onResize);

// ---------------- audio (procedural) ----------------
const Audio = (() => {
  let ctx = null, master, noiseBuf;
  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // ambient drone
    const dg = ctx.createGain(); dg.gain.value = 0.0; dg.connect(master);
    dg.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.connect(dg);
    [55, 55.4, 82.4, 41.2].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = i === 2 ? 0.25 : 0.35; o.connect(g); g.connect(lp); o.start();
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
    const lg = ctx.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    // wind
    const wn = ctx.createBufferSource(); wn.buffer = noiseBuf; wn.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.7;
    const wg = ctx.createGain(); wg.gain.value = 0.07;
    wn.connect(bp); bp.connect(wg); wg.connect(master); wn.start();
    const wl = ctx.createOscillator(); wl.frequency.value = 0.09;
    const wlg = ctx.createGain(); wlg.gain.value = 300; wl.connect(wlg); wlg.connect(bp.frequency); wl.start();
  }
  function noise(dur, f0, f1, q, vol, type = 'bandpass', delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  function tone(dur, f0, f1, vol, type = 'sine', delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  return {
    init,
    swing: () => noise(0.22, 2400, 500, 1.2, 0.35),
    heavy: () => { noise(0.35, 1600, 200, 1, 0.45); tone(0.3, 120, 50, 0.25, 'sine'); },
    hit: () => { noise(0.12, 900, 200, 0.8, 0.5, 'lowpass'); tone(0.15, 160, 60, 0.4, 'triangle'); },
    hurt: () => { tone(0.35, 110, 40, 0.5, 'sawtooth'); noise(0.25, 600, 100, 0.5, 0.5, 'lowpass'); },
    dodge: () => noise(0.3, 400, 1500, 0.6, 0.2),
    death: () => { tone(0.8, 300, 60, 0.18, 'sawtooth'); noise(0.6, 3000, 300, 2, 0.12); },
    soul: () => tone(0.25, 880 + Math.random() * 300, 1500, 0.06, 'sine'),
    spell: () => { noise(0.6, 300, 3000, 1.5, 0.3); tone(0.5, 220, 660, 0.12, 'triangle'); },
    boom: () => { noise(0.8, 800, 40, 0.5, 0.7, 'lowpass'); tone(0.6, 90, 30, 0.5); },
    cast: () => tone(0.6, 180, 90, 0.12, 'square'),
    drink: () => { tone(0.15, 500, 700, 0.1); tone(0.15, 600, 800, 0.1, 'sine', 0.18); tone(0.6, 400, 900, 0.08, 'sine', 0.36); },
    bell: () => { [1, 2.76, 5.4].forEach((m, i) => tone(3.5 - i, 98 * m, 97 * m, 0.22 / (i + 1), 'sine')); },
    thunder: () => noise(3.0, 300, 30, 0.4, 0.5, 'lowpass', 0.3),
    rise: () => noise(0.9, 120, 400, 0.6, 0.25, 'lowpass'),
    click: () => tone(0.08, 600, 400, 0.08, 'triangle'),
  };
})();

// ---------------- particles ----------------
class Particles {
  constructor(max, blending = THREE.AdditiveBlending) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    this.s0 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; uniform float scale;
        varying vec3 vC; varying float vA;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
          gl_PointSize = alpha > 0.0 ? size*scale*projectionMatrix[1][1]/-mv.z : 0.0; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-0.5)*2.0;
          float a = smoothstep(1.0,0.0,d); a*=a; gl_FragColor = vec4(vC*a*vA, a*vA); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, c0, c1, size, life, grav = 0, drag = 0) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.c0[i * 3] = c0[0]; this.c0[i * 3 + 1] = c0[1]; this.c0[i * 3 + 2] = c0[2];
    this.c1[i * 3] = c1[0]; this.c1[i * 3 + 1] = c1[1]; this.c1[i * 3 + 2] = c1[2];
    this.s0[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.drag[i] = drag;
  }
  burst(p, n, speed, c0, c1, size, life, grav = 0, up = 0.5, drag = 2) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI * 0.6;
      const s = speed * rand(0.3, 1);
      this.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + up * speed, Math.sin(a) * Math.cos(e) * s,
        c0, c1, size * rand(0.6, 1.3), life * rand(0.6, 1.2), grav, drag);
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt; this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      for (let k = 0; k < 3; k++) this.col[i * 3 + k] = lerp(this.c0[i * 3 + k], this.c1[i * 3 + k], t);
      this.size[i] = this.s0[i] * (1 - t * 0.6);
      this.alpha[i] = Math.min(1, (1 - t) * 1.6) * Math.min(1, t * 12 + 0.2);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
    this.mat.uniforms.scale.value = pointScale;
  }
}
let pointScale = innerHeight * PR * 0.5;
const fx = new Particles(5000);
const smoke = new Particles(800, THREE.NormalBlending);

const COL = {
  fireA: [2.2, 0.85, 0.22], fireB: [0.9, 0.08, 0.02],
  soulA: [1.4, 0.8, 3.0], soulB: [0.3, 0.05, 0.6],
  blood: [1.2, 0.05, 0.05], bloodB: [0.25, 0.0, 0.0],
  spark: [5, 3.5, 2], sparkB: [1.5, 0.3, 0.05],
  spirit: [0.4, 2.5, 2.2], spiritB: [0.05, 0.3, 0.4],
  dirt: [0.12, 0.09, 0.08], dirtB: [0.05, 0.04, 0.04],
  red: [4, 0.4, 0.2], redB: [0.8, 0.0, 0.0],
  gold: [3, 2.2, 0.8], goldB: [0.8, 0.3, 0.05],
};

// ---------------- characters ----------------
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

function mkMat(o) { return new THREE.MeshStandardMaterial(o); }
function part(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function tatteredCone(rTop, rBot, h, seg, thetaStart = 0, thetaLen = Math.PI * 2, tatter = 0.25) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 6, true, thetaStart, thetaLen);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = (h / 2 - y) / h; // 0 top .. 1 bottom
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const n = Math.sin(a * 9.0) * 0.5 + Math.sin(a * 23.0 + 1.3) * 0.5;
    if (t > 0.98) p.setY(i, y + (n * 0.5 + 0.5) * h * tatter);
    const w = 1 + Math.sin(a * 5 + y * 3) * 0.06 * t;
    p.setX(i, p.getX(i) * w); p.setZ(i, p.getZ(i) * w);
  }
  g.computeVertexNormals();
  return g;
}

function buildKnight() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const iron = mkMat({ color: 0x4a4a54, metalness: 0.9, roughness: 0.36 });
  const darkIron = mkMat({ color: 0x1e1d24, metalness: 0.85, roughness: 0.5 });
  const gold = mkMat({ color: 0x8a6a30, metalness: 1, roughness: 0.35 });
  const cloth = mkMat({ color: 0x3a0c12, roughness: 0.95, side: THREE.DoubleSide });
  const leather = mkMat({ color: 0x2a1c14, roughness: 0.9 });

  const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
  // legs
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(sx * 0.15, 0, 0); hips.add(leg);
    part(new THREE.CylinderGeometry(0.1, 0.085, 0.48, 8), darkIron, leg, 0, -0.24, 0);
    const knee = new THREE.Group(); knee.position.y = -0.48; leg.add(knee);
    part(new THREE.SphereGeometry(0.085, 8, 6), iron, knee);
    part(new THREE.CylinderGeometry(0.085, 0.075, 0.42, 8), iron, knee, 0, -0.22, 0);
    part(new THREE.BoxGeometry(0.15, 0.1, 0.26), darkIron, knee, 0, -0.43, 0.04);
    legs.push({ leg, knee });
  }
  // skirt / tassets
  part(tatteredCone(0.26, 0.36, 0.42, 14, 0, Math.PI * 2, 0.3), cloth, hips, 0, -0.12, 0);
  // torso
  const torso = new THREE.Group(); torso.position.y = 0.04; hips.add(torso);
  const chest = part(new THREE.CylinderGeometry(0.3, 0.22, 0.62, 12), iron, torso, 0, 0.32, 0);
  chest.scale.z = 0.72;
  part(new THREE.TorusGeometry(0.235, 0.035, 6, 16), leather, torso, 0, 0.03, 0).rotation.x = Math.PI / 2;
  const plate = part(new THREE.BoxGeometry(0.06, 0.4, 0.04), gold, torso, 0, 0.36, 0.22);
  plate.rotation.x = -0.12;
  // cloak (back)
  const cloakPivot = new THREE.Group(); cloakPivot.position.set(0, 0.6, -0.12); torso.add(cloakPivot);
  const cloak = part(tatteredCone(0.3, 0.62, 1.25, 20, Math.PI * 0.08 + Math.PI, Math.PI * 0.84, 0.18), cloth, cloakPivot, 0, -0.6, 0);
  cloak.rotation.y = 0;
  // pauldrons
  for (const sx of [-1, 1]) {
    const p = part(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), iron, torso, sx * 0.33, 0.6, 0);
    p.scale.set(1.15, 1, 1);
    part(new THREE.ConeGeometry(0.035, 0.18, 5), gold, torso, sx * 0.36, 0.76, 0).rotation.z = -sx * 0.4;
  }
  // head
  const head = new THREE.Group(); head.position.y = 0.78; torso.add(head);
  part(new THREE.CylinderGeometry(0.14, 0.16, 0.3, 12), iron, head, 0, 0.08, 0);
  part(new THREE.SphereGeometry(0.142, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), iron, head, 0, 0.22, 0);
  const visor = part(new THREE.BoxGeometry(0.2, 0.025, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.4, 0.4) }), head, 0, 0.13, 0.15);
  visor.castShadow = false;
  part(new THREE.BoxGeometry(0.02, 0.18, 0.04), gold, head, 0, 0.18, 0.152);
  const crest = part(new THREE.BoxGeometry(0.03, 0.12, 0.3), cloth, head, 0, 0.36, -0.02);
  // hood over helm
  const hood = part(new THREE.SphereGeometry(0.2, 14, 10, Math.PI * 0.25, Math.PI * 1.5, 0, Math.PI * 0.62), cloth, head, 0, 0.12, -0.02);
  hood.rotation.y = Math.PI;
  crest.visible = false;

  // right arm (sword) — character's right is -x
  function arm(sx) {
    const sh = new THREE.Group(); sh.position.set(sx * 0.36, 0.55, 0); sh.rotation.order = 'YXZ'; torso.add(sh);
    part(new THREE.CylinderGeometry(0.075, 0.065, 0.34, 8), darkIron, sh, 0, -0.17, 0);
    const el = new THREE.Group(); el.position.y = -0.34; sh.add(el);
    part(new THREE.CylinderGeometry(0.07, 0.06, 0.3, 8), iron, el, 0, -0.15, 0);
    part(new THREE.CylinderGeometry(0.085, 0.075, 0.12, 8), darkIron, el, 0, -0.22, 0);
    const hand = new THREE.Group(); hand.position.y = -0.32; el.add(hand);
    part(new THREE.BoxGeometry(0.09, 0.1, 0.1), leather, hand);
    return { sh, el, hand };
  }
  const R = arm(-1), L = arm(1);
  // sword
  const sword = new THREE.Group(); R.hand.add(sword);
  part(new THREE.CylinderGeometry(0.022, 0.022, 0.22, 6), leather, sword, 0, 0.02, 0);
  part(new THREE.SphereGeometry(0.04, 8, 6), gold, sword, 0, 0.15, 0);
  part(new THREE.BoxGeometry(0.34, 0.04, 0.05), gold, sword, 0, -0.1, 0);
  const bladeGeo = new THREE.BoxGeometry(0.075, 1.15, 0.016, 1, 6, 1);
  { const p = bladeGeo.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.35) p.setX(i, p.getX(i) * (1 - (y - 0.35) / 0.25 * 0.92)); }
    bladeGeo.computeVertexNormals(); }
  bladeGeo.rotateZ(Math.PI); bladeGeo.translate(0, -0.69, 0);
  const bladeMat = mkMat({ color: 0x9aa0b4, metalness: 1, roughness: 0.22, emissive: 0x6a2a10, emissiveIntensity: 0.0 });
  part(bladeGeo, bladeMat, sword);
  const runeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.0, 0.3) });
  const runeLine = part(new THREE.BoxGeometry(0.012, 0.8, 0.02), runeMat, sword, 0, -0.55, 0);
  runeLine.castShadow = false;
  const tipMarker = new THREE.Object3D(); tipMarker.position.y = -1.25; sword.add(tipMarker);
  const baseMarker = new THREE.Object3D(); baseMarker.position.y = -0.2; sword.add(baseMarker);
  // lantern in left hand
  const lantern = new THREE.Group(); lantern.position.y = -0.1; L.hand.add(lantern);
  part(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 4), darkIron, lantern, 0, -0.04, 0);
  const cage = new THREE.Group(); cage.position.y = -0.2; lantern.add(cage);
  part(new THREE.CylinderGeometry(0.05, 0.08, 0.05, 6), darkIron, cage, 0, 0.1, 0);
  part(new THREE.CylinderGeometry(0.08, 0.06, 0.04, 6), darkIron, cage, 0, -0.1, 0);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; part(new THREE.BoxGeometry(0.012, 0.18, 0.012), darkIron, cage, Math.cos(a) * 0.065, 0, Math.sin(a) * 0.065); }
  const flame = part(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.2, 0.6) }), cage, 0, 0, 0);
  flame.castShadow = false;
  const lanternLight = new THREE.PointLight(0xffa04a, 1.1, 9, 1.6);
  cage.add(lanternLight);

  root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return { root, body, hips, torso, head, legs, R, L, sword, bladeMat, runeMat, tipMarker, baseMarker, cloakPivot, flame, lanternLight, cage };
}

// --- enemies ---
function boneMat(c = 0x9c9080) { return mkMat({ color: c, roughness: 0.75, emissive: 0x000000 }); }
function eyeMat(c) { return new THREE.MeshBasicMaterial({ color: c.clone() }); }

function buildHusk(scale = 1, opts = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const bone = boneMat(opts.bone ?? 0x8f8676);
  const rag = mkMat({ color: opts.rag ?? 0x1f1a1a, roughness: 1, side: THREE.DoubleSide });
  const eyeC = opts.eye ?? new THREE.Color(4, 0.5, 0.2);
  const eye = eyeMat(eyeC);
  const hips = new THREE.Group(); hips.position.y = 0.9; body.add(hips);
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.x = sx * 0.13; hips.add(leg);
    part(new THREE.CylinderGeometry(0.04, 0.035, 0.46, 5), bone, leg, 0, -0.23, 0);
    const knee = new THREE.Group(); knee.position.y = -0.46; leg.add(knee);
    part(new THREE.CylinderGeometry(0.035, 0.03, 0.42, 5), bone, knee, 0, -0.21, 0);
    part(new THREE.BoxGeometry(0.08, 0.04, 0.16), bone, knee, 0, -0.43, 0.04);
    legs.push({ leg, knee });
  }
  part(new THREE.TorusGeometry(0.13, 0.04, 5, 10), bone, hips, 0, 0, 0).rotation.x = Math.PI / 2;
  const torso = new THREE.Group(); torso.position.y = 0.05; torso.rotation.x = 0.35; hips.add(torso);
  part(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 5), bone, torso, 0, 0.3, -0.06);
  for (let i = 0; i < 5; i++) { // ribs
    const r = part(new THREE.TorusGeometry(0.15 - i * 0.008, 0.016, 4, 12, Math.PI * 1.5), bone, torso, 0, 0.18 + i * 0.075, 0.0);
    r.rotation.set(Math.PI / 2, 0, Math.PI * 0.25 + Math.PI);
    r.scale.set(1, 0.8, 1);
  }
  part(tatteredCone(0.18, 0.32, 0.55, 12, 0, Math.PI * 2, 0.5), rag, torso, 0, 0.42, 0);
  const head = new THREE.Group(); head.position.set(0, 0.7, 0.05); torso.add(head);
  const skull = part(new THREE.SphereGeometry(0.13, 10, 8), bone, head, 0, 0.06, 0);
  skull.scale.set(0.9, 1.05, 1.05);
  part(new THREE.BoxGeometry(0.14, 0.06, 0.12), bone, head, 0, -0.06, 0.04);
  for (const sx of [-1, 1]) { const e = part(new THREE.SphereGeometry(0.028, 6, 4), eye, head, sx * 0.048, 0.07, 0.11); e.castShadow = false; }
  if (opts.crown) {
    const crownM = mkMat({ color: 0x6a5020, metalness: 1, roughness: 0.4 });
    part(new THREE.CylinderGeometry(0.15, 0.14, 0.06, 10, 1, true), crownM, head, 0, 0.16, 0);
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; part(new THREE.ConeGeometry(0.025, 0.16, 4), crownM, head, Math.cos(a) * 0.14, 0.26, Math.sin(a) * 0.14); }
  }
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * 0.2, 0.55, 0); sh.rotation.order = 'YXZ'; torso.add(sh);
    part(new THREE.CylinderGeometry(0.035, 0.03, 0.42, 5), bone, sh, 0, -0.21, 0);
    const el = new THREE.Group(); el.position.y = -0.42; sh.add(el);
    part(new THREE.CylinderGeometry(0.03, 0.025, 0.42, 5), bone, el, 0, -0.21, 0);
    for (let k = 0; k < 3; k++) { const c = part(new THREE.ConeGeometry(0.015, 0.16, 4), bone, el, (k - 1) * 0.03, -0.5, 0.02); c.rotation.x = Math.PI; }
    arms.push({ sh, el });
  }
  let weapon = null;
  if (opts.greatsword) {
    weapon = new THREE.Group(); arms[0].el.add(weapon); weapon.position.y = -0.45;
    const gm = mkMat({ color: 0x3a3434, metalness: 0.9, roughness: 0.55 });
    part(new THREE.BoxGeometry(0.16, 1.9, 0.04), gm, weapon, 0, -0.95, 0);
    part(new THREE.BoxGeometry(0.5, 0.08, 0.08), gm, weapon, 0, 0, 0);
    const edge = part(new THREE.BoxGeometry(0.02, 1.7, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.1) }), weapon, 0, -1.0, 0);
    edge.castShadow = false;
  }
  root.scale.setScalar(scale);
  return { root, body, hips, torso, head, legs, arms, weapon, eye, eyeBase: eyeC.clone() };
}

function buildWraith() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const shroud = mkMat({ color: 0x0a1418, emissive: 0x0c4a4a, emissiveIntensity: 0.6, roughness: 0.9, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
  const eyeC = new THREE.Color(0.6, 4, 3.5);
  const eye = eyeMat(eyeC);
  const robe = part(tatteredCone(0.16, 0.5, 1.5, 18, 0, Math.PI * 2, 0.45), shroud, body, 0, 0.85, 0);
  const torso = new THREE.Group(); torso.position.y = 1.4; body.add(torso);
  const hood = part(new THREE.SphereGeometry(0.24, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.7), shroud, torso, 0, 0.22, -0.02);
  hood.scale.set(1, 1.25, 1.1);
  part(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshBasicMaterial({ color: 0x000000 }), torso, 0, 0.16, 0.06);
  const head = new THREE.Group(); head.position.y = 0.16; torso.add(head);
  for (const sx of [-1, 1]) { const e = part(new THREE.SphereGeometry(0.03, 6, 4), eye, head, sx * 0.06, 0.02, 0.2); e.castShadow = false; }
  const arms = [];
  const claw = boneMat(0x6a7a78);
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * 0.22, 0.05, 0); sh.rotation.order = 'YXZ'; torso.add(sh);
    part(tatteredCone(0.06, 0.13, 0.55, 8, 0, Math.PI * 2, 0.4), shroud, sh, 0, -0.27, 0);
    const el = new THREE.Group(); el.position.y = -0.55; sh.add(el);
    for (let k = 0; k < 4; k++) { const c = part(new THREE.ConeGeometry(0.014, 0.3, 4), claw, el, (k - 1.5) * 0.03, -0.12, 0.02); c.rotation.x = Math.PI + 0.3; }
    arms.push({ sh, el });
  }
  return { root, body, torso, head, arms, legs: [], eye, eyeBase: eyeC.clone(), robe };
}

function buildCaster() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const robeM = mkMat({ color: 0x24121a, roughness: 1, side: THREE.DoubleSide });
  const bone = boneMat(0xb0a690);
  const eyeC = new THREE.Color(4, 0.4, 1.5);
  const eye = eyeMat(eyeC);
  part(tatteredCone(0.2, 0.55, 1.6, 18, 0, Math.PI * 2, 0.25), robeM, body, 0, 0.8, 0);
  const torso = new THREE.Group(); torso.position.y = 1.55; body.add(torso);
  part(new THREE.CylinderGeometry(0.26, 0.2, 0.3, 10), robeM, torso, 0, 0, 0);
  const head = new THREE.Group(); head.position.y = 0.3; torso.add(head);
  const skull = part(new THREE.SphereGeometry(0.13, 10, 8), bone, head, 0, 0.04, 0); skull.scale.set(0.85, 1.15, 1);
  for (const sx of [-1, 1]) { const e = part(new THREE.SphereGeometry(0.026, 6, 4), eye, head, sx * 0.045, 0.06, 0.11); e.castShadow = false; }
  for (let i = 0; i < 5; i++) { // antler crown
    const a = (i / 4 - 0.5) * 1.6;
    const s = part(new THREE.ConeGeometry(0.018, 0.32, 4), bone, head, Math.sin(a) * 0.1, 0.25, -0.03);
    s.rotation.z = -a * 0.6;
  }
  part(new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), robeM, head, 0, 0.0, -0.03).scale.set(1, 1.2, 1.1);
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * 0.27, 0.05, 0); sh.rotation.order = 'YXZ'; torso.add(sh);
    part(tatteredCone(0.06, 0.12, 0.5, 8, 0, Math.PI * 2, 0.3), robeM, sh, 0, -0.25, 0);
    const el = new THREE.Group(); el.position.y = -0.5; sh.add(el);
    part(new THREE.SphereGeometry(0.04, 6, 4), bone, el);
    arms.push({ sh, el });
  }
  // staff in right hand (-x)
  const staff = new THREE.Group(); arms[0].el.add(staff);
  part(new THREE.CylinderGeometry(0.025, 0.03, 2.1, 6), mkMat({ color: 0x2a1a10, roughness: 1 }), staff, 0, 0.35, 0);
  const orbM = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.5, 1.2) });
  const orb = part(new THREE.IcosahedronGeometry(0.09, 0), orbM, staff, 0, 1.45, 0); orb.castShadow = false;
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const p = part(new THREE.ConeGeometry(0.015, 0.25, 4), bone, staff, Math.cos(a) * 0.08, 1.4, Math.sin(a) * 0.08); p.rotation.z = Math.cos(a) * -0.4; p.rotation.x = Math.sin(a) * 0.4; }
  return { root, body, torso, head, arms, legs: [], eye, eyeBase: eyeC.clone(), staff, orb, orbM };
}

const DEFS = {
  husk:   { hp: 46, speed: 2.5, radius: 0.5, dmg: 15, range: 1.7, windup: 0.55, strike: 0.25, recover: 0.6, cd: 1.0, souls: 3, poise: 20, build: () => buildHusk() },
  brute:  { hp: 110, speed: 2.0, radius: 0.75, dmg: 26, range: 2.4, windup: 0.85, strike: 0.3, recover: 0.8, cd: 1.6, souls: 8, poise: 55, build: () => buildHusk(1.45, { bone: 0x6e6658, rag: 0x2a1010, eye: new THREE.Color(4, 1.4, 0.1) }) },
  wraith: { hp: 30, speed: 4.6, radius: 0.45, dmg: 13, range: 4.2, windup: 0.5, strike: 0.3, recover: 0.7, cd: 1.6, souls: 4, poise: 12, flying: true, build: () => buildWraith() },
  caster: { hp: 38, speed: 2.3, radius: 0.5, dmg: 14, range: 15, windup: 0.9, strike: 0.2, recover: 0.6, cd: 2.4, souls: 6, poise: 18, build: () => buildCaster() },
  king:   { hp: 1100, speed: 2.6, radius: 1.3, dmg: 32, range: 4.6, windup: 0.8, strike: 0.35, recover: 0.75, cd: 1.0, souls: 120, poise: 9999, boss: true,
            build: () => buildHusk(2.7, { bone: 0x5a5248, rag: 0x2a0808, eye: new THREE.Color(5, 0.8, 0.1), crown: true, greatsword: true }) },
};

// ---------------- game state ----------------
const S = {
  mode: 'title', // title | play | pause | choose | dead
  time: 0, wave: 0, souls: 0, kills: 0,
  hitstop: 0, shake: 0, damageFx: 0, healFx: 0, fade: 0,
  spawnQueue: [], spawnTimer: 0, betweenTimer: 0, waveActive: false,
  best: (() => { try { return +(localStorage.getItem('ashen-best') || 0); } catch { return 0; } })(),
};
const P = {
  pos: new THREE.Vector3(0, 0, 9), vel: new THREE.Vector3(), face: Math.PI, speed: 5.0,
  maxHp: 100, hp: 100, maxSt: 100, st: 100, stRegen: 34, focus: 40, maxFocus: 100,
  flasks: 3, maxFlasks: 3, dmgMul: 1, crit: 0.05, lifesteal: 0, spellMul: 1, spellCost: 35, dodgeMul: 1,
  state: 'idle', t: 0, combo: 0, queued: false, hitSet: new Set(), invuln: 0, stDelay: 0,
  walkPhase: 0, sprint: false, dodgeDir: new THREE.Vector3(), lastHurt: 0, swingDir: 1,
};
const knight = buildKnight();
scene.add(knight.root);

const enemies = [];
const projectiles = [];
const soulOrbs = [];
const decals = [];

// shared geometries
const orbGeo = new THREE.SphereGeometry(0.2, 12, 8);
const smallOrbGeo = new THREE.SphereGeometry(0.07, 8, 6);
const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
const discGeo = new THREE.CircleGeometry(1, 48);

// blade trail
const TRAIL_N = 18;
const trail = { base: [], tip: [], alive: 0 };
const trailGeo = new THREE.BufferGeometry();
const trailPos = new Float32Array(TRAIL_N * 2 * 3), trailA = new Float32Array(TRAIL_N * 2);
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
trailGeo.setAttribute('a', new THREE.BufferAttribute(trailA, 1).setUsage(THREE.DynamicDrawUsage));
{ const idx = []; for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } trailGeo.setIndex(idx); }
const trailMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { col: { value: new THREE.Color(3.2, 1.2, 0.35) } },
  vertexShader: `attribute float a; varying float vA; void main(){ vA = a; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 col; varying float vA; void main(){ gl_FragColor = vec4(col*vA, vA); }`,
});
const trailMesh = new THREE.Mesh(trailGeo, trailMat);
trailMesh.frustumCulled = false;
scene.add(trailMesh);

// ---------------- input ----------------
const keys = {};
const mouse = { locked: false, down: false, dragging: false, sx: 0, sy: 0 };
let camYaw = Math.PI * 0.0, camPitch = 0.38, camDist = 7.0;
const touch = { mx: 0, my: 0, active: false };

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (S.mode === 'play') {
    if (e.code === 'Space') { e.preventDefault(); tryDodge(); }
    if (e.code === 'KeyQ') tryCast();
    if (e.code === 'KeyE' || e.code === 'KeyR') tryDrink();
    if (e.code === 'KeyF' || e.code === 'KeyJ') tryAttack();
    if (e.code === 'Escape' || e.code === 'KeyP') pause(true);
  } else if (S.mode === 'pause' && (e.code === 'Escape' || e.code === 'KeyP')) {
    pause(false);
  } else if (S.mode === 'title' && (e.code === 'Enter' || e.code === 'Space')) startGame();
  else if (S.mode === 'choose' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
    const b = document.querySelectorAll('.card')[+e.code.slice(-1) - 1]; b && b.click();
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
canvasEl.addEventListener('mousedown', (e) => {
  if (S.mode !== 'play' || IS_TOUCH) return;
  if (!mouse.locked) {
    canvasEl.requestPointerLock?.()?.catch?.(() => {});
    mouse.down = true; mouse.dragging = false; mouse.sx = e.clientX; mouse.sy = e.clientY;
    if (e.button === 2) tryCast();
    return;
  }
  if (e.button === 0) tryAttack();
  if (e.button === 2) tryCast();
});
addEventListener('mouseup', (e) => {
  if (!mouse.locked && mouse.down && !mouse.dragging && e.button === 0 && S.mode === 'play') tryAttack();
  mouse.down = false;
});
addEventListener('mousemove', (e) => {
  if (mouse.locked) { camYaw -= e.movementX * 0.0024; camPitch = clamp(camPitch + e.movementY * 0.0018, 0.05, 1.05); }
  else if (mouse.down && S.mode === 'play') {
    if (Math.hypot(e.clientX - mouse.sx, e.clientY - mouse.sy) > 6) mouse.dragging = true;
    if (mouse.dragging) { camYaw -= e.movementX * 0.005; camPitch = clamp(camPitch + e.movementY * 0.003, 0.05, 1.05); }
  }
});
addEventListener('wheel', (e) => { camDist = clamp(camDist + Math.sign(e.deltaY) * 0.6, 4, 11); }, { passive: true });
document.addEventListener('pointerlockchange', () => {
  mouse.locked = document.pointerLockElement === canvasEl;
});

// touch controls
if (IS_TOUCH) {
  document.body.classList.add('touch');
  const stick = $('stick'), knob = $('knob');
  let stickId = null, camId = null, sc = { x: 0, y: 0 }, lastCam = { x: 0, y: 0 };
  canvasEl.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && stickId === null) {
        stickId = t.identifier; sc = { x: t.clientX, y: t.clientY };
        stick.style.display = 'block'; stick.style.left = sc.x - 60 + 'px'; stick.style.top = sc.y - 60 + 'px';
        knob.style.transform = 'translate(0px,0px)';
      } else if (camId === null) { camId = t.identifier; lastCam = { x: t.clientX, y: t.clientY }; }
    }
    e.preventDefault();
  }, { passive: false });
  canvasEl.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        let dx = t.clientX - sc.x, dy = t.clientY - sc.y;
        const l = Math.hypot(dx, dy), m = 50;
        if (l > m) { dx *= m / l; dy *= m / l; }
        touch.mx = dx / m; touch.my = dy / m; touch.active = true;
        knob.style.transform = `translate(${dx}px,${dy}px)`;
      } else if (t.identifier === camId) {
        camYaw -= (t.clientX - lastCam.x) * 0.006;
        camPitch = clamp(camPitch + (t.clientY - lastCam.y) * 0.004, 0.05, 1.05);
        lastCam = { x: t.clientX, y: t.clientY };
      }
    }
    e.preventDefault();
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = null; touch.mx = touch.my = 0; touch.active = false; stick.style.display = 'none'; }
      if (t.identifier === camId) camId = null;
    }
  };
  canvasEl.addEventListener('touchend', end); canvasEl.addEventListener('touchcancel', end);
  const bind = (id, fn) => $(id).addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); if (S.mode === 'play') fn(); }, { passive: false });
  bind('bAtk', () => tryAttack());
  bind('bDodge', () => tryDodge());
  bind('bSpell', () => tryCast());
  bind('bFlask', () => tryDrink());
  $('bPause').addEventListener('touchstart', (e) => { e.preventDefault(); if (S.mode === 'play') pause(true); }, { passive: false });
}

function moveInput() {
  let f = 0, r = 0;
  if (keys.KeyW || keys.ArrowUp) f += 1;
  if (keys.KeyS || keys.ArrowDown) f -= 1;
  if (keys.KeyD || keys.ArrowRight) r += 1;
  if (keys.KeyA || keys.ArrowLeft) r -= 1;
  if (touch.active) { f = -touch.my; r = touch.mx; }
  const fw = tmpV.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
  const rt = tmpV2.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
  const v = new THREE.Vector3().addScaledVector(fw, f).addScaledVector(rt, r);
  const l = v.length();
  if (l > 1) v.divideScalar(l);
  return v;
}

// ---------------- player actions ----------------
function canAct() { return S.mode === 'play' && P.hp > 0; }
function nearestEnemy(maxDist, maxAng = Math.PI) {
  let best = null, bd = maxDist;
  for (const e of enemies) {
    if (e.state === 'dying' || e.state === 'rising') continue;
    const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) - e.radius;
    if (d > bd) continue;
    const a = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    if (Math.abs(angDiff(P.face, a)) > maxAng) continue;
    bd = d; best = e;
  }
  return best;
}
function tryAttack() {
  if (!canAct()) return;
  if (P.state === 'attack') { if (P.t > 0.16) P.queued = true; return; }
  if (P.state !== 'idle' && P.state !== 'run') return;
  if (P.st < 8) return;
  startSwing(0);
}
function startSwing(combo) {
  const heavy = combo === 2;
  const cost = heavy ? 26 : 17;
  P.st -= cost; P.stDelay = 0.6;
  P.state = 'attack'; P.t = 0; P.combo = combo; P.queued = false; P.hitSet.clear();
  P.swingDir = combo === 1 ? -1 : 1;
  // soft lock: turn toward nearest enemy in front
  const mv = moveInput();
  if (mv.lengthSq() > 0.01) P.face = Math.atan2(mv.x, mv.z);
  const tgt = nearestEnemy(5.5, 1.7);
  if (tgt) P.face = Math.atan2(tgt.pos.x - P.pos.x, tgt.pos.z - P.pos.z);
  trail.base.length = trail.tip.length = 0;
  heavy ? Audio.heavy() : setTimeout(Audio.swing, 90);
}
function tryDodge() {
  if (!canAct()) return;
  const cost = 22 * P.dodgeMul;
  if (P.st < 6) return;
  if (!['idle', 'run', 'attack', 'hurt'].includes(P.state)) return;
  if (P.state === 'attack' && P.t < 0.1) return;
  if (P.state === 'hurt' && P.t < 0.18) return;
  P.st -= cost; P.stDelay = 0.7;
  const mv = moveInput();
  if (mv.lengthSq() < 0.01) mv.set(-Math.sin(P.face), 0, -Math.cos(P.face)); // backstep
  else P.face = Math.atan2(mv.x, mv.z);
  P.dodgeDir.copy(mv).normalize();
  P.state = 'dodge'; P.t = 0;
  Audio.dodge();
  for (let i = 0; i < 12; i++) smoke.emit(P.pos.x + rand(-0.3, 0.3), P.pos.y + 0.1, P.pos.z + rand(-0.3, 0.3), rand(-1, 1), rand(0.2, 0.8), rand(-1, 1), [0.08, 0.07, 0.07], [0.03, 0.03, 0.03], rand(0.4, 0.8), rand(0.6, 1.0), -0.3, 2);
}
function tryCast() {
  if (!canAct()) return;
  if (!['idle', 'run'].includes(P.state)) return;
  if (P.focus < P.spellCost) { flashHud('focusBar'); return; }
  P.focus -= P.spellCost;
  P.state = 'cast'; P.t = 0; P.castFired = false;
  const tgt = nearestEnemy(25, 1.4);
  if (tgt) P.face = Math.atan2(tgt.pos.x - P.pos.x, tgt.pos.z - P.pos.z);
  else P.face = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw));
}
function tryDrink() {
  if (!canAct()) return;
  if (!['idle', 'run'].includes(P.state)) return;
  if (P.flasks <= 0) { flashHud('flask'); return; }
  if (P.hp >= P.maxHp) return;
  P.flasks--; P.state = 'drink'; P.t = 0; P.healed = false;
  Audio.drink();
}

function damagePlayer(dmg, from) {
  if (P.invuln > 0 || P.hp <= 0 || P.state === 'dead') return false;
  if (P.state === 'dodge' && P.t > 0.03 && P.t < 0.36 * (P.dodgeMul < 1 ? 1.25 : 1)) return false;
  P.hp -= dmg;
  P.lastHurt = S.time;
  P.invuln = 0.55;
  S.damageFx = 1; S.shake = Math.max(S.shake, 0.35); S.hitstop = 0.06;
  Audio.hurt();
  const c = tmpV.copy(P.pos); c.y += 1.2;
  fx.burst(c, 22, 5, COL.blood, COL.bloodB, 0.12, 0.6, 9, 0.3, 1);
  if (from) {
    const d = new THREE.Vector3(P.pos.x - from.x, 0, P.pos.z - from.z).normalize();
    P.vel.addScaledVector(d, 7);
  }
  if (P.hp <= 0) { P.hp = 0; die(); return true; }
  if (P.state !== 'drink' || true) { P.state = 'hurt'; P.t = 0; }
  return true;
}

// ---------------- enemies ----------------
let enemyMul = 1;
function spawnEnemy(type, x, z) {
  const def = DEFS[type];
  const e = Object.assign({}, def);
  e.type = type;
  const m = def.build();
  e.parts = m;
  e.mesh = m.root;
  e.hp = e.maxHp = def.hp * (def.boss ? 1 + (S.wave / 5 - 1) * 0.6 : enemyMul);
  e.dmg = def.dmg * (def.boss ? 1 : Math.min(2, 0.85 + S.wave * 0.06));
  e.pos = new THREE.Vector3(x, heightAt(x, z), z);
  e.vel = new THREE.Vector3();
  e.face = Math.atan2(P.pos.x - x, P.pos.z - z);
  e.state = 'rising'; e.t = 0; e.atkCd = rand(0.5, 1.5); e.flash = 0; e.poiseDmg = 0; e.walk = Math.random() * 10;
  e.mats = [];
  e.mesh.traverse((o) => { if (o.isMesh && o.material.isMeshStandardMaterial) { e.mats.push(o.material); o.material.userData.baseEm = o.material.emissive.clone(); o.material.userData.baseEI = o.material.emissiveIntensity; } });
  e.mesh.position.copy(e.pos);
  e.mesh.position.y -= def.flying ? 0 : 2.2;
  e.mesh.rotation.y = e.face;
  scene.add(e.mesh);
  enemies.push(e);
  if (def.boss) {
    e.attackKind = null; e.summoned = 0;
    $('bossBar').classList.add('show');
    showBanner('המלך החלול', 'שליט העצמות קם מקברו', 3.2, 'boss');
    Audio.bell();
    S.shake = 0.8;
  }
  // spawn decal
  const dm = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: def.flying ? new THREE.Color(0.2, 1.4, 1.3) : new THREE.Color(1.6, 0.15, 0.05), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  dm.rotation.x = -Math.PI / 2; dm.position.set(x, e.pos.y + 0.04, z); dm.scale.setScalar(def.radius * 2.2);
  scene.add(dm);
  decals.push({ mesh: dm, t: 0, life: 1.8 });
  Audio.rise();
  return e;
}
function flashEnemy(e, amt) { e.flash = amt; }
function hitEnemy(e, dmg, from, knock = 4, kind = 'blade') {
  if (e.state === 'dying') return;
  let crit = Math.random() < P.crit;
  if (crit) dmg *= 1.8;
  dmg = Math.round(dmg);
  e.hp -= dmg;
  flashEnemy(e, 1);
  const c = tmpV.copy(e.pos); c.y += e.boss ? 2.5 : 1.1;
  fx.burst(c, crit ? 26 : 14, 6, COL.spark, COL.sparkB, 0.06, 0.35, 6, 0.2, 2);
  fx.burst(c, 8, 3, e.type === 'wraith' ? COL.spirit : COL.blood, e.type === 'wraith' ? COL.spiritB : COL.bloodB, 0.14, 0.5, 7, 0.4, 1);
  dmgNumber(c, dmg, crit);
  if (!e.boss) {
    const d = new THREE.Vector3(e.pos.x - from.x, 0, e.pos.z - from.z).normalize();
    e.vel.addScaledVector(d, knock);
    e.poiseDmg += dmg;
    if (e.poiseDmg >= e.poise && e.state !== 'rising') { e.state = 'stagger'; e.t = 0; e.poiseDmg = 0; }
  }
  if (kind === 'blade') {
    P.focus = Math.min(P.maxFocus, P.focus + 7);
    if (P.lifesteal) P.hp = Math.min(P.maxHp, P.hp + P.lifesteal);
  }
  Audio.hit();
  S.hitstop = Math.max(S.hitstop, crit ? 0.09 : 0.05);
  S.shake = Math.max(S.shake, e.boss ? 0.2 : 0.14);
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.state = 'dying'; e.t = 0;
  S.kills++;
  Audio.death();
  for (const m of e.mats) { m.transparent = true; }
  const c = e.pos.clone(); c.y += e.boss ? 2 : 1;
  fx.burst(c, e.boss ? 160 : 40, e.boss ? 9 : 4, COL.soulA, COL.soulB, 0.16, 1.2, -1.5, 0.6, 1.5);
  const n = e.souls;
  for (let i = 0; i < Math.min(n, 40); i++) spawnSoul(c, Math.ceil(n / Math.min(n, 40)));
  if (e.boss) {
    $('bossBar').classList.remove('show');
    S.shake = 1.2;
    Audio.boom(); Audio.bell();
    showBanner('המלך החלול נפל', 'הכתר מתפורר לאבק', 3, 'victory');
  }
}
function spawnSoul(p, value) {
  const m = new THREE.Mesh(smallOrbGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.0, 4) }));
  m.position.copy(p);
  scene.add(m);
  soulOrbs.push({ mesh: m, vel: new THREE.Vector3(rand(-3, 3), rand(2, 5), rand(-3, 3)), t: 0, value });
}

function enemyAttackHit(e, range, arc, dmg) {
  const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > range + 0.5) return;
  const a = Math.atan2(dx, dz);
  if (Math.abs(angDiff(e.face, a)) > arc) return;
  damagePlayer(dmg, e.pos);
}

function fireProjectile(from, dir, speed, dmg, color, owner = 'enemy', homing = 0, target = null) {
  const m = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color }));
  m.position.copy(from);
  if (owner === 'player') m.scale.setScalar(1.3);
  scene.add(m);
  projectiles.push({ mesh: m, vel: dir.clone().multiplyScalar(speed), speed, dmg, owner, homing, target, life: 4, color: [color.r, color.g, color.b] });
}

function updateEnemy(e, dt) {
  const def = DEFS[e.type];
  const pp = e.parts;
  e.t += dt;
  e.atkCd -= dt;
  const toP = new THREE.Vector3(P.pos.x - e.pos.x, 0, P.pos.z - e.pos.z);
  const dist = toP.length();
  const want = Math.atan2(toP.x, toP.z);
  let move = 0;
  let turn = 6;

  // flash fade
  if (e.flash > 0) {
    e.flash = Math.max(0, e.flash - dt * 6);
    for (const m of e.mats) { m.emissive.setRGB(1, 0.9, 0.85).lerp(m.userData.baseEm, 1 - e.flash); m.emissiveIntensity = lerp(m.userData.baseEI, 2.5, e.flash); }
  }
  const eyeGlow = (k) => pp.eye.color.copy(pp.eyeBase).multiplyScalar(k);

  switch (e.state) {
    case 'rising': {
      const rt = def.flying ? 0.9 : 1.3;
      const k = ease(Math.min(1, e.t / rt));
      if (!def.flying) {
        e.mesh.position.y = e.pos.y - 2.2 * (1 - k);
        if (Math.random() < 0.6) smoke.emit(e.pos.x + rand(-0.5, 0.5), e.pos.y + 0.1, e.pos.z + rand(-0.5, 0.5), rand(-1, 1), rand(1, 2.5), rand(-1, 1), COL.dirt, COL.dirtB, rand(0.2, 0.5), 0.8, 5, 1);
      } else {
        e.mesh.traverse((o) => { if (o.material && o.material.transparent) o.material.opacity = k * 0.88; });
        if (Math.random() < 0.7) fx.emit(e.pos.x + rand(-0.4, 0.4), e.pos.y + rand(0, 1.6), e.pos.z + rand(-0.4, 0.4), 0, rand(0.5, 1.5), 0, COL.spirit, COL.spiritB, 0.12, 0.7, 0, 1);
      }
      eyeGlow(k);
      if (e.t > rt) { e.state = 'chase'; e.t = 0; }
      break;
    }
    case 'chase': {
      if (e.type === 'caster') {
        if (dist > 11) move = 1; else if (dist < 7) move = -0.8; else move = 0.25 * Math.sin(S.time + e.walk);
        if (e.atkCd <= 0 && dist < def.range) { e.state = 'windup'; e.t = 0; Audio.cast(); }
      } else if (e.boss) {
        move = dist > 3.2 ? 1 : 0;
        if (e.hp < e.maxHp * 0.5 && e.summoned === 0) { e.state = 'summon'; e.t = 0; e.summoned = 1; break; }
        if (e.atkCd <= 0) {
          if (dist < def.range) { e.attackKind = Math.random() < 0.65 ? 'sweep' : 'stomp'; e.state = 'windup'; e.t = 0; }
          else if (dist < 16 && Math.random() < 0.025) { e.attackKind = 'leap'; e.state = 'windup'; e.t = 0; e.leapTarget = P.pos.clone(); e.leapFrom = e.pos.clone(); spawnTelegraph(e.leapTarget, 4.2, 1.15); }
        }
      } else {
        move = dist > def.range * 0.8 ? 1 : 0;
        if (e.atkCd <= 0 && dist < def.range) { e.state = 'windup'; e.t = 0; }
      }
      break;
    }
    case 'windup': {
      turn = e.boss ? 2.5 : 4;
      let wu = def.windup;
      if (e.boss && e.attackKind === 'leap') wu = 1.15;
      if (e.boss && e.attackKind === 'stomp') wu = 0.95;
      eyeGlow(1 + (e.t / wu) * 2.5);
      if (e.type === 'caster' && Math.random() < 0.8) {
        const op = pp.orb.getWorldPosition(tmpV);
        fx.emit(op.x + rand(-0.4, 0.4), op.y + rand(-0.4, 0.4), op.z + rand(-0.4, 0.4), 0, 0, 0, COL.red, COL.redB, 0.1, 0.25, 0, 0);
      }
      if (e.t >= wu) {
        e.state = 'strike'; e.t = 0; e.struck = false;
        if (e.type === 'wraith') { e.lungeDir = toP.clone().normalize(); }
        if (e.boss && e.attackKind === 'leap') { e.leapFrom = e.pos.clone(); }
      }
      break;
    }
    case 'strike': {
      const st = e.boss && e.attackKind === 'leap' ? 0.55 : def.strike;
      if (e.type === 'wraith') {
        e.vel.addScaledVector(e.lungeDir, 40 * dt);
        if (!e.struck && dist < 1.3) { e.struck = true; damagePlayer(e.dmg, e.pos); }
      } else if (e.type === 'caster') {
        if (!e.struck) {
          e.struck = true;
          const op = pp.orb.getWorldPosition(new THREE.Vector3());
          const tgt = P.pos.clone(); tgt.y += 1.1;
          const n = S.wave >= 6 ? 3 : 1;
          for (let k = 0; k < n; k++) {
            const dir = tgt.clone().sub(op).normalize();
            dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (k - (n - 1) / 2) * 0.25);
            fireProjectile(op, dir, 9, e.dmg, new THREE.Color(4, 0.5, 1.4), 'enemy', 1.2);
          }
        }
      } else if (e.boss) {
        if (e.attackKind === 'leap') {
          const k = Math.min(1, e.t / st);
          e.pos.x = lerp(e.leapFrom.x, e.leapTarget.x, k);
          e.pos.z = lerp(e.leapFrom.z, e.leapTarget.z, k);
          e.hop = Math.sin(k * Math.PI) * 5;
          if (k >= 1 && !e.struck) { e.struck = true; e.hop = 0; bossShockwave(e.pos, 4.2, e.dmg * 1.2); }
        } else if (e.attackKind === 'stomp') {
          if (!e.struck && e.t > 0.1) { e.struck = true; bossShockwave(e.pos, 5.0, e.dmg * 0.9); }
        } else if (!e.struck && e.t > 0.12) {
          e.struck = true; enemyAttackHit(e, def.range, 1.5, e.dmg);
          const c = e.pos.clone(); c.y += 1;
          for (let k = 0; k < 20; k++) { const a = e.face + rand(-1.4, 1.4); fx.emit(e.pos.x + Math.sin(a) * 3.5, e.pos.y + 1.2, e.pos.z + Math.cos(a) * 3.5, Math.sin(a) * 3, 1, Math.cos(a) * 3, COL.red, COL.redB, 0.12, 0.4, 2, 2); }
          Audio.heavy();
        }
      } else {
        if (e.t < 0.12) e.vel.addScaledVector(toP.clone().normalize(), 18 * dt);
        if (!e.struck && e.t > 0.08) { e.struck = true; enemyAttackHit(e, def.range, 1.1, e.dmg); Audio.swing(); }
      }
      if (e.t >= st) { e.state = 'recover'; e.t = 0; }
      break;
    }
    case 'recover': {
      turn = 1.5;
      eyeGlow(1);
      if (e.t >= def.recover) { e.state = 'chase'; e.t = 0; e.atkCd = def.cd * rand(0.8, 1.4); }
      break;
    }
    case 'summon': {
      turn = 0;
      eyeGlow(3 + Math.sin(e.t * 20));
      if (e.t > 0.4 && !e.didSummon) {
        e.didSummon = true;
        Audio.bell();
        for (let k = 0; k < 4 + Math.floor(S.wave / 5); k++) {
          const a = (k / 4) * Math.PI * 2 + rand(-0.3, 0.3);
          const x = e.pos.x + Math.cos(a) * 5, z = e.pos.z + Math.sin(a) * 5;
          if (Math.hypot(x, z) < ARENA_R - 2 && Math.hypot(x, z) > 5) S.spawnQueue.push({ type: k % 3 === 2 ? 'wraith' : 'husk', x, z, delay: k * 0.25 });
        }
      }
      if (e.t > 1.6) { e.state = 'chase'; e.t = 0; e.atkCd = 1; }
      break;
    }
    case 'stagger': {
      turn = 0;
      eyeGlow(0.5);
      if (e.t > 0.45) { e.state = 'chase'; e.t = 0; e.atkCd = Math.max(e.atkCd, 0.4); }
      break;
    }
    case 'dying': {
      const k = Math.min(1, e.t / 1.3);
      e.mesh.position.y = e.pos.y - k * (def.flying ? 0 : 1.2) * (e.boss ? 2 : 1);
      e.mesh.rotation.x = -k * 0.6;
      for (const m of e.mats) m.opacity = 1 - k;
      e.mesh.traverse((o) => { if (o.material && o.material.isMeshBasicMaterial) { o.material.transparent = true; o.material.opacity = 1 - k; } });
      if (Math.random() < 0.5) fx.emit(e.pos.x + rand(-0.5, 0.5), e.pos.y + rand(0, 1.5), e.pos.z + rand(-0.5, 0.5), 0, rand(0.5, 2), 0, COL.soulA, COL.soulB, 0.1, 0.8, -1, 1);
      if (e.t > 1.3) { scene.remove(e.mesh); e.dead = true; }
      return;
    }
  }

  // facing
  if (turn > 0) e.face += clamp(angDiff(e.face, want), -turn * dt, turn * dt);

  // movement + separation
  const sp = def.speed * (e.boss && e.hp < e.maxHp * 0.5 ? 1.25 : 1);
  if (move !== 0) {
    const dir = toP.normalize();
    e.vel.x = lerp(e.vel.x, dir.x * sp * move, 1 - Math.exp(-6 * dt));
    e.vel.z = lerp(e.vel.z, dir.z * sp * move, 1 - Math.exp(-6 * dt));
  } else {
    e.vel.multiplyScalar(Math.exp(-7 * dt));
  }
  for (const o of enemies) {
    if (o === e || o.state === 'dying') continue;
    const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z;
    const d = Math.hypot(dx, dz), md = e.radius + o.radius;
    if (d < md && d > 0.001) { e.vel.x += (dx / d) * (md - d) * 12 * dt * 4; e.vel.z += (dz / d) * (md - d) * 12 * dt * 4; }
  }
  if (!(e.boss && e.state === 'strike' && e.attackKind === 'leap')) {
    e.pos.x += e.vel.x * dt; e.pos.z += e.vel.z * dt;
  }
  collide(e.pos, e.radius);
  // keep off the player
  {
    const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz), md = e.radius + 0.4;
    if (d < md && d > 0.001) { e.pos.x += (dx / d) * (md - d); e.pos.z += (dz / d) * (md - d); }
  }
  e.pos.y = heightAt(e.pos.x, e.pos.z);

  // ---- procedural animation ----
  const spd = Math.hypot(e.vel.x, e.vel.z);
  e.walk += dt * spd * (e.boss ? 1.4 : 3.2);
  e.mesh.position.set(e.pos.x, e.pos.y + (e.hop || 0), e.pos.z);
  e.mesh.rotation.y = e.face;
  const sw = Math.sin(e.walk);
  if (pp.legs.length) {
    pp.legs[0].leg.rotation.x = sw * 0.6; pp.legs[1].leg.rotation.x = -sw * 0.6;
    pp.legs[0].knee.rotation.x = Math.max(0, -sw) * 0.9; pp.legs[1].knee.rotation.x = Math.max(0, sw) * 0.9;
    pp.body.position.y = Math.abs(Math.cos(e.walk)) * 0.05;
  }
  if (def.flying) {
    pp.body.position.y = 0.35 + Math.sin(S.time * 2.5 + e.walk) * 0.12;
    pp.body.rotation.x = clamp(spd * 0.06, 0, 0.5);
    if (Math.random() < 0.35) fx.emit(e.pos.x + rand(-0.3, 0.3), e.pos.y + 0.3, e.pos.z + rand(-0.3, 0.3), rand(-0.3, 0.3), rand(0.2, 0.6), rand(-0.3, 0.3), COL.spirit, COL.spiritB, 0.1, 0.8, 0, 1);
  }
  const A = pp.arms;
  let aL = 0.2 + sw * 0.3, aR = 0.2 - sw * 0.3, elb = -0.4, lean = 0, twist = 0;
  if (e.type === 'caster') { aL = -0.3; aR = -0.5; elb = -0.6; }
  if (def.flying) { aL = -0.6; aR = -0.6; elb = -0.3; }
  if (e.state === 'windup') {
    const k = ease(Math.min(1, e.t / (e.boss && e.attackKind !== 'sweep' ? 1.0 : def.windup)));
    if (e.type === 'caster') { aR = lerp(-0.5, -2.8, k); }
    else if (e.boss) {
      if (e.attackKind === 'sweep') { aR = -1.6 * k; twist = -1.0 * k; elb = -0.2; }
      else { aR = -2.9 * k; aL = -2.9 * k; elb = -0.3; lean = -0.4 * k; }
    } else if (def.flying) { aL = aR = -2.2 * k; lean = -0.3 * k; }
    else { aL = aR = -2.7 * k; lean = -0.35 * k; elb = -0.5 * k - 0.2; }
  } else if (e.state === 'strike') {
    const k = ease(Math.min(1, e.t / 0.15));
    if (e.type === 'caster') aR = lerp(-2.8, -1.2, k);
    else if (e.boss) {
      if (e.attackKind === 'sweep') { aR = -1.6; twist = lerp(-1.0, 1.4, k); }
      else { aR = aL = lerp(-2.9, -0.5, k); lean = lerp(-0.4, 0.5, k); }
    } else if (def.flying) { aL = aR = -1.5; lean = 0.5; }
    else { aL = aR = lerp(-2.7, -0.5, k); lean = lerp(-0.35, 0.55, k); }
  } else if (e.state === 'stagger') { lean = -0.5 * Math.sin(Math.min(1, e.t / 0.45) * Math.PI); aL = aR = 0.6; }
  else if (e.state === 'summon') { aL = aR = -2.8; lean = -0.5; }
  if (A) {
    A[0].sh.rotation.x = lerp(A[0].sh.rotation.x, aR, 1 - Math.exp(-18 * dt));
    A[1].sh.rotation.x = lerp(A[1].sh.rotation.x, aL, 1 - Math.exp(-18 * dt));
    A[0].el.rotation.x = A[1].el.rotation.x = elb;
    A[0].sh.rotation.z = 0.15; A[1].sh.rotation.z = -0.15;
  }
  pp.torso.rotation.y = lerp(pp.torso.rotation.y, twist, 1 - Math.exp(-14 * dt));
  const baseLean = e.type === 'husk' || e.type === 'brute' || e.boss ? 0.35 : 0;
  pp.torso.rotation.x = lerp(pp.torso.rotation.x, baseLean + lean, 1 - Math.exp(-14 * dt));
  if (pp.head) pp.head.rotation.z = Math.sin(S.time * 1.3 + e.walk) * 0.12;
  if (e.type === 'caster') { pp.orb.rotation.y += dt * 3; pp.orbM.color.setRGB(4, 0.5, 1.4).multiplyScalar(e.state === 'windup' ? 1.5 : 0.8); }
}

function spawnTelegraph(pos, radius, life) {
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.05), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, heightAt(pos.x, pos.z) + 0.06, pos.z);
  ring.scale.setScalar(radius);
  const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.05, 0.02), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.copy(ring.position); disc.position.y += 0.01;
  scene.add(ring, disc);
  decals.push({ mesh: ring, t: 0, life, kind: 'ring' }, { mesh: disc, t: 0, life, kind: 'grow', radius });
}
function bossShockwave(pos, radius, dmg) {
  S.shake = 0.9; Audio.boom();
  const d = Math.hypot(P.pos.x - pos.x, P.pos.z - pos.z);
  if (d < radius) damagePlayer(dmg, pos);
  for (let k = 0; k < 80; k++) {
    const a = Math.random() * Math.PI * 2, s = rand(4, 9);
    fx.emit(pos.x + Math.cos(a) * 0.5, pos.y + 0.2, pos.z + Math.sin(a) * 0.5, Math.cos(a) * s, rand(1, 4), Math.sin(a) * s, COL.fireA, COL.fireB, rand(0.1, 0.25), rand(0.4, 0.8), 6, 2);
  }
  for (let k = 0; k < 30; k++) {
    const a = Math.random() * Math.PI * 2, s = rand(1, 4);
    smoke.emit(pos.x + Math.cos(a) * 1.5, pos.y + 0.2, pos.z + Math.sin(a) * 1.5, Math.cos(a) * s, rand(0.5, 2), Math.sin(a) * s, COL.dirt, COL.dirtB, rand(0.6, 1.2), rand(1, 1.6), -0.2, 1.5);
  }
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.2, 0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, pos.y + 0.1, pos.z);
  scene.add(ring);
  decals.push({ mesh: ring, t: 0, life: 0.5, kind: 'wave', radius });
}

// ---------------- collision ----------------
function collide(p, r) {
  for (const c of world.colliders) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), md = c.r + r;
    if (d < md && d > 0.0001) { p.x += (dx / d) * (md - d); p.z += (dz / d) * (md - d); }
  }
  const d = Math.hypot(p.x, p.z);
  if (d > ARENA_R) { p.x *= ARENA_R / d; p.z *= ARENA_R / d; }
}

// ---------------- waves ----------------
function waveComposition(w) {
  const list = [];
  if (w % 5 === 0) {
    list.push('king');
    for (let i = 0; i < Math.floor(w / 5) * 2; i++) list.push('husk');
    return list;
  }
  const n = 3 + Math.floor(w * 1.6);
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    if (w >= 3 && r < 0.18) list.push('caster');
    else if (w >= 2 && r < 0.42) list.push('wraith');
    else if (w >= 4 && r < 0.55) list.push('brute');
    else list.push('husk');
  }
  return list;
}
function startWave() {
  S.wave++;
  enemyMul = 1 + (S.wave - 1) * 0.12;
  const comp = waveComposition(S.wave);
  S.spawnQueue = comp.map((type, i) => {
    let x, z, g = 0;
    do {
      const a = Math.random() * Math.PI * 2, r = rand(12, ARENA_R - 3);
      x = Math.cos(a) * r; z = Math.sin(a) * r; g++;
    } while (g < 30 && (Math.hypot(x - P.pos.x, z - P.pos.z) < 9 || world.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 1)));
    if (type === 'king') { const a = Math.atan2(P.pos.z, P.pos.x) + Math.PI; x = Math.cos(a) * 18; z = Math.sin(a) * 18; }
    return { type, x, z, delay: type === 'king' ? 1.5 : i * 0.7 + rand(0, 0.4) };
  });
  S.spawnTimer = 0;
  S.waveActive = true;
  $('wave').textContent = toRoman(S.wave);
  if (S.wave % 5 !== 0) showBanner(`גל ${S.wave}`, waveFlavor(S.wave), 2.4);
  Audio.bell();
}
function waveFlavor(w) {
  const lines = ['המתים מתעוררים', 'רוחות הערפל צדות', 'כוהני העצם לוחשים', 'האדמה רועדת', 'הירח מדמם', 'אין מנוחה בבית הקברות', 'הצללים מתקרבים', 'הלהבה מהבהבת'];
  return lines[(w - 1) % lines.length];
}
function toRoman(n) {
  const m = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = '';
  if (n >= 40) return String(n);
  for (const [v, r] of m) while (n >= v) { s += r; n -= v; }
  return s;
}
function updateWaves(dt) {
  if (!S.waveActive) return;
  S.spawnTimer += dt;
  for (let i = S.spawnQueue.length - 1; i >= 0; i--) {
    const q = S.spawnQueue[i];
    if (S.spawnTimer >= q.delay) { spawnEnemy(q.type, q.x, q.z); S.spawnQueue.splice(i, 1); }
  }
  // queued summons from the boss use relative delays
  if (S.spawnQueue.length === 0 && enemies.length === 0 && soulOrbs.length === 0) {
    S.waveActive = false;
    setTimeout(() => { if (S.mode === 'play') waveCleared(); }, 900);
  }
}

// ---------------- blessings ----------------
const BLESSINGS = [
  { id: 'hp', icon: '❤', name: 'לב הברזל', desc: '+25 חיים מקסימליים, ריפוי מלא', apply: () => { P.maxHp += 25; P.hp = P.maxHp; } },
  { id: 'dmg', icon: '⚔', name: 'להב מושחז', desc: '+20% נזק להב', apply: () => { P.dmgMul *= 1.2; } },
  { id: 'st', icon: '❂', name: 'רוח בלתי נלאית', desc: '+25 סיבולת והתאוששות מהירה', apply: () => { P.maxSt += 25; P.stRegen += 8; } },
  { id: 'flask', icon: '⚱', name: 'בקבוק אפר נוסף', desc: '+1 שיקוי מרפא', apply: () => { P.maxFlasks++; } },
  { id: 'spell', icon: '✷', name: 'אש הנשמה', desc: '+40% נזק לחש, עלות נמוכה יותר', apply: () => { P.spellMul *= 1.4; P.spellCost = Math.max(18, P.spellCost - 5); } },
  { id: 'dodge', icon: '☾', name: 'צעד הצל', desc: 'התחמקות זולה ב-30%, חסינות ארוכה', apply: () => { P.dodgeMul *= 0.7; } },
  { id: 'leech', icon: '☩', name: 'צמא לדם', desc: 'כל מכה מרפאת 2 חיים', apply: () => { P.lifesteal += 2; } },
  { id: 'crit', icon: '✠', name: 'עין הזעם', desc: '+12% סיכוי למכה קטלנית', apply: () => { P.crit += 0.12; } },
  { id: 'speed', icon: '➶', name: 'רגלי הרוח', desc: '+12% מהירות תנועה', apply: () => { P.speed *= 1.12; } },
];
function waveCleared() {
  P.flasks = P.maxFlasks;
  P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.2);
  showBanner('הגל נהדף', 'הלהבה עדיין בוערת', 1.8, 'victory');
  setTimeout(() => {
    if (S.mode !== 'play') return;
    S.mode = 'choose';
    document.exitPointerLock?.();
    const picks = [...BLESSINGS].sort(() => Math.random() - 0.5).slice(0, 3);
    const box = $('cards'); box.innerHTML = '';
    picks.forEach((b, i) => {
      const el = document.createElement('button');
      el.className = 'card';
      el.innerHTML = `<div class="ci">${b.icon}</div><div class="cn">${b.name}</div><div class="cd">${b.desc}</div><div class="ck">${i + 1}</div>`;
      el.style.animationDelay = i * 0.08 + 's';
      el.onclick = () => {
        b.apply(); Audio.soul(); Audio.click();
        $('choose').classList.remove('show');
        S.mode = 'play';
        if (!IS_TOUCH) canvasEl.requestPointerLock?.()?.catch?.(() => {});
        setTimeout(startWave, 1200);
      };
      box.appendChild(el);
    });
    $('choose').classList.add('show');
  }, 1900);
}

// ---------------- UI helpers ----------------
let bannerTimer = null;
function showBanner(title, sub, dur = 2.5, kind = '') {
  const b = $('banner');
  b.className = 'banner show ' + kind;
  $('bTitle').textContent = title; $('bSub').textContent = sub;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), dur * 1000);
}
function flashHud(id) { const el = $(id); el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); }
const dmgPool = [];
function dmgNumber(p, v, crit) {
  const el = document.createElement('div');
  el.className = 'dmg' + (crit ? ' crit' : '');
  el.textContent = v;
  $('nums').appendChild(el);
  dmgPool.push({ el, p: p.clone().add(new THREE.Vector3(rand(-0.3, 0.3), 0.3, rand(-0.3, 0.3))), t: 0 });
}
function updateNums(dt) {
  for (let i = dmgPool.length - 1; i >= 0; i--) {
    const d = dmgPool[i]; d.t += dt; d.p.y += dt * 1.2;
    const v = tmpV.copy(d.p).project(camera);
    if (d.t > 0.9 || v.z > 1) { d.el.remove(); dmgPool.splice(i, 1); continue; }
    d.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%) scale(${1 + Math.max(0, 0.3 - d.t) * 2})`;
    d.el.style.opacity = String(1 - Math.max(0, d.t - 0.5) / 0.4);
  }
}
let lastHud = {};
function updateHud() {
  const set = (id, w) => { if (lastHud[id] !== w) { $(id).style.width = w; lastHud[id] = w; } };
  set('hpFill', (P.hp / P.maxHp) * 100 + '%');
  set('stFill', (Math.max(0, P.st) / P.maxSt) * 100 + '%');
  set('fcFill', (P.focus / P.maxFocus) * 100 + '%');
  $('hpBar').style.width = Math.min(46, 18 + P.maxHp * 0.12) + 'vw';
  $('stBar').style.width = Math.min(40, 14 + P.maxSt * 0.11) + 'vw';
  // ghost bar (delayed damage)
  if (P.ghost === undefined || P.ghost < P.hp) P.ghost = P.hp;
  else if (S.time - P.lastHurt > 0.6) P.ghost = Math.max(P.hp, P.ghost - P.maxHp * 0.01);
  set('hpGhost', (P.ghost / P.maxHp) * 100 + '%');
  $('souls').textContent = S.souls;
  $('flaskN').textContent = P.flasks;
  if (IS_TOUCH) { $('bFlask').dataset.n = P.flasks; $('bSpell').classList.toggle('dim', P.focus < P.spellCost); }
  $('flask').classList.toggle('empty', P.flasks === 0);
  $('spell').classList.toggle('ready', P.focus >= P.spellCost);
  const boss = enemies.find((e) => e.boss && e.state !== 'dying');
  if (boss) set('bossFill', (Math.max(0, boss.hp) / boss.maxHp) * 100 + '%');
}

// ---------------- game flow ----------------
function resetPlayer() {
  Object.assign(P, {
    speed: 5.0, maxHp: 100, hp: 100, maxSt: 100, st: 100, stRegen: 34, focus: 40,
    flasks: 3, maxFlasks: 3, dmgMul: 1, crit: 0.05, lifesteal: 0, spellMul: 1, spellCost: 35, dodgeMul: 1,
    state: 'idle', t: 0, invuln: 0, ghost: 100,
  });
  P.pos.set(0, 0, 9); P.vel.set(0, 0, 0); P.face = Math.PI * 0;
  P.face = 0;
}
function clearField() {
  for (const e of enemies) scene.remove(e.mesh);
  enemies.length = 0;
  for (const p of projectiles) scene.remove(p.mesh);
  projectiles.length = 0;
  for (const s of soulOrbs) scene.remove(s.mesh);
  soulOrbs.length = 0;
  for (const d of decals) scene.remove(d.mesh);
  decals.length = 0;
  S.spawnQueue = [];
  $('bossBar').classList.remove('show');
}
function startGame() {
  Audio.init();
  Audio.click();
  clearField();
  resetPlayer();
  S.wave = 0; S.souls = 0; S.kills = 0; S.waveActive = false;
  camYaw = 0; camPitch = 0.38;
  $('title').classList.add('hide');
  $('death').classList.remove('show');
  $('hud').classList.add('show');
  S.mode = 'play';
  if (!IS_TOUCH) canvasEl.requestPointerLock?.()?.catch?.(() => {});
  setTimeout(startWave, 1200);
}
function die() {
  P.state = 'dead'; P.t = 0;
  S.mode = 'dead';
  document.exitPointerLock?.();
  Audio.bell();
  const best = Math.max(S.best, S.souls);
  if (best > S.best) { S.best = best; try { localStorage.setItem('ashen-best', String(best)); } catch {} }
  setTimeout(() => {
    $('dStats').innerHTML = `הגעת לגל <b>${S.wave}</b> · <b>${S.kills}</b> מתים הושבו לקבר · <b>${S.souls}</b> נשמות<br><span class="best">שיא: ${S.best} נשמות</span>`;
    $('death').classList.add('show');
    $('hud').classList.remove('show');
  }, 1600);
}
function pause(on) {
  if (on) { S.mode = 'pause'; $('pause').classList.add('show'); document.exitPointerLock?.(); }
  else { S.mode = 'play'; $('pause').classList.remove('show'); if (!IS_TOUCH) canvasEl.requestPointerLock?.()?.catch?.(() => {}); }
}
document.addEventListener('pointerlockchange', () => {
  if (!mouse.locked && S.mode === 'play' && document.pointerLockElement === null && wasLocked) pause(true);
  wasLocked = mouse.locked;
});
let wasLocked = false;
$('startBtn').onclick = startGame;
$('retryBtn').onclick = startGame;
$('resumeBtn').onclick = () => pause(false);
$('quitBtn').onclick = () => {
  clearField(); S.mode = 'title';
  $('pause').classList.remove('show'); $('hud').classList.remove('show'); $('title').classList.remove('hide');
};
$('bestTitle').textContent = S.best ? `שיא: ${S.best} נשמות` : '';

// ---------------- player update ----------------
const SWING = { dur: [0.42, 0.42, 0.62], active: [[0.1, 0.24], [0.1, 0.24], [0.24, 0.38]], dmg: [22, 22, 40], reach: [2.6, 2.6, 3.0] };
function updatePlayer(dt) {
  P.t += dt;
  P.invuln = Math.max(0, P.invuln - dt);
  P.stDelay -= dt;
  if (P.stDelay <= 0 && P.state !== 'dodge') P.st = Math.min(P.maxSt, P.st + P.stRegen * dt * (P.state === 'idle' ? 1.3 : 1));
  const mv = S.mode === 'play' ? moveInput() : new THREE.Vector3();
  P.sprint = (keys.ShiftLeft || keys.ShiftRight) && mv.lengthSq() > 0.01 && P.st > 1;
  let speed = 0;

  switch (P.state) {
    case 'idle':
    case 'run': {
      speed = P.speed * (P.sprint ? 1.55 : 1);
      if (P.sprint) { P.st -= 16 * dt; P.stDelay = 0.4; }
      if (mv.lengthSq() > 0.01) {
        P.state = 'run';
        const want = Math.atan2(mv.x, mv.z);
        P.face += angDiff(P.face, want) * (1 - Math.exp(-14 * dt));
      } else P.state = 'idle';
      break;
    }
    case 'attack': {
      const c = P.combo;
      const [a0, a1] = SWING.active[c];
      speed = P.t < a0 ? 1.5 : 0;
      if (P.t < a1) { // small forward step
        P.vel.x += Math.sin(P.face) * (c === 2 ? 14 : 9) * dt * (P.t < a0 + 0.06 ? 1 : 0);
        P.vel.z += Math.cos(P.face) * (c === 2 ? 14 : 9) * dt * (P.t < a0 + 0.06 ? 1 : 0);
      }
      if (P.t >= a0 && P.t <= a1) {
        for (const e of enemies) {
          if (P.hitSet.has(e) || e.state === 'dying') continue;
          const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
          const d = Math.hypot(dx, dz) - e.radius;
          if (d > SWING.reach[c]) continue;
          if (e.type === 'wraith' || e.state === 'rising') { if (e.state === 'rising' && e.t < 0.6) continue; }
          const a = Math.atan2(dx, dz);
          if (Math.abs(angDiff(P.face, a)) > (c === 2 ? 0.9 : 1.35) && d > 0.6) continue;
          P.hitSet.add(e);
          hitEnemy(e, SWING.dmg[c] * P.dmgMul * rand(0.92, 1.08), P.pos, c === 2 ? 9 : 4);
        }
        if (c === 2 && P.t - dt < a0 + 0.04 && P.t >= a0 + 0.04) { // heavy slam fx
          const tip = knight.tipMarker.getWorldPosition(new THREE.Vector3());
          fx.burst(tip, 30, 5, COL.fireA, COL.fireB, 0.1, 0.5, 6, 0.6, 2);
          S.shake = Math.max(S.shake, 0.25);
        }
      }
      if (P.queued && P.t > a1 && c < 2 && P.st > 4) { startSwing(c + 1); break; }
      if (P.t >= SWING.dur[c]) { P.state = 'idle'; P.t = 0; }
      break;
    }
    case 'dodge': {
      const dur = 0.48;
      const k = P.t / dur;
      speed = 0;
      const sp = lerp(13, 2, k);
      P.vel.x = P.dodgeDir.x * sp; P.vel.z = P.dodgeDir.z * sp;
      if (P.t >= dur) { P.state = 'idle'; P.t = 0; }
      break;
    }
    case 'cast': {
      speed = 0;
      const op = knight.L.hand.getWorldPosition(new THREE.Vector3());
      if (P.t < 0.35 && Math.random() < 0.9) fx.emit(op.x + rand(-0.3, 0.3), op.y + rand(-0.2, 0.4), op.z + rand(-0.3, 0.3), 0, 1, 0, COL.soulA, COL.soulB, 0.1, 0.3, 0, 1);
      if (P.t > 0.35 && !P.castFired) {
        P.castFired = true;
        Audio.spell();
        const tgt = nearestEnemy(30, 1.4);
        const dir = new THREE.Vector3(Math.sin(P.face), 0, Math.cos(P.face));
        if (tgt) { dir.set(tgt.pos.x - op.x, tgt.pos.y + 1 - op.y, tgt.pos.z - op.z).normalize(); }
        fireProjectile(op, dir, 15, 52 * P.spellMul, new THREE.Color(1.8, 0.9, 5), 'player', 4, tgt);
      }
      if (P.t > 0.65) { P.state = 'idle'; P.t = 0; }
      break;
    }
    case 'drink': {
      speed = P.speed * 0.3;
      if (P.t > 0.55 && !P.healed) {
        P.healed = true;
        P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.45);
        S.healFx = 1;
        const c = P.pos.clone(); c.y += 1;
        fx.burst(c, 40, 2.5, COL.gold, COL.goldB, 0.1, 1.0, -2, 0.5, 1.5);
      }
      if (P.t > 0.95) { P.state = 'idle'; P.t = 0; }
      break;
    }
    case 'hurt': {
      speed = 0;
      if (P.t > 0.32) { P.state = 'idle'; P.t = 0; }
      break;
    }
    case 'dead': {
      speed = 0;
      break;
    }
  }

  // velocity integration
  const target = speed > 0 ? mv.clone().multiplyScalar(speed) : new THREE.Vector3();
  if (P.state === 'dodge') { /* set directly */ }
  else if (speed > 0) {
    P.vel.x = lerp(P.vel.x, target.x, 1 - Math.exp(-12 * dt));
    P.vel.z = lerp(P.vel.z, target.z, 1 - Math.exp(-12 * dt));
  } else {
    P.vel.x *= Math.exp(-9 * dt); P.vel.z *= Math.exp(-9 * dt);
  }
  P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt;
  collide(P.pos, 0.42);
  P.pos.y = heightAt(P.pos.x, P.pos.z);

  animateKnight(dt);
}

function animateKnight(dt) {
  const K = knight;
  const hv = Math.hypot(P.vel.x, P.vel.z);
  K.root.position.copy(P.pos);
  K.root.rotation.y = P.face;
  const L = (o, prop, v, s = 16) => { o[prop] = lerp(o[prop], v, 1 - Math.exp(-s * dt)); };

  P.walkPhase += dt * hv * 1.75;
  const sw = Math.sin(P.walkPhase);
  const moving = hv > 0.5 && (P.state === 'run' || P.state === 'idle' || P.state === 'drink');
  const amp = moving ? clamp(hv / 6, 0, 1) : 0;
  // legs
  L(K.legs[0].leg.rotation, 'x', sw * 0.75 * amp);
  L(K.legs[1].leg.rotation, 'x', -sw * 0.75 * amp);
  L(K.legs[0].knee.rotation, 'x', Math.max(0, -Math.cos(P.walkPhase)) * 1.1 * amp + 0.05);
  L(K.legs[1].knee.rotation, 'x', Math.max(0, Math.cos(P.walkPhase)) * 1.1 * amp + 0.05);
  let bodyY = Math.abs(Math.cos(P.walkPhase)) * 0.06 * amp, bodyX = amp * 0.12 * (P.sprint ? 1.8 : 1), bodyRotY = 0;
  // idle breathing
  bodyY += Math.sin(S.time * 2) * 0.008;

  // arms default
  let rX = -0.35 - sw * 0.35 * amp, rY = 0, rZ = 0.12, rEl = -0.5, wrist = -1.15;
  let lX = 0.15 + sw * 0.35 * amp, lY = 0, lZ = -0.18, lEl = -0.35;
  let torsoY = 0, torsoX = 0, legSpread = 0;

  if (P.state === 'attack') {
    const c = P.combo, dur = SWING.dur[c], [a0, a1] = SWING.active[c];
    const t = P.t;
    if (c < 2) {
      const dir = P.swingDir; // 1 = right->left
      const start = -1.5 * dir, end = 1.4 * dir;
      let k;
      if (t < a0) k = -ease(t / a0) * 0.25; // wind back
      else if (t < a1) k = ease((t - a0) / (a1 - a0));
      else k = 1;
      const yaw = k < 0 ? start + k * dir * 0.6 : lerp(start, end, k);
      rX = -1.5; rY = yaw; rZ = 0; rEl = -0.1; wrist = 0;
      torsoY = yaw * 0.35; bodyX = 0.15;
      legSpread = 0.3;
      if (t > a1) { const r = ease((t - a1) / (dur - a1)); rX = lerp(-1.5, -0.6, r); rEl = lerp(-0.1, -0.5, r); }
    } else {
      let k;
      if (t < a0) k = ease(t / a0); else k = 1;
      const down = t < a0 ? 0 : ease(Math.min(1, (t - a0) / (a1 - a0)));
      rX = lerp(lerp(-0.4, -3.1, k), -0.9, down); rY = -0.1; rZ = 0; rEl = lerp(-0.6, 0, k); wrist = 0;
      lX = lerp(-0.6, -1.0, down);
      bodyX = lerp(-0.15, 0.45, down); bodyY -= down * 0.12;
      legSpread = 0.45;
    }
  } else if (P.state === 'dodge') {
    const k = P.t / 0.48;
    bodyX = Math.sin(k * Math.PI) * 1.2; bodyY = -Math.sin(k * Math.PI) * 0.45;
    rX = -1.2; lX = -1.2; rEl = lEl = -1.2;
  } else if (P.state === 'cast') {
    const k = ease(Math.min(1, P.t / 0.35));
    lX = lerp(0, -1.6, k); lY = 0.2; lEl = -0.1 * k;
    if (P.t > 0.35) lX = -1.4;
    torsoY = -0.3 * k;
  } else if (P.state === 'drink') {
    const k = Math.sin(Math.min(1, P.t / 0.9) * Math.PI);
    lX = -1.3 * k - 0.1; lEl = -1.6 * k; lY = -0.4 * k; lZ = -0.3;
    K.head.rotation.x = -0.4 * k;
  } else if (P.state === 'hurt') {
    const k = Math.sin(Math.min(1, P.t / 0.32) * Math.PI);
    bodyX = -0.4 * k; torsoX = -0.2 * k;
  } else if (P.state === 'dead') {
    const k = ease(Math.min(1, P.t / 1.0));
    bodyX = 0; bodyY = -k * 0.55;
    K.body.rotation.z = lerp(0, 0.2, k);
    torsoX = k * 0.9;
    rX = 0.3; lX = 0.3;
    K.legs[0].knee.rotation.x = K.legs[1].knee.rotation.x = 1.5 * k;
    K.legs[0].leg.rotation.x = K.legs[1].leg.rotation.x = -1.4 * k;
  }
  if (P.state !== 'drink') K.head.rotation.x = lerp(K.head.rotation.x, 0, 1 - Math.exp(-8 * dt));
  if (P.state !== 'dead') K.body.rotation.z = 0;

  const fast = P.state === 'attack' ? 40 : 16;
  L(K.R.sh.rotation, 'x', rX, fast); L(K.R.sh.rotation, 'y', rY, fast); L(K.R.sh.rotation, 'z', rZ, fast);
  L(K.R.el.rotation, 'x', rEl, fast); L(K.R.hand.rotation, 'x', wrist, fast);
  L(K.L.sh.rotation, 'x', lX); L(K.L.sh.rotation, 'y', lY); L(K.L.sh.rotation, 'z', lZ); L(K.L.el.rotation, 'x', lEl);
  L(K.torso.rotation, 'y', torsoY, fast); L(K.torso.rotation, 'x', torsoX);
  L(K.body.rotation, 'x', bodyX, P.state === 'dodge' ? 30 : 12);
  K.body.position.y = lerp(K.body.position.y, bodyY, 1 - Math.exp(-20 * dt));
  if (P.state === 'attack') {
    K.legs[0].leg.rotation.x = lerp(K.legs[0].leg.rotation.x, -legSpread, 0.3);
    K.legs[1].leg.rotation.x = lerp(K.legs[1].leg.rotation.x, legSpread * 0.8, 0.3);
  }
  // lantern stays hanging (counter rotate)
  K.cage.rotation.x = -(K.L.sh.rotation.x + K.L.el.rotation.x) + Math.sin(S.time * 3 + P.walkPhase) * 0.15;
  // cloak sway
  L(K.cloakPivot.rotation, 'x', 0.15 + hv * 0.07 + Math.sin(S.time * 2.3) * 0.04 + (P.state === 'dodge' ? 0.6 : 0), 6);
  // lantern & flame flicker
  const fl = 0.85 + 0.15 * Math.sin(S.time * 17) * Math.sin(S.time * 9.3);
  K.lanternLight.intensity = 1.1 * fl;
  K.flame.scale.setScalar(fl);
  // blade glow
  const glow = P.state === 'attack' ? 1 : 0;
  K.bladeMat.emissiveIntensity = lerp(K.bladeMat.emissiveIntensity, glow * 1.4, 1 - Math.exp(-10 * dt));
  K.runeMat.color.setRGB(3, 1, 0.3).multiplyScalar(0.6 + glow * 1.2 + Math.sin(S.time * 3) * 0.1);
  // invulnerability blink
  K.root.visible = !(P.invuln > 0 && P.state !== 'dodge' && Math.floor(S.time * 20) % 2 === 0) || P.state === 'dead';
}

function updateTrail(dt) {
  const active = P.state === 'attack';
  if (active) {
    knight.root.updateMatrixWorld(true);
    trail.base.unshift(knight.baseMarker.getWorldPosition(new THREE.Vector3()));
    trail.tip.unshift(knight.tipMarker.getWorldPosition(new THREE.Vector3()));
    if (trail.base.length > TRAIL_N) { trail.base.pop(); trail.tip.pop(); }
    trail.alive = 1;
    trailMat.uniforms.col.value.setRGB(3.2, 1.2, 0.35).multiplyScalar(P.combo === 2 ? 1.4 : 1);
  } else {
    trail.alive = Math.max(0, trail.alive - dt * 6);
    if (trail.base.length > 1 && Math.random() < 0.9) { trail.base.pop(); trail.tip.pop(); }
  }
  const n = trail.base.length;
  for (let i = 0; i < TRAIL_N; i++) {
    const j = Math.min(i, n - 1);
    const b = n ? trail.base[j] : P.pos, t = n ? trail.tip[j] : P.pos;
    trailPos.set([b.x, b.y, b.z], i * 6);
    trailPos.set([t.x, t.y, t.z], i * 6 + 3);
    const a = n > 1 ? Math.pow(1 - i / TRAIL_N, 1.5) * trail.alive * 0.9 : 0;
    trailA[i * 2] = a * 0.1; trailA[i * 2 + 1] = a;
  }
  trailGeo.attributes.position.needsUpdate = trailGeo.attributes.a.needsUpdate = true;
}

// ---------------- projectiles / souls / decals ----------------
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    const m = p.mesh;
    // homing
    let tgt = null;
    if (p.owner === 'enemy') tgt = tmpV.set(P.pos.x, P.pos.y + 1.1, P.pos.z);
    else if (p.target && !p.target.dead && p.target.state !== 'dying') tgt = tmpV.set(p.target.pos.x, p.target.pos.y + (p.target.boss ? 2.5 : 1.1), p.target.pos.z);
    if (tgt && p.homing) {
      const want = tgt.clone().sub(m.position).normalize().multiplyScalar(p.speed);
      p.vel.lerp(want, 1 - Math.exp(-p.homing * dt));
      p.vel.setLength(p.speed);
    }
    m.position.addScaledVector(p.vel, dt);
    m.scale.setScalar((p.owner === 'player' ? 1.3 : 1) * (0.9 + Math.sin(S.time * 30) * 0.1));
    // trail particles
    for (let k = 0; k < 2; k++) fx.emit(m.position.x + rand(-0.08, 0.08), m.position.y + rand(-0.08, 0.08), m.position.z + rand(-0.08, 0.08), rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4), p.color, [p.color[0] * 0.2, p.color[1] * 0.1, p.color[2] * 0.2], 0.16, 0.35, 0, 1);
    let done = p.life <= 0;
    const gy = heightAt(m.position.x, m.position.z);
    if (m.position.y < gy + 0.05) done = true;
    if (p.owner === 'enemy') {
      if (m.position.distanceTo(tmpV2.set(P.pos.x, P.pos.y + 1.0, P.pos.z)) < 0.75) {
        if (damagePlayer(p.dmg, m.position)) done = true;
        else if (P.state !== 'dodge') done = true;
      }
    } else {
      for (const e of enemies) {
        if (e.state === 'dying') continue;
        const h = e.boss ? 2.5 : 1.1;
        if (Math.hypot(e.pos.x - m.position.x, e.pos.z - m.position.z) < e.radius + 0.4 && Math.abs(e.pos.y + h - m.position.y) < h + 0.5) { done = true; break; }
      }
      if (done) { // AoE explosion
        Audio.boom();
        fx.burst(m.position, 90, 9, COL.soulA, COL.soulB, 0.16, 0.7, 2, 0.3, 2.5);
        fx.burst(m.position, 30, 4, [4, 3, 5], COL.soulB, 0.3, 0.3, 0, 0, 3);
        S.shake = Math.max(S.shake, 0.3);
        for (const e of enemies) {
          if (e.state === 'dying') continue;
          const d = Math.hypot(e.pos.x - m.position.x, e.pos.z - m.position.z) - e.radius;
          if (d < 3.2) hitEnemy(e, p.dmg * (1 - (d / 3.2) * 0.4), m.position, 8, 'spell');
        }
        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.8, 4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(m.position.x, gy + 0.1, m.position.z);
        scene.add(ring); decals.push({ mesh: ring, t: 0, life: 0.4, kind: 'wave', radius: 3.4 });
      }
    }
    if (done) {
      if (p.owner === 'enemy') fx.burst(m.position, 20, 4, p.color, COL.redB, 0.1, 0.4, 4, 0.3, 2);
      scene.remove(m); m.material.dispose();
      projectiles.splice(i, 1);
    }
  }
}
function updateSouls(dt) {
  const target = tmpV2.set(P.pos.x, P.pos.y + 1.1, P.pos.z);
  for (let i = soulOrbs.length - 1; i >= 0; i--) {
    const s = soulOrbs[i];
    s.t += dt;
    if (s.t < 0.5) { s.vel.multiplyScalar(Math.exp(-4 * dt)); s.vel.y -= 2 * dt; }
    else {
      const want = target.clone().sub(s.mesh.position);
      const d = want.length();
      want.normalize().multiplyScalar(Math.min(22, 6 + s.t * 10));
      s.vel.lerp(want, 1 - Math.exp(-6 * dt));
      if (d < 0.5 || P.state === 'dead') {
        if (P.state !== 'dead') { S.souls += s.value; Audio.soul(); P.focus = Math.min(P.maxFocus, P.focus + 1.5); }
        scene.remove(s.mesh); s.mesh.material.dispose();
        soulOrbs.splice(i, 1);
        continue;
      }
    }
    s.mesh.position.addScaledVector(s.vel, dt);
    if (Math.random() < 0.6) fx.emit(s.mesh.position.x, s.mesh.position.y, s.mesh.position.z, 0, 0.2, 0, COL.soulA, COL.soulB, 0.1, 0.4, 0, 1);
  }
}
function updateDecals(dt) {
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i];
    d.t += dt;
    const k = d.t / d.life;
    const m = d.mesh.material;
    if (d.kind === 'ring') m.opacity = 0.6 + 0.4 * Math.sin(d.t * 25);
    else if (d.kind === 'grow') { d.mesh.scale.setScalar(d.radius * ease(Math.min(1, k))); m.opacity = 0.35; }
    else if (d.kind === 'wave') { d.mesh.scale.setScalar(0.5 + d.radius * ease(k)); m.opacity = 1 - k; }
    else { m.opacity = Math.sin(Math.min(1, k) * Math.PI) * 0.35; d.mesh.scale.multiplyScalar(1 + dt * 0.3); }
    if (d.t >= d.life) { scene.remove(d.mesh); m.dispose(); decals.splice(i, 1); }
  }
}

// ---------------- camera ----------------
const camLook = new THREE.Vector3(0, 1.5, 0);
const camPos = new THREE.Vector3(0, 6, 15);
function updateCamera(dt) {
  const t = S.time;
  if (S.mode === 'title') {
    const a = t * 0.05;
    const target = new THREE.Vector3(Math.sin(a) * 16, 4.5 + Math.sin(t * 0.2) * 0.8, Math.cos(a) * 16);
    camPos.lerp(target, 1 - Math.exp(-1.5 * dt));
    camLook.lerp(new THREE.Vector3(0, 2.6, 0), 1 - Math.exp(-2 * dt));
  } else {
    const lookAt = new THREE.Vector3(P.pos.x, P.pos.y + 1.45, P.pos.z);
    const boss = enemies.find((e) => e.boss && e.state !== 'dying');
    let dist = camDist + (boss ? 2.2 : 0);
    if (P.state === 'dead') { dist = 4.5; }
    const cp = Math.cos(camPitch), spch = Math.sin(camPitch);
    const want = new THREE.Vector3(lookAt.x + Math.sin(camYaw) * cp * dist, lookAt.y + spch * dist + 0.3, lookAt.z + Math.cos(camYaw) * cp * dist);
    const gy = heightAt(want.x, want.z) + 0.6;
    if (want.y < gy) want.y = gy;
    camPos.lerp(want, 1 - Math.exp(-14 * dt));
    camLook.lerp(lookAt, 1 - Math.exp(-18 * dt));
  }
  camera.position.copy(camPos);
  if (S.shake > 0) {
    const s = S.shake * S.shake * 0.35;
    camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s;
    S.shake = Math.max(0, S.shake - dt * 2.2);
  }
  camera.lookAt(camLook);
  // shadow camera follows the action
  const focus = S.mode === 'title' ? new THREE.Vector3() : P.pos;
  moon.target.position.set(focus.x, 0, focus.z);
  moon.position.set(focus.x, 0, focus.z).addScaledVector(world.moonDir, 70);
}

// ---------------- environment fx ----------------
let lightning = 0, nextLightning = 12;
function updateEnv(dt) {
  for (const f of world.flames) {
    const n = Math.sin(S.time * 11 + f.seed) * 0.5 + Math.sin(S.time * 23.7 + f.seed * 2) * 0.3 + Math.sin(S.time * 5.1 + f.seed) * 0.2;
    f.light.intensity = f.base * (0.82 + 0.18 * n);
    const rate = 45 * dt;
    for (let k = 0; k < rate + (Math.random() < rate % 1 ? 1 : 0); k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.5;
      fx.emit(f.pos.x + Math.cos(a) * r, f.pos.y, f.pos.z + Math.sin(a) * r, rand(-0.2, 0.2), rand(1.4, 2.8), rand(-0.2, 0.2), COL.fireA, COL.fireB, rand(0.14, 0.3), rand(0.4, 0.85), -0.5, 1.2);
    }
    if (Math.random() < 6 * dt) smoke.emit(f.pos.x, f.pos.y + 1.2, f.pos.z, rand(-0.2, 0.2), rand(0.8, 1.4), rand(-0.2, 0.2), [0.06, 0.05, 0.05], [0.02, 0.02, 0.02], rand(0.6, 1.0), rand(1.8, 2.6), -0.1, 0.3);
    if (Math.random() < 3 * dt) fx.emit(f.pos.x, f.pos.y + 0.5, f.pos.z, rand(-1, 1), rand(2, 4), rand(-1, 1), COL.spark, COL.sparkB, 0.04, rand(1, 1.8), 0.5, 0.5);
  }
  // heat lightning
  nextLightning -= dt;
  if (nextLightning <= 0) { lightning = 1; nextLightning = rand(14, 30); Audio.thunder(); }
  if (lightning > 0) {
    lightning = Math.max(0, lightning - dt * 2.5);
    const f = lightning * (0.6 + 0.4 * Math.sin(lightning * 40));
    world.sky.uniforms.flash.value = f;
    hemi.intensity = 1.3 + f * 2.2;
  } else { world.sky.uniforms.flash.value = 0; hemi.intensity = 1.3; }
}

// ---------------- main loop ----------------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  update(Math.min(clock.getDelta(), 0.05));
  composer.render();
}
function update(rdt) {
  S.time += rdt;
  let dt = rdt;
  if (S.hitstop > 0) { S.hitstop -= rdt; dt = rdt * 0.08; }
  const playing = S.mode === 'play' || S.mode === 'dead';
  if (S.mode === 'pause' || S.mode === 'choose') dt = 0;

  if (playing || S.mode === 'choose') {
    if (dt > 0) {
      updatePlayer(dt);
      for (const e of enemies) updateEnemy(e, dt);
      for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
      if (S.mode === 'play') updateWaves(dt);
      updateProjectiles(dt);
      updateSouls(dt);
      updateDecals(dt);
    }
    updateTrail(rdt);
    updateHud();
  } else if (S.mode === 'title') {
    animateKnight(rdt);
    P.pos.set(0, 0, 9);
  }
  if (S.mode === 'dead') P.t += 0; // handled in updatePlayer
  fx.update(S.mode === 'pause' || S.mode === 'choose' ? 0 : dt || rdt * 0.08);
  smoke.update(S.mode === 'pause' || S.mode === 'choose' ? 0 : dt);
  updateEnv(rdt);
  world.update(S.time, { dt: rdt, pointScale });
  updateCamera(rdt);
  updateNums(rdt);

  S.damageFx = Math.max(0, S.damageFx - rdt * 2.2);
  S.healFx = Math.max(0, S.healFx - rdt * 1.5);
  grade.uniforms.time.value = S.time;
  grade.uniforms.damage.value = S.damageFx;
  grade.uniforms.heal.value = S.healFx;
  grade.uniforms.lowHp.value = S.mode === 'play' && P.hp / P.maxHp < 0.3 ? 1 - (P.hp / P.maxHp) / 0.3 : 0;
  grade.uniforms.fade.value = S.mode === 'dead' ? Math.min(0.55, P.t * 0.35) : 0;
  pointScale = innerHeight * PR * 0.5;
}

// title-screen pose for the knight
knight.root.position.set(0, 0, 9);
P.pos.set(0, 0, 9);
P.face = 0;
frame();
$('loading').classList.add('hide');
window.__game = { S, P, enemies, startGame, spawnEnemy, killEnemy, step: (n) => { for (let i = 0; i < n; i++) update(1 / 60); }, damagePlayer, renderer, scene, knight, camera };
