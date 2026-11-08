import { Clock, MathUtils, Vector3 } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { settings } from './settings.js';
import { selectCar, getCar, CARS } from './vehicleConfig.js';
import { createTestScene } from './scene/TestScene.js';
import { PhysicsWorld } from './scene/PhysicsWorld.js';
import { Environment } from './scene/Environment.js';
import { CameraRig } from './scene/CameraRig.js';
import { VehicleVisual } from './vehicle/VehicleVisual.js';
import { VehiclePhysics } from './vehicle/VehiclePhysics.js';
import { KinematicVehicle } from './vehicle/KinematicVehicle.js';
import { NullPhysicsWorld } from './scene/NullPhysicsWorld.js';
import { VehicleLights } from './vehicle/VehicleLights.js';
import { Controls } from './input/Controls.js';
import { EngineAudio } from './audio/EngineAudio.js';
import { reportToConsole, buildReportJSON } from './model/reportToConsole.js';
import { DebugPanel } from './ui/DebugPanel.js';
import { Hud } from './ui/Hud.js';
import { SettingsPanel } from './ui/SettingsPanel.js';
import { registerServiceWorker, InstallManager } from './pwa.js';
import './ui/style.css';

const container = document.getElementById('app');
const loader = document.getElementById('boot');
const setBootMessage = (text) => {
  const el = loader?.querySelector('[data-boot-text]');
  if (el) el.textContent = text;
};

const scene3d = createTestScene(container, { settings });
const { renderer, scene, camera, axes } = scene3d;

// ---------------------------------------------------------------- model ----
/**
 * A car's GLB normally comes from public/models. A host that only serves
 * standard web media types (a published artifact) can instead ship it as
 * base64 in a plain script that sets the car's `embedGlobal`; it is decoded
 * here and handed to the loader as bytes.
 */
const embeddedBlobs = new Map();
function embeddedModelBytes(car) {
  if (embeddedBlobs.has(car.id)) return embeddedBlobs.get(car.id);
  const base64 = window[car.embedGlobal];
  let result = null;
  if (typeof base64 === 'string' && base64.length >= 1024) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // Hand the loader a blob: URL rather than the raw buffer, so the embedded
    // model goes through exactly the same load path as a fetched file.
    result = {
      url: URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' })),
      buffer: bytes.buffer,
    };
  }
  embeddedBlobs.set(car.id, result);
  return result;
}

/**
 * Candidates, so the same bundle works from a dev server, a sub-directory and
 * a published page whose URL has no trailing slash.
 */
function modelSourceFor(car) {
  const embedded = embeddedModelBytes(car);
  if (embedded) return [embedded.url, embedded.buffer];
  const u = car.modelUrl;
  return [u, new URL(u, document.baseURI).href, new URL(u, import.meta.url).href, `/${u}`];
}

/**
 * A single-page build can carry more than one car. Only the first is a
 * `<script>` in the page; the rest are published alongside it and listed in
 * `window.__BMW_EMBED_SCRIPTS__` as { carId: 'file.js' }, so a 10 MB second
 * model is fetched the first time somebody actually switches to it instead of
 * on every page load.
 */
function loadEmbedScript(car) {
  const src = window.__BMW_EMBED_SCRIPTS__?.[car.id];
  if (!src || window[car.embedGlobal]) return Promise.resolve();
  return new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => {
      console.warn(`[model] "${src}" could not be loaded; falling back to ${car.modelUrl}`);
      resolve();
    };
    document.head.appendChild(el);
  });
}

async function loadVisual(car) {
  setBootMessage(`loading ${car.name}…`);
  await loadEmbedScript(car);
  const next = new VehicleVisual();
  await next.load({
    url: modelSourceFor(car),
    renderer,
    onProgress: (e) => {
      if (e.lengthComputable) setBootMessage(`${car.label} — ${Math.round((e.loaded / e.total) * 100)}%`);
    },
  });
  return next;
}

/**
 * Free a vehicle's GPU memory. Three.js does not do this on `remove()`, and a
 * player flicking between cars would otherwise leak a geometry set and a few
 * dozen textures per swap. Materials and textures are collected into sets
 * first, because the same material is shared by many meshes.
 */
