// Procedural audio — ambience per kingdom + combat sounds (WebAudio, no files)
export const Audio = (() => {
  let ctx = null, master, sfx, amb, noiseBuf, ambNodes = [];
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    master = ctx.createGain(); master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    sfx = ctx.createGain(); sfx.connect(master);
    amb = ctx.createGain(); amb.gain.value = 0; amb.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // convolution-ish reverb from decaying noise
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.5, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3); }
    const verb = ctx.createConvolver(); verb.buffer = ir;
    const vg = ctx.createGain(); vg.gain.value = 0.28;
    sfx.connect(verb); verb.connect(vg); vg.connect(master);
  }
  const KAMB = {
    ash: { notes: [55, 55.3, 82.4, 41.2], filt: 240, wind: 0.06, windF: 500 },
    frost: { notes: [65.4, 98, 130.8, 65.7], filt: 420, wind: 0.14, windF: 900 },
    ember: { notes: [46.2, 46.5, 69.3, 34.6], filt: 200, wind: 0.05, windF: 300 },
    void: { notes: [36.7, 55, 73.4, 110], filt: 360, wind: 0.04, windF: 1400 },
  };
  function ambience(id) {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const n of ambNodes) { try { n.stop(t + 1.5); } catch {} }
    ambNodes = [];
    amb.gain.cancelScheduledValues(t);
    amb.gain.setValueAtTime(amb.gain.value, t);
    amb.gain.linearRampToValueAtTime(0.0, t + 1.2);
    amb.gain.linearRampToValueAtTime(0.2, t + 5);
    const k = KAMB[id] || KAMB.ash;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = k.filt; lp.Q.value = 2; lp.connect(amb);
    k.notes.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 12;
      const g = ctx.createGain(); g.gain.value = i === 2 ? 0.22 : 0.3; o.connect(g); g.connect(lp); o.start(); ambNodes.push(o);
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lg = ctx.createGain(); lg.gain.value = k.filt * 0.5; lfo.connect(lg); lg.connect(lp.frequency); lfo.start(); ambNodes.push(lfo);
    const wn = ctx.createBufferSource(); wn.buffer = noiseBuf; wn.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = k.windF; bp.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = k.wind * 3;
    wn.connect(bp); bp.connect(wg); wg.connect(amb); wn.start(); ambNodes.push(wn);
    const wl = ctx.createOscillator(); wl.frequency.value = 0.08;
    const wlg = ctx.createGain(); wlg.gain.value = k.windF * 0.6; wl.connect(wlg); wlg.connect(bp.frequency); wl.start(); ambNodes.push(wl);
  }
  function noise(dur, f0, f1, q, vol, type = 'bandpass', delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  function tone(dur, f0, f1, vol, type = 'sine', delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  const metal = (v = 0.15) => { [1, 2.76, 5.4, 8.9].forEach((m, i) => tone(0.35 - i * 0.06, 520 * m * (0.97 + Math.random() * 0.06), 500 * m, v / (i + 1), 'sine')); };
  return {
    init, ambience,
    swing: () => noise(0.24, 2600, 420, 1.1, 0.32),
    heavy: () => { noise(0.42, 1800, 160, 1, 0.45); tone(0.35, 110, 45, 0.25); },
    hit: (heavy) => { noise(0.14, 1100, 180, 0.8, heavy ? 0.7 : 0.5, 'lowpass'); tone(0.16, heavy ? 120 : 170, 55, 0.45, 'triangle'); noise(0.08, 3500, 1200, 3, 0.15); },
    clang: () => metal(0.18),
    hurt: () => { tone(0.4, 110, 38, 0.5, 'sawtooth'); noise(0.3, 700, 90, 0.5, 0.55, 'lowpass'); },
    dodge: () => noise(0.32, 380, 1700, 0.6, 0.2),
    death: () => { tone(0.9, 300, 55, 0.16, 'sawtooth'); noise(0.7, 3000, 260, 2, 0.12); },
    soul: () => tone(0.28, 880 + Math.random() * 300, 1600, 0.05),
    spell: () => { noise(0.6, 300, 3200, 1.5, 0.3); tone(0.5, 220, 700, 0.12, 'triangle'); },
    boom: (v = 0.7) => { noise(0.9, 900, 35, 0.5, v, 'lowpass'); tone(0.7, 85, 28, 0.55); },
    ice: () => { noise(0.4, 6000, 2000, 4, 0.2); metal(0.08); },
    fire: () => noise(0.7, 400, 1200, 0.4, 0.3, 'bandpass'),
    cast: () => tone(0.6, 180, 90, 0.1, 'square'),
    drink: () => { tone(0.15, 500, 700, 0.1); tone(0.15, 600, 800, 0.1, 'sine', 0.18); tone(0.6, 400, 900, 0.08, 'sine', 0.36); },
    bell: () => { [1, 2.76, 5.4, 8.9].forEach((m, i) => tone(4 - i * 0.6, 92 * m, 91 * m, 0.24 / (i + 1))); },
    thunder: () => noise(3.0, 300, 30, 0.4, 0.5, 'lowpass', 0.3),
    rise: () => noise(1.0, 120, 420, 0.6, 0.22, 'lowpass'),
    click: () => tone(0.08, 640, 420, 0.07, 'triangle'),
    portal: () => { tone(2.5, 110, 440, 0.15, 'sine'); tone(2.5, 165, 660, 0.1, 'triangle'); noise(2.5, 200, 4000, 1, 0.15); },
    roar: () => { tone(1.4, 90, 40, 0.5, 'sawtooth'); noise(1.4, 500, 80, 0.7, 0.5, 'lowpass'); },
    step: (snow) => noise(0.08, snow ? 1800 : 600, snow ? 700 : 200, 1, 0.05, 'lowpass'),
  };
})();
