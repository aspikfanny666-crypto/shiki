import { MathUtils, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Camera modes, cycled with C or the on-screen button:
 *
 *   chase   — classic third person, pulls back with speed
 *   close   — tighter, lower chase for a sense of speed
 *   hood    — on the bonnet, looking down the road
 *   cockpit — driver's eye, just behind the steering wheel
 *   free    — orbit/debug camera (mouse or touch drag)
 *
 * The chase cameras lag the car deliberately: position and look-at are
 * smoothed with a frame-rate independent exponential, the rig leans back under
 * acceleration and dives forward under braking, and the FOV widens slightly
 * with speed. The camera never enters the car because its offset is clamped to
 * stay outside the chassis box and above the ground.
 */

const MODES = ['chase', 'close', 'hood', 'cockpit', 'free'];

const RIGS = {
  chase: { offset: new Vector3(0, 2.25, 6.6), look: new Vector3(0, 1.0, -4.5), fov: 55, stiff: 5.5, speedPull: 2.4, sway: 0.85 },
  close: { offset: new Vector3(0, 1.55, 4.3), look: new Vector3(0, 0.95, -5.5), fov: 62, stiff: 8.0, speedPull: 1.5, sway: 0.55 },
  hood: { offset: new Vector3(0, 1.22, -1.05), look: new Vector3(0, 1.0, -14), fov: 66, stiff: 24, speedPull: 0, sway: 0.18 },
  cockpit: { offset: new Vector3(-0.39, 1.12, 0.22), look: new Vector3(-0.38, 0.98, -14), fov: 70, stiff: 30, speedPull: 0, sway: 0.12 },
};

export class CameraRig {
  constructor(camera, domElement, target, { settings } = {}) {
    this.camera = camera;
    this.target = target;
    this.settings = settings;
    this.mode = 'chase';

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 120;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(0, 0.8, 0);
    this.controls.enabled = false;

    this._desired = new Vector3();
    this._look = new Vector3();
    this._speed01 = 0;
    this._accelSway = 0;
    this._reverseBlend = 0;
    this._lastSpeed = 0;
    this._tmp = new Vector3();
  }

  get label() {
    return this.mode;
  }

  setMode(mode) {
    if (!MODES.includes(mode)) return this.mode;
    this.mode = mode;
    this.controls.enabled = mode === 'free';
    if (mode === 'free') {
      // start the free camera where the chase camera was, so it never jumps
      this.controls.target.copy(this.target.position).add(new Vector3(0, 0.9, 0));
      this.controls.update();
    }
    return this.mode;
  }

  cycleMode() {
    return this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
  }

  setTarget(object3D) {
    this.target = object3D;
  }

  /**
   * @param {number} dt seconds
   * @param {object} state { speedKmh, throttle, brake, reversing }
   */
  update(dt, { speedKmh = 0, throttle = 0, brake = 0, reversing = false } = {}) {
    if (this.mode === 'free') {
      this.controls.update();
      return;
    }
    const target = this.target;
    if (!target) return;

    const rig = RIGS[this.mode];
    const sensitivity = this.settings?.get('cameraSensitivity') ?? 1;
    const smoothing = 1 - Math.exp(-rig.stiff * sensitivity * dt);

    // speed factor drives the pull-back and the FOV stretch
    const speed01 = MathUtils.clamp(Math.abs(speedKmh) / 240, 0, 1);
    this._speed01 += (speed01 - this._speed01) * Math.min(1, dt * 1.8);

    // acceleration sway: measured from the actual speed change, so a gear
    // change or a collision moves the camera too, not just pedal input
    const accel = (speedKmh - this._lastSpeed) / Math.max(dt, 1e-3) / 3.6; // m/s²
    this._lastSpeed = speedKmh;
    const swayTarget = MathUtils.clamp(accel / 9.81, -1.2, 1.2) * rig.sway + (brake - throttle) * 0.12 * rig.sway;
    this._accelSway += (swayTarget - this._accelSway) * Math.min(1, dt * 5);

    // when reversing, ease the chase camera round so the driver sees where the
    // car is going without a hard cut
    const reverseTarget = reversing && this.mode !== 'cockpit' && this.mode !== 'hood' ? 1 : 0;
    this._reverseBlend += (reverseTarget - this._reverseBlend) * Math.min(1, dt * 2.2);

    this._desired.copy(rig.offset);
    this._desired.z += this._speed01 * rig.speedPull + this._accelSway * 0.55;
    this._desired.y += this._speed01 * -0.12 + Math.max(0, this._accelSway) * 0.12;
    // blend the chase position towards the front of the car when reversing
    if (this._reverseBlend > 0.01) {
      this._desired.z = MathUtils.lerp(this._desired.z, -Math.abs(this._desired.z) * 0.85, this._reverseBlend);
      this._desired.y = MathUtils.lerp(this._desired.y, this._desired.y + 0.25, this._reverseBlend);
    }

    // a portrait phone is narrow: pull back and up so the car and the road
    // ahead both fit, instead of the car filling the frame
    if (this.camera.aspect < 0.85 && (this.mode === 'chase' || this.mode === 'close')) {
      this._desired.z *= 1.42;
      this._desired.y *= 1.3;
    }

    // never let the rig end up inside the car
    if (this.mode === 'chase' || this.mode === 'close') {
      const minDistance = 3.1;
      if (Math.abs(this._desired.z) < minDistance) this._desired.z = Math.sign(this._desired.z || 1) * minDistance;
      this._desired.y = Math.max(this._desired.y, 1.25);
    }

    this._desired.applyQuaternion(target.quaternion).add(target.position);
    // and never below the road
    this._desired.y = Math.max(this._desired.y, 0.45);

    this._look.copy(rig.look);
    if (this._reverseBlend > 0.01) this._look.z = MathUtils.lerp(this._look.z, Math.abs(this._look.z) * 0.6, this._reverseBlend);
    this._look.applyQuaternion(target.quaternion).add(target.position);

    this.camera.position.lerp(this._desired, smoothing);
    this.controls.target.lerp(this._look, smoothing);
    this.camera.lookAt(this.controls.target);

    // portrait also needs a wider lens to keep the horizon in shot
    const fov = rig.fov + this._speed01 * 6 + (this.camera.aspect < 0.85 ? 6 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = MathUtils.lerp(this.camera.fov, fov, Math.min(1, dt * 3));
      this.camera.updateProjectionMatrix();
    }
  }

  /** Snap straight to the ideal pose — used after a reset so nothing swings. */
  snap() {
    if (this.mode === 'free') return;
    const rig = RIGS[this.mode];
    const portrait = this.camera.aspect < 0.85 && (this.mode === 'chase' || this.mode === 'close');
    this._speed01 = 0;
    this._accelSway = 0;
    this._reverseBlend = 0;
    this._lastSpeed = 0;
    this._desired.copy(rig.offset);
    if (portrait) {
      this._desired.z *= 1.42;
      this._desired.y *= 1.3;
    }
    this._desired.applyQuaternion(this.target.quaternion).add(this.target.position);
    this._look.copy(rig.look).applyQuaternion(this.target.quaternion).add(this.target.position);
    this.camera.position.copy(this._desired);
    this.controls.target.copy(this._look);
    this.camera.lookAt(this.controls.target);
  }
}

export { MODES as CAMERA_MODES };
