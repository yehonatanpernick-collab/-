import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Height fog + aerial perspective + screen-space light shafts, driven by the scene depth buffer.
export class AtmospherePass extends Pass {
  constructor(camera, depthTexture, rays = true) {
    super();
    this.camera = camera;
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: depthTexture },
      uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.01 }, uFogBase: { value: 0 }, uFogFalloff: { value: 0.05 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uSunScreen: { value: new THREE.Vector2() },
      uRays: { value: 0.5 }, uSunVis: { value: 0 }, uScatter: { value: 0.6 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, depthTest: false, depthWrite: false,
      defines: { RAYS: rays ? 1 : 0 },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse, tDepth; uniform mat4 uProjInv, uViewInv; uniform vec3 uCamPos, uFogColor, uSunDir, uSunColor;
        uniform float uFogDensity, uFogBase, uFogFalloff, uRays, uSunVis, uScatter; uniform vec2 uSunScreen; varying vec2 vUv;
        vec3 worldAt(vec2 uv, float d){ vec4 v = uProjInv * vec4(uv*2.-1., d*2.-1., 1.); v /= v.w; return (uViewInv * v).xyz; }
        void main(){
          vec4 col = texture2D(tDiffuse, vUv); float d = texture2D(tDepth, vUv).x;
          vec3 wp = worldAt(vUv, d); vec3 rd = wp - uCamPos; float dist = length(rd); rd /= dist;
          float sky = step(0.99999, d);
          if (sky > 0.5) dist = 600.;
          // analytic exponential height fog
          float camH = uCamPos.y - uFogBase;
          float k = uFogFalloff;
          float fogAmt = uFogDensity * exp(-camH * k) * (1. - exp(-dist * rd.y * k)) / max(abs(rd.y * k), 1e-4) * sign(rd.y + 1e-5);
          if (abs(rd.y) < 1e-3) fogAmt = uFogDensity * exp(-camH * k) * dist;
          float f = 1. - exp(-max(fogAmt, 0.));
          float sunAmt = pow(max(dot(rd, uSunDir), 0.), 8.);
          vec3 fogCol = mix(uFogColor, uSunColor, sunAmt * uScatter);
          if (sky > 0.5) f *= smoothstep(0.35, -0.02, rd.y) * 0.85;
          col.rgb = mix(col.rgb, fogCol, clamp(f, 0., 1.));
          #if RAYS
          if (uSunVis > 0.001) {
            vec2 dir = (uSunScreen - vUv); float acc = 0.; float w = 1.; vec2 p = vUv;
            vec2 stepv = dir / 24. * 0.9;
            for (int i = 0; i < 24; i++) { p += stepv; float s = step(0.99999, texture2D(tDepth, clamp(p, 0.001, 0.999)).x); acc += s * w; w *= 0.94; }
            acc /= 12.;
            float fall = 1. - smoothstep(0.0, 0.9, length(dir));
            col.rgb += uSunColor * acc * uRays * uSunVis * fall * (1. - sky * 0.6);
          }
          #endif
          gl_FragColor = col;
        }`,
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this._v = new THREE.Vector3();
  }
  update(sunDir) {
    const c = this.camera, u = this.uniforms;
    u.uProjInv.value.copy(c.projectionMatrixInverse); u.uViewInv.value.copy(c.matrixWorld); u.uCamPos.value.copy(c.position);
    u.uSunDir.value.copy(sunDir);
    const v = this._v.copy(c.position).addScaledVector(sunDir, 500).project(c);
    u.uSunScreen.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion).dot(sunDir);
    u.uSunVis.value = v.z < 1 ? THREE.MathUtils.smoothstep(facing, 0.1, 0.6) : 0;
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}

// Color grading in linear HDR (before tone mapping): white balance, saturation, contrast, vignette, grain.
export class GradePass extends Pass {
  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null }, uTime: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) }, uShadowTint: { value: new THREE.Color(1, 1, 1) },
      uSat: { value: 1.1 }, uContrast: { value: 1.08 }, uVignette: { value: 0.35 }, uGrain: { value: 0.025 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 1, 1) },
      uDamage: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, depthTest: false, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uTime, uSat, uContrast, uVignette, uGrain, uFlash, uDamage; uniform vec3 uTint, uShadowTint, uFlashColor; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c *= mix(uShadowTint, uTint, smoothstep(0.0, 0.6, l));
          l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, uSat);
          vec3 lc = log2(max(c, 1e-5) / 0.18); c = 0.18 * exp2(lc * uContrast);
          vec2 q = vUv - 0.5; float v = 1. - dot(q, q) * 2.2 * uVignette; c *= clamp(v, 0., 1.);
          c = mix(c, c * vec3(1.4, 0.3, 0.3), uDamage * smoothstep(0.15, 0.75, length(q)));
          c += uFlashColor * uFlash;
          c += (hash(vUv * 1000. + fract(uTime) * 100.) - 0.5) * uGrain * (0.3 + l);
          gl_FragColor = vec4(max(c, 0.), 1.);
        }`,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
}
