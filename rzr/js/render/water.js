// Lakes, rivers, waterfalls and ice. Depth comes from the same height textures the
// terrain uses, so absorption, shore foam and transparency follow the real bed.
import * as THREE from 'three';
import { HEIGHT_GLSL } from './glsl.js';
import { FOG_GLSL, atmoUniforms } from './atmosphere.js';

const WATER_VS = /* glsl */`
attribute float flow;      // along-stream distance (m)
attribute float slope;     // bed slope (drop per metre)
attribute float across;    // -1..1 across a river
varying vec3 vW; varying float vFlow; varying float vSlope; varying float vAcross;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vFlow = flow; vSlope = slope; vAcross = across;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WATER_FS = /* glsl */`
${HEIGHT_GLSL}
${FOG_GLSL}
uniform float uTime;
uniform vec3 uDeep, uShallow;
uniform float uRiver;      // 0 lake, 1 river
uniform vec4 uMisc;        // x time, y wetness(rain), z snow, w wind
varying vec3 vW; varying float vFlow; varying float vSlope; varying float vAcross;

vec2 grad2(vec2 p) {  // gradient of a cheap wave noise
  vec2 g = vec2(0.0);
  float a = 1.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 d = vec2(cos(fi * 2.1 + 0.4), sin(fi * 2.1 + 0.4));
    float ph = dot(p, d) * (1.3 + fi * 0.9) + uTime * (1.1 + fi * 0.45);
    g += d * cos(ph) * a * (1.3 + fi * 0.9);
    a *= 0.55;
  }
  return g;
}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float bed = baseHeight(vW.xz);
  float depth = max(vW.y - bed, 0.0);
  // surface normal: wind ripples (lakes) or advected flow ripples (rivers)
  vec2 uv = vW.xz;
  float speed = uRiver > 0.5 ? clamp(0.6 + vSlope * 14.0, 0.6, 7.0) : 0.0;
  vec2 g = vec2(0.0);
  if (uRiver > 0.5) {
    vec2 q = vec2(vAcross * 2.5, vFlow - uTime * speed);
    g = grad2(q * 1.6) * 0.06 + grad2(q * 4.3 + 7.0) * 0.03;
  } else {
    g = grad2(uv * 0.35) * 0.02 + grad2(uv * 1.7 + 3.0) * 0.012 * (0.5 + uMisc.w);
  }
  // rain rings
  g += uMisc.y * vec2(sin(uv.x * 9.0 + uTime * 7.0), cos(uv.y * 9.0 - uTime * 6.0)) * 0.02;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = skyTint(R) * (uRiver > 0.5 ? 0.55 : 0.8);
  // absorption: glacial turquoise in depth, clear over the shallow bed
  float abs1 = 1.0 - exp(-depth * (uRiver > 0.5 ? 0.9 : 0.22));
  vec3 body = mix(uShallow, uDeep, abs1);
  // light reaching into the water
  float sunL = max(uFogSunDir.y, 0.0);
  body *= 0.35 + 0.65 * sunL;
  vec3 col = mix(body, sky, fres);
  // sun glint
  vec3 H = normalize(uFogSunDir + V);
  col += uFogSunColor * pow(max(dot(N, H), 0.0), 380.0) * 6.0;
  // foam: shores, rapids and falls
  float foam = smoothstep(0.35, 0.0, depth) * 0.7;
  if (uRiver > 0.5) {
    float rapid = smoothstep(0.08, 0.6, vSlope);
    vec2 fq = vec2(vAcross * 3.0, (vFlow - uTime * speed) * 0.9);
    float n = 0.5 + 0.5 * sin(fq.y * 2.3 + sin(fq.x * 2.1 + fq.y * 0.7) * 2.0) * sin(fq.x * 3.7 - fq.y * 1.3);
    foam = max(foam, rapid * smoothstep(0.25, 0.8, n));
    foam = max(foam, smoothstep(0.85, 1.0, abs(vAcross)) * 0.18);
  }
  col = mix(col, vec3(0.92, 0.95, 0.97) * (0.4 + 0.6 * sunL), clamp(foam, 0.0, 1.0));
  float alpha = clamp((uRiver > 0.5 ? 0.12 : 0.22) + abs1 * 0.85 + fres * 0.55 + foam, 0.0, 1.0);
  alpha *= smoothstep(0.0, 0.05, depth + 0.02);
  if (uRiver > 0.5) alpha *= smoothstep(1.0, 0.85, abs(vAcross)) * 0.9 + 0.1;
  vec4 atm = atmosphere(cameraPosition, vW);
  col = mix(col, atm.rgb, atm.a);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Water {
  constructor(world, terrain, scene) {
    this.world = world;
    this.uniforms = {
      ...terrain.uniforms,
      ...atmoUniforms,
      uTime: { value: 0 },
    };
    this.group = new THREE.Group();
    this.scene = scene;
    this.mats = [];
    const meta = world.meta;
    // lakes
    for (const L of meta.lakes) {
      if (L.frozen) { this.group.add(this._ice(L)); continue; }
      const shape = L.shape;
      const n = shape.length;
      const pos = [L.x, L.level, L.z];
      for (const [x, z] of shape) {
        const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
        const k = (d + 45) / d;
        pos.push(L.x + dx * k, L.level, L.z + dz * k);
      }
      const idx = [];
      for (let i = 0; i < n; i++) idx.push(0, 1 + ((i + 1) % n), 1 + i);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const cnt = pos.length / 3;
      g.setAttribute('flow', new THREE.Float32BufferAttribute(new Float32Array(cnt), 1));
      g.setAttribute('slope', new THREE.Float32BufferAttribute(new Float32Array(cnt), 1));
      g.setAttribute('across', new THREE.Float32BufferAttribute(new Float32Array(cnt), 1));
      g.setIndex(idx);
      const m = this._mat(false, L.color);
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
    // rivers
    for (const r of meta.rivers) this.group.add(this._river(r));
    scene.add(this.group);
  }

  _mat(river, color) {
    const deep = new THREE.Color(...color).multiplyScalar(river ? 0.6 : 0.8);
    const m = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uDeep: { value: deep }, uShallow: { value: river ? new THREE.Color(0.14, 0.2, 0.17) : new THREE.Color(0.22, 0.34, 0.3) }, uRiver: { value: river ? 1 : 0 } },
      vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mats.push(m);
    return m;
  }

  _river(r) {
    const pts = r.pts, n = pts.length;
    const cols = 5;
    const pos = new Float32Array(n * cols * 3), flow = new Float32Array(n * cols), slope = new Float32Array(n * cols), across = new Float32Array(n * cols);
    let dist = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[2] - a[2]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      if (i > 0) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2], pts[i][1] - pts[i - 1][1]);
      const s = Math.max(0, (a[1] - b[1]) / L);
      const w = pts[i][3] + 1.2;
      for (let c = 0; c < cols; c++) {
        const t = c / (cols - 1) * 2 - 1;
        const k = i * cols + c;
        pos[k * 3] = pts[i][0] - dz * w * t; pos[k * 3 + 1] = pts[i][1] + 0.04; pos[k * 3 + 2] = pts[i][2] + dx * w * t;
        flow[k] = dist; slope[k] = s; across[k] = t;
      }
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) for (let c = 0; c < cols - 1; c++) { const a = i * cols + c, b = a + 1, d = a + cols, e = d + 1; idx.push(a, d, b, b, d, e); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('flow', new THREE.BufferAttribute(flow, 1)); g.setAttribute('slope', new THREE.BufferAttribute(slope, 1)); g.setAttribute('across', new THREE.BufferAttribute(across, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this._mat(true, [0.08, 0.32, 0.34]));
    mesh.renderOrder = 2;
    return mesh;
  }

  _ice(L) {
    const shape = L.shape;
    const s = new THREE.Shape(shape.map(([x, z]) => new THREE.Vector2(x - L.x, -(z - L.z))));
    const g = new THREE.ShapeGeometry(s, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: 0xcfe2ee, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.92 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(L.x, L.level + 0.03, L.z);
    mesh.receiveShadow = true;
    // snow drifts on the ice
    const snow = new THREE.Mesh(new THREE.CircleGeometry(L.r * 0.5, 24), new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.9, transparent: true, opacity: 0.55 }));
    snow.rotation.x = -Math.PI / 2; snow.position.set(L.x + 10, L.level + 0.05, L.z - 8);
    const grp = new THREE.Group(); grp.add(mesh, snow);
    return grp;
  }

  update(dt, scene) {
    this.uniforms.uTime.value += dt;
    for (const m of this.mats) m.uniforms.uTime.value = this.uniforms.uTime.value;
  }
}
