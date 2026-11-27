// מפת תצפיות: רקע לוויין או מצויר (תמונות מוכנות מראש), נקודות של תצפיות המין, הגדלה/הקטנה/גרירה.
import { MAPMETA } from './mapmeta.js';

const Z = 11; // מערכת הקואורדינטות הפנימית: פיקסלים בזום 11
const WORLD = 256 * 2 ** Z;
const MIN_ZOOM = 7.4, MAX_ZOOM = 15.5;
const SRC_NAME = { i: 'iNaturalist (תצפית שדה)', h: 'דוגמה באוסף (הרבריום/מוזיאון)', o: 'תצפית ממאגר אחר' };

const toPx = (lon, lat) => [
  ((lon + 180) / 360) * WORLD,
  ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * WORLD,
];

let occPromise = null;
export function loadOccurrences() {
  if (!occPromise) occPromise = fetch('data/occ.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return occPromise;
}

const imgCache = new Map();
function loadImg(src, onLoad) {
  let e = imgCache.get(src);
  if (!e) {
    const img = new Image();
    e = { img, ready: false };
    img.onload = () => { e.ready = true; onLoad(); };
    img.src = src;
    imgCache.set(src, e);
  } else if (!e.ready) {
    const prev = e.img.onload;
    e.img.onload = () => { e.ready = true; prev?.(); onLoad(); };
  }
  return e;
}

/** יוצר מפה בתוך אלמנט. points = [[lat, lon, year, uncertainty, source], ...]; mine = [[lat, lon, label], ...] */
export function createMap(root, { points = [], mine = [], emptyText = '' }) {
  root.innerHTML = `
    <canvas class="mapcv" aria-label="מפת תצפיות"></canvas>
    <div class="mapui top">
      <div class="seg maplayers" role="group" aria-label="סוג מפה">
        <button type="button" data-layer="ter" class="on">מצוירת</button>
        <button type="button" data-layer="sat">לוויין</button>
      </div>
      <button type="button" class="mapbtn" data-act="full" aria-label="מסך מלא">⤢</button>
    </div>
    <div class="mapui zoom">
      <button type="button" class="mapbtn" data-act="in" aria-label="הגדלה">+</button>
      <button type="button" class="mapbtn" data-act="out" aria-label="הקטנה">−</button>
      <button type="button" class="mapbtn" data-act="fit" aria-label="הצג את כל הנקודות">◎</button>
    </div>
    <div class="mapcount"></div>
    <div class="mappop" hidden></div>
    <div class="mapattr">לוויין: Sentinel-2 cloudless © EOX · מפה: EOX, OpenStreetMap · תצפיות: GBIF</div>`;
  const cv = root.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const pop = root.querySelector('.mappop');
  const countEl = root.querySelector('.mapcount');

  const pts = points.map((p) => ({ p, xy: toPx(p[1], p[0]) }));
  const own = mine.map((p) => ({ p, xy: toPx(p[1], p[0]) }));
  let layer = 'ter';
  const view = { x: 0, y: 0, zoom: 8 };
  let W = 0, H = 0, dpr = 1, raf = 0;

  const draw = () => { if (!raf) raf = requestAnimationFrame(render); };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    W = root.clientWidth; H = root.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    draw();
  }

  function fit(items) {
    const list = items.length ? items : [{ xy: toPx(35.0, 31.4) }, { xy: toPx(34.5, 29.6) }, { xy: toPx(35.9, 33.4) }];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { xy } of list) { x0 = Math.min(x0, xy[0]); x1 = Math.max(x1, xy[0]); y0 = Math.min(y0, xy[1]); y1 = Math.max(y1, xy[1]); }
    const w = Math.max(x1 - x0, 400), h = Math.max(y1 - y0, 400);
    view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
    const s = Math.min((W - 60) / w, (H - 90) / h);
    view.zoom = Math.max(MIN_ZOOM, Math.min(13.5, Z + Math.log2(s)));
    draw();
  }

  function levelsFor(z) {
    const set = MAPMETA.levels[layer];
    const out = [9];
    if (z >= 9.7) out.push(10);
    if (z >= 10.7) out.push(11);
    return out.map((l) => [l, set[String(l)]]);
  }

  function render() {
    raf = 0;
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = layer === 'sat' ? '#0d2238' : '#a0c4de';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const s = 2 ** (view.zoom - Z);
    for (const [lvl, meta] of levelsFor(view.zoom)) {
      const f = 2 ** (Z - lvl);
      for (const file of meta.files) {
        const e = loadImg(file.file, draw);
        if (!e.ready) continue;
        const X0 = meta.x0 * 256 * f, Y0 = file.y * 256 * f;
        const dx = (X0 - view.x) * s + W / 2, dy = (Y0 - view.y) * s + H / 2;
        const dw = e.img.width * f * s, dh = e.img.height * f * s;
        if (dx > W || dy > H || dx + dw < 0 || dy + dh < 0) continue;
        ctx.drawImage(e.img, dx, dy, dw + 0.5, dh + 0.5);
      }
    }
    // אזור שאין לו כיסוי – קו מסגרת עדין
    const r = Math.max(3.2, Math.min(9, 2.2 + (view.zoom - 7) * 0.75));
    const mPerPx = (156543.03 * Math.cos((31.5 * Math.PI) / 180)) / 2 ** view.zoom;
    ctx.lineWidth = 1.6;
    for (const { p, xy } of pts) {
      const x = (xy[0] - view.x) * s + W / 2, y = (xy[1] - view.y) * s + H / 2;
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      const unc = p[3] / mPerPx;
      if (unc > r * 2 && unc < 400) {
        ctx.beginPath(); ctx.arc(x, y, unc, 0, 6.2832);
        ctx.fillStyle = 'rgba(255,45,135,.10)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,45,135,.45)'; ctx.lineWidth = 1; ctx.stroke(); ctx.lineWidth = 1.6;
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832);
      ctx.fillStyle = p[4] === 'h' ? '#ffb020' : '#ff2d87';
      ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    for (const { xy } of own) {
      const x = (xy[0] - view.x) * s + W / 2, y = (xy[1] - view.y) * s + H / 2;
      ctx.beginPath(); ctx.arc(x, y, r + 2, 0, 6.2832);
      ctx.fillStyle = '#22c55e'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.lineWidth = 1.6;
    // סרגל קנה מידה
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    const target = mPerPx * 90;
    const dist = nice.find((n) => n >= target) || 100000;
    const len = dist / mPerPx;
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(10, H - 54, len + 16, 22);
    ctx.fillStyle = '#222'; ctx.fillRect(18, H - 40, len, 2); ctx.fillRect(18, H - 44, 2, 6); ctx.fillRect(18 + len - 2, H - 44, 2, 6);
    ctx.font = '11px Heebo, sans-serif'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(dist >= 1000 ? `${dist / 1000} ק"מ` : `${dist} מ'`, 20, H - 44);
  }

  function zoomAt(factor, sx, sy) {
    const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom + Math.log2(factor)));
    if (nz === view.zoom) return;
    const s0 = 2 ** (view.zoom - Z), s1 = 2 ** (nz - Z);
    const wx = (sx - W / 2) / s0 + view.x, wy = (sy - H / 2) / s0 + view.y;
    view.x = wx - (sx - W / 2) / s1; view.y = wy - (sy - H / 2) / s1;
    view.zoom = nz;
    pop.hidden = true;
    draw();
  }

  // --- אינטראקציה ---
  const ptr = new Map();
  let moved = 0, startPinch = 0, down = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    ptr.set(e.pointerId, [e.offsetX, e.offsetY]);
    moved = 0; down = [e.offsetX, e.offsetY];
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
    if (moved > 4) pop.hidden = true;
    draw();
  });
  const up = (e) => {
    const wasTap = ptr.size === 1 && moved < 6 && down;
    ptr.delete(e.pointerId); startPinch = 0;
    if (wasTap) tap(e.offsetX, e.offsetY);
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', (e) => { ptr.delete(e.pointerId); startPinch = 0; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.35 : 1 / 1.35, e.offsetX, e.offsetY); }, { passive: false });
  cv.addEventListener('dblclick', (e) => zoomAt(2, e.offsetX, e.offsetY));

  function tap(sx, sy) {
    const s = 2 ** (view.zoom - Z);
    let best = null, bd = 18;
    for (const it of [...own, ...pts]) {
      const x = (it.xy[0] - view.x) * s + W / 2, y = (it.xy[1] - view.y) * s + H / 2;
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) { bd = d; best = { it, x, y }; }
    }
    if (!best) { pop.hidden = true; return; }
    const p = best.it.p;
    const isOwn = own.includes(best.it);
    const lat = p[0].toFixed(4), lon = p[1].toFixed(4);
    pop.innerHTML = isOwn
      ? `<b>התצפית שלי</b><span>${p[2] || ''}</span><span>${lat}, ${lon}</span>`
      : `<b>${p[2] ? `שנת ${p[2]}` : 'שנה לא ידועה'}</b><span>${SRC_NAME[p[4]] || ''}</span><span>${p[3] ? `דיוק מיקום: כ-${p[3]} מ'` : 'דיוק מיקום: לא צוין'}</span><span class="mono">${lat}, ${lon}</span>`;
    pop.hidden = false;
    const pw = 190;
    pop.style.left = `${Math.max(8, Math.min(W - pw - 8, best.x - pw / 2))}px`;
    pop.style.top = `${best.y > 120 ? best.y - 96 : best.y + 16}px`;
  }

  root.querySelectorAll('[data-layer]').forEach((b) => {
    b.onclick = () => {
      layer = b.dataset.layer;
      root.querySelectorAll('[data-layer]').forEach((x) => x.classList.toggle('on', x === b));
      root.classList.toggle('sat', layer === 'sat');
      draw();
    };
  });
  root.querySelector('[data-act="in"]').onclick = () => zoomAt(1.6, W / 2, H / 2);
  root.querySelector('[data-act="out"]').onclick = () => zoomAt(1 / 1.6, W / 2, H / 2);
  root.querySelector('[data-act="fit"]').onclick = () => fit(pts.length ? pts : own);
  root.querySelector('[data-act="full"]').onclick = () => {
    const full = root.classList.toggle('full');
    document.body.classList.toggle('mapfull', full);
    root.querySelector('[data-act="full"]').textContent = full ? '✕' : '⤢';
    resize();
  };

  countEl.textContent = pts.length ? `${pts.length.toLocaleString('he-IL')} תצפיות` : (emptyText || 'אין תצפיות ידועות במאגרים');
  const ro = new ResizeObserver(() => { const first = !W; resize(); if (first) fit(pts.length ? pts : own); });
  ro.observe(root);
  // טעינה מוקדמת של הרקעים האחרים כדי שההחלפה והזום יהיו חלקים
  setTimeout(() => { for (const l of ['ter', 'sat']) for (const lv of ['9', '10']) for (const f of MAPMETA.levels[l][lv].files) loadImg(f.file, draw); }, 600);
  return { destroy() { ro.disconnect(); document.body.classList.remove('mapfull'); } };
}
