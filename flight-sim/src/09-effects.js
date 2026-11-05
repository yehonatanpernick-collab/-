// ============================================================================
//  Effects: particle pools (smoke, dust, fire), ribbons (vapor, contrails), debris
// ============================================================================
const smokeTex = canvasTex(128, 128, (c) => {
  const r = mulberry32(3);
  for (let i = 0; i < 22; i++) { const x = 64 + (r() - 0.5) * 50, y = 64 + (r() - 0.5) * 50, rad = 18 + r() * 30; const g = c.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); }
});
class ParticlePool {
  constructor(max, additive) {
    this.max = max; this.n = 0; this.p = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: smokeTex }, uScale: { value: innerHeight }, uFogCol: { value: scene.fog.color }, uFogDen: { value: 0.00004 } },
      vertexShader: `attribute vec4 color; attribute float size; varying vec4 vC; varying float vF; uniform float uScale, uFogDen;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; float d=-mv.z; gl_PointSize = min(size*uScale/max(d,0.5), 900.0); vC=color; vF = exp(-uFogDen*uFogDen*d*d);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uFogCol; varying vec4 vC; varying float vF;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main(){
          #include <logdepthbuf_fragment>
          vec4 t = texture2D(uTex, gl_PointCoord); float a = t.a*vC.a; if(a<0.003) discard; ${additive ? 'gl_FragColor = vec4(vC.rgb*a*vF, a);' : 'gl_FragColor = vec4(mix(uFogCol, vC.rgb, vF), a*min(1.0, vF+0.2));'} }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 8 : 6; scene.add(this.points);
  }
  emit(o) { if (this.p.length >= this.max) this.p.shift(); this.p.push({ x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: 0, max: o.life || 2, s0: o.s0 || 1, s1: o.s1 || 4, r: o.r ?? 1, g: o.g ?? 1, b: o.b ?? 1, a: o.a ?? 0.6, drag: o.drag ?? 0.6, rise: o.rise ?? 0, r1: o.r1, g1: o.g1, b1: o.b1 }); }
  update(dt) {
    const P = this.p; let w = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i]; q.life += dt; if (q.life >= q.max) continue;
      const k = Math.exp(-q.drag * dt); q.vx *= k; q.vy = q.vy * k + q.rise * dt; q.vz *= k; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      const t = q.life / q.max; P[w++] = q;
    }
    P.length = w; this.n = w;
    for (let i = 0; i < w; i++) {
      const q = P[i], t = q.life / q.max;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      const r = q.r1 !== undefined ? lerp(q.r, q.r1, t) : q.r, g = q.g1 !== undefined ? lerp(q.g, q.g1, t) : q.g, b = q.b1 !== undefined ? lerp(q.b, q.b1, t) : q.b;
      this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = q.a * Math.min(1, t * 8) * (1 - t);
      this.size[i] = lerp(q.s0, q.s1, Math.sqrt(t));
    }
    const g = this.points.geometry; g.setDrawRange(0, w);
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
    this.mat.uniforms.uFogDen.value = scene.fog.density;
  }
  clear() { this.p.length = 0; }
}
const smoke = new ParticlePool(2400, false);
const fire = new ParticlePool(900, true);

// Ribbon trail (vapor & contrails)
class Ribbon {
  constructor(max = 90, color = 0xffffff, opacity = 0.5) {
    this.max = max; this.pts = [];
    const g = new THREE.BufferGeometry(); this.pos = new Float32Array(max * 2 * 3); this.al = new Float32Array(max * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('alpha', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Color(color) }, uOp: { value: opacity } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `attribute float alpha; varying float vA;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){ vA = alpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `uniform vec3 uCol; uniform float uOp; varying float vA;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main(){
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(uCol, vA*uOp); }` });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 7; scene.add(this.mesh);
  }
  push(p, side, strength, life) { this.pts.unshift({ p: p.clone(), s: side.clone(), a: strength, t: 0, life }); if (this.pts.length > this.max) this.pts.pop(); }
  update(dt, grow = 0) {
    const P = this.pts; for (const q of P) { q.t += dt; q.s.multiplyScalar(1 + grow * dt); }
    while (P.length && P[P.length - 1].t > P[P.length - 1].life) P.pop();
    for (let i = 0; i < this.max; i++) {
      const q = P[Math.min(i, P.length - 1)];
      if (!q) { this.pos.fill(0); this.al.fill(0); break; }
      const a = i < P.length ? q.a * (1 - q.t / q.life) * Math.min(1, i / 3) : 0;
      this.pos.set([q.p.x + q.s.x, q.p.y + q.s.y, q.p.z + q.s.z, q.p.x - q.s.x, q.p.y - q.s.y, q.p.z - q.s.z], i * 6); this.al[i * 2] = a; this.al[i * 2 + 1] = a;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }
  clear() { this.pts.length = 0; this.update(0); }
}
const vaporL = new Ribbon(70, 0xffffff, 0.45), vaporR = new Ribbon(70, 0xffffff, 0.45);
const contrails = [new Ribbon(160, 0xffffff, 0.55), new Ribbon(160, 0xffffff, 0.55)];

