// HUD, maps, journal, guided hikes, photo mode and settings.
import * as THREE from 'three';
import { clamp, lerp, ss, SIZE, HALF, N, BASE, LAKES, LK, PEAKS, CHANNELS, TRAILS, valleyZ, lakeR } from './shared.js';
import { $, isTouch, scene, camera, G, U, Qs, QUALITY, hex, cellOf, trailAt, heightAt, bus } from './core.js';
import { sky_state, setTime, setWeather } from './atmos.js';
import { SPECIES_INFO } from './wildlife.js';
import { LANDMARK_POIS } from './landmarks.js';
import { FALLS } from './shared.js';
import { P, teleport, lakeSpot } from './player.js';

// ---------------------------------------------------------------- places
const NOTES = {
  bear: 'אחד האגמים המצולמים בפארק, מתחת לפסגת האלט. מכאן יוצאים השבילים לאגמי נימף, דרים ואמרלד.',
  nymph: 'אגם רדוד שבקיץ מתכסה בחבצלות מים צהובות.',
  dream: 'אגם צר וארוך בין עצי אשוח, עם השתקפות של פסגת האלט בבוקר שקט.',
  emerald: 'יושב בקערה קרחונית (סירק) מתחת לקירות הגרניט של פסגת האלט.',
  haiyaha: 'ב-2023 שינה את צבעו לטורקיז חלבי בגלל "קמח סלעים" שנסחף אליו מהמפולת.',
  loch: 'אגם רחב בעמק גלסייר גורג׳, מוקף מצוקים ויער אשוח.',
  sky: 'האגם הגבוה בעמק, מתחת למחטי הסלע של "קתדרל וול". מגיעים אליו לאחר טיפוס ליד מפל.',
  chasm: 'שוכן לרגלי הקיר המזרחי של פסגת לונגס. לפעמים צף בו קרח גם ביולי.',
  sprague: 'אגם רדוד בעמק עם השתקפות מושלמת של קו פרשת המים בבוקר.',
  lawn: 'אגם בצפון הפארק. ב-1982 קרס הסכר שלו והמים הציפו את העמק עד העיירה.',
};
const PEAK_NOTES = {
  'Longs Peak': 'הפסגה הגבוהה בפארק (4,346 מ׳ במציאות) — ה"ארבע-עשר" הצפוני ביותר בקולורדו.',
  'Hallett Peak': 'פסגה בעלת גב שטוח וקיר צפוני תלול שמתנשא מעל אגם אמרלד.',
  'Taylor Peak': 'על קו פרשת המים היבשתי, מעל סקיי פונד.',
  'Mount Ida': 'נקודת תצפית על עמק פורסט קניון.',
  'Ypsilon Mountain': 'נקרא על שם הערוצים בצורת Y בפני ההר.',
  'Mount Meeker': 'השכן הדרומי של לונגס, עם רכס משונן.',
  'Continental Divide': 'הקו שמפריד בין מים שזורמים לאוקיינוס השקט לבין מים שזורמים לאטלנטי.',
};
export const POIS = [];
export function buildPOIs() {
  LAKES.filter(L => !L.minor).forEach(L => POIS.push({ id: 'lake:' + L.id, he: L.he, en: L.en, x: L.x, z: L.z, r: L.r * Math.max(L.sx, L.sy) + 110, kind: 'lake', lake: L, note: NOTES[L.id] }));
  const bv = LAKES.filter(L => L.minor);
  if (bv.length) POIS.push({ id: 'lm:beaver', he: 'בריכות הבונים', en: 'Beaver Ponds', x: (bv[0].x + bv[1].x) / 2, z: (bv[0].z + bv[1].z) / 2, r: 140, kind: 'landmark', note: 'הבונים בונים סכרים מענפים ובוץ על הנהר, ויוצרים בריכות שקטות שבהן חיים אייל קורא, ברווזים ודגים.' });
  if (FALLS.at) POIS.push({ id: 'lm:falls', he: 'מפל אלברטה', en: 'Alberta Falls', x: FALLS.at[0], z: FALLS.at[1], r: 80, kind: 'landmark', note: 'מפל של נחל גלסייר שנופל בין סלעי גרניט, אחד היעדים הפופולריים ביותר בפארק.' });
  POIS.push(...LANDMARK_POIS());
  PEAKS.forEach(p => {
    let bx = p.x, bz = p.z, bh = -1e9; for (let t = 0; t < 400; t++) { const a = t * 2.4, d = Math.sqrt(t / 400) * p.r * 0.9, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d, h = heightAt(x, z); if (h > bh) { bh = h; bx = x; bz = z; } }
    POIS.push({ id: 'peak:' + p.en, he: p.he, en: p.en, x: bx, z: bz, r: 300, kind: 'peak', note: PEAK_NOTES[p.en] });
  });
  POIS.push({ id: 'valley:moraine', he: 'עמק מוריין פארק', en: 'Moraine Park', x: -600, z: valleyZ(-600), r: 650, kind: 'valley', note: 'עמק רחב שנוצר מאחורי מורנה קרחונית. עדרי וָאפִּיטִי רועים בו בבקרים ובערבים.' });
  POIS.push({ id: 'valley:horseshoe', he: 'עמק הורסשו', en: 'Horseshoe Park', x: 1500, z: valleyZ(1500), r: 550, kind: 'valley', note: 'אחו פתוח בצורת פרסה, עם אגמונים של בונים וצמחיית ערבה.' });
  POIS.push({ id: 'tundra:trailridge', he: 'טונדרה אלפינית · טרייל רידג׳', en: 'Trail Ridge Tundra', x: 800, z: -2150, r: 900, kind: 'tundra', note: 'מעל קו העצים: צמחים בגובה כמה סנטימטרים, כריות טחב, פרחים זעירים ומרמיטות.' });
}
export function placeAt(x, z, e) {
  let best = null, bd = 1e9;
  for (const p of POIS) { const d = Math.hypot(x - p.x, z - p.z) / p.r; if (d < 1 && d < bd) { bd = d; best = p; } }
  const k = cellOf(x, z);
  if (G.CHD[k] < 14 && G.CHID[k] >= 0 && (!best || best.kind === 'valley')) { const c = CHANNELS[G.CHID[k]]; return { he: c.he, en: c.en }; }
  const ti = G.TRID[trailAt(x, z)]; if (G.TRL[trailAt(x, z)] > 90 && ti >= 0 && (!best || best.kind !== 'lake' || bd > 0.7)) return { he: TRAILS[ti].he, en: TRAILS[ti].en, poi: best };
  if (best) return { he: best.he, en: best.en, poi: best };
  const f = G.BIO[k * 4] / 255;
  if (e > 3900) return { he: 'רכס אלפיני', en: 'Alpine ridge' };
  if (e > 3480) return { he: 'טונדרה אלפינית', en: 'Alpine tundra' };
  if (f > 0.4) return e > 3000 ? { he: 'יער אשוח ואשוחית תת-אלפיני', en: 'Subalpine spruce-fir forest' } : { he: 'יער מונטני', en: 'Montane forest' };
  return { he: 'אחו מונטני', en: 'Montane meadow' };
}

