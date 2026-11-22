/**
 * The car catalogue.
 *
 * Everything that differs between vehicles lives here: the file to load, the
 * real-world dimensions the loader checks its scale against, the physics
 * tuning, the material-name patterns the part detector works from, and how
 * much the renderer is allowed to restyle the model's materials.
 *
 * That last one matters more than it sounds. The two cars shipped here came
 * out of Sketchfab through completely different pipelines:
 *
 *   • The M5 CS went through `materialmerger`, which threw away every texture
 *     and left 89 flat colours. It needs the material pass (clearcoat on the
 *     paint, matte rubber, polished rims) and a generated tyre tread, or it
 *     reads like a clay model.
 *   • The M4 CS keeps its full PBR set — base colour, metallic-roughness,
 *     normal and emissive maps, with real transmission glass. Restyling it
 *     would destroy work that is already there, so the material pass is off
 *     and its lights are left exactly as the author baked them.
 *
 * `src/vehicleConfig.js` selects one of these and re-exports it, so the rest
 * of the code keeps importing VEHICLE_TUNING / MATERIAL_PATTERNS as before.
 */

// ---------------------------------------------------------------- M5 CS ---

/** Real BMW M5 CS (F90) figures — scale checks and physics defaults. */
const M5_REFERENCE = Object.freeze({
  length: 4.966,
  widthBody: 1.903, // without mirrors
  widthMirrors: 2.126,
  height: 1.473,
  wheelbase: 2.982,
  trackFront: 1.627,
  trackRear: 1.605,
  wheelDiameterFront: 0.6985, // 275/35 R20
  wheelDiameterRear: 0.7113, // 285/35 R20
  wheelWidthFront: 0.275,
  wheelWidthRear: 0.285,
  kerbMass: 1895,
});

/**
 * This model's material names survived the merge ("Meshestires0011Mtl",
 * "Steeringwheel0011Mtl", "Miscdash1Mtl", …), so they are the most reliable
 * signal available — the node names are all `Object_N`.
 */
const M5_MATERIAL_PATTERNS = Object.freeze({
  tire: /(tire|tyre)/i,
  wheelPart: /(tire|tyre|rim|hub|rotor|brakedisc|wheel(?!.*steering))/i,
  steeringWheel: /steeringwheel/i,
  dashboard: /(dash|instrument|cluster|needle|gauge)/i,
  interior: /(interior|seat|seatbelt|doorr|steeringwheel|dash)/i,
  headlight: /(headlight|headlamp|frontlight|drl|daytime|xenon|laserlight)/i,
  brakeLight: /(brakelight|taillight|rearlight|stoplight)/i,
  turnSignal: /(indicator|turnsignal|blinker|signal)/i,
  body: /(bodyshell|chassis|bonnet|boot|door|body)/i,
  glass: /(glass|window|windshield|windscreen)/i,
  frontMarker: /(bonnet|hood|grill|grille|headlight|bumperf|frontbumper)/i,
  rearMarker: /(boot|trunk|tailgate|brakelight|taillight|rearbumper|exhaust|diffuser)/i,
});

