import * as THREE from 'three';
import { SHIPS, SHIP_LIST, STRUCT_LIST, FACTIONS } from './data.js';
import { power } from './ai.js';
import { TOUCH } from './quality.js';

const TYPE_NAME = ['עולם ממוזג', 'עולם צחיח', 'עולם קפוא', 'עולם מותך', 'ענק גזים'];
const OWNER_NAME = { player: 'המשמרת', enemy: 'אופל', neutral: 'מתיישבים', null: 'ללא שליטה' };
const LATIN = { shahar: 'SHAHAR', ofel: 'OFEL', kur: 'KUR', remetz: 'REMETZ', arava: 'ARAVA', yaara: 'YAARA', tarshish: 'TARSHISH', metzula: 'METZULA', gilad: 'GILAD', kidron: 'KIDRON', levana: 'LEVANA', agur: 'AGUR', even: 'EVEN SHEKET', zohar: 'ZOHAR' };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const $ = (s) => document.querySelector(s);
const fmt = (n) => Math.floor(n).toLocaleString('en-US');
const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const _v = new THREE.Vector3();

export const EMBLEM = {
  player: `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="20" cy="20" r="18"/><path d="M20 5.5 Q32 20 20 34.5 Q8 20 20 5.5Z"/><circle cx="20" cy="20" r="3.2" fill="currentColor" stroke="none"/><path d="M20 0v4M20 36v4M0 20h4M36 20h4" stroke-width="1"/></svg>`,
  enemy: `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="20" cy="20" r="18"/><path d="M25 8.5 A12 12 0 1 0 25 31.5 A9.5 9.5 0 1 1 25 8.5Z" fill="currentColor" stroke="none"/><path d="M2 20h7M31 20h7" stroke-width="1"/></svg>`,
};
const ICON = {
  yard: `<svg viewBox="0 0 24 24"><path d="M3 21V5h18v16M3 9h18M8 5v16M16 5v16M8 13l8 4"/></svg>`,
  mine: `<svg viewBox="0 0 24 24"><path d="M12 2v12M8 10l4 4 4-4M2 17h20M5 21h3M10.5 21h3M16 21h3"/></svg>`,
  battery: `<svg viewBox="0 0 24 24"><circle cx="12" cy="15" r="5"/><path d="M12 10V2M9.5 4h5M6 22h12"/></svg>`,
};

