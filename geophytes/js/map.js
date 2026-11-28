// מפת תצפיות מינימלית: רקע מצויר או לוויין (תמונות מוכנות מראש), נקודות תצפית, איגוד נקודות בזום רחוק,
// "אזור כללי" לתצפיות שמיקומן הוסתר להגנה על מין נדיר, הגדלה/הקטנה/גרירה, ותוויות מקומות בעברית.
import { MAPMETA } from './mapmeta.js';

const Z = 11; // מערכת הקואורדינטות הפנימית: פיקסלים בזום 11
const WORLD = 256 * 2 ** Z;
const MIN_ZOOM = 7.3, MAX_ZOOM = 13.4; // רזולוציית רקע מקורית עד זום 12 – מעבר לכך הרקע רק מוגדל, לכן לא מתקרבים יותר
const SRC_NAME = { i: 'iNaturalist', h: 'דוגמה באוסף (הרבריום / מוזיאון)', o: 'מאגר תצפיות', c: 'תמונה עם מיקום (ויקישיתוף)', u: 'דיווח לא מאומת מרשת חברתית (המיקום משוער)', x: 'אזור כללי – המיקום המדויק הוסתר להגנה על המין' };
const ACCENT = '#e5266f';

const PLACES = [
  ['הים התיכון', 34.3, 32.5, 7.3, 'sea'], ['החרמון', 35.78, 33.40, 8, 'big'], ['רמת הגולן', 35.80, 32.98, 8, 'big'],
  ['הגליל', 35.32, 32.95, 8, 'big'], ['כנרת', 35.59, 32.82, 9, ''], ['חיפה', 34.99, 32.80, 9, ''], ['הכרמל', 35.05, 32.69, 9.6, ''],
  ['עמק יזרעאל', 35.28, 32.57, 9.4, ''], ['שומרון', 35.22, 32.28, 9.2, ''], ['תל אביב', 34.78, 32.08, 9, ''], ['ירושלים', 35.21, 31.77, 9, ''],
  ['הרי יהודה', 35.03, 31.55, 9.4, ''], ['ים המלח', 35.47, 31.30, 8.4, ''], ['באר שבע', 34.79, 31.25, 9, ''], ['הנגב', 34.85, 30.85, 8, 'big'],
  ['מכתש רמון', 34.80, 30.60, 9.4, ''], ['הערבה', 35.16, 30.30, 8.6, ''], ['אילת', 34.95, 29.56, 9, ''],
];

const toPx = (lon, lat) => [
  ((lon + 180) / 360) * WORLD,
  ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * WORLD,
];