const M5_TUNING = Object.freeze({
  mass: 1825, // kg (M5 CS kerb weight)
  // chassis collider is a plain cuboid; the GLB is never used as a collider
  chassisInset: { width: 0.92, height: 0.55, length: 0.97 },
  centreOfMassOffset: [0, -0.22, 0.05], // relative to chassis box centre, metres

  suspension: {
    // Rapier's spring force works out as stiffness × compression × chassis mass,
    // so for 1825 kg a stiffness of ~110 gives ≈22 mm of static sag per corner —
    // firm, like the real car. Measured, not guessed: see the sweep in
    // VehiclePhysics (#staticSag) which compensates the ride height for it.
    restLength: 0.30,
    maxTravel: 0.16,
    stiffness: 110,
    // damping ratios: measured to remove the residual bounce at rest
    // (0.85/0.95 left ~1 mm of jitter, these settle dead flat)
    compression: 2.5,
    relaxation: 3.0,
    maxForce: 38000,
  },

  tyre: {
    /**
     * Rapier's friction_slip is the tyre's grip coefficient; 1.5 is a fast road
     * tyre (the car pulls ~1.5 g before it slides). Raise for more grip.
     */
    frictionSlip: 1.5,
    sideFrictionStiffness: 1.0,
    rollingResistance: 0.017,
  },

  engine: {
    // BMW S63B44T4: 635 hp (467 kW), 750 Nm
    peakTorqueNm: 750,
    idleRpm: 800,
    redlineRpm: 7200,
    maxRpm: 7600,
    inertia: 0.32,
    brakingTorqueNm: 62, // engine braking at closed throttle
    /** cylinders × banks, for the engine-order audio synthesis */
    cylinders: 8,
    layout: 'v8-crossplane',
  },

  transmission: {
    // ZF 8HP, M Steptronic ratios
    gearRatios: [4.71, 3.14, 2.11, 1.67, 1.29, 1.0, 0.84, 0.67],
    reverseRatio: 3.3,
    finalDrive: 3.15,
    efficiency: 0.92,
    upshiftRpm: 6900,
    downshiftRpm: 2600,
    /** reverse is limited like a real automatic, not revved to the redline */
    maxReverseKmh: 40,
    shiftTime: 0.18, // seconds of torque cut
  },

  brakes: {
    /**
     * Rapier's wheel brake is a per-step impulse, not a force in newtons, so
     * these numbers were tuned by measurement at the fixed 60 Hz timestep:
     * 100 front / 55 rear stops the car from 176 km/h in ~4.6 s ≈ 1.05 g,
     * which matches a real M5. The tyre model saturates around 2.9 g.
     */
    maxBrakeForce: 100,
    rearBias: 0.55,
    handbrakeForce: 260, // deliberately enough to lock the rear axle
  },

  aero: {
    dragCoefficient: 0.33,
    frontalArea: 2.32,
    airDensity: 1.225,
    downforceCoefficient: 0.12,
  },

  steering: {
    maxAngleDeg: 34,
    /** steering is tightened as speed rises (deg at 200 km/h) */
    minAngleDegAtSpeed: 8,
    speedForMinAngle: 55, // m/s
    returnRate: 3.2, // rad/s back to centre
    turnRate: 2.4, // rad/s towards the input
  },

  // The M5 CS is M xDrive (all-wheel drive, rear-biased). 'rear' | 'front' | 'all'
  drivenAxle: 'all',
});

/**
 * Which material name means "paint", "glass", "rubber"… is a property of the
 * model, not of the renderer. The M5's panels are `bodyshell`; the GLS's are
 * `gls_paint`. A car with no textures needs these, because its whole look is
 * rebuilt from them; a car that ships PBR maps never reaches this code.
 */
const M5_RESTYLE = Object.freeze({
  paint: /^(bodyshell|doorcolor|bonnet\d*|boot\d*|chassis00[1289]|doordsidef|doorpsidef)/i,
  glass: /glass|window/i,
  rubber: /tires|tyre/i,
  chrome: /chrome|mesheswhite|hub/i,
  rotor: /rotor/i,
  caliper: /crimson|caliper/i,
  interior: /interior|seats|dash|steeringwheel|seatbelt|misca|miscb|miscdoor/i,
  dark: /black|misc|part\d/i,
});

// ---------------------------------------------------------------- M4 CS ---

/** Real BMW M4 CS (G82, 2025) figures. */
const M4_REFERENCE = Object.freeze({
  length: 4.794,
  widthBody: 1.887,
  widthMirrors: 2.068,
  height: 1.393,
  wheelbase: 2.857,
  trackFront: 1.617,
  trackRear: 1.605,
  wheelDiameterFront: 0.6754, // 275/35 R19
  wheelDiameterRear: 0.7113, // 285/30 R20
  wheelWidthFront: 0.275,
  wheelWidthRear: 0.285,
  kerbMass: 1760,
});

