// Front-end UI: main menu, settings, deploy screen (map spawn selection + class loadouts),
// pause menu, end-of-round screen, loading screen.
import { CLASSES, CLASS_LIST, WEAPONS, TEAMS, RULES } from '../shared/config.js';
import { MAP_NAME } from '../shared/world.js';
import { MAPB } from './hud.js';
import { t, toggleLang, curLang } from './i18n.js';

const $ = (s) => document.querySelector(s);

export const DEFAULTS = { name: '', quality: '', fov: 78, sens: 1, adsSens: 0.7, invert: false, volume: 0.8, showFps: false, renderScale: 1, bots: 24, skill: 0.55, autoAdsTouch: false, server: '' };
export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('ih_settings') || '{}'); } catch (e) { s = {}; }
  const out = { ...DEFAULTS, ...s };
  if (!out.name) out.name = 'Recruit-' + ((Math.random() * 900 + 100) | 0);
  return out;
}
export function saveSettings(s) { try { localStorage.setItem('ih_settings', JSON.stringify(s)); } catch (e) { /* storage unavailable */ } }

const langBtn = () => `<button class="mbtn sm lang" data-lang-toggle><b>${t('lang')}</b></button>`;

export class UI {
  constructor(settings, handlers) {
    this.s = settings; this.h = handlers;
    this.cls = settings.lastClass || 'assault';
    this.spawnAt = 'hq';
    this.buildMenu();
    this.buildSettings();
    this.buildDeploy();
    this.buildPause();
    this.buildEnd();
    document.querySelectorAll('[data-lang-toggle]').forEach((b) => b.addEventListener('click', () => toggleLang()));
  }
  loading(p, txt) {
    const l = $('#loading');
    l.querySelector('.lbar i').style.width = (p * 100).toFixed(0) + '%';
    if (txt) l.querySelector('.ltxt').textContent = txt;
  }
  hideLoading() { $('#loading').classList.add('gone'); setTimeout(() => $('#loading').remove(), 900); }

