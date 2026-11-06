import * as THREE from 'three/webgpu';
import { uniform, vec3, positionLocal, uv, float, mix, smoothstep, time, sin, mx_noise_float, abs, Fn } from 'three/tsl';

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
// shape X → world z (forward), extrude Z → world x
const SWAP = new THREE.Matrix4().set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
type P = number[];
function extrudeSide(pts: P[], depth: number, bevel: number, taper: (y: number, z: number) => number) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) { const p = pts[i]; if (p.length === 6) s.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]); else s.lineTo(p[0], p[1]); }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.85, bevelSegments: 6, curveSegments: 32 });
  g.applyMatrix4(SWAP); g.translate(depth / 2, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * taper(p.getY(i), p.getZ(i)));
  g.computeVertexNormals(); return g;
}

export interface CarRig {
  root: THREE.Group; body: THREE.Group; paint: THREE.MeshPhysicalNodeMaterial;
  wheels: { pivot: THREE.Group; spin: THREE.Group; side: number; front: boolean; base: THREE.Vector3 }[];
  wing: THREE.Group; fold: any; thrust: any; boost: any;
  brake: any; flames: THREE.Object3D[]; rearFlames: THREE.Object3D[]; underLight: THREE.PointLight; headLight: THREE.SpotLight;
}

