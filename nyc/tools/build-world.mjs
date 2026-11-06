// Build streamable 3D tiles of Midtown Manhattan from NYC Open Data (tools/raw/*.geojson).
// Output: public/data/world.json, tiles/*.glb (+ tiles/*.json collision), roads.json, props.json, labels.json
import fs from 'node:fs';
import path from 'node:path';
import * as turf from '@turf/turf';
import { Earcut } from 'three/src/extras/Earcut.js';
import { Document, NodeIO, PropertyType } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = path.join(ROOT, 'tools/raw');
const OUT = path.join(ROOT, 'public/data');
fs.mkdirSync(path.join(OUT, 'tiles'), { recursive: true });

// ---------------------------------------------------------------- projection (local meters, x east, z south)
const LAT0 = 40.765, LON0 = -73.981;
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180), MZ = 111035;
const proj = ([lon, lat]) => [(lon - LON0) * MX, -(lat - LAT0) * MZ];
const BBOX = [-74.008, 40.744, -73.955, 40.786];
const TILE = 500;
const FT = 0.3048;

const load = (n) => JSON.parse(fs.readFileSync(path.join(RAW, n), 'utf8'));
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const tileKey = (x, z) => `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`;

// ---------------------------------------------------------------- facade catalogue (real-world tile size in meters)
const FACADE = {
  F001: [30, 34], F005: [34, 38], F006: [36, 30], F012: [72, 78], F014: [76, 92],
  F018: [22, 22], F019: [22, 23], F020: [22, 23],
};
function pickFacade(h, year, id) {
  const r = hash(id);
  if (h > 55 && year >= 1958) return r < 0.3 ? 'F001' : r < 0.55 ? 'F005' : r < 0.75 ? 'F006' : 'F014';
  if (h > 55) return r < 0.35 ? 'F012' : r < 0.6 ? 'F019' : r < 0.85 ? 'F020' : 'F014';
  if (year >= 1975 && r < 0.5) return r < 0.25 ? 'F006' : 'F001';
  return r < 0.5 ? 'F018' : r < 0.8 ? 'F020' : 'F019';
}

// ---------------------------------------------------------------- geometry accumulator per tile & material
class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  get count() { return this.p.length / 3; }
  vert(x, y, z, nx, ny, nz, u, v, c) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(c[0], c[1], c[2]); return this.count - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
}
const tiles = new Map();
function tileGeo(key, mat) {
  let t = tiles.get(key); if (!t) { t = { geos: {}, cols: [], buildings: 0, maxH: 0 }; tiles.set(key, t); }
  return (t.geos[mat] ||= new Geo());
}
const WHITE = [1, 1, 1];

