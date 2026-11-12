// Visual effects: a CPU billboard particle system (alpha + additive passes),
// tracers, bullet-hole / scorch decals, shell casings, muzzle light flashes and
// ambient atmosphere (dust motes, drifting smoke columns).
import type { MapData } from '@shared/world/MapBuilder';
import { F_SOLID } from '@shared/world/World';
import * as pc from 'playcanvas';
import type { Assets } from '../core/assets';
import type { Engine } from '../core/engine';

const MAX = 2600;
const MAX_TRACERS = 48;
const STRIDE = 16; // x y z vx vy vz life maxLife size0 size1 r g b a gravity drag
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

class QuadBatch {
  readonly mesh: pc.Mesh;
  readonly mi: pc.MeshInstance;
  readonly pos: Float32Array;
  readonly uv: Float32Array;
  readonly col: Uint8Array;
  private readonly nrm: Float32Array;
  n = 0;
  constructor(device: pc.GraphicsDevice, readonly max: number, material: pc.Material) {
    this.pos = new Float32Array(max * 12);
    this.uv = new Float32Array(max * 8);
    this.col = new Uint8Array(max * 16);
    const idx = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) { const b = i * 4, o = i * 6; idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; }
    this.mesh = new pc.Mesh(device);
    this.mesh.clear(true, false, max * 4, max * 6);
    const nrm = new Float32Array(max * 12);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    this.nrm = nrm;
    this.mesh.setPositions(this.pos); this.mesh.setNormals(nrm); this.mesh.setUvs(0, this.uv); this.mesh.setColors32(this.col); this.mesh.setIndices(idx);
    this.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    this.mi = new pc.MeshInstance(this.mesh, material);
    this.mi.cull = false;
  }
  begin(): void { this.n = 0; }
  quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    u0: number, v0: number, u1: number, v1: number, r: number, g: number, b: number, a: number): void {
    if (this.n >= this.max) return;
    const p = this.n * 12, t = this.n * 8, c = this.n * 16;
    const P = this.pos, U = this.uv, C = this.col;
    P[p] = ax; P[p + 1] = ay; P[p + 2] = az; P[p + 3] = bx; P[p + 4] = by; P[p + 5] = bz; P[p + 6] = cx; P[p + 7] = cy; P[p + 8] = cz; P[p + 9] = dx; P[p + 10] = dy; P[p + 11] = dz;
    U[t] = u0; U[t + 1] = v0; U[t + 2] = u1; U[t + 3] = v0; U[t + 4] = u1; U[t + 5] = v1; U[t + 6] = u0; U[t + 7] = v1;
    for (let i = 0; i < 4; i++) { C[c + i * 4] = r; C[c + i * 4 + 1] = g; C[c + i * 4 + 2] = b; C[c + i * 4 + 3] = a; }
    this.n++;
  }
  end(): void {
    this.mesh.setPositions(this.pos, 3, this.n * 4);
    this.mesh.setNormals(this.nrm, 3, this.n * 4);
    this.mesh.setUvs(0, this.uv, 2, this.n * 4);
    this.mesh.setColors32(this.col, this.n * 4);
    this.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    this.mesh.primitive[0].count = this.n * 6;
    this.mi.visible = this.n > 0;
  }
}

interface Tracer { x: number; y: number; z: number; dx: number; dy: number; dz: number; len: number; t: number; own: boolean }
interface Shell { x: number; y: number; z: number; vx: number; vy: number; vz: number; floor: number; life: number; spin: number }
interface Flash { e: pc.Entity; t: number; base: number }

export class Effects {
  private readonly root = new pc.Entity('effects');
  private readonly alpha: QuadBatch;
  private readonly add: QuadBatch;
  private readonly decals: QuadBatch;
  private readonly data = new Float32Array(MAX * STRIDE);
  private readonly kind = new Uint8Array(MAX); // 0 free, 1 alpha, 2 additive, 3 additive streak
  private readonly order: number[] = [];
  private cursor = 0;
  private tracers: Tracer[] = [];
  private shells: Shell[] = [];
  private flashes: Flash[] = [];
  private decalList: { x: number; y: number; z: number; nx: number; ny: number; nz: number; size: number; rot: number; tile: number; life: number }[] = [];
  private decalsDirty = false;
  private readonly columns: { x: number; y: number; z: number; t: number }[];
  private moteT = 0;
  private readonly quality: number;
  private readonly wind = new pc.Vec3(0.9, 0, 0.35);

