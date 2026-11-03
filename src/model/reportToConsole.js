import { formatHierarchyTree } from './analyzeHierarchy.js';
import { formatOptimisationReport } from './modelStats.js';
import { AXIS_CONVENTION } from '../config.js';

const H = 'color:#7dd3fc;font-weight:700';
const WARN = 'color:#fbbf24;font-weight:700';
const BAD = 'color:#f87171;font-weight:700';
const OK = 'color:#4ade80;font-weight:700';

/**
 * The full console dump required by the import stage: object names, mesh names,
 * geometry, materials, animations, transforms, triangle count, mesh count,
 * dimensions, orientation decisions and detected vehicle parts.
 */
export function reportToConsole(visual) {
  const { analysis, stats, parts, normalization, measurements } = visual;

  console.group('%c🚗 BMW M5 F90 — model import report', H);

  // ---------------- source
  if (visual.isPlaceholder) {
    console.warn(
      '%cPLACEHOLDER MODEL IN USE — the real Sketchfab GLB was not found at %s.\n' +
        'Everything below describes the procedural stand-in, not the Sketchfab asset.',
      BAD,
      visual.source.url,
    );
  } else {
    console.log('%cSource:%c %s (%d ms)', OK, '', visual.source.url, visual.source.loadMs);
    console.log('glTF asset:', analysis.asset, 'extensions:', analysis.extensionsUsed);
  }

  // ---------------- counts
  console.group('%c1. modelStats', H);
  console.table({
    Triangles: stats.triangles,
    Vertices: stats.vertices,
    Meshes: stats.meshes,
    Materials: stats.materials,
    Textures: stats.textures,
    Geometries: stats.geometries,
    Objects: stats.objects,
    Animations: stats.animations,
    'Est. draw calls': stats.estimatedDrawCalls,
    'Est. texture MB': stats.estimatedTextureMemoryMB,
  });
  console.groupEnd();

  // ---------------- hierarchy
  console.group('%c2. Full hierarchy (as authored, after normalisation)', H);
  console.log(formatHierarchyTree(analysis, { maxNodes: 1000 }));
  console.groupEnd();

  // ---------------- object + mesh names
  console.group('%c3. Object names (%d) / mesh names (%d)', H, analysis.nodes.length, analysis.meshes.length);
  console.log('objects:', analysis.nodes.map((n) => n.name));
  console.log('meshes:', analysis.meshes.map((n) => n.name));
  console.groupEnd();

  // ---------------- geometry
  console.group('%c4. Geometry per mesh', H);
  console.table(
    analysis.meshes.map((n) => ({
      mesh: n.name,
      type: n.geometry?.type,
      triangles: n.triangles,
      vertices: n.vertices,
      indexed: n.geometry?.indexed,
      attributes: n.geometry?.attributes.join(','),
      groups: n.geometry?.groups,
      morphs: n.geometry?.morphTargets,
    })),
  );
  console.groupEnd();

  // ---------------- materials + textures
  console.group('%c5. Materials (%d)', H, stats.materials);
  console.table(stats.materialList);
  console.groupEnd();
  console.group('%c6. Textures (%d)', H, stats.textures);
  console.table(stats.textureList);
  console.groupEnd();

  // ---------------- animations
  console.group('%c7. Animations (%d)', H, analysis.animations.length);
  if (analysis.animations.length) console.table(analysis.animations.map(({ name, duration, tracks }) => ({ name, duration, tracks })));
  else console.log('none');
  console.groupEnd();

  // ---------------- transforms
  console.group('%c8. Transforms', H);
  console.table(
    analysis.nodes.map((n) => ({
      node: n.name,
      type: n.type,
      position: n.transform.position.join(', '),
      rotation: n.transform.rotationEuler.join(', '),
      scale: n.transform.scale.join(', '),
      worldSize: n.world ? n.world.size.join(' × ') : '-',
    })),
  );
  console.groupEnd();

  // ---------------- scale + orientation
  console.group('%c9. Scale & orientation', H);
  console.log('raw bounding box:', normalization.raw);
  console.log('normalisation steps:');
  normalization.steps.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
  console.log('forward-direction evidence:', normalization.forwardHint);
  console.table({
    'Length (m)': { model: measurements.length, 'real F90': normalization.reference.length, 'Δ %': normalization.deltaPct.length },
    'Width (m)': { model: measurements.width, 'real F90': normalization.reference.width, 'Δ %': normalization.deltaPct.width },
    'Height (m)': { model: measurements.height, 'real F90': normalization.reference.height, 'Δ %': normalization.deltaPct.height },
  });
  console.log('axis convention in use:', AXIS_CONVENTION);
  console.groupEnd();

  // ---------------- detected parts
  console.group('%c10. Vehicle parts found in the model', H);
  const row = (label, res) => ({
    part: label,
    found: res.found ? '✓' : '✗',
    'node name(s) in GLB': res.found ? res.names.slice(0, 4).join(', ') + (res.names.length > 4 ? ` (+${res.names.length - 4})` : '') : '— not identifiable —',
    how: res.method,
    triangles: res.triangles,
    'material-merged?': res.found ? (res.merged ? 'YES — fused with other parts' : 'no') : '-',
    evidence: res.evidence,
  });
  console.table([
    row('front left wheel', parts.wheels.frontLeft),
    row('front right wheel', parts.wheels.frontRight),
    row('rear left wheel', parts.wheels.rearLeft),
    row('rear right wheel', parts.wheels.rearRight),
    row('steering wheel', parts.steeringWheel),
    row('dashboard', parts.dashboard),
    row('interior', parts.interior),
    row('headlights', parts.headlights),
    row('brake lights', parts.brakeLights),
    row('turn signals', parts.turnSignals),
    row('body shell', parts.body),
    row('glass', parts.glass),
  ]);
  console.log('all material names in the file:', parts.allMaterialNames);
  for (const key of ['steeringWheel', 'dashboard', 'headlights', 'brakeLights', 'turnSignals', 'interior']) {
    if (parts[key].found) console.log(`${key} node details:`, parts[key].details);
  }
  if (visual.extraction) {
    console.group('%c10b. Wheel extraction (triangle split out of merged meshes)', H);
    console.log(`method: ${visual.extraction.method} — ${visual.extraction.ms} ms`);
    console.table(visual.extraction.wheels ?? []);
    console.table(visual.extraction.touchedMeshes ?? []);
    if (visual.extraction.skipped?.length) console.log('skipped meshes:', visual.extraction.skipped);
    if (visual.extraction.warnings?.length) console.warn('extraction warnings:', visual.extraction.warnings);
    console.groupEnd();
  }
  if (visual.wheelCount < 4) {
    console.warn('%cOnly %d of 4 wheels built. Pin the node names in src/vehicleConfig.js (NODE_OVERRIDES).', WARN, visual.wheelCount);
  }
  console.groupEnd();

  // ---------------- pivots
  console.group('%c11. Wheel pivot hierarchy built by VehicleVisual', H);
  for (const [key, wheel] of Object.entries(visual.wheels)) {
    if (!wheel) {
      console.log(`${key}: not built (wheel not identified)`);
      continue;
    }
    console.log(
      `${wheel.pivot.name}\n  └── ${wheel.spin.name}\n        └── ${wheel.name}` +
        `   [r=${wheel.radius} m, width=${wheel.width} m, tris=${wheel.triangles}]`,
    );
  }
  console.log('measured wheelbase:', visual.wheelbase, 'm | track F:', visual.trackFront, 'm | track R:', visual.trackRear, 'm');
  console.groupEnd();

  // ---------------- optimisation
  console.group('%c12. Optimisation findings (reported only, nothing removed)', H);
  console.log(formatOptimisationReport(stats));
  if (stats.findings.duplicateMaterials.length) console.table(stats.findings.duplicateMaterials);
  console.log('heaviest meshes:', stats.findings.heaviestMeshes);
  console.log('large textures:', stats.findings.largeTextures);
  console.log('zero-triangle meshes:', stats.findings.emptyMeshes);
  console.log('empty objects:', stats.findings.emptyObjects);
  console.log('hidden objects:', stats.findings.hiddenObjects);
  console.groupEnd();

  // ---------------- warnings
  if (visual.warnings.length) {
    console.group('%c13. Warnings', WARN);
    visual.warnings.forEach((w) => console.warn(w));
    console.groupEnd();
  }

  console.groupEnd();
}

