// ============================================================
//  Pose library — knight combat set + undead locomotion/attacks
//  Joint rotations in radians. Arms hang along -y; x<0 raises
//  forward, elbow x<0 flexes. Character faces +z, left = +x.
// ============================================================
import { mixPose } from './anim.js';

export const GUARD = {
  hips: [0, 0.12, 0], hy: -0.035,
  spine: [0.06, 0.05, 0], chest: [0.03, 0.12, 0], neck: [0, -0.08, 0], head: [-0.04, -0.12, 0],
  shR: [-0.42, -0.28, -0.08], elR: [-1.2, 0, 0], wrR: [0.75, 0, 0],
  shL: [-0.12, 0.12, 0.12], elL: [-0.55, 0, 0], wrL: [0.1, 0, 0],
  thighL: [-0.16, 0, 0.05], shinL: [0.2, 0, 0], footL: [-0.04, 0, 0],
  thighR: [0.12, 0, -0.05], shinR: [0.22, 0, 0], footR: [-0.1, 0, 0],
};

/** Procedural walk/run cycle blended onto the guard stance. */
export function locomotion(phase, speed01, sprint) {
  const s = Math.min(1, speed01);
  const sp = Math.sin(phase), cp = Math.cos(phase);
  const A = 0.38 + 0.42 * s + (sprint ? 0.15 : 0);
  const K = 0.35 + 0.95 * s + (sprint ? 0.25 : 0);
  const lean = 0.08 + 0.16 * s + (sprint ? 0.18 : 0);
  const p = {
    hips: [0, sp * 0.14 * s, -sp * 0.04], hy: -0.04 - 0.03 * s + Math.abs(cp) * 0.045 * s,
    spine: [lean, -sp * 0.1 * s, 0], chest: [0.03, -sp * 0.12 * s + 0.08, 0], neck: [-lean * 0.5, 0, 0], head: [-lean * 0.3, sp * 0.06, 0],
    thighL: [-sp * A, 0, 0.04], thighR: [sp * A, 0, -0.04],
    shinL: [0.12 + K * Math.max(0, cp) ** 1.4, 0, 0], shinR: [0.12 + K * Math.max(0, -cp) ** 1.4, 0, 0],
    footL: [sp * A * 0.5 - 0.05, 0, 0], footR: [-sp * A * 0.5 - 0.05, 0, 0],
    shL: [sp * (0.25 + 0.4 * s), 0.1, 0.14], elL: [-0.45 - 0.35 * s, 0, 0], wrL: [0, 0, 0],
  };
  if (sprint) { // sword trailing low behind
    p.shR = [0.45 - sp * 0.3, -0.2, -0.15]; p.elR = [-0.5, 0, 0]; p.wrR = [1.6, 0, 0];
  } else {
    p.shR = [-0.35 - sp * 0.12 * s, -0.22, -0.08]; p.elR = [-1.15, 0, 0]; p.wrR = [0.8, 0, 0];
  }
  return p;
}

