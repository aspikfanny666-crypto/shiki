import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from 'three';
import { MATERIAL_PATTERNS, WHEEL_EXTRACTION } from '../vehicleConfig.js';

/**
 * Triangle-level wheel extraction.
 *
 * The shipped GLB is merged by material: one mesh can hold two tires plus part
 * of the body, so there is no "front left wheel" node to rotate. This module
 * finds the four wheel volumes by measuring the tire material, then moves every
 * triangle that falls inside those volumes into four separate groups, leaving
 * the rest of the car behind.
 *
 * Nothing is deleted — every triangle ends up either in a wheel group or in the
 * original mesh.
 */

const CORNERS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

function triangleCentroid(pos, ia, ib, ic, out) {
  out.set(
    (pos.getX(ia) + pos.getX(ib) + pos.getX(ic)) / 3,
    (pos.getY(ia) + pos.getY(ib) + pos.getY(ic)) / 3,
    (pos.getZ(ia) + pos.getZ(ib) + pos.getZ(ic)) / 3,
  );
  return out;
}

/** Builds a new indexed geometry containing only the listed triangles. */
function geometryFromTriangles(geometry, triangles) {
  const index = geometry.index;
  const at = index ? (i) => index.getX(i) : (i) => i;
  const remap = new Map();
  const newIndex = new Uint32Array(triangles.length * 3);
  let w = 0;

  for (const t of triangles) {
    for (let k = 0; k < 3; k++) {
      const old = at(t * 3 + k);
      let next = remap.get(old);
      if (next === undefined) {
        next = remap.size;
        remap.set(old, next);
      }
      newIndex[w++] = next;
    }
  }

  const out = new BufferGeometry();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const size = attr.itemSize;
    // Read through the accessor API, never the raw array: this file stores
    // several meshes in interleaved buffer views, where `attr.array` is the
    // whole shared buffer and indexing it directly reads a neighbouring
    // attribute's bytes — which produced huge stray polygons rotating with the
    // wheels. getX/getY/getZ also de-normalise, so the copy is plain float32.
    const array = new Float32Array(remap.size * size);
    const readers = [attr.getX, attr.getY, attr.getZ, attr.getW];
    for (const [old, next] of remap) {
      for (let c = 0; c < size; c++) {
        array[next * size + c] = readers[c] ? readers[c].call(attr, old) : 0;
      }
    }
    out.setAttribute(name, new BufferAttribute(array, size, false));
  }
  out.setIndex(new BufferAttribute(newIndex, 1));
  return out;
}

function materialNames(mesh) {
  const m = mesh.material;
  return (Array.isArray(m) ? m : [m]).map((x) => x?.name ?? '');
}

/**
 * @param {THREE.Object3D} modelRoot  normalised model (metres, -Z forward)
 * @param {THREE.Object3D} space      object whose local space the wheel centres are expressed in
 * @returns {{ wheels: Record<string,{group: THREE.Group, center: Vector3, radius: number, width: number, triangles: number}>, report: object }}
 */
