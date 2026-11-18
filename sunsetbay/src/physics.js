import RAPIER from 'rapier';
import * as THREE from 'three';
import * as W from './world.js';
import { smooth } from './core.js';

export let R = null, world = null, kcc = null, events = null;
export const G = { STATIC: 1, CAR: 2, HUMAN: 4, PROP: 8, BOUND: 16 };
export const groups = (member, filter) => (member << 16) | filter;
export const colliderInfo = new Map(); // collider handle -> { kind, ref }

export async function initPhysics() {
  await RAPIER.init();
  R = RAPIER;
  world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  events = new R.EventQueue(true);
  kcc = world.createCharacterController(0.03);
  kcc.enableAutostep(0.36, 0.15, false);
  kcc.enableSnapToGround(0.45);
  kcc.setMaxSlopeClimbAngle(55 * Math.PI / 180);
  kcc.setMinSlopeSlideAngle(65 * Math.PI / 180);
  kcc.setSlideEnabled(true);
  kcc.setApplyImpulsesToDynamicBodies(true);
}
const STATIC_GROUPS = () => groups(G.STATIC, G.CAR | G.HUMAN | G.PROP);
function fixedBox(cx, cy, cz, hx, hy, hz, rotY = 0, info) {
  const d = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setCollisionGroups(STATIC_GROUPS()).setFriction(0.9);
  if (rotY) { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)); d.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); }
  const c = world.createCollider(d); if (info) colliderInfo.set(c.handle, info); return c;
}

export function buildStatic() {
  const { EDGE, PROM, CURB, NB, blockLo, blockHi, buildings, PIER, RAMPS, props, SHORE_LIMIT, roundedDist } = W;
  // city ground slab (roads at y=0)
  fixedBox(0, -1, 0, EDGE, 1, EDGE, 0, { kind: 'ground' });
  // raised sidewalks / block slabs
  for (let bj = 0; bj < NB; bj++) for (let bi = 0; bi < NB; bi++) {
    const x0 = blockLo(bi), x1 = blockHi(bi), z0 = blockLo(bj), z1 = blockHi(bj);
    fixedBox((x0 + x1) / 2, CURB / 2, (z0 + z1) / 2, (x1 - x0) / 2, CURB / 2, (z1 - z0) / 2, 0, { kind: 'ground' });
  }
  for (const [x0, z0, x1, z1] of [[-PROM, -PROM, PROM, -EDGE], [-PROM, EDGE, PROM, PROM], [-PROM, -EDGE, -EDGE, EDGE], [EDGE, -EDGE, PROM, EDGE]])
    fixedBox((x0 + x1) / 2, CURB / 2 - 0.2, (z0 + z1) / 2, (x1 - x0) / 2, CURB / 2 + 0.2, (z1 - z0) / 2, 0, { kind: 'ground' });
  // buildings and other solid boxes
  for (const b of buildings) {
    const h = Math.max(0.4, b.h);
    fixedBox((b.x0 + b.x1) / 2, h / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, h / 2, (b.z1 - b.z0) / 2, 0, { kind: 'building', ref: b });
  }
  // beach heightfield (symmetric island, so axis order does not matter)
  const N = 140, SIZE = 1120, hts = new Float32Array((N + 1) * (N + 1));
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const x = -SIZE / 2 + SIZE * j / N, z = -SIZE / 2 + SIZE * i / N, d = roundedDist(x, z, 330, 40);
    let y = d < 333 ? -0.09 : -0.09 - smooth(333, 400, d) * 2.6 - smooth(400, 520, d) * 6;
    if (Math.abs(x) < PROM - 2 && Math.abs(z) < PROM - 2) y = -0.4;
    hts[j * (N + 1) + i] = y;
  }
  const hf = world.createCollider(R.ColliderDesc.heightfield(N, N, hts, { x: SIZE, y: 1, z: SIZE }).setCollisionGroups(STATIC_GROUPS()).setFriction(0.8));
  colliderInfo.set(hf.handle, { kind: 'sand' });
  // pier: approach ramp + decks + railings
  const D = PIER.deck;
  {
    const len = 14, x0 = PIER.x0, ang = Math.atan2(D - CURB, len), hl = Math.hypot(len, D - CURB) / 2;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, ang));
    world.createCollider(R.ColliderDesc.cuboid(hl, 0.2, (PIER.z1 - PIER.z0) / 2).setTranslation(x0 + len / 2, (CURB + D) / 2 - 0.2 * Math.cos(ang), 0).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(STATIC_GROUPS()));
    fixedBox((x0 + 14 + PIER.px0) / 2, D - 0.25, 0, (PIER.px0 - x0 - 14) / 2, 0.25, (PIER.z1 - PIER.z0) / 2, 0, { kind: 'ground' });
    fixedBox((PIER.px0 + PIER.x1) / 2, D - 0.25, 0, (PIER.x1 - PIER.px0) / 2, 0.25, (PIER.pz1 - PIER.pz0) / 2, 0, { kind: 'ground' });
    const rail = (cx, cz, hx, hz) => fixedBox(cx, D + 0.55, cz, hx, 0.55, hz, 0, { kind: 'rail' });
    rail((x0 + 14 + PIER.px0) / 2, PIER.z0 - 0.05, (PIER.px0 - x0 - 14) / 2, 0.06); rail((x0 + 14 + PIER.px0) / 2, PIER.z1 + 0.05, (PIER.px0 - x0 - 14) / 2, 0.06);
    rail((PIER.px0 + PIER.x1) / 2, PIER.pz0 - 0.05, (PIER.x1 - PIER.px0) / 2, 0.06); rail((PIER.px0 + PIER.x1) / 2, PIER.pz1 + 0.05, (PIER.x1 - PIER.px0) / 2, 0.06);
    rail(PIER.x1 + 0.05, 0, 0.06, (PIER.pz1 - PIER.pz0) / 2);
    rail(PIER.px0, (PIER.pz0 + PIER.z0) / 2, 0.06, (PIER.z0 - PIER.pz0) / 2); rail(PIER.px0, (PIER.pz1 + PIER.z1) / 2, 0.06, (PIER.pz1 - PIER.z1) / 2);
  }
  // stunt ramps (convex wedges)
  for (const r of RAMPS) {
    const w = r.w / 2, L = r.len, H = r.top, c = Math.cos(r.h), s = Math.sin(r.h);
    const local = [[-w, 0, 0], [w, 0, 0], [w, H, L], [-w, H, L], [-w, 0, L], [w, 0, L]];
    const pts = new Float32Array(local.length * 3);
    local.forEach(([x, y, z], i) => { pts[i * 3] = r.x + x * c + z * s; pts[i * 3 + 1] = y - 0.02; pts[i * 3 + 2] = r.z - x * s + z * c; });
    const d = R.ColliderDesc.convexHull(pts); if (d) world.createCollider(d.setCollisionGroups(STATIC_GROUPS()).setFriction(1.0));
  }
  // street furniture: thin cylinders
  for (const p of props) {
    const h = p.kind === 'tree' ? 4 : p.kind === 'hydrant' ? 0.9 : 6;
    const d = R.ColliderDesc.cylinder(h / 2, Math.max(0.15, p.r)).setTranslation(p.x, CURB + h / 2, p.z).setCollisionGroups(STATIC_GROUPS())
      .setActiveEvents(p.knock ? R.ActiveEvents.CONTACT_FORCE_EVENTS : 0).setContactForceEventThreshold(p.knock ? 6000 : 1e12);
    const c = world.createCollider(d); colliderInfo.set(c.handle, { kind: 'prop', ref: p }); p.collider = c;
  }
  // shoreline wall for people (cars may drive into the sea)
  const S = SHORE_LIMIT - 2, wallG = groups(G.BOUND, G.HUMAN);
  for (const [cx, cz, hx, hz] of [[0, -S, S, 0.5], [0, S, S, 0.5], [-S, 0, 0.5, S], [S, 0, 0.5, S]]) {
    if (cx > 0 && hx < 1) { // east wall split for the pier
      world.createCollider(R.ColliderDesc.cuboid(0.5, 3, (S - PIER.z1 - 1) / 2).setTranslation(S, 1, (S + PIER.z1 + 1) / 2).setCollisionGroups(wallG));
      world.createCollider(R.ColliderDesc.cuboid(0.5, 3, (S + PIER.z0 - 1) / 2).setTranslation(S, 1, -(S - PIER.z0 - 1) / 2 - 0).setCollisionGroups(wallG));
      continue;
    }
    world.createCollider(R.ColliderDesc.cuboid(hx, 3, hz).setTranslation(cx, 1, cz).setCollisionGroups(wallG));
  }
}

