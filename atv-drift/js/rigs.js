// Generic loader for extra vehicles: finds / splits wheels, aligns the model to the physics frame
// (origin on the ground, +Z forward, +X left) and returns the same rig interface as car.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const RIG_SPECS = {
  jeep: {
    url: 'assets/jeep.glb', scale: 2.0, yaw: 0, minTrack: 0.8,
    wheels: ['LeftFrontWheel', 'RightFrontWheel', 'LeftRearWheel', 'RightRearWheel'],
    paint: /^Body$/, tune: { engine: 1.0, maxSpeed: 1.0 },
  },
  quad: {
    url: 'assets/quad.glb', scale: 0.0112, yaw: 0, minTrack: 0.58,
    wheels: ['Wheel', 'Wheel2', 'Wheel3', 'Wheel4'], tune: { engine: 0.85, maxSpeed: 0.92 },
  },
  monster: {
    url: 'assets/monster.glb', scale: 0.75, yaw: Math.PI, minTrack: 1.0,
    wheels: ['Monster_Tire_Base001', 'Monster_Tire_Base002', 'Monster_Tire_Base003', 'Monster_Tire_Base004'],
    hide: /Machine_Gun/, paint: /^Body_Top$/, tune: { engine: 1.1, maxSpeed: 0.85 },
  },
  bike: {
    url: 'assets/dirtbike.glb', scale: 1.0, yaw: 0, minTrack: 0.30, bike: true,
    spinMats: /^(Tyres|Rims)$/, head: [0, 0.95, 0.40],
    split: { FL: { c: [0, 0.02, 0.78] }, RL: { c: [0, 0.02, -0.75] }, FR: { empty: true, c: [0, 0.02, 0.78] }, RR: { empty: true, c: [0, 0.02, -0.75] } },
    wheelRadius: 0.36, splitR: 0.37, tune: { engine: 0.95, maxSpeed: 1.0 },
  },
};

const flameTexture = () => {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 30, 2, 32, 50, 60);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(120,220,255,1)');
  g.addColorStop(0.55, 'rgba(60,90,255,0.7)'); g.addColorStop(1, 'rgba(0,0,80,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
};

