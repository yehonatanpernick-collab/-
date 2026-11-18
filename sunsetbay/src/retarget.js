// World-space animation retargeting between Mixamo-style rigs whose rest pose is a T-pose.
// For every bone: delta = srcWorld(t) * inverse(srcWorldRest); tgtWorld(t) = delta * tgtWorldRest.
import * as THREE from 'three';

export const normBone = n => n.replace(/^mixamorig\d*[:_]?/i, '').replace(/[:.]/g, '');

// Describe a skeleton hierarchy (bones or plain nodes named like mixamo bones) relative to `root`.
export function buildRig(root) {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const list = [], byKey = new Map();
  root.traverse(o => {
    if (!(o.isBone || /^mixamorig/i.test(o.name))) return;
    const key = normBone(o.name);
    if (byKey.has(key)) return;
    const m = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3(); m.decompose(wp, wq, ws);
    const e = { key, obj: o, restLocalQ: o.quaternion.clone(), restLocalP: o.position.clone(), restWorldQ: wq, restWorldP: wp, parentKey: null, parentWorldRestM: null };
    list.push(e); byKey.set(key, e);
  });
  for (const e of list) {
    let p = e.obj.parent; while (p && p !== root && !byKey.has(normBone(p.name))) p = p.parent;
    if (p && p !== root && byKey.has(normBone(p.name))) e.parentKey = normBone(p.name);
    // world matrix (relative to root) of the object's direct parent, used for the hips position
    e.parentWorldRestM = new THREE.Matrix4().multiplyMatrices(rootInv, e.obj.parent ? e.obj.parent.matrixWorld : new THREE.Matrix4());
    // rotation of the chain between the nearest mapped ancestor and this bone's direct parent
    const pq = new THREE.Quaternion(); new THREE.Matrix4().copy(e.parentWorldRestM).decompose(new THREE.Vector3(), pq, new THREE.Vector3());
    e.parentWorldRestQ = pq;
  }
  // topological order (parents first)
  const order = [], seen = new Set();
  const visit = e => { if (seen.has(e.key)) return; if (e.parentKey) visit(byKey.get(e.parentKey)); seen.add(e.key); order.push(e); };
  list.forEach(visit);
  const hips = byKey.get('Hips');
  return { list: order, byKey, hips, hipsHeight: hips ? hips.restWorldP.y : 1 };
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();

// clip: source AnimationClip whose track names reference source bone names
export function retargetClip(clip, src, tgt, { fps = 30, inPlace = false, name } = {}) {
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(frames); for (let i = 0; i < frames; i++) times[i] = Math.min(clip.duration, i / fps);
  // interpolants per source bone
  const qInterp = new Map(); let hipsPInterp = null;
  for (const tr of clip.tracks) {
    const dot = tr.name.lastIndexOf('.'), node = tr.name.slice(0, dot), prop = tr.name.slice(dot + 1), key = normBone(node);
    if (prop === 'quaternion') qInterp.set(key, tr.createInterpolant());
    else if (prop === 'position' && key === 'Hips') hipsPInterp = tr.createInterpolant();
  }
  const outQ = new Map(); for (const e of tgt.list) if (src.byKey.has(e.key)) outQ.set(e.key, new Float32Array(frames * 4));
  const outP = new Float32Array(frames * 3);
  const srcWorld = new Map(), tgtWorld = new Map();
  const ratio = tgt.hipsHeight / (src.hipsHeight || 1);
  const srcHips0 = src.hips ? src.hips.restWorldP : new THREE.Vector3();
  let first = null;
  for (let f = 0; f < frames; f++) {
    const t = times[f];
    // source FK
    for (const e of src.list) {
      const lq = qInterp.has(e.key) ? _q.fromArray(qInterp.get(e.key).evaluate(t)) : _q.copy(e.restLocalQ);
      const parentW = e.parentKey ? srcWorld.get(e.parentKey) : e.parentWorldRestQ;
      const w = srcWorld.get(e.key) || new THREE.Quaternion(); w.multiplyQuaternions(parentW, lq); srcWorld.set(e.key, w);
    }
    // target
    for (const e of tgt.list) {
      const s = src.byKey.get(e.key);
      const w = tgtWorld.get(e.key) || new THREE.Quaternion();
      const parentW = e.parentKey ? tgtWorld.get(e.parentKey) : e.parentWorldRestQ;
      if (!s) { w.multiplyQuaternions(parentW, e.restLocalQ); tgtWorld.set(e.key, w); continue; }
      // delta in world space
      _q2.copy(s.restWorldQ).invert(); const delta = _q.multiplyQuaternions(srcWorld.get(e.key), _q2);
      w.multiplyQuaternions(delta, e.restWorldQ); tgtWorld.set(e.key, w);
      const local = _q2.copy(parentW).invert().multiply(w);
      local.toArray(outQ.get(e.key), f * 4);
    }
    // hips position
    if (tgt.hips) {
      let dp;
      if (hipsPInterp) {
        const sp = _v.fromArray(hipsPInterp.evaluate(t));
        // source local -> source root space
        sp.applyMatrix4(src.hips.parentWorldRestM);
        dp = sp.sub(srcHips0).multiplyScalar(ratio);
      } else dp = _v.set(0, 0, 0);
      if (!first) first = dp.clone();
      if (inPlace) { dp.x = 0; dp.z = 0; }
      const wp = dp.add(tgt.hips.restWorldP);
      _m.copy(tgt.hips.parentWorldRestM).invert(); wp.applyMatrix4(_m);
      wp.toArray(outP, f * 3);
    }
  }
  const tracks = [];
  for (const e of tgt.list) if (outQ.has(e.key)) tracks.push(new THREE.QuaternionKeyframeTrack(e.obj.name + '.quaternion', times, outQ.get(e.key)));
  if (tgt.hips) tracks.push(new THREE.VectorKeyframeTrack(tgt.hips.obj.name + '.position', times, outP));
  return new THREE.AnimationClip(name || clip.name, clip.duration, tracks);
}
