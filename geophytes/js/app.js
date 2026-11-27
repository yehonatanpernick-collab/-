import { SPECIES } from '../data/species.js';
import { GENERA } from '../data/genera.js';
import { PHOTOS } from '../data/photos.js';
import { CLIMATES, REGIONS, EXTRA_REGIONS, ABUNDANCE, TAGS, ZONES, ORGANS, MONTHS, MONTHS_SHORT } from '../data/regions.js';
import { getSettings, saveSettings, trackedYear } from './settings.js';
import * as db from './db.js';
import { MODELS, verifyObservation, identifyPlant, speciesProfile, testConnection, isHosted } from './ai.js';

const $app = document.getElementById('app');
const BY_CODE = Object.fromEntries(SPECIES.map((s) => [s.c, s]));
const REGION = Object.fromEntries(REGIONS.map((r) => [r.code, r]));
const CLIMATE = Object.fromEntries(CLIMATES.map((c) => [c.id, c]));
const GROUPS = {
  classic: 'גאופיטים קלאסיים (בצל, פקעת, קנה שורש)', rhizome: 'עשבוניים בעלי קנה שורש', grass: 'דגניים וגומאיים',
  aquatic: 'צמחי מים וביצות', climber: 'מטפסים',
};
const NOW_MONTH = new Date().getMonth() + 1;
const NONE = 'NONE'; // טקסונים שבמקור אין להם אזור מוגדר בישראל
const UNASSIGNED = SPECIES.filter((s) => !Object.keys(s.r).length);

// ---------- עזרים ----------
// כל מין: קובץ אחד (פס של עד 3 תמונות זו לצד זו) – כל מסגרת נחתכת ב-CSS.
const photoCount = (code) => PHOTOS[code]?.length || 0;
const refPhoto = (code) => (photoCount(code) ? `img/${code.toLowerCase()}.jpg` : null);
function frameStyle(code, i) {
  const n = photoCount(code);
  return `background-image:url(${refPhoto(code)});background-size:${n * 100}% 100%;background-position:${n > 1 ? (i * 100) / (n - 1) : 0}% 0`;
}
const cleanCredit = (c) => String(c || '').replace(/^\(c\)\s*/i, '').replace(/, some rights reserved.*$/i, '').replace(/, uploaded by .*/i, '').replace(/\s*\(CC[^)]*\)\s*$/i, '');

// דירוג נדירות 1–5: 1 = הכי נפוץ, 5 = הכי נדיר.
// מקומי (באזור נבחר) לפי רמת השכיחות באזור; ארצי לפי השכיחות הגבוהה ביותר ומספר האזורים. מין בסכנת הכחדה עולה דרגה.
const AB_TO_LEVEL = { 5: 1, 4: 2, 3: 3, 2: 4, 1: 5, 0: 3 };
function rarity(sp, code) {
  const abs = Object.values(sp.r);
  let lvl;
  if (code && sp.r[code] != null) lvl = AB_TO_LEVEL[sp.r[code]];
  else {
    const best = AB_TO_LEVEL[Math.max(...abs, 0)] ?? 3;
    const n = abs.length;
    const byRange = n >= 15 ? 1 : n >= 8 ? 2 : n >= 4 ? 3 : n >= 2 ? 4 : n === 1 ? 5 : 4;
    lvl = Math.round((best + byRange) / 2);
  }
  if (/[DX]/.test(sp.t) && lvl >= 2) lvl += 1;
  return Math.max(1, Math.min(5, lvl));
}
const RAR_NAMES = ['', 'נפוץ מאוד', 'שכיח', 'בינוני', 'נדיר', 'נדיר מאוד'];
function rarBadge(lvl) {
  return `<span class="rar r${lvl}" title="דירוג נדירות ${lvl} מתוך 5 (1 = הכי נפוץ, 5 = הכי נדיר)">
    <span class="rar-top"><span class="rar-lbl">נדירות</span><b>${lvl}</b><small>מתוך 5 · ${RAR_NAMES[lvl]}</small></span>
    <span class="rar-bars">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= lvl ? 'on' : ''}"></i>`).join('')}</span>
  </span>`;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const groupOf = (sp) => GENERA[sp.g]?.group || 'classic';

function hueFor(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function avatar(sp, size = 44) {
  if (refPhoto(sp.c) && size > 60) return `<span class="thumb" role="img" aria-label="${esc(sp.he)}" style="background-image:url(img/t/${sp.c.toLowerCase()}.jpg);background-size:cover;background-position:center"></span>`;
  const thumb = latestObs(sp.c)?.url || (size <= 60 ? null : refPhoto(sp.c));
  if (thumb) return `<img class="avatar" loading="lazy" style="width:${size}px;height:${size}px" src="${thumb}" alt="">`;
  const g = GENERA[sp.g];
  const hue = hueFor(g?.fam || sp.g);
  return `<span class="avatar ph" style="width:${size}px;height:${size}px;--h:${hue}">${esc((g?.he || sp.he)[0])}</span>`;
}

function monthsBar(f, labels = false) {
  return `<div class="months${labels ? ' labeled' : ''}" aria-label="חודשי פריחה: ${esc(f.map((m) => MONTHS[m - 1]).join(', '))}">${
    MONTHS_SHORT.map((m, i) => `<span class="${f.includes(i + 1) ? 'on' : ''}${i + 1 === NOW_MONTH ? ' now' : ''}">${labels ? m : i + 1}</span>`).join('')}</div>`;
}

// שורת "איפה" ברשימה: שכיחות באזור שנבחר ובית הגידול; בלי אזור – האזורים העיקריים.
function whereLine(sp, code, r) {
  const hab = sp.h || [...sp.z].map((z) => ZONES[z]).filter(Boolean).join(', ');
  if (r && sp.r[code] != null) return `${ABUNDANCE[sp.r[code]]?.name || ''} ב${r.name}${hab ? ` · ${hab}` : ''}`;
  const top = Object.entries(sp.r).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([c]) => REGION[c]?.name).filter(Boolean);
  return `${top.length ? `בעיקר ב${top.join(', ')}` : 'אין אזור מוגדר בישראל'}${hab ? ` · ${hab}` : ''}`;
}

function tagChips(t) {
  return [...t].map((k) => TAGS[k] ? `<span class="tag ${TAGS[k].cls}" title="${esc(TAGS[k].desc)}">${TAGS[k].name}</span>` : '').join('');
}

function abBadge(a) {
  const ab = ABUNDANCE[a] ?? ABUNDANCE[0];
  return `<span class="ab ${ab.cls}">${ab.name}</span>`;
}

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

function mdToHtml(md) {
  const lines = esc(md).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^#{1,3}\s/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h4>${line.replace(/^#{1,3}\s/, '')}</h4>`;
    } else if (/^\s*[-*•]\s/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${line.replace(/^\s*[-*•]\s/, '')}</li>`;
    } else if (line.trim()) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${line}</p>`;
    }
  }
  return html + (inList ? '</ul>' : '');
}

