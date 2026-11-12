// Renders a top-down preview of the map collision + nav grid to a PNG (debug tool).
import sharp from 'sharp';
import { NavGrid } from '../shared/src/nav';
import { buildKestrel } from '../shared/src/world/maps/kestrel';
import { F_NOCOLLIDE, F_NORENDER } from '../shared/src/world/World';
import { MATERIALS, TINTS } from '../shared/src/world/materials';

const out = process.argv[2] ?? 'map-preview.png';
const S = 6;
const map = buildKestrel();
const w = map.world;
const W = Math.round((w.maxX - w.minX) * S), H = Math.round((w.maxZ - w.minZ) * S);
const img = new Uint8Array(W * H * 3);
const height = new Float32Array(W * H).fill(-100);
const boxes = w.boxes.map((b, i) => ({ b, i })).filter(({ b }) => b.enabled && !(b.flags & F_NOCOLLIDE)).sort((p, q) => p.b.maxY - q.b.maxY);
for (const { b } of boxes) {
  const m = MATERIALS[b.mat], t = TINTS[b.tint] ?? TINTS[0];
  const shade = 0.45 + Math.min(1, Math.max(0, b.maxY / 12)) * 0.55;
  const prop = (b.flags & F_NORENDER) !== 0;
  const c = prop ? [200, 90, 40] : [m.color[0] * t[0] * 255 * shade, m.color[1] * t[1] * 255 * shade, m.color[2] * t[2] * 255 * shade];
  const x0 = Math.max(0, Math.floor((b.minX - w.minX) * S)), x1 = Math.min(W, Math.ceil((b.maxX - w.minX) * S));
  const z0 = Math.max(0, Math.floor((b.minZ - w.minZ) * S)), z1 = Math.min(H, Math.ceil((b.maxZ - w.minZ) * S));
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const k = z * W + x;
    if (b.maxY < height[k]) continue;
    height[k] = b.maxY;
    img[k * 3] = c[0]; img[k * 3 + 1] = c[1]; img[k * 3 + 2] = c[2];
  }
}
const dot = (x: number, z: number, r: number, c: [number, number, number]): void => {
  const px = Math.round((x - w.minX) * S), pz = Math.round((z - w.minZ) * S);
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dz * dz > r * r) continue;
    const X = px + dx, Z = pz + dz;
    if (X < 0 || Z < 0 || X >= W || Z >= H) continue;
    const k = (Z * W + X) * 3; img[k] = c[0]; img[k + 1] = c[1]; img[k + 2] = c[2];
  }
};
if (process.argv.includes('--nav')) {
  const nav = new NavGrid(w);
  for (let i = 0; i < nav.count; i++) if (nav.usable(i)) dot(nav.nodeX[i], nav.nodeZ[i], 1, nav.nodeY[i] > 2 ? [255, 230, 0] : nav.nodeY[i] < -1 ? [255, 0, 255] : [0, 150, 60]);
}
for (const r of w.ramps) for (let t = 0; t <= 1; t += 0.1) dot(r.minX + (r.maxX - r.minX) * (r.axis === 0 ? t : 0.5), r.minZ + (r.maxZ - r.minZ) * (r.axis === 1 ? t : 0.5), 2, [0, 255, 255]);
for (const o of map.objectives) {
  for (let a = 0; a < 360; a += 2) dot(o.x + Math.cos(a * 0.01745) * o.radius, o.z + Math.sin(a * 0.01745) * o.radius, 1, [255, 255, 255]);
  for (const s of o.spawns) dot(s.x, s.z, 3, [255, 255, 0]);
}
for (const b of map.bases) { for (const s of b.spawns) dot(s.x, s.z, 3, b.team === 1 ? [60, 140, 255] : [255, 120, 40]); if (b.vehicle) dot(b.vehicle.x, b.vehicle.z, 5, [255, 0, 255]); }
for (const s of map.overwatch) dot(s.x, s.z, 3, [255, 0, 0]);
await sharp(Buffer.from(img), { raw: { width: W, height: H, channels: 3 } }).png().toFile(out);
console.log('wrote', out, W, H);
