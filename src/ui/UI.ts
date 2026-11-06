import './styles.css';
import type { MapRenderer } from './MapRenderer';
import type { Input } from '../core/Input';
import type { QualityLevel } from '../core/Quality';

/** DOM helper */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

export interface Settings {
  quality: QualityLevel; resScale: number; volume: number; sensitivity: number; camDist: number;
  showFps: boolean; time: number; weather: string; touch: boolean;
}

// ------------------------------------------------------------------ main menu & settings
export class Menu {
  el: HTMLElement;
  private card: HTMLElement;
  private prog!: HTMLElement; private label!: HTMLElement;
  onStart?: () => void;
  onSettings?: (s: Partial<Settings>) => void;
  onChallenge?: (id: string) => void;
  inGame = false;

  constructor(private settings: Settings, private sources: string) {
    this.el = h('div', { id: 'menu' });
    this.card = h('div', { class: 'menu-card' });
    this.el.appendChild(this.card);
    document.body.appendChild(this.el);
    this.showLoading();
  }

  private header(): string {
    return `<div class="logo"><div class="l1">SAN FRANCISCO</div><div class="l2">SKYDRIVE</div></div>`;
  }

  showLoading(): void {
    this.card.innerHTML = `${this.header()}<div class="tag">Reconstructing San Francisco from real geographic data…</div>
      <div class="progress"><div></div></div><div class="loadlabel">Starting</div>`;
    this.prog = this.card.querySelector('.progress > div')!;
    this.label = this.card.querySelector('.loadlabel')!;
  }

  progress(p: number, label: string): void { if (this.prog) { this.prog.style.width = `${Math.round(p * 100)}%`; this.label.textContent = label; } }

  error(msg: string): void {
    this.card.innerHTML = `${this.header()}<div class="tag" style="color:#ff8080">${msg}</div>`;
  }