export class UI {
  constructor(app) {
    this.app = app;
    this.labels = [];
    this.t = 0;
    this.dzKey = '';
    this.fleetKey = '';
    this.tut = -1;
    this.tutT = 0;
    this.flags = {};
    this.lastFlareShown = -1;

    document.querySelectorAll('[data-emblem]').forEach((el) => (el.innerHTML = EMBLEM[el.dataset.emblem]));

    const root = $('#labels');
    root.innerHTML = '';
    for (const b of app.bodies) {
      const el = document.createElement('div');
      el.className = 'lbl';
      el.innerHTML = `<svg width="1" height="1"><circle class="sel" cx="0" cy="0" r="10"/><circle class="cap2" cx="0" cy="0" r="14" transform="rotate(-90)"/></svg>
        <div class="tag"><i></i><b>${b.name}</b><span class="num">+${b.prod}</span></div><div class="cnt"></div>`;
      root.appendChild(el);
      this.labels.push({ el, b, sel: el.querySelector('.sel'), cap: el.querySelector('.cap2'), tag: el.querySelector('.tag'), cnt: el.querySelector('.cnt'), last: '', cls: '' });
    }

    // orbital index for the dossier
    const radii = [...new Set(app.bodies.filter((b) => !b.parentBody).map((b) => b.orbit))].sort((a, c) => a - c);
    for (const b of app.bodies) b.roman = b.parentBody ? `${ROMAN[radii.indexOf(b.parentBody.orbit)]}·${b.idx % 2 ? 'b' : 'a'}` : ROMAN[radii.indexOf(b.orbit)];
    // dominion strip in orbital order
    this.domOrder = [...app.bodies].sort((a, c) => (a.parentBody ? a.parentBody.orbit + 1 : a.orbit) - (c.parentBody ? c.parentBody.orbit + 1 : c.orbit) || a.phase - c.phase);
    $('#dom-bars').innerHTML = this.domOrder.map((b) => `<i title="${b.name}" class="${b.parentBody ? 'moon' : ''}"></i>`).join('');
    this.domEls = [...document.querySelectorAll('#dom-bars i')];

    // orrery
    this.orr = $('#orrery canvas');
    this.orr.width = this.orr.height = 220 * Math.min(2, devicePixelRatio || 1);
    this.octx = this.orr.getContext('2d');
    const jump = (e) => {
      const r = this.orr.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2 * ORR_RANGE;
      const z = ((e.clientY - r.top) / r.height - 0.5) * 2 * ORR_RANGE;
      app.panTo(x, z);
    };
    let orrDown = false;
    this.orr.addEventListener('pointerdown', (e) => { orrDown = true; this.orr.setPointerCapture(e.pointerId); jump(e); e.stopPropagation(); });
    this.orr.addEventListener('pointermove', (e) => { if (orrDown) jump(e); });
    this.orr.addEventListener('pointerup', () => (orrDown = false));

    $('#dossier').addEventListener('click', (e) => this.onDossier(e));
    $('#fleet').addEventListener('click', (e) => {
      if (e.target.closest('.x')) { app.deselect(); return; }
      const c = e.target.closest('[data-cls]'); if (c) app.filterSelection(c.dataset.cls);
    });
    $('#comms').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const m = b.closest('.msg');
      const fn = m && m._acts && m._acts[+b.dataset.act];
      if (fn) fn();
      this.dismiss(m);
    });
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const { camera, sel } = this.app;
    const W = innerWidth, H = innerHeight;
    const k = (H / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const hover = this.app.sendHover;
    for (const L of this.labels) {
      const b = L.b;
      _v.copy(b.pos).project(camera);
      const dist = camera.position.distanceTo(b.pos);
      if (_v.z > 1 || Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) { if (L.el.style.display !== 'none') L.el.style.display = 'none'; continue; }
      if (L.el.style.display) L.el.style.display = '';
      const x = (_v.x + 1) / 2 * W, y = (1 - _v.y) / 2 * H;
      const rp = Math.max(3, b.r * k / dist);
      L.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      const own = b.owner === null ? 'null' : b.owner;
      const isTarget = hover === b || (sel.body === b && sel.ships.size && ![...sel.ships].some((s) => s.host === b));
      const cls = `lbl ${own}${sel.body === b ? ' selected' : ''}${isTarget ? ' target' : ''}${rp < 4 && dist > 900 ? ' far' : ''}`;
      if (L.cls !== cls) { L.el.className = cls; L.cls = cls; }
      L.sel.setAttribute('r', (rp + 7).toFixed(1));
      const cr = rp + 11;
      L.cap.setAttribute('r', cr.toFixed(1));
      const capturing = b.capBy && b.owner !== b.capBy && b.control < 100;
      if (capturing || b.contested) {
        const circ = 2 * Math.PI * cr;
        L.cap.style.stroke = b.owner ? (FACTIONS[b.owner] || FACTIONS.neutral).css : FACTIONS[b.capBy].css;
        L.cap.style.strokeDasharray = `${(circ * b.control / 100).toFixed(1)} ${circ.toFixed(1)}`;
        L.cap.style.display = '';
      } else if (L.cap.style.display !== 'none') L.cap.style.display = 'none';
      const off = `${(rp + 14).toFixed(0)}px`;
      L.tag.style.left = off; L.cnt.style.left = off;
      const p = b.count?.player || 0, e = b.count?.enemy || 0;
      const txt = `${p ? `<span class="p">◆${p}</span>` : ''}${e ? `<span class="e">◆${e}</span>` : ''}${b.contested ? '<span class="alert">קרב</span>' : ''}`;
      if (txt !== L.last) { L.cnt.innerHTML = txt; L.last = txt; }
    }
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.12;
      this.hud();
      this.orrery();
      this.dossier();
      this.fleet();
      this.tickTutorial(0.12);
    }
  }

  hud() {
    const { game } = this.app;
    const F = game.factions.player;
    $('#alloy').textContent = fmt(F.alloy);
    $('#rate').textContent = `+${F.income.toFixed(1)}`;
    let pp = 0, ep = 0;
    for (const s of game.ships) { if (s.faction === 'player') pp += power(s); else ep += power(s); }
    $('#dom-power .p').style.flexGrow = (pp + 0.5).toFixed(2);
    $('#dom-power .e').style.flexGrow = (ep + 0.5).toFixed(2);
    $('#dom-p').textContent = game.bodyOf('player').length;
    $('#dom-e').textContent = game.bodyOf('enemy').length;
    this.domOrder.forEach((b, i) => {
      const c = `${b.parentBody ? 'moon ' : ''}${b.owner === null ? 'null' : b.owner}${b.contested || (b.underAttack > 0 && b.owner === 'player') ? ' hot' : ''}`;
      if (this.domEls[i].className !== c) this.domEls[i].className = c;
    });
    $('#clock').textContent = mmss(game.time);
    const fl = $('#flare');
    const left = game.flareIn;
    if (left != null && left < 30 && left > 0) { fl.classList.remove('off'); $('#flare-t').textContent = String(Math.ceil(left)).padStart(2, '0'); }
    else fl.classList.add('off');
  }

  // ------------------------------------------------------------ orrery
  orrery() {
    const { game, bodies, camera, rig } = this.app;
    const c = this.octx, S = this.orr.width, h = S / 2, s = h / ORR_RANGE;
    c.clearRect(0, 0, S, S);
    c.save();
    c.fillStyle = 'rgba(6,7,10,0.72)';
    c.beginPath(); c.arc(h, h, h - 1, 0, 6.2832); c.fill();
    c.strokeStyle = 'rgba(236,230,214,0.22)'; c.lineWidth = S / 220;
    c.stroke();
    // tick ring
    for (let i = 0; i < 72; i++) {
      const a = i / 72 * 6.2832, r1 = h - 2, r2 = h - (i % 6 ? 5 : 10) * S / 220;
      c.beginPath(); c.moveTo(h + Math.cos(a) * r1, h + Math.sin(a) * r1); c.lineTo(h + Math.cos(a) * r2, h + Math.sin(a) * r2); c.stroke();
    }
    c.strokeStyle = 'rgba(236,230,214,0.1)';
    const rings = new Set();
    for (const b of bodies) if (!b.parentBody && !rings.has(b.orbit)) { rings.add(b.orbit); c.beginPath(); c.arc(h, h, b.orbit * s, 0, 6.2832); c.stroke(); }
    c.setLineDash([1, 3 * S / 220]); c.strokeStyle = 'rgba(200,170,130,0.22)';
    c.beginPath(); c.arc(h, h, 267 * s, 0, 6.2832); c.stroke(); c.setLineDash([]);
    // star
    const g = c.createRadialGradient(h, h, 0, h, h, 12 * S / 220);
    g.addColorStop(0, 'rgba(255,220,170,1)'); g.addColorStop(0.35, 'rgba(255,150,60,0.8)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    c.fillStyle = g; c.beginPath(); c.arc(h, h, 12 * S / 220, 0, 6.2832); c.fill();
    // ships
    for (const sh of game.ships) {
      c.fillStyle = sh.faction === 'player' ? 'rgba(255,176,74,0.9)' : 'rgba(124,200,240,0.9)';
      const q = sh.cls === 'dreadnought' ? 2.4 : 1.4;
      c.fillRect(h + sh.pos.x * s - q / 2 * S / 220, h + sh.pos.z * s - q / 2 * S / 220, q * S / 220, q * S / 220);
    }
    // worlds
    const blink = (performance.now() / 400 | 0) % 2;
    for (const b of bodies) {
      const x = h + b.pos.x * s, y = h + b.pos.z * s, r = Math.max(2.4, Math.min(5.5, b.r * 0.4)) * S / 220;
      c.fillStyle = b.owner === 'player' ? '#ffb04a' : b.owner === 'enemy' ? '#7cc8f0' : b.owner === 'neutral' ? '#8b8a84' : 'rgba(0,0,0,0)';
      c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
      if (b.owner === null) { c.strokeStyle = 'rgba(236,230,214,0.7)'; c.lineWidth = S / 220; c.stroke(); }
      if ((b.contested || b.underAttack > 0) && blink) { c.strokeStyle = '#ff5b3a'; c.lineWidth = 1.5 * S / 220; c.beginPath(); c.arc(x, y, r + 3 * S / 220, 0, 6.2832); c.stroke(); }
      if (this.app.sel.body === b) { c.strokeStyle = '#ece6d6'; c.lineWidth = S / 220; c.beginPath(); c.arc(x, y, r + 5 * S / 220, 0, 6.2832); c.stroke(); }
    }
    // camera footprint
    const tx = h + rig.target.x * s, tz = h + rig.target.z * s;
    const fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw);
    const spread = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const reach = Math.min(rig.dist * 1.1, ORR_RANGE * 1.4) * s;
    c.strokeStyle = 'rgba(236,230,214,0.55)'; c.lineWidth = S / 220;
    c.beginPath();
    const cx = tx - fx * rig.dist * Math.cos(rig.pitch) * s, cz = tz - fz * rig.dist * Math.cos(rig.pitch) * s;
    for (const sg of [-1, 1]) {
      const a = Math.atan2(fz, fx) + sg * spread;
      c.moveTo(cx, cz); c.lineTo(cx + Math.cos(a) * reach, cz + Math.sin(a) * reach);
    }
    c.stroke();
    c.fillStyle = '#ece6d6'; c.fillRect(tx - 1.5 * S / 220, tz - 1.5 * S / 220, 3 * S / 220, 3 * S / 220);
    c.restore();
  }

  // ------------------------------------------------------------ world dossier
  dossier() {
    const { sel, game } = this.app;
    const el = $('#dossier');
    const b = sel.body;
    if (!b) { if (!el.classList.contains('off')) { el.classList.add('off'); document.body.classList.remove('sheet'); } this.dzKey = ''; return; }
    el.classList.remove('off');
    document.body.classList.add('sheet');
    const F = game.factions.player;
    const mine = b.owner === 'player';
    const away = [...sel.ships].filter((s) => !s.dead && s.host !== b && !(s.order && s.order.body === b));
    const afford = (c) => F.alloy >= c ? 1 : 0;
    const key = [b.idx, b.owner, mine && STRUCT_LIST.map((s) => `${b.structures[s.id]}${b.building?.id === s.id}${afford(s.cost)}`).join(), !!b.building,
      mine && b.structures.yard && SHIP_LIST.map((s) => afford(s.cost)).join() + b.queue.map((q) => q.cls).join(), away.length, b.native, b.structures.battery].join('|');
    if (key !== this.dzKey) { this.dzKey = key; el.innerHTML = this.dossierHTML(b, away); el.className = b.owner || 'none'; }
    this.dossierLive(b);
  }
  dossierHTML(b, away) {
    const { game, portraits } = this.app;
    const F = game.factions.player;
    const mine = b.owner === 'player';
    const own = b.owner === null ? 'null' : b.owner;
    let h = `<div class="dz-grip"></div><button class="dz-close" data-act="close" aria-label="סגור">✕</button>
      <div class="dz-head"><div class="dz-meta"><span class="num">מסלול ${b.roman}</span><span>·</span><span>${TYPE_NAME[b.type]}</span><span class="own ${own}"><i></i>${OWNER_NAME[b.owner]}</span></div>
      <div class="dz-name"><h3>${b.name}</h3><span class="lat">${LATIN[b.key] || ''}</span></div></div>
      <div class="dz-stats"><div><span class="cap">תפוקה</span><b data-v="prod"></b></div><div><span class="cap">צי שלך</span><b class="p" data-v="pc"></b></div><div><span class="cap">צי אופל</span><b class="e" data-v="ec"></b></div></div>
      <div class="ruler"><div class="lab"><span data-v="state"></span><span class="num" data-v="ctrl"></span></div><div class="track"><div class="fill"></div></div></div>`;
    if (away.length && !mine) {
      h += `<div class="dz-sec"><button class="cta" data-act="send"><span>שגר ${away.length} ספינות לכאן</span><span class="num">→</span></button></div>`;
    }
    if (mine) {
      h += `<div class="dz-sec"><h4><span>מבנים</span></h4><div class="structs">`;
      for (const s of STRUCT_LIST) {
        const built = b.structures[s.id], building = b.building && b.building.id === s.id;
        const dis = built || building || b.building || F.alloy < s.cost;
        h += `<button class="${built ? 'built' : ''}" data-act="struct" data-id="${s.id}" ${dis ? 'disabled' : ''}>${ICON[s.id]}<span class="nm">${s.name}</span><span class="bl">${s.blurb}</span>
          <span class="st" ${building ? `data-v="sb"` : ''}>${built ? 'פעיל' : building ? '' : s.cost}</span>${building ? '<i class="bar" data-v="sbar"></i>' : ''}</button>`;
      }
      h += `</div></div>`;
      if (b.structures.yard) {
        h += `<div class="dz-sec"><h4><span>מספנה</span><span class="num">${b.queue.length}/6</span></h4><div class="yard">`;
        SHIP_LIST.forEach((s, i) => {
          h += `<button data-act="ship" data-cls="${s.id}" ${F.alloy < s.cost || b.queue.length >= 6 ? 'disabled' : ''}>
            ${TOUCH ? '' : `<span class="k">${'ZXC'[i]}</span>`}${portraits[s.id] ? `<img src="${portraits[s.id]}" alt="">` : ''}
            <b>${s.name}</b><span class="r">${s.role}</span><span class="c"><span>${s.cost}</span><span>${s.build}ש׳</span></span></button>`;
        });
        h += `</div><div class="queue">`;
        if (!b.queue.length) h += `<span class="empty">התור ריק — בחרו ספינה לבנייה</span>`;
        b.queue.forEach((q, i) => {
          h += `<button data-act="cancel" data-i="${i}" title="ביטול והחזר">${portraits[q.cls] ? `<img src="${portraits[q.cls]}" alt="">` : SHIPS[q.cls].name}${i === 0 ? '<i data-v="qbar"></i>' : ''}</button>`;
        });
        h += `</div><div class="counter"><b>צרעה</b>›<b>מצודה</b>›<b>חנית</b>›<b>צרעה</b></div></div>`;
      } else {
        h += `<div class="dz-sec"><p class="dz-note">אין מספנה בעולם הזה. בנו אחת כדי לייצר ספינות קרוב לחזית.</p></div>`;
      }
    } else {
      let note;
      if (b.owner === 'enemy') note = 'עולם של אופל. הביאו כוח שיגבר על הצי <b>והסוללה</b> שבמסלול. כשרק הספינות שלכם נשארות, השליטה יורדת לאפס ואז עוברת אליכם.';
      else if (b.owner === 'neutral') note = `מתיישבים עצמאיים${b.native ? ` עם מיליציה (${'◆'.repeat(b.native)})` : ''}. שגרו ספינות למסלול — הן ינטרלו את ההגנה ויכבשו.`;
      else note = 'עולם ללא שליטה. הצי הראשון שיחזיק במסלול לבדו — יקבל אותו.';
      h += `<div class="dz-sec"><p class="dz-note">${note}</p>${!away.length ? `<p class="dz-note" style="margin-top:8px;color:var(--bone-3)">${TOUCH ? 'גררו מעולם שיש בו ספינות שלכם אל העולם הזה כדי לשגר.' : 'בחרו ספינות וקליק ימני כאן, או גררו אליו מעולם שלכם.'}</p>` : ''}</div>`;
    }
    return h;
  }
  dossierLive(b) {
    const el = $('#dossier');
    const set = (k, v) => { const n = el.querySelector(`[data-v="${k}"]`); if (n && n.innerHTML !== v) n.innerHTML = v; };
    set('prod', `${b.productionRate.toFixed(1)}<span class="u">/ש׳</span>`);
    set('pc', String(b.count?.player || 0));
    set('ec', String(b.count?.enemy || 0));
    let state = 'יציב';
    if (b.contested) state = 'קרב במסלול';
    else if (b.capBy && b.owner !== b.capBy) state = b.owner ? `מנוטרל בידי ${OWNER_NAME[b.capBy]}` : `נכבש בידי ${OWNER_NAME[b.capBy]}`;
    set('state', `שליטה · ${state}`);
    set('ctrl', `${Math.round(b.control)}%`);
    const r = el.querySelector('.ruler');
    if (r) {
      r.classList.toggle('alarm', state !== 'יציב');
      const f = r.querySelector('.fill');
      f.style.width = `${b.control.toFixed(1)}%`;
      f.style.background = b.owner && FACTIONS[b.owner] ? FACTIONS[b.owner].css : b.capBy ? FACTIONS[b.capBy].css : 'var(--bone-3)';
    }
    if (b.building) {
      const pc = b.building.t / STRUCT_LIST.find((s) => s.id === b.building.id).build;
      set('sb', `${Math.round(pc * 100)}%`);
      const bar = el.querySelector('[data-v="sbar"]'); if (bar) bar.style.width = `${(pc * 100).toFixed(0)}%`;
    }
    if (b.queue.length) {
      const q = el.querySelector('[data-v="qbar"]');
      if (q) q.style.width = `${(b.queue[0].t / SHIPS[b.queue[0].cls].build * 100).toFixed(0)}%`;
    }
  }
  onDossier(e) {
    const t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    const { sel, game, audio } = this.app;
    const b = sel.body; if (!b) return;
    const act = t.dataset.act;
    if (act === 'close') { sel.body = null; audio.ui('tick'); }
    if (act === 'send') this.app.dispatchTo(b);
    if (act === 'ship') this.app.queueShip(t.dataset.cls);
    if (act === 'struct') {
      if (game.buildStructure(b, t.dataset.id, 'player')) { audio.ui('confirm'); this.flag('structure'); } else { audio.ui('deny'); this.deny(); }
    }
    if (act === 'cancel') { game.cancelQueue(b, +t.dataset.i); audio.ui('tick'); }
    this.dzKey = ''; this.dossier();
  }
  flashShip(cls) {
    const el = document.querySelector(`#dossier [data-cls="${cls}"]`);
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
  deny() { const c = $('#command'); c.classList.remove('deny'); void c.offsetWidth; c.classList.add('deny'); }

  // ------------------------------------------------------------ fleet bar
  fleet() {
    const { sel, portraits } = this.app;
    const box = $('#fleet');
    const ships = [...sel.ships].filter((s) => !s.dead);
    if (!ships.length) { if (!box.classList.contains('off')) { box.classList.add('off'); document.body.classList.remove('fleetbar'); } this.fleetKey = ''; return; }
    box.classList.remove('off');
    document.body.classList.add('fleetbar');
    const by = { corvette: [], frigate: [], dreadnought: [] };
    for (const s of ships) by[s.cls].push(s);
    const key = ships.length + SHIP_LIST.map((d) => by[d.id].length + ':' + Math.round(by[d.id].reduce((a, s) => a + s.hp / s.maxHp, 0) * 10)).join();
    if (key === this.fleetKey) return;
    this.fleetKey = key;
    let h = `<div class="n"><b>${ships.length}</b><span class="cap">ספינות</span></div>`;
    for (const def of SHIP_LIST) {
      const L = by[def.id];
      const hp = L.length ? L.reduce((a, s) => a + s.hp / s.maxHp, 0) / L.length : 0;
      h += `<button class="cls ${L.length ? '' : 'zero'}" data-cls="${def.id}" title="השאר רק ${def.name}">${portraits[def.id] ? `<img src="${portraits[def.id]}" alt="">` : ''}
        <span class="row"><span>${def.name}</span><span class="num">${L.length}</span></span><span class="hp"><i style="width:${(hp * 100).toFixed(0)}%"></i></span></button>`;
    }
    h += TOUCH ? '' : `<div class="how"><span><b>קליק ימני</b> על עולם או בחלל — שיגור</span><span><b>גרירה</b> מעולם לעולם — שיגור מהיר</span></div>`;
    h += `<button class="x" aria-label="ביטול בחירה">✕</button>`;
    box.innerHTML = h;
  }

  // ------------------------------------------------------------ transmissions
  say(text, { from = 'מפקדת המשמרת', kind = '', acts = [], ttl = 9 } = {}) {
    const box = $('#comms');
    const m = document.createElement('div');
    m.className = `msg ${kind}`;
    m.innerHTML = `<div class="from"><span>${from}</span><span class="num">${mmss(this.app.game.time)}</span></div><p>${text}</p>${acts.length ? `<div class="acts">${acts.map((a, i) => `<button data-act="${i}">${a.label}</button>`).join('')}</div>` : ''}`;
    m._acts = acts.map((a) => a.fn);
    box.appendChild(m);
    const max = innerWidth < 760 ? 2 : 4;
    while (box.children.length > max) box.firstChild.remove();
    if (ttl) setTimeout(() => this.dismiss(m), ttl * 1000);
    return m;
  }
  dismiss(m) { if (!m || m._gone) return; m._gone = true; m.classList.add('gone'); setTimeout(() => m.remove(), 800); }

  // ------------------------------------------------------------ tutorial
  startTutorial() { this.tut = 0; this.showTut(); }
  showTut() {
    if (this.tutMsg) this.dismiss(this.tutMsg);
    const T = TUT[this.tut];
    if (!T) { this.tutMsg = null; return; }
    this.tutT = 0;
    this.tutMsg = this.say(TOUCH ? T.touch : T.mouse, { from: `הדרכה · ${this.tut + 1}/${TUT.length}`, kind: 'tut', ttl: 0, acts: [{ label: this.tut < TUT.length - 1 ? 'הבא' : 'הבנתי', fn: () => this.nextTut() }] });
  }
  nextTut() { if (this.tut < 0) return; this.tut++; this.showTut(); }
  flag(name) { this.flags[name] = true; }
  tickTutorial(dt) {
    const T = TUT[this.tut]; if (!T) return;
    this.tutT += dt;
    if (T.done(this.flags, this.tutT)) this.nextTut();
  }
}

