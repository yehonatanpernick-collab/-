// Audio engine. Every sound in the game is an original, procedurally synthesised
// asset rendered into AudioBuffers at start-up (no third-party audio files).
// Playback is spatial: equal-power panning, inverse distance attenuation, speed-of-
// sound delay, distance / occlusion low-pass and an interior reverb send.
import { WEAPONS } from '@shared/weapons';

type V3 = { x: number; y: number; z: number };
export interface PlayOpts { pos?: V3; volume?: number; pitch?: number; delay?: number; ref?: number }

const TAU = Math.PI * 2;

/** Tiny DSP toolbox operating on Float32Array sample buffers. */
class Synth {
  constructor(readonly sr: number) {}
  buf(seconds: number): Float32Array { return new Float32Array(Math.max(1, Math.floor(seconds * this.sr))); }
  noise(out: Float32Array, gain: number, decay: number, start = 0, attack = 0.001): void {
    const s0 = Math.floor(start * this.sr);
    for (let i = s0; i < out.length; i++) {
      const t = (i - s0) / this.sr;
      out[i] += (Math.random() * 2 - 1) * gain * Math.min(1, t / attack) * Math.exp(-t / decay);
    }
  }
  /** Sine sweep f0 → f1 with exponential amplitude decay. */
  sweep(out: Float32Array, f0: number, f1: number, gain: number, decay: number, start = 0, shape = 1): void {
    const s0 = Math.floor(start * this.sr);
    let ph = 0;
    for (let i = s0; i < out.length; i++) {
      const t = (i - s0) / this.sr;
      const f = f1 + (f0 - f1) * Math.exp(-t / (decay * 0.5));
      ph += (f / this.sr) * TAU;
      const s = Math.sin(ph);
      out[i] += (shape === 1 ? s : Math.tanh(s * shape)) * gain * Math.exp(-t / decay);
    }
  }
  tone(out: Float32Array, f: number, gain: number, decay: number, start = 0, type: 'sine' | 'tri' | 'saw' = 'sine'): void {
    const s0 = Math.floor(start * this.sr);
    for (let i = s0; i < out.length; i++) {
      const t = (i - s0) / this.sr, ph = (t * f) % 1;
      const s = type === 'sine' ? Math.sin(ph * TAU) : type === 'tri' ? 1 - 4 * Math.abs(ph - 0.5) : ph * 2 - 1;
      out[i] += s * gain * Math.min(1, t / 0.004) * Math.exp(-t / decay);
    }
  }
  lowpass(buf: Float32Array, fc: number): Float32Array {
    const a = 1 - Math.exp((-TAU * fc) / this.sr);
    let y = 0;
    for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; }
    return buf;
  }
  highpass(buf: Float32Array, fc: number): Float32Array {
    const a = 1 - Math.exp((-TAU * fc) / this.sr);
    let y = 0;
    for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] -= y; }
    return buf;
  }
  mix(dst: Float32Array, src: Float32Array, gain = 1, start = 0): void {
    const s0 = Math.floor(start * this.sr);
    for (let i = 0; i < src.length && s0 + i < dst.length; i++) dst[s0 + i] += src[i] * gain;
  }
  normalize(buf: Float32Array, peak = 0.9): Float32Array {
    let m = 0;
    for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
    if (m > 0) { const k = peak / m; for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * k * 1.15) / Math.tanh(1.15) * peak; }
    // short fade out to avoid clicks
    const n = Math.min(buf.length, Math.floor(this.sr * 0.01));
    for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n;
    return buf;
  }
}