// ---------- תצפיות ----------
const urlCache = new Map();
function withUrl(o) {
  if (o.thumb && !urlCache.has(o.id)) urlCache.set(o.id, URL.createObjectURL(o.thumb));
  return { ...o, url: urlCache.get(o.id) };
}
function obsInYear() {
  const y = trackedYear();
  return db.observations().filter((o) => y == null || new Date(o.ts).getFullYear() === y);
}
function seenSet(region) {
  return new Set(obsInYear().filter((o) => !region || o.region === region).map((o) => o.code));
}
function latestObs(code) {
  const o = db.observations().find((x) => x.code === code);
  return o ? withUrl(o) : null;
}
function yearLabel() {
  const y = trackedYear();
  return y == null ? 'כל הזמנים' : `שנת ${y}`;
}

// ---------- ניתוב ----------
const filters = { q: '', status: 'all', bloom: false, rarity: 'all', lvl: 'all', sort: 'name' };

// זוכר את מיקום הגלילה של כל מסך, כדי שחזרה מדף מין תחזיר בדיוק למקום ברשימה.
const scrollPos = {};
let curScroll = 0;
let lastHash = null;
window.addEventListener('scroll', () => { curScroll = window.scrollY; }, { passive: true });

// בתוך Claude Artifact הכתובת אינה מעבירה מסלולים כמו #/r/GOL, ולכן הניווט נשמר בזיכרון (ערימת מסכים) ולא בכתובת.
let memHash = '#/';
const navStack = [];
const hashNow = () => (isHosted() ? memHash : location.hash);

function go(hash) {
  if (!isHosted()) { location.hash = hash; return; }
  navStack.push(memHash);
  memHash = hash;
  route();
}
function goBack(fallback) {
  if (!isHosted()) { location.hash = fallback; return; }
  memHash = navStack.length ? navStack.pop() : fallback;
  route();
}
document.addEventListener('click', (e) => {
  if (!isHosted() || e.defaultPrevented || e.button) return;
  const link = e.target.closest?.('a[href^="#/"]');
  if (!link) return;
  e.preventDefault();
  const href = link.getAttribute('href');
  if (link.dataset.back != null) goBack(href); else go(href);
});

function route() {
  if (lastHash !== null) scrollPos[lastHash] = curScroll;
  const prevHash = lastHash;
  lastHash = hashNow();
  const [path, query] = lastHash.slice(1).split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  const view = parts[0] === 'r' && (REGION[parts[1]] || parts[1] === NONE) ? () => renderRegion(parts[1])
    : parts[0] === 's' && BY_CODE[parts[1]] ? () => renderSpecies(BY_CODE[parts[1]], params.get('r'))
      : parts[0] === 'all' ? () => renderRegion(null)
        : parts[0] === 'seen' ? renderSeen
          : parts[0] === 'settings' ? renderSettings : renderHome;
  view();
  const cameBackFromSpecies = prevHash && prevHash.startsWith('#/s/') && ['r', 'all'].includes(parts[0]);
  const y = cameBackFromSpecies ? scrollPos[lastHash] || 0 : 0;
  window.scrollTo(0, y);
  curScroll = y;
}

function topbar(title, back) {
  return `<header class="topbar">
    ${back ? `<a class="iconbtn" data-back href="${back}" aria-label="חזרה">→</a>` : '<span class="logo">🌷</span>'}
    <h1>${title}</h1>
    <a class="iconbtn" href="#/settings" aria-label="הגדרות">⚙</a>
  </header>`;
}

