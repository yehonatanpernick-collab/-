// Third-person soldiers for remote players and bots: skinned Mixamo "Vanguard"
// body (Idle / Walk / Run clips) with procedural layers on top – aim pitch, two-bone
// arm IK onto the weapon, crouch (leg IK), sprint carry pose and a death fall.
import { TEAM_A } from '@shared/config';
import { PF_ADS, PF_ALIVE, PF_CROUCH, PF_INVEHICLE, PF_SLIDE, PF_SPRINT, type RosterEntry } from '@shared/types';
import { WEAPONS, defaultAttachments } from '@shared/weapons';
import * as pc from 'playcanvas';
import type { Assets } from '../core/assets';
import type { Engine } from '../core/engine';
import type { InterpPlayer } from '../game/game';
import { type WeaponModel, buildWeaponModel } from './weapons';

const BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftUpLeg', 'LeftLeg', 'LeftFoot'] as const;
type BoneName = (typeof BONES)[number];

const va = new pc.Vec3(), vb = new pc.Vec3(), vc = new pc.Vec3(), vd = new pc.Vec3(), ve = new pc.Vec3(), vf = new pc.Vec3();
const qa = new pc.Quat(), qb = new pc.Quat();

/** Analytic two-bone IK in world space: moves `end` to `target`, bending towards `pole`. */
function twoBoneIK(upper: pc.Entity, lower: pc.Entity, end: pc.Entity, target: pc.Vec3, pole: pc.Vec3): void {
  const a = va.copy(upper.getPosition()), b = vb.copy(lower.getPosition()), c = vc.copy(end.getPosition());
  const lab = a.distance(b), lcb = b.distance(c);
  const toT = vd.sub2(target, a);
  const lat = Math.max(0.01, Math.min(toT.length(), lab + lcb - 0.004));
  toT.normalize();
  const cosA = Math.max(-1, Math.min(1, (lab * lab + lat * lat - lcb * lcb) / (2 * lab * lat)));
  const d = lab * cosA, h = Math.sqrt(Math.max(0, lab * lab - d * d));
  const pd = ve.sub2(pole, a);
  pd.sub(vf.copy(toT).mulScalar(pd.dot(toT)));
  if (pd.lengthSq() < 1e-8) pd.set(0, -1, 0);
  pd.normalize();
  const elbow = vf.copy(a).add(ve.copy(toT).mulScalar(d)).add(pd.mulScalar(h));
  // upper bone: point at the new elbow
  const cur = vd.sub2(b, a).normalize();
  const want = ve.sub2(elbow, a).normalize();
  qa.setFromDirections(cur, want);
  upper.setRotation(qb.mul2(qa, upper.getRotation()));
  // lower bone: point at the target
  const b2 = lower.getPosition();
  const cur2 = vd.sub2(end.getPosition(), b2).normalize();
  const want2 = ve.sub2(target, b2).normalize();
  qa.setFromDirections(cur2, want2);
  lower.setRotation(qb.mul2(qa, lower.getRotation()));
}

class Avatar {
  readonly root = new pc.Entity('avatar');
  readonly model: pc.Entity;
  readonly rig = new pc.Entity('rig');
  readonly bones = {} as Record<BoneName, pc.Entity>;
  readonly weaponHolder = new pc.Entity('weapon-holder');
  weapons: [WeaponModel | null, WeaponModel | null] = [null, null];
  flash: pc.Entity | null = null;
  flashT = 0;
  state = 'Idle';
  alive = false;
  deadT = 0;
  speed = 0;
  lastX = 0; lastZ = 0;
  crouchK = 0;
  sprintK = 0;
  team = 0;
  primary = -1; secondary = -1; optic = ''; muzzle = '';
  slot = 0;
  has = false;

  constructor(readonly id: number, engine: Engine, assets: Assets) {
    this.model = assets.instantiate('soldier');
    // glTF characters face +Z while the game's forward is -Z: turn the whole rig half a revolution
    this.rig.setLocalEulerAngles(0, 180, 0);
    this.rig.addChild(this.model);
    this.root.addChild(this.rig);
    this.root.addChild(this.weaponHolder);
    for (const n of BONES) {
      const e = this.model.findByName(`mixamorig:${n}`) as pc.Entity | null;
      if (e) this.bones[n] = e;
    }
    const res = assets.containers.get('soldier')?.resource as pc.ContainerResource & { animations: pc.Asset[] };
    this.model.addComponent('anim', { activate: true });
    const anim = this.model.anim as pc.AnimComponent;
    for (const a of res.animations) {
      const track = a.resource as pc.AnimTrack;
      if (track.name === 'TPose') continue;
      anim.assignAnimation(track.name, track);
    }
    anim.baseLayer?.transition('Idle', 0);
    for (const r of this.model.findComponents('render') as pc.RenderComponent[]) {
      r.castShadows = true; r.receiveShadows = true;
      // skinned bounds follow the bind pose, so frustum culling would wrongly hide moving soldiers
      for (const mi of r.meshInstances) mi.cull = false;
    }
    engine.app.root.addChild(this.root);
    this.root.enabled = false;
  }