const ORR_RANGE = 600;

const TUT = [
  { mouse: 'שַׁחַר הוא עולם הבית שלכם. קליק עליו בוחר אותו ואת הצי שבמסלולו.', touch: 'שַׁחַר הוא עולם הבית שלכם. געו בו כדי לבחור אותו ואת הצי שבמסלולו.', done: (f) => f.selectHome },
  { mouse: 'גררו מִשַּׁחַר אל עולם סמוך — עֲרָבָה או כּוּר — או קליק ימני עליו. הצי ינטרל את המיליציה ויכבוש.', touch: 'גררו באצבע מִשַּׁחַר אל עולם סמוך — עֲרָבָה או כּוּר. הצי ינטרל את המיליציה ויכבוש.', done: (f) => f.ordered },
  { mouse: 'כל עולם מייצר סגסוגת. בכרטיס של שחר בנו ספינות במספנה — או המקשים Z, X, C.', touch: 'כל עולם מייצר סגסוגת. געו בשחר ובנו ספינות במספנה שבכרטיס.', done: (f) => f.queued },
  { mouse: 'צרעות שוברות מצודות, חניתות קוצרות צרעות, מצודות מפרקות חניתות. אופל קורא את הצי שלכם ובונה נגדו.', touch: 'צרעות שוברות מצודות, חניתות קוצרות צרעות, מצודות מפרקות חניתות. אופל קורא את הצי שלכם ובונה נגדו.', done: (f, t) => t > 18 },
  { mouse: 'הגחלת מתפרצת כל כמה דקות ושורפת כל מה שקרוב אליה. כשהשעון האדום מופיע — הרחיקו ציים מהמרכז. רווח עוצר את הזמן.', touch: 'הגחלת מתפרצת כל כמה דקות ושורפת כל מה שקרוב אליה. כשהשעון האדום מופיע — הרחיקו ציים מהמרכז.', done: (f, t) => t > 20 },
];
