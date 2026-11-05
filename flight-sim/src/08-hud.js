// ============================================================================
//  HUD (conformal, projected through the real camera) + minimap
// ============================================================================
const hudCv = $('hud'), hud = hudCv.getContext('2d'); hud.direction = 'ltr';
let HW = 0, HH = 0, DPR = 1;
function resizeHud() { DPR = Math.min(devicePixelRatio || 1, 2); HW = innerWidth; HH = innerHeight; hudCv.width = HW * DPR; hudCv.height = HH * DPR; }
const _pv = new THREE.Vector3();
function proj(p) { _pv.copy(p).project(camera); if (_pv.z > 1 || _pv.z < -1) return null; return { x: (_pv.x * 0.5 + 0.5) * HW, y: (-_pv.y * 0.5 + 0.5) * HH }; }
function projDir(d) { return proj(_pv.copy(camera.position).addScaledVector(d, 1000).clone()); }

const HUDC = { main: '#a6ffc9', dim: 'rgba(166,255,201,0.5)', warn: '#ff6b5c', amber: '#f4c56a' };
function hudText(t, x, y, size = 14, align = 'center', col = HUDC.main, weight = 500) { hud.font = `${weight} ${size}px "IBM Plex Mono", ui-monospace, monospace`; hud.textAlign = align; hud.fillStyle = col; hud.fillText(t, x, y); }

