// All sounds are synthesized with WebAudio (no external files).
export class Audio {
  constructor() { this.ctx = null; this.enabled = true; this.excite = 0.2; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    // reverb (arena)
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.4, 2.2);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.28;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    this.noiseBuf = this.makeNoise(2);
    this.startCrowd();
  }
  makeNoise(sec) {
    const ctx = this.ctx, b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  impulse(sec, decay) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  out(node, wet = 0.3) {
    node.connect(this.master);
    if (wet > 0) { const g = this.ctx.createGain(); g.gain.value = wet; node.connect(g); g.connect(this.verb); }
  }
  noise(t, dur, f0, f1, q, gain, type = 'bandpass', wet = 0.25) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); this.out(g, wet);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }
  tone(t, dur, f0, f1, gain, type = 'sine', wet = 0.2) {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); this.out(g, wet); o.start(t); o.stop(t + dur + 0.05);
  }
  play(name, v = 1) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + 0.005;
    switch (name) {
      case 'hit': // glove on face
        this.noise(t, 0.09, 2600, 500, 0.8, 0.7 * v, 'bandpass', 0.35);
        this.tone(t, 0.16, 120 + Math.random() * 20, 45, 0.9 * v, 'sine', 0.2);
        this.noise(t, 0.035, 6000, 3000, 0.5, 0.3 * v, 'highpass', 0.1);
        break;
      case 'heavy':
        this.noise(t, 0.14, 1800, 300, 0.7, 0.9 * v, 'bandpass', 0.45);
        this.tone(t, 0.28, 95, 32, 1.2 * v, 'sine', 0.3);
        this.noise(t, 0.05, 5000, 2500, 0.6, 0.35 * v, 'highpass', 0.2);
        break;
      case 'body':
        this.noise(t, 0.12, 900, 200, 0.9, 0.8 * v, 'bandpass', 0.3);
        this.tone(t, 0.22, 80, 38, 1.1 * v, 'sine', 0.2);
        break;
      case 'kick':
        this.noise(t, 0.08, 3800, 1200, 0.7, 0.8 * v, 'bandpass', 0.4);
        this.tone(t, 0.2, 140, 50, 0.9 * v, 'triangle', 0.25);
        break;
      case 'block':
        this.noise(t, 0.07, 700, 300, 1.2, 0.55 * v, 'bandpass', 0.25);
        this.tone(t, 0.1, 160, 90, 0.35 * v, 'sine', 0.1);
        break;
      case 'whoosh':
        this.noise(t, 0.18, 500, 2400, 2.5, 0.12 * v, 'bandpass', 0.05);
        break;
      case 'bell': {
        for (let k = 0; k < (v > 1 ? v : 1); k++) {
          const tt = t + k * 0.32;
          [1, 2.32, 3.86, 5.4, 6.8].forEach((r, i) => this.tone(tt, 2.4 - i * 0.3, 760 * r, 760 * r * 0.995, 0.25 / (i + 1), 'sine', 0.4));
        }
        break;
      }
      case 'clap': this.noise(t, 0.05, 1600, 1200, 1.5, 0.5 * v, 'bandpass', 0.5); break;
      case 'step': this.noise(t, 0.05, 300, 120, 1, 0.08 * v, 'lowpass', 0.05); break;
      case 'thud': // body hits canvas
        this.tone(t, 0.45, 70, 28, 1.4 * v, 'sine', 0.4); this.noise(t, 0.3, 400, 80, 0.8, 1.0 * v, 'lowpass', 0.5); break;
      case 'ui': this.tone(t, 0.06, 1400, 1200, 0.12, 'square', 0.0); break;
      case 'uiok': this.tone(t, 0.09, 900, 1500, 0.15, 'square', 0.0); break;
    }
  }
  // ---- crowd bed
  startCrowd() {
    const ctx = this.ctx;
    const mk = (f, q, g0) => {
      const src = ctx.createBufferSource(); src.buffer = this.makeNoise(4); src.loop = true;
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = f; f1.Q.value = q;
      const g = ctx.createGain(); g.gain.value = g0;
      src.connect(f1); f1.connect(g); g.connect(this.master); const w = ctx.createGain(); w.gain.value = 0.5; g.connect(w); w.connect(this.verb);
      src.start(); return { g, f: f1 };
    };
    this.crowdLow = mk(380, 0.7, 0.05);
    this.crowdMid = mk(1100, 0.9, 0.025);
    this.crowdHi = mk(2400, 1.2, 0.0);
  }
  setExcitement(v) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.crowdLow.g.gain.setTargetAtTime(0.05 + v * 0.12, t, 0.4);
    this.crowdMid.g.gain.setTargetAtTime(0.02 + v * 0.1, t, 0.4);
    this.crowdHi.g.gain.setTargetAtTime(v * v * 0.06, t, 0.3);
    this.crowdMid.f.frequency.setTargetAtTime(900 + v * 700, t, 0.5);
  }
  ooh(v = 1) { // crowd reaction swell
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(900, t + 0.35); f.frequency.linearRampToValueAtTime(650, t + 1.4);
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 2; f2.frequency.value = 1300;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35 * v, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    src.connect(f); f.connect(g); src.connect(f2); f2.connect(g);
    g.connect(this.master); const w = ctx.createGain(); w.gain.value = 0.8; g.connect(w); w.connect(this.verb);
    src.start(t); src.stop(t + 2);
  }
  roar(v = 1, dur = 3) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [fr, q, gg] of [[600, 0.8, 0.4], [1500, 1, 0.3], [3000, 1.5, 0.12]]) {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fr; f.Q.value = q;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gg * v, t + 0.4); g.gain.setValueAtTime(gg * v, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master); const w = ctx.createGain(); w.gain.value = 0.7; g.connect(w); w.connect(this.verb);
      src.start(t); src.stop(t + dur + 0.1);
    }
  }
}