// ---------- מסך בית ----------
function renderHome() {
  const seen = seenSet();
  const total = SPECIES.length;
  const pct = Math.round((seen.size / total) * 100);
  const blooming = SPECIES.filter((s) => s.f.includes(NOW_MONTH));
  const bloomingMissing = blooming.filter((s) => !seen.has(s.c)).length;
  const s = getSettings();
  const years = [...new Set(db.observations().map((o) => new Date(o.ts).getFullYear()))];
  if (!years.includes(new Date().getFullYear())) years.push(new Date().getFullYear());

  $app.innerHTML = `${topbar('אתגר הגאופיטים')}
  <main class="home">
    <section class="hero card">
      <div class="ring" style="--p:${pct}">
        <div><b>${seen.size}</b><small>מתוך ${total}</small></div>
      </div>
      <div class="hero-txt">
        <h2>כל הגאופיטים של ישראל</h2>
        <p>${total} מינים, תתי-מינים וזנים לפי "צמחיית ישראל וסביבתה". צלמו כל אחד – הבינה המלאכותית מאמתת – ומסמנים ✓.</p>
        <label class="yearsel">מעקב:
          <select id="year">
            <option value="current"${s.year === 'current' ? ' selected' : ''}>השנה הנוכחית</option>
            ${years.sort().reverse().map((y) => `<option value="${y}"${String(s.year) === String(y) ? ' selected' : ''}>${y}</option>`).join('')}
            <option value="all"${s.year === 'all' ? ' selected' : ''}>כל הזמנים</option>
          </select>
        </label>
      </div>
    </section>

    <div class="actions">
      <button class="btn primary" id="identify">📷 זהה צמח מתמונה</button>
      <a class="btn" href="#/seen">🗂 התצפיות שלי (${db.observations().length})</a>
      <a class="btn" href="#/all">📋 כל ${total} המינים</a>
    </div>

    <section class="card bloom">
      <h3>🌸 פורחים עכשיו – ${MONTHS[NOW_MONTH - 1]}</h3>
      <p>${blooming.length} מינים פורחים החודש; ${bloomingMissing} מהם עוד חסרים לך.</p>
      <div class="chips scroll">${blooming.filter((sp) => !seen.has(sp.c)).slice(0, 40).map((sp) =>
        `<a class="chip" href="#/s/${sp.c}">${esc(sp.he)}</a>`).join('')}</div>
    </section>

    <h2 class="section-title">בחרו אזור בארץ</h2>
    ${CLIMATES.map((cl) => {
      const regs = REGIONS.filter((r) => r.climate === cl.id);
      return `<section class="climate" style="--cc:${cl.color}">
        <h3><span class="dot"></span>${cl.name}</h3>
        <p class="muted">${cl.desc}</p>
        <div class="regions">${regs.map((r) => regionCard(r)).join('')}</div>
      </section>`;
    }).join('')}
    <section class="climate" style="--cc:#8a8f88">
      <h3><span class="dot"></span>ללא אזור מוגדר</h3>
      <p class="muted">${UNASSIGNED.length} טקסונים שבמקור אין להם תפוצה מפורטת בישראל (עבר הירדן, מינים זרים, טקסונים חדשים).</p>
      <div class="regions"><a class="region card" href="#/r/${NONE}"><div class="rtop"><b>רשימה נפרדת</b><span class="count">${UNASSIGNED.filter((sp) => seen.has(sp.c)).length}/${UNASSIGNED.length}</span></div></a></div>
    </section>
    <p class="source">מקור הנתונים: <a href="https://flora.org.il/plants/life-form/geophyte/" target="_blank" rel="noopener">צמחיית ישראל וסביבתה – צורת חיים: גיאופיט</a>.</p>
  </main>`;

  document.getElementById('year').onchange = (e) => { saveSettings({ year: e.target.value }); renderHome(); };
  document.getElementById('identify').onclick = () => openCapture({});
}

function regionCard(r) {
  const list = SPECIES.filter((sp) => sp.r[r.code] != null);
  const seen = seenSet(r.code);
  const done = list.filter((sp) => seen.has(sp.c)).length;
  const rare = list.filter((sp) => sp.r[r.code] <= 3).length;
  const pct = list.length ? Math.round((done / list.length) * 100) : 0;
  return `<a class="region card" href="#/r/${r.code}">
    <div class="rtop"><b>${esc(r.name)}</b><span class="count">${done}/${list.length}</span></div>
    <div class="bar"><span style="width:${pct}%"></span></div>
    <small class="muted">${rare} נדירים · ${esc(r.rain)} מ"מ גשם</small>
  </a>`;
}