  buildMenu() {
    const m = $('#menu');
    const s = this.s;
    m.innerHTML = `
      <div class="mlogo"><div class="mt">IRON HORIZON</div><div class="ms">ALL-OUT WARFARE · ${MAP_NAME} · ${t('mapTitle')}</div></div>
      <div class="mcol">
        <label class="fld"><span>${t('callsign')}</span><input id="mName" maxlength="16" value="${s.name.replace(/"/g, '')}"></label>
        <button class="mbtn primary" id="mPlay"><b>${t('quick')}</b><span>${t('quickSub')}</span></button>
        <button class="mbtn" id="mOnline"><b>${t('multi')}</b><span id="mOnlineSub">${t('multiSub')}</span></button>
        <div class="mrow">
          <label class="fld sm"><span>${t('players')}</span><select id="mBots">${[12, 16, 24, 32].map((n) => `<option ${n === s.bots ? 'selected' : ''} value="${n}">${n / 2} vs ${n / 2}</option>`).join('')}</select></label>
          <label class="fld sm"><span>${t('aiSkill')}</span><select id="mSkill">${[[0.3, t('recruit')], [0.55, t('regular')], [0.8, t('veteran')]].map(([v, n]) => `<option ${Math.abs(v - s.skill) < 0.01 ? 'selected' : ''} value="${v}">${n}</option>`).join('')}</select></label>
        </div>
        <div class="mrow"><button class="mbtn sm" id="mSettings">${t('settings')}</button><button class="mbtn sm" id="mControls">${t('controls')}</button>${langBtn()}</div>
        <div id="mControlsBox" class="hidden">
          <div class="ctl"><kbd>WASD</kbd> ${t('ctlMove')} <kbd>SHIFT</kbd> ${t('ctlSprint')} <kbd>SPACE</kbd> ${t('ctlJump')} <kbd>C</kbd> ${t('ctlCrouch')} <kbd>CTRL</kbd> ${t('ctlHoldCrouch')}</div>
          <div class="ctl"><kbd>LMB</kbd> ${t('ctlFire')} <kbd>RMB</kbd> ${t('ctlAim')} <kbd>R</kbd> ${t('ctlReload')} <kbd>1 2 3</kbd>/<kbd>WHEEL</kbd> ${t('ctlWeapons')} <kbd>G</kbd> ${t('ctlGrenade')}</div>
          <div class="ctl"><kbd>E</kbd> ${t('ctlEnter')} <kbd>Q</kbd> ${t('ctlSpot')} <kbd>TAB</kbd> ${t('ctlScore')} <kbd>ESC</kbd> ${t('ctlMenu')}</div>
          <div class="ctl">${t('tankCtl')} <kbd>WASD</kbd> ${t('tankDrive')} <kbd>MOUSE</kbd> ${t('tankTurret')} <kbd>LMB</kbd> ${t('tankFire')} <kbd>RMB</kbd> ${t('tankZoom')} <kbd>2</kbd> ${t('tankCoax')} <kbd>E</kbd> ${t('tankExit')}</div>
          <div class="ctl">${t('mobileCtl')}</div>
        </div>
        <div class="mfoot">${t('footer')}</div>
      </div>
      <div id="mMsg"></div>`;
    $('#mName').addEventListener('change', (e) => { s.name = e.target.value.trim().slice(0, 16) || s.name; saveSettings(s); });
    $('#mBots').addEventListener('change', (e) => { s.bots = +e.target.value; saveSettings(s); });
    $('#mSkill').addEventListener('change', (e) => { s.skill = +e.target.value; saveSettings(s); });
    $('#mPlay').onclick = () => { this.click(); s.name = $('#mName').value.trim().slice(0, 16) || s.name; saveSettings(s); this.h.play(); };
    $('#mOnline').onclick = () => { this.click(); s.name = $('#mName').value.trim().slice(0, 16) || s.name; saveSettings(s); this.h.online(); };
    $('#mSettings').onclick = () => { this.click(); this.showSettings(); };
    $('#mControls').onclick = () => { this.click(); $('#mControlsBox').classList.toggle('hidden'); };
  }
  click() { this.h.audio?.play('ui', { ui: true }); }
  menuMsg(txt) { $('#mMsg').innerHTML = txt; }
  showMenu(v) { $('#menu').classList.toggle('hidden', !v); }

