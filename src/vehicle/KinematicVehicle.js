import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { VEHICLE_TUNING } from '../vehicleConfig.js';
import { Drivetrain } from './Drivetrain.js';

/**
 * Fallback vehicle for environments where Rapier cannot start.
 *
 * Rapier is WebAssembly, and a strict Content-Security-Policy without
 * `wasm-unsafe-eval` refuses to instantiate it (published sandboxes often do).
 * Rather than show a dead page, the car is then driven by a classic bicycle
 * model: the SAME Drivetrain (torque curve, 8-speed automatic, engine braking,
 * reverse) drives the longitudinal side, and yaw comes from the steering angle
 * and the measured wheelbase.
 *
 * What it does NOT have: collisions, suspension travel, tyre slip, ramps.
 * `telemetry.simplified` is true so the UI can say so.
 *
 * The public surface matches VehiclePhysics, so main.js does not care which one
 * it is driving.
 */
export class KinematicVehicle {
  constructor(visual, tuning = VEHICLE_TUNING) {
    this.visual = visual;
    this.tuning = tuning;
    this.drivetrain = new Drivetrain(tuning);
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.steering = 0;
    this.steeringSensitivity = 1;
    this.forceReverse = false;
    this.ready = true;
    this.simplified = true;

    this.position = new Vector3(0, 0, 0);
    this.heading = 0;
    this.speed = 0; // m/s, signed
    this.wheelSpin = 0;
    this.limit = 118; // stay on the asphalt pad

    this._q = new Quaternion();
    this._euler = new Euler();
    this.telemetry = { speedKmh: 0, speedMps: 0, rpm: 800, gear: '1', wheelsOnGround: 4, steeringDeg: 0, throttle: 0, brake: 0, handbrake: false, simplified: true };

    // minimal rigid-body-shaped API so the debug helpers keep working
    this.body = {
      translation: () => ({ x: this.position.x, y: this.position.y, z: this.position.z }),
      rotation: () => {
        this._q.setFromEuler(this._euler.set(0, this.heading, 0));
        return { x: this._q.x, y: this._q.y, z: this._q.z, w: this._q.w };
      },
      linvel: () => {
        const f = new Vector3(0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0), this.heading).multiplyScalar(this.speed);
        return { x: f.x, y: 0, z: f.z };
      },
    };
  }

  setInput(input) {
    Object.assign(this.input, input);
  }

  get speedMps() {
    return this.speed;
  }

  get isFlipped() {
    return false;
  }

  requestReverse(on) {
    this.forceReverse = on;
    if (on && Math.abs(this.speed) < 1.5) this.drivetrain.gear = -1;
    else if (!on && this.drivetrain.gear === -1 && Math.abs(this.speed) < 1.5) this.drivetrain.gear = 1;
    return this.drivetrain.gear === -1;
  }

  update(dt) {
    const { tuning, input } = this;
    const steerCfg = tuning.steering;
    const wheelRadius = this.visual.wheelRadius ?? 0.35;
    const wheelbase = this.visual.wheelbase ?? 2.98;
    const mass = tuning.mass;

    // --- steering, rate limited and speed sensitive (same law as the real one)
    const absSpeed = Math.abs(this.speed);
    const t = Math.min(1, absSpeed / steerCfg.speedForMinAngle);
    const maxAngle = MathUtils.degToRad(steerCfg.maxAngleDeg + (steerCfg.minAngleDegAtSpeed - steerCfg.maxAngleDeg) * t);
    const target = input.steer * maxAngle * Math.min(1, this.steeringSensitivity);
    const rate = (input.steer === 0 ? steerCfg.returnRate : steerCfg.turnRate * this.steeringSensitivity) * maxAngle;
    const delta = target - this.steering;
    this.steering += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);

    // --- drivetrain (identical to the Rapier path)
    const swapped = this.forceReverse && this.drivetrain.gear === -1;
    const pedals = swapped ? { throttle: input.brake, brake: input.throttle } : { throttle: input.throttle, brake: input.brake };
    this.drivetrain.lockReverse = this.forceReverse;
    const drive = this.drivetrain.update(dt, pedals, this.speed / wheelRadius, this.speed, wheelRadius);

    // --- longitudinal forces
    const brakeInput = drive.direction === -1 ? pedals.throttle : pedals.brake;
    const aero = tuning.aero;
    const drag = 0.5 * aero.airDensity * aero.dragCoefficient * aero.frontalArea * this.speed * Math.abs(this.speed);
    const rolling = tuning.tyre.rollingResistance * mass * 9.81 * Math.sign(this.speed);
    const braking = (brakeInput + (input.handbrake ? 0.6 : 0)) * 11500 * Math.sign(this.speed);
    const traction = braking !== 0 ? 0 : drive.engineForce;

    const accel = (traction - drag - rolling - braking) / mass;
    const next = this.speed + accel * dt;
    // brakes must not drag the car backwards through zero
    this.speed = braking !== 0 && Math.sign(next) !== Math.sign(this.speed) && Math.abs(this.speed) > 0 ? 0 : next;

    // --- bicycle model: yaw from steering angle and wheelbase
    const yawRate = (this.speed / wheelbase) * Math.tan(this.steering);
    this.heading += yawRate * dt;

    const forward = new Vector3(0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0), this.heading);
    this.position.addScaledVector(forward, this.speed * dt);
    // keep the car on the asphalt instead of driving off into nothing
    if (Math.abs(this.position.x) > this.limit || Math.abs(this.position.z) > this.limit) {
      this.position.x = MathUtils.clamp(this.position.x, -this.limit, this.limit);
      this.position.z = MathUtils.clamp(this.position.z, -this.limit, this.limit);
      this.speed *= 0.35;
    }

    this.wheelSpin += (this.speed / wheelRadius) * dt;

    this.telemetry = {
      speedMps: this.speed,
      speedKmh: this.speed * 3.6,
      rpm: drive.rpm,
      gear: drive.gear,
      shifting: drive.shifting,
      wheelsOnGround: 4,
      engineForce: drive.engineForce,
      brakeForce: Math.abs(braking),
      steeringDeg: MathUtils.radToDeg(this.steering),
      dragN: Math.abs(drag),
      rollingN: Math.abs(rolling),
      throttle: input.throttle,
      brake: input.brake,
      handbrake: input.handbrake,
      lateralSpeed: 0,
      tractionLoss: false,
      absActive: brakeInput > 0.5 && absSpeed > 8,
      airborne: false,
      simplified: true,
    };
    return this.telemetry;
  }

  syncVisual() {
    const root = this.visual.root;
    root.position.copy(this.position);
    root.quaternion.setFromEuler(this._euler.set(0, this.heading, 0));
    this.visual.setSteeringWheelAngle?.(this.steering);

    const ackermann = this.#ackermann();
    for (const [key, wheel] of Object.entries(this.visual.wheels)) {
      if (!wheel) continue;
      wheel.spin.rotation.x = -this.wheelSpin;
      if (key.startsWith('front')) wheel.pivot.rotation.y = ackermann[key];
    }
  }

  #ackermann() {
    const wheelbase = this.visual.wheelbase ?? 2.98;
    const track = this.visual.trackFront ?? 1.63;
    const d = this.steering;
    if (Math.abs(d) < 1e-4) return { frontLeft: 0, frontRight: 0 };
    const radius = wheelbase / Math.tan(Math.abs(d));
    const inner = Math.atan(wheelbase / (radius - track / 2));
    const outer = Math.atan(wheelbase / (radius + track / 2));
    const sign = Math.sign(d);
    return sign > 0 ? { frontLeft: inner * sign, frontRight: outer * sign } : { frontLeft: outer * sign, frontRight: inner * sign };
  }

  reset(position = new Vector3(0, 0, 0), heading = 0) {
    this.position.copy(position);
    this.position.y = 0;
    this.heading = heading;
    this.speed = 0;
    this.steering = 0;
    this.wheelSpin = 0;
    this.forceReverse = false;
    this.drivetrain.reset();
    this.input.throttle = 0;
    this.input.brake = 0;
    this.input.steer = 0;
    this.input.handbrake = false;
    this.syncVisual();
  }

  describe() {
    return [
      'KinematicVehicle (fallback — WebAssembly is blocked here, so Rapier could not start)',
      '  longitudinal: real torque curve + 8-speed automatic + drag/rolling resistance',
      '  lateral: bicycle model from the measured wheelbase and steering angle',
      '  missing: collisions, suspension travel, tyre slip',
    ].join('\n');
  }
}
