/**
 * Recovery Mode / Bounce Mode — the GLS's free-driving assist
 * («режим высвобождения»).
 *
 * A real feature of the Mercedes-Maybach GLS 600, not a game idea. A GLS with
 * E-ACTIVE BODY CONTROL pumps its air suspension up and down on the spot, and
 * that is how it digs itself out of sand: the body rises and drops, each drop
 * packs the sand under the tyres, each lift unloads them, and with a little
 * throttle the car walks out of the hole it made.
 *
 * ---------------------------------------------------------------------------
 * The model
 * ---------------------------------------------------------------------------
 * Four independent struts. Rapier's ray-cast vehicle already gives each wheel
 * its own spring, damper and rest length, so this drives the ONE thing the
 * real car drives — the target length of each strut:
 *
 *     L_target,i(t) = L_base + lift + A · sin(2π f t + φ_i)
 *
 * and the solver turns that into F = k(L₀ − L) − c·v at each corner, pushing
 * the body up and the wheel down. Nothing here touches the chassis directly:
 * no impulses, no teleports, no velocity writes.
 *
 * Four details make the difference between this and a pogo stick, and three of
 * them are corrections to earlier attempts that were measured failing:
 *
 *   • The FORCE CAP. Raising the rest length raises the spring force, and with
 *     nothing limiting it the car simply launches — measured, the body rose
 *     0.36 m with all four wheels off the ground 30 % of the time. Capping
 *     each corner at FORCE_LIMIT × the static load it carries means the push
 *     can never exceed what gravity holds down, so only the body moves.
 *   • DAMPING IS CUT while it runs. Stiff dampers eat the actuator's impulse
 *     and the body merely vibrates instead of travelling.
 *   • DROOP IS EXTENDED. If the wheel runs out of downward travel as the body
 *     rises it leaves the ground early, and a 2.8-tonne SUV reads as a bouncing
 *     ball.
 *   • RAMPS at both ends. Stepping the amplitude from 0 to full in one frame
 *     is a step input to a spring, which is exactly how you kick a car into
 *     the air.
 *
 * ---------------------------------------------------------------------------
 * Why it helps, rather than looking like it helps
 * ---------------------------------------------------------------------------
 * The payoff is not in this file. `VehiclePhysics.#updateTerrain` gives loose
 * ground a sink depth per wheel that a spinning wheel deepens and a LOAD PEAK
 * packs back down — any load peak, from a kerb or a bump or this. So the
 * assist works by putting real peaks through real tyres, and would be useless
 * on tarmac, which is correct.
 */

/** Ride height the car is raised to while the assist runs, in metres. */
const OFFROAD_LIFT = 0.055;
/**
 * Peak-to-rest amplitude and frequency of the pump.
 *
 * These are the bottom of the useful range on purpose. Body acceleration in a
 * sinusoidal stroke is a = ω²A, and the spring can only produce that by
 * swinging its force about the car's weight: a = ω²A = g·(F/mg − 1). At the
 * spec's upper numbers — 0.10 m at 1.5 Hz — that works out at 0.72 g, which
 * needs the force to reach 1.72 × static with no margin at all, and anything
 * over the top of that throws the car into the air. Measured at those values:
 * the body swung 0.574 m, four times the stroke, and all four wheels were off
 * the ground 17 % of the time.
 *
 * 0.075 m at 1.25 Hz asks for 0.47 g, i.e. a force swing of 0.53 … 1.47 ×
 * static, which sits inside the cap with room to spare — and still gives about
 * 15 cm of body travel.
 */
const AMPLITUDE = 0.075;
const FREQUENCY = 1.25;
/** Damper coefficients are scaled by this while it runs. */
const DAMPING_SCALE = 0.55;
/** Downward travel is scaled by this, so the wheels stay down as the body lifts. */
const DROOP_SCALE = 1.7;
/**
 * Suspension force ceiling, as a multiple of the static load one corner
 * carries. Above 1.0 the body is pushed up; below about 2.0 the push can never
 * beat gravity, so the wheels stay planted.
 */
const FORCE_LIMIT = 1.55;