// ---- knight attacks: keyframes { t, p } ----
const lunge = { thighL: [-0.5, 0, 0.06], shinL: [0.4, 0, 0], footL: [0.1, 0, 0], thighR: [0.35, 0, -0.06], shinR: [0.45, 0, 0], footR: [-0.2, 0, 0], hy: -0.1 };
export const CLIPS = {
  slash1: { dur: 0.52, hit: [0.14, 0.27], reach: 2.7, arc: 1.35, dmg: 24, stamina: 16, keys: [
    { t: 0, p: GUARD },
    { t: 0.13, ease: 'out', p: { ...GUARD, ...lunge, hips: [0, -0.2, 0], spine: [0.05, -0.25, 0], chest: [0.05, -0.55, 0], shR: [-1.3, -1.55, -0.1], elR: [-0.55, 0, 0], wrR: [1.1, 0, 0], shL: [-0.5, 0.45, 0.35], elL: [-0.9, 0, 0] } },
    { t: 0.27, ease: 'snap', p: { ...GUARD, ...lunge, hips: [0, 0.25, 0], spine: [0.12, 0.3, 0], chest: [0.1, 0.55, 0], shR: [-1.45, 1.25, 0], elR: [-0.12, 0, 0], wrR: [1.5, 0, 0], shL: [-0.2, -0.3, 0.45], elL: [-0.6, 0, 0] } },
    { t: 0.52, p: GUARD },
  ] },
  slash2: { dur: 0.5, hit: [0.13, 0.26], reach: 2.7, arc: 1.35, dmg: 24, stamina: 16, keys: [
    { t: 0, p: GUARD },
    { t: 0.12, ease: 'out', p: { ...GUARD, ...lunge, hips: [0, 0.2, 0], spine: [0.05, 0.25, 0], chest: [0.05, 0.6, 0], shR: [-1.25, 1.15, 0.25], elR: [-0.9, 0, 0], wrR: [1.2, 0, 0], shL: [-0.3, -0.2, 0.3] } },
    { t: 0.26, ease: 'snap', p: { ...GUARD, ...lunge, hips: [0, -0.25, 0], spine: [0.12, -0.3, 0], chest: [0.1, -0.55, 0], shR: [-1.4, -1.55, -0.1], elR: [-0.1, 0, 0], wrR: [1.5, 0, 0], shL: [-0.5, 0.4, 0.4], elL: [-1.0, 0, 0] } },
    { t: 0.5, p: GUARD },
  ] },
  slash3: { dur: 0.78, hit: [0.32, 0.44], reach: 3.1, arc: 0.85, dmg: 44, stamina: 24, heavy: true, keys: [
    { t: 0, p: GUARD },
    { t: 0.3, ease: 'out', p: { ...GUARD, hips: [0, 0, 0], spine: [-0.22, 0, 0], chest: [-0.15, 0, 0], head: [-0.15, 0, 0], shR: [-3.0, -0.15, 0], elR: [-0.9, 0, 0], wrR: [0.6, 0, 0], shL: [-2.7, 0.3, 0], elL: [-1.2, 0, 0], thighL: [-0.3, 0, 0.06], thighR: [0.2, 0, -0.06], hy: 0.0 } },
    { t: 0.44, ease: 'snap', p: { ...GUARD, ...lunge, thighL: [-0.75, 0, 0.06], shinL: [0.9, 0, 0], thighR: [0.55, 0, -0.06], shinR: [0.7, 0, 0], hy: -0.22, hips: [0, 0, 0], spine: [0.5, 0, 0], chest: [0.22, 0, 0], shR: [-0.95, -0.1, 0], elR: [-0.05, 0, 0], wrR: [1.6, 0, 0], shL: [-1.0, 0.2, 0], elL: [-0.4, 0, 0] } },
    { t: 0.62, p: { ...GUARD, ...lunge, hy: -0.18, spine: [0.4, 0, 0], shR: [-0.9, -0.1, 0], wrR: [1.5, 0, 0] } },
    { t: 0.78, p: GUARD },
  ] },
  spin: { dur: 0.9, hit: [0.15, 0.75], reach: 3.3, arc: Math.PI, dmg: 30, stamina: 34, heavy: true, keys: [
    { t: 0, p: { ...GUARD, shR: [-1.5, -1.3, 0], elR: [-0.1, 0, 0], wrR: [1.5, 0, 0], chest: [0.05, -0.6, 0], hy: -0.15, ...lunge } },
    { t: 0.45, p: { ...GUARD, shR: [-1.5, 0.3, 0], elR: [-0.05, 0, 0], wrR: [1.55, 0, 0], shL: [-1.3, 0.6, 0.6], chest: [0.05, 0.2, 0], hy: -0.18, ...lunge } },
    { t: 0.9, p: GUARD },
  ] },
  roll: { dur: 0.6, keys: [
    { t: 0, p: GUARD },
    { t: 0.12, p: { hips: [0, 0, 0], spine: [0.7, 0, 0], chest: [0.4, 0, 0], neck: [0.4, 0, 0], head: [0.3, 0, 0], thighL: [-1.7, 0, 0.1], shinL: [2.2, 0, 0], thighR: [-1.5, 0, -0.1], shinR: [2.1, 0, 0], shR: [-1.2, -0.3, 0], elR: [-1.4, 0, 0], wrR: [1.2, 0, 0], shL: [-1.2, 0.3, 0], elL: [-1.5, 0, 0], hy: -0.35 } },
    { t: 0.45, p: { hips: [0, 0, 0], spine: [0.6, 0, 0], chest: [0.4, 0, 0], neck: [0.3, 0, 0], thighL: [-1.6, 0, 0.1], shinL: [2.0, 0, 0], thighR: [-1.6, 0, -0.1], shinR: [2.0, 0, 0], shR: [-1.2, -0.3, 0], elR: [-1.4, 0, 0], wrR: [1.2, 0, 0], shL: [-1.2, 0.3, 0], elL: [-1.5, 0, 0], hy: -0.35 } },
    { t: 0.6, p: GUARD },
  ] },
  cast: { dur: 0.62, keys: [
    { t: 0, p: GUARD },
    { t: 0.28, ease: 'out', p: { ...GUARD, chest: [0, -0.35, 0], shL: [-0.6, 0.7, 0.5], elL: [-1.6, 0, 0], wrL: [0.3, 0, 0], shR: [-0.2, -0.4, -0.2], elR: [-0.9, 0, 0] } },
    { t: 0.38, ease: 'snap', p: { ...GUARD, ...lunge, chest: [0.05, 0.25, 0], shL: [-1.62, 0.1, 0.0], elL: [-0.05, 0, 0], wrL: [-0.3, 0, 0], shR: [-0.1, -0.3, -0.25], elR: [-0.9, 0, 0] } },
    { t: 0.62, p: GUARD },
  ] },
  drink: { dur: 1.0, keys: [
    { t: 0, p: GUARD },
    { t: 0.35, p: { ...GUARD, shL: [-1.3, -0.55, 0.2], elL: [-2.0, 0, 0], head: [-0.35, 0, 0], neck: [-0.15, 0, 0] } },
    { t: 0.7, p: { ...GUARD, shL: [-1.4, -0.6, 0.2], elL: [-2.1, 0, 0], head: [-0.45, 0, 0], neck: [-0.2, 0, 0] } },
    { t: 1.0, p: GUARD },
  ] },
  hurt: { dur: 0.36, keys: [
    { t: 0, p: GUARD },
    { t: 0.08, ease: 'snap', p: { ...GUARD, spine: [-0.35, 0.1, 0], chest: [-0.2, 0, 0], head: [-0.35, 0.2, 0], shR: [-0.2, -0.5, -0.4], shL: [0.2, 0.3, 0.4], hy: -0.08 } },
    { t: 0.36, p: GUARD },
  ] },
  death: { dur: 1.6, keys: [
    { t: 0, p: GUARD },
    { t: 0.5, p: { ...GUARD, thighL: [-1.4, 0, 0.1], shinL: [1.9, 0, 0], thighR: [-0.2, 0, -0.1], shinR: [1.8, 0, 0], footR: [0.6, 0, 0], hy: -0.42, spine: [0.5, 0, 0], head: [0.5, 0, 0], shR: [-0.2, 0, -0.3], elR: [-0.3, 0, 0], shL: [0.2, 0, 0.2] } },
    { t: 1.6, p: { ...GUARD, thighL: [-1.4, 0, 0.1], shinL: [1.9, 0, 0], thighR: [-0.2, 0, -0.1], shinR: [1.8, 0, 0], footR: [0.6, 0, 0], hy: -0.5, spine: [0.8, 0, 0], head: [0.7, 0, 0], shR: [0.1, 0, -0.3], elR: [-0.1, 0, 0], shL: [0.2, 0, 0.3] } },
  ] },
};

