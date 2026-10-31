import * as THREE from 'three';
import { makeNoise } from './noise.js';
import * as S from './structures.js';

const n1 = makeNoise(11), n2 = makeNoise(23), n3 = makeNoise(37);
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const fbm = (x, z, o = 4, nn = n1) => { let a = 1, f = 1, s = 0, t = 0; for (let i = 0; i < o; i++) { s += a * nn(x * f, z * f); t += a; a *= 0.5; f *= 2.03; } return s / t; };
const ridged = (x, z, o = 4) => { let a = 1, f = 1, s = 0, t = 0; for (let i = 0; i < o; i++) { s += a * (1 - Math.abs(n2(x * f, z * f))); t += a; a *= 0.5; f *= 2.1; } return s / t; };
function segDist(px, pz, ax, az, bx, bz) { const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az; const t = clamp01((wx * vx + wz * vz) / (vx * vx + vz * vz)); return Math.hypot(wx - vx * t, wz - vz * t); }
const pathDist = (x, z, pts) => { let d = 1e9; for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return d; };
function flatten(h, x, z, spots) { for (const s of spots) { const d = Math.hypot(x - s.x, z - s.z); if (d < s.r) h = lerp(h, s.h, smooth(s.r, s.r * (s.k || 0.55), d)); } return h; }
const border = (x, z, half, k = 1) => { const r = Math.max(Math.abs(x), Math.abs(z)) + n3(x * 0.03, z * 0.03) * 8; return smooth(half - 38, half - 6, r) * (16 + ridged(x * 0.02, z * 0.02) * 26) * k; };
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const LIORA = 'ליאורה';

