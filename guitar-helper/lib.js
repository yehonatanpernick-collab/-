// לוגיקה טהורה (ללא DOM) כדי שאפשר יהיה לבדוק אותה ב-Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // מיתרים מהעבה לדק, כולל מספר MIDI
  const TUNING = [
    { name: 'E', midi: 40 }, { name: 'A', midi: 45 }, { name: 'D', midi: 50 },
    { name: 'G', midi: 55 }, { name: 'B', midi: 59 }, { name: 'e', midi: 64 },
  ];

  function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function freqToNote(f) {
    const exact = freqToMidi(f);
    const midi = Math.round(exact);
    return {
      midi,
      name: NOTES[((midi % 12) + 12) % 12],
      octave: Math.floor(midi / 12) - 1,
      cents: Math.round((exact - midi) * 100),
    };
  }

  // זיהוי גובה צליל באוטו-קורלציה עם אינטרפולציה פרבולית.
  function detectPitch(buf, sampleRate) {
    const n = buf.length;
    let rms = 0;
    for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.01) return null; // שקט

    const minLag = Math.floor(sampleRate / 1000); // עד ~1000Hz
    const maxLag = Math.min(Math.floor(sampleRate / 60), n >> 1); // מ-~60Hz
    const d = new Float32Array(maxLag + 1);
    // NSDF (McLeod)
    for (let lag = minLag; lag <= maxLag; lag++) {
      let acf = 0, m = 0;
      for (let i = 0; i < n - lag; i++) {
        acf += buf[i] * buf[i + lag];
        m += buf[i] * buf[i] + buf[i + lag] * buf[i + lag];
      }
      d[lag] = m ? (2 * acf) / m : 0;
    }
    // הפסגה הראשונה שמעל 90% מהמקסימום
    let max = 0;
    for (let lag = minLag + 1; lag < maxLag; lag++) if (d[lag] > max) max = d[lag];
    if (max < 0.5) return null;
    const thr = max * 0.9;
    let best = -1;
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (d[lag] > thr && d[lag] >= d[lag - 1] && d[lag] >= d[lag + 1]) { best = lag; break; }
    }
    if (best < 0) return null;
    const a = d[best - 1], b = d[best], c = d[best + 1];
    const denom = a - 2 * b + c;
    const shift = denom ? (0.5 * (a - c)) / denom : 0;
    return sampleRate / (best + shift);
  }

  function nearestString(midi) {
    let best = TUNING[0];
    for (const s of TUNING) if (Math.abs(s.midi - midi) < Math.abs(best.midi - midi)) best = s;
    return best;
  }

  const SCALES = {
    major: { label: 'מז׳ור', iv: [0, 2, 4, 5, 7, 9, 11] },
    minor: { label: 'מינור טבעי', iv: [0, 2, 3, 5, 7, 8, 10] },
    pentMaj: { label: 'פנטטונית מז׳ור', iv: [0, 2, 4, 7, 9] },
    pentMin: { label: 'פנטטונית מינור', iv: [0, 3, 5, 7, 10] },
    blues: { label: 'בלוז', iv: [0, 3, 5, 6, 7, 10] },
    dorian: { label: 'דורי', iv: [0, 2, 3, 5, 7, 9, 10] },
    mixolydian: { label: 'מיקסולידי', iv: [0, 2, 4, 5, 7, 9, 10] },
  };

  function scaleNotes(rootName, scaleKey) {
    const r = NOTES.indexOf(rootName);
    if (r < 0 || !SCALES[scaleKey]) throw new Error('סולם לא מוכר');
    return SCALES[scaleKey].iv.map((i) => NOTES[(r + i) % 12]);
  }

  // מטריצת הצוואר: לכל מיתר ופרט - שם התו ואם הוא בסולם/שורש
  function fretboard(rootName, scaleKey, frets = 12) {
    const set = new Set(scaleNotes(rootName, scaleKey));
    return TUNING.map((s) => {
      const row = [];
      for (let f = 0; f <= frets; f++) {
        const name = NOTES[(s.midi + f) % 12];
        row.push({ fret: f, name, inScale: set.has(name), isRoot: name === rootName });
      }
      return { string: s.name, cells: row };
    });
  }

  // אקורדים: פרטים לכל מיתר (E A D G B e); -1 = מושתק
  const CHORDS = {
    C: [-1, 3, 2, 0, 1, 0], D: [-1, -1, 0, 2, 3, 2], E: [0, 2, 2, 1, 0, 0],
    F: [1, 3, 3, 2, 1, 1], G: [3, 2, 0, 0, 0, 3], A: [-1, 0, 2, 2, 2, 0],
    B: [-1, 2, 4, 4, 4, 2],
    Am: [-1, 0, 2, 2, 1, 0], Bm: [-1, 2, 4, 4, 3, 2], Dm: [-1, -1, 0, 2, 3, 1],
    Em: [0, 2, 2, 0, 0, 0],
    C7: [-1, 3, 2, 3, 1, 0], D7: [-1, -1, 0, 2, 1, 2], E7: [0, 2, 0, 1, 0, 0],
    G7: [3, 2, 0, 0, 0, 1], A7: [-1, 0, 2, 0, 2, 0], B7: [-1, 2, 1, 2, 0, 2],
    Cmaj7: [-1, 3, 2, 0, 0, 0], Fmaj7: [-1, -1, 3, 2, 1, 0],
    Am7: [-1, 0, 2, 0, 1, 0], Em7: [0, 2, 0, 0, 0, 0], Dm7: [-1, -1, 0, 2, 1, 1],
    Dsus4: [-1, -1, 0, 2, 3, 3], Asus2: [-1, 0, 2, 2, 0, 0],
  };

  // אקורדים בסולם מז׳ור: מחזיר שמות עם סיומת (I ii iii IV V vi vii°)
  function majorKeyChords(rootName) {
    const names = scaleNotes(rootName, 'major');
    const q = ['', 'm', 'm', '', '', 'm', 'dim'];
    const rn = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
    return names.map((n, i) => ({ roman: rn[i], name: n + q[i], hasDiagram: !!CHORDS[n + q[i]] }));
  }

  // תדר מטרונום: מרווח בשניות בין פעימות
  function beatInterval(bpm) { return 60 / bpm; }

  function tapTempo(times) {
    if (times.length < 2) return null;
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    return Math.max(30, Math.min(300, Math.round(60000 / avg)));
  }

  return {
    NOTES, TUNING, SCALES, CHORDS, freqToMidi, midiToFreq, freqToNote, detectPitch,
    nearestString, scaleNotes, fretboard, majorKeyChords, beatInterval, tapTempo,
  };
});