// ---------------------------------------------------------------- journal (persisted per viewer)
const J = { places: new Set(), species: new Set(), badges: new Set(), maxE: 0 };
try { const s = JSON.parse(localStorage.getItem('rmnp-journal') || 'null'); if (s) { s.places?.forEach(p => J.places.add(p)); s.species?.forEach(p => J.species.add(p)); s.badges?.forEach(p => J.badges.add(p)); J.maxE = s.maxE || 0; } } catch (_) {}
const saveJ = () => { try { localStorage.setItem('rmnp-journal', JSON.stringify({ places: [...J.places], species: [...J.species], badges: [...J.badges], maxE: J.maxE })); } catch (_) {} };
export const journalSpecies = () => [...J.species];
export const visited = (id) => J.places.has(id);
const BADGES = [
  { id: 'lakes', he: 'צייד אגמים', d: 'ביקור בכל עשרת האגמים', ok: () => LAKES.filter(L => !L.minor).every(L => J.places.has('lake:' + L.id)) },
  { id: 'roads', he: 'כביש השמיים', d: 'ביקור בטרייל רידג׳ רואד ובמרכז המבקרים האלפיני', ok: () => J.places.has('lm:road') && J.places.has('lm:visitor') },
  { id: 'summit', he: 'מעל 4,000 מטר', d: 'עמידה בגובה 4,000 מ׳ ומעלה ברגל', ok: () => J.maxE >= 4000 },
  { id: 'wild6', he: 'עין חדה', d: 'תצפית על 6 מיני חיות בר', ok: () => J.species.size >= 6 },
  { id: 'wildall', he: 'מדריך טבע', d: `תצפית על כל ${Object.keys(SPECIES_INFO).length} המינים`, ok: () => J.species.size >= Object.keys(SPECIES_INFO).length },
  { id: 'storm', he: 'סופה בהרים', d: 'טיול בזמן סופת אחר-צהריים', ok: () => U.storm.value > 0.8 && !P.fly },
  { id: 'tundra', he: 'מעל קו העצים', d: 'ביקור בטונדרה של טרייל רידג׳', ok: () => J.places.has('tundra:trailridge') },
];
function checkBadges() { for (const b of BADGES) if (!J.badges.has(b.id) && b.ok()) { J.badges.add(b.id); saveJ(); toast('תג חדש: ' + b.he, b.d, 'badge'); } }
export function spotted(type, d) {
  const s = SPECIES_INFO[type]; const isNew = !J.species.has(type);
  J.species.add(type); saveJ();
  toast((isNew ? 'תצפית חדשה: ' : 'תצפית: ') + s.he, `${s.en} · ${Math.round(d)} מ׳ ממך`);
  checkBadges(); renderJournal();
}

