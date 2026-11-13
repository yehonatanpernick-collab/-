// HUD: speed / rpm / drive mode / surface, compass, location, minimap, world map, settings.
import { SURFACES } from './world/collision.js';
import { store } from './util.js';

const $ = (id) => document.getElementById(id);

class HUD {
  constructor(game) {
    this.game = game;
    const meta = game.world.meta;
    this.units = store.get('rzr.units', 'kmh');
    this.img = new Image();
    this.img.src = 'assets/world/overview.jpg';
    this.mini = $('minimap').getContext('2d');
    this.fpsAcc = 0; this.fpsN = 0; this.regionT = 0;
    this.lastRegion = '';
    // compass strip
    const marks = [];
    for (let d = 0; d < 720; d += 15) {
      const dd = d % 360;
      const lab = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[dd];
      marks.push(`<span style="position:absolute;left:${d * 4}px;transform:translateX(-50%)">${lab ? `<b>${lab}</b>` : '·'}</span>`);
    }
    $('compass-strip').innerHTML = marks.join('');
    // big map
    this.big = $('bigmap-canvas');
    this.big.addEventListener('click', (e) => {
      const r = this.big.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 8192 - 4096, z = ((e.clientY - r.top) / r.height) * 8192 - 4096;
      if (Math.abs(x) < 3900 && Math.abs(z) < 3900) {
        const h = game.world.field.waterLevel(x, z) > game.world.field.baseHeight(x, z) ? null : 1;
        if (h) { game.resetVehicle(x, z, 0); this.toast('Teleported'); this.toggleMap(); }
        else this.toast('That is water — pick dry ground');
      }
    });
    this._settings();
  }

  _settings() {
    const g = this.game;
    const q = $('set-quality'); q.value = g.qualityName;
    q.onchange = () => { store.set('rzr.quality', q.value); location.reload(); };
    const v = $('set-vehicle'); v.value = g.vehicleVariant;
    v.onchange = async () => { store.set('rzr.vehicle', v.value); await g.loadVehicle(v.value); this.toast(v.value === 'b' ? 'RZR XP 1000 High Lifter (CC-BY-NC-SA model)' : 'RZR XP 1000'); };
    const t = $('set-time'); t.value = g.sky.time;
    t.oninput = () => { g.sky.time = +t.value; };
    const w = $('set-weather'); w.value = g.weather?.mode || 'clear';
    w.onchange = () => g.weather?.set(w.value);
    const u = $('set-units'); u.value = this.units;
    u.onchange = () => { this.units = u.value; store.set('rzr.units', u.value); };
    const s = $('set-sound'); s.checked = store.get('rzr.sound', '1') === '1';
    s.onchange = () => { store.set('rzr.sound', s.checked ? '1' : '0'); g.audio?.setEnabled(s.checked); };
  }

