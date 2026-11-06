import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;
export let R: Rapier;

/** Thin wrapper around a Rapier world with fixed-step simulation. */
export class Physics {
  world!: RAPIER.World;
  readonly dt = 1 / 120;
  private acc = 0;

  async init() {
    await RAPIER.init();
    R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.dt;
    // infinite ground slab (street level y=0) + river floor
    const g = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(6000, 1, 6000).setTranslation(0, -1, 0).setFriction(1.0), g);
  }

  /** steps the world; `pre(dt)` runs before every substep (vehicle forces) */
  step(frameDt: number, pre: (dt: number) => void) {
    this.acc = Math.min(this.acc + frameDt, 0.1);
    let n = 0;
    while (this.acc >= this.dt && n < 12) { pre(this.dt); this.world.step(); this.acc -= this.dt; n++; }
    return this.acc / this.dt; // interpolation alpha
  }

  castRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxToi: number, exclude?: RAPIER.RigidBody) {
    const ray = new R.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRay(ray, maxToi, true, undefined, undefined, undefined, exclude);
    return hit ? hit.timeOfImpact : null;
  }
}
