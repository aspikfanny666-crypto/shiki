import { Box3, Vector3 } from 'three';
import { MATERIAL_PATTERNS, NODE_OVERRIDES } from '../vehicleConfig.js';

/**
 * Part detection for a model whose node names carry no meaning.
 *
 * Hard rule: names are never invented. Each result reports how it was found —
 *   'override'  : pinned by hand in src/vehicleConfig.js
 *   'name'      : the node name itself matched
 *   'material'  : the material name on the node matched
 *   'geometry'  : identified by measured position/size (wheels)
 *   'none'      : not identifiable — reported as missing, not guessed
 *
 * `merged: true` marks a node whose bounding box spans most of the car: the
 * material is right but Sketchfab's material-merger fused it with other parts,
 * so it is NOT a usable standalone part.
 */

const NAME_PATTERNS = {
  steeringWheel: /(steering[_\s-]?wheel|steeringwheel|lenkrad|volant|руль)/i,
  dashboard: /(dash|dashboard|instrument|cluster)/i,
  interior: /(interior|cabin|seat|cockpit|salon)/i,
  headlight: /(head[_\s-]?light|headlamp|scheinwerfer|phare)/i,
  brakeLight: /(tail[_\s-]?light|rear[_\s-]?light|brake[_\s-]?light|stop)/i,
  turnSignal: /(indicator|turn[_\s-]?signal|blinker)/i,
  body: /(body|chassis|shell|exterior)/i,
  glass: /(glass|window|windshield|windscreen)/i,
};

function meshesOf(root) {
  const out = [];
  root.traverse((o) => {
    if (o !== root) out.push(o);
  });
  return out;
}

function materialNames(o) {
  const m = o.material;
  if (!m) return [];
  return (Array.isArray(m) ? m : [m]).map((x) => x?.name ?? '').filter(Boolean);
}

function trianglesOf(object) {
  let tris = 0;
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return tris;
}

function measure(object) {
  const box = new Box3().setFromObject(object, true);
  if (box.isEmpty()) return null;
  return { box, size: box.getSize(new Vector3()), center: box.getCenter(new Vector3()) };
}

function describe(nodes, method, evidence, vehicleSize) {
  if (!nodes?.length) {
    return { found: false, nodes: [], names: [], method: 'none', evidence: evidence ?? 'no name, material or geometric match', triangles: 0, merged: false };
  }
  let merged = false;
  let triangles = 0;
  const details = [];
  for (const n of nodes) {
    const m = measure(n);
    const spansCar = m && vehicleSize ? m.size.z > vehicleSize.z * 0.6 : false;
    if (spansCar) merged = true;
    triangles += trianglesOf(n);
    details.push({
      name: n.name || '(unnamed)',
      materials: materialNames(n),
      size: m ? m.size.toArray().map((v) => +v.toFixed(3)) : null,
      center: m ? m.center.toArray().map((v) => +v.toFixed(3)) : null,
      spansCar,
    });
  }
  return {
    found: true,
    nodes,
    names: nodes.map((n) => n.name || '(unnamed)'),
    name: nodes.map((n) => n.name || '(unnamed)').join(', '),
    method,
    evidence,
    triangles,
    merged,
    details,
  };
}

function resolveOverride(root, override) {
  if (!override) return null;
  const wanted = Array.isArray(override) ? override : [override];
  if (!wanted.length) return null;
  const found = [];
  root.traverse((o) => {
    if (wanted.includes(o.name)) found.push(o);
  });
  return found.length ? found : null;
}

/**
 * @param {THREE.Object3D} root normalised vehicle root
 * @param {object} opts { vehicleSize, extractedWheels }
 */
export function detectParts(root, { vehicleSize, extractedWheels = null } = {}) {
  root.updateWorldMatrix(true, true);
  const nodes = meshesOf(root);

  const byName = (rx) => nodes.filter((o) => rx.test(o.name || ''));
  const byMaterial = (rx) => nodes.filter((o) => materialNames(o).some((n) => rx.test(n)));

  /** name match first, then material match, then the manual override. */
  const find = (key, namePattern, materialPattern, { excludeMaterial = null, maxSpan = null } = {}) => {
    const pinned = resolveOverride(root, NODE_OVERRIDES[key]);
    if (pinned) return describe(pinned, 'override', `pinned in vehicleConfig.js: ${pinned.map((n) => n.name).join(', ')}`, vehicleSize);

    let hits = namePattern ? byName(namePattern) : [];
    let method = 'name';
    if (!hits.length && materialPattern) {
      hits = byMaterial(materialPattern);
      method = 'material';
    }
    if (excludeMaterial) hits = hits.filter((o) => !materialNames(o).some((n) => excludeMaterial.test(n)));
    if (maxSpan && vehicleSize) {
      hits = hits.filter((o) => {
        const m = measure(o);
        return m ? m.size.z <= vehicleSize.z * maxSpan && m.size.x <= vehicleSize.x * maxSpan : false;
      });
    }
    if (!hits.length) return describe(null, 'none', null, vehicleSize);
    const evidence = method === 'material'
      ? `material name(s): ${[...new Set(hits.flatMap(materialNames))].slice(0, 6).join(', ')}`
      : `node name(s): ${hits.slice(0, 6).map((o) => o.name).join(', ')}`;
    return describe(hits, method, evidence, vehicleSize);
  };

  // ---- wheels ---------------------------------------------------------------
  const wheels = {};
  for (const corner of ['frontLeft', 'frontRight', 'rearLeft', 'rearRight']) {
    const key = `${corner}Wheel`;
    const pinned = resolveOverride(root, NODE_OVERRIDES[key]);
    if (pinned) {
      wheels[corner] = describe(pinned, 'override', 'pinned in vehicleConfig.js', vehicleSize);
    } else if (extractedWheels?.[corner]) {
      const w = extractedWheels[corner];
      wheels[corner] = {
        found: true,
        nodes: [w.group],
        names: [w.group.name],
        name: w.group.name,
        method: 'geometry',
        evidence: `triangle-split from merged meshes at [${w.center.toArray().map((v) => v.toFixed(2)).join(', ')}], r=${w.radius.toFixed(3)} m`,
        triangles: w.triangles,
        merged: false,
      };
    } else {
      wheels[corner] = describe(null, 'none', null, vehicleSize);
    }
  }

  return {
    wheels,
    steeringWheel: find('steeringWheel', NAME_PATTERNS.steeringWheel, MATERIAL_PATTERNS.steeringWheel, { maxSpan: 0.35 }),
    dashboard: find('dashboard', NAME_PATTERNS.dashboard, MATERIAL_PATTERNS.dashboard, { maxSpan: 0.45 }),
    interior: find('interior', NAME_PATTERNS.interior, MATERIAL_PATTERNS.interior),
    headlights: find('headlights', NAME_PATTERNS.headlight, MATERIAL_PATTERNS.headlight),
    brakeLights: find('brakeLights', NAME_PATTERNS.brakeLight, MATERIAL_PATTERNS.brakeLight),
    turnSignals: find('turnSignals', NAME_PATTERNS.turnSignal, MATERIAL_PATTERNS.turnSignal),
    body: find('body', NAME_PATTERNS.body, MATERIAL_PATTERNS.body),
    glass: find('glass', NAME_PATTERNS.glass, MATERIAL_PATTERNS.glass),
    allMaterialNames: [...new Set(nodes.flatMap(materialNames))].sort(),
  };
}

export { NAME_PATTERNS };
