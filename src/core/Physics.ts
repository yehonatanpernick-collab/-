import RAPIER from '@dimforge/rapier3d-compat';

export type R = typeof RAPIER;

/** Rapier physics world wrapper with a fixed timestep. */
export class Physics {
  static R: R;
  world!: RAPIER.World;
  readonly dt = 1 / 60;
  private acc = 0;
  maxFrame = 0.1;
  maxSub = 6;

  async init(): Promise<void> {
    await RAPIER.init();
    Physics.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.dt;
  }

  /** Steps the simulation in fixed increments; calls `pre` before each sub-step. Returns interpolation alpha. */
  step(frameDt: number, pre: (dt: number) => void, post?: (dt: number) => void): number {
    this.acc += Math.min(frameDt, this.maxFrame);
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSub) {
      pre(this.dt);
      this.world.step();
      post?.(this.dt);
      this.acc -= this.dt; n++;
    }
    if (n === this.maxSub) this.acc = 0;
    return this.acc / this.dt;
  }

  trimesh(pos: Float32Array, idx: Uint32Array, friction = 1.0): RAPIER.Collider | null {
    if (!idx.length) return null;
    const desc = RAPIER.ColliderDesc.trimesh(pos, idx).setFriction(friction);
    return this.world.createCollider(desc);
  }

  remove(c: RAPIER.Collider | null | undefined): void {
    if (c && this.world.getCollider(c.handle)) this.world.removeCollider(c, false);
  }
}