  play(name: string, blend = 0.18): void {
    if (this.state === name) return;
    this.state = name;
    (this.model.anim as pc.AnimComponent).baseLayer?.transition(name, blend);
  }

  destroy(): void { this.root.destroy(); }
}

export class Avatars {
  private readonly list = new Map<number, Avatar>();
  private readonly teamMats = new Map<number, pc.Material[]>();
  private flashMat: pc.StandardMaterial | null = null;
  private flashMesh: pc.Mesh | null = null;

  constructor(private readonly engine: Engine, private readonly assets: Assets) {}

  clear(): void {
    for (const a of this.list.values()) a.destroy();
    this.list.clear();
  }

  private tintFor(a: Avatar, team: number): void {
    if (a.team === team) return;
    a.team = team;
    const renders = a.model.findComponents('render') as pc.RenderComponent[];
    let idx = 0;
    let mats = this.teamMats.get(team);
    if (!mats) { mats = []; this.teamMats.set(team, mats); }
    for (const r of renders) for (const mi of r.meshInstances) {
      if (!mats[idx]) {
        const m = (mi.material as pc.StandardMaterial).clone();
        if (team === TEAM_A) m.diffuse = new pc.Color(0.62, 0.74, 0.95); else m.diffuse = new pc.Color(1.0, 0.76, 0.6);
        m.update();
        mats[idx] = m;
      }
      mi.material = mats[idx++];
    }
  }

  /** Create / remove avatars to match the roster and (re)build their weapons when loadouts change. */
  sync(roster: RosterEntry[], _myId: number, _myTeam: number): void {
    const seen = new Set<number>();
    for (const r of roster) {
      seen.add(r.id);
      let a = this.list.get(r.id);
      if (!a) { a = new Avatar(r.id, this.engine, this.assets); this.list.set(r.id, a); }
      this.tintFor(a, r.team);
      if (a.primary !== r.primary || a.secondary !== r.secondary || a.optic !== r.optic || a.muzzle !== r.muzzle) {
        a.primary = r.primary; a.secondary = r.secondary; a.optic = r.optic; a.muzzle = r.muzzle;
        for (const w of a.weapons) w?.root.destroy();
        const att = { ...defaultAttachments(), optic: r.optic, muzzle: r.muzzle, grip: 'none_g', barrel: 'std_b' };
        const pw = buildWeaponModel(this.engine, this.assets, WEAPONS[r.primary]?.id ?? 'kr7', att, true);
        const sw = buildWeaponModel(this.engine, this.assets, WEAPONS[r.secondary]?.id ?? 'p12', defaultAttachments(), true);
        a.weapons = [pw, sw];
        a.weaponHolder.addChild(pw.root); a.weaponHolder.addChild(sw.root);
        sw.root.enabled = false;
      }
    }
    for (const [id, a] of this.list) if (!seen.has(id)) { a.destroy(); this.list.delete(id); }
  }

  spawned(id: number): void {
    const a = this.list.get(id);
    if (!a) return;
    a.alive = true; a.deadT = 0; a.has = false;
    // NB: the 'Character' node carries the model's own -90 degree rotation; only the outer rig is touched
    a.rig.setLocalEulerAngles(0, 180, 0);
    a.rig.setLocalPosition(0, 0, 0);
    (a.model.anim as pc.AnimComponent).speed = 1;
    a.weaponHolder.enabled = true;
  }

  died(id: number): void {
    const a = this.list.get(id);
    if (!a || !a.alive) return;
    a.alive = false; a.deadT = 0;
    a.weaponHolder.enabled = false;
  }

  fired(id: number): void {
    const a = this.list.get(id);
    if (!a) return;
    a.flashT = 0.05;
  }

  muzzleWorld(id: number, out: pc.Vec3): pc.Vec3 | null {
    const a = this.list.get(id);
    if (!a || !a.root.enabled) return null;
    const w = a.weapons[a.slot === 1 ? 1 : 0];
    if (!w) return null;
    w.root.getWorldTransform().transformPoint(w.muzzle, out);
    return out;
  }

