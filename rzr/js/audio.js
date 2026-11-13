// Procedural audio (no samples): parallel-twin engine drone tracking CVT rpm, intake/exhaust
// noise, tyre scrub on loose surfaces, wind at speed, water splash. Starts on user gesture.
import { store } from './util.js';

class Audio {
  constructor(game) {
    this.game = game;
    this.enabled = store.get('rzr.sound', '1') === '1';
    this.ctx = null;
  }

  start() {
    if (this.ctx || !this.enabled) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    const master = this.master = c.createGain(); master.gain.value = 0.55; master.connect(c.destination);
    const noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => { const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    // engine: two detuned saws (firing order beat) + sub, through a lowpass that opens with load
    this.eng = [c.createOscillator(), c.createOscillator(), c.createOscillator()];
    this.eng[0].type = 'sawtooth'; this.eng[1].type = 'sawtooth'; this.eng[2].type = 'sine';
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.Q.value = 3;
    this.engG = c.createGain(); this.engG.gain.value = 0;
    for (const o of this.eng) { o.connect(this.engF); o.start(); }
    this.engF.connect(this.engG); this.engG.connect(master);
    // intake / exhaust rasp
    this.rasp = noise(); this.raspF = c.createBiquadFilter(); this.raspF.type = 'bandpass'; this.raspF.Q.value = 1.2;
    this.raspG = c.createGain(); this.raspG.gain.value = 0;
    this.rasp.connect(this.raspF); this.raspF.connect(this.raspG); this.raspG.connect(master);
    // tyres
    this.tyre = noise(); this.tyreF = c.createBiquadFilter(); this.tyreF.type = 'bandpass'; this.tyreF.frequency.value = 700; this.tyreF.Q.value = 0.8;
    this.tyreG = c.createGain(); this.tyreG.gain.value = 0;
    this.tyre.connect(this.tyreF); this.tyreF.connect(this.tyreG); this.tyreG.connect(master);
    // wind
    this.wind = noise(); this.windF = c.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 500;
    this.windG = c.createGain(); this.windG.gain.value = 0;
    this.wind.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(master);
    // water
    this.water = noise(); this.waterF = c.createBiquadFilter(); this.waterF.type = 'highpass'; this.waterF.frequency.value = 1500;
    this.waterG = c.createGain(); this.waterG.gain.value = 0;
    this.water.connect(this.waterF); this.waterF.connect(this.waterG); this.waterG.connect(master);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on && this.ctx) { this.ctx.close(); this.ctx = null; }
    if (on) this.start();
  }

  update(dt, game) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, ph = game.phys, s = (p, v) => p.setTargetAtTime(v, t, 0.05);
    const rpm = ph.engineRpm, load = Math.max(ph.input.throttle, 0.15);
    const f = rpm / 60; // crank Hz; twin fires once per rev
    s(this.eng[0].frequency, f); s(this.eng[1].frequency, f * 1.006); s(this.eng[2].frequency, f * 0.5);
    s(this.engF.frequency, 300 + rpm * 0.25 * (0.4 + load));
    s(this.engG.gain, 0.05 + 0.13 * load);
    s(this.raspF.frequency, 400 + rpm * 0.35); s(this.raspG.gain, 0.02 + 0.07 * ph.input.throttle * (rpm / 8000));
    let scrub = 0, splash = 0;
    for (const w of ph.wheels) {
      if (!w.contact) continue;
      scrub += Math.min(1, Math.abs(w.slipLat) * 2 + Math.abs(w.slip) * 0.15);
      splash += w.water;
    }
    const sp = ph.vel.length();
    s(this.tyreG.gain, Math.min(0.25, scrub * 0.05 * Math.min(1, sp / 4)));
    s(this.windG.gain, Math.min(0.3, (sp / 35) ** 2 * 0.3 + (game.weather?.windSpeed || 0.5) * 0.02));
    s(this.windF.frequency, 300 + sp * 25);
    s(this.waterG.gain, Math.min(0.35, splash * sp * 0.05));
  }
}

export function create(game) { return new Audio(game); }
