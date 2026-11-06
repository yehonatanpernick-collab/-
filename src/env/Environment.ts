import * as THREE from 'three/webgpu';
import {
  abs, clamp, exp, float, fog, length, max, mix, mod, mx_noise_float, normalize, positionLocal, positionView, positionWorld,
  smoothstep, time, uniform, vec3, cameraPosition, uv, select,
} from 'three/tsl';
import { SkyMesh } from 'three/examples/jsm/objects/SkyMesh.js';
import { U, absPos } from '../core/Uniforms';
import { waterMaterial } from '../world/Materials';
import type { WorldData } from '../data/WorldData';

export type Weather = 'clear' | 'cloudy' | 'foggy' | 'rain';
export const WEATHERS: Weather[] = ['clear', 'cloudy', 'foggy', 'rain'];
export const TIME_PRESETS: { name: string; h: number }[] = [
  { name: 'Morning', h: 7.6 }, { name: 'Afternoon', h: 14.0 }, { name: 'Golden Hour', h: 18.3 }, { name: 'Sunset', h: 19.15 }, { name: 'Night', h: 22.5 },
];

interface WeatherParams { clouds: number; cloudDensity: number; fog: number; coast: number; turbidity: number; rain: number; sun: number; wet: number }
const WP: Record<Weather, WeatherParams> = {
  clear: { clouds: 0.18, cloudDensity: 0.35, fog: 0.00004, coast: 0.45, turbidity: 2.2, rain: 0, sun: 1, wet: 0 },
  cloudy: { clouds: 0.62, cloudDensity: 0.7, fog: 0.00013, coast: 1.2, turbidity: 6, rain: 0, sun: 0.45, wet: 0 },
  foggy: { clouds: 0.85, cloudDensity: 0.9, fog: 0.0011, coast: 5.0, turbidity: 10, rain: 0, sun: 0.3, wet: 0.15 },
  rain: { clouds: 0.95, cloudDensity: 1.0, fog: 0.00045, coast: 2.0, turbidity: 12, rain: 1, sun: 0.18, wet: 1 },
};

/**
 * Environment system: physically-based sky with clouds, sun/moon lighting with shadows,
 * HDR environment reflections regenerated from the sky, spatially varying San Francisco fog
 * (thicker along the Pacific coast and through the Golden Gate), dynamic time of day,
 * smooth weather transitions, rain and the bay/ocean water surface.
 */
