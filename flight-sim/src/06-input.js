// ============================================================================
//  Input: keyboard (layout-independent codes), gamepad, touch, mouse look
// ============================================================================
const Input = {
  keys: new Set(), actions: {}, invert: false,
  axes: { pitch: 0, roll: 0, yaw: 0 }, throttleDelta: 0, brake: 0,
  touch: { active: false, x: 0, y: 0, thr: null, yawL: false, yawR: false, brake: false },
  look: { yaw: 0, pitch: 0, dragging: false, lx: 0, ly: 0, zoom: 1 },
  pad: null, padPrev: [],
  on(name, fn) { this.actions[name] = fn; },
  fire(name, ...a) { const f = this.actions[name]; if (f) f(...a); },
};
const KEYMAP = {
  KeyG: 'gear', KeyF: 'flapDown', KeyR: 'flapUp', KeyP: 'parking', KeyX: 'speedbrake', KeyN: 'reverse', KeyL: 'lights', KeyZ: 'autopilot', KeyK: 'hook',
  KeyC: 'camera', Digit1: 'cam1', Digit2: 'cam2', Digit3: 'cam3', Digit4: 'cam4', Digit5: 'cam5', KeyH: 'hud', KeyM: 'map', Escape: 'pause', Enter: 'enter', KeyT: 'sound',
  BracketLeft: 'trimDown', BracketRight: 'trimUp', End: 'idle', Home: 'fullThrottle', KeyO: 'help',
};
addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const c = e.code;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Tab'].includes(c) || e.ctrlKey && ['KeyS', 'KeyD', 'KeyF', 'KeyR', 'KeyW', 'KeyA', 'KeyE', 'KeyQ'].includes(c)) e.preventDefault();
  if (!Input.keys.has(c) && KEYMAP[c] && !e.repeat) Input.fire(KEYMAP[c]);
  if (KEYMAP[c] === 'trimDown' || KEYMAP[c] === 'trimUp') if (e.repeat) Input.fire(KEYMAP[c]);
  Input.keys.add(c);
});
addEventListener('keyup', (e) => Input.keys.delete(e.code));
addEventListener('blur', () => Input.keys.clear());

// Mouse look (drag) + wheel zoom
canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; Input.look.dragging = true; Input.look.lx = e.clientX; Input.look.ly = e.clientY; });
addEventListener('pointerup', () => { Input.look.dragging = false; });
addEventListener('pointermove', (e) => {
  if (!Input.look.dragging) return; const dx = e.clientX - Input.look.lx, dy = e.clientY - Input.look.ly; Input.look.lx = e.clientX; Input.look.ly = e.clientY;
  Input.look.yaw -= dx * 0.005; Input.look.pitch = clamp(Input.look.pitch - dy * 0.004, -1.3, 1.3);
});
canvas.addEventListener('wheel', (e) => { Input.look.zoom = clamp(Input.look.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.35, 4); e.preventDefault(); }, { passive: false });
canvas.addEventListener('dblclick', () => { Input.look.yaw = 0; Input.look.pitch = 0; Input.look.zoom = 1; });

// Touch controls
(function setupTouch() {
  const stick = $('stick'), knob = stick.querySelector('i'), thr = $('thr'), tk = thr.querySelector('i');
  let sid = null, tid = null;
  const setStick = (t) => { const r = stick.getBoundingClientRect(); let x = (t.clientX - r.left - r.width / 2) / (r.width / 2), y = (t.clientY - r.top - r.height / 2) / (r.height / 2); const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } Input.touch.x = x; Input.touch.y = y; knob.style.transform = `translate(${x * 46}px,${y * 46}px)`; };
  stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; stick.setPointerCapture(sid); Input.touch.active = true; setStick(e); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) setStick(e); });
  const endS = (e) => { if (e.pointerId !== sid) return; sid = null; Input.touch.x = 0; Input.touch.y = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', endS); stick.addEventListener('pointercancel', endS);
  const setThr = (t) => { const r = thr.getBoundingClientRect(); const v = clamp(1 - (t.clientY - r.top - 15) / (r.height - 30), 0, 1); Input.touch.thr = v; tk.style.bottom = (4 + v * (r.height - 38)) + 'px'; };
  thr.addEventListener('pointerdown', (e) => { tid = e.pointerId; thr.setPointerCapture(tid); setThr(e); });
  thr.addEventListener('pointermove', (e) => { if (e.pointerId === tid) setThr(e); });
  thr.addEventListener('pointerup', () => { tid = null; });
  Input.setTouchThrottle = (v) => { const r = thr.getBoundingClientRect(); tk.style.bottom = (4 + v * ((r.height || 190) - 38)) + 'px'; };
  document.querySelectorAll('#tbtns button, #rud button').forEach(b => {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (k === 'yawL') Input.touch.yawL = true; else if (k === 'yawR') Input.touch.yawR = true; else if (k === 'brake') Input.touch.brake = true; else Input.fire({ gear: 'gear', flapdn: 'flapDown', flapup: 'flapUp', spd: 'speedbrake' }[k]); });
    const up = () => { if (k === 'yawL') Input.touch.yawL = false; if (k === 'yawR') Input.touch.yawR = false; if (k === 'brake') Input.touch.brake = false; };
    b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
  });
})();

