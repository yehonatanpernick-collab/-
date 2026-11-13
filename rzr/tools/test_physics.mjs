// Headless vehicle-physics tests against the real baked world.
//   node rzr/tools/test_physics.mjs        (needs `three` resolvable, e.g. rzr/node_modules/three)
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { WORLD, HeightField } from '../js/world/heightfield.js';
import { WorldCollision } from '../js/world/collision.js';
import { VehiclePhysics } from '../js/vehicle/physics.js';

const W = new URL('../assets/world/', import.meta.url).pathname;
const undelta = (buf, n) => { const a = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), o = new Uint16Array(a.length); for (let j = 0; j < n; j++) { let p = 0; for (let i = 0; i < n; i++) { p = (p + a[j * n + i]) & 0xffff; o[j * n + i] = p; } } return o; };
const height = undelta(zlib.gunzipSync(fs.readFileSync(W + 'height.bin.gz')), WORLD.n);
const water = undelta(zlib.gunzipSync(fs.readFileSync(W + 'water.bin.gz')), WORLD.n);
const masks = new Uint8Array(zlib.gunzipSync(fs.readFileSync(W + 'masks.bin.gz')));
const meta = JSON.parse(fs.readFileSync(W + 'world.json'));
const world = { meta, field: new HeightField({ height, masks, water }) };
const col = new WorldCollision(world);
// bridge railings (the game adds the same colliders in structures.js)
import { bridgeRailColliders } from '../js/world/collision.js';
for (const o of bridgeRailColliders(meta)) col.add(o);
const DT = 1 / 200;
const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log(ok ? 'PASS' : 'FAIL', name, info); };

function sim(ph, secs, ctrl) { const n = Math.round(secs / DT); for (let i = 0; i < n; i++) { ctrl && ctrl(ph, i * DT); ph.step(DT); if (!Number.isFinite(ph.pos.y)) throw new Error('NaN'); } }
const kmh = (ph) => ph.forwardSpeed() * 3.6;
const upY = (ph) => new THREE.Vector3(0, 1, 0).applyQuaternion(ph.quat).y;

// 1. settle at spawn
{
  const ph = new VehiclePhysics(col);
  ph.reset(meta.spawn.x, meta.spawn.z, meta.spawn.heading);
  sim(ph, 4);
  const lens = ph.wheels.map(w => w.len.toFixed(3));
  const g = col.field.height(ph.pos.x, ph.pos.z);
  check('settle: at rest', ph.vel.length() < 0.05, `v=${ph.vel.length().toFixed(3)} m/s lens=${lens} comY-ground=${(ph.pos.y - g).toFixed(2)}`);
  check('settle: all wheels in contact', ph.wheels.every(w => w.contact), ph.wheels.map(w => w.surface).join(','));
  // 2. acceleration (flat compacted pad)
  const d0 = meta.drift; ph.reset(d0.x - 120, d0.z, Math.PI / 2); sim(ph, 2);
  let t50 = null, t80 = null;
  sim(ph, 9, (p, t) => { p.input.throttle = 1; const v = kmh(p); if (t50 === null && v >= 50) t50 = t; if (t80 === null && v >= 80) t80 = t; });
  check('accel: 0-50 km/h < 6 s', t50 !== null && t50 < 6, `0-50 ${t50?.toFixed(2)}s, 0-80 ${t80?.toFixed(2)}s, after 9s ${kmh(ph).toFixed(0)} km/h, upright ${upY(ph).toFixed(2)}`);
  // 3. braking
  const v0 = kmh(ph); let dist = 0; const p0 = ph.pos.clone();
  let tStop = null;
  sim(ph, 8, (p, t) => { if (tStop === null) { p.input.throttle = 0; p.input.brake = 1; if (kmh(p) < 1) { tStop = t; dist = p.pos.distanceTo(p0); } } else p.input.brake = 0; });
  check('brake: stops', tStop !== null, `from ${v0.toFixed(0)} km/h in ${tStop?.toFixed(2)} s over ${dist.toFixed(1)} m (${(v0 / 3.6 / (tStop || 1) / 9.81).toFixed(2)} g)`);
}

