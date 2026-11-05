// ============================================================================
//  Procedural aircraft models: fuselage lofts, airfoil wings, moving surfaces
// ============================================================================
function fuselageGeo(sections, seg = 32, p = 2.0) {
  const z0 = sections[0].z, z1 = sections[sections.length - 1].z;
  const pos = [], uv = [], idx = [];
  sections.forEach((s) => {
    const e = 2 / (s.p || p);
    for (let i = 0; i <= seg; i++) {
      const th = i / seg * Math.PI * 2; const sn = Math.sin(th), cs = Math.cos(th);
      const x = Math.sign(sn) * Math.pow(Math.abs(sn), e) * s.w;
      const y = Math.sign(cs) * Math.pow(Math.abs(cs), e) * s.h + (s.y || 0);
      pos.push(x, y, s.z); uv.push(i / seg, (s.z - z0) / (z1 - z0));
    }
  });
  const R = seg + 1;
  for (let j = 0; j < sections.length - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * R + i, b = a + 1, c = a + R, d = c + 1; idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  // weld the seam normals
  const n = g.attributes.normal;
  for (let j = 0; j < sections.length; j++) { const a = j * R, b = j * R + seg; const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b); const l = Math.hypot(nx, ny, nz) || 1; n.setXYZ(a, nx / l, ny / l, nz / l); n.setXYZ(b, nx / l, ny / l, nz / l); }
  return g;
}
const naca = (x) => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
// o: {x0, y0, z0, span, rc, tc, sweep, dihedral, t, vertical}
function wingGeo(o, s0 = 0, s1 = 1, c0 = 0, c1 = 1, hingeFrac = null, M = 12) {
  const rings = [];
  const station = (s) => ({ chord: lerp(o.rc, o.tc, s), zle: o.z0 + s * o.sweep, x: o.x0 + s * o.span, y: o.y0 + s * o.span * Math.tan(o.dihedral || 0) });
  for (const s of [s0, s1]) {
    const S = station(s); const ring = [];
    for (let k = 0; k < M; k++) { const f = c0 + (c1 - c0) * (0.5 - 0.5 * Math.cos(Math.PI * k / (M - 1))); ring.push([S.x, S.y + naca(f) * S.chord * o.t, S.zle + f * S.chord]); }
    for (let k = M - 1; k >= 0; k--) { const f = c0 + (c1 - c0) * (0.5 - 0.5 * Math.cos(Math.PI * k / (M - 1))); ring.push([S.x, S.y - naca(f) * S.chord * o.t - 0.002, S.zle + f * S.chord]); }
    rings.push(ring);
  }
  const L = 2 * M; const pos = [], idx = [];
  rings.forEach(r => r.forEach(p => pos.push(...p)));
  for (let k = 0; k < L; k++) { const k2 = (k + 1) % L; const a = k, b = k2, c = L + k, d = L + k2; idx.push(a, b, c, b, d, c); }
  // caps with own vertices
  for (let ri = 0; ri < 2; ri++) {
    const base = pos.length / 3; rings[ri].forEach(p => pos.push(...p));
    for (let k = 1; k < L - 1; k++) { if (ri === 1) idx.push(base, base + k, base + k + 1); else idx.push(base, base + k + 1, base + k); }
  }
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const hf = hingeFrac ?? c0;
  const h0s = station(s0), h1s = station(s1);
  let h0 = new THREE.Vector3(h0s.x, h0s.y, h0s.zle + hf * h0s.chord), h1 = new THREE.Vector3(h1s.x, h1s.y, h1s.zle + hf * h1s.chord);
  if (o.vertical) { swapXY(g); h0.set(h0.y, h0.x, h0.z); h1.set(h1.y, h1.x, h1.z); }
  g.computeVertexNormals();
  return { geo: g, h0, h1 };
}
function swapXY(g) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setX(i, p.getY(i)); p.setY(i, x); } flipWinding(g); }
function flipWinding(g) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.index.needsUpdate = true; }
function mirrorX(g) { const m = g.clone(); m.scale(-1, 1, 1); flipWinding(m); m.computeVertexNormals(); return m; }

