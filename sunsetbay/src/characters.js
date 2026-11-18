import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildRig, retargetClip, normBone } from './retarget.js';
import { loadGLTF, scene, camera } from './render.js';
import { clamp, damp, wrapA, rnd, pick } from './core.js';
import { interp } from './state.js';

// logical clip -> [file, loop]
export const ANIMS = {
  idle: ['Idle', 1], idle2: ['Happy_Idle', 1], look: ['Looking_Around', 1], phone: ['Talking_On_Phone', 1], text: ['Texting', 1], talk: ['Talking', 1], argue: ['Standing_Arguing', 1], wave: ['Waving', 0],
  walk: ['Walking', 1], walkF: ['Female_Tough_Walk', 1], swagger: ['Swagger_Walk', 1], walkBag: ['Walking_With_Shopping_Bag', 1], drunk: ['Drunk_Walk', 1],
  run: ['Running', 1], sprint: ['Sprint', 1], walkBack: ['Walking_Backward', 1], strafeL: ['Left_Strafe_Walk', 1], strafeR: ['Right_Strafe_Walk', 1],
  jump: ['Jump', 0], runJump: ['Running_Jump', 0], fall: ['Falling', 1], land: ['Landing', 0],
  pistolIdle: ['Pistol_Idle', 1], aim: ['Aim_Pistol', 1], rifleAim: ['Rifle_Aiming_Idle', 1], shoot: ['Shoot_Rifle', 0], reload: ['Reloading', 0],
  punch: ['Cross_Punch', 0], hook: ['Hook_Punch', 0], hit: ['Hit_Reaction', 0], hitBody: ['Hit_To_Body', 0], bigHit: ['Big_Side_Hit', 0],
  knock: ['Knocked_Down', 0], getUp: ['Getting_Up', 0], death1: ['Death_From_The_Front', 0], death2: ['Dying', 0], death3: ['Flying_Back_Death', 0], death4: ['Standing_Death_Backward_01', 0],
  terrified: ['Terrified', 1], fightIdle: ['Fight_Idle', 1],
};
const LOCO = new Set(['walk', 'walkF', 'swagger', 'walkBag', 'drunk', 'run', 'sprint', 'walkBack', 'strafeL', 'strafeR']);
const UPPER = /^(Spine|Spine1|Spine2|Neck|Head|HeadTop_End|LeftShoulder|RightShoulder|LeftArm|RightArm|LeftForeArm|RightForeArm|LeftHand|RightHand|LeftHand.*|RightHand.*)$/;

export const MODELS = {
  adam: 'm', alex: 'm', brian: 'm', bryce: 'm', david: 'm', elizabeth: 'f', james: 'm', jody: 'f', joe: 'm', josh: 'm', kate: 'f', leonard: 'm', lewis: 'm', louise: 'f', martha: 'f', megan: 'f', pete: 'm', remy: 'm', roth: 'f', shanon: 'm', sophie: 'f', suzy: 'f',
  'swat-1': 'm', 'swat-2': 'm', 'swat-3': 'm',
};
export const PED_MODELS = ['alex', 'brian', 'elizabeth', 'james', 'jody', 'joe', 'josh', 'kate', 'leonard', 'lewis', 'louise', 'martha', 'megan', 'pete', 'remy', 'roth', 'shanon', 'sophie', 'suzy'];
export const COP_MODELS = ['swat-1', 'swat-2', 'swat-3'];
export const GANG_MODELS = ['bryce', 'david'];
export const PLAYER_MODEL = 'adam';

