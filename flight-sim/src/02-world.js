// ============================================================================
//  World: renderer, terrain streaming, ocean, forests, city, airports, carrier
// ============================================================================
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 90000);
scene.fog = new THREE.FogExp2(0xbfd3e6, 0.000045);
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

const linear = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

// ---------------------------------------------------------------- Obstacles (crash boxes)
const OBST = new Map(); const OCELL = 250;
function addObstacle(minX, maxX, minZ, maxZ, top) {
  const o = { minX, maxX, minZ, maxZ, top };
  for (let gx = Math.floor(minX / OCELL); gx <= Math.floor(maxX / OCELL); gx++)
    for (let gz = Math.floor(minZ / OCELL); gz <= Math.floor(maxZ / OCELL); gz++) {
      const k = gx + ',' + gz; if (!OBST.has(k)) OBST.set(k, []); OBST.get(k).push(o);
    }
}
function hitObstacle(x, y, z) {
  const l = OBST.get(Math.floor(x / OCELL) + ',' + Math.floor(z / OCELL)); if (!l) return null;
  for (const o of l) if (x > o.minX && x < o.maxX && z > o.minZ && z < o.maxZ && y < o.top) return o;
  return null;
}

// ---------------------------------------------------------------- Shader helpers
const GLSL_NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
`;

// ---------------------------------------------------------------- Terrain colors
const PAL = {
  sand: linear(0.80, 0.73, 0.55), wetSand: linear(0.55, 0.50, 0.38),
  grassA: linear(0.30, 0.45, 0.17), grassB: linear(0.55, 0.53, 0.30), grassC: linear(0.40, 0.48, 0.22),
  forest: linear(0.15, 0.25, 0.10), rock: linear(0.45, 0.42, 0.38), rockD: linear(0.30, 0.28, 0.27),
  snow: linear(0.95, 0.96, 0.99), field: linear(0.36, 0.48, 0.21), concrete: linear(0.48, 0.47, 0.45),
  seabed: linear(0.40, 0.45, 0.38), farm1: linear(0.62, 0.55, 0.30), farm2: linear(0.36, 0.42, 0.18),
};
function forestDensity(x, z, h, slope) {
  if (h < 6 || h > 1900 || slope > 0.45) return 0;
  const f = Noise.fbm(x * 0.0009 + 9, z * 0.0009 - 4, 3);
  let d = smoothstep(0.02, 0.32, f) * (1 - slope * 1.8);
  const c = WORLD.city; if (Math.hypot(x - c.x, z - c.z) < c.r) d *= 0.15;
  for (const p of PADS) { if (Math.abs(x - p.x) < p.hw + p.hl + 400 && Math.abs(z - p.z) < p.hw + p.hl + 400) { const rx = x - p.x, rz = z - p.z; const al = rx * p.dx + rz * p.dz, ac = rx * -p.dz + rz * p.dx - p.off; if (Math.abs(al) < p.hl + 250 && Math.abs(ac) < p.hw + 250) return 0; } }
  return clamp(d, 0, 1);
}
const _tc = new THREE.Color();
function terrainColor(x, z, h, ny) {
  const slope = 1 - ny;
  const m = Noise.fbm(x * 0.00035 - 20, z * 0.00035 + 13, 3) * 0.5 + 0.5;
  _tc.copy(PAL.grassA).lerp(PAL.grassB, smoothstep(0.35, 0.8, m));
  // farmland patchwork in the lowlands
  if (h > 8 && h < 260) {
    const fx = Math.floor((x + 50000) / 380), fz = Math.floor((z + 50000) / 290);
    const r = (Math.sin(fx * 127.1 + fz * 311.7) * 43758.5453) % 1;
    const pf = smoothstep(0.1, 0.45, Noise.fbm(x * 0.00025 + 50, z * 0.00025, 2));
    if (r > 0.25) _tc.lerp(r > 0.62 ? PAL.farm1 : PAL.farm2, 0.55 * pf);
  }
  const fd = forestDensity(x, z, h, slope);
  _tc.lerp(PAL.forest, fd * 0.8);
  // airports
  for (const p of PADS) { const rx = x - p.x, rz = z - p.z; const al = rx * p.dx + rz * p.dz, ac = rx * -p.dz + rz * p.dx - p.off; if (Math.abs(al) < p.hl && Math.abs(ac) < p.hw) { _tc.lerp(PAL.field, 0.85); break; } }
  // city
  const c = WORLD.city; const cd = Math.hypot(x - c.x, z - c.z);
  if (cd < c.r) _tc.lerp(PAL.concrete, smoothstep(c.r, c.r * 0.55, cd) * 0.85);
  // rock & snow
  const rn = Noise.s2(x * 0.002, z * 0.002);
  const rockT = Math.max(smoothstep(0.28, 0.5, slope + rn * 0.06), smoothstep(1500, 2100, h + rn * 200) * 0.85);
  _tc.lerp(rn > 0 ? PAL.rock : PAL.rockD, rockT);
  const snowT = smoothstep(2050, 2350, h + rn * 260) * smoothstep(0.62, 0.35, slope);
  _tc.lerp(PAL.snow, snowT);
  // beaches & sea floor
  if (h < 7) _tc.lerp(PAL.sand, smoothstep(7, 2, h));
  if (h < 0.5) _tc.copy(PAL.wetSand).lerp(PAL.seabed, smoothstep(0, -30, h));
  return _tc;
}

// ---------------------------------------------------------------- Terrain material
const terrainUniforms = { uDetail: { value: 1 } };
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
terrainMat.onBeforeCompile = (sh) => {
  sh.uniforms.uDetail = terrainUniforms.uDetail;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uDetail;\n' + GLSL_NOISE)
    .replace('#include <color_fragment>', `#include <color_fragment>
      float dist = length(vWPos - cameraPosition);
      float n1 = vnoise(vWPos.xz * 0.013);
      float n2 = vnoise(vWPos.xz * 0.11);
      float n3 = vnoise(vWPos.xz * 0.9);
      float fineFade = smoothstep(900.0, 60.0, dist) * uDetail;
      float det = 0.86 + 0.26 * n1 + (0.18 * n2 - 0.09) * smoothstep(6000.0, 300.0, dist) + (0.16 * n3 - 0.08) * fineFade;
      diffuseColor.rgb *= det;`);
};

// ---------------------------------------------------------------- Terrain streaming
const CHUNK = 2000;
const terrainGroup = new THREE.Group(); scene.add(terrainGroup);
const chunks = new Map();
let VIEW_R = 9;
function lodFor(d) { return d <= 1 ? 100 : d <= 2 ? 64 : d <= 4 ? 32 : d <= 6 ? 14 : 6; }

function buildChunkGeometry(cx, cz, n) {
  const step = CHUNK / n, ox = cx * CHUNK, oz = cz * CHUNK;
  const W = n + 3; // includes skirt ring
  const hs = new Float32Array((n + 3) * (n + 3));
  for (let j = -1; j <= n + 1; j++) for (let i = -1; i <= n + 1; i++) hs[(j + 1) * W + (i + 1)] = terrainHeight(ox + i * step, oz + j * step);
  const pos = new Float32Array(W * W * 3), nor = new Float32Array(W * W * 3), col = new Float32Array(W * W * 3);
  const skirt = Math.max(8, step * 1.2);
  for (let j = -1; j <= n + 1; j++) for (let i = -1; i <= n + 1; i++) {
    const idx = (j + 1) * W + (i + 1);
    const ci = clamp(i, 0, n), cj = clamp(j, 0, n);
    const h = hs[(cj + 1) * W + (ci + 1)];
    const edge = i !== ci || j !== cj;
    // normal by central difference
    const hl = hs[(cj + 1) * W + ci], hr = hs[(cj + 1) * W + ci + 2], hd = hs[cj * W + ci + 1], hu = hs[(cj + 2) * W + ci + 1];
    let nx = (hl - hr), ny = 2 * step, nz = (hd - hu); const il = 1 / Math.hypot(nx, ny, nz); nx *= il; ny *= il; nz *= il;
    pos[idx * 3] = ci * step; pos[idx * 3 + 1] = edge ? h - skirt : h; pos[idx * 3 + 2] = cj * step;
    nor[idx * 3] = nx; nor[idx * 3 + 1] = ny; nor[idx * 3 + 2] = nz;
    const c = terrainColor(ox + ci * step, oz + cj * step, h, ny);
    col[idx * 3] = c.r; col[idx * 3 + 1] = c.g; col[idx * 3 + 2] = c.b;
  }
  const ind = new (W * W > 65535 ? Uint32Array : Uint16Array)((W - 1) * (W - 1) * 6); let k = 0;
  for (let j = 0; j < W - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    ind[k++] = a; ind[k++] = c; ind[k++] = b; ind[k++] = b; ind[k++] = c; ind[k++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(ind, 1));
  g.computeBoundingSphere();
  return g;
}

// Trees
function makeTreeGeometry() {
  const parts = [];
  const paint = (g, c) => { const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const trunk = paint(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 5).translate(0, 0.15, 0), linear(0.32, 0.22, 0.14));
  const c1 = paint(new THREE.ConeGeometry(0.3, 0.55, 7).translate(0, 0.45, 0), linear(0.16, 0.30, 0.13));
  const c2 = paint(new THREE.ConeGeometry(0.22, 0.45, 7).translate(0, 0.72, 0), linear(0.18, 0.33, 0.14));
  const pine = mergeGeometries([trunk.clone(), c1, c2].map(g => g.toNonIndexed()));
  const blob = paint(new THREE.IcosahedronGeometry(0.34, 1).scale(1, 0.9, 1).translate(0, 0.58, 0), linear(0.22, 0.36, 0.13));
  const round = mergeGeometries([trunk.clone().toNonIndexed(), blob]);
  pine.computeVertexNormals(); round.computeVertexNormals();
  return [pine, round];
}
const TREE_GEOS = makeTreeGeometry();
const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: false });
let TREE_DENSITY = 1;
function buildTrees(cx, cz) {
  const rng = mulberry32((cx * 73856093) ^ (cz * 19349663));
  const ox = cx * CHUNK, oz = cz * CHUNK; const N = Math.floor(1700 * TREE_DENSITY);
  const meshes = [];
  for (let v = 0; v < 2; v++) {
    const m = new THREE.InstancedMesh(TREE_GEOS[v], treeMat, N); m.count = 0; meshes.push(m);
  }
  const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const x = ox + rng() * CHUNK, z = oz + rng() * CHUNK;
    const h = terrainHeight(x, z);
    const slope = Math.min(1, Math.abs(terrainHeight(x + 6, z) - h) / 6 + Math.abs(terrainHeight(x, z + 6) - h) / 6) * 0.7;
    const d = forestDensity(x, z, h, slope);
    if (rng() > d * 0.95) continue;
    const v = h > 700 || rng() < 0.35 ? 0 : 1;
    const m = meshes[v];
    const ht = (9 + rng() * 14) * (h > 1200 ? 0.7 : 1);
    q.setFromAxisAngle(up, rng() * 6.28);
    s.set(ht * (0.8 + rng() * 0.4), ht, ht * (0.8 + rng() * 0.4));
    p.set(x - ox, h - 0.5, z - oz);
    mat.compose(p, q, s); m.setMatrixAt(m.count, mat);
    const sh = 0.75 + rng() * 0.45; col.setRGB(sh, sh * (0.92 + rng() * 0.16), sh * 0.9); m.setColorAt(m.count, col);
    m.count++;
  }
  const grp = new THREE.Group(); grp.position.set(ox, 0, oz);
  for (const m of meshes) { if (m.count) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); m.frustumCulled = true; grp.add(m); } else m.dispose(); }
  return grp;
}

const buildQueue = [];
function updateTerrain(px, pz, budgetMs, force = false) {
  const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
  const want = new Map();
  for (let dz = -VIEW_R; dz <= VIEW_R; dz++) for (let dx = -VIEW_R; dx <= VIEW_R; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dz));
    if (Math.hypot(dx, dz) > VIEW_R + 0.5) continue;
    want.set((ccx + dx) + ',' + (ccz + dz), { cx: ccx + dx, cz: ccz + dz, seg: lodFor(d), trees: d <= 2, d });
  }
  for (const [k, c] of chunks) if (!want.has(k)) { disposeChunk(c); chunks.delete(k); }
  buildQueue.length = 0;
  for (const [k, w] of want) {
    const c = chunks.get(k);
    if (!c || c.seg !== w.seg || (w.trees && !c.trees) || (!w.trees && c.trees)) buildQueue.push({ k, ...w });
  }
  buildQueue.sort((a, b) => a.d - b.d);
  const t0 = performance.now();
  while (buildQueue.length && (force || performance.now() - t0 < budgetMs)) {
    const w = buildQueue.shift();
    let c = chunks.get(w.k);
    if (!c || c.seg !== w.seg) {
      const g = buildChunkGeometry(w.cx, w.cz, w.seg);
      const mesh = new THREE.Mesh(g, terrainMat); mesh.position.set(w.cx * CHUNK, 0, w.cz * CHUNK);
      mesh.receiveShadow = w.d <= 1; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      terrainGroup.add(mesh);
      if (c) { terrainGroup.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = mesh; c.seg = w.seg; }
      else { c = { mesh, seg: w.seg, trees: null }; chunks.set(w.k, c); }
    }
    if (w.trees && !c.trees) { c.trees = buildTrees(w.cx, w.cz); terrainGroup.add(c.trees); }
    if (!w.trees && c.trees) { removeTrees(c); }
  }
  return buildQueue.length;
}
function removeTrees(c) { terrainGroup.remove(c.trees); c.trees.children.forEach(m => m.dispose()); c.trees = null; }
function disposeChunk(c) { terrainGroup.remove(c.mesh); c.mesh.geometry.dispose(); if (c.trees) removeTrees(c); }
function resetTerrain() { for (const [, c] of chunks) disposeChunk(c); chunks.clear(); }

// ---------------------------------------------------------------- Ocean
const oceanUniforms = {
  uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
  uSkyCol: { value: new THREE.Color(0.5, 0.65, 0.85) }, uHorizon: { value: new THREE.Color(0.7, 0.8, 0.9) },
  uDeep: { value: linear(0.02, 0.10, 0.16) }, uShallow: { value: linear(0.05, 0.28, 0.32) },
  uFogCol: { value: new THREE.Color() }, uFogDen: { value: 0.00004 }, uWave: { value: 1 },
};
const oceanMat = new THREE.ShaderMaterial({
  uniforms: oceanUniforms,
  vertexShader: `varying vec3 vW;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `uniform float uTime, uFogDen, uWave; uniform vec3 uSunDir, uSunCol, uSkyCol, uHorizon, uDeep, uShallow, uFogCol; varying vec3 vW;
    #include <common>
    #include <logdepthbuf_pars_fragment>
    ${GLSL_NOISE}
    vec2 grad(vec2 p){ float e=0.05; float c=vnoise(p); return vec2(vnoise(p+vec2(e,0.))-c, vnoise(p+vec2(0.,e))-c)/e; }
    void main(){
      #include <logdepthbuf_fragment>
      vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
      float fade = smoothstep(9000.0, 200.0, dist);
      vec2 p = vW.xz;
      vec2 g = grad(p*0.018 + vec2(uTime*0.05, uTime*0.03))*0.55
             + grad(p*0.051 - vec2(uTime*0.07, -uTime*0.04))*0.35*fade
             + grad(p*0.17 + vec2(uTime*0.11, uTime*0.09))*0.22*fade
             + grad(p*0.0031 + vec2(uTime*0.01, 0.0))*0.6;
      vec3 N = normalize(vec3(-g.x*0.35*uWave, 1.0, -g.y*0.35*uWave));
      float fres = 0.02 + 0.98*pow(1.0 - max(dot(N, V), 0.0), 5.0);
      vec3 R = reflect(-V, N);
      vec3 sky = mix(uHorizon, uSkyCol, smoothstep(0.0, 0.45, R.y));
      float sunAmt = max(uSunDir.y, 0.0);
      vec3 water = mix(uDeep, uShallow, 0.25 + 0.25*g.x) * (0.25 + 0.75*sunAmt) ;
      vec3 col = mix(water, sky, fres);
      float spec = pow(max(dot(R, uSunDir), 0.0), 380.0) * 6.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.25;
      col += uSunCol * spec * step(0.0, uSunDir.y);
      float fog = 1.0 - exp(-uFogDen*uFogDen*dist*dist);
      col = mix(col, uFogCol, fog);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const ocean = new THREE.Mesh(new THREE.PlaneGeometry(180000, 180000, 1, 1).rotateX(-Math.PI / 2), oceanMat);
ocean.renderOrder = -1; scene.add(ocean);

// ---------------------------------------------------------------- Light points (runway, city, carrier)
const lightPointMat = new THREE.ShaderMaterial({
  uniforms: { uIntensity: { value: 1 }, uScale: { value: innerHeight }, uFogCol: { value: new THREE.Color() }, uFogDen: { value: 0.00004 } },
  vertexShader: `attribute vec3 color; attribute float size; varying vec3 vC; varying float vF;
    uniform float uIntensity, uScale, uFogDen;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); float d = -mv.z;
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(size * uScale / d, 1.6, 26.0);
      vC = color * uIntensity; vF = exp(-uFogDen*uFogDen*d*d*0.6);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `varying vec3 vC; varying float vF;
    #include <common>
    #include <logdepthbuf_pars_fragment>
    void main(){
      #include <logdepthbuf_fragment>
      vec2 c = gl_PointCoord - 0.5; float r = length(c); float a = smoothstep(0.5, 0.0, r); a = a*a;
      gl_FragColor = vec4(vC * a * vF, a * vF); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
function makeLightPoints(list) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(list.length * 3), c = new Float32Array(list.length * 3), s = new Float32Array(list.length);
  list.forEach((L, i) => { p.set([L.x, L.y, L.z], i * 3); c.set([L.c.r, L.c.g, L.c.b], i * 3); s[i] = L.s || 1.4; });
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('size', new THREE.BufferAttribute(s, 1));
  const pts = new THREE.Points(g, lightPointMat); pts.frustumCulled = false; return pts;
}
const LC = { white: new THREE.Color(3.2, 3.0, 2.6), yellow: new THREE.Color(3.4, 2.4, 0.6), green: new THREE.Color(0.4, 3.4, 0.9), red: new THREE.Color(3.4, 0.25, 0.15), blue: new THREE.Color(0.4, 0.8, 3.4), sodium: new THREE.Color(2.6, 1.5, 0.5) };

// ---------------------------------------------------------------- Canvas texture helpers
function canvasTex(w, h, draw, repeat) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const ctx = cv.getContext('2d'); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
function speckle(ctx, w, h, n, a, base) {
  for (let i = 0; i < n; i++) { const v = (Math.random() * 60 + base) | 0; ctx.fillStyle = `rgba(${v},${v},${v},${a})`; ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
}
function runwayTexture(len, wid, numA, numB) {
  const PX = 1.6; // px per meter across
  const W = Math.round(wid * PX * 2.5), H = 4096; const sy = H / len, sx = W / wid;
  return canvasTex(W, H, (c) => {
    c.fillStyle = '#3b3d40'; c.fillRect(0, 0, W, H);
    speckle(c, W, H, 26000, 0.25, 30);
    // tire marks in touchdown zones
    for (const end of [0, 1]) for (let i = 0; i < 70; i++) {
      const y0 = end ? H - (300 + Math.random() * 500) * sy : (300 + Math.random() * 500) * sy;
      c.fillStyle = `rgba(15,15,15,${0.08 + Math.random() * 0.12})`; const xx = W / 2 + (Math.random() < .5 ? -1 : 1) * (3 + Math.random() * 3) * sx;
      c.fillRect(xx, y0, 1.2 * sx, (40 + Math.random() * 160) * sy);
    }
    c.fillStyle = '#e9e9e4';
    c.fillRect(0.9 * sx, 0, 0.9 * sx, H); c.fillRect(W - 1.8 * sx, 0, 0.9 * sx, H);
    for (let y = 60; y < len - 60; y += 60) if (y > 120 && y < len - 120) c.fillRect(W / 2 - 0.45 * sx, y * sy, 0.9 * sx, 36 * sy);
    const pianoKeys = (top) => { const n = 12; const kw = (wid - 6) / (n * 2); for (let i = 0; i < n; i++) { for (const side of [-1, 1]) { const x = W / 2 + side * (1.5 + i * kw * 2 + kw / 2) * sx - (side < 0 ? kw * sx : 0); c.fillRect(side < 0 ? W / 2 - (1.5 + i * kw * 2 + kw) * sx : W / 2 + (1.5 + i * kw * 2) * sx, top ? 6 * sy : H - 36 * sy, kw * sx, 30 * sy); } } };
    pianoKeys(true); pianoKeys(false);
    const tdz = (fromTop) => { for (const d of [150, 300, 450, 600]) { for (const s of [-1, 1]) { const y = fromTop ? d : len - d - 22; const bw = d === 300 ? 9 : 3; c.fillRect(W / 2 + s * 6 * sx - (s < 0 ? bw * 2 * sx : 0), y * sy, bw * 2 * sx, 22 * sy); } } };
    tdz(true); tdz(false);
    c.font = `bold ${Math.round(24 * sy * 1.0)}px "Chakra Petch", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.save(); c.translate(W / 2, 62 * sy); c.rotate(Math.PI); c.scale(sx / sy, 1.4); c.fillText(numA, 0, 0); c.restore();
    c.save(); c.translate(W / 2, H - 62 * sy); c.scale(sx / sy, 1.4); c.fillText(numB, 0, 0); c.restore();
  });
}