// A hinged control surface (pivot group rotated about hinge axis)
function surface(parent, piece, mat, axisSign = 'x', mirror = false) {
  let g = piece.geo, h0 = piece.h0.clone(), h1 = piece.h1.clone();
  if (mirror) { g = mirrorX(g); h0.x = -h0.x; h1.x = -h1.x; }
  g = g.clone(); g.translate(-h0.x, -h0.y, -h0.z);
  const pivot = new THREE.Group(); pivot.position.copy(h0); parent.add(pivot);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; pivot.add(m);
  const axis = h1.clone().sub(h0).normalize();
  if (axisSign === 'x' && axis.x < 0) axis.negate(); if (axisSign === 'y' && axis.y < 0) axis.negate();
  return { pivot, axis, set(a) { pivot.quaternion.setFromAxisAngle(axis, a); } };
}
function addMesh(parent, geo, mat, cast = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; }
function wingSet(parent, o, mat, cfg) {
  // builds both sides: fixed structure (chord 0..cf), trailing pieces: flap, aileron & fillers
  const cf = cfg.cf ?? 0.74; const out = { flapL: null, flapR: null, ailL: null, ailR: null };
  const fixed = wingGeo(o, 0, 1, 0, cf).geo; addMesh(parent, fixed, mat); addMesh(parent, mirrorX(fixed), mat);
  const spans = [];
  if (cfg.flap) spans.push(['flap', ...cfg.flap]); if (cfg.ail) spans.push(['ail', ...cfg.ail]);
  spans.sort((a, b) => a[1] - b[1]);
  let s = 0;
  for (const [kind, a, b] of spans) {
    if (a > s + 0.001) { const f = wingGeo(o, s, a, cf, 1).geo; addMesh(parent, f, mat); addMesh(parent, mirrorX(f), mat); }
    const piece = wingGeo(o, a, b, cf, 1);
    out[kind + 'R'] = surface(parent, piece, mat, 'x', false); out[kind + 'L'] = surface(parent, piece, mat, 'x', true);
    s = b;
  }
  if (s < 0.999) { const f = wingGeo(o, s, 1, cf, 1).geo; addMesh(parent, f, mat); addMesh(parent, mirrorX(f), mat); }
  return out;
}

// ---------------------------------------------------------------- Materials
function paintMat(tex, opts = {}) {
  const m = new THREE.MeshPhysicalMaterial({ map: tex, roughness: opts.rough ?? 0.32, metalness: opts.metal ?? 0.05, clearcoat: opts.clear ?? 0.7, clearcoatRoughness: 0.18, color: opts.color ?? 0xffffff });
  m.userData.envBase = opts.env ?? 1; return m;
}
function solidMat(color, rough = 0.4, metal = 0.1, clear = 0.5) { const m = new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: metal, clearcoat: clear, clearcoatRoughness: 0.25 }); return m; }
const MAT = {
  tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 }),
  strut: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.9 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.85 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0c1a24, roughness: 0.04, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.55, envMapIntensity: 1.6, side: THREE.DoubleSide }),
  black: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.6 }),
  prop: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.5, metalness: 0.4 }),
};
const glowTex = canvasTex(128, 128, (c) => { const g = c.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.6)'); g.addColorStop(0.5, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); });
function navLight(parent, pos, color, size = 0.9) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sp.position.copy(pos); sp.scale.setScalar(size); parent.add(sp); return sp;
}