// ---- undead ----
export const UNDEAD_IDLE = {
  hips: [0, 0, 0], hy: -0.02, spine: [0.22, 0, 0], chest: [0.12, 0, 0], neck: [-0.15, 0, 0], head: [-0.1, 0, 0.1],
  shR: [-0.25, -0.1, -0.15], elR: [-0.6, 0, 0], wrR: [0.6, 0, 0], shL: [0.1, 0.1, 0.2], elL: [-0.3, 0, 0],
  thighL: [-0.1, 0, 0.06], shinL: [0.2, 0, 0], thighR: [0.08, 0, -0.06], shinR: [0.2, 0, 0], jaw: [0.1, 0, 0],
};
export function undeadWalk(phase, s, hunch = 0.25) {
  const sp = Math.sin(phase), cp = Math.cos(phase);
  return {
    hips: [0, sp * 0.18, sp * 0.06], hy: -0.03 + Math.abs(cp) * 0.04,
    spine: [hunch + 0.1 * s, -sp * 0.12, sp * 0.05], chest: [0.1, -sp * 0.1, 0], neck: [-0.15, 0, 0], head: [-0.1, sp * 0.15, Math.sin(phase * 0.5) * 0.15],
    thighL: [-sp * 0.55, 0, 0.05], thighR: [sp * 0.55, 0, -0.05],
    shinL: [0.15 + 0.8 * Math.max(0, cp), 0, 0], shinR: [0.15 + 0.8 * Math.max(0, -cp), 0, 0],
    footL: [sp * 0.3, 0, 0], footR: [-sp * 0.3, 0, 0],
    shL: [sp * 0.45 - 0.2, 0.1, 0.25], elL: [-0.5, 0, 0], shR: [-0.35 - sp * 0.2, -0.1, -0.2], elR: [-0.7, 0, 0], wrR: [0.6, 0, 0],
    jaw: [0.1 + Math.abs(sp) * 0.15, 0, 0],
  };
}
export const UNDEAD_ATTACKS = {
  slash: { wind: { shR: [-1.4, -1.5, -0.1], elR: [-0.6, 0, 0], wrR: [1.2, 0, 0], chest: [0.1, -0.5, 0], spine: [0.15, -0.2, 0], jaw: [0.5, 0, 0], thighL: [-0.4, 0, 0.05], shinL: [0.4, 0, 0] },
           strike: { shR: [-1.4, 1.2, 0], elR: [-0.1, 0, 0], wrR: [1.5, 0, 0], chest: [0.15, 0.5, 0], spine: [0.25, 0.25, 0], jaw: [0.3, 0, 0], thighL: [-0.5, 0, 0.05], shinL: [0.5, 0, 0], thighR: [0.35, 0, 0] } },
  overhead: { wind: { shR: [-2.9, -0.2, 0], shL: [-2.7, 0.2, 0], elR: [-0.8, 0, 0], elL: [-0.8, 0, 0], wrR: [0.6, 0, 0], spine: [-0.15, 0, 0], chest: [-0.15, 0, 0], jaw: [0.6, 0, 0] },
              strike: { shR: [-0.8, -0.1, 0], shL: [-0.8, 0.1, 0], elR: [-0.1, 0, 0], elL: [-0.2, 0, 0], wrR: [1.5, 0, 0], spine: [0.6, 0, 0], chest: [0.25, 0, 0], hy: -0.15, thighL: [-0.6, 0, 0.05], shinL: [0.7, 0, 0], thighR: [0.4, 0, 0], shinR: [0.5, 0, 0], jaw: [0.2, 0, 0] } },
  lunge: { wind: { shR: [-2.2, -0.3, -0.3], shL: [-2.2, 0.3, 0.3], elR: [-0.4, 0, 0], elL: [-0.4, 0, 0], spine: [-0.3, 0, 0], chest: [-0.2, 0, 0] },
           strike: { shR: [-1.4, 0.0, -0.1], shL: [-1.4, 0.0, 0.1], elR: [0, 0, 0], elL: [0, 0, 0], spine: [0.5, 0, 0], chest: [0.2, 0, 0] } },
  cast: { wind: { shR: [-2.6, -0.3, -0.2], elR: [-0.3, 0, 0], wrR: [-0.2, 0, 0], shL: [-1.2, 0.5, 0.4], elL: [-0.8, 0, 0], spine: [-0.15, 0, 0], head: [-0.3, 0, 0], jaw: [0.6, 0, 0] },
          strike: { shR: [-1.6, -0.1, -0.1], elR: [-0.1, 0, 0], wrR: [0.4, 0, 0], shL: [-1.5, 0.2, 0.2], elL: [-0.1, 0, 0], spine: [0.3, 0, 0], jaw: [0.3, 0, 0] } },
  slam: { wind: { shR: [-3.0, -0.3, -0.2], shL: [-3.0, 0.3, 0.2], elR: [-0.6, 0, 0], elL: [-0.6, 0, 0], spine: [-0.3, 0, 0], chest: [-0.2, 0, 0], hy: 0.05 },
          strike: { shR: [-0.6, 0.1, 0], shL: [-0.6, -0.1, 0], elR: [-0.1, 0, 0], elL: [-0.1, 0, 0], spine: [0.7, 0, 0], chest: [0.3, 0, 0], hy: -0.3, thighL: [-0.8, 0, 0.1], shinL: [0.9, 0, 0], thighR: [0.6, 0, -0.1], shinR: [0.8, 0, 0] } },
  sweep: { wind: { shR: [-1.5, -1.6, -0.2], elR: [-0.3, 0, 0], wrR: [1.4, 0, 0], chest: [0.05, -0.7, 0], spine: [0.1, -0.3, 0] },
           strike: { shR: [-1.5, 1.4, 0], elR: [-0.05, 0, 0], wrR: [1.5, 0, 0], chest: [0.1, 0.7, 0], spine: [0.15, 0.35, 0] } },
};
export function undeadAttackPose(base, kind, phase, k) {
  const A = UNDEAD_ATTACKS[kind] || UNDEAD_ATTACKS.overhead;
  if (phase === 'wind') return mixPose(base, { ...base, ...A.wind }, k);
  if (phase === 'strike') return mixPose({ ...base, ...A.wind }, { ...base, ...A.strike }, k);
  return mixPose({ ...base, ...A.strike }, base, k);
}
