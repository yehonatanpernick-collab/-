// Unified input: keyboard, gamepad, multi-touch buttons (slide-between supported) and tilt steering.
export class Input {
  constructor() {
    this.keys = new Set();
    this.touchBtns = new Set();
    this.steer = 0; this.throttle = 0; this.brake = 0; this.handbrake = 0; this.nitro = 0;
    this.analogSteer = false;
    this.tilt = false; this.tiltValue = 0;
    this.autoGas = false;
    this.onAction = () => {};
    this._prevPad = {};
    this.lastDevice = 'keyboard';

    addEventListener('keydown', e => {
      if (e.repeat) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code); this.lastDevice = 'keyboard';
      const map = { KeyC: 'camera', KeyR: 'reset', Escape: 'pause', KeyP: 'pause', KeyM: 'mute' };
      if (map[e.code]) this.onAction(map[e.code]);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.touchBtns.clear(); });

    addEventListener('deviceorientation', e => {
      if (e.beta == null) return;
      const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
      let v;
      if (ang === 90) v = e.beta; else if (ang === -90 || ang === 270) v = -e.beta; else v = e.gamma;
      this.tiltValue = Math.max(-1, Math.min(1, v / 22));
    });
  }

  bindTouch(root) {
    this.touchRoot = root;
    const btns = [...root.querySelectorAll('[data-btn]')];
    const update = e => {
      e.preventDefault();
      const set = new Set();
      for (const t of e.touches) {
        for (const b of btns) {
          const r = b.getBoundingClientRect();
          const pad = 10;
          if (t.clientX >= r.left - pad && t.clientX <= r.right + pad && t.clientY >= r.top - pad && t.clientY <= r.bottom + pad) set.add(b.dataset.btn);
        }
      }
      for (const b of btns) b.classList.toggle('on', set.has(b.dataset.btn));
      for (const n of set) if (!this.touchBtns.has(n) && ['reset', 'camera', 'pause'].includes(n)) this.onAction(n);
      this.touchBtns = set;
      this.lastDevice = 'touch';
    };
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) root.addEventListener(ev, update, { passive: false });
  }

  async enableTilt(on) {
    this.tilt = on;
    if (on && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      try { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') this.tilt = false; } catch { this.tilt = false; }
    }
    return this.tilt;
  }

  update(dt) {
    const k = this.keys, tb = this.touchBtns;
    let left = k.has('ArrowLeft') || k.has('KeyA') || tb.has('left');
    let right = k.has('ArrowRight') || k.has('KeyD') || tb.has('right');
    let gas = k.has('ArrowUp') || k.has('KeyW') || tb.has('gas');
    let brk = k.has('ArrowDown') || k.has('KeyS') || tb.has('brake');
    let hb = k.has('Space') || tb.has('hand');
    let nos = k.has('ShiftLeft') || k.has('ShiftRight') || tb.has('nitro');
    if (this.autoGas && this.lastDevice === 'touch' && !brk) gas = true;

    let padSteer = null, padThr = 0, padBrk = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0;
      const b = i => p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0;
      const dz = Math.abs(ax) > 0.12 ? (ax - Math.sign(ax) * 0.12) / 0.88 : 0;
      if (dz !== 0 || b(7) > 0.05 || b(6) > 0.05 || b(0) || b(1)) this.lastDevice = 'gamepad';
      padSteer = -dz;
      padThr = Math.max(b(7), b(12)); padBrk = Math.max(b(6), b(13));
      if (b(0) || b(5)) hb = true;
      if (b(1) || b(4)) nos = true;
      if (b(14)) left = true; if (b(15)) right = true;
      const edge = (i, name) => { const v = b(i) > 0.5; if (v && !this._prevPad[i]) this.onAction(name); this._prevPad[i] = v; };
      edge(3, 'camera'); edge(9, 'pause'); edge(8, 'reset'); edge(2, 'reset');
      break;
    }

    const target = (left ? 1 : 0) - (right ? 1 : 0);
    if (this.tilt && this.lastDevice === 'touch') {
      this.steer += (-this.tiltValue - this.steer) * Math.min(1, dt * 12);
      this.analogSteer = true;
    } else if (padSteer !== null && this.lastDevice === 'gamepad' && target === 0) {
      this.steer = padSteer; this.analogSteer = true;
    } else {
      this.analogSteer = false;
      const rate = target === 0 ? 7 : (Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? 9 : 4.2);
      const d = target - this.steer;
      this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    }
    this.throttle = Math.max(gas ? 1 : 0, padThr);
    this.brake = Math.max(brk ? 1 : 0, padBrk);
    this.handbrake = hb ? 1 : 0;
    this.nitro = nos ? 1 : 0;
  }
}
