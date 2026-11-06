import * as THREE from 'three/webgpu';
import { Engine, isTouch, type Quality } from './engine/renderer';
import { Physics } from './engine/physics';
import { makeMaterials } from './world/materials';
import { World } from './world/streaming';
import { Roads } from './world/roads';
import { Props } from './world/props';
import { Traffic } from './ai/traffic';
import { Peds } from './ai/peds';
import { Vehicle } from './vehicle/vehicle';
import { buildCar } from './vehicle/model';
import { Input } from './ui/input';
import { Hud } from './ui/hud';

const $ = (id: string) => document.getElementById(id)!;
const BASE = import.meta.env.BASE_URL;
const prog = (f: number, t: string) => { ($('progI') as HTMLElement).style.width = `${Math.round(f * 100)}%`; $('progT').textContent = t; };
if (isTouch) document.body.classList.add('touch');

async function main() {
  const engine = new Engine($('view') as HTMLCanvasElement);
  prog(0.03, 'Starting renderer…');
  await engine.init();
  prog(0.08, `Renderer: ${engine.isWebGPU ? 'WebGPU' : 'WebGL 2'} · loading sky`);
  await engine.loadSky('day', `${BASE}hdr/day.hdr`, 0);
  engine.setSky('day');
  const physics = new Physics(); await physics.init();
  const mats = makeMaterials(engine);
  const world = new World(engine.scene, mats, physics); await world.init();
  const roads = new Roads(); await roads.init(world.info.origin, world.info.m);
  const hud = new Hud(roads, world.info);
  world.onFootprints = (f) => hud.addFootprints(f);

  // start on 7th Avenue at Times Square, facing up the avenue
  const toLocal = (lat: number, lon: number) => [(lon - world.info.origin[0]) * world.info.m[0], -(lat - world.info.origin[1]) * world.info.m[1]];
  const [sx, sz] = toLocal(40.7566, -73.9865);
  const spawnOnRoad = (x: number, z: number) => {
    const n = roads.nearest(x, z, 400)!; const e = roads.edges[n.e];
    const [px, pz, dx, dz] = roads.at(e, n.s); const dir = e.dir === 'TF' ? -1 : 1;
    const off = e.dir === 'TW' ? 1.8 : -(Math.max(e.lanes * 3, e.w - e.park * 2.6) / 2) + 4.6;
    return { x: px - dz * dir * off, z: pz + dx * dir * off, yaw: Math.atan2(dx * dir, dz * dir) };
  };
  const sp = spawnOnRoad(sx, sz);
  prog(0.12, 'Streaming Midtown…');
  engine.camera.position.set(sp.x, 30, sp.z);
  await world.preload(new THREE.Vector3(sp.x, 0, sp.z), 400, (f) => prog(0.12 + f * 0.6, `Streaming Midtown · ${Math.round(f * 100)}%`));
  for (let i = 0; i < 3; i++) world.update(new THREE.Vector3(sp.x, 0, sp.z), new THREE.Vector3(sp.x, 0, sp.z));

  prog(0.75, 'Planting street trees…');
  const props = new Props(engine.scene, engine); await props.init();
  prog(0.82, 'Calling in traffic…');
  const traffic = new Traffic(engine.scene, roads, physics, isTouch ? 110 : 240); await traffic.init();
  traffic.placeParked(sp.x, sp.z);
  const peds = new Peds(engine.scene, roads, traffic, isTouch ? 140 : 320); peds.init();

  const car = new Vehicle(physics); car.spawn(sp.x, 0.9, sp.z, sp.yaw);
  const rig = buildCar(0xe9ecef); engine.scene.add(rig.root);
  const input = new Input();
  // compile shaders before the first frame of play
  prog(0.9, 'Compiling shaders…');
  world.update(engine.camera.position, car.pos); props.update(sp.x, sp.z);
  try { await engine.renderer.compileAsync(engine.scene, engine.camera); } catch { /* optional */ }
  prog(1, 'Ready');
  const go = $('go') as HTMLButtonElement; go.disabled = false; go.focus();

  // ---------------------------------------------------------------- game state
  let camMode = 0, parkedAt = new THREE.Vector3(sp.x, 0, sp.z), started = false, duskLoaded = false;
  const camPos = new THREE.Vector3(sp.x - Math.sin(sp.yaw) * 8, 3, sp.z - Math.cos(sp.yaw) * 8); let camYaw = sp.yaw, fov = 60;
  const rpos = new THREE.Vector3(), rquat = new THREE.Quaternion();
  const transform = () => {
    const to = car.mode === 'drive' ? 'fly' : 'drive'; car.setMode(to);
    $('xform').classList.toggle('air', to === 'fly'); $('lift').hidden = to !== 'fly'; $('hSpace').textContent = to === 'fly' ? 'Climb' : 'Handbrake';
    hud.toast(to === 'fly' ? 'FLIGHT MODE' : 'DRIVE MODE', to === 'fly' ? 'Wheels folded · lift thrusters online' : 'Wheels down');
  };
  const resetCar = () => { const p = spawnOnRoad(car.pos.x, car.pos.z); car.spawn(p.x, 1.0, p.z, p.yaw); $('xform').classList.remove('air'); $('lift').hidden = true; hud.toast('RESET'); };
  input.onAction = async (a) => {
    if (!started) return;
    if (a === 'transform') transform();
    else if (a === 'camera') { camMode = (camMode + 1) % 3; hud.toast(['CHASE CAM', 'WIDE CAM', 'COCKPIT'][camMode]); }
    else if (a === 'reset') resetCar();
    else if (a === 'quality') { const order: Quality[] = ['high', 'medium', 'low']; const q = order[(order.indexOf(engine.quality) + 1) % 3]; engine.setQuality(q); hud.toast('GRAPHICS', q.toUpperCase()); }
    else if (a === 'time') {
      if (!duskLoaded) { hud.toast('SUNSET', 'loading sky…'); await engine.loadSky('dusk', `${BASE}hdr/dusk.hdr`, 0.75); duskLoaded = true; }
      engine.setSky(engine.skyName === 'day' ? 'dusk' : 'day'); hud.toast(engine.skyName === 'day' ? 'AFTERNOON' : 'SUNSET');
      rig.headLight.intensity = engine.night.value > 0.3 ? 90 : 0;
    }
  };
  // HUD buttons act once, then hand keyboard focus straight back to the game
  const hudBtn = (id: string, a: Parameters<typeof input.onAction>[0]) => $(id).addEventListener('click', (e) => { input.onAction(a); (e.currentTarget as HTMLElement).blur(); ($('view') as HTMLCanvasElement).focus(); });
  hudBtn('xform', 'transform'); hudBtn('bCam', 'camera'); hudBtn('bTime', 'time'); hudBtn('bReset', 'reset'); hudBtn('bQual', 'quality');
  go.addEventListener('click', () => { started = true; $('start').hidden = true; $('hud').hidden = false; if (isTouch) $('touch').hidden = false; ($('view') as HTMLCanvasElement).focus(); hud.toast('MIDTOWN MANHATTAN', 'Press F to take off'); });

  // ---------------------------------------------------------------- loop
  let last = performance.now(), streamT = 0, sigT = 0;
  const v3 = new THREE.Vector3(), look = new THREE.Vector3();
  const frame = () => {
    const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const flying = car.mode === 'fly';
    car.input = started ? input.read(flying) : { steer: 0, throttle: 0, up: 0, down: 0, boost: false, handbrake: true };
    const alpha = physics.step(dt, (h) => car.step(h));
    car.afterStep();
    if (car.pos.y < -0.8 || car.pos.y > 1500 || !Number.isFinite(car.pos.x)) resetCar();
    car.pose(alpha, rpos, rquat);
    // ---- car visuals
    rig.root.position.copy(rpos); rig.root.quaternion.copy(rquat);
    const f = car.fold;
    rig.fold.value = f; rig.thrust.value = flying ? Math.max(0, car.input.throttle) * 0.7 + car.input.up * 0.6 + 0.35 : 0; rig.boost.value += ((car.input.boost && car.input.throttle > 0 ? 1 : 0) - rig.boost.value) * Math.min(1, dt * 5);
    rig.brake.value = !flying && car.input.throttle < -0.1 && car.speed > 1 ? 1 : 0;
    rig.wheels.forEach((w, i) => {
      w.pivot.position.y = THREE.MathUtils.lerp(Math.max(0.2, Math.min(0.5, 0.36 + (0.32 - (car.ctrl.wheelSuspensionLength(i) ?? 0.32)) * 0.9)), 0.42, f);
      w.pivot.rotation.set(0, w.front ? car.steer * (1 - f) : 0, -w.side * (Math.PI / 2) * f);
      w.spin.rotation.x = car.wheelSpin[i];
    });
    rig.wing.position.y = 0.95 + f * 0.14; rig.wing.rotation.x = -f * 0.12;
    const fl = flying ? 0.7 + car.input.up * 0.9 + Math.max(0, car.input.throttle) * 0.4 : 0;
    for (const fm of rig.flames) { fm.visible = f > 0.4; fm.scale.set(0.8 + fl * 0.25, (0.6 + fl) * f * (0.9 + Math.random() * 0.2), 0.8 + fl * 0.25); fm.rotation.x = THREE.MathUtils.clamp(car.speed / 70, -0.4, 1) * 0.9; }
    const rp = (flying ? Math.max(0, car.input.throttle) : 0) + (car.input.boost && car.input.throttle > 0 ? 1 : 0);
    for (const fm of rig.rearFlames) { fm.visible = rp > 0.05; fm.scale.set(0.6 + rp * 0.4, rp * (1.4 + rig.boost.value * 2.2) * (0.88 + Math.random() * 0.24), 0.6 + rp * 0.4); }
    rig.underLight.intensity = f * 18 * (0.6 + engine.night.value);
    // ---- camera
    const spd = car.vel.length();
    const vy = Math.atan2(car.vel.x, car.vel.z);
    const targetYaw = spd > 6 && car.speed > 0 ? vy : car.yaw;
    let dy = targetYaw - camYaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    camYaw += dy * Math.min(1, dt * (flying ? 3.5 : 5));
    const wide = camMode === 1;
    if (camMode === 2) {
      v3.set(0, 1.08, 0.15).applyQuaternion(rquat).add(rpos); engine.camera.position.copy(v3);
      look.set(0, 0.9, 20).applyQuaternion(rquat).add(rpos); engine.camera.lookAt(look);
    } else {
      const dist = (wide ? 12 : 6.4) + spd * (wide ? 0.05 : 0.028) + f * 2;
      const height = (wide ? 4.2 : 2.0) + f * 1.0 - THREE.MathUtils.clamp(car.vel.y * 0.04, -1.5, 1.5);
      const target = v3.set(rpos.x, rpos.y + 1.2, rpos.z);
      const want = new THREE.Vector3(rpos.x - Math.sin(camYaw) * dist, rpos.y + height, rpos.z - Math.cos(camYaw) * dist);
      const dir = want.clone().sub(target); const L = dir.length(); dir.normalize();
      const hit = physics.castRay(target.x, target.y, target.z, dir.x, dir.y, dir.z, L, car.body);
      if (hit != null) want.copy(target).addScaledVector(dir, Math.max(1.2, hit - 0.4));
      want.y = Math.max(want.y, 0.6);
      camPos.lerp(want, 1 - Math.exp(-dt * 10));
      engine.camera.position.copy(camPos);
      look.set(rpos.x + Math.sin(camYaw) * 4, rpos.y + 1.0, rpos.z + Math.cos(camYaw) * 4); engine.camera.lookAt(look);
    }
    fov += ((camMode === 2 ? 70 : 58) + Math.min(24, spd * 0.16) + (rig.boost.value * 8) - fov) * Math.min(1, dt * 3);
    engine.camera.fov = fov; engine.camera.updateProjectionMatrix();
    engine.follow(rpos);
    // ---- world
    streamT -= dt; if (streamT <= 0) { streamT = 0.25; world.update(engine.camera.position, car.pos); }
    props.update(car.pos.x, car.pos.z);
    traffic.update(dt, car.pos, car.vel, car.pos.y < 3);
    peds.update(dt, car.pos, spd);
    sigT -= dt; if (sigT <= 0) { sigT = 0.3; props.updateSignals(car.pos.x, car.pos.z, (n, yaw) => traffic.signalForYaw(n, yaw)); }
    if (Math.hypot(car.pos.x - parkedAt.x, car.pos.z - parkedAt.z) > 200) { parkedAt.copy(car.pos); traffic.placeParked(car.pos.x, car.pos.z); }
    if (started) {
      const clear = flying ? car.groundClearance() : 0;
      const gear = flying ? 'FLY' : car.speed < -0.5 ? 'R' : Math.abs(car.speed) < 0.4 ? 'N' : 'D';
      hud.update(dt, { x: car.pos.x, z: car.pos.z, y: car.pos.y, yaw: car.yaw, kmh: spd * 3.6, mode: car.mode, gear, clear, vy: car.vel.y, energy: car.energy, boost: car.input.boost && car.input.throttle > 0 });
    } else {
      // attract mode: slow orbit around the parked car
      const t = now / 1000 * 0.12; engine.camera.position.set(rpos.x + Math.sin(t + 2) * 8.5, rpos.y + 1.7, rpos.z + Math.cos(t + 2) * 8.5); engine.camera.lookAt(rpos.x, rpos.y + 0.8, rpos.z);
    }
    engine.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (/debug/.test(location.search)) (window as any).G = { engine, car, world, traffic, physics, transform, hud, start: () => go.click() };
}

main().catch((e) => { console.error(e); $('progT').textContent = 'Could not start: ' + (e?.message || e); });
