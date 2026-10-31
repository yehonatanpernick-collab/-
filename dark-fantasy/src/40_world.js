
// =====================================================================
// Geometry baking helpers (keep draw calls low)
// =====================================================================
function prepGeo(m, matrix) {
  let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
  g.applyMatrix4(matrix);
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}
// merge sibling meshes (per material) inside every group — pivots stay animatable
function bake(root) {
  const groups = []; root.traverse(o => { if (!o.isMesh) groups.push(o); });
  for (const g of groups) {
    const byMat = new Map();
    for (const c of g.children) {
      if (!c.isMesh || c.children.length || c.userData.keep) continue;
      if (!byMat.has(c.material)) byMat.set(c.material, []);
      byMat.get(c.material).push(c);
    }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const merged = mergeGeometries(list.map(m => { m.updateMatrix(); return prepGeo(m, m.matrix); }));
      if (!merged) continue;
      const mm = new THREE.Mesh(merged, mat); mm.castShadow = list.some(m => m.castShadow); mm.receiveShadow = true; g.add(mm);
      list.forEach(m => g.remove(m));
    }
  }
  return root;
}
// flatten a static object into one mesh per material
function flatten(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), byMat = new Map();
  root.traverse(o => { if (o.isMesh) { if (!byMat.has(o.material)) byMat.set(o.material, []); byMat.get(o.material).push(prepGeo(o, new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld))); } });
  const out = new THREE.Group(); out.position.copy(root.position); out.quaternion.copy(root.quaternion); out.scale.copy(root.scale);
  for (const [mat, geos] of byMat) { const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = m.receiveShadow = true; out.add(m); }
  return out;
}

// =====================================================================
// Layout
// =====================================================================
const WORLD_R = 100;
const POND = new V3(41.5, 0, -6.3), POND_R = 14, WATER_Y = -0.9;
const GRAVEYARD = new V3(-31, 0, 29);
const SHRINE_COUNT = 5;
const SHRINE_ANG = [0.55, 1.85, 3.05, 4.25, 5.45], SHRINE_RAD = [60, 66, 57, 70, 62];
const shrinePos = SHRINE_ANG.map((a, i) => new V3(Math.cos(a) * SHRINE_RAD[i], 0, Math.sin(a) * SHRINE_RAD[i]));
const THRONE = new V3(0, 0, -3.2);

function heightAt(x, z) {
  const r = Math.hypot(x, z);
  let h = (fbm(x * 0.018 + 3, z * 0.018) - 0.5) * 16 + (fbm(x * 0.09, z * 0.09) - 0.5) * 1.4;
  h *= ss(12, 34, r);
  h += Math.max(0, r - 104) * 0.5 + Math.pow(Math.max(0, r - 125) * 0.12, 2) * 4;
  const dp = Math.hypot(x - POND.x, z - POND.z);
  h = lerp(h, -2.4, ss(POND_R + 6, POND_R - 7, dp));
  return h;
}

// winding dirt roads from the plaza to every shrine
const paths = shrinePos.map((s, i) => {
  const pts = [], dir = s.clone().normalize(), perp = new V3(-dir.z, 0, dir.x), amp = (i % 2 ? 1 : -1) * R(5, 8);
  for (let k = 0; k <= 32; k++) { const t = k / 32; pts.push(s.clone().multiplyScalar(t).addScaledVector(perp, Math.sin(t * Math.PI) * amp * ss(0.05, 0.3, t))); }
  return pts;
});
function pathDist(x, z) {
  let md = 1e9;
  for (const p of paths) for (let k = 0; k < p.length - 1; k++) {
    const a = p[k], b = p[k + 1], abx = b.x - a.x, abz = b.z - a.z;
    const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
    const d = Math.hypot(x - a.x - abx * t, z - a.z - abz * t); if (d < md) md = d;
  }
  return md;
}
function clearSpot(x, z, pad = 0) {
  if (Math.hypot(x, z) < 19 + pad) return false;
  for (const s of shrinePos) if (Math.hypot(x - s.x, z - s.z) < 8 + pad) return false;
  if (Math.hypot(x - POND.x, z - POND.z) < POND_R + 1 + pad) return false;
  return true;
}

const colliders = [];
const addCollider = (x, z, r) => colliders.push({ x, z, r });
addCollider(POND.x, POND.z, POND_R - 3.5);

// =====================================================================
// Materials
// =====================================================================
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.92, map: stoneTex, normalMap: stoneN, normalScale: new V2(1.6, 1.6) });
const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x45413e, roughness: 0.86, map: stoneTex, normalMap: stoneN, normalScale: new V2(2, 2) });
const mossStoneMat = new THREE.MeshStandardMaterial({ color: 0x55574a, roughness: 0.95, map: stoneTex, normalMap: stoneN, normalScale: new V2(2, 2) });
const barkMat = new THREE.MeshStandardMaterial({ color: 0x3a2f28, roughness: 1, map: withRepeat(barkTex, 2, 3), normalMap: withRepeat(barkN, 2, 3), normalScale: new V2(2.2, 2.2) });
const flagArr = genArray(256, (x, y) => { const [f1, f2] = worleyT(x / 64, y / 64, 4); return ss(0.0, 0.1, f2 - f1) * (0.7 + 0.3 * tileNoise(x / 16, y / 16, 16)) + 0.12 * tileNoise(x / 4, y / 4, 64); });
const plazaMat = new THREE.MeshStandardMaterial({ color: 0x77726b, roughness: 0.9, map: withRepeat(texFromArray(256, flagArr, true, (v) => { const k = 0.25 + v * 0.7; return [k, k * 0.97, k * 0.93]; }), 7, 7), normalMap: withRepeat(normalFromArray(256, flagArr, 5), 7, 7), normalScale: new V2(1.4, 1.4) });
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x7a756d, roughness: 0.9, map: withRepeat(stoneTex, 1, 3), normalMap: withRepeat(stoneN, 1, 3), normalScale: new V2(1.5, 1.5) });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: 0.95, map: withRepeat(barkTex, 1, 2), normalMap: withRepeat(barkN, 1, 2) });
const ironMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2e, roughness: 0.55, metalness: 0.85, map: grimeTex, roughnessMap: scratchTex });