interface GunTone { f0: number; f1: number; body: number; crack: number; tail: number; lp: number; dur: number; echo: number }
const GUN_TONES: Record<string, GunTone> = {
  ar: { f0: 190, f1: 58, body: 0.9, crack: 1.0, tail: 0.2, lp: 3000, dur: 0.6, echo: 0.22 },
  carbine: { f0: 220, f1: 70, body: 0.8, crack: 1.0, tail: 0.16, lp: 3600, dur: 0.5, echo: 0.18 },
  smg: { f0: 250, f1: 95, body: 0.6, crack: 0.9, tail: 0.11, lp: 4200, dur: 0.38, echo: 0.12 },
  lmg: { f0: 140, f1: 42, body: 1.1, crack: 0.9, tail: 0.27, lp: 2200, dur: 0.7, echo: 0.26 },
  sniper: { f0: 120, f1: 30, body: 1.3, crack: 1.1, tail: 0.55, lp: 1700, dur: 1.5, echo: 0.42 },
  pistol: { f0: 280, f1: 110, body: 0.6, crack: 0.9, tail: 0.1, lp: 3400, dur: 0.36, echo: 0.1 },
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private reverbSend!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private lx = 0; private ly = 0; private lz = 0;
  private interior = false;
  private voices = 0;
  private ambient: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private ambientT = 4;
  private engines = new Map<number, { src: AudioBufferSourceNode; gain: GainNode; pan: PannerNode }>();
  private musicNodes: { stop: () => void } | null = null;
  private vol = { master: 0.8, sfx: 1, music: 0.5 };
  /** Returns true when the straight line from the listener to a point is blocked by level geometry. */
  occluded: (x: number, y: number, z: number) => boolean = () => false;

  get ready(): boolean { return this.ctx !== null && this.ctx.state === 'running'; }

  /** Must be called from a user gesture (browser autoplay policy). */
  async resume(): Promise<void> {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch { /* still locked */ } }
  }

  setVolumes(master: number, sfx: number, music: number): void {
    this.vol = { master, sfx, music };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(master, t, 0.05);
    this.sfx.gain.setTargetAtTime(sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(music, t, 0.05);
  }

  private init(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.18;
    this.master = ctx.createGain(); this.master.gain.value = this.vol.master;
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.vol.sfx;
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.vol.music;
    this.sfx.connect(this.master); this.musicBus.connect(this.master);
    this.master.connect(comp); comp.connect(ctx.destination);
    // generated impulse response for the interior reverb
    const sr = ctx.sampleRate, len = Math.floor(sr * 1.6);
    const ir = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) { const t = i / sr; d[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.33) * (t < 0.012 ? t / 0.012 : 1); }
    }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.06;
    this.reverbSend.connect(conv); conv.connect(this.sfx);
    this.build(new Synth(sr));
  }

  private add(name: string, data: Float32Array): void {
    if (!this.ctx) return;
    const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    b.getChannelData(0).set(data);
    this.buffers.set(name, b);
  }

  // ------------------------------------------------------------------ sound design
  private build(s: Synth): void {
    // --- gunshots: transient crack + pitched body thump + filtered noise tail + early echo
    for (const [cls, g] of Object.entries(GUN_TONES)) {
      const out = s.buf(g.dur);
      const crack = s.buf(0.03); s.noise(crack, g.crack, 0.004); s.highpass(crack, 1800);
      s.mix(out, crack);
      s.sweep(out, g.f0, g.f1, g.body, 0.05, 0, 2.2);
      const tail = s.buf(g.dur); s.noise(tail, 0.75, g.tail, 0.002); s.lowpass(tail, g.lp); s.highpass(tail, 90);
      s.mix(out, tail);
      const echo = s.buf(g.dur * 0.6); s.noise(echo, 0.3, g.tail * 1.4); s.lowpass(echo, g.lp * 0.4);
      s.mix(out, echo, g.echo * 1.6, 0.085);
      const mech = s.buf(0.02); s.tone(mech, 2400, 0.14, 0.004); s.mix(out, mech, 1, 0.012);
      this.add(`gun_${cls}`, s.normalize(out, 0.92));
    }
    { // suppressed shot
      const out = s.buf(0.22);
      const n = s.buf(0.22); s.noise(n, 1, 0.03); s.lowpass(n, 2600); s.highpass(n, 500); s.mix(out, n);
      s.sweep(out, 420, 160, 0.4, 0.025);
      const mech = s.buf(0.03); s.tone(mech, 3100, 0.3, 0.006); s.mix(out, mech, 1, 0.01);
      this.add('gun_sup', s.normalize(out, 0.6));
    }
    // --- weapon handling
    const click = (f: number, d: number, g = 0.6): Float32Array => { const o = s.buf(d + 0.03); s.noise(o, g, d * 0.35); s.highpass(o, 900); s.tone(o, f, g * 0.6, d * 0.5); return o; };
    { const o = s.buf(0.16); s.mix(o, click(1400, 0.03)); const sl = s.buf(0.12); s.noise(sl, 0.25, 0.05); s.lowpass(sl, 1800); s.mix(o, sl, 1, 0.02); this.add('mag_out', s.normalize(o, 0.55)); }
    { const o = s.buf(0.16); const th = s.buf(0.1); s.sweep(th, 260, 120, 0.7, 0.03); s.mix(o, th); s.mix(o, click(1900, 0.025, 0.5), 1, 0.012); this.add('mag_in', s.normalize(o, 0.6)); }
    { const o = s.buf(0.24); s.mix(o, click(1700, 0.03)); s.mix(o, click(2300, 0.03, 0.7), 1, 0.11); this.add('bolt', s.normalize(o, 0.6)); }
    { const o = s.buf(0.06); s.mix(o, click(2600, 0.02, 0.5)); this.add('dry', s.normalize(o, 0.45)); }
    { const o = s.buf(0.2); const n = s.buf(0.2); s.noise(n, 0.4, 0.06, 0, 0.03); s.lowpass(n, 1500); s.mix(o, n); s.mix(o, click(1500, 0.02, 0.35), 1, 0.1); this.add('switch', s.normalize(o, 0.4)); }
    { const o = s.buf(0.3); const n = s.buf(0.3); s.noise(n, 0.7, 0.09, 0, 0.06); s.lowpass(n, 2400); s.highpass(n, 300); s.mix(o, n); this.add('throw', s.normalize(o, 0.5)); }
    // --- footsteps per surface
    const step = (name: string, lp: number, thump: number, ring = 0): void => {
      for (let v = 0; v < 3; v++) {
        const o = s.buf(0.16);
        const n = s.buf(0.16); s.noise(n, 0.9, 0.018 + v * 0.004); s.lowpass(n, lp * (0.85 + v * 0.15)); s.mix(o, n);
        s.sweep(o, thump * (1 + v * 0.08), thump * 0.5, 0.6, 0.03);
        if (ring) s.tone(o, ring * (1 + v * 0.07), 0.16, 0.05);
        this.add(`step_${name}${v}`, s.normalize(o, 0.5));
      }
    };
    step('concrete', 1400, 110); step('asphalt', 1100, 95); step('metal', 2600, 150, 640); step('wood', 900, 170, 210); step('dirt', 600, 80); step('tile', 2000, 130); step('brick', 1400, 110); step('fabric', 500, 80); step('glass', 3000, 140, 1800);
    { const o = s.buf(0.2); const n = s.buf(0.2); s.noise(n, 0.5, 0.05, 0, 0.02); s.lowpass(n, 900); s.mix(o, n); this.add('jump', s.normalize(o, 0.35)); }
    // --- impacts
    const imp = (name: string, lp: number, hp: number, ring = 0, d = 0.05): void => {
      for (let v = 0; v < 2; v++) {
        const o = s.buf(0.22);
        const n = s.buf(0.22); s.noise(n, 1, d * (1 + v * 0.3)); s.lowpass(n, lp); s.highpass(n, hp); s.mix(o, n);
        if (ring) { s.tone(o, ring * (1 + v * 0.21), 0.5, 0.06); s.tone(o, ring * 2.31, 0.2, 0.03); }
        this.add(`imp_${name}${v}`, s.normalize(o, 0.6));
      }
    };
    imp('concrete', 5000, 700); imp('asphalt', 4000, 500); imp('brick', 4500, 600); imp('metal', 8000, 1500, 1900, 0.03); imp('wood', 1800, 200, 320); imp('dirt', 1200, 150); imp('glass', 9000, 3000, 4200, 0.02); imp('tile', 6000, 900, 2600); imp('fabric', 900, 120);
    { const o = s.buf(0.18); const n = s.buf(0.18); s.noise(n, 1, 0.05, 0, 0.03); s.highpass(n, 900); s.lowpass(n, 5200); s.mix(o, n); s.sweep(o, 3200, 900, 0.25, 0.08); this.add('whiz', s.normalize(o, 0.6)); }
    // --- explosions
    for (const [name, big] of [['boom', 1], ['boom_big', 1.5]] as const) {
      const o = s.buf(2.2 * big);
      const crack = s.buf(0.06); s.noise(crack, 1, 0.012); s.mix(o, crack);
      s.sweep(o, 95 / big, 24, 1.4, 0.38 * big, 0, 2.5);
      const body = s.buf(2.0 * big); s.noise(body, 1, 0.45 * big, 0.004); s.lowpass(body, 900); s.mix(o, body);
      const deb = s.buf(1.6 * big); s.noise(deb, 0.35, 0.5 * big, 0.12, 0.2); s.highpass(deb, 1500); s.lowpass(deb, 6000); s.mix(o, deb);
      this.add(name, s.normalize(o, 0.95));
    }
    { const o = s.buf(1.2); const n = s.buf(1.2); s.noise(n, 1, 0.5, 0, 0.08); s.highpass(n, 2500); s.mix(o, n); this.add('hiss', s.normalize(o, 0.4)); }
    { const o = s.buf(0.9); const n = s.buf(0.9); s.noise(n, 1, 0.3, 0, 0.02); s.lowpass(n, 2600); s.highpass(n, 250); s.mix(o, n); s.sweep(o, 300, 60, 0.7, 0.2, 0, 2); this.add('rocket', s.normalize(o, 0.85)); }
    { const o = s.buf(0.7); for (let i = 0; i < 9; i++) { const c = s.buf(0.25); s.noise(c, 0.5, 0.02 + Math.random() * 0.04); s.highpass(c, 3500); s.tone(c, 3000 + Math.random() * 5000, 0.3, 0.05); s.mix(o, c, 1, Math.random() * 0.35); } this.add('glass', s.normalize(o, 0.7)); }
    { const o = s.buf(0.5); const n = s.buf(0.5); s.noise(n, 1, 0.07); s.lowpass(n, 2400); s.highpass(n, 180); s.mix(o, n); s.sweep(o, 320, 140, 0.6, 0.06); s.mix(o, click(700, 0.05, 0.6), 1, 0.09); this.add('crate', s.normalize(o, 0.75)); }
    // --- feedback
    { const o = s.buf(0.07); s.tone(o, 1750, 0.6, 0.012, 0, 'tri'); s.noise(o, 0.25, 0.006); this.add('hit', s.normalize(o, 0.5)); }
    { const o = s.buf(0.12); s.tone(o, 2500, 0.6, 0.015, 0, 'tri'); s.tone(o, 3300, 0.5, 0.02, 0.035, 'tri'); this.add('hithead', s.normalize(o, 0.55)); }
    { const o = s.buf(0.3); s.tone(o, 880, 0.5, 0.05, 0, 'tri'); s.tone(o, 1320, 0.5, 0.09, 0.07, 'tri'); s.noise(o, 0.2, 0.01); this.add('killconfirm', s.normalize(o, 0.55)); }
    { const o = s.buf(0.3); s.sweep(o, 150, 60, 0.9, 0.07, 0, 2); const n = s.buf(0.3); s.noise(n, 0.4, 0.04); s.lowpass(n, 900); s.mix(o, n); this.add('hurt', s.normalize(o, 0.7)); }
    { const o = s.buf(0.5); s.sweep(o, 130, 50, 0.8, 0.12, 0, 2); const n = s.buf(0.5); s.noise(n, 0.5, 0.1, 0.05, 0.05); s.lowpass(n, 700); s.mix(o, n); this.add('death', s.normalize(o, 0.6)); }
    { const o = s.buf(0.5); const n = s.buf(0.5); s.noise(n, 0.5, 0.2, 0, 0.1); s.highpass(n, 3000); s.mix(o, n); s.tone(o, 520, 0.2, 0.2, 0.05); this.add('stim', s.normalize(o, 0.45)); }
    { const o = s.buf(0.3); s.sweep(o, 180, 70, 0.8, 0.05, 0, 2); s.mix(o, click(900, 0.04, 0.5), 1, 0.03); this.add('deploy', s.normalize(o, 0.6)); }
    { const o = s.buf(0.16); s.mix(o, click(1500, 0.02, 0.5)); s.mix(o, click(2000, 0.02, 0.5), 1, 0.06); this.add('pickup', s.normalize(o, 0.45)); }
    { const o = s.buf(0.35); s.sweep(o, 220, 90, 0.8, 0.05, 0, 2); s.tone(o, 380, 0.3, 0.08); s.mix(o, click(1100, 0.03, 0.5), 1, 0.05); this.add('door', s.normalize(o, 0.6)); }
    // --- UI + stingers
    { const o = s.buf(0.05); s.tone(o, 1300, 0.5, 0.01, 0, 'tri'); this.add('ui_hover', s.normalize(o, 0.2)); }
    { const o = s.buf(0.1); s.tone(o, 900, 0.5, 0.02, 0, 'tri'); s.tone(o, 1500, 0.4, 0.02, 0.03, 'tri'); this.add('ui_click', s.normalize(o, 0.35)); }
    { const o = s.buf(0.3); s.tone(o, 520, 0.4, 0.08, 0, 'tri'); s.tone(o, 780, 0.4, 0.1, 0.06, 'tri'); this.add('ui_open', s.normalize(o, 0.3)); }
    { const o = s.buf(0.25); s.tone(o, 1100, 0.3, 0.03); s.noise(o, 0.2, 0.02); s.tone(o, 1650, 0.3, 0.05, 0.08); this.add('spawn', s.normalize(o, 0.35)); }
    const chord = (name: string, notes: number[], gap: number, decay: number, type: 'tri' | 'saw' = 'tri'): void => {
      const o = s.buf(notes.length * gap + decay * 3);
      notes.forEach((f, i) => { s.tone(o, f, 0.4, decay, i * gap, type); s.tone(o, f * 2.005, 0.12, decay * 0.7, i * gap, 'sine'); });
      s.lowpass(o, 5000);
      this.add(name, s.normalize(o, 0.5));
    };
    chord('objgood', [392, 523.3, 659.3, 784], 0.09, 0.22);
    chord('objbad', [392, 349.2, 311.1, 233.1], 0.11, 0.26, 'saw');
    chord('objneutral', [440, 440, 587.3], 0.1, 0.18);
    chord('matchstart', [196, 261.6, 392, 523.3], 0.16, 0.5, 'saw');
    chord('victory', [261.6, 329.6, 392, 523.3, 659.3, 784], 0.14, 0.6);
    chord('defeat', [293.7, 277.2, 220, 185, 146.8], 0.2, 0.7, 'saw');
    // --- loops
    { // ambience: wind bed with slow gusts + low rumble
      const o = s.buf(9);
      const n = s.buf(9);
      for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
      s.lowpass(n, 420); s.lowpass(n, 700);
      for (let i = 0; i < o.length; i++) { const t = i / s.sr; o[i] = n[i] * (0.55 + 0.3 * Math.sin(t * 0.9) + 0.15 * Math.sin(t * 2.3 + 1)); }
      const r = s.buf(9); for (let i = 0; i < r.length; i++) r[i] = Math.random() * 2 - 1; s.lowpass(r, 70); s.mix(o, r, 2.4);
      // loop seam cross-fade
      const f = Math.floor(s.sr * 0.6);
      for (let i = 0; i < f; i++) { const k = i / f; o[i] = o[i] * k + o[o.length - f + i] * (1 - k); }
      const cut = o.subarray(0, o.length - f);
      let m = 0; for (let i = 0; i < cut.length; i++) m = Math.max(m, Math.abs(cut[i]));
      for (let i = 0; i < cut.length; i++) cut[i] *= 0.5 / (m || 1);
      this.add('ambience', cut);
    }
    { // vehicle engine loop: stacked harmonics with slight roughness
      const o = s.buf(1);
      for (let i = 0; i < o.length; i++) {
        const t = i / s.sr;
        let v = 0;
        for (let h = 1; h <= 7; h++) v += Math.sin(t * TAU * 46 * h + h) / h;
        o[i] = Math.tanh(v * 0.9) * (0.75 + 0.25 * Math.sin(t * TAU * 23)) + (Math.random() * 2 - 1) * 0.06;
      }
      s.lowpass(o, 900);
      let m = 0; for (let i = 0; i < o.length; i++) m = Math.max(m, Math.abs(o[i]));
      for (let i = 0; i < o.length; i++) o[i] *= 0.6 / (m || 1);
      this.add('engine', o);
    }
  }

  // ------------------------------------------------------------------ playback
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number, interior: boolean): void {
    this.lx = x; this.ly = y; this.lz = z;
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener, t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(x, t); l.positionY.setValueAtTime(y, t); l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(fy, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else { l.setPosition(x, y, z); l.setOrientation(fx, fy, fz, 0, 1, 0); }
    if (interior !== this.interior) { this.interior = interior; this.reverbSend.gain.setTargetAtTime(interior ? 0.42 : 0.06, t, 0.25); }
  }

  play(name: string, o: PlayOpts = {}): void {
    const ctx = this.ctx, buf = this.buffers.get(name);
    if (!ctx || !buf || ctx.state !== 'running' || this.voices > 40) return;
    let dist = 0;
    if (o.pos) {
      dist = Math.hypot(o.pos.x - this.lx, o.pos.y - this.ly, o.pos.z - this.lz);
      if (dist > 320) return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.pitch ?? 1;
    const gain = ctx.createGain();
    gain.gain.value = o.volume ?? 1;
    let node: AudioNode = src;
    if (o.pos) {
      const blocked = dist > 3 && this.occluded(o.pos.x, o.pos.y, o.pos.z);
      // air absorption + occlusion: distant / hidden sounds lose their highs
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(blocked ? 500 : 900, Math.min(20000, 20000 * Math.exp(-dist / (blocked ? 22 : 70)) * (blocked ? 0.25 : 1)));
      if (blocked) gain.gain.value *= 0.55;
      const pan = ctx.createPanner();
      pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse';
      pan.refDistance = o.ref ?? 4; pan.maxDistance = 400; pan.rolloffFactor = 1.1;
      pan.positionX.value = o.pos.x; pan.positionY.value = o.pos.y; pan.positionZ.value = o.pos.z;
      node.connect(lp); lp.connect(pan); node = pan;
    }
    node.connect(gain);
    gain.connect(this.sfx);
    gain.connect(this.reverbSend);
    this.voices++;
    src.onended = () => { this.voices--; gain.disconnect(); };
    src.start(ctx.currentTime + (o.delay ?? 0) + Math.min(0.7, dist / 343));
  }

  gunshot(weaponIndex: number, pos: V3 | null, suppressed: boolean): void {
    const w = WEAPONS[weaponIndex];
    if (!w) return;
    const pitch = 0.96 + Math.random() * 0.08;
    const tune = w.id === 'mx4' ? 0.9 : w.id === 'ac8' ? 1.06 : 1;
    if (suppressed) { this.play('gun_sup', { pos: pos ?? undefined, volume: pos ? 0.9 : 0.55, pitch: pitch * tune, ref: 5 }); return; }
    this.play(`gun_${w.cls}`, { pos: pos ?? undefined, volume: pos ? 1 : 0.62, pitch: pitch * tune, ref: w.cls === 'sniper' ? 22 : w.cls === 'pistol' ? 10 : 15 });
  }

  reload(weaponIndex: number, pos: V3 | null): void {
    const w = WEAPONS[weaponIndex];
    if (!w) return;
    const p = pos ?? undefined, v = pos ? 0.7 : 0.5, t = w.reloadTime;
    if (w.boltAction) { this.play('bolt', { pos: p, volume: v, delay: t * 0.12 }); this.play('mag_in', { pos: p, volume: v, delay: t * 0.5 }); this.play('bolt', { pos: p, volume: v, delay: t * 0.82 }); return; }
    this.play('mag_out', { pos: p, volume: v, delay: t * 0.16 });
    this.play('mag_in', { pos: p, volume: v, delay: t * 0.62 });
    this.play('bolt', { pos: p, volume: v * 0.8, delay: t * 0.84 });
  }

  footstep(surface: string, pos: V3 | null, volume: number): void {
    const name = this.buffers.has(`step_${surface}0`) ? surface : 'concrete';
    this.play(`step_${name}${Math.floor(Math.random() * 3)}`, { pos: pos ?? undefined, volume: (pos ? 0.9 : 0.4) * volume, pitch: 0.92 + Math.random() * 0.16, ref: 2.5 });
  }

  impact(surface: string, x: number, y: number, z: number): void {
    const name = this.buffers.has(`imp_${surface}0`) ? surface : 'concrete';
    this.play(`imp_${name}${Math.floor(Math.random() * 2)}`, { pos: { x, y, z }, volume: 0.7, pitch: 0.9 + Math.random() * 0.25, ref: 3 });
  }

  explosion(kind: string, x: number, y: number, z: number): void {
    if (kind === 'smoke') { this.play('hiss', { pos: { x, y, z }, volume: 0.8, ref: 4 }); return; }
    this.play(kind === 'vehicle' || kind === 'barrel' ? 'boom_big' : 'boom', { pos: { x, y, z }, volume: 1, pitch: 0.92 + Math.random() * 0.12, ref: 26 });
  }

  /** Vehicle engine loop: created lazily, pitch follows speed. */
  engine(id: number, x: number, y: number, z: number, speed: number, on: boolean): void {
    const ctx = this.ctx, buf = this.buffers.get('engine');
    if (!ctx || !buf || ctx.state !== 'running') return;
    let e = this.engines.get(id);
    if (!e) {
      if (!on) return;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const pan = ctx.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 6; pan.rolloffFactor = 1.2;
      src.connect(pan); pan.connect(gain); gain.connect(this.sfx);
      src.start();
      e = { src, gain, pan };
      this.engines.set(id, e);
    }
    const t = ctx.currentTime;
    e.pan.positionX.setValueAtTime(x, t); e.pan.positionY.setValueAtTime(y, t); e.pan.positionZ.setValueAtTime(z, t);
    e.src.playbackRate.setTargetAtTime(0.7 + Math.abs(speed) * 0.075, t, 0.08);
    e.gain.gain.setTargetAtTime(on ? 0.55 : 0, t, 0.25);
  }

  startAmbient(): void {
    const ctx = this.ctx, buf = this.buffers.get('ambience');
    if (!ctx || !buf || this.ambient) return;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(gain); gain.connect(this.sfx);
    src.start();
    gain.gain.setTargetAtTime(0.32, ctx.currentTime, 1.5);
    this.ambient = { src, gain };
  }

  stopAmbient(): void {
    if (this.ambient && this.ctx) {
      const a = this.ambient;
      a.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      setTimeout(() => { try { a.src.stop(); } catch { /* already stopped */ } }, 1200);
      this.ambient = null;
    }
    for (const e of this.engines.values()) { try { e.src.stop(); } catch { /* already stopped */ } }
    this.engines.clear();
  }

  /** Distant battle ambience: random far-off bursts and detonations around the listener. */
  update(dt: number): void {
    if (!this.ambient) return;
    this.ambientT -= dt;
    if (this.ambientT > 0) return;
    this.ambientT = 2.5 + Math.random() * 7;
    const a = Math.random() * TAU, d = 150 + Math.random() * 110;
    const pos = { x: this.lx + Math.cos(a) * d, y: this.ly + 10, z: this.lz + Math.sin(a) * d };
    if (Math.random() < 0.2) { this.play('boom', { pos, volume: 0.9, ref: 40, pitch: 0.8 }); return; }
    const cls = ['ar', 'lmg', 'carbine'][Math.floor(Math.random() * 3)];
    const n = 2 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) this.play(`gun_${cls}`, { pos, volume: 0.8, ref: 30, delay: i * (0.085 + Math.random() * 0.01), pitch: 0.95 });
  }

  /** Generative dark ambient bed for the menus (original, no samples). */
  music(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!on) { this.musicNodes?.stop(); this.musicNodes = null; return; }
    if (this.musicNodes) return;
    const out = ctx.createGain(); out.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.7;
    lp.connect(out); out.connect(this.musicBus);
    const oscs: OscillatorNode[] = [];
    for (const [f, type, g] of [[55, 'sawtooth', 0.16], [55.4, 'sawtooth', 0.14], [82.4, 'triangle', 0.12], [110.3, 'sine', 0.1], [164.8, 'sine', 0.05]] as const) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const gn = ctx.createGain(); gn.gain.value = g;
      o.connect(gn); gn.connect(lp); o.start();
      oscs.push(o);
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 260;
    lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    oscs.push(lfo);
    out.gain.setTargetAtTime(0.5, ctx.currentTime, 2);
    // slow war-drum pulse
    const timer = window.setInterval(() => {
      if (ctx.state !== 'running') return;
      const o = ctx.createOscillator(); o.type = 'sine';
      const g = ctx.createGain();
      const t = ctx.currentTime;
      o.frequency.setValueAtTime(74, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 1.4);
    }, 3400);
    this.musicNodes = {
      stop: () => {
        window.clearInterval(timer);
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
        setTimeout(() => { for (const o of oscs) { try { o.stop(); } catch { /* stopped */ } } out.disconnect(); }, 1500);
      },
    };
  }
}
