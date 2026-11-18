import * as THREE from 'three';
import { $, clamp, lerp, wrapA, rnd, fmtMoney, mulberry32, sound, store } from './core.js';
import { scene } from './render.js';
import * as W from './world.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { player, mission, race, wanted, vehicles, humans, pickups, clock, flags, stats, WEAPONS } from './state.js';
import { toast, banner, setObjective, addMoney, gps, setBlipSource } from './hud.js';
import { spawnVehicle, removeVehicle, spawnHuman, setHeat, clearHeat, driveToward, sidewalkLoop, alarm, nearestNode, bfsRoute } from './ai.js';
import * as FX from './fx.js';
import { enterCar, exitCar, lockPointer } from './player.js';

const { POI, CURB, NB, nodeC, blockMid, blockLo, groundHeight, TEX } = W;
export const save = () => store.set('sb2-save', { money: player.money, idx: mission.idx, owned: player.owned, ammo: player.ammo, mag: player.mag, stats });

/* =====================================================================
   PICKUPS
   ===================================================================== */
const PK_GEO = {};
let gunModel = null; export function setPickupGun(m) { gunModel = m; }
function pickupMesh(type) {
  const g = new THREE.Group();
  const m = (geo, color, em = 0, metal = 0.1) => new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: em, roughness: 0.4, metalness: metal }));
  if (type === 'cash') { const b = m(new THREE.BoxGeometry(0.55, 0.22, 0.32), 0x3c9a4a, 0.4); g.add(b); const band = m(new THREE.BoxGeometry(0.12, 0.23, 0.33), 0xe8dcae, 0.2); g.add(band); }
  else if (type === 'health') { g.add(m(new RoundedBoxGeometry(0.55, 0.55, 0.2, 2, 0.05), 0xf4f4f4, 0.25)); g.add(m(new THREE.BoxGeometry(0.36, 0.11, 0.22), 0xff2a2a, 1.2)); g.add(m(new THREE.BoxGeometry(0.11, 0.36, 0.22), 0xff2a2a, 1.2)); }
  else if (type === 'armor') { g.add(m(new RoundedBoxGeometry(0.5, 0.6, 0.22, 2, 0.08), 0x2f6bff, 0.6)); }
  else if (gunModel) { const gm = gunModel.clone(); const s = type === 'shotgun' ? 2.4 : type === 'smg' ? 1.8 : 1.3; gm.scale.multiplyScalar(s); gm.rotation.set(0, Math.PI / 2, 0); g.add(gm); }
  else { const L = type === 'shotgun' ? 0.9 : type === 'smg' ? 0.6 : 0.36; g.add(m(new THREE.BoxGeometry(0.08, 0.14, L), 0x222222, 0, 0.8)); }
  const glow = new THREE.Mesh(PK_GEO.glow || (PK_GEO.glow = new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ map: TEX.pool, color: type === 'health' ? 0x9cff8a : type === 'armor' ? 0x62b6ff : type === 'cash' ? 0x7dff9a : 0xffb24a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.y = -0.95; g.add(glow);
  return g;
}
export function addPickup(x, z, type, amount, respawn = 0, ttl = 0) {
  const mesh = pickupMesh(type); const y = groundHeight(x, z) + 1.0; mesh.position.set(x, y, z); scene.add(mesh);
  const p = { x, z, y, type, amount, respawn, ttl, mesh, active: true, t: Math.random() * 6 }; pickups.push(p); return p;
}
export function dropPickup(x, z, type, amount) { addPickup(x, z, type, amount, 0, 30); }
export function setupPickups() {
  const S = POI;
  addPickup(S.hospital.x + 8, S.hospital.z - 1, 'health', 100, 45); addPickup(S.fountain.x + 6, S.fountain.z + 10, 'health', 100, 45); addPickup(S.pierEnd.x - 4, S.pierEnd.z - 12, 'health', 100, 45);
  addPickup(blockMid(5) + 24, blockLo(1) + 52, 'armor', 100, 60); addPickup(S.gang.x + 22, S.gang.z - 12, 'armor', 100, 60);
  addPickup(S.safehouse.x - 7, S.safehouse.z + 3, 'pistol', 36, 40);
  addPickup(S.hideout.x + 4, S.hideout.z - 14, 'smg', 90, 60);
  addPickup(S.pierEnd.x - 2, S.pierEnd.z + 12, 'shotgun', 18, 60);
  addPickup(S.docks.x - 4, S.docks.z + 2, 'smg', 60, 60);
  const r = mulberry32(77);
  for (let k = 0; k < 12; k++) { const bi = Math.floor(r() * NB), bj = Math.floor(r() * NB), loop = sidewalkLoop(bi, bj), e = Math.floor(r() * 4), t = r(); addPickup(lerp(loop[e][0], loop[(e + 1) % 4][0], t), lerp(loop[e][1], loop[(e + 1) % 4][1], t), 'cash', 100 + Math.floor(r() * 4) * 50, 90); }
}
export function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i]; p.t += dt;
    if (!p.active) { p.respawnT -= dt; if (p.respawnT <= 0) { p.active = true; p.mesh.visible = true; } continue; }
    if (p.ttl) { p.ttl -= dt; if (p.ttl <= 0) { scene.remove(p.mesh); pickups.splice(i, 1); continue; } }
    p.mesh.rotation.y = p.t * 1.6; p.mesh.position.y = p.y + Math.sin(p.t * 2.4) * 0.12;
    if (player.dead) continue;
    const r = player.car ? 3 : 1.3, py = player.car ? player.car.y : player.h.y;
    if (Math.abs(p.y - 1 - py) < 2 && (p.x - player.x) ** 2 + (p.z - player.z) ** 2 < r * r && (!player.car || p.type === 'cash')) collect(p, i);
  }
}
function collect(p, i) {
  const P = player; let ok = true;
  if (p.type === 'cash') { addMoney(p.amount); toast(`מזומן <b>+${fmtMoney(p.amount)}</b>`, 1800); }
  else if (p.type === 'health') { if (P.hp >= 100) ok = false; else { P.hp = 100; toast('בריאות מלאה', 1800); } }
  else if (p.type === 'armor') { if (P.armor >= 100) ok = false; else { P.armor = 100; toast('אפוד מגן', 1800); } }
  else { const wi = p.type === 'pistol' ? 1 : p.type === 'smg' ? 2 : 3; const first = !P.owned[wi]; P.owned[wi] = true; P.ammo[wi] += p.amount; if (P.mag[wi] === 0) { const take = Math.min(WEAPONS[wi].mag, P.ammo[wi]); P.mag[wi] += take; P.ammo[wi] -= take; } if (first) P.weapon = wi; toast(`${WEAPONS[wi].name} <b>+${p.amount}</b>`, 2000); }
  if (!ok) return;
  sound.pickup();
  if (p.respawn) { p.active = false; p.mesh.visible = false; p.respawnT = p.respawn; } else { scene.remove(p.mesh); pickups.splice(i, 1); }
}

