// Renderer, scene, sky/sun/clouds, image-based lighting, cascaded-follow shadows and the
// post-processing stack (GTAO, bloom, ACES, FXAA, filmic grade). Quality presets for mobile/PC.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export const QUALITY = {
  low: { name: 'LOW', pr: 0.75, maxPr: 1, shadow: 1024, shadowDist: 38, post: false, bloom: false, ao: false, fxaa: false, grass: 0, treeLod: 0.5, tex: 256, aniso: 2, particles: 0.45, clouds: false, fog: 0.0024, decals: 80 },
  medium: { name: 'MEDIUM', pr: 1, maxPr: 1.25, shadow: 2048, shadowDist: 55, post: true, bloom: true, ao: false, fxaa: true, grass: 0.5, treeLod: 0.8, tex: 512, aniso: 4, particles: 0.7, clouds: true, fog: 0.0018, decals: 150 },
  high: { name: 'HIGH', pr: 1, maxPr: 1.5, shadow: 2048, shadowDist: 75, post: true, bloom: true, ao: false, fxaa: true, grass: 1, treeLod: 1, tex: 512, aniso: 8, particles: 1, clouds: true, fog: 0.0016, decals: 250 },
  ultra: { name: 'ULTRA', pr: 1, maxPr: 2, shadow: 4096, shadowDist: 95, post: true, bloom: true, ao: true, fxaa: true, grass: 1.5, treeLod: 1, tex: 512, aniso: 16, particles: 1, clouds: true, fog: 0.0014, decals: 400 },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.32 }, uDamage: { value: 0 }, uSupp: { value: 0 },
    uSat: { value: 1.12 }, uContrast: { value: 1.12 }, uGrain: { value: 0.035 }, uCA: { value: 0.0012 }, uFlash: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) }, uLow: { value: 0 }, uTint: { value: new THREE.Vector3(1.0, 0.985, 0.95) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVig, uDamage, uSupp, uSat, uContrast, uGrain, uCA, uFlash, uLow; uniform vec2 uRes; uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      float ca = uCA * (1.0 + uSupp * 4.0 + uDamage * 3.0) * r * 2.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ca).b;
      if (uSupp > 0.01) { // suppression blur toward edges
        vec3 b = vec3(0.0); float k = uSupp * 0.006 * r;
        b += texture2D(tDiffuse, vUv + vec2(k, 0.0)).rgb; b += texture2D(tDiffuse, vUv - vec2(k, 0.0)).rgb;
        b += texture2D(tDiffuse, vUv + vec2(0.0, k)).rgb; b += texture2D(tDiffuse, vUv - vec2(0.0, k)).rgb;
        col = mix(col, b * 0.25, clamp(uSupp * r * 2.0, 0.0, 1.0));
      }
      col *= uTint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat * (1.0 - uDamage * 0.6));
      col = (col - 0.5) * uContrast + 0.5;
      // split tone: cool shadows, warm highlights
      col += vec3(-0.012, 0.0, 0.018) * (1.0 - l) + vec3(0.015, 0.006, -0.012) * l;
      float vig = smoothstep(0.85, 0.2, r * (1.0 + uSupp * 0.6));
      col *= mix(1.0 - uVig, 1.0, vig);
      col = mix(col, vec3(0.55, 0.02, 0.0), uDamage * smoothstep(0.25, 0.75, r) * 0.85);
      col += (hash(vUv * uRes + uTime) - 0.5) * uGrain;
      col += uFlash;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