// ---------------------------------------------------------------- toast & info card
let toastT = 0;
export function toast(t, sub, kind) {
  const el = $('toast'); el.innerHTML = ''; el.className = 'glass' + (kind ? ' ' + kind : ''); el.append(t);
  if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); }
  requestAnimationFrame(() => el.classList.add('show')); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 4200);
}
let lastPoi = null, cardT = 0;
function showCard(p) {
  const e = heightAt(p.x, p.z) + BASE;
  $('cardKind').textContent = { lake: 'אגם', peak: 'פסגה', valley: 'עמק', tundra: 'טונדרה', landmark: 'אתר' }[p.kind] || '';
  $('cardName').textContent = p.he; $('cardEn').textContent = p.en;
  $('cardElev').textContent = `${Math.round(e).toLocaleString('he-IL')} מ׳ · ${Math.round(e * 3.28084).toLocaleString('en-US')} ft`;
  $('cardNote').textContent = p.note || '';
  $('infoCard').classList.add('show'); clearTimeout(cardT); cardT = setTimeout(() => $('infoCard').classList.remove('show'), 7000);
}

// ---------------------------------------------------------------- maps
let mapBase;
export function buildMapBase() {
  const S = 1000, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), img = g.createImageData(S, S);
  const { H, NRM, BIO, LKD, LKID, CHD } = G;
  const lakeCols = LAKES.map(L => hex(L.sh).convertLinearToSRGB());
  const E = new Float32Array(S * S);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const i = Math.min(N - 1, Math.round(px / (S - 1) * (N - 1))), j = Math.min(N - 1, Math.round(py / (S - 1) * (N - 1))), k = j * N + i;
    const e = H[k] + BASE, ny = NRM[k * 3 + 1], s = 1 - ny, f = BIO[k * 4] / 255, fl = BIO[k * 4 + 1] / 255;
    E[py * S + px] = e;
    let r, gg, b;
    if (e < 3450) { r = lerp(176, 70, f); gg = lerp(186, 112, f); b = lerp(118, 72, f); r += fl * 20; b += fl * 22; }
    else { r = 190; gg = 180; b = 140; }
    if (s > 0.42 || e > 3800) { r = 164; gg = 156; b = 150; }
    if (e > 3900 && s < 0.6) { r = 240; gg = 242; b = 246; }
    const shade = clamp(0.6 + 0.85 * (-NRM[k * 3] * 0.6 - NRM[k * 3 + 2] * 0.5 + ny * 0.62), 0.4, 1.22);
    r *= shade; gg *= shade; b *= shade;
    if (LKD[k] < 0) { const c = lakeCols[LKID[k]]; r = c.r * 255; gg = c.g * 255; b = c.b * 255; }
    else if (CHD[k] < 2.5) { r = 70; gg = 140; b = 190; }
    const o = (py * S + px) * 4; img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  // contour lines every 50 m, index contours every 250 m
  for (let py = 1; py < S; py++) for (let px = 1; px < S; px++) {
    const e = E[py * S + px], a = Math.floor(e / 50), bL = Math.floor(E[py * S + px - 1] / 50), bU = Math.floor(E[(py - 1) * S + px] / 50);
    if (a !== bL || a !== bU) { const o = (py * S + px) * 4, idx = Math.max(a, bL, bU) % 5 === 0; const k = idx ? 0.62 : 0.82; img.data[o] *= k; img.data[o + 1] *= k; img.data[o + 2] *= k * 0.95; }
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(120,60,30,.95)'; g.lineWidth = 2; g.setLineDash([6, 4]);
  for (const T of TRAILS) { g.beginPath(); T.path.forEach(([x, z], i) => { const px = (x + HALF) / SIZE * S, py = (z + HALF) / SIZE * S; i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); }
  g.setLineDash([]);
  mapBase = cv;
}
export function drawBigMap() {
  const cv = $('bigMap'), g = cv.getContext('2d'), S = cv.width;
  g.drawImage(mapBase, 0, 0, S, S);
  const k = clamp(S / (cv.clientWidth || S), 1, 3);
  g.font = `600 ${Math.round(14 * k)}px Assistant, sans-serif`; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = 'rgba(20,14,8,.75)';
  for (const p of POIS) {
    if (p.kind === 'valley' || p.en === 'Continental Divide') continue;
    const x = (p.x + HALF) / SIZE * S, y = (p.z + HALF) / SIZE * S, seen = J.places.has(p.id);
    g.fillStyle = seen ? '#ffd27a' : '#fff6df';
    if (p.kind === 'peak') { g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5, y + 4); g.lineTo(x - 5, y + 4); g.closePath(); g.fill(); } else { g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
    g.strokeText(p.he, x, y - 8 * k); g.fillText(p.he, x, y - 8 * k);
  }
  if (hike) { const [x, z] = hike.target; g.fillStyle = '#e0a63c'; g.beginPath(); g.arc((x + HALF) / SIZE * S, (z + HALF) / SIZE * S, 8, 0, 7); g.fill(); }
  const x = (P.x + HALF) / SIZE * S, y = (P.z + HALF) / SIZE * S;
  g.save(); g.translate(x, y); g.rotate(-P.yaw); g.fillStyle = '#e0a63c'; g.strokeStyle = '#1c130b'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -14); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.stroke(); g.restore();
  g.fillStyle = 'rgba(20,14,8,.7)'; g.fillRect(S - 52, 12, 40, 40); g.fillStyle = '#fff6df'; g.font = '700 20px Assistant'; g.fillText('N', S - 32, 39);
  g.fillStyle = 'rgba(20,14,8,.7)'; g.fillRect(14, S - 40, 190, 28); g.fillStyle = '#fff6df'; g.fillRect(24, S - 22, 1000 / SIZE * S, 4); g.font = '600 14px Assistant'; g.textAlign = 'left'; g.fillText('1 ק״מ · קווי גובה כל 50 מ׳', 24 + 1000 / SIZE * S + 8, S - 17);
}
function drawMini() {
  const cv = $('mini'), g = cv.getContext('2d'), S = cv.width, span = 900, ms = mapBase.width;
  const sx = (P.x + HALF - span / 2) / SIZE * ms, sz = (P.z + HALF - span / 2) / SIZE * ms, sw = span / SIZE * ms;
  g.save(); g.clearRect(0, 0, S, S); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.clip();
  g.fillStyle = '#2b3a2c'; g.fillRect(0, 0, S, S); g.drawImage(mapBase, sx, sz, sw, sw, 0, 0, S, S);
  if (hike) { const [tx, tz] = hike.marker; g.fillStyle = '#e0a63c'; g.beginPath(); g.arc(S / 2 + (tx - P.x) / span * S, S / 2 + (tz - P.z) / span * S, 7, 0, 7); g.fill(); }
  g.translate(S / 2, S / 2); g.rotate(-P.yaw); g.fillStyle = '#e0a63c'; g.strokeStyle = '#1c130b'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, -18); g.lineTo(12, 13); g.lineTo(0, 6); g.lineTo(-12, 13); g.closePath(); g.fill(); g.stroke(); g.restore();
  g.fillStyle = '#fff6df'; g.font = '700 26px Assistant'; g.textAlign = 'center'; g.fillText('N', S / 2, 30);
}