// =====================================================================
// Terrain
// =====================================================================
{
  const SIZE = 400, SEG = LOW ? 160 : 220;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, cols = new Float32Array(pos.count * 3);
  const C = (h) => new THREE.Color(h);
  const cGrass = C(0x3a3322), cDirt = C(0x4a3424), cAsh = C(0x5e5249), cPath = C(0x5c4230), cMud = C(0x1a120c), cBlood = C(0x4e1d14), cStone = C(0x5a4f46), t = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, heightAt(x, z));
    const n = fbm(x * 0.045 + 10, z * 0.045), n2 = fbm(x * 0.13, z * 0.13 + 5), n3 = fbm(x * 0.03 - 40, z * 0.03 + 9);
    t.copy(cGrass).lerp(cDirt, ss(0.36, 0.62, n)).lerp(cAsh, ss(0.58, 0.78, n2) * 0.65).lerp(cBlood, ss(0.64, 0.76, n3) * 0.5);
    const r = Math.hypot(x, z);
    if (r < 110) { const pd = pathDist(x, z); t.lerp(cPath, ss(3.2, 1.0, pd + (n2 - 0.5) * 1.5) * 0.9); }
    t.lerp(cStone, ss(18, 12, r) * 0.8);
    t.lerp(cMud, ss(POND_R + 5, POND_R - 1, Math.hypot(x - POND.x, z - POND.z)));
    t.multiplyScalar(0.82 + hash2(x, z) * 0.3);
    cols[i * 3] = t.r; cols[i * 3 + 1] = t.g; cols[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, map: withRepeat(groundTex, 75, 75), normalMap: withRepeat(groundN, 75, 75), normalScale: new V2(1.0, 1.0), envMapIntensity: 0.5 });
  const ground = new THREE.Mesh(g, mat); ground.receiveShadow = true; scene.add(ground);
}

// =====================================================================
// Horizon: two mountain ridges and the castle of Valdren against the moon
// =====================================================================
{
  const ridge = (rad, hMin, hMax, col, seed) => {
    const N = 220, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = i / N * TAU, n = fbm(Math.cos(a) * 3 + seed, Math.sin(a) * 3 + seed, 5);
      const h = hMin + Math.pow(n, 1.6) * (hMax - hMin) * 1.8;
      pos.push(Math.cos(a) * rad, -20, Math.sin(a) * rad, Math.cos(a) * rad, h, Math.sin(a) * rad);
      if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, fog: false, side: THREE.DoubleSide })); m.renderOrder = -9; scene.add(m);
  };
  ridge(560, 18, 70, new THREE.Color().setRGB(0.05, 0.045, 0.048), 3);
  ridge(380, 8, 34, new THREE.Color().setRGB(0.022, 0.02, 0.022), 11);

  const castle = new THREE.Group(), cm = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.012, 0.01, 0.011), fog: false });
  const win = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.9, 0.35), fog: false });
  const add = (geo, x, y, z, m = cm) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); castle.add(o); return o; };
  add(new THREE.ConeGeometry(70, 46, 7), 0, 5, 0);                    // the crag
  add(new THREE.BoxGeometry(46, 22, 26), 0, 36, 0);                   // keep
  add(new THREE.BoxGeometry(66, 9, 20), 0, 30, 8);                    // curtain wall
  const towers = [[-26, 0, 12, 6, 48], [24, 0, 12, 5, 40], [-8, -6, 0, 7, 66], [10, -2, -4, 4.5, 56], [34, 0, 4, 3.5, 34], [-38, 0, 6, 3.5, 30]];
  for (const [x, , z, r, h] of towers) {
    add(new THREE.CylinderGeometry(r, r * 1.1, h, 10), x, 26 + h / 2, z);
    add(new THREE.ConeGeometry(r * 1.35, r * 3.2, 10), x, 26 + h + r * 1.6, z);
    for (let k = 0; k < 3; k++) if (rand() < 0.6) add(new THREE.PlaneGeometry(0.9, 1.6), x + R(-r * 0.5, r * 0.5), 30 + R(0, h - 6), z + r + 0.2, win);
  }
  add(new THREE.BoxGeometry(2, 30, 2), -8, 26 + 66 + 14, 0).rotation.z = 0.06;  // broken spire
  for (let k = 0; k < 14; k++) add(new THREE.PlaneGeometry(0.8, 1.4), R(-20, 20), R(30, 44), 13.2, win);
  const hd = new V3(moonDir.x, 0, moonDir.z).normalize();
  castle.position.copy(hd).multiplyScalar(330).setY(-4); castle.lookAt(0, -4, 0);
  castle.scale.setScalar(1.05);
  castle.traverse(o => { if (o.isMesh) o.renderOrder = -8; });
  scene.add(castle);
}

// =====================================================================
// Dead trees (instanced variants)
// =====================================================================
function makeTreeGeo(seed, gnarl = 1) {
  const r = mulberry32(seed), geos = [], q = new THREE.Quaternion(), m = new THREE.Matrix4();
  function seg(start, dir, len, rad, depth) {
    const g = new THREE.CylinderGeometry(rad * 0.7, rad, len, depth > 3 ? 8 : 5, 2);
    g.translate(0, len / 2, 0); q.setFromUnitVectors(UP, dir); m.compose(start, q, ONE); g.applyMatrix4(m); geos.push(g);
    const end = start.clone().addScaledVector(dir, len * 0.97);
    if (depth === 0) return;
    const cont = dir.clone().add(new V3((r() - .5) * .8 * gnarl, (r() - .25) * .25, (r() - .5) * .8 * gnarl)).normalize();
    seg(end, cont, len * 0.8, rad * 0.7, depth - 1);
    if (depth < 6 && r() < 0.92) seg(end, dir.clone().add(new V3((r() - .5) * 2.6, r() * .35 - .05, (r() - .5) * 2.6)).normalize(), len * 0.72, rad * 0.58, depth - 1);
    if (depth < 4 && r() < 0.5) seg(end, dir.clone().add(new V3((r() - .5) * 3, -0.15, (r() - .5) * 3)).normalize(), len * 0.55, rad * 0.45, Math.max(0, depth - 2));
  }
  seg(new V3(0, -0.6, 0), new V3((r() - .5) * .25, 1, (r() - .5) * .25).normalize(), 2.3, 0.45, 7);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU + r(), g = new THREE.ConeGeometry(0.22, 1.9, 5); g.translate(0, 0.95, 0);
    q.setFromUnitVectors(UP, new V3(Math.cos(a), -0.35, Math.sin(a)).normalize().negate());
    m.compose(new V3(Math.cos(a) * 1.25, -0.1, Math.sin(a) * 1.25), q, ONE); g.applyMatrix4(m); geos.push(g);
  }
  return mergeGeometries(geos.map(g => g.toNonIndexed()));
}
{
  const VARIANTS = 8, lists = Array.from({ length: VARIANTS }, () => []);
  let placed = 0, tries = 0;
  while (placed < (LOW ? 120 : 165) && tries < 8000) {
    tries++;
    const a = rand() * TAU, r = Math.sqrt(rand()) * 120 + 10, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!clearSpot(x, z, 1) || Math.hypot(x - GRAVEYARD.x, z - GRAVEYARD.z) < 15 || pathDist(x, z) < 3.8) continue;
    let ok = true; for (const c of colliders) if (Math.hypot(c.x - x, c.z - z) < 4.5) { ok = false; break; }
    if (!ok) continue;
    const s = R(0.95, 1.8) * (rand() < 0.08 ? 1.6 : 1);
    lists[placed % VARIANTS].push(new THREE.Matrix4().compose(new V3(x, heightAt(x, z) - 0.25, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(R(-.07, .07), rand() * TAU, R(-.07, .07))), new V3(s, s * R(0.9, 1.25), s)));
    if (r < WORLD_R + 3) addCollider(x, z, 0.55 * s);
    placed++;
  }
  for (let v = 0; v < VARIANTS; v++) {
    const im = new THREE.InstancedMesh(makeTreeGeo(100 + v * 31, v % 3 === 0 ? 1.6 : 1), barkMat, lists[v].length);
    lists[v].forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = im.receiveShadow = true; scene.add(im);
  }
}

