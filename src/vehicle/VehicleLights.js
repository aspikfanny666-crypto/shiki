import {
  AdditiveBlending,
  Box3,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SpotLight,
  Vector3,
} from 'three';
import { extractLamps } from './LampExtraction.js';

/**
 * Vehicle lighting, driven by the car's OWN lamp geometry.
 *
 * The export merged everything by material, so the headlight internals share a
 * material with parts all over the car — lighting that material lights the
 * whole vehicle, and a floating quad in front of the nose looks like a floating
 * quad. LampExtraction therefore cuts the lamps out of the body meshes by
 * volume; this class animates the emissive on those real meshes, and adds a
 * halo at each lamp's measured centre for bloom.
 *
 * Where the export kept a usable light material of its own (the centre brake
 * light, the indicator repeater) that material is driven too.
 */

const DAYLIGHT = new Color(0xdce9ff);
const AMBER = new Color(0xff9b1a);
const TAIL_RED = new Color(0xff1a0a);
const REVERSE_WHITE = new Color(0xeef4ff);

function glowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new CanvasTexture(c);
}

export class VehicleLights {
  /** @param {import('./VehicleVisual.js').VehicleVisual} visual */
  constructor(visual, { settings } = {}) {
    this.visual = visual;
    this.settings = settings;
    this.root = new Group();
    this.root.name = 'VehicleLights';
    visual.root.add(this.root);

    this.state = { headlights: false, brake: false, reverse: false, indicator: 0 };
    this.blinkPhase = 0;
    this.blinkOn = false;
    this.glow = glowTexture();

    this.#measure();

    const { lamps, report } = extractLamps(visual.model, visual.root);
    this.realLamps = lamps;
    this.extraction = report;

    this.#buildGlow();
    this.#collectModelMaterials();
    this.beams = [];
    if (settings?.get('headlightBeams')) this.#createBeams();
  }

  #measure() {
    const box = new Box3().setFromObject(this.visual.model, true);
    const size = box.getSize(new Vector3());
    this.dims = { halfWidth: size.x / 2, height: size.y, front: box.min.z, rear: box.max.z };
  }

  /**
   * A soft halo in front of each real lamp, at the lamp's MEASURED centre.
   * Emissive geometry alone cannot bloom; this sells that cheaply. Lamps that
   * were not found get no halo rather than a guessed one.
   */
  #buildGlow() {
    this.glowSprites = {};
    const add = (key, { color, scale = 1, forward }) => {
      const lamp = this.realLamps?.[key];
      if (!lamp) return;
      const halo = new Mesh(
        new PlaneGeometry(lamp.size.x * 1.35 * scale, Math.max(lamp.size.y, 0.05) * 2.4 * scale),
        new MeshBasicMaterial({
          map: this.glow, color, transparent: true, opacity: 0,
          depthWrite: false, blending: AdditiveBlending, toneMapped: false,
        }),
      );
      halo.name = `${key}Halo`;
      halo.position.copy(lamp.centre);
      halo.position.z += forward;
      if (forward > 0) halo.rotation.y = Math.PI;
      halo.renderOrder = 3;
      this.root.add(halo);
      this.glowSprites[key] = halo;
    };
    add('headlightMain', { color: 0xfff0d0, forward: -0.07 });
    add('headlightDrl', { color: 0xdce9ff, scale: 0.85, forward: -0.06 });
    add('tailLight', { color: 0xff2a14, scale: 0.9, forward: 0.07 });
  }

  /** The two light materials the export kept intact. */
  #collectModelMaterials() {
    this.modelMaterials = { brake: [], indicator: [] };
    const parts = this.visual.parts;
    const collect = (res, bucket) => {
      if (!res?.found) return;
      for (const node of res.nodes) {
        node.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (!m?.emissive) continue;
            m.emissive = new Color(bucket === 'brake' ? 0xff1c0c : 0xff9b1a);
            m.emissiveIntensity = 0;
            this.modelMaterials[bucket].push(m);
          }
        });
      }
    };
    collect(parts?.brakeLights, 'brake');
    collect(parts?.turnSignals, 'indicator');
  }

  /** Real beams are optional: each one is another light in every shader. */
  #createBeams() {
    if (this.beams.length) return;
    const lamp = this.realLamps?.headlightMain;
    const y = lamp ? lamp.centre.y : this.dims.height * 0.45;
    const z = lamp ? lamp.centre.z : this.dims.front;
    for (const side of [-1, 1]) {
      const spot = new SpotLight(0xfff0d5, 0, 75, Math.PI / 7, 0.45, 1.2);
      spot.name = `HeadlightBeam${side < 0 ? 'Left' : 'Right'}`;
      spot.position.set(side * this.dims.halfWidth * 0.65, y, z);
      spot.target.position.set(side * this.dims.halfWidth * 0.65, 0.1, z - 30);
      spot.castShadow = false;
      this.root.add(spot);
      this.root.add(spot.target);
      this.beams.push(spot);
    }
  }

  setBeamsEnabled(enabled) {
    if (enabled) this.#createBeams();
    for (const s of this.beams) s.intensity = enabled && this.state.headlights ? 60 : 0;
  }

  setHeadlights(on) {
    this.state.headlights = on;
    return on;
  }

  toggleHeadlights() {
    return this.setHeadlights(!this.state.headlights);
  }

  /** -1 left, 1 right, 0 off. */
  setIndicator(direction) {
    if (this.state.indicator !== direction) {
      this.blinkPhase = 0;
      this.blinkOn = true;
    }
    this.state.indicator = direction;
  }

  /**
   * @param {number} dt seconds
   * @param {object} telemetry from the vehicle
   */
  update(dt, telemetry = {}) {
    const braking = (telemetry.brake ?? 0) > 0.05 || telemetry.handbrake === true;
    const reversing = telemetry.gear === 'R' && (telemetry.speedMps ?? 0) < -0.2;
    this.state.brake = braking;
    this.state.reverse = reversing;

    this.blinkPhase += dt;
    if (this.blinkPhase > 0.38) {
      this.blinkPhase = 0;
      this.blinkOn = !this.blinkOn;
    }
    const indicating = this.state.indicator !== 0 && this.blinkOn;
    const head = this.state.headlights;
    const ease = Math.min(1, dt * 14);

    const drive = (key, target, color = null) => {
      const lamp = this.realLamps?.[key];
      if (!lamp) return;
      const m = lamp.material;
      m.emissiveIntensity += (target - m.emissiveIntensity) * ease;
      if (color) m.emissive.lerp(color, ease);
      const halo = this.glowSprites?.[key];
      if (halo) {
        const want = Math.min(1, target / 2.4) * 0.7;
        halo.material.opacity += (want - halo.material.opacity) * ease;
      }
    };

    // A modern BMW flashes part of the daytime strip as the indicator, so the
    // DRL carries both jobs: white when lit, amber while blinking.
    drive('headlightDrl', indicating ? 3.6 : head ? 2.4 : 1.0, indicating ? AMBER : DAYLIGHT);
    drive('headlightMain', head ? 2.8 : 0);
    drive(
      'tailLight',
      braking ? 4.4 : reversing ? 2.8 : head ? 1.2 : 0.3,
      reversing ? REVERSE_WHITE : TAIL_RED,
    );

    for (const m of this.modelMaterials.brake) m.emissiveIntensity = braking ? 3.4 : head ? 0.9 : 0;
    for (const m of this.modelMaterials.indicator) m.emissiveIntensity = indicating ? 3.2 : 0;
    for (const s of this.beams) s.intensity = head ? 60 : 0;
  }
}
