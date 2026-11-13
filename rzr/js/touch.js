// On-screen controls for phones/tablets (landscape): analog steering strip on the left thumb,
// GAS / BRAKE pedals on the right, handbrake + turbo, utility buttons, drag-to-orbit and
// pinch-to-zoom on the open screen, optional tilt steering and fullscreen. Multi-touch safe.
export class TouchControls {
  constructor(input) {
    this.input = input;
    this.t = input.touch; // { axis, gas, brake, hb, boost }
    this.tilt = false; this.tiltBase = null;
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div id="t-wheel" aria-label="Steering"><div id="t-wheel-track"></div><div id="t-wheel-thumb"></div><span class="t-hint">STEER</span></div>
      <div id="t-pedals">
        <button data-h="brake" id="t-brake">BRAKE<small>hold to reverse</small></button>
        <button data-h="gas" id="t-gas">GAS</button>
      </div>
      <div id="t-aux">
        <button data-h="hb">HAND<br>BRAKE</button>
        <button data-h="boost">TURBO</button>
      </div>
      <div id="t-bar">
        <button data-k="KeyC">CAM</button><button data-k="KeyR">RESET</button><button data-k="KeyM">MAP</button>
        <button data-k="KeyG">WEATHER</button><button data-k="KeyL">LIGHTS</button><button data-k="KeyQ">AWD</button>
        <button data-a="tilt" id="t-tilt">TILT</button><button data-a="full">⛶</button>
      </div>
      <div id="t-rotate" hidden>Tip: landscape gives more room</div>`;
    document.body.appendChild(this.root);
    document.body.classList.add('touch');
    this._wheel(); this._buttons(); this._canvasGestures(); this._orientation();
  }

  _wheel() {
    const w = this.root.querySelector('#t-wheel'), th = this.root.querySelector('#t-wheel-thumb');
    let id = null;
    const set = (e) => {
      const r = w.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * 2 - 1;            // -1 left .. 1 right
      const v = Math.max(-1, Math.min(1, x * 1.15));
      // soft dead-zone + progressive response: precise near centre, full lock at the edge
      const a = Math.sign(v) * Math.pow(Math.max(0, (Math.abs(v) - 0.04) / 0.96), 1.35);
      this.t.axis = -a;                                            // physics: +steer = left
      th.style.transform = `translateX(${v * (r.width / 2 - 34)}px)`;
    };
    const end = (e) => { if (e.pointerId !== id) return; id = null; this.t.axis = 0; th.style.transform = 'translateX(0)'; w.classList.remove('on'); };
    w.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; w.setPointerCapture(id); w.classList.add('on'); set(e); this._buzz(8); });
    w.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    w.addEventListener('pointerup', end); w.addEventListener('pointercancel', end); w.addEventListener('lostpointercapture', end);
  }

  _buttons() {
    for (const b of this.root.querySelectorAll('button')) {
      const h = b.dataset.h, k = b.dataset.k, a = b.dataset.a;
      let id = null;
      const down = (e) => {
        e.preventDefault(); e.stopPropagation(); id = e.pointerId; b.setPointerCapture(id); b.classList.add('on'); this._buzz(10);
        if (h) this.t[h] = 1;
        else if (k) this.input.pressed.add(k);
        else if (a === 'tilt') this._toggleTilt(b);
        else if (a === 'full') this._fullscreen();
      };
      const up = (e) => { if (id !== null && e.pointerId !== id) return; id = null; if (a !== 'tilt') b.classList.remove('on'); if (h) this.t[h] = 0; };
      b.addEventListener('pointerdown', down);
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  // two-finger pinch on the open screen zooms the chase camera (one finger orbit is handled in Input)
  _canvasGestures() {
    const cv = document.getElementById('view'), pts = new Map();
    let d0 = 0;
    cv.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, e); if (pts.size === 2) d0 = this._dist(pts); });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, e);
      if (pts.size === 2) { const d = this._dist(pts); if (d0) this.input.mouse.wheel += (d0 - d) * 0.04; d0 = d; this.input.mouse.dragging = false; }
    });
    const rm = (e) => { pts.delete(e.pointerId); d0 = 0; };
    cv.addEventListener('pointerup', rm); cv.addEventListener('pointercancel', rm);
  }
  _dist(m) { const [a, b] = [...m.values()]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }

  async _toggleTilt(b) {
    if (this.tilt) { this.tilt = false; b.classList.remove('on'); removeEventListener('deviceorientation', this._onTilt); return; }
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') throw new Error('denied');
      }
      this.tiltBase = null;
      this._onTilt = (e) => {
        if (e.gamma == null && e.beta == null) return;
        // in landscape the steering axis is beta (flipped by orientation angle)
        const ang = (screen.orientation && screen.orientation.angle) || 0;
        const raw = (ang === 270 || ang === -90) ? -e.beta : e.beta;
        if (this.tiltBase === null) this.tiltBase = raw;
        const v = Math.max(-1, Math.min(1, (raw - this.tiltBase) / 28));
        if (!this.root.querySelector('#t-wheel.on')) this.t.axis = -(Math.abs(v) < 0.05 ? 0 : v);
      };
      addEventListener('deviceorientation', this._onTilt);
      this.tilt = true; b.classList.add('on');
    } catch { b.textContent = 'N/A'; setTimeout(() => { b.textContent = 'TILT'; }, 1500); }
  }

  _fullscreen() {
    const el = document.documentElement;
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' })?.catch?.(() => {});
      screen.orientation?.lock?.('landscape').catch(() => {});
    } catch { /* not allowed in this frame */ }
  }

  _buzz(ms) { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } }

  _orientation() {
    const r = this.root.querySelector('#t-rotate');
    const f = () => { r.hidden = innerWidth >= innerHeight ? true : false; };
    addEventListener('resize', f); f();
  }
}
