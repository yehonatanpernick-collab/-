// Pose-based animation: poses are { jointName: [x, y, z], hy: hipHeightOffset }
const smooth = (t) => t * t * (3 - 2 * t);

/** Sample a keyframed clip at time t. keys: [{ t, p }], eased between keys. */
export function sampleClip(keys, t) {
  if (t <= keys[0].t) return keys[0].p;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b.t) {
      const k = (t - a.t) / (b.t - a.t);
      const e = b.ease === 'in' ? k * k : b.ease === 'out' ? 1 - (1 - k) * (1 - k) : b.ease === 'snap' ? 1 - Math.pow(1 - k, 4) : smooth(k);
      return mixPose(a.p, b.p, e);
    }
  }
  return keys[keys.length - 1].p;
}
export function mixPose(a, b, t) {
  const out = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k], vb = b[k];
    if (typeof (va ?? vb) === 'number') { out[k] = (va ?? 0) + ((vb ?? 0) - (va ?? 0)) * t; continue; }
    const A = va || [0, 0, 0], B = vb || [0, 0, 0];
    out[k] = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
  }
  return out;
}
/** Additively layer pose b onto a (b is a delta). */
export function addPose(a, b, w = 1) {
  const out = { ...a };
  for (const k in b) {
    if (typeof b[k] === 'number') { out[k] = (a[k] ?? 0) + b[k] * w; continue; }
    const A = a[k] || [0, 0, 0];
    out[k] = [A[0] + b[k][0] * w, A[1] + b[k][1] * w, A[2] + b[k][2] * w];
  }
  return out;
}
/** Drive rig joints toward a pose with exponential smoothing (rate per second). */
export function drivePose(rig, pose, dt, rate = 18) {
  const a = rate >= 999 ? 1 : 1 - Math.exp(-rate * dt);
  for (const k in pose) {
    const j = rig.joints[k];
    if (!j) continue;
    const v = pose[k];
    j.rotation.x += (v[0] - j.rotation.x) * a;
    j.rotation.y += (v[1] - j.rotation.y) * a;
    j.rotation.z += (v[2] - j.rotation.z) * a;
  }
  if (pose.hy !== undefined && rig.hips) rig.hips.position.y += (rig.hipBase + pose.hy - rig.hips.position.y) * a;
}
