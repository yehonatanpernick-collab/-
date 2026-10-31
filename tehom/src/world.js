import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import * as G from './glsl.js';
import { BODY_DEFS, PAL, STAR, BELT, FACTIONS } from './data.js';

export const LOWQ = typeof location !== "undefined" && /lowq/.test(location.search);
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const pr = LOWQ ? 0.6 : Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.5, 30000);

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: LOWQ ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.72, 0.3, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(size.x, size.y) }, uFlash: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: G.GRADE_FRAG,
  });
  composer.addPass(grade);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    grade.uniforms.uRes.value.set(s.x, s.y);
  }
  window.addEventListener('resize', resize);
  return { renderer, scene, camera, composer, bloom, grade, pixelRatio: pr };
}

// ---------------------------------------------------------------- sky
export function buildSky(renderer, scene) {
  const cubeRT = new THREE.WebGLCubeRenderTarget(LOWQ ? 128 : 1024, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const skyScene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), new THREE.ShaderMaterial({
    vertexShader: G.SKY_VERT, fragmentShader: G.SKY_FRAG, side: THREE.BackSide, depthWrite: false,
  }));
  skyScene.add(sky);
  const cubeCam = new THREE.CubeCamera(1, 1000, cubeRT);
  cubeCam.update(renderer, skyScene);
  scene.background = cubeRT.texture;
  scene.backgroundIntensity = 1.0;

  const pmrem = new THREE.PMREMGenerator(renderer);
  // brighter variant for reflections so hulls pick up the sky
  sky.material.dispose();
  scene.environment = pmrem.fromCubemap(cubeRT.texture).texture;
  scene.environmentIntensity = 2.2;
  pmrem.dispose();

  // point stars, denser along the galactic plane
  const N = 9000;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
  const gN = new THREE.Vector3(0.25, 1, 0.35).normalize();
  const v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    for (;;) {
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      const l = v.length(); if (l > 1 || l < 0.01) continue;
      v.divideScalar(l);
      const g = v.dot(gN);
      if (Math.random() < 0.35 + 0.65 * Math.exp(-g * g * 14)) break;
    }
    v.multiplyScalar(12000);
    pos.set([v.x, v.y, v.z], i * 3);
    const t = Math.random();
    // temperature: mostly white, some warm, few blue
    if (t < 0.12) c.setRGB(1.0, 0.72, 0.5); else if (t < 0.2) c.setRGB(0.68, 0.8, 1.0); else c.setRGB(1, 0.96, 0.9);
    const m = Math.pow(Math.random(), 7);
    const b = 0.12 + m * 1.1;
    col.set([c.r * b, c.g * b, c.b * b], i * 3);
    size[i] = 1.2 + m * 2.6;
    ph[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() } },
    vertexShader: G.STARS_VERT, fragmentShader: G.STARS_FRAG,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const stars = new THREE.Points(geo, mat);
  stars.frustumCulled = false;
  stars.renderOrder = -10;
  scene.add(stars);
  return { stars, update(t, camPos) { mat.uniforms.uTime.value = t; stars.position.copy(camPos); } };
}

// ---------------------------------------------------------------- star
export function buildStar(scene) {
  const g = new THREE.Group();
  const starMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uGain: { value: 4 } }, vertexShader: G.PLANET_VERT, fragmentShader: G.STAR_FRAG });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(STAR.r, 96, 64), starMat);
  g.add(sphere);
  const coronaMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uR: { value: STAR.r / 260 }, uGain: { value: 1 } },
    vertexShader: G.CORONA_VERT, fragmentShader: G.CORONA_FRAG,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), coronaMat);
  g.add(corona);
  scene.add(g);

  const sun = new THREE.PointLight(0xfff0dc, 3.2, 0, 0);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x1a2230, 0.6));
  return {
    group: g, sphere,
    update(t, camera) {
      starMat.uniforms.uTime.value = t; coronaMat.uniforms.uTime.value = t;
      // a star that fills the frame must not flood the bloom
      const d = camera.position.length();
      const k = THREE.MathUtils.smoothstep(d, 110, 650);
      starMat.uniforms.uGain.value = 1.05 + 2.9 * k;
      coronaMat.uniforms.uGain.value = 0.25 + 0.75 * k;
      corona.quaternion.copy(camera.quaternion);
      sphere.rotation.y = t * 0.01;
    },
  };
}