// ---------------------------------------------------------------- compass ribbon
const DIRS = [['צ', 0], ['צמ', 45], ['מז', 90], ['דמ', 135], ['ד', 180], ['דמע', 225], ['מע', 270], ['צמע', 315]];
function drawCompass() {
  const cv = $('compassC'), g = cv.getContext('2d'), W = cv.width, Hh = cv.height;
  g.clearRect(0, 0, W, Hh);
  const hd = ((-P.yaw * 180 / Math.PI) % 360 + 360) % 360, span = 160;
  const x = (deg) => { let d = ((deg - hd + 540) % 360) - 180; return W / 2 + d / span * W; };
  g.strokeStyle = 'rgba(242,227,192,.5)'; g.lineWidth = 2;
  for (let d = 0; d < 360; d += 15) { const px = x(d); if (px < 0 || px > W) continue; g.beginPath(); g.moveTo(px, Hh); g.lineTo(px, Hh - (d % 45 ? 5 : 10)); g.stroke(); }
  g.font = '700 22px Assistant'; g.textAlign = 'center'; g.fillStyle = '#f2e3c0';
  for (const [l, d] of DIRS) { const px = x(d); if (px > 10 && px < W - 10) g.fillText(l, px, 22); }
  g.font = '600 13px Assistant'; g.fillStyle = '#ffd27a';
  const used = [];
  const cand = POIS.filter(p => p.kind === 'lake' || p.kind === 'peak').map(p => ({ p, d: Math.hypot(p.x - P.x, p.z - P.z) })).filter(o => o.d > 60 && o.d < 2500).sort((a, b) => a.d - b.d);
  for (const { p } of cand) {
    const brg = (Math.atan2(p.x - P.x, -(p.z - P.z)) * 180 / Math.PI + 360) % 360, px = x(brg);
    if (px < 40 || px > W - 40 || used.some(u => Math.abs(u - px) < 70)) continue;
    used.push(px); g.fillText(p.he, px, Hh - 16);
  }
  if (hike) { const [tx, tz] = hike.marker, brg = (Math.atan2(tx - P.x, -(tz - P.z)) * 180 / Math.PI + 360) % 360, px = x(brg); g.fillStyle = '#e0a63c'; g.beginPath(); g.moveTo(px, Hh - 2); g.lineTo(px - 8, Hh - 14); g.lineTo(px + 8, Hh - 14); g.fill(); }
  g.fillStyle = '#e0a63c'; g.fillRect(W / 2 - 1, Hh - 24, 2, 24);
}

