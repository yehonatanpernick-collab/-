// Visual rig for the supplied RZR models.
//  Model A (rzr_xp1000_ccby.glb): has named suspension/steer/rotation bones per wheel.
//  Model B (rzr_xp1000_highlifter_ccbyncsa.glb): flattened, 1/100 scale; wheels found by mesh name.
// Both: forward = +Z, left = +X, ground at y = 0, wheel centres ~0.374 m.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SPEC } from './physics.js';
import { assetUrl } from '../util.js';

const WHEELS = ['FL', 'FR', 'BL', 'BR'];

// Model A ships one glow mesh whose front half sits 1.2 m ahead of the car (broken export).
function stripStrayTriangles(mesh, maxZ) {
  const g = mesh.geometry;
  mesh.updateWorldMatrix(true, false);
  const pos = g.attributes.position, idx = g.index;
  const v = new THREE.Vector3();
  const keep = [];
  const tri = idx ? idx.count / 3 : pos.count / 3;
  for (let t = 0; t < tri; t++) {
    let bad = false;
    for (let k = 0; k < 3; k++) {
      const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
      v.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
      if (v.z > maxZ) bad = true;
    }
    if (!bad) for (let k = 0; k < 3; k++) keep.push(idx ? idx.getX(t * 3 + k) : t * 3 + k);
  }
  g.setIndex(keep);
  return tri - keep.length / 3;
}

export class VehicleModel {
  constructor() {
    this.root = new THREE.Group();      // follows the physics body (model origin)
    this.body = new THREE.Group();      // chassis visuals (gets a little extra body roll/pitch lag)
    this.root.add(this.body);
    this.wheels = {};
    this.armTravel = new THREE.Vector4(); // per-corner wheel travel for the arm deformation
    this.lights = {};
  }

