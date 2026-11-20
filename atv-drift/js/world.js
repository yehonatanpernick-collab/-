// Visual world: sky, light, terrain, ramps, water, scenery, checkpoints, coins, pads, props.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  GN, CELL, HALF, grid, WATER_LEVEL, ARENA, PARK, BOWL, LAKE, ROUTE,
  rampDefs, boostPads, scenery, fbm, smoothstep, roadDistance, terrainHeight, groundQuery, rng,
  TRACKS, DRIFTLOT, STUNT, HALFPIPE, HILLS, tireStacks, grandstands, trackNearest, waterAt, surfaceAt as TR_surface,
  MEGA, NSTUNT, CANYON, SPECIAL, stuntProps, trampolines, turntables,
  rawHeight as rawHeightAt, LOOKOUT, LAVA, PADS, ICE, MESA, MOON, CITY, highwayDist, VOLCANO, TROPIC, RANGE, rangeEnv, SALT, FOREST, shoreX, volcanoRoad, volcanoPoint, volcanoLane, coneH, altitudeOf, phiAtAlt, volcanoYaw,
} from './terrain.js';

// ------------------------------------------------------------------ textures
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}
function noiseFill(ctx, w, h, base, amp, scale = 1, seed = 1) {
  const img = ctx.createImageData(w, h);
  const R = rng(seed);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // tileable value noise via periodic sampling
    const n = 0.55 * tileNoise(x / w, y / h, 8 * scale) + 0.3 * tileNoise(x / w, y / h, 32 * scale) + 0.15 * R();
    const v = base + (n - 0.5) * amp;
    const i = (y * w + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
function tileNoise(u, v, f) {
  // periodic value noise on a torus
  const x = u * f, y = v * f;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h = (a, b) => {
    a = ((a % f) + f) % f; b = ((b % f) + f) % f;
    let s = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ (f * 7919);
    s = Math.imul(s ^ (s >>> 13), 1274126177);
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  };
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function makeTextures() {
  const T = {};
  T.sand = canvasTex(1024, 1024, (ctx, w, h) => {
    noiseFill(ctx, w, h, 205, 80, 1, 3);
    // ripples
    ctx.globalAlpha = 0.07; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    for (let k = 0; k < 18; k++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = k * (h / 18) + Math.sin(x / w * Math.PI * 4 + k) * 6;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const R = rng(9);
    for (let i = 0; i < 14000; i++) {                         // sand grains and tiny pebbles
      const v = 140 + R() * 110;
      ctx.fillStyle = `rgba(${v},${v * 0.92},${v * 0.8},${0.35 + R() * 0.45})`;
      ctx.fillRect(R() * w, R() * h, 1 + R() * 1.8, 1 + R() * 1.8);
    }
  });
  T.asphalt = canvasTex(512, 512, (ctx, w, h) => {
    noiseFill(ctx, w, h, 70, 40, 2, 5);
    const R = rng(11);
    for (let i = 0; i < 6000; i++) {
      const v = 60 + R() * 120;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.5})`;
      ctx.fillRect(R() * w, R() * h, 1.3, 1.3);
    }
  });
  T.chevron = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f2f0ea'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ff6a1a';
    for (let k = -1; k < 3; k++) {
      const y = k * h / 2;
      ctx.beginPath();
      ctx.moveTo(0, y + h * 0.25); ctx.lineTo(w / 2, y); ctx.lineTo(w, y + h * 0.25);
      ctx.lineTo(w, y + h * 0.5); ctx.lineTo(w / 2, y + h * 0.25); ctx.lineTo(0, y + h * 0.5);
      ctx.closePath(); ctx.fill();
    }
    const img = ctx.getImageData(0, 0, w, h); const R = rng(4);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (R() - 0.5) * 26;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  });
  T.concrete = canvasTex(512, 512, (ctx, w, h) => {
    noiseFill(ctx, w, h, 185, 45, 1, 7);
    ctx.strokeStyle = 'rgba(60,55,50,0.35)'; ctx.lineWidth = 2;
    for (let k = 0; k <= 4; k++) { ctx.beginPath(); ctx.moveTo(0, k * h / 4); ctx.lineTo(w, k * h / 4); ctx.stroke(); }
    for (let k = 0; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * w / 2, 0); ctx.lineTo(k * w / 2, h); ctx.stroke(); }
  });
  T.deck = canvasTex(256, 512, (ctx, w, h) => {
    noiseFill(ctx, w, h, 95, 40, 1, 13);
    ctx.fillStyle = '#ffcc22';
    ctx.fillRect(0, 0, 18, h); ctx.fillRect(w - 18, 0, 18, h);
  });
  T.qp = canvasTex(256, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2b7fd8'); g.addColorStop(1, '#1d5fae');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h); const R = rng(14);
    for (let i = 0; i < img.data.length; i += 4) { const n = (R() - 0.5) * 22; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, 10);
  });
  T.roller = canvasTex(256, 256, (ctx, w, h) => {
    noiseFill(ctx, w, h, 150, 60, 1, 21);
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] *= 1.15; img.data[i + 1] *= 0.92; img.data[i + 2] *= 0.7; }
    ctx.putImageData(img, 0, 0);
  });
  const containerTex = (hex, label) => canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = hex; ctx.fillRect(0, 0, w, h);
    // corrugation
    for (let x = 0; x < w; x += 8) { ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fillRect(x, 0, 3, h); ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x + 3, 0, 2, h); }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.78)'; ctx.font = '800 34px Rubik, Arial Black, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2);
    const img = ctx.getImageData(0, 0, w, h); const R = rng(label.length * 7 + 3);
    for (let i = 0; i < img.data.length; i += 4) { const n = (R() - 0.5) * 26; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    ctx.putImageData(img, 0, 0);
    // rust streaks
    ctx.fillStyle = 'rgba(120,60,20,0.18)';
    for (let k = 0; k < 7; k++) ctx.fillRect(R() * w, 10, 3 + R() * 6, h * (0.2 + R() * 0.5));
  });
  T.container0 = containerTex('#b3312a', 'CARGO');
  T.container1 = containerTex('#2a63a8', 'FREIGHT');
  T.container2 = containerTex('#d98a1c', 'HAULER');
  T.container3 = containerTex('#2f8a55', 'EXPRESS');
  // city buildings: window grids (a second emissive map makes some windows glow)
  const facade = (hex, seed) => {
    const mk = (lit) => canvasTex(256, 256, (ctx, w, h) => {
      const R = rng(seed);
      ctx.fillStyle = lit ? '#000' : hex; ctx.fillRect(0, 0, w, h);
      for (let y = 10; y < h - 10; y += 22) for (let x = 10; x < w - 10; x += 22) {
        const on = R() > 0.55;
        if (lit) { if (on) { ctx.fillStyle = R() > 0.5 ? '#ffd98a' : '#bfe6ff'; ctx.fillRect(x, y, 14, 14); } }
        else { ctx.fillStyle = on ? '#e9d9a8' : '#1f2b38'; ctx.fillRect(x, y, 14, 14); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x, y + 11, 14, 3); }
      }
      if (!lit) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let x = 0; x < w; x += 22) ctx.fillRect(x, 0, 2, h); }
    });
    return [mk(false), mk(true)];
  };
  [T.bldg0, T.bldg0e] = facade('#8e8478', 31);
  [T.bldg1, T.bldg1e] = facade('#6d7783', 32);
  [T.bldg2, T.bldg2e] = facade('#9a6f58', 33);
  T.roof = canvasTex(256, 256, (ctx, w, h) => {
    noiseFill(ctx, w, h, 96, 36, 2, 91);
    ctx.strokeStyle = '#f2c500'; ctx.lineWidth = 14; ctx.strokeRect(7, 7, w - 14, h - 14);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '900 120px Arial Black, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', w / 2, h / 2);
  });
  // parked cars used as obstacles
  const carTex = (hex) => canvasTex(128, 64, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0.14)');
    ctx.fillStyle = hex; ctx.fillRect(0, 0, w, h); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(w / 2 - 1, 4, 2, h - 8);                       // door seam
    ctx.fillStyle = '#ffe9a8'; ctx.fillRect(4, 18, 12, 10); ctx.fillStyle = '#c1262a'; ctx.fillRect(w - 16, 18, 12, 10);  // lights
  });
  T.cbody0 = carTex('#c8102e'); T.cbody1 = carTex('#1e6fd9'); T.cbody2 = carTex('#e8e8e8'); T.cbody3 = carTex('#2bb34a');
  T.cglass = canvasTex(64, 64, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1a2a3a'); g.addColorStop(1, '#4b6a86'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); });
  T.bus = canvasTex(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#f2b800'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b2733'; for (let x = 8; x < w - 8; x += 30) ctx.fillRect(x, 10, 22, 22);
    ctx.fillStyle = '#111'; ctx.fillRect(0, 40, w, 4);
    ctx.fillStyle = '#111'; ctx.font = '800 16px Arial Black, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('SCHOOL BUS', w / 2, 58);
  });
  T.busTop = canvasTex(64, 64, (ctx, w, h) => { ctx.fillStyle = '#f2b800'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(0, h / 2 - 1, w, 2); });
  T.bank = canvasTex(256, 256, (ctx, w, h) => {
    noiseFill(ctx, w, h, 74, 30, 2, 93);
    ctx.fillStyle = '#f2f2ee'; ctx.fillRect(0, 0, 10, h); ctx.fillRect(w - 10, 0, 10, h);
    ctx.fillStyle = 'rgba(255,138,31,0.85)'; for (let y = 0; y < h; y += 64) ctx.fillRect(w / 2 - 4, y, 8, 32);
  });
  T.plank = canvasTex(128, 256, (ctx, w, h) => {
    const R = rng(95);
    for (let y = 0; y < h; y += 32) { const v = 120 + R() * 40; ctx.fillStyle = `rgb(${v},${v * 0.72},${v * 0.45})`; ctx.fillRect(0, y, w, 30); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, y + 30, w, 2); ctx.fillStyle = 'rgba(70,40,20,0.5)'; ctx.fillRect(6, y + 12, 3, 3); ctx.fillRect(w - 9, y + 12, 3, 3); }
  });
  T.rail = canvasTex(128, 64, (ctx, w, h) => {
    for (let k = 0; k < 8; k++) { ctx.fillStyle = k % 2 ? '#f2f2f0' : '#d8261c'; ctx.fillRect(k * w / 8, 0, w / 8, h); }
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, h - 8, w, 8);
  });
  T.boost = canvasTex(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#062a3a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#28f0ff';
    for (let k = 0; k < 3; k++) {
      const y = k * h / 3 + 10;
      ctx.beginPath();
      ctx.moveTo(10, y + 50); ctx.lineTo(w / 2, y); ctx.lineTo(w - 10, y + 50);
      ctx.lineTo(w - 10, y + 72); ctx.lineTo(w / 2, y + 22); ctx.lineTo(10, y + 72);
      ctx.closePath(); ctx.fill();
    }
  });
  T.soft = canvasTex(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { clamp: true });
  T.sandNormal = canvasTex(512, 512, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    // ripples + grains, tileable
    const hgt = (x, y) => {
      const u = x / w, v = y / h;
      const rip = Math.sin((u * 6 + tileNoise(u, v, 4) * 1.5) * Math.PI * 2 * 3) * 0.5;
      return rip * 0.35 + tileNoise(u, v, 32) * 0.4 + tileNoise(u, v, 96) * 0.25;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
      const i = (y * w + x) * 4;
      img.data[i] = 128 + dx * 220; img.data[i + 1] = 128 + dy * 220; img.data[i + 2] = 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { linear: true });
  T.waterNormal = canvasTex(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const hgt = (x, y) => 0.6 * tileNoise(x / w, y / h, 8) + 0.4 * tileNoise(x / w, y / h, 16);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
      const i = (y * w + x) * 4;
      img.data[i] = 128 + dx * 900; img.data[i + 1] = 128 + dy * 900; img.data[i + 2] = 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { linear: true });
  return T;
}

// ------------------------------------------------------------------ sky + light
export function buildSky(scene, renderer, sunDir) {
  const sky = new Sky();
  sky.scale.setScalar(5000);
  const u = sky.material.uniforms;
  const skySun = new THREE.Vector3().copy(sunDir);
  const set = (uu, p) => {
    uu.turbidity.value = p.turbidity; uu.rayleigh.value = p.rayleigh;
    uu.mieCoefficient.value = p.mie; uu.mieDirectionalG.value = p.mieG; uu.sunPosition.value.copy(p.sunDir);
  };
  const params = { turbidity: 3.2, rayleigh: 1.25, mie: 0.004, mieG: 0.86, sunDir: skySun };
  set(u, params);
  scene.add(sky);
  // environment map from the sky (regenerated when the time of day settles)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const sky2 = new Sky(); sky2.scale.setScalar(1000);
  envScene.add(sky2);
  const g = new THREE.Mesh(new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x9a7a55 }));
  g.position.y = -5; envScene.add(g);
  let envTex = null;
  const refreshEnv = (ground) => {
    set(sky2.material.uniforms, params);
    if (ground != null) g.material.color.setHex(ground);
    const t = pmrem.fromScene(envScene, 0.02).texture;
    scene.environment = t;
    if (envTex) envTex.dispose();
    envTex = t;
  };
  refreshEnv();
  return { sky, params, set: () => set(u, params), refreshEnv };
}

// ------------------------------------------------------------------ terrain
let _cell = 4;
export const setColorCell = (c) => { _cell = c; };                       // mesh resolution being coloured: fine noise is faded out where it would alias
export function colorAt(x, z, h, ny, out) {
  const fa = 1 - smoothstep(5, 12, _cell), fb = 1 - smoothstep(14, 48, _cell);
  const n = 0.5 + (fbm(x * 0.03, z * 0.03, 3) - 0.5) * fb;
  const n2 = 0.5 + (fbm(x * 0.15 + 9, z * 0.15, 2) - 0.5) * fa;
  // base sand
  let r = 0.86 + (n - 0.5) * 0.12, g = 0.70 + (n - 0.5) * 0.11, b = 0.50 + (n - 0.5) * 0.10;
  // dunes are lighter, crests lighter still
  const de = smoothstep(105, 175, x) * (1 - smoothstep(330, 420, x)) * (1 - smoothstep(330, 420, Math.abs(z)));
  r += de * 0.04; g += de * 0.04; b += de * 0.05;
  // hills: dry grass on the gentle slopes
  {
    const d = Math.hypot(x - HILLS.x, z - HILLS.z);
    const f = (1 - smoothstep(HILLS.r * 0.5, HILLS.r * 1.05, d)) * smoothstep(0.3, 0.7, fbm(x * 0.012 + 3, z * 0.012, 3) + 0.15);
    const gr = 0.9 - n2 * 0.25;
    r += (0.66 * gr - r) * f; g += (0.62 * gr - g) * f; b += (0.38 * gr - b) * f;
  }
  // slopes / mountains: rock
  const slope = 1 - ny;
  const rock = Math.max(smoothstep(0.22, 0.42, slope) * smoothstep(3, 9, h), smoothstep(14, 30, h) * 0.9);
  const rr = 0.56 + n2 * 0.12, rg = 0.40 + n2 * 0.09, rb = 0.30 + n2 * 0.07;
  r += (rr - r) * rock; g += (rg - g) * rock; b += (rb - b) * rock;
  // park: packed dirt
  {
    const dx = Math.max(PARK.x0 - x, 0, x - PARK.x1), dz = Math.max(PARK.z0 - z, 0, z - PARK.z1);
    const f = 1 - smoothstep(0, 18, Math.hypot(dx, dz));
    r += (0.70 + n2 * 0.06 - r) * f; g += (0.52 + n2 * 0.05 - g) * f; b += (0.36 + n2 * 0.04 - b) * f;
  }
  // stunt park: packed dirt, halfpipe concrete
  {
    const dx = Math.max(STUNT.x0 - x, 0, x - STUNT.x1), dz = Math.max(STUNT.z0 - z, 0, z - STUNT.z1);
    const f = 1 - smoothstep(0, 18, Math.hypot(dx, dz));
    r += (0.70 + n2 * 0.06 - r) * f; g += (0.53 + n2 * 0.05 - g) * f; b += (0.37 + n2 * 0.04 - b) * f;
    if (Math.abs(x - HALFPIPE.x) < HALFPIPE.w && h < -0.05) {
      const c = 0.74 + n2 * 0.04; r = c; g = c * 0.97; b = c * 0.93;
    }
  }
  // new stunt zones: packed dirt, canyon: layered red rock
  {
    for (const Z of [MEGA, NSTUNT]) {
      const dx = Math.max(Z.x0 - x, 0, x - Z.x1), dz = Math.max(Z.z0 - z, 0, z - Z.z1);
      const f = 1 - smoothstep(0, 20, Math.hypot(dx, dz));
      r += (0.69 + n2 * 0.06 - r) * f; g += (0.52 + n2 * 0.05 - g) * f; b += (0.37 + n2 * 0.04 - b) * f;
    }
    if (Math.abs(z - CANYON.cz) < 40 && x > CANYON.x0 - 45 && x < CANYON.x1 + 45) {
      const cn = smoothstep(-0.6, -5, h);
      const band = 0.5 + 0.5 * Math.sin(h * 1.7 + n * 6);
      r += ((0.55 + band * 0.18) - r) * cn; g += ((0.31 + band * 0.08) - g) * cn; b += ((0.22 + band * 0.05) - b) * cn;
    }
  }
  // special stunt park: packed dirt
  {
    const dx = Math.max(SPECIAL.x0 - x, 0, x - SPECIAL.x1), dz = Math.max(SPECIAL.z0 - z, 0, z - SPECIAL.z1);
    const f = 1 - smoothstep(0, 20, Math.hypot(dx, dz));
    r += (0.69 + n2 * 0.06 - r) * f; g += (0.52 + n2 * 0.05 - g) * f; b += (0.37 + n2 * 0.04 - b) * f;
  }
  // track shoulders
  {
    const q = trackNearest(x, z);
    if (q.track) {
      const hw = q.track.hw;
      if (q.track.surface === 'asphalt') {
        const f = 1 - smoothstep(hw + 9, hw + 12, q.d);            // gravel run-off
        r += (0.78 + n2 * 0.05 - r) * f; g += (0.74 + n2 * 0.05 - g) * f; b += (0.66 + n2 * 0.05 - b) * f;
      } else {
        const f = 1 - smoothstep(hw, hw + 5, q.d);
        r += (0.58 + n2 * 0.05 - r) * f; g += (0.43 + n2 * 0.04 - g) * f; b += (0.30 + n2 * 0.03 - b) * f;
      }
    }
  }
  // road
  const rd = roadDistance(x, z);
  if (rd < 9) {
    const f = (1 - smoothstep(3.5, 8.5, rd)) * 0.85;
    const rut = (Math.abs(rd - 1.6) < 0.5 ? 0.06 : 0);
    r += (0.66 - rut + n2 * 0.05 - r) * f; g += (0.50 - rut + n2 * 0.04 - g) * f; b += (0.35 - rut + n2 * 0.03 - b) * f;
  }
  // bowl: smooth concrete
  {
    const d = Math.hypot(x - BOWL.x, z - BOWL.z);
    const f = 1 - smoothstep(BOWL.r - 1, BOWL.r + 1.5, d);
    const c = 0.72 + n2 * 0.05;
    r += (c - r) * f; g += (c * 0.97 - g) * f; b += (c * 0.92 - b) * f;
  }
  // lake: wet sand + oasis grass
  {
    const d = Math.hypot(x - LAKE.x, z - LAKE.z);
    const wet = (1 - smoothstep(WATER_LEVEL + 0.1, WATER_LEVEL + 0.9, h)) * (1 - smoothstep(LAKE.r, LAKE.r * 1.25, d));
    r *= 1 - 0.3 * wet; g *= 1 - 0.28 * wet; b *= 1 - 0.22 * wet;
    const grass = (1 - smoothstep(LAKE.r * 0.9, LAKE.r * 1.5, d)) * smoothstep(WATER_LEVEL + 0.6, WATER_LEVEL + 1.4, h) * smoothstep(0.35, 0.6, n2 + 0.2);
    r += (0.42 - r) * grass; g += (0.52 - g) * grass; b += (0.22 - b) * grass;
  }
  // ---------------- far areas
  {
    const dx = Math.max(SALT.x0 - x, 0, x - SALT.x1), dz = Math.max(SALT.z0 - z, 0, z - SALT.z1);
    const f = 1 - smoothstep(0, 22, Math.hypot(dx, dz));
    if (f > 0) {                                                // salt flats: white, hexagon-ish cracks
      const cr = Math.abs(fbm(x * 0.045 + 3, z * 0.045 - 8, 3) - 0.5);
      const c = 0.93 + n2 * 0.05 - (1 - smoothstep(0, 0.07, cr)) * 0.07 * fa;
      r += (c - r) * f; g += (c * 0.995 - g) * f; b += (c * 1.01 - b) * f;
    }
    const fd = Math.hypot(x - FOREST.x, z - FOREST.z);
    const ff = 1 - smoothstep(FOREST.r * 0.78, FOREST.r * 1.12, fd);
    if (ff > 0) {                                               // forest floor: needles, moss, soil
      const nd = 0.5 + 0.5 * fbm(x * 0.05, z * 0.05, 2), gr = 0.8 + n2 * 0.3;
      r += ((0.27 + nd * 0.12) * gr - r) * ff; g += ((0.31 + nd * 0.08) * gr - g) * ff; b += ((0.15 + nd * 0.04) * gr - b) * ff;
    }
    const V = VOLCANO, vr = Math.hypot(x - V.x, z - V.z);
    const wv = 1 - smoothstep(V.R * 0.96, V.R * 1.04, vr);
    if (wv > 0) {                                               // forest belt, basalt gullies, lava rivers, snow cap
      const kk = V.H / 5000, hh = Math.max(0, h) / kk, th = Math.atan2(z - V.z, x - V.x);
      const nv = fbm(x * 0.0007 + 3, z * 0.0007 - 7, 4), nv2 = fbm(x * 0.004 + 1, z * 0.004 + 5, 3);
      const gul = Math.sin(th * 61 + fbm(x * 0.0007, z * 0.0007, 3) * 11);          // same phase as the gullies in the height field
      const iron = fbm(x * 0.02 + 40, z * 0.02 - 17, 3), band = 0.5 + 0.5 * Math.sin(h * 0.09 + nv * 9);
      let br = 0.25 + nv2 * 0.14 + (iron - 0.5) * 0.16 + band * 0.05, bg = 0.215 + nv2 * 0.1 + (iron - 0.5) * 0.08 + band * 0.04, bb = 0.2 + nv2 * 0.08 - (iron - 0.5) * 0.03 + band * 0.035;
      const rid = 0.5 + 0.5 * gul;
      br += rid * 0.09; bg += rid * 0.075; bb += rid * 0.06;                               // ridges lighter, gullies darker
      const lowA = 1 - smoothstep(0, 450, hh);                                              // foothills: desert dust
      br += (r - br) * lowA * 0.75; bg += (g - bg) * lowA * 0.75; bb += (b - bb) * lowA * 0.75;
      const forest = smoothstep(120, 400, hh) * (1 - smoothstep(1000, 1500, hh)) * smoothstep(0.38, 0.58, nv2 + (1 - slope) * 0.15);
      br += (0.085 + nv * 0.05 - br) * forest * 0.85; bg += (0.15 + nv * 0.07 - bg) * forest * 0.85; bb += (0.07 - bb) * forest * 0.85;
      const sc = smoothstep(3400, 4900, hh) * (0.5 + 0.5 * nv2);                           // red scoria near the summit
      br += (0.5 - br) * sc * 0.55; bg += (0.2 - bg) * sc * 0.55; bb += (0.12 - bb) * sc * 0.55;
      const lava = smoothstep(0.86, 0.97, gul) * smoothstep(1500, 2200, hh) * (1 - smoothstep(4300, 4900, hh));
      br += (0.14 - br) * lava * 0.8; bg += (0.06 - bg) * lava * 0.8; bb += (0.05 - bb) * lava * 0.8;
      const snow = smoothstep(2200, 2900, hh + (nv - 0.5) * 900) * (1 - smoothstep(0.5, 0.85, slope) * 0.55);
      const sn = 0.93 + nv2 * 0.06;
      const snowA = snow * (1 - lava * 0.8) * (1 - smoothstep(0.55, 0.8, fbm(x * 0.02 + 5, z * 0.02 - 3, 3)) * 0.35);   // wind-blown bare rock patches
      br += (sn - br) * snowA; bg += (sn - bg) * snowA; bb += (sn * 1.03 - bb) * snowA;
      const crater = smoothstep(V.rr * 1.0, V.rr * 0.35, vr);
      br += (0.14 - br) * crater * 0.7; bg += (0.115 - bg) * crater * 0.7; bb += (0.105 - bb) * crater * 0.7;
      const q = volcanoRoad(x, z);
      if (q.d < V.hw + 4 && q.phi > -0.3 && q.phi < V.phiMax + 0.3) {
        const f = 1 - smoothstep(V.hw - 1.5, V.hw + 1.6, q.d);
        br += (0.46 + n2 * 0.04 - br) * f * 0.92; bg += (0.38 + n2 * 0.03 - bg) * f * 0.92; bb += (0.31 + n2 * 0.03 - bb) * f * 0.92;
      }
      const ln = volcanoLane(x, z);
      if (ln.perp < 14 && ln.r > V.Re * 0.95 && ln.r < V.R + 3000) {
        const f = 1 - smoothstep(10, 12.5, ln.perp), edge = smoothstep(8, 9.2, ln.perp) * (1 - smoothstep(9.8, 11.2, ln.perp));
        br += (0.12 - br) * f; bg += (0.12 - bg) * f; bb += (0.13 - bb) * f;
        br += (0.95 - br) * edge * 0.9; bg += (0.8 - bg) * edge * 0.9; bb += (0.2 - bb) * edge * 0.9;     // yellow edge lines
      }
      r += (br - r) * wv; g += (bg - g) * wv; b += (bb - b) * wv;
    }
    {
      const T = TROPIC, tr = Math.hypot(x - T.x, z - T.z), wt = 1 - smoothstep(T.R * 0.96, T.R * 1.04, tr);
      if (wt > 0) {                                             // jungle: lowland grass, dense rainforest, mossy cloud forest, bare crater rim
        const hh = Math.max(0, h), th = Math.atan2(z - T.z, x - T.x);
        const nv = fbm(x * 0.0012 + 5, z * 0.0012 - 9, 4), nv2 = fbm(x * 0.006 + 2, z * 0.006 + 7, 3), nv3 = fbm(x * 0.03 + 1, z * 0.03 - 4, 3);
        const gul = 0.5 + 0.5 * Math.sin(th * 41 + fbm(x * 0.002, z * 0.002, 3) * 9);
        let jr = 0.09 + nv2 * 0.08 + nv3 * 0.03, jg = 0.34 + nv2 * 0.14 + nv3 * 0.06 - gul * 0.04, jb = 0.07 + nv2 * 0.03;
        const dense = smoothstep(80, 320, hh) * (1 - smoothstep(1300, 1750, hh));
        jr -= dense * 0.03; jg -= dense * 0.08; jb -= dense * 0.015;            // darker, denser canopy
        const moss = smoothstep(1000, 1600, hh);
        jr += moss * 0.05; jg += moss * 0.0; jb += moss * 0.04;
        const clear = smoothstep(0.55, 0.8, nv + nv3 * 0.3) * (1 - smoothstep(600, 1100, hh));   // bright grassy clearings
        jr += (0.30 - jr) * clear * 0.5; jg += (0.45 - jg) * clear * 0.5; jb += (0.12 - jb) * clear * 0.5;
        const rock = smoothstep(0.24, 0.4, slope) * 0.7;                                       // steep ravines: wet dark rock
        jr += (0.17 + nv3 * 0.06 - jr) * rock; jg += (0.15 + nv3 * 0.05 - jg) * rock; jb += (0.14 - jb) * rock;
        const rim = smoothstep(T.H * 0.86, T.H * 0.96, hh);                                       // bare ash near the crater
        jr += (0.2 + nv3 * 0.06 - jr) * rim; jg += (0.17 + nv3 * 0.05 - jg) * rim; jb += (0.15 - jb) * rim;
        const low = 1 - smoothstep(0, 140, hh);                                                    // foothills blend into the sand
        jr += (r - jr) * low * 0.7; jg += (g - jg) * low * 0.7; jb += (b - jb) * low * 0.7;
        const q = volcanoRoad(x, z, T);
        if (q.d < T.hw + 4 && q.phi > -0.3 && q.phi < T.phiMax + 0.3) {
          const f = 1 - smoothstep(T.hw - 1.5, T.hw + 1.6, q.d);
          jr += (0.5 + n2 * 0.04 - jr) * f * 0.92; jg += (0.31 + n2 * 0.03 - jg) * f * 0.92; jb += (0.2 + n2 * 0.03 - jb) * f * 0.92;   // red laterite trail
        }
        r += (jr - r) * wt; g += (jg - g) * wt; b += (jb - b) * wt;
      }
    }
    {
      const re = rangeEnv(x, z);
      if (re > 0.004) {                                         // the great range: steppe + conifer foothills, alpine meadows, scree, rock, glaciers and snow
        const wr = smoothstep(0.004, 0.05, re), hm = smoothstep(-7000, 3500, x);
        const hh = Math.max(0, h), nv = fbm(x * 0.0015 + 2, z * 0.0015 - 6, 4), nv2 = fbm(x * 0.008 + 5, z * 0.008 + 1, 3), nv3 = fbm(x * 0.04 + 9, z * 0.04 - 2, 3);
        let kr = 0.36 + nv2 * 0.1, kg = 0.33 + nv2 * 0.1, kb = 0.2 + nv2 * 0.04;                 // dry steppe
        const con = smoothstep(500, 1100, hh) * (1 - smoothstep(2300, 3000, hh)) * smoothstep(0.35, 0.55, nv + (1 - slope) * 0.2) * (0.55 + 0.45 * (1 - hm));
        kr += (0.07 + nv3 * 0.04 - kr) * con; kg += (0.17 + nv3 * 0.06 - kg) * con; kb += (0.08 - kb) * con;
        const mead = smoothstep(2300, 2900, hh) * (1 - smoothstep(3500, 4200, hh)) * (0.5 + 0.5 * (1 - hm));
        kr += (0.3 - kr) * mead * 0.7; kg += (0.38 - kg) * mead * 0.7; kb += (0.18 - kb) * mead * 0.7;
        const scree = smoothstep(2800, 3600, hh);
        kr += (0.4 + nv3 * 0.08 - kr) * scree; kg += (0.37 + nv3 * 0.07 - kg) * scree; kb += (0.35 + nv3 * 0.06 - kb) * scree;
        const rockM = smoothstep(0.2, 0.36, slope);
        const snowLine = 4100 + 900 * hm + (nv - 0.5) * 800;
        const snowA = smoothstep(snowLine, snowLine + 500, hh) * (1 - rockM * 0.75);
        const glac = smoothstep(3300, 4300, hh) * (1 - smoothstep(0.1, 0.2, slope)) * (1 - smoothstep(5600, 6800, hh));   // blue glacier tongues on the gentle ground
        kr += (0.78 - kr) * glac * 0.55; kg += (0.88 - kg) * glac * 0.55; kb += (0.96 - kb) * glac * 0.55;
        const dark = rockM * smoothstep(1500, 3600, hh);                                         // bare dark crags
        kr += (0.24 + nv3 * 0.06 - kr) * dark * 0.7; kg += (0.22 + nv3 * 0.05 - kg) * dark * 0.7; kb += (0.21 - kb) * dark * 0.7;
        const sn = 0.95 + nv2 * 0.05;
        kr += (sn - kr) * snowA; kg += (sn - kg) * snowA; kb += (sn * 1.03 - kb) * snowA;
        if (z > RANGE.vz0 - 100 && z < RANGE.vz1 + 100) {                                          // valley road
          const vt = Math.min(1, Math.max(0, (z - RANGE.vz0) / (RANGE.vz1 - RANGE.vz0))), vxc = RANGE.vx + 700 * Math.sin((z - RANGE.vz0) * 0.0021) * Math.min(1, vt * 6);
          const f = 1 - smoothstep(6.5, 8.6, Math.abs(x - vxc));
          kr += (0.48 + n2 * 0.04 - kr) * f * 0.9; kg += (0.4 + n2 * 0.03 - kg) * f * 0.9; kb += (0.33 - kb) * f * 0.9;
        }
        r += (kr - r) * wr; g += (kg - g) * wr; b += (kb - b) * wr;
      }
    }
    const dd = x - shoreX(z);
    if (dd < 280) {                                             // beach, wet sand, sea floor
      const beach = 1 - smoothstep(70, 260, dd);
      r += (0.96 + n2 * 0.03 - r) * beach; g += (0.88 + n2 * 0.03 - g) * beach; b += (0.70 + n2 * 0.03 - b) * beach;
      const wet = 1 - smoothstep(-0.9, 1.0, h);
      r *= 1 - 0.28 * wet; g *= 1 - 0.24 * wet; b *= 1 - 0.18 * wet;
      const sea = smoothstep(-2.5, -6, h);
      r += (0.36 - r) * sea; g += (0.52 - g) * sea; b += (0.55 - b) * sea;
    }
  }
  // ---------------- wild areas + highways + landing pads
  {
    const di = Math.hypot(x - ICE.x, z - ICE.z);
    if (di < ICE.r + 1800) {
      const ice = 1 - smoothstep(ICE.r - 40, ICE.r + 40, di), cr = Math.abs(fbm(x * 0.012 + 8, z * 0.012 - 3, 3) - 0.5);
      const c = 0.8 + n2 * 0.06 - (1 - smoothstep(0, 0.07, cr)) * 0.09 * fa;
      r += (c * 0.82 - r) * ice; g += (c * 0.93 - g) * ice; b += (c * 1.04 - b) * ice;       // pale blue ice with cracks
      const snow = (1 - ice) * (1 - smoothstep(ICE.r + 1500, ICE.r + 1800, di)) * smoothstep(ICE.r + 80, ICE.r + 300, di);
      r += (0.95 - r) * snow; g += (0.96 - g) * snow; b += (0.99 - b) * snow;                 // snowy hills around it
    }
    const dm = Math.hypot(x - MESA.x, z - MESA.z);
    if (dm < MESA.r + 600) {
      const f = 1 - smoothstep(MESA.r * 0.8, MESA.r + 500, dm), band = 0.5 + 0.5 * Math.sin(h * 0.45 + n * 5), top = smoothstep(18, 60, h) * smoothstep(0.6, 0.9, ny);
      const rr = 0.62 + band * 0.16, gg = 0.34 + band * 0.08, bb = 0.22 + band * 0.05;
      const flat = 0.7 + n2 * 0.1;
      r += ((top > 0.5 ? flat : rr) - r) * f; g += ((top > 0.5 ? flat * 0.62 : gg) - g) * f; b += ((top > 0.5 ? flat * 0.42 : bb) - b) * f;
    }
    const dmo = Math.hypot(x - MOON.x, z - MOON.z);
    if (dmo < MOON.r + 400) {
      const f = 1 - smoothstep(MOON.r - 100, MOON.r + 350, dmo), c = 0.5 + n2 * 0.18 + (1 - ny) * -0.25;
      r += (c - r) * f; g += (c * 0.98 - g) * f; b += (c * 1.04 - b) * f;                    // grey regolith
    }
    const ddx = Math.max(Math.abs(x - CITY.x) - CITY.h, 0), ddz = Math.max(Math.abs(z - CITY.z) - CITY.h, 0);
    if (ddx < 120 && ddz < 120) {
      const f = 1 - smoothstep(0, 70, Math.hypot(ddx, ddz));
      const gx = ((x - CITY.x) % 110 + 110) % 110, gz = ((z - CITY.z) % 110 + 110) % 110;
      const street = Math.min(gx, gz) < 27 || Math.max(gx, gz) > 83 ? 1 : 0;
      const dash = (street && Math.abs(gx - 0) < 1.5 || street && Math.abs(gz - 0) < 1.5) ? 1 : 0;
      const c = street ? 0.1 : 0.16;
      r += (c + dash * 0.5 - r) * f; g += (c + dash * 0.45 - g) * f; b += (c * 1.1 + dash * 0.2 - b) * f;
    }
    const hd = highwayDist(x, z);
    if (hd < 11) {
      const f = 1 - smoothstep(6.6, 8.2, hd), edge = smoothstep(6.0, 6.4, hd) * (1 - smoothstep(7.2, 7.8, hd));
      r += (0.1 - r) * f; g += (0.1 - g) * f; b += (0.11 - b) * f;
      r += (0.9 - r) * edge * 0.9; g += (0.88 - g) * edge * 0.9; b += (0.8 - b) * edge * 0.9;
    }
    for (const pd of PADS) {                                           // landing pads: red and white target
      if (pd.noPaint) continue;
      const d = Math.hypot(x - pd.x, z - pd.z);
      if (d < pd.r) {
        const ring = Math.floor(d / (pd.r / 5)) % 2;
        const c = ring ? 0.95 : 0.75;
        r += ((ring ? 0.95 : 0.8) - r) * 0.9; g += ((ring ? 0.95 : 0.12) - g) * 0.9; b += ((ring ? 0.95 : 0.1) - b) * 0.9; void c;
      }
    }
  }
  out[0] = Math.pow(Math.max(0, r), 2.2); out[1] = Math.pow(Math.max(0, g), 2.2); out[2] = Math.pow(Math.max(0, b), 2.2);
}

export function buildTerrain(T) {
  const W = GN + 1;
  const pos = new Float32Array(W * W * 3);
  const uv = new Float32Array(W * W * 2);
  const col = new Float32Array(W * W * 3);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    pos[k * 3] = x; pos[k * 3 + 1] = grid[k]; pos[k * 3 + 2] = z;
    uv[k * 2] = x / 7; uv[k * 2 + 1] = z / 7;
  }
  const idx = new Uint32Array(GN * GN * 6);
  let p = 0;
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    // split along (i+1,j)-(i,j+1): triangles (a,c,b) and (c,d,b)
    idx[p++] = a; idx[p++] = c; idx[p++] = b;
    idx[p++] = c; idx[p++] = d; idx[p++] = b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal.array;
  const c3 = [0, 0, 0];
  for (let k = 0; k < W * W; k++) {
    colorAt(pos[k * 3], pos[k * 3 + 2], pos[k * 3 + 1], nrm[k * 3 + 1], c3);
    col[k * 3] = c3[0]; col[k * 3 + 1] = c3[1]; col[k * 3 + 2] = c3[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: T.sand, roughness: 0.96, metalness: 0,
    normalMap: T.sandNormal, normalScale: new THREE.Vector2(0.55, 0.55),
  });
  mat.envMapIntensity = 0.55;
  // sample the detail texture at two scales so the tiling never shows
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uVolc = { value: new THREE.Vector3(VOLCANO.x, VOLCANO.z, VOLCANO.R) };
    sh.uniforms.uRng = { value: new THREE.Vector4(RANGE.x0, RANGE.x1, RANGE.zc - RANGE.W, RANGE.zc + RANGE.W) };
    sh.uniforms.uTrop = { value: new THREE.Vector3(TROPIC.x, TROPIC.z, TROPIC.R) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWPos; uniform vec3 uVolc; uniform vec3 uTrop; uniform vec4 uRng;
      float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnz(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), f.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), f.x), f.y); }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 t1 = texture2D(map, vMapUv);
        vec4 t2 = texture2D(map, vMapUv * 0.173 + vec2(0.31, 0.77));
        vec4 t3 = texture2D(map, vMapUv * 0.031 + vec2(0.13, 0.41));
        vec4 sampledDiffuseColor = mix(mix(t1, t2, 0.45), t3, 0.25);
        sampledDiffuseColor = mix(sampledDiffuseColor, t3, smoothstep(150.0, 700.0, -vViewPosition.z));   // far away: no fine detail (it would shimmer)
        sampledDiffuseColor = mix(sampledDiffuseColor, vec4(1.0), cool * 0.85);      // snow / rock: no sand tint
        if (volc > 0.0) {                                                              // volcano: rock, scree and wind-packed snow instead of sand grain
          float dd = -vViewPosition.z;
          float n1 = vnz(vWPos.xz * 0.09), n2 = vnz(vWPos.xz * 0.45 + 7.0), n3 = vnz(vWPos.xz * 2.1 + 3.0), n4 = vnz(vWPos.xz * 7.0 + 11.0);
          float rock = 0.5 + 0.95 * (n1 * 0.34 + n2 * 0.3 + n3 * 0.22 + n4 * 0.14);
          rock = mix(rock, 0.95, smoothstep(160.0, 1100.0, dd));
          sampledDiffuseColor = mix(sampledDiffuseColor, vec4(vec3(rock), 1.0), volc);
        }
        diffuseColor *= sampledDiffuseColor;
      #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(/normalScale/g, '(normalScale * (1.0 - 0.9 * cool) * (1.0 - 0.85 * volc) * (1.0 - smoothstep(90.0, 450.0, -vViewPosition.z)))'));
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'void main() {\n  float cool = smoothstep(-0.02, 0.04, vColor.b - vColor.r) * smoothstep(0.1, 0.3, vColor.b);\n  float volc = max(1.0 - smoothstep(uVolc.z * 0.97, uVolc.z * 1.03, length(vWPos.xz - uVolc.xy)), 1.0 - smoothstep(uTrop.z * 0.97, uTrop.z * 1.03, length(vWPos.xz - uTrop.xy)));\n  volc = max(volc, smoothstep(uRng.x, uRng.x + 600.0, vWPos.x) * (1.0 - smoothstep(uRng.y - 600.0, uRng.y, vWPos.x)) * smoothstep(uRng.z, uRng.z + 600.0, vWPos.z) * (1.0 - smoothstep(uRng.w - 600.0, uRng.w, vWPos.z)));');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ arena
export function buildArena(T) {
  const g = new THREE.Group();
  const size = 2048, R = ARENA.r;
  const tex = canvasTex(size, size, (ctx, w, h) => {
    const s = w / (2 * R);
    ctx.fillStyle = '#3c3c3e'; ctx.fillRect(0, 0, w, h);
    // big noise
    const img = ctx.getImageData(0, 0, w, h); const RR = rng(31);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (RR() - 0.5) * 34;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 2;
    }
    ctx.putImageData(img, 0, 0);
    // old skid marks
    ctx.strokeStyle = 'rgba(10,10,10,0.25)';
    for (let k = 0; k < 40; k++) {
      ctx.lineWidth = 6 + RR() * 8;
      ctx.beginPath();
      const cx = w / 2 + (RR() - 0.5) * w * 0.5, cy = h / 2 + (RR() - 0.5) * h * 0.5, rr = (8 + RR() * 22) * s;
      ctx.arc(cx, cy, rr, RR() * 6, RR() * 6 + 1 + RR() * 3);
      ctx.stroke();
    }
    ctx.translate(w / 2, h / 2);
    // donut circles
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 0.35 * s;
    ctx.setLineDash([2.2 * s, 1.6 * s]);
    for (const rr of [16, 30]) { ctx.beginPath(); ctx.arc(-14 * s, 0, rr * s * 0.5, 0, Math.PI * 2); ctx.stroke(); }
    for (const rr of [16, 30]) { ctx.beginPath(); ctx.arc(14 * s, 0, rr * s * 0.5, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,200,40,0.9)'; ctx.lineWidth = 0.5 * s;
    ctx.beginPath(); ctx.arc(0, 0, (R - 2) * s, 0, Math.PI * 2); ctx.stroke();
    // text
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `900 ${7 * s}px Rubik, Arial Black, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.translate(0, -34 * s); ctx.rotate(Math.PI); ctx.fillText('DRIFT ZONE', 0, 0); ctx.restore();
    ctx.fillText('DRIFT ZONE', 0, 34 * s);
    // start grid
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = -6; i < 6; i++) for (let j = 0; j < 2; j++) {
      if ((i + j) % 2 === 0) ctx.fillRect(i * 1.2 * s, (56 - 10 - j * 1.2) * s, 1.2 * s, 1.2 * s);
    }
  }, { clamp: true });
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.0 });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 128).rotateX(-Math.PI / 2), mat);
  {
    const pa = disc.geometry.attributes.position, ua = disc.geometry.attributes.uv;
    for (let i = 0; i < pa.count; i++) ua.setXY(i, 0.5 + pa.getX(i) / (2 * R), 0.5 - pa.getZ(i) / (2 * R));
  }
  disc.position.set(ARENA.x, 0.03, ARENA.z);
  disc.receiveShadow = true;
  // flip uv so text reads correctly from the south
  g.add(disc);
  // curb
  const curbTex = canvasTex(512, 16, (ctx, w, h) => {
    for (let k = 0; k < 32; k++) { ctx.fillStyle = k % 2 ? '#e8e8e8' : '#d62a1e'; ctx.fillRect(k * w / 32, 0, w / 32, h); }
  });
  curbTex.repeat.set(10, 1);
  const curb = new THREE.Mesh(new THREE.RingGeometry(R, R + 1.6, 160, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.6 }));
  // ring uvs: map angle to u
  const pa = curb.geometry.attributes.position, ua = curb.geometry.attributes.uv;
  for (let i = 0; i < pa.count; i++) {
    const a = Math.atan2(pa.getZ(i), pa.getX(i));
    ua.setXY(i, (a / (Math.PI * 2) + 0.5), Math.hypot(pa.getX(i), pa.getZ(i)) > R + 0.5 ? 1 : 0);
  }
  curb.position.set(ARENA.x, 0.05, ARENA.z);
  const coping = new THREE.Mesh(new THREE.TorusGeometry(BOWL.r - 0.1, 0.22, 8, 160).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd8462a, roughness: 0.4, metalness: 0.3 }));
  coping.position.set(BOWL.x, 1.0, BOWL.z);
  coping.castShadow = true;
  g.add(coping);
  curb.receiveShadow = true;
  g.add(curb);
  return g;
}

