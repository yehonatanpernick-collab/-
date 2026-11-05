// ============================================================================
//  Audio: fully synthesized (WebAudio) engines, wind, gear, warnings, callouts
// ============================================================================
const Audio = {
  ctx: null, on: true, master: null, nodes: null, type: null, lastCallout: null, speakOK: 'speechSynthesis' in window,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.7;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate * 2; const buf = c.createBuffer(1, len, c.sampleRate); const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    this.noiseBuf = buf;
    // cabin filter (applied in cockpit view)
    this.cabin = c.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 20000; this.cabin.connect(this.master);
  },
  noise() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 1.5); return s; },
  chain(src, ...nodes) { let n = src; for (const x of nodes) { n.connect(x); n = x; } return n; },
  filt(type, f, Q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; },
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; },
  setAircraft(def) {
    if (!this.ctx) return;
    if (this.nodes) { this.nodes.all.forEach(n => { try { n.stop && n.stop(); n.disconnect(); } catch (e) { } }); }
    const c = this.ctx, all = []; const N = {}; this.type = def.engine.type;
    const out = this.gain(1); out.connect(this.cabin); all.push(out); N.out = out;
    if (def.engine.type === 'prop') {
      const o1 = c.createOscillator(); o1.type = 'sawtooth'; const o2 = c.createOscillator(); o2.type = 'square';
      const shaper = c.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); } shaper.curve = curve;
      const lp = this.filt('lowpass', 900, 2); const g = this.gain(0); o1.connect(shaper); o2.connect(shaper); this.chain(shaper, lp, g, out);
      const nz = this.noise(); const nlp = this.filt('bandpass', 300, 0.7); const ng = this.gain(0); this.chain(nz, nlp, ng, out);
      o1.start(); o2.start(); Object.assign(N, { o1, o2, lp, g, ng, nlp }); all.push(o1, o2, nz, shaper, lp, g, nlp, ng);
    } else {
      const nz = this.noise(); const bp = this.filt('bandpass', 600, 0.6); const g = this.gain(0); this.chain(nz, bp, g, out);
      const nz2 = this.noise(); const lp = this.filt('lowpass', 180, 0.8); const rg = this.gain(0); this.chain(nz2, lp, rg, out);
      const wh = c.createOscillator(); wh.type = 'sawtooth'; const whf = this.filt('bandpass', 3000, 8); const wg = this.gain(0); this.chain(wh, whf, wg, out); wh.start();
      const wh2 = c.createOscillator(); wh2.type = 'triangle'; const wg2 = this.gain(0); this.chain(wh2, wg2, out); wh2.start();
      const nz3 = this.noise(); const ablp = this.filt('lowpass', 700, 0.7); const abg = this.gain(0); this.chain(nz3, ablp, abg, out);
      Object.assign(N, { bp, g, lp, rg, wh, whf, wg, wh2, wg2, abg, ablp }); all.push(nz, bp, g, nz2, lp, rg, wh, whf, wg, wh2, wg2, nz3, ablp, abg);
    }
    const wn = this.noise(); const wbp = this.filt('bandpass', 700, 0.5); const wgn = this.gain(0); this.chain(wn, wbp, wgn, this.master); all.push(wn, wbp, wgn);
    const rn = this.noise(); const rlp = this.filt('lowpass', 140, 1); const rgn = this.gain(0); this.chain(rn, rlp, rgn, this.master); all.push(rn, rlp, rgn);
    const st = c.createOscillator(); st.type = 'square'; st.frequency.value = 440; const stg = this.gain(0); const stf = this.filt('lowpass', 1800); this.chain(st, stf, stg, this.master); st.start(); all.push(st, stg, stf);
    Object.assign(N, { wbp, wgn, rgn, rlp, stg, all }); this.nodes = N;
  },
  update(fm, view, dt) {
    if (!this.ctx || !this.nodes) return;
    const N = this.nodes, t = this.ctx.currentTime, T = fm.tele, set = (p, v, tc = 0.06) => p.setTargetAtTime(v, t, tc);
    const vol = this.on ? 1 : 0; set(this.master.gain, vol * 0.7, 0.1);
    const inside = view === 'cockpit';
    set(this.cabin.frequency, inside ? (fm.d.id === 'airliner' ? 900 : 1800) : 16000, 0.2);
    const dead = !!fm.crashed;
    const n = dead ? 0 : fm.n;
    if (this.type === 'prop') {
      const rpm = fm.rpm || 700; const bpf = rpm / 60 * 2;
      set(N.o1.frequency, bpf); set(N.o2.frequency, rpm / 60 * 1);
      set(N.lp.frequency, 400 + n * 1400); set(N.g.gain, dead ? 0 : (0.12 + n * 0.22) * (inside ? 1.2 : 0.9));
      set(N.ng.gain, dead ? 0 : 0.1 + n * 0.25); set(N.nlp.frequency, 200 + n * 500);
    } else {
      const air = fm.d.id === 'airliner';
      set(N.bp.frequency, 300 + n * (air ? 1500 : 2400)); set(N.g.gain, dead ? 0 : (0.05 + n * n * 0.55) * (inside ? 0.6 : 1));
      set(N.lp.frequency, 120 + n * 220); set(N.rg.gain, dead ? 0 : n * 0.5 + fm.ab * 0.6);
      set(N.wh.frequency, (air ? 1800 : 2600) + n * (air ? 2800 : 4200)); set(N.whf.frequency, (air ? 1800 : 2600) + n * (air ? 2800 : 4200)); set(N.wg.gain, dead ? 0 : (0.02 + n * 0.05) * (inside ? 0.35 : 1));
      set(N.wh2.frequency, (air ? 90 : 140) + n * (air ? 260 : 380)); set(N.wg2.gain, dead ? 0 : 0.02 + n * 0.04);
      set(N.abg.gain, dead ? 0 : fm.ab * 0.9); set(N.ablp.frequency, 400 + fm.ab * 600);
    }
    const V = T.V || 0; set(N.wgn.gain, Math.min(0.5, Math.pow(V / 160, 2) * (inside ? 0.35 : 0.6)) + (fm.d.id === 'fighter' ? 0 : 0)); set(N.wbp.frequency, 400 + V * 6);
    const roll = fm.wow ? Math.min(1, (T.gs || 0) / 40) : 0; set(N.rgn.gain, roll * 0.35 + (fm.scrape || 0) * 0.6, 0.04); set(N.rlp.frequency, 120 + roll * 200 + (fm.scrape || 0) * 900);
    // stall horn (light) / stall warning
    const horn = fm.stallWarn && !dead ? 1 : 0;
    if (fm.d.id === 'light') { set(N.stg.gain, horn * 0.12, 0.03); N.stg.gain && set(N.stg.gain, horn * 0.12); }
    else set(N.stg.gain, horn * (Math.sin(t * 18) > 0 ? 0.1 : 0), 0.01);
  },
  burst(dur = 0.25, f = 1200, vol = 0.5, type = 'bandpass') {
    if (!this.ctx || !this.on) return; const c = this.ctx; const s = this.noise(); const b = this.filt(type, f, 0.8); const g = this.gain(0);
    this.chain(s, b, g, this.master); const t = c.currentTime; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.stop(t + dur + 0.05);
  },
  boom() {
    if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime;
    const s = this.noise(); const lp = this.filt('lowpass', 2400, 0.7); const g = this.gain(0); this.chain(s, lp, g, this.master);
    g.gain.setValueAtTime(1.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 3.5); lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(90, t + 3); s.stop(t + 3.6);
    const o = c.createOscillator(); o.type = 'sine'; const og = this.gain(0); this.chain(o, og, this.master); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(25, t + 1.5); og.gain.setValueAtTime(1.2, t); og.gain.exponentialRampToValueAtTime(0.001, t + 1.8); o.start(); o.stop(t + 2);
  },
  beep(f = 880, dur = 0.12, vol = 0.15, n = 1) {
    if (!this.ctx || !this.on) return; const c = this.ctx;
    for (let i = 0; i < n; i++) { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = this.gain(0); this.chain(o, g, this.master); const t = c.currentTime + i * dur * 1.8; g.gain.setValueAtTime(vol, t); g.gain.setValueAtTime(0, t + dur); o.start(t); o.stop(t + dur + 0.02); }
  },
  motor(dur = 4) {
    if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime; const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 95; const f = this.filt('lowpass', 300); const g = this.gain(0); this.chain(o, f, g, this.cabin);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.3); g.gain.setValueAtTime(0.06, t + dur - 0.5); g.gain.linearRampToValueAtTime(0, t + dur); o.start(t); o.stop(t + dur + 0.1);
    this.burst(0.3, 300, 0.3, 'lowpass');
  },
  say(text, rate = 1.05) {
    if (!this.on || !this.speakOK) return;
    try { const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = rate; u.pitch = 0.9; u.volume = 0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { this.speakOK = false; }
  },
};