/**
 * This export keeps readable material names from the original FBX
 * ("m4car_body1.006", "BMW_…_Wheel1A_…_Material.032", "m4car_glass1.006"), so
 * the same detector works — only the words differ. `tire` has to match the
 * wheel material even though the author never wrote "tyre" anywhere: the whole
 * wheel, rim and tyre together, is one material here.
 */
const M4_MATERIAL_PATTERNS = Object.freeze({
  tire: /wheel1a.*material\.032/i,
  wheelPart: /(wheel1a|caliper|capiler|brake_pad)/i,
  steeringWheel: /^$/, // the cabin is one mesh; there is no separate wheel node
  dashboard: /interior1\.007/i,
  interior: /(interior|m4car_interior)/i,
  headlight: /^$/, // the author baked the lights into an emissive map
  brakeLight: /^$/,
  turnSignal: /^$/,
  body: /(m4car_body|m4car_bodykit|m4car_hood|black_paint|red_paint|carbon)/i,
  glass: /m4car_glass/i,
  frontMarker: /(hood|grille|grill)/i,
  rearMarker: /(spoiler|lighta)/i,
});

const M4_TUNING = Object.freeze({
  mass: 1760,
  chassisInset: { width: 0.92, height: 0.55, length: 0.97 },
  centreOfMassOffset: [0, -0.22, 0.04],

  suspension: {
    // lighter and stiffer-sprung than the M5; same measured-sag approach
    restLength: 0.28,
    maxTravel: 0.15,
    stiffness: 122,
    compression: 2.6,
    relaxation: 3.1,
    maxForce: 36000,
  },

  tyre: {
    // Cup 2 R as standard on the CS — more grip than the M5's road tyre
    frictionSlip: 1.62,
    sideFrictionStiffness: 1.05,
    rollingResistance: 0.016,
  },

  engine: {
    // BMW S58B30T0: 550 hp (405 kW), 650 Nm, twin-turbo inline six
    peakTorqueNm: 650,
    idleRpm: 800,
    redlineRpm: 7200,
    maxRpm: 7600,
    inertia: 0.26,
    brakingTorqueNm: 54,
    cylinders: 6,
    layout: 'i6',
  },

  transmission: {
    // ZF 8HP51 M Steptronic
    gearRatios: [5.0, 3.2, 2.14, 1.72, 1.31, 1.0, 0.82, 0.64],
    reverseRatio: 3.46,
    finalDrive: 3.46,
    efficiency: 0.93,
    upshiftRpm: 7000,
    downshiftRpm: 2700,
    maxReverseKmh: 40,
    shiftTime: 0.15,
  },

  brakes: {
    // carbon-ceramic as standard: a little more stopping power than the M5
    maxBrakeForce: 108,
    rearBias: 0.52,
    handbrakeForce: 260,
  },

  aero: {
    dragCoefficient: 0.35,
    frontalArea: 2.19,
    airDensity: 1.225,
    downforceCoefficient: 0.16,
  },

  steering: {
    maxAngleDeg: 35,
    minAngleDegAtSpeed: 8,
    speedForMinAngle: 55,
    returnRate: 3.4,
    turnRate: 2.6,
  },

  // M xDrive, rear-biased, same as the M5 CS.
  drivenAxle: 'all',
});


// -------------------------------------------------------------- GLS 600 ---

/** Real Mercedes-Maybach GLS 600 4MATIC figures. */
const GLS_REFERENCE = Object.freeze({
  length: 5.205,
  widthBody: 1.956, // without mirrors
  widthMirrors: 2.157,
  height: 1.840,
  wheelbase: 3.135,
  trackFront: 1.679,
  trackRear: 1.692,
  wheelDiameterFront: 0.808, // 275/50 R21
  wheelDiameterRear: 0.808,
  wheelWidthFront: 0.275,
  wheelWidthRear: 0.315,
  kerbMass: 2785,
});