// ------------------------------------------------------------------ ramps
export function buildRamps(T) {
  const group = new THREE.Group();
  const buckets = {};
  const bucket = (k) => buckets[k] || (buckets[k] = { pos: [], nrm: [], uv: [] });
  const tmpV = new THREE.Vector3();

  for (const r of rampDefs) {
    const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw), sx = Math.cos(r.yaw), sz = -Math.sin(r.yaw);
    const W = r.W, prof = r.profile, base = r.base;
    const bk = r.bank || 0;
    const toW = (u, y, w) => [r.cx + fx * u + sx * w, r.cy + y, r.cz + fz * u + sz * w];
    const toT = (u, y, w) => toW(u, y + bk * w, w);                 // a point on the (possibly banked) top surface
    const st = r.style || 'ramp';
    const own = /^(container|cbody|bldg)\d/.test(st) || st === 'cglass' || st === 'bus' || st === 'plank';
    const topKey = st.startsWith('bldg') ? 'roof' : st === 'bus' ? 'busTop' : own ? st : st === 'rail' ? 'rail' : st === 'box' ? 'deck' : st === 'qp' ? 'qp' : st === 'roller' ? 'roller' : st === 'bank' ? 'bank' : 'chevron';
    const sideKey = own ? st : st === 'rail' ? 'rail' : 'side';
    const quad = (key, a, b, c, d, uvs) => {
      const B = bucket(key);
      const pa = new THREE.Vector3(...a), pb = new THREE.Vector3(...b), pc = new THREE.Vector3(...c);
      const n = tmpV.copy(pb).sub(pa).cross(new THREE.Vector3().copy(pc).sub(pa)).normalize();
      for (const [v, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [a, uvs[0]], [c, uvs[2]], [d, uvs[3]]]) {
        B.pos.push(...v); B.nrm.push(n.x, n.y, n.z); B.uv.push(...t);
      }
    };
    let along = 0;
    for (let k = 0; k < prof.length - 1; k++) {
      const [ua, ya] = prof[k], [ub, yb] = prof[k + 1];
      const segLen = Math.hypot(ub - ua, yb - ya);
      const v0 = along / 4, v1 = (along + segLen) / 4;
      along += segLen;
      const tu = (w) => topKey === 'deck' ? (w + W / 2) / W : (w + W / 2) / 4;
      // top
      quad(topKey, toT(ub, yb, -W / 2), toT(ub, yb, W / 2), toT(ua, ya, W / 2), toT(ua, ya, -W / 2),
        [[tu(-W / 2), v1], [tu(W / 2), v1], [tu(W / 2), v0], [tu(-W / 2), v0]]);
      // sides
      for (const sgn of [-1, 1]) {
        const w = sgn * W / 2;
        const pts = [toW(ua, base, w), toT(ua, ya, w), toT(ub, yb, w), toW(ub, base, w)];
        const uvs = [[ua / 4, base / 4], [ua / 4, ya / 4], [ub / 4, yb / 4], [ub / 4, base / 4]];
        if (sgn > 0) quad(sideKey, pts[0], pts[1], pts[2], pts[3], uvs);
        else quad(sideKey, pts[3], pts[2], pts[1], pts[0], [uvs[3], uvs[2], uvs[1], uvs[0]]);
      }
    }
    // back face
    const [uL, yL] = prof[prof.length - 1];
    if (yL + Math.abs(bk) * W / 2 > 0.1) quad(sideKey, toW(uL, base, W / 2), toT(uL, yL, W / 2), toT(uL, yL, -W / 2), toW(uL, base, -W / 2),
      [[0, base / 4], [0, yL / 4], [W / 4, yL / 4], [W / 4, base / 4]]);
    const [u0, y0] = prof[0];
    if (y0 + Math.abs(bk) * W / 2 > 0.1) quad(sideKey, toW(u0, base, -W / 2), toT(u0, y0, -W / 2), toT(u0, y0, W / 2), toW(u0, base, W / 2),
      [[0, base / 4], [0, y0 / 4], [W / 4, y0 / 4], [W / 4, base / 4]]);
  }
  const mats = {
    chevron: new THREE.MeshStandardMaterial({ map: T.chevron, roughness: 0.75 }),
    deck: new THREE.MeshStandardMaterial({ map: T.deck, roughness: 0.85 }),
    qp: new THREE.MeshStandardMaterial({ map: T.qp, roughness: 0.55, metalness: 0.05 }),
    roller: new THREE.MeshStandardMaterial({ map: T.roller, roughness: 1 }),
    side: new THREE.MeshStandardMaterial({ map: T.concrete, roughness: 0.9 }),
    rail: new THREE.MeshStandardMaterial({ map: T.rail, roughness: 0.55 }),
    roof: new THREE.MeshStandardMaterial({ map: T.roof, roughness: 0.9 }),
    busTop: new THREE.MeshStandardMaterial({ map: T.busTop, roughness: 0.5 }),
    bus: new THREE.MeshStandardMaterial({ map: T.bus, roughness: 0.5 }),
    bank: new THREE.MeshStandardMaterial({ map: T.bank, roughness: 0.7 }),
    plank: new THREE.MeshStandardMaterial({ map: T.plank, roughness: 0.95 }),
    cglass: new THREE.MeshStandardMaterial({ map: T.cglass, roughness: 0.2, metalness: 0.25 }),
    bldg0: new THREE.MeshStandardMaterial({ map: T.bldg0, roughness: 0.7, emissive: 0xffffff, emissiveMap: T.bldg0e, emissiveIntensity: 0.25 }),
    bldg1: new THREE.MeshStandardMaterial({ map: T.bldg1, roughness: 0.7, emissive: 0xffffff, emissiveMap: T.bldg1e, emissiveIntensity: 0.25 }),
    bldg2: new THREE.MeshStandardMaterial({ map: T.bldg2, roughness: 0.7, emissive: 0xffffff, emissiveMap: T.bldg2e, emissiveIntensity: 0.25 }),
    cbody0: new THREE.MeshStandardMaterial({ map: T.cbody0, roughness: 0.45, metalness: 0.1 }),
    cbody1: new THREE.MeshStandardMaterial({ map: T.cbody1, roughness: 0.45, metalness: 0.1 }),
    cbody2: new THREE.MeshStandardMaterial({ map: T.cbody2, roughness: 0.45, metalness: 0.1 }),
    cbody3: new THREE.MeshStandardMaterial({ map: T.cbody3, roughness: 0.45, metalness: 0.1 }),
    container0: new THREE.MeshStandardMaterial({ map: T.container0, roughness: 0.6, metalness: 0.35 }),
    container1: new THREE.MeshStandardMaterial({ map: T.container1, roughness: 0.6, metalness: 0.35 }),
    container2: new THREE.MeshStandardMaterial({ map: T.container2, roughness: 0.6, metalness: 0.35 }),
    container3: new THREE.MeshStandardMaterial({ map: T.container3, roughness: 0.6, metalness: 0.35 }),
  };
  for (const [k, B] of Object.entries(buckets)) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    const m = new THREE.Mesh(geo, mats[k]);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

