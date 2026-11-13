// Weapon models. The sniper rifle and pistol are Poly Haven GLB assets; the assault
// rifles, carbine, SMG and LMG are original in-house models authored in code
// (profile extrusions + lathed parts) so every attachment can be mounted modularly.
// Model space: forward = -Z, up = +Y, right = +X, origin at the pistol grip.
import type { AttachmentSet } from '@shared/weapons';
import * as pc from 'playcanvas';
import type { Assets } from '../core/assets';
import type { Engine } from '../core/engine';
import { MeshBuilder } from './meshBuilder';
import { sanitizeMaterial } from './world';

export interface WeaponModel {
  root: pc.Entity;
  mag: pc.Entity | null;
  bolt: pc.Entity | null;
  /** Resting local position of the bolt / slide entity. */
  boltRest: pc.Vec3;
  /** Local axis the bolt / slide travels along when cycling. */
  boltAxis: pc.Vec3;
  boltTravel: number;
  magRest: pc.Vec3;
  muzzle: pc.Vec3;
  /** Point on the sight line the eye looks through. */
  sight: pc.Vec3;
  gripL: pc.Vec3;
  gripR: pc.Vec3;
  eject: pc.Vec3;
  /** Reticle (red dot) mesh instance, only visible while aiming. */
  reticle: pc.Entity | null;
  kind: 'rifle' | 'pistol';
}

interface GunSpec {
  recvLen: number; recvH: number; recvW: number;
  handguard: number; barrel: number; barrelR: number;
  stock: 'collapsible' | 'fixed' | 'folding';
  mag: 'curved' | 'straight' | 'smg' | 'box';
  body: [number, number, number];
  furniture: [number, number, number];
  bipod?: boolean;
  carryHandle?: boolean;
}

const BLACK: [number, number, number] = [0.15, 0.155, 0.165];
const SPECS: Record<string, GunSpec> = {
  kr7: { recvLen: 0.22, recvH: 0.065, recvW: 0.046, handguard: 0.3, barrel: 0.13, barrelR: 0.0095, stock: 'collapsible', mag: 'curved', body: BLACK, furniture: [0.2, 0.21, 0.22] },
  mx4: { recvLen: 0.25, recvH: 0.075, recvW: 0.05, handguard: 0.33, barrel: 0.2, barrelR: 0.011, stock: 'fixed', mag: 'straight', body: [0.17, 0.17, 0.18], furniture: [0.5, 0.41, 0.29] },
  ac8: { recvLen: 0.21, recvH: 0.062, recvW: 0.044, handguard: 0.21, barrel: 0.07, barrelR: 0.0095, stock: 'collapsible', mag: 'curved', body: [0.16, 0.17, 0.16], furniture: [0.27, 0.32, 0.22] },
  viper9: { recvLen: 0.24, recvH: 0.055, recvW: 0.04, handguard: 0.13, barrel: 0.05, barrelR: 0.009, stock: 'folding', mag: 'smg', body: BLACK, furniture: [0.22, 0.22, 0.23] },
  bulwark: { recvLen: 0.32, recvH: 0.085, recvW: 0.06, handguard: 0.26, barrel: 0.3, barrelR: 0.013, stock: 'fixed', mag: 'box', body: [0.17, 0.18, 0.18], furniture: [0.25, 0.27, 0.22], bipod: true, carryHandle: true },
};

const matCache = new Map<string, pc.StandardMaterial>();
function gunMat(color: [number, number, number], metal: number, gloss: number, emissive = 0): pc.StandardMaterial {
  const key = `${color.join(',')}|${metal}|${gloss}|${emissive}`;
  let m = matCache.get(key);
  if (m) return m;
  m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(color[0], color[1], color[2]);
  m.useMetalness = true; m.metalness = metal; m.gloss = gloss;
  if (emissive > 0) { m.emissive = new pc.Color(color[0], color[1], color[2]); m.emissiveIntensity = emissive; m.useLighting = false; }
  m.update();
  matCache.set(key, m);
  return m;
}

function meshEntity(device: pc.GraphicsDevice, name: string, mb: MeshBuilder, material: pc.Material, castShadows = false): pc.Entity {
  const e = new pc.Entity(name);
  if (!mb.empty) e.addComponent('render', { meshInstances: [new pc.MeshInstance(mb.toMesh(device, false), material)], castShadows, receiveShadows: false });
  return e;
}

/** Profile helper: points are [forward, up]; converted to the builder's [z, y] with forward = -Z. */
const prof = (pts: [number, number][]): [number, number][] => pts.map(([f, y]) => [-f, y]);