// 4. flat test pad (drift track): steady cornering + handbrake drift
{
  const d = meta.drift;
  const ph = new VehiclePhysics(col);
  ph.reset(d.x, d.z + 40, Math.PI / 2);
  sim(ph, 2);
  let maxLat = 0, minUp = 1;
  sim(ph, 10, (p, t) => { p.input.throttle = kmh(p) < 45 ? 0.8 : 0.25; p.input.steer = t > 3 ? 0.5 : 0; });
  sim(ph, 6, (p) => { p.input.throttle = kmh(p) < 45 ? 0.7 : 0.3; p.input.steer = 0.5; const a = p.vel.length() * p.angVel.y; maxLat = Math.max(maxLat, Math.abs(a)); minUp = Math.min(minUp, upY(p)); });
  check('corner: steady circle without rollover', minUp > 0.8, `lateral ~${(maxLat / 9.81).toFixed(2)} g, min upright ${minUp.toFixed(2)}, speed ${kmh(ph).toFixed(0)}`);
  let maxSlip = 0;
  sim(ph, 3, (p) => { p.input.throttle = 0.9; p.input.steer = 1; p.input.handbrake = 1; maxSlip = Math.max(maxSlip, Math.abs(p.wheels[2].slipLat)); minUp = Math.min(minUp, upY(p)); });
  sim(ph, 3, (p) => { p.input.handbrake = 0; p.input.throttle = 1; p.input.steer = -0.3; maxSlip = Math.max(maxSlip, Math.abs(p.wheels[2].slipLat)); });
  check('drift: rear slides, stays upright', maxSlip > 0.25 && upY(ph) > 0.7, `max rear slip angle ${(maxSlip * 57.3).toFixed(0)} deg, upright ${upY(ph).toFixed(2)}, surface ${ph.wheels[2].surface}`);
}