// =====================================================================
// Rocks
// =====================================================================
{
  const base = new THREE.IcosahedronGeometry(1, 3), p = base.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new V3().fromBufferAttribute(p, i);
    v.multiplyScalar(0.72 + 0.55 * fbm(v.x * 1.6 + 5, v.z * 1.6 + v.y * 1.3, 3)); v.y *= 0.68;
    if (v.y > 0.25) v.y = 0.25 + (v.y - 0.25) * 0.4;   // flattened, weathered tops
    p.setXYZ(i, v.x, v.y, v.z);
  }
  base.computeVertexNormals();
  const N = 130, im = new THREE.InstancedMesh(base, mossStoneMat, N);
  for (let i = 0; i < N; i++) {
    let x, z; do { const a = rand() * TAU, r = R(13, 118); x = Math.cos(a) * r; z = Math.sin(a) * r; } while (!clearSpot(x, z, -4) || pathDist(x, z) < 2.2);
    const s = rand() < 0.15 ? R(1.6, 3.2) : R(0.3, 1.1);
    im.setMatrixAt(i, new THREE.Matrix4().compose(new V3(x, heightAt(x, z) - s * 0.2, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(R(-.3, .3), rand() * 3, R(-.3, .3))), new V3(s * R(.8, 1.4), s, s * R(.8, 1.3))));
    if (s > 1) addCollider(x, z, s * 0.9);
  }
  im.castShadow = im.receiveShadow = true; scene.add(im);
}

