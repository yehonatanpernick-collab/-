// Rock outcrops: instanced photogrammetry rock faces (Poly Haven scans, two LODs each)
// breaking through steep grass and scree slopes, the way AAA landscapes break up heightfields.
// Placement is deterministic (hash grid over the core map), oriented to the slope, partly
// buried, tinted toward the local limestone and snow-capped on upward faces high up.
// Instances are re-binned by distance as the camera moves: LOD0 near, LOD1 out to the far ring.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { hash2 } from '../world/heightfield.js';
import { assetUrl } from '../util.js';

const MODELS = ['mountainside', 'rock_face_01', 'rock_face_02', 'coastal_cliff_01', 'namaqualand_cliff_02'];
const SPACING = 22;          // m between candidate sites

function patchMaterial(m) {
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW; varying vec3 vCN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 cw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vCW = cw.xyz; vCN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW; varying vec3 vCN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // pull the scans toward the valley's grey limestone so they sit in the terrain
          float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l) * vec3(0.98, 0.96, 0.92), 0.7) * 1.05;
          // snow settles on upward faces above the snowline
          float n = fract(sin(dot(floor(vCW.xz * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
          float snow = smoothstep(2350.0, 2650.0, vCW.y + n * 120.0) * smoothstep(0.45, 0.8, normalize(vCN).y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), snow);
        }`);
  };
  m.customProgramCacheKey = () => 'cliff-dress';
  m.envMapIntensity = 0.5;
  return m;
}

class Cliffs {
  constructor(game, models) {
    this.game = game;
    const q = game.quality;
    const far = { low: 500, medium: 800, high: 1300, ultra: 1800 }[game.qualityName] || 1300;
    this.r0 = q.pixelRatio < 1 ? 220 : 340;   // LOD0 radius
    this.r1 = far;                            // LOD1 radius
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.kinds = models.map(({ lod0, lod1 }) => {
      const mk = (geo, mat, cap) => {
        const im = new THREE.InstancedMesh(geo, mat, cap);
        im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
        this.group.add(im); return im;
      };
      geoBounds(lod0.geo);
      return { m0: mk(lod0.geo, patchMaterial(lod0.mat), 600), m1: mk(lod1.geo, patchMaterial(lod1.mat), 2500), size: lod0.geo.boundingBox.getSize(new THREE.Vector3()) };
    });
    this._place();
    this.last = new THREE.Vector3(1e9, 0, 0);
  }

  _place() {
    const f = this.game.world.field, n = new THREE.Vector3();
    const half = 4096 - 60, N = Math.floor(2 * half / SPACING);
    const mats = [], kinds = [], pos = [];
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), basis = new THREE.Matrix4();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const h1 = hash2(i + 501, j - 77), h2 = hash2(i - 33, j + 909), h3 = hash2(i + 71, j + 13);
      const x = -half + (i + h1) * SPACING, z = -half + (j + h2) * SPACING;
      f.normal(x, z, n, 7);
      // outcrops break through steep grassy/scree slopes (35-57 deg); sheer walls keep the shader rock
      if (n.y > 0.82 || n.y < 0.55 || h3 > 0.55) continue;
      if (f.mask(x, z, 4) > 0.05 || f.mask(x, z, 5) > 0.2) continue;
      const k = Math.floor(hash2(i * 3 + 1, j * 7 + 2) * this.kinds.length);
      const size = this.kinds[k].size;
      // standing upright (slightly leaning with the slope), face looking downhill
      Y.copy(up).lerp(n, 0.3).normalize();
      Z.set(n.x, 0, n.z).normalize();
      X.crossVectors(Y, Z).normalize();
      Z.crossVectors(X, Y).normalize();
      basis.makeBasis(X, Y, Z);
      qt.setFromRotationMatrix(basis);
      qt.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (h3 - 0.5) * 0.7));
      qt.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (h1 - 0.5) * 0.8));
      const width = 8 + 16 * h2 * h2;
      const s = width / Math.max(4, size.x);
      sc.setScalar(s);
      // sit the base below ground and push the body back into the slope
      const y = f.baseHeight(x, z);
      p.set(x, y - size.y * s * 0.3, z).addScaledVector(Z, -size.z * s * 0.25);
      m.compose(p, qt, sc);
      mats.push(...m.elements); kinds.push(k); pos.push(x, y, z);
    }
    this.mats = new Float32Array(mats); this.kindOf = new Uint8Array(kinds); this.pos = new Float32Array(pos);
    this.count = kinds.length;
  }

  update(dt, game) {
    const c = game.camera.position;
    if (c.distanceToSquared(this.last) < 30 * 30) return;
    this.last.copy(c);
    for (const k of this.kinds) { k.m0.count = 0; k.m1.count = 0; }
    const r0 = this.r0 * this.r0, r1 = this.r1 * this.r1;
    for (let i = 0; i < this.count; i++) {
      const dx = this.pos[i * 3] - c.x, dz = this.pos[i * 3 + 2] - c.z, d = dx * dx + dz * dz;
      if (d > r1) continue;
      const K = this.kinds[this.kindOf[i]], im = d < r0 ? K.m0 : K.m1;
      if (im.count >= im.instanceMatrix.count) continue;
      im.instanceMatrix.array.set(this.mats.subarray(i * 16, i * 16 + 16), im.count * 16);
      im.count++;
    }
    for (const k of this.kinds) { k.m0.instanceMatrix.needsUpdate = true; k.m1.instanceMatrix.needsUpdate = true; }
  }
}

function geoBounds(g) { if (!g.boundingBox) g.computeBoundingBox(); }

async function loadLOD(loader, url) {
  const gltf = await loader.loadAsync(assetUrl(url));
  let mesh = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
  const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  geo.computeBoundingBox();
  const bb = geo.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  geo.translate(-cx, -bb.min.y, -cz);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const mat = mesh.material;
  for (const k of ['map', 'normalMap', 'roughnessMap']) if (mat[k]) mat[k].anisotropy = 4;
  return { geo, mat };
}

export async function create(game) {
  const loader = new GLTFLoader();
  const models = await Promise.all(MODELS.map(async (n) => {
    const [lod0, lod1] = await Promise.all([loadLOD(loader, `assets/models/cliffs/${n}_lod0.glb`), loadLOD(loader, `assets/models/cliffs/${n}_lod1.glb`)]);
    // both LODs must share the same placement frame: use LOD0's bounds for LOD1 too
    lod1.geo.boundingBox = lod0.geo.boundingBox.clone();
    return { lod0, lod1 };
  }));
  return new Cliffs(game, models);
}
