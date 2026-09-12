import { Euler, Quaternion, Vector3 } from 'three';
import { VEHICLE_TUNING } from '../vehicleConfig.js';
import { Drivetrain } from './Drivetrain.js';

/**
 * VehiclePhysics — Rapier 3D rigid body + ray-cast wheels.
 *
 * The GLB is NEVER a collider. The car is simulated as:
 *   - one dynamic rigid body with a single cuboid chassis collider,
 *   - four ray-cast wheels (Rapier's DynamicRayCastVehicleController), each
 *     with its own spring/damper suspension and tyre friction,
 *   - a drivetrain on top: torque curve, 8-speed automatic, engine braking,
 *   - rolling resistance, aerodynamic drag and downforce applied to the body.
 *
 * Sign conventions match the visual side: +Y up, -Z forward, +X right.
 * Rapier's vehicle controller works in +Z-forward terms, so the engine force
 * and steering signs are flipped once, here, via FORWARD_SIGN / STEER_SIGN.
 */

const WHEEL_ORDER = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

/** Rapier's forward axis is +Z; the project's forward is -Z. */
const FORWARD_SIGN = -1;
/** Positive steering input means "left"; Rapier steers about +Y the same way. */
const STEER_SIGN = 1;

export class VehiclePhysics {
  /**
   * @param {typeof import('@dimforge/rapier3d-compat')} RAPIER
   * @param {import('@dimforge/rapier3d-compat').World} world
   * @param {import('./VehicleVisual.js').VehicleVisual} visual
   */
  constructor(RAPIER, world, visual, tuning = VEHICLE_TUNING) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.visual = visual;
    this.tuning = tuning;

    this.drivetrain = new Drivetrain(tuning);
    this.input = { throttle: 0, brake: 0, handbrake: false, steer: 0 };
    this.steering = 0;
    this.ready = false;
    this.telemetry = {
      speedKmh: 0, speedMps: 0, rpm: 0, gear: '1', wheelsOnGround: 0,
      engineForce: 0, brakeForce: 0, steeringDeg: 0, dragN: 0, rollingN: 0, shifting: false,
    };

    this._q = new Quaternion();
    this._v = new Vector3();
    this._fwd = new Vector3();
    this._euler = new Euler();