/** Picatinny style rail with teeth along -Z from f0 to f1 at height y. */
function rail(mb: MeshBuilder, f0: number, f1: number, y: number, w = 0.021): void {
  mb.box(-w / 2, y, -f1, w / 2, y + 0.004, -f0);
  for (let f = f0 + 0.004; f < f1 - 0.006; f += 0.0105) mb.box(-w / 2 - 0.001, y + 0.004, -(f + 0.0055), w / 2 + 0.001, y + 0.0085, -f);
}

function buildProceduralGun(device: pc.GraphicsDevice, spec: GunSpec, att: AttachmentSet, tp: boolean): WeaponModel {
  const root = new pc.Entity('weapon');
  const metal = new MeshBuilder(), poly = new MeshBuilder(), magB = new MeshBuilder(), boltB = new MeshBuilder();
  const hw = spec.recvW / 2;
  const rear = -0.11, front = rear + spec.recvLen; // receiver extents along forward axis
  const top = 0.034, bottom = top - spec.recvH;
  const shortBarrel = att.barrel === 'short', heavy = att.barrel === 'heavy';
  const hgLen = spec.handguard * (shortBarrel ? 0.78 : 1);
  const barrelLen = spec.barrel * (shortBarrel ? 0.55 : heavy ? 1.3 : 1) + (heavy ? 0.03 : 0);
  const barrelR = spec.barrelR * (heavy ? 1.3 : 1);
  const hgEnd = front + hgLen, muzzleBase = hgEnd + barrelLen;

  // ---- receiver (upper + lower) with chamfered profile
  metal.extrude(prof([[rear, top], [front, top], [front, bottom + 0.012], [front - 0.02, bottom], [rear + 0.03, bottom], [rear, bottom + 0.02]]), -hw, hw, 0.004);
  // magazine well
  const mwF0 = spec.mag === 'smg' ? -0.005 : 0.02, mwF1 = mwF0 + (spec.mag === 'box' ? 0.1 : spec.mag === 'smg' ? 0.04 : 0.068);
  if (spec.mag !== 'box') metal.extrude(prof([[mwF0 - 0.006, bottom + 0.004], [mwF1 + 0.006, bottom + 0.004], [mwF1 + 0.004, bottom - 0.04], [mwF0 - 0.004, bottom - 0.036]]), -hw + 0.004, hw - 0.004, 0.002);
  // ejection port + forward assist (right side)
  metal.box(hw, 0.004, -(rear + 0.14), hw + 0.0025, 0.024, -(rear + 0.075));
  metal.cylinder(hw, 0.012, -(rear + 0.045), hw + 0.012, 0.012, -(rear + 0.045), 0.006, 0.006, 8);
  // trigger guard + trigger
  metal.box(-0.004, bottom - 0.043, -0.03, 0.004, bottom - 0.039, 0.03);
  metal.box(-0.004, bottom - 0.043, -0.034, 0.004, bottom, -0.03);
  metal.box(-0.0025, bottom - 0.03, -0.012, 0.0025, bottom - 0.002, -0.007);
  // top rail over receiver + handguard
  rail(metal, rear + 0.005, hgEnd - 0.01, top);

  // ---- pistol grip
  poly.extrude(prof([[-0.035, bottom + 0.004], [-0.078, bottom + 0.004], [-0.118, bottom - 0.105], [-0.074, bottom - 0.118], [-0.03, bottom - 0.03]]), -0.016, 0.016, 0.004);

  // ---- handguard
  const hgTop = top - 0.002, hgBot = -0.036, hgW = hw * 0.96;
  poly.extrude(prof([[front, hgTop], [hgEnd, hgTop], [hgEnd, hgBot + 0.008], [hgEnd - 0.012, hgBot], [front, hgBot]]), -hgW, hgW, 0.006);
  for (let f = front + 0.03; f < hgEnd - 0.04; f += 0.04) { // cooling slots (dark insets on both sides)
    metal.box(-hgW - 0.0006, -0.012, -(f + 0.024), -hgW + 0.002, 0.004, -f);
    metal.box(hgW - 0.002, -0.012, -(f + 0.024), hgW + 0.0006, 0.004, -f);
  }
  rail(metal, front + 0.02, hgEnd - 0.02, hgBot - 0.0085, 0.019); // under rail (teeth point down visually thin)

  // ---- barrel, gas block, muzzle device
  metal.cylinder(0, 0, -front, 0, 0, -muzzleBase, barrelR, barrelR * 0.92, 12);
  metal.cylinder(0, 0, -(hgEnd + 0.01), 0, 0, -(hgEnd + 0.04), barrelR * 1.6, barrelR * 1.6, 10);
  let muzzleTip = muzzleBase;
  if (att.muzzle === 'suppressor') {
    metal.cylinder(0, 0, -(muzzleBase - 0.01), 0, 0, -(muzzleBase + 0.17), 0.02, 0.02, 14);
    metal.cylinder(0, 0, -(muzzleBase + 0.17), 0, 0, -(muzzleBase + 0.176), 0.02, 0.012, 14);
    muzzleTip = muzzleBase + 0.176;
  } else if (att.muzzle === 'compensator') {
    metal.cylinder(0, 0, -muzzleBase, 0, 0, -(muzzleBase + 0.055), 0.0145, 0.0145, 8);
    metal.box(-0.016, 0.004, -(muzzleBase + 0.045), 0.016, 0.009, -(muzzleBase + 0.012));
    muzzleTip = muzzleBase + 0.055;
  } else if (att.muzzle === 'flashhider') {
    metal.cylinder(0, 0, -muzzleBase, 0, 0, -(muzzleBase + 0.05), 0.016, 0.019, 6);
    muzzleTip = muzzleBase + 0.05;
  } else {
    metal.cylinder(0, 0, -muzzleBase, 0, 0, -(muzzleBase + 0.038), 0.0115, 0.0105, 10);
    muzzleTip = muzzleBase + 0.038;
  }

  // ---- stock
  if (spec.stock === 'collapsible') {
    metal.cylinder(0, 0.004, -rear, 0, 0.004, -(rear - 0.2), 0.014, 0.014, 10);
    poly.extrude(prof([[rear - 0.07, 0.026], [rear - 0.235, 0.026], [rear - 0.245, -0.1], [rear - 0.205, -0.1], [rear - 0.13, -0.03], [rear - 0.07, -0.022]]), -0.019, 0.019, 0.005);
  } else if (spec.stock === 'fixed') {
    poly.extrude(prof([[rear, top - 0.004], [rear - 0.25, top - 0.008], [rear - 0.262, -0.105], [rear - 0.225, -0.108], [rear - 0.06, bottom + 0.012], [rear, bottom + 0.022]]), -0.02, 0.02, 0.006);
    metal.box(-0.021, -0.108, -(rear - 0.262), 0.021, top - 0.006, -(rear - 0.268));
  } else {
    for (const y of [0.018, -0.04]) metal.cylinder(0.012, y, -rear, 0.012, y, -(rear - 0.2), 0.005, 0.005, 6);
    metal.box(0.002, -0.07, -(rear - 0.2), 0.022, 0.03, -(rear - 0.214));
    metal.cylinder(0, 0.018, -rear, 0.024, 0.018, -rear, 0.008, 0.008, 8);
  }

  // ---- magazine (separate entity so it can be animated)
  let magRest: pc.Vec3;
  if (spec.mag === 'curved') {
    const long = att.mag === 'extended' ? 0.05 : 0;
    magB.extrude(prof([[mwF0, 0], [mwF1, 0], [mwF1 + 0.022, -0.1 - long], [mwF1 + 0.03 + long * 0.3, -0.165 - long], [mwF0 + 0.03 + long * 0.3, -0.178 - long], [mwF0 + 0.016, -0.1 - long]]), -0.0125, 0.0125, 0.003);
    magRest = new pc.Vec3(0, bottom - 0.012, 0);
  } else if (spec.mag === 'straight') {
    const long = att.mag === 'extended' ? 0.04 : 0;
    magB.extrude(prof([[mwF0, 0], [mwF1, 0], [mwF1 + 0.012, -0.14 - long], [mwF0 + 0.012, -0.146 - long]]), -0.014, 0.014, 0.003);
    magRest = new pc.Vec3(0, bottom - 0.012, 0);
  } else if (spec.mag === 'smg') {
    const long = att.mag === 'extended' ? 0.06 : 0;
    magB.extrude(prof([[mwF0, 0], [mwF1, 0], [mwF1 + 0.008, -0.2 - long], [mwF0 + 0.008, -0.204 - long]]), -0.011, 0.011, 0.002);
    magRest = new pc.Vec3(0, bottom - 0.012, 0);
  } else {
    const big = att.mag === 'extended' ? 1.25 : 1;
    magB.box(-0.045 * big, -0.115 * big, -(mwF1), 0.045 * big, 0, -(mwF0 - 0.02));
    magB.box(-0.03, 0, -(mwF1 - 0.01), 0.01, 0.03, -(mwF0)); // belt feed tray
    magRest = new pc.Vec3(-0.012, bottom - 0.004, 0);
  }

  // ---- charging handle / bolt carrier (separate entity)
  boltB.box(-0.012, 0, -0.03, 0.012, 0.008, 0);
  boltB.box(-0.018, 0.001, -0.006, 0.018, 0.007, 0.004);
  const boltRest = new pc.Vec3(0, top - 0.01, -rear + 0.0);

  // ---- extras
  if (spec.carryHandle) {
    metal.box(-0.006, top + 0.01, -(front + 0.09), 0.006, top + 0.05, -(front + 0.075));
    metal.box(-0.006, top + 0.01, -(front + 0.02), 0.006, top + 0.05, -(front + 0.005));
    metal.cylinder(0, top + 0.05, -(front + 0.0), 0, top + 0.05, -(front + 0.1), 0.007, 0.007, 8);
    metal.box(-hw - 0.004, top - 0.004, -(front - 0.02), hw + 0.004, top + 0.012, -(rear + 0.06)); // feed cover
  }
  if (spec.bipod) {
    for (const sx of [-1, 1]) metal.cylinder(sx * 0.012, hgBot - 0.012, -(hgEnd - 0.03), sx * 0.02, hgBot - 0.02, -(hgEnd - 0.26), 0.005, 0.005, 6);
    metal.box(-0.02, hgBot - 0.018, -(hgEnd - 0.01), 0.02, hgBot - 0.006, -(hgEnd - 0.04));
  }
  // ---- fine detail: gas tube, vent slots, stock buttpad ridges, magazine ribs, selector, bolt release, grip stipple, sling loops
  metal.cylinder(0, top - 0.012, -(front + 0.02), 0, top - 0.012, -(hgEnd - 0.02), 0.006, 0.006, 6);
  for (let f = front + 0.05; f < hgEnd - 0.06; f += 0.055) for (const sx of [-1, 1]) metal.box(sx * (hgW + 0.0005) - 0.001, 0.0, -(f + 0.03), sx * (hgW + 0.0005) + 0.001, 0.02, -f);
  metal.box(hw, bottom + 0.022, -(rear + 0.05), hw + 0.006, bottom + 0.03, -(rear + 0.01));                  // selector
  metal.box(hw, bottom + 0.012, -(front - 0.03), hw + 0.004, bottom + 0.02, -(front - 0.005));               // bolt release
  metal.box(-0.003, bottom - 0.005, -(front - 0.05), 0.003, bottom + 0.004, -(front - 0.03));
  for (let k = 0; k < 6; k++) poly.box(-0.0165, bottom - 0.098 + k * 0.016, -0.115 + k * 0.012 - 0.002, 0.0165, bottom - 0.094 + k * 0.016, -0.052 - k * 0.002 + 0.002); // grip stipple
  metal.cylinder(hw + 0.002, 0.0, -(front - 0.09), hw + 0.016, 0.0, -(front - 0.09), 0.007, 0.007, 8);       // sling loop
  // grip attachments
  const gripF = front + hgLen * 0.55;
  if (att.grip === 'vertical') poly.cylinder(0, hgBot - 0.008, -gripF, 0, hgBot - 0.1, -(gripF - 0.008), 0.014, 0.0125, 10);
  else if (att.grip === 'stubby') poly.cylinder(0, hgBot - 0.008, -gripF, 0, hgBot - 0.058, -gripF, 0.0155, 0.0145, 10);
  else if (att.grip === 'angled') poly.extrude(prof([[gripF - 0.05, hgBot - 0.008], [gripF + 0.045, hgBot - 0.008], [gripF + 0.03, hgBot - 0.03], [gripF - 0.04, hgBot - 0.06], [gripF - 0.06, hgBot - 0.05]]), -0.013, 0.013, 0.003);

  // ---- sights / optics
  let sight = new pc.Vec3(0, top + 0.03, 0.04);
  let reticle: pc.Entity | null = null;
  const opticF = rear + 0.085;
  const railTop = top + 0.0085;
  if (att.optic === 'iron') {
    metal.box(-0.011, railTop, -(rear + 0.03), 0.011, railTop + 0.008, -(rear + 0.012));
    for (const sx of [-1, 1]) metal.box(sx * 0.007 - 0.002, railTop + 0.008, -(rear + 0.026), sx * 0.007 + 0.002, railTop + 0.026, -(rear + 0.016));
    metal.box(-0.008, railTop, -(hgEnd - 0.025), 0.008, railTop + 0.006, -(hgEnd - 0.04));
    metal.box(-0.0012, railTop + 0.006, -(hgEnd - 0.03), 0.0012, railTop + 0.024, -(hgEnd - 0.034));
    sight = new pc.Vec3(0, railTop + 0.0215, -(rear + 0.02));
  } else if (att.optic === 'reddot' || att.optic === 'holo') {
    const holo = att.optic === 'holo';
    const w = holo ? 0.021 : 0.016, h = holo ? 0.034 : 0.027, len = holo ? 0.07 : 0.045;
    metal.box(-w, railTop, -(opticF + len), w, railTop + 0.008, -opticF);
    // hood (frame around the lens)
    metal.box(-w, railTop + 0.008, -(opticF + len), -w + 0.003, railTop + 0.008 + h, -(opticF + (holo ? 0 : len * 0.4)));
    metal.box(w - 0.003, railTop + 0.008, -(opticF + len), w, railTop + 0.008 + h, -(opticF + (holo ? 0 : len * 0.4)));
    metal.box(-w, railTop + 0.005 + h, -(opticF + len), w, railTop + 0.008 + h, -(opticF + (holo ? 0 : len * 0.4)));
    sight = new pc.Vec3(0, railTop + 0.008 + h * 0.5, -(opticF - 0.02));
    const ret = new MeshBuilder();
    const rs = holo ? 0.0035 : 0.0016;
    const zr = -(opticF + len * 0.8);
    ret.quad(-rs, sight.y - rs, zr, rs, sight.y - rs, zr, rs, sight.y + rs, zr, -rs, sight.y + rs, zr);
    if (holo) for (const a of [0, 1, 2, 3]) { // ring segments around the dot
      const ang = (a * Math.PI) / 2, cx = Math.cos(ang) * 0.008, cy = Math.sin(ang) * 0.008;
      ret.quad(cx - 0.0012, sight.y + cy - 0.0012, zr, cx + 0.0012, sight.y + cy - 0.0012, zr, cx + 0.0012, sight.y + cy + 0.0012, zr, cx - 0.0012, sight.y + cy + 0.0012, zr);
    }
    const rm = gunMat([1, 0.12, 0.08], 0, 0, 5);
    reticle = meshEntity(device, 'reticle', ret, rm);
    reticle.enabled = false;
  } else {
    // magnified optics: tube with objective / ocular bells
    const long = att.optic === 'acog' ? 0.14 : att.optic === 'scope12' ? 0.34 : 0.28;
    const r = att.optic === 'scope12' ? 0.019 : 0.016;
    const cy = railTop + 0.03;
    metal.cylinder(0, cy, -(opticF - 0.04), 0, cy, -(opticF - 0.04 + long), r, r, 14);
    metal.cylinder(0, cy, -(opticF - 0.06), 0, cy, -(opticF - 0.03), r * 1.25, r * 1.1, 14);
    metal.cylinder(0, cy, -(opticF - 0.04 + long - 0.05), 0, cy, -(opticF - 0.04 + long + 0.01), r * 1.2, r * 1.5, 14);
    for (const f of [opticF + 0.0, opticF + long * 0.5]) metal.box(-0.012, railTop, -(f + 0.018), 0.012, cy, -f);
    metal.cylinder(0, cy, -(opticF + long * 0.3), 0, cy + r + 0.012, -(opticF + long * 0.3), 0.008, 0.008, 8);
    sight = new pc.Vec3(0, cy, -(opticF - 0.06));
  }

  const body = meshEntity(device, 'body', metal, gunMat(spec.body, 0.6, 0.5), tp);
  const furn = meshEntity(device, 'furniture', poly, gunMat(spec.furniture, 0.05, 0.38), tp);
  const mag = meshEntity(device, 'mag', magB, gunMat(spec.mag === 'box' ? [0.22, 0.25, 0.19] : [0.19, 0.19, 0.2], spec.mag === 'box' ? 0.1 : 0.5, 0.4), tp);
  mag.setLocalPosition(magRest);
  { const r = new MeshBuilder(); for (let k = 0; k < 7; k++) r.box(-0.0135, -0.025 - k * 0.018, -(mwF1 + 0.002), 0.0135, -0.022 - k * 0.018, -(mwF0 + 0.005)); mag.addChild(meshEntity(device, 'ribs', r, gunMat([0.1, 0.1, 0.11], 0.6, 0.4), tp)); }
  const bolt = meshEntity(device, 'bolt', boltB, gunMat([0.16, 0.16, 0.17], 0.95, 0.65), tp);
  bolt.setLocalPosition(boltRest);
  root.addChild(body); root.addChild(furn); root.addChild(mag); root.addChild(bolt);
  if (reticle) root.addChild(reticle);

  return {
    root, mag, bolt, boltRest, boltAxis: new pc.Vec3(0, 0, 1), boltTravel: 0.05, magRest,
    muzzle: new pc.Vec3(0, 0, -muzzleTip), sight,
    gripL: new pc.Vec3(0, hgBot - (att.grip === 'vertical' ? 0.06 : att.grip === 'stubby' ? 0.03 : 0.004), -(att.grip === 'none_g' ? front + hgLen * 0.5 : gripF)),
    gripR: new pc.Vec3(0, bottom - 0.06, 0.07),
    eject: new pc.Vec3(hw + 0.01, 0.014, -(rear + 0.11)),
    reticle, kind: 'rifle',
  };
}

