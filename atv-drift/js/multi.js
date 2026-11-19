// Online multiplayer through the viewer-room capability: live ghost cars + lap races against friends.
// Everything travels in each player's `presence` (position at 15 Hz, race progress); no server of our own.
import * as THREE from 'three';

const RACES = [
  { id: 'circuit', name: 'מסלול המרוצים (אספלט)' },
  { id: 'rally', name: 'מסלול הראלי (עפר)' },
  { id: 'forest', name: 'ראלי היער' },
];
const COUNT_SECS = 5;
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const css = `
#mp { position: fixed; inset: 0; z-index: 45; display: grid; place-items: center; background: rgba(8,5,3,.6); backdrop-filter: blur(6px); }
#mp .card { width: min(560px, 94vw); max-height: 92vh; overflow: auto; padding: 22px; background: rgba(20,16,14,.95); border: 1px solid rgba(255,255,255,.14); border-radius: 22px; color: #fff; direction: rtl; }
#mp h2 { margin: 0 0 6px; font-size: 26px; font-weight: 900; }
#mp .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 10px 0; }
#mp input, #mp select { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.2); color: #fff; padding: 10px 12px; border-radius: 10px; font-size: 16px; font-family: inherit; }
#mp input.code { text-transform: uppercase; letter-spacing: .3em; width: 8em; text-align: center; font-weight: 800; }
#mp .big { font-size: 38px; letter-spacing: .3em; font-weight: 900; color: #ffd23a; }
#mp .note { color: rgba(255,255,255,.66); font-size: 13px; line-height: 1.5; }
#mp .pl { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.06); margin: 4px 0; }
#mp .dot { width: 12px; height: 12px; border-radius: 50%; }
#mp .btn { border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.1); color: #fff; padding: 10px 16px; border-radius: 12px; font-size: 15px; font-weight: 700; cursor: pointer; }
#mp .btn.primary { background: linear-gradient(180deg,#ffd23a,#ff8a1f); color: #2a1500; border: 0; }
#mp-hud { position: fixed; top: 74px; left: 50%; transform: translateX(-50%); z-index: 12; padding: 8px 18px; border-radius: 16px; background: rgba(10,8,6,.55); backdrop-filter: blur(8px); color: #fff; font-weight: 800; font-size: 18px; display: none; direction: rtl; white-space: nowrap; }
#mp-hud b { color: #ffd23a; }
#mp-count { position: fixed; inset: 0; z-index: 13; display: none; place-items: center; pointer-events: none; font-size: 160px; font-weight: 900; color: #ffd23a; text-shadow: 0 8px 40px rgba(0,0,0,.6); }
#mp-res { position: fixed; inset: 0; z-index: 44; display: none; place-items: center; background: rgba(8,5,3,.5); direction: rtl; }
#mp-res .card { width: min(460px, 92vw); padding: 22px; background: rgba(20,16,14,.95); border: 1px solid rgba(255,255,255,.14); border-radius: 22px; color: #fff; }
#mp-res .r { display: flex; gap: 12px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.06); margin: 4px 0; font-weight: 700; }
#mp-res .r.me { outline: 2px solid #ffd23a; }
.mp-tag { position: fixed; z-index: 11; transform: translate(-50%, -100%); padding: 2px 8px; border-radius: 10px; background: rgba(10,8,6,.62); color: #fff; font-size: 13px; font-weight: 800; pointer-events: none; white-space: nowrap; display: none; }
.mp-open { margin-inline-start: 0; }
`;

const hue = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
const fmt = (ms) => { const s = ms / 1000, m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };

