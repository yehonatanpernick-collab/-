// Wildlife: soaring golden eagles over the valleys and small bird flocks near forest edges.
// Birds are seen at distance, so a carefully proportioned, animated silhouette mesh with
// layered primaries reads correctly; ground animals need scanned/rigged assets (see docs).
import * as THREE from 'three';

function birdGeometry(span, body) {
  // body + two wings with split primaries; wing vertices tagged for flapping (attribute 'wing')
  const v = [], w = [], idx = [];
  const add = (x, y, z, k) => { v.push(x, y, z); w.push(k); return v.length / 3 - 1; };
  // body (diamond)
  const nose = add(0, 0, body * 0.55, 0), tail = add(0, 0, -body * 0.5, 0), top = add(0, body * 0.09, 0, 0), bot = add(0, -body * 0.1, 0.05, 0);
  const l = add(body * 0.09, 0, 0, 0), r = add(-body * 0.09, 0, 0, 0);
  idx.push(nose, l, top, nose, top, r, nose, bot, l, nose, r, bot, tail, top, l, tail, r, top, tail, l, bot, tail, bot, r);
  // tail fan
  const t1 = add(body * 0.12, 0, -body * 0.75, 0), t2 = add(-body * 0.12, 0, -body * 0.75, 0);
  idx.push(tail, t1, t2);
  for (const s of [1, -1]) {
    const root0 = add(s * body * 0.08, 0, body * 0.15, 0), root1 = add(s * body * 0.08, 0, -body * 0.15, 0);
    const mid0 = add(s * span * 0.28, 0.02, body * 0.12, 0.5), mid1 = add(s * span * 0.28, 0.02, -body * 0.2, 0.5);
    const tip0 = add(s * span * 0.5, 0.0, 0.0, 1), f1 = add(s * span * 0.47, 0, -body * 0.12, 1), f2 = add(s * span * 0.42, 0, -body * 0.22, 1);
    idx.push(root0, mid0, root1, root1, mid0, mid1, mid0, tip0, f1, mid0, f1, mid1, mid1, f1, f2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('wing', new THREE.Float32BufferAttribute(w, 1));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

class Wildlife {
  constructor(game) {
    this.game = game;
    this.t = 0;
    const meta = game.world.meta;
    const mk = (span, body, color, n) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide });
      const uni = { uFlap: { value: 0 } };
      m.onBeforeCompile = (s) => {
        s.uniforms.uT = { value: 0 }; this.shaders.push(s);
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float wing; uniform float uT;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
              float ph = instanceMatrix[3][0] * 0.1 + instanceMatrix[3][2] * 0.07;
              float flap = sin(uT * (${span > 1 ? '3.0' : '11.0'}) + ph) * (${span > 1 ? '0.25 + 0.75 * step(0.85, fract(uT * 0.05 + ph))' : '1.0'});
              transformed.y += wing * flap * ${(span * 0.35).toFixed(2)};
            #endif`);
      };
      const im = new THREE.InstancedMesh(birdGeometry(span, body), m, n);
      im.frustumCulled = false; im.castShadow = true;
      game.scene.add(im);
      return im;
    };
    this.shaders = [];
    // eagles circle on thermals above valley slopes
    this.eagles = [];
    const centres = [[-500, -1200], [2300, -700], [-2400, -300], [1700, 1300], [200, -3300], [-1600, 2600]];
    for (const [x, z] of centres) {
      const g = game.world.field.baseHeight(x, z);
      this.eagles.push({ cx: x, cz: z, alt: g + 180 + Math.random() * 250, r: 90 + Math.random() * 120, w: (Math.random() < 0.5 ? 1 : -1) * (0.08 + Math.random() * 0.05), a: Math.random() * 6.28, drift: Math.random() * 6.28 });
    }
    this.eagleMesh = mk(2.1, 0.9, 0x3a2a1c, this.eagles.length);
    // songbird flocks around forest edges
    this.flocks = [];
    for (let i = 0; i < 6; i++) this.flocks.push({ x: (Math.random() - 0.5) * 6000, z: (Math.random() - 0.5) * 6000, n: 12, ph: Math.random() * 10 });
    this.birdMesh = mk(0.28, 0.14, 0x2b2622, this.flocks.length * 12);
    this.M = new THREE.Matrix4(); this.Q = new THREE.Quaternion(); this.E = new THREE.Euler(); this.S = new THREE.Vector3(1, 1, 1); this.P = new THREE.Vector3();
  }

  update(dt, game) {
    this.t += dt;
    for (const s of this.shaders) s.uniforms.uT.value = this.t;
    const cam = game.camera.position;
    this.eagles.forEach((e, i) => {
      e.a += e.w * dt;
      e.drift += dt * 0.02;
      const cx = e.cx + Math.cos(e.drift) * 300, cz = e.cz + Math.sin(e.drift * 0.7) * 300;
      const x = cx + Math.cos(e.a) * e.r, z = cz + Math.sin(e.a) * e.r, y = e.alt + Math.sin(this.t * 0.1 + i) * 25;
      const heading = Math.atan2(-Math.sin(e.a) * Math.sign(e.w), Math.cos(e.a) * Math.sign(e.w));
      this.E.set(0, heading, -Math.sign(e.w) * 0.35);
      this.Q.setFromEuler(this.E); this.P.set(x, y, z);
      this.M.compose(this.P, this.Q, this.S);
      this.eagleMesh.setMatrixAt(i, this.M);
    });
    this.eagleMesh.instanceMatrix.needsUpdate = true;
    let k = 0;
    for (const f of this.flocks) {
      // flocks migrate slowly and stay near the player region so they are actually seen
      f.ph += dt;
      if (Math.hypot(f.x - cam.x, f.z - cam.z) > 1500) { f.x = cam.x + (Math.random() - 0.5) * 1600; f.z = cam.z + (Math.random() - 0.5) * 1600; }
      f.x += Math.cos(f.ph * 0.13) * dt * 9; f.z += Math.sin(f.ph * 0.11) * dt * 9;
      const g = game.world.field.inCore(f.x, f.z) ? game.world.field.baseHeight(f.x, f.z) : cam.y;
      for (let i = 0; i < f.n; i++) {
        const a = f.ph * 0.9 + i * 0.53;
        this.P.set(f.x + Math.cos(a * 1.3 + i) * (6 + i % 4 * 3), g + 25 + Math.sin(a * 2 + i) * 4, f.z + Math.sin(a + i * 0.7) * (7 + i % 3 * 3));
        this.E.set(0, f.ph * 0.13 + Math.PI / 2, 0); this.Q.setFromEuler(this.E);
        this.M.compose(this.P, this.Q, this.S);
        this.birdMesh.setMatrixAt(k++, this.M);
      }
    }
    this.birdMesh.instanceMatrix.needsUpdate = true;
  }
}

export function create(game) { return new Wildlife(game); }
