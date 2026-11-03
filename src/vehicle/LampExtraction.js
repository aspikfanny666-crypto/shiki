import { Box3, Color, Group, MeshStandardMaterial, Vector3 } from 'three';
import { boxTest, splitRegions } from '../model/geometrySplit.js';

/**
 * Pulls the real lamp geometry out of the body meshes.
 *
 * The export merged everything by material, so the headlight internals share
 * `Misca0011Mtl` with parts all over the car: lighting that material lights the
 * whole vehicle. The lamps are therefore cut out by VOLUME — their triangles
 * move into meshes of their own with emissive materials, and leave the body
 * behind with a hole exactly their shape, so nothing z-fights and nothing
 * floats in front of the car.
 *
 * The volumes are fractions of the measured car box, not absolute numbers, so a
 * different model of roughly car shape still lands in the right place.
 */

/** Body paint must never be cut: a glowing wing is worse than a dim lamp. */
const EXCLUDE = [/clearcoat/i, /bodyshell/i, /doorcolor/i, /bonnet/i, /boot/i, /tires|tyre/i];

function lampMaterial({ name, color, emissive, roughness = 0.35, metalness = 0.1 }) {
  const m = new MeshStandardMaterial({
    name,
    color: new Color(color),
    emissive: new Color(emissive),
    emissiveIntensity: 0,
    roughness,
    metalness,
    toneMapped: true,
  });
  m.userData.offColor = new Color(color);
  return m;
}

/**
 * @param {THREE.Object3D} model normalised car model
 * @param {THREE.Object3D} parent where the lamp meshes are attached (the vehicle root)
 */
export function extractLamps(model, parent) {
  const box = new Box3().setFromObject(model, true);
  const size = box.getSize(new Vector3());
  const front = box.min.z;
  const rear = box.max.z;
  const halfWidth = size.x / 2;

  // fractions measured against this car: headlights sit in the outer third of
  // the nose, the DRL strip along their top edge, tail lights high at the back
  const lamps = {
    headlightDrl: {
      material: lampMaterial({ name: 'Lamp_DRL', color: 0x2b3137, emissive: 0xdce9ff }),
      test: boxTest({
        xAbs: [halfWidth * 0.40, halfWidth * 0.92],
        y: [size.y * 0.47, size.y * 0.56],
        z: [front, front + size.z * 0.09],
      }),
    },
    headlightMain: {
      material: lampMaterial({ name: 'Lamp_Headlight', color: 0x1d2226, emissive: 0xfff2d6 }),
      test: boxTest({
        xAbs: [halfWidth * 0.40, halfWidth * 0.92],
        y: [size.y * 0.37, size.y * 0.47],
        z: [front, front + size.z * 0.09],
      }),
    },
    tailLight: {
      material: lampMaterial({ name: 'Lamp_Tail', color: 0x2a0806, emissive: 0xff1a0a, roughness: 0.3 }),
      test: boxTest({
        xAbs: [halfWidth * 0.34, halfWidth * 0.90],
        y: [size.y * 0.52, size.y * 0.68],
        z: [rear - size.z * 0.055, rear],
      }),
    },
  };

  const regions = Object.entries(lamps).map(([key, lamp]) => ({ key, test: lamp.test, material: lamp.material }));
  const { parts, report } = splitRegions(model, regions, { excludeMaterials: EXCLUDE, minTriangles: 24 });

  const groups = {};
  for (const [key, meshes] of Object.entries(parts)) {
    if (!meshes.length) continue;
    const group = new Group();
    group.name = `Lamp_${key}`;
    for (const mesh of meshes) group.add(mesh);
    parent.add(group);

    const lampBox = new Box3().setFromObject(group, true);
    groups[key] = {
      group,
      material: lamps[key].material,
      meshes,
      triangles: report.counts[key],
      centre: lampBox.getCenter(new Vector3()),
      size: lampBox.getSize(new Vector3()),
    };
  }

  return {
    lamps: groups,
    report: {
      counts: report.counts,
      donors: report.donors.length,
      found: Object.keys(groups),
      missing: Object.keys(lamps).filter((k) => !groups[k]),
    },
  };
}