  toast(text, sub, ms = 2600) {
    const el = $('toast');
    el.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
    el.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => el.classList.remove('show'), ms);
  }

  toggleMap() {
    const m = $('bigmap'); m.hidden = !m.hidden;
    if (!m.hidden) this._drawBig();
  }

  region(x, z, y) {
    const meta = this.game.world.meta;
    for (const L of meta.lakes) if (Math.hypot(x - L.x, z - L.z) < L.r * 1.6) return L.name;
    const d = meta.drift; if (Math.hypot(x - d.x, z - d.z) < 260) return 'Drift Meadow — track';
    for (const b of meta.buildings) if (b.name && Math.hypot(x - b.x, z - b.z) < 60) return b.name;
    if (Math.hypot(x - meta.village.x, z - meta.village.z) < 380) return meta.village.name;
    let best = null, bd = 1e9;
    for (const r of meta.regions) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
        const dist = Math.hypot(a[0] + u * dx - x, a[1] + u * dz - z) / (a[2] + (b[2] - a[2]) * u + 150);
        if (dist < bd) { bd = dist; best = r.name; }
      }
    }
    if (bd < 1.4) return best;
    let pk = null, pd = 1e9;
    for (const p of meta.peaks) { const dd = Math.hypot(x - p.x, z - p.z); if (dd < pd) { pd = dd; pk = p; } }
    return pk && pd < 1500 ? `Slopes of ${pk.name}` : 'High wilderness';
  }

  _drawMap(ctx, W, H, cx, cz, scale, rot) {
    // scale: px per metre
    ctx.save();
    ctx.fillStyle = '#0b0f12'; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(rot);
    const s = scale * 8192 / 1024;
    if (this.img.complete) ctx.drawImage(this.img, (-4096 - cx) * scale, (-4096 - cz) * scale, 1024 * s, 1024 * s);
    ctx.restore();
  }

  _drawBig() {
    const c = this.big, S = 1024;
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    if (this.img.complete) ctx.drawImage(this.img, 0, 0, S, S);
    const meta = this.game.world.meta;
    const P = (x, z) => [(x + 4096) / 8192 * S, (z + 4096) / 8192 * S];
    ctx.font = '600 13px system-ui'; ctx.textAlign = 'center';
    const label = (t, x, z, col = '#fff') => { const [px, py] = P(x, z); ctx.fillStyle = 'rgba(0,0,0,0.55)'; const w = ctx.measureText(t).width + 8; ctx.fillRect(px - w / 2, py - 9, w, 17); ctx.fillStyle = col; ctx.fillText(t, px, py + 4); };
    for (const L of meta.lakes) label(L.name, L.x, L.z, '#9fe7ff');
    for (const p of meta.peaks) if (Math.abs(p.x) < 3900 && Math.abs(p.z) < 3900) label(`▲ ${p.name} ${Math.round(p.h)} m`, p.x, p.z, '#ffe7b0');
    label(meta.village.name, meta.village.x, meta.village.z - 90, '#ffd27a');
    label('Drift track', meta.drift.x, meta.drift.z - 120, '#ffd27a');
    for (const r of meta.rivers) for (const f of r.falls) if (f.drop > 40) label(`${r.name} falls ${Math.round(f.drop)} m`, f.top[0], f.top[2], '#bfe9ff');
    const p = this.game.phys.pos, [px, py] = P(p.x, p.z);
    ctx.fillStyle = '#f0a640'; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
  }

  update(dt, game) {
    const ph = game.phys;
    const v = ph.forwardSpeed() * 3.6;
    const sp = this.units === 'mph' ? Math.abs(v) / 1.609 : Math.abs(v);
    $('speed').textContent = Math.round(sp);
    document.querySelector('#speedo .unit').textContent = this.units === 'mph' ? 'mph' : 'km/h';
    $('rpm-fill').style.width = `${Math.min(100, ph.engineRpm / 86)}%`;
    $('gear').textContent = ph.reversing ? 'R' : (ph.input.boost ? 'D+' : 'D');
    $('awd').textContent = ph.awd ? 'AWD' : '2WD';
    const counts = {};
    for (const w of ph.wheels) if (w.contact) counts[w.surface] = (counts[w.surface] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    $('surface').textContent = top ? SURFACES[top[0]].label : 'airborne';
    // heading: forward vector (x east, -z north)
    const f = ph.forward(this._f || (this._f = ph.pos.clone()));
    let hdg = Math.atan2(f.x, -f.z) * 180 / Math.PI; if (hdg < 0) hdg += 360;
    const camF = game.camera.getWorldDirection(this._c || (this._c = ph.pos.clone()));
    let ch = Math.atan2(camF.x, -camF.z) * 180 / Math.PI; if (ch < 0) ch += 360;
    const w = $('compass').clientWidth;
    $('compass-strip').style.left = `${w / 2 - (ch + 360) * 4}px`;
    this.regionT -= dt;
    if (this.regionT < 0) {
      this.regionT = 0.5;
      const r = this.region(ph.pos.x, ph.pos.z, ph.pos.y);
      $('region').textContent = r;
      if (r !== this.lastRegion && this.lastRegion) this.toast(r);
      this.lastRegion = r;
      $('coords').textContent = `${Math.round(ph.pos.y)} m · ${Math.round(hdg)}° · ${game.sky.time.toFixed(1).replace('.', ':').padStart(4, '0')}`.replace(/:(\d)$/, (m, d) => ':' + String(Math.round(+d * 6)).padStart(2, '0'));
    }
    // minimap, rotated so "up" is the camera heading
    const ctx = this.mini, W = ctx.canvas.width;
    this._drawMap(ctx, W, W, ph.pos.x, ph.pos.z, 0.3, -ch * Math.PI / 180);
    ctx.fillStyle = '#f0a640';
    ctx.save(); ctx.translate(W / 2, W / 2); ctx.rotate((hdg - ch) * Math.PI / 180);
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    // fps
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { $('fps').textContent = `${Math.round(this.fpsN / this.fpsAcc)} fps · ${game.terrain.stats.nodes} tiles`; this.fpsAcc = 0; this.fpsN = 0; }
  }
}

export async function create(game) { const h = new HUD(game); try { await h.img.decode(); } catch { /* minimap stays dark until loaded */ } return h; }
