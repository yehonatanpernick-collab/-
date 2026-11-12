// Small CPU mesh builder used for all procedural geometry (level, weapons, vehicles).
import * as pc from 'playcanvas';

export const FACE_PX = 1, FACE_NX = 2, FACE_PY = 4, FACE_NY = 8, FACE_PZ = 16, FACE_NZ = 32, FACE_ALL = 63;

export class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  /** Metres per texture repeat for world-space UVs. */
  uvScale = 1;

  get vertexCount(): number { return this.pos.length / 3; }
  get empty(): boolean { return this.idx.length === 0; }

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, r: number, g: number, b: number): void {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, v); this.col.push(r, g, b, 255);
  }

  /** Quad from four corners in counter-clockwise order (seen from the front). UVs are planar world-space. */
  quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    r = 255, g = 255, b = 255, r2 = r, g2 = g, b2 = b): void {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const s = 1 / this.uvScale;
    const ax2 = Math.abs(nx), ay2 = Math.abs(ny), az2 = Math.abs(nz);
    const uvOf = (x: number, y: number, z: number): [number, number] =>
      ay2 >= ax2 && ay2 >= az2 ? [x * s, z * s] : ax2 >= az2 ? [z * s, y * s] : [x * s, y * s];
    const base = this.vertexCount;
    let t = uvOf(ax, ay, az); this.vert(ax, ay, az, nx, ny, nz, t[0], t[1], r, g, b);
    t = uvOf(bx, by, bz); this.vert(bx, by, bz, nx, ny, nz, t[0], t[1], r, g, b);
    t = uvOf(cx, cy, cz); this.vert(cx, cy, cz, nx, ny, nz, t[0], t[1], r2, g2, b2);
    t = uvOf(dx, dy, dz); this.vert(dx, dy, dz, nx, ny, nz, t[0], t[1], r2, g2, b2);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, r = 255, g = 255, b = 255): void {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const s = 1 / this.uvScale;
    const ax2 = Math.abs(nx), ay2 = Math.abs(ny), az2 = Math.abs(nz);
    const uvOf = (x: number, y: number, z: number): [number, number] =>
      ay2 >= ax2 && ay2 >= az2 ? [x * s, z * s] : ax2 >= az2 ? [z * s, y * s] : [x * s, y * s];
    const base = this.vertexCount;
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) { const t = uvOf(x, y, z); this.vert(x, y, z, nx, ny, nz, t[0], t[1], r, g, b); }
    this.idx.push(base, base + 1, base + 2);
  }

  /** Axis aligned box. `shade(face, cx, cy, cz, nx, ny, nz)` may return a brightness factor per face. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r = 255, g = 255, b = 255, faces = FACE_ALL,
    shade?: (cx: number, cy: number, cz: number, nx: number, ny: number, nz: number) => number): void {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = (z0 + z1) / 2;
    const f = (cx: number, cy: number, cz: number, nx: number, ny: number, nz: number): [number, number, number] => {
      const k = shade ? shade(cx, cy, cz, nx, ny, nz) : 1;
      return [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)];
    };
    let c: [number, number, number];
    if (faces & FACE_PX) { c = f(x1, my, mz, 1, 0, 0); this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, c[0], c[1], c[2]); }
    if (faces & FACE_NX) { c = f(x0, my, mz, -1, 0, 0); this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, c[0], c[1], c[2]); }
    if (faces & FACE_PY) { c = f(mx, y1, mz, 0, 1, 0); this.quad(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, c[0], c[1], c[2]); }
    if (faces & FACE_NY) { c = f(mx, y0, mz, 0, -1, 0); this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, c[0], c[1], c[2]); }
    if (faces & FACE_PZ) { c = f(mx, my, z1, 0, 0, 1); this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, c[0], c[1], c[2]); }
    if (faces & FACE_NZ) { c = f(mx, my, z0, 0, 0, -1); this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, c[0], c[1], c[2]); }
  }

  /** Cylinder along an arbitrary axis between two points. */
  cylinder(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number, segs = 12, caps = true, r = 255, g = 255, b = 255): void {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    // orthonormal basis
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(dy) > 0.9) { ux = 1; uy = 0; }
    let vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    const vl = Math.hypot(vx, vy, vz) || 1;
    vx /= vl; vy /= vl; vz /= vl;
    ux = vy * dz - vz * dy; uy = vz * dx - vx * dz; uz = vx * dy - vy * dx;
    const base = this.vertexCount;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const nx = ux * c + vx * s, ny = uy * c + vy * s, nz = uz * c + vz * s;
      this.vert(ax + nx * ra, ay + ny * ra, az + nz * ra, nx, ny, nz, i / segs, 0, r, g, b);
      this.vert(bx + nx * rb, by + ny * rb, bz + nz * rb, nx, ny, nz, i / segs, len, r, g, b);
    }
    for (let i = 0; i < segs; i++) {
      const p = base + i * 2;
      this.idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
    }
    if (caps) {
      for (const end of [0, 1]) {
        const cx = end ? bx : ax, cy = end ? by : ay, cz = end ? bz : az, rad = end ? rb : ra, sgn = end ? 1 : -1;
        const cb = this.vertexCount;
        this.vert(cx, cy, cz, dx * sgn, dy * sgn, dz * sgn, 0.5, 0.5, r, g, b);
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          this.vert(cx + (ux * c + vx * s) * rad, cy + (uy * c + vy * s) * rad, cz + (uz * c + vz * s) * rad, dx * sgn, dy * sgn, dz * sgn, 0.5 + c * 0.5, 0.5 + s * 0.5, r, g, b);
        }
        for (let i = 0; i < segs; i++) {
          if (end) this.idx.push(cb, cb + 1 + i, cb + 2 + i); else this.idx.push(cb, cb + 2 + i, cb + 1 + i);
        }
      }
    }
  }

  /**
   * Extrude a 2D outline (in the Z-Y plane: [z, y] pairs, counter-clockwise with z right / y up) along X
   * between x0 and x1, with a chamfer on the long edges. Used for weapon / vehicle silhouettes.
   */
  extrude(points: readonly [number, number][], x0: number, x1: number, bevel = 0, r = 255, g = 255, b = 255): void {
    // normalise winding to counter-clockwise
    let area = 0;
    for (let i = 0; i < points.length; i++) { const j = (i + 1) % points.length; area += points[i][0] * points[j][1] - points[j][0] * points[i][1]; }
    const outline = area >= 0 ? points : [...points].reverse();
    const n = outline.length;
    const cz = outline.reduce((s, p) => s + p[0], 0) / n, cy = outline.reduce((s, p) => s + p[1], 0) / n;
    const inset = (p: readonly [number, number]): [number, number] => {
      if (bevel <= 0) return [p[0], p[1]];
      const dz = cz - p[0], dy = cy - p[1], l = Math.hypot(dz, dy) || 1;
      return [p[0] + (dz / l) * bevel, p[1] + (dy / l) * bevel];
    };
    const xa = x0 + bevel, xb = x1 - bevel;
    for (let i = 0; i < n; i++) {
      const p = outline[i], q = outline[(i + 1) % n];
      // side wall (outward normal for a CCW outline seen from +X)
      this.quad(xa, p[1], p[0], xb, p[1], p[0], xb, q[1], q[0], xa, q[1], q[0], r, g, b);
      if (bevel > 0) {
        const pi = inset(p), qi = inset(q);
        this.quad(x0, pi[1], pi[0], xa, p[1], p[0], xa, q[1], q[0], x0, qi[1], qi[0], r, g, b);
        this.quad(xb, p[1], p[0], x1, pi[1], pi[0], x1, qi[1], qi[0], xb, q[1], q[0], r, g, b);
      }
    }
    // caps (ear clipping)
    const cap = outline.map(inset);
    const tris = triangulate(cap);
    for (let i = 0; i < tris.length; i += 3) {
      const a = cap[tris[i]], bb = cap[tris[i + 1]], c = cap[tris[i + 2]];
      this.tri(x1, a[1], a[0], x1, c[1], c[0], x1, bb[1], bb[0], r, g, b);
      this.tri(x0, a[1], a[0], x0, bb[1], bb[0], x0, c[1], c[0], r, g, b);
    }
  }

  /** Append another builder transformed by a matrix. */
  append(o: MeshBuilder, m?: pc.Mat4): void {
    const base = this.vertexCount;
    const p = new pc.Vec3(), nn = new pc.Vec3();
    for (let i = 0; i < o.pos.length; i += 3) {
      p.set(o.pos[i], o.pos[i + 1], o.pos[i + 2]); nn.set(o.nrm[i], o.nrm[i + 1], o.nrm[i + 2]);
      if (m) { m.transformPoint(p, p); m.transformVector(nn, nn).normalize(); }
      this.pos.push(p.x, p.y, p.z); this.nrm.push(nn.x, nn.y, nn.z);
    }
    for (const v of o.uv) this.uv.push(v);
    for (const v of o.col) this.col.push(v);
    for (const v of o.idx) this.idx.push(base + v);
  }

  toMesh(device: pc.GraphicsDevice, tangents = true): pc.Mesh {
    const mesh = new pc.Mesh(device);
    mesh.setPositions(this.pos);
    mesh.setNormals(this.nrm);
    mesh.setUvs(0, this.uv);
    mesh.setColors32(new Uint8Array(this.col));
    if (tangents) mesh.setVertexStream(pc.SEMANTIC_TANGENT, pc.calculateTangents(this.pos, this.nrm, this.uv, this.idx), 4);
    mesh.setIndices(this.vertexCount > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx));
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    return mesh;
  }
}

/** Ear clipping triangulation of a simple polygon given as [a, b] pairs (CCW). Returns vertex indices. */
export function triangulate(poly: readonly [number, number][]): number[] {
  const out: number[] = [];
  const idx = poly.map((_, i) => i);
  const area = (a: number, b: number, c: number): number =>
    (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
  let total = 0;
  for (let i = 0; i < poly.length; i++) { const j = (i + 1) % poly.length; total += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1]; }
  const sign = total >= 0 ? 1 : -1;
  const inside = (a: number, b: number, c: number, p: number): boolean => {
    const d1 = area(a, b, p) * sign, d2 = area(b, c, p) * sign, d3 = area(c, a, p) * sign;
    return d1 > 1e-12 && d2 > 1e-12 && d3 > 1e-12;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 5000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (area(a, b, c) * sign <= 1e-12) continue;
      let ear = true;
      for (const p of idx) { if (p !== a && p !== b && p !== c && inside(a, b, c, p)) { ear = false; break; } }
      if (!ear) continue;
      if (sign > 0) out.push(a, b, c); else out.push(a, c, b);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) { if (sign > 0) out.push(idx[0], idx[1], idx[2]); else out.push(idx[0], idx[2], idx[1]); }
  return out;
}
