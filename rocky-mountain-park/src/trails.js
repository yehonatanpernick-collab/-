// Trails: dirt ribbons, log bridges, routed wooden signs, tundra cairns, pond lilies.
import * as THREE from 'three';
import { clamp, mulberry32, nR, LAKES, LK, TRAILS, lakeR, BASE } from './shared.js';
import { scene, G, bridges, heightAt, cellOf, groundAt, trailAt, hex } from './core.js';
import { patchLit } from './atmos.js';

const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
let signWood;

export function buildTrails() {
  signWood = patchLit(new THREE.MeshLambertMaterial({ color: 0x5a3a22 }), { key: 'signwood', ao: 0.5 });
  const { CHD, CHL, LKD, NRM } = G;
  const wood = hex('#7a5a3c'), dirt = hex('#9a8262'), woodMat = patchLit(new THREE.MeshLambertMaterial({ color: 0x7a5a3c }), { key: 'wood', ao: 0.6, wet: 0.3 });
  const pos = [], col = [], idx = [];
  TRAILS.forEach(T => {
    const P = T.path, n = P.length, Y = new Float32Array(n), isB = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const k = cellOf(P[i][0], P[i][1]); if (CHD[k] < 1.2 && LKD[k] > 0) isB[i] = 1; }
    // group crossings into bridges
    for (let i = 0; i < n; i++) if (isB[i] && !isB[i - 1]) {
      let j = i; while (j < n - 1 && isB[j + 1]) j++;
      const a = Math.max(0, i - 3), b = Math.min(n - 1, j + 3);
      const k = cellOf(P[i][0], P[i][1]), y = Math.max(CHL[k] + 0.9, heightAt(...P[a]) + 0.25, heightAt(...P[b]) + 0.25);
      bridges.push({ ax: P[a][0], az: P[a][1], bx: P[b][0], bz: P[b][1], y });
      for (let q = a; q <= b; q++) isB[q] = 2;
      const len = Math.hypot(P[b][0] - P[a][0], P[b][1] - P[a][1]), yaw = Math.atan2(P[b][0] - P[a][0], P[b][1] - P[a][1]);
      const cx = (P[a][0] + P[b][0]) / 2, cz = (P[a][1] + P[b][1]) / 2;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, len + 1), woodMat); deck.position.set(cx, y - 0.15, cz); deck.rotation.y = yaw; deck.castShadow = deck.receiveShadow = true; scene.add(deck);
      for (const sd of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len + 1), woodMat); rail.position.set(cx + Math.cos(yaw) * sd * 1.1, y + 0.85, cz - Math.sin(yaw) * sd * 1.1); rail.rotation.y = yaw; scene.add(rail);
        for (let p = 0; p <= Math.ceil(len / 3); p++) { const t = p / Math.ceil(len / 3) - 0.5, post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), woodMat); post.position.set(cx + Math.cos(yaw) * sd * 1.1 + Math.sin(yaw) * t * len, y + 0.42, cz - Math.sin(yaw) * sd * 1.1 + Math.cos(yaw) * t * len); scene.add(post); } }
    }
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)]; let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      for (const sd of [-1, 0, 1]) {
        const x = P[i][0] - tz * sd * 0.75, z = P[i][1] + tx * sd * 0.75;
        let y = heightAt(x, z) + 0.07; if (isB[i] === 2) y = Math.max(y, groundAt(x, z) + 0.02);
        pos.push(x, y, z);
        const c = isB[i] === 2 ? wood : dirt, v = 0.88 + 0.24 * nR(x * 0.4, z * 0.4) * (sd === 0 ? 0.4 : 1);
        col.push(c.r * v, c.g * v, c.b * v);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < 2; k++) { const a = base + i * 3 + k, b = a + 1, c = a + 3, d = c + 1; idx.push(a, c, b, b, c, d); }
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, patchLit(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }), { key: 'trail', ao: 1, wet: 0.35 }));
  m.receiveShadow = true; scene.add(m);
  // trail signs with distances in miles
  TRAILS.forEach(T => {
    const lines = [[T.en.toUpperCase(), '']];
    for (const id of T.dests) {
      const L = LAKES[LK[id]]; let bi = 0, bd = 1e9; T.path.forEach((p, i) => { const d = Math.hypot(p[0] - L.x, p[1] - L.z); if (d < bd) { bd = d; bi = i; } });
      lines.push([L.en.toUpperCase(), (T.cum[bi] / 1609).toFixed(1) + ' MI']);
    }
    if (T.en.startsWith('Longs')) lines.push(['LONGS PEAK', (T.cum[T.cum.length - 1] / 1609).toFixed(1) + ' MI']);
    const [x, z] = T.path[2], [x2, z2] = T.path[6];
    placeSign(x + (z2 - z) * 0.6, z - (x2 - x) * 0.6, Math.atan2(x2 - x, z2 - z), lines);
  });
  LAKES.forEach(L => {
    const ang = 0.6, rr = lakeR(L, ang) + 12; let best = null;
    for (let a = 0; a < 16; a++) { const an = ang + a / 16 * Math.PI * 2, r2 = lakeR(L, an) + 10, x = L.x + Math.cos(an) * r2, z = L.z + Math.sin(an) * r2, k = cellOf(x, z); if (NRM[k * 3 + 1] > 0.85 && LKD[k] > 3 && CHD[k] > 3) { best = [x, z, an]; break; } }
    if (!best) best = [L.x + Math.cos(ang) * rr, L.z + Math.sin(ang) * rr, ang];
    const e = L.level + BASE;
    placeSign(best[0], best[1], Math.atan2(L.x - best[0], L.z - best[1]), [[L.en.toUpperCase(), ''], ['ELEV. ' + Math.round(e * 3.28084).toLocaleString('en-US') + ' FT', Math.round(e).toLocaleString('en-US') + ' M']]);
  });
  // rock cairns mark the trail across open tundra
  const cg = new THREE.DodecahedronGeometry(1, 0), cm = patchLit(new THREE.MeshLambertMaterial({ color: 0x9a928a }), { key: 'cairn', ao: 0.7 });
  const stones = [], cr = mulberry32(8);
  for (const T of TRAILS) for (let i = 30; i < T.path.length; i += 45) {
    const [x, z] = T.path[i]; if (heightAt(x, z) + BASE < 3420) continue;
    const a = T.path[Math.max(0, i - 1)], b = T.path[Math.min(T.path.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const cx = x - (b[1] - a[1]) / l * 1.6, cz = z + (b[0] - a[0]) / l * 1.6; let y = heightAt(cx, cz);
    for (let s = 0; s < 6; s++) { const r = 0.42 - s * 0.055; stones.push(M4(cx + (cr() - 0.5) * 0.08, y + r * 0.7, cz + (cr() - 0.5) * 0.08, cr(), cr() * 6, 0, r * 1.2, r * 0.75, r * 1.1)); y += r * 1.25; }
  }
  const cairns = new THREE.InstancedMesh(cg, cm, Math.max(1, stones.length)); stones.forEach((m, i) => cairns.setMatrixAt(i, m)); cairns.count = stones.length; cairns.castShadow = true; scene.add(cairns);
  // yellow pond lilies on Nymph Lake
  const NL = LAKES[LK.nymph], pad = new THREE.CircleGeometry(0.45, 10, 0.3, Math.PI * 2 - 0.6).rotateX(-Math.PI / 2);
  const pads = new THREE.InstancedMesh(pad, patchLit(new THREE.MeshLambertMaterial({ color: 0x4c7a34, side: THREE.DoubleSide }), { key: 'pad' }), 420);
  const lil = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), patchLit(new THREE.MeshLambertMaterial({ color: 0xf2c531 }), { key: 'lily' }), 60);
  const rr = mulberry32(3); let li = 0;
  for (let i = 0; i < 420; i++) {
    const an = rr() * 6.283, d = Math.sqrt(rr()) * lakeR(NL, an) * 0.85, x = NL.x + Math.cos(an) * d, z = NL.z + Math.sin(an) * d, s = 0.6 + rr() * 0.8;
    pads.setMatrixAt(i, M4(x, NL.level + 0.03, z, 0, rr() * 6.28, 0, s, 1, s));
    if (li < 60 && rr() < 0.15) lil.setMatrixAt(li++, M4(x + 0.1, NL.level + 0.1, z, 0, 0, 0, 1, 0.7, 1));
  }
  lil.count = li; scene.add(pads, lil);
}
export const signMeshes = [];
function placeSign(x, z, yaw, lines) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 44 + lines.length * 52; const g = cv.getContext('2d');
  g.fillStyle = '#5a3a22'; g.fillRect(0, 0, cv.width, cv.height);
  const r = mulberry32(lines.length * 7 + Math.round(x));
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(30,18,8,${0.15 + r() * 0.2})`; g.lineWidth = 1 + r() * 2; g.beginPath(); const y = r() * cv.height; g.moveTo(0, y); g.bezierCurveTo(170, y + (r() - 0.5) * 10, 340, y + (r() - 0.5) * 10, 512, y); g.stroke(); }
  g.strokeStyle = 'rgba(240,222,176,.55)'; g.lineWidth = 4; g.strokeRect(10, 10, 492, cv.height - 20);
  g.fillStyle = '#efdcae'; g.textBaseline = 'middle';
  lines.forEach(([a, b], i) => {
    const y = 48 + i * 52; g.font = (i === 0 ? 'bold 34px' : 'bold 31px') + ' Georgia, "Times New Roman", serif';
    g.textAlign = b ? 'left' : 'center'; g.fillText(a, b ? 28 : 256, y, b ? 330 : 470);
    if (b) { g.textAlign = 'right'; g.fillText(b, 484, y); }
  });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const w = 1.7, h = w * cv.height / 512, y0 = heightAt(x, z);
  const wood = signWood, face = patchLit(new THREE.MeshLambertMaterial({ map: tex }), { key: 'signface', ao: 0.5 });
  const grp = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5 + h, 0.14), wood); post.position.y = (1.5 + h) / 2 - 0.2;
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), [wood, wood, wood, wood, face, face]); board.position.y = 1.35 + h / 2;
  post.castShadow = board.castShadow = true; grp.add(post, board);
  grp.position.set(x, y0, z); grp.rotation.y = yaw; scene.add(grp); signMeshes.push(grp);
}
