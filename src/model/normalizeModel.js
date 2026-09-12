import { Box3, MathUtils, Vector3 } from 'three';
import { BMW_M5_F90_REFERENCE, SCALE_TOLERANCE } from '../config.js';
import { MATERIAL_PATTERNS } from '../vehicleConfig.js';

const MATERIAL_FRONT = MATERIAL_PATTERNS.frontMarker;
const MATERIAL_REAR = MATERIAL_PATTERNS.rearMarker;

/**
 * Scale + orientation normalisation.
 *
 * Nothing here is "blind": every decision is measured, recorded in the
 * returned report, and printed to the console. The model is only rescaled
 * when its measured length differs from the real BMW M5 F90 by more than
 * SCALE_TOLERANCE.
 *
 * Target frame: +Y up, -Z forward, +X right, wheels resting on y = 0,
 * body centred over the origin in X/Z.
 */

function measure(object) {
  object.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(object, true);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  return { box, size, center };
}

/**
 * @param {THREE.Object3D} holder  group the model is parented to (transforms applied here)
 * @param {THREE.Object3D} model   the GLTF scene
 * @param {object} opts
 *   forwardHint: -1 | 1 | null  — sign along the length axis that points forward
 *                                 BEFORE any flip (measured from lights / steering wheel)
 */
export function normalizeModel(holder, model, { forwardHint = null, forceScale = null } = {}) {
  const report = { steps: [] };
  const before = measure(model);
  report.raw = {
    size: before.size.toArray().map((v) => +v.toFixed(4)),
    center: before.center.toArray().map((v) => +v.toFixed(4)),
    min: before.box.min.toArray().map((v) => +v.toFixed(4)),
    max: before.box.max.toArray().map((v) => +v.toFixed(4)),
  };

  // ---- 1. up axis -----------------------------------------------------------
  // glTF is defined as Y-up, and three's loader honours that, so we verify
  // rather than guess: the smallest extent of a car is its height.
  const [sx, sy, sz] = before.size.toArray();
  const upIsY = sy < sx && sy < sz;
  report.upAxis = upIsY ? '+Y (as authored)' : '+Y assumed — model is NOT flattest on Y, check manually';
  report.steps.push(`up axis: ${report.upAxis}`);

  // ---- 2. length axis -------------------------------------------------------
  const lengthAxis = sx > sz ? 'x' : 'z';
  report.lengthAxis = lengthAxis;
  if (lengthAxis === 'x') {
    holder.rotation.y = MathUtils.degToRad(90);
    report.steps.push('length ran along X — rotated +90° about Y so length runs along Z');
  } else {
    report.steps.push('length already runs along Z — no axis swap needed');
  }
  holder.updateMatrixWorld(true);

  // ---- 3. forward sign ------------------------------------------------------
  // -Z is forward by project convention. `forwardHint` is the measured sign of
  // the car's nose along the ORIGINAL length axis. The +90° rotation above maps
  // original +X onto -Z, so the hint must be re-expressed in the rotated frame
  // before we decide whether a 180° flip is needed.
  const noseSignAfterAxisSwap =
    forwardHint === null ? null : lengthAxis === 'x' ? -forwardHint : forwardHint;
  report.noseSignAfterAxisSwap = noseSignAfterAxisSwap;

  if (noseSignAfterAxisSwap === 1) {
    holder.rotation.y += Math.PI;
    report.steps.push('nose pointed at +Z — rotated 180° about Y so the nose faces -Z');
    report.flipped = true;
  } else {
    report.flipped = false;
    report.steps.push(
      noseSignAfterAxisSwap === -1
        ? 'nose already faces -Z — no flip'
        : 'nose direction could not be measured — assuming the authored -Z side is the front (use the Flip 180° control if wrong)',
    );
  }
  holder.updateMatrixWorld(true);

  // ---- 4. scale -------------------------------------------------------------
  const oriented = measure(model);
  const measuredLength = oriented.size.z;
  const ref = BMW_M5_F90_REFERENCE.length;
  let scale = 1;

  if (forceScale) {
    scale = forceScale;
    report.steps.push(`scale forced to ${scale}`);
  } else if (measuredLength > 0 && Math.abs(measuredLength - ref) / ref > SCALE_TOLERANCE) {
    scale = ref / measuredLength;
    report.steps.push(
      `measured length ${measuredLength.toFixed(3)} vs reference ${ref} m ` +
        `(off by ${(((measuredLength - ref) / ref) * 100).toFixed(1)}%) — uniform scale ×${scale.toFixed(5)} applied`,
    );
  } else {
    report.steps.push(`measured length ${measuredLength.toFixed(3)} m is within ±${SCALE_TOLERANCE * 100}% of ${ref} m — no rescale`);
  }
  holder.scale.setScalar(holder.scale.x * scale);
  report.scaleApplied = scale;
  holder.updateMatrixWorld(true);

  // ---- 5. sit on the ground, centre over the origin --------------------------
  const scaled = measure(model);
  holder.position.x -= scaled.center.x;
  holder.position.z -= scaled.center.z;
  holder.position.y -= scaled.box.min.y;
  holder.updateMatrixWorld(true);
  report.steps.push('recentred on X/Z and dropped so the lowest vertex rests on y = 0');

  const final = measure(model);
  report.dimensions = {
    length: +final.size.z.toFixed(3),
    width: +final.size.x.toFixed(3),
    height: +final.size.y.toFixed(3),
  };
  report.reference = {
    length: ref,
    width: BMW_M5_F90_REFERENCE.widthBody,
    widthWithMirrors: BMW_M5_F90_REFERENCE.widthMirrors,
    height: BMW_M5_F90_REFERENCE.height,
  };
  report.deltaPct = {
    length: +(((final.size.z - ref) / ref) * 100).toFixed(1),
    width: +(((final.size.x - BMW_M5_F90_REFERENCE.widthBody) / BMW_M5_F90_REFERENCE.widthBody) * 100).toFixed(1),
    height: +(((final.size.y - BMW_M5_F90_REFERENCE.height) / BMW_M5_F90_REFERENCE.height) * 100).toFixed(1),
  };
  report.finalBox = {
    min: final.box.min.toArray().map((v) => +v.toFixed(3)),
    max: final.box.max.toArray().map((v) => +v.toFixed(3)),
  };

  return report;
}

