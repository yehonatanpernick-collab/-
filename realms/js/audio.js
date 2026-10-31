// Procedural music + sound effects with WebAudio
const MOODS = [
  // [root midi, chord progression intervals], bell scale
  { chords: [[0, 4, 7, 11], [5, 9, 12, 16], [7, 11, 14, 17], [9, 12, 16, 19]], root: 52, scale: [0, 2, 4, 7, 9, 12, 14, 16], bell: 0.9, cut: 1800 },
  { chords: [[0, 3, 7, 10], [8, 12, 15, 19], [5, 8, 12, 15], [7, 10, 14, 17]], root: 50, scale: [0, 3, 5, 7, 10, 12, 15, 17], bell: 1, cut: 1500 },
  { chords: [[0, 7, 12, 16], [5, 12, 17, 21], [3, 10, 15, 19], [7, 14, 19, 23]], root: 45, scale: [0, 2, 3, 7, 8, 12, 14, 15], bell: 0.5, cut: 1300 },
  { chords: [[0, 4, 7, 14], [7, 11, 14, 21], [9, 12, 16, 23], [5, 9, 12, 19]], root: 55, scale: [0, 2, 4, 7, 9, 11, 14, 16], bell: 0.8, cut: 2200 },
  { chords: [[0, 3, 6, 10], [1, 5, 8, 12], [0, 3, 7, 11], [-2, 1, 5, 8]], root: 38, scale: [0, 1, 3, 6, 7, 10, 12, 13], bell: 0.25, cut: 700 },
];
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