// ------------------------------------------------------------------ water
export function buildWater(T) {
  const group = new THREE.Group();
  const mk = (geo, rep) => {
    const nm = T.waterNormal.clone(); nm.needsUpdate = true; nm.repeat.set(rep, rep);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x2a8a96, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.82,
      normalMap: nm, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2,
    });
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    return { m, nm };
  };
  const lake = mk(new THREE.CircleGeometry(LAKE.r * 1.02, 96).rotateX(-Math.PI / 2), 10);
  lake.m.position.set(LAKE.x, WATER_LEVEL, LAKE.z);
  const sea = mk(new THREE.PlaneGeometry(30000, 60000, 1, 1).rotateX(-Math.PI / 2), 4000);
  sea.m.position.set(-16100, WATER_LEVEL, 0);
  sea.m.material.color.set(0x1f7f9c);
  group.add(lake.m);                                  // (no sea any more: the world west of the map is the tropical volcano)
  group.userData.mats = [lake.m.material, sea.m.material];
  group.userData.tick = (t) => {
    lake.nm.offset.set(t * 0.012, t * 0.008);
    sea.nm.offset.set(t * 0.02, t * 0.013);
  };
  return group;
}

// ------------------------------------------------------------------ scenery
function colorize(geo, c, jitter = 0, seed = 1) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const R = rng(seed);
  const cc = new THREE.Color(c);
  for (let i = 0; i < n; i += 3) {
    const j = 1 + (R() - 0.5) * jitter;
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = cc.r * j; col[(i + k) * 3 + 1] = cc.g * j; col[(i + k) * 3 + 2] = cc.b * j; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

export function buildScenery() {
  const group = new THREE.Group();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();

  // rocks
  {
    let geo = new THREE.IcosahedronGeometry(1, 1);
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      p.fromBufferAttribute(pa, i);
      const k = 0.75 + 0.5 * fbm(p.x * 1.7 + 4, p.z * 1.7 + p.y * 1.3, 2);
      p.multiplyScalar(k); p.y *= 0.72;
      pa.setXYZ(i, p.x, p.y, p.z);
    }
    geo = colorize(geo, 0x9a7354, 0.18, 2);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const im = new THREE.InstancedMesh(geo, mat, scenery.rocks.length);
    scenery.rocks.forEach((r, i) => {
      e.set(r.tilt * 0.4, r.rot, r.tilt * 0.3); q.setFromEuler(e);
      s.set(r.s * (1 + r.tilt * 0.5), r.s, r.s * (1.2 - r.tilt * 0.3));
      p.set(r.x, r.y - r.s * 0.15, r.z);
      im.setMatrixAt(i, m4.compose(p, q, s));
    });
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
  }
  // cacti
  {
    const parts = [];
    const trunk = new THREE.CapsuleGeometry(0.34, 3.2, 4, 10); trunk.translate(0, 1.9, 0); parts.push(trunk);
    const a1 = new THREE.CapsuleGeometry(0.22, 0.9, 3, 8); a1.rotateZ(Math.PI / 2); a1.translate(0.6, 1.9, 0); parts.push(a1);
    const a2 = new THREE.CapsuleGeometry(0.22, 1.1, 3, 8); a2.translate(1.05, 2.6, 0); parts.push(a2);
    const b1 = new THREE.CapsuleGeometry(0.2, 0.7, 3, 8); b1.rotateZ(Math.PI / 2); b1.translate(-0.5, 2.5, 0); parts.push(b1);
    const b2 = new THREE.CapsuleGeometry(0.2, 0.9, 3, 8); b2.translate(-0.85, 3.05, 0); parts.push(b2);
    const geo = mergeGeometries(parts.map((g, i) => colorize(g, 0x5b8a3c, 0.12, 40 + i)));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const im = new THREE.InstancedMesh(geo, mat, scenery.cacti.length);
    scenery.cacti.forEach((c, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.rot);
      s.setScalar(c.s); p.set(c.x, c.y - 0.2, c.z);
      im.setMatrixAt(i, m4.compose(p, q, s));
    });
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
    // soft cacti: hide one when the buggy smashes through it, bring it back later
    const keep = scenery.cacti.map((c, i) => { const m = new THREE.Matrix4(); im.getMatrixAt(i, m); return m; });
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    group.userData.cacti = scenery.cacti;
    group.userData.setCactus = (i, on) => { im.setMatrixAt(i, on ? keep[i] : zero); im.instanceMatrix.needsUpdate = true; };
  }
  // palms
  {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.2, 0.34, 8, 8, 10, true);
    const ta = trunk.attributes.position;
    for (let i = 0; i < ta.count; i++) {
      const y = ta.getY(i) + 4;
      ta.setX(i, ta.getX(i) + Math.pow(y / 8, 2) * 1.4);
      ta.setY(i, y);
    }
    parts.push(colorize(trunk, 0x8a6a48, 0.25, 5));
    for (let k = 0; k < 9; k++) {
      const leaf = new THREE.PlaneGeometry(1.3, 4.6, 1, 6);
      const la = leaf.attributes.position;
      for (let i = 0; i < la.count; i++) {
        const v = (la.getY(i) + 2.3) / 4.6;      // 0..1 along the frond
        la.setZ(i, -v * v * 2.2 + Math.abs(la.getX(i)) * 0.5);
        la.setX(i, la.getX(i) * (1 - v * 0.7));
        la.setY(i, v * 4.6);
      }
      leaf.rotateX(-Math.PI / 2 + 0.25);
      leaf.rotateY((k / 9) * Math.PI * 2 + (k % 2) * 0.2);
      leaf.translate(1.4, 7.9, 0);
      parts.push(colorize(leaf, k % 2 ? 0x3f7d2c : 0x4e9134, 0.2, 60 + k));
    }
    const geo = mergeGeometries(parts.map(g => { if (!g.attributes.normal) g.computeVertexNormals(); return g; }));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(geo, mat, scenery.palms.length);
    scenery.palms.forEach((c, i) => {
      e.set(0, c.rot, c.lean); q.setFromEuler(e);
      s.setScalar(c.s); p.set(c.x, c.y - 0.2, c.z);
      im.setMatrixAt(i, m4.compose(p, q, s));
    });
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
  }
  // pine trees
  {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 7).translate(0, 1.3, 0); parts.push(colorize(trunk, 0x4a3524, 0.2, 7));
    [[2.6, 3.4, 2.2], [2.1, 3.2, 4.0], [1.6, 3.0, 5.7], [1.05, 2.6, 7.3]].forEach(([r, h, y], k) => {
      const c = new THREE.ConeGeometry(r, h, 9, 1).translate(0, y + h / 2 - 0.4, 0);
      const pa = c.attributes.position;
      for (let i = 0; i < pa.count; i++) { const j = fbm(pa.getX(i) * 2 + k, pa.getZ(i) * 2, 2); pa.setX(i, pa.getX(i) * (0.85 + 0.3 * j)); pa.setZ(i, pa.getZ(i) * (0.85 + 0.3 * j)); }
      parts.push(colorize(c, k % 2 ? 0x1c4a2a : 0x235534, 0.25, 20 + k));
    });
    const geo = mergeGeometries(parts); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, scenery.pines.length));
    const col = new THREE.Color();
    scenery.pines.forEach((c, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.rot);
      s.set(c.s, c.s * (0.9 + (i % 7) * 0.05), c.s); p.set(c.x, c.y - 0.2, c.z);
      im.setMatrixAt(i, m4.compose(p, q, s));
      im.setColorAt(i, col.setHSL(0.36 + ((i * 13) % 10) * 0.004, 0.45, 0.7 + ((i * 7) % 10) * 0.03));
    });
    im.count = scenery.pines.length; im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  // basalt boulders on the volcano
  {
    let geo = new THREE.IcosahedronGeometry(1, 1);
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      p.fromBufferAttribute(pa, i);
      const k = 0.75 + 0.5 * fbm(p.x * 1.7 + 9, p.z * 1.7 + p.y * 1.3, 2);
      p.multiplyScalar(k); p.y *= 0.72; pa.setXYZ(i, p.x, p.y, p.z);
    }
    geo = colorize(geo, 0x4a4340, 0.25, 12); geo.computeVertexNormals();
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), Math.max(1, scenery.bigRocks.length));
    scenery.bigRocks.forEach((r, i) => {
      e.set(r.tilt * 0.4, r.rot, r.tilt * 0.3); q.setFromEuler(e);
      s.set(r.s * (1 + r.tilt * 0.5), r.s, r.s * (1.2 - r.tilt * 0.3)); p.set(r.x, r.y - r.s * 0.15, r.z);
      im.setMatrixAt(i, m4.compose(p, q, s));
    });
    im.count = scenery.bigRocks.length; im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
    group.add(im);
  }
  // flags around the park
  {
    const pts = [];
    for (let x = PARK.x0 - 6; x <= PARK.x1 + 6; x += 20) { pts.push([x, PARK.z1 + 8]); pts.push([x, PARK.z0 - 10]); }
    for (let z = PARK.z0; z <= PARK.z1; z += 22) { pts.push([PARK.x0 - 12, z]); pts.push([PARK.x1 + 12, z]); }
    for (let a = 0; a < 24; a++) {
      const ang = a / 24 * Math.PI * 2;
      if (Math.abs(Math.sin(ang)) > 0.97) continue;
      pts.push([ARENA.x + Math.cos(ang) * (ARENA.r + 6), ARENA.z + Math.sin(ang) * (ARENA.r + 6)]);
    }
    const poleG = new THREE.CylinderGeometry(0.07, 0.09, 7, 6).translate(0, 3.5, 0);
    const flagG = new THREE.BufferGeometry();
    flagG.setAttribute('position', new THREE.Float32BufferAttribute([0, 6.9, 0, 0, 4.4, 0, 0.9, 5.65, 1.9, 0, 6.9, 0, 0.9, 5.65, 1.9, 0, 4.4, 0], 3));
    flagG.computeVertexNormals();
    const poles = new THREE.InstancedMesh(poleG, new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.4 }), pts.length);
    const flags = new THREE.InstancedMesh(flagG, new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide }), pts.length);
    const cols = [0xff4d2e, 0xffc21a, 0x2ec4ff, 0x9b5cff, 0x2edc7a];
    pts.forEach(([x, z], i) => {
      const y = terrainHeight(x, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6 + i * 0.37);
      m4.compose(p.set(x, y, z), q, s.setScalar(1));
      poles.setMatrixAt(i, m4); flags.setMatrixAt(i, m4);
      flags.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    });
    poles.castShadow = true; flags.castShadow = true;
    group.add(poles, flags);
  }
  return group;
}