// =====================================================================
// Dead grass + pond reeds (wind animated)
// =====================================================================
const windU = { value: 0 };
let grassMesh = null, grassTotal = 0;
{
  const H = 0.8, blade = new THREE.PlaneGeometry(0.1, H, 1, 4); blade.translate(0, H / 2, 0);
  const bp = blade.attributes.position, bc = new Float32Array(bp.count * 3);
  for (let k = 0; k < bp.count; k++) { const t = bp.getY(k) / H; bp.setX(k, bp.getX(k) * (1 - t * 0.92)); bp.setZ(k, t * t * 0.2); const v = 0.28 + t * 0.9; bc.set([v, v, v], k * 3); }
  blade.setAttribute('color', new THREE.BufferAttribute(bc, 3)); blade.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, vertexColors: true, side: THREE.DoubleSide, envMapIntensity: 0.3 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windU;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      float hh = position.y * position.y;
      float w = sin(uWind * 1.7 + ip.x * 0.3 + ip.y * 0.2) * 0.5 + sin(uWind * 3.9 + ip.x * 1.3) * 0.14;
      transformed.x += w * hh * 0.35; transformed.z += w * hh * 0.2;`);
  };
  const N = Q.grass, im = new THREE.InstancedMesh(blade, mat, N), c = new THREE.Color(), d = new THREE.Object3D();
  let i = 0, guard = 0;
  while (i < N && guard++ < 200000) {
    const reed = rand() < 0.08;
    let cx, cz;
    if (reed) { const a = rand() * TAU, rr = R(POND_R - 3, POND_R + 2); cx = POND.x + Math.cos(a) * rr; cz = POND.z + Math.sin(a) * rr; }
    else {
      const a = rand() * TAU, r = Math.sqrt(rand()) * 112; cx = Math.cos(a) * r; cz = Math.sin(a) * r;
      if (r < 16.5 || fbm(cx * 0.08, cz * 0.08) < 0.36 || pathDist(cx, cz) < 1.5 || Math.hypot(cx - POND.x, cz - POND.z) < POND_R - 2) continue;
    }
    const n = reed ? RI(10, 20) : RI(8, 22), hue = R(0.06, 0.12);
    for (let k = 0; k < n && i < N; k++) {
      const x = cx + R(-0.9, 0.9), z = cz + R(-0.9, 0.9), y = heightAt(x, z);
      if (reed && y < WATER_Y - 0.6) continue;
      d.position.set(x, y - 0.04, z); d.rotation.set(R(-.35, .35), rand() * TAU, R(-.35, .35));
      const s = R(0.6, 1.5); d.scale.set(s, s * (reed ? R(1.8, 2.8) : R(0.7, 1.4)), s); d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
      if (reed) c.setHSL(R(0.12, 0.17), R(0.15, 0.3), R(0.07, 0.12)); else c.setHSL(hue + R(-0.03, 0.01), R(0.35, 0.55), R(0.13, 0.23));
      im.setColorAt(i, c); i++;
    }
  }
  im.count = i; grassMesh = im; grassTotal = i; im.receiveShadow = true; scene.add(im);
}

// =====================================================================
// Pond
// =====================================================================
const rippleN = normalFromArray(128, genArray(128, (x, y) => tileFbm(x / 16, y / 16, 8, 3)), 3);
rippleN.repeat.set(6, 6);
{
  const water = new THREE.Mesh(new THREE.CircleGeometry(POND_R + 5, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.05, metalness: 0.9, normalMap: rippleN, normalScale: new V2(0.18, 0.18), envMapIntensity: 1.3 }));
  water.position.set(POND.x, WATER_Y, POND.z); water.receiveShadow = true; scene.add(water);
}

// =====================================================================
// Candles (instanced) — light the graves, the shrines and the throne
// =====================================================================
const candleSpots = [];
function addCandles(x, z, n, spread, yOff = 0) { for (let i = 0; i < n; i++) { const cx = x + R(-spread, spread), cz = z + R(-spread, spread); candleSpots.push(new V3(cx, (yOff || heightAt(cx, cz)), cz)); } }

// =====================================================================
// Graveyard, crypt, open graves
// =====================================================================
{
  const head = new THREE.BoxGeometry(0.75, 1.0, 0.18); head.translate(0, 0.5, 0);
  const top = new THREE.CylinderGeometry(0.375, 0.375, 0.18, 16, 1, false, 0, Math.PI); top.rotateX(Math.PI / 2); top.rotateZ(Math.PI / 2); top.translate(0, 1.0, 0);
  const tomb = mergeGeometries([head.toNonIndexed(), top.toNonIndexed()]);
  const v1 = new THREE.BoxGeometry(0.14, 1.5, 0.14); v1.translate(0, 0.75, 0);
  const v2 = new THREE.BoxGeometry(0.75, 0.14, 0.14); v2.translate(0, 1.1, 0);
  const cross = mergeGeometries([v1, v2]);
  const slab = new THREE.BoxGeometry(0.9, 0.25, 2.0); slab.translate(0, 0.1, 0);
  const lists = { tomb: [], cross: [], slab: [] };
  const place = (x, z, rotY, kind) => {
    const s = R(0.85, 1.3);
    lists[kind].push(new THREE.Matrix4().compose(new V3(x, heightAt(x, z) - 0.1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(R(-.2, .2), rotY + R(-.25, .25), R(-.2, .2))), new V3(s, s, s)));
  };
  const ca = Math.cos(-0.6), sa = Math.sin(-0.6), toW = (x, z) => [GRAVEYARD.x + x * ca - z * sa, GRAVEYARD.z + x * sa + z * ca];
  for (let row = 0; row < 6; row++) for (let col = 0; col < 7; col++) {
    if (rand() < 0.18) continue;
    const [x, z] = toW(-9 + col * 3 + R(-.4, .4), -6 + row * 2.8 + R(-.3, .3));
    place(x, z, 0.6, rand() < 0.35 ? 'cross' : 'tomb');
    if (rand() < 0.3) { const [sx, sz] = toW(-9 + col * 3, -6 + row * 2.8 + 1.1); place(sx, sz, 0.6, 'slab'); }
    if (rand() < 0.22) addCandles(x, z, RI(1, 3), 0.35);
  }
  for (let i = 0; i < 70; i++) { const a = rand() * TAU, r = R(18, 100), x = Math.cos(a) * r, z = Math.sin(a) * r; if (clearSpot(x, z, -2) && pathDist(x, z) > 2) place(x, z, rand() * TAU, rand() < 0.35 ? 'cross' : 'tomb'); }
  for (const [k, geo] of [['tomb', tomb], ['cross', cross], ['slab', slab]]) {
    const im = new THREE.InstancedMesh(geo, mossStoneMat, lists[k].length); lists[k].forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = im.receiveShadow = true; scene.add(im);
  }
  // fence
  const postG = new THREE.CylinderGeometry(0.035, 0.035, 1.7, 5); postG.translate(0, 0.85, 0);
  const spike = new THREE.ConeGeometry(0.07, 0.22, 4); spike.translate(0, 1.8, 0);
  const post = mergeGeometries([postG, spike]), posts = [];
  for (let i = 0; i < 130; i++) {
    const t = i / 130, w = 26, h = 22; let x, z;
    if (t < .25) { x = -w / 2 + t * 4 * w; z = -h / 2; } else if (t < .5) { x = w / 2; z = -h / 2 + (t - .25) * 4 * h; } else if (t < .75) { x = w / 2 - (t - .5) * 4 * w; z = h / 2; } else { x = -w / 2; z = h / 2 - (t - .75) * 4 * h; }
    if (rand() < 0.12 || (t > 0.06 && t < 0.13)) continue;
    const [X, Z] = toW(x, z);
    posts.push(new THREE.Matrix4().compose(new V3(X, heightAt(X, Z) - 0.1, Z), new THREE.Quaternion().setFromEuler(new THREE.Euler(R(-.15, .15), 0, R(-.15, .15))), ONE));
  }
  const pim = new THREE.InstancedMesh(post, ironMat, posts.length); posts.forEach((m, i) => pim.setMatrixAt(i, m)); pim.castShadow = true; scene.add(pim);
  // the crypt
  const crypt = new THREE.Group(); const [cx, cz] = toW(0, -15.5); crypt.position.set(cx, heightAt(cx, cz) - 0.3, cz); crypt.rotation.y = 0.6 + Math.PI;
  addMesh(crypt, new THREE.BoxGeometry(6, 0.6, 8), darkStoneMat, 0, 0.3, 0);
  addMesh(crypt, new THREE.BoxGeometry(5, 3.6, 6.5), stoneMat, 0, 2.3, -0.4);
  const prism = new THREE.Shape(); prism.moveTo(-3.1, 0); prism.lineTo(3.1, 0); prism.lineTo(0, 2.2); prism.closePath();
  const roof = addMesh(crypt, new THREE.ExtrudeGeometry(prism, { depth: 7.4, bevelEnabled: false }), darkStoneMat, 0, 4.1, -4.1);
  for (const s of [-1, 1]) { addMesh(crypt, new THREE.CylinderGeometry(0.28, 0.32, 3.6, 12), stoneMat, s * 1.9, 2.3, 3.2); }
  addMesh(crypt, new THREE.BoxGeometry(5, 0.5, 1.2), stoneMat, 0, 4.35, 3.2);
  addMesh(crypt, new THREE.BoxGeometry(1.6, 2.6, 0.1), new THREE.MeshBasicMaterial({ color: 0x020202 }), 0, 1.9, 2.86, false);
  addMesh(crypt, new THREE.BoxGeometry(0.9, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.15, 0.05) }), 0, 3.3, 2.9, false);
  for (const s of [-1, 1]) { const st = addMesh(crypt, new THREE.BoxGeometry(1.2, 1.4, 1.2), darkStoneMat, s * 2.4, 0.9, 3.6); addMesh(crypt, new THREE.SphereGeometry(0.45, 10, 8), darkStoneMat, s * 2.4, 1.95, 3.6); }
  crypt.updateMatrixWorld(true);
  scene.add(flatten(crypt));
  addCollider(cx, cz, 4.2);
  addCandles(cx + 3.5, cz + 2, 5, 0.9);
}

// =====================================================================
// Plaza: ring wall with arched gates, pillars, banners, braziers, the throne
// =====================================================================
const WALL_R = 15.5;
const gateAngles = shrinePos.map((s, i) => { const p = paths[i]; let best = 0; for (const q of p) if (Math.abs(Math.hypot(q.x, q.z) - WALL_R) < Math.abs(Math.hypot(p[best].x, p[best].z) - WALL_R)) best = p.indexOf(q); return Math.atan2(p[best].z, p[best].x); });
{
  const brick = new THREE.BoxGeometry(0.88, 0.42, 0.62);
  const mats = [], q = new THREE.Quaternion(), e = new THREE.Euler();
  const pushBrick = (pos, rotY, jitter = 0.04, s = 1) => {
    e.set(R(-jitter, jitter), rotY + R(-jitter, jitter), R(-jitter, jitter)); q.setFromEuler(e);
    mats.push(new THREE.Matrix4().compose(pos, q, new V3(s * R(0.92, 1.05), s * R(0.9, 1.08), s)));
  };
  const step = 0.9 / WALL_R;
  const nearGate = (a) => { let m = 9; for (const g of gateAngles) m = Math.min(m, Math.abs(angDiff(a, g))); return m; };
  for (let a = 0; a < TAU; a += step) {
    const ng = nearGate(a);
    if (ng < 0.17) continue;
    let rows = Math.floor(clamp((fbm(a * 2.2, 3.3, 3) * 1.8 - 0.35) * 12, 0, 10));
    if (ng < 0.3) rows = 10;                     // gate pillars always stand
    const x = Math.cos(a) * WALL_R, z = Math.sin(a) * WALL_R, gy = heightAt(x, z) - 0.1;
    for (let row = 0; row < rows; row++) {
      if (rand() < 0.05 * Q.bricks + (row > 6 ? 0.1 : 0) && ng > 0.3) continue;
      const aa = a + (row % 2) * step / 2;
      pushBrick(new V3(Math.cos(aa) * WALL_R, gy + 0.21 + row * 0.43, Math.sin(aa) * WALL_R), -aa + Math.PI / 2);
    }
    if (rows > 0) addCollider(x, z, 0.62);
    if (rows < 4 && rand() < 0.6 * Q.bricks) for (let k = 0; k < 3; k++) { const ra = a + R(-0.05, 0.05), rr = WALL_R + R(-1.8, 1.8); pushBrick(new V3(Math.cos(ra) * rr, heightAt(Math.cos(ra) * rr, Math.sin(ra) * rr) + 0.12, Math.sin(ra) * rr), rand() * TAU, 0.5); }
  }
  // arches over the gates
  for (const g of gateAngles) {
    const A = new V3(Math.cos(g - 0.17 - step) * WALL_R, 0, Math.sin(g - 0.17 - step) * WALL_R), B = new V3(Math.cos(g + 0.17 + step) * WALL_R, 0, Math.sin(g + 0.17 + step) * WALL_R);
    const M = A.clone().add(B).multiplyScalar(0.5), span = B.clone().sub(A), rad = span.length() / 2; span.normalize();
    const n = new V3().crossVectors(span, UP), base = heightAt(M.x, M.z) + 0.21 + 10 * 0.43 - 0.2;
    const N = Math.round(Math.PI * rad / 0.5);
    for (let k = 0; k <= N; k++) {
      if (rand() < 0.07) continue;
      const ph = k / N * Math.PI, t = span.clone().multiplyScalar(-Math.sin(ph)).addScaledVector(UP, Math.cos(ph)).normalize();
      const pos = M.clone().addScaledVector(span, -Math.cos(ph) * rad).addScaledVector(UP, Math.sin(ph) * rad * 0.9 + base);
      const m = new THREE.Matrix4().makeBasis(t, new V3().crossVectors(n, t).normalize(), n);
      m.setPosition(pos); mats.push(m.multiply(new THREE.Matrix4().makeScale(0.6, 1, 1)));
    }
    const key = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.75), darkStoneMat); key.position.copy(M).setY(base + rad * 0.9 + 0.2); key.lookAt(0, key.position.y, 0); key.castShadow = true; scene.add(key);
  }
  const im = new THREE.InstancedMesh(brick, stoneMat, mats.length); mats.forEach((m, i) => im.setMatrixAt(i, m));
  im.castShadow = im.receiveShadow = true; scene.add(im);
}

// banners
const bannerGeo = (() => {
  const g = new THREE.PlaneGeometry(0.85, 3.4, 4, 18); g.translate(0, -1.7, 0);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); if (y < -3.0) p.setY(i, y + Math.abs(x) * 0.9 - 0.25 + hash2(x * 31, 7) * 0.25); }
  g.computeVertexNormals(); return g;
})();
const bannerMat = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#3c0a0c'; x.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.3})`; x.fillRect(Math.random() * 128, Math.random() * 512, 1, Math.random() * 8); }
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(30,20,15,${Math.random() * 0.5})`; x.beginPath(); x.arc(Math.random() * 128, 300 + Math.random() * 212, Math.random() * 18, 0, TAU); x.fill(); }
  x.fillStyle = '#b9ab8e'; // bone-white sigil: a crown pierced by a sword
  x.beginPath(); x.moveTo(36, 190); x.lineTo(30, 136); x.lineTo(48, 160); x.lineTo(64, 118); x.lineTo(80, 160); x.lineTo(98, 136); x.lineTo(92, 190); x.closePath(); x.fill();
  x.fillRect(60, 90, 8, 200); x.fillRect(44, 104, 40, 6);
  x.beginPath(); x.moveTo(60, 290); x.lineTo(68, 290); x.lineTo(64, 310); x.fill();
  x.strokeStyle = '#7d6f58'; x.lineWidth = 2; x.strokeRect(8, 6, 112, 480);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, side: THREE.DoubleSide, alphaMap: tatterAlpha(64, 256, 0.9, 10, 9), alphaTest: 0.5, envMapIntensity: 0.3 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windU;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float wt = clamp(-position.y / 3.4, 0.0, 1.0);
      transformed.z += (sin(uWind * 2.1 + position.y * 1.6 + modelMatrix[3][0]) * 0.22 + sin(uWind * 4.3 + position.y * 3.1) * 0.05) * wt;
      transformed.x += sin(uWind * 1.5 + position.y * 1.1 + modelMatrix[3][2]) * 0.06 * wt;`);
  };
  return m;
})();

