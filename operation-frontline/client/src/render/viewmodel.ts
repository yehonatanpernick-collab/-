// First-person view model: weapon + arms with fully procedural animation
// (sway, bob, recoil, ADS, sprint pose, reload, weapon switch, bolt cycling, landing).
import { GADGETS, type GadgetKind } from '@shared/classes';
import { PLAYER } from '@shared/config';
import { clamp, lerp, smoothstep } from '@shared/math';
import type { PlayerState } from '@shared/types';
import type { WeaponCtx } from '@shared/weaponLogic';
import type { WeaponStats } from '@shared/weapons';
import * as pc from 'playcanvas';
import type { Assets } from '../core/assets';
import type { Engine } from '../core/engine';
import { MeshBuilder } from './meshBuilder';
import { type WeaponModel, buildGadgetModel, buildWeaponModel, setLayers } from './weapons';

const DEG = Math.PI / 180;

class Spring {
  v = 0; x = 0;
  constructor(private k: number, private d: number) {}
  step(dt: number, target = 0): number {
    const a = (target - this.x) * this.k - this.v * this.d;
    this.v += a * dt; this.x += this.v * dt;
    return this.x;
  }
  kick(impulse: number): void { this.v += impulse; }
}

function buildArm(device: pc.GraphicsDevice, left: boolean): pc.Entity {
  // local space: hand at the origin gripping along -Z, forearm extends towards +Z
  const sleeve = new MeshBuilder(), glove = new MeshBuilder();
  sleeve.cylinder(0, 0, 0.36, 0, 0, 0.075, 0.052, 0.036, 12, true);
  sleeve.cylinder(0, 0, 0.09, 0, 0, 0.07, 0.041, 0.039, 12, true); // cuff
  const s = left ? -1 : 1;
  glove.extrude([[0.075, -0.016], [0.075, 0.02], [-0.02, 0.024], [-0.03, 0.005], [-0.02, -0.02]], -0.043, 0.043, 0.008); // palm
  for (let i = 0; i < 4; i++) { // curled fingers wrapping around the grip
    const x = -0.034 + i * 0.0225;
    glove.extrude([[-0.02, 0.024], [-0.052, 0.02], [-0.066, -0.004], [-0.052, -0.03], [-0.02, -0.036], [-0.02, -0.02], [-0.04, -0.016], [-0.045, -0.002], [-0.036, 0.008], [-0.02, 0.008]], x - 0.0095, x + 0.0095, 0.003);
  }
  glove.cylinder(s * 0.04, 0.012, 0.03, s * 0.03, 0.03, -0.035, 0.0125, 0.01, 8, true); // thumb
  const e = new pc.Entity(left ? 'armL' : 'armR');
  const sm = new pc.StandardMaterial();
  sm.diffuse = new pc.Color(0.2, 0.23, 0.16); sm.gloss = 0.2; sm.useMetalness = true; sm.metalness = 0; sm.update();
  const gm = new pc.StandardMaterial();
  gm.diffuse = new pc.Color(0.055, 0.055, 0.06); gm.gloss = 0.35; gm.useMetalness = true; gm.metalness = 0; gm.update();
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(sleeve.toMesh(device, false), sm), new pc.MeshInstance(glove.toMesh(device, false), gm)], castShadows: false, receiveShadows: false });
  return e;
}

interface Slot { model: WeaponModel; stats: WeaponStats | null; gadget: GadgetKind | null }

export class ViewModel {
  readonly root = new pc.Entity('viewmodel');
  private readonly pivot = new pc.Entity('pivot');
  private readonly armL: pc.Entity;
  private readonly armR: pc.Entity;
  private slots: (Slot | null)[] = [null, null, null, null];
  private active = -1;
  private readonly flash: pc.Entity;
  private flashT = 0;

