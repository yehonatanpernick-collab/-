import { $, clamp, lerp, fmtMoney, IS_TOUCH, sound, STATIONS } from './core.js';
import * as W from './world.js';
import { sky } from './render.js';
import { CFG } from './core.js';
import { player, mission, wanted, vehicles, humans, pickups, clock, cam, flags, input, WEAPONS } from './state.js';

const hud = { shownMoney: -1, lastHeat: '', objective: '', hint: '' };
const _txt = {};
export function setT(id, v, html) { if (_txt[id] === v) return; _txt[id] = v; if (html) $(id).innerHTML = v; else $(id).textContent = v; }
export function toast(html, ms = 3200) {
  const el = document.createElement('div'); el.className = 'toast panel'; el.innerHTML = html; $('toasts').appendChild(el);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, ms);
}
let bannerTimer = null;
export function banner(big, sub, bad = false, ms = 3500) {
  $('bannerBig').textContent = big; $('bannerBig').className = 'big' + (bad ? ' bad' : ''); $('bannerSub').innerHTML = sub || '';
  $('banner').classList.add('on'); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => $('banner').classList.remove('on'), ms);
}
export function setObjective(html) { if (hud.objective !== html) { hud.objective = html; $('objective').innerHTML = html; } }
export function setHint(html) { if (hud.hint !== html) { hud.hint = html; $('hint').innerHTML = html || ''; $('hint').hidden = !html; } }
export function hudHeat(force) {
  const k = wanted.level + '|' + (wanted.seen ? 1 : 0) + '|' + (wanted.level && wanted.evade > 1.5 ? 1 : 0);
  if (!force && k === hud.lastHeat) return; hud.lastHeat = k;
  const el = $('heat'), is = el.children;
  for (let i = 0; i < 5; i++) is[i].classList.toggle('on', i < wanted.level);
  el.classList.toggle('flash', wanted.level > 0 && wanted.evade <= 1.5);
  el.classList.toggle('evade', wanted.level > 0 && wanted.evade > 1.5);
}
export function hitMarker(kill) {
  if (sound.ok) { sound.tone('triangle', kill ? 1500 : 2200, kill ? 900 : 1900, kill ? 0.12 : 0.05, kill ? 0.16 : 0.08); } const c = $('crosshair'); c.classList.add('hit'); clearTimeout(c._t); c._t = setTimeout(() => c.classList.remove('hit'), 120); }
