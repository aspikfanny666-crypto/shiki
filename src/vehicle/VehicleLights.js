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
  SphereGeometry,
  Vector3,
} from 'three';

/**
 * Vehicle lighting.
 *
 * The GLB's headlights are merged into the body meshes, so they cannot be lit
 * by changing a material. Instead a thin light LAYER is added as children of
 * the vehicle root — emissive lens quads and glow sprites positioned from the
 * measured bounding box — and the GLB geometry is left untouched.
 *
 * Where the export DID keep a usable material (the centre brake light's
 * `Brakelightm1Mtl`, the indicator's `Indicatorrf1Mtl`) that material is driven
 * directly, so real model geometry lights up alongside the added layer.
 */

function glowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new CanvasTexture(c);
}

export class VehicleLights {
  /**
   * @param {import('./VehicleVisual.js').VehicleVisual} visual
   */
  constructor(visual, { settings } = {}) {
    this.visual = visual;
    this.settings = settings;
    this.root = new Group();
    this.root.name = 'VehicleLights';
    visual.root.add(this.root);

    // daylight scene: lamps start off, exactly like a real car parked in the sun
    this.state = { headlights: false, brake: false, reverse: false, indicator: 0 }; // indicator: -1 left, 1 right
    this.blinkPhase = 0;
    this.blinkOn = false;
    this.glow = glowTexture();

    this.#measure();
    this.#buildLamps();
    this.#collectModelMaterials();
    this.#buildBeams();
  }