function findChild(root: pc.Entity, name: string): pc.Entity | null {
  return (root.findByName(name) as pc.Entity | null) ?? null;
}

function buildSniper(engine: Engine, assets: Assets, att: AttachmentSet): WeaponModel {
  const root = new pc.Entity('weapon');
  const holder = new pc.Entity('glb');
  const model = assets.instantiate('bolt_action_rifle_7_62');
  holder.addChild(model);
  // GLB: muzzle +X, stock -X  ->  rotate so the muzzle points down -Z and put the grip at the origin
  holder.setLocalEulerAngles(0, 90, 0);
  holder.setLocalPosition(0, 0.035, -0.33);
  root.addChild(holder);
  for (const r of model.findComponents('render') as pc.RenderComponent[]) for (const mi of r.meshInstances) sanitizeMaterial(mi.material as pc.StandardMaterial);
  const bullet = findChild(model, 'bolt_action_rifle_7_62_bullet_54mm');
  if (bullet) bullet.enabled = false;
  const scope = findChild(model, 'bolt_action_rifle_7_62_scope');
  const hasScope = att.optic !== 'iron';
  if (scope) scope.enabled = hasScope;
  const extra = new MeshBuilder();
  let muzzleZ = -0.926;
  if (att.muzzle === 'suppressor') { extra.cylinder(0, 0.08, -0.9, 0, 0.08, -1.1, 0.02, 0.02, 14); muzzleZ = -1.1; }
  else if (att.muzzle === 'flashhider') { extra.cylinder(0, 0.08, -0.92, 0, 0.08, -0.98, 0.014, 0.017, 6); muzzleZ = -0.98; }
  if (att.optic === 'scope12' || att.optic === 'scope8') {
    // larger objective bell + sunshade in front of the stock scope
    const len = att.optic === 'scope12' ? 0.2 : 0.12;
    extra.cylinder(0, 0.106, -0.175, 0, 0.106, -0.175 - len, 0.017, 0.024, 14);
  }
  if (att.barrel === 'heavy') extra.cylinder(0, 0.08, -0.55, 0, 0.08, -0.9, 0.014, 0.012, 10);
  if (!extra.empty) root.addChild(meshEntity(engine.device, 'extras', extra, gunMat(BLACK, 0.85, 0.5)));
  const boltA = findChild(model, 'bolt_action_rifle_7_62_bolt_a');
  const boltB = findChild(model, 'bolt_action_rifle_7_62_bolt_b');
  // group both bolt parts under one entity so they cycle together
  let bolt: pc.Entity | null = null;
  if (boltA && boltB && boltA.parent) {
    bolt = new pc.Entity('bolt');
    (boltA.parent as pc.Entity).addChild(bolt);
    boltA.reparent(bolt); boltB.reparent(bolt);
  }
  return {
    root, mag: null, bolt, boltRest: new pc.Vec3(0, 0, 0), boltAxis: new pc.Vec3(-1, 0, 0), boltTravel: 0.075, magRest: new pc.Vec3(),
    muzzle: new pc.Vec3(0, 0.08, muzzleZ),
    sight: hasScope ? new pc.Vec3(0, 0.106, -0.055) : new pc.Vec3(0, 0.112, -0.06),
    gripL: new pc.Vec3(0, 0.02, -0.5), gripR: new pc.Vec3(0, -0.03, 0.03), eject: new pc.Vec3(0.03, 0.09, -0.1),
    reticle: null, kind: 'rifle',
  };
}

