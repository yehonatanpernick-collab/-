#!/usr/bin/env node
// Builds client/public/assets/characters/operator.glb:
//  * the CC-BY "German Bundeswehr soldier - rigged" model (Mixamo skeleton),
//  * animation clips retargeted onto it from other Mixamo-rigged sources.
//
// Retargeting works in world space using each skin's bind pose (inverse bind matrices):
//   targetWorld(t) = sourceWorld(t) * inverse(sourceBind) * targetBind
// so differences in bone axes or rest poses between the rigs cancel out.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import glm from 'gl-matrix';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const { mat4, quat, vec3 } = glm;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = (uid) => join(root, 'assets', 'raw', 'sketchfab', `${uid}.glb`);
const OUT = join(root, 'client', 'public', 'assets', 'characters', 'operator.glb');
const TARGET = raw('3d7944fea17b494abf220cc11ddabfd1');
const CLIPS = [
  { file: join(root, 'client/public/assets/characters/soldier.glb'), clip: 'Idle', name: 'Idle' },
  { file: join(root, 'client/public/assets/characters/soldier.glb'), clip: 'Walk', name: 'Walk' },
  { file: join(root, 'client/public/assets/characters/soldier.glb'), clip: 'Run', name: 'Run' },
  { file: raw('dbacdbf34f7f4bda802b4e670099cd74'), clip: 0, name: 'RifleIdle', face: 'hands' },
  // (rifle-run clip from 094a698e retargets with a strong forward lean; omitted)
  { file: raw('9b73b36ba2184bd1bde5b42810752b69'), clip: 0, name: 'Crouch', face: 'hands' },
];
const HEIGHT = 1.8;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const norm = (n) => n.replace(/^.*:/, '').replace(/_\d+$/, '');

/** Collect skeleton info: nodes, parents, bind world matrices per normalised joint name. */
// the joints' rest transforms are what actually place the skinned mesh; inverse bind matrices can sit in a
// differently rotated / scaled space, so retargeting works in rest space
const USE_REST = true;
function skeleton(doc) {
  const nodes = doc.getRoot().listNodes();
  const parent = new Map();
  for (const n of nodes) for (const c of n.listChildren()) parent.set(c, n);
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices().getArray();
  const bind = new Map(), byName = new Map();
  // inverse bind matrices are expressed in the space of the skeleton's parent node, not in world space
  const jointSet = new Set(joints);
  const top = joints.find((j) => !jointSet.has(parent.get(j)));
  const rest = worldMats(nodes, parent, new Map());
  const skelNode = skin.getSkeleton();
  const spaceNode = skelNode && !jointSet.has(skelNode) ? skelNode : parent.get(top);
  const space = spaceNode ? rest.get(spaceNode) : mat4.create();
  joints.forEach((j, i) => {
    const m = mat4.multiply(mat4.create(), space, mat4.invert(mat4.create(), ibm.slice(i * 16, i * 16 + 16)));
    const key = norm(j.getName());
    if (!byName.has(key)) { byName.set(key, j); bind.set(j, USE_REST ? rest.get(j) : m); }
  });
  return { nodes, parent, joints, bind, byName };
}

const localMat = (t, r, s) => mat4.fromRotationTranslationScale(mat4.create(), r, t, s);
function worldMats(nodes, parent, override) {
  const out = new Map();
  const get = (n) => {
    if (out.has(n)) return out.get(n);
    const o = override.get(n);
    const l = localMat(o?.t ?? n.getTranslation(), o?.r ?? n.getRotation(), n.getScale());
    const p = parent.get(n);
    const w = p ? mat4.multiply(mat4.create(), get(p), l) : l;
    out.set(n, w);
    return w;
  };
  for (const n of nodes) get(n);
  return out;
}
const rotOf = (m) => { const q = mat4.getRotation(quat.create(), m); return quat.normalize(q, q); };

function sample(sampler, t) {
  const inp = sampler.getInput().getArray(), outp = sampler.getOutput().getArray();
  const k = sampler.getOutput().getElementSize();
  if (t <= inp[0]) return Array.from(outp.slice(0, k));
  for (let i = 0; i < inp.length - 1; i++) {
    if (t <= inp[i + 1]) {
      const f = (t - inp[i]) / (inp[i + 1] - inp[i] || 1);
      const a = outp.slice(i * k, i * k + k), b = outp.slice((i + 1) * k, (i + 1) * k + k);
      if (k === 4) return Array.from(quat.slerp(quat.create(), a, b, f));
      return Array.from(a).map((v, j) => v + (b[j] - v) * f);
    }
  }
  return Array.from(outp.slice((inp.length - 1) * k, inp.length * k));
}

// ---------------------------------------------------------------- target
const doc = await io.read(TARGET);
for (const a of doc.getRoot().listAnimations()) a.dispose();
const T = skeleton(doc);
const fps = 30;

