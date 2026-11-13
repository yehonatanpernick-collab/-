// Alpine wildflowers: GPU-placed clumps around the camera (no per-frame CPU cost).
// Four species drawn procedurally into a petal atlas: buttercup, ox-eye daisy, trumpet
// gentian, forget-me-not; edelweiss replaces daisies high up. Density follows the baked
// meadow/flower mask and avoids roads, water, rock, scree, snow and forest.
import * as THREE from 'three';
import { HEIGHT_GLSL } from './glsl.js';
import { ATMO } from './atmosphere.js';

function petalAtlas() {
  const S = 128, c = document.createElement('canvas'); c.width = S * 5; c.height = S;
  const g = c.getContext('2d');
  const flower = (cx, n, len, wid, col, centre, centreR, ring) => {
    g.save(); g.translate(cx + S / 2, S / 2);
    for (let i = 0; i < n; i++) {
      g.rotate(Math.PI * 2 / n);
      const grd = g.createLinearGradient(0, 0, 0, -len);
      grd.addColorStop(0, ring || col); grd.addColorStop(1, col);
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(0, -len / 2, wid, len / 2, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = centre; g.beginPath(); g.arc(0, 0, centreR, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  flower(0, 5, 52, 20, '#ffd21a', '#d99a00', 11, '#ffe866');           // buttercup
  flower(S, 20, 56, 8, '#fbfbf4', '#f0b400', 13, '#ffffff');           // ox-eye daisy
  flower(S * 2, 5, 50, 22, '#3b3fd8', '#1b1f80', 12, '#6c74ff');       // trumpet gentian (deep blue)
  flower(S * 3, 5, 26, 14, '#8fb8ff', '#ffe14a', 7, '#b9d3ff');        // forget-me-not
  flower(S * 4, 9, 50, 13, '#e9ece4', '#d7d9b8', 16, '#f6f7f2');       // edelweiss (woolly white)
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function clumpGeometry(heads = 7) {
  // stem (vertical sliver) + head (two crossed vertical quads + one tilted face-up quad)
  const pos = [], uv = [], part = [], idx = [];
  const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(12345);
  const quad = (a, b, c, d, uvs, p) => { const o = pos.length / 3; pos.push(...a, ...b, ...c, ...d); uv.push(...uvs); part.push(p, p, p, p); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  for (let h = 0; h < heads; h++) {
    const r = Math.sqrt(rnd()) * 0.28, a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, H = 0.14 + rnd() * 0.26, s = 0.07 + rnd() * 0.05;
    const lean = (rnd() - 0.5) * 0.06;
    quad([x - 0.006, 0, z], [x + 0.006, 0, z], [x + 0.006 + lean, H, z], [x - 0.006 + lean, H, z], [0, 0, 1, 0, 1, 1, 0, 1], 0);
    const cx = x + lean, cz = z;
    quad([cx - s, H - s, cz], [cx + s, H - s, cz], [cx + s, H + s, cz], [cx - s, H + s, cz], [0, 0, 1, 0, 1, 1, 0, 1], 1);
    quad([cx, H - s, cz - s], [cx, H - s, cz + s], [cx, H + s, cz + s], [cx, H + s, cz - s], [0, 0, 1, 0, 1, 1, 0, 1], 1);
    quad([cx - s, H + 0.004, cz - s], [cx + s, H + 0.004, cz - s], [cx + s, H + 0.012, cz + s], [cx - s, H + 0.012, cz + s], [0, 0, 1, 0, 1, 1, 0, 1], 1);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

class Flowers {
  constructor(game) {
    const q = game.quality, k = Math.min(1.4, q.grass);
    const R = 34 + 14 * k, SP = 1.05 / Math.sqrt(k);
    const N = Math.floor(2 * R / SP);
    this.R = R; this.SP = SP; this.time = 0;
    const g = clumpGeometry();
    const offs = new Float32Array(N * N * 2);
    let o = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { offs[o++] = i; offs[o++] = j; }
    g.setAttribute('cell', new THREE.InstancedBufferAttribute(offs, 2));
    g.instanceCount = N * N;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const uni = { ...game.terrain.uniforms, uFOrigin: { value: new THREE.Vector2() }, uFSP: { value: SP }, uFR: { value: R }, uFTime: { value: 0 }, uFWind: { value: 1 }, uCar: { value: new THREE.Vector3(1e6, 0, 0) } };
    this.uni = uni;
    const mat = new THREE.MeshStandardMaterial({ map: petalAtlas(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 });
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, uni);
      s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
        ${HEIGHT_GLSL}
        attribute vec2 cell; attribute float part;
        uniform vec2 uFOrigin; uniform float uFSP, uFR, uFTime, uFWind; uniform vec3 uCamPos; uniform sampler2D uNormCore; uniform vec3 uCar;
        varying float vPart; varying vec2 vFUv;`)
        .replace('#include <uv_vertex>', '')
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `
        vec2 gp = uFOrigin + cell * uFSP;
        ivec2 gi = ivec2(floor(gp / uFSP + 0.5) + 30000.0);
        float h1 = hash2(gi.x + 11, gi.y - 7), h2 = hash2(gi.x - 3, gi.y + 19), h3 = hash2(gi.x + 41, gi.y + 5);
        vec2 wp = gp + (vec2(h1, h2) - 0.5) * uFSP * 1.4;
        float d = length(wp - uCamPos.xz);
        vec4 ma = texture(uMaskA, maskUV(wp)), mb = texture(uMaskB, maskUV(wp));
        vec4 nn = texture(uNormCore, ((wp + CORE_HALF) / CORE_CELL + 0.5) / float(CORE_N));
        float slope = 1.0 - (nn.y * 2.0 - 1.0);
        float hgt = terrainHeight(wp);
        float meadow = clamp(mb.b * 1.6 + 0.12, 0.0, 1.0);
        float dens = meadow * (1.0 - mb.r * 1.5) * (1.0 - mb.g * 1.4) * (1.0 - ma.a * 1.3) * (1.0 - mb.a * 1.2) * (1.0 - ma.b * 0.85)
                   * (1.0 - smoothstep(0.16, 0.3, slope)) * (1.0 - smoothstep(2500.0, 2750.0, hgt));
        float sc = (h3 < dens * 0.85 ? 1.0 : 0.0) * (1.0 - smoothstep(uFR * 0.75, uFR, d)) * (0.8 + 0.5 * h1);
        sc *= smoothstep(1.3, 2.4, length(wp - uCar.xz));
        float yaw = h2 * 6.2831853;
        vec3 lp = position;
        lp.xz = mat2(cos(yaw), -sin(yaw), sin(yaw), cos(yaw)) * lp.xz;
        lp *= sc;
        lp.x += sin(uFTime * 2.1 + wp.x * 0.5 + wp.y * 0.3) * 0.035 * position.y * 3.0 * uFWind * sc;
        vec3 transformed = vec3(wp.x, hgt - 0.02, wp.y) + lp;
        // species: high meadows -> gentians & edelweiss, valleys -> buttercups, daisies, forget-me-nots
        float alt = smoothstep(1900.0, 2350.0, hgt + (h1 - 0.5) * 200.0);
        float pick = fract(h3 * 13.7 + h1);
        float sp = alt > 0.5 ? (pick < 0.55 ? 2.0 : 4.0) : (pick < 0.42 ? 0.0 : pick < 0.72 ? 1.0 : pick < 0.86 ? 3.0 : 2.0);
        vFUv = vec2((sp + uv.x) / 5.0, uv.y);
        vPart = part;`);
      s.vertexShader = s.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vMapUv = vFUv;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPart;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          if (vPart < 0.5) { diffuseColor = vec4(0.22, 0.38, 0.12, 1.0); }`)
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.25 * vPart;');
    };
    mat.customProgramCacheKey = () => 'gpu-flowers';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    game.scene.add(this.mesh);
  }
  update(dt, game) {
    this.time += dt;
    const c = game.camera.position;
    this.uni.uFOrigin.value.set(Math.floor((c.x - this.R) / this.SP) * this.SP, Math.floor((c.z - this.R) / this.SP) * this.SP);
    this.uni.uFTime.value = this.time;
    this.uni.uFWind.value = ATMO.misc.w || 0.6;
    this.uni.uCar.value.copy(game.phys.pos);
  }
}

export function create(game) { return new Flowers(game); }
