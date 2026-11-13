// Procedural audio: engine, tyres, wind, one-shot effects.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.6;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);

    // noise buffer
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };

    // engine: detuned saws + square sub through a shaper and lowpass
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 3;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.5); }
    shaper.curve = curve;
    this.oscs = [];
    const mk = (type, mul, g) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = 50;
      const gg = ctx.createGain(); gg.gain.value = g;
      o.connect(gg); gg.connect(shaper); o.start();
      this.oscs.push({ o, mul });
    };
    mk('sawtooth', 1, 0.35); mk('sawtooth', 1.007, 0.3); mk('square', 0.5, 0.35); mk('triangle', 2, 0.15);
    // engine rumble noise
    const en = noise(); const enf = ctx.createBiquadFilter(); enf.type = 'bandpass'; enf.frequency.value = 180; enf.Q.value = 1;
    const eng = ctx.createGain(); eng.gain.value = 0.25; en.connect(enf); enf.connect(eng); eng.connect(shaper);
    this.engNoiseF = enf;
    shaper.connect(this.engFilter); this.engFilter.connect(this.engGain); this.engGain.connect(this.master);

    // tyre screech
    const tn = noise();
    this.tyreF = ctx.createBiquadFilter(); this.tyreF.type = 'bandpass'; this.tyreF.frequency.value = 1400; this.tyreF.Q.value = 6;
    this.tyreG = ctx.createGain(); this.tyreG.gain.value = 0;
    tn.connect(this.tyreF); this.tyreF.connect(this.tyreG); this.tyreG.connect(this.master);
    // gravel / sand roll
    const gn = noise();
    this.gravelF = ctx.createBiquadFilter(); this.gravelF.type = 'lowpass'; this.gravelF.frequency.value = 900;
    this.gravelG = ctx.createGain(); this.gravelG.gain.value = 0;
    gn.connect(this.gravelF); this.gravelF.connect(this.gravelG); this.gravelG.connect(this.master);
    // wind
    const wn = noise();
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 500; this.windF.Q.value = 0.6;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    wn.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
    // boost hiss
    const bn = noise();
    this.boostF = ctx.createBiquadFilter(); this.boostF.type = 'highpass'; this.boostF.frequency.value = 2500;
    this.boostG = ctx.createGain(); this.boostG.gain.value = 0;
    bn.connect(this.boostF); this.boostF.connect(this.boostG); this.boostG.connect(this.master);
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }
  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.05;
    const f = 42 + s.rpm * 150 + (s.boost ? 18 : 0);
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(f * mul, t, 0.03);
    this.engFilter.frequency.setTargetAtTime(380 + s.rpm * 1700 + s.throttle * 900, t, k);
    this.engNoiseF.frequency.setTargetAtTime(f * 2, t, k);
    this.engGain.gain.setTargetAtTime(s.paused ? 0 : 0.10 + s.throttle * 0.1 + s.rpm * 0.05, t, 0.08);
    this.tyreG.gain.setTargetAtTime(s.paused ? 0 : s.screech * (s.asphalt ? 0.22 : 0.06), t, k);
    this.tyreF.frequency.setTargetAtTime(s.asphalt ? 1300 + s.screech * 400 : 700, t, k);
    this.gravelG.gain.setTargetAtTime(s.paused ? 0 : (s.asphalt ? 0.02 : 0.11) * Math.min(1, s.speed / 20) * s.grounded + s.slide * 0.18 * (s.asphalt ? 0 : 1), t, k);
    this.windG.gain.setTargetAtTime(s.paused ? 0 : Math.min(0.3, s.speed * s.speed * 0.00012), t, k);
    this.windF.frequency.setTargetAtTime(300 + s.speed * 18, t, k);
    this.boostG.gain.setTargetAtTime(s.paused ? 0 : (s.boost ? 0.1 : 0), t, 0.06);
  }
  _env(node, peak, a, d) {
    const t = this.ctx.currentTime;
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  thump(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const g = ctx.createGain(); o.connect(g); g.connect(this.master);
    this._env(g, 0.5 * strength, 0.005, 0.3); o.start(t); o.stop(t + 0.4);
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g2 = ctx.createGain(); n.connect(f); f.connect(g2); g2.connect(this.master);
    this._env(g2, 0.35 * strength, 0.005, 0.25); n.start(t); n.stop(t + 0.35);
  }
  crash(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.playbackRate.value = 0.6;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7;
    const g = ctx.createGain(); n.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, 0.5 * strength, 0.003, 0.45); n.start(t); n.stop(t + 0.6);
    this.thump(strength * 0.8);
  }
  tone(freqs, dur = 0.12, type = 'sine', vol = 0.18, gap = 0.07) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    freqs.forEach((fr, i) => {
      const t = ctx.currentTime + i * gap;
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = fr;
      const g = ctx.createGain(); o.connect(g); g.connect(this.master);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    });
  }
  coin() { this.tone([988, 1319], 0.18, 'square', 0.07, 0.07); }
  checkpoint() { this.tone([660, 880, 1320], 0.22, 'triangle', 0.2, 0.08); }
  finish() { this.tone([523, 659, 784, 1047, 1319], 0.35, 'triangle', 0.22, 0.1); }
  bank() { this.tone([440, 660], 0.16, 'triangle', 0.14, 0.06); }
  trick() { this.tone([587, 740, 880, 1175], 0.2, 'square', 0.08, 0.05); }
  achievement() { this.tone([784, 988, 1175, 1568], 0.3, 'triangle', 0.2, 0.09); }
  boostSfx() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3500, t + 0.5);
    const g = ctx.createGain(); n.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, 0.35, 0.02, 0.6); n.start(t); n.stop(t + 0.7);
  }
  pop() { this.tone([300, 200], 0.08, 'square', 0.06, 0.03); }
}
