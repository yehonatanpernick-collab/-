// Builds all world visuals from the shared world data: LOD terrain with splat map,
// region-chunked instanced architecture (destructible per panel), procedural props,
// leaf-card trees, grass field around the camera, objective flags.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF, HN, HRES, K, F, BOUNDS, heightAt, TOWN_H } from '../shared/world.js';
import { triplanarMaterial, terrainMaterial, foliageMaterial } from './materials.js';
import { mulberry32 } from '../shared/math.js';

const REG = 96;
const KIND_TEX = {
  [K.PLASTER]: ['plaster', 0.4], [K.BRICK]: ['brick', 0.42], [K.CONCRETE]: ['concrete', 0.3], [K.SLAB]: ['concrete', 0.3],
  [K.TRIM]: ['concrete', 0.5], [K.CONTAINER]: ['metal', 0.33], [K.SANDBAG]: ['sandbag', 1.1], [K.BARRIER]: ['concrete', 0.6],
  [K.WOOD]: ['wood', 0.35], [K.METAL]: ['metal', 0.3], [K.RUBBLE]: ['rubble', 0.3], [K.STAIR]: ['concrete', 0.6],
  [K.SIDEWALK]: ['paving', 0.4], [K.HESCO]: ['hesco', 0.9], [K.ROOF]: ['roof', 0.25],
};

function geo(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}
const B = (w, h, d, x, y, z, ry = 0) => geo(new THREE.BoxGeometry(w, h, d), x, y, z, 0, ry);
const C = (rt, rb, h, s, x, y, z, rx = 0, rz = 0) => geo(new THREE.CylinderGeometry(rt, rb, h, s), x, y, z, rx, 0, rz);
const merge = (arr) => mergeGeometries(arr.map((g) => { if (g.index) g = g.toNonIndexed(); return g; }), false);

export class WorldView {
  constructor(gfx, world, tex, macro, sprites) {
    this.gfx = gfx; this.W = world; this.T = tex; this.macro = macro; this.sprites = sprites;
    this.root = new THREE.Group();
    gfx.scene.add(this.root);
    this.mats = {};
    this.boxRef = new Array(world.boxes.length);
    this.collapsing = [];
    this.propRefs = new Map(); // building -> [{mesh, idx, m}]
    this.tmpM = new THREE.Matrix4();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.buildSplat();
    this.buildTerrain();
    this.buildBoxes();
    this.buildProps();
    this.buildFlags();
    this.buildGrass();
  }

  mat(name, scale, extra = {}) {
    const key = name + scale + (extra.key || '');
    if (!this.mats[key]) this.mats[key] = triplanarMaterial(this.T[name], this.macro, { scale, key, ...extra });
    return this.mats[key];
  }