// ------------------------------------------------------------------ checkpoints
export function buildCheckpoints() {
  const cps = [];
  const cpPts = ROUTE.filter(p => p.cp);
  const group = new THREE.Group();
  cpPts.forEach((c, i) => {
    const ri = ROUTE.indexOf(c);
    const prev = ROUTE[(ri - 1 + ROUTE.length) % ROUTE.length], next = ROUTE[(ri + 1) % ROUTE.length];
    const dx = (next.x - c.x) / Math.hypot(next.x - c.x, next.z - c.z) + (c.x - prev.x) / Math.hypot(c.x - prev.x, c.z - prev.z);
    const dz = (next.z - c.z) / Math.hypot(next.x - c.x, next.z - c.z) + (c.z - prev.z) / Math.hypot(c.x - prev.x, c.z - prev.z);
    const yaw = Math.atan2(dx, dz);
    const gq = { n: { x: 0, y: 1, z: 0 } };
    const gy = groundQuery(c.x, c.z, 100, gq);
    const r = c.r || 6.2;
    const y = c.y != null ? c.y : Math.max(gy, waterAt(c.x, c.z)) + r * 0.62;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffb020, emissiveIntensity: 2.2, transparent: true, opacity: 0.95, roughness: 0.4 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.32, 12, 64), mat);
    // inner shimmering film
    const film = new THREE.Mesh(new THREE.CircleGeometry(r - 0.3, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
    const g = new THREE.Group();
    g.add(ring, film);
    g.position.set(c.x, y, c.z);
    g.rotation.y = yaw;
    g.visible = false;
    group.add(g);
    cps.push({ x: c.x, y, z: c.z, r, yaw, nx: Math.sin(yaw), nz: Math.cos(yaw), group: g, ring, film, mat, index: i });
  });
  return { group, cps };
}