// Debris
const debris = [];
function spawnDebris(fm, root) {
  const mats = []; root.traverse(o => { if (o.isMesh && o.material && !o.material.transparent && mats.length < 4) mats.push(o.material); });
  const sz = fm.d.b / 10;
  for (let i = 0; i < 22; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sz * (0.3 + Math.random()), sz * 0.1, sz * (0.2 + Math.random() * 0.8)), mats[i % mats.length] || MAT.darkMetal);
    m.position.copy(fm.pos); m.castShadow = true; scene.add(m);
    const v = fm.vel.clone().multiplyScalar(0.35).add(V3((Math.random() - 0.5) * 30, Math.random() * 25 + 5, (Math.random() - 0.5) * 30));
    debris.push({ m, v, w: V3(Math.random() * 8, Math.random() * 8, Math.random() * 8), rest: false, smoke: Math.random() < 0.4 });
  }
}
function updateDebris(dt) {
  for (const d of debris) {
    if (d.rest) { if (d.smoke && Math.random() < dt * 6) smoke.emit({ x: d.m.position.x, y: d.m.position.y + 1, z: d.m.position.z, vy: 3, life: 6, s0: 4, s1: 18, r: 0.12, g: 0.12, b: 0.12, a: 0.5, rise: 1 }); continue; }
    d.v.y -= G0 * dt; d.m.position.addScaledVector(d.v, dt); d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
    const g = groundAt(d.m.position.x, d.m.position.z);
    if (d.m.position.y < g.h + 0.2) { d.m.position.y = g.h + 0.2; d.v.y *= -0.3; d.v.x *= 0.5; d.v.z *= 0.5; d.w.multiplyScalar(0.5); if (d.v.length() < 2) d.rest = true; if (g.water) { d.rest = true; d.m.visible = false; } }
  }
}
function clearDebris() { for (const d of debris) { scene.remove(d.m); d.m.geometry.dispose(); } debris.length = 0; }

function explosion(p, water) {
  if (water) {
    for (let i = 0; i < 160; i++) smoke.emit({ x: p.x, y: 1, z: p.z, vx: (Math.random() - 0.5) * 30, vy: 10 + Math.random() * 40, vz: (Math.random() - 0.5) * 30, life: 2.5 + Math.random() * 2, s0: 4, s1: 16, r: 0.95, g: 0.97, b: 1, a: 0.7, drag: 0.8, rise: -8 });
    return;
  }
  for (let i = 0; i < 160; i++) fire.emit({ x: p.x, y: p.y + 2, z: p.z, vx: (Math.random() - 0.5) * 40, vy: Math.random() * 30, vz: (Math.random() - 0.5) * 40, life: 0.8 + Math.random() * 1.4, s0: 6, s1: 22, r: 3, g: 1.6, b: 0.5, r1: 1.2, g1: 0.25, b1: 0.05, a: 0.9, drag: 2.2, rise: 6 });
  for (let i = 0; i < 90; i++) smoke.emit({ x: p.x, y: p.y + 2, z: p.z, vx: (Math.random() - 0.5) * 18, vy: Math.random() * 14, vz: (Math.random() - 0.5) * 18, life: 6 + Math.random() * 6, s0: 10, s1: 45, r: 0.08, g: 0.08, b: 0.08, a: 0.75, drag: 0.9, rise: 2 });
}

// Ring course meshes
const ringMat = new THREE.MeshStandardMaterial({ color: 0xffb23f, emissive: 0xff8a00, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.2 });
const ringDoneMat = new THREE.MeshStandardMaterial({ color: 0x5ee08a, emissive: 0x2aff6a, emissiveIntensity: 0.8, transparent: true, opacity: 0.35 });
const ringGroup = new THREE.Group(); scene.add(ringGroup);
function buildRings(radius) {
  ringGroup.clear();
  const pts = []; let x = 0, z = -3200, hdg = 0; const r = mulberry32(12);
  for (let i = 0; i < 14; i++) {
    hdg += (r() - 0.5) * 50 + (i > 5 && i < 9 ? 22 : 0);
    x += Math.sin(hdg * DEG) * 1900; z -= Math.cos(hdg * DEG) * 1900;
    const g = Math.max(terrainHeight(x, z), terrainHeight(x + 300, z), terrainHeight(x - 300, z), terrainHeight(x, z + 300), terrainHeight(x, z - 300), 0);
    pts.push({ pos: V3(x, g + 160 + r() * 140, z), hdg, done: false });
  }
  pts.forEach((p, i) => {
    const next = pts[i + 1] || p; const prev = pts[i - 1] || { pos: V3(0, p.pos.y, 0) };
    const dir = next === p ? p.pos.clone().sub(prev.pos).normalize() : next.pos.clone().sub(prev.pos).normalize();
    const m = new THREE.Mesh(new THREE.TorusGeometry(radius, Math.max(1.6, radius * 0.05), 12, 48), ringMat); m.position.copy(p.pos); m.lookAt(p.pos.clone().add(dir)); ringGroup.add(m); p.mesh = m; p.normal = dir; p.radius = radius;
  });
  return pts;
}