function disposeVisual(v) {
  if (!v) return;
  const materials = new Set();
  const textures = new Set();
  v.root.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) {
      o.geometry?.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) materials.add(m);
    }
  });
  for (const m of materials) {
    for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    m.dispose();
  }
  for (const t of textures) t.dispose();
  v.root.removeFromParent();
}

let car = selectCar(settings.get('car'));
let visual = await loadVisual(car);
scene.add(visual.root);

// --------------------------------------------------------------- physics ---
// Rapier is WebAssembly. A strict Content-Security-Policy without
// `wasm-unsafe-eval` refuses to instantiate it, so the page falls back to a
// kinematic drive model instead of dying. Everything downstream is identical.
setBootMessage('starting physics…');
let rapierReady = false;
try {
  await RAPIER.init();
  rapierReady = true;
} catch (error) {
  console.warn('Rapier (WebAssembly) could not start — falling back to the kinematic vehicle model.', error);
}

const physicsWorld = rapierReady ? new PhysicsWorld(RAPIER, scene) : new NullPhysicsWorld(scene);
const environment = new Environment(physicsWorld, scene, { quality: settings.get('quality') });

const buildPhysics = () => (rapierReady
  ? new VehiclePhysics(RAPIER, physicsWorld.world, visual)
  : new KinematicVehicle(visual));

let physics = buildPhysics();
let lights = new VehicleLights(visual, { settings });
const audio = new EngineAudio({ settings, engine: car.tuning.engine });
const SPAWN = new Vector3(0, rapierReady ? 0.08 : 0, 0);
physics.reset(SPAWN);

// ------------------------------------------------------------- reporting ---
reportToConsole(visual);
console.group(`%c14. ${rapierReady ? 'VehiclePhysics (Rapier)' : 'KinematicVehicle (no WebAssembly here)'}`, 'color:#7dd3fc;font-weight:700');
console.log(physics.describe());
console.log('material upgrades applied:', visual.materialUpgrades);
console.log('steering wheel pivot:', visual.steeringWheel);
console.groupEnd();

// ------------------------------------------------------------------- UI ----
const hud = new Hud(container);

/**
 * An artifact runs inside the host's iframe. If that frame was created without
 * the `autoplay` permission the browser mutes the page no matter how many times
 * it is tapped — the audio graph runs and produces samples that never reach the
 * speakers. The page cannot grant itself the permission, but opening the same
 * URL as a top-level tab escapes the frame entirely, so that is what the badge
 * offers when the policy is the thing in the way.
 */
const audioPolicyBlocked = EngineAudio.autoplayAllowed() === false;
if (audioPolicyBlocked) {
  console.warn(
    'This page is embedded in a frame without the autoplay permission, so the browser will not let it make sound. ' +
      'Open the page in its own tab for audio.',
  );
}

hud.bindSound(() => {
  settings.set('sound', true);
  audio.resume();
  if (!audioPolicyBlocked) return;
  const opened = window.open(window.location.href, '_blank', 'noopener');
  if (!opened) {
    hud.setNotice('sound is blocked here — open this page in its own tab');
  }
});
if (!rapierReady) hud.setNotice('simplified physics — WebAssembly blocked');
const debugPanel = new DebugPanel(container);
debugPanel.render(visual, physics);
debugPanel.el.hidden = !settings.get('debug');
debugPanel.controls.hidden = !settings.get('debug');

const rig = new CameraRig(camera, renderer.domElement, visual.root, { settings });

const resetCar = () => {
  physics.reset(SPAWN);
  controls.setReverseLatch(false);
  controls.releaseAll();
  lights.setIndicator(0);
  rig.snap();
};

const controls = new Controls(container, {
  settings,
  onReset: resetCar,
  onCamera: () => audio.setCamera(rig.cycleMode()),
  onLights: () => lights.toggleHeadlights(),
  onIndicator: (dir) => lights.setIndicator(lights.state.indicator === dir ? 0 : dir),
  onMute: () => settings.set('sound', !settings.get('sound')),
  // A tap on a real button is the gesture browsers want before audio may start,
  // so this both enables and unlocks it.
  onSound: () => {
    const next = !(settings.get('sound') && audio.running);
    settings.set('sound', next);
    if (next) audio.resume();
  },
  onReverse: (on) => physics.requestReverse(on),
});

