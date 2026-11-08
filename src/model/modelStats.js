/**
 * modelStats — aggregate counts + optimisation findings for a loaded model.
 * Reports only. It never deletes, merges or simplifies anything on its own.
 */

function materialSignature(m) {
  return JSON.stringify({
    type: m.type,
    color: m.color,
    metalness: m.metalness,
    roughness: m.roughness,
    transmission: m.transmission,
    opacity: m.opacity,
    transparent: m.transparent,
    doubleSided: m.doubleSided,
    emissive: m.emissive,
    textures: m.textures.map((t) => `${t.slot}:${t.uuid}`).sort(),
  });
}

export function computeModelStats(analysis) {
  const materials = new Map(); // uuid -> descriptor
  const textures = new Map(); // uuid -> descriptor
  const geometries = new Map(); // uuid -> descriptor

  let triangles = 0;
  let vertices = 0;
  let meshCount = 0;
  let skinnedMeshCount = 0;
  let drawCalls = 0;

  for (const node of analysis.nodes) {
    if (node.isMesh) {
      meshCount += 1;
      if (node.isSkinnedMesh) skinnedMeshCount += 1;
      triangles += node.triangles;
      vertices += node.vertices;
      drawCalls += Math.max(1, node.geometry?.groups || 1);
      if (node.geometry) geometries.set(node.geometry.uuid, node.geometry);
    }
    for (const m of node.materials) {
      materials.set(m.uuid, m);
      for (const t of m.textures) textures.set(t.uuid, t);
    }
  }

  // --- optimisation findings (reported, never auto-applied) -----------------
  const bySignature = new Map();
  for (const m of materials.values()) {
    const sig = materialSignature(m);
    if (!bySignature.has(sig)) bySignature.set(sig, []);
    bySignature.get(sig).push(m.name);
  }
  const duplicateMaterials = [...bySignature.values()]
    .filter((names) => names.length > 1)
    .map((names) => ({ count: names.length, names }));

  const emptyObjects = analysis.nodes
    .filter((n) => !n.isMesh && !n.isBone && !n.isLight && !n.isCamera && n.childCount === 0 && n.depth > 0)
    .map((n) => n.path);

  const emptyMeshes = analysis.meshes
    .filter((n) => n.triangles === 0)
    .map((n) => n.path);

  const hiddenObjects = analysis.nodes.filter((n) => !n.visible).map((n) => n.path);

  const tinyMeshes = analysis.meshes
    .filter((n) => n.triangles > 0 && n.triangles < 50)
    .map((n) => ({ path: n.path, triangles: n.triangles }));

  const largeTextures = [...textures.values()]
    .filter((t) => (t.width ?? 0) >= 4096 || (t.height ?? 0) >= 4096)
    .map((t) => ({ name: t.name, slot: t.slot, size: `${t.width}×${t.height}` }));

  let textureBytes = 0;
  for (const t of textures.values()) {
    if (t.width && t.height) textureBytes += t.width * t.height * 4;
  }

  const heaviestMeshes = [...analysis.meshes]
    .sort((a, b) => b.triangles - a.triangles)
    .slice(0, 15)
    .map((n) => ({ path: n.path, triangles: n.triangles, material: n.materials.map((m) => m.name).join('+') }));

  return {
    triangles,
    vertices,
    meshes: meshCount,
    skinnedMeshes: skinnedMeshCount,
    objects: analysis.nodes.length,
    materials: materials.size,
    textures: textures.size,
    geometries: geometries.size,
    animations: analysis.animations.length,
    estimatedDrawCalls: drawCalls,
    estimatedTextureMemoryMB: +(textureBytes / (1024 * 1024)).toFixed(1),
    findings: {
      duplicateMaterials,
      emptyObjects,
      emptyMeshes,
      hiddenObjects,
      tinyMeshes,
      largeTextures,
      heaviestMeshes,
    },
    materialList: [...materials.values()].map((m) => ({
      name: m.name,
      type: m.type,
      color: m.color,
      metalness: m.metalness,
      roughness: m.roughness,
      maps: m.maps.join(', ') || '(none)',
    })),
    textureList: [...textures.values()].map((t) => ({
      name: t.name,
      slot: t.slot,
      size: t.width && t.height ? `${t.width}×${t.height}` : 'unknown',
      colorSpace: t.colorSpace,
    })),
  };
}

/** Human-readable summary of what could be optimised, with no action taken. */
export function formatOptimisationReport(stats) {
  const f = stats.findings;
  const lines = [];
  lines.push(`triangles: ${stats.triangles.toLocaleString()} | vertices: ${stats.vertices.toLocaleString()}`);
  lines.push(`meshes: ${stats.meshes} | materials: ${stats.materials} | textures: ${stats.textures} | ~draw calls: ${stats.estimatedDrawCalls}`);
  lines.push(`~texture memory (RGBA, no mips): ${stats.estimatedTextureMemoryMB} MB`);
  lines.push(`duplicate material groups: ${f.duplicateMaterials.length}`);
  lines.push(`empty (childless, non-mesh) objects: ${f.emptyObjects.length}`);
  lines.push(`zero-triangle meshes: ${f.emptyMeshes.length}`);
  lines.push(`hidden objects: ${f.hiddenObjects.length}`);
  lines.push(`meshes under 50 triangles: ${f.tinyMeshes.length}`);
  lines.push(`textures >= 4096px: ${f.largeTextures.length}`);
  lines.push('NOTE: nothing was removed or merged — these are suggestions only.');
  return lines.join('\n');
}
