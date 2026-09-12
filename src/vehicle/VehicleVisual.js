import { Box3, Box3Helper, Group, Object3D, Vector3 } from 'three';
import { BMW_M5_F90_REFERENCE, MODEL_URL } from '../config.js';
import { QUALITY, WHEEL_EXTRACTION } from '../vehicleConfig.js';
import { loadVehicleModel } from '../model/loadVehicleModel.js';
import { analyzeHierarchy } from '../model/analyzeHierarchy.js';
import { computeModelStats } from '../model/modelStats.js';
import { detectParts } from '../model/detectParts.js';
import { extractWheels } from '../model/extractWheels.js';
import { measureForwardHint, normalizeModel } from '../model/normalizeModel.js';
import { createPlaceholderVehicle } from '../model/PlaceholderVehicle.js';
import { WheelVisualController, WHEEL_KEYS } from './WheelVisualController.js';

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
      this.source = { kind: 'glb', url, loadMs: result.loadMs, bytes: result.bytes ?? null };
      const extras = result.gltf.parser?.json?.asset?.extras;
      if (extras) this.credit = { title: extras.title, author: extras.author, license: extras.license, source: extras.source };
    } else {
      this.model = createPlaceholderVehicle();
      this.gltf = { animations: [] };
      this.isPlaceholder = true;
      this.source = { kind: 'placeholder', url, reason: result.reason, error: result.error };
      this.warnings.push(
        `"${url}" could not be loaded (${result.reason}). A clearly-labelled PLACEHOLDER_ mesh is shown instead.`,
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

  /** Shadows + culling: cheap settings that do not touch material quality. */
  #applyRenderSettings({ mobile = false } = {}) {
    let shadowCasters = 0;
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = true;
      o.receiveShadow = false; // self-shadowing on a 300k-tri car costs a lot
      // only the outer shell casts a shadow; interior meshes are invisible anyway
      const casts = !mobile || QUALITY.enableShadowsMobile;
      o.castShadow = casts;
      if (casts) shadowCasters += 1;
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          m.shadowSide = null;
          if (m.map) m.map.anisotropy = mobile ? 1 : 4;
        }
      }
    });
    this.shadowCasters = shadowCasters;
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
