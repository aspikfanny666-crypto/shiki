import { MathUtils } from 'three';

/**
 * WheelVisualController — drives the *visual* wheels only.
 *
 * Hierarchy it expects (built by VehicleVisual):
 *
 *   VehicleVisual
 *   ├── FrontLeftSteeringPivot   (rotation.y = steering angle)
 *   │   └── FrontLeftWheelSpin   (rotation.x = rolling angle)
 *   │       └── <original wheel node from the GLB>
 *   ├── FrontRightSteeringPivot
 *   │   └── FrontRightWheelSpin
 *   │       └── <original wheel node>
 *   ├── RearLeftWheelMount       (no steering)
 *   │   └── RearLeftWheelSpin
 *   └── RearRightWheelMount
 *       └── RearRightWheelSpin
 *
 * Front wheels steer AND roll at the same time because the two motions live on
 * two different nodes: yaw on the pivot, pitch on the spin node inside it.
 * Rear wheels roll only.
 *
 * Sign conventions (right-handed, +Y up, -Z forward, axle along X):
 *   steeringAngle > 0  => turning LEFT  (positive yaw about +Y is counter-clockwise
 *                         seen from above, and -Z yawed by +y goes towards -X = left)
 *   rotation[key] > 0  => the wheel has rolled FORWARD. A positive pitch about +X
 *                         moves the top of the wheel towards +Z (backwards), so the
 *                         stored angle is negated when written to the spin node.
 */

export const WHEEL_KEYS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

export class WheelVisualController {
  /**
   * @param {Record<string, {pivot: THREE.Object3D, spin: THREE.Object3D, radius: number, node: THREE.Object3D}>} wheels
   * @param {object} opts { wheelbase, trackFront, maxSteerDeg, ackermann }
   */
  constructor(wheels, opts = {}) {
    this.wheels = wheels;
    this.wheelbase = opts.wheelbase ?? 2.982;
    this.trackFront = opts.trackFront ?? 1.627;
    this.maxSteer = MathUtils.degToRad(opts.maxSteerDeg ?? 35);
    this.ackermann = opts.ackermann ?? true;

    /** current rolling angle per wheel, radians */
    this.rotation = { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 };
    /** current steering angle at the front axle, radians (+ = turn left) */
    this.steeringAngle = 0;
  }

  get steeringAngleDeg() {
    return MathUtils.radToDeg(this.steeringAngle);
  }

  /** Absolute rolling angle for every wheel. */
  setWheelRotation(radians) {
    for (const key of WHEEL_KEYS) this.rotation[key] = radians;
    this.#applyRotation();
  }

  /** Per-wheel rolling angles, e.g. { frontLeft: 1.2, rearRight: 0.9 }. */
  setWheelRotations(partial) {
    for (const [key, value] of Object.entries(partial)) {
      if (key in this.rotation) this.rotation[key] = value;
    }
    this.#applyRotation();
  }

  /** Advance the rolling angle by a delta (radians). */
  addWheelRotation(deltaRadians) {
    for (const key of WHEEL_KEYS) this.rotation[key] += deltaRadians;
    this.#applyRotation();
  }

  /**
   * Roll the wheels from a chassis speed. Each wheel uses its own measured
   * radius, so mismatched front/rear sizes stay in sync with the ground.
   * @param {number} speedMps forward speed, m/s (negative = reverse)
   * @param {number} dt seconds
   */
  driveFromSpeed(speedMps, dt) {
    for (const key of WHEEL_KEYS) {
      const wheel = this.wheels[key];
      if (!wheel) continue;
      const r = wheel.radius || 0.35;
      this.rotation[key] += (speedMps / r) * dt;
    }
    this.#applyRotation();
  }

  /**
   * @param {number} radians steering angle at the front axle (+ = left),
   *                 clamped to ±maxSteer.
   */
  setSteeringAngle(radians) {
    this.steeringAngle = MathUtils.clamp(radians, -this.maxSteer, this.maxSteer);
    this.#applySteering();
  }

  /** Normalised input in [-1, 1] mapped onto the steering range. */
  setSteeringInput(input) {
    this.setSteeringAngle(MathUtils.clamp(input, -1, 1) * this.maxSteer);
  }

  /** Convenience for a frame update driven by a speed + steering input. */
  update(dt, { speedMps = 0, steeringInput = null, steeringAngle = null } = {}) {
    if (steeringAngle !== null) this.setSteeringAngle(steeringAngle);
    else if (steeringInput !== null) this.setSteeringInput(steeringInput);
    if (speedMps) this.driveFromSpeed(speedMps, dt);
  }

  /** Per-wheel steer angles, Ackermann-corrected when enabled. */
  getSteerAngles() {
    const delta = this.steeringAngle;
    if (!this.ackermann || Math.abs(delta) < 1e-4) {
      return { frontLeft: delta, frontRight: delta };
    }
    const R = this.wheelbase / Math.tan(Math.abs(delta));
    const half = this.trackFront / 2;
    const inner = Math.atan(this.wheelbase / (R - half));
    const outer = Math.atan(this.wheelbase / (R + half));
    const sign = Math.sign(delta);
    // Turning left (+): the left wheel is the inner one and turns more.
    return sign > 0
      ? { frontLeft: inner * sign, frontRight: outer * sign }
      : { frontLeft: outer * sign, frontRight: inner * sign };
  }

  #applySteering() {
    const angles = this.getSteerAngles();
    if (this.wheels.frontLeft?.pivot) this.wheels.frontLeft.pivot.rotation.y = angles.frontLeft;
    if (this.wheels.frontRight?.pivot) this.wheels.frontRight.pivot.rotation.y = angles.frontRight;
    // Rear pivots exist for symmetry but never steer.
    if (this.wheels.rearLeft?.pivot) this.wheels.rearLeft.pivot.rotation.y = 0;
    if (this.wheels.rearRight?.pivot) this.wheels.rearRight.pivot.rotation.y = 0;
  }

  #applyRotation() {
    for (const key of WHEEL_KEYS) {
      const wheel = this.wheels[key];
      if (!wheel?.spin) continue;
      // Axle runs along X in the normalised frame, so rolling is a pitch.
      // Negated so that a positive stored angle reads as "rolled forward".
      wheel.spin.rotation.x = -this.rotation[key];
    }
  }
}