    this.spawn = { position: new Vector3(0, 0.08, 0), rotation: new Quaternion() };
    this.#create();
  }

  /** Chassis cuboid + wheels, all derived from the measured visual. */
  #create() {
    const { RAPIER, world, visual, tuning } = this;
    const m = visual.measurements;
    const inset = tuning.chassisInset;

    const half = {
      x: (m.width * inset.width) / 2,
      y: (m.height * inset.height) / 2,
      z: (m.length * inset.length) / 2,
    };
    // sit the box just above the sills so it does not scrape on kerbs
    const centreY = m.height * 0.5;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.spawn.position.x, this.spawn.position.y, this.spawn.position.z)
      // No artificial linear damping: aerodynamic drag and rolling resistance
      // are applied explicitly in #applyResistance, and Rapier's damping would
      // otherwise dominate them (it scales with mass × velocity) and cap the
      // top speed at ~170 km/h.
      .setLinearDamping(0)
      .setAngularDamping(0.35)
      .setCanSleep(false);
    this.body = world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(0, centreY, 0)
      .setDensity(0) // mass comes from setAdditionalMassProperties below
      .setFriction(0.4)
      .setRestitution(0.1);
    this.collider = world.createCollider(colliderDesc, this.body);

    // explicit mass + inertia + a low centre of mass, so it corners like a car
    const mass = tuning.mass;
    const com = {
      x: tuning.centreOfMassOffset[0],
      y: centreY + tuning.centreOfMassOffset[1],
      z: tuning.centreOfMassOffset[2],
    };
    const w = half.x * 2;
    const h = half.y * 2;
    const l = half.z * 2;
    this.body.setAdditionalMassProperties(
      mass,
      com,
      { x: (mass / 12) * (h * h + l * l), y: (mass / 12) * (w * w + l * l), z: (mass / 12) * (w * w + h * h) },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );

    this.chassisHalf = half;
    this.chassisCentreY = centreY;

    // ---- wheels -------------------------------------------------------------
    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;

    const susp = tuning.suspension;
    this.wheelKeys = [];

    // Static sag: the springs compress under the car's own weight, so the body
    // would come to rest below the height the model was authored at. Rapier's
    // spring force is stiffness × compression × mass, which puts the sag per
    // corner at g / (4 × stiffness). Shortening the connection distance by that
    // much makes the loaded car settle exactly at its design ride height —
    // verified by measurement: body y ≈ 0 with all four wheels on the ground.
    this.staticSag = 9.81 / (4 * susp.stiffness);

    for (const key of WHEEL_ORDER) {
      const wheel = visual.wheels[key];
      if (!wheel) continue;
      const connection = {
        x: wheel.center.x,
        y: wheel.restY + susp.restLength - this.staticSag,
        z: wheel.center.z,
      };
      this.controller.addWheel(
        connection,
        { x: 0, y: -1, z: 0 }, // suspension direction
        { x: -1, y: 0, z: 0 }, // axle
        susp.restLength,
        wheel.radius,
      );
      const i = this.wheelKeys.length;
      this.controller.setWheelSuspensionStiffness(i, susp.stiffness);
      this.controller.setWheelSuspensionCompression(i, susp.compression);
      this.controller.setWheelSuspensionRelaxation(i, susp.relaxation);
      this.controller.setWheelMaxSuspensionTravel(i, susp.maxTravel);
      this.controller.setWheelMaxSuspensionForce(i, susp.maxForce);
      this.controller.setWheelFrictionSlip(i, tuning.tyre.frictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, tuning.tyre.sideFrictionStiffness);
      this.wheelKeys.push(key);
    }

    // The suspension rays start inside the chassis box, so the vehicle's own
    // colliders must be filtered out or every ray reports a hit at distance 0
    // and the car never touches the ground.
    this._rayFilter = (collider) => collider.parent()?.handle !== this.body.handle;

    this.ready = this.wheelKeys.length === 4;
    if (!this.ready) {
      this.error = `only ${this.wheelKeys.length}/4 wheels could be attached to the physics vehicle`;
    }
    this.restLength = susp.restLength;
  }

  isDriven(key) {
    const axle = this.tuning.drivenAxle;
    if (axle === 'all') return true;
    return axle === 'front' ? key.startsWith('front') : key.startsWith('rear');
  }

  setInput(input) {
    Object.assign(this.input, input);
  }

  /** Signed forward speed in m/s (+ = driving forwards). */
  get speedMps() {
    const v = this.body.linvel();
    this._v.set(v.x, v.y, v.z);
    const rot = this.body.rotation();
    this._q.set(rot.x, rot.y, rot.z, rot.w);
    this._fwd.set(0, 0, -1).applyQuaternion(this._q);
    return this._v.dot(this._fwd);
  }

  update(dt) {
    if (!this.ready) return this.telemetry;
    const { controller, tuning, input } = this;
    const steerCfg = tuning.steering;

    // ---- steering: rate-limited, and tightened with speed -------------------
    const speed = this.speedMps;
    const absSpeed = Math.abs(speed);
    const maxAngle = this.#maxSteerAngle(absSpeed);
    const target = input.steer * maxAngle;
    const rate = (input.steer === 0 ? steerCfg.returnRate : steerCfg.turnRate) * maxAngle;
    const delta = target - this.steering;
    this.steering += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);

    // ---- drivetrain ---------------------------------------------------------
    const wheelRadius = this.visual.wheelRadius;
    const drivenIndex = this.wheelKeys.findIndex((k) => this.isDriven(k));
    const wheelAngular = speed / wheelRadius;
    const drive = this.drivetrain.update(dt, input, wheelAngular, speed, wheelRadius);

    const drivenCount = this.wheelKeys.filter((k) => this.isDriven(k)).length || 1;
    const perWheelForce = (drive.engineForce / drivenCount) * FORWARD_SIGN;

    // ---- brakes -------------------------------------------------------------
    const brakes = tuning.brakes;
    // In reverse gear the pedals swap: BRAKE drives backwards, GAS slows down.
    const brakeInput = drive.direction === -1 ? input.throttle : input.brake;
    const frontBrake = brakeInput * brakes.maxBrakeForce;
    const rearBrake = brakeInput * brakes.maxBrakeForce * brakes.rearBias;
    const handbrake = input.handbrake ? brakes.handbrakeForce : 0;

    const ackermann = this.#ackermannAngles(this.steering);
    // Rapier (like Bullet) only honours the brake on a wheel when no engine
    // force is set on it, so the two are mutually exclusive: pressing the brake
    // pedal cuts drive torque, exactly as lifting off would in a real car.
    const braking = brakeInput > 0.02 || handbrake > 0;
    let wheelsOnGround = 0;

    for (let i = 0; i < this.wheelKeys.length; i++) {
      const key = this.wheelKeys[i];
      const front = key.startsWith('front');

      controller.setWheelEngineForce(i, !braking && this.isDriven(key) ? perWheelForce : 0);

      const requested = front ? frontBrake : rearBrake + handbrake;
      controller.setWheelBrake(i, braking ? requested : 0);
      controller.setWheelSteering(i, front ? ackermann[key] * STEER_SIGN : 0);
      if (controller.wheelIsInContact(i)) wheelsOnGround += 1;
    }

    // ---- resistive forces on the chassis ------------------------------------
    const { dragN, rollingN } = this.#applyResistance(dt, speed, wheelsOnGround);

    controller.updateVehicle(dt, undefined, undefined, this._rayFilter);

    // safety net: if the car leaves the world (fell off an edge, launched off a
    // ramp into orbit) put it back on the spawn point instead of falling forever
    if (this.body.translation().y < -5) this.reset();

    this.telemetry = {
      speedMps: speed,
      speedKmh: speed * 3.6,
      rpm: drive.rpm,
      gear: drive.gear,
      shifting: drive.shifting,
      wheelsOnGround,
      engineForce: drive.engineForce,
      brakeForce: braking ? frontBrake + rearBrake + handbrake : 0,
      braking,
      steeringDeg: (this.steering * 180) / Math.PI,
      dragN,
      rollingN,
      throttle: input.throttle,
      brake: input.brake,
      handbrake: input.handbrake,
      airborne: wheelsOnGround === 0,
    };
    return this.telemetry;
  }

  /** Inner wheel turns more than the outer one, from the measured track/wheelbase. */
  #ackermannAngles(delta) {
    const wheelbase = this.visual.wheelbase ?? 2.98;
    const track = this.visual.trackFront ?? 1.63;
    if (Math.abs(delta) < 1e-4) return { frontLeft: 0, frontRight: 0 };
    const radius = wheelbase / Math.tan(Math.abs(delta));
    const inner = Math.atan(wheelbase / (radius - track / 2));
    const outer = Math.atan(wheelbase / (radius + track / 2));
    const sign = Math.sign(delta);
    // positive steering = left, so the left wheel is the inner one
    return sign > 0
      ? { frontLeft: inner * sign, frontRight: outer * sign }
      : { frontLeft: outer * sign, frontRight: inner * sign };
  }

  #maxSteerAngle(absSpeed) {
    const s = this.tuning.steering;
    const t = Math.min(1, absSpeed / s.speedForMinAngle);
    const deg = s.maxAngleDeg + (s.minAngleDegAtSpeed - s.maxAngleDeg) * t;
    return (deg * Math.PI) / 180;
  }

  /** Aerodynamic drag, downforce and rolling resistance as body forces. */
  #applyResistance(dt, speed, wheelsOnGround) {
    const aero = this.tuning.aero;
    // Rapier keeps user forces until they are explicitly cleared, so last
    // step's drag/rolling must go before this step's are added — otherwise they
    // pile up every frame and the car can barely move.
    this.body.resetForces(false);
    this.body.resetTorques(false);
    const v = this.body.linvel();
    this._v.set(v.x, v.y, v.z);
    const vLen = this._v.length();

    let dragN = 0;
    if (vLen > 0.05) {
      dragN = 0.5 * aero.airDensity * aero.dragCoefficient * aero.frontalArea * vLen * vLen;
      this._v.normalize().multiplyScalar(-dragN);
      this.body.addForce({ x: this._v.x, y: this._v.y, z: this._v.z }, true);
    }

    // downforce grows with speed and helps grip at motorway pace
    const down = 0.5 * aero.airDensity * aero.downforceCoefficient * aero.frontalArea * vLen * vLen;
    if (down > 1) this.body.addForce({ x: 0, y: -down, z: 0 }, true);

    // rolling resistance: constant retarding force while wheels touch ground
    let rollingN = 0;
    if (wheelsOnGround > 0 && Math.abs(speed) > 0.08) {
      rollingN = this.tuning.tyre.rollingResistance * this.tuning.mass * 9.81 * (wheelsOnGround / 4);
      const rot = this.body.rotation();
      this._q.set(rot.x, rot.y, rot.z, rot.w);
      this._fwd.set(0, 0, -1).applyQuaternion(this._q).multiplyScalar(-Math.sign(speed) * rollingN);
      this.body.addForce({ x: this._fwd.x, y: this._fwd.y, z: this._fwd.z }, true);
    }

    return { dragN, rollingN };
  }

  /** Copies the physics state onto the visual: body, wheels, steering, suspension. */
  syncVisual() {
    if (!this.ready) return;
    const t = this.body.translation();
    const r = this.body.rotation();
    this.visual.root.position.set(t.x, t.y, t.z);
    this.visual.root.quaternion.set(r.x, r.y, r.z, r.w);

    for (let i = 0; i < this.wheelKeys.length; i++) {
      const key = this.wheelKeys[i];
      const wheel = this.visual.wheels[key];
      if (!wheel) continue;

      // rolling: Rapier accumulates the wheel angle for us
      const rotation = this.controller.wheelRotation(i) ?? 0;
      wheel.spin.rotation.x = -rotation * FORWARD_SIGN;

      // steering
      if (key.startsWith('front')) {
        wheel.pivot.rotation.y = (this.controller.wheelSteering(i) ?? 0) * STEER_SIGN;
      }

      // suspension travel
      const length = this.controller.wheelSuspensionLength(i);
      if (typeof length === 'number') {
        wheel.pivot.position.y = wheel.restY - this.staticSag + (this.restLength - length);
      }
    }
  }

  /** Puts the car back on its spawn point, upright and stopped. */
  reset(position = this.spawn.position, heading = 0) {
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this._q.setFromEuler(this._euler.set(0, heading, 0));
    this.body.setRotation({ x: this._q.x, y: this._q.y, z: this._q.z, w: this._q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.drivetrain.reset();
    this.steering = 0;
  }

  describe() {
    const h = this.chassisHalf;
    return [
      'VehiclePhysics (Rapier ray-cast vehicle)',
      `  chassis collider: cuboid halfExtents=[${h.x.toFixed(3)}, ${h.y.toFixed(3)}, ${h.z.toFixed(3)}] at y=${this.chassisCentreY.toFixed(3)} — the GLB itself is never a collider`,
      `  mass: ${this.tuning.mass} kg, driven axle: ${this.tuning.drivenAxle}`,
      `  wheels attached: ${this.wheelKeys.length}/4 (${this.wheelKeys.join(', ')})`,
      `  suspension: rest ${this.tuning.suspension.restLength} m, travel ${this.tuning.suspension.maxTravel} m, stiffness ${this.tuning.suspension.stiffness}`,
      `  tyres: frictionSlip ${this.tuning.tyre.frictionSlip}, side stiffness ${this.tuning.tyre.sideFrictionStiffness}`,
      `  gearbox: ${this.tuning.transmission.gearRatios.length}-speed automatic + reverse, final drive ${this.tuning.transmission.finalDrive}`,
    ].join('\n');
  }
}