// quad facing outward normal (nx,nz); a/b are xz points
function wallQuad(g, ax, az, bx, bz, y0, y1, u0, u1, v0, v1, col) {
  let nx = bz - az, nz = -(bx - ax); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
  const i0 = g.vert(ax, y0, az, nx, 0, nz, u0, v0, col), i1 = g.vert(bx, y0, bz, nx, 0, nz, u1, v0, col);
  const i2 = g.vert(bx, y1, bz, nx, 0, nz, u1, v1, col), i3 = g.vert(ax, y1, az, nx, 0, nz, u0, v1, col);
  // winding chosen so the face points along (nx, nz) for rings in A>0 orientation (see ringCCW)
  g.tri(i0, i2, i1); g.tri(i0, i3, i2);
}
const area = (r) => { let a = 0; for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const orient = (r, positive) => ((area(r) > 0) === positive ? r : r.slice().reverse());
function rdp(pts, eps) { // Douglas-Peucker on an open polyline
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]]; const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-9;
  let md = -1, mi = 0;
  for (let k = 1; k < pts.length - 1; k++) { const d = Math.abs((pts[k][0] - a[0]) * dz - (pts[k][1] - a[1]) * dx) / L; if (d > md) { md = d; mi = k; } }
  if (md <= eps) return [a, b];
  return [...rdp(pts.slice(0, mi + 1), eps).slice(0, -1), ...rdp(pts.slice(mi), eps)];
}
let EPS = 0.3;
const cleanRing = (ring) => {
  let r = ring.map(proj); if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  r = r.filter((p, k) => k === 0 || Math.hypot(p[0] - r[k - 1][0], p[1] - r[k - 1][1]) > 0.05);
  if (r.length > 4 && EPS > 0) { let far = 0, fd = 0; for (let k = 1; k < r.length; k++) { const d = Math.hypot(r[k][0] - r[0][0], r[k][1] - r[0][1]); if (d > fd) { fd = d; far = k; } }
    const s1 = rdp(r.slice(0, far + 1), EPS), s2 = rdp([...r.slice(far), r[0]], EPS); r = [...s1.slice(0, -1), ...s2.slice(0, -1)]; }
  return r;
};
function flatPoly(g, rings, y, up, col, uvScale = 1, offset = [0, 0]) { // rings[0]=outer, rest holes (projected)
  const flat = [], holes = [];
  rings.forEach((r, k) => { if (k) holes.push(flat.length / 2); for (const p of r) flat.push(p[0], p[1]); });
  const idx = Earcut.triangulate(flat, holes.length ? holes : null, 2);
  const base = g.count;
  for (let k = 0; k < flat.length; k += 2) g.vert(flat[k], y, flat[k + 1], 0, up ? 1 : -1, 0, (flat[k] + offset[0]) * uvScale, (flat[k + 1] + offset[1]) * uvScale, col);
  for (let k = 0; k < idx.length; k += 3) {
    const a = base + idx[k], b = base + idx[k + 1], c = base + idx[k + 2];
    // ensure the face points up (or down)
    const ax = g.p[a * 3], az = g.p[a * 3 + 2], bx = g.p[b * 3], bz = g.p[b * 3 + 2], cx = g.p[c * 3], cz = g.p[c * 3 + 2];
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if ((ny > 0) === up) g.tri(a, b, c); else g.tri(a, c, b);
  }
}
function ringWalls(g, ring, y0, y1, tw, th, uOff, vOff, col) {
  // ring oriented with area>0 => outward normal (dz,-dx)
  let u = uOff;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    wallQuad(g, a[0], a[1], b[0], b[1], y0, y1, u / tw, (u + len) / tw, (y0 + vOff) / th, (y1 + vOff) / th, col);
    u += len;
  }
}
const scaleRing = (ring, cx, cz, s) => ring.map(([x, z]) => [cx + (x - cx) * s, cz + (z - cz) * s]);
const growRing = (ring, d) => { // offset outward by ~d meters (miter, clamped)
  const n = ring.length, out = [];
  for (let k = 0; k < n; k++) {
    const p = ring[(k - 1 + n) % n], c = ring[k], q = ring[(k + 1) % n];
    const e1 = [c[0] - p[0], c[1] - p[1]], e2 = [q[0] - c[0], q[1] - c[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    const n1 = [e1[1] / l1, -e1[0] / l1], n2 = [e2[1] / l2, -e2[0] / l2];
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1]; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const cosH = Math.max(0.35, mx * n1[0] + mz * n1[1]);
    out.push([c[0] + (mx * d) / cosH, c[1] + (mz * d) / cosH]);
  }
  return out;
};

// ---------------------------------------------------------------- buildings
const bfeat = load('buildings.geojson').features;
const labels = [];
const tanks = [], acs = [];
let nb = 0;
const STONE = [[0.82, 0.78, 0.72], [0.72, 0.68, 0.62], [0.88, 0.85, 0.8], [0.62, 0.58, 0.54]];
for (const f of bfeat) {
  const pr = f.properties; const hRaw = parseFloat(pr.height_roof); const h = (hRaw > 0 ? hRaw : 25) * FT;
  const year = parseInt(pr.construction_year) || 1930; const id = pr.bin || pr.doitt_id;
  for (const poly of f.geometry.coordinates) {
    let outer = cleanRing(poly[0]); if (outer.length < 3) continue;
    outer = orient(outer, true);
    const holes = poly.slice(1).map(cleanRing).filter((r) => r.length >= 3).map((r) => orient(r, false));
    const a = Math.abs(area(outer)); if (a < 6) continue;
    let cx = 0, cz = 0; for (const p of outer) { cx += p[0]; cz += p[1]; } cx /= outer.length; cz /= outer.length;
    const key = tileKey(cx, cz); const t = (tileGeo(key, 'ROOF'), tiles.get(key));
    const fac = pickFacade(h, year, id); const [tw, th] = FACADE[fac];
    const r = hash(id + 'c'); const tint = [0.9 + r * 0.2, 0.9 + hash(id + 'g') * 0.16, 0.88 + hash(id + 'b') * 0.18];
    const uOff = Math.floor(hash(id + 'u') * 8) * (tw / 8), vOff = -Math.floor(hash(id + 'v') * 3) * (th / 6);
    const shopH = h > 9 ? (h > 55 && year >= 1958 ? 6.5 : 4.4) : 0;
    const prewar = year < 1945 && h < 110;
    // wedding-cake setbacks for big tall footprints (footprint data has one height per building)
    const tiers = h > 140 && a > 1400 ? [[0, 0.58, 1], [0.58, 0.84, 0.78], [0.84, 1, 0.56]] : h > 90 && a > 2500 ? [[0, 0.7, 1], [0.7, 1, 0.75]] : [[0, 1, 1]];
    const fg = tileGeo(key, fac), sg = tileGeo(key, 'SHOP'), rg = tileGeo(key, 'ROOF'), cg = tileGeo(key, 'CORNICE');
    for (const [f0, f1, s] of tiers) {
      const ring = s === 1 ? outer : scaleRing(outer, cx, cz, s);
      const y0 = f0 === 0 ? 0 : f0 * h, y1 = f1 * h;
      if (f0 === 0 && shopH) { ringWalls(sg, ring, 0, shopH, 6, shopH, uOff, 0, tint); ringWalls(fg, ring, shopH, y1, tw, th, uOff, vOff, tint); }
      else ringWalls(fg, ring, y0, y1, tw, th, uOff, vOff, tint);
      for (const hole of s === 1 ? holes : []) ringWalls(fg, hole, y0, y1, tw, th, uOff, vOff, tint);
      const top = s === 1 ? [ring, ...holes] : [ring];
      if (prewar && s === 1 && outer.length < 40 && h > 12) { // stone cornice ledge
        const sc = STONE[Math.floor(hash(id + 's') * STONE.length)];
        const grown = growRing(ring, 0.45);
        ringWalls(cg, grown, y1 - 0.75, y1 + 0.2, 4, 1, 0, 0, sc);
        flatPoly(cg, [grown, ...[ring].map((x) => x.slice().reverse())], y1 - 0.75, false, sc, 0.25);
        flatPoly(rg, [grown, ...holes], y1 + 0.2, true, [0.55 + r * 0.15, 0.55 + r * 0.14, 0.54 + r * 0.12], 0.1);
      } else {
        flatPoly(rg, top, y1, true, [0.5 + r * 0.2, 0.5 + r * 0.2, 0.5 + r * 0.18], 0.1);
        if (s !== 1 || tiers.length === 1) ringWalls(cg, growRing(ring, 0.06), y1, y1 + 1.0, 4, 1, 0, 0, fac.startsWith('F0') && h > 55 ? [0.25, 0.27, 0.3] : [0.7, 0.68, 0.64]);
      }
      if (f0 > 0) flatPoly(rg, [outer], y0, true, [0.48, 0.48, 0.47], 0.1); // terrace roof under setback
    }
    // rooftop clutter: wooden water towers on prewar mid-rises, AC/cooling units on modern roofs
    { const topH = tiers.length > 1 ? h : prewar ? h + 0.2 : h; const sc = tiers[tiers.length - 1][2]; const rr = hash(id + 't');
      if (prewar && h > 18 && h < 130 && a > 250 && rr < 0.55) tanks.push([+(cx + (hash(id + 'x') - 0.5) * Math.sqrt(a) * 0.3 * sc).toFixed(1), +topH.toFixed(1), +(cz + (hash(id + 'z') - 0.5) * Math.sqrt(a) * 0.3 * sc).toFixed(1), +(1 + rr).toFixed(2)]);
      const nAc = Math.min(5, Math.floor(a * sc * sc / 400)); for (let k = 0; k < nAc; k++) acs.push([+(cx + (hash(id + 'a' + k) - 0.5) * Math.sqrt(a) * 0.5 * sc).toFixed(1), +topH.toFixed(1), +(cz + (hash(id + 'b' + k) - 0.5) * Math.sqrt(a) * 0.5 * sc).toFixed(1), +(hash(id + 'r' + k) * 3.14).toFixed(2)]); }
    t.cols.push({ p: outer.flatMap((q) => [+q[0].toFixed(2), +q[1].toFixed(2)]), h: +h.toFixed(1) });
    t.buildings++; t.maxH = Math.max(t.maxH, h); nb++;
    if (pr.name && pr.name !== 'None' && h > 20) labels.push({ name: pr.name, x: +cx.toFixed(1), z: +cz.toFixed(1), h: +h.toFixed(1), kind: 'building' });
  }
}
console.log('buildings', nb);

// ---------------------------------------------------------------- sidewalks (raised 15 cm, curbs)
EPS = 0.35;
const SW = 0.15;
for (const f of load('sidewalks.geojson').features) {
  for (const poly of f.geometry.coordinates) {
    let outer = cleanRing(poly[0]); if (outer.length < 3) continue; outer = orient(outer, true);
    const holes = poly.slice(1).map(cleanRing).filter((r) => r.length >= 3).map((r) => orient(r, false));
    let cx = 0, cz = 0; for (const p of outer) { cx += p[0]; cz += p[1]; } cx /= outer.length; cz /= outer.length;
    const key = tileKey(cx, cz);
    flatPoly(tileGeo(key, 'SIDEWALK'), [outer, ...holes], SW, true, WHITE, 1 / 3);
    ringWalls(tileGeo(key, 'CURB'), outer, 0, SW, 1, 1, 0, 0, WHITE);
    for (const hole of holes) ringWalls(tileGeo(key, 'CURB'), hole, 0, SW, 1, 1, 0, 0, WHITE);
  }
}

// ---------------------------------------------------------------- parks, water, land (clipped to tiles)
EPS = 0.5;
const bboxPoly = turf.bboxPolygon(BBOX);
function clipToTiles(feature, cb) {
  const bb = turf.bbox(feature);
  const [x0, z1] = proj([bb[0], bb[1]]), [x1, z0] = proj([bb[2], bb[3]]);
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) for (let tz = Math.floor(z0 / TILE); tz <= Math.floor(z1 / TILE); tz++) {
    const lon0 = LON0 + (tx * TILE) / MX, lon1 = LON0 + ((tx + 1) * TILE) / MX, lat1 = LAT0 - (tz * TILE) / MZ, lat0 = LAT0 - ((tz + 1) * TILE) / MZ;
    let c; try { c = turf.bboxClip(feature, [lon0, lat0, lon1, lat1]); } catch (e) { continue; }
    const g = c.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys) { const rings = p.map(cleanRing).filter((r) => r.length >= 3); if (rings.length && Math.abs(area(rings[0])) > 1) cb(`${tx}_${tz}`, [orient(rings[0], true), ...rings.slice(1).map((r) => orient(r, false))]); }
  }
}
const parkLabels = [];
let water = null;
for (const f of load('parks.geojson').features) {
  let g; try { g = turf.intersect(turf.featureCollection([turf.feature(f.geometry), bboxPoly])); } catch (e) { continue; }
  if (!g) continue;
  const elevated = /High Line/i.test(f.properties.signname || '');
  clipToTiles(g, (key, rings) => flatPoly(tileGeo(key, elevated ? 'HIGHLINE' : 'GRASS'), rings, elevated ? 9 : SW + 0.02, true, WHITE, 1 / 6));
  const acres = parseFloat(f.properties.acres) || 0;
  if (acres > 0.4) { const c = turf.centerOfMass(g).geometry.coordinates; const [x, z] = proj(c); parkLabels.push({ name: f.properties.signname, x: +x.toFixed(1), z: +z.toFixed(1), h: 0, kind: 'park', acres }); }
}
for (const f of load('hydro.geojson').features) {
  let g; try { g = turf.intersect(turf.featureCollection([turf.feature(f.geometry), bboxPoly])); } catch (e) { continue; }
  if (!g) continue; water = water ? turf.union(turf.featureCollection([water, g])) : g;
}
let land = water ? turf.difference(turf.featureCollection([bboxPoly, water])) : bboxPoly;
clipToTiles(land, (key, rings) => flatPoly(tileGeo(key, 'ROAD'), rings, 0, true, WHITE, 1 / 8));
// sea walls along the shoreline
if (land) { const g = land.geometry; for (const p of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) { const r = orient(cleanRing(p[0]), true);
  for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; const key = tileKey((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); const onEdge = Math.abs(a[0] - b[0]) < 0.01 && (Math.abs(a[0]) > 2000) || Math.abs(a[1] - b[1]) < 0.01 && Math.abs(a[1]) > 2000; if (!onEdge) { const len = Math.hypot(b[0] - a[0], b[1] - a[1]); wallQuad(tileGeo(key, 'SEAWALL'), a[0], a[1], b[0], b[1], -2.5, 0, 0, len / 3, 0, 0.8, WHITE); } } } }