export function addMoney(n, quiet) {
  player.money = Math.max(0, player.money + n);
  if (!quiet) { const d = $('moneyDelta'); d.textContent = (n >= 0 ? '+' : '−') + fmtMoney(Math.abs(n)); d.style.color = n >= 0 ? 'var(--sea)' : 'var(--coral)'; d.classList.add('show'); clearTimeout(d._t); d._t = setTimeout(() => d.classList.remove('show'), 1800); }
}
let hintFn = () => '';
export function setHintSource(fn) { hintFn = fn; }
export function updateHUD(dt) {
  if (hud.shownMoney !== player.money) { hud.shownMoney = hud.shownMoney < 0 ? player.money : Math.abs(player.money - hud.shownMoney) < 2 ? player.money : lerp(hud.shownMoney, player.money, Math.min(1, dt * 6)); $('moneyVal').textContent = fmtMoney(hud.shownMoney); }
  { const m = sky.next || sky.cur, f = clamp(sky.timer / ((CFG.moodSeconds[m]) || 300), 0, 1), span = { day: [9, 17.5], sunset: [17.5, 20], night: [20, 29] }[m] || [12, 12];
    const hrs = (lerp(span[0], span[1], f)) % 24, hh = Math.floor(hrs), mm = Math.floor((hrs - hh) * 60);
    setT('clock', String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')); }
  const Wp = WEAPONS[player.weapon];
  setT('wname', Wp.name);
  setT('ammo', Wp.melee ? '' : `${player.mag[player.weapon]}<small> / ${player.ammo[player.weapon]}</small>`, true);
  $('hp').firstChild.style.transform = `scaleX(${clamp(player.hp / 100, 0, 1)})`;
  $('ar').firstChild.style.transform = `scaleX(${clamp(player.armor / 100, 0, 1)})`; $('ar').classList.toggle('empty', player.armor <= 0);
  const v = player.car, inCar = !!v;
  $('speedo').hidden = !inCar;
  if (inCar) { setT('spd', String(Math.round(Math.abs(v.fwdSpeed) * 3.6))); const f = clamp(v.hp / v.maxHp, 0, 1); const bar = $('cardmg'); bar.style.transform = `scaleX(${f})`; bar.style.background = f < 0.3 ? 'var(--coral)' : f < 0.6 ? 'var(--amber)' : 'var(--sea)'; }
  $('crosshair').classList.toggle('on', flags.running && !inCar && !player.dead && !Wp.melee && (player.h && player.h.aiming));
  $('weapon').style.opacity = inCar ? 0.45 : 1;
  $('damageVignette').style.opacity = player.hurtT > 0 ? clamp(player.hurtT, 0, 0.9) : player.hp < 30 && !player.dead ? 0.35 + Math.sin(clock.t * 5) * 0.12 : 0;
  if (mission.timer >= 0 && mission.active) { const t = Math.max(0, mission.timer); $('timer').hidden = false; setT('timer', Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0')); $('timer').classList.toggle('low', t < 15); }
  else $('timer').hidden = true;
  setT('radioName', inCar && sound.radioWanted ? STATIONS[sound.station].name : '');
  setHint(flags.running && !player.dead && !flags.modal ? hintFn() : '');
}

/* =====================================================================
   MINIMAP / BIG MAP
   ===================================================================== */
const MAP_R = 560; let mapBase = null;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export function buildMapBase() {
  const { PROM, EDGE, NB, blockType, blockLo, blockHi, buildings, PIER, RAMPS } = W;
  const S = 1120, c = mk(S, S), g = c.getContext('2d'), k = S / (2 * MAP_R);
  g.setTransform(k, 0, 0, k, S / 2, S / 2);
  g.fillStyle = '#0a2230'; g.fillRect(-MAP_R, -MAP_R, 2 * MAP_R, 2 * MAP_R);
  g.fillStyle = '#5f5640'; g.beginPath(); if (g.roundRect) g.roundRect(-362, -362, 724, 724, 52); else g.rect(-362, -362, 724, 724); g.fill();
  g.fillStyle = '#8b8574'; g.fillRect(-PROM, -PROM, PROM * 2, PROM * 2);
  g.fillStyle = '#3d424d'; g.fillRect(-EDGE, -EDGE, EDGE * 2, EDGE * 2);
  for (let bj = 0; bj < NB; bj++) for (let bi = 0; bi < NB; bi++) {
    const t = blockType(bi, bj), x0 = blockLo(bi), z0 = blockLo(bj), w = blockHi(bi) - x0;
    g.fillStyle = '#1b1f28'; g.fillRect(x0, z0, w, w);
    if (t === 'K') { g.fillStyle = '#244a2c'; g.fillRect(x0 + 4, z0 + 4, w - 8, w - 8); }
    if (t === 'R' || t === 'G') { g.fillStyle = '#2a2e37'; g.fillRect(x0 + 5, z0 + 5, w - 10, w - 10); }
  }
  g.fillStyle = '#2c3342';
  for (const b of buildings) if (!b.low && b.h > 3) g.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 0.8; for (const b of buildings) if (!b.low && b.h > 3) g.strokeRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  g.fillStyle = '#7a5d40'; g.fillRect(PIER.x0, PIER.z0, PIER.px0 - PIER.x0, PIER.z1 - PIER.z0); g.fillRect(PIER.px0, PIER.pz0, PIER.x1 - PIER.px0, PIER.pz1 - PIER.pz0);
  g.fillStyle = '#e0a030'; for (const r of RAMPS) { g.save(); g.translate(r.x, r.z); g.rotate(-r.h); g.fillRect(-r.w / 2, 0, r.w, r.len); g.restore(); }
  mapBase = c;
}
export const gps = { route: null, t: 0 };
let blipSource = () => [];
export function setBlipSource(fn) { blipSource = fn; }
function blips() {
  const out = blipSource();
  for (const v of vehicles) if ((v.mode === 'police' || v.mode === 'policeStop') && !v.dead) out.push({ x: v.x, z: v.z, c: Math.floor(clock.t * 4) % 2 ? '#ff2d3c' : '#2f6bff', r: 4.5 });
  for (const h of humans) if (h.kind === 'cop' && h.alive) out.push({ x: h.x, z: h.z, c: '#62b6ff', r: 3 });
  for (const p of pickups) if (p.active && p.type !== 'cash' && Math.hypot(p.x - player.x, p.z - player.z) < 160) out.push({ x: p.x, z: p.z, c: p.type === 'health' ? '#9cff8a' : p.type === 'armor' ? '#62b6ff' : '#ffffff', r: 3, sq: true });
  return out;
}
export function drawMinimap() {
  const mm = $('minimap'), g = mm.getContext('2d'), Wd = mm.width; if (!mapBase) return;
  const sp = player.car ? player.car.speedAbs : 0, zoom = (Wd / 200) * (player.car ? lerp(1.15, 0.55, clamp(sp / 45, 0, 1)) : 1.5);
  const th = cam.yaw - Math.PI, c = Math.cos(th), s = Math.sin(th), px = player.x, pz = player.z;
  const toM = (x, z) => { const dx = (x - px) * zoom, dz = (z - pz) * zoom; return [Wd / 2 + dx * c - dz * s, Wd / 2 + dx * s + dz * c]; };
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, Wd, Wd);
  g.save(); g.translate(Wd / 2, Wd / 2); g.rotate(th); g.scale(zoom, zoom); g.translate(-px, -pz);
  g.drawImage(mapBase, -MAP_R, -MAP_R, MAP_R * 2, MAP_R * 2); g.restore();
  if (gps.route) { g.strokeStyle = '#ffb24a'; g.lineWidth = 5; g.lineJoin = 'round'; g.globalAlpha = 0.85; g.beginPath(); gps.route.forEach((p, i) => { const [x, y] = toM(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.globalAlpha = 1; }
  for (const b of blips()) {
    let [x, y] = toM(b.x, b.z); const dx = x - Wd / 2, dy = y - Wd / 2, d = Math.hypot(dx, dy), lim = Wd / 2 - 14;
    if (d > lim) { if (!b.edge) continue; x = Wd / 2 + dx / d * lim; y = Wd / 2 + dy / d * lim; }
    g.fillStyle = b.c; g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 2;
    g.beginPath(); if (b.sq) g.rect(x - b.r, y - b.r, b.r * 2, b.r * 2); else g.arc(x, y, b.r * 1.6, 0, 7); g.fill(); g.stroke();
    if (b.label) { g.fillStyle = '#1b1206'; g.font = '900 15px "Big Shoulders Display", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.label, x, y + 1); }
  }
  { let [x, y] = toM(px, pz - 9999); const dx = x - Wd / 2, dy = y - Wd / 2, d = Math.hypot(dx, dy); x = Wd / 2 + dx / d * (Wd / 2 - 16); y = Wd / 2 + dy / d * (Wd / 2 - 16); g.fillStyle = 'rgba(9,11,20,.8)'; g.beginPath(); g.arc(x, y, 12, 0, 7); g.fill(); g.fillStyle = '#f6f1e7'; g.font = '800 15px "Big Shoulders Display", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', x, y + 1); }
  const ph = player.car ? player.car.h : player.h.yaw, ang = Math.atan2(Math.cos(ph), Math.sin(ph)) + th;
  g.save(); g.translate(Wd / 2, Wd / 2); g.rotate(ang + Math.PI / 2);
  g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -13); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.stroke(); g.restore();
}
export function drawBigMap() {
  const cv = $('bigmapCanvas'), g = cv.getContext('2d'), S = cv.width, k = S / (2 * 400); if (!mapBase) return;
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0a2230'; g.fillRect(0, 0, S, S);
  g.setTransform(k, 0, 0, k, S / 2, S / 2); g.drawImage(mapBase, -MAP_R, -MAP_R, MAP_R * 2, MAP_R * 2);
  if (gps.route) { g.strokeStyle = '#ffb24a'; g.lineWidth = 4 / k; g.beginPath(); gps.route.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); }
  const dot = (x, z, c, r, label) => { g.fillStyle = c; g.strokeStyle = '#000'; g.lineWidth = 2 / k; g.beginPath(); g.arc(x, z, r / k, 0, 7); g.fill(); g.stroke(); if (label) { g.fillStyle = '#1b1206'; g.font = `900 ${14 / k}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, x, z + 1 / k); } };
  dot(W.POI.hospital.x, W.POI.hospital.z, '#9cff8a', 7, '+'); dot(W.POI.police.x, W.POI.police.z, '#62b6ff', 7, 'P');
  for (const b of blips()) dot(b.x, b.z, b.c, b.r * 1.3, b.label);
  dot(player.x, player.z, '#fff', 8);
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = 'rgba(246,241,231,.85)'; g.font = '800 22px "Big Shoulders Display", Arial'; g.textAlign = 'left'; g.fillText('SUNSET BAY', 24, 40);
}
