// Things to do: binoculars and wildlife photography, missions, ranger kiosks, flowing time with summer storms.
import * as THREE from 'three';
import { clamp, BASE, TRAILS, CAMP, VISITOR } from './shared.js';
import { $, isTouch, scene, camera, U, hex, heightAt, bus } from './core.js';
import { patchLit, sky_state, setTime, setWeather } from './atmos.js';
import { animals, SPECIES_INFO } from './wildlife.js';
import { P } from './player.js';
import { toast, visited, placeAt, updateHourTxt } from './ui.js';

// ---------------------------------------------------------------- saved progress
const S = { album: [], done: new Set(), flags: {} };
try { const d = JSON.parse(localStorage.getItem('rmnp-activities') || 'null'); if (d) { S.album = d.album || []; (d.done || []).forEach(m => S.done.add(m)); S.flags = d.flags || {}; } } catch (_) {}
const save = () => { try { localStorage.setItem('rmnp-activities', JSON.stringify({ album: S.album.slice(-40), done: [...S.done], flags: S.flags })); } catch (_) {} };

// ---------------------------------------------------------------- missions
const golden = () => { const h = sky_state.hour; return (h > 5.4 && h < 8.6) || (h > 18.2 && h < 20.6); };
export const MISSIONS = [
  { id: 'moose-dawn', he: 'צלמו אייל קורא בזריחה', d: 'בין 5:30 ל-8:30 בבוקר, ליד הנהר במערב העמק' },
  { id: 'sky', he: 'הגיעו לסקיי פונד', d: 'האגם הגבוה בעמק גלסייר גורג׳', check: () => visited('lake:sky') },
  { id: 'marmot', he: 'שמעו שריקת מרמיטה', d: 'מרמיטות שורקות כשמתקרבים אליהן בטונדרה' },
  { id: 'storm', he: 'שרדו סופה מעל קו העצים', d: 'סופת אחר-הצהריים, ברגל, מעל 3,480 מ׳', check: () => U.storm.value > 0.8 && !P.fly && P.y + BASE > 3480 },
  { id: 'sunset', he: 'שקיעה מטרייל רידג׳', d: 'היו על הטונדרה בין 19:00 ל-20:30', check: () => sky_state.hour > 19 && sky_state.hour < 20.6 && P.y + BASE > 3450 && !P.fly },
  { id: 'herd', he: 'צלמו עדר וואפיטי', d: 'שלושה אילים או יותר בתמונה אחת' },
  { id: 'hike', he: 'השלימו מסלול מודרך', d: 'בחרו מסלול במפה ועקבו אחרי המגדלור' },
  { id: 'fire', he: 'לילה ליד המדורה', d: 'שבו ליד המדורה בחניון מוריין פארק אחרי החשכה', check: () => U.night.value > 0.5 && Math.hypot(P.x - CAMP.x, P.z - CAMP.z) < 14 },
];
function complete(id) {
  if (S.done.has(id)) return; S.done.add(id); save();
  const m = MISSIONS.find(m => m.id === id); toast('משימה הושלמה: ' + m.he, `${S.done.size}/${MISSIONS.length} משימות`, 'badge'); renderActivities();
}
bus.on((type, data) => {
  if (type === 'hike') complete('hike');
  if (type === 'sound' && data.kind === 'marmot' && data.dist < 70) complete('marmot');
});