{
  const plaza = new THREE.Group();
  addMesh(plaza, new THREE.CylinderGeometry(10.5, 11.2, 0.6, 56), plazaMat, 0, 0.05, 0);
  // flagstone seams: a ring of slightly darker slabs
  for (let i = 0; i < 26; i++) { const a = i / 26 * TAU, r = R(11.5, 13.8); const s = addMesh(plaza, new THREE.BoxGeometry(R(1, 2), 0.25, R(1, 1.8)), darkStoneMat, Math.cos(a) * r, heightAt(Math.cos(a) * r, Math.sin(a) * r) + 0.02, Math.sin(a) * r); s.rotation.set(R(-.08, .08), rand() * 3, R(-.08, .08)); }
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = i / N * TAU, r = 8.4, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const broken = rand() < 0.4, h = broken ? R(1.6, 4.2) : 7.5;
    addMesh(plaza, new THREE.BoxGeometry(1.5, 0.6, 1.5), stoneMat, x, 0.65, z);
    addMesh(plaza, new THREE.BoxGeometry(1.25, 0.25, 1.25), darkStoneMat, x, 1.05, z);
    const col = addMesh(plaza, new THREE.CylinderGeometry(0.5, 0.56, h, 16, 4), pillarMat, x, 1.15 + h / 2, z);
    if (broken) { col.rotation.set(R(-.08, .08), 0, R(-.08, .08)); const ch = addMesh(plaza, new THREE.CylinderGeometry(0.5, 0.5, R(1.5, 2.6), 16), stoneMat, Math.cos(a + R(-.5, .5)) * (r + R(1.5, 3)), 0.75, Math.sin(a + R(-.5, .5)) * (r + R(1.5, 3))); ch.rotation.set(Math.PI / 2, 0, rand() * 3); }
    else {
      addMesh(plaza, new THREE.BoxGeometry(1.4, 0.5, 1.4), stoneMat, x, 1.15 + h + 0.25, z);
      const ban = new THREE.Mesh(bannerGeo, bannerMat); ban.position.set(Math.cos(a) * (r + 0.72), 1.15 + h - 0.02, Math.sin(a) * (r + 0.72)); ban.rotation.y = Math.PI / 2 - a; ban.castShadow = true; scene.add(ban);
    }
    addCollider(x, z, 0.95);
  }
  // braziers
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + Math.PI / 4, x = Math.cos(a) * 6, z = Math.sin(a) * 6;
    addMesh(plaza, new THREE.CylinderGeometry(0.08, 0.14, 1.6, 8), ironMat, x, 1.15, z);
    for (let k = 0; k < 3; k++) { const l = addMesh(plaza, new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5), ironMat, x + Math.cos(k * 2.1) * 0.25, 0.75, z + Math.sin(k * 2.1) * 0.25); l.rotation.set(Math.sin(k * 2.1) * 0.4, 0, -Math.cos(k * 2.1) * 0.4); }
    const bowl = addMesh(plaza, new THREE.LatheGeometry([new V2(0.05, 0), new V2(0.3, 0.05), new V2(0.55, 0.32), new V2(0.6, 0.4)], 16), ironMat, x, 1.95, z); bowl.material = ironMat;
    addMesh(plaza, new THREE.CircleGeometry(0.5, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 0.7, 0.12) }), x, 2.3, z, false);
    const L = new THREE.PointLight(0xff7a30, 22, 28, 2); L.position.set(x, 2.9, z); scene.add(L);
    flames.push(Object.assign(new Flame(new V3(x, 2.3, z), FIRE_ORANGE, 50, 0.32), { light: L, base: 22 }));
    addCollider(x, z, 0.5);
  }
  // the throne of Valdren
  const th = new THREE.Group(); th.position.copy(THRONE); plaza.add(th);
  addMesh(th, new THREE.BoxGeometry(5.5, 0.5, 4.6), darkStoneMat, 0, 0.6, 0);
  addMesh(th, new THREE.BoxGeometry(4.4, 0.5, 3.6), darkStoneMat, 0, 1.1, -0.3);
  addMesh(th, new THREE.BoxGeometry(2.9, 1.0, 1.8), stoneMat, 0, 1.85, -0.8);          // seat
  addMesh(th, new THREE.BoxGeometry(3.1, 5.6, 0.7), stoneMat, 0, 4.4, -1.95);          // back
  const tip = new THREE.Shape(); tip.moveTo(-1.55, 0); tip.lineTo(1.55, 0); tip.lineTo(0.6, 1.0); tip.lineTo(0, 2.3); tip.lineTo(-0.6, 1.0); tip.closePath();
  addMesh(th, new THREE.ExtrudeGeometry(tip, { depth: 0.7, bevelEnabled: false }), stoneMat, 0, 7.2, -2.3);
  for (const s of [-1, 1]) {
    addMesh(th, new THREE.BoxGeometry(0.5, 1.6, 1.9), stoneMat, s * 1.6, 2.15, -0.75);
    addMesh(th, new THREE.SphereGeometry(0.32, 12, 10), darkStoneMat, s * 1.6, 3.05, 0.1);
    addMesh(th, new THREE.CylinderGeometry(0.35, 0.4, 6.6, 10), darkStoneMat, s * 1.85, 4.3, -2.0);
    addMesh(th, new THREE.ConeGeometry(0.42, 1.2, 10), darkStoneMat, s * 1.85, 8.2, -2.0);
  }
  plaza.updateMatrixWorld(true);
  scene.add(flatten(plaza));
  addCollider(THRONE.x, THRONE.z - 0.9, 2.2);
  addCandles(THRONE.x - 2.4, THRONE.z + 2.0, 7, 0.4, 0.86); addCandles(THRONE.x + 2.4, THRONE.z + 2.0, 7, 0.4, 0.86);
  addCandles(THRONE.x, THRONE.z + 2.9, 5, 1.6, 0.36);
}