  private bobPhase = 0;
  private sprintK = 0;
  private swayX = new Spring(120, 14);
  private swayY = new Spring(120, 14);
  private kickZ = new Spring(260, 22);
  private kickP = new Spring(220, 20);
  private kickR = new Spring(200, 16);
  private land = new Spring(160, 14);
  private shotT = 9;
  private lastSlot = -1;
  private airK = 0;
  /** 0..1 – how far the weapon is lowered (used by the game when the player is in a vehicle etc.). */
  lowered = 0;
  private readonly tmpA = new pc.Vec3();
  private readonly tmpB = new pc.Vec3();
  private readonly tmpM = new pc.Mat4();
  private readonly tmpQ = new pc.Quat();

  constructor(private readonly engine: Engine, private readonly assets: Assets) {
    engine.camera.addChild(this.root);
    this.root.addChild(this.pivot);
    this.armL = buildArm(engine.device, true);
    this.armR = buildArm(engine.device, false);
    this.pivot.addChild(this.armL);
    this.pivot.addChild(this.armR);

    // muzzle flash: three crossed additive quads
    const tex = assets.canvasTexture('flash', 128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.25, 'rgba(255,214,120,0.9)'); g.addColorStop(0.6, 'rgba(255,120,30,0.35)'); g.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,230,170,0.8)'; ctx.lineWidth = 5;
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(a) * s * 0.46, s / 2 + Math.sin(a) * s * 0.46); ctx.stroke(); }
    });
    const fm = new pc.StandardMaterial();
    fm.diffuse = new pc.Color(0, 0, 0); fm.emissive = new pc.Color(1, 1, 1); fm.emissiveMap = tex; fm.opacityMap = tex; fm.opacityMapChannel = 'a';
    fm.emissiveIntensity = 6; fm.blendType = pc.BLEND_ADDITIVE; fm.depthWrite = false; fm.cull = pc.CULLFACE_NONE; fm.useLighting = false;
    fm.update();
    const fb = new MeshBuilder();
    fb.uvScale = 1;
    const q = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number): void => {
      const base = fb.vertexCount;
      fb.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      fb.nrm.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
      fb.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      fb.col.push(255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255);
      fb.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    q(-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0);
    q(-0.5, 0, 0.1, 0.5, 0, 0.1, 0.5, 0, -1.2, -0.5, 0, -1.2);
    q(0, -0.5, 0.1, 0, 0.5, 0.1, 0, 0.5, -1.2, 0, -0.5, -1.2);
    this.flash = new pc.Entity('flash');
    this.flash.addComponent('render', { meshInstances: [new pc.MeshInstance(fb.toMesh(engine.device, false), fm)], castShadows: false, receiveShadows: false });
    this.flash.enabled = false;
    this.pivot.addChild(this.flash);
    setLayers(this.root, [engine.viewLayerId]);
  }

  /** (Re)build the four hand-held items for a loadout. */
  setLoadout(ctx: WeaponCtx): void {
    for (const s of this.slots) s?.model.root.destroy();
    const make = (model: WeaponModel, stats: WeaponStats | null, gadget: GadgetKind | null): Slot => {
      this.pivot.addChild(model.root);
      model.root.enabled = false;
      setLayers(model.root, [this.engine.viewLayerId]);
      return { model, stats, gadget };
    };
    this.slots[0] = make(buildWeaponModel(this.engine, this.assets, ctx.primary.id, ctx.primary.attachments), ctx.primary, null);
    this.slots[1] = make(buildWeaponModel(this.engine, this.assets, ctx.secondary.id, ctx.secondary.attachments), ctx.secondary, null);
    this.slots[2] = make(buildGadgetModel(this.engine, this.assets, ctx.gadgets[0]), null, ctx.gadgets[0]);
    this.slots[3] = ctx.gadgets[1] ? make(buildGadgetModel(this.engine, this.assets, ctx.gadgets[1]), null, ctx.gadgets[1]) : null;
    this.active = -1;
    this.lastSlot = -1;
  }

  get current(): Slot | null { return this.active >= 0 ? this.slots[this.active] : null; }

  setVisible(v: boolean): void { this.root.enabled = v; }

  /** Call when the local player fires a shot. */
  onFire(stats: WeaponStats, ads: number): void {
    const k = lerp(1, 0.45, ads);
    this.kickZ.kick((0.9 + stats.recoil.v * 0.55) * k);
    this.kickP.kick((14 + stats.recoil.v * 10) * k);
    this.kickR.kick((Math.random() - 0.5) * 30 * k);
    this.shotT = 0;
    this.flashT = stats.suppressed ? 0.018 : 0.045;
    const sc = stats.suppressed ? 0.05 : stats.cls === 'sniper' || stats.cls === 'lmg' ? 0.2 : stats.cls === 'pistol' ? 0.11 : 0.15;
    this.flash.setLocalScale(sc * (0.8 + Math.random() * 0.5), sc * (0.8 + Math.random() * 0.5), sc);
    this.flash.setLocalEulerAngles(0, 0, Math.random() * 360);
  }

  onGadget(): void { this.kickZ.kick(1.6); this.kickP.kick(26); this.shotT = 0; }
  onLand(speed: number): void { this.land.kick(-Math.min(1.6, speed * 0.16)); }

  /** World-space muzzle position re-projected so effects drawn by the world camera line up with the weapon. */
  muzzleWorld(out: pc.Vec3): pc.Vec3 {
    const slot = this.current;
    const cam = this.engine.camera;
    if (!slot || !this.root.enabled) { out.copy(cam.getPosition()).add(cam.forward.clone().mulScalar(0.5)); return out; }
    const m = slot.model.root.getWorldTransform();
    m.transformPoint(slot.model.muzzle, this.tmpA);
    const vc = this.engine.viewCamera.camera as pc.CameraComponent, mc = cam.camera as pc.CameraComponent;
    vc.worldToScreen(this.tmpA, this.tmpB);
    mc.screenToWorld(this.tmpB.x, this.tmpB.y, 0.9, out);
    return out;
  }

  ejectWorld(out: pc.Vec3): pc.Vec3 {
    const slot = this.current;
    if (!slot) return out.copy(this.engine.camera.getPosition());
    slot.model.root.getWorldTransform().transformPoint(slot.model.eject, this.tmpA);
    const vc = this.engine.viewCamera.camera as pc.CameraComponent, mc = this.engine.camera.camera as pc.CameraComponent;
    vc.worldToScreen(this.tmpA, this.tmpB);
    mc.screenToWorld(this.tmpB.x, this.tmpB.y, 0.6, out);
    return out;
  }

  private placeArm(arm: pc.Entity, hand: pc.Vec3, elbow: pc.Vec3, roll: number): void {
    arm.setLocalPosition(hand);
    // -Z looks from the elbow through the hand
    this.tmpB.set(hand.x * 2 - elbow.x, hand.y * 2 - elbow.y, hand.z * 2 - elbow.z);
    this.tmpM.setLookAt(hand, this.tmpB, pc.Vec3.UP);
    this.tmpQ.setFromMat4(this.tmpM);
    arm.setLocalRotation(this.tmpQ);
    arm.rotateLocal(0, 0, roll);
  }

  update(dt: number, s: PlayerState, ctx: WeaponCtx, lookDX: number, lookDY: number, scopedOut: boolean): void {
    if (this.active !== s.slot) {
      this.current?.model.root && (this.current.model.root.enabled = false);
      this.active = this.slots[s.slot] ? s.slot : 0;
      const cur = this.current;
      if (cur) cur.model.root.enabled = true;
    }
    const slot = this.current;
    if (!slot) return;
    const model = slot.model, stats = slot.stats;
    const isGun = stats !== null;
    this.shotT += dt;

    // ---------------------------------------------------------------- base pose (hip <-> ADS)
    const ads = isGun ? smoothstep(s.ads) : 0;
    const pistol = model.kind === 'pistol';
    const hipX = pistol ? 0.115 : 0.135, hipY = pistol ? -0.115 : -0.15, hipZ = pistol ? -0.42 : -0.4;
    const relief = stats?.scope ? 0.075 : pistol ? 0.36 : 0.16;
    const adsX = -model.sight.x, adsY = -model.sight.y, adsZ = -relief - model.sight.z;
    let px = lerp(hipX, adsX, ads), py = lerp(hipY, adsY, ads), pz = lerp(hipZ, adsZ, ads);
    let rx = 0, ry = 0, rz = 0;

    // ---------------------------------------------------------------- sprint / crouch / air
    const speed = Math.hypot(s.vx, s.vz);
    this.sprintK = clamp(this.sprintK + (s.sprinting && s.slideT <= 0 ? dt * 6 : -dt * 7), 0, 1);
    const sk = smoothstep(this.sprintK) * (1 - ads);
    px += -0.085 * sk; py += -0.03 * sk; pz += 0.06 * sk;
    ry += 42 * sk; rx += -12 * sk; rz += 14 * sk;
    if (s.slideT > 0) { rz += 18; px += 0.02; py -= 0.02; }
    this.airK = clamp(this.airK + (s.grounded ? -dt * 6 : dt * 4), 0, 1);
    py += 0.012 * this.airK; rx += 3 * this.airK;

    // ---------------------------------------------------------------- bob + sway
    const moving = s.grounded ? clamp(speed / PLAYER.WALK_SPEED, 0, 1.8) : 0;
    this.bobPhase += dt * (4.2 + speed * 1.25) * (moving > 0.05 ? 1 : 0);
    const bobK = moving * lerp(1, 0.12, ads) * (1 + sk * 0.8);
    px += Math.sin(this.bobPhase) * 0.0065 * bobK;
    py += Math.abs(Math.cos(this.bobPhase)) * -0.0055 * bobK + 0.003 * bobK;
    rz += Math.sin(this.bobPhase) * 0.9 * bobK;
    const breathe = performance.now() * 0.001;
    py += Math.sin(breathe * 1.4) * 0.0012 * lerp(1, 0.35, ads);
    px += Math.sin(breathe * 0.9) * 0.0008;
    const swX = this.swayX.step(dt, clamp(-lookDX * 0.045, -4, 4)), swY = this.swayY.step(dt, clamp(-lookDY * 0.045, -4, 4));
    const swayK = lerp(1, 0.25, ads);
    ry += swX * swayK; rx += swY * swayK * 0.8; rz += swX * swayK * 0.6;
    px += swX * 0.0012 * swayK; py -= swY * 0.0012 * swayK;

    // ---------------------------------------------------------------- recoil + landing
    pz += this.kickZ.step(dt) * 0.03;
    rx += this.kickP.step(dt) * 0.25;
    rz += this.kickR.step(dt) * 0.12;
    py += this.land.step(dt) * 0.03;

    // ---------------------------------------------------------------- switching
    const draw = isGun ? (stats as WeaponStats).drawTime : GADGETS[slot.gadget as GadgetKind].drawTime;
    const sw = clamp(s.switchT / Math.max(0.05, draw), 0, 1);
    const swK = Math.max(sw * sw, this.lowered);
    py -= 0.24 * swK; rx -= 34 * swK; rz += 10 * swK;

    // ---------------------------------------------------------------- reload
    let magDrop = 0, boltOff = 0, leftToMag = 0;
    if (isGun && s.reloadT > 0) {
      const st = stats as WeaponStats;
      const empty = (s.slot === 0 ? s.ammo0 : s.ammo1) === 0;
      const total = empty ? st.reloadEmptyTime : st.reloadTime;
      const p = clamp(1 - s.reloadT / total, 0, 1);
      const inOut = smoothstep(clamp(p / 0.12, 0, 1)) * (1 - smoothstep(clamp((p - 0.86) / 0.14, 0, 1)));
      rz += -24 * inOut; rx += 9 * inOut; py -= 0.03 * inOut; px -= 0.02 * inOut;
      if (model.mag) {
        if (p < 0.4) magDrop = smoothstep(clamp((p - 0.14) / 0.2, 0, 1));
        else if (p < 0.5) magDrop = 1;
        else magDrop = 1 - smoothstep(clamp((p - 0.5) / 0.22, 0, 1));
        leftToMag = inOut;
        if (p > 0.72 && p < 0.78) { py += 0.008; rx -= 2; } // seat the magazine
      }
      if (st.boltAction) boltOff = smoothstep(clamp((p - 0.1) / 0.12, 0, 1)) * (1 - smoothstep(clamp((p - 0.8) / 0.1, 0, 1)));
      else if (empty && p > 0.8) boltOff = Math.sin(clamp((p - 0.8) / 0.14, 0, 1) * Math.PI);
    } else if (isGun) {
      const st = stats as WeaponStats;
      if (st.boltAction) {
        // work the bolt between shots
        const c = this.shotT / st.fireInterval;
        if (c > 0.18 && c < 0.9 && s.fireCd > 0) {
          const t = (c - 0.18) / 0.72;
          boltOff = Math.sin(t * Math.PI);
          rz += -14 * boltOff; rx += 4 * boltOff; px += 0.012 * boltOff;
        }
      } else boltOff = clamp(1 - this.shotT / 0.07, 0, 1);
    }
    if (model.bolt) {
      const a = model.boltAxis, t = model.boltTravel * boltOff;
      model.bolt.setLocalPosition(model.boltRest.x + a.x * t, model.boltRest.y + a.y * t, model.boltRest.z + a.z * t);
    }
    if (model.mag) {
      const pistolMag = model.kind === 'pistol';
      model.mag.setLocalPosition(model.magRest.x - (pistolMag ? magDrop * 0.02 : 0), model.magRest.y - magDrop * (pistolMag ? 0.16 : 0.3), model.magRest.z + (pistolMag ? 0 : magDrop * 0.05));
      model.mag.enabled = magDrop < 0.98;
    }
    if (model.reticle) model.reticle.enabled = ads > 0.75;

    this.pivot.setLocalPosition(px, py, pz);
    this.pivot.setLocalEulerAngles(rx, ry, rz);
    model.root.enabled = !scopedOut;
    this.armL.enabled = this.armR.enabled = !scopedOut;

    // ---------------------------------------------------------------- arms
    const gr = this.tmpA.copy(model.gripR);
    this.placeArm(this.armR, gr, new pc.Vec3(gr.x + 0.11, gr.y - 0.16, gr.z + 0.3), -70);
    if (model.kind === 'rifle' || slot.gadget === 'rocket') {
      const gl = new pc.Vec3().copy(model.gripL);
      if (leftToMag > 0 && model.mag) {
        const mp = model.mag.getLocalPosition();
        gl.lerp(gl, new pc.Vec3(mp.x, mp.y - 0.1, mp.z - 0.05), leftToMag);
      }
      gl.y -= 0.022;
      this.placeArm(this.armL, gl, new pc.Vec3(gl.x - 0.2, gl.y - 0.13, gl.z + 0.2), 95);
    } else {
      // two-handed pistol grip / single handed gadget
      const gl = new pc.Vec3(model.gripR.x - 0.035, model.gripR.y - 0.015, model.gripR.z - 0.01);
      if (leftToMag > 0 && model.mag) { const mp = model.mag.getLocalPosition(); gl.lerp(gl, new pc.Vec3(mp.x, mp.y - 0.08, mp.z), leftToMag); }
      this.placeArm(this.armL, gl, new pc.Vec3(gl.x - 0.2, gl.y - 0.12, gl.z + 0.24), 70);
      this.armL.enabled = !scopedOut && (isGun || slot.gadget !== 'stim');
    }

    // ---------------------------------------------------------------- muzzle flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.enabled = !scopedOut;
      this.flash.setLocalPosition(model.muzzle.x, model.muzzle.y, model.muzzle.z - 0.02);
    } else this.flash.enabled = false;
    void DEG;
  }
}
