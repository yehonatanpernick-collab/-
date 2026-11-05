// ============================================================================
//  Atmosphere: sky, sun, environment lighting, stars, volumetric-look clouds
// ============================================================================
const sky = new Sky(); sky.scale.setScalar(85000); scene.add(sky);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 5; skyU.rayleigh.value = 1.6; skyU.mieCoefficient.value = 0.004; skyU.mieDirectionalG.value = 0.82;

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10; sun.shadow.camera.far = 3000;
const SH = 90; Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
scene.add(sun); scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a4434, 0.6); scene.add(hemi);
const sunDir = new THREE.Vector3();

// Stars
const stars = (() => {
  const n = 2600, p = new Float32Array(n * 3), c = new Float32Array(n * 3), s = new Float32Array(n); const r = mulberry32(7);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2; const sq = Math.sqrt(1 - u * u);
    p.set([sq * Math.cos(th) * 60000, Math.abs(u) * 60000 + 2000, sq * Math.sin(th) * 60000], i * 3);
    const b = 0.4 + r() * r() * 2.6; const t = r(); c.set([b * (0.85 + t * 0.2), b * 0.92, b * (1.1 - t * 0.2)], i * 3); s[i] = 120 + r() * 220;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('size', new THREE.BufferAttribute(s, 1));
  const m = lightPointMat.clone(); m.uniforms = { uIntensity: { value: 0 }, uScale: { value: innerHeight }, uFogCol: { value: new THREE.Color() }, uFogDen: { value: 0 } };
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = -2; scene.add(pts); return pts;
})();

// Moon
const moon = new THREE.Mesh(new THREE.CircleGeometry(900, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.0), fog: false, transparent: true, opacity: 0 }));
scene.add(moon);

