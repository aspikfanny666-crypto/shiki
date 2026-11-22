import { Box3, Vector3 } from 'three';

const _box = new Box3();
const _size = new Vector3();
const _center = new Vector3();

function triangleCount(geometry) {
  if (!geometry) return 0;
  if (geometry.index) return geometry.index.count / 3;
  const pos = geometry.attributes?.position;
  return pos ? pos.count / 3 : 0;
}

function vertexCount(geometry) {
  return geometry?.attributes?.position?.count ?? 0;
}

function materialList(object) {
  if (!object.material) return [];
  return Array.isArray(object.material) ? object.material : [object.material];
}

function describeGeometry(geometry) {
  if (!geometry) return null;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const size = bb ? bb.getSize(new Vector3()) : new Vector3();
  return {
    type: geometry.type,
    uuid: geometry.uuid,
    indexed: Boolean(geometry.index),
    triangles: triangleCount(geometry),
    vertices: vertexCount(geometry),
    attributes: Object.keys(geometry.attributes ?? {}),
    groups: geometry.groups?.length ?? 0,
    morphTargets: Object.keys(geometry.morphAttributes ?? {}).length,
    localSize: size.toArray().map((v) => +v.toFixed(4)),
  };
}

function describeMaterial(material) {
  const maps = [
    'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
    'alphaMap', 'bumpMap', 'displacementMap', 'clearcoatMap',
    'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap',
    'specularMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap',
    'envMap', 'lightMap',
  ].filter((slot) => material[slot]);

  return {
    name: material.name || '(unnamed)',
    type: material.type,
    uuid: material.uuid,
    color: material.color ? `#${material.color.getHexString()}` : null,
    metalness: material.metalness ?? null,
    roughness: material.roughness ?? null,
    transmission: material.transmission ?? null,
    opacity: material.opacity,
    transparent: material.transparent,
    doubleSided: material.side === 2,
    emissive: material.emissive ? `#${material.emissive.getHexString()}` : null,
    emissiveIntensity: material.emissiveIntensity ?? null,
    maps,
    textures: maps.map((slot) => ({
      slot,
      uuid: material[slot].uuid,
      name: material[slot].name || '(unnamed)',
      width: material[slot].image?.width ?? null,
      height: material[slot].image?.height ?? null,
      colorSpace: material[slot].colorSpace,
    })),
  };
}

function round(n, d = 4) {
  return +Number(n).toFixed(d);
}

/**
 * Walks the loaded GLTF scene and produces a plain-data description of the
 * whole hierarchy: names, types, transforms, geometry, materials, per-node
 * triangle counts and world bounding boxes. Pure read-only — it does not
 * mutate the scene graph.
 */
export function analyzeHierarchy(root, gltf = null) {
  root.updateWorldMatrix(true, true);

  const nodes = [];
  const byUuid = new Map();

  const visit = (object, depth, parentEntry) => {
    _box.makeEmpty();
    let hasBox = false;
    try {
      _box.setFromObject(object, true);
      hasBox = !_box.isEmpty();
    } catch {
      hasBox = false;
    }
    if (hasBox) {
      _box.getSize(_size);
      _box.getCenter(_center);
    }

    const materials = materialList(object);
    const geometry = object.geometry ?? null;
    const instances = object.isInstancedMesh ? object.count : 1;

    const entry = {
      name: object.name || '(unnamed)',
      type: object.type,
      uuid: object.uuid,
      depth,
      path: parentEntry ? `${parentEntry.path}/${object.name || object.type}` : (object.name || object.type),
      parent: parentEntry ? parentEntry.name : null,
      childCount: object.children.length,
      visible: object.visible,
      isMesh: Boolean(object.isMesh),
      isSkinnedMesh: Boolean(object.isSkinnedMesh),
      isBone: Boolean(object.isBone),
      isLight: Boolean(object.isLight),
      isCamera: Boolean(object.isCamera),
      instances,
      transform: {
        position: object.position.toArray().map((v) => round(v)),
        rotationEuler: [object.rotation.x, object.rotation.y, object.rotation.z].map((v) => round(v)),
        quaternion: object.quaternion.toArray().map((v) => round(v)),
        scale: object.scale.toArray().map((v) => round(v)),
      },
      world: hasBox
        ? {
            size: _size.toArray().map((v) => round(v)),
            center: _center.toArray().map((v) => round(v)),
            min: _box.min.toArray().map((v) => round(v)),
            max: _box.max.toArray().map((v) => round(v)),
          }
        : null,
      geometry: describeGeometry(geometry),
      materials: materials.map(describeMaterial),
      triangles: triangleCount(geometry) * instances,
      vertices: vertexCount(geometry),
      userData: Object.keys(object.userData ?? {}).length ? object.userData : null,
      object,
    };

    nodes.push(entry);
    byUuid.set(object.uuid, entry);

    for (const child of object.children) visit(child, depth + 1, entry);
    return entry;
  };

  visit(root, 0, null);

  const animations = (gltf?.animations ?? []).map((clip) => ({
    name: clip.name,
    duration: round(clip.duration, 3),
    tracks: clip.tracks.length,
    trackNames: clip.tracks.map((t) => t.name),
  }));

  return {
    nodes,
    byUuid,
    meshes: nodes.filter((n) => n.isMesh),
    animations,
    root,
    asset: gltf?.parser?.json?.asset ?? null,
    extensionsUsed: gltf?.parser?.json?.extensionsUsed ?? [],
  };
}

/** ASCII tree of the hierarchy — what actually is in the file, nothing invented. */
export function formatHierarchyTree(analysis, { maxDepth = Infinity, maxNodes = 400 } = {}) {
  const lines = [];
  let shown = 0;

  for (const node of analysis.nodes) {
    if (node.depth > maxDepth) continue;
    if (shown >= maxNodes) {
      lines.push(`… ${analysis.nodes.length - shown} more nodes (raise maxNodes to see all)`);
      break;
    }
    const indent = '  '.repeat(node.depth);
    const bits = [`${indent}${node.name}  [${node.type}]`];
    if (node.isMesh) {
      bits.push(`tris=${node.triangles}`);
      bits.push(`verts=${node.vertices}`);
      bits.push(`mat=${node.materials.map((m) => m.name).join('+') || 'none'}`);
    }
    if (node.world) bits.push(`size=${node.world.size.map((v) => v.toFixed(2)).join('×')}`);
    lines.push(bits.join('  '));
    shown += 1;
  }

  return lines.join('\n');
}
