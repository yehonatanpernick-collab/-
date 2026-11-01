import * as THREE from 'three';

// Procedural rig for a Mixamo / Ready-Player-Me style skeleton.
// All pose values are expressed in "character space": model origin on the floor,
// +Z = facing direction, +X = the fighter's LEFT side, +Y = up.

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4();
const _x0 = new V3(), _y0 = new V3(), _z0 = new V3(), _x1 = new V3(), _y1 = new V3(), _z1 = new V3();
const _t1 = new V3(), _t2 = new V3(), _t3 = new V3(), _t4 = new V3(), _t5 = new V3();
const _q1 = new Q(), _q2 = new Q(), _q3 = new Q(), _q4 = new Q();

export function eulerQ(yaw, pitch, roll, out = new Q()) {
  _e.set(pitch, yaw, roll, 'YXZ');
  return out.setFromEuler(_e);
}

// rotation mapping frame (a0,b0) onto (a1,b1)
function frameQuat(a0, b0, a1, b1, out) {
  _x0.copy(a0).normalize(); _y0.copy(b0).addScaledVector(_x0, -b0.dot(_x0)).normalize(); _z0.crossVectors(_x0, _y0);
  _x1.copy(a1).normalize(); _y1.copy(b1).addScaledVector(_x1, -b1.dot(_x1)).normalize(); _z1.crossVectors(_x1, _y1);
  _m0.makeBasis(_x0, _y0, _z0); _m1.makeBasis(_x1, _y1, _z1);
  _m1.multiply(_m0.transpose());
  return out.setFromRotationMatrix(_m1);
}

export class Pose {
  constructor() {
    this.hips = new V3(); this.hipsYaw = 0; this.hipsPitch = 0; this.hipsRoll = 0;
    this.chestYaw = 0; this.chestPitch = 0; this.chestRoll = 0;
    this.headYaw = 0; this.headPitch = 0; this.headRoll = 0;
    this.handL = new V3(); this.handR = new V3();
    this.poleL = new V3(1, -1, 0); this.poleR = new V3(-1, -1, 0);
    this.twistL = 0; this.twistR = 0; this.wristL = 0; this.wristR = 0;
    this.footL = new V3(); this.footR = new V3();
    this.footYawL = 0; this.footYawR = 0; this.footPitchL = 0; this.footPitchR = 0;
    this.kneeL = new V3(0.3, 0, 1); this.kneeR = new V3(-0.3, 0, 1);
    this.shrugL = 0; this.shrugR = 0; this.mouth = 0;
  }
  copy(p) {
    for (const k in p) { const v = p[k]; if (v && v.isVector3) this[k].copy(v); else this[k] = v; }
    return this;
  }
  lerp(p, t) {
    for (const k in p) { const v = p[k]; if (v && v.isVector3) this[k].lerp(v, t); else this[k] += (v - this[k]) * t; }
    return this;
  }
  // additive: this += (p - base) * t
  addDelta(p, base, t) {
    for (const k in p) {
      const v = p[k];
      if (v && v.isVector3) { this[k].x += (v.x - base[k].x) * t; this[k].y += (v.y - base[k].y) * t; this[k].z += (v.z - base[k].z) * t; }
      else this[k] += (v - base[k]) * t;
    }
    return this;
  }
  clone() { return new Pose().copy(this); }
}

const CHAIN = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'];

