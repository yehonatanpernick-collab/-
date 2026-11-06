import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { float, uniform, vec3, sin, time, uv, length, smoothstep, atan, fract, mix, abs } from 'three/tsl';

/**
 * Hero vehicle visual model: the Khronos "Car Concept" glTF (CC-BY 4.0) re-materialed as a pearl-white
 * premium EV and extended with custom flight hardware (fold-out hub-turbine wheels, rear vectoring
 * thrusters, side winglets, LED light bar, underbody glow).
 *
 * Vehicle local frame: +Z forward, +Y up, +X = driver (left) side. Origin = ground under the car centre.
 */
export interface WheelRig { steer: THREE.Object3D; spin: THREE.Object3D; fold: THREE.Object3D; fan: THREE.Mesh; base: THREE.Vector3; side: number; front: boolean }

export class VehicleModel {
  root = new THREE.Group();
  body = new THREE.Group();        // everything that moves with the sprung chassis
  wheels: WheelRig[] = [];
  wheelRadius = 0.36;
  steeringWheel: THREE.Object3D | null = null;
  driverEye = new THREE.Vector3(0, 1.02, -0.15);
  steerPos = new THREE.Vector3(0, 0.7, 0.4);
  readonly glow = uniform(0);       // flight systems glow 0..1
  readonly brake = uniform(0);
  readonly headlights = uniform(1);
  readonly thrust = uniform(0);
  private thrusters: THREE.Object3D[] = [];
  private winglets: THREE.Object3D[] = [];
  private screens: { mesh: THREE.Mesh; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }[] = [];
  dash!: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture };
  private headLight!: THREE.SpotLight;
  bboxSize = new THREE.Vector3();

  async load(url: string): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    this.restyle(scene);
    this.root.add(this.body);
    this.body.add(scene);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    box.getSize(this.bboxSize);
    // rig wheels: steer (yaw) → fold (roll for flight) → spin (axle)
    const names: [string, number, boolean][] = [['WheelFrontL', 1, true], ['WheelFrontR', -1, true], ['WheelRearL', 1, false], ['WheelRearR', -1, false]];
    for (const [n, side, front] of names) {
      const w = scene.getObjectByName(n);
      if (!w) continue;
      const wp = new THREE.Vector3(); w.getWorldPosition(wp);
      const steer = new THREE.Group(); steer.position.copy(wp); this.root.add(steer);
      const fold = new THREE.Group(); steer.add(fold);
      const spin = new THREE.Group(); fold.add(spin);
      spin.attach(w);
      // hub turbine (visible when the wheel folds flat)
      const fan = this.makeFan();
      fan.rotation.y = Math.PI / 2; // disc in the wheel plane (normal = axle)
      fan.position.x = -side * 0.05;
      fold.add(fan);
      this.wheels.push({ steer, spin, fold, fan, base: wp.clone(), side, front });
    }
    this.wheelRadius = this.wheels.length ? Math.max(0.3, this.wheels[0].base.y) : 0.36;
    const sw = scene.getObjectByName('InteriorSteeringCylinder');
    if (sw) this.steeringWheel = sw;
    // centre-mounted steering (concept-car layout): the driver's eye sits behind and above the wheel
    if (sw) {
      const sp = new THREE.Vector3(); sw.getWorldPosition(sp);
      this.steerPos.copy(sp);
      this.driverEye.set(sp.x, sp.y + 0.47, sp.z - 0.72);
    }
    this.addFlightHardware(box);
    this.addDashboard(scene);
    // headlight beams (one spot light for the pair — cheap & effective at night)
    this.headLight = new THREE.SpotLight(0xf2f6ff, 0, 90, 0.5, 0.6, 1.4);
    this.headLight.position.set(0, 0.7, 2.0);
    this.headLight.target.position.set(0, -1.5, 25);
    this.headLight.castShadow = false;
    this.body.add(this.headLight, this.headLight.target);
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  private restyle(scene: THREE.Object3D): void {
    const paint = new THREE.MeshPhysicalNodeMaterial({ color: 0xeeeeec, metalness: 0.15, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03 });
    paint.name = 'SkydrivePearl';
    const black = new THREE.MeshPhysicalNodeMaterial({ color: 0x0b0c0e, metalness: 0.4, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });
    const interior = new THREE.MeshStandardNodeMaterial({ color: 0xe9e6df, roughness: 0.55 });
    const interiorDark = new THREE.MeshStandardNodeMaterial({ color: 0x1b1c1f, roughness: 0.6 });
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const out = mats.map((mat) => {
        const n = mat.name || '';
        if (n.startsWith('Paint 1')) return paint;
        if (n.startsWith('Paint 2')) return black;
        if (n.startsWith('Interior 3')) return interior;
        if (n === 'Interior 2' || n === 'Dashboard') return interiorDark;
        if (n === 'Headlight') {
          const h = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.2 });
          h.emissiveNode = vec3(0.9, 0.95, 1.0).mul(this.headlights.mul(3.0).add(this.glow.mul(1.5)));
          return h;
        }
        if (n === 'Brakelight') {
          const b = new THREE.MeshStandardNodeMaterial({ color: 0x400000, roughness: 0.2 });
          b.emissiveNode = vec3(1.0, 0.02, 0.02).mul(float(0.6).add(this.brake.mul(4.0)).add(this.headlights.mul(0.6)));
          return b;
        }
        if (n === 'Glass') {
          const g = new THREE.MeshPhysicalNodeMaterial({ color: 0x0c1014, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.35, side: THREE.DoubleSide, envMapIntensity: 1.6 });
          g.depthWrite = false;
          return g;
        }
        if (n === 'Signallight') {
          const s = new THREE.MeshStandardNodeMaterial({ color: 0x553300, roughness: 0.3 });
          s.emissiveNode = vec3(1.0, 0.5, 0.0).mul(this.glow.mul(0.0));
          return s;
        }
        return mat;
      });
      m.material = Array.isArray(m.material) ? out : out[0];
      if (/Khronos|License/i.test(m.name)) m.visible = false;
    });
  }

  private makeFan(): THREE.Mesh {
    // ducted hub turbine: TSL-procedural blades + glowing ring, rendered as a disc inside the wheel
    const g = new THREE.CircleGeometry(0.31, 40);
    const m = new THREE.MeshStandardNodeMaterial({ transparent: true, side: THREE.DoubleSide, roughness: 0.3, metalness: 0.8 });
    const p = uv().sub(0.5);
    const r = length(p).mul(2);
    const a = atan(p.y, p.x);
    const spinA = a.add(time.mul(this.thrust.mul(40).add(this.glow.mul(8))));
    const blade = smoothstep(0.35, 0.5, abs(fract(spinA.mul(9 / 6.2832)).sub(0.5)).mul(2).oneMinus());
    const ring = smoothstep(0.78, 0.86, r).mul(smoothstep(1.0, 0.92, r));
    const hub = smoothstep(0.22, 0.18, r);
    m.colorNode = mix(vec3(0.08, 0.09, 0.1), vec3(0.6, 0.62, 0.65), blade);
    m.emissiveNode = vec3(0.2, 0.85, 1.0).mul(ring.mul(4).add(hub.mul(2)).add(blade.mul(0.3))).mul(this.glow);
    m.opacityNode = this.glow.mul(smoothstep(1.0, 0.97, r));
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = false;
    return mesh;
  }

  private addFlightHardware(box: THREE.Box3): void {
    const carbon = new THREE.MeshPhysicalNodeMaterial({ color: 0x121417, metalness: 0.6, roughness: 0.35, clearcoat: 0.8 });
    const glowMat = new THREE.MeshStandardNodeMaterial({ color: 0x0a1418 });
    glowMat.emissiveNode = vec3(0.25, 0.8, 1.0).mul(this.glow.mul(3.5).add(this.thrust.mul(4)));
    const plumeMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    plumeMat.colorNode = vec3(0.35, 0.75, 1.0).mul(this.thrust.mul(1.4).add(this.glow.mul(0.2)));
    plumeMat.opacityNode = smoothstep(0.0, 1.0, uv().y).mul(this.glow).mul(sin(time.mul(60)).mul(0.08).add(0.9));
    const zRear = box.min.z;
    for (const side of [1, -1]) {
      // rear vectoring thruster pods (slide out of the rear diffuser)
      const pod = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.62, 20, 1, true), carbon);
      shell.rotation.x = Math.PI / 2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 24), glowMat);
      ring.position.z = -0.31;
      const core = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), glowMat);
      core.position.z = -0.28; core.rotation.y = Math.PI;
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.14, 1.6, 16, 1, true), plumeMat);
      plume.rotation.x = -Math.PI / 2; plume.position.z = -1.1;
      pod.add(shell, ring, core, plume);
      pod.position.set(side * 0.55, 0.42, zRear + 0.35);
      pod.userData.base = pod.position.clone();
      pod.scale.setScalar(0.001);
      this.body.add(pod);
      this.thrusters.push(pod);
      // side winglets (extend from the rocker panels)
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.035, 1.5), carbon);
      wing.position.set(side * 0.38, 0, 0);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 1.5), glowMat);
      edge.position.set(side * 0.76, 0, 0);
      const wg = new THREE.Group();
      wg.add(wing, edge);
      wg.position.set(side * 0.78, 0.36, -0.2);
      wg.scale.set(0.001, 1, 1);
      this.body.add(wg);
      this.winglets.push(wg);
    }
    // front LED light bar
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.025, 0.03), glowMat);
    bar.position.set(0, 0.64, box.max.z - 0.28);
    this.body.add(bar);
    // underbody glow plate
    const under = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.6), (() => {
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const d = length(uv().sub(0.5).mul(vec3(1, 1.9, 1).xy)).mul(2);
      m.colorNode = vec3(0.2, 0.7, 1.0).mul(smoothstep(1, 0.2, d)).mul(this.glow.mul(0.8));
      return m;
    })());
    under.rotation.x = Math.PI / 2;
    under.position.y = 0.16;
    this.body.add(under);
  }

  private addDashboard(scene: THREE.Object3D): void {
    // centre touchscreen with live instrument display (canvas texture)
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 320;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicNodeMaterial({ map: tex, toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.225), m);
    const dash = scene.getObjectByName('InteriorDashMid');
    const db = dash ? new THREE.Box3().setFromObject(dash) : new THREE.Box3(new THREE.Vector3(-0.3, 0.7, 0.4), new THREE.Vector3(0.3, 0.9, 0.7));
    const c = db.getCenter(new THREE.Vector3());
    void c;
    // instrument display just above the centre steering wheel, facing the driver (who looks towards +Z)
    screen.position.set(this.steerPos.x, this.steerPos.y + 0.2, this.steerPos.z + 0.12);
    screen.rotation.set(-0.3, Math.PI, 0);
    screen.scale.setScalar(0.8);
    this.body.add(screen);
    // driver cluster (behind the wheel)
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.09), m.clone());
    (cl.material as THREE.MeshBasicNodeMaterial).map = tex;
    cl.position.set(this.driverEye.x, db.max.y + 0.06, c.z + 0.05);
    cl.rotation.set(-0.5, Math.PI, 0);
    cl.visible = false;
    this.body.add(cl);
    this.dash = { canvas, ctx, tex };
    this.screens.push({ mesh: screen, canvas, tex });
  }

  /** draw the in-car display */
  drawDash(speedKmh: number, mode: string, battery: number, alt: number, status: string, heading: number): void {
    const { ctx, canvas, tex } = this.dash;
    const W = canvas.width, H = canvas.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0f14'); g.addColorStop(1, '#05070a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const flight = mode !== 'DRIVE';
    const accent = flight ? '#3fd6ff' : '#e8ecef';
    ctx.fillStyle = accent; ctx.font = '700 120px Orbitron, Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(speedKmh)), W * 0.36, 175);
    ctx.font = '500 24px Inter, sans-serif'; ctx.fillStyle = '#8a96a3'; ctx.fillText('KM/H', W * 0.36, 210);
    ctx.textAlign = 'left'; ctx.fillStyle = accent; ctx.font = '700 30px Orbitron, sans-serif';
    ctx.fillText(mode, W * 0.66, 90);
    ctx.font = '500 22px Inter, sans-serif'; ctx.fillStyle = '#c7d0d8';
    ctx.fillText(`ALT ${Math.round(alt)} m`, W * 0.66, 135);
    ctx.fillText(`HDG ${Math.round(heading).toString().padStart(3, '0')}°`, W * 0.66, 170);
    ctx.fillText(status, W * 0.66, 205);
    // battery
    ctx.strokeStyle = '#56616d'; ctx.lineWidth = 3; ctx.strokeRect(40, 255, W - 80, 26);
    ctx.fillStyle = battery > 0.2 ? '#4cd964' : '#ff453a'; ctx.fillRect(43, 258, (W - 86) * battery, 20);
    ctx.fillStyle = '#c7d0d8'; ctx.font = '500 18px Inter, sans-serif'; ctx.fillText(`${Math.round(battery * 100)}%  ·  ${Math.round(battery * 560)} km`, 44, 306);
    tex.needsUpdate = true;
  }

  /**
   * Animate components.
   * fold: 0 = road wheels, 1 = flight turbines (wheels flat)
   */
  animate(dt: number, steerAngle: number, wheelSpin: number[], suspension: number[], fold: number, glow: number, thrust: number, brake: number, night: number): void {
    this.glow.value = glow;
    this.thrust.value = thrust;
    this.brake.value = brake;
    this.headlights.value = night > 0.3 ? 1 : 0.15;
    this.headLight.intensity = night > 0.3 ? 60 : 0;
    const e = fold * fold * (3 - 2 * fold); // smoothstep
    this.wheels.forEach((w, i) => {
      w.steer.position.set(w.base.x + w.side * 0.12 * e, w.base.y + (suspension[i] ?? 0) * (1 - e) + 0.18 * e, w.base.z);
      w.steer.rotation.y = w.front ? steerAngle * (1 - e) : 0;
      w.fold.rotation.z = w.side * (Math.PI / 2) * e;
      w.spin.rotation.x = wheelSpin[i] ?? 0;
      w.fan.visible = e > 0.05;
    });
    if (this.steeringWheel) this.steeringWheel.rotation.y = -steerAngle * 6;
    const d = THREE.MathUtils.smoothstep(fold, 0.25, 1);
    for (const t of this.thrusters) {
      t.scale.setScalar(Math.max(0.001, d));
      t.position.copy(t.userData.base).add(new THREE.Vector3(0, -0.05 * d, -0.15 * d));
    }
    const wgs = THREE.MathUtils.smoothstep(fold, 0.5, 1);
    for (const w of this.winglets) w.scale.set(Math.max(0.001, wgs), 1, 1);
    void dt;
  }
}
