// Keyboard, gamepad and touch input.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();       // edge-triggered this frame
    this.touch = { steer: 0, gas: false, brake: false, drift: false, boost: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, roll: 0 };
    this.kbSteer = 0;
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.padPrev = {};
  }
  bindTouch(root) {
    const btn = (sel, key) => {
      const el = root.querySelector(sel);
      if (!el) return;
      const on = (e) => { e.preventDefault(); this.touch[key] = true; el.classList.add('on'); };
      const off = (e) => { e.preventDefault(); this.touch[key] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    };
    btn('[data-t=gas]', 'gas'); btn('[data-t=brake]', 'brake');
    btn('[data-t=drift]', 'drift'); btn('[data-t=boost]', 'boost');
    // steering pad: horizontal drag
    const pad = root.querySelector('[data-t=steer]');
    const knob = pad?.querySelector('.knob');
    if (pad) {
      let id = null;
      const move = (e) => {
        const r = pad.getBoundingClientRect();
        const v = ((e.clientX - r.left) / r.width) * 2 - 1;
        this.touch.steer = Math.max(-1, Math.min(1, v * 1.25));
        if (knob) knob.style.transform = `translateX(${this.touch.steer * r.width * 0.36}px)`;
      };
      pad.addEventListener('pointerdown', (e) => { id = e.pointerId; pad.setPointerCapture(id); move(e); });
      pad.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
      const end = (e) => { if (e.pointerId === id) { id = null; this.touch.steer = 0; if (knob) knob.style.transform = ''; } };
      pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
    }
  }
  wasPressed(code) { return this.pressed.has(code); }
  update(dt) {
    const k = this.keys;
    let throttle = (k.has('KeyW') || k.has('ArrowUp')) ? 1 : 0;
    let brake = (k.has('KeyS') || k.has('ArrowDown')) ? 1 : 0;
    const l = (k.has('KeyA') || k.has('ArrowLeft')), r = (k.has('KeyD') || k.has('ArrowRight'));
    const target = (r ? 1 : 0) - (l ? 1 : 0);
    // keyboard steering ramps (feels analog)
    const rate = target === 0 ? 7 : (Math.sign(target) !== Math.sign(this.kbSteer) ? 9 : 4.5);
    this.kbSteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.kbSteer));
    let steer = this.kbSteer;
    let handbrake = k.has('Space');
    let boost = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyN');
    let roll = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steer = Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, 1.4);
      const rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (gp.buttons[0]?.pressed || gp.buttons[5]?.pressed) handbrake = true;
      if (gp.buttons[2]?.pressed || gp.buttons[1]?.pressed) boost = true;
      if (gp.buttons[4]?.pressed) roll = -1;
      const now = { reset: gp.buttons[3]?.pressed, cam: gp.buttons[8]?.pressed || gp.buttons[11]?.pressed, pause: gp.buttons[9]?.pressed };
      if (now.reset && !this.padPrev.reset) this.pressed.add('KeyR');
      if (now.cam && !this.padPrev.cam) this.pressed.add('KeyC');
      if (now.pause && !this.padPrev.pause) this.pressed.add('Escape');
      this.padPrev = now;
      break;
    }
    // touch
    const t = this.touch;
    if (t.gas) throttle = 1;
    if (t.brake) brake = 1;
    if (t.steer) steer = t.steer;
    if (t.drift) handbrake = true;
    if (t.boost) boost = true;

    Object.assign(this.state, { throttle, brake, steer, handbrake, boost, roll });
    return this.state;
  }
  endFrame() { this.pressed.clear(); }
}
