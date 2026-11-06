import type { Roads } from '../world/roads';
import type { Footprint, WorldInfo } from '../world/streaming';

const $ = (id: string) => document.getElementById(id)!;

/** HUD: location, compass tape, minimap (real streets + footprints), speed cluster, altimeter. */
export class Hud {
  private map = document.createElement('canvas');
  private mctx: CanvasRenderingContext2D;
  private S = 0.5; // px per meter on the prerendered map
  private ox = 0; private oz = 0;
  private last: Record<string, string> = {};
  private mm = ($('mapC') as HTMLCanvasElement).getContext('2d')!;
  private cc = ($('compassC') as HTMLCanvasElement).getContext('2d')!;
  private ac = ($('altC') as HTMLCanvasElement).getContext('2d')!;
  private toastT = 0;

  constructor(private roads: Roads, info: WorldInfo) {
    const [x0, z0, x1, z1] = info.bounds; this.ox = x0 - 100; this.oz = z0 - 100;
    this.map.width = Math.ceil((x1 - x0 + 200) * this.S); this.map.height = Math.ceil((z1 - z0 + 200) * this.S);
    this.mctx = this.map.getContext('2d')!;
    const g = this.mctx; g.fillStyle = '#0f1a22'; g.fillRect(0, 0, this.map.width, this.map.height);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const e of roads.edges) { g.strokeStyle = e.kind === 1 ? '#5b6672' : '#6d7a63'; g.lineWidth = Math.max(2, e.w * this.S); g.beginPath(); e.pts.forEach(([x, z], k) => { const px = (x - this.ox) * this.S, pz = (z - this.oz) * this.S; k ? g.lineTo(px, pz) : g.moveTo(px, pz); }); g.stroke(); }
  }
  addFootprints(f: Footprint[]) {
    const g = this.mctx; g.fillStyle = '#2a333d'; g.strokeStyle = '#38424d'; g.lineWidth = 0.6;
    for (const b of f) { g.beginPath(); for (let i = 0; i < b.p.length; i += 2) { const px = (b.p[i] - this.ox) * this.S, pz = (b.p[i + 1] - this.oz) * this.S; i ? g.lineTo(px, pz) : g.moveTo(px, pz); } g.closePath(); g.fill(); if (b.h > 120) { g.fillStyle = '#34404c'; g.fill(); g.fillStyle = '#2a333d'; } }
  }
  private set(id: string, v: string) { if (this.last[id] !== v) { this.last[id] = v; $(id).textContent = v; } }

  toast(title: string, sub = '') { const t = $('toast'); t.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`; t.classList.add('show'); this.toastT = 2.2; }

  update(dt: number, s: { x: number; z: number; y: number; yaw: number; kmh: number; mode: 'drive' | 'fly'; gear: string; clear: number; vy: number; energy: number; boost: boolean }) {
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('show'); }
    const hx = Math.sin(s.yaw), hz = Math.cos(s.yaw);
    const d = this.roads.describe(s.x, s.z, hx, hz);
    this.set('street', d.street || (s.mode === 'fly' ? 'Over Midtown' : 'Off the grid'));
    this.set('cross', d.cross ? `at ${d.cross}` : '');
    this.set('hood', d.hood);
    this.set('speed', String(Math.round(s.kmh)));
    ($('barI') as HTMLElement).style.width = Math.min(100, (s.kmh / (s.mode === 'fly' ? 420 : 300)) * 100) + '%';
    ($('barI') as HTMLElement).style.background = s.boost ? 'var(--warn)' : s.mode === 'fly' ? 'var(--air)' : 'var(--sig)';
    $('chipDrive').classList.toggle('on', s.mode === 'drive'); $('chipFly').classList.toggle('on', s.mode === 'fly');
    this.set('gear', s.gear);
    $('alt').hidden = s.mode !== 'fly';
    this.drawCompass(s.yaw); this.drawMap(s.x, s.z, s.yaw, s.kmh, s.y);
    if (s.mode === 'fly') this.drawAlt(s.y, s.clear, s.vy);
  }

  private drawCompass(yaw: number) {
    const g = this.cc, W = 720, H = 68; g.clearRect(0, 0, W, H);
    const heading = ((-yaw * 180) / Math.PI + 180 + 360) % 360; // 0 = north (-z)
    g.font = '600 22px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let a = -90; a <= 90; a += 5) {
      const deg = Math.round(heading + a); const dd = ((deg % 360) + 360) % 360; const x = W / 2 + a * 4;
      const card = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[dd] as string | undefined;
      g.fillStyle = card ? (dd === 0 ? '#ffd23f' : '#f4f7fa') : 'rgba(244,247,250,.45)';
      if (card) g.fillText(card, x, 34); else if (dd % 15 === 0) g.fillRect(x - 1, 26, 2, 16); else g.fillRect(x - 1, 31, 2, 6);
    }
    g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(W / 2 - 8, 0); g.lineTo(W / 2 + 8, 0); g.lineTo(W / 2, 10); g.fill();
  }

  private drawMap(x: number, z: number, yaw: number, kmh: number, y: number) {
    const g = this.mm, W = 420; g.save(); g.clearRect(0, 0, W, W);
    g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); g.clip();
    const zoom = Math.max(0.9, 3.0 - kmh / 120 - Math.max(0, y - 30) / 160);
    g.translate(W / 2, W / 2); g.rotate(yaw + Math.PI); g.scale(zoom, zoom);
    g.drawImage(this.map, -(x - this.ox) * this.S, -(z - this.oz) * this.S);
    g.restore();
    g.save(); g.translate(W / 2, W / 2);
    g.fillStyle = '#ffd23f'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 8;
    g.beginPath(); g.moveTo(0, -16); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath(); g.fill(); g.restore();
    // north marker on the rim
    const a = yaw + Math.PI; const nx = W / 2 + Math.sin(-a) * (W / 2 - 22) * -1, nz = W / 2 - Math.cos(-a) * (W / 2 - 22);
    g.font = '700 22px "JetBrains Mono", monospace'; g.fillStyle = '#f4f7fa'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', nx, nz);
  }

  private drawAlt(y: number, clear: number, vy: number) {
    const g = this.ac, W = 148, H = 520; g.clearRect(0, 0, W, H);
    const px = 2.2; // px per meter
    g.font = '600 20px "JetBrains Mono", monospace'; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let m = Math.floor((y - H / 2 / px) / 10) * 10; m < y + H / 2 / px; m += 10) {
      const yy = H / 2 - (m - y) * px; if (m < 0) continue;
      g.fillStyle = m % 50 === 0 ? '#f4f7fa' : 'rgba(244,247,250,.4)'; g.fillRect(W - 26, yy - 1, m % 50 === 0 ? 22 : 12, 2);
      if (m % 50 === 0) g.fillText(String(m), W - 34, yy);
    }
    g.fillStyle = 'rgba(95,212,255,.18)'; g.fillRect(0, H / 2 - 22, W, 44);
    g.fillStyle = '#5fd4ff'; g.font = '700 26px "JetBrains Mono", monospace'; g.textAlign = 'left'; g.fillText(`${Math.round(y)}`, 10, H / 2);
    g.font = '600 15px "JetBrains Mono", monospace'; g.fillStyle = '#b9c4cf'; g.fillText('ALT M', 10, 24);
    g.fillText(`AGL ${Math.round(clear)}`, 10, H - 46); g.fillStyle = vy > 0.5 ? '#7cf2a4' : vy < -0.5 ? '#ff6b5e' : '#b9c4cf'; g.fillText(`${vy >= 0 ? '▲' : '▼'} ${Math.abs(vy).toFixed(1)}`, 10, H - 20);
  }
}