  // ---------------------------------------------------------------- splat
  buildSplat() {
    const W = this.W, S = 1024, sc = S / (HALF * 2);
    const chans = [0, 1, 2, 3].map(() => { const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, S, S); return g; });
    const P = (x, z) => [(x + HALF) * sc, (z + HALF) * sc];
    const [gR, gG, gB, gA] = chans;
    // town ground: gravel lots
    gB.fillStyle = 'rgba(255,255,255,0.85)';
    { const [a, b] = P(-180, -165); gB.fillRect(a, b, 360 * sc, 330 * sc); }
    gR.fillStyle = 'rgba(255,255,255,0.35)';
    { const [a, b] = P(-184, -169); gR.fillRect(a, b, 368 * sc, 338 * sc); }
    for (const r of W.roads) {
      const g = r.type === 'asphalt' ? gG : gR;
      g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = r.w * sc;
      g.beginPath();
      r.pts.forEach((p, i) => { const [x, y] = P(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
      if (r.type === 'asphalt') { // dirty shoulders
        gR.strokeStyle = 'rgba(255,255,255,0.6)'; gR.lineWidth = (r.w + 5) * sc; gR.lineCap = 'round';
        gR.beginPath(); r.pts.forEach((p, i) => { const [x, y] = P(p[0], p[1]); i ? gR.lineTo(x, y) : gR.moveTo(x, y); }); gR.stroke();
      }
    }
    for (const f of W.flags) {
      const [x, y] = P(f.x, f.z);
      const gr = gR.createRadialGradient(x, y, 0, x, y, 40 * sc);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      gR.fillStyle = gr; gR.fillRect(x - 45 * sc, y - 45 * sc, 90 * sc, 90 * sc);
    }
    for (const t of [1, 2]) { const h = W.hq[t]; const [x, y] = P(h.x, h.z); const gr = gR.createRadialGradient(x, y, 0, x, y, 35 * sc); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); gR.fillStyle = gr; gR.fillRect(x - 40 * sc, y - 40 * sc, 80 * sc, 80 * sc); }
    for (const c of W.craters) {
      const [x, y] = P(c.x, c.z);
      const gr = gA.createRadialGradient(x, y, 0, x, y, c.r * 1.5 * sc);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      gA.fillStyle = gr; gA.fillRect(x - c.r * 2 * sc, y - c.r * 2 * sc, c.r * 4 * sc, c.r * 4 * sc);
      gR.fillStyle = gr; gR.fillRect(x - c.r * 2 * sc, y - c.r * 2 * sc, c.r * 4 * sc, c.r * 4 * sc);
    }
    for (const r of W.rails) { const [a, b] = P(r.x0, r.z - 2.2); gB.fillStyle = '#fff'; gB.fillRect(a, b, (r.x1 - r.x0) * sc, 4.4 * sc); }
    // building footprints: darker dirt
    for (const Bd of W.buildings) { const [a, b] = P(Bd.x0 - 1, Bd.z0 - 1); gR.fillStyle = 'rgba(255,255,255,0.5)'; gR.fillRect(a, b, (Bd.x1 - Bd.x0 + 2) * sc, (Bd.z1 - Bd.z0 + 2) * sc); }
    const ids = chans.map((g) => g.getImageData(0, 0, S, S).data);
    const out = new Uint8Array(S * S * 4);
    for (let i = 0; i < S * S; i++) { out[i * 4] = ids[0][i * 4]; out[i * 4 + 1] = ids[1][i * 4]; out[i * 4 + 2] = ids[2][i * 4]; out[i * 4 + 3] = ids[3][i * 4]; }
    this.splatData = out; this.splatS = S;
    const t = new THREE.DataTexture(out, S, S, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    this.splat = t;
  }
  splatAt(x, z) {
    const S = this.splatS;
    const i = Math.min(S - 1, Math.max(0, ((x + HALF) / (HALF * 2) * S) | 0)), j = Math.min(S - 1, Math.max(0, ((z + HALF) / (HALF * 2) * S) | 0));
    const k = (j * S + i) * 4;
    return [this.splatData[k], this.splatData[k + 1], this.splatData[k + 2], this.splatData[k + 3]];
  }

  // ---------------------------------------------------------------- terrain
  terrainGeo(x0, z0, x1, z1, step, sink) {
    const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step);
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      let h = heightAt(this.W, x, z);
      if (sink && sink(x, z)) h -= 40;
      p.setY(i, h);
    }
    g.computeVertexNormals();
    // fix normals from the heightfield for seamless lighting
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), e = 1.5;
      const hx = heightAt(this.W, x + e, z) - heightAt(this.W, x - e, z), hz = heightAt(this.W, x, z + e) - heightAt(this.W, x, z - e);
      const l = Math.hypot(hx, 2 * e, hz);
      n.setXYZ(i, -hx / l, 2 * e / l, -hz / l);
    }
    return g;
  }
  buildTerrain() {
    const mat = terrainMaterial(this.T, this.splat, this.macro);
    this.terrainMat = mat;
    const q = this.gfx.Q;
    const step = q.name === 'LOW' ? 4 : 2;
    const ix = 296, iz = 400;
    const inner = new THREE.Mesh(this.terrainGeo(-ix, -iz, ix, iz, step), mat);
    inner.receiveShadow = true;
    const outer = new THREE.Mesh(this.terrainGeo(-HALF, -HALF, HALF, HALF, 8, (x, z) => Math.abs(x) < ix - 0.1 && Math.abs(z) < iz - 0.1), mat);
    outer.receiveShadow = true;
    this.root.add(inner, outer);
    // far horizon skirt
    const far = new THREE.Mesh(new THREE.RingGeometry(HALF * 0.98, 3000, 48, 1), new THREE.MeshStandardMaterial({ color: 0x5d6048, roughness: 1 }));
    far.rotation.x = -Math.PI / 2; far.position.y = 38;
    this.root.add(far);
  }

  // ---------------------------------------------------------------- instanced boxes
  buildBoxes() {
    const W = this.W;
    const groups = new Map();
    for (const b of W.boxes) {
      if (!(b.flags & F.VIS) || b.kind === K.INVIS) continue;
      const rx = Math.floor((b.x0 + b.x1) / 2 / REG), rz = Math.floor((b.z0 + b.z1) / 2 / REG);
      const key = b.kind + ':' + rx + ':' + rz;
      let g = groups.get(key);
      if (!g) { g = { kind: b.kind, list: [] }; groups.set(key, g); }
      g.list.push(b);
    }
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x22303a, roughness: 0.04, metalness: 0.85, transparent: true, opacity: 0.62, envMapIntensity: 1.6 });
    this.glassMat = glassMat;
    const col = new THREE.Color();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    this.boxMeshes = [];
    for (const g of groups.values()) {
      let material;
      if (g.kind === K.GLASS) material = glassMat;
      else {
        const [tn, sc] = KIND_TEX[g.kind] || ['concrete', 0.4];
        const extra = g.kind === K.CONTAINER || g.kind === K.METAL ? { metal: 0.35, env: 1.0, key: 'm' } : g.kind === K.SLAB || g.kind === K.ROOF || g.kind === K.STAIR || g.kind === K.SIDEWALK ? { grime: 0 , key: 'g0' } : {};
        material = this.mat(tn, sc, extra);
      }
      const im = new THREE.InstancedMesh(unit, material, g.list.length);
      im.castShadow = g.kind !== K.GLASS; im.receiveShadow = true;
      g.list.forEach((b, i) => {
        p.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
        s.set(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
        m.compose(p, q, s);
        im.setMatrixAt(i, b.active ? m : this.zero);
        col.setHex(b.color);
        im.setColorAt(i, col);
        this.boxRef[b.i] = { mesh: im, idx: i, m: m.clone() };
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.computeBoundingBox?.();
      this.root.add(im);
      this.boxMeshes.push(im);
    }
  }
  setBoxVisible(bi, vis) {
    const r = this.boxRef[bi];
    if (!r) return;
    r.mesh.setMatrixAt(r.idx, vis ? r.m : this.zero);
    r.mesh.instanceMatrix.needsUpdate = true;
  }
  hidePanel(pid) {
    const P = this.W.panels[pid];
    for (const b of P.boxes) this.setBoxVisible(b, false);
  }
  syncAll() {
    for (const b of this.W.boxes) if (this.boxRef[b.i]) this.setBoxVisible(b.i, b.active);
    for (const [bi, refs] of this.propRefs) {
      const vis = !this.W.buildings[bi].collapsed;
      for (const r of refs) { r.mesh.setMatrixAt(r.idx, vis ? r.m : this.zero); r.mesh.instanceMatrix.needsUpdate = true; }
    }
  }
  collapse(bi) {
    const Bd = this.W.buildings[bi];
    const list = Bd.boxes.filter((b) => this.boxRef[b]).map((b) => b);
    for (const pid of Bd.panels) for (const b of this.W.panels[pid].boxes) if (!list.includes(b) && this.boxRef[b]) list.push(b);
    this.collapsing.push({ bi, t: 0, list, dur: 2.6 + Bd.floors * 0.25, h: Bd.top - Bd.by });
    const refs = this.propRefs.get(bi) || [];
    for (const r of refs) { r.mesh.setMatrixAt(r.idx, this.zero); r.mesh.instanceMatrix.needsUpdate = true; }
  }
  updateCollapse(dt) {
    if (!this.collapsing.length) return;
    const m = new THREE.Matrix4(), off = new THREE.Matrix4();
    this.collapsing = this.collapsing.filter((c) => {
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      const drop = k * k * c.h * 1.05;
      const shake = (1 - k) * 0.12;
      const Bd = this.W.buildings[c.bi];
      const tilt = Math.sin(c.bi * 7.3) * 0.08 * k;
      for (const b of c.list) {
        const r = this.boxRef[b];
        if (!r) continue;
        const bb = this.W.boxes[b];
        if (k >= 1) { r.mesh.setMatrixAt(r.idx, this.zero); r.mesh.instanceMatrix.needsUpdate = true; continue; }
        if (!bb.initActive && bb.kind === K.RUBBLE) continue;
        off.makeRotationZ(tilt);
        off.setPosition((Math.random() - 0.5) * shake, -drop * (0.6 + 0.4 * ((bb.y0 - Bd.by) / Math.max(1, c.h))), (Math.random() - 0.5) * shake);
        m.multiplyMatrices(off, r.m);
        const low = r.m.elements[13] - drop * 0.8;
        if (low < Bd.by - 1) { r.mesh.setMatrixAt(r.idx, this.zero); } else r.mesh.setMatrixAt(r.idx, m);
        r.mesh.instanceMatrix.needsUpdate = true;
      }
      if (k >= 1) { for (const rb of Bd.rubble) this.setBoxVisible(rb, true); return false; }
      return true;
    });
  }

  // ---------------------------------------------------------------- props
  buildProps() {
    const W = this.W;
    const T = this.T;
    const byType = new Map();
    for (const p of W.props) { if (!byType.has(p.type)) byType.set(p.type, []); byType.get(p.type).push(p); }
    const leafTex = this.leafTexture();
    this.leafTex = leafTex;
    const foliage = foliageMaterial(leafTex, { key: 'tree' });
    const bushMat = foliageMaterial(leafTex, { key: 'bush', color: 0xc8d0a0, wind: 0.6 });
    this.foliageMats = [foliage, bushMat];
    const bark = this.mat('wood', 1.6, { color: 0x6a5a48, key: 'bark' });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9a9c98, roughness: 0.45, metalness: 0.8 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x3a3c3a, roughness: 0.6, metalness: 0.7 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.5 });
    const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.5, envMapIntensity: 1.1 });
    const burnt = this.mat('metal', 0.6, { color: 0x4a3c34, metal: 0.4, key: 'burnt' });
    const woodM = this.mat('wood', 0.8, { key: 'wp' });
    const rockM = this.mat('rock', 0.35, { key: 'rk', grime: 0 });
    const concreteM = this.mat('concrete', 0.5, { key: 'cp' });
    const cloth = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
    const hayM = new THREE.MeshStandardMaterial({ color: 0xc9a85a, roughness: 1, map: T.grass.map });
    const lampM = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffe0a0, emissiveIntensity: 0.4 });
    const waterM = new THREE.MeshStandardMaterial({ color: 0x1e3a40, roughness: 0.02, metalness: 0.2, envMapIntensity: 1.8, transparent: true, opacity: 0.85 });
    const tentM = this.mat('sandbag', 0.6, { key: 'tent', grime: 0 });

    const defs = {
      tree: (v) => this.treeParts(v, bark, foliage),
      bush: () => this.bushParts(bushMat),
      rock: () => [[this.rockGeo(), rockM]],
      car: () => this.carParts(paint, glass, rubber, darkMetal),
      carBurnt: () => this.carParts(burnt, burnt, burnt, burnt),
      lamp: () => [[merge([C(0.07, 0.1, 6, 8, 0, 3, 0), C(0.05, 0.05, 1.6, 6, 0, 6, 0.75, Math.PI / 2), B(0.5, 0.12, 0.25, 0, 5.95, 1.5)]), darkMetal], [B(0.42, 0.04, 0.2, 0, 5.87, 1.5), lampM]],
      pole: () => [[merge([C(0.13, 0.17, 10, 7, 0, 5, 0), B(2.6, 0.14, 0.14, 0, 9.3, 0), C(0.05, 0.05, 0.25, 5, -1.1, 9.5, 0), C(0.05, 0.05, 0.25, 5, 1.1, 9.5, 0)]), bark]],
      acunit: () => [[merge([B(1.2, 0.9, 0.9, 0, 0.45, 0)]), metal], [C(0.3, 0.3, 0.05, 16, 0, 0.92, 0), darkMetal]],
      antenna: () => [[merge([C(0.03, 0.04, 5, 5, 0, 2.5, 0), B(1, 0.04, 0.04, 0, 4, 0), B(0.7, 0.04, 0.04, 0, 4.5, 0), C(0.25, 0.25, 0.05, 12, 0.4, 2, 0, 0, Math.PI / 2)]), darkMetal]],
      watertank: () => [[merge([C(0.95, 0.95, 1.8, 16, 0, 1.4, 0), C(0.98, 0.98, 0.1, 16, 0, 2.35, 0)]), metal], [merge([B(0.08, 0.5, 0.08, 0.7, 0.25, 0.7), B(0.08, 0.5, 0.08, -0.7, 0.25, 0.7), B(0.08, 0.5, 0.08, 0.7, 0.25, -0.7), B(0.08, 0.5, 0.08, -0.7, 0.25, -0.7)]), darkMetal]],
      statue: () => [[merge([B(1.6, 0.4, 1.6, 0, 0.2, 0), C(0.45, 0.55, 2.4, 8, 0, 1.6, 0), C(0.22, 0.35, 1.0, 8, 0, 3.3, 0), new THREE.SphereGeometry(0.3, 10, 8).translate(0, 4.0, 0)]), new THREE.MeshStandardMaterial({ color: 0x4a6a58, roughness: 0.4, metalness: 0.85 })]],
      water: () => [[geo(new THREE.CircleGeometry(0.5, 4), 0, 0, 0, -Math.PI / 2, Math.PI / 4), waterM]],
      stall: () => [[merge([B(0.08, 2.4, 0.08, -1.6, 1.2, -0.9), B(0.08, 2.4, 0.08, 1.6, 1.2, -0.9), B(0.08, 2.0, 0.08, -1.6, 1.0, 0.9), B(0.08, 2.0, 0.08, 1.6, 1.0, 0.9)]), woodM], [geo(new THREE.PlaneGeometry(3.6, 2.2, 6, 2), 0, 2.25, 0, -Math.PI / 2 + 0.2), cloth]],
      crane: () => this.craneParts(new THREE.MeshStandardMaterial({ color: 0xd8a020, roughness: 0.55, metalness: 0.6 }), darkMetal),
      crane2: () => [[merge([B(0.6, 12, 0.6, -10, 6, 0), B(0.6, 12, 0.6, 10, 6, 0), B(21, 1, 1, 0, 12, 0), B(2, 1.5, 1.6, 3, 11, 0)]), new THREE.MeshStandardMaterial({ color: 0xc04020, roughness: 0.6, metalness: 0.5 })]],
      pipes: () => [[merge([C(0.4, 0.4, 6, 12, 0, 0.4, 0, 0, Math.PI / 2), C(0.4, 0.4, 6, 12, 0, 0.4, 0.82, 0, Math.PI / 2), C(0.4, 0.4, 6, 12, 0, 1.1, 0.41, 0, Math.PI / 2)]), darkMetal]],
      barrel: () => [[C(0.3, 0.3, 0.9, 14, 0, 0.45, 0), new THREE.MeshStandardMaterial({ color: 0x2a5a8a, roughness: 0.5, metalness: 0.6 })]],
      hay: () => [[C(0.62, 0.62, 1.2, 14, 0, 0.62, 0, 0, Math.PI / 2), hayM]],
      tractor: () => [[merge([B(1.6, 1.0, 2.6, 0, 1.1, 0), B(1.3, 1.2, 1.2, 0, 2.0, 0.6)]), new THREE.MeshStandardMaterial({ color: 0x8a2a1a, roughness: 0.8, metalness: 0.3 })], [merge([C(0.75, 0.75, 0.45, 14, -0.95, 0.75, 0.7, 0, Math.PI / 2), C(0.75, 0.75, 0.45, 14, 0.95, 0.75, 0.7, 0, Math.PI / 2), C(0.45, 0.45, 0.3, 12, -0.9, 0.45, -0.9, 0, Math.PI / 2), C(0.45, 0.45, 0.3, 12, 0.9, 0.45, -0.9, 0, Math.PI / 2)]), rubber]],
      bogie: () => [[merge([B(13, 0.3, 2.2, 0, 0.75, 0), ...[-4.5, -3.3, 3.3, 4.5].flatMap((x) => [C(0.42, 0.42, 0.15, 12, x, 0.45, 0.75, Math.PI / 2), C(0.42, 0.42, 0.15, 12, x, 0.45, -0.75, Math.PI / 2)])]), darkMetal]],
      watertower: () => [[merge([C(2.4, 2.4, 4, 16, 0, 9, 0), new THREE.ConeGeometry(2.5, 1.2, 16).translate(0, 11.6, 0)]), new THREE.MeshStandardMaterial({ color: 0x7a8a8a, roughness: 0.6, metalness: 0.6 })], [merge([-1.6, 1.6].flatMap((x) => [-1.6, 1.6].map((z) => C(0.12, 0.12, 7.2, 6, x, 3.6, z)))), darkMetal]],
      tent: () => [[this.tentGeo(), tentM]],
      hqflag: () => [[C(0.05, 0.06, 8, 6, 0, 4, 0), metal]],
      bench: () => [[merge([B(1.8, 0.06, 0.45, 0, 0.45, 0), B(1.8, 0.4, 0.06, 0, 0.75, -0.2), B(0.06, 0.45, 0.4, -0.8, 0.22, 0), B(0.06, 0.45, 0.4, 0.8, 0.22, 0)]), woodM]],
    };
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), col = new THREE.Color();
    const place = (type, list) => {
      const variants = type === 'tree' ? [0, 1, 2] : [null];
      for (const v of variants) {
        const items = type === 'tree' ? list.filter((it) => it.v === v) : list;
        if (!items.length) continue;
        const parts = v !== null ? defs.tree(v) : defs[type]();
        for (const [g, material] of parts) {
          const im = new THREE.InstancedMesh(g, material, items.length);
          im.castShadow = type !== 'water' && type !== 'bush'; im.receiveShadow = true;
          items.forEach((it, i) => {
            p.set(it.x, it.y, it.z); e.set(0, it.ry || 0, 0); q.setFromEuler(e);
            const sc = it.s || 1;
            if (type === 'water') s.set(sc, 1, sc); else s.set(sc, sc, sc);
            mm.compose(p, q, s);
            im.setMatrixAt(i, mm);
            if (type === 'car' || type === 'carBurnt' || type === 'stall' || type === 'tent' || type === 'tree' || type === 'bush' || type === 'rock') {
              if (it.c != null && material !== glass && material !== rubber) col.setHex(it.c);
              else if (type === 'tree' || type === 'bush') col.setHSL(0.18 + Math.sin(it.x * 0.3) * 0.04, 0.35, 0.42 + Math.sin(it.z * 0.7) * 0.08).multiplyScalar(2.1);
              else if (type === 'rock') col.setScalar(0.85 + Math.sin(it.x) * 0.15);
              else if (type === 'tent') col.setHex(it.team === 1 ? 0xb8b494 : 0x8a8a7a);
              else col.setHex(0xffffff);
              im.setColorAt(i, col);
            }
            if (it.bld != null) { if (!this.propRefs.has(it.bld)) this.propRefs.set(it.bld, []); this.propRefs.get(it.bld).push({ mesh: im, idx: i, m: mm.clone() }); }
          });
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          im.computeBoundingSphere();
          this.root.add(im);
        }
      }
    };
    for (const [type, list] of byType) {
      if (type === 'car') { place('car', list.filter((c) => !c.burnt)); place('carBurnt', list.filter((c) => c.burnt)); continue; }
      if (!defs[type]) continue;
      place(type, list);
    }
    // rails
    const rails = [], sleepers = [];
    for (const r of W.rails) {
      for (const off of [-0.72, 0.72]) rails.push(B(r.x1 - r.x0, 0.14, 0.08, (r.x0 + r.x1) / 2, heightAt(W, (r.x0 + r.x1) / 2, r.z) + 0.25, r.z + off));
      for (let x = r.x0; x < r.x1; x += 0.9) sleepers.push(B(0.22, 0.12, 2.3, x, heightAt(W, x, r.z) + 0.1, r.z));
    }
    if (rails.length) { const m1 = new THREE.Mesh(merge(rails), metal); m1.receiveShadow = true; this.root.add(m1); const m2 = new THREE.Mesh(merge(sleepers), woodM); m2.receiveShadow = true; this.root.add(m2); }
    // power lines between poles
    const poles = (byType.get('pole') || []).slice().sort((a, b) => a.z - b.z);
    const pts = [];
    for (let i = 0; i < poles.length - 1; i++) {
      const a = poles[i], b = poles[i + 1];
      if (Math.abs(b.z - a.z) > 40) continue;
      for (const ox of [-1.1, 1.1]) {
        for (let k = 0; k < 12; k++) {
          const t0 = k / 12, t1 = (k + 1) / 12;
          const y = (t) => (a.y + 9.6) * (1 - t) + (b.y + 9.6) * t - Math.sin(t * Math.PI) * 1.2;
          pts.push(a.x + ox, y(t0), a.z + (b.z - a.z) * t0, a.x + ox, y(t1), a.z + (b.z - a.z) * t1);
        }
      }
    }
    if (pts.length) { const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); this.root.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x151515 }))); }
    // HQ flag cloths
    this.hqFlags = [];
    for (const it of byType.get('hqflag') || []) {
      const g = new THREE.PlaneGeometry(2.4, 1.4, 12, 6); g.translate(1.2, 0, 0);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: it.team === 1 ? 0x2a6ac0 : 0xb03020, side: THREE.DoubleSide, roughness: 0.85 }));
      m.position.set(it.x + 0.06, it.y + 7.2, it.z);
      m.castShadow = true;
      this.root.add(m);
      this.hqFlags.push(m);
    }
  }

  leafTexture() {
    const S = 256;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const r = mulberry32(77);
    for (let k = 0; k < 140; k++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI * 2, l = 10 + r() * 16;
      const h = 80 + r() * 30, sat = 30 + r() * 25, li = 22 + r() * 22;
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = `hsl(${h},${sat}%,${li}%)`;
      g.beginPath(); g.ellipse(0, 0, l, l * 0.38, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `hsla(${h},${sat}%,${li + 12}%,0.5)`; g.lineWidth = 1; g.beginPath(); g.moveTo(-l, 0); g.lineTo(l, 0); g.stroke();
      g.restore();
    }
    // twigs
    g.strokeStyle = 'rgba(60,45,30,0.9)'; g.lineWidth = 2;
    for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(S / 2, S); g.quadraticCurveTo(r() * S, S / 2, r() * S, r() * S * 0.4); g.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    // radial alpha falloff to make card edges ragged
    const img = g.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
      const i = (y * S + x) * 4;
      if (d > 0.95) img.data[i + 3] = 0;
    }
    g.putImageData(img, 0, 0);
    t.needsUpdate = true;
    return t;
  }
  treeParts(v, bark, foliage) {
    const r = mulberry32(101 + v * 31);
    const H = [6.5, 8.5, 5.5][v], crownR = [2.6, 2.2, 3.0][v], crownY = [5.2, 6.4, 4.2][v];
    const trunk = [C(0.14, 0.26, H * 0.75, 7, 0, H * 0.375, 0)];
    for (let b = 0; b < 4; b++) {
      const a = r() * Math.PI * 2, len = crownR * 0.9;
      const g = C(0.04, 0.09, len, 5, 0, len / 2, 0);
      g.rotateZ(0.9 + r() * 0.4); g.rotateY(a); g.translate(0, H * 0.45 + r() * H * 0.2, 0);
      trunk.push(g);
    }
    const cards = [];
    const n = v === 1 ? 46 : 38;
    for (let k = 0; k < n; k++) {
      const pl = new THREE.PlaneGeometry(1.9, 1.9);
      const u = r() * 2 - 1, th = r() * Math.PI * 2, rr = Math.cbrt(r());
      let px = Math.sqrt(1 - u * u) * Math.cos(th) * rr * crownR, py = u * rr * crownR * (v === 1 ? 1.5 : 0.85), pz = Math.sqrt(1 - u * u) * Math.sin(th) * rr * crownR;
      pl.rotateX(r() * Math.PI); pl.rotateY(r() * Math.PI); pl.rotateZ(r() * Math.PI);
      pl.translate(px, py + crownY, pz);
      // outward normals for soft volumetric shading
      const nrm = pl.attributes.normal, pos = pl.attributes.position;
      for (let i = 0; i < nrm.count; i++) {
        const dx = pos.getX(i), dy = pos.getY(i) - crownY, dz = pos.getZ(i);
        const l = Math.hypot(dx, dy * 0.7, dz) || 1;
        nrm.setXYZ(i, dx / l, (dy * 0.7) / l + 0.25, dz / l);
      }
      cards.push(pl);
    }
    return [[merge(trunk), bark], [merge(cards), foliage]];
  }
  bushParts(mat) {
    const r = mulberry32(555);
    const cards = [];
    for (let k = 0; k < 14; k++) {
      const pl = new THREE.PlaneGeometry(1.2, 1.2);
      pl.rotateX(r() * Math.PI); pl.rotateY(r() * Math.PI);
      const px = (r() - 0.5) * 1.4, py = 0.4 + r() * 0.6, pz = (r() - 0.5) * 1.4;
      pl.translate(px, py, pz);
      const nrm = pl.attributes.normal, pos = pl.attributes.position;
      for (let i = 0; i < nrm.count; i++) { const dx = pos.getX(i), dy = pos.getY(i) - 0.3, dz = pos.getZ(i); const l = Math.hypot(dx, dy, dz) || 1; nrm.setXYZ(i, dx / l, dy / l + 0.3, dz / l); }
      cards.push(pl);
    }
    return [[merge(cards), mat]];
  }
  rockGeo() {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    const r = mulberry32(9);
    const seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = p.getX(i).toFixed(3) + p.getY(i).toFixed(3) + p.getZ(i).toFixed(3);
      if (!seen.has(k)) seen.set(k, 0.75 + r() * 0.45);
      const s = seen.get(k);
      p.setXYZ(i, p.getX(i) * s * 1.1, p.getY(i) * s * 0.75 + 0.2, p.getZ(i) * s);
    }
    g.computeVertexNormals();
    return g;
  }
  carParts(paint, glass, rubber, dark) {
    const shape = new THREE.Shape();
    shape.moveTo(-2.2, 0.35); shape.lineTo(2.2, 0.35); shape.lineTo(2.25, 0.8); shape.lineTo(1.9, 0.95); shape.lineTo(0.9, 1.0);
    shape.lineTo(0.35, 1.45); shape.lineTo(-1.2, 1.45); shape.lineTo(-1.75, 1.0); shape.lineTo(-2.25, 0.95); shape.lineTo(-2.25, 0.35);
    const body = new THREE.ExtrudeGeometry(shape, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2 });
    body.translate(0, 0, -0.85); body.rotateY(Math.PI / 2);
    const win = new THREE.Shape();
    win.moveTo(0.8, 1.02); win.lineTo(0.32, 1.4); win.lineTo(-1.15, 1.4); win.lineTo(-1.65, 1.02);
    const wg = new THREE.ExtrudeGeometry(win, { depth: 1.74, bevelEnabled: false }); wg.translate(0, 0, -0.87); wg.rotateY(Math.PI / 2);
    const wheels = [];
    for (const [x, z] of [[-0.82, 1.4], [0.82, 1.4], [-0.82, -1.4], [0.82, -1.4]]) wheels.push(C(0.34, 0.34, 0.24, 14, x, 0.34, z, 0, Math.PI / 2));
    const under = B(1.6, 0.18, 4.1, 0, 0.3, 0);
    const lights = merge([B(0.35, 0.12, 0.04, -0.6, 0.75, 2.28), B(0.35, 0.12, 0.04, 0.6, 0.75, 2.28), B(1.75, 0.12, 0.1, 0, 0.45, 2.3), B(1.75, 0.12, 0.1, 0, 0.45, -2.3)]);
    return [[body, paint], [wg, glass], [merge(wheels), rubber], [merge([under, lights]), dark]];
  }
  craneParts(yellow, dark) {
    const parts = [];
    const H = 42;
    for (let y = 0; y < H; y += 3) {
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(B(0.15, 3, 0.15, x, y + 1.5, z));
      parts.push(B(2, 0.1, 0.1, 0, y, -1), B(2, 0.1, 0.1, 0, y, 1), B(0.1, 0.1, 2, -1, y, 0), B(0.1, 0.1, 2, 1, y, 0));
      const d = B(0.08, 3.6, 0.08, 0, y + 1.5, -1); d.rotateZ(0.6); parts.push(d.translate(0, 0, 0));
    }
    const jib = [];
    for (let x = -12; x < 40; x += 2.5) { jib.push(B(2.5, 0.12, 0.12, x, H + 0.1, -0.7), B(2.5, 0.12, 0.12, x, H + 0.1, 0.7), B(2.5, 0.12, 0.12, x, H + 1.6, 0)); }
    const cab = B(2.4, 2, 2.4, 0, H - 1, 1.8);
    const counter = B(4, 2, 2, -11, H - 0.6, 0);
    const cable = B(0.04, 18, 0.04, 30, H - 9, 0);
    const hook = B(0.5, 0.6, 0.3, 30, H - 18, 0);
    return [[merge([...parts, ...jib]), yellow], [merge([cab, counter, cable, hook]), dark]];
  }
  tentGeo() {
    const s = new THREE.Shape(); s.moveTo(-3, 0); s.lineTo(0, 2.6); s.lineTo(3, 0); s.lineTo(-3, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 5, bevelEnabled: false }); g.translate(0, 0, -2.5);
    return g;
  }

  // ---------------------------------------------------------------- flags
  buildFlags() {
    this.flagViews = [];
    const poleM = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.9, roughness: 0.35 });
    for (const f of this.W.flags) {
      const g = new THREE.Group();
      const y = heightAt(this.W, f.x + 3, f.z + 3);
      const pole = new THREE.Mesh(C(0.06, 0.08, 9, 8, 0, 4.5, 0), poleM); pole.castShadow = true;
      const base = new THREE.Mesh(C(0.5, 0.6, 0.3, 12, 0, 0.15, 0), this.mat('concrete', 0.5, { key: 'cp' }));
      const clothG = new THREE.PlaneGeometry(2.6, 1.6, 16, 8); clothG.translate(1.3, 0, 0);
      const clothM = new THREE.MeshStandardMaterial({ color: 0xdddddd, side: THREE.DoubleSide, roughness: 0.8 });
      const cloth = new THREE.Mesh(clothG, clothM); cloth.position.y = 8.0; cloth.castShadow = true;
      clothM.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.flagTime || (this.flagTime = { value: 0 });
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
          float k = position.x / 2.6;
          transformed.z += sin(position.x * 2.4 - uTime * 5.0) * 0.22 * k + sin(position.x * 4.0 + position.y * 2.0 - uTime * 7.0) * 0.06 * k;
          transformed.y -= k * k * 0.25;`);
      };
      // ground ring marking capture radius
      const ringG = new THREE.RingGeometry(f.r - 0.4, f.r, 64); ringG.rotateX(-Math.PI / 2);
      const ringM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false });
      const ring = new THREE.Mesh(ringG, ringM); ring.position.y = TOWN_H - y + 0.25;
      ring.visible = false;
      g.add(pole, base, cloth, ring);
      g.position.set(f.x + 3, y, f.z + 3);
      ring.position.set(-3, f.y - y + 0.2, -3);
      this.root.add(g);
      this.flagViews.push({ g, clothM, ringM, f });
    }
  }
  updateFlags(states, myTeam, dt) {
    if (this.flagTime) this.flagTime.value += dt;
    for (const fv of this.flagViews) {
      const st = states[fv.f.id];
      const owner = st ? st.owner : 0;
      const c = owner === 0 ? 0xd8d8d8 : owner === myTeam ? 0x3aa8ff : 0xff4a3a;
      fv.clothM.color.setHex(c);
      fv.ringM.color.setHex(c);
      fv.ringM.opacity = 0.35;
    }
  }

  // ---------------------------------------------------------------- grass
  buildGrass() {
    const dens = this.gfx.Q.grass;
    this.grass = null;
    if (!dens) return;
    const S = 64;
    const c = document.createElement('canvas'); c.width = S; c.height = S * 2;
    const g = c.getContext('2d');
    const r = mulberry32(3);
    for (let k = 0; k < 26; k++) {
      const x = r() * S, w = 1.5 + r() * 2.5, h = S * (1.1 + r() * 0.85), bend = (r() - 0.5) * 18;
      const gr = g.createLinearGradient(0, S * 2, 0, S * 2 - h);
      const hue = 70 + r() * 25;
      gr.addColorStop(0, `hsl(${hue},40%,14%)`); gr.addColorStop(1, `hsl(${hue - 10},${35 + r() * 20}%,${38 + r() * 18}%)`);
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x - w, S * 2); g.quadraticCurveTo(x + bend * 0.5, S * 2 - h * 0.5, x + bend, S * 2 - h); g.quadraticCurveTo(x + bend * 0.5 + w * 0.3, S * 2 - h * 0.5, x + w, S * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = foliageMaterial(tex, { key: 'grass', wind: 1.4 });
    mat.alphaTest = 0.4;
    const parts = [];
    for (let k = 0; k < 3; k++) { const p = new THREE.PlaneGeometry(0.75, 0.42); p.translate(0, 0.2, 0); p.rotateY(k * Math.PI / 3); parts.push(p); }
    const geom = merge(parts);
    const nrm = geom.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const N = Math.floor(7000 * dens);
    const im = new THREE.InstancedMesh(geom, mat, N);
    im.receiveShadow = true; im.frustumCulled = false;
    im.count = 0;
    this.root.add(im);
    this.grass = { im, N, cx: 1e9, cz: 1e9, mat, R: 34 + dens * 10 };
    this.foliageMats.push(mat);
  }
  updateGrass(cam) {
    const G = this.grass;
    if (!G) return;
    if (Math.hypot(cam.x - G.cx, cam.z - G.cz) < 6) return;
    G.cx = cam.x; G.cz = cam.z;
    const R = G.R, step = R * 2 / Math.sqrt(G.N * 1.7);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    let n = 0;
    const x0 = Math.floor((cam.x - R) / step) * step, z0 = Math.floor((cam.z - R) / step) * step;
    for (let z = z0; z < cam.z + R && n < G.N; z += step) for (let x = x0; x < cam.x + R && n < G.N; x += step) {
      const hx = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453, h = hx - Math.floor(hx);
      const jx = x + (h - 0.5) * step, jz = z + (((h * 7.13) % 1) - 0.5) * step;
      if ((jx - cam.x) ** 2 + (jz - cam.z) ** 2 > R * R) continue;
      const sp = this.splatAt(jx, jz);
      if (sp[1] > 40 || sp[0] > 150 || sp[2] > 60) continue;
      const y = heightAt(this.W, jx, jz);
      const sl = Math.abs(heightAt(this.W, jx + 1, jz) - y) + Math.abs(heightAt(this.W, jx, jz + 1) - y);
      if (sl > 0.5) continue;
      p.set(jx, y - 0.02, jz); e.set(0, h * 6.28, 0); q.setFromEuler(e);
      const sc = 0.55 + h * 0.6; s.set(sc, sc * (0.7 + ((h * 3.7) % 1) * 0.7), sc);
      m.compose(p, q, s);
      G.im.setMatrixAt(n++, m);
    }
    G.im.count = n;
    G.im.instanceMatrix.needsUpdate = true;
  }

  update(dt, cam) {
    for (const m of this.foliageMats) m.userData.uniforms.uTime.value += dt;
    this.updateGrass(cam);
    this.updateCollapse(dt);
    if (this.hqFlags) for (const f of this.hqFlags) f.rotation.y = Math.sin(this.gfx.time * 0.7) * 0.25;
  }
}