// ---------- מסך אזור ----------
function renderRegion(code) {
  const none = code === NONE;
  const r = code && !none ? REGION[code] : null;
  const cl = r ? CLIMATE[r.climate] : null;
  const list = none ? UNASSIGNED : SPECIES.filter((sp) => !r || sp.r[code] != null);
  if (none) code = null;
  const seen = seenSet(code);
  const seenAnywhere = seenSet();
  const done = list.filter((sp) => seen.has(sp.c)).length;

  $app.innerHTML = `${topbar(r ? esc(r.name) : none ? 'ללא אזור מוגדר' : 'כל הגאופיטים בישראל', '#/')}
  <main>
    ${none ? `<section class="card"><p>טקסונים שמופיעים ברשימת הגאופיטים של "צמחיית ישראל וסביבתה" אבל בעמוד שלהם אין אזור תפוצה בישראל: מינים מעבר הירדן ומסיני, מינים זרים, הכלאות וטקסונים שתוארו לאחרונה. אם מצאתם אחד מהם – אפשר לצלם ולסמן אותו בכל אזור.</p></section>` : ''}
    ${r ? `<section class="card region-head" style="--cc:${cl.color}">
      <span class="climate-chip">${cl.name}</span>
      <p>${esc(r.desc)}</p>
      <p class="muted">גשם: ${esc(r.rain)} מ"מ · גובה: ${esc(r.alt)}</p>
    </section>` : ''}
    <section class="card progress">
      <div class="rtop"><b>${done} מתוך ${list.length} נמצאו</b><span class="muted">${yearLabel()}</span></div>
      <div class="bar big"><span style="width:${list.length ? (done / list.length) * 100 : 0}%"></span></div>
    </section>

    <section class="filters card">
      <input type="search" id="q" placeholder="חיפוש בשם עברי או לטיני…" value="${esc(filters.q)}">
      <div class="seg" id="status">
        ${[['all', 'הכל'], ['missing', 'חסרים'], ['seen', 'נמצאו']].map(([v, l]) => `<button data-v="${v}" class="${filters.status === v ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <div class="row">
        <label class="toggle"><input type="checkbox" id="bloom"${filters.bloom ? ' checked' : ''}> פורחים עכשיו</label>
        <select id="rarity">
          ${[['all', 'כל השכיחויות'], ['rare', `נדירים ${r ? 'באזור' : ''}`], ['vrare', 'נדירים מאוד'], ['P', 'מוגנים'], ['E', 'אנדמיים'], ['D', 'בסכנת הכחדה']]
            .map(([v, l]) => `<option value="${v}"${filters.rarity === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <select id="lvl">
          <option value="all">כל דרגות הנדירות</option>
          ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${String(filters.lvl) === String(n) ? ' selected' : ''}>נדירות ${n}${n === 1 ? ' (הכי נפוץ)' : n === 5 ? ' (הכי נדיר)' : ''}</option>`).join('')}
        </select>
        <select id="sort">
          ${[['name', 'מיון: א-ב'], ['rare', 'מיון: הנדירים קודם'], ['common', 'מיון: הנפוצים קודם'], ['bloom', 'מיון: פריחה קרובה'], ['family', 'מיון: לפי משפחה']]
            .map(([v, l]) => `<option value="${v}"${filters.sort === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </section>
    <ul class="splist" id="list"></ul>
  </main>`;

  const draw = () => {
    const q = filters.q.trim().toLowerCase();
    const localAb = (sp) => (r ? sp.r[code] : Math.max(...Object.values(sp.r), 0));
    let items = list.filter((sp) => {
      if (q && !sp.he.includes(q) && !sp.la.toLowerCase().includes(q)) return false;
      if (filters.status === 'missing' && seen.has(sp.c)) return false;
      if (filters.status === 'seen' && !seen.has(sp.c)) return false;
      if (filters.bloom && !sp.f.includes(NOW_MONTH)) return false;
      if (filters.lvl !== 'all' && rarity(sp, code) !== Number(filters.lvl)) return false;
      if (filters.rarity === 'rare' && localAb(sp) > 3) return false;
      if (filters.rarity === 'vrare' && localAb(sp) > 2) return false;
      if ('PED'.includes(filters.rarity) && filters.rarity.length === 1 && !sp.t.includes(filters.rarity)) return false;
      return true;
    });
    const monthsAway = (sp) => (sp.f.length ? Math.min(...sp.f.map((m) => (m - NOW_MONTH + 12) % 12)) : 99);
    const cmp = {
      name: (a, b) => a.he.localeCompare(b.he, 'he'),
      rare: (a, b) => rarity(b, code) - rarity(a, code) || a.he.localeCompare(b.he, 'he'),
      common: (a, b) => rarity(a, code) - rarity(b, code) || a.he.localeCompare(b.he, 'he'),
      bloom: (a, b) => monthsAway(a) - monthsAway(b) || a.he.localeCompare(b.he, 'he'),
      family: (a, b) => (GENERA[a.g]?.famHe || '').localeCompare(GENERA[b.g]?.famHe || '', 'he') || a.he.localeCompare(b.he, 'he'),
    }[filters.sort];
    items = items.sort(cmp);
    const $list = document.getElementById('list');
    $list.innerHTML = items.length ? items.map((sp) => {
      const isSeen = seen.has(sp.c);
      const elsewhere = !isSeen && seenAnywhere.has(sp.c);
      return `<li class="sp${isSeen ? ' seen' : ''}">
        <a class="spcard" href="#/s/${sp.c}${code ? `?r=${code}` : ''}">
          <div class="sprow">
            ${avatar(sp, 96)}
            <div class="sptxt">
              <b class="spname">${esc(sp.he)}</b>
              <i class="splatin">${esc(sp.la)}</i>
              ${rarBadge(rarity(sp, code))}
            </div>
          </div>
          <div class="spmonths"><span class="mlbl">חודשי פריחה</span>${monthsBar(sp.f)}</div>
          ${(r || sp.t.replace('R', '') || elsewhere) ? `<div class="meta">${r ? abBadge(sp.r[code]) : ''}${tagChips(sp.t.replace('R', ''))}${elsewhere ? '<span class="tag tg-else">נמצא באזור אחר</span>' : ''}</div>` : ''}
        </a>
        ${isSeen ? '<span class="check" title="נמצא ואומת">✓</span>' : `<button class="cam" data-c="${sp.c}" aria-label="צלם ${esc(sp.he)}">📷</button>`}
      </li>`;
    }).join('') : '<li class="empty">אין מינים שתואמים לסינון.</li>';
    $list.querySelectorAll('.cam').forEach((b) => { b.onclick = () => openCapture({ species: BY_CODE[b.dataset.c], region: code }); });
  };

  document.getElementById('q').oninput = (e) => { filters.q = e.target.value; draw(); };
  document.querySelectorAll('#status button').forEach((b) => {
    b.onclick = () => { filters.status = b.dataset.v; document.querySelectorAll('#status button').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  });
  document.getElementById('bloom').onchange = (e) => { filters.bloom = e.target.checked; draw(); };
  for (const id of ['rarity', 'lvl', 'sort']) document.getElementById(id).onchange = (e) => { filters[id] = e.target.value; draw(); };
  draw();
}

// ---------- מסך מין ----------
function renderSpecies(sp, regionCtx) {
  const g = GENERA[sp.g] || {};
  const back = regionCtx && REGION[regionCtx] ? `#/r/${regionCtx}` : '#/';
  const myObs = db.observations().filter((o) => o.code === sp.c).map(withUrl);
  const regs = Object.entries(sp.r).sort((a, b) => b[1] - a[1]);
  const extra = Object.entries(sp.x || {});
  const latest = myObs[0];
  const profileKey = `geophytes.profile.${sp.c}`;
  let cachedProfile = null;
  try { cachedProfile = localStorage.getItem(profileKey); } catch { /* ignore */ }

  $app.innerHTML = `${topbar(esc(sp.he), back)}
  <main class="species">
    ${photoCount(sp.c) ? `<section class="gallery3" aria-label="תמונות של ${esc(sp.he)}">
      <div class="strip">${PHOTOS[sp.c].map((p, i) => `<figure class="shot3">
        <button class="frame" data-i="${i}" style="${frameStyle(sp.c, i)}" aria-label="הגדל תמונה ${i + 1}"></button>
        <figcaption>${esc(cleanCredit(p.credit))} · <a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.source)}</a></figcaption>
      </figure>`).join('')}</div>
      ${photoCount(sp.c) > 1 ? '<p class="muted swipe">החליקו הצידה לעוד תמונות · לחיצה להגדלה</p>' : ''}
    </section>` : ''}
    <section class="card sphead">
      ${latest ? `<img class="hero-photo" src="${latest.url}" alt="התצפית שלי">` : (refPhoto(sp.c) ? '' : avatar(sp, 56))}
      <div>
        <h2>${esc(sp.he)}</h2>
        <p class="latin">${esc(sp.la)}</p>
        <p class="muted">משפחת ה${esc(g.famHe || '')} (${esc(g.fam || '')}) · סוג ${esc(g.he || sp.g)}</p>
        <div class="meta">${rarBadge(rarity(sp, regionCtx && sp.r[regionCtx] != null ? regionCtx : null))}${tagChips(sp.t)}${myObs.length ? '<span class="tag tg-ok">✓ נמצא ואומת</span>' : ''}</div>
      </div>
    </section>

    <button class="btn primary wide" id="capture">📷 צלמו וסמנו שראיתם</button>

    <section class="card">
      <h3>🌼 עונת פריחה</h3>
      ${monthsBar(sp.f, true)}
      <p class="muted">${sp.f.length ? (sp.f.includes(NOW_MONTH) ? 'פורח עכשיו – זה הזמן לחפש!' : `פורח ב: ${sp.f.map((m) => MONTHS[m - 1]).join(', ')}`) : 'מועד הפריחה אינו מצוין במקור.'}</p>
    </section>

    <section class="card">
      <h3>🔎 סימני זיהוי</h3>
      <p>${esc(sp.s || 'אין תיאור במקור.')}</p>
      <dl class="facts">
        <div><dt>איבר אגירה</dt><dd>${ORGANS[sp.o].name}<small>${ORGANS[sp.o].desc}</small></dd></div>
        <div><dt>בית גידול</dt><dd>${esc(sp.h || '—')}</dd></div>
        <div><dt>חבלי צמחייה</dt><dd>${[...sp.z].map((z) => ZONES[z]).join(', ') || '—'}</dd></div>
        <div><dt>סוג צמח</dt><dd>${GROUPS[groupOf(sp)]}</dd></div>
      </dl>
    </section>

    <section class="card">
      <h3>📍 איפה הוא גדל בישראל</h3>
      <ul class="distr">${regs.map(([c, a]) => `<li class="${c === regionCtx ? 'cur' : ''}"><a href="#/r/${c}">${esc(REGION[c].name)}</a>${abBadge(a)}</li>`).join('')}</ul>
      ${extra.length ? `<p class="muted">גם בעבר הירדן: ${extra.map(([c, a]) => `${EXTRA_REGIONS[c]} (${ABUNDANCE[a]?.name})`).join(', ')}</p>` : ''}
    </section>

    <section class="card">
      <h3>🧬 על הסוג ${esc(g.he || sp.g)}</h3>
      <p>${esc(g.about || '')}</p>
      ${g.more ? `<p class="fun">💡 ${esc(g.more)}</p>` : ''}
    </section>

    <section class="card">
      <h3>🤖 הסבר מורחב מהבינה המלאכותית</h3>
      <div id="profile" class="profile">${cachedProfile ? mdToHtml(cachedProfile) : '<p class="muted">זיהוי, מינים דומים, אקולוגיה, האבקה, נדירות, שמירת טבע, תרבות ושימושים.</p>'}</div>
      <button class="btn" id="genprofile">${cachedProfile ? 'רענון ההסבר' : 'כתוב לי הסבר מלא'}</button>
    </section>

    <a class="btn wide" href="https://flora.org.il/plants/${sp.c}/" target="_blank" rel="noopener">🖼 תמונות ומידע מלא ב"צמחיית ישראל"</a>

    ${myObs.length ? `<section class="card">
      <h3>🗂 התצפיות שלי</h3>
      <div class="gallery">${myObs.map((o) => obsCard(o)).join('')}</div>
    </section>` : ''}
  </main>`;

  document.getElementById('capture').onclick = () => openCapture({ species: sp, region: regionCtx || regs[0]?.[0] });
  document.querySelectorAll('.gallery3 .frame').forEach((b) => { b.onclick = () => openLightbox(sp, Number(b.dataset.i)); });
  bindObsDelete(() => renderSpecies(sp, regionCtx));
  const $p = document.getElementById('profile');
  const $btn = document.getElementById('genprofile');
  $btn.onclick = async () => {
    $btn.disabled = true;
    $btn.textContent = 'כותב…';
    $p.innerHTML = '<p class="muted pulse">הבינה המלאכותית כותבת…</p>';
    try {
      const text = await speciesProfile(sp, (snap) => { $p.innerHTML = mdToHtml(snap); });
      $p.innerHTML = mdToHtml(text);
      try { localStorage.setItem(profileKey, text); } catch { /* ignore */ }
      $btn.textContent = 'רענון ההסבר';
    } catch (err) {
      $p.innerHTML = `<p class="err">${esc(err.message)}</p>`;
      if (err.kind === 'nokey' && !isHosted()) $p.innerHTML += '<a class="btn" href="#/settings">להגדרות</a>';
      $btn.textContent = 'נסו שוב';
    }
    $btn.disabled = false;
  };
}

function openLightbox(sp, start) {
  const n = photoCount(sp.c);
  let i = start;
  const dlg = document.createElement('dialog');
  dlg.className = 'lightbox';
  dlg.innerHTML = `<div class="lb"><div class="lbimg" role="img" aria-label="${esc(sp.he)}"></div>
    <p class="lbcap"></p>
    <div class="row lbnav"><button class="btn" id="lbprev" aria-label="הקודמת">›</button><span id="lbpos"></span><button class="btn" id="lbnext" aria-label="הבאה">‹</button><button class="btn" id="lbclose">סגירה</button></div></div>`;
  document.body.append(dlg);
  const show = () => {
    dlg.querySelector('.lbimg').setAttribute('style', frameStyle(sp.c, i));
    const p = PHOTOS[sp.c][i];
    dlg.querySelector('.lbcap').innerHTML = `${esc(cleanCredit(p.credit))} · <a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.source)}</a>`;
    dlg.querySelector('#lbpos').textContent = `${i + 1} / ${n}`;
  };
  dlg.querySelector('#lbprev').onclick = () => { i = (i - 1 + n) % n; show(); };
  dlg.querySelector('#lbnext').onclick = () => { i = (i + 1) % n; show(); };
  dlg.querySelector('#lbclose').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  show();
  dlg.showModal();
}

function obsCard(o) {
  const sp = BY_CODE[o.code];
  const d = new Date(o.ts);
  return `<figure class="obs">
    ${o.url ? `<img src="${o.url}" alt="">` : ''}
    <figcaption>
      <a href="#/s/${o.code}"><b>${esc(sp?.he || o.code)}</b></a>
      <small>${d.toLocaleDateString('he-IL')} · ${esc(REGION[o.region]?.name || '')}</small>
      <small>ביטחון AI: ${o.ai?.confidence ?? '—'}%</small>
      <button class="link danger" data-del="${o.id}">מחיקה</button>
    </figcaption>
  </figure>`;
}

function bindObsDelete(rerender) {
  document.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('למחוק את התצפית?')) return;
      await db.deleteObservation(b.dataset.del);
      rerender();
    };
  });
}

