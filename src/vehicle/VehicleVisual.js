import { Box3, Box3Helper, BoxGeometry, Color, Group, MathUtils, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, Object3D, Vector3 } from 'three';
import { BMW_M5_F90_REFERENCE, MODEL_URL } from '../config.js';
import { WHEEL_EXTRACTION } from '../vehicleConfig.js';
import { loadVehicleModel } from '../model/loadVehicleModel.js';
import { analyzeHierarchy } from '../model/analyzeHierarchy.js';
import { computeModelStats } from '../model/modelStats.js';
import { detectParts } from '../model/detectParts.js';
import { extractWheels } from '../model/extractWheels.js';
import { measureForwardHint, normalizeModel } from '../model/normalizeModel.js';
import { createPlaceholderVehicle } from '../model/PlaceholderVehicle.js';
import { WheelVisualController, WHEEL_KEYS } from './WheelVisualController.js';
import { detailTyres } from './TyreDetailing.js';

/**
 * VehicleVisual — everything you can SEE. No colliders, no forces.
 *
 *   VehicleVisual (this.root)          ← driven by the physics chassis
 *   ├── ModelTransform                 scale + orientation normalisation
 *   │   └── <GLB scene>                body, interior, lights, dashboard…
 *   ├── FrontLeftSteeringPivot ─ FrontLeftWheelSpin ─ FrontLeftWheelVisual
 *   ├── FrontRightSteeringPivot ─ FrontRightWheelSpin ─ FrontRightWheelVisual
 *   ├── RearLeftWheelMount ─ RearLeftWheelSpin ─ RearLeftWheelVisual
 *   └── RearRightWheelMount ─ RearRightWheelSpin ─ RearRightWheelVisual
 *
 * The pivots move vertically with the physics suspension, yaw with steering,
 * and the spin node rolls the wheel. The GLB is never used as a collider.
 */
export class VehicleVisual {
  constructor() {
    this.root = new Group();
    this.root.name = 'VehicleVisual';

    this.modelTransform = new Group();
    this.modelTransform.name = 'ModelTransform';
    this.root.add(this.modelTransform);

    this.isPlaceholder = false;
    this.model = null;
    this.gltf = null;
    this.analysis = null;
    this.stats = null;
    this.parts = null;
    this.normalization = null;
    this.wheels = {};
    this.wheelController = null;
    this.measurements = null;
    this.warnings = [];
    this.boxHelper = null;
    this.extraction = null;
    this.credit = null;
  }

  async load({ url = MODEL_URL, renderer = null, onProgress = null } = {}) {
    const result = await loadVehicleModel(url, { renderer, onProgress });

    if (result.ok) {
      this.gltf = result.gltf;
      this.model = result.gltf.scene;
      // record the candidate that actually resolved, not the list we tried
      this.source = { kind: 'glb', url: result.url, loadMs: result.loadMs, attempts: result.attempts ?? [] };
      const extras = result.gltf.parser?.json?.asset?.extras;
      if (extras) this.credit = { title: extras.title, author: extras.author, license: extras.license, source: extras.source };
    } else {
      this.model = createPlaceholderVehicle();
      this.gltf = { animations: [] };
      this.isPlaceholder = true;
      this.source = { kind: 'placeholder', url: result.url, reason: result.reason, error: result.error, attempts: result.attempts ?? [] };
      this.warnings.push(
        `"${result.url}" could not be loaded (${result.reason}). A clearly-labelled PLACEHOLDER_ mesh is shown instead.`,
      );
    }

    this.modelTransform.add(this.model);
    this.#build();
    return this;
  }

  #build() {
    // 1. hierarchy exactly as authored
    this.rawAnalysis = analyzeHierarchy(this.model, this.gltf);

    // 2. orientation + scale, measured then applied
    this.forwardHint = measureForwardHint(this.model);
    this.normalization = normalizeModel(this.modelTransform, this.model, { forwardHint: this.forwardHint.sign });
    this.normalization.forwardHint = this.forwardHint;

