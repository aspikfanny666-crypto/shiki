/**
 * ---------------------------------------------------------------------------
 * MANUAL CONFIGURATION SECTION
 * ---------------------------------------------------------------------------
 * The shipped GLB (Sketchfab "BMW M5 CS (F90)") went through Sketchfab's
 * `materialmerger`, so EVERY node is called `Object_N` and the four wheels are
 * fused into shared meshes. Nothing can be identified by node name alone.
 *
 * The loader therefore identifies parts by MATERIAL NAME + MEASURED GEOMETRY
 * and splits the wheels out of the merged meshes at triangle level.
 *
 * If automatic detection gets something wrong, pin it here. Every field accepts
 * an exact node name (e.g. 'Object_47'), an array of node names, or null/[] to
 * leave it to automatic detection. Node names are printed in the console dump
 * and via `window.__BMW__.dumpHierarchy()`.
 */
export const NODE_OVERRIDES = {
  // Wheels: only used when WHEEL_EXTRACTION.enabled === false, i.e. when a
  // model actually has four separate wheel nodes.
  frontLeftWheel: null,
  frontRightWheel: null,
  rearLeftWheel: null,
  rearRightWheel: null,

  steeringWheel: null, // auto-detected as Object_47/48/49 in the shipped GLB
  dashboard: null,
  interior: null,
  headlights: [],
  brakeLights: [],
  turnSignals: [],
  body: null,
};

/**
 * Material-name patterns. This model's material names survived the merge
 * ("Meshestires0011Mtl", "Steeringwheel0011Mtl", "Miscdash1Mtl", …), so they
 * are the most reliable signal available.
 */
export const MATERIAL_PATTERNS = {
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
};

/** Triangle-level wheel extraction out of material-merged meshes. */
export const WHEEL_EXTRACTION = {
  enabled: true,
  /** cylinder radius multiplier around the measured tire radius */
  radiusScale: 1.04,
  /** cylinder half-width multiplier around the measured tire width */
  widthScale: 1.45,
  /** materials that must never be pulled into a rotating wheel (e.g. fenders) */
  excludeMaterials: [/bodyshell/i, /doorcolor/i, /bonnet/i, /boot/i],
  /** log every mesh the splitter touched */
  verbose: true,
};

/** Real BMW M5 CS (F90) figures — used for scale checks and physics defaults. */
export const VEHICLE_TUNING = {
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
};

/** Rendering quality — mobile-friendly defaults. */
export const QUALITY = {
  maxPixelRatioDesktop: 2,
  maxPixelRatioMobile: 1.5,
  shadowMapSizeDesktop: 2048,
  shadowMapSizeMobile: 1024,
  shadowDistance: 18,
  enableShadowsMobile: true,
  postProcessing: false, // deliberately none
};