function buildPistol(engine: Engine, assets: Assets, att: AttachmentSet): WeaponModel {
  const root = new pc.Entity('weapon');
  const holder = new pc.Entity('glb');
  const model = assets.instantiate('service_pistol');
  holder.addChild(model);
  holder.setLocalEulerAngles(0, 90, 0);
  holder.setLocalPosition(0, -0.02, -0.015);
  root.addChild(holder);
  for (const n of ['service_pistol_pistol_b', 'service_pistol_slide_b', 'service_pistol_hammer_b', 'service_pistol_trigger_b', 'service_pistol_magazine_empty', 'service_pistol_bullet']) {
    const e = findChild(model, n);
    if (e) e.enabled = false;
  }
  const mag = findChild(model, 'service_pistol_magazine_loaded');
  const magRest = new pc.Vec3(-0.022, -0.012, 0);
  if (mag) mag.setLocalPosition(magRest);
  const slide = findChild(model, 'service_pistol_slide_a');
  const extra = new MeshBuilder();
  let muzzleZ = -0.189;
  if (att.muzzle === 'suppressor') { extra.cylinder(0, 0.042, -0.185, 0, 0.042, -0.32, 0.015, 0.015, 12); muzzleZ = -0.32; }
  else if (att.muzzle === 'compensator') { extra.box(-0.012, 0.028, -0.225, 0.012, 0.058, -0.185); muzzleZ = -0.225; }
  let reticle: pc.Entity | null = null;
  let sight = new pc.Vec3(0, 0.064, 0.0);
  if (att.optic === 'reddot') {
    extra.box(-0.012, 0.06, -0.035, 0.012, 0.066, 0.005);
    extra.box(-0.012, 0.066, -0.035, -0.0095, 0.088, -0.02); extra.box(0.0095, 0.066, -0.035, 0.012, 0.088, -0.02);
    extra.box(-0.012, 0.086, -0.035, 0.012, 0.089, -0.02);
    sight = new pc.Vec3(0, 0.077, 0.0);
    const ret = new MeshBuilder();
    ret.quad(-0.0012, 0.0758, -0.03, 0.0012, 0.0758, -0.03, 0.0012, 0.0782, -0.03, -0.0012, 0.0782, -0.03);
    reticle = meshEntity(engine.device, 'reticle', ret, gunMat([1, 0.12, 0.08], 0, 0, 5));
    reticle.enabled = false;
    root.addChild(reticle);
  }
  if (att.mag === 'extended') extra.box(-0.011, -0.125, 0.004, 0.011, -0.085, 0.04);
  if (!extra.empty) root.addChild(meshEntity(engine.device, 'extras', extra, gunMat(BLACK, 0.85, 0.5)));
  return {
    root, mag, bolt: slide, boltRest: slide ? slide.getLocalPosition().clone() : new pc.Vec3(), boltAxis: new pc.Vec3(-1, 0, 0), boltTravel: 0.032,
    magRest, muzzle: new pc.Vec3(0, 0.042, muzzleZ), sight,
    gripL: new pc.Vec3(-0.02, -0.06, 0.02), gripR: new pc.Vec3(0, -0.05, 0.02), eject: new pc.Vec3(0.02, 0.05, -0.06),
    reticle, kind: 'pistol',
  };
}

