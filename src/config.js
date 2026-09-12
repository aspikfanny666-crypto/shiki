/**
 * Project-wide conventions and reference data.
 *
 * COORDINATE CONVENTION (used everywhere: visual, physics, camera, input):
 *
 *   +Y  = up
 *   -Z  = forward  (the direction the car drives towards)
 *   +X  = right    (right = cross(forward, up) in a right-handed system)
 *
 * This matches Three.js' own notion of "forward" for cameras and Object3D
 * (an unrotated object looks down -Z), so `object.lookAt()`, quaternions
 * built from `setFromUnitVectors(FORWARD, dir)` and Rapier bodies all agree
 * without any per-module sign flipping.
 */
import { Vector3 } from 'three';

export const UP = Object.freeze(new Vector3(0, 1, 0));
export const FORWARD = Object.freeze(new Vector3(0, 0, -1));
export const RIGHT = Object.freeze(new Vector3(1, 0, 0));

export const AXIS_CONVENTION = Object.freeze({
  up: '+Y',
  forward: '-Z',
  right: '+X',
  handedness: 'right-handed',
});

/**
 * Real-world reference dimensions of a BMW M5 (F90, LCI), in metres.
 * Source: BMW published specification. Used to sanity-check / normalise the
 * scale of whatever GLB is loaded — we never scale "blind".
 */
export const BMW_M5_F90_REFERENCE = Object.freeze({
  length: 4.966,
  widthBody: 1.903, // without mirrors
  widthMirrors: 2.126,
  height: 1.473,
  wheelbase: 2.982,
  trackFront: 1.627,
  trackRear: 1.605,
  wheelDiameterFront: 0.6985, // 275/35 R20
  wheelDiameterRear: 0.7113, // 285/35 R20
  wheelWidthFront: 0.275,
  wheelWidthRear: 0.285,
  kerbMass: 1895,
});

/** Tolerance before the loader rescales the model (fraction of reference length). */
export const SCALE_TOLERANCE = 0.05;

/** Where the Sketchfab GLB is expected. See public/models/README.md. */
export const MODEL_URL = 'models/bmw-f90.glb';

export const DECODER_PATHS = Object.freeze({
  draco: 'draco/',
  ktx2: 'basis/',
});
