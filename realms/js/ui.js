import * as THREE from 'three';
const $ = id => document.getElementById(id);
const fmtT = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class UI {
  constructor(touch) {
    this.touch = touch; this.pops = []; this.dlg = null; this.tmp = new THREE.Vector3();
    this.toastT = 0;
  }
  boot() { $('loading').classList.remove('hide'); $('ld-num').textContent = ''; $('ld-name').textContent = 'ממלכות אֶתֶרְיָה'; $('ld-lore').textContent = 'טוען את העולם...'; }
  error(e) { $('ld-lore').textContent = 'שגיאה בטעינה: ' + (e && e.message || e); }
  loading(show, def, menu) {
    const el = $('loading');
    if (show) { el.classList.remove('hide', 'out'); $('ld-num').textContent = menu ? '' : 'פרק ' + def.num; $('ld-name').textContent = menu ? 'ממלכות אֶתֶרְיָה' : def.name; $('ld-lore').textContent = menu ? 'חמש ממלכות. לב אחד מנופץ.' : def.lore; this.progress(0); this.hud(false); }
    else { el.classList.add('out'); setTimeout(() => el.classList.add('hide'), 900); }
  }
  progress(p) { $('ld-bar').style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`; }
  // ---- menus
  onMenu(h) {
    this.h = h;
    $('m-start').onclick = () => this.h.start(0);
    $('m-continue').onclick = () => { const c = this.h.chapters(); this.h.start(c.unlocked); };
    $('m-chapters').onclick = () => this.chapters(true);
    $('m-quality').onclick = () => this.h.quality();
    $('m-sound').onclick = () => { const on = this.h.sound(); $('m-sound').querySelector('b').textContent = on ? 'פועל' : 'כבוי'; };
    $('ch-back').onclick = () => this.chapters(false);
    $('p-resume').onclick = () => this.h.resume();
    $('p-restart').onclick = () => this.h.restart();
    $('p-sound').onclick = () => { const on = this.h.sound(); $('p-sound').querySelector('b').textContent = on ? 'פועל' : 'כבוי'; };
    $('p-quality').onclick = () => this.h.quality();
    $('p-menu').onclick = () => this.h.toMenu();
    $('d-retry').onclick = () => this.h.respawn();
    $('c-next').onclick = () => this.h.next();
    $('e-again').onclick = () => this.h.credits();
  }
  menu(show, hasProgress) {
    $('menu').classList.toggle('hide', !show);
    if (show) { $('m-continue').classList.toggle('hide', !hasProgress); $('m-quality').querySelector('b').textContent = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' }[this.h.qualityName()]; }
  }
  chapters(show) {
    $('m-list').classList.toggle('hide', show); $('chapters').classList.toggle('hide', !show);
    if (!show) return;
    const c = this.h.chapters(), box = $('ch-rows'); box.innerHTML = '';
    c.list.forEach((d, i) => {
      const locked = i > c.unlocked, row = document.createElement('button'); row.className = 'ch-row' + (locked ? ' locked' : '');
      row.innerHTML = `<span class="ch-num">${d.num}</span><span class="ch-txt"><b>${d.name}</b><i>${d.genre}</i></span><span class="ch-rank">${locked ? 'נעול' : (c.ranks[i] ? 'דרגה ' + c.ranks[i] : '')}</span>`;
      if (!locked) row.onclick = () => { this.chapters(false); this.h.start(i); };
      box.appendChild(row);
    });
  }
  pause(show, q) { $('pause').classList.toggle('hide', !show); if (show) $('p-quality').querySelector('b').textContent = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' }[q]; }
  death(show) { $('death').classList.toggle('hide', !show); }
  clear(i) {
    $('clear').classList.remove('hide');
    $('c-num').textContent = 'פרק ' + i.def.num + ' הושלם'; $('c-name').textContent = i.def.name; $('c-rank').textContent = i.rank;
    $('c-stats').innerHTML = [['זמן', fmtT(i.time)], ['אויבים שהובסו', i.kills], ['הרצף הגבוה', i.combo], ['רסיסי אור', `${i.motes} / ${i.total}`], ['נזק שספגת', Math.round(i.dmg)]].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
    $('c-next').querySelector('span').textContent = i.last ? 'אל האפילוג' : 'לפרק הבא';
  }
  clearHide() { $('clear').classList.add('hide'); }
  ending(run) { $('ending').classList.remove('hide'); }
  // ---- HUD
  hud(show) { $('hud').classList.toggle('hide', !show); }
  chapterCard(def) {
    const el = $('card'); $('cd-num').textContent = 'פרק ' + def.num; $('cd-name').textContent = def.name; $('cd-genre').textContent = def.genre;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    this.motes(0, 0);
  }
  objective(text, prog) {
    const el = $('objective'); $('ob-text').textContent = text; $('ob-prog').textContent = prog || '';
    el.classList.remove('new'); void el.offsetWidth; el.classList.add('new');
  }
  objectiveProgress(p) { if ($('ob-prog').textContent !== p) $('ob-prog').textContent = p; }
  stats(h) {
    $('hp-fill').style.transform = `scaleX(${h.hp / h.maxHp})`; $('hp-lag').style.transform = `scaleX(${(this.hpLag = Math.max(h.hp / h.maxHp, (this.hpLag ?? 1) - 0.006))})`;
    $('mp-fill').style.transform = `scaleX(${h.mp / h.maxMp})`; $('en-fill').style.transform = `scaleX(${h.energy / 100})`;
    $('vitals').classList.toggle('full', h.energy >= 100); document.body.classList.toggle('special-ready', h.energy >= 100);
    $('b-magic').classList.toggle('dim', h.mp < 22);
  }
  motes(n, total) { $('motes').textContent = total ? `${n} / ${total}` : ''; $('motes-w').classList.toggle('hide', !total); if (n) { const el = $('motes-w'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); } }
  boss(name, frac) {
    const el = $('bossbar'); if (!name) { el.classList.add('hide'); return; }
    el.classList.remove('hide'); $('bb-name').textContent = name; $('bb-fill').style.transform = `scaleX(${Math.max(0, frac)})`;
    this.bossLag = Math.max(frac, (this.bossLag ?? 1) - 0.004); $('bb-lag').style.transform = `scaleX(${this.bossLag})`;
  }
  combo(n) { const el = $('combo'); if (n < 2) { el.classList.remove('on'); return; } $('cb-n').textContent = n; el.classList.add('on'); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
  prompt(label) {
    if (label === this.lastPrompt) return; this.lastPrompt = label;
    $('prompt').classList.toggle('hide', !label); $('b-use').classList.toggle('hide', !label);
    if (label) $('pr-text').textContent = label;
  }
  toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(this.tt); this.tt = setTimeout(() => el.classList.remove('show'), 2600); }
  compass(yaw, hp, marker, portal) {
    const W = 460, el = $('cmp-strip');
    if (!this.cmpBuilt) {
      this.cmpBuilt = true; const dirs = [['צ', 0], ['מז', 90], ['ד', 180], ['מע', 270]];
      let html = '';
      for (let r = -1; r <= 1; r++) for (let d = 0; d < 360; d += 15) { const x = (d + r * 360) * 3; const lab = dirs.find(q => q[1] === d); html += lab ? `<span class="cl" style="left:${x}px">${lab[0]}</span>` : `<span class="tk ${d % 45 ? '' : 'big'}" style="left:${x}px"></span>`; }
      el.innerHTML = html;
    }
    // heading: yaw 0 looks +z (north = -z, so heading 180 at yaw 0)
    const head = ((180 - yaw * 180 / Math.PI) % 360 + 360) % 360;
    el.style.transform = `translateX(${-head * 3 + W / 2}px)`;
    const mk = $('cmp-mark'), dist = $('cmp-dist');
    const place = (p, elx) => { const a = Math.atan2(p.x - hp.x, p.z - hp.z); let rel = (a - yaw); rel = Math.atan2(Math.sin(rel), Math.cos(rel)); const x = W / 2 - rel * 180 / Math.PI * 3; elx.style.left = Math.max(8, Math.min(W - 8, x)) + 'px'; elx.classList.toggle('edge', x < 8 || x > W - 8); };
    if (marker) { mk.classList.remove('hide'); place(marker, mk); dist.textContent = Math.round(Math.hypot(marker.x - hp.x, marker.z - hp.z)) + ' מ׳'; }
    else { mk.classList.add('hide'); dist.textContent = ''; }
  }
  pop(p, txt, color, big) {
    const el = document.createElement('div'); el.className = 'pop' + (big ? ' big' : ''); el.textContent = txt; el.style.color = color; $('pops').appendChild(el);
    this.pops.push({ el, p: new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.6, p.y + 0.3, p.z), t: 0, vx: (Math.random() - 0.5) * 40 });
    if (this.pops.length > 40) { const o = this.pops.shift(); o.el.remove(); }
  }
  update(dt, cam) {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const o = this.pops[i]; o.t += dt; o.p.y += dt * 1.2;
      const v = this.tmp.copy(o.p).project(cam);
      if (o.t > 0.9 || v.z > 1) { o.el.remove(); this.pops.splice(i, 1); continue; }
      const s = 1 + Math.max(0, 0.25 - o.t) * 2.4;
      o.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth + o.vx * o.t}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%) scale(${s})`;
      o.el.style.opacity = Math.min(1, (0.9 - o.t) * 4);
    }
  }
  // ---- dialog
  dialog(lines, done) { this.dlg = { lines: lines.slice(), done }; $('dialog').classList.remove('hide'); this.nextDialog(true); }
  nextDialog(first) {
    if (!this.dlg) return;
    if (!first && this.typing) { this.typing = false; $('dl-text').textContent = this.full; return; }
    const l = this.dlg.lines.shift();
    if (!l) { $('dialog').classList.add('hide'); const d = this.dlg.done; this.dlg = null; d && d(); return; }
    $('dl-name').textContent = l[0]; $('dialog').className = l[2] || '';
    this.full = l[1]; this.typing = true; let i = 0; const el = $('dl-text'); el.textContent = '';
    clearInterval(this.ti); this.ti = setInterval(() => { if (!this.typing) { clearInterval(this.ti); return; } i += 2; el.textContent = this.full.slice(0, i); if (i >= this.full.length) { this.typing = false; clearInterval(this.ti); } }, 22);
  }
  // ---- touch
  joy(on, x, y, dx = 0, dy = 0) { const j = $('joy'); j.classList.toggle('on', on); if (on) { j.style.left = (x - 64) + 'px'; j.style.top = (y - 64) + 'px'; $('knob').style.transform = `translate(${dx}px,${dy}px)`; } }
  bindTouch(h, getState, next) {
    const bind = (id, down, up) => {
      const el = $(id);
      el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('press'); if (getState() === 'dialog') { next(); return; } if (getState() === 'play') down(); });
      const u = () => { el.classList.remove('press'); up && up(); };
      el.addEventListener('pointerup', u); el.addEventListener('pointerleave', u); el.addEventListener('pointercancel', u);
    };
    bind('b-attack', () => h.attack(true), () => h.attack(false)); bind('b-magic', h.magic); bind('b-jump', h.jump); bind('b-dodge', h.dodge); bind('b-special', h.special); bind('b-use', h.use);
    $('b-pause').addEventListener('click', e => { e.stopPropagation(); h.pause(); });
  }
}
