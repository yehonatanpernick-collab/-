// Fully synthesized car audio (no sound files): inline-6 engine, tyre squeal, wind, impacts, backfires.
export class CarAudio {
  constructor() { this.ctx = null; this.volume = 0.8; this.muted = false; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // noise buffer
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;

    // ---- engine ----
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.6); }
    shaper.curve = curve;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 2.5;
    this.engFilter.frequency.value = 800;
    const mix = ctx.createGain(); mix.gain.value = 0.45;
    this.oscs = [];
    const defs = [['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['sawtooth', 2, 0.18], ['triangle', 1.5, 0.22]];
    for (const [type, mul, g] of defs) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = 40;
      const gn = ctx.createGain(); gn.gain.value = g;
      o.connect(gn).connect(mix); o.start(); this.oscs.push([o, mul]);
    }
    // roughness: amplitude modulation at firing frequency
    this.am = ctx.createGain(); this.am.gain.value = 1;
    this.amOsc = ctx.createOscillator(); this.amOsc.type = 'sine'; this.amOsc.frequency.value = 30;
    const amDepth = ctx.createGain(); amDepth.gain.value = 0.35;
    this.amOsc.connect(amDepth).connect(this.am.gain); this.amOsc.start();
    // intake noise
    const intake = ctx.createBufferSource(); intake.buffer = nb; intake.loop = true;
    this.intakeFilter = ctx.createBiquadFilter(); this.intakeFilter.type = 'bandpass'; this.intakeFilter.Q.value = 0.8;
    this.intakeGain = ctx.createGain(); this.intakeGain.gain.value = 0;
    intake.connect(this.intakeFilter).connect(this.intakeGain).connect(this.engGain); intake.start();
    mix.connect(shaper).connect(this.am).connect(this.engFilter).connect(this.engGain).connect(this.master);

    // ---- tyre squeal ----
    const sq = ctx.createBufferSource(); sq.buffer = nb; sq.loop = true;
    this.sqFilter = ctx.createBiquadFilter(); this.sqFilter.type = 'bandpass'; this.sqFilter.frequency.value = 1100; this.sqFilter.Q.value = 9;
    const sqF2 = ctx.createBiquadFilter(); sqF2.type = 'bandpass'; sqF2.frequency.value = 2300; sqF2.Q.value = 6;
    this.sqGain = ctx.createGain(); this.sqGain.gain.value = 0;
    sq.connect(this.sqFilter).connect(this.sqGain);
    sq.connect(sqF2).connect(this.sqGain);
    const sqTone = ctx.createOscillator(); sqTone.type = 'triangle'; sqTone.frequency.value = 900;
    this.sqTone = sqTone;
    const sqToneG = ctx.createGain(); sqToneG.gain.value = 0.05;
    sqTone.connect(sqToneG).connect(this.sqGain); sqTone.start();
    this.sqGain.connect(this.master); sq.start();

    // ---- wind / road rumble ----
    const wn = ctx.createBufferSource(); wn.buffer = nb; wn.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    wn.connect(this.windFilter).connect(this.windGain).connect(this.master); wn.start();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume; }

  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = s.rpm, thr = s.throttle;
    const fire = rpm / 60 * 3; // inline six: 3 firings per revolution
    for (const [o, mul] of this.oscs) o.frequency.setTargetAtTime(fire * mul * 0.5, t, 0.02);
    this.amOsc.frequency.setTargetAtTime(fire * 0.5, t, 0.02);
    this.engFilter.frequency.setTargetAtTime(500 + rpm * 0.32 * (0.45 + thr * 0.75), t, 0.04);
    this.intakeFilter.frequency.setTargetAtTime(300 + rpm * 0.25, t, 0.05);
    this.intakeGain.gain.setTargetAtTime(0.05 + thr * 0.22, t, 0.05);
    const eg = s.active ? (0.22 + thr * 0.3 + (rpm / 7500) * 0.12) * (s.limiter ? 0.6 : 1) : 0;
    this.engGain.gain.setTargetAtTime(eg, t, 0.04);
    const slip = Math.min(1, s.slip);
    this.sqGain.gain.setTargetAtTime(s.active ? slip * slip * 0.32 : 0, t, 0.06);
    this.sqFilter.frequency.setTargetAtTime(900 + slip * 500 + Math.sin(t * 13) * 40, t, 0.05);
    this.sqTone.frequency.setTargetAtTime(820 + slip * 380 + Math.sin(t * 9) * 25, t, 0.05);
    const sp = Math.min(1, s.speed / 60);
    this.windGain.gain.setTargetAtTime(s.active ? sp * sp * 0.22 + (s.surfaceRough || 0) * 0.08 : 0, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + sp * 900, t, 0.1);
  }

  _burst(dur, freq, gain, type = 'lowpass', q = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  impact(strength) { this._burst(0.35 + strength * 0.3, 380 + strength * 300, Math.min(1.2, 0.25 + strength)); }
  backfire() {
    this._burst(0.12, 900, 0.9, 'lowpass');
    setTimeout(() => this._burst(0.08, 1400, 0.5, 'lowpass'), 60 + Math.random() * 60);
  }
  shift() { this._burst(0.09, 2200, 0.25, 'bandpass', 2); }
  cone() { this._burst(0.15, 1800, 0.35, 'bandpass', 3); }
  beep(freq = 880, dur = 0.15, vol = 0.25) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  chime() { this.beep(1320, 0.12, 0.18); setTimeout(() => this.beep(1760, 0.2, 0.18), 90); }
}