/**
 * This export kept the names from the BeamNG asset it was built from, which is
 * a gift: `gls_fara` is the headlight, `gls_stop` the brake light, `gls_sigl`
 * and `gls_sigr` the indicators, `gls_torpedka` the dashboard. (Several are
 * Russian — фара, свет, торпедка — which is exactly why this detector reads
 * material names rather than guessing from English words alone.)
 *
 * `wheel_42a` is the rim and `wheel_42b` the tyre, per the BeamNG convention.
 */
const GLS_MATERIAL_PATTERNS = Object.freeze({
  /**
   * The tyre is the one material the exporter did NOT name — it came through
   * as `Scene_-_Root.001`. It was found by measurement instead: of all 43
   * materials, it is the only one that forms four separate clusters of
   * 0.29 × 0.81 × 0.81 m, one in each corner, which is a 275/50 R21 to the
   * centimetre. `gls_kaki.104` is the rim inside it, at 0.64 m.
   *
   * `wheel_42a` / `wheel_42b`, despite the names, are spread over the whole
   * body and are not wheels at all. Names lie; geometry does not.
   */
  tire: /^Scene_-_Root/i,
  wheelPart: /(^Scene_-_Root|gls_kaki\.104|amdb11_(brake|caliper|misc))/i,
  // `gls_amg_steer` is an 18-triangle AMG badge, not the rim: the wheel itself
  // is welded into the cabin mesh. Spinning a floating badge would look worse
  // than not animating anything, so this car has no turning steering wheel.
  steeringWheel: /(?!)/,
  dashboard: /gls_torpedka/i,
  interior: /(gls_interior|gls_leather|gls_torpedka|gls_seatbelt|gls_wood|gls_din|gls_carbonn|etk800_interior|gls_dvd|gls_g(auges|ps)_screen)/i,
  headlight: /(gls_fara|gls_ras|gls_run|gls_svet)/i,
  brakeLight: /(gls_stop|gls_rear)/i,
  turnSignal: /(gls_sigl|gls_sigr|lsiggls)/i,
  body: /(gls_paint|gls_kaki|vehicle_paint|gls_black_chrome)/i,
  glass: /(gls_glass|etk800_glass|vehicle_vehglass)/i,
  frontMarker: /(gls_fara|gls_grille|gls_run|gls_ras)/i,
  rearMarker: /(gls_stop|gls_rear|gls_sig)/i,
});

const GLS_RESTYLE = Object.freeze({
  paint: /^(gls_paint|gls_kaki\.025|vehicle_paint)/i,
  glass: /glass/i,
  rubber: /^Scene_-_Root/i,
  chrome: /(gls_kaki\.104|black_chrome|chrome|amdb11_misc)/i,
  rotor: /amdb11_brake/i,
  caliper: /amdb11_caliper/i,
  interior: /(gls_interior|gls_leather|gls_torpedka|gls_seatbelt|gls_wood|gls_din|gls_carbonn|etk800_interior)/i,
  dark: /(black|misc|vehicle_basic|vehicle_detail)/i,
});