/**
 * The governor.
 *
 * Open-loop numbers alone cannot be trusted here: the stroke is deliberately
 * near the body's resonance, damping is deliberately low, and resonance does
 * not care what the numbers were chosen to produce. So the amplitude is scaled
 * by a factor that is pulled DOWN the moment a wheel leaves the ground and
 * creeps back up while all four are planted. It is the difference between
 * "these values should keep it down" and "it is kept down".
 */
const GOVERNOR_DROP_PER_S = 2.5;
const GOVERNOR_RECOVER_PER_S = 0.35;
const GOVERNOR_FLOOR = 0.25;

const RAMP_IN_S = 1.5;
const RAMP_OUT_S = 1.0;

/** It may only be engaged at a crawl, in gear. */
const START_MAX_KMH = 5;
/** And it lets go once the car is actually moving. */
const STOP_KMH = 15;

/** Seconds of continuous running before the hydraulics are considered hot. */
const HEAT_FULL_S = 75;
/** Heat bleeds off this much faster than it builds. */
const COOL_RATE = 1 / 45;
/** It will not restart until heat has fallen back below this. */
const HEAT_RESET = 0.35;

/**
 * Phase offsets per corner, in the order VehiclePhysics lists its wheels:
 * frontLeft, frontRight, rearLeft, rearRight.
 *
 * `sync` is what the car does in the videos — the whole body up and down.
 * `walk` offsets the rear axle by a quarter cycle so the car pitches instead,
 * which packs the ground under one axle at a time and gets out of a hole
 * faster. (`diagonal`, offsetting opposite corners, is the same idea again and
 * is left here as the obvious third option.)
 */
