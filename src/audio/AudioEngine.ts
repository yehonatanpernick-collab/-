/**
 * Procedural audio engine (Web Audio API) — no sample files required.
 * Vehicle: dual-motor EV whine + inverter harmonics, tyre roll & squeal, wind, hover turbines,
 * vectoring thrusters, transformation servos & latches, horn, impacts.
 * Environment: city bed with distant traffic & horns, ocean surf near the coast, rain, high-altitude wind.
 * Sounds react to speed, vehicle mode, camera (cockpit muffling), environment and weather.
 */
export interface AudioState {
  speed: number; throttle: number; slip: number; hover: number; thrust: number; flying: boolean;
  cockpit: boolean; altitude: number; city: number; coast: number; rain: number; boost: boolean;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private exterior!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private nodes: Record<string, { g: GainNode; f?: BiquadFilterNode; o?: OscillatorNode[] }> = {};
  volume = 0.8;
  private started = false;

  start(): void {
    if (this.started) { this.ctx?.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.started = true;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);
    this.exterior = ctx.createBiquadFilter(); this.exterior.type = 'lowpass'; this.exterior.frequency.value = 18000;
    this.exterior.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    // shared noise buffer (pink-ish)
    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    // motor: two detuned oscillators + whine
    this.osc('motor', ['sawtooth', 'triangle'], [60, 120], 'lowpass', 900, this.master);
    this.osc('whine', ['sine', 'sine'], [500, 1500], 'bandpass', 1200, this.master);
    this.noiseSrc('roll', 'lowpass', 500, this.exterior);
    this.noiseSrc('squeal', 'bandpass', 1300, this.exterior, 8);
    this.noiseSrc('wind', 'lowpass', 600, this.exterior);
    this.noiseSrc('turbine', 'bandpass', 380, this.exterior, 2);
    this.osc('turbineTone', ['sawtooth', 'sine'], [110, 1800], 'bandpass', 1600, this.exterior);
    this.noiseSrc('thruster', 'lowpass', 900, this.exterior);
    this.noiseSrc('city', 'lowpass', 380, this.exterior);
    this.noiseSrc('surf', 'lowpass', 700, this.exterior);
    this.noiseSrc('rain', 'highpass', 2500, this.master);
    // slow surf modulation
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    const surfMod = ctx.createGain(); surfMod.gain.value = 0.5;
    lfo.connect(lg).connect(surfMod.gain);
    lfo.start();
    this.nodes.surf.g.disconnect(); this.nodes.surf.g.connect(surfMod).connect(this.exterior);
  }

  private osc(name: string, types: OscillatorType[], freqs: number[], ft: BiquadFilterType, ff: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const g = ctx.createGain(); g.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = ft; f.frequency.value = ff; f.Q.value = 1.2;
    const o = types.map((t, i) => { const x = ctx.createOscillator(); x.type = t; x.frequency.value = freqs[i]; x.connect(f); x.start(); return x; });
    f.connect(g).connect(out);
    this.nodes[name] = { g, f, o };
  }

