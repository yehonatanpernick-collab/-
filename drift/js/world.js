import * as THREE from 'three';

export const TIMES = {
  sunset: {
    name: 'שקיעה', sunDir: [-0.55, 0.2, -0.62], sun: 0xffa060, sunI: 3.4,
    sky: { top: 0x2b4f8c, mid: 0xf0a070, hor: 0xffc78a, bot: 0x3a2a2a, sunCol: 0xffd0a0, stars: 0, clouds: 0.55, cloudCol: 0xffb48a },
    hemiSky: 0x9fb7ff, hemiGround: 0x6a4a35, hemiI: 1.0, fog: 0xd9a585, fogD: 0.0019, exposure: 1.0,
    bloom: [0.35, 0.5, 0.88], night: 0, smokeLight: 0xffe2c8, envI: 1.0,
  },
  day: {
    name: 'צהריים', sunDir: [0.35, 0.85, -0.3], sun: 0xfff3e0, sunI: 3.2,
    sky: { top: 0x2f6fd0, mid: 0x8fbcf0, hor: 0xd8e8f8, bot: 0x48505a, sunCol: 0xffffff, stars: 0, clouds: 0.5, cloudCol: 0xffffff },
    hemiSky: 0xbfd8ff, hemiGround: 0x5a5448, hemiI: 1.2, fog: 0xc0d4ea, fogD: 0.0014, exposure: 0.95,
    bloom: [0.18, 0.4, 0.95], night: 0, smokeLight: 0xffffff, envI: 1.0,
  },
  night: {
    name: 'לילה', sunDir: [0.3, 0.75, 0.25], sun: 0x8fa2ff, sunI: 0.7,
    sky: { top: 0x020511, mid: 0x0a1430, hor: 0x2a2648, bot: 0x05060a, sunCol: 0xdfe6ff, stars: 1, clouds: 0.35, cloudCol: 0x3a3a60 },
    hemiSky: 0x4a64a8, hemiGround: 0x2a2018, hemiI: 1.1, fog: 0x1a2040, fogD: 0.0032, exposure: 1.45,
    bloom: [0.5, 0.4, 0.82], night: 1, smokeLight: 0x9aa4c8, envI: 0.6,
  },
};

const skyVert = `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix*vec4(position,0.0)).xyz); vec4 p = projectionMatrix*viewMatrix*vec4((modelMatrix*vec4(position,1.0)).xyz,1.0); gl_Position = p.xyww; }`;
const skyFrag = `
uniform vec3 top, mid, hor, bot, sunCol, cloudCol, sunDir; uniform float stars, clouds, time;
varying vec3 vDir;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5;} return s; }
void main(){
  vec3 d = normalize(vDir); float y = d.y;
  vec3 c = y>0.0 ? mix(hor, mid, smoothstep(0.0,0.18,y)) : mix(hor, bot, smoothstep(0.0,-0.12,y));
  c = y>0.18 ? mix(mid, top, smoothstep(0.18,0.75,y)) : c;
  float sd = max(dot(d, normalize(sunDir)), 0.0);
  c += sunCol * (pow(sd, 900.0)*30.0 + pow(sd, 40.0)*0.35 + pow(sd,6.0)*0.12) * (1.0 - stars*0.75);
  if (y > 0.0) {
    vec2 uv = d.xz / (y + 0.12) * 1.6;
    float cl = fbm(uv + vec2(time*0.004, 0.0));
    cl = smoothstep(0.52 - clouds*0.25, 0.95, cl) * smoothstep(0.0, 0.25, y);
    vec3 cc = cloudCol * (0.75 + 0.5*pow(sd,4.0));
    c = mix(c, cc, cl*0.75);
    if (stars > 0.0) {
      vec2 sp = d.xz / (y+0.3) * 220.0;
      float st = step(0.9975, h(floor(sp))) * smoothstep(0.05,0.3,y) * (1.0-cl);
      c += vec3(st) * stars * (0.6 + 0.4*sin(time*3.0 + h(floor(sp))*40.0));
    }
  }
  gl_FragColor = vec4(c, 1.0);
}`;

