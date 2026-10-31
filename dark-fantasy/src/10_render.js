
// =====================================================================
// Renderer, scene, lights
// =====================================================================
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Q.pr);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COL = new THREE.Color().setRGB(0.03, 0.03, 0.036);
scene.fog = new THREE.FogExp2(FOG_COL.clone(), 0.019);
scene.background = FOG_COL.clone();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 2000);
camera.position.set(0, 6, 22);

// ---- Height-aware fog: low, cold mist that pools in hollows ----
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth; varying vec3 vFogWorld;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = (inverse(viewMatrix) * vec4(mvPosition.xyz, 1.0)).xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float mistH = exp( - max( vFogWorld.y + 0.8, 0.0 ) * 0.5 );
  float mistN = 0.6 + 0.4 * sin( vFogWorld.x * 0.09 + sin( vFogWorld.z * 0.06 ) * 2.5 ) * sin( vFogWorld.z * 0.08 + 1.3 );
  float mist = ( 1.0 - exp( - vFogDepth * 0.05 ) ) * mistH * mistN * 0.55;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * 2.2 + vec3( 0.02, 0.022, 0.03 ), mist * ( 1.0 - fogFactor ) );
#endif`;

const hemi = new THREE.HemisphereLight(0x5c6878, 0x16100c, 0.5);
scene.add(hemi);
const moonDir = new V3(-0.42, 0.2, -0.88).normalize();
const moonLight = new THREE.DirectionalLight(0xe6b4a8, 2.4);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(Q.shadow, Q.shadow);
{ const c = moonLight.shadow.camera; c.left = -38; c.right = 38; c.top = 38; c.bottom = -38; c.near = 1; c.far = 300; }
moonLight.shadow.bias = -0.0003; moonLight.shadow.normalBias = 0.04;
scene.add(moonLight, moonLight.target);
const rimLight = new THREE.DirectionalLight(0x7088b8, 0.5); rimLight.position.copy(moonDir).multiplyScalar(-1).setY(0.6).multiplyScalar(60); scene.add(rimLight);