// ---------------------------------------------------------------- Livery textures
function liveryTex(draw) { const t = canvasTex(1024, 2048, draw); t.flipY = false; t.needsUpdate = true; return t; }
// helper: draw text along fuselage on one side; u = around (0..1), v = along (0 nose .. 1 tail)
function sideText(c, text, u, v, size, side, color, font = 'bold') {
  c.save(); c.translate(u * 1024, v * 2048); c.rotate(side > 0 ? -Math.PI / 2 : Math.PI / 2); c.fillStyle = color; c.font = `${font} ${size}px "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.scale(1, 0.5); c.fillText(text, 0, 0); c.restore();
}
function windowsRow(c, u, v0, v1, n, w, h, color = '#11161c') { c.fillStyle = color; for (let i = 0; i < n; i++) { const v = lerp(v0, v1, i / (n - 1)); c.beginPath(); c.roundRect(u * 1024 - w / 2, v * 2048 - h / 2, w, h, Math.min(w, h) * 0.45); c.fill(); } }
function panelLines(c, alpha = 0.12, n = 30) { c.strokeStyle = `rgba(0,0,0,${alpha})`; c.lineWidth = 1.5; for (let i = 1; i < n; i++) { c.beginPath(); c.moveTo(0, i * 2048 / n); c.lineTo(1024, i * 2048 / n); c.stroke(); } for (let i = 1; i < 12; i++) { c.beginPath(); c.moveTo(i * 1024 / 12, 0); c.lineTo(i * 1024 / 12, 2048); c.stroke(); } }

// ---------------------------------------------------------------- Common gear
function wheel(r, w) { const g = new THREE.CylinderGeometry(r, r, w, 20); g.rotateZ(Math.PI / 2); return g; }
function makeGear(parent, at, r, strutTop, opts = {}) {
  // at = contact point (bottom of tyre), strutTop = attachment y
  const grp = new THREE.Group(); grp.position.set(at.x, strutTop, at.z); parent.add(grp);
  const len = strutTop - (at.y + r);
  const strut = addMesh(grp, new THREE.CylinderGeometry(r * 0.16, r * 0.2, len, 8).translate(0, -len / 2, 0), MAT.strut);
  const wheels = new THREE.Group(); wheels.position.set(0, -len, 0); grp.add(wheels);
  const n = opts.twin ? 2 : 1; const spin = [];
  for (let i = 0; i < n; i++) {
    const wx = n === 2 ? (i ? 1 : -1) * r * 0.62 : 0;
    const wg = new THREE.Group(); wg.position.x = wx; wheels.add(wg);
    addMesh(wg, wheel(r, r * 0.55), MAT.tire); addMesh(wg, wheel(r * 0.55, r * 0.58), MAT.strut); spin.push(wg);
  }
  if (opts.pant) { const pant = addMesh(wheels, new THREE.SphereGeometry(1, 16, 10).scale(r * 0.55, r * 0.9, r * 2.0), opts.pant); pant.position.y = r * 0.15; }
  return { grp, wheels, spin, r, foldAxis: opts.foldAxis || new THREE.Vector3(1, 0, 0), foldAngle: opts.foldAngle ?? -Math.PI / 2, steer: !!opts.steer };
}

// ---------------------------------------------------------------- Afterburner flame
const flameMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uAB: { value: 0 }, uPow: { value: 0 }, uKick: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv;
    #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `uniform float uTime, uAB, uPow, uKick; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    #include <common>
    #include <logdepthbuf_pars_fragment>
    ${GLSL_NOISE}
    void main(){
      #include <logdepthbuf_fragment>
      float along = vUv.y;                       // 1 at nozzle, 0 at tip
      float len = 1.0 - along;
      float rim = pow(abs(dot(vN, vV)), 1.2);   // bright core, soft edge
      float turb = vnoise(vec2(vUv.x*14.0 + uTime*3.0, len*7.0 - uTime*26.0)) * 0.6 + vnoise(vec2(vUv.x*29.0, len*17.0 - uTime*44.0)) * 0.4;
      float cells = 0.55 + 0.45 * pow(abs(sin(len * 30.0 - uTime * 3.0 + uKick * 4.0)), 3.0);
      float body = pow(along, 1.25) * rim * (0.5 + 0.7*turb);
      vec3 hot  = vec3(1.0, 0.97, 0.9), mid = vec3(1.0, 0.56, 0.2), cool = vec3(0.35, 0.5, 1.0);
      vec3 col = mix(mid, hot, smoothstep(0.55, 1.0, along) * rim);
      col = mix(cool, col, smoothstep(0.02, 0.35, along) );
      col += cool * pow(rim, 3.0) * 0.4 * smoothstep(0.7, 1.0, along);
      float ab = uAB * (1.0 + uKick * 0.8);
      float dry = uPow * 0.14 * pow(along, 2.4) * rim;     // dry thrust: short blue-orange shimmer
      float a = body * cells * ab + dry;
      gl_FragColor = vec4(col * a * 3.4, clamp(a, 0.0, 1.0));
    }`,
});

// ============================================================================
//  Aircraft builders. Forward = -Z, up = +Y, right = +X, origin at CG.
// ============================================================================
function buildLight() {
  const root = new THREE.Group(); const P = {};
  const tex = liveryTex((c) => {
    c.fillStyle = '#f4f3ef'; c.fillRect(0, 0, 1024, 2048); panelLines(c, 0.06, 18);
    // stripe both sides
    for (const u of [0.25, 0.75]) { c.fillStyle = '#b3202a'; c.fillRect(u * 1024 - 70, 300, 30, 1748); c.fillStyle = '#1d3b6e'; c.fillRect(u * 1024 - 36, 300, 16, 1748); }
    c.fillStyle = '#b3202a'; c.fillRect(0, 0, 1024, 250); // cowling
    windowsRow(c, 0.13, 0.27, 0.42, 2, 150, 230, '#1a2430'); windowsRow(c, 0.87, 0.27, 0.42, 2, 150, 230, '#1a2430');
    sideText(c, '4X-RKA', 0.32, 0.7, 120, 1, '#1d3b6e'); sideText(c, '4X-RKA', 0.68, 0.7, 120, -1, '#1d3b6e');
  });
  const paint = paintMat(tex); const white = solidMat(0xf4f3ef, 0.35, 0.05, 0.7); const red = solidMat(0xb3202a, 0.35, 0.05, 0.7);
  const fus = fuselageGeo([
    { z: -2.25, w: 0.30, h: 0.30, y: 0.05 }, { z: -2.1, w: 0.45, h: 0.42, y: 0.05 }, { z: -1.6, w: 0.56, h: 0.56, y: 0.1 },
    { z: -0.95, w: 0.6, h: 0.74, y: 0.3 }, { z: 0.2, w: 0.6, h: 0.74, y: 0.35 }, { z: 1.0, w: 0.52, h: 0.6, y: 0.33 },
    { z: 2.5, w: 0.3, h: 0.42, y: 0.32 }, { z: 4.5, w: 0.13, h: 0.24, y: 0.38 }, { z: 5.5, w: 0.06, h: 0.12, y: 0.45 }, { z: 5.7, w: 0.01, h: 0.02, y: 0.45 },
  ], 32, 2.6);
  addMesh(root, fus, paint);
  // windshield
  const ws = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.58, 0.42, 0.75), MAT.glass); ws.position.set(0, 0.62, -0.75); ws.rotation.x = -0.35; root.add(ws);
  const wing = { x0: 0.55, y0: 1.06, z0: -0.6, span: 4.95, rc: 1.6, tc: 1.15, sweep: 0.12, dihedral: 1.7 * DEG, t: 0.13 };
  addMesh(root, wingGeo({ ...wing, x0: -0.6, span: 1.2, tc: 1.6, sweep: 0, dihedral: 0 }).geo, white);
  const ws1 = wingSet(root, wing, white, { cf: 0.74, flap: [0.0, 0.48], ail: [0.55, 0.95] }); Object.assign(P, ws1);
  // struts
  for (const s of [-1, 1]) { const a = new THREE.Vector3(s * 0.55, -0.2, 0.05), b = new THREE.Vector3(s * 2.7, 1.1, -0.1); const st = addMesh(root, new THREE.CylinderGeometry(0.035, 0.05, a.distanceTo(b), 6), white); st.position.copy(a).add(b).multiplyScalar(0.5); st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); }
  const hs = { x0: 0.08, y0: 0.42, z0: 4.35, span: 1.65, rc: 1.1, tc: 0.7, sweep: 0.18, dihedral: 0, t: 0.09 };
  addMesh(root, wingGeo({ ...hs, x0: -0.1, span: 0.2, tc: 1.1, sweep: 0 }, 0, 1, 0, 0.62).geo, white);
  const hsF = wingGeo(hs, 0, 1, 0, 0.62).geo; addMesh(root, hsF, white); addMesh(root, mirrorX(hsF), white);
  const el = wingGeo(hs, 0, 1, 0.62, 1); P.elevR = surface(root, el, red, 'x'); P.elevL = surface(root, el, red, 'x', true);
  const vf = { x0: 0.45, y0: 0, z0: 4.0, span: 1.45, rc: 1.5, tc: 0.75, sweep: 0.75, t: 0.09, vertical: true };
  addMesh(root, wingGeo(vf, 0, 1, 0, 0.62).geo, white); P.rud = surface(root, wingGeo(vf, 0, 1, 0.62, 1), red, 'y');
  // dorsal fin fillet
  addMesh(root, wingGeo({ x0: 0.42, y0: 0, z0: 2.6, span: 0.2, rc: 1.8, tc: 0.4, sweep: 1.4, t: 0.06, vertical: true }).geo, white);
  // propeller
  const prop = new THREE.Group(); prop.position.set(0, 0.06, -2.28); root.add(prop);
  addMesh(prop, new THREE.ConeGeometry(0.2, 0.42, 20).rotateX(-Math.PI / 2).translate(0, 0, -0.18), red);
  const blades = new THREE.Group(); prop.add(blades);
  for (const s of [-1, 1]) { const b = addMesh(blades, new THREE.BoxGeometry(0.11, 0.95, 0.03).translate(0, s * 0.52, 0), MAT.prop); b.rotation.y = s * 0.25; }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.98, 40), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); disc.position.z = -0.02; prop.add(disc);
  P.prop = { group: blades, disc, maxBlur: 0.22 };
  // gear (fixed, with wheel pants)
  P.gear = [
    makeGear(root, new THREE.Vector3(0, -1.25, -1.6), 0.19, -0.35, { steer: true, pant: white }),
    makeGear(root, new THREE.Vector3(-1.2, -1.25, 0.45), 0.22, -0.4, { pant: white }),
    makeGear(root, new THREE.Vector3(1.2, -1.25, 0.45), 0.22, -0.4, { pant: white }),
  ];
  P.gear[1].grp.rotation.z = -0.0; P.gear[2].grp.rotation.z = 0.0;
  // lights
  P.nav = [navLight(root, new THREE.Vector3(-5.55, 1.1, -0.2), 0xff2a2a, 0.5), navLight(root, new THREE.Vector3(5.55, 1.1, -0.2), 0x2aff5a, 0.5), navLight(root, new THREE.Vector3(0, 1.9, 5.3), 0xffffff, 0.4)];
  P.strobe = [navLight(root, new THREE.Vector3(-5.6, 1.1, 0.1), 0xffffff, 1.6), navLight(root, new THREE.Vector3(5.6, 1.1, 0.1), 0xffffff, 1.6)];
  P.landLight = new THREE.Vector3(-2.2, 1.0, -0.65);
  return { root, P, eye: new THREE.Vector3(-0.28, 0.62, -0.45) };
}

function buildFighter() {
  const root = new THREE.Group(); const P = {};
  const tex = liveryTex((c) => {
    c.fillStyle = '#7d868e'; c.fillRect(0, 0, 1024, 2048);
    // subtle two-tone camo
    const r = mulberry32(5); c.fillStyle = 'rgba(70,78,86,0.55)';
    for (let i = 0; i < 26; i++) { c.beginPath(); c.ellipse(r() * 1024, r() * 2048, 60 + r() * 120, 120 + r() * 220, r() * 3, 0, 7); c.fill(); }
    c.fillStyle = '#9ba3aa'; c.fillRect(380, 0, 264, 2048); // belly lighter
    panelLines(c, 0.16, 36);
    c.fillStyle = '#2b3036'; c.fillRect(0, 0, 1024, 140); // radome
    sideText(c, '107', 0.3, 0.42, 150, 1, '#2b3036'); sideText(c, '107', 0.7, 0.42, 150, -1, '#2b3036');
    c.fillStyle = '#e8b52a'; c.fillRect(0.24 * 1024, 0.2 * 2048, 20, 40); c.fillRect(0.76 * 1024, 0.2 * 2048, 20, 40);
  });
  const paint = paintMat(tex, { rough: 0.5, clear: 0.15, metal: 0.25 }); const grey = solidMat(0x7d868e, 0.52, 0.25, 0.15); const dgrey = solidMat(0x5a6168, 0.55, 0.3, 0.1);
  const fus = fuselageGeo([
    { z: -8.2, w: 0.02, h: 0.02, y: -0.08 }, { z: -7.5, w: 0.28, h: 0.28, y: -0.05 }, { z: -6.3, w: 0.52, h: 0.54, y: 0 }, { z: -5.0, w: 0.64, h: 0.72, y: 0.08 },
    { z: -4.0, w: 0.72, h: 0.8, y: 0.12 }, { z: -2.6, w: 0.86, h: 0.84, y: 0.04 }, { z: -1.0, w: 1.04, h: 0.8, y: 0 }, { z: 1.0, w: 1.08, h: 0.74, y: 0 },
    { z: 3.0, w: 0.98, h: 0.68, y: 0.04 }, { z: 5.0, w: 0.74, h: 0.6, y: 0.05 }, { z: 6.4, w: 0.56, h: 0.54, y: 0.05 }, { z: 6.9, w: 0.52, h: 0.52, y: 0.05 },
  ], 36, 2.3);
  addMesh(root, fus, paint);
  // intake
  const intake = fuselageGeo([{ z: -3.3, w: 0.5, h: 0.38, y: -0.86 }, { z: -2.8, w: 0.6, h: 0.45, y: -0.88 }, { z: 0.5, w: 0.62, h: 0.45, y: -0.78 }, { z: 2.5, w: 0.3, h: 0.25, y: -0.5 }], 24, 2.4);
  addMesh(root, intake, grey);
  const lip = addMesh(root, new THREE.CircleGeometry(1, 24).scale(0.46, 0.34, 1), MAT.black); lip.position.set(0, -0.86, -3.31); lip.rotation.y = Math.PI;
  // canopy
  const can = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.5, 0.62, 1.75), MAT.glass); can.position.set(0, 0.78, -4.15); root.add(can);
  const frame = addMesh(root, new THREE.TorusGeometry(0.5, 0.035, 6, 20, Math.PI).scale(1, 1.15, 1), dgrey); frame.position.set(0, 0.8, -3.2);
  // wings (flaperons) + LERX
  const wing = { x0: 0.95, y0: -0.12, z0: -1.4, span: 3.95, rc: 4.3, tc: 1.05, sweep: 3.55, dihedral: 0, t: 0.05 };
  const ws1 = wingSet(root, wing, grey, { cf: 0.76, ail: [0.04, 0.8] }); P.ailL = ws1.ailL; P.ailR = ws1.ailR; P.flaperon = true;
  const lerx = wingGeo({ x0: 0.8, y0: -0.05, z0: -5.4, span: 0.5, rc: 4.2, tc: 0.4, sweep: 3.8, t: 0.03 }).geo; addMesh(root, lerx, grey); addMesh(root, mirrorX(lerx), grey);
  // stabs: all-moving
  const hs = { x0: 0.75, y0: -0.05, z0: 4.55, span: 2.15, rc: 2.3, tc: 0.75, sweep: 1.75, dihedral: -9 * DEG, t: 0.05 };
  const hsP = wingGeo(hs, 0, 1, 0, 1, 0.35); P.elevR = surface(root, hsP, grey, 'x'); P.elevL = surface(root, hsP, grey, 'x', true); P.elevScale = 1;
  const vf = { x0: 0.55, y0: 0, z0: 3.3, span: 2.95, rc: 3.5, tc: 1.1, sweep: 2.7, t: 0.05, vertical: true };
  addMesh(root, wingGeo(vf, 0, 1, 0, 0.72).geo, grey); P.rud = surface(root, wingGeo(vf, 0.05, 0.85, 0.72, 1), grey, 'y');
  addMesh(root, wingGeo({ ...vf, span: 0.15, x0: vf.x0 + vf.span * 0.85 }, 0, 1, 0.72, 1).geo, grey);
  // ventral fins
  for (const s of [-1, 1]) { const vfin = wingGeo({ x0: -0.55, y0: s * 0.55, z0: 4.4, span: -0.6, rc: 1.3, tc: 0.7, sweep: 0.3, t: 0.04, vertical: true }).geo; addMesh(root, vfin, dgrey); }
  // nozzle
  const noz = addMesh(root, new THREE.CylinderGeometry(0.5, 0.42, 1.2, 24, 1, true).rotateX(Math.PI / 2).translate(0, 0.05, 7.5), MAT.darkMetal);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), new THREE.MeshBasicMaterial({ color: 0x331100 })); glow.position.set(0, 0.05, 7.2); root.add(glow); P.nozzleGlow = glow;
  const flame = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.05, 6, 24, 1, true).rotateX(-Math.PI / 2).translate(0, 0.05, 10.9), flameMat); flame.renderOrder = 10; root.add(flame);
  const flame2 = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.02, 3.2, 16, 1, true).rotateX(-Math.PI / 2).translate(0, 0.05, 9.5), flameMat); flame2.renderOrder = 10; root.add(flame2);
  const flame3 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.08, 8.5, 24, 1, true).rotateX(-Math.PI / 2).translate(0, 0.05, 11.6), flameMat); flame3.renderOrder = 9; root.add(flame3);
  P.flame = [flame, flame2, flame3];
  P.glow = navLight(root, new THREE.Vector3(0, 0.05, 7.6), 0xff8a3a, 0); P.glow.renderOrder = 11;
  // wingtip missiles
  for (const s of [-1, 1]) { const m = addMesh(root, new THREE.CylinderGeometry(0.065, 0.065, 2.9, 10).rotateX(Math.PI / 2), solidMat(0xe6e6e6, 0.4)); m.position.set(s * 4.98, -0.12, 1.3); const nose = addMesh(root, new THREE.ConeGeometry(0.065, 0.3, 10).rotateX(-Math.PI / 2), MAT.darkMetal); nose.position.set(s * 4.98, -0.12, -0.25); }
  // speed brakes
  P.spd = [];
  for (const s of [-1, 1]) { const piv = new THREE.Group(); piv.position.set(s * 0.62, 0.05, 6.1); root.add(piv); addMesh(piv, new THREE.BoxGeometry(0.04, 0.55, 1.1).translate(0, 0, 0.55), dgrey); P.spd.push({ piv, s }); }
  // hook
  const hook = new THREE.Group(); hook.position.set(0, -0.5, 5.6); root.add(hook); addMesh(hook, new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6).translate(0, -0.9, 0), solidMat(0xe0c020, 0.5)); P.hook = hook; hook.rotation.x = -1.45;
  // gear
  P.gear = [
    makeGear(root, new THREE.Vector3(0, -2.0, -4.3), 0.3, -0.55, { steer: true, foldAngle: -Math.PI / 2 * 1.05 }),
    makeGear(root, new THREE.Vector3(-1.25, -2.0, 0.65), 0.38, -0.55, { foldAxis: new THREE.Vector3(0, 0, 1), foldAngle: Math.PI / 2 }),
    makeGear(root, new THREE.Vector3(1.25, -2.0, 0.65), 0.38, -0.55, { foldAxis: new THREE.Vector3(0, 0, 1), foldAngle: -Math.PI / 2 }),
  ];
  P.nav = [navLight(root, new THREE.Vector3(-1.1, 0.0, -1.2), 0xff2a2a, 0.35), navLight(root, new THREE.Vector3(1.1, 0.0, -1.2), 0x2aff5a, 0.35), navLight(root, new THREE.Vector3(0, 3.3, 6.0), 0xffffff, 0.35)];
  P.strobe = [navLight(root, new THREE.Vector3(0, 0.75, 1.5), 0xffffff, 1.2)];
  P.landLight = new THREE.Vector3(0, -1.6, -4.0);
  return { root, P, eye: new THREE.Vector3(0, 1.0, -4.45) };
}

function buildAirliner() {
  const root = new THREE.Group(); const P = {};
  const tex = liveryTex((c) => {
    c.fillStyle = '#f6f6f3'; c.fillRect(0, 0, 1024, 2048);
    c.fillStyle = '#c9ccd0'; c.fillRect(330, 0, 364, 2048); // belly
    // cheatline: teal sweep both sides
    for (const [u0, s] of [[0.30, 1], [0.70, -1]]) {
      c.fillStyle = '#0f6c7a'; c.beginPath(); c.moveTo(u0 * 1024 - s * 0, 120); c.lineTo(u0 * 1024 + s * 30, 2048); c.lineTo(u0 * 1024 + s * 110, 2048); c.lineTo(u0 * 1024 + s * 40, 120); c.fill();
      c.fillStyle = '#e69b2e'; c.fillRect(u0 * 1024 + s * 45 - (s < 0 ? 12 : 0), 220, 12, 1828);
    }
    panelLines(c, 0.05, 40);
    windowsRow(c, 0.205, 0.17, 0.86, 34, 26, 34); windowsRow(c, 0.795, 0.17, 0.86, 34, 26, 34);
    // cockpit windows (nose)
    c.fillStyle = '#10161c'; for (const u of [0.05, 0.12, 0.88, 0.95]) { c.beginPath(); c.moveTo(u * 1024 - 34, 40); c.lineTo(u * 1024 + 34, 40); c.lineTo(u * 1024 + 30, 78); c.lineTo(u * 1024 - 30, 78); c.fill(); }
    c.fillRect(0, 40, 22, 38); c.fillRect(1002, 40, 22, 38);
    // doors
    c.strokeStyle = 'rgba(60,60,60,0.5)'; c.lineWidth = 3; for (const v of [0.13, 0.5, 0.88]) for (const u of [0.22, 0.78]) c.strokeRect(u * 1024 - 22, v * 2048 - 30, 44, 60);
    sideText(c, 'MERIDIAN', 0.145, 0.42, 150, 1, '#0f3e5a'); sideText(c, 'MERIDIAN', 0.855, 0.42, 150, -1, '#0f3e5a');
  });
  const paint = paintMat(tex, { rough: 0.28, clear: 0.85 }); const wingM = solidMat(0xd8dade, 0.4, 0.35, 0.3); const tailM = solidMat(0x0f6c7a, 0.3, 0.05, 0.8);
  const fus = fuselageGeo([
    { z: -18.7, w: 0.05, h: 0.05, y: -0.45 }, { z: -18.35, w: 0.75, h: 0.75, y: -0.35 }, { z: -17.5, w: 1.4, h: 1.45, y: -0.18 }, { z: -16.2, w: 1.82, h: 1.9, y: -0.03 },
    { z: -14.4, w: 2.0, h: 2.06, y: 0 }, { z: 10.5, w: 2.0, h: 2.06, y: 0 }, { z: 13.2, w: 1.78, h: 1.78, y: 0.3 }, { z: 16.0, w: 1.2, h: 1.15, y: 0.85 },
    { z: 18.6, w: 0.48, h: 0.52, y: 1.3 }, { z: 19.5, w: 0.06, h: 0.1, y: 1.4 },
  ], 40, 2.0);
  addMesh(root, fus, paint);
  // wing root fairing
  addMesh(root, fuselageGeo([{ z: -7, w: 1.6, h: 0.2, y: -1.55 }, { z: -4.5, w: 2.3, h: 0.6, y: -1.5 }, { z: 2.5, w: 2.3, h: 0.6, y: -1.5 }, { z: 5.2, w: 1.4, h: 0.3, y: -1.4 }], 24, 2.5), solidMat(0xc9ccd0, 0.4));
  const wing = { x0: 1.6, y0: -1.35, z0: -5.6, span: 15.6, rc: 7.2, tc: 1.6, sweep: 8.4, dihedral: 5 * DEG, t: 0.12 };
  const ws1 = wingSet(root, wing, wingM, { cf: 0.74, flap: [0.0, 0.62], ail: [0.66, 0.93] }); Object.assign(P, ws1);
  // spoilers (plates on top)
  P.spoil = [];
  for (const s of [-1, 1]) {
    const st = (f) => ({ x: s * (wing.x0 + f * wing.span), y: wing.y0 + f * wing.span * Math.tan(wing.dihedral), z: wing.z0 + f * wing.sweep + 0.56 * lerp(wing.rc, wing.tc, f) });
    const a = st(0.2), b = st(0.6);
    const A = new THREE.Vector3(a.x, a.y + 0.36, a.z), B = new THREE.Vector3(b.x, b.y + 0.3, b.z);
    const cv = new THREE.Vector3(0, -0.06, 0.95);
    const pts = [A, B, B.clone().add(cv), A.clone().add(cv)];
    const pos = []; const tri = (p, q, r) => pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
    tri(pts[0], pts[3], pts[1]); tri(pts[1], pts[3], pts[2]); tri(pts[0], pts[1], pts[3]); tri(pts[1], pts[2], pts[3]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    P.spoil.push(surface(root, { geo: g, h0: A, h1: B }, wingM, 'x'));
  }
  // winglets
  for (const s of [1, -1]) { const tip = { x: wing.x0 + wing.span, y: wing.y0 + wing.span * Math.tan(wing.dihedral), z: wing.z0 + wing.sweep }; const wl = wingGeo({ x0: tip.y, y0: tip.x, z0: tip.z, span: 2.3, rc: 1.6, tc: 0.6, sweep: 1.5, t: 0.08, vertical: true }).geo; addMesh(root, s > 0 ? wl : mirrorX(wl), tailM); }
  // engines
  P.fans = [];
  for (const s of [-1, 1]) {
    const eng = new THREE.Group(); eng.position.set(s * 5.9, -2.45, -7.2); root.add(eng);
    const nac = new THREE.LatheGeometry([[0.95, 0], [1.08, 0.3], [1.1, 1.2], [1.02, 2.8], [0.8, 4.2], [0.55, 4.9]].map(([r, z]) => new THREE.Vector2(r, z)), 32).rotateX(Math.PI / 2);
    { const nm = solidMat(0xe8e9ea, 0.3, 0.2, 0.8); nm.side = THREE.DoubleSide; addMesh(eng, nac, nm); }
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.93, 0.93, 0.8, 32, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.4), new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.6, metalness: 0.6, side: THREE.BackSide })); eng.add(inner);
    const fan = new THREE.Group(); fan.position.z = 0.5; eng.add(fan);
    addMesh(fan, new THREE.ConeGeometry(0.3, 0.6, 20).rotateX(-Math.PI / 2), MAT.strut);
    for (let i = 0; i < 18; i++) { const b = addMesh(fan, new THREE.BoxGeometry(0.06, 0.62, 0.12).translate(0, 0.6, 0), MAT.darkMetal, false); b.rotation.z = i / 18 * Math.PI * 2; b.rotation.y = 0.35; }
    const fd = new THREE.Mesh(new THREE.CircleGeometry(0.93, 28), new THREE.MeshBasicMaterial({ color: 0x24262a, transparent: true, opacity: 0, depthWrite: false })); fd.position.z = 0.52; fd.rotation.y = Math.PI; eng.add(fd);
    (P.fanDisc = P.fanDisc || []).push(fd); P.fans.push(fan);
    const core = addMesh(eng, new THREE.ConeGeometry(0.42, 1.2, 20).rotateX(Math.PI / 2).translate(0, 0, 5.3), MAT.darkMetal);
    const pylon = addMesh(eng, new THREE.BoxGeometry(0.28, 0.9, 4.2).translate(0, 1.15, 2.3), wingM);
  }
  const hs = { x0: 0.6, y0: 0.95, z0: 14.0, span: 6.1, rc: 3.8, tc: 1.4, sweep: 3.7, dihedral: 6 * DEG, t: 0.1 };
  const hsF = wingGeo(hs, 0, 1, 0, 0.7).geo; addMesh(root, hsF, wingM); addMesh(root, mirrorX(hsF), wingM);
  const el = wingGeo(hs, 0, 1, 0.7, 1); P.elevR = surface(root, el, wingM, 'x'); P.elevL = surface(root, el, wingM, 'x', true);
  const vf = { x0: 1.5, y0: 0, z0: 11.6, span: 6.4, rc: 5.6, tc: 1.9, sweep: 5.6, t: 0.1, vertical: true };
  addMesh(root, wingGeo(vf, 0, 1, 0, 0.68).geo, tailM); P.rud = surface(root, wingGeo(vf, 0.03, 0.95, 0.68, 1), tailM, 'y');
  addMesh(root, wingGeo({ ...vf, x0: vf.x0 + vf.span * 0.95, span: vf.span * 0.05 }, 0, 1, 0.68, 1).geo, tailM);
  addMesh(root, wingGeo({ x0: 1.4, y0: 0, z0: 9.2, span: 0.8, rc: 3.4, tc: 1.2, sweep: 2.6, t: 0.06, vertical: true }).geo, tailM);
  // gear
  P.gear = [
    makeGear(root, new THREE.Vector3(0, -4.0, -12.9), 0.42, -1.3, { steer: true, twin: true, foldAngle: -Math.PI / 2 }),
    makeGear(root, new THREE.Vector3(-3.8, -4.0, 1.2), 0.6, -1.25, { twin: true, foldAxis: new THREE.Vector3(0, 0, 1), foldAngle: -Math.PI / 2 }),
    makeGear(root, new THREE.Vector3(3.8, -4.0, 1.2), 0.6, -1.25, { twin: true, foldAxis: new THREE.Vector3(0, 0, 1), foldAngle: Math.PI / 2 }),
  ];
  P.nav = [navLight(root, new THREE.Vector3(-17.3, 0.2, 2.9), 0xff2a2a, 0.8), navLight(root, new THREE.Vector3(17.3, 0.2, 2.9), 0x2aff5a, 0.8), navLight(root, new THREE.Vector3(0, 1.5, 19.5), 0xffffff, 0.6)];
  P.strobe = [navLight(root, new THREE.Vector3(-17.4, 0.2, 3.4), 0xffffff, 2.6), navLight(root, new THREE.Vector3(17.4, 0.2, 3.4), 0xffffff, 2.6), navLight(root, new THREE.Vector3(0, 1.45, 19.6), 0xffffff, 1.6)];
  P.beacon = [navLight(root, new THREE.Vector3(0, 2.15, 0), 0xff2020, 1.5), navLight(root, new THREE.Vector3(0, -2.15, -2), 0xff2020, 1.5)];
  P.landLight = new THREE.Vector3(0, -2.6, -12.6);
  return { root, P, eye: new THREE.Vector3(-0.55, 0.95, -16.2) };
}
