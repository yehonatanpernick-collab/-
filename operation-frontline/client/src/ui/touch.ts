// Mobile touch controls: floating movement stick (left half), look pad (right half)
// and action buttons. Feeds the same Input object the keyboard / mouse use.
import type { Input } from '../core/input';
import type { Action, Store } from '../core/settings';
import { h } from './dom';

export class TouchControls {
  readonly root: HTMLElement;
  private stickId = -1;
  private lookId = -1;
  private ox = 0; private oy = 0;
  private lx = 0; private ly = 0;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  onScoreboard: () => void = () => {};
  onPause: () => void = () => {};

  constructor(parent: HTMLElement, private readonly input: Input, private readonly store: Store) {
    this.base = h('div', { class: 'stick-base' });
    this.knob = h('div', { class: 'stick-knob' });
    this.base.append(this.knob);
    const hold = (label: string, a: Action, cls: string): HTMLElement => {
      const b = h('div', { class: `tbtn ${cls}`, text: label });
      const down = (e: Event): void => { e.preventDefault(); e.stopPropagation(); this.input.touchHold(a, true); b.classList.add('down'); };
      const up = (e: Event): void => { e.preventDefault(); e.stopPropagation(); this.input.touchHold(a, false); b.classList.remove('down'); };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
      return b;
    };
    const tap = (label: string, cls: string, fn: () => void): HTMLElement => {
      const b = h('div', { class: `tbtn ${cls}`, text: label });
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
      return b;
    };
    let slot = 0;
    const slots: Action[] = ['primary', 'secondary', 'gadget1', 'gadget2'];
    this.root = h('div', { class: 'touch hidden' },
      this.base,
      hold('FIRE', 'fire', 't-fire'), hold('FIRE', 'fire', 't-fire2'), hold('AIM', 'ads', 't-ads'), hold('JUMP', 'jump', 't-jump'),
      hold('CROUCH', 'crouch', 't-crouch'), hold('SPRINT', 'sprint', 't-sprint'), hold('RELOAD', 'reload', 't-reload'),
      hold('NADE', 'grenade', 't-nade'), hold('USE', 'use', 't-use'),
      tap('SWAP', 't-swap', () => { slot = (slot + 1) % 4; this.input.touchPress(slots[slot]); }),
      tap('☰', 't-menu', () => this.onPause()), tap('▤', 't-score', () => this.onScoreboard()));
    parent.append(this.root);
    const opts = { passive: false } as const;
    this.root.addEventListener('touchstart', this.start, opts);
    this.root.addEventListener('touchmove', this.move, opts);
    this.root.addEventListener('touchend', this.end, opts);
    this.root.addEventListener('touchcancel', this.end, opts);
    this.apply();
  }

  apply(): void {
    const s = this.store.settings;
    this.root.style.setProperty('--ts', String(s.touchScale));
    this.root.classList.toggle('lefty', s.touchLeftHanded);
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (!on) { this.stickId = this.lookId = -1; this.input.touchMove(0, 0); this.base.style.opacity = '0'; }
  }

  private isMoveSide(x: number): boolean {
    const left = x < window.innerWidth * 0.42;
    return this.store.settings.touchLeftHanded ? !left && x > window.innerWidth * 0.58 : left;
  }

  private start = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.stickId < 0 && this.isMoveSide(t.clientX)) {
        this.stickId = t.identifier; this.ox = t.clientX; this.oy = t.clientY;
        this.base.style.left = `${t.clientX}px`; this.base.style.top = `${t.clientY}px`; this.base.style.opacity = '1';
        this.knob.style.transform = 'translate(-50%,-50%)';
      } else if (this.lookId < 0) { this.lookId = t.identifier; this.lx = t.clientX; this.ly = t.clientY; }
    }
  };

  private move = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        const R = 56 * this.store.settings.touchScale;
        let dx = t.clientX - this.ox, dy = t.clientY - this.oy;
        const len = Math.hypot(dx, dy);
        if (len > R) { dx *= R / len; dy *= R / len; }
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const dead = 0.14;
        const ax = Math.abs(dx / R) < dead ? 0 : dx / R, az = Math.abs(dy / R) < dead ? 0 : -dy / R;
        this.input.touchMove(ax, az);
        // pushing the stick fully forward sprints
        this.input.touchHold('sprint', az > 0.92 && Math.abs(ax) < 0.5);
      } else if (t.identifier === this.lookId) {
        this.input.touchLook(t.clientX - this.lx, t.clientY - this.ly);
        this.lx = t.clientX; this.ly = t.clientY;
      }
    }
  };

  private end = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) { this.stickId = -1; this.input.touchMove(0, 0); this.input.touchHold('sprint', false); this.base.style.opacity = '0'; }
      else if (t.identifier === this.lookId) this.lookId = -1;
    }
  };
}