for (const spec of CLIPS) {
  const sdoc = await io.read(spec.file);
  const S = skeleton(sdoc);
  const anims = sdoc.getRoot().listAnimations();
  const anim = typeof spec.clip === 'number' ? anims[spec.clip] : anims.find((a) => a.getName() === spec.clip);
  if (!anim) { console.error('missing clip', spec.name); continue; }
  const chans = new Map();
  let dur = 0;
  for (const c of anim.listChannels()) {
    const n = c.getTargetNode();
    if (!chans.has(n)) chans.set(n, {});
    chans.get(n)[c.getTargetPath()] = c.getSampler();
    dur = Math.max(dur, c.getSampler().getInput().getMax([])[0]);
  }
  const frames = Math.max(2, Math.round(dur * fps) + 1);
  // map: normalised name -> [sourceJoint, targetJoint]
  const pairs = [...T.byName.keys()].filter((k) => S.byName.has(k)).map((k) => [k, S.byName.get(k), T.byName.get(k)]);
  const TREST = worldMats(T.nodes, T.parent, new Map());
  const hipsS = S.byName.get('Hips'), hipsT = T.byName.get('Hips');
  const sBindHip = mat4.getTranslation(vec3.create(), S.bind.get(hipsS)), tBindHip = mat4.getTranslation(vec3.create(), TREST.get(hipsT));
  // target joints are positioned by their rest transforms (not the inverse bind matrices, which may differ in scale)
  // per-bone alignment: rotate the target's bind pose so each bone points like the source's bind pose (T-pose vs A-pose etc.)
  const CHILD = { Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: 'LeftHandMiddle1',
    RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand', RightHand: 'RightHandMiddle1', LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase', RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase' };
  const pos = (sk, n) => mat4.getTranslation(vec3.create(), sk.bind.get(sk.byName.get(n)));
  const align = new Map();
  for (const [k, , tj] of pairs) {
    let c = CHILD[k];
    if (!c && /Hand(Thumb|Index|Middle|Ring|Pinky)\d$/.test(k)) c = k.replace(/\d$/, (d) => String(Number(d) + 1));
    if (!c || !S.byName.has(c) || !T.byName.has(c)) { align.set(tj, quat.create()); continue; }
    const ds = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), pos(S, c), pos(S, k)));
    const dt = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), pos(T, c), pos(T, k)));
    align.set(tj, k === 'Hips' ? quat.create() : quat.rotationTo(quat.create(), dt, ds));
  }
  const yawFix = quat.create();
  const times = [], rotOut = new Map(pairs.map((p) => [p[2], []])), hipT = [];
  // target joints in hierarchy order (parents first)
  const order = T.joints.filter((j, i, arr) => arr.indexOf(j) === i);
  const depth = (n) => { let d = 0; for (let p = T.parent.get(n); p; p = T.parent.get(p)) d++; return d; };
  order.sort((a, b) => depth(a) - depth(b));
  for (let f = 0; f < frames; f++) {
    const t = Math.min(dur, f / fps);
    times.push(t);
    const ov = new Map();
    for (const [n, ch] of chans) ov.set(n, { t: ch.translation ? sample(ch.translation, t) : undefined, r: ch.rotation ? sample(ch.rotation, t) : undefined });
    const SW = worldMats(S.nodes, S.parent, ov);
    if (f === 0) {
      // facing correction: turn the clip about Y so the body (hip axis) or, for rifle poses, the hands face forward
      const P = (W, n) => mat4.getTranslation(vec3.create(), W.get(S.byName.get(n)));
      const ang = (v) => Math.atan2(v[0], v[2]);
      const fwdOf = (W) => { const l = P(W, 'LeftUpLeg'), r = P(W, 'RightUpLeg'); return [r[2] - l[2], 0, -(r[0] - l[0])]; }; // up x (r - l)
      const want = ang(fwdOf(S.bind));
      let have = ang(fwdOf(SW));
      if (spec.face === 'hands') {
        const lh = P(SW, 'LeftHand'), rh = P(SW, 'RightHand'), ch = P(SW, 'Spine2');
        have = ang([(lh[0] + rh[0]) / 2 - ch[0], 0, (lh[2] + rh[2]) / 2 - ch[2]]);
      }
      quat.setAxisAngle(yawFix, [0, 1, 0], want - have);
      console.log(`${spec.name}: facing correction ${((want - have) * 57.3).toFixed(1)} deg`);
    }
    // desired target world rotations
    const desired = new Map();
    for (const [, sj, tj] of pairs) {
      const delta = quat.multiply(quat.create(), yawFix, quat.multiply(quat.create(), rotOf(SW.get(sj)), quat.invert(quat.create(), rotOf(S.bind.get(sj)))));
      const aligned = quat.multiply(quat.create(), align.get(tj), rotOf(T.bind.get(tj)));
      desired.set(tj, quat.normalize(quat.create(), quat.multiply(quat.create(), delta, aligned)));
    }
    // solve local rotations top-down
    const tov = new Map();
    let TW = worldMats(T.nodes, T.parent, tov);
    for (const j of order) {
      const want = desired.get(j);
      if (!want) continue;
      const p = T.parent.get(j);
      const pr = p ? rotOf(TW.get(p)) : quat.create();
      const local = quat.normalize(quat.create(), quat.multiply(quat.create(), quat.invert(quat.create(), pr), want));
      tov.set(j, { r: Array.from(local), t: tov.get(j)?.t });
      TW = worldMats(T.nodes, T.parent, tov);
    }
    if (f === 0) {
      const Q = (W, n) => mat4.getTranslation(vec3.create(), W.get(T.byName.get(n)));
      const ang = (v) => Math.atan2(v[0], v[2]) * 57.3;
      const fw = (W) => { const l = Q(W, 'LeftUpLeg'), r = Q(W, 'RightUpLeg'); return ang([r[2] - l[2], 0, -(r[0] - l[0])]); };
      const lh = Q(TW, 'LeftHand'), rh = Q(TW, 'RightHand'), ch = Q(TW, 'Spine2');
      console.log(`  check ${spec.name}: bind fwd ${fw(TREST).toFixed(0)}, hips fwd ${fw(TW).toFixed(0)}, hands ${ang([(lh[0] + rh[0]) / 2 - ch[0], 0, (lh[2] + rh[2]) / 2 - ch[2]]).toFixed(0)}`);
    }
    for (const [, , tj] of pairs) rotOut.get(tj).push(...(tov.get(tj)?.r ?? tj.getRotation()));
    // hips: world offset from bind, scaled to the target's proportions, horizontal drift removed
    // hips height above the lower foot relative to leg length (bone lengths are pose- and unit-independent)
    const P = (W, sk, n) => mat4.getTranslation(vec3.create(), (W ?? (sk === T ? TREST : sk.bind)).get(sk.byName.get(n)));
    const leg = (W, sk) => vec3.distance(P(W, sk, 'Hips'), P(W, sk, 'LeftLeg')) * 0 + vec3.distance(P(W, sk, 'LeftUpLeg'), P(W, sk, 'LeftLeg')) + vec3.distance(P(W, sk, 'LeftLeg'), P(W, sk, 'LeftFoot'));
    const above = (W, sk) => P(W, sk, 'Hips')[1] - Math.min(P(W, sk, 'LeftFoot')[1], P(W, sk, 'RightFoot')[1]);
    const k = (above(SW, S) / leg(SW, S)) / (above(null, T) / leg(null, T));
    const tFoot = Math.min(P(null, T, 'LeftFoot')[1], P(null, T, 'RightFoot')[1]);
    const wp = vec3.fromValues(tBindHip[0], tFoot + (tBindHip[1] - tFoot) * Math.min(1.03, Math.max(0.3, k)), tBindHip[2]);
    const pT = T.parent.get(hipsT);
    const inv = mat4.invert(mat4.create(), TW.get(pT));
    hipT.push(...vec3.transformMat4(vec3.create(), wp, inv));
  }
  const buf = doc.getRoot().listBuffers()[0];
  const a = doc.createAnimation(spec.name);
  const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buf);
  for (const [, , tj] of pairs) {
    const out = doc.createAccessor().setType('VEC4').setArray(new Float32Array(rotOut.get(tj))).setBuffer(buf);
    const s = doc.createAnimationSampler().setInput(input).setOutput(out).setInterpolation('LINEAR');
    a.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(tj).setTargetPath('rotation').setSampler(s));
  }
  const hs = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType('VEC3').setArray(new Float32Array(hipT)).setBuffer(buf)).setInterpolation('LINEAR');
  a.addSampler(hs).addChannel(doc.createAnimationChannel().setTargetNode(hipsT).setTargetPath('translation').setSampler(hs));
  console.log(`${spec.name}: ${pairs.length} bones, ${frames} frames, ${dur.toFixed(2)}s`);
}

// ---------------------------------------------------------------- normalise: Mixamo names without suffix, 1.8 m tall, standing on y = 0
for (const n of doc.getRoot().listNodes()) {
  const nm = n.getName();
  if (/^mixamorig:/.test(nm)) n.setName(`mixamorig:${norm(nm)}`);
}
const scene = doc.getRoot().listScenes()[0];
const wrap = doc.createNode('Operator');
for (const c of scene.listChildren()) { scene.removeChild(c); wrap.addChild(c); }
scene.addChild(wrap);
{
  const T2 = skeleton(doc);
  let top = -Infinity, bottom = Infinity;
  const R2 = worldMats(T2.nodes, T2.parent, new Map());
  for (const j of T2.joints) { const m = R2.get(j); const y = mat4.getTranslation(vec3.create(), m)[1]; top = Math.max(top, y); bottom = Math.min(bottom, y); }
  const s = HEIGHT / ((top - bottom) * 1.04); // highest joint sits slightly below the top of the head
  wrap.setScale([s, s, s]);
  console.log('scale', s.toFixed(5));
}
await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 82 }));
mkdirSync(dirname(OUT), { recursive: true });
await io.write(OUT, doc);
console.log('wrote', OUT);
void weld; void simplify;