// ---------------------------------------------------------------- Shared building materials
const concreteMat = new THREE.MeshStandardMaterial({ color: 0x9a9893, roughness: 0.85 });
const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x46484b, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const apronMat = new THREE.MeshStandardMaterial({ color: 0x7f7f7b, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.08, metalness: 0.9, emissive: 0x000000 });
const metalRoofMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.45, metalness: 0.6 });

function box(w, h, d, mat, x, y, z, parent, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m;
}

// ---------------------------------------------------------------- Airports
const worldLights = [];
const papiUnits = []; // {pos, idx, thresholdDeg}
const runwayInfo = []; // for HUD runway outline & landing scoring
function buildAirport(ap) {
  const g = new THREE.Group(); g.position.set(ap.x, ap.elev, ap.z); g.rotation.y = -ap.hdg * DEG; scene.add(g);
  // local frame: runway along -Z (heading), +X right
  const numA = String(Math.round(((ap.hdg + 180) % 360) / 10) || 36).padStart(2, '0');
  const numB = String(Math.round(ap.hdg / 10) || 36).padStart(2, '0');
  // Runway numbers: landing at the southern end heading 'hdg' shows hdg/10
  const rw = new THREE.Mesh(new THREE.PlaneGeometry(ap.wid, ap.len).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: runwayTexture(ap.len, ap.wid, numA, numB), roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  rw.position.y = 0.12; rw.receiveShadow = true; g.add(rw);
  // map texture: top of canvas = -Z end. Numbers drawn at top represent the runway when landing toward +Z... flip so threshold numbers read for approaching aircraft
  const twOff = ap.main ? 190 : 70, twW = ap.main ? 23 : 12;
  const tw = new THREE.Mesh(new THREE.PlaneGeometry(twW, ap.len).rotateX(-Math.PI / 2), asphaltMat); tw.position.set(twOff, 0.08, 0); tw.receiveShadow = true; g.add(tw);
  const nConn = ap.main ? 5 : 3;
  for (let i = 0; i < nConn; i++) {
    const z = -ap.len / 2 + 40 + i * (ap.len - 80) / (nConn - 1);
    const c = new THREE.Mesh(new THREE.PlaneGeometry(twOff, twW).rotateX(-Math.PI / 2), asphaltMat); c.position.set(twOff / 2, 0.09, z); c.receiveShadow = true; g.add(c);
  }
  const apronW = ap.main ? 260 : 90, apronL = ap.main ? 900 : 220;
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(apronW, apronL).rotateX(-Math.PI / 2), apronMat); apron.position.set(twOff + twW / 2 + apronW / 2, 0.06, 0); apron.receiveShadow = true; g.add(apron);
  const bx = twOff + twW / 2 + apronW + 10;
  if (ap.main) {
    // terminal with glass curtain wall
    const term = box(60, 22, 620, concreteMat, bx + 30, 0, 0, g);
    box(2, 16, 600, glassMat, bx - 0.5, 3, 0, g);
    box(70, 3, 640, metalRoofMat, bx + 30, 22, 0, g);
    for (let i = 0; i < 6; i++) { // jet bridges
      const z = -250 + i * 100; box(24, 4, 4, concreteMat, bx - 12, 5, z, g);
    }
    // tower
    const tw2 = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 6, 62, 16), concreteMat); tw2.position.set(bx + 20, 31, 420); tw2.castShadow = true; g.add(tw2);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(9, 7.5, 7, 12), glassMat); cab.position.set(bx + 20, 66, 420); g.add(cab);
    const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 1.2, 12), concreteMat); cabRoof.position.set(bx + 20, 70, 420); g.add(cabRoof);
    ap.tower = new THREE.Vector3(bx + 20, 72, 420).applyMatrix4(g.matrixWorld.compose(g.position, g.quaternion, g.scale));
    // hangars
    for (let i = 0; i < 4; i++) {
      const z = -520 - i * 95; const hg = new THREE.Group(); hg.position.set(bx + 20, 0, z); g.add(hg);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(36, 36, 70, 20, 1, false, 0, Math.PI), metalRoofMat); body.rotation.z = Math.PI / 2; body.scale.set(0.55, 1, 0.8); body.castShadow = true; body.receiveShadow = true; hg.add(body);
    }
    // fuel tanks
    for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 14, 20), new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.4, metalness: 0.3 })); t.position.set(bx + 70, 7, 560 + i * 26); t.castShadow = true; g.add(t); }
  } else {
    for (let i = 0; i < 2; i++) { const hg = box(28, 9, 24, metalRoofMat, bx + 14, 0, -40 + i * 34, g); }
    box(10, 6, 14, concreteMat, bx + 10, 0, 50, g);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.5, 14, 10), concreteMat); t.position.set(bx + 6, 7, 70); g.add(t);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3, 3, 8), glassMat); cab.position.set(bx + 6, 15.5, 70); g.add(cab);
    ap.tower = new THREE.Vector3(bx + 6, 18, 70).applyMatrix4(g.matrixWorld.compose(g.position, g.quaternion, g.scale));
  }
  // windsock
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 8, 6), concreteMat); pole.position.set(-ap.wid / 2 - 60, 4, -ap.len / 2 + 400); g.add(pole);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4, 10, 1, true).rotateZ(Math.PI / 2).translate(2, 0, 0), new THREE.MeshStandardMaterial({ color: 0xff5a1f, side: THREE.DoubleSide, roughness: 0.7 })); sock.position.set(pole.position.x, 7.6, pole.position.z); g.add(sock); ap.sock = sock;

  g.updateMatrixWorld(true);
  // obstacles (world AABB of buildings)
  g.traverse((o) => { if (o.isMesh && o.geometry.type !== 'PlaneGeometry' && o !== pole && o !== sock) { const b = new THREE.Box3().setFromObject(o); if (b.max.y - ap.elev > 3) addObstacle(b.min.x, b.max.x, b.min.z, b.max.z, b.max.y); } });

  // lights in local frame then to world
  const L = []; const toW = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld);
  const add = (x, z, c, s, y = 0.6) => { const p = toW(x, y, z); L.push({ x: p.x, y: p.y, z: p.z, c, s }); };
  for (let z = -ap.len / 2; z <= ap.len / 2; z += 60) for (const s of [-1, 1]) add(s * (ap.wid / 2 + 1.5), z, (Math.abs(z) > ap.len / 2 - 600 && z * 1 < 0 && s) ? LC.yellow : LC.white, 1.3);
  for (let x = -ap.wid / 2; x <= ap.wid / 2; x += 3) { add(x, ap.len / 2 + 1, LC.green, 1.5); add(x, -ap.len / 2 - 1, LC.red, 1.4); }
  // approach lights (south end, aircraft approach heading ap.hdg from +Z side)
  for (let d = 30; d <= (ap.main ? 900 : 300); d += 30) { add(0, ap.len / 2 + d, LC.white, 2.0, 1.5); if (d % 150 === 0) for (let x = -15; x <= 15; x += 3) add(x, ap.len / 2 + d, LC.white, 1.6, 1.5); }
  // taxiway edge lights
  for (let z = -ap.len / 2; z <= ap.len / 2; z += 50) for (const s of [-1, 1]) add(twOff + s * (twW / 2 + 1), z, LC.blue, 0.9, 0.4);
  // apron flood (sodium)
  if (ap.main) for (let z = -400; z <= 400; z += 80) add(twOff + twW / 2 + apronW - 10, z, LC.sodium, 4.0, 18);
  // PAPI: left of runway, 300m beyond threshold (threshold = +len/2 end)
  const papiZ = ap.len / 2 - 320;
  [3.5, 3.17, 2.83, 2.5].forEach((th, i) => { const x = -ap.wid / 2 - 15 - i * 9; const p = toW(x, 0.9, papiZ); papiUnits.push({ pos: p, th, i: worldLights.length + L.length }); L.push({ x: p.x, y: p.y, z: p.z, c: LC.white.clone(), s: 2.4 }); });
  const pts = makeLightPoints(L); scene.add(pts); worldLights.push(...L); ap.lightPoints = pts;
  ap.lightStart = worldLights.length - L.length;
  // runway info for HUD: threshold & corners
  const thr = toW(0, 0, ap.len / 2), far = toW(0, 0, -ap.len / 2);
  runwayInfo.push({ ap, thr, far, corners: [toW(-ap.wid / 2, 0.2, ap.len / 2), toW(ap.wid / 2, 0.2, ap.len / 2), toW(ap.wid / 2, 0.2, -ap.len / 2), toW(-ap.wid / 2, 0.2, -ap.len / 2)], dir: new THREE.Vector3(ap.dirX, 0, ap.dirZ) });
  // parking positions for start & parked airliners
  ap.group = g; ap.toW = toW; ap.twOff = twOff; ap.apronX = twOff + twW / 2 + apronW / 2; ap.bx = bx;
}
function updatePapi() {
  for (const ap of AIRPORTS) {
    const pts = ap.lightPoints; const col = pts.geometry.attributes.color; let dirty = false;
    for (const u of papiUnits) {
      const li = u.i - ap.lightStart; if (li < 0 || li >= col.count) continue;
      const dx = camera.position.x - u.pos.x, dz = camera.position.z - u.pos.z, dy = camera.position.y - u.pos.y;
      const ang = Math.atan2(dy, Math.hypot(dx, dz)) * RAD;
      const c = ang > u.th ? LC.white : LC.red; col.setXYZ(li, c.r, c.g, c.b); dirty = true;
    }
    if (dirty) col.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- City
let cityMat, cityMesh, nightUniform = { value: 0 };
function buildCity() {
  const c = WORLD.city; const rng = mulberry32(4242);
  const list = [];
  const BLK = 140, ST = 22;
  for (let bxI = -30; bxI <= 30; bxI++) for (let bzI = -30; bzI <= 30; bzI++) {
    const x0 = c.x + bxI * BLK, z0 = c.z + bzI * BLK;
    const d = Math.hypot(x0 - c.x, z0 - c.z); if (d > c.r * 0.92) continue;
    if (rng() < 0.08) continue; // parks
    const core = Math.exp(-Math.pow(d / 1150, 2));
    const n = core > 0.4 ? 2 : 4;
    const cell = (BLK - ST) / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (rng() < 0.12) continue;
      const w = cell * (0.65 + rng() * 0.3), dd = cell * (0.65 + rng() * 0.3);
      const x = x0 + (i + 0.5) * cell - (BLK - ST) / 2, z = z0 + (j + 0.5) * cell - (BLK - ST) / 2;
      let h = 7 + rng() * 14 + core * (40 + rng() * rng() * 230);
      if (core < 0.15 && rng() < 0.6) h = 5 + rng() * 6;
      const g1 = terrainHeight(x - w / 2, z - dd / 2), g2 = terrainHeight(x + w / 2, z + dd / 2), g3 = terrainHeight(x + w / 2, z - dd / 2), g4 = terrainHeight(x - w / 2, z + dd / 2);
      const base = Math.min(g1, g2, g3, g4) - 1; const top = Math.max(g1, g2, g3, g4);
      if (top - base > 25 || base < 2) continue;
      list.push({ x, z, w, d: dd, h: h + (top - base), base });
    }
  }
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  cityMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 });
  cityMat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vON;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvec4 wpp = modelMatrix * instanceMatrix * vec4(transformed,1.0); vWP = wpp.xyz; vON = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vON; uniform float uNight;\n' + GLSL_NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wall = step(abs(vON.y), 0.5);
        float u = abs(vON.x) > 0.5 ? vWP.z : vWP.x;
        float fl = (vWP.y) / 3.7;
        vec2 cl = vec2(floor(u / 3.3), floor(fl));
        vec2 ff = vec2(fract(u / 3.3), fract(fl));
        float win = step(0.16, ff.x) * step(ff.x, 0.84) * step(0.28, ff.y) * step(ff.y, 0.82) * wall;
        float rnd = hash12(cl + floor(vWP.xz / 37.0) * 13.1);
        vec3 glass = mix(vec3(0.05,0.07,0.09), vec3(0.2,0.26,0.3), rnd*0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb * (0.9 + 0.1*vnoise(vWP.xz*0.3)), glass, win * 0.85);
        float roofDark = step(0.5, vON.y); diffuseColor.rgb *= 1.0 - roofDark*0.35;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, win);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float lit = step(0.58, rnd) * win * uNight;
        totalEmissiveRadiance += lit * mix(vec3(1.0,0.72,0.42), vec3(0.75,0.85,1.0), step(0.85, rnd)) * 2.2;`);
  };
  cityMesh = new THREE.InstancedMesh(geo, cityMat, list.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const tints = [0xd9d4cc, 0xc9c2b6, 0xb7bcc2, 0xe8e2d6, 0x9ea6ad, 0xcfc6b8, 0xa8a196];
  list.forEach((b, i) => {
    m.makeScale(b.w, b.h, b.d); m.setPosition(b.x, b.base, b.z); cityMesh.setMatrixAt(i, m);
    col.set(tints[(rng() * tints.length) | 0]); cityMesh.setColorAt(i, col);
    addObstacle(b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, b.base + b.h);
  });
  cityMesh.castShadow = true; cityMesh.receiveShadow = true; cityMesh.computeBoundingSphere(); scene.add(cityMesh);
  // street lights
  const L = [];
  for (let i = 0; i < 2600; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * c.r * 0.95;
    let x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    // snap to street grid lines
    if (rng() < 0.5) x = Math.round((x - c.x) / BLK) * BLK + c.x - BLK / 2 + ST / 2; else z = Math.round((z - c.z) / BLK) * BLK + c.z - BLK / 2 + ST / 2;
    const h = terrainHeight(x, z); if (h < 1) continue;
    L.push({ x, y: h + 8, z, c: rng() < 0.8 ? LC.sodium : LC.white, s: 2.2 });
  }
  const pts = makeLightPoints(L); pts.userData.night = true; scene.add(pts); cityLights = pts;
}
let cityLights;

// ---------------------------------------------------------------- Aircraft carrier
let carrierGroup;
function buildCarrier() {
  const C = WORLD.carrier; const g = new THREE.Group(); g.position.set(C.x, 0, C.z); scene.add(g); carrierGroup = g;
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x6b7178, roughness: 0.6, metalness: 0.35 });
  // hull from a lofted outline
  const shape = new THREE.Shape();
  const L2 = C.len / 2, W2 = 24;
  shape.moveTo(-W2 + 4, L2); shape.lineTo(W2, L2 - 2); shape.lineTo(W2 + 2, -L2 + 80); shape.quadraticCurveTo(10, -L2 - 8, 0, -L2 - 12); shape.quadraticCurveTo(-10, -L2 - 8, -W2 - 2, -L2 + 80); shape.lineTo(-W2 - 2, L2 - 2);
  const hullG = new THREE.ExtrudeGeometry(shape, { depth: C.deck + 8, bevelEnabled: false }); hullG.rotateX(-Math.PI / 2); hullG.rotateY(Math.PI); hullG.translate(0, -8, 0);
  // taper below waterline
  const hp = hullG.attributes.position; for (let i = 0; i < hp.count; i++) { const y = hp.getY(i); if (y < 2) hp.setX(i, hp.getX(i) * 0.72); } hullG.computeVertexNormals();
  const hull = new THREE.Mesh(hullG, hullMat); hull.castShadow = true; hull.receiveShadow = true; g.add(hull);
  // deck texture
  const deckTex = canvasTex(256, 2048, (c, w, h) => {
    const sx = w / (W2 * 2 + 4), sy = h / (C.len + 12);
    c.fillStyle = '#3a3c3f'; c.fillRect(0, 0, w, h); speckle(c, w, h, 14000, 0.3, 40);
    const X = (x) => (x + W2 + 2) * sx, Y = (z) => (z + L2 + 12) * sy;
    c.strokeStyle = '#f2f2ee'; c.lineWidth = 2; c.setLineDash([14, 10]);
    c.beginPath(); c.moveTo(X(-2), Y(L2 - 5)); c.lineTo(X(-2), Y(-L2 + 20)); c.stroke(); c.setLineDash([]);
    c.strokeStyle = '#ffd34a'; c.lineWidth = 2; c.beginPath(); c.moveTo(X(-2 - 11), Y(L2)); c.lineTo(X(-2 - 11), Y(-L2)); c.moveTo(X(-2 + 11), Y(L2)); c.lineTo(X(-2 + 11), Y(-L2)); c.stroke();
    c.fillStyle = '#e6e6e0'; for (let i = 0; i < 8; i++) c.fillRect(X(-18 + i * 4.5), Y(L2 - 6), 2.4 * sx, 4 * sy);
    // arrestor wires
    c.strokeStyle = '#c9c9c4'; c.lineWidth = 2.5; for (const z of [110, 98, 86, 74]) { c.beginPath(); c.moveTo(X(-16), Y(z)); c.lineTo(X(12), Y(z)); c.stroke(); }
    // catapult tracks
    c.strokeStyle = '#1d1f21'; c.lineWidth = 3; c.beginPath(); c.moveTo(X(-2), Y(-60)); c.lineTo(X(-2), Y(-L2 + 4)); c.stroke();
    c.fillStyle = '#f2f2ee'; c.font = `bold ${Math.round(24 * sy)}px "Chakra Petch", sans-serif`; c.textAlign = 'center'; c.save(); c.translate(X(-2), Y(10)); c.scale(sx / sy * 1.2, 1); c.fillText('77', 0, 0); c.restore();
  });
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(W2 * 2 + 4, C.len + 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  deck.position.set(0, C.deck + 0.05, -6); deck.receiveShadow = true; g.add(deck);
  // island superstructure on the starboard sponson
  const isl = new THREE.Group(); isl.position.set(W2 - 2, C.deck, 40); g.add(isl);
  box(9, 18, 34, hullMat, 0, 0, 0, isl); box(7, 8, 20, hullMat, 0, 18, -4, isl);
  box(7.4, 2.2, 16, glassMat, 0, 20, -4, isl);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 16, 6), hullMat); mast.position.set(0, 34, -4); isl.add(mast);
  const radar = box(6, 0.6, 1.4, hullMat, 0, 36, -4, isl); g.userData.radar = radar;
  g.updateMatrixWorld(true);
  const ib = new THREE.Box3().setFromObject(isl); addObstacle(ib.min.x, ib.max.x, ib.min.z, ib.max.z, ib.max.y);
  // deck edge lights and centerline
  const L = [];
  for (let z = -L2 + 10; z <= L2; z += 12) { L.push({ x: C.x - 2, y: C.deck + 0.3, z: C.z + z, c: LC.white, s: 0.9 }); }
  for (let z = -L2; z <= L2; z += 16) { L.push({ x: C.x - 22, y: C.deck + 0.4, z: C.z + z, c: LC.white, s: 1.1 }); L.push({ x: C.x + 20, y: C.deck + 0.4, z: C.z + z, c: LC.white, s: 1.1 }); }
  for (let x = -18; x <= 14; x += 4) L.push({ x: C.x + x, y: C.deck + 0.4, z: C.z + L2, c: LC.red, s: 1.3 });
  // "meatball" optical landing aid (simplified: amber/green/red by glide angle)
  const ballPos = new THREE.Vector3(C.x - 24, C.deck + 1.2, C.z + 80);
  L.push({ x: ballPos.x, y: ballPos.y, z: ballPos.z, c: LC.yellow.clone(), s: 3.2 });
  const pts = makeLightPoints(L); scene.add(pts); carrierLights = pts; carrierBall = { pos: ballPos, idx: L.length - 1 };
}
let carrierLights, carrierBall;
function updateCarrierBall() {
  if (!carrierLights) return;
  const C = WORLD.carrier; const tdz = new THREE.Vector3(C.x - 2, C.deck, C.z + 92);
  const dx = camera.position.x - tdz.x, dz = camera.position.z - tdz.z, dy = camera.position.y - tdz.y;
  const ang = Math.atan2(dy, Math.hypot(dx, dz)) * RAD;
  const c = ang > 4.1 ? LC.yellow : ang > 3.0 ? LC.green.clone().multiplyScalar(1.2) : LC.red;
  const col = carrierLights.geometry.attributes.color; col.setXYZ(carrierBall.idx, c.r, c.g, c.b); col.needsUpdate = true;
}
