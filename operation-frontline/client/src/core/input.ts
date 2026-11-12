// Unified input: keyboard + mouse (pointer lock) and touch controls feed the same
// action state, so gameplay code never cares where input came from.
import type { Action, Store } from './settings';

const ALL_ACTIONS: Action[] = ['forward', 'back', 'left', 'right', 'jump', 'crouch', 'sprint', 'tacSprint', 'reload', 'use', 'grenade', 'primary', 'secondary', 'gadget1', 'gadget2', 'scoreboard', 'map', 'menu', 'fire', 'ads'];

export class Input {
  /** Accumulated look deltas in "mouse pixels" since the last consumeLook(). */
  private lookX = 0;
  private lookY = 0;
  private readonly down = new Set<string>();
  private readonly held = new Map<Action, boolean>();
  private readonly pressed = new Set<Action>();
  private readonly touchHeld = new Map<Action, boolean>();
  private touchMoveX = 0;
  private touchMoveZ = 0;
  wheel = 0;
  enabled = false;
  locked = false;
  /** True when the last meaningful input came from a touch screen. */
  touchActive = false;
  private capture: ((code: string) => void) | null = null;
  onLockChange: (locked: boolean) => void = () => {};
  /** True when the browser refuses pointer lock (e.g. embedded frames): plain mouse movement then steers the view. */
  lockFailed = false;
  private lastLookT = performance.now();
  private padX = 0; private padZ = 0;
  private padPrev = new Map<Action, boolean>();
  private padHeld = new Map<Action, boolean>();