// =====================================================================================
export const STAGES = [
// ---------------------------------------------------------------- I. LIGHT
{
  id: 'light', num: 'I', name: 'אחו השמש', genre: 'פנטזיית אור', mood: 0,
  lore: 'באחו הזהוב, שם השמש נוגעת באדמה ראשונה, השלדים הישנים מתחילים להתעורר.',
  exposure: 1.0, hdr: 'env/spruit_sunrise_1k.hdr', envInt: 0.55,
  sun: { dir: [0.55, 0.42, 0.35], color: '#ffe2b8', intensity: 3.4 }, hemi: { sky: '#bcd8ff', ground: '#6a7a40', intensity: 0.7 },
  sky: { top: '#3f7fd6', horizon: '#ffe0b8', ground: '#c8b89a', clouds: 0.55, cloudCol: '#fffaf0', cloudShade: '#9aa8c0', sunDisc: '#fff0d0' },
  fog: { color: '#d8e6f4', density: 0.0066, base: 0, falloff: 0.045, scatter: 0.7, rays: 0.55 },
  grade: { tint: '#fff4e6', shadow: '#e6f0ff', sat: 1.12, contrast: 1.06, vignette: 0.35 },
  particles: { color: '#ffe9a8', rise: 0 },
  grassColors: { base: '#24391a', tip: '#8fbf4f', tip2: '#d6cd6a', height: 1.05 },
  liquid: { level: 0, shallow: '#4aa8a0', deep: '#0d3a4a', sky: '#a8cff0' },
  start: { x: -52, z: -78, facing: 0.5 },
  terrain: (() => {
    const path = [[-52, -78], [-46, -55], [-14, -28], [22, -40], [54, -38], [40, 4], [10, 40], [18, 58], [-14, 70], [-38, 80]];
    const spots = [{ x: -48, z: -52, r: 16, h: 3.2 }, { x: -12, z: -24, r: 9, h: 7.5 }, { x: 56, z: -40, r: 9, h: 5.5 }, { x: 18, z: 58, r: 9, h: 8 }, { x: -38, z: 82, r: 14, h: 9 }];
    const H = (x, z) => {
      let h = 2.4 + fbm(x * 0.011, z * 0.011) * 6 + fbm(x * 0.045, z * 0.045, 3) * 1.1 + Math.max(0, n2(x * 0.02 + 3, z * 0.02)) * 8;
      const dl = Math.hypot(x - 30, z - 22) + n3(x * 0.05, z * 0.05) * 6; h = lerp(h, -3.2, smooth(30, 10, dl));
      h += border(x, z, 120);
      return flatten(h, x, z, spots);
    };
    return { size: 240, height: H, path, spots,
      splat: (x, z, h, sl) => { const p = smooth(3.2, 1.6, pathDist(x, z, path) + n1(x * 0.2, z * 0.2) * 0.8); const rock = smooth(0.28, 0.5, sl) + smooth(20, 26, h) * 0.6; const snow = smooth(27, 32, h + n2(x * 0.1, z * 0.1) * 3) * smooth(0.6, 0.3, sl); const sand = smooth(1.2, 0.2, h); return [Math.max(0, 1 - p - rock - sand), p + sand * 0.9, rock, snow]; },
      grass: (x, z, h, sl, w) => w[0] * smooth(0.4, 1.2, h) * smooth(0.45, 0.25, sl),
      layers: { grass: '#e0eebc', grass2: '#fff0b0', dirt: '#d6bf98', rock: '#c8c2b8', snow: '#f4f7ff' } };
  })(),
  async build(L) {
    const T = L.def.terrain;
    const stone = S.stoneMat('#d8d2c4', { moss: 0.5 });
    S.stoneCircle(L.scene, -48, L.h(-48, -52), -52, 10, 10, stone);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; L.collider(-48 + Math.cos(a) * 10, -52 + Math.sin(a) * 10, 1.0); }
    L.collider(-48, -52, 1.6);
    L.beacons = [[-12, -24], [56, -40], [18, 58]].map(([x, z]) => { const b = S.beacon(L.scene, x, L.h(x, z), z, stone); L.collider(x, z, 1.0); return b; });
    L.portal = S.portal(L.scene, -38, L.h(-38, 82), 82, '#ffe6a0', '#ffffff', Math.PI * 0.85);
    // vegetation
    const avoid = (x, z, pad = 0) => { if (pathDist(x, z, T.path) < 4 + pad) return true; for (const s of T.spots) if (Math.hypot(x - s.x, z - s.z) < s.r * 0.8 + pad) return true; return false; };
    const ok = (x, z, h, sl) => h > 0.8 && sl < 0.32 && h < 18 && !avoid(x, z);
    await L.trees('Oak Large', { height: 15, seed: 3 }, L.scatter(L.n(26), ok, 9, 0.9, 1.25));
    await L.trees('Oak Medium', { height: 11, seed: 7, leafTint: 0xd8f0a0 }, L.scatter(L.n(30), ok, 8, 0.85, 1.2));
    await L.trees('Aspen Medium', { height: 12, seed: 5 }, L.scatter(L.n(24), (x, z, h, sl) => ok(x, z, h, sl) && n2(x * 0.03, z * 0.03) > -0.1, 6, 0.85, 1.2));
    await L.trees('Bush 1', { height: 1.6, seed: 2, radius: 0.5 }, L.scatter(L.n(60), ok, 3, 0.7, 1.4));
    await L.trees('Bush 2', { height: 1.5, seed: 9, radius: 0.5 }, L.scatter(L.n(40), ok, 3, 0.7, 1.3));
    for (const f of ['flower_yellow', 'flower_white', 'flower_blue']) await L.props(`nature/${f}.glb`, L.scatter(L.n(170), (x, z, h, sl) => h > 0.8 && sl < 0.3 && pathDist(x, z, T.path) > 2.5 && n1(x * 0.04 + 9, z * 0.04) > 0.05, 1.2, 1.4, 2.4), { shadow: false });
    for (const r of ['rock1', 'rock2', 'rock3']) {
      await L.props(`nature/${r}.glb`, L.scatter(L.n(14), (x, z, h, sl) => h > 0.3 && !avoid(x, z, 2), 6, 1.2, 3.2, true), { collide: 0.9 });
      await L.props(`nature/${r}.glb`, L.scatter(L.n(10), (x, z, h, sl) => sl > 0.25 && h > 6, 10, 4, 8, true), { collide: 2.5 });
    }
    L.motes(L.scatter(14, (x, z, h, sl) => h > 1 && sl < 0.3 && !avoid(x, z, -3) && Math.abs(x) < 95 && Math.abs(z) < 95, 25).map(p => v3(p.x, p.y + 1.2, p.z)));
    // ambient wanderers
    for (const [x, z] of [[10, -60], [-70, 10], [70, 20], [-10, 15]]) L.spawn('minion', x, z, {});
  },
  steps: [
    { text: 'הגע אל מעגל האבנים העתיק', marker: L => v3(-48, L.h(-48, -52) + 2, -52),
      async enter(L) { await L.say([[LIORA, 'הנה אתה, אביר. השמש עוד זוכרת את שמך.'], [LIORA, L.touch ? 'הג׳ויסטיק משמאל מזיז אותך, וגרירה בצד ימין מסובבת את המצלמה.' : 'WASD לתנועה, העכבר מסובב את המצלמה. בוא אחריי אל מעגל האבנים.']]); },
      update: L => L.near(v3(-48, 0, -52), 9) },
    { text: 'הבס את השלדים שהתעוררו', progress: L => `${L.flags.k1 || 0}/3`,
      async enter(L) {
        L.say([[LIORA, 'האדמה רועדת... הם קמים! ' + (L.touch ? 'לחץ ⚔ להתקפה, ברצף לקומבו. » להתגלגלות.' : 'קליק שמאלי להתקפה – ברצף לקומבו של שלוש מכות. Shift להתגלגלות מהמכות שלהם.')]]);
        L.flags.k1 = 0; L.group1 = [];
        for (const [dx, dz] of [[6, 4], [-5, 6], [2, -7]]) L.group1.push(await L.spawn('minion', -48 + dx, -52 + dz, { rise: true, alert: true }));
      },
      update: L => { L.flags.k1 = L.group1.filter(e => !e.alive).length; return L.flags.k1 >= 3; } },
    { text: 'הדלק את שלוש משואות השמש', progress: L => `${L.beacons.filter(b => b.lit).length}/3`, marker: L => { const b = L.beacons.filter(b => !b.lit).sort((a, b2) => a.pos.distanceTo(L.hero.pos) - b2.pos.distanceTo(L.hero.pos))[0]; return b ? b.pos : null; },
      async enter(L) {
        await L.say([[LIORA, 'יפה מאוד! עכשיו – שלוש משואות השמש כבו. הדלק אותן מחדש, והשער אל היער ייפתח.'], [LIORA, L.touch ? 'כשתגיע אליהן, לחץ על כפתור ✋.' : 'כשתגיע אליהן, לחץ E. ואם המאנה מלאה – Q משגר כדור אור.']]);
        L.beacons.forEach((b, i) => {
          b.guard = false;
          L.interact({ pos: b.pos.clone().setY(b.pos.y - 4), r: 3.2, label: 'הדלק משואה', use: () => {
            if (L.enemies.aliveCount(e => e.opts.beacon === i) > 0) { L.toast('השומרים עוד בחיים'); return false; }
            b.lit = true; b.fire.visible = true; b.light.intensity = 60; L.fx.emit(b.pos, { count: 80, color: '#ffc46a', speed: 7, life: 1.2, size: 0.7, up: 2 }); L.fx.ring(b.pos.clone().setY(b.pos.y - 5), { color: '#ffd27a', r0: 1, r1: 12, dur: 0.9 });
            L.emitter({ x: b.pos.x, y: b.pos.y + 0.2, z: b.pos.z, color: '#ffae4a', rate: 26, spread: 0.6, up: 3, life: 0.8, size: 0.7 }); L.sfx('beacon'); return true; } });
        });
      },
      update(L) {
        L.beacons.forEach((b, i) => { if (!b.guard && L.near(b.pos, 26)) { b.guard = true; for (let k = 0; k < 3; k++) { const a = k * 2.1; L.spawn(k === 2 && i > 0 ? 'warrior' : 'minion', b.pos.x + Math.cos(a) * 5, b.pos.z + Math.sin(a) * 5, { rise: true, alert: true, beacon: i }); } } });
        return L.beacons.every(b => b.lit);
      } },
    { text: 'היכנס אל שער האור', marker: L => L.portal.pos,
      async enter(L) { L.openPortal(); await L.say([[LIORA, 'השער נפתח! מעבר לו – היער המכושף. היזהר, שם האגדות אמיתיות... גם הרעות שבהן.']]); },
      update: L => L.near(L.portal.pos, 3.2) },
  ],
},
// ---------------------------------------------------------------- II. FAIRYTALE
{
  id: 'fairy', num: 'II', name: 'היער המכושף', genre: 'פנטזיית אגדות', mood: 1,
  lore: 'ביער שבו הפטריות זוהרות והעצים לוחשים, מכשפה כלאה את פיות האור.',
  exposure: 1.35, hdr: 'env/moonless_golf_1k.hdr', envInt: 1.3,
  sun: { dir: [-0.5, 0.3, 0.55], color: '#ffb6e0', intensity: 2.6 }, hemi: { sky: '#a89aff', ground: '#3a4a5a', intensity: 1.5 },
  sky: { top: '#1c1650', horizon: '#ff9ac8', ground: '#3a2a4a', clouds: 0.45, cloudCol: '#ffc8e8', cloudShade: '#4a3a7a', sunDisc: '#ffd8f0', stars: 0.7, aurora: 0.8, auroraCol: '#50ffd0', moon: true, moonDir: [0.5, 0.5, -0.7], moonCol: '#e8e0ff' },
  fog: { color: '#7a62b0', density: 0.0121, base: 0, falloff: 0.07, scatter: 0.5, rays: 0.4 },
  grade: { tint: '#f6eaff', shadow: '#c8d8ff', sat: 1.2, contrast: 1.1, vignette: 0.45 },
  particles: { color: '#a8ffe8', rise: 0.15 },
  grassColors: { base: '#13261f', tip: '#3f8a6a', tip2: '#7a5ab0', height: 1.0 },
  liquid: { level: 0, shallow: '#3a7a9a', deep: '#0a1430', sky: '#8a7ad8' },
  start: { x: 0, z: -92, facing: 0 },
  terrain: (() => {
    const path = [[0, -92], [-8, -60], [-45, -32], [-20, -8], [40, -42], [48, 30], [10, 40], [-38, 44], [-5, 62], [0, 82], [0, 100]];
    const spots = [{ x: -50, z: -30, r: 10, h: 2.5 }, { x: 45, z: -45, r: 10, h: 3 }, { x: 55, z: 32, r: 10, h: 3 }, { x: -40, z: 46, r: 10, h: 3 }, { x: 0, z: 82, r: 26, h: 3.5 }, { x: 0, z: 101, r: 9, h: 4 }, { x: 0, z: -92, r: 8, h: 2.5 }];
    const H = (x, z) => {
      let h = 2.2 + fbm(x * 0.014, z * 0.014) * 5 + fbm(x * 0.06, z * 0.06, 3) * 0.9 + Math.max(0, n2(x * 0.025, z * 0.025)) * 5;
      const dl = Math.hypot(x - 5, z - 5) + n3(x * 0.06, z * 0.06) * 5; h = lerp(h, -2.6, smooth(20, 6, dl));
      h += border(x, z, 110);
      return flatten(h, x, z, spots);
    };
    return { size: 220, height: H, path, spots,
      splat: (x, z, h, sl) => { const p = smooth(2.8, 1.4, pathDist(x, z, path) + n1(x * 0.2, z * 0.2) * 0.7); const rock = smooth(0.3, 0.5, sl); const moss = smooth(0.1, 0.5, n1(x * 0.05, z * 0.05)) * 0.6; return [Math.max(0, 1 - p - rock) * (1 - moss), p + smooth(0.9, 0.2, h), rock, moss * (1 - p)]; },
      grass: (x, z, h, sl, w) => (w[0] + w[3] * 0.7) * smooth(0.4, 1.0, h) * smooth(0.45, 0.25, sl),
      layers: { grass: '#7aa890', grass2: '#9a88c8', dirt: '#8a7a88', rock: '#9a94a8', snow: '#2c5a3a', snowRough: 0.9, glow: '#6a2aff' } };
  })(),
  async build(L) {
    const T = L.def.terrain;
    const avoid = (x, z, pad = 0) => { if (pathDist(x, z, T.path) < 3.5 + pad) return true; for (const s of T.spots) if (Math.hypot(x - s.x, z - s.z) < s.r * 0.85 + pad) return true; return false; };
    const ok = (x, z, h, sl) => h > 0.6 && sl < 0.35 && !avoid(x, z);
    await L.trees('Oak Large', { height: 17, seed: 31, leafTint: 0xc8a0ff, leafGlow: 0x1a0830, barkTint: 0xb8a8c8 }, L.scatter(L.n(36), ok, 7, 0.9, 1.3));
    await L.trees('Ash Large', { height: 15, seed: 12, leafTint: 0x80e8d0, leafGlow: 0x062a20 }, L.scatter(L.n(34), ok, 7, 0.9, 1.25));
    await L.trees('Aspen Large', { height: 14, seed: 44, leafTint: 0xffa8d8, leafGlow: 0x30081a }, L.scatter(L.n(22), ok, 6, 0.85, 1.2));
    await L.trees('Bush 3', { height: 2.4, seed: 4, radius: 0, leafTint: 0x9ad0b0 }, L.scatter(L.n(60), ok, 3, 0.7, 1.3));
    await L.mushrooms(L.scatter(L.n(90), (x, z, h, sl) => h > 0.5 && sl < 0.35 && !avoid(x, z, -1.5), 3, 0.5, 3.2), ['#ff5fb8', '#5fd8ff', '#b07aff', '#7affc8']);
    await L.mushrooms(L.scatter(14, (x, z) => Math.hypot(x, z - 82) > 19 && Math.hypot(x, z - 82) < 23, 3, 2.5, 4.5), ['#ff5fb8', '#5fd8ff']);
    for (const r of ['rock1', 'rock2', 'rock3']) await L.props(`nature/${r}.glb`, L.scatter(L.n(16), (x, z, h) => h > 0.3 && !avoid(x, z, 2), 6, 1.2, 3.4, true), { collide: 1, tint: '#9aa8a0' });
    L.cages = [[-50, -30], [45, -45], [55, 32], [-40, 46]].map(([x, z]) => S.cage(L.scene, x, L.h(x, z), z));
    L.portal = S.portal(L.scene, 0, L.h(0, 101), 101, '#b07aff', '#7affe0', Math.PI);
    L.motes(L.scatter(14, (x, z, h, sl) => h > 0.8 && sl < 0.3 && !avoid(x, z, -2) && Math.abs(x) < 90 && Math.abs(z) < 90, 25).map(p => v3(p.x, p.y + 1.2, p.z)));
    L.emitArea({ color: '#9affd8', count: 3 });
    for (const [x, z] of [[-60, -70], [30, -75], [-70, 0], [72, -5]]) L.spawn(Math.random() < 0.5 ? 'thief' : 'minion', x, z, {});
  },
  steps: [
    { text: 'שחרר את פיות האור הכלואות', progress: L => `${L.cages.filter(c => c.open).length}/4`, marker: L => { const c = L.cages.filter(c => !c.open).sort((a, b) => a.pos.distanceTo(L.hero.pos) - b.pos.distanceTo(L.hero.pos))[0]; return c ? c.pos.clone().setY(c.pos.y + 2) : null; },
      async enter(L) {
        await L.say([[LIORA, 'אחיותיי! מורגנה המכשפה כלאה אותן בכלובי ברזל. אני שומעת אותן בוכות.'], [LIORA, 'שחרר את ארבעתן. הגנבים בשירותה שומרים עליהן – אל תיתן להם להקיף אותך.']]);
        L.cages.forEach((c, i) => {
          c.guard = false;
          L.interact({ pos: c.pos, r: 2.8, label: 'פרוץ את הכלוב', use: () => {
            if (L.enemies.aliveCount(e => e.opts.cage === i) > 0) { L.toast('השומרים עוד בחיים'); return false; }
            c.open = true; L.sfx('fairy'); c.bars.visible = false; L.fx.emit(c.fairy.getWorldPosition(new THREE.Vector3()), { count: 70, color: '#aaffee', speed: 6, life: 1.3, size: 0.6, up: 2 });
            const f = c.fairy, l = c.light; let t = 0; L.anim(dt => { t += dt; f.position.y += dt * 6; l.position.y = f.position.y; return t < 3; });
            L.hero.maxHp += 10; L.hero.hp = L.hero.maxHp; L.popText(L.hero.pos, '+10 ❤', '#aaffee', true); return true; } });
        });
      },
      update(L) { L.cages.forEach((c, i) => { if (!c.guard && L.near(c.pos, 24)) { c.guard = true; const types = ['thief', 'thief', i > 1 ? 'mage' : 'minion']; types.forEach((ty, k) => { const a = k * 2.1 + i; L.spawn(ty, c.pos.x + Math.cos(a) * 5.5, c.pos.z + Math.sin(a) * 5.5, { rise: ty !== 'thief', alert: true, cage: i }); }); } }); return L.cages.every(c => c.open); } },
    { text: 'הבס את מורגנה, המכשפה האפלה', marker: L => v3(0, L.h(0, 82) + 2, 82),
      async enter(L) { await L.say([[LIORA, 'כולן חופשיות! אבל... האוויר נעשה קר. היא יודעת שאנחנו כאן. בוא אל הקרחת שבצפון.']]); },
      update(L) {
        if (!L.flags.witch && L.near(v3(0, 0, 82), 20)) { L.flags.witch = 1; (async () => { const w = await L.spawn('witch', 0, 90, { arena: { x: 0, z: 82, r: 21 }, facing: Math.PI }); await L.say([['מורגנה', 'עוד אביר קטן שבא להציל פיות? בסיפורים שלי, הגיבורים תמיד נגמרים רע.', 'dark']]); L.bossStart(w); })(); }
        return L.flags.witch && L.bossDead(); } },
    { text: 'עבור דרך שער הפיות', marker: L => L.portal.pos,
      async enter(L) { L.openPortal(); await L.say([[LIORA, 'הכישוף נשבר! הפיות פתחו לנו את השער אל ארץ הטיטאנים הקדומים.']]); },
      update: L => L.near(L.portal.pos, 3.2) },
  ],
},
// ---------------------------------------------------------------- III. MYTHIC
{
  id: 'mythic', num: 'III', name: 'מקדש הטיטאנים', genre: 'פנטזיה מיתית', mood: 2,
  lore: 'על הגבעות הזהובות עומד מקדש שנבנה בידי ענקים. האבן שלו עדיין זוכרת מלחמות של אלים.',
  exposure: 1.0, hdr: 'env/venice_sunset_1k.hdr', envInt: 0.6,
  sun: { dir: [-0.6, 0.28, 0.5], color: '#ffc88a', intensity: 3.6 }, hemi: { sky: '#ffd8a8', ground: '#7a6040', intensity: 0.7 },
  sky: { top: '#3a64b8', horizon: '#ffb070', ground: '#c09070', clouds: 0.4, cloudCol: '#ffe0c0', cloudShade: '#b07a70', sunDisc: '#ffe0b0', sunSize: 1.5 },
  fog: { color: '#f0c898', density: 0.006, base: 0, falloff: 0.04, scatter: 0.9, rays: 0.7 },
  grade: { tint: '#fff0d8', shadow: '#d8e0ff', sat: 1.12, contrast: 1.1, vignette: 0.4 },
  particles: { color: '#fff0c0', rise: 0.05 },
  grassColors: { base: '#4a4020', tip: '#c8b060', tip2: '#e8d898', height: 0.9 },
  liquid: null,
  start: { x: 0, z: -96, facing: 0 },
  terrain: (() => {
    const path = [[0, -96], [0, -60], [-10, -30], [0, 0], [0, 30]];
    const spots = [{ x: 0, z: 18, r: 30, h: 6, k: 0.7 }, { x: 0, z: 56, r: 22, h: 6, k: 0.75 }, { x: 0, z: -96, r: 8, h: 2 }];
    const H = (x, z) => {
      const b = 2 + (fbm(x * 0.01, z * 0.01) * 0.5 + 0.5) * 12 + n2(x * 0.04, z * 0.04) * 0.8;
      const k = b / 2.6, f = k - Math.floor(k); let h = (Math.floor(k) + smooth(0.3, 0.7, f)) * 2.6 - 4;
      h = lerp(h, 2 + (z + 96) / 120 * 4, smooth(14, 6, pathDist(x, z, path)) * 0.8);
      h += border(x, z, 120, 0.9);
      return flatten(h, x, z, spots);
    };
    return { size: 240, height: H, path, spots,
      splat: (x, z, h, sl) => { const p = smooth(3.4, 2.0, pathDist(x, z, path)); const plaza = smooth(24, 20, Math.hypot(x, z - 18)); const rock = smooth(0.22, 0.42, sl); return [Math.max(0, 1 - p - rock - plaza), p * 0.6 + plaza * 0.3, rock + p * 0.4 + plaza * 0.7, 0]; },
      grass: (x, z, h, sl, w) => w[0] * smooth(0.4, 0.2, sl),
      layers: { grass: '#f0dca0', grass2: '#fff0c0', dirt: '#e0c8a0', rock: '#f0e8d8', snow: '#ffffff' } };
  })(),
  async build(L) {
    const T = L.def.terrain;
    const marble = S.stoneMat('#f2ece0', { marble: 1, moss: 0.25, scale: 0.25 });
    L.temple = S.temple(L.scene, 0, 6, 58, Math.PI, marble);
    for (const [cx, cz] of L.temple.colPos) L.collider(-cx, 58 - cz, 0.8);
    L.boxCollider(0, 58 + 1.2, 6.5, 4, 0);
    L.platformBox(0, 58, 13, 9.5, 8);
    for (let i = 0; i < 4; i++) L.platformBox(0, 58, 13 + 2 - i * 0.6, 9.5 + 2 - i * 0.6, 6 + 0.5 * (i + 1));
    // plaza ring of columns + statue pedestal
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5, 2, 24), marble); ped.position.set(0, 6 + 1, 18); ped.castShadow = ped.receiveShadow = true; L.scene.add(ped);
    L.platform(0, 18, 5, 8);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; if (Math.abs(Math.sin(a)) > 0.95 && Math.cos(a) < 0) continue; const x = Math.cos(a) * 24, z = 18 + Math.sin(a) * 24; const c = new THREE.Mesh(S.columnGeometry(9, 0.6, i % 3 === 1), marble); c.position.set(x, L.h(x, z) - 0.2, z); c.castShadow = c.receiveShadow = true; L.scene.add(c); L.collider(x, z, 0.85); }
    L.statue = await L.stoneStatue('Barbarian', 0, 8, 18, Math.PI * 0, 2.7);
    // road columns
    for (let z = -80; z < -5; z += 12) for (const s of [-1, 1]) { const x = s * 7 + (z > -30 ? -4 : 0); const c = new THREE.Mesh(S.columnGeometry(7.5, 0.55, Math.random() < 0.4), marble); c.position.set(x, L.h(x, z) - 0.3, z); c.castShadow = c.receiveShadow = true; L.scene.add(c); L.collider(x, z, 0.8); }
    const avoid = (x, z, pad = 0) => { if (pathDist(x, z, T.path) < 6 + pad) return true; for (const s of T.spots) if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return true; return false; };
    const ok = (x, z, h, sl) => sl < 0.3 && !avoid(x, z);
    await L.trees('Pine Medium', { height: 13, seed: 8, leafTint: 0x5a7a4a, barkTint: 0xa89070 }, L.scatter(L.n(40), ok, 7, 0.8, 1.2), { narrow: 0.42 });
    await L.trees('Ash Small', { height: 7, seed: 21, leafTint: 0xb8c890 }, L.scatter(L.n(30), ok, 7, 0.9, 1.3));
    await L.trees('Bush 2', { height: 2, seed: 3, radius: 0, leafTint: 0xc8c890 }, L.scatter(L.n(40), ok, 4, 0.8, 1.2));
    for (let i = 0; i < L.n(26); i++) { const p = L.scatter(1, (x, z, h, sl) => sl < 0.25 && !avoid(x, z, 1), 0)[0]; if (!p) continue; const c = new THREE.Mesh(S.columnGeometry(6, 0.55, true), marble); c.position.set(p.x, p.y - 0.4, p.z); c.rotation.set(Math.random() < 0.4 ? Math.PI / 2 - 0.05 : 0, Math.random() * 6, 0); if (c.rotation.x) c.position.y += 0.6; c.castShadow = c.receiveShadow = true; L.scene.add(c); L.collider(p.x, p.z, 0.9); }
    for (const r of ['rock1', 'rock2', 'rock3']) await L.props(`nature/${r}.glb`, L.scatter(L.n(14), (x, z, h, sl) => !avoid(x, z, 2), 6, 1.5, 4, true), { collide: 1.2, tint: '#e8d8c0' });
    L.braziers = [[-6, 32], [6, 32], [-6, 4], [6, 4]].map(([x, z]) => { const b = S.beacon(L.scene, x, L.h(x, z), z, marble, '#ff9a3a'); L.collider(x, z, 0.9); return b; });
    L.portal = S.portal(L.scene, 0, 8, 66, '#ffd27a', '#ffffff', Math.PI);
    L.motes(L.scatter(14, (x, z, h, sl) => sl < 0.3 && !avoid(x, z, -4) && Math.abs(x) < 95 && Math.abs(z) < 95, 25).map(p => v3(p.x, p.y + 1.2, p.z)));
    for (const [x, z] of [[-40, -60], [45, -50], [-55, 10], [50, 15]]) L.spawn('warrior', x, z, {});
  },
  steps: [
    { text: 'עלה אל רחבת הטיטאנים', marker: L => v3(0, 8, 18),
      async enter(L) { await L.say([[LIORA, 'מקדש הטיטאנים... אומרים שהפסל ברחבה הוא אקמון, הטיטאן ששמר על הלב לפני אלף שנים.'], [LIORA, 'בוא נעלה. משהו כאן מרגיש... ער.']]); },
      update: L => L.near(v3(0, 0, 18), 16) },
    { text: 'שרוד את מבחן הטיטאנים', progress: L => `גל ${Math.min(3, (L.flags.wave || 0))}/3`,
      async enter(L) {
        L.flags.wave = 0; L.flags.lock = true;
        L.braziers.forEach(b => { b.fire.visible = true; b.light.intensity = 40; });
        await L.say([['קול מן האבן', 'רק מי שעומד במבחן רשאי לגעת בלב. הוכח את עצמך, בן תמותה.', 'gold']]);
      },
      update(L) {
        if (L.flags.waveBusy) return false;
        if (L.enemies.aliveCount(e => e.opts.wave) === 0) {
          if (L.flags.wave >= 3) return true;
          L.flags.wave++; L.flags.waveBusy = true; L.toast(`גל ${L.flags.wave}`);
          const comp = [['minion', 'minion', 'minion', 'warrior'], ['warrior', 'rogue', 'rogue', 'minion', 'minion'], ['warrior', 'warrior', 'mage', 'rogue', 'minion', 'minion']][L.flags.wave - 1];
          Promise.all(comp.map((ty, k) => { const a = k / comp.length * Math.PI * 2 + L.flags.wave; return L.spawn(ty, Math.cos(a) * 14, 18 + Math.sin(a) * 14, { rise: true, alert: true, wave: true, arena: { x: 0, z: 18, r: 22 } }); })).then(() => L.flags.waveBusy = false);
        }
        return false;
      } },
    { text: 'הבס את אקמון, טיטאן השיש', marker: L => v3(0, 8, 18),
      async enter(L) {
        L.shake(0.8); L.sfx('roar');
        await L.say([['אקמון', 'אלף שנים עמדתי דומם. אלף שנים חיכיתי ללוחם ראוי. הראה לי את כוחך!', 'gold']]);
        L.statue.visible = false;
        const t = await L.spawn('titan', 0, 18, { arena: { x: 0, z: 18, r: 23 }, facing: Math.PI });
        L.fx.emit(v3(0, 10, 18), { count: 120, color: '#ffe8b0', speed: 10, life: 1.2, size: 0.9, up: 2 }); L.bossStart(t);
      },
      update: L => L.bossDead() },
    { text: 'היכנס אל שער המקדש', marker: L => L.portal.pos,
      async enter(L) { L.openPortal(); await L.say([['אקמון', 'נלחמת היטב. לך אל הפסגות, ובמקום שבו השמיים נשברים – תמצא את הדרך.', 'gold'], [LIORA, 'השער במקדש נפתח! קדימה!']]); },
      update: L => L.near(L.portal.pos, 3.2) },
  ],
},
// ---------------------------------------------------------------- IV. ADVENTURE
{
  id: 'adventure', num: 'IV', name: 'פסגות הבדולח', genre: 'פנטזיית הרפתקאות', mood: 3,
  lore: 'מעל העננים, בין הרים קפואים, איים מרחפים שומרים על בדולחי השמיים.',
  exposure: 1.0, hdr: 'env/spruit_sunrise_1k.hdr', envInt: 0.7,
  sun: { dir: [0.4, 0.6, -0.5], color: '#fff4e8', intensity: 3.8 }, hemi: { sky: '#cfe6ff', ground: '#5a6a7a', intensity: 0.85 },
  sky: { top: '#1f63c8', horizon: '#d8ecff', ground: '#9ab0c8', clouds: 0.5, cloudCol: '#ffffff', cloudShade: '#8aa0c0', sunDisc: '#ffffff' },
  fog: { color: '#c8dcf0', density: 0.0055, base: -10, falloff: 0.035, scatter: 0.6, rays: 0.5 },
  grade: { tint: '#f4f8ff', shadow: '#d8e8ff', sat: 1.08, contrast: 1.08, vignette: 0.35 },
  particles: { color: '#ffffff', rise: -0.4 },
  grassColors: { base: '#1e3a22', tip: '#6a9a4a', tip2: '#a8c070', height: 0.75 },
  liquid: null, killY: -14,
  start: { x: 0, z: -112, facing: 0 },
  terrain: (() => {
    const path = [[0, -112], [-6, -80], [-38, -62], [-10, -40], [40, -22], [10, 0], [0, 14]];
    const spots = [{ x: -40, z: -62, r: 12, h: 4 }, { x: 44, z: -20, r: 10, h: 9 }, { x: 0, z: 90, r: 30, h: 22, k: 0.7 }, { x: 0, z: -112, r: 8, h: 2 }];
    const H = (x, z) => {
      let h = 2 + fbm(x * 0.012, z * 0.012) * 5 + Math.abs(x) * 0.06;
      h += Math.pow(ridged(x * 0.011, z * 0.011), 2.2) * 40 * smooth(14, 55, Math.abs(x) + n1(x * 0.02, z * 0.02) * 10);
      // chasm across the map
      const cz = z - 42 + Math.sin(x * 0.05) * 4; h = lerp(h, -40, smooth(22, 14, Math.abs(cz)) * smooth(70, 50, Math.abs(x)));
      // summit plateau
      if (z > 60) h = Math.max(h, lerp(h, 22, smooth(60, 70, z)));
      h += border(x, z, 130, 1.3);
      return flatten(h, x, z, spots);
    };
    return { size: 260, height: H, path, spots,
      splat: (x, z, h, sl) => { const p = smooth(3, 1.6, pathDist(x, z, path)); const rock = smooth(0.25, 0.45, sl) + smooth(-2, -10, h); const snow = smooth(12, 18, h + n2(x * 0.08, z * 0.08) * 4) * smooth(0.55, 0.3, sl); return [Math.max(0, 1 - p - rock - snow), p, rock, snow]; },
      grass: (x, z, h, sl, w) => w[0] * smooth(0.4, 0.22, sl),
      layers: { grass: '#c8dca8', grass2: '#e0e8b8', dirt: '#b8a890', rock: '#a8b0bc', snow: '#f4f8ff' } };
  })(),
  async build(L) {
    const T = L.def.terrain;
    const rockMat = S.stoneMat('#a8b0bc', { scale: 0.2 });
    // floating islands across the chasm and up to the summit
    const isl = [[0, 25, 9, 4], [-6, 32, 3.5, 3], [1, 37.5, 3, 4.2], [8, 42, 3, 5.4], [3, 48, 3.2, 6.6], [-4, 53, 3, 7.8], [0, 59, 4, 9]];
    L.islands = isl.map(([x, z, r, top], i) => { const g = S.floatingIsland(L.scene, x, top - 0.25, z, r, '#7aa058', rockMat); L.platform(x, z, r * 0.98, top); return { g, x, z, r, top }; });
    // stair-stones from island to summit cliff
    const steps = [[4, 64, 9.8], [8, 68, 11], [5, 72.5, 12.4], [0, 76.5, 13.8], [-5, 80, 15.2], [-2, 84.5, 16.6], [3, 88, 18], [0, 92, 19.6]];
    steps.forEach(([x, z, top]) => { S.floatingIsland(L.scene, x, top - 0.25, z, 2.4, '#9ab07a', rockMat); L.platform(x, z, 2.35, top); });
    for (const [x, z] of [[-40, -62], [44, -20]]) {}
    L.crystalsPos = [v3(-40, L.h(-40, -62), -62), v3(44, L.h(44, -20), -20), v3(8, 5.4, 42), v3(-4, 7.8, 53), v3(0, 22, 98)];
    L.crystals = L.crystalsPos.map((p, i) => { const c = S.crystalCluster(L.scene, p.x, p.y, p.z, '#7fe8ff', 0.5); const glow = L.light('#7fe8ff', 10, 10, v3(p.x, p.y + 2, p.z)); return { c, p, glow, got: false }; });
    L.portal = S.portal(L.scene, 0, 22, 104, '#7fe8ff', '#ffffff', Math.PI);
    const avoid = (x, z, pad = 0) => { if (pathDist(x, z, T.path) < 4 + pad) return true; for (const s of T.spots) if (Math.hypot(x - s.x, z - s.z) < s.r * 0.8 + pad) return true; return false; };
    await L.trees('Pine Large', { height: 16, seed: 17 }, L.scatter(L.n(50), (x, z, h, sl) => h > 1 && h < 26 && sl < 0.38 && !avoid(x, z), 6, 0.8, 1.3));
    await L.trees('Pine Medium', { height: 10, seed: 27, leafTint: 0xc8e0c8 }, L.scatter(L.n(50), (x, z, h, sl) => h > 1 && h < 34 && sl < 0.42 && !avoid(x, z), 5, 0.8, 1.3));
    for (const r of ['rock1', 'rock2', 'rock3']) await L.props(`nature/${r}.glb`, L.scatter(L.n(18), (x, z, h, sl) => h > 0 && !avoid(x, z, 2), 6, 1.5, 5, true), { collide: 1.3, tint: '#c0c8d4' });
    for (let i = 0; i < L.n(14); i++) { const p = L.scatter(1, (x, z, h, sl) => h > 2 && sl < 0.4 && !avoid(x, z, 1), 0)[0]; if (p) S.crystalCluster(L.scene, p.x, p.y - 0.2, p.z, Math.random() < 0.5 ? '#7fe8ff' : '#b8a0ff', 0.5 + Math.random() * 0.6); }
    L.motes([...L.scatter(9, (x, z, h, sl) => h > 1 && sl < 0.3 && !avoid(x, z, -3) && Math.abs(x) < 100 && z < 20, 22).map(p => v3(p.x, p.y + 1.2, p.z)), ...steps.slice(1, 6).map(([x, z, t]) => v3(x, t + 1.4, z))]);
    // guards
    for (const [x, z] of [[-44, -58], [-36, -66], [-42, -68]]) L.spawn('rogue', x, z, {});
    for (const [x, z] of [[40, -16], [48, -24]]) L.spawn('mage', x, z, {});
    for (const [x, z] of [[-8, 92], [8, 94], [0, 86]]) L.spawn(Math.random() < 0.5 ? 'warrior' : 'rogue', x, z, {});
    L.spawn('mage', 0, 24, {});
  },
  steps: [
    { text: 'אסוף את חמשת בדולחי השמיים', progress: L => `${L.crystals.filter(c => c.got).length}/5`, marker: L => { const c = L.crystals.filter(c => !c.got).sort((a, b) => a.p.distanceTo(L.hero.pos) - b.p.distanceTo(L.hero.pos))[0]; return c ? c.p.clone().setY(c.p.y + 1.5) : null; },
      async enter(L) { await L.say([[LIORA, 'תראה את הנוף הזה! בדולחי השמיים מפוזרים על ההרים ועל האיים המרחפים.'], [LIORA, 'לחלק מהם תצטרך לקפוץ מאי לאי. אם תיפול, אני אחזיר אותך – אבל זה יכאב.']]); },
      update(L) {
        for (const c of L.crystals) if (!c.got && L.hero.pos.distanceTo(c.p) < 2.6) { c.got = true; c.c.visible = false; c.glow.intensity = 0; L.sfx('shard'); L.fx.emit(c.p.clone().setY(c.p.y + 1), { count: 70, color: '#9ff0ff', speed: 7, life: 1, size: 0.6, up: 2 }); L.hero.dmgMul += 0.06; L.popText(L.hero.pos, 'בדולח שמיים', '#9ff0ff', true); }
        return L.crystals.every(c => c.got);
      } },
    { text: 'הגע אל שער הפסגה', marker: L => L.portal.pos,
      async enter(L) { L.openPortal(); await L.say([[LIORA, 'כל חמשת הבדולחים! השער בפסגה התעורר. מעבר לו... ממלכת הצללים. אני מרגישה את הקור שלה מכאן.']]); },
      update: L => L.near(L.portal.pos, 3.2) },
  ],
},
// ---------------------------------------------------------------- V. DARK
{
  id: 'dark', num: 'V', name: 'ממלכת הצללים', genre: 'פנטזיה אפלה', mood: 4,
  lore: 'תחת ירח הדם, בין נהרות של אש וקברים עתיקים, יושב המלך החלול על כס של עצמות.',
  exposure: 1.35, hdr: 'env/moonless_golf_1k.hdr', envInt: 0.9,
  sun: { dir: [-0.4, 0.45, -0.8], color: '#ff8a7a', intensity: 1.6 }, hemi: { sky: '#8a5aaa', ground: '#4a2024', intensity: 1.2 },
  sky: { top: '#07030c', horizon: '#6a1a28', ground: '#1a0a10', clouds: 0.55, cloudCol: '#5a2030', cloudShade: '#14080e', sunDisc: '#ff5a4a', sunSize: 0, stars: 1, moon: true, moonDir: [-0.4, 0.45, -0.8], moonCol: '#ff6a5a' },
  fog: { color: '#3a1424', density: 0.011, base: 0, falloff: 0.06, scatter: 0.6, rays: 0.6 },
  grade: { tint: '#ffe8e8', shadow: '#c8b8ff', sat: 1.1, contrast: 1.14, vignette: 0.55 },
  particles: { color: '#ff7a3a', rise: 0.8 },
  grassColors: { base: '#141014', tip: '#4a3a40', tip2: '#5a2a2a', height: 0.7 },
  liquid: { level: 0.2, lava: true },
  start: { x: 0, z: -102, facing: 0 },
  terrain: (() => {
    const path = [[0, -102], [-10, -70], [-50, -22], [-10, -10], [52, -32], [30, 10], [0, 30], [0, 60], [0, 82]];
    const spots = [{ x: -52, z: -20, r: 12, h: 3 }, { x: 54, z: -32, r: 12, h: 3 }, { x: 0, z: 32, r: 12, h: 3.5 }, { x: 0, z: 84, r: 30, h: 4, k: 0.75 }, { x: 0, z: -102, r: 8, h: 2.5 }];
    const H = (x, z) => {
      let h = 2.5 + fbm(x * 0.013, z * 0.013) * 4 + Math.pow(ridged(x * 0.03, z * 0.03, 3), 3) * 5;
      const river = Math.abs(fbm(x * 0.008 + 4, z * 0.008, 2) * 60 + x * 0.1 - z * 0.05) ; h = lerp(h, -2, smooth(7, 2.5, river) * smooth(30, 45, Math.hypot(x, z - 84)));
      h += border(x, z, 120, 1.1);
      return flatten(h, x, z, spots);
    };
    return { size: 240, height: H, path, spots,
      splat: (x, z, h, sl) => { const p = smooth(3, 1.5, pathDist(x, z, path)); const rock = smooth(0.25, 0.45, sl) + smooth(1.2, 0.3, h); const ash = smooth(0.0, 0.4, n1(x * 0.04, z * 0.04)); return [Math.max(0, 1 - p - rock) * (1 - ash), p, rock, ash * (1 - p)]; },
      grass: (x, z, h, sl, w) => w[0] * smooth(1.2, 2, h) * 0.6,
      layers: { grass: '#6a5a58', grass2: '#7a4a48', dirt: '#5a4a4a', rock: '#4a4248', snow: '#2a2226', snowRough: 0.95, glow: '#ff3a0a' } };
  })(),
  async build(L) {
    const T = L.def.terrain;
    const dark = S.stoneMat('#5a5060', { scale: 0.3 });
    L.obelisks = [[-52, -20], [54, -32], [0, 32]].map(([x, z]) => { const o = S.obelisk(L.scene, x, L.h(x, z), z, dark, '#c05cff'); L.collider(x, z, 1.4); return o; });
    // castle ruins around arena
    const walls = [];
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; if (Math.sin(a) < -0.6) continue; const x = Math.cos(a) * 31, z = 84 + Math.sin(a) * 31; const hgt = 5 + Math.random() * 9; const w = new THREE.Mesh(new THREE.BoxGeometry(10, hgt, 2.4), dark); w.position.set(x, L.h(x, z) + hgt / 2 - 0.5, z); w.rotation.y = -a + Math.PI / 2; w.castShadow = w.receiveShadow = true; L.scene.add(w); L.collider(x, z, 4.6); if (i % 3 === 0) { const t = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, hgt + 8, 10), dark); t.position.set(x * 1.06, L.h(x, z) + (hgt + 8) / 2 - 0.5, 84 + (z - 84) * 1.06); t.castShadow = true; L.scene.add(t); } }
    const throne = new THREE.Mesh(new THREE.BoxGeometry(5, 9, 3), dark); throne.position.set(0, 4 + 4.5, 106); throne.castShadow = true; L.scene.add(throne);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const x = Math.cos(a) * 18, z = 84 + Math.sin(a) * 18; L.props('props/post_skull.glb', [{ x, y: L.h(x, z), z, s: 2.2, r: -a }], { collide: 0.4 }); L.light('#ff5a2a', 14, 10, v3(x, L.h(x, z) + 3, z)); }
    const avoid = (x, z, pad = 0) => { if (pathDist(x, z, T.path) < 4 + pad) return true; for (const s of T.spots) if (Math.hypot(x - s.x, z - s.z) < s.r * 0.85 + pad) return true; return false; };
    const ok = (x, z, h, sl) => h > 1.2 && sl < 0.35 && !avoid(x, z);
    await L.trees('Oak Large', { height: 14, seed: 66, leafCount: 0, barkTint: 0x5a4a50 }, L.scatter(L.n(26), ok, 8, 0.8, 1.3));
    await L.trees('Ash Medium', { height: 10, seed: 51, leafCount: 0, barkTint: 0x4a3a40 }, L.scatter(L.n(24), ok, 7, 0.8, 1.3));
    await L.props('props/tree_dead_large.glb', L.scatter(L.n(24), ok, 6, 2.2, 3.4), { collide: 0.6 });
    const gy = L.scatter(L.n(60), (x, z, h, sl) => ok(x, z, h, sl) && n1(x * 0.03, z * 0.03) > 0, 3, 1.6, 2.2);
    await L.props('props/gravestone.glb', gy.filter((_, i) => i % 3 === 0), { collide: 0.5 });
    await L.props('props/grave_A.glb', gy.filter((_, i) => i % 3 === 1), { collide: 0.6 });
    await L.props('props/gravemarker_A.glb', gy.filter((_, i) => i % 3 === 2), { collide: 0.3 });
    await L.props('props/ribcage.glb', L.scatter(L.n(14), ok, 4, 1.6, 2.4));
    await L.props('props/skull.glb', L.scatter(L.n(24), ok, 2, 1.4, 2));
    await L.props('props/lantern_standing.glb', L.scatter(L.n(14), (x, z, h) => h > 1 && pathDist(x, z, T.path) > 3.5 && pathDist(x, z, T.path) < 5, 12, 2, 2.2).map(p => (L.light('#ff8a3a', 8, 9, v3(p.x, p.y + 2.4, p.z)), p)), { collide: 0.3 });
    await L.props('props/crypt.glb', L.scatter(4, (x, z, h, sl) => ok(x, z, h, sl) && !avoid(x, z, 6), 30, 2.2, 2.6), { collide: 3 });
    for (const r of ['rock1', 'rock2', 'rock3']) await L.props(`nature/${r}.glb`, L.scatter(L.n(14), (x, z, h) => h > 0.6 && !avoid(x, z, 2), 6, 1.5, 4, true), { collide: 1.2, tint: '#5a5058' });
    L.motes(L.scatter(14, (x, z, h, sl) => h > 1.2 && sl < 0.3 && !avoid(x, z, -3) && Math.abs(x) < 95 && Math.abs(z) < 95, 25).map(p => v3(p.x, p.y + 1.2, p.z)));
    L.emitArea({ color: '#ff6a2a', count: 5, rise: true });
    for (const [x, z] of [[-30, -70], [30, -75], [-70, 30], [65, 20], [-30, 50], [30, 55]]) L.spawn(['minion', 'rogue', 'warrior'][Math.floor(Math.random() * 3)], x, z, {});
  },
  steps: [
    { text: 'נפץ את שלושת אובליסקי הצל', progress: L => `${L.obelisks.filter(o => !o.alive).length}/3`, marker: L => { const o = L.obelisks.filter(o => o.alive).sort((a, b) => a.pos.distanceTo(L.hero.pos) - b.pos.distanceTo(L.hero.pos))[0]; return o ? o.pos.clone().setY(o.pos.y + 6) : null; },
      async enter(L) {
        await L.say([[LIORA, 'ממלכת הצללים... האובליסקים האלה מזינים את המלך החלול בכוח. נפץ אותם – תכה בהם בחרב!'], [LIORA, 'כל עוד הם עומדים, הם יקימו עוד ועוד מתים. תהיה מהיר.']]);
        L.obelisks.forEach((o, i) => { o.spawnT = 4; L.destructible({ ...o, target: o, onHit: () => { o.light.intensity = 60; L.fx.emit(o.pos.clone().setY(o.pos.y + 5), { count: 12, color: '#c05cff', speed: 5, life: 0.5, size: 0.5 }); }, onDestroy: () => { o.alive = false; o.group.visible = false; L.fx.emit(o.pos.clone().setY(o.pos.y + 5), { count: 160, color: '#c05cff', speed: 12, life: 1.4, size: 0.9, up: 2 }); L.fx.ring(o.pos, { color: '#c05cff', r0: 1, r1: 18, dur: 1 }); L.shake(0.7); L.sfx('boom'); L.flash('#c05cff', 0.6); } }); });
      },
      update(L, dt) {
        for (const o of L.obelisks) if (o.alive && L.near(o.pos, 30)) { o.spawnT -= dt; if (o.spawnT <= 0 && L.enemies.aliveCount(e => e.opts.ob === o) < 3) { o.spawnT = 7; const a = Math.random() * 6.28; L.spawn(['minion', 'rogue', 'warrior', 'mage'][Math.floor(Math.random() * 4)], o.pos.x + Math.cos(a) * 6, o.pos.z + Math.sin(a) * 6, { rise: true, alert: true, ob: o }); } }
        for (const o of L.obelisks) if (o.alive) { o.core.rotation.y += dt * 2; o.core.position.y = 12 + Math.sin(L.time * 2) * 0.3; }
        return L.obelisks.every(o => !o.alive);
      } },
    { text: 'עמוד מול המלך החלול', marker: L => v3(0, 6, 84),
      async enter(L) { await L.say([[LIORA, 'האובליסקים נפלו! עכשיו הוא חלש. הכס שלו בלב החורבות שבצפון.'], [LIORA, 'זה הקרב האחרון, אביר. אני איתך.']]); },
      update(L) {
        if (!L.flags.king && L.near(v3(0, 0, 84), 22)) { L.flags.king = 1; (async () => { const k = await L.spawn('king', 0, 96, { arena: { x: 0, z: 84, r: 26 }, facing: Math.PI, rise: true }); await L.say([['המלך החלול', 'הלב נשבר, והאור גווע. אתה רק ניצוץ אחרון בלילה שלא ייגמר.', 'dark'], ['המלך החלול', 'כרע ברך – או הצטרף לצבא שלי.', 'dark']]); L.bossStart(k); })(); }
        return L.flags.king && L.bossDead();
      } },
    { text: 'הלילה נגמר', marker: () => null,
      async enter(L) { L.ending(); },
      update: () => false },
  ],
},
];