function drawHUD(fm, S) {
  hud.setTransform(DPR, 0, 0, DPR, 0, 0); hud.clearRect(0, 0, HW, HH); hud.direction = 'ltr';
  if (!S.hudOn || !fm || S.state === 'menu') return;
  const T = fm.tele; if (!T.att) return;
  const att = T.att; const col = HUDC.main;
  hud.lineWidth = 1.6; hud.strokeStyle = col; hud.fillStyle = col; hud.shadowColor = 'rgba(0,20,8,0.7)'; hud.shadowBlur = 2;
  const cx = HW / 2, cy = HH / 2; const R = Math.min(HW, HH) * 0.36;
  const small = HW < 720;
  const conformal = S.cam === 'chase' || S.cam === 'cockpit';
  // ---- pitch ladder (projected along aircraft heading)
  if (conformal) {
  const h = att.hdg * DEG; const fwdH = V3(Math.sin(h), 0, -Math.cos(h)), rightH = V3(Math.cos(h), 0, Math.sin(h));
  hud.save(); hud.beginPath(); hud.arc(cx, cy, R * 0.82, 0, Math.PI * 2); hud.clip();
  for (let p = -90; p <= 90; p += 5) {
    if (Math.abs(p - att.pitch * RAD) > 22) continue;
    const pr = p * DEG; const d = fwdH.clone().multiplyScalar(Math.cos(pr)); d.y = Math.sin(pr);
    const c0 = camera.position.clone().addScaledVector(d, 1000);
    const w = p === 0 ? 300 : 70; const gap = p === 0 ? 40 : 26;
    const a = proj(c0.clone().addScaledVector(rightH, -w)), b = proj(c0.clone().addScaledVector(rightH, -gap)), c = proj(c0.clone().addScaledVector(rightH, gap)), e = proj(c0.clone().addScaledVector(rightH, w));
    if (!a || !b || !c || !e) continue;
    hud.setLineDash(p < 0 ? [7, 5] : []); hud.lineWidth = p === 0 ? 1.8 : 1.4;
    hud.beginPath(); hud.moveTo(a.x, a.y); hud.lineTo(b.x, b.y); hud.moveTo(c.x, c.y); hud.lineTo(e.x, e.y); hud.stroke();
    if (p !== 0) {
      // end ticks toward horizon
      const dn = p > 0 ? 1 : -1; const ang = Math.atan2(e.y - a.y, e.x - a.x); const tx = -Math.sin(ang) * 7 * dn * -1, ty = Math.cos(ang) * 7 * dn * -1;
      hud.beginPath(); hud.moveTo(a.x, a.y); hud.lineTo(a.x + tx, a.y + ty); hud.moveTo(e.x, e.y); hud.lineTo(e.x + tx, e.y + ty); hud.stroke();
      hud.setLineDash([]); hudText(String(Math.abs(p)), e.x + 16, e.y + 4, 12, 'left'); hudText(String(Math.abs(p)), a.x - 16, a.y + 4, 12, 'right');
    }
  }
  hud.setLineDash([]); hud.restore();
  // ---- boresight / waterline
  const bs = projDir(att.f);
  if (bs) { hud.beginPath(); hud.moveTo(bs.x - 26, bs.y); hud.lineTo(bs.x - 10, bs.y); hud.lineTo(bs.x - 5, bs.y + 7); hud.lineTo(bs.x, bs.y); hud.lineTo(bs.x + 5, bs.y + 7); hud.lineTo(bs.x + 10, bs.y); hud.lineTo(bs.x + 26, bs.y); hud.stroke(); }
  // ---- flight path vector
  if (T.V > 3) {
    const fp = projDir(fm.vel.clone().normalize());
    if (fp) { hud.beginPath(); hud.arc(fp.x, fp.y, 7, 0, Math.PI * 2); hud.moveTo(fp.x - 18, fp.y); hud.lineTo(fp.x - 7, fp.y); hud.moveTo(fp.x + 7, fp.y); hud.lineTo(fp.x + 18, fp.y); hud.moveTo(fp.x, fp.y - 7); hud.lineTo(fp.x, fp.y - 14); hud.stroke(); S.fpv = fp; }
  }
  }
  // ---- runway outline & approach guidance
  const rw = S.nearRunway;
  if (rw && rw.dist < 16000) {
    const pts = rw.r.corners.map(p => proj(p));
    if (pts.every(Boolean)) { hud.strokeStyle = HUDC.dim; hud.beginPath(); pts.forEach((p, i) => i ? hud.lineTo(p.x, p.y) : hud.moveTo(p.x, p.y)); hud.closePath(); hud.stroke(); hud.strokeStyle = col; }
    if (rw.onApp && !fm.wow) {
      // ILS-style deviation scales
      const gx = cx + R * 0.95, gy = cy; const lx = cx, ly = cy + R * 0.95;
      hud.strokeStyle = HUDC.dim; for (let i = -2; i <= 2; i++) { if (!i) continue; hud.beginPath(); hud.arc(gx, gy + i * 22, 3, 0, 7); hud.stroke(); hud.beginPath(); hud.arc(lx + i * 22, ly, 3, 0, 7); hud.stroke(); }
      hud.strokeStyle = col; hud.fillStyle = HUDC.amber;
      const gsd = clamp(rw.gsDev / 0.35, -2.4, 2.4), lcd = clamp(rw.locDev / 1.25, -2.4, 2.4);
      hud.beginPath(); hud.moveTo(gx, gy + gsd * 22 - 7); hud.lineTo(gx + 6, gy + gsd * 22); hud.lineTo(gx, gy + gsd * 22 + 7); hud.lineTo(gx - 6, gy + gsd * 22); hud.fill();
      hud.beginPath(); hud.moveTo(lx - lcd * 22 - 7, ly); hud.lineTo(lx - lcd * 22, ly - 6); hud.lineTo(lx - lcd * 22 + 7, ly); hud.lineTo(lx - lcd * 22, ly + 6); hud.fill();
      hudText('GS', gx, gy - 66, 11, 'center', HUDC.dim); hudText(`${rw.r.ap.id} ${(rw.dist / 1852).toFixed(1)} NM`, lx, ly + 26, 12, 'center', HUDC.dim);
    }
  }
  // ---- rings course marker
  if (S.ring) { const p = proj(S.ring.pos); if (p) { hud.strokeStyle = HUDC.amber; hud.beginPath(); hud.moveTo(p.x, p.y - 12); hud.lineTo(p.x + 12, p.y); hud.lineTo(p.x, p.y + 12); hud.lineTo(p.x - 12, p.y); hud.closePath(); hud.stroke(); hudText(`${Math.round(S.ring.dist)} m`, p.x, p.y - 18, 11, 'center', HUDC.amber); hud.strokeStyle = col; } }
  // ---- speed tape (left) & altitude tape (right)
  const tapeH = Math.min(HH * 0.42, 300), tx = cx - R * 1.25 - (small ? -10 : 0), ax = cx + R * 1.25 + (small ? -10 : 0);
  const ias = T.ias * KT, alt = fm.pos.y * FT;
  const tape = (x, val, step, major, fmt, left) => {
    hud.save(); hud.beginPath(); hud.rect(x - 50, cy - tapeH / 2, 100, tapeH); hud.clip();
    const pxPer = tapeH / (step * 10);
    const base = Math.floor(val / step) * step;
    for (let v = base - step * 6; v <= base + step * 6; v += step) {
      if (v < 0 && fmt === 'spd') continue;
      const y = cy - (v - val) * pxPer; const isMaj = Math.round(v / major) * major === v;
      hud.beginPath(); hud.moveTo(x + (left ? 20 : -20), y); hud.lineTo(x + (left ? (isMaj ? 8 : 14) : (isMaj ? -8 : -14)), y); hud.stroke();
      if (isMaj) hudText(String(v), x + (left ? 2 : -2), y + 4, 12, left ? 'right' : 'left', HUDC.dim);
    }
    hud.restore();
    // box
    hud.beginPath(); hud.rect(x - (left ? 38 : -2), cy - 13, 54, 26); hud.fillStyle = 'rgba(0,12,4,0.55)'; hud.fill(); hud.stroke();
    hudText(fmt === 'spd' ? String(Math.round(val)) : String(Math.round(val / 10) * 10), x + (left ? 12 : 25), cy + 6, 16, 'center', col, 700);
  };
  tape(tx, ias, 10, 50, 'spd', true); tape(ax, alt, 100, 500, 'alt', false);
  hudText('KT', tx - 10, cy - tapeH / 2 - 8, 11, 'center', HUDC.dim); hudText('FT', ax + 26, cy - tapeH / 2 - 8, 11, 'center', HUDC.dim);
  // speed trend & reference speeds
  hudText(`GS ${Math.round(T.gs * KT)}`, tx - 10, cy + tapeH / 2 + 18, 12, 'center', HUDC.dim);
  hudText(`M ${T.mach.toFixed(2)}`, tx - 10, cy + tapeH / 2 + 34, 12, 'center', HUDC.dim);
  // vertical speed
  const vs = fm.vel.y * FPM;
  hudText(`${vs >= 0 ? '+' : '−'}${Math.abs(Math.round(vs / 10) * 10)}`, ax + 26, cy + tapeH / 2 + 18, 12, 'center', Math.abs(vs) > 2500 ? HUDC.amber : HUDC.dim);
  const agl = (fm.pos.y - S.groundH) * FT - (fm.d.gear[1].p.y * -FT);
  if (agl < 2500) hudText(`R ${Math.max(0, Math.round(agl))}`, ax + 26, cy + tapeH / 2 + 34, 13, 'center', agl < 200 ? HUDC.amber : col, 700);
  // ---- heading tape
  const hy = small ? 54 : 34, hwid = Math.min(HW * 0.5, 420);
  hud.save(); hud.beginPath(); hud.rect(cx - hwid / 2, hy - 20, hwid, 34); hud.clip();
  const ppd = hwid / 60;
  for (let d = Math.floor(att.hdg / 5) * 5 - 35; d <= att.hdg + 35; d += 5) {
    const x = cx + (d - att.hdg) * ppd; const dd = (d + 360) % 360; const maj = dd % 10 === 0;
    hud.beginPath(); hud.moveTo(x, hy); hud.lineTo(x, hy + (maj ? 9 : 5)); hud.stroke();
    if (dd % 30 === 0) hudText(dd === 0 ? 'N' : dd === 90 ? 'E' : dd === 180 ? 'S' : dd === 270 ? 'W' : String(dd / 10).padStart(2, '0'), x, hy - 4, 12, 'center', HUDC.dim);
  }
  hud.restore();
  hud.beginPath(); hud.moveTo(cx, hy + 12); hud.lineTo(cx - 6, hy + 20); hud.lineTo(cx + 6, hy + 20); hud.closePath(); hud.fill();
  hudText(String(Math.round(att.hdg)).padStart(3, '0'), cx, hy + 36, 14, 'center', col, 700);
  // ---- bottom-left data block
  const bx = tx - 40, by = cy + tapeH / 2 + 62;
  if (!small && !isTouch) {
    hudText(`G ${fm.nz.toFixed(1)}`, bx, by, 13, 'left', Math.abs(fm.nz) > (fm.d.gMax || 4) * 0.9 ? HUDC.warn : col);
    hudText(`α ${(T.alpha * RAD).toFixed(1)}°`, bx, by + 16, 13, 'left', fm.stallWarn ? HUDC.warn : HUDC.dim);
    hudText(`MAX ${fm.gmax.toFixed(1)}`, bx, by + 32, 11, 'left', HUDC.dim);
  }
  // ---- autopilot annunciator
  if (fm.ap) hudText(`AP  ALT ${Math.round(fm.ap.alt * FT / 100) * 100}  HDG ${String(Math.round(fm.ap.hdg)).padStart(3, '0')}  SPD ${Math.round(fm.ap.spd * KT)}`, cx, hy + 56, 12, 'center', HUDC.amber);
  // ---- warnings
  const W = []; const tt = performance.now() / 1000; const blink = Math.sin(tt * 10) > -0.2;
  if (fm.stallWarn) W.push(['STALL', HUDC.warn]);
  if (S.pullUp) W.push(['PULL UP', HUDC.warn]);
  if (S.gearWarn) W.push(['GEAR', HUDC.warn]);
  if (fm.d.vne && T.ias > fm.d.vne) W.push(['OVERSPEED', HUDC.warn]);
  if (fm.parking && fm.in.throttle > 0.5 && fm.wow) W.push(['PARKING BRAKE', HUDC.amber]);
  if (S.bankWarn) W.push(['BANK ANGLE', HUDC.amber]);
  if (fm.flap > 0 && T.ias > fm.d.flaps.vmax[fm.flap]) W.push(['FLAP OVERSPEED', HUDC.amber]);
  W.forEach(([t, c], i) => { if (c === HUDC.warn && !blink) return; hudText(t, cx, cy + R * 0.55 + i * 26, 22, 'center', c, 700); });
  if (S.cat && S.cat.state === 'hold') hudText('CATAPULT READY — ENTER', cx, cy - R * 0.55, 18, 'center', HUDC.amber, 700);
  hud.shadowBlur = 0;
}

