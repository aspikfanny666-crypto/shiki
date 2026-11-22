/**
 * A city to drive through, instead of plain boxes on grass.
 *
 * Three things make a block of flats read as a building rather than a crate:
 * windows, a roof that is not a flat lid, and a street that meets it at a
 * kerb. All three are here, and all three are built so the whole city costs
 * about a dozen draw calls:
 *
 *  - Facades are a painted canvas (window bays, glass, floor slabs, lit rooms)
 *    used as the colour map, with a second canvas holding only the lit windows
 *    as the emissive map — so a window glows without the concrete glowing.
 *  - Buildings come in a handful of size classes; each class is one
 *    InstancedMesh, so fifty towers are a few draw calls, and per-instance
 *    colour gives each one its own shade of concrete, brick or glass.
 *  - Streets are painted into one tiling ground texture whose tile is exactly
 *    one city block, so the road grid lines up with the buildings for free.
 *
 * The layout is deterministic (a seeded PRNG), so the city is the same every
 * time the page loads and the collision boxes always match what is drawn.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';

/** Block pitch in metres: one road-to-road step of the grid. */
export const BLOCK = 64;
/** Carriageway width, kerb to kerb. */
const ROAD = 15;
/** Pavement width on each side of the carriageway. */
const PAVEMENT = 3.2;
/** Half-width of the open driving pad the city is built around. */
const CLEAR = 150;
/** How far the city reaches from the origin. */
const REACH = 520;

/** Deterministic PRNG — same city on every load, in every browser. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * One facade: `map` paints concrete, slabs and glass, `emissive` paints only
 * the windows that are lit. `bays` × `floors` is how many windows fit in the
 * texture, which is what the geometry's UVs are scaled against.
 */
function facadeTextures(random, { bays = 6, floors = 10, tint = '#6c7380', glass = '#121a24', litShare = 0.22 } = {}) {
  const W = 64 * bays;
  const H = 48 * floors;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return [c, c.getContext('2d')];
  };
  const [colourCanvas, g] = make();
  const [glowCanvas, e] = make();

  g.fillStyle = tint;
  g.fillRect(0, 0, W, H);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);

  // subtle vertical grime so flat concrete is not flat
  for (let i = 0; i < 160; i++) {
    const x = random() * W;
    g.fillStyle = `rgba(0,0,0,${0.015 + random() * 0.03})`;
    g.fillRect(x, 0, 1 + random() * 3, H);
  }

  const bayW = W / bays;
  const floorH = H / floors;
  const winW = bayW * 0.62;
  const winH = floorH * 0.56;

  for (let f = 0; f < floors; f++) {
    const y = f * floorH;
    // floor slab: a lighter band between storeys
    g.fillStyle = 'rgba(255,255,255,0.055)';
    g.fillRect(0, y + floorH - 3, W, 3);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, y + floorH - 1, W, 1);

    for (let b = 0; b < bays; b++) {
      const x = b * bayW + (bayW - winW) / 2;
      const wy = y + (floorH - winH) / 2;

      // recessed reveal, so the glass sits inside the wall
      g.fillStyle = 'rgba(0,0,0,0.33)';
      g.fillRect(x - 2, wy - 2, winW + 4, winH + 4);

      const lit = random() < litShare;
      if (lit) {
        const warm = 200 + Math.floor(random() * 55);
        const fill = `rgb(${warm}, ${Math.floor(warm * 0.82)}, ${Math.floor(warm * 0.55)})`;
        g.fillStyle = fill;
        g.fillRect(x, wy, winW, winH);
        e.fillStyle = fill;
        e.fillRect(x, wy, winW, winH);
        // a blind half-drawn in some of the lit rooms
        if (random() < 0.45) {
          const h = winH * (0.2 + random() * 0.4);
          g.fillStyle = 'rgba(0,0,0,0.55)';
          g.fillRect(x, wy, winW, h);
          e.fillStyle = 'rgba(0,0,0,1)';
          e.fillRect(x, wy, winW, h);
        }
      } else {
        // dark glass with a sky reflection running down it
        const grad = g.createLinearGradient(x, wy, x, wy + winH);
        grad.addColorStop(0, '#2c3b4d');
        grad.addColorStop(0.45, glass);
        grad.addColorStop(1, '#0c1119');
        g.fillStyle = grad;
        g.fillRect(x, wy, winW, winH);
      }

      // mullion
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(x + winW / 2 - 1, wy, 2, winH);
    }
  }

  const map = new CanvasTexture(colourCanvas);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.anisotropy = 4;

  const emissiveMap = new CanvasTexture(glowCanvas);
  emissiveMap.colorSpace = SRGBColorSpace;
  emissiveMap.wrapS = emissiveMap.wrapT = RepeatWrapping;

  return { map, emissiveMap, bays, floors };
}

