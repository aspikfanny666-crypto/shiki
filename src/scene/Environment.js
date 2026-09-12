import {
  BoxGeometry,
  Color,
  CanvasTexture,
  CylinderGeometry,
  ConeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Quaternion,
  Vector3,
} from 'three';

/**
 * The driving environment: a large asphalt pad with painted markings, kerbs,
 * grass, barriers, walls, cones, a few buildings and a ramp.
 *
 * Draw-call budget matters more than polygon count here, so repeated objects
 * (kerb segments, cones, barriers, lamp posts) are InstancedMeshes and the road
 * markings are painted into one canvas texture instead of being geometry.
 * Collision shapes stay primitive: cuboids and one cylinder per cone.
 */

const ASPHALT = 240; // metres, square
const KERB_RED = new Color(0.62, 0.09, 0.09);
const KERB_WHITE = new Color(0.88, 0.88, 0.86);
const PAD = ASPHALT / 2;

function asphaltTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a3d42';
  ctx.fillRect(0, 0, size, size);
  // aggregate speckle
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 46;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // a few darker patches so the surface is not perfectly uniform
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(20,22,26,${0.04 + Math.random() * 0.07})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * size, Math.random() * size, 20 + Math.random() * 70, 14 + Math.random() * 50, Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(ASPHALT / 6, ASPHALT / 6);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Painted lines, arrows, a skid-pad circle and a start box, in one texture. */
function markingsTexture() {
  const size = 2048;
  const px = size / ASPHALT; // pixels per metre
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const X = (m) => size / 2 + m * px; // world x -> canvas x
  const Y = (m) => size / 2 + m * px; // world z -> canvas y (z grows "down" the texture)

  ctx.lineCap = 'butt';

  // --- main straight: dashed centre line down x = 0, plus solid edge lines
  ctx.strokeStyle = 'rgba(232,232,226,0.85)';
  ctx.lineWidth = 0.14 * px;
  ctx.setLineDash([3 * px, 5 * px]);
  ctx.beginPath();
  ctx.moveTo(X(0), Y(-PAD + 6));
  ctx.lineTo(X(0), Y(PAD - 6));
  ctx.stroke();
  ctx.setLineDash([]);

  for (const lane of [-7, 7]) {
    ctx.beginPath();
    ctx.moveTo(X(lane), Y(-PAD + 6));
    ctx.lineTo(X(lane), Y(PAD - 6));
    ctx.stroke();
  }

  // --- cross road
  ctx.setLineDash([3 * px, 5 * px]);
  ctx.beginPath();
  ctx.moveTo(X(-PAD + 6), Y(-40));
  ctx.lineTo(X(PAD - 6), Y(-40));
  ctx.stroke();
  ctx.setLineDash([]);

  // --- start / finish box
  ctx.strokeStyle = 'rgba(240,240,235,0.9)';
  ctx.lineWidth = 0.2 * px;
  ctx.strokeRect(X(-3.2), Y(-4), 6.4 * px, 8 * px);
  ctx.fillStyle = 'rgba(240,240,235,0.9)';
  ctx.font = `bold ${1.6 * px}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('START', X(0), Y(-5.4));

  // --- skid pad circle
  ctx.strokeStyle = 'rgba(235,196,86,0.85)';
  ctx.lineWidth = 0.16 * px;
  ctx.beginPath();
  ctx.arc(X(-55), Y(45), 28 * px, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(-55), Y(45), 20 * px, 0, Math.PI * 2);
  ctx.stroke();

  // --- braking-distance markers along the straight
  ctx.fillStyle = 'rgba(240,240,235,0.8)';
  ctx.font = `bold ${1.3 * px}px system-ui, sans-serif`;
  for (let m = 50; m <= 100; m += 50) {
    for (const side of [-1, 1]) {
      ctx.fillRect(X(side * 9), Y(-m), 1.6 * px, 0.35 * px);
      ctx.fillText(`${m}m`, X(side * 11.5), Y(-m) + 0.5 * px);
    }
  }

  // --- hatching near the barrier
  ctx.strokeStyle = 'rgba(233,233,228,0.55)';
  ctx.lineWidth = 0.12 * px;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    ctx.moveTo(X(-6 + i * 0.9), Y(-104));
    ctx.lineTo(X(-9 + i * 0.9), Y(-110));
    ctx.stroke();
  }

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class Environment {
  /**
   * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld
   * @param {THREE.Scene} scene
   */
  constructor(physicsWorld, scene, { quality = 'medium' } = {}) {
    this.physicsWorld = physicsWorld;
    this.scene = scene;
    this.root = new Group();
    this.root.name = 'Environment';
    scene.add(this.root);
    this.dynamic = []; // { body, mesh, instanceId, instanced }
    this.quality = quality;

    this.#buildGround();
    this.#buildKerbs();
    this.#buildBarriers();
    this.#buildBuildings();
    this.#buildCones();
    this.#buildRamps();
  }

  get asphaltSize() {
    return ASPHALT;
  }

  #add(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  #buildGround() {
    // grass, far beyond the asphalt, doubles as the visual horizon
    const grass = new Mesh(
      new PlaneGeometry(2000, 2000),
      new MeshStandardMaterial({ color: 0x3f4a33, roughness: 1, metalness: 0 }),
    );
    grass.name = 'Grass';
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.02;
    grass.receiveShadow = true;
    this.root.add(grass);

    const asphalt = new Mesh(
      new PlaneGeometry(ASPHALT, ASPHALT),
      new MeshStandardMaterial({ map: asphaltTexture(), color: 0xffffff, roughness: 0.94, metalness: 0.02 }),
    );
    asphalt.name = 'Asphalt';
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.receiveShadow = true;
    this.root.add(asphalt);

    const markings = new Mesh(
      new PlaneGeometry(ASPHALT, ASPHALT),
      new MeshStandardMaterial({ map: markingsTexture(), color: 0x9d9d97, transparent: true, opacity: 0.92, roughness: 1, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    markings.name = 'RoadMarkings';
    markings.rotation.x = -Math.PI / 2;
    markings.position.y = 0.005;
    markings.receiveShadow = false;
    this.root.add(markings);

    this.asphalt = asphalt;
    this.markings = markings;
    this.grass = grass;
  }

  /** Red/white kerbs down both sides of the main straight. */
  #buildKerbs() {
    const seg = 2;
    const length = 120;
    const count = Math.floor(length / seg) * 2;
    const geo = new BoxGeometry(0.55, 0.12, seg);
    const mat = new MeshStandardMaterial({ vertexColors: false, color: 0xffffff, roughness: 0.8 });
    const kerb = new InstancedMesh(geo, mat, count);
    kerb.name = 'Kerbs';
    kerb.castShadow = false;
    kerb.receiveShadow = true;

    const dummy = new Object3D();
    let i = 0;
    for (const side of [-1, 1]) {
      for (let s = 0; s < length / seg; s++) {
        const z = -length / 2 + s * seg + seg / 2;
        dummy.position.set(side * 10.5, 0.06, z);
        dummy.updateMatrix();
        kerb.setMatrixAt(i, dummy.matrix);
        kerb.setColorAt(i, (s + (side > 0 ? 1 : 0)) % 2 === 0 ? KERB_RED : KERB_WHITE);
        i += 1;
      }
    }
    kerb.instanceMatrix.needsUpdate = true;
    if (kerb.instanceColor) kerb.instanceColor.needsUpdate = true;
    this.root.add(kerb);

    // one long collider per side instead of 120 little ones
    for (const side of [-1, 1]) {
      this.physicsWorld.addStaticBox({ size: [0.55, 0.12, length], position: [side * 10.5, 0.06, 0], visible: false });
    }
  }

  #buildBarriers() {
    const mat = new MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.55, metalness: 0.25 });
    const postMat = new MeshStandardMaterial({ color: 0x5b636d, roughness: 0.7, metalness: 0.3 });

    // Armco-style barrier at the end of the straight and along one side
    const runs = [
      { size: [26, 0.75, 0.35], position: [0, 0.62, -112] },
      { size: [0.35, 0.75, 60], position: [-26, 0.62, -60] },
      { size: [0.35, 0.75, 60], position: [26, 0.62, -60] },
    ];
    for (const r of runs) {
      const mesh = this.#add(new Mesh(new BoxGeometry(...r.size), mat));
      mesh.position.set(...r.position);
      mesh.name = 'Barrier';
      this.physicsWorld.addStaticBox({ size: r.size, position: r.position, visible: false });
    }

    // concrete walls that make a small enclosure to crash-test against
    const wallMat = new MeshStandardMaterial({ color: 0x8d8f92, roughness: 0.95 });
    const walls = [
      { size: [34, 2.4, 0.8], position: [60, 1.2, -60] },
      { size: [0.8, 2.4, 34], position: [43, 1.2, -43] },
      { size: [0.8, 2.4, 34], position: [77, 1.2, -43] },
    ];
    for (const w of walls) {
      const mesh = this.#add(new Mesh(new BoxGeometry(...w.size), wallMat));
      mesh.position.set(...w.position);
      mesh.name = 'Wall';
      this.physicsWorld.addStaticBox({ size: w.size, position: w.position, visible: false });
    }

    // posts along the straight, instanced
    const postGeo = new CylinderGeometry(0.08, 0.08, 0.8, 6);
    const posts = new InstancedMesh(postGeo, postMat, 26);
    posts.name = 'BarrierPosts';
    posts.castShadow = true;
    const dummy = new Object3D();
    let i = 0;
    for (const side of [-1, 1]) {
      for (let s = 0; s < 13; s++) {
        dummy.position.set(side * 26, 0.4, -90 + s * 5);
        dummy.updateMatrix();
        posts.setMatrixAt(i++, dummy.matrix);
      }
    }
    posts.instanceMatrix.needsUpdate = true;
    this.root.add(posts);
  }

  #buildBuildings() {
    const mats = [
      new MeshStandardMaterial({ color: 0x5a6472, roughness: 0.9 }),
      new MeshStandardMaterial({ color: 0x6d6257, roughness: 0.92 }),
      new MeshStandardMaterial({ color: 0x4c5a5e, roughness: 0.88 }),
    ];
    const blocks = [
      { size: [22, 12, 18], position: [-70, 6, -70] },
      { size: [16, 8, 16], position: [-72, 4, -30] },
      { size: [28, 16, 20], position: [78, 8, 30] },
      { size: [18, 6, 26], position: [64, 3, 78] },
      { size: [12, 22, 12], position: [-95, 11, 40] },
    ];
    blocks.forEach((b, idx) => {
      const mesh = this.#add(new Mesh(new BoxGeometry(...b.size), mats[idx % mats.length]));
      mesh.position.set(...b.position);
      mesh.name = 'Building';
      this.physicsWorld.addStaticBox({ size: b.size, position: b.position, visible: false });
    });
  }

  /** Knock-over cones: one instanced mesh, one dynamic body each. */
  #buildCones() {
    const layout = [];
    for (let i = 0; i < 12; i++) layout.push([(i % 2 ? 1 : -1) * 2.6, -18 - i * 6]); // slalom
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      layout.push([-55 + Math.cos(a) * 24, 45 + Math.sin(a) * 24]); // skid pad
    }

    const geo = new ConeGeometry(0.22, 0.55, 10);
    geo.translate(0, 0.275, 0);
    const mat = new MeshStandardMaterial({ color: 0xf0641d, roughness: 0.7, emissive: 0x2a0a00, emissiveIntensity: 0.4 });
    const cones = new InstancedMesh(geo, mat, layout.length);
    cones.name = 'Cones';
    cones.castShadow = true;
    cones.receiveShadow = false;
    this.root.add(cones);
    this.cones = cones;

    const dummy = new Object3D();
    layout.forEach(([x, z], i) => {
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      cones.setMatrixAt(i, dummy.matrix);
      const body = this.physicsWorld.addDynamicBody({
        shape: 'cylinder', halfHeight: 0.275, radius: 0.22,
        position: [x, 0.275, z], mass: 4,
      });
      this.dynamic.push({ body, instanced: cones, instanceId: i, yOffset: -0.275 });
    });
    cones.instanceMatrix.needsUpdate = true;
  }

  #buildRamps() {
    const mat = new MeshStandardMaterial({ color: 0x4a5158, roughness: 0.85 });
    const ramps = [
      { size: [9, 0.6, 14], position: [30, 0.05, -30], tilt: -0.14 },
      { size: [9, 0.6, 14], position: [30, 0.05, -58], tilt: 0.14 },
      { size: [16, 1.4, 16], position: [-35, 0.2, -70], tilt: -0.06 },
    ];
    for (const r of ramps) {
      const mesh = this.#add(new Mesh(new BoxGeometry(...r.size), mat));
      mesh.position.set(...r.position);
      mesh.rotation.x = r.tilt;
      mesh.name = 'Ramp';
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), r.tilt);
      this.physicsWorld.addStaticBox({ size: r.size, position: r.position, quaternion: q, visible: false });
    }

    // speed bumps across the straight
    const bumpGeo = new CylinderGeometry(0.35, 0.35, 12, 10, 1, false, 0, Math.PI);
    const bumpMat = new MeshStandardMaterial({ color: 0xd8b13a, roughness: 0.8 });
    for (const z of [-70, -76]) {
      const bump = this.#add(new Mesh(bumpGeo, bumpMat));
      bump.rotation.z = Math.PI / 2;
      bump.position.set(0, 0, z);
      bump.scale.set(0.28, 1, 1);
      bump.name = 'SpeedBump';
      this.physicsWorld.addStaticBox({ size: [12, 0.16, 0.7], position: [0, 0.08, z], visible: false });
    }
  }

  /** Dynamic props follow their bodies (instanced ones write their matrix). */
  update() {
    const m = new Matrix4();
    const q = new Quaternion();
    const v = new Vector3();
    let dirty = false;
    for (const item of this.dynamic) {
      const t = item.body.translation();
      const r = item.body.rotation();
      q.set(r.x, r.y, r.z, r.w);
      v.set(0, item.yOffset ?? 0, 0).applyQuaternion(q);
      m.compose(new Vector3(t.x + v.x, t.y + v.y, t.z + v.z), q, new Vector3(1, 1, 1));
      item.instanced.setMatrixAt(item.instanceId, m);
      dirty = true;
    }
    if (dirty && this.cones) this.cones.instanceMatrix.needsUpdate = true;
  }

  setQuality(quality) {
    this.quality = quality;
    const aniso = quality === 'low' ? 1 : quality === 'medium' ? 4 : 8;
    if (this.asphalt.material.map) this.asphalt.material.map.anisotropy = aniso;
    if (this.markings.material.map) this.markings.material.map.anisotropy = aniso;
  }

  setShadows(enabled) {
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name === 'Grass' || o.name === 'Asphalt') o.receiveShadow = enabled;
      else o.castShadow = enabled && o.name !== 'RoadMarkings';
    });
  }
}