/** Build a weapon model. `thirdPerson` models cast shadows and skip tiny first-person-only details. */
/** Game weapon -> realistic model. Values from client/public/assets/weapons/weapons.json (origin = grip on the bore line). */
const REAL: Record<string, { file: string; muzzleZ: number; top: number; bottom: number; sightY: number }> = {
  kr7: { file: 'm4a1', muzzleZ: -0.563, top: 0.075, bottom: -0.203, sightY: 0.058 },
  ac8: { file: 'm4a1', muzzleZ: -0.563, top: 0.075, bottom: -0.203, sightY: 0.058 },
  mx4: { file: 'akm', muzzleZ: -0.607, top: 0.108, bottom: -0.24, sightY: 0.085 },
  viper9: { file: 'mp5', muzzleZ: -0.408, top: 0.05, bottom: -0.226, sightY: 0.04 },
  bulwark: { file: 'm249', muzzleZ: -0.728, top: 0.108, bottom: -0.433, sightY: 0.085 },
};

function buildRealGun(engine: Engine, assets: Assets, id: string, att: AttachmentSet): WeaponModel | null {
  const r = REAL[id];
  if (!r) return null;
  let model: pc.Entity;
  try { model = assets.instantiate(`gun_${r.file}`); } catch { return null; }
  const root = new pc.Entity('weapon');
  root.addChild(model);
  for (const rc of model.findComponents('render') as pc.RenderComponent[]) for (const mi of rc.meshInstances) sanitizeMaterial(mi.material as pc.StandardMaterial);
  let muzzleZ = r.muzzleZ;
  if (att.muzzle === 'suppressor') {
    const sup = new MeshBuilder();
    sup.cylinder(0, 0, muzzleZ + 0.01, 0, 0, muzzleZ - 0.17, 0.02, 0.02, 14);
    sup.cylinder(0, 0, muzzleZ - 0.17, 0, 0, muzzleZ - 0.176, 0.02, 0.012, 14);
    root.addChild(meshEntity(engine.device, 'suppressor', sup, gunMat([0.12, 0.12, 0.13], 0.7, 0.45)));
    muzzleZ -= 0.176;
  }
  return {
    root, mag: null, bolt: null, boltRest: new pc.Vec3(), boltAxis: new pc.Vec3(0, 0, 1), boltTravel: 0, magRest: new pc.Vec3(),
    muzzle: new pc.Vec3(0, 0, muzzleZ), sight: new pc.Vec3(0, r.sightY, 0.02),
    gripL: new pc.Vec3(0, -0.04, muzzleZ * 0.55), gripR: new pc.Vec3(0, -0.075, 0.02), eject: new pc.Vec3(0.03, 0.01, -0.08),
    reticle: null, kind: 'rifle',
  };
}