/* =====================================================================
   MARKERS
   ===================================================================== */
export function makeMarker(color, r = 1.6, h = 7) {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40, 1, true), new THREE.MeshBasicMaterial({ map: TEX.beam, color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.position.y = h / 2; g.add(beam);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.82, r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
  g.userData.beam = beam; g.userData.ring = ring; scene.add(g); return g;
}
function makeArrow(color) {
  const geo = new THREE.ConeGeometry(0.5, 1.1, 4); geo.rotateX(Math.PI);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.3 })); scene.add(m); return m;
}
function dispose3D(o) { if (!o) return; scene.remove(o); o.traverse && o.traverse(c => { if (c.geometry && c.geometry !== PK_GEO.glow) c.geometry.dispose(); if (c.material && c.material.dispose) c.material.dispose(); }); }

/* =====================================================================
   MISSIONS
   ===================================================================== */
function mtarget(x, z, color = '#3fd8c6', follow = null) { mission.target = { x, z, color, follow }; gps.t = 0; }
export function computeGPS() {
  const t = mission.target; if (!t) { gps.route = null; return; }
  const sx = player.x, sz = player.z, tx = t.follow ? t.follow.x : t.x, tz = t.follow ? t.follow.z : t.z;
  if (Math.hypot(tx - sx, tz - sz) < 40) { gps.route = [[sx, sz], [tx, tz]]; return; }
  const [si, sj] = nearestNode(sx, sz), [ti, tj] = nearestNode(tx, tz);
  const path = bfsRoute(si, sj, ti, tj).map(([i, j]) => [nodeC(i), nodeC(j)]);
  gps.route = [[sx, sz], ...path, [tx, tz]];
}
export const MISSIONS = [
  {
    who: 'דנה · מתאמת עסקאות', title: 'משלוח חם', pay: 2500,
    text: 'קונה בנמל מחכה לרוסו 458 כתומה שחונה ליד המגדלים במרכז העיר. תיקח אותה, תביא אותה למוסך בנמל בתוך הזמן, ושלא תגיע מקומטת.',
    giver: () => ({ x: POI.safehouse.x, z: POI.safehouse.z - 9 }),
    start(d) {
      const x = blockMid(2) + 26, z = blockLo(2) + 2.6;
      d.car = spawnVehicle('ferrari', x, z, Math.PI / 2, { color: 0xff6a10 }); d.car.mode = 'parked'; d.car.mission = true;
      d.arrow = makeArrow(0xff5a5f); d.stage = 0;
      setObjective('גנוב את <em>הרוסו הכתומה</em> במרכז העיר'); mtarget(x, z, '#ff5a5f', d.car);
    },
    update(d, dt) {
      if (d.car.dead || d.car.removed) return missionFail('הרכב נהרס');
      if (d.stage === 0) {
        d.arrow.position.set(d.car.x, d.car.y + d.car.H + 1.6 + Math.sin(clock.t * 3) * 0.2, d.car.z); d.arrow.rotation.y += dt * 2;
        if (player.car === d.car) { d.stage = 1; dispose3D(d.arrow); d.arrow = null; mission.timer = 105; setHeat(1); d.dest = makeMarker(0x3fd8c6, 4, 9); d.dest.position.set(POI.docks.x, CURB, POI.docks.z); toast('האזעקה הופעלה!'); setObjective('הבא את הרכב <em>למוסך בנמל</em> לפני שהזמן ייגמר'); mtarget(POI.docks.x, POI.docks.z, '#3fd8c6'); }
      } else if (d.stage === 1) {
        if (player.car !== d.car) { setObjective('חזור <em>לרוסו</em>'); mtarget(d.car.x, d.car.z, '#ff5a5f', d.car); d.away = true; }
        else if (d.away) { d.away = false; setObjective('הבא את הרכב <em>למוסך בנמל</em> לפני שהזמן ייגמר'); mtarget(POI.docks.x, POI.docks.z, '#3fd8c6'); }
        if (player.car === d.car && Math.hypot(d.car.x - POI.docks.x, d.car.z - POI.docks.z) < 5 && d.car.speedAbs < 6) {
          const bonus = Math.round(d.car.hp / d.car.maxHp * 1000 / 50) * 50;
          clearHeat(); exitCar(true); d.car.locked = true; missionPass(bonus);
        }
      }
    },
    cleanup(d) { dispose3D(d.arrow); dispose3D(d.dest); if (d.car && !d.car.removed && player.car !== d.car && !d.car.locked) removeVehicle(d.car); },
  },
  {
    who: 'סהר · מארגן מרוצים', title: 'מלך הלילה', pay: 4000,
    text: 'שלושה נהגים, עשר נקודות ציון וכל העיר כמסלול. קיבלת ממני אאורורה GT. תגיע ראשון לקו הסיום ואני משלם. שני זה המפסיד הראשון.',
    giver: () => ({ x: blockMid(1), z: blockMid(6) + 10 }),
    start(d) {
      const z0 = nodeC(7), x0 = nodeC(1) + 34;
      for (const v of vehicles.slice()) if ((v.mode === 'traffic' || v.mode === 'parked' || v.mode === 'wreck') && Math.hypot(v.x - x0, v.z - z0) < 90 && v !== player.car) removeVehicle(v);
      if (player.car) exitCar(true);
      d.car = spawnVehicle('aurora', x0 - 10, z0 + 2.2, Math.PI / 2, { color: 0x1e5bd6 }); d.car.mission = true;
      enterCar(d.car, true);
      const nodes = [[2, 7], [5, 7], [5, 5], [7, 5], [7, 1], [4, 1], [4, 3], [1, 3], [1, 7]];
      race.path = nodes.map(([i, j]) => ({ x: nodeC(i), z: nodeC(j) })); race.path.push({ x: x0 + 8, z: z0 + 3 });
      race.cp = 0; race.countdown = 3.5; race.racers = [];
      const spots = [[x0, z0 + 5.8, 'ferrari', 0xd01a1a], [x0, z0 + 2.2, 'aurora', 0xf2f2f2], [x0 - 10, z0 + 5.8, 'ferrari', 0xffb000]];
      for (const [x, z, t, c] of spots) { const v = spawnVehicle(t, x, z, Math.PI / 2, { color: c }); if (!v) continue; v.mode = 'racer'; v.mission = true; v.ai = { idx: 0, stuck: 0, rev: 0, skill: rnd(0.78, 0.84), done: false }; race.racers.push(v); }
      d.cpM = makeMarker(0xffb24a, 8, 16); d.cpN = makeMarker(0xffb24a, 4, 8); d.cpN.userData.beam.material.opacity = 0.25;
      mission.timer = -1; setObjective('המרוץ מתחיל…'); mtarget(race.path[0].x, race.path[0].z, '#ffb24a');
    },
    update(d, dt) {
      if (d.car.dead) return missionFail('הרכב שלך נהרס');
      const P = race.path;
      if (race.countdown > 0) {
        const before = Math.ceil(race.countdown); race.countdown -= dt; const now = Math.ceil(race.countdown);
        if (now !== before) { if (now > 0) { banner(String(now), '', false, 700); sound.ok && sound.tone('square', 440, 440, 0.15, 0.12); } else { banner('סע!', '', false, 800); sound.ok && sound.tone('square', 880, 880, 0.3, 0.14); } }
        if (player.car) { player.car.throttle = 0; player.car.brake = 0; player.car.hand = true; }
      }
      const cpp = P[race.cp];
      if (cpp) {
        d.cpM.position.set(cpp.x, 0, cpp.z); const nx = P[race.cp + 1]; d.cpN.visible = !!nx; if (nx) d.cpN.position.set(nx.x, 0, nx.z);
        if (Math.hypot(player.x - cpp.x, player.z - cpp.z) < 14) {
          race.cp++; sound.pickup();
          if (race.cp >= P.length) { const place = 1 + race.racers.filter(r => r.ai.done).length; if (place === 1) missionPass(0); else missionFail(`סיימת במקום ${place}`); return; }
          mtarget(P[race.cp].x, P[race.cp].z, '#ffb24a');
        }
      }
      let place = 1; const myProg = race.cp * 1000 - (cpp ? Math.hypot(player.x - cpp.x, player.z - cpp.z) : 0);
      for (const r of race.racers) { const w = P[r.ai.idx]; const prog = r.ai.done ? 1e9 : r.ai.idx * 1000 - (w ? Math.hypot(r.x - w.x, r.z - w.z) : 0); if (prog > myProg) place++; r.ai.prog = prog; }
      race.myProg = myProg;
      if (race.countdown <= 0) setObjective(`מקום <em>${place}/4</em> · נקודה ${Math.min(race.cp + 1, P.length)}/${P.length}`);
      mission.extra = race.racers.map(r => ({ x: r.x, z: r.z, c: '#ff5a5f', r: 3.5 }));
      if (race.racers.some(r => r.ai.done)) missionFail('יריב חצה ראשון את קו הסיום');
    },
    cleanup(d) { dispose3D(d.cpM); dispose3D(d.cpN); mission.extra = null; for (const r of race.racers) if (!r.removed) { r.mode = 'wreck'; r.mission = false; r.throttle = 0; r.brake = 0; r.hand = true; } race.racers = []; if (d.car && !d.car.removed) d.car.mission = false; },
  },
  {
    who: 'מיקי · מלווה בריבית', title: 'חוב ישן', pay: 5000,
    text: 'החבורה במגרש הכדורסל במזרח העיר חייבת לי כבר חצי שנה. נתתי לך תת-מקלע. תסגור את החשבון ותיעלם לפני שהשוטרים יגיעו.',
    giver: () => ({ x: POI.fountain.x, z: POI.fountain.z + 14 }),
    start(d) {
      player.owned[2] = true; player.ammo[2] += 120; if (player.mag[2] === 0) { player.mag[2] = 30; player.ammo[2] -= 30; } player.weapon = 2; toast('קיבלת תת-מקלע');
      d.gang = [];
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, x = POI.gang.x + Math.cos(a) * rnd(5, 12), z = POI.gang.z + Math.sin(a) * rnd(4, 9); const h = spawnHuman('gang', x, z, rnd(0, 6)); if (!h) continue; h.weapon = k % 2 ? 2 : 1; h.hp = 70; h.ai = { home: { x, z }, hostile: false, fireT: rnd(0.4, 1.4), strafe: rnd(-1, 1), provoked: false, idleClip: k % 3 ? 'idle2' : 'argue' }; h.mission = true; d.gang.push(h); }
      d.stage = 0; setObjective('סע <em>למגרש הכדורסל</em> וטפל בחבורה'); mtarget(POI.gang.x, POI.gang.z, '#ff5a5f');
    },
    update(d, dt) {
      const alive = d.gang.filter(h => h.alive && !h.removed);
      if (d.stage === 0) {
        mission.extra = alive.map(h => ({ x: h.x, z: h.z, c: '#ff5a5f', r: 3.5 }));
        if (Math.hypot(player.x - POI.gang.x, player.z - POI.gang.z) < 60) { mission.target = null; gps.route = null; setObjective(`חסל את <em>החבורה</em> · נשארו ${alive.length}`); }
        if (!alive.length) { d.stage = 1; mission.extra = null; setHeat(2); toast('השכנים התקשרו למשטרה'); setObjective('<em>תאבד את המשטרה</em>'); }
      } else if (d.stage === 1) { if (wanted.level === 0) missionPass(0); }
    },
    cleanup(d) { mission.extra = null; for (const h of d.gang || []) if (!h.removed && h.alive) { h.ai.hostile = false; h.mission = false; } },
  },
  {
    who: 'נוי · מתכננת', title: 'הכספת', pay: 12000,
    text: 'הבנק המרכזי. אני מכבה להם את המצלמות לשמונה שניות של קידוח. ב.מ.וו שחורה מחכה בחוץ. אחרי זה כל העיר תחפש אותך, אז סע ישר למחבוא במחסנים.',
    giver: () => ({ x: POI.hideout.x, z: POI.hideout.z }),
    start(d) {
      d.car = spawnVehicle('bavaria', POI.bank.x + 16, POI.bank.z - 3, Math.PI / 2, { color: 0x16181c, hp: 1500 }); if (d.car) d.car.mission = true;
      d.m = makeMarker(0xff5a5f, 2.2, 7); d.m.position.set(POI.bank.x, CURB, POI.bank.z + 7.5);
      d.stage = 0; d.drill = 0; setObjective('סע <em>לבנק המרכזי</em>'); mtarget(POI.bank.x, POI.bank.z, '#ff5a5f');
    },
    update(d, dt) {
      const bx = POI.bank.x, bz = POI.bank.z + 7.5;
      if (d.stage === 0) {
        const dd = Math.hypot(player.x - bx, player.z - bz);
        if (dd < 2.4 && !player.car) { d.drill += dt; setObjective(`קודח בכספת… <em>${Math.min(100, Math.floor(d.drill / 8 * 100))}%</em>`); if (Math.random() < dt * 8) FX.fx_sparks(bx, CURB + 1, bz - 1.5, 3); }
        else if (d.drill > 0) setObjective('חזור <em>לסימון</em> כדי להמשיך לקדוח');
        if (d.drill >= 8) { d.stage = 1; dispose3D(d.m); d.m = null; setHeat(3); wanted.lockMin = 0; toast('האזעקה בבנק הופעלה!'); sound.jingle(false); d.dest = makeMarker(0x3fd8c6, 4, 9); d.dest.position.set(POI.hideout.x, CURB, POI.hideout.z); setObjective('קח את <em>רכב המילוט</em> וסע למחבוא'); mtarget(POI.hideout.x, POI.hideout.z, '#3fd8c6'); }
      } else {
        if (d.car && !d.car.dead && !d.car.removed) mission.extra = player.car === d.car ? null : [{ x: d.car.x, z: d.car.z, c: '#3fd8c6', r: 4 }]; else mission.extra = null;
        if (Math.hypot(player.x - POI.hideout.x, player.z - POI.hideout.z) < 6) { clearHeat('נעלמת במחבוא'); missionPass(0); }
      }
    },
    cleanup(d) { dispose3D(d.m); dispose3D(d.dest); mission.extra = null; if (d.car && !d.car.removed) d.car.mission = false; },
  },
];
export function openMissionCard(M) {
  flags.modal = true; mission.cardFor = M; document.exitPointerLock && document.exitPointerLock();
  $('mcWho').textContent = M.who; $('mcTitle').textContent = M.title; $('mcText').textContent = M.text; $('mcPay').textContent = fmtMoney(M.pay);
  $('missionCard').hidden = false; setTimeout(() => $('mcGo').focus(), 50);
}
export function closeMissionCard(go) {
  $('missionCard').hidden = true; flags.modal = false; if (!go) mission.declined = true;
  if (go) { startMission(); lockPointer(); }
}
export function startMission() {
  const M = MISSIONS[mission.idx]; mission.active = M; mission.d = {}; mission.timer = -1;
  dispose3D(mission.giverMarker); mission.giverMarker = null; if (mission.giverSprite) { scene.remove(mission.giverSprite); mission.giverSprite = null; }
  banner(M.title, M.who, false, 2600); M.start(mission.d);
}
function endMission() {
  const M = mission.active; if (!M) return; M.cleanup(mission.d); mission.active = null; mission.target = null; mission.extra = null; mission.timer = -1; gps.route = null; setObjective('');
}
export function missionPass(bonus) {
  const M = mission.active; if (!M) return; const pay = M.pay + (bonus || 0);
  endMission(); addMoney(pay); sound.jingle(true);
  mission.idx++;
  if (mission.idx >= MISSIONS.length) banner('העיר שלך', `כל המשימות הושלמו · <b>+${fmtMoney(pay)}</b>`, false, 6000);
  else banner('המשימה הושלמה', `<b>+${fmtMoney(pay)}</b>` + (bonus ? ` · בונוס מצב רכב ${fmtMoney(bonus)}` : ''), false, 4200);
  save();
}
export function missionFail(reason) {
  if (!mission.active) return; endMission(); sound.jingle(false); banner('המשימה נכשלה', reason, true, 3800); mission.cool = 2;
}
export function missionTick(dt) {
  mission.cool = Math.max(0, mission.cool - dt);
  if (!mission.active && mission.idx < MISSIONS.length) {
    const g = MISSIONS[mission.idx].giver(), gy = groundHeight(g.x, g.z);
    if (!mission.giverMarker) { mission.giverMarker = makeMarker(0xffb24a, 1.5, 6); mission.giverMarker.position.set(g.x, gy, g.z); mission.giverSprite = W.textSprite(String(mission.idx + 1)); mission.giverSprite.scale.set(1.4, 1.4, 1); scene.add(mission.giverSprite); }
    mission.giverSprite.position.set(g.x, gy + 3.2 + Math.sin(clock.t * 2) * 0.2, g.z);
    { const s = 1 + Math.sin(clock.t * 3) * 0.06; mission.giverMarker.userData.ring.scale.set(s, s, 1); }
    const d = Math.hypot(player.x - g.x, player.z - g.z);
    if (d > 3) mission.declined = false;
    if (!player.car && !player.dead && d < 1.8 && !mission.declined && mission.cool <= 0 && flags.running && !flags.modal && wanted.level === 0) openMissionCard(MISSIONS[mission.idx]);
  }
  if (mission.active) { mission.active.update(mission.d, dt); if (mission.active && mission.timer >= 0) { mission.timer -= dt; if (mission.timer <= 0) missionFail('הזמן נגמר'); } }
  else if (mission.idx < MISSIONS.length && flags.running && !player.dead) setObjective(wanted.level ? '' : `לך לסימון <em>${mission.idx + 1}</em> במפה כדי להתחיל משימה`);
  else if (flags.running) setObjective('');
}
export function updateRacer(v, dt) {
  const a = v.ai; if (v.dead) { v.throttle = 0; return; }
  if (race.countdown > 0 || a.done) { v.throttle = 0; v.brake = 0; v.hand = true; v.steer = 0; return; }
  v.hand = false;
  const P = race.path, w = P[a.idx]; if (!w) { a.done = true; return; }
  const d = Math.hypot(w.x - v.x, w.z - v.z);
  if (d < 15) { a.idx++; if (a.idx >= P.length) { a.done = true; return; } }
  const W2 = P[a.idx], prev = P[a.idx - 1] || { x: v.x, z: v.z }, nx = P[a.idx + 1];
  let maxV = v.C.maxV * a.skill;
  const lead = (a.prog || 0) - (race.myProg || 0);
  maxV *= lead > 600 ? 0.78 : lead < -600 ? 1.08 : 1;
  if (nx) { const a1 = Math.atan2(W2.x - prev.x, W2.z - prev.z), a2 = Math.atan2(nx.x - W2.x, nx.z - W2.z); if (Math.abs(wrapA(a2 - a1)) > 0.6 && Math.hypot(W2.x - v.x, W2.z - v.z) < 45) maxV = Math.min(maxV, 17); }
  driveToward(v, W2.x, W2.z, maxV, dt);
}
setBlipSource(() => {
  const out = [];
  if (!mission.active && mission.idx < MISSIONS.length) { const g = MISSIONS[mission.idx].giver(); out.push({ x: g.x, z: g.z, c: '#ffb24a', r: 7, edge: true, label: String(mission.idx + 1) }); }
  if (mission.target) { const t = mission.target, x = t.follow ? t.follow.x : t.x, z = t.follow ? t.follow.z : t.z; out.push({ x, z, c: t.color || '#3fd8c6', r: 6, edge: true }); }
  if (mission.extra) for (const e of mission.extra) out.push(e);
  return out;
});