// ---------------------------------------------------------------- bodies
export class Body {
  constructor(def, idx) {
    Object.assign(this, def);
    this.idx = idx;
    this.pos = new THREE.Vector3();
    this.owner = def.home || 'neutral';
    this.control = 100;
    this.capBy = null;
    this.structures = { yard: def.home ? 1 : 0, mine: 0, battery: def.home ? 1 : 0 };
    this.building = null;        // { id, t }
    this.queue = [];             // [{cls, t}]
    this.batteryCd = 0;
    this.native = def.garrison || (def.home ? 0 : 1);
    this.captureR = def.r * 2.2 + 24;
    this.orbitSlot = def.r + 7;
    this.parentBody = null;
    this.omega = (def.parent ? 0.045 : 0.0115 * Math.pow(100 / def.orbit, 1.5));
    this.angle = THREE.MathUtils.degToRad(def.phase);
    const inc = THREE.MathUtils.degToRad(def.incl);
    const node = def.idx * 0.9 + (def.parent ? 1.2 : 0.4);
    this.plane = new THREE.Quaternion().setFromEuler(new THREE.Euler(inc, node, 0, 'YXZ'));
    this.underAttack = 0;
  }
  localPos(angle, out) {
    out.set(Math.cos(angle) * this.orbit, 0, Math.sin(angle) * this.orbit).applyQuaternion(this.plane);
    return out;
  }
  get productionRate() { return this.prod * (this.structures.mine ? 1.6 : 1); }
}

export function buildBodies(scene) {
  const bodies = BODY_DEFS.map((d, i) => new Body({ ...d, idx: i }, i));
  const byKey = Object.fromEntries(bodies.map((b) => [b.key, b]));
  for (const b of bodies) if (b.parent) b.parentBody = byKey[b.parent];

  const sphereHi = new THREE.SphereGeometry(1, 96, 64);
  const sphereLo = new THREE.SphereGeometry(1, 64, 40);

  for (const b of bodies) {
    const pal = PAL[b.pal];
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uType: { value: b.type }, uSeed: { value: b.idx * 3.17 + 1.3 }, uTime: { value: 0 },
        uA: { value: pal[0] }, uB: { value: pal[1] }, uC: { value: pal[2] }, uD: { value: pal[3] },
        uAtmo: { value: new THREE.Color(b.atmo).multiplyScalar(0.55) },
        uCity: { value: FACTIONS.neutral.color.clone() }, uCityAmt: { value: 0.2 },
        uSea: { value: b.sea ?? 0.0 }, uCloud: { value: b.cloud },
      },
      vertexShader: G.PLANET_VERT, fragmentShader: G.PLANET_FRAG,
    });
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(b.r > 6 ? sphereHi : sphereLo, mat);
    mesh.scale.setScalar(b.r);
    mesh.rotation.z = THREE.MathUtils.degToRad(12 + b.idx * 5 % 20);
    g.add(mesh);
    if (b.type !== 3 || true) {
      const atmo = new THREE.Mesh(sphereLo, new THREE.ShaderMaterial({
        uniforms: { uAtmo: { value: new THREE.Color(b.atmo) }, uPow: { value: b.type === 4 ? 2.2 : 3.0 } },
        vertexShader: G.PLANET_VERT, fragmentShader: G.ATMO_FRAG,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.BackSide,
      }));
      atmo.scale.setScalar(b.r * (b.type === 4 ? 1.06 : 1.12));
      g.add(atmo);
    }
    if (b.rings) {
      const ri = b.r * 1.45, ro = b.r * 2.5;
      const ring = new THREE.Mesh(new THREE.RingGeometry(ri, ro, 160, 1), new THREE.ShaderMaterial({
        uniforms: { uIn: { value: ri }, uOut: { value: ro }, uCol: { value: new THREE.Color(b.rings) }, uPlanet: { value: b.pos }, uPR: { value: b.r } },
        vertexShader: G.RING_VERT, fragmentShader: G.RING_FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      ring.rotation.x = -Math.PI / 2 + 0.38;
      ring.rotation.y = 0.15;
      g.add(ring);
    }
    scene.add(g);
    b.group = g; b.mesh = mesh; b.mat = mat;

    // orbit path
    const center = b.parentBody ? b.parentBody.pos : null;
    const N = 512, pts = new Float32Array(N * 3), ts = new Float32Array(N);
    const v = new THREE.Vector3();
    for (let i = 0; i < N; i++) { b.localPos((i / N) * Math.PI * 2, v); pts.set([v.x, v.y, v.z], i * 3); ts[i] = i / N; }
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    og.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
    const om = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: FACTIONS.neutral.color.clone() }, uOp: { value: 0.22 }, uPhase: { value: 0 } },
      vertexShader: G.ORBIT_VERT, fragmentShader: G.ORBIT_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const line = new THREE.LineLoop(og, om);
    line.userData.center = center;
    scene.add(line);
    b.orbitLine = line; b.orbitMat = om;
  }
  return bodies;
}

