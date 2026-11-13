// Sky, sun/moon lighting, image-based ambient, clouds and stars, driven by time of day + weather.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { ATMO, setSun, setSkyColors } from './atmosphere.js';

const CLOUD_VS = /* glsl */`
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const CLOUD_FS = /* glsl */`
uniform float uTime, uCover, uDark;
uniform vec3 uSunDir, uSunCol, uAmb;
uniform vec2 uWind;
varying vec3 vW;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 6; i++) { s += a * noise(p); p = m * p; a *= 0.5; } return s; }
float density(vec2 p) {
  float base = fbm(p * 0.00011 + uWind * uTime * 0.00001);
  float det = fbm(p * 0.0006 - uWind * uTime * 0.00003);
  float d = base * 0.75 + det * 0.35;
  return smoothstep(1.0 - uCover, 1.0 - uCover + 0.32, d);
}
void main() {
  vec3 dir = normalize(vW - cameraPosition);
  if (dir.y < 0.0) discard;
  float d = density(vW.xz);
  if (d < 0.01) discard;
  // cheap self-shadowing: march two samples toward the sun
  vec2 toSun = normalize(uSunDir.xz + 1e-4) * 900.0;
  float s1 = density(vW.xz + toSun), s2 = density(vW.xz + toSun * 2.2);
  float light = exp(-(s1 + s2 * 0.7) * 1.6);
  float silver = pow(max(dot(dir, uSunDir), 0.0), 12.0) * 1.2;
  vec3 col = uAmb * (0.75 + 0.25 * (1.0 - d)) + uSunCol * (light * 0.85 + silver * (1.0 - d));
  col *= mix(1.0, 0.45, uDark);
  float horizonFade = smoothstep(0.0, 0.08, dir.y);
  gl_FragColor = vec4(col, d * horizonFade * 0.96);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SkySystem {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.time = 10.5;           // hours
    this.dayLength = 24 * 60;   // real seconds per in-game day (24 min)
    this.timeScale = 1;
    this.latitude = 46;         // deg, for sun path
    this.dayOfYear = 200;

    this.sky = new Sky();
    this.sky.scale.setScalar(45000);
    this.sky.material.uniforms.turbidity.value = 4;
    this.sky.material.uniforms.rayleigh.value = 1.4;
    this.sky.material.uniforms.mieCoefficient.value = 0.004;
    this.sky.material.uniforms.mieDirectionalG.value = 0.8;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = false;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x5a5040, 0.5);
    scene.add(this.hemi);

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sunColor = new THREE.Color();

    // environment (reflections + ambient) from the sky itself
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this._envDir = new THREE.Vector3(9, 9, 9);
    this._envRT = null;

    // clouds: a 60 km plane at ~4.6 km that follows the camera (UVs are world-space)
    this.cloudUniforms = {
      uTime: { value: 0 }, uCover: { value: 0.35 }, uDark: { value: 0 },
      uSunDir: { value: this.sunDir }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
      uWind: { value: new THREE.Vector2(1, 0.4) },
    };
    const cg = new THREE.PlaneGeometry(90000, 90000, 1, 1);
    cg.rotateX(Math.PI / 2);
    this.clouds = new THREE.Mesh(cg, new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms, vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -1;
    scene.add(this.clouds);

    // stars
    const n = 2500, sp = new Float32Array(n * 3), r = 40000;
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, q = Math.sqrt(1 - u * u);
      sp[i * 3] = q * Math.cos(t) * r; sp[i * 3 + 1] = Math.abs(u) * r; sp[i * 3 + 2] = q * Math.sin(t) * r;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.weather = { cover: 0.35, dark: 0, fogBoost: 0 };
  }

  // solar position for latitude / day-of-year / hour (good enough for lighting)
  _solar(hours) {
    const decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + this.dayOfYear) / 365);
    const lat = this.latitude * Math.PI / 180;
    const ha = (hours - 12) * 15 * Math.PI / 180;
    const alt = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha));
    let az = Math.acos((Math.sin(decl) - Math.sin(alt) * Math.sin(lat)) / (Math.cos(alt) * Math.cos(lat)));
    if (ha > 0) az = 2 * Math.PI - az; // az from north, clockwise
    // world: -z = north, +x = east
    return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
  }

  update(dt, camera, focus) {
    this.time = (this.time + dt * this.timeScale * 24 / this.dayLength) % 24;
    const s = this._solar(this.time);
    this.sunDir.copy(s);
    const elev = s.y;
    // moon roughly opposite
    const night = THREE.MathUtils.smoothstep(0.05, -0.12, elev);
    const lightDir = night > 0.5 ? s.clone().negate().setY(Math.max(0.25, -s.y)) .normalize() : s.clone();
    if (lightDir.y < 0.04) lightDir.y = 0.04;
    lightDir.normalize();

    // sun colour: warm near the horizon, white high up; dimmed by weather
    const warm = THREE.MathUtils.smoothstep(0.35, 0.0, elev);
    this.sunColor.setRGB(1.0, 0.93 - 0.35 * warm, 0.84 - 0.6 * warm);
    const dayK = THREE.MathUtils.smoothstep(-0.05, 0.12, elev);
    const wDim = 1 - 0.75 * this.weather.dark;
    this.sun.intensity = (3.1 * dayK + 0.12 * night) * wDim;
    this.sun.color.copy(night > 0.5 ? new THREE.Color(0.55, 0.65, 0.9) : this.sunColor);
    this.hemi.intensity = (0.35 + 0.35 * dayK) * (0.4 + 0.6 * dayK) + 0.04;
    this.hemi.color.setRGB(0.62 + 0.1 * warm, 0.72, 0.9 - 0.1 * warm).multiplyScalar(0.5 + 0.5 * dayK);
    this.hemi.groundColor.setRGB(0.36, 0.32, 0.25).multiplyScalar(0.4 + 0.6 * dayK);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(s);
    u.turbidity.value = 2.4 + 9 * this.weather.dark;
    u.rayleigh.value = 2.1 + 1.2 * warm;
    u.mieCoefficient.value = 0.0032 + 0.01 * this.weather.dark;
    // fog / horizon colours
    const hz = new THREE.Color(0.66, 0.76, 0.88).lerp(new THREE.Color(0.95, 0.62, 0.38), warm * 0.75).multiplyScalar(0.15 + 0.85 * dayK);
    hz.lerp(new THREE.Color(0.62, 0.64, 0.66).multiplyScalar(0.2 + 0.8 * dayK), this.weather.dark * 0.85);
    const zn = new THREE.Color(0.26, 0.44, 0.74).lerp(new THREE.Color(0.35, 0.38, 0.5), warm * 0.5).multiplyScalar(0.08 + 0.92 * dayK);
    zn.lerp(hz, this.weather.dark * 0.7);
    setSkyColors(hz, zn);
    setSun(s.y > -0.05 ? s : lightDir, this.sunColor.clone().multiplyScalar(dayK * wDim));

    // directional light follows the focus (shadow cascades are set up elsewhere)
    const f = focus || camera.position;
    this.sun.position.copy(f).addScaledVector(lightDir, 2000);
    this.sun.target.position.copy(f);
    this.lightDir = lightDir;

    // clouds
    this.cloudUniforms.uTime.value += dt;
    this.cloudUniforms.uCover.value = THREE.MathUtils.lerp(this.cloudUniforms.uCover.value, this.weather.cover, Math.min(1, dt * 0.2));
    this.cloudUniforms.uDark.value = this.weather.dark;
    this.cloudUniforms.uSunCol.value.copy(this.sunColor).multiplyScalar(1.4 * dayK + 0.05);
    this.cloudUniforms.uAmb.value.copy(hz).multiplyScalar(0.85).lerp(zn, 0.3);
    this.clouds.position.set(camera.position.x, 4600, camera.position.z);
    this.stars.position.copy(camera.position);
    this.stars.material.opacity = night * (1 - this.weather.cover);
    this.sky.position.copy(camera.position);

    // refresh the environment map when the sun has moved noticeably
    if (this._envDir.distanceTo(s) > 0.02 || this._envDark !== this.weather.dark) {
      this._envDir.copy(s); this._envDark = this.weather.dark;
      const eu = this.envSky.material.uniforms;
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[k].value = u[k].value;
      eu.sunPosition.value.copy(s);
      const rt = this.pmrem.fromScene(this.envScene, 0.04);
      if (this._envRT) this._envRT.dispose();
      this._envRT = rt;
      this.scene.environment = rt.texture;
    }
    return { dayK, night, elev };
  }
}
