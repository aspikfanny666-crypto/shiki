import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
} from 'three';
import { BMW_M5_F90_REFERENCE as REF } from '../config.js';

/**
 * Procedural stand-in used ONLY when public/models/bmw-f90.glb is absent.
 *
 * Every node is prefixed with `PLACEHOLDER_` so it can never be mistaken for
 * real Sketchfab hierarchy in the console dump or the debug panel. It is built
 * at real F90 dimensions, +Y up / -Z forward, with separate wheels, so the rest
 * of the pipeline (detection, pivots, stats) exercises the same code path the
 * real model will.
 */
export function createPlaceholderVehicle() {
  const root = new Group();
  root.name = 'PLACEHOLDER_BMW_M5_F90';

  const paint = new MeshStandardMaterial({ name: 'PLACEHOLDER_paint', color: 0x1b3a6b, metalness: 0.7, roughness: 0.28 });
  const glassMat = new MeshStandardMaterial({ name: 'PLACEHOLDER_glass', color: 0x16202c, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.55 });
  const rubber = new MeshStandardMaterial({ name: 'PLACEHOLDER_rubber', color: 0x0d0d0f, metalness: 0.0, roughness: 0.9 });
  const rimMat = new MeshStandardMaterial({ name: 'PLACEHOLDER_rim', color: 0xb8bcc4, metalness: 0.95, roughness: 0.22 });
  const lampFront = new MeshStandardMaterial({ name: 'PLACEHOLDER_headlight', color: 0xffffff, emissive: 0xfff3d0, emissiveIntensity: 1.4, roughness: 0.2 });
  const lampRear = new MeshStandardMaterial({ name: 'PLACEHOLDER_tail_light', color: 0x8b0f14, emissive: 0xff2222, emissiveIntensity: 1.2, roughness: 0.3 });
  const trimMat = new MeshStandardMaterial({ name: 'PLACEHOLDER_interior_trim', color: 0x2a2a2e, roughness: 0.75 });

  const L = REF.length;
  const W = REF.widthBody;
  const H = REF.height;
  const wheelR = REF.wheelDiameterFront / 2;

  const add = (name, geometry, material, [x, y, z], parent = root) => {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Proportions chosen so the placeholder's bounding box matches the real car
  // (4.966 × 1.903 × 1.473 m) and the wheels stay visible outside the body.
  const rideHeight = 0.18;
  const lowerH = 0.66;
  const lowerY = rideHeight + lowerH / 2;
  const cabinH = H - (rideHeight + lowerH);
  const cabinY = rideHeight + lowerH + cabinH / 2;
  const bodyW = W * 0.84;

  // lower body + greenhouse (nose at -Z)
  add('PLACEHOLDER_body_lower', new BoxGeometry(bodyW, lowerH, L), paint, [0, lowerY, 0]);
  add('PLACEHOLDER_body_cabin', new BoxGeometry(bodyW * 0.94, cabinH, L * 0.44), paint, [0, cabinY, L * 0.05]);
  add('PLACEHOLDER_windshield_glass', new BoxGeometry(bodyW * 0.9, cabinH * 0.85, 0.04), glassMat, [0, cabinY, L * 0.05 - L * 0.22]);
  add('PLACEHOLDER_rear_window_glass', new BoxGeometry(bodyW * 0.9, cabinH * 0.8, 0.04), glassMat, [0, cabinY, L * 0.05 + L * 0.22]);

  // interior
  const interior = new Group();
  interior.name = 'PLACEHOLDER_interior';
  root.add(interior);
  add('PLACEHOLDER_dashboard', new BoxGeometry(bodyW * 0.88, 0.16, 0.28), trimMat, [0, cabinY - cabinH * 0.2, -L * 0.14], interior);
  add('PLACEHOLDER_seat_front_left', new BoxGeometry(0.46, 0.5, 0.5), trimMat, [-W * 0.2, lowerY + 0.25, 0], interior);
  add('PLACEHOLDER_seat_front_right', new BoxGeometry(0.46, 0.5, 0.5), trimMat, [W * 0.2, lowerY + 0.25, 0], interior);

  const steering = new Mesh(new TorusGeometry(0.18, 0.022, 12, 32), trimMat);
  steering.name = 'PLACEHOLDER_steering_wheel';
  steering.position.set(-W * 0.2, cabinY - cabinH * 0.1, -L * 0.1);
  steering.rotation.x = -Math.PI * 0.35;
  interior.add(steering);

  // lights
  for (const side of [-1, 1]) {
    add(`PLACEHOLDER_headlight_${side < 0 ? 'left' : 'right'}`, new BoxGeometry(bodyW * 0.3, 0.13, 0.06), lampFront, [side * bodyW * 0.3, lowerY + lowerH * 0.2, -L * 0.5]);
    add(`PLACEHOLDER_tail_light_${side < 0 ? 'left' : 'right'}`, new BoxGeometry(bodyW * 0.3, 0.12, 0.06), lampRear, [side * bodyW * 0.3, lowerY + lowerH * 0.22, L * 0.5]);
  }

  // wheels: separate nodes, one group per corner
  const corners = [
    ['PLACEHOLDER_wheel_FL', -REF.trackFront / 2, -REF.wheelbase / 2],
    ['PLACEHOLDER_wheel_FR', REF.trackFront / 2, -REF.wheelbase / 2],
    ['PLACEHOLDER_wheel_RL', -REF.trackRear / 2, REF.wheelbase / 2],
    ['PLACEHOLDER_wheel_RR', REF.trackRear / 2, REF.wheelbase / 2],
  ];
  for (const [name, x, z] of corners) {
    const wheel = new Group();
    wheel.name = name;
    wheel.position.set(x, wheelR, z);
    root.add(wheel);

    const tyre = new Mesh(new CylinderGeometry(wheelR, wheelR, REF.wheelWidthFront, 28), rubber);
    tyre.name = `${name}_tyre`;
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    wheel.add(tyre);

    const rim = new Mesh(new CylinderGeometry(wheelR * 0.62, wheelR * 0.62, REF.wheelWidthFront * 1.02, 20), rimMat);
    rim.name = `${name}_rim`;
    rim.rotation.z = Math.PI / 2;
    wheel.add(rim);

    const spoke = new Mesh(new BoxGeometry(REF.wheelWidthFront * 1.05, wheelR * 1.1, 0.04), rimMat);
    spoke.name = `${name}_spoke`;
    wheel.add(spoke);
  }

  return root;
}
