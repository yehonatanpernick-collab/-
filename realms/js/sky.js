import * as THREE from 'three';
import * as A from './assets.js';

export class Sky {
  constructor(scene, def, noise) {
    const u = this.u = {
      uTop: { value: new THREE.Color(def.top) }, uHorizon: { value: new THREE.Color(def.horizon) }, uGround: { value: new THREE.Color(def.ground || def.horizon) },
      uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color(def.sunDisc || '#fff4dc') }, uSunSize: { value: def.sunSize ?? 1 },
      uMoon: { value: def.moon ? 1 : 0 }, uMoonDir: { value: new THREE.Vector3(...(def.moonDir || [-0.4, 0.45, -0.8])).normalize() }, uMoonCol: { value: new THREE.Color(def.moonCol || '#ffe6d8') },
      uStars: { value: def.stars || 0 }, uClouds: { value: def.clouds ?? 0.5 }, uCloudCol: { value: new THREE.Color(def.cloudCol || '#ffffff') }, uCloudShade: { value: new THREE.Color(def.cloudShade || '#8090a8') },
      uTime: { value: 0 }, tNoise: { value: noise }, uAurora: { value: def.aurora || 0 }, uAuroraCol: { value: new THREE.Color(def.auroraCol || '#40ffb0') },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u, side: THREE.BackSide, depthWrite: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uTop, uHorizon, uGround, uSunDir, uSunCol, uMoonDir, uMoonCol, uCloudCol, uCloudShade, uAuroraCol; uniform float uSunSize, uMoon, uStars, uClouds, uTime, uAurora; uniform sampler2D tNoise; varying vec3 vDir;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
        float fbm(vec2 p){ float a = 0.5, s = 0.; for (int i = 0; i < 5; i++) { s += a * texture2D(tNoise, p).r; p = p * 2.03 + 0.17; a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir); float h = d.y;
          vec3 c = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.75, h), 0.6));
          c = mix(c, uGround, smoothstep(0.0, -0.25, h));
          float s = max(dot(d, uSunDir), 0.);
          c += uSunCol * (pow(s, 6.) * 0.25 + pow(s, 64.) * 0.6) ;
          c += uSunCol * smoothstep(1. - 0.00012 * uSunSize, 1. - 0.00004 * uSunSize, s) * 30.;
          // haze band near horizon
          c = mix(c, uHorizon * 1.05, smoothstep(0.25, 0.0, abs(h)) * 0.35);
          // stars
          vec3 sp = floor(d * 300.); float st = step(0.9975, hash(sp)) * smoothstep(0.02, 0.35, h);
          c += vec3(st * uStars * (0.6 + 0.4 * sin(uTime * 2. + hash(sp + 3.) * 60.)) * 2.5);
          // moon
          if (uMoon > 0.) { float m = dot(d, uMoonDir); float disc = smoothstep(0.99935, 0.9995, m);
            float cr = texture2D(tNoise, (d.xy - uMoonDir.xy) * 18.).r;
            c = mix(c, uMoonCol * (2.2 + cr * 1.2), disc); c += uMoonCol * pow(max(m, 0.), 90.) * 0.6 + uMoonCol * pow(max(m, 0.), 8.) * 0.08; }
          // aurora
          if (uAurora > 0.) { float band = fbm(vec2(d.x * 0.6 + uTime * 0.004, d.z * 0.3)) ; float a = smoothstep(0.12, 0.45, h) * smoothstep(0.85, 0.45, h);
            c += uAuroraCol * pow(smoothstep(0.45, 0.75, band), 2.) * a * uAurora * 1.5; }
          // clouds
          if (h > 0.0 && uClouds > 0.) {
            vec2 uv = d.xz / (h + 0.12) * 0.09 + vec2(uTime * 0.0035, uTime * 0.0012);
            float n = fbm(uv);
            float cov = smoothstep(1. - uClouds * 0.9, 1.05 - uClouds * 0.5, n);
            float thick = fbm(uv * 2.0 + 1.3);
            vec3 cc = mix(uCloudShade, uCloudCol, smoothstep(0.3, 0.8, thick) * 0.7 + 0.3 * pow(s, 3.));
            cc += uSunCol * pow(s, 10.) * 0.6 * (1. - cov);
            c = mix(c, cc, cov * smoothstep(0.0, 0.15, h) * 0.95);
          }
          gl_FragColor = vec4(c, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }
  update(t, cam, sunDir) { this.u.uTime.value = t; this.u.uSunDir.value.copy(sunDir); this.mesh.position.copy(cam.position); }
}