// ---------------------------------------------------------------- Minimap
const mm = $('minimap'), mmc = mm.getContext('2d'); mmc.direction = 'ltr'; let mapImg = null; const MAP_R = 34000;
function buildMapImage() {
  const N = 320; const img = document.createElement('canvas'); img.width = N; img.height = N; const c = img.getContext('2d'); const id = c.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i / N * 2 - 1) * MAP_R, z = (j / N * 2 - 1) * MAP_R; const h = terrainHeight(x, z); const k = (j * N + i) * 4;
    let r, g, b;
    if (h < 0) { const d = clamp(-h / 150, 0, 1); r = 20 - d * 10; g = 70 - d * 30; b = 105 - d * 30; }
    else if (h < 6) { r = 170; g = 160; b = 120; }
    else { const t = clamp(h / 2600, 0, 1); r = lerp(62, 200, t * t) + (h > 2100 ? 50 : 0); g = lerp(92, 190, t * t) + (h > 2100 ? 50 : 0); b = lerp(52, 170, t * t) + (h > 2100 ? 60 : 0); }
    const sh = clamp((terrainHeight(x + 200, z - 200) - h) / 120, -0.4, 0.4); r *= 1 - sh; g *= 1 - sh; b *= 1 - sh;
    id.data[k] = r; id.data[k + 1] = g; id.data[k + 2] = b; id.data[k + 3] = 255;
  }
  c.putImageData(id, 0, 0);
  const cd = WORLD.city; c.fillStyle = 'rgba(210,205,190,0.55)'; c.beginPath(); c.arc((cd.x / MAP_R * 0.5 + 0.5) * N, (cd.z / MAP_R * 0.5 + 0.5) * N, cd.r / MAP_R * 0.5 * N * 0.8, 0, 7); c.fill();
  mapImg = img;
}
function drawMinimap(fm, S) {
  if (!mapImg || !fm) return;
  const big = $('minimapWrap').classList.contains('big');
  const W = mm.width, H = mm.height; mmc.setTransform(1, 0, 0, 1, 0, 0); mmc.direction = 'ltr'; mmc.clearRect(0, 0, W, H);
  const span = big ? MAP_R * 2 : 14000; // meters across
  const px = fm.pos.x, pz = fm.pos.z; const scale = W / span; const N = mapImg.width; const mPerPx = MAP_R * 2 / N;
  mmc.save(); mmc.translate(W / 2, H / 2);
  const cxm = big ? 0 : px, czm = big ? 0 : pz;
  mmc.imageSmoothingEnabled = true;
  mmc.drawImage(mapImg, (-MAP_R - cxm) * scale, (-MAP_R - czm) * scale, MAP_R * 2 * scale, MAP_R * 2 * scale);
  const toM = (x, z) => [(x - cxm) * scale, (z - czm) * scale];
  mmc.lineCap = 'round';
  for (const r of runwayInfo) { const [x1, y1] = toM(r.thr.x, r.thr.z), [x2, y2] = toM(r.far.x, r.far.z); mmc.strokeStyle = '#f2f2ee'; mmc.lineWidth = Math.max(3, r.ap.wid * scale); mmc.beginPath(); mmc.moveTo(x1, y1); mmc.lineTo(x2, y2); mmc.stroke(); mmc.fillStyle = '#ffffff'; mmc.font = `600 ${big ? 18 : 20}px "IBM Plex Mono", monospace`; mmc.textAlign = 'center'; mmc.fillText(r.ap.id, x1 + 24, y1); }
  { const C = WORLD.carrier; const [x, y] = toM(C.x, C.z); mmc.fillStyle = '#c9d2dc'; mmc.fillRect(x - 4, y - 14, 8, 28); }
  if (S.rings) S.rings.forEach((r, i) => { if (r.done) return; const [x, y] = toM(r.pos.x, r.pos.z); mmc.strokeStyle = i === S.ringIdx ? '#ffb23f' : 'rgba(255,178,63,0.5)'; mmc.lineWidth = 3; mmc.beginPath(); mmc.arc(x, y, 7, 0, 7); mmc.stroke(); });
  const [ax, ay] = toM(px, pz); const hdg = fm.tele.att ? fm.tele.att.hdg * DEG : 0;
  mmc.translate(ax, ay); mmc.rotate(hdg); mmc.fillStyle = '#ffb23f'; mmc.strokeStyle = '#1a1004'; mmc.lineWidth = 2;
  mmc.beginPath(); mmc.moveTo(0, -16); mmc.lineTo(10, 12); mmc.lineTo(0, 6); mmc.lineTo(-10, 12); mmc.closePath(); mmc.fill(); mmc.stroke();
  mmc.restore();
  if (!big) return;
  mmc.fillStyle = 'rgba(6,9,13,0.6)'; mmc.fillRect(0, H - 34, W, 34); mmc.fillStyle = '#e7eef6'; mmc.font = '500 20px "IBM Plex Mono", monospace'; mmc.textAlign = 'left';
  mmc.fillText(`${(fm.pos.x / 1000).toFixed(1)}  ${(-fm.pos.z / 1000).toFixed(1)} km`, 12, H - 10); mmc.textAlign = 'right'; mmc.fillText('N↑', W - 12, H - 10);
}