class CharLib {
  constructor() { this.models = new Map(); this.src = new Map(); this.pistol = null; }
  async loadAnims(names) {
    await Promise.all(names.map(async n => {
      if (this.src.has(n)) return;
      const file = ANIMS[n][0], g = await loadGLTF(`anim/${file}.glb`);
      this.src.set(n, { clip: g.animations[0], rig: buildRig(g.scene) });
    }));
  }
  async loadModel(name, hi = false) {
    const key = name + (hi ? '@hi' : '');
    if (this.models.has(key)) return this.models.get(key);
    const p = loadGLTF(`${hi ? 'chars_hi' : 'chars'}/${name}.glb`).then(g => {
      const root = g.scene;
      root.traverse(o => { if (o.isBone || /^mixamorig/i.test(o.name)) o.name = 'mixamorig' + normBone(o.name); });
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root), h = box.max.y - box.min.y;
      const rig = buildRig(root);
      root.traverse(o => {
        if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        for (const m of [].concat(o.material)) {
          m.envMapIntensity = 0.75;
          if (m.transparent || m.alphaMap || /hair|lash|brow/i.test(m.name)) { m.transparent = false; m.alphaTest = 0.45; m.depthWrite = true; m.side = THREE.DoubleSide; }
          if (m.roughness !== undefined) m.roughness = Math.max(0.35, m.roughness);
        }
      });
      const entry = { name, gltf: g, root, rig, height: h, minY: box.min.y, clips: new Map(), speeds: new Map(), sex: MODELS[name] || 'm' };
      this.done = this.done || new Map(); if (!hi) this.done.set(name, entry); else this.done.set(name + '@hi', entry);
      return entry;
    });
    this.models.set(key, p); return p;
  }
  clip(entry, logical, part = 'full') {
    const key = logical + ':' + part;
    if (entry.clips.has(key)) return entry.clips.get(key);
    const s = this.src.get(logical); if (!s) return null;
    let full = entry.clips.get(logical + ':full');
    if (!full) {
      full = retargetClip(s.clip, s.rig, entry.rig, { inPlace: true, name: logical });
      entry.clips.set(logical + ':full', full);
      // natural speed of the clip from the source root motion
      const tr = s.clip.tracks.find(t => /Hips\.position$/.test(t.name));
      if (tr) { const v = tr.values, n = v.length / 3; const dx = v[(n - 1) * 3] - v[0], dz = v[(n - 1) * 3 + 2] - v[2]; entry.speeds.set(logical, Math.hypot(dx, dz) / s.clip.duration / Math.max(1e-6, s.rig.hipsHeight)); }
    }
    if (part === 'full') return full;
    const keep = t => { const bone = normBone(t.name.slice(0, t.name.lastIndexOf('.'))); const up = UPPER.test(bone); return part === 'upper' ? up : !up; };
    const c = new THREE.AnimationClip(logical + ':' + part, full.duration, full.tracks.filter(keep));
    entry.clips.set(key, c); return c;
  }
  ready(name) { return this.done && this.done.get(name); }
  instantiateSync(name) {
    const e = this.done && this.done.get(name); if (!e) return null;
    const model = SkeletonUtils.clone(e.root);
    const bones = {}; model.traverse(o => { if (o.isBone) bones[normBone(o.name)] = o; });
    return { entry: e, model, bones };
  }
  async instantiate(name, hi = false) {
    const e = await this.loadModel(name, hi);
    const model = SkeletonUtils.clone(e.root);
    const bones = {}; model.traverse(o => { if (o.isBone) bones[normBone(o.name)] = o; });
    return { entry: e, model, bones };
  }
}
export const lib = new CharLib();

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _sph = new THREE.Sphere();
let HID = 0;
export class Human {
  constructor(inst, kind, height) {
    this.id = ++HID; this.kind = kind; this.entry = inst.entry; this.bones = inst.bones;
    this.root = new THREE.Group(); this.model = inst.model;
    const target = height || (this.entry.sex === 'f' ? rnd(1.62, 1.72) : rnd(1.72, 1.86));
    const s = target / this.entry.height; this.model.scale.setScalar(s); this.model.position.y = -this.entry.minY * s;
    this.height = target; this.root.add(this.model); scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = new Map(); this.base = null; this.upper = null; this.oneShot = null;
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.vx = 0; this.vz = 0; this.vy = 0; this.speed = 0;
    this.hp = kind === 'cop' ? 90 : kind === 'gang' ? 80 : kind === 'player' ? 100 : 45; this.alive = true; this.state = 'normal';
    this.aiming = false; this.aimPitch = 0; this.recoil = 0; this.weapon = 0; this.hidden = false;
    this.ai = {}; this.lodT = 0; this.visible = true; this.dist = 0; this.idleClip = 'idle'; this.walkClip = this.entry.sex === 'f' ? pick(['walk', 'walk', 'walkF', 'walkBag']) : pick(['walk', 'walk', 'swagger', 'walkBag']);
    this.gun = null;
    this.mixer.addEventListener('finished', e => { if (this.onFinished) this.onFinished(e.action); });
  }
  action(logical, part = 'full') {
    const key = logical + ':' + part; let a = this.actions.get(key); if (a) return a;
    const clip = lib.clip(this.entry, logical, part); if (!clip) return null;
    a = this.mixer.clipAction(clip); const loop = ANIMS[logical][1];
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; this.actions.set(key, a); return a;
  }
  // base layer (full or lower body), crossfaded
  playBase(logical, fade = 0.25, ts = 1) {
    const part = this.aiming && !this.oneShotFull ? 'lower' : 'full';
    const a = this.action(logical, part); if (!a) return;
    a.timeScale = ts;
    if (this.base === a) return;
    a.reset(); a.setEffectiveWeight(1); a.play();
    if (this.base) a.crossFadeFrom(this.base, fade, false);
    this.base = a; this.baseName = logical;
  }
  setUpper(logical, fade = 0.15) {
    const a = logical ? this.action(logical, 'upper') : null;
    if (this.upper === a) return;
    if (a) { a.reset(); a.setEffectiveWeight(1); a.play(); if (this.upper) a.crossFadeFrom(this.upper, fade, false); else a.fadeIn(fade); }
    else if (this.upper) this.upper.fadeOut(fade);
    this.upper = a;
  }
  playOnce(logical, { fade = 0.12, ts = 1, full = true, then = null } = {}) {
    const a = this.action(logical, full ? 'full' : 'upper'); if (!a) return 0;
    a.reset(); a.timeScale = ts; a.setEffectiveWeight(1); a.play();
    if (full && this.base) { a.crossFadeFrom(this.base, fade, false); this.base = a; this.baseName = logical; }
    this.oneShot = a; this.oneShotFull = full;
    this.onFinished = act => { if (act === a) { this.oneShot = null; this.oneShotFull = false; if (then) then(); } };
    return a.getClip().duration / ts;
  }
  clipSpeed(logical) { lib.clip(this.entry, logical); const s = this.entry.speeds.get(logical); return (s || 1.4) * this.height * 0.53; }
  // choose locomotion by speed; returns nothing
  locomote(speed, dt, opts = {}) {
    if (this.state !== 'normal' || this.oneShotFull) return;
    const aimingChanged = (this.aiming && this.base && this.base.getClip().name.endsWith(':full')) || (!this.aiming && this.base && this.base.getClip().name.endsWith(':lower'));
    if (aimingChanged) { const n = this.baseName; this.base = null; this.playBase(LOCO.has(n) || n.startsWith('idle') ? n : 'idle', 0.15); }
    if (speed < 0.25) { this.playBase(opts.idle || this.idleClip, 0.3); return; }
    let name = opts.walk || this.walkClip;
    if (speed > 5.6) name = 'sprint'; else if (speed > 2.7) name = 'run';
    if (opts.back) name = speed > 2.7 ? 'walkBack' : 'walkBack';
    const cs = Math.max(0.6, this.clipSpeed(name));
    this.playBase(name, 0.25, clamp(speed / cs, 0.6, 1.6));
  }
  attachGun(gunModel) {
    if (this.gun) return; const hand = this.bones.RightHand; if (!hand || !gunModel) return;
    const g = gunModel.clone(); this.root.updateMatrixWorld(true); const s = 1 / hand.getWorldScale(new THREE.Vector3()).x; g.scale.setScalar(s);
    const o = GUN_GRIP; g.position.set(o.p[0] * s, o.p[1] * s, o.p[2] * s); g.rotation.set(o.r[0], o.r[1], o.r[2]);
    hand.add(g); this.gun = g; g.visible = false;
  }
  setPosition(x, y, z) { this.x = x; this.y = y; this.z = z; this.pX = undefined; this.root.position.set(x, y, z); }
  update(dt, frame) {
    // LOD: skip far / invisible characters
    this.dist = Math.hypot(this.x - camera.position.x, this.z - camera.position.z);
    _sph.center.set(this.x, this.y + 1, this.z); _sph.radius = 1.4;
    const vis = !this.hidden && this.dist < 180 && frustum.intersectsSphere(_sph);
    this.root.visible = !this.hidden && this.dist < 180;
    const a = interp.a;
    if (this.pX !== undefined && a < 1 && Math.abs(this.x - this.pX) + Math.abs(this.z - this.pZ) < 3) { this.root.position.set(this.pX + (this.x - this.pX) * a, this.pY + (this.y - this.pY) * a, this.pZ + (this.z - this.pZ) * a); this.root.rotation.y = this.pYaw + wrapA(this.yaw - this.pYaw) * a; }
    else { this.root.position.set(this.x, this.y, this.z); this.root.rotation.y = this.yaw; }
    const every = this.dist < 35 ? 1 : this.dist < 80 ? 2 : 4;
    this.lodT += dt;
    if (vis && (frame % every === 0 || this.kind === 'player')) { this.mixer.update(this.lodT); this.lodT = 0; this.postPose(); }
    const sh = this.dist < 45; if (sh !== this.shadowOn) { this.shadowOn = sh; this.model.traverse(o => { if (o.isMesh) o.castShadow = sh; }); }
    if (this.gun) this.gun.visible = this.weapon > 0 && this.alive && this.state === 'normal' && !this.hidden;
    this.recoil = Math.max(0, this.recoil - dt * 6);
  }
  postPose() {
    // procedural aim on top of the clip: spine pitch, then point the arm and the gun along the aim line (simple IK)
    if (this.aiming && this.alive && this.state === 'normal' && !(this.oneShot && !this.oneShotFull)) {
      const sp = this.bones.Spine2 || this.bones.Spine1; if (sp) { _q.setFromAxisAngle(_v.set(1, 0, 0), -this.aimPitch * 0.3); sp.quaternion.multiply(_q); }
      const arm = this.bones.RightArm, hand = this.bones.RightHand;
      if (arm && hand && this.gun) {
        this.root.updateMatrixWorld(true);
        const ap = this.aimPitch + this.recoil * 0.12, cp = Math.cos(ap);
        const ry = this.root.rotation.y; _d.set(Math.sin(ry) * cp, Math.sin(ap), Math.cos(ry) * cp);
        arm.getWorldPosition(_s); hand.getWorldPosition(_h); _c.subVectors(_h, _s).normalize();
        rotateBoneWorld(arm, _qa.setFromUnitVectors(_c, _d));
        _g.set(0, 0, 1).applyQuaternion(this.gun.getWorldQuaternion(_qb));
        rotateBoneWorld(hand, _qa.setFromUnitVectors(_g, _d));
      }
    }
  }
  handPos(out) { const h = this.bones.RightHand; if (h) { h.getWorldPosition(out); if (this.gun) { this.gun.updateMatrixWorld(); out.set(0, 0, 0.14).applyMatrix4(this.gun.matrixWorld); } } else out.set(this.x, this.y + 1.4, this.z); return out; }
  dispose() { scene.remove(this.root); this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model); }
}
const _d = new THREE.Vector3(), _s = new THREE.Vector3(), _h = new THREE.Vector3(), _c = new THREE.Vector3(), _g = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qw = new THREE.Quaternion();
function rotateBoneWorld(bone, q) {
  bone.getWorldQuaternion(_qw); bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(q.multiply(_qw)));
  bone.updateMatrixWorld(true);
}
export const GUN_GRIP = { p: [0.004, 0.105, -0.05], r: [-1.678, -0.29, -0.156] };
export const frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
export function updateFrustum() { camera.updateMatrixWorld(); _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(_pm); }