// ---- environment for metal reflections ----
const envTex = (() => {
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, uniforms: { uMoon: { value: moonDir } },
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uMoon; varying vec3 vD; void main(){ vec3 d = normalize(vD); float y = d.y;
      vec3 c = mix(vec3(0.03,0.026,0.024), vec3(0.04,0.045,0.06), smoothstep(-0.3, 0.7, y));
      c += vec3(0.22,0.12,0.1) * smoothstep(0.18, 0.0, abs(y - 0.03));
      float m = max(dot(d, uMoon), 0.0); c += vec3(5.0,1.6,1.1) * pow(m, 400.0) + vec3(0.6,0.18,0.12) * pow(m, 12.0);
      c += vec3(1.0,0.5,0.2) * pow(max(dot(d, normalize(vec3(0.7,0.1,0.7))), 0.0), 50.0) * 0.7;
      c += vec3(0.3,0.38,0.55) * pow(max(dot(d, normalize(vec3(0.5,0.6,0.6))), 0.0), 5.0) * 0.25;
      gl_FragColor = vec4(c, 1.0); }`
  })));
  const t = pm.fromScene(es, 0.015).texture; pm.dispose(); return t;
})();
scene.environment = envTex;

// =====================================================================
// Sky: ash clouds, blood moon
// =====================================================================
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uMoonDir: { value: moonDir }, uFog: { value: FOG_COL }, uCurse: { value: 1 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
  fragmentShader: `
    uniform float uTime, uFlash, uCurse; uniform vec3 uMoonDir, uFog; varying vec3 vDir;
    float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
    float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<6;i++){ v+=a*n2(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return v; }
    void main(){
      vec3 d = normalize(vDir); float y = d.y;
      vec3 hor = vec3(0.085,0.07,0.068), mid = vec3(0.032,0.032,0.04), zen = vec3(0.005,0.006,0.01);
      vec3 col = mix(hor, mid, smoothstep(0.0, 0.28, y));
      col = mix(col, zen, smoothstep(0.28, 0.95, y));
      float md = max(dot(d, uMoonDir), 0.0);
      vec3 moonTint = mix(vec3(0.8,0.86,0.95), vec3(1.0,0.2,0.12), uCurse);
      col += moonTint * (pow(md, 180.0) * 1.2 + pow(md, 22.0) * 0.32 + pow(md, 4.0) * 0.07);
      // the moon itself: large, low, scarred
      vec3 ax = normalize(cross(uMoonDir, vec3(0.0,1.0,0.0))); vec3 ay = cross(ax, uMoonDir);
      vec2 mp = vec2(dot(d, ax), dot(d, ay)) / 0.052;
      float r = length(mp);
      float disc = smoothstep(1.0, 0.985, r);
      float limb = sqrt(max(0.0, 1.0 - r*r));
      float maria = 0.55 + 0.45 * fbm(mp * 2.2 + 3.0);
      float crater = smoothstep(0.1, 0.0, abs(fbm(mp * 5.0) - 0.5)) * 0.25;
      vec3 mcol = moonTint * 3.0 * (maria - crater) * (0.45 + 0.55 * limb);
      col = mix(col, mcol, disc);
      // stars
      vec3 sp = floor(d * 420.0); float s = h3(sp);
      float star = step(0.9978, s) * smoothstep(0.08, 0.4, y) * (0.5 + 0.5 * sin(uTime * (1.3 + s * 3.0) + s * 90.0));
      col += vec3(0.8,0.8,0.9) * star * (1.0 - disc);
      // clouds — layered, lit from the moon
      if (y > -0.05) {
        vec2 uv = d.xz / (y + 0.16) * 0.9;
        float c1 = fbm(uv + vec2(uTime * 0.006, uTime * 0.002));
        float c2 = fbm(uv * 2.3 - vec2(uTime * 0.01, 0.0));
        float cl = smoothstep(0.44, 0.8, c1 * 0.75 + c2 * 0.35) * smoothstep(-0.04, 0.16, y);
        float lit = pow(md, 5.0);
        vec3 cc = mix(vec3(0.016,0.015,0.017), vec3(0.42,0.13,0.09) * mix(1.0, 0.55, 1.0 - uCurse), lit);
        cc += vec3(0.07,0.06,0.06) * smoothstep(0.5, 0.9, c2) * lit;   // silver lining
        cc += vec3(0.35,0.35,0.45) * uFlash * 1.4;
        col = mix(col, cc, cl * 0.92);
      }
      col = mix(uFog, col, smoothstep(-0.06, 0.1, y));
      col += vec3(0.4,0.4,0.55) * uFlash * 0.3 * smoothstep(-0.1, 0.5, y);
      gl_FragColor = vec4(col, 1.0);
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 64, 32), skyMat);
sky.frustumCulled = false; sky.renderOrder = -10;
scene.add(sky);

// =====================================================================
// Post processing: scene -> ink outlines + moon shafts -> bloom -> tone map -> grade
// =====================================================================
const sceneRT = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: Q.msaa });
sceneRT.depthTexture = new THREE.DepthTexture(innerWidth, innerHeight);
sceneRT.depthTexture.type = THREE.UnsignedIntType;
const composer = new EffectComposer(renderer);
const inkPass = new ShaderPass({
  defines: { RAYS: Q.rays },
  uniforms: {
    tDiffuse: { value: null }, tScene: { value: null }, tDepth: { value: null },
    uRes: { value: new V2(1, 1) }, uNear: { value: camera.near }, uFar: { value: camera.far },
    uMoonUV: { value: new V2(0.5, 0.8) }, uMoonVis: { value: 0 }, uRayCol: { value: new THREE.Color(1.0, 0.32, 0.22) }, uInk: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tScene, tDepth; uniform vec2 uRes, uMoonUV; uniform float uNear, uFar, uMoonVis, uInk; uniform vec3 uRayCol;
    varying vec2 vUv;
    float lin(vec2 uv){ float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
    void main(){
      vec3 col = texture2D(tScene, vUv).rgb;
      // ---- ink contour from depth discontinuities ----
      vec2 px = 1.0 / uRes;
      float c = lin(vUv);
      float l = lin(vUv - vec2(px.x, 0.0)), r = lin(vUv + vec2(px.x, 0.0));
      float u = lin(vUv + vec2(0.0, px.y)), d = lin(vUv - vec2(0.0, px.y));
      float lap = abs(l + r + u + d - 4.0 * c) / max(c, 0.2);
      float edge = smoothstep(0.03, 0.11, lap) * (1.0 - smoothstep(18.0, 60.0, c));
      col = mix(col, col * 0.08, edge * 0.8 * uInk);
      // ---- moon shafts through branches ----
      if (uMoonVis > 0.001) {
        vec2 dir = (uMoonUV - vUv);
        vec2 st = dir / float(RAYS);
        vec2 uv = vUv; float illum = 0.0, decay = 1.0;
        for (int i = 0; i < RAYS; i++) {
          uv += st;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
          float sky = step(0.99999, texture2D(tDepth, uv).x);
          illum += sky * min(dot(texture2D(tScene, uv).rgb, vec3(0.33)), 3.0) * decay;
          decay *= 0.955;
        }
        col += uRayCol * illum / float(RAYS) * uMoonVis * 0.55 * smoothstep(1.3, 0.0, length(dir * vec2(uRes.x / uRes.y, 1.0)));
      }
      gl_FragColor = vec4(col, 1.0);
    }`
});
inkPass.uniforms.tScene.value = sceneRT.texture; inkPass.uniforms.tDepth.value = sceneRT.depthTexture;
composer.addPass(inkPass);
const bloom = new UnrealBloomPass(new V2(innerWidth, innerHeight), 0.75, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uSat: { value: 1 }, uRes: { value: new V2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uHurt, uSat; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    void main(){
      vec2 q = vUv - 0.5;
      float ab = 0.0012 + uHurt * 0.006;
      vec3 c; c.r = texture2D(tDiffuse, vUv + q * ab).r; c.g = texture2D(tDiffuse, vUv).g; c.b = texture2D(tDiffuse, vUv - q * ab).b;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      // keep only the meaningful colours: blood, soul-fire, flame. Everything else drifts toward ash.
      float red  = smoothstep(0.02, 0.2, c.r - max(c.g, c.b) * 1.1);
      float cyan = smoothstep(0.02, 0.2, c.b - c.r);
      float warm = smoothstep(0.04, 0.25, c.r - c.b) * (1.0 - red);
      float sat = mix(0.28, 1.12, max(max(red, cyan), warm * 0.85)) * uSat;
      c = mix(vec3(l), c, sat);
      c = mix(c, c * vec3(0.86, 0.93, 1.1), (1.0 - smoothstep(0.0, 0.35, l)) * 0.55);
      c = mix(c, c * vec3(1.06, 1.0, 0.9), smoothstep(0.35, 1.0, l) * 0.6);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.45);
      // paper tooth + fine grain
      vec2 pp = vUv * uRes;
      float paper = n2(pp * 0.35) * 0.6 + n2(pp * 0.09) * 0.4;
      c *= 0.94 + paper * 0.08;
      c += (h(pp + fract(uTime * 7.0) * 100.0) - 0.5) * 0.028;
      // burnt-edge vignette
      float v = length(q * vec2(1.0, 1.15)) + (n2(vUv * 7.0) - 0.5) * 0.12;
      c *= 1.0 - smoothstep(0.42, 0.88, v) * 0.88;
      c = mix(c, vec3(0.25, 0.0, 0.0) * (0.4 + l), uHurt * smoothstep(0.25, 0.8, v));
      gl_FragColor = vec4(c, 1.0);
    }`
});
composer.addPass(gradePass);

function onResize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h; camera.fov = camera.aspect < 1 ? 74 : 58; camera.updateProjectionMatrix();
  renderer.setSize(w, h); composer.setSize(w, h);
  const pr = renderer.getPixelRatio();
  sceneRT.setSize(w * pr, h * pr);
  inkPass.uniforms.uRes.value.set(w * pr, h * pr); gradePass.uniforms.uRes.value.set(w * pr, h * pr);
  if (typeof fx !== 'undefined') for (const p of [fx, fxDark]) p.mat.uniforms.uScale.value = h * pr / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}
const _mv = new V3();
function renderFrame() {
  // moon shafts: where is the moon on screen?
  _mv.copy(moonDir).multiplyScalar(1000).add(camera.position).project(camera);
  const vis = _mv.z < 1 ? (1 - ss(0.9, 1.6, Math.max(Math.abs(_mv.x), Math.abs(_mv.y)))) : 0;
  inkPass.uniforms.uMoonUV.value.set(_mv.x * 0.5 + 0.5, _mv.y * 0.5 + 0.5);
  inkPass.uniforms.uMoonVis.value = vis * skyMat.uniforms.uCurse.value + vis * 0.4;
  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  composer.render();
}
