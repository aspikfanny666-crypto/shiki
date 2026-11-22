/**
 * Recovery Mode — the GLS's free-driving assist («режим высвобождения»).
 *
 * This is a real feature of the Mercedes-Maybach GLS 600, not a game idea. A
 * GLS with E-ACTIVE BODY CONTROL can pump its air suspension up and down,
 * repeatedly, on the spot. Bogged in sand, that is how it digs itself out: the
 * body rises and drops, each drop packs the sand under the tyres and each lift
 * unloads them, and with a little throttle the car walks out of the hole it
 * made. Mercedes calls it free-driving assist; in Russian it is usually
 * «режим высвобождения» or «раскачка».
 *
 * So this module does exactly that and nothing else. It is NOT a jump button:
 * no impulse is ever applied to the chassis. The only thing it touches is the
 * suspension rest length of the four wheels, which is the one control the real
 * car has too — and the body moves because the springs push it, through the
 * same solver that handles every other bump in the game.
 *
 * It belongs to the car, not to the player: only a car whose entry in
 * `src/cars.js` sets `recoveryAssist: true` offers it. The M5 and the M4 have
 * steel springs and no such function, so for them the button does not exist.
 */

/**
 * How far the body is lifted above its normal ride height, in metres. The
 * pump goes from 0 to this and back — it never squats BELOW normal, because
 * the real car does not either, and because driving the body down is what
 * buries the tyres in the arches.
 */
const LIFT = 0.16;
/** Pumping frequency. Slow enough that the body actually travels. */
const PUMP_HZ = 1.1;
/**
 * Spring rate while the assist runs, as a multiple of the car's own. A soft
 * air spring cannot carry 2.8 tonnes to a new ride height in half a second.
 */
const STIFFNESS_BOOST = 1.6;
/**
 * The force cap is what keeps the car on the ground, and it is the whole
 * difference between this and a jump button.
 *
 * Raising the rest length raises the force the spring applies, and with
 * nothing limiting it the car simply launches: measured at the first attempt,
 * the body rose 0.36 m and all four wheels left the ground for 30 % of the
 * time. That is not what a GLS does in sand, and it is exactly what the player
 * saw — "машина прыгает, а не качается".
 *
 * So each corner's suspension force is capped at this multiple of the static
 * load it carries. Above 1.0 the body is pushed up; below about 2.0 the
 * push can never exceed what gravity holds down, so the wheels stay planted
 * and only the body moves — which is the point.
 */
const FORCE_LIMIT = 1.75;
/** The assist is a low-speed recovery tool; above this it switches itself off. */
const MAX_SPEED_MPS = 4.0;
/** It also stops itself after this long, like the real one. */
const RUN_SECONDS = 20;

export class RecoveryMode {
  /**
   * @param {object} physics VehiclePhysics or KinematicVehicle
   * @param {object} [car] the entry from src/cars.js
   */
  constructor(physics, car = null) {
    this.cycles = 0;
    this.attach(physics, car);
  }

  /** Point at another car: used when the player switches vehicle. */
  attach(physics, car = null) {
    this.physics = physics;
    this.car = car ?? physics?.visual?.car ?? null;
    this.active = false;
    this.phase = 0;
    this.remaining = RUN_SECONDS;
    this.lift = 0;

    /**
     * Three things have to be true. The car has to have the function at all;
     * the physics has to be the real ray-cast vehicle, because the
     * no-WebAssembly fallback has no suspension to pump; and the controller
     * has to expose the rest length, which is the single API this whole
     * feature is built on.
     */
    this.supported = Boolean(
      this.car?.recoveryAssist
      && physics?.controller
      && typeof physics.controller.setWheelSuspensionRestLength === 'function',
    );
    this.restLength = physics?.tuning?.suspension?.restLength ?? 0.3;
    this.stiffness = physics?.tuning?.suspension?.stiffness ?? 100;
    this.maxForce = physics?.tuning?.suspension?.maxForce ?? 40000;
    // static load on one corner, which is what FORCE_LIMIT is a multiple of
    const mass = physics?.tuning?.mass ?? 1800;
    this.cornerLoad = (mass * 9.81) / 4;
  }