// Water / lava with depth from the terrain heightfield
export async function makeLiquid(scene, terrain, def) {
  const [nrm, lavaT, lavaC] = await Promise.all([A.tex('tex/waternormals.jpg', { srgb: false }), def.lava ? A.tex('tex/lavatile.jpg') : null, def.lava ? A.tex('tex/lavacloud.png', { srgb: false }) : null]);
  const u = {
    uTime: { value: 0 }, tN: { value: nrm }, tH: { value: terrain.dataTex }, uN: { value: terrain.N }, uSize: { value: terrain.size }, uLevel: { value: def.level },
    uShallow: { value: new THREE.Color(def.shallow || '#3a9a9a') }, uDeep: { value: new THREE.Color(def.deep || '#0b2a3a') }, uSky: { value: new THREE.Color(def.sky || '#9cc8e8') },
    uSunDir: { value: new THREE.Vector3() }, uSun: { value: new THREE.Color() }, uLava: { value: def.lava ? 1 : 0 }, tLava: { value: lavaT }, tLavaC: { value: lavaC },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: !def.lava,
    vertexShader: `uniform float uTime, uLava; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.);
      w.y += (sin(w.x * 0.25 + uTime * 0.9) + cos(w.z * 0.21 + uTime * 0.7)) * 0.05 * (1. - uLava); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime, uN, uSize, uLevel, uLava; uniform sampler2D tN, tH, tLava, tLavaC; uniform vec3 uShallow, uDeep, uSky, uSunDir, uSun; varying vec3 vW;
      void main(){
        vec2 g = (vW.xz + uSize * 0.5) / uSize; float th = texture2D(tH, g).x; float depth = max(uLevel - th, 0.);
        if (g.x < 0. || g.x > 1. || g.y < 0. || g.y > 1.) depth = 20.;
        vec3 V = normalize(cameraPosition - vW);
        if (uLava > 0.5) {
          vec2 uv = vW.xz * 0.06; vec4 n1 = texture2D(tLavaC, uv * 0.6 + vec2(uTime * 0.01, uTime * 0.006));
          vec2 tuv = uv + (n1.rg - 0.5) * 0.25 + vec2(uTime * 0.012, -uTime * 0.008);
          vec3 lc = texture2D(tLava, tuv).rgb; float heat = pow(dot(lc, vec3(0.5, 0.35, 0.15)), 1.6) * 3.2;
          vec3 col = lc * vec3(2.6, 1.2, 0.5) * (0.6 + heat) + vec3(1.6, 0.35, 0.05) * smoothstep(0.6, 0.0, depth) * (0.6 + 0.4 * sin(uTime * 2. + vW.x));
          gl_FragColor = vec4(col, 1.);
        } else {
          vec2 uv = vW.xz * 0.035;
          vec3 n1 = texture2D(tN, uv + vec2(uTime * 0.012, uTime * 0.008)).xzy * 2. - 1.;
          vec3 n2 = texture2D(tN, uv * 2.3 - vec2(uTime * 0.017, -uTime * 0.01)).xzy * 2. - 1.;
          vec3 N = normalize(vec3(0., 1., 0.) + (n1 + n2) * vec3(0.35, 0., 0.35));
          float fres = 0.02 + 0.98 * pow(1. - max(dot(N, V), 0.), 5.);
          vec3 body = mix(uShallow, uDeep, smoothstep(0., 4.5, depth));
          vec3 col = mix(body, uSky, fres);
          vec3 R = reflect(-V, N); col += uSun * pow(max(dot(R, uSunDir), 0.), 220.) * 6. + uSun * pow(max(dot(R, uSunDir), 0.), 18.) * 0.15;
          float foam = smoothstep(0.35, 0.0, depth + (n1.x * 0.15)) * (0.6 + 0.4 * sin(uTime * 1.5 + vW.x * 0.8 + vW.z * 0.5));
          col = mix(col, vec3(0.9, 0.95, 1.), foam * 0.6);
          float a = clamp(smoothstep(0.0, 1.6, depth) * 0.85 + fres * 0.5 + foam * 0.5, 0., 0.97);
          gl_FragColor = vec4(col, a);
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(terrain.size * 3, terrain.size * 3, 64, 64); geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat); m.position.y = def.level; m.renderOrder = 2; scene.add(m);
  return { mesh: m, u, update(t, sunDir, sun) { u.uTime.value = t; u.uSunDir.value.copy(sunDir); u.uSun.value.copy(sun.color).multiplyScalar(sun.intensity * 0.4); } };
}
