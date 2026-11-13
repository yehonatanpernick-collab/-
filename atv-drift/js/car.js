// Loads the buggy model, normalises it and rigs wheels (steer / spin / suspension).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CFG } from './physics.js';

const WHEELBASE = 2.28;

export async function loadCar(url, onProgress) {
  const loader = new GLTFLoader();
  const gltf = await new Promise((res, rej) => loader.load(url, res, (e) => {
    if (e.total) onProgress?.(e.loaded / e.total);
  }, rej));
  const model = gltf.scene;

  const root = new THREE.Group();        // physics-aligned: origin on the ground between wheels, +Z forward
  const norm = new THREE.Group();
  norm.add(model);
  root.add(norm);
  root.updateMatrixWorld(true);

  // classify meshes
  const meshes = [];
  model.traverse(o => { if (o.isMesh) meshes.push(o); });
  const nameOf = (o) => { let s = ''; for (let p = o; p; p = p.parent) s += '|' + (p.name || ''); return s; };
  const box = new THREE.Box3();
  const centerOf = (o) => box.setFromObject(o).getCenter(new THREE.Vector3());

  const tyres = meshes.filter(m => /Wheel(FL|FR|BL|BR)_tyre/i.test(nameOf(m)));
  const front = tyres.filter(m => /WheelF/i.test(nameOf(m))).map(centerOf);
  const back = tyres.filter(m => /WheelB/i.test(nameOf(m))).map(centerOf);
  const avg = (a) => a.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / a.length);
  const fc = avg(front), bc = avg(back);
  const fwd = fc.clone().sub(bc);
  const wb = fwd.length();
  // orientation: forward -> +Z (assumes the export is Y-up, which Sketchfab GLBs are)
  norm.rotation.y = -Math.atan2(fwd.x, fwd.z);
  norm.scale.setScalar(WHEELBASE / wb);
  root.updateMatrixWorld(true);
  // position: wheel centres around origin, tyre bottoms at y=0
  const tb = new THREE.Box3();
  for (const t of tyres) tb.union(box.setFromObject(t));
  const mid = avg(tyres.map(centerOf));
  norm.position.set(-mid.x, -tb.min.y, -mid.z);
  root.updateMatrixWorld(true);

  // materials / shadows
  let paint = null;
  const mats = new Set();
  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = true;
    const ms = Array.isArray(m.material) ? m.material : [m.material];
    for (const mt of ms) {
      mats.add(mt);
      if (mt.name === 'CaraP') paint = mt;
      if (mt.name === 'glass' || mt.name === 'glows') m.castShadow = false;
    }
  }
  for (const mt of mats) { mt.envMapIntensity = 1.0; }

  // lights
  const brakeLights = meshes.filter(m => /lights_brakes/i.test(nameOf(m)));
  const reverseLights = meshes.filter(m => /lights_reverse/i.test(nameOf(m)));

  // wheel rigs
  const wheels = [];
  for (const [isFront, isLeft] of [[true, true], [true, false], [false, true], [false, false]]) {
    // find wheel parts by world position quadrant (robust against naming)
    const parts = meshes.filter(m => {
      const n = nameOf(m);
      if (!/Wheel|caliper/i.test(n)) return false;
      const c = centerOf(m);
      return (c.z > 0) === isFront && (c.x > 0) === isLeft;
    });
    const tyre = parts.find(m => /tyre/i.test(nameOf(m)));
    const c = tyre ? centerOf(tyre) : new THREE.Vector3(isLeft ? 0.7 : -0.7, 0.375, isFront ? 1.14 : -1.14);
    const steer = new THREE.Group();
    steer.position.copy(c);
    root.add(steer);
    const spin = new THREE.Group();
    steer.add(spin);
    root.updateMatrixWorld(true);
    for (const p of parts) {
      if (/caliper/i.test(nameOf(p))) steer.attach(p);
      else spin.attach(p);
    }
    wheels.push({ steer, spin, baseY: c.y, front: isFront, left: isLeft });
  }

  // nitro flames
  const flameTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(32, 30, 2, 32, 50, 60);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(120,220,255,1)');
    g.addColorStop(0.55, 'rgba(60,90,255,0.7)'); g.addColorStop(1, 'rgba(0,0,80,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 128);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const flames = [];
  for (const x of [0.22, -0.22]) {
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.4).translate(0, -0.6, 0).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    sp.position.set(x, 0.72, -1.42);
    sp.visible = false;
    const sp2 = sp.clone(); sp2.rotation.z = Math.PI / 2;
    sp.add(sp2);
    root.add(sp);
    flames.push(sp);
  }

  return {
    root, wheels, paint, brakeLights, reverseLights, flames,
    setPaint(hex) { if (paint) { paint.color.set(hex); } },
  };
}

const _p = new THREE.Vector3();
export function syncCar(car, veh, t) {
  // visual root = CoM position minus CoM offset in body frame
  _p.set(0, -CFG.comHeight, 0).applyQuaternion(veh.q).add(veh.pos);
  car.root.position.copy(_p);
  car.root.quaternion.copy(veh.q);
  const staticY = 0.374 - CFG.comHeight;
  for (let i = 0; i < 4; i++) {
    const w = car.wheels[i];
    // physics wheels: 0 FL(+x), 1 FR, 2 RL, 3 RR
    const pw = veh.wheels.find(x => x.front === w.front && (x.x > 0) === w.left);
    const centerY = pw.anchor.y - pw.susp;            // relative to CoM
    w.steer.position.y = w.baseY + (centerY - staticY);
    w.steer.rotation.y = pw.steerAngle;
    w.spin.rotation.x = pw.spin;
  }
  for (const m of car.brakeLights) m.visible = veh.braking;
  for (const m of car.reverseLights) m.visible = veh.reversing;
  for (const f of car.flames) {
    f.visible = veh.boostActive;
    if (f.visible) { const s = 0.75 + Math.random() * 0.5; f.scale.set(s, s * (1 + Math.random() * 0.4), s); }
  }
}
