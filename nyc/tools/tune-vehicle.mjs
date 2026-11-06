// Headless Rapier check of the drive model: axes, 0-100 km/h, top speed, braking, sag, cornering.
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const T = { mass: 1650, power: 460000, maxForce: 15000, drag: 0.36, roll: 18, downforce: 0.9, brake: +process.argv[2] || 55, wheelR: 0.36, rest: 0.32, stiff: 34, compress: 3.4, relax: 4.2, slip: 2.4 };
function make(fwdAxis) {
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); w.timestep = 1 / 120;
  w.createCollider(RAPIER.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0).setFriction(1));
  const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.8, 0).setCanSleep(false).setAngularDamping(0.6));
  w.createCollider(RAPIER.ColliderDesc.cuboid(0.92, 0.3, 2.25).setTranslation(0, 0.55, 0).setMassProperties(T.mass, { x: 0, y: 0.38, z: 0.05 }, { x: T.mass * 1.6, y: T.mass * 2.1, z: T.mass * 0.7 }, { x: 0, y: 0, z: 0, w: 1 }), b);
  const c = w.createVehicleController(b);
  [[-0.88, 1.42], [0.88, 1.42], [-0.88, -1.42], [0.88, -1.42]].forEach(([x, z], i) => {
    c.addWheel({ x, y: 0.36, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, T.rest, T.wheelR);
    c.setWheelSuspensionStiffness(i, T.stiff); c.setWheelSuspensionCompression(i, T.compress); c.setWheelSuspensionRelaxation(i, T.relax);
    c.setWheelMaxSuspensionTravel(i, 0.24); c.setWheelMaxSuspensionForce(i, 60000); c.setWheelFrictionSlip(i, T.slip); c.setWheelSideFrictionStiffness(i, 1);
  });
  c.indexUpAxis = 1; if (fwdAxis !== undefined) c.setIndexForwardAxis = fwdAxis;
  return { w, b, c };
}
function run(fwdAxis, sign, { secs = 30, throttle = (t) => 1, steer = () => 0, brakeAt = 1e9 } = {}) {
  const { w, b, c } = make(fwdAxis); let t = 0, t100 = null, vmax = 0, brakeStart = null, stopDist = null, sag = null;
  for (let k = 0; k < secs * 120; k++) {
    const lv = b.linvel(), r = b.rotation();
    const qz = { x: 2 * (r.x * r.z + r.w * r.y), z: 1 - 2 * (r.x * r.x + r.y * r.y) }; // local +z in world (xz)
    const fs = lv.x * qz.x + lv.z * qz.z; const spd = Math.hypot(lv.x, lv.y, lv.z);
    b.resetForces(true);
    const thr = t < brakeAt ? throttle(t) : 0; let engine = 0, brake = 0;
    if (thr > 0) engine = Math.min(T.maxForce, T.power / Math.max(4, Math.abs(fs))) * thr;
    if (t >= brakeAt) brake = T.brake;
    for (let i = 0; i < 4; i++) { c.setWheelEngineForce(i, sign * engine / 4); c.setWheelBrake(i, brake); c.setWheelSteering(i, i < 2 ? steer(t) : 0); }
    c.updateVehicle(1 / 120);
    const dragF = T.drag * spd + T.roll; b.addForce({ x: -lv.x * dragF, y: 0, z: -lv.z * dragF }, true); b.addForce({ x: 0, y: -T.downforce * spd * spd, z: 0 }, true);
    w.step(); t += 1 / 120;
    if (t > 1.5 && sag === null) sag = (T.rest - c.wheelSuspensionLength(0)).toFixed(3);
    if (t100 === null && fs > 27.78) t100 = t.toFixed(2);
    vmax = Math.max(vmax, fs);
    if (t >= brakeAt && brakeStart === null) brakeStart = { ...b.translation() };
    if (brakeStart && stopDist === null && Math.abs(fs) < 0.3) { const p = b.translation(); stopDist = Math.hypot(p.x - brakeStart.x, p.z - brakeStart.z).toFixed(1); }
  }
  const p = b.translation(), lv = b.linvel();
  return { fwdAxis, sign, t100, vmaxKmh: (vmax * 3.6).toFixed(0), sag, stopDist, end: [p.x.toFixed(1), p.y.toFixed(2), p.z.toFixed(1)], speedEnd: Math.hypot(lv.x, lv.z).toFixed(1) };
}
for (const ax of [undefined, 0, 2]) for (const s of [1, -1]) console.log(JSON.stringify(run(ax, s, { secs: 4 })));
console.log('accel/top/brake', JSON.stringify(run(2, +process.argv[3] || 1, { secs: 40, brakeAt: 30 })));
// cornering at ~60 km/h: steady steer
const turn = run(2, +process.argv[3] || 1, { secs: 14, throttle: (t) => (t < 4 ? 0.5 : 0.25), steer: (t) => (t > 5 ? 0.2 : 0) });
console.log('turn', JSON.stringify(turn));