  private noiseSrc(name: string, ft: BiquadFilterType, ff: number, out: AudioNode, q = 0.7): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = ft; f.frequency.value = ff; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(f).connect(g).connect(out); s.start(0, Math.random() * 2);
    this.nodes[name] = { g, f };
  }

  private set(name: string, gain: number, freq?: number, oscF?: number[]): void {
    const n = this.nodes[name]; if (!n || !this.ctx) return;
    const t = this.ctx.currentTime;
    n.g.gain.setTargetAtTime(Math.max(0, gain), t, 0.08);
    if (freq !== undefined && n.f) n.f.frequency.setTargetAtTime(freq, t, 0.08);
    if (oscF && n.o) n.o.forEach((o, i) => o.frequency.setTargetAtTime(oscF[i], t, 0.06));
  }

  setVolume(v: number): void { this.volume = v; if (this.master) this.master.gain.value = v; }

  update(s: AudioState): void {
    if (!this.ctx) return;
    const v = Math.abs(s.speed);
    const drive = !s.flying;
    const load = 0.3 + s.throttle * 0.7;
    this.set('motor', drive ? (0.05 + Math.min(v, 60) / 60 * 0.09) * load : 0.02, 300 + v * 22, [40 + v * 3.2, 80 + v * 6.4]);
    this.set('whine', drive ? (0.012 + s.throttle * 0.025) * Math.min(1, v / 5) : 0.006, 600 + v * 40, [300 + v * 28, 900 + v * 84]);
    this.set('roll', drive ? Math.min(0.2, v / 160) : 0, 200 + v * 12);
    this.set('squeal', drive ? s.slip * 0.22 * Math.min(1, v / 8) : 0, 1100 + s.slip * 500);
    this.set('wind', Math.min(0.45, (v * v) / 9000) * (s.cockpit ? 0.45 : 1) + (s.altitude > 200 ? 0.05 : 0), 300 + v * 18);
    this.set('turbine', s.hover * 0.16, 300 + s.thrust * 500);
    this.set('turbineTone', s.hover * (0.025 + s.thrust * 0.04), 1400 + s.thrust * 1400, [90 + s.thrust * 60, 1700 + s.thrust * 900 + (s.boost ? 400 : 0)]);
    this.set('thruster', s.thrust * 0.22 * (s.boost ? 1.4 : 1), 500 + s.thrust * 1500);
    this.set('city', s.city * 0.12 * (s.cockpit ? 0.6 : 1) * Math.max(0, 1 - s.altitude / 250));
    this.set('surf', s.coast * 0.22 * Math.max(0, 1 - s.altitude / 200));
    this.set('rain', s.rain * (s.cockpit ? 0.18 : 0.12));
    this.exterior.frequency.setTargetAtTime(s.cockpit ? 2200 : 18000, this.ctx.currentTime, 0.2);
  }

  /** transformation: servo sweep + latch clunks */
  transform(toFlight: boolean): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 4;
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(f).connect(g).connect(this.sfx);
    o.frequency.setValueAtTime(toFlight ? 140 : 380, t);
    o.frequency.linearRampToValueAtTime(toFlight ? 420 : 120, t + 1.4);
    f.frequency.setValueAtTime(800, t); f.frequency.linearRampToValueAtTime(toFlight ? 2400 : 600, t + 1.4);
    g.gain.linearRampToValueAtTime(0.09, t + 0.1); g.gain.linearRampToValueAtTime(0.07, t + 1.2); g.gain.linearRampToValueAtTime(0, t + 1.5);
    o.start(t); o.stop(t + 1.6);
    for (const dt of [0.05, 0.75, 1.45]) this.clunk(t + dt, 0.25);
    if (toFlight) this.chime(t + 1.55, [660, 990]);
    else this.chime(t + 1.4, [880, 587]);
  }

  private clunk(t: number, vol: number): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    s.connect(f).connect(g).connect(this.sfx); s.start(t); s.stop(t + 0.2);
  }

  chime(t: number | null, freqs: number[], vol = 0.06): void {
    const ctx = this.ctx; if (!ctx) return;
    const t0 = t ?? ctx.currentTime;
    freqs.forEach((fr, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t0 + i * 0.12);
      g.gain.linearRampToValueAtTime(vol, t0 + i * 0.12 + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, t0 + i * 0.12 + 0.6);
      o.connect(g).connect(this.sfx); o.start(t0 + i * 0.12); o.stop(t0 + i * 0.12 + 0.65);
    });
  }

  horn(distance: number): void {
    const ctx = this.ctx; if (!ctx) return;
    const vol = Math.min(0.12, 6 / Math.max(distance, 4));
    const t = ctx.currentTime;
    for (const fr of [392, 494]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.4, t + 0.02); g.gain.setValueAtTime(vol * 0.4, t + 0.35); g.gain.linearRampToValueAtTime(0, t + 0.42);
      o.connect(f).connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.45);
    }
  }

  impact(strength: number): void {
    const ctx = this.ctx; if (!ctx) return;
    this.clunk(ctx.currentTime, 0.3 + strength * 0.7);
  }

  click(): void { this.chime(null, [1200], 0.03); }
}
