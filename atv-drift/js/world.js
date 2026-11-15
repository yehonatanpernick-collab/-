// Visual world: sky, light, terrain, ramps, water, scenery, checkpoints, coins, pads, props.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  GN, CELL, HALF, grid, WATER_LEVEL, ARENA, PARK, BOWL, LAKE, ROUTE,
  rampDefs, boostPads, scenery, fbm, smoothstep, roadDistance, terrainHeight, groundQuery, rng,
  TRACKS, DRIFTLOT, STUNT, HALFPIPE, HILLS, tireStacks, grandstands, trackNearest, waterAt, surfaceAt as TR_surface,
} from './terrain.js';

// ------------------------------------------------------------------ textures
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8;
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
  T.sand = canvasTex(512, 512, (ctx, w, h) => {
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
    for (let i = 0; i < 2200; i++) {
      const v = 150 + R() * 100;
      ctx.fillStyle = `rgba(${v},${v * 0.92},${v * 0.8},${0.35 + R() * 0.4})`;
      ctx.fillRect(R() * w, R() * h, 1 + R() * 1.6, 1 + R() * 1.6);
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
  u.turbidity.value = 3.2;
  u.rayleigh.value = 1.25;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.86;
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  // environment map from the sky
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const sky2 = new Sky(); sky2.scale.setScalar(1000);
  sky2.material.uniforms.turbidity.value = 3.2;
  sky2.material.uniforms.rayleigh.value = 1.25;
  sky2.material.uniforms.mieCoefficient.value = 0.004;
  sky2.material.uniforms.mieDirectionalG.value = 0.86;
  sky2.material.uniforms.sunPosition.value.copy(sunDir);
  envScene.add(sky2);
  // warm ground bounce for the env
  const g = new THREE.Mesh(new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x9a7a55 }));
  g.position.y = -5; envScene.add(g);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = env;
  pmrem.dispose();
  return sky;
}

// ------------------------------------------------------------------ terrain
function colorAt(x, z, h, ny, out) {
  const n = fbm(x * 0.03, z * 0.03, 3);
  const n2 = fbm(x * 0.15 + 9, z * 0.15, 2);
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
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 t1 = texture2D(map, vMapUv);
        vec4 t2 = texture2D(map, vMapUv * 0.173 + vec2(0.31, 0.77));
        vec4 t3 = texture2D(map, vMapUv * 0.031 + vec2(0.13, 0.41));
        vec4 sampledDiffuseColor = mix(mix(t1, t2, 0.45), t3, 0.25);
        diffuseColor *= sampledDiffuseColor;
      #endif`);
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
    const toW = (u, y, w) => [r.cx + fx * u + sx * w, r.cy + y, r.cz + fz * u + sz * w];
    const topKey = r.style === 'box' ? 'deck' : r.style === 'qp' ? 'qp' : r.style === 'roller' ? 'roller' : 'chevron';
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
      quad(topKey, toW(ub, yb, -W / 2), toW(ub, yb, W / 2), toW(ua, ya, W / 2), toW(ua, ya, -W / 2),
        [[tu(-W / 2), v1], [tu(W / 2), v1], [tu(W / 2), v0], [tu(-W / 2), v0]]);
      // sides
      for (const sgn of [-1, 1]) {
        const w = sgn * W / 2;
        const pts = [toW(ua, base, w), toW(ua, ya, w), toW(ub, yb, w), toW(ub, base, w)];
        const uvs = [[ua / 4, base / 4], [ua / 4, ya / 4], [ub / 4, yb / 4], [ub / 4, base / 4]];
        if (sgn > 0) quad('side', pts[0], pts[1], pts[2], pts[3], uvs);
        else quad('side', pts[3], pts[2], pts[1], pts[0], [uvs[3], uvs[2], uvs[1], uvs[0]]);
      }
    }
    // back face
    const [uL, yL] = prof[prof.length - 1];
    if (yL > 0.1) quad('side', toW(uL, base, W / 2), toW(uL, yL, W / 2), toW(uL, yL, -W / 2), toW(uL, base, -W / 2),
      [[0, base / 4], [0, yL / 4], [W / 4, yL / 4], [W / 4, base / 4]]);
    const [u0, y0] = prof[0];
    if (y0 > 0.1) quad('side', toW(u0, base, -W / 2), toW(u0, y0, -W / 2), toW(u0, y0, W / 2), toW(u0, base, W / 2),
      [[0, base / 4], [0, y0 / 4], [W / 4, y0 / 4], [W / 4, base / 4]]);
  }
  const mats = {
    chevron: new THREE.MeshStandardMaterial({ map: T.chevron, roughness: 0.75 }),
    deck: new THREE.MeshStandardMaterial({ map: T.deck, roughness: 0.85 }),
    qp: new THREE.MeshStandardMaterial({ map: T.qp, roughness: 0.55, metalness: 0.05 }),
    roller: new THREE.MeshStandardMaterial({ map: T.roller, roughness: 1 }),
    side: new THREE.MeshStandardMaterial({ map: T.concrete, roughness: 0.9 }),
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
  const geo = new THREE.CircleGeometry(LAKE.r * 1.02, 96).rotateX(-Math.PI / 2);
  const nm = T.waterNormal.clone(); nm.needsUpdate = true;
  nm.repeat.set(10, 10);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x2a8a96, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.82,
    normalMap: nm, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(LAKE.x, WATER_LEVEL, LAKE.z);
  m.receiveShadow = true;
  m.userData.tick = (t) => { nm.offset.set(t * 0.012, t * 0.008); };
  return m;
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
  const coneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  const barrelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5 });
  const group = new THREE.Group();
  for (const p of props) {
    const m = new THREE.Mesh(p.type === 'cone' ? coneGeo : barrelGeo, p.type === 'cone' ? coneMat : barrelMat);
    m.castShadow = true;
    const gq = { n: { x: 0, y: 1, z: 0 } };
    const y = groundQuery(p.x, p.z, 100, gq);
    p.pos = new THREE.Vector3(p.x, y, p.z);
    p.home = p.pos.clone();
    p.vel = new THREE.Vector3();
    p.q = new THREE.Quaternion();
    p.w = new THREE.Vector3();
    p.r = p.type === 'cone' ? 0.35 : 0.45;
    p.h = p.type === 'cone' ? 0.8 : 1.2;
    p.mass = p.type === 'cone' ? 1 : 3;
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
    if (Math.hypot(x, z) > 720 || Math.max(Math.abs(x), Math.abs(z)) > 760) return false;
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
  const nTry = 90000;
  for (let i = 0; i < nTry; i++) {
    const x = (R() - 0.5) * 1500, z = (R() - 0.5) * 1500;
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
  group.userData.update = (cam, t) => {
    uniforms.uTime.value = t;
    for (const e of list) e.im.visible = Math.hypot(cam.x - e.cx, cam.z - e.cz) < e.range;
  };
  return group;
}

// ------------------------------------------------------------------ clouds
export function buildClouds(sunDir) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSun: { value: sunDir.clone() } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w * 0.99999;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSun; varying vec3 vDir;
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
        gl_FragColor = vec4(col, c * 0.85);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2500, 48, 24), mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.userData.tick = (t, camPos) => { mat.uniforms.uTime.value = t; dome.position.copy(camPos); };
  return dome;
}
