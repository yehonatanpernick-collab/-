
// =====================================================================
// Shared materials
// =====================================================================
const boneMat = new THREE.MeshStandardMaterial({ color: 0xb3a68c, roughness: 0.6, map: boneTex, normalMap: stoneN, normalScale: new V2(0.7, 0.7) });
const blackMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const rustMat = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.75, metalness: 0.7, map: grimeTex, roughnessMap: scratchTex });
const ragMat = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 1, map: clothTex, alphaMap: tatterAlpha(128, 256, 0.55, 30, 4), alphaTest: 0.5, side: THREE.DoubleSide });

const capsule = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 3, seg);
function addMesh(parent, geo, mat, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m;
}
// a bone hanging down from a pivot (pivot at the joint)
function limb(parent, len, r, mat, x = 0, y = 0, z = 0) {
  const pivot = new THREE.Group(); pivot.position.set(x, y, z); parent.add(pivot);
  addMesh(pivot, capsule(r, len), mat, 0, -len / 2, 0);
  addMesh(pivot, new THREE.SphereGeometry(r * 1.45, 8, 6), mat, 0, -len, 0);   // joint knob
  return pivot;
}

// ---------------------------------------------------------------------
// Skull with articulated jaw and burning eyes
// ---------------------------------------------------------------------
function makeSkull(mat, eyeColor) {
  const g = new THREE.Group();
  const cr = addMesh(g, new THREE.SphereGeometry(0.13, 18, 14), mat, 0, 0.045, -0.01); cr.scale.set(0.93, 1, 1.12);
  const face = addMesh(g, new THREE.SphereGeometry(0.1, 14, 10), mat, 0, -0.025, 0.055); face.scale.set(0.9, 0.85, 0.75);
  for (const s of [-1, 1]) {
    const cheek = addMesh(g, new THREE.SphereGeometry(0.03, 8, 6), mat, s * 0.065, -0.03, 0.085); cheek.scale.set(1, 0.7, 1.2);
    const sock = addMesh(g, new THREE.SphereGeometry(0.034, 10, 8), blackMat, s * 0.042, 0.0, 0.112, false); sock.scale.set(1, 0.85, 0.55);
    const temple = addMesh(g, new THREE.SphereGeometry(0.03, 8, 6), blackMat, s * 0.105, 0.005, 0.05, false); temple.scale.set(0.4, 1, 1.2);
  }
  const eyeMat = new THREE.MeshBasicMaterial({ color: eyeColor.clone() });
  const eyes = [];
  for (const s of [-1, 1]) eyes.push(addMesh(g, new THREE.SphereGeometry(0.012, 6, 5), eyeMat, s * 0.042, 0.0, 0.118, false));
  const nose = addMesh(g, new THREE.ConeGeometry(0.016, 0.04, 3), blackMat, 0, -0.042, 0.123, false); nose.rotation.x = Math.PI;
  for (let i = -3; i <= 3; i++) addMesh(g, new THREE.BoxGeometry(0.011, 0.022, 0.012), mat, i * 0.0125, -0.078, 0.101 - Math.abs(i) * 0.004, false);
  const jaw = new THREE.Group(); jaw.position.set(0, -0.065, 0.0); g.add(jaw);
  const jb = addMesh(jaw, new THREE.BoxGeometry(0.1, 0.03, 0.095), mat, 0, -0.035, 0.05); jb.scale.set(1, 1, 1);
  const chin = addMesh(jaw, new THREE.SphereGeometry(0.03, 8, 6), mat, 0, -0.04, 0.09); chin.scale.set(1.4, 0.8, 0.8);
  for (let i = -3; i <= 3; i++) addMesh(jaw, new THREE.BoxGeometry(0.011, 0.02, 0.012), mat, i * 0.0122, -0.012, 0.094 - Math.abs(i) * 0.004, false);
  return { g, jaw, eyeMat, eyes };
}

// ---------------------------------------------------------------------
// Ribcage + spine
// ---------------------------------------------------------------------
function makeRibcage(mat) {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const v = addMesh(g, new THREE.CylinderGeometry(0.026, 0.028, 0.036, 7), mat, 0, i * 0.05, -0.1 - Math.sin(i / 8 * Math.PI) * 0.02);
    addMesh(v, new THREE.BoxGeometry(0.012, 0.03, 0.04), mat, 0, 0, -0.03);
  }
  for (let i = 0; i < 6; i++) {
    const r = 0.1 + Math.sin((i + 1) / 7 * Math.PI) * 0.045;
    const rib = addMesh(g, new THREE.TorusGeometry(r, 0.011, 5, 18, Math.PI * 1.5), mat, 0, 0.13 + i * 0.05, -0.02);
    rib.rotation.set(Math.PI / 2 + 0.25, 0, -1.25 * Math.PI); rib.scale.set(1.1, 0.8, 1);
  }
  const st = addMesh(g, new THREE.BoxGeometry(0.03, 0.2, 0.015), mat, 0, 0.28, 0.1); st.rotation.x = 0.2;
  for (const s of [-1, 1]) {   // clavicles
    const cl = addMesh(g, capsule(0.012, 0.15), mat, s * 0.08, 0.43, 0.04); cl.rotation.z = s * Math.PI / 2 * 0.9; cl.rotation.y = s * 0.3;
  }
  return g;
}

