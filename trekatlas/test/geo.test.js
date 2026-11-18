// Run: node --test trekatlas/test
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geo.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('haversine: one degree of latitude ≈ 111.2 km', () => {
  near(G.haversine([35, 31], [35, 32]), 111195, 50, '1° lat');
  assert.equal(G.haversine([10, 10], [10, 10]), 0);
});

test('resample keeps endpoints, spacing and cap', () => {
  const pts = [[35, 31], [35, 31.01], [35.01, 31.01]];
  const s = G.resample(pts, 50, 500);
  assert.deepEqual([s[0].lon, s[0].lat], [35, 31]);
  const last = s[s.length - 1];
  near(last.d, G.pathLength(pts), 0.01, 'total distance');
  near(last.lon, 35.01, 1e-9, 'end lon');
  for (let i = 1; i < s.length; i++) assert.ok(s[i].d > s[i - 1].d, 'monotonic');
  const capped = G.resample([[0, 0], [1, 0]], 10, 100);
  assert.ok(capped.length <= 101, `capped length ${capped.length}`);
});

test('terrarium decode', () => {
  assert.equal(G.terrariumHeight(128, 0, 0), 0);
  assert.equal(G.terrariumHeight(128, 100, 128), 100.5);
  assert.equal(G.terrariumHeight(127, 156, 0), -100);
});

test('tileXY matches known tile', () => {
  // Jerusalem at z=12: x = 215.2137/360*4096 = 2448.6, y = (1-asinh(tan φ)/π)/2*4096 = 1666.5
  const t = G.tileXY(35.2137, 31.7683, 12);
  assert.equal(t.x, 2448);
  assert.equal(t.y, 1666);
  const eq = G.tileXY(0.001, -0.001, 1);
  assert.deepEqual([eq.x, eq.y], [1, 1]);
  assert.ok(t.px >= 0 && t.px < 256 && t.py >= 0 && t.py < 256);
});

test('Tobler: 6 km/h max at -5% slope, ~5 km/h on the flat', () => {
  near(G.toblerKmh(-0.05), 6, 1e-9, 'peak');
  near(G.toblerKmh(0), 5.04, 0.01, 'flat');
  assert.ok(G.toblerKmh(0.3) < 2.5);
});

test('routeStats: flat 10 km ≈ 2h, climbs counted, noise ignored', () => {
  const flat = [];
  for (let i = 0; i <= 100; i++) flat.push({ d: i * 100, ele: 500 + (i % 2) * 2 }); // ±2 m jitter
  const s = G.routeStats(flat);
  near(s.timeH, 10 / 5.04, 0.1, 'time');
  assert.equal(s.ascent, 0, 'jitter below hysteresis ignored');
  const climb = [{ d: 0, ele: 0 }, { d: 1000, ele: 100 }, { d: 2000, ele: 50 }];
  const c = G.routeStats(climb);
  assert.equal(c.ascent, 100);
  assert.equal(c.descent, 50);
  assert.equal(c.maxEle, 100);
  const slow = G.routeStats(flat, { pace: 0.5 });
  near(slow.timeH, s.timeH * 2, 1e-9, 'pace halves speed');
});

test('splitStages covers the whole route within the daily limit', () => {
  const prof = [];
  for (let i = 0; i <= 300; i++) prof.push({ d: i * 100, ele: 0 }); // 30 km flat ≈ 5.95 h
  const st = G.routeStats(prof);
  const stages = G.splitStages(prof, st.cumTime, 2.5);
  assert.equal(stages.length, 3);
  assert.equal(stages[0].startIdx, 0);
  assert.equal(stages[stages.length - 1].endIdx, prof.length - 1);
  for (const s of stages) assert.ok(s.timeH <= 2.5 + 1e-9);
  near(stages.reduce((a, s) => a + s.distance, 0), 30000, 1e-6, 'distance sums');
  // a single segment longer than the limit still makes progress
  const one = [{ d: 0, ele: 0 }, { d: 50000, ele: 0 }];
  assert.equal(G.splitStages(one, G.routeStats(one).cumTime, 1).length, 1);
});

test('GPX round trip and escaping', () => {
  const wps = [[6.8652, 45.8326], [7.6586, 45.9763]];
  const track = [{ lon: 6.8652, lat: 45.8326, ele: 4806 }, { lon: 7.6586, lat: 45.9763, ele: 4478 }];
  const xml = G.buildGPX('Alps <&> "test"', wps, track);
  assert.ok(xml.includes('&lt;&amp;&gt;'));
  const parsed = G.parseGPX(xml);
  assert.equal(parsed.points.length, 2);
  near(parsed.points[1][0], 7.6586, 1e-6, 'lon');
  const rte = G.parseGPX(`<gpx><rte><rtept lon='1.5' lat='2.5'/><rtept lat="3" lon="4"></rtept></rte></gpx>`);
  assert.deepEqual(rte.points, [[1.5, 2.5], [4, 3]]);
});

test('thin keeps ends and caps size', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => [i, 0]);
  const t = G.thin(pts, 60);
  assert.equal(t.length, 60);
  assert.deepEqual(t[0], [0, 0]);
  assert.deepEqual(t[59], [999, 0]);
});

test('formatting and HTML escaping', () => {
  assert.equal(G.formatDuration(1.5), '1:30');
  assert.equal(G.formatDistance(850), '850 מ׳');
  assert.equal(G.formatDistance(12345), '12.3 ק״מ');
  assert.equal(G.escapeHtml('<img onerror=x>'), '&lt;img onerror=x&gt;');
});