// start / finish arch
export function buildStartGate(cp, text = 'START  ·  FINISH', color = 0xe02a1f) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const arch = new THREE.Mesh(new THREE.TorusGeometry(9, 0.9, 16, 48, Math.PI), mat);
  arch.castShadow = true;
  g.add(arch);
  const tex = canvasTex(1024, 192, (ctx, w, h) => {
    const gr = ctx.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#111'); gr.addColorStop(0.5, '#222'); gr.addColorStop(1, '#111');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 32; i++) for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#fff' : '#000';
      ctx.fillRect(i * 32, j * 16, 32, 16); ctx.fillRect(i * 32, h - 32 + j * 16, 32, 16);
    }
    ctx.fillStyle = '#ffcc22'; ctx.font = '900 92px Rubik, Arial Black, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  }, { clamp: true });
  // two single-sided banners so the text reads correctly from both directions
  const bmat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 });
  for (const ry of [0, Math.PI]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.25), bmat);
    banner.position.set(0, 7.2, ry ? -0.02 : 0.02);
    banner.rotation.y = ry;
    banner.castShadow = !ry;
    g.add(banner);
  }
  g.position.set(cp.x, terrainHeight(cp.x, cp.z), cp.z);
  g.rotation.y = cp.yaw;
  return g;
}

// ------------------------------------------------------------------ coins
export function coinPositions() {
  const pts = [];
  const R = rng(77);
  // arcs over jumps
  const arc = (x, z0, z1, h0, h1, n, yaw = Math.PI) => {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const z = z0 + (z1 - z0) * t;
      pts.push({ x, z, y: h0 + (h1 - h0) * t + Math.sin(t * Math.PI) * (h1 > 6 ? 7 : 3), air: true });
    }
  };
  arc(0, -142, -160, 4.5, 4.5, 3);
  arc(-58, -160, -215, 8, 8, 5);
  // along the route
  for (let i = 0; i < ROUTE.length; i++) {
    const a = ROUTE[i], b = ROUTE[(i + 1) % ROUTE.length];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.floor(L / 70);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      const x = a.x + (b.x - a.x) * t + (R() - 0.5) * 6, z = a.z + (b.z - a.z) * t + (R() - 0.5) * 6;
      pts.push({ x, z });
    }
  }
  // bowl ring
  for (let k = 0; k < 6; k++) {
    const ang = k / 6 * Math.PI * 2;
    pts.push({ x: BOWL.x + Math.cos(ang) * 30, z: BOWL.z + Math.sin(ang) * 30 });
  }
  // dunes crests
  for (let k = 0; k < 8; k++) pts.push({ x: 160 + R() * 180, z: -160 + R() * 300 });
  // table top & quarter pipes
  pts.push({ x: 56, z: -152, y: 5.5 }, { x: 56, z: -164, y: 5.5 });
  pts.push({ x: -20, z: -278, y: 5.5 }, { x: 20, z: -278, y: 5.5 });
  // lake
  for (let k = 0; k < 4; k++) pts.push({ x: LAKE.x + (R() - 0.5) * 50, z: LAKE.z + (R() - 0.5) * 50 });
  // race tracks
  for (const tr of TRACKS) for (let i = 30; i < tr.n; i += 38) {
    const p = tr.pts[i], o = ((i / 38) % 3 - 1) * tr.hw * 0.45;
    pts.push({ x: p.x + p.tz * o, z: p.z - p.tx * o });
  }
  // stunt park: over the ski jump, in the halfpipe, on the fun box
  for (let k = 0; k < 6; k++) {
    const t = (k + 0.5) / 6;
    pts.push({ x: 510, z: 160 - t * 80, y: 10 + Math.sin(t * Math.PI) * 12, air: true });
  }
  for (let k = 0; k < 6; k++) pts.push({ x: HALFPIPE.x + (k % 2 ? 12 : -12), z: HALFPIPE.z0 + 30 + k * 50 });
  pts.push({ x: 565, z: -60, y: 5.2 });
  // drift lot and hills
  for (let k = 0; k < 6; k++) pts.push({ x: DRIFTLOT.x0 + 30 + R() * (DRIFTLOT.x1 - DRIFTLOT.x0 - 60), z: DRIFTLOT.z0 + 30 + R() * (DRIFTLOT.z1 - DRIFTLOT.z0 - 60) });
  for (let k = 0; k < 10; k++) {
    const a = R() * Math.PI * 2, rr = 60 + R() * 200;
    const x = HILLS.x + Math.cos(a) * rr, z = HILLS.z + Math.sin(a) * rr;
    if (Math.hypot(x, z) < 690) pts.push({ x, z });
  }
  const gq = { n: { x: 0, y: 1, z: 0 } };
  for (const p of pts) {
    if (p.y == null) p.y = Math.max(groundQuery(p.x, p.z, 100, gq), waterAt(p.x, p.z)) + 1.3;
  }
  return pts;
}

export function buildCoins(pts) {
  const geo = new THREE.CylinderGeometry(0.75, 0.75, 0.16, 28).rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.22, emissive: 0xff9a00, emissiveIntensity: 0.35 });
  const im = new THREE.InstancedMesh(geo, mat, pts.length);
  im.castShadow = true;
  im.userData.pts = pts;
  return im;
}

// ------------------------------------------------------------------ boost pads
export function buildBoostPads(T) {
  const g = new THREE.Group();
  const tex = T.boost;
  tex.repeat.set(1, 1);
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.6, roughness: 0.4, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const b of boostPads) {
    const gq = { n: { x: 0, y: 1, z: 0 } };
    const y = groundQuery(b.x, b.z, 100, gq);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 8).rotateX(-Math.PI / 2), mat);
    // align to ground normal
    m.position.set(b.x, y + 0.06, b.z);
    const qn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(gq.n.x, gq.n.y, gq.n.z));
    m.quaternion.copy(qn).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw + Math.PI));
    m.receiveShadow = true;
    g.add(m);
  }
  g.userData.tick = (t) => { tex.offset.y = -t * 1.6; };
  return g;
}

// ------------------------------------------------------------------ props (cones, barrels)
export function propLayout() {
  const props = [];
  // donut circles cones
  for (const cx of [-14, 14]) {
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2;
      props.push({ type: 'cone', x: ARENA.x + cx + Math.cos(a) * 4, z: ARENA.z + Math.sin(a) * 4 });
    }
  }
  // slalom
  for (let k = 0; k < 7; k++) props.push({ type: 'cone', x: -36 + k * 12, z: ARENA.z + 32 });
  // barrels in the park
  const R = rng(5);
  for (let k = 0; k < 14; k++) {
    props.push({ type: 'barrel', x: -30 + (R() - 0.5) * 8 + (k % 2) * 60, z: -200 - k * 3.5 });
  }
  for (let k = 0; k < 8; k++) props.push({ type: 'barrel', x: 20 + (k % 4) * 1.4, z: -100 + Math.floor(k / 4) * 1.4 });
  // drift lot: slalom lines and two donut posts
  const lx = (DRIFTLOT.x0 + DRIFTLOT.x1) / 2, lz = (DRIFTLOT.z0 + DRIFTLOT.z1) / 2;
  for (let k = 0; k < 9; k++) props.push({ type: 'cone', x: DRIFTLOT.x0 + 30 + k * 20, z: lz + 45 });
  for (let k = 0; k < 9; k++) props.push({ type: 'cone', x: DRIFTLOT.x0 + 40 + k * 20, z: lz - 45 });
  for (const ox of [-45, 45]) for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    props.push({ type: 'cone', x: lx + ox + Math.cos(a) * 3, z: lz + Math.sin(a) * 3 });
  }
  // stunt park barrels
  for (let k = 0; k < 10; k++) props.push({ type: 'barrel', x: 600 + (k % 2) * 1.3, z: -150 + Math.floor(k / 2) * 1.3 });
  for (const sp of stuntProps) props.push({ ...sp });
  // cones along road edges
  for (let i = 0; i < ROUTE.length; i += 2) {
    const a = ROUTE[i];
    for (const s of [-1, 1]) props.push({ type: 'cone', x: a.x + s * 7, z: a.z + 4 });
  }
  return props;
}

