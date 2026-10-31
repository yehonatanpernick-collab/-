import * as THREE from 'three';
import * as A from './assets.js';

// Heightfield terrain with 4-layer texture splatting (grass / dirt / rock(triplanar) / snow-or-ash).
export class Terrain {
  constructor(def, Q) {
    this.def = def; this.size = def.size; this.res = Q.terrainRes;
    const N = this.res, S = this.size, half = S / 2;
    this.N = N; this.cell = S / N;
    const H = this.heights = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H[j * (N + 1) + i] = def.height(i * this.cell - half, j * this.cell - half);
  }
  h(i, j) { const N = this.N; i = i < 0 ? 0 : i > N ? N : i; j = j < 0 ? 0 : j > N ? N : j; return this.heights[j * (N + 1) + i]; }
  heightAt(x, z) {
    const fx = (x + this.size / 2) / this.cell, fz = (z + this.size / 2) / this.cell;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    // match triangle split used by PlaneGeometry
    const h00 = this.h(i, j), h10 = this.h(i + 1, j), h01 = this.h(i, j + 1), h11 = this.h(i + 1, j + 1);
    if (u + v < 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.cell;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }
  async build(scene) {
    const def = this.def, N = this.N, S = this.size;
    const g = new THREE.PlaneGeometry(S, S, N, N); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setY(k, this.heights[k]);
    g.computeVertexNormals();
    const nor = g.attributes.normal, splat = new Float32Array(pos.count * 4);
    const grassMask = new Float32Array((N + 1) * (N + 1));
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k), y = pos.getY(k), slope = 1 - nor.getY(k);
      const w = def.splat(x, z, y, slope);
      const s = w[0] + w[1] + w[2] + w[3] || 1;
      splat[k * 4] = w[0] / s; splat[k * 4 + 1] = w[1] / s; splat[k * 4 + 2] = w[2] / s; splat[k * 4 + 3] = w[3] / s;
      grassMask[k] = def.grass ? def.grass(x, z, y, slope, w) : 0;
    }
    this.grassMask = grassMask;
    g.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
    g.computeBoundingSphere();
    const [grass, dirt, dirtN, rock, rockN, noise] = await Promise.all([A.tex('tex/grass.jpg'), A.tex('tex/dirt_color.jpg'), A.tex('tex/dirt_normal.jpg', { srgb: false }), A.tex('tex/stone_color.webp'), A.tex('tex/stone_normal.webp', { srgb: false }), A.tex('tex/noise.png', { srgb: false })]);
    const L = def.layers;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    const U = this.uniforms = {
      tGrass: { value: grass }, tDirt: { value: dirt }, tDirtN: { value: dirtN }, tRock: { value: rock }, tRockN: { value: rockN }, tNoise: { value: noise },
      uGrassTint: { value: new THREE.Color(L.grass) }, uGrassTint2: { value: new THREE.Color(L.grass2 || L.grass) }, uDirtTint: { value: new THREE.Color(L.dirt) }, uRockTint: { value: new THREE.Color(L.rock) },
      uSnow: { value: new THREE.Color(L.snow) }, uSnowRough: { value: L.snowRough ?? 0.55 }, uGlow: { value: new THREE.Color(L.glow || '#000000') },
    };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splat; varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNor;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat; vWPos = (modelMatrix * vec4(position,1.)).xyz; vWNor = normalize(mat3(modelMatrix) * normal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tGrass, tDirt, tDirtN, tRock, tRockN, tNoise; uniform vec3 uGrassTint, uGrassTint2, uDirtTint, uRockTint, uSnow, uGlow; uniform float uSnowRough;
          varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNor;
          vec3 tri(sampler2D t, vec3 p, vec3 n, float s){ vec3 b = pow(abs(n), vec3(4.)); b /= dot(b, vec3(1.));
            return texture2D(t, p.zy*s).rgb*b.x + texture2D(t, p.xz*s).rgb*b.y + texture2D(t, p.xy*s).rgb*b.z; }
          vec4 hb(vec4 w, vec4 hgt){ vec4 v = w + hgt * 0.35; float m = max(max(v.x, v.y), max(v.z, v.w)) - 0.25; vec4 r = max(v - m, 0.); return r / max(dot(r, vec4(1.)), 1e-4); }`)
        .replace('#include <map_fragment>', `
          vec3 P = vWPos; vec3 Nw = normalize(vWNor);
          float nz = texture2D(tNoise, P.xz * 0.013).r; float nz2 = texture2D(tNoise, P.xz * 0.061).g;
          vec3 g1 = texture2D(tGrass, P.xz * 0.21).rgb, g2 = texture2D(tGrass, P.xz * 0.043 + 0.37).rgb;
          vec3 gc = mix(g1, g2, 0.45) * mix(uGrassTint, uGrassTint2, smoothstep(0.3, 0.7, nz)) * (0.85 + nz2 * 0.3);
          vec3 dc = mix(texture2D(tDirt, P.xz * 0.16).rgb, texture2D(tDirt, P.xz * 0.037).rgb, 0.4) * uDirtTint;
          vec3 rc = tri(tRock, P, Nw, 0.11) * uRockTint * (0.85 + nz * 0.3);
          vec3 sc = uSnow * (0.9 + nz2 * 0.15);
          vec4 hw = hb(vSplat, vec4(dot(gc, vec3(0.33)), dot(dc, vec3(0.33)), dot(rc, vec3(0.5)), nz2));
          diffuseColor.rgb *= gc * hw.x + dc * hw.y + rc * hw.z + sc * hw.w;
          float wRough = 0.95 * hw.x + 0.9 * hw.y + 0.78 * hw.z + uSnowRough * hw.w;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = wRough;')
        .replace('#include <normal_fragment_maps>', `{
            vec3 dn = texture2D(tDirtN, P.xz * 0.16).xyz * 2. - 1.;
            vec3 rn = tri(tRockN, P, Nw, 0.11) * 2. - 1.;
            vec2 det = dn.xy * (hw.y * 0.9 + hw.x * 0.35) + rn.xy * hw.z * 1.2;
            vec3 wn = normalize(Nw + vec3(det.x, 0., det.y) * 0.6);
            normal = normalize((viewMatrix * vec4(wn, 0.)).xyz);
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += uGlow * hw.w * smoothstep(0.55, 0.9, texture2D(tNoise, P.xz * 0.05 + vec2(0., 0.)).b);`);
    };
    this.mesh = new THREE.Mesh(g, mat); this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    // height + grass texture for GPU grass and water depth
    const T = new Float32Array((N + 1) * (N + 1) * 4);
    for (let k = 0; k < (N + 1) * (N + 1); k++) { T[k * 4] = this.heights[k]; T[k * 4 + 1] = grassMask[k]; T[k * 4 + 3] = 1; }
    this.dataTex = new THREE.DataTexture(T, N + 1, N + 1, THREE.RGBAFormat, THREE.FloatType);
    this.dataTex.needsUpdate = true;
    return this;
  }
}
