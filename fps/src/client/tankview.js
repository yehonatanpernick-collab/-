// Procedural main battle tank: sloped hull, side skirts, 7 road wheels per side with
// scrolling tracks, faceted turret with ERA blocks, smoke dischargers, commander cupola,
// coax/roof MG, fume extractor + muzzle brake. Damage smoke/fire and burnt wreck state.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const g0 = (g) => (g.index ? g.toNonIndexed() : g);
const merge = (a) => mergeGeometries(a.map(g0));
const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz))); g.translate(x, y, z); return g; };
const cylX = (r, l, x, y, z, s = 16) => { const g = new THREE.CylinderGeometry(r, r, l, s); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return g; };
const cylZ = (r, l, x, y, z, s = 14, r2 = r) => { const g = new THREE.CylinderGeometry(r2, r, l, s); g.rotateX(Math.PI / 2); g.translate(x, y, z); return g; };
const cylY = (r, l, x, y, z, s = 14) => { const g = new THREE.CylinderGeometry(r, r, l, s); g.translate(x, y, z); return g; };

let ASSETS = null;
function assets(macro, tex) {
  if (ASSETS) return ASSETS;
  const mkCamo = (c1, c2, c3) => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.35, envMapIntensity: 0.9 });
    const u = { tMacro: { value: macro }, c1: { value: new THREE.Color(c1) }, c2: { value: new THREE.Color(c2) }, c3: { value: new THREE.Color(c3) }, uBurn: { value: 0 } };
    m.userData.u = u;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tMacro; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform float uBurn; varying vec3 vOP;')
        .replace('#include <map_fragment>', `
          vec2 cu = vOP.xz * 0.09 + vOP.y * 0.05;
          float n1 = texture2D(tMacro, cu).r, n2 = texture2D(tMacro, cu * 1.7 + 0.4).g, fine = texture2D(tMacro, vOP.xz * 1.3 + vOP.y).b;
          vec3 cc = mix(c1, c2, smoothstep(0.5, 0.54, n1)); cc = mix(cc, c3, smoothstep(0.6, 0.63, n2));
          float dirt = smoothstep(1.3, 0.2, vOP.y) * 0.45;
          cc = mix(cc, vec3(0.32, 0.27, 0.2), dirt);
          cc *= 0.85 + fine * 0.3;
          cc = mix(cc, vec3(0.05, 0.045, 0.04) * (0.6 + fine), uBurn);
          diffuseColor.rgb *= cc;`);
    };
    m.customProgramCacheKey = () => 'tankcamo';
    return m;
  };
  ASSETS = {
    camo: { 1: mkCamo(0x7a7454, 0x5a5640, 0x9a9070), 2: mkCamo(0x5a5e50, 0x3e423a, 0x7a7c6a) },
    dark: new THREE.MeshStandardMaterial({ color: 0x1e1e1c, roughness: 0.75, metalness: 0.5 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x222120, roughness: 0.9, metalness: 0.1 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x3a3b3a, roughness: 0.5, metalness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x182838, roughness: 0.05, metalness: 0.9, envMapIntensity: 2 }),
    track: (() => {
      const S = 64, c = document.createElement('canvas'); c.width = 16; c.height = S; const g = c.getContext('2d');
      g.fillStyle = '#2a2826'; g.fillRect(0, 0, 16, S);
      for (let y = 0; y < S; y += 8) { g.fillStyle = '#4a4744'; g.fillRect(0, y, 16, 5); g.fillStyle = '#151413'; g.fillRect(6, y + 5, 4, 3); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1, 18);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0.6 });
    })(),
  };
  // hull geometry: extruded side profile
  const hs = new THREE.Shape();
  hs.moveTo(-3.6, 0.55); hs.lineTo(-3.0, 1.55); hs.lineTo(2.9, 1.62); hs.lineTo(3.55, 1.25); hs.lineTo(3.65, 0.65); hs.lineTo(3.2, 0.45); hs.lineTo(-3.3, 0.45); hs.lineTo(-3.6, 0.55);
  const hull = new THREE.ExtrudeGeometry(hs, { depth: 2.3, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
  hull.translate(0, 0, -1.15); hull.rotateY(-Math.PI / 2); // length along z, front toward -z
  const hullParts = [hull, box(3.5, 0.08, 6.6, 0, 1.56, 0.1), box(3.6, 0.5, 0.3, 0, 1.1, -3.45, -0.5)];
  // fenders & skirts
  for (const s of [-1, 1]) {
    hullParts.push(box(0.65, 0.06, 7.2, s * 1.48, 1.32, 0));
    for (let k = 0; k < 6; k++) hullParts.push(box(0.06, 0.62, 1.12, s * 1.82, 1.0, -2.85 + k * 1.15));
    hullParts.push(box(0.5, 0.35, 1.0, s * 1.4, 1.52, 2.6)); // stowage
    hullParts.push(box(0.5, 0.3, 0.9, s * 1.4, 1.5, 1.4));
  }
  hullParts.push(box(1.2, 0.12, 0.8, 0, 1.68, -2.4)); // driver hatch
  hullParts.push(box(2.6, 0.2, 1.4, 0, 1.68, 2.6)); // engine deck
  for (let k = 0; k < 6; k++) hullParts.push(box(2.4, 0.05, 0.08, 0, 1.79, 2.05 + k * 0.22));
  ASSETS.hullGeo = merge(hullParts);
  const dk = [];
  for (const s of [-1, 1]) { dk.push(box(0.2, 0.15, 0.1, s * 1.2, 0.95, 3.62), box(0.2, 0.12, 0.08, s * 1.4, 1.2, -3.5)); }
  dk.push(box(0.8, 0.06, 0.12, 0, 1.6, -2.82)); // periscopes
  ASSETS.hullDark = merge(dk);
  // wheels
  const wheels = [];
  for (const s of [-1, 1]) {
    for (let k = 0; k < 7; k++) { wheels.push(cylX(0.38, 0.28, s * 1.38, 0.5, -2.55 + k * 0.85, 18)); wheels.push(cylX(0.18, 0.3, s * 1.38, 0.5, -2.55 + k * 0.85, 8)); }
    wheels.push(cylX(0.32, 0.26, s * 1.38, 0.82, -3.35, 14), cylX(0.33, 0.26, s * 1.38, 0.8, 3.3, 14)); // idler, sprocket
    for (let k = 0; k < 3; k++) wheels.push(cylX(0.1, 0.18, s * 1.38, 1.0, -1.7 + k * 1.7, 8)); // return rollers
  }
  ASSETS.wheelGeo = merge(wheels);
  // tracks (loop approximated with boxes along top/bottom + curved ends)
  const tr = [];
  for (const s of [-1, 1]) {
    tr.push(box(0.56, 0.06, 6.6, s * 1.38, 0.1, 0), box(0.56, 0.06, 6.9, s * 1.38, 1.13, 0));
    for (let a = 0; a < 6; a++) {
      const t = (a / 5) * Math.PI;
      tr.push(box(0.56, 0.06, 0.36, s * 1.38, 0.62 - Math.cos(t) * 0.52, -3.3 - Math.sin(t) * 0.45, -t + Math.PI / 2 * 0));
      tr.push(box(0.56, 0.06, 0.36, s * 1.38, 0.62 - Math.cos(t) * 0.52, 3.3 + Math.sin(t) * 0.45, 0));
    }
  }
  ASSETS.trackGeo = merge(tr);
  // turret
  const ts = new THREE.Shape();
  ts.moveTo(-1.6, -1.5); ts.lineTo(-1.7, 0.8); ts.lineTo(-1.3, 1.85); ts.lineTo(1.3, 1.85); ts.lineTo(1.7, 0.8); ts.lineTo(1.6, -1.5); ts.lineTo(-1.6, -1.5);
  const tur = new THREE.ExtrudeGeometry(ts, { depth: 0.72, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
  tur.rotateX(Math.PI / 2); tur.translate(0, 0.8, 0);
  // in shape coords y -> z after rotation; flip so the narrow front points to -z
  tur.scale(1, 1, -1);
  const tp = [tur, box(2.6, 0.5, 1.3, 0, 0.48, 1.9)]; // bustle
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) tp.push(box(0.14, 0.3, 0.5, s * (1.62 - k * 0.05), 0.42, -1.2 + k * 0.6, 0, s * 0.12)); // ERA
    for (let k = 0; k < 4; k++) tp.push(cylZ(0.06, 0.28, s * (1.5), 0.6 + k * 0.1, 0.2 - k * 0.05, 8)); // smoke dischargers
  }
  tp.push(cylY(0.42, 0.25, -0.55, 0.88, 0.5, 14)); // commander cupola
  tp.push(cylY(0.36, 0.08, -0.55, 1.04, 0.5, 14));
  tp.push(box(0.6, 0.35, 0.5, 0.75, 0.9, -0.6)); // gunner sight
  tp.push(box(2.2, 0.08, 1.2, 0, 1.28 - 0.4, 2.0)); // basket floor
  ASSETS.turretGeo = merge(tp);
  ASSETS.turretDark = merge([box(0.5, 0.25, 0.05, 0.75, 0.92, -0.86), cylZ(0.035, 0.9, -0.55, 1.3, 0.2, 6), box(0.15, 0.15, 0.4, -0.55, 1.25, 0.6), cylY(0.015, 2.2, -1.0, 1.9, 1.9, 4), cylY(0.015, 1.8, 1.0, 1.8, 2.2, 4)]);
  ASSETS.turretGlass = merge([box(0.45, 0.18, 0.02, 0.75, 0.92, -0.88)]);
  // gun
  ASSETS.gunGeo = merge([cylZ(0.11, 5.2, 0, 0, -2.75, 16, 0.13), cylZ(0.17, 0.75, 0, 0, -2.3, 16), cylZ(0.16, 0.38, 0, 0, -5.3, 12), box(0.7, 0.62, 0.8, 0, 0, -0.1)]);
  ASSETS.gunDark = merge([box(0.38, 0.06, 0.1, 0, 0, -5.4), cylZ(0.035, 0.5, 0.45, 0.0, -0.6, 6)]);
  void tex;
  return ASSETS;
}

export class TankView {
  constructor(team, macro, tex) {
    const A = assets(macro, tex);
    this.team = team;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.camo = A.camo[team].clone();
    this.camo.onBeforeCompile = A.camo[team].onBeforeCompile;
    this.camo.customProgramCacheKey = A.camo[team].customProgramCacheKey;
    this.camo.userData.u = { ...A.camo[team].userData.u, uBurn: { value: 0 } };
    const camoU = this.camo.userData.u;
    this.camo.onBeforeCompile = (sh) => { A.camo[team].onBeforeCompile(sh); Object.assign(sh.uniforms, camoU); };
    const add = (g, m, parent, cast = true) => { const me = new THREE.Mesh(g, m); me.castShadow = cast; me.receiveShadow = true; parent.add(me); return me; };
    add(A.hullGeo, this.camo, this.body);
    add(A.hullDark, A.dark, this.body);
    this.wheels = add(A.wheelGeo, A.rubber, this.body);
    this.trackMat = A.track.clone(); this.trackMat.map = A.track.map.clone(); this.trackMat.map.needsUpdate = true;
    add(A.trackGeo, this.trackMat, this.body);
    this.turret = new THREE.Group();
    this.turret.position.set(0, 1.6, -0.3);
    this.body.add(this.turret);
    add(A.turretGeo, this.camo, this.turret);
    add(A.turretDark, A.dark, this.turret);
    add(A.turretGlass, A.glass, this.turret);
    this.gun = new THREE.Group();
    this.gun.position.set(0, 0.85, -1.5);
    this.turret.add(this.gun);
    add(A.gunGeo, this.camo, this.gun);
    add(A.gunDark, A.dark, this.gun);
    this.tread = 0; this.alive = true; this.hp = 1000; this.burnT = 0;
  }
  set(s, dt) {
    this.root.position.set(s.x, s.y, s.z);
    this.body.rotation.order = 'YXZ';
    this.body.rotation.set(-s.pitch, s.yaw, s.roll);
    this.turret.rotation.y = s.turretYaw - s.yaw;
    this.gun.rotation.x = s.gunPitch;
    this.tread += (s.speed || 0) * dt;
    this.trackMat.map.offset.y = -this.tread * 0.25;
    if (this.alive !== s.alive) { this.alive = s.alive; this.camo.userData.u.uBurn.value = s.alive ? 0 : 1; this.burnT = 0; }
    this.hp = s.hp;
  }
  muzzleWorld(out) {
    this.gun.updateWorldMatrix(true, false);
    return out.set(0, 0, -5.7).applyMatrix4(this.gun.matrixWorld);
  }
}