export class Environment {
  sky: SkyMesh;
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbfd6ff, 0x55504a, 0.6);
  water!: THREE.Mesh;
  hour = 17.6;
  timeSpeed = 0; // game hours per real second (0 = frozen)
  weather: Weather = 'clear';
  private cur: WeatherParams = { ...WP.clear };
  private envScene = new THREE.Scene();
  private envSky: SkyMesh;
  private pmrem!: THREE.PMREMGenerator;
  private envRT: THREE.RenderTarget | null = null;
  private envTimer = 0;
  private lastEnvKey = '';
  private rain!: THREE.LineSegments;
  private stars!: THREE.Points;
  private fogDome!: THREE.Mesh;
  private rainU = uniform(0);
  sunDir = new THREE.Vector3();
  night = 0;
  shadowRange = 150;
  exposureBase = 0.42;

  constructor(private scene: THREE.Scene, private worldRoot: THREE.Group, private renderer: THREE.WebGPURenderer, private world: WorldData, waterNormals: THREE.Texture, rainDrops: number) {
    this.sky = new SkyMesh();
    this.sky.scale.setScalar(20000);
    (this.sky.material as THREE.NodeMaterial).fog = false;
    scene.add(this.sky);
    this.envSky = new SkyMesh();
    this.envSky.scale.setScalar(100);
    this.envSky.showSunDisc.value = 0;
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    worldRoot.add(this.sun, this.sun.target);
    scene.add(this.hemi);

    // fog: exponential height fog × spatial coastal density × drifting patches
    const p: any = absPos;
    const dist: any = length(positionView);
    const H: any = U.fogHeight;
    const yc: any = U.camPosAbs.y;
    const yp: any = p.y;
    const dy: any = yp.sub(yc);
    const fc: any = exp(max(yc, -50).negate().div(H));
    const fp: any = exp(max(yp, -50).negate().div(H));
    const avg: any = select(abs(dy).greaterThan(1.0), fc.sub(fp).mul(H).div(dy), fc);
    // Karl the fog: Pacific coast (west), Golden Gate strait and Presidio/Marina waterfront
    const ggx = -6200, ggz = -3600;
    const ggd: any = length(p.xz.sub(vec3(ggx, ggz, 0).xy)).div(2600);
    const west: any = smoothstep(-2500, -9500, p.x);
    const gg: any = exp(ggd.mul(ggd).negate());
    const north: any = smoothstep(-1500, -4200, p.z).mul(smoothstep(2000, -5000, p.x));
    const patches: any = mx_noise_float(vec3(p.x.mul(0.0006).add(time.mul(0.004)), p.z.mul(0.0006), time.mul(0.001))).mul(0.5).add(0.5);
    const spatial: any = float(1).add(U.coastFog.mul(west.add(gg.mul(1.4)).add(north.mul(0.6))).mul(mix(0.55, 1.35, patches)));
    const factor: any = clamp(float(1).sub(exp(U.fogDensity.mul(avg).mul(spatial).mul(dist).negate())), 0, 1);
    scene.fogNode = fog(U.fogColor, factor);

    // fog dome: blends the sky into the fog colour near the horizon in thick fog
    const domeG = new THREE.SphereGeometry(15000, 32, 16);
    const domeM = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, fog: false });
    const dirY: any = normalize(positionLocal).y;
    const dens: any = clamp(U.fogDensity.mul(1400), 0, 1);
    domeM.colorNode = U.fogColor;
    domeM.opacityNode = clamp(smoothstep(0.35, -0.02, dirY).mul(dens.add(0.15)).add(dens.mul(0.6)), 0, 0.97);
    this.fogDome = new THREE.Mesh(domeG, domeM);
    this.fogDome.renderOrder = -1;
    this.fogDome.frustumCulled = false;
    scene.add(this.fogDome);

    this.buildWater(waterNormals);
    this.buildRain(rainDrops);
    this.buildStars();
    this.setWeather('clear', true);
  }

  private buildWater(normals: THREE.Texture): void {
    const g = this.world.meta.grid;
    // heightmap texture (half float, linear filtering) for depth-aware water colour and shoreline foam
    const hf = new Uint16Array(g.w * g.h);
    for (let i = 0; i < hf.length; i++) hf[i] = THREE.DataUtils.toHalfFloat(this.world.heights[i]);
    const ht = new THREE.DataTexture(hf, g.w, g.h, THREE.RedFormat, THREE.HalfFloatType);
    ht.magFilter = THREE.LinearFilter; ht.minFilter = THREE.LinearFilter; ht.needsUpdate = true;
    ht.wrapS = ht.wrapT = THREE.ClampToEdgeWrapping;
    const geo = new THREE.PlaneGeometry(60000, 60000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, waterMaterial(normals, ht, g));
    this.water.receiveShadow = true;
    this.water.renderOrder = 0;
    this.worldRoot.add(this.water);
  }

  private buildRain(n: number): void {
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 80, y = Math.random() * 50, z = Math.random() * 80;
      pos.set([x, y, z, x + 0.05, y + 0.75, z + 0.02], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false });
    const box: any = vec3(80, 50, 80);
    const fall: any = vec3(time.mul(1.6), time.mul(-19), time.mul(0.6));
    const local: any = mod(positionLocal.add(fall).sub(cameraPosition), box).sub(box.mul(0.5)).add(cameraPosition);
    m.positionNode = local;
    m.colorNode = vec3(0.75, 0.8, 0.85);
    m.opacityNode = this.rainU.mul(0.35);
    this.rain = new THREE.LineSegments(g, m);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  private buildStars(): void {
    const n = 2500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.9 + 0.05;
      v.normalize().multiplyScalar(14000);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, sizeAttenuation: false, size: 2, fog: false });
    m.colorNode = vec3(1, 1, 1);
    m.opacityNode = U.night.mul(float(1).sub(U.fogDensity.mul(2500)).max(0)).mul(0.9);
    this.stars = new THREE.Points(g, m);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
    void uv; void positionWorld;
  }

  setWeather(w: Weather, instant = false): void {
    this.weather = w;
    if (instant) this.cur = { ...WP[w] };
  }

  cycleWeather(): Weather { const i = (WEATHERS.indexOf(this.weather) + 1) % WEATHERS.length; this.setWeather(WEATHERS[i]); return WEATHERS[i]; }

  /** sun direction for the given local hour at San Francisco (37.8°N), summer declination */
  private computeSun(h: number, out: THREE.Vector3): void {
    const lat = (37.78 * Math.PI) / 180, decl = (21 * Math.PI) / 180;
    const ha = ((h - 13.2) / 24) * Math.PI * 2; // solar noon ~13:10 PDT
    const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
    const el = Math.asin(sinEl);
    const cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat));
    let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    if (ha > 0) az = Math.PI * 2 - az; // afternoon: west
    // azimuth from north clockwise → world (x east, z south)
    out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  }

  update(dt: number, camAbs: THREE.Vector3, playerAbs: THREE.Vector3, origin: THREE.Vector3): void {
    this.hour = (this.hour + dt * this.timeSpeed + 24) % 24;
    const target = WP[this.weather];
    const k = 1 - Math.exp(-dt * 0.5);
    for (const key of Object.keys(target) as (keyof WeatherParams)[]) this.cur[key] += (target[key] - this.cur[key]) * k;
    const c = this.cur;

    this.computeSun(this.hour, this.sunDir);
    const el = this.sunDir.y;
    const day = THREE.MathUtils.smoothstep(el, -0.1, 0.08);
    this.night = 1 - THREE.MathUtils.smoothstep(el, -0.16, 0.02);
    const golden = (1 - THREE.MathUtils.smoothstep(el, 0.03, 0.4)) * day;

    // sky
    const sunPos = this.sunDir.clone().multiplyScalar(10000);
    for (const s of [this.sky, this.envSky]) {
      s.sunPosition.value.copy(sunPos);
      s.turbidity.value = c.turbidity;
      s.rayleigh.value = 1.2 + golden * 1.5 - c.clouds * 0.6;
      s.mieCoefficient.value = 0.0025 + c.clouds * 0.004;
      s.mieDirectionalG.value = 0.8;
      s.cloudCoverage.value = c.clouds;
      s.cloudDensity.value = c.cloudDensity;
      s.cloudElevation.value = 0.55;
    }
    this.sky.position.set(0, 0, 0);

    // lights
    const sunCol = new THREE.Color().setRGB(1, 0.96 - golden * 0.28, 0.9 - golden * 0.5);
    const moon = this.night;
    if (el > -0.05) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 6.5 * day * c.sun;
      this.sun.position.copy(this.sunDir);
    } else {
      this.sun.color.setRGB(0.55, 0.65, 0.9);
      this.sun.intensity = 0.28 * moon * (0.4 + c.sun * 0.6);
      this.sun.position.set(-this.sunDir.x, Math.max(0.4, -this.sunDir.y), -this.sunDir.z).normalize();
    }
    const dir = this.sun.position.clone().normalize();
    // shadow frustum follows the player, snapped to texels to avoid shimmering
    const sr = this.shadowRange;
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -sr; cam.right = sr; cam.top = sr; cam.bottom = -sr; cam.near = 1; cam.far = 4000; cam.updateProjectionMatrix();
    const texel = (2 * sr) / this.sun.shadow.mapSize.x;
    const tx = Math.round(playerAbs.x / texel) * texel, tz = Math.round(playerAbs.z / texel) * texel;
    this.sun.target.position.set(tx, playerAbs.y, tz);
    this.sun.position.set(tx + dir.x * 1500, playerAbs.y + dir.y * 1500, tz + dir.z * 1500);
    this.sun.target.updateMatrixWorld();

    this.hemi.intensity = (0.15 + day * 0.3) * (0.7 + c.clouds * 0.6) + moon * 0.45;
    this.hemi.color.setRGB(0.62 + golden * 0.25, 0.72, 0.9 - golden * 0.2).multiplyScalar(day + 0.15).lerp(new THREE.Color(0.32, 0.38, 0.58), moon);
    this.hemi.groundColor.setRGB(0.32, 0.29, 0.26).multiplyScalar(day + 0.1).lerp(new THREE.Color(0.22, 0.17, 0.12), moon * 0.6);

    // fog
    const fogDay = new THREE.Color().setRGB(0.70, 0.78, 0.86).lerp(new THREE.Color(0.78, 0.8, 0.82), c.clouds);
    const fogGold = new THREE.Color(0.95, 0.72, 0.55);
    const fogNight = new THREE.Color(0.05, 0.065, 0.1);
    const fogCol = fogDay.clone().lerp(fogGold, golden * (1 - c.clouds * 0.7)).lerp(fogNight, this.night);
    U.fogColor.value.copy(fogCol);
    U.fogDensity.value = c.fog;
    U.coastFog.value = c.coast;
    U.fogHeight.value = this.weather === 'foggy' ? 140 : 260;
    U.camPosAbs.value.copy(camAbs);
    U.night.value = this.night;
    U.lampIntensity.value = THREE.MathUtils.smoothstep(this.night, 0.2, 0.7) + c.rain * 0.3 * day * 0;
    U.wet.value = c.wet;
    U.rain.value = c.rain;
    U.sunDir.value.copy(this.sunDir);
    this.rainU.value = c.rain;
    this.rain.visible = c.rain > 0.02;

    // exposure: brighter at night, compensated under heavy clouds
    this.renderer.toneMappingExposure = this.exposureBase * THREE.MathUtils.lerp(1.0, 1.15, golden) * (1 + this.night * 2.5) * (1 + c.clouds * 0.35);
    this.scene.environmentIntensity = (0.1 + day * 0.28) * (1 - c.rain * 0.3) + this.night * 0.05;

    // keep sky & helpers centred on the camera (camera-relative space)
    const camRel = camAbs.clone().sub(origin);
    this.sky.position.copy(camRel);
    this.fogDome.position.copy(camRel);
    this.stars.position.copy(camRel);
    // water plane follows the camera (snapped)
    this.water.position.set(Math.round(camAbs.x / 200) * 200, 0, Math.round(camAbs.z / 200) * 200);

    // regenerate environment reflections when the sky changed noticeably
    this.envTimer -= dt;
    const key = `${this.hour.toFixed(1)}_${c.clouds.toFixed(2)}_${c.turbidity.toFixed(0)}`;
    if (this.envTimer <= 0 && key !== this.lastEnvKey) {
      this.lastEnvKey = key;
      this.envTimer = 1.5;
      this.regenEnv();
    }
  }

  regenEnv(): void {
    try {
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    } catch (e) { console.warn('env regen failed', e); }
  }
}
