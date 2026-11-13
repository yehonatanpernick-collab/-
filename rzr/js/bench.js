// ?bench — autopilot drive along real roads for 60 s and report frame-time statistics.
import * as THREE from 'three';

export function startBenchmark(game, onDone) {
  const meta = game.world.meta;
  const route = ['village>lakeJct', 'lakeJct>lakeWest'].flatMap(k => { const [a, b] = k.split('>'); const r = meta.roads.find(r => r.from === a && r.to === b); return r ? r.pts : []; });
  const p0 = route[8], p1 = route[12];
  game.resetVehicle(p0[0], p0[2], Math.atan2(p1[0] - p0[0], p1[2] - p0[2]));
  let idx = 8;
  game.autopilot = (ph) => {
    let best = idx, bd = 1e9;
    for (let k = idx; k < Math.min(route.length, idx + 40); k++) { const d = Math.hypot(route[k][0] - ph.pos.x, route[k][2] - ph.pos.z); if (d < bd) { bd = d; best = k; } }
    idx = best;
    const look = route[Math.min(route.length - 1, idx + 6 + Math.round(Math.abs(ph.forwardSpeed()) * 0.3))];
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(ph.quat).setY(0).normalize();
    const to = new THREE.Vector3(look[0] - ph.pos.x, 0, look[2] - ph.pos.z).normalize();
    ph.input.steer = THREE.MathUtils.clamp(Math.atan2(fwd.clone().cross(to).y, fwd.dot(to)) * 2.2, -1, 1);
    const v = ph.forwardSpeed() * 3.6;
    ph.input.throttle = v < 45 ? 1 : 0; ph.input.brake = v > 55 ? 0.5 : 0;
  };
  const times = [];
  let last = performance.now();
  const t0 = last;
  const tick = () => {
    const now = performance.now();
    times.push(now - last); last = now;
    if (now - t0 < 60000 && idx < route.length - 20) return requestAnimationFrame(tick);
    game.autopilot = null;
    times.shift();
    const sorted = [...times].sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const res = { frames: times.length, avgFps: +(1000 / avg).toFixed(1), low1Fps: +(1000 / p99).toFixed(1), avgMs: +avg.toFixed(2), worstMs: +sorted[sorted.length - 1].toFixed(1), quality: game.qualityName, gpu: game.renderer.getContext().getParameter(game.renderer.getContext().RENDERER) };
    console.log('[bench]', JSON.stringify(res));
    onDone?.(res);
  };
  requestAnimationFrame(tick);
}