/** Original transforming GT: wheels sit in pods that rotate 90° to become lift thrusters. */
export function buildCar(paintHex = 0xe9ecef): CarRig {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const fold = uniform(0), thrust = uniform(0), boost = uniform(0), brake = uniform(0);
  const paint = new THREE.MeshPhysicalNodeMaterial({ color: paintHex, metalness: 0.62, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04 });
  (paint as any).envMapIntensity = 1.3;
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0x020304, metalness: 0.2, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.0 });
  const carbon = new THREE.MeshStandardNodeMaterial({ color: 0x101114, roughness: 0.42, metalness: 0.5 });
  // carbon weave
  carbon.colorNode = Fn(() => { const q = uv().mul(80); const w = abs(sin(q.x.add(sin(q.y).mul(1.5)))).mul(0.5).add(0.5); return vec3(0.035, 0.036, 0.04).mul(w.mul(0.6).add(0.6)); })();
  const chrome = new THREE.MeshStandardNodeMaterial({ color: 0xd2d6da, roughness: 0.14, metalness: 1 });
  const rubber = new THREE.MeshStandardNodeMaterial({ color: 0x141414, roughness: 0.9, metalness: 0 });
  const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = body) => { const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };

  add(extrudeSide([[2.3, 0.28], [2.4, 0.44, 2.32, 0.58, 2.02, 0.64], [1.55, 0.72, 1.15, 0.78, 0.95, 0.79], [0.2, 0.83], [-1.25, 0.86], [-1.8, 0.9, -2.15, 0.88, -2.3, 0.72], [-2.36, 0.58, -2.32, 0.38, -2.24, 0.28]], 1.72, 0.13,
    (y, z) => (1 - 0.14 * smooth(1.2, 2.45, z)) * (1 - 0.05 * smooth(-1.6, -2.4, z)) * (1 - 0.13 * smooth(0.6, 0.92, y))), paint);
  add(extrudeSide([[1.04, 0.73], [0.55, 0.98, 0.12, 1.12, -0.28, 1.14], [-0.95, 1.12, -1.55, 1.0, -1.96, 0.82], [-1.62, 0.73]], 1.14, 0.08, (y) => 1 - 0.38 * smooth(0.8, 1.15, y)), glass);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, ry = 0) => { const o = add(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.set(rx, ry, 0); return o; };
  box(1.72, 0.14, 4.1, 0, 0.27, -0.05, carbon);
  box(1.66, 0.18, 0.55, 0, 0.3, -2.22, carbon, -0.38);
  box(1.8, 0.05, 0.42, 0, 0.24, 2.18, carbon);
  for (const s of [-1, 1]) {
    box(0.06, 0.07, 2.1, s * 0.96, 0.3, 0, carbon);
    box(0.05, 0.17, 0.66, s * 0.94, 0.52, -0.62, carbon, 0, s * 0.06);
    const mir = box(0.22, 0.09, 0.14, s * 0.88, 0.9, 0.78, paint); mir.rotation.y = s * 0.2;
  }
  // light signatures
  const headMat = new THREE.MeshBasicNodeMaterial(); headMat.colorNode = vec3(3.2, 3.3, 3.5);
  const tailMat = new THREE.MeshBasicNodeMaterial(); tailMat.colorNode = mix(vec3(2.2, 0.05, 0.04), vec3(7, 0.15, 0.1), brake);
  const lit = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.x = rx; body.add(o); return o; };
  lit(new THREE.BoxGeometry(1.55, 0.03, 0.05), headMat, 0, 0.63, 2.24, 0.5);
  for (const s of [-1, 1]) lit(new THREE.BoxGeometry(0.36, 0.06, 0.05), headMat, s * 0.62, 0.6, 2.2, 0.45);
  lit(new THREE.BoxGeometry(1.66, 0.045, 0.05), tailMat, 0, 0.78, -2.33);
  // four rear plasma nozzles
  const nozzleMat = new THREE.MeshBasicNodeMaterial();
  nozzleMat.colorNode = vec3(0.25, 0.85, 2.4).mul(thrust.mul(2.2).add(0.35)).add(vec3(2.5, 1.0, 0.2).mul(boost.mul(2)));
  for (const x of [-0.6, -0.22, 0.22, 0.6]) {
    const ring = add(new THREE.TorusGeometry(0.13, 0.03, 10, 24), chrome); ring.position.set(x, 0.52, -2.34);
    lit(new THREE.CircleGeometry(0.11, 24).rotateY(Math.PI), nozzleMat, x, 0.52, -2.345);
  }
  // wing (rises in flight)
  const wing = new THREE.Group(); wing.position.set(0, 0.95, -1.98); body.add(wing);
  { const w = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.04, 0.36), carbon); w.position.y = 0.18; w.castShadow = true; wing.add(w);
    for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.18), carbon); st.position.set(s * 0.5, 0.07, 0); wing.add(st); } }
  // wheels in fender pods
  const podG = new THREE.CylinderGeometry(0.48, 0.48, 0.38, 32, 1, true, 0, Math.PI); podG.rotateZ(Math.PI / 2);
  const podMat = paint.clone(); podMat.side = THREE.DoubleSide;
  const discMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  discMat.colorNode = vec3(0.35, 1.2, 3.0).mul(fold).mul(thrust.mul(0.8).add(0.7));
  const wheels: CarRig['wheels'] = [];
  for (const [x, z] of [[-0.93, 1.42], [0.93, 1.42], [-0.93, -1.42], [0.93, -1.42]]) {
    const pod = add(podG, podMat); pod.position.set(x, 0.38, z);
    const pivot = new THREE.Group(); pivot.position.set(x, 0.36, z); body.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const tire = add(new THREE.TorusGeometry(0.29, 0.09, 14, 40), rubber, spin); tire.rotation.y = Math.PI / 2;
    const rim = add(new THREE.CylinderGeometry(0.25, 0.25, 0.22, 28), chrome, spin); rim.rotation.z = Math.PI / 2;
    for (let k = 0; k < 6; k++) { const sp = add(new THREE.BoxGeometry(0.235, 0.045, 0.44), carbon, spin); sp.rotation.x = (k / 6) * Math.PI; sp.position.x = Math.sign(x) * 0.02; }
    for (const s of [1, -1]) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.24, 28), discMat); d.rotation.y = Math.sign(x) * s * Math.PI / 2; d.position.x = Math.sign(x) * s * 0.12; pivot.add(d); }
    wheels.push({ pivot, spin, side: Math.sign(x), front: z > 0, base: new THREE.Vector3(x, 0.36, z) });
  }
  // plasma flames: additive cones with a hot core, flickering in the shader
  const flameMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const tAlong = uv().y.oneMinus();
  const flick = sin(time.mul(55).add(tAlong.mul(16))).mul(0.12).add(0.88).mul(mx_noise_float(vec3(uv().mul(6), time.mul(12))).mul(0.25).add(0.85));
  const hot = mix(vec3(1, 0.97, 0.92), mix(vec3(0.25, 0.78, 1.0), vec3(1.0, 0.55, 0.2), boost), smoothstep(0.0, 0.18, tAlong));
  const tip = mix(vec3(0.1, 0.2, 1.0), vec3(1.0, 0.18, 0.35), boost);
  flameMat.colorNode = mix(hot, tip, smoothstep(0.18, 1.0, tAlong)).mul(tAlong.oneMinus().pow(1.5)).mul(flick).mul(2.4);
  void positionLocal; void float;
  const flameG = new THREE.CylinderGeometry(0.2, 0.025, 1, 20, 6, true).translate(0, -0.5, 0);
  const coreG = new THREE.CylinderGeometry(0.1, 0.01, 1, 12, 4, true).translate(0, -0.5, 0);
  const mkFlame = (x: number, y: number, z: number, rear: boolean) => { const f = new THREE.Group(); f.position.set(x, y, z); if (rear) f.rotation.x = Math.PI / 2; const a = new THREE.Mesh(flameG, flameMat), b = new THREE.Mesh(coreG, flameMat); b.scale.set(1, 0.6, 1); f.add(a, b); f.visible = false; body.add(f); return f; };
  const flames = [[-0.93, 1.42], [0.93, 1.42], [-0.93, -1.42], [0.93, -1.42]].map(([x, z]) => mkFlame(x, 0.22, z, false));
  const rearFlames = [-0.6, -0.22, 0.22, 0.6].map((x) => mkFlame(x, 0.52, -2.36, true));
  const underLight = new THREE.PointLight(0x5fc8ff, 0, 16, 2); underLight.position.set(0, 0.05, 0); root.add(underLight);
  const headLight = new THREE.SpotLight(0xf2f5ff, 0, 120, 0.5, 0.45, 1.3); headLight.position.set(0, 0.7, 2.0); headLight.target.position.set(0, -1, 16); root.add(headLight, headLight.target);
  return { root, body, paint, wheels, wing, fold, thrust, boost, brake, flames, rearFlames, underLight, headLight };
}
