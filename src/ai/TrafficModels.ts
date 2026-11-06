import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural traffic vehicle library (side-profile extrusions with bevels + glasshouse + trim),
 * vertex-coloured so a single InstancedMesh per class can be tinted per instance.
 * Paint areas are white (×instance colour); glass, tyres and trim are dark.
 */
export interface CarClass {
  name: string; length: number; width: number; height: number; wheelbase: number; wheelR: number; track: number;
  colors: number[]; weight: number; maxSpeed: number;
}

export const CAR_CLASSES: CarClass[] = [
  { name: 'sedan', length: 4.7, width: 1.84, height: 1.45, wheelbase: 2.8, wheelR: 0.33, track: 1.58, colors: [0x1d1f23, 0xe6e6e3, 0x8a8f96, 0x2a3e5c, 0x6b1c1c, 0xb7bcc1, 0x101114, 0x3c4a3e], weight: 4, maxSpeed: 1.05 },
  { name: 'suv', length: 4.8, width: 1.95, height: 1.75, wheelbase: 2.9, wheelR: 0.38, track: 1.66, colors: [0x0f1012, 0xf0f0ee, 0x5d6066, 0x203248, 0x7c7f74, 0x4a2b23], weight: 3, maxSpeed: 1.0 },
  { name: 'ev', length: 4.7, width: 1.9, height: 1.44, wheelbase: 2.88, wheelR: 0.34, track: 1.6, colors: [0xf4f4f2, 0x0b0b0c, 0xa1a7ad, 0x1e3a8a, 0xa31d1d], weight: 3, maxSpeed: 1.1 },
  { name: 'taxi', length: 4.7, width: 1.84, height: 1.5, wheelbase: 2.8, wheelR: 0.33, track: 1.58, colors: [0xf2c200], weight: 1.2, maxSpeed: 1.05 },
  { name: 'van', length: 5.4, width: 2.0, height: 2.3, wheelbase: 3.4, wheelR: 0.36, track: 1.7, colors: [0xf2f2f0, 0xe9e9e6, 0x6d7278, 0x173d6b], weight: 1.2, maxSpeed: 0.9 },
  { name: 'bus', length: 12.2, width: 2.55, height: 3.1, wheelbase: 6.2, wheelR: 0.5, track: 2.1, colors: [0xffffff], weight: 0.5, maxSpeed: 0.8 },
  { name: 'truck', length: 7.5, width: 2.4, height: 3.3, wheelbase: 4.2, wheelR: 0.48, track: 1.95, colors: [0xffffff, 0xd9d4c4, 0x2b4d7a], weight: 0.6, maxSpeed: 0.8 },
];

function colorGeo(g: THREE.BufferGeometry, c: [number, number, number]): THREE.BufferGeometry {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

function profileExtrude(pts: [number, number][], width: number, bevel: number): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // profile x (length) → +Z forward, extrusion → X
  return g;
}

const PAINT: [number, number, number] = [1, 1, 1];
const GLASS: [number, number, number] = [0.04, 0.05, 0.06];
const TRIM: [number, number, number] = [0.07, 0.07, 0.08];
const CHROME: [number, number, number] = [0.6, 0.6, 0.6];

