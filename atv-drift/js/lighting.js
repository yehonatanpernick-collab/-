// Time of day: sun / moon, sky, fog, exposure, stars, headlights and a lens flare, blended smoothly between presets.
import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

export const TIMES = [
  { id: 'dawn', name: 'זריחה', lightElev: 9, lightAz: -100, skyElev: 7, skyAz: -100, turbidity: 6.5, rayleigh: 2.3, mie: 0.012, mieG: 0.92,
    sun: 0xffa868, sunI: 2.3, hemiSky: 0xf0b9a8, hemiGnd: 0x6a5040, hemiI: 0.36, fog: 0xe4b59a, fogNear: 220, fogFar: 2100, exposure: 0.82, env: 0.34, bloom: 0.28,
    cloud: [1.0, 0.72, 0.6], night: 0, ground: 0x8a6a50 },
  { id: 'noon', name: 'צהריים', lightElev: 58, lightAz: -140, skyElev: 58, skyAz: -140, turbidity: 2.4, rayleigh: 1.0, mie: 0.003, mieG: 0.8,
    sun: 0xfff3e0, sunI: 3.5, hemiSky: 0xbfd9ff, hemiGnd: 0xa08462, hemiI: 0.5, fog: 0xd7d8d2, fogNear: 340, fogFar: 2500, exposure: 0.8, env: 0.55, bloom: 0.2,
    cloud: [1, 1, 1], night: 0, ground: 0x9a7a55 },
  { id: 'golden', name: 'אחר הצהריים', lightElev: 24, lightAz: -140, skyElev: 24, skyAz: -140, turbidity: 3.2, rayleigh: 1.25, mie: 0.004, mieG: 0.86,
    sun: 0xffdcb4, sunI: 3.0, hemiSky: 0xc4d8ff, hemiGnd: 0x9a7650, hemiI: 0.42, fog: 0xcdc3b1, fogNear: 320, fogFar: 2300, exposure: 0.86, env: 0.45, bloom: 0.24,
    cloud: [1, 0.97, 0.92], night: 0, ground: 0x9a7a55 },
  { id: 'sunset', name: 'שקיעה', lightElev: 4, lightAz: -165, skyElev: 2.5, skyAz: -165, turbidity: 9, rayleigh: 3.2, mie: 0.022, mieG: 0.93,
    sun: 0xff7a38, sunI: 2.4, hemiSky: 0xb98a80, hemiGnd: 0x4a3a38, hemiI: 0.32, fog: 0xd98a66, fogNear: 200, fogFar: 2000, exposure: 0.8, env: 0.3, bloom: 0.34,
    cloud: [1.0, 0.55, 0.42], night: 0, ground: 0x6a4a3a },
  { id: 'night', name: 'לילה', lightElev: 38, lightAz: 55, skyElev: -22, skyAz: -140, turbidity: 1.2, rayleigh: 0.25, mie: 0.002, mieG: 0.7,
    sun: 0x8fb0ff, sunI: 1.5, hemiSky: 0x2a3d6e, hemiGnd: 0x141a2c, hemiI: 0.55, fog: 0x0d1630, fogNear: 110, fogFar: 1300, exposure: 1.55, env: 0.22, bloom: 0.5,
    cloud: [0.1, 0.13, 0.22], night: 1, ground: 0x10141e },
];
const NUM = ['lightElev', 'lightAz', 'skyElev', 'skyAz', 'turbidity', 'rayleigh', 'mie', 'mieG', 'sunI', 'hemiI', 'fogNear', 'fogFar', 'exposure', 'env', 'bloom', 'night'];
const COL = ['sun', 'hemiSky', 'hemiGnd', 'fog'];

const glowTex = (inner, outer, size = 128) => {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(1, outer); x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const ringTex = () => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 6;
  x.beginPath(); x.arc(64, 64, 52, 0, 7); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};