export async function createMulti(api) {
  const { TR, veh, camera, scene } = api;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  let claudeRoom = null;
  try { claudeRoom = (window.claude && window.claude.use) ? await window.claude.use('room') : null; } catch (e) { claudeRoom = null; }

  const S = {
    room: null, code: '', name: localStorage.getItem('dunedrift.name') || '', players: new Map(),
    ph: 'idle', seenSeq: 0, seq: 0, cfg: { track: 'circuit', laps: 3 }, cd0: 0, t0: 0, fin: null, firstFin: 0, resShown: 0,
    tr: null, last: 0, prog: 0, sendT: 0, frozen: false, grid: null,
  };
  const me = () => S.room ? S.room.peers().find(p => p.isMe && p.sameTab) : null;
  const hostPeer = () => { const ps = S.room ? S.room.peers().filter(p => p.kind === 'viewer') : []; return ps.length ? ps.slice().sort((a, b) => (a.peer < b.peer ? -1 : 1))[0] : null; };
  const isHost = () => { const h = hostPeer(), m = me(); return !!(h && m && h.peer === m.peer); };

  // ---------------------------------------------------------------- DOM
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
  const panel = el('<div id="mp" class="hidden"><div class="card"></div></div>');
  const hud = el('<div id="mp-hud"></div>');
  const count = el('<div id="mp-count"></div>');
  const res = el('<div id="mp-res"><div class="card"></div></div>');
  document.body.append(panel, hud, count, res);
  panel.classList.add('hidden');
  const card = panel.querySelector('.card');

  const openPanel = (on = true) => { panel.classList.toggle('hidden', !on); if (on) render(); };
  for (const sel of ['#menu .menu-actions', '#pause .btn-row']) {
    const host = document.querySelector(sel); if (!host) continue;
    const b = document.createElement('button'); b.className = host.id === '' && sel.startsWith('#pause') ? 'btn' : 'btn ghost'; b.className += ' mp-open';
    b.textContent = '👥 מרובה משתתפים'; b.addEventListener('click', () => openPanel(true)); host.appendChild(b);
  }

  function render() {
    if (!claudeRoom) {
      card.innerHTML = `<h2>👥 מרובה משתתפים</h2><p class="note">מצב מרובה משתתפים עובד רק כשהמשחק נפתח כמשתמש מחובר (או כאורח שהוזמן) בדף הזה. פתחו את המשחק מחדש בחשבון שלכם, ושתפו דרך כפתור השיתוף של הדף עם החברים כדי שיוכלו להצטרף.</p><div class="row"><button class="btn" id="mp-close">סגירה</button></div>`;
      card.querySelector('#mp-close').onclick = () => openPanel(false); return;
    }
    if (!S.room) {
      card.innerHTML = `<h2>👥 מרוץ נגד חברים</h2>
        <p class="note">כל שחקן פותח את אותו קישור של המשחק. אחד יוצר חדר ושולח את הקוד, השאר מזינים אותו. רואים אחד את השני נוסעים בזמן אמת ואפשר לצאת למרוץ הקפות. כל המשתתפים צריכים להיות מחוברים עם גישה לדף.</p>
        <div class="row"><label>שם:</label><input id="mp-name" maxlength="14" value="${S.name.replace(/"/g, '')}" placeholder="השם שלך"></div>
        <div class="row"><button class="btn primary" id="mp-create">צור חדר חדש</button></div>
        <div class="row"><input class="code" id="mp-code" maxlength="4" placeholder="קוד"><button class="btn" id="mp-join">הצטרף</button></div>
        <div class="note" id="mp-msg"></div>
        <div class="row"><button class="btn" id="mp-close">סגירה</button></div>`;
      const nm = () => { S.name = card.querySelector('#mp-name').value.trim().slice(0, 14) || 'נהג'; localStorage.setItem('dunedrift.name', S.name); };
      card.querySelector('#mp-create').onclick = () => { nm(); join(Array.from({ length: 4 }, () => ALPHA[(Math.random() * ALPHA.length) | 0]).join('')); };
      card.querySelector('#mp-join').onclick = () => { nm(); const c = card.querySelector('#mp-code').value.trim().toUpperCase(); if (c.length === 4) join(c); else card.querySelector('#mp-msg').textContent = 'הקוד הוא 4 תווים'; };
      card.querySelector('#mp-close').onclick = () => openPanel(false);
      return;
    }
    const peers = S.room.peers().filter(p => p.kind === 'viewer');
    const host = hostPeer();
    const rows = peers.map(p => `<div class="pl"><span class="dot" style="background:hsl(${hue(p.peer)} 85% 55%)"></span><b>${esc(p.presence.n || 'נהג')}</b>${p.isMe && p.sameTab ? ' (אני)' : ''}${host && p.peer === host.peer ? ' ⭐ מארח' : ''}</div>`).join('');
    const cfg = S.cfg, hostMode = isHost();
    card.innerHTML = `<h2>חדר ${S.code}</h2>
      <p class="note">שלחו לחברים את הקוד <span class="big" style="font-size:20px;letter-spacing:.2em">${S.code}</span> והם מצטרפים דרך "מרובה משתתפים". רואים אחד את השני בזמן אמת בכל העולם.</p>
      <div>${rows}</div>
      ${hostMode ? `<div class="row"><label>מסלול:</label><select id="mp-track">${RACES.map(r => `<option value="${r.id}" ${r.id === cfg.track ? 'selected' : ''}>${r.name}</option>`).join('')}</select>
        <label>הקפות:</label><select id="mp-laps">${[1, 2, 3, 5].map(n => `<option ${n === cfg.laps ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="row"><button class="btn primary" id="mp-start">🏁 התחל מרוץ</button></div>`
      : `<p class="note">המארח (${esc(host?.presence?.n || '')}) בוחר מסלול ומתחיל את המרוץ. מסלול: ${RACES.find(r => r.id === (hostCfg().track))?.name || ''}.</p>`}
      <div class="row"><button class="btn" id="mp-free">🚗 לנסוע ביחד (בלי מרוץ)</button><button class="btn" id="mp-leave">יציאה מהחדר</button></div>`;
    if (hostMode) {
      card.querySelector('#mp-track').onchange = (e) => { S.cfg.track = e.target.value; };
      card.querySelector('#mp-laps').onchange = (e) => { S.cfg.laps = +e.target.value; };
      card.querySelector('#mp-start').onclick = () => { startRace(); openPanel(false); };
    }
    card.querySelector('#mp-free').onclick = () => openPanel(false);
    card.querySelector('#mp-leave').onclick = () => { leave(); };
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hostCfg = () => { const h = hostPeer(); const c = h?.presence?.hc; if (typeof c === 'string') { const [track, laps] = c.split(':'); return { track, laps: +laps || 3 }; } return S.cfg; };

  // ---------------------------------------------------------------- room
  async function join(code) {
    const msg = card.querySelector('#mp-msg'); if (msg) msg.textContent = 'מתחבר…';
    try {
      S.room = await claudeRoom.join('dd-' + code.toLowerCase());
    } catch (e) { if (msg) msg.textContent = 'לא הצלחתי להתחבר (' + (e.code || 'שגיאה') + ')'; return; }
    S.code = code;
    S.unPeers = S.room.onPeers(onPeers, () => {});
    api.popup('👥 חדר ' + code, 'trial', 'חברים מצטרפים עם הקוד');
    render();
  }
  async function leave() {
    try { S.unPeers?.(); } catch (e) { /* ignore */ }
    for (const [, p] of S.players) removePlayer(p);
    S.players.clear();
    try { await S.room?.leave(); } catch (e) { /* ignore */ }
    S.room = null; S.code = ''; endRace(true); render();
  }
  function onPeers(ch) {
    const now = performance.now();
    for (const p of ch.left) { const e = S.players.get(p.peer); if (e) { removePlayer(e); S.players.delete(p.peer); } }
    for (const p of [...ch.joined, ...ch.updated]) {
      if (p.isMe || p.kind !== 'viewer') continue;
      let e = S.players.get(p.peer);
      if (!e) { e = { peer: p.peer, car: null, carId: null, loading: false, buf: [], tag: Object.assign(document.createElement('div'), { className: 'mp-tag' }), name: '', paint: null }; document.body.appendChild(e.tag); S.players.set(p.peer, e); }
      const pr = p.presence;
      e.p = pr; e.name = pr.n || 'נהג';
      if (typeof pr.x === 'number') {
        e.buf.push({ t: now, x: pr.x, y: pr.y, z: pr.z, qx: pr.qx, qy: pr.qy, qz: pr.qz, qw: pr.qw, st: pr.st || 0, sp: pr.sp || 0, bo: pr.bo || 0 });
        if (e.buf.length > 8) e.buf.shift();
      }
      if (pr.c && pr.c !== e.carId && !e.loading) loadRemote(e, pr.c);
      if (e.car && pr.pc && pr.pc !== e.paint && e.car.paintable !== false) { e.paint = pr.pc; try { e.car.setPaint(pr.pc); } catch (er) { /* ignore */ } }
    }
    if (!panel.classList.contains('hidden')) render();
  }
  async function loadRemote(e, id) {
    e.loading = true;
    try {
      const car = await api.loadCarById(id);
      if (e.car) scene.remove(e.car.root);
      e.car = car; e.carId = id; scene.add(car.root); e.paint = null;
    } catch (er) { console.warn('remote car', er); e.carId = id; }
    e.loading = false;
  }
  function removePlayer(e) { if (e.car) scene.remove(e.car.root); e.tag.remove(); }

  // ---------------------------------------------------------------- race
  const track = () => TR.TRACKS.find(t => t.id === S.cfg.track) || TR.TRACKS[0];
  function startRace() {
    S.seq = (S.seq || 0) + 1 + Math.floor(Math.random() * 1000);        // unique race id
    S.hostSeq = S.seq; S.hostPh = 'count';
    pushPresence(true);
  }
  function slotFor(peer) {
    const ids = [...S.room.peers().filter(p => p.kind === 'viewer').map(p => p.peer)].sort();
    const k = Math.max(0, ids.indexOf(peer));
    const tr = S.tr, n = tr.n, idx = (n - 8 - Math.floor(k / 2) * 6 + n) % n, p = tr.pts[idx];
    const lat = (k % 2 ? 3.2 : -3.2), nx = p.tz, nz = -p.tx;
    return { x: p.x + nx * lat, z: p.z + nz * lat, yaw: Math.atan2(p.tx, p.tz) };
  }
  function beginCount(seq, cfg) {
    S.seenSeq = seq; S.seq = seq; S.cfg = { ...cfg };
    S.tr = track(); S.fin = null; S.firstFin = 0; S.resShown = 0; res.style.display = 'none';
    const m = me(); const slot = slotFor(m ? m.peer : '');
    api.resetTo(slot.x, slot.z, slot.yaw);
    S.ph = 'count'; S.cd0 = performance.now(); S.frozen = true; api.freeze(true);
    S.last = 0; S.prog = 0; S.grid = slot;
    const q = TR.trackNearest(slot.x, slot.z); S.last = q.i; S.prog = q.i > S.tr.n / 2 ? q.i - S.tr.n : q.i;
    api.closeMenus();
  }
  function track_update() {
    const tr = S.tr; if (!tr) return;
    const q = TR.trackNearest(veh.pos.x, veh.pos.z);
    if (q.track !== tr || q.d > tr.hw + 30) return;
    const n = tr.n, di = (q.i - S.last + n) % n;
    if (di === 0) return;
    if (di < 30) { S.prog += di; S.last = q.i; } else if (di > n - 30) { S.prog -= (n - di); S.last = q.i; }
  }
  function endRace(silent) {
    S.ph = 'idle'; S.frozen = false; api.freeze(false); S.tr = null; hud.style.display = 'none'; count.style.display = 'none';
    if (silent) res.style.display = 'none';
  }
  function standings() {
    const out = [];
    const mm = me();
    const push = (p, isMe) => { const pr = p.presence; if (pr.rs !== S.seq) return; out.push({ name: isMe ? S.name : (pr.n || 'נהג'), me: isMe, fin: typeof pr.fin === 'number' ? pr.fin : null, prog: isMe ? S.prog : (pr.pr || 0), peer: p.peer }); };
    for (const p of S.room.peers().filter(p => p.kind === 'viewer')) push(p, mm && p.peer === mm.peer);
    out.sort((a, b) => (a.fin != null && b.fin != null) ? a.fin - b.fin : (a.fin != null ? -1 : (b.fin != null ? 1 : b.prog - a.prog)));
    return out;
  }

  // ---------------------------------------------------------------- presence
  function pushPresence(force) {
    if (!S.room) return;
    const car = api.getCar(), r = car.root;
    const w = veh.wheels;
    const patch = {
      n: S.name || 'נהג', c: api.getCarId(), pc: api.getPaint() || null,
      x: +r.position.x.toFixed(2), y: +r.position.y.toFixed(2), z: +r.position.z.toFixed(2),
      qx: +r.quaternion.x.toFixed(4), qy: +r.quaternion.y.toFixed(4), qz: +r.quaternion.z.toFixed(4), qw: +r.quaternion.w.toFixed(4),
      st: +w[0].steerAngle.toFixed(3), sp: +((w[2].spin % 6.2832).toFixed(2)), bo: veh.boostActive ? 1 : 0,
      rs: S.ph !== 'idle' ? S.seq : null, pr: S.ph !== 'idle' ? Math.round(S.prog) : null, fin: S.fin,
    };
    if (isHost()) { patch.hs = S.hostSeq || null; patch.hph = S.hostPh || 'lobby'; patch.hc = S.cfg.track + ':' + S.cfg.laps; }
    S.room.presence(patch).catch(() => {});
  }

  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();
  function update(dt, t) {
    if (!S.room) return;
    const now = performance.now();
    // send
    if (now - S.sendT > 66) { S.sendT = now; pushPresence(); }
    // remote cars
    const rt = now - 130;
    for (const e of S.players.values()) {
      const b = e.buf; if (!b.length || !e.car) { e.tag.style.display = 'none'; continue; }
      let a = b[0], c = b[b.length - 1];
      for (let i = b.length - 1; i > 0; i--) if (b[i - 1].t <= rt) { a = b[i - 1]; c = b[i]; break; }
      const k = c.t > a.t ? Math.min(1.25, Math.max(0, (rt - a.t) / (c.t - a.t))) : 1;
      const car = e.car, root = car.root;
      root.position.set(a.x + (c.x - a.x) * k, a.y + (c.y - a.y) * k, a.z + (c.z - a.z) * k);
      _q.set(a.qx, a.qy, a.qz, a.qw); _q2.set(c.qx, c.qy, c.qz, c.qw); root.quaternion.copy(_q.slerp(_q2, Math.min(1, k)));
      e.spin = (e.spin || 0) + (c.sp - (e.lastSp ?? c.sp)); e.lastSp = c.sp;
      for (const wh of car.wheels) {
        wh.steer.position.y = wh.baseY;
        if (wh.front) { if (wh.fork) wh.fork.quaternion.setFromAxisAngle(wh.axis, c.st * 0.85); else wh.steer.rotation.y = c.st; }
        wh.spin.rotation.x = c.sp;
      }
      for (const f of car.flames) f.visible = !!c.bo;
      // name tag
      _v.copy(root.position); _v.y += 2.4; _v.project(camera);
      const dist = root.position.distanceTo(camera.position);
      if (_v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 && dist < 700) {
        e.tag.style.display = 'block';
        e.tag.style.left = ((_v.x * 0.5 + 0.5) * innerWidth) + 'px'; e.tag.style.top = ((-_v.y * 0.5 + 0.5) * innerHeight) + 'px';
        e.tag.style.opacity = Math.max(0.35, 1 - dist / 700);
        e.tag.style.borderBottom = `3px solid hsl(${hue(e.peer)} 85% 55%)`;
        const rk = (S.ph !== 'idle' && e.p && e.p.rs === S.seq) ? standings().findIndex(s => s.peer === e.peer) + 1 : 0;
        e.tag.textContent = (rk ? rk + '. ' : '') + e.name + ` · ${Math.round(dist)}מ׳`;
      } else e.tag.style.display = 'none';
    }
    // race state machine (follow the host)
    const h = hostPeer();
    if (h && h.presence.hph === 'count' && h.presence.hs && h.presence.hs !== S.seenSeq && S.ph !== 'count') {
      const hc = hostCfg();
      beginCount(h.presence.hs, hc);
    }
    if (S.ph === 'count') {
      const rem = COUNT_SECS - (now - S.cd0) / 1000;
      if (rem > 0) {
        count.style.display = 'grid'; count.textContent = Math.ceil(rem);
        if (S.grid) api.resetTo(S.grid.x, S.grid.z, S.grid.yaw, true);
      } else {
        S.ph = 'race'; S.t0 = now; S.frozen = false; api.freeze(false);
        count.textContent = 'GO!'; setTimeout(() => { if (S.ph !== 'count') count.style.display = 'none'; }, 900);
        if (isHost()) { S.hostPh = 'race'; }
        api.audioGo?.();
      }
    }
    if (S.ph === 'race' || S.ph === 'done') {
      if (S.ph === 'race') {
        track_update();
        if (S.prog >= S.cfg.laps * S.tr.n) {
          S.fin = Math.round(now - S.t0); S.ph = 'done'; S.firstFin = S.firstFin || now;
          api.popup('🏁 סיימת!', 'bank', fmt(S.fin));
        }
      }
      const st = standings(), mine = st.findIndex(s => s.me) + 1;
      const lap = Math.min(S.cfg.laps, Math.max(1, Math.floor(Math.max(0, S.prog) / S.tr.n) + 1));
      hud.style.display = 'block';
      hud.innerHTML = `מקום <b>${mine || '-'}/${st.length}</b> · הקפה <b>${S.fin != null ? S.cfg.laps : lap}/${S.cfg.laps}</b> · <b>${fmt(S.fin != null ? S.fin : now - S.t0)}</b>`;
      const anyFin = st.some(s => s.fin != null);
      if (anyFin && !S.firstFin) S.firstFin = now;
      const allDone = st.length && st.every(s => s.fin != null);
      if (!S.resShown && ((allDone) || (S.firstFin && now - S.firstFin > 40000 && S.fin != null))) { S.resShown = 1; showResults(st); }
    }
  }
  function showResults(st) {
    const c = res.querySelector('.card');
    c.innerHTML = `<h2 style="margin:0 0 10px;font-size:26px">🏆 תוצאות</h2>` + st.map((s, i) => `<div class="r ${s.me ? 'me' : ''}"><span>${i + 1}</span><span style="flex:1">${esc(s.name)}</span><span>${s.fin != null ? fmt(s.fin) : 'לא סיים'}</span></div>`).join('') + `<div style="display:flex;gap:10px;margin-top:14px"><button class="btn primary" id="mp-r-close" style="flex:1">המשך לנסוע</button></div>`;
    res.style.display = 'grid';
    c.querySelector('#mp-r-close').onclick = () => { res.style.display = 'none'; endRace(false); hud.style.display = 'none'; S.hostPh = 'lobby'; };
    c.querySelector('#mp-r-close').style.cssText += ';background:linear-gradient(180deg,#ffd23a,#ff8a1f);color:#2a1500;border:0;padding:10px;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer';
  }
  return {
    update, openPanel, S, available: !!claudeRoom, join, startRace, isHost, leave,
    get frozen() { return S.frozen; },
    get inRoom() { return !!S.room; },
    debug: () => ({ ph: S.ph, seq: S.seq, prog: S.prog, peers: S.room ? S.room.peers().length : 0, players: S.players.size }),
  };
}