export function removePropCollider(p) { if (p.collider) { world.removeCollider(p.collider, false); p.collider = null; } }

const _ray = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 1 } };
// returns { toi, point, normal, collider } or null
export function raycast(ox, oy, oz, dx, dy, dz, maxD, mask = G.STATIC | G.CAR | G.PROP | G.HUMAN, exclude = null) {
  const ray = new R.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
  const hit = world.castRayAndGetNormal(ray, maxD, true, undefined, groups(0xffff, mask), exclude || undefined, undefined);
  if (!hit) return null;
  const t = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
  return { toi: t, x: ox + dx * t, y: oy + dy * t, z: oz + dz * t, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z, collider: hit.collider };
}

export function makeHumanCollider(x, y, z) {
  const c = world.createCollider(R.ColliderDesc.capsule(0.55, 0.3).setTranslation(x, y + 0.86, z).setCollisionGroups(groups(G.HUMAN, G.STATIC | G.BOUND)));
  return c;
}
const HUMAN_QUERY = groups(G.HUMAN, G.STATIC | G.CAR | G.BOUND);
// move a human capsule; returns grounded
export function moveHumanCollider(col, dx, dy, dz) {
  kcc.computeColliderMovement(col, { x: dx, y: dy, z: dz }, R.QueryFilterFlags.EXCLUDE_SENSORS, HUMAN_QUERY);
  const m = kcc.computedMovement(), t = col.translation();
  col.setTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
  return { grounded: kcc.computedGrounded(), mx: m.x, my: m.y, mz: m.z };
}