export function buildWeaponModel(engine: Engine, assets: Assets, weaponId: string, att: AttachmentSet, thirdPerson = false): WeaponModel {
  let model: WeaponModel;
  if (weaponId === 'longbow') model = buildSniper(engine, assets, att);
  else if (weaponId === 'p12') model = buildPistol(engine, assets, att);
  else model = buildRealGun(engine, assets, weaponId, att) ?? buildProceduralGun(engine.device, SPECS[weaponId] ?? SPECS.kr7, att, thirdPerson);
  if (thirdPerson) for (const r of model.root.findComponents('render') as pc.RenderComponent[]) r.castShadows = true;
  return model;
}

/** Simple launcher / gadget models held in first person. */
export function buildGadgetModel(engine: Engine, assets: Assets, kind: string): WeaponModel {
  const device = engine.device;
  const root = new pc.Entity(`gadget-${kind}`);
  const a = new MeshBuilder(), b = new MeshBuilder();
  let muzzle = new pc.Vec3(0, 0.02, -0.3);
  if (kind === 'rocket') {
    a.cylinder(0, 0.03, 0.42, 0, 0.03, -0.48, 0.036, 0.036, 14);
    a.cylinder(0, 0.03, 0.42, 0, 0.03, 0.5, 0.036, 0.06, 14);
    a.cylinder(0, 0.03, -0.48, 0, 0.03, -0.6, 0.03, 0.048, 14); // warhead
    a.cylinder(0, 0.03, -0.6, 0, 0.03, -0.68, 0.048, 0.008, 14);
    b.extrude(prof([[-0.02, -0.006], [-0.06, -0.006], [-0.09, -0.12], [-0.05, -0.13], [-0.01, -0.03]]), -0.015, 0.015, 0.003);
    b.cylinder(0, 0.066, -0.1, 0, 0.11, -0.1, 0.012, 0.012, 8);
    b.box(-0.012, 0.1, -0.16, 0.012, 0.125, -0.06);
    muzzle = new pc.Vec3(0, 0.03, -0.7);
  } else if (kind === 'repair') {
    a.cylinder(0, 0, 0.06, 0, 0, -0.16, 0.022, 0.018, 10);
    a.cylinder(0, 0, -0.16, 0, 0.01, -0.26, 0.007, 0.005, 8);
    b.extrude(prof([[0.02, -0.02], [-0.03, -0.02], [-0.06, -0.12], [-0.02, -0.13]]), -0.014, 0.014, 0.003);
    b.cylinder(0, 0.02, 0.06, 0, 0.02, 0.2, 0.03, 0.03, 10);
    muzzle = new pc.Vec3(0, 0.01, -0.27);
  } else if (kind === 'stim') {
    a.cylinder(0, 0, 0.06, 0, 0, -0.09, 0.013, 0.013, 10);
    a.cylinder(0, 0, -0.09, 0, 0, -0.13, 0.004, 0.002, 6);
    b.cylinder(0, 0, 0.06, 0, 0, 0.085, 0.017, 0.017, 10);
  } else if (kind === 'ammoCrate' || kind === 'medCrate') {
    try {
      const m = assets.instantiate(kind === 'ammoCrate' ? 'ammo_box' : 'medical_box');
      m.setLocalScale(1.1, 1.1, 1.1);
      m.setLocalPosition(0, -0.08, -0.1);
      m.setLocalEulerAngles(0, kind === 'ammoCrate' ? 0 : 90, 0);
      root.addChild(m);
    } catch { a.box(-0.1, -0.08, -0.2, 0.1, 0.06, 0.02); }
  } else if (kind === 'sensor') {
    a.cylinder(0, -0.02, -0.05, 0, 0.03, -0.05, 0.045, 0.04, 12);
    b.cylinder(0, 0.03, -0.05, 0, 0.1, -0.05, 0.004, 0.003, 6);
  } else { // smoke / frag canister
    a.cylinder(0, -0.06, -0.05, 0, 0.05, -0.05, 0.03, 0.03, 12);
    b.cylinder(0, 0.05, -0.05, 0, 0.075, -0.05, 0.016, 0.014, 8);
  }
  const tint: [number, number, number] = kind === 'stim' ? [0.75, 0.2, 0.15] : kind === 'smoke' ? [0.45, 0.5, 0.5] : [0.2, 0.24, 0.17];
  root.addChild(meshEntity(device, 'a', a, gunMat(tint, kind === 'repair' ? 0.8 : 0.3, 0.45)));
  root.addChild(meshEntity(device, 'b', b, gunMat(BLACK, 0.4, 0.4)));
  return {
    root, mag: null, bolt: null, boltRest: new pc.Vec3(), boltAxis: new pc.Vec3(0, 0, 1), boltTravel: 0, magRest: new pc.Vec3(), muzzle,
    sight: new pc.Vec3(0, 0.12, 0.1), gripL: new pc.Vec3(0, -0.01, -0.25), gripR: new pc.Vec3(0, -0.07, 0.03), eject: new pc.Vec3(0.03, 0.03, 0),
    reticle: null, kind: kind === 'rocket' ? 'rifle' : 'pistol',
  };
}

/** Put every render component below `root` on the given layers (e.g. the first-person view model layer). */
export function setLayers(root: pc.Entity, layers: number[]): void {
  for (const r of root.findComponents('render') as pc.RenderComponent[]) r.layers = layers;
}
