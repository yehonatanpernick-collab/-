// Keyboard / gamepad / touch -> player intent
const ATTACK_KEYS = { KeyJ: 'jab', KeyK: 'cross', KeyL: 'hook', KeyI: 'uppercut', KeyU: 'lowkick', KeyO: 'bodykick', KeyP: 'highkick', KeyH: 'teep' };

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = [];        // attack presses this frame
    this.events = [];         // ui keys
    this.slipPress = 0;
    this.touch = { mx: 0, my: 0, block: false, body: false };
    this.camMode = 'side';
    this.mash = 0;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (!['Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault(); return; }
      this.down.add(e.code);
      if (ATTACK_KEYS[e.code]) { this.pressed.push(ATTACK_KEYS[e.code]); this.mash++; }
      if (e.code === 'KeyQ') { this.slipPress = -1; this.mash++; }
      if (e.code === 'KeyE') { this.slipPress = 1; this.mash++; }
      this.events.push(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    this.gpPrev = [];
    this.setupTouch();
  }
  isTouch() { return document.body.classList.contains('touch'); }
  setupTouch() {
    const enable = () => document.body.classList.add('touch');
    if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) enable();
    window.addEventListener('touchstart', enable, { once: true, passive: true });
    this.combo = 0; this.comboT = 0;
    const stick = document.getElementById('stick'), knob = document.getElementById('knob');
    let sid = null, cx = 0, cy = 0;
    const R = 60;
    stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; stick.setPointerCapture(sid); move(e); });
    const move = (e) => {
      if (e.pointerId !== sid) return;
      let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.touch.sx = dx / R; this.touch.sy = dy / R;
    };
    stick.addEventListener('pointermove', move);
    const up = (e) => { if (e.pointerId !== sid) return; sid = null; knob.style.transform = ''; this.touch.sx = 0; this.touch.sy = 0; };
    stick.addEventListener('pointerup', up); stick.addEventListener('pointercancel', up);
    document.querySelectorAll('#touch button').forEach(b => {
      const k = b.dataset.k;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); b.classList.add('on');
        if (k === 'block') this.touch.block = true;
        else if (k === 'body') { this.touch.body = !this.touch.body; b.classList.toggle('lock', this.touch.body); }
        else if (k === 'slip') { this.slipPress = (this.touch.sx || 0) >= 0 ? 1 : -1; this.mash++; }
        else if (k === 'pause') this.events.push('Escape');
        else if (k === 'punch') {
          // tap again quickly to flow into a combo: jab -> cross -> hook -> uppercut
          const now = performance.now();
          this.combo = now - this.comboT < 650 ? (this.combo + 1) % 4 : 0; this.comboT = now;
          this.pressed.push(['jab', 'cross', 'hook', 'uppercut'][this.combo]); this.mash++;
        } else if (k === 'kick') {
          // stick up = head kick, stick down = low kick, otherwise body kick
          const sy = this.touch.sy || 0;
          this.pressed.push(sy < -0.5 ? 'highkick' : sy > 0.5 ? 'lowkick' : 'bodykick'); this.mash++;
        }
        else { this.pressed.push(k); this.mash++; }
      });
      const rel = () => { if (!(k === 'body' && this.touch.body)) b.classList.remove('on'); if (k === 'block') this.touch.block = false; };
      b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('pointerleave', rel);
    });
  }
  pollGamepad() {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gps && [...gps].find(g => g);
    if (!gp) return null;
    const b = gp.buttons.map(x => x.pressed);
    const edge = (i) => b[i] && !this.gpPrev[i];
    const map = { 2: 'jab', 3: 'cross', 1: 'hook', 0: 'uppercut', 6: 'lowkick', 7: 'bodykick', 12: 'highkick', 13: 'teep' };
    for (const i in map) if (edge(+i)) { this.pressed.push(map[i]); this.mash++; }
    if (edge(14)) this.slipPress = -1; if (edge(15)) this.slipPress = 1;
    if (edge(9)) this.events.push('Escape');
    if (edge(0)) this.events.push('GPA'); if (edge(1)) this.events.push('GPB');
    const ax = gp.axes;
    const dz = (v) => Math.abs(v) < 0.2 ? 0 : v;
    // menu navigation with stick/dpad edges
    const up = b[12] || ax[1] < -0.6, dn = b[13] || ax[1] > 0.6, lf = b[14] || ax[0] < -0.6, rt = b[15] || ax[0] > 0.6;
    const p = this.gpNav || {};
    if (up && !p.up) this.events.push('ArrowUp'); if (dn && !p.dn) this.events.push('ArrowDown');
    if (lf && !p.lf) this.events.push('ArrowLeft'); if (rt && !p.rt) this.events.push('ArrowRight');
    this.gpNav = { up, dn, lf, rt };
    this.gpPrev = b;
    return { sx: dz(ax[0]), sy: dz(ax[1]), block: b[5], body: b[4] };
  }
  // screen-space stick (x right, y down) -> fighter intent depending on camera
  fill(intent) {
    const gp = this.pollGamepad();
    const k = this.down;
    let sx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let sy = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    if (this.touch.sx || this.touch.sy) { sx = this.touch.sx; sy = this.touch.sy; }
    if (gp && (gp.sx || gp.sy)) { sx = gp.sx; sy = gp.sy; }
    if (this.camMode === 'side') {
      // player is on the left: screen-right = toward opponent; screen-up = away from camera (fighter's left)
      intent.my = sx; intent.mx = sy;
    } else {
      intent.my = -sy; intent.mx = sx;
    }
    const l = Math.hypot(intent.mx, intent.my); if (l > 1) { intent.mx /= l; intent.my /= l; }
    intent.block = k.has('Space') || this.touch.block || !!(gp && gp.block);
    intent.body = k.has('ShiftLeft') || k.has('ShiftRight') || this.touch.body || !!(gp && gp.body);
    if (this.pressed.length) intent.attack = this.pressed.shift();
    if (this.slipPress) { intent.slip = true; intent.mx = this.slipPress; this.slipPress = 0; }
    this.pressed.length = Math.min(this.pressed.length, 1);
  }
  clearFrame() { this.pressed.length = 0; this.slipPress = 0; }
  takeEvents() { const e = this.events; this.events = []; return e; }
}