// Offline support + the "add to home screen" affordance. Registration is a
// no-op in dev and inside an embedded frame; see src/pwa.js.
const install = new InstallManager();
registerServiceWorker();

const settingsPanel = new SettingsPanel(container, settings, {
  credit: visual.credit,
  cars: CARS,
  install,
  getAudioStatus: () => audio.diagnose(),
  onAction: (action) => {
    if (action === 'reset-car') resetCar();
  },
});

debugPanel.addButton('Camera (C)', (b) => { b.textContent = `Camera: ${audio.setCamera(rig.cycleMode())}`; });
debugPanel.addButton('Reset car (R)', resetCar);
debugPanel.addButton('Bounds box', () => visual.showBoundsHelper(scene, !(visual.boxHelper?.visible ?? false)));
debugPanel.addButton('World axes', () => { axes.visible = !axes.visible; });

/**
 * Switch car without reloading the page.
 *
 * Order matters: the physics body has to leave the world before the visual it
 * was measured from is disposed, and `selectCar` has to run before the new
 * VehicleVisual and VehiclePhysics are built, because both read the tuning,
 * the material patterns and the reference dimensions in their constructors.
 *
 * The AudioContext is deliberately NOT rebuilt — it is unlocked, and making
 * the player tap again to get sound back after changing car would be a poor
 * trade for a spectrum that can be swapped in place.
 */
let swapping = false;
async function swapCar(id) {
  if (swapping || id === car.id) return;
  const next = getCar(id);
  swapping = true;
  loader?.classList.remove('done');
  if (loader && !loader.isConnected) container.appendChild(loader);
  setBootMessage(`loading ${next.name}…`);

  try {
    car = selectCar(id);
    const nextVisual = await loadVisual(car);

    physics.dispose();
    disposeVisual(visual);

    visual = nextVisual;
    scene.add(visual.root);
    physics = buildPhysics();
    physics.steeringSensitivity = settings.get('steeringSensitivity');
    lights = new VehicleLights(visual, { settings });
    lights.setBeamsEnabled(settings.get('headlightBeams'));
    visual.setShadows(settings.get('shadows'), settings.get('quality'));
    visual.setGlassQuality(settings.get('quality'));
    audio.setEngine(car.tuning.engine);

    rig.setTarget(visual.root);
    scene3d.follow(visual.root.position, visual.root.quaternion);
    physics.reset(SPAWN);
    rig.snap();

    debugPanel.render(visual, physics);
    settingsPanel.setCredit(visual.credit);
    controls.setReverseLatch(false);
    controls.releaseAll();
    reportToConsole(visual);
  } finally {
    swapping = false;
    loader?.classList.add('done');
    setTimeout(() => loader?.remove(), 600);
  }
}

// settings -> systems
settings.subscribe((key) => {
  if (key === 'car') swapCar(settings.get('car'));
  if (key === 'quality' || key === 'shadows' || key === 'reflections' || key === '*') {
    scene3d.applySettings();
    environment.setQuality(settings.get('quality'));
    environment.setShadows(settings.get('shadows'));
    visual.setShadows(settings.get('shadows'), settings.get('quality'));
    visual.setGlassQuality(settings.get('quality'));
  }
  if (key === 'headlightBeams' || key === '*') lights.setBeamsEnabled(settings.get('headlightBeams'));
  if (key === 'steeringSensitivity' || key === '*') physics.steeringSensitivity = settings.get('steeringSensitivity');
  if (key === 'debug' || key === '*') {
    debugPanel.el.hidden = !settings.get('debug');
    debugPanel.controls.hidden = !settings.get('debug');
  }
});
physics.steeringSensitivity = settings.get('steeringSensitivity');
environment.setShadows(settings.get('shadows'));
visual.setShadows(settings.get('shadows'), settings.get('quality'));
visual.setGlassQuality(settings.get('quality'));

// ------------------------------------------------------------ render loop ---
const clock = new Clock();
let fps = 60;
let flippedFor = 0;
const stepPhysics = (step) => physics.update(step);

