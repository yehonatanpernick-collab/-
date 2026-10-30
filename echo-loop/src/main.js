// Echo Loop — browser shell: input, fixed-step loop, rendering, audio, screens.
(function () {
  'use strict';
  const E = window.EchoEngine;
  const C = E.C;
  const STEP_MS = 1000 / C.TPS;
  const REWIND_FRAMES = 48;
  const BEST_KEY = 'echo-loop-best';

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const ui = {
    hud: $('hud'), loop: $('hud-loop'), echoes: $('hud-echoes'), lives: $('hud-lives'),
    score: $('hud-score'), timer: $('hud-timer'), mute: $('btn-mute'),
    title: $('screen-title'), over: $('screen-over'), pause: $('screen-pause'),
  };

  // ---------- storage (best score only; optional) ----------
  function readBest() {
    try { return +localStorage.getItem(BEST_KEY) || 0; } catch (e) { return 0; }
  }
  function writeBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* private mode */ }
  }

  // ---------- view transform ----------
  // On portrait screens the landscape arena is turned 90° so it fills the phone.
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1, rot: false };
  function resize() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * view.dpr);
    canvas.height = Math.floor(innerHeight * view.dpr);
    const pad = innerWidth < 600 ? 8 : 24;
    const top = 84; // room for the HUD
    const availW = innerWidth - pad * 2, availH = innerHeight - top - pad;
    view.rot = availH > availW;
    const sw = view.rot ? C.H : C.W, sh = view.rot ? C.W : C.H;
    view.scale = Math.min(availW / sw, availH / sh);
    view.ox = (innerWidth - sw * view.scale) / 2;
    view.oy = top + (availH - sh * view.scale) / 2;
  }
  addEventListener('resize', resize);
  resize();

  function applyView(sx, sy) {
    if (view.rot) {
      ctx.translate(view.ox + C.H * view.scale + sx, view.oy + sy);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(view.ox + sx, view.oy + sy);
    }
    ctx.scale(view.scale, view.scale);
  }
  // screen-space direction → world direction
  const dirToWorld = (dx, dy) => (view.rot ? { dx: dy, dy: -dx } : { dx, dy });
  function toWorld(cx, cy) {
    if (!view.rot) return { x: (cx - view.ox) / view.scale, y: (cy - view.oy) / view.scale };
    const rx = cx - view.ox - C.H * view.scale, ry = cy - view.oy;
    return { x: ry / view.scale, y: -rx / view.scale };
  }
  // world point → screen point (for text drawn upright)
  function toScreen(x, y) {
    if (!view.rot) return { x: view.ox + x * view.scale, y: view.oy + y * view.scale };
    return { x: view.ox + (C.H - y) * view.scale, y: view.oy + x * view.scale };
  }

  // ---------- input ----------
  const keys = new Set();
  const mouse = { x: C.W / 2, y: C.H / 2, lastMove: -1e9 };
  const touch = { id: null, sx: 0, sy: 0, x: 0, y: 0 };

  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'p' || k === 'escape') { togglePause(); return; }
    if (k === 'm') { toggleMute(); return; }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    keys.add(k);
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { keys.clear(); if (state === 'play') togglePause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') togglePause(); });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const w = toWorld(e.clientX, e.clientY);
    mouse.x = w.x; mouse.y = w.y; mouse.lastMove = performance.now();
  });

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state === 'pause') { togglePause(); return; }
    const t = e.changedTouches[0];
    if (touch.id === null) { touch.id = t.identifier; touch.sx = touch.x = t.clientX; touch.sy = touch.y = t.clientY; }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === touch.id) { touch.x = t.clientX; touch.y = t.clientY; }
  }, { passive: false });
  const endTouch = (e) => { for (const t of e.changedTouches) if (t.identifier === touch.id) touch.id = null; };
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);
  ui.pause.addEventListener('click', () => togglePause());

  function readInput() {
    let dx = 0, dy = 0;
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if (keys.has('d') || keys.has('arrowright')) dx += 1;
    if (keys.has('w') || keys.has('arrowup')) dy -= 1;
    if (keys.has('s') || keys.has('arrowdown')) dy += 1;
    if (touch.id !== null) {
      const R = 60;
      const tx = touch.x - touch.sx, ty = touch.y - touch.sy;
      const d = Math.hypot(tx, ty);
      if (d > 6) { dx = tx / Math.max(d, R); dy = ty / Math.max(d, R); }
    }
    const w = dirToWorld(dx, dy);
    // Mouse aim while the mouse is in use; otherwise the engine auto-aims.
    let aim = null;
    if (performance.now() - mouse.lastMove < 2500) aim = Math.atan2(mouse.y - game.player.y, mouse.x - game.player.x);
    return { dx: w.dx, dy: w.dy, aim, fire: true };
  }

  // ---------- audio (WebAudio synth, no files) ----------
  const audio = { ctx: null, master: null, muted: false, nextBeat: 0, beat: 0, lastShot: 0 };
  function initAudio() {
    if (audio.ctx) { audio.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio.ctx = new AC();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = audio.muted ? 0 : 0.5;
    audio.master.connect(audio.ctx.destination);
  }
  function tone(freq, dur, type, vol, slideTo, when) {
    if (!audio.ctx) return;
    const t = when || audio.ctx.currentTime;
    const o = audio.ctx.createOscillator();
    const g = audio.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audio.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, when, hp) {
    if (!audio.ctx) return;
    const t = when || audio.ctx.currentTime;
    const len = Math.floor(audio.ctx.sampleRate * dur);
    const buf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = audio.ctx.createBufferSource();
    src.buffer = buf;
    const f = audio.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = hp || 800;
    const g = audio.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(audio.master);
    src.start(t);
  }
  const sfx = {
    shoot() { const now = performance.now(); if (now - audio.lastShot < 70) return; audio.lastShot = now; tone(880, 0.05, 'square', 0.03, 440); },
    kill() { tone(320, 0.12, 'sawtooth', 0.08, 80); noise(0.08, 0.05); },
    hurt() { tone(200, 0.05, 'square', 0.04); },
    hit() { tone(120, 0.4, 'sawtooth', 0.2, 30); noise(0.3, 0.2, 0, 200); },
    shatter() { tone(1400, 0.25, 'triangle', 0.08, 300); },
    rewind() { tone(1200, 0.7, 'sawtooth', 0.08, 60); tone(600, 0.7, 'sine', 0.1, 1800); },
    over() { tone(400, 1.2, 'sawtooth', 0.15, 40); },
  };
  // The soundtrack grows with your echo army: faster beat, then hats, then bass.
  const BASS = [55, 55, 65.4, 49];
  function scheduleMusic() {
    if (!audio.ctx || state !== 'play') return;
    const n = game.echoes.length;
    const spb = 60 / (100 + n * 6) / 2; // eighth notes
    const ahead = audio.ctx.currentTime + 0.12;
    if (audio.nextBeat < audio.ctx.currentTime) audio.nextBeat = audio.ctx.currentTime + 0.05;
    while (audio.nextBeat < ahead) {
      const b = audio.beat++;
      const t = audio.nextBeat;
      if (b % 4 === 0) tone(110, 0.18, 'sine', 0.35, 40, t);
      if (n >= 2 && b % 2 === 1) noise(0.03, 0.04, t, 6000);
      if (n >= 5 && b % 2 === 0) tone(BASS[(b >> 3) % 4], spb * 1.8, 'triangle', 0.09, null, t);
      if (n >= 9 && b % 8 === 6) tone(BASS[(b >> 3) % 4] * 8, 0.12, 'square', 0.025, null, t);
      audio.nextBeat += spb;
      if (b % 4 === 0) pulse = 1;
    }
  }
  function toggleMute() {
    audio.muted = !audio.muted;
    if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.5;
    ui.mute.textContent = audio.muted ? '🔇' : '🔊';
    ui.mute.setAttribute('aria-label', audio.muted ? 'בטל השתקה' : 'השתק');
  }
  ui.mute.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });

  // ---------- game state ----------
  let state = 'title'; // title | play | rewind | pause | over
  let game = E.createGame({ seed: 1 });
  let acc = 0, last = 0;
  let rewind = 0, rewindRec = null;
  let shake = 0, flash = 0, pulse = 0;
  const particles = [];
  const shatterMarks = [];

  const echoHue = (i) => 185 + i * 12; // cyan → violet → pink as the army grows

  function start() {
    initAudio();
    game = E.createGame({ seed: (Math.random() * 1e9) | 0 });
    particles.length = 0; shatterMarks.length = 0;
    acc = 0; rewind = 0; shake = 0;
    state = 'play';
    ui.title.hidden = true; ui.over.hidden = true; ui.pause.hidden = true; ui.hud.hidden = false;
    canvas.focus && canvas.focus();
  }
  $('btn-start').addEventListener('click', start);
  $('btn-again').addEventListener('click', start);

  function togglePause() {
    if (state === 'play') { state = 'pause'; ui.pause.hidden = false; }
    else if (state === 'pause') { state = 'play'; ui.pause.hidden = true; last = performance.now(); acc = 0; }
  }

  function burst(x, y, n, hue, speed, life) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, hue });
    }
  }

  function handleEvents() {
    for (const ev of E.drainEvents(game)) {
      switch (ev.type) {
        case 'shoot': sfx.shoot(); break;
        case 'hurt': sfx.hurt(); burst(ev.x, ev.y, 4, 30, 3, 15); break;
        case 'kill':
          sfx.kill();
          burst(ev.x, ev.y, ev.kind === 'brute' ? 30 : 14, ev.kind === 'eater' ? 275 : ev.kind === 'brute' ? 28 : 350, 5, 30);
          shake = Math.max(shake, ev.kind === 'brute' ? 8 : 3);
          break;
        case 'shatter':
          sfx.shatter(); burst(ev.x, ev.y, 18, 190, 4, 40);
          shatterMarks.push({ x: ev.x, y: ev.y, life: 90 });
          break;
        case 'hit': sfx.hit(); shake = 16; flash = 1; burst(ev.x, ev.y, 30, 0, 6, 40); break;
        case 'loop':
          sfx.rewind();
          state = 'rewind'; rewind = REWIND_FRAMES;
          rewindRec = game.echoes[game.echoes.length - 1].rec;
          shatterMarks.length = 0;
          break;
        case 'over': gameOver(); break;
      }
    }
  }

  function gameOver() {
    sfx.over();
    state = 'over';
    const best = Math.max(readBest(), game.score);
    writeBest(best);
    $('over-score').textContent = game.score.toLocaleString('he-IL');
    $('over-loop').textContent = game.loop + 1;
    $('over-kills').textContent = game.stats.kills;
    $('over-echo').textContent = game.stats.kills ? Math.round((game.stats.echoKills / game.stats.kills) * 100) + '%' : '0%';
    $('over-best').textContent = game.score >= best && game.score > 0 ? '★ שיא חדש!' : 'שיא: ' + best.toLocaleString('he-IL');
    setTimeout(() => { if (state === 'over') { ui.over.hidden = false; $('btn-again').focus(); } }, 700);
  }

  // ---------- rendering ----------
  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = `rgba(79,243,255,${0.05 + pulse * 0.05})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= C.W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, C.H); }
    for (let y = 0; y <= C.H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(C.W, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(79,243,255,0.45)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#4ff3ff'; ctx.shadowBlur = 12;
    ctx.strokeRect(0, 0, C.W, C.H);
    ctx.restore();
  }

  function drawSelf(x, y, a, hue, alpha, core) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.shadowColor = `hsl(${hue},100%,65%)`;
    ctx.shadowBlur = core ? 22 : 12;
    ctx.fillStyle = core ? '#ffffff' : `hsl(${hue},100%,65%)`;
    ctx.beginPath(); ctx.arc(0, 0, C.PLAYER_R, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(a);
    ctx.fillStyle = core ? `hsl(${hue},100%,60%)` : `hsl(${hue},100%,85%)`;
    ctx.fillRect(C.PLAYER_R - 3, -3, 10, 6);
    ctx.restore();
  }

  function drawTrail(rec, t, hue, alpha) {
    ctx.save();
    ctx.strokeStyle = `hsla(${hue},100%,65%,${alpha})`;
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    const from = Math.max(0, t - 14);
    for (let i = from; i <= t && i < rec.length; i++) {
      if (i === from) ctx.moveTo(rec[i].x, rec[i].y); else ctx.lineTo(rec[i].x, rec[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawEnemy(en) {
    ctx.save();
    ctx.translate(en.x, en.y);
    if (en.kind === 'chaser') {
      ctx.shadowColor = '#ff4f6b'; ctx.shadowBlur = 14; ctx.fillStyle = '#ff4f6b';
      ctx.rotate(game.totalTicks * 0.08);
      ctx.beginPath();
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; ctx.lineTo(Math.cos(a) * en.r * 1.25, Math.sin(a) * en.r * 1.25); }
      ctx.closePath(); ctx.fill();
    } else if (en.kind === 'eater') {
      ctx.shadowColor = '#b06bff'; ctx.shadowBlur = 18; ctx.fillStyle = '#b06bff';
      const mouth = 0.35 + Math.abs(Math.sin(game.totalTicks * 0.2)) * 0.5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, en.r, mouth, Math.PI * 2 - mouth); ctx.closePath(); ctx.fill();
    } else {
      ctx.shadowColor = '#ff9d2e'; ctx.shadowBlur = 16; ctx.strokeStyle = '#ff9d2e'; ctx.lineWidth = 4;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + game.totalTicks * 0.01; ctx.lineTo(Math.cos(a) * en.r, Math.sin(a) * en.r); }
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,157,46,0.25)'; ctx.fill();
    }
    if (en.hp > 1) {
      ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(en.hp, 0, 0);
    }
    ctx.restore();
  }

  function render() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = '#05060d';
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    applyView(sx, sy);

    drawGrid();
    if (state === 'title') { drawAttract(); return; }

    // shatter marks
    for (const m of shatterMarks) {
      ctx.save(); ctx.globalAlpha = m.life / 90; ctx.strokeStyle = '#4ff3ff'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * 1.05; ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + Math.cos(a) * 16, m.y + Math.sin(a) * 16); }
      ctx.stroke(); ctx.restore();
    }

    if (state === 'rewind' && rewindRec) {
      drawRewind();
    } else {
      // echoes
      for (const { e, i, r } of E.echoPositions(game)) {
        if (!e.alive) continue;
        const hue = echoHue(i);
        drawTrail(e.rec, game.tick, hue, 0.25);
        drawSelf(r.x, r.y, r.a, hue, 0.6, false);
      }
      // bullets
      ctx.save();
      for (const b of game.bullets) {
        ctx.fillStyle = b.owner === 'player' ? '#ffffff' : 'rgba(150,240,255,0.85)';
        ctx.fillRect(b.x - 3, b.y - 3, 6, 6);
      }
      ctx.restore();
      for (const en of game.enemies) drawEnemy(en);
      const p = game.player;
      const blink = p.invuln > 0 && Math.floor(p.invuln / 5) % 2 === 0;
      drawTrail(game.recording, game.tick - 1, 190, 0.5);
      drawSelf(p.x, p.y, p.a, 190, blink ? 0.3 : 1, true);
    }

    // particles
    for (const pt of particles) {
      ctx.globalAlpha = pt.life / pt.max;
      ctx.fillStyle = `hsl(${pt.hue},100%,65%)`;
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // touch joystick
    if (touch.id !== null) {
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(touch.sx, touch.sy, 60, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(79,243,255,0.35)';
      const tx = touch.x - touch.sx, ty = touch.y - touch.sy, d = Math.hypot(tx, ty), k = d > 60 ? 60 / d : 1;
      ctx.beginPath(); ctx.arc(touch.sx + tx * k, touch.sy + ty * k, 22, 0, Math.PI * 2); ctx.fill();
    }

    if (flash > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(255,40,80,${flash * 0.35})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // The just-finished run plays backwards at high speed while the clock resets.
  function drawRewind() {
    const k = 1 - rewind / REWIND_FRAMES; // 0 → 1
    const head = Math.floor((1 - k) * (rewindRec.length - 1));
    ctx.save();
    ctx.strokeStyle = `hsla(${echoHue(game.echoes.length - 1)},100%,65%,0.8)`;
    ctx.lineWidth = 3; ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 16;
    ctx.beginPath();
    for (let i = head; i < Math.min(rewindRec.length, head + 60); i++) {
      const r = rewindRec[i];
      if (i === head) ctx.moveTo(r.x, r.y); else ctx.lineTo(r.x, r.y);
    }
    ctx.stroke();
    ctx.restore();
    const r = rewindRec[head];
    drawSelf(r.x, r.y, r.a, 320, 1, true);
    // every older echo snaps back to the origin too
    for (const { i, e } of E.echoPositions(game)) {
      const rr = e.rec[Math.floor((1 - k) * (e.rec.length - 1))];
      drawSelf(rr.x, rr.y, rr.a, echoHue(i), 0.35, false);
    }
    // caption in screen space so it stays upright when the arena is rotated
    ctx.save();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    const c = toScreen(C.W / 2, C.H / 2);
    const fs = Math.min(64, innerWidth / 8);
    ctx.globalAlpha = Math.sin(k * Math.PI);
    ctx.fillStyle = '#ff4fd8';
    ctx.font = `900 ${fs}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 30;
    ctx.direction = 'ltr';
    ctx.fillText('◀◀ REWIND', c.x, c.y - fs / 2);
    ctx.font = `700 ${fs * 0.45}px system-ui`; ctx.fillStyle = '#4ff3ff'; ctx.shadowColor = '#4ff3ff';
    ctx.direction = 'rtl';
    ctx.fillText(`הד #${game.echoes.length} הצטרף לצבא`, c.x, c.y + fs / 2);
    ctx.restore();
  }

  // Title screen backdrop: a ring of fake echoes orbiting the center.
  function drawAttract() {
    const t = performance.now() / 1000;
    for (let i = 0; i < 12; i++) {
      const a = t * 0.6 + (i / 12) * Math.PI * 2;
      const rr = 150 + Math.sin(t * 1.3 + i) * 40;
      drawSelf(C.W / 2 + Math.cos(a) * rr, C.H / 2 + Math.sin(a) * rr, a + Math.PI / 2, echoHue(i), 0.5, false);
    }
    drawSelf(C.W / 2, C.H / 2, t, 190, 1, true);
  }

  function updateHud() {
    ui.loop.textContent = game.loop + 1;
    ui.echoes.textContent = game.echoes.length;
    ui.lives.textContent = game.lives <= 0 ? '✕' : game.lives <= 5 ? '♥'.repeat(game.lives) : '♥×' + game.lives;
    ui.score.textContent = game.score.toLocaleString('he-IL');
    const left = state === 'rewind' ? 1 - rewind / REWIND_FRAMES : 1 - game.tick / C.LOOP_TICKS;
    ui.timer.style.transform = `scaleX(${left})`;
  }

  // ---------- main loop ----------
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(now - (last || now), 100);
    last = now;

    if (state === 'play') {
      acc += dt;
      let steps = 0;
      while (acc >= STEP_MS && steps < 5 && state === 'play') {
        E.step(game, readInput());
        handleEvents();
        acc -= STEP_MS;
        steps++;
      }
      scheduleMusic();
    } else if (state === 'rewind') {
      if (--rewind <= 0) { state = 'play'; acc = 0; rewindRec = null; }
    }

    if (state !== 'pause') {
      for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life--; }
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
      if (particles.length > 1500) particles.splice(0, particles.length - 1500);
      for (const m of shatterMarks) m.life--;
      while (shatterMarks.length && shatterMarks[0].life <= 0) shatterMarks.shift();
      shake *= 0.85; if (shake < 0.3) shake = 0;
      flash *= 0.9; if (flash < 0.02) flash = 0;
      pulse *= 0.9;
    }

    render();
    if (state !== 'title') updateHud();
  }

  const best = readBest();
  if (best) $('title-best').textContent = 'השיא שלך: ' + best.toLocaleString('he-IL');
  requestAnimationFrame(frame);

  // exposed for automated smoke tests
  window.__echoLoop = { get state() { return state; }, get game() { return game; }, start };
})();
