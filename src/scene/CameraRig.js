import { Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Three camera modes on one OrbitControls instance:
 *   'follow' — chase camera behind the car (forward is -Z, so it sits at +Z)
 *   'hood'   — just above the bonnet, looking ahead
 *   'orbit'  — free look, mouse/touch driven
 */
export class CameraRig {
  constructor(camera, domElement, target) {
    this.camera = camera;
    this.target = target;
    this.mode = 'follow';

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(0, 0.8, 0);
    this.controls.enabled = false;

    this.followOffset = new Vector3(0, 2.2, 7.0);
    this.followLook = new Vector3(0, 1.0, -3.0);
    this.hoodOffset = new Vector3(0, 1.35, -0.3);
    this.hoodLook = new Vector3(0, 1.2, -12);

    this._desired = new Vector3();
    this._look = new Vector3();
    this._speedBoost = 0;
  }

  setMode(mode) {
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    return this.mode;
  }

  cycleMode() {
    const order = ['follow', 'hood', 'orbit'];
    return this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]);
  }

  setTarget(object3D) {
    this.target = object3D;
  }

  /** @param {number} speedKmh used to pull the camera back as speed rises */
  update(dt, speedKmh = 0) {
    if (this.mode === 'orbit') {
      this.controls.update();
      return;
    }
    if (!this.target) return;

    const follow = this.mode === 'follow';
    this._speedBoost += (Math.min(Math.abs(speedKmh) / 220, 1) - this._speedBoost) * Math.min(1, dt * 2);

    const offset = follow ? this.followOffset : this.hoodOffset;
    const look = follow ? this.followLook : this.hoodLook;

    this._desired.copy(offset);
    if (follow) {
      this._desired.z += this._speedBoost * 1.6;
      // a portrait phone screen is narrow: pull back so the whole car fits
      if (this.camera.aspect < 1) {
        this._desired.z *= 1.5;
        this._desired.y *= 1.25;
      }
    }
    this._desired.applyQuaternion(this.target.quaternion).add(this.target.position);

    this._look.copy(look).applyQuaternion(this.target.quaternion).add(this.target.position);

    const lerp = follow ? 1 - Math.exp(-7 * dt) : 1;
    this.camera.position.lerp(this._desired, lerp);
    this.controls.target.lerp(this._look, lerp);
    this.camera.lookAt(this.controls.target);
  }
}