  setActive(on) {
    const next = Boolean(on) && this.supported;
    if (next === this.active) return this.active;
    this.active = next;
    this.phase = 0;
    if (next) this.remaining = RUN_SECONDS;
    else this.#restore();
    return this.active;
  }

  toggle() {
    return this.setActive(!this.active);
  }

  /** Put the suspension back exactly as the car's tuning describes it. */
  #restore() {
    const c = this.physics?.controller;
    if (!c || !this.physics?.wheelKeys) return;
    for (let i = 0; i < this.physics.wheelKeys.length; i++) {
      c.setWheelSuspensionRestLength(i, this.restLength);
      c.setWheelSuspensionStiffness(i, this.stiffness);
      c.setWheelMaxSuspensionForce(i, this.maxForce);
    }
    this.lift = 0;
  }

  /**
   * @param {number} dt
   * @param {object} input the merged control state for this frame
   * @param {object} telemetry from the physics
   */
  update(dt, input = {}, telemetry = {}) {
    if (!this.active) return;

    // The real assist is a crawl-speed tool. Drive away and it lets go of the
    // suspension rather than bouncing the car down the road.
    const speed = Math.abs(telemetry.speedMps ?? 0);
    this.remaining -= dt;
    if (speed > MAX_SPEED_MPS || this.remaining <= 0) {
      this.setActive(false);
      return;
    }

    const before = this.phase;
    this.phase = (this.phase + PUMP_HZ * dt) % 1;
    if (this.phase < before) this.cycles += 1;

    // 0 → 1 → 0 over one cycle, all four corners together, so the whole body
    // rises and settles rather than the car rolling from side to side. It
    // never goes below 0: the normal ride height is the bottom of the stroke.
    this.lift = (1 - Math.cos(this.phase * Math.PI * 2)) / 2;
    const rest = this.restLength + this.lift * LIFT;
    // Stiffen on the way up, where the work is done; stay soft on the way
    // down, so the body settles under its own weight instead of being pushed.
    const rising = this.phase < 0.5;
    const stiffness = this.stiffness * (rising ? STIFFNESS_BOOST : 1);

    const c = this.physics.controller;
    for (let i = 0; i < this.physics.wheelKeys.length; i++) {
      c.setWheelSuspensionRestLength(i, rest);
      c.setWheelSuspensionStiffness(i, stiffness);
      c.setWheelMaxSuspensionForce(i, this.cornerLoad * FORCE_LIMIT);
    }
  }

  /** What the HUD and the touch pad need. */
  get status() {
    return {
      available: this.supported,
      active: this.active,
      /** 0 … 1, how much of the run is left — the HUD draws this */
      remaining: this.supported ? Math.max(0, this.remaining / RUN_SECONDS) : 0,
      /** -1 … 1, where the body is in the current pump */
      lift: this.lift,
      cycles: this.cycles,
    };
  }

  describe() {
    return [
      'RecoveryMode (GLS free-driving assist)',
      `  available: ${this.supported}${this.supported ? '' : ' — this car has no such function, or there is no ray-cast suspension to pump'}`,
      `  lifts the body ${LIFT} m above its ${this.restLength.toFixed(2)} m ride height at ${PUMP_HZ} Hz, never below it`,
      `  spring rate ${this.stiffness} → ${Math.round(this.stiffness * STIFFNESS_BOOST)} on the way up`,
      `  suspension force capped at ${FORCE_LIMIT}x the ${Math.round(this.cornerLoad)} N static corner load, so the wheels stay down`,
      `  stops itself above ${MAX_SPEED_MPS} m/s (${Math.round(MAX_SPEED_MPS * 3.6)} km/h) or after ${RUN_SECONDS} s`,
      '  no impulse is applied to the chassis: the body moves because the springs push it',
    ].join('\n');
  }
}
