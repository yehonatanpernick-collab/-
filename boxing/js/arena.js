import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export const RING = { half: 3.0, ropeHeights: [0.42, 0.76, 1.1, 1.44], apron: 3.45, platform: 1.05 };
export const TITLE = 'IRON CANVAS';

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...opts.repeat); }
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const FONT = '"Barlow Condensed", "Heebo", sans-serif';

function drawLogo(g, cx, cy, s, color = '#111', accent = '#b3121d') {
  g.save(); g.translate(cx, cy);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = accent;
  g.beginPath(); g.moveTo(-s * 1.55, -s * 0.36); g.lineTo(s * 1.65, -s * 0.36); g.lineTo(s * 1.55, s * 0.36); g.lineTo(-s * 1.65, s * 0.36); g.closePath(); g.fill();
  g.fillStyle = color;
  g.font = `italic 900 ${s * 0.62}px ${FONT}`;
  g.fillText(TITLE, 0, s * 0.02);
  g.font = `700 ${s * 0.15}px ${FONT}`; g.fillStyle = color;
  g.fillText('W O R L D   K I C K B O X I N G   C H A M P I O N S H I P', 0, s * 0.56);
  g.restore();
}

export function buildArena(scene, renderer, quality) {
  const arena = new THREE.Group(); scene.add(arena);
  const H = RING.half, P = RING.platform;
  const update = [];

  // ---------- ring canvas ----------
  const canvasMap = canvasTex(2048, 2048, (g, w, h) => {
    g.fillStyle = '#bdbcb6'; g.fillRect(0, 0, w, h);
    // grime / scuffs
    for (let i = 0; i < 2200; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rnd(4, 60);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${rnd(60, 110)|0},${rnd(55, 95)|0},${rnd(50, 90)|0},${rnd(0.01, 0.05)})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // centre wear
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.45);
    grd.addColorStop(0, 'rgba(90,80,70,0.10)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // edge border
    g.strokeStyle = '#1c2a52'; g.lineWidth = 46; g.strokeRect(23, 23, w - 46, h - 46);
    g.strokeStyle = '#a3141e'; g.lineWidth = 10; g.strokeRect(62, 62, w - 124, h - 124);
    // centre logo
    g.globalAlpha = 0.92; drawLogo(g, w / 2, h / 2, 330, '#f4f2ea', '#1c2a52'); g.globalAlpha = 1;
    g.strokeStyle = 'rgba(28,42,82,0.85)'; g.lineWidth = 8;
    g.beginPath(); g.arc(w / 2, h / 2, 640, 0, Math.PI * 2); g.stroke();
    // sponsors near the ropes
    const sp = ['VOLTA ENERGY', 'KRAV GEAR', 'NORTHLINE', 'AXIS TELECOM'];
    g.font = `italic 800 92px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    sp.forEach((s, i) => {
      g.save(); g.translate(w / 2, h / 2); g.rotate(i * Math.PI / 2); g.translate(0, h * 0.4);
      g.fillStyle = i % 2 ? '#a3141e' : '#1c2a52'; g.fillText(s, 0, 0); g.restore();
    });
    // blood/sweat stains (subtle)
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(120,40,35,${rnd(0.03, 0.08)})`; g.beginPath(); g.arc(rnd(500, 1500), rnd(500, 1500), rnd(3, 14), 0, 7); g.fill(); }
  });
  const weave = canvasTex(256, 256, (g, w, h) => {
    const id = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = 128 + 40 * Math.sin(x * Math.PI / 2) * (y % 4 < 2 ? 1 : -1) + rnd(-20, 20);
      const o = (y * w + x) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  }, { linear: true, repeat: [70, 70] });
  const floorMat = new THREE.MeshPhysicalMaterial({ map: canvasMap, roughness: 0.82, bumpMap: weave, bumpScale: 0.6, sheen: 0.4, sheenColor: 0x888888, sheenRoughness: 0.8 });
  const ringFloor = new THREE.Mesh(new THREE.BoxGeometry(RING.apron * 2, 0.08, RING.apron * 2), [
    new THREE.MeshStandardMaterial({ color: 0x1c2a52, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0x1c2a52, roughness: 0.8 }),
    floorMat, floorMat, new THREE.MeshStandardMaterial({ color: 0x1c2a52, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0x1c2a52, roughness: 0.8 })]);
  // remap top uv to cover full canvas
  ringFloor.position.y = -0.04; ringFloor.receiveShadow = true; arena.add(ringFloor);

  // ---------- platform skirt ----------
  const skirtTex = canvasTex(2048, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#16161a'); grd.addColorStop(1, '#070708');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#a3141e'; g.fillRect(0, 0, w, 14);
    g.font = `italic 900 120px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillStyle = '#f2f0ea'; g.fillText(TITLE, w * 0.3, h * 0.55);
    g.font = `italic 800 84px ${FONT}`; g.fillStyle = '#c9a54a'; g.fillText('VOLTA ENERGY', w * 0.75, h * 0.55);
  });
  const skirtMat = new THREE.MeshStandardMaterial({ map: skirtTex, roughness: 0.9 });
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(RING.apron * 2 - 0.02, P - 0.08, RING.apron * 2 - 0.02), [skirtMat, skirtMat, new THREE.MeshStandardMaterial({ color: 0x111111 }), new THREE.MeshStandardMaterial({ color: 0x111111 }), skirtMat, skirtMat]);
  skirt.position.y = -0.08 - (P - 0.08) / 2; skirt.receiveShadow = true; arena.add(skirt);
  // padded apron edge
  const edgeMat = new THREE.MeshPhysicalMaterial({ color: 0x1c2a52, roughness: 0.45, clearcoat: 0.5 });
  for (let i = 0; i < 4; i++) {
    const e = new THREE.Mesh(new RoundedBoxGeometry(RING.apron * 2 + 0.06, 0.12, 0.12, 3, 0.04), edgeMat);
    e.position.y = -0.03; const a = i * Math.PI / 2; e.rotation.y = a;
    e.position.x = Math.sin(a) * RING.apron; e.position.z = Math.cos(a) * RING.apron; arena.add(e); e.receiveShadow = true;
  }

  // ---------- posts, pads, ropes ----------
  const postMat = new THREE.MeshPhysicalMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.25 });
  const padCols = [0xb3121d, 0xeeeeee, 0x1d3a8a, 0xeeeeee]; // red corner (-x,-z), neutral, blue (+x,+z), neutral
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const C = H + 0.16;
  const padTexes = padCols.map((col) => canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#' + col.toString(16).padStart(6, '0'); g.fillRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 2);
    g.font = `italic 900 92px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = col === 0xeeeeee ? '#1c2a52' : '#ffffff'; g.fillText(TITLE.split(' ')[0], 0, 0); g.restore();
  }));
  corners.forEach(([sx, sz], i) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, P + 1.62, 16), postMat);
    post.position.set(sx * C, (1.62 - P) / 2, sz * C); post.castShadow = true; arena.add(post);
    const pad = new THREE.Mesh(new RoundedBoxGeometry(0.26, 1.28, 0.26, 4, 0.08), new THREE.MeshPhysicalMaterial({ map: padTexes[i], roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.3 }));
    pad.position.set(sx * (C - 0.1), 0.93, sz * (C - 0.1)); pad.rotation.y = Math.atan2(sx, sz) + Math.PI; pad.castShadow = true; arena.add(pad);
    // steps at red and blue corners
    if (i === 0 || i === 2) {
      for (let s = 0; s < 3; s++) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.33, 0.4), new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.7 }));
        const d = RING.apron + 0.3 + s * 0.4;
        st.position.set(sx * (d * 0.707 + 0.0), -P + 0.165 + (2 - s) * 0.33 - (2 - s) * 0.0, sz * (d * 0.707));
        st.scale.y = (3 - s); st.position.y = -P + 0.165 * (3 - s);
        st.rotation.y = Math.PI / 4; arena.add(st);
      }
    }
  });
  const ropeCols = [0xb3121d, 0xf0f0f0, 0x1d3a8a, 0xf0f0f0].reverse();
  const ropeMats = ropeCols.map(c => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.25, sheen: 0.3 }));
  const ropes = [];
  RING.ropeHeights.forEach((y, ri) => {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      const A = new THREE.Vector3(ax * (C - 0.04), y, az * (C - 0.04)), B = new THREE.Vector3(bx * (C - 0.04), y, bz * (C - 0.04));
      const pts = [];
      for (let k = 0; k <= 16; k++) { const t = k / 16; const p = A.clone().lerp(B, t); p.y -= Math.sin(Math.PI * t) * 0.035; pts.push(p); }
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 48, 0.024, 10, false);
      const m = new THREE.Mesh(geo, ropeMats[ri].clone()); m.castShadow = true; arena.add(m); m.material.transparent = true;
      ropes.push({ mesh: m, side: i, A, B, y, wobble: 0, v: 0, geo, base: geo.attributes.position.array.slice() });
    }
  });
  // rope ties
  const tieMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.7 });
  const ties = [];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
    for (const t of [1 / 3, 2 / 3]) {
      const tie = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 0.03), tieMat.clone()); tie.material.transparent = true; ties.push({ mesh: tie, side: i });
      tie.position.set(THREE.MathUtils.lerp(ax, bx, t) * (C - 0.04), 0.95, THREE.MathUtils.lerp(az, bz, t) * (C - 0.04));
      tie.rotation.y = Math.atan2(bx - ax, bz - az); arena.add(tie);
    }
  }

  // ---------- arena floor + barrier with LED boards ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x0c0c0f, roughness: 0.55, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -P; floor.receiveShadow = true; arena.add(floor);
  const ledTex = canvasTex(2048, 128, (g, w, h) => {
    g.fillStyle = '#050507'; g.fillRect(0, 0, w, h);
    const items = [['IRON CANVAS', '#ffffff', '#a3141e'], ['VOLTA ENERGY', '#111', '#e2b33c'], ['KRAV GEAR', '#ffffff', '#1d3a8a'], ['NORTHLINE', '#ffffff', '#202024']];
    items.forEach(([s, fg, bg], i) => {
      const x = i * w / 4; g.fillStyle = bg; g.fillRect(x + 6, 8, w / 4 - 12, h - 16);
      g.fillStyle = fg; g.font = `italic 900 84px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x + w / 8, h / 2 + 4);
    });
    // LED pixel grid
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  }, { repeat: [2, 1] });
  const ledMat = new THREE.MeshBasicMaterial({ map: ledTex, toneMapped: true });
  ledMat.color.setScalar(1.6);
  const R = 6.2;
  for (let i = 0; i < 4; i++) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(R * 2, 0.9, 0.12), [new THREE.MeshStandardMaterial({ color: 0x0a0a0c }), new THREE.MeshStandardMaterial({ color: 0x0a0a0c }), new THREE.MeshStandardMaterial({ color: 0x111114 }), new THREE.MeshStandardMaterial({ color: 0x0a0a0c }), ledMat, new THREE.MeshStandardMaterial({ color: 0x0a0a0c })]);
    const a = i * Math.PI / 2; wall.rotation.y = a + Math.PI;
    wall.position.set(Math.sin(a) * R, -P + 0.45, Math.cos(a) * R); arena.add(wall);
  }
  update.push((dt, t) => { ledTex.offset.x = (t * 0.03) % 1; });

  // ringside tables with monitors
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.6 });
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x3355aa });
  screenMat.color.setRGB(0.25, 0.35, 0.7);
  for (const sx of [-1, 1]) {
    const tb = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.75, 0.7), tableMat); tb.position.set(0, -P + 0.375, sx * 4.9); arena.add(tb);
    for (let k = -1; k <= 1; k++) {
      const mon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.03), screenMat); mon.position.set(k * 1.1, -P + 0.95, sx * 4.75); mon.rotation.y = sx > 0 ? Math.PI : 0; mon.rotation.x = 0.15 * sx; arena.add(mon);
    }
  }

  // ---------- crowd ----------
  buildCrowd(arena, update, quality);

  // ---------- lighting rig ----------
  const truss = new THREE.Group(); arena.add(truss);
  const trussY = 5.6, T = 3.9;
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1d, metalness: 0.6, roughness: 0.5 });
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(T * 2 + 0.3, 0.3, 0.3), beamMat);
    const a = i * Math.PI / 2; b.rotation.y = a; b.position.set(Math.sin(a) * T, trussY, Math.cos(a) * T); truss.add(b);
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); lampMat.color.setScalar(6);
  const canMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, metalness: 0.5, roughness: 0.4 });
  const lampPts = [];
  for (let i = 0; i < 4; i++) for (let k = -2; k <= 2; k++) {
    const a = i * Math.PI / 2;
    const p = new THREE.Vector3(Math.sin(a) * T + Math.cos(a) * k * 1.4, trussY - 0.25, Math.cos(a) * T - Math.sin(a) * k * 1.4);
    lampPts.push(p);
  }
  const coneMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uInt: { value: 0.022 } },
    vertexShader: `varying float vH; varying vec3 vN; varying vec3 vV;
      void main(){ vH = uv.y; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vH; varying vec3 vN; varying vec3 vV; uniform float uInt;
      void main(){ float edge = pow(abs(dot(vN, vV)), 2.0); float a = edge * pow(vH, 1.6) * uInt; gl_FragColor = vec4(vec3(1.0,0.96,0.9)*a, 1.0); }`,
  });
  const aim = new THREE.Vector3(0, 0, 0);
  lampPts.forEach((p, i) => {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.36, 14), canMat);
    can.position.copy(p); can.lookAt(aim); can.rotateX(Math.PI / 2); truss.add(can);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 18), lampMat);
    lens.position.copy(p).add(aim.clone().sub(p).normalize().multiplyScalar(0.19)); lens.lookAt(aim); truss.add(lens);
    if (i % 2 === 0) {
      const target = new THREE.Vector3(p.x * 0.25, 0, p.z * 0.25);
      const L = p.distanceTo(target);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 1.05, L, 24, 1, true), coneMat);
      cone.position.copy(p).lerp(target, 0.5);
      cone.lookAt(target); cone.rotateX(-Math.PI / 2);
      truss.add(cone);
    }
  });
  // real lights
  const hemi = new THREE.HemisphereLight(0x8090b0, 0x201812, 0.12); scene.add(hemi);
  const key = new THREE.SpotLight(0xfff3e6, 120, 16, 0.6, 0.55, 1.6);
  key.position.set(0.4, 8.5, 0.6); key.target.position.set(0, 0.6, 0);
  key.castShadow = true; key.shadow.mapSize.set(quality.shadow, quality.shadow); key.shadow.bias = -0.00015; key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 4; key.shadow.camera.far = 12; key.shadow.radius = 3;
  scene.add(key, key.target);
  const spots = [];
  for (const [x, z, c, i] of [[-4.5, -4.5, 0xffe2c8, 38], [4.5, 4.5, 0xd8e6ff, 38], [4.5, -4.5, 0xfff0e0, 28], [-4.5, 4.5, 0xe6eeff, 28]]) {
    const s = new THREE.SpotLight(c, i, 18, 0.5, 0.7, 1.5);
    s.position.set(x, 6.5, z); s.target.position.set(0, 1.1, 0); scene.add(s, s.target); spots.push(s);
  }
  // cool rim from far side + warm fill
  const rim = new THREE.DirectionalLight(0x9fb6ff, 0.35); rim.position.set(-6, 4, 8); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffd2b0, 0.15); fill.position.set(6, 3, -6); scene.add(fill);

  scene.fog = new THREE.FogExp2(0x07080b, 0.028);
  scene.background = new THREE.Color(0x050608);

  // ---------- environment map ----------
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x030305);
  const panel = new THREE.MeshBasicMaterial({ color: 0xffffff }); panel.color.setScalar(12);
  for (const p of lampPts) { const q = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), panel); q.position.copy(p); envScene.add(q); }
  const keyBall = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 12), panel); keyBall.position.set(0, 8, 0); envScene.add(keyBall);
  const crowdBand = new THREE.Mesh(new THREE.CylinderGeometry(12, 14, 6, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x1a1612, side: THREE.BackSide }));
  crowdBand.position.y = 1; envScene.add(crowdBand);
  const ringBox = new THREE.Mesh(new THREE.BoxGeometry(6, 0.1, 6), new THREE.MeshBasicMaterial({ color: 0x8a8a86 })); ringBox.position.y = -0.1; envScene.add(ringBox);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.4;

  // ---------- rope physics (visual wobble) ----------
  function ropeImpulse(pos, strength) {
    for (const r of ropes) {
      const ab = r.B.clone().sub(r.A); const t = THREE.MathUtils.clamp(pos.clone().sub(r.A).dot(ab) / ab.lengthSq(), 0, 1);
      const cp = r.A.clone().lerp(ab.add(r.A), t);
      const d = Math.hypot(cp.x - pos.x, cp.z - pos.z) + Math.abs(r.y - 1.0) * 0.4;
      if (d < 0.8) { r.v += strength * (1 - d / 0.8); r.hit = t; }
    }
  }
  update.push((dt) => {
    for (const r of ropes) {
      r.v += (-260 * r.wobble - 6 * r.v) * dt; r.wobble += r.v * dt;
      if (Math.abs(r.wobble) < 1e-4 && Math.abs(r.v) < 1e-3) { if (r.dirty) { r.geo.attributes.position.array.set(r.base); r.geo.attributes.position.needsUpdate = true; r.dirty = false; } continue; }
      const arr = r.geo.attributes.position.array, base = r.base;
      // outward normal of the rope side
      const n = new THREE.Vector3((r.A.x + r.B.x) / 2, 0, (r.A.z + r.B.z) / 2).normalize();
      const ab = r.B.clone().sub(r.A); const L2 = ab.lengthSq();
      for (let i = 0; i < arr.length; i += 3) {
        const t = THREE.MathUtils.clamp(((base[i] - r.A.x) * ab.x + (base[i + 2] - r.A.z) * ab.z) / L2, 0, 1);
        const s = Math.sin(Math.PI * t) * r.wobble;
        arr[i] = base[i] + n.x * s; arr[i + 1] = base[i + 1] - Math.abs(s) * 0.3; arr[i + 2] = base[i + 2] + n.z * s;
      }
      r.geo.attributes.position.needsUpdate = true; r.dirty = true;
    }
  });

  return {
    group: arena, key, spots, coneMat,
    update(dt, t) { for (const f of update) f(dt, t); },
    ropeImpulse,
    fadeRopes(cam, dt) {
      const N = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const op = N.map(([nx, nz]) => (cam.x * nx + cam.z * nz) > C - 0.2 ? 0.12 : 1);
      for (const r of ropes) { const m = r.mesh.material; m.opacity += (op[r.side] - m.opacity) * Math.min(1, dt * 8); m.depthWrite = m.opacity > 0.9; r.mesh.castShadow = true; }
      for (const t of ties) { const m = t.mesh.material; m.opacity += (op[t.side] - m.opacity) * Math.min(1, dt * 8); m.depthWrite = m.opacity > 0.9; }
    },
    setExcitement(v) { arena.userData.excite = v; },
  };
}

function buildCrowd(arena, update, quality) {
  // stepped stands
  const standMat = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.9 });
  const rows = quality.crowdRows;
  const P = RING.platform;
  const seats = [];
  for (let side = 0; side < 4; side++) {
    for (let r = 0; r < rows; r++) {
      const dist = 7.6 + r * 0.95, y = -P + 0.25 + r * 0.55;
      const len = dist * 2 + 0.6;
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.55, 0.95), standMat);
      const a = side * Math.PI / 2;
      step.rotation.y = a; step.position.set(Math.sin(a) * (dist + 0.3), y - 0.27, Math.cos(a) * (dist + 0.3)); arena.add(step);
      for (let k = -dist + 0.4; k < dist - 0.3; k += 0.62) {
        if (Math.random() < 0.06) continue;
        const along = k + rnd(-0.05, 0.05);
        seats.push({ x: Math.sin(a) * dist + Math.cos(a) * along, y, z: Math.cos(a) * dist - Math.sin(a) * along, a: a + Math.PI });
      }
    }
  }
  // spectator geometry: torso + head + arms (merged)
  const torso = new THREE.CapsuleGeometry(0.17, 0.32, 2, 7); torso.translate(0, 0.42, 0);
  const head = new THREE.SphereGeometry(0.105, 8, 6); head.translate(0, 0.86, 0.01);
  const armL = new THREE.CapsuleGeometry(0.05, 0.36, 1, 5); armL.translate(0.2, 0.45, 0.05);
  const armR = armL.clone(); armR.translate(-0.4, 0, 0);
  [torso, head, armL, armR].forEach(g => { g.deleteAttribute('uv'); });
  // mark vertices: 0 = torso, 1 = head(skin), 2 = arms
  const tag = (g, v) => g.setAttribute('part', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(v), 1));
  tag(torso, 0); tag(head, 1); tag(armL, 2); tag(armR, 3);
  const geo = BufferGeometryUtils.mergeGeometries([torso, head, armL, armR]);
  const mat = new THREE.MeshLambertMaterial({ color: 0x8a8a8a, emissive: 0x0d0c0b });
  const uni = { uTime: { value: 0 }, uExcite: { value: 0.2 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute float part; uniform float uTime; uniform float uExcite; varying float vPart;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vPart = part;
      float seed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898,78.233))) * 43758.5453);
      float ex = clamp(uExcite + (seed - 0.5) * 0.4, 0.0, 1.0);
      float jump = max(0.0, sin(uTime * (6.0 + seed * 4.0) + seed * 40.0)) * 0.12 * ex * step(0.55, seed + ex * 0.4);
      transformed.y += jump + sin(uTime * 1.3 + seed * 30.0) * 0.01;
      if (part > 1.5) {
        float up = smoothstep(0.35, 0.9, ex + seed * 0.3) * step(0.45, seed);
        float sgn = part > 2.5 ? -1.0 : 1.0;
        vec3 sh = vec3(sgn * 0.2, 0.6, 0.05);
        vec3 rel = transformed - sh - vec3(0.0, jump, 0.0);
        float ang = up * (2.6 + sin(uTime * 8.0 + seed * 9.0) * 0.3);
        float c = cos(ang), s = sin(ang);
        rel = vec3(rel.x, rel.y * c - rel.z * s, rel.y * s + rel.z * c);
        transformed = sh + rel + vec3(0.0, jump, 0.0);
      }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPart;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      if (vPart > 0.5 && vPart < 1.5) diffuseColor.rgb = vec3(0.55, 0.38, 0.3) * (0.6 + 0.6 * diffuseColor.r);`);
  };
  const crowd = new THREE.InstancedMesh(geo, mat, seats.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3();
  const shirt = [0x1a1a1a, 0x2b2b30, 0x6b1515, 0x1f2f55, 0xd8d8d8, 0x3a3a3a, 0x5b4632, 0x2e4b2e, 0x8a8a8a, 0x111111, 0x7a2a2a, 0x244a7a];
  const col = new THREE.Color();
  seats.forEach((st, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), st.a + rnd(-0.3, 0.3));
    const sc = rnd(0.9, 1.08); s3.set(sc, sc * rnd(0.92, 1.08), sc);
    m4.compose(new THREE.Vector3(st.x, st.y, st.z), q, s3);
    crowd.setMatrixAt(i, m4);
    col.setHex(shirt[(Math.random() * shirt.length) | 0]).multiplyScalar(rnd(0.6, 1.1));
    crowd.setColorAt(i, col);
  });
  arena.add(crowd);
  // camera flashes
  const nF = Math.min(400, seats.length);
  const fpos = new Float32Array(nF * 3), fph = new Float32Array(nF);
  for (let i = 0; i < nF; i++) { const st = seats[(Math.random() * seats.length) | 0]; fpos.set([st.x, st.y + 0.9, st.z], i * 3); fph[i] = Math.random() * 100; }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3)); fg.setAttribute('phase', new THREE.BufferAttribute(fph, 1));
  const fmat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: uni,
    vertexShader: `attribute float phase; uniform float uTime; uniform float uExcite; varying float vA;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); float r = 0.08 + uExcite * 0.6;
        float t = fract(uTime * (0.05 + 0.25 * uExcite) + phase); vA = smoothstep(0.0, 0.004, t) * (1.0 - smoothstep(0.004, 0.02, t)) * step(fract(phase*7.13), r + 0.1);
        gl_PointSize = 140.0 / -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); float a = vA * smoothstep(0.5, 0.0, d); a += vA * 0.6 * (smoothstep(0.03,0.0,abs(c.x))+smoothstep(0.03,0.0,abs(c.y))) * smoothstep(0.5,0.1,d); gl_FragColor = vec4(vec3(1.0,0.97,0.92)*a*3.0, 1.0); }`,
  });
  const flashes = new THREE.Points(fg, fmat); flashes.frustumCulled = false; arena.add(flashes);
  update.push((dt, t) => { uni.uTime.value = t; const ex = arena.userData.excite ?? 0.2; uni.uExcite.value += (ex - uni.uExcite.value) * Math.min(1, dt * 2); });
}
