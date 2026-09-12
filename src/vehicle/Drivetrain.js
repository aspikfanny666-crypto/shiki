import { VEHICLE_TUNING } from '../vehicleConfig.js';

/**
 * Engine + 8-speed automatic gearbox.
 *
 * Produces the force fed to the driven wheels each frame, and models:
 *   - a torque curve (not a constant force),
 *   - automatic up/down shifts with a torque cut during the shift,
 *   - engine braking when the throttle is closed,
 *   - reverse, engaged from a standstill when brake is held.
 */
export class Drivetrain {
  constructor(tuning = VEHICLE_TUNING) {
    this.engine = tuning.engine;
    this.box = tuning.transmission;

    this.gear = 1; // -1 reverse, 0 neutral, 1..8 forward
    this.rpm = this.engine.idleRpm;
    this.shiftTimer = 0;
    this.throttle = 0;
    this.direction = 1; // 1 forward, -1 reverse
    this.brakeWasReleased = true; // reverse only engages on a fresh brake press
  }

  get gearLabel() {
    if (this.gear === -1) return 'R';
    if (this.gear === 0) return 'N';
    return String(this.gear);
  }

  get ratio() {
    if (this.gear === -1) return -this.box.reverseRatio;
    if (this.gear === 0) return 0;
    return this.box.gearRatios[this.gear - 1];
  }

  /** Peak-torque curve of the S63B44T4, normalised then scaled. */
  torqueAt(rpm) {
    const { idleRpm, redlineRpm, peakTorqueNm } = this.engine;
    if (rpm < idleRpm * 0.5) return 0;
    let f;
    if (rpm < 1800) f = 0.55 + 0.45 * ((rpm - idleRpm) / (1800 - idleRpm));
    else if (rpm < 5900) f = 1.0;
    else f = 1.0 - 0.35 * ((rpm - 5900) / (redlineRpm - 5900));
    return peakTorqueNm * Math.max(0, Math.min(1, f));
  }

  /**
   * @param {number} dt seconds
   * @param {object} input { throttle 0..1, brake 0..1 }
   * @param {number} wheelAngularSpeed rad/s of a driven wheel (signed)
   * @param {number} speedMps signed forward speed of the chassis
   * @param {number} wheelRadius m
   * @returns {{ engineTorqueAtWheel: number, rpm: number, gear: string, shifting: boolean }}
   */
  update(dt, { throttle = 0, brake = 0 } = {}, wheelAngularSpeed, speedMps, wheelRadius) {
    this.throttle = throttle;
    const { finalDrive, efficiency, upshiftRpm, downshiftRpm, shiftTime, gearRatios } = this.box;

    // --- direction selection: brake at a standstill engages reverse ---------
    // A driver braking to a standstill and holding the pedal must not shoot
    // backwards: reverse needs the brake to be released and pressed again.
    if (brake < 0.05) this.brakeWasReleased = true;

    const nearlyStopped = Math.abs(speedMps) < 0.6;
    if (nearlyStopped) {
      if (brake > 0.35 && throttle < 0.1 && this.gear >= 0 && this.brakeWasReleased) {
        this.gear = -1;
        this.direction = -1;
        this.brakeWasReleased = false;
      } else if (throttle > 0.1 && this.gear === -1) {
        this.gear = 1;
        this.direction = 1;
      }
    }
    if (this.gear === -1 && speedMps > 1.5) {
      this.gear = 1;
      this.direction = 1;
    }

    // --- engine speed from the wheels ---------------------------------------
    const ratio = Math.abs(this.ratio) * finalDrive;
    const wheelRpm = (Math.abs(wheelAngularSpeed) * 60) / (2 * Math.PI);
    const targetRpm = Math.max(this.engine.idleRpm, wheelRpm * ratio);
    // smooth so a spinning wheel does not make the needle jump
    this.rpm += (Math.min(targetRpm, this.engine.maxRpm) - this.rpm) * Math.min(1, dt * 9);

    // --- automatic shifting --------------------------------------------------
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (this.shiftTimer === 0 && this.gear > 0) {
      if (this.rpm > upshiftRpm && this.gear < gearRatios.length && throttle > 0.05) {
        this.gear += 1;
        this.shiftTimer = shiftTime;
      } else if (this.rpm < downshiftRpm && this.gear > 1) {
        this.gear -= 1;
        this.shiftTimer = shiftTime;
      }
    }

    const shifting = this.shiftTimer > 0;

    // --- torque at the wheel -------------------------------------------------
    // In reverse the brake pedal is the accelerator, so the pedal that drives
    // the car depends on the selected gear.
    const drivePedal = this.gear === -1 ? brake : throttle;
    let torque = 0;
    if (!shifting && this.gear !== 0) {
      const ratioMag = Math.abs(this.ratio) * finalDrive * efficiency;
      const reverseLimited = this.gear === -1 && Math.abs(speedMps) * 3.6 > this.box.maxReverseKmh;
      if (drivePedal > 0.02 && !reverseLimited) {
        const dir = this.gear === -1 ? -1 : 1;
        torque = this.torqueAt(this.rpm) * drivePedal * ratioMag * dir;
      } else if (Math.abs(speedMps) > 0.3) {
        // engine braking always opposes the direction of travel
        const engineBrake = this.engine.brakingTorqueNm * (this.rpm / this.engine.redlineRpm) * ratioMag;
        torque = -Math.sign(speedMps) * engineBrake;
      }
    }

    return {
      engineTorqueAtWheel: torque,
      engineForce: torque / wheelRadius,
      drivePedal,
      rpm: this.rpm,
      gear: this.gearLabel,
      shifting,
      direction: this.gear === -1 ? -1 : 1,
    };
  }

  reset() {
    this.gear = 1;
    this.brakeWasReleased = true;
    this.rpm = this.engine.idleRpm;
    this.shiftTimer = 0;
  }
}
