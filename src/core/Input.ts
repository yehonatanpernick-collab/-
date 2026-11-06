/** Unified input: keyboard, mouse, touch (virtual controls write into `virtual`) and gamepad. */
export interface ControlState {
  throttle: number;   // 0..1
  brake: number;      // 0..1
  steer: number;      // -1 (left) .. 1 (right)
  handbrake: boolean;
  boost: boolean;
  lift: number;       // -1 descend .. 1 ascend (flight)
  pitch: number;      // -1..1 (flight, nose down = +1 when pushing forward)
  roll: number;       // -1..1
  yaw: number;        // -1..1
}

type Action = 'transform' | 'camera' | 'reset' | 'map' | 'pause' | 'lights' | 'cinematic' | 'horn' | 'weather' | 'time' | 'waypoint';

export class Input {
  keys = new Set<string>();
  mouseDX = 0; mouseDY = 0; wheel = 0;
  pointerLocked = false;
  private listeners = new Map<Action, (() => void)[]>();
  virtual = { throttle: 0, brake: 0, steer: 0, lift: 0, handbrake: false, boost: false, active: false };
  sensitivity = 1;
  private smoothSteer = 0;
  enabled = true;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.onPress(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousemove', (e) => {
      if (this.pointerLocked || e.buttons & 1 || e.buttons & 2) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === el; });
  }

  on(a: Action, f: () => void): void {
    if (!this.listeners.has(a)) this.listeners.set(a, []);
    this.listeners.get(a)!.push(f);
  }
  emit(a: Action): void { this.listeners.get(a)?.forEach((f) => f()); }

  private onPress(code: string): void {
    if (!this.enabled && code !== 'Escape') return;
    const map: Record<string, Action> = {
      KeyF: 'transform', KeyC: 'camera', KeyR: 'reset', KeyM: 'map', Escape: 'pause', KeyL: 'lights',
      KeyV: 'cinematic', KeyH: 'horn', KeyT: 'time', KeyY: 'weather', KeyG: 'waypoint',
    };
    const a = map[code];
    if (a) this.emit(a);
  }

  private k(...c: string[]): boolean { return c.some((x) => this.keys.has(x)); }

  read(dt: number, flying: boolean): ControlState {
    const gp = navigator.getGamepads?.().find((g) => g && g.connected) || null;
    let throttle = this.k('KeyW', 'ArrowUp') ? 1 : 0;
    let brake = this.k('KeyS', 'ArrowDown') ? 1 : 0;
    let steerT = (this.k('KeyD', 'ArrowRight') ? 1 : 0) - (this.k('KeyA', 'ArrowLeft') ? 1 : 0);
    let lift = (this.k('KeyE', 'PageUp') ? 1 : 0) - (this.k('KeyQ', 'PageDown') ? 1 : 0);
    let pitch = 0, roll = 0;
    if (flying) {
      pitch = (this.k('KeyI') ? 1 : 0) - (this.k('KeyK') ? 1 : 0);
      roll = (this.k('KeyO') ? 1 : 0) - (this.k('KeyU') ? 1 : 0);
    }
    let handbrake = this.k('Space');
    let boost = this.k('ShiftLeft', 'ShiftRight');
    if (gp) {
      const ax = (i: number) => (Math.abs(gp.axes[i] ?? 0) > 0.12 ? gp.axes[i] : 0);
      steerT = steerT || ax(0);
      throttle = Math.max(throttle, gp.buttons[7]?.value ?? 0);
      brake = Math.max(brake, gp.buttons[6]?.value ?? 0);
      lift = lift || ((gp.buttons[5]?.pressed ? 1 : 0) - (gp.buttons[4]?.pressed ? 1 : 0));
      pitch = pitch || -ax(3);
      handbrake = handbrake || !!gp.buttons[0]?.pressed;
      boost = boost || !!gp.buttons[1]?.pressed;
    }
    if (this.virtual.active) {
      throttle = Math.max(throttle, this.virtual.throttle);
      brake = Math.max(brake, this.virtual.brake);
      steerT = steerT || this.virtual.steer;
      lift = lift || this.virtual.lift;
      handbrake = handbrake || this.virtual.handbrake;
      boost = boost || this.virtual.boost;
    }
    // smoothed keyboard steering (analog inputs pass straight through)
    const rate = steerT === 0 ? 5 : 3.2;
    this.smoothSteer += Math.max(-rate * dt, Math.min(rate * dt, steerT - this.smoothSteer));
    if (Math.abs(steerT) > 0 && Math.abs(steerT) < 1) this.smoothSteer = steerT;
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, lift: 0, pitch: 0, roll: 0, yaw: 0 };
    return { throttle, brake, steer: this.smoothSteer, handbrake, boost, lift, pitch, roll, yaw: this.smoothSteer };
  }

  consumeMouse(): { dx: number; dy: number; wheel: number } {
    const r = { dx: this.mouseDX * this.sensitivity, dy: this.mouseDY * this.sensitivity, wheel: this.wheel };
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    return r;
  }
}