const GLS_TUNING = Object.freeze({
  mass: 2785,
  // a tall body: the collider is deeper and sits higher than either M car
  chassisInset: { width: 0.92, height: 0.62, length: 0.96 },
  centreOfMassOffset: [0, -0.26, 0.02],

  suspension: {
    /**
     * AIRMATIC with E-ACTIVE BODY CONTROL. Long travel and soft springs for
     * 2785 kg — and that travel is what Recovery Mode works with: see
     * `recoveryAssist` below and src/vehicle/RecoveryMode.js.
     */
    restLength: 0.38,
    maxTravel: 0.26,
    stiffness: 78,
    compression: 2.2,
    relaxation: 2.8,
    maxForce: 52000,
  },

  tyre: {
    // a road SUV tyre carrying far more mass: less grip than an M car
    frictionSlip: 1.18,
    sideFrictionStiffness: 0.85,
    rollingResistance: 0.019,
  },

  engine: {
    // M177 4.0 V8 biturbo + EQ Boost: 558 hp (410 kW), 730 Nm. Cross-plane.
    peakTorqueNm: 730,
    idleRpm: 700,
    redlineRpm: 6000,
    maxRpm: 6400,
    inertia: 0.42,
    brakingTorqueNm: 70,
    cylinders: 8,
    layout: 'v8-crossplane',
  },

  transmission: {
    // 9G-TRONIC
    gearRatios: [5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.87, 0.72, 0.60],
    reverseRatio: 4.8,
    finalDrive: 3.07,
    efficiency: 0.9,
    upshiftRpm: 5700,
    downshiftRpm: 2200,
    maxReverseKmh: 35,
    shiftTime: 0.26,
  },

  brakes: {
    // 2.8 tonnes takes more stopping, and it leans on the front axle more
    maxBrakeForce: 132,
    rearBias: 0.42,
    handbrakeForce: 300,
  },

  aero: {
    // a big square SUV: much more frontal area, worse drag, no downforce
    dragCoefficient: 0.37,
    frontalArea: 2.95,
    airDensity: 1.225,
    downforceCoefficient: 0.02,
  },

  steering: {
    maxAngleDeg: 36,
    minAngleDegAtSpeed: 9,
    speedForMinAngle: 50,
    returnRate: 2.8,
    turnRate: 2.0,
  },

  // 4MATIC permanent all-wheel drive.
  drivenAxle: 'all',
});

// --------------------------------------------------------------------------

const NO_OVERRIDES = Object.freeze({
  frontLeftWheel: null,
  frontRightWheel: null,
  rearLeftWheel: null,
  rearRightWheel: null,
  steeringWheel: null,
  dashboard: null,
  interior: null,
  headlights: [],
  brakeLights: [],
  turnSignals: [],
  body: null,
});

