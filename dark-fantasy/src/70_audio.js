
// =====================================================================
// Audio — everything synthesised, nothing loaded
// =====================================================================
const AudioFX = {
  ctx: null, master: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC(); this.master = ctx.createGain(); this.master.gain.value = 0.75;
    const comp = ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 3.5, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir; const vg = ctx.createGain(); vg.gain.value = 0.4; this.verb.connect(vg); vg.connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // low drone: an open fifth that slowly beats against itself
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 2;
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.045; lp.connect(this.droneGain); this.droneGain.connect(this.master); this.droneGain.connect(this.verb);
    [36.7, 36.95, 55.0, 73.4].forEach(f => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.04; const lfg = ctx.createGain(); lfg.gain.value = 110; lfo.connect(lfg); lfg.connect(lp.frequency); lfo.start();
    // wind
    const ns = ctx.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 480; bp.Q.value = 0.9;
    const wg = ctx.createGain(); wg.gain.value = 0.055; ns.connect(bp); bp.connect(wg); wg.connect(this.master); ns.start();
    const wl = ctx.createOscillator(); wl.frequency.value = 0.07; const wlg = ctx.createGain(); wlg.gain.value = 320; wl.connect(wlg); wlg.connect(bp.frequency); wl.start();
    const wl2 = ctx.createOscillator(); wl2.frequency.value = 0.11; const wlg2 = ctx.createGain(); wlg2.gain.value = 0.035; wl2.connect(wlg2); wlg2.connect(wg.gain); wl2.start();
    // distant bell every so often
    setInterval(() => { if (Math.random() < 0.5) this.bell(); }, 19000);
  },
  noise(dur, f0, f1, vol, q = 1, type = 'bandpass', verb = 0.3, delay = 0) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.015, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); if (verb) { const vg = ctx.createGain(); vg.gain.value = verb; g.connect(vg); vg.connect(this.verb); }
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  tone(freq, dur, vol, type = 'sine', slide = 1, delay = 0, verb = 0.6) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); const vg = ctx.createGain(); vg.gain.value = verb; g.connect(vg); vg.connect(this.verb); o.start(t); o.stop(t + dur + 0.05);
  },
  swing(heavy) { heavy ? this.noise(0.6, 200, 1400, 0.35, 0.8) : this.noise(0.24, 700, 3400, 0.22, 1.6); },
  hit(heavy) { this.noise(0.18, 3000, 300, 0.45, 0.7); this.tone(heavy ? 90 : 160, 0.3, 0.3, 'square', 0.4); this.tone(heavy ? 600 : 1300, 0.5, 0.05, 'triangle', 0.8); },
  bone(big) { for (let i = 0; i < (big ? 7 : 3); i++) this.noise(0.05, R(1800, 4200), 900, 0.25, 6, 'bandpass', 0.2, i * R(0.02, 0.06)); if (big) this.noise(0.5, 600, 80, 0.3, 0.6, 'lowpass', 0.3); },
  rattle() { for (let i = 0; i < 4; i++) this.noise(0.04, R(2000, 3500), 1500, 0.08, 8, 'bandpass', 0.1, i * 0.05); },
  hiss() { this.noise(0.7, 5000, 2500, 0.08, 3, 'bandpass', 0.5); },
  wail() { this.tone(R(420, 560), 1.4, 0.05, 'sawtooth', 0.55); this.tone(R(640, 760), 1.2, 0.035, 'sawtooth', 0.6); this.noise(1.2, 3000, 900, 0.05, 4); },
  hurt() { this.tone(120, 0.35, 0.3, 'sawtooth', 0.5); this.noise(0.25, 1200, 150, 0.4, 0.7, 'lowpass'); },
  roll() { this.noise(0.38, 300, 1600, 0.16, 0.6); this.noise(0.2, 400, 80, 0.25, 0.7, 'lowpass', 0.1, 0.32); },
  step(heavy) { this.noise(heavy ? 0.25 : 0.07, heavy ? 300 : 900, heavy ? 50 : 200, heavy ? 0.35 : 0.06, 0.8, 'lowpass', heavy ? 0.4 : 0.05); },
  roar(death) { const b = death ? 70 : 90; this.tone(b, 2.2, 0.35, 'sawtooth', 0.6); this.tone(b * 1.5, 2.0, 0.18, 'sawtooth', 0.55); this.noise(2.2, 900, 120, 0.35, 0.8, 'lowpass', 0.8); },
  slam() { this.noise(1.6, 300, 30, 0.9, 0.5, 'lowpass', 0.8); this.tone(55, 1.2, 0.5, 'sine', 0.5); },
  ignite() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 2.6, 0.08, 'sine', 1, i * 0.13)); this.noise(1.2, 200, 1500, 0.22, 0.5, 'lowpass'); },
  bell() { [220, 220 * 2.76, 220 * 5.4].forEach((f, i) => this.tone(f * 0.5, 6, 0.03 / (i + 1), 'sine', 1, 0, 1.2)); },
  thunder(dist = 1) { this.noise(3.5, 400, 40, 0.6 * dist, 0.5, 'lowpass', 0.8); this.noise(2.5, 200, 30, 0.4 * dist, 0.5, 'lowpass', 0.8, 0.3); },
  win() { [196, 247, 294, 392, 494, 587].forEach((f, i) => this.tone(f, 5, 0.07, 'sine', 1, i * 0.25)); },
  drums: null,
  bossMusic(on) {
    if (!this.ctx) return;
    if (on && !this.drums) { let n = 0; this.drums = setInterval(() => { this.noise(0.5, 180, 40, n % 4 === 0 ? 0.5 : 0.25, 0.6, 'lowpass', 0.5); if (n % 8 === 6) this.noise(0.3, 160, 40, 0.3, 0.6, 'lowpass', 0.5, 0.18); if (n % 16 === 0) this.tone(73.4, 3, 0.12, 'sawtooth', 0.98); n++; }, 430); this.droneGain.gain.value = 0.07; }
    if (!on && this.drums) { clearInterval(this.drums); this.drums = null; this.droneGain.gain.value = 0.03; }
  },
};
