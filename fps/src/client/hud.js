// In-game HUD: conquest ticket bar + flag strip, compass, rotating minimap, ammo/health,
// dynamic crosshair, hit markers, directional damage, kill feed, reward popups,
// projected world markers, capture progress, scope overlay, scoreboard.
import { BOUNDS, HALF, HN, HRES, MAP_NAME } from '../shared/world.js';
import { TEAMS, CLASSES, WEAPONS, RULES } from '../shared/config.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export const MAPB = { x0: BOUNDS.minX - 45, z0: BOUNDS.minZ - 45, x1: BOUNDS.maxX + 45, z1: BOUNDS.maxZ + 45 };

export function renderMapImage(W, scale = 2) {
  const w = Math.round((MAPB.x1 - MAPB.x0) * scale), h = Math.round((MAPB.z1 - MAPB.z0) * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const hAt = (x, z) => { const i = Math.min(HN - 1, Math.max(0, Math.round((x + HALF) / HRES))), j = Math.min(HN - 1, Math.max(0, Math.round((z + HALF) / HRES))); return W.heights[j * HN + i]; };
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = MAPB.x0 + px / scale, z = MAPB.z0 + py / scale;
    const hh = hAt(x, z);
    const dx = hAt(x + 2, z) - hAt(x - 2, z), dz = hAt(x, z + 2) - hAt(x, z - 2);
    const shade = Math.max(0.35, Math.min(1.25, 0.9 - (dx * 0.6 + dz * 0.4) * 0.25));
    const t = Math.min(1, Math.max(0, (hh - 0) / 40));
    let r = 52 + t * 40, gg = 62 + t * 30, b = 44 + t * 22;
    const contour = Math.abs(((hh / 4) % 1)) < 0.06 ? 0.85 : 1;
    const i = (py * w + px) * 4;
    img.data[i] = r * shade * contour; img.data[i + 1] = gg * shade * contour; img.data[i + 2] = b * shade * contour; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const P = (x, z) => [(x - MAPB.x0) * scale, (z - MAPB.z0) * scale];
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of W.roads) {
    g.strokeStyle = r.type === 'asphalt' ? 'rgba(40,42,44,0.95)' : 'rgba(120,100,70,0.8)';
    g.lineWidth = r.w * scale;
    g.beginPath(); r.pts.forEach((p, k) => { const [x, y] = P(p[0], p[1]); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  }
  for (const b of W.boxes) {
    if (!b.flags || b.bld >= 0 || b.kind === 15 || b.kind === 13 || b.kind === 4) continue;
    const [x, y] = P(b.x0, b.z0);
    g.fillStyle = 'rgba(150,145,130,0.8)'; g.fillRect(x, y, (b.x1 - b.x0) * scale, (b.z1 - b.z0) * scale);
  }
  for (const B of W.buildings) {
    const [x, y] = P(B.x0, B.z0);
    const sh = Math.min(1, B.floors / 6);
    g.fillStyle = `rgb(${150 + sh * 60},${148 + sh * 58},${140 + sh * 55})`;
    g.fillRect(x, y, (B.x1 - B.x0) * scale, (B.z1 - B.z0) * scale);
    g.strokeStyle = 'rgba(20,20,20,0.7)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, (B.x1 - B.x0) * scale - 1, (B.z1 - B.z0) * scale - 1);
  }
  for (const p of W.props) if (p.type === 'tree') { const [x, y] = P(p.x, p.z); g.fillStyle = 'rgba(30,50,25,0.7)'; g.beginPath(); g.arc(x, y, 2.2 * scale * p.s, 0, 7); g.fill(); }
  // out of bounds shading
  g.fillStyle = 'rgba(0,0,0,0.45)';
  const [bx0, by0] = P(BOUNDS.minX, BOUNDS.minZ), [bx1, by1] = P(BOUNDS.maxX, BOUNDS.maxZ);
  g.fillRect(0, 0, w, by0); g.fillRect(0, by1, w, h - by1); g.fillRect(0, by0, bx0, by1 - by0); g.fillRect(bx1, by0, w - bx1, by1 - by0);
  g.strokeStyle = 'rgba(255,80,60,0.6)'; g.setLineDash([6, 4]); g.lineWidth = 2; g.strokeRect(bx0, by0, bx1 - bx0, by1 - by0); g.setLineDash([]);
  return { canvas: c, scale };
}

export class Hud {
  constructor(W) {
    this.W = W;
    const root = $('#hud');
    this.root = root;
    root.innerHTML = `
      <div id="hTop">
        <div id="hTickets"><div class="tk my"><span class="tkn">0</span><div class="tkbar"><i></i></div></div><div id="hFlags"></div><div class="tk en"><div class="tkbar"><i></i></div><span class="tkn">0</span></div></div>
        <div id="hCompass"><div id="hCompassStrip"></div><div id="hCompassNeedle"></div><div id="hHeading">000</div></div>
      </div>
      <div id="hMiniWrap"><canvas id="hMini" width="220" height="220"></canvas><div id="hMiniN">N</div></div>
      <div id="hSquad"></div>
      <div id="hFeed"></div>
      <div id="hBottomL"><div id="hHpNum">100</div><div id="hHpBar"><i></i></div><div id="hClass"></div></div>
      <div id="hBottomR"><div id="hWeapon"></div><div id="hAmmo"><span id="hMag">30</span><span id="hRes">/ 120</span></div><div id="hGear"><span id="hNade">G ●●</span><span id="hGadget"></span></div></div>
      <div id="hCross"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><b></b></div>
      <div id="hHit"><i></i><i></i><i></i><i></i></div>
      <div id="hDmg"></div>
      <div id="hMarkers"></div>
      <div id="hRewards"></div>
      <div id="hCapture"><div class="cl"></div><div class="cbar"><i></i></div><div class="cs"></div></div>
      <div id="hPrompt"></div>
      <div id="hCenterMsg"></div>
      <div id="hOob"><div>RETURN TO THE BATTLEFIELD</div><span>8</span></div>
      <div id="hScope"><div class="ring"></div><div class="ch"></div><div class="cv"></div><div class="mil"></div></div>
      <div id="hTankUI"><div class="ret"></div><div class="tap" id="hTankAim"></div><div id="hTankInfo"></div></div>
      <div id="hDown"><div class="dt">YOU ARE DOWN</div><div class="ds">Wait for a revive — <b>hold SPACE / tap</b> to give up</div><div class="dbar"><i></i></div></div>
      <div id="hVignette"></div>
      <div id="hFps"></div>
      <div id="hScore" class="hidden"></div>`;
    this.mini = $('#hMini'); this.mg = this.mini.getContext('2d');
    this.feed = $('#hFeed'); this.rewards = $('#hRewards'); this.markersEl = $('#hMarkers'); this.dmgEl = $('#hDmg');
    this.markerPool = []; this.markerUsed = 0;
    this.map = renderMapImage(W, 2);
    this.buildCompass();
    this.flagEls = {};
    const hf = $('#hFlags');
    for (const f of W.flags) { const e = el('div', 'fl', `<span>${f.id}</span><i></i>`); hf.appendChild(e); this.flagEls[f.id] = e; }
    this.hitT = 0; this.rewardQ = []; this.sbVisible = false;
    this.lastAmmo = '';
  }
  buildCompass() {
    const s = $('#hCompassStrip');
    let h = '';
    const lbl = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let rep = -1; rep <= 1; rep++) for (let d = 0; d < 360; d += 15) {
      const deg = d + rep * 360;
      h += `<div class="ct ${lbl[d] ? 'maj' : ''}" style="left:${deg * 4}px">${lbl[d] || (d % 30 === 0 ? d : '')}</div>`;
    }
    s.innerHTML = h;
    this.compassMarks = el('div', 'cmarks'); s.appendChild(this.compassMarks);
  }
  setCompass(headingDeg, flagMarks) {
    $('#hCompassStrip').style.transform = `translateX(${-headingDeg * 4}px)`;
    $('#hHeading').textContent = String(Math.round(((headingDeg % 360) + 360) % 360)).padStart(3, '0');
    let h = '';
    for (const m of flagMarks) for (const rep of [-1, 0, 1]) h += `<i class="cm ${m.cls}" style="left:${(m.deg + rep * 360) * 4}px">${m.id}</i>`;
    this.compassMarks.innerHTML = h;
  }
  setTickets(my, en, max) {
    const t = this.root.querySelectorAll('#hTickets .tk');
    t[0].querySelector('.tkn').textContent = my; t[1].querySelector('.tkn').textContent = en;
    t[0].querySelector('i').style.width = (my / max * 100) + '%'; t[1].querySelector('i').style.width = (en / max * 100) + '%';
  }
  setFlags(states, myTeam, nearId) {
    for (const id in this.flagEls) {
      const e = this.flagEls[id], s = states[id];
      if (!s) continue;
      const cls = s.owner === 0 ? 'neu' : s.owner === myTeam ? 'my' : 'en';
      e.className = 'fl ' + cls + (nearId === id ? ' near' : '') + (s.contested ? ' cont' : '');
      const prog = myTeam === 1 ? s.prog : -s.prog;
      e.querySelector('i').style.height = (Math.abs(prog) * 100) + '%';
      e.querySelector('i').className = prog >= 0 ? 'pm' : 'pe';
    }
  }
  drawMinimap(me, yaw, players, flags, myTeam, vehicles, ents) {
    const g = this.mg, S = this.mini.width, R = S / 2;
    const zoom = 1.25;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.clip();
    g.fillStyle = '#1a1e18'; g.fillRect(0, 0, S, S);
    g.translate(R, R);
    g.rotate(yaw);
    const sc = this.map.scale;
    g.scale(zoom / sc, zoom / sc);
    g.globalAlpha = 0.92;
    g.drawImage(this.map.canvas, -(me.x - MAPB.x0) * sc, -(me.z - MAPB.z0) * sc);
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const toS = (x, z) => {
      const dx = (x - me.x) * zoom, dz = (z - me.z) * zoom;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      return [R + dx * c - dz * s, R + dx * s + dz * c];
    };
    for (const f of flags) {
      const [x, y] = toS(f.x, f.z);
      const col = f.owner === 0 ? '#ddd' : f.owner === myTeam ? '#4fb3ff' : '#ff5a4a';
      g.strokeStyle = col; g.lineWidth = 2; g.fillStyle = 'rgba(0,0,0,0.5)';
      g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); g.stroke();
      g.fillStyle = col; g.font = 'bold 11px Barlow Condensed, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(f.id, x, y + 1);
    }
    for (const v of vehicles) {
      if (!v.alive) continue;
      const [x, y] = toS(v.x, v.z);
      if (v.team !== myTeam && !v.spotted) continue;
      g.fillStyle = v.team === myTeam ? '#4fb3ff' : '#ff5a4a';
      g.save(); g.translate(x, y); g.rotate(yaw - v.yaw); g.fillRect(-4, -6, 8, 12); g.fillRect(-1, -11, 2, 6); g.restore();
    }
    for (const e of ents) {
      const [x, y] = toS(e.x, e.z);
      g.fillStyle = '#7fff7f'; g.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const p of players) {
      if (!p.alive || p.isMe || p.veh >= 0) continue;
      const friendly = p.team === myTeam;
      if (!friendly && !p.spotted && !p.firingRecent) continue;
      const [x, y] = toS(p.x, p.z);
      g.fillStyle = friendly ? (p.squadMate ? '#7cff6b' : '#4fb3ff') : '#ff5a4a';
      if (p.downed) { g.font = 'bold 12px sans-serif'; g.fillText('✚', x, y); continue; }
      g.save(); g.translate(x, y); g.rotate(yaw - p.yaw);
      g.beginPath(); g.moveTo(0, -6); g.lineTo(4.5, 4); g.lineTo(-4.5, 4); g.closePath(); g.fill();
      g.restore();
    }
    // me + view cone
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.beginPath(); g.moveTo(R, R); g.arc(R, R, 90, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); g.closePath(); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(R, R - 7); g.lineTo(R + 5, R + 5); g.lineTo(R, R + 2); g.lineTo(R - 5, R + 5); g.closePath(); g.fill();
    g.restore();
    // ring + north marker
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.arc(R, R, R - 2, 0, 7); g.stroke();
    const n = $('#hMiniN');
    const ang = yaw - Math.PI / 2, Rd = (this.mini.clientWidth || S) / 2;
    n.style.transform = `translate(${Math.cos(ang) * (Rd - 10)}px, ${Math.sin(ang) * (Rd - 10)}px)`;
  }
  setHealth(hp) {
    $('#hHpNum').textContent = Math.max(0, Math.round(hp));
    const b = $('#hHpBar i'); b.style.width = Math.max(0, hp) + '%';
    b.className = hp < 30 ? 'low' : '';
  }
  setAmmo(name, mag, res, nades, gadget, extra) {
    const key = name + mag + res + nades + gadget + extra;
    if (key === this.lastAmmo) return;
    this.lastAmmo = key;
    $('#hWeapon').textContent = name;
    $('#hMag').textContent = mag;
    $('#hMag').className = typeof mag === 'number' && mag <= 5 ? 'low' : '';
    $('#hRes').textContent = res === '' ? '' : '/ ' + res;
    $('#hNade').innerHTML = 'G ' + '●'.repeat(Math.max(0, nades)) + '<s>' + '○'.repeat(Math.max(0, 2 - nades)) + '</s>';
    $('#hGadget').textContent = gadget || '';
    $('#hBottomR').dataset.extra = extra || '';
  }
  setClass(cls, squad, myName) { $('#hClass').innerHTML = `<b>${CLASSES[cls].icon}</b> ${CLASSES[cls].name} <span>· SQUAD ${String.fromCharCode(64 + squad)}</span>`; void myName; }
  setSquad(list) {
    $('#hSquad').innerHTML = list.map((p) => `<div class="sq ${p.alive ? (p.downed ? 'down' : '') : 'dead'}"><b>${CLASSES[p.cls]?.icon || ''}</b>${p.name}</div>`).join('');
  }
  setCrosshair(spreadPx, visible, hitAlpha) {
    const c = $('#hCross');
    c.style.opacity = visible ? 1 : 0;
    const s = Math.max(4, spreadPx);
    c.style.setProperty('--s', s + 'px');
    void hitAlpha;
  }
  hit(kind) {
    const h = $('#hHit');
    h.className = 'on ' + kind;
    void h.offsetWidth;
    h.classList.add('anim');
    clearTimeout(this.hitTO);
    this.hitTO = setTimeout(() => { h.className = ''; }, kind === 'kill' ? 420 : 200);
  }
  damageFrom(angleRad) {
    const d = el('div', 'dmgarc');
    d.style.transform = `rotate(${angleRad}rad)`;
    this.dmgEl.appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }
  killfeed(k, v, w, head, kTeam, vTeam, myTeam, meInvolved) {
    const kc = kTeam === myTeam ? 'my' : 'en', vc = vTeam === myTeam ? 'my' : 'en';
    const e = el('div', 'kf' + (meInvolved ? ' me' : ''), `${k ? `<span class="${kc}">${k}</span>` : ''}<em>${w}${head ? ' <b>✛</b>' : ''}</em><span class="${vc}">${v}</span>`);
    this.feed.prepend(e);
    while (this.feed.children.length > 6) this.feed.lastChild.remove();
    setTimeout(() => { e.classList.add('out'); setTimeout(() => e.remove(), 600); }, 6000);
  }
  reward(text, pts) {
    const e = el('div', 'rw', `<b>${text}</b><span>+${pts}</span>`);
    this.rewards.appendChild(e);
    while (this.rewards.children.length > 5) this.rewards.firstChild.remove();
    setTimeout(() => { e.classList.add('out'); setTimeout(() => e.remove(), 500); }, 2600);
  }
  centerMsg(html, dur = 2500, cls = '') {
    const c = $('#hCenterMsg');
    c.innerHTML = html; c.className = 'on ' + cls;
    clearTimeout(this.cmTO);
    this.cmTO = setTimeout(() => { c.className = ''; }, dur);
  }
  beginMarkers() { this.markerUsed = 0; }
  marker(x, y, cls, html, scale = 1) {
    let m = this.markerPool[this.markerUsed];
    if (!m) { m = el('div', 'mk'); this.markersEl.appendChild(m); this.markerPool.push(m); }
    this.markerUsed++;
    if (m._cls !== cls) { m.className = 'mk ' + cls; m._cls = cls; }
    if (m._html !== html) { m.innerHTML = html; m._html = html; }
    m.style.transform = `translate(${x | 0}px,${y | 0}px) scale(${scale.toFixed(2)})`;
    m.style.display = 'block';
  }
  endMarkers() { for (let i = this.markerUsed; i < this.markerPool.length; i++) if (this.markerPool[i].style.display !== 'none') this.markerPool[i].style.display = 'none'; }
  setCapture(f, prog, myTeam, n1, n2) {
    const c = $('#hCapture');
    if (!f) { c.classList.remove('on'); return; }
    c.classList.add('on');
    const mine = myTeam === 1 ? prog : -prog;
    c.querySelector('.cl').innerHTML = `<b>${f.id}</b> ${f.name}`;
    const bar = c.querySelector('.cbar i');
    bar.style.width = Math.abs(mine) * 100 + '%';
    bar.className = mine >= 0 ? 'my' : 'en';
    const mc = myTeam === 1 ? n1 : n2, ec = myTeam === 1 ? n2 : n1;
    let st = mc > ec ? (Math.abs(mine) >= 1 && mine > 0 ? 'SECURED' : 'CAPTURING') : mc < ec ? 'LOSING OBJECTIVE' : mc + ec ? 'CONTESTED' : '';
    if (f.owner === myTeam && mc >= ec) st = mine >= 1 ? 'DEFENDING' : 'CAPTURING';
    c.querySelector('.cs').innerHTML = `${st} <span class="my">${mc}</span> vs <span class="en">${ec}</span>`;
  }
  prompt(t) { const p = $('#hPrompt'); if (p._t !== t) { p.innerHTML = t || ''; p._t = t; p.style.opacity = t ? 1 : 0; } }
  oob(sec) { const o = $('#hOob'); if (sec == null) o.classList.remove('on'); else { o.classList.add('on'); o.querySelector('span').textContent = Math.max(0, Math.ceil(sec)); } }
  scope(v) { $('#hScope').classList.toggle('on', v); }
  tankUI(v, info, ax, ay) {
    $('#hTankUI').classList.toggle('on', v); document.body.classList.toggle('intank', v);
    if (v) { const ti = $('#hTankInfo'); if (ti._h !== info) { ti.innerHTML = info; ti._h = info; } if (ax != null) $('#hTankAim').style.transform = `translate(${ax}px,${ay}px) rotate(45deg)`; }
  }
  downed(v, frac) { const d = $('#hDown'); d.classList.toggle('on', v); if (v) d.querySelector('.dbar i').style.width = (frac * 100) + '%'; }
  vignette(hp, flash) { $('#hVignette').style.opacity = Math.min(1, (hp < 50 ? (50 - hp) / 50 : 0) * 0.8 + flash); }
  fps(t) { $('#hFps').textContent = t; }
  show(v) { this.root.style.display = v ? 'block' : 'none'; }
  scoreboard(v, roster, myId, myTeam, tickets) {
    const s = $('#hScore');
    s.classList.toggle('hidden', !v);
    if (!v) return;
    const teams = [myTeam, myTeam === 1 ? 2 : 1];
    const rows = (t) => roster.filter((r) => r.team === t).sort((a, b) => b.score - a.score).map((r, i) => `<tr class="${r.id === myId ? 'me' : ''}"><td>${i + 1}</td><td class="sqd">${String.fromCharCode(64 + r.squad)}</td><td>${CLASSES[r.cls]?.icon || ''}</td><td class="nm">${r.name}${r.bot ? ' <i>AI</i>' : ''}</td><td>${r.score}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.assists}</td><td>${r.revives}</td><td>${r.bot ? '' : r.ping}</td></tr>`).join('');
    s.innerHTML = `<div class="sbh">${MAP_NAME} · CONQUEST</div><div class="sbt">${teams.map((t, k) => `<div class="sbc ${k ? 'en' : 'my'}"><div class="sbn">${TEAMS[t].name}<span>${tickets[t - 1]}</span></div><table><thead><tr><th>#</th><th>SQ</th><th></th><th class="nm">NAME</th><th>SCORE</th><th>K</th><th>D</th><th>A</th><th>REV</th><th>PING</th></tr></thead><tbody>${rows(t)}</tbody></table></div>`).join('')}</div>`;
  }
}
