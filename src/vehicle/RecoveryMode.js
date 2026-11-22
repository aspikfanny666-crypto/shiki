/**
 * Recovery Mode — «Высвобождение» / «Раскачка».
 *
 * Every driving game eventually needs an answer to "the car is on its roof in
 * a ditch and there is nothing I can do". Reset-to-spawn is one answer, and
 * this project already has it (R). It is a blunt one: it throws away where you
 * were and what you were doing.
 *
 * Recovery Mode is the other answer — the car gets a small, bounded set of
 * physical abilities that let the player work it free themselves:
 *
 *   JUMP     a vertical impulse. Clears a kerb, hops out of a rut, or lands
 *            the car back on its wheels when it is on its side.
 *   ROCK     holding throttle or brake pulses the chassis fore and aft, the
 *            way you rock a car out of snow or mud. The pulse is phase-locked
 *            so it builds, instead of fighting itself.
 *   RIGHT    while airborne, or while flipped, steering becomes roll control,
 *            so you can turn the car back onto its wheels before it lands.
 *
 * Everything here is an impulse on the chassis rigid body — no teleports and
 * no constraint fiddling, so collisions, suspension and the ray-cast vehicle
 * keep behaving exactly as they do the rest of the time.
 *
 * It is deliberately bounded. A jump costs CHARGE_PER_JUMP from a charge meter
 * that refills at CHARGE_REFILL_PER_S, so the car cannot simply fly: at the
 * numbers below that is roughly one jump per 1.6 s sustained, with two
 * available back to back after a quiet moment. The HUD shows the meter.
 */
import { Quaternion, Vector3 } from 'three';

/** Height a full-strength jump should reach, in metres, from rest. */
const JUMP_HEIGHT = 1.15;
/** Fraction of the jump impulse sent along the car's own forward axis. */
const JUMP_FORWARD_BIAS = 0.22;
/** A jump also gives a small nose-up pitch, so the car clears an edge. */
const JUMP_PITCH = 0.09;

/** Charge meter: 1.0 is full. */
const CHARGE_PER_JUMP = 0.5;
const CHARGE_REFILL_PER_S = 0.32;
/** Shortest possible time between two jumps, whatever the charge says. */
const JUMP_COOLDOWN = 0.35;

/** Rocking: how hard each pulse is, as a velocity change in m/s. */
const ROCK_DELTA_V = 1.9;
/** Pulses per second. Near a stuck car's own rocking frequency. */
const ROCK_HZ = 1.7;
/** Rocking only helps while the car is barely moving; above this it is off. */
const ROCK_MAX_SPEED = 3.2;

/**
 * Air control is a TARGET RATE, not a torque.
 *
 * The first version applied roll torque while the steering was held. It did
 * flip the car — and then kept going: measured, the car passed upright at
 * 0.67 s with 7.9 rad/s still on it and tumbled straight back onto its roof.
 * Unbounded torque cannot be aimed.
 *
 * So the roll and yaw components of the angular velocity are steered towards a
 * rate the player asks for, and nothing else about the body is touched. It is
 * bounded by construction: let go and the car stops rotating, hold it and it
 * turns at a known rate. Every game's air control works this way, and for a
 * recovery assist that is the honest trade — it is an assist, not a force.
 */
const ROLL_RATE = 3.0; // rad/s at full steer
const YAW_RATE = 1.4;
/** How quickly the rate is reached, in rad/s². Finite, so it still has weight. */
const RATE_APPROACH = 14;

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, -1);
const RIGHT = new Vector3(1, 0, 0);

export class RecoveryMode {
  /**
   * @param {object} physics VehiclePhysics or KinematicVehicle
   * @param {object} opts
   */
  constructor(physics, { enabled = false } = {}) {
    this.physics = physics;
    this.active = enabled;
    this.charge = 1;
    this.cooldown = 0;
    this.rockPhase = 0;
    this.lastJumpAt = -Infinity;
    this.jumps = 0;
    this.flips = 0;
    this.lastSteer = 0;
    this.elapsed = 0;

    this._q = new Quaternion();
    this._v = new Vector3();
    this._axis = new Vector3();
    this._yaw = new Vector3();
    this._up = new Vector3();

    /**
     * Only a real rigid body can take an impulse. The no-WebAssembly fallback
     * integrates a bicycle model by hand and has no body to push, so Recovery
     * Mode reports itself unavailable there rather than pretending.
     */
    this.supported = typeof physics?.body?.applyImpulse === 'function';
  }

  /** Swap the car underneath: used when the player changes vehicle. */
  attach(physics) {
    this.physics = physics;
    this.supported = typeof physics?.body?.applyImpulse === 'function';
    this.rockPhase = 0;
    this.cooldown = 0;
  }

