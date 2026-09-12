import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';

/**
 * The Rapier world plus helpers for the static/dynamic props the environment
 * builds. Collision shapes stay primitive on purpose: cuboids for everything
 * structural, one cylinder per cone. Nothing here uses visual geometry as a
 * collider.
 */
export class PhysicsWorld {
  constructor(RAPIER, scene) {
    this.RAPIER = RAPIER;
    this.scene = scene;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.accumulator = 0;
    this.bodies = [];
    this.steppedTime = 0;

    // ground: a 2 km static cuboid, so a 300 km/h run cannot reach an edge
    const groundBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(1000, 0.5, 1000).setFriction(1.0), groundBody);
    this.groundBody = groundBody;
  }

  /**
   * Static cuboid. `visible: true` also creates a matching debug mesh; the
   * environment draws its own visuals and passes `visible: false`.
   */
  addStaticBox({ size = [1, 1, 1], position = [0, 0.5, 0], quaternion = null, color = 0x8892a0, visible = true }) {
    const { RAPIER } = this;
    const [w, h, d] = size;
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(position[0], position[1], position[2]);
    if (quaternion) desc.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setFriction(0.8).setRestitution(0.1),
      body,
    );

    let mesh = null;
    if (visible) {
      mesh = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ color, roughness: 0.85 }));
      mesh.position.set(...position);
      if (quaternion) mesh.quaternion.copy(quaternion);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    const entry = { body, mesh, dynamic: false };
    this.bodies.push(entry);
    return entry;
  }

  /** Dynamic prop (cone, crate). Returns the rigid body for the caller to drive its visual. */
  addDynamicBody({ shape = 'cuboid', size = [0.5, 0.5, 0.5], radius = 0.25, halfHeight = 0.3, position = [0, 1, 0], mass = 10 }) {
    const { RAPIER } = this;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position[0], position[1], position[2])
        .setLinearDamping(0.2)
        .setAngularDamping(0.4),
    );
    const desc = shape === 'cylinder'
      ? RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      : RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2);
    const volume = shape === 'cylinder' ? Math.PI * radius * radius * halfHeight * 2 : size[0] * size[1] * size[2];
    this.world.createCollider(desc.setDensity(mass / Math.max(volume, 0.001)).setFriction(0.7).setRestitution(0.2), body);
    this.bodies.push({ body, mesh: null, dynamic: true });
    return body;
  }

  /** One fixed step, for deterministic test runs that bypass the frame clock. */
  stepOnce() {
    this.world.step();
    this.steppedTime += this.world.timestep;
  }

  /**
   * Fixed-step integration with an accumulator, so the simulation is
   * frame-rate independent. At most 5 substeps per frame: on a slow device the
   * simulation slows down instead of spiralling.
   */
  step(dt, beforeStep) {
    this.accumulator = Math.min(this.accumulator + dt, 0.25);
    let steps = 0;
    while (this.accumulator >= this.world.timestep && steps < 5) {
      beforeStep?.(this.world.timestep);
      this.world.step();
      this.accumulator -= this.world.timestep;
      this.steppedTime += this.world.timestep;
      steps += 1;
    }
    return steps;
  }
}