// ---------------------------------------------------------------- guided hikes with a 3D beacon
let hike = null, beacon;
const HIKES = [
  { he: 'אגם בר ← אגם אמרלד', en: 'Bear Lake to Emerald Lake', trail: 0, from: 0, to: 'emerald' },
  { he: 'אגם בר ← אגם הייאהה', en: 'Bear Lake to Lake Haiyaha', trail: 1, from: 0, to: 'haiyaha', via: 0 },
  { he: 'אגם בר ← סקיי פונד', en: 'Bear Lake to Sky Pond', trail: 2, from: 0, to: 'sky' },
  { he: 'אל אגם צ׳אזם ופסגת לונגס', en: 'Longs Peak Trail', trail: 4, from: 0, to: 'chasm' },
  { he: 'קהילות הטונדרה', en: 'Tundra Communities Trail', trail: 5, from: 0, to: null },
  { he: 'אל אגם לון', en: 'Lawn Lake Trail', trail: 6, from: 0, to: 'lawn' },
];
function buildBeacon() {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.4, 0.4), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  beacon = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 40, 12, 1, true).translate(0, 20, 0), mat);
  const ringM = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.7, 40).rotateX(-Math.PI / 2), mat.clone()); ringM.position.y = 0.15;
  beacon.add(beam, ringM); beacon.visible = false; scene.add(beacon);
}
function startHike(h) {
  const T = TRAILS[h.trail];
  let end = T.path.length - 1;
  if (h.to) { const L = LAKES[LK[h.to]]; let bd = 1e9; T.path.forEach((p, i) => { const d = Math.hypot(p[0] - L.x, p[1] - L.z); if (d < bd) { bd = d; end = i; } }); }
  hike = { ...h, T, end, target: T.path[end], marker: T.path[0], idx: 0 };
  const [sx, sz] = T.path[0];
  if (Math.hypot(sx - P.x, sz - P.z) > 300) { const [nx, nz] = T.path[Math.min(8, T.path.length - 1)]; teleport(sx, sz, nx, nz); }
  beacon.visible = true; $('hikeBar').hidden = false; $('hikeName').textContent = h.he;
  toast('מסלול מודרך: ' + h.he, `${(T.cum[end] / 1000).toFixed(1)} ק״מ · עקבו אחרי המגדלור הכתום`);
  closePanels();
}
function stopHike() { hike = null; beacon.visible = false; $('hikeBar').hidden = true; }
function updateHike(now) {
  if (!hike) return;
  const T = hike.T; let bi = hike.idx, bd = 1e9;
  for (let i = Math.max(0, hike.idx - 40); i < Math.min(hike.end + 1, hike.idx + 200); i++) { const d = Math.hypot(T.path[i][0] - P.x, T.path[i][1] - P.z); if (d < bd) { bd = d; bi = i; } }
  if (bd < 40) hike.idx = Math.max(hike.idx, bi);
  const mi = Math.min(hike.end, hike.idx + 18); hike.marker = T.path[mi];
  const [mx, mz] = hike.marker; beacon.position.set(mx, heightAt(mx, mz), mz);
  beacon.children[1].scale.setScalar(1 + 0.15 * Math.sin(now * 3)); beacon.children[0].material.opacity = 0.35 + 0.2 * Math.sin(now * 2);
  const left = Math.max(0, T.cum[hike.end] - T.cum[hike.idx]) + (bd > 40 ? bd : 0);
  $('hikeLeft').textContent = `${(left / 1000).toFixed(2)} ק״מ נותרו · ${(left / 1609).toFixed(1)} mi`;
  if (hike.idx >= hike.end - 3 && Math.hypot(hike.target[0] - P.x, hike.target[1] - P.z) < 30) {
    toast('הגעתם! ' + hike.he, 'המסלול הושלם', 'badge'); bus.emit('hike', hike.he); stopHike();
  }
}

