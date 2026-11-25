const assert = require('assert');
const GL = require('./lib.js');

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('✓', name); }

function sine(freq, sr = 44100, n = 4096, harmonics = [1]) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++)
    for (const h of harmonics) b[i] += (0.5 / h) * Math.sin((2 * Math.PI * freq * h * i) / sr);
  return b;
}

t('A4=440 → A, 0 סנט', () => {
  const n = GL.freqToNote(440);
  assert.deepStrictEqual([n.name, n.octave, n.cents], ['A', 4, 0]);
});
t('E2 (82.41Hz) → E2', () => {
  const n = GL.freqToNote(82.41);
  assert.strictEqual(n.name + n.octave, 'E2');
});
t('סטייה בסנטים', () => {
  assert.ok(Math.abs(GL.freqToNote(445).cents - 20) <= 1);
});
for (const s of GL.TUNING) {
  t(`זיהוי מיתר ${s.name} (עם הרמוניות)`, () => {
    const f = GL.midiToFreq(s.midi);
    const got = GL.detectPitch(sine(f, 44100, 4096, [1, 2, 3]), 44100);
    assert.ok(got && Math.abs(got - f) / f < 0.01, `ציפיתי ${f}, קיבלתי ${got}`);
  });
}
t('שקט → null', () => {
  assert.strictEqual(GL.detectPitch(new Float32Array(4096), 44100), null);
});
t('סולם דו מז׳ור', () => {
  assert.deepStrictEqual(GL.scaleNotes('C', 'major'), ['C', 'D', 'E', 'F', 'G', 'A', 'B']);
});
t('פנטטונית מינור של A', () => {
  assert.deepStrictEqual(GL.scaleNotes('A', 'pentMin'), ['A', 'C', 'D', 'E', 'G']);
});
t('צוואר: פרט 5 במיתר E הוא A, ופרט 0 במיתר e הוא E', () => {
  const fb = GL.fretboard('A', 'pentMin');
  assert.strictEqual(fb[0].cells[5].name, 'A');
  assert.ok(fb[0].cells[5].isRoot);
  assert.strictEqual(fb[5].cells[0].name, 'E');
  assert.strictEqual(fb.length, 6);
  assert.strictEqual(fb[0].cells.length, 13);
});
t('אקורדים בסולם סול מז׳ור', () => {
  const names = GL.majorKeyChords('G').map((c) => c.name);
  assert.deepStrictEqual(names, ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim']);
});
t('לכל אקורד 6 ערכים', () => {
  for (const [k, v] of Object.entries(GL.CHORDS)) assert.strictEqual(v.length, 6, k);
});
t('תווי האקורדים נכונים (C, Am, G)', () => {
  const notesOf = (name) => GL.CHORDS[name]
    .map((f, i) => (f < 0 ? null : GL.NOTES[(GL.TUNING[i].midi + f) % 12]))
    .filter(Boolean);
  const uniq = (a) => [...new Set(a)].sort();
  assert.deepStrictEqual(uniq(notesOf('C')), ['C', 'E', 'G']);
  assert.deepStrictEqual(uniq(notesOf('Am')), ['A', 'C', 'E']);
  assert.deepStrictEqual(uniq(notesOf('G')), ['B', 'D', 'G']);
  assert.deepStrictEqual(uniq(notesOf('E7')), ['B', 'D', 'E', 'G#']);
});
t('מרווח מטרונום 120 BPM = 0.5ש׳', () => assert.strictEqual(GL.beatInterval(120), 0.5));
t('טאפ טמפו 500ms = 120', () => assert.strictEqual(GL.tapTempo([0, 500, 1000, 1500]), 120));

console.log(`\n${passed} בדיקות עברו`);
