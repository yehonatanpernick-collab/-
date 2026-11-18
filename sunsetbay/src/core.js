import * as THREE from 'three';

/* =====================================================================
   CONFIG
   ===================================================================== */
export const CFG = {
  step: 1 / 60,
  walkSpeed: 1.55, jogSpeed: 3.6, runSpeed: 6.4, aimSpeed: 1.6, jumpV: 5.0, gravity: 20,
  playerHP: 100,
  heatThresholds: [0, 1, 3.5, 7, 12, 20],
  heatUnits: [0, 1, 2, 3, 5, 6],
  evadeTime: [0, 10, 14, 18, 24, 30],
  copShootFrom: 2, copAccuracy: 0.3,
  respawnFeePct: 0.08,
  moodSeconds: { day: 420, sunset: 200, night: 420 },
  stuntMinAir: 0.9,
};
export const QUALITY = {
  ultra: { dpr: 2, shadow: 4096, shadowR: 90, ao: true, bloom: true, smaa: true, peds: 30, traffic: 18, far: 1500, aniso: 16 },
  high: { dpr: 1.5, shadow: 2048, shadowR: 70, ao: true, bloom: true, smaa: true, peds: 24, traffic: 14, far: 1200, aniso: 8 },
  medium: { dpr: 1, shadow: 2048, shadowR: 55, ao: false, bloom: true, smaa: false, peds: 16, traffic: 10, far: 900, aniso: 4 },
  low: { dpr: 0.8, shadow: 0, shadowR: 0, ao: false, bloom: false, smaa: false, peds: 9, traffic: 7, far: 600, aniso: 2 },
};
/* =====================================================================
   UTILS
   ===================================================================== */
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
export const rndi = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
export const headingTo = (dx, dz) => Math.atan2(dx, dz);   // forward = (sin h, cos h)
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export let srand = mulberry32(1337);
export const setSeed = s => { srand = mulberry32(s); };
export const sr = (a = 0, b = 1) => a + srand() * (b - a);
export const sri = (a, b) => Math.floor(sr(a, b + 1));
export const spick = arr => arr[Math.floor(srand() * arr.length)];
export const fmtMoney = v => '$' + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const IS_TOUCH = (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
export const HEADLESS = navigator.webdriver === true;
export const $ = id => document.getElementById(id);
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { } },
};

/* =====================================================================
   AUDIO — fully procedural (WebAudio)
   ===================================================================== */