export function buildPropMeshes(props) {
  const coneGeo = (() => {
    const g = new THREE.ConeGeometry(0.32, 0.8, 16, 4).translate(0, 0.4, 0);
    const base = new THREE.BoxGeometry(0.66, 0.06, 0.66).translate(0, 0.03, 0);
    const cols = (geo, fn) => {
      geo = geo.toNonIndexed();
      const pa = geo.attributes.position; const c = new Float32Array(pa.count * 3);
      for (let i = 0; i < pa.count; i++) { const col = fn(pa.getY(i)).map(v => Math.pow(v, 2.2)); c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
    };
    const c1 = cols(g, y => (y > 0.38 && y < 0.58) ? [1, 1, 1] : [1, 0.32, 0.05]);
    const c2 = cols(base, () => [1, 0.32, 0.05]);
    return mergeGeometries([c1, c2]);
  })();
  const barrelGeo = (() => {
    const g = new THREE.CylinderGeometry(0.42, 0.42, 1.2, 18, 6).translate(0, 0.6, 0).toNonIndexed();
    const pa = g.attributes.position; const c = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i);
      const band = (y > 0.35 && y < 0.45) || (y > 0.75 && y < 0.85);
      const col = (band ? [0.9, 0.9, 0.9] : [0.12, 0.35, 0.85]).map(v => Math.pow(v, 2.2));
      c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  })();
  const vcol = (geo, fn) => {
    geo = geo.index ? geo.toNonIndexed() : geo;
    const pa = geo.attributes.position; const c = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) { const col = fn(pa.getX(i), pa.getY(i), pa.getZ(i)).map(v => Math.pow(v, 2.2)); c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); geo.deleteAttribute('uv'); return geo;
  };
  const crateGeo = vcol(new THREE.BoxGeometry(1.15, 1.15, 1.15).translate(0, 0.575, 0), (x, y, z) => {
    const e = Math.max(Math.abs(x), Math.abs(z)) > 0.5 || Math.abs(y - 0.575) > 0.5;
    return e ? [0.42, 0.27, 0.13] : [0.7, 0.5, 0.26];
  });
  const pinGeo = vcol(new THREE.LatheGeometry([[0.0, 0], [0.28, 0.02], [0.3, 0.3], [0.2, 0.75], [0.13, 1.05], [0.17, 1.3], [0.2, 1.5], [0.15, 1.7], [0.0, 1.75]].map(([r, y]) => new THREE.Vector2(r, y)), 14),
    (x, y) => (y > 1.0 && y < 1.2) ? [0.85, 0.12, 0.1] : [0.95, 0.95, 0.92]);
  const coneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  const barrelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5 });
  const crateMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const pinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 });
  const group = new THREE.Group();
  for (const p of props) {
    const m = new THREE.Mesh(p.type === 'cone' ? coneGeo : p.type === 'crate' ? crateGeo : p.type === 'pin' ? pinGeo : barrelGeo, p.type === 'cone' ? coneMat : p.type === 'crate' ? crateMat : p.type === 'pin' ? pinMat : barrelMat);
    m.castShadow = true;
    const gq = { n: { x: 0, y: 1, z: 0 } };
    const y = groundQuery(p.x, p.z, 100, gq);
    p.pos = new THREE.Vector3(p.x, y + (p.lift || 0), p.z);
    p.home = p.pos.clone();
    p.vel = new THREE.Vector3();
    p.q = new THREE.Quaternion();
    p.w = new THREE.Vector3();
    p.r = p.type === 'cone' ? 0.35 : p.type === 'crate' ? 0.6 : p.type === 'pin' ? 0.3 : 0.45;
    p.h = p.type === 'cone' ? 0.8 : p.type === 'crate' ? 1.15 : p.type === 'pin' ? 1.75 : 1.2;
    p.mass = p.type === 'cone' ? 1 : p.type === 'pin' ? 1.5 : 3;
    p.mesh = m;
    p.knocked = false;
    p.sleep = true;
    m.position.copy(p.pos);
    group.add(m);
  }
  return group;
}

// ------------------------------------------------------------------ race tracks
export function buildTracks(T) {
  const group = new THREE.Group();
  const asphaltTrack = canvasTex(256, 512, (ctx, w, h) => {
    noiseFill(ctx, w, h, 62, 34, 2, 41);
    const R = rng(43);
    for (let i = 0; i < 3000; i++) { const v = 60 + R() * 110; ctx.fillStyle = `rgba(${v},${v},${v},0.5)`; ctx.fillRect(R() * w, R() * h, 1.2, 1.2); }
    ctx.fillStyle = '#f2f2ee';
    ctx.fillRect(6, 0, 7, h); ctx.fillRect(w - 13, 0, 7, h);
    // racing line rubber
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.18)'); g.addColorStop(0.7, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const dirtTrack = canvasTex(256, 512, (ctx, w, h) => {
    noiseFill(ctx, w, h, 140, 60, 2, 47);
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] *= 1.08; img.data[i + 1] *= 0.86; img.data[i + 2] *= 0.64; }
    ctx.putImageData(img, 0, 0);
    // wheel ruts
    for (const u of [0.28, 0.4, 0.6, 0.72]) {
      const g = ctx.createLinearGradient(w * (u - 0.05), 0, w * (u + 0.05), 0);
      g.addColorStop(0, 'rgba(40,25,10,0)'); g.addColorStop(0.5, 'rgba(40,25,10,0.28)'); g.addColorStop(1, 'rgba(40,25,10,0)');
      ctx.fillStyle = g; ctx.fillRect(w * (u - 0.05), 0, w * 0.1, h);
    }
  });
  const roadTex = canvasTex(256, 512, (ctx, w, h) => {
    noiseFill(ctx, w, h, 70, 30, 2, 53);
    const R = rng(57);
    for (let i = 0; i < 2500; i++) { const v = 60 + R() * 100; ctx.fillStyle = `rgba(${v},${v},${v},0.45)`; ctx.fillRect(R() * w, R() * h, 1.2, 1.2); }
    ctx.fillStyle = 'rgba(238,238,230,0.92)';
    ctx.fillRect(8, 0, 6, h); ctx.fillRect(w - 14, 0, 6, h);
    ctx.fillStyle = 'rgba(240,190,40,0.95)';
    ctx.fillRect(w / 2 - 4, 0, 8, h * 0.55);
    // patched cracks
    ctx.strokeStyle = 'rgba(20,20,20,0.35)'; ctx.lineWidth = 1.5;
    for (let k = 0; k < 8; k++) { ctx.beginPath(); let x = R() * w, y = R() * h; ctx.moveTo(x, y); for (let j = 0; j < 6; j++) { x += (R() - 0.5) * 30; y += R() * 25; ctx.lineTo(x, y); } ctx.stroke(); }
  });
  const kerbTex = canvasTex(64, 256, (ctx, w, h) => {
    for (let k = 0; k < 8; k++) { ctx.fillStyle = k % 2 ? '#f4f4f4' : '#d8241c'; ctx.fillRect(0, k * h / 8, w, h / 8); }
  });
  const checker = canvasTex(256, 64, (ctx, w, h) => {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { ctx.fillStyle = (i + j) % 2 ? '#111' : '#f5f5f5'; ctx.fillRect(i * 16, j * 16, 16, 16); }
  });

  const ribbon = (tr, off0, off1, lift, filter) => {
    const pos = [], uv = [], idx = [];
    let dist = 0, run = -1;
    for (let i = 0; i <= tr.n; i++) {
      const p = tr.pts[i % tr.n], prev = tr.pts[(i - 1 + tr.n) % tr.n];
      if (i > 0) dist += Math.hypot(p.x - prev.x, p.z - prev.z);
      const on = !filter || filter(p, i % tr.n);
      if (!on) { run = -1; continue; }
      const nx = p.tz, nz = -p.tx;             // left of travel
      const v = pos.length / 3;
      for (const o of [off0, off1]) pos.push(p.x + nx * o, p.y + lift, p.z + nz * o);
      uv.push(0, dist / 8, 1, dist / 8);
      if (run >= 0) idx.push(run, run + 1, v, run + 1, v + 1, v);
      run = v;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };

  for (const tr of TRACKS) {
    const isA = tr.surface === 'asphalt';
    const mat = new THREE.MeshStandardMaterial({
      map: tr.road ? roadTex : isA ? asphaltTrack : dirtTrack, roughness: isA ? 0.8 : 1,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
    });
    const road = new THREE.Mesh(ribbon(tr, -tr.hw, tr.hw, 0.1), mat);
    road.receiveShadow = true;
    group.add(road);
    if (tr.road) continue;
    if (isA) {
      const kmat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
      const corner = (p) => Math.abs(p.curv) > 0.035;
      for (const s of [-1, 1]) {
        const k = new THREE.Mesh(ribbon(tr, s * tr.hw, s * (tr.hw + 1.5), 0.13, corner), kmat);
        k.receiveShadow = true;
        group.add(k);
      }
    }
    // start line + gantry
    const p0 = tr.pts[0];
    const yaw = Math.atan2(p0.tx, p0.tz);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(tr.hw * 2, 2).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    line.position.set(p0.x, p0.y + 0.12, p0.z);
    line.rotation.y = yaw + Math.PI / 2;
    line.receiveShadow = true;
    group.add(line);
    const gate = buildStartGate({ x: p0.x, z: p0.z, yaw }, isA ? 'GRAND PRIX' : 'RALLY', isA ? 0x1e6fd9 : 0x2bb34a);
    gate.position.y = p0.y;
    group.add(gate);
  }

  // tyre stacks
  {
    const parts = [];
    for (let k = 0; k < 4; k++) {
      const t = new THREE.TorusGeometry(0.52, 0.22, 8, 16).rotateX(Math.PI / 2).translate(0, 0.22 + k * 0.42, 0);
      parts.push(colorize(t, k === 3 ? 0xe8e8e8 : 0x1a1a1a, 0.1, 90 + k));
    }
    const geo = mergeGeometries(parts); geo.computeVertexNormals();
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), tireStacks.length);
    const m4 = new THREE.Matrix4();
    tireStacks.forEach((t, i) => im.setMatrixAt(i, m4.makeTranslation(t.x, t.y, t.z)));
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
  }
  // grandstands
  for (const gs of grandstands) {
    const g = new THREE.Group();
    const parts = [];
    const steps = 6;
    for (let k = 0; k < steps; k++) {
      const b = new THREE.BoxGeometry(gs.L, (k + 1) * gs.H / steps, gs.D / steps)
        .translate(0, (k + 1) * gs.H / steps / 2, gs.D / 2 - (k + 0.5) * gs.D / steps);
      parts.push(colorize(b, 0xb9b4aa, 0.08, 200 + k));
      // seat row
      const seat = new THREE.BoxGeometry(gs.L - 1, 0.35, 0.5)
        .translate(0, (k + 1) * gs.H / steps + 0.17, gs.D / 2 - (k + 0.6) * gs.D / steps);
      parts.push(colorize(seat, [0xd62a1e, 0x1e6fd9, 0xf2a900][k % 3], 0.3, 220 + k));
    }
    const roof = new THREE.BoxGeometry(gs.L + 2, 0.3, gs.D + 1).translate(0, gs.H + 3.5, 0);
    parts.push(colorize(roof, 0xe8e8e8, 0.05, 240));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      parts.push(colorize(new THREE.BoxGeometry(0.3, gs.H + 3.5, 0.3).translate(sx * gs.L / 2, (gs.H + 3.5) / 2, sz * gs.D / 2), 0x888888, 0, 250));
    }
    const geo = mergeGeometries(parts); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    g.position.set(gs.x, gs.y - 0.3, gs.z);
    g.rotation.y = gs.yaw;
    group.add(g);
  }
  return group;
}