export async function loadRig(spec, onProgress) {
  const gltf = await new GLTFLoader().loadAsync(spec.url, (e) => { if (e.total) onProgress?.(e.loaded / e.total); });
  const model = gltf.scene;
  if (spec.hide) model.traverse(o => { if (spec.hide.test(o.name)) o.visible = false; });
  model.updateMatrixWorld(true);

  const root = new THREE.Group();
  const top = new THREE.Group(); root.add(top);          // lean / roll group (pivot on the ground)
  const holder = new THREE.Group(); top.add(holder);
  holder.rotation.y = spec.yaw || 0; holder.scale.setScalar(spec.scale);
  const keys = ['FL', 'FR', 'RL', 'RR'];
  const wheels = [];
  const info = [];                                        // {c: root-space centre, R}

  if (spec.split) {
    // geometry is merged: bake into model space, then split triangles per wheel
    const R = spec.wheelRadius, rs = spec.splitR || R + 0.02;
    holder.add(model);
    const meshes = []; model.traverse(o => { if (o.isMesh) meshes.push(o); });
    const wrapOf = {}; const parts = {};
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spec.yaw || 0);
    for (const k of keys) {
      const c = new THREE.Vector3(...spec.split[k].c).multiplyScalar(spec.scale).applyQuaternion(q);
      info.push({ c, R: R * spec.scale });
    }
    const lift = info[0].R - info[0].c.y;
    holder.position.y = lift;
    info.forEach(i => i.c.y += lift);
    for (let i = 0; i < 4; i++) {
      const steer = new THREE.Group(); steer.position.copy(info[i].c); top.add(steer);
      const fork = new THREE.Group(); steer.add(fork);                       // front: the whole steering assembly turns here
      const spin = new THREE.Group(); fork.add(spin);
      const wrap = new THREE.Group(); wrap.scale.setScalar(spec.scale); wrap.rotation.y = spec.yaw || 0; spin.add(wrap);
      const fw = new THREE.Group(); fw.scale.setScalar(spec.scale); fw.rotation.y = spec.yaw || 0; fork.add(fw);
      const wd = { steer, spin, baseY: info[i].R, front: keys[i][0] === 'F', left: keys[i][1] === 'L' };
      if (i === 0 && spec.head) {
        const hd = new THREE.Vector3(...spec.head).multiplyScalar(spec.scale).applyQuaternion(q); hd.y += lift;
        wd.fork = fork; wd.axis = hd.sub(info[0].c).normalize();
        const hp = new THREE.Vector3(...spec.head), c0 = new THREE.Vector3(...spec.split.FL.c);
        const ax = hp.clone().sub(c0).normalize(); spec._plane = { ny: ax.z, nz: -ax.y, p0: hp };       // plane through the steering axis
        wd.forkWrap = fw;
      }
      wheels.push(wd);
      wrapOf[keys[i]] = wrap;
    }
    for (const m of meshes) {
      const geo = m.geometry.clone(); geo.applyMatrix4(m.matrixWorld);
      const pos = geo.attributes.position, idx = geo.index ? geo.index.array : null;
      const nTri = (idx ? idx.length : pos.count) / 3;
      const rest = [], per = { FL: [], RL: [] }, frontEnd = [];
      const matName = m.material?.name || '';
      const spinOK = !spec.spinMats || spec.spinMats.test(matName);
      const pl = spec._plane;
      for (let t = 0; t < nTri; t++) {
        const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
        const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
        let hit = null;
        for (const k of ['FL', 'RL']) {
          const s = spec.split[k].c;
          if (Math.hypot(cy - s[1], cz - s[2]) < rs) { hit = k; break; }
        }
        if (hit && spinOK) per[hit].push(a, b, c);
        else if (pl && cz > 0.2 && pl.ny * (cy - pl.p0.y) + pl.nz * (cz - pl.p0.z) > -0.06) frontEnd.push(a, b, c);
        else rest.push(a, b, c);
      }
      const mk = (list, parent, off) => {
        if (!list.length) return;
        const g = new THREE.BufferGeometry();
        for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k]);
        g.setIndex(new THREE.Uint32BufferAttribute(list, 1));
        const mesh = new THREE.Mesh(g, m.material);
        mesh.castShadow = true; mesh.receiveShadow = true;
        if (off) mesh.position.set(-off[0], -off[1], -off[2]);
        parent.add(mesh);
      };
      m.visible = false;
      const body = new THREE.Group(); holder.add(body); mk(rest, body, null);
      for (const k of ['FL', 'RL']) mk(per[k], wrapOf[k], spec.split[k].c);
      if (frontEnd.length) mk(frontEnd, wheels[0].forkWrap, spec.split.FL.c);
    }
  } else {
    holder.add(model);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const nodes = spec.wheels.map(n => { const o = model.getObjectByName(n); if (!o) throw new Error('missing wheel node ' + n); return o; });
    const raw = nodes.map(o => { box.setFromObject(o); return { o, c: box.getCenter(new THREE.Vector3()), R: box.getSize(new THREE.Vector3()).y / 2 }; });
    const lift = raw[0].R - raw[0].c.y;
    const mx = raw.reduce((a, r) => a + r.c.x, 0) / 4, mz = raw.reduce((a, r) => a + r.c.z, 0) / 4;   // centre on the wheels
    holder.position.set(-mx, lift, -mz);
    for (const r of raw) { r.c.y += lift; r.c.x -= mx; r.c.z -= mz; }
    root.updateMatrixWorld(true);
    for (const r of raw) {
      const steer = new THREE.Group(); steer.position.copy(r.c); top.add(steer);
      const spin = new THREE.Group(); steer.add(spin);
      top.updateMatrixWorld(true);
      spin.attach(r.o);
      wheels.push({ steer, spin, baseY: r.R, front: r.c.z > 0, left: r.c.x > 0 });
      info.push(r);
    }
  }
  root.updateMatrixWorld(true);

  // shadows, paint
  const paintMats = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = !/glass|window|gls/i.test(o.material?.name || ''); o.receiveShadow = true;
    if (spec.paint && spec.paint.test(o.material?.name || '')) paintMats.add(o.material);
  });
  const bb = new THREE.Box3().setFromObject(holder);
  const real = info.filter((_, i) => !(spec.split && spec.split[keys[i]]?.empty));
  const avg = (f) => info.reduce((s, i) => s + f(i), 0) / info.length;
  const spec2 = {
    wheelR: avg(i => i.R),
    halfTrack: Math.max(spec.minTrack, avg(i => Math.abs(i.c.x))),
    halfBase: avg(i => Math.abs(i.c.z)),
    tune: spec.tune, bike: !!spec.bike,
  };
  void real;

  // flames
  const flameTex = flameTexture();
  const flames = [];
  for (const x of spec.split ? [0] : [0.22, -0.22]) {
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.4).translate(0, -0.6, 0).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    sp.position.set(x, spec2.wheelR + 0.3, bb.min.z - 0.05); sp.visible = false;
    const sp2 = sp.clone(); sp2.rotation.z = Math.PI / 2; sp.add(sp2);
    top.add(sp); flames.push(sp);
  }
  return {
    root, wheels, paint: null, brakeLights: [], reverseLights: [], flames, spec: spec2, paintable: paintMats.size > 0,
    lean: null, bike: !!spec.bike,
    setPaint(hex) {
      for (const p of paintMats) { if (p.userData.m0 === undefined) p.userData.m0 = p.map || null; p.map = null; p.color.set(hex); p.needsUpdate = true; }
    },
  };
}
