// Geometry helpers for organic / armored shapes
import * as THREE from 'three';
import { mergeGeometries } from '../lib/utils/BufferGeometryUtils.js';

export { mergeGeometries };
export const ni = (g) => (g.index ? g.toNonIndexed() : g);

/** Smooth lathe from [[radius, y], ...] control points (Catmull-Rom). */
export function lathe(pts, seg = 32, phiStart = 0, phiLen = Math.PI * 2, samples = 0) {
  const curve = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y)));
  const n = samples || Math.max(8, pts.length * 6);
  const p = curve.getPoints(n).map((v) => new THREE.Vector2(Math.max(0.0001, v.x), v.y));
  // LatheGeometry expects points ordered bottom→top for outward normals
  if (p[0].y > p[p.length - 1].y) p.reverse();
  return new THREE.LatheGeometry(p, seg, phiStart, phiLen);
}
/** Lathe whose angle 0 faces +z (front). phi centered on front. */
export function frontLathe(pts, seg, arc) {
  // LatheGeometry: x = r*sin(phi), z = r*cos(phi) → phi=0 is +z
  return lathe(pts, seg, -arc / 2, arc);
}
export function scaleXZ(g, sx, sz) { g.scale(sx, 1, sz); return g; }
export function tube(points, radius, tubular = 32, radial = 8, closed = false) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
  return new THREE.TubeGeometry(c, tubular, radius, radial, closed);
}
/** Tube with radius varying along length: radiusFn(t) */
export function taperTube(points, radiusFn, tubular = 32, radial = 8) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
  const g = new THREE.TubeGeometry(c, tubular, 1, radial, false);
  const pos = g.attributes.position;
  const frames = c.computeFrenetFrames(tubular, false);
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const center = c.getPointAt(t);
    const r = radiusFn(t);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(center).multiplyScalar(r).add(center);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}
export function scaleUV(g, sx, sy) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  return g;
}
/** Displace vertices along normals by fn(x,y,z) */
export function displace(g, fn) {
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = fn(x, y, z);
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g;
}
export function mapVerts(g, fn) {
  const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v, i); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  return g;
}
/** Partial sphere shell (for pauldrons, cops) */
export function shell(r, phiStart, phiLen, thetaStart, thetaLen, ws = 24, hs = 12) {
  return new THREE.SphereGeometry(r, ws, hs, phiStart, phiLen, thetaStart, thetaLen);
}
export function rounded(w, h, d, r = 0.01, s = 3) {
  // cheap rounded box via scaled sphere-ish subdivided box with vertex pushing
  const g = new THREE.BoxGeometry(w, h, d, s, s, s);
  const p = g.attributes.position; const v = new THREE.Vector3(); const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const c = new THREE.Vector3(THREE.MathUtils.clamp(v.x, -hw, hw), THREE.MathUtils.clamp(v.y, -hh, hh), THREE.MathUtils.clamp(v.z, -hd, hd));
    const dir = v.clone().sub(c);
    if (dir.lengthSq() > 1e-8) v.copy(c).add(dir.normalize().multiplyScalar(r));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
export function mesh(geo, mat, parent, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  if (opts.s) { if (Array.isArray(opts.s)) m.scale.set(...opts.s); else m.scale.setScalar(opts.s); }
  if (parent) parent.add(m);
  return m;
}
export function joint(parent, x = 0, y = 0, z = 0, order = 'XYZ') {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  j.rotation.order = order;
  parent.add(j);
  return j;
}