// ---------------------------------------------------------------- streets: graph, markings, lamps, signals
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const TYPE = { ST: 'St', AV: 'Ave', AVE: 'Ave', DR: 'Dr', PL: 'Pl', BLVD: 'Blvd', HWY: 'Hwy', PLZ: 'Plaza', SQ: 'Sq', RD: 'Rd', WAY: 'Way', LN: 'Ln', CIR: 'Circle', TER: 'Ter', EXPY: 'Expy', PKWY: 'Pkwy', SVC: 'Service Rd', BR: 'Bridge', TUNL: 'Tunnel', XING: 'Crossing', CT: 'Ct', WALK: 'Walk' };
function prettyName(n) {
  if (!n) return '';
  const tok = n.replace(/\s+/g, ' ').trim().split(' ');
  return tok.map((t, k) => (/^\d+$/.test(t) ? ordinal(+t) : TYPE[t] && k === tok.length - 1 ? TYPE[t] : t.length <= 1 ? t : t[0] + t.slice(1).toLowerCase())).join(' ').replace(/\bOf\b/g, 'of').replace(/\bThe\b/g, 'the');
}
const cfeat = load('centerline.geojson').features.filter((f) => {
  const p = f.properties; return ['1', '2', '3', '9', '13'].includes(p.rw_type) && p.from_level_code === '13' && p.to_level_code === '13' && p.trafdir !== 'NV';
});
const nodes = new Map(); const edges = [];
const nodeId = ([x, z]) => { const k = `${Math.round(x * 2)}_${Math.round(z * 2)}`; let n = nodes.get(k); if (!n) { n = { id: nodes.size, x, z, e: [] }; nodes.set(k, n); } return n; };
for (const f of cfeat) {
  const p = f.properties;
  for (const line of f.geometry.coordinates) {
    const pts = line.map(proj); if (pts.length < 2) continue;
    const lanes = Math.max(1, parseInt(p.number_travel_lanes) || 1), park = parseInt(p.number_park_lanes) || 0;
    let w = (parseFloat(p.streetwidth) || 0) * FT; if (w < 6) w = lanes * 3.3 + park * 2.5;
    const a = nodeId(pts[0]), b = nodeId(pts[pts.length - 1]);
    const e = { id: edges.length, a: a.id, b: b.id, pts: pts.map((q) => [+q[0].toFixed(2), +q[1].toFixed(2)]), lanes, park, w: +w.toFixed(1), dir: p.trafdir, name: prettyName(p.full_street_name || p.stname_label), speed: parseInt(p.posted_speed) || 25, kind: +p.rw_type };
    edges.push(e); a.e.push(e.id); b.e.push(e.id);
  }
}
const nodeArr = [...nodes.values()];
const YEL = [0.86, 0.66, 0.12], PNT = [0.9, 0.9, 0.88];
function ribbon(g, pts, off, w, y, s0, s1, col, dash = 0, gap = 0) { // along polyline, lateral offset
  const L = []; let acc = 0; for (let k = 0; k < pts.length; k++) { if (k) acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); L.push(acc); }
  const at = (s) => { let k = 1; while (k < pts.length - 1 && L[k] < s) k++; const t = (s - L[k - 1]) / ((L[k] - L[k - 1]) || 1); const dx = pts[k][0] - pts[k - 1][0], dz = pts[k][1] - pts[k - 1][1], l = Math.hypot(dx, dz) || 1; return [pts[k - 1][0] + dx * t, pts[k - 1][1] + dz * t, dx / l, dz / l]; };
  const seg = (a, b) => {
    const [x0, z0, dx0, dz0] = at(a), [x1, z1, dx1, dz1] = at(b);
    const rx0 = -dz0, rz0 = dx0, rx1 = -dz1, rz1 = dx1, h = w / 2;
    const i0 = g.vert(x0 + rx0 * (off - h), y, z0 + rz0 * (off - h), 0, 1, 0, 0, 0, col), i1 = g.vert(x0 + rx0 * (off + h), y, z0 + rz0 * (off + h), 0, 1, 0, 1, 0, col);
    const i2 = g.vert(x1 + rx1 * (off + h), y, z1 + rz1 * (off + h), 0, 1, 0, 1, 1, col), i3 = g.vert(x1 + rx1 * (off - h), y, z1 + rz1 * (off - h), 0, 1, 0, 0, 1, col);
    const ny = (g.p[i1 * 3 + 2] - g.p[i0 * 3 + 2]) * (g.p[i2 * 3] - g.p[i0 * 3]) - (g.p[i1 * 3] - g.p[i0 * 3]) * (g.p[i2 * 3 + 2] - g.p[i0 * 3 + 2]);
    if (ny > 0) { g.tri(i0, i1, i2); g.tri(i0, i2, i3); } else { g.tri(i0, i2, i1); g.tri(i0, i3, i2); }
  };
  const end = Math.min(s1, acc);
  if (!dash) { for (let s = s0; s < end; s += 15) seg(s, Math.min(end, s + 15)); }
  else for (let s = s0; s < end; s += dash + gap) seg(s, Math.min(end, s + dash));
  return { len: acc, at };
}
const lamps = [], signals = [];
for (const e of edges) {
  const A = nodeArr[e.a], B = nodeArr[e.b];
  const otherW = (n) => Math.max(0, ...n.e.filter((x) => x !== e.id).map((x) => edges[x].w));
  const isX = (n) => n.e.length >= 3;
  const dA = isX(A) ? otherW(A) / 2 + 1.2 : 0, dB = isX(B) ? otherW(B) / 2 + 1.2 : 0;
  let len = 0; for (let k = 1; k < e.pts.length; k++) len += Math.hypot(e.pts[k][0] - e.pts[k - 1][0], e.pts[k][1] - e.pts[k - 1][1]);
  if (len < dA + dB + 2) continue;
  const mid = e.pts[Math.floor(e.pts.length / 2)]; const key = tileKey(mid[0], mid[1]); const g = tileGeo(key, 'PAINT');
  const half = e.w / 2, travel = Math.max(e.lanes * 3.2, e.w - e.park * 2.6) / 2;
  const s0 = dA + (dA ? 4.2 : 0), s1 = len - dB - (dB ? 4.2 : 0);
  if (e.dir === 'TW') { ribbon(g, e.pts, -0.17, 0.12, 0.02, s0, s1, YEL); ribbon(g, e.pts, 0.17, 0.12, 0.02, s0, s1, YEL);
    const per = Math.max(1, Math.floor(e.lanes / 2)); for (let k = 1; k < per; k++) { const o = (k * travel) / per; ribbon(g, e.pts, o, 0.12, 0.02, s0, s1, PNT, 3, 6); ribbon(g, e.pts, -o, 0.12, 0.02, s0, s1, PNT, 3, 6); } }
  else for (let k = 1; k < e.lanes; k++) ribbon(g, e.pts, -travel + (2 * travel * k) / e.lanes, 0.12, 0.02, s0, s1, PNT, 3, 6);
  if (e.park) { ribbon(g, e.pts, travel, 0.1, 0.02, s0, s1, PNT); ribbon(g, e.pts, -travel, 0.1, 0.02, s0, s1, PNT); }
  // crosswalks (continental stripes) + stop bars at real intersections
  for (const [d, atStart] of [[dA, true], [dB, false]]) {
    if (!d) continue;
    const s = atStart ? d - 0.2 : len - d + 0.2 - 3.2;
    for (let o = -half + 0.6; o < half - 0.4; o += 1.25) ribbon(g, e.pts, o + 0.3, 0.6, 0.021, s, s + 3.2, PNT);
    const sb = atStart ? s + 4.0 : s - 0.8;
    if (e.dir === 'TW') ribbon(g, e.pts, atStart ? -travel / 2 : travel / 2, travel - 0.3, 0.021, sb, sb + 0.5, PNT);
  }
  // street lamps along both curbs
  const r = ribbon(new Geo(), e.pts, 0, 0, 0, 0, 0, WHITE);
  for (let s = s0 + 6; s < s1 - 4; s += 34) for (const side of [-1, 1]) {
    const [x, z, dx, dz] = r.at(s + (side > 0 ? 0 : 17)); const o = half + 0.55;
    lamps.push([+(x - dz * o * side).toFixed(2), +(z + dx * o * side).toFixed(2), +Math.atan2(dz * side, -dx * side).toFixed(3)]);
  }
}
for (const n of nodeArr) if (n.e.length >= 3) {
  const ws = n.e.map((x) => edges[x]);
  if (ws.some((e) => e.kind !== 1)) continue;
  const W = Math.max(...ws.map((e) => e.w)) / 2 + 1.0;
  // two poles on opposite corners, aligned to the first street direction
  const e0 = ws[0], p0 = e0.a === n.id ? e0.pts[0] : e0.pts[e0.pts.length - 1], p1 = e0.a === n.id ? e0.pts[1] : e0.pts[e0.pts.length - 2];
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1], l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
  for (const s of [-1, 1]) signals.push([+(n.x + (ux + -uz) * W * s * 0.72).toFixed(2), +(n.z + (uz + ux) * W * s * 0.72).toFixed(2), +Math.atan2(ux * s, uz * s).toFixed(3), n.id]);
}
// street trees (real census positions)
const trees = load('trees.json').map((t) => { const [x, z] = proj([+t.longitude, +t.latitude]); return [+x.toFixed(2), +z.toFixed(2), Math.min(40, +t.tree_dbh || 6)]; });
// park trees: scatter inside large parks (Central Park, Bryant Park, Riverside)
for (const f of load('parks.geojson').features) {
  if ((parseFloat(f.properties.acres) || 0) < 2 || /High Line/i.test(f.properties.signname || '')) continue;
  let g; try { g = turf.intersect(turf.featureCollection([turf.feature(f.geometry), bboxPoly])); } catch (e) { continue; } if (!g) continue;
  const pts = turf.randomPoint(Math.min(4000, Math.round(turf.area(g) / 160)), { bbox: turf.bbox(g) });
  for (const p of pts.features) if (turf.booleanPointInPolygon(p, g)) { const [x, z] = proj(p.geometry.coordinates); trees.push([+x.toFixed(2), +z.toFixed(2), 10 + Math.floor(hash(x) * 22)]); }
}
console.log('edges', edges.length, 'nodes', nodeArr.length, 'lamps', lamps.length, 'signals', signals.length, 'trees', trees.length);