  #measure() {
    const box = new Box3().setFromObject(this.visual.model, true);
    const size = box.getSize(new Vector3());
    this.dims = {
      halfWidth: size.x / 2,
      length: size.z,
      front: box.min.z,
      rear: box.max.z,
      lampY: 0.67, // headlight centre height, matched to this model's nose
      tailY: 0.80,
    };
  }

  /** Emissive quads + glow sprites, parented to the car so they move with it. */
  #buildLamps() {
    const d = this.dims;
    const make = (name, { color, width, height, position, rotationY = 0, intensity = 1, glowScale = 1 }) => {
      const group = new Group();
      group.name = name;
      group.position.set(...position);
      group.rotation.y = rotationY;

      const lens = new Mesh(
        new PlaneGeometry(width, height),
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.0, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
      );
      lens.name = `${name}Lens`;
      group.add(lens);

      const halo = new Mesh(
        new PlaneGeometry(width * 2.1 * glowScale, height * 3.4 * glowScale),
        new MeshBasicMaterial({ map: this.glow, color, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
      );
      halo.name = `${name}Halo`;
      halo.position.z = rotationY === 0 ? -0.02 : 0.02;
      group.add(halo);

      this.root.add(group);
      return { group, lens, halo, intensity, color: new Color(color) };
    };

    // The bounding box's front face is the tip of the bumper; the lamps sit
    // back from it, where the nose has already narrowed. Same at the rear.
    const xOuter = d.halfWidth * 0.62;
    const front = d.front + 0.26;
    const rear = d.rear - 0.22;

    this.lamps = {
      headL: make('HeadlightLeft', { color: 0xfff2d8, width: 0.3, height: 0.07, position: [-xOuter, d.lampY, front], intensity: 1.0 }),
      headR: make('HeadlightRight', { color: 0xfff2d8, width: 0.3, height: 0.07, position: [xOuter, d.lampY, front], intensity: 1.0 }),
      drlL: make('DrlLeft', { color: 0xdce9ff, width: 0.26, height: 0.022, position: [-xOuter, d.lampY + 0.055, front], intensity: 0.75, glowScale: 0.7 }),
      drlR: make('DrlRight', { color: 0xdce9ff, width: 0.26, height: 0.022, position: [xOuter, d.lampY + 0.055, front], intensity: 0.75, glowScale: 0.7 }),
      tailL: make('TailLightLeft', { color: 0xff2a1a, width: 0.34, height: 0.06, position: [-xOuter, d.tailY, rear], rotationY: Math.PI, intensity: 0.55 }),
      tailR: make('TailLightRight', { color: 0xff2a1a, width: 0.34, height: 0.06, position: [xOuter, d.tailY, rear], rotationY: Math.PI, intensity: 0.55 }),
      reverseL: make('ReverseLightLeft', { color: 0xf2f6ff, width: 0.12, height: 0.04, position: [-xOuter * 0.5, d.tailY - 0.08, rear], rotationY: Math.PI, intensity: 0.9, glowScale: 0.8 }),
      reverseR: make('ReverseLightRight', { color: 0xf2f6ff, width: 0.12, height: 0.04, position: [xOuter * 0.5, d.tailY - 0.08, rear], rotationY: Math.PI, intensity: 0.9, glowScale: 0.8 }),
      indFL: make('IndicatorFrontLeft', { color: 0xff9b1a, width: 0.13, height: 0.035, position: [-xOuter - 0.17, d.lampY - 0.01, front], intensity: 1.0, glowScale: 0.8 }),
      indFR: make('IndicatorFrontRight', { color: 0xff9b1a, width: 0.13, height: 0.035, position: [xOuter + 0.17, d.lampY - 0.01, front], intensity: 1.0, glowScale: 0.8 }),
      indRL: make('IndicatorRearLeft', { color: 0xff9b1a, width: 0.13, height: 0.035, position: [-xOuter - 0.15, d.tailY, rear], rotationY: Math.PI, intensity: 1.0, glowScale: 0.8 }),
      indRR: make('IndicatorRearRight', { color: 0xff9b1a, width: 0.13, height: 0.035, position: [xOuter + 0.15, d.tailY, rear], rotationY: Math.PI, intensity: 1.0, glowScale: 0.8 }),
    };

    // a small bright core inside each headlight so it reads at a distance
    for (const key of ['headL', 'headR']) {
      const core = new Mesh(
        new SphereGeometry(0.022, 8, 6),
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }),
      );
      core.name = `${key}Core`;
      this.lamps[key].group.add(core);
      this.lamps[key].core = core;
    }
  }

  /** Materials the GLB kept that we can genuinely drive. */
  #collectModelMaterials() {
    this.modelMaterials = { brake: [], indicator: [] };
    const parts = this.visual.parts;
    const collect = (res, bucket) => {
      if (!res?.found) return;
      for (const node of res.nodes) {
        node.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (!m.emissive) continue;
            m.emissive = new Color(bucket === 'brake' ? 0xff1c0c : 0xff9b1a);
            m.emissiveIntensity = 0;
            m.toneMapped = true;
            this.modelMaterials[bucket].push(m);
          }
        });
      }
    };
    collect(parts?.brakeLights, 'brake');
    collect(parts?.turnSignals, 'indicator');
  }

  /** Real spot lights — optional, they cost a shadow-free light each. */
  #buildBeams() {
    this.beams = [];
    if (!this.settings?.get('headlightBeams')) return;
    this.#createBeams();
  }

  #createBeams() {
    if (this.beams.length) return;
    const d = this.dims;
    for (const side of [-1, 1]) {
      const spot = new SpotLight(0xfff0d5, 0, 70, Math.PI / 7, 0.45, 1.2);
      spot.name = `HeadlightBeam${side < 0 ? 'Left' : 'Right'}`;
      spot.position.set(side * d.halfWidth * 0.7, d.lampY, d.front);
      spot.target.position.set(side * d.halfWidth * 0.7, 0.1, d.front - 30);
      spot.castShadow = false;
      this.root.add(spot);
      this.root.add(spot.target);
      this.beams.push(spot);
    }
  }

  setBeamsEnabled(enabled) {
    if (enabled) this.#createBeams();
    for (const s of this.beams) s.intensity = enabled && this.state.headlights ? 55 : 0;
  }

  setHeadlights(on) {
    this.state.headlights = on;
  }

  toggleHeadlights() {
    this.state.headlights = !this.state.headlights;
    return this.state.headlights;
  }

  /** -1 left, 1 right, 0 off. */
  setIndicator(direction) {
    if (this.state.indicator !== direction) this.blinkPhase = 0;
    this.state.indicator = direction;
  }

  /**
   * @param {number} dt
   * @param {object} telemetry from VehiclePhysics
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
    const indicatorOn = this.state.indicator !== 0 && this.blinkOn;

    const head = this.state.headlights;
    const set = (lamp, on, level = 1) => {
      if (!lamp) return;
      const target = on ? level : 0;
      lamp.lens.material.opacity += (target - lamp.lens.material.opacity) * Math.min(1, dt * 18);
      lamp.halo.material.opacity += (target * 0.55 - lamp.halo.material.opacity) * Math.min(1, dt * 18);
      if (lamp.core) lamp.core.material.opacity = lamp.lens.material.opacity;
    };

    set(this.lamps.headL, head, 0.95);
    set(this.lamps.headR, head, 0.95);
    set(this.lamps.drlL, head, 0.8);
    set(this.lamps.drlR, head, 0.8);
    set(this.lamps.tailL, head || braking, braking ? 1.0 : 0.45);
    set(this.lamps.tailR, head || braking, braking ? 1.0 : 0.45);
    set(this.lamps.reverseL, reversing, 0.9);
    set(this.lamps.reverseR, reversing, 0.9);
    set(this.lamps.indFL, indicatorOn && this.state.indicator < 0, 1);
    set(this.lamps.indRL, indicatorOn && this.state.indicator < 0, 1);
    set(this.lamps.indFR, indicatorOn && this.state.indicator > 0, 1);
    set(this.lamps.indRR, indicatorOn && this.state.indicator > 0, 1);

    // drive the materials the GLB actually kept
    for (const m of this.modelMaterials.brake) m.emissiveIntensity = braking ? 3.2 : head ? 0.8 : 0;
    for (const m of this.modelMaterials.indicator) m.emissiveIntensity = indicatorOn ? 3.0 : 0;

    for (const s of this.beams) s.intensity = head ? 55 : 0;
  }
}
