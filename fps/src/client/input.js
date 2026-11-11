// Unified input: keyboard + mouse (pointer lock) on PC, virtual joystick + look pad +
// action buttons on touch devices. Produces a per-frame action snapshot.

const KEYMAP = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', Space: 'jump', KeyC: 'crouchT', ControlLeft: 'crouchH', KeyZ: 'crouchH', KeyR: 'reload',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', KeyF: 'slot3', KeyG: 'grenade', KeyE: 'use', KeyQ: 'spot', Tab: 'score', KeyM: 'map',
  Escape: 'esc', KeyX: 'swap', KeyT: 'chat', KeyK: 'suicide',
};

export class Input {
  constructor(el) {
    this.el = el;
    this.held = new Set(); this.pressed = new Set();
    this.mx = 0; this.my = 0; this.wheel = 0;
    this.mouseFire = false; this.mouseAds = false;
    this.locked = false; this.enabled = true;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.touch = { mx: 0, my: 0, jx: 0, jy: 0, fire: false, ads: false, adsToggle: false, sprint: false, pressed: new Set(), held: new Set() };
    addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (a === 'score' || a === 'jump' || (a === 'esc' && this.locked)) e.preventDefault();
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      if (!this.held.has(a)) this.pressed.add(a);
      this.held.add(a);
    });
    addEventListener('keyup', (e) => { const a = KEYMAP[e.code]; if (a) this.held.delete(a); });
    addEventListener('blur', () => { this.held.clear(); this.mouseFire = false; this.mouseAds = false; });
    el.addEventListener('mousedown', (e) => {
      if (this.isTouch) return;
      if (!this.locked && this.wantLock) { this.lock(); return; }
      if (e.button === 0) { this.mouseFire = true; this.pressed.add('fire'); }
      if (e.button === 2) { this.mouseAds = true; this.pressed.add('ads'); }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseFire = false; if (e.button === 2) this.mouseAds = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (this.locked) { this.mx += e.movementX; this.my += e.movementY; } });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked && this.onUnlock) this.onUnlock();
    });
    if (this.isTouch) this.buildTouch();
  }
  lock() { if (this.isTouch) return; try { const p = this.el.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => this.el.requestPointerLock()); } catch (e) { this.el.requestPointerLock(); } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  buildTouch() {
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="tz" id="tzMove"><div class="joy" id="joyBase"><div class="joyKnob" id="joyKnob"></div></div></div>
      <div class="tz" id="tzLook"></div>
      <button class="tb big" data-a="fire" id="tbFire"><span>◉</span></button>
      <button class="tb big2" data-a="fire" id="tbFire2"><span>◉</span></button>
      <button class="tb" data-a="ads" id="tbAds">AIM</button>
      <button class="tb" data-a="jump" id="tbJump">⤒</button>
      <button class="tb" data-a="crouchT" id="tbCrouch">⤓</button>
      <button class="tb" data-a="reload" id="tbReload">R</button>
      <button class="tb" data-a="grenade" id="tbNade">G</button>
      <button class="tb" data-a="swap" id="tbSwap">⇄</button>
      <button class="tb" data-a="slot3" id="tbGadget">✦</button>
      <button class="tb" data-a="use" id="tbUse">USE</button>
      <button class="tb small" data-a="spot" id="tbSpot">◈</button>
      <button class="tb small" data-a="score" id="tbScore">☰</button>
      <button class="tb small" data-a="esc" id="tbMenu">❚❚</button>`;
    document.body.appendChild(root);
    this.touchRoot = root;
    const T = this.touch;
    const joyBase = root.querySelector('#joyBase'), knob = root.querySelector('#joyKnob');
    const active = new Map();
    const R = 55;
    const onDown = (e) => {
      if (!this.enabled) return;
      const t = e.target.closest('[data-a]');
      const zone = e.target.closest('.tz');
      if (t) {
        const a = t.dataset.a;
        e.preventDefault();
        t.classList.add('on');
        active.set(e.pointerId, { kind: 'btn', a, el: t, lx: e.clientX, ly: e.clientY });
        if (a === 'ads') { T.adsToggle = !T.adsToggle; t.classList.toggle('lit', T.adsToggle); T.pressed.add('ads'); }
        else { T.pressed.add(a); T.held.add(a); }
        if (a === 'fire') T.fire = true;
        try { t.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      } else if (zone && zone.id === 'tzMove') {
        e.preventDefault();
        active.set(e.pointerId, { kind: 'joy', ox: e.clientX, oy: e.clientY });
        joyBase.style.left = e.clientX - R + 'px'; joyBase.style.top = e.clientY - R + 'px';
        joyBase.classList.add('on');
        knob.style.transform = 'translate(0px,0px)';
      } else if (zone && zone.id === 'tzLook') {
        e.preventDefault();
        active.set(e.pointerId, { kind: 'look', lx: e.clientX, ly: e.clientY });
      }
    };
    const onMove = (e) => {
      const s = active.get(e.pointerId);
      if (!s) return;
      e.preventDefault();
      if (s.kind === 'joy') {
        let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
        const l = Math.hypot(dx, dy);
        T.sprint = dy < -R * 1.25;
        if (l > R) { dx = dx / l * R; dy = dy / l * R; }
        knob.style.transform = `translate(${dx}px,${dy}px)`;
        T.jx = dx / R; T.jy = -dy / R;
      } else if (s.kind === 'look' || (s.kind === 'btn' && s.a === 'fire')) {
        T.mx += (e.clientX - s.lx); T.my += (e.clientY - s.ly);
        s.lx = e.clientX; s.ly = e.clientY;
      }
    };
    const onUp = (e) => {
      const s = active.get(e.pointerId);
      if (!s) return;
      active.delete(e.pointerId);
      if (s.kind === 'joy') { T.jx = 0; T.jy = 0; T.sprint = false; joyBase.classList.remove('on'); knob.style.transform = 'translate(0px,0px)'; }
      if (s.kind === 'btn') { s.el.classList.remove('on'); T.held.delete(s.a); if (s.a === 'fire') { let still = false; for (const v of active.values()) if (v.a === 'fire') still = true; T.fire = still; } }
    };
    root.addEventListener('pointerdown', onDown, { passive: false });
    addEventListener('pointermove', onMove, { passive: false });
    addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
  }
  showTouch(v) { if (this.touchRoot) this.touchRoot.style.display = v ? 'block' : 'none'; }
  setTouchUse(label) { if (!this.touchRoot) return; const b = this.touchRoot.querySelector('#tbUse'); b.style.display = label ? 'flex' : 'none'; if (label) b.textContent = label; }

  frame() {
    const T = this.touch;
    const h = (a) => this.held.has(a) || T.held.has(a);
    const p = (a) => this.pressed.has(a) || T.pressed.has(a);
    let mx = this.mx, my = this.my;
    if (this.isTouch) { mx += T.mx * 2.2; my += T.my * 2.2; }
    let fx = (h('right') ? 1 : 0) - (h('left') ? 1 : 0) + T.jx;
    let fy = (h('fwd') ? 1 : 0) - (h('back') ? 1 : 0) + T.jy;
    const l = Math.hypot(fx, fy); if (l > 1) { fx /= l; fy /= l; }
    const f = {
      mx, my, moveX: fx, moveY: fy,
      sprint: h('sprint') || T.sprint, jump: p('jump'), crouchHold: h('crouchH'), crouchToggle: p('crouchT'),
      fire: (this.mouseFire && this.locked) || T.fire, firePressed: (p('fire') && this.locked) || T.pressed.has('fire'),
      ads: (this.mouseAds && this.locked) || T.adsToggle, adsPressed: p('ads'),
      reload: p('reload'), slot1: p('slot1'), slot2: p('slot2'), slot3: p('slot3'), swap: p('swap') || this.wheel !== 0, wheel: this.wheel,
      grenade: p('grenade'), use: h('use'), usePressed: p('use'), spot: p('spot'), score: h('score'), map: p('map'), esc: p('esc'), suicide: p('suicide'),
      touch: this.isTouch,
    };
    this.mx = 0; this.my = 0; this.wheel = 0; this.pressed.clear();
    T.mx = 0; T.my = 0; T.pressed.clear();
    return f;
  }
  resetAds() { this.touch.adsToggle = false; if (this.touchRoot) this.touchRoot.querySelector('#tbAds').classList.remove('lit'); }
}