// ---------------------------------------------------------------- panels & settings
export const UIState = { battery: false };
export function closePanels() { for (const id of ['mapPanel', 'setPanel', 'journalPanel']) $(id).hidden = true; }
function openPanel(id) { const was = !$(id).hidden; closePanels(); if (!was) { $(id).hidden = false; if (document.pointerLockElement) document.exitPointerLock(); } return !was; }
export function toggleMap() { if (openPanel('mapPanel')) drawBigMap(); }
function renderJournal() {
  const pl = POIS.filter(p => p.kind !== 'peak' || p.en !== 'Continental Divide');
  $('jPlaces').innerHTML = pl.map(p => `<div class="jItem ${J.places.has(p.id) ? 'yes' : ''}"><b>${p.he}</b><span>${p.en}</span></div>`).join('');
  $('jSpecies').innerHTML = Object.entries(SPECIES_INFO).map(([k, v]) => `<div class="jItem ${J.species.has(k) ? 'yes' : ''}"><b>${v.he}</b><span>${J.species.has(k) ? v.note : v.en}</span></div>`).join('');
  $('jBadges').innerHTML = BADGES.map(b => `<div class="badge ${J.badges.has(b.id) ? 'yes' : ''}"><b>${b.he}</b><span>${b.d}</span></div>`).join('');
  $('jCount').textContent = `${J.places.size}/${pl.length} מקומות · ${J.species.size}/${Object.keys(SPECIES_INFO).length} מינים · ${J.badges.size}/${BADGES.length} תגים`;
}
let qualityCb = () => {}, soundCb = () => {};
export function initUI({ onQuality, onSound }) {
  qualityCb = onQuality; soundCb = onSound;
  buildBeacon();
  $('bMap').onclick = toggleMap; $('bMap2').onclick = toggleMap; $('mini').onclick = toggleMap; $('mapClose').onclick = closePanels;
  $('bSet').onclick = () => openPanel('setPanel'); $('setClose').onclick = closePanels;
  $('bJournal').onclick = () => { if (openPanel('journalPanel')) renderJournal(); }; $('jClose').onclick = closePanels;
  for (const id of ['mapPanel', 'setPanel', 'journalPanel']) $(id).addEventListener('pointerdown', e => { if (e.target.id === id) closePanels(); });
  $('bigMap').addEventListener('click', e => {
    const r = e.target.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * SIZE - HALF, z = (e.clientY - r.top) / r.height * SIZE - HALF;
    teleport(x, z); closePanels(); const pl = placeAt(P.x, P.z, P.y + BASE); toast(pl.he, pl.en);
  });
  const list = $('placeList');
  const dest = POIS.filter(p => p.kind !== 'peak' || ['Longs Peak', 'Hallett Peak', 'Taylor Peak'].includes(p.en));
  list.innerHTML = '';
  for (const p of dest) {
    const b = document.createElement('button'); b.innerHTML = `${p.he}<span>${p.en}</span>`;
    b.onclick = () => { if (p.kind === 'lake') { const [x, z] = lakeSpot(p.lake); teleport(x, z, p.lake.x, p.lake.z); } else if (p.kind === 'peak') { teleport(p.x + 6, p.z + 6, p.x - 300, p.z - 300); P.pitch = -0.1; } else if (p.kind === 'landmark') teleport(p.x + 28, p.z + 22, p.x, p.z); else teleport(p.x, p.z, p.x - 400, p.z + 300); closePanels(); };
    list.append(b);
  }
  const hl = $('hikeList'); hl.innerHTML = '';
  for (const h of HIKES) { const b = document.createElement('button'); b.innerHTML = `${h.he}<span>${h.en} · ${(TRAILS[h.trail].cum.at(-1) / 1000).toFixed(1)} km</span>`; b.onclick = () => startHike(h); hl.append(b); }
  $('hikeStop').onclick = stopHike;
  for (const b of $('qSeg').children) b.onclick = () => { setQualityUI(b.dataset.q); qualityCb(b.dataset.q); };
  for (const b of $('sSeg').children) b.onclick = () => { setSoundUI(b.dataset.s === '1'); soundCb(b.dataset.s === '1'); };
  for (const b of $('wSeg').children) b.onclick = () => { setWeather(b.dataset.w); for (const c of $('wSeg').children) c.classList.toggle('on', c === b); toast({ clear: 'שמיים בהירים', fair: 'מעונן חלקית', storm: 'סופת אחר-צהריים מתקרבת…' }[b.dataset.w], b.dataset.w === 'storm' ? 'עננים מצטברים מעל הפסגות' : ''); };
  $('hour').addEventListener('input', e => { setTime(+e.target.value); updateHourTxt(); });
  $('fov').addEventListener('input', e => { P.fov = +e.target.value; $('fovTxt').textContent = Math.round(P.fov) + '°'; });
  try { const v = +localStorage.getItem('rmnp-sens'); if (v) { P.sens = v; $('sens').value = v; } } catch (_) {}
  $('sensTxt').textContent = P.sens.toFixed(1) + '×';
  $('sens').addEventListener('input', e => { P.sens = +e.target.value; $('sensTxt').textContent = P.sens.toFixed(1) + '×'; try { localStorage.setItem('rmnp-sens', P.sens); } catch (_) {} });
  for (const b of $('bSeg').children) b.onclick = () => { UIState.battery = b.dataset.b === '1'; for (const c of $('bSeg').children) c.classList.toggle('on', c === b); };
  $('bPhoto').onclick = () => togglePhoto(true); $('photoExit').onclick = () => togglePhoto(false);
  updateHourTxt(); renderJournal();
}
export function setQualityUI(name) { for (const b of $('qSeg').children) b.classList.toggle('on', b.dataset.q === name); }
export function setSoundUI(on) { for (const b of $('sSeg').children) b.classList.toggle('on', (b.dataset.s === '1') === on); }
export function updateHourTxt() { const h = sky_state.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60); $('hourTxt').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; $('hour').value = h; }
export function togglePhoto(on) {
  document.body.classList.toggle('photo', on); closePanels();
  if (on) toast('מצב צילום', isTouch ? 'צלמו מסך כרגיל בטלפון' : 'הממשק מוסתר · Esc או P ליציאה');
}