  constructor(private readonly engine: Engine, assets: Assets, private readonly map: MapData) {
    const device = engine.device;
    this.quality = engine.preset.particles;
    const soft = assets.canvasTexture('soft', 128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.75)'); g.addColorStop(0.7, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
      // break up the silhouette a little so smoke does not look like perfect discs
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, r = s * (0.3 + Math.random() * 0.2); ctx.beginPath(); ctx.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, s * (0.03 + Math.random() * 0.06), 0, 6.28); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill(); }
    });
    const decalTex = assets.canvasTexture('decals', 256, (ctx, s) => {
      // left half: bullet hole, right half: scorch mark
      const h = s / 2;
      let g = ctx.createRadialGradient(h / 2, h, 0, h / 2, h, h / 2);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.22, 'rgba(8,8,8,0.95)'); g.addColorStop(0.4, 'rgba(40,38,36,0.5)'); g.addColorStop(1, 'rgba(60,58,55,0)');
      ctx.fillStyle = g; ctx.fillRect(0, h / 2, h, h);
      ctx.strokeStyle = 'rgba(20,20,20,0.55)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28; ctx.beginPath(); ctx.moveTo(h / 2 + Math.cos(a) * 8, h + Math.sin(a) * 8); ctx.lineTo(h / 2 + Math.cos(a) * (18 + Math.random() * 26), h + Math.sin(a) * (18 + Math.random() * 26)); ctx.stroke(); }
      g = ctx.createRadialGradient(h + h / 2, h, 0, h + h / 2, h, h / 2);
      g.addColorStop(0, 'rgba(5,5,5,0.9)'); g.addColorStop(0.5, 'rgba(12,11,10,0.6)'); g.addColorStop(1, 'rgba(20,18,16,0)');
      ctx.fillStyle = g; ctx.fillRect(h, h / 2, h, h);
    });
    const mk = (tex: pc.Texture, additive: boolean): pc.StandardMaterial => {
      const m = new pc.StandardMaterial();
      m.useLighting = false; m.diffuse = new pc.Color(0, 0, 0); m.emissive = new pc.Color(1, 1, 1); m.emissiveVertexColor = true;
      m.emissiveMap = tex; m.opacityMap = tex; m.opacityMapChannel = 'a'; m.opacityVertexColor = true; m.opacityVertexColorChannel = 'a';
      m.blendType = additive ? pc.BLEND_ADDITIVEALPHA : pc.BLEND_NORMAL; m.depthWrite = false; m.cull = pc.CULLFACE_NONE;
      m.emissiveIntensity = additive ? 3.2 : 1;
      m.update();
      return m;
    };
    this.alpha = new QuadBatch(device, MAX, mk(soft, false));
    this.add = new QuadBatch(device, 900, mk(soft, true));
    const dm = mk(decalTex, false);
    dm.depthBias = -1.5; dm.slopeDepthBias = -1.5; dm.update();
    this.decals = new QuadBatch(device, engine.preset.decals, dm);
    for (const [name, batch] of [['fx-alpha', this.alpha], ['fx-add', this.add], ['fx-decals', this.decals]] as const) {
      const e = new pc.Entity(name);
      e.addComponent('render', { meshInstances: [batch.mi], castShadows: false, receiveShadows: false });
      this.root.addChild(e);
    }
    this.decals.mi.drawOrder = -10;
    engine.app.root.addChild(this.root);
    // drifting smoke columns from wrecks (pure atmosphere)
    this.columns = [{ x: 9, y: 0.6, z: -3.4, t: 0 }, { x: -62, y: 0.8, z: 14, t: 0 }, { x: 47, y: 3.2, z: -9.6, t: 0 }, { x: 22, y: 0.8, z: 22, t: 0 }];
    for (let i = 0; i < 4; i++) {
      const e = new pc.Entity('flash-light');
      e.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.78, 0.45), intensity: 0, range: 9, castShadows: false });
      this.root.addChild(e);
      this.flashes.push({ e, t: 0, base: 0 });
    }
  }

  clear(): void {
    this.kind.fill(0);
    this.tracers.length = 0; this.shells.length = 0; this.decalList.length = 0; this.decalsDirty = true;
  }

  // ------------------------------------------------------------------ particle core
  private spawn(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number,
    r: number, g: number, b: number, a: number, gravity = 0, drag = 0): void {
    let i = this.cursor;
    for (let tries = 0; tries < 24 && this.kind[i] !== 0; tries++) i = (i + 1) % MAX;
    this.cursor = (i + 1) % MAX;
    this.kind[i] = kind;
    const o = i * STRIDE, d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz; d[o + 6] = life; d[o + 7] = life;
    d[o + 8] = s0; d[o + 9] = s1; d[o + 10] = r; d[o + 11] = g; d[o + 12] = b; d[o + 13] = a; d[o + 14] = gravity; d[o + 15] = drag;
  }

  private count(n: number): number { return Math.max(1, Math.round(n * this.quality)); }

  // ------------------------------------------------------------------ public effects
  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, own: boolean): void {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz);
    if (len < 2 || this.tracers.length >= MAX_TRACERS) return;
    this.tracers.push({ x: x0, y: y0, z: z0, dx: dx / len, dy: dy / len, dz: dz / len, len, t: own ? 1.5 : 0, own });
  }

  flashLight(x: number, y: number, z: number): void {
    let best = this.flashes[0];
    for (const f of this.flashes) if (f.t < best.t) best = f;
    best.e.setPosition(x, y, z);
    best.t = 0.06; best.base = 5.5;
  }

  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, surface: string, decal: boolean): void {
    const metal = surface === 'metal', wood = surface === 'wood', dirt = surface === 'dirt' || surface === 'fabric', glass = surface === 'glass';
    const [r, g, b] = wood ? [150, 118, 84] : dirt ? [138, 118, 92] : surface === 'brick' ? [168, 120, 100] : surface === 'asphalt' ? [92, 92, 96] : [170, 168, 162];
    for (let i = 0, n = this.count(metal ? 2 : 4); i < n; i++) {
      this.spawn(1, x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * rnd(0.4, 1.8) + rnd(-0.5, 0.5), ny * rnd(0.4, 1.8) + rnd(0.1, 0.9), nz * rnd(0.4, 1.8) + rnd(-0.5, 0.5),
        rnd(0.45, 1.0), rnd(0.06, 0.12), rnd(0.4, 0.75), r, g, b, metal ? 70 : 125, -0.4, 2.2);
    }
    for (let i = 0, n = this.count(metal ? 7 : glass ? 4 : 2); i < n; i++) {
      this.spawn(3, x, y, z, nx * rnd(2, 7) + rnd(-3, 3), ny * rnd(2, 7) + rnd(-1, 4), nz * rnd(2, 7) + rnd(-3, 3), rnd(0.12, 0.3), 0.012, 0.004, 255, metal ? 200 : 230, metal ? 120 : 200, 255, 9, 0.5);
    }
    if (!metal && !glass) for (let i = 0, n = this.count(3); i < n; i++) { // chips
      this.spawn(1, x, y, z, nx * rnd(1, 4) + rnd(-1.5, 1.5), ny * rnd(1, 4) + rnd(0.5, 2.5), nz * rnd(1, 4) + rnd(-1.5, 1.5), rnd(0.4, 0.8), rnd(0.015, 0.03), rnd(0.01, 0.02), r * 0.7, g * 0.7, b * 0.7, 255, 9.8, 0.3);
    }
    if (decal && !glass) this.decal(x, y, z, nx, ny, nz, rnd(0.07, 0.11), 0);
  }

  decal(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, tile: number): void {
    if (this.decalList.length >= this.decals.max) this.decalList.shift();
    this.decalList.push({ x: x + nx * 0.012, y: y + ny * 0.012, z: z + nz * 0.012, nx, ny, nz, size, rot: Math.random() * 6.28, tile, life: 60 });
    this.decalsDirty = true;
  }

  blood(x: number, y: number, z: number): void {
    for (let i = 0, n = this.count(6); i < n; i++) this.spawn(1, x, y, z, rnd(-1.4, 1.4), rnd(-0.2, 1.8), rnd(-1.4, 1.4), rnd(0.25, 0.5), rnd(0.03, 0.07), rnd(0.12, 0.22), 120, 8, 8, 200, 6, 1.5);
  }

  shell(x: number, y: number, z: number, right: pc.Vec3, floorY: number): void {
    if (this.shells.length > 24) this.shells.shift();
    this.shells.push({ x, y, z, vx: right.x * rnd(1.6, 2.6) + rnd(-0.3, 0.3), vy: rnd(1.2, 2.2), vz: right.z * rnd(1.6, 2.6) + rnd(-0.3, 0.3), floor: floorY + 0.01, life: 1.4, spin: rnd(0, 6) });
  }

  explosion(kind: string, x: number, y: number, z: number, radius: number): void {
    if (kind === 'smoke') {
      for (let i = 0, n = this.count(10); i < n; i++) this.spawn(1, x, y + 0.3, z, rnd(-2.5, 2.5), rnd(0.2, 1.5), rnd(-2.5, 2.5), rnd(2, 3.5), 0.6, rnd(2.5, 4), 205, 208, 210, 150, -0.1, 1.2);
      return;
    }
    const k = radius / 7;
    this.spawn(2, x, y + 0.4, z, 0, 0, 0, 0.12, 5 * k, 9 * k, 255, 240, 200, 255);
    for (let i = 0, n = this.count(16); i < n; i++) {
      const a = Math.random() * 6.28, sp = rnd(1.5, 6) * k;
      this.spawn(2, x + rnd(-0.4, 0.4), y + rnd(0.1, 0.9), z + rnd(-0.4, 0.4), Math.cos(a) * sp, rnd(1, 5.5) * k, Math.sin(a) * sp, rnd(0.3, 0.75), rnd(0.8, 1.4) * k, rnd(2.2, 3.6) * k, 255, rnd(120, 190), 40, 230, -1.5, 2.6);
    }
    for (let i = 0, n = this.count(18); i < n; i++) {
      const a = Math.random() * 6.28, sp = rnd(0.5, 3.5) * k;
      this.spawn(1, x + rnd(-0.6, 0.6), y + rnd(0.2, 1.4), z + rnd(-0.6, 0.6), Math.cos(a) * sp, rnd(1.2, 4.5), Math.sin(a) * sp, rnd(2.2, 4.6), rnd(1, 1.8) * k, rnd(3.5, 6) * k, 46, 44, 42, 190, -0.5, 1.1);
    }
    for (let i = 0, n = this.count(12); i < n; i++) { // ground dust ring
      const a = (i / 12) * 6.28 + rnd(-0.2, 0.2);
      this.spawn(1, x, y + 0.15, z, Math.cos(a) * rnd(5, 9) * k, rnd(0.1, 0.8), Math.sin(a) * rnd(5, 9) * k, rnd(1, 1.9), 0.6, rnd(2.2, 3.4), 150, 140, 125, 120, 0, 3.2);
    }
    for (let i = 0, n = this.count(26); i < n; i++) { // burning debris
      const a = Math.random() * 6.28, sp = rnd(4, 15);
      this.spawn(3, x, y + 0.3, z, Math.cos(a) * sp, rnd(4, 14), Math.sin(a) * sp, rnd(0.5, 1.3), 0.03, 0.008, 255, rnd(150, 220), 70, 255, 16, 0.4);
    }
    this.flashLight(x, y + 1, z);
    const f = this.flashes.find((q) => q.t === 0.06);
    if (f) { f.t = 0.3; f.base = 26; (f.e.light as pc.LightComponent).range = 26; }
    this.decal(x, y, z, 0, 1, 0, 2.2 * k, 1);
  }

  destroyed(kind: string, x: number, y: number, z: number): void {
    if (kind === 'glass') {
      for (let i = 0, n = this.count(18); i < n; i++) this.spawn(1, x + rnd(-0.6, 0.6), y + rnd(-0.6, 0.6), z + rnd(-0.6, 0.6), rnd(-1.6, 1.6), rnd(-0.5, 1.5), rnd(-1.6, 1.6), rnd(0.6, 1.1), rnd(0.02, 0.05), 0.02, 210, 232, 240, 210, 9.8, 0.2);
      for (let i = 0, n = this.count(5); i < n; i++) this.spawn(3, x, y, z, rnd(-3, 3), rnd(0, 3), rnd(-3, 3), 0.25, 0.012, 0.004, 235, 245, 255, 220, 9, 0.4);
    } else if (kind === 'crate') {
      for (let i = 0, n = this.count(14); i < n; i++) this.spawn(1, x + rnd(-0.4, 0.4), y + rnd(0, 0.6), z + rnd(-0.4, 0.4), rnd(-3.5, 3.5), rnd(1, 5), rnd(-3.5, 3.5), rnd(0.7, 1.3), rnd(0.05, 0.11), 0.05, 140, 104, 70, 255, 9.8, 0.3);
      for (let i = 0, n = this.count(5); i < n; i++) this.spawn(1, x, y + 0.4, z, rnd(-1, 1), rnd(0.3, 1.2), rnd(-1, 1), rnd(0.8, 1.5), 0.4, rnd(1.2, 2), 150, 135, 115, 110, -0.2, 1.5);
    }
  }

  /** Called every frame for each active smoke grenade cloud. */
  smokeCloud(x: number, y: number, z: number, dt: number, age: number): void {
    const rate = (age < 1.5 ? 16 : 7) * this.quality;
    if (Math.random() > rate * dt) return;
    const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * Math.min(4.2, 1 + age * 2.2);
    this.spawn(1, x + Math.cos(a) * r, y + rnd(0.3, 2.4), z + Math.sin(a) * r, rnd(-0.25, 0.25) + this.wind.x * 0.12, rnd(0.02, 0.25), rnd(-0.25, 0.25) + this.wind.z * 0.12, rnd(4.5, 6.5), rnd(2, 2.8), rnd(4, 5.2), 198, 202, 204, 175, -0.02, 0.4);
  }

  /** Vehicle damage smoke / dust kicked up by wheels. */
  vehicleSmoke(x: number, y: number, z: number, dark: boolean): void {
    if (dark) this.spawn(1, x + rnd(-0.3, 0.3), y, z + rnd(-0.3, 0.3), rnd(-0.3, 0.3) + this.wind.x * 0.4, rnd(1, 2.2), rnd(-0.3, 0.3) + this.wind.z * 0.4, rnd(1.4, 2.4), 0.4, rnd(1.4, 2.4), 36, 34, 33, 170, -0.3, 0.6);
    else this.spawn(1, x + rnd(-0.6, 0.6), y, z + rnd(-0.6, 0.6), rnd(-0.6, 0.6), rnd(0.1, 0.6), rnd(-0.6, 0.6), rnd(0.6, 1.2), 0.3, rnd(1, 1.7), 150, 138, 120, 70, 0, 1.4);
  }

  // ------------------------------------------------------------------ frame update
  update(dt: number, cam: pc.Vec3): void {
    const d = this.data, kind = this.kind;
    const camE = this.engine.camera;
    const R = camE.right, U = camE.up;
    const world = this.map.world;

    // ambient: dust motes + smoke columns
    this.moteT += dt;
    if (this.moteT > 0.08) {
      this.moteT = 0;
      if (this.quality >= 0.6) this.spawn(1, cam.x + rnd(-9, 9), cam.y + rnd(-1.5, 3.5), cam.z + rnd(-9, 9), this.wind.x * 0.5 + rnd(-0.2, 0.2), rnd(-0.08, 0.12), this.wind.z * 0.5 + rnd(-0.2, 0.2), rnd(2.5, 4.5), 0.012, 0.018, 235, 225, 205, 90, 0, 0);
      for (const c of this.columns) {
        if (Math.hypot(c.x - cam.x, c.z - cam.z) > 130) continue;
        this.spawn(1, c.x + rnd(-0.3, 0.3), c.y, c.z + rnd(-0.3, 0.3), this.wind.x * rnd(0.5, 0.9), rnd(1.4, 2.4), this.wind.z * rnd(0.5, 0.9), rnd(6, 9), rnd(0.7, 1.1), rnd(5, 8), 40, 38, 37, 150, -0.12, 0.12);
        if (Math.random() < 0.25) this.spawn(3, c.x, c.y + 0.2, c.z, rnd(-0.6, 0.6), rnd(1.5, 3.5), rnd(-0.6, 0.6), rnd(0.6, 1.4), 0.015, 0.004, 255, 160, 60, 255, -1, 0.4);
      }
    }

    // integrate + collect
    const order = this.order;
    order.length = 0;
    this.add.begin();
    for (let i = 0; i < MAX; i++) {
      const k = kind[i];
      if (k === 0) continue;
      const o = i * STRIDE;
      d[o + 6] -= dt;
      if (d[o + 6] <= 0) { kind[i] = 0; continue; }
      const drag = Math.max(0, 1 - d[o + 15] * dt);
      d[o + 3] *= drag; d[o + 5] *= drag; d[o + 4] = d[o + 4] * drag - d[o + 14] * dt;
      d[o] += d[o + 3] * dt; d[o + 1] += d[o + 4] * dt; d[o + 2] += d[o + 5] * dt;
      if (d[o + 14] > 5 && d[o + 4] < 0 && d[o + 1] < cam.y + 2) { // heavy particles settle on the ground
        const fl = world.surfaceAt(d[o], d[o + 2], d[o + 1] + 0.3);
        if (fl > -Infinity && d[o + 1] < fl + 0.02) { d[o + 1] = fl + 0.02; d[o + 4] *= -0.25; d[o + 3] *= 0.5; d[o + 5] *= 0.5; }
      }
      if (k === 1) order.push(i);
      else {
        const t = 1 - d[o + 6] / d[o + 7];
        const size = d[o + 8] + (d[o + 9] - d[o + 8]) * t;
        const a = d[o + 13] * (1 - t * t);
        const x = d[o], y = d[o + 1], z = d[o + 2];
        if (k === 3) {
          // streak aligned to velocity
          const vx = d[o + 3], vy = d[o + 4], vz = d[o + 5], sp = Math.hypot(vx, vy, vz) || 1;
          const l = Math.min(0.5, sp * 0.03) + size;
          const tx = (vx / sp) * l, ty = (vy / sp) * l, tz = (vz / sp) * l;
          // side vector = dir × (cam - p)
          let sx = ty * (cam.z - z) - tz * (cam.y - y), sy = tz * (cam.x - x) - tx * (cam.z - z), sz = tx * (cam.y - y) - ty * (cam.x - x);
          const sl = Math.hypot(sx, sy, sz) || 1; sx = (sx / sl) * size; sy = (sy / sl) * size; sz = (sz / sl) * size;
          this.add.quad(x - sx, y - sy, z - sz, x + sx, y + sy, z + sz, x + tx + sx, y + ty + sy, z + tz + sz, x + tx - sx, y + ty - sy, z + tz - sz, 0.3, 0.3, 0.7, 0.7, d[o + 10], d[o + 11], d[o + 12], a);
        } else {
          const rx = R.x * size, ry = R.y * size, rz = R.z * size, ux = U.x * size, uy = U.y * size, uz = U.z * size;
          this.add.quad(x - rx - ux, y - ry - uy, z - rz - uz, x + rx - ux, y + ry - uy, z + rz - uz, x + rx + ux, y + ry + uy, z + rz + uz, x - rx + ux, y - ry + uy, z - rz + uz, 0, 0, 1, 1, d[o + 10], d[o + 11], d[o + 12], a);
        }
      }
    }
    // tracers (additive streaks travelling along the shot)
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt * 320;
      if (t.t > t.len) { this.tracers.splice(i, 1); continue; }
      const head = t.t, tail = Math.max(0, head - Math.min(14, t.len * 0.5));
      const hx = t.x + t.dx * head, hy = t.y + t.dy * head, hz = t.z + t.dz * head;
      const tx = t.x + t.dx * tail, ty = t.y + t.dy * tail, tz = t.z + t.dz * tail;
      const dist = Math.hypot(hx - cam.x, hy - cam.y, hz - cam.z);
      const w = 0.012 + dist * 0.0022;
      let sx = t.dy * (cam.z - hz) - t.dz * (cam.y - hy), sy = t.dz * (cam.x - hx) - t.dx * (cam.z - hz), sz = t.dx * (cam.y - hy) - t.dy * (cam.x - hx);
      const sl = Math.hypot(sx, sy, sz) || 1; sx = (sx / sl) * w; sy = (sy / sl) * w; sz = (sz / sl) * w;
      this.add.quad(tx - sx, ty - sy, tz - sz, tx + sx, ty + sy, tz + sz, hx + sx, hy + sy, hz + sz, hx - sx, hy - sy, hz - sz, 0.35, 0.35, 0.65, 0.65, 255, 226, 160, t.own ? 150 : 210);
    }
    this.add.end();

    // alpha particles: back-to-front
    const fx = camE.forward;
    order.sort((p, q) => {
      const dp = (d[p * STRIDE] - cam.x) * fx.x + (d[p * STRIDE + 1] - cam.y) * fx.y + (d[p * STRIDE + 2] - cam.z) * fx.z;
      const dq = (d[q * STRIDE] - cam.x) * fx.x + (d[q * STRIDE + 1] - cam.y) * fx.y + (d[q * STRIDE + 2] - cam.z) * fx.z;
      return dq - dp;
    });
    this.alpha.begin();
    for (const i of order) {
      const o = i * STRIDE;
      const t = 1 - d[o + 6] / d[o + 7];
      const size = d[o + 8] + (d[o + 9] - d[o + 8]) * Math.sqrt(t);
      const fadeIn = Math.min(1, t * 8);
      const a = d[o + 13] * fadeIn * (1 - t) * (1 - t * 0.3);
      const x = d[o], y = d[o + 1], z = d[o + 2];
      const rx = R.x * size, ry = R.y * size, rz = R.z * size, ux = U.x * size, uy = U.y * size, uz = U.z * size;
      this.alpha.quad(x - rx - ux, y - ry - uy, z - rz - uz, x + rx - ux, y + ry - uy, z + rz - uz, x + rx + ux, y + ry + uy, z + rz + uz, x - rx + ux, y - ry + uy, z - rz + uz, 0, 0, 1, 1, d[o + 10], d[o + 11], d[o + 12], a);
    }
    // shell casings
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life -= dt;
      if (s.life <= 0) { this.shells.splice(i, 1); continue; }
      s.vy -= 9.8 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < s.floor) { s.y = s.floor; s.vy = Math.abs(s.vy) * 0.35; s.vx *= 0.5; s.vz *= 0.5; }
      s.spin += dt * 20;
      const l = 0.016, w = 0.006, c = Math.cos(s.spin), sn = Math.sin(s.spin);
      const ax = R.x * c * l + U.x * sn * l, ay = R.y * c * l + U.y * sn * l, az = R.z * c * l + U.z * sn * l;
      const bx = -R.x * sn * w + U.x * c * w, by = -R.y * sn * w + U.y * c * w, bz = -R.z * sn * w + U.z * c * w;
      this.alpha.quad(s.x - ax - bx, s.y - ay - by, s.z - az - bz, s.x + ax - bx, s.y + ay - by, s.z + az - bz, s.x + ax + bx, s.y + ay + by, s.z + az + bz, s.x - ax + bx, s.y - ay + by, s.z - az + bz, 0.42, 0.42, 0.58, 0.58, 205, 160, 70, 255);
    }
    this.alpha.end();

    // light flashes
    for (const f of this.flashes) {
      const l = f.e.light as pc.LightComponent;
      if (f.t > 0) { f.t -= dt; l.intensity = Math.max(0, f.base * Math.min(1, f.t / 0.06)); if (f.t <= 0) { l.intensity = 0; l.range = 9; } }
    }

    // decals (rebuilt only when changed)
    if (this.decalsDirty) {
      this.decalsDirty = false;
      this.decals.begin();
      for (const q of this.decalList) {
        // tangent frame
        let tx = 0, ty = 1, tz = 0;
        if (Math.abs(q.ny) > 0.9) { tx = 1; ty = 0; }
        let bx = q.ny * tz - q.nz * ty, by = q.nz * tx - q.nx * tz, bz = q.nx * ty - q.ny * tx;
        const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
        tx = by * q.nz - bz * q.ny; ty = bz * q.nx - bx * q.nz; tz = bx * q.ny - by * q.nx;
        const c = Math.cos(q.rot) * q.size, s = Math.sin(q.rot) * q.size;
        const ux = tx * c + bx * s, uy = ty * c + by * s, uz = tz * c + bz * s;
        const vx = -tx * s + bx * c, vy = -ty * s + by * c, vz = -tz * s + bz * c;
        const u0 = q.tile === 0 ? 0 : 0.5, u1 = u0 + 0.5;
        this.decals.quad(q.x - ux - vx, q.y - uy - vy, q.z - uz - vz, q.x + ux - vx, q.y + uy - vy, q.z + uz - vz, q.x + ux + vx, q.y + uy + vy, q.z + uz + vz, q.x - ux + vx, q.y - uy + vy, q.z - uz + vz,
          u0, 0.25, u1, 0.75, 255, 255, 255, 235);
      }
      this.decals.end();
    }
    void F_SOLID;
  }
}