// ---------------------------------------------------------------- write tiles as compressed GLB
await MeshoptEncoder.ready;
console.warn = () => {};
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const index = []; let bytes = 0; const STATS = {};
for (const [key, t] of tiles) {
  const doc = new Document(); const buf = doc.createBuffer(); const scene = doc.createScene(key).setExtras({ b: t.cols }); const mats = {};
  let tris = 0;
  for (const [mat, g] of Object.entries(t.geos)) {
    if (!g.i.length) continue;
    const m = (mats[mat] ||= doc.createMaterial(mat).setExtras({ key: mat }));
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.p)).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.n)).setBuffer(buf))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(g.uv)).setBuffer(buf))
      .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(Uint8Array.from(g.c, (v) => Math.max(0, Math.min(255, Math.round(v * 200))))).setNormalized(true).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(g.count > 65535 ? new Uint32Array(g.i) : new Uint16Array(g.i)).setBuffer(buf))
      .setMaterial(m);
    scene.addChild(doc.createNode(mat).setMesh(doc.createMesh(mat).addPrimitive(prim)));
    tris += g.i.length / 3;
  }
  for (const [mat, g] of Object.entries(t.geos)) { STATS[mat] = (STATS[mat] || 0) + g.i.length / 3; }
  if (!tris) continue;
  await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }), quantize({ quantizeTexcoord: 16, quantizeNormal: 10, quantizePosition: 16 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const glb = await io.writeBinary(doc);
  fs.writeFileSync(path.join(OUT, 'tiles', key + '.glb'), glb);
  const [tx, tz] = key.split('_').map(Number);
  index.push({ k: key, x: tx * TILE, z: tz * TILE, n: t.buildings, h: +t.maxH.toFixed(1), tris }); bytes += glb.byteLength;
}
const [bx0, bz1] = proj([BBOX[0], BBOX[1]]), [bx1, bz0] = proj([BBOX[2], BBOX[3]]);
fs.writeFileSync(path.join(OUT, 'world.json'), JSON.stringify({ origin: [LON0, LAT0], m: [MX, MZ], tile: TILE, bounds: [bx0, bz0, bx1, bz1], facades: FACADE, tiles: index, sidewalkY: SW }));
fs.writeFileSync(path.join(OUT, 'roads.json'), JSON.stringify({ nodes: nodeArr.map((n) => [+n.x.toFixed(2), +n.z.toFixed(2)]), edges: edges.map(({ id, ...e }) => e) }));
fs.writeFileSync(path.join(OUT, 'props.json'), JSON.stringify({ trees, lamps, signals, tanks, acs }));
console.log('water towers', tanks.length, 'roof units', acs.length);
fs.writeFileSync(path.join(OUT, 'labels.json'), JSON.stringify([...labels.sort((a, b) => b.h - a.h).slice(0, 400), ...parkLabels]));
console.log(Object.fromEntries(Object.entries(STATS).map(([k, v]) => [k, Math.round(v / 1000) + "k"])));
console.log("tiles", index.length, 'glb MB', (bytes / 1e6).toFixed(1), 'tris', index.reduce((s, t) => s + t.tris, 0));
