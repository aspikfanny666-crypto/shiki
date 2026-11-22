import { BufferAttribute, CanvasTexture, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three';

/**
 * Tyre and rim detailing.
 *
 * The GLB ships ZERO textures — 89 flat materials, no images — so the tyres
 * render as plain black shapes with no tread. Nothing can be recovered from the
 * file, so the tread is generated here: a height field is rasterised on a
 * canvas, converted to a normal map, and paired with a roughness map.
 *
 * The model's own UVs were dropped by the exporter's material merge, so a
 * cylindrical unwrap is computed from the geometry itself — the wheel groups are
 * already re-origined on the wheel centre with the axle along X, which makes it
 * exactly `u = angle around X`, `v = position across the tread`.
 */

const TREAD_BLOCKS = 26; // blocks around the circumference

function treadHeightCanvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // v runs across the tyre: 0 = outer sidewall, 1 = inner sidewall
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, size, size);

  const treadTop = size * 0.22;
  const treadBottom = size * 0.78;
  const treadHeight = treadBottom - treadTop;

  // tread band base
  ctx.fillStyle = '#c8c8c8';
  ctx.fillRect(0, treadTop, size, treadHeight);

  // two circumferential grooves
  ctx.fillStyle = '#111';
  for (const t of [0.33, 0.67]) {
    ctx.fillRect(0, treadTop + treadHeight * t - size * 0.012, size, size * 0.024);
  }

  // angled tread blocks, cut by lateral grooves
  const step = size / 10; // repeats are handled by texture.repeat, 10 per tile
  ctx.fillStyle = '#0e0e0e';
  for (let i = 0; i < 10; i++) {
    const x = i * step;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, treadTop);
    ctx.lineTo(x + step * 0.18, treadTop);
    ctx.lineTo(x + step * 0.34, treadBottom);
    ctx.lineTo(x + step * 0.16, treadBottom);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // sidewall ribs: faint, and smooth enough that the radial stretch is invisible
  ctx.strokeStyle = 'rgba(190,190,190,0.55)';
  ctx.lineWidth = size * 0.006;
  for (const v of [0.06, 0.1, 0.9, 0.94]) {
    ctx.beginPath();
    ctx.moveTo(0, size * v);
    ctx.lineTo(size, size * v);
    ctx.stroke();
  }
  // shoulder edge, where tread meets sidewall
  ctx.strokeStyle = 'rgba(120,120,120,0.8)';
  ctx.lineWidth = size * 0.012;
  for (const y of [treadTop, treadBottom]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  return { canvas: c, ctx, size };
}

/** Sobel the height field into a tangent-space normal map. */
function normalMapFromHeight({ canvas, ctx, size }, strength = 2.4) {
  const src = ctx.getImageData(0, 0, size, size).data;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const octx = out.getContext('2d');
  const img = octx.createImageData(size, size);
  const at = (x, y) => src[((y & (size - 1)) * size + (x & (size - 1))) * 4] / 255;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Tread rubber is matte, the sidewall slightly less so. */
function roughnessCanvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0.0, '#b4b4b4');
  g.addColorStop(0.2, '#d2d2d2');
  g.addColorStop(0.5, '#f2f2f2');
  g.addColorStop(0.8, '#d2d2d2');
  g.addColorStop(1.0, '#b4b4b4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // speckle so the rubber is not perfectly even
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

let sharedMaterial = null;

/** One material for all four tyres — built once, reused. */
function tyreMaterial() {
  if (sharedMaterial) return sharedMaterial;

  const height = treadHeightCanvas(512);
  const normal = new CanvasTexture(normalMapFromHeight(height));
  normal.wrapS = normal.wrapT = RepeatWrapping;
  normal.repeat.set(TREAD_BLOCKS / 10, 1);
  normal.anisotropy = 4;

  const rough = new CanvasTexture(roughnessCanvas());
  rough.wrapS = rough.wrapT = RepeatWrapping;
  rough.repeat.set(TREAD_BLOCKS / 10, 1);

  sharedMaterial = new MeshStandardMaterial({
    name: 'Tyre_procedural',
    color: 0x0c0c0e,
    roughness: 0.95,
    metalness: 0.0,
    normalMap: normal,
    roughnessMap: rough,
    envMapIntensity: 0.35,
  });
  sharedMaterial.normalScale.set(1.1, 1.1);
  return sharedMaterial;
}

/**
 * Cylindrical unwrap around the X axis for a wheel-local geometry.
 * `u` follows the circumference (with a seam fix so the wrap-around triangle
 * does not smear the whole texture across itself), `v` crosses the tyre.
 */
function unwrapCylindrical(geometry) {
  const pos = geometry.attributes.position;
  if (!pos) return false;

  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  const width = Math.max(maxX - minX, 1e-5);

  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const angle = Math.atan2(z, y); // -PI..PI around the axle
    uv[i * 2] = (angle + Math.PI) / (Math.PI * 2);
    uv[i * 2 + 1] = (pos.getX(i) - minX) / width;
  }

  // fix the seam: any triangle spanning the 0/1 wrap gets its own duplicated
  // vertices pushed past 1 instead of running backwards across the texture
  const index = geometry.index;
  if (index) {
    for (let t = 0; t < index.count / 3; t++) {
      const a = index.getX(t * 3);
      const b = index.getX(t * 3 + 1);
      const c = index.getX(t * 3 + 2);
      const us = [uv[a * 2], uv[b * 2], uv[c * 2]];
      if (Math.max(...us) - Math.min(...us) > 0.5) {
        for (const i of [a, b, c]) if (uv[i * 2] < 0.5) uv[i * 2] += 1;
      }
    }
  }

  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  geometry.attributes.uv.needsUpdate = true;
  return true;
}

/**
 * Applies the procedural tyre treatment to the extracted wheel groups.
 * @param {Record<string, {group: THREE.Object3D}>} wheels
 * @returns {{ tyreMeshes: number, radiusRange: number[] }} what was changed
 */
export function detailTyres(wheels) {
  const material = tyreMaterial();
  const report = { tyreMeshes: 0, skipped: 0, materials: new Set() };
  const v = new Vector3();

  for (const wheel of Object.values(wheels ?? {})) {
    if (!wheel?.group) continue;
    wheel.group.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const names = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => m?.name ?? '');
      if (!names.some((n) => /tires|tyre/i.test(n))) return;

      // only the rubber itself: measure how far the mesh reaches from the axle,
      // a tyre shell sits at the outer radius, not near the hub
      o.geometry.computeBoundingSphere();
      const outer = o.geometry.boundingSphere?.radius ?? 0;
      if (outer < 0.2) {
        report.skipped += 1;
        return;
      }

      if (unwrapCylindrical(o.geometry)) {
        report.materials.add(names.join('+'));
        o.material = material;
        report.tyreMeshes += 1;
      }
    });
  }

  return { tyreMeshes: report.tyreMeshes, skipped: report.skipped, replacedMaterials: [...report.materials] };
}
