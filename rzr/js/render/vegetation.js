// Vegetation & props: streamed per 64 m cell around the camera, deterministic (hash
// seeded), driven by the baked forest / rock / wetness masks.
//  - near trees: instanced procedural conifers (scanned bark + twig materials)
//  - far trees: impostor billboards baked at load from the same trees (8 views each)
//  - rocks, logs, stumps, roots, ferns, shrubs: decimated Poly Haven scans, instanced
//  - grass: GPU-placed clumps around the camera (no CPU cost per frame)
//  - colliders for trunks, boulders and logs near the vehicle
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildConifer, makeTreeMaterials } from './trees.js';
import { HEIGHT_GLSL } from './glsl.js';
import { FOG_GLSL, atmoUniforms, ATMO } from './atmosphere.js';
import { hash2 } from '../world/heightfield.js';
import { assetUrl } from '../util.js';

const CELL = 64;
const texLoader = new THREE.TextureLoader();
const T = (url, srgb) => { const t = texLoader.load(url); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const TREE_VARIANTS = [
  ['spruce', 101, 24], ['spruce', 102, 30], ['spruce', 103, 18],
  ['fir', 201, 26], ['fir', 202, 20],
  ['pine', 301, 22], ['pine', 302, 17], ['pine', 303, 26],
  ['larch', 401, 21], ['larch', 402, 16],
];
const VIEWS = 8, CELL_W = 256, CELL_H = 512;

const IMPOSTOR_VS = /* glsl */`
attribute vec4 inst;   // x, y, z, yaw
attribute vec4 inst2;  // width, height, variant row, tint
uniform float uRows;
varying vec2 vUv; varying vec3 vW; varying float vTint; varying float vFade;
uniform vec3 uCam; uniform float uNear;
void main() {
  vec3 base = inst.xyz;
  vec3 toCam = uCam - base; toCam.y = 0.0;
  float d = length(toCam);
  toCam /= max(d, 1e-3);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 p = base + right * position.x * inst2.x + vec3(0.0, position.y * inst2.y, 0.0);
  // pick the baked view closest to the camera azimuth (relative to the tree's yaw)
  float ang = atan(toCam.x, toCam.z) - inst.w;
  float fi = mod(floor(ang / (6.2831853 / ${VIEWS}.0) + 0.5), ${VIEWS}.0);
  vUv = vec2((fi + position.x + 0.5) / ${VIEWS}.0, (inst2.z + position.y) / uRows);
  vW = p; vTint = inst2.w;
  vFade = smoothstep(uNear - 12.0, uNear + 4.0, d);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const IMPOSTOR_FS = /* glsl */`
${FOG_GLSL}
uniform sampler2D uAtlas;
uniform vec3 uSunCol, uAmb;
varying vec2 vUv; varying vec3 vW; varying float vTint; varying float vFade;
void main() {
  vec4 c = texture(uAtlas, vUv);
  // dithered cross-fade with the full-detail trees near the camera
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  if (c.a < 0.45 || n > vFade) discard;
  vec3 col = c.rgb * (uAmb + uSunCol * 0.55) * (0.85 + 0.3 * vTint);
  vec4 atm = atmosphere(cameraPosition, vW);
  col = mix(col, atm.rgb, atm.a);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Vegetation {
  constructor(game) {
    this.game = game;
    this.field = game.world.field;
    this.col = game.collision;
    this.q = game.quality;
    this.cells = new Map();
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.lastBuild = new THREE.Vector3(1e9, 0, 0);
    this.lastCol = new THREE.Vector3(1e9, 0, 0);
    this.nearR = 75 * Math.sqrt(this.q.trees);
    this.farR = this.q.treeDist;
    this.time = 0;
    // keep clearings around the spawn, buildings and route junctions
    const m = game.world.meta;
    this.clear = [[m.spawn.x, m.spawn.z, 55], ...m.buildings.map(b => [b.x, b.z, Math.max(b.w, b.d) + 10]), ...Object.values(m.nodes).map(([x, z]) => [x, z, 14])];
  }
  // nearest spot with no trunk or boulder within ~4.5 m (used by teleports / map clicks)
  clearSpot(x, z) {
    for (let r = 0; r < 60; r += 3) for (let a = 0; a < (r ? 12 : 1); a++) {
      const px = x + Math.cos(a / 12 * Math.PI * 2) * r, pz = z + Math.sin(a / 12 * Math.PI * 2) * r;
      const cell = this._cell(Math.floor(px / CELL), Math.floor(pz / CELL));
      const near = [...cell.trees, ...cell.props.filter(p => p.kind === 'moss' || p.kind === 'pebble' || p.kind === 'cliff')];
      let ok = true;
      for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
        if (!ok) break;
        const c = this._cell(Math.floor(px / CELL) + dx, Math.floor(pz / CELL) + dz);
        for (const t of [...c.trees, ...c.props]) if (!t.small && Math.hypot(t.x - px, t.z - pz) < 4.5 + (t.kind === 'cliff' ? 6 : 0)) { ok = false; break; }
      }
      if (ok && near) return [px, pz];
    }
    return [x, z];
  }
  _blocked(x, z) { for (const [cx, cz, r] of this.clear) if (Math.abs(x - cx) < r && Math.abs(z - cz) < r && Math.hypot(x - cx, z - cz) < r) return true; return false; }

  async init(progress) {
    const g = this.game;
    progress?.('Growing forests…');
    const tx = (s) => ({
      bark: T(`assets/textures/${s}_bark_diff.jpg`, true), barkNor: T(`assets/textures/${s}_bark_nor.jpg`), barkArm: T(`assets/textures/${s}_bark_arm.jpg`),
      twig: T(`assets/textures/${s}_twig.webp`, true), twigNor: T(`assets/textures/${s}_twig_nor.jpg`),
    });
    const textures = { fir: tx('fir'), pine: tx('pine') };
    for (const k of ['fir', 'pine']) for (const t of [textures[k].twig, textures[k].twigNor]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    this.treeMats = makeTreeMaterials(textures, g.weatherUniform);
    // the impostor bake needs the twig atlases decoded
    await Promise.all([textures.fir.twig, textures.pine.twig, textures.fir.bark, textures.pine.bark].map(t => new Promise(r => {
      const t0 = performance.now();
      const iv = setInterval(() => { if (t.image || performance.now() - t0 > 20000) { clearInterval(iv); r(); } }, 30);
    })));

    // tree variants -> instanced meshes
    this.variants = TREE_VARIANTS.map(([sp, seed, h], i) => {
      const t = buildConifer(sp, seed, h);
      const m = this.treeMats[sp === 'pine' || sp === 'larch' ? (sp === 'larch' ? 'fir' : 'pine') : 'fir'];
      const barkM = sp === 'pine' || sp === 'larch' ? this.treeMats.pine.bark : this.treeMats.fir.bark;
      const trunk = new THREE.InstancedMesh(t.trunk, barkM, 2000);
      const cards = new THREE.InstancedMesh(t.cards, m.twig, 2000);
      for (const im of [trunk, cards]) { im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; this.group.add(im); }
      if (t.tint) { cards.material = m.twig.clone(); cards.material.color.multiply(new THREE.Color(...t.tint)); cards.material.onBeforeCompile = m.twig.onBeforeCompile; }
      return { ...t, i, trunkMesh: trunk, cardMesh: cards, list: [] };
    });
    this._bakeImpostors();
    progress?.('Placing rocks…');
    await this._loadProps();
    this._initGrass();
  }

  _bakeImpostors() {
    const r = this.game.renderer;
    const rows = this.variants.length;
    const rt = new THREE.WebGLRenderTarget(CELL_W * VIEWS, CELL_H * rows, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.SRGBColorSpace });
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x55503a, 1.25));
    const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(0.3, 1, 0.5); scene.add(d);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const prevTarget = r.getRenderTarget(), prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const prevShadow = r.shadowMap.enabled;
    r.shadowMap.enabled = false;
    r.setRenderTarget(rt);
    r.setClearColor(0x40482e, 0); r.clear();
    const prevTone = r.toneMapping; r.toneMapping = THREE.NoToneMapping;
    for (const v of this.variants) {
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(v.trunk, v.trunkMesh.material), new THREE.Mesh(v.cards, v.cardMesh.material));
      scene.add(grp);
      const w = v.radius * 2.3 + 1, h = v.height * 1.04;
      v.impW = w; v.impH = h;
      cam.left = -w / 2; cam.right = w / 2; cam.top = h; cam.bottom = 0; cam.updateProjectionMatrix();
      for (let k = 0; k < VIEWS; k++) {
        const a = k / VIEWS * Math.PI * 2;
        cam.position.set(Math.sin(a) * 80, 0, Math.cos(a) * 80);
        cam.lookAt(0, 0, 0);
        rt.viewport.set(k * CELL_W, v.i * CELL_H, CELL_W, CELL_H);
        rt.scissor.set(k * CELL_W, v.i * CELL_H, CELL_W, CELL_H);
        rt.scissorTest = true;
        r.setRenderTarget(rt);
        r.render(scene, cam);
      }
      scene.remove(grp);
    }
    rt.scissorTest = false;
    r.toneMapping = prevTone;
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    r.shadowMap.enabled = prevShadow;
    this.atlas = rt.texture;
    // instanced impostor quads
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.impMax = 90000;
    this.impInst = new THREE.InstancedBufferAttribute(new Float32Array(this.impMax * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.impInst2 = new THREE.InstancedBufferAttribute(new Float32Array(this.impMax * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('inst', this.impInst); g.setAttribute('inst2', this.impInst2);
    g.instanceCount = 0;
    this.impUniforms = { ...atmoUniforms, uAtlas: { value: this.atlas }, uRows: { value: rows }, uCam: { value: new THREE.Vector3() }, uNear: { value: this.nearR }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() } };
    this.impostors = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.impUniforms, vertexShader: IMPOSTOR_VS, fragmentShader: IMPOSTOR_FS }));
    this.impostors.frustumCulled = false;
    this.group.add(this.impostors);
    this.impGeo = g;
  }

  async _loadProps() {
    const loader = new GLTFLoader();
    const load = async (name) => { try { return (await loader.loadAsync(assetUrl(`assets/models/${name}.glb`))).scene; } catch (e) { console.warn('prop', name, e); return null; } };
    const names = ['rock_moss_set_01', 'rock_moss_set_02', 'rock_07', 'rock_09', 'stone_01', 'rock_face_01', 'mountainside', 'dead_tree_trunk', 'dead_tree_trunk_02', 'tree_stump_01', 'tree_stump_02', 'pine_roots', 'dry_branches_medium_01', 'fern_02', 'shrub_03', 'shrub_04'];
    const scenes = await Promise.all(names.map(load));
    this.props = {};
    names.forEach((n, i) => {
      const sc = scenes[i]; if (!sc) return;
      sc.updateMatrixWorld(true);
      const parts = [];
      sc.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
        geo.computeBoundingBox();
        const bb = geo.boundingBox, c = bb.getCenter(new THREE.Vector3());
        geo.translate(-c.x, -bb.min.y, -c.z);  // centred, sitting on y = 0
        geo.computeBoundingBox(); geo.computeBoundingSphere();
        const size = geo.boundingBox.getSize(new THREE.Vector3());
        const mat = o.material;
        if (mat.map) mat.map.anisotropy = 4;
        if (mat.alphaTest > 0 || mat.transparent) { mat.transparent = false; mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; }
        const im = new THREE.InstancedMesh(geo, mat, 4000);
        im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
        this.group.add(im);
        parts.push({ mesh: im, size, list: [] });
      });
      this.props[n] = parts;
    });
    this.rockParts = [...(this.props.rock_moss_set_01 || []), ...(this.props.rock_moss_set_02 || [])];
    this.pebbleRocks = [...(this.props.rock_07 || []), ...(this.props.rock_09 || []), ...(this.props.stone_01 || [])];
  }

  // ------------------------------------------------------------------ placement
  _cell(cx, cz) {
    const key = cx * 4096 + cz;
    let c = this.cells.get(key);
    if (c) return c;
    c = { trees: [], props: [] };
    const f = this.field;
    if (!f.inCore(cx * CELL + CELL / 2, cz * CELL + CELL / 2, 20)) { this.cells.set(key, c); return c; }
    const SP = 4.3 / Math.sqrt(this.q.trees);
    const n = Math.floor(CELL / SP);
    for (let gz = 0; gz < n; gz++) for (let gx = 0; gx < n; gx++) {
      const ix = cx * n + gx, iz = cz * n + gz;
      const h1 = hash2(ix, iz), h2 = hash2(ix + 7777, iz - 333), h3 = hash2(ix - 91, iz + 5151);
      const x = cx * CELL + (gx + h1) * SP, z = cz * CELL + (gz + h2) * SP;
      const forest = f.mask(x, z, 2), road = f.mask(x, z, 4), water = f.mask(x, z, 5), rock = f.mask(x, z, 7), snow = f.mask(x, z, 3);
      if (road > 0.08 || water > 0.35 || rock > 0.7) continue;
      const y = f.baseHeight(x, z);
      if (f.waterLevel(x, z) > y - 0.5) continue;
      let p = Math.pow(forest, 1.15) * 0.9;
      if (y < 2150 && snow < 0.3) p += 0.006; // scattered lone trees
      if (h3 > p) continue;
      if (this._blocked(x, z)) continue;
      // slope check (cheap 2-tap)
      const sx = f.baseHeight(x + 2, z) - y, sz = f.baseHeight(x, z + 2) - y;
      if (Math.hypot(sx, sz) / 2 > 0.95) continue;
      const hv = hash2(ix * 3 + 1, iz * 5 + 2);
      let v;
      if (y < 1720) v = hv < 0.45 ? 5 + Math.floor(hv * 6) % 3 : hv < 0.85 ? Math.floor(hv * 13) % 3 : 3 + (Math.floor(hv * 17) % 2);
      else if (y < 2030) v = hv < 0.5 ? Math.floor(hv * 13) % 3 : hv < 0.8 ? 3 + (Math.floor(hv * 17) % 2) : 8 + (Math.floor(hv * 19) % 2);
      else v = hv < 0.55 ? 8 + (Math.floor(hv * 19) % 2) : 5 + Math.floor(hv * 6) % 3;
      const alt = 1 - smooth(1950, 2280, y) * 0.55;
      const s = (0.62 + 0.55 * hash2(ix + 13, iz + 17)) * alt;
      const yaw = hash2(ix + 5, iz + 9) * Math.PI * 2;
      c.trees.push({ x, y: y - 0.15, z, s, yaw, v, tint: hash2(ix + 2, iz + 4) });
    }
    // rocks & ground props
    const RS = 9;
    const m = Math.floor(CELL / RS);
    for (let gz = 0; gz < m; gz++) for (let gx = 0; gx < m; gx++) {
      const ix = cx * m + gx + 50000, iz = cz * m + gz + 50000;
      const x = cx * CELL + (gx + hash2(ix, iz)) * RS, z = cz * CELL + (gz + hash2(iz, ix)) * RS;
      const rock = f.mask(x, z, 7), sed = f.mask(x, z, 1), water = f.mask(x, z, 5), forest = f.mask(x, z, 2), road = f.mask(x, z, 4), wet = f.mask(x, z, 0);
      if (road > 0.15 || this._blocked(x, z)) continue;
      const y = f.baseHeight(x, z);
      const pr = hash2(ix + 3, iz + 8);
      const rockGarden = Math.hypot(x - 2830, z - 1300) < 650 ? 0.35 : 0;
      const pRock = 0.025 + rock * 0.22 + sed * 0.25 + water * 0.12 + rockGarden;
      if (pr < pRock) {
        const big = hash2(ix + 1, iz + 1);
        const type = big < 0.04 && rock > 0.4 ? 'cliff' : big < 0.75 ? 'moss' : 'pebble';
        const size = type === 'cliff' ? 1 : type === 'moss' ? 0.4 + 1.2 * hash2(ix + 9, iz) ** 2 * (1 + rockGarden * 2) : 3 + 14 * hash2(ix, iz + 9) ** 2 * (1 + rockGarden * 2);
        c.props.push({ kind: type, x, y, z, s: size, yaw: hash2(ix + 4, iz + 4) * 6.283, k: Math.floor(hash2(ix + 6, iz + 2) * 64) });
        continue;
      }
      if (forest > 0.4 && pr < pRock + forest * 0.09) {
        const kinds = ['dead_tree_trunk_02', 'tree_stump_01', 'tree_stump_02', 'pine_roots', 'dry_branches_medium_01', 'dead_tree_trunk'];
        c.props.push({ kind: kinds[Math.floor(hash2(ix + 2, iz + 7) * kinds.length)], x, y, z, s: 0.8 + 0.5 * hash2(ix, iz + 3), yaw: hash2(ix + 4, iz + 4) * 6.283 });
        continue;
      }
      if (pr < pRock + 0.25 * (forest * 0.6 + wet * 0.5) && y < 2200) {
        c.props.push({ kind: hash2(ix + 3, iz + 3) < 0.6 ? 'fern_02' : (hash2(ix, iz) < 0.5 ? 'shrub_03' : 'shrub_04'), x, y, z, s: 0.8 + 0.7 * hash2(ix + 1, iz + 2), yaw: hash2(ix + 4, iz + 4) * 6.283, small: true });
      }
    }
    // small stones scattered through meadows, along streams and on scree (visual only)
    const SS = 3.4, ms = Math.floor(CELL / SS);
    for (let gz = 0; gz < ms; gz++) for (let gx = 0; gx < ms; gx++) {
      const ix = cx * ms + gx + 90000, iz = cz * ms + gz + 90000;
      const x = cx * CELL + (gx + hash2(ix, iz)) * SS, z = cz * CELL + (gz + hash2(iz, ix)) * SS;
      const road = f.mask(x, z, 4); if (road > 0.35) continue;
      const pr = hash2(ix + 7, iz + 1);
      const p = 0.07 + f.mask(x, z, 7) * 0.35 + f.mask(x, z, 1) * 0.3 + f.mask(x, z, 5) * 0.35 - f.mask(x, z, 2) * 0.05;
      if (pr > p) continue;
      if (f.waterLevel(x, z) > f.baseHeight(x, z) + 0.3) continue;
      c.props.push({ kind: 'pebble', x, y: f.baseHeight(x, z), z, s: 0.6 + 1.6 * hash2(ix + 2, iz + 9) ** 2, yaw: hash2(ix + 4, iz + 4) * 6.283, k: Math.floor(hash2(ix + 6, iz + 2) * 64), small: true });
    }
    this.cells.set(key, c);
    if (this.cells.size > 9000) { const it = this.cells.keys(); for (let i = 0; i < 1500; i++) this.cells.delete(it.next().value); }
    return c;
  }

  _rebuild(cam, far = true) {
    // far impostors only need refreshing every ~70 m; near trees/props every ~22 m
    const nearR = this.nearR, propR = 420, smallR = 85;
    const R = far ? this.farR : Math.max(propR, nearR) + CELL;
    const c0x = Math.floor(cam.x / CELL), c0z = Math.floor(cam.z / CELL), cr = Math.ceil(R / CELL);
    for (const v of this.variants) v.list.length = 0;
    for (const parts of Object.values(this.props)) for (const p of parts) p.list.length = 0;
    let nImp = 0;
    const I1 = this.impInst.array, I2 = this.impInst2.array;
    const impOn = far;
    for (let dz = -cr; dz <= cr; dz++) for (let dx = -cr; dx <= cr; dx++) {
      const cx = c0x + dx, cz = c0z + dz;
      const ccx = cx * CELL + CELL / 2, ccz = cz * CELL + CELL / 2;
      const dc = Math.hypot(ccx - cam.x, ccz - cam.z);
      if (dc > R + CELL) continue;
      const cell = this._cell(cx, cz);
      const thin = dc > 900 ? 2 : 1;
      for (let i = 0; i < cell.trees.length; i += (dc > 1300 ? 3 : thin)) {
        const t = cell.trees[i];
        const d = Math.hypot(t.x - cam.x, t.z - cam.z);
        if (d > R) continue;
        if (d < nearR) this.variants[t.v].list.push(t);
        if (impOn && d > nearR - 90 && nImp < this.impMax) { // shader dithers out anything inside the live near radius
          const v = this.variants[t.v], o = nImp * 4;
          I1[o] = t.x; I1[o + 1] = t.y; I1[o + 2] = t.z; I1[o + 3] = t.yaw;
          I2[o] = v.impW * t.s; I2[o + 1] = v.impH * t.s; I2[o + 2] = v.i; I2[o + 3] = t.tint;
          nImp++;
        }
      }
      if (dc > propR + CELL) continue;
      for (const p of cell.props) {
        const d = Math.hypot(p.x - cam.x, p.z - cam.z);
        if (p.small ? d > smallR : d > propR) continue;
        let parts;
        if (p.kind === 'moss') parts = [this.rockParts[p.k % this.rockParts.length]];
        else if (p.kind === 'pebble') parts = [this.pebbleRocks[p.k % this.pebbleRocks.length]];
        else if (p.kind === 'cliff') parts = this.props[p.k % 2 ? 'rock_face_01' : 'mountainside'];
        else parts = this.props[p.kind];
        if (!parts) continue;
        for (const part of parts) if (part) part.list.push(p);
      }
    }
    if (impOn) {
      this.impGeo.instanceCount = nImp;
      this.impInst.needsUpdate = true; this.impInst2.needsUpdate = true;
      this.impostorCenter = cam.clone();
    }
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (const v of this.variants) {
      const n = Math.min(v.list.length, 2000);
      for (let i = 0; i < n; i++) {
        const t = v.list[i];
        Q.setFromAxisAngle(Y, t.yaw); S.setScalar(t.s); P.set(t.x, t.y, t.z);
        M.compose(P, Q, S);
        v.trunkMesh.setMatrixAt(i, M); v.cardMesh.setMatrixAt(i, M);
      }
      v.trunkMesh.count = v.cardMesh.count = n;
      v.trunkMesh.instanceMatrix.needsUpdate = v.cardMesh.instanceMatrix.needsUpdate = true;
    }
    for (const parts of Object.values(this.props)) for (const part of parts) {
      if (!part) continue;
      const n = Math.min(part.list.length, 4000);
      for (let i = 0; i < n; i++) {
        const p = part.list[i];
        // scale props to their intended real size
        let s = p.s;
        if (p.kind === 'moss') s = p.s;                                 // ~2 m rocks scaled 0.4-1.6
        else if (p.kind === 'pebble') s = p.s * 1.0 / Math.max(0.05, part.size.x) * 0.35;
        Q.setFromAxisAngle(Y, p.yaw); S.setScalar(s);
        const sink = p.kind === 'moss' || p.kind === 'pebble' ? part.size.y * s * 0.28 : 0.05;
        P.set(p.x, p.y - sink, p.z);
        M.compose(P, Q, S);
        part.mesh.setMatrixAt(i, M);
      }
      part.mesh.count = n;
      part.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _rebuildColliders(pos) {
    this.col.removeWhere(o => o.veg);
    const R = 90;
    const c0x = Math.floor(pos.x / CELL), c0z = Math.floor(pos.z / CELL);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const cell = this._cell(c0x + dx, c0z + dz);
      for (const t of cell.trees) {
        if (Math.hypot(t.x - pos.x, t.z - pos.z) > R) continue;
        const v = this.variants[t.v];
        this.col.add({ type: 'cyl', x: t.x, y: t.y, z: t.z, r: v.trunkR * t.s * 1.1 + 0.08, h: v.height * t.s, veg: 1 });
      }
      for (const p of cell.props) {
        if (Math.hypot(p.x - pos.x, p.z - pos.z) > R) continue;
        if (p.kind === 'moss' && p.s > 0.55) this.col.add({ type: 'sphere', x: p.x, y: p.y + 0.15 * p.s, z: p.z, r: 0.95 * p.s, veg: 1 });
        else if (p.kind === 'pebble') { const r = p.s * 0.16; if (r > 0.35) this.col.add({ type: 'sphere', x: p.x, y: p.y + r * 0.25, z: p.z, r, veg: 1 }); }
        else if (p.kind === 'cliff') this.col.add({ type: 'sphere', x: p.x, y: p.y + 1.5, z: p.z, r: 3.6, veg: 1 });
        else if (p.kind === 'dead_tree_trunk_02') this.col.add({ type: 'box', x: p.x, y: p.y - 0.2, z: p.z, hx: 2.0 * p.s, hz: 0.5 * p.s, hy: 0.9 * p.s, rot: p.yaw, veg: 1 });
        else if (p.kind === 'tree_stump_01' || p.kind === 'tree_stump_02') this.col.add({ type: 'cyl', x: p.x, y: p.y, z: p.z, r: 0.5 * p.s, h: 0.5 * p.s, veg: 1 });
      }
    }
  }

  // ------------------------------------------------------------------ grass
  _initGrass() {
    const g = this.game, q = this.q;
    const R = 44 + 20 * Math.min(1.4, q.grass), SP = 0.5 / Math.sqrt(Math.min(1.4, q.grass));
    const N = Math.floor(2 * R / SP);
    this.grassR = R; this.grassSP = SP;
    const geo = new THREE.InstancedBufferGeometry();
    // 3 crossed cards
    const pos = [], uv = [], idx = [];
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI / 3, c = Math.cos(a) * 0.5, s = Math.sin(a) * 0.5;
      const b = pos.length / 3;
      pos.push(-c, 0, -s, c, 0, s, c, 1, s, -c, 1, -s);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const offs = new Float32Array(N * N * 2);
    let k = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { offs[k++] = i; offs[k++] = j; }
    geo.setAttribute('cell', new THREE.InstancedBufferAttribute(offs, 2));
    geo.instanceCount = N * N;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const atlas = T('assets/textures/grass_clumps.webp', true);
    atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 });
    const uni = { ...this.game.terrain.uniforms, uGrassOrigin: { value: new THREE.Vector2() }, uGrassSP: { value: SP }, uGrassN: { value: N }, uGrassR: { value: R }, uTimeG: { value: 0 }, uWindG: { value: 1 }, uCar: { value: new THREE.Vector3(1e6, 0, 0) } };
    this.grassUniforms = uni;
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, uni);
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
        ${HEIGHT_GLSL}
        attribute vec2 cell;
        uniform vec2 uGrassOrigin; uniform float uGrassSP, uGrassN, uGrassR, uTimeG, uWindG;
        uniform vec3 uCamPos; uniform sampler2D uNormCore; uniform vec3 uCar;
        varying float vGTint; varying float vGFlower; varying vec2 vGUv0; varying float vGH;`)
        .replace('#include <uv_vertex>', '#include <uv_vertex>')
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `
        vec2 gp = uGrassOrigin + cell * uGrassSP;
        ivec2 gi = ivec2(floor(gp / uGrassSP + 0.5) + 20000.0);
        float h1 = hash2(gi.x, gi.y), h2 = hash2(gi.x + 71, gi.y - 13), h3 = hash2(gi.x - 5, gi.y + 37), h4 = hash2(gi.x + 3, gi.y + 3);
        vec2 wp = gp + (vec2(h1, h2) - 0.5) * uGrassSP * 1.6;
        float d = length(wp - uCamPos.xz);
        vec4 ma = texture(uMaskA, maskUV(wp)), mb = texture(uMaskB, maskUV(wp));
        float dens = (1.0 - mb.r * 1.4) * (1.0 - mb.g * 1.3) * (1.0 - ma.a * 1.2) * (1.0 - mb.a * 1.1) * (1.0 - ma.b * 0.55);
        vec4 nn = texture(uNormCore, ((wp + CORE_HALF) / CORE_CELL + 0.5) / float(CORE_N));
        float slope = 1.0 - (nn.y * 2.0 - 1.0);
        dens *= (1.0 - smoothstep(0.18, 0.32, slope)) * (1.0 - ma.g * 0.8 * smoothstep(0.05, 0.16, slope));
        float hgt = terrainHeight(wp);
        dens *= 1.0 - smoothstep(2350.0, 2650.0, hgt);
        float fade = 1.0 - smoothstep(uGrassR * 0.7, uGrassR, d);
        float sc = (h3 < dens ? 1.0 : 0.0) * fade * (0.55 + 0.7 * h4) * (1.0 - smoothstep(2150.0, 2500.0, hgt) * 0.5);
        sc *= smoothstep(1.3, 2.4, length(wp - uCar.xz));   // no grass poking through the car
        float yaw = h1 * 6.2831853;
        vec3 lp = position;
        lp.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * lp.xz;
        lp *= vec3(1.05, 0.45 + 0.42 * h2 + 0.25 * h3, 1.05) * sc;
        vGH = position.y;
        // wind: bend tips
        float tip = position.y;
        lp.x += sin(uTimeG * 1.7 + wp.x * 0.35 + wp.y * 0.2) * 0.12 * tip * uWindG * sc;
        lp.z += cos(uTimeG * 1.3 + wp.y * 0.31) * 0.08 * tip * uWindG * sc;
        vec3 transformed = vec3(wp.x, hgt - 0.03, wp.y) + lp;
        // atlas: 5 clumps in the cropped strip (image coords -> uv)
        int ci = int(h2 * 5.0);
        vec4 R4 = ci == 0 ? vec4(0.2, 0.06, 0.49, 0.5) : ci == 1 ? vec4(0.59, 0.06, 0.79, 0.46) : ci == 2 ? vec4(0.02, 0.6, 0.2, 0.94) : ci == 3 ? vec4(0.25, 0.6, 0.49, 0.94) : vec4(0.58, 0.6, 0.8, 0.96);
        vGUv0 = vec2(mix(R4.x, R4.z, uv.x), 1.0 - mix(R4.w, R4.y, uv.y));
        vGTint = h4;
        vGFlower = (h1 < mb.b * 0.12) ? fract(h2 * 7.0) + 0.01 : 0.0;`)
        .replace('#include <uv_vertex>', '');
      s.vertexShader = s.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vMapUv = vGUv0;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGTint; varying float vGFlower; varying float vGH;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb *= mix(vec3(0.6, 0.84, 0.42), vec3(0.92, 1.0, 0.58), vGTint);
          diffuseColor.rgb *= mix(0.42, 1.08, smoothstep(0.0, 0.85, vGH));   // dense clumps are dark at the root
          if (vGFlower > 0.0 && vMapUv.y > 0.0) {
            vec3 fc = vGFlower < 0.3 ? vec3(1.0, 0.85, 0.15) : vGFlower < 0.55 ? vec3(0.95, 0.95, 0.9) : vGFlower < 0.8 ? vec3(0.55, 0.35, 0.85) : vec3(0.3, 0.45, 0.95);
            // small flower heads: sparse dots near the blade tips only
            float tipZone = smoothstep(0.8, 0.95, fract(vMapUv.y * 4.0));
            float dots = step(0.82, fract(sin(floor(vMapUv.x * 60.0) * 91.7 + floor(vMapUv.y * 40.0) * 13.1) * 437.5));
            diffuseColor.rgb = mix(diffuseColor.rgb, fc * 0.85, tipZone * dots * 0.8);
          }`)
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.22 * vGH; // light through the blades');
    };
    mat.customProgramCacheKey = () => 'gpu-grass';
    this.grass = new THREE.Mesh(geo, mat);
    this.grass.frustumCulled = false;
    this.grass.receiveShadow = true;
    this.group.add(this.grass);
  }

  update(dt, game) {
    this.time += dt;
    const cam = game.camera.position;
    if (cam.distanceTo(this.lastBuild) > 22) {
      const far = !this.lastFar || cam.distanceTo(this.lastFar) > 70;
      this._rebuild(cam, far);
      this.lastBuild.copy(cam);
      if (far) this.lastFar = cam.clone();
    }
    const vp = game.phys.pos;
    if (vp.distanceTo(this.lastCol) > 18) { this._rebuildColliders(vp); this.lastCol.copy(vp); }
    const wind = ATMO.misc.w || 0.6;
    for (const k of ['fir', 'pine']) for (const m of [this.treeMats[k].bark, this.treeMats[k].twig]) {
      const s = m.userData.shader; if (s) { s.uniforms.uTimeT.value = this.time; s.uniforms.uWind.value = wind; }
    }
    for (const v of this.variants) { const s = v.cardMesh.material.userData.shader; if (s) { s.uniforms.uTimeT.value = this.time; s.uniforms.uWind.value = wind; } }
    this.impUniforms.uCam.value.copy(cam);
    const sun = game.sky.sun;
    this.impUniforms.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity * 0.32);
    this.impUniforms.uAmb.value.copy(game.sky.hemi.color).multiplyScalar(game.sky.hemi.intensity * 0.9);
    const gu = this.grassUniforms;
    gu.uGrassOrigin.value.set(Math.floor((cam.x - this.grassR) / this.grassSP) * this.grassSP, Math.floor((cam.z - this.grassR) / this.grassSP) * this.grassSP);
    gu.uTimeG.value = this.time; gu.uWindG.value = wind; gu.uCar.value.copy(game.phys.pos);
  }
}

export async function create(game, progress) {
  const v = new Vegetation(game);
  await v.init(progress);
  v._rebuild(game.camera.position);
  v._rebuildColliders(game.phys.pos);
  return v;
}