export class Rig {
  constructor(sceneRoot) {
    this.bones = {};
    sceneRoot.traverse(o => { if (o.isBone) this.bones[o.name] = o; });
    this.b = {}; // per bone data
    sceneRoot.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(sceneRoot.matrixWorld).invert();
    const extra = ['LeftHandMiddle1', 'RightHandMiddle1', 'LeftHandThumb1', 'RightHandThumb1', 'LeftToe_End', 'RightToe_End', 'HeadTop_End'];
    for (const n of [...CHAIN, ...extra]) {
      const bone = this.bones[n];
      const m = new THREE.Matrix4().multiplyMatrices(rootInv, bone.matrixWorld);
      const p = new V3(), q = new Q(), s = new V3();
      m.decompose(p, q, s);
      this.b[n] = {
        bone, bindLocalQ: bone.quaternion.clone(), bindLocalP: bone.position.clone(),
        bindQ: q, bindP: p, q: q.clone(), p: p.clone(), parent: null,
      };
    }
    for (const n of CHAIN) {
      const pn = this.bones[n].parent && this.bones[n].parent.name;
      this.b[n].parent = this.b[pn] || null;
    }
    // parent of Hips (armature) in char space
    const hp = this.bones.Hips.parent;
    const pm = new THREE.Matrix4().multiplyMatrices(rootInv, hp.matrixWorld);
    this.armQ = new Q(); this.armP = new V3(); pm.decompose(this.armP, this.armQ, new V3());
    this.armQi = this.armQ.clone().invert();

    // limb rest data
    const B = this.b;
    const Z = new V3(0, 0, 1);
    this.limbs = {};
    for (const s of ['Left', 'Right']) {
      const u = B[s + 'Arm'].bindP, l = B[s + 'ForeArm'].bindP, e = B[s + 'Hand'].bindP;
      this.limbs[s + 'Arm'] = {
        U: B[s + 'Arm'], L: B[s + 'ForeArm'], E: B[s + 'Hand'],
        l1: u.distanceTo(l), l2: l.distanceTo(e),
        d1: l.clone().sub(u).normalize(), d2: e.clone().sub(l).normalize(),
        f: Z.clone(),
      };
      const hu = B[s + 'UpLeg'].bindP, hl = B[s + 'Leg'].bindP, he = B[s + 'Foot'].bindP;
      this.limbs[s + 'Leg'] = {
        U: B[s + 'UpLeg'], L: B[s + 'Leg'], E: B[s + 'Foot'],
        l1: hu.distanceTo(hl), l2: hl.distanceTo(he),
        d1: hl.clone().sub(hu).normalize(), d2: he.clone().sub(hl).normalize(),
        f: Z.clone().negate(),
      };
      // ankle height above sole and horizontal offset
      this.limbs[s + 'Leg'].ankle = he.clone().setY(he.y);
    }
    this.legLen = this.limbs.LeftLeg.l1 + this.limbs.LeftLeg.l2;
    this.hipsBind = B.Hips.bindP.clone();
    this.ankleH = B.LeftFoot.bindP.y;
    // hands: glove frames (X thumb side for left / mirrored right, Y knuckles, Z back of hand)
    this.gloveFrames = {};
    for (const s of ['Left', 'Right']) {
      const h = B[s + 'Hand'].bindP;
      const y = B[s + 'HandMiddle1'].bindP.clone().sub(h).normalize();
      const t = B[s + 'HandThumb1'].bindP.clone().sub(h);
      let z = new V3().crossVectors(y, t).normalize();
      if (s === 'Left') z.negate();
      // make the glove follow the forearm line instead of the bent rest hand
      const fa = B[s + 'Hand'].bindP.clone().sub(B[s + 'ForeArm'].bindP).normalize();
      y.lerp(fa, 0.6).normalize();
      z.addScaledVector(y, -z.dot(y)).normalize();
      const x = new V3().crossVectors(y, z);
      const m = new THREE.Matrix4().makeBasis(x, y, z);
      const qc = new Q().setFromRotationMatrix(m);
      this.gloveFrames[s] = { q: B[s + 'Hand'].bindQ.clone().invert().multiply(qc), y, z, x };
    }
    this.tmp = {};
  }

  _setQ(n, q) { this.b[n].q.copy(q); }
  _fk(n) { // compute char position of bone from parent
    const d = this.b[n], p = d.parent;
    d.p.copy(d.bindLocalP).applyQuaternion(p.q).add(p.p);
  }
  _write(n) {
    const d = this.b[n];
    const pq = d.parent ? d.parent.q : this.armQ;
    d.bone.quaternion.copy(pq).invert().multiply(d.q);
  }

  apply(pose) {
    const B = this.b;
    // ---- hips
    const qh = eulerQ(pose.hipsYaw, pose.hipsPitch, pose.hipsRoll, _q1);
    B.Hips.q.copy(qh).multiply(B.Hips.bindQ);
    B.Hips.p.copy(this.hipsBind).add(pose.hips);
    B.Hips.bone.position.copy(B.Hips.p).sub(this.armP).applyQuaternion(this.armQi);
    this._write('Hips');
    // ---- spine
    const qc = eulerQ(pose.chestYaw, pose.chestPitch, pose.chestRoll, _q2);
    const fr = [0.34, 0.68, 1];
    ['Spine', 'Spine1', 'Spine2'].forEach((n, i) => {
      _q3.copy(qh).slerp(qc, fr[i]);
      B[n].q.copy(_q3).multiply(B[n].bindQ);
      this._fk(n); this._write(n);
    });
    const qhd = eulerQ(pose.headYaw, pose.headPitch, pose.headRoll, _q4);
    _q3.copy(qc).slerp(qhd, 0.45);
    B.Neck.q.copy(_q3).multiply(B.Neck.bindQ); this._fk('Neck'); this._write('Neck');
    B.Head.q.copy(qhd).multiply(B.Head.bindQ); this._fk('Head'); this._write('Head');
    // ---- clavicles
    for (const s of ['Left', 'Right']) {
      const sh = s === 'Left' ? pose.shrugL : -pose.shrugR;
      _q3.setFromAxisAngle(_t1.set(0, 0, 1), sh);
      B[s + 'Shoulder'].q.copy(qc).multiply(_q3).multiply(B[s + 'Shoulder'].bindQ);
      this._fk(s + 'Shoulder'); this._write(s + 'Shoulder');
    }
    // ---- arms
    this._limb('LeftArm', pose.handL, pose.poleL, pose.twistL, pose.wristL);
    this._limb('RightArm', pose.handR, pose.poleR, pose.twistR, pose.wristR);
    // ---- legs
    this._leg('Left', pose.footL, pose.kneeL, pose.footYawL, pose.footPitchL);
    this._leg('Right', pose.footR, pose.kneeR, pose.footYawR, pose.footPitchR);
  }

