// Keyboard (remappable), gamepad and touch input.
export const ACTIONS = [
  { id: 'throttle', name: 'גז', keys: ['KeyW'] },
  { id: 'brake', name: 'ברקס / רוורס', keys: ['KeyS'] },
  { id: 'left', name: 'היגוי שמאלה', keys: ['KeyA'] },
  { id: 'right', name: 'היגוי ימינה', keys: ['KeyD'] },
  { id: 'handbrake', name: 'בלם יד (דריפט)', keys: ['Space'] },
  { id: 'boost', name: 'ניטרו', keys: ['ShiftLeft'] },
  { id: 'leanBack', name: 'הטייה אחורה (ווילי / סלטה אחורית)', keys: ['ArrowDown'] },
  { id: 'leanFwd', name: 'הטייה קדימה (ווילי קדמי / סלטה קדמית)', keys: ['ArrowUp'] },
  { id: 'rollLeft', name: 'גלגול שמאלה באוויר', keys: ['ArrowLeft'] },
  { id: 'rollRight', name: 'גלגול ימינה באוויר', keys: ['ArrowRight'] },
  { id: 'mode', name: 'החלפת מצב נהיגה', keys: ['KeyF'] },
  { id: 'time', name: 'החלפת שעה ביום', keys: ['KeyT'] },
  { id: 'worldmap', name: 'מפת העולם / תצפית', keys: ['KeyN'] },
  { id: 'camera', name: 'מצלמה', keys: ['KeyC'] },
  { id: 'reset', name: 'איפוס הבאגי', keys: ['KeyR'] },
  { id: 'pause', name: 'השהיה / תפריט', keys: ['Escape'] },
];
const DEFAULTS = Object.fromEntries(ACTIONS.map(a => [a.id, a.keys[0]]));

export function keyLabel(code) {
  if (!code) return '—';
  const map = {
    Space: 'רווח', ShiftLeft: 'Shift', ShiftRight: 'Shift ימני', ControlLeft: 'Ctrl', ControlRight: 'Ctrl ימני',
    AltLeft: 'Alt', AltRight: 'Alt ימני', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: '⌫', CapsLock: 'Caps',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

export class Input {
  constructor(saved) {
    this.keys = new Set();
    this.pressed = new Set();       // edge-triggered codes this frame
    this.bind = { ...DEFAULTS, ...(saved || {}) };
    this.capture = null;            // callback while waiting for a key to bind
    this.touch = { steer: 0, gas: false, brake: false, drift: false, boost: false, lean: 0 };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, roll: 0, lean: 0 };
    this.kbSteer = 0;
    addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture; this.capture = null;
        cb(e.code);
        return;
      }
      const bound = Object.values(this.bind).includes(e.code);
      if (bound || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.padPrev = {};
  }
  setKey(action, code) {
    // a key can only drive one action: free it elsewhere
    for (const k of Object.keys(this.bind)) if (this.bind[k] === code) this.bind[k] = null;
    this.bind[action] = code;
  }
  resetKeys() { this.bind = { ...DEFAULTS }; }
  down(action) { const c = this.bind[action]; return !!c && this.keys.has(c); }
  hit(action) { const c = this.bind[action]; return !!c && this.pressed.has(c); }

  bindTouch(root) {
    const btn = (sel, fn) => {
      const el = root.querySelector(sel);
      if (!el) return;
      const on = (e) => { e.preventDefault(); fn(true); el.classList.add('on'); };
      const off = (e) => { e.preventDefault(); fn(false); el.classList.remove('on'); };
      el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    };
    btn('[data-t=gas]', v => this.touch.gas = v);
    btn('[data-t=brake]', v => this.touch.brake = v);
    btn('[data-t=drift]', v => this.touch.drift = v);
    btn('[data-t=boost]', v => this.touch.boost = v);
    btn('[data-t=leanb]', v => this.touch.lean = v ? -1 : 0);
    btn('[data-t=leanf]', v => this.touch.lean = v ? 1 : 0);
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

  update(dt) {
    let throttle = this.down('throttle') ? 1 : 0;
    let brake = this.down('brake') ? 1 : 0;
    const l = this.down('left'), r = this.down('right');
    const target = (r ? 1 : 0) - (l ? 1 : 0);
    // keyboard steering ramps in (feels analogue), snaps back quicker
    const rate = target === 0 ? 8 : (Math.sign(target) !== Math.sign(this.kbSteer) ? 10 : 4.2);
    this.kbSteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.kbSteer));
    let steer = this.kbSteer;
    let handbrake = this.down('handbrake');
    let boost = this.down('boost');
    let roll = (this.down('rollRight') ? 1 : 0) - (this.down('rollLeft') ? 1 : 0);
    let lean = (this.down('leanFwd') ? 1 : 0) - (this.down('leanBack') ? 1 : 0);

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steer = Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, 1.4);
      const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
      if (Math.abs(ry) > 0.25) lean = ry;                 // right stick: lean
      if (Math.abs(rx) > 0.25) roll = rx;                 // right stick: roll
      const rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (gp.buttons[0]?.pressed || gp.buttons[5]?.pressed) handbrake = true;
      if (gp.buttons[2]?.pressed || gp.buttons[1]?.pressed) boost = true;
      const now = { reset: gp.buttons[3]?.pressed, cam: gp.buttons[8]?.pressed || gp.buttons[11]?.pressed, pause: gp.buttons[9]?.pressed, mode: gp.buttons[4]?.pressed };
      const fire = (k, a) => { if (now[k] && !this.padPrev[k] && this.bind[a]) this.pressed.add(this.bind[a]); };
      fire('reset', 'reset'); fire('cam', 'camera'); fire('pause', 'pause'); fire('mode', 'mode');
      this.padPrev = now;
      break;
    }
    const t = this.touch;
    if (t.gas) throttle = 1;
    if (t.brake) brake = 1;
    if (t.steer) steer = t.steer;
    if (t.drift) handbrake = true;
    if (t.boost) boost = true;
    if (t.lean) lean = t.lean;

    Object.assign(this.state, { throttle, brake, steer, handbrake, boost, roll, lean });
    return this.state;
  }
  endFrame() { this.pressed.clear(); }
}
