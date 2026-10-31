import * as THREE from 'three';
import { SHIPS, SHIP_LIST, STRUCT_LIST, FACTIONS } from './data.js';
import { power } from './ai.js';

const TYPE_NAME = ['עולם ממוזג', 'עולם צחיח', 'עולם קפוא', 'עולם מותך', 'ענק גזים'];
const OWNER_NAME = { player: 'המשמרת', enemy: 'אופל', neutral: 'מתיישבים עצמאיים', null: 'ללא שליטה' };
const $ = (s) => document.querySelector(s);
const fmt = (n) => Math.floor(n).toLocaleString('en-US');
const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const _v = new THREE.Vector3();

export class UI {
  constructor(app) {
    this.app = app;
    this.labels = [];
    this.panelHTML = '';
    this.selHTML = '';
    this.panelT = 0;
    this.hintStep = -1;
    this.hintT = 0;
    this.flags = {};
    const root = $('#labels');
    root.innerHTML = '';
    for (const b of app.bodies) {
      const el = document.createElement('div');
      el.className = 'lbl';
      el.innerHTML = `<svg width="1" height="1"><circle class="sel" cx="0" cy="0" r="10"/><circle class="cap" cx="0" cy="0" r="14" transform="rotate(-90)"/></svg>
        <div class="tag"><i></i><b>${b.name}</b><span class="num">+${b.prod}</span></div><div class="cnt"></div>`;
      root.appendChild(el);
      this.labels.push({ el, b, sel: el.querySelector('.sel'), cap: el.querySelector('.cap'), tag: el.querySelector('.tag'), cnt: el.querySelector('.cnt'), num: el.querySelector('.tag .num'), last: '' });
    }

    $('#panel').addEventListener('click', (e) => this.onPanel(e));
    $('#selection').addEventListener('click', (e) => {
      const c = e.target.closest('[data-cls]'); if (!c) return;
      app.filterSelection(c.dataset.cls);
    });
    $('#hint').addEventListener('click', (e) => { if (e.target.closest('button')) this.nextHint(true); });
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const { camera, game, sel } = this.app;
    const W = window.innerWidth, H = window.innerHeight;
    const k = (H / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    for (const L of this.labels) {
      const b = L.b;
      _v.copy(b.pos).project(camera);
      const dist = camera.position.distanceTo(b.pos);
      if (_v.z > 1 || Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) { L.el.style.display = 'none'; continue; }
      L.el.style.display = '';
      const x = (_v.x + 1) / 2 * W, y = (1 - _v.y) / 2 * H;
      const rp = Math.max(3, b.r * k / dist);
      L.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      const own = b.owner === null ? 'unclaimed' : b.owner;
      const capturing = b.capBy && (b.owner !== b.capBy) && (b.control < 100);
      const cls = `lbl ${own}${sel.body === b ? ' selected' : ''}${rp < 4 && dist > 900 ? ' far' : ''}`;
      if (L.el.className !== cls) L.el.className = cls;
      L.sel.setAttribute('r', (rp + 7).toFixed(1));
      const cr = rp + 11;
      L.cap.setAttribute('r', cr.toFixed(1));
      if (capturing || b.contested) {
        const circ = 2 * Math.PI * cr;
        const col = b.owner ? (FACTIONS[b.owner] || FACTIONS.neutral).css : FACTIONS[b.capBy].css;
        L.cap.style.stroke = col;
        L.cap.style.strokeDasharray = `${(circ * b.control / 100).toFixed(1)} ${circ.toFixed(1)}`;
        L.cap.style.display = '';
      } else L.cap.style.display = 'none';
      const off = `${(rp + 14).toFixed(0)}px`;
      L.tag.style.right = 'auto'; L.tag.style.left = off;
      L.cnt.style.left = off;
      const p = b.count?.player || 0, e = b.count?.enemy || 0;
      const txt = `${p ? `<span class="p">▲${p}</span>` : ''}${e ? `<span class="e">▲${e}</span>` : ''}${b.contested ? '<span class="alert">קרב</span>' : ''}`;
      if (txt !== L.last) { L.cnt.innerHTML = txt; L.last = txt; }
    }

    this.panelT -= dt;
    if (this.panelT <= 0) {
      this.panelT = 0.15;
      this.hud();
      this.renderPanel();
      this.renderSelection();
      this.tickHints(0.15);
    }
  }

  hud() {
    const { game } = this.app;
    const F = game.factions.player;
    $('#alloy').textContent = fmt(F.alloy);
    $('#rate').textContent = `+${F.income.toFixed(1)}/ש׳`;
    $('#worlds').textContent = `${game.bodyOf('player').length}/${game.bodies.length}`;
    let pp = 0, ep = 0, n = 0;
    for (const s of game.ships) { if (s.faction === 'player') { pp += power(s); n++; } else ep += power(s); }
    $('#fleet').textContent = n;
    $('#balance .p').style.flexGrow = (pp + 0.5).toFixed(2);
    $('#balance .e').style.flexGrow = (ep + 0.5).toFixed(2);
    $('#clock').textContent = mmss(game.time);
  }

  // ------------------------------------------------------------ planet panel
  renderPanel() {
    const { sel, game } = this.app;
    const panel = $('#panel');
    const b = sel.body;
    if (!b) { if (!panel.classList.contains('off')) panel.classList.add('off'); this.panelHTML = ''; return; }
    panel.classList.remove('off');
    const mine = b.owner === 'player';
    const F = game.factions.player;
    const ownCls = b.owner || 'none';
    let h = `<div class="ph"><span class="idx num">${String(b.idx + 1).padStart(2, '0')}/${game.bodies.length}</span>
      <h3>${b.name}</h3>
      <div class="sub"><span>${TYPE_NAME[b.type]}</span><span class="dim">·</span><span class="own ${ownCls}"><i></i>${OWNER_NAME[b.owner]}</span></div></div>`;

    const p = b.count?.player || 0, e = b.count?.enemy || 0;
    const ctrlCol = b.owner && FACTIONS[b.owner] ? FACTIONS[b.owner].css : b.capBy ? FACTIONS[b.capBy].css : 'var(--bone-3)';
    let state = 'יציב';
    if (b.contested) state = 'קרב במסלול';
    else if (b.capBy && b.owner !== b.capBy) state = b.owner ? `מנוטרל ע״י ${OWNER_NAME[b.capBy]}` : `נכבש ע״י ${OWNER_NAME[b.capBy]}`;
    h += `<div class="sec"><h4><span>מצב</span><span class="num">${state === 'יציב' ? '' : '!'}</span></h4>
      <div class="row"><span>תפוקה</span><span class="num">+${b.productionRate.toFixed(1)}/ש׳</span></div>
      <div class="row"><span>שליטה · ${state}</span><span class="num">${Math.round(b.control)}%</span></div>
      <div class="meter"><i style="width:${b.control.toFixed(1)}%;background:${ctrlCol}"></i></div>
      <div class="row" style="margin-top:6px"><span>במסלול</span><span class="num"><span style="color:var(--p)">${p}</span> / <span style="color:var(--e)">${e}</span></span></div>`;
    if (b.owner === 'neutral' && b.native) h += `<div class="row"><span>מיליציה מקומית</span><span class="num">${'▮'.repeat(b.native)}</span></div>`;
    if (b.structures.battery && b.owner && b.owner !== 'neutral') h += `<div class="row"><span>סוללת חוף</span><span class="num">פעילה</span></div>`;
    h += `</div>`;

    if (mine) {
      h += `<div class="sec"><h4><span>מבנים</span></h4>`;
      for (const s of STRUCT_LIST) {
        let st;
        if (b.structures[s.id]) st = `<span class="tick">פעיל</span>`;
        else if (b.building && b.building.id === s.id) {
          const pc = b.building.t / s.build;
          st = `<div class="prog">${Math.round(pc * 100)}%<div class="meter"><i style="width:${(pc * 100).toFixed(0)}%;background:var(--p)"></i></div></div>`;
        } else st = `<button class="btn" data-act="struct" data-id="${s.id}" ${b.building || F.alloy < s.cost ? 'disabled' : ''}>בנה · ${s.cost}</button>`;
        h += `<div class="struct"><span class="nm">${s.name}</span><span class="st">${st}</span><span class="bl">${s.blurb}</span></div>`;
      }
      h += `</div>`;
      if (b.structures.yard) {
        h += `<div class="sec"><h4><span>מספנה</span><span class="num">${b.queue.length}/6</span></h4><div class="yard">`;
        for (const [i, s] of SHIP_LIST.entries()) {
          h += `<button data-act="ship" data-cls="${s.id}" ${F.alloy < s.cost || b.queue.length >= 6 ? 'disabled' : ''}>
            <span class="k">${'ZXC'[i]}</span><b>${s.name}</b><span class="r">${s.role}</span><span class="c">${s.cost}</span></button>`;
        }
        h += `</div><div class="queue">`;
        if (!b.queue.length) h += `<span class="empty">התור ריק</span>`;
        b.queue.forEach((q, i) => {
          const pc = i === 0 ? q.t / SHIPS[q.cls].build : 0;
          h += `<button data-act="cancel" data-i="${i}" title="ביטול והחזר"><i style="width:${(pc * 100).toFixed(0)}%"></i><span>${SHIPS[q.cls].name}</span></button>`;
        });
        h += `</div><div class="counter-note"><b>צרעה</b><span>חודרת שריון מצודות</span><b>חנית</b><span>קוצרת צרעות</span><b>מצודה</b><span>שוברת חניתות</span></div></div>`;
      } else {
        h += `<div class="sec"><h4><span>מספנה</span></h4><div class="yard-note">אין מספנה בעולם זה. בנו אחת כדי לייצר ספינות קרוב לחזית.</div></div>`;
      }
    } else {
      h += `<div class="sec"><div class="yard-note">${b.owner === 'enemy'
        ? 'עולם של אופל. הביאו כוח שיגבר על הצי והסוללה שבמסלול, נטרלו את השליטה — ואז היא עוברת אליכם.'
        : 'בחרו ספינות וקליק ימני על העולם הזה. כשרק הצי שלכם במסלול, השליטה יורדת לאפס ואז נבנית מחדש לטובתכם.'}</div></div>`;
    }
    if (h !== this.panelHTML) { panel.innerHTML = h; this.panelHTML = h; }
  }

  onPanel(e) {
    const t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    const { sel, game, audio } = this.app;
    const b = sel.body; if (!b) return;
    if (t.dataset.act === 'ship') this.app.queueShip(t.dataset.cls);
    if (t.dataset.act === 'struct') { if (game.buildStructure(b, t.dataset.id, 'player')) audio.ui('confirm'); else audio.ui('deny'); }
    if (t.dataset.act === 'cancel') { game.cancelQueue(b, +t.dataset.i); audio.ui('tick'); }
    this.panelHTML = ''; this.renderPanel();
  }
  flashShip(cls) {
    const el = document.querySelector(`#panel [data-cls="${cls}"]`);
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }

  // ------------------------------------------------------------ selection strip
  renderSelection() {
    const { sel } = this.app;
    const box = $('#selection');
    const ships = [...sel.ships].filter((s) => !s.dead);
    if (!ships.length) { box.classList.add('off'); this.selHTML = ''; return; }
    box.classList.remove('off');
    const by = { corvette: [], frigate: [], dreadnought: [] };
    for (const s of ships) by[s.cls].push(s);
    let h = `<div class="n"><b class="num">${ships.length}</b><label>נבחרו</label></div>`;
    for (const def of SHIP_LIST) {
      const L = by[def.id];
      const hp = L.length ? L.reduce((a, s) => a + s.hp / s.maxHp, 0) / L.length : 0;
      h += `<button class="cls ${L.length ? '' : 'zero'}" data-cls="${def.id}" title="השאר רק ${def.name}">
        <span class="num">${L.length}</span><span>${def.name}</span><span class="hp"><i style="width:${(hp * 100).toFixed(0)}%"></i></span></button>`;
    }
    h += `<div class="how"><span><b>קליק ימני</b> על עולם — שיגור</span><span><b>קליק ימני</b> בחלל — עמדה</span></div>`;
    if (h !== this.selHTML) { box.innerHTML = h; this.selHTML = h; }
  }

  // ------------------------------------------------------------ log
  log(text, kind = '') {
    const ol = $('#log');
    const li = document.createElement('li');
    li.className = kind;
    li.innerHTML = `<span class="num">${mmss(this.app.game.time)}</span><span>${text}</span>`;
    ol.appendChild(li);
    while (ol.children.length > 6) ol.firstChild.remove();
    setTimeout(() => li.classList.add('old'), 9000);
  }

  // ------------------------------------------------------------ tutorial
  startHints() { this.hintStep = 0; this.showHint(); }
  showHint() {
    const H = HINTS[this.hintStep];
    const el = $('#hint');
    if (!H) { el.classList.add('off'); return; }
    el.classList.remove('off');
    el.innerHTML = `<span class="step num">${String(this.hintStep + 1).padStart(2, '0')} / ${String(HINTS.length).padStart(2, '0')}</span>${H.text}<button title="הבא">✕</button>`;
    this.hintT = 0;
  }
  nextHint() { if (this.hintStep < 0) return; this.hintStep++; this.showHint(); }
  flag(name) { this.flags[name] = true; }
  tickHints(dt) {
    const H = HINTS[this.hintStep]; if (!H) return;
    this.hintT += dt;
    if (H.done(this.flags, this.hintT)) this.nextHint();
  }
}

const HINTS = [
  { text: 'שַׁחַר הוא עולם הבית שלכם. קליק עליו כדי לבחור אותו ואת הצי שבמסלולו.', done: (f) => f.selectHome },
  { text: 'עכשיו קליק ימני על עולם סמוך — עֲרָבָה או כּוּר. הצי ייצא, ינטרל את המיליציה המקומית ויכבוש.', done: (f) => f.ordered },
  { text: 'כל עולם מייצר סגסוגת. בחרו את שחר ובנו ספינות במספנה — המקשים Z, X, C.', done: (f) => f.queued },
  { text: 'צרעות שוברות מצודות, חניתות קוצרות צרעות, מצודות מפרקות חניתות. אופל קורא את הצי שלכם ובונה נגדו.', done: (f, t) => t > 16 },
  { text: 'מכרה מגדיל תפוקה, סוללה מגינה על המסלול, ומספנה נוספת מקצרת את הדרך לחזית. רווח — עצירה טקטית.', done: (f, t) => t > 16 },
];