export const PHASE_PATTERNS = Object.freeze({
  sync: Object.freeze([0, 0, 0, 0]),
  walk: Object.freeze([0, 0, Math.PI / 2, Math.PI / 2]),
  diagonal: Object.freeze([0, Math.PI / 2, Math.PI / 2, 0]),
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class RecoveryMode {
  /**
   * @param {object} physics VehiclePhysics or KinematicVehicle
   * @param {object} [car] the entry from src/cars.js
   * @param {object} [opts]
   */
  constructor(physics, car = null, { settings = null } = {}) {
    this.settings = settings;
    this.heat = 0;
    this.cycles = 0;
    this.attach(physics, car);
  }

  /** Point at another car: used when the player switches vehicle. */
  attach(physics, car = null) {
    this.physics = physics;
    this.car = car ?? physics?.visual?.car ?? null;
    /** 'off' | 'in' | 'running' | 'out' | 'cooldown' */
    this.state = 'off';
    this.ramp = 0;
    this.phase = 0;
    this.lift = 0;
    this.blocked = '';
    this.cornerLift = [0, 0, 0, 0];
    this.cornerLoad = [0, 0, 0, 0];
    this.authority = 1;

    /**
     * Three things have to be true: the car has to have the function at all,
     * the physics has to be the real ray-cast vehicle (the no-WebAssembly
     * fallback has no suspension to pump), and the controller has to expose a
     * per-wheel rest length, which is the single API this is built on.
     */
    this.supported = Boolean(
      this.car?.recoveryAssist
      && physics?.controller
      && typeof physics.controller.setWheelSuspensionRestLength === 'function',
    );

    const susp = physics?.tuning?.suspension;
    this.base = {
      restLength: susp?.restLength ?? 0.3,
      stiffness: susp?.stiffness ?? 100,
      compression: susp?.compression ?? 2.5,
      relaxation: susp?.relaxation ?? 3,
      maxTravel: susp?.maxTravel ?? 0.16,
      maxForce: susp?.maxForce ?? 40000,
    };
    this.staticCornerLoad = ((physics?.tuning?.mass ?? 1800) * 9.81) / 4;
  }

  get active() {
    return this.state === 'in' || this.state === 'running' || this.state === 'out';
  }

  get pattern() {
    const name = this.settings?.get('bouncePattern') ?? 'walk';
    return PHASE_PATTERNS[name] ?? PHASE_PATTERNS.walk;
  }

  /**
   * The MBUX conditions: in gear, at a crawl, and the hydraulics not hot.
   * Returns '' when it may start, or a short reason why not.
   */
  startBlocker(telemetry = {}) {
    if (!this.supported) return 'this car has no free-driving assist';
    if (this.heat >= HEAT_RESET && this.state === 'cooldown') return 'hydraulics cooling down';
    const gear = telemetry.gear ?? '1';
    if (gear === 'N' || gear === 'P') return 'select a gear first';
    if (Math.abs(telemetry.speedKmh ?? 0) > START_MAX_KMH) return `below ${START_MAX_KMH} km/h only`;
    return '';
  }

  /** True while the player wants it on — i.e. not counting the fade-out. */
  get engaged() {
    return this.state === 'in' || this.state === 'running';
  }

  setActive(on, telemetry = {}) {
    if (!on) {
      if (this.engaged) this.state = 'out';
      return false;
    }
    const blocker = this.startBlocker(telemetry);
    this.blocked = blocker;
    if (blocker) return false;
    if (!this.engaged) {
      // Catching it mid-fade restarts it from where the ramp currently is,
      // rather than refusing or snapping back to zero.
      if (this.state !== 'out') {
        this.phase = 0;
        this.authority = 1;
      }
      this.state = 'in';
    }
    return true;
  }

  toggle(telemetry = {}) {
    return this.setActive(!this.engaged, telemetry);
  }

  /** Put every strut back exactly as the car's tuning describes it. */
  #restore() {
    const c = this.physics?.controller;
    if (!c || !this.physics?.wheelKeys) return;
    const b = this.base;
    for (let i = 0; i < this.physics.wheelKeys.length; i++) {
      c.setWheelSuspensionRestLength(i, b.restLength);
      c.setWheelSuspensionStiffness(i, b.stiffness);
      c.setWheelSuspensionCompression(i, b.compression);
      c.setWheelSuspensionRelaxation(i, b.relaxation);
      c.setWheelMaxSuspensionTravel(i, b.maxTravel);
      c.setWheelMaxSuspensionForce(i, b.maxForce);
    }
    this.lift = 0;
    this.cornerLift = [0, 0, 0, 0];
  }

  /**
   * Called once per FIXED physics step, not once per frame: this commands a
   * suspension position on a timed curve, and driving that from a variable
   * frame time makes the body lurch when the frame rate drops — at 3 fps the
   * phase advanced a third of a pump per call.
   *
   * @param {number} dt the fixed step, seconds
   * @param {object} input merged control state
   * @param {object} telemetry from the physics
   */
  update(dt, input = {}, telemetry = {}) {
    // heat builds while running and bleeds off the rest of the time
    if (this.state === 'running' || this.state === 'in') this.heat = clamp01(this.heat + dt / HEAT_FULL_S);
    else this.heat = clamp01(this.heat - dt * COOL_RATE);

    if (this.state === 'cooldown' && this.heat < HEAT_RESET) this.state = 'off';
    if (this.state === 'off') return;

    // ---- automatic exits --------------------------------------------------
    if (this.state === 'in' || this.state === 'running') {
      if (Math.abs(telemetry.speedKmh ?? 0) > STOP_KMH) this.state = 'out';
      else if (this.heat >= 1) this.state = 'out';
    }

    // ---- ramp -------------------------------------------------------------
    if (this.state === 'in') {
      this.ramp = clamp01(this.ramp + dt / RAMP_IN_S);
      if (this.ramp >= 1) this.state = 'running';
    } else if (this.state === 'out') {
      this.ramp = clamp01(this.ramp - dt / RAMP_OUT_S);
      if (this.ramp <= 0) {
        this.#restore();
        this.state = this.heat >= 1 ? 'cooldown' : 'off';
        return;
      }
    }

    // ---- governor ----------------------------------------------------------
    // Any wheel off the ground means the stroke is winning against gravity;
    // back the amplitude off until it is not.
    const onGround = telemetry.wheelsOnGround ?? 4;
    if (onGround < (this.physics.wheelKeys?.length ?? 4)) {
      this.authority = Math.max(GOVERNOR_FLOOR, this.authority - GOVERNOR_DROP_PER_S * dt);
    } else {
      this.authority = Math.min(1, this.authority + GOVERNOR_RECOVER_PER_S * dt);
    }

    const before = this.phase;
    this.phase = (this.phase + FREQUENCY * dt) % 1;
    if (this.phase < before) this.cycles += 1;

    // ---- command the four struts -------------------------------------------
    const c = this.physics.controller;
    const b = this.base;
    const r = this.ramp;
    const phases = this.pattern;
    const n = this.physics.wheelKeys.length;

    for (let i = 0; i < n; i++) {
      const wave = Math.sin(this.phase * Math.PI * 2 + (phases[i] ?? 0));
      // base ride height, raised, plus the pump — amplitude and lift both ramp
      const amplitude = AMPLITUDE * this.authority;
      const target = b.restLength + r * (OFFROAD_LIFT + amplitude * wave);
      this.cornerLift[i] = r * (OFFROAD_LIFT + amplitude * wave);
      c.setWheelSuspensionRestLength(i, Math.max(0.05, target));
      // soften the dampers, or they absorb the stroke instead of passing it on
      c.setWheelSuspensionCompression(i, b.compression * (1 - (1 - DAMPING_SCALE) * r));
      c.setWheelSuspensionRelaxation(i, b.relaxation * (1 - (1 - DAMPING_SCALE) * r));
      // let the wheel follow the ground further down than it normally may
      c.setWheelMaxSuspensionTravel(i, b.maxTravel * (1 + (DROOP_SCALE - 1) * r));
      // and never push harder than gravity can hold down
      const cap = this.staticCornerLoad * FORCE_LIMIT;
      c.setWheelMaxSuspensionForce(i, b.maxForce + (cap - b.maxForce) * r);
      this.cornerLoad[i] = c.wheelSuspensionForce?.(i) ?? 0;
    }
    this.lift = this.cornerLift.reduce((a, v) => a + v, 0) / Math.max(1, n);
  }

  /** What the HUD, the pad and the audio need. */
  get status() {
    return {
      available: this.supported,
      active: this.active,
      state: this.state,
      /** 0 … 1 fade, so the audio and the UI can follow it in */
      ramp: this.ramp,
      /** 0 … 1 hydraulic heat; at 1 it stops itself and cools down */
      heat: this.heat,
      /** mean body lift in metres, and the four corners separately */
      lift: this.lift,
      corners: this.cornerLift,
      loads: this.cornerLoad,
      /** -1 … 1, where the pump is, for the pump whine */
      phase: Math.sin(this.phase * Math.PI * 2),
      /** 0.25 … 1, how much amplitude the governor is allowing */
      authority: this.authority,
      cycles: this.cycles,
      blocked: this.blocked,
    };
  }

  describe() {
    const name = this.settings?.get('bouncePattern') ?? 'walk';
    return [
      'RecoveryMode / Bounce Mode (GLS free-driving assist)',
      `  available: ${this.supported}${this.supported ? '' : ' — this car has no such function, or there is no ray-cast suspension to pump'}`,
      `  L_target,i = ${this.base.restLength.toFixed(2)} + ${OFFROAD_LIFT} + ${AMPLITUDE}·sin(2π·${FREQUENCY}·t + φi)`,
      `  phase pattern "${name}": [${(PHASE_PATTERNS[name] ?? []).map((p) => (p / Math.PI).toFixed(2) + 'π').join(', ')}]`,
      `  dampers ×${DAMPING_SCALE}, droop ×${DROOP_SCALE} while running`,
      `  force capped at ${FORCE_LIMIT}× the ${Math.round(this.staticCornerLoad)} N static corner load`,
      `  governor: amplitude ×${this.authority.toFixed(2)}, cut ${GOVERNOR_DROP_PER_S}/s whenever a wheel lifts`,
      `  ramps: ${RAMP_IN_S} s in, ${RAMP_OUT_S} s out`,
      `  starts below ${START_MAX_KMH} km/h in gear; releases above ${STOP_KMH} km/h; hot after ${HEAT_FULL_S} s`,
      '  no impulse is applied to the chassis: the body moves because the springs push it',
    ].join('\n');
  }
}
