// Headless tuning harness for the vehicle physics (mirrors Vehicle.ts parameters).
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); w.timestep = 1 / 60;
w.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0).setFriction(1));
const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.7, 0).setCanSleep(false).setAngularDamping(0.25));
const mass = 1850;
w.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.3, 2.12).setTranslation(0, 0.62, 0.08).setMassProperties(mass, { x: 0, y: 0.48, z: 0.08 }, { x: 3150, y: 3500, z: 800 }, { x: 0, y: 0, z: 0, w: 1 }), body);
const vc = w.createVehicleController(body); vc.indexUpAxis = 1; vc.setIndexForwardAxis = 2;
const wheels = [[0.84, 1.45], [-0.84, 1.45], [0.84, -1.31], [-0.84, -1.31]];
for (const [x, z] of wheels) {
  const i = vc.numWheels();
  vc.addWheel({ x, y: 0.36 + 0.3 - 0.06, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.3, 0.36);
  vc.setWheelSuspensionStiffness(i, 36); vc.setWheelSuspensionCompression(i, 3.2); vc.setWheelSuspensionRelaxation(i, 3.6);
  vc.setWheelMaxSuspensionForce(i, 120000); vc.setWheelMaxSuspensionTravel(i, 0.22); vc.setWheelFrictionSlip(i, 2.7); vc.setWheelSideFrictionStiffness(i, 1);
}
const fwd = () => { const r = body.rotation(); const x = r.x, y = r.y, z = r.z, ww = r.w; return [2 * (x * z + ww * y), 2 * (y * z - ww * x), 1 - 2 * (x * x + y * y)]; };
function step(throttle, brake, steer) {
  body.resetForces(true); body.resetTorques(true);
  const lv = body.linvel(); const f = fwd(); const v = lv.x * f[0] + lv.y * f[1] + lv.z * f[2]; const av = Math.abs(v);
  let drive = throttle * Math.min(15500, 520000 / Math.max(av, 1)); let b = 0;
  if (brake > 0) { if (v > 1) b = brake * 95; else drive = -brake * 7000; }
  if (v > 69) drive = Math.min(drive, 0);
  for (let i = 0; i < 4; i++) { vc.setWheelEngineForce(i, drive * (i < 2 ? 0.42 : 0.58) / 2); vc.setWheelBrake(i, b); }
  const st = -steer * 0.58 / (1 + av / 16); vc.setWheelSteering(0, st); vc.setWheelSteering(1, st);
  const sp = Math.hypot(lv.x, lv.y, lv.z);
  body.addForce({ x: -0.5 * 1.225 * 0.62 * sp * lv.x, y: -1.1 * sp * sp, z: -0.5 * 1.225 * 0.62 * sp * lv.z }, true);
  vc.updateVehicle(1 / 60); w.step(); return v;
}
for (let i = 0; i < 120; i++) step(0, 0, 0);
console.log('rest height', body.translation().y.toFixed(3), 'susp', [0, 1, 2, 3].map((i) => vc.wheelSuspensionLength(i).toFixed(3)).join(','));
let t = 0, v = 0, t100 = null;
while (t < 40) { v = step(1, 0, 0); t += 1 / 60; if (!t100 && v > 27.78) t100 = t; }
console.log('0-100 km/h', t100?.toFixed(2), 's; speed after 40s', (v * 3.6).toFixed(0), 'km/h; z', body.translation().z.toFixed(0));
// brake from current to 0
const z0 = body.translation().z; let tb = 0;
while (v > 0.5 && tb < 30) { v = step(0, 1, 0); tb += 1 / 60; }
console.log('braking from top', tb.toFixed(2), 's dist', (body.translation().z - z0).toFixed(0), 'm');
// 100-0
while (v < 27.78) v = step(1, 0, 0);
const z1 = body.translation().z; while (v > 0.3) v = step(0, 1, 0);
console.log('100-0 distance', (body.translation().z - z1).toFixed(1), 'm');
// steering test: positive steer input at 15 m/s
while (v < 15) v = step(0.6, 0, 0);
const p0 = body.translation();
for (let i = 0; i < 120; i++) v = step(0.3, 0, 1);
const p1 = body.translation(); const f = fwd();
console.log('steer +1 (right?) moved dx', (p1.x - p0.x).toFixed(1), 'dz', (p1.z - p0.z).toFixed(1), 'fwd', f.map((x) => x.toFixed(2)).join(','), 'up y', body.rotation() && 'ok', 'speed', v.toFixed(1));
