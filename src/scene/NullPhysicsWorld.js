/**
 * Stand-in for PhysicsWorld when Rapier is unavailable (no WebAssembly).
 * The Environment can still build all of its visuals; the props simply do not
 * collide, and the step() call just drives the kinematic vehicle.
 */
export class NullPhysicsWorld {
  constructor(scene) {
    this.scene = scene;
    this.world = { timestep: 1 / 60 };
    this.bodies = [];
    this.steppedTime = 0;
    this.accumulator = 0;
  }

  addStaticBox() {
    return { body: null, mesh: null, dynamic: false };
  }

  /** A body-shaped stub that never moves, so instanced props stay put. */
  addDynamicBody({ position = [0, 0, 0] } = {}) {
    const t = { x: position[0], y: position[1], z: position[2] };
    return { translation: () => t, rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }) };
  }

  /** Matches PhysicsWorld.stepOnce; there is no world to advance. */
  stepOnce() {
    this.steppedTime += this.world.timestep;
  }

  step(dt, beforeStep) {
    const fixed = this.world.timestep;
    this.accumulator = Math.min(this.accumulator + dt, 0.25);
    let steps = 0;
    while (this.accumulator >= fixed && steps < 5) {
      beforeStep?.(fixed);
      this.accumulator -= fixed;
      this.steppedTime += fixed;
      steps += 1;
    }
    return steps;
  }
}