  showMain(): void {
    this.el.classList.remove('hidden');
    this.el.classList.toggle('ingame', this.inGame);
    this.card.innerHTML = `${this.header()}
      <div class="tag">Drive and fly a futuristic electric car through a geographically authentic San Francisco — real streets, real hills, real landmarks.</div>
      <div class="menu-buttons">
        <button class="btn primary" data-a="start">${this.inGame ? 'Resume' : 'Start Driving'}<span class="k">${this.inGame ? 'Esc' : 'Enter'}</span></button>
        <button class="btn" data-a="challenges">Challenges<span class="k">optional</span></button>
        <button class="btn" data-a="settings">Settings &amp; Graphics<span class="k"></span></button>
        <button class="btn" data-a="controls">Controls<span class="k"></span></button>
      </div>
      <div class="credits">${this.sources}</div>`;
    this.card.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const a = b.getAttribute('data-a');
      if (a === 'start') this.onStart?.();
      if (a === 'settings') this.showSettings();
      if (a === 'controls') this.showControls();
      if (a === 'challenges') this.showChallenges();
    }));
  }

  challenges: { id: string; name: string; desc: string; best: number | null; mode: string }[] = [];

  showChallenges(): void {
    const rows = this.challenges.map((c) => `<button class="btn" data-c="${c.id}"><span><b>${c.name}</b><br><span style="font-weight:400;font-size:12px;color:var(--muted)">${c.desc}</span></span><span class="k">${c.mode.toUpperCase()}${c.best ? `<br>best ${c.best.toFixed(1)}s` : ''}</span></button>`).join('');
    this.card.innerHTML = `${this.header()}<div class="tag">Optional courses built from real geography. Free roam is never interrupted.</div><div class="menu-buttons">${rows}</div><button class="btn back" data-a="back">Back</button>`;
    this.card.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => this.onChallenge?.(b.getAttribute('data-c')!)));
    this.card.querySelector('[data-a=back]')!.addEventListener('click', () => this.showMain());
  }

  showControls(): void {
    this.card.innerHTML = `${this.header()}<div class="panel keys">
      <b>W / ↑</b><span>Accelerate · forward thrust</span><b>S / ↓</b><span>Brake / reverse · air brake</span>
      <b>A D / ← →</b><span>Steer · yaw &amp; bank</span><b>Space</b><span>Handbrake (drift)</span>
      <b>Shift</b><span>Boost</span><b>F</b><span>Transform: drive ⇄ flight (auto-landing)</span>
      <b>E / Q</b><span>Ascend / descend (flight)</span><b>I / K</b><span>Pitch nose down / up (flight)</span>
      <b>Mouse drag · wheel</b><span>Orbit / zoom camera</span><b>C</b><span>Camera: chase · cockpit · far · cinematic</span>
      <b>V</b><span>Landmark flyover</span><b>M</b><span>Map (click to set GPS waypoint)</span>
      <b>T / Y</b><span>Time of day / weather</span><b>R</b><span>Reset onto nearest road</span>
      <b>L</b><span>Toggle stats</span><b>Esc</b><span>Pause menu</span>
      <b>Gamepad</b><span>Sticks + triggers (RT/LT), bumpers ascend/descend</span></div>
      <button class="btn back" data-a="back">Back</button>`;
    this.card.querySelector('[data-a=back]')!.addEventListener('click', () => this.showMain());
  }

  showSettings(): void {
    const s = this.settings;
    const seg = (name: string, opts: [string, string][], cur: string) => `<div class="seg" data-s="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    this.card.innerHTML = `${this.header()}<div class="panel">
      <div class="row"><label>Graphics quality</label>${seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], s.quality)}</div>
      <div class="row"><label>Resolution scale</label><input type="range" min="0.5" max="1" step="0.05" value="${s.resScale}" data-r="resScale"></div>
      <div class="row"><label>Volume</label><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-r="volume"></div>
      <div class="row"><label>Mouse sensitivity</label><input type="range" min="0.3" max="2.5" step="0.1" value="${s.sensitivity}" data-r="sensitivity"></div>
      <div class="row"><label>Camera distance</label><input type="range" min="0.6" max="2.4" step="0.1" value="${s.camDist}" data-r="camDist"></div>
      <div class="row"><label>Time of day</label>${seg('time', [['7.6', 'Morning'], ['14', 'Afternoon'], ['18.3', 'Golden'], ['19.15', 'Sunset'], ['22.5', 'Night']], String(s.time))}</div>
      <div class="row"><label>Weather</label>${seg('weather', [['clear', 'Clear'], ['cloudy', 'Cloudy'], ['foggy', 'Foggy'], ['rain', 'Rain']], s.weather)}</div>
      <div class="row"><label>Touch controls</label>${seg('touch', [['1', 'On'], ['0', 'Off']], s.touch ? '1' : '0')}</div>
      <div class="row"><label>Performance stats</label>${seg('showFps', [['1', 'Show'], ['0', 'Hide']], s.showFps ? '1' : '0')}</div>
      </div><button class="btn back" data-a="back">Back</button>`;
    this.card.querySelectorAll('.seg').forEach((sg) => sg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      sg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
      const k = sg.getAttribute('data-s')!, v = b.getAttribute('data-v')!;
      const patch: Partial<Settings> = {};
      if (k === 'quality') patch.quality = v as QualityLevel;
      if (k === 'time') patch.time = +v;
      if (k === 'weather') patch.weather = v;
      if (k === 'touch') patch.touch = v === '1';
      if (k === 'showFps') patch.showFps = v === '1';
      Object.assign(this.settings, patch); this.onSettings?.(patch);
    })));
    this.card.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', () => {
      const k = r.getAttribute('data-r') as keyof Settings;
      const v = +(r as HTMLInputElement).value;
      (this.settings as unknown as Record<string, number>)[k] = v;
      this.onSettings?.({ [k]: v } as Partial<Settings>);
    }));
    this.card.querySelector('[data-a=back]')!.addEventListener('click', () => this.showMain());
  }

  hide(): void { this.el.classList.add('hidden'); }
  get visible(): boolean { return !this.el.classList.contains('hidden'); }
}

// ------------------------------------------------------------------ HUD
export interface HudState {
  speedKmh: number; mode: string; modeClass: string; battery: number; alt: number; agl: number; vs: number; heading: number;
  hood: string; gps: string; flying: boolean; gear: string;
  challenge: { name: string; idx: number; total: number; time: number; dist: number } | null;
  arrowAngle: number | null; stats: string | null; navDist: number | null;
}

export class HUD {
  el: HTMLElement;
  private q: Record<string, HTMLElement> = {};
  private compass: HTMLCanvasElement; private altCanvas: HTMLCanvasElement; private mini: HTMLCanvasElement;
  private toastTimer = 0;
  constructor() {
    this.el = h('div', { id: 'hud' }, `
      <div id="loc" class="glass"><div class="hood">San Francisco</div><div class="gps">—</div></div>
      <div id="hud-top"><div id="compass" class="glass"><canvas width="720" height="68"></canvas></div></div>
      <div id="toast" class="glass"><div class="t1"></div><div class="t2"></div></div>
      <svg id="arrow" class="hidden" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 L20 20 L12 15 L4 20 Z"/></svg>
      <div id="chal" class="glass hidden"><div class="n"></div><div class="s"></div></div>
      <div id="alt" class="glass"><div class="lbl">ALT</div><div class="v">0</div><canvas width="152" height="300"></canvas><div class="vs">AGL 0 m</div></div>
      <div id="minimap"><canvas width="420" height="420"></canvas></div>
      <div id="speedo" class="glass"><div><div class="num">0</div></div><div class="col"><div class="unit">KM/H</div><div class="mode">DRIVE</div>
        <div class="batt"><div class="bar"><div></div></div><span class="bp">92%</span></div><div class="gear">GPS <b class="nav">—</b></div></div></div>
      <div id="hint" class="glass"><b>F</b> transform · <b>E/Q</b> up/down · <b>C</b> camera · <b>M</b> map · <b>V</b> flyover · <b>Esc</b> menu</div>
      <pre id="stats" class="glass hidden"></pre>`);
    document.body.appendChild(this.el);
    document.body.appendChild(h('div', { id: 'flash' }));
    for (const id of ['loc', 'toast', 'arrow', 'chal', 'alt', 'speedo', 'stats', 'hint']) this.q[id] = this.el.querySelector('#' + id) as HTMLElement;
    this.compass = this.el.querySelector('#compass canvas')!;
    this.altCanvas = this.el.querySelector('#alt canvas')!;
    this.mini = this.el.querySelector('#minimap canvas')!;
    this.el.classList.add('hidden');
  }

  show(v: boolean): void { this.el.classList.toggle('hidden', !v); }

  toast(t1: string, t2 = '', ms = 2600): void {
    const t = this.q.toast;
    t.querySelector('.t1')!.textContent = t1; t.querySelector('.t2')!.textContent = t2;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
  }

  flash(): void { const f = document.getElementById('flash')!; f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 160); }

  update(s: HudState): void {
    const sp = this.q.speedo;
    sp.querySelector('.num')!.textContent = String(Math.round(s.speedKmh));
    const mode = sp.querySelector('.mode')! as HTMLElement;
    mode.textContent = s.mode; mode.className = 'mode ' + s.modeClass;
    (sp.querySelector('.bar > div') as HTMLElement).style.width = `${s.battery * 100}%`;
    (sp.querySelector('.bar > div') as HTMLElement).style.background = s.battery > 0.2 ? 'var(--good)' : 'var(--bad)';
    sp.querySelector('.bp')!.textContent = `${Math.round(s.battery * 100)}%`;
    sp.querySelector('.nav')!.textContent = s.navDist !== null ? `${s.navDist > 1000 ? (s.navDist / 1000).toFixed(1) + ' km' : Math.round(s.navDist) + ' m'}` : s.gear;
    this.q.loc.querySelector('.hood')!.textContent = s.hood;
    this.q.loc.querySelector('.gps')!.textContent = s.gps;
    const alt = this.q.alt;
    alt.style.opacity = s.flying ? '1' : '0.35';
    document.body.classList.toggle('flying', s.flying);
    alt.querySelector('.v')!.textContent = `${Math.round(s.alt)}`;
    alt.querySelector('.vs')!.textContent = `AGL ${Math.round(s.agl)} m · ${s.vs >= 0 ? '▲' : '▼'}${Math.abs(s.vs).toFixed(1)}`;
    this.drawCompass(s.heading);
    this.drawAlt(s.alt, s.vs);
    const c = this.q.chal;
    if (s.challenge) {
      c.classList.remove('hidden');
      c.querySelector('.n')!.textContent = s.challenge.name;
      c.querySelector('.s')!.textContent = `CP ${s.challenge.idx + 1}/${s.challenge.total}  ·  ${s.challenge.time.toFixed(1)} s  ·  ${Math.round(s.challenge.dist)} m`;
    } else c.classList.add('hidden');
    const ar = this.q.arrow;
    if (s.arrowAngle !== null) { ar.classList.remove('hidden'); ar.style.transform = `rotate(${s.arrowAngle}rad)`; } else ar.classList.add('hidden');
    const st = this.q.stats;
    if (s.stats) { st.classList.remove('hidden'); st.textContent = s.stats; } else st.classList.add('hidden');
  }

  private drawCompass(hd: number): void {
    const c = this.compass, ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const pxPerDeg = W / 120;
    ctx.textAlign = 'center';
    for (let d = Math.floor(hd - 60); d <= hd + 60; d++) {
      const x = W / 2 + (d - hd) * pxPerDeg;
      const dd = ((d % 360) + 360) % 360;
      if (dd % 5 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(x - 1, H - (dd % 15 === 0 ? 18 : 10), 2, dd % 15 === 0 ? 18 : 10);
      }
      if (dd % 45 === 0) {
        const lab = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][dd / 45];
        ctx.fillStyle = dd === 0 ? '#3fd6ff' : '#eef2f6'; ctx.font = '700 24px Inter, sans-serif';
        ctx.fillText(lab, x, 30);
      } else if (dd % 15 === 0) { ctx.fillStyle = 'rgba(238,242,246,0.6)'; ctx.font = '500 16px Inter'; ctx.fillText(String(dd), x, 28); }
    }
    ctx.fillStyle = '#3fd6ff'; ctx.beginPath(); ctx.moveTo(W / 2 - 8, 0); ctx.lineTo(W / 2 + 8, 0); ctx.lineTo(W / 2, 10); ctx.fill();
  }

  private drawAlt(alt: number, vs: number): void {
    const c = this.altCanvas, ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const pxPerM = H / 200;
    ctx.font = '500 20px Inter'; ctx.textAlign = 'right';
    for (let m = Math.floor((alt - 100) / 10) * 10; m <= alt + 100; m += 10) {
      const y = H / 2 - (m - alt) * pxPerM;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(W - (m % 50 === 0 ? 30 : 16), y - 1, m % 50 === 0 ? 30 : 16, 2);
      if (m % 50 === 0) { ctx.fillStyle = '#eef2f6'; ctx.fillText(String(m), W - 38, y + 7); }
    }
    ctx.fillStyle = '#3fd6ff'; ctx.fillRect(0, H / 2 - 2, W, 4);
    ctx.fillStyle = vs >= 0 ? '#4cd964' : '#ffb020';
    const vh = Math.max(-H / 2, Math.min(H / 2, -vs * 6));
    ctx.fillRect(6, Math.min(H / 2, H / 2 + vh), 8, Math.abs(vh));
  }

  /** rotating heading-up minimap */
  drawMinimap(map: MapRenderer, p: { x: number; z: number; heading: number }, route: number[], target: { x: number; z: number } | null, cp: { x: number; z: number } | null, zoom: number): void {
    const c = this.mini, ctx = c.getContext('2d')!;
    const W = c.width;
    ctx.save();
    ctx.fillStyle = '#0b1a26'; ctx.fillRect(0, 0, W, W);
    const k = zoom; // screen px per base px
    ctx.translate(W / 2, W / 2);
    ctx.rotate(-p.heading);
    const [bx, by] = map.toPx(p.x, p.z);
    ctx.scale(k, k);
    ctx.drawImage(map.base, -bx, -by);
    ctx.restore();
    const toS = (x: number, z: number): [number, number] => {
      const [qx, qy] = map.toPx(x, z);
      const dx = (qx - bx) * k, dy = (qy - by) * k;
      const cs = Math.cos(-p.heading), sn = Math.sin(-p.heading);
      return [W / 2 + dx * cs - dy * sn, W / 2 + dx * sn + dy * cs];
    };
    map.overlay(ctx, toS, k * map.scale, { x: p.x, z: p.z, heading: 0 }, route, target, cp, false);
    // north indicator
    ctx.save(); ctx.translate(W / 2, W / 2); ctx.rotate(-p.heading);
    ctx.fillStyle = '#3fd6ff'; ctx.font = '700 22px Inter'; ctx.textAlign = 'center'; ctx.fillText('N', 0, -W / 2 + 30);
    ctx.restore();
  }

  setTouch(on: boolean): void { this.q.hint.classList.toggle('hidden', on); }
}

// ------------------------------------------------------------------ full-screen map
export class FullMap {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private cx = 0; private cz = 0; private zoom = 0.35;
  open = false;
  onWaypoint?: (x: number, z: number) => void;
  onClear?: () => void;
  onLandmark?: (id: string) => void;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private pinch: number | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  state: { player: { x: number; z: number; heading: number }; route: number[]; target: { x: number; z: number } | null; cp: { x: number; z: number } | null } = { player: { x: 0, z: 0, heading: 0 }, route: [], target: null, cp: null };

  constructor(private map: MapRenderer, landmarks: { id: string; n: string }[]) {
    this.el = h('div', { id: 'map', class: 'hidden' }, `<div class="bar"><span class="title">SAN FRANCISCO</span><span class="sp"></span>
      ${landmarks.filter((l) => !['coit_hill', 'embarcadero', 'unionsq'].includes(l.id)).slice(0, 12).map((l) => `<button class="chip" data-l="${l.id}">${l.n}</button>`).join('')}
      <button class="chip" data-a="clear">Clear route</button><button class="chip" data-a="close">Close (M)</button></div>
      <canvas></canvas><div class="legend glass">Tap / click to set a GPS waypoint · drag to pan · wheel / pinch to zoom · ★ landmarks</div>`);
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.el.querySelectorAll('[data-l]').forEach((b) => b.addEventListener('click', () => this.onLandmark?.(b.getAttribute('data-l')!)));
    this.el.querySelector('[data-a=clear]')!.addEventListener('click', () => this.onClear?.());
    this.el.querySelector('[data-a=close]')!.addEventListener('click', () => this.toggle(false));
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => { try { cv.setPointerCapture(e.pointerId); } catch { /* */ } this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.drag = { x: e.clientX, y: e.clientY, moved: false }; });
    cv.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId); if (!prev) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.zoom = Math.max(0.12, Math.min(4, this.zoom * (d / this.pinch)));
        this.pinch = d; if (this.drag) this.drag.moved = true;
      } else if (this.drag) {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        if (Math.abs(e.clientX - this.drag.x) + Math.abs(e.clientY - this.drag.y) > 6) this.drag.moved = true;
        const k = this.zoom * map.scale * devicePixelRatio;
        this.cx -= (dx * devicePixelRatio) / k; this.cz -= (dy * devicePixelRatio) / k;
      }
      this.draw();
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.drag && !this.drag.moved && this.pointers.size === 0) {
        const r = cv.getBoundingClientRect();
        const [wx, wz] = this.screenToWorld((e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio);
        this.onWaypoint?.(wx, wz);
      }
      if (this.pointers.size === 0) this.drag = null;
      this.draw();
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { this.zoom = Math.max(0.12, Math.min(4, this.zoom * (e.deltaY > 0 ? 0.88 : 1.14))); this.draw(); e.preventDefault(); }, { passive: false });
  }

  private screenToWorld(sx: number, sy: number): [number, number] {
    const k = this.zoom * this.map.scale * devicePixelRatio;
    return [this.cx + (sx - this.canvas.width / 2) / k, this.cz + (sy - this.canvas.height / 2) / k];
  }

  toggle(v?: boolean): void {
    this.open = v ?? !this.open;
    this.el.classList.toggle('hidden', !this.open);
    if (this.open) { this.cx = this.state.player.x; this.cz = this.state.player.z; this.draw(); }
  }

  draw(): void {
    if (!this.open) return;
    const cv = this.canvas;
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * devicePixelRatio)); cv.height = Math.max(1, Math.round(r.height * devicePixelRatio));
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#0b1a26'; ctx.fillRect(0, 0, cv.width, cv.height);
    const k = this.zoom * devicePixelRatio;
    const [bx, by] = this.map.toPx(this.cx, this.cz);
    ctx.save();
    ctx.translate(cv.width / 2, cv.height / 2); ctx.scale(k, k);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.map.base, -bx, -by);
    ctx.restore();
    const toS = (x: number, z: number): [number, number] => { const [qx, qy] = this.map.toPx(x, z); return [cv.width / 2 + (qx - bx) * k, cv.height / 2 + (qy - by) * k]; };
    this.map.overlay(ctx, toS, k * this.map.scale, this.state.player, this.state.route, this.state.target, this.state.cp, true);
  }
}

// ------------------------------------------------------------------ touch controls
export class MobileControls {
  el: HTMLElement;
  private wheelAngle = 0;
  onTransform?: () => void; onCamera?: () => void; onMap?: () => void; onPause?: () => void;
  constructor(private input: Input) {
    this.el = h('div', { id: 'touch', class: 'hidden' }, `
      <div id="wheel"><svg viewBox="-100 -100 200 200"><g id="wg">
        <circle r="92" fill="rgba(16,20,26,0.5)" stroke="rgba(255,255,255,0.25)" stroke-width="10"/>
        <circle r="22" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.35)" stroke-width="3"/>
        <rect x="-86" y="-6" width="64" height="12" rx="6" fill="rgba(255,255,255,0.3)"/><rect x="22" y="-6" width="64" height="12" rx="6" fill="rgba(255,255,255,0.3)"/>
        <rect x="-6" y="22" width="12" height="62" rx="6" fill="rgba(255,255,255,0.3)"/><circle cy="-86" r="7" fill="#3fd6ff"/></g></svg></div>
      <div class="tb" id="t-acc">GO</div><div class="tb" id="t-brk">BRAKE</div><div class="tb" id="t-boost">BOOST</div>
      <div class="tb hidden" id="t-up">▲</div><div class="tb hidden" id="t-dn">▼</div>
      <div class="tb" id="t-fly">FLY</div><div class="tb" id="t-hb">DRIFT</div>
      <div class="tb" id="t-cam">CAM</div><div class="tb" id="t-map">MAP</div><div class="tb" id="t-pause">❚❚</div>`);
    document.body.appendChild(this.el);
    const hold = (id: string, on: (v: boolean) => void) => {
      const b = this.el.querySelector('#' + id) as HTMLElement;
      const set = (v: boolean) => { b.classList.toggle('on', v); on(v); };
      b.addEventListener('pointerdown', (e) => { try { b.setPointerCapture(e.pointerId); } catch { /* synthetic */ } set(true); e.preventDefault(); });
      b.addEventListener('pointerup', () => set(false)); b.addEventListener('pointercancel', () => set(false)); b.addEventListener('lostpointercapture', () => set(false));
    };
    const tap = (id: string, f: () => void) => this.el.querySelector('#' + id)!.addEventListener('pointerdown', (e) => { e.preventDefault(); f(); });
    hold('t-acc', (v) => (input.virtual.throttle = v ? 1 : 0));
    hold('t-brk', (v) => (input.virtual.brake = v ? 1 : 0));
    hold('t-boost', (v) => (input.virtual.boost = v));
    hold('t-hb', (v) => (input.virtual.handbrake = v));
    hold('t-up', (v) => (input.virtual.lift = v ? 1 : input.virtual.lift === 1 ? 0 : input.virtual.lift));
    hold('t-dn', (v) => (input.virtual.lift = v ? -1 : input.virtual.lift === -1 ? 0 : input.virtual.lift));
    tap('t-fly', () => this.onTransform?.()); tap('t-cam', () => this.onCamera?.()); tap('t-map', () => this.onMap?.()); tap('t-pause', () => this.onPause?.());
    // virtual steering wheel: rotate by dragging around its centre
    const wheel = this.el.querySelector('#wheel') as HTMLElement, g = this.el.querySelector('#wg') as SVGGElement;
    let start: number | null = null, base = 0;
    const ang = (e: PointerEvent) => { const r = wheel.getBoundingClientRect(); return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))); };
    wheel.addEventListener('pointerdown', (e) => { try { wheel.setPointerCapture(e.pointerId); } catch { /* synthetic */ } start = ang(e); base = this.wheelAngle; e.preventDefault(); });
    wheel.addEventListener('pointermove', (e) => {
      if (start === null) return;
      let d = ang(e) - start; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.wheelAngle = Math.max(-2.2, Math.min(2.2, base + d));
      input.virtual.steer = this.wheelAngle / 2.2;
      g.setAttribute('transform', `rotate(${(this.wheelAngle * 180) / Math.PI})`);
    });
    const release = () => {
      start = null;
      const spring = () => {
        if (start !== null) return;
        this.wheelAngle *= 0.75;
        if (Math.abs(this.wheelAngle) < 0.01) this.wheelAngle = 0;
        input.virtual.steer = this.wheelAngle / 2.2;
        g.setAttribute('transform', `rotate(${(this.wheelAngle * 180) / Math.PI})`);
        if (this.wheelAngle !== 0) requestAnimationFrame(spring);
      };
      spring();
    };
    wheel.addEventListener('pointerup', release); wheel.addEventListener('pointercancel', release);
  }

  show(v: boolean): void { this.el.classList.toggle('hidden', !v); this.input.virtual.active = v; document.body.classList.toggle('touch', v); }

  setFlight(f: boolean): void {
    this.el.querySelector('#t-up')!.classList.toggle('hidden', !f);
    this.el.querySelector('#t-dn')!.classList.toggle('hidden', !f);
    this.el.querySelector('#t-fly')!.textContent = f ? 'LAND' : 'FLY';
    this.el.querySelector('#t-hb')!.classList.toggle('hidden', f);
  }
}