  constructor(private readonly canvas: HTMLCanvasElement, private readonly store: Store) {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.releaseAll());
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', (e) => { if (this.enabled) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.releaseAll();
      this.onLockChange(this.locked);
    });
  }

  private codeToActions(code: string): Action[] {
    const b = this.store.settings.bindings;
    const out: Action[] = [];
    for (const a of ALL_ACTIONS) if (b[a] === code) out.push(a);
    return out;
  }

  private setCode(code: string, isDown: boolean): void {
    if (isDown) {
      if (this.down.has(code)) return;
      this.down.add(code);
      for (const a of this.codeToActions(code)) { this.held.set(a, true); this.pressed.add(a); }
    } else {
      this.down.delete(code);
      for (const a of this.codeToActions(code)) this.held.set(a, false);
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.capture) {
      e.preventDefault();
      const c = this.capture; this.capture = null; c(e.code);
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (!this.enabled) {
      // menu key still has to work to close overlays
      if (e.code === this.store.settings.bindings.menu) this.pressed.add('menu');
      return;
    }
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'AltLeft' || (e.ctrlKey && e.code !== 'KeyR')) e.preventDefault();
    if (e.repeat) return;
    this.touchActive = false;
    this.setCode(e.code, true);
  };

  private onKeyUp = (e: KeyboardEvent): void => { this.setCode(e.code, false); };

  private onMouseDown = (e: MouseEvent): void => {
    if (this.capture) { const c = this.capture; this.capture = null; c(`Mouse${e.button}`); e.preventDefault(); return; }
    if (!this.enabled) return;
    if (!this.locked && !this.lockFailed) { this.requestLock(); return; }
    this.touchActive = false;
    this.setCode(`Mouse${e.button}`, true);
  };

  private onMouseUp = (e: MouseEvent): void => { this.setCode(`Mouse${e.button}`, false); };

  private onMouseMove = (e: MouseEvent): void => {
    if ((!this.locked && !this.lockFailed) || !this.enabled) return;
    // ignore the occasional huge delta browsers report right after acquiring the lock
    if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  };

  requestLock(): void {
    if (this.touchActive || this.locked) return;
    try {
      const quiet = (r: unknown): void => { if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined); };
      const p = (this.canvas.requestPointerLock as (o?: object) => Promise<void> | void).call(this.canvas, { unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => { if (!this.locked) setTimeout(() => { if (!this.locked) this.lockFailed = true; }, 400); });
        // unadjustedMovement is not supported everywhere; retry once without it (needs a user gesture either way)
        (p as Promise<void>).catch((err: unknown) => { if (String(err).includes('NotSupported')) { try { quiet(this.canvas.requestPointerLock()); } catch { /* unavailable */ } } });
      }
    } catch { /* pointer lock unsupported */ }
  }

  exitLock(): void { if (document.pointerLockElement) document.exitPointerLock(); }

  releaseAll(): void {
    this.down.clear();
    this.held.clear();
    this.touchHeld.clear();
    this.touchMoveX = 0; this.touchMoveZ = 0;
  }

  // ------------------------------------------------------------------ queries
  isHeld(a: Action): boolean { return this.held.get(a) === true || this.touchHeld.get(a) === true || this.padHeld.get(a) === true; }

  /** True once per press. */
  wasPressed(a: Action): boolean {
    if (!this.pressed.has(a)) return false;
    this.pressed.delete(a);
    return true;
  }

  clearPressed(): void { this.pressed.clear(); this.wheel = 0; }

  consumeLook(out: { x: number; y: number }): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastLookT) / 1000);
    this.lastLookT = now;
    this.pollPad(dt);
    // arrow keys look around too (useful on laptops and when the mouse cannot be captured)
    if (this.enabled) {
      const k = 520 * dt;
      this.lookX += ((this.down.has('ArrowRight') ? 1 : 0) - (this.down.has('ArrowLeft') ? 1 : 0)) * k;
      this.lookY += ((this.down.has('ArrowDown') ? 1 : 0) - (this.down.has('ArrowUp') ? 1 : 0)) * k;
    }
    out.x = this.lookX; out.y = this.lookY;
    this.lookX = 0; this.lookY = 0;
  }

  /** Game controller: left stick moves, right stick looks, triggers fire / aim, face buttons act. */
  private pollPad(dt: number): void {
    this.padX = 0; this.padZ = 0;
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    const pad = pads.find((p) => p && p.connected);
    if (!pad || !this.enabled) { this.padHeld.clear(); return; }
    const dz = (v: number): number => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
    const ax = dz(pad.axes[0] ?? 0), az = dz(pad.axes[1] ?? 0), rx = dz(pad.axes[2] ?? 0), ry = dz(pad.axes[3] ?? 0);
    this.padX = ax; this.padZ = -az;
    const curve = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), 1.6);
    this.lookX += curve(rx) * 1300 * dt; this.lookY += curve(ry) * 1000 * dt;
    const b = (i: number): boolean => !!pad.buttons[i]?.pressed;
    const now: [Action, boolean][] = [['fire', b(7) || b(5)], ['ads', b(6)], ['jump', b(0)], ['crouch', b(1) || b(11)], ['reload', b(2)], ['use', b(3)], ['grenade', b(4)], ['sprint', b(10)], ['scoreboard', b(8)], ['menu', b(9)], ['secondary', b(13)], ['primary', b(12)], ['gadget1', b(14)], ['gadget2', b(15)]];
    for (const [a, v] of now) {
      if (v && !this.padPrev.get(a)) this.pressed.add(a);
      this.padPrev.set(a, v);
      this.padHeld.set(a, v);
    }
    if (ax !== 0 || az !== 0) this.touchActive = false;
  }

  /** Movement axes: x = strafe right, z = forward. */
  moveAxes(out: { x: number; z: number }): void {
    let x = (this.held.get('right') ? 1 : 0) - (this.held.get('left') ? 1 : 0);
    let z = (this.held.get('forward') ? 1 : 0) - (this.held.get('back') ? 1 : 0);
    if (this.padX !== 0 || this.padZ !== 0) { x = this.padX; z = this.padZ; }
    if (this.touchMoveX !== 0 || this.touchMoveZ !== 0) { x = this.touchMoveX; z = this.touchMoveZ; }
    out.x = x; out.z = z;
  }

  // ------------------------------------------------------------------ touch feed
  touchMove(x: number, z: number): void { this.touchActive = true; this.touchMoveX = x; this.touchMoveZ = z; }
  touchLook(dx: number, dy: number): void { this.touchActive = true; this.lookX += dx; this.lookY += dy; }
  touchHold(a: Action, isDown: boolean): void {
    this.touchActive = true;
    if (isDown && !this.touchHeld.get(a)) this.pressed.add(a);
    this.touchHeld.set(a, isDown);
  }
  touchPress(a: Action): void { this.touchActive = true; this.pressed.add(a); }

  /** Capture the next key / mouse button (used by the key binding UI). */
  captureNext(cb: (code: string) => void): void { this.capture = cb; }
  cancelCapture(): void { this.capture = null; }
}
