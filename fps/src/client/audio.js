// Procedural audio: every sound is synthesized at startup (no assets). 3D positional
// playback with HRTF panning, air absorption low-pass, speed-of-sound delay for distant
// events, distant variants, voice limiting, convolution reverb, ambient battle bed.

const SR = 44100;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function synth(len, fn, seed = 1) {
  const n = Math.floor(len * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const r = rng(seed);
  fn(L, R, n, r);
  return [L, R];
}
const onePoleLP = (a) => { let y = 0; return (x) => (y += a * (x - y)); };
const onePoleHP = (a) => { let y = 0, px = 0; return (x) => { y = a * (y + x - px); px = x; return y; }; };

function gun(o) {
  return synth(o.len || 1.2, (L, R, n, r) => {
    const lp = onePoleLP(o.body || 0.18), lp2 = onePoleLP(0.04), hp = onePoleHP(0.9), lpL = onePoleLP(0.03), lpR = onePoleLP(0.033);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const nz = r() * 2 - 1;
      const crack = hp(nz) * Math.exp(-t * (o.crackDecay || 120)) * (o.crack ?? 1);
      const body = lp(nz) * Math.exp(-t * (o.bodyDecay || 22)) * (o.bodyAmt ?? 1.6);
      const f = (o.f0 || 130) * Math.exp(-t * 18) + (o.f1 || 45);
      const thump = Math.sin(2 * Math.PI * f * t + Math.sin(t * 40) * 0.5) * Math.exp(-t * (o.thumpDecay || 26)) * (o.thump ?? 0.9);
      const tailN = lp2(nz) * 3;
      const tail = tailN * Math.exp(-t * (o.tailDecay || 4)) * (o.tail ?? 0.35) * Math.min(1, t * 40);
      const mech = t < 0.012 ? (r() * 2 - 1) * 0.3 * (1 - t / 0.012) : 0;
      let s = crack + body + thump + mech;
      s = Math.tanh(s * (o.drive || 1.6)) * 0.9;
      const tl = lpL(r() * 2 - 1) * 4 * Math.exp(-t * (o.tailDecay || 4)) * (o.tail ?? 0.35) * Math.min(1, t * 30);
      const tr = lpR(r() * 2 - 1) * 4 * Math.exp(-t * (o.tailDecay || 4)) * (o.tail ?? 0.35) * Math.min(1, t * 30);
      L[i] = s + tail * 0.5 + tl * 0.5; R[i] = s + tail * 0.5 + tr * 0.5;
    }
  }, o.seed || 1);
}
function boom(o) {
  return synth(o.len || 3.5, (L, R, n, r) => {
    const lp = onePoleLP(o.lp || 0.06), lp2 = onePoleLP(0.012), lpL = onePoleLP(0.02), lpR = onePoleLP(0.022);
    for (let i = 0; i < n; i++) {
      const t = i / SR, nz = r() * 2 - 1;
      const att = Math.min(1, t * 400);
      const crack = nz * Math.exp(-t * 35) * (o.crack ?? 0.8);
      const body = lp(nz) * 3 * Math.exp(-t * (o.decay || 3)) * att;
      const sub = Math.sin(2 * Math.PI * (55 * Math.exp(-t * 3) + 22) * t) * Math.exp(-t * 2.5) * (o.sub ?? 1.2) * att;
      const rumble = lp2(nz) * 8 * Math.exp(-t * 1.2) * 0.6;
      const debris = t > 0.25 && r() < 0.002 * Math.exp(-t * 1.5) ? (r() - 0.5) * 2 : 0;
      let s = Math.tanh((crack + body + sub + rumble) * 1.4) + debris * 0.3;
      L[i] = s + lpL(r() * 2 - 1) * 3 * Math.exp(-t * 1.5) * 0.4; R[i] = s + lpR(r() * 2 - 1) * 3 * Math.exp(-t * 1.5) * 0.4;
    }
  }, o.seed || 7);
}
function noiseBurst(len, lpA, decay, amp = 1, seed = 3, hpA = 0) {
  return synth(len, (L, R, n, r) => {
    const lp = onePoleLP(lpA), hp = onePoleHP(hpA || 0.0001);
    for (let i = 0; i < n; i++) { const t = i / SR; const s = (hpA ? hp(lp(r() * 2 - 1)) : lp(r() * 2 - 1)) * Math.exp(-t * decay) * amp * Math.min(1, t * 2000); L[i] = R[i] = s; }
  }, seed);
}
function tone(len, f0, f1, decay, amp = 0.5, type = 'sine') {
  return synth(len, (L, R, n) => {
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR, f = f0 + (f1 - f0) * (t / len);
      ph += 2 * Math.PI * f / SR;
      const w = type === 'sine' ? Math.sin(ph) : type === 'tri' ? Math.asin(Math.sin(ph)) * 0.63 : Math.sign(Math.sin(ph)) * 0.5;
      L[i] = R[i] = w * Math.exp(-t * decay) * amp * Math.min(1, t * 800);
    }
  });
}
function clicks(spec, seed = 5) {
  // spec: [[time, freqLP, decay, amp], ...]
  const len = Math.max(...spec.map((s) => s[0])) + 0.15;
  return synth(len, (L, R, n, r) => {
    for (const [t0, lpA, dec, amp, tonal] of spec) {
      const lp = onePoleLP(lpA);
      const s0 = Math.floor(t0 * SR);
      for (let i = s0; i < Math.min(n, s0 + SR * 0.12); i++) {
        const t = (i - s0) / SR;
        const v = (lp(r() * 2 - 1) * 2 + (tonal ? Math.sin(t * tonal * 6.28) * 0.6 : 0)) * Math.exp(-t * dec) * amp;
        L[i] += v; R[i] += v;
      }
    }
  }, seed);
}
function loop(len, fn, seed) { return synth(len, fn, seed); }

