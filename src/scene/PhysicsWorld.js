import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';

/**
 * Rapier world + the static test environment (ground and obstacles).
 * Every obstacle gets a matching Three mesh so collisions are visible.
 */
export class PhysicsWorld {
  constructor(RAPIER, scene) {
    this.RAPIER = RAPIER;
    this.scene = scene;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.accumulator = 0;
    this.obstacles = [];

    // ---- ground: a big static cuboid, not a plane, so wheels never fall through
    const groundBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    // 2 km square: big enough that a 300 km/h run cannot reach the edge
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(1000, 0.5, 1000).setFriction(1.0), groundBody);
    this.groundBody = groundBody;
  }

  /**
   * Static box obstacle, visible and collidable.
   * @returns {THREE.Mesh}
   */
  addObstacle({ size = [2, 1, 2], position = [0, 0.5, 0], color = 0xb45309, dynamic = false, mass = 60 }) {
    const { RAPIER } = this;
    const [w, h, d] = size;
    const [x, y, z] = position;

    const desc = dynamic
      ? RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)
      : RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
    const body = this.world.createRigidBody(desc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setFriction(0.7).setRestitution(0.15);
    if (dynamic) colliderDesc.setDensity(mass / (w * h * d));
    this.world.createCollider(colliderDesc, body);

    const mesh = new Mesh(
      new BoxGeometry(w, h, d),
      new MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05 }),
    );
    mesh.name = dynamic ? 'ObstacleDynamic' : 'ObstacleStatic';
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const entry = { body, mesh, dynamic };
    this.obstacles.push(entry);
    return entry;
  }

  /** A small course: cones to weave through, blocks to hit, a low ramp. */
  buildTestCourse() {
    // crash barriers straight ahead (-Z is forward)
    this.addObstacle({ size: [6, 1.2, 0.6], position: [0, 0.6, -45], color: 0xdc2626 });
    this.addObstacle({ size: [0.6, 1.2, 12], position: [-8, 0.6, -25], color: 0x475569 });
    this.addObstacle({ size: [0.6, 1.2, 12], position: [8, 0.6, -25], color: 0x475569 });

    // knock-over blocks
    for (let i = 0; i < 6; i++) {
      this.addObstacle({
        size: [0.7, 0.7, 0.7],
        position: [(i % 2 ? 1 : -1) * 1.6, 0.35, -14 - i * 3.5],
        color: 0xf59e0b,
        dynamic: true,
        mass: 45,
      });
    }

    // a low ramp to load the suspension
    const ramp = this.addObstacle({ size: [7, 0.5, 5], position: [14, 0.12, -18], color: 0x334155 });
    ramp.mesh.rotation.x = -0.12;
    ramp.body.setRotation({ x: Math.sin(-0.06), y: 0, z: 0, w: Math.cos(-0.06) }, true);
    return this;
  }

  /** Fixed-step integration with an accumulator so physics is frame-rate independent. */
  step(dt, beforeStep) {
    this.accumulator = Math.min(this.accumulator + dt, 0.25);
    let steps = 0;
    while (this.accumulator >= this.world.timestep && steps < 5) {
      beforeStep?.(this.world.timestep);
      this.world.step();
      this.accumulator -= this.world.timestep;
      steps += 1;
    }
    return steps;
  }

  /** Dynamic obstacles follow their bodies. */
  syncObstacles() {
    for (const o of this.obstacles) {
      if (!o.dynamic) continue;
      const t = o.body.translation();
      const r = o.body.rotation();
      o.mesh.position.set(t.x, t.y, t.z);
      o.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}