// ---------- התצפיות שלי ----------
function renderSeen() {
  const obs = db.observations().map(withUrl);
  const uniq = new Set(obs.map((o) => o.code));
  $app.innerHTML = `${topbar('התצפיות שלי', '#/')}
  <main>
    <section class="card"><b>${obs.length} תצפיות מאומתות · ${uniq.size} מינים שונים</b></section>
    ${obs.length ? `<div class="gallery">${obs.map((o) => obsCard(o)).join('')}</div>` : '<p class="empty">עוד אין תצפיות. בחרו אזור, מצאו גאופיט וצלמו אותו!</p>'}
  </main>`;
  bindObsDelete(renderSeen);
}

// ---------- הגדרות ----------
function renderSettings() {
  const s = getSettings();
  const hosted = isHosted();
  $app.innerHTML = `${topbar('הגדרות', '#/')}
  <main class="settings">
    ${hosted ? `<section class="card">
      <h3>🤖 בינה מלאכותית</h3>
      <p>Claude מחובר לאפליקציה ועובד דרך חשבון ה-Claude שלך – אין צורך במפתח. בפעם הראשונה תתבקש לאשר.</p>
      <label>סף ביטחון לאישור: <b id="thv">${s.threshold}%</b>
        <input type="range" id="threshold" min="60" max="95" step="5" value="${s.threshold}">
      </label>
      <div class="row"><button class="btn primary" id="save">שמירה</button><button class="btn" id="test">בדיקת חיבור</button></div>
      <p id="testres" class="muted"></p>
    </section>` : `<section class="card">
      <h3>🤖 חיבור לבינה המלאכותית (Claude)</h3>
      <p class="muted">הזיהוי והאימות מתבצעים ע"י Claude של Anthropic. צריך מפתח API אישי מ-<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. המפתח נשמר רק בדפדפן הזה ונשלח רק ל-Anthropic.</p>
      <label>אופן החיבור
        <select id="mode">
          <option value="direct"${s.mode === 'direct' ? ' selected' : ''}>מפתח אישי בדפדפן</option>
          <option value="proxy"${s.mode === 'proxy' ? ' selected' : ''}>דרך השרת (server.js מחזיק את המפתח)</option>
        </select>
      </label>
      <label id="keyrow">מפתח API
        <input type="password" id="apikey" placeholder="sk-ant-..." value="${esc(s.apiKey)}" autocomplete="off">
      </label>
      <label>מודל
        <select id="model">${MODELS.map((m) => `<option value="${m.id}"${s.model === m.id ? ' selected' : ''}>${m.name}</option>`).join('')}</select>
      </label>
      <label>סף ביטחון לאישור: <b id="thv">${s.threshold}%</b>
        <input type="range" id="threshold" min="60" max="95" step="5" value="${s.threshold}">
      </label>
      <label class="toggle"><input type="checkbox" id="loc"${s.saveLocation ? ' checked' : ''}> לצרף מיקום GPS לתצפית (עוזר לאימות)</label>
      <div class="row">
        <button class="btn primary" id="save">שמירה</button>
        <button class="btn" id="test">בדיקת חיבור</button>
      </div>
      <p id="testres" class="muted"></p>
    </section>`}

    <section class="card">
      <h3>💾 גיבוי</h3>
      <p class="muted">התצפיות והתמונות נשמרות במכשיר הזה. כדאי לגבות מדי פעם.</p>
      <div class="row">
        <button class="btn" id="export">ייצוא גיבוי</button>
        <label class="btn">ייבוא גיבוי<input type="file" id="import" accept="application/json" hidden></label>
        <button class="btn danger" id="wipe">מחיקת כל התצפיות</button>
      </div>
    </section>

    <section class="card">
      <h3>ℹ️ על האפליקציה</h3>
      <p>הרשימה כוללת את כל ${SPECIES.length} הטקסונים שמוגדרים כ"גיאופיט" במאגר <a href="https://flora.org.il/plants/life-form/geophyte/" target="_blank" rel="noopener">צמחיית ישראל וסביבתה</a> – כולל זנים, הכלאות וטקסונים שטרם תוארו – עם התפוצה והשכיחות בכל אזור, חודשי הפריחה ומעמד ההגנה.</p>
      <p class="muted">זכרו: רוב הגאופיטים מוגנים בחוק. מצלמים – לא קוטפים ולא עוקרים.</p>
    </section>
  </main>`;

  const $mode = document.getElementById('mode');
  const syncMode = () => { if ($mode) document.getElementById('keyrow').hidden = $mode.value === 'proxy'; };
  if ($mode) $mode.onchange = syncMode;
  syncMode();
  document.getElementById('threshold').oninput = (e) => { document.getElementById('thv').textContent = `${e.target.value}%`; };
  const collect = () => saveSettings(hosted
    ? { threshold: Number(document.getElementById('threshold').value) }
    : {
      mode: $mode.value,
      apiKey: document.getElementById('apikey').value.trim(),
      model: document.getElementById('model').value,
      threshold: Number(document.getElementById('threshold').value),
      saveLocation: document.getElementById('loc').checked,
    });
  document.getElementById('save').onclick = () => { collect(); toast('נשמר ✓'); };
  document.getElementById('test').onclick = async () => {
    collect();
    const $r = document.getElementById('testres');
    $r.textContent = 'בודק…';
    try { $r.textContent = `✓ מחובר. התשובה: ${await testConnection()}`; } catch (err) { $r.textContent = `✗ ${err.message}`; }
  };
  document.getElementById('export').onclick = async () => {
    const blob = new Blob([await db.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `geophytes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  document.getElementById('import').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { toast(`יובאו ${await db.importJson(await f.text())} תצפיות`); } catch (err) { toast(`שגיאה: ${err.message}`); }
  };
  document.getElementById('wipe').onclick = async () => {
    if (!confirm('למחוק את כל התצפיות לצמיתות?')) return;
    await db.clearAll();
    toast('נמחק');
  };
}

// ---------- צילום ואימות ----------
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const scaleTo = (max) => {
    const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bitmap.width * k);
    c.height = Math.round(bitmap.height * k);
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    return c;
  };
  const big = scaleTo(1568);
  const dataUrl = big.toDataURL('image/jpeg', 0.85);
  const thumb = await new Promise((res) => scaleTo(640).toBlob(res, 'image/jpeg', 0.8));
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', preview: dataUrl, thumb };
}

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null), { timeout: 8000, maximumAge: 60000 });
  });
}

function openCapture({ species, region }) {
  const images = [];
  const s = getSettings();
  const dlg = document.createElement('dialog');
  dlg.className = 'capture';
  dlg.innerHTML = `<form method="dialog" class="dlg">
    <header><h3>${species ? `אימות: ${esc(species.he)}` : 'זיהוי צמח מתמונה'}</h3><button class="iconbtn" value="close" aria-label="סגירה">✕</button></header>
    ${species ? `<p class="muted"><i>${esc(species.la)}</i> – צלמו את הפרח מקרוב, ואם אפשר גם את העלים ואת הצמח כולו (עד 3 תמונות).</p>` : '<p class="muted">צלמו את הצמח (עד 3 תמונות) והבינה המלאכותית תזהה אותו.</p>'}
    <label>איפה צילמתם?
      <select id="creg">
        <option value="">— בחרו אזור —</option>
        ${CLIMATES.map((cl) => `<optgroup label="${cl.name}">${REGIONS.filter((r) => r.climate === cl.id).map((r) =>
          `<option value="${r.code}"${r.code === region ? ' selected' : ''}>${r.name}${species && species.r[r.code] == null ? ' (לא ידוע שגדל כאן)' : ''}</option>`).join('')}</optgroup>`).join('')}
      </select>
    </label>
    <div class="shots" id="shots"></div>
    <div class="row">
      <label class="btn">📷 צילום<input type="file" accept="image/*" capture="environment" id="cam" hidden></label>
      <label class="btn">🖼 מהגלריה<input type="file" accept="image/*" multiple id="gal" hidden></label>
    </div>
    <button class="btn primary wide" id="analyze" type="button" disabled>🔬 נתח עם בינה מלאכותית</button>
    <div id="result"></div>
  </form>`;
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove());

  const $shots = dlg.querySelector('#shots');
  const $analyze = dlg.querySelector('#analyze');
  const $result = dlg.querySelector('#result');
  const drawShots = () => {
    $shots.innerHTML = images.map((im, i) => `<div class="shot"><img src="${im.preview}" alt=""><button type="button" data-i="${i}" aria-label="הסרה">✕</button></div>`).join('');
    $shots.querySelectorAll('button').forEach((b) => { b.onclick = () => { images.splice(Number(b.dataset.i), 1); drawShots(); }; });
    $analyze.disabled = !images.length;
  };
  const addFiles = async (files) => {
    for (const f of [...files].slice(0, 3 - images.length)) {
      try { images.push(await prepareImage(f)); } catch { toast('לא הצלחתי לקרוא את התמונה'); }
    }
    drawShots();
    $result.innerHTML = '';
  };
  dlg.querySelector('#cam').onchange = (e) => addFiles(e.target.files);
  dlg.querySelector('#gal').onchange = (e) => addFiles(e.target.files);

  $analyze.onclick = async () => {
    const reg = dlg.querySelector('#creg').value;
    if (!reg) { toast('בחרו אזור – כך הרשימה של האזור תתעדכן'); return; }
    $analyze.disabled = true;
    $result.innerHTML = '<div class="analyzing"><span class="spinner"></span><p>Claude בוחן את הצמח… (עד דקה)</p></div>';
    const pos = s.saveLocation ? await getPosition() : null;
    try {
      const args = { images, region: reg, lat: pos?.lat, lon: pos?.lon };
      const res = species ? await verifyObservation({ species, ...args }) : await identifyPlant(args);
      showResult(res, reg, pos);
    } catch (err) {
      $result.innerHTML = `<p class="err">${esc(err.message)}</p>${err.kind === 'nokey' && !isHosted() ? '<a class="btn" href="#/settings">להגדרות</a>' : ''}`;
    }
    $analyze.disabled = false;
  };

  function showResult(res, reg, pos) {
    const threshold = getSettings().threshold;
    const idSp = BY_CODE[res.identified_code] || null;
    const solid = res.is_plant_photo && res.looks_like_live_photo && res.identification_rank === 'species' && res.confidence >= threshold;
    const targetOk = species && solid && (res.identified_code === species.c || (res.matches_target && !res.identified_code));
    const otherOk = solid && idSp && (!species || idSp.c !== species.c);
    let verdict;
    if (targetOk) verdict = `<div class="verdict ok">✓ אושר! זהו ${esc(species.he)}</div>`;
    else if (!res.is_plant_photo) verdict = '<div class="verdict bad">✗ לא נראה צמח בתמונה</div>';
    else if (!res.looks_like_live_photo) verdict = '<div class="verdict bad">✗ נראה כמו צילום של מסך/הדפסה/איור – צריך לצלם את הצמח עצמו בטבע</div>';
    else if (otherOk) verdict = `<div class="verdict info">זה כנראה <b>${esc(idSp.he)}</b>${species ? ` ולא ${esc(species.he)}` : ''}</div>`;
    else if (!solid) verdict = '<div class="verdict warn">? הזיהוי לא מספיק ודאי לאישור</div>';
    else verdict = `<div class="verdict warn">${species ? `✗ זה לא ${esc(species.he)}` : 'זוהה צמח שאינו ברשימת הגאופיטים'}</div>`;

    $result.innerHTML = `${verdict}
      <div class="ai-card">
        <p><b>זיהוי:</b> ${esc(res.identified_hebrew)} <i>${esc(res.identified_latin)}</i> <span class="muted">(${{ species: 'עד רמת מין', genus: 'עד רמת סוג', family: 'עד רמת משפחה', none: 'לא זוהה' }[res.identification_rank]})</span></p>
        <div class="conf"><span style="width:${res.confidence}%"></span><b>${res.confidence}% ביטחון</b></div>
        ${res.evidence_he ? `<p><b>למה:</b> ${esc(res.evidence_he)}</p>` : ''}
        ${res.concerns_he ? `<p><b>ספקות:</b> ${esc(res.concerns_he)}</p>` : ''}
        ${res.alternatives?.length ? `<p><b>אפשרויות אחרות:</b></p><ul>${res.alternatives.map((a) => `<li>${BY_CODE[a.code] ? `<a href="#/s/${a.code}">${esc(a.hebrew)}</a>` : esc(a.hebrew)} <i>${esc(a.latin)}</i> – ${esc(a.why_he)}</li>`).join('')}</ul>` : ''}
        ${res.tips_he ? `<p class="tip">📸 ${esc(res.tips_he)}</p>` : ''}
      </div>
      ${targetOk ? '<button class="btn primary wide" type="button" id="mark">✓ סמנו ברשימה</button>' : ''}
      ${otherOk ? `<button class="btn primary wide" type="button" id="markother">✓ סמנו את ${esc(idSp.he)}</button>` : ''}`;

    const save = async (sp) => {
      await db.addObservation({
        code: sp.c, region: reg, thumb: images[0].thumb,
        lat: pos?.lat ?? null, lon: pos?.lon ?? null,
        ai: { confidence: res.confidence, evidence_he: res.evidence_he, identified_latin: res.identified_latin, model: res.model },
      });
      dlg.close();
      celebrate(sp, reg);
      route();
    };
    dlg.querySelector('#mark')?.addEventListener('click', () => save(species));
    dlg.querySelector('#markother')?.addEventListener('click', () => save(idSp));
  }
}

function celebrate(sp, reg) {
  const inReg = SPECIES.filter((x) => x.r[reg] != null);
  const seen = seenSet(reg);
  const done = inReg.filter((x) => seen.has(x.c)).length;
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.innerHTML = `<div><span>🌷</span><b>${esc(sp.he)} נוסף לרשימה!</b><small>${esc(REGION[reg]?.name || '')}: ${done}/${inReg.length}</small></div>`;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- אתחול ----------
window.addEventListener('hashchange', route);
db.loadAll().then(route);

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !isHosted()) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