export class AudioEngine {
  constructor() {
    this.ctx = null; this.buffers = {}; this.voices = 0; this.enabled = false; this.volume = 0.8;
    this.listener = { x: 0, y: 0, z: 0 };
  }
  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 5; this.comp.attack.value = 0.002; this.comp.release.value = 0.2;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    // reverb send
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.4, 2.8);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.22;
    this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.ui = ctx.createGain(); this.ui.gain.value = 0.7; this.ui.connect(this.master);
    this.build();
    this.enabled = true;
    this.startAmbience();
  }
  makeImpulse(len, decay) {
    const ctx = this.ctx, n = Math.floor(len * ctx.sampleRate);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) { const t = i / n; lp += 0.35 * ((Math.random() * 2 - 1) - lp); d[i] = lp * Math.pow(1 - t, decay) * (i < 400 ? i / 400 : 1); }
    }
    return b;
  }
  toBuf([L, R]) {
    const b = this.ctx.createBuffer(2, L.length, SR);
    b.getChannelData(0).set(L); b.getChannelData(1).set(R);
    return b;
  }
  build() {
    const B = this.buffers, t = (x) => this.toBuf(x);
    B.ar = t(gun({ f0: 140, f1: 50, crack: 1, bodyAmt: 1.6, tail: 0.38, seed: 11 }));
    B.smg = t(gun({ f0: 170, f1: 70, crack: 0.25, crackDecay: 200, bodyAmt: 1.1, body: 0.12, thump: 0.6, tail: 0.18, tailDecay: 6, drive: 1.2, seed: 12, len: 0.7 }));
    B.lmg = t(gun({ f0: 120, f1: 42, crack: 1.1, bodyAmt: 2.0, thump: 1.1, tail: 0.45, seed: 13 }));
    B.sniper = t(gun({ f0: 100, f1: 36, crack: 1.4, crackDecay: 70, bodyAmt: 2.4, thump: 1.4, thumpDecay: 14, tail: 0.6, tailDecay: 2.2, seed: 14, len: 2.2, drive: 2.2 }));
    B.pistol = t(gun({ f0: 220, f1: 80, crack: 0.9, crackDecay: 160, bodyAmt: 1.2, body: 0.25, thump: 0.5, tail: 0.25, tailDecay: 6, seed: 15, len: 0.8 }));
    B.tmg = t(gun({ f0: 130, f1: 48, crack: 1, bodyAmt: 1.8, tail: 0.4, seed: 16 }));
    B.gl = t(gun({ f0: 90, f1: 40, crack: 0.2, bodyAmt: 1.4, body: 0.08, thump: 1.4, thumpDecay: 18, tail: 0.15, seed: 17, len: 0.7, drive: 1.1 }));
    B.rocket = t(synth(1.6, (L, R, n, r) => { const lp = onePoleLP(0.08); for (let i = 0; i < n; i++) { const tt = i / SR; const s = Math.tanh((lp(r() * 2 - 1) * 4 * Math.exp(-tt * 2.2) + (r() * 2 - 1) * Math.exp(-tt * 40) * 0.8 + Math.sin(tt * 2 * Math.PI * (80 - tt * 30)) * Math.exp(-tt * 10)) * 1.5); L[i] = R[i] = s * 0.9; } }, 18));
    B.tank = t(boom({ len: 3.0, lp: 0.12, decay: 5, sub: 1.6, crack: 1.2, seed: 19 }));
    B.boom = t(boom({ seed: 20 }));
    B.boomFar = t(synth(3.5, (L, R, n, r) => { const lp = onePoleLP(0.008), lp2 = onePoleLP(0.02); for (let i = 0; i < n; i++) { const tt = i / SR; const s = lp(r() * 2 - 1) * 14 * Math.exp(-tt * 1.4) * Math.min(1, tt * 60) + Math.sin(tt * 6.28 * 38) * Math.exp(-tt * 2) * 0.5; L[i] = s; R[i] = s * 0.9 + lp2(r() - 0.5) * 0.3; } }, 21));
    B.gunFar = t(synth(1.6, (L, R, n, r) => { const lp = onePoleLP(0.02); for (let i = 0; i < n; i++) { const tt = i / SR; const s = lp(r() * 2 - 1) * 6 * Math.exp(-tt * 5) * Math.min(1, tt * 300) + lp(r() * 2 - 1) * 1.2 * Math.exp(-tt * 1.6); L[i] = R[i] = Math.tanh(s); } }, 22));
    B.crack = t(noiseBurst(0.09, 0.9, 70, 0.9, 23, 0.85));
    B.whiz = t(synth(0.25, (L, R, n, r) => { const bp = onePoleLP(0.3), hp = onePoleHP(0.6); for (let i = 0; i < n; i++) { const tt = i / SR; const env = Math.sin(Math.PI * tt / 0.25) ** 2; const s = hp(bp(r() * 2 - 1)) * env * 0.8; L[i] = s; R[i] = s * 0.7; } }, 24));
    B.impConcrete = t(clicks([[0, 0.5, 60, 0.8], [0.005, 0.1, 30, 0.6]], 25));
    B.impMetal = t(synth(0.35, (L, R, n, r) => { for (let i = 0; i < n; i++) { const tt = i / SR; const s = (Math.sin(tt * 6.28 * 2400) * 0.4 + Math.sin(tt * 6.28 * 3700) * 0.25 + Math.sin(tt * 6.28 * 5300) * 0.15) * Math.exp(-tt * 18) + (r() * 2 - 1) * Math.exp(-tt * 120) * 0.6; L[i] = R[i] = s * 0.6; } }, 26));
    B.impDirt = t(noiseBurst(0.2, 0.06, 30, 1.2, 27));
    B.impFlesh = t(clicks([[0, 0.05, 40, 1.2], [0.01, 0.2, 60, 0.5]], 28));
    B.impWood = t(clicks([[0, 0.25, 45, 0.9, 380], [0.01, 0.05, 25, 0.5]], 29));
    B.glass = t(synth(1.2, (L, R, n, r) => { for (let i = 0; i < n; i++) { const tt = i / SR; let s = (r() * 2 - 1) * Math.exp(-tt * 9) * 0.5; if (r() < 0.004 * Math.exp(-tt * 3)) s += (r() - 0.5) * 1.5; s += Math.sin(tt * 6.28 * (4000 + r() * 2000)) * Math.exp(-tt * 12) * 0.15; L[i] = s; R[i] = s * (0.8 + r() * 0.4); } }, 30));
    B.debris = t(synth(2.5, (L, R, n, r) => { const lp = onePoleLP(0.05); for (let i = 0; i < n; i++) { const tt = i / SR; let s = lp(r() * 2 - 1) * 3 * Math.exp(-tt * 1.6); if (r() < 0.003 * Math.exp(-tt)) s += (r() - 0.5) * 1.2; L[i] = R[i] = Math.tanh(s) * 0.8; } }, 31));
    B.collapse = t(synth(6, (L, R, n, r) => { const lp = onePoleLP(0.015), lp2 = onePoleLP(0.06); for (let i = 0; i < n; i++) { const tt = i / SR; const env = Math.min(1, tt * 2) * Math.exp(-tt * 0.55); let s = lp(r() * 2 - 1) * 10 * env + lp2(r() * 2 - 1) * 2 * env; if (r() < 0.006 * env) s += (r() - 0.5) * 2; L[i] = Math.tanh(s); R[i] = Math.tanh(s * 0.95 + (r() - 0.5) * 0.1 * env); } }, 32));
    for (let k = 0; k < 4; k++) B['step' + k] = t(clicks([[0, 0.08 + k * 0.02, 55, 0.7], [0.012, 0.3, 90, 0.25]], 40 + k));
    B.land = t(clicks([[0, 0.05, 25, 1.2], [0.02, 0.2, 60, 0.4]], 45));
    B.magOut = t(clicks([[0, 0.6, 80, 0.5, 900], [0.04, 0.2, 40, 0.4]], 46));
    B.magIn = t(clicks([[0, 0.5, 70, 0.7, 700], [0.03, 0.7, 90, 0.6, 1300], [0.08, 0.2, 50, 0.3]], 47));
    B.boltBack = t(clicks([[0, 0.7, 90, 0.6, 1500], [0.06, 0.4, 60, 0.4, 1100]], 48));
    B.boltFwd = t(clicks([[0, 0.8, 100, 0.8, 1800], [0.03, 0.3, 50, 0.4]], 49));
    B.empty = t(clicks([[0, 0.9, 140, 0.6, 2200]], 50));
    B.swap = t(clicks([[0, 0.2, 40, 0.3], [0.08, 0.5, 70, 0.4, 900]], 51));
    B.pin = t(clicks([[0, 0.8, 90, 0.5, 2600], [0.1, 0.3, 60, 0.3]], 52));
    B.hit = t(tone(0.06, 2400, 2000, 50, 0.35, 'tri'));
    B.hitHead = t(synth(0.25, (L, R, n) => { for (let i = 0; i < n; i++) { const tt = i / SR; const s = (Math.sin(tt * 6.28 * 2900) * 0.5 + Math.sin(tt * 6.28 * 4350) * 0.3) * Math.exp(-tt * 16); L[i] = R[i] = s * 0.5; } }));
    B.kill = t(synth(0.3, (L, R, n) => { for (let i = 0; i < n; i++) { const tt = i / SR; const s = Math.sin(tt * 6.28 * 1800) * Math.exp(-tt * 14) * 0.35 + Math.sin(tt * 6.28 * 900) * Math.exp(-tt * 10) * 0.3; L[i] = R[i] = s; } }));
    B.ui = t(tone(0.05, 1800, 1400, 60, 0.25, 'tri'));
    B.uiConfirm = t(synth(0.25, (L, R, n) => { for (let i = 0; i < n; i++) { const tt = i / SR; const f = tt < 0.08 ? 880 : 1320; const s = Math.sin(tt * 6.28 * f) * Math.exp(-((tt % 0.08) * 30)) * 0.25; L[i] = R[i] = s; } }));
    B.capture = t(synth(1.1, (L, R, n) => { const notes = [523, 659, 784, 1046]; for (let i = 0; i < n; i++) { const tt = i / SR; let s = 0; notes.forEach((f, k) => { const t0 = k * 0.12; if (tt > t0) s += Math.sin((tt - t0) * 6.28 * f) * Math.exp(-(tt - t0) * 4) * 0.18; }); L[i] = R[i] = s; } }));
    B.lost = t(synth(1.0, (L, R, n) => { const notes = [523, 415, 349]; for (let i = 0; i < n; i++) { const tt = i / SR; let s = 0; notes.forEach((f, k) => { const t0 = k * 0.16; if (tt > t0) s += Math.sin((tt - t0) * 6.28 * f) * Math.exp(-(tt - t0) * 4) * 0.2; }); L[i] = R[i] = s; } }));
    B.heartbeat = t(synth(0.9, (L, R, n) => { for (let i = 0; i < n; i++) { const tt = i / SR; const b1 = Math.exp(-((tt - 0.05) ** 2) * 2000), b2 = Math.exp(-((tt - 0.3) ** 2) * 2500) * 0.7; const s = Math.sin(tt * 6.28 * 55) * (b1 + b2); L[i] = R[i] = s * 0.9; } }));
    B.tankFireLocal = B.tank;
    B.engine = t(loop(2.0, (L, R, n, r) => { const lp = onePoleLP(0.02); for (let i = 0; i < n; i++) { const tt = i / SR; const f = 32; const s = (Math.sin(tt * 6.28 * f) * 0.5 + Math.sin(tt * 6.28 * f * 2) * 0.25 + Math.sin(tt * 6.28 * f * 3.02) * 0.15) * (0.7 + 0.3 * Math.sin(tt * 6.28 * 8)) + lp(r() * 2 - 1) * 2; L[i] = R[i] = Math.tanh(s) * 0.5; } }, 60));
    B.tracks = t(loop(1.0, (L, R, n, r) => { const lp = onePoleLP(0.15); for (let i = 0; i < n; i++) { const tt = i / SR; const clank = Math.exp(-((tt * 12) % 1) * 18); const s = lp(r() * 2 - 1) * 1.5 * (0.3 + clank); L[i] = R[i] = s * 0.5; } }, 61));
    B.wind = t(loop(6.0, (L, R, n, r) => { const lpL = onePoleLP(0.006), lpR = onePoleLP(0.007); for (let i = 0; i < n; i++) { const tt = i / SR; const g = 0.6 + 0.4 * Math.sin(tt * 6.28 / 6) * Math.sin(tt * 6.28 / 3 + 1); L[i] = lpL(r() * 2 - 1) * 9 * g; R[i] = lpR(r() * 2 - 1) * 9 * g; } }, 62));
    B.throw = t(noiseBurst(0.25, 0.15, 14, 0.6, 63));
    B.beep = t(tone(0.12, 1600, 1600, 20, 0.2, 'sq'));
  }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setTargetAtTime(pos.x, t, 0.01); L.positionY.setTargetAtTime(pos.y, t, 0.01); L.positionZ.setTargetAtTime(pos.z, t, 0.01);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.01); L.forwardY.setTargetAtTime(fwd.y, t, 0.01); L.forwardZ.setTargetAtTime(fwd.z, t, 0.01);
      L.upX.setTargetAtTime(up.x, t, 0.01); L.upY.setTargetAtTime(up.y, t, 0.01); L.upZ.setTargetAtTime(up.z, t, 0.01);
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }

  // o: {pos:{x,y,z}, vol, rate, far (buffer name for distance), delay (bool), rev, ui}
  play(name, o = {}) {
    if (!this.enabled || !this.ctx) return null;
    const ctx = this.ctx;
    let buf = this.buffers[name];
    if (!buf) return null;
    let vol = o.vol ?? 1;
    let dist = 0;
    if (o.pos) {
      dist = Math.hypot(o.pos.x - this.listener.x, o.pos.y - this.listener.y, o.pos.z - this.listener.z);
      if (o.far && dist > (o.farDist || 120)) { buf = this.buffers[o.far]; vol *= 1.4; }
      const maxD = o.maxDist || 600;
      if (dist > maxD) return null;
    }
    if (this.voices > 40 && vol < 0.5) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() - 0.5) * (o.jitter ?? 0.06));
    const g = ctx.createGain();
    g.gain.value = vol;
    let node = src;
    if (o.pos) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(700, 20000 * Math.exp(-dist / (o.absorb || 160)));
      const pan = ctx.createPanner();
      pan.panningModel = o.cheap ? 'equalpower' : 'HRTF';
      pan.distanceModel = 'inverse';
      pan.refDistance = o.ref || 6; pan.rolloffFactor = o.roll ?? 1.1; pan.maxDistance = 10000;
      if (pan.positionX) { pan.positionX.value = o.pos.x; pan.positionY.value = o.pos.y; pan.positionZ.value = o.pos.z; } else pan.setPosition(o.pos.x, o.pos.y, o.pos.z);
      node.connect(lp); lp.connect(pan); pan.connect(g);
      node = g;
    } else { node.connect(g); node = g; }
    g.connect(o.ui ? this.ui : this.sfx);
    if (o.rev !== false && !o.ui) { const s = ctx.createGain(); s.gain.value = o.rev ?? 0.5; g.connect(s); s.connect(this.reverb); }
    const delay = o.pos && o.delay && dist > 30 ? dist / 343 : 0;
    src.start(ctx.currentTime + delay + (o.at || 0));
    this.voices++;
    src.onended = () => { this.voices--; };
    return { src, g };
  }
  // looping positional source, returns controller
  loop(name, o = {}) {
    if (!this.enabled) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.buffers[name]; src.loop = true;
    const g = ctx.createGain(); g.gain.value = o.vol ?? 0.5;
    let pan = null;
    if (o.positional) {
      pan = ctx.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = o.ref || 8; pan.rolloffFactor = 1;
      src.connect(pan); pan.connect(g);
    } else src.connect(g);
    g.connect(this.sfx);
    src.start();
    return {
      src, g, pan,
      set: (pos, vol, rate) => {
        const t = ctx.currentTime;
        if (pan && pos) { if (pan.positionX) { pan.positionX.setTargetAtTime(pos.x, t, 0.05); pan.positionY.setTargetAtTime(pos.y, t, 0.05); pan.positionZ.setTargetAtTime(pos.z, t, 0.05); } else pan.setPosition(pos.x, pos.y, pos.z); }
        if (vol != null) g.gain.setTargetAtTime(vol, t, 0.1);
        if (rate != null) src.playbackRate.setTargetAtTime(rate, t, 0.1);
      },
      stop: () => { try { src.stop(); } catch (e) { /* already stopped */ } },
    };
  }
  startAmbience() {
    this.windLoop = this.loop('wind', { vol: 0.16 });
    this.ambT = 0;
  }
  // distant battle bed: random far gunfire & explosions around the listener
  updateAmbience(dt, intensity = 1) {
    if (!this.enabled) return;
    this.ambT -= dt;
    if (this.ambT > 0) return;
    this.ambT = (0.6 + Math.random() * 2.5) / intensity;
    const a = Math.random() * Math.PI * 2, d = 500 + Math.random() * 700;
    const pos = { x: this.listener.x + Math.cos(a) * d, y: this.listener.y + 30, z: this.listener.z + Math.sin(a) * d };
    if (Math.random() < 0.22) this.play('boomFar', { pos, vol: 0.35 + Math.random() * 0.4, ref: 300, roll: 1, cheap: true, rev: 0.8, maxDist: 5000 });
    else {
      const n = 3 + ((Math.random() * 8) | 0), rate = 0.08 + Math.random() * 0.06;
      for (let k = 0; k < n; k++) this.play('gunFar', { pos, vol: 0.18 + Math.random() * 0.1, ref: 300, roll: 1, cheap: true, at: k * rate, rev: 0.7, maxDist: 5000 });
    }
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
}