const CloudShader = {
  uniforms: { uTime: { value: 0 }, uSun: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color(1, 0.9, 0.75) }, uFogCol: { value: new THREE.Color() } },
  vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `
    uniform float uTime; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uFogCol; varying vec3 vW;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
    void main(){
      vec2 p = vW.xz * 0.0011 + vec2(uTime * 0.004, uTime * 0.0015);
      float d = fbm(p) ; float d2 = fbm(p * 2.3 + 4.0);
      float cov = smoothstep(0.48, 0.78, d * 0.75 + d2 * 0.35);
      float dist = length(vW.xz - cameraPosition.xz);
      float fade = 1.0 - smoothstep(1500.0, 2800.0, dist);
      vec3 dir = normalize(vW - cameraPosition);
      float sunAmt = pow(max(dot(dir, normalize(uSun)), 0.0), 6.0);
      float thick = smoothstep(0.55, 0.95, d * 0.7 + d2 * 0.4);
      vec3 col = mix(vec3(1.05, 1.02, 1.0), vec3(0.55, 0.56, 0.62), thick) * mix(vec3(1.0), uSunCol * 1.4, 0.35);
      col += uSunCol * sunAmt * (1.0 - thick) * 1.5;
      col = mix(col, uFogCol, smoothstep(700.0, 2700.0, dist) * 0.85);
      gl_FragColor = vec4(col * 1.6, cov * fade * 0.85);
    }`,
};