  buildSettings() {
    const st = $('#settings');
    const s = this.s;
    const q = s.quality || (matchMedia('(pointer: coarse)').matches ? 'low' : 'high');
    st.innerHTML = `<div class="panel"><div class="ph">${t('settingsTitle')}</div>
      <label class="srow"><span>${t('quality')}</span><select id="sQ">${['low', 'medium', 'high', 'ultra'].map((k) => `<option value="${k}" ${k === q ? 'selected' : ''}>${k.toUpperCase()}</option>`).join('')}</select></label>
      <label class="srow"><span>${t('renderScale')} <b id="sRSv">${Math.round(s.renderScale * 100)}%</b></span><input type="range" id="sRS" min="0.5" max="1" step="0.05" value="${s.renderScale}"></label>
      <label class="srow"><span>${t('fov')} <b id="sFovV">${s.fov}°</b></span><input type="range" id="sFov" min="60" max="105" step="1" value="${s.fov}"></label>
      <label class="srow"><span>${t('sens')} <b id="sSensV">${s.sens.toFixed(2)}</b></span><input type="range" id="sSens" min="0.2" max="3" step="0.05" value="${s.sens}"></label>
      <label class="srow"><span>${t('adsSens')} <b id="sAdsV">${s.adsSens.toFixed(2)}</b></span><input type="range" id="sAds" min="0.2" max="1.5" step="0.05" value="${s.adsSens}"></label>
      <label class="srow"><span>${t('volume')} <b id="sVolV">${Math.round(s.volume * 100)}%</b></span><input type="range" id="sVol" min="0" max="1" step="0.05" value="${s.volume}"></label>
      <label class="srow chk"><span>${t('invert')}</span><input type="checkbox" id="sInv" ${s.invert ? 'checked' : ''}></label>
      <label class="srow chk"><span>${t('showFps')}</span><input type="checkbox" id="sFps" ${s.showFps ? 'checked' : ''}></label>
      <label class="srow chk"><span>${t('touchAim')}</span><input type="checkbox" id="sAuto" ${s.autoAdsTouch ? 'checked' : ''}></label>
      <label class="srow"><span>${t('server')}</span><input id="sSrv" placeholder="${t('serverPh')}" value="${s.server || ''}"></label>
      ${langBtn()}
      <button class="mbtn primary" id="sClose"><b>${t('done')}</b></button></div>`;
    const bind = (id, key, fmt, cb) => $(id).addEventListener('input', (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? +e.target.value : e.target.value; s[key] = v; if (fmt) fmt(v); saveSettings(s); cb && cb(v); });
    bind('#sQ', 'quality', null, (v) => this.h.quality(v));
    bind('#sRS', 'renderScale', (v) => ($('#sRSv').textContent = Math.round(v * 100) + '%'), (v) => this.h.renderScale(v));
    bind('#sFov', 'fov', (v) => ($('#sFovV').textContent = v + '°'));
    bind('#sSens', 'sens', (v) => ($('#sSensV').textContent = v.toFixed(2)));
    bind('#sAds', 'adsSens', (v) => ($('#sAdsV').textContent = v.toFixed(2)));
    bind('#sVol', 'volume', (v) => ($('#sVolV').textContent = Math.round(v * 100) + '%'), (v) => this.h.volume(v));
    bind('#sInv', 'invert'); bind('#sFps', 'showFps', null, (v) => document.body.classList.toggle('showfps', v)); bind('#sAuto', 'autoAdsTouch'); bind('#sSrv', 'server');
    document.body.classList.toggle('showfps', !!s.showFps);
    $('#sClose').onclick = () => { this.click(); st.classList.add('hidden'); };
  }
  showSettings() { $('#settings').classList.remove('hidden'); }

