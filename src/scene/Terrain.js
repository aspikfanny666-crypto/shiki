/**
 * What the ground is made of, as far as the tyres are concerned.
 *
 * Recovery Mode only means something if there is somewhere to get stuck. This
 * is the smallest honest model of that: a list of circular patches, each with
 * a surface type, and one lookup that the physics calls per wheel per step.
 *
 * Everything outside a patch is asphalt, which is what the rest of the pad and
 * the city streets are.
 *
 * `grip` multiplies the tyre's friction coefficient and `rolling` is the extra
 * rolling-resistance coefficient, which is what actually stops a heavy car in
 * deep sand: 0.30 against a 2.8 t kerb weight is about 8 kN of drag, the same
 * order as the drive force, so the car bogs rather than blasting through.
 *
 * `sinkRate` is how fast a spinning wheel digs itself in, per second, and
 * `compaction` is how fast a load peak packs that hole back down — those two
 * are what the GLS's free-driving assist plays against.
 */

export const SURFACES = Object.freeze({
  asphalt: Object.freeze({ id: 'asphalt', label: 'asphalt', loose: false, grip: 1.0, sinkRate: 0, compaction: 0, rolling: 0 }),
  /** Deep, dry sand: a third of the grip, heavy rolling drag, and it swallows a spinning wheel. */
  sand: Object.freeze({ id: 'sand', label: 'sand', loose: true, grip: 0.40, sinkRate: 0.5, compaction: 0.8, rolling: 0.30 }),
  /** Mud: even less grip than sand and digs in faster, but packs down harder. */
  mud: Object.freeze({ id: 'mud', label: 'mud', loose: true, grip: 0.34, sinkRate: 0.65, compaction: 1.0, rolling: 0.26 }),
});

export class Terrain {
  constructor() {
    /** @type {{x:number,z:number,radius:number,surface:object}[]} */
    this.patches = [];
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} radius metres
   * @param {object} surface one of SURFACES
   */
  addPatch(x, z, radius, surface) {
    this.patches.push({ x, z, radius, surface });
    return this;
  }

  /**
   * The surface under a world-space point. Linear scan: there are a handful of
   * patches and this runs four times per physics step, so an index would cost
   * more to maintain than it saves.
   */
  surfaceAt(x, z) {
    for (const p of this.patches) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz <= p.radius * p.radius) return p.surface;
    }
    return SURFACES.asphalt;
  }

  /** How far into a loose patch a point is, 0 at the rim and 1 in the middle. */
  depthAt(x, z) {
    let worst = 0;
    for (const p of this.patches) {
      if (!p.surface.loose) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d <= p.radius) worst = Math.max(worst, 1 - d / p.radius);
    }
    return worst;
  }
}

/** The one the simulator uses. Environment fills it in as it builds the scene. */
export const terrain = new Terrain();
