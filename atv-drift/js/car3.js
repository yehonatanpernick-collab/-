// Loads the real Can-Am Maverick GLB (Sketchfab "CAN AM maverick" by AGRO3DMODEL, CC BY 4.0).
// The wheels are merged into big meshes, so triangles are split per wheel at load time.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SCALE = 0.92;                  // tyre radius 0.408 -> 0.375 (matches the physics wheel)
const WC = { y: 0.038, z: 1.42, x: 0.89 };   // wheel centre in model space (measured)
const R_SPLIT = 0.44;

export async function loadMaverick(url, onProgress) {
  const gltf = await new GLTFLoader().loadAsync(url, (e) => { if (e.total) onProgress?.(e.loaded / e.total); });
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const root = new THREE.Group();
  const holder = new THREE.Group();            // model space, scaled & lifted so tyres touch y = 0
  holder.scale.setScalar(SCALE);
  holder.position.y = 0.374 - WC.y * SCALE;
  root.add(holder);

  const wheels = [];
  for (const [front, left] of [[true, true], [true, false], [false, true], [false, false]]) {
    const steer = new THREE.Group();
    steer.position.set((left ? WC.x : -WC.x) * SCALE, 0.374, (front ? WC.z : -WC.z) * SCALE);
    const spin = new THREE.Group();
    steer.add(spin);
    root.add(steer);
    wheels.push({ steer, spin, baseY: 0.374, front, left, cx: left ? WC.x : -WC.x, cz: front ? WC.z : -WC.z });
  }
  const wheelOf = (x, y, z) => {
    if (Math.abs(x) < 0.55) return -1;
    const cz = z > 0 ? WC.z : -WC.z;
    if (Math.hypot(y - WC.y, z - cz) > R_SPLIT) return -1;
    return (z > 0 ? 0 : 2) + (x > 0 ? 0 : 1);
  };

  const paintMats = new Set();
  const bodies = [];
  model.traverse(o => { if (o.isMesh) bodies.push(o); });
  const v = new THREE.Vector3();
  for (const m of bodies) {
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);                    // bake into model space
    const pos = geo.attributes.position;
    const idx = geo.index ? geo.index.array : null;
    const nTri = (idx ? idx.length : pos.count) / 3;
    const rest = [], spinI = [[], [], [], []], steerI = [[], [], [], []];
    for (let t = 0; t < nTri; t++) {
      const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
      const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
      const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      const w = wheelOf(cx, cy, cz);
      if (w < 0) rest.push(a, b, c);
      else (Math.abs(cx) > 0.74 ? spinI : steerI)[w].push(a, b, c);
    }
    const ms = m.material;
    if (ms.name === 'paint_red') {
      const p = new THREE.MeshPhysicalMaterial({ color: '#c8102e', roughness: 0.32, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, normalMap: ms.normalMap });
      m.material = p; paintMats.add(p);
    } else { ms.envMapIntensity = 1; }
    const mk = (list, parent, cx, cy, cz) => {
      if (!list.length) return;
      const g = new THREE.BufferGeometry();
      for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k]);
      g.setIndex(list.length > 65535 || pos.count > 65535 ? new THREE.Uint32BufferAttribute(list, 1) : new THREE.Uint16BufferAttribute(list, 1));
      const mesh = new THREE.Mesh(g, m.material);
      mesh.castShadow = !/glass|gls/i.test(m.material.name); mesh.receiveShadow = true;
      mesh.position.set(-cx, -cy, -cz);
      parent.add(mesh);
    };
    // body parts live in the (scaled) holder; wheel parts hang off steer/spin groups at wheel centre
    mk(rest, holder, 0, 0, 0);
    wheels.forEach((w, i) => {
      const s = new THREE.Group(); s.scale.setScalar(SCALE);
      mk(spinI[i], s, w.cx, WC.y, w.cz); if (s.children.length) w.spin.add(s);
      const s2 = new THREE.Group(); s2.scale.setScalar(SCALE);
      mk(steerI[i], s2, w.cx, WC.y, w.cz); if (s2.children.length) w.steer.add(s2);
    });
  }
  // flames at the rear
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
  for (const x of [0.2, -0.2]) {
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.4).translate(0, -0.6, 0).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    sp.position.set(x, 0.62, -1.72); sp.visible = false;
    const sp2 = sp.clone(); sp2.rotation.z = Math.PI / 2; sp.add(sp2);
    root.add(sp); flames.push(sp);
  }
  return {
    root, wheels, paint: null, brakeLights: [], reverseLights: [], flames,
    setPaint(hex) { for (const p of paintMats) p.color.set(hex); },
  };
}