export const STATIONS = [
  { name: 'BAY FM 101.3', bpm: 102, style: 0, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], bass: [45, 41, 36, 43] },
  { name: 'NIGHT CRUISE 94.7', bpm: 84, style: 1, chords: [[50, 53, 57, 60], [46, 50, 53, 57], [53, 57, 60, 64], [48, 52, 55, 59]], bass: [38, 34, 41, 36] },
];
export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
class Sound {
  constructor() { this.ok = false; this.on = store.get('sb-sound', 1) === 1; this.station = 0; this.radioWanted = false; this.musicLevel = 0; }
  init() {
    if (this.ok) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.on ? 0.8 : 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // engine
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engF = ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 600; this.engF.Q.value = 3;
    this.eo1 = ctx.createOscillator(); this.eo1.type = 'sawtooth'; this.eo1.frequency.value = 50;
    this.eo2 = ctx.createOscillator(); this.eo2.type = 'square'; this.eo2.frequency.value = 25;
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    this.eo1.connect(this.engF); this.eo2.connect(g2); g2.connect(this.engF); this.engF.connect(this.engGain); this.engGain.connect(this.master);
    this.eo1.start(); this.eo2.start();
    // skid
    this.skidG = ctx.createGain(); this.skidG.gain.value = 0;
    const sk = ctx.createBufferSource(); sk.buffer = buf; sk.loop = true;
    const skf = ctx.createBiquadFilter(); skf.type = 'bandpass'; skf.frequency.value = 2200; skf.Q.value = 2.5;
    sk.connect(skf); skf.connect(this.skidG); this.skidG.connect(this.master); sk.start();
    // siren
    this.sirG = ctx.createGain(); this.sirG.gain.value = 0;
    this.sirO = ctx.createOscillator(); this.sirO.type = 'square'; this.sirO.frequency.value = 820;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.55; const lg = ctx.createGain(); lg.gain.value = 330;
    lfo.connect(lg); lg.connect(this.sirO.frequency);
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1800;
    this.sirO.connect(sf); sf.connect(this.sirG); this.sirG.connect(this.master); this.sirO.start(); lfo.start();
    // ambience (city hum + surf)
    const amb = ctx.createBufferSource(); amb.buffer = buf; amb.loop = true;
    const af = ctx.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 380;
    this.ambG = ctx.createGain(); this.ambG.gain.value = 0.05;
    amb.connect(af); af.connect(this.ambG); this.ambG.connect(this.master); amb.start();
    // music bus with delay
    this.music = ctx.createGain(); this.music.gain.value = 0;
    this.music.connect(this.master);
    this.dly = ctx.createDelay(1); this.dly.delayTime.value = 60 / STATIONS[0].bpm * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.32; const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 2400;
    this.dly.connect(df); df.connect(fb); fb.connect(this.dly); df.connect(this.music);
    this.ok = true;
    this.nextNote = ctx.currentTime + 0.1; this.stepI = 0;
    this.timer = setInterval(() => this.schedule(), 30);
  }
  async loadSamples(base) {
    if (!this.ok) return;
    const names = { pistol: 'pistol', smg: 'smg', shotgun: 'shotgun', rifle: 'rifle', ak: 'ak', stepL1: 'step_L1', stepR1: 'step_R1', stepL2: 'step_L2', stepR2: 'step_R2' };
    this.buf = this.buf || {};
    await Promise.all(Object.entries(names).map(async ([k, f]) => { try { const r = await fetch(base + f + '.mp3'); this.buf[k] = await this.ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { } }));
  }
  sample(name, vol = 1, rate = 1, dist = 0, pan = 0) {
    if (!this.ok || !this.buf || !this.buf[name]) return false;
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.buf[name]; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = vol / (1 + dist * 0.04);
    let node = g;
    if (dist > 25) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.max(700, 9000 - dist * 45); g.connect(f); node = f; }
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); p.connect(this.master); } else node.connect(this.master);
    s.connect(g); s.start(); return true;
  }
  step(dist = 0, vol = 0.35) { if (!this.ok) return; this.si = ((this.si || 0) + 1) % 4; this.sample(['stepL1', 'stepR1', 'stepL2', 'stepR2'][this.si], vol * rnd(0.8, 1), rnd(0.9, 1.1), dist); }
  setOn(v) { this.on = v; store.set('sb-sound', v ? 1 : 0); if (this.ok) this.master.gain.setTargetAtTime(v ? 0.8 : 0, this.ctx.currentTime, 0.05); }
  t() { return this.ctx.currentTime; }
  setEngine(on, rpm, load) {
    if (!this.ok || !isFinite(rpm) || !isFinite(load)) return; const t = this.t();
    const f = 34 + rpm * 135;
    this.eo1.frequency.setTargetAtTime(f, t, 0.05); this.eo2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engF.frequency.setTargetAtTime(300 + rpm * 1900 + load * 700, t, 0.08);
    this.engGain.gain.setTargetAtTime(on ? 0.06 + 0.07 * load + 0.03 * rpm : 0, t, 0.08);
  }
  setSkid(v) { if (!isFinite(v)) v = 0; if (this.ok) this.skidG.gain.setTargetAtTime(clamp(v, 0, 1) * 0.16, this.t(), 0.05); }
  setSiren(v) { if (!isFinite(v)) v = 0; if (this.ok) this.sirG.gain.setTargetAtTime(clamp(v, 0, 1) * 0.07, this.t(), 0.1); }
  setAmb(v) { if (this.ok) this.ambG.gain.setTargetAtTime(v, this.t(), 0.5); }
  setRadio(inCar) {
    if (!this.ok) return; const want = inCar && this.radioWanted ? 0.42 : 0;
    this.music.gain.setTargetAtTime(want, this.t(), 0.4);
  }
  cycleStation() {
    if (!this.radioWanted) { this.radioWanted = true; this.station = 0; }
    else if (this.station < STATIONS.length - 1) this.station++;
    else this.radioWanted = false;
    if (this.ok) this.dly.delayTime.value = 60 / STATIONS[this.station].bpm * 0.75;
    return this.radioWanted ? STATIONS[this.station].name : null;
  }
  // generic one-shots
  noiseHit(dur, ftype, f0, f1, gain, q = 1, when = 0, dest = null) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rnd(0.9, 1.1);
    const f = ctx.createBiquadFilter(); f.type = ftype; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.master); s.start(t, rnd(0, 1.5)); s.stop(t + dur + 0.05);
  }
  tone(type, f0, f1, dur, gain, when = 0, dest = null, attack = 0.002) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest || this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  shot(kind, d = 0, pan = 0) {
    if (!this.ok) return; const v = 1 / (1 + d * 0.045);
    const map = { pistol: 'pistol', smg: 'smg', shotgun: 'shotgun', rifle: 'rifle', cop: 'pistol', gang: 'ak' };
    if (this.sample(map[kind] || 'pistol', kind === 'shotgun' ? 1.0 : 0.85, rnd(0.94, 1.06), d, pan)) { if (d < 30) this.tone('sine', 90, 40, 0.12, 0.25 * v); return; }
    if (kind === 'shotgun') { this.noiseHit(0.45, 'lowpass', 3000, 160, 0.9 * v); this.tone('sine', 110, 40, 0.25, 0.6 * v); }
    else if (kind === 'smg') { this.noiseHit(0.11, 'bandpass', 2600, 500, 0.55 * v, 0.8); this.tone('square', 160, 60, 0.05, 0.18 * v); }
    else { this.noiseHit(0.22, 'bandpass', 2200, 300, 0.75 * v, 0.7); this.tone('triangle', 180, 50, 0.1, 0.35 * v); }
  }
  explosion(d = 0) { if (!this.ok) return; const v = 1 / (1 + d * 0.02); this.noiseHit(1.8, 'lowpass', 1400, 40, 1.3 * v); this.tone('sine', 70, 28, 0.9, 0.9 * v); }
  impact(s, d = 0) { if (!this.ok) return; const v = clamp(s, 0, 1) / (1 + d * 0.05); this.noiseHit(0.25, 'lowpass', 900, 120, 0.9 * v); this.tone('square', 90, 40, 0.12, 0.25 * v); }
  punch() { if (this.ok) { this.noiseHit(0.09, 'lowpass', 900, 200, 0.6); this.tone('sine', 120, 50, 0.08, 0.4); } }
  thud() { if (this.ok) this.noiseHit(0.18, 'lowpass', 500, 80, 0.5); }
  horn() { if (!this.ok) return; this.tone('square', 392, 392, 0.45, 0.07, 0, null, 0.01); this.tone('square', 494, 494, 0.45, 0.06, 0, null, 0.01); }
  pickup() { if (this.ok) { this.tone('sine', 660, 1320, 0.16, 0.18); this.tone('sine', 990, 1980, 0.2, 0.1, 0.06); } }
  ui() { if (this.ok) this.tone('triangle', 880, 660, 0.08, 0.12); }
  reload() { if (this.ok) { this.noiseHit(0.05, 'highpass', 3000, 2000, 0.3); this.noiseHit(0.06, 'highpass', 2500, 1800, 0.3, 1, 0.35); } }
  door() { if (this.ok) { this.noiseHit(0.12, 'lowpass', 700, 150, 0.5); this.tone('sine', 140, 80, 0.1, 0.2); } }
  jingle(good) {
    if (!this.ok) return; const notes = good ? [72, 76, 79, 84] : [64, 60, 57, 52];
    notes.forEach((n, i) => { this.tone('triangle', mtof(n), mtof(n), 0.5, 0.16, i * 0.13); this.tone('sine', mtof(n - 12), mtof(n - 12), 0.6, 0.1, i * 0.13); });
  }
  // ---- radio sequencer
  schedule() {
    if (!this.ok || !this.radioWanted) { if (this.ok) this.nextNote = this.ctx.currentTime + 0.05; return; }
    const st = STATIONS[this.station], spb = 60 / st.bpm / 4;
    while (this.nextNote < this.ctx.currentTime + 0.15) { this.playStep(st, this.stepI, this.nextNote - this.ctx.currentTime, spb); this.nextNote += spb; this.stepI = (this.stepI + 1) % 64; }
  }
  playStep(st, i, w, spb) {
    const bar = Math.floor(i / 16) % 4, s = i % 16, ch = st.chords[bar], M = this.music;
    if (st.style === 0) {
      if (s % 4 === 0) this.tone('sine', 150, 42, 0.32, 0.9, w, M);
      if (s === 4 || s === 12) { this.noiseHit(0.2, 'highpass', 1800, 900, 0.45, 0.8, w, M); this.tone('triangle', 190, 140, 0.1, 0.25, w, M); }
      if (s % 2 === 0) this.noiseHit(0.04, 'highpass', 8000, 6000, s % 4 === 2 ? 0.2 : 0.09, 1, w, M);
      if (s % 2 === 0) this.tone('sawtooth', mtof(st.bass[bar] + (s % 4 === 2 ? 12 : 0)), mtof(st.bass[bar] + (s % 4 === 2 ? 12 : 0)), spb * 1.6, 0.16, w, M);
      const arp = [0, 1, 2, 1][s % 4]; const n = ch[arp] + 12 + (s >= 8 ? 12 : 0);
      this.tone('square', mtof(n), mtof(n), spb * 0.9, 0.035, w, this.dly); this.tone('square', mtof(n), mtof(n), spb * 0.9, 0.04, w, M);
      if (s === 0) ch.forEach(n => { this.tone('sawtooth', mtof(n), mtof(n), spb * 15, 0.035, w, M, 0.25); this.tone('sawtooth', mtof(n) * 1.006, mtof(n) * 1.006, spb * 15, 0.03, w, M, 0.25); });
    } else {
      if (s === 0 || s === 10) this.tone('sine', 120, 40, 0.4, 0.8, w, M);
      if (s === 4 || s === 12) this.noiseHit(0.14, 'bandpass', 2400, 1500, 0.3, 2, w, M);
      this.noiseHit(0.03, 'highpass', 9000, 7000, s % 2 ? 0.05 : 0.1, 1, w, M);
      if (s === 0 || s === 6 || s === 10) this.tone('triangle', mtof(st.bass[bar]), mtof(st.bass[bar]), spb * 5, 0.32, w, M);
      if (s % 3 === 0) { const n = ch[(s / 3) % ch.length] + 24; this.tone('sine', mtof(n), mtof(n), spb * 3, 0.06, w, this.dly); this.tone('triangle', mtof(n), mtof(n), spb * 2, 0.04, w, M); }
      if (s === 0) ch.forEach(n => this.tone('sine', mtof(n + 12), mtof(n + 12), spb * 16, 0.05, w, M, 0.6));
    }
  }
}
export const sound = new Sound();

