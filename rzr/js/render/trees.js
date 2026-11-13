// Procedural conifers dressed in scanned materials (Poly Haven fir_tree_01 / pine_tree_01
// bark + twig atlases). Geometry is generated (the source scans are 8-17M triangles), with
// branch cards bent and fanned in whorls, normals bent outward for soft canopy shading.
import * as THREE from 'three';

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// sprig rectangles in the twig atlases (image coords, y down): [x0, y0, x1, y1]
const SPRIGS = {
  fir: [[0.652, 0.039, 0.941, 0.375], [0.191, 0.051, 0.418, 0.32], [0.312, 0.402, 0.641, 0.781], [0.637, 0.457, 0.957, 0.836]],
  pine: [[0.05, 0.02, 0.235, 0.445]],
};

export const SPECIES = {
  spruce: { twig: 'fir', bark: 'fir', crownBase: [0.06, 0.16], width: [0.17, 0.21], droop: [0.25, 0.5], whorl: 0.34, cards: 9, shape: 'cone', filler: 1 },
  fir: { twig: 'fir', bark: 'fir', crownBase: [0.1, 0.22], width: [0.19, 0.24], droop: [0.05, 0.22], whorl: 0.4, cards: 8, shape: 'cone', filler: 1 },
  pine: { twig: 'pine', bark: 'pine', crownBase: [0.24, 0.38], width: [0.16, 0.21], droop: [-0.05, 0.2], whorl: 0.45, cards: 9, shape: 'ovoid', filler: 1 },
  larch: { twig: 'fir', bark: 'pine', crownBase: [0.25, 0.4], width: [0.15, 0.2], droop: [0.1, 0.35], whorl: 0.65, cards: 5, shape: 'cone', sparse: 0.55, tint: [1.15, 1.05, 0.7] },
};

export function buildConifer(species, seed, height) {
  const S = SPECIES[species], R = rng(seed);
  const between = (a) => a[0] + (a[1] - a[0]) * R();
  const H = height;
  const r0 = H * 0.017 + 0.06;
  const crownBase = H * between(S.crownBase);
  const crownW = H * between(S.width);
  const lean = new THREE.Vector2((R() - 0.5) * 0.025, (R() - 0.5) * 0.025);
  // ---- trunk
  const trunk = new THREE.CylinderGeometry(0.03, r0, H, 9, 10, true);
  trunk.translate(0, H / 2, 0);
  const tp = trunk.attributes.position, tuv = trunk.attributes.uv;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i), k = y / H;
    // root flare + lean + slight sinuosity
    const flare = 1 + Math.max(0, 0.35 - y) * 1.6;
    tp.setX(i, tp.getX(i) * flare + lean.x * y + Math.sin(y * 0.7 + seed) * 0.04 * k);
    tp.setZ(i, tp.getZ(i) * flare + lean.y * y);
    tuv.setXY(i, tuv.getX(i) * 2, y / 1.6);
  }
  trunk.computeVertexNormals();
  // ---- branch cards
  const rects = SPRIGS[S.twig];
  const pos = [], nrm = [], uv = [], idx = [];
  const tipY = H * 1.02;
  const crownR = (y) => {
    const t = (y - crownBase) / (tipY - crownBase); // 0 bottom of crown -> 1 tip
    if (S.shape === 'round') return crownW * Math.pow(Math.sin(Math.min(1, t * 1.05) * Math.PI * 0.92 + 0.12), 0.8);
    if (S.shape === 'ovoid') return crownW * (Math.pow(Math.sin(Math.min(1, t) * Math.PI * 0.85 + 0.25), 0.7) * 0.85 + 0.15 * (1 - t)) + 0.2;
    return crownW * Math.pow(1 - t, 0.95) + 0.25;
  };
  const addCard = (base, dir, len, wid, droop, roll, rect) => {
    // a 3-segment bent card: base -> tip with droop, width perpendicular to dir and rolled
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    side.applyAxisAngle(dir, roll);
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    const v0 = pos.length / 3;
    const segs = 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const along = dir.clone().multiplyScalar(len * t);
      along.y -= droop * len * t * t;
      const c = base.clone().add(along);
      const w = wid * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5 + 0.3));
      for (const sgn of [-1, 1]) {
        const p = c.clone().addScaledVector(side, w * 0.5 * sgn);
        pos.push(p.x, p.y, p.z);
        // bent normal: outward from the trunk axis, tilted up -> soft, volumetric canopy light
        const o = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(0.8).add(up.clone().multiplyScalar(0.35)).add(new THREE.Vector3(0, 0.45, 0)).normalize();
        nrm.push(o.x, o.y, o.z);
        const u = sgn < 0 ? rect[0] : rect[2];
        const v = 1 - (rect[3] + (rect[1] - rect[3]) * t);
        uv.push(u, v);
      }
    }
    for (let s = 0; s < segs; s++) { const a = v0 + s * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  };
  const whorlStep = S.whorl * (0.85 + 0.3 * R());
  let ang0 = R() * Math.PI * 2;
  for (let y = crownBase; y < tipY - 0.35; y += whorlStep * (0.8 + 0.4 * R())) {
    const cr = crownR(y);
    if (cr < 0.2) continue;
    const n = Math.max(3, Math.round(S.cards * (0.7 + 0.5 * Math.min(1, cr / 2.2))));
    ang0 += 2.39996; // golden angle between whorls
    for (let c = 0; c < n; c++) {
      if (S.sparse && R() > S.sparse) continue;
      const a = ang0 + c / n * Math.PI * 2 + (R() - 0.5) * 0.5;
      const elev = 0.35 - between(S.droop) * 0.6 + (y > H * 0.8 ? 0.35 : 0);
      const dir = new THREE.Vector3(Math.cos(a), elev, Math.sin(a)).normalize();
      const len = cr * (0.8 + 0.35 * R());
      const kt = y / H;
      const base = new THREE.Vector3(lean.x * y, y, lean.y * y);
      addCard(base, dir, len, len * (0.6 + 0.3 * R()), between(S.droop) * 0.8, (R() - 0.5) * 1.2, rects[Math.floor(R() * rects.length)]);
      if (S.filler && R() < 0.55) {
        const d2 = new THREE.Vector3(Math.cos(a + 0.4), elev + 0.45, Math.sin(a + 0.4)).normalize();
        addCard(base.clone().add(new THREE.Vector3(0, whorlStep * 0.5, 0)), d2, len * 0.55, len * 0.5, 0.1, (R() - 0.5) * 2, rects[Math.floor(R() * rects.length)]);
      }
    }
  }
  // leader at the top
  addCard(new THREE.Vector3(lean.x * H, tipY - 1.6, lean.y * H), new THREE.Vector3(0, 1, 0), 1.8, 0.9, 0, 0, rects[0]);
  addCard(new THREE.Vector3(lean.x * H, tipY - 1.6, lean.y * H), new THREE.Vector3(0, 1, 0), 1.8, 0.9, 0, Math.PI / 2, rects[0]);
  const cards = new THREE.BufferGeometry();
  cards.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cards.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  cards.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  cards.setIndex(idx);
  cards.computeBoundingSphere(); trunk.computeBoundingSphere();
  return { trunk, cards, height: H, radius: crownW, trunkR: r0, species, tint: S.tint };
}