loader?.classList.add('done');
setTimeout(() => loader?.remove(), 600);
rig.snap();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  fps = MathUtils.lerp(fps, dt > 0 ? 1 / dt : fps, 0.06);

  const input = controls.sample();
  physics.setInput(input);
  physicsWorld.step(dt, stepPhysics);
  physics.syncVisual();
  environment.update();

  const t = physics.telemetry;

  lights.update(dt, t);
  audio.update(dt, t);
  // the city answers the headlight switch: windows and street lamps come up
  environment.setNightLevel(lights.state.headlights ? 1 : 0);

  // an upside-down car is a stuck car: offer the reset rather than forcing it
  flippedFor = physics.isFlipped && Math.abs(t.speedMps) < 1 ? flippedFor + dt : 0;
  hud.el.classList.toggle('flipped-hint', flippedFor > 2.5);

  scene3d.follow(visual.root.position, visual.root.quaternion);
  rig.update(dt, {
    speedKmh: t.speedKmh,
    throttle: input.throttle,
    brake: input.brake,
    reversing: t.gear === 'R' && t.speedMps < -0.5,
  });

  renderer.render(scene, camera);
  const wantSound = settings.get('sound');
  const soundOn = wantSound && audio.running && !audioPolicyBlocked;
  controls.setSoundState(soundOn);
  hud.update(t, {
    fps,
    camera: rig.mode,
    headlights: lights.state.headlights,
    soundBlocked: wantSound && !soundOn,
    soundLabel: audioPolicyBlocked ? '🔊 OPEN IN A TAB FOR SOUND' : '🔊 TAP FOR SOUND',
    audioState: !wantSound ? 'off' : audioPolicyBlocked ? 'blocked by host' : audio.running ? 'on' : audio.started ? 'blocked' : 'tap',
  });
});

// -------------------------------------------------------------- debugging ---
window.__BMW__ = {
  // `visual`, `physics` and `lights` are replaced when the car changes, so
  // they are getters: a console reference taken before a swap still resolves
  // to the car that is actually on the road.
  get visual() { return visual; },
  get physics() { return physics; },
  get lights() { return lights; },
  get car() { return car; },
  get report() { return buildReportJSON(visual); },
  swapCar,
  physicsWorld, environment, controls, settings,
  scene, camera, rig, hud, renderer, RAPIER, rapierReady, audio,
  dumpHierarchy: () => console.log(window.__BMW__.report.tree),
  drive: (throttle = 0, brake = 0, steer = 0, handbrake = false) => {
    // The touch pedals ramp in from the moment they are pressed, so a scripted
    // "full throttle" backdates the press rather than setting a level.
    const long = performance.now() - 5000;
    controls.touch.throttleAt = throttle > 0 ? long : 0;
    controls.touch.brakeAt = brake > 0 ? long : 0;
    controls.touch.steerLeft = steer > 0 ? steer : 0;
    controls.touch.steerRight = steer < 0 ? -steer : 0;
    controls.touch.handbrake = handbrake;
  },
  resetCar,
  /** Deterministic physics run, independent of frame rate — used by the tests. */
  simulate: (seconds, input = {}, sampleEvery = 0.25) => {
    const step = physicsWorld.world.timestep;
    const samples = [];
    physics.setInput({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...input });
    for (let i = 0; i < Math.round(seconds / step); i++) {
      physics.update(step);
      physicsWorld.stepOnce();
      const time = (i + 1) * step;
      if (time % sampleEvery < step) {
        const tel = physics.telemetry;
        samples.push({
          t: +time.toFixed(2), kmh: +tel.speedKmh.toFixed(1), gear: tel.gear,
          rpm: Math.round(tel.rpm), onGround: tel.wheelsOnGround,
          x: +physics.body.translation().x.toFixed(2),
          z: +physics.body.translation().z.toFixed(2),
          yaw: +((2 * Math.asin(Math.max(-1, Math.min(1, physics.body.rotation().y))) * 180) / Math.PI).toFixed(1),
        });
      }
    }
    physics.syncVisual();
    return samples;
  },
};
console.log('%cwindow.__BMW__ ready — __BMW__.drive(1) to accelerate, __BMW__.simulate(5,{throttle:1})', 'color:#4ade80');