    const box = new Box3().setFromObject(this.model, true);
    const size = box.getSize(new Vector3());
    this.measurements = {
      length: +size.z.toFixed(3),
      width: +size.x.toFixed(3),
      height: +size.y.toFixed(3),
      box,
    };

    // 3. wheels: this GLB has them merged into shared meshes, so they are split
    //    out at triangle level. Falls back to whole-node wheels for models that
    //    do have four separate wheel nodes.
    let extractedWheels = null;
    if (WHEEL_EXTRACTION.enabled) {
      const t0 = performance.now();
      const { wheels, report } = extractWheels(this.model, this.root);
      this.extraction = { ...report, ms: Math.round(performance.now() - t0) };
      extractedWheels = wheels;
      if (!wheels) this.warnings.push(`wheel extraction failed: ${report.warnings.join('; ')}`);
      // the file has no textures at all, so the tyres get a generated tread
      if (wheels) this.tyreDetail = detailTyres(wheels);
    }

    // 4. parts, by node name -> material name -> geometry, never invented
    this.parts = detectParts(this.root, { vehicleSize: size, extractedWheels });

    // 5. pivots (this is what parents the extracted wheel groups into the root)
    this.#buildWheelPivots(extractedWheels);

    // 6. hierarchy + stats over the whole vehicle root, so the triangles that
    //    moved into the wheel groups are still counted
    this.analysis = analyzeHierarchy(this.root, this.gltf);
    this.stats = computeModelStats(this.analysis);

    // 7. controller
    this.wheelController = new WheelVisualController(this.wheels, {
      wheelbase: this.wheelbase ?? BMW_M5_F90_REFERENCE.wheelbase,
      trackFront: this.trackFront ?? BMW_M5_F90_REFERENCE.trackFront,
      maxSteerDeg: 34,
    });

    this.#upgradeMaterials();
    this.#setupSteeringWheel();
    this.#applyRenderSettings();

