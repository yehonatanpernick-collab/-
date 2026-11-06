import type { Controls } from '../vehicle/vehicle';

/** Keyboard + touch joystick + gamepad → one Controls struct.
 *  Drive: joystick x = steer, y = gas / brake / reverse.  Fly: same joystick + UP/DOWN buttons. */
export class Input {
  keys: Record<string, boolean> = {};
  stick = { x: 0, y: 0, id: -1 };
  lift = { up: false, down: false };
  onAction: (a: 'transform' | 'camera' | 'time' | 'reset' | 'quality') => void = () => {};
  private pad: Record<string, boolean> = {};

  constructor() {
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (this.keys[e.code]) return; this.keys[e.code] = true;
      const map: Record<string, any> = { KeyF: 'transform', KeyV: 'camera', KeyT: 'time', KeyR: 'reset', KeyG: 'quality' };
      if (map[e.code]) this.onAction(map[e.code]);
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
    const stick = document.getElementById('stick')!, knob = document.getElementById('knob')!;
    const upd = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect(); let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      this.stick.x = x; this.stick.y = -y; knob.style.transform = `translate(${x * 46}px, ${y * 46}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { this.stick.id = e.pointerId; stick.setPointerCapture(e.pointerId); upd(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === this.stick.id) upd(e); });
    const end = () => { this.stick.id = -1; this.stick.x = this.stick.y = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const hold = (id: string, k: 'up' | 'down') => {
      const b = document.getElementById(id)!;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.lift[k] = true; b.classList.add('on'); b.setPointerCapture(e.pointerId); });
      const off = () => { this.lift[k] = false; b.classList.remove('on'); };
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
    };
    hold('tUp', 'up'); hold('tDown', 'down');
  }

  read(flying: boolean): Controls {
    const k = this.keys;
    const dz = (v: number, d = 0.08) => (Math.abs(v) < d ? 0 : Math.sign(v) * ((Math.abs(v) - d) / (1 - d)));
    const curve = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.35);
    let steer = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    let throttle = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    let up = k.Space && flying ? 1 : 0, down = k.KeyC || k.ControlLeft || k.KeyQ ? 1 : 0;
    let boost = !!(k.ShiftLeft || k.ShiftRight); let handbrake = !!(k.Space && !flying);
    if (this.stick.id >= 0) { steer = curve(dz(this.stick.x)); throttle = dz(this.stick.y, 0.1); }
    if (this.lift.up) up = 1; if (this.lift.down) down = 1;
    const pads = navigator.getGamepads?.() || [];
    for (const g of pads) {
      if (!g) continue;
      const ax = dz(g.axes[0] || 0, 0.12); if (ax) steer = curve(ax);
      const rt = g.buttons[7]?.value || 0, lt = g.buttons[6]?.value || 0; if (rt || lt) throttle = rt - lt;
      const ly = dz(-(g.axes[3] || 0), 0.15); if (flying && ly) { up = Math.max(up, ly); down = Math.max(down, -ly); }
      if (g.buttons[0]?.pressed && flying) up = 1; if (g.buttons[1]?.pressed) down = 1;
      if (g.buttons[5]?.pressed) boost = true; if (g.buttons[2]?.pressed && !flying) handbrake = true;
      const y = !!g.buttons[3]?.pressed; if (y && !this.pad.y) this.onAction('transform'); this.pad.y = y;
      const lb = !!g.buttons[4]?.pressed; if (lb && !this.pad.lb) this.onAction('camera'); this.pad.lb = lb;
      break;
    }
    return { steer: Math.max(-1, Math.min(1, steer)), throttle: Math.max(-1, Math.min(1, throttle)), up, down, boost, handbrake };
  }
}
