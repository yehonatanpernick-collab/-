// All sound is synthesised: a low drone bed, filtered noise for detonations, short tones for weapons.
export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.last = {}; }
  start() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // convolution "space" from decaying noise
    const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain).connect(this.master);
    this.fx = ctx.createGain(); this.fx.gain.value = 0.9;
    this.fx.connect(this.master); this.fx.connect(this.verb);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // drone: two detuned saws through a slowly breathing lowpass, plus a fifth
    const drone = ctx.createGain(); drone.gain.value = 0.0;
    drone.gain.linearRampToValueAtTime(0.11, ctx.currentTime + 6);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 2;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045;
    const lfoG = ctx.createGain(); lfoG.gain.value = 140; lfo.connect(lfoG).connect(lp.frequency); lfo.start();
    for (const [f, g] of [[43.65, 0.5], [43.9, 0.5], [65.4, 0.25], [87.3, 0.12]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = g; o.connect(og).connect(lp); o.start();
    }
    lp.connect(drone).connect(this.master); drone.connect(this.verb);
    this.drone = drone;
  }
  toggle() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.1);
    return this.muted;
  }
  _gate(key, gap) {
    const now = performance.now();
    if (this.last[key] && now - this.last[key] < gap) return false;
    this.last[key] = now; return true;
  }
  _att(dist) { return Math.max(0, Math.min(1, 140 / (dist + 40))) ; }

  shot(kind, dist) {
    if (!this.ctx || this.muted) return;
    const a = this._att(dist);
    if (a < 0.08) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (kind === 'bolt') {
      if (!this._gate('bolt', 45)) return;
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(1400 + Math.random() * 300, t); o.frequency.exponentialRampToValueAtTime(380, t + 0.07);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.035 * a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 1.2;
      o.connect(f).connect(g).connect(this.fx); o.start(t); o.stop(t + 0.1);
    } else if (kind === 'beam' || kind === 'battery') {
      if (!this._gate(kind, 70)) return;
      const big = kind === 'battery';
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(big ? 220 : 520, t); o.frequency.exponentialRampToValueAtTime(big ? 70 : 140, t + 0.3);
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.setValueAtTime(big ? 110 : 1040, t);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime((big ? 0.09 : 0.05) * a, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.3);
      o.connect(f); o2.connect(f); f.connect(g).connect(this.fx);
      o.start(t); o2.start(t); o.stop(t + 0.36); o2.stop(t + 0.36);
    } else if (kind === 'shell') {
      if (!this._gate('shell', 90)) return;
      this._thump(0.16 * a, 90, 0.35, 900);
    }
  }
  _thump(vol, f0, dur, cutoff) {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noise; n.playbackRate.value = 0.7 + Math.random() * 0.3;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(cutoff, t); lp.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(lp).connect(g).connect(this.fx); n.start(t, Math.random()); n.stop(t + dur + 0.05);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(28, t + dur);
    const og = ctx.createGain(); og.gain.setValueAtTime(vol * 1.4, t); og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og).connect(this.fx); o.start(t); o.stop(t + dur + 0.05);
  }
  boom(scale, dist) {
    if (!this.ctx || this.muted) return;
    const a = this._att(dist * 0.6);
    if (a < 0.05 || !this._gate('boom' + Math.round(scale), 60)) return;
    this._thump(Math.min(0.5, 0.12 * scale * a + 0.03), 70 + 40 / scale, 0.5 + scale * 0.45, 1400 + scale * 600);
  }
  ui(kind = 'tick') {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    const f = kind === 'deny' ? 140 : kind === 'confirm' ? 660 : 1180;
    o.frequency.setValueAtTime(f, t);
    if (kind === 'confirm') o.frequency.setValueAtTime(f * 1.5, t + 0.05);
    const g = ctx.createGain(); g.gain.setValueAtTime(kind === 'deny' ? 0.06 : 0.035, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'deny' ? 0.18 : 0.09));
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.2);
  }
  capture(good) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const notes = good ? [392, 523.25, 783.99] : [311.13, 233.08, 155.56];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); const s = t + i * 0.12;
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.07, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 1.2);
      o.connect(g); g.connect(this.master); g.connect(this.verb); o.start(s); o.stop(s + 1.3);
    });
  }
}