  _solve(L, target, pole) {
    // shoulder / hip position already computed
    L.U.p.copy(L.U.bindLocalP).applyQuaternion(L.U.parent.q).add(L.U.parent.p);
    const s = L.U.p;
    const D = _t1.copy(target).sub(s);
    let dist = D.length();
    const maxD = (L.l1 + L.l2) * 0.999;
    dist = Math.min(Math.max(dist, Math.abs(L.l1 - L.l2) + 0.01), maxD);
    const dir = D.normalize();
    const cosA = (L.l1 * L.l1 + dist * dist - L.l2 * L.l2) / (2 * L.l1 * dist);
    const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const pp = _t2.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0).addScaledVector(dir, -dir.y);
    pp.normalize();
    const e = _t3.copy(s).addScaledVector(dir, Math.cos(A) * L.l1).addScaledVector(pp, Math.sin(A) * L.l1);
    const u = _t4.copy(e).sub(s).normalize();
    const tEnd = _t5.copy(s).addScaledVector(dir, dist);
    const w = tEnd.sub(e).normalize();
    const n = new V3().crossVectors(dir, pp).normalize();
    const h = new V3().crossVectors(u, n);
    const h2 = new V3().crossVectors(w, n);
    return { u: u.clone(), w: w.clone(), h, h2, e: e.clone() };
  }

  _limb(name, target, pole, twist, wrist) {
    const L = this.limbs[name], B = this.b;
    const r = this._solve(L, target, pole);
    frameQuat(L.d1, L.f, r.u, r.h, _q1);
    L.U.q.copy(_q1).multiply(L.U.bindQ); this._write(L.U.bone.name);
    this._fk(L.L.bone.name);
    frameQuat(L.d2, L.f, r.w, r.h2, _q2);
    _q3.setFromAxisAngle(r.w, twist);
    _q2.premultiply(_q3);
    L.L.q.copy(_q2).multiply(L.L.bindQ); this._write(L.L.bone.name);
    this._fk(L.E.bone.name);
    // wrist flex about hinge axis
    if (wrist) { _q4.setFromAxisAngle(new V3().crossVectors(r.w, r.h2), wrist); _q2.premultiply(_q4); }
    L.E.q.copy(_q2).multiply(L.E.bindQ); this._write(L.E.bone.name);
  }

  _leg(s, foot, knee, yaw, pitch) {
    const L = this.limbs[s + 'Leg'], B = this.b;
    // foot orientation
    const qf = eulerQ(yaw, pitch, 0, _q4);
    // ankle target: sole point + ankle offset rotated
    const ankleOff = _t5.set(0, this.ankleH, -0.03).applyQuaternion(qf);
    const target = new V3().copy(foot).add(ankleOff);
    const r = this._solve(L, target, knee);
    frameQuat(L.d1, L.f, r.u, r.h, _q1);
    L.U.q.copy(_q1).multiply(L.U.bindQ); this._write(L.U.bone.name);
    this._fk(L.L.bone.name);
    frameQuat(L.d2, L.f, r.w, r.h2, _q2);
    L.L.q.copy(_q2).multiply(L.L.bindQ); this._write(L.L.bone.name);
    this._fk(L.E.bone.name);
    L.E.q.copy(qf).multiply(L.E.bindQ); this._write(L.E.bone.name);
  }

  // char-space positions useful for gameplay
  gloveTip(side, out) { // centre of the glove punch surface
    const d = this.b[side + 'Hand'];
    const f = this.gloveFrames[side];
    return out.copy(f.y).applyQuaternion(_q1.copy(d.q).multiply(d.bindQ.clone().invert())).multiplyScalar(0.1).add(d.p);
  }
}