export function extractWheels(modelRoot, space, options = {}) {
  const opts = { ...WHEEL_EXTRACTION, ...options };
  const report = { method: 'triangle-split', touchedMeshes: [], skipped: [], warnings: [] };

  modelRoot.updateWorldMatrix(true, true);

  // ---- 1. measure the tire volumes ----------------------------------------
  const tireCentroids = [];
  const tmp = new Vector3();

  modelRoot.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    if (!materialNames(o).some((n) => MATERIAL_PATTERNS.tire.test(n))) return;
    const pos = o.geometry.attributes.position;
    const index = o.geometry.index;
    const count = index ? index.count : pos.count;
    const at = index ? (i) => index.getX(i) : (i) => i;
    for (let t = 0; t < count / 3; t += 3) {
      // every 3rd triangle is plenty to locate the wheels
      triangleCentroid(pos, at(t * 3), at(t * 3 + 1), at(t * 3 + 2), tmp);
      tireCentroids.push(o.localToWorld(tmp.clone()));
    }
  });

  if (tireCentroids.length < 64) {
    report.warnings.push(`only ${tireCentroids.length} tire-material samples found — extraction aborted`);
    return { wheels: null, report };
  }

  // Split on the MIDPOINT of the extremes, not the median: the merged meshes
  // hold wildly different sample counts per corner, and a median can land
  // inside one of the clusters and swallow a whole axle.
  const midpoint = (values) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return (lo + hi) / 2;
  };
  const splitX = midpoint(tireCentroids.map((v) => v.x));
  const splitZ = midpoint(tireCentroids.map((v) => v.z));

  const cornerOf = (v) => `${v.z < splitZ ? 'front' : 'rear'}${v.x < splitX ? 'Left' : 'Right'}`;

  const boxes = {};
  for (const c of CORNERS) boxes[c] = new Box3();
  for (const v of tireCentroids) boxes[cornerOf(v)].expandByPoint(v);

  const wheels = {};
  for (const c of CORNERS) {
    if (boxes[c].isEmpty()) {
      report.warnings.push(`no tire samples in corner ${c}`);
      continue;
    }
    const size = boxes[c].getSize(new Vector3());
    const center = boxes[c].getCenter(new Vector3());
    // a single wheel is never longer than it is tall; if it is, two wheels were
    // merged into one cluster and the split went wrong.
    if (size.z > size.y * 1.6 || size.x > size.y * 1.6) {
      report.warnings.push(
        `corner ${c} cluster measures ${size.toArray().map((v) => v.toFixed(2)).join('×')} m — that is not a single wheel`,
      );
    }
    // centroids sit slightly inside the tread, so the real radius is a little
    // larger than the sampled half-height; use the vertical extent as the base.
    const radius = Math.max(size.y, size.z) / 2;
    wheels[c] = {
      key: c,
      center,
      radius,
      width: size.x,
      triangles: 0,
      group: new Group(),
      meshCount: 0,
    };
    wheels[c].group.name = `${c[0].toUpperCase()}${c.slice(1)}WheelVisual`;
  }

  if (Object.keys(wheels).length !== 4) {
    report.warnings.push(`expected 4 wheel clusters, found ${Object.keys(wheels).length}`);
    return { wheels: null, report };
  }

  // ---- 2. move every triangle inside a wheel cylinder into that wheel ------
  const meshes = [];
  modelRoot.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o);
  });

  const world = new Vector3();

  for (const mesh of meshes) {
    const names = materialNames(mesh);
    if (opts.excludeMaterials.some((rx) => names.some((n) => rx.test(n)))) {
      report.skipped.push({ mesh: mesh.name, materials: names, reason: 'excluded by config' });
      continue;
    }
    if (Array.isArray(mesh.material) && mesh.geometry.groups.length > 1) {
      report.skipped.push({ mesh: mesh.name, reason: 'multi-material mesh — not split' });
      continue;
    }

    const geometry = mesh.geometry;
    const pos = geometry.attributes.position;
    const index = geometry.index;
    const triCount = (index ? index.count : pos.count) / 3;
    const at = index ? (i) => index.getX(i) : (i) => i;

    const perCorner = { frontLeft: [], frontRight: [], rearLeft: [], rearRight: [] };
    const rest = [];

    for (let t = 0; t < triCount; t++) {
      // EVERY vertex has to be inside the wheel volume, not just the centroid.
      // Testing the centroid alone lets a huge flat body panel whose centre
      // happens to fall in a wheel well get pulled into the rotating wheel —
      // which looks like black sheets sweeping around the car.
      let hit = null;
      for (const c of CORNERS) {
        const w = wheels[c];
        const halfWidth = (w.width / 2) * opts.widthScale;
        const radiusSq = (w.radius * opts.radiusScale) ** 2;
        let inside = true;
        for (let k = 0; k < 3 && inside; k++) {
          const i = at(t * 3 + k);
          world.set(pos.getX(i), pos.getY(i), pos.getZ(i));
          mesh.localToWorld(world);
          if (Math.abs(world.x - w.center.x) > halfWidth) inside = false;
          else {
            const dy = world.y - w.center.y;
            const dz = world.z - w.center.z;
            if (dy * dy + dz * dz > radiusSq) inside = false;
          }
        }
        if (inside) {
          hit = c;
          break;
        }
      }
      if (hit) perCorner[hit].push(t);
      else rest.push(t);
    }

    const moved = CORNERS.reduce((n, c) => n + perCorner[c].length, 0);
    if (moved === 0) continue;

    for (const c of CORNERS) {
      const tris = perCorner[c];
      if (!tris.length) continue;
      const wheelGeom = geometryFromTriangles(geometry, tris);
      const part = new Mesh(wheelGeom, mesh.material);
      part.name = `${wheels[c].group.name}_${mesh.name}`;
      part.castShadow = mesh.castShadow;
      part.receiveShadow = mesh.receiveShadow;
      // keep the part exactly where it was, then re-origin it on the wheel centre
      part.applyMatrix4(mesh.matrixWorld);
      part.position.sub(wheels[c].center);
      part.updateMatrix();
      // the group itself is placed at the wheel centre by the caller
      wheels[c].group.add(part);
      wheels[c].triangles += tris.length;
      wheels[c].meshCount += 1;
    }

    // rebuild the donor mesh without the wheel triangles
    if (rest.length) {
      mesh.geometry = geometryFromTriangles(geometry, rest);
    } else {
      mesh.visible = false;
      mesh.geometry = new BufferGeometry();
    }

    report.touchedMeshes.push({
      mesh: mesh.name,
      materials: names,
      moved,
      remaining: rest.length,
      corners: Object.fromEntries(CORNERS.map((c) => [c, perCorner[c].length]).filter(([, n]) => n)),
    });
  }

  // wheel parts were baked into world space; they are re-parented by the caller
  for (const c of CORNERS) {
    wheels[c].center = space ? space.worldToLocal(wheels[c].center.clone()) : wheels[c].center;
  }

  report.wheels = CORNERS.map((c) => ({
    corner: c,
    center: wheels[c].center.toArray().map((v) => +v.toFixed(3)),
    radius: +wheels[c].radius.toFixed(4),
    width: +wheels[c].width.toFixed(4),
    triangles: wheels[c].triangles,
    meshes: wheels[c].meshCount,
  }));

  return { wheels, report };
}