/**
 * Measures which way the nose points, before any rotation is applied. Returns
 * the sign along the length axis that the FRONT of the car sits on, or null
 * when it cannot be determined.
 *
 * Works off node names first, then MATERIAL names — the shipped GLB has no
 * meaningful node names, but its materials still say "Bonnet…", "Grill…",
 * "Boot…", "Brakelight…".
 */
export function measureForwardHint(model) {
  model.updateWorldMatrix(true, true);
  const whole = measure(model);
  const lengthAxis = whole.size.x > whole.size.z ? 'x' : 'z';
  const axisValue = (p) => (lengthAxis === 'x' ? p.x - whole.center.x : p.z - whole.center.z);

  const materialNames = (o) => {
    const m = o.material;
    if (!m) return [];
    return (Array.isArray(m) ? m : [m]).map((x) => x?.name ?? '').filter(Boolean);
  };

  const centroidOf = (regex, { useMaterials = false, exclude = null } = {}) => {
    const hits = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      const labels = useMaterials ? materialNames(o) : [o.name || ''];
      if (!labels.some((n) => regex.test(n))) return;
      if (exclude && labels.some((n) => exclude.test(n))) return;
      const b = new Box3().setFromObject(o, true);
      if (b.isEmpty()) return;
      hits.push({ label: labels.join('+'), c: b.getCenter(new Vector3()) });
    });
    if (!hits.length) return null;
    const sum = hits.reduce((acc, h) => acc.add(h.c), new Vector3());
    return { point: sum.divideScalar(hits.length), labels: hits.map((h) => h.label) };
  };

  const attempts = [
    {
      method: 'headlights vs tail lights (node names)',
      front: centroidOf(/(head[_\s-]?light|headlamp|scheinwerfer|phare|фар)/i, { exclude: /(rear|tail|back)/i }),
      rear: centroidOf(/(tail[_\s-]?light|rear[_\s-]?light|brake[_\s-]?light)/i),
    },
    {
      method: 'bonnet/grill vs boot/brake lights (material names)',
      front: centroidOf(MATERIAL_FRONT, { useMaterials: true }),
      rear: centroidOf(MATERIAL_REAR, { useMaterials: true }),
    },
    {
      method: 'steering wheel is forward of centre (material names)',
      front: centroidOf(/steeringwheel/i, { useMaterials: true }),
      rear: null,
    },
  ];

  for (const attempt of attempts) {
    if (!attempt.front) continue;
    const f = axisValue(attempt.front.point);
    if (attempt.rear) {
      const r = axisValue(attempt.rear.point);
      if (Math.abs(f - r) < whole.size[lengthAxis] * 0.05) continue;
      return {
        sign: Math.sign(f - r) || -1,
        method: attempt.method,
        evidence: { front: attempt.front.labels.slice(0, 6), rear: attempt.rear.labels.slice(0, 6), frontOffset: +f.toFixed(3), rearOffset: +r.toFixed(3) },
      };
    }
    if (Math.abs(f) > whole.size[lengthAxis] * 0.02) {
      return { sign: Math.sign(f), method: attempt.method, evidence: { front: attempt.front.labels.slice(0, 6), frontOffset: +f.toFixed(3) } };
    }
  }

  return { sign: null, method: 'undetermined', evidence: null };
}