  // ---------------------------------------------------------------- deploy
  buildDeploy() {
    const d = $('#deploy');
    d.innerHTML = `
      <div class="dtop"><div class="dteam" id="dTeam"></div><div class="dmap">${MAP_NAME} · ${t('mapTitle')}</div><div class="dtk" id="dTk"></div></div>
      <div class="dbody">
        <div class="dclasses" id="dClasses"></div>
        <div class="dmapwrap"><canvas id="dMap"></canvas><div id="dSpawns"></div></div>
      </div>
      <div class="dbottom"><div id="dInfo"></div><button class="mbtn primary" id="dGo"><b>${t('deploy')}</b><span id="dGoSub"></span></button></div>`;
    const cl = $('#dClasses');
    cl.innerHTML = CLASS_LIST.map((c) => {
      const C = CLASSES[c];
      const pw = WEAPONS[C.primary], gw = WEAPONS[C.gadget];
      return `<div class="dcls" data-c="${c}"><div class="dci">${C.icon}</div><div class="dcn">${C.name}</div><div class="dcd">${C.desc}</div><div class="dcl"><span>${pw.name}</span><span>${WEAPONS[C.secondary].name}</span><span>${gw.name}</span><span>${C.grenades}× ${t('frag')}</span></div></div>`;
    }).join('');
    cl.querySelectorAll('.dcls').forEach((e) => e.addEventListener('click', () => { this.cls = e.dataset.c; this.s.lastClass = this.cls; saveSettings(this.s); this.click(); this.refreshClasses(); }));
    this.refreshClasses();
    $('#dGo').onclick = () => { this.click(); this.h.spawn(this.spawnAt, this.cls); };
  }
  refreshClasses() { document.querySelectorAll('.dcls').forEach((e) => e.classList.toggle('sel', e.dataset.c === this.cls)); }
  openDeploy(game) {
    this.game = game;
    $('#deploy').classList.remove('hidden');
    game.hud.show(false);
    game.input.showTouch(false);
    game.input.unlock();
    this.drawnFor = null;
    this.mapImg = game.hud.map;
    if (!game.spawnOpts.includes(this.spawnAt)) this.spawnAt = 'hq';
    this.updateDeploy(game, true);
  }
  closeDeploy() { $('#deploy').classList.add('hidden'); }
  updateDeploy(game, force) {
    if ($('#deploy').classList.contains('hidden')) return;
    const now = performance.now();
    if (!force && now - (this.lastDU || 0) < 150) return;
    this.lastDU = now;
    const myT = game.myTeam, enT = myT === 1 ? 2 : 1;
    $('#dTeam').innerHTML = `<span class="my">${TEAMS[myT].name}</span>`;
    $('#dTk').innerHTML = `<span class="my">${game.tickets[myT - 1]}</span> — <span class="en">${game.tickets[enT - 1]}</span>`;
    const cv = $('#dMap');
    const wrap = cv.parentElement;
    const ww = wrap.clientWidth, wh = wrap.clientHeight;
    const img = this.mapImg.canvas;
    const sc = Math.min(ww / img.width, wh / img.height);
    const w = Math.floor(img.width * sc), h = Math.floor(img.height * sc);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    // flip so own HQ is at the bottom
    const flip = myT === 1; // own HQ at the bottom
    const g = cv.getContext('2d');
    g.save();
    if (flip) { g.translate(w, h); g.rotate(Math.PI); }
    g.drawImage(img, 0, 0, w, h);
    g.restore();
    const toS = (x, z) => { let px = (x - MAPB.x0) / (MAPB.x1 - MAPB.x0) * w, py = (z - MAPB.z0) / (MAPB.z1 - MAPB.z0) * h; if (flip) { px = w - px; py = h - py; } return [px, py]; };
    // friendly positions
    for (const rp of game.rps.values()) {
      const s = rp.cur || rp.snaps[rp.snaps.length - 1]; if (!s || !(s.fl & 1)) continue;
      const info = game.info.get(rp.id); if (!info || info.team !== myT) continue;
      const [x, y] = toS(s.x, s.z);
      g.fillStyle = info.squad === game.mySquad ? '#7cff6b' : '#4fb3ff';
      g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
    }
    for (const rv of game.vehs.values()) { const s = rv.cur || rv.snaps[rv.snaps.length - 1]; if (!s || !s.alive || rv.team !== myT) continue; const [x, y] = toS(s.x, s.z); g.fillStyle = '#4fb3ff'; g.fillRect(x - 5, y - 4, 10, 8); }
    // spawn buttons
    const sp = $('#dSpawns');
    const opts = game.spawnOpts || ['hq'];
    const W = game.W;
    const items = [];
    for (const o of opts) {
      let x, z, label, cls = 'my';
      if (o === 'hq') { const hq = W.hq[myT]; x = hq.x; z = hq.z; label = t('hq'); cls = 'hq'; }
      else if (o === 'tank') { const rv = [...game.vehs.values()].find((v) => v.team === myT && v.cur?.alive); if (!rv) continue; x = rv.cur.x; z = rv.cur.z; label = '▰ TANK'; cls = 'veh'; }
      else if (o === 'beacon') { const e = game.ents.find((e) => e.ty === 'beacon' && e.team === myT && e.squad === game.mySquad); if (!e) continue; x = e.x; z = e.z; label = '⌖ BEACON'; cls = 'sq'; }
      else if (o.startsWith('sq:')) { const rp = game.rps.get(+o.slice(3)); const s = rp?.cur; if (!s) continue; x = s.x; z = s.z; label = '◆ ' + (game.info.get(+o.slice(3))?.name || t('squad')); cls = 'sq'; }
      else { const f = W.flags.find((f) => f.id === o); if (!f) continue; x = f.x; z = f.z; label = f.id; cls = 'my flag'; }
      items.push({ o, x, z, label, cls });
    }
    for (const f of W.flags) {
      if (opts.includes(f.id)) continue;
      const st = game.flagStates[f.id];
      items.push({ o: null, x: f.x, z: f.z, label: f.id, cls: 'flag ' + (st.owner === 0 ? 'neu' : st.owner === myT ? 'my dis' : 'en') });
    }
    const key = JSON.stringify(items.map((i) => [i.o, i.label, i.cls, Math.round(i.x / 4), Math.round(i.z / 4)])) + w + 'x' + h + this.spawnAt + curLang();
    if (key !== this.drawnFor) {
      this.drawnFor = key;
      const ox = cv.offsetLeft, oy = cv.offsetTop;
      sp.innerHTML = items.map((i) => { const [x, y] = toS(i.x, i.z); return `<div class="spn ${i.cls} ${i.o === this.spawnAt ? 'sel' : ''} ${i.o ? '' : 'nos'}" data-o="${i.o || ''}" style="left:${ox + x}px;top:${oy + y}px">${i.label}</div>`; }).join('');
      sp.querySelectorAll('.spn').forEach((e) => e.addEventListener('click', () => { if (!e.dataset.o) return; this.spawnAt = e.dataset.o; this.click(); this.drawnFor = null; this.updateDeploy(game, true); }));
    }
    const rem = game.meState.respawn || 0;
    const alive = game.meState.alive;
    const btn = $('#dGo');
    btn.disabled = rem > 0.05 || alive || game.phase === 'end';
    $('#dGoSub').textContent = game.phase === 'end' ? t('roundOver') : rem > 0.05 ? `${t('redeployIn')} ${rem.toFixed(0)}` : alive ? '' : (this.spawnAt === 'hq' ? t('atHq') : this.spawnAt.startsWith('sq:') ? t('squadMate') : this.spawnAt.toUpperCase());
    $('#dInfo').innerHTML = `<b>${CLASSES[this.cls].name}</b> · ${t('selectSpawn')}`;
  }