// 4b. stability: swerves at speed on a flat pad must not roll the car; hard landings stay upright
{
  const d = meta.drift, res = {};
  for (const [name, target, steer] of [['80 km/h full-lock swerve', 80, 1], ['110 km/h full-lock swerve', 110, 1], ['60 km/h full-lock + handbrake', 60, 1]]) {
    const ph = new VehiclePhysics(col); ph.reset(d.x - 120, d.z, Math.PI / 2); sim(ph, 1.5);
    let minUp = 1, vmax = 0;
    sim(ph, 14, (p, t) => {
      const v = kmh(p); vmax = Math.max(vmax, v);
      if (t < 8) { p.input.throttle = v < target ? 1 : 0.2; p.input.steer = 0; }
      else { p.input.throttle = 0.6; p.input.steer = steer * (Math.floor((t - 8) / 0.8) % 2 ? -1 : 1); p.input.handbrake = name.includes('handbrake') ? 1 : 0; }
      minUp = Math.min(minUp, upY(p));
    });
    check(`stability: ${name}`, minUp > 0.55, `min upright ${minUp.toFixed(2)}, peak ${vmax.toFixed(0)} km/h`);
  }
}
// 4d. rough real terrain: meadow + hillside with aggressive steering at speed
{
  const spots = [['meadow west of drift', -2150, 2800, Math.PI / 2], ['hillside above village', -300, 700, 2.2], ['forest valley floor', -1750, 660, 2.0]];
  for (const [name, x, z, h] of spots) {
    for (const target of [70, 100]) {
      const ph = new VehiclePhysics(col); ph.reset(x, z, h); sim(ph, 1.5);
      let minUp = 1, t0 = 0, vmax = 0, flips = 0;
      sim(ph, 20, (p, t) => {
        const v = kmh(p); vmax = Math.max(vmax, v);
        p.input.throttle = v < target ? 1 : 0.1; p.input.brake = v > target + 15 ? 0.5 : 0;
        // sweeping S-curves of varying amplitude, like a player weaving
        p.input.steer = Math.sin(t * 1.3) * (0.4 + 0.6 * Math.abs(Math.sin(t * 0.37)));
        minUp = Math.min(minUp, upY(p));
      });
      check(`rough terrain: ${name} @${target}`, minUp > 0.45, `min upright ${minUp.toFixed(2)}, peak ${vmax.toFixed(0)} km/h`);
    }
  }
}
// 4e. collisions: clip a tree / hit a boulder on the wheels at speed, at an angle
{
  const d = meta.drift;
  const cases = [['tree head-on', 'cyl', 60, 0], ['tree glancing', 'cyl', 60, 0.5], ['boulder (r 1.2 m) wheel-first', 'sphere', 60, 0.45], ['boulder (r 1.2 m) @90', 'sphere', 90, 0.45], ['big boulder (r 2.2 m) @50', 'sphere', 50, 0.2]];
  for (const [name, type, v0, off] of cases) {
    const ph = new VehiclePhysics(col);
    ph.reset(d.x - 130, d.z, Math.PI / 2); sim(ph, 1);
    const gx = d.x - 130 + 55;
    const ob = type === 'cyl' ? { type: 'cyl', x: gx, z: d.z + off, y: ph.pos.y - 2, r: 0.45, h: 18, test: 1 }
      : { type: 'sphere', x: gx, z: d.z + off * 2, y: ph.pos.y - 0.6 + (name.includes('big') ? 0.3 : 0), r: name.includes('big') ? 2.2 : 1.2, test: 1 };
    col.add(ob);
    let minUp = 1, vmax = 0;
    sim(ph, 8, (p, t) => { const v = kmh(p); p.input.throttle = v < v0 ? 1 : 0; minUp = Math.min(minUp, upY(p)); vmax = Math.max(vmax, v); });
    col.removeWhere(o => o.test);
    check(`collision: ${name} @${v0}`, minUp > 0.3, `min upright ${minUp.toFixed(2)}, final upright ${upY(ph).toFixed(2)}`);
  }
}
// 4c. top speed on a long flat run
{
  const d = meta.drift; const ph = new VehiclePhysics(col); ph.reset(d.x - 130, d.z, Math.PI / 2);
  sim(ph, 25, (p) => { p.input.throttle = 1; p.input.steer = 0; });
  check('speed: reaches 130+ km/h on the flat', kmh(ph) > 130 || ph.pos.x > d.x + 130, `${kmh(ph).toFixed(0)} km/h`);
}
// 5. autopilot along real roads (pure pursuit): climbs, switchbacks, fords, bridges
function followRoad(road, maxKmh, label, limitS = 600) {
  const pts = road.pts;
  const ph = new VehiclePhysics(col);
  const a = pts[8], b = pts[11];
  ph.reset(a[0], a[2], Math.atan2(b[0] - a[0], b[2] - a[2]));
  sim(ph, 1.5);
  let idx = 8, t = 0, minUp = 1, stuck = 0, maxGrade = 0, surfaces = new Set(), waterMax = 0;
  const n = Math.round(limitS / DT);
  for (let i = 0; i < n; i++) {
    // nearest point ahead
    let best = idx, bd = 1e9;
    for (let k = idx; k < Math.min(pts.length, idx + 40); k++) { const d = Math.hypot(pts[k][0] - ph.pos.x, pts[k][2] - ph.pos.z); if (d < bd) { bd = d; best = k; } }
    idx = best;
    if (idx >= pts.length - 3) break;
    const look = pts[Math.min(pts.length - 1, idx + 4 + Math.round(Math.abs(ph.forwardSpeed()) * 0.35))];
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(ph.quat).setY(0).normalize();
    const to = new THREE.Vector3(look[0] - ph.pos.x, 0, look[2] - ph.pos.z).normalize();
    const ang = Math.atan2(fwd.clone().cross(to).y, fwd.dot(to));
    // upcoming curvature -> target speed
    const p1 = pts[Math.min(pts.length - 1, idx + 10)], p2 = pts[Math.min(pts.length - 1, idx + 20)];
    const h1 = Math.atan2(p1[0] - look[0], p1[2] - look[2]), h2 = Math.atan2(p2[0] - p1[0], p2[2] - p1[2]);
    let turn = Math.abs(((h2 - h1 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const target = Math.max(12, maxKmh * (1 - Math.min(0.8, turn * 1.3)));
    const v = kmh(ph);
    ph.input.steer = THREE.MathUtils.clamp(ang * 2.2, -1, 1);
    ph.input.throttle = v < target ? 1 : 0;
    ph.input.brake = v > target + 8 ? 0.6 : 0;
    ph.step(DT); t += DT;
    if (!Number.isFinite(ph.pos.y)) throw new Error('NaN');
    minUp = Math.min(minUp, upY(ph));
    if (process.env.FINE && label.includes(process.env.FINE) && idx > +process.env.FROM && i % 25 === 0) console.log(`   ${t.toFixed(2)} idx ${idx} d ${bd.toFixed(1)} v ${kmh(ph).toFixed(0)} tgt ${target.toFixed(0)} st ${ph.input.steer.toFixed(2)} br ${ph.input.brake} up ${upY(ph).toFixed(2)} ` + ph.wheels.map(w => (w.contact ? w.surface[0] : '-') + w.load.toFixed(0)).join(' ') + ' rail ' + (col.near(ph.pos.x, ph.pos.z) || []).filter(o => o.rail).length);
    for (const w of ph.wheels) { surfaces.add(w.surface); waterMax = Math.max(waterMax, w.water); }
    if (i % 200 === 0 && i > 0) {
      if (process.env.TRACE && label.includes(process.env.TRACE) && i % 400 === 0) {
        const g = col.field.height(ph.pos.x, ph.pos.z), rd = col.roadAt(ph.pos.x, ph.pos.z);
        console.log(`  t=${t.toFixed(0)} idx=${idx} d=${bd.toFixed(1)} v=${kmh(ph).toFixed(0)} tgt=${target.toFixed(0)} steer=${ph.input.steer.toFixed(2)} up=${upY(ph).toFixed(2)} road=${rd ? rd.dist.toFixed(1) : '-'} grade=${((pts[Math.min(pts.length - 1, idx + 5)][1] - pts[idx][1]) / 10 * 100).toFixed(0)}% wheels=${ph.wheels.map(w => (w.contact ? w.surface[0] : '-') + (w.omega * 0.375 * 3.6).toFixed(0) + '/' + w.load.toFixed(0)).join(' ')}`);
      }
      if (ph.vel.length() < 0.5) stuck++; else stuck = 0;
      if (stuck > 8) break;
      if (idx > 10) { const g = Math.abs(pts[idx][1] - pts[idx - 10][1]) / 20; maxGrade = Math.max(maxGrade, g); }
    }
  }
  const done = idx >= pts.length - 3;
  check(`road ${label}`, done && minUp > 0.3, `${done ? 'completed' : 'STOPPED at ' + idx + '/' + pts.length} in ${t.toFixed(0)}s, avg ${((idx * 2) / t * 3.6).toFixed(0)} km/h, min upright ${minUp.toFixed(2)}, max grade ${(maxGrade * 100).toFixed(0)}%, water ${waterMax.toFixed(2)} m, surfaces ${[...surfaces].join('/')}`);
}
const R = (from, to) => meta.roads.find(r => r.from === from && r.to === to);
followRoad(R('village', 'lakeJct'), 60, 'village->lakeJct (valley)');
followRoad(R('valleyHead', 'icePass'), 45, 'valleyHead->icePass (pass switchbacks)');
followRoad(R('lakeJct', 'lakeWest'), 42, 'lakeJct->lakeWest (lake road)');
followRoad(R('forestMouth', 'forestMid'), 40, 'forestMouth->forestMid (forest track)');
followRoad(R('lakeSouth', 'rockGarden'), 30, 'lakeSouth->rockGarden (extreme)');
const withFord = meta.roads.find(r => r.fords.length);
if (withFord) followRoad(withFord, 35, `${withFord.from}->${withFord.to} (ford)`);
const withBridge = meta.roads[meta.bridges[0].road];
followRoad(withBridge, 45, `${withBridge.from}->${withBridge.to} (bridge)`);
console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed`);