// ---------------------------------------------------------------- Clouds
function cloudAtlas() {
  return canvasTex(512, 512, (c) => {
    const r = mulberry32(99);
    for (let k = 0; k < 4; k++) {
      const ox = (k % 2) * 256, oy = Math.floor(k / 2) * 256;
      for (let i = 0; i < 46; i++) {
        const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * 72; const x = ox + 128 + Math.cos(a) * d, y = oy + 128 + Math.sin(a) * d * 0.7;
        const rad = 26 + r() * 44; const gr = c.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, 'rgba(255,255,255,0.32)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = gr; c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill();
      }
    }
  });
}
const cloudU = {
  uTex: { value: cloudAtlas() }, uCam: { value: new THREE.Vector3() }, uField: { value: 52000 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.6, 0.65, 0.75) },
  uFogCol: { value: new THREE.Color() }, uFogDen: { value: 0.00004 }, uOpacity: { value: 1 },
};
const cloudMat = new THREE.ShaderMaterial({
  uniforms: cloudU, transparent: true, depthWrite: false,
  vertexShader: `attribute vec3 aCluster; attribute vec3 aOff; attribute vec2 aInfo; varying vec2 vUv; varying float vShade; varying float vAlpha; varying vec3 vWorld;
    uniform vec3 uCam, uSunDir; uniform float uField, uFogDen;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main(){
      vec3 c = aCluster; c.xz = mod(c.xz - uCam.xz + uField*0.5, uField) - uField*0.5 + uCam.xz;
      vec3 wp = c + aOff; vWorld = wp;
      vec4 mv = viewMatrix * vec4(wp, 1.0);
      float sz = aInfo.x;
      float ang = aInfo.y * 6.2831;
      vec2 q = position.xy; q = vec2(q.x*cos(ang)-q.y*sin(ang), q.x*sin(ang)+q.y*cos(ang));
      mv.xy += q * sz;
      gl_Position = projectionMatrix * mv;
      float idx = floor(aInfo.y * 4.0);
      vUv = (uv + vec2(mod(idx,2.0), floor(idx/2.0))) * 0.5;
      float h = clamp(aOff.y / (sz*1.2) * 0.5 + 0.5, 0.0, 1.0);
      float sunSide = dot(normalize(aOff + vec3(0.0,0.001,0.0)), uSunDir) * 0.5 + 0.5;
      vShade = clamp(h * 0.65 + sunSide * 0.45, 0.0, 1.0);
      float d = -mv.z;
      vAlpha = smoothstep(sz*0.25, sz*1.6, d) * exp(-uFogDen*uFogDen*d*d*0.7);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `uniform sampler2D uTex; uniform vec3 uLit, uShade, uFogCol, uSunDir; uniform float uOpacity, uFogDen; varying vec2 vUv; varying float vShade; varying float vAlpha; varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_fragment>
    void main(){
      #include <logdepthbuf_fragment>
      vec4 t = texture2D(uTex, vUv);
      vec3 V = normalize(vWorld - cameraPosition);
      float silver = pow(max(dot(V, uSunDir), 0.0), 12.0) * (1.0 - t.a) * 2.5;
      vec3 col = mix(uShade, uLit, vShade) + uLit * silver;
      float d = length(vWorld - cameraPosition);
      float fog = 1.0 - exp(-uFogDen*uFogDen*d*d*0.55);
      col = mix(col, uFogCol, fog);
      float a = t.a * vAlpha * uOpacity * 1.75;
      if (a < 0.004) discard;
      gl_FragColor = vec4(col, min(a, 1.0));
    }`,
});
let cloudMesh = null, cloudLayer = { base: 1600, top: 2400, cover: 0 };
function buildClouds(kind) {
  if (cloudMesh) { scene.remove(cloudMesh); cloudMesh.geometry.dispose(); cloudMesh = null; }
  const cfg = { clear: { n: 70, base: 2200, thick: 500, size: 1 }, scattered: { n: 520, base: 1500, thick: 700, size: 1 }, overcast: { n: 1350, base: 1100, thick: 900, size: 1.25 } }[kind];
  cloudLayer = { base: cfg.base, top: cfg.base + cfg.thick, cover: kind === 'overcast' ? 1 : kind === 'scattered' ? 0.35 : 0.05 };
  const r = mulberry32(kind.length * 977);
  const clusters = [], offs = [], infos = [];
  const F = cloudU.uField.value;
  for (let i = 0; i < cfg.n; i++) {
    const cx = (r() - 0.5) * F, cz = (r() - 0.5) * F, cy = cfg.base + r() * cfg.thick * 0.4;
    const R = (300 + r() * 700) * cfg.size; const puffs = 11 + ((r() * 16) | 0);
    for (let k = 0; k < puffs; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R;
      const ox = Math.cos(a) * d, oz = Math.sin(a) * d * 0.8; const oy = (r() * 0.9 + 0.05) * R * 0.55 * (1 - d / R * 0.6);
      clusters.push(cx, cy, cz); offs.push(ox, oy, oz); infos.push((R * (0.4 + r() * 0.42)), r());
    }
  }
  const base = new THREE.PlaneGeometry(2, 2);
  const g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
  g.setAttribute('aCluster', new THREE.InstancedBufferAttribute(new Float32Array(clusters), 3));
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(offs), 3));
  g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(new Float32Array(infos), 2));
  g.instanceCount = infos.length / 2;
  cloudMesh = new THREE.Mesh(g, cloudMat); cloudMesh.frustumCulled = false; cloudMesh.renderOrder = 5; scene.add(cloudMesh);
}

// ---------------------------------------------------------------- Time of day
const TIMES = {
  dawn: { elev: 5, az: 92, fog: [0.86, 0.72, 0.62], sun: [1.0, 0.68, 0.42], sunI: 2.0, hemiS: [0.62, 0.66, 0.8], hemiG: [0.3, 0.26, 0.22], hemiI: 0.5, exp: 0.62, tur: 7, ray: 2.2, night: 0.3, lights: 0.6 },
  noon: { elev: 58, az: 165, fog: [0.70, 0.79, 0.90], sun: [1.0, 0.97, 0.92], sunI: 3.2, hemiS: [0.66, 0.78, 1.0], hemiG: [0.36, 0.33, 0.25], hemiI: 0.75, exp: 0.5, tur: 4.5, ray: 1.3, night: 0, lights: 0.25 },
  sunset: { elev: 4, az: 262, fog: [0.94, 0.64, 0.46], sun: [1.0, 0.55, 0.28], sunI: 2.2, hemiS: [0.6, 0.6, 0.78], hemiG: [0.32, 0.24, 0.2], hemiI: 0.5, exp: 0.62, tur: 8, ray: 2.8, night: 0.45, lights: 0.8 },
  night: { elev: -18, az: 300, fog: [0.045, 0.06, 0.1], sun: [0.55, 0.65, 0.95], sunI: 0.55, hemiS: [0.22, 0.28, 0.45], hemiG: [0.05, 0.05, 0.07], hemiI: 0.55, exp: 1.25, tur: 2, ray: 0.6, night: 1, lights: 1.6 },
};
const WEATHER = {
  clear: { fog: 1, dim: 1, wave: 0.9 }, scattered: { fog: 1.2, dim: 0.95, wave: 1.1 }, overcast: { fog: 2.0, dim: 0.55, wave: 1.5 },
};
const env = { time: 'sunset', weather: 'scattered', fogBase: 0.000042, fogCol: new THREE.Color(), lightI: 1 };
let pmrem = new THREE.PMREMGenerator(renderer), envRT = null;
function applyConditions(timeKey, wxKey) {
  env.time = timeKey; env.weather = wxKey;
  const T = TIMES[timeKey], W = WEATHER[wxKey];
  const el = T.elev * DEG, az = T.az * DEG;
  // azimuth: 0=north(-Z), 90=east(+X)
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  const lightDir = sunDir.clone();
  if (T.elev < 0) lightDir.set(Math.sin(az + 2.2) * 0.6, 0.62, -Math.cos(az + 2.2) * 0.6).normalize(); // moonlight
  env.lightDir = lightDir;
  skyU.sunPosition.value.copy(sunDir);
  skyU.turbidity.value = T.tur * (wxKey === 'overcast' ? 2.2 : 1); skyU.rayleigh.value = T.ray * (wxKey === 'overcast' ? 0.5 : 1);
  sun.color.setRGB(...T.sun, THREE.SRGBColorSpace); sun.intensity = T.sunI * W.dim;
  hemi.color.setRGB(...T.hemiS, THREE.SRGBColorSpace); hemi.groundColor.setRGB(...T.hemiG, THREE.SRGBColorSpace); hemi.intensity = T.hemiI * (wxKey === 'overcast' ? 1.25 : 1);
  env.fogCol.setRGB(...T.fog, THREE.SRGBColorSpace);
  if (wxKey === 'overcast') env.fogCol.lerp(new THREE.Color().setRGB(0.6, 0.63, 0.68, THREE.SRGBColorSpace).multiplyScalar(T.elev < 0 ? 0.06 : T.elev < 10 ? 0.7 : 1), 0.7);
  scene.fog.color.copy(env.fogCol);
  env.fogBase = 0.000040 * W.fog;
  renderer.toneMappingExposure = T.exp;
  nightUniform.value = T.night; lightPointMat.uniforms.uIntensity.value = T.lights;
  stars.material.uniforms.uIntensity.value = T.elev < 0 ? (wxKey === 'overcast' ? 0.1 : 1.0) : 0;
  moon.material.opacity = T.elev < 0 && wxKey !== 'overcast' ? 1 : 0;
  // ocean & clouds
  oceanUniforms.uSunDir.value.copy(sunDir); oceanUniforms.uSunCol.value.copy(sun.color).multiplyScalar(T.elev < 0 ? 0.05 : W.dim);
  oceanUniforms.uWave.value = W.wave;
  const skyTop = new THREE.Color().setRGB(...(T.elev < 0 ? [0.01, 0.015, 0.03] : timeKey === 'noon' ? [0.25, 0.45, 0.8] : [0.35, 0.42, 0.62]), THREE.SRGBColorSpace);
  if (wxKey === 'overcast') skyTop.lerp(env.fogCol, 0.7);
  oceanUniforms.uSkyCol.value.copy(skyTop); oceanUniforms.uHorizon.value.copy(env.fogCol);
  oceanUniforms.uDeep.value.setRGB(0.012, 0.07, 0.11).multiplyScalar(T.elev < 0 ? 0.15 : 1);
  oceanUniforms.uShallow.value.setRGB(0.03, 0.17, 0.2).multiplyScalar(T.elev < 0 ? 0.15 : 1);
  cloudU.uSunDir.value.copy(sunDir);
  const litC = new THREE.Color().setRGB(...T.sun, THREE.SRGBColorSpace).multiplyScalar(T.elev < 0 ? 0.08 : 1.25 * W.dim);
  cloudU.uLit.value.copy(litC);
  cloudU.uShade.value.copy(env.fogCol).multiplyScalar(T.elev < 0 ? 0.6 : 0.78).lerp(new THREE.Color(0.35, 0.38, 0.45).multiplyScalar(T.elev < 0 ? 0.05 : 1), 0.35);
  buildClouds(wxKey);
  // environment map from sky for reflections
  const envScene = new THREE.Scene(); const s2 = new Sky(); s2.scale.setScalar(1000);
  Object.keys(skyU).forEach(k => { s2.material.uniforms[k].value = skyU[k].value?.clone ? skyU[k].value.clone() : skyU[k].value; });
  if (T.elev < 0) s2.material.uniforms.sunPosition.value.set(0, 0.05, -1); // faint night env
  envScene.add(s2);
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0, 1, 3000);
  scene.environment = envRT.texture;
  env.envScale = T.elev < 0 ? 0.08 : wxKey === 'overcast' ? 0.5 : 1;
  scene.traverse(o => { if (o.material && o.material.isMeshStandardMaterial) o.material.envMapIntensity = (o.material.userData.envBase ?? 1) * env.envScale; });
  terrainMat.envMapIntensity = 0.35 * env.envScale; treeMat.envMapIntensity = 0.3 * env.envScale;
}

function updateSky(camPos, dt) {
  sky.position.copy(camPos); stars.position.copy(camPos);
  const ld = env.lightDir || sunDir;
  moon.position.copy(camPos).addScaledVector(ld, 60000); moon.lookAt(camPos);
  cloudU.uCam.value.copy(camPos);
  // fog thickens inside the cloud layer and with low cloud base in overcast
  let den = env.fogBase;
  const inCloud = smoothstep(cloudLayer.base - 80, cloudLayer.base + 120, camPos.y) * smoothstep(cloudLayer.top + 60, cloudLayer.top - 150, camPos.y) * (cloudLayer.cover > 0.9 ? 1 : 0);
  den = lerp(den, 0.0042, inCloud);
  den *= lerp(1, 0.55, smoothstep(500, 6000, camPos.y)); // thinner air up high
  env.inCloud = inCloud;
  scene.fog.density = den;
  scene.fog.color.copy(env.fogCol).lerp(new THREE.Color(0.75, 0.77, 0.8).multiplyScalar(env.time === 'night' ? 0.05 : 1), inCloud);
  for (const u of [oceanUniforms, cloudU]) { u.uFogDen.value = den; u.uFogCol.value.copy(scene.fog.color); }
  lightPointMat.uniforms.uFogDen.value = den; lightPointMat.uniforms.uFogCol.value.copy(scene.fog.color);
  cloudU.uOpacity.value = 1 - inCloud * 0.6;
  oceanUniforms.uTime.value += dt;
  ocean.position.set(Math.round(camPos.x / 1000) * 1000, 0, Math.round(camPos.z / 1000) * 1000);
}
