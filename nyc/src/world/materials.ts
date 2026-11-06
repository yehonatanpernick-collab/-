import * as THREE from 'three/webgpu';
import {
  texture, uv, vertexColor, vec2, vec3, float, mix, step, fract, floor, hash, smoothstep, normalMap,
  positionWorld, mx_noise_float, time, sin, max, clamp, abs, uniform, Fn, transformNormalToView, color,
} from 'three/tsl';
import type { Engine } from '../engine/renderer';

const BASE = import.meta.env.BASE_URL;
const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
function tex(name: string, srgb = false, aniso = 8) {
  const key = name + srgb;
  let t = cache.get(key);
  if (!t) {
    t = loader.load(`${BASE}tex/${name}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, t);
  }
  return t;
}
// COLOR_0 is stored as uint8 * (200/255) so tints up to ~1.27 survive; undo the scale here.
const tint = () => vertexColor(0).rgb.mul(255 / 200);

/** window grid size of each photographic facade (columns, rows per texture tile) for procedural night lights */
const GRID: Record<string, [number, number, boolean, boolean]> = {
  // key: [cols, rows, hasEmissionMap, hasMetalnessMap]
  F001: [8, 9.5, false, true], F005: [16, 20, false, true], F006: [13, 8, false, true],
  F012: [42, 24, true, false], F014: [44, 30, true, false],
  F018: [6, 6.5, true, true], F019: [6, 6.5, true, true], F020: [6, 6.5, true, true],
};

export function makeMaterials(engine: Engine) {
  const night = engine.night;
  const M: Record<string, THREE.Material> = {};

  for (const [key, [cols, rows, hasE, hasM]] of Object.entries(GRID)) {
    const m = new THREE.MeshStandardNodeMaterial();
    const U = uv();
    const glass = key === 'F001' || key === 'F005' || key === 'F006';
    m.colorNode = texture(tex(`${key}_c`, true), U).rgb.mul(tint());
    m.normalNode = normalMap(texture(tex(`${key}_n`), U), vec2(glass ? 0.6 : 1.0));
    const rough = texture(tex(`${key}_r`), U).r;
    m.roughnessNode = glass ? rough.mul(0.55) : rough;
    m.metalnessNode = hasM ? texture(tex(`${key}_m`), U).r : float(0.0);
    // night: real lit-window maps where the asset has them, otherwise a hashed window grid
    const cell = floor(U.mul(vec2(cols, rows)));
    const r = hash(cell.x.add(cell.y.mul(131.7)).add(floor(positionWorld.x.mul(0.01)).mul(7.3)));
    const warm = mix(vec3(1.0, 0.78, 0.5), vec3(0.75, 0.88, 1.0), step(0.75, hash(cell.y.add(cell.x.mul(3.1)))));
    const proc = warm.mul(step(0.58, r)).mul(r.mul(1.6));
    const lit = hasE ? texture(tex(`${key}_e`, true), U).rgb.mul(1.6) : proc;
    m.emissiveNode = lit.mul(night.mul(night).mul(1.8).add(0.0));
    m.envMapIntensity = glass ? 1.2 : 0.8;
    M[key] = m;
  }

  // storefront band: procedural shop windows with interiors, mullions and sign fascia
  {
    const m = new THREE.MeshStandardNodeMaterial();
    const U = uv();
    const fx = fract(U.x), fy = U.y;
    const bay = floor(U.x);
    const pane = step(0.07, fx).mul(step(fx, 0.93)).mul(step(0.06, fy)).mul(step(fy, 0.74));
    const mull = step(abs(fx.sub(0.5)), 0.012).mul(pane);
    const glassP = pane.sub(mull);
    const sign = step(0.8, fy).mul(step(fy, 0.97));
    const h1 = hash(bay.add(floor(positionWorld.x.add(positionWorld.z).mul(0.05))));
    const signCol = mix(mix(vec3(0.55, 0.08, 0.06), vec3(0.06, 0.18, 0.4), step(0.33, h1)), vec3(0.12, 0.12, 0.13), step(0.66, h1));
    const frame = vec3(0.09, 0.09, 0.1).mul(tint());
    const interior = mix(vec3(1.0, 0.82, 0.58), vec3(0.85, 0.92, 1.0), step(0.6, hash(bay.mul(1.7))));
    const depthFade = smoothstep(0.06, 0.74, fy).mul(0.6).add(0.4);
    m.colorNode = mix(mix(frame, signCol, sign), vec3(0.02, 0.025, 0.03), glassP);
    m.roughnessNode = mix(float(0.55), float(0.05), glassP);
    m.metalnessNode = mix(float(0.2), float(0.85), glassP);
    const open = step(0.18, hash(bay.mul(5.3).add(2.0)));
    m.emissiveNode = interior.mul(glassP).mul(depthFade).mul(open).mul(night.mul(1.8).add(0.05))
      .add(signCol.mul(sign).mul(night.mul(1.2)));
    M.SHOP = m;
  }

  const pbr = (name: string, scale = 1, opts: { tint?: boolean; rough?: number; color?: THREE.ColorRepresentation } = {}) => {
    const m = new THREE.MeshStandardNodeMaterial();
    const U = uv().mul(scale);
    let c: any = texture(tex(`${name}_c`, true), U).rgb;
    if (opts.tint !== false) c = c.mul(tint());
    if (opts.color) c = c.mul(color(new THREE.Color(opts.color)));
    m.colorNode = c;
    m.normalNode = normalMap(texture(tex(`${name}_n`), U));
    m.roughnessNode = texture(tex(`${name}_r`), U).r.mul(opts.rough ?? 1);
    m.metalnessNode = float(0);
    return m;
  };
  // asphalt: photo texture + large-scale patching / wear variation in world space
  {
    const m = pbr('asphalt', 1, { tint: false });
    const P = positionWorld.xz;
    const big = mx_noise_float(P.mul(0.035)).mul(0.5).add(0.5);
    const patch = smoothstep(0.55, 0.62, mx_noise_float(P.mul(0.012).add(vec2(13.1, 7.7))).mul(0.5).add(0.5));
    m.colorNode = (m.colorNode as any).mul(mix(float(0.82), float(1.08), big)).mul(mix(float(1.0), float(0.72), patch)).mul(0.92);
    m.roughnessNode = (m.roughnessNode as any).mul(mix(float(0.95), float(0.75), patch));
    M.ROAD = m;
  }
  M.SIDEWALK = pbr('sidewalk', 1, { tint: false, color: 0xd8d4cc });
  M.CURB = pbr('granite', 1, { tint: false, color: 0xb8b4ae });
  M.SEAWALL = pbr('granite', 1, { tint: false, color: 0x8f8a84 });
  M.CORNICE = pbr('granite', 1);
  {
    const m = pbr('sidewalk', 1, { color: 0xc9c7c1 });
    m.roughnessNode = float(0.92);
    M.ROOF = m;
  }
  // lane paint: worn retro-reflective paint
  {
    const m = new THREE.MeshStandardNodeMaterial({ polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const wear = mx_noise_float(positionWorld.xz.mul(1.7)).mul(0.5).add(0.5);
    m.colorNode = tint().mul(mix(float(0.7), float(1.0), wear));
    m.roughnessNode = float(0.62);
    m.metalnessNode = float(0);
    M.PAINT = m;
  }
  // grass: procedural lawn with clumps and worn paths
  {
    const m = new THREE.MeshStandardNodeMaterial();
    const P = positionWorld.xz;
    const n1 = mx_noise_float(P.mul(0.08)).mul(0.5).add(0.5), n2 = mx_noise_float(P.mul(0.9)).mul(0.5).add(0.5);
    const g = mix(vec3(0.16, 0.26, 0.08), vec3(0.3, 0.38, 0.13), n1).mul(mix(float(0.78), float(1.1), n2));
    m.colorNode = g; m.roughnessNode = float(0.95); m.metalnessNode = float(0);
    M.GRASS = m; M.HIGHLINE = m;
  }
  // water: dark, glossy, with moving normal ripples
  {
    const m = new THREE.MeshStandardNodeMaterial();
    const P = positionWorld.xz;
    const t = time.mul(0.6);
    const n = Fn(() => {
      const a = mx_noise_float(vec3(P.mul(0.06), t.mul(0.4)));
      const b = mx_noise_float(vec3(P.mul(0.22).add(vec2(5.0, 1.0)), t));
      return vec3(a.mul(0.18).add(b.mul(0.08)), 1.0, a.mul(0.12).sub(b.mul(0.1))).normalize();
    })();
    m.colorNode = vec3(0.025, 0.06, 0.075);
    m.normalNode = transformNormalToView(n);
    m.roughnessNode = float(0.06); m.metalnessNode = float(0.0);
    M.WATER = m;
  }
  void sin; void max; void clamp; void uniform;
  return M;
}