// =====================================================================
// Beams (pierce the fog to guide the player)
// =====================================================================
function makeBeam(color, radius, height, opacity) {
  const geo = new THREE.CylinderGeometry(radius, radius * 0.5, height, 20, 1, true); geo.translate(0, height / 2, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uColor: { value: new THREE.Color(...color) }, uOpacity: { value: opacity }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 3.0);
        float fade = pow(1.0 - vUv.y, 2.4) * smoothstep(0.0, 0.015, vUv.y);
        float fl = 0.75 + 0.25 * sin(uTime * 2.0 - vUv.y * 70.0);
        gl_FragColor = vec4(uColor * f * fade * fl * uOpacity, 1.0); }`
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 4; return m;
}

// =====================================================================
// Shrines of the five soul-flames
// =====================================================================
const shrines = [];
for (const p of shrinePos) {
  const y = heightAt(p.x, p.z);
  const g = new THREE.Group(); g.position.set(p.x, y, p.z); g.rotation.y = Math.atan2(-p.x, -p.z);   // faces the plaza
  addMesh(g, new THREE.CylinderGeometry(3.4, 3.9, 0.6, 8), darkStoneMat, 0, 0.0, 0);
  addMesh(g, new THREE.CylinderGeometry(2.2, 2.5, 0.45, 8), stoneMat, 0, 0.5, 0);
  for (let k = 0; k < 3; k++) { const sTier = addMesh(g, new THREE.BoxGeometry(1.4 - k * 0.25, 0.45, 1.4 - k * 0.25), darkStoneMat, 0, 0.95 + k * 0.45, -0.6); sTier.rotation.y = Math.PI / 4; }
  const obel = addMesh(g, new THREE.CylinderGeometry(0.32, 0.62, 5.2, 4), darkStoneMat, 0, 4.4, -0.6); obel.rotation.y = Math.PI / 4;
  addMesh(g, new THREE.ConeGeometry(0.33, 0.8, 4), darkStoneMat, 0, 7.4, -0.6).rotation.y = Math.PI / 4;
  // stone bowl (the flame will burn here)
  addMesh(g, new THREE.CylinderGeometry(0.25, 0.35, 1.0, 10), stoneMat, 0, 1.2, 1.1);
  addMesh(g, new THREE.LatheGeometry([new V2(0.1, 0), new V2(0.55, 0.1), new V2(0.75, 0.35), new V2(0.78, 0.45), new V2(0.7, 0.45), new V2(0.5, 0.2)], 18), stoneMat, 0, 1.65, 1.1);
  // standing stones
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * TAU + 0.3, h = R(1.2, 2.6);
    const st = addMesh(g, new THREE.BoxGeometry(0.55, h, 0.4), mossStoneMat, Math.cos(a) * 4.3, h / 2 - 0.15, Math.sin(a) * 4.3); st.rotation.set(R(-.15, .15), -a, R(-.15, .15));
  }
  const runeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.08, 0.06) });
  for (let k = 0; k < 4; k++) for (let j = 0; j < 5; j++) {
    const a = k * Math.PI / 2, hh = 2.2 + j * 0.85, rr = lerp(0.48, 0.25, (hh - 1.8) / 5.2) + 0.02;
    const rm = addMesh(g, new THREE.BoxGeometry(j % 2 ? 0.26 : 0.06, j % 2 ? 0.05 : 0.28, 0.02), runeMat, Math.sin(a) * rr, hh, -0.6 + Math.cos(a) * rr, false);
    rm.rotation.y = a; rm.rotation.x = 0.06;
  }
  g.updateMatrixWorld(true);
  const flat = flatten(g); scene.add(flat);
  const bowlPos = new V3(0, 1.75, 1.1).applyMatrix4(g.matrixWorld);
  const light = new THREE.PointLight(0xff2a1a, 5, 14, 2); light.position.copy(bowlPos).add(new V3(0, 1, 0)); scene.add(light);
  const beam = makeBeam([0.9, 0.06, 0.05], 0.75, 170, 0.35); beam.position.copy(new V3(0, 0, -0.6).applyMatrix4(g.matrixWorld)); scene.add(beam);
  const flame = new Flame(bowlPos, FIRE_CURSED, 10, 0.3, 0.55); flames.push(flame);
  addCollider(p.x, p.z, 2.2);
  for (let k = 0; k < 8; k++) { const a = k / 8 * TAU, cx = p.x + Math.cos(a) * 2.9, cz = p.z + Math.sin(a) * 2.9; candleSpots.push(new V3(cx, heightAt(cx, cz) + 0.28, cz)); }
  shrines.push({ pos: new V3(p.x, y, p.z), bowl: bowlPos, lit: false, light, beam, runeMat, flame, lightTarget: 5 });
}

// =====================================================================
// Gallows with hanging cages
// =====================================================================
const cages = [];
{
  const spots = [[0, 0.55, 1], [2, 0.42, -1], [4, 0.68, 1], [1, 0.75, -1]];
  for (const [pi, t, side] of spots) {
    const p = paths[pi], k = Math.floor(t * (p.length - 1)), a = p[k], b = p[k + 1];
    const dir = b.clone().sub(a).normalize(), perp = new V3(-dir.z, 0, dir.x).multiplyScalar(side);
    const base = a.clone().addScaledVector(perp, 4.3); base.y = heightAt(base.x, base.z);
    const g = new THREE.Group(); g.position.copy(base); g.rotation.y = Math.atan2(-perp.x, -perp.z);
    addMesh(g, new THREE.BoxGeometry(0.28, 5.2, 0.28), woodMat, 0, 2.5, 0);
    addMesh(g, new THREE.BoxGeometry(0.22, 0.22, 2.4), woodMat, 0, 4.95, 1.0);
    const br = addMesh(g, new THREE.BoxGeometry(0.14, 1.3, 0.14), woodMat, 0, 4.4, 0.45); br.rotation.x = Math.PI / 4;
    addMesh(g, new THREE.BoxGeometry(0.8, 0.4, 0.8), darkStoneMat, 0, 0.1, 0);
    g.updateMatrixWorld(true); scene.add(flatten(g));
    // swinging cage
    const pivot = new THREE.Group(); pivot.position.copy(new V3(0, 4.85, 2.0).applyMatrix4(g.matrixWorld)); scene.add(pivot);
    for (let i = 0; i < 6; i++) { const l = addMesh(pivot, new THREE.TorusGeometry(0.06, 0.015, 4, 8), ironMat, 0, -0.1 - i * 0.1, 0); l.rotation.y = i % 2 ? Math.PI / 2 : 0; }
    const cage = new THREE.Group(); cage.position.y = -0.75; pivot.add(cage);
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; addMesh(cage, new THREE.CylinderGeometry(0.018, 0.018, 1.5, 4), ironMat, Math.cos(a) * 0.45, -0.85, Math.sin(a) * 0.45); }
    for (const yy of [-0.1, -1.6]) { const ring = addMesh(cage, new THREE.TorusGeometry(0.45, 0.025, 4, 20), ironMat, 0, yy, 0); ring.rotation.x = Math.PI / 2; }
    addMesh(cage, new THREE.ConeGeometry(0.47, 0.35, 10, 1, true), ironMat, 0, 0.07, 0);
    addMesh(cage, new THREE.CircleGeometry(0.45, 12).rotateX(-Math.PI / 2), ironMat, 0, -1.6, 0);
    const sk = makeSkeleton(boneMat, new THREE.Color(0, 0, 0));
    sk.root.scale.setScalar(0.8); sk.root.position.y = -1.6 - 0.42 * 0.8; cage.add(sk.root);
    sk.legs.forEach(l => { l.th.rotation.x = -1.5; l.kn.rotation.x = 1.6; });
    sk.chest.rotation.x = 0.5; sk.neck.rotation.x = 0.7; sk.skull.jaw.rotation.x = 0.4;
    sk.arms.forEach(a => { a.sh.rotation.x = -0.6; a.el.rotation.x = -1.2; });
    cage.updateMatrixWorld(true);
    const flatSk = flatten(sk.root); cage.remove(sk.root); cage.add(flatSk);
    bake(pivot);
    cages.push({ pivot, ph: rand() * TAU });
    addCollider(base.x, base.z, 0.4);
  }
}

// =====================================================================
// Road lanterns
// =====================================================================
{
  const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.8, 0.6) });
  const deadGlass = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
  const posts = new THREE.Group(), lightPools = [];
  paths.forEach((p, pi) => {
    for (let k = 4; k < p.length - 2; k += 6) {
      const a = p[k], b = p[k + 1], dir = b.clone().sub(a).normalize(), side = (k / 6) % 2 ? 1 : -1;
      const pos = a.clone().addScaledVector(new V3(-dir.z, 0, dir.x), side * 2.4); const y = heightAt(pos.x, pos.z);
      const g = new THREE.Group(); g.position.set(pos.x, y, pos.z); g.rotation.set(R(-.06, .06), Math.atan2(dir.x, dir.z) + (side > 0 ? Math.PI / 2 : -Math.PI / 2), R(-.06, .06));
      addMesh(g, new THREE.BoxGeometry(0.16, 2.6, 0.16), woodMat, 0, 1.3, 0);
      addMesh(g, new THREE.BoxGeometry(0.1, 0.1, 0.7), woodMat, 0, 2.5, 0.3);
      addMesh(g, new THREE.BoxGeometry(0.22, 0.32, 0.22), ironMat, 0, 2.15, 0.6);
      const lit = rand() < 0.8; addMesh(g, new THREE.BoxGeometry(0.15, 0.22, 0.15), lit ? glass : deadGlass, 0, 2.15, 0.6, false);
      if (lit) { g.updateMatrixWorld(true); lightPools.push(new V3(0, 0, 0.6).applyMatrix4(g.matrixWorld)); }
      posts.add(g);
    }
  });
  posts.updateMatrixWorld(true); scene.add(flatten(posts));
  // warm pools of light on the road under each lantern (cheap decals, no extra lights)
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0.32)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const pm = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: new THREE.Color(1.0, 0.5, 0.18), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(4.2, 4.2).rotateX(-Math.PI / 2), pm, lightPools.length);
  lightPools.forEach((p, i) => pools.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, heightAt(p.x, p.z) + 0.06, p.z)));
  pools.renderOrder = 2; scene.add(pools);
}

// candles: instanced bodies + flickering flames
let candleFlames;
{
  const body = new THREE.CylinderGeometry(0.035, 0.04, 1, 7); body.translate(0, 0.5, 0);
  const n = candleSpots.length, bodies = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0xcbbfa6, roughness: 0.6 }), n);
  const flameGeo = new THREE.SphereGeometry(0.03, 6, 5); flameGeo.scale(1, 2.2, 1);
  candleFlames = new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.6, 0.45) }), n);
  const d = new THREE.Object3D(); candleFlames.userData.h = [];
  candleSpots.forEach((p, i) => {
    const h = R(0.12, 0.35); d.position.copy(p); d.scale.set(1, h, 1); d.rotation.set(R(-.1, .1), 0, R(-.1, .1)); d.updateMatrix(); bodies.setMatrixAt(i, d.matrix);
    d.position.y += h + 0.06; d.scale.set(1, 1, 1); d.rotation.set(0, 0, 0); d.updateMatrix(); candleFlames.setMatrixAt(i, d.matrix); candleFlames.userData.h.push(d.position.clone());
  });
  bodies.castShadow = true; scene.add(bodies, candleFlames);
}
const _cd = new THREE.Object3D();
function updateCandles(time) {
  const hs = candleFlames.userData.h;
  for (let i = 0; i < hs.length; i++) {
    const f = 0.8 + Math.sin(time * 13 + i * 7.1) * 0.15 + Math.sin(time * 29 + i) * 0.08;
    _cd.position.copy(hs[i]); _cd.scale.set(1, f, 1); _cd.rotation.z = Math.sin(time * 3 + i) * 0.1; _cd.updateMatrix(); candleFlames.setMatrixAt(i, _cd.matrix);
  }
  candleFlames.instanceMatrix.needsUpdate = true;
}

// =====================================================================
// Ground mist sprites
// =====================================================================
const mists = [];
{
  // warm haze
  const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d');
  for (let i = 0; i < 18; i++) { const x = 64 + R(-26, 26), y = 64 + R(-14, 14), r = R(18, 42); const gr = ctx.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, 128, 128); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  for (let i = 0; i < (LOW ? 40 : 70); i++) {
    const m = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color().setHSL(0.06, 0.25, R(0.22, 0.34)), transparent: true, opacity: R(0.06, 0.15), depthWrite: false });
    const s = new THREE.Sprite(m); const a = rand() * TAU, r = Math.sqrt(rand()) * 105;
    s.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); s.position.y = heightAt(s.position.x, s.position.z) + R(0.6, 2);
    const sz = R(14, 30); s.scale.set(sz, sz * 0.35, 1); s.userData.v = new V3(R(-.4, .4), 0, R(-.4, .4)); s.renderOrder = 3;
    scene.add(s); mists.push(s);
  }
}

// =====================================================================
// Bats
// =====================================================================
const bats = [];
{
  const sh = new THREE.Shape(); sh.moveTo(0, 0.08); sh.lineTo(0.3, 0.12); sh.lineTo(0.58, 0.04); sh.lineTo(0.46, -0.06); sh.lineTo(0.36, -0.02); sh.lineTo(0.26, -0.12); sh.lineTo(0.14, -0.05); sh.lineTo(0, -0.1); sh.closePath();
  const wingGeo = new THREE.ShapeGeometry(sh); wingGeo.rotateX(-Math.PI / 2);
  const batMat = new THREE.MeshBasicMaterial({ color: 0x030202, side: THREE.DoubleSide });
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group(), b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), batMat); b.scale.set(1, 0.8, 1.9); g.add(b);
    const wL = new THREE.Mesh(wingGeo, batMat), wR = new THREE.Mesh(wingGeo, batMat); wR.scale.x = -1; g.add(wL, wR);
    g.scale.setScalar(R(1.3, 2.2)); scene.add(g);
    bats.push({ g, wL, wR, r: R(8, 30), h: R(9, 22), sp: R(0.25, 0.6) * (rand() < 0.5 ? -1 : 1), ph: rand() * TAU, ox: R(-15, 15), oz: R(-15, 15) });
  }
}
