// Synthesised spatial soundscape: wind, creeks, birds, footsteps, rain, thunder, animal calls.
import * as THREE from 'three';
import { ss, clamp, CHANNELS, LAKES } from './shared.js';
import { camera, U, G, cellOf, heightAt } from './core.js';
import { sky_state, thunderQueue } from './atmos.js';

let A = null;
export const audioOn = () => !!(A && A.on);
function noiseBuffer(ctx, sec, brown) {
  const len = ctx.sampleRate * sec, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
  return buf;
}
function loop(ctx, buf, type, f, q, dest) {
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0; s.connect(fl).connect(g).connect(dest); s.start(); return { g, fl };
}
function panner(ctx, dest, ref = 12) { const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.2; p.connect(dest); return p; }
export function setSound(on) {
  if (on && !A) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
      const white = noiseBuffer(ctx, 3, false), brown = noiseBuffer(ctx, 4, true);
      const creekP = panner(ctx, master, 18);
      const creek = loop(ctx, white, 'bandpass', 1300, 0.5, creekP);
      A = { ctx, master, white, brown, creekP, creek, wind: loop(ctx, brown, 'lowpass', 520, 0.6, master), gust: loop(ctx, white, 'bandpass', 700, 0.8, master), rain: loop(ctx, white, 'highpass', 2500, 0.3, master), nextBird: 0, step: 0 };
    } catch (_) { A = null; }
  }
  if (A) { A.on = on; A.master.gain.setTargetAtTime(on ? 0.8 : 0, A.ctx.currentTime, 0.2); if (on) A.ctx.resume(); }
}
function oneShot(build, pos, ref = 10) {
  if (!A || !A.on) return;
  const out = pos ? panner(A.ctx, A.master, ref) : A.master;
  if (pos) { out.positionX.value = pos.x; out.positionY.value = pos.y; out.positionZ.value = pos.z; }
  build(A.ctx, out, A.ctx.currentTime);
}
const chirp = (ctx, out, t, f0, f1, dur, vol, type = 'sine') => {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.connect(g).connect(out);
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + dur); o.start(t); o.stop(t + dur + 0.02);
};
const burst = (ctx, out, t, f, q, dur, vol, type = 'bandpass') => {
  const s = ctx.createBufferSource(); s.buffer = A.white; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = ctx.createGain(); s.connect(fl).connect(g).connect(out);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur); s.start(t, Math.random() * 2); s.stop(t + dur + 0.02);
};
export function footstep(surface, run) {
  oneShot((ctx, out, t) => {
    const v = run ? 1.3 : 1;
    if (surface === 'water') { burst(ctx, out, t, 900, 0.7, 0.25, 0.25 * v); burst(ctx, out, t + 0.05, 2400, 1, 0.15, 0.12 * v); }
    else if (surface === 'wood') { burst(ctx, out, t, 220, 2, 0.12, 0.35 * v, 'lowpass'); }
    else if (surface === 'rock') { burst(ctx, out, t, 1800, 3, 0.05, 0.16 * v); burst(ctx, out, t + 0.02, 600, 2, 0.06, 0.12 * v); }
    else if (surface === 'dirt') { for (let i = 0; i < 4; i++) burst(ctx, out, t + i * 0.012, 2600 + Math.random() * 1500, 2, 0.04, 0.07 * v); }
    else burst(ctx, out, t, 3200, 0.6, 0.11, 0.06 * v);
  });
}
export function animalSound(kind, pos) {
  oneShot((ctx, out, t) => {
    if (kind === 'marmot') { chirp(ctx, out, t, 2700, 2500, 0.32, 0.3); chirp(ctx, out, t + 0.45, 2700, 2450, 0.25, 0.22); }
    else if (kind === 'pika') { chirp(ctx, out, t, 3800, 3300, 0.12, 0.25, 'triangle'); }
    else if (kind === 'splash') { burst(ctx, out, t, 1200, 0.8, 0.35, 0.5); burst(ctx, out, t + 0.6, 900, 0.8, 0.3, 0.35); }
  }, pos, 8);
}
const _v = new THREE.Vector3(), _f = new THREE.Vector3();
let creekPos = new THREE.Vector3(), creekT = 0;
export function updateAudio(dt, P, speed) {
  if (!A || !A.on) return;
  const ctx = A.ctx, t = ctx.currentTime, L = ctx.listener;
  camera.getWorldDirection(_f);
  if (L.positionX) { L.positionX.value = camera.position.x; L.positionY.value = camera.position.y; L.positionZ.value = camera.position.z; L.forwardX.value = _f.x; L.forwardY.value = _f.y; L.forwardZ.value = _f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  else { L.setPosition(camera.position.x, camera.position.y, camera.position.z); L.setOrientation(_f.x, _f.y, _f.z, 0, 1, 0); }
  const e = P.y + 2400, storm = U.storm.value;
  A.wind.g.gain.setTargetAtTime((0.1 + 0.3 * ss(3000, 3900, e) + 0.25 * storm + (P.fly ? clamp(speed / 120, 0, 0.5) : 0)), t, 0.6);
  A.gust.g.gain.setTargetAtTime((0.02 + 0.06 * ss(3200, 4000, e)) * (0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.13)) + storm * 0.05, t, 0.4);
  A.rain.g.gain.setTargetAtTime(ss(0.5, 0.9, storm) * 0.28, t, 1.0);
  // nearest running water drives a positioned creek source
  creekT -= dt;
  if (creekT < 0) {
    creekT = 0.5; let best = 1e9, bp = null, foam = 0;
    for (const c of CHANNELS) { if (!c.path) continue; for (let i = 0; i < c.path.length; i += 3) { const [x, z] = c.path[i], d = (x - P.x) ** 2 + (z - P.z) ** 2; if (d < best) { best = d; bp = [x, c.W[i], z]; foam = i > 0 ? Math.max(0, c.W[Math.max(0, i - 3)] - c.W[i]) : 0; } } }
    if (bp) creekPos.set(bp[0], bp[1] + 0.5, bp[2]);
    A.creek.g.gain.setTargetAtTime(clamp(0.35 + foam * 0.4, 0, 1.1), t, 0.5);
    A.creek.fl.frequency.setTargetAtTime(1100 + foam * 600, t, 0.5);
  }
  A.creekP.positionX.value = creekPos.x; A.creekP.positionY.value = creekPos.y; A.creekP.positionZ.value = creekPos.z;
  // birdsong from nearby trees, by day
  const h = sky_state.hour;
  if (t > A.nextBird && e < 3550 && h > 5.4 && h < 20.5 && storm < 0.4) {
    A.nextBird = t + 0.8 + Math.random() * (h < 8 || h > 18 ? 2 : 5);
    const a = Math.random() * 6.283, r = 15 + Math.random() * 50; _v.set(P.x + Math.cos(a) * r, 0, P.z + Math.sin(a) * r); _v.y = heightAt(_v.x, _v.z) + 6;
    const kind = Math.random();
    oneShot((ctx, out, t0) => {
      if (kind < 0.35) { const b = 3000 + Math.random() * 1500; for (let i = 0; i < 4; i++) chirp(ctx, out, t0 + i * 0.11, b, b * 1.25, 0.08, 0.05); }
      else if (kind < 0.6) { chirp(ctx, out, t0, 4200, 2600, 0.35, 0.05); chirp(ctx, out, t0 + 0.4, 3400, 3400, 0.25, 0.04); }
      else if (kind < 0.8) { for (let i = 0; i < 6; i++) chirp(ctx, out, t0 + i * 0.07, 5200 - i * 300, 4800 - i * 300, 0.05, 0.035); }
      else { chirp(ctx, out, t0, 1900, 1500, 0.18, 0.06, 'triangle'); chirp(ctx, out, t0 + 0.25, 1900, 1500, 0.18, 0.05, 'triangle'); }
    }, _v, 14);
  }
  // thunder rolls in after the flash
  const now = performance.now() / 1000;
  while (thunderQueue.length && thunderQueue[0].at <= now) {
    const th = thunderQueue.shift();
    oneShot((ctx, out) => {
      const s = ctx.createBufferSource(); s.buffer = A.brown; const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 160;
      const g = ctx.createGain(); s.connect(fl).connect(g).connect(out); const t0 = ctx.currentTime;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1.8 * th.gain, t0 + 0.15); g.gain.setTargetAtTime(0.6 * th.gain, t0 + 0.6, 0.6); g.gain.setTargetAtTime(0, t0 + 2.5, 1.2);
      s.start(t0, Math.random()); s.stop(t0 + 7);
    });
  }
}