export class Gfx {
  constructor(canvas, qualityName) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.88;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.06, 3000);
    this.camera.rotation.order = 'YXZ';
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(54, 1, 0.01, 20);
    this.scene.add(this.camera);
    this.time = 0;
    this.setupSky();
    this.setupLights();
    this.setQuality(qualityName, true);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setupSky() {
    const sky = new Sky();
    sky.scale.setScalar(2400);
    const u = sky.material.uniforms;
    u.turbidity.value = 3.4; u.rayleigh.value = 1.85; u.mieCoefficient.value = 0.0032; u.mieDirectionalG.value = 0.84;
    this.sunDir = new THREE.Vector3();
    const elev = THREE.MathUtils.degToRad(27), az = THREE.MathUtils.degToRad(64);
    this.sunDir.setFromSphericalCoords(1, Math.PI / 2 - elev, az);
    u.sunPosition.value.copy(this.sunDir);
    sky.material.depthWrite = false;
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.sky = sky;
    this.scene.add(sky);
    this.fogColor = new THREE.Color(0.44, 0.5, 0.58);
    this.scene.fog = new THREE.FogExp2(this.fogColor, 0.0024);
    this.scene.background = this.fogColor;
    // clouds
    const cg = new THREE.PlaneGeometry(14000, 14000, 1, 1); cg.rotateX(Math.PI / 2);
    const cm = new THREE.ShaderMaterial({ ...CloudShader, uniforms: THREE.UniformsUtils.clone(CloudShader.uniforms), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    cm.uniforms.uSun.value.copy(this.sunDir);
    cm.uniforms.uFogCol.value.copy(this.fogColor);
    this.clouds = new THREE.Mesh(cg, cm);
    this.clouds.position.y = 650; this.clouds.frustumCulled = false; this.clouds.renderOrder = -9;
    this.scene.add(this.clouds);
  }

  buildEnvironment() {
    // IBL from the sky (plus a warm ground bounce plane)
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(1000);
    for (const k in this.sky.material.uniforms) sky2.material.uniforms[k].value = this.sky.material.uniforms[k].value;
    envScene.add(sky2);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.14, 0.11), side: THREE.DoubleSide }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -20;
    envScene.add(ground);
    const rt = pm.fromScene(envScene, 0.02, 1, 1200);
    this.scene.environment = rt.texture;
    this.vmScene.environment = rt.texture;
    pm.dispose();
  }

  setupLights() {
    const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.86, 0.68), 3.4);
    sun.castShadow = true;
    sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.035;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    this.hemi = new THREE.HemisphereLight(new THREE.Color(0.62, 0.7, 0.85), new THREE.Color(0.32, 0.27, 0.2), 0.55);
    this.scene.add(this.hemi);
    // viewmodel lights
    this.vmSun = new THREE.DirectionalLight(sun.color, 2.6);
    this.vmHemi = new THREE.HemisphereLight(this.hemi.color, this.hemi.groundColor, 0.7);
    this.vmScene.add(this.vmSun, this.vmSun.target, this.vmHemi);
    this.vmFlash = new THREE.PointLight(0xffb060, 0, 3, 2);
    this.vmFlash.position.set(0, 0, -0.8);
    this.vmScene.add(this.vmFlash);
    // pooled dynamic lights in world (fixed count => no shader recompiles)
    this.dyn = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffa050, 0, 30, 2); l.userData.t = 0; this.scene.add(l); this.dyn.push(l); }
    this.dynIdx = 0;
  }
  flashLight(pos, color, intensity, range, dur) {
    const l = this.dyn[this.dynIdx++ % this.dyn.length];
    l.position.copy(pos); l.color.set(color); l.distance = range; l.userData.i0 = intensity; l.userData.t = dur; l.userData.d = dur; l.intensity = intensity;
  }

  setQuality(name, initial = false) {
    const isTouch = matchMedia('(pointer: coarse)').matches;
    if (!QUALITY[name]) name = isTouch ? 'low' : 'high';
    this.qname = name;
    const Q = this.Q = QUALITY[name];
    const sun = this.sun;
    sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    const d = Q.shadowDist;
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 700 });
    sun.shadow.camera.updateProjectionMatrix();
    this.scene.fog.density = Q.fog;
    this.clouds.visible = Q.clouds;
    this.renderer.shadowMap.type = name === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    if (!initial) this.renderer.shadowMap.needsUpdate = true;
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    const Q = this.Q;
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
    if (!Q.post) return;
    const r = this.renderer;
    const comp = new EffectComposer(r);
    const rp = new RenderPass(this.scene, this.camera);
    comp.addPass(rp);
    if (Q.ao) {
      const ao = new GTAOPass(this.scene, this.camera, 512, 512);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 2, scale: 1.2, samples: 12 });
      this.ao = ao;
      comp.addPass(ao);
    } else this.ao = null;
    const vm = new RenderPass(this.vmScene, this.vmCamera);
    vm.clear = false; vm.clearDepth = true;
    comp.addPass(vm);
    if (Q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.92); comp.addPass(this.bloom); }
    comp.addPass(new OutputPass());
    if (Q.fxaa) { this.fxaa = new ShaderPass(FXAAShader); comp.addPass(this.fxaa); } else this.fxaa = null;
    this.grade = new ShaderPass(GradeShader);
    comp.addPass(this.grade);
    this.composer = comp;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const Q = this.Q || QUALITY.high;
    const pr = Math.min(devicePixelRatio || 1, Q.maxPr) * Q.pr * (this.renderScale || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
      if (this.grade) this.grade.material.uniforms.uRes.value.set(w * pr, h * pr);
      if (this.ao) this.ao.setSize(w * pr * 0.5, h * pr * 0.5);
    }
  }

  updateShadow(focus) {
    const sun = this.sun;
    const d = this.Q.shadowDist;
    const texel = (2 * d) / this.Q.shadow;
    // snap focus in light space to texel grid to stop shimmering
    const L = this.sunDir;
    const up = Math.abs(L.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, L).normalize();
    const up2 = new THREE.Vector3().crossVectors(L, right).normalize();
    const fr = Math.round(focus.dot(right) / texel) * texel, fu = Math.round(focus.dot(up2) / texel) * texel, ff = focus.dot(L);
    const snapped = right.multiplyScalar(fr).add(up2.multiplyScalar(fu)).add(L.clone().multiplyScalar(ff));
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(L, 320);
    sun.target.updateMatrixWorld();
    this.vmSun.position.copy(L).multiplyScalar(10);
  }

  render(dt) {
    this.time += dt;
    this.sky.position.copy(this.camera.position);
    if (this.clouds.visible) { this.clouds.material.uniforms.uTime.value = this.time; this.clouds.position.x = this.camera.position.x; this.clouds.position.z = this.camera.position.z; }
    for (const l of this.dyn) {
      if (l.userData.t > 0) { l.userData.t -= dt; l.intensity = l.userData.i0 * Math.max(0, l.userData.t / l.userData.d) ** 2; } else l.intensity = 0;
    }
    if (this.composer) {
      this.grade.material.uniforms.uTime.value = this.time % 100;
      this.composer.render(dt);
    } else {
      const r = this.renderer;
      r.autoClear = true;
      r.render(this.scene, this.camera);
      r.autoClear = false;
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
      r.autoClear = true;
    }
  }
  setPost(o) {
    if (!this.grade) return;
    const u = this.grade.material.uniforms;
    for (const k in o) if (u[k]) u[k].value = o[k];
  }
}