export function createLighting(o) {
  const { scene, sun, hemi, skyCtl, clouds, sunDir, renderer, particles, setBloom } = o;
  const cur = {}; const tgt = {};
  const init = (p) => { for (const k of NUM) cur[k] = p[k]; for (const k of COL) cur[k] = new THREE.Color(p[k]); cur.cloud = new THREE.Vector3(...p.cloud); cur.ground = p.ground; };
  let idx = Math.max(0, TIMES.findIndex(t => t.id === o.start));
  init(TIMES[idx]);
  const target = TIMES[idx];

  // stars + moon
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(1800 * 3);
  for (let i = 0; i < 1800; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    sp[i * 3] = Math.cos(a) * r * 2400; sp[i * 3 + 1] = Math.abs(u) * 2400 * 0.98 + 40; sp[i * 3 + 2] = Math.sin(a) * r * 2400;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeo, starMat); stars.frustumCulled = false; stars.renderOrder = -2;
  scene.add(stars);
  const moonMat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,255,255,1)', 'rgba(170,190,255,0)'), transparent: true, opacity: 0, depthWrite: false, fog: false });
  const moon = new THREE.Sprite(moonMat); moon.scale.setScalar(380); moon.renderOrder = -1;
  scene.add(moon);

  // headlights
  const heads = [];
  for (const x of [0.5, -0.5]) {
    const l = new THREE.SpotLight(0xfff0d0, 0, 110, 0.55, 0.55, 1.5);
    l.position.set(x, 0.85, 1.7); l.target.position.set(x * 0.7, 0.1, 24);
    heads.push(l);
  }
  // lens flare on the sun
  let flare = null; const flareEls = [];
  if (o.flare) {
    flare = new Lensflare();
    const g1 = glowTex('rgba(255,244,225,1)', 'rgba(255,200,140,0)', 256), g2 = glowTex('rgba(255,220,180,0.5)', 'rgba(255,160,90,0)'), rg = ringTex();
    const el = (t, s, d, c) => { const e = new LensflareElement(t, s, d, new THREE.Color(c)); flareEls.push({ e, base: new THREE.Color(c) }); flare.addElement(e); };
    el(g1, 520, 0, 0xffffff); el(g2, 90, 0.35, 0xffd9a0); el(rg, 140, 0.55, 0xffc890); el(g2, 60, 0.72, 0xb0d0ff); el(g2, 160, 0.95, 0xffb070);
    sun.add(flare);
  }

  const tmp = new THREE.Color();
  let pendingEnv = true, settle = 0, autoT = 0;
  const api = {
    get index() { return idx; }, get name() { return TIMES[idx].name; }, auto: !!o.auto,
    headlights: heads,
    set(i) { idx = (i + TIMES.length) % TIMES.length; pendingEnv = true; settle = 0; },
    next() { api.set(idx + 1); },
    update(dt, camPos) {
      const T = TIMES[idx], k = Math.min(1, dt * 1.7);
      let diff = 0;
      for (const n of NUM) { cur[n] += (T[n] - cur[n]) * k; diff += Math.abs(T[n] - cur[n]) / (Math.abs(T[n]) + 1); }
      for (const c of COL) cur[c].lerp(tmp.set(T[c]), k);
      cur.cloud.lerp(new THREE.Vector3(...T.cloud), k);
      // light direction
      sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - cur.lightElev), THREE.MathUtils.degToRad(cur.lightAz));
      const skyP = skyCtl.params;
      skyP.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - cur.skyElev), THREE.MathUtils.degToRad(cur.skyAz));
      skyP.turbidity = cur.turbidity; skyP.rayleigh = cur.rayleigh; skyP.mie = cur.mie; skyP.mieG = cur.mieG;
      skyCtl.set();
      sun.color.copy(cur.sun); sun.intensity = cur.sunI;
      hemi.color.copy(cur.hemiSky); hemi.groundColor.copy(cur.hemiGnd); hemi.intensity = cur.hemiI;
      scene.fog.color.copy(cur.fog); scene.fog.near = cur.fogNear; scene.fog.far = cur.fogFar;
      renderer.toneMappingExposure = cur.exposure;
      scene.environmentIntensity = cur.env;
      setBloom?.(cur.bloom);
      clouds.userData.mat.uniforms.uTint.value.copy(cur.cloud);
      clouds.userData.mat.uniforms.uSun.value.copy(skyP.sunDir);
      if (particles) { particles.mat.uniforms.fogColor.value.copy(scene.fog.color); particles.mat.uniforms.fogNear.value = scene.fog.near; particles.mat.uniforms.fogFar.value = scene.fog.far; }
      const night = cur.night;
      starMat.opacity = Math.max(0, night * 0.95); stars.position.copy(camPos);
      moonMat.opacity = night * 0.9; moon.position.copy(camPos).addScaledVector(sunDir, 2300);
      for (const h of heads) h.intensity = Math.max(0, (night - 0.15) * 2600) + (cur.sunI < 1.5 && night < 0.5 ? (1 - cur.sunI / 1.5) * 500 : 0);
      if (flare) { const vis = Math.max(0, Math.min(1, (cur.lightElev - 1) / 8)) * (1 - night); for (const f of flareEls) f.e.color.copy(f.base).multiplyScalar(vis * 0.9); }
      // refresh the reflections once the blend has settled
      if (pendingEnv) { settle = diff < 0.02 ? settle + dt : 0; if (settle > 0.25) { skyCtl.refreshEnv(T.ground); pendingEnv = false; } }
      if (api.auto) { autoT += dt; if (autoT > 70) { autoT = 0; api.next(); } }
    },
    apply() { api.update(10, o.camera.position); skyCtl.refreshEnv(TIMES[idx].ground); },
  };
  return api;
}
