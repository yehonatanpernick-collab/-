// ============================================================
//  משמר האפר — World: terrain, sky, ruins, props, atmosphere
// ============================================================
import * as THREE from 'three';
import { mergeGeometries } from './lib/utils/BufferGeometryUtils.js';

// ---------- deterministic randomness & noise ----------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(90210);
const rr = (a, b) => a + (b - a) * rng();

function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, y, p = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (q) => (p ? ((q % p) + p) % p : q);
  const a = hash2(w(xi), w(yi)), b = hash2(w(xi + 1), w(yi));
  const c = hash2(w(xi), w(yi + 1)), d = hash2(w(xi + 1), w(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4, p = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, p ? p * f : 0);
    n += a; a *= 0.5; f *= 2;
  }
  return s / n;
}
export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------- terrain ----------
export const ARENA_R = 33;
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  let h = (fbm(x * 0.06 + 10, z * 0.06 + 10, 3) - 0.5) * 1.3;
  h *= smooth(3.5, 10, r);
  const rim = smooth(ARENA_R + 5, ARENA_R + 32, r);
  h += rim * (5 + fbm(x * 0.035 + 3, z * 0.035 + 1, 4) * 20);
  return h;
}

// ---------- procedural textures ----------
function canvas(n) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
}
function normalFromHeight(hgt, N, strength) {
  const c = canvas(N), ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const l = hgt[y * N + ((x - 1 + N) % N)], r = hgt[y * N + ((x + 1) % N)];
    const u = hgt[((y - 1 + N) % N) * N + x], d = hgt[((y + 1) % N) * N + x];
    let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    const i = (y * N + x) * 4;
    img.data[i] = (nx / len * 0.5 + 0.5) * 255;
    img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
    img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function tex(c, srgb, rep = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function groundTextures() {
  const N = 512, P = 8;
  const hgt = new Float32Array(N * N);
  const c = canvas(N), ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x / N) * P, v = (y / N) * P;
    const n = fbm(u, v, 5, P);
    const m = fbm(u * 0.5 + 3.1, v * 0.5 + 7.7, 3, P / 2);
    const pb = vnoise(u * 6, v * 6, P * 6);
    const crack = Math.abs(fbm(u * 1.5 + 9, v * 1.5, 3, P * 1.5) - 0.5);
    let r = 30, g = 25, b = 24;
    const k = 0.55 + 0.9 * n;
    r *= k; g *= k; b *= k;
    const moss = smooth(0.52, 0.68, m);
    r += (22 - r) * moss * 0.6; g += (34 - g) * moss * 0.6; b += (22 - b) * moss * 0.6;
    let hh = n * 0.7;
    if (pb > 0.8) { const s = smooth(0.8, 0.9, pb); r += 30 * s; g += 28 * s; b += 28 * s; hh += s * 0.5; }
    if (crack < 0.02) { r *= 0.5; g *= 0.5; b *= 0.5; hh -= 0.3; }
    hgt[y * N + x] = hh;
    const i = (y * N + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { map: tex(c, true), normal: tex(normalFromHeight(hgt, N, 6), false) };
}

function stoneTextures() {
  const N = 512;
  const hgt = new Float32Array(N * N);
  const c = canvas(N), ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  const rows = 8, cols = 4;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const ry = Math.floor((y / N) * rows);
    const off = ry % 2 ? 0.5 : 0;
    const bxF = (x / N) * cols + off;
    const bx = Math.floor(bxF) % cols;
    const fx = bxF - Math.floor(bxF), fy = (y / N) * rows - ry;
    const edge = Math.min(fx, 1 - fx) * 2.2, edgeY = Math.min(fy, 1 - fy);
    const mortar = Math.min(edge, edgeY);
    const tone = hash2(bx + 17, ry + 3);
    const n = fbm((x / N) * 16, (y / N) * 16, 4, 16);
    let v = 48 + tone * 26 + (n - 0.5) * 40;
    let hh = 0.6 + n * 0.4;
    if (mortar < 0.06) { v *= 0.45; hh = 0.1 + n * 0.1; }
    else hh -= (1 - smooth(0.06, 0.18, mortar)) * 0.4;
    const moss = smooth(0.6, 0.75, fbm((x / N) * 4 + 5, (y / N) * 4, 3, 4)) * (y / N);
    const i = (y * N + x) * 4;
    img.data[i] = v * (1 - moss * 0.3);
    img.data[i + 1] = v * 0.94 + moss * 8;
    img.data[i + 2] = v * 0.98 * (1 - moss * 0.3);
    img.data[i + 3] = 255;
    hgt[y * N + x] = hh;
  }
  ctx.putImageData(img, 0, 0);
  return { map: tex(c, true), normal: tex(normalFromHeight(hgt, N, 4), false) };
}

export function softSpriteTexture(N = 128, noisy = true) {
  const c = canvas(N), ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x / N - 0.5, dy = y / N - 0.5;
    const d = Math.hypot(dx, dy) * 2;
    let a = Math.max(0, 1 - d);
    a = a * a;
    if (noisy) a *= 0.4 + 0.9 * fbm((x / N) * 4, (y / N) * 4, 4, 4);
    const i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

// ---------- geometry helpers ----------
export function pointedArchShape(w, t, leg) {
  const s = new THREE.Shape();
  const R = w + t, ao = Math.acos(-(w / 2) / R);
  s.moveTo(-(w / 2 + t), -leg);
  s.lineTo(-(w / 2 + t), 0);
  s.absarc(w / 2, 0, R, Math.PI, ao, true);
  s.absarc(-w / 2, 0, R, Math.PI - ao, 0, true);
  s.lineTo(w / 2 + t, -leg);
  s.lineTo(-(w / 2 + t), -leg);
  const h = new THREE.Path();
  h.moveTo(-w / 2, -leg);
  h.lineTo(-w / 2, 0);
  h.absarc(w / 2, 0, w, Math.PI, (2 * Math.PI) / 3, true);
  h.absarc(-w / 2, 0, w, Math.PI / 3, 0, true);
  h.lineTo(w / 2, -leg);
  h.lineTo(-w / 2, -leg);
  s.holes.push(h);
  return s;
}
function lancetPath(cx, cy, w, leg) {
  // a pointed window hole whose straight part starts at cy and is `leg` tall
  const h = new THREE.Path();
  h.moveTo(cx - w / 2, cy);
  h.lineTo(cx - w / 2, cy + leg);
  h.absarc(cx + w / 2, cy + leg, w, Math.PI, (2 * Math.PI) / 3, true);
  h.absarc(cx - w / 2, cy + leg, w, Math.PI / 3, 0, true);
  h.lineTo(cx + w / 2, cy);
  h.lineTo(cx - w / 2, cy);
  return h;
}
const ni = (g) => (g.index ? g.toNonIndexed() : g);
function scaleUV(g, sx, sy) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  return g;
}

// ============================================================
export function buildWorld(scene) {
  const colliders = []; // {x, z, r}
  const flames = [];    // fire emitters {pos: Vector3, light}
  const updaters = [];

  const ground = groundTextures();
  const stone = stoneTextures();

  // ---- sky dome ----
  const moonDir = new THREE.Vector3(-0.32, 0.36, -1).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { moonDir: { value: moonDir }, time: { value: 0 }, flash: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir; uniform vec3 moonDir; uniform float time; uniform float flash;
      float h3(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 top = vec3(0.006,0.004,0.014);
        vec3 mid = vec3(0.035,0.012,0.03);
        vec3 hor = vec3(0.11,0.035,0.045);
        vec3 col = mix(hor, mid, smoothstep(-0.02,0.18,h));
        col = mix(col, top, smoothstep(0.15,0.75,h));
        float m = max(dot(d, moonDir), 0.0);
        // stars
        vec3 sp = d*240.0; vec3 cell = floor(sp); vec3 f = fract(sp)-0.5;
        float s = h3(cell);
        if (s > 0.985) {
          vec3 o = vec3(h3(cell+1.3), h3(cell+2.7), h3(cell+4.1))-0.5;
          float st = smoothstep(0.22, 0.0, length(f - o*0.6));
          float tw = 0.6+0.4*sin(time*2.0 + s*400.0);
          col += vec3(0.9,0.85,1.0) * st * tw * smoothstep(0.05,0.3,h) * (s-0.985)*90.0 * 0.06;
        }
        // clouds
        vec2 cp = d.xz/(h+0.18)*1.6 + vec2(time*0.012, time*0.004);
        float cl = smoothstep(0.42, 0.8, fbm(cp));
        float cl2 = smoothstep(0.5, 0.9, fbm(cp*2.1+5.0));
        // moon glow
        vec3 glow = vec3(0.75,0.12,0.06)*pow(m,90.0)*1.4 + vec3(0.32,0.04,0.04)*pow(m,10.0)*0.35 + vec3(0.12,0.02,0.03)*pow(m,3.0)*0.25;
        col += glow;
        // moon disc w/ craters
        float disc = smoothstep(0.99935, 0.99955, m);
        vec3 mt = normalize(cross(moonDir, vec3(0,1,0))); vec3 mb = cross(mt, moonDir);
        vec2 mu = vec2(dot(d,mt), dot(d,mb))*900.0;
        float crat = fbm(mu*0.18+3.0);
        vec3 moonCol = mix(vec3(1.6,0.42,0.26), vec3(0.9,0.16,0.1), smoothstep(0.35,0.7,crat)) * 2.2;
        col = mix(col, moonCol, disc);
        // clouds over everything, rim-lit by moon
        vec3 cloudCol = mix(vec3(0.02,0.012,0.02), vec3(0.35,0.07,0.05), pow(m,14.0));
        float ca = (cl*0.85 + cl2*0.4) * smoothstep(-0.02,0.12,h);
        col = mix(col, cloudCol, clamp(ca,0.0,0.92));
        col += vec3(0.5,0.25,0.45) * flash * (0.3 + cl) * smoothstep(-0.1,0.3,h);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  updaters.push((t) => { skyMat.uniforms.time.value = t; });

  // ---- distant mountain silhouettes ----
  function ridge(radius, minH, maxH, color, seed) {
    const seg = 220;
    const g = new THREE.CylinderGeometry(radius, radius, 1, seg, 1, true);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) {
        const x = pos.getX(i), z = pos.getZ(i);
        const a = Math.atan2(z, x);
        const n = fbm(Math.cos(a) * 3 + seed, Math.sin(a) * 3 + seed, 5);
        const peak = Math.pow(n, 1.6);
        pos.setY(i, minH + peak * (maxH - minH) * 1.8);
      } else pos.setY(i, -10);
    }
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false }));
    scene.add(m);
  }
  ridge(330, 20, 70, 0x14090d, 4.2);
  ridge(240, 15, 55, 0x0c060a, 9.7);

  // ---- ground ----
  const gg = new THREE.PlaneGeometry(320, 320, 220, 220);
  gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position;
  const cols = new Float32Array(gp.count * 3);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    gp.setY(i, heightAt(x, z));
    const r = Math.hypot(x, z);
    const moss = smooth(0.55, 0.7, fbm(x * 0.05, z * 0.05, 3));
    const dark = 0.75 + 0.35 * fbm(x * 0.12 + 4, z * 0.12, 3);
    const rimDark = 1 - 0.35 * smooth(ARENA_R, ARENA_R + 25, r);
    const scorch = 1 - 0.4 * (1 - smooth(3, 7, r));
    cols[i * 3] = dark * rimDark * scorch * (1 - moss * 0.25) * 1.05;
    cols[i * 3 + 1] = dark * rimDark * scorch * (1 + moss * 0.15);
    cols[i * 3 + 2] = dark * rimDark * scorch * (1 - moss * 0.15) * 1.08;
  }
  gg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  gg.computeVertexNormals();
  ground.map.repeat.set(48, 48);
  ground.normal.repeat.set(48, 48);
  const groundMat = new THREE.MeshStandardMaterial({
    map: ground.map, normalMap: ground.normal, normalScale: new THREE.Vector2(1.3, 1.3),
    vertexColors: true, roughness: 0.96, metalness: 0,
  });
  const groundMesh = new THREE.Mesh(gg, groundMat);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ---- stone material ----
  const stoneMat = new THREE.MeshStandardMaterial({
    map: stone.map, normalMap: stone.normal, normalScale: new THREE.Vector2(1.6, 1.6),
    roughness: 0.92, color: 0x9a9098,
  });
  const darkStoneMat = stoneMat.clone();
  darkStoneMat.color = new THREE.Color(0x5a5258);

  // ---- central altar & ember crystal ----
  const altar = new THREE.Group();
  const step1 = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(4.0, 4.3, 0.35, 40), 6, 0.4), darkStoneMat);
  step1.position.y = 0.17;
  const step2 = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(3.2, 3.4, 0.35, 40), 5, 0.4), stoneMat);
  step2.position.y = 0.5;
  altar.add(step1, step2);
  // rune circle on the altar
  const runeCanvas = canvas(512); {
    const ctx = runeCanvas.getContext('2d');
    ctx.translate(256, 256);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, 230, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 200, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 110, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 7; i++) { // heptagram
      const a1 = (i / 7) * Math.PI * 2, a2 = (((i + 3) % 7) / 7) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(a1) * 200, Math.sin(a1) * 200); ctx.lineTo(Math.cos(a2) * 200, Math.sin(a2) * 200); ctx.stroke();
    }
    ctx.font = 'bold 26px serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    const glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
    for (let i = 0; i < 24; i++) {
      ctx.save(); ctx.rotate((i / 24) * Math.PI * 2); ctx.fillText(glyphs[i], 0, -208); ctx.restore();
    }
  }
  const runeTex = new THREE.CanvasTexture(runeCanvas);
  const runeMat = new THREE.MeshBasicMaterial({ map: runeTex, color: new THREE.Color(0.9, 0.35, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const rune = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), runeMat);
  rune.rotation.x = -Math.PI / 2; rune.position.y = 0.69;
  altar.add(rune);
  // crystal
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x2a0a40, emissive: 0x9a40ff, emissiveIntensity: 2.4, roughness: 0.15, metalness: 0.3, flatShading: true });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 0), crystalMat);
  crystal.scale.set(0.8, 1.7, 0.8);
  crystal.position.y = 3.1;
  crystal.castShadow = true;
  altar.add(crystal);
  const shardMat = crystalMat.clone(); shardMat.emissiveIntensity = 1.5;
  const shards = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), shardMat);
    s.scale.y = 2; altar.add(s); shards.push(s);
  }
  const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.5, 2.5), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.02, 6, 80), haloMat);
  halo.position.y = 3.1; altar.add(halo);
  const crystalLight = new THREE.PointLight(0xa050ff, 30, 22, 1.6);
  crystalLight.position.y = 3.1;
  altar.add(crystalLight);
  // ritual monoliths around the altar
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const h = rr(2.2, 3.2);
    const m = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(0.55, h, 0.4), 0.5, h / 3), darkStoneMat);
    m.position.set(Math.cos(a) * 3.7, h / 2 + 0.3, Math.sin(a) * 3.7);
    m.rotation.y = -a; m.rotation.z = rr(-0.08, 0.08);
    m.castShadow = m.receiveShadow = true;
    altar.add(m);
  }
  scene.add(altar);
  colliders.push({ x: 0, z: 0, r: 4.1 });
  updaters.push((t) => {
    crystal.rotation.y = t * 0.5;
    crystal.position.y = 3.1 + Math.sin(t * 1.3) * 0.15;
    halo.rotation.x = Math.PI / 2 + Math.sin(t * 0.7) * 0.3;
    halo.rotation.y = t * 0.4;
    shards.forEach((s, i) => {
      const a = t * 0.8 + (i / 5) * Math.PI * 2;
      s.position.set(Math.cos(a) * 1.25, 3.1 + Math.sin(t * 2 + i) * 0.35, Math.sin(a) * 1.25);
      s.rotation.y = t * 2 + i;
    });
    rune.rotation.z = t * 0.05;
    runeMat.color.setRGB(0.9, 0.35, 1.6).multiplyScalar(0.7 + 0.3 * Math.sin(t * 1.7));
    crystalLight.intensity = 26 + Math.sin(t * 2.3) * 4 + Math.sin(t * 7.1) * 2;
  });

  // ---- ring of ruined gothic pillars & arches ----
  const PILLARS = 18, PR = 29;
  const pillarInfo = [];
  for (let i = 0; i < PILLARS; i++) {
    const a = (i / PILLARS) * Math.PI * 2;
    const archPair = i % 3 !== 2;               // pairs (0,1),(3,4)... get arches
    const broken = !archPair || rng() < 0.15;
    const h = broken ? rr(2.0, 5.5) : 8.5;
    pillarInfo.push({ a, h, broken });
  }
  const pillarGeos = [];
  for (let i = 0; i < PILLARS; i++) {
    const { a, h } = pillarInfo[i];
    const x = Math.cos(a) * PR, z = Math.sin(a) * PR;
    const y0 = heightAt(x, z) - 0.3;
    const base = scaleUV(new THREE.BoxGeometry(1.9, 0.9, 1.9), 1, 0.5);
    base.translate(0, 0.45, 0);
    const shaft = scaleUV(new THREE.CylinderGeometry(0.62, 0.7, h, 10, Math.max(1, Math.round(h))), 3, h / 2.5);
    shaft.translate(0, h / 2 + 0.9, 0);
    // jagged broken tops
    if (pillarInfo[i].broken) {
      const p = shaft.attributes.position;
      for (let k = 0; k < p.count; k++) if (p.getY(k) > h + 0.85) p.setY(k, p.getY(k) - rng() * 0.9);
      shaft.computeVertexNormals();
    }
    const parts = [base, shaft];
    if (!pillarInfo[i].broken) {
      const cap = scaleUV(new THREE.BoxGeometry(1.7, 0.6, 1.7), 1, 0.4);
      cap.translate(0, h + 0.9 + 0.3, 0);
      parts.push(cap);
    }
    const g = mergeGeometries(parts.map((q) => ni(q)));
    g.rotateY(-a + rr(-0.2, 0.2));
    g.translate(x, y0, z);
    pillarGeos.push(g.index ? ni(g) : g);
    colliders.push({ x, z, r: 1.15 });
    // fallen drums
    if (pillarInfo[i].broken && rng() < 0.8) {
      const n = 1 + Math.floor(rng() * 2);
      for (let k = 0; k < n; k++) {
        const len = rr(1.2, 2.6);
        const d = scaleUV(new THREE.CylinderGeometry(0.62, 0.62, len, 10), 3, 1);
        d.rotateZ(Math.PI / 2);
        d.rotateY(rr(0, Math.PI));
        const ox = x + rr(-3, 3), oz = z + rr(-3, 3);
        if (Math.hypot(ox, oz) > ARENA_R - 1) continue;
        d.translate(ox, heightAt(ox, oz) + 0.45, oz);
        pillarGeos.push(ni(d));
        colliders.push({ x: ox, z: oz, r: 0.9 });
      }
    }
  }
  const pillarMesh = new THREE.Mesh(mergeGeometries(pillarGeos), stoneMat);
  pillarMesh.castShadow = pillarMesh.receiveShadow = true;
  scene.add(pillarMesh);
  // arches
  const archGeos = [];
  for (let i = 0; i < PILLARS; i++) {
    const j = (i + 1) % PILLARS;
    if (i % 3 !== 0 || pillarInfo[i].broken || pillarInfo[j].broken) continue;
    const a1 = pillarInfo[i].a, a2 = pillarInfo[j].a;
    const p1 = new THREE.Vector3(Math.cos(a1) * PR, 0, Math.sin(a1) * PR);
    const p2 = new THREE.Vector3(Math.cos(a2) * PR, 0, Math.sin(a2) * PR);
    const span = p1.distanceTo(p2);
    const shape = pointedArchShape(span - 0.6, 0.75, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false, curveSegments: 14 });
    g.translate(0, 0, -0.5);
    g.scale(1, 0.55, 1);
    // world uv-ish: use planar uvs
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 0.35, uv.getY(k) * 0.35);
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    const y = Math.min(heightAt(p1.x, p1.z), heightAt(p2.x, p2.z)) - 0.3 + 8.5 + 0.9 + 0.6;
    const ang = Math.atan2(p2.z - p1.z, p2.x - p1.x);
    g.rotateY(-ang);
    g.translate(mid.x, y, mid.z);
    archGeos.push(ni(g));
  }
  if (archGeos.length) {
    const archMesh = new THREE.Mesh(mergeGeometries(archGeos), stoneMat);
    archMesh.castShadow = archMesh.receiveShadow = true;
    scene.add(archMesh);
  }

  // ---- outer broken wall segments ----
  {
    const wallGeos = [];
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const r = rr(36, 46);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const w = rr(2, 6), h = rr(1.2, 4.5);
      const g = scaleUV(new THREE.BoxGeometry(w, h, 0.9, 4, 3, 1), w / 3, h / 3);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) if (p.getY(k) > h / 2 - 0.01) p.setY(k, p.getY(k) - rng() * h * 0.5);
      g.computeVertexNormals();
      g.rotateY(-a + Math.PI / 2 + rr(-0.3, 0.3));
      g.translate(x, heightAt(x, z) + h / 2 - 0.5, z);
      wallGeos.push(ni(g));
    }
    const wm = new THREE.Mesh(mergeGeometries(wallGeos), darkStoneMat);
    wm.castShadow = wm.receiveShadow = true;
    scene.add(wm);
  }

  // ---- gravestones (instanced) ----
  {
    const head = new THREE.BoxGeometry(0.62, 0.8, 0.14);
    head.translate(0, 0.4, 0);
    const top = new THREE.CylinderGeometry(0.31, 0.31, 0.14, 16, 1, false, 0, Math.PI);
    top.rotateX(Math.PI / 2); top.rotateZ(Math.PI / 2); top.translate(0, 0.8, 0);
    const stoneGeo = mergeGeometries([ni(head), ni(top)]);
    const crossA = new THREE.BoxGeometry(0.13, 1.25, 0.13); crossA.translate(0, 0.62, 0);
    const crossB = new THREE.BoxGeometry(0.62, 0.13, 0.13); crossB.translate(0, 0.9, 0);
    const crossGeo = mergeGeometries([crossA, crossB]);
    const graveMat = new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normal, color: 0x7a747c, roughness: 0.95 });
    const N1 = 150, N2 = 46;
    const im1 = new THREE.InstancedMesh(stoneGeo, graveMat, N1);
    const im2 = new THREE.InstancedMesh(crossGeo, graveMat, N2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const place = (im, n, rMin, rMax) => {
      let c = 0, guard = 0;
      while (c < n && guard++ < 5000) {
        const a = rng() * Math.PI * 2, r = rr(rMin, rMax);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (colliders.some((cc) => Math.hypot(cc.x - x, cc.z - z) < cc.r + 0.9)) continue;
        // keep a few open lanes free of graves
        const lane = Math.abs(Math.sin(a * 3));
        if (lane < 0.12 && r < 26) continue;
        p.set(x, heightAt(x, z) - 0.08, z);
        e.set(rr(-0.18, 0.18), Math.atan2(x, z) + rr(-0.35, 0.35), rr(-0.2, 0.2));
        q.setFromEuler(e);
        const sc = rr(0.75, 1.3); s.set(sc, sc * rr(0.9, 1.25), sc);
        m.compose(p, q, s);
        im.setMatrixAt(c, m);
        im.setColorAt(c, new THREE.Color().setHSL(0.75, 0.04, rr(0.35, 0.65)));
        c++;
      }
      im.count = c;
    };
    place(im1, N1, 8.5, 31);
    place(im2, N2, 9, 40);
    for (const im of [im1, im2]) { im.castShadow = im.receiveShadow = true; scene.add(im); }
  }

  // ---- dead trees (merged) ----
  {
    const geos = [];
    const up = new THREE.Vector3(0, 1, 0);
    function branch(start, dir, len, rad, depth) {
      const g = new THREE.CylinderGeometry(rad * 0.62, rad, len, 6, 2);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) { // gnarl
        p.setX(k, p.getX(k) + (rng() - 0.5) * rad * 0.4);
        p.setZ(k, p.getZ(k) + (rng() - 0.5) * rad * 0.4);
      }
      g.translate(0, len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      g.applyQuaternion(q);
      g.translate(start.x, start.y, start.z);
      geos.push(ni(g));
      const end = start.clone().addScaledVector(dir, len);
      if (depth <= 0 || rad < 0.03) return;
      const kids = depth > 3 ? 2 : 2 + Math.floor(rng() * 2);
      for (let k = 0; k < kids; k++) {
        const nd = dir.clone().add(new THREE.Vector3(rr(-1, 1), rr(-0.25, 0.7), rr(-1, 1)).multiplyScalar(0.85)).normalize();
        if (nd.y < -0.2) nd.y = -0.2;
        nd.normalize();
        branch(end, nd, len * rr(0.6, 0.82), rad * rr(0.55, 0.7), depth - 1);
      }
    }
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const r = i < 9 ? rr(14, 27) : rr(34, 60);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (colliders.some((cc) => Math.hypot(cc.x - x, cc.z - z) < cc.r + 1.5)) continue;
      const sc = rr(0.8, 1.6);
      branch(new THREE.Vector3(x, heightAt(x, z) - 0.3, z),
        new THREE.Vector3(rr(-0.2, 0.2), 1, rr(-0.2, 0.2)).normalize(), 2.6 * sc, 0.32 * sc, 5);
      if (r < ARENA_R) colliders.push({ x, z, r: 0.55 * sc });
    }
    const bark = new THREE.MeshStandardMaterial({ color: 0x1f1714, roughness: 1 });
    const trees = new THREE.Mesh(mergeGeometries(geos), bark);
    trees.castShadow = trees.receiveShadow = true;
    scene.add(trees);
  }

  // ---- cathedral ruin on the northern hill ----
  {
    const cz = -66, cy = heightAt(0, cz) - 3;
    const facade = new THREE.Shape();
    const W = 28, H = 24;
    facade.moveTo(-W / 2, 0); facade.lineTo(W / 2, 0); facade.lineTo(W / 2, H);
    facade.lineTo(3, H + 8); facade.lineTo(1.2, H + 5); facade.lineTo(0, H + 9.5);   // broken gable
    facade.lineTo(-W / 2 + 4, H + 3.5); facade.lineTo(-W / 2, H);
    facade.lineTo(-W / 2, 0);
    facade.holes.push(lancetPath(0, 2, 5, 9));
    facade.holes.push(lancetPath(-7.5, 5, 2.8, 8));
    facade.holes.push(lancetPath(7.5, 5, 2.8, 8));
    const rose = new THREE.Path(); rose.absarc(0, 19.5, 3, 0, Math.PI * 2, false); facade.holes.push(rose);
    const fg = new THREE.ExtrudeGeometry(facade, { depth: 1.6, bevelEnabled: false, curveSegments: 18 });
    const uv = fg.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 0.25, uv.getY(k) * 0.25);
    const fm = new THREE.Mesh(fg, darkStoneMat);
    fm.position.set(0, cy, cz);
    fm.castShadow = true;
    scene.add(fm);
    // rose window tracery
    const tr = new THREE.Group();
    for (let k = 0; k < 8; k++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 6, 0.3), darkStoneMat);
      bar.rotation.z = (k / 8) * Math.PI;
      tr.add(bar);
    }
    const ringT = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.15, 6, 32), darkStoneMat);
    tr.add(ringT);
    tr.position.set(0, cy + 19.5, cz + 0.8);
    scene.add(tr);
    // towers + spires
    for (const sx of [-1, 1]) {
      const tw = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(6, 34, 6), 2, 10), darkStoneMat);
      tw.position.set(sx * 17, cy + 17, cz - 1);
      tw.castShadow = true;
      scene.add(tw);
      const sp = new THREE.Mesh(new THREE.ConeGeometry(4.2, sx < 0 ? 18 : 9, 4), darkStoneMat);
      sp.rotation.y = Math.PI / 4;
      sp.position.set(sx * 17, cy + 34 + (sx < 0 ? 9 : 4.5), cz - 1);
      if (sx > 0) sp.rotation.z = 0.25;  // the broken spire
      scene.add(sp);
      for (let k = 0; k < 4; k++) { // pinnacles
        const pn = new THREE.Mesh(new THREE.ConeGeometry(0.5, 4, 4), darkStoneMat);
        pn.position.set(sx * 17 + (k % 2 ? 2.6 : -2.6), cy + 36, cz - 1 + (k < 2 ? 2.6 : -2.6));
        scene.add(pn);
      }
      // tower windows
      const wg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.35, 0.15), fog: false }));
      wg.position.set(sx * 17, cy + 25, cz + 2.05);
      scene.add(wg);
    }
    // inner glow behind the windows
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 0.28, 0.12), fog: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(W - 2, H + 4), glowMat);
    glow.position.set(0, cy + (H + 4) / 2, cz - 1.5);
    scene.add(glow);
    updaters.push((t) => {
      const f = 0.75 + 0.15 * Math.sin(t * 1.1) + 0.1 * Math.sin(t * 5.3);
      glowMat.color.setRGB(1.7 * f, 0.28 * f, 0.12 * f);
    });
  }

  // ---- braziers ----
  {
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2624, metalness: 0.9, roughness: 0.45 });
    const coal = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.8, 0.2) });
    const N = 6, R = 13;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const y = heightAt(x, z);
      const g = new THREE.Group();
      const ped = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.45, 0.6, 1.1, 8), 2, 0.6), stoneMat);
      ped.position.y = 0.55;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.35, 0.45, 12, 1, true), iron);
      bowl.position.y = 1.32; bowl.material.side = THREE.DoubleSide;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 6, 20), iron);
      rim.rotation.x = Math.PI / 2; rim.position.y = 1.55;
      const coals = new THREE.Mesh(new THREE.CircleGeometry(0.66, 12), coal);
      coals.rotation.x = -Math.PI / 2; coals.position.y = 1.45;
      for (let k = 0; k < 3; k++) { // spikes
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.5, 4), iron);
        const ka = (k / 3) * Math.PI * 2;
        sp.position.set(Math.cos(ka) * 0.75, 1.75, Math.sin(ka) * 0.75);
        g.add(sp);
      }
      [ped, bowl, rim].forEach((m) => { m.castShadow = true; m.receiveShadow = true; });
      g.add(ped, bowl, rim, coals);
      g.position.set(x, y, z);
      scene.add(g);
      const light = new THREE.PointLight(0xff6a28, 22, 20, 1.5);
      light.position.set(x, y + 2.2, z);
      scene.add(light);
      flames.push({ pos: new THREE.Vector3(x, y + 1.5, z), light, base: 22, seed: i * 7.3 });
      colliders.push({ x, z, r: 0.8 });
    }
  }

  // ---- candles (instanced) + flame points ----
  {
    const N = 70;
    const cg = new THREE.CylinderGeometry(0.045, 0.05, 1, 6);
    cg.translate(0, 0.5, 0);
    const cm = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.6, emissive: 0x301808 });
    const im = new THREE.InstancedMesh(cg, cm, N);
    const flamePos = new Float32Array(N * 3), seeds = new Float32Array(N);
    const m = new THREE.Matrix4(), s = new THREE.Vector3(), q = new THREE.Quaternion(), p = new THREE.Vector3();
    let c = 0;
    for (let k = 0; k < 18 && c < N; k++) {
      const a = rng() * Math.PI * 2, r = k < 6 ? rr(4.3, 4.8) : rr(9, 27);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const cnt = 3 + Math.floor(rng() * 4);
      for (let j = 0; j < cnt && c < N; j++) {
        const x = cx + rr(-0.6, 0.6), z = cz + rr(-0.6, 0.6);
        const h = rr(0.12, 0.4);
        const y = heightAt(x, z) + (r < 5 ? 0.35 : 0);
        p.set(x, y, z); s.set(1, h, 1); q.identity();
        m.compose(p, q, s); im.setMatrixAt(c, m);
        flamePos[c * 3] = x; flamePos[c * 3 + 1] = y + h + 0.06; flamePos[c * 3 + 2] = z;
        seeds[c] = rng() * 100;
        c++;
      }
    }
    im.count = c;
    scene.add(im);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(flamePos.slice(0, c * 3), 3));
    fg.setAttribute('seed', new THREE.BufferAttribute(seeds.slice(0, c), 1));
    const fmat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, scale: { value: 600 } },
      vertexShader: `attribute float seed; uniform float time; uniform float scale; varying float vF;
        void main(){ vec3 p = position; vF = 0.75+0.25*sin(time*13.0+seed)*sin(time*7.0+seed*2.0);
          p.y += 0.02*vF; vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
          gl_PointSize = 0.16*vF*scale*projectionMatrix[1][1]/-mv.z; }`,
      fragmentShader: `varying float vF; void main(){ vec2 c = gl_PointCoord-0.5; c.y*=0.6; float d = length(c)*2.0;
          float a = smoothstep(1.0,0.0,d); gl_FragColor = vec4(vec3(3.0,1.3,0.4)*a*vF, a); }`,
    });
    const pts = new THREE.Points(fg, fmat);
    pts.frustumCulled = false;
    scene.add(pts);
    updaters.push((t, ctx) => { fmat.uniforms.time.value = t; fmat.uniforms.scale.value = ctx.pointScale; });
  }

  // ---- ground mist sprites ----
  {
    const mt = softSpriteTexture(128, true);
    const mists = [];
    for (let i = 0; i < 46; i++) {
      const mat = new THREE.SpriteMaterial({ map: mt, color: 0x58486e, transparent: true, opacity: rr(0.07, 0.16), depthWrite: false });
      const sp = new THREE.Sprite(mat);
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 40;
      sp.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      const sc = rr(9, 18);
      sp.scale.set(sc, sc * 0.35, 1);
      sp.userData = { vx: rr(-0.4, 0.4), vz: rr(-0.4, 0.4), y: rr(0.5, 1.4), base: mat.opacity, ph: rng() * 10 };
      scene.add(sp);
      mists.push(sp);
    }
    updaters.push((t, ctx) => {
      for (const sp of mists) {
        const u = sp.userData;
        sp.position.x += u.vx * ctx.dt; sp.position.z += u.vz * ctx.dt;
        const r = Math.hypot(sp.position.x, sp.position.z);
        if (r > 42) { sp.position.x *= -0.95; sp.position.z *= -0.95; }
        sp.position.y = heightAt(sp.position.x, sp.position.z) + u.y;
        sp.material.opacity = u.base * (0.7 + 0.3 * Math.sin(t * 0.3 + u.ph));
        sp.material.rotation = Math.sin(t * 0.05 + u.ph) * 0.3;
      }
    });
  }

  // ---- drifting embers & ash (GPU animated) ----
  function ambientPoints(n, colorA, size, speed, additive, rangeY) {
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 45;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = rng() * rangeY; pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = rng() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { time: { value: 0 }, scale: { value: 600 }, col: { value: colorA }, size: { value: size }, speed: { value: speed }, rangeY: { value: rangeY } },
      vertexShader: `attribute float seed; uniform float time, scale, size, speed, rangeY; varying float vA;
        void main(){ vec3 p = position;
          p.y = mod(p.y + time*speed*(0.6+0.4*fract(seed)), rangeY);
          p.x += sin(time*0.5+seed)*1.2 + sin(time*1.7+seed*3.0)*0.3;
          p.z += cos(time*0.4+seed*1.3)*1.2;
          vA = smoothstep(0.0,1.5,p.y)*smoothstep(rangeY, rangeY-3.0, p.y) * (0.5+0.5*sin(time*3.0+seed*5.0));
          vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
          gl_PointSize = size*scale*projectionMatrix[1][1]/-mv.z; }`,
      fragmentShader: `uniform vec3 col; varying float vA; void main(){ float d = length(gl_PointCoord-0.5)*2.0;
          float a = smoothstep(1.0,0.0,d)*vA; gl_FragColor = vec4(col*a, a); }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    updaters.push((t, ctx) => { mat.uniforms.time.value = t; mat.uniforms.scale.value = ctx.pointScale; });
  }
  ambientPoints(700, new THREE.Color(3.0, 0.9, 0.25), 0.07, 0.55, true, 14);
  ambientPoints(1400, new THREE.Color(0.35, 0.32, 0.36), 0.045, -0.35, false, 16);

  return {
    colliders, flames, moonDir, sky: skyMat,
    update(t, ctx) { for (const u of updaters) u(t, ctx); },
  };
}