// ---------------------------------------------------------------- binoculars & photography
let bino = false;
export function setBinoculars(on) {
  bino = on; P.zoom = on; document.body.classList.toggle('bino', on);
  $('bBino').classList.toggle('on', on); $('bBino2')?.classList.toggle('on', on);
  if (on) toast('משקפת', isTouch ? 'כוונו אל חיה ולחצו על "צילום"' : 'כוונו אל חיה · Enter או לחיצה על "צילום"');
}
const _v = new THREE.Vector3(), _f = new THREE.Vector3();
function shoot() {
  if (!bino) return;
  const fl = $('flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
  camera.getWorldDirection(_f);
  const inFrame = [];
  for (const a of animals) {
    if (!a.group.visible) continue;
    _v.set(a.x, a.group.position.y + a.h * 0.8 + 0.3, a.z).sub(camera.position);
    const d = _v.length(), ang = Math.acos(clamp(_v.dot(_f) / d, -1, 1)) * 180 / Math.PI;
    if (d < 700 && ang < camera.fov * 0.5) inFrame.push({ a, d, ang });
  }
  if (!inFrame.length) { toast('אין חיה בפריים', 'נסו לכוון את המשקפת אל בעל חיים'); return; }
  inFrame.sort((x, y) => x.ang - y.ang);
  const { a, d, ang } = inFrame[0], size = a.h * 2 / d * 57.3 / camera.fov;
  const rare = { moose: 30, sheep: 30, fox: 35, pika: 30, marmot: 20, elk: 12, deer: 15, chipmunk: 15 }[a.type] || 15;
  let score = rare + Math.round(clamp(size * 120, 0, 35)) + Math.round(clamp(1 - ang / (camera.fov * 0.5), 0, 1) * 20) + (golden() ? 15 : 0) + (a.state === 'flee' ? 8 : 0);
  const sameKind = inFrame.filter(o => o.a.type === a.type).length;
  if (sameKind >= 3) score += 10;
  score = Math.min(100, score);
  const stars = score >= 85 ? 3 : score >= 60 ? 2 : 1;
  const where = placeAt(P.x, P.z, P.y + BASE).he, hh = Math.floor(sky_state.hour), mm = Math.floor((sky_state.hour - hh) * 60);
  S.album.push({ type: a.type, score, stars, d: Math.round(d), where, time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, golden: golden() });
  save();
  toast(`${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  ${SPECIES_INFO[a.type].he} · ${score} נק׳`, `${Math.round(d)} מ׳ · ${where}${golden() ? ' · אור זהוב' : ''}`, stars === 3 ? 'badge' : '');
  if (a.type === 'moose' && sky_state.hour > 5.4 && sky_state.hour < 8.6) complete('moose-dawn');
  if (a.type === 'elk' && sameKind >= 3) complete('herd');
  renderActivities();
}

// ---------------------------------------------------------------- ranger kiosks at trailheads
const kiosks = [];
const TIPS = [
  'עדרי הוואפיטי פעילים בעיקר בבוקר ובערב. שמרו מרחק של לפחות 25 מטר.',
  'סופות רעמים מגיעות כמעט כל אחר-צהריים בקיץ. התחילו לטפס מוקדם ורדו מקו הרכס עד הצהריים.',
  'בגובה מעל 3,000 מ׳ האוויר דליל: שתו הרבה, והאטו אם מרגישים כאב ראש.',
  'אל תאכילו את חיות הבר, גם לא את הצ׳יפמאנקים החמודים.',
  'הטונדרה רגישה מאוד. הישארו על השביל כדי לא לפגוע בצמחים שגדלים עשרות שנים.',
];
function buildKiosks() {
  const m = patchLit(new THREE.MeshLambertMaterial({ color: 0x6a4a30 }), { key: 'kiosk', ao: 0.6 });
  const board = patchLit(new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }), { key: 'kioskboard', ao: 0.6 });
  const spots = [[...TRAILS[0].path[6]], [...TRAILS[4].path[6]], [VISITOR.x + 18, VISITOR.z + 18], [CAMP.x + 20, CAMP.z - 20], [...TRAILS[6].path[6]]];
  spots.forEach(([x, z], i) => {
    const y = heightAt(x + 4, z + 4), g = new THREE.Group();
    for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 0.16), m); post.position.set(s * 0.9, 1.3, 0); g.add(post); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.9), m); roof.position.y = 2.65; roof.rotation.x = 0.15;
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 0.06), board); b.position.y = 1.7;
    g.add(roof, b); g.position.set(x + 4, y, z + 4); g.rotation.y = Math.atan2(-(x + 4 - x), -(z + 4 - z)) + Math.PI;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g);
    kiosks.push({ x: x + 4, z: z + 4, tip: TIPS[i % TIPS.length], shown: -1e9 });
  });
}

// ---------------------------------------------------------------- flowing time & summer weather
const T = { flow: 0, stormRoll: -1 };
export function setTimeFlow(speed) { T.flow = speed; for (const b of $('tSeg').children) b.classList.toggle('on', +b.dataset.t === speed); }

// ---------------------------------------------------------------- journal sections
export function renderActivities() {
  const el = $('jMissions'); if (!el) return;
  el.innerHTML = MISSIONS.map(m => `<div class="badge ${S.done.has(m.id) ? 'yes' : ''}"><b>${m.he}</b><span>${m.d}</span></div>`).join('');
  const best = {}; for (const p of S.album) if (!best[p.type] || p.score > best[p.type].score) best[p.type] = p;
  const items = Object.values(best).sort((a, b) => b.score - a.score);
  $('jAlbum').innerHTML = items.length ? items.map(p => `<div class="jItem yes"><b>${'★'.repeat(p.stars)}${'☆'.repeat(3 - p.stars)} ${SPECIES_INFO[p.type].he}</b><span>${p.score} נק׳ · ${p.d} מ׳ · ${p.where} · ${p.time}</span></div>`).join('') : '<div class="jItem"><b>האלבום ריק</b><span>פתחו את המשקפת וצלמו חיות בר</span></div>';
  $('jMCount').textContent = `${S.done.size}/${MISSIONS.length} משימות · ${S.album.length} תמונות`;
}

export function initActivities() {
  buildKiosks();
  for (const id of ['bBino', 'bBino2']) { const b = $(id); if (b) b.onclick = () => setBinoculars(!bino); }
  $('shutter').onclick = shoot;
  for (const b of $('tSeg').children) b.onclick = () => setTimeFlow(+b.dataset.t);
  addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (e.code === 'KeyB') setBinoculars(!bino); if (e.code === 'Enter') shoot(); });
  renderActivities();
}
let chk = 0;
export function updateActivities(dt) {
  if (T.flow > 0) {
    let h = sky_state.hour + dt / 60 * T.flow; if (h >= 24) h -= 24;
    setTime(h); updateHourTxt();
    // summer pattern: most afternoons build a thunderstorm that clears by evening
    const day = Math.floor(performance.now() / 1000 / (1440 / T.flow));
    if (h > 13.5 && h < 14 && T.stormRoll !== day) { T.stormRoll = day; if (Math.random() < 0.55) { setWeather('storm'); toast('עננים מצטברים מעל הפסגות', 'סופת אחר-הצהריים בדרך'); } }
    if (h > 16.5 && h < 17 && sky_state.weather === 'storm') setWeather('fair');
  }
  if ((chk -= dt) > 0) return; chk = 0.5;
  for (const m of MISSIONS) if (m.check && !S.done.has(m.id) && m.check()) complete(m.id);
  const now = performance.now() / 1000;
  for (const k of kiosks) if (Math.hypot(P.x - k.x, P.z - k.z) < 7 && now - k.shown > 90) {
    k.shown = now; const next = MISSIONS.find(m => !S.done.has(m.id));
    toast('תחנת ריינג׳ר: ' + k.tip, next ? 'משימה מומלצת: ' + next.he : 'כל המשימות הושלמו!');
  }
}