export function updateBodies(bodies, dt, t) {
  const v = new THREE.Vector3();
  for (const b of bodies) if (!b.parentBody) step(b);
  for (const b of bodies) if (b.parentBody) step(b);
  function step(b) {
    b.angle += b.omega * dt;
    b.localPos(b.angle, v);
    if (b.parentBody) { v.add(b.parentBody.pos); b.orbitLine.position.copy(b.parentBody.pos); }
    b.pos.copy(v);
    b.group.position.copy(v);
    b.mesh.rotation.y = t * (b.type === 4 ? 0.05 : 0.02) + b.idx;
    b.mat.uniforms.uTime.value = t;
    b.orbitMat.uniforms.uPhase.value = ((b.angle / (Math.PI * 2)) % 1 + 1) % 1;
  }
}

export function paintOwner(b) {
  const f = FACTIONS[b.owner] || FACTIONS.neutral;
  b.mat.uniforms.uCity.value.copy(f.color);
  b.mat.uniforms.uCityAmt.value = b.owner === 'neutral' ? 0.05 : b.owner ? 1.0 : 0.0;
  b.orbitMat.uniforms.uCol.value.copy(f.color);
  b.orbitMat.uniforms.uOp.value = b.owner === 'neutral' ? 0.16 : 0.4;
}

// ---------------------------------------------------------------- asteroid belt
export function buildBelt(scene) {
  const base = new THREE.IcosahedronGeometry(1, 1);
  const p = base.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 0.7 + 0.5 * Math.abs(Math.sin(v.x * 3.1 + v.y * 1.7) * Math.cos(v.z * 2.3));
    v.multiplyScalar(k); p.setXYZ(i, v.x, v.y, v.z);
  }
  base.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6d655c, roughness: 0.95, metalness: 0.05, flatShading: true });
  const inst = new THREE.InstancedMesh(base, mat, BELT.count);
  const data = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
  const tint = new THREE.Color();
  for (let i = 0; i < BELT.count; i++) {
    const r = BELT.inner + Math.pow(Math.random(), 0.8) * (BELT.outer - BELT.inner) + (Math.random() - 0.5) * 10;
    const a = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.5) * 7 * (1 - Math.abs((r - 267) / 30));
    const sc = 0.25 + Math.pow(Math.random(), 4) * 2.6;
    data.push({ r, a, y, sc, rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - 0.5) * 0.6, w: 0.0115 * Math.pow(100 / r, 1.5) });
    tint.setHSL(0.07 + Math.random() * 0.03, 0.12 + Math.random() * 0.1, 0.32 + Math.random() * 0.25);
    inst.setColorAt(i, tint);
  }
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(inst);
  let acc = 0;
  return {
    update(dt, t) {
      acc += dt;
      if (acc < 1 / 30) return;   // belt drifts slowly — 30 Hz is plenty
      acc = 0;
      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        const a = d.a + t * d.w;
        s.setScalar(d.sc);
        e.set(d.rx + t * d.spin, d.ry + t * d.spin * 0.7, 0);
        q.setFromEuler(e);
        m.compose(v.set(Math.cos(a) * d.r, d.y, Math.sin(a) * d.r), q, s);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
    },
  };
}