let occPromise = null;
export function loadOccurrences() {
  if (!occPromise) occPromise = fetch('data/occ.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return occPromise;
}

let placesPromise = null;
/** יישובים אמיתיים: [שם, lon, lat, דרגה 1-3] */
export function loadPlaces() {
  if (!placesPromise) placesPromise = fetch('data/places.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return placesPromise;
}
const HE_MONTHS = ['בינואר', 'בפברואר', 'במרץ', 'באפריל', 'במאי', 'ביוני', 'ביולי', 'באוגוסט', 'בספטמבר', 'באוקטובר', 'בנובמבר', 'בדצמבר'];
const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
/** תאריך תצפית מלא בעברית: "יום ג׳, 15 במרץ 2022" (או חודש ושנה / שנה בלבד כשחסר מידע) */
function fmtDate(d, year) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(d || '');
  if (m && m[3]) {
    const dt = new Date(+m[1], +m[2] - 1, +m[3]);
    return `<b>יום ${HE_DAYS[dt.getDay()]}, ${+m[3]} ${HE_MONTHS[+m[2] - 1]} ${m[1]}</b>`;
  }
  if (m) return `<b>${HE_MONTHS[+m[2] - 1].slice(1)} ${m[1]}</b><span class="muted">היום המדויק לא ידוע</span>`;
  return year ? `<b>שנת ${year}</b><span class="muted">התאריך המדויק לא ידוע</span>` : '<b>תאריך לא ידוע</b>';
}
const DIRS = ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח', 'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב'];

const imgCache = new Map();
function loadImg(src, onLoad) {
  let e = imgCache.get(src);
  if (!e) {
    const img = new Image();
    e = { img, ready: false, cbs: [] };
    img.onload = () => { e.ready = true; e.cbs.forEach((f) => f()); };
    img.src = src;
    imgCache.set(src, e);
  }
  if (!e.ready) e.cbs.push(onLoad);
  return e;
}

const ICON = {
  full: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  locate: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/></svg>',
  fit: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3.5" stroke-dasharray="3.2 3.2"/><circle cx="9.5" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.5" cy="9" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none"/></svg>',
};

/** points = [[lat, lon, year, uncertaintyMeters, src], ...]; mine = [[lat, lon, label], ...] */
export function createMap(root, { points = [], mine = [], emptyText = '' }) {
  root.innerHTML = `
    <canvas class="mapcv" aria-label="מפת תצפיות"></canvas>
    <button type="button" class="mapbtn mapfull" data-act="full" aria-label="מסך מלא">${ICON.full}</button>
    <div class="maplayers" role="group" aria-label="סוג מפה">
      <button type="button" data-layer="ter" class="on">מפה</button><button type="button" data-layer="sat">לוויין</button>
    </div>
    <div class="mapzoom">
      <button type="button" class="mapbtn" data-act="in" aria-label="הגדלה">+</button>
      <button type="button" class="mapbtn" data-act="out" aria-label="הקטנה">−</button>
      <button type="button" class="mapbtn" data-act="fit" aria-label="הצג את כל הנקודות">${ICON.fit}</button>
      <button type="button" class="mapbtn maploc" data-act="locate" aria-label="המיקום שלי">${ICON.locate}</button>
    </div>
    <div class="mapcount"></div>
    <div class="mapempty" hidden></div>
    <div class="mappop" hidden></div>
    <div class="maptoast" hidden></div>
    <div class="mapattr">© EOX (Sentinel-2) · OSM · GBIF · iNaturalist · Wikipedia</div>`;
  const cv = root.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const pop = root.querySelector('.mappop');
  const fullBtn = root.querySelector('[data-act="full"]');

  const exact = [], general = [];
  for (const p of points) (p[4] === 'x' ? general : exact).push({ p, xy: toPx(p[1], p[0]) });
  const own = mine.map((p) => ({ p, xy: toPx(p[1], p[0]) }));
  const places = PLACES.map(([t, lon, lat, z, k]) => ({ t, xy: toPx(lon, lat), z, k }));
  let towns = [];
  loadPlaces().then((list) => { towns = list.map(([t, lon, lat, tier]) => ({ t, lon, lat, tier, xy: toPx(lon, lat) })); draw(); });
  // היישוב הקרוב ביותר לנקודה – כדי לדעת באמת איפה התצפית
  const nearest = (lat, lon) => {
    let best = null, bd = Infinity;
    const kx = Math.cos((lat * Math.PI) / 180);
    for (const t of towns) { const dx = (t.lon - lon) * kx, dy = t.lat - lat, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = t; } }
    if (!best) return '';
    const km = Math.sqrt(bd) * 111.2;
    if (km < 0.6) return `<span class="near">📍 בתוך / ליד <b>${best.t}</b></span>`;
    const ang = (Math.atan2((lon - best.lon) * kx, lat - best.lat) * 180) / Math.PI;
    return `<span class="near">📍 כ-${km < 10 ? km.toFixed(1) : Math.round(km)} ק"מ ${DIRS[Math.round(((ang + 360) % 360) / 45) % 8]}ית ל<b>${best.t}</b></span>`;
  };
  // --- המיקום שלי (שידור חי) ---
  let me = null, watchId = null, following = false, pulse = 0, pulseTimer = 0, toastT = 0;
  const locBtn = root.querySelector('[data-act="locate"]');
  const toastEl = root.querySelector('.maptoast');
  const toast = (msg, ms = 3200) => { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); if (ms) toastT = setTimeout(() => { toastEl.hidden = true; }, ms); };
  const distMe = (lat, lon) => {
    if (!me) return '';
    const kx = Math.cos((lat * Math.PI) / 180), km = Math.hypot((lon - me.lon) * kx, lat - me.lat) * 111.2;
    return `<span class="near">🧭 ${km < 1 ? `כ-${Math.round(km * 100) * 10} מ'` : `כ-${km < 10 ? km.toFixed(1) : Math.round(km)} ק"מ`} ממני</span>`;
  };
  function setLocUi() {
    locBtn.classList.toggle('on', watchId != null);
    locBtn.classList.toggle('follow', watchId != null && following);
    locBtn.setAttribute('aria-pressed', String(watchId != null));
  }
  function onPos(pos) {
    const c = pos.coords, first = !me;
    me = { lat: c.latitude, lon: c.longitude, acc: c.accuracy || 0, heading: Number.isFinite(c.heading) ? c.heading : null, speed: c.speed || 0, xy: toPx(c.longitude, c.latitude) };
    if (!pulseTimer) pulseTimer = setInterval(() => { pulse = (pulse + 0.045) % 1; draw(); }, 50);
    if (first) {
      const inside = me.lat > 29.3 && me.lat < 33.6 && me.lon > 34.0 && me.lon < 36.1;
      if (!inside) toast('המיקום שלך מחוץ לישראל, ולכן הוא לא נראה על המפה', 5000); else toast(`נמצא · דיוק ±${Math.round(me.acc)} מ'`, 2200);
    }
    if (following) {
      view.x = me.xy[0]; view.y = me.xy[1];
      if (first) view.zoom = Math.max(view.zoom, Math.min(12.4, me.acc > 400 ? 11 : 12.4));
      pop.hidden = true; picked = null;
    }
    draw();
  }
  function onGeoErr(err) {
    const msgs = { 1: 'אין הרשאת מיקום. אשרו גישה למיקום בדפדפן ונסו שוב', 2: 'לא הצלחתי לאתר את המיקום כרגע', 3: 'איתור המיקום לוקח יותר מדי זמן. נסו שוב בשטח פתוח' };
    toast(msgs[err.code] || 'שגיאה באיתור המיקום', 5000);
    if (err.code === 1) stopLocate();
  }
  function stopLocate() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null; following = false; me = null; clearInterval(pulseTimer); pulseTimer = 0;
    pop.hidden = true; setLocUi(); draw();
  }
  function startLocate() {
    if (!('geolocation' in navigator)) { toast('המכשיר או הדפדפן לא תומכים באיתור מיקום'); return; }
    if (watchId == null) {
      following = true; toast('מאתר את המיקום…', 0); setLocUi();
      try { watchId = navigator.geolocation.watchPosition(onPos, onGeoErr, { enableHighAccuracy: true, maximumAge: 1500, timeout: 25000 }); }
      catch { toast('איתור המיקום חסום בדפדפן הזה'); watchId = null; following = false; setLocUi(); }
      setLocUi();
    } else if (!following && me) { // חזרה למעקב אחרי שגררתי את המפה
      following = true; view.x = me.xy[0]; view.y = me.xy[1]; view.zoom = Math.max(view.zoom, 12); setLocUi(); draw();
    } else { stopLocate(); toast('מעקב המיקום הופסק', 1800); }
  }
  locBtn.onclick = startLocate;

  let layer = 'ter';
  const view = { x: 0, y: 0, zoom: 8 };
  let W = 0, H = 0, dpr = 1, raf = 0, hits = [], picked = null;

  const draw = () => { if (!raf) raf = requestAnimationFrame(render); };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    W = root.clientWidth; H = root.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    draw();
  }

  function fit(items) {
    const list = items.length ? items : [{ xy: toPx(35.0, 31.4) }, { xy: toPx(34.7, 29.6) }, { xy: toPx(35.75, 33.3) }];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { xy } of list) { x0 = Math.min(x0, xy[0]); x1 = Math.max(x1, xy[0]); y0 = Math.min(y0, xy[1]); y1 = Math.max(y1, xy[1]); }
    // תצפיות בודדות רחוקות לא יגרמו להתרחקות קיצונית: משתמשים בגבולות 3%–97%
    if (list.length > 40) {
      const xs = list.map((i) => i.xy[0]).sort((a, b) => a - b), ys = list.map((i) => i.xy[1]).sort((a, b) => a - b);
      const q = (a, f) => a[Math.floor((a.length - 1) * f)];
      x0 = q(xs, 0.02); x1 = q(xs, 0.98); y0 = q(ys, 0.02); y1 = q(ys, 0.98);
    }
    const w = Math.max(x1 - x0, 700), h = Math.max(y1 - y0, 700);
    view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
    const s = Math.min((W - 80) / w, (H - 110) / h);
    view.zoom = Math.max(MIN_ZOOM, Math.min(10.6, Z + Math.log2(s)));
    pop.hidden = true; picked = null;
    draw();
  }

  const levelsFor = (z) => {
    const set = MAPMETA.levels[layer];
    const out = ['9'];
    if (z >= 9.7) out.push('10');
    if (z >= 10.7) out.push('11');
    if (z >= 11.6 && set['12']) out.push('12');
    return out.map((l) => [Number(l), set[l]]);
  };

  function halo(text, x, y, fill, stroke, font, align = 'center') {
    ctx.font = font; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = stroke; ctx.strokeText(text, x, y);
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }

  function render() {
    raf = 0;
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sat = layer === 'sat';
    ctx.fillStyle = sat ? '#0d2238' : '#a0c4de';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const s = 2 ** (view.zoom - Z);
    for (const [lvl, meta] of levelsFor(view.zoom)) {
      const f = 2 ** (Z - lvl);
      for (const file of meta.files) {
        const e = loadImg(file.file, draw);
        if (!e.ready) continue;
        const dx = (meta.x0 * 256 * f - view.x) * s + W / 2, dy = (file.y * 256 * f - view.y) * s + H / 2;
        const dw = e.img.width * f * s, dh = e.img.height * f * s;
        if (dx > W || dy > H || dx + dw < 0 || dy + dh < 0) continue;
        ctx.drawImage(e.img, dx, dy, dw + 0.6, dh + 0.6);
      }
    }
    // תוויות מקומות
    const lblFill = sat ? '#fff' : '#3b3a33', lblStroke = sat ? 'rgba(10,25,40,.8)' : 'rgba(255,255,255,.85)';
    for (const pl of places) {
      if (view.zoom < pl.z || view.zoom > pl.z + 4.2) continue;
      const x = (pl.xy[0] - view.x) * s + W / 2, y = (pl.xy[1] - view.y) * s + H / 2;
      if (x < 20 || y < 20 || x > W - 20 || y > H - 20) continue;
      halo(pl.t, x, y, pl.k === 'sea' ? (sat ? '#9fc6e8' : '#4a7da6') : lblFill, lblStroke, `${pl.k === 'big' ? '700 13px' : pl.k === 'sea' ? 'italic 600 13px' : '600 11.5px'} Heebo, sans-serif`);
    }
    // יישובים (ערים, עיירות, קיבוצים, מושבים, כפרים) – עם מניעת חפיפה בין תוויות
    {
      const minZ = [0, 8.2, 9.2, 10.1];
      const boxes = [];
      ctx.font = '600 11px Heebo, sans-serif';
      for (const t of towns) {
        if (view.zoom < minZ[t.tier]) continue;
        const x = (t.xy[0] - view.x) * s + W / 2, y = (t.xy[1] - view.y) * s + H / 2;
        if (x < 24 || y < 24 || x > W - 24 || y > H - 24) continue;
        const big = t.tier === 1;
        const w = ctx.measureText(t.t).width * (big ? 1.12 : 1) + 6, h = big ? 15 : 13, by = y - 9;
        if (boxes.some((b) => Math.abs(b[0] - x) < (b[2] + w) / 2 && Math.abs(b[1] - by) < (b[3] + h) / 2)) continue;
        boxes.push([x, by, w, h]);
        ctx.beginPath(); ctx.arc(x, y, big ? 2.8 : 2, 0, 6.2832);
        ctx.fillStyle = sat ? '#fff' : '#3b3a33'; ctx.fill();
        halo(t.t, x, by, sat ? '#fff' : '#2f2e28', lblStroke, `${big ? '700 12.5px' : '500 11px'} Heebo, sans-serif`);
      }
    }
    hits = [];
    // אזור כללי (מיקום מוסתר להגנה על המין): עיגול מקווקו קטן וחלול – מראה פיזור כללי בלי להעמיד פנים של מיקום מדויק
    const mPerPx = (156543.03 * Math.cos((31.5 * Math.PI) / 180)) / 2 ** view.zoom;
    ctx.setLineDash([3, 3]); ctx.lineWidth = 1.6;
    for (const { p, xy } of general) {
      const x = (xy[0] - view.x) * s + W / 2, y = (xy[1] - view.y) * s + H / 2;
      if (x < -12 || y < -12 || x > W + 12 || y > H + 12) continue;
      ctx.beginPath(); ctx.arc(x, y, view.zoom < 9.5 ? 3.6 : 6, 0, 6.2832);
      ctx.strokeStyle = sat ? 'rgba(255,255,255,.8)' : `rgba(229,38,111,${view.zoom < 9.5 ? 0.55 : 0.9})`; ctx.stroke();
      hits.push({ x, y, r: 12, p, kind: 'x' });
    }
    ctx.setLineDash([]);
    // נקודות מדויקות – בזום רחוק מאוגדות
    const dot = Math.max(3.2, Math.min(8.5, 2.4 + (view.zoom - 7) * 0.8));
    if (view.zoom < 10.2) {
      const g = view.zoom < 8.6 ? 44 : 36, cells = new Map();
      for (const it of exact) {
        const x = (it.xy[0] - view.x) * s + W / 2, y = (it.xy[1] - view.y) * s + H / 2;
        if (x < -30 || y < -30 || x > W + 30 || y > H + 30) continue;
        const k = `${Math.floor(x / g)}_${Math.floor(y / g)}`;
        const c = cells.get(k);
        if (c) { c.n++; c.sx += x; c.sy += y; } else cells.set(k, { n: 1, sx: x, sy: y, it });
      }
      for (const c of cells.values()) {
        const x = c.sx / c.n, y = c.sy / c.n;
        if (c.n === 1) { drawDot(x, y, dot, c.it.p); hits.push({ x, y, r: dot + 6, p: c.it.p, kind: 'pt' }); continue; }
        const r = Math.min(24, 9 + Math.sqrt(c.n) * 2.1);
        ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 6.2832); ctx.fillStyle = 'rgba(229,38,111,.22)'; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fillStyle = ACCENT; ctx.fill();
        ctx.lineWidth = 1.8; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.font = '700 11px Heebo, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        ctx.fillText(c.n >= 1000 ? `${(c.n / 1000).toFixed(1)}k` : String(c.n), x, y + 0.5);
        hits.push({ x, y, r: r + 4, kind: 'cluster' });
      }
    } else {
      for (const it of exact) {
        const x = (it.xy[0] - view.x) * s + W / 2, y = (it.xy[1] - view.y) * s + H / 2;
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
        const unc = (it.p[3] || 0) / mPerPx;
        if (unc > dot * 2 && unc < 300) { // טווח אי-הדיוק של המיקום
          ctx.beginPath(); ctx.arc(x, y, unc, 0, 6.2832); ctx.fillStyle = 'rgba(229,38,111,.10)'; ctx.fill();
          ctx.strokeStyle = 'rgba(229,38,111,.4)'; ctx.lineWidth = 1; ctx.stroke();
        }
        drawDot(x, y, dot, it.p);
        hits.push({ x, y, r: dot + 7, p: it.p, kind: 'pt' });
      }
    }
    for (const { p, xy } of own) {
      const x = (xy[0] - view.x) * s + W / 2, y = (xy[1] - view.y) * s + H / 2;
      ctx.beginPath(); ctx.arc(x, y, dot + 2.5, 0, 6.2832); ctx.fillStyle = '#16a34a'; ctx.fill();
      ctx.lineWidth = 2.2; ctx.strokeStyle = '#fff'; ctx.stroke();
      hits.push({ x, y, r: dot + 8, p, kind: 'own' });
    }
    if (me) { // המיקום שלי – נקודה כחולה עם טווח דיוק ופעימה
      const x = (me.xy[0] - view.x) * s + W / 2, y = (me.xy[1] - view.y) * s + H / 2;
      if (x > -60 && y > -60 && x < W + 60 && y < H + 60) {
        const ar = me.acc / mPerPx;
        if (ar > 10) { ctx.beginPath(); ctx.arc(x, y, ar, 0, 6.2832); ctx.fillStyle = 'rgba(37,99,235,.13)'; ctx.fill(); ctx.strokeStyle = 'rgba(37,99,235,.35)'; ctx.lineWidth = 1; ctx.stroke(); }
        if (me.heading != null && me.speed > 0.6) { // כיוון תנועה
          const a = (me.heading * Math.PI) / 180 - Math.PI / 2;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, 26, a - 0.5, a + 0.5); ctx.closePath();
          const g = ctx.createRadialGradient(x, y, 4, x, y, 26); g.addColorStop(0, 'rgba(37,99,235,.55)'); g.addColorStop(1, 'rgba(37,99,235,0)'); ctx.fillStyle = g; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(x, y, 9 + pulse * 13, 0, 6.2832); ctx.strokeStyle = `rgba(37,99,235,${0.45 * (1 - pulse)})`; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 8, 0, 6.2832); ctx.fillStyle = '#2563eb'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
        hits.push({ x, y, r: 16, kind: 'me', p: me });
      }
    }
    if (picked) { // הדגשת הנקודה שנבחרה
      const h = hits.find((q) => q.p === picked);
      if (h) { ctx.beginPath(); ctx.arc(h.x, h.y, dot + 5, 0, 6.2832); ctx.lineWidth = 2.2; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    }
    // סרגל קנה מידה עדין
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    const dist = nice.find((n) => n >= mPerPx * 80) || 100000, len = dist / mPerPx;
    const sc = sat ? '#fff' : '#33322c';
    ctx.fillStyle = sc; ctx.fillRect(64, H - 24, len, 2); ctx.fillRect(64, H - 28, 2, 6); ctx.fillRect(64 + len - 2, H - 28, 2, 6);
    halo(dist >= 1000 ? `${dist / 1000} ק"מ` : `${dist} מ'`, 64, H - 34, sc, sat ? 'rgba(10,25,40,.8)' : 'rgba(255,255,255,.85)', '600 10.5px Heebo, sans-serif', 'left');
  }

  function drawDot(x, y, r, p) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832);
    ctx.fillStyle = p[4] === 'h' ? '#f59e0b' : p[4] === 'u' ? '#7c5cff' : ACCENT; ctx.fill();
    ctx.lineWidth = 1.7; ctx.strokeStyle = '#fff'; ctx.stroke();
  }

  function zoomAt(factor, sx, sy) {
    const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom + Math.log2(factor)));
    if (nz === view.zoom) return;
    const s0 = 2 ** (view.zoom - Z), s1 = 2 ** (nz - Z);
    const wx = (sx - W / 2) / s0 + view.x, wy = (sy - H / 2) / s0 + view.y;
    view.x = wx - (sx - W / 2) / s1; view.y = wy - (sy - H / 2) / s1;
    view.zoom = nz;
    pop.hidden = true; picked = null;
    draw();
  }

  // --- אינטראקציה ---
  const ptr = new Map();
  let moved = 0, startPinch = 0;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    ptr.set(e.pointerId, [e.offsetX, e.offsetY]);
    moved = 0;
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; startPinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!ptr.has(e.pointerId)) return;
    const prev = ptr.get(e.pointerId);
    ptr.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (ptr.size === 2) {
      const [a, b] = [...ptr.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (startPinch) zoomAt(d / startPinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      startPinch = d; moved = 99;
      return;
    }
    const dx = e.offsetX - prev[0], dy = e.offsetY - prev[1];
    moved += Math.abs(dx) + Math.abs(dy);
    const s = 2 ** (view.zoom - Z);
    view.x -= dx / s; view.y -= dy / s;
    if (moved > 4) { pop.hidden = true; picked = null; if (following) { following = false; setLocUi(); } }
    draw();
  });
  cv.addEventListener('pointerup', (e) => {
    const wasTap = ptr.size === 1 && moved < 6;
    ptr.delete(e.pointerId); startPinch = 0;
    if (wasTap) tap(e.offsetX, e.offsetY);
  });
  cv.addEventListener('pointercancel', (e) => { ptr.delete(e.pointerId); startPinch = 0; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.35 : 1 / 1.35, e.offsetX, e.offsetY); }, { passive: false });
  cv.addEventListener('dblclick', (e) => zoomAt(2, e.offsetX, e.offsetY));

  function tap(sx, sy) {
    let best = null, bd = Infinity;
    for (const h of hits) {
      const d = Math.hypot(h.x - sx, h.y - sy);
      const reach = Math.max(h.r, 14);
      const score = h.kind === 'x' ? d + 100 : d; // נקודה מדויקת עדיפה על אזור כללי
      if (d <= reach && score < bd) { bd = score; best = h; }
    }
    if (!best) { pop.hidden = true; picked = null; draw(); return; }
    if (best.kind === 'cluster') { zoomAt(2.6, best.x, best.y); return; }
    if (best.kind === 'me') {
      pop.innerHTML = `<b>המיקום שלי</b><span class="muted">שידור חי · דיוק ±${Math.round(me.acc)} מ'</span>${nearest(me.lat, me.lon)}<span class="mono">${me.lat.toFixed(5)}, ${me.lon.toFixed(5)}</span>`;
      pop.hidden = false; const pw = 232;
      pop.style.left = `${Math.max(8, Math.min(W - pw - 8, best.x - pw / 2))}px`; pop.style.top = `${best.y > 150 ? best.y - 124 : best.y + 18}px`;
      return;
    }
    picked = best.p;
    const p = best.p;
    const lat = p[0].toFixed(4), lon = p[1].toFixed(4);
    pop.innerHTML = best.kind === 'own'
      ? `<b>התצפית שלי</b><span>${p[2] || ''}</span>${nearest(p[0], p[1])}${distMe(p[0], p[1])}<span class="mono">${lat}, ${lon}</span>`
      : `${fmtDate(p[5], p[2])}<span>${SRC_NAME[p[4]] || ''}</span>${nearest(p[0], p[1])}${distMe(p[0], p[1])}${p[4] !== 'x' ? `<span>${p[3] ? `דיוק המיקום: כ-${p[3]} מ'` : 'דיוק המיקום לא צוין'}</span><span class="mono">${lat}, ${lon}</span>` : ''}`;
    pop.hidden = false;
    const pw = 232;
    pop.style.left = `${Math.max(8, Math.min(W - pw - 8, best.x - pw / 2))}px`;
    pop.style.top = `${best.y > 150 ? best.y - 124 : best.y + 18}px`;
    draw();
  }

  root.querySelectorAll('[data-layer]').forEach((b) => {
    b.onclick = () => {
      layer = b.dataset.layer;
      root.querySelectorAll('[data-layer]').forEach((x) => x.classList.toggle('on', x === b));
      root.classList.toggle('sat', layer === 'sat');
      draw();
    };
  });
  root.querySelector('[data-act="in"]').onclick = () => zoomAt(1.7, W / 2, H / 2);
  root.querySelector('[data-act="out"]').onclick = () => zoomAt(1 / 1.7, W / 2, H / 2);
  root.querySelector('[data-act="fit"]').onclick = () => fit(exact.length ? exact : own);
  fullBtn.onclick = () => {
    const full = root.classList.toggle('full');
    document.body.classList.toggle('mapfull', full);
    fullBtn.innerHTML = full ? ICON.close : ICON.full;
    resize();
  };

  const nExact = exact.length, nGen = general.length;
  root.querySelector('.mapcount').textContent = nExact + nGen
    ? `${nExact.toLocaleString('he-IL')} תצפיות${nGen ? ` · ${nGen.toLocaleString('he-IL')} באזור כללי` : ''}`
    : '';
  const empty = root.querySelector('.mapempty');
  if (!nExact && !nGen && !own.length) { empty.textContent = emptyText || 'עדיין אין תצפיות ידועות של המין במאגרים הציבוריים'; empty.hidden = false; }

  const ro = new ResizeObserver(() => { const first = !W; resize(); if (first) fit(exact.length ? exact : own); });
  ro.observe(root);
  setTimeout(() => { for (const l of ['ter', 'sat']) for (const lv of ['9', '10']) for (const f of MAPMETA.levels[l][lv].files) loadImg(f.file, draw); }, 600);
  return { destroy() { ro.disconnect(); if (watchId != null) navigator.geolocation.clearWatch(watchId); clearInterval(pulseTimer); document.body.classList.remove('mapfull'); } };
}
