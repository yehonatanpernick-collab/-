// Road ribbons (gravel / dirt / mud / rock) draped on the physical ground, with
// tyre ruts and soft shoulders; plus bridge decks, railings and piers.
import * as THREE from 'three';
import { bridgeRailColliders } from '../world/collision.js';

const texLoader = new THREE.TextureLoader();
function tex(url, srgb, aniso, repeat = true) {
  const t = texLoader.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

const ROAD_TINT = { gravel: [1, 1, 1], dirt: [0.86, 0.74, 0.6], rock: [0.82, 0.8, 0.78], mud: [1, 1, 1] };

export class Roads {
  constructor(world, collision, renderer, weatherUniform) {
    this.world = world;
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const gravel = { map: tex('assets/textures/road_gravel_diff.jpg', true, aniso), normalMap: tex('assets/textures/road_gravel_nor.jpg', false, aniso), arm: tex('assets/textures/road_gravel_arm.jpg', false, aniso) };
    const mud = { map: tex('assets/textures/road_mud_diff.jpg', true, aniso), normalMap: tex('assets/textures/road_mud_nor.jpg', false, aniso), arm: tex('assets/textures/road_mud_arm.jpg', false, aniso) };
    this.group = new THREE.Group();
    this.materials = {};
    const mk = (set, tint, ruts) => {
      const m = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.arm, aoMap: set.arm, color: new THREE.Color(...tint), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      m.normalScale.set(1.2, 1.2);
      m.onBeforeCompile = (s) => {
        s.uniforms.uWeather = weatherUniform;
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float edge; attribute float across; varying float vEdge; varying float vAcross;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = edge; vAcross = across;');
        s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uWeather; varying float vEdge; varying float vAcross;')
          .replace('#include <map_fragment>', `#include <map_fragment>
            // twin tyre ruts, compacted and darker, a grassy crown strip between them on dirt tracks
            float rut = exp(-pow((abs(vAcross) - 0.72) / 0.28, 2.0));
            diffuseColor.rgb *= 1.0 - 0.22 * rut * ${ruts.toFixed(2)};
            float crown = exp(-pow(vAcross / 0.35, 2.0)) * ${ruts > 0.6 ? '0.35' : '0.0'};
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.2, 0.08), crown * 0.6);
            diffuseColor.rgb *= mix(1.0, 0.6, uWeather.x);
            diffuseColor.a *= smoothstep(0.0, 1.0, vEdge);`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.2, uWeather.x * 0.8);');
      };
      m.customProgramCacheKey = () => 'road' + ruts;
      return m;
    };
    this.materials.gravel = mk(gravel, ROAD_TINT.gravel, 0.5);
    this.materials.dirt = mk(gravel, ROAD_TINT.dirt, 1.0);
    this.materials.rock = mk(gravel, ROAD_TINT.rock, 0.3);
    this.materials.mud = mk(mud, ROAD_TINT.mud, 1.0);

    const g = { h: 0 };
    const field = world.field;
    for (const r of world.meta.roads) {
      const pts = r.pts, n = pts.length;
      const W = r.w + 0.6, S = 2.2; // half width + soft shoulder
      const offs = [-W - S, -W, -W * 0.5, 0, W * 0.5, W, W + S];
      const edges = [0, 1, 1, 1, 1, 1, 0];
      const cols = offs.length;
      const pos = new Float32Array(n * cols * 3), uv = new Float32Array(n * cols * 2), ed = new Float32Array(n * cols), ac = new Float32Array(n * cols);
      let dist = 0;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let dx = b[0] - a[0], dz = b[2] - a[2]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        if (i > 0) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
        for (let c = 0; c < cols; c++) {
          const x = pts[i][0] - dz * offs[c], z = pts[i][2] + dx * offs[c];
          collision.ground(x, z, pts[i][1] + 1, g);
          const k = i * cols + c;
          pos[k * 3] = x; pos[k * 3 + 1] = g.h + 0.035; pos[k * 3 + 2] = z;
          uv[k * 2] = (offs[c] + W + S) / 4; uv[k * 2 + 1] = dist / 4;
          ed[k] = edges[c] * (pts[i][3] ? 0 : 1); // bridge decks have their own surface
          ac[k] = offs[c];
        }
      }
      const idx = [];
      for (let i = 0; i < n - 1; i++) for (let c = 0; c < cols - 1; c++) {
        const a = i * cols + c, b = a + 1, d = a + cols, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('edge', new THREE.BufferAttribute(ed, 1));
      geo.setAttribute('across', new THREE.BufferAttribute(ac, 1));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.materials[r.surface] || this.materials.gravel);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      this.group.add(mesh);
    }
    this._buildDrift(world.meta.drift, collision, gravel);
    this._buildBridges(world.meta, collision, aniso);
  }

  _buildDrift(d, collision, gravel) {
    // compacted dirt circuit with accumulated tyre marks
    const pts = d.pts, n = pts.length, W = d.width;
    const g = { h: 0 };
    const offs = [-W / 2 - 3, -W / 2, -W / 4, 0, W / 4, W / 2, W / 2 + 3], edges = [0, 1, 1, 1, 1, 1, 0], cols = offs.length;
    const pos = new Float32Array((n + 1) * cols * 3), uv = new Float32Array((n + 1) * cols * 2), ed = new Float32Array((n + 1) * cols), ac = new Float32Array((n + 1) * cols);
    let dist = 0;
    for (let i = 0; i <= n; i++) {
      const p = pts[i % n], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz); dx /= L; dz /= L;
      if (i > 0) dist += Math.hypot(p[0] - a[0], p[1] - a[1]);
      for (let c = 0; c < cols; c++) {
        const x = p[0] - dz * offs[c], z = p[1] + dx * offs[c];
        collision.ground(x, z, undefined, g);
        const k = i * cols + c;
        pos[k * 3] = x; pos[k * 3 + 1] = g.h + 0.04; pos[k * 3 + 2] = z;
        uv[k * 2] = (offs[c] + W / 2 + 3) / 4; uv[k * 2 + 1] = dist / 4;
        ed[k] = edges[c]; ac[k] = offs[c];
      }
    }
    const idx = [];
    for (let i = 0; i < n; i++) for (let c = 0; c < cols - 1; c++) { const a = i * cols + c, b = a + 1, e = a + cols, f = e + 1; idx.push(a, e, b, b, e, f); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('edge', new THREE.BufferAttribute(ed, 1)); geo.setAttribute('across', new THREE.BufferAttribute(ac, 1));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = this.materials.dirt.clone();
    m.onBeforeCompile = (s) => {
      this.materials.dirt.onBeforeCompile(s);
      s.fragmentShader = s.fragmentShader.replace('diffuseColor.a *= smoothstep(0.0, 1.0, vEdge);', `diffuseColor.a *= smoothstep(0.0, 1.0, vEdge);
        // swept drift arcs: dark rubber-and-dirt marks across the racing line
        float arcs = 0.0;
        for (int k = 0; k < 4; k++) {
          float fk = float(k);
          float c = sin(vMapUv.y * (0.9 + fk * 0.37) + fk * 1.7) * 1.4 + (fk - 1.5) * 0.9;
          arcs += exp(-pow((vAcross - c) / 0.18, 2.0)) * (0.5 + 0.5 * sin(vMapUv.y * 0.3 + fk));
        }
        diffuseColor.rgb *= 1.0 - 0.28 * clamp(arcs, 0.0, 1.0);`);
    };
    m.customProgramCacheKey = () => 'drift-track';
    const mesh = new THREE.Mesh(geo, m);
    mesh.receiveShadow = true; mesh.renderOrder = 1;
    this.group.add(mesh);
  }

  _buildBridges(meta, collision, aniso) {
    const planks = new THREE.MeshStandardMaterial({ map: tex('assets/textures/planks_diff.jpg', true, aniso), normalMap: tex('assets/textures/planks_nor.jpg', false, aniso), roughnessMap: tex('assets/textures/planks_arm.jpg', false, aniso), roughness: 1 });
    const stone = new THREE.MeshStandardMaterial({ map: tex('assets/textures/stone_wall_diff.jpg', true, aniso), normalMap: tex('assets/textures/stone_wall_nor.jpg', false, aniso), roughnessMap: tex('assets/textures/stone_wall_arm.jpg', false, aniso), roughness: 1 });
    const timber = new THREE.MeshStandardMaterial({ map: planks.map, color: 0x9b8a78, roughness: 0.95 });
    const field = this.world.field;
    for (const b of meta.bridges) {
      // deck = flat part of the polyline (the extra approach samples are terrain)
      const P = b.pts.slice(4, b.pts.length - 4);
      if (P.length < 2) continue;
      const mat = b.kind === 'stone' ? stone : planks;
      const W = b.w / 2;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], c = P[i + 1];
        const dx = c[0] - a[0], dz = c[2] - a[2], L = Math.hypot(dx, dz);
        const rot = Math.atan2(dx, dz);
        const mid = new THREE.Vector3((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
        const thick = b.kind === 'stone' ? 0.9 : 0.35;
        const deck = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.4, thick, L + 0.05), mat);
        deck.position.copy(mid).add(new THREE.Vector3(0, -thick / 2, 0));
        deck.rotation.y = rot;
        deck.geometry.attributes.uv.array.forEach((v, k, arr) => { arr[k] = v * (k % 2 ? L / 2 : W); });
        deck.castShadow = deck.receiveShadow = true;
        this.group.add(deck);
        for (const side of [-1, 1]) {
          const nx = -dz / L, nz = dx / L;
          const rail = new THREE.Mesh(new THREE.BoxGeometry(b.kind === 'stone' ? 0.45 : 0.12, b.kind === 'stone' ? 0.8 : 0.12, L + 0.05), b.kind === 'stone' ? stone : timber);
          rail.position.set(mid.x + nx * (W + 0.1) * side, mid.y + (b.kind === 'stone' ? 0.4 : 0.95), mid.z + nz * (W + 0.1) * side);
          rail.rotation.y = rot; rail.castShadow = true;
          this.group.add(rail);
          if (b.kind !== 'stone') {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), timber);
            post.position.set(a[0] + nx * (W + 0.1) * side, a[1] + 0.5, a[2] + nz * (W + 0.1) * side);
            post.castShadow = true;
            this.group.add(post);
          }
        }
      }
      // piers down to the riverbed every ~8 m
      for (let i = 2; i < P.length - 2; i += 4) {
        const p = P[i];
        const bed = field.baseHeight(p[0], p[2]);
        const h = p[1] - bed + 0.5;
        if (h < 1.2) continue;
        const pier = new THREE.Mesh(b.kind === 'stone' ? new THREE.BoxGeometry(W * 2, h, 1.6) : new THREE.CylinderGeometry(0.22, 0.26, h, 10), b.kind === 'stone' ? stone : timber);
        pier.position.set(p[0], bed + h / 2 - 0.5, p[2]);
        if (b.kind === 'stone') pier.rotation.y = Math.atan2(P[i + 1][0] - p[0], P[i + 1][2] - p[2]);
        pier.castShadow = true;
        this.group.add(pier);
        if (b.kind !== 'stone') for (const side of [-1, 1]) {
          const dx = P[i + 1][0] - p[0], dz = P[i + 1][2] - p[2], L = Math.hypot(dx, dz);
          const p2 = pier.clone(); p2.position.x += -dz / L * (W - 0.5) * side; p2.position.z += dx / L * (W - 0.5) * side; this.group.add(p2);
        }
      }
    }
    for (const o of bridgeRailColliders(meta)) collision.add(o);
  }
}