// ------------------------------------------------------------------ drift lot
export function buildDriftLot() {
  const W = DRIFTLOT.x1 - DRIFTLOT.x0, D = DRIFTLOT.z1 - DRIFTLOT.z0;
  const s = 6;                                   // px per metre
  const tex = canvasTex(Math.round(W * s), Math.round(D * s), (ctx, w, h) => {
    ctx.fillStyle = '#3a3a3d'; ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h); const R = rng(61);
    for (let i = 0; i < img.data.length; i += 4) { const n = (R() - 0.5) * 30; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 2; }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(10,10,10,0.28)';
    for (let k = 0; k < 70; k++) {
      ctx.lineWidth = 5 + R() * 6;
      ctx.beginPath();
      ctx.arc(R() * w, R() * h, (6 + R() * 30) * s, R() * 6, R() * 6 + 1 + R() * 3);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,210,40,0.9)'; ctx.lineWidth = 0.5 * s;
    ctx.strokeRect(2 * s, 2 * s, w - 4 * s, h - 4 * s);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.35 * s;
    ctx.setLineDash([2 * s, 1.5 * s]);
    for (const ox of [-45, 45]) { ctx.beginPath(); ctx.arc(w / 2 + ox * s, h / 2, 14 * s, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `900 ${12 * s}px Rubik, Arial Black, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('DRIFT PARK', w / 2, h / 2);
  }, { clamp: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  // plane uv: u along +x, v=1 at -z (north) after rotation -> canvas top is north
  mesh.position.set((DRIFTLOT.x0 + DRIFTLOT.x1) / 2, 0.04, (DRIFTLOT.z0 + DRIFTLOT.z1) / 2);
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ vegetation
// Dry grass tufts and desert shrubs, instanced in 100 m chunks so the camera
// only draws what's near. Grass sways in the wind.
export function buildVegetation(T) {
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 } };
  const grassTex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const R = rng(71);
    for (let i = 0; i < 70; i++) {
      const x0 = w * (0.1 + R() * 0.8), len = h * (0.45 + R() * 0.5), bend = (R() - 0.5) * w * 0.35;
      const g = 140 + R() * 70;
      ctx.strokeStyle = `rgba(${g + 40},${g + 20},${g * 0.55},1)`;
      ctx.lineWidth = 2 + R() * 3;
      ctx.beginPath(); ctx.moveTo(x0, h);
      ctx.quadraticCurveTo(x0 + bend * 0.3, h - len * 0.6, x0 + bend, h - len);
      ctx.stroke();
    }
  }, { clamp: true });
  // three crossed quads, darker at the base
  const quad = () => new THREE.PlaneGeometry(1.3, 0.95, 1, 2).translate(0, 0.47, 0);
  const parts = [0, Math.PI / 3, 2 * Math.PI / 3].map(a => quad().rotateY(a));
  let grassGeo = mergeGeometries(parts);
  {
    const pa = grassGeo.attributes.position, c = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const k = 0.45 + 0.55 * (pa.getY(i) / 0.95);
      c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k;
    }
    grassGeo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    // point normals up so the tufts light like the ground they sit on
    const na = grassGeo.attributes.normal;
    for (let i = 0; i < na.count; i++) na.setXYZ(i, 0, 1, 0);
  }
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTex, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 1,
  });
  const sway = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
        float wv = sin(uTime * 1.7 + ip.x * 0.11 + ip.y * 0.07) * 0.5 + sin(uTime * 3.1 + ip.x * 0.3) * 0.2;
        transformed.x += wv * 0.18 * position.y;
        transformed.z += wv * 0.08 * position.y;
      #endif`);
  };
  grassMat.onBeforeCompile = sway;

  // shrubs
  let shrubGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    const pa = shrubGeo.attributes.position, p = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) {
      p.fromBufferAttribute(pa, i);
      const k = 0.7 + 0.5 * fbm(p.x * 2.1 + 5, p.z * 2.1 + p.y * 1.7, 2);
      p.multiplyScalar(k); p.y = p.y * 0.62 + 0.45;
      pa.setXYZ(i, p.x, p.y, p.z);
    }
    shrubGeo = colorize(shrubGeo, 0x7d7a4c, 0.35, 81);
    shrubGeo.computeVertexNormals();
  }
  const shrubMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });

  // placement
  const okSpot = (x, z) => {
    if (Math.max(Math.abs(x), Math.abs(z)) > 1380) return false;
    if (x < shoreX(z) + 230) return false;
    if (TR_surface(x, z) !== 'sand') return false;
    if (roadDistance(x, z) < 6) return false;
    const q = trackNearest(x, z);
    if (q.track && q.d < q.track.hw + 3) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 0.95) return false;
    if (x > PARK.x0 - 8 && x < PARK.x1 + 8 && z > PARK.z0 - 8 && z < PARK.z1 + 8) return false;
    return true;
  };
  const density = (x, z) => {
    const hills = 1 - smoothstep(HILLS.r * 0.4, HILLS.r * 1.1, Math.hypot(x - HILLS.x, z - HILLS.z));
    const oasis = 1 - smoothstep(LAKE.r, LAKE.r * 2.2, Math.hypot(x - LAKE.x, z - LAKE.z));
    const dunes = smoothstep(105, 175, x) * (1 - smoothstep(330, 420, x));
    const patch = smoothstep(0.35, 0.7, fbm(x * 0.008 + 11, z * 0.008 - 4, 3));
    return Math.min(1, (0.22 + 0.8 * hills + 0.9 * oasis) * (0.25 + patch) * (1 - 0.85 * dunes));
  };
  const R = rng(4242);
  const CH = 100;
  const chunks = new Map();
  const add = (kind, x, z, s, rot) => {
    const key = Math.floor(x / CH) + ',' + Math.floor(z / CH);
    let c = chunks.get(key);
    if (!c) chunks.set(key, c = { grass: [], shrub: [], cx: (Math.floor(x / CH) + 0.5) * CH, cz: (Math.floor(z / CH) + 0.5) * CH });
    c[kind].push(x, terrainHeight(x, z), z, s, rot);
  };
  const nTry = 260000;
  for (let i = 0; i < nTry; i++) {
    const x = (R() - 0.5) * 2800, z = (R() - 0.5) * 2800;
    const d = density(x, z);
    if (R() > d) continue;
    if (!okSpot(x, z)) continue;
    const nrm = { x: 0, y: 1, z: 0 };
    terrainHeight(x, z, nrm);
    if (nrm.y < 0.82) continue;
    if (R() < 0.08) add('shrub', x, z, 0.5 + R() * 1.1, R() * 6.28);
    else {
      // tufts grow in small clumps
      for (let k = 0; k < 3; k++) add('grass', x + (R() - 0.5) * 2.5, z + (R() - 0.5) * 2.5, 0.6 + R() * 0.8, R() * 6.28);
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const list = [];
  for (const c of chunks.values()) {
    for (const kind of ['grass', 'shrub']) {
      const arr = c[kind];
      const n = arr.length / 5;
      if (!n) continue;
      const im = new THREE.InstancedMesh(kind === 'grass' ? grassGeo : shrubGeo, kind === 'grass' ? grassMat : shrubMat, n);
      for (let i = 0; i < n; i++) {
        const [x, y, z, s, rot] = arr.slice(i * 5, i * 5 + 5);
        q.setFromAxisAngle(Y, rot);
        sc.set(s, s * (kind === 'grass' ? 0.8 + (i % 5) * 0.1 : 0.9), s);
        im.setMatrixAt(i, m4.compose(pos.set(x, y - (kind === 'grass' ? 0.05 : 0.25), z), q, sc));
      }
      im.computeBoundingSphere();
      im.castShadow = kind === 'shrub';
      im.receiveShadow = true;
      group.add(im);
      list.push({ im, cx: c.cx, cz: c.cz, range: kind === 'grass' ? 240 : 600 });
    }
  }
  group.userData.update = (cam, t, scale = 1) => {
    uniforms.uTime.value = t;
    for (const e of list) e.im.visible = Math.hypot(cam.x - e.cx, cam.z - e.cz) < e.range * scale;
  };
  return group;
}

// ------------------------------------------------------------------ clouds
export function buildClouds(sunDir) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSun: { value: sunDir.clone() }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w * 0.99999;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSun; uniform vec3 uTint; varying vec3 vDir;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * n(p); p = p * 2.02 + 3.1; a *= 0.5; } return s; }
      void main() {
        if (vDir.y < 0.01) discard;
        vec2 uv = vDir.xz / (vDir.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
        float c = fbm(uv);
        c = smoothstep(0.52, 0.82, c) * smoothstep(0.01, 0.2, vDir.y);
        if (c < 0.01) discard;
        float lit = 0.75 + 0.25 * max(dot(vDir, normalize(uSun)), 0.0);
        float dens = fbm(uv * 2.0 + 7.0);
        vec3 col = mix(vec3(0.72, 0.70, 0.70), vec3(1.0, 0.97, 0.92), lit * (0.6 + 0.4 * dens));
        gl_FragColor = vec4(col * uTint, c * 0.85);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2500, 48, 24), mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.userData.mat = mat;
  dome.userData.tick = (t, camPos) => { mat.uniforms.uTime.value = t; dome.position.copy(camPos); };
  return dome;
}


// ------------------------------------------------------------------ trampolines
export function buildTrampolines() {
  const group = new THREE.Group();
  const tex = canvasTex(256, 256, (ctx, w, h) => {
    const c = w / 2;
    for (let k = 6; k >= 0; k--) { ctx.fillStyle = k % 2 ? '#ffd23a' : '#1e6fd9'; ctx.beginPath(); ctx.arc(c, c, c * (k + 1) / 7, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 4;
    for (let a = 0; a < 8; a++) { ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(a * Math.PI / 4) * c, c + Math.sin(a * Math.PI / 4) * c); ctx.stroke(); }
  }, { clamp: true });
  const items = [];
  const gq = { n: { x: 0, y: 1, z: 0 } };
  for (const t of trampolines) {
    const g = new THREE.Group();
    const y = groundQuery(t.x, t.z, 100, gq);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(t.r, 0.32, 10, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c2a44, roughness: 0.4, metalness: 0.5 }));
    rim.position.y = 0.55; rim.castShadow = true;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.97, t.r * 0.97, 0.3, 40), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18 }));
    disc.position.y = 0.5; disc.receiveShadow = true;
    // legs
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.6, 6), new THREE.MeshStandardMaterial({ color: 0x555d6a, metalness: 0.6, roughness: 0.4 }));
      leg.position.set(Math.cos(a) * t.r * 0.96, 0.25, Math.sin(a) * t.r * 0.96); g.add(leg);
    }
    g.add(rim, disc);
    if (t.aim) {                                                       // giant launcher: arrow showing where it throws you
      const ang = Math.atan2(t.aim.vx, t.aim.vz);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(t.r * 0.35, t.r * 0.9, 4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      arrow.position.set(Math.sin(ang) * t.r * 0.35, 0.75, Math.cos(ang) * t.r * 0.35); arrow.rotation.y = ang; arrow.scale.y = 0.2;
      g.add(arrow);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 18, 8), new THREE.MeshStandardMaterial({ color: 0xd9262c }));
      pole.position.set(t.r * 1.15, 9, 0); g.add(pole);
    }
    g.position.set(t.x, y, t.z);
    group.add(g);
    items.push({ t, disc, rim, g });
  }
  group.userData.tick = (dt) => {
    for (const it of items) {
      it.t.squash = Math.max(0, (it.t.squash || 0) - dt * 2.4);
      const s = it.t.squash;
      it.disc.position.y = 0.5 - 0.35 * s * Math.cos(s * 9);
      it.disc.scale.y = 1 + 0.5 * s * Math.sin(s * 14);
    }
  };
  return group;
}