export class World {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    const sc = this.sun.shadow.camera; sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 400;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xffffff, 0.002);

    this.skyUni = {
      top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, bot: { value: new THREE.Color() },
      sunCol: { value: new THREE.Color() }, cloudCol: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() },
      stars: { value: 0 }, clouds: { value: 0.5 }, time: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({ uniforms: this.skyUni, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.sky.onBeforeRender = (r, s, cam) => this.sky.position.copy(cam.position);
    scene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.nightMats = []; this.signMats = [];
  }

  setShadowQuality(size) {
    this.sun.castShadow = size > 0;
    if (size > 0) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  // --------------------------------------------------------------- city
  setupCity(gltf) {
    const city = gltf.scene;
    city.scale.setScalar(100);
    city.updateMatrixWorld(true);
    city.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material, n = m.name || '';
      o.receiveShadow = true;
      o.castShadow = !/road|asphalt|ground_texture|sidewalk|cobble|curb|markings|graffiti|lines|signs?_glow/.test(n);
      if (m.map) { m.map.anisotropy = 8; }
      m.envMapIntensity = 0.55;
      m.roughness = 0.85;
      if (/alphathresh|props_lines/.test(n)) { m.transparent = false; m.alphaTest = 0.45; m.depthWrite = true; }
      if (/overlay_alpha|markings|graffiti/.test(n)) {
        m.transparent = true; m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
        o.renderOrder = 1; o.castShadow = false;
      }
      if (/asphalt|roadDirt|roadside_road|warehouse_road/.test(n)) {
        m.roughness = 0.62; m.envMapIntensity = 0.9;
        this.roadMats = this.roadMats || []; this.roadMats.push(m);
      }
      if (/sign_?s?_glow/.test(n)) { this.signMats.push(m); }
    });
    this.scene.add(city);
    this.city = city;
  }

  // --------------------------------------------------------------- procedural surroundings
  buildSurroundings(fill, route) {
    // terrain under/around the track (fills the void with a dark urban ground)
    const { C, CW, CH, X0, Z0, ter } = fill;
    const g = new THREE.PlaneGeometry((CW - 1) * C, (CH - 1) * C, CW - 1, CH - 1);
    g.rotateX(-Math.PI / 2);
    const pa = g.attributes.position;
    for (let iz = 0; iz < CH; iz++) for (let ix = 0; ix < CW; ix++) {
      const i = iz * CW + ix;
      pa.setXYZ(i, X0 + ix * C, ter[i], Z0 + iz * C);
    }
    g.computeVertexNormals();
    const gc = document.createElement('canvas'); gc.width = gc.height = 256;
    const gx = gc.getContext('2d'); gx.fillStyle = '#4a4a48'; gx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) { const v = 40 + Math.random() * 60 | 0; gx.fillStyle = `rgba(${v},${v},${v - 4},0.35)`; gx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    gx.strokeStyle = 'rgba(20,20,20,0.35)'; gx.lineWidth = 2; gx.strokeRect(0, 0, 256, 256);
    const gt = new THREE.CanvasTexture(gc); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.colorSpace = THREE.SRGBColorSpace; gt.anisotropy = 8;
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i) / 8, pa.getZ(i) / 8);
    const terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: gt, roughness: 0.95, color: 0x8a8580 }));
    terrain.receiveShadow = true;
    this.scene.add(terrain);

    // skyline: instanced boxes with procedural facade (windows lit at night)
    const fc = document.createElement('canvas'); fc.width = 256; fc.height = 256;
    const ec = document.createElement('canvas'); ec.width = 256; ec.height = 256;
    const f = fc.getContext('2d'), e = ec.getContext('2d');
    f.fillStyle = '#9a948c'; f.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) { f.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; f.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
    e.fillStyle = '#000'; e.fillRect(0, 0, 256, 256);
    const cols = 8, rows = 8;
    for (let r = 0; r < rows; r++) {
      f.fillStyle = 'rgba(60,55,50,0.35)'; f.fillRect(0, r * 32 + 28, 256, 4);
      for (let c = 0; c < cols; c++) {
        const x = c * 32 + 7, y = r * 32 + 6, w = 18, h = 18;
        const lit = Math.random();
        f.fillStyle = lit > 0.5 ? '#1c2630' : '#26303a'; f.fillRect(x, y, w, h);
        f.fillStyle = 'rgba(255,255,255,0.08)'; f.fillRect(x, y, w, 3);
        if (lit > 0.58) { const warm = Math.random() > 0.3; e.fillStyle = warm ? `rgb(255,${180 + Math.random() * 50 | 0},${100 + Math.random() * 60 | 0})` : 'rgb(170,210,255)'; e.globalAlpha = 0.5 + Math.random() * 0.5; e.fillRect(x, y, w, h); e.globalAlpha = 1; }
      }
    }
    const ft = new THREE.CanvasTexture(fc), et = new THREE.CanvasTexture(ec);
    for (const t of [ft, et]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
    const bm = new THREE.MeshStandardMaterial({ map: ft, emissiveMap: et, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.8, metalness: 0.05 });
    bm.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        float seed = fract(float(gl_InstanceID) * 0.61803);
        vec2 fuv = abs(normal.y) > 0.5 ? vec2(0.01, 0.99) : vec2((position.x*sc.x + position.z*sc.z) / 24.0 + seed*7.0, position.y * sc.y / 24.0 + floor(seed*13.0)/8.0);
        vMapUv = fuv; vEmissiveMapUv = fuv;`);
    };
    this.buildingMat = bm;
    const bg = new THREE.BoxGeometry(1, 1, 1); bg.translate(0, 0.5, 0);
    const list = fill.bld;
    const inst = new THREE.InstancedMesh(bg, bm, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const tints = [0xb8b0a4, 0xa08870, 0x8c8c94, 0xc4bcb0, 0x907060, 0x7a8290, 0xb0a490];
    list.forEach((b, i) => {
      const [x, z, w, d, h, rot, base, seed] = b;
      p.set(x, base, z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot); s.set(w, h + 2, d);
      m4.compose(p, q, s); inst.setMatrixAt(i, m4);
      col.setHex(tints[seed % tints.length]); inst.setColorAt(i, col);
    });
    inst.castShadow = false; inst.receiveShadow = true;
    this.scene.add(inst);
    this.skyline = inst;

    // night street-light pools along the route
    const pc = document.createElement('canvas'); pc.width = pc.height = 128;
    const px = pc.getContext('2d');
    const pg = px.createRadialGradient(64, 64, 0, 64, 64, 64);
    pg.addColorStop(0, 'rgba(255,200,130,0.55)'); pg.addColorStop(0.4, 'rgba(255,170,90,0.22)'); pg.addColorStop(1, 'rgba(255,150,60,0)');
    px.fillStyle = pg; px.fillRect(0, 0, 128, 128);
    const poolTex = new THREE.CanvasTexture(pc); poolTex.colorSpace = THREE.SRGBColorSpace;
    const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true });
    const glowMat = new THREE.SpriteMaterial({ map: poolTex, color: 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.pools = new THREE.Group(); this.pools.visible = false;
    const poolGeo = new THREE.PlaneGeometry(16, 16); poolGeo.rotateX(-Math.PI / 2);
    const lampGeo = new THREE.CylinderGeometry(0.09, 0.13, 8, 6); lampGeo.translate(0, 4, 0);
    const armGeo = new THREE.BoxGeometry(0.1, 0.1, 2.2);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.6, roughness: 0.5 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd9a0, emissiveIntensity: 0 });
    this.lampHeadMat = headMat;
    const lamps = new THREE.Group();
    for (let i = 6, side = 1; i < route.length - 6; i += 9, side = -side) {
      const [x, z, y, rd] = route[i];
      const [x2, z2] = route[i + 1];
      let dx = x2 - x, dz = z2 - z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz * side, nz = dx * side;
      const off = Math.max(3, rd + 1.1);
      const lx = x + nx * off, lz = z + nz * off;
      const pool = new THREE.Mesh(poolGeo, poolMat); pool.position.set(x + nx * off * 0.55, y + 0.06, z + nz * off * 0.55);
      this.pools.add(pool);
      const sp = new THREE.Sprite(glowMat); sp.scale.set(2.2, 2.2, 1); sp.position.set(lx - nx * 1.9, y + 7.9, lz - nz * 1.9); this.pools.add(sp);
      const pole = new THREE.Mesh(lampGeo, lampMat); pole.position.set(lx, y, lz); pole.castShadow = true;
      const arm = new THREE.Mesh(armGeo, lampMat); arm.position.set(lx - nx * 1.0, y + 8, lz - nz * 1.0); arm.lookAt(lx - nx * 3, y + 8, lz - nz * 3);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.8), headMat); head.position.set(lx - nx * 1.9, y + 7.92, lz - nz * 1.9); head.rotation.y = Math.atan2(nx, nz);
      lamps.add(pole, arm, head);
      this.lampPositions = this.lampPositions || []; this.lampPositions.push([lx, lz]);
    }
    this.scene.add(lamps, this.pools);
  }

  // procedural steel jump ramp (dock -> unfinished bridge). Same shape is baked into the physics grid.
  buildRamp(r) {
    const segs = 24, L = r.len;
    const h = s => { const t = Math.min(1, (s + L) / L); return r.y1 * t * (0.7 + 0.3 * t); };
    const W = s => { const t = Math.min(1, Math.max(0, (s + L) / L)); return r.hw + (r.flare || 0) * (1 - t) * (1 - t) - 0.2; };
    const hw = r.hw - 0.2;
    const d = new THREE.Vector2(r.dx, r.dz), n = new THREE.Vector2(-r.dz, r.dx); // n = lateral
    const P = (s, l, y) => new THREE.Vector3(r.x + d.x * s + n.x * l, y, r.z + d.y * s + n.y * l);
    const top = [], side = [], uvTop = [], uvSide = [];
    for (let i = 0; i < segs; i++) {
      const s0 = -L + L * i / segs, s1 = -L + L * (i + 1) / segs;
      const w0 = W(s0), w1 = W(s1);
      const a = P(s0, -w0, h(s0) + 0.02), b = P(s0, w0, h(s0) + 0.02), c = P(s1, -w1, h(s1) + 0.02), e = P(s1, w1, h(s1) + 0.02);
      top.push(a, c, b, b, c, e);
      const v0 = s0 / 3, v1 = s1 / 3;
      uvTop.push(-w0 / 3, v0, -w1 / 3, v1, w0 / 3, v0, w0 / 3, v0, -w1 / 3, v1, w1 / 3, v1);
      for (const sg of [-1, 1]) {
        const l = sg;
        const p0 = P(s0, sg * w0, h(s0) + 0.02), p1 = P(s1, sg * w1, h(s1) + 0.02), q0 = P(s0, sg * w0, 0), q1 = P(s1, sg * w1, 0);
        if (l < 0) side.push(p0, q0, p1, p1, q0, q1); else side.push(p0, p1, q0, p1, q1, q0);
        const u0 = s0 / 2, u1 = s1 / 2;
        if (l < 0) uvSide.push(u0, 1, u0, 0, u1, 1, u1, 1, u0, 0, u1, 0); else uvSide.push(u0, 1, u1, 1, u0, 0, u1, 1, u1, 0, u0, 0);
      }
    }
    const geo = (pts, uv) => { const g = new THREE.BufferGeometry().setFromPoints(pts); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g; };
    // diamond plate texture
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    x.fillStyle = '#5c6066'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.save(); x.translate(i * 16 + (j % 2) * 8 + 4, j * 16 + 8); x.rotate((j % 2 ? 1 : -1) * 0.7); x.fillStyle = '#8a8f96'; x.fillRect(-5, -1.5, 10, 3); x.restore(); }
    const plate = new THREE.CanvasTexture(c); plate.wrapS = plate.wrapT = THREE.RepeatWrapping; plate.colorSpace = THREE.SRGBColorSpace; plate.anisotropy = 8;
    const sc = document.createElement('canvas'); sc.width = 256; sc.height = 64; const sx = sc.getContext('2d');
    sx.fillStyle = '#1a1a1a'; sx.fillRect(0, 0, 256, 64);
    for (let i = -2; i < 10; i++) { sx.fillStyle = '#f2b300'; sx.beginPath(); sx.moveTo(i * 32, 0); sx.lineTo(i * 32 + 16, 0); sx.lineTo(i * 32 + 48, 64); sx.lineTo(i * 32 + 32, 64); sx.fill(); }
    const stripe = new THREE.CanvasTexture(sc); stripe.wrapS = THREE.RepeatWrapping; stripe.colorSpace = THREE.SRGBColorSpace;
    const topM = new THREE.Mesh(geo(top, uvTop), new THREE.MeshStandardMaterial({ map: plate, metalness: 0.7, roughness: 0.45 }));
    const sideM = new THREE.Mesh(geo(side, uvSide), new THREE.MeshStandardMaterial({ map: stripe, metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide }));
    topM.receiveShadow = true; topM.castShadow = true; sideM.castShadow = true; sideM.receiveShadow = true;
    this.scene.add(topM, sideM);
    // guard rails with lights
    const railM = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.8, roughness: 0.3 });
    const lampM = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff7a00, emissiveIntensity: 2.5 });
    this.rampLamp = lampM;
    for (const sg of [-1, 1]) for (let i = 8; i <= segs; i += 2) {
      const s = -L + L * i / segs;
      const p = P(s, sg * (W(s) - 0.1), h(s));
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), railM); post.position.copy(p).y += 0.45; this.scene.add(post);
      if (i % 4 === 0) { const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), lampM); lamp.position.copy(p).y += 0.95; this.scene.add(lamp); }
    }
    for (const sg of [-1, 1]) {
      const pts = []; for (let i = 8; i <= segs; i++) { const s = -L + L * i / segs; pts.push(P(s, sg * (W(s) - 0.1), h(s) + 0.88)); }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.04, 6), railM); this.scene.add(tube);
    }
    // support trusses
    const beamM = new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.6, roughness: 0.5 });
    for (let i = 6; i <= segs; i += 4) {
      const s = -L + L * i / segs, y = h(s);
      for (const l of [-hw + 0.6, 0, hw - 0.6]) { const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, y, 0.3), beamM); col.position.copy(P(s, l, y / 2)); col.castShadow = true; this.scene.add(col); }
    }
    // big arrow sign on the bridge lip so players know to go for it
    const ac = document.createElement('canvas'); ac.width = 256; ac.height = 128; const ax = ac.getContext('2d');
    ax.fillStyle = '#111'; ax.fillRect(0, 0, 256, 128); ax.fillStyle = '#ffb300'; ax.font = 'bold 54px Rubik, Arial'; ax.textAlign = 'center'; ax.textBaseline = 'middle'; ax.fillText('JUMP ▲', 128, 66);
    const at = new THREE.CanvasTexture(ac); at.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshStandardMaterial({ map: at, emissiveMap: at, emissive: 0xffffff, emissiveIntensity: 0.8 }));
    const sp = P(-L - 2, -(W(-L) + 1.5), 3.2); sign.position.copy(sp); sign.lookAt(P(-L - 30, -(W(-L) + 1.5), 3.2)); this.scene.add(sign);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 0.15), beamM); pole.position.copy(sp).y = 1.6; this.scene.add(pole);
  }

  // --------------------------------------------------------------- time of day
  setTime(key) {
    const T = TIMES[key]; this.time = key; this.T = T;
    this.sunDir = new THREE.Vector3(...T.sunDir).normalize();
    this.sun.color.setHex(T.sun); this.sun.intensity = T.sunI;
    this.hemi.color.setHex(T.hemiSky); this.hemi.groundColor.setHex(T.hemiGround); this.hemi.intensity = T.hemiI;
    this.scene.fog.color.setHex(T.fog); this.scene.fog.density = T.fogD;
    const u = this.skyUni;
    u.top.value.setHex(T.sky.top); u.mid.value.setHex(T.sky.mid); u.hor.value.setHex(T.sky.hor); u.bot.value.setHex(T.sky.bot);
    u.sunCol.value.setHex(T.sky.sunCol); u.cloudCol.value.setHex(T.sky.cloudCol); u.stars.value = T.sky.stars; u.clouds.value = T.sky.clouds;
    u.sunDir.value.copy(this.sunDir);
    this.renderer.toneMappingExposure = T.exposure;
    if (this.buildingMat) this.buildingMat.emissiveIntensity = T.night ? 0.75 : 0;
    if (this.lampHeadMat) this.lampHeadMat.emissiveIntensity = T.night ? 3 : 0;
    if (this.pools) this.pools.visible = !!T.night;
    for (const m of this.signMats) m.emissiveIntensity = T.night ? 2.2 : 0.6;
    if (this.city) this.city.traverse(o => { if (o.isMesh && !this.signMats.includes(o.material)) o.material.envMapIntensity = T.night ? 0.35 : 0.55; });
    for (const m of this.roadMats || []) { m.envMapIntensity = T.night ? 0.8 : 0.9; m.roughness = T.night ? 0.45 : 0.62; }

    // environment map from the sky (+ a few bright panels for crisp paint reflections)
    const envScene = new THREE.Scene();
    const skyCopy = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.sky.material);
    envScene.add(skyCopy);
    const panel = new THREE.MeshBasicMaterial({ color: T.night ? 0xffc890 : 0xffffff, side: THREE.DoubleSide });
    const pI = T.night ? 3 : 1.4;
    panel.color.multiplyScalar(pI);
    for (let i = 0; i < 6; i++) {
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(14, 3), panel);
      const a = i / 6 * Math.PI * 2;
      pm.position.set(Math.cos(a) * 30, 18 + (i % 2) * 6, Math.sin(a) * 30); pm.lookAt(0, 0, 0);
      envScene.add(pm);
    }
    const groundM = new THREE.Mesh(new THREE.CircleGeometry(48, 24), new THREE.MeshBasicMaterial({ color: T.night ? 0x050608 : 0x2a2826 }));
    groundM.rotation.x = -Math.PI / 2; groundM.position.y = -2; envScene.add(groundM);
    const rt = this.pmrem.fromScene(envScene, 0.02);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = T.envI;
  }

  update(dt, focus) {
    this.skyUni.time.value += dt;
    // shadow camera follows the car, snapped to texels to avoid shimmering
    const d = this.sunDir;
    const size = this.sun.shadow.mapSize.x || 1024;
    const texel = 110 / size;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + d.x * 150, focus.y + d.y * 150, fz + d.z * 150);
    this.sun.target.updateMatrixWorld();
  }
}

// ------------------------------------------------------------------ gates & cones (procedural models)
export function makeGate(width, finish = false, start = false) {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.7, roughness: 0.35 });
  const neon = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: finish ? 0xff3060 : start ? 0x40ff90 : 0x30d0ff, emissiveIntensity: 3.2 });
  const h = 6.2, pw = 0.5;
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(pw, h, pw), frameMat); p.position.set(s * width / 2, h / 2, 0); p.castShadow = true; g.add(p);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, h - 0.4, 0.55), neon); strip.position.set(s * (width / 2 - pw / 2 - 0.02), h / 2, 0); g.add(strip);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(width + pw, 1.3, 0.6), frameMat); beam.position.y = h; beam.castShadow = true; g.add(beam);
  // banner
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const x = c.getContext('2d');
  if (finish) { for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#fff' : '#111'; x.fillRect(i * 16, j * 16, 16, 16); } }
  else { x.fillStyle = '#0b0d12'; x.fillRect(0, 0, 512, 64); x.fillStyle = start ? '#5dff9e' : '#58d8ff'; x.font = 'bold 44px Rubik, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(start ? 'START  •  זינוק' : 'CHECKPOINT  •  נקודת ביקורת', 256, 34); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const bannerMat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: finish ? 0.4 : 1.2 });
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.92, 1.05), bannerMat); b.position.set(0, h, s * 0.31); if (s < 0) b.rotation.y = Math.PI; g.add(b); }
  const top = new THREE.Mesh(new THREE.BoxGeometry(width + pw, 0.1, 0.65), neon); top.position.y = h - 0.7; g.add(top);
  // ground line
  const line = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.6), new THREE.MeshBasicMaterial({ color: finish ? 0xff3060 : 0x30d0ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  line.rotation.x = -Math.PI / 2; line.position.y = 0.05; g.add(line);
  g.userData.neon = neon;
  return g;
}

export class Cones {
  constructor(scene, grid) {
    this.grid = grid;
    const pts = [];
    pts.push(new THREE.Vector2(0.001, 0.04), new THREE.Vector2(0.22, 0.04), new THREE.Vector2(0.22, 0.0), new THREE.Vector2(0.17, 0.0));
    const prof = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.26, 0), new THREE.Vector2(0.26, 0.05), new THREE.Vector2(0.15, 0.05), new THREE.Vector2(0.03, 0.72), new THREE.Vector2(0.001, 0.72)];
    const g = new THREE.LatheGeometry(prof, 14);
    const colors = []; const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); const white = (y > 0.3 && y < 0.42) || (y > 0.52 && y < 0.6); colors.push(...(white ? [0.95, 0.95, 0.95] : y < 0.06 ? [0.05, 0.05, 0.05] : [1, 0.25, 0.02])); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissive: 0xff3a00, emissiveIntensity: 0 });
    this.mat = m;
    this.max = 160;
    this.mesh = new THREE.InstancedMesh(g, m, this.max);
    this.mesh.castShadow = true; this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.c = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(1, 1, 1); this._p = new THREE.Vector3();
  }
  place(list) {
    this.c = list.slice(0, this.max).map(([x, z]) => ({ x, z, ox: x, oz: z, y: this.grid.height(x, z), vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, ry: Math.random() * 6, wx: 0, wz: 0, hit: false, rest: true }));
    this.mesh.count = this.c.length; this.dirty = true; this.update(0);
  }
  reset() { for (const c of this.c) { c.x = c.ox; c.z = c.oz; c.y = this.grid.height(c.x, c.z); c.vx = c.vy = c.vz = 0; c.rx = c.rz = 0; c.wx = c.wz = 0; c.hit = false; c.rest = true; } this.dirty = true; this.update(0); }
  // returns number of newly hit cones
  collide(car, info) {
    let hits = 0;
    const ch = Math.cos(car.heading), sh = Math.sin(car.heading);
    for (const c of this.c) {
      const dx = c.x - car.pos.x, dz = c.z - car.pos.z;
      if (dx * dx + dz * dz > 16) continue;
      // to car local
      const lz = dx * sh + dz * ch, lx = dx * ch - dz * sh;
      if (lz < info.rear - 0.25 || lz > info.front + 0.25 || Math.abs(lx) > info.halfWidth + 0.25) continue;
      const sp = car.speed;
      const ox = car.vel.x + (car.yawRate * dz), oz = car.vel.y - (car.yawRate * dx);
      c.vx = ox * 1.15 + (Math.random() - 0.5) * 2; c.vz = oz * 1.15 + (Math.random() - 0.5) * 2; c.vy = 2 + sp * 0.18;
      c.wx = (Math.random() - 0.5) * 18; c.wz = (Math.random() - 0.5) * 18;
      c.rest = false;
      if (!c.hit) { c.hit = true; hits++; }
    }
    return hits;
  }
  update(dt) {
    let any = this.dirty;
    for (const c of this.c) {
      if (c.rest) continue;
      any = true;
      c.vy -= 9.81 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      c.rx += c.wx * dt; c.rz += c.wz * dt;
      const gy = this.grid.height(c.x, c.z);
      if (this.grid.sdf(c.x, c.z) < 0) { c.vx *= -0.3; c.vz *= -0.3; c.x += c.vx * dt * 2; c.z += c.vz * dt * 2; }
      if (c.y < gy) {
        c.y = gy; c.vy = -c.vy * 0.3; c.vx *= 0.7; c.vz *= 0.7; c.wx *= 0.6; c.wz *= 0.6;
        // settle on side
        if (Math.hypot(c.vx, c.vz) < 0.4 && Math.abs(c.vy) < 0.5) { c.rest = true; c.rx = Math.round(c.rx / (Math.PI / 2)) * Math.PI / 2 || Math.PI / 2; c.rz = 0; c.y = gy + 0.2; }
      }
    }
    if (!any) return;
    this.c.forEach((c, i) => {
      this._p.set(c.x, c.y, c.z); this._e.set(c.rx, c.ry, c.rz); this._q.setFromEuler(this._e);
      this._m.compose(this._p, this._q, this._s); this.mesh.setMatrixAt(i, this._m);
    });
    this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false;
  }
}
