/**
 * ---------------------------------------------------------------------------
 * ACTIVE VEHICLE — and the manual override hatch
 * ---------------------------------------------------------------------------
 * The catalogue lives in `src/cars.js`. This module holds the one that is
 * currently selected and re-exports its pieces under the names the rest of the
 * code already imports, so nothing downstream had to change when a second car
 * arrived.
 *
 * These are **live bindings**: `selectCar()` reassigns them, and every module
 * that imported them sees the new values. Read them inside functions, not into
 * a module-level `const` at import time, or you will capture the first car for
 * the life of the page.
 *
 * ---------------------------------------------------------------------------
 * Why detection works the way it does
 * ---------------------------------------------------------------------------
 * Both shipped GLBs came out of Sketchfab, where the export pipeline renames
 * every node to `Object_N`. Nothing can be identified by node name alone, so
 * the loader identifies parts by MATERIAL NAME + MEASURED GEOMETRY and splits
 * the wheels out of the merged meshes at triangle level.
 *
 * If automatic detection gets something wrong for a car, pin it in that car's
 * `nodeOverrides` in `src/cars.js`. Every field accepts an exact node name
 * (e.g. 'Object_47'), an array of node names, or null/[] to leave it to
 * automatic detection. Node names are printed in the console dump and via
 * `window.__BMW__.dumpHierarchy()`.
 */
import { CARS, CAR_IDS, DEFAULT_CAR_ID, getCar } from './cars.js';

export { CARS, CAR_IDS, DEFAULT_CAR_ID, getCar };

export let ACTIVE_CAR = getCar(DEFAULT_CAR_ID);
export let VEHICLE_TUNING = ACTIVE_CAR.tuning;
export let MATERIAL_PATTERNS = ACTIVE_CAR.materialPatterns;
export let NODE_OVERRIDES = ACTIVE_CAR.nodeOverrides;
export let WHEEL_EXTRACTION = ACTIVE_CAR.wheelExtraction;
export let VEHICLE_REFERENCE = ACTIVE_CAR.reference;

/**
 * Point every binding above at another car. Call it BEFORE building a
 * VehicleVisual / VehiclePhysics — they read the tuning in their constructors.
 *
 * @param {string} id a key of CARS
 * @returns {object} the car that is now active
 */
export function selectCar(id) {
  ACTIVE_CAR = getCar(id);
  VEHICLE_TUNING = ACTIVE_CAR.tuning;
  MATERIAL_PATTERNS = ACTIVE_CAR.materialPatterns;
  NODE_OVERRIDES = ACTIVE_CAR.nodeOverrides;
  WHEEL_EXTRACTION = ACTIVE_CAR.wheelExtraction;
  VEHICLE_REFERENCE = ACTIVE_CAR.reference;
  return ACTIVE_CAR;
}

/**
 * Rendering quality lives in src/settings.js (QUALITY_PRESETS), which is
 * user-facing and persisted; this file stays vehicle selection only.
 */