/** body geometry for a class, origin at ground centre, +Z forward */
export function buildBody(c: CarClass): THREE.BufferGeometry {
  const L = c.length, H = c.height, W = c.width, hl = L / 2;
  const parts: THREE.BufferGeometry[] = [];
  const g0 = c.wheelR * 0.75;
  if (c.name === 'bus') {
    parts.push(colorGeo(profileExtrude([[-hl, g0], [hl, g0], [hl, H - 0.2], [hl - 0.25, H], [-hl + 0.2, H], [-hl, H - 0.2]], W, 0.08), PAINT));
    const win = profileExtrude([[-hl + 0.6, 1.35], [hl - 0.15, 1.35], [hl - 0.1, H - 0.35], [-hl + 0.6, H - 0.35]], W + 0.04, 0.01);
    parts.push(colorGeo(win, GLASS));
    const band = profileExtrude([[-hl, 0.5], [hl, 0.5], [hl, 1.2], [-hl, 1.2]], W + 0.02, 0.01);
    parts.push(colorGeo(band, [0.75, 0.08, 0.1])); // Muni red band
  } else if (c.name === 'truck') {
    parts.push(colorGeo(profileExtrude([[hl - 2.1, g0], [hl, g0], [hl, 1.9], [hl - 0.4, 2.6], [hl - 2.1, 2.6]], W, 0.1), PAINT));
    parts.push(colorGeo(profileExtrude([[hl - 0.42, 1.9], [hl - 0.02, 1.85], [hl - 0.35, 2.5], [hl - 0.75, 2.5]], W - 0.2, 0.02), GLASS));
    parts.push(colorGeo(profileExtrude([[-hl, g0 + 0.25], [hl - 2.2, g0 + 0.25], [hl - 2.2, H], [-hl, H]], W, 0.05), [0.92, 0.92, 0.9]));
  } else if (c.name === 'van') {
    parts.push(colorGeo(profileExtrude([[-hl, g0], [hl, g0], [hl, 0.95], [hl - 0.9, 1.75], [hl - 1.3, H], [-hl + 0.1, H], [-hl, H - 0.1]], W, 0.1), PAINT));
    parts.push(colorGeo(profileExtrude([[hl - 0.92, 1.05], [hl - 0.15, 1.0], [hl - 0.95, 1.72], [hl - 1.32, 1.95], [hl - 1.6, 1.95], [hl - 1.6, 1.05]], W + 0.03, 0.01), GLASS));
  } else {
    const suv = c.name === 'suv';
    const ev = c.name === 'ev';
    const belt = suv ? 1.05 : 0.9;
    const roofF = suv ? 0.55 : ev ? 0.2 : 0.35, roofB = suv ? -hl + 0.25 : -hl + (ev ? 0.6 : 0.95);
    const prof: [number, number][] = [
      [-hl, g0 + 0.05], [hl, g0 + 0.05], [hl, belt - 0.15], [hl - 0.15, belt], [hl - (ev ? 1.0 : 1.25), belt + 0.05],
      [roofF, H], [roofB + (suv ? 0.05 : 0.25), H], [roofB, belt + 0.25], [-hl + 0.05, belt + 0.05], [-hl, belt - 0.2],
    ];
    parts.push(colorGeo(profileExtrude(prof, W, 0.12), PAINT));
    // glasshouse slightly proud of the body sides
    const gl: [number, number][] = [[hl - (ev ? 1.05 : 1.3), belt + 0.08], [roofF + 0.03, H - 0.06], [roofB + (suv ? 0.08 : 0.28), H - 0.06], [roofB + 0.04, belt + 0.27], [roofB + 0.04, belt + 0.08]];
    parts.push(colorGeo(profileExtrude(gl, W - 0.12, 0.08), GLASS));
    if (c.name === 'taxi') {
      const sign = new THREE.BoxGeometry(0.9, 0.22, 0.3); sign.translate(0, H + 0.12, -0.1);
      parts.push(colorGeo(sign, [1.3, 1.3, 1.25]));
    }
  }
  // bumpers / sills
  const sill = new THREE.BoxGeometry(W + 0.02, 0.18, L * 0.98); sill.translate(0, g0 + 0.1, 0);
  parts.push(colorGeo(sill, TRIM));
  // lights (front white, rear red) — coloured separately in a light mesh; here dark housings
  const grille = new THREE.BoxGeometry(W * 0.5, 0.12, 0.04); grille.translate(0, (c.name === 'bus' ? 0.9 : 0.62), hl + 0.01);
  parts.push(colorGeo(grille, CHROME));
  const g = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }));
  g.computeVertexNormals();
  return g;
}

export function wheelGeometry(): THREE.BufferGeometry {
  const tyre = new THREE.CylinderGeometry(1, 1, 0.65, 16); tyre.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.62, 0.62, 0.7, 10); rim.rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.72, 0.12, 1.1);
  const g = mergeGeometries([colorGeo(tyre, [0.05, 0.05, 0.05]), colorGeo(rim, [0.55, 0.56, 0.58]), colorGeo(spoke, [0.3, 0.3, 0.32])].map((x) => { x.deleteAttribute('uv'); return x; }));
  g.computeVertexNormals();
  return g;
}

/** quads for head / tail lamps, positioned per class */
export function lampGeometry(c: CarClass, front: boolean): THREE.BufferGeometry {
  const y = c.name === 'bus' || c.name === 'truck' ? 0.75 : 0.72;
  const z = (front ? 1 : -1) * (c.length / 2 + 0.02);
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const p = new THREE.PlaneGeometry(front ? 0.32 : 0.28, front ? 0.1 : 0.12);
    if (!front) p.rotateY(Math.PI);
    p.translate(s * (c.width / 2 - 0.25), y, z);
    parts.push(p);
  }
  return mergeGeometries(parts);
}