  private ensureFlash(a: Avatar): pc.Entity {
    if (a.flash) return a.flash;
    if (!this.flashMat) {
      const tex = this.assets.textures.get('flash') ?? null;
      const m = new pc.StandardMaterial();
      m.diffuse = new pc.Color(0, 0, 0); m.emissive = new pc.Color(1, 0.85, 0.55); m.emissiveIntensity = 8;
      if (tex) { m.emissiveMap = tex; m.opacityMap = tex; m.opacityMapChannel = 'a'; }
      m.blendType = pc.BLEND_ADDITIVE; m.depthWrite = false; m.cull = pc.CULLFACE_NONE; m.useLighting = false;
      m.update();
      this.flashMat = m;
      this.flashMesh = pc.Mesh.fromGeometry(this.engine.device, new pc.PlaneGeometry({ halfExtents: new pc.Vec2(0.5, 0.5) }));
    }
    const e = new pc.Entity('tp-flash');
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(this.flashMesh as pc.Mesh, this.flashMat)], castShadows: false, receiveShadows: false });
    this.engine.app.root.addChild(e);
    a.flash = e;
    return e;
  }

  update(dt: number, players: InterpPlayer[], myId: number, firstPerson: boolean, _myTeam: number, _spotted: number[], cam: pc.Vec3): void {
    const present = new Set<number>();
    for (const p of players) {
      const a = this.list.get(p.id);
      if (!a) continue;
      present.add(p.id);
      const aliveFlag = (p.flags & PF_ALIVE) !== 0;
      if (aliveFlag && !a.alive && a.deadT > 0.3) this.spawned(p.id);
      if (aliveFlag && !a.has) { a.alive = true; a.weaponHolder.enabled = true; }
      else if (!aliveFlag && a.alive && a.has) this.died(p.id);
      a.has = true;
      const hideSelf = p.id === myId && firstPerson;
      const inVehicle = (p.flags & PF_INVEHICLE) !== 0;
      const visible = !hideSelf && (a.alive ? aliveFlag : a.deadT < 8 && a.deadT >= 0) && !(inVehicle && a.alive);
      a.root.enabled = visible;
      if (a.flash) a.flash.enabled = false;
      if (!visible) { a.lastX = p.x; a.lastZ = p.z; if (!a.alive) a.deadT += dt; continue; }

      const anim = a.model.anim as pc.AnimComponent;
      if (!a.alive) {
        // death: topple backwards around the feet, then lie still
        a.deadT += dt;
        const t = Math.min(1, a.deadT / 0.55);
        const e = 1 - (1 - t) * (1 - t);
        a.rig.setLocalRotation(new pc.Quat().setFromEulerAngles(86 * e, 0, 0).mul(new pc.Quat().setFromEulerAngles(0, 180, 0)));
        a.rig.setLocalPosition(0, 0.12 * e, 0);
        anim.speed = 0;
        continue;
      }
      a.root.setPosition(p.x, p.y, p.z);
      a.root.setEulerAngles(0, p.yaw * pc.math.RAD_TO_DEG, 0);
      const moved = Math.hypot(p.x - a.lastX, p.z - a.lastZ);
      a.lastX = p.x; a.lastZ = p.z;
      if (dt > 0) a.speed += (Math.min(9, moved / dt) - a.speed) * Math.min(1, dt * 10);
      const crouch = (p.flags & (PF_CROUCH | PF_SLIDE)) !== 0;
      const sprint = (p.flags & PF_SPRINT) !== 0;
      a.crouchK += ((crouch ? 1 : 0) - a.crouchK) * Math.min(1, dt * 9);
      a.sprintK += ((sprint ? 1 : 0) - a.sprintK) * Math.min(1, dt * 8);
      if (a.speed < 0.5) { a.play('Idle'); anim.speed = 1; }
      else if (a.speed < 3.3 || crouch) { a.play('Walk'); anim.speed = Math.max(0.6, Math.min(1.8, a.speed / 1.7)); }
      else { a.play('Run'); anim.speed = Math.max(0.75, Math.min(1.5, a.speed / 5.2)); }

      const far = Math.hypot(p.x - cam.x, p.z - cam.z) > 70;
      const b = a.bones;
      const yawQ = a.root.getRotation();
      const right = va.set(1, 0, 0); yawQ.transformVector(right, right);
      const rightC = new pc.Vec3().copy(right);
      const fwd = new pc.Vec3(0, 0, -1); yawQ.transformVector(fwd, fwd);

      // ---- crouch: drop the hips and re-plant the feet with leg IK
      const dbg = (window as unknown as { __av?: Record<string, boolean> }).__av ?? {};
      if (a.crouchK > 0.02 && b.Hips && !far && !dbg.noCrouch) {
        const lf = new pc.Vec3().copy(b.LeftFoot.getPosition()), rf = new pc.Vec3().copy(b.RightFoot.getPosition());
        const hp = b.Hips.getPosition();
        b.Hips.setPosition(hp.x - fwd.x * 0.06 * a.crouchK, hp.y - 0.46 * a.crouchK, hp.z - fwd.z * 0.06 * a.crouchK);
        const poleL = new pc.Vec3(lf.x + fwd.x * 0.9, lf.y + 0.6, lf.z + fwd.z * 0.9);
        const poleR = new pc.Vec3(rf.x + fwd.x * 0.9, rf.y + 0.6, rf.z + fwd.z * 0.9);
        twoBoneIK(b.LeftUpLeg, b.LeftLeg, b.LeftFoot, lf, poleL);
        twoBoneIK(b.RightUpLeg, b.RightLeg, b.RightFoot, rf, poleR);
      }

      // ---- aim pitch through the spine
      const pitchDeg = p.pitch * pc.math.RAD_TO_DEG * (1 - a.sprintK);
      if (b.Spine1 && b.Spine2 && !dbg.noPitch) {
        qa.setFromAxisAngle(rightC, pitchDeg * 0.3);
        b.Spine1.setRotation(qb.mul2(qa, b.Spine1.getRotation()));
        b.Spine2.setRotation(qb.mul2(qa, b.Spine2.getRotation()));
        if (b.Head) b.Head.setRotation(qb.mul2(qa, b.Head.getRotation()));
      }

      // ---- weapon placement (shouldered / lowered when sprinting)
      const slot = p.slot === 1 ? 1 : 0;
      if (a.slot !== slot || !a.weapons[slot]?.root.enabled) {
        a.slot = slot;
        if (a.weapons[0]) a.weapons[0].root.enabled = slot === 0;
        if (a.weapons[1]) a.weapons[1].root.enabled = slot === 1;
      }
      const w = a.weapons[slot];
      if (w) {
        const pistol = w.kind === 'pistol';
        const shoulderY = 1.43 - 0.5 * a.crouchK;
        const sk = a.sprintK;
        const ads = (p.flags & PF_ADS) !== 0 ? 1 : 0;
        const hx = pistol ? 0.06 : 0.11 - ads * 0.03, hy = shoulderY - (pistol ? 0.02 : 0.03) - sk * 0.28, hz = pistol ? -0.48 : -0.2 - ads * 0.02;
        a.weaponHolder.setLocalPosition(hx + sk * 0.05, hy, hz + sk * 0.06);
        a.weaponHolder.setLocalEulerAngles(pitchDeg - sk * 38, sk * 28, sk * 10);
        if (!far && !dbg.noIK) {
          const wm = w.root.getWorldTransform();
          const rt = new pc.Vec3(); wm.transformPoint(w.gripR, rt);
          const lt = new pc.Vec3(); wm.transformPoint(pistol ? new pc.Vec3(w.gripR.x - 0.03, w.gripR.y, w.gripR.z) : w.gripL, lt);
          const rs = b.RightArm.getPosition(), ls = b.LeftArm.getPosition();
          const poleR = new pc.Vec3(rs.x + rightC.x * 0.5, rs.y - 0.6, rs.z + rightC.z * 0.5);
          const poleL = new pc.Vec3(ls.x - rightC.x * 0.5, ls.y - 0.7, ls.z - rightC.z * 0.5);
          twoBoneIK(b.RightArm, b.RightForeArm, b.RightHand, rt, poleR);
          twoBoneIK(b.LeftArm, b.LeftForeArm, b.LeftHand, lt, poleL);
        }
        if (a.flashT > 0) {
          a.flashT -= dt;
          const f = this.ensureFlash(a);
          f.enabled = true;
          const mp = new pc.Vec3(); w.root.getWorldTransform().transformPoint(w.muzzle, mp);
          f.setPosition(mp);
          f.lookAt(cam);
          f.rotateLocal(90, 0, Math.random() * 360);
          const sc = 0.35 + Math.random() * 0.25;
          f.setLocalScale(sc, sc, sc);
        }
      }
    }
    for (const [id, a] of this.list) if (!present.has(id)) a.root.enabled = false;
  }
}