/**
 * The ground outside the driving pad: one tile is one city block, so the
 * carriageway, the kerb and the pavement always line up with the buildings.
 */
function streetTexture() {
  const px = 512; // one BLOCK
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  const m = px / BLOCK; // pixels per metre

  // plot interior: the yards and car parks between buildings
  ctx.fillStyle = '#595c56';
  ctx.fillRect(0, 0, px, px);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.07})`;
    ctx.fillRect(Math.random() * px, Math.random() * px, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
  // parking bays along the inside of the block, so the yards are not blank
  ctx.strokeStyle = 'rgba(225,225,215,0.3)';
  ctx.lineWidth = Math.max(1, 0.1 * m);
  for (let i = 0; i < 9; i++) {
    const x = px * 0.22 + i * 2.4 * m;
    ctx.beginPath();
    ctx.moveTo(x, px * 0.24);
    ctx.lineTo(x, px * 0.24 + 5 * m);
    ctx.stroke();
  }

  // the road runs along two edges of the tile, so a 2x2 of tiles makes a grid
  const half = (ROAD / 2) * m;
  const pave = PAVEMENT * m;

  const band = (x, y, w, h, fill) => { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); };
  // pavement first, then the carriageway on top of it
  band(0, 0, px, half + pave, '#8b8d88');
  band(0, px - half - pave, px, half + pave, '#8b8d88');
  band(0, 0, half + pave, px, '#8b8d88');
  band(px - half - pave, 0, half + pave, px, '#8b8d88');

  band(0, 0, px, half, '#3c3f44');
  band(0, px - half, px, half, '#3c3f44');
  band(0, 0, half, px, '#3c3f44');
  band(px - half, 0, half, px, '#3c3f44');

  // asphalt grain
  for (let i = 0; i < 2200; i++) {
    const x = Math.random() * px;
    const y = Math.random() * px;
    const onRoad = x < half || x > px - half || y < half || y > px - half;
    if (!onRoad) continue;
    ctx.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.045})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  // kerb line
  ctx.strokeStyle = 'rgba(230,230,225,0.55)';
  ctx.lineWidth = Math.max(1, 0.12 * m);
  for (const v of [half, px - half]) {
    ctx.beginPath(); ctx.moveTo(0, v); ctx.lineTo(px, v); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, px); ctx.stroke();
  }

  // centre line, dashed, straddling the tile edge (so it lands mid-carriageway)
  ctx.strokeStyle = 'rgba(235,228,190,0.75)';
  ctx.lineWidth = Math.max(1, 0.14 * m);
  ctx.setLineDash([2.4 * m, 2.6 * m]);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(px, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, px); ctx.lineTo(px, px); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, px); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, px); ctx.stroke();
  ctx.setLineDash([]);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  const span = REACH * 2;
  tex.repeat.set(span / BLOCK, span / BLOCK);
  // tile boundaries land on block boundaries: offset by half a tile so the
  // junction, not the plot, sits over the world origin's grid lines
  tex.offset.set(0.5, 0.5);
  return tex;
}

/** The size classes the city is assembled from. */
const TYPES = [
  { name: 'LowBlock', w: 24, d: 20, h: 13, bays: 6, floors: 4, tint: '#7c7468', litShare: 0.26, max: 64 },
  { name: 'MidBlock', w: 22, d: 22, h: 24, bays: 6, floors: 7, tint: '#6b7280', litShare: 0.22, max: 56 },
  { name: 'Slab', w: 34, d: 16, h: 31, bays: 9, floors: 9, tint: '#8a8276', litShare: 0.3, max: 40 },
  { name: 'Tower', w: 18, d: 18, h: 52, bays: 5, floors: 15, tint: '#59616d', litShare: 0.18, max: 32 },
  { name: 'GlassTower', w: 20, d: 20, h: 72, bays: 6, floors: 21, tint: '#3f4a58', glass: '#0d1620', litShare: 0.12, max: 20 },
];

export class City {
  /**
   * @param {THREE.Scene|THREE.Group} parent
   * @param {object} opts
   * @param {(box: {size:number[], position:number[]}) => void} opts.addCollider
   *   Called once per building with a primitive box — the city never hands a
   *   mesh to the physics engine.
   */
  constructor(parent, { addCollider = () => {}, quality = 'medium', seed = 20251103 } = {}) {
    this.root = new Group();
    this.root.name = 'City';
    parent.add(this.root);
    this.quality = quality;
    this.random = rng(seed);
    this.nightLevel = 0;

    const density = quality === 'low' ? 0.55 : quality === 'medium' ? 0.8 : 1;
    this.plots = this.#layout(density);
    this.#buildGround();
    this.#buildBuildings(addCollider);
    if (quality !== 'low') this.#buildStreetLights();
  }

  /** Which plots exist, and what stands on each. Deterministic. */
  #layout(density) {
    const random = this.random;
    const plots = [];
    const steps = Math.floor(REACH / BLOCK);
    for (let gx = -steps; gx <= steps; gx++) {
      for (let gz = -steps; gz <= steps; gz++) {
        const cx = gx * BLOCK;
        const cz = gz * BLOCK;
        // leave the driving pad, and its immediate surroundings, empty
        if (Math.abs(cx) < CLEAR && Math.abs(cz) < CLEAR) continue;
        if (Math.hypot(cx, cz) > REACH) continue;
        if (random() > density) continue;

        // buildings get taller towards the middle of town, which here is the
        // far corner rather than the pad the car starts on
        const toCentre = Math.hypot(cx - 260, cz - 240) / 520;
        const bias = Math.max(0, 1 - toCentre);
        const pick = random() * 0.55 + bias * 0.65;
        const typeIndex = Math.min(TYPES.length - 1, Math.floor(pick * TYPES.length));
        const rot = Math.round(random() * 3) * (Math.PI / 2);
        // jitter inside the plot, but never out into the carriageway
        const free = (BLOCK - ROAD - PAVEMENT * 2) / 2;
        const type = TYPES[typeIndex];
        const halfW = (rot % Math.PI === 0 ? type.w : type.d) / 2;
        const halfD = (rot % Math.PI === 0 ? type.d : type.w) / 2;
        const jx = (random() - 0.5) * Math.max(0, free - halfW) * 1.2;
        const jz = (random() - 0.5) * Math.max(0, free - halfD) * 1.2;
        plots.push({
          typeIndex,
          x: cx + jx,
          z: cz + jz,
          rot,
          // ±25 % on the height, rounded to whole storeys so the windows stay square
          scaleY: 1 + Math.round((random() - 0.5) * 0.5 * type.floors) / type.floors,
          shade: 0.82 + random() * 0.33,
        });
      }
    }
    return plots;
  }

  #buildGround() {
    const span = REACH * 2;
    const ground = new Mesh(
      new PlaneGeometry(span, span),
      new MeshStandardMaterial({ map: streetTexture(), roughness: 0.96, metalness: 0.02 }),
    );
    ground.name = 'CityGround';
    ground.rotation.x = -Math.PI / 2;
    // just under the circuit's own asphalt, which stays on top in the middle
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    this.root.add(ground);
    this.ground = ground;
  }

  #buildBuildings(addCollider) {
    const dummy = new Object3D();
    const colour = new Color();
    this.buildings = [];

    TYPES.forEach((type, index) => {
      const mine = this.plots.filter((p) => p.typeIndex === index).slice(0, type.max);
      if (!mine.length) return;

      const { map, emissiveMap } = facadeTextures(this.random, type);
      // One texture repeat per storey and per window bay, so a 24 m wide block
      // gets six windows across whatever its neighbours do.
      map.repeat.set(1, 1);
      emissiveMap.repeat.set(1, 1);

      const geo = new BoxGeometry(type.w, type.h, type.d);
      // The box's side faces are narrower than its front; squeeze their UVs so
      // the windows stay the same size all the way round.
      const uv = geo.attributes.uv;
      const ratio = type.d / type.w;
      for (let f = 0; f < 2; f++) {
        for (let i = f * 4; i < f * 4 + 4; i++) uv.setX(i, uv.getX(i) * ratio);
      }
      uv.needsUpdate = true;

      const mat = new MeshStandardMaterial({
        map,
        emissiveMap,
        emissive: 0xffffff,
        emissiveIntensity: 0.45,
        roughness: 0.82,
        metalness: 0.05,
      });

      const mesh = new InstancedMesh(geo, mat, mine.length);
      mesh.name = `City_${type.name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      mine.forEach((plot, i) => {
        dummy.position.set(plot.x, (type.h * plot.scaleY) / 2, plot.z);
        dummy.rotation.set(0, plot.rot, 0);
        dummy.scale.set(1, plot.scaleY, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, colour.setScalar(plot.shade));

        const swapped = plot.rot % Math.PI !== 0;
        const size = [swapped ? type.d : type.w, type.h * plot.scaleY, swapped ? type.w : type.d];
        addCollider({ size, position: [plot.x, size[1] / 2, plot.z] });
        this.buildings.push({ x: plot.x, z: plot.z, size });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.root.add(mesh);
      this.#buildRoof(type, mine, dummy);
    });
  }

  /**
   * A parapet and a plant room on the roof. Without them every building ends in
   * a perfectly sharp lid, which is the main thing that makes box cities look
   * like boxes.
   */
  #buildRoof(type, plots, dummy) {
    const parapetGeo = new BoxGeometry(type.w + 0.5, 1.1, type.d + 0.5);
    const parapetMat = new MeshStandardMaterial({ color: 0x5f6570, roughness: 0.95 });
    const parapet = new InstancedMesh(parapetGeo, parapetMat, plots.length);
    parapet.name = `CityRoof_${type.name}`;
    parapet.castShadow = true;
    parapet.receiveShadow = true;

    const plantGeo = new BoxGeometry(type.w * 0.3, 2.4, type.d * 0.3);
    const plantMat = new MeshStandardMaterial({ color: 0x4b515b, roughness: 0.9 });
    const plant = new InstancedMesh(plantGeo, plantMat, plots.length);
    plant.name = `CityPlant_${type.name}`;
    plant.castShadow = true;

    plots.forEach((plot, i) => {
      const top = type.h * plot.scaleY;
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, plot.rot, 0);

      dummy.position.set(plot.x, top + 0.2, plot.z);
      dummy.updateMatrix();
      parapet.setMatrixAt(i, dummy.matrix);

      dummy.position.set(plot.x, top + 1.2, plot.z);
      dummy.updateMatrix();
      plant.setMatrixAt(i, dummy.matrix);
    });
    parapet.instanceMatrix.needsUpdate = true;
    plant.instanceMatrix.needsUpdate = true;
    this.root.add(parapet, plant);
  }

  /** Lamp posts along the kerbs, one instanced post and one instanced head. */
  #buildStreetLights() {
    const spots = [];
    const edge = (BLOCK - ROAD) / 2 - 0.8;
    const steps = Math.floor(REACH / BLOCK);
    for (let gx = -steps; gx <= steps; gx++) {
      for (let gz = -steps; gz <= steps; gz++) {
        const cx = gx * BLOCK;
        const cz = gz * BLOCK;
        if (Math.abs(cx) < CLEAR && Math.abs(cz) < CLEAR) continue;
        if (Math.hypot(cx, cz) > REACH) continue;
        spots.push([cx - edge, cz - BLOCK / 2 + ROAD / 2 + 1.2]);
        spots.push([cx + edge, cz + BLOCK / 2 - ROAD / 2 - 1.2]);
      }
    }
    if (!spots.length) return;

    const dummy = new Object3D();
    const postMat = new MeshStandardMaterial({ color: 0x2d333c, roughness: 0.7, metalness: 0.5 });
    const posts = new InstancedMesh(new CylinderGeometry(0.1, 0.14, 8, 6), postMat, spots.length);
    posts.name = 'CityLampPosts';
    posts.castShadow = true;

    const headMat = new MeshStandardMaterial({
      color: 0x3a4049, emissive: 0xffd9a0, emissiveIntensity: 0.9, roughness: 0.5,
    });
    const heads = new InstancedMesh(new BoxGeometry(1.5, 0.22, 0.5), headMat, spots.length);
    heads.name = 'CityLampHeads';

    spots.forEach(([x, z], i) => {
      dummy.position.set(x, 4, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x + Math.sign(x || 1) * -0.6, 8, z);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
    });
    posts.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    this.root.add(posts, heads);
    this.lampHeads = heads;
  }

  setQuality(quality) {
    const aniso = quality === 'low' ? 1 : quality === 'medium' ? 4 : 8;
    if (this.ground?.material.map) this.ground.material.map.anisotropy = aniso;
  }

  setShadows(enabled) {
    this.root.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (o.name === 'CityGround') o.receiveShadow = enabled;
      else if (!o.name.startsWith('CityLamp')) o.castShadow = enabled;
    });
  }

  /** Brighten the windows and lamps when the car's own lights come on. */
  setNightLevel(level) {
    const k = Math.max(0, Math.min(1, level));
    // called every frame; only touch materials when the value actually moves
    if (k === this.nightLevel) return;
    this.nightLevel = k;
    this.root.traverse((o) => {
      if (o.isInstancedMesh && o.name.startsWith('City_')) o.material.emissiveIntensity = 0.45 + k * 1.1;
    });
    if (this.lampHeads) this.lampHeads.material.emissiveIntensity = 0.9 + k * 1.6;
  }
}