    if (this.gltf.animations?.length) {
      this.warnings.push(`Model ships ${this.gltf.animations.length} animation clip(s); wheel geometry was re-parented, so clips targeting it may break.`);
    }
  }

  #buildWheelPivots(extractedWheels) {
    const PIVOT_NAMES = {
      frontLeft: ['FrontLeftSteeringPivot', 'FrontLeftWheelSpin'],
      frontRight: ['FrontRightSteeringPivot', 'FrontRightWheelSpin'],
      rearLeft: ['RearLeftWheelMount', 'RearLeftWheelSpin'],
      rearRight: ['RearRightWheelMount', 'RearRightWheelSpin'],
    };

    const centers = {};

    for (const key of WHEEL_KEYS) {
      const [pivotName, spinName] = PIVOT_NAMES[key];
      const extracted = extractedWheels?.[key];
      const part = this.parts.wheels[key];

      let visual = null;
      let center = null;
      let radius = null;
      let width = null;
      let triangles = 0;
      let method = 'none';

      if (extracted) {
        visual = extracted.group;
        center = extracted.center.clone();
        radius = extracted.radius;
        width = extracted.width;
        triangles = extracted.triangles;
        method = 'geometry';
      } else if (part.found && part.nodes[0]) {
        const node = part.nodes[0];
        if (node.isSkinnedMesh) {
          this.warnings.push(`${key}: "${node.name}" is skinned — left in place, no pivot created.`);
          this.wheels[key] = null;
          continue;
        }
        const wheelBox = new Box3().setFromObject(node, true);
        const wheelSize = wheelBox.getSize(new Vector3());
        center = wheelBox.getCenter(new Vector3());
        radius = Math.max(wheelSize.y, wheelSize.z) / 2;
        width = wheelSize.x;
        triangles = part.triangles;
        method = part.method;
        visual = node;
      } else {
        this.wheels[key] = null;
        continue;
      }

      const pivot = new Object3D();
      pivot.name = pivotName;
      pivot.position.copy(center);
      this.root.add(pivot);

      const spin = new Object3D();
      spin.name = spinName;
      pivot.add(spin);

      if (extracted) spin.add(visual); // parts are already re-origined on the centre
      else spin.attach(visual);

      this.wheels[key] = {
        key,
        pivot,
        spin,
        node: visual,
        name: visual.name || '(unnamed)',
        radius: +radius.toFixed(4),
        width: +width.toFixed(4),
        restY: +center.y.toFixed(4),
        center: center.clone(),
        triangles,
        method,
      };
      centers[key] = center;
    }

    const fl = centers.frontLeft;
    const fr = centers.frontRight;
    const rl = centers.rearLeft;
    const rr = centers.rearRight;
    const frontZ = fl && fr ? (fl.z + fr.z) / 2 : (fl?.z ?? fr?.z ?? null);
    const rearZ = rl && rr ? (rl.z + rr.z) / 2 : (rl?.z ?? rr?.z ?? null);

    this.wheelbase = frontZ !== null && rearZ !== null ? +Math.abs(rearZ - frontZ).toFixed(3) : null;
    this.trackFront = fl && fr ? +Math.abs(fr.x - fl.x).toFixed(3) : null;
    this.trackRear = rl && rr ? +Math.abs(rr.x - rl.x).toFixed(3) : null;
    this.wheelRadius = this.wheels.frontLeft?.radius ?? this.wheels.rearLeft?.radius ?? BMW_M5_F90_REFERENCE.wheelDiameterFront / 2;
  }

  /**
   * Culling and shadow flags. Only the outer shell casts a shadow — the
   * interior is inside a closed body, so shadow-casting it costs a lot of
   * fill rate for nothing.
   */
  #applyRenderSettings() {
    const interiorNodes = new Set();
    for (const res of [this.parts?.interior, this.parts?.steeringWheel, this.parts?.dashboard]) {
      if (!res?.found) continue;
      for (const n of res.nodes) n.traverse((o) => interiorNodes.add(o));
    }

    let casters = 0;
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = true;
      o.receiveShadow = false;
      o.castShadow = !interiorNodes.has(o);
      if (o.castShadow) casters += 1;
    });
    this.shadowCasters = casters;
    this.interiorMeshCount = interiorNodes.size;
  }

  /**
   * Shadow strategy. Casting from all 127 exterior meshes means pushing ~250k
   * triangles through the shadow pass every frame, which is the single most
   * expensive thing this scene does on a phone. So:
   *
   *   'proxy' — an invisible box the size of the car casts instead (12 tris).
   *             With the contact shadow underneath it reads correctly at
   *             normal camera distances. Default on low/medium.
   *   'real'  — only the big exterior panels and the wheels cast, which keeps a
   *             true silhouette for a fraction of the meshes. Used on high.
   *   'off'   — nothing casts.
   *
   * @param {'proxy'|'real'|'off'} mode
   */
  setShadowMode(mode) {
    this.shadowMode = mode;
    if (!this.shadowProxy) this.#createShadowProxy();

    const real = mode === 'real';
    const interior = this.#interiorSet();
    let casters = 0;
    this.root.traverse((o) => {
      if (!o.isMesh || o === this.shadowProxy) return;
      const bigEnough = (o.geometry?.index?.count ?? o.geometry?.attributes?.position?.count ?? 0) / 3 >= 1200;
      const cast = real && bigEnough && !interior.has(o);
      o.castShadow = cast;
      if (cast) casters += 1;
    });
    this.shadowProxy.castShadow = mode === 'proxy';
    this.shadowProxy.visible = mode === 'proxy';
    this.shadowCasters = mode === 'proxy' ? 1 : casters;
    return this.shadowCasters;
  }

  /** Runtime shadow toggle from the settings panel. */
  setShadows(enabled, quality = 'medium') {
    this.setShadowMode(!enabled ? 'off' : quality === 'high' ? 'real' : 'proxy');
  }

  #createShadowProxy() {
    const m = this.measurements;
    const geo = new BoxGeometry(m.width * 0.86, m.height * 0.8, m.length * 0.95);
    const mat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const proxy = new Mesh(geo, mat);
    proxy.name = 'ShadowProxy';
    proxy.position.y = m.height * 0.45;
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.frustumCulled = false;
    this.root.add(proxy);
    this.shadowProxy = proxy;
  }

  #interiorSet() {
    const set = new Set();
    for (const res of [this.parts?.interior, this.parts?.steeringWheel, this.parts?.dashboard]) {
      if (!res?.found) continue;
      for (const n of res.nodes) n.traverse((o) => set.add(o));
    }
    return set;
  }

  /**
   * Material pass. The export is 89 plain MeshStandardMaterials with no
   * textures, so the car reads flat. Only the materials whose NAMES survived
   * the merge are touched, and each change is recorded in
   * `this.materialUpgrades` so nothing is silently restyled.
   */
  #upgradeMaterials() {
    const seen = new Map();
    const upgrades = [];

    const forEachMaterial = (fn) => {
      this.root.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach((m, i) => fn(m, o, list, i));
      });
    };

    forEachMaterial((m, mesh, list, index) => {
      if (!m || seen.has(m.uuid)) return;
      seen.set(m.uuid, true);
      const name = m.name || '';
      m.envMapIntensity = 1.0;

      // --- car paint: clearcoat is what makes a body panel look painted
      if (/^(bodyshell|doorcolor|bonnet\d*|boot\d*|chassis00[1289]|doordsidef|doorpsidef)/i.test(name)) {
        const physical = new MeshPhysicalMaterial({
          name: `${name}+clearcoat`,
          color: m.color?.clone() ?? new Color(0xffffff),
          metalness: 0.28,
          roughness: 0.26,
          clearcoat: 1.0,
          clearcoatRoughness: 0.045,
          envMapIntensity: 1.15,
          side: m.side,
        });
        list[index] = physical;
        if (Array.isArray(mesh.material)) mesh.material[index] = physical;
        else mesh.material = physical;
        upgrades.push({ material: name, change: 'paint: clearcoat + lower roughness' });
        return;
      }

      if (/glass|window/i.test(name)) {
        m.transparent = true;
        m.opacity = Math.min(m.opacity ?? 1, 0.42);
        m.roughness = 0.05;
        m.metalness = 0.0;
        m.envMapIntensity = 2.0;
        m.depthWrite = false;
        upgrades.push({ material: name, change: 'glass: transparent + sharp reflections' });
        return;
      }
      if (/tires|tyre/i.test(name)) {
        m.roughness = 0.95;
        m.metalness = 0.0;
        m.color?.multiplyScalar(0.85);
        m.envMapIntensity = 0.35;
        upgrades.push({ material: name, change: 'rubber: matte' });
        return;
      }
      if (/chrome|mesheswhite|hub/i.test(name)) {
        m.metalness = 0.95;
        m.roughness = 0.14;
        m.envMapIntensity = 1.4;
        upgrades.push({ material: name, change: 'chrome/rim: polished metal' });
        return;
      }
      if (/rotor/i.test(name)) {
        m.metalness = 0.85;
        m.roughness = 0.38;
        m.envMapIntensity = 1.1;
        upgrades.push({ material: name, change: 'brake disc: brushed metal' });
        return;
      }
      if (/crimson|caliper/i.test(name)) {
        m.metalness = 0.25;
        m.roughness = 0.35;
        m.envMapIntensity = 0.9;
        upgrades.push({ material: name, change: 'brake caliper: semi-gloss' });
        return;
      }
      if (/interior|seats|dash|steeringwheel|seatbelt|misca|miscb|miscdoor/i.test(name)) {
        m.roughness = Math.max(m.roughness ?? 0.5, 0.68);
        m.metalness = Math.min(m.metalness ?? 0, 0.1);
        m.envMapIntensity = 0.45;
        // the merge left most cabin materials near-white, which reads as bare
        // plastic; darken only those, leaving deliberately coloured trim alone
        let note = 'interior: matte';
        if (m.color) {
          const lum = 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;
          if (lum > 0.42) {
            m.color.multiplyScalar(0.22);
            m.envMapIntensity = 0.3;
            note = 'interior: matte + darkened (was near-white)';
          }
        }
        upgrades.push({ material: name, change: note });
        return;
      }
      if (/black|misc|part\d/i.test(name)) {
        m.roughness = Math.max(m.roughness ?? 0.5, 0.55);
        m.envMapIntensity = 0.7;
      }
    });

    this.materialUpgrades = upgrades;
  }

  /**
   * Puts the GLB's real steering wheel (the nodes carrying the
   * `Steeringwheel*` materials) on its own pivot so it can be turned.
   *
   * The rotation axis is the steering column, which is tilted back. That tilt
   * is measured from the wheel's own bounding box — a disc of diameter d tilted
   * by angle a is `d·sin(a)` deep — rather than assumed.
   */
  #setupSteeringWheel() {
    const part = this.parts?.steeringWheel;
    if (!part?.found) {
      this.steeringWheel = null;
      return;
    }
    const nodes = part.nodes.filter((n) => !n.isSkinnedMesh);
    if (!nodes.length) {
      this.steeringWheel = null;
      return;
    }

    const box = new Box3();
    for (const n of nodes) box.union(new Box3().setFromObject(n, true));
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());

    const rimThickness = 0.055;
    const tilt = MathUtils.clamp(
      Math.asin(MathUtils.clamp((size.z - rimThickness) / Math.max(size.x, 0.05), 0.05, 0.75)),
      MathUtils.degToRad(8),
      MathUtils.degToRad(35),
    );

    const pivot = new Object3D();
    pivot.name = 'SteeringWheelPivot';
    pivot.position.copy(this.root.worldToLocal(center.clone()));
    pivot.rotation.x = -tilt; // local +Z now points back and up, along the column
    this.root.add(pivot);
    for (const n of nodes) pivot.attach(n);

    this.steeringWheel = {
      pivot,
      nodes,
      tiltDeg: +MathUtils.radToDeg(tilt).toFixed(1),
      diameter: +size.x.toFixed(3),
      centre: center.toArray().map((v) => +v.toFixed(3)),
      angle: 0,
    };
  }

  /**
   * @param {number} roadWheelAngleRad steering angle at the road wheels
   * @param {number} ratio steering ratio (M5 F90 ≈ 14.6:1)
   * @param {number} maxTurns lock-to-lock limit, in turns each way
   */
  setSteeringWheelAngle(roadWheelAngleRad, ratio = 14.6, maxTurns = 1.25) {
    const sw = this.steeringWheel;
    if (!sw) return 0;
    const limit = maxTurns * Math.PI * 2;
    sw.angle = MathUtils.clamp(roadWheelAngleRad * ratio, -limit, limit);
    // positive steering is a left turn: seen from the driver's seat (down the
    // +Z end of the column) that is counter-clockwise, i.e. a positive spin.
    sw.pivot.rotation.z = sw.angle;
    return sw.angle;
  }

  get wheelCount() {
    return WHEEL_KEYS.filter((k) => this.wheels[k]).length;
  }

  get hasAllWheels() {
    return this.wheelCount === 4;
  }

  showBoundsHelper(scene, visible = true) {
    if (!this.boxHelper) {
      this.boxHelper = new Box3Helper(new Box3().setFromObject(this.model, true), 0x22d3ee);
      this.boxHelper.name = 'VehicleBoundsHelper';
      scene.add(this.boxHelper);
    }
    this.boxHelper.visible = visible;
  }

  /**
   * Suspension travel from the physics side: shifts the wheel pivot along the
   * chassis' -Y so the visual wheel stays on the ground.
   * @param {string} key wheel key
   * @param {number} offset metres below the rest position (positive = compressed less)
   */
  setWheelSuspensionOffset(key, offset) {
    const wheel = this.wheels[key];
    if (!wheel) return;
    wheel.pivot.position.y = wheel.restY + offset;
  }

  flip180() {
    this.modelTransform.rotation.y += Math.PI;
    this.modelTransform.updateMatrixWorld(true);
    this.normalization.flipped = !this.normalization.flipped;
  }

  update(dt, state = {}) {
    this.wheelController?.update(dt, state);
  }
}