// ---------------------------------------------------------------------
// Hand with curling finger bones
// ---------------------------------------------------------------------
function makeHand(mat, len = 1) {
  const g = new THREE.Group(), fingers = [];
  addMesh(g, new THREE.BoxGeometry(0.06, 0.06, 0.025), mat, 0, -0.03, 0);
  for (let i = 0; i < 4; i++) {
    const a = limb(g, 0.045 * len, 0.008, mat, -0.022 + i * 0.015, -0.06, 0);
    const b = limb(a, 0.038 * len, 0.007, mat, 0, -0.045 * len, 0);
    fingers.push(a, b);
  }
  const th = limb(g, 0.04, 0.008, mat, 0.035, -0.025, 0.01); th.rotation.z = 0.7; fingers.push(th);
  return { g, fingers };
}

// ---------------------------------------------------------------------
// Full humanoid skeleton rig. Origin at the feet; +z is forward.
// ---------------------------------------------------------------------
function makeSkeleton(mat, eyeColor, opt = {}) {
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  // pelvis
  const pel = addMesh(hips, new THREE.TorusGeometry(0.1, 0.03, 6, 14, Math.PI * 1.3), mat, 0, 0, 0); pel.rotation.set(Math.PI / 2, 0, -0.65 * Math.PI + Math.PI);
  for (const s of [-1, 1]) { const w = addMesh(hips, new THREE.SphereGeometry(0.07, 8, 6), mat, s * 0.09, 0.03, -0.01); w.scale.set(0.6, 1, 1.1); }
  const chest = new THREE.Group(); chest.position.y = 0.05; hips.add(chest);
  const cage = makeRibcage(mat); chest.add(cage);
  const neck = new THREE.Group(); neck.position.set(0, 0.47, -0.04); chest.add(neck);
  for (let i = 0; i < 3; i++) addMesh(neck, new THREE.CylinderGeometry(0.02, 0.022, 0.03, 6), mat, 0, i * 0.035, 0);
  const skull = makeSkull(mat, eyeColor); skull.g.position.set(0, 0.17, 0.02); neck.add(skull.g);
  const arms = [], legs = [];
  for (const s of [1, -1]) {
    const sh = limb(chest, 0.3, 0.022, mat, s * 0.19, 0.42, -0.01); sh.rotation.order = 'YXZ';
    addMesh(sh, new THREE.SphereGeometry(0.045, 8, 6), mat, 0, 0, 0);
    const el = limb(sh, 0.27, 0.017, mat, 0, -0.3, 0);
    addMesh(el, capsule(0.012, 0.25), mat, 0.022, -0.135, 0);  // second forearm bone
    const hand = makeHand(mat); hand.g.position.y = -0.28; el.add(hand.g);
    arms.push({ sh, el, hand, s });
    const th = limb(hips, 0.42, 0.028, mat, s * 0.1, -0.03, 0);
    const kn = limb(th, 0.42, 0.024, mat, 0, -0.42, 0);
    addMesh(kn, capsule(0.012, 0.36), mat, 0.03, -0.21, -0.005);
    const foot = addMesh(kn, new THREE.BoxGeometry(0.07, 0.03, 0.16), mat, 0, -0.45, 0.04);
    legs.push({ th, kn, foot, s });
  }
  return { root, hips, chest, neck, skull, arms, legs };
}

// shared helper to tint every material of an object for hit-flashes
function collectMats(obj) { const s = new Set(); obj.traverse(o => { if (o.isMesh && o.material && o.material.emissive && !SHARED.has(o.material)) s.add(o.material); }); return [...s]; }
const SHARED = new Set([boneMat, rustMat, ragMat]);
// cold fresnel rim so the dead read against the dark
function addRim(mat, r, g, b, p = 3.0) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float rimF = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), ${p.toFixed(1)});
      totalEmissiveRadiance += vec3(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)}) * rimF;`);
  };
  mat.customProgramCacheKey = () => 'rim' + r + g + b + p;
  return mat;
}