// ------------------------------------------------------------------ rotating platforms
export function buildTurntables() {
  const group = new THREE.Group();
  const items = [];
  for (const t of turntables) {
    const tex = canvasTex(512, 512, (ctx, w, h) => {
      const c = w / 2;
      for (let k = 0; k < 12; k++) { ctx.fillStyle = k % 2 ? '#d62a1e' : '#f1f1ee'; ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, c, k * Math.PI / 6, (k + 1) * Math.PI / 6); ctx.fill(); }
      ctx.fillStyle = 'rgba(30,30,34,0.82)'; ctx.beginPath(); ctx.arc(c, c, c * 0.86, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 8; ctx.setLineDash([26, 18]); ctx.beginPath(); ctx.arc(c, c, c * 0.62, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(c, c, c * 0.3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      for (let k = 0; k < 4; k++) { ctx.save(); ctx.translate(c, c); ctx.rotate(k * Math.PI / 2); ctx.beginPath(); ctx.moveTo(c * 0.72, 0); ctx.lineTo(c * 0.56, -22); ctx.lineTo(c * 0.56, 22); ctx.closePath(); ctx.fill(); ctx.restore(); }
    }, { clamp: true });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r, 0.3, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    const gq = { n: { x: 0, y: 1, z: 0 } };
    disc.position.set(t.x, groundQuery(t.x, t.z, 100, gq) + 0.08, t.z);
    disc.receiveShadow = true; disc.castShadow = false;
    // the top is mapped with the canvas; spin it by rotating the whole disc
    group.add(disc); items.push({ t, disc });
  }
  group.userData.tick = (dt) => { for (const it of items) { it.t.angle += it.t.w * dt; it.disc.rotation.y = it.t.angle; } };
  return group;
}

// ------------------------------------------------------------------ volcano: lava, smoke, summit, altitude signs
export function buildVolcano(T) {
  const V = VOLCANO, group = new THREE.Group();
  const cy = V.H - V.depth;
  const lavaTex = canvasTex(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#ffe27a'); g.addColorStop(0.35, '#ff8a1f'); g.addColorStop(0.75, '#d12a08'); g.addColorStop(1, '#4a0d05');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const R = rng(5);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(30,6,2,${0.15 + R() * 0.4})`;
      ctx.beginPath(); ctx.ellipse(R() * w, R() * h, 4 + R() * 16, 3 + R() * 9, R() * 3, 0, 7); ctx.fill();
    }
  }, { clamp: true });
  const lava = new THREE.Mesh(new THREE.CircleGeometry(190, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: lavaTex, toneMapped: false, color: new THREE.Color(1.6, 1.2, 1.0) }));
  lava.position.set(V.x, cy + 1.2, V.z);
  group.add(lava);
  const glow = new THREE.PointLight(0xff5a18, 90000, 5200, 1.15);
  glow.position.set(V.x, cy + 90, V.z);
  group.add(glow);
  // smoke plume rising 1.5 km above the crater
  const puffGeo = new THREE.PlaneGeometry(1, 1);
  const puffs = [];
  for (let i = 0; i < 60; i++) {                                     // round, camera-facing smoke puffs (alpha from distance to the centre)
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color(0x4a4440) }, uOp: { value: 0.3 }, uSize: { value: 100 } },
      vertexShader: 'varying vec2 vUv; varying float vD; uniform float uSize; void main(){ vUv = uv; vec4 c = modelViewMatrix * vec4(0.0,0.0,0.0,1.0); vD = length(c.xyz); gl_Position = projectionMatrix * (c + vec4(position.xy * uSize, 0.0, 0.0)); }',
      fragmentShader: 'varying vec2 vUv; varying float vD; uniform vec3 uCol; uniform float uOp; void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.6) * uOp * smoothstep(500.0, 3000.0, vD); if (a < 0.003) discard; gl_FragColor = vec4(uCol, a);\n#include <colorspace_fragment>\n}',
      transparent: true, depthWrite: false, fog: false,
    });
    const sp = new THREE.Mesh(puffGeo, mat); sp.frustumCulled = false; sp.renderOrder = 4;
    group.add(sp);
    puffs.push({ sp, mat, ph: i / 60, dx: (Math.random() - 0.5) * 140, dz: (Math.random() - 0.5) * 140, sz: 0.8 + Math.random() * 0.6 });
  }
  // lava rivers: glowing streams that spill over the crater rim and creep down the gullies
  const flowTex = canvasTex(128, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(110,18,4,0)'); g.addColorStop(0.16, 'rgba(255,110,20,1)'); g.addColorStop(0.5, 'rgba(255,215,100,1)');
    g.addColorStop(0.84, 'rgba(255,110,20,1)'); g.addColorStop(1, 'rgba(110,18,4,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const R = rng(11);
    for (let i = 0; i < 70; i++) {                                   // dark crust drifting on the stream
      ctx.fillStyle = `rgba(60,14,5,${0.1 + R() * 0.25})`;
      ctx.beginPath(); ctx.ellipse(20 + R() * (w - 40), R() * h, 3 + R() * 9, 6 + R() * 14, 0, 0, 7); ctx.fill();
    }
  });
  flowTex.wrapS = THREE.ClampToEdgeWrapping;
  const flowMat = new THREE.MeshBasicMaterial({ map: flowTex, vertexColors: true, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (const fl of LAVA) {
    const pts = fl.pts, n = pts.length;
    const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), col = new Float32Array(n * 2 * 3), idx = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const w = fl.hw[i], [x, z] = pts[i];
      for (let sd = 0; sd < 2; sd++) {
        const px = x + (-tz) * w * (sd ? 1 : -1), pz = z + tx * w * (sd ? 1 : -1), k = i * 2 + sd;
        pos[k * 3] = px; pos[k * 3 + 1] = rawHeightAt(px, pz) + 1.4; pos[k * 3 + 2] = pz;
        uv[k * 2] = sd; uv[k * 2 + 1] = i * 14 / 60;
        const f = 3.4 - 2.2 * (i / n);
        col[k * 3] = f; col[k * 3 + 1] = f * (0.85 - 0.45 * i / n); col[k * 3 + 2] = f * (0.55 - 0.45 * i / n);
      }
      const rq = volcanoRoad(x, z), onRoad = rq.d < V.hw + 10 && rq.phi > -0.3 && rq.phi < V.phiMax + 0.3;
      if (i < n - 1 && !onRoad) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }      // gap where the trail crosses (a culvert)
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, flowMat); m.frustumCulled = false; m.renderOrder = 3;
    group.add(m);
  }
  const tang = (phi) => { const a = V.phi0 + phi; return [-V.b * Math.cos(a) - Math.sin(a), -V.b * Math.sin(a) + Math.cos(a)]; };
  const signTex = (lines, bg = '#1c2a3a') => canvasTex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.direction = 'ltr';
    lines.forEach(([t, size, col], i) => { ctx.font = `800 ${size}px Rubik, Arial, sans-serif`; ctx.fillStyle = col || '#fff'; ctx.fillText(t, w / 2, 90 + i * (size * 1.1)); });
  }, { clamp: true });
  const board = (tex, w, h, x, y, z, yaw, postH = 3) => {
    const mk = () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mk());
    m.position.set(x, y + postH + h / 2, z); m.rotation.y = yaw; m.castShadow = true;
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(0.06);
    const back = m.clone(); back.material = mk(); back.rotation.y = yaw + Math.PI; back.position.sub(f);
    m.position.add(f);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * w / 3.4, 0.12 * w / 3.4, postH + h * 0.2, 6), new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.6, roughness: 0.4 }));
    post.position.set(x, y + (postH + h * 0.2) / 2, z); post.castShadow = true;
    group.add(m, back, post);
    return m;
  };
  // altitude signs every 500 m, on the uphill side of the road
  for (let alt = 500; alt <= 5500; alt += 500) {
    const phi = phiAtAlt(alt), pt = volcanoPoint(phi), [tx, tz] = tang(phi), tl = Math.hypot(tx, tz);
    const nx = -tz / tl, nz = tx / tl;
    const side = (Math.hypot(pt.x + nx * 9 - V.x, pt.z + nz * 9 - V.z) < pt.r) ? 1 : -1;
    const sx = pt.x + nx * side * (V.hw + 3), sz = pt.z + nz * side * (V.hw + 3);
    const sy = Math.max(rawHeightAt(sx, sz), pt.y);
    board(signTex([[alt.toLocaleString('en-US') + ' m', 92, '#ffd23a'], ['ALTITUDE', 44, '#cfe3ff']]), 4.4, 2.2, sx, sy, sz, Math.atan2(-tx, -tz), 3.2);
  }
  // summit plaza: flag, sign, and the gate at the top of the giant descent lane
  const e = volcanoPoint(V.phiMax - 0.02);
  const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 34, 8), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.7, roughness: 0.3 }));
  fp.position.set(e.x + 18, e.y + 17, e.z + 18); fp.castShadow = true; group.add(fp);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(14, 8.4, 16, 6), new THREE.MeshStandardMaterial({
    map: canvasTex(256, 160, (ctx, w, h) => { ctx.fillStyle = '#e02a1f'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(30, 130); ctx.lineTo(w / 2, 24); ctx.lineTo(w - 30, 130); ctx.closePath(); ctx.fill(); }, { clamp: true }),
    side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(e.x + 25, e.y + 29, e.z + 18); group.add(flag);
  const [ex, ez] = tang(V.phiMax - 0.02);
  board(signTex([['SUMMIT', 96, '#ffffff'], ['5,895 m', 110, '#ffd23a']], '#5a1010'), 16, 8, e.x - ez * 0 + 20, e.y, e.z - 20, Math.atan2(-ex, -ez), 4);
  {
    const lx = Math.cos(V.theta), lz = Math.sin(V.theta), lyaw = Math.atan2(lx, lz);
    const gx = V.x + lx * (V.Re + 26), gz = V.z + lz * (V.Re + 26), gy = rawHeightAt(gx, gz);
    const side = new THREE.Vector3(lz, 0, -lx);
    const pm = new THREE.MeshStandardMaterial({ color: 0xd9262c, metalness: 0.3, roughness: 0.5 });
    for (const sgn of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, 22, 2.4), pm);
      p.position.set(gx + side.x * 14 * sgn, gy + 11, gz + side.z * 14 * sgn); p.castShadow = true; group.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(30, 3.4, 2.6), pm); beam.position.set(gx, gy + 22, gz); beam.rotation.y = lyaw + Math.PI / 2; beam.castShadow = true; group.add(beam);
    board(signTex([['MEGA DESCENT', 66, '#ffffff'], ['11 KM · 5,895 M DROP', 40, '#ffd23a']], '#10151c'), 26, 7.2, gx, gy + 18, gz, lyaw + Math.PI, 0);
  }
  // ---- the lookout deck: round viewing platform, rail, telescopes, sign and a tall beacon beam you can see from the whole valley
  {
    const L = LOOKOUT, y = L.y + 0.35, dark = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.5, roughness: 0.5 });
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(L.r, L.r, 0.7, 40), new THREE.MeshStandardMaterial({ color: 0x59606b, roughness: 0.6, metalness: 0.2 }));
    deck.position.set(L.x, y - 0.25, L.z); deck.receiveShadow = true; deck.castShadow = true; group.add(deck);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(L.r - 0.3, 0.14, 8, 64).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffa010, emissiveIntensity: 0.6 }));
    ring.position.set(L.x, y + 0.2, L.z); group.add(ring);
    const railM = new THREE.MeshStandardMaterial({ color: 0xdadde2, metalness: 0.7, roughness: 0.3 });
    const rail = new THREE.Mesh(new THREE.TorusGeometry(L.r - 0.5, 0.08, 8, 64).rotateX(Math.PI / 2), railM); rail.position.set(L.x, y + 1.15, L.z); group.add(rail);
    for (let k = 0; k < 32; k++) {                                      // posts, with a gap on the road side for the entrance
      const a = k / 32 * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      const toRoad = Math.atan2(L.roadZ - L.z, L.roadX - L.x);
      if (Math.abs(Math.atan2(Math.sin(a - toRoad), Math.cos(a - toRoad))) < 0.28) continue;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), railM); post.position.set(L.x + dx * (L.r - 0.5), y + 0.6, L.z + dz * (L.r - 0.5)); group.add(post);
    }
    const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw);
    for (const off of [-6, 0, 6]) {                                     // telescopes pointing out over the valley
      const px = L.x + fx * (L.r - 5) + fz * off, pz = L.z + fz * (L.r - 5) - fx * off;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 1.3, 6), dark); leg.position.set(px, y + 0.65, pz); group.add(leg);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 10).rotateX(Math.PI / 2 - 0.25), dark); tube.position.set(px + fx * 0.2, y + 1.45, pz + fz * 0.2); tube.rotation.y = L.yaw; group.add(tube);
    }
    const bx = L.x - fx * (L.r - 3), bz = L.z - fz * (L.r - 3);          // beacon tower on the road side
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 40, 8), new THREE.MeshStandardMaterial({ color: 0xd9262c, metalness: 0.3, roughness: 0.5 })); tower.position.set(bx, y + 20, bz); tower.castShadow = true; group.add(tower);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.3), toneMapped: false, fog: false })); orb.position.set(bx, y + 42, bz); group.add(orb);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(7, 14, 1400, 16, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.8, 0.15), transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    beam.position.set(bx, y + 700, bz); group.add(beam);
    board(signTex([['LOOKOUT', 92, '#ffffff'], ['VIEW OF THE WHOLE VALLEY · PRESS N', 28, '#ffd23a']], '#1c3a2a'), 8, 4, L.x - fx * (L.r + 4), L.y, L.z - fz * (L.r + 4), Math.atan2(L.roadX - L.x, L.roadZ - L.z), 2.5);
    group.userData.beam = beam;
  }
  group.userData.tick = (t) => {
    const pa = flag.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) pa.setZ(i, Math.sin(pa.getX(i) * 0.5 - t * 5) * 0.9 * (pa.getX(i) + 7) / 14);
    pa.needsUpdate = true;
    glow.intensity = 80000 + Math.sin(t * 3.1) * 10000 + Math.sin(t * 7.3) * 6000;
    flowTex.offset.y = -t * 0.05;
    if (group.userData.beam) group.userData.beam.material.opacity = 0.12 + Math.sin(t * 1.7) * 0.03;
    lava.material.color.setRGB(1.5 + Math.sin(t * 2) * 0.15, 1.1 + Math.sin(t * 3.3) * 0.12, 0.9);
    for (const p of puffs) {
      const a = ((t * 0.02 + p.ph) % 1);
      p.sp.position.set(V.x + p.dx + a * 800 + Math.sin(a * 6 + p.ph * 9) * 40, cy + 60 + a * 3200, V.z + p.dz + a * 300);
      p.mat.uniforms.uSize.value = (260 + a * 900) * p.sz;
      p.mat.uniforms.uOp.value = Math.sin(Math.PI * Math.min(1, a * 1.15)) * 0.42;
      const c = 0.2 + a * 0.35; p.mat.uniforms.uCol.value.setRGB(c, c * 0.95, c * 0.9);
    }
  };
  return group;
}

// ------------------------------------------------------------------ tropical volcano: signs, summit flag, steam plume, crater lake
export function buildTropic() {
  const T = TROPIC, group = new THREE.Group();
  const tang = (phi) => { const a = T.phi0 + phi; return [-T.b * Math.cos(a) - Math.sin(a), -T.b * Math.sin(a) + Math.cos(a)]; };
  const signTex = (lines, bg = '#0f3a2a') => canvasTex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.textAlign = 'center'; ctx.direction = 'ltr';
    lines.forEach(([t, size, col], i) => { ctx.font = `800 ${size}px Rubik, Arial, sans-serif`; ctx.fillStyle = col || '#fff'; ctx.fillText(t, w / 2, 90 + i * (size * 1.1)); });
  }, { clamp: true });
  const board = (tex, w, h, x, y, z, yaw, postH = 3) => {
    const mk = () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mk());
    m.position.set(x, y + postH + h / 2, z); m.rotation.y = yaw; m.castShadow = true;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * w / 3.4, 0.12 * w / 3.4, postH + h * 0.2, 6), new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.6, roughness: 0.4 }));
    post.position.set(x, y + (postH + h * 0.2) / 2, z); post.castShadow = true;
    group.add(m, post);
  };
  for (let alt = 250; alt <= 2000; alt += 250) {                       // altitude signs on the uphill shoulder
    const phi = phiAtAlt(alt, T), pt = volcanoPoint(phi, T), [tx, tz] = tang(phi), tl = Math.hypot(tx, tz);
    const nx = -tz / tl, nz = tx / tl;
    const side = (Math.hypot(pt.x + nx * 9 - T.x, pt.z + nz * 9 - T.z) < pt.r) ? 1 : -1;
    const sx = pt.x + nx * side * (T.hw + 3), sz = pt.z + nz * side * (T.hw + 3);
    board(signTex([[alt.toLocaleString('en-US') + ' m', 92, '#ffd23a'], ['TROPIC VOLCANO', 38, '#bff5d0']]), 4.4, 2.2, sx, Math.max(rawHeightAt(sx, sz), pt.y), sz, Math.atan2(-tx, -tz), 3.2);
  }
  const e = volcanoPoint(T.phiMax - 0.02, T), [ex, ez] = tang(T.phiMax - 0.02);
  const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 26, 8), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.7, roughness: 0.3 }));
  fp.position.set(e.x + 14, e.y + 13, e.z + 14); fp.castShadow = true; group.add(fp);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(11, 6.6, 16, 6), new THREE.MeshStandardMaterial({
    map: canvasTex(256, 160, (ctx, w, h) => { ctx.fillStyle = '#12a05a'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 38, 0, 7); ctx.fill(); }, { clamp: true }),
    side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(e.x + 19.5, e.y + 22.5, e.z + 14); group.add(flag);
  board(signTex([['SUMMIT', 96, '#ffffff'], ['2,100 m', 110, '#ffd23a']]), 14, 7, e.x + 16, e.y, e.z - 16, Math.atan2(-ex, -ez), 4);
  const lake = new THREE.Mesh(new THREE.CircleGeometry(T.rr * 0.9, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1f9ea0, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88 }));
  lake.position.set(T.x, T.H - T.depth + 4, T.z); group.add(lake);
  const puffGeo = new THREE.PlaneGeometry(1, 1), puffs = [];
  for (let i = 0; i < 34; i++) {                                       // white steam rising from the crater
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color(0xf2f4f6) }, uOp: { value: 0.3 }, uSize: { value: 100 } },
      vertexShader: 'varying vec2 vUv; varying float vD; uniform float uSize; void main(){ vUv = uv; vec4 c = modelViewMatrix * vec4(0.0,0.0,0.0,1.0); vD = length(c.xyz); gl_Position = projectionMatrix * (c + vec4(position.xy * uSize, 0.0, 0.0)); }',
      fragmentShader: 'varying vec2 vUv; varying float vD; uniform vec3 uCol; uniform float uOp; void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.6) * uOp * smoothstep(300.0, 1800.0, vD); if (a < 0.003) discard; gl_FragColor = vec4(uCol, a);\n#include <colorspace_fragment>\n}',
      transparent: true, depthWrite: false, fog: false,
    });
    const sp = new THREE.Mesh(puffGeo, mat); sp.frustumCulled = false; sp.renderOrder = 4; group.add(sp);
    puffs.push({ sp, mat, ph: i / 34, dx: (Math.random() - 0.5) * 70, dz: (Math.random() - 0.5) * 70, sz: 0.8 + Math.random() * 0.6 });
  }
  group.userData.tick = (t) => {
    const pa = flag.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) pa.setZ(i, Math.sin(pa.getX(i) * 0.5 - t * 5) * 0.8 * (pa.getX(i) + 5.5) / 11);
    pa.needsUpdate = true;
    for (const p of puffs) {
      const a = ((t * 0.03 + p.ph) % 1);
      p.sp.position.set(T.x + p.dx + a * 300 + Math.sin(a * 6 + p.ph * 9) * 20, T.H + 10 + a * 900, T.z + p.dz + a * 120);
      p.mat.uniforms.uSize.value = (90 + a * 380) * p.sz;
      p.mat.uniforms.uOp.value = Math.sin(Math.PI * Math.min(1, a * 1.15)) * 0.4;
    }
  };
  return group;
}
