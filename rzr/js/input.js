// Keyboard + gamepad input with smoothing for digital keys.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, dragging: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0 };
    this.enabled = true;
    this.touch = { axis: 0, gas: 0, brake: 0, hb: 0, boost: 0 };
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (this.isTouch) import('./touch.js').then(m => { this.controls = new m.TouchControls(this); });
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    const cv = document.getElementById('view');
    let lx = 0, ly = 0, fingers = 0;
    cv.addEventListener('pointerdown', (e) => { fingers++; this.mouse.dragging = fingers === 1; lx = e.clientX; ly = e.clientY; cv.setPointerCapture(e.pointerId); });
    const release = () => { fingers = Math.max(0, fingers - 1); if (!fingers) this.mouse.dragging = false; };
    cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
    cv.addEventListener('pointermove', (e) => {
      // client deltas, not movementX (which is 0 for touch in several browsers)
      if (this.mouse.dragging) { this.mouse.dx += e.clientX - lx; this.mouse.dy += e.clientY - ly; }
      lx = e.clientX; ly = e.clientY;
    });
    cv.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  wasPressed(code) { const p = this.pressed.has(code); return p; }
  endFrame() { this.pressed.clear(); this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0; }

  update(dt) {
    const k = this.keys, s = this.state;
    const up = k.has('KeyW') || k.has('ArrowUp'), dn = k.has('KeyS') || k.has('ArrowDown');
    const lf = k.has('KeyA') || k.has('ArrowLeft'), rt = k.has('KeyD') || k.has('ArrowRight');
    let thr = up ? 1 : 0, brk = dn ? 1 : 0, steer = (lf ? 1 : 0) - (rt ? 1 : 0);
    let hb = k.has('Space') ? 1 : 0, boost = (k.has('ShiftLeft') || k.has('ShiftRight')) ? 1 : 0;
    if (this.touch.gas) thr = 1;
    if (this.touch.brake) brk = 1;
    if (this.touch.hb) hb = 1;
    if (this.touch.boost) boost = 1;
    let analog = false;
    if (this.touch.axis) { steer = this.touch.axis; analog = true; }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) { steer = -ax; analog = true; }
      const rtv = p.buttons[7]?.value || 0, ltv = p.buttons[6]?.value || 0;
      if (rtv > 0.05) thr = rtv;
      if (ltv > 0.05) brk = ltv;
      if (p.buttons[0]?.pressed || p.buttons[1]?.pressed) hb = 1;
      if (p.buttons[5]?.pressed) boost = 1;
      if (p.buttons[3]?.pressed && !this._padY) this.pressed.add('KeyC');
      this._padY = p.buttons[3]?.pressed;
      if (p.buttons[2]?.pressed && !this._padX) this.pressed.add('KeyR');
      this._padX = p.buttons[2]?.pressed;
    }
    if (!this.enabled) { thr = brk = steer = hb = boost = 0; }
    // keyboard steering eases in/out so the car isn't twitchy
    const rate = analog ? 20 : (steer === 0 ? 5 : 3.2);
    s.steer += Math.max(-rate * dt, Math.min(rate * dt, steer - s.steer));
    const tr = 5 * dt;
    s.throttle += Math.max(-tr * 1.5, Math.min(tr, thr - s.throttle));
    s.brake += Math.max(-tr * 2, Math.min(tr * 2, brk - s.brake));
    s.handbrake = hb; s.boost = boost;
    return s;
  }
}