export const CARS = Object.freeze({
  'm5-f90': Object.freeze({
    id: 'm5-f90',
    label: 'M5 CS',
    name: 'BMW M5 CS (F90)',
    modelUrl: 'models/bmw-f90.glb',
    /** the global a single-page build puts the base64 GLB in */
    embedGlobal: '__BMW_MODEL__',
    reference: M5_REFERENCE,
    tuning: M5_TUNING,
    materialPatterns: M5_MATERIAL_PATTERNS,
    nodeOverrides: NO_OVERRIDES,
    wheelExtraction: Object.freeze({
      enabled: true,
      /** cylinder radius multiplier around the measured tire radius */
      radiusScale: 1.04,
      /** cylinder half-width multiplier around the measured tire width */
      widthScale: 1.45,
      /** materials that must never be pulled into a rotating wheel (e.g. fenders) */
      excludeMaterials: [/bodyshell/i, /doorcolor/i, /bonnet/i, /boot/i],
      verbose: true,
    }),
    /** the merge stripped every texture, so the renderer rebuilds the look */
    restyleMaterials: true,
    restyle: M5_RESTYLE,
    /** and paints a tyre tread, because there is none */
    generateTyreTread: true,
    /** the lights are merged into the body: VehicleLights adds its own layer */
    lightLayer: true,
    credit: Object.freeze({
      title: 'BMW M5 CS (F90)',
      author: 'fvrenbld (https://sketchfab.com/890244234)',
      license: 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      source: 'https://sketchfab.com/3d-models/bmw-m5-cs-f90-8f74fb3420e24213aaeea33dc99450a3',
    }),
  }),

  'm4-cs': Object.freeze({
    id: 'm4-cs',
    label: 'M4 CS',
    name: '2025 BMW M4 CS VR46 Edition',
    modelUrl: 'models/bmw-m4-cs.glb',
    embedGlobal: '__BMW_M4_MODEL__',
    reference: M4_REFERENCE,
    tuning: M4_TUNING,
    materialPatterns: M4_MATERIAL_PATTERNS,
    nodeOverrides: NO_OVERRIDES,
    wheelExtraction: Object.freeze({
      enabled: true,
      radiusScale: 1.04,
      // one material covers rim, tyre and hub, so the cylinder only has to
      // clear the wheel itself — a wider one starts eating the arch liners
      widthScale: 1.15,
      excludeMaterials: [/body1/i, /bodykit/i, /hood/i, /spoiler/i, /glass/i, /plast/i],
      verbose: true,
    }),
    /** full PBR set from the author; leave every material alone */
    restyleMaterials: false,
    restyle: M5_RESTYLE, // never reached: restyleMaterials is false
    generateTyreTread: false,
    /** the head and tail lights are already lit by the model's emissive map */
    lightLayer: false,
    credit: Object.freeze({
      title: '2025 BMW M4 CS VR46 Edition',
      author: "BMW'S Lost Proxy (https://sketchfab.com/Bmws_Lost_Proxy)",
      license: 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      source: 'https://sketchfab.com/3d-models/2025-bmw-m4-cs-vr46-edition-3d111a7ed0f544bc9215e3038db4c8dc',
    }),
  }),
  'gls-600': Object.freeze({
    id: 'gls-600',
    label: 'GLS 600',
    name: 'Mercedes-Maybach GLS 600',
    modelUrl: 'models/mercedes-gls600.glb',
    embedGlobal: '__GLS_MODEL__',
    reference: GLS_REFERENCE,
    tuning: GLS_TUNING,
    materialPatterns: GLS_MATERIAL_PATTERNS,
    nodeOverrides: NO_OVERRIDES,
    wheelExtraction: Object.freeze({
      enabled: true,
      radiusScale: 1.04,
      // the rim, tyre, disc and caliper are separate materials here, so the
      // cylinder has to be wide enough to take the whole corner with it
      widthScale: 1.5,
      // the arches and sills reach into that cylinder; they must stay put
      excludeMaterials: [
        /gls_paint/i, /gls_kaki\.025/i, /vehicle_paint/i, /gls_glass/i,
        /gls_interior/i, /gls_black_chrome/i, /wheel_42b\.038/i, /etk800\.009/i,
      ],
      verbose: true,
    }),
    /** no textures at all, same as the M5: the look is rebuilt from materials */
    restyleMaterials: true,
    restyle: GLS_RESTYLE,
    /** the tyre is already 23k triangles of moulded tread; do not paint over it */
    generateTyreTread: false,
    /**
     * The export kept real, separate light materials (gls_fara, gls_stop,
     * gls_sigl/r), so VehicleLights drives those directly instead of adding a
     * layer of its own quads on top of them.
     */
    lightLayer: false,
    /**
     * The reason this car is here. The GLS with E-ACTIVE BODY CONTROL has a
     * free-driving assist that pumps the air suspension up and down to rock
     * itself out of sand. See src/vehicle/RecoveryMode.js.
     */
    recoveryAssist: true,
    credit: Object.freeze({
      title: 'Mersedes- Benz Maybach GLS 600',
      author: 'Black Snow (https://sketchfab.com/BlackSnow02)',
      license: 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
      source: 'https://sketchfab.com/3d-models/mersedes-benz-maybach-gls-600-34c4687ba8204efaa7551afea9f5689f',
    }),
  }),
});

export const CAR_IDS = Object.freeze(Object.keys(CARS));
export const DEFAULT_CAR_ID = 'm5-f90';

export function getCar(id) {
  return CARS[id] ?? CARS[DEFAULT_CAR_ID];
}