// shared materials with wind sway (instanced) and fake translucency
export function makeTreeMaterials(textures, weatherUniform) {
  const sway = (s, strength) => {
    s.uniforms.uWind = { value: 0 };
    s.uniforms.uTimeT = { value: 0 };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind; uniform float uTimeT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float ph = ip.x * 0.13 + ip.z * 0.17;
          float hk = position.y * position.y * ${strength.toFixed(4)};
          float gust = 0.6 + 0.4 * sin(uTimeT * 0.31 + ph * 0.2);
          transformed.x += sin(uTimeT * 1.3 + ph) * hk * uWind * gust;
          transformed.z += cos(uTimeT * 1.1 + ph * 1.3) * hk * uWind * gust * 0.7;
          float flutter = length(position.xz) * 0.03 * uWind;
          transformed.y += sin(uTimeT * 4.0 + ph + position.x * 2.0) * flutter;
        #endif`);
    return s;
  };
  const mats = {};
  for (const k of ['fir', 'pine']) {
    const t = textures[k];
    const bark = new THREE.MeshStandardMaterial({ map: t.bark, normalMap: t.barkNor, roughnessMap: t.barkArm, roughness: 1 });
    bark.onBeforeCompile = (s) => { sway(s, 0.0004); bark.userData.shader = s; };
    const twig = new THREE.MeshStandardMaterial({ map: t.twig, normalMap: t.twigNor, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82, color: 0xd8e2cc });
    twig.onBeforeCompile = (s) => {
      sway(s, 0.0009);
      // light through needles when looking toward the sun
      // dissolve needles right in front of the camera so the car stays visible in forests
      s.fragmentShader = s.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        { float cd = length(vViewPosition);
          float nz = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (cd < 4.0 && nz > (cd - 1.2) / 2.8) discard; }`);
      s.fragmentShader = s.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.18;`);
      twig.userData.shader = s;
    };
    mats[k] = { bark, twig };
  }
  return mats;
}