/** Compact machine-readable snapshot, also attached to window.__BMW__.report. */
export function buildReportJSON(visual) {
  const { analysis, stats, parts, normalization, measurements } = visual;
  return {
    source: { ...visual.source, error: visual.source.error ? String(visual.source.error) : null },
    isPlaceholder: visual.isPlaceholder,
    stats: {
      triangles: stats.triangles,
      vertices: stats.vertices,
      meshes: stats.meshes,
      materials: stats.materials,
      textures: stats.textures,
      objects: stats.objects,
      animations: stats.animations,
    },
    dimensions: measurements ? { length: measurements.length, width: measurements.width, height: measurements.height } : null,
    reference: normalization.reference,
    deltaPct: normalization.deltaPct,
    normalization: { steps: normalization.steps, scaleApplied: normalization.scaleApplied, flipped: normalization.flipped, lengthAxis: normalization.lengthAxis, forwardHint: { sign: normalization.forwardHint?.sign ?? null, method: normalization.forwardHint?.method ?? null } },
    axes: AXIS_CONVENTION,
    hierarchy: analysis.nodes.map((n) => ({
      name: n.name, type: n.type, depth: n.depth, parent: n.parent,
      triangles: n.triangles, vertices: n.vertices,
      materials: n.materials.map((m) => m.name),
      position: n.transform.position, scale: n.transform.scale,
      worldSize: n.world?.size ?? null,
    })),
    tree: formatHierarchyTree(analysis, { maxNodes: 1000 }),
    parts: Object.fromEntries(
      Object.entries({
        frontLeftWheel: parts.wheels.frontLeft,
        frontRightWheel: parts.wheels.frontRight,
        rearLeftWheel: parts.wheels.rearLeft,
        rearRightWheel: parts.wheels.rearRight,
        steeringWheel: parts.steeringWheel,
        dashboard: parts.dashboard,
        interior: parts.interior,
        headlights: parts.headlights,
        brakeLights: parts.brakeLights,
        turnSignals: parts.turnSignals,
        body: parts.body,
        glass: parts.glass,
      }).map(([k, v]) => [k, { found: v.found, names: v.names ?? [], method: v.method, triangles: v.triangles ?? 0, merged: v.merged ?? false, evidence: v.evidence, details: v.details ?? null }]),
    ),
    materials: parts.allMaterialNames,
    extraction: visual.extraction ? { ms: visual.extraction.ms, wheels: visual.extraction.wheels, touched: visual.extraction.touchedMeshes?.length ?? 0, warnings: visual.extraction.warnings } : null,
    credit: visual.credit,
    axles: { wheelbase: visual.wheelbase, trackFront: visual.trackFront, trackRear: visual.trackRear },
    pivots: Object.entries(visual.wheels).map(([key, w]) => (w ? { key, pivot: w.pivot.name, spin: w.spin.name, wheel: w.name, radius: w.radius } : { key, built: false })),
    findings: stats.findings,
    warnings: visual.warnings,
  };
}
