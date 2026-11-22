import { BufferAttribute, BufferGeometry, Mesh, Vector3 } from 'three';

/**
 * Triangle-level geometry splitting, shared by the wheel and lamp extraction.
 *
 * This GLB was merged by material, so a "part" is not a node: the headlights,
 * the tyres and the body panels all live inside the same few meshes. The only
 * way to move a part is to take its triangles.
 */

/**
 * Builds a new indexed geometry from a subset of a geometry's triangles.
 *
 * Attributes are read through the accessor API rather than by indexing
 * `attr.array`: several meshes here live in interleaved buffer views, where
 * that array is the whole shared buffer and raw indexing reads a neighbouring
 * attribute's bytes. getX/getY/getZ also de-normalise, so the copy is float32.
 */
export function geometryFromTriangles(geometry, triangles) {
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

/** Every vertex of the triangle must be inside, so a huge panel is never caught. */
function triangleInside(mesh, pos, at, t, test, scratch) {
  for (let k = 0; k < 3; k++) {
    const i = at(t * 3 + k);
    scratch.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    mesh.localToWorld(scratch);
    if (!test(scratch)) return false;
  }
  return true;
}

/**
 * Moves every triangle that falls inside a region out of the model and into a
 * new mesh of its own, keeping the original material unless one is supplied.
 *
 * @param {THREE.Object3D} root        the model to cut from (world transforms applied)
 * @param {Array<{key: string, test: (p: Vector3) => boolean, material?: THREE.Material}>} regions
 *        regions are tried in order; the first that accepts a triangle takes it
 * @param {object} opts
 *        excludeMaterials — material name patterns that must never be cut
 *        minTriangles     — a region yielding fewer than this is discarded and its triangles stay put
 * @returns {{ parts: Record<string, THREE.Mesh[]>, report: object }}
 */
export function splitRegions(root, regions, { excludeMaterials = [], minTriangles = 1 } = {}) {
  root.updateWorldMatrix(true, true);

  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o);
  });

  const scratch = new Vector3();
  const parts = Object.fromEntries(regions.map((r) => [r.key, []]));
  const counts = Object.fromEntries(regions.map((r) => [r.key, 0]));
  const donors = [];

  for (const mesh of meshes) {
    const names = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => m?.name ?? '');
    if (excludeMaterials.some((rx) => names.some((n) => rx.test(n)))) continue;
    if (Array.isArray(mesh.material) && mesh.geometry.groups.length > 1) continue;

    const geometry = mesh.geometry;
    const pos = geometry.attributes.position;
    const index = geometry.index;
    const triCount = (index ? index.count : pos.count) / 3;
    const at = index ? (i) => index.getX(i) : (i) => i;

    const picked = Object.fromEntries(regions.map((r) => [r.key, []]));
    const rest = [];
    let moved = 0;

    for (let t = 0; t < triCount; t++) {
      let hit = null;
      for (const region of regions) {
        if (triangleInside(mesh, pos, at, t, region.test, scratch)) {
          hit = region.key;
          break;
        }
      }
      if (hit) {
        picked[hit].push(t);
        moved += 1;
      } else {
        rest.push(t);
      }
    }
    if (!moved) continue;

    donors.push({ mesh: mesh.name, materials: names, moved, remaining: rest.length });

    for (const region of regions) {
      const tris = picked[region.key];
      if (!tris.length) continue;
      const part = new Mesh(geometryFromTriangles(geometry, tris), region.material ?? mesh.material);
      part.name = `${region.key}_${mesh.name}`;
      part.castShadow = false;
      part.receiveShadow = false;
      part.applyMatrix4(mesh.matrixWorld);
      part.updateMatrix();
      parts[region.key].push(part);
      counts[region.key] += tris.length;
    }

    if (rest.length) mesh.geometry = geometryFromTriangles(geometry, rest);
    else {
      mesh.visible = false;
      mesh.geometry = new BufferGeometry();
    }
  }

  // a region that caught almost nothing is noise: drop it rather than light up a stray triangle
  for (const region of regions) {
    if (counts[region.key] < minTriangles) {
      parts[region.key] = [];
    }
  }

  return { parts, report: { donors, counts } };
}

/** Box test helper: inclusive bounds, with an optional mirrored |x| range. */
export function boxTest({ xAbs = null, x = null, y, z }) {
  return (p) => {
    if (p.y < y[0] || p.y > y[1]) return false;
    if (p.z < z[0] || p.z > z[1]) return false;
    if (xAbs) {
      const ax = Math.abs(p.x);
      return ax >= xAbs[0] && ax <= xAbs[1];
    }
    if (x) return p.x >= x[0] && p.x <= x[1];
    return true;
  };
}