function pollInput(dt) {
  const K = Input.keys, A = Input.axes;
  const kd = (...c) => c.some(x => K.has(x));
  let pT = (kd('KeyS', 'ArrowDown') ? 1 : 0) - (kd('KeyW', 'ArrowUp') ? 1 : 0);
  let rT = (kd('KeyD', 'ArrowRight') ? 1 : 0) - (kd('KeyA', 'ArrowLeft') ? 1 : 0);
  let yT = (kd('KeyE') ? 1 : 0) - (kd('KeyQ') ? 1 : 0);
  if (Input.invert) pT = -pT;
  let analog = false;
  // gamepad
  let pads = []; try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { }
  const gp = pads && [...pads].find(p => p && p.connected);
  Input.throttleDelta = 0; Input.brake = kd('Space', 'KeyB') ? 1 : 0;
  if (gp) {
    const dz = (v) => Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92;
    const gx = dz(gp.axes[0] || 0), gy = dz(gp.axes[1] || 0), gz = dz(gp.axes[2] || 0);
    if (gx || gy) { analog = true; rT = gx; pT = (Input.invert ? -1 : 1) * gy; }
    if (gz) yT = gz;
    const b = (i) => gp.buttons[i] && (gp.buttons[i].value > 0.2 || gp.buttons[i].pressed);
    Input.throttleDelta += (gp.buttons[7]?.value || 0) * 0.6 - (gp.buttons[6]?.value || 0) * 0.6;
    if (b(0)) Input.brake = 1;
    const edge = [[1, 'gear'], [2, 'flapDown'], [3, 'flapUp'], [4, 'camera'], [5, 'speedbrake'], [9, 'pause'], [12, 'trimUp'], [13, 'trimDown'], [8, 'hud']];
    for (const [i, a] of edge) { const pr = b(i); if (pr && !Input.padPrev[i]) Input.fire(a); Input.padPrev[i] = pr; }
    const rx = dz(gp.axes[3] || 0); if (Math.abs(rx) > 0.2) { Input.look.pitch = clamp(Input.look.pitch - rx * dt * 1.5, -1.3, 1.3); }
  }
  // touch
  if (Input.touch.active) {
    if (Input.touch.x || Input.touch.y) { analog = true; rT = Input.touch.x; pT = (Input.invert ? -1 : 1) * Input.touch.y; }
    if (Input.touch.yawL || Input.touch.yawR) yT = (Input.touch.yawR ? 1 : 0) - (Input.touch.yawL ? 1 : 0);
    if (Input.touch.brake) Input.brake = 1;
  }
  if (analog) { A.pitch = pT; A.roll = rT; }
  else {
    const sm = (cur, t, up, down) => { const r = t !== 0 ? (Math.sign(t) !== Math.sign(cur) && cur !== 0 ? down : up) : down; return cur + clamp(t - cur, -r * dt, r * dt); };
    A.pitch = sm(A.pitch, pT, 1.8, 4.5); A.roll = sm(A.roll, rT, 3.5, 6);
  }
  A.yaw = A.yaw + clamp(yT - A.yaw, -4 * dt, 4 * dt);
  if (kd('ShiftLeft', 'ShiftRight', 'Equal', 'NumpadAdd', 'PageUp')) Input.throttleDelta += 0.45;
  if (kd('ControlLeft', 'ControlRight', 'Minus', 'NumpadSubtract', 'PageDown')) Input.throttleDelta -= 0.45;
  return { analog };
}

// keep keyboard focus on the game: buttons never hold focus after a click
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) b.blur(); });