// ---------------------------------------------------------------- per-frame HUD
let hudT = 0, miniT = 0, lastX = 0, lastZ = 0;
export function updateUI(dt, now) {
  hudT -= dt; miniT -= dt;
  if (Math.abs(P.x - lastX) + Math.abs(P.z - lastZ) > 40) { hudT = miniT = 0; }
  lastX = P.x; lastZ = P.z;
  if (miniT <= 0) { miniT = 0.1; drawMini(); drawCompass(); }
  updateHike(now);
  if (hudT > 0) return; hudT = 0.25;
  const e = P.y + BASE, pl = placeAt(P.x, P.z, e);
  $('placeName').textContent = pl.he;
  $('placeMeta').textContent = `${pl.en} · ${Math.round(e).toLocaleString('he-IL')} מ׳ · ${Math.round(e * 3.28084).toLocaleString('en-US')} ft`;
  const poi = POIS.find(p => Math.hypot(P.x - p.x, P.z - p.z) < p.r * 0.75);
  if (poi && poi !== lastPoi) { lastPoi = poi; if (!J.places.has(poi.id)) { J.places.add(poi.id); saveJ(); } if (!document.body.classList.contains('photo')) showCard(poi); }
  if (!poi) lastPoi = null;
  if (!P.fly) J.maxE = Math.max(J.maxE, Math.round(e));
  checkBadges();
}