  setActive(on) {
    this.active = Boolean(on) && this.supported;
    this.rockPhase = 0;
    return this.active;
  }

  toggle() {
    return this.setActive(!this.active);
  }

  get mass() {
    return this.physics?.tuning?.mass ?? 1800;
  }

  /** The chassis' own axes in world space, for impulses that follow the car. */
  #orientation() {
    const r = this.physics.body.rotation();
    this._q.set(r.x, r.y, r.z, r.w);
    return this._q;
  }

  get canJump() {
    return this.active && this.supported && this.cooldown <= 0 && this.charge >= CHARGE_PER_JUMP;
  }

  /**
   * A vertical impulse, plus a little of the car's own forward direction and a
   * nose-up pitch. Returns true if the jump actually happened.
   *
   * The impulse is derived from the height we want, not tuned by feel:
   * v = sqrt(2·g·h), and impulse = m·v.
   */
  jump() {
    if (!this.canJump) return false;
    const body = this.physics.body;
    const q = this.#orientation();
    const m = this.mass;
    const v = Math.sqrt(2 * 9.81 * JUMP_HEIGHT);

    // Straight up in WORLD space: a flipped car must still be thrown upwards,
    // not into the ground along its own (now inverted) +Y.
    this._v.copy(UP).multiplyScalar(m * v);
    // …plus a nudge along where the car is pointing, flattened to the ground
    // plane so a nose-down car is not fired downwards.
    this._axis.copy(FORWARD).applyQuaternion(q);
    this._axis.y = 0;
    if (this._axis.lengthSq() > 1e-6) {
      this._axis.normalize().multiplyScalar(m * v * JUMP_FORWARD_BIAS);
      this._v.add(this._axis);
    }
    body.applyImpulse({ x: this._v.x, y: this._v.y, z: this._v.z }, true);

    if (this.physics.isFlipped) {
      /**
       * A jump taken on the roof is a RECOVERY FLIP, not a hop. The car is in
       * the air for t = 2·sqrt(2h/g), so the roll rate that turns it exactly
       * half a turn in that time is π/t — set directly, because an impulse
       * large enough to flip a car is also large enough to keep tumbling it,
       * which is what the first version of this did.
       */
      const airtime = 2 * Math.sqrt((2 * JUMP_HEIGHT) / 9.81);
      const sign = this.#rightingSign(q) || Math.sign(this.lastSteer || 1) || 1;
      this.#setRate(this.#forwardAxis(q), (sign * Math.PI) / airtime);
      this.flips += 1;
    } else {
      // nose-up pitch about the car's own right axis
      this._axis.copy(RIGHT).applyQuaternion(q).multiplyScalar(-m * JUMP_PITCH);
      body.applyTorqueImpulse({ x: this._axis.x, y: this._axis.y, z: this._axis.z }, true);
    }

    this.charge = Math.max(0, this.charge - CHARGE_PER_JUMP);
    this.cooldown = JUMP_COOLDOWN;
    this.lastJumpAt = this.elapsed;
    this.jumps += 1;
    return true;
  }

  /**
   * @param {number} dt
   * @param {object} input  the merged control state for this frame
   * @param {object} telemetry from the physics
   */
  update(dt, input = {}, telemetry = {}) {
    this.elapsed += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.charge = Math.min(1, this.charge + CHARGE_REFILL_PER_S * dt);

    if (!this.active || !this.supported || !this.physics.ready) {
      this.rocking = false;
      this.righting = false;
      return;
    }

    const body = this.physics.body;
    const q = this.#orientation();
    const m = this.mass;
    const speed = Math.abs(telemetry.speedMps ?? 0);
    const flipped = this.physics.isFlipped;
    const airborne = (telemetry.wheelsOnGround ?? 4) === 0;

    // ---- rocking ------------------------------------------------------------
    // Throttle rocks forward, brake rocks back. The pulse is a half-wave: it
    // pushes for half of each cycle and rests for the other half, so successive
    // pushes add up instead of cancelling, which is the whole point of rocking
    // a stuck car rather than just flooring it.
    const rockDir = (input.throttle ?? 0) > 0.15 ? 1 : (input.brake ?? 0) > 0.15 ? -1 : 0;
    this.rocking = rockDir !== 0 && speed < ROCK_MAX_SPEED && !flipped;
    if (this.rocking) {
      const before = this.rockPhase;
      this.rockPhase = (this.rockPhase + ROCK_HZ * dt) % 1;
      // one impulse per cycle, fired as the phase wraps
      if (this.rockPhase < before) {
        this._axis.copy(FORWARD).applyQuaternion(q);
        this._axis.y = Math.max(this._axis.y, 0.18); // always a little upward, to unload the tyres
        this._axis.normalize().multiplyScalar(rockDir * m * ROCK_DELTA_V);
        body.applyImpulse({ x: this._axis.x, y: this._axis.y, z: this._axis.z }, true);
      }
    } else {
      this.rockPhase = 0;
    }

    // ---- righting -----------------------------------------------------------
    // In the air, or on its roof, steering stops being steering and becomes
    // roll. This is what lets you aim the landing after a recovery flip, and
    // what trims the car mid-jump.
    const steer = input.steer ?? 0;
    this.lastSteer = steer;
    this.righting = (airborne || flipped) && Math.abs(steer) > 0.08;
    if (this.righting) {
      this.#steerRate(this.#forwardAxis(q), steer * ROLL_RATE, dt);
      if (airborne && !flipped) this.#steerRate(this._yaw.copy(UP), steer * YAW_RATE, dt);
    }
  }

  /** The car's own longitudinal axis, in world space, normalised. */
  #forwardAxis(q) {
    return this._axis.copy(FORWARD).applyQuaternion(q).normalize();
  }

  /** Set the angular velocity's component along `axis` to exactly `target`. */
  #setRate(axis, target) {
    const body = this.physics.body;
    const av = body.angvel();
    this._v.set(av.x, av.y, av.z);
    this._v.addScaledVector(axis, target - this._v.dot(axis));
    body.setAngvel({ x: this._v.x, y: this._v.y, z: this._v.z }, true);
  }

  /**
   * Move the angular velocity's component along `axis` towards `target` rad/s,
   * at no more than RATE_APPROACH rad/s². Everything perpendicular to the axis
   * is left exactly as the physics made it, so a spin the player did not ask
   * for is neither added nor cancelled.
   */
  #steerRate(axis, target, dt) {
    const body = this.physics.body;
    const av = body.angvel();
    this._v.set(av.x, av.y, av.z);
    const current = this._v.dot(axis);
    const step = RATE_APPROACH * dt;
    const delta = Math.max(-step, Math.min(step, target - current));
    this._v.addScaledVector(axis, delta);
    body.setAngvel({ x: this._v.x, y: this._v.y, z: this._v.z }, true);
  }

  /**
   * Which way to roll a flipped car so it ends up on its wheels: the direction
   * that carries the car's own up vector towards world up. When it is exactly
   * upside down the cross product vanishes and either way is as good, so the
   * player's steering breaks the tie, and failing that it rolls right.
   */
  #rightingSign(q) {
    const up = this._up.copy(UP).applyQuaternion(q);
    const fwd = this._axis.copy(FORWARD).applyQuaternion(q).normalize();
    const sign = this._yaw.copy(up).cross(UP).dot(fwd);
    return Math.abs(sign) < 0.05 ? 0 : Math.sign(sign);
  }

  /** What the HUD needs. */
  get status() {
    return {
      active: this.active,
      supported: this.supported,
      charge: this.charge,
      canJump: this.canJump,
      rocking: Boolean(this.rocking),
      righting: Boolean(this.righting),
      jumps: this.jumps,
      flips: this.flips,
    };
  }

  describe() {
    return [
      'RecoveryMode (impulse-based)',
      `  supported: ${this.supported} (needs a Rapier rigid body)`,
      `  jump: ${JUMP_HEIGHT} m from rest → impulse m·sqrt(2gh) = ${Math.round(this.mass * Math.sqrt(2 * 9.81 * JUMP_HEIGHT))} N·s, +${Math.round(JUMP_FORWARD_BIAS * 100)}% forward`,
      `  charge: ${CHARGE_PER_JUMP} per jump, refills ${CHARGE_REFILL_PER_S}/s → ~${(CHARGE_PER_JUMP / CHARGE_REFILL_PER_S).toFixed(1)} s between sustained jumps`,
      `  rock: ${ROCK_DELTA_V} m/s pulses at ${ROCK_HZ} Hz, below ${ROCK_MAX_SPEED} m/s`,
      `  air control: target ${ROLL_RATE} rad/s roll, ${YAW_RATE} rad/s yaw, approached at ${RATE_APPROACH} rad/s²`,
      `  recovery flip: airtime ${(2 * Math.sqrt((2 * JUMP_HEIGHT) / 9.81)).toFixed(2)} s → half a turn at ${(Math.PI / (2 * Math.sqrt((2 * JUMP_HEIGHT) / 9.81))).toFixed(2)} rad/s`,
    ].join('\n');
  }
}