  async load(variant, renderer) {
    const url = variant === 'b' ? 'assets/vehicles/rzr_xp1000_highlifter_ccbyncsa.glb' : 'assets/vehicles/rzr_xp1000_ccby.glb';
    const gltf = await new GLTFLoader().loadAsync(assetUrl(url));
    const scene = gltf.scene;
    if (variant === 'b') scene.scale.setScalar(100);
    scene.updateMatrixWorld(true);
    this.body.add(scene);
    this.body.updateMatrixWorld(true);
    const aniso = renderer.capabilities.getMaxAnisotropy();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (m[k]) m[k].anisotropy = Math.min(8, aniso);
        m.envMapIntensity = 0.8;
      }
    });
    const find = (re) => { let r = null; scene.traverse(o => { if (!r && re.test(o.name)) r = o; }); return r; };
    const findAll = (re) => { const r = []; scene.traverse(o => { if (re.test(o.name)) r.push(o); }); return r; };

    if (variant !== 'b') {
      const glow = find(/lights_position_front_and_back_glows.*_0$/) || find(/lights_position_front_and_back/);
      if (glow) { glow.traverse(m => { if (m.isMesh) stripStrayTriangles(m, 1.6); }); }
    }

    // wheel pivots: suspension (translate) -> steer (yaw) -> spin (pitch)
    for (const W of WHEELS) {
      let tyreNodes, caliper, center;
      if (variant !== 'b') {
        const wheel = find(new RegExp(`^Wheel${W}$`));
        caliper = find(new RegExp(`^bone_caliper_${W}$`));
        tyreNodes = [wheel];
        center = new THREE.Box3().setFromObject(wheel.getObjectByName(`Wheel${W}_tyre`) || wheel).getCenter(new THREE.Vector3());
      } else {
        const tyre = find(new RegExp(`Wheel${W}_tyre_Wheel${W}_tyre_None$`));
        const rim = find(new RegExp(`Wheel${W}_details_Wheel${W}_details_None$`));
        caliper = find(new RegExp(`bone_caliper_${W}_details_bone_caliper_${W}_details_None$`));
        tyreNodes = [tyre, rim].filter(Boolean);
        center = new THREE.Box3().setFromObject(tyre).getCenter(new THREE.Vector3());
      }
      const susp = new THREE.Group(); susp.position.copy(center); this.body.add(susp);
      const steer = new THREE.Group(); susp.add(steer);
      const spin = new THREE.Group(); steer.add(spin);
      susp.updateMatrixWorld(true);
      for (const n of tyreNodes) spin.attach(n);
      if (caliper) steer.attach(caliper);
      this.wheels[W] = { susp, steer, spin, rest: center.clone() };
    }

    // suspension arms / shocks: deform toward each wheel hub (the export lost its skin)
    const arms = variant !== 'b' ? findAll(/^skinned_mesh_/) : findAll(/skinned_mesh_/);
    const travel = this.armTravel;
    for (const a of arms) a.traverse((m) => {
      if (!m.isMesh) return;
      m.material = m.material.clone();
      m.updateWorldMatrix(true, false);
      const toBody = m.matrixWorld.clone();            // body is at the origin while loading
      const fromBody = toBody.clone().invert();
      m.material.onBeforeCompile = (s) => {
        s.uniforms.uArm = { value: travel };
        s.uniforms.uToBody = { value: toBody };
        s.uniforms.uFromBody = { value: fromBody };
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform vec4 uArm; uniform mat4 uToBody, uFromBody;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 bp = (uToBody * vec4(position, 1.0)).xyz;
            float wx = clamp((abs(bp.x) - 0.22) / 0.45, 0.0, 1.0);
            float tr = bp.z > 0.0 ? (bp.x > 0.0 ? uArm.x : uArm.y) : (bp.x > 0.0 ? uArm.z : uArm.w);
            transformed += (uFromBody * vec4(0.0, tr * wx, 0.0, 0.0)).xyz;
          }`);
      };
      m.material.customProgramCacheKey = () => 'rzr-arm';
    });

    // lamps
    const brakeMeshes = findAll(/lights_brakes/), reverseMeshes = findAll(/lights_reverse/);
    const setupLamp = (list, color) => list.map(o => { let mm = null; o.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.emissive = new THREE.Color(color); m.material.emissiveIntensity = 0; mm = m.material; } }); return mm; }).filter(Boolean);
    this.lights.brake = setupLamp(brakeMeshes, 0xff2010);
    this.lights.reverse = setupLamp(reverseMeshes, 0xffffff);
    // headlights (real lights)
    const hl = new THREE.SpotLight(0xfff2dd, 0, 90, 0.5, 0.45, 1.4);
    hl.position.set(0, 0.95, 1.45); hl.target.position.set(0, 0.2, 12);
    this.body.add(hl, hl.target);
    this.lights.head = hl;
    const lampGeo = new THREE.SphereGeometry(0.06, 10, 8);
    this.lights.lamps = [0.42, -0.42].map(x => { const m = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0x222222 })); m.position.set(x, 0.92, 1.47); this.body.add(m); return m; });
    this.variant = variant;
    return this;
  }

  // sync from physics; alpha is unused (physics runs at 200 Hz, render interpolates outside)
  update(phys, pos, quat, dt, headlights) {
    this.root.position.copy(pos).sub(new THREE.Vector3(...SPEC.com).applyQuaternion(quat));
    this.root.quaternion.copy(quat);
    const map = { FL: 0, FR: 1, BL: 2, BR: 3 };
    const tr = [0, 0, 0, 0];
    for (const W of WHEELS) {
      const pw = phys.wheels[map[W]], vw = this.wheels[W];
      // physics wheel centre relative to rest (body frame)
      const dy = (SPEC.restLen - pw.len) - (SPEC.restLen - 0.25) - pw.sinkage * 0; // 0.25 = static length at model rest pose
      vw.susp.position.y = vw.rest.y + dy;
      vw.steer.rotation.y = pw.steer;
      vw.spin.rotation.x = pw.angle;
      tr[map[W]] = dy;
    }
    this.armTravel.set(tr[0], tr[1], tr[2], tr[3]);
    const braking = phys.input.brake > 0.05 && !phys.reversing;
    for (const m of this.lights.brake) m.emissiveIntensity = braking ? 4 : (headlights ? 0.8 : 0);
    for (const m of this.lights.reverse) m.emissiveIntensity = phys.reversing ? 3 : 0;
    this.lights.head.intensity = headlights ? 60 : 0;
    for (const l of this.lights.lamps) l.material.color.setHex(headlights ? 0xfff6e0 : 0x222222);
  }
}