export class Sound {
  constructor() { this.ctx = null; this.mood = 0; this.enabled = true; this.combat = 0; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.7; this.master.connect(c.destination);
    const comp = c.createDynamicsCompressor(); comp.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = 0.22; this.music.connect(comp);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(comp);
    // reverb
    const len = c.sampleRate * 3, buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.verb = c.createConvolver(); this.verb.buffer = buf; const vg = c.createGain(); vg.gain.value = 0.55; this.verb.connect(vg); vg.connect(comp);
    this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 1600; this.filter.Q.value = 0.6;
    this.filter.connect(this.music); this.filter.connect(this.verb);
    const nb = c.createBuffer(1, c.sampleRate, c.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1; this.noiseBuf = nb;
    this.step = 0; this.nextT = c.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 200);
  }
  setMood(i) { if (i !== this.mood) { this.mood = i; if (this.ctx) this.filter.frequency.setTargetAtTime(MOODS[i].cut, this.ctx.currentTime, 1.5); } }
  setEnabled(v) { this.enabled = v; if (this.master) this.master.gain.setTargetAtTime(v ? 0.7 : 0, this.ctx.currentTime, 0.1); }
  schedule() {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    while (this.nextT < c.currentTime + 0.6) {
      const m = MOODS[this.mood], beat = 0.5, bar = Math.floor(this.step / 16) % 4, t = this.nextT;
      if (this.step % 16 === 0) for (const iv of m.chords[bar]) this.pad(mtof(m.root + iv), t, beat * 16);
      if (this.step % 16 === 0) this.pad(mtof(m.root - 12 + m.chords[bar][0]), t, beat * 16, 0.5);
      if (Math.random() < 0.28 * m.bell) this.bell(mtof(m.root + 24 + m.scale[Math.floor(Math.random() * m.scale.length)]), t, 0.06);
      if (this.combat > 0.3 && this.step % 4 === 0) this.drum(t, this.step % 8 === 0 ? 1 : 0.5);
      this.step++; this.nextT += beat / 2;
    }
  }
  pad(f, t, dur, vol = 1) {
    const c = this.ctx, g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * vol, t + 1.6); g.gain.setValueAtTime(0.05 * vol, t + dur - 1.5); g.gain.linearRampToValueAtTime(0, t + dur + 0.4); g.connect(this.filter);
    for (const det of [-7, 7]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(g); o.start(t); o.stop(t + dur + 0.5); }
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f / 2; const g2 = c.createGain(); g2.gain.value = 0.6; o2.connect(g2); g2.connect(g); o2.start(t); o2.stop(t + dur + 0.5);
  }
  bell(f, t, vol) {
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 2.76;
    const g2 = c.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(g); o.connect(g);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    g.connect(this.verb); g.connect(this.music); o.start(t); o2.start(t); o.stop(t + 2.6); o2.stop(t + 2.6);
  }
  drum(t, v) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    g.gain.setValueAtTime(0.35 * v * this.combat, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4); o.connect(g); g.connect(this.music); o.start(t); o.stop(t + 0.45);
  }
  noise(dur, freq, type = 'bandpass', vol = 0.4, q = 1, sweep) {
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q; if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx); s.start(t); s.stop(t + dur + 0.05);
  }
  tone(f0, f1, dur, type = 'sine', vol = 0.3, toVerb = false) {
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(this.sfx); if (toVerb) g.connect(this.verb); o.start(t); o.stop(t + dur + 0.05);
  }
  play(n) {
    if (!this.ctx || !this.enabled) return;
    switch (n) {
      case 'swing': this.noise(0.18, 1800, 'bandpass', 0.35, 1.2, 600); break;
      case 'hit': this.noise(0.12, 900, 'lowpass', 0.6); this.tone(220, 80, 0.15, 'square', 0.12); break;
      case 'crit': this.noise(0.2, 1200, 'lowpass', 0.7); this.tone(330, 60, 0.3, 'sawtooth', 0.15); break;
      case 'magic': this.tone(600, 1600, 0.25, 'sine', 0.2, true); this.tone(900, 2400, 0.2, 'triangle', 0.1, true); break;
      case 'boom': this.noise(0.4, 600, 'lowpass', 0.5, 1, 100); this.tone(300, 900, 0.2, 'sine', 0.1, true); break;
      case 'hurt': this.tone(300, 120, 0.25, 'sawtooth', 0.2); this.noise(0.15, 500, 'lowpass', 0.4); break;
      case 'jump': this.tone(300, 520, 0.12, 'sine', 0.12); break;
      case 'dash': this.noise(0.25, 3000, 'highpass', 0.25, 1, 800); break;
      case 'land': this.noise(0.1, 300, 'lowpass', 0.3); break;
      case 'orb': this.tone(880, 1320, 0.12, 'sine', 0.12, true); break;
      case 'die': this.tone(400, 60, 0.6, 'sawtooth', 0.15); this.noise(0.5, 800, 'bandpass', 0.3, 1, 200); break;
      case 'shard': { const c = this.ctx; [0, 4, 7, 12, 16, 19, 24].forEach((iv, i) => setTimeout(() => this.bell(mtof(72 + iv), c.currentTime, 0.14), i * 90)); break; }
      case 'slam': this.tone(90, 30, 0.6, 'sine', 0.6); this.noise(0.5, 400, 'lowpass', 0.6, 1, 80); break;
      case 'roar': this.tone(120, 50, 1.0, 'sawtooth', 0.18); this.noise(0.9, 300, 'bandpass', 0.35, 2, 150); break;
      case 'claw': this.noise(0.15, 2500, 'bandpass', 0.3, 2, 900); break;
      case 'hiss': this.noise(0.3, 4000, 'highpass', 0.2); break;
      case 'eshoot': this.tone(500, 200, 0.25, 'triangle', 0.08); break;
      case 'barrier': this.tone(200, 180, 0.3, 'sine', 0.15, true); break;
      case 'ui': this.tone(660, 990, 0.08, 'sine', 0.1); break;
      case 'rise': this.noise(0.6, 300, 'lowpass', 0.4, 1, 80); this.tone(80, 40, 0.6, 'sawtooth', 0.08); break;
      case 'swing2': this.noise(0.22, 1200, 'bandpass', 0.3, 1.2, 400); break;
      case 'block': this.tone(1400, 900, 0.12, 'square', 0.08); this.noise(0.1, 3000, 'highpass', 0.3); break;
      case 'blink': this.tone(1800, 300, 0.3, 'sine', 0.15, true); break;
      case 'cast': this.tone(300, 900, 0.5, 'triangle', 0.12, true); break;
      case 'special': this.noise(0.5, 900, 'bandpass', 0.5, 0.8, 3000); this.tone(200, 800, 0.4, 'sawtooth', 0.12, true); break;
      case 'beacon': this.noise(0.8, 600, 'lowpass', 0.4, 1, 2000); { const c = this.ctx; [0, 7, 12, 19].forEach((iv, i) => setTimeout(() => this.bell(mtof(64 + iv), c.currentTime, 0.12), i * 110)); } break;
      case 'fairy': { const c = this.ctx; [0, 4, 7, 11, 14, 19, 23].forEach((iv, i) => setTimeout(() => this.bell(mtof(76 + iv), c.currentTime, 0.1), i * 70)); } break;
      case 'portal': this.tone(120, 600, 1.4, 'sine', 0.2, true); this.noise(1.2, 400, 'bandpass', 0.3, 1, 2400); break;
      case 'mote': this.bell(mtof(84 + [0, 4, 7, 12][Math.floor(Math.random() * 4)]), this.ctx.currentTime, 0.1); break;
      case 'victory': { const c = this.ctx; [0, 4, 7, 12, 7, 12, 16, 19, 24].forEach((iv, i) => setTimeout(() => this.bell(mtof(60 + iv), c.currentTime, 0.18), i * 160)); break; }
    }
  }
}
