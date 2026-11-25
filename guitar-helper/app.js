(function () {
  const $ = (s) => document.querySelector(s);
  const GL = window.GL;
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ---------- טאבים ----------
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === b.dataset.tab));
      if (b.dataset.tab !== 'tuner') stopTuner();
    };
  });

  // ---------- מכוון ----------
  let tCtx, tStream, tRaf;
  const tStrings = $('#tStrings');
  GL.TUNING.forEach((s) => {
    const b = document.createElement('button');
    b.textContent = s.name; b.dataset.midi = s.midi;
    tStrings.appendChild(b);
  });
  async function startTuner() {
    try {
      tStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
    } catch (e) {
      $('#tInfo').textContent = 'אין גישה למיקרופון. אשרו הרשאה בדפדפן ונסו שוב.';
      return;
    }
    tCtx = new (window.AudioContext || window.webkitAudioContext)();
    const an = tCtx.createAnalyser(); an.fftSize = 4096;
    tCtx.createMediaStreamSource(tStream).connect(an);
    const buf = new Float32Array(an.fftSize);
    $('#tStart').textContent = 'עצור';
    let smooth = null;
    (function loop() {
      an.getFloatTimeDomainData(buf);
      const f = GL.detectPitch(buf, tCtx.sampleRate);
      if (f) {
        smooth = smooth ? smooth * 0.6 + f * 0.4 : f;
        const n = GL.freqToNote(smooth);
        const str = GL.nearestString(n.midi);
        const cents = Math.max(-50, Math.min(50, n.cents));
        $('#tNote').textContent = n.name + n.octave;
        $('#needle').style.left = 50 + cents + '%';
        $('#tInfo').textContent = `${smooth.toFixed(1)} Hz · ${n.cents > 0 ? '+' : ''}${n.cents} סנט · ` +
          (Math.abs(n.cents) <= 5 ? 'מכוון ✔' : n.cents > 0 ? 'גבוה מדי, הרפו' : 'נמוך מדי, מתחו');
        tStrings.querySelectorAll('button').forEach((b) => b.classList.toggle('hit', +b.dataset.midi === str.midi));
      } else smooth = null;
      tRaf = requestAnimationFrame(loop);
    })();
  }
  function stopTuner() {
    cancelAnimationFrame(tRaf);
    if (tStream) tStream.getTracks().forEach((t) => t.stop());
    if (tCtx) tCtx.close();
    tStream = tCtx = null;
    $('#tStart').textContent = 'התחל';
  }
  $('#tStart').onclick = () => (tStream ? stopTuner() : startTuner());
  // לחיצה על מיתר משמיעה צליל ייחוס
  tStrings.onclick = (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = GL.midiToFreq(+e.target.dataset.midi);
    g.gain.setValueAtTime(0.2, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 1.5);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 1.5);
    setTimeout(() => c.close(), 1800);
  };

  // ---------- מטרונום ----------
  let mCtx, mTimer, nextTime, beatNo, running = false;
  let bpm = store.get('bpm', 100);
  const dots = $('#dots');
  function renderDots() {
    dots.innerHTML = '';
    for (let i = 0; i < +$('#beats').value; i++) {
      const d = document.createElement('div'); d.className = 'dot' + (i === 0 ? ' first' : ''); dots.appendChild(d);
    }
  }
  function setBpm(v) {
    bpm = Math.max(30, Math.min(240, Math.round(v)));
    $('#bpm').value = bpm; $('#bpmVal').textContent = bpm; store.set('bpm', bpm);
  }
  function click(t, accent) {
    const o = mCtx.createOscillator(), g = mCtx.createGain();
    o.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(mCtx.destination); o.start(t); o.stop(t + 0.06);
  }
  function scheduler() {
    const beats = +$('#beats').value;
    while (nextTime < mCtx.currentTime + 0.15) {
      const idx = beatNo % beats;
      click(nextTime, idx === 0);
      const delay = Math.max(0, (nextTime - mCtx.currentTime) * 1000);
      setTimeout(() => {
        dots.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('beat', i === idx));
      }, delay);
      nextTime += GL.beatInterval(bpm); beatNo++;
    }
  }
  function toggleMetro() {
    if (running) {
      clearInterval(mTimer); mCtx.close(); running = false;
      $('#mStart').textContent = 'התחל';
      dots.querySelectorAll('.dot').forEach((d) => d.classList.remove('beat'));
      return;
    }
    mCtx = new (window.AudioContext || window.webkitAudioContext)();
    nextTime = mCtx.currentTime + 0.05; beatNo = 0; running = true;
    mTimer = setInterval(scheduler, 25); scheduler();
    $('#mStart').textContent = 'עצור';
  }
  $('#mStart').onclick = toggleMetro;
  $('#bpm').oninput = (e) => setBpm(+e.target.value);
  $('#bpmMinus').onclick = () => setBpm(bpm - 1);
  $('#bpmPlus').onclick = () => setBpm(bpm + 1);
  $('#beats').onchange = renderDots;
  let taps = [];
  $('#tap').onclick = () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now); taps = taps.slice(-6);
    const v = GL.tapTempo(taps); if (v) setBpm(v);
  };
  setBpm(bpm); renderDots();

  // ---------- אקורדים ----------
  const keySel = $('#keySel');
  GL.NOTES.forEach((n) => keySel.add(new Option(n, n)));
  keySel.value = store.get('key', 'G');
  function chip(name, ok) {
    const b = document.createElement('button');
    b.textContent = name; b.className = 'chip' + (ok ? '' : ' noDiag');
    b.onclick = () => showChord(name);
    return b;
  }
  function renderKey() {
    store.set('key', keySel.value);
    const box = $('#keyChords'); box.innerHTML = '';
    GL.majorKeyChords(keySel.value).forEach((c) => {
      const b = chip(c.name, c.hasDiagram); b.title = c.roman; b.textContent = `${c.roman}  ${c.name}`;
      b.onclick = () => showChord(c.name); box.appendChild(b);
    });
  }
  keySel.onchange = renderKey;
  Object.keys(GL.CHORDS).forEach((n) => $('#allChords').appendChild(chip(n, true)));
  function showChord(name) {
    const frets = GL.CHORDS[name], v = $('#chordView');
    if (!frets) { v.innerHTML = `<div class="name">${name}</div><div class="muted">אין עדיין דיאגרמה לאקורד הזה</div>`; return; }
    const played = frets.filter((f) => f > 0);
    const base = played.length && Math.max(...played) > 4 ? Math.min(...played) : 1;
    const W = 160, H = 190, x0 = 20, y0 = 40, sx = 24, sy = 28;
    let s = `<svg viewBox="0 0 ${W + 20} ${H}" direction="ltr">`;
    const c = 'currentColor';
    for (let i = 0; i < 6; i++) s += `<line x1="${x0 + i * sx}" y1="${y0}" x2="${x0 + i * sx}" y2="${y0 + 5 * sy}" stroke="${c}" opacity=".6"/>`;
    for (let j = 0; j <= 5; j++) s += `<line x1="${x0}" y1="${y0 + j * sy}" x2="${x0 + 5 * sx}" y2="${y0 + j * sy}" stroke="${c}" stroke-width="${j === 0 && base === 1 ? 4 : 1}" opacity=".7"/>`;
    if (base > 1) s += `<text x="${x0 + 5 * sx + 8}" y="${y0 + 18}" font-size="12" fill="${c}">${base}fr</text>`;
    frets.forEach((f, i) => {
      const x = x0 + i * sx;
      if (f < 0) s += `<text x="${x}" y="${y0 - 10}" font-size="14" text-anchor="middle" fill="${c}">×</text>`;
      else if (f === 0) s += `<circle cx="${x}" cy="${y0 - 14}" r="5" fill="none" stroke="${c}"/>`;
      else s += `<circle cx="${x}" cy="${y0 + (f - base + 0.5) * sy}" r="9" fill="#f0a030"/>`;
    });
    v.innerHTML = `<div class="name">${name}</div>${s}</svg>`;
  }
  renderKey(); showChord('G');

  // ---------- סולמות ----------
  const rootSel = $('#rootSel'), scaleSel = $('#scaleSel');
  GL.NOTES.forEach((n) => rootSel.add(new Option(n, n)));
  Object.entries(GL.SCALES).forEach(([k, v]) => scaleSel.add(new Option(v.label, k)));
  rootSel.value = store.get('root', 'A'); scaleSel.value = store.get('scale', 'pentMin');
  function renderScale() {
    const r = rootSel.value, sc = scaleSel.value;
    store.set('root', r); store.set('scale', sc);
    $('#notesLine').textContent = GL.scaleNotes(r, sc).join(' – ');
    const fb = GL.fretboard(r, sc, 12);
    let h = '<div class="fret"><table><tr><th></th>' + fb[0].cells.map((c) => `<th>${c.fret}</th>`).join('') + '</tr>';
    for (const row of fb.slice().reverse()) {
      h += `<tr><th>${row.string}</th>` + row.cells.map((c) => `<td class="${c.isRoot ? 'root' : c.inScale ? 'in' : ''}">${c.name}</td>`).join('') + '</tr>';
    }
    $('#fretWrap').innerHTML = h + '</table></div>';
  }
  rootSel.onchange = scaleSel.onchange = renderScale; renderScale();

  // ---------- יומן תרגול ----------
  let startedAt = null, tick;
  const fmt = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  function renderLog() {
    const list = store.get('sessions', []);
    const week = list.filter((x) => Date.now() - x.t < 7 * 864e5).reduce((a, x) => a + x.sec, 0);
    $('#lStats').textContent = `השבוע: ${Math.round(week / 60)} דקות · סה״כ ${list.length} מפגשים`;
    $('#lList').innerHTML = list.slice(-8).reverse().map((x) =>
      `<li><b>${fmt(x.sec)}</b> · ${new Date(x.t).toLocaleDateString('he-IL')} ${x.note ? '· ' + x.note.replace(/</g, '&lt;') : ''}</li>`).join('');
  }
  $('#lStart').onclick = () => {
    if (startedAt) return;
    startedAt = Date.now();
    tick = setInterval(() => { $('#timer').textContent = fmt(Math.floor((Date.now() - startedAt) / 1000)); }, 500);
  };
  $('#lStop').onclick = () => {
    if (!startedAt) return;
    clearInterval(tick);
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    startedAt = null;
    if (sec >= 5) {
      const list = store.get('sessions', []);
      list.push({ t: Date.now(), sec, note: $('#lNote').value.trim() });
      store.set('sessions', list);
    }
    $('#lNote').value = ''; $('#timer').textContent = '00:00'; renderLog();
  };
  renderLog();
})();