  // ---------------------------------------------------------------- pause / end
  buildPause() {
    const p = $('#pause');
    p.innerHTML = `<div class="panel"><div class="ph">${t('paused')}</div>
      <button class="mbtn primary" id="pResume"><b>${t('resume')}</b></button>
      <button class="mbtn" id="pRedeploy"><b>${t('redeploy')}</b><span>${t('redeploySub')}</span></button>
      <button class="mbtn" id="pSettings"><b>${t('settings')}</b></button>
      ${langBtn()}
      <button class="mbtn" id="pQuit"><b>${t('quit')}</b></button></div>`;
    $('#pResume').onclick = () => { this.click(); this.hidePause(); this.h.resume(); };
    $('#pRedeploy').onclick = () => { this.click(); this.hidePause(); this.h.redeploy(); };
    $('#pSettings').onclick = () => { this.click(); this.showSettings(); };
    $('#pQuit').onclick = () => { this.click(); this.hidePause(); this.h.quit(); };
  }
  showPause() { $('#pause').classList.remove('hidden'); }
  hidePause() { $('#pause').classList.add('hidden'); }
  isPaused() { return !$('#pause').classList.contains('hidden'); }
  buildEnd() { }
  showEnd(game, winner) {
    const e = $('#endscreen');
    const won = winner === game.myTeam;
    const top = [...game.roster].sort((a, b) => b.score - a.score).slice(0, 3);
    const me = game.roster.find((r) => r.id === game.myId);
    e.innerHTML = `<div class="eb ${won ? 'win' : 'lose'}"><div class="et">${won ? t('victory') : t('defeat')}</div><div class="es">${TEAMS[winner].name} ${t('winsSuffix')}</div></div>
      <div class="etop">${top.map((r, i) => `<div class="ep"><div class="epn">${[t('mvp'), t('second'), t('third')][i]}</div><div class="epm ${r.team === game.myTeam ? 'my' : 'en'}">${r.name}</div><div class="eps">${r.score} · ${r.kills}/${r.deaths}</div></div>`).join('')}</div>
      ${me ? `<div class="eme">${t('yourScore')} <b>${me.score}</b> · ${t('kills')} <b>${me.kills}</b> · ${t('deaths')} <b>${me.deaths}</b> · ${t('revives')} <b>${me.revives}</b></div>` : ''}
      <div class="enext">${t('nextRound')}</div>`;
    e.classList.remove('hidden');
    game.input.unlock();
  }
  hideEnd() { $('#endscreen').classList.add('hidden'); }
}
export { RULES };
